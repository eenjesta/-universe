/**
 * Procedural body + clothing (characters module).
 *
 * The clothed body is sculpted as a signed-distance model (body-sculpt.js) in
 * the A-pose bind, polygonized with narrow-band Surface Nets (surface-nets.js)
 * and turned into skinned vertex data here: skin weights blend smoothly
 * between body parts (soft-min over part distances) and along each limb
 * chain, colours come from material slots (jacket panels, pockets, knee
 * panels, laces, soles…), ambient occlusion is baked from the field, and
 * mirrored cylindrical UVs drive the fabric detail normals. Hands, the Ø
 * backpack, straps, belt, patch and outfit extras are added by gear.js.
 */
import * as THREE from 'three';
import { J, BONE_COUNT } from './skeleton.js';
import { sculptBody } from './body-sculpt.js';
import { polygonize, fieldAO } from './surface-nets.js';
import { addGear, BodySurface, MATS } from './gear.js';

const C = (hex) => new THREE.Color(hex);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const _col = new THREE.Color();

// ---------------------------------------------------------------- palette

/**
 * Lifts very dark colours to a minimum linear luminance: real "black" fabric
 * reflects ~3–4 %, and darker albedos turn into flat silhouettes against the
 * sunset (the hue is kept).
 */
export function liftDark(c, minLum = 0.034) {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  if (l >= minLum) return c;
  const k = minLum / Math.max(l, 1e-4);
  const t = Math.min(1, k);
  // scale toward the floor, blending in a neutral part for near-zero colours
  return c.multiplyScalar(Math.min(k, 3.2)).lerp(new THREE.Color(minLum, minLum, minLum * 1.04), l < minLum * 0.3 ? 0.5 : 0.15 * t);
}

/** Colour palette for an appearance (all THREE.Color, linear). */
export function palette(app) {
  const o = app.outfit;
  const main = liftDark(C(app.outfitColor));
  const lum = main.r * 0.2126 + main.g * 0.7152 + main.b * 0.0722;
  const light = lum > 0.25;
  const charcoal = C('#18191c');
  const pal = {
    main,
    light,
    panel: main.clone().multiplyScalar(light ? 0.86 : 0.74),
    panel2: main.clone().lerp(C(light ? '#9a958c' : '#2c2f35'), 0.35),
    pants: main.clone().lerp(charcoal, 0.45),
    boots: liftDark(C('#1d1a17'), 0.03),
    sole: liftDark(C('#121212'), 0.02),
    straps: liftDark(C('#121315'), 0.025),
    metal: C('#8b9097'),
    darkMetal: C('#3a3d42'),
    accent: C(app.accentColor),
    emblem: C(app.accentColor).lerp(C('#ffffff'), 0.1),
    glove: C('#17181a'),
    skin: (() => {
      const c = C(app.skin);
      const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
      return c.lerp(new THREE.Color(l, l, l), 0.12);
    })(),
    lining: main.clone().multiplyScalar(0.5),
    capColor: app.outfitColor,
    pad: C('#26282c'),
    plate: main.clone().lerp(C('#30343b'), 0.4),
  };
  if (o === 'scout') {
    pal.pants = main.clone();
    pal.boots = C('#2a2724');
    pal.straps = C('#1d1e21');
    pal.panel = main.clone().multiplyScalar(0.9);
  } else if (o === 'ranger') {
    pal.pants = C('#2a2621');
    pal.boots = C('#3b2a1e');
    pal.straps = C('#2a1f17');
  } else if (o === 'nomad') {
    pal.pants = C('#2b2823');
    pal.boots = C('#2e2620');
    pal.inner = C('#2a2620');
  } else if (o === 'vanguard') {
    pal.pants = main.clone().multiplyScalar(0.7);
    pal.seam = C('#6fe3ff');
    pal.boots = C('#15171b');
    pal.pad = pal.plate.clone();
  } else if (o === 'drifter') {
    pal.pants = C('#141518');
    pal.boots = C('#121212');
  } else if (o === 'robe') {
    pal.pants = C('#3a2a20');
    pal.boots = C('#3a2a1f');
    pal.trim = C(app.accentColor);
  } else if (o === 'tech') {
    pal.pants = main.clone();
    pal.boots = C('#25272b');
    pal.hivis = C(app.accentColor);
    pal.reflect = C('#c9cdd2');
  }
  return pal;
}

/** Material slot → { kind (MATS), color(p, n, q) }; q = per-vertex context. */
function slots(app, fr, pal, info) {
  const o = app.outfit;
  const s = fr.s;
  const yokeY = (fr.f ? 1.39 : 1.415) * s;
  const tech = o === 'tech';
  const zip = pal.light ? pal.main.clone().multiplyScalar(0.62) : C('#2b2e33');
  const kneeY = fr.joints[J.shinL].y;
  const jacket = (p, n, q) => {
    _col.copy(pal.main);
    const y = p.y;
    const ax = Math.abs(p.x);
    const front = p.z < 0;
    if (tech) {
      const band = (yy) => Math.abs(y - yy * s) < 0.019 * s;
      if (band(1.3) || band(1.12)) _col.copy(pal.hivis);
      if (Math.abs(y - 1.3 * s) < 0.006 * s || Math.abs(y - 1.12 * s) < 0.006 * s) _col.copy(pal.reflect);
    } else if (y > yokeY + (front ? 0 : -0.02 * s) && o !== 'robe' && o !== 'nomad') _col.copy(pal.panel);
    // side panels
    const side = Math.abs(p.x) / Math.max(0.01, Math.hypot(p.x, p.z));
    if (y < yokeY && y > info.yHem + 0.01) _col.lerp(pal.panel2, 0.3 * sstep(0.86, 0.97, side));
    // pathfinder: asymmetric chest panel seam (diagonal) + placket
    if (o === 'pathfinder' && front) {
      const seam = Math.abs(y - (1.36 * s - (p.x + 0.12 * s) * 0.55)) < 0.0055 * s && p.x > -0.13 * s && p.x < 0.15 * s;
      if (seam) _col.multiplyScalar(0.55);
    }
    if (front && ax < 0.006 * s && o !== 'robe' && o !== 'nomad' && y < 1.52 * s) _col.copy(zip);
    // hem band
    if (!info.onePiece) _col.multiplyScalar(1 - 0.16 * sstep(info.yHem + 0.02 * s, info.yHem + 0.008 * s, y));
    return _col;
  };
  const sleeve = (p, n, q) => {
    _col.copy(pal.main);
    const t = q.t; // metres along the arm chain from the shoulder joint
    if (t < 0.05 * s && !tech && o !== 'robe' && o !== 'nomad') _col.copy(pal.panel);
    if (tech && (Math.abs(t - 0.12 * s) < 0.016 * s || Math.abs(t - q.L1 - 0.1 * s) < 0.014 * s)) _col.copy(pal.hivis);
    // elbow patch (back of the elbow)
    if (o === 'pathfinder' || o === 'ranger') _col.multiplyScalar(1 - 0.28 * sstep(0.055 * s, 0.035 * s, Math.abs(t - q.L1)) * sstep(0.05, 0.45, q.back));
    if (o === 'robe' && t > q.L1 + q.L2 - 0.06 * s) _col.copy(pal.trim);
    return _col;
  };
  const pants = (p, n) => {
    _col.copy(pal.pants);
    const y = p.y;
    if (o === 'pathfinder' || o === 'ranger') _col.multiplyScalar(1 - 0.24 * sstep(0.075 * s, 0.055 * s, Math.abs(y - kneeY)) * sstep(-0.05, -0.45, n.z));
    if (tech && Math.abs(y - (kneeY - 0.14 * s)) < 0.017 * s) _col.copy(pal.hivis);
    // outer side seam
    const legX = Math.abs(p.x) - Math.abs(fr.joints[J.thighR].x);
    if (Math.abs(n.x) > 0.9 && legX > 0 && y < 0.86 * s && y > 0.2 * s && Math.abs(p.z) < 0.006 * s) _col.multiplyScalar(0.7);
    return _col;
  };
  const boot = (p, n) => {
    _col.copy(pal.boots);
    const A = fr.joints[p.x < 0 ? J.footL : J.footR];
    const lz = p.z - A.z;
    const lx = Math.abs(p.x - A.x);
    // laces on the instep / shaft front
    if (n.z < -0.35 && lx < 0.022 * s && lz < -0.02 * s && p.y > 0.045 * s && p.y < 0.24 * s) {
      if (Math.sin(p.y * 260 / s + lz * 140 / s) > 0.25) _col.multiplyScalar(0.55);
    }
    // toe cap / heel counter a touch lighter (worn leather)
    if (lz < -0.13 * s && n.y > 0.1) _col.multiplyScalar(1.12);
    if (p.y < 0.045 * s) _col.multiplyScalar(0.82);
    return _col;
  };
  const sole = (p) => {
    _col.copy(pal.sole);
    if (Math.abs(p.y - 0.026 * fr.s) < 0.004 * fr.s) _col.multiplyScalar(2.2); // rand stripe
    return _col;
  };
  const flat = (c) => () => _col.copy(c);
  return {
    jacket: { kind: 'fabric', color: jacket },
    sleeve: { kind: 'fabric', color: sleeve },
    cuff: { kind: 'fabric', color: flat(pal.main.clone().multiplyScalar(pal.light ? 0.82 : 0.78)) },
    collar: { kind: 'fabric', color: flat(pal.main.clone().multiplyScalar(0.82)) },
    hood: { kind: 'fabricSoft', color: (p, n) => _col.copy(pal.main).multiplyScalar(n.y < -0.25 ? 0.72 : 0.96) },
    pocket: { kind: 'fabric', color: flat(pal.main.clone().multiplyScalar(pal.light ? 0.94 : 1.12)) },
    flap: { kind: 'fabric', color: flat(pal.main.clone().multiplyScalar(pal.light ? 0.84 : 0.8)) },
    pocket2: { kind: 'fabric', color: flat(pal.pants.clone().multiplyScalar(0.94)) },
    flap2: { kind: 'fabric', color: flat(pal.pants.clone().multiplyScalar(0.8)) },
    pants: { kind: 'fabric', color: pants },
    pad: { kind: 'plate', color: flat(pal.pad) },
    plate: { kind: 'plate', color: flat(pal.plate) },
    plate2: { kind: 'plate', color: flat(pal.plate.clone().multiplyScalar(0.85)) },
    skin: { kind: 'skin', color: (p, n) => _col.copy(pal.skin).multiplyScalar(n.z < -0.5 ? 0.93 : 0.98) },
    boot: { kind: 'leather', color: boot },
    toe: { kind: 'leather', color: boot },
    sole: { kind: 'rubber', color: sole },
    strap: { kind: 'webbing', color: flat(pal.straps) },
  };
}

// ---------------------------------------------------------------- weights
/** Accumulates part-local bone weights (scaled by k) into acc[BONE_COUNT]. */
function partWeights(name, p, k, acc, fr, info, q) {
  const s = fr.s;
  const y = p.y / s;
  const sideBone = (l, r) => (p.x < 0 ? l : r);
  switch (name) {
    case 'torso': {
      const ax = Math.abs(p.x) / s;
      const clav = sideBone(J.clavL, J.clavR);
      const sh = sstep(0.09, 0.19, ax) * sstep(1.33, 1.45, y) * 0.55;
      // the hem below the belt follows the thighs a little (skirt-like)
      const hem = info.onePiece ? 0 : 0.3 * sstep(0.95, 0.875, y) * sstep(0.01, 0.06, ax);
      const kk = k * (1 - hem);
      if (hem > 0) acc[sideBone(J.thighL, J.thighR)] += k * hem;
      if (y > 1.45) {
        const wn = sstep(1.52, 1.58, y) * 0.45;
        const rest = 1 - wn;
        acc[J.chest] += kk * rest * (1 - sh);
        acc[J.neck] += kk * wn;
        acc[clav] += kk * rest * sh;
        return;
      }
      const tH = sstep(0.98, 1.1, y);
      const tC = sstep(1.15, 1.27, y);
      acc[J.hips] += kk * (1 - tH);
      acc[J.spine] += kk * tH * (1 - tC);
      acc[J.chest] += kk * tC * (1 - sh);
      acc[clav] += kk * tC * sh;
      return;
    }
    case 'pelvis': {
      const side = p.x < 0 ? -1 : 1;
      const H = info.legs[side].H;
      const wt = sstep(H.y + 0.02 * s, H.y - 0.09 * s, p.y) * sstep(0.0, 0.05 * s, Math.abs(p.x));
      acc[J.hips] += k * (1 - wt);
      acc[sideBone(J.thighL, J.thighR)] += k * wt;
      return;
    }
    case 'legL':
    case 'legR': {
      const side = name === 'legL' ? -1 : 1;
      const { H, K, A } = info.legs[side];
      const bones = side < 0 ? [J.thighL, J.shinL, J.footL] : [J.thighR, J.shinR, J.footR];
      if (p.y > K.y + 0.045 * s) {
        const th = sstep(H.y + 0.03 * s, H.y - 0.08 * s, p.y);
        acc[J.hips] += k * (1 - th);
        acc[bones[0]] += k * th;
      } else if (p.y > A.y + 0.05 * s) {
        const tk = sstep(K.y + 0.045 * s, K.y - 0.045 * s, p.y);
        acc[bones[0]] += k * (1 - tk);
        acc[bones[1]] += k * tk;
      } else {
        const ta = sstep(A.y + 0.05 * s, A.y, p.y);
        acc[bones[1]] += k * (1 - ta);
        acc[bones[2]] += k * ta;
      }
      return;
    }
    case 'armL':
    case 'armR': {
      const side = name === 'armL' ? -1 : 1;
      const bones = side < 0 ? [J.clavL, J.armL, J.foreL, J.handL] : [J.clavR, J.armR, J.foreR, J.handR];
      const t = q.t;
      const L1 = q.L1;
      const L = q.L1 + q.L2;
      const ta = sstep(-0.035 * s, 0.06 * s, t);
      const te = sstep(L1 - 0.04 * s, L1 + 0.04 * s, t);
      const tw = sstep(L - 0.035 * s, L + 0.01 * s, t) * 0.6;
      acc[bones[0]] += k * (1 - ta) * 0.6;
      acc[J.chest] += k * (1 - ta) * 0.4;
      acc[bones[1]] += k * ta * (1 - te);
      acc[bones[2]] += k * ta * te * (1 - tw);
      acc[bones[3]] += k * ta * te * tw;
      return;
    }
    case 'neck': {
      const hy = fr.joints[J.head].y;
      const t = sstep(hy - 0.04 * s, hy + 0.02 * s, p.y);
      const tc = sstep(1.5 * s, 1.47 * s, p.y);
      acc[J.neck] += k * (1 - t) * (1 - tc);
      acc[J.head] += k * t;
      acc[J.chest] += k * tc * (1 - t);
      return;
    }
    case 'bootL':
    case 'bootR': {
      const side = name === 'bootL' ? -1 : 1;
      const A = fr.joints[side < 0 ? J.footL : J.footR];
      const t = sstep(A.y + 0.03 * s, A.y + 0.1 * s, p.y);
      acc[side < 0 ? J.footL : J.footR] += k * (1 - t);
      acc[side < 0 ? J.shinL : J.shinR] += k * t;
      return;
    }
    default:
      acc[J.hips] += k;
  }
}

/**
 * Arm-chain context for a bind-pose point: t (metres along the chain from the
 * shoulder joint), ang (angle around the arm axis, 0 = front), back-facing amount.
 */
function armContext(p, n, sl, q) {
  let qx = p.x - sl.sh.x;
  let qy = p.y - sl.sh.y;
  let qz = p.z - sl.sh.z;
  let d = sl.d1;
  let t = qx * d[0] + qy * d[1] + qz * d[2];
  let along = t;
  if (t > sl.L1) {
    qx = p.x - sl.E.x;
    qy = p.y - sl.E.y;
    qz = p.z - sl.E.z;
    d = sl.d2;
    along = qx * d[0] + qy * d[1] + qz * d[2];
    t = sl.L1 + along;
  }
  // radial vector from the axis, measured against "front" (−Z made perpendicular to the axis)
  const wx = qx - d[0] * along;
  const wy = qy - d[1] * along;
  const wz = qz - d[2] * along;
  let fx = -d[0] * -d[2];
  let fy = -d[1] * -d[2];
  let fz = -1 - d[2] * -d[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // e2 = d × f
  const ex = d[1] * fz - d[2] * fy;
  const ey = d[2] * fx - d[0] * fz;
  const ez = d[0] * fy - d[1] * fx;
  q.ang = Math.atan2(wx * ex + wy * ey + wz * ez, wx * fx + wy * fy + wz * fz);
  q.t = t;
  q.L1 = sl.L1;
  q.L2 = sl.L2;
  q.back = n.z; // +Z = back of the character
  return q;
}

// ------------------------------------------------------------ sculpted body
/** Polygonizes the sculpt and appends the skinned body to builder b. */
function addSculptedBody(b, app, fr, pal, lod) {
  const sc = sculptBody(app, fr);
  const { model, info } = sc;
  const s = fr.s;
  const hero = lod === 0;
  const cell = (hero ? 0.0135 : 0.034) * s;
  const mesh = polygonize(model, { min: sc.min, max: sc.max, cell, block: hero ? 8 : 4, project: hero ? 1 : 0 });
  const n = mesh.count;
  const P = mesh.positions;
  const N = mesh.normals;
  const slot = slots(app, fr, pal, info);
  const partNames = model.parts;
  const partD = new Float32Array(model.partCount);
  const acc = new Float32Array(BONE_COUNT);
  const sigma = Math.max(0.008, cell * 0.75);
  const q = { t: 0, L1: 0, L2: 0, back: 0 };
  // wide culling lists for AO rays (per block, lazily)
  const aoLists = new Map();
  const aoList = (bi) => {
    let e = aoLists.get(bi);
    if (!e) {
      const bl = mesh.blocks[bi];
      const cx = sc.min[0] - cell + ((bl.i0 + bl.i1) / 2) * cell;
      const cy = sc.min[1] - cell + ((bl.j0 + bl.j1) / 2) * cell;
      const cz = sc.min[2] - cell + ((bl.k0 + bl.k1) / 2) * cell;
      const list = new Int32Array(model.prims.length);
      const cnt = model.cull(cx, cy, cz, (bl.i1 - bl.i0) * cell * 0.87 + 0.09 * s, list);
      e = { list, n: cnt };
      aoLists.set(bi, e);
    }
    return e;
  };
  const out = {
    position: P,
    normal: N,
    uv: new Float32Array(n * 2),
    color: new Float32Array(n * 3),
    aMat: new Float32Array(n * 4),
    aDetail: new Float32Array(n),
    skinIndex: new Uint16Array(n * 4),
    skinWeight: new Float32Array(n * 4),
    index: mesh.indices,
  };
  const p = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const top = [0, 0, 0, 0];
  const topW = [0, 0, 0, 0];
  for (let v = 0; v < n; v++) {
    p.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    nn.set(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    const bl = mesh.blocks[mesh.vertexBlock[v]];
    const pi = model.query(p.x, p.y, p.z, bl.list, bl.n, partD);
    const prim = pi >= 0 ? model.prims[pi] : null;
    const matName = prim ? prim.mat : 'jacket';
    const sl = slot[matName] || slot.jacket;
    // ---- part blend → bone weights
    let dmin = 1e9;
    for (let k = 0; k < partD.length; k++) if (partD[k] < dmin) dmin = partD[k];
    acc.fill(0);
    let armSide = 0;
    for (let k = 0; k < partD.length; k++) {
      const dd = partD[k] - dmin;
      if (dd > sigma * 5) continue;
      const w = Math.exp(-dd / sigma);
      const name = partNames[k];
      if (name === 'armL' || name === 'armR') {
        armSide = name === 'armL' ? -1 : 1;
        armContext(p, nn, info.sleeves[armSide], q);
      }
      partWeights(name, p, w, acc, fr, info, q);
    }
    // top 4 bones
    for (let k = 0; k < 4; k++) {
      top[k] = 0;
      topW[k] = 0;
    }
    for (let bi = 0; bi < BONE_COUNT; bi++) {
      const w = acc[bi];
      if (w <= topW[3]) continue;
      let k = 3;
      while (k > 0 && topW[k - 1] < w) {
        topW[k] = topW[k - 1];
        top[k] = top[k - 1];
        k--;
      }
      topW[k] = w;
      top[k] = bi;
    }
    const sum = topW[0] + topW[1] + topW[2] + topW[3] || 1;
    for (let k = 0; k < 4; k++) {
      out.skinIndex[v * 4 + k] = top[k];
      out.skinWeight[v * 4 + k] = topW[k] / sum;
    }
    // ---- colour (+ baked AO)
    if (matName === 'sleeve' || matName === 'cuff') {
      const side = armSide || (p.x < 0 ? -1 : 1);
      armContext(p, nn, info.sleeves[side], q);
    }
    const c = sl.color(p, nn, q);
    const ae = aoList(mesh.vertexBlock[v]);
    const ao = fieldAO(model, p.x, p.y, p.z, nn.x, nn.y, nn.z, ae.list, ae.n, (hero ? 0.009 : 0.014) * s, hero ? 3 : 2, 1);
    const shade = matName === 'skin' ? 0.78 + 0.22 * ao : 0.5 + 0.5 * ao;
    out.color[v * 3] = c.r * shade;
    out.color[v * 3 + 1] = c.g * shade;
    out.color[v * 3 + 2] = c.b * shade;
    const mk = MATS[sl.kind];
    out.aMat[v * 4] = (mk.skin ? -1 : 1) * mk.rough;
    out.aMat[v * 4 + 1] = mk.metal;
    out.aMat[v * 4 + 2] = 0;
    out.aMat[v * 4 + 3] = mk.sheen;
    out.aDetail[v] = mk.detail;
    // ---- mirrored cylindrical UVs (continuous; mirror seams on the centre lines)
    let u;
    let vv;
    if (armSide && (matName === 'sleeve' || matName === 'cuff')) {
      u = Math.abs(q.ang) * 0.05;
      vv = q.t;
    } else if (p.y < 0.9 * s && Math.abs(p.x) > 0.02 * s && matName !== 'jacket') {
      const lx = p.x < 0 ? fr.joints[J.thighL].x : fr.joints[J.thighR].x;
      u = Math.abs(Math.atan2(p.x - lx, -p.z)) * 0.07;
      vv = p.y;
    } else {
      u = Math.abs(Math.atan2(p.x, -p.z)) * 0.16;
      vv = p.y;
    }
    out.uv[v * 2] = u * 9;
    out.uv[v * 2 + 1] = vv * 9;
  }
  b.addArrays(out);
  return { sculpt: sc, triangles: mesh.indices.length / 3, vertices: n };
}

// ---------------------------------------------------------------- main entry
/** Adds the body + outfit + gear for `app` to builder b (b must be built with the frame). */
export function addBody(b, app, fr, lod) {
  const pal = palette(app);
  const L = {
    lod,
    limbU: lod === 0 ? 14 : 9,
    torsoU: lod === 0 ? 36 : 18,
  };
  const res = addSculptedBody(b, app, fr, pal, lod);
  const S = new BodySurface(res.sculpt);
  addGear(b, app, fr, pal, L, S);
  return pal;
}

export { _col as _bodyColor, sstep as _sstep };
