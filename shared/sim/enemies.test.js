import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './_testkit.js';
import { C, S, ES } from '../protocol.js';
import { SPAWN } from '../defs/enemies.js';
import { dayFactorAt } from './zones.js';

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
  const rules = () => ({ biome: 'highlands', density: 1.5, list: [['drone', 3, 4], ['stalker', 1, 2, true], ['kraken', 5, 5]] });
  const k = makeSim({ seed: 'tuples', opts: { spawnRules: rules } });
  k.sim.setTime(23);
  const { p } = k.join('p1', 0, 3000);
  p.m = 'car';
  k.run(90, 0.1);
  const d = ofType(k, 'drone').length;
  const s = ofType(k, 'stalker').length;
  assert.equal(d + s, 5, 'total cap round(3 × 1.5)');
  assert.ok(d <= 4 && s <= 2, `per-type caps (${d} drones, ${s} stalkers)`);
  assert.ok(ofType(k, 'stalker').every((e) => e.nightOnly && e.biome === 'highlands'));
});
