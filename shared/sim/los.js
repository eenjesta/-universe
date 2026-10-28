/**
 * Coarse terrain line-of-sight: ray-march the segment A→B over the height
 * field (≤ 64 samples, ≥ 2 m apart); blocked when a sample is more than
 * `margin` below the ground. Endpoints are skipped (feet / muzzle on the ground).
 */
export function terrainLOS(H, ax, ay, az, bx, by, bz, margin = 0.3) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1.5) return true;
  const n = Math.min(64, Math.max(2, Math.ceil(len / 2)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = ax + dx * t;
    const z = az + dz * t;
    if (ay + dy * t < H(x, z) - margin) return false;
  }
  return true;
}

// ------------------------------------------------------------ POI cover (structures the sim can see)
/**
 * Cover boxes of a POI model, mirroring the frontier's builders (src/frontier/models.js: same seed + same
 * random call order → same huts, palisade panels, crates and barrels; verified against the model's colliders in
 * src/combat/cover.test.js). Pirate outposts: huts, the watchtower platform, the scrap palisade ring and the crates
 * / barrels (low cover); crash sites: the hull; De Wachter's arena: its monoliths. Ø ruins: none (drones fly over them).
 * Local boxes [cx, cy, cz, hx, hy, hz, rotY] (half extents, y from the pad, front = −Z).
 */
function frontierRng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** De Wachter's arena monoliths (local to BOSS.site): [angle, radius, height, width, depth] — the client draws the same. */
export const ARENA_MONOLITHS = [
  [0.2, 30, 9.5, 2.8, 2.2],
  [0.95, 33, 4.6, 3.0, 2.4],
  [1.75, 29, 11, 2.6, 2.2],
  [2.5, 32, 6.2, 3.2, 2.4],
  [3.3, 30.5, 3.4, 3.4, 2.6],
  [4.0, 31, 10.2, 2.8, 2.2],
  [4.75, 29.5, 5.4, 3.0, 2.4],
  [5.5, 32.5, 8.4, 2.6, 2.2],
];
const LOCAL = new Map();
export function poiCoverLocal(type, variant = 0) {
  const key = `${type}:${variant}`;
  let out = LOCAL.get(key);
  if (out) return out;
  out = [];
  const R = frontierRng(1000 + variant * 77 + String(type).length * 13);
  if (type === 'outpost') {
    const huts = 2 + (variant % 2);
    for (let i = 0; i < huts; i++) {
      const a = (i / huts) * Math.PI * 2 + 0.5 + variant;
      const w = 5 + R() * 2;
      const d = 4 + R() * 1.5;
      out.push([Math.sin(a) * 9, 1.85, Math.cos(a) * 9, w / 2, 1.85, d / 2, a + Math.PI]); // 3.2 m walls + roof
    }
    out.push([variant === 2 ? -6 : 6, 10.6, -6, 2.1, 0.6, 2.1, 0]); // watchtower platform + rails
    const pr = 17 + variant * 2;
    for (let i = 0; i < 26; i++) {
      if (R() < 0.22 || (i > 11 && i < 14)) continue; // gaps + the gate
      const a = (i / 26) * Math.PI * 2;
      const h = 2.4 + R() * 1.4;
      R(); // colour
      R(); // tilt x
      R(); // tilt z
      out.push([Math.sin(a) * pr, h / 2 - 0.2, -Math.cos(a) * pr, 2.1, h / 2, 0.12, -a]);
    }
    for (let i = 0; i < 8; i++) {
      const a = R() * Math.PI * 2;
      const r = 3 + R() * 9;
      if (R() < 0.5) out.push([Math.sin(a) * r, 0.6, Math.cos(a) * r, 0.6, 0.6, 0.6, R() * 3]); // crate
      else out.push([Math.sin(a) * r, 0.55, Math.cos(a) * r, 0.45, 0.55, 0.45, 0]); // barrel
    }
  } else if (type === 'wreck') {
    out.push([0, 2, 0, 3.5, 2.5, ((30 + variant * 6) * 0.95) / 2, 0]);
  } else if (type === 'arena') {
    // De Wachter's rest: a broken ring of Ø monoliths around the plinth — cover from the eye beam
    for (const m of ARENA_MONOLITHS) out.push([Math.sin(m[0]) * m[1], m[2] / 2, Math.cos(m[0]) * m[1], m[3] / 2, m[2] / 2, m[4] / 2, m[0]]);
  }
  LOCAL.set(key, out);
  return out;
}

/**
 * World-space cover boxes of a POI {type, variant, x, y, z, rot} → Float64Array [x, y, z, hx, hy, hz, cos, sin] × n.
 * POI models sit on their flattened pad (y); the arena's monoliths stand on the natural ground: pass
 * `groundAt(x, z)` (each monolith is sunk 0.4 m into it).
 */
export function poiCover(poi, groundAt = null) {
  const L = poiCoverLocal(poi.type, poi.variant | 0);
  const out = new Float64Array(L.length * 8);
  const c = Math.cos(poi.rot || 0);
  const s = Math.sin(poi.rot || 0);
  const y0 = (Number.isFinite(poi.y) ? poi.y : 0) - 0.05;
  const own = poi.type === 'arena' && typeof groundAt === 'function';
  for (let i = 0; i < L.length; i++) {
    const [lx, ly, lz, hx, hy, hz, ry] = L[i];
    const k = i * 8;
    out[k] = poi.x + lx * c + lz * s;
    out[k + 2] = poi.z - lx * s + lz * c;
    out[k + 1] = (own ? groundAt(out[k], out[k + 2]) - 0.4 : y0) + ly;
    out[k + 3] = hx;
    out[k + 4] = hy;
    out[k + 5] = hz;
    const r = (poi.rot || 0) + ry;
    out[k + 6] = Math.cos(r);
    out[k + 7] = Math.sin(r);
  }
  return out;
}

/**
 * First cover box hit by the segment A→B: returns t ∈ (0, 1) or -1. Boxes that contain an endpoint are
 * ignored (someone standing inside a hut is not hidden by it); hits closer than `skip` metres to either
 * end are ignored too (a muzzle pressed against a crate).
 */
export function segCover(ax, ay, az, bx, by, bz, boxes, skip = 0.15) {
  const n = boxes.length / 8;
  const len = Math.hypot(bx - ax, by - ay, bz - az) || 1;
  const e0 = skip / len;
  let best = -1;
  for (let i = 0; i < n; i++) {
    const k = i * 8;
    const cx = boxes[k];
    const cz = boxes[k + 2];
    const hx = boxes[k + 3];
    const hz = boxes[k + 5];
    const rr = hx > hz ? hx : hz;
    // cheap reject: the segment's bounding box vs the box's footprint circle
    if (Math.min(ax, bx) > cx + rr || Math.max(ax, bx) < cx - rr || Math.min(az, bz) > cz + rr || Math.max(az, bz) < cz - rr) continue;
    const cy = boxes[k + 1];
    const hy = boxes[k + 4];
    const c = boxes[k + 6];
    const s = boxes[k + 7];
    // into the box frame (inverse of the Y rotation)
    const adx = ax - cx;
    const adz = az - cz;
    const bdx = bx - cx;
    const bdz = bz - cz;
    const p0x = adx * c - adz * s;
    const p0z = adx * s + adz * c;
    const p1x = bdx * c - bdz * s;
    const p1z = bdx * s + bdz * c;
    const p0y = ay - cy;
    const p1y = by - cy;
    if ((Math.abs(p0x) <= hx && Math.abs(p0y) <= hy && Math.abs(p0z) <= hz) || (Math.abs(p1x) <= hx && Math.abs(p1y) <= hy && Math.abs(p1z) <= hz)) continue;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (let axis = 0; axis < 3 && ok; axis++) {
      const o = axis === 0 ? p0x : axis === 1 ? p0y : p0z;
      const d = (axis === 0 ? p1x : axis === 1 ? p1y : p1z) - o;
      const h = axis === 0 ? hx : axis === 1 ? hy : hz;
      if (Math.abs(d) < 1e-9) {
        if (o < -h || o > h) ok = false;
        continue;
      }
      let ta = (-h - o) / d;
      let tb = (h - o) / d;
      if (ta > tb) {
        const tmp = ta;
        ta = tb;
        tb = tmp;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) ok = false;
    }
    if (!ok || t0 <= e0 || t0 >= 1 - e0) continue;
    if (best < 0 || t0 < best) best = t0;
  }
  return best;
}
