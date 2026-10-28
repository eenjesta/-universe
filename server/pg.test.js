// Postgres store against a REAL database — skipped unless TEST_DATABASE_URL is set:
//   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres node --test server/pg.test.js
// Every run creates its own throw-away database (ou_test_<random>) and drops it afterwards,
// so it is safe against a shared server. (The fake-pool unit test in unit.test.js always runs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPgStore } from './store/pg.js';
import { boot, join, sleep } from './testkit.js';

const BASE = process.env.TEST_DATABASE_URL || '';
const skip = BASE ? false : 'TEST_DATABASE_URL not set (no Postgres available)';
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child: () => quiet, throttle: () => quiet };

async function withDatabase(fn) {
  const pg = (await import('pg')).default;
  const name = `ou_test_${crypto.randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(BASE);
  url.pathname = `/${name}`;
  try {
    return await fn(url.toString());
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
}

test('Postgres store (real database): concurrent schema boot, players, partial saves, world, legacy hub row', { skip }, async () => {
  await withDatabase(async (url) => {
    // two instances booting at once (deploy overlap) both get the schema without racing
    const [a, b] = await Promise.all([createPgStore({ url, log: quiet }), createPgStore({ url, log: quiet })]);
    await b.close();
    try {
      assert.equal(a.kind, 'postgres');
      assert.equal(await a.loadWorld(), null);
      assert.equal(await a.worldUpdatedAt(), 0);
      assert.equal(await a.getPlayerByToken('nope'), null);

      const p1 = await a.createPlayer({ tokenHash: 'h1', name: 'Ada', appearance: { body: 'f', skin: '#c68e67' } });
      const p2 = await a.createPlayer({ tokenHash: 'h2', name: 'Bo' });
      assert.match(p1.id, /^p\d+$/);
      assert.notEqual(p1.id, p2.id);
      assert.deepEqual(p1.appearance, { body: 'f', skin: '#c68e67' });
      assert.equal(p1.save, null);
      await assert.rejects(a.createPlayer({ tokenHash: 'h1', name: 'Dup' }), /duplicate|unique/i);

      const save = { p: [12.5, 3, -40], h: 1.2, stats: { hp: 80 }, inv: { res: { metal: 9 }, credits: 1500 }, note: 'Ø — ünïcode ✓' };
      await a.savePlayer(p1.id, { save });
      await a.savePlayer(p1.id, { name: 'Ada2' }); // partial: the save stays
      const r1 = await a.getPlayerByToken('h1');
      assert.equal(r1.id, p1.id);
      assert.equal(r1.name, 'Ada2');
      assert.deepEqual(r1.save, save);
      assert.deepEqual(r1.appearance, { body: 'f', skin: '#c68e67' });
      assert.ok(r1.lastSeen >= r1.createdAt);
      await a.savePlayer(p1.id, { appearance: null });
      assert.equal((await a.getPlayerByToken('h1')).appearance, null);
      await assert.rejects(a.savePlayer('p999999', { name: 'x' }), /unknown player/);

      // a pre-§11 world saved under id 'hub' is read until the first 'world' save
      const pg = (await import('pg')).default;
      const raw = new pg.Client({ connectionString: url });
      await raw.connect();
      await raw.query(`INSERT INTO world (id, data, updated_at) VALUES ('hub', $1::jsonb, now() - interval '1 hour')`, [JSON.stringify({ legacy: true })]);
      assert.deepEqual(await a.loadWorld(), { legacy: true });
      const tLegacy = await a.worldUpdatedAt();
      assert.ok(tLegacy > 0);
      const world = { structures: [{ id: 's1', type: 'wall', p: [1, 2, 3] }], claims: [], v: 2 };
      await a.saveWorld(world);
      assert.deepEqual(await a.loadWorld(), world);
      assert.ok((await a.worldUpdatedAt()) > tLegacy);
      const { rows } = await raw.query('SELECT id FROM world ORDER BY id');
      assert.deepEqual(rows.map((r) => r.id), ['hub', 'world']);
      await raw.end();
      assert.equal(a.stats().kind, 'postgres');
    } finally {
      await a.close();
    }
  });
});

test('server on Postgres: a guest reconnects after a restart with position + credits (and the platform tables)', { skip, timeout: 120_000 }, async () => {
  await withDatabase(async (url) => {
    let app = await boot({ DATABASE_URL: url, SIM: 'real' });
    let token;
    let id;
    let x;
    let credits;
    try {
      assert.equal(app.store.kind, 'postgres');
      const a = await join(app, { name: 'PgSaver' });
      assert.equal(a.welcome.t, 'welcome');
      token = a.welcome.you.token;
      id = a.welcome.you.id;
      const p = a.welcome.you.p;
      x = p[0] + 6;
      credits = a.welcome.inv.credits + 120;
      a.send({ t: 'state', p: [p[0] + 3, p[1], p[2]], h: 0, m: 'foot' });
      await sleep(120);
      a.send({ t: 'state', p: [x, p[1], p[2]], h: 0, m: 'foot' });
      a.send({ t: 'grant', source: 'quest', id: 'pg-persist', amounts: { credits: 120 } });
      await a.wait((m) => m.t === 'inv' && m.credits === credits);
      await sleep(100);
      await a.close();
    } finally {
      await app.shutdown('test');
    }
    app = await boot({ DATABASE_URL: url, SIM: 'real' });
    try {
      const b = await join(app, { token, name: 'PgSaver' });
      assert.equal(b.welcome.you.id, id);
      assert.equal(b.welcome.you.isNew, false);
      assert.equal(b.welcome.inv.credits, credits);
      assert.ok(Math.abs(b.welcome.you.p[0] - x) < 0.05, `x restored: ${b.welcome.you.p[0]} vs ${x}`);
      await b.close();
      // the platform layer shares the database (its own tables)
      const pg = (await import('pg')).default;
      const raw = new pg.Client({ connectionString: url });
      await raw.connect();
      const { rows } = await raw.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
      await raw.end();
      const tables = new Set(rows.map((r) => r.table_name));
      for (const t of ['players', 'world']) assert.ok(tables.has(t), `table ${t}`);
      if (app.platform) assert.ok(tables.has('users'), 'platform table users');
    } finally {
      await app.shutdown('test');
    }
  });
});
