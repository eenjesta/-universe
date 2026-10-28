import * as THREE from 'three';
import { createShipModel } from './ship-model.js';
import { damp, clamp } from '../core/math.js';

/**
 * Player ship: arcade flight model + chase camera.
 *  - mouse = virtual joystick (pointer lock; offset accumulates, slow
 *    re-centre, dead zone, smoothed angular rates), W/S throttle, A/D or Q/E
 *    roll (E only when no scan/dock prompt), Shift boost (drains energy, FOV
 *    kick, stretched speed lines), click/Space lasers (heat), F/right-click
 *    missiles at the locked target;
 *  - regenerating shield over a hull, asteroid / station / convoy collisions
 *    with bounce + damage, death → respawn at Station Halo;
 *  - chase camera with rotational spring lag, speed-dependent pull-back, shake:
 *    it follows the ship's FULL orientation (ship always centred behind);
 *  - roll is only ever player input: yawing no longer adds a roll RATE (that
 *    integrated into a growing roll over every turn); with no roll input the
 *    ship gently auto-levels to the galactic horizon (world +Y; off near
 *    vertical and while pulling hard on the stick). The model leans INTO the
 *    turn ∝ yaw rate (cosmetic, bounded) and straightens with it.
 */

const MAX_SPEED = 340;
const BOOST_SPEED = 760;
const PITCH = 1.45;
const YAW = 1.0;
const ROLL = 2.5;
const RADIUS = 6.5;
const LEVEL_RATE = 1.3; // auto-level: rad/s of roll rate per rad of roll error
const LEVEL_MAX = 0.85; // rad/s
const LEVEL_DELAY = 0.35; // s after the last roll input
const CAM_OFFSET = new THREE.Vector3(0, 3.7, 15.5);
const FOV = 62;

export function createPlayer(S) {
  const { ctx, fx } = S;
  const input = ctx.input;
  const owned = ctx.state.get('owned.skins') || [];
  const model = createShipModel({ variant: owned.includes('skin-ship-gold') ? 'gold' : 'player' });
  const root = new THREE.Group();
  root.name = 'player-ship';
  root.add(model);
  root.add(fx.shield);

  const p = {
    isPlayer: true,
    team: 'ally',
    kind: 'player',
    label: 'Ø',
    object: root,
    model,
    position: root.position,
    quaternion: root.quaternion,
    velocity: new THREE.Vector3(),
    angVel: new THREE.Vector3(),
    stick: new THREE.Vector2(),
    radius: RADIUS,
    speed: 0,
    throttle: 0.35,
    boost: 1,
    boosting: false,
    boostT: 0,
    heat: 0,
    overheated: false,
    missiles: 12,
    maxMissiles: 12,
    shield: 100,
    hull: 100,
    lastHit: -10,
    alive: true,
    docked: false,
    controls: true,
    autopilot: null,
    fireT: 0,
    missileT: 0,
    gun: 0,
    fov: FOV,
    shakeAmt: 0,
    rollBlock: false,
    rollIdle: 0,
    camOverride: null,
    hitFlash: 0,
  };
  S.player = p;

  const trails = [
    fx.trail({ width: 0.32, color: new THREE.Color(0.6, 1.4, 3.4) }),
    fx.trail({ width: 0.32, color: new THREE.Color(0.6, 1.4, 3.4) }),
  ];

  // ---------------------------------------------------------- helpers
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const fwd = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _back = new THREE.Vector3();
  const _lvl = new THREE.Vector3();
  /** Signed roll (rad) from the ship's up to the world-up horizon around its long axis + a weight (0 near vertical). */
  const level = { err: 0, w: 0 };
  function rollToLevel() {
    _back.set(0, 0, 1).applyQuaternion(root.quaternion);
    _up.set(0, 1, 0).applyQuaternion(root.quaternion);
    _lvl.set(0, 1, 0).addScaledVector(_back, -_back.y); // world up ⊥ the long axis
    const len = _lvl.length();
    if (!(len > 1e-3)) {
      level.err = 0;
      level.w = 0;
      return level;
    }
    _lvl.multiplyScalar(1 / len);
    const cosA = clamp(_up.dot(_lvl), -1, 1);
    const sinA = _w.crossVectors(_up, _lvl).dot(_back);
    level.err = Math.atan2(sinA, cosA);
    level.w = clamp((len - 0.2) / 0.35, 0, 1);
    return level;
  }
  p.getForward = (out = fwd) => out.set(0, 0, -1).applyQuaternion(root.quaternion);

  p.shake = (a) => {
    p.shakeAmt = Math.min(1.5, p.shakeAmt + a);
  };

  p.damage = (amount, at) => {
    if (!p.alive || p.docked || p.invulnT > 0) return;
    p.lastHit = S.time;
    let rest = amount;
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, rest);
      p.shield -= absorbed;
      rest -= absorbed;
      if (at) {
        _v.copy(at).sub(root.position).applyQuaternion(_q.copy(root.quaternion).invert());
        fx.shieldHit(_v);
      }
      ctx.audio.play('shield.hit', { volume: 0.7 });
    }
    if (rest > 0) {
      p.hull = Math.max(0, p.hull - rest);
      p.hitFlash = Math.min(1, p.hitFlash + 0.5 + rest / 25);
      ctx.audio.play('explosion', { volume: 0.35, pitch: 1.6 });
    }
    p.shake(Math.min(0.8, 0.12 + amount / 40));
    ctx.events.emit('space:damage', { shield: Math.round(p.shield), hull: Math.round(p.hull) });
    if (p.hull <= 0) die();
  };
  p.invulnT = 0;

  function die() {
    p.alive = false;
    p.controls = false;
    fx.explosion(root.position, 2, { debrisCount: 20 });
    ctx.audio.play('explosion', { volume: 1 });
    root.visible = false;
    p.velocity.set(0, 0, 0);
    trails.forEach((tr) => tr.reset());
    S.onPlayerDestroyed?.();
  }

  p.repair = () => {
    p.shield = 100;
    p.hull = 100;
    p.heat = 0;
    p.overheated = false;
    p.boost = 1;
    p.missiles = p.maxMissiles;
    ctx.events.emit('space:damage', { shield: 100, hull: 100 });
  };

  /** Places the ship (heading from a look target or quaternion) with a given speed. */
  p.reset = (pos, lookAt = null, speed = 0, quat = null) => {
    root.position.copy(pos);
    if (quat) root.quaternion.copy(quat);
    else if (lookAt) {
      const m = new THREE.Matrix4().lookAt(pos, lookAt, new THREE.Vector3(0, 1, 0));
      root.quaternion.setFromRotationMatrix(m);
    }
    p.getForward(fwd);
    p.velocity.copy(fwd).multiplyScalar(speed);
    p.speed = speed;
    p.throttle = clamp(speed / MAX_SPEED, 0, 1);
    p.angVel.set(0, 0, 0);
    p.stick.set(0, 0);
    p.alive = true;
    p.docked = false;
    root.visible = true;
    trails.forEach((tr) => tr.reset());
    snapCamera();
  };

  // ---------------------------------------------------------- weapons
  const gunPos = new THREE.Vector3();
  const aim = new THREE.Vector3();
  function fireLasers() {
    const guns = model.userData.guns;
    p.gun = (p.gun + 1) % guns.length;
    guns[p.gun].getWorldPosition(gunPos);
    p.getForward(aim);
    // converge on the lead point of the lock (within a small cone) — gentle aim assist
    const lock = S.combat.lock;
    if (lock?.alive) {
      const dist = lock.position.distanceTo(gunPos);
      _w.copy(lock.position).addScaledVector(lock.velocity, dist / 2300).sub(gunPos).normalize();
      if (_w.angleTo(aim) < 0.06) aim.copy(_w);
    } else {
      // converge at 600 m
      _w.copy(root.position).addScaledVector(aim, 600).sub(gunPos).normalize();
      aim.copy(_w);
    }
    S.combat.fireBolt(gunPos, aim, 'ally', { player: true, damage: 12, inherit: p.velocity, speed: 2300 });
    fx.flash(gunPos, 2.6, S.boltColor, 0.07);
    ctx.audio.play('laser', { volume: 0.55 });
    p.heat += 0.042;
    if (p.heat >= 1) {
      p.heat = 1;
      p.overheated = true;
    }
  }
  function fireMissile() {
    p.getForward(aim);
    gunPos.set(0, -1.2, -2).applyQuaternion(root.quaternion).add(root.position);
    const target = S.combat.lock?.alive ? S.combat.lock : null;
    if (S.combat.fireMissile(gunPos, aim, target, 'ally', { player: true, inherit: p.velocity })) {
      p.missiles--;
      ctx.audio.play('laser', { volume: 0.8, pitch: 0.45 });
    }
  }

  // ---------------------------------------------------------- collisions
  const colAxis = new THREE.Vector3();
  function bounce(normal, depth, hard = 1) {
    root.position.addScaledVector(normal, depth + 0.05);
    const vn = p.velocity.dot(normal);
    if (vn < 0) {
      p.velocity.addScaledVector(normal, -vn * 1.5);
      p.velocity.multiplyScalar(0.8);
      const impact = -vn;
      if (impact > 18) {
        p.damage((impact - 18) * 0.24 * hard, _w.copy(root.position).addScaledVector(normal, -RADIUS));
        fx.sparks(_w, normal, 18, S.sparkColor);
        p.shake(Math.min(1, impact / 120));
      }
    }
  }
  function collide() {
    const hit = S.field.collideSphere(root.position, RADIUS);
    if (hit) bounce(hit.normal, hit.depth);
    const st = S.station;
    if (st && root.position.distanceToSquared(st.position) < (st.radius + 400) ** 2) {
      const d = st.sdf(root.position) - RADIUS;
      if (d < 0) bounce(st.normalAt(root.position, _v), -d);
    }
    for (const e of S.ships.list) {
      if (!e.alive || e.team !== 'ally' || !e.convoy) continue;
      if (e.kind === 'colony') {
        colAxis.set(0, 0, -1).applyQuaternion(e.quaternion);
        _v.copy(root.position).sub(e.position);
        const along = clamp(_v.dot(colAxis), -125, 120);
        _w.copy(e.position).addScaledVector(colAxis, along);
        _v.copy(root.position).sub(_w);
        const d = _v.length();
        const r = 30 + RADIUS;
        if (d < r && d > 1e-3) bounce(_v.multiplyScalar(1 / d), r - d, 0.6);
      } else {
        _v.copy(root.position).sub(e.position);
        const d = _v.length();
        const r = e.radius + RADIUS;
        if (d < r && d > 1e-3) bounce(_v.multiplyScalar(1 / d), r - d, 0.6);
      }
    }
  }

  // ---------------------------------------------------------- update (mode update, order 20)
  const dq = new THREE.Quaternion();
  const desiredVel = new THREE.Vector3();
  let engineSound = null;
  p.startSound = () => {
    engineSound?.stop?.(0.1);
    engineSound = ctx.audio.loop('ship.engine', { volume: 0.7 });
  };
  p.stopSound = () => {
    engineSound?.stop?.(0.4);
    engineSound = null;
  };

  p.update = (dt) => {
    p.invulnT = Math.max(0, p.invulnT - dt);
    if (!p.alive) return;
    if (p.autopilot) {
      p.autopilot.update(dt);
      p.angVel.multiplyScalar(Math.exp(-4 * dt)); // the autopilot drives the quaternion: let the lean settle
      model.userData.setThrust(p.throttle, 0);
      afterMove(dt);
      return;
    }
    const enabled = p.controls && input.gameEnabled;
    // virtual joystick
    if (enabled) {
      p.stick.x += input.lookX * 0.0026;
      p.stick.y += input.lookY * 0.0026;
    }
    const sl = p.stick.length();
    if (sl > 1) p.stick.multiplyScalar(1 / sl);
    p.stick.multiplyScalar(Math.exp(-dt * 0.45));
    const dz = (v) => (Math.abs(v) < 0.05 ? 0 : (v - Math.sign(v) * 0.05) / 0.95);
    const sx = dz(p.stick.x);
    const sy = dz(p.stick.y);
    let roll = 0;
    if (enabled) {
      if (input.action('left') || input.down('KeyQ')) roll += 1;
      if (input.action('right') || (input.down('KeyE') && !p.rollBlock)) roll -= 1;
      if (input.action('forward')) p.throttle = Math.min(1, p.throttle + dt * 0.75);
      if (input.action('back')) p.throttle = Math.max(0, p.throttle - dt * 0.75);
    }
    // angular rates (local): x pitch, y yaw, z roll
    const tx = -sy * PITCH;
    const ty = -sx * YAW;
    let tz = roll * ROLL;
    p.rollIdle = roll !== 0 ? 0 : p.rollIdle + dt;
    if (p.rollIdle > LEVEL_DELAY) {
      const lv = rollToLevel();
      const k = lv.w * clamp((p.rollIdle - LEVEL_DELAY) * 2) * (1 - clamp(Math.abs(sy) * 1.6));
      tz += clamp(lv.err * LEVEL_RATE, -LEVEL_MAX, LEVEL_MAX) * k;
    }
    p.angVel.x = damp(p.angVel.x, tx, 5.5, dt);
    p.angVel.y = damp(p.angVel.y, ty, 5.5, dt);
    p.angVel.z = damp(p.angVel.z, tz, 4.5, dt);
    _e.set(p.angVel.x * dt, p.angVel.y * dt, p.angVel.z * dt, 'YXZ');
    dq.setFromEuler(_e);
    root.quaternion.multiply(dq).normalize();

    // boost
    const wantBoost = enabled && input.action('boost') && p.boost > 0.02 && !p.overheatedBoost;
    if (wantBoost && !p.boosting) ctx.audio.play('boost', { volume: 0.8 });
    p.boosting = wantBoost;
    if (p.boosting) {
      p.boost = Math.max(0, p.boost - dt * 0.27);
      p.boostT = 0;
    } else {
      p.boostT += dt;
      if (p.boostT > 1.1) p.boost = Math.min(1, p.boost + dt * 0.16);
    }

    // velocity: flight assist toward forward × target speed (keeps a little drift)
    p.getForward(fwd);
    const target = p.boosting ? BOOST_SPEED : p.throttle * MAX_SPEED;
    desiredVel.copy(fwd).multiplyScalar(target);
    const k = p.boosting ? 1.5 : 1.15;
    p.velocity.lerp(desiredVel, 1 - Math.exp(-k * dt));
    root.position.addScaledVector(p.velocity, dt);
    collide();
    p.speed = p.velocity.length();

    // weapons
    p.fireT -= dt;
    p.missileT -= dt;
    const firing = enabled && (input.down('Mouse0') || input.down('Space'));
    if (firing && !p.overheated && p.fireT <= 0) {
      p.fireT = 0.085;
      fireLasers();
    }
    p.heat = Math.max(0, p.heat - dt * (firing && !p.overheated ? 0.12 : 0.34));
    if (p.overheated && p.heat < 0.35) p.overheated = false;
    if (enabled && (input.pressed('KeyF') || input.pressed('Mouse2')) && p.missiles > 0 && p.missileT <= 0) {
      p.missileT = 0.55;
      fireMissile();
    }

    // shield regen
    if (S.time - p.lastHit > 3 && p.shield < 100) p.shield = Math.min(100, p.shield + dt * 14);

    model.userData.setThrust(Math.max(0.12, p.throttle), p.boosting ? 1 : 0);
    afterMove(dt);
  };

  function afterMove(dt) {
    // cosmetic lean INTO the turn (∝ yaw rate) + slight pitch lean; both straighten with the rates
    model.rotation.z = damp(model.rotation.z, clamp(p.angVel.y * 0.5, -0.4, 0.4), 4, dt);
    model.rotation.x = damp(model.rotation.x, clamp(p.angVel.x * 0.06, -0.12, 0.12), 4, dt);
    if (!Number.isFinite(model.rotation.z + model.rotation.x)) model.rotation.set(0, 0, 0);
    model.userData.update(S.time);
    const on = p.speed > 40;
    for (let i = 0; i < 2; i++) {
      model.userData.engines[i].getWorldPosition(_v);
      trails[i].push(_v, on, dt);
    }
    p.hitFlash = Math.max(0, p.hitFlash - dt * 1.4);
    if (engineSound) engineSound.set({ thrust: p.throttle, boost: p.boosting ? 1 : 0 });
  }

  // ---------------------------------------------------------- chase camera
  const camQ = new THREE.Quaternion();
  const camPos = new THREE.Vector3();
  function snapCamera() {
    camQ.copy(root.quaternion);
    p.shakeAmt = 0;
  }
  let shakeT = 0;
  p.updateCamera = (dt, camera) => {
    if (p.camOverride && p.camOverride(dt, camera)) return;
    const lag = p.boosting ? 4.2 : 5.2;
    camQ.slerp(root.quaternion, 1 - Math.exp(-lag * dt));
    camPos.copy(CAM_OFFSET);
    camPos.z += Math.min(10, p.speed * 0.008) + (p.boosting ? 3 : 0);
    camPos.applyQuaternion(camQ).add(root.position);
    camera.position.copy(camPos);
    camera.quaternion.copy(camQ);
    // shake
    p.shakeAmt = Math.max(0, p.shakeAmt - dt * 2.2);
    shakeT += dt * 38;
    const sk = p.shakeAmt * p.shakeAmt * 0.9 + (p.boosting ? 0.06 : 0);
    if (sk > 0) {
      _e.set(Math.sin(shakeT * 1.13) * sk * 0.02, Math.sin(shakeT * 0.87 + 1.3) * sk * 0.02, Math.sin(shakeT * 0.71 + 2.1) * sk * 0.015);
      dq.setFromEuler(_e);
      camera.quaternion.multiply(dq);
    }
    const targetFov = FOV + (p.boosting ? 14 : 0) + Math.min(6, p.speed * 0.012);
    p.fov = damp(p.fov, targetFov, 3, dt);
    if (Math.abs(camera.fov - p.fov) > 0.01) {
      camera.fov = p.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  };
  p.snapCamera = snapCamera;
  return p;
}

export const FLIGHT = { MAX_SPEED, BOOST_SPEED, FOV, CAM_OFFSET };
