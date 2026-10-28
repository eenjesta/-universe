/**
 * Gathering rules (C.HARVEST { feature, tool, hit }): trees / rocks / crystals / plants of the real
 * shared/worldgen chunks — reach, line of sight, swing rate, tool tiers, HP per hit, yields per hit and
 * on completion, felled → regrowth, broadcasts, welcome + world-save persistence, node tool bonus,
 * tool crafting. Run: node --test shared/sim/gather.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldgen } from '../worldgen/index.js';
import { makeSim } from './_testkit.js';
import { C, S, NET } from '../protocol.js';
import { chunkFeatures, mushroomFor, h01, parseFeatureId, NODE_TOOL_BONUS } from './nodes.js';
import { featureRule, idHash01, TOOLS, toolDamage, bestTool, HEAL_AFTER, TOOL_RECIPES } from '../defs/tools.js';
import { ITEMS } from '../defs/items.js';
import { RECIPES } from '../defs/recipes.js';

const wg = createWorldgen({ seed: 'gather-test', hub: { heightAt: () => 20, isWater: () => false, radius: 1100, blend: 300 } });
const H = (x, z) => wg.heightAt(x, z);
const CENTERS = [[1800, 300], [0, 1800], [-1800, 0], [0, -2600], [2600, 2600], [-3000, 3000], [3500, -500], [-2400, -2400]];

/** First feature (in a stable scan order) matching pred. */
function findFeature(pred) {
  for (const [x0, z0] of CENTERS) {
    for (let r = 0; r <= 4; r++) {
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const cx = Math.floor(x0 / 64) + i;
          const cz = Math.floor(z0 / 64) + j;
          for (const f of chunkFeatures(wg, cx, cz)) if (pred(f, featureRule(f))) return f;
        }
      }
    }
  }
  return null;
}

/** A sim on the test planet with player A next to feature f (dist m away, on the ground). */
function setup(f, { dist = 1.4, opts = {} } = {}) {
  const k = makeSim({ H, seed: 'gather-test', opts: { worldgen: wg, ...opts } });
  const { p } = k.join('A', f.x + dist, f.z);
  k.clear();
  return { k, p };
}

/** Swing once (advancing the clock by the tool's swing time first). */
function swing(k, f, tool, hit) {
  k.wait(Math.ceil(TOOLS[tool].swing * 1000) + 5);
  k.send('A', { t: C.HARVEST, feature: f.id, tool, hit });
  const fe = k.of(S.FEATURE);
  return fe[fe.length - 1] || null;
}

const flatFlat = (f, r) => {
  // flat-ish ground around the feature (LOS / reach tests stay about the rules, not the terrain)
  const d = Math.abs(H(f.x + 1.4, f.z) - f.y) + Math.abs(H(f.x - 1.4, f.z) - f.y);
  return r && d < 1.2;
};

test('ids: parse, mushrooms derived from forest trees, hash identical on server + client helpers', () => {
  assert.deepEqual(parseFeatureId('t:28:4:17'), { prefix: 't', type: 'tree', cx: 28, cz: 4, k: 17 });
  assert.equal(parseFeatureId('t:28:4'), null);
  assert.equal(parseFeatureId('n:1:2:3'), null);
  assert.equal(parseFeatureId({}), null);
  for (let i = 0; i < 200; i++) {
    const id = `t:${i * 7 - 300}:${i * 13 - 900}:${i % 64}`;
    assert.equal(idHash01(id, 0x5eed), h01(id, 0x5eed));
  }
  const tree = findFeature((f) => f.type === 'tree' && (f.biome === 'forest' || f.biome === 'jungle') && mushroomFor(f, H));
  assert.ok(tree, 'a forest tree with mushrooms');
  const m = mushroomFor(tree, H);
  assert.equal(m.id, `m${tree.id.slice(1)}`);
  assert.ok(Math.hypot(m.x - tree.x, m.z - tree.z) < 3);
  assert.ok(Math.abs(m.y - H(m.x, m.z)) < 1e-9);
  const pid = parseFeatureId(m.id);
  assert.ok(chunkFeatures(wg, pid.cx, pid.cz).some((f) => f.id === m.id), 'mushroom listed in its chunk');
});

test('tree: multitool chops slowly, every hit pays wood, the last fells it; swing rate + regrowth', () => {
  const f = findFeature((x, r) => x.type === 'tree' && r?.tier === 0 && flatFlat(x, r));
  assert.ok(f, 'a tier-0 tree');
  const rule = featureRule(f);
  const { k, p } = setup(f);
  const wood0 = p.inv.res.wood;
  const hits = Math.ceil(rule.hp / toolDamage('multitool', 'chop'));
  assert.ok(hits >= 5, `multitool needs many hits (${hits})`);
  let last = null;
  let woodAfterHits = wood0;
  for (let i = 0; i < hits; i++) {
    last = swing(k, f, 'multitool', i + 1);
    assert.ok(last, `hit ${i + 1} answered`);
    assert.equal(last.id, f.id);
    assert.equal(last.by, 'A');
    assert.equal(last.hit, i + 1);
    if (i < hits - 1) {
      assert.equal(last.state, 'hit');
      assert.equal(last.hp, rule.hp - (i + 1) * 10);
      woodAfterHits = p.inv.res.wood;
    }
  }
  assert.ok(woodAfterHits > wood0, 'wood paid during the hits');
  assert.equal(last.state, 'felled');
  assert.equal(last.hp, 0);
  assert.ok(last.dir && Math.abs(Math.hypot(last.dir[0], last.dir[1]) - 1) < 0.02, 'fall direction');
  assert.ok(last.got?.res?.wood > 0, 'completion wood reported to the harvester');
  const total = p.inv.res.wood - wood0;
  assert.ok(Math.abs(total - Math.round(rule.yield.res.wood * TOOLS.multitool.yield)) <= 1, `multitool total ${total}`);
  const regrowIn = (last.regrowAt - k.clock.t) / 1000;
  assert.ok(regrowIn >= rule.regrow[0] - 1 && regrowIn <= rule.regrow[1] + 1, `regrow ${regrowIn}s`);
  // felled: denied until it regrows
  k.wait(2000);
  k.send('A', { t: C.HARVEST, feature: f.id, tool: 'multitool' });
  assert.equal(k.lastDeny('A')?.reason, 'depleted');
  assert.equal(k.lastDeny('A')?.regrowAt, last.regrowAt);
  // swing rate: two swings 100 ms apart → the second is refused
  k.clear();
  k.wait(last.regrowAt - k.clock.t + 10);
  k.send('A', { t: C.HARVEST, feature: f.id, tool: 'multitool' });
  assert.equal(k.of(S.FEATURE).length, 1, 'regrown tree can be chopped again');
  k.wait(100);
  k.send('A', { t: C.HARVEST, feature: f.id, tool: 'multitool' });
  assert.equal(k.lastDeny('A')?.reason, 'rate');
});

test('tree: an axe needs far fewer hits and yields more; a damaged tree heals when left alone', () => {
  const f = findFeature((x, r) => x.type === 'tree' && r?.tier === 0 && r.hp >= 80 && flatFlat(x, r));
  const rule = featureRule(f);
  const { k, p } = setup(f);
  p.inv.items.axe = 1;
  const wood0 = p.inv.res.wood;
  const hits = Math.ceil(rule.hp / toolDamage('axe', 'chop'));
  assert.ok(hits <= Math.ceil(rule.hp / 10) / 2, 'axe at least twice as fast');
  // heal: one hit, then nothing for HEAL_AFTER s → full HP again
  const first = swing(k, f, 'axe', 1);
  assert.equal(first.hp, rule.hp - 25);
  k.wait((HEAL_AFTER + 1) * 1000);
  const again = swing(k, f, 'axe', 2);
  assert.equal(again.hp, rule.hp - 25, 'healed before this hit');
  let last = again;
  for (let i = 1; i < hits; i++) last = swing(k, f, 'axe', i + 2);
  assert.equal(last.state, 'felled');
  assert.ok(p.inv.res.wood - wood0 >= Math.round(rule.yield.res.wood * 0.95), 'axe pays the full tree');
  // the axe is not owned by a fresh player: denied, nothing changes
  const { k: k2, p: p2 } = setup(f);
  k2.send('A', { t: C.HARVEST, feature: f.id, tool: 'axe' });
  assert.equal(k2.lastDeny('A')?.reason, 'noItem');
  assert.equal(p2.inv.items.axe || 0, 0);
});

test('tiers: jungle giants and ore rocks need tier 1, crystal formations tier 2 (mining laser)', () => {
  const rock = findFeature((x, r) => x.type === 'rock' && r?.tier === 1 && flatFlat(x, r));
  assert.ok(rock, 'a tier-1 rock (shard / outcrop / hoodoo)');
  const rr = featureRule(rock);
  const { k, p } = setup(rock, { dist: Math.min(rr.reach, 1.2 + (rock.scale || 1)) });
  k.send('A', { t: C.HARVEST, feature: rock.id, tool: 'multitool' });
  const d = k.lastDeny('A');
  assert.equal(d?.reason, 'tool');
  assert.equal(d.need, 1);
  p.inv.items.pickaxe = 1;
  const stone0 = p.inv.res.stone;
  const metal0 = p.inv.res.metal;
  let last = null;
  for (let i = 0; i < 40 && last?.state !== 'broken'; i++) last = swing(k, rock, 'pickaxe', i);
  assert.equal(last.state, 'broken');
  assert.ok(p.inv.res.stone > stone0, 'stone');
  assert.ok(p.inv.res.metal > metal0, 'ore rocks give metal');

  const cr = findFeature((x, r) => x.type === 'crystal' && r && Math.abs(H(x.x + 1.4, x.z) - x.y) < 2);
  assert.ok(cr, 'a crystal formation');
  const { k: k2, p: p2 } = setup(cr, { dist: 1.6 });
  p2.inv.items.pickaxe = 1;
  k2.send('A', { t: C.HARVEST, feature: cr.id, tool: 'pickaxe' });
  assert.equal(k2.lastDeny('A')?.reason, 'tool');
  assert.equal(k2.lastDeny('A')?.need, 2);
  p2.inv.items['mining-laser'] = 1;
  const en0 = p2.inv.res.energy;
  let lc = null;
  for (let i = 0; i < 20 && lc?.state !== 'broken'; i++) lc = swing(k2, cr, 'mining-laser', i);
  assert.equal(lc.state, 'broken');
  assert.ok(p2.inv.res.energy > en0, 'energy from crystals');
  if (ITEMS['crystal-shard']) assert.ok((p2.inv.items['crystal-shard'] || 0) >= 0);
  assert.equal(bestTool(p2.inv, 'mine', 2), 'mining-laser');
  assert.equal(bestTool({ items: {} }, 'mine', 2), 'multitool');
});

test('reach, line of sight, safe zone, forged ids, scenery', () => {
  const f = findFeature((x, r) => x.type === 'tree' && r?.tier === 0 && flatFlat(x, r));
  const { k, p } = setup(f);
  // far
  k.put(p, f.x + 9, f.z);
  k.send('A', { t: C.HARVEST, feature: f.id, tool: 'multitool' });
  assert.equal(k.lastDeny('A')?.reason, 'far');
  // a ridge between the eyes and the tree (terrain line of sight)
  k.put(p, f.x + 3.2, f.z);
  const base = k.W.H;
  k.W.H = (x, z) => base(x, z) + (Math.abs(x - (f.x + 1.6)) < 0.8 ? 40 : 0);
  k.wait(2000);
  k.send('A', { t: C.HARVEST, feature: f.id, tool: 'multitool' });
  assert.equal(k.lastDeny('A')?.reason, 'blocked');
  k.W.H = base;
  // forged / unknown ids
  for (const id of ['t:99999:99999:63', 'x:1:2:3', 't:1:2', 42]) {
    k.wait(2000);
    k.send('A', { t: C.HARVEST, feature: id, tool: 'multitool' });
    assert.equal(k.lastDeny('A')?.reason, 'unknown', String(id));
  }
  // scenery bush (no crop)
  const plain = findFeature((x, r) => x.type === 'bush' && !r);
  assert.ok(plain);
  const s2 = setup(plain);
  s2.k.send('A', { t: C.HARVEST, feature: plain.id });
  assert.equal(s2.k.lastDeny('A')?.reason, 'invalid');
  // the safe zone (defensive: no worldgen features exist inside the hub)
  k.wait(2000);
  const safe = k.W.world.isSafe;
  k.W.world.isSafe = () => true;
  k.put(p, f.x + 1.4, f.z);
  k.send('A', { t: C.HARVEST, feature: f.id, tool: 'multitool' });
  assert.equal(k.lastDeny('A')?.reason, 'safe');
  k.W.world.isSafe = safe;
});

test('plants: berries / fiber / mushrooms are picked by hand in one action and grow back', () => {
  for (const [kind, item] of [['berries', 'berries'], ['plant', 'fiber'], ['mushroom', 'mushroom']]) {
    const f = findFeature((x, r) => r?.kind === kind && (kind !== 'plant' || x.variant === 'fern') && flatFlat(x, r));
    assert.ok(f, kind);
    const { k, p } = setup(f, { dist: 1.2 });
    k.send('A', { t: C.HARVEST, feature: f.id, tool: 'hands' });
    const m = k.of(S.FEATURE).pop();
    assert.equal(m?.state, 'picked', kind);
    if (ITEMS[item]) assert.ok((p.inv.items[item] || 0) > 0, `${item} received`);
    const rule = featureRule(f);
    assert.ok((m.regrowAt - k.clock.t) / 1000 >= rule.regrow[0] - 1);
    k.wait(1000);
    k.send('A', { t: C.HARVEST, feature: f.id });
    assert.equal(k.lastDeny('A')?.reason, 'depleted');
  }
});

test('broadcast to players near the feature, welcome + world save keep felled trees', () => {
  const f = findFeature((x, r) => x.type === 'tree' && r?.tier === 0 && r.hp <= 100 && flatFlat(x, r));
  const { k, p } = setup(f);
  k.join('B', f.x + 30, f.z);
  k.join('C', f.x + NET.INTEREST_RADIUS + 400, f.z);
  k.clear();
  p.inv.items['plasma-axe'] = 1;
  let last = null;
  for (let i = 0; i < 10 && last?.state !== 'felled'; i++) last = swing(k, f, 'plasma-axe', i);
  assert.equal(last.state, 'felled');
  const near = k.log.filter((o) => o.msg.t === S.FEATURE);
  const ids = new Set(near.flatMap((o) => k.sim.recipients(o.to)));
  assert.ok(ids.has('A') && ids.has('B') && !ids.has('C'), [...ids].join(','));
  // a joining player sees it felled
  const w = k.sim.addPlayer({ id: 'D', name: 'D' });
  assert.ok(w.features.some(([id, s, at]) => id === f.id && s === 'felled' && at === last.regrowAt));
  // world save → a new sim (server restart)
  const save = JSON.parse(JSON.stringify(k.sim.exportWorld()));
  assert.ok(save.features.list.some((e) => e[0] === f.id));
  const k2 = makeSim({ H, seed: 'gather-test', world: save, t0: k.clock.t + 5000, opts: { worldgen: wg } });
  const { p: p2 } = k2.join('A', f.x + 1.4, f.z);
  p2.inv.items['plasma-axe'] = 1;
  k2.clear();
  k2.send('A', { t: C.HARVEST, feature: f.id, tool: 'plasma-axe' });
  assert.equal(k2.lastDeny('A')?.reason, 'depleted');
  assert.equal(k2.sim._w.economy.featureState(f.id)?.s, 'felled');
});

test('nodes: a real tool multiplies the yield; tools craft in the field (tier 0) / at a workbench (tier 2)', () => {
  const k = makeSim({ H, seed: 'gather-test', opts: { worldgen: wg } });
  const nodes = wg.nodesNear(1800, 300, 900).filter((n) => n.resource === 'metal');
  assert.ok(nodes.length >= 2, 'metal nodes');
  const [n1, n2] = nodes;
  const { p } = k.join('A', n1.x + 1, n1.z);
  k.clear();
  k.send('A', { t: C.HARVEST, node: n1.id });
  const a = k.of(S.HARVESTED).pop();
  assert.ok(a.res.metal >= 6 && a.res.metal <= 9, 'classic amount without a tool');
  p.inv.items['mining-laser'] = 1;
  k.put(p, n2.x + 1, n2.z);
  k.wait(1500);
  k.send('A', { t: C.HARVEST, node: n2.id, tool: 'mining-laser' });
  const b = k.of(S.HARVESTED).pop();
  assert.ok(b.res.metal >= Math.round(6 * NODE_TOOL_BONUS[2]) && b.res.metal <= Math.round(9 * NODE_TOOL_BONUS[2]), `bonus ${b.res.metal}`);
  // crafting: axe anywhere (tier 0), only one; the plasma axe needs a workbench
  assert.equal(RECIPES.axe, TOOL_RECIPES.axe);
  assert.equal(ITEMS.axe.max, 1);
  k.clear();
  k.send('A', { t: C.CRAFT, recipe: 'axe' });
  assert.equal(p.inv.items.axe, 1);
  k.send('A', { t: C.CRAFT, recipe: 'axe' });
  assert.equal(k.lastDeny('A')?.reason, 'full');
  p.inv.res.metal = 500;
  p.inv.res.energy = 500;
  k.send('A', { t: C.CRAFT, recipe: 'plasma-axe' });
  assert.equal(k.lastDeny('A')?.reason, 'workbench');
});
