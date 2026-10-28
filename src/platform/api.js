/**
 * HTTP client for the platform API (PLATFORM.md §10): JSON under `/api`,
 * auth = `Authorization: Bearer <token>`.
 *
 *   const api = createApiClient({ base, getToken, onAuthLost, fetchImpl })
 *   await api.request('/me')                         → parsed JSON
 *   await api.request('/auth/login', { method: 'POST', body: { username, password } })
 *
 * Failures throw a PlatformError { code, status, message (bilingual, resolved), data }.
 * code 'offline' = the API is not reachable (network error, timeout, or the
 * answer is not our JSON API — e.g. a static server / the Vite dev server
 * without the /api mount). Every other code comes from the server.
 *
 * Also: resolveApiBase(params) (?api=<url>, else derived from ?server=<ws url>,
 * else same origin), and the response normalizers used by the client
 * (normUser, normExperience, normFriends) that accept the shapes the server
 * may send ({ user } or the user itself, arrays or { experiences: [] } …).
 */
import { t } from '../core/i18n.js';

export class PlatformError extends Error {
  constructor(code, message = '', status = 0, data = null) {
    super(message || code);
    this.name = 'PlatformError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
  get offline() {
    return this.code === 'offline' || this.code === 'timeout';
  }
}

// ------------------------------------------------------------------ messages
/** Friendly bilingual text for server / client error codes (fuzzy match on the code). */
const MESSAGES = [
  [/^offline$/, { en: "Can't reach the Ø Universe servers right now.", nl: 'De Ø Universe-servers zijn nu niet bereikbaar.' }],
  [/timeout/, { en: 'The server took too long to answer. Please try again.', nl: 'De server reageerde te traag. Probeer het opnieuw.' }],
  [/credential|wrong_password|bad_login|invalid_login|login_failed/, { en: 'Wrong username or password.', nl: 'Onjuiste gebruikersnaam of wachtwoord.' }],
  [/taken|exists|duplicate/, { en: 'That username is already taken.', nl: 'Die gebruikersnaam is al in gebruik.' }],
  [/filter|inappropriate|blocked_name|offensive|profan/, { en: 'Please choose a different name — that one is not allowed.', nl: 'Kies een andere naam — deze is niet toegestaan.' }],
  [/username/, { en: 'Usernames are 3–20 characters: a–z, 0–9 and _.', nl: 'Gebruikersnamen zijn 3–20 tekens: a–z, 0–9 en _.' }],
  [/password/, { en: 'Use a password of at least 8 characters.', nl: 'Gebruik een wachtwoord van minstens 8 tekens.' }],
  [/birth|age/, { en: 'Please enter a valid birth year.', nl: 'Vul een geldig geboortejaar in.' }],
  [/rate|too_many|slow_down|429/, { en: 'Slow down a little — try again in a minute.', nl: 'Even rustig aan — probeer het over een minuut opnieuw.' }],
  [/already_friends/, { en: "You're already friends.", nl: 'Jullie zijn al vrienden.' }],
  [/already|pending|request_exists/, { en: 'A friend request is already pending.', nl: 'Er staat al een vriendschapsverzoek open.' }],
  [/self|yourself/, { en: "You can't add yourself.", nl: 'Je kunt jezelf niet toevoegen.' }],
  [/restrict|under_?13|not_allowed|friends_disabled|forbidden|403/, { en: 'This is limited on this account for safety.', nl: 'Dit is voor de veiligheid beperkt op dit account.' }],
  [/user_not_found|no_user|unknown_user/, { en: 'No player with that username.', nl: 'Geen speler met die gebruikersnaam.' }],
  [/not_found|404/, { en: "We couldn't find that.", nl: 'Dat konden we niet vinden.' }],
  [/unauthori[sz]ed|auth|401|session/, { en: 'Please sign in first.', nl: 'Log eerst in.' }],
  [/too_large|limit|413/, { en: 'That is too large.', nl: 'Dat is te groot.' }],
];

export function errorText(err) {
  if (!err) return '';
  const code = String(err.code || err.message || '').toLowerCase();
  // the platform server sends every error in both languages: { error: { code, message (en), nl } }
  const e = err.data?.error && typeof err.data.error === 'object' ? err.data.error : null;
  if (e && typeof e.message === 'string' && e.message && !/^(offline|timeout|aborted)$/.test(code)) {
    return t({ en: e.message.slice(0, 200), nl: (typeof e.nl === 'string' && e.nl ? e.nl : e.message).slice(0, 200) });
  }
  for (const [re, text] of MESSAGES) if (re.test(code)) return t(text);
  // an unknown code: its own message (often English only) or a generic line
  if (err.data?.message && typeof err.data.message === 'string') return err.data.message.slice(0, 160);
  return t({ en: 'Something went wrong ({code}). Please try again.', nl: 'Er ging iets mis ({code}). Probeer het opnieuw.' }, { code: code || '?' });
}

// ---------------------------------------------------------------------- base
/** API origin ('' = same origin). ?api=<http url> wins; ?server=ws(s)://host/ws maps to http(s)://host. */
export function resolveApiBase(params = {}) {
  const clean = (u) => String(u).replace(/\/+$/, '').replace(/\/api$/, '');
  try {
    if (typeof params.api === 'string' && /^https?:\/\//.test(params.api)) return clean(params.api);
    if (typeof params.server === 'string' && /^wss?:\/\//.test(params.server)) {
      const u = new URL(params.server);
      return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
    }
  } catch {
    /* fall through */
  }
  return '';
}

// -------------------------------------------------------------------- client
export function createApiClient({ base = '', getToken = () => null, onAuthLost = null, fetchImpl = null, timeout = 9000 } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  async function request(path, { method = 'GET', body, auth = true, signal = null, timeout: tmo = timeout, query = null } = {}) {
    let p = String(path || '/');
    if (!p.startsWith('/')) p = `/${p}`;
    if (!p.startsWith('/api/') && p !== '/api') p = `/api${p}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v != null && v !== '') qs.set(k, String(v));
      const s = qs.toString();
      if (s) p += (p.includes('?') ? '&' : '?') + s;
    }
    // '*/*' (low priority) makes static hosts / the Vite dev server answer their HTML fallback (200 →
    // detected as "no API here") instead of a 404 that the browser would log as a console error
    const headers = { Accept: 'application/json, */*;q=0.1' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = auth ? getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, tmo);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    let res;
    try {
      res = await doFetch(base + p, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
        credentials: base ? 'omit' : 'same-origin',
      });
    } catch (err) {
      if (signal?.aborted) throw new PlatformError('aborted', 'aborted');
      throw new PlatformError(timedOut ? 'timeout' : 'offline', t({ en: 'offline', nl: 'offline' }), 0, { cause: String(err?.message || err) });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }

    const type = (res.headers?.get?.('content-type') || '').toLowerCase();
    let data = null;
    if (type.includes('json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }
    if (data == null || typeof data !== 'object') {
      // 204 / empty success from our API
      if (res.ok && (res.status === 204 || (!type.includes('html') && !type))) return {};
      // anything else (HTML fallback page, proxy error, 404 from a static server) = no API here
      throw new PlatformError('offline', 'no api', res.status);
    }
    if (!res.ok || data.ok === false) {
      const raw = data.error?.code ?? data.code ?? data.error ?? data.reason ?? `http_${res.status}`;
      const code = typeof raw === 'string' ? raw : `http_${res.status}`;
      const msg = typeof data.error?.message === 'string' ? data.error.message : typeof data.message === 'string' ? data.message : code;
      const err = new PlatformError(code, msg, res.status, data);
      err.field = data.error?.field || null;
      if (res.status === 401 && token && auth) {
        try {
          onAuthLost?.(err, p);
        } catch {
          /* ignore */
        }
      }
      throw err;
    }
    return data;
  }

  return { request, base };
}

// --------------------------------------------------------------- normalizers
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v, max = 400) => (v == null ? '' : String(v).slice(0, max));
const time = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v; // seconds → ms
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
};

/** Only images we can show without loading third-party URLs: data:image/* or same-origin /api/… paths. */
export function safeImage(src) {
  if (typeof src !== 'string' || !src) return null;
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(src) && src.length < 600000) return src;
  if (/^\/api\/[\w\-/.?=&%]+$/.test(src)) return src;
  return null;
}

export function birthYearAge(birthYear, now = new Date()) {
  const y = Number(birthYear);
  if (!Number.isFinite(y) || y < 1900) return null;
  return now.getFullYear() - y; // the age reached this calendar year (conservative for the gate)
}

/** { id, username, displayName, birthYear, under13, restricted:{chat, friends}, createdAt } */
export function normUser(raw) {
  const u = raw && typeof raw === 'object' && raw.user && typeof raw.user === 'object' ? raw.user : raw;
  if (!u || typeof u !== 'object') return null;
  const username = str(u.username ?? u.name ?? u.handle, 40);
  if (!username && u.id == null) return null;
  const age = u.age != null ? num(u.age) : birthYearAge(u.birthYear);
  const r = u.restrictions || u.restricted || u.limits || {};
  // server: ageGroup 'under13' | '13plus' (conservative: this year − birthYear ≤ 13 counts as under 13)
  const group = typeof u.ageGroup === 'string' ? u.ageGroup : null;
  const under13 = !!(u.under13 ?? u.isUnder13 ?? u.child ?? (group ? group === 'under13' : age != null ? age <= 13 : false));
  const restrictedFlag = typeof u.restricted === 'boolean' ? u.restricted : null;
  return {
    id: u.id != null ? String(u.id) : username,
    username,
    displayName: str(u.displayName ?? u.display ?? username, 40) || username,
    birthYear: u.birthYear != null ? num(u.birthYear) : null,
    under13,
    restricted: {
      chat: !!(r.chat ?? restrictedFlag ?? under13),
      friends: !!(r.friends ?? restrictedFlag ?? under13),
    },
    guestLinked: !!u.guestLinked,
    createdAt: time(u.createdAt ?? u.created),
    credits: u.credits != null ? num(u.credits) : null,
  };
}

/** Experience meta (+ optional published data) in one flat shape. */
export function normExperience(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw.experience && typeof raw.experience === 'object' && !raw.id ? raw.experience : raw;
  const meta = (x.meta && typeof x.meta === 'object' ? x.meta : null) || {};
  const id = x.id ?? x._id ?? x.slug;
  if (id == null) return null;
  const creatorObj = typeof x.creator === 'object' && x.creator ? x.creator : typeof x.owner === 'object' && x.owner ? x.owner : null;
  const creator = str(creatorObj?.username ?? creatorObj?.name ?? (typeof x.creator === 'string' ? x.creator : null) ?? x.creatorName ?? x.ownerName ?? x.ownerUsername ?? x.username ?? x.author ?? '', 40);
  const ver = x.version && typeof x.version === 'object' ? x.version : x.latestVersion && typeof x.latestVersion === 'object' ? x.latestVersion : x.published && typeof x.published === 'object' ? x.published : null;
  const data = (x.data && typeof x.data === 'object' ? x.data : null) || (ver?.data && typeof ver.data === 'object' ? ver.data : null) || (ver?.experience && typeof ver.experience === 'object' ? ver.experience : null) || (ver && Array.isArray(ver.parts) ? ver : null);
  const publishedAt = time(x.publishedAt ?? ver?.publishedAt ?? ver?.createdAt);
  // the flagship carries both languages: i18n.title / i18n.description { en, nl }
  const tr = (pair) => (pair && typeof pair === 'object' && typeof pair.en === 'string' ? t(pair) : null);
  const versionNumber = num(typeof x.version === 'number' ? x.version : ver?.v ?? ver?.version ?? x.versionNumber ?? x.publishedVersion) || null;
  return {
    id: String(id),
    title: str(tr(x.i18n?.title) ?? x.title ?? x.name ?? meta.title ?? data?.meta?.title, 80) || t({ en: 'Untitled experience', nl: 'Naamloze ervaring' }),
    description: str(tr(x.i18n?.description) ?? x.description ?? meta.description ?? data?.meta?.description, 1200),
    creator,
    creatorId: x.creatorId ?? x.ownerId ?? creatorObj?.id ?? null,
    likes: num(x.likes ?? x.likeCount ?? x.stats?.likes),
    plays: num(x.plays ?? x.playCount ?? x.visits ?? x.stats?.plays),
    playing: num(x.playing ?? x.online ?? x.stats?.playing),
    liked: !!(x.liked ?? x.youLiked ?? x.likedByMe ?? x.me?.liked),
    thumbnail: safeImage(x.thumbnail ?? x.thumb ?? x.thumbnailUrl ?? meta.thumbnail ?? ver?.thumbnail),
    published: typeof x.published === 'boolean' ? x.published : !!(publishedAt || ver || versionNumber || x.versionCount),
    publishedAt,
    updatedAt: time(x.updatedAt ?? x.updated ?? x.savedAt ?? x.draftSavedAt) || publishedAt,
    createdAt: time(x.createdAt ?? x.created),
    maxPlayers: num(x.maxPlayers ?? meta.maxPlayers ?? data?.meta?.maxPlayers) || null,
    versionNumber,
    partCount: num(x.partCount ?? ver?.partCount ?? (Array.isArray(data?.parts) ? data.parts.length : x.parts)) || 0,
    multiplayer: !!x.multiplayer,
    official: !!(x.official || x.builtin),
    tags: Array.isArray(x.tags) ? x.tags.filter((s) => typeof s === 'string').slice(0, 6) : [],
    data: data || null,
    sky: data?.settings?.sky || x.sky || null,
    local: !!x.local,
    localId: x.localId != null ? String(x.localId) : x.local ? String(id) : null,
    cloudId: x.cloudId != null ? String(x.cloudId) : null,
    flagship: String(id) === 'o-universe',
  };
}

export function normExperienceList(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.experiences) ? raw.experiences : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.results) ? raw.results : [];
  return list.map(normExperience).filter(Boolean);
}

/** → { friends: [], incoming: [], outgoing: [] } of { id, userId, username, displayName, online, status, activity } */
export function normFriends(raw) {
  const out = { friends: [], incoming: [], outgoing: [] };
  const person = (f, fallbackStatus) => {
    if (!f || typeof f !== 'object') return null;
    const u = (f.user && typeof f.user === 'object' ? f.user : null) || (f.friend && typeof f.friend === 'object' ? f.friend : null) || (f.from && typeof f.from === 'object' && fallbackStatus === 'incoming' ? f.from : null) || (f.to && typeof f.to === 'object' && fallbackStatus === 'outgoing' ? f.to : null) || f;
    const username = str(u.username ?? u.name ?? f.username, 40);
    if (!username) return null;
    const presence = f.presence ?? u.presence ?? f.status ?? u.status;
    const presenceStr = String((typeof presence === 'string' ? presence : presence?.status) || '').toLowerCase();
    const online = !!(f.online ?? u.online ?? (presenceStr ? !/offline|accepted|pending|incoming|outgoing/.test(presenceStr) : false));
    // server presence: 'in-game' (+ experienceId; 'o-universe' = the SMP world) | 'online' | 'offline'
    const status = !online ? 'offline' : /in-?game|playing/.test(presenceStr) || f.experienceId ? 'in-game' : 'online';
    return {
      id: String(f.requestId ?? f.id ?? u.id ?? username),
      userId: String(u.id ?? f.userId ?? username),
      username,
      displayName: str(u.displayName ?? username, 40) || username,
      online,
      status,
      experienceId: status === 'in-game' ? str(f.experienceId ?? presence?.experienceId ?? '', 60) || null : null,
      activity: str(f.activity ?? u.activity ?? presence?.activity ?? presence?.where ?? '', 60),
      since: time(f.since ?? f.at ?? f.createdAt),
    };
  };
  const add = (arr, kind) => {
    if (!Array.isArray(arr)) return;
    for (const f of arr) {
      const p = person(f, kind);
      if (p) out[kind].push(p);
    }
  };
  if (Array.isArray(raw)) {
    for (const f of raw) {
      const st = String(f?.state ?? f?.status ?? '').toLowerCase();
      const dir = String(f?.direction ?? f?.dir ?? '').toLowerCase();
      if (st === 'pending' || st === 'incoming' || st === 'outgoing' || f?.pending) {
        const kind = st === 'incoming' || dir === 'in' || dir === 'incoming' || f?.incoming ? 'incoming' : 'outgoing';
        add([f], kind);
      } else add([f], 'friends');
    }
  } else if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.friends) && raw.friends.some((f) => f && (f.state || f.direction))) return normFriends(raw.friends);
    add(raw.friends ?? raw.accepted, 'friends');
    add(raw.incoming ?? raw.requests ?? raw.received ?? raw.pending?.incoming, 'incoming');
    add(raw.outgoing ?? raw.sent ?? raw.pending?.outgoing, 'outgoing');
  }
  const rank = { 'in-game': 0, online: 1, offline: 2 };
  out.friends.sort((a, b) => rank[a.status] - rank[b.status] || a.username.localeCompare(b.username));
  return out;
}
