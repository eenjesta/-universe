/**
 * Local combat mock (dev only): a tiny fake server behind the ctx.net
 * interface combat uses, for working without shared/sim + src/net (or for
 * isolated tests: ?combatmock). Spawns security drones at the ruins and
 * jungle stalkers at the jungle edge (plus `mock.spawn(type, x, z)`), runs
 * simple AI (patrol → chase → attack, stun), validates FIRE/HIT/THROW/RELOAD/
 * EQUIP/RESPAWN loosely and answers with the protocol's S.* messages through
 * `emit('net:…', msg)`. Not used when a real ctx.net (online or LocalServer)
 * is present unless forced with ?combatmock.
 */
import * as THREE from 'three';
import { C } from '../../shared/protocol.js';
import { ENEMIES, inSafeZone } from './weapon-data.js';
import { enemyVolumes, raySphere, simulateArc } from './logic.js';

const r2 = (n) => Math.round(n * 100) / 100;
const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];

export function createMock(ctx, { defs, emit }) {
  const getH = ctx.world.getHeightAt ? (x, z) => ctx.world.getHeightAt(x, z) : () => 0;
  const ME = 'me';
  const enemies = new Map();
  let nextId = 1;
  let time = 0;
  const player = { hp: 100, sh: 50, en: 100, maxHp: 100, maxSh: 50, lastHit: -100, dead: false, deadAt: 0 };
  const inv = {
    weapons: defs.list.filter((d) => d.kind !== 'throw').map((d) => d.id),
    ammo: {},
    mag: {},
    items: {},
    slot: 0,
  };
  for (const d of defs.list) {
    if (d.kind === 'throw') inv.ammo[d.ammo] = d.carry;
    else {
      inv.ammo[d.ammo] = d.reserve;
      inv.mag[d.id] = d.mag;
    }
  }
  const reloads = [];
  const grenades = [];
  const shots = new Map(); // seq → { w, at }
  const _p = new THREE.Vector3();
  const vols = new Float32Array(16);

  function spawn(type, x, z, home = null) {
    const id = `e${nextId++}`;
    const def = ENEMIES[type] || ENEMIES.drone;
    const gy = getH(x, z);
    const e = {
      id,
      type,
      view: { p: new THREE.Vector3(x, type === 'drone' ? gy + 5.5 : gy, z), h: Math.random() * 6.28, s: 'patrol', hp: def.hp, type },
      home: home || { x, z },
      hp: def.hp,
      cool: 1 + Math.random(),
      stun: 0,
      wander: Math.random() * 6.28,
      alive: true,
    };
    enemies.set(id, e);
    return e;
  }

  function spawnDefaults() {
    const ruins = { x: 250, z: 95 };
    for (let i = 0; i < 3; i++) spawn('drone', ruins.x + Math.cos(i * 2.1) * 14, ruins.z - 20 + Math.sin(i * 2.1) * 10, ruins);
    const jungle = { x: -560, z: -30 };
    for (let i = 0; i < 3; i++) spawn('stalker', jungle.x + i * 6, jungle.z + i * 4, jungle);
  }

  function sendInv(patch) {
    emit('net:inv', { t: 'inv', patch: true, ...patch });
  }
  function sendStats() {
    emit('net:stats', { t: 'stats', hp: Math.round(player.hp), sh: Math.round(player.sh), en: Math.round(player.en), maxHp: player.maxHp, maxSh: player.maxSh });
  }

  function damagePlayer(amount, by, kind) {
    if (player.dead) return;
    if (ctx.player?.dodging) return; // i-frames
    let a = amount;
    const fromSh = Math.min(player.sh, a);
    player.sh -= fromSh;
    a -= fromSh;
    player.hp = Math.max(0, player.hp - a);
    player.lastHit = time;
    const e = enemies.get(by);
    emit('net:damage', { t: 'damage', target: ME, by, amount, hp: Math.round(player.hp), sh: Math.round(player.sh), kind, at: e ? v3(e.view.p) : null });
    if (player.hp <= 0) {
      player.dead = true;
      player.deadAt = time;
      emit('net:death', { t: 'death', id: ME, by, at: v3(ctx.player.position), cause: kind, byType: e?.type, drop: 'l1' });
    }
  }

  function damageEnemy(e, amount, kind, at, crit = false) {
    if (!e.alive) return;
    e.hp = Math.max(0, e.hp - amount);
    e.view.hp = e.hp;
    const kill = e.hp <= 0;
    emit('net:damage', { t: 'damage', target: e.id, by: ME, amount, hp: e.hp, sh: 0, kind, at, crit, kill });
    if (e.view.s === 'idle' || e.view.s === 'patrol') e.view.s = 'chase';
    if (kill) {
      e.alive = false;
      emit('net:death', { t: 'death', id: e.id, by: ME, at: v3(e.view.p), type: e.type });
      enemies.delete(e.id);
      const home = e.home;
      const type = e.type;
      respawns.push({ at: time + 15, type, home });
    }
  }
  const respawns = [];

  function handle(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    const def = defs.byId[msg.w];
    switch (msg.t) {
      case C.FIRE: {
        if (!def || player.dead) return;
        if (inSafeZone(ctx.player.position.x, ctx.player.position.z)) {
          emit('net:deny', { t: 'deny', of: C.FIRE, reason: 'safe' });
          return;
        }
        if ((inv.mag[def.id] ?? 0) <= 0) {
          emit('net:deny', { t: 'deny', of: C.FIRE, reason: 'ammo' });
          return;
        }
        inv.mag[def.id]--;
        shots.set(msg.seq, { w: def.id, at: time });
        sendInv({ mag: { [def.id]: inv.mag[def.id] } });
        break;
      }
      case C.HIT: {
        const shot = shots.get(msg.seq);
        const e = enemies.get(msg.target);
        if (!shot || !e || !Array.isArray(msg.at)) return;
        shots.delete(msg.seq);
        const wd = defs.byId[shot.w];
        _p.set(msg.at[0], msg.at[1], msg.at[2]);
        if (_p.distanceTo(ctx.player.position) > wd.range + 5) return;
        // crit: the claim lies inside the stalker head volume
        let crit = false;
        if (e.type === 'stalker') {
          enemyVolumes(ENEMIES.stalker.volumes, e.view.p.x, e.view.p.y, e.view.p.z, e.view.h, vols);
          crit = Math.hypot(_p.x - vols[4], _p.y - vols[5], _p.z - vols[6]) < vols[7] + 0.1;
        }
        damageEnemy(e, Math.round(wd.dmg * (crit ? 1.5 : 1)), wd.id, msg.at, crit);
        break;
      }
      case C.THROW: {
        const g = defs.byId['shock-grenade'];
        if ((inv.ammo[g.ammo] ?? 0) <= 0) {
          emit('net:deny', { t: 'deny', of: C.THROW, reason: 'grenades' });
          return;
        }
        inv.ammo[g.ammo]--;
        sendInv({ ammo: { [g.ammo]: inv.ammo[g.ammo] } });
        const pts = new Float32Array(3 * 80);
        const res = simulateArc({ x: msg.o[0], y: msg.o[1], z: msg.o[2] }, { x: msg.v[0], y: msg.v[1], z: msg.v[2] }, { gravity: g.gravity, bounce: g.bounce, fuse: g.fuse, radius: 0.07, ground: getH, dt: 1 / 60 }, pts, 80);
        grenades.push({ at: time + g.fuse, x: res.x, y: res.y, z: res.z, g });
        break;
      }
      case C.RELOAD: {
        if (!def || def.kind === 'throw') return;
        reloads.push({ at: time + def.reload, def });
        break;
      }
      case C.EQUIP: {
        if (Number.isInteger(msg.slot)) {
          inv.slot = msg.slot;
          sendInv({ slot: msg.slot });
        }
        break;
      }
      case C.RESPAWN: {
        if (!player.dead || time - player.deadAt < 4.5) {
          emit('net:deny', { t: 'deny', of: C.RESPAWN, reason: 'wait' });
          return;
        }
        player.dead = false;
        player.hp = player.maxHp;
        player.sh = player.maxSh;
        const spot = msg.at === 'base' ? { x: -214, z: 342 } : msg.at === 'beacon' ? { x: 236, z: 128 } : { x: 0, z: 158 };
        emit('net:respawned', { t: 'respawned', id: ME, p: [spot.x, getH(spot.x, spot.z), spot.z], h: 0 });
        sendStats();
        break;
      }
      default:
        break;
    }
  }

  function step(dt) {
    time += dt;
    const pp = ctx.player?.position;
    if (!pp) return;
    // reloads
    for (let i = reloads.length - 1; i >= 0; i--) {
      const r = reloads[i];
      if (time < r.at) continue;
      reloads.splice(i, 1);
      const d = r.def;
      const take = Math.min(d.mag - inv.mag[d.id], inv.ammo[d.ammo]);
      inv.mag[d.id] += take;
      inv.ammo[d.ammo] -= take;
      sendInv({ mag: { [d.id]: inv.mag[d.id] }, ammo: { [d.ammo]: inv.ammo[d.ammo] } });
    }
    // grenades
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      if (time < g.at) continue;
      grenades.splice(i, 1);
      emit('net:boom', { t: 'boom', at: [r2(g.x), r2(g.y), r2(g.z)], r: g.g.radius, kind: 'shock' });
      for (const e of [...enemies.values()]) {
        const d = Math.hypot(e.view.p.x - g.x, e.view.p.y - g.y, e.view.p.z - g.z);
        if (d > g.g.radius) continue;
        e.stun = g.g.stun;
        damageEnemy(e, Math.round(g.g.dmg * (1 - (d / g.g.radius) * 0.5)), 'shock', v3(e.view.p));
      }
    }
    for (let i = respawns.length - 1; i >= 0; i--) {
      if (time < respawns[i].at) continue;
      const r = respawns.splice(i, 1)[0];
      spawn(r.type, r.home.x + (Math.random() - 0.5) * 20, r.home.z + (Math.random() - 0.5) * 20, r.home);
    }
    // player regen / drain
    const before = `${Math.round(player.hp)}|${Math.round(player.sh)}|${Math.round(player.en)}`;
    if (!player.dead) {
      if (time - player.lastHit > 4 && player.sh < player.maxSh) player.sh = Math.min(player.maxSh, player.sh + 10 * dt);
      player.en = Math.max(0, player.en - dt / 40);
    }
    if (`${Math.round(player.hp)}|${Math.round(player.sh)}|${Math.round(player.en)}` !== before) sendStats();
    const safe = inSafeZone(pp.x, pp.z);
    // AI
    for (const e of enemies.values()) {
      const v = e.view;
      const dx = pp.x - v.p.x;
      const dz = pp.z - v.p.z;
      const dist = Math.hypot(dx, dz);
      const canSee = !player.dead && !safe && ctx.modes.is('explore') && ctx.player?.onFoot !== false;
      e.cool -= dt;
      if (e.stun > 0) {
        e.stun -= dt;
        v.s = 'stunned';
        continue;
      }
      if (e.type === 'drone') {
        const gy = getH(v.p.x, v.p.z);
        let tx = e.home.x + Math.cos(time * 0.25 + e.wander) * 14;
        let tz = e.home.z + Math.sin(time * 0.25 + e.wander) * 14;
        let sp = 3;
        if (canSee && dist < 45) {
          v.s = dist < 40 ? 'attack' : 'chase';
          const k = (dist - 16) / Math.max(1, dist);
          tx = v.p.x + dx * k;
          tz = v.p.z + dz * k;
          sp = 7;
          v.h = Math.atan2(-dx, -dz);
          if (v.s === 'attack' && e.cool <= 0) {
            e.cool = 1 / 1.2;
            const o = [r2(v.p.x - Math.sin(v.h) * 0.46), r2(v.p.y - 0.25), r2(v.p.z - Math.cos(v.h) * 0.46)];
            const hitIt = Math.random() < 0.6 && !ctx.player?.dodging;
            const ax = pp.x + (hitIt ? 0 : (Math.random() - 0.5) * 6);
            const ay = pp.y + 1.2 + (hitIt ? 0 : Math.random() * 2);
            const az = pp.z + (hitIt ? 0 : (Math.random() - 0.5) * 6);
            const L = Math.hypot(ax - o[0], ay - o[1], az - o[2]) || 1;
            emit('net:efire', { t: 'efire', id: e.id, o, d: [r2((ax - o[0]) / L), r2((ay - o[1]) / L), r2((az - o[2]) / L)], w: 'laser' });
            if (hitIt) damagePlayer(6, e.id, 'laser');
          }
        } else v.s = 'patrol';
        const mx = tx - v.p.x;
        const mz = tz - v.p.z;
        const ml = Math.hypot(mx, mz);
        if (ml > 0.5) {
          v.p.x += (mx / ml) * Math.min(ml, sp * dt);
          v.p.z += (mz / ml) * Math.min(ml, sp * dt);
          if (v.s === 'patrol') v.h = Math.atan2(-mx, -mz);
        }
        v.p.y += (gy + 5.5 - v.p.y) * Math.min(1, dt * 2);
      } else {
        let sp = 0;
        let tx = v.p.x;
        let tz = v.p.z;
        if (canSee && dist < 40) {
          v.s = dist < 2.4 ? 'attack' : 'chase';
          tx = pp.x;
          tz = pp.z;
          sp = dist < 2.2 ? 0 : 9;
          v.h = Math.atan2(-dx, -dz);
          if (v.s === 'attack' && e.cool <= 0) {
            e.cool = 1.1;
            emit('net:efire', { t: 'efire', id: e.id, o: v3(v.p), d: [r2(dx / (dist || 1)), 0, r2(dz / (dist || 1))], w: 'claw' });
            damagePlayer(14, e.id, 'claw');
          }
        } else {
          v.s = 'patrol';
          e.wander += (Math.random() - 0.5) * dt;
          tx = e.home.x + Math.cos(time * 0.15 + e.wander) * 10;
          tz = e.home.z + Math.sin(time * 0.15 + e.wander) * 10;
          sp = 2.2;
        }
        const mx = tx - v.p.x;
        const mz = tz - v.p.z;
        const ml = Math.hypot(mx, mz);
        if (ml > 0.6 && sp > 0) {
          v.p.x += (mx / ml) * Math.min(ml, sp * dt);
          v.p.z += (mz / ml) * Math.min(ml, sp * dt);
          if (v.s === 'patrol') v.h = Math.atan2(-mx, -mz);
        }
        v.p.y = getH(v.p.x, v.p.z);
      }
    }
  }

  const api = {
    online: false,
    mode: 'mock',
    id: ME,
    players: new Map(),
    enemies,
    loot: new Map(),
    send: handle,
    serverTime: () => time * 1000,
    on: () => () => {},
    spawn,
    step,
    player,
    inv,
    start() {
      spawnDefaults();
      emit('net:welcome', { t: 'welcome', you: { id: ME }, inv: { ...inv, ammo: { ...inv.ammo }, mag: { ...inv.mag } }, stats: { hp: 100, sh: 50, en: 100, maxHp: 100, maxSh: 50 } });
    },
  };
  return api;
}
