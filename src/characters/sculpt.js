/**
 * Sculpting helpers for heads (characters module): signed-distance primitives
 * (ellipsoid, capsule, round cone, smooth min/max), a warm-started radial
 * surface marcher, density-warped parameter tables and "shell" grids that wrap
 * a surface at an offset (hair caps, beards, hoods). Head-local coordinates:
 * origin at the eye line centre on the ear plane, +X right, +Y up, −Z front.
 */
import * as THREE from 'three';
import { gridGeometry } from './builder.js';

export const DEG = Math.PI / 180;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------- primitives
/** Approximate ellipsoid distance (good near the surface, conservative far away). */
export function sdEll(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx;
  const py = (y - cy) / ry;
  const pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const qx = px / rx;
  const qy = py / ry;
  const qz = pz / rz;
  const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1e-9;
  return (k0 * (k0 - 1)) / k1;
}

export function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax;
  const pay = y - ay;
  const paz = z - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const h = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/** Capsule whose radius blends from r1 (at a) to r2 (at b). */
export function sdRoundCone(x, y, z, ax, ay, az, bx, by, bz, r1, r2) {
  const pax = x - ax;
  const pay = y - ay;
  const paz = z - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const h = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (r1 + (r2 - r1) * h);
}

export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export const smax = (a, b, k) => -smin(-a, -b, k);

// ---------------------------------------------------------------- marching
/**
 * Creates a radial marcher for a star-shaped SDF (every ray from the origin
 * crosses the surface once). Successive calls warm-start from the previous
 * hit, which makes grid sampling ~8× faster than marching from outside.
 *   const march = radialMarcher(sdf); const t = march(dx, dy, dz);
 */
export function radialMarcher(sdf, { far = 0.24, eps = 0.00004 } = {}) {
  let last = -1;
  const march = (dx, dy, dz) => {
    let t = last > 0 ? last + 0.012 : far;
    let d = sdf(dx * t, dy * t, dz * t);
    // warm start landed inside: step outward until outside, then refine
    let guard = 0;
    while (d < 0 && guard++ < 40) {
      t += Math.max(0.004, -d * 1.2);
      d = sdf(dx * t, dy * t, dz * t);
    }
    for (let i = 0; i < 72; i++) {
      if (Math.abs(d) < eps) break;
      t -= d * 0.9;
      if (t < 0.004) {
        t = 0.004;
        break;
      }
      d = sdf(dx * t, dy * t, dz * t);
    }
    last = t;
    return t;
  };
  march.reset = () => {
    last = -1;
  };
  return march;
}

/** Cold (non warm-started) radial march; for isolated queries. */
export function marchIn(sdf, dx, dy, dz, start = 0.24) {
  let t = start;
  for (let i = 0; i < 80; i++) {
    const d = sdf(dx * t, dy * t, dz * t);
    if (Math.abs(d) < 0.00005) break;
    t -= d * 0.85;
    if (t < 0.004) return 0.004;
  }
  return t;
}

export function sdfNormal(sdf, x, y, z, out, e = 0.0006) {
  out.set(
    sdf(x + e, y, z) - sdf(x - e, y, z),
    sdf(x, y + e, z) - sdf(x, y - e, z),
    sdf(x, y, z + e) - sdf(x, y, z - e),
  );
  return out.normalize();
}

/** Unit direction for polar angle th (0 = up) and azimuth ph (0 = front, +X at +π/2). */
export function dirOf(th, ph, out) {
  const s = Math.sin(th);
  return out.set(s * Math.sin(ph), Math.cos(th), -s * Math.cos(ph));
}

/** n+1 parameter values in [lo, hi] spaced by the inverse CDF of density(a). */
export function warpTable(n, lo, hi, density) {
  const N = 600;
  const cdf = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const a = lo + ((hi - lo) * (i - 0.5)) / N;
    cdf[i] = cdf[i - 1] + density(a);
  }
  const out = new Float64Array(n + 1);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const target = (j / n) * cdf[N];
    while (k < N && cdf[k + 1] < target) k++;
    const f = (target - cdf[k]) / (cdf[k + 1] - cdf[k] || 1);
    out[j] = lo + ((hi - lo) * (k + f)) / N;
  }
  out[0] = lo;
  out[n] = hi;
  return out;
}

/** Smoothly interpolated lookup in a [[x, y], …] table (x ascending). */
export function tableLerp(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const t = (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
      return lerp(tab[i - 1][1], tab[i][1], t * t * (3 - 2 * t));
    }
  }
  return tab[tab.length - 1][1];
}

/** Cheap deterministic 3D noise (−1…1-ish) for hair tousle / curls. */
export function hnoise(x, y, z) {
  return (
    Math.sin(x * 1.7 + Math.sin(y * 2.3) * 1.3) * Math.cos(z * 1.9 + Math.sin(x * 1.1)) * 0.5 +
    Math.sin(y * 3.1 + z * 2.7) * 0.3 +
    Math.sin(x * 5.3 - y * 4.1 + z * 3.7) * 0.2
  );
}

/**
 * Shell over a star-shaped surface between polar angles theta0(|φ|°, φ) and
 * theta1(|φ|°, φ) (degrees), pushed out by thick(φ, v, dir, r) metres.
 * opts: { phiMin, phiMax (open shell), pole (row 0 collapses to a point),
 *         post(out, φ, v, dir), uScale, vScale, normals: 'faces' }
 */
export function shellGeometry(sdf, nu, nv, theta0, theta1, thick, opts = {}) {
  const phiMin = opts.phiMin ?? -Math.PI;
  const phiMax = opts.phiMax ?? Math.PI;
  const wrap = opts.phiMin == null;
  const march = radialMarcher(sdf);
  const dir = new THREE.Vector3();
  return gridGeometry(
    nu,
    nv,
    (u, v, out) => {
      const ph = lerp(phiMin, phiMax, u);
      const adeg = Math.abs(ph) / DEG;
      const th = lerp(theta0(adeg, ph), theta1(adeg, ph), v) * DEG;
      dirOf(th, ph, dir);
      const r = march(dir.x, dir.y, dir.z);
      const k = thick(ph, v, dir, r);
      out.copy(dir).multiplyScalar(r + k);
      if (opts.post) opts.post(out, ph, v, dir);
    },
    { wrapU: wrap, poles: opts.pole ? [0] : undefined, uScale: opts.uScale ?? 6, vScale: opts.vScale ?? 2, flip: !!opts.flip },
  );
}

const flipCache = new WeakMap();
/** Mirrored copy of a geometry (winding reversed) for negative-scale transforms. */
export function flipped(g) {
  let f = flipCache.get(g);
  if (!f) {
    f = g.clone();
    const I = f.index.array;
    for (let i = 0; i < I.length; i += 3) {
      const t = I[i + 1];
      I[i + 1] = I[i + 2];
      I[i + 2] = t;
    }
    flipCache.set(g, f);
  }
  return f;
}

// ---------------------------------------------------------------- landmarks
/** Eye placement (head-local): centre x (±), y, z and eyeball radius. */
export const EYE = { x: 0.0318, y: 0.0014, z: -0.0682, r: 0.012 };

/** Hairline polar angle (deg from the crown) by |azimuth| (deg from the front). */
export const HAIRLINE = [
  [0, 44], [22, 47], [40, 54], [52, 63], [62, 72], [69, 84], [75, 95], [81, 96], [88, 80], [96, 73], [106, 77], [116, 92], [135, 106], [160, 117], [180, 120],
];

export function hairlineAt(adeg) {
  return tableLerp(HAIRLINE, adeg);
}

/** Stable cache key for a face-parameter object. */
export const faceKey = (p) => Object.keys(p).sort().map((k) => (typeof p[k] === 'number' ? p[k].toFixed(3) : p[k])).join(',');
