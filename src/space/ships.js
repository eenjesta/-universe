import * as THREE from 'three';
import { createPirateModel, createFreighterModel, createColonyFallback } from './models.js';
import { createShipModel } from './ship-model.js';
import { SPACE } from './layout.js';
import { mulberry32 } from '../core/math.js';
import { t } from '../core/i18n.js';

/**
 * AI ships: pirate fighters (pursue, strafe, break off, evade, lead-shoot,
 * red engines), allied wingmen (blue engines; escort the convoy, engage
 * pirates near it) and the convoy (colony ship + 3 freighters moving along
 * SPACE.convoyPath in formation). Every entity is
 *   { id, kind, team, label, object, position, quaternion, velocity, radius, hitRadius,
 *     hp, maxHp, alive, target, model }.
 *   ships.spawnPirate(pos, opts)  ships.spawnWave(n, around, dir)  ships.kill(e, byPlayer)
 *   ships.convoy {colony, freighters, s, length, state, point(u)}  ships.update(dt, t)
 */

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
const RED = new THREE.Color(3.2, 0.35, 0.22);
const BLUE = new THREE.Color(0.55, 1.3, 3.2);

export function createShips(S, { colonyFactory = null } = {}) {
  const { ctx, scene, fx } = S;
  const rng = mulberry32(4242);
  const list = [];
  let nextId = 1;
  const labels = {
    pirate: t({ en: 'Pirate', nl: 'Piraat' }),
    wingman: t({ en: 'Wingman', nl: 'Wingman' }),
    freighter: t({ en: 'Freighter', nl: 'Vrachtschip' }),
    colony: t({ en: 'Colony ship', nl: 'Kolonieschip' }),
  };

  function makeEntity(kind, team, object, extra = {}) {
    const e = {
      id: `${kind}-${nextId++}`,
      kind,
      team,
      label: labels[kind] || kind,
      object,
      model: object,
      position: object.position,
      quaternion: object.quaternion,
      velocity: new THREE.Vector3(),
      forward: new THREE.Vector3(0, 0, -1),
      speed: 0,
      maxSpeed: 260,
      turn: 1.2,
      radius: object.userData.radius || 8,
      hitRadius: object.userData.radius || 8,
      hp: 100,
      maxHp: 100,
      alive: true,
      target: null,
      state: 'attack',
      stateT: 0,
      thinkT: 0,
      fireT: rng() * 0.5,
      gun: 0,
      hitT: 0,
      breakDir: new THREE.Vector3(),
      jink: new THREE.Vector3(),
      trail: null,
      ...extra,
    };
    e.onHit = () => onHitEvade(e);
    scene.add(object);
    list.push(e);
    return e;
  }

  // ---------------------------------------------------------- spawners
  function spawnPirate(pos, { face = null, wave = 0 } = {}) {
    const obj = createPirateModel();
    obj.position.copy(pos);
    if (face) obj.lookAt(_v.copy(pos).sub(face).add(pos));
    const e = makeEntity('pirate', 'pirate', obj, { hp: 60, maxHp: 60, maxSpeed: 250 + rng() * 40, turn: 1.25 + rng() * 0.25, wave });
    e.speed = e.maxSpeed * 0.8;
    e.trail = fx.trail({ width: 0.7, color: RED });
    e.thinkT = 0;
    return e;
  }

  function spawnWingman(pos, slot) {
    const obj = createShipModel({ variant: 'wingman', engineColor: 'blue', lite: true });
    obj.position.copy(pos);
    const e = makeEntity('wingman', 'ally', obj, { hp: 260, maxHp: 260, maxSpeed: 290, turn: 1.45, slot: slot.clone(), armor: 0.25 });
    e.speed = 90;
    e.trail = fx.trail({ width: 0.9, color: BLUE });
    obj.userData.setThrust(0.6, 0);
    return e;
  }

  // ---------------------------------------------------------- convoy
  const curve = new THREE.CatmullRomCurve3(SPACE.convoyPath, false, 'centripetal');
  const convoyLen = curve.getLength();
  const colonyObj = colonyFactory ? colonyFactory() : createColonyFallback();
  const colony = makeEntity('colony', 'ally', colonyObj, { hp: 4000, maxHp: 4000, hitRadius: 70, radius: 135, armor: 1, convoy: true });
  const freighters = [];
  const fOffsets = [
    [-230, -60, -120],
    [240, 50, -40],
    [10, -130, 230],
  ];
  fOffsets.forEach((off, i) => {
    const e = makeEntity('freighter', 'ally', createFreighterModel(i + 1), { hp: 900, maxHp: 900, hitRadius: 26, radius: 26, armor: 1, convoy: true, offset: new THREE.Vector3(...off) });
    freighters.push(e);
  });
  const convoy = {
    colony,
    freighters,
    curve,
    length: convoyLen,
    s: 0,
    speed: 92,
    state: 'idle', // idle | moving | holding | arrived | lost
    frame: { t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), p: new THREE.Vector3() },
    /** Frame (position, tangent, right, up) at arc distance s. */
    frameAt(s, out = convoy.frame) {
      const u = Math.min(1, Math.max(0, s / convoyLen));
      curve.getPointAt(u, out.p);
      curve.getTangentAt(u, out.t).normalize();
      out.r.crossVectors(out.t, UP).normalize();
      out.u.crossVectors(out.r, out.t).normalize();
      return out;
    },
    reset() {
      convoy.s = 0;
      convoy.state = 'idle';
      for (const e of [colony, ...freighters]) {
        e.hp = e.maxHp;
        if (!e.alive) {
          e.alive = true;
          scene.add(e.object);
          list.push(e);
        }
      }
      placeConvoy(0);
    },
  };
  const _m = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  function placeConvoy(dt) {
    const f = convoy.frameAt(convoy.s);
    const moving = convoy.state === 'moving';
    const spd = moving ? convoy.speed : 0;
    colony.position.copy(f.p);
    _m.lookAt(f.p, _v.copy(f.p).add(f.t), f.u);
    colony.quaternion.setFromRotationMatrix(_m);
    colony.velocity.copy(f.t).multiplyScalar(spd);
    colony.object.userData.setThrust?.(moving ? 0.7 : 0.15, 0);
    for (const e of freighters) {
      e.position.copy(f.p).addScaledVector(f.r, e.offset.x).addScaledVector(f.u, e.offset.y).addScaledVector(f.t, -e.offset.z);
      e.quaternion.copy(colony.quaternion);
      e.velocity.copy(colony.velocity);
      e.object.userData.setThrust?.(moving ? 0.7 : 0.15, 0);
    }
  }
  placeConvoy(0);

  // wingmen escort slots (convoy frame: right, up, back)
  const slots = [new THREE.Vector3(-170, 60, 160), new THREE.Vector3(190, 40, 140), new THREE.Vector3(-90, 110, -260), new THREE.Vector3(120, -70, -300)];
  const wingmen = slots.map((sl) => {
    const f = convoy.frame;
    const p = new THREE.Vector3().copy(f.p).addScaledVector(f.r, sl.x).addScaledVector(f.u, sl.y).addScaledVector(f.t, -sl.z);
    const w = spawnWingman(p, sl);
    w.quaternion.copy(colony.quaternion);
    return w;
  });

  /** n pirates in a loose group `dist` m from `around`, coming from direction `dir`. */
  function spawnWave(n, around, dir, dist = 1700, wave = 0) {
    const out = [];
    const side = _w.crossVectors(dir, UP).normalize();
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3()
        .copy(around)
        .addScaledVector(dir, dist + rng() * 300)
        .addScaledVector(side, (i - (n - 1) / 2) * 120 + (rng() - 0.5) * 80)
        .add(new THREE.Vector3(0, (rng() - 0.5) * 220, 0));
      out.push(spawnPirate(p, { face: around, wave }));
    }
    return out;
  }

  // ---------------------------------------------------------- kill / remove
  const BOOM = new THREE.Color(6, 2.6, 0.8);
  function kill(e, byPlayer = false) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    const big = e.kind === 'colony' ? 5 : e.kind === 'freighter' ? 2.4 : 1.4;
    fx.explosion(e.position, big, { color: BOOM, debrisCount: e.kind === 'pirate' ? 10 : 24 });
    ctx.audio.play('explosion', { position: e.position, volume: Math.min(1, 0.6 + big * 0.1) });
    if (S.player?.alive && e.position.distanceTo(S.player.position) < 600) S.player.shake(Math.max(0.15, 1 - e.position.distanceTo(S.player.position) / 600));
    scene.remove(e.object);
    e.trail?.release();
    e.trail = null;
    if (e.kind === 'pirate') {
      if (byPlayer) ctx.events.emit('space:kill', { enemy: 'pirate', id: e.id, by: 'player', wave: e.wave || 0 });
      S.onPirateKilled?.(e, byPlayer);
    }
    if (e.kind === 'wingman') {
      // a wingman ejects and is replaced later by the escort
      e.respawnT = 25;
      e.dead = true;
    }
    if (S.combat && S.combat.lock === e) S.combat.lock = null;
  }

  function removeDead() {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.alive && e.kind === 'pirate') {
        e.object.userData.dispose?.();
        e.object.traverse((o) => o.isMesh && o.geometry.dispose());
        list.splice(i, 1);
      } else if (!e.alive && e.kind !== 'wingman') list.splice(i, 1);
    }
  }

  // ---------------------------------------------------------- steering helpers
  const desired = new THREE.Vector3();
  const lead = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const gunPos = new THREE.Vector3();
  const tq = new THREE.Quaternion();

  function steer(e, dir, dt) {
    if (dir.lengthSq() < 1e-8) return;
    dir.normalize();
    right.set(1, 0, 0).applyQuaternion(e.quaternion);
    const lateral = THREE.MathUtils.clamp(dir.dot(right), -1, 1);
    up.set(0, 1, 0).applyQuaternion(e.quaternion).multiplyScalar(0.6).add(UP).addScaledVector(right, lateral * 1.4).normalize();
    _m.lookAt(e.position, _v.copy(e.position).add(dir), up);
    tq.setFromRotationMatrix(_m);
    e.quaternion.rotateTowards(tq, e.turn * dt);
  }

  function avoid(e, dir) {
    ahead.copy(e.position).addScaledVector(e.forward, e.speed * 1.1 + 60);
    const hit = S.field?.collideSphere(ahead, e.radius + 30);
    if (hit) dir.addScaledVector(hit.normal, 3);
    const st = S.station;
    if (st && ahead.distanceToSquared(st.position) < (st.radius + 600) ** 2) {
      const d = st.sdf(ahead);
      if (d < 120) dir.addScaledVector(st.normalAt(ahead), 3.5);
    }
    // keep fighters off the convoy hulls
    if (e.kind === 'pirate' || e.kind === 'wingman') {
      const cd = ahead.distanceTo(colony.position);
      if (colony.alive && cd < 170) dir.addScaledVector(_w.copy(ahead).sub(colony.position).normalize(), 2.5);
    }
  }

  function chooseTargetFor(e) {
    let best = null;
    let bestScore = Infinity;
    const p = S.player;
    if (e.team === 'pirate') {
      if (p?.alive && !p.docked) {
        const d = p.position.distanceTo(e.position) * 0.75;
        if (d < bestScore) {
          bestScore = d;
          best = p;
        }
      }
      for (const o of list) {
        if (!o.alive || o.team !== 'ally') continue;
        const w = o.kind === 'colony' ? 0.55 : o.kind === 'freighter' ? 0.8 : 1.1;
        const d = o.position.distanceTo(e.position) * w;
        if (d < bestScore) {
          bestScore = d;
          best = o;
        }
      }
    } else {
      for (const o of list) {
        if (!o.alive || o.team !== 'pirate') continue;
        const d = o.position.distanceTo(e.position) + o.position.distanceTo(colony.position) * 0.5;
        if (d < bestScore && o.position.distanceTo(colony.position) < 3500) {
          bestScore = d;
          best = o;
        }
      }
    }
    return best;
  }

  function fire(e, dir) {
    const guns = e.object.userData.guns;
    if (guns?.length) {
      e.gun = (e.gun + 1) % guns.length;
      guns[e.gun].getWorldPosition(gunPos);
    } else gunPos.copy(e.position);
    const pirate = e.team === 'pirate';
    _v.copy(dir);
    // inaccuracy
    _v.x += (rng() - 0.5) * 0.04;
    _v.y += (rng() - 0.5) * 0.04;
    _v.z += (rng() - 0.5) * 0.04;
    S.combat.fireBolt(gunPos, _v, e.team, { damage: pirate ? 6 : 9, inherit: e.velocity, speed: 1900 });
    fx.flash(gunPos, 2.4, pirate ? RED : BLUE, 0.06);
    if (rng() < 0.35) ctx.audio.play('laser', { position: gunPos, volume: 0.35, pitch: pirate ? 0.8 : 1.1 });
  }

  // ---------------------------------------------------------- fighter brain
  function fighter(e, dt) {
    e.stateT += dt;
    e.thinkT -= dt;
    e.fireT -= dt;
    if (e.thinkT <= 0 || !e.target?.alive || e.target.docked) {
      e.thinkT = 1.2 + rng() * 1.2;
      e.target = chooseTargetFor(e);
    }
    e.forward.copy(FWD).applyQuaternion(e.quaternion);
    let targetSpeed = e.maxSpeed;
    const tgt = e.target;
    if (!tgt) {
      if (e.kind === 'wingman') {
        // formation around the colony ship
        const f = convoy.frame;
        desired.copy(f.p).addScaledVector(f.r, e.slot.x).addScaledVector(f.u, e.slot.y).addScaledVector(f.t, -e.slot.z);
        desired.sub(e.position);
        const d = desired.length();
        targetSpeed = Math.min(e.maxSpeed, convoy.state === 'moving' ? convoy.speed + d * 0.6 : d * 0.5);
        if (d < 30) desired.copy(f.t);
      } else {
        desired.copy(e.home || colony.position).sub(e.position);
        if (desired.length() < 300) desired.cross(UP);
        targetSpeed = 180;
      }
    } else {
      _w.copy(tgt.position).sub(e.position);
      const dist = _w.length();
      const tv = tgt.velocity || lead.set(0, 0, 0);
      lead.copy(tgt.position).addScaledVector(tv, dist / 1900);
      if (e.state === 'attack') {
        desired.copy(lead).sub(e.position);
        if (dist < (tgt.radius > 50 ? tgt.radius + 160 : 220) || e.stateT > 8) {
          e.state = 'break';
          e.stateT = 0;
          e.breakDir.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().addScaledVector(e.forward, 1.2).normalize();
        }
        targetSpeed = dist > 700 ? e.maxSpeed : Math.max(140, (tgt.speed || 0) + 40);
        // fire when aligned
        const ang = e.forward.angleTo(desired);
        const range = e.team === 'pirate' ? 1500 : 1700;
        if (ang < 0.08 && dist < range && e.fireT <= 0) {
          e.fireT = (e.team === 'pirate' ? 0.26 : 0.22) + rng() * 0.18;
          fire(e, desired.normalize());
        }
      } else if (e.state === 'break') {
        desired.copy(e.breakDir);
        targetSpeed = e.maxSpeed;
        if (e.stateT > 2.4 + rng() * 0.4) {
          e.state = 'attack';
          e.stateT = 0;
        }
      } else if (e.state === 'evade') {
        const s = Math.sin(e.stateT * 5 + e.jink.x * 10);
        desired.copy(e.forward).addScaledVector(e.jink, s * 1.6);
        targetSpeed = e.maxSpeed;
        if (e.stateT > 1.5) {
          e.state = 'attack';
          e.stateT = 0;
        }
      }
    }
    avoid(e, desired);
    steer(e, desired, dt);
    e.forward.copy(FWD).applyQuaternion(e.quaternion);
    e.speed += (targetSpeed - e.speed) * Math.min(1, dt * 1.4);
    e.velocity.copy(e.forward).multiplyScalar(e.speed);
    e.position.addScaledVector(e.velocity, dt);
    // hard push-out from rocks
    const hit = S.field?.collideSphere(e.position, e.radius);
    if (hit) e.position.addScaledVector(hit.normal, hit.depth);
    e.object.userData.setThrust?.(Math.min(1, e.speed / e.maxSpeed), e.state === 'break' ? 0.6 : 0);
    if (e.trail) {
      _v.set(0, 0, 5.5).applyQuaternion(e.quaternion).add(e.position);
      e.trail.push(_v, true, dt);
    }
    if (e.kind === 'wingman' && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + dt * 6);
  }

  function onHitEvade(e) {
    if (e.kind === 'pirate' && e.state === 'attack' && rng() < 0.3) {
      e.state = 'evade';
      e.stateT = 0;
      e.jink.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    }
  }

  // ---------------------------------------------------------- update
  function update(dt, time) {
    if (convoy.state === 'moving') {
      convoy.s = Math.min(convoy.length, convoy.s + convoy.speed * dt);
      if (convoy.s >= convoy.length) convoy.state = 'holding';
    }
    if (colony.alive) placeConvoy(dt);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) {
        if (e.kind === 'wingman' && e.dead) {
          e.respawnT -= dt;
          if (e.respawnT <= 0 && colony.alive) {
            // a fresh wingman launches from the colony ship
            e.dead = false;
            e.alive = true;
            e.hp = e.maxHp;
            e.position.copy(colony.position).addScaledVector(convoy.frame.u, 60);
            e.state = 'attack';
            scene.add(e.object);
            e.trail = fx.trail({ width: 0.9, color: BLUE });
          }
        }
        continue;
      }
      if (e.kind === 'pirate' || e.kind === 'wingman') fighter(e, dt);
      e.object.userData.update?.(time);
      if (e.hitT > 0) e.hitT -= dt;
    }
    removeDead();
  }

  return {
    list,
    convoy,
    wingmen,
    colony,
    freighters,
    spawnPirate,
    spawnWave,
    kill,
    update,
    onHit: onHitEvade,
    pirates() {
      let n = 0;
      for (const e of list) if (e.alive && e.team === 'pirate') n++;
      return n;
    },
    clearPirates() {
      for (const e of list) if (e.alive && e.kind === 'pirate') {
        e.alive = false;
        scene.remove(e.object);
        e.trail?.release();
      }
      removeDead();
    },
    placeConvoy,
  };
}
