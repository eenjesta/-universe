import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Hard-surface geometry helpers for the faceted space models (ship, pirates,
 * freighters, station parts). Everything is built non-indexed with flat
 * normals and box-projected UVs, then merged per material so a whole model
 * costs one draw call per material.
 *
 *   const b = new PartBuilder();
 *   b.loft('hull', rings);                    // rings: [[x,y,z]...][] (see loft())
 *   b.add('trim', someBufferGeometry);        // any geometry (converted)
 *   const group = b.build({ hull: mat, trim: mat2 });
 *
 * Loft convention: rings are ordered along the loft direction L; each ring's
 * points run counter-clockwise when looking back along L (from +L toward −L).
 * sectionFrame(L) gives the matching 2D axes (right × up = L).
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** 2D section axes for a loft along +X / +Y / +Z (right × up = L). */
export const FRAMES = {
  x: { right: [0, 0, -1], up: [0, 1, 0] },
  y: { right: [1, 0, 0], up: [0, 0, -1] },
  z: { right: [1, 0, 0], up: [0, 1, 0] },
};

/** Maps 2D section points [[r, u], …] to a 3D ring at `origin` along axis frame `axis`. */
export function ring(points2d, origin, axis = 'z') {
  const f = FRAMES[axis];
  return points2d.map(([r, u]) => [
    origin[0] + f.right[0] * r + f.up[0] * u,
    origin[1] + f.right[1] * r + f.up[1] * u,
    origin[2] + f.right[2] * r + f.up[2] * u,
  ]);
}

/** Regular polygon section (CCW), radius r (or [rx, ry]), `sides` points, optional rotation. */
export function polygon(sides, r, rot = 0) {
  const rx = Array.isArray(r) ? r[0] : r;
  const ry = Array.isArray(r) ? r[1] : r;
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    out.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return out;
}

/** Builds a lofted surface (non-indexed) from rings of equal length. */
export function loftGeometry(rings, { closed = true, capStart = true, capEnd = true } = {}) {
  const pos = [];
  const push = (p) => pos.push(p[0], p[1], p[2]);
  const tri = (a, b, c) => {
    push(a);
    push(b);
    push(c);
  };
  const n = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    const m = closed ? n : n - 1;
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % n;
      tri(A[j], A[j2], B[j2]);
      tri(A[j], B[j2], B[j]);
    }
  }
  const centroid = (R) => {
    const c = [0, 0, 0];
    for (const p of R) {
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    }
    return [c[0] / R.length, c[1] / R.length, c[2] / R.length];
  };
  if (closed && capStart) {
    const R = rings[0];
    const c = centroid(R);
    for (let j = 0; j < n; j++) tri(c, R[(j + 1) % n], R[j]);
  }
  if (closed && capEnd) {
    const R = rings[rings.length - 1];
    const c = centroid(R);
    for (let j = 0; j < n; j++) tri(c, R[j], R[(j + 1) % n]);
  }
  return finish(pos);
}

/**
 * Tube loft (nozzles, rings): outer rings + inner rings (same count), open
 * ends joined by annuli. Inner surface faces inward.
 */
export function tubeGeometry(outer, inner) {
  const pos = [];
  const push = (p) => pos.push(p[0], p[1], p[2]);
  const tri = (a, b, c) => {
    push(a);
    push(b);
    push(c);
  };
  const n = outer[0].length;
  for (let i = 0; i < outer.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      const A = outer[i];
      const B = outer[i + 1];
      tri(A[j], A[j2], B[j2]);
      tri(A[j], B[j2], B[j]);
      const C = inner[i];
      const D = inner[i + 1];
      tri(C[j], D[j2], C[j2]);
      tri(C[j], D[j], D[j2]);
    }
  }
  // end annuli
  const o0 = outer[0];
  const i0 = inner[0];
  const o1 = outer[outer.length - 1];
  const i1 = inner[inner.length - 1];
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    tri(o0[j], i0[j], i0[j2]);
    tri(o0[j], i0[j2], o0[j2]);
    tri(o1[j], o1[j2], i1[j2]);
    tri(o1[j], i1[j2], i1[j]);
  }
  return finish(pos);
}

/** Positions → non-indexed geometry with flat normals and box-projected UVs. */
export function finish(pos, uvScale = 1 / 3) {
  const g = new THREE.BufferGeometry();
  const P = new Float32Array(pos);
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.computeVertexNormals();
  boxUV(g, uvScale);
  return g;
}

/** Per-triangle box projection (dominant normal axis), in place. */
export function boxUV(g, scale = 1 / 3) {
  const P = g.attributes.position.array;
  const uv = new Float32Array((P.length / 3) * 2);
  for (let t = 0; t < P.length; t += 9) {
    _a.set(P[t], P[t + 1], P[t + 2]);
    _b.set(P[t + 3], P[t + 4], P[t + 5]);
    _c.set(P[t + 6], P[t + 7], P[t + 8]);
    _b.sub(_a);
    _c.sub(_a);
    _b.cross(_c);
    const ax = Math.abs(_b.x);
    const ay = Math.abs(_b.y);
    const az = Math.abs(_b.z);
    for (let k = 0; k < 3; k++) {
      const i = t + k * 3;
      const o = (t / 3 + k) * 2;
      if (ax >= ay && ax >= az) {
        uv[o] = P[i + 2] * scale;
        uv[o + 1] = P[i + 1] * scale;
      } else if (ay >= az) {
        uv[o] = P[i] * scale;
        uv[o + 1] = P[i + 2] * scale;
      } else {
        uv[o] = P[i] * scale;
        uv[o + 1] = P[i + 1] * scale;
      }
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Mirrors a non-indexed geometry across X (flips winding), returns a new geometry. */
export function mirrorX(g) {
  const m = g.clone();
  const P = m.attributes.position.array;
  for (let i = 0; i < P.length; i += 3) P[i] = -P[i];
  // swap vertices 1 and 2 of every triangle to restore outward winding
  for (const name of Object.keys(m.attributes)) {
    const a = m.attributes[name];
    const s = a.itemSize;
    const arr = a.array;
    for (let t = 0; t < arr.length; t += s * 3) {
      for (let k = 0; k < s; k++) {
        const tmp = arr[t + s + k];
        arr[t + s + k] = arr[t + 2 * s + k];
        arr[t + 2 * s + k] = tmp;
      }
    }
  }
  m.computeVertexNormals();
  return m;
}

/** Any geometry → non-indexed with position/normal/uv only (for merging). */
export function normalizeGeometry(g, { flat = false, uvScale = null } = {}) {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (flat || !out.attributes.normal) out.computeVertexNormals();
  if (uvScale != null || !out.attributes.uv) boxUV(out, uvScale ?? 1 / 3);
  out.morphAttributes = {};
  return out;
}

/** Collects geometries per material key and merges them into meshes. */
export class PartBuilder {
  constructor({ uvScale = 1 / 3 } = {}) {
    this.parts = new Map();
    this.uvScale = uvScale;
  }

  add(key, geometry, matrix = null, { keepUV = false, smooth = false } = {}) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose?.();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    if (matrix) g.applyMatrix4(matrix);
    if (!smooth || !g.attributes.normal) g.computeVertexNormals();
    if (!keepUV || !g.attributes.uv) boxUV(g, this.uvScale);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return g;
  }

  /** Adds a geometry plus its X mirror. */
  addMirrored(key, geometry, matrix = null, opts) {
    const g = this.add(key, geometry, matrix, opts);
    this.parts.get(key).push(mirrorX(g));
  }

  loft(key, rings, opts) {
    return this.add(key, loftGeometry(rings, opts));
  }

  loftMirrored(key, rings, opts) {
    this.addMirrored(key, loftGeometry(rings, opts));
  }

  /** Box (w, h, d) centred at [x, y, z] with optional Euler rotation [rx, ry, rz]. */
  box(key, size, at, rot = null, mirrored = false) {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (rot) q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    m.compose(new THREE.Vector3(at[0], at[1], at[2]), q, new THREE.Vector3(1, 1, 1));
    if (mirrored) this.addMirrored(key, g, m);
    else this.add(key, g, m);
  }

  /** Merged geometry for one key (null if empty). */
  geometry(key) {
    const list = this.parts.get(key);
    if (!list?.length) return null;
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) list.forEach((g) => g.dispose());
    this.parts.set(key, []);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  /** One mesh per material key → Group. `materials` maps key → Material. */
  build(materials, group = new THREE.Group()) {
    for (const key of [...this.parts.keys()]) {
      const mat = materials[key];
      const g = this.geometry(key);
      if (!g || !mat) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = key;
      group.add(mesh);
    }
    return group;
  }
}

/** Lerp helper for section tables: interpolate station values at t ∈ [0, 1]. */
export const mix = (a, b, t) => a + (b - a) * t;
