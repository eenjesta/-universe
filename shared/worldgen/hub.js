import { sstep, mix } from './noise.js';

/**
 * The seam between the hand-made hub and the procedural planet (PLATFORM.md §11).
 *
 * The hub heightfield exists for |x|, |z| ≤ `extent` (1200 m: the hub terrain
 * mesh + bake grid). Inside it the combined height IS the hub height, so the
 * hub mesh, its vegetation and roads stay exactly where they are. Beyond it the
 * hub's border profile is extended outward (edge height + outward slope, so the
 * surface is C1 across the seam) and blended into the procedural terrain over
 * `blend` metres with a smoothstep. The safe zone (`radius`, 1100 m) is a rules
 * concept (isSafe / hubDist) and lies inside the hub mesh.
 *
 * The border is sampled once (2 m, exactly the hub grid) from hub.heightAt, so
 * everything beyond `extent` depends only on these arrays: a Web Worker or the
 * server reproduces it bit-for-bit from `exportData()` without the hub function.
 */
const STEP = 2;

export function createHubSeam(hub = {}, opts = {}) {
  const radius = num(hub.radius ?? hub.half ?? opts.radius, 1100);
  const extent = num(hub.extent ?? opts.extent, 1200);
  const blend = num(hub.blend ?? opts.blend, 300);
  const n = Math.round((2 * extent) / STEP) + 1;
  let heightAt = typeof hub.heightAt === 'function' ? hub.heightAt : typeof hub.getHeightAt === 'function' ? hub.getHeightAt : null;
  const isWaterFn = typeof hub.isWater === 'function' ? hub.isWater : null;
  let raw;
  let smooth;
  let grad;
  let coarse = hub.coarse && hub.coarse.data ? { n: hub.coarse.n, step: hub.coarse.step, data: toF32(hub.coarse.data) } : null; // worker-side approximation inside the hub

  if (hub.edge && hub.edge.raw) {
    raw = toF32(hub.edge.raw);
    smooth = toF32(hub.edge.smooth);
    grad = toF32(hub.edge.grad);
  } else if (heightAt) {
    raw = new Float32Array(4 * n);
    const inner = new Float32Array(4 * n);
    const IN = 6; // m inward for the outward slope
    for (let side = 0; side < 4; side++) {
      for (let k = 0; k < n; k++) {
        const s = -extent + k * STEP;
        let x;
        let z;
        let ix;
        let iz;
        if (side === 0) {
          x = s; z = -extent; ix = s; iz = -extent + IN;
        } else if (side === 1) {
          x = s; z = extent; ix = s; iz = extent - IN;
        } else if (side === 2) {
          x = -extent; z = s; ix = -extent + IN; iz = s;
        } else {
          x = extent; z = s; ix = extent - IN; iz = s;
        }
        const h = heightAt(x, z);
        raw[side * n + k] = Number.isFinite(h) ? h : 0;
        const hi = heightAt(ix, iz);
        inner[side * n + k] = Number.isFinite(hi) ? hi : raw[side * n + k];
      }
    }
    smooth = new Float32Array(4 * n);
    grad = new Float32Array(4 * n);
    const tmp = new Float32Array(n);
    const g = new Float32Array(n);
    for (let side = 0; side < 4; side++) {
      const o = side * n;
      for (let k = 0; k < n; k++) tmp[k] = raw[o + k];
      blur(tmp, 14, 3);
      for (let k = 0; k < n; k++) smooth[o + k] = tmp[k];
      for (let k = 0; k < n; k++) {
        let s = (raw[o + k] - inner[o + k]) / IN; // outward slope (m/m)
        s = s < -1.2 ? -1.2 : s > 1.2 ? 1.2 : s;
        g[k] = s;
      }
      blur(g, 10, 2);
      for (let k = 0; k < n; k++) grad[o + k] = g[k];
    }
  } else {
    // no hub data at all: a flat 2 m plateau (tests / tools)
    raw = new Float32Array(4 * n).fill(2);
    smooth = new Float32Array(4 * n).fill(2);
    grad = new Float32Array(4 * n);
  }

  /** Edge sample along `side` at border coordinate s (linear). */
  function edgeAt(arr, side, s) {
    let f = (s + extent) / STEP;
    if (f < 0) f = 0;
    if (f > n - 1.0001) f = n - 1.0001;
    const i = Math.floor(f);
    const t = f - i;
    const o = side * n + i;
    return arr[o] + (arr[o + 1] - arr[o]) * t;
  }

  const L = 90; // m over which the outward slope levels off

  /** Box distance outside the hub mesh (≤ 0 inside). */
  const outside = (x, z) => Math.max(x < 0 ? -x : x, z < 0 ? -z : z) - extent;

  /**
   * Extension of the hub border to a point `e` m outside it (max-norm), C1 at e = 0.
   * Corners use the corner sample with the mean slope of the two sides.
   */
  function extension(x, z, e) {
    const ax = x < 0 ? -x : x;
    const az = z < 0 ? -z : z;
    let r;
    let sm;
    let gr;
    // the side whose border the point is beyond (or on): max-norm region. A point exactly on the
    // east/west border (ax = extent, az < ax) belongs to side X — not to the north/south profile.
    if (ax <= extent && az >= ax) {
      const side = z < 0 ? 0 : 1;
      r = edgeAt(raw, side, x);
      sm = edgeAt(smooth, side, x);
      gr = edgeAt(grad, side, x);
    } else if (az <= extent) {
      const side = x < 0 ? 2 : 3;
      r = edgeAt(raw, side, z);
      sm = edgeAt(smooth, side, z);
      gr = edgeAt(grad, side, z);
    } else {
      // corner quadrant: blend the two sides' corner samples by direction so the
      // field is continuous with both side regions (ax = extent ↔ side Z, az = extent ↔ side X)
      const sx = x < 0 ? -extent : extent;
      const sideZ = z < 0 ? 0 : 1;
      const sideX = x < 0 ? 2 : 3;
      const sz = z < 0 ? -extent : extent;
      const dx = ax - extent;
      const dz = az - extent;
      const wz = dz / (dx + dz);
      r = edgeAt(raw, sideZ, sx);
      sm = wz * edgeAt(smooth, sideZ, sx) + (1 - wz) * edgeAt(smooth, sideX, sz);
      gr = wz * edgeAt(grad, sideZ, sx) + (1 - wz) * edgeAt(grad, sideX, sz);
    }
    const t = e < L ? e / L : 1;
    return mix(r, sm, sstep(0, 50, e)) + gr * L * (t - 0.5 * t * t);
  }

  /** Hub height inside the extent (exact with the hub function, else the coarse grid / edge). */
  function inside(x, z) {
    if (heightAt) return heightAt(x, z);
    // exactly on the border the sampled profile IS the hub grid (crack-free seam in workers)
    if (outside(x, z) > -1e-6) return extension(x, z, 0);
    if (coarse) return sampleCoarse(coarse, x, z, extent);
    const ax = Math.abs(x);
    const az = Math.abs(z);
    return extension(ax >= az ? Math.sign(x) * extent : x, az > ax ? Math.sign(z) * extent : z, 0);
  }


  /** Builds a coarse copy of the hub heights (for workers; ~360 KB at 8 m). */
  function makeCoarse(step = 8) {
    if (!heightAt) return coarse;
    const cn = Math.round((2 * extent) / step) + 1;
    const data = new Float32Array(cn * cn);
    for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) data[j * cn + i] = heightAt(-extent + i * step, -extent + j * step);
    return { n: cn, step, data };
  }

  return {
    radius,
    extent,
    blend,
    hasHub: !!(heightAt || hub.edge),
    exact: !!heightAt,
    isWaterHub: isWaterFn,
    inside,
    outside,
    extension,
    /** Weight of the procedural terrain e m outside the hub mesh. */
    weight: (e) => (e <= 0 ? 0 : e >= blend ? 1 : sstep(0, blend, e)),
    /** Plain data a worker can rebuild the seam from (structured-clone friendly). */
    exportData(withCoarse = true) {
      const out = { radius, extent, blend, edge: { raw, smooth, grad } };
      if (withCoarse) {
        coarse = coarse || makeCoarse(8);
        if (coarse) out.coarse = coarse;
      }
      return out;
    },
    edgeProfile: { raw, smooth, grad, n, step: STEP },
  };
}

function sampleCoarse(c, x, z, extent) {
  let fx = (x + extent) / c.step;
  let fz = (z + extent) / c.step;
  const m = c.n - 1.0001;
  fx = fx < 0 ? 0 : fx > m ? m : fx;
  fz = fz < 0 ? 0 : fz > m ? m : fz;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const k = j * c.n + i;
  const d = c.data;
  return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + c.n] * (1 - tx) + d[k + c.n + 1] * tx) * tz;
}

function blur(a, r, passes) {
  const n = a.length;
  const tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    let acc = 0;
    // running box filter with clamped ends
    for (let k = -r; k <= r; k++) acc += a[k < 0 ? 0 : k >= n ? n - 1 : k];
    for (let i = 0; i < n; i++) {
      tmp[i] = acc / (2 * r + 1);
      const add = i + r + 1;
      const sub = i - r;
      acc += a[add >= n ? n - 1 : add] - a[sub < 0 ? 0 : sub];
    }
    a.set(tmp);
  }
}

function toF32(a) {
  if (a instanceof Float32Array) return a;
  if (!a) return new Float32Array(0);
  // arrays, other typed arrays, or the {"0": …} object JSON makes of a typed array
  return Float32Array.from(typeof a.length === 'number' ? a : Object.values(a));
}

function num(v, d) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : d;
}
