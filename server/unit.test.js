// Unit tests: config, filter, rate limit, schema, encoding pick, terrain queries, world provider, JSON + Postgres stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { filterText, cleanName, cleanText } from './filter.js';
import { TokenBucket } from './ratelimit.js';
import { validate, cleanAppearance } from './schema.js';
import { pickEncoding, ByteLRU } from './http.js';
import { createTerrainQueries } from './terrain.js';
import { loadWorldgen } from './worldgen.js';
import { loadConfig } from './config.js';
import { createJsonStore } from './store/json.js';
import { createPgStore, SCHEMA_SQL } from './store/pg.js';
import { createLogger } from './log.js';
import { tempDir } from './testkit.js';

const log = createLogger({ level: 'silent' });

test('chat filter masks en + nl words, keeps innocent words', () => {
  assert.equal(filterText('wat een KUT spel'), 'wat een *** spel');
  assert.equal(filterText('motherfuckers!'), '*************!');
  assert.equal(filterText('you ass!'), 'you ***!');
  assert.equal(filterText('5h1t happens'), '**** happens');
  assert.equal(filterText('kankerlijer'), '***********');
  assert.equal(filterText('hello 👋 fuck 👋'), 'hello 👋 **** 👋');
  for (const ok of ['peacock lullaby spike assistant', 'hoera catering flikkeren', 'assen en pikken', 'Dikke vette pret', '100% top']) {
    assert.equal(filterText(ok), ok, ok);
  }
});

test('names: 2–20 chars, cleaned, bad words rejected', () => {
  assert.equal(cleanName('  Al '), 'Al');
  assert.equal(cleanName('A'), null);
  assert.equal(cleanName('Kut'), null);
  assert.equal(cleanName('f.u.c.k'), null);
  assert.equal(cleanName('Nova_7'), 'Nova_7');
  assert.equal(cleanName('ZeerLangeNaamDieTeLangIsVoorHetSpel').length, 20);
  assert.equal(cleanName('<script>'), 'script');
  assert.equal(cleanName('!!!'), null);
  assert.equal(cleanName(42), null);
  assert.equal(cleanText('a\u0000b\n\n c ‮ d', 200), 'a b c d');
  assert.equal(Array.from(cleanText('😀'.repeat(300), 200)).length, 200);
});

test('token bucket: burst then refill', () => {
  const b = new TokenBucket({ burst: 5, perSec: 0.5 }, 0);
  for (let i = 0; i < 5; i++) assert.ok(b.take(0));
  assert.equal(b.take(0), false);
  assert.equal(b.take(1000), false); // 0.5 token
  assert.ok(b.take(2000)); // 1 token
  assert.equal(b.take(2000), false);
});

test('schema: accepts protocol messages, rejects junk', () => {
  assert.equal(validate({ t: 'state', p: [1, 2, 3], h: 0.5, a: 'walk', m: 'foot' }), null);
  assert.equal(validate({ t: 'state', p: [1, 2, 3] }), null);
  assert.equal(validate({ t: 'state', p: [1, 2] }), 'schema');
  assert.equal(validate({ t: 'state', p: [1, NaN, 3] }), 'schema');
  assert.equal(validate({ t: 'state', p: [1e9, 0, 0] }), 'schema');
  assert.equal(validate({ t: 'fire', w: 'pulse-pistol', o: [0, 1, 0], d: [0, 0, -1], seq: 3, ct: 1 }), null);
  assert.equal(validate({ t: 'fire', w: 'pulse-pistol', o: [0, 1, 0], d: [0, 0, -1] }), 'schema');
  assert.equal(validate({ t: 'grant', source: 'quest', id: 'q1', amounts: { credits: 5, res: { metal: 3 }, items: ['decor-statue'] } }), null);
  assert.equal(validate({ t: 'spend', reason: 'sell', id: 'decor-statue' }), null);
  assert.equal(validate({ t: 'build:place', piece: 'wall', p: [0, 0, 0], rot: 0, cid: 7 }), null);
  assert.equal(validate({ t: 'equip', w: 'plasma-rifle' }), null);
  assert.equal(validate({ t: 'equip', slot: 2 }), null);
  assert.equal(validate({ t: 'chat', text: 'x'.repeat(5000) }), 'schema');
  assert.equal(validate({ t: 'travel', to: 'hub' }), null);
  assert.equal(validate({ t: 'travel', to: 'wild', cid: 3 }), null);
  assert.equal(validate({ t: 'travel' }), 'schema');
  assert.equal(validate({ t: 'travel', to: { x: 1 } }), 'schema');
  assert.equal(validate({ t: 'nope' }), 'type');
  assert.equal(validate({ x: 1 }), 'type');
  assert.equal(validate(null), 'type');
  assert.deepEqual(cleanAppearance({ body: 'f', height: 1.02, glasses: false }), { body: 'f', height: 1.02, glasses: false });
  assert.equal(cleanAppearance({ a: 'x'.repeat(100) }), null);
  assert.equal(cleanAppearance([1, 2]), null);
  assert.equal(cleanAppearance({ deep: { deeper: { deepest: 1 } } }), null);
});

test('http helpers: Accept-Encoding pick + byte LRU', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip;q=1.0, br;q=0'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(undefined), null);
  const lru = new ByteLRU(100);
  lru.set('a', Buffer.alloc(20));
  lru.set('b', Buffer.alloc(20));
  lru.get('a');
  lru.set('c', Buffer.alloc(20));
  lru.set('d', Buffer.alloc(20));
  lru.set('e', Buffer.alloc(20)); // 100 → still fits
  lru.set('f', Buffer.alloc(20)); // evicts the least recently used: b
  assert.equal(lru.get('b'), undefined);
  assert.ok(lru.get('a'));
  assert.ok(lru.bytes <= 100);
});

test('terrain queries on a tiny grid (bilinear heights, water, river)', () => {
  const N = 5;
  const heights = new Float32Array(N * N).fill(2);
  heights[2 * N + 2] = -3; // a pit in the centre
  const river = { i0: 0, j0: 0, w: 1, h: 1, dist: new Float32Array([1e9]), water: new Float32Array([0]), halfWidth: new Float32Array([0]), cap: new Uint8Array([0]) };
  const q = createTerrainQueries({ N, STEP: 2, HALF: 4, heights, river }, 0);
  assert.equal(q.getHeightAt(-4, -4), 2);
  assert.equal(q.getHeightAt(0, 0), -3);
  assert.equal(q.getHeightAt(1, 0), -0.5); // half way to the neighbour
  assert.equal(q.getHeightAt(1e6, 1e6), 2); // clamped at the edge
  assert.equal(q.getHeightAt(NaN, 0), q.getHeightAt(-4, 0));
  assert.equal(q.isWater(0, 0), true);
  assert.equal(q.isWater(-4, -4), false);
  assert.equal(q.getWaterHeightAt(0, 0), 0);
  assert.equal(q.getWaterHeightAt(-4, -4), null);
});

test('world provider (§11): shared/worldgen | shared/sim stand-in | bare hub — one planet, safe hub square', async () => {
  const hub = { getHeightAt: (x) => 4 + x * 0.001, isWater: (x) => x < -500 && x > -600, getWaterHeightAt: () => null };
  // last resort: the bare hub heightfield, no generator handed to the sim
  const bare = await loadWorldgen({ hub, seed: 'x', log, mode: 'hub' });
  assert.equal(bare.source, 'hub');
  assert.equal(bare.impl, null);
  assert.equal(bare.heightAt(5000, 0), hub.getHeightAt(5000, 0));
  assert.equal(bare.isSafe(1099, -1099), true); // the hub is a square (shared/defs/world.js HUB.half)
  assert.equal(bare.isSafe(1101, 0), false);
  assert.equal(bare.biomeAt(0, 0), 'hub');

  // the stand-in (shared/sim/standin.js): the hub inside, endless terrain outside
  const st = await loadWorldgen({ hub, seed: 'test', log, mode: 'standin' });
  assert.equal(st.source, 'standin');
  assert.ok(st.impl && typeof st.impl.heightAt === 'function');
  assert.equal(st.heightAt(100, 200), hub.getHeightAt(100, 200));
  assert.equal(st.isWater(-550, 0), true);
  assert.equal(st.isWater(550, 0), false);
  assert.equal(st.isSafe(800, 800), true);
  assert.equal(st.isSafe(0, -1101), false);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 300; i++) {
    const h = st.heightAt(-40000 + i * 263, 25000 - i * 171);
    assert.ok(Number.isFinite(h));
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  assert.ok(hi - lo > 5, `varied terrain beyond the hub: ${lo.toFixed(1)}…${hi.toFixed(1)}`);
  const st2 = await loadWorldgen({ hub, seed: 'test', log, mode: 'standin' });
  assert.equal(st2.heightAt(5000, 5000), st.heightAt(5000, 5000)); // deterministic per seed

  // auto: shared/worldgen when it exists, else the stand-in — always finite, safe hub, unsafe wilds
  const auto = await loadWorldgen({ hub, seed: 'x', log });
  assert.ok(['worldgen', 'standin'].includes(auto.source));
  for (const [x, z] of [[0, 150], [1200, 0], [-3000, 9000]]) assert.ok(Number.isFinite(auto.heightAt(x, z)));
  assert.equal(auto.isSafe(0, 150), true);
  assert.equal(auto.isSafe(0, 5000), false);
  // a forced source that can't load stops the server instead of silently changing the world
  if (auto.source !== 'worldgen') await assert.rejects(loadWorldgen({ hub, seed: 'x', log, mode: 'worldgen' }));
  else {
    // shared/worldgen: the hub heightfield inside, the rules + resources the sim picks up, deterministic per seed
    assert.equal(auto.heightAt(100, 200), hub.getHeightAt(100, 200));
    assert.equal(auto.heightAt(-1050, 990), hub.getHeightAt(-1050, 990));
    assert.equal(typeof auto.impl.isBuildable, 'function');
    assert.ok(typeof auto.impl.nodesNear === 'function' || typeof auto.impl.chunk === 'function', 'resource nodes');
    assert.ok(typeof auto.impl.spawnRules === 'function' || typeof auto.impl.spawnTable === 'function', 'spawn rules');
    assert.equal(auto.impl.isBuildable(0, 150).ok, false); // never inside the hub
    const again = await loadWorldgen({ hub, seed: 'x', log, mode: 'worldgen' });
    assert.equal(again.heightAt(4321, -8765), auto.heightAt(4321, -8765));
  }
});

test('config: npm run server = 127.0.0.1:8080, production = 0.0.0.0, env overrides', () => {
  const local = loadConfig(['--local'], {});
  assert.equal(local.port, 8080);
  assert.equal(local.host, '127.0.0.1');
  assert.equal(local.local, true);
  assert.equal(local.trustProxy, false);
  assert.ok(local.staticDir.endsWith(`${path.sep}dist`));
  assert.ok(local.dataDir.endsWith(`${path.sep}data`));
  const prod = loadConfig([], { PORT: '3000', DATA_DIR: '/data', ALLOWED_ORIGINS: 'https://a.example/, https://B.example', WORLDGEN: 'standin' });
  assert.equal(prod.port, 3000);
  assert.equal(prod.host, '0.0.0.0');
  assert.equal(prod.dataDir, '/data');
  assert.equal(prod.trustProxy, true);
  assert.deepEqual(prod.allowedOrigins, ['https://a.example', 'https://b.example']);
  assert.equal(prod.worldgen, 'standin');
  assert.equal(loadConfig([], { RAILWAY_VOLUME_MOUNT_PATH: '/vol' }).dataDir, '/vol');
});

test('JSON store: players, tokens, partial saves, world + corrupt fallback, index repair', async () => {
  const dir = tempDir();
  let s = await createJsonStore({ dir, log });
  const a = await s.createPlayer({ tokenHash: 'h1', name: 'Ann', appearance: { body: 'f' } });
  const b = await s.createPlayer({ tokenHash: 'h2', name: 'Bo', appearance: null });
  assert.equal(a.id, 'p1');
  assert.equal(b.id, 'p2');
  assert.equal(await s.getPlayerByToken('nope'), null);
  await s.savePlayer('p1', { save: { p: [1, 2, 3], inv: { credits: 7 } } });
  await s.savePlayer('p1', { name: 'Anna' }); // partial: keeps the save
  const got = await s.getPlayerByToken('h1');
  assert.equal(got.name, 'Anna');
  assert.deepEqual(got.save, { p: [1, 2, 3], inv: { credits: 7 } });
  assert.deepEqual(got.appearance, { body: 'f' });
  await assert.rejects(s.savePlayer('p99', { name: 'x' }));
  assert.equal(await s.loadWorld(), null);
  await s.saveWorld({ structures: [{ id: 's1' }] });
  await s.saveWorld({ structures: [{ id: 's1' }, { id: 's2' }] });
  assert.equal((await s.loadWorld()).structures.length, 2);
  assert.ok((await s.worldUpdatedAt()) > 0);
  await s.close();

  // restart: index from tokens.log; ids continue
  s = await createJsonStore({ dir, log });
  assert.equal((await s.getPlayerByToken('h2')).name, 'Bo');
  assert.equal((await s.createPlayer({ tokenHash: 'h3', name: 'Cy' })).id, 'p3');
  await s.close();

  // lost index → rebuilt from the player files
  fs.rmSync(path.join(dir, 'players', 'tokens.log'));
  s = await createJsonStore({ dir, log });
  assert.equal((await s.getPlayerByToken('h3')).id, 'p3');
  assert.equal((await s.createPlayer({ tokenHash: 'h4', name: 'Di' })).id, 'p4');

  // corrupt world.json → world.prev.json (copied on the first save of a run) + a kept copy
  await s.saveWorld({ structures: [{ id: 'keep' }] });
  fs.writeFileSync(path.join(dir, 'world.json'), '{"broken');
  const w = await s.loadWorld();
  assert.ok(Array.isArray(w.structures));
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('world.json.corrupt-')));
  await s.close();
  // no temp files left behind
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

/** In-memory stand-in for pg.Pool that understands the store's statements. */
class FakePool {
  constructor() {
    this.players = new Map();
    this.world = new Map();
    this.seq = 0;
    this.sql = [];
    this.failConnects = 1; // the first connect fails (DB still booting)
  }
  on() {}
  async connect() {
    if (this.failConnects-- > 0) throw new Error('ECONNREFUSED');
    return { query: (q, a) => this.query(q, a), release: () => {} };
  }
  async end() {
    this.ended = true;
  }
  async query(text, args = []) {
    const q = text.replace(/\s+/g, ' ').trim();
    this.sql.push(q);
    if (/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory_xact_lock|CREATE )/.test(q)) return { rows: [], rowCount: 0 };
    if (q.startsWith('SELECT id, data FROM world WHERE id = $1 OR id = $2'))
      return { rows: args.filter((id) => this.world.has(id)).map((id) => ({ id, data: JSON.parse(JSON.stringify(this.world.get(id).data)) })) };
    if (q.startsWith('SELECT id, updated_at FROM world WHERE id = $1 OR id = $2'))
      return { rows: args.filter((id) => this.world.has(id)).map((id) => ({ id, updated_at: this.world.get(id).updated_at })) };
    if (q.startsWith('INSERT INTO world')) {
      this.world.set(args[0], { data: JSON.parse(args[1]), updated_at: new Date() });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith('SELECT id, name, appearance, save, created_at, last_seen FROM players WHERE token_hash')) {
      const r = [...this.players.values()].find((p) => p.token_hash === args[0]);
      return { rows: r ? [{ ...r }] : [] };
    }
    if (q.startsWith('INSERT INTO players')) {
      if ([...this.players.values()].some((p) => p.token_hash === args[0])) throw new Error('duplicate key');
      const id = `p${++this.seq}`;
      const row = { id, token_hash: args[0], name: args[1], appearance: JSON.parse(args[2]), save: null, created_at: new Date(), last_seen: new Date() };
      this.players.set(id, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (q.startsWith('UPDATE players SET')) {
      const row = this.players.get(args[0]);
      if (!row) return { rows: [], rowCount: 0 };
      const sets = q.slice('UPDATE players SET '.length, q.indexOf(' WHERE')).split(', ');
      for (const set of sets) {
        const m = /^(\w+) = \$(\d+)/.exec(set);
        if (!m) continue;
        const v = args[Number(m[2]) - 1];
        row[m[1]] = m[1] === 'name' ? v : JSON.parse(v);
      }
      row.last_seen = new Date();
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`FakePool: unexpected SQL ${q}`);
  }
}

test('Postgres store (fake pool): schema on boot with retry, players, partial saves, world', async () => {
  const pool = new FakePool();
  const s = await createPgStore({ url: 'postgres://x', log, Pool: function () { return pool; }, retryMs: 1 });
  assert.equal(s.kind, 'postgres');
  // migration ran inside an advisory-locked transaction
  const i = pool.sql.indexOf('BEGIN');
  assert.ok(i >= 0);
  assert.match(pool.sql[i + 1], /pg_advisory_xact_lock/);
  assert.equal(pool.sql.filter((q) => q.startsWith('CREATE')).length, SCHEMA_SQL.length);
  assert.ok(SCHEMA_SQL.some((q) => /CREATE TABLE IF NOT EXISTS players/.test(q) && /token_hash TEXT NOT NULL UNIQUE/.test(q) && /appearance JSONB/.test(q) && /save JSONB/.test(q) && /last_seen/.test(q)));
  assert.ok(SCHEMA_SQL.some((q) => /CREATE TABLE IF NOT EXISTS world/.test(q) && /data JSONB/.test(q) && /updated_at/.test(q)));

  const a = await s.createPlayer({ tokenHash: 'hh', name: 'Ann', appearance: { body: 'f' } });
  assert.equal(a.id, 'p1');
  assert.deepEqual(a.appearance, { body: 'f' });
  await s.savePlayer('p1', { save: { p: [1, 2, 3] } });
  await s.savePlayer('p1', { name: 'Anna' });
  const got = await s.getPlayerByToken('hh');
  assert.equal(got.name, 'Anna');
  assert.deepEqual(got.save, { p: [1, 2, 3] });
  assert.equal(await s.getPlayerByToken('zz'), null);
  await assert.rejects(s.savePlayer('p9', { name: 'x' }));
  assert.equal(await s.loadWorld(), null);
  assert.equal(await s.worldUpdatedAt(), 0);
  // a pre-§11 save (row id 'hub') is read until the first save of the one world (row id 'world')
  pool.world.set('hub', { data: { structures: ['old'] }, updated_at: new Date(1000) });
  assert.deepEqual(await s.loadWorld(), { structures: ['old'] });
  assert.equal(await s.worldUpdatedAt(), 1000);
  await s.saveWorld({ structures: [1, 2] }); // arrays must survive as JSON (not a PG array)
  assert.ok(pool.world.has('world'));
  assert.deepEqual(await s.loadWorld(), { structures: [1, 2] });
  assert.ok((await s.worldUpdatedAt()) > 1000);
  await s.close();
  assert.ok(pool.ended);
});
