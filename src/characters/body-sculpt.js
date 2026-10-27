/**
 * Clothed-body sculpt (characters module).
 *
 * Describes one character's body + clothing as an SdfModel (sdf-model.js) in
 * the bind pose (arms in the A-pose, see skeleton.js): a lofted jacket torso
 * (superellipse rings with chest / shoulder-blade shaping), trousers (lofted
 * pelvis + tapered leg cones with knees), sleeves (deltoid, upper arm,
 * forearm, cuff), neck, collar or bunched hood, boots (shaft, foot, toe box,
 * heel, flat sole) and per-outfit details (chest / cargo pockets, knee pads,
 * armour plates, bell sleeves). Garments are separate groups so hems and
 * cuffs stay crisp while each garment blends smoothly inside.
 * Every primitive carries a material slot (colour region, see body.js) and a
 * skinning part (torso, pelvis, armL/R, legL/R, neck, bootL/R).
 */
import { SdfModel, LoftTable, rotXYZ } from './sdf-model.js';
import { J } from './skeleton.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gauss = (x, s) => Math.exp(-(x / s) * (x / s));

// ------------------------------------------------------------------ torsos
// y, a (half width), bf (front depth), bb (back depth), n (superellipse exponent)
const JACKET_M = [
  [0.872, 0.165, 0.11, 0.121, 2.3],
  [0.94, 0.16, 0.106, 0.115, 2.3],
  [1.0, 0.151, 0.103, 0.106, 2.25],
  [1.06, 0.145, 0.103, 0.1, 2.2],
  [1.14, 0.149, 0.108, 0.101, 2.2],
  [1.22, 0.158, 0.118, 0.106, 2.25],
  [1.3, 0.166, 0.124, 0.111, 2.35],
  [1.36, 0.17, 0.122, 0.114, 2.45],
  [1.415, 0.172, 0.114, 0.114, 2.6],
  [1.455, 0.168, 0.102, 0.106, 2.6],
  [1.482, 0.154, 0.09, 0.096, 2.5],
  [1.503, 0.138, 0.079, 0.087, 2.35],
  [1.52, 0.108, 0.07, 0.079, 2.2],
  [1.535, 0.083, 0.063, 0.071, 2.1],
  [1.548, 0.072, 0.06, 0.066, 2.05],
];
const JACKET_F = [
  [0.872, 0.17, 0.106, 0.124, 2.3],
  [0.94, 0.163, 0.1, 0.118, 2.3],
  [1.0, 0.146, 0.094, 0.104, 2.25],
  [1.06, 0.132, 0.092, 0.096, 2.2],
  [1.12, 0.13, 0.095, 0.094, 2.2],
  [1.2, 0.14, 0.106, 0.096, 2.25],
  [1.27, 0.149, 0.113, 0.1, 2.3],
  [1.33, 0.154, 0.108, 0.104, 2.4],
  [1.39, 0.154, 0.101, 0.106, 2.5],
  [1.425, 0.154, 0.095, 0.1, 2.55],
  [1.452, 0.143, 0.085, 0.091, 2.45],
  [1.474, 0.126, 0.075, 0.082, 2.3],
  [1.492, 0.098, 0.066, 0.074, 2.2],
  [1.507, 0.076, 0.058, 0.066, 2.1],
  [1.518, 0.066, 0.055, 0.061, 2.05],
];
// trousers pelvis (crotch → inside the jacket)
const PANTS_M = [
  [0.795, 0.09, 0.062, 0.07, 2.2],
  [0.83, 0.14, 0.088, 0.104, 2.25],
  [0.88, 0.159, 0.097, 0.116, 2.3],
  [0.94, 0.16, 0.099, 0.114, 2.3],
  [1.0, 0.153, 0.099, 0.104, 2.25],
  [1.04, 0.15, 0.099, 0.1, 2.2],
];
const PANTS_F = [
  [0.795, 0.095, 0.06, 0.072, 2.2],
  [0.83, 0.15, 0.087, 0.11, 2.25],
  [0.88, 0.166, 0.094, 0.121, 2.3],
  [0.94, 0.161, 0.093, 0.115, 2.3],
  [1.0, 0.143, 0.09, 0.1, 2.25],
  [1.04, 0.135, 0.089, 0.095, 2.2],
];

/** Garment looseness per outfit (jacket, trousers, sleeves). */
const FIT = {
  pathfinder: { jacket: 1.075, pants: 1.1, sleeve: 1.08 },
  scout: { jacket: 1.0, pants: 1.02, sleeve: 0.98 },
  ranger: { jacket: 1.08, pants: 1.06, sleeve: 1.07 },
  nomad: { jacket: 1.03, pants: 1.06, sleeve: 1.03 },
  vanguard: { jacket: 1.03, pants: 1.03, sleeve: 1.02 },
  drifter: { jacket: 1.05, pants: 1.02, sleeve: 1.04 },
  robe: { jacket: 1.08, pants: 1.06, sleeve: 1.1 },
  tech: { jacket: 1.07, pants: 1.07, sleeve: 1.06 },
};
/** One-piece suits: the torso runs straight into the trousers (no hem step). */
const ONE_PIECE = new Set(['scout', 'tech', 'vanguard']);

/** Monotone (Fritsch–Carlson) cubic through rows → value at y for column c. */
function rowInterp(rows, c, y) {
  const n = rows.length;
  if (y <= rows[0][0]) return rows[0][c];
  if (y >= rows[n - 1][0]) return rows[n - 1][c];
  let i = 0;
  while (i < n - 2 && y > rows[i + 1][0]) i++;
  const x0 = rows[i][0];
  const x1 = rows[i + 1][0];
  const y0 = rows[i][c];
  const y1 = rows[i + 1][c];
  const h = x1 - x0;
  const slope = (k) => (rows[k + 1][c] - rows[k][c]) / (rows[k + 1][0] - rows[k][0]);
  const tan = (k) => {
    if (k <= 0) return slope(0);
    if (k >= n - 1) return slope(n - 2);
    const a = slope(k - 1);
    const b = slope(k);
    if (a * b <= 0) return 0;
    return (2 * a * b) / (a + b);
  };
  const m0 = tan(i);
  const m1 = tan(i + 1);
  const t = (y - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
}

/** Radius of a superellipse ring (half width a, front bf, back bb, exponent n) at polar θ. */
function ringRadius(a, bf, bb, n, th) {
  const s = Math.abs(Math.sin(th));
  const c = Math.cos(th);
  const b = c >= 0 ? bf : bb;
  const ac = Math.abs(c);
  const v = Math.pow(s / a, n) + Math.pow(ac / b, n);
  return Math.pow(v, -1 / n);
}

/**
 * Builds the body model for appearance `app` and frame `fr` (bodyFrame()).
 * Returns { model, min, max, info } — info holds placement helpers for gear.
 */
export function sculptBody(app, fr) {
  const f = fr.f;
  const s = fr.s;
  const g = fr.g;
  const o = app.outfit;
  const fit = FIT[o] || FIT.pathfinder;
  const gi = 0.75 + 0.25 * g; // girth influence on radii
  const m = new SdfModel();
  const P = {
    torso: m.part('torso'),
    pelvis: m.part('pelvis'),
    armL: m.part('armL'),
    armR: m.part('armR'),
    legL: m.part('legL'),
    legR: m.part('legR'),
    neck: m.part('neck'),
    bootL: m.part('bootL'),
    bootR: m.part('bootR'),
  };
  const onePiece = ONE_PIECE.has(o);

  // ------------------------------------------------------------ jacket loft
  const rows = (f ? JACKET_F : JACKET_M).map((r) => {
    const upper = r[0] < 1.47 ? 1 : 0;
    const k = (upper ? fit.jacket * gi : 1) * s;
    return [r[0] * s, r[1] * k, r[2] * k, r[3] * k, r[4]];
  });
  const yHem = (onePiece ? 0.95 : 0.872) * s;
  const yTop = rows[rows.length - 1][0];
  const jt = new LoftTable(yHem, yTop, 0.005 * s, 96).fill((y, th) => {
    const a = rowInterp(rows, 1, y);
    const bf = rowInterp(rows, 2, y);
    const bb = rowInterp(rows, 3, y);
    const n = rowInterp(rows, 4, y);
    let r = ringRadius(a, bf, bb, n, th);
    const sn = Math.sin(th);
    const cs = Math.cos(th);
    const x = r * sn;
    const ax = Math.abs(x);
    if (cs > 0) {
      // chest: pectorals (m) / bust (f) — softened by the jacket
      if (f) r += 0.022 * s * cs * gauss(ax - 0.07 * s, 0.05 * s) * gauss(y - 1.255 * s, 0.055 * s);
      else r += 0.008 * s * cs * gauss(ax - 0.08 * s, 0.06 * s) * gauss(y - 1.32 * s, 0.06 * s);
    } else {
      // shoulder blades + slight hollow at the small of the back
      r += 0.007 * s * -cs * gauss(ax - 0.085 * s, 0.05 * s) * gauss(y - 1.37 * s, 0.07 * s);
      r -= 0.006 * s * -cs * gauss(ax, 0.07 * s) * gauss(y - 1.06 * s, 0.06 * s);
    }
    // the jacket hangs straight below the waist (no wrap-around the bottom)
    return r;
  });
  m.group('jacket');
  m.loft(jt, { mat: 'jacket', part: P.torso }, 0.03 * s, onePiece ? 0.06 * s : 0.012 * s);

  // collar / hood roll (pathfinder, drifter, nomad keep the hood down)
  const neckBase = 1.505 * s;
  const neckR = (f ? 0.049 : 0.058) * s;
  const hood = (o === 'pathfinder' || o === 'drifter' || o === 'nomad') && app.headwear !== 'hood';
  if (hood) {
    // bunched hood: a thick soft roll around the back and sides of the neck
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = -2.05 + (i / (n - 1)) * 4.1; // 0 = back
      const back = Math.cos(a * 0.8);
      const R = (0.098 + 0.012 * back) * s * (f ? 0.94 : 1);
      const cx = Math.sin(a) * R;
      const cz = Math.cos(a) * R * 0.92 + 0.012 * s;
      const cy = (1.535 - 0.012 * (1 - back)) * s * (f ? 0.985 : 1);
      const rr = (0.03 + 0.02 * back) * s;
      m.ell([cx, cy, cz], [rr * 1.1, rr * 0.82, rr], { k: 0.03 * s, mat: 'hood', part: P.torso, rot: rotXYZ(0, a, 0) });
    }
    // hood body lying on the upper back
    m.ell([0, 1.43 * s, 0.098 * s * fit.jacket], [0.11 * s, 0.1 * s, 0.035 * s], { k: 0.035 * s, mat: 'hood', part: P.torso, rot: rotXYZ(-0.22, 0, 0) });
  } else if (o === 'ranger') {
    // turned-down field-jacket collar
    m.torus([0, 1.522 * s, 0.006 * s], 0.077 * s, 0.017 * s, { k: 0.012 * s, mat: 'collar', part: P.torso, rot: rotXYZ(0.16, 0, 0) }, 1.05, 0.95);
  } else if (o !== 'robe') {
    // stand-up funnel collar
    m.cone([0, 1.49 * s, 0.01 * s], [0, 1.566 * s, 0.016 * s], (f ? 0.072 : 0.081) * s, (f ? 0.062 : 0.07) * s, { k: 0.02 * s, mat: 'collar', part: P.torso });
  }

  // chest pockets etc. (details on the jacket)
  const frontZ = (x, y) => -surfaceH(jt, x, y, -1);
  const backZ = (x, y) => surfaceH(jt, x, y, 1);
  const onFront = (x, y, hw, hh, hd, mat, k = 0.004, tilt = 0) => {
    const z = frontZ(x, y);
    const dz = frontZ(x + 0.01, y) - z; // surface slope → yaw
    const yaw = Math.atan2(dz, 0.01);
    m.box([x, y, z + hd * 0.35], [hw, hh, hd], Math.min(hw, hh, hd) * 0.9, { k: k * s, mat, part: P.torso, rot: rotXYZ(tilt, -yaw, 0) });
  };
  if (o === 'pathfinder') {
    for (const sx of [-1, 1]) {
      onFront(sx * 0.073 * s, 1.305 * s, 0.047 * s, 0.054 * s, 0.012 * s, 'pocket');
      onFront(sx * 0.073 * s, 1.358 * s, 0.05 * s, 0.017 * s, 0.014 * s, 'flap');
    }
  } else if (o === 'ranger') {
    for (const sx of [-1, 1]) {
      onFront(sx * 0.076 * s, 1.3 * s, 0.05 * s, 0.05 * s, 0.013 * s, 'pocket');
      onFront(sx * 0.076 * s, 1.35 * s, 0.054 * s, 0.017 * s, 0.015 * s, 'flap');
      onFront(sx * 0.086 * s, 0.975 * s, 0.06 * s, 0.056 * s, 0.013 * s, 'pocket');
      onFront(sx * 0.086 * s, 1.028 * s, 0.064 * s, 0.017 * s, 0.015 * s, 'flap');
    }
  } else if (o === 'vanguard') {
    // armour: chest + back plates, abdomen plate
    m.group('armour');
    const zc = frontZ(0, 1.3 * s);
    m.box([0, 1.305 * s, zc + 0.018 * s], [0.15 * s, 0.11 * s, 0.03 * s], 0.025 * s, { mat: 'plate', part: P.torso, rot: rotXYZ(0.1, 0, 0) });
    const zb = backZ(0, 1.32 * s);
    m.box([0, 1.32 * s, zb - 0.016 * s], [0.145 * s, 0.12 * s, 0.028 * s], 0.025 * s, { mat: 'plate', part: P.torso, rot: rotXYZ(-0.06, 0, 0) });
    const za = frontZ(0, 1.1 * s);
    m.box([0, 1.1 * s, za + 0.01 * s], [0.11 * s, 0.065 * s, 0.022 * s], 0.02 * s, { mat: 'plate2', part: P.torso });
  }

  // ------------------------------------------------------------ neck (skin)
  m.group('skin');
  const hc = fr.headC;
  // the neck leans forward: its top sits under the back half of the jaw, not behind it
  m.cone([0, 1.465 * s, 0.014 * s], [0, hc.y - 0.035 * s, -0.004 * s], neckR * 1.04, neckR * 0.98, { mat: 'skin', part: P.neck });

  // --------------------------------------------------------------- trousers
  m.group('pants', { k: onePiece ? 0.045 * s : 0 });
  const prow = (f ? PANTS_F : PANTS_M).map((r) => [r[0] * s, r[1] * s * fit.pants * gi, r[2] * s * fit.pants * gi, r[3] * s * fit.pants * gi, r[4]]);
  const pt = new LoftTable(prow[0][0], prow[prow.length - 1][0], 0.005 * s, 64).fill((y, th) => {
    let r = ringRadius(rowInterp(prow, 1, y), rowInterp(prow, 2, y), rowInterp(prow, 3, y), rowInterp(prow, 4, y), th);
    // buttocks
    const cs = Math.cos(th);
    if (cs < 0) r += 0.012 * s * -cs * gauss(Math.abs(Math.sin(th)) * r - 0.07 * s, 0.05 * s) * gauss(y - 0.88 * s, 0.06 * s) * (f ? 1.4 : 1);
    return r;
  });
  m.loft(pt, { mat: 'pants', part: P.pelvis }, 0.02 * s, 0.05 * s);
  const legs = {};
  for (const side of [-1, 1]) {
    const H = fr.joints[side < 0 ? J.thighL : J.thighR];
    const K = fr.joints[side < 0 ? J.shinL : J.shinR];
    const A = fr.joints[side < 0 ? J.footL : J.footR];
    const part = side < 0 ? P.legL : P.legR;
    const lf = fit.pants * gi;
    const fem = f ? 1.04 : 1;
    const top = [H.x - side * 0.004 * s, H.y + 0.035 * s, H.z + 0.004 * s];
    const knee = [K.x, K.y, K.z];
    const ank = [A.x, A.y + 0.1 * s, A.z + 0.004 * s];
    // thigh (slightly flattened front-back by a second, narrower cone behind)
    m.cone(top, knee, 0.086 * s * lf * fem, 0.06 * s * lf, { k: 0.04 * s, mat: 'pants', part });
    m.cone([top[0], top[1] - 0.06 * s, top[2] + 0.02 * s], [knee[0], knee[1] + 0.08 * s, knee[2] + 0.012 * s], 0.07 * s * lf * fem, 0.055 * s * lf, { k: 0.03 * s, mat: 'pants', part });
    // knee cap + shin
    m.ell([K.x, K.y + 0.008 * s, K.z - 0.028 * s * lf], [0.047 * s * lf, 0.055 * s, 0.04 * s * lf], { k: 0.025 * s, mat: 'pants', part });
    m.cone(knee, ank, 0.059 * s * lf, 0.043 * s * lf, { k: 0.03 * s, mat: 'pants', part });
    // calf
    m.ell([K.x + side * 0.004 * s, K.y - 0.12 * s, K.z + 0.02 * s], [0.042 * s * lf, 0.085 * s, 0.042 * s * lf], { k: 0.04 * s, mat: 'pants', part });
    legs[side] = { H, K, A, part };
  }
  // cargo pockets / knee pads
  if (o === 'pathfinder' || o === 'ranger') {
    for (const side of [-1, 1]) {
      const { H, K, part } = legs[side];
      const y = lerp(H.y, K.y, 0.47);
      const x = lerp(H.x, K.x, 0.47) + side * 0.066 * s * fit.pants * gi;
      m.box([x, y, 0.004 * s], [0.012 * s, 0.07 * s, 0.056 * s], 0.01 * s, { k: 0.012 * s, mat: 'pocket2', part, rot: rotXYZ(0, 0, side * 0.05) });
      m.box([x + side * 0.003 * s, y + 0.058 * s, 0.004 * s], [0.013 * s, 0.02 * s, 0.059 * s], 0.009 * s, { k: 0.006 * s, mat: 'flap2', part, rot: rotXYZ(0, 0, side * 0.05) });
    }
  }
  if (o === 'scout' || o === 'tech' || o === 'vanguard') {
    for (const side of [-1, 1]) {
      const { K, part } = legs[side];
      m.ell([K.x, K.y + 0.006 * s, K.z - 0.05 * s], [0.048 * s, 0.062 * s, 0.026 * s], { k: 0.008 * s, mat: o === 'vanguard' ? 'plate' : 'pad', part });
    }
  }
  if (o === 'vanguard') {
    m.group('armour-legs');
    for (const side of [-1, 1]) {
      const { H, K, A, part } = legs[side];
      const tc = [lerp(H.x, K.x, 0.45) + side * 0.05 * s, lerp(H.y, K.y, 0.45), -0.02 * s];
      m.box(tc, [0.03 * s, 0.1 * s, 0.055 * s], 0.02 * s, { mat: 'plate', part, rot: rotXYZ(0, side * 0.55, 0) });
      const sc = [lerp(K.x, A.x, 0.42), lerp(K.y, A.y, 0.42), lerp(K.z, A.z, 0.42) - 0.045 * s];
      m.box(sc, [0.04 * s, 0.11 * s, 0.022 * s], 0.018 * s, { mat: 'plate', part });
    }
  }

  // ------------------------------------------------------------------ boots
  m.group('boots');
  const bootS = s * (f ? 0.95 : 1.04);
  const shaftTop = o === 'robe' ? 0.13 : 0.255;
  for (const side of [-1, 1]) {
    const A = fr.joints[side < 0 ? J.footL : J.footR];
    const part = side < 0 ? P.bootL : P.bootR;
    const bx = A.x + side * 0.004 * s;
    const z0 = A.z;
    const bs = bootS;
    m.cone([bx, 0.05 * bs, z0 + 0.012 * bs], [bx, shaftTop * s, z0 + 0.004 * bs], 0.056 * bs, 0.062 * bs, { k: 0.02 * bs, mat: 'boot', part });
    m.ell([bx, 0.058 * bs, z0 - 0.055 * bs], [0.05 * bs, 0.052 * bs, 0.1 * bs], { k: 0.03 * bs, mat: 'boot', part });
    m.ell([bx - side * 0.003 * bs, 0.045 * bs, z0 - 0.15 * bs], [0.047 * bs, 0.04 * bs, 0.07 * bs], { k: 0.03 * bs, mat: 'toe', part });
    m.ell([bx, 0.06 * bs, z0 + 0.035 * bs], [0.045 * bs, 0.055 * bs, 0.05 * bs], { k: 0.025 * bs, mat: 'boot', part });
    // chunky sole: slightly wider than the upper, flat bottom
    m.box([bx, 0.017 * bs, z0 - 0.058 * bs], [0.054 * bs, 0.019 * bs, 0.153 * bs], 0.014 * bs, { k: 0.006 * bs, mat: 'sole', part });
    if (o !== 'robe') {
      // strap rings around the shaft
      for (const yy of [0.115, 0.205]) m.torus([bx, yy * s, z0 + 0.006 * bs], 0.058 * bs, 0.0085 * bs, { k: 0.004 * bs, mat: 'strap', part });
    }
  }
  m.plane([0, -1, 0], 0, { op: 'int', k: 0.004 * s, part: P.bootL });

  // ----------------------------------------------------------------- sleeves
  m.group('sleeves', { k: 0.03 * s });
  const sleeves = {};
  const bell = o === 'robe';
  const fem = f ? 0.88 : 1;
  for (const side of [-1, 1]) {
    const iA = side < 0 ? J.armL : J.armR;
    const sh = fr.joints[iA];
    const E = fr.bindJoints[side < 0 ? J.foreL : J.foreR];
    const W = fr.bindJoints[side < 0 ? J.handL : J.handR];
    const part = side < 0 ? P.armL : P.armR;
    const lf = fit.sleeve * (0.82 + 0.18 * g) * fem;
    const d1 = norm3([E.x - sh.x, E.y - sh.y, E.z - sh.z]);
    const d2 = norm3([W.x - E.x, W.y - E.y, W.z - E.z]);
    const rot = rotXYZ(0, 0, side * fr.aPose);
    // deltoid cap (rides with the arm), blends into the jacket's shoulder line
    const dc = fr.toBind(side, { x: sh.x + side * 0.008 * s, y: sh.y - 0.022 * s, z: sh.z + 0.002 * s });
    m.ell([dc.x, dc.y, dc.z], [0.05 * s * lf, 0.066 * s * lf, 0.056 * s * lf], { k: 0.04 * s, mat: 'sleeve', part, rot });
    const a0 = [sh.x + d1[0] * 0.03 * s, sh.y + d1[1] * 0.03 * s, sh.z + d1[2] * 0.03 * s];
    m.cone(a0, [E.x, E.y, E.z], 0.055 * s * lf, 0.046 * s * lf, { k: 0.02 * s, mat: 'sleeve', part });
    const wr = bell ? 0.075 : 0.04;
    const w0 = [W.x - d2[0] * 0.012 * s, W.y - d2[1] * 0.012 * s, W.z - d2[2] * 0.012 * s];
    m.cone([E.x, E.y, E.z], w0, 0.046 * s * lf, wr * s * lf, { k: 0.02 * s, mat: 'sleeve', part });
    if (!bell) {
      // cuff band
      const c0 = [W.x - d2[0] * 0.05 * s, W.y - d2[1] * 0.05 * s, W.z - d2[2] * 0.05 * s];
      m.cone(c0, w0, 0.043 * s * lf, 0.0425 * s * lf, { k: 0.006 * s, mat: 'cuff', part });
    }
    if (o === 'pathfinder' && side < 0) {
      // utility pocket on the left upper arm (outer side)
      const pc = fr.toBind(side, { x: sh.x - 0.06 * s * lf, y: sh.y - 0.12 * s, z: sh.z - 0.006 * s });
      m.box([pc.x, pc.y, pc.z], [0.012 * s, 0.045 * s, 0.032 * s], 0.009 * s, { k: 0.005 * s, mat: 'flap', part, rot });
    }
    if (o === 'vanguard') {
      // pauldron + forearm guard
      const pc = fr.toBind(side, { x: sh.x + side * 0.03 * s, y: sh.y + 0.03 * s, z: sh.z });
      m.ell([pc.x, pc.y, pc.z], [0.08 * s, 0.05 * s, 0.085 * s], { k: 0.006 * s, mat: 'plate', part, rot: rotXYZ(0, 0, side * (fr.aPose - 0.45)) });
      const fc = [lerp(E.x, W.x, 0.5), lerp(E.y, W.y, 0.5), lerp(E.z, W.z, 0.5)];
      m.cone([fc[0] - d2[0] * 0.08 * s, fc[1] - d2[1] * 0.08 * s, fc[2]], [fc[0] + d2[0] * 0.07 * s, fc[1] + d2[1] * 0.07 * s, fc[2]], 0.05 * s, 0.046 * s, { k: 0.006 * s, mat: 'plate', part });
    }
    sleeves[side] = { sh, E, W, d1, d2, lf, part, L1: dist3(sh, E), L2: dist3(E, W) };
  }
  m.finalize();

  // ---------------------------------------------------------------- bounds
  const xs = Math.max(Math.abs(fr.bindJoints[J.handL].x), Math.abs(fr.bindJoints[J.handR].x)) + 0.1 * s;
  const min = [-xs, -0.01, -0.3 * s];
  const max = [xs, hc.y - 0.02 * s, 0.26 * s];
  return {
    model: m,
    min,
    max,
    parts: P,
    info: { jt, pt, legs, sleeves, yHem, yTop, neckR, neckBase, frontZ, backZ, onePiece, hood, fit },
  };
}

/** Distance from the torso axis to the loft surface at (x, y) along ±Z (dir +1 = back). */
export function surfaceH(table, x, y, dir) {
  // the loft is star-shaped around the axis: bisect on z along the line x = const
  let lo = 0;
  let hi = 0.6;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const z = dir * mid;
    const r = table.radius(y, Math.atan2(x, -z));
    if (Math.hypot(x, z) < r) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
