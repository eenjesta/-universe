/**
 * GeoBuilder — merges transformed primitives into one vertex-coloured,
 * indexed BufferGeometry with box-mapped UVs (local metres / uvScale).
 * Every piece part and harvest node is built with it, so a part is one
 * geometry (one instanced draw call per material).
 *
 *   const b = new GeoBuilder();
 *   b.box(4, 0.3, 4, 0, -0.15, 0, { color: 0xb0aba2 });
 *   b.cyl(0.1, 0.1, 2, 1, 1, 0, { color: 0x1c1f24, seg: 8 });
 *   const geo = b.build();
 * Colours are sRGB hex (converted to linear); `intensity` > 1 makes HDR glow.
 */
import * as THREE from 'three';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class GeoBuilder {
  constructor({ uvScale = 2 } = {}) {
    this.uvScale = uvScale;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.count = 0;
  }

  get empty() {
    return this.count === 0;
  }

  /** Appends `geo` transformed by matrix `m`. opts: {color, intensity, uv: 'box'|'keep', uvScale} */
  add(geo, m, { color = 0xffffff, intensity = 1, uv = 'box', uvScale = null } = {}) {
    const P = geo.attributes.position;
    const N = geo.attributes.normal;
    const UV = geo.attributes.uv;
    _nm.getNormalMatrix(m);
    _c.set(color);
    const r = _c.r * intensity;
    const g = _c.g * intensity;
    const bl = _c.b * intensity;
    const s = 1 / (uvScale || this.uvScale);
    const base = this.count;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(m);
      if (N) _n.fromBufferAttribute(N, i).applyMatrix3(_nm);
      else _n.set(0, 1, 0);
      const len = _n.length();
      if (len > 1e-8) _n.multiplyScalar(1 / len);
      else _n.set(0, 1, 0);
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      this.col.push(r, g, bl);
      if (uv === 'keep' && UV) this.uv.push(UV.getX(i), UV.getY(i));
      else {
        const ax = Math.abs(_n.x);
        const ay = Math.abs(_n.y);
        const az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) this.uv.push(_v.x * s, _v.z * s);
        else if (ax >= az) this.uv.push(_v.z * s, _v.y * s);
        else this.uv.push(_v.x * s, _v.y * s);
      }
    }
    const flip = m.determinant() < 0;
    if (geo.index) {
      const I = geo.index;
      for (let i = 0; i < I.count; i += 3) {
        const a = base + I.getX(i);
        const b = base + I.getX(i + 1);
        const c = base + I.getX(i + 2);
        if (flip) this.idx.push(a, c, b);
        else this.idx.push(a, b, c);
      }
    } else {
      for (let i = 0; i < P.count; i += 3) {
        if (flip) this.idx.push(base + i, base + i + 2, base + i + 1);
        else this.idx.push(base + i, base + i + 1, base + i + 2);
      }
    }
    this.count += P.count;
    return this;
  }

  /** Matrix from position + euler (radians) + scale. */
  static matrix(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  }

  /** Axis-aligned (optionally rotated) box centred at (x, y, z). */
  box(w, h, d, x, y, z, o = {}) {
    return this.add(UNIT_BOX, GeoBuilder.matrix(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, w, h, d), o);
  }

  /** Cylinder / cone (axis Y) centred at (x, y, z). */
  cyl(rTop, rBot, h, x, y, z, o = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, o.seg || 12, 1, !!o.open);
    this.add(g, GeoBuilder.matrix(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0), o);
    g.dispose();
    return this;
  }

  /** Any geometry placed at (x, y, z) with rotation/scale options; the geometry is not disposed. */
  geo(geometry, x, y, z, o = {}) {
    return this.add(geometry, GeoBuilder.matrix(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1), o);
  }

  /** Square-section beam from point a to b ([x, y, z] arrays). */
  beam(a, b, t, o = {}) {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    const len = _a.distanceTo(_b);
    if (len < 1e-5) return this;
    _p.copy(_b).sub(_a).multiplyScalar(1 / len);
    _q.setFromUnitVectors(_up, _p);
    _m.compose(_a.add(_b).multiplyScalar(0.5), _q, _s.set(t, len, t));
    return this.add(UNIT_BOX, _m, o);
  }

  /** Builds the merged BufferGeometry (null when empty). */
  build() {
    if (!this.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Merges several geometries (position/normal/uv/color only) into one — used for the hologram ghost. */
export function mergeParts(geos) {
  const b = new GeoBuilder();
  const id = new THREE.Matrix4();
  for (const g of geos) if (g) b.add(g, id, { uv: 'keep' });
  return b.build();
}

/** A rock-like deformed icosahedron (flat shaded look), deterministic per seed. */
export function rockGeometry(radius, detail, rng, { squash = 0.7, jag = 0.22 } = {}) {
  const base = new THREE.IcosahedronGeometry(radius, detail);
  const g = base.index ? base.toNonIndexed() : base;
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 1 + (rng.random() - 0.5) * 2 * jag;
      seen.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * squash, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
