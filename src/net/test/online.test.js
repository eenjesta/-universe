// node --test src/net/test/ — the client net layer (NetClient) against the REAL game server
// (server/app.js + shared/sim, booted in-process on a random port with a temp DATA_DIR).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, tempDir, sleep } from '../../../server/testkit.js';
import { NetClient } from '../client.js';
import { C, S, NET } from '../../../shared/protocol.js';

const quiet = { info() {}, warn() {}, error() {} };

function makeClient(url, name, extra = {}) {
  const msgs = [];
  const statuses = [];
  const c = new NetClient({
    url,
    WebSocket: globalThis.WebSocket,
    hello: () => ({ world: 'world', name, appearance: { body: 'f', skin: '#c68e67' }, lang: 'en', device: 'desktop' }),
    onMessage: (m) => msgs.push(m),
    onStatus: (s) => statuses.push(s),
    log: quiet,
    backoff: [150, 250, 400],
    ...extra,
  });
  c.msgs = msgs;
  c.statuses = statuses;
  return c;
}

async function until(fn, ms = 6000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(20);
  }
}

const lastSnapRow = (c, id) => {
  for (let i = c.msgs.length - 1; i >= 0; i--) {
    const m = c.msgs[i];
    if (m.t !== S.SNAP) continue;
    const row = m.pl.find((r) => r[0] === id);
    if (row) return row;
  }
  return null;
};

test('online: two clients see each other move and chat; clock sync', async () => {
  const app = await boot({ DATA_DIR: tempDir('ou-net-') });
  const a = makeClient(app.wsUrl, 'Alice');
  const b = makeClient(app.wsUrl, 'Bob');
  try {
    a.start();
    b.start();
    await until(() => a.ready && b.ready, 8000, 'both welcomes');
    assert.equal(a.mode, 'online');
    assert.equal(a.online, true);
    assert.notEqual(a.id, b.id);
    assert.ok(typeof a.token === 'string' && a.token.length > 20, 'the server issued a guest token');
    const spawn = a.welcome.you.p;
    // Alice walks a few steps (inside the speed cap) — Bob's snapshots show it with the anim
    for (let i = 1; i <= 6; i++) {
      a.send({ t: C.STATE, p: [spawn[0] + i * 0.25, spawn[1], spawn[2]], h: 1.2, v: [3.75, 0, 0], a: 'walk', m: 'foot' });
      await sleep(1000 / NET.STATE_HZ);
    }
    const row = await until(() => {
      const r = lastSnapRow(b, a.id);
      return r && r[5] === 'walk' && Math.abs(r[1] - (spawn[0] + 1.5)) < 0.01 ? r : null;
    }, 4000, "Alice's walking row in Bob's snapshots");
    assert.equal(row[6], 'foot');
    assert.ok(Math.abs(row[4] - 1.2) < 0.01, 'heading');
    // chat both ways, with the sender's name
    a.send({ t: C.CHAT, text: 'hello bob', ch: 'global' });
    const got = await until(() => b.msgs.find((m) => m.t === S.CHAT && m.from === a.id), 4000, 'chat at Bob');
    assert.equal(got.text, 'hello bob');
    assert.equal(got.name, 'Alice');
    b.send({ t: C.CHAT, text: 'hi alice', ch: 'local' });
    const back = await until(() => a.msgs.find((m) => m.t === S.CHAT && m.from === b.id), 4000, 'chat at Alice');
    assert.equal(back.ch, 'local');
    // ping/pong clock: serverTime() tracks the snapshot clock
    await until(() => a.clock.synced, 5000, 'clock sync');
    const snap = [...a.msgs].reverse().find((m) => m.t === S.SNAP);
    assert.ok(Math.abs(a.serverTime() - snap.st) < 1500, `serverTime ${a.serverTime()} vs snap ${snap.st}`);
    assert.ok(Number.isFinite(snap.tod), 'snapshots carry the world time of day');
  } finally {
    a.stop();
    b.stop();
    await app.shutdown('test');
  }
});

test('online: a profile change reaches the other player (JOIN upsert)', async () => {
  const app = await boot({ DATA_DIR: tempDir('ou-net-') });
  const a = makeClient(app.wsUrl, 'Alice');
  const b = makeClient(app.wsUrl, 'Bob');
  try {
    a.start();
    await until(() => a.ready, 8000, 'Alice welcome');
    b.start();
    await until(() => b.ready, 8000, 'Bob welcome');
    a.send({ t: C.PROFILE, name: 'Alicia', appearance: { body: 'f', outfit: 'nomad' } });
    const j = await until(() => b.msgs.find((m) => m.t === S.JOIN && m.id === a.id && m.name === 'Alicia'), 4000, 'profile upsert');
    assert.equal(j.appearance?.outfit, 'nomad');
  } finally {
    a.stop();
    b.stop();
    await app.shutdown('test');
  }
});

test('online: reconnects after a server restart and keeps the same player', async () => {
  const dir = tempDir('ou-net-');
  let app = await boot({ DATA_DIR: dir });
  const port = app.port;
  const a = makeClient(app.wsUrl, 'Alice');
  try {
    a.start();
    await until(() => a.ready, 8000, 'welcome');
    const id = a.id;
    const token = a.token;
    // a queued chat while the server is away is delivered after the reconnect
    await app.shutdown('restart');
    await until(() => a.mode === 'connecting' && a.reconnecting, 4000, 'reconnecting state');
    assert.equal(a.kind, 'ws', 'stays on the online transport (no local fallback once online)');
    assert.ok(a.send({ t: C.CHAT, text: 'still there?', ch: 'global' }), 'chat is queued while reconnecting');
    await sleep(300); // a failed attempt or two against the closed port
    app = await boot({ DATA_DIR: dir, PORT: String(port) });
    const b = makeClient(app.wsUrl, 'Bob');
    b.start();
    await until(() => a.ready && a.mode === 'online', 10000, 'back online');
    assert.equal(a.id, id, 'the saved token resumes the same player');
    assert.equal(a.token, token);
    assert.ok(a.statuses.some((s) => s.mode === 'connecting' && s.reconnecting), 'status reported the reconnect');
    await until(() => b.ready, 8000, 'Bob welcome');
    const q = await until(() => b.msgs.find((m) => m.t === S.CHAT && m.from === a.id), 6000, 'queued chat after reconnect');
    assert.equal(q.text, 'still there?');
    b.stop();
  } finally {
    a.stop();
    await app.shutdown('test');
  }
});

test('online: re-hello after sign in / out (client.reconnect) keeps the guest session', async () => {
  const app = await boot({ DATA_DIR: tempDir('ou-net-') });
  const a = makeClient(app.wsUrl, 'Alice');
  try {
    a.start();
    await until(() => a.ready, 8000, 'welcome');
    const id = a.id;
    const n = a.msgs.filter((m) => m.t === S.WELCOME).length;
    assert.equal(a.reconnect('auth'), true);
    await until(() => a.ready && a.msgs.filter((m) => m.t === S.WELCOME).length > n, 8000, 'second welcome');
    assert.equal(a.id, id, 'same guest (no auth token → the guest token wins)');
    assert.ok(a.statuses.some((s) => s.mode === 'connecting' && s.reason === 'auth'), 'status says why');
    assert.ok(!a.msgs.some((m) => m.t === S.ERROR && m.code === 'replaced'), 'the old socket closed first: no "replaced"');
  } finally {
    a.stop();
    await app.shutdown('test');
  }
});

test('online: unreachable server → local world (4 s rule, shortened)', async () => {
  const app = await boot({ DATA_DIR: tempDir('ou-net-') });
  const url = app.wsUrl;
  await app.shutdown('test');
  let made = 0;
  const c = makeClient(url, 'Solo', {
    openTimeout: 300,
    createLocal: () => {
      made++;
      return { connect: (sink) => ({ send: (m) => m.t === C.HELLO && queueMicrotask(() => sink({ t: S.WELCOME, v: 1, you: { id: 'p1', token: 'local', name: 'Solo' }, world: {} })), close() {} }), now: () => 0 };
    },
  });
  try {
    c.start();
    await until(() => c.kind === 'local' && c.ready, 4000, 'local fallback');
    assert.equal(c.mode, 'local');
    assert.equal(made, 1);
    assert.equal(c.token, null, 'a local session never overwrites the guest token');
  } finally {
    c.stop();
  }
});
