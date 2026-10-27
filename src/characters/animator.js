/**
 * Procedural animation (characters module). No clips: every frame a pose
 * (Euler angles per joint + hip offset + root roll) is synthesised from layers
 * and smoothly blended:
 *   idle (breathing, weight shift, glances) → locomotion cycle (walk ↔ run ↔
 *   sprint lean, phase driven by distance so feet don't slide, idle turn
 *   shuffle) → air (jump / fall) → swim (tread / breaststroke) → sit →
 *   upper-body actions (talk, wave, cheer, clap, tablet) → additive landing
 *   impact, look-at, turn lean, blink and a spring-driven ponytail.
 * Controllers write the inputs (speed, grounded, vy, swimming, turnRate,
 * actions via set(), lookAt()) and call update(dt). No per-frame allocation.
 */
import * as THREE from 'three';
import { J, BONE_COUNT } from './skeleton.js';

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

    // phase: distance-driven stride (+ shuffle when turning on the spot)
    const cycleLen = 0.85 + 0.52 * speed;
    const prevPh = this.phase;
    this.phase += (speed / cycleLen) * dt + this.shuffleW * turn * 0.16 * dt;
    this.phase -= Math.floor(this.phase);
    if (this.grounded && !this.swimming && (this.moveW > 0.3 || this.shuffleW > 0.3) && this.onStep) {
      const crossed = (a) => (prevPh < a && this.phase >= a) || (prevPh > this.phase && (prevPh < a || this.phase >= a));
      if (crossed(0.25)) this.onStep(-1);
      if (crossed(0.75)) this.onStep(1);
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

    // ------------------------------------------------------- additives
    // landing impact
    this.landT += dt;
    if (this.landT < 0.6 && this.landAmt > 0) {
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
    this.updateLook(P, dt);
    // lean into turns (root roll) — not while swimming or sitting
    const targetRoll = clamp(this.turnRate * speed * 0.032, -0.2, 0.2) * (1 - this.swimW) * (1 - ws);
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
    // ponytail spring
    this.updatePony(P, dt);
    this.apply();
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
    bones[0].quaternion.setFromEuler(_e);
    const hb = bones[J.hips];
    hb.position.copy(this.chr.bindLocal[J.hips]).add(this.hipOff);
    void _v;
  }
}
