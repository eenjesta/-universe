/**
 * Ø Universe platform server v1 — accounts, friends, experiences, reports
 * (PLATFORM.md §10). Plain Node (http + crypto); JSON files or Postgres.
 *
 * ── Mount (server/index.js) ───────────────────────────────────────────────────
 *   import { createPlatform } from './platform/index.js';
 *   const platform = createPlatform({ dataDir: cfg.dataDir, databaseUrl: cfg.databaseUrl, log,
 *     allowedOrigins: cfg.allowedOrigins, allowLocalOrigins: cfg.local, trustProxy: cfg.trustProxy });
 *   http.createServer((req, res) => { if (platform.handle(req, res)) return; staticHandler(req, res); });
 *   // WebSocket hello:  const account = await platform.resolveToken(msg.token)   // null for guest tokens
 *   // join / leave:     platform.setPresence(account.id, 'in-game') · platform.setPresence(account.id, 'offline')
 *   // shutdown:         await platform.close()
 *
 * ── createPlatform(opts) → platform ────────────────────────────────────────────
 *   opts: dataDir (JSON store in <dataDir>/platform/) · databaseUrl (Postgres; wins) · log ({debug,info,warn,error}
 *         or fn(level,msg,fields)) · allowedOrigins (['https://x.y']; default env ALLOWED_ORIGINS) · allowLocalOrigins
 *         (loopback origins; default in --local mode) · trustProxy (true | hop count: client IP from X-Forwarded-For;
 *         default env TRUST_PROXY=1, else on unless --local / LOCAL=1 — same as server/config.js) · tablePrefix (Postgres)
 *         test hooks: store (uninitialised store object), pgPool, limits ({bucket: {burst, perSec}}), scrypt ({N,r,p}),
 *         now (() => ms), sweepMs
 *   platform.handle(req, res) → boolean    true when the path is /api or /api/… (answered asynchronously)
 *   platform.resolveToken(token) → Promise<user | null>   for `ous_…` session tokens:
 *         { id, username, displayName, createdAt, birthYear, ageGroup: 'under13'|'13plus',
 *           restrictions: { chat: bool, friends: bool }, guestLinked, guestTokenHash: sha256hex | null }
 *         guestTokenHash = sha256 hex of the guest token given at register → the game server's
 *         `getPlayerByToken(hash)` finds the guest save to carry over to the account.
 *   platform.setPresence(id, status, { experienceId }?)   status 'in-game' (default experience 'o-universe') |
 *         'online' | 'offline' (also true/false). Friends lists show it; `playing` counts in listings use it,
 *         so guests may be reported too (any string id, e.g. 'guest:p12').
 *   platform.ready → Promise (store initialised; the store retries in the background on failure)
 *   platform.store · platform.close() → Promise (flushes the JSON store / ends the pg pool)
 *
 * ── HTTP API (JSON; auth = `Authorization: Bearer <token>`) ──────────────────
 *   POST /api/auth/register {username, password, birthYear, guestToken?} → 201 {token, user}
 *   POST /api/auth/login {username, password} → {token, user}       POST /api/auth/logout → {ok}
 *   GET  /api/me → {user}                                            GET /api/status → {ok, store, user|null}
 *   GET  /api/friends → {friends:[{id, username, displayName, status:'in-game'|'online'|'offline', experienceId,
 *        since}], incoming:[{id, username, at}], outgoing:[…], online, restricted}
 *   POST /api/friends/request {username} → 201 {status:'pending', friend} | {status:'accepted', friend} (mutual)
 *   POST /api/friends/accept {id | username} → {status:'accepted', friend}
 *   POST /api/friends/remove {id | username} → {removed, id}  (unfriend, cancel or decline)
 *   GET  /api/experiences?sort=popular|new&q=&limit=24&offset=0 → {experiences:[summary], nextOffset|null}
 *        ('o-universe' first on the first page; popular = plays + 10 × likes)
 *   GET  /api/experiences/:id[?v=N][&data=0][&draft=1 (owner)] → {experience: summary, version: {v, createdAt,
 *        size, partCount, data} | null, draft?}
 *   POST /api/experiences {title?, description?, data?, thumbnail?} → 201 {experience, draft, filtered}
 *   PUT  /api/experiences/:id {data?, title?, description?, thumbnail?} (or the document itself) →
 *        {experience, draft:{savedAt, size, partCount}, filtered, data? (when text was filtered)}
 *   POST /api/experiences/:id/publish {data?, …same as PUT} → {experience, version:{v, createdAt, size, partCount}}
 *   POST /api/experiences/:id/like {like?: false} → {liked, likes}  POST /api/experiences/:id/play → {plays, counted}
 *   DELETE /api/experiences/:id → {deleted}                       GET /api/experiences/:id/versions → {versions}
 *   GET  /api/experiences/:id/thumbnail → image (summary.thumbnail is this URL, usable as <img src>)
 *   GET  /api/users/:username → {user, friendship?, status?}     GET /api/users/:username/experiences → {user, experiences}
 *   POST /api/report {kind:'user'|'experience'|'chat'|'player'|'other', targetId, reason, details?, context?} → 201 {ok, id}
 *   summary = {id, kind:'smp'|'experience', builtin, multiplayer, title, description, creator:{id, username,
 *        displayName}, maxPlayers, playing, plays, likes, liked?, version, published, partCount, size,
 *        thumbnail|null, createdAt, updatedAt, publishedAt, draftSavedAt? (owner), i18n? + tags? (flagship)}
 *   Errors: {error:{code, message (en), nl, field?, details?}} — codes in errors.js (401 unauthorized, 403
 *        forbidden/restricted/origin/limit, 404 not_found, 409 name_taken…, 413 too_large, 429 rate_limited
 *        + Retry-After). Bodies: JSON only, 16 kB (2 MB + thumbnail for experience saves).
 *   Language: ?lang=nl or Accept-Language → the flagship's description; errors always carry en + nl.
 *
 * Safety defaults: usernames 3–20 [a-z0-9_] filtered (bilingual list, leetspeak, reserved staff names);
 * titles/descriptions/text parts masked (+ e-mail/URL/phone); under-13 (conservative from birth year) →
 * restrictions {chat: true, friends: true}: no friend requests to or from them, the game server should
 * restrict their chat. Passwords: scrypt (N=16384, r=8, p=1, 16-byte salt); sessions: 32 random bytes,
 * stored as sha256, 30 days sliding. Rate limits per IP and per user (ratelimit.js). Same-origin by default.
 */
import { createStore } from './store/index.js';
import { createLimiter, DEFAULT_LIMITS } from './ratelimit.js';
import { createApi, matchRoute, rateLimited, POLICY } from './api.js';
import { fail, ApiError } from './errors.js';
import { sendJson, sendError, readJson, clientIp, checkOrigin, corsHeaders, bearer } from './http.js';
import { isSessionToken, hashToken, DEFAULT_SCRYPT } from './crypto.js';
import { flagshipSeed, FLAGSHIP_ID } from './flagship.js';

export { FLAGSHIP_ID } from './flagship.js';
export { filterText, hasBadWords, checkUsername } from './filter.js';
export { isSessionToken, hashToken } from './crypto.js';

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function normalizeLog(log) {
  const noop = () => {};
  if (typeof log === 'function') {
    return { debug: (m, f) => log('debug', m, f), info: (m, f) => log('info', m, f), warn: (m, f) => log('warn', m, f), error: (m, f) => log('error', m, f) };
  }
  if (log && typeof log === 'object') {
    const l = typeof log.child === 'function' ? log.child({ mod: 'platform' }) : log;
    const b = (k) => (typeof l[k] === 'function' ? l[k].bind(l) : noop);
    return { debug: b('debug'), info: b('info'), warn: b('warn'), error: b('error') };
  }
  const min = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 20;
  const out = (lvl) => (m, f) => {
    if (LOG_LEVELS[lvl] < min) return;
    const extra = f ? ' ' + JSON.stringify(f, (k, v) => (v instanceof Error ? { message: v.message, code: v.code } : v)) : '';
    (lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log)(`[platform] ${lvl} ${m}${extra}`);
  };
  return { debug: out('debug'), info: out('info'), warn: out('warn'), error: out('error') };
}

/** Online status per id: game-server presence (setPresence), soft "playing" marks and API activity. */
function createPresence(clock) {
  const entries = new Map(); // id → { status, experienceId, until (0 = until changed) }
  const seen = new Map(); // userId → last API request (ms)
  let counts = null;
  let countsAt = 0;
  return {
    set(id, status, { experienceId = null, until = 0, soft = false } = {}) {
      if (id === null || id === undefined || id === '') return;
      const key = String(id);
      if (status === true) status = 'in-game';
      if (!status || status === 'offline') {
        entries.delete(key);
        counts = null;
        return;
      }
      if (status !== 'online' && status !== 'in-game') return;
      const cur = entries.get(key);
      if (soft && cur && !cur.until) return; // the game server's presence wins over "playing" marks
      entries.set(key, { status, experienceId: experienceId ?? (status === 'in-game' ? FLAGSHIP_ID : null), until });
      counts = null;
    },
    seen(id, t) {
      seen.set(id, t);
    },
    of(id) {
      const t = clock();
      const e = entries.get(id);
      if (e && (!e.until || e.until > t)) return { status: e.status, experienceId: e.experienceId ?? null };
      const s = seen.get(id);
      if (s !== undefined && t - s < POLICY.ONLINE_WINDOW_MS) return { status: 'online', experienceId: null };
      return { status: 'offline', experienceId: null };
    },
    count(experienceId) {
      const t = clock();
      if (!counts || t - countsAt > 2000) {
        counts = new Map();
        countsAt = t;
        for (const e of entries.values()) {
          if (e.status === 'in-game' && e.experienceId && (!e.until || e.until > t)) counts.set(e.experienceId, (counts.get(e.experienceId) || 0) + 1);
        }
      }
      return counts.get(experienceId) || 0;
    },
    sweep(t) {
      for (const [k, e] of entries) if (e.until && e.until <= t) entries.delete(k);
      for (const [k, s] of seen) if (t - s >= POLICY.ONLINE_WINDOW_MS) seen.delete(k);
      counts = null;
    },
    get size() {
      return entries.size;
    },
  };
}

const sleep = (ms) =>
  new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });

export function createPlatform(opts = {}) {
  const log = normalizeLog(opts.log);
  const clock = opts.now || Date.now;
  const limits = { ...DEFAULT_LIMITS };
  for (const [k, v] of Object.entries(opts.limits || {})) limits[k] = { ...(limits[k] || {}), ...v };
  const limiter = createLimiter({ now: clock, sweepMs: opts.sweepMs ?? 60_000 });
  const presence = createPresence(clock);
  // Defaults follow server/config.js when the mount doesn't pass them: TRUST_PROXY (default on unless
  // --local / LOCAL=1, so per-IP limits see real clients behind Railway's proxy), ALLOWED_ORIGINS,
  // loopback origins allowed in local mode.
  const env = opts.env || process.env;
  const local = opts.local ?? (process.argv.includes('--local') || env.LOCAL === '1');
  const allowedOrigins = (opts.allowedOrigins ?? String(env.ALLOWED_ORIGINS || '').split(','))
    .map((s) => String(s).trim().replace(/\/$/, '').toLowerCase())
    .filter(Boolean);
  const allowLocal = opts.allowLocalOrigins ?? local;
  const trustProxy = opts.trustProxy ?? (env.TRUST_PROXY != null ? env.TRUST_PROXY === '1' : !local);

  let store = null;
  let api = null;
  let state = 'init'; // init | ready | failed | closed
  let attempts = 0;
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  async function initOnce() {
    attempts++;
    const s = opts.store ? opts.store : await createStore({ dataDir: opts.dataDir, databaseUrl: opts.databaseUrl, log, pgPool: opts.pgPool, tablePrefix: opts.tablePrefix, flushMs: opts.flushMs });
    if (opts.store) await s.init();
    await s.ensureExperience(flagshipSeed(clock()));
    return s;
  }

  (async () => {
    let delay = 2000;
    while (state !== 'closed') {
      try {
        const s = await initOnce();
        if (state === 'closed') {
          await s.close?.();
          return;
        }
        store = s;
        api = createApi({ store, limiter, limits, log, presence, scryptCost: opts.scrypt || DEFAULT_SCRYPT, now: clock });
        state = 'ready';
        resolveReady(true);
        log.info('platform ready', { store: store.kind });
        return;
      } catch (err) {
        if (state === 'closed') return;
        state = 'failed';
        log.error('platform store init failed, retrying', { err, attempt: attempts, retryInMs: delay });
        await sleep(delay);
        delay = Math.min(60_000, delay * 2);
      }
    }
  })();

  // housekeeping: buckets (limiter), presence, play de-dupe, expired sessions
  let lastPrune = 0;
  function housekeeping() {
    const t = clock();
    presence.sweep(t);
    api?.sweep(t);
    if (store && t - lastPrune > 3600_000) {
      lastPrune = t;
      return store.pruneSessions(t).catch((err) => log.warn('platform session prune failed', { err }));
    }
  }
  const sweepMs = opts.sweepMs ?? 60_000;
  const timer = sweepMs > 0 ? setInterval(housekeeping, sweepMs) : null; // sweepMs 0 → manual (tests)
  timer?.unref?.();

  async function awaitReady(ms) {
    if (state === 'ready') return true;
    if (state === 'closed' || (state === 'failed' && attempts > 0)) return false;
    await Promise.race([ready, sleep(ms)]);
    return state === 'ready';
  }

  async function resolveSession(token, t) {
    if (!isSessionToken(token)) return null;
    const hash = hashToken(token);
    const s = await store.getSession(hash);
    if (!s) return null;
    if (s.expiresAt <= t) {
      await store.deleteSession(hash);
      return null;
    }
    const user = await store.getUser(s.userId);
    if (!user) {
      await store.deleteSession(hash);
      return null;
    }
    if (t - s.lastUsedAt >= POLICY.SESSION_TOUCH_MS) await store.touchSession(hash, t, t + POLICY.SESSION_TTL_MS);
    return { user, session: s, hash };
  }

  const langOf = (req, url) => {
    const q = url.searchParams.get('lang');
    if (q === 'nl' || q === 'en') return q;
    return /^\s*nl\b/i.test(String(req.headers['accept-language'] || '')) ? 'nl' : 'en';
  };

  async function processRequest(req, res) {
    const t0 = clock();
    let url;
    try {
      url = new URL(req.url, 'http://platform.local');
    } catch {
      throw fail('bad_request');
    }
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'HEAD') res.__head = true;
    const origin = checkOrigin(req, { allowedOrigins, allowLocal, trustProxy });
    if (!origin.ok) throw fail('origin');
    if (origin.cors) res.__corsHeaders = corsHeaders(origin.origin);
    if (method === 'OPTIONS') {
      res.writeHead(204, { ...(res.__corsHeaders || {}), 'Content-Length': 0 });
      res.end();
      return;
    }
    const ip = clientIp(req, trustProxy);
    const ipr = limiter.take(`ip:${ip}`, limits.ip);
    if (!ipr.ok) throw rateLimited(ipr.retryAfter);
    if (!(await awaitReady(8000))) throw fail('unavailable', { headers: { 'Retry-After': '5' } });

    const m = matchRoute(api.routes, method, url.pathname);
    if (!m) throw fail('not_found');
    if (m.allow) throw fail('method_not_allowed', { headers: { Allow: [...new Set(m.allow)].join(', ') } });
    const route = m.route;

    const t = clock();
    const token = bearer(req);
    const auth = token ? await resolveSession(token, t) : null;
    if (route.auth === 'required' && !auth) throw fail('unauthorized');
    if (auth) presence.seen(auth.user.id, t);

    const who = auth ? `u:${auth.user.id}` : `ip:${ip}`;
    for (const b of route.rate) {
      const key = b === 'auth' || b === 'register' ? `${b}:${ip}` : `${b}:${who}`;
      const r = limiter.take(key, limits[b]);
      if (!r.ok) throw rateLimited(r.retryAfter);
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const r = limiter.take(`write:${who}`, limits.write);
      if (!r.ok) throw rateLimited(r.retryAfter);
    }

    const body = route.body === 'none' ? null : await readJson(req, route.limit, { optional: route.body === 'optional' });
    const c = { req, res, method, path: url.pathname, params: m.params, query: url.searchParams, ip, lang: langOf(req, url), user: auth?.user ?? null, auth, body, now: t };
    const out = await route.fn(c);
    if (!route.raw) sendJson(res, out.status || 200, out.body, out.headers);
    log.debug('api', { method, path: url.pathname, status: out?.status || 200, ms: clock() - t0 });
  }

  function handle(req, res) {
    const u = req.url || '';
    if (!(u === '/api' || u.startsWith('/api/') || u.startsWith('/api?'))) return false;
    processRequest(req, res).catch((err) => {
      if (err?.aborted || res.destroyed) return;
      if (!(err instanceof ApiError)) log.error('platform request failed', { method: req.method, url: u.split('?')[0], err });
      sendError(res, err);
    });
    return true;
  }

  async function resolveToken(token) {
    if (!isSessionToken(token)) return null;
    if (!(await awaitReady(5000))) return null;
    try {
      const a = await resolveSession(token, clock());
      if (!a) return null;
      return { ...api.privateUser(a.user, clock()), guestTokenHash: a.user.guestTokenHash ?? null };
    } catch (err) {
      log.warn('platform resolveToken failed', { err });
      return null;
    }
  }

  function setPresence(id, status, extra = {}) {
    if (status && typeof status === 'object') presence.set(id, status.status, { experienceId: status.experienceId ?? null });
    else presence.set(id, status, { experienceId: extra?.experienceId ?? null });
  }

  async function close() {
    const wasReady = state === 'ready';
    state = 'closed';
    if (timer) clearInterval(timer);
    limiter.close();
    if (wasReady && store) await store.close();
  }

  return {
    handle,
    resolveToken,
    setPresence,
    close,
    ready,
    get store() {
      return store;
    },
    get state() {
      return state;
    },
    /** For the game server / tests: current presence of an id. */
    presenceOf: (id) => presence.of(id),
    /** Run the periodic housekeeping now (expired presence / sessions, rate-limit buckets). */
    sweep: async () => {
      limiter.sweep();
      await housekeeping();
    },
    limits,
  };
}

export default createPlatform;
