import * as THREE from 'three';
import { uvRect } from './atlas.js';
import { Rng } from '../../core/math.js';

/**
 * Procedural plant geometry (real-world metres, base at y = 0, front −Z).
 * Near variants use alpha-tested atlas cards with authored "spherical"
 * normals and baked AO in vertex colours; every vertex has a `wind` weight
 * (0 at the root → 1 at the leaf tips). Far variants are tiny solid shapes
 * with matching average colours.
 *
 * `createPlantLibrary()` returns { near: {name: {geometry, meta}}, far: {...} }.
 */

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.wind = [];
    this.idx = [];
  }
  v(x, y, z, nx, ny, nz, u, vv, c, w) {
    this.pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nor.push(nx / l, ny / l, nz / l);
    this.uv.push(u, vv);
    this.col.push(c[0], c[1], c[2]);
    this.wind.push(w);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('wind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Tapered (optionally curved) trunk/branch: rings along `path` points. */
function tube(b, path, radii, { seg = 6, cell = 'bark', color = [1, 1, 1], wind0 = 0, wind1 = 0.2, uScale = 1 } = {}) {
  const r = uvRect(cell);
  const rings = [];
  const n = path.length;
  for (let k = 0; k < n; k++) {
    const p = path[k];
    const t = path[Math.min(n - 1, k + 1)].clone().sub(path[Math.max(0, k - 1)]).normalize();
    const a = Math.abs(t.y) < 0.95 ? V(0, 1, 0) : V(1, 0, 0);
    const s1 = V().crossVectors(t, a).normalize();
    const s2 = V().crossVectors(t, s1).normalize();
    const ring = [];
    const f = k / (n - 1);
    for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const nx = s1.x * Math.cos(ang) + s2.x * Math.sin(ang);
      const ny = s1.y * Math.cos(ang) + s2.y * Math.sin(ang);
      const nz = s1.z * Math.cos(ang) + s2.z * Math.sin(ang);
      const rr = radii[k];
      const ao = 0.62 + 0.38 * f;
      ring.push(b.v(p.x + nx * rr, p.y + ny * rr, p.z + nz * rr, nx, ny, nz, r.u0 + (r.u1 - r.u0) * (i / seg) * uScale, r.v0 + (r.v1 - r.v0) * f, shade(color, ao), wind0 + (wind1 - wind0) * f));
    }
    rings.push(ring);
  }
  for (let k = 0; k < n - 1; k++) {
    for (let i = 0; i < seg; i++) b.quad(rings[k][i], rings[k + 1][i], rings[k + 1][i + 1], rings[k][i + 1]);
  }
}

/**
 * A leaf card: quad centred on `c`, spanning `right` (half width vector) and
 * `up` (half height vector); `nrm` gives the authored normal per corner.
 */
function card(b, c, right, up, cell, nrmFn, colFn, windFn, flip = false) {
  const r = uvRect(cell);
  const corners = [
    [-1, -1, r.u0, r.v0],
    [1, -1, r.u1, r.v0],
    [1, 1, r.u1, r.v1],
    [-1, 1, r.u0, r.v1],
  ];
  const ids = corners.map(([sx, sy, u, v]) => {
    const p = V(c.x + right.x * sx + up.x * sy, c.y + right.y * sx + up.y * sy, c.z + right.z * sx + up.z * sy);
    const n = nrmFn(p);
    return b.v(p.x, p.y, p.z, n.x, n.y, n.z, flip ? r.u0 + r.u1 - u : u, v, colFn(p, sx, sy), windFn(p, sx, sy));
  });
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

/** Card spanning base→tip with a width profile (strip of `rows` rows). */
function strip(b, pts, widths, sideVecs, cell, nrms, cols, winds, { uAlong = true } = {}) {
  const r = uvRect(cell);
  const rows = pts.length;
  const ids = [];
  for (let k = 0; k < rows; k++) {
    const f = k / (rows - 1);
    const p = pts[k];
    const s = sideVecs[k];
    const w = widths[k];
    const pa = V().copy(p).addScaledVector(s, -w);
    const pb = V().copy(p).addScaledVector(s, w);
    const n = nrms[k];
    const ua = uAlong ? r.u0 + (r.u1 - r.u0) * f : r.u0;
    const ub = uAlong ? r.u0 + (r.u1 - r.u0) * f : r.u1;
    const va = uAlong ? r.v0 : r.v0 + (r.v1 - r.v0) * f;
    const vb = uAlong ? r.v1 : r.v0 + (r.v1 - r.v0) * f;
    ids.push([b.v(pa.x, pa.y, pa.z, n.x, n.y, n.z, ua, va, cols[k], winds[k]), b.v(pb.x, pb.y, pb.z, n.x, n.y, n.z, ub, vb, cols[k], winds[k])]);
  }
  for (let k = 0; k < rows - 1; k++) b.quad(ids[k][0], ids[k][1], ids[k + 1][1], ids[k + 1][0]);
}

function rotateAround(v, axis, ang) {
  return v.clone().applyAxisAngle(axis, ang);
}

// ===================================================================== trees
function pine(seed, o) {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  const H = o.height;
  const trunkTop = H * 0.97;
  tube(b, [V(0, -0.4, 0), V(0, H * 0.3, 0), V(0, H * 0.65, 0), V(0, trunkTop, 0)], [o.trunkR, o.trunkR * 0.72, o.trunkR * 0.4, o.trunkR * 0.08], { seg: 6, color: [0.85, 0.78, 0.72], wind1: 0.25 });
  const trunkR = (y) => o.trunkR * (1 - (y / H) * 0.9);
  const y0 = H * o.crownBase;
  const up = V(0, 1, 0);
  // dark inner foliage cone: fills the gaps between branch cards
  {
    const m = uvRect('needleMass');
    const seg = 7;
    const coreR = o.branchLen * 0.5;
    const yb = y0 + (H - y0) * 0.06;
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      ring.push(b.v(nx * coreR, yb, nz * coreR, nx, 0.5, nz, m.u0 + (m.u1 - m.u0) * (i / seg), m.v0, [0.5, 0.5, 0.5], 0.15));
    }
    const apex = b.v(0, H * 0.96, 0, 0, 1, 0, (m.u0 + m.u1) / 2, m.v1, [0.85, 0.85, 0.85], 0.5);
    for (let i = 0; i < seg; i++) b.tri(ring[i], apex, ring[i + 1]);
  }
  for (let t = 0; t < o.tiers; t++) {
    const f = t / (o.tiers - 1);
    const y = y0 + (H * 0.985 - y0) * Math.pow(f, 0.9);
    const lenBase = o.branchLen * (Math.pow(1 - f, 0.82) * 0.9 + 0.1) * (0.85 + rng.random() * 0.3);
    const n = Math.max(3, Math.round(o.perTier * (1 - f * 0.5)));
    for (let k = 0; k < n; k++) {
      const th = ((k + rng.random() * 0.55) / n) * Math.PI * 2 + t * 2.39996;
      const len = lenBase * (0.85 + rng.random() * 0.3);
      const droop = o.droop * (0.3 + 0.7 * (1 - f)) + (rng.random() - 0.5) * 0.18;
      const radial = V(Math.cos(th), 0, Math.sin(th));
      const dir = V(Math.cos(th), -droop, Math.sin(th)).normalize();
      let side = V(-Math.sin(th), 0, Math.cos(th));
      side = rotateAround(side, dir, (rng.random() - 0.5) * 1.1);
      const base = V(Math.cos(th) * trunkR(y) * 0.6, y, Math.sin(th) * trunkR(y) * 0.6);
      const mid = V().copy(base).addScaledVector(dir, len * 0.55);
      mid.y -= len * 0.04;
      const tip = V().copy(base).addScaledVector(dir, len);
      tip.y -= len * 0.12;
      const nrm = V().copy(radial).multiplyScalar(0.75).addScaledVector(up, 0.6).normalize();
      const nrmTip = V().copy(radial).multiplyScalar(0.9).addScaledVector(up, 0.45).normalize();
      const tierShade = 0.62 + 0.38 * f;
      const j = 0.92 + rng.random() * 0.16;
      strip(
        b,
        [base, mid, tip],
        [len * 0.16, len * 0.46, len * 0.26],
        [side, side, side],
        o.cell,
        [nrm, nrmTip, nrmTip],
        [shade([1, 1, 1], 0.42 * tierShade * j), shade([1, 1, 1], 0.78 * tierShade * j), shade([1, 1, 1], 1.0 * tierShade * j)],
        [0.12 + f * 0.25, 0.4 + f * 0.35, 0.65 + f * 0.35],
      );
    }
  }
  // tip spike
  const tipY = H * 1.02;
  const r = uvRect(o.cell);
  for (let k = 0; k < 2; k++) {
    const th = k * Math.PI * 0.5 + 0.3;
    const s = V(Math.cos(th), 0, Math.sin(th)).multiplyScalar(o.branchLen * 0.14);
    const a = b.v(-s.x, tipY - o.branchLen * 0.55, -s.z, 0, 1, 0, r.u0, r.v0, [0.5, 0.5, 0.5], 0.7);
    const c = b.v(s.x, tipY - o.branchLen * 0.55, s.z, 0, 1, 0, r.u0, r.v1, [0.5, 0.5, 0.5], 0.7);
    const d = b.v(0, tipY, 0, 0, 1, 0, r.u1, (r.v0 + r.v1) / 2, [1, 1, 1], 1);
    b.tri(a, c, d);
  }
  return { geometry: b.build(), meta: { height: H * 1.02, trunkR: o.trunkR, crownR: o.branchLen, kind: 'pine' } };
}

function broadleaf(seed, o) {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  const H = o.height;
  const tH = o.trunkH;
  tube(b, [V(0, -0.4, 0), V(0.05, tH * 0.5, 0), V(0, tH, 0.05)], [o.trunkR * 1.15, o.trunkR * 0.85, o.trunkR * 0.7], { seg: 6, cell: o.bark || 'bark', color: [0.9, 0.86, 0.8], wind1: 0.15 });
  const C = V(0, o.crownY, 0);
  // main branches toward the cluster ring
  const nb = 3 + (rng.random() < 0.5 ? 1 : 0);
  for (let k = 0; k < nb; k++) {
    const th = (k / nb) * Math.PI * 2 + rng.random();
    const end = V(Math.cos(th) * o.crownR * 0.55, o.crownY + (rng.random() - 0.2) * o.crownR * 0.4, Math.sin(th) * o.crownR * 0.55);
    const start = V(0, tH * 0.92, 0);
    const midp = V().lerpVectors(start, end, 0.5);
    midp.y += o.crownR * 0.12;
    tube(b, [start, midp, end], [o.trunkR * 0.55, o.trunkR * 0.35, o.trunkR * 0.12], { seg: 4, cell: o.bark || 'bark', color: [0.85, 0.82, 0.76], wind0: 0.12, wind1: 0.4 });
  }
  // clusters: on an ellipsoid shell + one at the top
  const clusters = [];
  for (let k = 0; k < o.clusters; k++) {
    const u = rng.random() * 2 - 1;
    const th = rng.random() * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u);
    const shell = 0.55 + 0.4 * rng.random();
    clusters.push(V(Math.cos(th) * rr * o.crownR * shell, u * o.crownR * o.squash * shell * 0.9, Math.sin(th) * rr * o.crownR * shell).add(C));
  }
  clusters.push(V(0, o.crownY + o.crownR * o.squash * 0.75, 0));
  const yLo = o.crownY - o.crownR * o.squash;
  const yHi = o.crownY + o.crownR * o.squash;
  for (const cc of clusters) {
    const rc = o.crownR * (0.42 + rng.random() * 0.16);
    for (let k = 0; k < o.cardsPer; k++) {
      const off = V(rng.random() - 0.5, rng.random() - 0.5, rng.random() - 0.5).multiplyScalar(rc * 0.9);
      const p = V().copy(cc).add(off);
      const out = V().copy(p).sub(C).normalize();
      let nrmDir = V(rng.random() - 0.5, rng.random() - 0.5, rng.random() - 0.5).normalize().addScaledVector(out, 0.8).normalize();
      if (nrmDir.lengthSq() < 0.01) nrmDir = V(0, 1, 0);
      const a = Math.abs(nrmDir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
      const right = V().crossVectors(nrmDir, a).normalize().multiplyScalar(rc * 0.62);
      const upv = V().crossVectors(right, nrmDir).normalize().multiplyScalar(rc * 0.62);
      const cell = o.cells[(rng.random() * o.cells.length) | 0];
      const j = 0.9 + rng.random() * 0.2;
      card(
        b,
        p,
        right,
        upv,
        cell,
        (q) => V().copy(q).sub(C).normalize().addScaledVector(V(0, 1, 0), 0.35).normalize(),
        (q) => {
          const hy = Math.max(0, Math.min(1, (q.y - yLo) / (yHi - yLo)));
          const rad = Math.min(1, q.distanceTo(C) / o.crownR);
          const ao = (0.45 + 0.55 * hy) * (0.65 + 0.35 * rad);
          return shade([1, 1, 1], ao * j);
        },
        (q) => 0.45 + 0.55 * Math.min(1, q.distanceTo(C) / o.crownR),
        rng.random() < 0.5,
      );
    }
  }
  return { geometry: b.build(), meta: { height: yHi, trunkR: o.trunkR, crownR: o.crownR, kind: 'broadleaf' } };
}

function jungleTree(seed, o) {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  const H = o.height;
  const lean = V((rng.random() - 0.5) * 1.2, 0, (rng.random() - 0.5) * 1.2);
  const pts = [0, 0.3, 0.6, 0.85, 1].map((f) => V(lean.x * f * f, f * H * 0.88 - (f === 0 ? 0.5 : 0), lean.z * f * f));
  tube(b, pts, [o.trunkR * 1.5, o.trunkR, o.trunkR * 0.8, o.trunkR * 0.65, o.trunkR * 0.5], { seg: 7, cell: 'barkJungle', color: [0.95, 0.95, 0.9], wind1: 0.12 });
  // buttress roots: thin flared fins
  for (let k = 0; k < 4; k++) {
    const th = (k / 4) * Math.PI * 2 + rng.random() * 0.5;
    const d = V(Math.cos(th), 0, Math.sin(th));
    const r = uvRect('barkJungle');
    const a = b.v(d.x * o.trunkR * 0.6, H * 0.12, d.z * o.trunkR * 0.6, d.x, 0.3, d.z, r.u0, r.v1, [0.8, 0.8, 0.75], 0);
    const c = b.v(d.x * o.trunkR * 4.2, -0.3, d.z * o.trunkR * 4.2, d.x, 0.5, d.z, r.u1, r.v0, [0.6, 0.6, 0.55], 0);
    const e = b.v(d.x * o.trunkR * 0.6, -0.3, d.z * o.trunkR * 0.6, d.x, 0.2, d.z, r.u0, r.v0, [0.5, 0.5, 0.45], 0);
    b.tri(a, c, e);
    b.tri(a, e, c);
  }
  // umbrella crown: flattened clusters at the top
  const top = pts[pts.length - 1];
  const C = V(top.x, H * 0.9, top.z);
  const R = o.crownR;
  for (let k = 0; k < o.clusters; k++) {
    const th = rng.random() * Math.PI * 2;
    const rr = Math.sqrt(rng.random()) * R * 0.85;
    const cc = V(C.x + Math.cos(th) * rr, C.y + (rng.random() - 0.3) * R * 0.25, C.z + Math.sin(th) * rr);
    const rc = R * (0.35 + rng.random() * 0.15);
    for (let q = 0; q < o.cardsPer; q++) {
      const p = V().copy(cc).add(V(rng.random() - 0.5, (rng.random() - 0.5) * 0.4, rng.random() - 0.5).multiplyScalar(rc));
      const nd = V((rng.random() - 0.5) * 0.6, 1, (rng.random() - 0.5) * 0.6).normalize();
      const right = V().crossVectors(nd, V(1, 0, 0)).normalize().multiplyScalar(rc * 0.7);
      const upv = V().crossVectors(right, nd).normalize().multiplyScalar(rc * 0.7);
      card(b, p, right, upv, rng.random() < 0.7 ? 'leafA' : 'leafC', (qq) => V().copy(qq).sub(C).setY(R * 0.6).normalize(), (qq) => shade([0.9, 1, 0.9], 0.55 + 0.45 * Math.min(1, (qq.y - C.y + R * 0.3) / (R * 0.6))), () => 0.55);
    }
  }
  // drooping tropical leaves around the crown rim
  for (let k = 0; k < 7; k++) {
    const th = (k / 7) * Math.PI * 2 + rng.random() * 0.4;
    const out = V(Math.cos(th), 0, Math.sin(th));
    const base = V().copy(C).addScaledVector(out, R * 0.7);
    const L = R * 0.7;
    const p1 = V().copy(base).addScaledVector(out, L * 0.5).add(V(0, -L * 0.08, 0));
    const p2 = V().copy(base).addScaledVector(out, L * 0.9).add(V(0, -L * 0.45, 0));
    const side = V(-out.z, 0, out.x);
    const n = V().copy(out).multiplyScalar(0.5).add(V(0, 1, 0)).normalize();
    strip(b, [base, p1, p2], [L * 0.05, L * 0.28, L * 0.1], [side, side, side], 'tropic', [n, n, n], [[0.7, 0.75, 0.7], [0.95, 1, 0.95], [1, 1, 1]], [0.5, 0.75, 1], { uAlong: false });
  }
  // hanging vines
  for (let k = 0; k < o.vines; k++) {
    const th = rng.random() * Math.PI * 2;
    const rr = R * (0.3 + rng.random() * 0.55);
    const x = C.x + Math.cos(th) * rr;
    const z = C.z + Math.sin(th) * rr;
    const L = H * (0.25 + rng.random() * 0.3);
    const side = V(Math.cos(th + 1.57), 0, Math.sin(th + 1.57));
    const n = V(Math.cos(th), 0.3, Math.sin(th)).normalize();
    strip(b, [V(x, C.y, z), V(x, C.y - L * 0.5, z), V(x, C.y - L, z)], [0.5, 0.45, 0.35], [side, side, side], 'vine', [n, n, n], [[0.8, 0.8, 0.8], [0.7, 0.7, 0.7], [0.6, 0.6, 0.6]], [0.5, 0.8, 1], { uAlong: false });
  }
  return { geometry: b.build(), meta: { height: H, trunkR: o.trunkR * 1.4, crownR: R, kind: 'jungle' } };
}

function palm(seed, o) {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  const H = o.height;
  const bend = V((rng.random() - 0.5) * 2, 0, (rng.random() - 0.5) * 2).multiplyScalar(H * 0.12);
  const pts = [];
  for (let k = 0; k <= 6; k++) {
    const f = k / 6;
    pts.push(V(bend.x * f * f, f * H - (k === 0 ? 0.4 : 0), bend.z * f * f));
  }
  tube(b, pts, pts.map((_, k) => o.trunkR * (1.25 - (k / 6) * 0.5)), { seg: 6, cell: 'barkJungle', color: [0.95, 0.9, 0.8], wind1: 0.3 });
  const top = pts[pts.length - 1];
  for (let k = 0; k < o.fronds; k++) {
    const th = (k / o.fronds) * Math.PI * 2 + rng.random() * 0.4;
    const out = V(Math.cos(th), 0, Math.sin(th));
    const L = o.frondLen * (0.85 + rng.random() * 0.3);
    const lift = 0.35 + rng.random() * 0.3;
    const p0 = V().copy(top);
    const p1 = V().copy(top).addScaledVector(out, L * 0.35).add(V(0, L * lift * 0.5, 0));
    const p2 = V().copy(top).addScaledVector(out, L * 0.7).add(V(0, L * lift * 0.25, 0));
    const p3 = V().copy(top).addScaledVector(out, L).add(V(0, -L * 0.25, 0));
    const side = V(-out.z, 0, out.x);
    const n = V().copy(out).multiplyScalar(0.3).add(V(0, 1, 0)).normalize();
    strip(b, [p0, p1, p2, p3], [0.15, L * 0.2, L * 0.17, L * 0.06], [side, side, side, side], 'palm', [n, n, n, n], [[0.55, 0.55, 0.5], [0.85, 0.85, 0.8], [1, 1, 1], [1, 1, 1]], [0.3, 0.6, 0.85, 1]);
  }
  return { geometry: b.build(), meta: { height: H, trunkR: o.trunkR, crownR: o.frondLen, kind: 'palm' } };
}

function bush(seed, o) {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  const C = V(0, o.r * 0.55, 0);
  for (let k = 0; k < o.clusters; k++) {
    const th = rng.random() * Math.PI * 2;
    const rr = rng.random() * o.r * 0.6;
    const cc = V(Math.cos(th) * rr, o.r * (0.35 + rng.random() * 0.5), Math.sin(th) * rr);
    const rc = o.r * (0.45 + rng.random() * 0.2);
    for (let q = 0; q < o.cardsPer; q++) {
      const p = V().copy(cc).add(V(rng.random() - 0.5, rng.random() - 0.5, rng.random() - 0.5).multiplyScalar(rc * 0.8));
      const nd = V(rng.random() - 0.5, rng.random() * 0.8, rng.random() - 0.5).normalize().add(V().copy(p).sub(C).normalize()).normalize();
      const a = Math.abs(nd.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
      const right = V().crossVectors(nd, a).normalize().multiplyScalar(rc * 0.65);
      const upv = V().crossVectors(right, nd).normalize().multiplyScalar(rc * 0.65);
      const cell = o.cells[(rng.random() * o.cells.length) | 0];
      card(b, p, right, upv, cell, (qq) => V().copy(qq).sub(C).normalize().addScaledVector(V(0, 1, 0), 0.4).normalize(), (qq) => shade([1, 1, 1], 0.5 + 0.5 * Math.min(1, qq.y / (o.r * 1.1))), (qq) => 0.15 + 0.45 * Math.min(1, qq.y / o.r));
    }
  }
  return { geometry: b.build(), meta: { height: o.r * 1.2, trunkR: 0, crownR: o.r, kind: 'bush' } };
}

function fern(seed, o) {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  for (let k = 0; k < o.fronds; k++) {
    const th = (k / o.fronds) * Math.PI * 2 + rng.random() * 0.5;
    const out = V(Math.cos(th), 0, Math.sin(th));
    const L = o.len * (0.75 + rng.random() * 0.4);
    const rise = 0.45 + rng.random() * 0.35;
    const p0 = V(0, 0.05, 0);
    const p1 = V().addScaledVector(out, L * 0.4).add(V(0, L * rise * 0.8, 0));
    const p2 = V().addScaledVector(out, L).add(V(0, L * rise * 0.35, 0));
    const side = V(-out.z, 0, out.x);
    const n = V().copy(out).multiplyScalar(0.35).add(V(0, 1, 0)).normalize();
    strip(b, [p0, p1, p2], [0.04, L * 0.2, L * 0.07], [side, side, side], o.cell, [n, n, n], [[0.45, 0.5, 0.45], [0.85, 0.9, 0.85], [1, 1, 1]], [0.05, 0.5, 1]);
  }
  return { geometry: b.build(), meta: { height: o.len * 0.8, trunkR: 0, crownR: o.len, kind: 'fern' } };
}

function glowPlant(seed, o) {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  for (let k = 0; k < o.leaves; k++) {
    const th = (k / o.leaves) * Math.PI * 2 + rng.random() * 0.6;
    const out = V(Math.cos(th), 0, Math.sin(th));
    const L = o.len * (0.7 + rng.random() * 0.5);
    const p0 = V(0, 0.02, 0);
    const p1 = V().addScaledVector(out, L * 0.25).add(V(0, L * 0.6, 0));
    const p2 = V().addScaledVector(out, L * 0.7).add(V(0, L * 0.85, 0));
    const side = V(-out.z, 0, out.x);
    const n = V().copy(out).multiplyScalar(0.5).add(V(0, 1, 0)).normalize();
    strip(b, [p0, p1, p2], [0.05, L * 0.28, L * 0.12], [side, side, side], 'glow', [n, n, n], [[0.6, 0.6, 0.7], [0.9, 0.9, 1], [1, 1, 1]], [0.05, 0.4, 0.9], { uAlong: false });
  }
  // bulb stalks
  const r = uvRect('bulbs');
  for (let k = 0; k < 2; k++) {
    const th = k * 1.57 + rng.random();
    const s = V(Math.cos(th), 0, Math.sin(th)).multiplyScalar(o.len * 0.35);
    const h = o.len * 0.9;
    const ids = [
      b.v(-s.x, 0, -s.z, 0, 1, 0, r.u0, r.v0, [1, 1, 1], 0),
      b.v(s.x, 0, s.z, 0, 1, 0, r.u1, r.v0, [1, 1, 1], 0),
      b.v(s.x, h, s.z, 0, 1, 0, r.u1, r.v1, [1, 1, 1], 0.6),
      b.v(-s.x, h, -s.z, 0, 1, 0, r.u0, r.v1, [1, 1, 1], 0.6),
    ];
    b.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  return { geometry: b.build(), meta: { height: o.len, trunkR: 0, crownR: o.len, kind: 'glow' } };
}

/** Clump of flowers: thin stems + crossed head cards (`heads` = flower cell indices 0–3). */
function flowers(seed, o) {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  const fr = uvRect('flowers');
  const fw = (fr.u1 - fr.u0) / 4;
  const green = [0.18, 0.32, 0.1];
  for (let k = 0; k < o.count; k++) {
    const x = (rng.random() - 0.5) * o.spread;
    const z = (rng.random() - 0.5) * o.spread;
    const h = o.height * (0.6 + rng.random() * 0.6);
    const lean = V((rng.random() - 0.5) * 0.2, 1, (rng.random() - 0.5) * 0.2).normalize();
    const top = V(x, 0, z).addScaledVector(lean, h);
    // stem (a thin sliver using the dark base of the flower cell)
    const s = V(0.012, 0, 0.012);
    const a = b.v(x - s.x, 0, z, 0, 1, 0, fr.u0 + 0.001, fr.v0 + 0.001, green, 0);
    const c = b.v(x + s.x, 0, z, 0, 1, 0, fr.u0 + 0.002, fr.v0 + 0.001, green, 0);
    const d = b.v(top.x, top.y, top.z, 0, 1, 0, fr.u0 + 0.002, fr.v0 + 0.002, green, 0.8);
    b.tri(a, c, d);
    const head = o.heads[(rng.random() * o.heads.length) | 0];
    const size = o.size * (0.75 + rng.random() * 0.5);
    const u0 = fr.u0 + head * fw;
    for (let q = 0; q < 2; q++) {
      const th = rng.random() * Math.PI;
      const tilt = 0.5 + q * 0.6;
      const r1 = V(Math.cos(th), 0, Math.sin(th)).multiplyScalar(size);
      const r2 = V(-Math.sin(th) * Math.cos(tilt), Math.sin(tilt), Math.cos(th) * Math.cos(tilt)).multiplyScalar(size);
      const ids = [
        b.v(top.x - r1.x - r2.x, top.y - r1.y - r2.y, top.z - r1.z - r2.z, 0, 1, 0, u0, fr.v0, [1, 1, 1], 0.9),
        b.v(top.x + r1.x - r2.x, top.y + r1.y - r2.y, top.z + r1.z - r2.z, 0, 1, 0, u0 + fw, fr.v0, [1, 1, 1], 0.9),
        b.v(top.x + r1.x + r2.x, top.y + r1.y + r2.y, top.z + r1.z + r2.z, 0, 1, 0, u0 + fw, fr.v1, [1, 1, 1], 1),
        b.v(top.x - r1.x + r2.x, top.y - r1.y + r2.y, top.z - r1.z + r2.z, 0, 1, 0, u0, fr.v1, [1, 1, 1], 1),
      ];
      b.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  return { geometry: b.build(), meta: { height: o.height, trunkR: 0, crownR: o.spread, kind: 'flowers' } };
}

/** Dry grass tufts (crossed cards) for canyon / dry slopes. */
function tuft(seed, o) {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  const r = uvRect('grassTuft');
  for (let k = 0; k < 3; k++) {
    const th = (k / 3) * Math.PI + rng.random() * 0.3;
    const s = V(Math.cos(th), 0, Math.sin(th)).multiplyScalar(o.w);
    const ids = [
      b.v(-s.x, 0, -s.z, 0, 1, 0, r.u0, r.v0, [0.7, 0.7, 0.7], 0),
      b.v(s.x, 0, s.z, 0, 1, 0, r.u1, r.v0, [0.7, 0.7, 0.7], 0),
      b.v(s.x, o.h, s.z, 0, 1, 0, r.u1, r.v1, [1, 1, 1], 1),
      b.v(-s.x, o.h, -s.z, 0, 1, 0, r.u0, r.v1, [1, 1, 1], 1),
    ];
    b.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  return { geometry: b.build(), meta: { height: o.h, trunkR: 0, crownR: o.w, kind: 'tuft' } };
}

// ================================================================= far LODs
function farGeometry(parts) {
  const geos = parts.map(({ geo, color, top }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    for (let i = 0; i < pos.count; i++) {
      const f = (pos.getY(i) - minY) / (maxY - minY || 1);
      const c = top ? [color[0] + (top[0] - color[0]) * f, color[1] + (top[1] - color[1]) * f, color[2] + (top[2] - color[2]) * f] : color;
      col.set(c, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    // soften: blend the faceted normals with a radial one from the part centre
    g.computeBoundingBox();
    const cen = g.boundingBox.getCenter(new THREE.Vector3());
    const nrm = g.attributes.normal;
    const t = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      t.set(pos.getX(i) - cen.x, (pos.getY(i) - cen.y) * 0.8, pos.getZ(i) - cen.z).normalize();
      t.multiplyScalar(0.65).add(new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).multiplyScalar(0.35));
      t.y += 0.25;
      t.normalize();
      nrm.setXYZ(i, t.x, t.y, t.z);
    }
    return g;
  });
  const merged = mergeSimple(geos);
  merged.computeBoundingSphere();
  return merged;
}

function mergeSimple(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return m;
}

/** Low-poly dome (n-gon ring + apex + flat bottom ring): 2n triangles. */
function dome(r, h, n, seed) {
  const rng = new Rng(seed);
  const pos = [];
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.85 + rng.random() * 0.3;
    ring.push([Math.cos(a) * r * k, h * (0.35 + rng.random() * 0.1), Math.sin(a) * r * k]);
  }
  const apex = [0, h, 0];
  const bottom = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    pos.push(...a, ...apex, ...b); // upper fan
    pos.push(...a, ...b, ...bottom); // lower fan
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Cap-less cone (side only): n triangles. */
function spire(r, h, n, y0) {
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    pos.push(Math.cos(a0) * r, y0, Math.sin(a0) * r, 0, y0 + h, 0, Math.cos(a1) * r, y0, Math.sin(a1) * r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function farPine(h, w) {
  return farGeometry([
    { geo: spire(w, h * 0.66, 6, h * 0.1), color: [0.022, 0.04, 0.018], top: [0.045, 0.075, 0.028] },
    { geo: spire(w * 0.6, h * 0.5, 5, h * 0.52), color: [0.03, 0.052, 0.022], top: [0.055, 0.09, 0.032] },
  ]);
}

function farBroadleaf(h, crownR, crownY, sy, seed, color = [0.05, 0.095, 0.018]) {
  const crownH = crownR * 2 * sy;
  const crown = dome(crownR, crownH, 5, seed).translate(0, crownY - crownH * 0.45, 0);
  const trunk = spire(crownR * 0.12, crownY, 3, 0);
  return farGeometry([
    { geo: crown, color: shade(color, 0.5), top: shade(color, 1.25) },
    { geo: trunk, color: [0.13, 0.09, 0.06] },
  ]);
}

// ================================================================== library
export function createPlantLibrary() {
  const near = {
    pineTall: pine('pine-tall', { height: 17, trunkR: 0.32, crownBase: 0.28, tiers: 10, perTier: 7, branchLen: 3.6, droop: 0.42, cell: 'pineA' }),
    pineMid: pine('pine-mid', { height: 12, trunkR: 0.26, crownBase: 0.16, tiers: 9, perTier: 7, branchLen: 3.2, droop: 0.5, cell: 'pineA' }),
    spruce: pine('spruce', { height: 9, trunkR: 0.2, crownBase: 0.05, tiers: 9, perTier: 7, branchLen: 2.8, droop: 0.62, cell: 'pineB' }),
    oak: broadleaf('oak', { height: 11, trunkH: 4.2, trunkR: 0.38, crownR: 4.6, crownY: 7.4, squash: 0.72, clusters: 8, cardsPer: 5, cells: ['leafA', 'leafA', 'leafB'] }),
    birch: broadleaf('birch', { height: 13, trunkH: 6.5, trunkR: 0.22, crownR: 3.2, crownY: 9.6, squash: 1.15, clusters: 7, cardsPer: 5, cells: ['leafB', 'leafA'], bark: 'barkJungle' }),
    acacia: broadleaf('acacia', { height: 8, trunkH: 4.5, trunkR: 0.25, crownR: 4.8, crownY: 6.4, squash: 0.36, clusters: 7, cardsPer: 4, cells: ['leafC', 'leafB'] }),
    jungleTree: jungleTree('jungle', { height: 22, trunkR: 0.55, crownR: 7.5, clusters: 8, cardsPer: 4, vines: 5 }),
    palm: palm('palm', { height: 11, trunkR: 0.26, fronds: 10, frondLen: 4.6 }),
    bushGreen: bush('bush-green', { r: 1.3, clusters: 4, cardsPer: 5, cells: ['leafC', 'leafA'] }),
    bushJuniper: bush('bush-juniper', { r: 1.0, clusters: 4, cardsPer: 5, cells: ['pineB', 'leafC'] }),
    fern: fern('fern', { fronds: 9, len: 1.15, cell: 'fern' }),
    tropic: fern('tropic', { fronds: 6, len: 1.8, cell: 'tropic' }),
    glowPlant: glowPlant('glow', { leaves: 6, len: 1.5 }),
    flowersMeadow: flowers('flowers-meadow', { count: 9, spread: 1.1, height: 0.42, size: 0.07, heads: [0, 0, 1, 3] }),
    flowersGlow: flowers('flowers-glow', { count: 10, spread: 1.0, height: 0.45, size: 0.075, heads: [2] }),
    tuftDry: tuft('tuft', { w: 0.45, h: 0.55 }),
  };
  const far = {
    pineTall: farPine(17.3, 3.3),
    pineMid: farPine(12.2, 3.0),
    spruce: farPine(9.2, 2.7),
    oak: farBroadleaf(11, 4.8, 7.4, 0.75, 'f-oak'),
    birch: farBroadleaf(13, 3.3, 9.6, 1.2, 'f-birch', [0.075, 0.1, 0.025]),
    acacia: farBroadleaf(8, 4.9, 6.4, 0.38, 'f-acacia', [0.06, 0.08, 0.022]),
    jungleTree: farBroadleaf(22, 7.6, 19.5, 0.35, 'f-jungle', [0.03, 0.075, 0.03]),
    palm: farBroadleaf(11, 4.0, 10.8, 0.3, 'f-palm', [0.05, 0.085, 0.025]),
    bushGreen: farGeometry([{ geo: dome(1.3, 1.7, 4, 'f-bush'), color: [0.025, 0.045, 0.012], top: [0.06, 0.1, 0.025] }]),
    bushJuniper: farGeometry([{ geo: dome(1.05, 1.5, 4, 'f-jun'), color: [0.025, 0.045, 0.025], top: [0.05, 0.08, 0.04] }]),
  };
  return { near, far };
}
