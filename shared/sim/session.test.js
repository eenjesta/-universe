import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './_testkit.js';
import { C, S, NET, PROTOCOL_VERSION } from '../protocol.js';
import { START } from '../defs/items.js';

test('welcome payload, S.JOIN to the others, S.LEAVE on remove', () => {
  const k = makeSim();
  const a = k.join('p1', 0, 2900, { name: 'Alice' }).welcome;
  assert.equal(a.t, S.WELCOME);
  assert.equal(a.v, PROTOCOL_VERSION);
  assert.equal(a.you.id, 'p1');
  assert.equal(a.you.name, 'Alice');
  assert.equal(a.world.players.length, 0);
  assert.ok(typeof a.world.time === 'number' && typeof a.world.dayFactor === 'number');
  assert.deepEqual(a.inv.res, START.res);
  assert.deepEqual(a.inv.weapons, ['pulse-pistol']);
  assert.equal(a.stats.hp, 100);
  assert.ok(Array.isArray(a.structures) && Array.isArray(a.claims) && Array.isArray(a.loot) && Array.isArray(a.nodes));
  // fresh players start at the Overlook
  assert.ok(Math.hypot(a.you.p[0], a.you.p[2] - 150) < 45);
  k.clear();
  const b = k.join('p2', 10, 2900, { name: 'Bob' }).welcome;
  assert.deepEqual(b.world.players.map((p) => p.id), ['p1']);
  const joins = k.flush().filter((o) => o.msg.t === S.JOIN);
  assert.deepEqual(joins.map((o) => [o.to, o.msg.id, o.msg.name]), [['p1', 'p2', 'Bob']]);
  assert.equal(k.sim.setProfile('p2', { name: 'Bobby' }), true);
  assert.equal(k.of(S.JOIN, 'p1').pop().name, 'Bobby');
  k.clear();
  const save = k.sim.removePlayer('p2');
  assert.ok(save && save.inv && save.p);
  const leave = k.flush().find((o) => o.msg.t === S.LEAVE);
  assert.deepEqual([leave.to, leave.msg.id], ['*', 'p2']);
  assert.equal(k.sim.removePlayer('p2'), null);
});

test('player saves round-trip position, stats, inventory and unlocks', () => {
  const k = makeSim();
  const { p } = k.join('p1', 30, 2880);
  p.hp = 64;
  p.inv.res.metal = 321;
  p.inv.credits = 777;
  p.inv.weapons.push('plasma-rifle');
  p.inv.mag['plasma-rifle'] = 5;
  p.inv.unlocks.push('outfit-nomad');
  const save = JSON.parse(JSON.stringify(k.sim.exportPlayer('p1')));
  k.sim.removePlayer('p1');
  const w = k.sim.addPlayer({ id: 'p1', name: 'p1', save });
  assert.deepEqual(w.you.p.map(Math.round), [30, 10, 2880]);
  assert.equal(w.stats.hp, 64);
  assert.equal(w.inv.res.metal, 321);
  assert.equal(w.inv.credits, 777);
  assert.deepEqual(w.inv.weapons, ['pulse-pistol', 'plasma-rifle']);
  assert.equal(w.inv.mag['plasma-rifle'], 5);
  assert.deepEqual(w.inv.unlocks, ['outfit-nomad']);
  // garbage saves are sanitised
  const w2 = k.sim.addPlayer({ id: 'p9', name: 'x', save: { p: ['a'], inv: { res: { metal: -5, gold: 9 }, weapons: ['nuke'], credits: 'lots' }, stats: { hp: 1e9 } } });
  assert.equal(w2.inv.res.metal, 0);
  assert.deepEqual(w2.inv.weapons, ['pulse-pistol']);
  assert.equal(w2.inv.credits, 0);
  assert.equal(w2.stats.hp, 100);
});

test('snapshots: interest radius, self excluded, rows and time of day', () => {
  const k = makeSim();
  k.join('p1', 0, 2900);
  k.join('p2', 0, 2900 - 200);
  k.join('p3', 0, 2900 - 300); // beyond 260 m from p1
  k.run(0.1);
  const s1 = k.sim.snapshotFor('p1');
  assert.equal(s1.t, S.SNAP);
  assert.equal(s1.st, k.clock.t);
  assert.ok(typeof s1.tod === 'number');
  assert.deepEqual(s1.pl.map((r) => r[0]), ['p2']);
  const row = s1.pl[0];
  assert.equal(row.length, 11); // [id, x, y, z, h, a, m, hp, sh, veh | 0, weapon]
  assert.deepEqual(row.slice(5, 9), ['idle', 'foot', 100, 50]);
  assert.equal(row[9], 0);
  assert.equal(typeof row[10], 'string');
  const s2 = k.sim.snapshotFor('p2');
  assert.deepEqual(s2.pl.map((r) => r[0]).sort(), ['p1', 'p3']);
  assert.equal(k.sim.snapshotFor('nobody'), null);
  // vehicles ride along in the row
  k.send('p2', { t: C.STATE, p: [0, 10, 2701], h: 1, v: [0, 0, 0], a: 'drive', m: 'car', veh: { type: 'car', p: [0, 10.5, 2701], h: 1 } });
  k.run(0.05);
  const r2 = k.sim.snapshotFor('p1').pl[0];
  assert.deepEqual(r2[9], { type: 'car', p: [0, 10.5, 2701], h: 1 });
  assert.deepEqual(k.sim.recipients({ near: [0, 2900, 150] }), ['p1']);
  assert.deepEqual(k.sim.recipients('*').sort(), ['p1', 'p2', 'p3']);
  assert.deepEqual(k.sim.playersNear(0, 2650, 120).sort(), ['p2', 'p3']);
});

test('movement validation: speed caps per mode, teleports, bounds, dead players', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const state = (x, z, m = 'foot', extra = {}) => k.send('p1', { t: C.STATE, p: [x, 10, z], h: 0, v: [0, 0, 0], a: 'run', m, ...extra });
  // 1/15 s later, 0.7 m: fine
  k.wait(1000 / NET.STATE_HZ);
  assert.equal(state(0, 2899.3), true);
  // 30 m in one message on foot: corrected
  k.wait(1000 / NET.STATE_HZ);
  assert.equal(state(0, 2869), false);
  const c = k.of(S.CORRECT, 'p1').pop();
  assert.equal(c.reason, 'speed');
  assert.deepEqual(c.p.map(Math.round), [0, 10, 2899]);
  // positions far from the correction are ignored for a moment (no spam)
  k.wait(70);
  state(0, 2860);
  assert.equal(k.of(S.CORRECT, 'p1').length, 1);
  assert.ok(Math.abs(p.z - 2899.3) < 0.01);
  // in a car 5 m per message is fine
  k.wait(2100);
  for (let i = 1; i <= 5; i++) {
    k.wait(1000 / NET.STATE_HZ);
    assert.equal(state(0, 2899.3 - i * 4.5, 'car'), true);
  }
  // fast travel with tp near a travel destination (the ruins)
  k.wait(3100);
  assert.equal(state(250, 100, 'foot', { tp: 1 }), true);
  assert.equal(p.x, 250);
  // tp to a random spot is refused
  k.wait(3100);
  assert.equal(state(-2900, 2900, 'foot', { tp: 1 }), false);
  // the world is infinite (5 km out is fine), coordinates beyond WORLD_LIMIT are not
  k.wait(600);
  assert.equal(state(95000, 100), false);
  assert.equal(k.of(S.CORRECT, 'p1').pop().reason, 'bounds');
  // garbage
  assert.equal(k.send('p1', { t: C.STATE, p: 'nope' }), false);
  assert.equal(k.send('p1', null), false);
  assert.equal(k.send('p1', { t: 'bogus' }), false);
});

test('space round trip: leaving keeps the planet position, landing at the spaceport is allowed', () => {
  const k = makeSim();
  const { p } = k.join('p1', 470, 250);
  k.wait(100);
  k.send('p1', { t: C.STATE, p: [0, 5000 - 4000, 0], h: 0, v: [0, 0, 0], a: 'idle', m: 'space' });
  assert.equal(p.m, 'space');
  assert.deepEqual([Math.round(p.x), Math.round(p.z)], [470, 250]);
  k.wait(5000);
  assert.equal(k.send('p1', { t: C.STATE, p: [432, 14, 222], h: 0, v: [0, 0, 0], a: 'idle', m: 'foot' }), true);
  assert.deepEqual([p.x, p.z, p.m], [432, 222, 'foot']);
});
