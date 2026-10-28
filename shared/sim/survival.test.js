import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './_testkit.js';
import { C, S } from '../protocol.js';
import { damagePlayer } from './players.js';
import { SURVIVAL } from '../defs/items.js';

test('damage takes the shield first, the shield regenerates after 4 s', () => {
  const k = makeSim();
  const { p } = k.join('p1');
  k.clear();
  damagePlayer(k.W, p, 30, 'e1', 'laser', null);
  assert.equal(p.sh, 20);
  assert.equal(p.hp, 100);
  damagePlayer(k.W, p, 30, 'e1', 'laser', null);
  assert.equal(p.sh, 0);
  assert.equal(p.hp, 90);
  const dmg = k.of(S.DAMAGE, 'p1');
  assert.equal(dmg.length, 2);
  assert.deepEqual([dmg[1].hp, dmg[1].sh, dmg[1].kind, dmg[1].by], [90, 0, 'laser', 'e1']);
  assert.ok(k.of(S.STATS, 'p1').length >= 2);
  k.run(3.5);
  assert.equal(p.sh, 0, 'no regen within 4 s');
  k.run(1.5);
  assert.ok(p.sh > 0 && p.sh <= 12, `regenerating (${p.sh})`);
  k.run(6);
  assert.equal(p.sh, 50);
  assert.equal(p.hp, 90, 'health does not regenerate');
});

test('energy drains (faster while sprinting) and starvation hurts at 0', () => {
  const k = makeSim();
  const { p } = k.join('p1');
  k.run(40);
  assert.ok(Math.abs(p.en - 99) < 0.05, `1 per 40 s (${p.en})`);
  p.a = 'run';
  k.run(8);
  assert.ok(Math.abs(p.en - (99 - 8 / 40 - 1)) < 0.05, `sprint (${p.en})`);
  p.a = 'idle';
  p.en = 0;
  p.sh = 0;
  k.run(5);
  assert.ok(p.hp <= 96 && p.hp >= 94, `starving (${p.hp})`);
  assert.equal(k.of(S.DAMAGE, 'p1').pop().kind, 'starve');
});

test('consumables: medkit, shield cell, ration; full → denied', () => {
  const k = makeSim();
  const { p } = k.join('p1');
  p.inv.items.medkit = 1;
  p.inv.items['shield-cell'] = 1;
  assert.equal(k.send('p1', { t: C.USE, item: 'medkit' }), false);
  assert.equal(k.lastDeny('p1').reason, 'full');
  p.hp = 50;
  p.sh = 0;
  assert.equal(k.send('p1', { t: C.USE, item: 'medkit' }), true);
  assert.equal(p.hp, 90);
  assert.equal(p.inv.items.medkit, 0);
  assert.equal(k.send('p1', { t: C.USE, item: 'shield-cell' }), false, 'cooldown');
  k.wait(3000);
  assert.equal(k.send('p1', { t: C.USE, item: 'shield-cell' }), true);
  assert.equal(p.sh, 50);
  p.en = 50;
  k.wait(3000);
  assert.equal(k.send('p1', { t: C.USE, item: 'ration' }), true);
  assert.equal(p.en, 85);
  assert.equal(k.of(S.INV, 'p1').pop().items.ration, 2);
});

test('death drops 30 % of resources into an owner-only crate; respawn after 5 s', () => {
  const k = makeSim();
  const { p } = k.join('p1', 10, 2900);
  const { p: q } = k.join('p2', 12, 2900);
  p.inv.res = { metal: 100, stone: 50, wood: 10, energy: 3 };
  p.inv.weapons.push('plasma-rifle');
  k.clear();
  damagePlayer(k.W, p, 500, 'e9', 'claw', null, { byType: 'stalker' });
  assert.equal(p.dead, true);
  assert.deepEqual(p.inv.res, { metal: 70, stone: 35, wood: 7, energy: 3 });
  assert.ok(p.inv.weapons.includes('plasma-rifle'), 'weapons are kept');
  const death = k.of(S.DEATH).find((m) => m.id === 'p1');
  assert.equal(death.by, 'e9');
  assert.ok(death.drop);
  const crate = k.W.loot.get(death.drop);
  assert.equal(crate.owner, 'p1');
  assert.deepEqual(crate.items.res, { metal: 30, stone: 15, wood: 3 });
  // dead players can't act
  assert.equal(k.send('p1', { t: C.FIRE, w: 'pulse-pistol', o: [10, 11, 2900], d: [0, 0, -1], seq: 1, ct: 0 }), false);
  assert.equal(k.lastDeny('p1').reason, 'dead');
  assert.equal(k.send('p1', { t: C.HARVEST, node: 'n0' }), false);
  // another player can't open it
  assert.equal(k.send('p2', { t: C.PICKUP, loot: death.drop }), false);
  assert.equal(k.lastDeny('p2').reason, 'notOwner');
  // respawn: too early, then at the Overlook
  assert.equal(k.send('p1', { t: C.RESPAWN, at: 'spawn' }), false);
  assert.equal(k.lastDeny('p1').reason, 'wait');
  k.run(SURVIVAL.respawnDelay);
  assert.equal(k.send('p1', { t: C.RESPAWN, at: 'spawn' }), true);
  assert.equal(p.dead, false);
  assert.equal(p.hp, 100);
  assert.ok(Math.hypot(p.x - 0, p.z - 150) < 45, 'at the Overlook');
  const rs = k.of(S.RESPAWNED).pop();
  assert.equal(rs.id, 'p1');
  // walk back and pick up the crate
  k.put(p, crate.p[0], crate.p[2]);
  assert.equal(k.send('p1', { t: C.PICKUP, loot: death.drop }), true);
  assert.deepEqual(p.inv.res, { metal: 100, stone: 50, wood: 10, energy: 3 });
});

test('death crates expire after 10 minutes; respawn at the spawn beacon', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  p.inv.res.metal = 500;
  p.inv.res.energy = 500;
  assert.equal(k.send('p1', { t: C.BUILD_PLACE, piece: 'spawn-beacon', p: [6, 10, 2900], rot: 0, cid: 'b1' }), true);
  const beacon = k.of(S.STRUCT).pop().add[0];
  k.put(p, 100, 2950);
  damagePlayer(k.W, p, 500, null, 'starve', null);
  const crateId = k.of(S.DEATH).pop().drop;
  assert.ok(k.W.loot.get(crateId));
  k.run(6);
  assert.equal(k.send('p1', { t: C.RESPAWN, at: 'beacon' }), true);
  assert.ok(Math.hypot(p.x - beacon.x, p.z - beacon.z) < 4, 'next to the spawn beacon');
  k.run(600, 0.5);
  assert.equal(k.W.loot.get(crateId), undefined);
  assert.ok(k.of(S.LOOT).some((m) => m.remove?.includes(crateId)));
});

test('respawn while alive is denied; logged out while dead → comes back dead', () => {
  const k = makeSim();
  const { p } = k.join('p1');
  assert.equal(k.send('p1', { t: C.RESPAWN, at: 'spawn' }), false);
  assert.equal(k.lastDeny('p1').reason, 'notDead');
  damagePlayer(k.W, p, 2999, null, 'starve', null);
  const save = k.sim.removePlayer('p1');
  assert.equal(save.dead, true);
  const w = k.sim.addPlayer({ id: 'p1', name: 'p1', save });
  assert.equal(w.you.dead, true);
  assert.equal(w.stats.dead, true);
  assert.equal(k.send('p1', { t: C.RESPAWN, at: 'spawn' }), true);
});
