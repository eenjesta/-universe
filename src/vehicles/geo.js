/**
 * Vehicles — geometry helpers. `PartBuilder` collects primitive parts
 * (geometry + matrix + vertex colour + window density) and merges them into
 * one indexed BufferGeometry (position, normal, uv, color, aWin) so a whole
 * vehicle material layer is a single draw call. Also: lofts through
 * cross-sections (smooth or faceted), superellipse sections, lathe helpers,
 * matrix shorthands and side-profile extrusion.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n3 = new THREE.Matrix3();
const _v = new THREE.Vector3();

/** Matrix from position, Euler rotation (x, y, z; `order`) and scale (number or [x, y, z]). */
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, order = 'XYZ') {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  if (Array.isArray(s)) _s.set(s[0], s[1], s[2]);
  else _s.set(s, s, s);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s);
}

/** Mirrors a matrix across the YZ plane (x → −x) — for symmetric parts. */
export function mirrorX(m) {
  return new THREE.Matrix4().makeScale(-1, 1, 1).multiply(m);
}

export class PartBuilder {
  constructor() {
    this.parts = [];
  }

  /**
   * add(geometry, matrix?, { color = 0xffffff | THREE.Color | [r,g,b], win = 0, mirror = false })
   * `mirror` also adds the x-mirrored copy. The geometry is consumed (disposed after build()).
   */
  add(geo, matrix = null, opts = {}) {
    const col = opts.color instanceof THREE.Color ? opts.color : Array.isArray(opts.color) ? new THREE.Color(...opts.color) : new THREE.Color(opts.color ?? 0xffffff);
    this.parts.push({ geo, matrix: matrix ? matrix.clone() : new THREE.Matrix4(), color: col, win: opts.win || 0 });
    if (opts.mirror) this.parts.push({ geo, matrix: mirrorX(matrix || new THREE.Matrix4()), color: col, win: opts.win || 0 });
    return this;
  }

  box(w, h, d, matrix, opts) {
    return this.add(new THREE.BoxGeometry(w, h, d), matrix, opts);
  }

  cyl(rt, rb, h, seg, matrix, opts, open = false) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), matrix, opts);
  }

  get empty() {
    return this.parts.length === 0;
  }

  /** Merges every part into one geometry (indexed). */
  build() {
    let nv = 0;
    let ni = 0;
    for (const p of this.parts) {
      nv += p.geo.attributes.position.count;
      ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3);
    const nrm = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const col = new Float32Array(nv * 3);
    const win = new Float32Array(nv);
    const IndexArray = nv > 65535 ? Uint32Array : Uint16Array;
    const idx = new IndexArray(ni);
    let vo = 0;
    let io = 0;
    const seen = new Set();
    for (const p of this.parts) {
      const g = p.geo;
      const P = g.attributes.position;
      if (!g.attributes.normal) g.computeVertexNormals();
      const N = g.attributes.normal;
      const U = g.attributes.uv;
      const m = p.matrix;
      _n3.getNormalMatrix(m);
      const flip = m.determinant() < 0;
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(m);
        pos[(vo + i) * 3] = _v.x;
        pos[(vo + i) * 3 + 1] = _v.y;
        pos[(vo + i) * 3 + 2] = _v.z;
        _v.fromBufferAttribute(N, i).applyMatrix3(_n3);
        const l = _v.length();
        if (l > 1e-8) _v.multiplyScalar(1 / l);
        else _v.set(0, 1, 0);
        nrm[(vo + i) * 3] = _v.x;
        nrm[(vo + i) * 3 + 1] = _v.y;
        nrm[(vo + i) * 3 + 2] = _v.z;
        if (U) {
          uv[(vo + i) * 2] = U.getX(i);
          uv[(vo + i) * 2 + 1] = U.getY(i);
        }
        col[(vo + i) * 3] = p.color.r;
        col[(vo + i) * 3 + 1] = p.color.g;
        col[(vo + i) * 3 + 2] = p.color.b;
        win[vo + i] = p.win;
      }
      if (g.index) {
        const I = g.index.array;
        for (let i = 0; i < I.length; i += 3) {
          idx[io++] = vo + I[i];
          idx[io++] = vo + (flip ? I[i + 2] : I[i + 1]);
          idx[io++] = vo + (flip ? I[i + 1] : I[i + 2]);
        }
      } else {
        for (let i = 0; i < P.count; i += 3) {
          idx[io++] = vo + i;
          idx[io++] = vo + (flip ? i + 2 : i + 1);
          idx[io++] = vo + (flip ? i + 1 : i + 2);
        }
      }
      vo += P.count;
      seen.add(g);
    }
    for (const g of seen) g.dispose();
    this.parts.length = 0;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('aWin', new THREE.BufferAttribute(win, 1));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }

  /** Builds and wraps in a Mesh. */
  mesh(material, { name = '', castShadow = true, receiveShadow = true } = {}) {
    const m = new THREE.Mesh(this.build(), material);
    m.name = name;
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    return m;
  }
}

/**
 * Superellipse cross-section (closed ring of `n` points, counter-clockwise
 * seen from +Z) at depth z. halfW/top/bottom in metres relative to (cx, cy).
 * `e` = exponent (2 = ellipse, 4+ = boxy).
 */
export function section(z, halfW, top, bottom, n = 16, e = 2.6, cx = 0, cy = 0) {
  const pts = [];
  const k = 2 / e;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = halfW * Math.sign(c) * Math.pow(Math.abs(c), k);
    const yy = Math.sign(s) * Math.pow(Math.abs(s), k);
    pts.push(new THREE.Vector3(cx + x, cy + (yy > 0 ? top * yy : bottom * yy), z));
  }
  return pts;
}

/** Octagon-like faceted section with chamfers (`ch` 0..0.5 of the half size). */
export function chamferSection(z, halfW, top, bottom, ch = 0.3, cy = 0) {
  const cw = halfW * ch;
  const ct = top * ch;
  const cb = bottom * ch;
  return [
    [halfW, cy], [halfW, cy + top - ct], [halfW - cw, cy + top], [-halfW + cw, cy + top], [-halfW, cy + top - ct],
    [-halfW, cy], [-halfW, cy - bottom + cb], [-halfW + cw, cy - bottom], [halfW - cw, cy - bottom], [halfW, cy - bottom + cb],
  ].map(([x, y]) => new THREE.Vector3(x, y, z));
}

/**
 * Loft through rings of equal point count (each ring = Vector3[]), ordered by
 * increasing z (front → rear), each ring counter-clockwise seen from +Z (as
 * `section`/`chamferSection` produce; open arcs run from +x over the top to
 * −x). opts: { closed = true (ring wraps), capStart, capEnd, flat = false
 * (faceted normals) }.
 */
export function loft(rings, { closed = true, capStart = true, capEnd = true, flat = false } = {}) {
  const n = rings[0].length;
  const pos = [];
  const uvs = [];
  const index = [];
  const segs = closed ? n : n - 1;
  rings.forEach((ring, r) => {
    ring.forEach((p, i) => {
      pos.push(p.x, p.y, p.z);
      uvs.push(i / n, r / (rings.length - 1));
    });
  });
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < segs; i++) {
      const a = r * n + i;
      const b = r * n + ((i + 1) % n);
      const c = (r + 1) * n + i;
      const d = (r + 1) * n + ((i + 1) % n);
      index.push(a, b, c, b, d, c); // outward for rings ordered by increasing z, CCW seen from +Z
    }
  }
  const capAt = (ring, reverse) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    ring.forEach((p) => {
      cx += p.x;
      cy += p.y;
      cz += p.z;
    });
    const ci = pos.length / 3;
    pos.push(cx / n, cy / n, cz / n);
    uvs.push(0.5, 0.5);
    const base = pos.length / 3;
    ring.forEach((p) => {
      pos.push(p.x, p.y, p.z);
      uvs.push(0.5, 0.5);
    });
    for (let i = 0; i < segs; i++) {
      const a = base + i;
      const b = base + ((i + 1) % n);
      if (reverse) index.push(ci, a, b);
      else index.push(ci, b, a);
    }
  };
  if (closed && capStart) capAt(rings[0], false);
  if (closed && capEnd) capAt(rings[rings.length - 1], true);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  if (flat) {
    const ng = g.toNonIndexed();
    g.dispose();
    g = ng;
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Extrudes a side profile (THREE.Shape in the (z, y) plane: shape x = model z,
 * shape y = model y) across the width, centred on x = 0, with bevels.
 */
export function extrudeSide(shape, width, { bevel = 0.1, bevelSegments = 3, curveSegments = 12 } = {}) {
  const depth = Math.max(0.01, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.85,
    bevelSegments,
    curveSegments,
  });
  // (u, v, w) → (x = −w, y = v, z = u): a proper rotation (keeps winding)
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  // weld cap/side seams so the bevels shade smoothly
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const welded = mergeVertices(g, 1e-4);
  g.dispose();
  welded.computeVertexNormals();
  welded.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(welded.attributes.position.count * 2), 2));
  return welded;
}

/** Deforms positions in place: fn(v: Vector3) mutates v. Recomputes normals. */
export function deform(geo, fn) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    fn(_v);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Lathe around the X axis from [radius, x] pairs (for wheels, nozzles, ducts). */
export function latheX(profile, segments = 32) {
  const pts = profile.map(([r, x]) => new THREE.Vector2(Math.max(0.0001, r), x));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateZ(-Math.PI / 2); // lathe axis Y → X
  return g;
}

/** Lathe around the Z axis (engines, nozzles pointing along ±Z). */
export function latheZ(profile, segments = 32) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(0.0001, r), z));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateX(Math.PI / 2); // lathe axis Y → Z
  return g;
}

/** Lathe around Y (ducts lying flat, landing feet). */
export function latheY(profile, segments = 32) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), segments);
}

/** A thin strip (box) from point a to b with thickness t and height h (for light lines). */
export function strip(a, b, t = 0.03, h = 0.03) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 0.001;
  const g = new THREE.BoxGeometry(t, h, len);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(dx, dy, dz), Math.abs(dy) > len * 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  g.applyMatrix4(m);
  return g;
}

/** Cylinder between two points (struts, legs, antennas). */
export function strut(a, b, r = 0.1, seg = 6, rb = null) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B) || 0.001;
  const g = new THREE.CylinderGeometry(r, rb ?? r, len, seg);
  const dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

/** Reverses the faces (and normals) of an indexed geometry — e.g. to see a tube from inside. */
export function flipFaces(geo) {
  const idx = geo.index;
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  const n = geo.attributes.normal;
  if (n) for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
  return geo;
}

/** Disposes every geometry/material (non-shared) in a subtree. */
export function disposeTree(root, keep = new Set()) {
  root.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) if (!keep.has(m) && m.userData?.owned) m.dispose();
  });
}
