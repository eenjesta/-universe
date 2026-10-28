import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './_testkit.js';
import { C, S } from '../protocol.js';
import { PIECE, MAX_STRUCTURES_PER_PLAYER, ORIGIN_X, ORIGIN_Z, CELL } from '../defs/pieces.js';
import { createSim } from './index.js';

const rich = (p) => (p.inv.res = { metal: 5000, stone: 5000, wood: 5000, energy: 5000 });
// the centre of a grid cell near (x, z)
const cx = (x) => ORIGIN_X + Math.floor((x - ORIGIN_X) / CELL) * CELL + CELL / 2;
const cz = (z) => ORIGIN_Z + Math.floor((z - ORIGIN_Z) / CELL) * CELL + CELL / 2;

const place = (k, id, piece, x, z, extra = {}) => k.send(id, { t: C.BUILD_PLACE, piece, p: [x, extra.y ?? 10, z], rot: extra.rot ?? 0, level: extra.level ?? 0, cid: extra.cid ?? `${piece}@${x},${z}` });
const lastStruct = (k) => k.of(S.STRUCT).pop();

test('placing pays the cost, broadcasts the record and blocks the slot', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const stone = p.inv.res.stone;
  assert.equal(place(k, 'p1', 'foundation', cx(0), cz(2900), { cid: 'f1' }), true);
  const m = lastStruct(k);
  assert.equal(m.ok, true);
  assert.equal(m.cid, 'f1');
  assert.equal(m.by, 'p1');
  const rec = m.add[0];
  assert.deepEqual([rec.type, rec.owner, rec.level], ['foundation', 'p1', 0]);
  assert.match(rec.id, /^s\d+$/);
  assert.equal(p.inv.res.stone, stone - PIECE.foundation.cost.stone);
  assert.equal(k.log.find((o) => o.msg === m).to, '*');
  // same cell → occupied (reply only to the placer)
  assert.equal(place(k, 'p1', 'foundation', cx(0) + 0.7, cz(2900) - 0.5, { cid: 'f2' }), false);
  const fail = lastStruct(k);
  assert.deepEqual([fail.ok, fail.reason, fail.cid], [false, 'occupied', 'f2']);
  assert.equal(k.log.find((o) => o.msg === fail).to, 'p1');
  // a wall on the edge and a floor one storey up are fine
  assert.equal(place(k, 'p1', 'wall', cx(0), cz(2900) - 2), true);
  assert.equal(place(k, 'p1', 'floor', cx(0), cz(2900), { y: 13.2, level: 1 }), true);
  // free pieces overlap by radius
  assert.equal(place(k, 'p1', 'bench', 20, 2905), true);
  assert.equal(place(k, 'p1', 'bench', 20.5, 2905.2), false);
  assert.equal(lastStruct(k).reason, 'occupied');
});

test('validation: reach, hub + buffer, water, height (+ limit near the hub), cost, unlocks, limits', () => {
  const water = (x) => x > 100;
  const H = (x) => (x > 100 ? -2 : 10);
  const k = makeSim({ water, H });
  const { p } = k.join('p1', 0, 2900);
  const reason = () => lastStruct(k).reason;
  assert.equal(place(k, 'p1', 'foundation', 60, 2900), false);
  assert.equal(reason(), 'far');
  // the safe hub and the 500 m no-build buffer around it (§11.2)
  k.put(p, 0, 160);
  assert.equal(place(k, 'p1', 'foundation', 0, 150), false);
  assert.equal(reason(), 'safe', 'the hub');
  k.put(p, 0, 1400);
  assert.equal(place(k, 'p1', 'foundation', 0, 1410), false);
  assert.equal(reason(), 'hub', 'no-build buffer');
  k.put(p, 95, 2900);
  assert.equal(place(k, 'p1', 'foundation', 110, 2900, { y: -1.5 }), false);
  assert.equal(reason(), 'water');
  assert.equal(place(k, 'p1', 'foundation', 110, 2900, { y: -8 }), false);
  assert.equal(reason(), 'height');
  k.put(p, 0, 2900);
  assert.equal(place(k, 'p1', 'foundation', cx(0), cz(2900), { y: 60 }), false);
  assert.equal(reason(), 'height');
  // ≤ 16 m above the terrain where hubDist < 2000 m (here 1800 m)
  assert.equal(place(k, 'p1', 'floor', cx(0), cz(2900), { y: 10 + 5 * 3.2, level: 5 }), false);
  assert.equal(reason(), 'heightLimit');
  assert.equal(place(k, 'p1', 'landing-pad', 8, 2900, { level: 1, y: 13.2 }), false);
  assert.equal(reason(), 'ground');
  p.inv.res = { metal: 0, stone: 0, wood: 0, energy: 0 };
  assert.equal(place(k, 'p1', 'foundation', cx(0), cz(2900)), false);
  assert.equal(reason(), 'cost');
  rich(p);
  // beyond 2 km from the hub there is no height limit
  k.put(p, 0, 3200);
  assert.equal(place(k, 'p1', 'floor', cx(0), cz(3200), { y: 10 + 5 * 3.2, level: 5 }), true);
  k.put(p, 0, 2900);
  assert.equal(place(k, 'p1', 'statue', 5, 2905), false);
  assert.equal(reason(), 'locked');
  p.inv.unlocks.push('decor-statue');
  assert.equal(place(k, 'p1', 'statue', 5, 2905), true);
  assert.equal(place(k, 'p1', 'workbench-2', 9, 2905), false);
  assert.equal(reason(), 'hidden');
  assert.equal(place(k, 'p1', 'nope', 9, 2905), false);
  assert.equal(reason(), 'unknown');
  p.structCount = MAX_STRUCTURES_PER_PLAYER;
  assert.equal(place(k, 'p1', 'lamp', 12, 2905), false);
  assert.equal(reason(), 'limit');
  // dead players can't build
  p.structCount = 1;
  p.dead = true;
  assert.equal(place(k, 'p1', 'lamp', 12, 2905), false);
  assert.equal(reason(), 'dead');
});

test('claims: one per player, 30 m apart, outside the hub + buffer, owner-only building', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const { p: q } = k.join('p2', 60, 2900);
  rich(p);
  rich(q);
  assert.equal(place(k, 'p1', 'claim-beacon', 2, 2902), true);
  const claims = k.of(S.CLAIMS).pop().add[0];
  assert.deepEqual([claims.owner, claims.r, claims.p], ['p1', 24, [2, 2902]]);
  assert.equal(p.claimId, claims.id);
  assert.equal(place(k, 'p1', 'claim-beacon', 10, 2910), false);
  assert.equal(lastStruct(k).reason, 'claimLimit');
  // p2 can't build inside, nor claim overlapping
  k.put(q, 20, 2900);
  assert.equal(place(k, 'p2', 'foundation', cx(14), cz(2900)), false);
  assert.equal(lastStruct(k).reason, 'claim');
  // claims of different owners keep 30 m between their edges (24 + 24 + 30 = 78 m centre to centre)
  k.put(q, 70, 2900);
  assert.equal(place(k, 'p2', 'claim-beacon', 70, 2902), false);
  assert.deepEqual([lastStruct(k).reason, lastStruct(k).name], ['claimGap', 'p1']);
  assert.equal(place(k, 'p2', 'claim-beacon', 82, 2902), true);
  // the owner builds inside freely
  assert.equal(place(k, 'p1', 'foundation', cx(8), cz(2900)), true);
  // no claims in the hub, and the whole claim circle stays out of the no-build buffer
  const k2 = makeSim();
  const { p: r } = k2.join('p1', 300, -50);
  rich(r);
  assert.equal(k2.send('p1', { t: C.BUILD_PLACE, piece: 'claim-beacon', p: [300, 10, -60], rot: 0, cid: 1 }), false);
  assert.equal(k2.of(S.STRUCT).pop().reason, 'safe');
  k2.put(r, 0, 1600);
  assert.equal(k2.send('p1', { t: C.BUILD_PLACE, piece: 'claim-beacon', p: [0, 10, 1615], rot: 0, cid: 2 }), false);
  assert.equal(k2.of(S.STRUCT).pop().reason, 'hub');
  k2.put(r, 0, 1640);
  assert.equal(k2.send('p1', { t: C.BUILD_PLACE, piece: 'claim-beacon', p: [0, 10, 1630], rot: 0, cid: 3 }), true);
});

test('remove: owner only, 50 % refund, removing the beacon drops the claim', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const { p: q } = k.join('p2', 4, 2900);
  rich(p);
  place(k, 'p1', 'claim-beacon', 2, 2902);
  const beacon = lastStruct(k).add[0];
  place(k, 'p1', 'foundation', cx(8), cz(2900));
  const found = lastStruct(k).add[0];
  assert.equal(k.send('p2', { t: C.BUILD_REMOVE, id: found.id }), false);
  assert.equal(k.lastDeny('p2').reason, 'notOwner');
  const stone = p.inv.res.stone;
  assert.equal(k.send('p1', { t: C.BUILD_REMOVE, id: found.id, cid: 'r1' }), true);
  const rm = lastStruct(k);
  assert.deepEqual([rm.remove[0], rm.by, rm.cid, rm.ok], [found.id, 'p1', 'r1', true]);
  assert.equal(p.inv.res.stone, stone + PIECE.foundation.cost.stone / 2);
  assert.equal(k.send('p1', { t: C.BUILD_REMOVE, id: found.id }), false);
  assert.equal(k.lastDeny('p1').reason, 'gone');
  assert.equal(k.send('p1', { t: C.BUILD_REMOVE, id: beacon.id }), true);
  assert.equal(k.W.claims.size, 0);
  assert.equal(p.claimId, null);
  assert.ok(k.of(S.CLAIMS).pop().remove.length === 1);
  // now p2 may build there
  rich(q);
  assert.equal(place(k, 'p2', 'foundation', cx(8), cz(2900)), true);
});

test('world persistence: structures, claims, crates, clock and id counters', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  rich(p);
  place(k, 'p1', 'claim-beacon', 2, 2902);
  place(k, 'p1', 'spawn-beacon', 6, 2904);
  place(k, 'p1', 'foundation', cx(8), cz(2900));
  k.W.loot.spawn([1, 10, 2899], { res: { metal: 5 } }, { owner: 'p1', ttl: 300, kind: 'grave' });
  k.run(10);
  const world = JSON.parse(JSON.stringify(k.sim.exportWorld()));
  const save = JSON.parse(JSON.stringify(k.sim.removePlayer('p1')));
  const t = { t: k.clock.t };
  const sim2 = createSim({ getHeightAt: () => 10, isWater: () => false, now: () => t.t, seed: 'test', world });
  assert.equal(sim2.stats().structures, 3);
  assert.equal(sim2.stats().claims, 1);
  assert.equal(sim2.stats().loot, 1);
  assert.ok(Math.abs(sim2.time().hour - k.sim.time().hour) < 0.01);
  const w = sim2.addPlayer({ id: 'p1', name: 'p1', save });
  assert.equal(w.structures.length, 3);
  assert.equal(w.claims.length, 1);
  assert.equal(w.loot.length, 1);
  assert.ok(w.loot[0].ttl <= 300 && w.loot[0].ttl > 280);
  const P = sim2._w.players.get('p1');
  assert.equal(P.structCount, 3);
  assert.ok(P.claimId && P.spawnId, 'claim + spawn beacon re-attached');
  assert.deepEqual(w.inv.res, save.inv.res);
  // new ids don't collide with restored ones
  P.x = 0;
  P.z = 2900;
  P.expect = null;
  sim2.handle('p1', { t: C.BUILD_PLACE, piece: 'lamp', p: [12, 10, 2905], rot: 0, cid: 'n' });
  const add = sim2.drain().map((o) => o.msg).find((m) => m.t === S.STRUCT && m.ok);
  assert.ok(add && !world.structures.some((s) => s.id === add.add[0].id));
});
