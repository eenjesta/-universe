/**
 * Landmarks — shared helpers.
 *
 *  - GeoBuilder: merges many transformed primitives into ONE BufferGeometry
 *    (positions, normals, vertex colours, optional uv / facade / glow
 *    attributes). Every landmark builds a handful of these per material so
 *    a whole district costs only a few draw calls.
 *  - Frame: a local coordinate frame (position + heading) that places
 *    geometry and physics boxes consistently (front of a model = local −Z).
 *  - Small geometry factories (beam between two points, tapered tube, sweep
 *    of a 2D profile along a path) and terrain/road queries.
 */
import * as THREE from 'three';
import { ROADS } from '../world/layout.js';

export const TAU = Math.PI * 2;
const IDENTITY = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _col = new THREE.Color();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Converts hex / css / Color / [r,g,b] to a (shared, temporary) THREE.Color. */
export function toColor(c, out = _col) {
  if (c == null) return out.setRGB(1, 1, 1);
  if (c.isColor) return out.copy(c);
  if (Array.isArray(c)) return out.setRGB(c[0], c[1], c[2]);
  return out.set(c);
}

/** HDR colour helper: color(hex) * k as an [r,g,b] array (for glow vertex colours). */
export function hdr(hex, k = 1) {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}

export class GeoBuilder {
  /**
   * @param {object} o
   *  uv      keep/generate uv coordinates (default true)
   *  facade  add aFacade (vec2: metres along the facade, metres above base) + aWin (vec4)
   *  glow    add aGlow (vec3: blink rate, phase, day level) for the glow material
   */
  constructor({ uv = true, facade = false, glow = false } = {}) {
    this.hasUv = uv;
    this.hasFacade = facade;
    this.hasGlow = glow;
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uvs = [];
    this.fac = [];
    this.win = [];
    this.glw = [];
    this.idx = [];
    this.count = 0;
  }

  get empty() {
    return this.count === 0;
  }

  /**
   * Appends `geo` transformed by `matrix`.
   * opts.color    vertex colour (hex | Color | [r,g,b]; may exceed 1 for glow)
   * opts.flat     faceted (flat) normals
   * opts.uvScale  number | [su, sv] multiplies the geometry uv
   * opts.uvMode   'geo' (default) | 'xz' (world planar, metres) | 'box' (world triplanar-ish, metres)
   * opts.uvDiv    metres per texture repeat for 'xz'/'box' (default 4)
   * opts.facade   'box' | 'cyl' | 'none'  (how aFacade.u is derived)
   * opts.perim    perimeter in metres for 'cyl' (u = uv.x * perim)
   * opts.baseY    world y where facade v = 0
   * opts.win      [seed, style, density, scale]  (style 0 = no windows)
   * opts.glow     [rate, phase, dayLevel]
   * opts.shade    per-vertex colour multiplier by height: [y0, y1, k0, k1] (local y)
   */
  add(geo, matrix = IDENTITY, opts = {}) {
    let g = geo;
    if (opts.flat) {
      g = g.index ? g.toNonIndexed() : g.clone();
      g.computeVertexNormals();
    }
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const UV = g.attributes.uv;
    const VC = g.attributes.color; // optional per-vertex multiplier of opts.color
    const base = this.count;
    _nm.getNormalMatrix(matrix);
    const c = toColor(opts.color ?? 0xffffff);
    const cr = c.r;
    const cg = c.g;
    const cb = c.b;
    let su = 1;
    let sv = 1;
    if (opts.uvScale != null) {
      if (Array.isArray(opts.uvScale)) [su, sv] = opts.uvScale;
      else su = sv = opts.uvScale;
    }
    const uvMode = opts.uvMode || 'geo';
    const uvDiv = opts.uvDiv || 4;
    const facade = opts.facade || 'none';
    const win = opts.win || [0, 0, 0, 1];
    const glow = opts.glow || [0, 0, 1];
    const baseY = opts.baseY ?? 0;
    const perim = opts.perim || 1;
    const shade = opts.shade;
    for (let i = 0; i < P.count; i++) {
      _p.fromBufferAttribute(P, i);
      const lx = _p.x;
      const ly = _p.y;
      const lz = _p.z;
      _p.applyMatrix4(matrix);
      this.pos.push(_p.x, _p.y, _p.z);
      let lnx = 0;
      let lny = 1;
      let lnz = 0;
      if (N) {
        _n.fromBufferAttribute(N, i);
        lnx = _n.x;
        lny = _n.y;
        lnz = _n.z;
        _n.applyMatrix3(_nm).normalize();
      } else _n.set(0, 1, 0);
      this.nor.push(_n.x, _n.y, _n.z);
      let k = 1;
      if (shade) {
        const t = THREE.MathUtils.clamp((ly - shade[0]) / (shade[1] - shade[0] || 1), 0, 1);
        k = shade[2] + (shade[3] - shade[2]) * t;
      }
      if (VC) this.col.push(cr * k * VC.getX(i), cg * k * VC.getY(i), cb * k * VC.getZ(i));
      else this.col.push(cr * k, cg * k, cb * k);
      if (this.hasUv) {
        if (uvMode === 'xz') this.uvs.push(_p.x / uvDiv, _p.z / uvDiv);
        else if (uvMode === 'box') {
          const ax = Math.abs(_n.x);
          const ay = Math.abs(_n.y);
          const az = Math.abs(_n.z);
          if (ay >= ax && ay >= az) this.uvs.push(_p.x / uvDiv, _p.z / uvDiv);
          else if (ax >= az) this.uvs.push(_p.z / uvDiv, _p.y / uvDiv);
          else this.uvs.push(_p.x / uvDiv, _p.y / uvDiv);
        } else if (UV) this.uvs.push(UV.getX(i) * su, UV.getY(i) * sv);
        else this.uvs.push(0, 0);
      }
      if (this.hasFacade) {
        let u = 0;
        let roof = Math.abs(lny) > 0.72;
        if (facade === 'box') {
          if (Math.abs(lnx) > Math.abs(lnz)) u = lz * Math.sign(lnx || 1) + 37.3 * (lnx > 0 ? 1 : 2);
          else u = -lx * Math.sign(lnz || 1) + 37.3 * (lnz > 0 ? 3 : 4);
        } else if (facade === 'cyl') {
          u = (UV ? UV.getX(i) : 0) * perim;
        } else roof = true;
        this.fac.push(u, _p.y - baseY);
        this.win.push(win[0], roof ? 0 : win[1], win[2], win[3]);
      }
      if (this.hasGlow) this.glw.push(glow[0], glow[1], glow[2]);
    }
    if (g.index) {
      const arr = g.index.array;
      for (let i = 0; i < arr.length; i++) this.idx.push(base + arr[i]);
    } else {
      for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    }
    this.count += P.count;
    if (g !== geo) g.dispose();
    return this;
  }

  /** Box of size w×h×d whose centre is placed by `matrix`. */
  box(w, h, d, matrix, opts) {
    return this.add(new THREE.BoxGeometry(w, h, d), matrix, { facade: 'box', ...opts });
  }

  /** Builds the merged geometry (null if empty). */
  build() {
    if (!this.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.hasUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.hasFacade) {
      g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 2));
      g.setAttribute('aWin', new THREE.Float32BufferAttribute(this.win, 4));
    }
    if (this.hasGlow) g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glw, 3));
    const IndexArray = this.count > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new IndexArray(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    // free the JS arrays
    this.pos = this.nor = this.col = this.uvs = this.fac = this.win = this.glw = this.idx = null;
    return g;
  }

  /** Builds a static mesh (or null when nothing was added). `lamps`: bake lantern light (aLamp) for *Lit materials. */
  mesh(material, { name = '', castShadow = false, receiveShadow = false, renderOrder = 0, lamps = null } = {}) {
    const geo = this.build();
    if (!geo) return null;
    // lamps: [{x, y, z, r, k}] or {list, ambient, wrap, max}
    if (lamps) bakeLamps(geo, lamps.list || lamps, lamps.list ? lamps : {});
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    m.renderOrder = renderOrder;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

/** Matrix4 from position, euler rotation and scale. */
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/**
 * Local frame: origin (x, y, z) + heading rotY. `m()` composes a world matrix
 * for a local transform, `p()` maps a local point, `box()` adds a physics box
 * given in local coordinates (centre + full size + local rotation).
 */
export class Frame {
  constructor(x, y, z, rotY = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.rotY = rotY;
    this.c = Math.cos(rotY);
    this.s = Math.sin(rotY);
    this._base = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(_up, rotY), new THREE.Vector3(1, 1, 1));
  }

  /** world point of a local point */
  p(lx, ly, lz, out = new THREE.Vector3()) {
    return out.set(this.x + lx * this.c + lz * this.s, this.y + ly, this.z - lx * this.s + lz * this.c);
  }

  /** world direction (heading) of a local heading */
  heading(lrot = 0) {
    return this.rotY + lrot;
  }

  /** world matrix of a local transform (euler order YXZ: heading first, then pitch/roll) */
  m(lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return new THREE.Matrix4().multiplyMatrices(this._base, mat(lx, ly, lz, rx, ry, rz, sx, sy, sz));
  }

  /** world matrix = frame * given local matrix */
  mm(local) {
    return new THREE.Matrix4().multiplyMatrices(this._base, local);
  }

  /** Adds a physics box given in local coords (cx, cy, cz = centre). */
  box(physics, cx, cy, cz, w, h, d, lrot = 0, opts = {}) {
    if (!physics) return -1;
    const wx = this.x + cx * this.c + cz * this.s;
    const wz = this.z - cx * this.s + cz * this.c;
    return physics.addBox({ x: wx, y: this.y + cy, z: wz, w, h, d, rotY: this.rotY + lrot, tag: 'landmarks', ...opts });
  }
}

/** Matrix that maps a unit-height (y ∈ [-0.5, 0.5]) primitive onto the segment a→b. */
export function beamMatrix(a, b, sx = 1, sz = 1) {
  const dir = _n.subVectors(b, a);
  const len = dir.length();
  _q.setFromUnitVectors(_up, dir.multiplyScalar(1 / (len || 1)));
  return new THREE.Matrix4().compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(sx, len, sz));
}

const _unitCyl = new Map();
/** Cached unit cylinder (radius 1, height 1) with `sides` faces (shared template, not uploaded). */
export function unitCylinder(sides = 6, open = false) {
  const key = `${sides}:${open}`;
  if (!_unitCyl.has(key)) _unitCyl.set(key, new THREE.CylinderGeometry(1, 1, 1, sides, 1, open));
  return _unitCyl.get(key);
}

/** Adds a cylinder "beam" of radius r between points a and b. */
export function addBeam(builder, a, b, r, opts = {}, sides = 6) {
  builder.add(unitCylinder(sides, opts.open), beamMatrix(a, b, r, r), opts);
}

/**
 * Tapered tube along a curve (radius varies with t). Returns a BufferGeometry
 * with position/normal/uv (u around, v along the tube in metres).
 */
export function taperedTube(curve, segments, radial, radiusFn, { closeEnd = true } = {}) {
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const pt = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const length = curve.getLength();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, pt);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = radiusFn(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const sin = Math.sin(a);
      const cos = -Math.cos(a);
      nrm.set(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z).normalize();
      pos.push(pt.x + r * nrm.x, pt.y + r * nrm.y, pt.z + r * nrm.z);
      nor.push(nrm.x, nrm.y, nrm.z);
      uv.push(j / radial, t * length);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (closeEnd) {
    // cap the thin end with a point so it reads as a tip
    const tip = curve.getPointAt(1);
    const tan = curve.getTangentAt(1);
    const ci = pos.length / 3;
    pos.push(tip.x + tan.x * radiusFn(1), tip.y + tan.y * radiusFn(1), tip.z + tan.z * radiusFn(1));
    nor.push(tan.x, tan.y, tan.z);
    uv.push(0.5, length);
    const last = segments * (radial + 1);
    for (let j = 0; j < radial; j++) idx.push(last + j, ci, last + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Sweeps a 2D profile [[x, y], ...] (x = right, y = up in the path's frame)
 * along a polyline of Vector3 points, keeping the profile upright (world up).
 * Returns a BufferGeometry with uv (u = profile index, v = metres along path).
 */
export function sweepProfile(points, profile, { closed = false } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  const tan = new THREE.Vector3();
  const right = new THREE.Vector3();
  let dist = 0;
  const np = profile.length;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    tan.subVectors(next, prev);
    tan.y = 0;
    tan.normalize();
    right.set(-tan.z, 0, tan.x);
    if (i > 0) dist += p.distanceTo(points[i - 1]);
    for (let j = 0; j < np; j++) {
      const [px, py] = profile[j];
      pos.push(p.x + right.x * px, p.y + py, p.z + right.z * px);
      uv.push(j / (np - 1), dist);
    }
  }
  const ring = closed ? np : np - 1;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const j1 = (j + 1) % np;
      const a = i * np + j;
      const b = (i + 1) * np + j;
      const c = (i + 1) * np + j1;
      const d = i * np + j1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // flat-ish shading looks better for hard-edged decks: split + recompute
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

// --------------------------------------------------------------- terrain
/** Ground height helper bound to the world (never throws). */
export function makeGround(world) {
  const fn = world && typeof world.getHeightAt === 'function' ? world.getHeightAt.bind(world) : () => 0;
  const at = (x, z) => {
    const h = fn(x, z);
    return Number.isFinite(h) ? h : 0;
  };
  return {
    at,
    /** min / max height over a disc (centre + 8 samples on the rim) */
    min(x, z, r) {
      let m = at(x, z);
      for (let i = 0; i < 8; i++) m = Math.min(m, at(x + Math.cos((i / 8) * TAU) * r, z + Math.sin((i / 8) * TAU) * r));
      return m;
    },
    max(x, z, r) {
      let m = at(x, z);
      for (let i = 0; i < 8; i++) m = Math.max(m, at(x + Math.cos((i / 8) * TAU) * r, z + Math.sin((i / 8) * TAU) * r));
      return m;
    },
    avg(x, z, r) {
      let m = at(x, z);
      for (let i = 0; i < 8; i++) m += at(x + Math.cos((i / 8) * TAU) * r, z + Math.sin((i / 8) * TAU) * r);
      return m / 9;
    },
  };
}

/** Distance from (x, z) to the nearest road centre line. */
export function distToRoads(x, z) {
  let best = Infinity;
  for (const road of ROADS) {
    const pts = road.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) best = d;
    }
  }
  return best;
}

/** Footprint registry (circles + oriented rectangles) used to keep walk points / props apart. */
export class Footprints {
  constructor() {
    this.list = [];
  }
  circle(x, z, r) {
    this.list.push({ type: 0, x, z, r });
  }
  /** oriented rectangle: centre, full width (local x) / depth (local z), heading */
  rect(x, z, w, d, rotY = 0) {
    this.list.push({ type: 1, x, z, hw: w / 2, hd: d / 2, c: Math.cos(rotY), s: Math.sin(rotY) });
  }
  free(x, z, margin = 0) {
    for (const f of this.list) {
      if (f.type === 0) {
        if (Math.hypot(x - f.x, z - f.z) < f.r + margin) return false;
      } else {
        const dx = x - f.x;
        const dz = z - f.z;
        const lx = dx * f.c - dz * f.s;
        const lz = dx * f.s + dz * f.c;
        if (Math.abs(lx) < f.hw + margin && Math.abs(lz) < f.hd + margin) return false;
      }
    }
    return true;
  }
}

/**
 * Bakes warm lantern light into a static geometry as the per-vertex float
 * attribute `aLamp` (read by the *Lit materials): Σ k·(1 − d/r)² with a
 * wrapped facing term, so surfaces near and facing a lantern glow warmly.
 * lamps: [{x, y, z, r, k}] (world space; the geometry must be in world space).
 * wrap: light reaching surfaces that face away (0 = only lamp-facing surfaces).
 */
export function bakeLamps(geometry, lamps, { ambient = 0, max = 2.4, wrap = 0.35 } = {}) {
  if (!geometry) return geometry;
  const P = geometry.attributes.position;
  const N = geometry.attributes.normal;
  const out = new Float32Array(P.count);
  // bucket the lamps on a coarse grid so each vertex only tests its neighbours
  const cell = 8;
  const grid = new Map();
  const key = (ix, iz) => ix * 73856093 + iz * 19349663;
  for (const l of lamps) {
    const r = l.r;
    for (let ix = Math.floor((l.x - r) / cell); ix <= Math.floor((l.x + r) / cell); ix++) {
      for (let iz = Math.floor((l.z - r) / cell); iz <= Math.floor((l.z + r) / cell); iz++) {
        const k = key(ix, iz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(l);
      }
    }
  }
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i);
    const y = P.getY(i);
    const z = P.getZ(i);
    const list = grid.get(key(Math.floor(x / cell), Math.floor(z / cell)));
    let sum = ambient;
    if (list) {
      for (const l of list) {
        const dx = l.x - x;
        const dy = l.y - y;
        const dz = l.z - z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= l.r) continue;
        const f = 1 - d / l.r;
        let facing = 1;
        if (N && d > 1e-3) facing = wrap + (1 - wrap) * Math.max(0, (N.getX(i) * dx + N.getY(i) * dy + N.getZ(i) * dz) / d);
        sum += l.k * f * f * facing;
      }
    }
    out[i] = Math.min(max, sum);
  }
  geometry.setAttribute('aLamp', new THREE.BufferAttribute(out, 1));
  return geometry;
}

/** Marks a group (and children) static: computes matrices once. */
export function freeze(obj) {
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    o.matrixAutoUpdate = false;
  });
  return obj;
}
