/**
 * JSON-file platform store (DATA_DIR/platform/). The whole metadata set lives in
 * memory (with indexes) and is written back atomically (temp file + fsync +
 * rename), debounced ~200 ms; big blobs live in their own files and are written
 * immediately, in order per file:
 *
 *   users.json  sessions.json  friends.json  experiences.json  likes.json  reports.json
 *   drafts/<id>.json  versions/<id>/<v>.json  thumbs/<id>.txt
 *
 * A collection file that fails to parse is moved aside (`*.corrupt-<ts>`) and
 * logged, so a damaged file never blocks the service. See store/index.js for
 * the interface (shared with the Postgres store).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { StoreConflict } from '../errors.js';
import { sortExperiences, matchesQuery, pairKey } from './common.js';

const COLLECTIONS = ['users', 'sessions', 'friends', 'experiences', 'likes', 'reports'];
const MAX_REPORTS = 20_000;

export function createJsonStore({ dataDir, log, flushMs = 200 }) {
  const root = path.join(dataDir, 'platform');
  const file = (name) => path.join(root, `${name}.json`);
  const draftFile = (id) => path.join(root, 'drafts', `${id}.json`);
  const versionDir = (id) => path.join(root, 'versions', id);
  const versionFile = (id, v) => path.join(versionDir(id), `${v}.json`);
  const thumbFile = (id) => path.join(root, 'thumbs', `${id}.txt`);

  // ---- state + indexes
  const users = new Map();
  const byName = new Map();
  const byGuest = new Map();
  const sessions = new Map();
  const friends = new Map(); // 'lo|hi' → rec
  const friendsByUser = new Map(); // userId → Set(key)
  const experiences = new Map();
  const likes = new Map(); // expId → Map(userId → at)
  const likesByUser = new Map(); // userId → Set(expId)
  let reports = [];
  /** expId → [{ v, createdAt, size, partCount }] ascending */
  const versionIndex = new Map();

  // ---- persistence
  const dirty = new Set();
  let timer = null;
  let flushing = null;
  const chains = new Map(); // file → promise (ordered writes per file)
  let closed = false;

  function queue(target, job) {
    const prev = chains.get(target) || Promise.resolve();
    const next = prev.then(job, job);
    chains.set(target, next);
    next.finally(() => {
      if (chains.get(target) === next) chains.delete(target);
    }).catch(() => {});
    return next;
  }

  async function writeAtomic(target, text) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(text, 'utf8');
      await fh.datasync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, target);
  }
  const writeFile = (target, text) => queue(target, () => writeAtomic(target, text));
  const removeFile = (target) => queue(target, () => fsp.rm(target, { force: true, recursive: true }));

  function serialize(name) {
    switch (name) {
      case 'users':
        return { v: 1, items: [...users.values()] };
      case 'sessions':
        return { v: 1, items: [...sessions.values()] };
      case 'friends':
        return { v: 1, items: [...friends.values()] };
      case 'experiences':
        return { v: 1, items: [...experiences.values()], versions: Object.fromEntries(versionIndex) };
      case 'likes': {
        const items = [];
        for (const [e, m] of likes) for (const [u, at] of m) items.push([e, u, at]);
        return { v: 1, items };
      }
      case 'reports':
        return { v: 1, items: reports };
    }
    return null;
  }

  function touch(name) {
    dirty.add(name);
    if (!timer && !closed) {
      timer = setTimeout(() => {
        timer = null;
        flush().catch((err) => log.error('platform store flush failed', { err }));
      }, flushMs);
      timer.unref?.();
    }
  }

  async function flush() {
    if (flushing) await flushing;
    if (!dirty.size) return;
    const names = [...dirty];
    dirty.clear();
    flushing = Promise.all(names.map((n) => writeFile(file(n), JSON.stringify(serialize(n))))).finally(() => (flushing = null));
    await flushing;
  }

  async function load(name) {
    let text;
    try {
      text = await fsp.readFile(file(name), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      const aside = `${file(name)}.corrupt-${Date.now()}`;
      log.error('platform store: corrupt collection moved aside', { file: file(name), aside, err });
      await fsp.rename(file(name), aside).catch(() => {});
      return null;
    }
  }

  function indexFriend(rec) {
    const key = pairKey(rec.lo, rec.hi);
    friends.set(key, rec);
    for (const u of [rec.lo, rec.hi]) {
      if (!friendsByUser.has(u)) friendsByUser.set(u, new Set());
      friendsByUser.get(u).add(key);
    }
  }
  function unindexFriend(key) {
    const rec = friends.get(key);
    if (!rec) return false;
    friends.delete(key);
    for (const u of [rec.lo, rec.hi]) friendsByUser.get(u)?.delete(key);
    return true;
  }
  function addLike(e, u, at) {
    if (!likes.has(e)) likes.set(e, new Map());
    likes.get(e).set(u, at);
    if (!likesByUser.has(u)) likesByUser.set(u, new Set());
    likesByUser.get(u).add(e);
  }

  const copy = (o) => (o ? { ...o } : null);
  const copyUser = (u) => (u ? { ...u, restrictions: u.restrictions ? { ...u.restrictions } : null } : null);

  async function readJsonFile(target) {
    try {
      return JSON.parse(await fsp.readFile(target, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  const store = {
    kind: 'json',
    root,

    async init() {
      await fsp.mkdir(root, { recursive: true });
      const [u, s, f, e, l, r] = await Promise.all(COLLECTIONS.map(load));
      for (const x of u?.items || []) {
        users.set(x.id, x);
        byName.set(x.username, x.id);
        if (x.guestTokenHash) byGuest.set(x.guestTokenHash, x.id);
      }
      for (const x of s?.items || []) sessions.set(x.tokenHash, x);
      for (const x of f?.items || []) indexFriend(x);
      for (const x of e?.items || []) experiences.set(x.id, x);
      for (const [id, list] of Object.entries(e?.versions || {})) if (experiences.has(id)) versionIndex.set(id, list);
      for (const [ex, us, at] of l?.items || []) if (experiences.has(ex)) addLike(ex, us, at);
      reports = Array.isArray(r?.items) ? r.items : [];
    },

    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
      await Promise.all([...chains.values()].map((p) => p.catch(() => {})));
    },

    async close() {
      await store.flush();
      closed = true;
    },

    // ---------------------------------------------------------------- users
    async createUser(user) {
      if (byName.has(user.username)) throw new StoreConflict('name_taken');
      if (user.guestTokenHash && byGuest.has(user.guestTokenHash)) throw new StoreConflict('guest_linked');
      const rec = copyUser(user);
      users.set(rec.id, rec);
      byName.set(rec.username, rec.id);
      if (rec.guestTokenHash) byGuest.set(rec.guestTokenHash, rec.id);
      touch('users');
      return copyUser(rec);
    },
    async getUser(id) {
      return copyUser(users.get(id));
    },
    async getUserByName(username) {
      const id = byName.get(username);
      return id ? copyUser(users.get(id)) : null;
    },
    async getUserByGuestHash(hash) {
      const id = byGuest.get(hash);
      return id ? copyUser(users.get(id)) : null;
    },
    async getUsers(ids) {
      const out = [];
      for (const id of ids) {
        const u = users.get(id);
        if (u) out.push(copyUser(u));
      }
      return out;
    },
    async updateUser(id, patch) {
      const u = users.get(id);
      if (!u) return null;
      if (patch.passwordHash !== undefined) u.passwordHash = patch.passwordHash;
      if (patch.restrictions !== undefined) u.restrictions = patch.restrictions ? { ...patch.restrictions } : null;
      u.updatedAt = patch.updatedAt ?? Date.now();
      touch('users');
      return copyUser(u);
    },

    // ---------------------------------------------------------------- sessions
    async createSession(s) {
      sessions.set(s.tokenHash, { ...s });
      touch('sessions');
    },
    async getSession(tokenHash) {
      return copy(sessions.get(tokenHash));
    },
    async touchSession(tokenHash, lastUsedAt, expiresAt) {
      const s = sessions.get(tokenHash);
      if (!s) return;
      s.lastUsedAt = lastUsedAt;
      s.expiresAt = expiresAt;
      touch('sessions');
    },
    async deleteSession(tokenHash) {
      if (sessions.delete(tokenHash)) touch('sessions');
    },
    async deleteUserSessions(userId) {
      let n = 0;
      for (const [k, s] of sessions) if (s.userId === userId) sessions.delete(k), n++;
      if (n) touch('sessions');
      return n;
    },
    async pruneSessions(now) {
      let n = 0;
      for (const [k, s] of sessions) if (s.expiresAt < now) sessions.delete(k), n++;
      if (n) touch('sessions');
      return n;
    },

    // ---------------------------------------------------------------- friends
    async getFriendship(a, b) {
      return copy(friends.get(pairKey(a, b)));
    },
    async listFriendships(userId) {
      const keys = friendsByUser.get(userId);
      return keys ? [...keys].map((k) => copy(friends.get(k))) : [];
    },
    async putFriendship(rec) {
      const key = pairKey(rec.lo, rec.hi);
      unindexFriend(key);
      indexFriend({ ...rec });
      touch('friends');
    },
    async deleteFriendship(a, b) {
      const ok = unindexFriend(pairKey(a, b));
      if (ok) touch('friends');
      return ok;
    },

    // ---------------------------------------------------------------- experiences
    async ensureExperience(meta) {
      if (experiences.has(meta.id)) return copy(experiences.get(meta.id));
      experiences.set(meta.id, { ...meta });
      touch('experiences');
      return copy(meta);
    },
    async createExperience(meta, draft) {
      if (experiences.has(meta.id)) throw new StoreConflict('exists');
      if (draft) await writeFile(draftFile(meta.id), JSON.stringify(draft));
      experiences.set(meta.id, { ...meta });
      touch('experiences');
      return copy(meta);
    },
    async getExperience(id) {
      return copy(experiences.get(id));
    },
    async updateExperience(id, patch) {
      const m = experiences.get(id);
      if (!m) return null;
      for (const k of ['title', 'description', 'maxPlayers', 'updatedAt']) if (patch[k] !== undefined) m[k] = patch[k];
      touch('experiences');
      return copy(m);
    },
    async saveDraft(id, draft, patch) {
      const m = experiences.get(id);
      if (!m) return null;
      await writeFile(draftFile(id), JSON.stringify(draft));
      if (!experiences.has(id)) return null; // deleted meanwhile
      for (const k of ['title', 'description', 'maxPlayers', 'updatedAt']) if (patch[k] !== undefined) m[k] = patch[k];
      m.draftSavedAt = draft.savedAt;
      touch('experiences');
      return copy(m);
    },
    async getDraft(id) {
      if (!experiences.has(id)) return null;
      return readJsonFile(draftFile(id));
    },
    async setThumbnail(id, dataUrl, rev) {
      const m = experiences.get(id);
      if (!m) return null;
      if (dataUrl) await writeFile(thumbFile(id), dataUrl);
      else await removeFile(thumbFile(id));
      m.thumbRev = dataUrl ? rev : 0;
      touch('experiences');
      return copy(m);
    },
    async getThumbnail(id) {
      const m = experiences.get(id);
      if (!m || !m.thumbRev) return null;
      try {
        return { dataUrl: await fsp.readFile(thumbFile(id), 'utf8'), rev: m.thumbRev };
      } catch {
        return null;
      }
    },
    async publishVersion(id, version, keep) {
      // one publish at a time per experience: the number is only visible once its file exists
      return queue(`publish:${id}`, async () => {
        const m = experiences.get(id);
        if (!m) return null;
        const v = (m.version || 0) + 1;
        const rec = { v, data: version.data, createdAt: version.createdAt, size: version.size, partCount: version.partCount };
        await writeFile(versionFile(id, v), JSON.stringify(rec));
        if (experiences.get(id) !== m) return null; // deleted meanwhile
        m.version = v;
        m.partCount = version.partCount;
        m.size = version.size;
        m.publishedAt = version.createdAt;
        m.updatedAt = version.createdAt;
        const list = versionIndex.get(id) || [];
        list.push({ v, createdAt: rec.createdAt, size: rec.size, partCount: rec.partCount });
        while (keep > 0 && list.length > keep) {
          const old = list.shift();
          removeFile(versionFile(id, old.v)).catch(() => {});
        }
        versionIndex.set(id, list);
        touch('experiences');
        return { meta: copy(m), version: { v, createdAt: rec.createdAt, size: rec.size, partCount: rec.partCount } };
      });
    },
    async getVersion(id, v) {
      if (!experiences.has(id) || !(versionIndex.get(id) || []).some((x) => x.v === v)) return null;
      return readJsonFile(versionFile(id, v));
    },
    async listVersions(id) {
      return (versionIndex.get(id) || []).map((x) => ({ ...x })).reverse();
    },
    async deleteExperience(id) {
      if (!experiences.delete(id)) return false;
      versionIndex.delete(id);
      const l = likes.get(id);
      if (l) {
        for (const u of l.keys()) likesByUser.get(u)?.delete(id);
        likes.delete(id);
        touch('likes');
      }
      touch('experiences');
      await Promise.all([removeFile(draftFile(id)), removeFile(versionDir(id)), removeFile(thumbFile(id))]);
      return true;
    },
    async listExperiences({ sort = 'popular', q = '', ownerId = null, includeUnpublished = false, limit = 24, offset = 0 } = {}) {
      const ql = q ? q.toLowerCase() : '';
      const items = [];
      const pool = ownerId ? [...experiences.values()].filter((m) => m.ownerId === ownerId) : experiences.values();
      for (const m of pool) {
        if (m.builtin) continue;
        if (!includeUnpublished && !(m.version > 0)) continue;
        if (ql && !matchesQuery(m, ql)) continue;
        items.push(m);
      }
      sortExperiences(items, sort);
      const page = items.slice(offset, offset + limit + 1);
      return { items: page.slice(0, limit).map(copy), hasMore: page.length > limit };
    },
    async countExperiences(ownerId) {
      let n = 0;
      for (const m of experiences.values()) if (m.ownerId === ownerId) n++;
      return n;
    },
    async addPlays(id, n = 1) {
      const m = experiences.get(id);
      if (!m) return null;
      m.plays = (m.plays || 0) + n;
      touch('experiences');
      return m.plays;
    },
    async setLike(id, userId, on, at) {
      const m = experiences.get(id);
      if (!m) return null;
      const has = !!likes.get(id)?.has(userId);
      let changed = false;
      if (on && !has) {
        addLike(id, userId, at);
        m.likes = (m.likes || 0) + 1;
        changed = true;
      } else if (!on && has) {
        likes.get(id).delete(userId);
        likesByUser.get(userId)?.delete(id);
        m.likes = Math.max(0, (m.likes || 0) - 1);
        changed = true;
      }
      if (changed) touch('likes'), touch('experiences');
      return { changed, likes: m.likes };
    },
    async likedBy(userId, ids) {
      const mine = likesByUser.get(userId);
      const out = new Set();
      if (mine) for (const id of ids) if (mine.has(id)) out.add(id);
      return out;
    },

    // ---------------------------------------------------------------- reports
    async addReport(r) {
      reports.push({ ...r });
      if (reports.length > MAX_REPORTS) reports = reports.slice(-MAX_REPORTS);
      touch('reports');
    },
    async listReports({ limit = 100 } = {}) {
      return reports.slice(-limit).reverse().map(copy);
    },
  };
  return store;
}
