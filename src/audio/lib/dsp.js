/**
 * DSP building blocks shared by every recipe (pure WebAudio, works with both
 * AudioContext and OfflineAudioContext so recipes can be measured offline):
 *
 *   Graph        node builder that remembers what it created; one-shots call
 *                finish() and are disconnected automatically when their last
 *                source ends, loops call dispose() from their stop().
 *   noiseBuffer  cached white / pink / brown noise (one buffer per context)
 *   reverbIR     cached procedural stereo impulse responses (damped, pre-delayed)
 *   wave         cached PeriodicWaves (warm saw, soft square, organ, glass, hum…)
 *   shapeWave    cached PeriodicWave from any periodic shape (smooth LFO pulses)
 *   curve        cached soft-saturation curves for WaveShaperNodes
 *   Scheduler    look-ahead event scheduler (setInterval in real time, one
 *                synchronous pass over `duration` when rendering offline)
 */

const caches = new WeakMap(); // ac → Map(key → value)

function cache(ac, key, make) {
  let m = caches.get(ac);
  if (!m) caches.set(ac, (m = new Map()));
  let v = m.get(key);
  if (v === undefined) {
    v = make();
    m.set(key, v);
  }
  return v;
}

export const isOffline = (ac) => typeof OfflineAudioContext !== 'undefined' && ac instanceof OfflineAudioContext;

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const rand = (a = 0, b = 1) => a + (b - a) * Math.random();
export const pickOne = (arr) => arr[(Math.random() * arr.length) | 0];
/** Finite number or fallback (params come from other modules). */
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Small deterministic PRNG for buffers (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------- buffers
/** Looping mono noise buffer (4 s): 'white' | 'pink' | 'brown'. */
export function noiseBuffer(ac, kind = 'white') {
  return cache(ac, `noise:${kind}`, () => {
    const sr = ac.sampleRate;
    const len = Math.floor(sr * 4);
    const buf = ac.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const r = prng(kind === 'white' ? 11 : kind === 'pink' ? 23 : 37);
    if (kind === 'pink') {
      // Paul Kellet's refined pink filter
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    }
    // crossfade the loop seam (50 ms) so looping never clicks
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
    let peak = 0;
    for (let i = 0; i < len - fade; i++) peak = Math.max(peak, Math.abs(d[i]));
    const norm = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < len; i++) d[i] *= norm;
    return buf;
  });
}

/**
 * Procedural stereo reverb impulse response: early reflections + exponentially
 * decaying noise tail that gets darker over time (air absorption).
 */
export function reverbIR(ac, { seconds = 3.2, decay = 2.6, bright = 0.55, predelay = 0.018, seed = 7 } = {}) {
  return cache(ac, `ir:${seconds}:${decay}:${bright}:${predelay}:${seed}`, () => {
    const sr = ac.sampleRate;
    const len = Math.max(1, Math.floor(sr * seconds));
    const buf = ac.createBuffer(2, len, sr);
    const pre = Math.floor(sr * predelay);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const r = prng(seed * 31 + ch * 977);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const env = Math.exp((-t * 6.9) / Math.max(0.05, decay)); // −60 dB at `decay` s
        // one-pole low-pass whose cutoff falls with time
        const a = Math.max(0.03, bright * (1 - Math.min(1, t / seconds) * 0.85));
        lp += ((r() * 2 - 1) - lp) * a;
        d[i] = lp * env;
      }
      // sparse early reflections (first 70 ms)
      for (let k = 0; k < 9; k++) {
        const i = pre + Math.floor(sr * (0.004 + r() * 0.066));
        if (i < len) d[i] += (r() < 0.5 ? -1 : 1) * (0.5 - k * 0.04);
      }
      // gentle fade-in of the tail (avoids a hard onset)
      const fin = Math.floor(sr * 0.012);
      for (let i = 0; i < fin && pre + i < len; i++) d[pre + i] *= i / fin;
    }
    return buf;
  });
}

// --------------------------------------------------------------- waves
const WAVES = {
  // band-limited sawtooth with a softer top end (pads, strings)
  warm: (n) => [0, (n % 2 ? 1 : 0.82) / Math.pow(n, 1.18)],
  // hollow, clarinet-like (odd harmonics + a touch of even)
  hollow: (n) => [0, (n % 2 ? 1 : 0.12) / Math.pow(n, 1.25)],
  // organ / flute (few harmonics)
  organ: (n) => [0, n === 1 ? 1 : n === 2 ? 0.42 : n === 3 ? 0.22 : n === 4 ? 0.12 : n === 6 ? 0.05 : 0],
  // bright but smooth (plucks)
  bright: (n) => [0, 1 / Math.pow(n, 0.92)],
  // soft triangle-ish
  soft: (n) => [0, n % 2 ? 1 / (n * n) : 0.04 / (n * n)],
  // glassy (bells, stars)
  glass: (n) => [0, n === 1 ? 1 : n === 3 ? 0.3 : n === 5 ? 0.18 : n === 8 ? 0.08 : 0],
  // warm machine hum: strong fundamental, soft low harmonics, nothing bright
  hum: (n) => [0, n > 8 ? 0 : [1, 0.5, 0.3, 0.17, 0.09, 0.05, 0.025, 0.012][n - 1]],
};

/** Cached PeriodicWave by name (see WAVES). */
export function wave(ac, name = 'warm', harmonics = 32) {
  return cache(ac, `wave:${name}:${harmonics}`, () => {
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    const f = WAVES[name] || WAVES.warm;
    for (let n = 1; n <= harmonics; n++) {
      const [re, im] = f(n);
      real[n] = re;
      imag[n] = im;
    }
    return ac.createPeriodicWave(real, imag);
  });
}

/**
 * PeriodicWave from an arbitrary periodic shape `fn(phase 0..1)`: band-limited to
 * `harmonics` with a Gaussian taper (no ringing, no hard edges → no clicks when used
 * as an LFO), DC removed and scaled so its maximum is exactly 1 (the same with or
 * without the browser's own normalisation). Returns { wave, min } — the waveform
 * swings between `min` (< 0) and 1. Cached per context and `name`.
 */
export function shapeWave(ac, name, fn, harmonics = 16, taper = 0.55) {
  return cache(ac, `shape:${name}:${harmonics}:${taper}`, () => {
    const S = 2048;
    const xs = new Float64Array(S);
    for (let i = 0; i < S; i++) xs[i] = fn(i / S);
    const re = new Float32Array(harmonics + 1);
    const im = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) {
      let a = 0;
      let b = 0;
      for (let i = 0; i < S; i++) {
        const ph = (2 * Math.PI * n * i) / S;
        a += xs[i] * Math.cos(ph);
        b += xs[i] * Math.sin(ph);
      }
      const w = Math.exp(-Math.pow(n / (harmonics * taper), 2));
      re[n] = ((2 * a) / S) * w;
      im[n] = ((2 * b) / S) * w;
    }
    let mx = -Infinity;
    let mn = Infinity;
    for (let i = 0; i < 1024; i++) {
      let v = 0;
      for (let n = 1; n <= harmonics; n++) {
        const ph = (2 * Math.PI * n * i) / 1024;
        v += re[n] * Math.cos(ph) + im[n] * Math.sin(ph);
      }
      mx = Math.max(mx, v);
      mn = Math.min(mn, v);
    }
    const k = mx > 0 ? 1 / mx : 1;
    for (let n = 1; n <= harmonics; n++) {
      re[n] *= k;
      im[n] *= k;
    }
    let wave;
    try {
      wave = ac.createPeriodicWave(re, im, { disableNormalization: true });
    } catch {
      wave = ac.createPeriodicWave(re, im);
    }
    return { wave, min: mn * k };
  });
}

/** Soft saturation curve (tanh), cached by drive amount. */
export function curve(ac, drive = 2) {
  const k = Math.round(drive * 10) / 10;
  return cache(ac, `curve:${k}`, () => {
    const n = 1024;
    const c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / (norm || 1);
    }
    return c;
  });
}

// --------------------------------------------------------------- graph
/**
 * Node builder. Every created node is remembered so the whole sound can be
 * torn down at once (dispose) — no leaked, still-connected nodes.
 */
export class Graph {
  constructor(ac, out) {
    this.ac = ac;
    this.out = out;
    // a few ms ahead: envelopes never start in the past of the audio thread
    this.t = ac.currentTime + (isOffline(ac) ? 0.002 : 0.006);
    this.nodes = [];
    this.sources = [];
    this.timers = [];
    this.end = this.t;
    this.disposed = false;
    this.onDispose = null;
    this._last = null;
  }

  _add(n) {
    this.nodes.push(n);
    return n;
  }

  gain(v = 1) {
    const g = this.ac.createGain();
    g.gain.value = v;
    return this._add(g);
  }

  osc(type = 'sine', freq = 440, detune = 0) {
    const o = this.ac.createOscillator();
    if (typeof type === 'string') {
      if (['sine', 'square', 'sawtooth', 'triangle'].includes(type)) o.type = type;
      else o.setPeriodicWave(wave(this.ac, type));
    } else o.setPeriodicWave(type);
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    this.sources.push(o);
    return this._add(o);
  }

  /** Looping noise source; random start offset decorrelates parallel sources. */
  noise(kind = 'white', rate = 1) {
    const s = this.ac.createBufferSource();
    s.buffer = noiseBuffer(this.ac, kind);
    s.loop = true;
    s.playbackRate.value = rate;
    s._offset = Math.random() * 3.5;
    this.sources.push(s);
    return this._add(s);
  }

  buffer(buf, { loop = false, rate = 1 } = {}) {
    const s = this.ac.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.playbackRate.value = rate;
    this.sources.push(s);
    return this._add(s);
  }

  constant(offset = 1) {
    const c = this.ac.createConstantSource();
    c.offset.value = offset;
    this.sources.push(c);
    return this._add(c);
  }

  filter(type = 'lowpass', freq = 1000, Q = 0.707, gain = 0) {
    const f = this.ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    if (gain) f.gain.value = gain;
    return this._add(f);
  }

  pan(p = 0) {
    if (!this.ac.createStereoPanner) return this.gain(1);
    const n = this.ac.createStereoPanner();
    n.pan.value = Math.max(-1, Math.min(1, p));
    return this._add(n);
  }

  delay(time = 0.25, max = 2) {
    const d = this.ac.createDelay(max);
    d.delayTime.value = time;
    return this._add(d);
  }

  shaper(drive = 2) {
    const s = this.ac.createWaveShaper();
    s.curve = curve(this.ac, drive);
    s.oversample = '2x';
    return this._add(s);
  }

  convolver(buf) {
    const c = this.ac.createConvolver();
    c.buffer = buf;
    return this._add(c);
  }

  compressor({ threshold = -18, knee = 12, ratio = 4, attack = 0.005, release = 0.2 } = {}) {
    const c = this.ac.createDynamicsCompressor();
    c.threshold.value = threshold;
    c.knee.value = knee;
    c.ratio.value = ratio;
    c.attack.value = attack;
    c.release.value = release;
    return this._add(c);
  }

  /** Connects nodes in series; returns the last one. */
  chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  /** Starts a source at t0 and (optionally) stops it at t1. */
  play(src, t0 = this.t, t1 = null) {
    const at = Math.max(t0, this.ac.currentTime);
    if (src._offset != null) src.start(at, src._offset);
    else src.start(at);
    if (t1 != null) {
      const stopAt = Math.max(t1, at + 0.01);
      src.stop(stopAt);
      src._stopAt = stopAt;
      if (stopAt > this.end) {
        this.end = stopAt;
        this._last = src;
      }
    }
    return src;
  }

  /** Keeps the sound alive (for echo/reverb tails) until `until` with a silent source. */
  hold(until) {
    const c = this.constant(0);
    c.connect(this.out);
    this.play(c, this.t, until);
    return c;
  }

  /** Low-frequency oscillator added onto an AudioParam (value ± depth). */
  lfo(param, rate = 0.2, depth = 1, type = 'sine', t0 = this.t, t1 = null) {
    const o = this.osc(type, rate);
    const g = this.gain(depth);
    o.connect(g).connect(param);
    this.play(o, t0, t1);
    return { osc: o, depth: g };
  }

  /**
   * One-shots: tear everything down when the last source has ended. Every
   * source must have been given a stop time via play(src, t0, t1).
   */
  finish() {
    const last = this._last;
    if (last) last.onended = () => this.dispose();
    else this.dispose();
    // safety net in case `ended` never fires (real-time contexts only)
    if (!isOffline(this.ac) && typeof setTimeout === 'function') {
      const ms = Math.max(0, (this.end - this.ac.currentTime) * 1000) + 1500;
      this.timers.push(setTimeout(() => this.dispose(), ms));
    }
    return this;
  }

  /** Stops every source, clears timers and disconnects every node (idempotent). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.timers) {
      clearTimeout(id);
      clearInterval(id);
    }
    this.timers.length = 0;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* never started or already stopped */
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
    const cb = this.onDispose;
    this.onDispose = null;
    cb?.(this);
  }
}

// --------------------------------------------------------------- envelopes
/** Linear attack to `peak`, exponential decay to silence by t + a + d. */
export function perc(param, t, peak = 1, a = 0.004, d = 0.3) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.exponentialRampToValueAtTime(Math.max(1e-4, peak * 1e-4), t + a + d);
  param.setValueAtTime(0, t + a + d + 0.001);
  return t + a + d + 0.01;
}

/** Attack / hold / release swell (smooth, setTarget-based). Returns the end time. */
export function swell(param, t, peak = 1, a = 0.5, hold = 0.5, r = 1) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.setTargetAtTime(peak, t, Math.max(0.005, a / 3));
  param.setTargetAtTime(0, t + a + hold, Math.max(0.005, r / 4));
  return t + a + hold + r * 1.6;
}

/** Smoothly moves an AudioParam towards `v` (time constant tc). Safe for NaN. */
export function glide(param, v, t, tc = 0.1) {
  if (!Number.isFinite(v)) return;
  param.cancelScheduledValues(t);
  param.setTargetAtTime(v, t, Math.max(0.001, tc));
}

/** Exponential pitch sweep on a frequency param. */
export function sweep(param, f0, f1, t, dur) {
  param.setValueAtTime(Math.max(1, f0), t);
  param.exponentialRampToValueAtTime(Math.max(1, f1), t + Math.max(0.005, dur));
}

// --------------------------------------------------------------- offline
const suspendFrames = new WeakMap(); // OfflineAudioContext → Set(frame)

/**
 * Runs `fn` when an OfflineAudioContext's rendering reaches `time` (suspend →
 * fn → resume). Picks a free render-quantum frame, so several schedulers can
 * share one offline context without clashing suspends.
 */
export function offlineAt(ac, time, fn) {
  let used = suspendFrames.get(ac);
  if (!used) suspendFrames.set(ac, (used = new Set()));
  let frame = Math.max(1, Math.ceil((time * ac.sampleRate) / 128));
  while (used.has(frame)) frame++;
  if (frame * 128 >= ac.length) return false;
  used.add(frame);
  ac.suspend((frame * 128) / ac.sampleRate)
    .then(() => {
      try {
        fn();
      } finally {
        ac.resume();
      }
    })
    .catch((err) => console.warn('[audio] offline suspend failed', err));
  return true;
}

// --------------------------------------------------------------- scheduler
/**
 * Look-ahead scheduler: `fn(from, to)` must schedule every event in [from, to).
 * Real time: a timer advances the window (skips forward after throttling, so
 * there is never a burst of late events). Offline: one synchronous pass over
 * `duration` seconds at start().
 */
export class Scheduler {
  constructor(ac, fn, { interval = 0.12, lookahead = 0.9, duration = 0 } = {}) {
    this.ac = ac;
    this.fn = fn;
    this.interval = interval;
    this.lookahead = lookahead;
    this.duration = duration;
    this.cursor = 0;
    this.timer = null;
    this.stopped = false;
    this._tick = this._tick.bind(this);
  }

  start(at = this.ac.currentTime + 0.05) {
    this.cursor = at;
    if (isOffline(this.ac)) {
      // Offline: schedule in 1 s chunks via suspend/resume so only a look-ahead's
      // worth of nodes exists at once (same node counts as in real time).
      const end = at + Math.max(0, this.duration || 30);
      const run = (from, to) => {
        if (this.stopped || from >= end) return;
        try {
          this.fn(from, Math.min(end, to));
        } catch (err) {
          console.warn('[audio] offline schedule failed', err);
        }
      };
      run(at, at + 1 + this.lookahead);
      for (let k = 1; at + k < end; k++) {
        const from = at + k + this.lookahead;
        offlineAt(this.ac, at + k, () => run(from, from + 1));
      }
      return this;
    }
    this._tick();
    this.timer = setInterval(this._tick, this.interval * 1000);
    return this;
  }

  _tick() {
    if (this.stopped) return;
    const now = this.ac.currentTime;
    if (this.ac.state !== 'running') return;
    if (this.cursor < now) this.cursor = now + 0.02; // late (throttled tab): skip ahead
    const ahead = typeof document !== 'undefined' && document.hidden ? Math.max(this.lookahead, 2.5) : this.lookahead;
    const to = now + ahead;
    if (to <= this.cursor) return;
    try {
      this.fn(this.cursor, to);
    } catch (err) {
      console.warn('[audio] scheduler failed', err);
    }
    this.cursor = to;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
