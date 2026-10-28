/**
 * Platform layer v1 (PLATFORM.md §10) — accounts, friends, experiences and the
 * Roblox-like Home screen.
 *
 * install(ctx) → ctx.platform:
 *   available            true (the fallback says false: no Home, Play goes straight into the world)
 *   online               the /api answered (false = offline: Home still works, sign-in unavailable)
 *   user                 { id, username, displayName, birthYear, under13, restricted:{chat, friends} } | null
 *   token                account session token | null   (localStorage 'o-universe-account')
 *   guest                true while not signed in to an account
 *   login(username, password) → user           register({ username, password, birthYear }) → user
 *   logout()             refresh() → user|null (re-checks the session + reachability)
 *   api(path, opts)      fetch /api with the token: opts { method, body, query, auth, signal, timeout }
 *                        → JSON; throws PlatformError { code ('offline' when unreachable), status, data }
 *   friends              { list, incoming, outgoing, online, loaded, refresh(), request(username), accept(id), remove(id) }
 *   experiences          { list(sort, q), get(id), mine(), like(id), play(id), remove(id) }
 *   openHome({ tab })    shows Home (switches to the title mode first when needed; tab for the compact layout)
 *   closeHome({ toTitle })
 *   openExperience(id | experience) → fetches the published version and plays it (ctx.studio.play)
 *   showExperience(id | experience)  → the experience page
 *   report({ kind: 'experience'|'user', targetId, reason, details })
 *   errorText(err)       bilingual text for a PlatformError
 * Events: platform:ready {online, user}, platform:status {online}, platform:user {user, reason},
 *         platform:login {user, registered, linkedGuest}, platform:logout {reason, linkedGuest}, platform:friends,
 *         platform:home {open}.
 * URL: ?home (open Home at boot), ?mockapi (dev: in-page mock API), ?api=<http url> (API origin),
 *      ?offline (no network), ?nosave (session kept in memory only).
 *
 * Guest → account: register() sends the net layer's guest token (localStorage
 * 'o-universe-net-token' or ctx.net.token) as `guestToken` so the server links
 * the guest's game save to the new account.
 */
import './platform.css';
import { t } from '../core/i18n.js';
import { registerPlatformIcons } from './icons.js';
import { createApiClient, resolveApiBase, PlatformError, errorText, normUser, normExperience, normExperienceList, normFriends } from './api.js';
import { cleanUsername } from './validate.js';
import { createHome } from './home.js';
import { createDialogs } from './dialogs.js';

const ACCOUNT_KEY = 'o-universe-account';
const GUEST_TOKEN_KEY = 'o-universe-net-token';
const HOME_RETURN_KEY = 'o-universe-home-return';
export const FLAGSHIP_ID = 'o-universe';

export async function install(ctx, { progress = () => {} } = {}) {
  registerPlatformIcons();
  const { events, ui, params, modes } = ctx;
  const persist = !params.nosave;
  const noNetwork = !!params.offline || params.api === 'off' || params.api === '0';

  // ------------------------------------------------------------- storage
  const store = {
    get(key) {
      if (!persist) return null;
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      if (!persist) return;
      try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        /* storage full / blocked: the session still works for this visit */
      }
    },
  };
  let account = null; // { token, user, linkedGuest, at }
  try {
    const raw = JSON.parse(store.get(ACCOUNT_KEY) || 'null');
    if (raw && typeof raw.token === 'string' && raw.token) account = { token: raw.token, user: normUser(raw.user), linkedGuest: !!raw.linkedGuest, at: raw.at || 0 };
  } catch {
    account = null;
  }
  const saveAccount = () => store.set(ACCOUNT_KEY, account ? JSON.stringify(account) : null);

  // ----------------------------------------------------------------- api
  let online = false;
  let probed = false;
  let firstProbe = null;
  let fetchImpl = null;
  if (params.mockapi) {
    try {
      const { createMockFetch } = await import('./dev/mock.js');
      fetchImpl = createMockFetch({ persist });
    } catch (err) {
      console.warn('[platform] mock api failed to load', err);
    }
  }
  const client = createApiClient({
    base: fetchImpl ? '' : resolveApiBase(params),
    getToken: () => account?.token || null,
    onAuthLost: () => sessionExpired(),
    fetchImpl,
  });

  function setOnline(on) {
    on = !!on;
    const first = !probed;
    probed = true;
    // the first answer is news too (Home shows "checking…" skeletons until then, not "offline")
    if (on === online && !first) return;
    online = on;
    events.emit('platform:status', { online, first });
  }

  async function api(path, opts = {}) {
    if (noNetwork) throw new PlatformError('offline', 'offline');
    try {
      const data = await client.request(path, opts);
      setOnline(true);
      return data;
    } catch (err) {
      if (err.code === 'offline') setOnline(false);
      else if (err.status) setOnline(true); // a JSON error from our API: it is there
      throw err;
    }
  }

  // ------------------------------------------------------------- session
  function setAccount(next, reason) {
    account = next;
    saveAccount();
    events.emit('platform:user', { user: account?.user || null, reason });
  }

  function sessionExpired() {
    if (!account) return;
    setAccount(null, 'expired');
    friends.clear();
    events.emit('platform:logout', { reason: 'expired' });
    ui.toast({ title: t({ en: 'Signed out', nl: 'Uitgelogd' }), text: t({ en: 'Your session has expired — please sign in again.', nl: 'Je sessie is verlopen — log opnieuw in.' }), icon: 'user', kind: 'warn' });
  }

  function readGuestToken() {
    const fromNet = ctx.net?.token || ctx.net?.guestToken;
    if (typeof fromNet === 'string' && fromNet) return fromNet;
    try {
      return localStorage.getItem(GUEST_TOKEN_KEY) || null;
    } catch {
      return null;
    }
  }

  function acceptSession(data, reason, extra = {}) {
    const token = data?.token || data?.session?.token;
    const user = normUser(data?.user || data?.account || data);
    if (!token || !user) throw new PlatformError('bad_response', 'bad response');
    setAccount({ token, user, at: Date.now(), ...extra }, reason);
    events.emit('platform:login', { user, registered: reason === 'register', linkedGuest: !!extra.linkedGuest });
    friends.refresh().catch(() => {});
    return user;
  }

  /** login(username, password) → user. Without arguments it opens the sign-in dialog → user | null. */
  async function login(username, password) {
    if (username == null && password == null) return core.dialogs.auth('signin');
    const data = await api('/auth/login', { method: 'POST', body: { username: cleanUsername(username), password: String(password ?? '') }, auth: false });
    return acceptSession(data, 'login');
  }

  /** register({ username, password, birthYear }) → user. Without arguments it opens the create-account dialog. */
  async function register({ username, password, birthYear } = {}) {
    if (username == null && password == null) return core.dialogs.auth(core.hasGuestProgress() ? 'save' : 'register');
    const guestToken = readGuestToken();
    const body = { username: cleanUsername(username), password: String(password ?? ''), birthYear: Number(birthYear) };
    if (guestToken) body.guestToken = guestToken;
    const data = await api('/auth/register', { method: 'POST', body, auth: false });
    return acceptSession(data, 'register', { linkedGuest: !!guestToken });
  }

  async function logout() {
    const had = account;
    if (!had) return;
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch {
      /* the token is dropped locally either way */
    }
    // The guest token that was linked to this account would otherwise keep
    // playing the account's save on this device after signing out.
    if (had.linkedGuest) {
      try {
        if (persist) localStorage.removeItem(GUEST_TOKEN_KEY);
      } catch {
        /* ignore */
      }
    }
    setAccount(null, 'logout');
    friends.clear();
    // linkedGuest: this device's guest token now belongs to the account — net must start a fresh guest
    // (drop its in-memory token too) instead of resuming the account's save without a sign-in
    events.emit('platform:logout', { reason: 'user', linkedGuest: !!had.linkedGuest });
    ui.toast({ title: t({ en: 'Signed out', nl: 'Uitgelogd' }), text: t({ en: 'See you soon!', nl: 'Tot snel!' }), icon: 'plat-logout' });
  }

  /** Re-checks reachability and the session (GET /api/me). */
  async function refresh() {
    if (noNetwork) {
      setOnline(false);
      return account?.user || null;
    }
    try {
      // GET /api/status: optional auth → { ok, user | null } (200 either way, so a signed-out
      // probe never logs a 401 in the console); a stored token that resolves to no user has expired
      const data = await api('/status', { timeout: 6000 });
      const user = data?.user ? normUser(data.user) : null;
      if (account && user) {
        account.user = user;
        saveAccount();
        events.emit('platform:user', { user, reason: 'refresh' });
      } else if (account && data && data.user === null) sessionExpired();
    } catch (err) {
      if (err.status === 401 && account) sessionExpired();
      // a probe that times out counts as offline (Home offers "Try again" instead of endless skeletons)
      else if (err.code === 'timeout') setOnline(false);
    }
    return account?.user || null;
  }

  // ------------------------------------------------------------- friends
  const friends = {
    list: [],
    incoming: [],
    outgoing: [],
    loaded: false,
    loading: false,
    error: null,
    get online() {
      return this.list.filter((f) => f.online).length;
    },
    _apply(data) {
      const f = normFriends(data);
      this.list = f.friends;
      this.incoming = f.incoming;
      this.outgoing = f.outgoing;
      this.loaded = true;
      this.error = null;
      events.emit('platform:friends', { friends: this.list, incoming: this.incoming, outgoing: this.outgoing });
    },
    async refresh() {
      if (!account || !online) return this;
      if (this.loading) return this;
      this.loading = true;
      if (!this.loaded) events.emit('platform:friends', {});
      try {
        this._apply(await api('/friends'));
      } catch (err) {
        this.error = err;
        events.emit('platform:friends', {});
        throw err;
      } finally {
        this.loading = false;
      }
      return this;
    },
    async request(username) {
      const r = await api('/friends/request', { method: 'POST', body: { username: cleanUsername(username) } });
      if (r && (r.friends || r.incoming || r.outgoing)) this._apply(r);
      else await this.refresh().catch(() => {});
      return r;
    },
    async accept(id) {
      const r = await api('/friends/accept', { method: 'POST', body: { id } });
      if (r && (r.friends || r.incoming || r.outgoing)) this._apply(r);
      else await this.refresh().catch(() => {});
      return r;
    },
    async remove(id) {
      const r = await api('/friends/remove', { method: 'POST', body: { id } });
      if (r && (r.friends || r.incoming || r.outgoing)) this._apply(r);
      else await this.refresh().catch(() => {});
      return r;
    },
    clear() {
      this.list = [];
      this.incoming = [];
      this.outgoing = [];
      this.loaded = false;
      this.error = null;
      events.emit('platform:friends', {});
    },
  };

  // --------------------------------------------------------- experiences
  /** Ø Studio's drafts on this device (ctx.studio.drafts() + thumbnails of the locally published ones). */
  function localDrafts() {
    const s = ctx.studio;
    if (!s || s.available === false || typeof s.drafts !== 'function') return [];
    try {
      const drafts = s.drafts() || [];
      const pub = new Map();
      try {
        for (const p of s.listLocal?.() || []) if (p?.id) pub.set(p.id, p);
      } catch {
        /* thumbnails are optional */
      }
      return (Array.isArray(drafts) ? drafts : [])
        .map((d) => {
          const p = pub.get(d.id);
          return normExperience({
            id: d.id,
            local: true,
            title: d.title,
            updatedAt: d.updated || p?.pubUpdated || 0,
            partCount: Number(d.parts) || 0,
            published: !!(d.published || p),
            thumbnail: p?.thumbnail || null,
            cloudId: d.cloudId || null,
          });
        })
        .filter(Boolean);
    } catch (err) {
      console.warn('[platform] studio drafts unavailable', err);
      return [];
    }
  }

  const experiences = {
    async list(sort = 'popular', q = '') {
      return normExperienceList(await api('/experiences', { query: { sort, q, lang: ctx.i18n?.lang?.() } }));
    },
    async get(id, { data = true } = {}) {
      const res = await api(`/experiences/${encodeURIComponent(id)}`, { query: { data: data ? null : 0, lang: ctx.i18n?.lang?.() } });
      const meta = res?.experience && typeof res.experience === 'object' ? res.experience : res;
      return normExperience({ ...meta, version: res?.version ?? meta?.version, data: res?.data ?? meta?.data });
    },
    /**
     * Your creations: the account's experiences (drafts included for the owner) + Ø Studio's drafts on
     * this device (a local draft that is linked to one of the account's experiences shows once).
     */
    async mine() {
      const local = localDrafts();
      let remote = [];
      if (account?.user && online) {
        try {
          remote = normExperienceList(await api(`/users/${encodeURIComponent(account.user.username)}/experiences`));
        } catch (err) {
          if (!local.length) throw err;
        }
      }
      const linked = new Map(local.filter((x) => x.cloudId).map((x) => [x.cloudId, x]));
      const seen = new Set(remote.map((x) => x.id));
      const all = [
        ...remote.map((x) => (linked.has(x.id) ? { ...x, localId: linked.get(x.id).id, updatedAt: Math.max(x.updatedAt || 0, linked.get(x.id).updatedAt || 0) } : x)),
        ...local.filter((x) => !(x.cloudId && seen.has(x.cloudId))),
      ];
      all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return all;
    },
    /** Like (on = true) or unlike (on = false) → { liked, likes }. */
    async like(id, on = true) {
      return api(`/experiences/${encodeURIComponent(id)}/like`, { method: 'POST', body: { like: !!on } });
    },
    async play(id) {
      return api(`/experiences/${encodeURIComponent(id)}/play`, { method: 'POST', body: {} });
    },
    async remove(id) {
      const r = await api(`/experiences/${encodeURIComponent(id)}`, { method: 'DELETE' });
      events.emit('platform:creations', { removed: id });
      return r;
    },
  };

  async function report({ kind, targetId, reason, details = '', context = null } = {}) {
    const body = { kind, targetId: String(targetId), reason: String(reason || 'other') };
    if (details) body.details = String(details).slice(0, 500);
    if (context) body.context = context;
    return api('/report', { method: 'POST', body });
  }

  /** Players in the shared SMP world right now (game server /healthz), or null. */
  let liveCache = { at: 0, n: null };
  async function livePlayers() {
    if (performance.now() - liveCache.at < 25000) return liveCache.n;
    liveCache.at = performance.now();
    let n = null;
    if (ctx.net?.online && ctx.net.players?.size != null) n = ctx.net.players.size + 1;
    else if (online && !fetchImpl && !noNetwork) {
      try {
        const res = await fetch(`${client.base}/healthz`, { cache: 'no-store', headers: { Accept: 'application/json' } });
        const j = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
        if (j && Number.isFinite(Number(j.players))) n = Number(j.players);
      } catch {
        n = null;
      }
    } else if (fetchImpl) n = 23;
    liveCache.n = n;
    return n;
  }

  // ------------------------------------------------------------- actions
  const studioReady = () => !!ctx.studio && ctx.studio.available !== false && typeof ctx.studio.open === 'function';
  const unavailableToast = () =>
    ui.toast({ title: 'Ø Studio', text: t({ en: "Ø Studio isn't available right now.", nl: 'Ø Studio is nu niet beschikbaar.' }), icon: 'info', kind: 'warn' });

  const actions = {
    async playFlagship() {
      if (modes.transitioning) return;
      if (modes.is('title') && ctx.shell?.titleAction) {
        await ctx.shell.titleAction('play');
      } else if (modes.has('explore')) await modes.go('explore', { resume: true, zone: ctx.state.get('player.zone') || 'spawn' });
      if (modes.is('title')) return; // nothing happened (e.g. a failed transition): Home stays
      home.hide();
    },
    editAvatar() {
      if (!modes.has('customize') || modes.transitioning) return;
      // the fade covers Home; mode:change closes it; Confirm / Esc in the creator come back to Home
      modes.go('customize', { returnTo: 'title', returnParams: { home: true } });
    },
    async createNew() {
      if (!studioReady()) return unavailableToast();
      if (modes.transitioning) return;
      await ctx.studio.open(null, { from: 'home' });
    },
    /** Edit in Ø Studio: a local draft id or the account's experience id (Studio resolves both). */
    async openStudio(id) {
      if (!studioReady()) return unavailableToast();
      if (modes.transitioning) return;
      ui.closeModal('platform-experience');
      await ctx.studio.open(id, { from: 'home' });
    },
    /** Plays an experience (page → Play). Local drafts play from their data; published ones are fetched. */
    async playExperience(exp) {
      if (!exp) return false;
      if (exp.flagship || exp.id === FLAGSHIP_ID) {
        await actions.playFlagship();
        return true;
      }
      return openExperience(exp);
    },
    openSettings() {
      if (ctx.shell?.openSettings) ctx.shell.openSettings();
      else ctx.shell?.openPause?.('settings');
    },
    setLanguage(id) {
      if (!ctx.i18n?.setLanguage || id === ctx.i18n.lang?.()) return;
      try {
        sessionStorage.setItem(HOME_RETURN_KEY, '1');
      } catch {
        /* ignore */
      }
      ctx.i18n.setLanguage(id, ctx.state);
    },
    logout,
  };

  async function openExperience(target) {
    const exp = typeof target === 'object' && target ? target : { id: String(target || '') };
    if (!exp.id) return false;
    if (exp.id === FLAGSHIP_ID) {
      await actions.playFlagship();
      return true;
    }
    if (!ctx.studio || ctx.studio.available === false || typeof ctx.studio.play !== 'function') {
      unavailableToast();
      return false;
    }
    const playLocal = () => {
      if (typeof ctx.studio.playLocal !== 'function') return false;
      ui.closeModal('platform-experience');
      const r = ctx.studio.playLocal(exp.localId || exp.id, { from: 'home' });
      return r?.ok !== false;
    };
    // a creation on this device: its published cloud version when it has one (and we're online),
    // else Studio plays the local copy (published on this device, or else the draft)
    const cloudId = exp.local ? exp.cloudId : exp.id;
    if (exp.local && (!cloudId || !online)) return playLocal();
    let full = !exp.local && exp.data ? exp : null;
    if (!full) {
      try {
        full = await experiences.get(cloudId);
      } catch (err) {
        if (exp.local) return playLocal();
        throw err;
      }
      if (!full?.data) {
        if (exp.local) return playLocal();
        throw new PlatformError('not_published', 'not published', 404, { error: { code: 'not_published', message: 'This experience has not been published yet.', nl: 'Deze ervaring is nog niet gepubliceerd.' } });
      }
    }
    ui.closeModal('platform-experience');
    // Home counts the play (the Studio runtime only does that when not started from Home)
    experiences.play(cloudId).catch(() => {});
    const r = await ctx.studio.play(full.data, { id: cloudId, title: full.title || exp.title, creator: full.creator || exp.creator, from: 'home' });
    return r?.ok !== false;
  }

  // ------------------------------------------------------- home + dialogs
  const core = {
    get user() {
      return account?.user || null;
    },
    get online() {
      return online;
    },
    /** false until the API answered (or failed) once: Home shows skeletons instead of "offline" */
    get probed() {
      return probed || noNetwork;
    },
    whenProbed: () => firstProbe || Promise.resolve(),
    bannerDismissed: false,
    hasGuestProgress: () => !account && !!ctx.shell?.hasProgress?.(),
    login,
    register,
    refresh,
    friends,
    experiences,
    report,
    livePlayers,
    actions,
    dialogs: null,
    home: null,
  };
  core.dialogs = createDialogs(ctx, core);
  const home = createHome(ctx, core);
  core.home = home;

  async function openHome({ tab = null } = {}) {
    if (!modes.is('title')) {
      if (!modes.has('title')) return false;
      await modes.go('title', { home: true, homeTab: tab });
      return true;
    }
    home.show({ tab });
    if (!probed || !online) refresh();
    return true;
  }

  // Home lives on top of the title mode: leaving the title closes it
  events.on('mode:change', ({ to }) => {
    if (to !== 'title' && home.open) home.hide();
  });
  // other modules (net) sign the player in/out of the game server with these
  events.on('platform:login', () => ctx.shell?.title?.screen?.refreshMenu?.());
  events.on('platform:logout', () => ctx.shell?.title?.screen?.refreshMenu?.());

  // first contact with the API (never blocks the boot)
  if (!noNetwork) {
    firstProbe = refresh().then(() => {
      events.emit('platform:ready', { online, user: account?.user || null });
      if (account && online) friends.refresh().catch(() => {});
      ctx.shell?.title?.screen?.refreshMenu?.();
    });
  } else events.emit('platform:ready', { online: false, user: account?.user || null });
  progress(1);

  const platform = {
    available: true,
    get online() {
      return online;
    },
    get user() {
      return account?.user || null;
    },
    get token() {
      return account?.token || null;
    },
    get guest() {
      return !account;
    },
    login,
    register,
    logout,
    refresh,
    api,
    friends,
    experiences,
    report,
    errorText,
    openHome,
    closeHome: ({ toTitle = true } = {}) => home.hide({ toTitle }),
    get homeOpen() {
      return home.open;
    },
    openExperience,
    showExperience: (target) => {
      const exp = typeof target === 'object' && target ? normExperience(target) || target : { id: String(target), title: '', likes: 0, plays: 0, published: true };
      core.dialogs.experience(exp);
    },
    signIn: (mode = 'signin') => core.dialogs.auth(mode),
    /** For the title mode: open Home on this (boot) visit? (?home, or a language switch made on Home). */
    wantsHomeAtBoot() {
      let back = false;
      try {
        back = sessionStorage.getItem(HOME_RETURN_KEY) === '1';
        sessionStorage.removeItem(HOME_RETURN_KEY);
      } catch {
        back = false;
      }
      return back || !!params.home;
    },
    /** One-line status for the title menu ("@alex" / "Guest"). */
    statusLine() {
      if (account?.user) return t({ en: 'Signed in as @{u}', nl: 'Ingelogd als @{u}' }, { u: account.user.username });
      return null;
    },
    home,
  };
  ctx.platform = platform;
  return platform;
}
