/**
 * Minimap / world-map layer for the procedural area:
 *   draw(ctx2d, centerX, centerZ, metersPerPixel, { rotate = 0, rules = false })
 * `rules: true` adds the §11.2 no-build zones (hub buffer ring, 40 m highway corridors, POI
 * clearance circles) and the outline of the 16 m height-limit zone (hubDist < 2000 m).
 * paints top-down biome colours + hill shading (tiles of 128 px rendered by the
 * terrain worker, cached LRU), the highways, waystones and POI markers, north up
 * (−Z), everywhere OUTSIDE the hub square (the hub's own minimap stays in charge
 * there). Missing tiles are requested and drawn from a coarser cached zoom.
 */
const PX = 128;
const ZOOMS = [2, 8, 32, 128]; // metres per tile pixel
const POI_COLOURS = { ruin: '#5ff2ff', outpost: '#ff6a3d', wreck: '#ffd25a' };

export function createFrontierMinimap({ worker, worldgen, hubExtent = 1200 }) {
  const cache = new Map(); // key → { canvas, used }
  const pending = new Map(); // job id → key
  let seq = 1;
  let frame = 0;

  const keyOf = (z, i, j) => `${z}:${i}:${j}`;

  function request(z, i, j) {
    const k = keyOf(z, i, j);
    if (cache.has(k) || [...pending.values()].includes(k)) return;
    if (worker.capacity('map') <= 0) return;
    const id = seq++;
    pending.set(id, k);
    const size = PX * ZOOMS[z];
    worker.send('map', { type: 'map', id, x0: i * size, z0: j * size, size, px: PX });
  }

  function receive(msg) {
    const k = pending.get(msg.id);
    if (!k) return;
    pending.delete(msg.id);
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
    const W = g.canvas.width;
    const H = g.canvas.height;
    let zi = 0;
    while (zi < ZOOMS.length - 1 && ZOOMS[zi] * 1.5 < mpp) zi++;
    const tileM = PX * ZOOMS[zi];
    const x0 = cx - (W / 2) * mpp;
    const z0 = cz - (H / 2) * mpp;
    const x1 = cx + (W / 2) * mpp;
    const z1 = cz + (H / 2) * mpp;
    const sx = (x) => (x - cx) / mpp + W / 2;
    const sz = (z) => (z - cz) / mpp + H / 2;
    g.save();
    if (opts.rotate) {
      g.translate(W / 2, H / 2);
      g.rotate(opts.rotate);
      g.translate(-W / 2, -H / 2);
    }
    // clip: everything except the hub square
    g.beginPath();
    g.rect(-W, -H, W * 3, H * 3);
    if (hubExtent > 0) g.rect(sx(-hubExtent), sz(hubExtent), (2 * hubExtent) / mpp, (-2 * hubExtent) / mpp);
    g.clip('evenodd');
    g.imageSmoothingEnabled = true;
    for (let j = Math.floor(z0 / tileM); j <= Math.floor(z1 / tileM); j++) {
      for (let i = Math.floor(x0 / tileM); i <= Math.floor(x1 / tileM); i++) {
        const tx = i * tileM;
        const tz = j * tileM;
        if (hubExtent > 0 && tx >= -hubExtent && tx + tileM <= hubExtent && tz >= -hubExtent && tz + tileM <= hubExtent) continue;
        const dx = sx(tx);
        const dz = sz(tz);
        const dw = tileM / mpp;
        let t = cache.get(keyOf(zi, i, j));
        if (t) {
          t.used = frame;
          g.drawImage(t.canvas, dx, dz, dw + 0.5, dw + 0.5);
          continue;
        }
        request(zi, i, j);
        // coarser fallback
        let drawn = false;
        for (let z2 = zi + 1; z2 < ZOOMS.length && !drawn; z2++) {
          const m2 = PX * ZOOMS[z2];
          const i2 = Math.floor(tx / m2);
          const j2 = Math.floor(tz / m2);
          const t2 = cache.get(keyOf(z2, i2, j2));
          if (!t2) continue;
          const f = PX / (m2 / tileM);
          const ox = ((tx - i2 * m2) / m2) * PX;
          const oz = ((tz - j2 * m2) / m2) * PX;
          g.drawImage(t2.canvas, ox, oz, f, f, dx, dz, dw + 0.5, dw + 0.5);
          drawn = true;
        }
        if (!drawn) {
          g.fillStyle = '#3c4a3a';
          g.fillRect(dx, dz, dw + 0.5, dw + 0.5);
        }
      }
    }
    if (opts.rules) drawRules(g, sx, sz, mpp, cx, cz, Math.hypot(W, H) * 0.5 * mpp);
    // highways
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(236, 226, 205, 0.9)';
    g.lineWidth = Math.max(1.5, 10 / mpp);
    for (const r of worldgen.highways) {
      const p = r.points;
      g.beginPath();
      for (let k = 0; k < p.length; k += 3 * Math.max(1, Math.round(mpp / 4))) {
        if (k === 0) g.moveTo(sx(p[k]), sz(p[k + 2]));
        else g.lineTo(sx(p[k]), sz(p[k + 2]));
      }
      g.lineTo(sx(p[p.length - 3]), sz(p[p.length - 1]));
      g.stroke();
      g.fillStyle = '#5ff2ff';
      for (const w of r.waystones) {
        if (w.x < x0 || w.x > x1 || w.z < z0 || w.z > z1) continue;
        g.fillRect(sx(w.x) - 1.5, sz(w.z) - 1.5, 3, 3);
      }
    }
    // POIs
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
    g.restore();
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
    /** Number of cached tiles (debug). */
    get size() {
      return cache.size;
    },
    dispose() {
      cache.clear();
      pending.clear();
    },
  };
}
