/**
 * Mock multiplayer source for the avatars (characters module): fake players with
 * net-style views { p: Vector3, h, a, m, hp, sh, veh, w } so ctx.remotes can be
 * built and tested without a server (ctx.remotes.mock(n), ?mockRemotes=N).
 * Never emits net:* events (other modules stay untouched); shots are reported
 * through `onFire({id, w, o, d})` like net:fired.
 *
 * Roles (in order, then wanderers): fighter (strafe, aim, bursts, reload, dodge,
 * hit), driver (car loop), pilot (VTOL loop), casualty (dies, respawns, waves),
 * rifleman (rifle bursts while walking), loafer (sits / waves / jumps).
 */
import * as THREE from 'three';
import { Rng, clamp } from '../core/math.js';
import { randomAppearance } from './appearance.js';

const NAMES = ['Mila', 'Ravi', 'Sora', 'Jonas', 'Imke', 'Teo', 'Noor', 'Lars', 'Yuki', 'Bram', 'Zoë', 'Elin', 'Oskar', 'Fenna', 'Ivo', 'Lotte', 'Kian', 'Maud', 'Sem', 'Tara'];
const ROLES = ['fighter', 'driver', 'pilot', 'casualty', 'rifleman', 'loafer'];

export function createMockNet(ctx, n = 6, { center = null, radius = 12 } = {}) {
  const rng = new Rng(`mock-remotes-${n}`);
  const world = ctx.world;
  const c = center || ctx.player?.object?.position || new THREE.Vector3();
  const cx = c.x;
  const cz = c.z;
  const players = new Map();
  const list = [];
  const ground = (x, z) => {
    const th = world.getHeightAt ? world.getHeightAt(x, z) : 0;
    const g = ctx.physics?.groundHeight?.(x, z, th + 1.5, 0.6, 0.2);
    return Number.isFinite(g) ? Math.max(g, th) : th;
  };
  for (let i = 0; i < n; i++) {
    const role = i < ROLES.length ? ROLES[i] : 'wander';
    const id = `mock-${i + 1}`;
    const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '');
    const ang = (i / Math.max(1, n)) * Math.PI * 2;
    const r = role === 'driver' || role === 'pilot' ? 26 : radius * (0.55 + 0.45 * rng.random());
    const x = cx + Math.sin(ang) * r;
    const z = cz + Math.cos(ang) * r;
    const p = {
      id,
      name,
      role,
      appearance: randomAppearance({ rng }),
      view: { p: new THREE.Vector3(x, ground(x, z), z), h: 0, a: 'idle', m: 'foot', hp: 100, sh: 50, veh: null, w: null },
      t: rng.range(0, 20),
      ang,
      r,
      home: new THREE.Vector3(x, 0, z),
      goal: new THREE.Vector3(x, 0, z),
      speed: 0,
      act: 'idle',
      actT: rng.range(0.5, 3),
      fireT: 0,
      deadT: 0,
      weapon: role === 'rifleman' ? 'plasma-rifle' : role === 'fighter' ? 'pulse-pistol' : rng.chance(0.5) ? 'plasma-rifle' : 'railgun',
    };
    // armed roles carry their weapon id in the view (like a snapshot `w` field would) so the model is right at once
    if (role === 'fighter' || role === 'rifleman') p.view.w = p.weapon;
    players.set(id, p);
    list.push(p);
  }

  const dir = new THREE.Vector3();
  const api = {
    players,
    list,
    ids: list.map((p) => p.id),
    onFire: null,
    update(dt) {
      for (const p of list) step(p, dt);
    },
  };

  function fire(p, pitch = 0.05) {
    const v = p.view;
    dir.set(-Math.sin(v.h) * Math.cos(pitch), Math.sin(pitch), -Math.cos(v.h) * Math.cos(pitch));
    api.onFire?.({ id: p.id, w: p.weapon, o: [v.p.x, v.p.y + 1.4, v.p.z], d: [dir.x, dir.y, dir.z] });
  }

  function walkTo(p, dt, speed) {
    const v = p.view;
    const dx = p.goal.x - v.p.x;
    const dz = p.goal.z - v.p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) return true;
    const s = Math.min(speed * dt, d);
    v.p.x += (dx / d) * s;
    v.p.z += (dz / d) * s;
    v.p.y = ground(v.p.x, v.p.z);
    v.h = Math.atan2(-dx, -dz);
    return false;
  }

  function pickGoal(p, far = 1) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(2, 9) * far;
    p.goal.set(p.home.x + Math.sin(a) * rr, 0, p.home.z + Math.cos(a) * rr);
  }

  function step(p, dt) {
    const v = p.view;
    p.t += dt;
    p.actT -= dt;
    switch (p.role) {
      case 'driver': {
        // car loop around the centre
        p.ang += (dt * 11) / p.r;
        const x = cx + Math.sin(p.ang) * p.r;
        const z = cz + Math.cos(p.ang) * p.r;
        const y = ground(x, z);
        v.m = 'drive';
        v.a = 'idle';
        v.veh = v.veh || { type: 'car', p: new THREE.Vector3(), h: 0 };
        v.veh.p.set(x, y, z);
        v.veh.h = p.ang - Math.PI / 2 + Math.PI; // tangent (counter-clockwise)
        v.h = v.veh.h;
        v.p.set(x, y + 0.6, z);
        return;
      }
      case 'pilot': {
        p.ang -= (dt * 18) / (p.r + 14);
        const rr = p.r + 14;
        const x = cx + Math.sin(p.ang) * rr;
        const z = cz + Math.cos(p.ang) * rr;
        const y = Math.max(ground(x, z), world.waterLevel ?? 0) + 22 + Math.sin(p.t * 0.4) * 4;
        v.m = 'drive';
        v.a = 'idle';
        v.veh = v.veh || { type: 'vtol', p: new THREE.Vector3(), h: 0 };
        v.veh.p.set(x, y, z);
        v.veh.h = p.ang + Math.PI / 2 + Math.PI;
        v.h = v.veh.h;
        v.p.set(x, y + 1, z);
        return;
      }
      case 'casualty': {
        if (v.a === 'dead') {
          p.deadT -= dt;
          v.hp = 0;
          v.sh = 0;
          if (p.deadT <= 0) {
            v.a = 'respawn';
            v.hp = 100;
            v.sh = 50;
            p.actT = 1.1;
          }
          return;
        }
        if (v.a === 'respawn') {
          if (p.actT <= 0) {
            v.a = 'wave';
            p.actT = 2.5;
          }
          return;
        }
        if (v.a === 'wave') {
          if (p.actT <= 0) {
            v.a = 'walk';
            pickGoal(p);
          }
          return;
        }
        if (walkTo(p, dt, 1.8) || p.actT <= -6) {
          v.a = 'hit';
          v.hp = Math.max(0, v.hp - 35);
          v.sh = 0;
          if (v.hp <= 0) {
            v.a = 'dead';
            p.deadT = 4;
          } else {
            p.actT = 0.35;
            pickGoal(p);
          }
        } else if (v.a === 'hit' && p.actT > 0) {
          // flinch shown
        } else v.a = 'walk';
        return;
      }
      case 'fighter':
      case 'rifleman': {
        // strafe between two points while aiming / firing bursts; reload; dodge; get hit
        const phase = p.t % 14;
        const side = Math.sin(p.t * 0.6);
        const face = Math.atan2(-(cx - v.p.x), -(cz - v.p.z)) + Math.PI; // face outward
        v.h = face;
        if (phase < 9) {
          const reach = p.role === 'fighter' ? 2.4 : 3.2; // strafe half-width (m)
          const rx = Math.cos(face);
          const rz = -Math.sin(face);
          v.p.x = p.home.x + rx * side * reach;
          v.p.z = p.home.z + rz * side * reach;
          v.p.y = ground(v.p.x, v.p.z);
          p.fireT -= dt;
          const burst = phase % 3 < 1.6;
          if (burst && p.fireT <= 0) {
            p.fireT = p.weapon === 'plasma-rifle' ? 0.11 : 0.25;
            fire(p, 0.04 + 0.12 * Math.sin(p.t * 0.7));
            v.a = 'shoot';
          } else if (!burst) v.a = 'aim';
        } else if (phase < 10.5) v.a = 'reload';
        else if (phase < 11.1) {
          if (v.a !== 'dodge') v.a = 'dodge';
          const k = (phase - 10.5) / 0.6;
          v.p.x += -Math.sin(face) * 7 * dt * (1 - k);
          v.p.z += -Math.cos(face) * 7 * dt * (1 - k);
          v.p.y = ground(v.p.x, v.p.z);
        } else if (phase < 11.5) {
          if (v.a !== 'hit') {
            v.a = 'hit';
            v.sh = Math.max(0, v.sh - 20);
          }
        } else {
          v.a = 'aim';
          v.sh = clamp(v.sh + dt * 10, 0, 50);
        }
        return;
      }
      case 'loafer': {
        if (p.actT <= 0) {
          const k = rng.int(0, 3);
          v.a = ['sit', 'wave', 'jump', 'idle'][k];
          p.actT = v.a === 'jump' ? 0.7 : rng.range(2.5, 5);
        }
        if (v.a === 'jump' || v.a === 'fall') {
          // a hop: up (jump) then down (fall), back on the ground when the action ends
          const k = 1 - clamp(p.actT / 0.7, 0, 1);
          v.p.y = ground(v.p.x, v.p.z) + Math.sin(k * Math.PI) * 1.0;
          if (k > 0.5) v.a = 'fall';
          if (k >= 1) v.a = 'idle';
        }
        return;
      }
      default: {
        // wanderer: walk / run / sprint between nearby points, pause, sometimes jump or wave
        if (p.act === 'idle') {
          if (p.actT <= 0) {
            pickGoal(p, 1.4);
            const k = rng.random();
            p.act = 'move';
            p.speed = k < 0.55 ? 1.7 : k < 0.85 ? 4.4 : 7.4;
          }
        } else if (walkTo(p, dt, p.speed)) {
          p.act = 'idle';
          p.actT = rng.range(1, 4);
          v.a = rng.chance(0.2) ? 'wave' : 'idle';
        } else v.a = p.speed > 6 ? 'sprint' : p.speed > 3 ? 'run' : 'walk';
      }
    }
  }

  return api;
}
