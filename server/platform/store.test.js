/**
 * Store conformance: the same suite runs against the JSON store, the Postgres
 * store on a fake pool, and — with TEST_DATABASE_URL — a real Postgres.
 * Plus JSON persistence (reopen, atomic files, corrupt collections) and the
 * Postgres schema / BIGINT mapping.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createJsonStore } from './store/json.js';
import { createPgStore } from './store/pg.js';
import { createFakePool } from './fake-pg.js';
import { tempDir } from './testkit.js';

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

async function makeStore(kind) {
  if (kind === 'json') {
    const dir = await tempDir();
    const store = createJsonStore({ dataDir: dir, log: quiet, flushMs: 5 });
    await store.init();
    return { store, cleanup: async () => (await store.close(), fsp.rm(dir, { recursive: true, force: true })), dir };
  }
  if (kind === 'pg-fake') {
    const pool = createFakePool();
    const store = await createPgStore({ pool, log: quiet });
    await store.init();
    return { store, cleanup: () => store.close(), pool };
  }
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3 });
  const tablePrefix = `s${Date.now().toString(36)}_`;
  const store = await createPgStore({ pool, log: quiet, tablePrefix });
  await store.init();
  return {
    store,
    cleanup: async () => {
      for (const t of ['reports', 'likes', 'experience_versions', 'experiences', 'friends', 'sessions', 'users']) await pool.query(`DROP TABLE IF EXISTS ${tablePrefix}${t} CASCADE`);
      await pool.end();
    },
  };
}

const KINDS = ['json', 'pg-fake', ...(process.env.TEST_DATABASE_URL ? ['pg'] : [])];
const T0 = 1_790_000_000_000;
const user = (id, username, extra = {}) => ({ id, username, passwordHash: 'scrypt$x', birthYear: 1990, guestTokenHash: null, guestLinkedAt: null, restrictions: null, createdAt: T0, updatedAt: T0, ...extra });
const meta = (id, ownerId, ownerName, extra = {}) => ({
  id, ownerId, ownerName, title: `T ${id}`, description: '', maxPlayers: 20, builtin: false, version: 0, plays: 0, likes: 0,
  partCount: 0, size: 0, thumbRev: 0, draftSavedAt: T0, createdAt: T0, updatedAt: T0, publishedAt: null, ...extra,
});
const doc = (n) => ({ format: 'o-universe-experience', v: 1, meta: { title: 'D', description: '', maxPlayers: 20 }, parts: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, type: 'block' })), groups: [], logic: [] });

for (const kind of KINDS) {
  describe(`store conformance (${kind})`, () => {
    let s;
    let ctx;
    before(async () => {
      ctx = await makeStore(kind);
      s = ctx.store;
      await s.createUser(user('u1', 'ann'));
      await s.createUser(user('u2', 'bob', { guestTokenHash: 'g'.repeat(64), guestLinkedAt: T0 }));
      await s.createUser(user('u3', 'cat'));
    });
    after(() => ctx.cleanup());

    test('users: create, lookups, conflicts, update', async () => {
      assert.equal((await s.getUser('u1')).username, 'ann');
      assert.equal((await s.getUserByName('bob')).id, 'u2');
      assert.equal((await s.getUserByGuestHash('g'.repeat(64))).id, 'u2');
      assert.equal(await s.getUser('nope'), null);
      assert.equal(await s.getUserByName('nope'), null);
      const u = await s.getUser('u2');
      assert.equal(typeof u.createdAt, 'number');
      assert.equal(u.guestLinkedAt, T0);
      assert.deepEqual((await s.getUsers(['u1', 'u3', 'zz'])).map((x) => x.id).sort(), ['u1', 'u3']);
      assert.deepEqual(await s.getUsers([]), []);
      await assert.rejects(s.createUser(user('u9', 'ann')), (e) => e.conflict && e.code === 'name_taken');
      await assert.rejects(s.createUser(user('u8', 'dan', { guestTokenHash: 'g'.repeat(64) })), (e) => e.conflict && e.code === 'guest_linked');
      const up = await s.updateUser('u3', { restrictions: { chat: true }, updatedAt: T0 + 5 });
      assert.deepEqual(up.restrictions, { chat: true });
      assert.equal(up.passwordHash, 'scrypt$x', 'untouched fields kept');
      assert.equal(up.updatedAt, T0 + 5);
      assert.equal(await s.updateUser('nope', { updatedAt: 1 }), null);
    });

    test('sessions: create, get, touch, delete, prune', async () => {
      await s.createSession({ tokenHash: 'h1', userId: 'u1', createdAt: T0, expiresAt: T0 + 100, lastUsedAt: T0 });
      await s.createSession({ tokenHash: 'h2', userId: 'u1', createdAt: T0, expiresAt: T0 + 10, lastUsedAt: T0 });
      await s.createSession({ tokenHash: 'h3', userId: 'u2', createdAt: T0, expiresAt: T0 + 100, lastUsedAt: T0 });
      assert.deepEqual(await s.getSession('h1'), { tokenHash: 'h1', userId: 'u1', createdAt: T0, expiresAt: T0 + 100, lastUsedAt: T0 });
      await s.touchSession('h1', T0 + 50, T0 + 500);
      assert.equal((await s.getSession('h1')).expiresAt, T0 + 500);
      assert.equal(await s.pruneSessions(T0 + 20), 1);
      assert.equal(await s.getSession('h2'), null);
      await s.deleteSession('h1');
      assert.equal(await s.getSession('h1'), null);
      assert.equal(await s.deleteUserSessions('u2'), 1);
      assert.equal(await s.getSession('h3'), null);
    });

    test('friends: upsert by pair, list for both sides, delete', async () => {
      await s.putFriendship({ lo: 'u1', hi: 'u2', requester: 'u2', status: 'pending', createdAt: T0, acceptedAt: null });
      assert.equal((await s.getFriendship('u2', 'u1')).status, 'pending', 'order-independent');
      await s.putFriendship({ lo: 'u1', hi: 'u2', requester: 'u2', status: 'accepted', createdAt: T0, acceptedAt: T0 + 1 });
      const f = await s.getFriendship('u1', 'u2');
      assert.deepEqual(f, { lo: 'u1', hi: 'u2', requester: 'u2', status: 'accepted', createdAt: T0, acceptedAt: T0 + 1 });
      await s.putFriendship({ lo: 'u2', hi: 'u3', requester: 'u3', status: 'pending', createdAt: T0, acceptedAt: null });
      assert.equal((await s.listFriendships('u2')).length, 2);
      assert.equal((await s.listFriendships('u1')).length, 1);
      assert.equal(await s.deleteFriendship('u3', 'u2'), true);
      assert.equal(await s.deleteFriendship('u3', 'u2'), false);
      assert.equal((await s.listFriendships('u3')).length, 0);
    });

    test('experiences: drafts, publish (versions immutable + pruned), thumbnails, likes, plays, delete cascade', async () => {
      await s.ensureExperience(meta('o-universe', null, null, { builtin: true, version: 1, publishedAt: T0 }));
      await s.ensureExperience(meta('o-universe', null, null, { builtin: true, version: 1, title: 'changed' }));
      assert.equal((await s.getExperience('o-universe')).builtin, true);
      const m = await s.createExperience(meta('x1', 'u1', 'ann'), { data: doc(2), savedAt: T0, size: 10, partCount: 2 });
      assert.equal(m.version, 0);
      assert.equal(m.draftSavedAt, T0);
      assert.equal((await s.getDraft('x1')).data.parts.length, 2);
      const saved = await s.saveDraft('x1', { data: doc(3), savedAt: T0 + 1, size: 11, partCount: 3 }, { title: 'New', description: 'D', maxPlayers: 8, updatedAt: T0 + 1 });
      assert.deepEqual([saved.title, saved.maxPlayers, saved.updatedAt], ['New', 8, T0 + 1]);
      assert.equal((await s.getDraft('x1')).partCount, 3);
      assert.equal(await s.getDraft('missing'), null);
      assert.equal(await s.saveDraft('missing', { data: doc(1), savedAt: 1, size: 1, partCount: 1 }, { title: 'x', description: '', maxPlayers: 1, updatedAt: 1 }), null);

      for (let i = 1; i <= 4; i++) {
        const r = await s.publishVersion('x1', { data: doc(i), size: 100 + i, partCount: i, createdAt: T0 + 10 * i }, 3);
        assert.equal(r.version.v, i);
        assert.equal(r.meta.version, i);
        assert.equal(r.meta.publishedAt, T0 + 10 * i);
      }
      assert.deepEqual((await s.listVersions('x1')).map((v) => v.v), [4, 3, 2], 'keeps the last 3');
      assert.equal(await s.getVersion('x1', 1), null, 'pruned');
      const v2 = await s.getVersion('x1', 2);
      assert.deepEqual([v2.v, v2.data.parts.length, v2.size, v2.createdAt], [2, 2, 102, T0 + 20]);
      assert.equal(await s.publishVersion('missing', { data: doc(1), size: 1, partCount: 1, createdAt: 1 }, 3), null);

      const th = await s.setThumbnail('x1', 'data:image/jpeg;base64,/9j/AA==', T0 + 99);
      assert.equal(th.thumbRev, T0 + 99);
      assert.deepEqual(await s.getThumbnail('x1'), { dataUrl: 'data:image/jpeg;base64,/9j/AA==', rev: T0 + 99 });
      await s.setThumbnail('x1', null, T0 + 100);
      assert.equal(await s.getThumbnail('x1'), null);

      assert.deepEqual(await s.setLike('x1', 'u2', true, T0), { changed: true, likes: 1 });
      assert.deepEqual(await s.setLike('x1', 'u2', true, T0), { changed: false, likes: 1 });
      assert.deepEqual(await s.setLike('x1', 'u3', true, T0), { changed: true, likes: 2 });
      assert.deepEqual(await s.setLike('x1', 'u3', false, T0), { changed: true, likes: 1 });
      assert.deepEqual(await s.setLike('x1', 'u3', false, T0), { changed: false, likes: 1 });
      assert.equal(await s.setLike('missing', 'u3', true, T0), null);
      assert.deepEqual([...(await s.likedBy('u2', ['x1', 'o-universe']))], ['x1']);
      assert.deepEqual([...(await s.likedBy('u2', []))], []);
      assert.equal(await s.addPlays('x1', 1), 1);
      assert.equal(await s.addPlays('x1', 2), 3);
      assert.equal(await s.addPlays('missing', 1), null);
      const up = await s.updateExperience('x1', { title: 'Renamed', description: 'dd', maxPlayers: 9, updatedAt: T0 + 200 });
      assert.deepEqual([up.title, up.likes, up.plays], ['Renamed', 1, 3]);

      assert.equal(await s.countExperiences('u1'), 1);
      assert.equal(await s.deleteExperience('x1'), true);
      assert.equal(await s.getExperience('x1'), null);
      assert.equal(await s.getVersion('x1', 4), null, 'versions cascade');
      assert.deepEqual([...(await s.likedBy('u2', ['x1']))], [], 'likes cascade');
      assert.equal(await s.deleteExperience('x1'), false);
    });

    test('listExperiences: published only, builtin excluded, sorts, search, owner, paging', async () => {
      const mk = async (id, owner, name, { title, plays = 0, likes = 0, pub, upd }) => {
        await s.createExperience(meta(id, owner, name, { title, updatedAt: upd ?? T0 }), null);
        if (pub) await s.publishVersion(id, { data: doc(1), size: 1, partCount: 1, createdAt: pub }, 5);
        if (plays) await s.addPlays(id, plays);
        for (let i = 0; i < likes; i++) await s.setLike(id, ['u1', 'u2', 'u3'][i], true, T0);
      };
      await mk('la', 'u1', 'ann', { title: 'Alpha 100%', plays: 5, pub: T0 + 1 });
      await mk('lb', 'u2', 'bob', { title: 'Beta_run', likes: 1, pub: T0 + 2 });
      await mk('lc', 'u2', 'bob', { title: 'Gamma', plays: 30, pub: T0 + 3 });
      await mk('ld', 'u3', 'cat', { title: 'Draft only', upd: T0 + 50 });
      const ids = (r) => r.items.map((x) => x.id);
      assert.deepEqual(ids(await s.listExperiences({ sort: 'popular' })), ['lc', 'lb', 'la']);
      assert.deepEqual(ids(await s.listExperiences({ sort: 'new' })), ['lc', 'lb', 'la']);
      assert.deepEqual(ids(await s.listExperiences({ sort: 'popular', q: 'BETA' })), ['lb']);
      assert.deepEqual(ids(await s.listExperiences({ q: '100%' })), ['la'], 'literal %');
      assert.deepEqual(ids(await s.listExperiences({ q: 'G_mma' })), [], 'literal _ (not a single-char wildcard)');
      assert.deepEqual(ids(await s.listExperiences({ q: 'ta_r' })), ['lb']);
      assert.deepEqual(ids(await s.listExperiences({ q: 'bob', sort: 'new' })), ['lc', 'lb'], 'creator name');
      assert.deepEqual(ids(await s.listExperiences({ ownerId: 'u3' })), [], 'drafts hidden');
      assert.deepEqual(ids(await s.listExperiences({ ownerId: 'u3', includeUnpublished: true, sort: 'updated' })), ['ld']);
      const p1 = await s.listExperiences({ sort: 'new', limit: 2 });
      assert.deepEqual([ids(p1), p1.hasMore], [['lc', 'lb'], true]);
      const p2 = await s.listExperiences({ sort: 'new', limit: 2, offset: 2 });
      assert.deepEqual([ids(p2), p2.hasMore], [['la'], false]);
      const it = (await s.listExperiences({ q: 'gamma' })).items[0];
      assert.deepEqual([typeof it.plays, it.plays, it.likes, it.version, it.ownerName], ['number', 30, 0, 1, 'bob']);
      assert.equal(it.draft, undefined, 'list rows carry no draft data');
    });

    test('reports', async () => {
      await s.addReport({ id: 'r1', kind: 'user', targetId: 'u2', reason: 'spam', details: '', context: '', reporterId: 'u1', reporterIp: '1.2.3.4', status: 'open', createdAt: T0 });
      await s.addReport({ id: 'r2', kind: 'chat', targetId: 'p7', reason: 'rude', details: 'x', context: 'msg', reporterId: null, reporterIp: '5.6.7.8', status: 'open', createdAt: T0 + 1 });
      const list = await s.listReports({ limit: 10 });
      assert.deepEqual(list.map((r) => r.id), ['r2', 'r1']);
      assert.equal(list[0].reporterId, null);
      assert.equal(list[1].targetId, 'u2');
    });
  });
}

describe('JSON store persistence', () => {
  test('survives a reopen; writes are atomic (no temp files left)', async () => {
    const dir = await tempDir();
    try {
      const a = createJsonStore({ dataDir: dir, log: quiet, flushMs: 5 });
      await a.init();
      await a.createUser(user('u1', 'ann'));
      await a.createSession({ tokenHash: 'h1', userId: 'u1', createdAt: T0, expiresAt: T0 + 9, lastUsedAt: T0 });
      await a.createExperience(meta('x1', 'u1', 'ann'), { data: doc(2), savedAt: T0, size: 1, partCount: 2 });
      await a.publishVersion('x1', { data: doc(2), size: 1, partCount: 2, createdAt: T0 + 1 }, 5);
      await a.setLike('x1', 'u1', true, T0);
      await a.putFriendship({ lo: 'u1', hi: 'u2', requester: 'u1', status: 'pending', createdAt: T0, acceptedAt: null });
      await a.addReport({ id: 'r1', kind: 'user', targetId: 'u1', reason: 'x', createdAt: T0 });
      await a.close();
      const files = fs.readdirSync(path.join(dir, 'platform'));
      assert.ok(['users.json', 'sessions.json', 'experiences.json', 'likes.json', 'friends.json', 'reports.json', 'drafts', 'versions'].every((f) => files.includes(f)), files.join());
      assert.ok(!files.some((f) => f.endsWith('.tmp')));

      const b = createJsonStore({ dataDir: dir, log: quiet });
      await b.init();
      assert.equal((await b.getUserByName('ann')).id, 'u1');
      assert.equal((await b.getSession('h1')).userId, 'u1');
      const m = await b.getExperience('x1');
      assert.deepEqual([m.version, m.likes], [1, 1]);
      assert.equal((await b.getVersion('x1', 1)).data.parts.length, 2);
      assert.deepEqual((await b.listVersions('x1')).map((v) => v.v), [1]);
      assert.equal((await b.getDraft('x1')).partCount, 2);
      assert.equal((await b.listFriendships('u2')).length, 1);
      assert.equal((await b.listReports()).length, 1);
      assert.deepEqual([...(await b.likedBy('u1', ['x1']))], ['x1']);
      await b.close();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('a corrupt collection is moved aside and logged, the rest still loads', async () => {
    const dir = await tempDir();
    try {
      const a = createJsonStore({ dataDir: dir, log: quiet, flushMs: 5 });
      await a.init();
      await a.createUser(user('u1', 'ann'));
      await a.createExperience(meta('x1', 'u1', 'ann'), null);
      await a.close();
      fs.writeFileSync(path.join(dir, 'platform', 'users.json'), '{"v":1,"items":[{"id":');
      const errors = [];
      const b = createJsonStore({ dataDir: dir, log: { ...quiet, error: (m) => errors.push(m) } });
      await b.init();
      assert.equal(await b.getUser('u1'), null);
      assert.equal((await b.getExperience('x1')).id, 'x1');
      assert.equal(errors.length, 1);
      assert.ok(fs.readdirSync(path.join(dir, 'platform')).some((f) => f.startsWith('users.json.corrupt-')));
      await b.close();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Postgres store specifics (fake pool)', () => {
  test('schema: all seven tables + indexes, under an advisory lock, in a transaction', async () => {
    const pool = createFakePool({ prefix: 'pf_' });
    const store = await createPgStore({ pool, log: quiet, tablePrefix: 'pf_' });
    await store.init();
    const tables = pool.log.filter((l) => l.startsWith('schema:')).map((l) => l.slice(7));
    for (const t of ['users', 'sessions', 'friends', 'experiences', 'experience_versions', 'likes', 'reports']) assert.ok(tables.includes(`pf_${t}`), t);
    assert.ok(tables.some((t) => t.endsWith('_idx')));
    assert.deepEqual(pool.log.slice(0, 2), ['BEGIN', 'lock']);
    assert.equal(pool.log[pool.log.length - 1], 'COMMIT');
    await assert.rejects(createPgStore({ pool, log: quiet, tablePrefix: 'bad-prefix;' }));
  });

  test('a failing statement inside publish rolls the transaction back', async () => {
    const pool = createFakePool();
    const store = await createPgStore({ pool, log: quiet });
    await store.init();
    await store.createUser(user('u1', 'ann'));
    await store.createExperience(meta('x1', 'u1', 'ann'), null);
    await store.publishVersion('x1', { data: doc(1), size: 1, partCount: 1, createdAt: T0 }, 5);
    // a version row that already exists makes the next INSERT fail (unique violation)
    pool.db.experience_versions.push({ experience_id: 'x1', version: 2, data: {}, size: 0, part_count: 0, created_at: T0 });
    await assert.rejects(store.publishVersion('x1', { data: doc(1), size: 1, partCount: 1, createdAt: T0 + 1 }, 5));
    assert.ok(pool.log.includes('ROLLBACK'));
    assert.equal((await store.getExperience('x1')).version, 1, 'meta unchanged after rollback');
  });
});
