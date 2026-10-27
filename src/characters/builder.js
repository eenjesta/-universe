/**
 * Geometry builder for skinned characters (characters module).
 *
 * GeoBuilder accumulates parts (any BufferGeometry + matrix) into one big
 * attribute set: position, normal, uv, color, aMat (rough, metal, emissive,
 * sheen), aDetail, skinIndex, skinWeight. Each part gets a style (colour may
 * be a function of position) and skin weights (a bone index or a function).
 * Also exports the procedural primitives used by the body/head builders:
 * gridGeometry, tubeGeometry, superEllipsoid.
 */
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const W = { i: [0, 0, 0, 0], w: [1, 0, 0, 0] };
const _M = new Float64Array(12);
const ID_AFFINE = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0);

/** Matrix4 → row-major 3×4 affine [m00 m01 m02 tx, m10 m11 m12 ty, m20 m21 m22 tz]. */
function affine(m) {
  const e = m.elements;
  return Float64Array.of(e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]);
}

/** Helper for weight functions: setW(out, b0, w0, b1, w1, b2, w2). Normalises. */
export function setW(out, b0, w0, b1 = 0, w1 = 0, b2 = 0, w2 = 0, b3 = 0, w3 = 0) {
  const s = w0 + w1 + w2 + w3 || 1;
  out.i[0] = b0; out.w[0] = w0 / s;
  out.i[1] = b1; out.w[1] = w1 / s;
  out.i[2] = b2; out.w[2] = w2 / s;
  out.i[3] = b3; out.w[3] = w3 / s;
  return out;
}

export class GeoBuilder {
  /** frame (optional): bodyFrame() result; enables rest → bind (A-pose) conversion. */
  constructor(frame = null) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.mat = [];
    this.det = [];
    this.si = [];
    this.sw = [];
    this.idx = [];
    this.frame = frame;
    // per bone: inverse(restToBind) as a 3×4 affine (only for bones with a bind rotation)
    this.b2r = null;
    if (frame?.bindRot) {
      this.b2r = frame.restToBind.map((m, i) => (frame.bindRot[i] ? affine(m.clone().invert()) : null));
    }
  }

  get count() {
    return this.pos.length / 3;
  }

  /**
   * Appends `geo` transformed by matrix `m` (may be null).
   * style: { color: Color | (p, n, i) => Color, rough, metal, emis, sheen, detail, uvScale,
   *          skin (wrapped-diffuse skin shading), emisFn: (p, n, i) => emissive (per vertex) }
   * weights: bone index | (p, out) => void (use setW)
   * space: 'rest' (default — positions are authored in the rest pose and converted to
   *        the A-pose bind using the vertex weights) | 'bind' (already in the bind pose)
   */
  add(geo, m, style, weights, space = 'rest') {
    const convert = space === 'rest' && this.b2r;
    const P = geo.attributes.position;
    const N = geo.attributes.normal;
    const UV = geo.attributes.uv;
    const base = this.count;
    if (m) _nm.getNormalMatrix(m);
    const colorFn = typeof style.color === 'function' ? style.color : null;
    const col = colorFn ? null : _c.copy(style.color || _c.setRGB(1, 0, 1));
    const cr = col ? col.r : 0;
    const cg = col ? col.g : 0;
    const cb = col ? col.b : 0;
    const rough = (style.skin ? -1 : 1) * (style.rough ?? 0.8); // negative = skin (shader flag)
    const metal = style.metal ?? 0;
    const emis = style.emis ?? 0;
    const emisFn = style.emisFn || null;
    const sheen = style.sheen ?? 0;
    const detail = style.detail ?? 0;
    const us = style.uvScale ?? 1;
    const wFn = typeof weights === 'function' ? weights : null;
    const bone = wFn ? 0 : weights | 0;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i);
      if (m) _v.applyMatrix4(m);
      if (N) {
        _n.fromBufferAttribute(N, i);
        if (m) _n.applyMatrix3(_nm).normalize();
      } else _n.set(0, 1, 0);
      // colour / weights are evaluated in the rest pose (where the functions are authored)
      let cR = cr;
      let cG = cg;
      let cB = cb;
      if (colorFn) {
        const c = colorFn(_v, _n, i);
        cR = c.r;
        cG = c.g;
        cB = c.b;
      }
      const em = emisFn ? emisFn(_v, _n, i) : emis;
      if (wFn) {
        W.i[0] = W.i[1] = W.i[2] = W.i[3] = 0;
        W.w[0] = 1;
        W.w[1] = W.w[2] = W.w[3] = 0;
        wFn(_v, W);
      } else {
        W.i[0] = bone;
        W.i[1] = W.i[2] = W.i[3] = 0;
        W.w[0] = 1;
        W.w[1] = W.w[2] = W.w[3] = 0;
      }
      if (convert) this._toBind(_v, _n, W);
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      if (UV) this.uv.push(UV.getX(i) * us, UV.getY(i) * us);
      else this.uv.push(0, 0);
      this.col.push(cR, cG, cB);
      this.mat.push(rough, metal, em, sheen);
      this.det.push(detail);
      this.si.push(W.i[0], W.i[1], W.i[2], W.i[3]);
      this.sw.push(W.w[0], W.w[1], W.w[2], W.w[3]);
    }
    if (geo.index) {
      const I = geo.index.array;
      for (let k = 0; k < I.length; k++) this.idx.push(base + I[k]);
    } else {
      for (let k = 0; k < P.count; k++) this.idx.push(base + k);
    }
    return this;
  }

  /**
   * Rest → bind for one vertex: v_bind = M⁻¹ · v_rest with M = Σ wᵢ · bindToRestᵢ
   * (the exact inverse of linear-blend skinning in the rest pose). Normals use Mᵀ.
   */
  _toBind(v, n, W) {
    const B = this.b2r;
    let any = false;
    for (let k = 0; k < 4; k++) {
      if (W.w[k] > 0 && B[W.i[k]]) {
        any = true;
        break;
      }
    }
    if (!any) return;
    const M = _M;
    M.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = W.w[k];
      if (w <= 0) continue;
      const a = B[W.i[k]] || ID_AFFINE;
      for (let e = 0; e < 12; e++) M[e] += a[e] * w;
    }
    const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = M;
    const A = e * i - f * h;
    const Bc = -(d * i - f * g);
    const Cc = d * h - e * g;
    const det = a * A + b * Bc + c * Cc || 1e-9;
    const inv = 1 / det;
    // inverse (adjugate / det), row-major
    const i00 = A * inv;
    const i01 = -(b * i - c * h) * inv;
    const i02 = (b * f - c * e) * inv;
    const i10 = Bc * inv;
    const i11 = (a * i - c * g) * inv;
    const i12 = -(a * f - c * d) * inv;
    const i20 = Cc * inv;
    const i21 = -(a * h - b * g) * inv;
    const i22 = (a * e - b * d) * inv;
    const px = v.x - tx;
    const py = v.y - ty;
    const pz = v.z - tz;
    v.set(i00 * px + i01 * py + i02 * pz, i10 * px + i11 * py + i12 * pz, i20 * px + i21 * py + i22 * pz);
    // normals: (M⁻¹)⁻ᵀ = Mᵀ
    const nx = a * n.x + d * n.y + g * n.z;
    const ny = b * n.x + e * n.y + h * n.z;
    const nz = c * n.x + f * n.y + i * n.z;
    n.set(nx, ny, nz).normalize();
  }

  /**
   * Appends raw arrays already in the bind pose: { position, normal, uv?, color,
   * aMat (4/vertex), aDetail?, skinIndex, skinWeight, index }.
   */
  addArrays(a) {
    const base = this.count;
    const n = a.position.length / 3;
    for (let k = 0; k < n * 3; k++) {
      this.pos.push(a.position[k]);
      this.nor.push(a.normal[k]);
      this.col.push(a.color[k]);
    }
    for (let k = 0; k < n * 2; k++) this.uv.push(a.uv ? a.uv[k] : 0);
    for (let k = 0; k < n * 4; k++) {
      this.mat.push(a.aMat[k]);
      this.si.push(a.skinIndex[k]);
      this.sw.push(a.skinWeight[k]);
    }
    for (let k = 0; k < n; k++) this.det.push(a.aDetail ? a.aDetail[k] : 0);
    const I = a.index;
    for (let k = 0; k < I.length; k++) this.idx.push(base + I[k]);
    return this;
  }

  /** Raw typed arrays (for merging into batches). */
  toArrays() {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nor),
      uv: new Float32Array(this.uv),
      color: new Float32Array(this.col),
      aMat: new Float32Array(this.mat),
      aDetail: new Float32Array(this.det),
      skinIndex: new Uint16Array(this.si),
      skinWeight: new Float32Array(this.sw),
      index: new Uint32Array(this.idx),
      count: this.count,
    };
  }
}

/** Builds a BufferGeometry from character arrays (one or many merged). */
export function geometryFromArrays(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(a.aMat, 4));
  g.setAttribute('aDetail', new THREE.BufferAttribute(a.aDetail, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(a.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(a.skinWeight, 4));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  return g;
}

/**
 * Grid surface: (nu+1)×(nv+1) vertices from posFn(u, v, target) with u,v in [0,1].
 * opts.wrapU: the u=0 and u=1 columns coincide (normals are averaged at the seam).
 * opts.normalFn(u, v, p, target): analytic normals (else computed from faces).
 * opts.flip: reverse winding.
 */
export function gridGeometry(nu, nv, posFn, opts = {}) {
  const cols = nu + 1;
  const rows = nv + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const p = new THREE.Vector3();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / nu;
      const v = j / nv;
      posFn(u, v, p);
      const k = j * cols + i;
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = p.y;
      pos[k * 3 + 2] = p.z;
      uv[k * 2] = u * (opts.uScale ?? 1);
      uv[k * 2 + 1] = v * (opts.vScale ?? 1);
    }
  }
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // default winding: (∂u × ∂v) is the front face — outward for surfaces whose
      // u runs clockwise seen from the outside of the parameter "top" (tubes,
      // ellipsoids, head). `flip` reverses it.
      if (opts.flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (opts.normalFn) {
    const nor = new Float32Array(cols * rows * 3);
    const n = new THREE.Vector3();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        p.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        opts.normalFn(i / nu, j / nv, p, n);
        nor[k * 3] = n.x;
        nor[k * 3 + 1] = n.y;
        nor[k * 3 + 2] = n.z;
      }
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  } else {
    g.computeVertexNormals();
    const N = g.attributes.normal;
    if (opts.wrapU) {
      for (let j = 0; j < rows; j++) {
        const a = j * cols;
        const b = a + nu;
        const x = N.getX(a) + N.getX(b);
        const y = N.getY(a) + N.getY(b);
        const z = N.getZ(a) + N.getZ(b);
        const l = Math.hypot(x, y, z) || 1;
        N.setXYZ(a, x / l, y / l, z / l);
        N.setXYZ(b, x / l, y / l, z / l);
      }
    }
    // poles (rows that collapse to a point) get the average normal
    if (opts.poles) {
      for (const j of opts.poles) {
        let x = 0;
        let y = 0;
        let z = 0;
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i;
          x += N.getX(k);
          y += N.getY(k);
          z += N.getZ(k);
        }
        const l = Math.hypot(x, y, z) || 1;
        for (let i = 0; i < cols; i++) N.setXYZ(j * cols + i, x / l, y / l, z / l);
      }
    }
  }
  return g;
}

/** Signed power helper for superellipses. */
export const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

/**
 * Tube along a path of centres with per-point cross-sections.
 * sections[i] = { rx (side), rf (front), rb (back), n (superellipse exponent, 2 = ellipse) }
 * Cross-section frame: tangent t, side b = normalize(t × ref), front f = b × t.
 * opts: { segs, ref (Vector3, default (0,0,-1)), capStart, capEnd, uvAround }
 * θ = 0 is the front (f), θ = π/2 the side (b).
 */
export function tubeGeometry(path, sections, opts = {}) {
  const segs = opts.segs ?? 12;
  const ref = opts.ref || new THREE.Vector3(0, 0, -1);
  const n = path.length;
  const frames = [];
  const t = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    t.subVectors(b, a).normalize();
    const side = new THREE.Vector3().crossVectors(t, ref);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    const front = new THREE.Vector3().crossVectors(side, t).normalize();
    frames.push({ side, front });
  }
  // arc length for v
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + path[i].distanceTo(path[i - 1]));
  const around = opts.uvAround ?? 1;
  const g = gridGeometry(
    segs,
    n - 1,
    (u, v, out) => {
      const i = Math.round(v * (n - 1));
      const s = sections[i];
      const th = u * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const e = 2 / (s.n ?? 2);
      const fr = c >= 0 ? s.rf ?? s.rx : s.rb ?? s.rf ?? s.rx;
      const fx = spow(c, e) * fr;
      const sx = spow(sn, e) * s.rx;
      const f = frames[i];
      out.copy(path[i]).addScaledVector(f.front, fx).addScaledVector(f.side, sx);
      if (s.dx) out.x += s.dx;
      if (s.dz) out.z += s.dz;
    },
    { wrapU: true, flip: !!opts.flip },
  );
  // uv: u around (scaled), v = arc length
  const uv = g.attributes.uv;
  const cols = segs + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i <= segs; i++) uv.setXY(j * cols + i, (i / segs) * around, arc[j]);
  }
  if (opts.capStart || opts.capEnd) return addCaps(g, segs, n, path, opts);
  return g;
}

function addCaps(g, segs, rows, path, opts) {
  const pos = Array.from(g.attributes.position.array);
  const nor = Array.from(g.attributes.normal.array);
  const uv = Array.from(g.attributes.uv.array);
  const idx = Array.from(g.index.array);
  const cols = segs + 1;
  const cap = (row, dir) => {
    const center = new THREE.Vector3();
    for (let i = 0; i < segs; i++) {
      const k = (row * cols + i) * 3;
      center.x += pos[k];
      center.y += pos[k + 1];
      center.z += pos[k + 2];
    }
    center.multiplyScalar(1 / segs);
    const other = path[row === 0 ? 1 : rows - 2];
    const nrm = new THREE.Vector3().subVectors(center, other).normalize();
    // ring copy with cap normals
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const k = (row * cols + i) * 3;
      pos.push(pos[k], pos[k + 1], pos[k + 2]);
      nor.push(nrm.x, nrm.y, nrm.z);
      uv.push(i / segs, 0);
    }
    const ci = pos.length / 3;
    const bulge = opts.capBulge ?? 0;
    pos.push(center.x + nrm.x * bulge, center.y + nrm.y * bulge, center.z + nrm.z * bulge);
    nor.push(nrm.x, nrm.y, nrm.z);
    uv.push(0.5, 0.5);
    for (let i = 0; i < segs; i++) {
      if (dir > 0) idx.push(base + i, base + i + 1, ci);
      else idx.push(base + i + 1, base + i, ci);
    }
  };
  // fan (i, i+1, centre) faces +tangent: correct for the end cap, reversed for the start
  if (opts.capStart) cap(0, opts.flip ? 1 : -1);
  if (opts.capEnd) cap(rows - 1, opts.flip ? -1 : 1);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/**
 * Superellipsoid ("rounded box" → ellipsoid): radii rx, ry, rz, exponents
 * e1 (vertical roundness) and e2 (horizontal roundness); 1 = ellipsoid,
 * 0.2 = boxy with rounded edges.
 */
export function superEllipsoid(rx, ry, rz, e1 = 0.4, e2 = 0.4, segU = 16, segV = 10) {
  const g = gridGeometry(
    segU,
    segV,
    (u, v, out) => {
      const th = u * Math.PI * 2;
      const ph = (0.5 - v) * Math.PI; // +π/2 top → −π/2 bottom
      const cp = Math.cos(ph);
      const sp = Math.sin(ph);
      out.set(
        rx * spow(cp, e1) * spow(Math.sin(th), e2),
        ry * spow(sp, e1),
        -rz * spow(cp, e1) * spow(Math.cos(th), e2),
      );
    },
    { wrapU: true, poles: [0, segV] },
  );
  return g;
}

/** Rotation/translation matrix helper: m(x, y, z, rx, ry, rz, sx, sy, sz). */
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'XYZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Cached unit geometries keyed by a string (never disposed; shared by all builds). */
const unitCache = new Map();
export function cached(key, make) {
  let g = unitCache.get(key);
  if (!g) unitCache.set(key, (g = make()));
  return g;
}
