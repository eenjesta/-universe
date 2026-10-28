/**
 * In-memory stand-in for a `pg.Pool`, for testing store/pg.js without a
 * Postgres server. Each statement is dispatched on its leading `/*name*\/` tag
 * and implemented over plain row arrays with Postgres-like behaviour:
 *   - BIGINT columns come back as strings (like node-postgres), JSONB parsed
 *   - unique violations throw { code: '23505', constraint }
 *   - BEGIN / COMMIT / ROLLBACK (snapshot + restore)
 *   - every call checks that the number of $n placeholders matches `params`
 * It does not validate SQL syntax: run the store tests with TEST_DATABASE_URL
 * against a real Postgres for that.
 */
const BIGINT = new Set(['created_at', 'updated_at', 'expires_at', 'last_used_at', 'guest_linked_at', 'accepted_at', 'plays', 'likes', 'thumb_rev', 'draft_saved_at', 'published_at']);
const META = ['id', 'owner_id', 'owner_name', 'title', 'description', 'max_players', 'builtin', 'version', 'plays', 'likes', 'part_count', 'size', 'thumb_rev', 'draft_saved_at', 'created_at', 'updated_at', 'published_at'];
const TABLES = ['users', 'sessions', 'friends', 'experiences', 'experience_versions', 'likes', 'reports'];

const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));
function out(row, cols) {
  const o = {};
  for (const k of cols || Object.keys(row)) {
    const v = row[k];
    o[k] = v === null || v === undefined ? null : BIGINT.has(k) ? String(v) : typeof v === 'object' ? clone(v) : v;
  }
  return o;
}
const res = (rows, rowCount = rows.length) => ({ rows, rowCount });
const parseJson = (s) => (s === null || s === undefined ? null : JSON.parse(s));
function uniq(constraint) {
  const e = new Error(`duplicate key value violates unique constraint "${constraint}"`);
  e.code = '23505';
  e.constraint = constraint;
  return e;
}
function fk(constraint) {
  const e = new Error(`insert or update violates foreign key constraint "${constraint}"`);
  e.code = '23503';
  return e;
}
function likeToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is');
}
const desc = (a, b) => (b ?? -Infinity) - (a ?? -Infinity);

export function createFakePool({ prefix = '' } = {}) {
  let db = Object.fromEntries(TABLES.map((t) => [t, []]));
  const log = [];
  let snapshot = null;
  let ended = false;

  const H = {
    schema: () => res([]),
    lock: () => res([{ pg_advisory_xact_lock: '' }]),

    createUser(p) {
      const [id, username, password_hash, birth_year, guest_token_hash, guest_linked_at, restrictions, created_at, updated_at] = p;
      if (db.users.some((u) => u.id === id)) throw uniq(`${prefix}users_pkey`);
      if (db.users.some((u) => u.username === username)) throw uniq(`${prefix}users_username_uq`);
      if (guest_token_hash !== null && db.users.some((u) => u.guest_token_hash === guest_token_hash)) throw uniq(`${prefix}users_guest_uq`);
      const row = { id, username, password_hash, birth_year, guest_token_hash, guest_linked_at, restrictions: parseJson(restrictions), created_at, updated_at };
      db.users.push(row);
      return res([out(row)]);
    },
    getUser: ([id]) => res(db.users.filter((u) => u.id === id).map((u) => out(u))),
    getUserByName: ([n]) => res(db.users.filter((u) => u.username === n).map((u) => out(u))),
    getUserByGuestHash: ([h]) => res(db.users.filter((u) => u.guest_token_hash === h).map((u) => out(u))),
    getUsers([ids]) {
      if (!Array.isArray(ids)) throw new Error('getUsers: $1 must be an array');
      return res(db.users.filter((u) => ids.includes(u.id)).map((u) => out(u)));
    },
    updateUser([id, password_hash, restrictions, updated_at]) {
      const u = db.users.find((x) => x.id === id);
      if (!u) return res([], 0);
      Object.assign(u, { password_hash, restrictions: parseJson(restrictions), updated_at });
      return res([out(u)]);
    },

    createSession([token_hash, user_id, created_at, expires_at, last_used_at]) {
      if (db.sessions.some((s) => s.token_hash === token_hash)) throw uniq(`${prefix}sessions_pkey`);
      if (!db.users.some((u) => u.id === user_id)) throw fk('sessions_user_id_fkey');
      db.sessions.push({ token_hash, user_id, created_at, expires_at, last_used_at });
      return res([], 1);
    },
    getSession: ([h]) => res(db.sessions.filter((s) => s.token_hash === h).map((s) => out(s))),
    touchSession([h, last_used_at, expires_at]) {
      const s = db.sessions.find((x) => x.token_hash === h);
      if (s) Object.assign(s, { last_used_at, expires_at });
      return res([], s ? 1 : 0);
    },
    deleteSession([h]) {
      const n = db.sessions.length;
      db.sessions = db.sessions.filter((s) => s.token_hash !== h);
      return res([], n - db.sessions.length);
    },
    deleteUserSessions([uid]) {
      const n = db.sessions.length;
      db.sessions = db.sessions.filter((s) => s.user_id !== uid);
      return res([], n - db.sessions.length);
    },
    pruneSessions([t]) {
      const n = db.sessions.length;
      db.sessions = db.sessions.filter((s) => !(s.expires_at < t));
      return res([], n - db.sessions.length);
    },

    getFriendship: ([lo, hi]) => res(db.friends.filter((f) => f.user_lo === lo && f.user_hi === hi).map((f) => out(f))),
    listFriendships: ([u]) => res(db.friends.filter((f) => f.user_lo === u || f.user_hi === u).map((f) => out(f))),
    putFriendship([user_lo, user_hi, requester, status, created_at, accepted_at]) {
      if (!(user_lo < user_hi)) throw Object.assign(new Error('check constraint user_lo < user_hi'), { code: '23514' });
      if (!['pending', 'accepted'].includes(status)) throw Object.assign(new Error('check constraint status'), { code: '23514' });
      const f = db.friends.find((x) => x.user_lo === user_lo && x.user_hi === user_hi);
      if (f) Object.assign(f, { requester, status, created_at, accepted_at });
      else db.friends.push({ user_lo, user_hi, requester, status, created_at, accepted_at });
      return res([], 1);
    },
    deleteFriendship([lo, hi]) {
      const n = db.friends.length;
      db.friends = db.friends.filter((f) => !(f.user_lo === lo && f.user_hi === hi));
      return res([], n - db.friends.length);
    },

    ensureExperience(p) {
      const [id, owner_id, owner_name, title, description, max_players, builtin, version, created_at, updated_at, published_at] = p;
      if (db.experiences.some((e) => e.id === id)) return res([], 0);
      db.experiences.push({ id, owner_id, owner_name, title, description, max_players, builtin, version, plays: 0, likes: 0, part_count: 0, size: 0, thumb_rev: 0, draft: null, draft_saved_at: null, draft_size: 0, draft_part_count: 0, thumbnail: null, created_at, updated_at, published_at });
      return res([], 1);
    },
    createExperience(p) {
      const [id, owner_id, owner_name, title, description, max_players, draft, draft_saved_at, draft_size, draft_part_count, created_at, updated_at] = p;
      if (db.experiences.some((e) => e.id === id)) throw uniq(`${prefix}experiences_pkey`);
      if (owner_id !== null && !db.users.some((u) => u.id === owner_id)) throw fk('experiences_owner_id_fkey');
      const row = { id, owner_id, owner_name, title, description, max_players, builtin: false, version: 0, plays: 0, likes: 0, part_count: 0, size: 0, thumb_rev: 0, draft: parseJson(draft), draft_saved_at, draft_size, draft_part_count, thumbnail: null, created_at, updated_at, published_at: null };
      db.experiences.push(row);
      return res([out(row, META)]);
    },
    getExperience: ([id]) => res(db.experiences.filter((e) => e.id === id).map((e) => out(e, META))),
    updateExperience([id, title, description, max_players, updated_at]) {
      const e = db.experiences.find((x) => x.id === id);
      if (!e) return res([], 0);
      Object.assign(e, { title, description, max_players, updated_at });
      return res([out(e, META)]);
    },
    saveDraft([id, draft, draft_saved_at, draft_size, draft_part_count, title, description, max_players, updated_at]) {
      const e = db.experiences.find((x) => x.id === id);
      if (!e) return res([], 0);
      Object.assign(e, { draft: parseJson(draft), draft_saved_at, draft_size, draft_part_count, title, description, max_players, updated_at });
      return res([out(e, META)]);
    },
    getDraft: ([id]) => res(db.experiences.filter((e) => e.id === id).map((e) => out(e, ['draft', 'draft_saved_at', 'draft_size', 'draft_part_count']))),
    setThumbnail([id, thumbnail, thumb_rev]) {
      const e = db.experiences.find((x) => x.id === id);
      if (!e) return res([], 0);
      Object.assign(e, { thumbnail, thumb_rev });
      return res([out(e, META)]);
    },
    getThumbnail: ([id]) => res(db.experiences.filter((e) => e.id === id).map((e) => out(e, ['thumbnail', 'thumb_rev']))),
    lockExperience: ([id]) => res(db.experiences.filter((e) => e.id === id).map((e) => out(e, ['version', 'likes']))),
    insertVersion([experience_id, version, data, size, part_count, created_at]) {
      if (!db.experiences.some((e) => e.id === experience_id)) throw fk('experience_versions_experience_id_fkey');
      if (db.experience_versions.some((v) => v.experience_id === experience_id && v.version === version)) throw uniq(`${prefix}experience_versions_pkey`);
      db.experience_versions.push({ experience_id, version, data: parseJson(data), size, part_count, created_at });
      return res([], 1);
    },
    markPublished([id, version, part_count, size, published_at]) {
      const e = db.experiences.find((x) => x.id === id);
      if (!e) return res([], 0);
      Object.assign(e, { version, part_count, size, published_at, updated_at: published_at });
      return res([out(e, META)]);
    },
    pruneVersions([id, upto]) {
      const n = db.experience_versions.length;
      db.experience_versions = db.experience_versions.filter((v) => !(v.experience_id === id && v.version <= upto));
      return res([], n - db.experience_versions.length);
    },
    getVersion: ([id, v]) => res(db.experience_versions.filter((x) => x.experience_id === id && x.version === v).map((x) => out(x, ['version', 'data', 'size', 'part_count', 'created_at']))),
    listVersions: ([id]) =>
      res(db.experience_versions.filter((x) => x.experience_id === id).sort((a, b) => b.version - a.version).map((x) => out(x, ['version', 'size', 'part_count', 'created_at']))),
    deleteExperience([id]) {
      const n = db.experiences.length;
      db.experiences = db.experiences.filter((e) => e.id !== id);
      const gone = n - db.experiences.length;
      if (gone) {
        db.experience_versions = db.experience_versions.filter((v) => v.experience_id !== id); // ON DELETE CASCADE
        db.likes = db.likes.filter((l) => l.experience_id !== id);
      }
      return res([], gone);
    },
    listExperiences([includeUnpublished, ownerId, pattern, sort, limit, offset]) {
      if (typeof includeUnpublished !== 'boolean') throw new Error('listExperiences: $1 must be boolean');
      const re = pattern === null ? null : likeToRegex(pattern);
      const rows = db.experiences.filter(
        (e) =>
          !e.builtin &&
          (includeUnpublished || e.version > 0) &&
          (ownerId === null || e.owner_id === ownerId) &&
          (re === null || re.test(e.title) || re.test(e.description) || (e.owner_name !== null && re.test(e.owner_name))),
      );
      rows.sort((a, b) => {
        if (sort === 'popular') {
          const d = b.plays + b.likes * 10 - (a.plays + a.likes * 10);
          if (d) return d;
        }
        if (sort === 'updated') {
          const d = desc(a.updated_at, b.updated_at);
          if (d) return d;
        }
        return desc(a.published_at, b.published_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
      return res(rows.slice(offset, offset + limit).map((e) => out(e, META)));
    },
    countExperiences: ([owner]) => res([{ n: db.experiences.filter((e) => e.owner_id === owner).length }]),
    addPlays([id, n]) {
      const e = db.experiences.find((x) => x.id === id);
      if (!e) return res([], 0);
      e.plays += n;
      return res([out(e, ['plays'])]);
    },
    insertLike([experience_id, user_id, created_at]) {
      if (!db.experiences.some((e) => e.id === experience_id)) throw fk('likes_experience_id_fkey');
      if (!db.users.some((u) => u.id === user_id)) throw fk('likes_user_id_fkey');
      if (db.likes.some((l) => l.experience_id === experience_id && l.user_id === user_id)) return res([], 0); // ON CONFLICT DO NOTHING
      db.likes.push({ experience_id, user_id, created_at });
      return res([], 1);
    },
    deleteLike([experience_id, user_id]) {
      const n = db.likes.length;
      db.likes = db.likes.filter((l) => !(l.experience_id === experience_id && l.user_id === user_id));
      return res([], n - db.likes.length);
    },
    bumpLikes([id, d]) {
      const e = db.experiences.find((x) => x.id === id);
      if (!e) return res([], 0);
      e.likes = Math.max(e.likes + d, 0);
      return res([out(e, ['likes'])]);
    },
    likedBy([user, ids]) {
      if (!Array.isArray(ids)) throw new Error('likedBy: $2 must be an array');
      return res(db.likes.filter((l) => l.user_id === user && ids.includes(l.experience_id)).map((l) => ({ experience_id: l.experience_id })));
    },
    addReport(p) {
      const [id, kind, target_id, reason, details, context, reporter_id, reporter_ip, status, created_at] = p;
      db.reports.push({ id, kind, target_id, reason, details, context, reporter_id, reporter_ip, status, created_at });
      return res([], 1);
    },
    listReports: ([limit]) => res([...db.reports].sort((a, b) => b.created_at - a.created_at).slice(0, limit).map((r) => out(r))),
  };

  function run(text, params = []) {
    if (ended) throw new Error('fake pg: pool has ended');
    const sql = String(text).trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) {
      const cmd = sql.toUpperCase();
      log.push(cmd);
      if (cmd === 'BEGIN') snapshot = clone(db);
      else if (cmd === 'ROLLBACK' && snapshot) db = snapshot;
      if (cmd !== 'BEGIN') snapshot = null;
      return res([], 0);
    }
    const m = /^\/\*(\w+)\*\//.exec(sql);
    if (!m || !H[m[1]]) throw new Error(`fake pg: unknown statement ${sql.slice(0, 60)}`);
    const want = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((x) => Number(x[1])));
    if (want !== params.length) throw new Error(`fake pg: ${m[1]} expects ${want} params, got ${params.length}`);
    if (params.some((v) => v === undefined)) throw new Error(`fake pg: ${m[1]} got an undefined param`);
    if ((sql.match(/\(/g) || []).length !== (sql.match(/\)/g) || []).length) throw new Error(`fake pg: ${m[1]} unbalanced parentheses`);
    log.push(m[1]);
    if (m[1] === 'schema') {
      const t = /CREATE (?:TABLE|INDEX) IF NOT EXISTS (\w+)/.exec(sql);
      if (t) log.push(`schema:${t[1]}`);
    }
    return H[m[1]](params);
  }

  const query = async (text, params) => run(text, params);
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
    async end() {
      ended = true;
    },
    on() {},
    /** test helpers */
    log,
    get db() {
      return db;
    },
  };
}
