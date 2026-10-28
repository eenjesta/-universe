/**
 * Vehicles — arcade physics for the driven vehicle (no allocations per frame).
 *
 * CarController: bicycle-model steering with grip/drift (Space = handbrake),
 *   boost (Shift, energy bar), faster on ROADS, 4-wheel height sampling for
 *   pitch/roll + suspension bob, airborne over crests, collisions with physics
 *   boxes (two circles), no driving into deep water, play-bounds clamp.
 * AirController (profiles VTOL / SHIP): hover flight — W/S forward/back, A/D
 *   strafe, mouse yaw (queueYaw, once per frame), Q/E yaw, Space up, C/Ctrl
 *   down, Shift boost; landing/take-off, collision with buildings,
 *   terrain/water clearance, nacelle tilt (VTOL), gear + stairs (ship),
 *   auto-launch climb.
 * Attitude (both): never integrated — bank/pitch are critically damped springs
 *   toward targets computed from the CURRENT inputs + velocity (bank ∝ yaw rate
 *   and strafe, pitch ∝ commanded acceleration and climb rate), clamped
 *   (≤ ~29°), back to level ~1 s after the input is released. Yaw is the only
 *   free rotation. Car: ground plane from 4 wheel samples; in the air the nose
 *   follows the trajectory and the roll relaxes to 0.
 * Both expose: speed (m/s, horizontal), forward (signed), altitude, boost
 *   (0…1 energy), boosting, braking, grounded/landed, and step(dt, input).
 */
import * as THREE from 'three';
import { ROADS, WORLD } from '../world/layout.js';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math.js';
import { CAR } from './car-model.js';

const G = 22;

/**
 * Exact critically damped spring step (frame-rate independent, no overshoot,
 * no drift): s = { x, v } moves toward `target` with angular frequency
 * `omega` (≈ 98 % settled after 5.8 / omega seconds).
 */
export function spring(s, target, omega, dt) {
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
    s.x = Number.isFinite(target) ? target : 0;
    s.v = 0;
    return s.x;
  }
  const y = s.x - target;
  const e = Math.exp(-omega * dt);
  const tmp = (s.v + omega * y) * dt;
  s.x = target + (y + tmp) * e;
  s.v = (s.v - omega * tmp) * e;
  return s.x;
}

// ------------------------------------------------------------ roads
const SEGS = [];
for (const r of ROADS) {
  for (let i = 0; i < r.points.length - 1; i++) {
    const [ax, az] = r.points[i];
    const [bx, bz] = r.points[i + 1];
    SEGS.push({ ax, az, bx, bz, hw: r.width / 2 + 0.8 });
  }
}
/** 1 on a road, fading to 0 within 2 m of its edge. */
export function roadFactor(x, z) {
  let best = 0;
  for (const s of SEGS) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const l2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - s.ax) * dx + (z - s.az) * dz) / l2);
    const px = s.ax + dx * t - x;
    const pz = s.az + dz * t - z;
    const d = Math.sqrt(px * px + pz * pz);
    const f = clamp(1 - (d - s.hw) / 2);
    if (f > best) best = f;
  }
  return best;
}

export const CAR_TUNING = {
  accel: 13,
  maxRoad: 54,
  maxOff: 36,
  boostMul: 1.4,
  boostAccel: 1.7,
  brake: 22,
  reverseMax: 11,
  gripRoad: 9,
  gripOff: 6,
  gripHand: 1.1,
  steerLow: 0.62,
  steerHigh: 0.15,
};

export class CarController {
  constructor(ctx) {
    this.ctx = ctx;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.heading = 0;
    this.vy = 0;
    this.grounded = true;
    this.steer = 0;
    this.pitch = 0;
    this.roll = 0;
    this.spin = 0;
    this.bob = 0;
    this.bobV = 0;
    this.squat = 0;
    this.lean = 0;
    this.boost = 1;
    this.boosting = false;
    this.braking = false;
    this.handbrake = false;
    this.speed = 0;
    this.forward = 0;
    this.road = 0;
    this.rpm = 0;
    this.load = 0;
    this.drift = 0;
    this.impact = 0;
    this.inWater = 0;
    this._prev = new THREE.Vector3();
    this._c = { x: 0, y: 0, z: 0 };
    this._h = [0, 0, 0, 0];
  }

  reset(v) {
    const o = v.object;
    this.pos.copy(o.position);
    this.heading = v.heading;
    this.vel.set(0, 0);
    this.vy = 0;
    this.grounded = true;
    this.steer = 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.forward = 0;
    this.boost = 1;
  }

  _ground(x, z) {
    const ph = this.ctx.physics;
    const y = ph.groundHeight(x, z, this.pos.y + 0.9, 0.9, 0);
    return Number.isFinite(y) ? y : this.ctx.world.getHeightAt(x, z);
  }

  step(dt, inp, v) {
    const ctx = this.ctx;
    const T = CAR_TUNING;
    const world = ctx.world;
    const h0 = this.heading;
    const fx = -Math.sin(h0);
    const fz = -Math.cos(h0);
    const rx = Math.cos(h0);
    const rz = -Math.sin(h0);
    let vf = this.vel.x * fx + this.vel.y * fz;
    let vr = this.vel.x * rx + this.vel.y * rz;
    const road = (this.road = roadFactor(this.pos.x, this.pos.z));
    const wantBoost = inp.boost && inp.throttle > 0 && this.boost > 0.02;
    this.boosting = wantBoost;
    this.boost = clamp(this.boost + (wantBoost ? -dt / 4.5 : dt / 7));
    const maxF = (T.maxOff + (T.maxRoad - T.maxOff) * road) * (wantBoost ? T.boostMul : 1);
    this.handbrake = !!inp.handbrake;
    this.braking = false;
    if (this.grounded) {
      if (inp.throttle > 0) {
        const a = T.accel * (wantBoost ? T.boostAccel : 1) * inp.throttle;
        vf += a * dt * clamp(1 - vf / maxF, -0.5, 1);
      } else if (inp.throttle < 0) {
        if (vf > 0.6) {
          vf = Math.max(0, vf - T.brake * dt);
          this.braking = true;
        } else vf = Math.max(-T.reverseMax, vf - 7 * dt);
      } else {
        const roll = (2.2 + (1 - road) * 1.5) * dt;
        vf = Math.abs(vf) <= roll ? 0 : vf - Math.sign(vf) * roll;
      }
      if (this.handbrake) {
        const hb = 9 * dt;
        vf = Math.abs(vf) <= hb ? 0 : vf - Math.sign(vf) * hb;
        this.braking = true;
      }
      // over the speed limit (left the road / boost ended): ease down
      if (vf > maxF) vf = damp(vf, maxF, 1.2, dt);
      vf -= vf * (0.02 + (1 - road) * 0.05) * dt;
      // gravity along the slope
      vf -= Math.sin(this.pitch) * G * 0.55 * dt;
      // steering (bicycle model)
      const sp = Math.abs(vf);
      const maxSteer = T.steerLow + (T.steerHigh - T.steerLow) * clamp(sp / 45);
      this.steer = damp(this.steer, inp.steer * maxSteer, 9, dt);
      let yawRate = (vf * Math.tan(this.steer)) / CAR.wheelBase;
      if (this.handbrake && sp > 4) yawRate *= 1.55;
      this.heading = wrapAngle(this.heading + yawRate * dt);
      const grip = this.handbrake ? T.gripHand : T.gripOff + (T.gripRoad - T.gripOff) * road;
      vr *= Math.exp(-grip * dt);
      this.drift = clamp(Math.abs(vr) / 6);
    } else {
      this.steer = damp(this.steer, inp.steer * 0.3, 4, dt);
      this.heading = wrapAngle(this.heading + inp.steer * 0.25 * dt);
    }
    // recompose the velocity in the OLD frame: rotation of the car creates slip
    this.vel.set(fx * vf + rx * vr, fz * vf + rz * vr);
    this.forward = vf;

    // ---- move + collide
    this._prev.copy(this.pos);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    this.impact = 0;
    const ph = ctx.physics;
    const c = this._c;
    const nfx = -Math.sin(this.heading);
    const nfz = -Math.cos(this.heading);
    for (const off of [1.3, -1.3]) {
      c.x = this.pos.x + nfx * off;
      c.z = this.pos.z + nfz * off;
      c.y = this.pos.y + 0.15;
      const bx = c.x;
      const bz = c.z;
      if (ph.resolveCylinder(c, 1.02, 1.1, 0.45)) {
        const px = c.x - bx;
        const pz = c.z - bz;
        this.pos.x += px;
        this.pos.z += pz;
        const pl = Math.hypot(px, pz);
        if (pl > 1e-5) {
          const nx = px / pl;
          const nz = pz / pl;
          const into = this.vel.x * nx + this.vel.y * nz;
          if (into < 0) {
            this.vel.x -= nx * into * 1.25;
            this.vel.y -= nz * into * 1.25;
            this.impact = Math.max(this.impact, -into);
          }
        }
      }
    }
    // deep water blocks the car (wading is fine)
    const wl = world.waterLevel ?? 0;
    const nose = 2.0;
    const nx2 = this.pos.x + nfx * nose * Math.sign(vf || 1);
    const nz2 = this.pos.z + nfz * nose * Math.sign(vf || 1);
    const depth = wl - world.getHeightAt(nx2, nz2);
    this.inWater = clamp((wl - world.getHeightAt(this.pos.x, this.pos.z) + 0.2) / 0.8);
    if (depth > 0.75 && world.isWater?.(nx2, nz2)) {
      this.pos.x = this._prev.x;
      this.pos.z = this._prev.z;
      this.impact = Math.max(this.impact, Math.abs(vf) * 0.5);
      this.vel.set(0, 0);
    }
    // play bounds
    const B = WORLD.playBounds - 4;
    if (Math.abs(this.pos.x) > B || Math.abs(this.pos.z) > B) {
      this.pos.x = clamp(this.pos.x, -B, B);
      this.pos.z = clamp(this.pos.z, -B, B);
      this.vel.multiplyScalar(0.5);
    }

    // ---- ground (4 wheels)
    const hdg = this.heading;
    const s = Math.sin(hdg);
    const co = Math.cos(hdg);
    const H = this._h;
    let i = 0;
    for (const [lx, lz] of [[-CAR.wheelX, -CAR.wheelZ], [CAR.wheelX, -CAR.wheelZ], [-CAR.wheelX, CAR.wheelZ], [CAR.wheelX, CAR.wheelZ]]) {
      const wx = this.pos.x + lx * co + lz * s;
      const wz = this.pos.z - lx * s + lz * co;
      H[i++] = this._ground(wx, wz);
    }
    const gy = (H[0] + H[1] + H[2] + H[3]) / 4;
    const tp = Math.atan2((H[0] + H[1]) / 2 - (H[2] + H[3]) / 2, CAR.wheelBase);
    const tr = Math.atan2((H[1] + H[3]) / 2 - (H[0] + H[2]) / 2, CAR.wheelX * 2);
    let landed = 0;
    if (this.grounded) {
      const follow = (gy - this.pos.y) / Math.max(dt, 1e-3);
      if (follow < this.vy - G * dt * 2.2 && vf > 14) {
        this.grounded = false; // the ground drops away faster than gravity: airborne
      } else {
        this.vy = clamp(follow, -30, 30);
        this.pos.y = gy;
      }
    }
    if (!this.grounded) {
      this.vy -= G * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gy) {
        landed = -this.vy;
        this.pos.y = gy;
        this.vy = 0;
        this.grounded = true;
      }
    }
    // never let a bad height sample poison the transform (back to the last good position)
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.vel.y + this.vy)) {
      this.pos.copy(Number.isFinite(this._prev.x + this._prev.y + this._prev.z) ? this._prev : v?.object?.position || this._prev);
      this.vel.set(0, 0);
      this.vy = 0;
      this.grounded = true;
    }
    // attitude = the ground plane under the 4 wheels; airborne the nose follows the
    // trajectory and the roll relaxes to 0 (nothing is held or integrated, so the car
    // always ends up level on level ground after jumps and slopes)
    this.groundPitch = tp;
    this.groundRoll = tr;
    if (this.grounded) {
      this.pitch = damp(this.pitch, tp, 12, dt);
      this.roll = damp(this.roll, tr, 12, dt);
    } else {
      const fly = clamp(Math.atan2(this.vy, Math.max(6, Math.abs(vf))) * 0.6, -0.35, 0.35) * (vf < -0.5 ? -1 : 1);
      this.pitch = damp(this.pitch, fly, 3, dt);
      this.roll = damp(this.roll, 0, 2.5, dt);
    }
    if (!Number.isFinite(this.pitch)) this.pitch = 0;
    if (!Number.isFinite(this.roll)) this.roll = 0;

    // ---- visuals: suspension spring, squat, lean
    const accel = (vf - (this._lastVf ?? vf)) / Math.max(dt, 1e-3);
    this._lastVf = vf;
    this.bobV += (-this.bob * 160 - this.bobV * 14) * dt;
    if (landed > 2) this.bobV -= landed * 0.9;
    if (this.impact > 2) this.bobV -= this.impact * 0.2;
    this.bob = clamp(this.bob + this.bobV * dt, -0.16, 0.1);
    this.squat = damp(this.squat, clamp(accel * 0.006, -0.06, 0.05), 6, dt);
    this.lean = damp(this.lean, clamp(vr * 0.02 + this.steer * vf * 0.004, -0.07, 0.07), 6, dt);
    this.spin += (vf * dt) / CAR.wheelR;
    this.speed = Math.hypot(this.vel.x, this.vel.y);
    this.rpm = clamp(Math.abs(vf) / maxF) * 0.85 + (inp.throttle !== 0 ? 0.15 : 0);
    this.load = clamp(Math.abs(inp.throttle) * (wantBoost ? 1 : 0.7));
    this.landedImpact = landed;
    return this;
  }

  apply(v) {
    const o = v.object;
    o.position.copy(this.pos);
    o.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
    const ud = o.userData;
    ud.body.position.y = this.bob;
    ud.body.rotation.set(this.squat, 0, this.lean);
    ud.wheels.setPose(this.steer, this.spin);
    v.heading = this.heading;
    v.speed = this.speed;
    v.velocity.set(this.vel.x, this.vy, this.vel.y);
  }
}

// ------------------------------------------------------------ air
/**
 * Flight profiles. Attitude: bankMax / pitchMax (rad, clamp), bankYaw (rad of bank
 * per rad/s of yaw rate), bankStrafe (rad at full strafe input), pitchAccel (rad per
 * unit of commanded speed change), pitchClimb (rad at full climb rate), omega
 * (spring frequency: ~5.8 / omega s to level), carve (share of a heading change
 * that turns the velocity with the nose).
 */
export const AIR_PROFILES = {
  vtol: { max: 46, boost: 78, accel: 1.5, vUp: 14, vDown: 12, gear: 5, climbMax: 1400, radius: 4.2, height: 3, tilt: 0.55, gearH: 0, bankMax: 0.44, bankYaw: 0.34, bankStrafe: 0.3, pitchMax: 0.3, pitchAccel: 0.15, pitchClimb: 0.07, launchPitch: 0, omega: 6.5, carve: 0.7 },
  ship: { max: 115, boost: 195, accel: 0.85, vUp: 30, vDown: 24, gear: 7, climbMax: 1600, radius: 6.5, height: 4.4, tilt: 0, gearH: 0, bankMax: 0.5, bankYaw: 0.4, bankStrafe: 0.34, pitchMax: 0.42, pitchAccel: 0.12, pitchClimb: 0.24, launchPitch: 0.25, omega: 5.2, carve: 0.55 },
};
/** Mouse yaw is queued once per frame and applied with this rate (1/s): smooth, loss-free. */
const YAW_RESPONSE = 16;
const KEY_YAW_RATE = 1.2;

export class AirController {
  constructor(ctx, profile) {
    this.ctx = ctx;
    this.P = profile;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.landed = true;
    this.thrust = 0;
    this.rotor = 0;
    this.boost = 1;
    this.boosting = false;
    this.gear = 1;
    this.bank = 0;
    this.pitchV = 0;
    this.tilt = 0;
    this.speed = 0;
    this.forward = 0;
    this.altitude = 0;
    this.surfaceY = 0;
    this.overWater = false;
    this.impact = 0;
    this.autoLaunch = 0;
    this.yawRate = 0;
    this._c = { x: 0, y: 0, z: 0 };
    this._yawQ = 0;
    this._cmdSlow = 0;
    this._bankS = { x: 0, v: 0 };
    this._pitchS = { x: 0, v: 0 };
  }

  reset(v) {
    this.pos.copy(v.object.position);
    this.heading = v.heading;
    this.vel.set(0, 0, 0);
    this.landed = true;
    this.boost = 1;
    this.autoLaunch = 0;
    this.gear = 1;
    this.rotor = 0.15;
    this.bank = 0;
    this.pitchV = 0;
    this.yawRate = 0;
    this._yawQ = 0;
    this._cmdSlow = 0;
    this._bankS.x = this._bankS.v = 0;
    this._pitchS.x = this._pitchS.v = 0;
  }

  /** True while mouse X steers the heading (flying or launching). */
  get steering() {
    return !this.landed || this.autoLaunch > 0;
  }

  /** Mouse yaw for this frame (radians, + = left). Call ONCE per frame, before the substeps. */
  queueYaw(rad) {
    if (!this.steering || !Number.isFinite(rad)) {
      this._yawQ = 0;
      return;
    }
    this._yawQ = clamp(this._yawQ + rad, -2.5, 2.5);
  }

  /** Surface under x/z: terrain, walkable decks, or the water surface. */
  _surface(x, z) {
    const world = this.ctx.world;
    const th = world.getHeightAt(x, z);
    const y = this.ctx.physics.groundHeight(x, z, this.pos.y + 0.6, 0.8, 0);
    const wl = world.waterLevel ?? 0;
    const s = Math.max(Number.isFinite(y) ? y : th, th);
    this.overWater = s < wl;
    return Math.max(s, wl + (this.overWater ? 1.2 : 0));
  }

  step(dt, inp) {
    const P = this.P;
    this._dt = dt;
    dt = Math.max(dt, 1e-4);
    // ---- yaw (the only free rotation): queued mouse yaw eased in + Q/E keys
    let dh = 0;
    if (this.steering) {
      const take = this._yawQ * (1 - Math.exp(-YAW_RESPONSE * dt));
      this._yawQ -= take;
      dh = take + inp.yaw * KEY_YAW_RATE * dt;
    } else this._yawQ = 0;
    this.heading = wrapAngle(this.heading + dh);
    this.yawRate = damp(this.yawRate, dh / dt, 12, dt);
    // the velocity partly turns with the nose (carving instead of skidding sideways)
    if (dh !== 0 && !this.landed) {
      const a = dh * P.carve;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const vx = this.vel.x;
      this.vel.x = vx * c + this.vel.z * s;
      this.vel.z = -vx * s + this.vel.z * c;
    }
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const rx = Math.cos(this.heading);
    const rz = -Math.sin(this.heading);
    let fwdIn = inp.forward;
    let strafeIn = inp.strafe;
    let upIn = inp.up;
    const wantBoost = inp.boost && this.boost > 0.02 && !this.landed;
    if (this.autoLaunch > 0) {
      this.autoLaunch += dt;
      fwdIn = this.autoLaunch > 1.2 ? 1 : 0;
      upIn = 1;
      strafeIn = 0;
    }
    this.boosting = wantBoost || this.autoLaunch > 1.6;
    this.boost = clamp(this.boost + (wantBoost ? -dt / 5 : dt / 8));
    const surf = (this.surfaceY = this._surface(this.pos.x, this.pos.z));
    this.altitude = this.pos.y - surf;

    if (this.landed) {
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      this.rotor = damp(this.rotor, upIn > 0 ? 1 : 0.18, 2.2, dt);
      this.thrust = this.rotor * 0.4;
      if (upIn > 0 && this.rotor > 0.45) {
        this.landed = false;
        this.vel.y = 2;
      }
    } else {
      const maxH = this.boosting ? P.boost : P.max;
      const lead = this.autoLaunch > 0 ? 2.2 : 1;
      const tx = (fx * fwdIn + rx * strafeIn * 0.65) * maxH * lead;
      const tz = (fz * fwdIn + rz * strafeIn * 0.65) * maxH * lead;
      const rate = P.accel * (fwdIn === 0 && strafeIn === 0 ? 0.9 : 1) * (this.boosting ? 1.3 : 1);
      this.vel.x = damp(this.vel.x, tx, rate, dt);
      this.vel.z = damp(this.vel.z, tz, rate, dt);
      const vUp = this.autoLaunch > 0 ? P.vUp * 1.6 : P.vUp;
      this.vel.y = damp(this.vel.y, upIn > 0 ? vUp * upIn : upIn < 0 ? -P.vDown : 0, 2.6, dt);
      this.rotor = damp(this.rotor, 0.75 + 0.25 * Math.max(Math.abs(fwdIn), upIn > 0 ? 1 : 0), 3, dt);
      this.thrust = clamp(0.35 + 0.4 * Math.hypot(fwdIn, strafeIn) + 0.25 * Math.max(0, upIn) + (this.boosting ? 0.3 : 0));
    }

    // integrate
    this.pos.addScaledVector(this.vel, dt);
    this.impact = 0;
    // buildings / parked vehicles (only matters when low)
    const c = this._c;
    c.x = this.pos.x;
    c.y = this.pos.y + 0.2;
    c.z = this.pos.z;
    if (this.ctx.physics.resolveCylinder(c, P.radius, P.height, 0.6)) {
      const px = c.x - this.pos.x;
      const pz = c.z - this.pos.z;
      const pl = Math.hypot(px, pz);
      if (pl > 1e-5) {
        const into = (this.vel.x * px + this.vel.z * pz) / pl;
        if (into < 0) {
          this.vel.x -= (px / pl) * into * 1.3;
          this.vel.z -= (pz / pl) * into * 1.3;
          this.impact = -into;
        }
      }
      if (Number.isFinite(c.x) && Number.isFinite(c.z)) {
        this.pos.x = c.x;
        this.pos.z = c.z;
      }
    }
    const B = WORLD.playBounds - 6;
    if (Math.abs(this.pos.x) > B || Math.abs(this.pos.z) > B) {
      this.pos.x = clamp(this.pos.x, -B, B);
      this.pos.z = clamp(this.pos.z, -B, B);
      this.vel.x *= 0.3;
      this.vel.z *= 0.3;
    }
    if (this.pos.y > P.climbMax) {
      this.pos.y = P.climbMax;
      this.vel.y = Math.min(0, this.vel.y);
    }
    // ground contact / landing
    const s2 = this._surface(this.pos.x, this.pos.z);
    if (this.pos.y <= s2) {
      const down = -this.vel.y;
      this.pos.y = s2;
      if (this.vel.y < 0) this.vel.y = 0;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (!this.landed && !this.overWater && upIn <= 0 && hs < 9 && this.autoLaunch <= 0) {
        this.landed = true;
        this.impact = Math.max(this.impact, down * 0.6);
      } else if (down > 6) this.impact = Math.max(this.impact, down * 0.4);
    }
    this.altitude = this.pos.y - s2;
    // never let a bad sample poison the transform
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z) || !Number.isFinite(this.vel.x + this.vel.y + this.vel.z)) {
      this.pos.set(Number.isFinite(this.pos.x) ? this.pos.x : 0, Number.isFinite(this.pos.y) ? this.pos.y : s2, Number.isFinite(this.pos.z) ? this.pos.z : 0);
      this.vel.set(0, 0, 0);
    }

    // ---- attitude: springs toward targets from the current inputs + velocity
    const lf = this.vel.x * fx + this.vel.z * fz;
    this.forward = lf;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.tilt = damp(this.tilt, clamp(lf / P.max, -0.4, 1.2) * P.tilt, 3, dt);
    // commanded forward speed (× max) minus its slow follower = "acceleration demand":
    // nose down while speeding up, a short flare when braking, level when cruising
    const cmd = this.landed ? 0 : (fwdIn * (this.boosting ? P.boost : P.max)) / P.max;
    this._cmdSlow = damp(this._cmdSlow, cmd, 2.2, dt);
    let bankT = 0;
    let pitchT = 0;
    if (!this.landed) {
      bankT = clamp(this.yawRate * P.bankYaw - strafeIn * P.bankStrafe, -P.bankMax, P.bankMax);
      const climb = clamp(this.vel.y / P.vUp, -1, 1);
      pitchT = clamp(-(cmd - this._cmdSlow) * P.pitchAccel + climb * P.pitchClimb + (this.autoLaunch > 0 ? P.launchPitch : 0), -P.pitchMax, P.pitchMax);
    }
    this.bank = clamp(spring(this._bankS, bankT, P.omega, dt), -P.bankMax * 1.1, P.bankMax * 1.1);
    this.pitchV = clamp(spring(this._pitchS, pitchT, P.omega, dt), -P.pitchMax * 1.1, P.pitchMax * 1.1);
    this.gear = damp(this.gear, this.landed || this.altitude < P.gear ? 1 : 0, 3, dt);
    return this;
  }

  apply(v) {
    const o = v.object;
    o.position.copy(this.pos);
    const hover = this.landed ? 0 : Math.sin(performance.now() * 0.0021) * 0.06 * clamp(1 - this.speed / 20);
    o.position.y += hover;
    o.rotation.set(this.pitchV, this.heading, this.bank, 'YXZ');
    v.heading = this.heading;
    v.speed = this.speed;
    v.velocity.copy(this.vel);
    const ud = o.userData;
    ud.setRotor?.(this.rotor, this._dt || 0.016);
    ud.setTilt?.(this.tilt);
    ud.setGear?.(this.gear);
    ud.setThrust?.(this.thrust, this.boosting ? 1 : 0);
  }
}

export { dampAngle };
