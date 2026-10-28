import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './_testkit.js';
import { C, S } from '../protocol.js';
import { MARKET } from '../defs/market.js';
import { GRANT_CAPS } from '../defs/items.js';

const rich = (p) => (p.inv.res = { metal: 2000, stone: 2000, wood: 2000, energy: 2000 });

test('harvest: no gathering inside the safe hub', () => {
  const k = makeSim();
  const node = k.sim.nodes[0];
  const { p } = k.join('p1', node.x + 3, node.z);
  assert.ok(k.W.world.isSafe(node.x, node.z));
  assert.equal(k.send('p1', { t: C.HARVEST, node: node.id }), false);
  assert.equal(k.lastDeny('p1').reason, 'safe');
  assert.equal(p.inv.res[node.resource] ?? 0, p.inv.res[node.resource] ?? 0);
});

test('harvest: range, depletion, respawn time, inventory', () => {
  // the hub nodes double as test fixtures here: pretend they are out in the wilderness
  const k = makeSim({ opts: { isSafe: () => false } });
  const node = k.sim.nodes[0];
  assert.ok(node && node.id === 'n0');
  const { p } = k.join('p1', node.x + 10, node.z);
  assert.equal(k.send('p1', { t: C.HARVEST, node: node.id }), false);
  assert.equal(k.lastDeny('p1').reason, 'far');
  k.put(p, node.x + 3, node.z);
  const before = p.inv.res[node.resource];
  assert.equal(k.send('p1', { t: C.HARVEST, node: node.id }), true);
  const h = k.of(S.HARVESTED).pop();
  assert.equal(h.node, node.id);
  assert.equal(h.by, 'p1');
  const got = h.res[node.resource];
  assert.ok(got >= 5 && got <= 12);
  assert.equal(p.inv.res[node.resource], before + got);
  assert.ok(h.respawnIn >= 150 && h.respawnIn <= 240);
  assert.equal(h.respawnAt, k.clock.t + h.respawnIn * 1000);
  assert.equal(k.of(S.INV, 'p1').pop().res[node.resource], before + got);
  // depleted for everyone
  const { p: q } = k.join('p2', node.x, node.z + 2);
  k.wait(3000);
  assert.equal(k.send('p2', { t: C.HARVEST, node: node.id }), false);
  assert.equal(k.lastDeny('p2').reason, 'depleted');
  // the welcome tells late joiners which nodes are down
  const w = k.sim.addPlayer({ id: 'p3', name: 'p3' });
  assert.deepEqual(w.nodes, [[node.id, h.respawnAt]]);
  k.wait(h.respawnIn * 1000);
  assert.equal(k.send('p2', { t: C.HARVEST, node: node.id }), true);
  assert.ok(q.inv.res[node.resource] > 0);
  assert.equal(k.send('p2', { t: C.HARVEST, node: 'nope' }), false);
});

test('crafting needs a workbench of the right tier within 6 m', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  rich(p);
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'pulse-ammo' }), false);
  assert.equal(k.lastDeny('p1').reason, 'workbench');
  assert.equal(k.send('p1', { t: C.BUILD_PLACE, piece: 'workbench', p: [3, 10, 2900], rot: 0, cid: 'w' }), true);
  const bench = k.of(S.STRUCT).pop().add[0];
  const ammo = p.inv.ammo.pulse;
  const metal = p.inv.res.metal;
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'pulse-ammo', n: 1, cid: 'c1' }), true);
  assert.equal(p.inv.ammo.pulse, Math.min(60, ammo + 30));
  assert.equal(p.inv.res.metal, metal - 4);
  assert.deepEqual(k.of(S.CRAFTED, 'p1').pop(), { t: S.CRAFTED, recipe: 'pulse-ammo', n: 1 });
  assert.equal(k.of(S.INV, 'p1').pop().ack, 'c1');
  // reserve is capped at the weapon's reserve: a full reserve can't take more
  assert.equal(p.inv.ammo.pulse, 60);
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'pulse-ammo', n: 10 }), false);
  assert.equal(k.lastDeny('p1').reason, 'full');
  assert.equal(p.inv.res.metal, metal - 4, 'nothing paid');
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'plasma-cells', n: 10 }), true);
  assert.equal(p.inv.ammo.plasma, 120);
  // weapons
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'plasma-rifle' }), true);
  assert.ok(p.inv.weapons.includes('plasma-rifle'));
  assert.equal(p.inv.mag['plasma-rifle'], 24);
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'plasma-rifle' }), false);
  assert.equal(k.lastDeny('p1').reason, 'owned');
  // tier 2
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'railgun' }), false);
  assert.equal(k.lastDeny('p1').reason, 'tier');
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'workbench-t2' }), true);
  const upd = k.of(S.STRUCT).pop().add[0];
  assert.equal(upd.id, bench.id);
  assert.equal(upd.type, 'workbench-2');
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'railgun' }), true);
  assert.ok(p.inv.weapons.includes('railgun'));
  // too far from the bench
  k.put(p, 20, 2900);
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'medkit' }), false);
  assert.equal(k.lastDeny('p1').reason, 'workbench');
  // not enough resources
  k.put(p, 0, 2900);
  p.inv.res.energy = 0;
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'shield-cell' }), false);
  assert.equal(k.lastDeny('p1').reason, 'cost');
  assert.equal(k.send('p1', { t: C.CRAFT, recipe: 'nope' }), false);
});

test('anyone can use a workbench; only the owner can upgrade it', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const { p: q } = k.join('p2', 2, 2902);
  rich(p);
  rich(q);
  k.send('p1', { t: C.BUILD_PLACE, piece: 'workbench', p: [3, 10, 2900], rot: 0, cid: 'w' });
  assert.equal(k.send('p2', { t: C.CRAFT, recipe: 'ration', n: 2 }), true);
  assert.equal(q.inv.items.ration, 5);
  assert.equal(k.send('p2', { t: C.CRAFT, recipe: 'workbench-t2' }), false);
});

test('grants: once per id, capped, hourly budget, quest unlocks', () => {
  const k = makeSim();
  const { p } = k.join('p1');
  const c0 = p.inv.credits;
  assert.equal(k.send('p1', { t: C.GRANT, source: 'quest', id: 'horizon', amounts: { credits: 600, metal: 40 }, cid: 'g1' }), true);
  assert.equal(p.inv.credits, c0 + 600);
  assert.equal(k.of(S.INV, 'p1').pop().ack, 'g1');
  assert.equal(k.send('p1', { t: C.GRANT, source: 'quest', id: 'horizon', amounts: { credits: 600 } }), false);
  assert.equal(k.lastDeny('p1').reason, 'granted');
  // caps per grant
  k.send('p1', { t: C.GRANT, source: 'event', id: 'meteor-1', amounts: { credits: 1e9, metal: 1e6 } });
  assert.equal(p.inv.credits, c0 + 600 + GRANT_CAPS.credits);
  assert.equal(p.inv.res.metal, 60 + 40 + GRANT_CAPS.res);
  // hourly budget
  for (let i = 0; i < 10; i++) k.send('p1', { t: C.GRANT, source: 'event', id: `spam-${i}`, amounts: { credits: 3000 } });
  assert.equal(p.inv.credits, c0 + GRANT_CAPS.hourCredits);
  k.wait(3601 * 3000);
  k.send('p1', { t: C.GRANT, source: 'event', id: 'later', amounts: { credits: 100 } });
  assert.equal(p.inv.credits, c0 + GRANT_CAPS.hourCredits + 100);
  // unlocks only from quests and only known reward items
  k.send('p1', { t: C.GRANT, source: 'quest', id: 'stones', amounts: { items: ['decor-statue', 'bogus'] } });
  assert.deepEqual(p.inv.unlocks, ['decor-statue']);
  k.send('p1', { t: C.GRANT, source: 'event', id: 'x', amounts: { items: ['outfit-vanguard'] } });
  assert.deepEqual(p.inv.unlocks, ['decor-statue']);
  assert.equal(k.send('p1', { t: C.GRANT, source: 'cheat', id: 'y', amounts: { credits: 5 } }), false);
  // grants survive a save
  const save = k.sim.removePlayer('p1');
  k.sim.addPlayer({ id: 'p1', name: 'p1', save });
  assert.equal(k.send('p1', { t: C.GRANT, source: 'quest', id: 'horizon', amounts: { credits: 600 } }), false);
});

test('market: server prices, unlocks, resource packs, selling', () => {
  const k = makeSim();
  const { p } = k.join('p1');
  p.inv.credits = 2000;
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'market', id: 'decor-statue', cost: { credits: 1 } }), false);
  assert.equal(k.lastDeny('p1').reason, 'price');
  assert.equal(k.lastDeny('p1').price, MARKET['decor-statue'].price);
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'market', id: 'decor-statue', cost: { credits: 600 }, cid: 'm1' }), true);
  assert.equal(p.inv.credits, 1400);
  assert.ok(p.inv.unlocks.includes('decor-statue'));
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'market', id: 'decor-statue' }), false);
  assert.equal(k.lastDeny('p1').reason, 'owned');
  const metal = p.inv.res.metal;
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'market', id: 'res-metal-100' }), true);
  assert.equal(p.inv.res.metal, metal + 100);
  assert.equal(p.inv.credits, 1150);
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'market', id: 'outfit-vanguard' }), false);
  assert.equal(k.lastDeny('p1').reason, 'credits');
  // sell 50 metal (2 each) and the statue back (50 %)
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'sell', id: 'metal', cost: { metal: 50 } }), true);
  assert.equal(p.inv.credits, 1250);
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'sell', id: 'stone', cost: { stone: 99999 } }), false);
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'sell', id: 'decor-statue' }), true);
  assert.equal(p.inv.credits, 1550);
  assert.equal(p.inv.unlocks.includes('decor-statue'), false);
  // generic sink
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'repair', cost: { credits: 50, wood: 5 } }), true);
  assert.equal(p.inv.credits, 1500);
  assert.equal(k.send('p1', { t: C.SPEND, reason: 'repair', cost: { credits: 99999 } }), false);
});
