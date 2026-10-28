import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './_testkit.js';
import { C, S, ES } from '../protocol.js';
import { SPAWN } from '../defs/enemies.js';
import { dayFactorAt } from './zones.js';
import { createWorldgen } from '../worldgen/index.js';
import { poiCoverLocal, ARENA_MONOLITHS } from './los.js';

const night = (h) => dayFactorAt(h) < SPAWN.nightBelow;
/** Test provider: everything outside the hub is "testland" — drones, ×2 at night. */
const droneRules = (x, z, hour) => ({ biome: 'testland', density: night(hour) ? 2 : 1, list: [{ type: 'drone', w: 1 }] });
/** Test provider: forest — a few drones by day, night-only stalkers at night. */
const forestRules = (x, z, hour) =>
  night(hour) ? { biome: 'forest', density: 1.4, list: [{ type: 'stalker', w: 1, nightOnly: true }] } : { biome: 'forest', density: 0.7, list: [{ type: 'drone', w: 1 }] };
const ofType = (k, type) => [...k.W.enemies.values()].filter((e) => e.type === type);

test('spawns follow the world provider: cap per player, ×2 at night, scaled for groups, never in the hub', () => {
  const k = makeSim({ seed: 'spawn-1', opts: { spawnRules: droneRules } });
  k.sim.setTime(10); // the default 17.6 turns into night (dayFactor < 0.25) around 17.85
  const { p } = k.join('p1', 0, 3000);
  p.m = 'car'; // in a car: counts for spawning, not targeted
  k.run(45, 0.1);
  assert.equal(k.W.enemies.size, 3, 'day cap 3');
  for (const e of k.W.enemies.values()) {
    assert.equal(e.biome, 'testland');
    assert.equal(k.sim.isSafe(e.x, e.z), false);
    assert.ok(e.y >= k.H(e.x, e.z) + 4, 'hovering');
    const d = Math.hypot(e.home.x - p.x, e.home.z - p.z);
    assert.ok(d >= SPAWN.minPlayerDist - 0.01 && d <= SPAWN.maxPlayerDist + 0.01, `spawn ring (${d.toFixed(1)})`);
  }
  k.sim.setTime(23);
  k.run(45, 0.1);
  assert.equal(k.W.enemies.size, 6, 'night ×2');
  k.sim.setTime(12);
  const a = k.join('p2', -10, 3005).p;
  const b = k.join('p3', 10, 2995).p;
  a.m = b.m = 'car';
  k.run(45, 0.1);
  assert.equal(k.W.enemies.size, 6, '3 players: ×2 by day');
  // the safe hub (and its 200 m spawn buffer): nothing spawns, even with a provider that says so
  const h = makeSim({ seed: 'spawn-hub', opts: { spawnRules: droneRules } });
  h.sim.setTime(23);
  h.join('p1', 0, 1150).p.m = 'car'; // just outside the hub square, inside the buffer
  h.join('p2', 600, 0).p.m = 'car'; // in the hub
  h.run(40, 0.1);
  for (const e of h.W.enemies.values()) assert.ok(Math.max(Math.abs(e.home.x), Math.abs(e.home.z)) >= 1100 + 200, 'outside the spawn buffer');
});

test('spawns are deterministic per seed', () => {
  const pos = (seed) => {
    const k = makeSim({ seed, opts: { spawnRules: droneRules } });
    k.join('p1', 0, 3000).p.m = 'car';
    k.run(12, 0.1);
    return [...k.W.enemies.values()].map((e) => `${e.x.toFixed(2)},${e.z.toFixed(2)}`).join(';');
  };
  const a = pos('det');
  assert.ok(a.length > 0);
  assert.equal(a, pos('det'));
  assert.notEqual(a, pos('other'));
});

test('enemies despawn when no player is near; night-only stalkers leave at daybreak', () => {
  const k = makeSim({ seed: 'despawn', opts: { spawnRules: forestRules } });
  k.sim.setTime(10);
  const { p } = k.join('p1', 0, 3000);
  p.m = 'car';
  k.run(30, 0.1);
  assert.equal(ofType(k, 'drone').length, 2, 'density 0.7 by day');
  assert.equal(ofType(k, 'stalker').length, 0, 'no stalkers by day');
  k.put(p, 0, 150); // back in the hub
  k.run(25, 0.1);
  assert.equal(k.W.enemies.size, 0, 'despawned');
  k.put(p, 0, 3000);
  k.sim.setTime(22.5);
  k.run(40, 0.1);
  assert.ok(ofType(k, 'stalker').length > 0, 'stalkers at night');
  assert.ok(ofType(k, 'stalker').every((e) => e.nightOnly));
  k.sim.setTime(9);
  k.run(25, 0.1);
  assert.equal(ofType(k, 'stalker').length, 0, 'gone at daybreak');
});

test('no spawns inside claims (stand-in world: forest / meadow / highlands south of the hub)', () => {
  const k = makeSim({ seed: 'claims' });
  assert.ok(['forest', 'meadow', 'mountains'].includes(k.sim.biomeAt(0, 2900)));
  const { p } = k.join('p1', 0, 2900);
  p.inv.res = { metal: 2999, stone: 2999, wood: 2999, energy: 2999 };
  assert.equal(k.send('p1', { t: C.BUILD_PLACE, piece: 'claim-beacon', p: [0, 10, 2900], rot: 0, cid: 1 }), true);
  p.m = 'car';
  k.sim.setTime(23);
  k.run(60, 0.1);
  assert.ok(k.W.enemies.size > 0);
  // spawn points keep the claim radius + margin free (they may fly in later)
  for (const e of k.W.enemies.values()) assert.ok(Math.hypot(e.home.x - 0, e.home.z - 2900) >= 24 + 10);
});

test('security drone: keeps its distance, strafes and shoots lasers', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  k.W.enemiesSys.endGrace(p);
  const e = k.W.enemiesSys.create('drone', 0, 2870, null);
  const dists = [];
  let leftRight = new Set();
  for (let i = 0; i < 120; i++) {
    k.run(0.1);
    dists.push(Math.hypot(e.x - p.x, e.z - p.z));
    leftRight.add(Math.sign(e.vx));
    const up = e.y - k.H(e.x, e.z);
    assert.ok(up > 4 && up < 14, `hover height ${up}`);
  }
  const late = dists.slice(40);
  const avg = late.reduce((s, d) => s + d, 0) / late.length;
  assert.ok(avg > 13 && avg < 32, `keeps 15–30 m (avg ${avg.toFixed(1)})`);
  assert.ok(leftRight.size >= 2, 'strafes');
  const shots = k.of(S.ENEMY_FIRE);
  assert.ok(shots.length >= 8, `fires ~1.2/s (${shots.length})`);
  assert.ok(shots.every((s) => s.id === e.id && s.w === 'laser'));
  assert.ok(p.hp + p.sh < 150, 'player took laser damage');
  assert.ok(k.of(S.DAMAGE, 'p1').some((d) => d.kind === 'laser' && d.by === e.id));
});

test('jungle stalker: chases, leaps and claws', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  k.W.enemiesSys.endGrace(p);
  const e = k.W.enemiesSys.create('stalker', 0, 2875, null);
  let leapt = false;
  for (let i = 0; i < 60; i++) {
    k.run(0.05);
    if (e.st === ES.LEAP) leapt = true;
  }
  assert.ok(leapt, 'leapt at the target');
  k.run(2);
  const claws = k.of(S.DAMAGE, 'p1').filter((d) => d.kind === 'claw');
  assert.ok(claws.length >= 1, 'clawed');
  assert.ok(Math.hypot(e.x - p.x, e.z - p.z) < 4);
});

test('stalkers stay out of water and follow the terrain', () => {
  const water = (x) => x > 20;
  const H = (x) => (x > 20 ? -2 : 10);
  const k = makeSim({ H, water });
  const { p } = k.join('p1', 30, 2900); // swimming target in the lake
  k.W.enemiesSys.endGrace(p);
  p.m = 'foot';
  const e = k.W.enemiesSys.create('stalker', 0, 2900, null);
  k.run(6);
  assert.ok(e.x <= 20.5, `stays on land (${e.x.toFixed(2)})`);
  assert.equal(e.y, 10);
});

test('enemies ignore players in safe zones and in their own claim by day', () => {
  const k = makeSim();
  const { p } = k.join('p1', 360, -150); // Nexus Plaza
  k.W.enemiesSys.create('drone', 360, -120, null);
  k.run(6);
  assert.equal(p.hp + p.sh, 150);
  assert.equal(k.of(S.ENEMY_FIRE).length, 0);
  // own claim: safe by day, not at night
  const k2 = makeSim();
  const { p: q } = k2.join('p1', 0, 2900);
  k2.W.enemiesSys.endGrace(q);
  q.inv.res = { metal: 2999, stone: 2999, wood: 2999, energy: 2999 };
  k2.send('p1', { t: C.BUILD_PLACE, piece: 'claim-beacon', p: [0, 10, 2895], rot: 0, cid: 1 });
  k2.sim.setTime(12);
  k2.W.enemiesSys.create('drone', 0, 2870, null);
  k2.run(5);
  assert.equal(q.hp + q.sh, 150, 'safe in own claim by day');
  k2.sim.setTime(23);
  k2.run(6);
  assert.ok(q.hp + q.sh < 150, 'night: fair game');
});

test('leash: enemies give up and return home with full health', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  k.W.enemiesSys.endGrace(p);
  const e = k.W.enemiesSys.create('stalker', 0, 2880, null);
  k.run(0.5);
  e.hp = 40;
  // drag the fight far from home
  e.x = 0;
  e.z = 2880 + 120;
  k.put(p, 0, 3005);
  k.run(1);
  assert.equal(e.target, null);
  assert.equal(e.returning, true);
  k.run(15);
  assert.equal(e.returning, false);
  assert.equal(e.hp, 90);
});

test('snapshot enemy rows: [id, type, x, y, z, h, s, hp] within the interest radius', () => {
  const k = makeSim();
  k.join('p1', 0, 2900);
  const near = k.W.enemiesSys.create('drone', 0, 2800, null);
  const far = k.W.enemiesSys.create('drone', 0, 2500, null);
  near.ai = far.ai = false;
  k.run(0.1);
  const snap = k.sim.snapshotFor('p1');
  assert.equal(snap.en.length, 1);
  const [id, type, x, , z, , s, hp] = snap.en[0];
  assert.deepEqual([id, type, x, z, typeof s, hp], [near.id, 'drone', 0, 2800, 'number', 60]);
});

test('worldgen-style tables: tuples [type, w, max, nightOnly] with per-type caps', () => {
  // (a biome without SPAWN_EXTRA, so only the provider's entries count)
  const rules = () => ({ biome: 'testland', density: 1.5, list: [['drone', 3, 4], ['stalker', 1, 2, true], ['kraken', 5, 5]] });
  const k = makeSim({ seed: 'tuples', opts: { spawnRules: rules } });
  k.sim.setTime(23);
  const { p } = k.join('p1', 0, 3000);
  p.m = 'car';
  k.run(90, 0.1);
  const d = ofType(k, 'drone').length;
  const s = ofType(k, 'stalker').length;
  assert.equal(d + s, 5, 'total cap round(3 × 1.5)');
  assert.ok(d <= 4 && s <= 2, `per-type caps (${d} drones, ${s} stalkers)`);
  assert.ok(ofType(k, 'stalker').every((e) => e.nightOnly && e.biome === 'testland'));
});

// ---------------------------------------------------------------- threats wave: fairness, AI, raiders, mites, boss
import { ENEMIES, BOSS, GRACE, FLAG, wardenParts } from '../defs/enemies.js';
import { ITEMS } from '../defs/items.js';

const fresh = (k, id, x, z) => {
  const r = k.join(id, x, z);
  k.W.enemiesSys.endGrace(r.p);
  return r;
};
/** Teleport within a test without triggering a new arrival grace. */
const move = (k, p, x, z) => {
  k.put(p, x, z);
  k.W.enemiesSys.endGrace(p);
};
const fires = (k, id, w) => k.of(S.ENEMY_FIRE).filter((m) => (id == null || m.id === id) && (w == null || m.w === w));
/** One shot (pistol by default) from p at a world point, claimed as a hit on `target`. */
function shootAt(k, p, target, at, seq, w = 'pulse-pistol') {
  const o = [p.x, p.y + 1.45, p.z];
  const d = [at[0] - o[0], at[1] - o[1], at[2] - o[2]];
  k.send(p.id, { t: C.FIRE, w, o, d, seq, ct: k.clock.t, vt: k.clock.t });
  return k.send(p.id, { t: C.HIT, seq, target, at });
}

test('arrival grace: no targeting right after arriving (shooting ends it); travel arrivals pause spawns nearby', () => {
  const k = makeSim({ opts: { spawnRules: droneRules } });
  k.sim.setTime(12);
  const { p } = k.join('p1', 0, 2900);
  const e = k.W.enemiesSys.create('drone', 0, 2875, null);
  k.run(GRACE.arrive - 1);
  assert.equal(e.target, null, 'no target during the grace');
  assert.equal(fires(k, e.id).length, 0);
  // the player opens fire: grace over, the drone engages
  p.inv.ammo.pulse = 60;
  shootAt(k, p, e.id, [e.x, e.y, e.z], 1);
  k.run(1);
  assert.equal(e.target, p);
  // a Gateway arrival elsewhere: no spawns around the newcomer for GRACE.spawnFree seconds
  const k2 = makeSim({ seed: 'quiet', opts: { spawnRules: droneRules } });
  k2.sim.setTime(12);
  const { p: q } = k2.join('p1', 0, 3000);
  q.m = 'car';
  k2.run(0.05);
  q.lastTpAt = k2.clock.t; // what travel.arrive() does
  for (const e of [...k2.W.enemies.values()]) k2.W.enemiesSys.destroy(e);
  k2.run(GRACE.spawnFree - 2, 0.1);
  assert.equal(k2.W.enemies.size, 0, 'quiet after arriving');
  k2.run(20, 0.1);
  assert.ok(k2.W.enemies.size > 0, 'spawns resume');
});

test('drone lasers are telegraphed (charge-up) and a well-timed roll avoids the hit', () => {
  const k = makeSim();
  const { p } = fresh(k, 'p1', 0, 2900);
  const e = k.W.enemiesSys.create('drone', 0, 2880, null);
  e.def = { ...e.def, attack: { ...e.def.attack, accuracy: 1, minAccuracy: 1 } }; // every shot hits
  k.run(4);
  const all = fires(k, e.id, 'laser');
  const charge = all.find((m) => m.phase === 'charge');
  assert.ok(charge, 'charge-up announced');
  assert.equal(charge.ct, ENEMIES.drone.attack.charge);
  const iCharge = k.log.findIndex((o) => o.msg === charge);
  const iShot = k.log.findIndex((o, i) => i > iCharge && o.msg.t === S.ENEMY_FIRE && o.msg.id === e.id && !o.msg.phase);
  assert.ok(iShot > iCharge, 'the shot follows its charge');
  const hits = k.of(S.DAMAGE, 'p1').filter((d) => d.by === e.id);
  assert.ok(hits.length >= 1, 'undodged shots hurt');
  // roll just before each shot lands (the tell is the charge-up) → dodged, no damage
  k.clear();
  p.hp = p.maxHp;
  p.sh = p.maxSh;
  const hp0 = p.hp + p.sh;
  let chargeAt = -1;
  for (let i = 0; i < 120; i++) {
    if (fires(k, e.id, 'laser').some((m) => m.phase === 'charge' && !m.seen)) {
      for (const m of fires(k, e.id, 'laser')) m.seen = true;
      chargeAt = k.clock.t;
    }
    p.a = chargeAt > 0 && k.clock.t - chargeAt >= 350 && k.clock.t - chargeAt < 400 ? 'dodge' : 'idle';
    k.run(0.05);
  }
  const dodges = k.of(S.EVENT, 'p1').filter((m) => m.kind === 'dodged').length;
  assert.ok(dodges >= 2, `dodged events (${dodges})`);
  assert.equal(p.hp + p.sh, hp0, 'rolling through the shots avoids the damage');
});

test('gunfire draws enemies: an idle stalker within earshot engages, a rifle carries farther', () => {
  const k = makeSim();
  const { p } = fresh(k, 'p1', 0, 2900);
  const near = k.W.enemiesSys.create('stalker', 0, 2900 - 46, null); // beyond its 42 m aggro, inside the pistol's noise
  const far = k.W.enemiesSys.create('drone', 58, 2900, null); // beyond the pistol's noise (48 m)
  near.ai = far.ai = false;
  k.run(0.5);
  assert.equal(near.target, null);
  near.ai = far.ai = true;
  p.inv.ammo.pulse = 60;
  k.send('p1', { t: C.FIRE, w: 'pulse-pistol', o: [p.x, p.y + 1.45, p.z], d: [1, 0, 0], seq: 1, ct: k.clock.t });
  assert.equal(near.target, p, 'heard the shot');
  assert.equal(far.target, null, 'too far for a pistol');
  p.inv.weapons.push('plasma-rifle');
  p.inv.mag['plasma-rifle'] = 24;
  k.wait(400);
  k.send('p1', { t: C.FIRE, w: 'plasma-rifle', o: [p.x, p.y + 1.45, p.z], d: [1, 0, 0], seq: 2, ct: k.clock.t });
  assert.ok(far.target === p || far.investigate, 'the rifle is heard farther away');
});

test('stalker packs: the first one to see you howls, the pack joins', () => {
  const k = makeSim();
  const { p } = fresh(k, 'p1', 0, 2900);
  const a = k.W.enemiesSys.create('stalker', 0, 2870, null); // sees the player (30 m)
  const b = k.W.enemiesSys.create('stalker', 18, 2835, null); // ~68 m: out of its own aggro
  k.run(0.6);
  assert.equal(a.target, p);
  assert.ok(fires(k, a.id, 'howl').length === 1, 'howl');
  k.run(2);
  assert.equal(b.target, p, 'the pack joined');
});

test('raider squads: spawn whole in the badlands, aim before every burst, take cover / plant barriers, flank, fall back', () => {
  const rules = (x, z, h) => ({ biome: 'badlands', density: 1, list: [{ type: 'drone', w: 0.001 }] });
  const k = makeSim({ seed: 'raiders', opts: { spawnRules: rules } });
  k.sim.setTime(12);
  const { p: watcher } = k.join('p0', 0, 3200);
  watcher.m = 'car';
  k.run(25, 0.1);
  const raiders = ofType(k, 'raider');
  assert.ok(raiders.length >= 2, `a squad spawned (${raiders.length})`);
  assert.ok(raiders.every((r) => r.squad && r.squad === raiders[0].squad), 'one squad');
  // a fight on open, flat ground
  const f = makeSim({ seed: 'raid-fight' });
  const { p } = fresh(f, 'p1', 0, 2900);
  const squad = f.W.enemiesSys.spawnSquad('raider', 0, 2872, 4);
  assert.equal(squad.length, 4);
  let crouched = false;
  let flanked = false;
  for (let i = 0; i < 300; i++) {
    f.run(0.05);
    p.hp = p.maxHp; // keep the fight going
    if (squad.some((r) => r.flags & FLAG.CROUCH)) crouched = true;
    if (squad[0].squad?.flanker) flanked = true;
  }
  const bolts = fires(f, null, 'bolt');
  const aims = fires(f, null, 'aim');
  assert.ok(aims.length >= 3 && bolts.length >= 6, `aims ${aims.length}, bolts ${bolts.length}`);
  // every burst is announced by the same raider's aim line
  for (const b of bolts.slice(0, 6)) {
    const ib = f.log.findIndex((o) => o.msg === b);
    assert.ok(f.log.slice(0, ib).some((o) => o.msg.t === S.ENEMY_FIRE && o.msg.w === 'aim' && o.msg.id === b.id), 'aim before bolts');
  }
  assert.ok(ofType(f, 'barrier').length >= 1 || crouched, 'cover: a barrier on flat ground (or crouching)');
  assert.ok(flanked, 'a flanker was sent');
  assert.ok(f.of(S.DAMAGE, 'p1').some((d) => d.kind === 'bolt'), 'bolts hurt');
  // hurt → falls back
  const r0 = squad.find((r) => f.W.enemies.has(r.id));
  f.W.enemiesSys.damage(r0, r0.hp - 20, p, 'plasma-rifle', [r0.x, r0.y + 1, r0.z]);
  f.run(0.2);
  assert.ok(r0.retreatUntil > f.clock.t, 'retreating');
});

test('raider barriers block shots until they are shot down', () => {
  const k = makeSim();
  const { p } = fresh(k, 'p1', 0, 2900);
  p.inv.ammo.pulse = 60;
  const r = k.W.enemiesSys.create('raider', 0, 2884, null);
  r.ai = false;
  const b = k.W.enemiesSys.create('barrier', 0, 2888, { h: 0 }); // the wall stands across the line of fire
  k.run(0.1);
  assert.equal(shootAt(k, p, r.id, [r.x, r.y + 1.0, r.z], 1), false);
  assert.equal(k.lastDeny('p1').reason, 'blocked');
  let seq = 2;
  while (k.W.enemies.has(b.id) && seq < 30) {
    k.wait(300);
    shootAt(k, p, b.id, [b.x, b.y + 0.75, b.z + 0.2], seq++);
  }
  assert.equal(k.W.enemies.has(b.id), false, 'barrier destroyed');
  assert.ok(k.of(S.DEATH).some((m) => m.id === b.id && m.type === 'barrier' && !m.drop), 'no loot from a barrier');
  k.wait(300);
  assert.equal(shootAt(k, p, r.id, [r.x, r.y + 1.0, r.z], seq++), true, 'the raider is exposed');
});

test('crystal mites: highland swarms, they surround and bite', () => {
  const rules = (x, z, h) => ({ biome: 'highlands', density: 1, list: [{ type: 'drone', w: 0.001 }] });
  const k = makeSim({ seed: 'mites', opts: { spawnRules: rules } });
  k.sim.setTime(12);
  k.join('p0', 0, 3200).p.m = 'car';
  k.run(25, 0.1);
  assert.ok(ofType(k, 'mite').length >= 4, 'a swarm spawned');
  const f = makeSim();
  const { p } = fresh(f, 'p1', 0, 2900);
  const swarm = f.W.enemiesSys.spawnSquad('mite', 0, 2884, 5);
  for (let i = 0; i < 120; i++) {
    f.run(0.05);
    p.hp = p.maxHp;
  }
  const bites = f.of(S.DAMAGE, 'p1').filter((d) => d.kind === 'bite');
  assert.ok(bites.length >= 4, `bites ${bites.length}`);
  const sides = new Set(swarm.filter((m) => Math.hypot(m.x - p.x, m.z - p.z) < 3).map((m) => Math.round(Math.atan2(m.z - p.z, m.x - p.x) / 1.2)));
  assert.ok(sides.size >= 2, 'surrounding (several sides)');
});

test('De Wachter: dormant until approached, telegraphed stomp + beam, rune weak points, phases, loot per fighter, respawn timer', () => {
  const k = makeSim({ seed: 'boss' });
  const S0 = BOSS.site;
  const { p } = fresh(k, 'p1', S0.x - 300, S0.z);
  k.run(1.2);
  const boss = k.W.enemiesSys.boss;
  assert.ok(boss && boss.type === 'warden', 'the boss loads when a player is near');
  assert.equal(boss.mode, 'dormant');
  // walk up to it: wakes, boss bar event
  move(k, p, S0.x - 40, S0.z);
  k.run(0.5);
  assert.equal(boss.mode, 'waking');
  const start = k.of(S.EVENT).find((m) => m.kind === 'boss' && m.phase === 'start');
  assert.ok(start && start.maxHp === ENEMIES.warden.hp && start.name.en === 'De Wachter');
  k.run(BOSS.wakeTime + 0.2);
  assert.equal(boss.mode, 'fight');
  // close in: a stomp wind-up, then the shockwave
  move(k, p, boss.x - 9, boss.z);
  k.clear();
  for (let i = 0; i < 200 && !k.of(S.DAMAGE, 'p1').some((d) => d.kind === 'stomp'); i++) {
    k.run(0.05);
    p.hp = p.maxHp;
  }
  assert.ok(fires(k, boss.id, 'stomp').some((m) => m.phase === 'windup' && m.ct > 0.5), 'stomp telegraph');
  assert.ok(k.of(S.DAMAGE, 'p1').some((d) => d.kind === 'stomp'), 'shockwave hits a standing player');
  // jump the next one
  k.clear();
  for (let i = 0; i < 260 && !k.of(S.EVENT, 'p1').some((m) => m.kind === 'dodged' && m.w === 'stomp'); i++) {
    p.a = 'jump';
    k.run(0.05);
    p.hp = p.maxHp;
  }
  assert.ok(k.of(S.EVENT, 'p1').some((m) => m.kind === 'dodged' && m.w === 'stomp'), 'jumped over the wave');
  p.a = 'idle';
  // at range: the sweeping eye beam
  move(k, p, boss.x - 45, boss.z);
  k.clear();
  for (let i = 0; i < 400 && !k.of(S.DAMAGE, 'p1').some((d) => d.kind === 'beam'); i++) {
    k.run(0.05);
    p.hp = p.maxHp;
  }
  const bw = fires(k, boss.id, 'beam')[0];
  assert.ok(bw && bw.phase === 'windup' && Number.isFinite(bw.a0) && bw.dur > 0, 'beam telegraph');
  assert.ok(k.of(S.DAMAGE, 'p1').some((d) => d.kind === 'beam'), 'the beam burns');
  // the chest rune: a validated weak-point hit (bonus damage)
  p.inv.weapons.push('railgun');
  p.inv.mag.railgun = 4;
  boss.mode = 'fight';
  boss.beam = null;
  const parts = new Float64Array(14 * 5);
  k.run(0.1);
  wardenParts(boss.x, boss.y, boss.z, boss.h, parts, boss.kneel);
  const chest = [parts[11 * 5], parts[11 * 5 + 1], parts[11 * 5 + 2] ];
  move(k, p, boss.x - Math.sin(boss.h) * 30, boss.z - Math.cos(boss.h) * 30);
  k.clear();
  k.wait(1500);
  shootAt(k, p, boss.id, [chest[0] - Math.sin(boss.h) * 1.2, chest[1], chest[2] - Math.cos(boss.h) * 1.2], 900, 'railgun');
  const weak = k.of(S.DAMAGE, 'p1').find((d) => d.target === boss.id);
  assert.ok(weak && weak.weak === 1 && weak.amount > 75 * 2, `weak point damage (${JSON.stringify(weak)})`);
  // break the rune → stagger + rune event
  k.W.enemiesSys.damage(boss, 400, p, 'railgun', chest, { weak: 1 });
  assert.equal(boss.mode, 'stagger');
  assert.ok(k.of(S.EVENT).some((m) => m.kind === 'boss' && m.phase === 'rune' && m.rune === 1));
  k.run(ENEMIES.warden.rune.stagger + 0.2);
  // phase 2 → drones join
  k.W.enemiesSys.damage(boss, boss.hp - boss.maxHp * 0.6, p, 'railgun', chest);
  assert.equal(boss.phase, 2);
  assert.ok(k.of(S.EVENT).some((m) => m.kind === 'boss' && m.phase === 'phase' && m.n === 2));
  move(k, p, boss.x - 30, boss.z);
  for (let i = 0; i < 160 && !fires(k, boss.id, 'summon').length; i++) {
    k.run(0.05);
    p.hp = p.maxHp;
  }
  assert.ok(fires(k, boss.id, 'summon').length, 'summons');
  assert.ok([...k.W.enemies.values()].some((e) => e.summoned === boss.id));
  // down it goes: an owner-only crate for the fighter, the world hears it, respawn timer
  k.clear();
  k.W.enemiesSys.damage(boss, 1e6, p, 'railgun', chest);
  const end = k.of(S.EVENT).find((m) => m.kind === 'boss' && m.phase === 'end' && m.result === 'defeated');
  assert.ok(end && end.respawnAt > k.clock.t + 60000, 'defeated + respawn time');
  const crate = [...k.W.loot.map.values()].find((l) => l.kind === 'boss');
  assert.ok(crate && crate.owner === 'p1' && crate.items.credits > 0, 'boss crate');
  assert.ok(![...k.W.enemies.values()].some((e) => e.summoned), 'its drones fall with it');
  k.run(3);
  assert.equal(k.W.enemiesSys.boss, null, 'no instant respawn');
});

test('De Wachter\'s arena: the monoliths block the eye beam (hide behind one), out in the open it burns', () => {
  const k = makeSim({ seed: 'arena' });
  const [a, r] = ARENA_MONOLITHS[2]; // the tallest one
  const at = (ang, rad) => [BOSS.site.x + Math.sin(ang) * rad, BOSS.site.z + Math.cos(ang) * rad];
  const { p } = fresh(k, 'p1', ...at(a, r + 3));
  const beamHits = () => k.of(S.DAMAGE).filter((m) => m.target === 'p1' && m.kind === 'beam').length;
  for (let i = 0; i < 300; i++) {
    k.run(0.1, 0.1);
    p.hp = p.maxHp;
    p.sh = p.maxSh;
  }
  assert.equal(k.W.enemiesSys.boss?.mode, 'fight', 'awake');
  assert.ok(k.of(S.ENEMY_FIRE).some((m) => m.w === 'beam'), 'it fired its beam');
  assert.equal(beamHits(), 0, 'safe behind the monolith');
  move(k, p, ...at(a + 0.55, r + 3));
  for (let i = 0; i < 300 && !beamHits(); i++) {
    k.run(0.1, 0.1);
    p.hp = p.maxHp;
    p.sh = p.maxSh;
  }
  assert.ok(beamHits() > 0, 'the beam finds you in the open');
});

test('De Wachter resets when everyone leaves', () => {
  const k = makeSim({ seed: 'boss-reset' });
  const { p } = fresh(k, 'p1', BOSS.site.x - 40, BOSS.site.z);
  k.run(1.5);
  const boss = k.W.enemiesSys.boss;
  k.run(BOSS.wakeTime + 0.5);
  k.W.enemiesSys.damage(boss, 500, p, 'railgun', [boss.x, boss.y + 12, boss.z]);
  move(k, p, BOSS.site.x - 400, BOSS.site.z);
  k.run(BOSS.resetAfter + 2);
  assert.equal(boss.mode, 'dormant');
  assert.equal(boss.hp, ENEMIES.warden.hp);
  assert.ok(k.of(S.EVENT).some((m) => m.kind === 'boss' && m.phase === 'end' && m.result === 'reset'));
});

test('POI garrisons: an outpost is guarded by a raider squad; wiping it out drops a supply cache', () => {
  const k = makeSim({ seed: 'garrison' });
  k.W.world.poisNear = () => [{ id: 'p:test', type: 'outpost', x: 0, z: 2700, radius: 30 }];
  const { p } = fresh(k, 'p1', 0, 2900);
  k.run(2.5);
  const guards = [...k.W.enemies.values()].filter((e) => e.garrison === 'p:test');
  assert.ok(guards.length >= 3 && guards.every((g) => g.type === 'raider'), `garrison (${guards.length})`);
  assert.ok(guards.some((g) => g.elite), 'a captain');
  for (const g of guards) k.W.enemiesSys.damage(g, 1e4, p, 'railgun', [g.x, g.y + 1, g.z]);
  const ev = k.of(S.EVENT).find((m) => m.kind === 'poi' && m.phase === 'cleared');
  assert.ok(ev && ev.drop, 'cleared + cache');
  const cache = k.W.loot.get(ev.drop);
  assert.equal(cache.kind, 'cache');
  assert.ok(cache.items.credits > 0);
  k.run(5);
  assert.equal([...k.W.enemies.values()].filter((e) => e.garrison === 'p:test').length, 0, 'stays cleared');
});

test('garrisons use the real generator\'s POIs (the world provider has no poisNear); roaming raider squads stay off it', () => {
  const wg = createWorldgen({ seed: 'o-universe', hub: { heightAt: () => 10, isWater: () => false, radius: 1100, blend: 300 } });
  let poi = null;
  for (let x = 2400; x <= 9000 && !poi; x += 500) for (let z = -3000; z <= 3000 && !poi; z += 500) poi = wg.poisNear(x, z, 400).find((q) => q.type === 'outpost') || null;
  assert.ok(poi, 'an outpost east of the hub');
  const k = makeSim({ H: (x, z) => wg.heightAt(x, z), water: (x, z) => wg.isWater(x, z), seed: 'o-universe', opts: { worldgen: wg } });
  const { p } = fresh(k, 'p1', poi.x + 150, poi.z);
  k.run(4);
  const guards = [...k.W.enemies.values()].filter((e) => e.garrison === poi.id);
  assert.ok(guards.length >= 3 && guards.every((g) => g.type === 'raider'), `garrison at ${poi.id} (${guards.length})`);
  assert.ok(guards.every((g) => Math.hypot(g.x - poi.x, g.z - poi.z) < 40), 'they guard the outpost');
  // later spawns around the player never add another raider squad on top of the garrison
  const before = new Set(k.W.enemies.keys());
  for (let i = 0; i < 40; i++) {
    k.run(1);
    p.hp = p.maxHp;
  }
  const extra = [...k.W.enemies.values()].filter((e) => !before.has(e.id) && e.type === 'raider' && !e.garrison && Math.hypot(e.home.x - poi.x, e.home.z - poi.z) < 200);
  assert.equal(extra.length, 0, 'no roaming raiders spawned inside the garrison\'s ground');
});

test('outpost structures: raiders take cover behind huts / palisade / crates, lean out to shoot, never through walls', () => {
  const k = makeSim({ seed: 'cover' });
  const poi = { id: 'p:cover', type: 'outpost', variant: 1, x: 0, y: 10, z: 2700, rot: 0.4, radius: 30 };
  k.W.world.poisNear = () => [poi];
  const { p } = fresh(k, 'p1', 0, 2700 + 27);
  const sides = new Set();
  for (let i = 0; i < 60; i++) {
    k.run(0.5);
    p.hp = p.maxHp;
    p.sh = p.maxSh;
    for (const e of k.W.enemies.values()) if (e.type === 'raider' && e.cover?.[3] != null) sides.add(e.id);
  }
  const raiders = [...k.W.enemies.values()].filter((e) => e.type === 'raider');
  assert.ok(raiders.length >= 3, 'garrison');
  assert.ok(sides.size >= 1, `some raiders lean out from tall cover (${sides.size})`);
  const bolts = k.of(S.ENEMY_FIRE).filter((m) => m.w === 'bolt' && m.hit);
  assert.ok(bolts.length > 0, 'they do shoot');
  for (const b of bolts) assert.ok(!k.W.enemiesSys.coverBlocked(b.o[0], b.o[1], b.o[2], p.x, p.y + 1.2, p.z), 'a hit never goes through a wall');
  // the player's shots through a wall are refused
  const r = raiders[0];
  const wall = poiCoverLocal('outpost', 1)[0]; // hut 0
  const c = Math.cos(poi.rot);
  const sn = Math.sin(poi.rot);
  const hx = poi.x + wall[0] * c + wall[2] * sn;
  const hz = poi.z - wall[0] * sn + wall[2] * c;
  k.W.enemiesSys.destroy(r);
  const e = k.W.enemiesSys.create('raider', hx + (hx - p.x) * 0.25, hz + (hz - p.z) * 0.25);
  e.ai = false;
  k.run(0.3);
  const o = [p.x, p.y + 1.5, p.z];
  const at = [e.x, e.y + 1.2, e.z];
  const d = [at[0] - o[0], at[1] - o[1], at[2] - o[2]];
  const l = Math.hypot(...d);
  assert.ok(k.W.enemiesSys.coverBlocked(...o, ...at), 'the line runs through the hut');
  k.send('p1', { t: C.FIRE, w: 'pulse-pistol', o, d: d.map((v) => v / l), seq: 77, vt: k.clock.t });
  k.clear();
  k.send('p1', { t: C.HIT, seq: 77, target: e.id, at });
  const deny = k.of(S.DENY).find((m) => m.of === C.HIT);
  assert.equal(deny?.reason, 'blocked', 'shot through the hut refused');
  assert.equal(e.hp, e.maxHp);
});

test('night hunts: announced first, then a group tracks the player', () => {
  // a forest where ordinary spawns are (almost) off, so only the hunt shows up
  const quiet = () => ({ biome: 'forest', density: 0.01, list: [{ type: 'stalker', w: 1, nightOnly: true }] });
  const k = makeSim({ seed: 'hunt', opts: { spawnRules: quiet } });
  k.sim.setTime(23);
  const { p } = fresh(k, 'p1', 0, 2900);
  for (let i = 0; i < 950; i++) {
    k.run(0.1, 0.1);
    p.hp = p.maxHp; // stay alive: the hunt follows a living quarry
  }
  const ev = k.of(S.EVENT, 'p1').find((m) => m.kind === 'hunt' && m.phase === 'start');
  assert.ok(ev, 'hunt announced');
  const hunters = [...k.W.enemies.values()].filter((e) => e.hunt === 'p1' || e.target === p);
  assert.ok(hunters.length >= 1, 'hunters on the trail');
  assert.ok(Math.hypot(ev.from[0] - p.x, ev.from[1] - p.z) > 60, 'they start far away');
});

test('loot by danger: night kills pay more; unknown item ids never end up in crates', () => {
  const total = (hour) => {
    const k = makeSim({ seed: 'loot' });
    k.sim.setTime(hour);
    const { p } = k.join('p1', 0, 2900);
    let metal = 0;
    for (let i = 0; i < 30; i++) {
      const e = k.W.enemiesSys.create('raider', 20, 2880 + i, null);
      e.ai = false;
      k.W.enemiesSys.damage(e, 1e4, p, 'railgun', [e.x, e.y + 1, e.z]);
      const d = k.of(S.DEATH).find((m) => m.id === e.id);
      const l = k.W.loot.get(d.drop);
      metal += l.items.res?.metal || 0;
      for (const id of Object.keys(l.items.items || {})) assert.ok(ITEMS[id], `known item ${id}`);
    }
    return metal;
  };
  assert.ok(total(23) > total(12) * 1.1, 'night bonus');
});
