/**
 * Live-rendered thumbnails for the title cards (ctx.engine.snapshot through
 * the full post chain): cards 1–3 render the world from preset cameras
 * (spawn ridge, base with a blueprint hologram, plaza); card 4 renders the
 * space module's own preview (renderPreview / previewCamera / its camera when
 * it is more than the bare fallback), else the shell's space vignette
 * (spaceVignette.js), else the spaceport.
 *
 * On a GPU every material of the world (and space) scene is first compiled
 * asynchronously (renderer.compileAsync), so the first look at the base /
 * plaza would not stall the title. Then one job per frame: at loop order 1
 * the engine view is pointed at the thumbnail camera so camera-following
 * world systems update for it; at order 97 the snapshot is taken (with the
 * player and the hologram posed for the card) and everything is restored
 * before the regular frame renders. Software renderers skip the warm-up and
 * start late (see the constructor). URL: ?thumbs=0 (placeholders only),
 * ?thumbs (render right away).
 */
import * as THREE from 'three';
import { ZONES } from '../../world/layout.js';
import { isSoftwareRenderer } from '../util.js';
import { createSpaceVignette } from './spaceVignette.js';

const W = 640;
const H = 360;
/** Software renderers: first thumbnail this long after the title is shown. */
const SLOW_DELAY_MS = 25000;

export class Thumbnails {
  constructor(ctx) {
    this.ctx = ctx;
    this.cam = new THREE.PerspectiveCamera(48, W / H, 0.3, 6000);
    this.queue = [];
    this.cache = new Map(); // id → canvas
    this.job = null;
    this._holo = null;
    this._pose = { pos: new THREE.Vector3(), rotY: 0, visible: true };
    // ?thumbs=0 keeps the painted placeholders, ?thumbs (=1) renders at once
    const p = ctx.params.thumbs;
    this.disabled = p === '0' || p === 'off' || p === 'false';
    const force = p === true || p === '1' || p === 'now';
    // On a software renderer (SwiftShader in headless tests, no GPU) every
    // extra frame costs seconds and, without KHR_parallel_shader_compile, a
    // scene-wide shader warm-up stalls the GPU process for minutes. There the
    // thumbnails start well after the title is shown (so screenshots of the
    // title are never blocked), compile lazily per view and are spaced out.
    this.slow = isSoftwareRenderer(ctx.engine.renderer);
    this._holdUntil = this.slow ? Infinity : 0;
    this._gap = 0;
    this._warm = null; // Promise of the shader warm-up
    this.warm = this.slow; // warm-up finished (or skipped / timed out)
    if (this.slow) ctx.events.once('game:ready', () => (this._holdUntil = performance.now() + (force ? 1500 : SLOW_DELAY_MS)));
    ctx.loop.add('shell-thumbs-prime', () => this._prime(), { order: 1, pausable: false });
    ctx.loop.add('shell-thumbs-shot', () => this._shot(), { order: 97, pausable: false });
  }

  get busy() {
    return !!this.job || this.queue.length > 0;
  }

  /** Requests a thumbnail; cb(canvas | null). Cached results return at once. */
  request(id, cb) {
    if (this.disabled) return;
    if (this.cache.has(id)) {
      cb(this.cache.get(id));
      return;
    }
    const pending = this.queue.find((j) => j.origId === id) || (this.job?.origId === id ? this.job : null);
    if (pending) pending.cbs.push(cb);
    else this.queue.push({ id, origId: id, cbs: [cb], primed: false });
  }

  _ground(x, z) {
    const g = this.ctx.world?.getHeightAt?.(x, z);
    return Number.isFinite(g) ? Math.max(g, 0) : 0;
  }

  /** Camera + optional player pose per preset (world coordinates). */
  _preset(id) {
    const gy = (x, z) => this._ground(x, z);
    switch (id) {
      case 'spawn': {
        const s = ZONES.spawn;
        const y = gy(s.x, s.z);
        return { pos: [s.x + 1.35, y + 1.55, s.z + 3.3], look: [s.x - 38, y + 9, s.z - 520], fov: 44 };
      }
      case 'base': {
        const b = ZONES.base;
        const a = b.buildArea;
        const px = a.x + 6;
        const pz = a.z + 14;
        const y = gy(px, pz);
        return {
          pos: [px + 2.2, y + 2.1, pz + 6.5],
          look: [b.house.x + 18, gy(b.house.x, b.house.z) + 4.5, b.house.z - 10],
          fov: 50,
          player: { x: px, z: pz, heading: 0.95 },
          holo: { x: a.x - 6, z: a.z + 4 },
        };
      }
      case 'plaza': {
        const p = ZONES.plaza;
        const px = p.x + 14;
        const pz = p.z + 46;
        const y = gy(px, pz);
        return {
          pos: [px + 1.6, y + 1.9, pz + 5.2],
          look: [p.x - 2, gy(p.x, p.z) + 15, p.z],
          fov: 52,
          player: { x: px, z: pz, heading: 0.25 },
        };
      }
      case 'spaceport':
      default: {
        const sp = ZONES.spaceport;
        const pad = sp.pads.ship;
        const y = gy(pad.x, pad.z);
        return {
          pos: [pad.x - 36, y + 7, pad.z + 34],
          look: [pad.x + 22, y + 6, pad.z - 14],
          fov: 46,
          player: { x: pad.x - 30, z: pad.z + 28, heading: -0.85 },
        };
      }
    }
  }

  /**
   * Compiles every material of the world and space scenes without blocking
   * (KHR_parallel_shader_compile where available). Resolves when done or
   * after a timeout, whichever comes first.
   */
  warmUp() {
    if (this._warm) return this._warm;
    const ctx = this.ctx;
    const r = ctx.engine.renderer;
    const jobs = [];
    const compile = (scene, cam) => {
      if (!scene?.isScene || !cam?.isCamera || typeof r?.compileAsync !== 'function') return;
      try {
        jobs.push(r.compileAsync(scene, cam).catch(() => {}));
      } catch (err) {
        console.warn('[shell] shader warm-up failed', err);
      }
    };
    compile(ctx.world?.scene, this.cam);
    const sp = this._spaceSource();
    if (sp) compile(sp.scene, sp.camera);
    const limit = new Promise((res) => setTimeout(res, this.slow ? 90000 : 20000));
    this._warm = Promise.race([Promise.all(jobs), limit]).then(() => {
      this.warm = true;
    });
    return this._warm;
  }

  _prime() {
    const ctx = this.ctx;
    if (this.job || !this.queue.length) return;
    if (!ctx.modes.is('title') || ctx.modes.transitioning || !ctx.world?.scene) return;
    if (performance.now() < this._holdUntil) return;
    if (!this.warm) {
      this.warmUp();
      return;
    }
    if (this.slow && this._gap-- > 0) return;
    this.job = this.queue.shift();
    const job = this.job;
    if (job.id === 'space') return; // own scene (space module or vignette): nothing to prime
    const p = this._preset(job.id);
    job.preset = p;
    this.cam.fov = p.fov;
    this.cam.position.set(...p.pos);
    this.cam.lookAt(p.look[0], p.look[1], p.look[2]);
    this.cam.updateMatrixWorld();
    // Point the engine at the thumbnail camera before the world systems run
    // so camera-following state (sun shadow frustum, streaming) is right for
    // it. Only while the boot overlay / a fade hides the main view.
    if (!this.slow) ctx.engine.setView(ctx.world.scene, this.cam);
    job.primed = true;
  }

  /**
   * The space module's scene + camera for card 4: its explicit preview
   * camera, or its live camera when it is more than the bare fallback (which
   * only exposes {scene, camera} and shows a dark star field).
   */
  _spaceSource() {
    const sp = this.ctx.space;
    if (!sp?.scene?.isScene) return null;
    if (sp.previewCamera?.isCamera) return { scene: sp.scene, camera: sp.previewCamera };
    const bare = Object.keys(sp).every((k) => k === 'scene' || k === 'camera');
    return !bare && sp.camera?.isCamera ? { scene: sp.scene, camera: sp.camera } : null;
  }

  /** Card 4: the space module's own preview, else the shell's space vignette (null → spaceport). */
  _spaceShot() {
    const ctx = this.ctx;
    const ok = (c) => c && luminance(c) >= 0.03;
    try {
      if (typeof ctx.space?.renderPreview === 'function') {
        const c = ctx.space.renderPreview(W, H);
        if (ok(c)) return c;
      }
      const src = this._spaceSource();
      if (src) {
        const c = ctx.engine.snapshot(src.scene, src.camera, W, H);
        if (ok(c)) return c;
      }
    } catch (err) {
      console.warn('[shell] space preview failed, using the vignette', err);
    }
    const v = createSpaceVignette(W / H);
    try {
      const c = ctx.engine.snapshot(v.scene, v.camera, W, H);
      return ok(c) ? c : null;
    } finally {
      v.dispose();
    }
  }

  _shot() {
    const job = this.job;
    if (!job) return;
    const ctx = this.ctx;
    const engine = ctx.engine;
    let canvas = null;
    try {
      if (job.id === 'space') {
        canvas = this._spaceShot();
        if (!canvas) {
          // nothing usable: show the spaceport instead (next frame)
          this._restoreView();
          job.id = 'spaceport';
          job.primed = false;
          this.queue.unshift(job);
          this.job = null;
          return;
        }
      } else if (job.primed) {
        this._posePlayer(job.preset.player);
        if (job.preset.holo) this._showHolo(job.preset.holo);
        canvas = engine.snapshot(ctx.world.scene, this.cam, W, H);
      }
    } catch (err) {
      console.warn(`[shell] thumbnail "${job.id}" failed`, err);
      canvas = null;
    } finally {
      this._hideHolo();
      this._restorePlayer();
      this._restoreView();
    }
    this.job = null;
    if (this.slow) this._gap = 2;
    if (canvas) this.cache.set(job.origId, canvas);
    for (const cb of job.cbs) {
      try {
        cb(canvas);
      } catch (err) {
        console.error('[shell] thumbnail callback failed', err);
      }
    }
    if (!this.queue.length) this._disposeHolo();
  }

  _restoreView() {
    const m = this.ctx.modes.current;
    if (m?.scene && m?.camera) this.ctx.engine.setView(m.scene, m.camera);
  }

  // ---------------------------------------------------------- player pose
  _posePlayer(p) {
    const obj = this.ctx.player?.object;
    this._posed = false;
    if (!p || !obj) return;
    this._pose.pos.copy(obj.position);
    this._pose.rotY = obj.rotation.y;
    this._pose.visible = obj.visible;
    obj.position.set(p.x, this._ground(p.x, p.z), p.z);
    obj.rotation.y = p.heading;
    obj.visible = true;
    obj.updateMatrixWorld(true);
    this._posed = true;
  }

  _restorePlayer() {
    if (!this._posed) return;
    const obj = this.ctx.player?.object;
    if (obj) {
      obj.position.copy(this._pose.pos);
      obj.rotation.y = this._pose.rotY;
      obj.visible = this._pose.visible;
      obj.updateMatrixWorld(true);
    }
    this._posed = false;
  }

  // ------------------------------------------------------ blueprint hologram
  _showHolo(at) {
    if (!this._holo) this._holo = makeHologram();
    const y = this._ground(at.x, at.z);
    this._holo.position.set(at.x, y + 0.05, at.z);
    this._holo.rotation.y = 0.3;
    this.ctx.world.scene.add(this._holo);
    this._holo.updateMatrixWorld(true);
  }

  _hideHolo() {
    if (this._holo?.parent) this._holo.parent.remove(this._holo);
  }

  _disposeHolo() {
    if (!this._holo) return;
    this._hideHolo();
    this._holo.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this._holo = null;
  }
}

/** Average luminance (0..1) of a canvas, sampled on a tiny copy. */
function luminance(canvas) {
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 9;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(canvas, 0, 0, 16, 9);
    const d = g.getImageData(0, 0, 16, 9).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255;
  } catch {
    return 1;
  }
}

/**
 * Cyan holographic blueprint (crop_overview card 2): a subdivided wire cube
 * on a projected floor grid, bright enough (HDR colour) to bloom.
 */
function makeHologram() {
  const group = new THREE.Group();
  group.name = 'shell-thumb-hologram';
  const size = 7;
  const hgt = 6;
  const n = 2;
  const pts = [];
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(-size / 2 + (size * i) / n);
  const ys = [0, hgt / 2, hgt];
  for (const y of ys) {
    for (const x of xs) pts.push(x, y, -size / 2, x, y, size / 2);
    for (const z of xs) pts.push(-size / 2, y, z, size / 2, y, z);
  }
  for (const x of xs) for (const z of xs) pts.push(x, 0, z, x, hgt, z);
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.55, 2.4, 3.2), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: true });
  group.add(new THREE.LineSegments(lines, lineMat));
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(size, hgt, size).translate(0, hgt / 2, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 1.3), transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }),
  );
  group.add(box);
  // floor grid
  const g = [];
  const half = size * 0.9;
  for (let i = -6; i <= 6; i++) {
    const t = (i / 6) * half;
    g.push(t, 0.02, -half, t, 0.02, half, -half, 0.02, t, half, 0.02, t);
  }
  const grid = new THREE.BufferGeometry();
  grid.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
  group.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: new THREE.Color(0.3, 1.4, 1.9), transparent: true, opacity: 0.45, depthWrite: false })));
  group.traverse((o) => {
    o.frustumCulled = false;
    o.renderOrder = 5;
  });
  return group;
}
