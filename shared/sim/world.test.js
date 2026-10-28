/**
 * The one seamless world (PLATFORM.md §11 / §11.2): the stand-in provider,
 * provider adapters, the safe hub, world-provider harvest nodes, travel
 * (C.TRAVEL) and claim rules (foreign structures, decay of absent owners).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './_testkit.js';
import { C, S } from '../protocol.js';
import { HUB, TRAVEL_RULES, CLAIM_RULES, hubDist } from '../defs/world.js';
import { ORIGIN_X, ORIGIN_Z, CELL } from '../defs/pieces.js';
import { createStandin } from './standin.js';
import { resolveWorld } from './world.js';
import { damagePlayer } from './players.js';
import { SURVIVAL } from '../defs/items.js';
import { createSim } from './index.js';

const rich = (p) => (p.inv.res = { metal: 5000, stone: 5000, wood: 5000, energy: 5000 });
const cx = (x) => ORIGIN_X + Math.floor((x - ORIGIN_X) / CELL) * CELL + CELL / 2;
const cz = (z) => ORIGIN_Z + Math.floor((z - ORIGIN_Z) / CELL) * CELL + CELL / 2;
const place = (k, id, piece, x, z, extra = {}) => k.send(id, { t: C.BUILD_PLACE, piece, p: [x, extra.y ?? 10, z], rot: 0, level: 0, cid: extra.cid ?? `${piece}@${x},${z}` });
const quiet = (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = w;
  }
};

test('stand-in world: hub safe zone, biomes, spawn tables, seam, nodes, static build rules', () => {
  const hubH = (x, z) => 4 + Math.sin(x / 50) * 2 + z * 0;
  const w = createStandin({ seed: 'standin', hub: { heightAt: hubH, isWater: () => false } });
  // the hub square is the safe zone
  assert.equal(w.isSafe(0, 0), true);
  assert.equal(w.isSafe(1099, -1099), true);
  assert.equal(w.isSafe(1101, 0), false);
  assert.equal(w.biomeAt(10, 10), 'hub');
  // themes continue outward: jungle west, badlands east, ocean north-east
  assert.equal(w.biomeAt(-3000, 0), 'jungle');
  assert.equal(w.biomeAt(2800, 1000), 'badlands');
  assert.equal(w.biomeAt(1000, -3000), 'ocean');
  // spawn tables: none in the hub nor its 200 m buffer, none on the open sea
  assert.equal(w.spawnRules(0, 0, 12), null);
  assert.equal(w.spawnRules(1250, 0, 12), null);
  assert.equal(w.spawnRules(1000, -3000, 23), null);
  const jungle = w.spawnRules(-3000, 0, 12);
  assert.deepEqual([jungle.biome, jungle.list.map((e) => e.type)], ['jungle', ['stalker']]);
  const day = w.spawnRules(2800, 1000, 12);
  const night = w.spawnRules(2800, 1000, 23);
  assert.deepEqual(day.list.map((e) => e.type), ['drone']);
  assert.equal(night.density, day.density * 2, 'more at night');
  // the seam: hub heights inside, blended over 300 m, finite everywhere
  assert.equal(w.heightAt(500, 500), hubH(500, 500));
  for (let d = 1090; d < 1500; d += 7) {
    const a = w.heightAt(d, 37);
    const b = w.heightAt(d + 1, 37);
    assert.ok(Number.isFinite(a) && Math.abs(b - a) < 1.5, `smooth seam at ${d} (${a.toFixed(2)} → ${b.toFixed(2)})`);
  }
  // resource nodes: outside the hub only, stable ids, deterministic per seed
  assert.equal(w.nodesNear(0, 0, 300).length, 0);
  const a = w.nodesNear(-3000, 400, 250);
  const b = createStandin({ seed: 'standin', hub: { heightAt: hubH } }).nodesNear(-3000, 400, 250);
  assert.ok(a.length > 5, `nodes (${a.length})`);
  assert.deepEqual(a.map((n) => [n.id, n.type, n.x, n.z]), b.map((n) => [n.id, n.type, n.x, n.z]));
  for (const n of a) {
    assert.match(n.id, /^w-?\d+\.-?\d+\.\d+$/);
    assert.ok(Math.abs(n.y - w.heightAt(n.x, n.z)) < 1e-9 && !w.isWater(n.x, n.z));
  }
  // static build rules
  assert.deepEqual(w.isBuildable(0, 0), { ok: false, reason: 'safe' });
  assert.deepEqual(w.isBuildable(0, 1100 + HUB.noBuild - 1), { ok: false, reason: 'hub' });
  assert.deepEqual(w.isBuildable(0, 1100 + HUB.noBuild + 1), { ok: true });
});

test('world providers: worldgen adapters (spawnTable, chunk features), explicit functions win, errors are contained', () => {
  const base = { seed: 's', H: () => 5, isWater: () => false };
  const wg = {
    isSafe: (x, z) => Math.hypot(x, z) < 500,
    biomeAt: (x) => (x < 0 ? 'jungle' : 'badlands'),
    spawnTable: (biome) => (biome === 'jungle' ? { density: 2, entries: [{ enemy: 'stalker', weight: 3 }, { enemy: 'kraken' }] } : [{ type: 'drone' }]),
    CHUNK: 100,
    chunk: (i, j) => ({ features: [{ kind: 'tree', x: i * 100 + 10, z: j * 100 + 10 }, { node: true, id: `r${i}:${j}`, type: 'metal', x: i * 100 + 50, z: j * 100 + 50 }] }),
    isBuildable: (x) => (x > 1000 ? { ok: false, reason: 'highway' } : true),
  };
  const w = resolveWorld({ worldgen: wg }, base);
  assert.equal(w.kind, 'worldgen');
  assert.equal(w.isSafe(0, 0), true);
  assert.equal(w.isSafe(600, 0), false);
  assert.deepEqual(w.spawnRules(-600, 0, 12), { biome: 'jungle', density: 2, list: [{ type: 'stalker', w: 3, nightOnly: false }] });
  assert.deepEqual(w.spawnRules(600, 0, 12), { biome: 'badlands', density: 1, list: [{ type: 'drone', w: 1, nightOnly: false }] });
  const nodes = w.nodesNear(50, 50, 30);
  assert.deepEqual(nodes, [{ id: 'r0:0', type: 'metal', resource: 'metal', x: 50, y: 5, z: 50, rotY: 0, scale: 1 }]);
  assert.deepEqual(w.isBuildable(2000, 0), { ok: false, reason: 'highway' });
  assert.deepEqual(w.isBuildable(0, 0), { ok: true });
  // explicit functions beat the worldgen object
  const w2 = resolveWorld({ worldgen: wg, isSafe: () => false }, base);
  assert.equal(w2.isSafe(0, 0), false);
  // a throwing provider never takes the world down: the static hub square stays safe, nothing spawns, no nodes
  const boom = () => {
    throw new Error('provider down');
  };
  const w3 = resolveWorld({ isSafe: boom, spawnRules: boom, nodesNear: boom, isBuildable: boom }, base);
  quiet(() => {
    assert.equal(w3.isSafe(10, 10), true);
    assert.equal(w3.isSafe(5000, 10), false);
    assert.equal(w3.spawnRules(5000, 0, 12), null);
    assert.deepEqual(w3.nodesNear(5000, 0, 50), []);
    assert.deepEqual(w3.isBuildable(5000, 0), { ok: false, reason: 'invalid' });
  });
});

test('the safe hub: no hunger, no damage, weapons holstered, no building — survival starts outside', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 150); // the Overlook
  rich(p);
  k.run(40, 0.25);
  assert.equal(p.en, 100, 'no energy drain in the hub');
  assert.equal(damagePlayer(k.W, p, 50, 'e1', 'laser', null), 0);
  assert.equal(p.hp + p.sh, 150);
  assert.equal(k.send('p1', { t: C.FIRE, w: 'pulse-pistol', o: [0, 11.5, 150], d: [0, 0, -1], seq: 1, ct: k.clock.t }), false);
  assert.equal(k.lastDeny('p1').reason, 'safe');
  p.inv.items['shock-grenade'] = 1;
  assert.equal(k.send('p1', { t: C.THROW, w: 'shock-grenade', o: [0, 11.5, 150], v: [0, 5, -10] }), false);
  assert.equal(k.lastDeny('p1').reason, 'safe');
  assert.equal(place(k, 'p1', 'foundation', 4, 154), false);
  assert.equal(k.of(S.STRUCT).pop().reason, 'safe');
  assert.equal(k.sim.snapshotFor('p1').pl.length, 0);
  // out in the wild everything is live again
  k.put(p, 0, 2900);
  k.sim.setTime(12); // noon (no night chill)
  k.run(40, 0.25);
  assert.ok(Math.abs(p.en - (100 - 40 * SURVIVAL.energyDrain)) < 0.05, `drains outside (${p.en})`);
  assert.ok(damagePlayer(k.W, p, 10, 'e1', 'laser', null) > 0);
  assert.equal(k.send('p1', { t: C.FIRE, w: 'pulse-pistol', o: [0, 11.5, 2900], d: [0, 0, -1], seq: 2, ct: k.clock.t }), true);
});

test('world harvest nodes: provider ids outside the hub, range, depletion for everyone', () => {
  const k = makeSim({ seed: 'wnodes' });
  const near = k.sim.nodesNear(0, 3000, 300).filter((n) => n.id.startsWith('w'));
  assert.ok(near.length > 3, `world nodes (${near.length})`);
  const n = near[0];
  const { p } = k.join('p1', n.x + 2, n.z);
  const before = p.inv.res[n.resource];
  assert.equal(k.send('p1', { t: C.HARVEST, node: n.id }), true);
  const h = k.of(S.HARVESTED).pop();
  assert.equal(h.node, n.id);
  assert.equal(p.inv.res[n.resource], before + h.res[n.resource]);
  const { p: q } = k.join('p2', n.x - 2, n.z);
  k.wait(1000);
  assert.equal(k.send('p2', { t: C.HARVEST, node: n.id }), false);
  assert.equal(k.lastDeny('p2').reason, 'depleted');
  // a node id from far away is unknown here (the server only looks around the player)
  k.put(q, n.x + 400, n.z);
  k.wait(1000);
  const other = near.find((m) => m !== n);
  assert.equal(k.send('p2', { t: C.HARVEST, node: other.id }), false);
  assert.equal(k.lastDeny('p2').reason, 'unknown');
  // same seed → the same node ids at the same places (server and LocalServer agree)
  const k2 = makeSim({ seed: 'wnodes' });
  assert.deepEqual(k2.sim.nodesNear(0, 3000, 300).filter((m) => m.id.startsWith('w')).map((m) => [m.id, m.x, m.z]), near.map((m) => [m.id, m.x, m.z]));
});

test('travel: "Return to hub" channel (combat lock, cooldown, cancel) and the hub Gateway', () => {
  const k = makeSim({ seed: 'travel' });
  const { p } = k.join('p1', 0, 2900);
  const travel = (to, cid) => k.send('p1', { t: C.TRAVEL, to, cid });
  const last = () => k.of(S.TRAVEL, 'p1').pop();
  // from the wild: 10 s channel, then the Overlook
  assert.equal(travel('hub', 't1'), true);
  const ch = last();
  assert.deepEqual([ch.phase, ch.to, ch.cid, ch.at], ['channel', 'hub', 't1', k.clock.t + TRAVEL_RULES.hubChannel * 1000]);
  assert.equal(travel('hub'), false);
  assert.equal(k.lastDeny('p1').reason, 'busy');
  k.run(TRAVEL_RULES.hubChannel - 0.5, 0.25);
  assert.equal(last().phase, 'channel', 'not yet');
  k.run(0.75, 0.25);
  const done = last();
  assert.deepEqual([done.phase, done.to, done.cid], ['done', 'hub', 't1']);
  assert.ok(Math.hypot(p.x, p.z - 150) < 12 && p.safe, 'at the Overlook');
  assert.deepEqual(done.p.map(Math.round), [Math.round(p.x), Math.round(p.y), Math.round(p.z)]);
  assert.equal(travel('hub'), false);
  assert.equal(k.lastDeny('p1').reason, 'here');
  // cooldown (2 min)
  k.put(p, 0, 2900);
  assert.equal(travel('hub'), false);
  assert.equal(k.lastDeny('p1').reason, 'cooldown');
  k.wait(TRAVEL_RULES.hubCooldown * 1000);
  // combat lock: firing blocks travel for 8 s
  assert.equal(k.send('p1', { t: C.FIRE, w: 'pulse-pistol', o: [0, 11.5, 2900], d: [0, 0, -1], seq: 1, ct: k.clock.t }), true);
  assert.equal(travel('hub'), false);
  assert.equal(k.lastDeny('p1').reason, 'combat');
  k.wait(TRAVEL_RULES.combatLock * 1000);
  // cancelled by moving more than 4 m, by damage and on request
  assert.equal(travel('hub'), true);
  k.wait(100);
  k.send('p1', { t: C.STATE, p: [0, 10, 2894], h: 0, v: [0, 0, 0], a: 'walk', m: 'foot' });
  assert.deepEqual([last().phase, last().reason], ['cancel', 'moved']);
  assert.equal(travel('hub'), true);
  damagePlayer(k.W, p, 5, 'e1', 'laser', null);
  assert.deepEqual([last().phase, last().reason], ['cancel', 'combat']);
  k.wait(TRAVEL_RULES.combatLock * 1000);
  assert.equal(travel('hub'), true);
  assert.equal(travel('cancel'), true);
  assert.deepEqual([last().phase, last().reason], ['cancel', 'player']);
  // the Gateway only works in the hub
  assert.equal(travel('wild'), false);
  assert.equal(k.lastDeny('p1').reason, 'gateway');
  // a base + spawn beacon out here, then back to the hub and through the Gateway
  rich(p);
  assert.equal(place(k, 'p1', 'claim-beacon', 2, 2902), true);
  assert.equal(place(k, 'p1', 'spawn-beacon', 8, 2906), true);
  k.put(p, 0, 150);
  assert.equal(travel('base', 'g1'), true);
  assert.deepEqual([last().phase, last().to, last().cid], ['done', 'base', 'g1']);
  assert.ok(Math.hypot(p.x - 2, p.z - 2902) < CLAIM_RULES.radius, 'at my base');
  k.put(p, 0, 150);
  assert.equal(travel('beacon'), true);
  assert.ok(Math.hypot(p.x - 8, p.z - 2906) < 4, 'at my spawn beacon');
  k.put(p, 0, 150);
  assert.equal(travel('wild'), true);
  const r = Math.hypot(p.x, p.z);
  assert.ok(r >= TRAVEL_RULES.wildMin - 1 && r <= TRAVEL_RULES.wildMax + 1, `2–8 km out (${r.toFixed(0)} m)`);
  assert.ok(!p.safe && hubDist(p.x, p.z) >= HUB.noBuild);
  // the movement validator accepts the server-side move
  k.wait(100);
  assert.equal(k.send('p1', { t: C.STATE, p: [p.x + 0.5, p.y, p.z], h: 0, v: [0, 0, 0], a: 'walk', m: 'foot' }), true);
  // no base / beacon yet → told so
  const k2 = makeSim();
  k2.join('p1', 0, 150);
  assert.equal(k2.send('p1', { t: C.TRAVEL, to: 'base' }), false);
  assert.equal(k2.lastDeny('p1').reason, 'noBase');
  assert.equal(k2.send('p1', { t: C.TRAVEL, to: 'beacon' }), false);
  assert.equal(k2.lastDeny('p1').reason, 'noBeacon');
});

test('claims: no claim over someone else’s structures', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const { p: q } = k.join('p2', 30, 2900);
  rich(p);
  rich(q);
  assert.equal(place(k, 'p2', 'foundation', cx(40), cz(2900)), true);
  assert.equal(place(k, 'p1', 'claim-beacon', 25, 2900), false);
  assert.equal(k.of(S.STRUCT).pop().reason, 'claimForeign');
  assert.equal(place(k, 'p1', 'claim-beacon', 2, 2900), true, '24 m circle clear of the foundation');
});

test('claims of absent owners decay after 30 days, are removed 3 days later, and the owner is told', () => {
  const DAY = 86400 * 1000;
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  rich(p);
  assert.equal(place(k, 'p1', 'claim-beacon', 2, 2902), true);
  assert.equal(place(k, 'p1', 'foundation', cx(8), cz(2900)), true);
  const claimId = p.claimId;
  k.sim.removePlayer('p1');
  // 29 days away: nothing happens
  k.wait(29 * DAY);
  k.run(31, 0.25);
  assert.equal(k.W.claims.get(claimId).decay || 0, 0);
  // one day into the decay window
  k.wait(2 * DAY);
  k.clear();
  k.run(31, 0.25);
  const c = k.W.claims.get(claimId);
  assert.ok(c.decay > 0.2 && c.decay < 0.5, `decay ${c.decay}`);
  assert.ok(k.of(S.CLAIMS).some((m) => m.add?.[0]?.id === claimId && m.add[0].decay === c.decay));
  // persisted with the world
  const saved = JSON.parse(JSON.stringify(k.sim.exportWorld()));
  assert.ok(saved.owners.p1 && saved.claims[0].decay === c.decay);
  // the owner logs in: restored + notice
  const w = k.sim.addPlayer({ id: 'p1', name: 'p1' });
  assert.deepEqual(w.notices.map((n) => n.kind), ['claim-restored']);
  assert.equal(k.W.claims.get(claimId).decay, 0);
  k.sim.removePlayer('p1');
  // gone for good: 30 + 3 days later the base is removed
  k.wait((CLAIM_RULES.expireDays + CLAIM_RULES.decayDays + 0.1) * DAY);
  k.clear();
  k.run(31, 0.25);
  assert.equal(k.W.claims.size, 0);
  assert.equal(k.W.structures.size, 0);
  const rm = k.of(S.STRUCT).find((m) => m.reason === 'decay');
  assert.equal(rm.remove.length, 2);
  assert.ok(k.of(S.CLAIMS).some((m) => m.remove?.includes(claimId)));
  const w2 = k.sim.addPlayer({ id: 'p1', name: 'p1' });
  assert.equal(w2.notices[0].kind, 'claim-removed');
  assert.equal(w2.notices[0].n, 2);
  assert.equal(k.W.players.get('p1').claimId, null);
});

test('moderation: removeStructures by ids, owner or area (no refund, claims follow their beacon)', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const { p: q } = k.join('p2', 100, 2900);
  rich(p);
  rich(q);
  assert.equal(place(k, 'p1', 'claim-beacon', 2, 2902), true);
  assert.equal(place(k, 'p1', 'foundation', cx(8), cz(2900)), true);
  assert.equal(place(k, 'p2', 'lamp', 100, 2905), true);
  assert.equal(place(k, 'p2', 'bench', 104, 2905), true);
  const lamp = [...k.W.structures.values()].find((r) => r.type === 'lamp');
  const metal = q.inv.res.metal;
  k.clear();
  assert.deepEqual(k.sim.removeStructures({ ids: [lamp.id, 'nope'] }), [lamp.id]);
  assert.equal(q.inv.res.metal, metal, 'no refund');
  assert.equal(q.structCount, 1);
  assert.deepEqual(k.of(S.STRUCT).pop(), { t: S.STRUCT, remove: [lamp.id], by: null, reason: 'admin' });
  assert.equal(k.sim.removeStructures({ near: [104, 2905, 3] }, 'report').length, 1);
  assert.equal(k.of(S.STRUCT).pop().reason, 'report');
  assert.equal(k.sim.removeStructures({ owner: 'p1' }).length, 2);
  assert.equal(k.W.claims.size, 0);
  assert.equal(p.claimId, null);
  assert.ok(k.of(S.CLAIMS).pop().remove.length === 1);
  assert.deepEqual(k.sim.removeStructures({}), []);
});

test('claim decay: server downtime is not owner inactivity; never in the single-player LocalServer', () => {
  const DAY = 86400 * 1000;
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  rich(p);
  assert.equal(place(k, 'p1', 'claim-beacon', 2, 2902), true);
  k.sim.removePlayer('p1');
  k.wait(10 * DAY);
  const save = JSON.parse(JSON.stringify(k.sim.exportWorld()));
  // the server is down for 40 days, then restarts with the save
  const t = { t: k.clock.t + 40 * DAY };
  const sim2 = createSim({ getHeightAt: () => 10, isWater: () => false, now: () => t.t, seed: 'test', world: save });
  for (let i = 0; i < 4; i++) sim2.step(0.25);
  assert.equal(sim2.stats().claims, 1);
  assert.equal(sim2.drain().filter((o) => o.msg.t === S.CLAIMS).length, 0, 'not decaying: only 10 days of inactivity');
  t.t += 21 * DAY; // 31 days of inactivity → one day into the decay
  for (let i = 0; i < 130; i++) sim2.step(0.25);
  assert.ok(sim2.drain().some((o) => o.msg.t === S.CLAIMS && o.msg.add?.[0]?.decay > 0), 'decaying now');
  // trusted (offline single-player): never
  const k3 = makeSim({ opts: { trusted: true } });
  const { p: r } = k3.join('p1', 0, 2900);
  rich(r);
  assert.equal(place(k3, 'p1', 'claim-beacon', 2, 2902), true);
  k3.sim.removePlayer('p1');
  k3.wait(60 * DAY);
  k3.run(31, 0.25);
  assert.equal(k3.W.claims.size, 1);
  assert.equal(k3.W.structures.size, 1);
});
