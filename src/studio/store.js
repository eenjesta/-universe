/**
 * Ø Studio — where drafts and published experiences live.
 *
 * Local (always; localStorage, or memory with ?nosave):
 *   oU.studio.index        [{ id, title, updated, parts, cloudId, published, pubUpdated }]
 *   oU.studio.draft.<id>   experience JSON (the working draft)
 *   oU.studio.pub.<id>     experience JSON published locally (signed out / offline)
 *   oU.studio.thumb.<id>   small JPEG data URL
 * Cloud (signed in: ctx.platform.api, PLATFORM.md §10):
 *   create  POST /api/experiences            { title, description, maxPlayers, data, thumbnail? } → id
 *   save    PUT  /api/experiences/:id        { title, description, maxPlayers, data, thumbnail? }
 *   publish POST /api/experiences/:id/publish { thumbnail? } | { title, description, maxPlayers, data, thumbnail? }
 *   get     GET  /api/experiences/:id[?draft=1] → experience data (draft for the owner when asked)
 *   mine    GET  /api/users/:username/experiences
 * Response shapes are read tolerantly ({ experience: {...} } or the object itself; `data` / `draft` /
 * `version.data`), see notes/studio-requests.md.
 */
import { validate } from './format.js';

const K = 'oU.studio.';

export function createStore(ctx) {
  const mem = new Map();
  const persist = !ctx.params?.nosave;
  const ls = {
    get(k) {
      if (!persist) return mem.get(k) ?? null;
      try {
        return localStorage.getItem(k);
      } catch {
        return mem.get(k) ?? null;
      }
    },
    set(k, v) {
      if (!persist) {
        mem.set(k, v);
        return true;
      }
      try {
        localStorage.setItem(k, v);
        return true;
      } catch {
        mem.set(k, v); // quota: keep it for this session at least
        return false;
      }
    },
    del(k) {
      mem.delete(k);
      if (!persist) return;
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
  const readJSON = (k, d) => {
    try {
      const s = ls.get(k);
      return s ? JSON.parse(s) : d;
    } catch {
      return d;
    }
  };

  const index = () => {
    const list = readJSON(`${K}index`, []);
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string') : [];
  };
  const writeIndex = (list) => ls.set(`${K}index`, JSON.stringify(list.slice(0, 200)));
  const upsert = (entry) => {
    const list = index();
    const i = list.findIndex((e) => e.id === entry.id);
    if (i >= 0) list[i] = { ...list[i], ...entry };
    else list.unshift(entry);
    writeIndex(list);
    return i >= 0 ? list[i] : entry;
  };

  // ------------------------------------------------------------ cloud
  const platform = () => ctx.platform;
  const pick = (res, ...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), res);
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };
  const cloud = {
    /** True when a signed-in account can save to the platform API. */
    available() {
      const p = platform();
      return !!(p && p.available !== false && p.user && typeof p.api === 'function');
    },
    async create(exp, thumbnail = null) {
      const res = await platform().api('/api/experiences', { method: 'POST', body: body(exp, thumbnail) });
      const id = pick(res, 'experience.id', 'id', 'data.id');
      if (!id) throw Object.assign(new Error('no id'), { code: 'bad_response' });
      return String(id);
    },
    async save(id, exp, thumbnail = null) {
      return platform().api(`/api/experiences/${encodeURIComponent(id)}`, { method: 'PUT', body: body(exp, thumbnail) });
    },
    /** Publishes the saved draft; with `exp` the draft is saved in the same request first. */
    async publish(id, thumbnail = null, exp = null) {
      const b = exp ? body(exp, thumbnail) : thumbnail ? { thumbnail } : {};
      return platform().api(`/api/experiences/${encodeURIComponent(id)}/publish`, { method: 'POST', body: b });
    },
    async get(id, { draft = false } = {}) {
      const res = await platform().api(`/api/experiences/${encodeURIComponent(id)}${draft ? '?draft=1' : ''}`);
      return extractExperience(res, draft);
    },
    async mine() {
      const user = platform()?.user;
      if (!user?.username) return [];
      const res = await platform().api(`/api/users/${encodeURIComponent(user.username)}/experiences`);
      const list = Array.isArray(res) ? res : pick(res, 'experiences', 'items') || [];
      return list.map((x) => (x?.experience && !x.id ? x.experience : x)).filter((x) => x && x.id);
    },
  };
  function body(exp, thumbnail) {
    const b = { title: exp.meta.title, description: exp.meta.description, maxPlayers: exp.meta.maxPlayers, data: exp };
    if (thumbnail) b.thumbnail = thumbnail;
    return b;
  }

  // ------------------------------------------------------------ local
  return {
    cloud,
    persist,
    list() {
      return index().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    },
    entry(id) {
      return index().find((e) => e.id === id) || null;
    },
    load(id) {
      const raw = readJSON(`${K}draft.${id}`, null);
      if (!raw) return null;
      const r = validate(raw);
      return r.ok ? r.exp : null;
    },
    /** Saves a draft locally; returns { ok, entry } (ok false = storage full). */
    save(id, exp, extra = {}) {
      const ok = ls.set(`${K}draft.${id}`, JSON.stringify(exp));
      const entry = upsert({ id, title: exp.meta.title, updated: Date.now(), parts: exp.parts.length, ...extra });
      return { ok, entry };
    },
    setThumb(id, dataUrl) {
      if (dataUrl) ls.set(`${K}thumb.${id}`, dataUrl);
    },
    thumb(id) {
      return ls.get(`${K}thumb.${id}`);
    },
    update(id, fields) {
      return upsert({ id, ...fields });
    },
    remove(id) {
      writeIndex(index().filter((e) => e.id !== id));
      ls.del(`${K}draft.${id}`);
      ls.del(`${K}pub.${id}`);
      ls.del(`${K}thumb.${id}`);
    },
    /** Local "publish": a frozen copy that ctx.studio.playLocal / the Home "Mine" row can play. */
    publishLocal(id, exp) {
      const ok = ls.set(`${K}pub.${id}`, JSON.stringify(exp));
      upsert({ id, title: exp.meta.title, published: Date.now(), pubUpdated: Date.now() });
      return ok;
    },
    loadPublished(id) {
      const raw = readJSON(`${K}pub.${id}`, null);
      if (!raw) return null;
      const r = validate(raw);
      return r.ok ? r.exp : null;
    },
    listPublished() {
      return index()
        .filter((e) => e.published)
        .sort((a, b) => (b.pubUpdated || 0) - (a.pubUpdated || 0))
        .map((e) => ({ ...e, thumbnail: ls.get(`${K}thumb.${e.id}`) || null }));
    },
  };
}

/** Finds the experience JSON inside an API response (published version, or the draft for owners). */
export function extractExperience(res, preferDraft = false) {
  if (!res || typeof res !== 'object') return null;
  if (res.format || Array.isArray(res.parts)) return res;
  const x = res.experience && typeof res.experience === 'object' ? res.experience : res;
  const draft = [res.draft?.data, x.draft?.data, x.draft, res.draft];
  const cands = preferDraft
    ? [...draft, x.data, res.data, res.version?.data, x.version?.data, x.latest?.data]
    : [res.version?.data, x.version?.data, x.latest?.data, x.data, res.data, ...draft];
  for (const c of cands) if (c && typeof c === 'object' && (c.format || Array.isArray(c.parts))) return c;
  return null;
}
