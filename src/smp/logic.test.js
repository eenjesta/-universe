import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyInv, mergeInv, recipeOutputs, recipeStatus, craftableCount, stationNear, claimAt, foreignClaimAt, claimOverlap, normClaim, bundleList, clock, recipeList, recipeGroup, haveOf, bestFood, foodCount, cookStatus, stationTier } from './logic.js';
import { RECIPES, COOK_RECIPES } from '../../shared/defs/recipes.js';

test('mergeInv: full then patch', () => {
  const inv = emptyInv();
  assert.equal(inv.known, false);
  mergeInv(inv, { res: { metal: 10, stone: 5, wood: 2, energy: 1 }, credits: 500, ammo: { pulse: 48 }, items: { ration: 3 }, weapons: ['pulse-pistol'], slot: 0, mag: { 'pulse-pistol': 12 } });
  assert.equal(inv.known, true);
  assert.equal(inv.res.metal, 10);
  assert.equal(inv.ammo.plasma, 0, 'full message resets missing keys');
  const ch = mergeInv(inv, { patch: true, res: { metal: 4 }, items: { medkit: 2 } });
  assert.deepEqual(ch.sort(), ['items', 'res']);
  assert.equal(inv.res.metal, 4);
  assert.equal(inv.res.stone, 5, 'patch keeps other keys');
  assert.equal(inv.items.ration, 3);
  assert.equal(inv.items.medkit, 2);
  mergeInv(inv, { patch: true, weapons: [{ id: 'plasma-rifle' }, 'pulse-pistol'], slot: 1 });
  assert.deepEqual(inv.weapons, ['plasma-rifle', 'pulse-pistol']);
  assert.equal(inv.slot, 1);
});

test('recipe outputs + status gating', () => {
  assert.deepEqual(recipeOutputs(RECIPES['pulse-ammo']), [{ kind: 'ammo', id: 'pulse', n: 30 }]);
  assert.deepEqual(recipeOutputs(RECIPES['plasma-rifle']), [{ kind: 'weapon', id: 'plasma-rifle', n: 1 }]);
  assert.equal(recipeOutputs(RECIPES['workbench-t2'])[0].kind, 'upgrade');
  const inv = emptyInv();
  mergeInv(inv, { res: { metal: 200, stone: 100, wood: 10, energy: 100 }, weapons: ['pulse-pistol'] });
  assert.equal(recipeStatus(RECIPES.ration, inv, null).reason, 'workbench');
  assert.equal(recipeStatus(RECIPES.ration, inv, { tier: 1 }).ok, true);
  assert.equal(recipeStatus(RECIPES.railgun, inv, { tier: 1 }).reason, 'tier');
  assert.equal(recipeStatus(RECIPES.railgun, inv, { tier: 2 }).ok, true);
  inv.weapons.push('plasma-rifle');
  assert.equal(recipeStatus(RECIPES['plasma-rifle'], inv, { tier: 1 }).reason, 'owned');
  assert.equal(recipeStatus(RECIPES['workbench-t2'], inv, { tier: 1 }, { ownStation: null }).reason, 'upgrade');
  assert.equal(recipeStatus(RECIPES['workbench-t2'], inv, { tier: 1 }, { ownStation: { tier: 1 } }).ok, true);
  inv.res.energy = 0;
  const st = recipeStatus(RECIPES.medkit, inv, { tier: 1 });
  assert.equal(st.reason, 'cost');
  assert.equal(st.missing.energy, 3);
  assert.equal(craftableCount(RECIPES.ration, { res: { wood: 9, energy: 3 } }), 3);
});

test('stations and claims', () => {
  const recs = [
    { id: 's1', type: 'workbench', x: 0, z: 0, owner: 'p1' },
    { id: 's2', type: 'workbench-2', x: 5, z: 0, owner: 'p2' },
    { id: 's3', type: 'wall', x: 1, z: 1 },
  ];
  assert.equal(stationNear(recs, 0, 0, 6).tier, 2);
  assert.equal(stationNear(recs, -3, 0, 6).id, 's1');
  assert.equal(stationNear(recs, 50, 0, 6), null);
  assert.equal(stationNear(recs, 0, 0, 6, 'p1').id, 's1');
  const claims = [normClaim({ id: 'c1', owner: 'p2', name: 'Kai', p: [100, 100], r: 24 }), normClaim({ id: 'c2', owner: 'p1', name: 'Me', x: 0, z: 0 })];
  assert.equal(claims[1].r, 24);
  assert.equal(claimAt(claims, 110, 100).id, 'c1');
  assert.equal(foreignClaimAt(claims, 'p1', 5, 5), null);
  assert.equal(foreignClaimAt(claims, 'p1', 120, 100).name, 'Kai');
  assert.equal(claimOverlap(claims, 'p1', 60, 100, 24)?.id, 'c1');
  assert.equal(claimOverlap(claims, 'p1', 40, 100, 24, 0), null, 'circles touch-free without a gap');
  assert.equal(claimOverlap(claims, 'p1', 40, 100, 24)?.id, 'c1', '§11.2: 30 m between claim edges');
  assert.equal(claimOverlap(claims, 'p1', 10, 100, 24), null);
});

test('bundles, clock, recipe order', () => {
  const l = bundleList({ res: { metal: 5, wood: 0 }, ammo: { pulse: 12 }, items: { ration: 1 }, weapon: 'railgun' });
  assert.deepEqual(l.map((x) => `${x.kind}:${x.id}:${x.n}`), ['res:metal:5', 'ammo:pulse:12', 'item:ration:1', 'weapon:railgun:1']);
  assert.equal(clock(65), '1:05');
  assert.equal(clock(-3), '0:00');
  const list = recipeList();
  assert.ok(list.length >= 9);
  assert.equal(recipeGroup(list[0]), 'tools', 'tools first (onboarding: craft your first tools)');
  assert.ok(list[list.length - 1].upgrade, 'upgrades last');
});

test('survival depth: gear mirror, item costs, schematics, tier 3, best food, cooking', () => {
  const inv = emptyInv();
  mergeInv(inv, { res: { metal: 100, stone: 50, wood: 40, energy: 60 }, items: { fiber: 30, berries: 7, ration: 1, 'roast-glowcaps': 2 }, gear: { armor: 'light-techwear', module: null } });
  assert.deepEqual(inv.gear, { armor: 'light-techwear', module: null });
  assert.deepEqual(mergeInv(inv, { patch: true, gear: { module: 'shield-module' } }), ['gear']);
  assert.equal(inv.gear.module, 'shield-module');
  assert.equal(haveOf(inv, 'fiber'), 30);
  assert.equal(haveOf(inv, 'metal'), 100);
  // best food: meals before rations before raw food
  assert.deepEqual(bestFood(inv), { id: 'roast-glowcaps', n: 2 });
  assert.equal(foodCount(inv), 10);
  // cooking: 7 berries → one fruit skewer batch (5 each)
  const cs = cookStatus(COOK_RECIPES['fruit-skewer'], inv);
  assert.deepEqual([cs.ok, cs.n], [true, 1]);
  assert.equal(cookStatus(COOK_RECIPES['roast-glowcaps'], inv).ok, false);
  // item costs + schematics
  const bench2 = { tier: 2 };
  assert.equal(recipeStatus(RECIPES.bandage, inv, null).ok, true, 'tier 0 field craft from fiber');
  assert.equal(recipeStatus(RECIPES['heavy-techwear'], inv, bench2).reason, 'schematic');
  mergeInv(inv, { patch: true, items: { 'schem-heavy-techwear': 1, fiber: 30 } });
  assert.equal(recipeStatus(RECIPES['heavy-techwear'], inv, bench2).ok, true);
  // upgrades: Mk II → Mk III needs your own Mk II bench
  assert.equal(stationTier('workbench-3'), 3);
  assert.equal(recipeStatus(RECIPES['workbench-t3'], inv, bench2, { ownStation: { tier: 1 } }).reason, 'upgrade');
  const near = stationNear([{ id: 'a', type: 'workbench-3', x: 2, z: 0 }, { id: 'b', type: 'workbench', x: 1, z: 0 }], 0, 0);
  assert.deepEqual([near.id, near.tier], ['a', 3]);
});
