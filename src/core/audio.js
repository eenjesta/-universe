import * as THREE from 'three';

/**
 * Procedural audio facade (WebAudio, no sample files). Sounds are "recipes"
 * registered by src/audio/*:
 *
 *   ctx.audio.register('laser', (ac, out, opts) => { ...build nodes → out... });
 *   ctx.audio.register('ship.engine', (ac, out, opts) => ({ set(params) {}, stop() {} }), { loop: true });
 *
 * Callers never need to null-check:
 *   ctx.audio.play('ui.click');
 *   ctx.audio.play('explosion', { position: vec3, volume: 0.8 });   // 3D attenuated + panned
 *   const engine = ctx.audio.loop('car.engine');  engine.set({ rpm: 0.4 });  engine.stop();
 *
 * Buses: 'sfx' (default), 'music', 'ui', 'ambient' → master.
 * The AudioContext is created lazily on the first user gesture.
 */
const NOOP_HANDLE = { set() {}, stop() {}, playing: false };

export class AudioEngine {
  constructor(events) {
    this.events = events;
    this.ac = null;
    this.buses = {};
    this.recipes = new Map();
    this.volumes = { master: 0.7, music: 0.5, sfx: 0.8 };
    this.listener = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this._pendingLoops = []; // loops requested before unlock
    this._unlock = this._unlock.bind(this);
    window.addEventListener('pointerdown', this._unlock, true);
    window.addEventListener('keydown', this._unlock, true);
  }

  get ready() {
    return !!this.ac && this.ac.state === 'running';
  }

  _unlock() {
    try {
      if (!this.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ac = new AC();
        const master = this.ac.createGain();
        const comp = this.ac.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 3;
        master.connect(comp).connect(this.ac.destination);
        this.buses.master = master;
        for (const name of ['sfx', 'music', 'ui', 'ambient']) {
          const g = this.ac.createGain();
          g.connect(master);
          this.buses[name] = g;
        }
        this._applyVolumes();
        this.events?.emit('audio:ready');
      }
      if (this.ac.state === 'suspended') this.ac.resume();
      if (this.ac.state !== 'closed') {
        const pending = this._pendingLoops.splice(0);
        pending.forEach((p) => p.start());
      }
    } catch (err) {
      console.warn('[audio] unlock failed', err);
    }
  }

  setVolumes({ master, music, sfx } = {}) {
    if (master != null) this.volumes.master = master;
    if (music != null) this.volumes.music = music;
    if (sfx != null) this.volumes.sfx = sfx;
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.buses.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(this.volumes.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.buses.ambient.gain.setTargetAtTime(this.volumes.sfx * 0.8, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(Math.min(1, this.volumes.sfx * 1.1), t, 0.05);
  }

  /** recipe(ac, outNode, opts) — for loops it must return a handle {set, stop}. */
  register(name, recipe, { loop = false, bus = null } = {}) {
    this.recipes.set(name, { recipe, loop, bus: bus || (name.startsWith('ui.') ? 'ui' : name.startsWith('music') ? 'music' : name.startsWith('ambient') ? 'ambient' : 'sfx') });
  }

  has(name) {
    return this.recipes.has(name);
  }

  /** Sets the listener from a camera (called each frame by the active mode / shell). */
  setListener(camera) {
    camera.getWorldPosition(this.listener.position);
    camera.getWorldQuaternion(this.listener.quaternion);
  }

  _spatial(opts) {
    // Returns {gain, pan} from opts.position relative to the listener.
    const p = opts.position;
    if (!p) return { gain: 1, pan: 0 };
    const rel = new THREE.Vector3().subVectors(p, this.listener.position);
    const dist = rel.length();
    const ref = opts.refDistance ?? 8;
    const max = opts.maxDistance ?? 250;
    if (dist > max) return { gain: 0, pan: 0 };
    const gain = ref / (ref + Math.max(0, dist - ref));
    rel.applyQuaternion(this.listener.quaternion.clone().invert());
    const pan = dist > 0.01 ? Math.max(-1, Math.min(1, rel.x / dist)) : 0;
    return { gain, pan };
  }

  _chain(busName, opts) {
    const ac = this.ac;
    const gain = ac.createGain();
    const { gain: g, pan } = this._spatial(opts);
    gain.gain.value = (opts.volume ?? 1) * g;
    let node = gain;
    if (opts.position && ac.createStereoPanner) {
      const panner = ac.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      node = panner;
    }
    node.connect(this.buses[busName] || this.buses.sfx);
    return gain;
  }

  play(name, opts = {}) {
    if (!this.ready) return;
    const r = this.recipes.get(name);
    if (!r || r.loop) return;
    try {
      const { gain } = this._spatial(opts);
      if (gain <= 0.001) return;
      const out = this._chain(r.bus, opts);
      r.recipe(this.ac, out, opts);
      // let the graph be garbage-collected after the sound ends
      setTimeout(() => out.disconnect(), (opts.maxDuration ?? 6) * 1000);
    } catch (err) {
      console.warn(`[audio] play "${name}" failed`, err);
    }
  }

  /** Starts a looping sound; returns a handle {set(params), stop(fade)} (safe before unlock). */
  loop(name, opts = {}) {
    const r = this.recipes.get(name);
    if (!r || !r.loop) return { ...NOOP_HANDLE };
    const handle = { playing: false, _inner: null, _params: {}, _stopped: false };
    const start = () => {
      if (handle._stopped || !this.ready) return;
      try {
        const out = this._chain(r.bus, { ...opts, position: null });
        handle._out = out;
        handle._inner = r.recipe(this.ac, out, opts) || NOOP_HANDLE;
        handle.playing = true;
        handle._inner.set?.(handle._params);
      } catch (err) {
        console.warn(`[audio] loop "${name}" failed`, err);
      }
    };
    handle.start = start;
    handle.set = (params = {}) => {
      Object.assign(handle._params, params);
      if (handle._inner) {
        handle._inner.set?.(handle._params);
        if (params.volume != null && handle._out) handle._out.gain.setTargetAtTime(params.volume, this.ac.currentTime, 0.08);
      }
    };
    handle.stop = (fade = 0.4) => {
      handle._stopped = true;
      handle.playing = false;
      if (!handle._inner) return;
      try {
        handle._out.gain.setTargetAtTime(0, this.ac.currentTime, fade / 3);
        const inner = handle._inner;
        const out = handle._out;
        setTimeout(() => {
          inner.stop?.();
          out.disconnect();
        }, fade * 1000 + 100);
      } catch {
        /* ignore */
      }
    };
    if (this.ready) start();
    else this._pendingLoops.push(handle);
    return handle;
  }
}
