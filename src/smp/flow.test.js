/**
 * SMP flow against the REAL simulation (shared/sim): the smp bridge (build authority +
 * server messages) for two players outside the hub — harvest, craft at a workbench,
 * consumables, loot pickup, claims (own build ok, someone else's denied with the
 * owner's name), spawn beacon, and structures reaching the second client.
 * Pure Node (no DOM): a tiny in-process router stands in for the server / LocalServer.
 *   node --test src/smp/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C, S } from '../../shared/protocol.js';
import { createSim } from '../../shared/sim/index.js';
import { RECIPE_RANGE } from '../../shared/defs/recipes.js';
import { createBridge, noticeText, lostText } from './bridge.js';
import { emptyInv, mergeInv, normClaim, stationNear } from './logic.js';
import { standInBuildable, borderDist } from './zone.js';

const clone = (m) => JSON.parse(JSON.stringify(m));
const GROUND = 5;

function makeWorld() {
  let now = 5_000_000;
  const sim = createSim({ getHeightAt: () => GROUND, isWater: () => false, now: () => now, seed: 'smp-flow' });
  const clients = new Map();
  const pump = () => {
    for (const { to, msg } of sim.drain()) for (const id of sim.recipients(to)) clients.get(id)?.deliver(clone(msg));
  };
  return {
    sim,
    clients,
    pump,
    now: () => now,
    jump(ms) {
      now += ms;
    },
    advance(s) {
      for (let i = 0; i < Math.round(s * 20); i++) {
        now += 50;
        sim.step(0.05);
      }
      pump();
    },
  };
}

/** A client: fake ctx.net + build registry + the smp pieces the bridge talks to. */
function makeClient(world, id, name, at) {
  const handlers = new Map();
  const net = {
    mode: 'local',
    online: false,
    id,
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type).delete(fn);
    },
    send(msg) {
      world.sim.handle(id, clone(msg));
      world.pump();
    },
    serverTime: () => world.now(),
  };
  const records = new Map();
  const log = { structs: [], crafted: [], denies: [], harvested: [], loot: [], inv: [], lost: [], welcome: null };
  const ctx = {
    events: { on: () => () => {}, emit: () => {} },
    net,
    player: { position: { x: at[0], y: GROUND, z: at[1] } },
    build: {
      registry: { records },
      applyRemote({ add = [], remove = [], reset } = {}) {
        if (reset) records.clear();
        for (const r of add || []) records.set(r.id, { ...r, x: r.x ?? r.p?.[0], y: r.y ?? r.p?.[1], z: r.z ?? r.p?.[2] });
        for (const rid of remove || []) records.delete(rid);
      },
      applyHarvest: (m) => log.harvested.push(m),
    },
  };
  const smp = {
    inv: emptyInv(),
    world: { buildable: (x, z) => standInBuildable(x, z), isSafe: (x, z) => borderDist(x, z) <= 0, text: () => null },
    claims: {
      list: [],
      apply(m) {
        for (const c of m.add || []) {
          const n = normClaim(c);
          if (!n) continue;
          this.list = this.list.filter((o) => o.id !== n.id);
          this.list.push(n);
        }
        const gone = new Set(m.remove || []);
        if (gone.size) this.list = this.list.filter((o) => !gone.has(o.id));
      },
    },
    loot: { onMessage: (m) => log.loot.push(m) },
    onWelcome(m) {
      log.welcome = m;
      mergeInv(smp.inv, m.inv || {});
      ctx.build.applyRemote({ reset: true, add: m.structures || [] });
      smp.claims.list = [];
      smp.claims.apply({ add: m.claims || [] });
    },
    onInv(m) {
      mergeInv(smp.inv, m);
      log.inv.push(m);
    },
    onStats() {},
    onStructures: (m) => log.structs.push(m),
    onCrafted: (m) => log.crafted.push(m),
    onDeny: (m, text) => log.denies.push({ m, text }),
    onDeath() {},
    onRespawned() {},
    onLost: (reason, n) => log.lost.push({ reason, n }),
  };
  const bridge = createBridge(ctx, smp);
  world.clients.set(id, { deliver: (m) => handlers.get(m.t)?.forEach((fn) => fn(m)) });
  const welcome = world.sim.addPlayer({ id, name, appearance: {}, save: null });
  world.sim.teleport(id, [at[0], GROUND, at[1]], 0);
  world.clients.get(id).deliver(clone(welcome));
  world.pump();
  const move = (x, z) => {
    world.sim.teleport(id, [x, GROUND, z], 0);
    ctx.player.position.x = x;
    ctx.player.position.z = z;
  };
  return { id, ctx, smp, bridge, auth: bridge.authority, log, records, move };
}

const rec = (piece, x, z, cid, extra = {}) => ({ piece, type: piece, x, y: GROUND, z, rot: 0, level: 0, variant: 'ground', cid, ...extra });

test('smp flow vs the real sim: harvest, craft, use, loot, claims, spawn beacon, shared structures', async () => {
  const world = makeWorld();
  const X = 2400; // hubDist 1300 m: outside the safe hub and the 500 m no-build buffer
  const A = makeClient(world, 'pA', 'Alice', [X, 0]);
  const B = makeClient(world, 'pB', 'Bob', [X + 6, 4]);
  assert.ok(A.smp.inv.res.metal > 0, 'welcome inventory mirrored');
  const start = { ...A.smp.inv.res };

  // ---- harvest a wilderness node (world provider ids)
  const nodes = world.sim.nodesNear(X, 0, 200);
  assert.ok(nodes.length > 0, 'stand-in world nodes exist outside the hub');
  const node = nodes[0];
  A.move(node.x + 1, node.z);
  assert.equal(A.auth.harvest(node.id), true);
  assert.equal(A.log.harvested.length, 1);
  assert.equal(A.log.harvested[0].node, node.id);
  assert.equal(A.log.harvested[0].mine, true);
  assert.ok(A.log.harvested[0].respawnIn > 30, 'respawn time converted to seconds');
  assert.ok(A.smp.inv.res[node.resource] > start[node.resource], `${node.resource} credited by the server`);
  A.move(X, 0);

  // ---- crafting needs a workbench: denied first, then OK next to one
  A.bridge.send({ t: C.CRAFT, recipe: 'ration', n: 1 });
  assert.equal(A.log.denies.at(-1)?.m.of, C.CRAFT, 'no workbench → deny');
  const wb = await A.auth.place(rec('workbench', X + 2, 0, 'c1'));
  assert.equal(wb.ok, true, `workbench placed (${wb.reason})`);
  assert.equal(wb.record.type, 'workbench');
  assert.equal(wb.record.owner, 'pA');
  assert.ok(B.records.has(wb.record.id), 'the workbench reached the second client');
  assert.equal(B.records.get(wb.record.id).ownerName, 'Alice');
  const rations = A.smp.inv.items.ration | 0;
  A.bridge.send({ t: C.CRAFT, recipe: 'ration', n: 2 });
  assert.equal(A.log.crafted.at(-1)?.recipe, 'ration');
  assert.equal(A.smp.inv.items.ration, rations + 2);

  // ---- consumables: refused while energy is full, used once hungry
  A.bridge.send({ t: C.USE, item: 'ration' });
  assert.equal(A.log.denies.at(-1)?.m.reason, 'full', 'full energy → deny');
  assert.equal(A.smp.inv.items.ration, rations + 2);
  world.sim._w.players.get('pA').en = 40;
  world.advance(1); // past the use cooldown
  A.bridge.send({ t: C.USE, item: 'ration' });
  assert.equal(A.smp.inv.items.ration, rations + 1, 'ration used');

  // ---- claim: own beacon OK, Bob's foundation inside it denied with Alice's name
  const cl = await A.auth.place(rec('claim-beacon', X - 2, 2, 'c2'));
  assert.equal(cl.ok, true, `claim placed (${cl.reason})`);
  assert.equal(A.smp.claims.list.length, 1);
  assert.equal(B.smp.claims.list[0].name, 'Alice', 'claim carries the owner name for other clients');
  const def = { id: 'foundation', radius: 2 };
  assert.match(B.auth.check({ x: X + 4, z: 4 }, def) || '', /Alice/, 'client prediction: claimed by Alice');
  const denied = await B.auth.place(rec('foundation', X + 4, 4, 'c3'));
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'claim');
  assert.match(denied.text, /Alice/);
  const own = await A.auth.place(rec('foundation', X + 4, -6, 'c4'));
  assert.equal(own.ok, true, `own foundation inside the claim (${own.reason})`);
  assert.equal(A.auth.check({ x: X + 4, z: -6 }, def) === null || /occupied|Occupied/.test(A.auth.check({ x: X + 4, z: -6 }, def)), true);
  const second = await A.auth.place(rec('claim-beacon', X - 2, 120, 'c5'));
  assert.equal(second.ok, false, 'one claim per player');

  // ---- removal: only the owner
  const rm = await B.auth.remove(own.record.id);
  assert.equal(rm.ok, false, 'Bob cannot remove Alice’s piece');
  assert.ok(B.auth.canRemove(B.records.get(own.record.id)), 'client refuses too');

  // ---- spawn beacon (one per player); needs metal → give the sim's inventory a top-up
  world.sim._w.players.get('pA').inv.res.metal += 100;
  world.sim._w.players.get('pA').inv.res.energy += 50;
  const sp = await A.auth.place(rec('spawn-beacon', X - 6, -3, 'c6'));
  assert.equal(sp.ok, true, `spawn beacon placed (${sp.reason})`);
  const sp2 = await A.auth.place(rec('spawn-beacon', X - 10, -3, 'c7'));
  assert.equal(sp2.ok, false);
  assert.equal(sp2.reason, 'spawnLimit');

  // ---- loot: a crate next to Alice → pickup credits the inventory and removes the crate
  const before = A.smp.inv.res.stone;
  const crate = world.sim._w.loot.spawn([X + 1, GROUND, 1], { res: { stone: 7 } }, { owner: 'pA', kind: 'death' });
  world.pump();
  assert.ok(A.log.loot.some((m) => m.add?.some((l) => l.id === crate.id)), 'loot add reaches the owner');
  A.bridge.send({ t: C.PICKUP, loot: crate.id });
  assert.equal(A.smp.inv.res.stone, before + 7);
  assert.ok(A.log.loot.some((m) => m.remove?.includes(crate.id)), 'crate removed after the pickup');

  // ---- the hub: building inside the safe zone is predicted as refused (stand-in rules)
  A.move(100, 100);
  assert.ok(A.auth.check({ x: 100, z: 100 }, def), 'no building in the hub');
  assert.ok(A.auth.canEnter(), 'build mode refused inside the safe zone');
  const hub = await A.auth.place(rec('foundation', 100, 100, 'c8'));
  assert.equal(hub.ok, false, 'server refuses the hub too');

  // ---- second client sees the whole base (workbench, claim beacon, foundation, spawn beacon)
  const types = [...B.records.values()].filter((r) => r.owner === 'pA').map((r) => r.type).sort();
  assert.deepEqual(types, ['claim-beacon', 'foundation', 'spawn-beacon', 'workbench']);
});

test('in-flight requests are rejected on disconnect', async () => {
  const world = makeWorld();
  const A = makeClient(world, 'pA', 'Alice', [2400, 0]);
  A.ctx.net.send = () => {}; // the server never answers
  const p = A.auth.place(rec('foundation', 2404, 0, 'z1'));
  A.bridge.flush('offline');
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'offline');
});

test('workbench Mk II upgrade unlocks tier-2 recipes (railgun); plasma rifle at tier 1', async () => {
  const world = makeWorld();
  const X = 2400;
  const A = makeClient(world, 'pA', 'Alice', [X, 0]);
  const P = world.sim._w.players.get('pA');
  Object.assign(P.inv.res, { metal: 900, stone: 400, wood: 200, energy: 400 });
  const wb = await A.auth.place(rec('workbench', X + 2, 0, 'u1'));
  assert.equal(wb.ok, true, `workbench placed (${wb.reason})`);
  assert.equal(stationNear(A.records.values(), X, 0, RECIPE_RANGE).tier, 1);
  A.bridge.send({ t: C.CRAFT, recipe: 'railgun', n: 1 });
  assert.equal(A.log.denies.at(-1)?.m.reason, 'tier', 'railgun needs a Workbench Mk II');
  A.bridge.send({ t: C.CRAFT, recipe: 'plasma-rifle', n: 1 });
  assert.ok(A.smp.inv.weapons.includes('plasma-rifle'), 'plasma rifle crafted at tier 1');
  A.bridge.send({ t: C.CRAFT, recipe: 'workbench-t2', n: 1 });
  assert.equal(A.log.crafted.at(-1)?.recipe, 'workbench-t2');
  assert.equal(A.log.crafted.at(-1)?.structure, wb.record.id);
  assert.equal(A.records.get(wb.record.id)?.type, 'workbench-2', 'the same record became a Mk II (S.STRUCT upd)');
  assert.equal(stationNear(A.records.values(), X, 0, RECIPE_RANGE).tier, 2);
  A.bridge.send({ t: C.CRAFT, recipe: 'railgun', n: 1 });
  assert.ok(A.smp.inv.weapons.includes('railgun'), 'railgun crafted at the Mk II');
});

test('claim decay (absent owner) + moderation: other clients see the decay, the owner gets notices', async () => {
  const world = makeWorld();
  const X = 2400;
  const DAY = 24 * 3600 * 1000;
  const A = makeClient(world, 'pA', 'Alice', [X, 0]);
  const B = makeClient(world, 'pB', 'Bob', [X + 60, 0]);
  const cl = await A.auth.place(rec('claim-beacon', X, 0, 'd1'));
  assert.equal(cl.ok, true, `claim placed (${cl.reason})`);
  const f = await A.auth.place(rec('foundation', X + 4, 3, 'd2'));
  assert.equal(f.ok, true);
  // moderation while the owner is online → the owner is told
  world.sim.removeStructures({ ids: [f.record.id] }, 'admin');
  world.pump();
  assert.deepEqual(A.log.lost.at(-1), { reason: 'admin', n: 1 });
  assert.match(lostText('admin', 1).text, /moderator/);
  assert.equal(B.log.lost.length, 0, 'not Bob’s structure');
  // the owner leaves for 31.5 days → the claim decays (other clients see decay > 0)
  world.sim.removePlayer('pA');
  world.jump(31.5 * DAY);
  world.advance(1);
  const seen = B.smp.claims.list.find((c) => c.owner === 'pA');
  assert.ok(seen && seen.decay > 0 && seen.decay < 1, `Bob sees the decay (${seen?.decay})`);
  // the owner returns → restored + a welcome notice
  const A2 = makeClient(world, 'pA', 'Alice', [X + 2, 2]);
  const notes = A2.log.welcome?.notices || [];
  assert.ok(notes.some((n) => n.kind === 'claim-restored'), 'claim-restored notice');
  assert.match(noticeText(notes.find((n) => n.kind === 'claim-restored')).title, /Welcome back/);
  world.pump();
  assert.equal(B.smp.claims.list.find((c) => c.owner === 'pA')?.decay, 0, 'decay cleared for everyone');
  // away for good: decayed + removed, the notice on the next login says how much
  world.sim.removePlayer('pA');
  world.jump(34 * DAY);
  world.advance(31); // the sim checks decay every 30 s
  assert.equal(B.smp.claims.list.filter((c) => c.owner === 'pA').length, 0, 'claim removed');
  assert.equal([...B.records.values()].filter((r) => r.owner === 'pA').length, 0, 'base removed for other clients');
  const A3 = makeClient(world, 'pA', 'Alice', [X, 0]);
  const gone = (A3.log.welcome?.notices || []).find((n) => n.kind === 'claim-removed');
  assert.ok(gone && gone.n >= 1, 'claim-removed notice with a count');
  assert.match(noticeText(gone).text, /30 days/);
});
