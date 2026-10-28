/**
 * Minimap / world-map layer for the procedural area:
 *   draw(ctx2d, centerX, centerZ, metersPerPixel, { rotate = 0, rules = false, pois = true, hole = hubExtent })
 *     → { missing } (tiles of this view still on their way)
 * `rules: true` adds the §11.2 no-build zones (hub buffer ring, 40 m highway corridors, POI
 * clearance circles) and the outline of the 16 m height-limit zone (hubDist < 2000 m).
 * Paints the planet in the hub map's art style (mapTile.js + src/shell/map/mapStyle.js: relief light,
 * cast shadows, water, beaches, canopies, grade; tiles of 128 px rendered by a dedicated map worker,
 * cached LRU), the highways styled like the hub's roads, waystones and (pois: true) POI markers, north up
 * (−Z), everywhere outside the square |x|, |z| < `hole` (the hub's own map is in charge there; the shell
 * passes a hole a little smaller than the hub image and feathers the image's edge over the planet layer,
 * so the two cross-fade instead of meeting at a hard seam). Missing tiles are requested and drawn from a
 * coarser cached zoom meanwhile.
 */
import { mapTile } from './mapTile.js';

const PX = 128;
const ZOOMS = [2, 4, 8, 16, 32, 128]; // metres per tile pixel
const MAX_VIEW_TILES = 72; // a view never waits for more tiles than this (coarser zoom instead)
const POI_COLOURS = { ruin: '#5ff2ff', outpost: '#ff6a3d', wreck: '#ffd25a' };
const MAX_IN_FLIGHT = 2; // per map worker
// highways in the hub map's road style (src/shell/map/mapImage.js: dark casing + warm pale surface)
const ROAD_CASING = 'rgba(14, 14, 12, 0.42)';
const ROAD_SURFACE = 'rgba(214, 200, 172, 0.78)';

export function createFrontierMinimap({ worker, worldgen, hubExtent = 1200 }) {
  const cache = new Map(); // key → { canvas, used }
  const pending = new Map(); // job id → key
  const pendingKeys = new Set();
  let seq = 1;
  let frame = 0;
  // dedicated map workers (map tiles never wait behind terrain jobs)
  const pool = [];
  const load = new Map(); // job id → worker
  const local = []; // main-thread fallback queue
  const roadBounds = new WeakMap();

  if (typeof Worker !== 'undefined' && typeof document !== 'undefined') {
    try {
      const data = worldgen.exportForWorker();
      const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
      for (let n = 0; n < (cores >= 4 ? 2 : 1); n++) {
        const w = new Worker(new URL('./mapWorker.js', import.meta.url), { type: 'module', name: `frontier-map-${n}` });
        w.jobs = 0;
        w.onmessage = (e) => {
          const m = e.data;
          if (m?.type !== 'map' && m?.type !== 'error') return;
          if (load.get(m.id) === w) w.jobs--;
          load.delete(m.id);
          if (m.type === 'map') receive(m);
          else {
            console.warn('[frontier] map tile failed', m.error);
            pendingKeys.delete(pending.get(m.id));
            pending.delete(m.id);
          }
        };
        w.onerror = (err) => console.warn('[frontier] map worker error', err?.message || err);
        w.postMessage({ type: 'init', data });
        pool.push(w);
      }
    } catch (err) {
      console.warn('[frontier] map worker unavailable — map tiles on the main thread', err);
      for (const w of pool) w.terminate();
      pool.length = 0;
    }
  }
  void worker; // the shared terrain worker is no longer used for map tiles

  const keyOf = (z, i, j) => `${z}:${i}:${j}`;

  function request(z, i, j) {
    const k = keyOf(z, i, j);
    if (cache.has(k) || pendingKeys.has(k)) return true;
    if (pending.size >= MAX_IN_FLIGHT * Math.max(1, pool.length)) return false;
    const id = seq++;
    pending.set(id, k);
    pendingKeys.add(k);
    const size = PX * ZOOMS[z];
    const job = { type: 'map', id, x0: i * size, z0: j * size, size, px: PX };
    if (pool.length) {
      let w = pool[0];
      for (const x of pool) if (x.jobs < w.jobs) w = x;
      w.jobs++;
      load.set(id, w);
      w.postMessage(job);
    } else local.push(job);
    return true;
  }

  /** Main-thread fallback: one tile per draw call. */
  function pumpLocal() {
    const job = local.shift();
    if (!job) return;
    try {
      receive({ type: 'map', id: job.id, rgba: mapTile(worldgen, job) });
    } catch (err) {
      console.warn('[frontier] map tile failed', err);
      pendingKeys.delete(pending.get(job.id));
      pending.delete(job.id);
    }
  }

  function receive(msg) {
    const k = pending.get(msg.id);
    if (!k) return;
    pending.delete(msg.id);
    pendingKeys.delete(k);
    if (typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = c.height = PX;
    c.getContext('2d').putImageData(new ImageData(msg.rgba, PX, PX), 0, 0);
    cache.set(k, { canvas: c, used: frame });
    if (cache.size > 360) {
      let oldest = null;
      for (const [kk, v] of cache) if (!oldest || v.used < oldest[1].used) oldest = [kk, v];
      if (oldest) cache.delete(oldest[0]);
    }
  }

  function draw(g, cx, cz, mpp, opts = {}) {
    frame++;
    if (!pool.length) pumpLocal();
    const W = g.canvas.width;
    const H = g.canvas.height;
    const hole = Number.isFinite(opts.hole) ? opts.hole : hubExtent;
    // view bounds (a rotated view needs the whole circumscribed square)
    const span = opts.rotate ? Math.hypot(W, H) / 2 : 0;
    const hw = (opts.rotate ? span : W / 2) * mpp;
    const hh = (opts.rotate ? span : H / 2) * mpp;
    // tile zoom: about the canvas resolution (≤ 1.25× magnified), but never more than MAX_VIEW_TILES tiles
    let zi = 0;
    while (zi < ZOOMS.length - 1 && ZOOMS[zi] * 1.25 < mpp) zi++;
    while (zi < ZOOMS.length - 1 && (Math.ceil((2 * hw) / (PX * ZOOMS[zi])) + 1) * (Math.ceil((2 * hh) / (PX * ZOOMS[zi])) + 1) > MAX_VIEW_TILES) zi++;
    const tileM = PX * ZOOMS[zi];
    const x0 = cx - hw;
    const z0 = cz - hh;
    const x1 = cx + hw;
    const z1 = cz + hh;
    const sx = (x) => (x - cx) / mpp + W / 2;
    const sz = (z) => (z - cz) / mpp + H / 2;
    let missing = 0;
    const want = [];
    g.save();
    if (opts.rotate) {
      g.translate(W / 2, H / 2);
      g.rotate(opts.rotate);
      g.translate(-W / 2, -H / 2);
    }
    // clip: everything except the hub's square
    if (hole > 0) {
      g.beginPath();
      g.rect(-W * 2, -H * 2, W * 5, H * 5);
      g.rect(sx(-hole), sz(hole), (2 * hole) / mpp, (-2 * hole) / mpp);
      g.clip('evenodd');
    }
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    // integer-aligned tile rectangles (no hairline gaps between neighbours)
    const ex = (x) => Math.round(sx(x));
    const ez = (z) => Math.round(sz(z));
    for (let j = Math.floor(z0 / tileM); j <= Math.floor(z1 / tileM); j++) {
      for (let i = Math.floor(x0 / tileM); i <= Math.floor(x1 / tileM); i++) {
        const tx = i * tileM;
        const tz = j * tileM;
        if (hole > 0 && tx >= -hole && tx + tileM <= hole && tz >= -hole && tz + tileM <= hole) continue;
        const dx = ex(tx);
        const dz = ez(tz);
        const dw = ex(tx + tileM) - dx;
        const dh = ez(tz + tileM) - dz;
        const t = cache.get(keyOf(zi, i, j));
        if (t) {
          t.used = frame;
          g.drawImage(t.canvas, dx, dz, dw, dh);
          continue;
        }
        missing++;
        want.push(i, j, (tx + tileM / 2 - cx) ** 2 + (tz + tileM / 2 - cz) ** 2);
        // coarser fallback
        let drawn = false;
        for (let z2 = zi + 1; z2 < ZOOMS.length && !drawn; z2++) {
          const m2 = PX * ZOOMS[z2];
          const i2 = Math.floor(tx / m2);
          const j2 = Math.floor(tz / m2);
          const t2 = cache.get(keyOf(z2, i2, j2));
          if (!t2) continue;
          t2.used = frame;
          const f = PX / (m2 / tileM);
          const ox = ((tx - i2 * m2) / m2) * PX;
          const oz = ((tz - j2 * m2) / m2) * PX;
          g.drawImage(t2.canvas, ox, oz, f, f, dx, dz, dw, dh);
          drawn = true;
        }
        if (!drawn) {
          g.fillStyle = '#4a5a3c';
          g.fillRect(dx, dz, dw, dh);
        }
      }
    }
    // request the missing tiles nearest to the view centre first
    if (want.length) {
      const order = [];
      for (let k = 0; k < want.length; k += 3) order.push(k);
      order.sort((a, b) => want[a + 2] - want[b + 2]);
      for (const k of order) if (!request(zi, want[k], want[k + 1])) break;
    }
    if (opts.rules) drawRules(g, sx, sz, mpp, cx, cz, Math.hypot(W, H) * 0.5 * mpp);
    // highways: the hub map's road style (dark casing + warm pale surface), never thinner than a hairline
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const every = 3 * Math.max(1, Math.round(mpp / 4));
    const path = (p) => {
      g.beginPath();
      for (let k = 0; k < p.length; k += every) {
        if (k === 0) g.moveTo(sx(p[k]), sz(p[k + 2]));
        else g.lineTo(sx(p[k]), sz(p[k + 2]));
      }
      g.lineTo(sx(p[p.length - 3]), sz(p[p.length - 1]));
    };
    const visible = (r) => {
      let b = roadBounds.get(r);
      if (!b) roadBounds.set(r, (b = boundsOf(r.points)));
      return !(b[2] < x0 || b[0] > x1 || b[3] < z0 || b[1] > z1);
    };
    const roadW = worldgen.highwayWidth || 10;
    g.strokeStyle = ROAD_CASING;
    g.lineWidth = Math.max(2.6, (roadW * 1.35) / mpp);
    for (const r of worldgen.highways) if (visible(r)) (path(r.points), g.stroke());
    g.strokeStyle = ROAD_SURFACE;
    g.lineWidth = Math.max(1.4, (roadW * 0.72) / mpp);
    for (const r of worldgen.highways) if (visible(r)) (path(r.points), g.stroke());
    g.fillStyle = '#5ff2ff';
    for (const r of worldgen.highways) {
      for (const w of r.waystones) {
        if (w.x < x0 || w.x > x1 || w.z < z0 || w.z > z1) continue;
        g.fillRect(sx(w.x) - 1.5, sz(w.z) - 1.5, 3, 3);
      }
    }
    // POIs (the shell draws its own typed / "?" markers and passes pois: false)
    if (opts.pois !== false) {
      const R = Math.hypot(W, H) * 0.5 * mpp;
      for (const p of worldgen.poisNear(cx, cz, R)) {
        const x = sx(p.x);
        const y = sz(p.z);
        if (x < -8 || y < -8 || x > W + 8 || y > H + 8) continue;
        g.fillStyle = POI_COLOURS[p.type] || '#fff';
        g.strokeStyle = 'rgba(10, 12, 16, 0.85)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x, y - 5);
        g.lineTo(x + 5, y);
        g.lineTo(x, y + 5);
        g.lineTo(x - 5, y);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    g.restore();
    return { missing };
  }

  /** §11.2 static build rules (the same numbers as worldgen.isBuildable). */
  function drawRules(g, sx, sz, mpp, cx, cz, R) {
    const H = worldgen.hub;
    g.save();
    if (H.present) {
      const a = H.radius;
      const b = H.radius + H.noBuild;
      g.fillStyle = 'rgba(255, 128, 32, 0.32)';
      g.beginPath();
      g.rect(sx(-b), sz(-b), (2 * b) / mpp, (2 * b) / mpp);
      g.rect(sx(-a), sz(a), (2 * a) / mpp, (-2 * a) / mpp);
      g.fill('evenodd');
      const c = H.radius + 2000;
      g.strokeStyle = 'rgba(255, 220, 120, 0.75)';
      g.setLineDash([6, 5]);
      g.lineWidth = 1.2;
      g.strokeRect(sx(-c), sz(-c), (2 * c) / mpp, (2 * c) / mpp);
      g.setLineDash([]);
    }
    g.strokeStyle = 'rgba(255, 40, 48, 0.42)';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, (2 * worldgen.highwayClear) / mpp);
    for (const r of worldgen.highways) {
      const p = r.points;
      g.beginPath();
      for (let k = 0; k < p.length; k += 3 * Math.max(1, Math.round(mpp / 4))) {
        if (k === 0) g.moveTo(sx(p[k]), sz(p[k + 2]));
        else g.lineTo(sx(p[k]), sz(p[k + 2]));
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(184, 72, 255, 0.35)';
    for (const p of worldgen.poisNear(cx, cz, R + 200)) {
      g.beginPath();
      g.arc(sx(p.x), sz(p.z), Math.max(3, (p.radius + worldgen.poiClear) / mpp), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  return {
    draw,
    receive,
    /** Debug: cached tiles, jobs in flight, whether a dedicated worker paints them. */
    stats: () => ({ cached: cache.size, pending: pending.size, workers: pool.length, local: local.length }),
    /** Number of cached tiles (debug). */
    get size() {
      return cache.size;
    },
    dispose() {
      cache.clear();
      pending.clear();
      pendingKeys.clear();
      local.length = 0;
      for (const w of pool) w.terminate();
      pool.length = 0;
    },
  };
}

function boundsOf(p) {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (let k = 0; k < p.length; k += 3) {
    if (p[k] < a) a = p[k];
    if (p[k] > c) c = p[k];
    if (p[k + 2] < b) b = p[k + 2];
    if (p[k + 2] > d) d = p[k + 2];
  }
  return [a - 50, b - 50, c + 50, d + 50];
}
