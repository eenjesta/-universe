/**
 * Ø Studio — collision + picking maths for experience parts (pure JS, no three.js / DOM).
 *
 * A shape mirrors one part: centre c, rotation R (row-major 3×3, world = R·local + c, from the
 * part's 'YXZ' Euler degrees) and half extents h. Kinds: BOX (block/spawn/text), WEDGE, CYL
 * (axis Y), SPHERE (ellipsoid; light bulbs), CONE (axis Y, apex up).
 *
 *   const world = new CollisionWorld();
 *   const s = world.add(shapeFromPart(part));           // after editing the part: shapeFromPart(part, s); world.update(s)
 *   world.sdf(s, x, y, z)                                // signed distance (m; exact for boxes/spheres, a close bound otherwise)
 *   world.normal(s, x, y, z, out)                        // outward unit normal (world) at/near a point
 *   world.query(minX, minY, minZ, maxX, maxY, maxZ, out) // candidates (spatial hash on XZ, big shapes always)
 *   world.raycast(ox, oy, oz, dx, dy, dz, maxT, filter, hit) → hit | null  ({shape, t, x, y, z, nx, ny, nz})
 *
 * Ray tests run in the shape's normalised space (unit box/sphere/cylinder/cone/wedge) so the ray
 * parameter t equals the world parameter; normals return through R·S⁻¹. Zero-length vectors are
 * guarded everywhere (no NaN normals).
 */

export const BOX = 0;
export const WEDGE = 1;
export const CYL = 2;
export const SPHERE = 3;
export const CONE = 4;
export const KIND_OF = { block: BOX, spawn: BOX, text: BOX, wedge: WEDGE, cylinder: CYL, sphere: SPHERE, light: SPHERE, cone: CONE };

const D2R = Math.PI / 180;
const BIG = 96; // shapes wider than this (m) skip the hash and are always candidates

/** Row-major rotation matrix from 'YXZ' Euler angles in degrees (matches three.js Euler order 'YXZ'). */
export function rotationYXZ(rx, ry, rz, m = new Float64Array(9)) {
  const x = rx * D2R;
  const y = ry * D2R;
  const z = rz * D2R;
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ce = c * e;
  const cf = c * f;
  const de = d * e;
  const df = d * f;
  m[0] = ce + df * b;
  m[1] = de * b - cf;
  m[2] = a * d;
  m[3] = a * f;
  m[4] = a * e;
  m[5] = -b;
  m[6] = cf * b - de;
  m[7] = df + ce * b;
  m[8] = a * c;
  return m;
}

/** Creates (or refreshes `shape`) from a part { id, type, p, r, s, collide }. */
export function shapeFromPart(part, shape = {}) {
  shape.part = part;
  shape.id = part.id;
  shape.kind = KIND_OF[part.type] ?? BOX;
  shape.solid = part.collide !== false;
  shape.cx = part.p[0];
  shape.cy = part.p[1];
  shape.cz = part.p[2];
  const hx = (shape.hx = Math.max(part.s[0] * 0.5, 0.005));
  const hy = (shape.hy = Math.max(part.s[1] * 0.5, 0.005));
  const hz = (shape.hz = Math.max(part.s[2] * 0.5, 0.005));
  const m = (shape.m = shape.m || new Float64Array(9));
  rotationYXZ(part.r[0], part.r[1], part.r[2], m);
  shape.uniform = Math.abs(hx - hy) < 1e-6 && Math.abs(hy - hz) < 1e-6;
  shape.slope = 1 / Math.hypot(hy, hz);
  const ex = Math.abs(m[0]) * hx + Math.abs(m[1]) * hy + Math.abs(m[2]) * hz;
  const ey = Math.abs(m[3]) * hx + Math.abs(m[4]) * hy + Math.abs(m[5]) * hz;
  const ez = Math.abs(m[6]) * hx + Math.abs(m[7]) * hy + Math.abs(m[8]) * hz;
  shape.minX = shape.cx - ex;
  shape.maxX = shape.cx + ex;
  shape.minY = shape.cy - ey;
  shape.maxY = shape.cy + ey;
  shape.minZ = shape.cz - ez;
  shape.maxZ = shape.cz + ez;
  shape.radius = Math.hypot(hx, hy, hz);
  shape._stamp = shape._stamp || 0;
  return shape;
}

// ------------------------------------------------------------ local SDFs
function sdBox(x, y, z, hx, hy, hz) {
  const qx = Math.abs(x) - hx;
  const qy = Math.abs(y) - hy;
  const qz = Math.abs(z) - hz;
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  const oz = qz > 0 ? qz : 0;
  const inside = Math.max(qx, qy, qz);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + (inside < 0 ? inside : 0);
}

/** Signed distance in the shape's rotation-only local space. */
export function sdLocal(s, x, y, z) {
  const { hx, hy, hz } = s;
  switch (s.kind) {
    case WEDGE:
      return Math.max(sdBox(x, y, z, hx, hy, hz), (y * hz - z * hy) * s.slope);
    case CYL: {
      const r = Math.min(hx, hz);
      const dr = (Math.hypot(x / hx, z / hz) - 1) * r;
      const dy = Math.abs(y) - hy;
      const ix = Math.max(dr, dy);
      return (ix < 0 ? ix : 0) + Math.hypot(dr > 0 ? dr : 0, dy > 0 ? dy : 0);
    }
    case SPHERE: {
      if (s.uniform) return Math.hypot(x, y, z) - hx;
      const k0 = Math.hypot(x / hx, y / hy, z / hz);
      const k1 = Math.hypot(x / (hx * hx), y / (hy * hy), z / (hz * hz));
      return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(hx, hy, hz);
    }
    case CONE: {
      const r = Math.min(hx, hz);
      const h2 = 2 * hy;
      const q = Math.hypot((x / hx) * r, (z / hz) * r);
      const rr = (r * (hy - y)) / h2;
      const lateral = ((q - rr) * h2) / Math.hypot(h2, r);
      return Math.max(lateral, Math.abs(y) - hy);
    }
    default:
      return sdBox(x, y, z, hx, hy, hz);
  }
}

// --------------------------------------------------------- ray (unit space)
const PLANES_BOX = [
  [1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 0, 1], [0, -1, 0, 1], [0, 0, 1, 1], [0, 0, -1, 1],
];
const R2 = Math.SQRT1_2;
const PLANES_WEDGE = [...PLANES_BOX, [0, R2, -R2, 0]];

function rayConvex(planes, ox, oy, oz, dx, dy, dz, res) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let best = null;
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const denom = p[0] * dx + p[1] * dy + p[2] * dz;
    const dist = p[3] - (p[0] * ox + p[1] * oy + p[2] * oz);
    if (Math.abs(denom) < 1e-12) {
      if (dist < 0) return Infinity;
      continue;
    }
    const t = dist / denom;
    if (denom < 0) {
      if (t > tmin) {
        tmin = t;
        best = p;
      }
    } else if (t < tmax) tmax = t;
    if (tmin > tmax) return Infinity;
  }
  if (!best || tmin < 0) return Infinity; // behind, or origin inside
  res[0] = best[0];
  res[1] = best[1];
  res[2] = best[2];
  return tmin;
}

function raySphere(ox, oy, oz, dx, dy, dz, res) {
  const a = dx * dx + dy * dy + dz * dz;
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - 1;
  if (a < 1e-18 || c < 0) return Infinity;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return Infinity;
  res[0] = ox + t * dx;
  res[1] = oy + t * dy;
  res[2] = oz + t * dz;
  return t;
}

function rayCylinder(ox, oy, oz, dx, dy, dz, res) {
  if (ox * ox + oz * oz < 1 && Math.abs(oy) < 1) return Infinity; // inside
  let best = Infinity;
  const a = dx * dx + dz * dz;
  if (a > 1e-18) {
    const b = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - 1;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = oy + t * dy;
      if (t >= 0 && y >= -1 && y <= 1) {
        best = t;
        res[0] = ox + t * dx;
        res[1] = 0;
        res[2] = oz + t * dz;
      }
    }
  }
  if (Math.abs(dy) > 1e-12) {
    for (const cap of [1, -1]) {
      const t = (cap - oy) / dy;
      if (t < 0 || t >= best) continue;
      const x = ox + t * dx;
      const z = oz + t * dz;
      if (x * x + z * z <= 1) {
        best = t;
        res[0] = 0;
        res[1] = cap;
        res[2] = 0;
      }
    }
  }
  return best;
}

function rayCone(ox, oy, oz, dx, dy, dz, res) {
  const k2 = 0.25;
  const w = 1 - oy;
  let best = Infinity;
  if (oy > -1 && oy < 1 && ox * ox + oz * oz < k2 * w * w) return Infinity; // inside
  const a = dx * dx + dz * dz - k2 * dy * dy;
  const b = ox * dx + oz * dz + k2 * w * dy;
  const c = ox * ox + oz * oz - k2 * w * w;
  const roots = [];
  if (Math.abs(a) > 1e-12) {
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      roots.push((-b - sq) / a, (-b + sq) / a);
    }
  } else if (Math.abs(b) > 1e-12) roots.push(-c / (2 * b));
  for (const t of roots) {
    if (t < 0 || t >= best) continue;
    const y = oy + t * dy;
    if (y < -1 || y > 1) continue;
    best = t;
    res[0] = ox + t * dx;
    res[1] = k2 * (1 - y);
    res[2] = oz + t * dz;
  }
  if (Math.abs(dy) > 1e-12) {
    const t = (-1 - oy) / dy;
    if (t >= 0 && t < best) {
      const x = ox + t * dx;
      const z = oz + t * dz;
      if (x * x + z * z <= 1) {
        best = t;
        res[0] = 0;
        res[1] = -1;
        res[2] = 0;
      }
    }
  }
  return best;
}

const _n = [0, 0, 0];

/**
 * Ray (world origin o, direction d — not necessarily normalised) against one shape.
 * Returns t (Infinity on a miss); writes the world normal to out {nx, ny, nz} on a hit.
 */
export function rayShape(s, ox, oy, oz, dx, dy, dz, out) {
  const m = s.m;
  const px = ox - s.cx;
  const py = oy - s.cy;
  const pz = oz - s.cz;
  // local (rotation only) then normalised by half extents
  const lox = (m[0] * px + m[3] * py + m[6] * pz) / s.hx;
  const loy = (m[1] * px + m[4] * py + m[7] * pz) / s.hy;
  const loz = (m[2] * px + m[5] * py + m[8] * pz) / s.hz;
  const ldx = (m[0] * dx + m[3] * dy + m[6] * dz) / s.hx;
  const ldy = (m[1] * dx + m[4] * dy + m[7] * dz) / s.hy;
  const ldz = (m[2] * dx + m[5] * dy + m[8] * dz) / s.hz;
  let t;
  switch (s.kind) {
    case WEDGE:
      t = rayConvex(PLANES_WEDGE, lox, loy, loz, ldx, ldy, ldz, _n);
      break;
    case CYL:
      t = rayCylinder(lox, loy, loz, ldx, ldy, ldz, _n);
      break;
    case SPHERE:
      t = raySphere(lox, loy, loz, ldx, ldy, ldz, _n);
      break;
    case CONE:
      t = rayCone(lox, loy, loz, ldx, ldy, ldz, _n);
      break;
    default:
      t = rayConvex(PLANES_BOX, lox, loy, loz, ldx, ldy, ldz, _n);
  }
  if (t === Infinity) return t;
  if (out) {
    // normal: R · S⁻¹ · n'
    const nx = _n[0] / s.hx;
    const ny = _n[1] / s.hy;
    const nz = _n[2] / s.hz;
    let wx = m[0] * nx + m[1] * ny + m[2] * nz;
    let wy = m[3] * nx + m[4] * ny + m[5] * nz;
    let wz = m[6] * nx + m[7] * ny + m[8] * nz;
    const len = Math.hypot(wx, wy, wz);
    if (len > 1e-12) {
      wx /= len;
      wy /= len;
      wz /= len;
    } else {
      wx = 0;
      wy = 1;
      wz = 0;
    }
    out.nx = wx;
    out.ny = wy;
    out.nz = wz;
  }
  return t;
}

// ------------------------------------------------------------------ world
export class CollisionWorld {
  constructor(cell = 8) {
    this.cell = cell;
    this.grid = new Map();
    this.big = [];
    this.shapes = new Set();
    this._stamp = 1;
    this._tmp = { nx: 0, ny: 0, nz: 0 };
  }

  get size() {
    return this.shapes.size;
  }

  add(s) {
    if (this.shapes.has(s)) return this.update(s);
    this.shapes.add(s);
    this._insert(s);
    return s;
  }

  remove(s) {
    if (!s || !this.shapes.delete(s)) return;
    this._erase(s);
  }

  /** Re-hashes a shape after shapeFromPart(part, s). */
  update(s) {
    if (!this.shapes.has(s)) return this.add(s);
    this._erase(s);
    this._insert(s);
    return s;
  }

  clear() {
    this.grid.clear();
    this.big.length = 0;
    this.shapes.clear();
  }

  _key(ix, iz) {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  _insert(s) {
    if (s.maxX - s.minX > BIG || s.maxZ - s.minZ > BIG) {
      s.cells = null;
      s.isBig = true;
      this.big.push(s);
      return;
    }
    s.isBig = false;
    s.cells = [];
    const c = this.cell;
    const x1 = Math.floor(s.maxX / c);
    const z1 = Math.floor(s.maxZ / c);
    for (let ix = Math.floor(s.minX / c); ix <= x1; ix++) {
      for (let iz = Math.floor(s.minZ / c); iz <= z1; iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(s);
        s.cells.push(k);
      }
    }
  }

  _erase(s) {
    if (s.isBig) {
      const i = this.big.indexOf(s);
      if (i >= 0) this.big.splice(i, 1);
      return;
    }
    for (const k of s.cells || []) {
      const arr = this.grid.get(k);
      if (!arr) continue;
      const i = arr.indexOf(s);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.grid.delete(k);
    }
    s.cells = [];
  }

  /** Shapes whose AABB overlaps the box (out is cleared first). */
  query(minX, minY, minZ, maxX, maxY, maxZ, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    const c = this.cell;
    const x1 = Math.floor(maxX / c);
    const z1 = Math.floor(maxZ / c);
    for (let ix = Math.floor(minX / c); ix <= x1; ix++) {
      for (let iz = Math.floor(minZ / c); iz <= z1; iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const s = arr[i];
          if (s._stamp === stamp) continue;
          s._stamp = stamp;
          if (s.maxX < minX || s.minX > maxX || s.maxY < minY || s.minY > maxY || s.maxZ < minZ || s.minZ > maxZ) continue;
          out.push(s);
        }
      }
    }
    for (const s of this.big) {
      if (s.maxX < minX || s.minX > maxX || s.maxY < minY || s.minY > maxY || s.maxZ < minZ || s.minZ > maxZ) continue;
      out.push(s);
    }
    return out;
  }

  /** Signed distance from a world point to a shape. */
  sdf(s, x, y, z) {
    const m = s.m;
    const px = x - s.cx;
    const py = y - s.cy;
    const pz = z - s.cz;
    return sdLocal(s, m[0] * px + m[3] * py + m[6] * pz, m[1] * px + m[4] * py + m[7] * pz, m[2] * px + m[5] * py + m[8] * pz);
  }

  /** Outward unit normal (world) of the shape's distance field at a point → out {x, y, z}. */
  normal(s, x, y, z, out) {
    const m = s.m;
    const px = x - s.cx;
    const py = y - s.cy;
    const pz = z - s.cz;
    const lx = m[0] * px + m[3] * py + m[6] * pz;
    const ly = m[1] * px + m[4] * py + m[7] * pz;
    const lz = m[2] * px + m[5] * py + m[8] * pz;
    const e = 0.004;
    const gx = sdLocal(s, lx + e, ly, lz) - sdLocal(s, lx - e, ly, lz);
    const gy = sdLocal(s, lx, ly + e, lz) - sdLocal(s, lx, ly - e, lz);
    const gz = sdLocal(s, lx, ly, lz + e) - sdLocal(s, lx, ly, lz - e);
    let wx = m[0] * gx + m[1] * gy + m[2] * gz;
    let wy = m[3] * gx + m[4] * gy + m[5] * gz;
    let wz = m[6] * gx + m[7] * gy + m[8] * gz;
    const len = Math.hypot(wx, wy, wz);
    if (len > 1e-10) {
      wx /= len;
      wy /= len;
      wz /= len;
    } else {
      wx = 0;
      wy = 1;
      wz = 0;
    }
    out.x = wx;
    out.y = wy;
    out.z = wz;
    return out;
  }

  /**
   * Nearest hit along o + t·d for t in [0, maxT] (d need not be unit; t is in units of d).
   * filter(shape) → bool (optional). Returns `hit` ({shape, t, x, y, z, nx, ny, nz}) or null.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT = Infinity, filter = null, hit = {}) {
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd < 1e-18) return null;
    let best = maxT;
    let bestS = null;
    const tmp = this._tmp;
    let bnx = 0;
    let bny = 1;
    let bnz = 0;
    for (const s of this.shapes) {
      if (filter && !filter(s)) continue;
      // bounding sphere reject
      const px = s.cx - ox;
      const py = s.cy - oy;
      const pz = s.cz - oz;
      const tc = (px * dx + py * dy + pz * dz) / dd;
      const qx = px - dx * tc;
      const qy = py - dy * tc;
      const qz = pz - dz * tc;
      const r = s.radius;
      if (qx * qx + qy * qy + qz * qz > r * r) continue;
      if (tc - r / Math.sqrt(dd) > best) continue;
      const t = rayShape(s, ox, oy, oz, dx, dy, dz, tmp);
      if (t < best) {
        best = t;
        bestS = s;
        bnx = tmp.nx;
        bny = tmp.ny;
        bnz = tmp.nz;
      }
    }
    if (!bestS) return null;
    hit.shape = bestS;
    hit.t = best;
    hit.x = ox + dx * best;
    hit.y = oy + dy * best;
    hit.z = oz + dz * best;
    hit.nx = bnx;
    hit.ny = bny;
    hit.nz = bnz;
    return hit;
  }
}
