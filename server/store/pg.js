/**
 * Postgres store (DATABASE_URL) — same interface as the JSON store.
 *
 * Tables (created on boot, guarded by an advisory lock so two instances that
 * start at the same time during a deploy don't race):
 *   players(id text pk default 'p'||nextval, token_hash text unique, name text,
 *           appearance jsonb, save jsonb, created_at timestamptz, last_seen timestamptz)
 *   world(id text pk, data jsonb, updated_at timestamptz)
 *
 * SSL follows the URL (`?sslmode=require`); DATABASE_SSL=1 (same switch as the platform
 * store; PGSSL=1 works too) forces SSL without CA checks (some hosted Postgres proxies).
 * `Pool` is injectable for unit tests.
 */
export const SCHEMA_SQL = [
  `CREATE SEQUENCE IF NOT EXISTS players_seq`,
  `CREATE TABLE IF NOT EXISTS players (
     id TEXT PRIMARY KEY DEFAULT ('p' || nextval('players_seq')),
     token_hash TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     appearance JSONB,
     save JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS world (
     id TEXT PRIMARY KEY,
     data JSONB,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];
const SCHEMA_LOCK = 72_410_001; // pg_advisory_xact_lock key (any constant)

const WORLD_ID = 'world'; // one world per server (PLATFORM.md §11)
const LEGACY_WORLD_ID = 'hub'; // pre-§11 saves: read when no 'world' row exists yet
const json = (v) => (v === undefined ? null : JSON.stringify(v));
const ms = (d) => (d instanceof Date ? d.getTime() : d ? Date.parse(d) : 0);

function rowToPlayer(r) {
  return r && { id: r.id, name: r.name, appearance: r.appearance ?? null, save: r.save ?? null, createdAt: ms(r.created_at), lastSeen: ms(r.last_seen) };
}

export async function createPgStore({ url, log, Pool, retries = 10, retryMs = 2000 }) {
  if (!Pool) Pool = (await import('pg')).default.Pool;
  const ssl = process.env.DATABASE_SSL === '1' || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ...(ssl ? { ssl } : {}) });
  pool.on?.('error', (err) => log.warn('postgres idle client error', { err }));

  // ------------------------------------------------------------ migrate (with retries: the DB may boot slower)
  for (let attempt = 1; ; attempt++) {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
      for (const sql of SCHEMA_SQL) await client.query(sql);
      await client.query('COMMIT');
      client.release();
      break;
    } catch (err) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
        client.release(err);
      }
      if (attempt >= retries) throw err;
      log.warn('postgres not ready, retrying', { attempt, err: err.message });
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
  log.info('postgres store ready');

  return {
    kind: 'postgres',

    async loadWorld() {
      const { rows } = await pool.query('SELECT id, data FROM world WHERE id = $1 OR id = $2', [WORLD_ID, LEGACY_WORLD_ID]);
      const row = rows.find((r) => r.id === WORLD_ID) || rows.find((r) => r.id === LEGACY_WORLD_ID);
      return row?.data ?? null;
    },

    async worldUpdatedAt() {
      const { rows } = await pool.query('SELECT id, updated_at FROM world WHERE id = $1 OR id = $2', [WORLD_ID, LEGACY_WORLD_ID]);
      const row = rows.find((r) => r.id === WORLD_ID) || rows.find((r) => r.id === LEGACY_WORLD_ID);
      return ms(row?.updated_at);
    },

    async saveWorld(data) {
      await pool.query(
        `INSERT INTO world (id, data, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [WORLD_ID, json(data)],
      );
    },

    async getPlayerByToken(hash) {
      const { rows } = await pool.query('SELECT id, name, appearance, save, created_at, last_seen FROM players WHERE token_hash = $1', [hash]);
      return rowToPlayer(rows[0]) || null;
    },

    async createPlayer({ tokenHash, name, appearance = null }) {
      const { rows } = await pool.query(
        `INSERT INTO players (token_hash, name, appearance) VALUES ($1, $2, $3::jsonb)
         RETURNING id, name, appearance, save, created_at, last_seen`,
        [tokenHash, name, json(appearance)],
      );
      return rowToPlayer(rows[0]);
    },

    /** Partial update: only the given fields of { name, appearance, save } change; last_seen = now(). */
    async savePlayer(id, data = {}) {
      const sets = [];
      const args = [id];
      if (data.name !== undefined) {
        args.push(data.name);
        sets.push(`name = $${args.length}`);
      }
      if (data.appearance !== undefined) {
        args.push(json(data.appearance));
        sets.push(`appearance = $${args.length}::jsonb`);
      }
      if (data.save !== undefined) {
        args.push(json(data.save));
        sets.push(`save = $${args.length}::jsonb`);
      }
      sets.push('last_seen = now()');
      const res = await pool.query(`UPDATE players SET ${sets.join(', ')} WHERE id = $1`, args);
      if (res.rowCount === 0) throw new Error(`unknown player ${id}`);
    },

    release() {},

    stats() {
      return { kind: 'postgres', pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } };
    },

    async close() {
      await pool.end();
    },
  };
}
