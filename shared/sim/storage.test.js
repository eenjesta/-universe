/**
 * Survival depth (wave "survival play"): storage chests, campfire cooking, food buffs, warmth / night chill,
 * gear, beds (respawn + rested), doors, piece limits, persistence across a restart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './_testkit.js';
import { C, S } from '../protocol.js';
import { damagePlayer } from './players.js';
import { SURVIVAL, BUFFS, ITEMS } from '../defs/items.js';
import { COOK_RECIPES } from '../defs/recipes.js';
import { PIECE } from '../defs/pieces.js';
import { createSim } from './index.js';

const rich = (p) => {
  p.inv.res = { metal: 5000, stone: 5000, wood: 5000, energy: 5000 };
  p.inv.items.fiber = 200;
};
const place = (k, id, piece, x, z, extra = {}) =>
  k.send(id, { t: C.BUILD_PLACE, piece, p: [x, extra.y ?? 10, z], rot: extra.rot ?? 0, level: 0, cid: extra.cid ?? `${piece}@${x},${z}` });
const placed = (k) => k.of(S.STRUCT).filter((m) => m.ok && m.add).pop()?.add?.[0];
const store = (k, id, msg) => k.send(id, { t: C.STORE, ...msg });
const lastStorage = (k, id) => k.of(S.STORAGE, id).pop();

test('storage chest: put / take, carry limits, locked for others, contents spill when demolished', () => {
  const k = makeSim();
  k.sim.setTime(12);
  const { p } = k.join('alice', 0, 3000);
  const { p: b } = k.join('bob', 3, 3000);
  rich(p);
  rich(b);
  assert.equal(place(k, 'alice', 'storage-chest', 2, 3002), true);
  const chest = placed(k);
  assert.equal(chest.type, 'storage-chest');
  // put resources + items
  const wood = p.inv.res.wood;
  assert.equal(store(k, 'alice', { struct: chest.id, op: 'put', res: 'wood', n: 300, cid: 'w1' }), true);
  assert.equal(p.inv.res.wood, wood - 300);
  p.inv.items.berries = 12;
  assert.equal(store(k, 'alice', { struct: chest.id, op: 'put', item: 'berries', n: 50 }), true, 'clamped to what you carry');
  assert.equal(p.inv.items.berries, 0);
  let m = lastStorage(k, 'alice');
  assert.deepEqual([m.kind, m.res.wood, m.items.berries], ['chest', 300, 12]);
  // take: carry limit (berries max 40) — the rest stays in the chest
  k.W.storage.chest(chest.id).items.berries = 55;
  assert.equal(store(k, 'alice', { struct: chest.id, op: 'take', item: 'berries', n: 55 }), true);
  assert.equal(p.inv.items.berries, ITEMS.berries.max);
  assert.equal(k.W.storage.chest(chest.id).items.berries, 55 - ITEMS.berries.max);
  // Bob may not open Alice's chest
  assert.equal(store(k, 'bob', { struct: chest.id, op: 'open' }), false);
  assert.deepEqual([k.lastDeny('bob').reason, k.lastDeny('bob').name], ['private', 'alice']);
  assert.equal(store(k, 'bob', { struct: chest.id, op: 'take', res: 'wood', n: 10 }), false);
  // out of reach
  k.put(p, 40, 3000);
  assert.equal(store(k, 'alice', { struct: chest.id, op: 'open' }), false);
  assert.equal(k.lastDeny('alice').reason, 'far');
  // demolished → owner-only crate with the contents
  k.put(p, 0, 3000);
  k.clear();
  assert.equal(k.send('alice', { t: C.BUILD_REMOVE, id: chest.id }), true);
  const loot = k.of(S.LOOT).find((x) => x.add)?.add?.[0];
  assert.ok(loot, 'contents spilled');
  assert.deepEqual([loot.owner, loot.kind, loot.items.res.wood], ['alice', 'chest', 300]);
  assert.equal(k.W.storage.chest(chest.id), null);
});

test('campfire: timed cooking, only the cook collects, meals give buffs; warmth heals; night chill', () => {
  const k = makeSim();
  k.sim.setTime(12);
  const { p } = k.join('alice', 0, 3000);
  const { p: b } = k.join('bob', 2, 3000);
  rich(p);
  assert.equal(place(k, 'alice', 'campfire', 3, 3003), true);
  const fire = placed(k);
  p.inv.items.berries = 8;
  p.inv.items.mushroom = 0;
  // not enough mushrooms → cost
  assert.equal(store(k, 'alice', { struct: fire.id, op: 'cook', recipe: 'roast-glowcaps', n: 1 }), false);
  assert.equal(k.lastDeny('alice').reason, 'cost');
  // berries → 2 fruit skewers (n clamped to what you can pay)
  k.clear();
  assert.equal(store(k, 'alice', { struct: fire.id, op: 'cook', recipe: 'fruit-skewer', n: 5 }), true);
  assert.equal(p.inv.items.berries, 0);
  const slots = k.W.storage.fire(fire.id);
  assert.deepEqual([slots.length, slots[0].n, slots[0].by], [1, 2, 'alice']);
  const toBob = k.log.filter((o) => o.msg.t === S.STORAGE && k.sim.recipients(o.to).includes('bob')).map((o) => o.msg);
  assert.ok(toBob.some((x) => x.kind === 'fire' && x.cook.length === 1), 'players near see the grill');
  // too early → wait; Bob can't take Alice's food
  assert.equal(store(k, 'alice', { struct: fire.id, op: 'collect' }), false);
  assert.equal(k.lastDeny('alice').reason, 'wait');
  k.run(COOK_RECIPES['fruit-skewer'].time + 0.5);
  assert.equal(store(k, 'bob', { struct: fire.id, op: 'collect' }), false);
  assert.equal(store(k, 'alice', { struct: fire.id, op: 'collect' }), true);
  assert.equal(p.inv.items['fruit-skewer'], 2);
  assert.equal(k.W.storage.fire(fire.id).length, 0);
  // eat a meal: energy + the Energised buff (in S.STATS fx), even with a full stomach
  p.en = 100;
  k.wait(2000);
  assert.equal(k.send('alice', { t: C.USE, item: 'fruit-skewer' }), true);
  assert.ok(p.buffs.get('swift') > k.clock.t, 'buff active');
  const st = k.of(S.STATS, 'alice').pop();
  assert.ok(st.fx.swift > k.clock.t, 'buff reaches the client');
  // warmth: standing at the fire heals out of combat
  k.put(p, 4, 3004);
  p.hp = 50;
  p.lastDmgAt = -1e9;
  k.run(2);
  assert.equal(p.warm, true);
  assert.ok(k.of(S.STATS, 'alice').pop().fx.warm === 1);
  assert.ok(p.hp > 50 + BUFFS.warm.hpRegen * 1, `healing by the fire (${p.hp})`);
  // night chill away from the fire (hunger × cold), none at the fire
  k.sim.setTime(23);
  k.put(p, 60, 3000);
  p.en = 80;
  k.run(10);
  assert.equal(p.cold, true);
  assert.ok(Math.abs(p.en - (80 - 10 * SURVIVAL.energyDrain * BUFFS.cold.drain)) < 0.05, `cold drain (${p.en})`);
  k.put(p, 4, 3004);
  k.run(1);
  assert.deepEqual([p.cold, p.warm], [false, true]);
  void b;
});

test('food: raw food restores a little, meals more + well fed slows hunger', () => {
  const k = makeSim();
  k.sim.setTime(12);
  const { p } = k.join('alice', 0, 3000);
  p.inv.items.berries = 3;
  p.en = 50;
  p.hp = 90;
  assert.equal(k.send('alice', { t: C.USE, item: 'berries' }), true);
  assert.deepEqual([p.en, p.hp, p.inv.items.berries], [50 + ITEMS.berries.use.en, 90 + ITEMS.berries.use.hp, 2]);
  p.inv.items['roast-glowcaps'] = 1;
  k.wait(1000);
  assert.equal(k.send('alice', { t: C.USE, item: 'roast-glowcaps' }), true);
  assert.ok(p.buffs.has('fed'));
  const e0 = p.en;
  k.run(24);
  assert.ok(Math.abs(p.en - (e0 - 24 * SURVIVAL.energyDrain * BUFFS.fed.drain)) < 0.05, `fed drain (${p.en})`);
  // the buff survives a save / load
  const save = k.sim.removePlayer('alice');
  assert.ok(save.buffs.some(([id, left]) => id === 'fed' && left > 400));
  k.sim.addPlayer({ id: 'alice', name: 'alice', save });
  assert.ok(k.W.players.get('alice').buffs.get('fed') > k.clock.t + 400000);
});

test('gear: equip armour + shield module (max shield, damage reduction), unequip, death keeps gear', () => {
  const k = makeSim();
  k.sim.setTime(12);
  const { p } = k.join('alice', 0, 3000);
  p.inv.items['shield-module'] = 1;
  p.inv.items['light-techwear'] = 1;
  assert.equal(k.send('alice', { t: C.USE, item: 'shield-module' }), true);
  assert.equal(p.maxSh, SURVIVAL.maxSh + 25);
  assert.equal(p.inv.items['shield-module'], 0);
  assert.equal(p.inv.gear.module, 'shield-module');
  const inv = k.of(S.INV, 'alice').pop();
  assert.equal(inv.gear.module, 'shield-module');
  assert.equal(k.of(S.STATS, 'alice').pop().maxSh, 75);
  k.wait(1000);
  assert.equal(k.send('alice', { t: C.USE, item: 'light-techwear' }), true);
  p.sh = 0;
  const dmg = damagePlayer(k.W, p, 50, 'e1', 'claw', null);
  assert.ok(Math.abs(dmg - 50 * (1 - ITEMS['light-techwear'].gear.dr)) < 0.01, `armour (${dmg})`);
  // starvation ignores armour
  assert.equal(damagePlayer(k.W, p, 2, null, 'starve', null), 2);
  // unequip → back in the bag, max shield back to 50
  k.wait(1000);
  assert.equal(k.send('alice', { t: C.USE, item: 'shield-module', op: 'unequip' }), true);
  assert.deepEqual([p.maxSh, p.inv.items['shield-module'], p.inv.gear.module], [SURVIVAL.maxSh, 1, null]);
  // save / load keeps equipped gear
  const save = k.sim.removePlayer('alice');
  const w = k.sim.addPlayer({ id: 'alice', name: 'alice', save });
  assert.equal(w.inv.gear.armor, 'light-techwear');
  // schematics are item costs: Vanguard plating needs one (and uses it up)
  const q = k.W.players.get('alice');
  k.put(q, 0, 3000);
  q.inv.res = { metal: 500, stone: 500, wood: 500, energy: 500 };
  q.inv.items.fiber = 100;
  assert.equal(place(k, 'alice', 'workbench', 3, 3001), true);
  const bench = placed(k);
  k.W.build.upgrade(k.W.structures.get(bench.id), 'workbench-2');
  assert.equal(k.W.structures.get(bench.id).type, 'workbench-2');
  assert.equal(k.send('alice', { t: C.CRAFT, recipe: 'heavy-techwear' }), false, 'no schematic');
  q.inv.items['schem-heavy-techwear'] = 1;
  assert.equal(k.send('alice', { t: C.CRAFT, recipe: 'heavy-techwear' }), true);
  assert.deepEqual([q.inv.items['heavy-techwear'], q.inv.items['schem-heavy-techwear']], [1, 0]);
  // Mk III: the upgrade goes one tier up from Mk II
  k.W.build.upgrade(k.W.structures.get(bench.id), 'workbench-2');
  assert.equal(k.W.structures.get(bench.id).type, 'workbench-3');
  assert.equal(PIECE['workbench-3'].smp.tier, 3);
});

test('beds: the first bed is home, sleep sets it + Rested, respawn at the bed; locked for others', () => {
  const k = makeSim();
  k.sim.setTime(12);
  const { p } = k.join('alice', 0, 3000);
  const { p: b } = k.join('bob', 2, 3000);
  rich(p);
  rich(b);
  assert.equal(place(k, 'alice', 'sleeping-bag', 3, 3004), true);
  const bag = placed(k);
  assert.equal(p.bedId, bag.id, 'first bed = respawn point');
  assert.equal(place(k, 'alice', 'bed', 8, 3004, { rot: 1 }), true);
  const bed = placed(k);
  assert.equal(p.bedId, bag.id, 'a second bed does not move home');
  k.put(p, 8, 3004);
  assert.equal(store(k, 'alice', { struct: bed.id, op: 'sleep', cid: 's1' }), true);
  assert.equal(p.bedId, bed.id);
  assert.ok(p.buffs.get('rested') > k.clock.t);
  assert.equal(lastStorage(k, 'alice').bed, true);
  // Bob can't sleep in Alice's bed
  k.put(b, 8, 3005);
  assert.equal(store(k, 'bob', { struct: bed.id, op: 'sleep' }), false);
  assert.equal(k.lastDeny('bob').reason, 'private');
  // die far away → respawn at the bed (beside it, at the bed's height)
  k.put(p, 120, 3100);
  damagePlayer(k.W, p, 999, null, 'starve', null);
  k.run(SURVIVAL.respawnDelay + 0.2);
  assert.equal(k.send('alice', { t: C.RESPAWN, at: 'bed' }), true);
  assert.ok(Math.hypot(p.x - bed.x, p.z - bed.z) < 2, `next to the bed (${p.x}, ${p.z})`);
  assert.equal(p.buffs.size, 0, 'death clears buffs');
  // no bed → 'bed' falls back to the Overlook
  k.send('alice', { t: C.BUILD_REMOVE, id: bed.id });
  k.send('alice', { t: C.BUILD_REMOVE, id: bag.id });
  assert.equal(p.bedId, null);
  damagePlayer(k.W, p, 999, null, 'starve', null);
  k.run(SURVIVAL.respawnDelay + 0.2);
  assert.equal(k.send('alice', { t: C.RESPAWN, at: 'bed' }), true);
  assert.ok(Math.hypot(p.x, p.z - 150) < 45, 'Overlook');
});

test('doors: the owner opens and closes (broadcast), others are locked out; piece limits', () => {
  const k = makeSim();
  const { p } = k.join('alice', 0, 3000);
  const { p: b } = k.join('bob', 2, 3000);
  rich(p);
  assert.equal(place(k, 'alice', 'door', 2, 3002), true);
  const door = placed(k);
  k.clear();
  assert.equal(store(k, 'alice', { struct: door.id, op: 'toggle' }), true);
  const up = k.of(S.STRUCT).pop();
  assert.deepEqual([up.upd, up.add[0].id, up.add[0].open], [true, door.id, true]);
  assert.equal(k.log.find((o) => o.msg === up).to, '*');
  assert.equal(store(k, 'bob', { struct: door.id, op: 'toggle' }), false);
  assert.equal(k.lastDeny('bob').reason, 'private');
  assert.equal(k.W.structures.get(door.id).open, true);
  // limits: 8 campfires per player
  for (let i = 0; i < PIECE.campfire.limit; i++) assert.equal(place(k, 'alice', 'campfire', -16 + i * 4, 3010), true, `fire ${i}`);
  assert.equal(place(k, 'alice', 'campfire', 20, 3016), false);
  const fail = k.of(S.STRUCT).pop();
  assert.deepEqual([fail.reason, fail.n], ['pieceLimit', PIECE.campfire.limit]);
  void b;
});

test('persistence: chests, food on the fire and open doors survive a world save / restart', () => {
  const k = makeSim();
  k.sim.setTime(12);
  const { p } = k.join('alice', 0, 3000);
  rich(p);
  place(k, 'alice', 'storage-chest', 2, 3002);
  const chest = placed(k);
  place(k, 'alice', 'campfire', -3, 3003);
  const fire = placed(k);
  place(k, 'alice', 'door', 4, 3002);
  const door = placed(k);
  store(k, 'alice', { struct: chest.id, op: 'put', res: 'metal', n: 77 });
  p.inv.items.mushroom = 3;
  store(k, 'alice', { struct: fire.id, op: 'cook', recipe: 'roast-glowcaps', n: 1 });
  store(k, 'alice', { struct: door.id, op: 'toggle' });
  const save = JSON.parse(JSON.stringify(k.sim.exportWorld()));
  const psave = k.sim.removePlayer('alice');
  // a fresh sim (server restart) from the save
  const clock = { t: 5_000_000 };
  const sim2 = createSim({ getHeightAt: () => 10, isWater: () => false, now: () => clock.t, seed: 'test', world: save });
  const W2 = sim2._w;
  assert.equal(W2.storage.chest(chest.id).res.metal, 77);
  assert.equal(W2.storage.fire(fire.id).length, 1);
  assert.equal(W2.structures.get(door.id).open, true);
  const w = sim2.addPlayer({ id: 'alice', name: 'alice', save: psave });
  assert.equal(w.structures.find((r) => r.id === door.id).open, true, 'welcome carries the door state');
  const a = W2.players.get('alice');
  a.x = 0;
  a.z = 3000;
  a.y = 10;
  a.expect = null;
  clock.t += 30000;
  sim2.handle('alice', { t: C.STORE, struct: fire.id, op: 'collect' });
  assert.equal(a.inv.items['roast-glowcaps'], 1, 'cooked while the server was down');
  assert.equal(a.bedId, null);
});

test('supply depot: Ø-credits buy survival packs (items into the bag); wrong price / no credits denied', async () => {
  const { MARKET, SUPPLY_IDS } = await import('../defs/market.js');
  const k = makeSim();
  const { p } = k.join('alice', 0, 3000);
  for (const id of SUPPLY_IDS) {
    const m = MARKET[id];
    assert.ok(m.price > 0 && Object.keys(m.give).every((it) => ITEMS[it]), id);
  }
  p.inv.credits = 700;
  p.inv.items.medkit = 0;
  assert.equal(k.send('alice', { t: C.SPEND, reason: 'market', id: 'supply-medkits', cost: { credits: MARKET['supply-medkits'].price }, cid: 'depot:supply-medkits' }), true);
  assert.equal(p.inv.items.medkit, 2);
  assert.equal(p.inv.credits, 700 - MARKET['supply-medkits'].price);
  assert.equal(k.send('alice', { t: C.SPEND, reason: 'market', id: 'supply-fiber', cost: { credits: 1 } }), false);
  assert.equal(k.lastDeny('alice').reason, 'price');
  assert.equal(k.send('alice', { t: C.SPEND, reason: 'market', id: 'supply-crystal', cost: { credits: MARKET['supply-crystal'].price } }), false);
  assert.equal(k.lastDeny('alice').reason, 'credits');
});
