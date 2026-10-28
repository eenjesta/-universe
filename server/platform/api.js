/**
 * Platform API routes + handlers (PLATFORM.md §10). Mounted by index.js; each
 * handler gets a request context `c` and returns `{ status?, body, headers? }`
 * (or writes a raw response itself when the route has `raw: true`).
 *
 *   c = { req, res, method, path, params, query (URLSearchParams), ip, lang,
 *         user (store record | null), auth ({ hash, session } | null), body, now }
 */
import { fail } from './errors.js';
import { KB } from './http.js';
import { hashPassword, verifyPassword, newSessionToken, hashToken, newId } from './crypto.js';
import {
  parseUsername, parsePassword, parseBirthYear, ageGroup, cleanString, cleanMetaText, parseThumbnail,
  validateExperience, validateExperienceAsync, defaultExperience, EXP_FORMAT, LIMITS,
} from './validate.js';
import { USERNAME_RE } from './filter.js';
import { pairOf } from './store/common.js';
import { FLAGSHIP, FLAGSHIP_ID, flagshipMatches } from './flagship.js';

export const SMALL_BODY = 16 * KB;
export const BIG_BODY = LIMITS.MAX_BYTES + LIMITS.THUMB_MAX + 16 * KB;

export const POLICY = {
  SESSION_TTL_MS: 30 * 24 * 3600 * 1000, // sliding
  SESSION_TOUCH_MS: 3600 * 1000,
  MAX_FRIENDS: 200,
  MAX_PENDING_OUT: 50,
  MAX_EXPERIENCES: 50,
  KEEP_VERSIONS: 30,
  PLAY_DEDUPE_MS: 10 * 60 * 1000,
  ONLINE_WINDOW_MS: 2 * 60 * 1000, // API activity counts as "online" this long
  PLAY_PRESENCE_MS: 15 * 60 * 1000, // "playing X" after POST /play (single-player experiences)
};

const REPORT_KINDS = ['user', 'experience', 'chat', 'player', 'other'];
const EXP_ID_RE = /^[a-z0-9-]{1,40}$/;

/** Text in the request language from a `{ en, nl }` pair. */
const pick = (pair, lang) => (lang === 'nl' && pair.nl ? pair.nl : pair.en);

export function createApi({ store, limiter, limits, log, presence, scryptCost, now: clock = Date.now }) {
  let dummyHash = null; // equalises login timing for unknown usernames
  const plays = new Map(); // `${who}|${id}` → ms (play-count de-duplication)

  // ------------------------------------------------------------- views
  function restrictionsOf(u, t) {
    const under13 = ageGroup(u.birthYear, t) === 'under13';
    const r = u.restrictions || {};
    return { chat: r.chat ?? under13, friends: r.friends ?? under13 };
  }
  function privateUser(u, t = clock()) {
    return {
      id: u.id,
      username: u.username,
      displayName: u.username,
      createdAt: u.createdAt,
      birthYear: u.birthYear,
      ageGroup: ageGroup(u.birthYear, t),
      restrictions: restrictionsOf(u, t),
      guestLinked: !!u.guestTokenHash,
    };
  }
  const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.username, createdAt: u.createdAt });

  const thumbUrl = (m) => (m.thumbRev ? `/api/experiences/${m.id}/thumbnail?v=${m.thumbRev}` : null);

  function summary(m, { lang, owner = false, liked } = {}) {
    if (m.builtin) return flagshipSummary(m, lang, liked);
    const s = {
      id: m.id,
      kind: 'experience',
      builtin: false,
      multiplayer: false,
      title: m.title,
      description: m.description,
      creator: { id: m.ownerId, username: m.ownerName, displayName: m.ownerName },
      maxPlayers: m.maxPlayers,
      playing: presence.count(m.id),
      plays: m.plays || 0,
      likes: m.likes || 0,
      version: m.version || 0,
      published: m.version > 0,
      partCount: m.partCount || 0,
      size: m.size || 0,
      thumbnail: thumbUrl(m),
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      publishedAt: m.publishedAt ?? null,
    };
    if (liked !== undefined) s.liked = liked;
    if (owner) s.draftSavedAt = m.draftSavedAt ?? null;
    return s;
  }

  function flagshipSummary(row, lang, liked) {
    const s = {
      id: FLAGSHIP_ID,
      kind: FLAGSHIP.kind,
      builtin: true,
      official: true,
      multiplayer: true,
      title: pick(FLAGSHIP.title, lang),
      description: pick(FLAGSHIP.description, lang),
      i18n: { title: { ...FLAGSHIP.title }, description: { ...FLAGSHIP.description } },
      creator: { ...FLAGSHIP.creator },
      maxPlayers: FLAGSHIP.maxPlayers,
      playing: presence.count(FLAGSHIP_ID),
      plays: row?.plays || 0,
      likes: row?.likes || 0,
      version: 1,
      published: true,
      tags: FLAGSHIP.tags.slice(),
      thumbnail: null,
      createdAt: FLAGSHIP.createdAt,
      updatedAt: FLAGSHIP.createdAt,
      publishedAt: FLAGSHIP.createdAt,
    };
    if (liked !== undefined) s.liked = liked;
    return s;
  }

  async function summaries(c, metas, opts = {}) {
    const liked = c.user ? await store.likedBy(c.user.id, metas.map((m) => m.id)) : null;
    return metas.map((m) => summary(m, { lang: c.lang, owner: c.user?.id === m.ownerId && !m.builtin, liked: liked ? liked.has(m.id) : undefined, ...opts }));
  }

  // ------------------------------------------------------------- helpers
  async function startSession(u, t) {
    const token = newSessionToken();
    await store.createSession({ tokenHash: hashToken(token), userId: u.id, createdAt: t, expiresAt: t + POLICY.SESSION_TTL_MS, lastUsedAt: t });
    return token;
  }

  const str = (v) => (typeof v === 'string' ? v : '');
  function intParam(q, name, min, max, def) {
    const raw = q.get(name);
    if (raw === null || raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n)) throw fail('invalid', { field: name });
    return Math.min(max, Math.max(min, n));
  }
  function expId(c) {
    const id = c.params.id;
    if (!EXP_ID_RE.test(id)) throw fail('not_found');
    return id;
  }
  /** The experience, owned by the caller (404 when missing, 403 when someone else's / built in). */
  async function owned(c) {
    const id = expId(c);
    if (id === FLAGSHIP_ID) throw fail('forbidden');
    const m = await store.getExperience(id);
    if (!m || m.builtin) throw fail('not_found');
    if (m.ownerId !== c.user.id) throw fail('forbidden');
    return m;
  }
  /** A listed experience (published or the flagship) — for likes and plays. */
  async function listed(c) {
    const id = expId(c);
    const m = await store.getExperience(id);
    if (!m || (!m.builtin && !(m.version > 0))) throw fail('not_found');
    return m;
  }

  /** Validate an experience body (`{ data, title?, description?, thumbnail? }` or the document itself). */
  async function readExperienceBody(b) {
    const isDoc = b.format === EXP_FORMAT || Array.isArray(b.parts);
    const raw = isDoc ? b : b.data;
    const out = { result: null, title: null, description: null, thumbnail: undefined, filtered: false };
    if (raw !== undefined && raw !== null) {
      out.result = await validateExperienceAsync(raw);
      out.filtered = out.result.filtered;
    }
    if (!isDoc) {
      if (b.title !== undefined) {
        const t = cleanMetaText(b.title, 'title');
        out.title = t.text;
        out.filtered ||= t.filtered;
      }
      if (b.description !== undefined) {
        const d = cleanMetaText(b.description, 'description');
        out.description = d.text;
        out.filtered ||= d.filtered;
      }
      if (b.thumbnail !== undefined) out.thumbnail = parseThumbnail(b.thumbnail);
    }
    return out;
  }

  /** Merge title/description into the document's meta (the listing and the document stay in sync). */
  function syncMeta(data, title, description) {
    data.meta.title = title;
    data.meta.description = description;
  }

  const untitled = (lang) => (lang === 'nl' ? 'Naamloze ervaring' : 'Untitled experience');

  async function saveDraftFrom(c, m, parsed) {
    const t = c.now;
    let data;
    if (parsed.result) data = parsed.result.data;
    else {
      const d = await store.getDraft(m.id);
      data = d?.data ?? defaultExperience(m.title);
    }
    const title = parsed.title ?? (parsed.result ? data.meta.title : null) ?? m.title;
    const description = parsed.description ?? (parsed.result ? data.meta.description : null) ?? m.description;
    syncMeta(data, title || m.title || untitled(c.lang), description ?? '');
    const size = Buffer.byteLength(JSON.stringify(data), 'utf8');
    const partCount = data.parts.length;
    if (size > LIMITS.MAX_BYTES) throw fail('too_large');
    const meta = await store.saveDraft(m.id, { data, savedAt: t, size, partCount }, { title: data.meta.title, description: data.meta.description, maxPlayers: data.meta.maxPlayers, updatedAt: t });
    if (!meta) throw fail('not_found');
    let out = meta;
    if (parsed.thumbnail !== undefined) out = (await store.setThumbnail(m.id, parsed.thumbnail?.dataUrl ?? null, t)) || out;
    return { meta: out, draft: { savedAt: t, size, partCount }, data };
  }

  // ------------------------------------------------------------- auth
  async function register(c) {
    const b = c.body;
    const username = parseUsername(b.username);
    const password = parsePassword(b.password, username);
    const birthYear = parseBirthYear(b.birthYear, c.now);
    let guestTokenHash = null;
    if (b.guestToken !== undefined && b.guestToken !== null && b.guestToken !== '') {
      if (typeof b.guestToken !== 'string' || b.guestToken.length < 16 || b.guestToken.length > 256) throw fail('invalid', { field: 'guestToken' });
      guestTokenHash = hashToken(b.guestToken);
      if (await store.getUserByGuestHash(guestTokenHash)) throw fail('guest_linked', { field: 'guestToken' });
    }
    if (await store.getUserByName(username)) throw fail('name_taken', { field: 'username' });
    const reg = limiter.check(`register:${c.ip}`, limits.register);
    if (!reg.ok) throw rateLimited(reg.retryAfter);
    const t = c.now;
    const user = {
      id: newId('u'),
      username,
      passwordHash: await hashPassword(password, scryptCost),
      birthYear,
      guestTokenHash,
      guestLinkedAt: guestTokenHash ? t : null,
      restrictions: null,
      createdAt: t,
      updatedAt: t,
    };
    try {
      await store.createUser(user);
    } catch (err) {
      if (err.conflict) throw fail(err.code === 'guest_linked' ? 'guest_linked' : 'name_taken', { field: err.code === 'guest_linked' ? 'guestToken' : 'username' });
      throw err;
    }
    limiter.take(`register:${c.ip}`, limits.register);
    const token = await startSession(user, t);
    log.info('platform account created', { user: user.id, ageGroup: ageGroup(birthYear, t), guestLinked: !!guestTokenHash });
    return { status: 201, body: { token, user: privateUser(user, t) } };
  }

  async function login(c) {
    const name = str(c.body.username).trim().toLowerCase();
    const password = str(c.body.password);
    if (!name || !password || name.length > 64 || password.length > 1024) throw fail('bad_credentials');
    const key = `loginName:${name}`;
    const chk = limiter.check(key, limits.loginName);
    if (!chk.ok) throw rateLimited(chk.retryAfter);
    const u = USERNAME_RE.test(name) ? await store.getUserByName(name) : null;
    dummyHash ||= await hashPassword('not-a-real-password-' + Math.random(), scryptCost);
    const ok = await verifyPassword(password, u ? u.passwordHash : dummyHash);
    if (!u || !ok) {
      limiter.take(key, limits.loginName);
      throw fail('bad_credentials');
    }
    const token = await startSession(u, c.now);
    return { body: { token, user: privateUser(u, c.now) } };
  }

  async function logout(c) {
    await store.deleteSession(c.auth.hash);
    return { body: { ok: true } };
  }

  const me = async (c) => ({ body: { user: privateUser(c.user, c.now) } });

  // ------------------------------------------------------------- friends
  const otherOf = (rec, id) => (rec.lo === id ? rec.hi : rec.lo);
  const STATUS_RANK = { 'in-game': 0, online: 1, offline: 2 };

  async function listFriends(c) {
    const meId = c.user.id;
    const recs = await store.listFriendships(meId);
    const users = new Map((await store.getUsers(recs.map((r) => otherOf(r, meId)))).map((u) => [u.id, u]));
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const r of recs) {
      const u = users.get(otherOf(r, meId));
      if (!u) continue;
      if (r.status === 'accepted') {
        const p = presence.of(u.id);
        friends.push({ ...publicUser(u), status: p.status, experienceId: p.experienceId, since: r.acceptedAt });
      } else if (r.requester === meId) outgoing.push({ ...publicUser(u), at: r.createdAt });
      else incoming.push({ ...publicUser(u), at: r.createdAt });
    }
    friends.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.username < b.username ? -1 : 1));
    incoming.sort((a, b) => b.at - a.at);
    outgoing.sort((a, b) => b.at - a.at);
    return {
      body: {
        friends,
        incoming,
        outgoing,
        online: friends.filter((f) => f.status !== 'offline').length,
        restricted: restrictionsOf(c.user, c.now).friends,
      },
    };
  }

  /** Target user from `{ username }` or `{ id }`. */
  async function friendTarget(b) {
    if (typeof b.username === 'string' && b.username.trim()) {
      const name = b.username.trim().replace(/^@/, '').toLowerCase();
      const u = USERNAME_RE.test(name) ? await store.getUserByName(name) : null;
      if (!u) throw fail('user_not_found', { field: 'username' });
      return u;
    }
    if (typeof b.id === 'string' && /^[a-z0-9]{2,40}$/.test(b.id)) {
      const u = await store.getUser(b.id);
      if (!u) throw fail('user_not_found', { field: 'id' });
      return u;
    }
    throw fail('invalid', { field: 'username' });
  }

  async function requestFriend(c) {
    const meU = c.user;
    const target = await friendTarget(c.body);
    if (target.id === meU.id) throw fail('self');
    if (restrictionsOf(meU, c.now).friends) throw fail('restricted');
    if (restrictionsOf(target, c.now).friends) {
      throw fail('restricted', { message: 'This player cannot receive friend requests.', nl: 'Deze speler kan geen vriendschapsverzoeken ontvangen.' });
    }
    const rec = await store.getFriendship(meU.id, target.id);
    if (rec?.status === 'accepted') throw fail('already_friends');
    if (rec?.status === 'pending') {
      if (rec.requester === meU.id) throw fail('already_requested');
      await store.putFriendship({ ...rec, status: 'accepted', acceptedAt: c.now }); // they asked first → friends
      return { body: { status: 'accepted', friend: { ...publicUser(target), ...presence.of(target.id) } } };
    }
    const mine = await store.listFriendships(meU.id);
    if (mine.filter((r) => r.status === 'accepted').length >= POLICY.MAX_FRIENDS) throw fail('limit', { message: 'You have reached the friend limit.', nl: 'Je hebt het maximale aantal vrienden bereikt.' });
    if (mine.filter((r) => r.status === 'pending' && r.requester === meU.id).length >= POLICY.MAX_PENDING_OUT) {
      throw fail('limit', { message: 'You have too many open friend requests.', nl: 'Je hebt te veel openstaande vriendschapsverzoeken.' });
    }
    const theirs = await store.listFriendships(target.id);
    if (theirs.filter((r) => r.status === 'accepted').length >= POLICY.MAX_FRIENDS) {
      throw fail('limit', { message: 'That player has reached the friend limit.', nl: 'Die speler heeft het maximale aantal vrienden bereikt.' });
    }
    const [lo, hi] = pairOf(meU.id, target.id);
    await store.putFriendship({ lo, hi, requester: meU.id, status: 'pending', createdAt: c.now, acceptedAt: null });
    return { status: 201, body: { status: 'pending', friend: publicUser(target) } };
  }

  async function acceptFriend(c) {
    const other = await friendTarget(c.body);
    const rec = await store.getFriendship(c.user.id, other.id);
    if (!rec || rec.status !== 'pending' || rec.requester === c.user.id) throw fail('no_request');
    if (restrictionsOf(c.user, c.now).friends) throw fail('restricted');
    await store.putFriendship({ ...rec, status: 'accepted', acceptedAt: c.now });
    return { body: { status: 'accepted', friend: { ...publicUser(other), ...presence.of(other.id) } } };
  }

  async function removeFriend(c) {
    const other = await friendTarget(c.body);
    const ok = await store.deleteFriendship(c.user.id, other.id);
    if (!ok) throw fail('not_found');
    return { body: { removed: true, id: other.id } };
  }

  // ------------------------------------------------------------- experiences
  async function listExperiences(c) {
    const sort = c.query.get('sort') === 'new' ? 'new' : 'popular';
    const q = cleanString(c.query.get('q') || '', 60);
    const limit = intParam(c.query, 'limit', 1, 50, 24);
    const offset = intParam(c.query, 'offset', 0, 100_000, 0);
    const { items, hasMore } = await store.listExperiences({ sort, q, limit, offset });
    const out = [];
    if (offset === 0 && (!q || flagshipMatches(q))) {
      const row = await store.getExperience(FLAGSHIP_ID);
      const liked = c.user ? (await store.likedBy(c.user.id, [FLAGSHIP_ID])).has(FLAGSHIP_ID) : undefined;
      out.push(flagshipSummary(row, c.lang, liked));
    }
    out.push(...(await summaries(c, items)));
    return { body: { experiences: out, sort, q, offset, nextOffset: hasMore ? offset + limit : null } };
  }

  async function getExperience(c) {
    const id = expId(c);
    const m = await store.getExperience(id);
    if (id === FLAGSHIP_ID) {
      const liked = c.user ? (await store.likedBy(c.user.id, [id])).has(id) : undefined;
      return { body: { experience: flagshipSummary(m, c.lang, liked), version: null } };
    }
    if (!m || m.builtin) throw fail('not_found');
    const isOwner = c.user?.id === m.ownerId;
    if (!(m.version > 0) && !isOwner) throw fail('not_found');
    const wanted = c.query.has('v') ? intParam(c.query, 'v', 1, 1e9, m.version) : m.version;
    const withData = c.query.get('data') !== '0';
    let version = null;
    if (wanted > 0) {
      const v = await store.getVersion(id, wanted);
      if (!v && c.query.has('v')) throw fail('not_found');
      if (v) version = { v: v.v, createdAt: v.createdAt, size: v.size, partCount: v.partCount, ...(withData ? { data: v.data } : {}) };
    }
    const [s] = await summaries(c, [m]);
    const body = { experience: s, version };
    if (isOwner && /^(1|true)$/.test(c.query.get('draft') || '')) body.draft = await store.getDraft(id);
    return { body };
  }

  async function createExperience(c) {
    const meU = c.user;
    if ((await store.countExperiences(meU.id)) >= POLICY.MAX_EXPERIENCES) {
      throw fail('limit', { message: `You can have at most ${POLICY.MAX_EXPERIENCES} experiences.`, nl: `Je kunt maximaal ${POLICY.MAX_EXPERIENCES} ervaringen hebben.` });
    }
    const parsed = await readExperienceBody(c.body);
    const res = parsed.result || validateExperience(defaultExperience(parsed.title || untitled(c.lang)));
    const data = res.data;
    const title = parsed.title || data.meta.title || untitled(c.lang);
    const description = parsed.description ?? data.meta.description ?? '';
    syncMeta(data, title, description);
    const size = Buffer.byteLength(JSON.stringify(data), 'utf8');
    if (size > LIMITS.MAX_BYTES) throw fail('too_large');
    const t = c.now;
    const meta = {
      id: newId('x'),
      ownerId: meU.id,
      ownerName: meU.username,
      title,
      description,
      maxPlayers: data.meta.maxPlayers,
      builtin: false,
      version: 0,
      plays: 0,
      likes: 0,
      partCount: 0,
      size: 0,
      thumbRev: 0,
      draftSavedAt: t,
      createdAt: t,
      updatedAt: t,
      publishedAt: null,
    };
    const draft = { data, savedAt: t, size, partCount: data.parts.length };
    let saved = await store.createExperience(meta, draft);
    if (parsed.thumbnail) saved = (await store.setThumbnail(meta.id, parsed.thumbnail.dataUrl, t)) || saved;
    return {
      status: 201,
      body: { experience: summary(saved, { lang: c.lang, owner: true }), draft: { ...draft }, filtered: parsed.filtered || res.filtered },
    };
  }

  async function saveExperience(c) {
    const m = await owned(c);
    const parsed = await readExperienceBody(c.body);
    if (!parsed.result && parsed.title === null && parsed.description === null && parsed.thumbnail === undefined) {
      throw fail('invalid', { field: 'data', message: 'Nothing to save: send the experience as `data`.', nl: 'Niets om op te slaan: stuur de ervaring als `data`.' });
    }
    const out = await saveDraftFrom(c, m, parsed);
    const body = { experience: summary(out.meta, { lang: c.lang, owner: true }), draft: out.draft, filtered: parsed.filtered };
    if (parsed.filtered) body.data = out.data; // the cleaned text, so the editor can show it
    return { body };
  }

  async function publishExperience(c) {
    const m = await owned(c);
    let filtered = false;
    const b = c.body || {};
    if (b.data !== undefined || b.format === EXP_FORMAT || Array.isArray(b.parts) || b.title !== undefined || b.description !== undefined || b.thumbnail !== undefined) {
      const parsed = await readExperienceBody(b);
      filtered = parsed.filtered;
      await saveDraftFrom(c, m, parsed);
    }
    const draft = await store.getDraft(m.id);
    if (!draft) throw fail('invalid', { field: 'data', message: 'Nothing to publish yet: save a draft first.', nl: 'Nog niets om te publiceren: sla eerst een concept op.' });
    const r = await validateExperienceAsync(draft.data); // stored drafts are re-checked (filters may have grown)
    filtered ||= r.filtered;
    const res = await store.publishVersion(m.id, { data: r.data, size: r.size, partCount: r.partCount, createdAt: c.now }, POLICY.KEEP_VERSIONS);
    if (!res) throw fail('not_found');
    log.info('platform experience published', { id: m.id, v: res.version.v, parts: r.partCount, bytes: r.size });
    return { body: { experience: summary(res.meta, { lang: c.lang, owner: true }), version: res.version, filtered } };
  }

  async function deleteExperience(c) {
    const m = await owned(c);
    await store.deleteExperience(m.id);
    log.info('platform experience deleted', { id: m.id, by: c.user.id });
    return { body: { deleted: true, id: m.id } };
  }

  async function likeExperience(c) {
    const m = await listed(c);
    const b = c.body || {};
    const on = !(b.like === false || b.liked === false);
    const r = await store.setLike(m.id, c.user.id, on, c.now);
    if (!r) throw fail('not_found');
    return { body: { id: m.id, liked: on, likes: r.likes } };
  }

  async function playExperience(c) {
    const m = await listed(c);
    const who = c.user ? `u:${c.user.id}` : `ip:${c.ip}`;
    const key = `${who}|${m.id}`;
    const last = plays.get(key);
    let count = m.plays || 0;
    let counted = false;
    if (!last || c.now - last >= POLICY.PLAY_DEDUPE_MS) {
      plays.set(key, c.now);
      count = (await store.addPlays(m.id, 1)) ?? count;
      counted = true;
    }
    if (c.user && !m.builtin) presence.set(c.user.id, 'in-game', { experienceId: m.id, until: c.now + POLICY.PLAY_PRESENCE_MS, soft: true });
    return { body: { id: m.id, plays: count, counted } };
  }

  async function listVersions(c) {
    const id = expId(c);
    const m = await store.getExperience(id);
    if (!m || m.builtin) throw fail('not_found');
    if (!(m.version > 0) && c.user?.id !== m.ownerId) throw fail('not_found');
    return { body: { id, latest: m.version, versions: await store.listVersions(id) } };
  }

  async function getThumbnail(c) {
    const id = expId(c);
    const t = await store.getThumbnail(id);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/s.exec(t?.dataUrl || '');
    if (!m) throw fail('not_found');
    const etag = `"t${t.rev}"`;
    const fresh = String(c.query.get('v')) === String(t.rev);
    const headers = {
      'Content-Type': m[1],
      'Cache-Control': fresh ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    };
    const res = c.res;
    if (String(c.req.headers['if-none-match'] || '').split(',').some((x) => x.trim() === etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const buf = Buffer.from(m[2], 'base64');
    res.writeHead(200, { ...headers, 'Content-Length': buf.length });
    res.end(c.method === 'HEAD' ? undefined : buf);
  }

  // ------------------------------------------------------------- users
  async function userByParam(c) {
    const name = String(c.params.username || '').toLowerCase();
    const u = USERNAME_RE.test(name) ? await store.getUserByName(name) : null;
    if (!u) throw fail('user_not_found');
    return u;
  }

  async function getUserProfile(c) {
    const u = await userByParam(c);
    const body = { user: publicUser(u) };
    if (c.user && c.user.id !== u.id) {
      const rec = await store.getFriendship(c.user.id, u.id);
      body.friendship = !rec ? null : rec.status === 'accepted' ? 'friends' : rec.requester === c.user.id ? 'outgoing' : 'incoming';
      if (body.friendship === 'friends') Object.assign(body, presence.of(u.id));
    }
    return { body };
  }

  async function getUserExperiences(c) {
    const u = await userByParam(c);
    const mine = c.user?.id === u.id;
    const limit = intParam(c.query, 'limit', 1, 50, 50);
    const offset = intParam(c.query, 'offset', 0, 100_000, 0);
    const { items, hasMore } = await store.listExperiences({ sort: mine ? 'updated' : 'new', ownerId: u.id, includeUnpublished: mine, limit, offset });
    return { body: { user: publicUser(u), experiences: await summaries(c, items), offset, nextOffset: hasMore ? offset + limit : null } };
  }

  // ------------------------------------------------------------- reports
  async function report(c) {
    const b = c.body;
    const kind = str(b.kind);
    if (!REPORT_KINDS.includes(kind)) throw fail('invalid', { field: 'kind' });
    const targetId = cleanString(b.targetId, 80);
    if (!targetId) throw fail('invalid', { field: 'targetId' });
    const reason = cleanString(b.reason, 200);
    if (!reason) throw fail('invalid', { field: 'reason' });
    const r = {
      id: newId('r', 12),
      kind,
      targetId,
      reason,
      details: cleanString(b.details, 1000, { multiline: true }),
      context: cleanString(b.context, 500, { multiline: true }),
      reporterId: c.user?.id ?? null,
      reporterIp: c.ip,
      status: 'open',
      createdAt: c.now,
    };
    await store.addReport(r);
    log.info('platform report received', { id: r.id, kind, targetId, reason, by: r.reporterId || 'guest' });
    return { status: 201, body: { ok: true, id: r.id } };
  }

  const status = async (c) => ({
    body: { ok: true, service: 'o-universe-platform', api: 1, store: store.kind, time: c.now, user: c.user ? privateUser(c.user, c.now) : null },
  });

  // ------------------------------------------------------------- route table
  // auth: 'required' | 'optional' (default optional) · body: 'required' | 'optional' | 'none' (GET/DELETE)
  // limit: max body bytes · rate: limiter buckets (ip-keyed: auth/register; others per user, else per IP)
  const routes = [
    ['GET', '/api/status', status],
    ['POST', '/api/auth/register', register, { rate: ['auth'] }],
    ['POST', '/api/auth/login', login, { rate: ['auth'] }],
    ['POST', '/api/auth/logout', logout, { auth: 'required', body: 'optional' }],
    ['GET', '/api/me', me, { auth: 'required' }],
    ['GET', '/api/friends', listFriends, { auth: 'required' }],
    ['POST', '/api/friends/request', requestFriend, { auth: 'required', rate: ['friends'] }],
    ['POST', '/api/friends/accept', acceptFriend, { auth: 'required' }],
    ['POST', '/api/friends/remove', removeFriend, { auth: 'required' }],
    ['GET', '/api/experiences', listExperiences],
    ['POST', '/api/experiences', createExperience, { auth: 'required', body: 'optional', limit: BIG_BODY, rate: ['create'] }],
    ['GET', '/api/experiences/:id', getExperience],
    ['PUT', '/api/experiences/:id', saveExperience, { auth: 'required', limit: BIG_BODY, rate: ['save'] }],
    ['DELETE', '/api/experiences/:id', deleteExperience, { auth: 'required' }],
    ['POST', '/api/experiences/:id/publish', publishExperience, { auth: 'required', body: 'optional', limit: BIG_BODY, rate: ['publish'] }],
    ['POST', '/api/experiences/:id/like', likeExperience, { auth: 'required', body: 'optional', rate: ['like'] }],
    ['POST', '/api/experiences/:id/play', playExperience, { body: 'optional', rate: ['play'] }],
    ['GET', '/api/experiences/:id/versions', listVersions],
    ['GET', '/api/experiences/:id/thumbnail', getThumbnail, { raw: true }],
    ['GET', '/api/users/:username', getUserProfile],
    ['GET', '/api/users/:username/experiences', getUserExperiences],
    ['POST', '/api/report', report, { rate: ['report'] }],
  ].map(([method, pattern, fn, opts = {}]) => ({
    method,
    pattern,
    segs: pattern.split('/').slice(1),
    fn,
    auth: opts.auth || 'optional',
    body: opts.body || (method === 'GET' || method === 'DELETE' ? 'none' : 'required'),
    limit: opts.limit || SMALL_BODY,
    rate: opts.rate || [],
    raw: !!opts.raw,
  }));

  /** Sweep the play de-duplication map. */
  function sweep(t = clock()) {
    for (const [k, at] of plays) if (t - at >= POLICY.PLAY_DEDUPE_MS) plays.delete(k);
  }

  return { routes, privateUser, publicUser, restrictionsOf, sweep };
}

export function rateLimited(retryAfter) {
  return fail('rate_limited', { headers: { 'Retry-After': String(retryAfter) }, details: { retryAfter } });
}

/** Match a path against the route table → { route, params } | { allow: [methods] } | null */
export function matchRoute(routes, method, path) {
  const segs = path.split('/').slice(1);
  if (segs.length && segs[segs.length - 1] === '') segs.pop(); // trailing slash
  const allow = [];
  for (const r of routes) {
    if (r.segs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const p = r.segs[i];
      if (p.startsWith(':')) {
        let v;
        try {
          v = decodeURIComponent(segs[i]);
        } catch {
          ok = false;
          break;
        }
        if (!v) {
          ok = false;
          break;
        }
        params[p.slice(1)] = v;
      } else if (p !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { route: r, params };
    allow.push(r.method);
  }
  return allow.length ? { allow } : null;
}
