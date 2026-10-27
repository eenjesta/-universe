import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise } from '../../core/noise.js';
import { Rng } from '../../core/math.js';

/**
 * Procedural rock geometry (unit-ish size, base at y ≈ 0, ~20 % meant to sit
 * below the ground):
 *   rockGeometry   deformed icosahedron: 3D-noise displaced, cut by a few
 *                  random fracture planes (flat facets + crisp edges), flat-ish
 *                  bottom; vertex colours = crevice/bottom AO
 *   hoodooGeometry eroded sandstone column (strata bulges, waist) + cap rock
 *   archGeometry   natural rock arch spanning two feet (world-space points)
 * Variants with the same seed but a lower `detail` serve as far LODs.
 */

const _p = new THREE.Vector3();

export function rockGeometry(seed, o = {}) {
  const {
    detail = 2,
    size = [1, 1, 1],
    bump = 0.26,
    freq = 1.5,
    cuts = 4,
    cutDepth = [0.5, 0.82],
    flatten = -0.42,
    taper = 0,
    sink = 0.2,
    crease = 0.62,
  } = o;
  const rng = new Rng(`rock-${seed}`);
  const noise = createNoise(`rock-${seed}`);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const planes = [];
  for (let i = 0; i < cuts; i++) {
    const n = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.25, 1), rng.range(-1, 1)).normalize();
    planes.push({ n, d: rng.range(cutDepth[0], cutDepth[1]) });
  }
  const col = new Float32Array(pos.count * 3);
  const rad = new Float32Array(pos.count);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    const f = freq;
    const n1 = noise.n3(_p.x * f, _p.y * f, _p.z * f);
    const n2 = noise.n3(_p.x * f * 2.9 + 5.1, _p.y * f * 2.9 - 1.3, _p.z * f * 2.9 + 2.2);
    const r = 1 + bump * (n1 + 0.38 * n2);
    _p.multiplyScalar(r);
    for (const pl of planes) {
      const dd = _p.dot(pl.n);
      if (dd > pl.d) _p.addScaledVector(pl.n, -(dd - pl.d) * 0.94);
    }
    if (_p.y < flatten) _p.y = flatten + (_p.y - flatten) * 0.2;
    if (taper) {
      const k = 1 - taper * THREE.MathUtils.smoothstep(_p.y, -0.4, 1.0);
      _p.x *= k;
      _p.z *= k;
    }
    _p.set(_p.x * size[0], _p.y * size[1], _p.z * size[2]);
    pos.setXYZ(i, _p.x, _p.y, _p.z);
    rad[i] = r;
    if (_p.y < minY) minY = _p.y;
    if (_p.y > maxY) maxY = _p.y;
  }
  // base at y = 0 with `sink` of the height below it
  const lift = -minY - (maxY - minY) * sink;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + lift;
    pos.setY(i, y);
    const hy = (y - (minY + lift)) / (maxY - minY || 1);
    const ao = Math.min(1, Math.max(0.38, 0.66 + (rad[i] - 1) * 1.15)) * (0.6 + 0.4 * Math.min(1, hy * 1.6));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // smooth faces, crisp fracture edges (creased normals → non-indexed)
  const out = toCreasedNormals(g, crease);
  g.dispose();
  fixNormals(out);
  let height = maxY - minY;
  let top = maxY + lift;
  if (o.unitHeight) {
    // height 1 → instance scale.y is the rock's height in metres
    const k = 1 / (height || 1);
    out.scale(1, k, 1);
    top *= k;
    height = 1;
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  out.userData.height = height;
  out.userData.top = top;
  return out;
}

/**
 * Hoodoo: eroded column (lathe rings with strata bulges and a narrow waist
 * under the cap) + a flattened cap rock. Height 1, radius ≈ 0.16 at the base.
 */
export function hoodooGeometry(seed, { rings = 16, seg = 9, capDetail = 1 } = {}) {
  const rng = new Rng(`hoodoo-${seed}`);
  const noise = createNoise(`hoodoo-${seed}`);
  const pos = [];
  const col = [];
  const idx = [];
  const H = 1;
  const base = 0.17 + rng.random() * 0.05;
  const lean = rng.range(-0.04, 0.04);
  const ph = rng.random() * 10;
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const y = -0.08 + t * (H * 0.86 + 0.08);
    // tapering column, strata bulges, erosion waist below the cap
    let r = base * (1.3 - 0.62 * t) * (1 + 0.09 * Math.sin(y * 19 + ph) + 0.05 * Math.sin(y * 47 + ph * 2));
    r *= 1 - 0.3 * Math.exp(-((t - 0.86) ** 2) / 0.003);
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const rr = r * (1 + 0.26 * noise.n3(nx * 1.3, y * 4, nz * 1.3) + 0.1 * noise.n3(nx * 3.1, y * 11, nz * 3.1));
      pos.push(nx * rr + lean * t, y, nz * rr);
      const ao = 0.55 + 0.45 * Math.min(1, t * 1.4);
      col.push(ao, ao, ao);
    }
  }
  const w = seg + 1;
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < seg; s++) {
      const a = k * w + s;
      idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  }
  const column = new THREE.BufferGeometry();
  column.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  column.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  column.setIndex(idx);
  // cap rock
  const cap = rockGeometry(`cap-${seed}`, { detail: capDetail, size: [base * 1.25, 0.1, base * 1.1], bump: 0.34, cuts: 4, sink: 0, crease: 0.9 });
  cap.translate(lean * 0.86, H * 0.835, 0);
  const merged = mergeGeometries([column, cap]);
  merged.computeVertexNormals();
  fixNormals(merged);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.userData.height = H;
  return merged;
}

/**
 * Natural arch between feet `a` and `b` (THREE.Vector3, world space, y =
 * ground) rising `rise` metres above the higher foot, `thick` metres thick.
 * Returns geometry in world space (merge-ready).
 */
export function archGeometry(seed, a, b, rise, thick, { rings = 30, seg = 10 } = {}) {
  const noise = createNoise(`arch-${seed}`);
  const pos = [];
  const col = [];
  const idx = [];
  const span = new THREE.Vector3().subVectors(b, a);
  const len = span.length();
  const dir = span.clone().normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const top = Math.max(a.y, b.y) + rise;
  const c = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const pt = (t, out) => {
    // parabola-ish arc; the feet dig 4 m into the ground
    const s = Math.sin(Math.PI * t);
    out.copy(a).addScaledVector(span, t);
    const ground = a.y + (b.y - a.y) * t;
    out.y = ground - 4 + (top - ground + 4) * Math.pow(s, 0.62);
    return out;
  };
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    pt(t, c);
    pt(Math.min(1, t + 0.01), tan).sub(pt(Math.max(0, t - 0.01), nrm)).normalize();
    const up = new THREE.Vector3().crossVectors(side, tan).normalize();
    const s = Math.sin(Math.PI * t);
    // thick feet, slimmer span; a wide slab (side) so it reads as a rock bridge
    const rh = thick * (1.55 - 0.75 * s);
    const rw = thick * (2.2 - 0.9 * s);
    for (let q = 0; q <= seg; q++) {
      const ang = (q / seg) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      nrm.copy(up).multiplyScalar(sa * rh).addScaledVector(side, ca * rw);
      const n = noise.n3(c.x * 0.09 + ca, c.y * 0.09 + sa, c.z * 0.09);
      const n2 = noise.n3(c.x * 0.3 + ca * 2, c.y * 0.3, c.z * 0.3 + sa * 2);
      nrm.multiplyScalar(1 + 0.28 * n + 0.1 * n2);
      pos.push(c.x + nrm.x, c.y + nrm.y, c.z + nrm.z);
      const ao = 0.62 + 0.38 * Math.max(0, sa);
      col.push(ao, ao, ao);
    }
  }
  const w = seg + 1;
  for (let k = 0; k < rings; k++) {
    for (let q = 0; q < seg; q++) {
      const i0 = k * w + q;
      idx.push(i0, i0 + 1, i0 + w, i0 + 1, i0 + w + 1, i0 + w);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.len = len;
  return g;
}

/**
 * Fracture cuts can collapse faces; their creased normals come out zero-length
 * (→ NaN after normalize in the shader, which bloom would smear over the
 * whole frame). Replace them with the radial direction.
 */
export function fixNormals(g) {
  const n = g.attributes.normal;
  const p = g.attributes.position;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i);
    const y = n.getY(i);
    const z = n.getZ(i);
    const l = Math.sqrt(x * x + y * y + z * z);
    if (l > 1e-4 && Number.isFinite(l)) continue;
    _p.fromBufferAttribute(p, i);
    _p.y -= 0.3;
    if (_p.lengthSq() < 1e-8) _p.set(0, 1, 0);
    _p.normalize();
    n.setXYZ(i, _p.x, _p.y, _p.z);
  }
}

/** Minimal merge for geometries with position + color (+ optional index). */
export function mergeGeometries(list) {
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, vo * 3);
    else col.fill(1, vo * 3, (vo + n) * 3);
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[io++] = g.index.array[k] + vo;
    else for (let k = 0; k < n; k++) idx[io++] = vo + k;
    vo += n;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  return m;
}
