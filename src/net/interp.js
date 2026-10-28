/**
 * Snapshot buffer + interpolation for one remote entity (player, enemy,
 * projectile). Pure logic, allocation-free after construction.
 *
 *   const tr = new Track();
 *   tr.push(st, x, y, z, h, row);           // every S.SNAP that contains the entity
 *   tr.sample(serverTime - NET.INTERP_DELAY_MS, out);
 *   // out.x/y/z/h interpolated, out.vx/vy/vz (m/s), out.d = row at/before the render
 *   // time (discrete fields: anim, mode, vehicle), out.dn = newest row (hp/shield)
 *
 * Positions between two samples are lerped (heading along the shortest arc).
 * Past the newest sample the motion is extrapolated for at most `maxExtrap` ms,
 * then held. A jump of more than SNAP_DIST between two samples (respawn,
 * teleport, vehicle exit) snaps instead of sweeping across the map.
 */
const SNAP_DIST2 = 40 * 40;
const TAU = Math.PI * 2;

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function lerpAngle(a, b, f) {
  return a + wrapAngle(b - a) * f;
}

export class Track {
  constructor(cap = 24) {
    this.cap = cap;
    this.t = new Float64Array(cap);
    this.x = new Float64Array(cap);
    this.y = new Float64Array(cap);
    this.z = new Float64Array(cap);
    this.h = new Float64Array(cap);
    this.d = new Array(cap).fill(null);
    this.n = 0;
    this.w = 0;
  }

  clear() {
    this.n = 0;
    this.w = 0;
    this.d.fill(null);
  }

  get size() {
    return this.n;
  }

  /** Index of the newest sample (only valid when size > 0). */
  get newest() {
    return (this.w - 1 + this.cap) % this.cap;
  }

  get newestTime() {
    return this.n ? this.t[this.newest] : -Infinity;
  }

  /** Adds a sample; out-of-order samples are dropped, an equal time overwrites. */
  push(t, x, y, z, h, d = null) {
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    let i = this.w;
    if (this.n) {
      const li = this.newest;
      if (t < this.t[li]) return false;
      if (t === this.t[li]) i = li;
    }
    this.t[i] = t;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.h[i] = Number.isFinite(h) ? h : 0;
    this.d[i] = d;
    if (i === this.w) {
      this.w = (this.w + 1) % this.cap;
      if (this.n < this.cap) this.n++;
    }
    return true;
  }

  _copy(i, out) {
    out.x = this.x[i];
    out.y = this.y[i];
    out.z = this.z[i];
    out.h = this.h[i];
    out.d = this.d[i];
  }

  /**
   * Interpolated state at render time `rt` (ms, server clock) written into
   * `out` ({x, y, z, h, vx, vy, vz, d, dn, extrapolating}). Returns false when empty.
   */
  sample(rt, out, maxExtrap = 120) {
    const n = this.n;
    if (!n) return false;
    const cap = this.cap;
    const newest = this.newest;
    out.dn = this.d[newest];
    out.vx = 0;
    out.vy = 0;
    out.vz = 0;
    out.extrapolating = false;
    if (rt >= this.t[newest]) {
      this._copy(newest, out);
      if (n >= 2) {
        const p = (newest - 1 + cap) % cap;
        const dt = this.t[newest] - this.t[p];
        const dx = this.x[newest] - this.x[p];
        const dy = this.y[newest] - this.y[p];
        const dz = this.z[newest] - this.z[p];
        if (dt > 0 && dt < 1000 && dx * dx + dy * dy + dz * dz < SNAP_DIST2) {
          out.vx = (dx / dt) * 1000;
          out.vy = (dy / dt) * 1000;
          out.vz = (dz / dt) * 1000;
          const e = Math.min(rt - this.t[newest], maxExtrap) / 1000;
          if (e > 0) {
            out.x += out.vx * e;
            out.y += out.vy * e;
            out.z += out.vz * e;
            out.extrapolating = true;
          }
        }
      }
      return true;
    }
    const oldest = (this.w - n + cap) % cap;
    if (rt <= this.t[oldest]) {
      this._copy(oldest, out);
      return true;
    }
    let b = newest;
    for (let k = 1; k < n; k++) {
      const a = (b - 1 + cap) % cap;
      if (this.t[a] <= rt) {
        const span = this.t[b] - this.t[a];
        const f = span > 0 ? (rt - this.t[a]) / span : 1;
        const dx = this.x[b] - this.x[a];
        const dy = this.y[b] - this.y[a];
        const dz = this.z[b] - this.z[a];
        if (dx * dx + dy * dy + dz * dz > SNAP_DIST2) {
          this._copy(f < 0.5 ? a : b, out);
          return true;
        }
        out.x = this.x[a] + dx * f;
        out.y = this.y[a] + dy * f;
        out.z = this.z[a] + dz * f;
        out.h = lerpAngle(this.h[a], this.h[b], f);
        out.d = this.d[a];
        if (span > 0) {
          out.vx = (dx / span) * 1000;
          out.vy = (dy / span) * 1000;
          out.vz = (dz / span) * 1000;
        }
        return true;
      }
      b = a;
    }
    this._copy(oldest, out);
    return true;
  }
}
