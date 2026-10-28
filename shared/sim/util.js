/**
 * Small pure helpers used across the simulation (no DOM, no Node APIs).
 */
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const r2 = (n) => Math.round(n * 100) / 100;
export const r1 = (n) => Math.round(n * 10) / 10;
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isVec3 = (v) => Array.isArray(v) && v.length >= 3 && isNum(v[0]) && isNum(v[1]) && isNum(v[2]);
export const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const dist3 = (ax, ay, az, bx, by, bz) => Math.hypot(ax - bx, ay - by, az - bz);

/** Wraps an angle to [-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Heading (rotation.y) that faces from (ax, az) toward (bx, bz): forward = (−sin h, −cos h). */
export const headingTo = (ax, az, bx, bz) => Math.atan2(-(bx - ax), -(bz - az));

/** Integer in [a, b] from an rng function. */
export const randInt = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));

/** Plain deep copy of JSON-like data. */
export const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** Squared distance from point P to segment AB in 3D, plus the param t (written to out[0]). */
export function segPointDist2(ax, ay, az, bx, by, bz, px, py, pz, out) {
  const vx = bx - ax;
  const vy = by - ay;
  const vz = bz - az;
  const l2 = vx * vx + vy * vy + vz * vz;
  let t = l2 > 1e-12 ? ((px - ax) * vx + (py - ay) * vy + (pz - az) * vz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (out) out[0] = t;
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  const dz = pz - (az + vz * t);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Closest distance between ray (o + d·t, t ∈ [0, maxT], d unit) and segment
 * [P, Q] (a capsule axis). Returns {dist, t}. Allocation-free when `out` is given.
 */
export function raySegDist(ox, oy, oz, dx, dy, dz, maxT, px, py, pz, qx, qy, qz, out = { dist: 0, t: 0 }) {
  // sample-free analytic closest points between two segments
  const ux = dx * maxT;
  const uy = dy * maxT;
  const uz = dz * maxT;
  const vx = qx - px;
  const vy = qy - py;
  const vz = qz - pz;
  const wx = ox - px;
  const wy = oy - py;
  const wz = oz - pz;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const D = a * c - b * b;
  let sN;
  let sD = D;
  let tN;
  let tD = D;
  if (D < 1e-9) {
    sN = 0;
    sD = 1;
    tN = e;
    tD = c > 1e-9 ? c : 1;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) {
      sN = 0;
      tN = e;
      tD = c > 1e-9 ? c : 1;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c > 1e-9 ? c : 1;
    }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0;
    else if (-d > a) sN = sD;
    else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) sN = 0;
    else if (-d + b > a) sN = sD;
    else {
      sN = -d + b;
      sD = a;
    }
  }
  const sc = Math.abs(sN) < 1e-12 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-12 ? 0 : tN / tD;
  const cx = wx + sc * ux - tc * vx;
  const cy = wy + sc * uy - tc * vy;
  const cz = wz + sc * uz - tc * vz;
  out.dist = Math.sqrt(cx * cx + cy * cy + cz * cz);
  out.t = sc * maxT;
  return out;
}
