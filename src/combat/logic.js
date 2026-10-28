/**
 * Pure combat logic (no DOM, no three.js) — shared by the browser modules and
 * the node tests (node --test src/combat/):
 *
 *   WeaponState        client-side prediction of one weapon: magazine, reserve,
 *                      fire cooldown, reload timer, railgun charge, spread bloom
 *   spreadDeg()        current cone (hip / aimed / moving / airborne + bloom)
 *   spreadDir()        random direction inside a cone (uniform disk)
 *   raySphere()        ray vs sphere → nearest t ≥ 0 or -1
 *   enemyVolumes()     hit spheres of an enemy in world space
 *   simulateArc()      grenade arc preview (gravity, ground bounces, fuse)
 *   damageAngle()      screen angle of a damage source (0 = ahead, +π/2 = right)
 *   enemyState()       snapshot state (ES int | string) → 'idle'|'patrol'|'chase'|'attack'|'leap'|'stunned'|'dead'|'return'
 *   readInv()/mergeInv()  tolerant readers of the server inventory (INV / welcome.inv)
 *   assistPick()       light aim assist: closest target inside a cone
 */

const DEG = Math.PI / 180;

export class WeaponState {
  constructor(def) {
    this.def = def;
    this.mag = def.kind === 'throw' ? 0 : def.mag;
    this.reserve = def.kind === 'throw' ? def.carry || def.reserve || 0 : def.reserve;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.charging = false;
    this.charge = 0; // 0..1
    this.bloom = 0; // extra spread (deg) from sustained fire
    this.known = false; // true once the server told us the real numbers
  }

  /** Rounds available for the next shot (grenades: carried count). */
  get rounds() {
    return this.def.kind === 'throw' ? this.reserve : this.mag;
  }

  get canFire() {
    return !this.reloading && this.cooldown <= 0 && this.rounds > 0;
  }

  /** Consumes one round; returns false when it can't fire now. */
  fire() {
    if (!this.canFire) return false;
    if (this.def.kind === 'throw') this.reserve--;
    else this.mag--;
    this.cooldown = 1 / Math.max(0.05, this.def.rate || 1);
    if (this.def.auto) this.bloom = Math.min(1.4, this.bloom + 0.22);
    else this.bloom = Math.min(1.4, this.bloom + 0.35);
    this.charging = false;
    this.charge = 0;
    return true;
  }

  get canReload() {
    return this.def.kind !== 'throw' && !this.reloading && this.mag < this.def.mag && this.reserve > 0;
  }

  startReload() {
    if (!this.canReload) return false;
    this.reloading = true;
    this.reloadT = this.def.reload || 1.5;
    this.charging = false;
    this.charge = 0;
    return true;
  }

  cancelReload() {
    this.reloading = false;
    this.reloadT = 0;
  }

  /** Reload progress 0..1 (1 when not reloading). */
  get reloadProgress() {
    if (!this.reloading) return 1;
    const total = this.def.reload || 1.5;
    return Math.max(0, Math.min(1, 1 - this.reloadT / total));
  }

  /**
   * Advances timers. `holdCharge` = the trigger is held on a charge weapon.
   * Returns 'reloaded' | 'charged' | null.
   */
  update(dt, holdCharge = false) {
    let ev = null;
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - dt * (this.def.auto ? 2.2 : 1.6));
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const take = Math.min(this.def.mag - this.mag, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloading = false;
        this.reloadT = 0;
        ev = 'reloaded';
      }
    }
    if (this.def.kind === 'charge') {
      if (holdCharge && !this.reloading && this.cooldown <= 0 && this.mag > 0) {
        const was = this.charge;
        this.charging = true;
        this.charge = Math.min(1, this.charge + dt / Math.max(0.05, this.def.charge || 0.4));
        if (was < 1 && this.charge >= 1) ev = ev || 'charged';
      } else {
        this.charging = false;
        this.charge = Math.max(0, this.charge - dt * 4);
      }
    }
    return ev;
  }

  /** Applies server numbers (undefined fields are ignored). */
  sync(mag, reserve) {
    if (Number.isFinite(mag) && this.def.kind !== 'throw') {
      // keep the local prediction while a shot is in flight if it is lower (no "refill" flicker)
      this.mag = Math.max(0, Math.min(this.def.mag, mag));
    }
    if (Number.isFinite(reserve)) this.reserve = Math.max(0, reserve);
    if (Number.isFinite(mag) || Number.isFinite(reserve)) this.known = true;
  }
}

/** Current spread cone half-angle in degrees. */
export function spreadDeg(def, { aiming = false, moving = 0, airborne = false, bloom = 0 } = {}) {
  let s = aiming ? def.spreadAim ?? 0 : def.spread ?? 0;
  s *= 1 + Math.max(0, Math.min(1, moving)) * (aiming ? 0.6 : 0.9);
  if (airborne) s *= 1.8;
  return s + bloom * (aiming ? 0.45 : 1);
}

/**
 * Random direction inside a cone of `deg` around unit vector d → out {x,y,z}.
 * u1, u2 ∈ [0,1) (pass Math.random() values; tests pass fixed numbers).
 */
export function spreadDir(d, deg, u1, u2, out) {
  out.x = d.x;
  out.y = d.y;
  out.z = d.z;
  if (!(deg > 0)) return out;
  // orthonormal basis around d
  let ax = 0;
  let ay = 1;
  let az = 0;
  if (Math.abs(d.y) > 0.92) {
    ax = 1;
    ay = 0;
  }
  // r1 = normalize(cross(d, a))
  let r1x = d.y * az - d.z * ay;
  let r1y = d.z * ax - d.x * az;
  let r1z = d.x * ay - d.y * ax;
  const l1 = Math.hypot(r1x, r1y, r1z) || 1;
  r1x /= l1;
  r1y /= l1;
  r1z /= l1;
  // r2 = cross(r1, d)
  const r2x = r1y * d.z - r1z * d.y;
  const r2y = r1z * d.x - r1x * d.z;
  const r2z = r1x * d.y - r1y * d.x;
  const rad = Math.tan(deg * DEG) * Math.sqrt(u1);
  const ang = u2 * Math.PI * 2;
  const a = Math.cos(ang) * rad;
  const b = Math.sin(ang) * rad;
  out.x = d.x + r1x * a + r2x * b;
  out.y = d.y + r1y * a + r2y * b;
  out.z = d.z + r1z * a + r2z * b;
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= l;
  out.y /= l;
  out.z /= l;
  return out;
}

/** Ray (origin o, unit dir d) vs sphere (c, r): nearest t ≥ 0, or -1. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  const t0 = tca - thc;
  const t1 = tca + thc;
  if (t1 < 0) return -1;
  return t0 >= 0 ? t0 : 0; // origin inside the sphere → 0
}

/**
 * World-space hit spheres of an enemy: `out` is a Float32Array/array of
 * [x, y, z, r] × n; returns n. vols = [[forward, dy, r], …], heading h
 * (forward = (−sin h, 0, −cos h)).
 */
export function enemyVolumes(vols, x, y, z, h, out) {
  const fx = -Math.sin(h);
  const fz = -Math.cos(h);
  let n = 0;
  for (const v of vols) {
    out[n * 4] = x + fx * v[0];
    out[n * 4 + 1] = y + v[1];
    out[n * 4 + 2] = z + fz * v[0];
    out[n * 4 + 3] = v[2];
    n++;
  }
  return n;
}

/**
 * Grenade arc preview. o/v = start position / velocity {x,y,z}; opts:
 * { gravity = 18, bounce = 0.35, fuse = 1.6, radius = 0.1, ground(x, z) → y, dt = 1/30, maxBounces = 3 }.
 * Writes up to `max` points into `pts` (flat x,y,z) and returns
 * { n, x, y, z, bounces, t } (the detonation point after `fuse` seconds or when it settles).
 */
export function simulateArc(o, v, opts, pts, max = 64, res = { n: 0, x: 0, y: 0, z: 0, bounces: 0, t: 0 }) {
  const g = opts.gravity ?? 18;
  const bounce = opts.bounce ?? 0.35;
  const fuse = opts.fuse ?? 1.6;
  const rad = opts.radius ?? 0.1;
  const dt = opts.dt ?? 1 / 30;
  const ground = opts.ground || (() => 0);
  const maxB = opts.maxBounces ?? 3;
  let x = o.x;
  let y = o.y;
  let z = o.z;
  let vx = v.x;
  let vy = v.y;
  let vz = v.z;
  let t = 0;
  let n = 0;
  let bounces = 0;
  const push = () => {
    if (n < max) {
      pts[n * 3] = x;
      pts[n * 3 + 1] = y;
      pts[n * 3 + 2] = z;
      n++;
    }
  };
  push();
  while (t < fuse) {
    vy -= g * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    t += dt;
    const gy = ground(x, z) + rad;
    if (y < gy) {
      y = gy;
      if (bounces >= maxB || Math.abs(vy) < 1.2) {
        vy = 0;
        vx *= 0.5;
        vz *= 0.5;
        if (Math.hypot(vx, vz) < 0.4) {
          push();
          break;
        }
      } else {
        vy = -vy * bounce;
        vx *= 0.62;
        vz *= 0.62;
        bounces++;
      }
    }
    push();
  }
  res.n = n;
  res.x = x;
  res.y = y;
  res.z = z;
  res.bounces = bounces;
  res.t = t;
  return res;
}

/**
 * Screen angle of a world point relative to the camera yaw (radians):
 * 0 = straight ahead (top of the screen), +π/2 = right, ±π = behind.
 */
export function damageAngle(yaw, px, pz, sx, sz) {
  const vx = sx - px;
  const vz = sz - pz;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return Math.atan2(vx * rx + vz * rz, vx * fx + vz * fz);
}

// shared/protocol.js ES codes: IDLE 0, PATROL 1, CHASE 2, ATTACK 3, LEAP 4, STUN 5, DEAD 6, RETURN 7
const STATE_INT = ['idle', 'patrol', 'chase', 'attack', 'leap', 'stunned', 'dead', 'return'];
const STATE_ALIASES = {
  idle: 'idle',
  rest: 'idle',
  sleep: 'idle',
  patrol: 'patrol',
  wander: 'patrol',
  roam: 'patrol',
  move: 'patrol',
  chase: 'chase',
  hunt: 'chase',
  alert: 'chase',
  pursue: 'chase',
  attack: 'attack',
  fire: 'attack',
  shoot: 'attack',
  strike: 'attack',
  melee: 'attack',
  lunge: 'leap',
  leap: 'leap',
  pounce: 'leap',
  return: 'return',
  home: 'return',
  stun: 'stunned',
  stunned: 'stunned',
  shock: 'stunned',
  dead: 'dead',
  die: 'dead',
  dying: 'dead',
};

/** Normalises a snapshot enemy state. */
export function enemyState(s) {
  if (typeof s === 'number' && Number.isFinite(s)) return STATE_INT[s | 0] || 'idle';
  if (typeof s === 'string') return STATE_ALIASES[s.toLowerCase()] || 'patrol';
  return 'idle';
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Merges an INV message into the previous inventory (patch: true = partial). */
export function mergeInv(prev, msg) {
  if (!isObj(msg)) return prev || {};
  const { t: _t, patch, ...rest } = msg;
  if (!patch || !isObj(prev)) return { ...rest };
  const out = { ...prev };
  for (const [k, v] of Object.entries(rest)) {
    if (isObj(v) && isObj(prev[k])) out[k] = { ...prev[k], ...v };
    else out[k] = v;
  }
  return out;
}

/** Owned weapon ids (Set) from an inventory; null when the inventory doesn't say. */
export function ownedWeapons(inv) {
  const w = inv?.weapons;
  if (!Array.isArray(w)) return null;
  const s = new Set();
  for (const x of w) {
    if (typeof x === 'string') s.add(x);
    else if (isObj(x) && (x.id || x.w)) s.add(x.id || x.w);
  }
  return s;
}

/** { mag, reserve } of a weapon from an inventory (undefined = unknown). */
export function readInv(inv, def) {
  if (!isObj(inv) || !def) return { mag: undefined, reserve: undefined };
  let mag;
  let reserve;
  if (isObj(inv.mag) && Number.isFinite(inv.mag[def.id])) mag = inv.mag[def.id];
  if (mag === undefined && Array.isArray(inv.weapons)) {
    const rec = inv.weapons.find((x) => isObj(x) && (x.id || x.w) === def.id);
    if (rec && Number.isFinite(rec.mag)) mag = rec.mag;
  }
  const ammo = isObj(inv.ammo) ? inv.ammo : null;
  const items = isObj(inv.items) ? inv.items : null;
  if (def.kind === 'throw') {
    const c = ammo?.[def.id] ?? ammo?.[def.ammo] ?? items?.[def.id] ?? items?.[def.ammo] ?? items?.grenade ?? items?.grenades;
    if (Number.isFinite(c)) reserve = c;
  } else if (ammo) {
    const r = ammo[def.ammo] ?? ammo[def.id];
    if (Number.isFinite(r)) reserve = r;
  }
  return { mag, reserve };
}

/**
 * Aim assist: index of the candidate closest to the ray inside `maxDeg`
 * (cands = flat [x, y, z, r, …] × n), or -1. Prefers small angles, then distance.
 */
export function assistPick(ox, oy, oz, dx, dy, dz, cands, n, maxDeg, maxDist = 120) {
  let best = -1;
  let bestScore = Infinity;
  const cosMax = Math.cos(maxDeg * DEG);
  for (let i = 0; i < n; i++) {
    const vx = cands[i * 4] - ox;
    const vy = cands[i * 4 + 1] - oy;
    const vz = cands[i * 4 + 2] - oz;
    const dist = Math.hypot(vx, vy, vz);
    if (dist < 0.5 || dist > maxDist) continue;
    const c = (vx * dx + vy * dy + vz * dz) / dist;
    // the target's own radius widens the cone a little
    const slack = Math.atan2(cands[i * 4 + 3], dist);
    if (c < Math.cos(Math.acos(cosMax) + slack)) continue;
    const score = Math.acos(Math.min(1, c)) - slack + dist * 0.0006;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Health fraction of an enemy (0..1). */
export function hpFrac(hp, max) {
  if (!Number.isFinite(hp) || !(max > 0)) return 1;
  return Math.max(0, Math.min(1, hp / max));
}
