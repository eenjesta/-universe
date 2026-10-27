/**
 * Gear and garment extras (characters module) placed on the sculpted body:
 * hands (fingers + thumb, or gloves), the Ø backpack (big white Ø, straps,
 * buckles, bedroll), belt + pouches, front zipper, Ø shoulder patch, holo
 * tablet, scout harness, vanguard light seams, drifter coat / robe skirts,
 * nomad poncho, robe shawl + sash + necklace. BodySurface answers surface
 * queries against the body's distance field (projections, rays, normals) so
 * straps and belts hug the real silhouette. Rest-pose parts on the arms are
 * converted to the A-pose bind by GeoBuilder.add (see builder.js).
 */
import * as THREE from 'three';
import { gridGeometry, tubeGeometry, superEllipsoid, mat, setW, cached, spow } from './builder.js';
import { J } from './skeleton.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (hex) => new THREE.Color(hex);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const _col = new THREE.Color();

/** Surface kinds → shading parameters (per-vertex aMat, see material.js). */
export const MATS = {
  fabric: { rough: 0.84, metal: 0, sheen: 0.45, detail: 0.3 },
  fabricSoft: { rough: 0.9, metal: 0, sheen: 0.6, detail: 0.28 },
  leather: { rough: 0.5, metal: 0, sheen: 0.18, detail: 0.22 },
  rubber: { rough: 0.92, metal: 0, sheen: 0.05, detail: 0.15 },
  webbing: { rough: 0.82, metal: 0, sheen: 0.12, detail: 0.6 },
  metal: { rough: 0.32, metal: 0.92, sheen: 0, detail: 0 },
  plate: { rough: 0.36, metal: 0.55, sheen: 0.05, detail: 0.08 },
  print: { rough: 0.62, metal: 0, sheen: 0.3, detail: 0.25 },
  skin: { rough: 0.5, metal: 0, sheen: 0.15, detail: 0, skin: true },
};
export const style = (kind, color, extra) => ({ ...MATS[kind], color, ...extra });

// -------------------------------------------------------------- surface
/** Queries against the sculpted body field (bind pose; the torso equals the rest pose). */
export class BodySurface {
  constructor(sculpt) {
    this.sc = sculpt;
    this.model = sculpt.model;
    this.info = sculpt.info;
    const n = this.model.prims.length;
    this.all = new Int32Array(n);
    for (let i = 0; i < n; i++) this.all[i] = i;
    this.list = this.all;
    this.n = n;
    // culled primitive lists per 8 cm height band around the torso axis (most queries hug the torso)
    this.bands = new Map();
  }

  /** Selects the primitive list for queries near height y (torso-centred, generous radius). */
  focus(y) {
    const k = Math.round(y / 0.08);
    let e = this.bands.get(k);
    if (!e) {
      const list = new Int32Array(this.model.prims.length);
      const n = this.model.cull(0, k * 0.08, 0, 0.42, list);
      e = { list, n };
      this.bands.set(k, e);
    }
    this.list = e.list;
    this.n = e.n;
  }

  unfocus() {
    this.list = this.all;
    this.n = this.all.length;
  }

  dist(x, y, z) {
    return this.model.dist(x, y, z, this.list, this.n);
  }

  normal(x, y, z, out = V()) {
    const e = 0.002;
    return out
      .set(
        this.dist(x + e, y, z) - this.dist(x - e, y, z),
        this.dist(x, y + e, z) - this.dist(x, y - e, z),
        this.dist(x, y, z + e) - this.dist(x, y, z - e),
      )
      .normalize();
  }

  /** First exit of the ray o + t·d (o inside the body); returns the surface point. */
  exit(ox, oy, oz, dx, dy, dz, out = V(), maxT = 0.7) {
    let t = 0;
    let d = this.dist(ox, oy, oz);
    // march (inside: |d| is a safe step) until outside
    let guard = 0;
    while (d < 0 && t < maxT && guard++ < 200) {
      t += Math.max(0.0015, -d * 0.9);
      d = this.dist(ox + dx * t, oy + dy * t, oz + dz * t);
    }
    let lo = Math.max(0, t - 0.02);
    let hi = t;
    if (this.dist(ox + dx * lo, oy + dy * lo, oz + dz * lo) > 0) lo = 0;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (this.dist(ox + dx * mid, oy + dy * mid, oz + dz * mid) < 0) lo = mid;
      else hi = mid;
    }
    return out.set(ox + dx * hi, oy + dy * hi, oz + dz * hi);
  }

  /** Surface point around the torso axis at height y, angle th (0 = front, +π/2 = +X), pushed out by off. */
  around(y, th, off = 0, out = V()) {
    this.focus(y);
    const dx = Math.sin(th);
    const dz = -Math.cos(th);
    this.exit(0, y, 0.01, dx, 0, dz, out);
    if (off) {
      const nn = this.normal(out.x, out.y, out.z, _n);
      out.addScaledVector(nn, off);
    }
    this.unfocus();
    return out;
  }

  /** Projects (x, y, z) horizontally from the torso axis onto the surface (+ off along the normal). */
  project(x, y, z, off = 0, out = V()) {
    return this.around(y, Math.atan2(x, -z), off, out);
  }

  /** Highest surface point above (x, z) (sphere-traced from above), + off upward. */
  top(x, z, off = 0, out = V()) {
    let y = 2.0;
    for (let i = 0; i < 200; i++) {
      const d = this.dist(x, y, z);
      if (d < 0.0004) break;
      y -= Math.max(0.0008, d * 0.9);
      if (y < 0.8) break;
    }
    return out.set(x, y + off, z);
  }
}
const _n = new THREE.Vector3();

// ---------------------------------------------------------------- helpers
/** Flat band/strap along a path lying on a surface (p.normal = outward normal per point). */
function strapGeometry(pts, width, thick, segs = 4) {
  const n = pts.length;
  return gridGeometry(
    segs,
    n - 1,
    (u, v, out) => {
      const i = Math.round(v * (n - 1));
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(n - 1, i + 1)];
      const t = V().subVectors(c, a).normalize();
      const nrm = p.normal || V(p.x, 0, p.z).normalize();
      const side = V().crossVectors(t, nrm).normalize();
      const th = u * TAU;
      const e = 0.5;
      out.copy(p).addScaledVector(nrm, spow(Math.cos(th), e) * (thick / 2)).addScaledVector(side, spow(Math.sin(th), e) * (width / 2));
    },
    { wrapU: true, uScale: 0.2, vScale: 1 },
  );
}

/** Guide points [x, y, z, top?] → points on the surface (+ off) with outward normals. */
function onSurfacePath(S, list, off) {
  return list.map(([x, y, z, top]) => {
    let p;
    if (top) {
      p = S.top(x, z, 0);
      const nn = S.normal(p.x, p.y, p.z);
      p.addScaledVector(nn, off);
      p.normal = nn.clone();
    } else {
      p = S.project(x, y, z, 0);
      S.focus(p.y);
      const nn = S.normal(p.x, p.y, p.z);
      S.unfocus();
      p.addScaledVector(nn, off);
      p.normal = nn.clone();
    }
    return p;
  });
}

function bandAround(S, y, off, segs) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const p = S.around(y, (i / segs) * TAU - Math.PI, 0);
    S.focus(y);
    const nn = S.normal(p.x, p.y, p.z);
    S.unfocus();
    nn.y *= 0.3;
    nn.normalize();
    p.addScaledVector(nn, off);
    p.normal = nn.clone();
    pts.push(p);
  }
  return pts;
}

/** Torso skin weights by height (shared by straps / belts lying on the jacket). */
export function torsoWeights(fr) {
  const s = fr.s;
  return (p, out) => {
    const y = p.y / s;
    const ax = Math.abs(p.x) / s;
    const clav = p.x < 0 ? J.clavL : J.clavR;
    const sh = sstep(0.09, 0.19, ax) * sstep(1.33, 1.45, y) * 0.55;
    if (y > 1.45) {
      const wn = sstep(1.52, 1.58, y) * 0.45;
      const rest = 1 - wn;
      setW(out, J.chest, rest * (1 - sh), J.neck, wn, clav, rest * sh);
      return;
    }
    const tH = sstep(0.98, 1.1, y);
    const tC = sstep(1.15, 1.27, y);
    setW(out, J.hips, 1 - tH, J.spine, tH * (1 - tC), J.chest, tC * (1 - sh), clav, tC * sh);
  };
}

const flipCache = new WeakMap();
function flipped(g) {
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

// ------------------------------------------------------------------ hands
function handGeometry(lod) {
  return cached(`hand2|${lod}`, () => {
    const parts = [];
    const palm = superEllipsoid(0.0145, 0.047, 0.041, 0.45, 0.5, lod === 0 ? 12 : 8, lod === 0 ? 8 : 5);
    palm.translate(0.002, -0.05, 0);
    parts.push(palm);
    const fingers = [
      [-0.027, 0.07, 0.0086, -0.088],
      [-0.0095, 0.078, 0.0089, -0.093],
      [0.0085, 0.073, 0.0084, -0.092],
      [0.0255, 0.06, 0.0074, -0.087],
    ];
    const segs = lod === 0 ? 6 : 4;
    for (const [z, len, r, y0] of fingers) {
      const pts = [V(0.001, y0 + 0.012, z)];
      const sec = [{ rx: r * 1.05, rf: r, rb: r }];
      let dir = V(0, -1, 0);
      let p = pts[0].clone();
      const curls = [0.2, 0.36, 0.4, 0.34];
      for (let i = 0; i < 4; i++) {
        dir = dir.clone().applyAxisAngle(V(0, 0, 1), -curls[i]);
        p = p.clone().addScaledVector(dir, len / 4 + (i === 0 ? 0.004 : 0));
        pts.push(p);
        sec.push({ rx: r * (1 - i * 0.07), rf: r * (1 - i * 0.08), rb: r * (1 - i * 0.08) });
      }
      parts.push(tubeGeometry(pts, sec, { segs, capEnd: true, capBulge: r * 0.8, ref: V(0, 0, -1) }));
    }
    const tp = [V(-0.004, -0.022, -0.026)];
    const ts = [{ rx: 0.0118, rf: 0.0112, rb: 0.0112 }];
    let d = V(-0.32, -0.62, -0.72).normalize();
    let q = tp[0].clone();
    for (let i = 0; i < 3; i++) {
      d = d.clone().applyAxisAngle(V(0, 1, 0), 0.22).applyAxisAngle(V(0, 0, 1), -0.12);
      q = q.clone().addScaledVector(d, 0.021);
      tp.push(q);
      ts.push({ rx: 0.0105 - i * 0.0008, rf: 0.0098 - i * 0.0008, rb: 0.0098 - i * 0.0008 });
    }
    parts.push(tubeGeometry(tp, ts, { segs, capEnd: true, capBulge: 0.008, ref: V(1, 0, 0) }));
    return parts;
  });
}

function addHands(b, app, fr, pal, L) {
  const parts = handGeometry(L.lod);
  const s = fr.s * (fr.f ? 0.93 : 1);
  const gl = app.gloves || app.outfit === 'vanguard';
  const st = gl ? style('leather', pal.glove) : style('skin', pal.skin);
  for (const side of [-1, 1]) {
    const W = fr.joints[side < 0 ? J.handL : J.handR];
    const m = mat(W.x, W.y, W.z, 0, 0, side * 0.06, side * s, s, s);
    for (const p of parts) b.add(side < 0 ? flipped(p) : p, m, st, side < 0 ? J.handL : J.handR);
  }
}

// ----------------------------------------------------------------- emblem
function emblemParts(lod) {
  return cached(`emblem|${lod}`, () => {
    const ring = new THREE.TorusGeometry(1, 0.1, lod === 0 ? 6 : 3, lod === 0 ? 48 : 18);
    const slash = new THREE.BoxGeometry(2.7, 0.19, 0.14);
    slash.rotateZ(Math.PI / 4);
    return [ring, slash];
  });
}

/** Ø emblem of radius r centred at c facing direction `facing` (unit). */
function addEmblem(b, lod, c, r, facing, color, bone, emis = 0, space = 'rest') {
  const [ring, slash] = emblemParts(lod);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), facing);
  const m = new THREE.Matrix4().compose(c, q, V(r, r, r * 0.6));
  const st = style('print', color, { emis });
  b.add(ring, m, st, bone, space);
  b.add(slash, m, st, bone, space);
}

// --------------------------------------------------------------- backpack
function addBackpack(b, app, fr, pal, L, S) {
  const s = fr.s;
  const big = app.backpack === 'tech';
  const w = (big ? 0.155 : 0.126) * s;
  const h = (big ? 0.22 : 0.162) * s;
  const d = (big ? 0.074 : 0.06) * s;
  const cy = (big ? 1.22 : 1.255) * s;
  // back surface at the pack's centre line (includes the hood bag)
  let backZ = 0;
  for (const yy of [cy - h * 0.5, cy, cy + h * 0.5]) backZ = Math.max(backZ, S.around(yy, Math.PI, 0).z);
  const cz = backZ + d + 0.006 * s;
  const packCol = app.outfit === 'scout' ? C('#8f8c86') : pal.main.clone().lerp(C('#1d1f23'), 0.35);
  const wfn = (p, out) => {
    const t = sstep(1.12 * s, 1.0 * s, p.y);
    setW(out, J.chest, 1 - t * 0.6, J.spine, t * 0.6);
  };
  const body = cached(`pack|${L.lod}`, () => superEllipsoid(1, 1, 1, 0.28, 0.32, L.lod === 0 ? 24 : 12, L.lod === 0 ? 16 : 8));
  const shade = (p, n) => {
    _col.copy(packCol);
    if (n.z < -0.5) _col.multiplyScalar(0.6);
    if (p.y < cy - h * 0.55 && n.z > 0.3) _col.multiplyScalar(0.82);
    // soft top-light / bottom shadow
    _col.multiplyScalar(0.85 + 0.15 * clamp01(n.y + 0.5));
    return _col;
  };
  b.add(body, mat(0, cy, cz, 0.05, 0, 0, w, h, d), style('fabric', shade, { uvScale: 3 }), wfn);
  b.add(body, mat(0, cy - h * 0.62, cz + d * 0.62, 0.05, 0, 0, w * 0.8, h * 0.3, d * 0.42), style('fabric', packCol.clone().multiplyScalar(0.88), { uvScale: 3 }), wfn);
  const handle = cached('handle', () => new THREE.TorusGeometry(1, 0.22, 5, 12, Math.PI));
  b.add(handle, mat(0, cy + h * 0.97, cz - d * 0.1, 0, 0, 0, 0.032 * s, 0.022 * s, 0.03 * s), style('webbing', pal.straps), wfn);
  const sideStrap = cached('sidestrap', () => new THREE.BoxGeometry(1, 1, 1));
  for (const sx of [-1, 1]) {
    for (const dy of [0.35, -0.2]) {
      b.add(sideStrap, mat(sx * w * 0.98, cy + h * dy, cz, 0, 0, 0, 0.012 * s, 0.022 * s, d * 2.05), style('webbing', pal.straps), wfn);
    }
  }
  if (big) {
    const roll = cached(`roll|${L.lod}`, () => new THREE.CylinderGeometry(1, 1, 1, L.lod === 0 ? 16 : 8));
    b.add(roll, mat(0, cy - h - 0.038 * s, cz + 0.01 * s, 0, 0, Math.PI / 2, 0.042 * s, w * 2.1, 0.042 * s), style('fabricSoft', pal.straps.clone().lerp(packCol, 0.5), { uvScale: 4 }), wfn);
  }
  // the big Ø
  const er = (big ? 0.104 : 0.064) * s;
  addEmblem(b, L.lod, V(0, cy + h * (big ? 0.12 : 0.16), cz + d + 0.002 * s), er, V(0, -0.05, 1).normalize(), pal.emblem, J.chest, 0.55);
  // shoulder straps + sternum strap
  const tw = torsoWeights(fr);
  for (const sx of [-1, 1]) {
    const guide = [
      [sx * 0.1 * s, cy + h * 0.6, 0.16 * s],
      [sx * 0.104 * s, 1.43 * s, 0.1 * s],
      [sx * 0.102 * s, 0, 0.045 * s, true],
      [sx * 0.102 * s, 0, -0.012 * s, true],
      [sx * 0.106 * s, 1.43 * s, -0.12 * s],
      [sx * 0.1 * s, 1.34 * s, -0.13 * s],
      [sx * 0.096 * s, 1.24 * s, -0.13 * s],
      [sx * 0.105 * s, 1.14 * s, -0.12 * s],
      [sx * 0.135 * s, 1.07 * s, -0.08 * s],
    ];
    const pts = onSurfacePath(S, guide, 0.006 * s);
    b.add(strapGeometry(pts, 0.048 * s, 0.008 * s), null, style('webbing', pal.straps, { uvScale: 20 }), tw);
    const bk = pts[6];
    const buckle = cached('buckle', () => new THREE.BoxGeometry(1, 1, 1));
    b.add(buckle, mat(bk.x, bk.y, bk.z - 0.004 * s, 0, 0, 0, 0.04 * s, 0.022 * s, 0.008 * s), style('metal', pal.darkMetal), J.chest);
  }
  const sy = 1.3 * s;
  const sp = onSurfacePath(S, [[-0.1 * s, sy, -0.2], [-0.05 * s, sy, -0.2], [0, sy, -0.2], [0.05 * s, sy, -0.2], [0.1 * s, sy, -0.2]], 0.012 * s);
  b.add(strapGeometry(sp, 0.022 * s, 0.006 * s), null, style('webbing', pal.straps), J.chest);
  const clip = cached('clip', () => new THREE.BoxGeometry(1, 1, 1));
  b.add(clip, mat(sp[2].x, sp[2].y, sp[2].z - 0.004, 0, 0, 0, 0.034 * s, 0.026 * s, 0.01 * s), style('metal', pal.darkMetal), J.chest);
}

// ------------------------------------------------------------- belt etc.
function addBelt(b, app, fr, pal, L, S, y) {
  const s = fr.s;
  const pts = bandAround(S, y, 0.005 * s, L.limbU + 14);
  const beltCol = pal.straps.clone().lerp(C('#3a2a20'), app.outfit === 'ranger' ? 0.6 : 0);
  b.add(strapGeometry(pts, 0.042 * s, 0.009 * s), null, style('leather', beltCol), torsoWeights(fr));
  const front = S.around(y, 0, 0.012 * s);
  const buckle = cached('beltbuckle', () => new THREE.BoxGeometry(1, 1, 1));
  b.add(buckle, mat(front.x, front.y, front.z, 0, 0, 0, 0.052 * s, 0.036 * s, 0.01 * s), style('metal', pal.metal), J.hips);
  const pouch = cached(`pouch|${L.lod}`, () => superEllipsoid(1, 1, 1, 0.3, 0.35, L.lod === 0 ? 12 : 6, L.lod === 0 ? 8 : 4));
  const spots = [[2.05, 0.05, 0.06, 0.03], [-2.2, 0.045, 0.055, 0.028], [1.45, 0.035, 0.05, 0.026]];
  for (const [th, pw, ph, pd] of spots) {
    const p = S.around(y - 0.022 * s, th, pd * s * 0.8);
    const n = V(p.x, 0, p.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, -1), n.clone().negate());
    const m = new THREE.Matrix4().compose(p, q, V(pw * s, ph * s, pd * s));
    b.add(pouch, m, style('fabric', pal.straps.clone().lerp(pal.main, 0.3), { uvScale: 2 }), J.hips);
    const flap = new THREE.Matrix4().compose(p.clone().add(V(0, ph * s * 0.55, 0)).addScaledVector(n, 0.004), q, V(pw * s * 1.04, ph * s * 0.4, pd * s * 1.05));
    b.add(pouch, flap, style('fabric', pal.straps, { uvScale: 2 }), J.hips);
  }
}

/** Front zipper / placket: a thin strip on the centre line. */
function addZipper(b, app, fr, pal, S, y0, y1) {
  const s = fr.s;
  const pts = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const y = lerp(y0, y1, i / n);
    const p = S.around(y, 0, 0.0012 * s);
    p.normal = S.normal(p.x, p.y, p.z).clone();
    pts.push(p);
  }
  const zc = pal.light ? pal.main.clone().multiplyScalar(0.55) : C('#2e3238');
  b.add(strapGeometry(pts, 0.0085 * s, 0.003 * s, 4), null, style('metal', zc, { rough: 0.45, metal: 0.6 }), torsoWeights(fr));
}

function addPatch(b, app, fr, pal, L, S) {
  const s = fr.s;
  const sl = S.info.sleeves[1];
  const t = 0.32 * sl.L1;
  const ax = V(sl.sh.x + sl.d1[0] * t, sl.sh.y + sl.d1[1] * t, sl.sh.z + sl.d1[2] * t);
  // lateral direction (perpendicular to the arm in the XY plane), turned a little toward the back
  const out = V(-sl.d1[1], sl.d1[0], 0).normalize();
  if (out.x < 0) out.negate();
  const dir = out.multiplyScalar(Math.cos(0.5)).add(V(0, 0, Math.sin(0.5))).normalize();
  const hit = S.exit(ax.x, ax.y, ax.z, dir.x, dir.y, dir.z);
  const nn = S.normal(hit.x, hit.y, hit.z);
  const center = hit.addScaledVector(nn, 0.0015);
  const disc = cached(`patch|${L.lod}`, () => {
    const g = new THREE.CylinderGeometry(1, 1, 1, L.lod === 0 ? 28 : 12);
    g.rotateX(Math.PI / 2);
    return g;
  });
  // orient: face along the normal, emblem upright along the arm axis
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), nn);
  const pr = 0.034 * s;
  b.add(disc, new THREE.Matrix4().compose(center, q, V(pr, pr, 0.004)), style('print', C('#1a1c21')), J.armR, 'bind');
  if (L.lod === 0) addEmblem(b, L.lod, center.clone().addScaledVector(nn, 0.0025), pr * 0.55, nn, pal.emblem, J.armR, 0.45, 'bind');
}

function addTablet(b, app, fr, pal, L) {
  const s = fr.s;
  const c = V(-0.02 * s, 1.08 * s, -0.27 * s);
  const tab = cached('tablet', () => new THREE.BoxGeometry(1, 1, 1));
  const m = mat(c.x, c.y, c.z, -0.75, 0.12, 0, 0.21 * s, 0.014 * s, 0.14 * s);
  b.add(tab, m, style('plate', C('#16181c')), J.chest);
  const scr = mat(c.x, c.y + 0.008 * s * Math.cos(0.75), c.z - 0.008 * s * Math.sin(0.75), -0.75, 0.12, 0, 0.19 * s, 0.004 * s, 0.12 * s);
  b.add(tab, scr, { color: (p) => _col.copy(C('#58d8ff')).multiplyScalar(0.7 + 0.3 * Math.sin(p.x * 400) * Math.sin(p.z * 300)), rough: 0.2, metal: 0, emis: 2.2, sheen: 0 }, J.chest);
}

function addHarnessX(b, fr, pal, S) {
  const s = fr.s;
  const tw = torsoWeights(fr);
  for (const sx of [-1, 1]) {
    const guide = [
      [sx * 0.1 * s, 0, 0.02 * s, true],
      [sx * 0.1 * s, 1.42 * s, -0.14 * s],
      [sx * 0.04 * s, 1.3 * s, -0.2 * s],
      [-sx * 0.04 * s, 1.18 * s, -0.2 * s],
      [-sx * 0.11 * s, 1.03 * s, -0.15 * s],
    ];
    const pts = onSurfacePath(S, guide, 0.005 * s);
    b.add(strapGeometry(pts, 0.036 * s, 0.006 * s), null, style('webbing', pal.straps), tw);
  }
  const p = S.around(1.24 * s, 0, 0.012 * s);
  const ringG = cached('harnessring', () => new THREE.TorusGeometry(1, 0.25, 6, 16));
  b.add(ringG, mat(p.x, p.y, p.z, 0, 0, 0, 0.02 * s), style('metal', pal.metal), J.chest);
}

function addBackPrint(b, fr, pal, L, S, color) {
  const s = fr.s;
  const p = S.around(1.3 * s, Math.PI, 0.0035);
  addEmblem(b, L.lod, p, 0.07 * s, V(0, 0, 1), color, J.chest, 0.4);
}

/** Vanguard: glowing cyan seams on the armour (chest V, belt line, shoulders, forearms, shins). */
function addArmourSeams(b, fr, pal, L, S) {
  const s = fr.s;
  const seamSt = { color: pal.seam, rough: 0.3, metal: 0, emis: 2.6, sheen: 0, detail: 0 };
  const tw = torsoWeights(fr);
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const p = S.project(sx * lerp(0.02, 0.12, t) * s, lerp(1.2, 1.38, t) * s, -0.3, 0.0012 * s);
      p.normal = S.normal(p.x, p.y, p.z).clone();
      pts.push(p);
    }
    b.add(strapGeometry(pts, 0.005 * s, 0.003 * s, 4), null, seamSt, tw);
  }
  const belt = [];
  for (let i = 0; i <= 10; i++) {
    const p = S.project(lerp(-0.1, 0.1, i / 10) * s, 1.05 * s, -0.3, 0.0012 * s);
    p.normal = S.normal(p.x, p.y, p.z).clone();
    belt.push(p);
  }
  b.add(strapGeometry(belt, 0.005 * s, 0.003 * s, 4), null, seamSt, tw);
  // shin + forearm stripes (rest pose, converted by the builder)
  const box = cached('seambox', () => new THREE.BoxGeometry(1, 1, 1));
  for (const side of [-1, 1]) {
    const K = fr.joints[side < 0 ? J.shinL : J.shinR];
    const A = fr.joints[side < 0 ? J.footL : J.footR];
    const sc = V().lerpVectors(K, A, 0.42);
    const zf = S.exit(sc.x, sc.y, sc.z, 0, 0, -1).z;
    b.add(box, mat(sc.x, sc.y, zf - 0.001, 0, 0, 0, 0.006 * s, 0.16 * s, 0.004 * s), seamSt, side < 0 ? J.shinL : J.shinR);
    const E = fr.joints[side < 0 ? J.foreL : J.foreR];
    const W = fr.joints[side < 0 ? J.handL : J.handR];
    const fc = V().lerpVectors(E, W, 0.5);
    b.add(box, mat(fc.x + side * 0.05 * s, fc.y, fc.z, 0, 0, 0, 0.004 * s, 0.13 * s, 0.006 * s), seamSt, side < 0 ? J.foreL : J.foreR);
  }
  const collar = cached(`vcollar|${L.lod}`, () => {
    const g = new THREE.TorusGeometry(1, 0.05, 4, L.lod === 0 ? 32 : 16);
    g.rotateX(Math.PI / 2);
    return g;
  });
  b.add(collar, mat(0, 1.548 * s, 0.014 * s, 0, 0, 0, 0.07 * s, 0.4, 0.062 * s), { ...seamSt, emis: 1.6 }, J.chest);
}

/** Open (front split) long skirt from the waist: drifter coat / robe. */
function addSkirt(b, app, fr, pal, L, S, { y0, y1, flare, gap, colorFn, inner }) {
  const s = fr.s;
  const jt = S.info.jt;
  const yMin = S.info.yHem + 0.01 * s;
  const nu = L.torsoU;
  const nv = L.lod === 0 ? 12 : 5;
  const pos = (u, v, out, off) => {
    const th = gap + u * (TAU - 2 * gap); // 0 = front: the opening stays at the front
    const tt = th > Math.PI ? th - TAU : th;
    const y = lerp(y0, y1, v);
    const r = jt.radius(Math.max(y, yMin), tt) * (1 + flare * sstep(0, 1, v)) + off;
    out.set(Math.sin(th) * r, y, -Math.cos(th) * r);
    out.x += Math.sin(th * 7) * 0.004 * v;
    out.z += Math.cos(th * 9) * 0.004 * v;
  };
  const outer = gridGeometry(nu, nv, (u, v, out) => pos(u, v, out, 0.012 * s), { uScale: 9, vScale: (y0 - y1) * 9 });
  const innerG = gridGeometry(nu, nv, (u, v, out) => pos(u, v, out, 0.004 * s), { flip: true, uScale: 9, vScale: (y0 - y1) * 9 });
  const w = (p, out) => {
    const v = clamp01((y0 - p.y) / (y0 - y1));
    const th = Math.atan2(p.x, -p.z);
    const right = Math.max(0, Math.cos(th - 0.6)) ** 1.5;
    const left = Math.max(0, Math.cos(th + 0.6)) ** 1.5;
    const back = Math.max(0, -Math.cos(th));
    const k = sstep(0.05, 0.8, v);
    const wr = k * (right * 0.75 + back * 0.25);
    const wl = k * (left * 0.75 + back * 0.25);
    setW(out, J.hips, Math.max(0.05, 1 - wr - wl), J.thighR, wr, J.thighL, wl);
  };
  b.add(outer, null, style('fabric', colorFn, { uvScale: 1 }), w);
  b.add(innerG, null, style('fabric', inner, { uvScale: 1 }), w);
}

function addPoncho(b, app, fr, pal, L) {
  const s = fr.s;
  const nu = L.torsoU + 8;
  const nv = L.lod === 0 ? 16 : 7;
  const rows = [
    [1.548, 0.09, 0.075, 0.084],
    [1.52, 0.14, 0.1, 0.11],
    [1.48, 0.24, 0.14, 0.15],
    [1.42, 0.28, 0.165, 0.175],
    [1.3, 0.305, 0.195, 0.205],
    [1.1, 0.33, 0.225, 0.24],
    [0.9, 0.35, 0.25, 0.265],
  ];
  const ring = (y) => {
    for (let i = 1; i < rows.length; i++) {
      if (y >= rows[i][0]) {
        const t = (y - rows[i][0]) / (rows[i - 1][0] - rows[i][0]);
        return [lerp(rows[i][1], rows[i - 1][1], t), lerp(rows[i][2], rows[i - 1][2], t), lerp(rows[i][3], rows[i - 1][3], t)];
      }
    }
    const l = rows[rows.length - 1];
    return [l[1], l[2], l[3]];
  };
  const ragged = (th) => 0.03 * Math.sin(th * 5) + 0.02 * Math.sin(th * 13 + 1) + 0.012 * Math.sin(th * 29);
  const g = gridGeometry(
    nu,
    nv,
    (u, v, out) => {
      const th = u * TAU;
      const back = -Math.cos(th);
      const yb = 0.86 - 0.06 * Math.max(0, back) + ragged(th) * v;
      const y = lerp(1.548, yb, v);
      const [a, bf, bb] = ring(y);
      const e = 2 / 2.4;
      const sn = Math.sin(th);
      const cs = Math.cos(th);
      out.set(spow(sn, e) * a * s * fr.g ** 0.3, y * s, -spow(cs, e) * (cs >= 0 ? bf : bb) * s);
      out.x += Math.sin(th * 11) * 0.006 * v * s;
      out.z += Math.cos(th * 8) * 0.006 * v * s;
    },
    { wrapU: true, uScale: 9, vScale: 6 },
  );
  const w = (p, out) => {
    const y = p.y / s;
    const side = Math.abs(p.x) / s;
    const arm = sstep(0.18, 0.3, side) * sstep(1.45, 1.3, y) * 0.45;
    const tC = sstep(1.0, 1.2, y);
    const bone = p.x < 0 ? J.armL : J.armR;
    setW(out, J.chest, tC * (1 - arm), J.spine, (1 - tC) * (1 - arm), bone, arm);
  };
  const col = (p, n, i) => {
    const v = g.attributes.uv.getY(i) / 6;
    _col.copy(pal.main);
    if (v > 0.93) _col.multiplyScalar(0.7);
    const stripe = Math.abs(p.y / s - 0.97) < 0.014;
    if (stripe) _col.lerp(pal.accent, 0.22).multiplyScalar(0.62);
    // folds: darker in the creases
    _col.multiplyScalar(0.82 + 0.18 * (0.5 + 0.5 * Math.sin(Math.atan2(p.x, -p.z) * 11)) * (0.4 + 0.6 * v));
    return _col.multiplyScalar(0.9 + 0.1 * Math.sin(i * 0.37));
  };
  b.add(g, null, style('fabricSoft', col, { uvScale: 1 }), w);
  b.add(flipped(g), new THREE.Matrix4().makeScale(0.985, 1, 0.985), style('fabricSoft', pal.main.clone().multiplyScalar(0.45), { uvScale: 1 }), w);
}

function addShawl(b, app, fr, pal, L, S) {
  const s = fr.s;
  const trim = pal.trim;
  const pts = [];
  const sec = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const a = -2.5 + (i / (n - 1)) * 5.0;
    pts.push(V(Math.sin(a) * 0.118 * s, (1.505 - 0.02 * Math.cos(a)) * s, Math.cos(a) * 0.104 * s + 0.006));
    sec.push({ rx: 0.042 * s, rf: 0.021 * s, rb: 0.021 * s });
  }
  const g = tubeGeometry(pts, sec, { segs: L.limbU, ref: V(0, 1, 0), capStart: true, capEnd: true, uvAround: 0.2 });
  const col = (p, n2, i) => {
    const u = g.attributes.uv.getX(i);
    const v = g.attributes.uv.getY(i);
    return Math.sin(v * 70) > 0.6 ? _col.copy(trim) : Math.sin(u * 40 + v * 30) > 0.5 ? _col.copy(C('#7a2a22')) : _col.copy(C('#3e2a1e'));
  };
  b.add(g, null, style('fabricSoft', col, { uvScale: 6 }), (p, out) => setW(out, J.chest, 0.8, J.neck, 0.2));
  for (const sx of [-1, 1]) {
    const pts2 = [];
    for (const [yy, zz] of [[1.47, -0.115], [1.32, -0.14], [1.16, -0.136], [1.02, -0.13]]) {
      const p = S.project(sx * 0.075 * s, yy * s, zz * s, 0.006 * s);
      pts2.push(p);
    }
    const es = pts2.map(() => ({ rx: 0.026 * s, rf: 0.006 * s, rb: 0.006 * s, n: 4 }));
    const eg = tubeGeometry(pts2, es, { segs: 8, ref: V(0, 0, -1), capStart: true, capEnd: true, uvAround: 0.1 });
    b.add(eg, null, style('fabricSoft', (p) => (Math.sin(p.y * 160) > 0.82 ? _col.copy(trim).multiplyScalar(0.8) : _col.copy(C('#4a2219'))), { uvScale: 5 }), torsoWeights(fr));
  }
  const neck = cached('necklace2', () => {
    const g2 = new THREE.TorusGeometry(1, 0.045, 4, 20, Math.PI);
    g2.rotateZ(Math.PI);
    return g2;
  });
  const nz = S.around(1.42 * s, 0, 0).z;
  b.add(neck, mat(0, 1.47 * s, nz * 0.55, -0.35, 0, 0, 0.078 * s, 0.1 * s, 0.07 * s), style('metal', C('#c9a25a')), J.chest);
  const bead = cached('bead', () => new THREE.SphereGeometry(1, 8, 6));
  for (let k = -2; k <= 2; k++) {
    const y = (1.36 - Math.abs(k) * 0.012) * s;
    const bp = S.project(k * 0.022 * s, y, -0.3, 0.008 * s);
    b.add(bead, mat(bp.x, bp.y, bp.z, 0, 0, 0, (k === 0 ? 0.013 : 0.008) * s), style('metal', C(k === 0 ? '#5fb7c9' : '#c9a25a'), k === 0 ? { metal: 0.3, rough: 0.15, emis: 0.6 } : {}), J.chest);
  }
  // sash
  const sash = bandAround(S, 0.99 * s, 0.012 * s, L.limbU + 10);
  b.add(strapGeometry(sash, 0.07 * s, 0.012 * s), null, style('fabricSoft', pal.trim.clone().multiplyScalar(0.75)), torsoWeights(fr));
}

// ---------------------------------------------------------------- entry
/** Adds all gear for the outfit + appearance. */
export function addGear(b, app, fr, pal, L, S) {
  const o = app.outfit;
  const s = fr.s;
  addHands(b, app, fr, pal, L);
  const beltY = (fr.f ? 0.985 : 0.975) * s;
  if (o === 'pathfinder') {
    if (L.lod === 0) addZipper(b, app, fr, pal, S, S.info.yHem + 0.01 * s, 1.5 * s);
    addBelt(b, app, fr, pal, L, S, beltY);
  } else if (o === 'scout') {
    addHarnessX(b, fr, pal, S);
    addBelt(b, app, fr, pal, L, S, beltY + 0.01 * s);
  } else if (o === 'ranger') {
    if (L.lod === 0) addZipper(b, app, fr, pal, S, S.info.yHem + 0.01 * s, 1.49 * s);
    addBelt(b, app, fr, pal, L, S, beltY - 0.04 * s);
  } else if (o === 'nomad') {
    addPoncho(b, app, fr, pal, L);
  } else if (o === 'vanguard') {
    addArmourSeams(b, fr, pal, L, S);
    addBelt(b, app, fr, { ...pal, straps: C('#1a1c20') }, L, S, beltY + 0.01 * s);
  } else if (o === 'drifter') {
    addSkirt(b, app, fr, pal, L, S, {
      y0: 0.99 * s,
      y1: 0.43 * s,
      flare: 0.22,
      gap: 0.2,
      colorFn: (p) => _col.copy(pal.main).multiplyScalar(p.y < 0.47 * s ? 0.75 : 1),
      inner: pal.lining.clone().lerp(C('#2a1d18'), 0.4),
    });
    if (L.lod === 0) addZipper(b, app, fr, pal, S, 1.0 * s, 1.5 * s);
    addBelt(b, app, fr, pal, L, S, 0.99 * s);
  } else if (o === 'robe') {
    addSkirt(b, app, fr, pal, L, S, {
      y0: 1.0 * s,
      y1: 0.12 * s,
      flare: 0.4,
      gap: 0.06,
      colorFn: (p) => {
        _col.copy(pal.main);
        const y = p.y / s;
        if (y < 0.22 && Math.sin(p.x * 160 + p.z * 160) > -0.2) _col.copy(pal.trim);
        if (y < 0.19 || (y > 0.235 && y < 0.25)) _col.copy(pal.trim).multiplyScalar(0.8);
        return _col;
      },
      inner: C('#2a1a12'),
    });
    addShawl(b, app, fr, pal, L, S);
  } else if (o === 'tech') {
    addBelt(b, app, fr, pal, L, S, beltY);
    addBackPrint(b, fr, pal, L, S, C('#d8d2c6'));
  }
  if (app.backpack !== 'none' && o !== 'nomad' && o !== 'robe') addBackpack(b, app, fr, pal, L, S);
  else if (o === 'pathfinder' || o === 'drifter' || o === 'vanguard') addBackPrint(b, fr, pal, L, S, pal.emblem);
  if (app.patch && o !== 'robe' && o !== 'nomad') addPatch(b, app, fr, pal, L, S);
  if (app.prop === 'tablet') addTablet(b, app, fr, pal, L);
}
