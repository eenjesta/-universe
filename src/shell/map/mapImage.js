/**
 * The shared top-down map image (2048², covering ±MAP_EXTENT) used by the
 * world-map modal and the HUD minimap, in the style of 19_world_map.png.
 *
 *   1. gather (main thread, cheap): the terrain's baked height grid + splat
 *      masks (world.terrain), every tree from the vegetation layers, river
 *      water heights — or, without terrain data, a height grid sampled from
 *      world.getHeightAt
 *   2. bake (Web Worker, mapBake.js): colours, light, shadows, water, trees,
 *      clouds → RGBA pixels; falls back to a time-sliced main-thread bake
 *   3. overlays (main thread, canvas 2D): roads, landmark grounds (plaza,
 *      spaceport, base plot), every building footprint from the physics
 *      boxes with its cast shadow, city lights, glows and waterfalls
 */
import { WORLD, ZONES, ROADS, RIVERS, WATERFALLS, CITY_ISLANDS, RACE_TRACK } from '../../world/layout.js';
import { bakeMap, TREE_KINDS } from './mapBake.js';

/** Half-size (m) of the square the map image covers, centred on the origin. */
export const MAP_EXTENT = WORLD.half;

/** World (x, z) → normalised map coordinates (u right/east, v down/south). */
export function worldToUV(x, z, out = [0, 0], extent = MAP_EXTENT) {
  out[0] = (x + extent) / (2 * extent);
  out[1] = (z + extent) / (2 * extent);
  return out;
}

/** Golden-hour light from the north-north-east, 30° high (unit, toward the light). */
const LIGHT = (() => {
  const az = (28 * Math.PI) / 180; // compass bearing, east of north
  const el = (30 * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
})();

const yieldToMain = () => new Promise((r) => setTimeout(r, 0));

/** Vegetation layer → canopy kind for the bake (null = too small to show). */
function treeKind(name, metaKind) {
  if (/birch/i.test(name)) return TREE_KINDS.birch;
  if (/acacia/i.test(name)) return TREE_KINDS.acacia;
  if (/oak/i.test(name)) return TREE_KINDS.broadleaf;
  if (metaKind === 'pine') return TREE_KINDS.pine;
  if (metaKind === 'broadleaf') return TREE_KINDS.broadleaf;
  if (metaKind === 'jungle') return TREE_KINDS.jungle;
  if (metaKind === 'palm') return TREE_KINDS.palm;
  if (metaKind === 'bush') return TREE_KINDS.bush;
  return null;
}

export class MapImage {
  constructor(ctx, { size = 2048 } = {}) {
    this.ctx = ctx;
    this.size = size;
    this.canvas = null; // ready composite (size × size)
    this.ready = false;
    this.building = false;
    this.version = 0;
    this.stats = null;
    this._listeners = new Set();
  }

  /**
   * Best map available right now: the baked composite once ready, else the
   * terrain's own colour map (world.minimap, ready at install) as a preview.
   * Returns { canvas, extent, hires } or null.
   */
  source() {
    if (this.ready && this.canvas) return { canvas: this.canvas, extent: MAP_EXTENT, hires: true };
    return this.preview();
  }

  /** The terrain's world.minimap as { canvas, extent } (centred square maps only). */
  preview() {
    if (this._preview !== undefined && this._preview?.canvas === this.ctx.world?.minimap?.canvas) return this._preview;
    let out = null;
    try {
      const mm = this.ctx.world?.minimap;
      const c = mm?.canvas;
      if (c && c.width > 0 && c.width === c.height && typeof mm.worldToMap === 'function') {
        const [u0, v0] = mm.worldToMap(0, 0);
        const [u1] = mm.worldToMap(1000, 0);
        const extent = 500 / (u1 - u0);
        if (Math.abs(u0 - 0.5) < 0.01 && Math.abs(v0 - 0.5) < 0.01 && extent > 100 && extent < 10000) out = { canvas: c, extent, hires: false };
      }
    } catch {
      out = null;
    }
    // cache only a hit (the terrain may install its map later)
    if (out) this._preview = out;
    return out;
  }

  /** fn(mapImage) once the composite is (re)built. */
  onReady(fn) {
    this._listeners.add(fn);
    if (this.ready) fn(this);
    return () => this._listeners.delete(fn);
  }

  /** Starts building after `delay` ms (no-op while a build is running or done). */
  start(delay = 0) {
    if (this.building || this.ready) return;
    this.building = true;
    setTimeout(() => {
      const t0 = performance.now();
      this._build()
        .then(() => {
          this.ready = true;
          this.version++;
          this.stats = { ...(this.stats || {}), totalMs: Math.round(performance.now() - t0) };
          for (const fn of [...this._listeners]) {
            try {
              fn(this);
            } catch (err) {
              console.error('[shell] map listener failed', err);
            }
          }
        })
        .catch((err) => console.warn('[shell] map image build failed', err))
        .finally(() => {
          this.building = false;
        });
    }, delay);
  }

  async _build() {
    const S = this.size;
    let input = await this._gather();
    let pixels = null;
    let how = 'worker';
    try {
      pixels = await this._bakeInWorker(input);
    } catch (err) {
      console.warn('[shell] map worker unavailable, baking on the main thread', err?.message || err);
      how = 'main';
      // transferred buffers are gone after a failed worker run: gather again
      if (!input.grid.heights.byteLength) input = await this._gather();
      pixels = await bakeMap(input, { yieldFn: yieldToMain, budget: 8 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const g = canvas.getContext('2d');
    g.putImageData(new ImageData(pixels, S, S), 0, 0);
    await yieldToMain();
    this._drawOverlays(g, S);
    this.canvas = canvas;
    this.stats = { ...(this.stats || {}), how };
  }

  // ----------------------------------------------------------------- gather
  async _gather() {
    const ctx = this.ctx;
    const world = ctx.world || {};
    const D = world.terrain?.data;
    const tex = world.terrain?.textures;
    const E = MAP_EXTENT;
    const input = {
      size: this.size,
      extent: E,
      light: LIGHT,
      playBounds: WORLD.hubPlayBounds ?? WORLD.playBounds,
      cityIslands: CITY_ISLANDS.map((c) => ({ x: c.x, z: c.z, radius: c.radius * 0.97 })),
    };

    if (D?.heights && D.N && D.STEP && D.heights.length === D.N * D.N) {
      const half = Number.isFinite(D.HALF) ? D.HALF : ((D.N - 1) * D.STEP) / 2;
      input.grid = { n: D.N, step: D.STEP, half, heights: D.heights.slice() };
      const same = (t) => t?.image?.data && t.image.width === D.N && t.image.height === D.N && t.image.data.length === D.N * D.N * 4;
      if (same(tex?.splatA) && same(tex?.splatB)) {
        input.splatA = tex.splatA.image.data.slice();
        input.splatB = tex.splatB.image.data.slice();
      }
      if (same(tex?.normal)) input.normal = tex.normal.image.data.slice();
      if (D.city?.length === D.N * D.N) input.city = D.city.slice();
      const cn = D.coarse?.n;
      if (D.forest && cn && D.forest.length === cn * cn) input.forest = { n: cn, step: D.coarse.step, half, data: D.forest.slice() };
    } else {
      // no terrain data: sample the public height function on a 4 m grid
      const getH = typeof world.getHeightAt === 'function' ? world.getHeightAt : () => 0;
      const n = 601;
      const step = (2 * E) / (n - 1);
      const heights = new Float32Array(n * n);
      for (let j = 0; j < n; j++) {
        const z = -E + j * step;
        for (let i = 0; i < n; i++) {
          const h = getH(-E + i * step, z);
          heights[j * n + i] = Number.isFinite(h) ? h : 0;
        }
        if ((j & 31) === 31) await yieldToMain();
      }
      input.grid = { n, step, half: E, heights };
    }

    input.river = this._riverGrid(world);
    input.trees = this._trees(world);
    return input;
  }

  /** River water-surface heights on a 4 m grid around the river polylines. */
  _riverGrid(world) {
    if (typeof world.getWaterHeightAt !== 'function' || !RIVERS?.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const r of RIVERS) {
      for (const [x, z] of r.points) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    const pad = 40;
    const step = 4;
    const x0 = minX - pad;
    const z0 = minZ - pad;
    const n = Math.ceil((maxX - minX + 2 * pad) / step) + 1;
    const m = Math.ceil((maxZ - minZ + 2 * pad) / step) + 1;
    const data = new Float32Array(n * m).fill(NaN);
    try {
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) {
          const x = x0 + i * step;
          const z = z0 + j * step;
          const w = world.getWaterHeightAt(x, z);
          if (w != null && w > 0.3) data[j * n + i] = w;
        }
      }
    } catch {
      return null;
    }
    return { n, m, step, x0, z0, data };
  }

  /** Every tree and bush as [x, z, crownR, kind, height]. */
  _trees(world) {
    const layers = world.vegetation?.layers;
    if (!layers) return null;
    const list = [];
    for (const [name, layer] of Object.entries(layers)) {
      const meta = layer?.meta || {};
      const kind = treeKind(name, meta.kind);
      if (kind == null || typeof layer.forEach !== 'function') continue;
      const crown = meta.crownR || 2.5;
      const height = meta.height || 8;
      try {
        layer.forEach((i, x, z, m, o) => {
          const s = Math.hypot(m[o], m[o + 1], m[o + 2]) || 1;
          const sy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]) || 1;
          list.push(x, z, crown * s, kind, height * sy);
        });
      } catch {
        /* layer API changed: skip it */
      }
    }
    return list.length ? Float32Array.from(list) : null;
  }

  // ------------------------------------------------------------------ worker
  _bakeInWorker(input) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(new URL('./mapWorker.js', import.meta.url), { type: 'module' });
      } catch (err) {
        reject(err);
        return;
      }
      const done = () => worker.terminate();
      worker.onmessage = (e) => {
        done();
        if (e.data?.ok && e.data.pixels?.length === this.size * this.size * 4) {
          this.stats = { ...(this.stats || {}), bakeMs: e.data.ms };
          resolve(e.data.pixels);
        } else reject(new Error(e.data?.error || 'map worker failed'));
      };
      worker.onerror = (e) => {
        done();
        e.preventDefault?.();
        reject(new Error(e.message || 'map worker error'));
      };
      const transfer = [];
      const add = (a) => a?.buffer && !transfer.includes(a.buffer) && transfer.push(a.buffer);
      add(input.grid.heights);
      add(input.splatA);
      add(input.splatB);
      add(input.normal);
      add(input.city);
      add(input.forest?.data);
      add(input.river?.data);
      add(input.trees);
      try {
        worker.postMessage(input, transfer);
      } catch (err) {
        done();
        reject(err);
      }
    });
  }

  // ---------------------------------------------------------------- overlays
  /** Roads, landmark grounds, buildings (+ shadows), glows and waterfalls. */
  _drawOverlays(g, S) {
    const ctx = this.ctx;
    const k = S / (2 * MAP_EXTENT); // px per metre
    const mx = (v) => (v + MAP_EXTENT) * k;
    const getH = typeof ctx.world?.getHeightAt === 'function' ? ctx.world.getHeightAt : () => 0;
    const lh = Math.hypot(LIGHT[0], LIGHT[2]);
    const shadowDir = [-LIGHT[0] / lh, -LIGHT[2] / lh];
    const tanEl = LIGHT[1] / lh;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';

    const path = (pts) => {
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(mx(x), mx(z)) : g.moveTo(mx(x), mx(z))));
    };

    // race track through the canyon: a faint dashed loop
    if (RACE_TRACK?.points?.length) {
      g.setLineDash([5, 7]);
      g.strokeStyle = 'rgba(255, 214, 160, 0.28)';
      g.lineWidth = 1.4;
      path(RACE_TRACK.points);
      g.closePath();
      g.stroke();
      g.setLineDash([]);
    }

    // roads: soft dark casing + warm pale surface
    for (const r of ROADS) {
      g.strokeStyle = 'rgba(14, 14, 12, 0.42)';
      g.lineWidth = Math.max(3, r.width * k * 1.35);
      path(r.points);
      g.stroke();
    }
    for (const r of ROADS) {
      g.strokeStyle = 'rgba(214, 200, 172, 0.78)';
      g.lineWidth = Math.max(1.4, r.width * k * 0.72);
      path(r.points);
      g.stroke();
    }

    // plaza: paved circle with rings (Nexus Plaza)
    const pz = ZONES.plaza;
    if (pz) {
      const R = (pz.radius || 78) * k;
      const grad = g.createRadialGradient(mx(pz.x), mx(pz.z), R * 0.2, mx(pz.x), mx(pz.z), R);
      grad.addColorStop(0, 'rgba(176, 168, 156, 0.92)');
      grad.addColorStop(1, 'rgba(140, 134, 124, 0.9)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(mx(pz.x), mx(pz.z), R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(70, 64, 58, 0.45)';
      g.lineWidth = 1;
      for (const f of [0.42, 0.68, 0.94]) {
        g.beginPath();
        g.arc(mx(pz.x), mx(pz.z), R * f, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // spaceport apron + pad rings
    const sp = ZONES.spaceport;
    if (sp?.rect) {
      const r = sp.rect;
      g.fillStyle = 'rgba(118, 120, 124, 0.9)';
      g.fillRect(mx(r.minX), mx(r.minZ), (r.maxX - r.minX) * k, (r.maxZ - r.minZ) * k);
      g.strokeStyle = 'rgba(232, 226, 210, 0.35)';
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeRect(mx(r.minX) + 3, mx(r.minZ) + 3, (r.maxX - r.minX) * k - 6, (r.maxZ - r.minZ) * k - 6);
      g.setLineDash([]);
      for (const [id, p] of Object.entries(sp.pads || {})) {
        if (id === 'colony') continue;
        const rad = 11 * k;
        g.fillStyle = 'rgba(70, 72, 78, 0.95)';
        g.beginPath();
        g.arc(mx(p.x), mx(p.z), rad, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(255, 196, 120, 0.85)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(mx(p.x), mx(p.z), rad * 0.78, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // your base: the build plot outlined in cyan
    const base = ZONES.base;
    if (base?.buildArea) {
      const a = base.buildArea;
      const half = (a.size / 2) * k;
      g.strokeStyle = 'rgba(127, 224, 255, 0.75)';
      g.lineWidth = 1.2;
      g.setLineDash([5, 4]);
      g.strokeRect(mx(a.x) - half, mx(a.z) - half, half * 2, half * 2);
      g.setLineDash([]);
      g.fillStyle = 'rgba(127, 224, 255, 0.08)';
      g.fillRect(mx(a.x) - half, mx(a.z) - half, half * 2, half * 2);
    }

    // buildings from the physics boxes: one shadow layer, then the roofs
    const boxes = this._buildingBoxes(getH);
    if (boxes.length) {
      const sh = document.createElement('canvas');
      sh.width = S;
      sh.height = S;
      const sg = sh.getContext('2d');
      sg.fillStyle = '#000';
      for (const b of boxes) {
        const len = Math.min(b.above, 52) / tanEl;
        const pts = boxCorners(b);
        const moved = pts.map(([x, z]) => [x + shadowDir[0] * len, z + shadowDir[1] * len]);
        const hull = convexHull([...pts, ...moved]);
        sg.beginPath();
        hull.forEach(([x, z], i) => (i ? sg.lineTo(mx(x), mx(z)) : sg.moveTo(mx(x), mx(z))));
        sg.closePath();
        sg.fill();
      }
      g.globalAlpha = 0.42;
      g.drawImage(sh, 0, 0);
      g.globalAlpha = 1;
      sh.width = sh.height = 1;

      boxes.sort((a, b) => a.top - b.top);
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (const b of boxes) {
        const pts = boxCorners(b);
        const tall = b.above > 40;
        const t = Math.min(1, b.above / 120);
        const r = Math.round(98 - 30 * t);
        const gg = Math.round(94 - 18 * t);
        const bb = Math.round(92 + 6 * t);
        g.fillStyle = `rgb(${r}, ${gg}, ${bb})`;
        g.beginPath();
        pts.forEach(([x, z], i) => (i ? g.lineTo(mx(x), mx(z)) : g.moveTo(mx(x), mx(z))));
        g.closePath();
        g.fill();
        // rim light on the edges facing the sun
        g.strokeStyle = tall ? 'rgba(255, 226, 190, 0.55)' : 'rgba(255, 236, 214, 0.32)';
        g.lineWidth = 0.8;
        g.stroke();
        // lit windows / roof lights on taller buildings
        if (b.above > 6 && b.w * b.d > 20) {
          const n = tall ? 5 : 2;
          for (let i = 0; i < n; i++) {
            const u = (rnd() - 0.5) * b.w * 0.7;
            const v = (rnd() - 0.5) * b.d * 0.7;
            const c = Math.cos(b.rotY);
            const s = Math.sin(b.rotY);
            const x = b.x + u * c + v * s;
            const z = b.z - u * s + v * c;
            g.fillStyle = rnd() < 0.72 ? 'rgba(255, 210, 150, 0.9)' : 'rgba(150, 228, 255, 0.9)';
            g.fillRect(mx(x) - 0.6, mx(z) - 0.6, 1.3, 1.3);
          }
        }
      }
    }

    // soft city glow over the islands
    g.globalCompositeOperation = 'screen';
    for (const isl of CITY_ISLANDS) {
      const grad = g.createRadialGradient(mx(isl.x), mx(isl.z), 0, mx(isl.x), mx(isl.z), isl.radius * k * 1.25);
      grad.addColorStop(0, 'rgba(255, 176, 104, 0.2)');
      grad.addColorStop(1, 'rgba(255, 176, 104, 0)');
      g.fillStyle = grad;
      g.fillRect(mx(isl.x - isl.radius * 1.3), mx(isl.z - isl.radius * 1.3), isl.radius * k * 2.6, isl.radius * k * 2.6);
    }
    // the violet Levensboom on the plaza
    if (pz?.tree) {
      const t = pz.tree;
      const R = (t.canopyRadius || 22) * k;
      const grad = g.createRadialGradient(mx(t.x), mx(t.z), 0, mx(t.x), mx(t.z), R * 2.2);
      grad.addColorStop(0, 'rgba(196, 140, 255, 0.85)');
      grad.addColorStop(0.45, 'rgba(150, 96, 240, 0.45)');
      grad.addColorStop(1, 'rgba(120, 70, 220, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(mx(t.x), mx(t.z), R * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    // the signal beacon on the shore
    const beacon = ctx.landmarks?.beacon?.position;
    const sig = beacon && Number.isFinite(beacon.x) ? beacon : ZONES.signal;
    if (sig) {
      const grad = g.createRadialGradient(mx(sig.x), mx(sig.z), 0, mx(sig.x), mx(sig.z), 26 * k);
      grad.addColorStop(0, 'rgba(140, 220, 255, 0.9)');
      grad.addColorStop(1, 'rgba(90, 170, 255, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(mx(sig.x), mx(sig.z), 26 * k, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    if (pz?.tree) {
      const t = pz.tree;
      const R = (t.canopyRadius || 22) * k;
      g.fillStyle = 'rgba(132, 86, 214, 0.92)';
      g.beginPath();
      g.arc(mx(t.x), mx(t.z), R, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(214, 180, 255, 0.55)';
      g.beginPath();
      g.arc(mx(t.x) + R * 0.22, mx(t.z) - R * 0.25, R * 0.55, 0, Math.PI * 2);
      g.fill();
    }

    // waterfalls: foaming streaks from the lip down to the plunge pool
    for (const w of WATERFALLS || []) {
      const dx = w.bottom.x - w.lip.x;
      const dz = w.bottom.z - w.lip.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len;
      const pzz = dx / len;
      const half = (w.width || 12) / 2;
      for (let i = 0; i < 6; i++) {
        const o = (i / 5 - 0.5) * 2 * half;
        g.strokeStyle = `rgba(236, 244, 246, ${0.45 + 0.4 * ((i * 37) % 5) / 5})`;
        g.lineWidth = Math.max(0.8, k * 1.6);
        g.beginPath();
        g.moveTo(mx(w.lip.x + px * o), mx(w.lip.z + pzz * o));
        g.lineTo(mx(w.bottom.x + px * o * 1.2), mx(w.bottom.z + pzz * o * 1.2));
        g.stroke();
      }
      const grad = g.createRadialGradient(mx(w.bottom.x), mx(w.bottom.z), 0, mx(w.bottom.x), mx(w.bottom.z), half * 2.2 * k);
      grad.addColorStop(0, 'rgba(240, 248, 250, 0.75)');
      grad.addColorStop(1, 'rgba(240, 248, 250, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(mx(w.bottom.x), mx(w.bottom.z), half * 2.2 * k, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** Solid landmark / structure boxes that rise clearly above the ground. */
  _buildingBoxes(getH) {
    const out = [];
    const boxes = this.ctx.physics?.boxes;
    if (!boxes?.values) return out;
    for (const b of boxes.values()) {
      if (!b || !b.solid || b.tag === 'terrain-tree' || b.tag === 'terrain-rock') continue;
      if (!(b.w > 0.6 && b.d > 0.6) || b.w * b.d > 40000) continue;
      const ground = Math.max(0, getH(b.x, b.z) || 0);
      const top = b.y + b.h / 2;
      const above = top - ground;
      if (above < 2.4) continue;
      out.push({ x: b.x, z: b.z, w: b.w, d: b.d, rotY: b.rotY || 0, top, above });
    }
    return out;
  }
}

/** Footprint corners of an oriented box (three.js rotation about +Y). */
function boxCorners(b) {
  const c = Math.cos(b.rotY);
  const s = Math.sin(b.rotY);
  const hw = b.w / 2;
  const hd = b.d / 2;
  const pts = [];
  for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) pts.push([b.x + u * c + v * s, b.z - u * s + v * c]);
  return pts;
}

/** Convex hull (monotone chain) of a few 2D points. */
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
