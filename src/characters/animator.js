/**
 * Procedural animation (characters module). No clips: every frame a pose
 * (Euler angles per joint + hip offset + root roll) is synthesised from layers
 * and smoothly blended:
 *   idle (breathing, weight shift, glances) → locomotion cycle (walk ↔ run ↔
 *   sprint lean, phase driven by distance so feet don't slide, idle turn
 *   shuffle) → air (jump / fall) → swim (tread / breaststroke) → sit →
 *   upper-body actions (talk, wave, cheer, clap, tablet) → combat stance (aim
 *   torso + pitch, strafe / backpedal legs) → one-shots (recoil, hit flinch,
 *   reload, dodge roll, death collapse, respawn materialize) → additive landing
 *   impact, look-at, turn lean, blink and a spring-driven ponytail.
 * Controllers write the inputs (speed, grounded, vy, swimming, turnRate,
 * actions via set(), lookAt(); combat: aimOn, aimPitch, aimYaw, grip, strafe,
 * moveAngle, fire(), hit(), reload(), dodge(), die(), revive(), materialize())
 * and call update(dt). Arms holding a weapon are solved afterwards by the
 * WeaponRig (weapon-rig.js, two-bone IK). No per-frame allocation.
 */
import * as THREE from 'three';
import { J, BONE_COUNT } from './skeleton.js';
import { kf as kfTrack } from './tool-actions.js';
import { poseFor, POSE_WIDTH } from './action-poses.js';

const N = BONE_COUNT;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const noise = (x) => (Math.sin(x) + Math.sin(x * 2.13 + 1.3) * 0.6 + Math.sin(x * 3.71 + 2.1) * 0.3) / 1.9;
/** cyclic keyframes [[t, v], …] (t in [0,1)), cosine interpolated */
function kf(t, keys) {
  t -= Math.floor(t);
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i];
    const b = keys[(i + 1) % keys.length];
    const tb = i + 1 < keys.length ? b[0] : b[0] + 1;
    if (t >= a[0] && t < tb) {
      const f = (t - a[0]) / (tb - a[0]);
      return lerp(a[1], b[1], (1 - Math.cos(f * Math.PI)) / 2);
    }
  }
  return keys[0][1];
}

const ACTIONS = ['talk', 'wave', 'cheer', 'clap', 'tablet', 'sit'];
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _trk = new Float32Array(POSE_WIDTH);
const _ePose = new THREE.Euler(0, 0, 0, 'XYZ');
const _qPose = new THREE.Quaternion();
const ACT_PIVOT = new THREE.Vector3(0.12, 1.4, 0); // shoulder line: aim pitch tilts the item about it

// joint masks for upper-body overlays
const UPPER = new Float32Array(N);
[J.spine, J.chest, J.neck, J.head, J.clavL, J.armL, J.foreL, J.handL, J.clavR, J.armR, J.foreR, J.handR].forEach((j) => (UPPER[j] = 1));
const RIGHT_ARM = new Float32Array(N);
[J.clavR, J.armR, J.foreR, J.handR, J.head, J.chest].forEach((j) => (RIGHT_ARM[j] = 1));
RIGHT_ARM[J.chest] = 0.5;
const FULL = new Float32Array(N).fill(1);
FULL[J.lids] = 0;
FULL[J.pony1] = 0;
FULL[J.pony2] = 0;
const ARMS = new Float32Array(N);
[J.clavL, J.armL, J.foreL, J.handL, J.clavR, J.armR, J.foreR, J.handR].forEach((j) => (ARMS[j] = 1));
const TORSO = new Float32Array(N);
[J.spine, J.chest, J.neck, J.head, J.clavL, J.clavR].forEach((j) => (TORSO[j] = 1));
const wrapPi = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** 0 → 1 → 0 envelope over [0, 1] with attack a and release r fractions. */
const env = (x, a, r) => (x <= 0 || x >= 1 ? 0 : x < a ? sstep(0, a, x) : x > 1 - r ? 1 - sstep(1 - r, 1, x) : 1);
/** Did a cyclic phase pass `a` between p0 and p1 moving in direction `dir`? */
function crossedPh(p0, p1, a, dir) {
  if (dir > 0) return p1 >= p0 ? p0 < a && p1 >= a : p0 < a || p1 >= a;
  return p1 <= p0 ? p0 >= a && p1 < a : p0 >= a || p1 < a;
}
/**
 * Arm poses [joint, x, y, z, …] for the combat stances (aim: arm x gets + pitch);
 * fallbacks for the WeaponRig IK (distant characters) and its elbow hints.
 */
const AIM_ARMS = {
  rifle: [J.armR, 0.29, 0.87, 0.2, J.foreR, 2.0, 0, 0, J.handR, -1.97, -0.54, -0.34, J.armL, 0.99, -0.43, -0.03, J.foreL, 0.65, 0, 0, J.handL, 0, 0, 0],
  pistol: [J.armR, 0.82, 0.74, -0.03, J.foreR, 1.36, 0, 0, J.handR, -1.71, -0.63, -0.27, J.armL, 0.89, -0.67, 0.13, J.foreL, 1.14, 0, 0, J.handL, 0, 0, 0],
  carry: [J.clavL, 0, -0.1, 0, J.armR, -0.52, 0.47, 0.6, J.foreR, 1.97, 0, 0, J.handR, -1.38, 0.02, -0.28, J.armL, 0.54, -0.74, 0.09, J.foreL, 0.67, 0, 0, J.handL, 0, 0, 0],
};
/** Combat one-shot durations (s). */
export const COMBAT_TIMING = { recoil: 0.16, hit: 0.42, reload: 1.4, dodge: 0.62, die: 1.15, materialize: 0.85 };

export class Animator {
  constructor(chr, seed = 1) {
    this.chr = chr;
    this.pose = new Float32Array(N * 3);
    this.ov = new Float32Array(N * 3);
    this.hipOff = new THREE.Vector3();
    this._hipOv = new THREE.Vector3();
    this.roll = 0;
    // inputs
    this.speed = 0;
    this.grounded = true;
    this.vy = 0;
    this.swimming = false;
    this.turnRate = 0;
    this.sprint = false;
    this.seatHeight = 0.46;
    this.targets = {};
    this.w = {};
    for (const a of ACTIONS) this.targets[a] = this.w[a] = 0;
    this.lookTarget = new THREE.Vector3();
    this.lookOn = false;
    this.lookW = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.onStep = null;
    // internal state
    let s = (seed >>> 0) || 1;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    this.rnd = rnd;
    this.t = rnd() * 100;
    this.breathRate = 0.22 + rnd() * 0.06;
    this.shiftRate = 1 / (7 + rnd() * 5);
    this.shiftPh = rnd() * TAU;
    this.gest = [rnd() * 50, rnd() * 50, rnd() * 50];
    this.cheerPh = rnd() * TAU;
    this.phase = rnd();
    this.moveW = 0;
    this.runW = 0;
    this.sprintW = 0;
    this.airW = 0;
    this.swimW = 0;
    this.swimMove = 0;
    this.swimPh = 0;
    this.shuffleW = 0;
    this.landT = 10;
    this.landAmt = 0;
    this.blinkT = 1 + rnd() * 4;
    this.blinkPh = -1;
    this.pony = { x: 0, z: 0, vx: 0, vz: 0 };
    this.energy = 0.7 + rnd() * 0.6; // gesture energy (NPC variety)
    // ---- combat inputs (see header)
    this.aimOn = false;
    this.aimPitch = 0; // + = up (rad, character space)
    this.aimYaw = 0; // + = left of the facing (rad)
    this.grip = 'none'; // 'none' | 'pistol' | 'rifle' | 'heavy' (held weapon)
    this.strafe = false; // keep facing, legs follow moveAngle (combat stance)
    this.moveAngle = 0; // movement direction relative to the facing (heading convention)
    // ---- combat state
    this.aimW = 0;
    this.carryW = 0;
    this.recoil = 0;
    this.legYaw = 0;
    this.back = false; // backpedalling (cycle runs in reverse)
    this.recoilT = 9;
    this.recoilAmt = 1;
    this.hitT = 9;
    this.hitSide = 1;
    this.hitAmt = 1;
    this.reloadT = 9;
    this.reloadDur = COMBAT_TIMING.reload;
    this.dodgeT = 9;
    this.dodgeDur = COMBAT_TIMING.dodge;
    this.dead = false;
    this.deadT = 0;
    this.deadW = 0;
    this.deadDir = 1; // 1 = falls on the back, −1 = face down
    this.spawnT = 9;
    this.spawnDur = COMBAT_TIMING.materialize;
    this.spawnScale = 1; // root Y scale of the materialize effect (read by FX)
    // ---- work / survival actions (chop, mine, gather, eat, use, build; see action-poses.js)
    this.tool = null; // tool family in the hands ('axe' | 'pick' | 'laser' | null), set by the tool rig
    this.actName = null; // running action (null = none)
    this.actT = 0;
    this.actDur = 1;
    this.actPose = null; // keyframe track of the running / last action
    this.actW = 0; // action layer weight (smoothed; rigs read it)
    this.actHold = 0; // s the layer stays up after an action (chained swings flow on)
    this.actPitch = 0; // aim pitch applied to the item frame (+ = up)
    this.toolTwoW = 0; // left hand on the handle (0..1), read by the tool rig
    this.itemPos = new THREE.Vector3(0.2, 1, -0.2); // item frame (character space), read by the rigs
    this.itemQuat = new THREE.Quaternion();
  }

  // -------------------------------------------------------- work actions
  /** Starts a work action (chop | mine | gather | eat | use | build) lasting `dur` seconds. */
  action(name, dur = 1) {
    const pose = poseFor(name, this.tool);
    if (!pose) return false;
    this.actName = name;
    this.actPose = pose;
    this.actT = 0;
    this.actDur = clamp(dur, 0.15, 5);
    this.actHold = 0.28;
    return true;
  }

  /** Stops the running action (blends back out). */
  stopAction() {
    this.actName = null;
    this.actHold = 0;
  }

  get acting() {
    return this.actName !== null;
  }

  /** Progress of the running action 0..1 (1 = none). */
  get actX() {
    return this.actName ? clamp(this.actT / this.actDur, 0, 1) : 1;
  }

  // ------------------------------------------------------------ combat API
  /** Weapon recoil kick (amount 0.3 … 1.5). */
  fire(amount = 1) {
    this.recoilT = 0;
    this.recoilAmt = amount;
  }

  /** Hit flinch; side −1 = from the left, 1 = from the right, 0 = front. */
  hit(side = 0, amount = 1) {
    this.hitT = 0;
    this.hitSide = side || (this.rnd() < 0.5 ? -1 : 1) * 0.4;
    this.hitAmt = clamp(amount, 0.3, 1.5);
  }

  /** Reload motion (both arms + weapon tilt) over `duration` seconds. */
  reload(duration = COMBAT_TIMING.reload) {
    this.reloadT = 0;
    this.reloadDur = clamp(duration, 0.4, 4);
  }

  get reloading() {
    return this.reloadT < this.reloadDur;
  }

  /** Forward roll (the controller turns the character into the roll direction). */
  dodge(duration = COMBAT_TIMING.dodge) {
    this.dodgeT = 0;
    this.dodgeDur = clamp(duration, 0.35, 1.2);
  }

  get dodging() {
    return this.dodgeT < this.dodgeDur;
  }

  /** Collapse and stay down until revive(). `instant` jumps to the lying pose. */
  die({ instant = false, dir = 0 } = {}) {
    if (this.dead && !instant) return;
    this.dead = true;
    this.deadT = instant ? COMBAT_TIMING.die + 1 : 0;
    this.deadDir = dir || (this.rnd() < 0.6 ? 1 : -1);
    if (instant) this.deadW = 1;
    this.dodgeT = 9;
    this.reloadT = 9;
    this.actName = null;
    this.actHold = 0;
  }

  /** Back on the feet (pose snaps to standing; pair with materialize()). */
  revive() {
    this.dead = false;
    this.deadW = 0;
    this.deadT = 0;
    this.hitT = 9;
    this.landT = 10;
  }

  /** Respawn effect: the body is "printed" upward from the feet. */
  materialize(duration = COMBAT_TIMING.materialize) {
    this.spawnT = 0;
    this.spawnDur = clamp(duration, 0.2, 3);
  }

  get materializing() {
    return this.spawnT < this.spawnDur;
  }

  /** Target weight for an action ('talk' | 'wave' | 'cheer' | 'clap' | 'tablet' | 'sit'). */
  set(action, value = 1) {
    this.targets[action] = +value;
  }

  /** Look at a world point (or stop with null). */
  lookAt(target) {
    if (target) {
      this.lookTarget.copy(target);
      this.lookOn = true;
    } else this.lookOn = false;
  }

  land(speed) {
    this.landT = 0;
    this.landAmt = clamp(speed / 11, 0.12, 1);
  }

  /** Snap blend weights to their targets (e.g. right after spawning). */
  settle() {
    for (const a of ACTIONS) this.w[a] = this.targets[a];
    this.moveW = sstep(0.05, 0.7, this.speed);
    this.airW = this.grounded ? 0 : 1;
    this.swimW = this.swimming ? 1 : 0;
  }

  update(dt) {
    if (dt <= 0) {
      this.apply();
      return;
    }
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t;
    const P = this.pose;
    const O = this.ov;
    const hip = this.hipOff;
    const hov = this._hipOv;
    const k = 1 - Math.exp(-7 * dt);
    for (const a of ACTIONS) this.w[a] += (this.targets[a] - this.w[a]) * (a === 'sit' ? 1 - Math.exp(-4 * dt) : k);
    const speed = this.speed;
    this.moveW += (sstep(0.06, 0.7, speed) - this.moveW) * (1 - Math.exp(-9 * dt));
    this.runW += (sstep(2.0, 4.2, speed) - this.runW) * (1 - Math.exp(-5 * dt));
    this.sprintW += (sstep(5.0, 7.6, speed) - this.sprintW) * (1 - Math.exp(-4 * dt));
    this.airW += ((this.grounded || this.swimming ? 0 : 1) - this.airW) * (1 - Math.exp(-(this.grounded ? 14 : 9) * dt));
    this.swimW += ((this.swimming ? 1 : 0) - this.swimW) * (1 - Math.exp(-4 * dt));
    const turn = Math.abs(this.turnRate);
    this.shuffleW += (sstep(0.9, 2.6, turn) * (1 - this.moveW) * (this.grounded ? 1 : 0) - this.shuffleW) * (1 - Math.exp(-8 * dt));

    // combat stance: legs turn toward the movement (strafe), backpedal runs the cycle in reverse
    let legYawT = 0;
    if (this.strafe && speed > 0.3 && !this.swimming) {
      const a = wrapPi(this.moveAngle);
      const aa = Math.abs(a);
      if (this.back ? aa < 1.62 : aa > 1.95) this.back = !this.back;
      legYawT = clamp(this.back ? wrapPi(a - Math.PI) : a, -1.15, 1.15) * 0.8;
    } else if (!this.strafe || speed < 0.15) this.back = false;
    this.legYaw += (legYawT - this.legYaw) * (1 - Math.exp(-8 * dt));
    const dir = this.back ? -1 : 1;

    // phase: distance-driven stride (+ shuffle when turning on the spot)
    const cycleLen = 0.85 + 0.52 * speed;
    const prevPh = this.phase;
    this.phase += dir * (speed / cycleLen) * dt + this.shuffleW * turn * 0.16 * dt;
    this.phase -= Math.floor(this.phase);
    if (this.grounded && !this.swimming && !this.dead && (this.moveW > 0.3 || this.shuffleW > 0.3) && this.onStep) {
      if (crossedPh(prevPh, this.phase, 0.25, dir)) this.onStep(-1);
      if (crossedPh(prevPh, this.phase, 0.75, dir)) this.onStep(1);
    }

    // ------------------------------------------------------------- idle
    P.fill(0);
    hip.set(0, 0, 0);
    const br = Math.sin(TAU * this.breathRate * t);
    let sw = Math.sin(TAU * this.shiftRate * t + this.shiftPh) * 1.7;
    sw = clamp(sw, -1, 1);
    sw = sw * sw * sw * 0.4 + sw * 0.6;
    this.idlePose(P, hip, br, sw, t);

    // -------------------------------------------------------- locomotion
    const mw = Math.max(this.moveW, this.shuffleW * 0.6);
    if (mw > 0.001) {
      O.fill(0);
      hov.set(0, 0, 0);
      const amp = this.moveW > this.shuffleW ? 1 : 0.35;
      this.locoPose(O, hov, this.phase, this.runW, this.sprintW, amp, t);
      this.blend(P, O, mw, FULL);
      hip.lerp(hov, mw);
    }
    // strafe twist: hips toward the movement, torso counter-rotated (keeps facing the aim)
    if (Math.abs(this.legYaw) > 1e-4) {
      const ly = this.legYaw * this.moveW;
      P[J.hips * 3 + 1] += ly;
      P[J.spine * 3 + 1] -= ly * 0.55;
      P[J.chest * 3 + 1] -= ly * 0.45;
    }

    // -------------------------------------------------------------- air
    if (this.airW > 0.001) {
      O.fill(0);
      this.airPose(O, t);
      this.blend(P, O, this.airW, FULL);
      hip.multiplyScalar(1 - this.airW);
    }

    // ------------------------------------------------------------- swim
    if (this.swimW > 0.001) {
      this.swimMove += (sstep(0.25, 1.3, speed) - this.swimMove) * (1 - Math.exp(-3 * dt));
      this.swimPh += dt * (this.swimMove > 0.3 ? 0.62 + speed * 0.12 : 0.55);
      O.fill(0);
      this.swimPose(O, this.swimPh, this.swimMove, t);
      this.blend(P, O, this.swimW, FULL);
      hip.multiplyScalar(1 - this.swimW);
    }

    // -------------------------------------------------------------- sit
    const ws = this.w.sit;
    if (ws > 0.001) {
      O.fill(0);
      hov.set(0, 0, 0);
      this.sitPose(O, hov, br, t);
      this.blend(P, O, ws, FULL);
      hip.lerp(hov, ws);
    }

    // ---------------------------------------------------- upper actions
    const wt = this.w.talk;
    if (wt > 0.001) {
      O.fill(0);
      this.copyLower(O, P);
      this.talkPose(O, t);
      this.blend(P, O, wt, UPPER);
    }
    const wtab = this.w.tablet;
    if (wtab > 0.001) {
      O.fill(0);
      this.copyLower(O, P);
      this.tabletPose(O, t);
      this.blend(P, O, wtab, UPPER);
    }
    const wc = this.w.cheer;
    if (wc > 0.001) {
      O.fill(0);
      hov.set(0, 0, 0);
      this.copyLower(O, P);
      this.cheerPose(O, hov, t);
      this.blend(P, O, wc, FULL);
      hip.y += hov.y * wc;
    }
    const wcl = this.w.clap;
    if (wcl > 0.001) {
      O.fill(0);
      this.copyLower(O, P);
      this.clapPose(O, t);
      this.blend(P, O, wcl, UPPER);
    }
    const ww = this.w.wave;
    if (ww > 0.001) {
      O.fill(0);
      this.copyLower(O, P);
      for (let i = 0; i < N * 3; i++) O[i] = P[i];
      this.wavePose(O, t);
      this.blend(P, O, ww, RIGHT_ARM);
    }

    // ------------------------------------------------------ combat stance
    const two = this.grip === 'rifle' || this.grip === 'heavy';
    this.carryW += ((two && !this.dead ? 1 : 0) - this.carryW) * (1 - Math.exp(-8 * dt));
    this.aimW += ((this.aimOn && !this.dead ? 1 : 0) - this.aimW) * (1 - Math.exp(-11 * dt));
    if (this.carryW > 0.001 && this.aimW < 0.999) {
      for (let i = 0; i < N * 3; i++) O[i] = P[i];
      this.carryPose(O, t);
      this.blend(P, O, this.carryW * (1 - this.aimW), ARMS);
    }
    if (this.aimW > 0.001) {
      for (let i = 0; i < N * 3; i++) O[i] = P[i];
      this.aimPose(O, t);
      this.blend(P, O, this.aimW * (1 - this.swimW * 0.5), UPPER);
    }
    // work actions: torso + crouch here, the arms are solved onto the item frame by the rigs
    this.updateAction(P, hip, dt);
    // reload: look down at the weapon (arms: WeaponRig IK path)
    if (this.reloadT < this.reloadDur) {
      this.reloadT += dt;
      const e = env(this.reloadT / this.reloadDur, 0.14, 0.22);
      P[J.chest * 3] -= 0.05 * e;
      P[J.neck * 3] -= 0.12 * e;
      P[J.head * 3] -= 0.24 * e;
      P[J.head * 3 + 1] += 0.1 * e;
    }
    // recoil kick (weapon kick: WeaponRig reads this.recoil)
    this.recoil = 0;
    if (this.recoilT < COMBAT_TIMING.recoil) {
      this.recoilT += dt;
      const rt = this.recoilT;
      this.recoil = (rt < 0.025 ? rt / 0.025 : Math.exp(-(rt - 0.025) * 26)) * this.recoilAmt;
      const r = this.recoil;
      P[J.spine * 3] += 0.018 * r;
      P[J.chest * 3] += 0.045 * r;
      P[J.head * 3] += 0.03 * r;
      P[J.clavR * 3 + 1] += 0.06 * r;
    }
    // hit flinch
    if (this.hitT < COMBAT_TIMING.hit) {
      this.hitT += dt;
      const x = this.hitT / COMBAT_TIMING.hit;
      const e = (x < 0.1 ? x / 0.1 : Math.exp(-(x - 0.1) * 7)) * this.hitAmt;
      const sd = this.hitSide;
      P[J.spine * 3] += 0.14 * e;
      P[J.chest * 3] += 0.12 * e;
      P[J.neck * 3] += 0.08 * e;
      P[J.head * 3] += 0.24 * e;
      P[J.spine * 3 + 1] -= 0.2 * e * sd;
      P[J.chest * 3 + 2] += 0.09 * e * sd;
      P[J.head * 3 + 2] += 0.14 * e * sd;
      P[J.armL * 3 + 2] -= 0.22 * e;
      P[J.armR * 3 + 2] += 0.22 * e;
      P[J.thighL * 3] += 0.12 * e;
      P[J.thighR * 3] += 0.12 * e;
      P[J.shinL * 3] -= 0.22 * e;
      P[J.shinR * 3] -= 0.22 * e;
      hip.y -= 0.035 * e;
    }
    // dodge: forward roll (tuck blended, the roll itself added so it ends at a full turn)
    if (this.dodgeT < this.dodgeDur) {
      this.dodgeT += dt;
      const x = clamp(this.dodgeT / this.dodgeDur, 0, 1);
      const w = env(x, 0.14, 0.24);
      O.fill(0);
      hov.set(0, 0, 0);
      this.dodgePose(O, hov, x);
      this.blend(P, O, w, FULL);
      hip.lerp(hov, w);
      P[J.hips * 3] -= TAU * sstep(0.12, 0.8, x);
    }
    // death collapse (held until revive())
    if (this.dead) {
      this.deadT += dt;
      this.deadW = clamp(this.deadT / 0.12, 0, 1);
      O.fill(0);
      hov.set(0, 0, 0);
      this.deadPose(O, hov, this.deadT, t);
      this.blend(P, O, this.deadW, FULL);
      hip.lerp(hov, this.deadW);
    }
    if (this.spawnT < this.spawnDur) this.spawnT += dt;

    // ------------------------------------------------------- additives
    // landing impact
    this.landT += dt;
    if (this.landT < 0.6 && this.landAmt > 0 && !this.dead) {
      const lt = this.landT;
      const env = (lt < 0.07 ? lt / 0.07 : Math.exp(-(lt - 0.07) * 7)) * this.landAmt * (1 - this.swimW);
      hip.y -= 0.14 * env;
      this.add(P, J.thighL, 0.42 * env, 0, 0);
      this.add(P, J.thighR, 0.42 * env, 0, 0);
      this.add(P, J.shinL, -0.86 * env, 0, 0);
      this.add(P, J.shinR, -0.86 * env, 0, 0);
      this.add(P, J.footL, 0.44 * env, 0, 0);
      this.add(P, J.footR, 0.44 * env, 0, 0);
      this.add(P, J.spine, -0.16 * env, 0, 0);
      this.add(P, J.armL, 0, 0, -0.22 * env);
      this.add(P, J.armR, 0, 0, 0.22 * env);
    }
    // look-at
    if (!this.dead) this.updateLook(P, dt);
    // lean into turns (root roll) — not while swimming, sitting, rolling or dead
    const targetRoll = this.dead || this.dodgeT < this.dodgeDur ? 0 : clamp(this.turnRate * speed * 0.032, -0.2, 0.2) * (1 - this.swimW) * (1 - ws);
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-6 * dt));
    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blinkPh < 0) {
      this.blinkPh = 0;
      this.blinkT = 2 + this.rnd() * 4.5;
      if (this.rnd() < 0.15) this.blinkT = 0.25;
    }
    if (this.blinkPh >= 0) {
      this.blinkPh += dt / 0.16;
      const b = Math.sin(Math.min(1, this.blinkPh) * Math.PI);
      P[J.lids * 3] = -0.95 * b;
      if (this.blinkPh >= 1) this.blinkPh = -1;
    }
    if (this.dead) P[J.lids * 3] = -0.95 * this.deadW;
    // ponytail spring
    this.updatePony(P, dt);
    this.apply();
  }

  /**
   * Work action layer: samples the action's keyframes → item frame (itemPos / itemQuat, character
   * space, tilted by actPitch about the shoulder line), torso twist / lean, head counter-turn, crouch.
   */
  updateAction(P, hip, dt) {
    if (this.actName) {
      this.actT += dt;
      if (this.actT >= this.actDur) {
        this.actName = null;
        this.actHold = 0.28; // the ready pose holds briefly: a chained swing flows on without a dip
      }
    } else if (this.actHold > 0) this.actHold -= dt;
    const want = !this.dead && this.swimW < 0.5 && (this.actName || this.actHold > 0) ? 1 : 0;
    this.actW += (want - this.actW) * (1 - Math.exp(-(want ? 16 : 7) * dt));
    if (this.actW < 0.002 || !this.actPose) {
      this.actW = 0;
      this.toolTwoW = 0;
      return;
    }
    const v = kfTrack(this.actPose.keys, this.actName ? this.actT / this.actDur : 1, _trk);
    const w = this.actW;
    // item frame (+ aim pitch: chop high / low, the laser follows the aim fully)
    _ePose.set(v[3], v[4], v[5]);
    this.itemQuat.setFromEuler(_ePose);
    this.itemPos.set(v[0], v[1], v[2]);
    const pitch = clamp(this.actPitch, -1, 0.8) * (this.actPose.laser ? 1 : 0.3);
    if (Math.abs(pitch) > 1e-4) {
      _qPose.setFromAxisAngle(_v.set(1, 0, 0), pitch);
      this.itemPos.sub(ACT_PIVOT).applyQuaternion(_qPose).add(ACT_PIVOT);
      this.itemQuat.premultiply(_qPose);
    }
    // body: twist / lean into the swing, the head keeps looking at the target
    P[J.spine * 3] += v[6] * w;
    P[J.spine * 3 + 1] += v[7] * w;
    P[J.chest * 3] += v[8] * w;
    P[J.chest * 3 + 1] += v[9] * w;
    P[J.head * 3] += v[10] * w;
    P[J.head * 3 + 1] += v[11] * w;
    this.toolTwoW = this.tool ? v[12] * w : 0;
    // crouch: hips drop, knees bend, feet stay flat
    const cr = v[13] * w;
    if (cr > 1e-4) {
      hip.y -= cr;
      const k = cr / this.chr.frame.s;
      P[J.thighL * 3] += 2.6 * k;
      P[J.thighR * 3] += 2.6 * k;
      P[J.shinL * 3] -= 5.2 * k;
      P[J.shinR * 3] -= 5.2 * k;
      P[J.footL * 3] += 2.6 * k;
      P[J.footR * 3] += 2.6 * k;
    }
  }

  // ---------------------------------------------------------------- layers
  idlePose(P, hip, br, sw, t) {
    const set = (j, x, y, z) => {
      P[j * 3] = x;
      P[j * 3 + 1] = y;
      P[j * 3 + 2] = z;
    };
    hip.x = 0.02 * sw;
    hip.y = -0.006 * Math.abs(sw);
    set(J.hips, 0, 0.03 * sw, 0.035 * sw);
    const fl = Math.max(0, sw);
    const fr = Math.max(0, -sw);
    set(J.thighL, 0.07 * fl, 0, -0.035 * sw + 0.012);
    set(J.shinL, -0.17 * fl, 0, 0);
    set(J.footL, 0.1 * fl, 0.08 * fl, 0);
    set(J.thighR, 0.07 * fr, 0, -0.035 * sw - 0.012);
    set(J.shinR, -0.17 * fr, 0, 0);
    set(J.footR, 0.1 * fr, -0.08 * fr, 0);
    set(J.spine, 0.012 + 0.006 * br, -0.015 * sw, -0.028 * sw);
    set(J.chest, 0.014 * br - 0.01, 0, -0.014 * sw);
    set(J.neck, 0.01, 0, 0.015 * sw);
    const g = this.gest;
    set(J.head, 0.035 * noise(t * 0.11 + g[0]) - 0.02, 0.13 * noise(t * 0.09 + g[1]), 0.02 * sw);
    set(J.clavL, 0, 0, -0.014 * br);
    set(J.clavR, 0, 0, 0.014 * br);
    // slight abduction keeps the sleeves off the jacket (armL −Z / armR +Z = outward)
    set(J.armL, 0.05, 0.12, -0.045 - 0.012 * br);
    set(J.armR, 0.05, -0.12, 0.045 + 0.012 * br);
    set(J.foreL, 0.2, 0.12, 0);
    set(J.foreR, 0.2, -0.12, 0);
    set(J.handL, -0.05, 0, 0.12);
    set(J.handR, -0.05, 0, -0.12);
  }

  locoPose(O, hov, ph, r, sp, amp, t) {
    const s1 = Math.sin(TAU * ph);
    const c1 = Math.cos(TAU * ph);
    const s2 = Math.sin(TAU * (ph + 0.5));
    const c2 = Math.cos(TAU * (ph + 0.5));
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    // thigh swing: walk ±0.40, jog ±0.50, sprint ±0.72 rad; knee flexion in swing grows with speed
    const At = (lerp(0.4, 0.5, r) + 0.22 * sp) * amp;
    const Ks = (lerp(1.0, 1.5, r) + 0.42 * sp) * amp;
    const Kst = (lerp(0.12, 0.34, r) + 0.12 * sp) * amp;
    const leg = (thigh, shin, foot, s, c, phase) => {
      const th = At * s + 0.08 * r;
      const kn = -(0.05 + Ks * Math.pow(Math.max(0, c), 1.4) + Kst * Math.pow(Math.max(0, -c), 2));
      const flat = -(th + kn);
      const pp = phase - Math.floor(phase);
      const toeOff = Math.exp(-(((pp - 0.72) / 0.08) ** 2)) * (0.45 + 0.2 * r);
      const heel = Math.max(0, s) * 0.18 * (1 - r * 0.5);
      set(thigh, th, 0, 0);
      set(shin, kn, 0, 0);
      set(foot, flat * 0.82 + heel - toeOff * amp, 0, 0);
    };
    leg(J.thighL, J.shinL, J.footL, s1, c1, ph);
    leg(J.thighR, J.shinR, J.footR, s2, c2, ph + 0.5);
    const bobW = 0.021 * Math.cos(2 * TAU * ph);
    const bobR = -0.034 * Math.cos(2 * TAU * (ph - 0.45));
    hov.y = (lerp(bobW, bobR, r) - 0.035 * r - 0.025 * sp) * amp;
    hov.x = 0.018 * c1 * (1 - 0.7 * r) * amp;
    const hipYaw = -lerp(0.12, 0.2, r) * s1 * amp;
    const hipRoll = 0.045 * c1 * (1 - 0.5 * r) * amp;
    set(J.hips, 0, hipYaw, hipRoll);
    O[J.thighL * 3 + 2] -= hipRoll;
    O[J.thighR * 3 + 2] -= hipRoll;
    const lean = -(0.035 + 0.1 * r + 0.17 * sp);
    set(J.spine, lean, 0.05 * s1 * amp, -hipRoll * 0.6);
    set(J.chest, -0.02 * r, lerp(0.1, 0.15, r) * s1 * amp, -hipRoll * 0.3);
    set(J.neck, 0.04 * r + 0.08 * sp, 0, 0);
    set(J.head, -lean * 0.55 + 0.02 * r, -(hipYaw + 0.05 * s1 + lerp(0.1, 0.15, r) * s1) * 0.8 * amp, 0);
    const Aa = (lerp(0.28, 0.44, r) + 0.26 * sp) * amp;
    set(J.armL, -Aa * s1 + 0.04 * r, 0.04, -(0.035 + 0.05 * r));
    set(J.armR, Aa * s1 + 0.04 * r, -0.04, 0.035 + 0.05 * r);
    // elbows: relaxed when walking, ~80–95° when running; forearms swing a little across the body
    const el = lerp(0.24, 1.3, r) + 0.18 * sp;
    set(J.foreL, el + 0.25 * Math.max(0, -s1) * amp, lerp(0.22, 0.42, r), 0);
    set(J.foreR, el + 0.25 * Math.max(0, s1) * amp, -lerp(0.22, 0.42, r), 0);
    set(J.handL, 0.1 + 0.15 * r, 0, 0.05);
    set(J.handR, 0.1 + 0.15 * r, 0, -0.05);
    set(J.clavL, 0, 0, -0.03 * r);
    set(J.clavR, 0, 0, 0.03 * r);
    void t;
  }

  airPose(O, t) {
    const k = sstep(1.5, -5, this.vy);
    const set = (j, a, b) => {
      O[j * 3] = lerp(a[0], b[0], k);
      O[j * 3 + 1] = lerp(a[1], b[1], k);
      O[j * 3 + 2] = lerp(a[2], b[2], k);
    };
    const fl = Math.sin(t * 5) * 0.12 * k;
    set(J.thighL, [0.62, 0, -0.03], [0.28, 0, -0.08]);
    set(J.shinL, [-1.1, 0, 0], [-0.35, 0, 0]);
    set(J.footL, [0.42, 0, 0], [0.12, 0, 0]);
    set(J.thighR, [0.16, 0, 0.03], [-0.12, 0, 0.08]);
    set(J.shinR, [-0.5, 0, 0], [-0.4, 0, 0]);
    set(J.footR, [0.2, 0, 0], [0.2, 0, 0]);
    set(J.spine, [-0.1, 0, 0], [-0.05, 0, 0]);
    set(J.chest, [-0.02, 0, 0], [0.02, 0, 0]);
    set(J.head, [0.06, 0, 0], [-0.14, 0, 0]);
    set(J.armL, [0.6, 0.1, -0.22], [0.32 + fl, 0, -0.95 + fl]);
    set(J.armR, [-0.22, -0.1, 0.3], [0.32 - fl, 0, 0.95 - fl]);
    set(J.foreL, [0.75, 0.2, 0], [0.5, 0, 0]);
    set(J.foreR, [0.5, -0.2, 0], [0.5, 0, 0]);
  }

  swimPose(O, ph, mv, t) {
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    // treading water (mv = 0) vs breaststroke (mv = 1)
    const tr = Math.sin(t * 2.6);
    const tc = Math.cos(t * 2.6);
    const armX = kf(ph, [[0, 2.85], [0.4, 1.35], [0.55, 0.95], [0.75, 2.85]]);
    const armZ = kf(ph, [[0, -0.15], [0.35, -1.15], [0.55, -0.25], [0.75, -0.12]]);
    const fore = kf(ph, [[0, 0.05], [0.35, 0.9], [0.55, 2.1], [0.75, 0.1]]);
    const thigh = kf(ph, [[0, 0.0], [0.4, 0.05], [0.58, 0.95], [0.72, 0.15], [0.85, 0.0]]);
    const thighZ = kf(ph, [[0, 0.0], [0.4, 0.0], [0.58, 0.32], [0.72, 0.38], [0.85, 0.02]]);
    const shin = kf(ph, [[0, 0.0], [0.4, -0.1], [0.58, -1.75], [0.72, -0.4], [0.85, 0.0]]);
    set(J.hips, lerp(-0.22, -1.32, mv), 0, 0);
    set(J.spine, lerp(0.05, 0.08, mv), 0, 0);
    set(J.chest, lerp(0.02, 0.1, mv), 0, 0);
    set(J.neck, lerp(0.05, 0.45, mv), 0, 0);
    set(J.head, lerp(0.05, 0.5, mv), 0, 0);
    set(J.armL, lerp(0.55, armX, mv), 0, lerp(-0.7 + 0.22 * tr, armZ, mv));
    set(J.armR, lerp(0.55, armX, mv), 0, -lerp(-0.7 + 0.22 * tr, armZ, mv));
    set(J.foreL, lerp(0.75, fore, mv), lerp(0.35 * tc, 0.3, mv), 0);
    set(J.foreR, lerp(0.75, fore, mv), -lerp(0.35 * tc, 0.3, mv), 0);
    set(J.thighL, lerp(0.5 + 0.38 * tr, thigh, mv), 0, lerp(-0.06, -thighZ, mv));
    set(J.thighR, lerp(0.5 - 0.38 * tr, thigh, mv), 0, lerp(0.06, thighZ, mv));
    set(J.shinL, lerp(-1.0 - 0.4 * tc, shin, mv), 0, 0);
    set(J.shinR, lerp(-1.0 + 0.4 * tc, shin, mv), 0, 0);
    set(J.footL, lerp(0.4, -0.6, mv), 0, 0);
    set(J.footR, lerp(0.4, -0.6, mv), 0, 0);
  }

  sitPose(O, hov, br, t) {
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    const fr = this.chr.frame;
    hov.set(0, this.seatHeight - fr.hipY + 0.015, 0.06 * fr.s);
    set(J.thighL, 1.52, 0.05, 0.07);
    set(J.thighR, 1.52, -0.05, -0.07);
    set(J.shinL, -1.48, 0, 0);
    set(J.shinR, -1.48, 0, 0);
    set(J.footL, 0.02, 0, 0);
    set(J.footR, 0.02, 0, 0);
    set(J.spine, 0.07 + 0.006 * br, 0, 0);
    set(J.chest, 0.02 + 0.014 * br, 0, 0);
    set(J.neck, -0.02, 0, 0);
    const g = this.gest;
    set(J.head, -0.06 + 0.04 * noise(t * 0.12 + g[2]), 0.25 * noise(t * 0.08 + g[0]), 0);
    set(J.armL, 0.48, 0.1, 0.12);
    set(J.armR, 0.48, -0.1, -0.12);
    set(J.foreL, 0.62, 0.35, 0);
    set(J.foreR, 0.62, -0.35, 0);
    set(J.handL, 0.25, 0, 0);
    set(J.handR, 0.25, 0, 0);
  }

  copyLower(O, P) {
    for (let i = 0; i < N * 3; i++) O[i] = P[i];
  }

  talkPose(O, t) {
    const g = this.gest;
    const e = this.energy;
    const g1 = noise(t * 0.85 + g[0]);
    const g2 = noise(t * 1.15 + g[1]);
    const g3 = noise(t * 0.62 + g[2]);
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    set(J.armR, 0.42 + 0.22 * g1 * e, -0.15, 0.1 + 0.1 * g2 * e);
    set(J.foreR, 1.2 + 0.35 * g2 * e, -0.75, 0);
    set(J.handR, -0.25 + 0.25 * g3, 0, 0.15 * g1);
    set(J.armL, 0.22 + 0.16 * g3 * e, 0.12, -0.08 - 0.06 * g1);
    set(J.foreL, 0.62 + 0.32 * g1 * e, 0.45, 0);
    set(J.handL, -0.1, 0, -0.1);
    O[J.spine * 3 + 1] += 0.06 * g1;
    O[J.chest * 3 + 1] += 0.05 * g2;
    O[J.chest * 3] += 0.02 * g3;
    O[J.head * 3] += 0.045 * Math.sin(t * 2.7 + g[1]) + 0.04 * g3;
    O[J.head * 3 + 1] += 0.1 * g2;
    O[J.head * 3 + 2] += 0.05 * g1;
  }

  tabletPose(O, t) {
    const tap = Math.pow(Math.max(0, Math.sin(t * 5.5 + this.gest[0])), 6) * (noise(t * 0.4 + this.gest[1]) > 0 ? 1 : 0);
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    set(J.armL, 0.4, 0.15, 0.24);
    set(J.foreL, 1.38, 0.95, 0);
    set(J.handL, -0.15, 0, 0.2);
    set(J.armR, 0.36, -0.2, -0.2);
    set(J.foreR, 1.5 + 0.12 * tap, -0.7, 0);
    set(J.handR, -0.25 - 0.2 * tap, 0, -0.1);
    O[J.spine * 3] += -0.03;
    O[J.chest * 3] = -0.05;
    O[J.neck * 3] = -0.16;
    O[J.head * 3] = -0.3 + 0.04 * Math.sin(t * 0.5 + this.gest[2]);
    O[J.head * 3 + 1] = 0.08 * noise(t * 0.3 + this.gest[0]);
  }

  cheerPose(O, hov, t) {
    const ph = this.cheerPh;
    const pump = 0.5 + 0.5 * Math.sin(t * 6.2 + ph);
    const bounce = Math.abs(Math.sin(t * 3.1 + ph));
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    const e = this.energy;
    set(J.armL, 0.35, 0.2, -2.45 - 0.3 * pump * e);
    set(J.armR, 0.35, -0.2, 2.45 + 0.3 * pump * e);
    set(J.foreL, 0.3 + 0.45 * (1 - pump), 0, 0);
    set(J.foreR, 0.3 + 0.45 * (1 - pump), 0, 0);
    set(J.handL, 0.3, 0, 0);
    set(J.handR, 0.3, 0, 0);
    set(J.clavL, 0, 0, -0.12);
    set(J.clavR, 0, 0, 0.12);
    O[J.spine * 3] = 0.06;
    O[J.chest * 3] = 0.04;
    O[J.head * 3] = 0.2 + 0.05 * pump;
    const kb = 1 - bounce;
    O[J.thighL * 3] += 0.14 * kb;
    O[J.thighR * 3] += 0.14 * kb;
    O[J.shinL * 3] += -0.3 * kb;
    O[J.shinR * 3] += -0.3 * kb;
    O[J.footL * 3] += 0.16 * kb;
    O[J.footR * 3] += 0.16 * kb;
    hov.y = -0.05 * kb * e;
  }

  clapPose(O, t) {
    const c = Math.max(0, Math.sin(t * 11 + this.cheerPh));
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    set(J.armL, 0.82, 0.1, 0.2 + 0.12 * c);
    set(J.armR, 0.82, -0.1, -0.2 - 0.12 * c);
    set(J.foreL, 1.15, 1.0, 0);
    set(J.foreR, 1.15, -1.0, 0);
    O[J.head * 3] = 0.14;
  }

  wavePose(O, t) {
    const w = Math.sin(t * 8.5);
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    set(J.clavR, 0, 0, 0.18);
    set(J.armR, 0.22, -0.2, 2.45);
    set(J.foreR, 0.45, 0, 0.42 * w);
    set(J.handR, 0, 0, 0.25 * Math.sin(t * 8.5 - 0.7));
    O[J.head * 3 + 2] = -0.07;
    O[J.chest * 3 + 2] = -0.04;
  }

  // ------------------------------------------------------------ combat poses
  /** Aim stance: torso pitched toward the aim (rifle: bladed stance), arms as the IK fallback. */
  aimPose(O, t) {
    const p = clamp(this.aimPitch, -1.25, 1.25);
    const yw = clamp(this.aimYaw, -0.7, 0.7);
    const g = this.grip;
    const two = g === 'rifle' || g === 'heavy';
    const blade = two ? -0.42 : -0.1;
    const sway = 0.012 * Math.sin(t * 1.3 + this.gest[0]);
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    // the remaining yaw goes into the torso only (spine + chest = 100 %): arms, weapon and head all
    // follow the chest, so the head never looks further than the gun points
    set(J.spine, -0.02 + p * 0.22, blade * 0.45 + yw * 0.45, 0);
    set(J.chest, p * 0.3 + sway, blade * 0.55 + yw * 0.55, 0);
    set(J.neck, p * 0.18, -blade * 0.45, 0);
    set(J.head, p * 0.2 - 0.04, -blade * 0.55, two ? -0.08 : 0);
    set(J.clavR, 0, 0, two ? 0.04 : 0);
    set(J.clavL, 0, two ? -0.15 : -0.06, 0);
    if (g === 'none') {
      // point along the aim with the right arm
      set(J.armR, 1.5 + p * 0.9, 0, 0.12);
      set(J.foreR, 0.12, 0, 0);
      set(J.handR, 0, 0, 0);
      set(J.armL, 0.15, 0.1, -0.08);
      set(J.foreL, 0.35, 0.2, 0);
    } else if (two) {
      const a = AIM_ARMS.rifle;
      for (let k = 0; k < a.length; k += 4) set(a[k], a[k + 1] + (a[k] === J.armR || a[k] === J.armL ? p * 0.3 : 0), a[k + 2], a[k + 3]);
    } else {
      const a = AIM_ARMS.pistol;
      for (let k = 0; k < a.length; k += 4) set(a[k], a[k + 1] + (a[k] === J.armR || a[k] === J.armL ? p * 0.7 : 0), a[k + 2], a[k + 3]);
    }
  }

  /** Two-handed low-ready carry (IK fallback when no WeaponRig solves the arms). */
  carryPose(O, t) {
    const a = AIM_ARMS.carry;
    for (let k = 0; k < a.length; k += 4) {
      O[a[k] * 3] = a[k + 1];
      O[a[k] * 3 + 1] = a[k + 2];
      O[a[k] * 3 + 2] = a[k + 3];
    }
    O[J.chest * 3 + 1] += 0.012 * Math.sin(t * 0.9 + this.gest[1]);
  }

  /** Forward roll tuck at progress x (0…1); the roll rotation is added by update(). */
  dodgePose(O, hov, x) {
    const tuck = sstep(0, 0.24, x) * (1 - sstep(0.7, 0.96, x));
    const fr = this.chr.frame;
    const set = (j, a, b, c) => {
      O[j * 3] = a;
      O[j * 3 + 1] = b;
      O[j * 3 + 2] = c;
    };
    const r = sstep(0.12, 0.8, x);
    // tucked hip height along the roll (fitted so the curled body stays on the ground)
    hov.set(0, -(fr.hipY - (0.4 + 0.26 * Math.sin(TAU * r)) * fr.s) * tuck, 0);
    set(J.thighL, 0.35 + 1.75 * tuck, 0, -0.08);
    set(J.thighR, 0.3 + 1.65 * tuck, 0, 0.08);
    set(J.shinL, -0.45 - 1.85 * tuck, 0, 0);
    set(J.shinR, -0.4 - 1.9 * tuck, 0, 0);
    set(J.footL, 0.3 * tuck, 0, 0);
    set(J.footR, 0.3 * tuck, 0, 0);
    set(J.spine, -0.12 - 0.55 * tuck, 0, 0);
    set(J.chest, -0.08 - 0.4 * tuck, 0, 0);
    set(J.neck, -0.3 * tuck, 0, 0);
    set(J.head, -0.12 - 0.35 * tuck, 0, 0);
    set(J.armL, 0.8 + 0.7 * tuck, 0.2, -0.3);
    set(J.armR, 0.8 + 0.7 * tuck, -0.2, 0.3);
    set(J.foreL, 1.1 + 0.7 * tuck, 0.3, 0);
    set(J.foreR, 1.1 + 0.7 * tuck, -0.3, 0);
  }

  /** Death collapse at time tt (s): knees buckle, topple (deadDir 1 = on the back), settle. */
  deadPose(O, hov, tt, t) {
    const fr = this.chr.frame;
    const d = this.deadDir;
    const b = sstep(0, 0.3, tt);
    const f = sstep(0.2, 0.86, tt);
    const st = tt > 0.84 && tt < 1.2 ? Math.sin(((tt - 0.84) / 0.36) * Math.PI) * 0.05 : 0;
    const lie = 0.13 * fr.s - (fr.hipY + 0.01 * fr.s);
    const set = (j, x, y, z) => {
      O[j * 3] = x;
      O[j * 3 + 1] = y;
      O[j * 3 + 2] = z;
    };
    hov.set(0, lerp(-0.17 * b * fr.s, lie, f * f), 0.1 * f * d);
    set(J.hips, d * (1.5 * f - st), 0.08 * f, 0.06 * f * d);
    const back = d > 0;
    set(J.thighL, lerp(0.7 * b, back ? 0.1 : -0.06, f), 0, -0.12 * f);
    set(J.thighR, lerp(0.55 * b, back ? 0.5 : 0.05, f), 0, 0.16 * f);
    set(J.shinL, lerp(-1.3 * b, back ? -0.18 : -0.15, f), 0, 0);
    set(J.shinR, lerp(-1.05 * b, back ? -0.95 : -0.75, f), 0, 0);
    set(J.footL, lerp(0.5 * b, 0.35, f), 0, 0);
    set(J.footR, lerp(0.45 * b, 0.3, f), 0, 0);
    set(J.spine, lerp(-0.28 * b, back ? 0.04 : 0.05, f), 0, 0);
    set(J.chest, lerp(-0.12 * b, back ? 0.04 : 0.02, f), 0, 0);
    set(J.neck, lerp(-0.25 * b, back ? -0.05 : 0.2, f), 0, 0);
    set(J.head, lerp(-0.3 * b, back ? -0.08 : 0.25, f), (back ? 0.75 : 1.15) * f, 0);
    if (back) {
      set(J.armL, lerp(0.25 * b, -0.25, f), 0.1, lerp(-0.3 * b, -1.05, f));
      set(J.armR, lerp(0.35 * b, -0.15, f), -0.1, lerp(0.25 * b, 1.3, f));
      set(J.foreL, lerp(0.4 * b, 0.55, f), 0.3, 0);
      set(J.foreR, lerp(0.3 * b, 0.35, f), -0.2, 0);
    } else {
      set(J.armL, lerp(0.25 * b, 2.6, f), 0.1, lerp(-0.3 * b, -0.45, f));
      set(J.armR, lerp(0.35 * b, -0.12, f), -0.1, lerp(0.25 * b, 1.15, f));
      set(J.foreL, lerp(0.4 * b, 0.7, f), 0.3, 0);
      set(J.foreR, lerp(0.3 * b, 0.25, f), -0.2, 0);
    }
    void t;
  }

  // ------------------------------------------------------------ helpers
  blend(P, O, w, mask) {
    for (let j = 0; j < N; j++) {
      const m = mask[j] * w;
      if (m <= 0) continue;
      const i = j * 3;
      P[i] += (O[i] - P[i]) * m;
      P[i + 1] += (O[i + 1] - P[i + 1]) * m;
      P[i + 2] += (O[i + 2] - P[i + 2]) * m;
    }
  }

  add(P, j, x, y, z) {
    P[j * 3] += x;
    P[j * 3 + 1] += y;
    P[j * 3 + 2] += z;
  }

  updateLook(P, dt) {
    const target = this.lookOn ? 1 : 0;
    this.lookW += (target - this.lookW) * (1 - Math.exp(-4 * dt));
    if (this.lookW < 0.002) return;
    let yaw = 0;
    let pitch = 0;
    if (this.lookOn) {
      // into character space (facing −Z); works for parented characters too
      const l = this.chr.object.worldToLocal(_v.copy(this.lookTarget));
      yaw = Math.atan2(-l.x, -l.z);
      const eye = this.chr.frame.headC.y + this.hipOff.y;
      pitch = Math.atan2(l.y - eye, Math.hypot(l.x, l.z));
      if (Math.abs(yaw) > 2.2) yaw = 0; // behind: don't break the neck
      yaw = clamp(yaw, -1.25, 1.25);
      pitch = clamp(pitch, -0.55, 0.4);
    }
    const r = 1 - Math.exp(-5 * dt);
    this.lookYaw += (yaw - this.lookYaw) * r;
    this.lookPitch += (pitch - this.lookPitch) * r;
    const w = this.lookW;
    const big = sstep(0.6, 1.2, Math.abs(this.lookYaw));
    P[J.chest * 3 + 1] += this.lookYaw * 0.2 * big * w;
    P[J.neck * 3 + 1] += this.lookYaw * (0.35 - 0.07 * big) * w;
    P[J.head * 3 + 1] += this.lookYaw * (0.6 - 0.13 * big) * w;
    P[J.neck * 3] += this.lookPitch * 0.35 * w;
    P[J.head * 3] += this.lookPitch * 0.6 * w;
  }

  updatePony(P, dt) {
    const p = this.pony;
    const sp = this.speed;
    const chain = P[J.hips * 3] + P[J.spine * 3] + P[J.chest * 3] + P[J.neck * 3] + P[J.head * 3];
    const tx = -0.3 * clamp(sp / 6, 0, 1) - 0.12 * Math.sin(TAU * 2 * this.phase) * this.moveW - chain;
    const tz = clamp(-this.turnRate * 0.12, -0.5, 0.5) + 0.06 * Math.sin(this.t * 1.3) * (1 - this.moveW);
    const kk = 55;
    const c = 6.5;
    const sdt = Math.min(dt, 1 / 30);
    p.vx += (kk * (tx - p.x) - c * p.vx) * sdt;
    p.vz += (kk * (tz - p.z) - c * p.vz) * sdt;
    p.x += p.vx * sdt;
    p.z += p.vz * sdt;
    P[J.pony1 * 3] = p.x * 0.55 + 0.25;
    P[J.pony1 * 3 + 2] = p.z * 0.6;
    P[J.pony2 * 3] = p.x * 0.45 - 0.1;
    P[J.pony2 * 3 + 2] = p.z * 0.4;
  }

  /** Writes the pose into the bones. */
  apply() {
    const P = this.pose;
    const bones = this.chr.bones;
    for (let i = 1; i < N; i++) {
      _e.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      bones[i].quaternion.setFromEuler(_e);
    }
    _e.set(0, 0, this.roll);
    const root = bones[0];
    root.quaternion.setFromEuler(_e);
    // respawn: the body is printed upward from the feet (setHidden owns the scale while hidden)
    if (!this.chr.hidden) {
      let sy = 1;
      if (this.spawnT < this.spawnDur) {
        const x = this.spawnT / this.spawnDur;
        sy = 0.02 + 0.98 * (1 - (1 - x) * (1 - x) * (1 - x));
      }
      this.spawnScale = sy;
      if (root.scale.y !== sy || root.scale.x !== 1) root.scale.set(1, sy, 1);
    }
    const hb = bones[J.hips];
    hb.position.copy(this.chr.bindLocal[J.hips]).add(this.hipOff);
    void _v;
  }
}
