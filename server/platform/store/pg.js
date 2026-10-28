/**
 * Postgres platform store (used when DATABASE_URL is set). Tables are created on
 * start (idempotent, under an advisory lock so several instances can boot at
 * once): users, sessions, friends, experiences, experience_versions, likes,
 * reports (+ optional `tablePrefix`). Drafts and published versions are JSONB;
 * list queries never read the draft/thumbnail columns.
 *
 * Every statement is static and parameterised and starts with a `/*name*\/`
 * tag (used by the test fake in fake-pg.js). Timestamps are ms since epoch
 * (BIGINT → Number in the row mappers).
 */
import { StoreConflict } from '../errors.js';
import { LIKE_WEIGHT } from './common.js';

export function pgQueries(p = '') {
  const T = (n) => `${p}${n}`;
  const META = `id, owner_id, owner_name, title, description, max_players, builtin, version, plays, likes, part_count, size, thumb_rev, draft_saved_at, created_at, updated_at, published_at`;
  return {
    schema: [
      `/*schema*/ CREATE TABLE IF NOT EXISTS ${T('users')} (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        birth_year INTEGER NOT NULL,
        guest_token_hash TEXT,
        guest_linked_at BIGINT,
        restrictions JSONB,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        CONSTRAINT ${T('users_username_uq')} UNIQUE (username),
        CONSTRAINT ${T('users_guest_uq')} UNIQUE (guest_token_hash)
      )`,
      `/*schema*/ CREATE TABLE IF NOT EXISTS ${T('sessions')} (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${T('users')}(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        last_used_at BIGINT NOT NULL
      )`,
      `/*schema*/ CREATE INDEX IF NOT EXISTS ${T('sessions_user_idx')} ON ${T('sessions')} (user_id)`,
      `/*schema*/ CREATE INDEX IF NOT EXISTS ${T('sessions_expires_idx')} ON ${T('sessions')} (expires_at)`,
      `/*schema*/ CREATE TABLE IF NOT EXISTS ${T('friends')} (
        user_lo TEXT NOT NULL REFERENCES ${T('users')}(id) ON DELETE CASCADE,
        user_hi TEXT NOT NULL REFERENCES ${T('users')}(id) ON DELETE CASCADE,
        requester TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
        created_at BIGINT NOT NULL,
        accepted_at BIGINT,
        PRIMARY KEY (user_lo, user_hi),
        CHECK (user_lo < user_hi)
      )`,
      `/*schema*/ CREATE INDEX IF NOT EXISTS ${T('friends_hi_idx')} ON ${T('friends')} (user_hi)`,
      `/*schema*/ CREATE TABLE IF NOT EXISTS ${T('experiences')} (
        id TEXT PRIMARY KEY,
        owner_id TEXT REFERENCES ${T('users')}(id) ON DELETE CASCADE,
        owner_name TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        max_players INTEGER NOT NULL DEFAULT 20,
        builtin BOOLEAN NOT NULL DEFAULT FALSE,
        version INTEGER NOT NULL DEFAULT 0,
        plays BIGINT NOT NULL DEFAULT 0,
        likes BIGINT NOT NULL DEFAULT 0,
        part_count INTEGER NOT NULL DEFAULT 0,
        size INTEGER NOT NULL DEFAULT 0,
        draft JSONB,
        draft_saved_at BIGINT,
        draft_size INTEGER NOT NULL DEFAULT 0,
        draft_part_count INTEGER NOT NULL DEFAULT 0,
        thumbnail TEXT,
        thumb_rev BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        published_at BIGINT
      )`,
      `/*schema*/ CREATE INDEX IF NOT EXISTS ${T('experiences_owner_idx')} ON ${T('experiences')} (owner_id, updated_at DESC)`,
      `/*schema*/ CREATE INDEX IF NOT EXISTS ${T('experiences_new_idx')} ON ${T('experiences')} (published_at DESC) WHERE version > 0 AND NOT builtin`,
      `/*schema*/ CREATE INDEX IF NOT EXISTS ${T('experiences_popular_idx')} ON ${T('experiences')} ((plays + likes * ${LIKE_WEIGHT}) DESC) WHERE version > 0 AND NOT builtin`,
      `/*schema*/ CREATE TABLE IF NOT EXISTS ${T('experience_versions')} (
        experience_id TEXT NOT NULL REFERENCES ${T('experiences')}(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        data JSONB NOT NULL,
        size INTEGER NOT NULL,
        part_count INTEGER NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (experience_id, version)
      )`,
      `/*schema*/ CREATE TABLE IF NOT EXISTS ${T('likes')} (
        experience_id TEXT NOT NULL REFERENCES ${T('experiences')}(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES ${T('users')}(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (experience_id, user_id)
      )`,
      `/*schema*/ CREATE INDEX IF NOT EXISTS ${T('likes_user_idx')} ON ${T('likes')} (user_id)`,
      `/*schema*/ CREATE TABLE IF NOT EXISTS ${T('reports')} (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        context TEXT NOT NULL DEFAULT '',
        reporter_id TEXT,
        reporter_ip TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at BIGINT NOT NULL
      )`,
      `/*schema*/ CREATE INDEX IF NOT EXISTS ${T('reports_target_idx')} ON ${T('reports')} (kind, target_id)`,
      `/*schema*/ CREATE INDEX IF NOT EXISTS ${T('reports_created_idx')} ON ${T('reports')} (created_at DESC)`,
    ],
    lock: `/*lock*/ SELECT pg_advisory_xact_lock(hashtext($1))`,

    createUser: `/*createUser*/ INSERT INTO ${T('users')} (id, username, password_hash, birth_year, guest_token_hash, guest_linked_at, restrictions, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) RETURNING *`,
    getUser: `/*getUser*/ SELECT * FROM ${T('users')} WHERE id = $1`,
    getUserByName: `/*getUserByName*/ SELECT * FROM ${T('users')} WHERE username = $1`,
    getUserByGuestHash: `/*getUserByGuestHash*/ SELECT * FROM ${T('users')} WHERE guest_token_hash = $1`,
    getUsers: `/*getUsers*/ SELECT * FROM ${T('users')} WHERE id = ANY($1::text[])`,
    updateUser: `/*updateUser*/ UPDATE ${T('users')} SET password_hash = $2, restrictions = $3::jsonb, updated_at = $4 WHERE id = $1 RETURNING *`,

    createSession: `/*createSession*/ INSERT INTO ${T('sessions')} (token_hash, user_id, created_at, expires_at, last_used_at) VALUES ($1, $2, $3, $4, $5)`,
    getSession: `/*getSession*/ SELECT * FROM ${T('sessions')} WHERE token_hash = $1`,
    touchSession: `/*touchSession*/ UPDATE ${T('sessions')} SET last_used_at = $2, expires_at = $3 WHERE token_hash = $1`,
    deleteSession: `/*deleteSession*/ DELETE FROM ${T('sessions')} WHERE token_hash = $1`,
    deleteUserSessions: `/*deleteUserSessions*/ DELETE FROM ${T('sessions')} WHERE user_id = $1`,
    pruneSessions: `/*pruneSessions*/ DELETE FROM ${T('sessions')} WHERE expires_at < $1`,

    getFriendship: `/*getFriendship*/ SELECT * FROM ${T('friends')} WHERE user_lo = $1 AND user_hi = $2`,
    listFriendships: `/*listFriendships*/ SELECT * FROM ${T('friends')} WHERE user_lo = $1 OR user_hi = $1`,
    putFriendship: `/*putFriendship*/ INSERT INTO ${T('friends')} (user_lo, user_hi, requester, status, created_at, accepted_at) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_lo, user_hi) DO UPDATE SET requester = EXCLUDED.requester, status = EXCLUDED.status, created_at = EXCLUDED.created_at, accepted_at = EXCLUDED.accepted_at`,
    deleteFriendship: `/*deleteFriendship*/ DELETE FROM ${T('friends')} WHERE user_lo = $1 AND user_hi = $2`,

    ensureExperience: `/*ensureExperience*/ INSERT INTO ${T('experiences')} (id, owner_id, owner_name, title, description, max_players, builtin, version, plays, likes, part_count, size, thumb_rev, created_at, updated_at, published_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, 0, 0, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
    createExperience: `/*createExperience*/ INSERT INTO ${T('experiences')} (id, owner_id, owner_name, title, description, max_players, builtin, version, plays, likes, part_count, size, thumb_rev, draft, draft_saved_at, draft_size, draft_part_count, created_at, updated_at, published_at)
      VALUES ($1, $2, $3, $4, $5, $6, FALSE, 0, 0, 0, 0, 0, 0, $7::jsonb, $8, $9, $10, $11, $12, NULL) RETURNING ${META}`,
    getExperience: `/*getExperience*/ SELECT ${META} FROM ${T('experiences')} WHERE id = $1`,
    updateExperience: `/*updateExperience*/ UPDATE ${T('experiences')} SET title = $2, description = $3, max_players = $4, updated_at = $5 WHERE id = $1 RETURNING ${META}`,
    saveDraft: `/*saveDraft*/ UPDATE ${T('experiences')} SET draft = $2::jsonb, draft_saved_at = $3, draft_size = $4, draft_part_count = $5, title = $6, description = $7, max_players = $8, updated_at = $9 WHERE id = $1 RETURNING ${META}`,
    getDraft: `/*getDraft*/ SELECT draft, draft_saved_at, draft_size, draft_part_count FROM ${T('experiences')} WHERE id = $1`,
    setThumbnail: `/*setThumbnail*/ UPDATE ${T('experiences')} SET thumbnail = $2, thumb_rev = $3 WHERE id = $1 RETURNING ${META}`,
    getThumbnail: `/*getThumbnail*/ SELECT thumbnail, thumb_rev FROM ${T('experiences')} WHERE id = $1`,
    lockExperience: `/*lockExperience*/ SELECT version, likes FROM ${T('experiences')} WHERE id = $1 FOR UPDATE`,
    insertVersion: `/*insertVersion*/ INSERT INTO ${T('experience_versions')} (experience_id, version, data, size, part_count, created_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
    markPublished: `/*markPublished*/ UPDATE ${T('experiences')} SET version = $2, part_count = $3, size = $4, published_at = $5, updated_at = $5 WHERE id = $1 RETURNING ${META}`,
    pruneVersions: `/*pruneVersions*/ DELETE FROM ${T('experience_versions')} WHERE experience_id = $1 AND version <= $2`,
    getVersion: `/*getVersion*/ SELECT version, data, size, part_count, created_at FROM ${T('experience_versions')} WHERE experience_id = $1 AND version = $2`,
    listVersions: `/*listVersions*/ SELECT version, size, part_count, created_at FROM ${T('experience_versions')} WHERE experience_id = $1 ORDER BY version DESC`,
    deleteExperience: `/*deleteExperience*/ DELETE FROM ${T('experiences')} WHERE id = $1`,
    listExperiences: `/*listExperiences*/ SELECT ${META} FROM ${T('experiences')}
      WHERE NOT builtin
        AND ($1::boolean OR version > 0)
        AND ($2::text IS NULL OR owner_id = $2::text)
        AND ($3::text IS NULL OR title ILIKE $3::text ESCAPE '\\' OR description ILIKE $3::text ESCAPE '\\' OR owner_name ILIKE $3::text ESCAPE '\\')
      ORDER BY
        CASE WHEN $4::text = 'popular' THEN plays + likes * ${LIKE_WEIGHT} END DESC NULLS LAST,
        CASE WHEN $4::text = 'updated' THEN updated_at END DESC NULLS LAST,
        published_at DESC NULLS LAST,
        id ASC
      LIMIT $5 OFFSET $6`,
    countExperiences: `/*countExperiences*/ SELECT COUNT(*)::int AS n FROM ${T('experiences')} WHERE owner_id = $1`,
    addPlays: `/*addPlays*/ UPDATE ${T('experiences')} SET plays = plays + $2 WHERE id = $1 RETURNING plays`,
    insertLike: `/*insertLike*/ INSERT INTO ${T('likes')} (experience_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    deleteLike: `/*deleteLike*/ DELETE FROM ${T('likes')} WHERE experience_id = $1 AND user_id = $2`,
    bumpLikes: `/*bumpLikes*/ UPDATE ${T('experiences')} SET likes = GREATEST(likes + $2, 0) WHERE id = $1 RETURNING likes`,
    likedBy: `/*likedBy*/ SELECT experience_id FROM ${T('likes')} WHERE user_id = $1 AND experience_id = ANY($2::text[])`,

    addReport: `/*addReport*/ INSERT INTO ${T('reports')} (id, kind, target_id, reason, details, context, reporter_id, reporter_ip, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    listReports: `/*listReports*/ SELECT * FROM ${T('reports')} ORDER BY created_at DESC LIMIT $1`,
  };
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

const userRow = (r) =>
  r && {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    birthYear: Number(r.birth_year),
    guestTokenHash: r.guest_token_hash ?? null,
    guestLinkedAt: num(r.guest_linked_at),
    restrictions: r.restrictions ?? null,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
const sessionRow = (r) =>
  r && { tokenHash: r.token_hash, userId: r.user_id, createdAt: num(r.created_at), expiresAt: num(r.expires_at), lastUsedAt: num(r.last_used_at) };
const friendRow = (r) =>
  r && { lo: r.user_lo, hi: r.user_hi, requester: r.requester, status: r.status, createdAt: num(r.created_at), acceptedAt: num(r.accepted_at) };
const metaRow = (r) =>
  r && {
    id: r.id,
    ownerId: r.owner_id ?? null,
    ownerName: r.owner_name ?? null,
    title: r.title,
    description: r.description,
    maxPlayers: Number(r.max_players),
    builtin: !!r.builtin,
    version: Number(r.version),
    plays: Number(r.plays),
    likes: Number(r.likes),
    partCount: Number(r.part_count),
    size: Number(r.size),
    thumbRev: Number(r.thumb_rev),
    draftSavedAt: num(r.draft_saved_at),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    publishedAt: num(r.published_at),
  };
const reportRow = (r) =>
  r && {
    id: r.id,
    kind: r.kind,
    targetId: r.target_id,
    reason: r.reason,
    details: r.details,
    context: r.context,
    reporterId: r.reporter_id ?? null,
    reporterIp: r.reporter_ip ?? null,
    status: r.status,
    createdAt: num(r.created_at),
  };

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export async function createPgStore({ databaseUrl, log, pool, tablePrefix = '', poolSize = 5 }) {
  if (tablePrefix && !/^[a-z_][a-z0-9_]{0,20}$/.test(tablePrefix)) throw new Error('platform store: bad tablePrefix');
  let ownPool = false;
  if (!pool) {
    const pg = (await import('pg')).default;
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: poolSize,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (err) => log?.warn?.('platform postgres pool error', { err }));
    ownPool = true;
  }
  const Q = pgQueries(tablePrefix);
  const q = (text, params) => pool.query(text, params);
  const one = async (text, params) => (await q(text, params)).rows[0] ?? null;

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn((text, params) => client.query(text, params));
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  function conflict(err) {
    if (err?.code !== '23505') return err;
    if (err.constraint === `${tablePrefix}users_username_uq`) return new StoreConflict('name_taken');
    if (err.constraint === `${tablePrefix}users_guest_uq`) return new StoreConflict('guest_linked');
    return new StoreConflict('exists');
  }

  const json = (v) => (v === null || v === undefined ? null : JSON.stringify(v));

  return {
    kind: 'postgres',

    async init() {
      await tx(async (cq) => {
        await cq(Q.lock, [`${tablePrefix}o-universe-platform-schema`]);
        for (const s of Q.schema) await cq(s);
      });
    },
    async flush() {},
    async close() {
      if (ownPool) await pool.end();
    },

    // users
    async createUser(u) {
      try {
        return userRow(
          await one(Q.createUser, [u.id, u.username, u.passwordHash, u.birthYear, u.guestTokenHash ?? null, u.guestLinkedAt ?? null, json(u.restrictions), u.createdAt, u.updatedAt]),
        );
      } catch (err) {
        throw conflict(err);
      }
    },
    getUser: async (id) => userRow(await one(Q.getUser, [id])),
    getUserByName: async (name) => userRow(await one(Q.getUserByName, [name])),
    getUserByGuestHash: async (hash) => userRow(await one(Q.getUserByGuestHash, [hash])),
    async getUsers(ids) {
      if (!ids.length) return [];
      return (await q(Q.getUsers, [ids])).rows.map(userRow);
    },
    async updateUser(id, patch) {
      const cur = userRow(await one(Q.getUser, [id]));
      if (!cur) return null;
      const passwordHash = patch.passwordHash ?? cur.passwordHash;
      const restrictions = patch.restrictions !== undefined ? patch.restrictions : cur.restrictions;
      return userRow(await one(Q.updateUser, [id, passwordHash, json(restrictions), patch.updatedAt ?? Date.now()]));
    },

    // sessions
    async createSession(s) {
      await q(Q.createSession, [s.tokenHash, s.userId, s.createdAt, s.expiresAt, s.lastUsedAt]);
    },
    getSession: async (hash) => sessionRow(await one(Q.getSession, [hash])),
    async touchSession(hash, lastUsedAt, expiresAt) {
      await q(Q.touchSession, [hash, lastUsedAt, expiresAt]);
    },
    async deleteSession(hash) {
      await q(Q.deleteSession, [hash]);
    },
    deleteUserSessions: async (userId) => (await q(Q.deleteUserSessions, [userId])).rowCount,
    pruneSessions: async (now) => (await q(Q.pruneSessions, [now])).rowCount,

    // friends
    async getFriendship(a, b) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return friendRow(await one(Q.getFriendship, [lo, hi]));
    },
    listFriendships: async (userId) => (await q(Q.listFriendships, [userId])).rows.map(friendRow),
    async putFriendship(r) {
      await q(Q.putFriendship, [r.lo, r.hi, r.requester, r.status, r.createdAt, r.acceptedAt ?? null]);
    },
    async deleteFriendship(a, b) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return (await q(Q.deleteFriendship, [lo, hi])).rowCount > 0;
    },

    // experiences
    async ensureExperience(m) {
      await q(Q.ensureExperience, [m.id, m.ownerId ?? null, m.ownerName ?? null, m.title, m.description || '', m.maxPlayers, !!m.builtin, m.version || 0, m.createdAt, m.updatedAt, m.publishedAt ?? null]);
      return metaRow(await one(Q.getExperience, [m.id]));
    },
    async createExperience(m, draft) {
      try {
        return metaRow(
          await one(Q.createExperience, [
            m.id, m.ownerId, m.ownerName, m.title, m.description || '', m.maxPlayers,
            draft ? json(draft.data) : null, draft ? draft.savedAt : null, draft ? draft.size : 0, draft ? draft.partCount : 0,
            m.createdAt, m.updatedAt,
          ]),
        );
      } catch (err) {
        throw conflict(err);
      }
    },
    getExperience: async (id) => metaRow(await one(Q.getExperience, [id])),
    updateExperience: async (id, p) => metaRow(await one(Q.updateExperience, [id, p.title, p.description, p.maxPlayers, p.updatedAt])),
    saveDraft: async (id, d, p) =>
      metaRow(await one(Q.saveDraft, [id, json(d.data), d.savedAt, d.size, d.partCount, p.title, p.description, p.maxPlayers, p.updatedAt])),
    async getDraft(id) {
      const r = await one(Q.getDraft, [id]);
      if (!r || r.draft === null || r.draft === undefined) return null;
      return { data: r.draft, savedAt: num(r.draft_saved_at), size: Number(r.draft_size), partCount: Number(r.draft_part_count) };
    },
    setThumbnail: async (id, dataUrl, rev) => metaRow(await one(Q.setThumbnail, [id, dataUrl || null, dataUrl ? rev : 0])),
    async getThumbnail(id) {
      const r = await one(Q.getThumbnail, [id]);
      return r && r.thumbnail ? { dataUrl: r.thumbnail, rev: Number(r.thumb_rev) } : null;
    },
    async publishVersion(id, ver, keep) {
      return tx(async (cq) => {
        const cur = (await cq(Q.lockExperience, [id])).rows[0];
        if (!cur) return null;
        const v = Number(cur.version) + 1;
        await cq(Q.insertVersion, [id, v, json(ver.data), ver.size, ver.partCount, ver.createdAt]);
        const meta = metaRow((await cq(Q.markPublished, [id, v, ver.partCount, ver.size, ver.createdAt])).rows[0]);
        if (keep > 0 && v > keep) await cq(Q.pruneVersions, [id, v - keep]);
        return { meta, version: { v, createdAt: ver.createdAt, size: ver.size, partCount: ver.partCount } };
      });
    },
    async getVersion(id, v) {
      const r = await one(Q.getVersion, [id, v]);
      return r && { v: Number(r.version), data: r.data, createdAt: num(r.created_at), size: Number(r.size), partCount: Number(r.part_count) };
    },
    listVersions: async (id) =>
      (await q(Q.listVersions, [id])).rows.map((r) => ({ v: Number(r.version), createdAt: num(r.created_at), size: Number(r.size), partCount: Number(r.part_count) })),
    deleteExperience: async (id) => (await q(Q.deleteExperience, [id])).rowCount > 0,
    async listExperiences({ sort = 'popular', q: text = '', ownerId = null, includeUnpublished = false, limit = 24, offset = 0 } = {}) {
      const pattern = text ? `%${escapeLike(text)}%` : null;
      const rows = (await q(Q.listExperiences, [!!includeUnpublished, ownerId, pattern, sort, limit + 1, offset])).rows;
      return { items: rows.slice(0, limit).map(metaRow), hasMore: rows.length > limit };
    },
    countExperiences: async (ownerId) => Number((await one(Q.countExperiences, [ownerId]))?.n || 0),
    async addPlays(id, n = 1) {
      const r = await one(Q.addPlays, [id, n]);
      return r ? Number(r.plays) : null;
    },
    async setLike(id, userId, on, at) {
      return tx(async (cq) => {
        const cur = (await cq(Q.lockExperience, [id])).rows[0];
        if (!cur) return null;
        const res = on ? await cq(Q.insertLike, [id, userId, at]) : await cq(Q.deleteLike, [id, userId]);
        if (!res.rowCount) return { changed: false, likes: Number(cur.likes) };
        const r = (await cq(Q.bumpLikes, [id, on ? 1 : -1])).rows[0];
        return { changed: true, likes: Number(r.likes) };
      });
    },
    async likedBy(userId, ids) {
      if (!ids.length) return new Set();
      return new Set((await q(Q.likedBy, [userId, ids])).rows.map((r) => r.experience_id));
    },

    // reports
    async addReport(r) {
      await q(Q.addReport, [r.id, r.kind, r.targetId, r.reason, r.details || '', r.context || '', r.reporterId ?? null, r.reporterIp ?? null, r.status || 'open', r.createdAt]);
    },
    listReports: async ({ limit = 100 } = {}) => (await q(Q.listReports, [limit])).rows.map(reportRow),
  };
}
