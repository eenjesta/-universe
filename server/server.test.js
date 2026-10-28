// Integration tests: a real server on a random port + WebSocket clients.
//   node --test server/          (TEST_LOG=info to see the server log)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boot, client, join, sleep, tempDir, TERRAIN_CACHE } from './testkit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('hello → welcome for a new guest; version mismatch and bad names', async (t) => {
  const app = await boot({ DATA_DIR: tempDir(), SIM: 'real' });
  t.after(() => app.shutdown('test'));

  const a = await join(app, { name: 'Nova' });
  const w = a.welcome;
  assert.equal(w.t, 'welcome');
  assert.equal(w.v, 1);
  assert.match(w.you.id, /^p\d+$/);
  assert.match(w.you.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(w.you.name, 'Nova');
  assert.equal(w.you.isNew, true);
  assert.ok(Array.isArray(w.you.p) && w.you.p.length === 3);
  assert.ok(w.inv && w.stats && Array.isArray(w.structures) && Array.isArray(w.claims) && Array.isArray(w.loot));
  assert.equal(w.world.seed, 'o-universe');
  assert.ok(w.world.st > 1.7e12);
  assert.deepEqual(w.world.players, []);
  // one seamless world per server (§11): instance id + the hub safe-zone geometry
  assert.equal(w.world.id, 'world');
  assert.ok(['worldgen', 'standin'].includes(w.world.gen), w.world.gen);
  assert.equal(w.you.guest, true);
  const hz = await (await fetch(app.url + '/healthz')).json();
  assert.equal(hz.world.id, 'world');
  assert.equal(hz.gen, w.world.gen);

  // bad name → a guest name; lang nl → Dutch guest name
  const b = await join(app, { name: 'kut', lang: 'nl' });
  assert.match(b.welcome.you.name, /^Verkenner \d{4}$/);
  assert.notEqual(b.welcome.you.token, w.you.token);
  assert.deepEqual(b.welcome.world.players.map((p) => p.id), [w.you.id]);

  // ping → pong with server time
  b.send({ t: 'ping', ct: 123 });
  const pong = await b.wait('pong');
  assert.equal(pong.ct, 123);
  assert.ok(Math.abs(pong.st - Date.now()) < 5000);

  // wrong protocol version → error + close
  const c = await join(app, { v: 999 });
  assert.equal(c.welcome.t, 'error');
  assert.equal(c.welcome.code, 'version');
  assert.equal((await c.closedP).code, 4004);

  // nothing but hello/ping before the welcome
  const d = client(app.wsUrl);
  await d.opened;
  d.send({ t: 'chat', text: 'early' });
  d.send({ t: 'ping', ct: 1 });
  await d.wait('pong');
  assert.ok(!d.msgs.some((m) => m.t === 'chat' && m.text === 'early'));
  for (const x of [a, b, d]) x.close();
});

test('two clients see each other: join, snapshots with movement, leave', async (t) => {
  const app = await boot({ DATA_DIR: tempDir(), SIM: 'real' });
  t.after(() => app.shutdown('test'));
  const a = await join(app, { name: 'Alpha' });
  const b = await join(app, { name: 'Bravo' });
  const joinMsg = await a.wait((m) => m.t === 'join' && m.id === b.welcome.you.id);
  assert.equal(joinMsg.name, 'Bravo');
  const sys = await a.wait((m) => m.t === 'chat' && m.sys === 'join' && /Bravo/.test(m.text));
  assert.equal(sys.from, null);

  // A walks 3 m east
  const [x, y, z] = a.welcome.you.p;
  a.send({ t: 'state', p: [x + 3, y, z], h: 1.5, a: 'walk', m: 'foot', v: [5, 0, 0] });
  const snap = await b.next((m) => m.t === 'snap' && m.pl.some((r) => r[0] === a.welcome.you.id && Math.abs(r[1] - (x + 3)) < 0.01));
  const row = snap.pl.find((r) => r[0] === a.welcome.you.id);
  assert.equal(row[4], 1.5);
  assert.equal(row[5], 'walk');
  assert.ok(snap.st > 1.7e12);
  assert.ok(!snap.pl.some((r) => r[0] === b.welcome.you.id), 'own row is not in the snapshot');

  // snapshot rate ≈ NET.SNAPSHOT_HZ (12/s)
  const n0 = b.msgs.filter((m) => m.t === 'snap').length;
  await sleep(1000);
  const n1 = b.msgs.filter((m) => m.t === 'snap').length;
  assert.ok(n1 - n0 >= 9 && n1 - n0 <= 15, `snapshots per second: ${n1 - n0}`);

  a.close();
  const leave = await b.wait((m) => m.t === 'leave' && m.id === a.welcome.you.id);
  assert.ok(leave);
  await b.wait((m) => m.t === 'chat' && m.sys === 'leave');
  b.close();
});

test('chat: relay, filter, local radius 60 m, rate limit, party denied', async (t) => {
  const app = await boot({ DATA_DIR: tempDir(), SIM: 'stub' }, { terrain: 'flat' });
  t.after(() => app.shutdown('test'));
  const a = await join(app, { name: 'Ann' });
  const b = await join(app, { name: 'Ben' });
  const c = await join(app, { name: 'Cas' });
  a.send({ t: 'state', p: [0, 2, 0], h: 0 });
  b.send({ t: 'state', p: [30, 2, 40], h: 0 }); // 50 m from A
  c.send({ t: 'state', p: [200, 2, 0], h: 0 }); // far away
  await sleep(150);

  a.send({ t: 'chat', text: '  Hallo   kut  wereld  ', ch: 'global' });
  for (const x of [a, b, c]) {
    const m = await x.wait((m) => m.t === 'chat' && m.from === a.welcome.you.id);
    assert.equal(m.text, 'Hallo *** wereld');
    assert.equal(m.name, 'Ann');
    assert.equal(m.ch, 'global');
  }
  a.send({ t: 'chat', text: 'local hello', ch: 'local' });
  await a.wait((m) => m.t === 'chat' && m.text === 'local hello');
  await b.wait((m) => m.t === 'chat' && m.text === 'local hello');
  await sleep(200);
  assert.ok(!c.msgs.some((m) => m.text === 'local hello'), 'far player must not get local chat');

  // NET.CHAT_RATE burst 5: 2 used above, 3 more pass, then 'rate'
  for (let i = 0; i < 5; i++) a.send({ t: 'chat', text: `spam ${i}`, ch: 'global' });
  const deny = await a.wait((m) => m.t === 'deny' && m.of === 'chat');
  assert.equal(deny.reason, 'rate');
  await sleep(200);
  assert.equal(b.msgs.filter((m) => m.t === 'chat' && /^spam/.test(m.text)).length, 3);

  c.send({ t: 'chat', text: 'party?', ch: 'party' });
  assert.equal((await c.wait((m) => m.t === 'deny' && m.of === 'chat')).detail, 'no-party');
  c.send({ t: 'chat', text: '   ', ch: 'global' }); // empty after trim → ignored
  for (const x of [a, b, c]) x.close();
});

test('persistence: guest token reconnect restores position and inventory across a restart', async () => {
  const dir = tempDir();
  let app = await boot({ DATA_DIR: dir, SIM: 'real' });
  const a = await join(app, { name: 'Saver' });
  const token = a.welcome.you.token;
  const id = a.welcome.you.id;
  const credits0 = a.welcome.inv.credits;
  const [x, y, z] = a.welcome.you.p;
  a.send({ t: 'state', p: [x + 3, y, z], h: 0.5, m: 'foot' });
  await sleep(120);
  a.send({ t: 'state', p: [x + 6, y, z], h: 0.5, m: 'foot' });
  a.send({ t: 'grant', source: 'quest', id: 'test-persist', amounts: { credits: 250 } });
  const inv = await a.wait((m) => m.t === 'inv' && m.credits !== undefined);
  assert.equal(inv.credits, credits0 + 250);
  await sleep(100);
  await a.close(); // save on leave
  await app.shutdown('test'); // + final world save
  assert.ok(fs.existsSync(path.join(dir, 'world.json')));
  assert.ok(fs.existsSync(path.join(dir, 'players', `${id}.json`)));
  const raw = fs.readFileSync(path.join(dir, 'players', `${id}.json`), 'utf8');
  assert.ok(!raw.includes(token), 'the raw token is never stored');
  const worldDoc = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'));
  assert.equal(worldDoc.id, 'world');
  assert.equal(typeof worldDoc.data.server.seed, 'string'); // the seed the terrain was generated with
  assert.ok(['worldgen', 'standin', 'hub'].includes(worldDoc.data.server.gen));

  app = await boot({ DATA_DIR: dir, SIM: 'real' });
  try {
    const b = await join(app, { token, name: 'Saver' });
    assert.equal(b.welcome.you.id, id);
    assert.equal(b.welcome.you.isNew, false);
    assert.equal(b.welcome.you.token, token);
    assert.equal(b.welcome.inv.credits, credits0 + 250);
    assert.ok(Math.abs(b.welcome.you.p[0] - (x + 6)) < 0.05, `x restored: ${b.welcome.you.p[0]} vs ${x + 6}`);
    // an unknown token makes a new guest with a fresh token
    const c = await join(app, { token: 'A'.repeat(43) });
    assert.notEqual(c.welcome.you.id, id);
    assert.notEqual(c.welcome.you.token, 'A'.repeat(43));
    b.close();
    c.close();
  } finally {
    await app.shutdown('test');
  }
  // the world remembers its seed: booting it with another WORLD_SEED is logged loudly
  app = await boot({ DATA_DIR: dir, SIM: 'real', WORLD_SEED: 'another-seed' });
  await app.shutdown('test');
  assert.ok(app.lines.some((l) => l.includes('generated with another seed')), app.lines.join('\n'));
});

test('accounts: the save follows the platform account (linked guest save, new device, restricted chat)', async (t) => {
  const app = await boot({ DATA_DIR: tempDir(), SIM: 'real' });
  t.after(() => app.shutdown('test'));
  const api = async (pathname, body) => {
    const r = await fetch(app.url + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  // play as a guest and earn something
  const g = await join(app, { name: 'Wanderer' });
  const guestToken = g.welcome.you.token;
  const credits0 = g.welcome.inv.credits;
  g.send({ t: 'grant', source: 'quest', id: 'account-test', amounts: { credits: 120 } });
  await g.wait((m) => m.t === 'inv' && m.credits === credits0 + 120);
  // "save your progress": register with the guest token
  const reg = await api('/api/auth/register', { username: 'wanderer_1', password: 'keep-progress-1', birthYear: 1995, guestToken });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const auth = reg.body.token;
  await g.close(); // save on leave
  await sleep(100);

  // another device: signed in, no guest token → the same save, under the account name
  const d = await join(app, { auth, name: 'Someone Else' });
  assert.equal(d.welcome.t, 'welcome');
  assert.equal(d.welcome.you.id, g.welcome.you.id);
  assert.equal(d.welcome.you.guest, false);
  assert.equal(d.welcome.you.account.id, reg.body.user.id);
  assert.equal(d.welcome.you.name, 'wanderer_1');
  assert.equal(d.welcome.you.token, undefined);
  assert.equal(d.welcome.inv.credits, credits0 + 120);
  d.send({ t: 'profile', name: 'Impostor' }); // account names don't change in game
  await sleep(150);
  assert.ok(!d.msgs.some((m) => m.t === 'deny' && m.of === 'profile'));
  assert.equal(app.world.sessions.get(d.welcome.you.id).name, 'wanderer_1');

  // an account that never played as a guest gets its own record, the same one every time
  const reg2 = await api('/api/auth/register', { username: 'fresh_one', password: 'keep-progress-2', birthYear: 1990 });
  assert.equal(reg2.status, 201);
  const e = await join(app, { auth: reg2.body.token, token: guestToken });
  assert.equal(e.welcome.you.isNew, true);
  assert.notEqual(e.welcome.you.id, d.welcome.you.id);
  await e.close();
  await sleep(100);
  const e2 = await join(app, { auth: reg2.body.token });
  assert.equal(e2.welcome.you.id, e.welcome.you.id);
  assert.equal(e2.welcome.you.isNew, false);

  // under 13: chat is off both ways (sys lines still arrive)
  const reg3 = await api('/api/auth/register', { username: 'young_one', password: 'keep-progress-3', birthYear: new Date().getFullYear() - 10 });
  assert.equal(reg3.status, 201);
  const k = await join(app, { auth: reg3.body.token });
  assert.equal(k.welcome.you.chat, false);
  k.send({ t: 'chat', text: 'hi', ch: 'global' });
  assert.equal((await k.wait((m) => m.t === 'deny' && m.of === 'chat')).reason, 'restricted');
  d.send({ t: 'chat', text: 'hello all', ch: 'global' });
  await e2.wait((m) => m.t === 'chat' && m.text === 'hello all');
  await sleep(150);
  assert.ok(!k.msgs.some((m) => m.t === 'chat' && m.text === 'hello all'));

  // a bad account token is just a guest
  const x = await join(app, { auth: 'ous_' + 'x'.repeat(40) });
  assert.equal(x.welcome.you.guest, true);
  assert.match(x.welcome.you.token, /^[A-Za-z0-9_-]{43}$/);
  for (const c of [d, e2, k, x]) c.close();
});

test('same token in a second tab replaces the first session', async (t) => {
  const app = await boot({ DATA_DIR: tempDir(), SIM: 'stub' }, { terrain: 'flat' });
  t.after(() => app.shutdown('test'));
  const a = await join(app, { name: 'Twin' });
  const b = await join(app, { token: a.welcome.you.token, name: 'Twin' });
  assert.equal(b.welcome.you.id, a.welcome.you.id);
  const err = await a.wait('error');
  assert.equal(err.code, 'replaced');
  assert.equal((await a.closedP).code, 4005);
  const h = await (await fetch(app.url + '/healthz')).json();
  assert.equal(h.players, 1);
  b.close();
});

test('healthz + static files: MIME, cache headers, br/gzip, 304, traversal, 404', async (t) => {
  const stat = tempDir('ou-static-');
  fs.mkdirSync(path.join(stat, 'assets'));
  fs.writeFileSync(path.join(stat, 'index.html'), `<!doctype html><title>Ø</title>${'<p>hello</p>'.repeat(200)}`);
  const js = `export const x = ${JSON.stringify('y'.repeat(4000))};`;
  fs.writeFileSync(path.join(stat, 'assets', 'index-AbC123_x.js'), js);
  fs.writeFileSync(path.join(stat, 'manifest.webmanifest'), '{"name":"Ø"}');
  fs.writeFileSync(path.join(stat, 'font.woff2'), Buffer.alloc(3000, 7));
  const app = await boot({ DATA_DIR: tempDir(), SIM: 'stub', STATIC_DIR: stat }, { terrain: 'flat' });
  t.after(() => app.shutdown('test'));

  const h = await fetch(app.url + '/healthz');
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('cache-control'), 'no-store');
  const hj = await h.json();
  assert.equal(hj.ok, true);
  assert.equal(hj.players, 0);
  assert.ok(hj.uptime >= 0);
  assert.equal(hj.sim, 'stub');
  assert.equal(hj.store, 'json');

  const idx = await fetch(app.url + '/?mode=explore');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type'), /^text\/html/);
  assert.equal(idx.headers.get('cache-control'), 'no-cache');
  assert.match(await idx.text(), /<title>Ø<\/title>/);

  // raw request (fetch would transparently decompress): brotli body + immutable cache
  const raw = await new Promise((resolve, reject) => {
    import('node:http').then(({ get }) =>
      get(app.url + '/assets/index-AbC123_x.js', { headers: { 'accept-encoding': 'gzip, br' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
      }).on('error', reject),
    );
  });
  assert.equal(raw.res.statusCode, 200);
  assert.match(raw.res.headers['content-type'], /^text\/javascript/);
  assert.equal(raw.res.headers['content-encoding'], 'br');
  assert.equal(raw.res.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(raw.res.headers.vary, 'Accept-Encoding');
  assert.equal(zlib.brotliDecompressSync(raw.body).toString(), js);
  assert.ok(raw.body.length < js.length / 10);

  const gz = await fetch(app.url + '/assets/index-AbC123_x.js', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(gz.headers.get('content-encoding'), 'gzip');
  assert.equal(await gz.text(), js);

  const etag = gz.headers.get('etag');
  const nm = await fetch(app.url + '/assets/index-AbC123_x.js', { headers: { 'if-none-match': etag } });
  assert.equal(nm.status, 304);

  const man = await fetch(app.url + '/manifest.webmanifest');
  assert.match(man.headers.get('content-type'), /^application\/manifest\+json/);
  assert.equal(man.headers.get('cache-control'), 'public, max-age=3600');
  const font = await fetch(app.url + '/font.woff2', { headers: { 'accept-encoding': 'br' } });
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal(font.headers.get('content-encoding'), null); // already compressed format
  assert.equal((await font.arrayBuffer()).byteLength, 3000);

  assert.equal((await fetch(app.url + '/nope.js')).status, 404);
  assert.equal((await fetch(app.url + '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
  assert.equal((await fetch(app.url + '/assets/%00x')).status, 400);
  assert.equal((await fetch(app.url + '/', { method: 'POST' })).status, 405);
  const api = await fetch(app.url + '/api/nothing');
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type'), /json/);
  const head = await fetch(app.url + '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
});

test('ws guards: path, origin, oversize frame, junk + flooding → 1008', async (t) => {
  const app = await boot({ DATA_DIR: tempDir(), SIM: 'stub', ALLOWED_ORIGINS: 'https://friends.example' }, { terrain: 'flat', local: false });
  t.after(() => app.shutdown('test'));
  const host = new URL(app.url).host;

  await assert.rejects(client(app.url.replace('http', 'ws') + '/other').opened, { status: 404 });
  await assert.rejects(client(app.wsUrl, { origin: 'https://evil.example' }).opened, { status: 403 });
  await client(app.wsUrl, { origin: 'https://friends.example' }).opened; // allow list
  const same = client(app.wsUrl, { origin: `http://${host}` }); // same host
  await same.opened;
  same.close();

  // frames > 16 kB are refused by ws (1009)
  const big = await join(app, { name: 'Big' });
  big.send({ t: 'chat', text: 'x'.repeat(20000) });
  assert.equal((await big.closedP).code, 1009);

  // a flood of junk is dropped, then the socket is closed with 1008 (no deflate: frames are handled synchronously)
  const f = await join(app, { name: 'Flood' }, { deflate: false });
  for (let i = 0; i < 400; i++) f.ws.send(i % 2 ? 'not json' : JSON.stringify({ t: 'ping', ct: i }));
  const err = await f.wait('error', 4000);
  assert.equal(err.code, 'protocol');
  assert.equal((await f.closedP).code, 1008);
  const pongs = f.msgs.filter((m) => m.t === 'pong').length;
  assert.ok(pongs <= 62, `rate limited pongs: ${pongs}`);

  // the server is still fine
  const ok = await join(app, { name: 'Fine' });
  assert.equal(ok.welcome.t, 'welcome');
  ok.close();
});

test('capacity: player 51 gets error {code:"full"}', async (t) => {
  const app = await boot({ DATA_DIR: tempDir(), SIM: 'stub', MAX_CONNS_PER_IP: '200' }, { terrain: 'flat', deflate: false });
  t.after(() => app.shutdown('test'));
  const cs = [];
  for (let i = 0; i < 50; i++) cs.push(join(app, { name: `Bot ${i}` }));
  const joined = await Promise.all(cs);
  assert.ok(joined.every((c) => c.welcome.t === 'welcome'));
  const extra = await join(app, { name: 'Late' });
  assert.equal(extra.welcome.t, 'error');
  assert.equal(extra.welcome.code, 'full');
  assert.equal((await extra.closedP).code, 4003);
  for (const c of joined) c.close();
});

test('process: SIGTERM (twice, like npm run / timeout / Ctrl+C deliver it) saves, tells clients, exits 0', async () => {
  const dir = tempDir();
  const child = spawn(process.execPath, [path.join(HERE, 'index.js'), '--local'], {
    env: { ...process.env, PORT: '0', DATA_DIR: dir, SIM: 'stub', LOG_FORMAT: 'json', LOG_LEVEL: 'info', TERRAIN_CACHE_DIR: TERRAIN_CACHE, STATIC_DIR: path.join(dir, 'nostatic') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 20000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /"url":"(http:\/\/[^"]+)"/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => reject(new Error(`exited early (${code}):\n${out}`)));
  });
  for (const line of out.trim().split('\n')) JSON.parse(line); // structured logs
  const page = await fetch(url + '/');
  assert.match(await page.text(), /npm run build/); // placeholder page without a build
  const app = { wsUrl: url.replace('http', 'ws') + '/ws' };
  const a = await join(app, { name: 'Leaver' });
  const id = a.welcome.you.id;
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGTERM'), 30); // the duplicate must not skip the final save
  const err = await a.wait('error', 8000);
  assert.equal(err.code, 'shutdown');
  assert.equal((await a.closedP).code, 1012);
  assert.equal(await exited, 0);
  assert.ok(fs.existsSync(path.join(dir, 'players', `${id}.json`)));
  assert.ok(fs.existsSync(path.join(dir, 'world.json')));
  assert.match(out, /server stopped/);
  assert.doesNotMatch(out, /second signal/);
});
