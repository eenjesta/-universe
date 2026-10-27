/**
 * Signed-distance sculpt model (characters module).
 *
 * A model is an ordered list of primitives (ellipsoid, round cone, rounded
 * box, torus, half-space, lofted superellipse "torso" table) collected into
 * groups. Inside a group primitives are combined in order (smooth union,
 * smooth subtraction or intersection); groups are then combined in order
 * (hard/smooth union or subtraction), so e.g. a jacket and trousers can meet
 * in a crisp hem while each garment stays smoothly blended inside.
 * Every primitive carries a material slot (colour region) and a skinning
 * part. Bounding spheres allow spatial culling: polygonizers ask for the
 * primitives near a block once and evaluate only those (allocation-free).
 * Negative distance = inside.
 */

export const ELL = 0;
export const CONE = 1;
export const BOX = 2;
export const TORUS = 3;
export const PLANE = 4;
export const LOFT = 5;
export const FUNC = 6;

const OP_ADD = 0;
const OP_SUB = 1;
const OP_INT = 2;
const opCode = (op) => (op === 'sub' ? OP_SUB : op === 'int' ? OP_INT : OP_ADD);

/** Polynomial smooth minimum (k = blend radius in metres; 0 = hard). */
export function smin(a, b, k) {
  const m = a < b ? a : b;
  if (k <= 0) return m;
  const diff = a > b ? a - b : b - a;
  if (diff >= k) return m;
  const h = (k - diff) / k;
  return m - h * h * k * 0.25;
}
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

/** 3×3 rotation (row-major, local→world) from Euler XYZ angles. */
export function rotXYZ(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // R = Rx · Ry · Rz (three.js 'XYZ' order)
  return [
    cy * cz, -cy * sz, sy,
    cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
    sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy,
  ];
}

class Prim {
  constructor(kind, p, o) {
    this.kind = kind;
    this.p = p;
    this.op = opCode(o.op);
    this.k = o.k ?? 0;
    this.mat = o.mat ?? 'main';
    this.part = o.part ?? 0;
    this.tag = o.tag ?? null;
    this.group = 0;
    // cuts (intersections) and half-spaces act everywhere: never culled
    this.noCull = !!o.noCull || kind === PLANE || this.op === OP_INT;
    this.cx = 0;
    this.cy = 0;
    this.cz = 0;
    this.br = 0;
    this.rot = o.rot || null; // row-major local→world rotation (we apply its transpose)
    this.table = null; // LOFT only
    this.fn = null; // FUNC only
  }
}

/**
 * Lofted torso table: rows [{ y, r(θ) }] resampled on a regular y grid. The
 * surface radius around the vertical axis (x = 0, z = 0) is r(y, θ) with
 * θ = atan2(x, −z) (0 = front, +π/2 = +X). Distance ≈ (ρ − r) / √(1 + r_y²).
 */
export class LoftTable {
  constructor(y0, y1, dy, nTheta) {
    this.y0 = y0;
    this.y1 = y1;
    this.ny = Math.max(2, Math.ceil((y1 - y0) / dy) + 1);
    this.dy = (y1 - y0) / (this.ny - 1);
    this.nt = nTheta;
    // interleaved [radius, slope factor 1/√(1 + r_y²)] per (row, angle)
    this.r = new Float32Array(this.ny * nTheta * 2);
    this.rmax = 0;
  }

  /** Fills the table with fn(y, θ) → radius, then derives the slope factors. */
  fill(fn) {
    let rmax = 0;
    const nt = this.nt;
    const R = this.r;
    for (let i = 0; i < this.ny; i++) {
      const y = this.y0 + i * this.dy;
      for (let j = 0; j < nt; j++) {
        const th = -Math.PI + (j / nt) * Math.PI * 2;
        const r = fn(y, th);
        R[(i * nt + j) * 2] = r;
        if (r > rmax) rmax = r;
      }
    }
    for (let i = 0; i < this.ny; i++) {
      const ia = Math.min(this.ny - 1, i + 1);
      const ib = Math.max(0, i - 1);
      for (let j = 0; j < nt; j++) {
        const g = (R[(ia * nt + j) * 2] - R[(ib * nt + j) * 2]) / ((ia - ib) * this.dy);
        R[(i * nt + j) * 2 + 1] = 1 / Math.sqrt(1 + g * g);
      }
    }
    this.rmax = rmax;
    return this;
  }

  /** Radius at (y, θ) with bilinear interpolation (y clamped). */
  radius(y, th) {
    this.sample(y, th);
    return _ls.r;
  }

  /** Bilinear sample of radius + slope factor into the shared scratch _ls. */
  sample(y, th) {
    let fy = (y - this.y0) / this.dy;
    const lim = this.ny - 1.0001;
    fy = fy < 0 ? 0 : fy > lim ? lim : fy;
    const i = fy | 0;
    const t = fy - i;
    const nt = this.nt;
    let ft = (th + Math.PI) * (nt / (Math.PI * 2));
    if (ft < 0) ft += nt;
    let j = ft | 0;
    const u = ft - j;
    if (j >= nt) j -= nt;
    const j1 = j + 1 === nt ? 0 : j + 1;
    const R = this.r;
    const a0 = (i * nt + j) * 2;
    const a1 = (i * nt + j1) * 2;
    const b0 = ((i + 1) * nt + j) * 2;
    const b1 = ((i + 1) * nt + j1) * 2;
    const ra = R[a0] + (R[a1] - R[a0]) * u;
    const rb = R[b0] + (R[b1] - R[b0]) * u;
    const fa = R[a0 + 1] + (R[a1 + 1] - R[a0 + 1]) * u;
    const fb = R[b0 + 1] + (R[b1 + 1] - R[b0 + 1]) * u;
    _ls.r = ra + (rb - ra) * t;
    _ls.f = fa + (fb - fa) * t;
    return _ls;
  }
}
const _ls = { r: 0, f: 1 };

/** Fast atan2 (max error ≈ 1e-5 rad). */
export function fastAtan2(y, x) {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const mx = ax > ay ? ax : ay;
  if (mx === 0) return 0;
  const a = (ax < ay ? ax : ay) / mx;
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.57079637 - r;
  if (x < 0) r = 3.14159274 - r;
  return y < 0 ? -r : r;
}

/** Distance of one primitive (no allocation). */
function primDist(pr, x, y, z) {
  const p = pr.p;
  switch (pr.kind) {
    case ELL: {
      let lx = x - p[0];
      let ly = y - p[1];
      let lz = z - p[2];
      const R = pr.rot;
      if (R) {
        const tx = R[0] * lx + R[3] * ly + R[6] * lz;
        const ty = R[1] * lx + R[4] * ly + R[7] * lz;
        const tz = R[2] * lx + R[5] * ly + R[8] * lz;
        lx = tx;
        ly = ty;
        lz = tz;
      }
      const px = lx / p[3];
      const py = ly / p[4];
      const pz = lz / p[5];
      const k0 = Math.sqrt(px * px + py * py + pz * pz);
      const qx = px / p[3];
      const qy = py / p[4];
      const qz = pz / p[5];
      const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1e-9;
      return (k0 * (k0 - 1)) / k1;
    }
    case CONE: {
      // round cone with linearly interpolated radius (good for gentle tapers)
      const pax = x - p[0];
      const pay = y - p[1];
      const paz = z - p[2];
      let h = (pax * p[8] + pay * p[9] + paz * p[10]) * p[11];
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const dx = pax - p[8] * h;
      const dy = pay - p[9] * h;
      const dz = paz - p[10] * h;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - (p[6] + (p[7] - p[6]) * h);
    }
    case BOX: {
      let lx = x - p[0];
      let ly = y - p[1];
      let lz = z - p[2];
      const R = pr.rot;
      if (R) {
        const tx = R[0] * lx + R[3] * ly + R[6] * lz;
        const ty = R[1] * lx + R[4] * ly + R[7] * lz;
        const tz = R[2] * lx + R[5] * ly + R[8] * lz;
        lx = tx;
        ly = ty;
        lz = tz;
      }
      const rr = p[6];
      const qx = Math.abs(lx) - p[3] + rr;
      const qy = Math.abs(ly) - p[4] + rr;
      const qz = Math.abs(lz) - p[5] + rr;
      const mx = qx > 0 ? qx : 0;
      const my = qy > 0 ? qy : 0;
      const mz = qz > 0 ? qz : 0;
      const inner = Math.max(qx, Math.max(qy, qz));
      return Math.sqrt(mx * mx + my * my + mz * mz) + (inner < 0 ? inner : 0) - rr;
    }
    case TORUS: {
      let lx = x - p[0];
      let ly = y - p[1];
      let lz = z - p[2];
      const R = pr.rot;
      if (R) {
        const tx = R[0] * lx + R[3] * ly + R[6] * lz;
        const ty = R[1] * lx + R[4] * ly + R[7] * lz;
        const tz = R[2] * lx + R[5] * ly + R[8] * lz;
        lx = tx;
        ly = ty;
        lz = tz;
      }
      // optional ellipse scaling of the ring (p[5] = x scale, p[6] = z scale)
      const ex = lx / p[5];
      const ez = lz / p[6];
      const q = Math.sqrt(ex * ex + ez * ez) - p[3];
      return Math.sqrt(q * q + ly * ly) - p[4];
    }
    case PLANE:
      return p[0] * x + p[1] * y + p[2] * z - p[3];
    case LOFT: {
      const T = pr.table;
      const rho = Math.sqrt(x * x + z * z);
      T.sample(y, fastAtan2(x, -z));
      let d = (rho - _ls.r) * _ls.f;
      // rounded caps (p[0] top, p[1] bottom)
      d = smax(d, y - T.y1, p[0]);
      d = smax(d, T.y0 - y, p[1]);
      return d;
    }
    case FUNC:
      return pr.fn(x, y, z);
    default:
      return 1e9;
  }
}

export class SdfModel {
  constructor() {
    this.prims = [];
    this.groups = []; // { name, op, k, start, end }
    this.parts = []; // part names (index = part id)
    this.partIndex = new Map();
    this._cur = null;
    this.finalized = false;
  }

  /** Part id for a name (creates it). */
  part(name) {
    let i = this.partIndex.get(name);
    if (i == null) {
      i = this.parts.length;
      this.parts.push(name);
      this.partIndex.set(name, i);
    }
    return i;
  }

  /** Starts a new group: op 'add' (union, k = blend) | 'sub' (carve everything so far). */
  group(name, { op = 'add', k = 0 } = {}) {
    const g = { name, op: opCode(op), k, start: this.prims.length, end: this.prims.length, index: this.groups.length };
    this.groups.push(g);
    this._cur = g;
    return g;
  }

  _push(kind, p, o) {
    if (!this._cur) this.group('default');
    const pr = new Prim(kind, p, { ...o, part: typeof o.part === 'string' ? this.part(o.part) : o.part ?? this.part('body') });
    pr.group = this._cur.index;
    this.prims.push(pr);
    this._cur.end = this.prims.length;
    return pr;
  }

  /** Ellipsoid: c [x,y,z], r [rx,ry,rz]; o: { op, k, mat, part, rot: rotXYZ(...) } */
  ell(c, r, o = {}) {
    const pr = this._push(ELL, Float64Array.of(c[0], c[1], c[2], r[0], r[1], r[2]), o);
    pr.cx = c[0];
    pr.cy = c[1];
    pr.cz = c[2];
    pr.br = Math.max(r[0], r[1], r[2]);
    return pr;
  }

  /** Round cone from a (radius r1) to b (radius r2). */
  cone(a, b, r1, r2 = r1, o = {}) {
    const bax = b[0] - a[0];
    const bay = b[1] - a[1];
    const baz = b[2] - a[2];
    const l2 = bax * bax + bay * bay + baz * baz || 1e-9;
    const pr = this._push(CONE, Float64Array.of(a[0], a[1], a[2], b[0], b[1], b[2], r1, r2, bax, bay, baz, 1 / l2), o);
    pr.cx = (a[0] + b[0]) / 2;
    pr.cy = (a[1] + b[1]) / 2;
    pr.cz = (a[2] + b[2]) / 2;
    pr.br = Math.sqrt(l2) / 2 + Math.max(r1, r2);
    return pr;
  }

  /** Rounded box: centre c, half extents h, rounding radius rr. */
  box(c, h, rr = 0, o = {}) {
    const pr = this._push(BOX, Float64Array.of(c[0], c[1], c[2], h[0], h[1], h[2], Math.min(rr, h[0], h[1], h[2])), o);
    pr.cx = c[0];
    pr.cy = c[1];
    pr.cz = c[2];
    pr.br = Math.hypot(h[0], h[1], h[2]);
    return pr;
  }

  /** Torus in the local XZ plane: ring radius R, tube radius r, ellipse scale sx/sz. */
  torus(c, R, r, o = {}, sx = 1, sz = 1) {
    const pr = this._push(TORUS, Float64Array.of(c[0], c[1], c[2], R, r, sx, sz), o);
    pr.cx = c[0];
    pr.cy = c[1];
    pr.cz = c[2];
    pr.br = R * Math.max(sx, sz) + r;
    return pr;
  }

  /** Half-space n·p > d is outside (use with op 'int' to cut). */
  plane(n, d, o = {}) {
    return this._push(PLANE, Float64Array.of(n[0], n[1], n[2], d), { ...o, noCull: true });
  }

  /** Lofted torso (LoftTable around the Y axis); capTop/capBot = rounding radii. */
  loft(table, o = {}, capTop = 0.02, capBot = 0.02) {
    const pr = this._push(LOFT, Float64Array.of(capTop, capBot), o);
    pr.table = table;
    pr.cx = 0;
    pr.cy = (table.y0 + table.y1) / 2;
    pr.cz = 0;
    pr.br = Math.hypot(table.rmax, (table.y1 - table.y0) / 2);
    return pr;
  }

  /**
   * Custom distance function fn(x, y, z) (e.g. a hairline cut). With a bound
   * { c: [x,y,z], r } it is culled like other primitives, otherwise never.
   */
  func(fn, o = {}, bound = null) {
    const pr = this._push(FUNC, new Float64Array(0), { ...o, noCull: o.noCull ?? !bound });
    pr.fn = fn;
    if (bound) {
      pr.cx = bound.c[0];
      pr.cy = bound.c[1];
      pr.cz = bound.c[2];
      pr.br = bound.r;
    }
    return pr;
  }

  /** Must be called after the last primitive (prepares culling data). */
  finalize() {
    this.finalized = true;
    this.n = this.prims.length;
    this.partCount = this.parts.length;
    return this;
  }

  /**
   * Indices of primitives that can influence the field inside the sphere
   * (cx, cy, cz, r). Fills `out` (Int32Array) and returns the count.
   */
  cull(cx, cy, cz, r, out) {
    let n = 0;
    const P = this.prims;
    for (let i = 0; i < P.length; i++) {
      const pr = P[i];
      if (!pr.noCull) {
        const dx = pr.cx - cx;
        const dy = pr.cy - cy;
        const dz = pr.cz - cz;
        const lim = pr.br + r + pr.k + this._groupK(pr.group);
        if (dx * dx + dy * dy + dz * dz > lim * lim) continue;
      }
      out[n++] = i;
    }
    return n;
  }

  _groupK(g) {
    return this.groups[g].k;
  }

  /** Field value at (x, y, z) using the culled list (count n). */
  dist(x, y, z, list, n) {
    const P = this.prims;
    const G = this.groups;
    let D = 1e9;
    let gi = -1;
    let dg = 1e9;
    for (let a = 0; a <= n; a++) {
      const pr = a < n ? P[list[a]] : null;
      if (!pr || pr.group !== gi) {
        // flush the finished group
        if (gi >= 0 && dg < 1e8) {
          const g = G[gi];
          D = g.op === OP_SUB ? smax(D, -dg, g.k) : smin(D, dg, g.k);
        }
        if (!pr) break;
        gi = pr.group;
        dg = 1e9;
      }
      const d = primDist(pr, x, y, z);
      if (pr.op === OP_ADD) dg = smin(dg, d, pr.k);
      else if (pr.op === OP_SUB) dg = smax(dg, -d, pr.k);
      else dg = smax(dg, d, pr.k);
    }
    return D;
  }

  /**
   * Detailed query for colouring + skinning: nearest material (in the winning
   * group), per-part raw distances (Float32Array partCount) and the winning
   * primitive. Returns the primitive index.
   */
  query(x, y, z, list, n, partD) {
    const P = this.prims;
    const G = this.groups;
    partD.fill(1e9);
    let bestG = -1;
    let bestGD = 1e9;
    let gi = -1;
    let dg = 1e9;
    let gBestPrim = -1;
    let gBestD = 1e9;
    let winPrim = -1;
    for (let a = 0; a <= n; a++) {
      const pr = a < n ? P[list[a]] : null;
      if (!pr || pr.group !== gi) {
        if (gi >= 0 && dg < 1e8 && G[gi].op !== OP_SUB && dg < bestGD) {
          bestGD = dg;
          bestG = gi;
          winPrim = gBestPrim;
        }
        if (!pr) break;
        gi = pr.group;
        dg = 1e9;
        gBestPrim = -1;
        gBestD = 1e9;
      }
      const d = primDist(pr, x, y, z);
      if (pr.op === OP_ADD) {
        dg = smin(dg, d, pr.k);
        if (d < gBestD) {
          gBestD = d;
          gBestPrim = list[a];
        }
        if (G[gi].op !== OP_SUB && d < partD[pr.part]) partD[pr.part] = d;
      } else if (pr.op === OP_SUB) dg = smax(dg, -d, pr.k);
      else dg = smax(dg, d, pr.k);
    }
    void bestG;
    return winPrim;
  }

  /** Raw distance of one primitive (e.g. for masks in colour functions). */
  primDistance(i, x, y, z) {
    return primDist(this.prims[i], x, y, z);
  }
}
