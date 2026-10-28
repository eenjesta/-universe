// node --test src/net/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { NET, C, S, PROTOCOL_VERSION } from '../../../shared/protocol.js';
import { createSim } from '../../../shared/sim/index.js';
import { Track, lerpAngle } from '../interp.js';
import { ClockSync } from '../clock.js';
import { TokenBucket } from '../ratelimit.js';
import { LocalServer } from '../local-server.js';
import { NetClient, serverUrl } from '../client.js';
import { classify, attribute, mergeInv, cleanAppearance } from '../bridge.js';
import { createProviders } from '../providers.js';
import { createRemotes } from '../remotes.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('track interpolates, extrapolates briefly and snaps across teleports', () => {
  const tr = new Track(8);
  const out = {};
  tr.push(1000, 0, 0, 0, 0, 'a');
  tr.push(1100, 10, 0, 0, 1, 'b');
  assert.ok(tr.sample(1050, out));
  assert.equal(out.x, 5);
  assert.equal(out.d, 'a');
  assert.equal(out.dn, 'b');
  assert.ok(Math.abs(out.vx - 100) < 1e-9);
  tr.sample(1150, out, 120);
  assert.equal(out.x, 15); // 50 ms of extrapolation at 100 m/s
  tr.sample(1500, out, 120);
  assert.equal(out.x, 22); // capped at 120 ms
  tr.push(1200, 500, 0, 0, 1, 'c'); // teleport
  tr.sample(1140, out);
  assert.equal(out.x, 10);
  tr.sample(1180, out);
  assert.equal(out.x, 500);
  assert.equal(tr.push(1150, 1, 1, 1, 0), false, 'out-of-order samples are dropped');
  assert.ok(Math.abs(lerpAngle(3, -3, 0.5) - Math.PI) < 0.2, 'heading lerps along the short arc');
});

test('clock sync follows the lowest-rtt sample', () => {
  const c = new ClockSync();
  c.sample(0, 5100, 200); // rtt 200 → offset 5000
  assert.equal(c.offset, 5000);
  c.sample(1000, 6020, 1040); // rtt 40 → offset 5000
  assert.ok(Math.abs(c.serverTime(2000) - 7000) < 1);
  assert.ok(c.rtt > 0);
});

test('token bucket keeps a reserve for important messages', () => {
  const b = new TokenBucket(5, 1, 0);
  for (let i = 0; i < 3; i++) assert.ok(b.take(0, 1, 2));
  assert.equal(b.take(0, 1, 2), false, 'state messages stop at the reserve');
  assert.ok(b.take(0), 'actions may use the reserve');
});

test('server url: same origin /ws, ?server override', () => {
  assert.equal(serverUrl({}, { protocol: 'https:', host: 'game.example' }), 'wss://game.example/ws');
  assert.equal(serverUrl({}, { protocol: 'http:', host: 'localhost:5199' }), 'ws://localhost:5199/ws');
  assert.equal(serverUrl({ server: 'localhost:8091' }, { protocol: 'http:', host: 'x' }), 'ws://localhost:8091/ws');
  assert.equal(serverUrl({ server: 'https://a.b/game/ws' }, { protocol: 'http:', host: 'x' }), 'wss://a.b/game/ws');
  assert.equal(serverUrl({}, { protocol: 'file:', host: '' }), null);
});

test('attribution: the first relevant event after a change wins', () => {
  const items = [
    { kind: 'event', name: 'dialogue:choice', relevant: true },
    { kind: 'event', name: 'market:buy', payload: { item: 'res-metal-100', price: 250 }, relevant: true },
    { kind: 'send', type: C.HARVEST, relevant: true },
  ];
  assert.equal(attribute(items, 1), 1);
  assert.equal(attribute(items, 3), 2, 'nothing after → the last one before');
  assert.equal(attribute([], 0), -1);
  const buy = classify({ d: { credits: -250, metal: 100 } }, items[1]);
  assert.deepEqual(buy, { kind: 'spend', reason: 'market', id: 'res-metal-100', cost: { credits: 250 } });
  assert.equal(classify({ d: { metal: 6 } }, items[2]), null, 'a server action → local prediction only');
  assert.equal(classify({ d: { metal: 6 }, dispatch: true }, null), null, 'during a server message → prediction');
  assert.equal(classify({ d: { metal: 6 }, predict: true }, items[1]), null);
  const q = classify({ d: { credits: 300 } }, { kind: 'event', name: 'progress:xp', payload: { reason: 'quest:horizon' } });
  assert.equal(q.source, 'quest');
  assert.equal(q.id, 'horizon');
  const sell = classify({ d: { metal: -50, credits: 100 } }, { kind: 'event', name: 'market:sell', payload: { item: 'res-metal', amount: 50, credits: 100 } });
  assert.deepEqual(sell.cost, { metal: 50 });
  assert.equal(classify({ d: { metal: 7 } }, { kind: 'event', name: 'harvest', payload: { source: 'node' } }).kind, 'split');
  assert.equal(classify({ d: { metal: 7 } }, { kind: 'event', name: 'smp:crafted' }), null);
});

test('inventory patches merge into the last inventory', () => {
  let inv = mergeInv(null, { t: S.INV, res: { metal: 1, stone: 2 }, credits: 5, ammo: { pulse: 10 } });
  inv = mergeInv(inv, { t: S.INV, patch: true, ammo: { pulse: 9 }, ack: 'x' });
  assert.equal(inv.ammo.pulse, 9);
  assert.equal(inv.res.metal, 1);
  assert.equal(inv.ack, undefined);
  inv = mergeInv(inv, { t: S.INV, res: { metal: 3 } });
  assert.equal(inv.credits, undefined, 'a full inventory replaces');
});

test('remotes: snapshot rows → interpolated views, enemies leave when gone', () => {
  const r = createRemotes({ delay: 100 });
  r.join('p2', { name: 'Ada' });
  r.applySnapshot({ st: 1000, pl: [['p2', 0, 1, 0, 0, 'walk', 'foot', 90, 40]], en: [['e1', 'drone', 5, 8, 5, 0, 2, 60]], px: [] }, 'p1');
  r.applySnapshot({ st: 1100, pl: [['p2', 2, 1, 0, 0, 'run', 'car', 80, 30, { type: 'car', p: [2, 1, 0], h: 0.5 }]], en: [['e1', 'drone', 6, 8, 5, 0, 3, 50]], px: [] }, 'p1');
  r.update(1150);
  const v = r.players.get('p2').view;
  assert.equal(v.p.x, 1);
  assert.equal(v.a, 'walk');
  assert.equal(v.hp, 80);
  assert.equal(r.enemies.get('e1').view.p.x, 5.5);
  r.update(1250);
  assert.equal(v.veh?.type, 'car');
  assert.equal(v.m, 'car');
  r.applySnapshot({ st: 1200, pl: [], en: [], px: [] }, 'p1');
  assert.equal(r.players.get('p2').inRange, false);
  r.update(1400);
  assert.equal(r.enemies.size, 0);
  assert.equal(r.players.size, 1, 'players stay until S.LEAVE');
});

function makeLocal(storage, migrate = null) {
  return new LocalServer({ createSim, getHeightAt: () => 10, isWater: () => false, seed: 'test', storage, migrate });
}

async function joinLocal(local, name = 'Tester') {
  const got = [];
  const conn = local.connect((m) => got.push(m));
  conn.send({ t: C.HELLO, v: PROTOCOL_VERSION, name, appearance: { body: 'f' }, lang: 'en', device: 'desktop' });
  await tick();
  return { conn, got };
}

test('local server: welcome, ping, grant ack, market spend, snapshots', async () => {
  const local = makeLocal(memStorage());
  const { conn, got } = await joinLocal(local);
  const w = got.find((m) => m.t === S.WELCOME);
  assert.ok(w, 'welcome arrives');
  assert.equal(w.you.id, 'p1');
  assert.equal(w.you.name, 'Tester');
  assert.ok(w.inv?.res && Number.isFinite(w.inv.credits));
  conn.send({ t: C.PING, ct: 5 });
  await tick();
  assert.ok(got.some((m) => m.t === S.PONG && m.ct === 5));
  const credits0 = w.inv.credits;
  conn.send({ t: C.GRANT, source: 'quest', id: 'horizon', amounts: { credits: 300 }, cid: 'n1' });
  await tick();
  const ack = got.find((m) => m.t === S.INV && m.ack === 'n1');
  assert.ok(ack, 'grant acked with the cid');
  assert.equal(ack.credits, credits0 + 300);
  conn.send({ t: C.GRANT, source: 'quest', id: 'horizon', amounts: { credits: 300 }, cid: 'n2' });
  await tick();
  assert.ok(got.some((m) => m.t === S.DENY && m.cid === 'n2'), 'second grant for the same id is denied');
  conn.send({ t: C.SPEND, reason: 'market', id: 'res-wood-100', cost: { credits: 150 }, cid: 'n3' });
  await tick();
  const buy = got.find((m) => m.t === S.INV && m.ack === 'n3');
  assert.equal(buy.credits, credits0 + 150);
  assert.equal(buy.res.wood, w.inv.res.wood + 100);
  for (let i = 0; i < 10; i++) local.tick(0.05);
  await tick();
  assert.ok(got.some((m) => m.t === S.SNAP && Number.isFinite(m.tod)), 'snapshots flow at the snapshot rate');
  assert.ok(local.now() > 0);
});

test('local server: the page decides the position (no corrections offline)', async () => {
  const local = makeLocal(memStorage());
  const { conn, got } = await joinLocal(local);
  conn.send({ t: C.STATE, p: [100, 10, 100], h: 0, v: [0, 0, 0], a: 'idle', m: 'foot' });
  assert.deepEqual(local.sim.playerPos('p1').slice(0, 1), [100], 'first state places the player');
  for (let i = 0; i < 100; i++) local.tick(0.05); // let the join grace period pass
  conn.send({ t: C.STATE, p: [600, 10, -300], h: 0, v: [0, 0, 0], a: 'idle', m: 'foot' }); // a jump no speed cap allows
  await tick();
  assert.ok(!got.some((m) => m.t === S.CORRECT), 'no correction is delivered');
  conn.send({ t: C.STATE, p: [601, 10, -300], h: 0, v: [0, 0, 0], a: 'walk', m: 'foot' });
  assert.equal(local.sim.playerPos('p1')[0], 601);
});

test('local server: migration once, persistence round trip', async () => {
  const storage = memStorage();
  let migrations = 0;
  const migrate = () => {
    migrations++;
    return {
      world: { v: 1, ids: { s: 7 }, structures: [{ id: 's7', type: 'floor-metal', x: 4, y: 10, z: 4, rot: 0, level: 0, owner: 'p1' }], claims: [], loot: [] },
      player: { v: 1, p: [20, 10, 30], h: 1, inv: { res: { metal: 124, stone: 380, wood: 215, energy: 98 }, credits: 1250, ammo: { pulse: 48 }, items: { ration: 3 }, weapons: ['pulse-pistol'], mag: { 'pulse-pistol': 12 }, slot: 0 } },
      profile: { name: 'Old Save' },
    };
  };
  const a = makeLocal(storage, migrate);
  const j = await joinLocal(a, 'Old Save');
  const w = j.got.find((m) => m.t === S.WELCOME);
  assert.equal(w.inv.credits, 1250);
  assert.equal(w.inv.res.stone, 380);
  assert.deepEqual(w.you.p.slice(0, 1), [20]);
  j.conn.send({ t: C.GRANT, source: 'event', id: 'x1', amounts: { metal: 10 }, cid: 'n1' });
  j.conn.close();
  const b = makeLocal(storage, migrate);
  const j2 = await joinLocal(b, 'Old Save');
  const w2 = j2.got.find((m) => m.t === S.WELCOME);
  assert.equal(migrations, 1, 'the single-player save migrates exactly once');
  assert.equal(w2.inv.res.metal, 134, 'the local world persisted');
});

test('client: falls back to the local server when the socket cannot open', async () => {
  class DeadSocket {
    constructor() {
      this.readyState = 0;
      setTimeout(() => this.onclose?.({ code: 1006 }), 5);
    }
    send() {}
    close() {}
  }
  const statuses = [];
  const msgs = [];
  const client = new NetClient({
    url: 'ws://127.0.0.1:1/ws',
    WebSocket: DeadSocket,
    hello: () => ({ name: 'T' }),
    createLocal: () => makeLocal(null),
    onMessage: (m) => msgs.push(m),
    onStatus: (s) => statuses.push(s.mode),
    log: { info() {}, warn() {}, error() {} },
  });
  client.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(client.kind, 'local');
  assert.equal(client.mode, 'local');
  assert.ok(msgs.some((m) => m.t === S.WELCOME));
  assert.ok(client.send({ t: C.CHAT, text: 'hi', ch: 'global' }));
  await tick();
  assert.ok(msgs.some((m) => m.t === S.CHAT && m.text === 'hi'));
  client.stop();
});

test('client: open timeout → local; queue survives until the welcome', async () => {
  class SilentSocket {
    constructor() {
      this.readyState = 0;
    }
    send() {}
    close() {}
  }
  const msgs = [];
  const client = new NetClient({
    url: 'ws://x/ws',
    WebSocket: SilentSocket,
    openTimeout: 20,
    hello: () => ({ name: 'T' }),
    createLocal: () => makeLocal(null),
    onMessage: (m) => msgs.push(m),
    log: { info() {}, warn() {}, error() {} },
  });
  client.start();
  assert.ok(client.send({ t: C.GRANT, source: 'event', id: 'q', amounts: { metal: 5 }, cid: 'n9' }), 'queued while connecting');
  assert.equal(client.send({ t: C.STATE, p: [0, 0, 0] }), false, 'state is dropped while connecting');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(client.kind, 'local');
  await tick();
  assert.ok(msgs.some((m) => m.t === S.INV && m.ack === 'n9'), 'the queued grant reached the local server');
  client.stop();
});

test('providers: stand-in around the hub, worldgen wins, broken worldgen falls back', async () => {
  const hubH = (x, z) => 5 + x * 0.001;
  const loaders = {
    standin: () => import('../../../shared/sim/standin.js'),
    defs: () => import('../../../shared/defs/world.js'),
  };
  const prov = await createProviders({ seed: 'o-universe', hub: { heightAt: hubH, isWater: () => false }, loaders, log: null });
  assert.equal(prov.source, 'standin');
  const R = prov.hub.half;
  assert.equal(R, 1100);
  assert.equal(prov.heightAt(100, -300), hubH(100, -300), 'the hub keeps its own terrain');
  assert.ok(Math.abs(prov.heightAt(R + 0.5, 10) - hubH(R + 0.5, 10)) < 0.5, 'continuous across the seam');
  assert.equal(prov.heightAt(5000, -7000), prov.heightAt(5000, -7000), 'deterministic');
  for (const [x, z] of [[1500, 0], [-20000, 3000], [12345, -65432]]) assert.ok(Number.isFinite(prov.heightAt(x, z)));
  assert.equal(prov.isSafe(0, 0), true);
  assert.equal(prov.isSafe(1099, -1099), true);
  assert.equal(prov.isSafe(1200, 0), false);
  assert.equal(prov.hubDist(1600, 200), 500);
  assert.equal(prov.hubDist(-30, 40), 0);
  assert.ok(prov.impl && typeof prov.impl.heightAt === 'function', 'the generator object goes to createSim({ worldgen })');
  // a worldgen module wins when it exists
  const wg = await createProviders({
    hub: { heightAt: hubH },
    loaders: { ...loaders, worldgen: async () => ({ createWorldgen: ({ hub }) => ({ heightAt: (x, z) => (Math.abs(x) <= hub.radius ? hub.heightAt(x, z) : 42), isWater: () => false, isSafe: (x) => Math.abs(x) < 1300 }) }) },
    log: null,
  });
  assert.equal(wg.source, 'worldgen');
  assert.equal(wg.heightAt(2000, 0), 42);
  assert.equal(wg.isSafe(1200, 0), true);
  // a broken worldgen (throws, or NaN heights) falls back to the stand-in
  const broken = await createProviders({ hub: { heightAt: hubH }, loaders: { ...loaders, worldgen: async () => ({ createWorldgen: () => { throw new Error('nope'); } }) }, log: null });
  assert.equal(broken.source, 'standin');
  const nan = await createProviders({ hub: { heightAt: hubH }, loaders: { ...loaders, worldgen: async () => ({ createWorldgen: () => ({ heightAt: () => NaN }) }) }, log: null });
  assert.equal(nan.source, 'standin');
  // nothing loads → the bare hub heightfield
  const bare = await createProviders({ hub: { heightAt: hubH }, loaders: {}, log: null });
  assert.equal(bare.source, 'hub');
  assert.equal(bare.impl, null);
  assert.equal(bare.heightAt(3000, 0), hubH(3000, 0));
});

test('local server with the stand-in world: safe hub, survival outside', async () => {
  const prov = await createProviders({
    hub: { heightAt: () => 4, isWater: () => false },
    loaders: { standin: () => import('../../../shared/sim/standin.js'), defs: () => import('../../../shared/defs/world.js') },
    log: null,
  });
  const local = new LocalServer({ createSim: (o) => createSim({ ...o, trusted: true, worldgen: prov.impl }), getHeightAt: prov.heightAt, isWater: prov.isWater, seed: 'o-universe', storage: null });
  const { conn, got } = await joinLocal(local);
  assert.ok(got.some((m) => m.t === S.WELCOME));
  assert.equal(local.sim.isSafe(0, 0), true);
  assert.equal(local.sim.isSafe(3000, 0), false);
  conn.send({ t: C.STATE, p: [3000, prov.heightAt(3000, 0), 0], h: 0, v: [0, 0, 0], a: 'idle', m: 'foot' });
  for (let i = 0; i < 40; i++) local.tick(0.05);
  await tick();
  assert.equal(local.sim.playerPos('p1')[0], 3000, 'the page moved the player into the wilderness');
  conn.close();
});

test('appearance is cleaned for the server schema (flat, small)', () => {
  const a = cleanAppearance({ body: 'f', skin: '#c68e67', face: 2, glasses: false, x: 'y'.repeat(100), list: [1, 'a', { no: 1 }], deep: { a: 1, b: { c: 2 } }, fn: () => 1 });
  assert.equal(a.body, 'f');
  assert.equal(a.x.length, 64);
  assert.deepEqual(a.list, [1, 'a']);
  assert.deepEqual(a.deep, { a: 1 });
  assert.equal('fn' in a, false);
  assert.equal(cleanAppearance(null), undefined);
  const many = {};
  for (let i = 0; i < 80; i++) many[`k${i}`] = i;
  assert.equal(Object.keys(cleanAppearance(many)).length, 48);
});
