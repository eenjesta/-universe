/**
 * Net module (Ø Universe) → ctx.net — the client net layer (PLATFORM.md §6).
 *
 * Transport: WebSocket to ws(s)://<host>/ws (or ?server=<url>) with HELLO {v, token, name,
 * appearance, lang, device, auth?} → WELCOME; reconnect with backoff (deferred while the tab is
 * hidden); when no socket opens within 4 s (or ?offline, or a fatal 'full'/'version' error)
 * the in-page LocalServer (local-server.js: shared/sim + localStorage 'o-universe-local-v1',
 * one-time migration of the single-player save) takes over with the same message flow.
 * Guest token: localStorage 'o-universe-net-token' (not with ?nosave).
 *
 * ctx.net = {
 *   online, mode: 'connecting'|'online'|'local'|'offline', connected, id, name, ping,
 *   players / enemies / loot / projectiles (Maps id → entity, see remotes.js; entity.view is
 *     interpolated every frame: players {p: Vector3, h, a, m, hp, sh, veh, v, speed, dead},
 *     enemies {p, h, s, hp, type, v, speed, dead}, loot {p}),
 *   send(msg) → bool, on(type | '*', fn) → off, serverTime(), viewTime() (= serverTime − INTERP_DELAY_MS,
 *   the render time of the views; C.FIRE `vt`), interp(entity) → view,
 *   local (the LocalServer when offline, else null), welcome (last WELCOME), world {seed, time, …},
 *   count() (players in the world incl. you), travel(to) (C.TRAVEL), token (guest token),
 *   providers (the local world's terrain/safe-zone functions), predict(fn) (credits/resource changes inside are local-only
 *   predictions), markTeleport() (next state carries tp), retryOnline(), goOffline(),
 *   touchMenu ([{id, label, icon, run}] — spread into your touch layout's menuExtra), colorFor(id)
 * }
 * Events (ctx.events, payload = the raw server message unless noted): net:status {mode, online,
 *   reconnecting, reason}, net:welcome, net:join {id, name, appearance}, net:leave {id, name},
 *   net:profile {id, name, appearance} (a known player changed), net:damage, net:death,
 *   net:respawned, net:stats, net:inv, net:loot, net:struct, net:claims, net:event, net:deny,
 *   net:fired, net:efire, net:boom, net:harvested, net:crafted, net:chat, net:correct, net:error,
 *   net:travel (S.TRAVEL channel / cancel / done — on 'done' net already moved the player).
 * State: mirrors S.INV/S.STATS into state.resources / credits / smp (bridge.js), routes local
 *   reward / market changes through C.GRANT / C.SPEND, chat:sent → C.CHAT, S.CHAT → ctx.chat,
 *   customize:done / profile → C.PROFILE.
 * Loop: net-local (14, LocalServer ticks, pausable), net-remotes (15, interpolation),
 *   net-time (11), net-sync (26, C.STATE), net-ui (94).
 * Sign in / out (platform:login / platform:logout): a fresh HELLO with the new `auth` (account save ↔ guest
 *   save), no "connection lost" toast. Restricted accounts (welcome you.chat === false) don't send chat.
 * Boot: server messages are held until game:installed (only the newest S.SNAP is kept meanwhile).
 * URL: ?offline · ?server=<host|url> · ?nosave (no token / local world persistence) · ?fresh.
 */
import './net.css';
import { NET, C, S } from '../../shared/protocol.js';
import { NetClient, serverUrl } from './client.js';
import { LocalServer, LOCAL_SAVE_KEY, LOCAL_PLAYER_ID } from './local-server.js';
import { createRemotes } from './remotes.js';
import { createBridge, cleanAppearance } from './bridge.js';
import { createSync } from './sync.js';
import { createNetUi } from './ui.js';
import { createProviders } from './providers.js';

export const TOKEN_KEY = 'o-universe-net-token';
/** The one world per server (PLATFORM.md §11); other planets become other worlds later. */
export const WORLD_NAME = 'world';
const LOCAL_SEED = 'o-universe';

// shared/worldgen is optional until it lands (an empty glob when the file does not exist)
const WORLDGEN = import.meta.glob('../../shared/worldgen/index.js');

/**
 * The simulation and defs are loaded on demand and fail soft: a broken shared/ module (another
 * engineer mid-edit) must not take the whole net layer down — online play still works without them.
 */
async function loadShared() {
  const names = ['sim', 'items', 'market'];
  const res = await Promise.allSettled([import('../../shared/sim/index.js'), import('../../shared/defs/items.js'), import('../../shared/defs/market.js')]);
  const out = {};
  res.forEach((r, i) => {
    out[names[i]] = r.status === 'fulfilled' ? r.value : null;
    if (r.status === 'rejected') console.error(`[net] shared/${names[i] === 'sim' ? 'sim' : `defs/${names[i]}`} failed to load — the offline world is unavailable`, r.reason);
  });
  return out;
}

/** Event name per server message type (PLATFORM.md §6). */
const EVENT_OF = {
  [S.DAMAGE]: 'net:damage',
  [S.DEATH]: 'net:death',
  [S.RESPAWNED]: 'net:respawned',
  [S.STATS]: 'net:stats',
  [S.INV]: 'net:inv',
  [S.LOOT]: 'net:loot',
  [S.STRUCT]: 'net:struct',
  [S.CLAIMS]: 'net:claims',
  [S.EVENT]: 'net:event',
  [S.DENY]: 'net:deny',
  [S.FIRED]: 'net:fired',
  [S.ENEMY_FIRE]: 'net:efire',
  [S.EXPLODE]: 'net:boom',
  [S.HARVESTED]: 'net:harvested',
  [S.CRAFTED]: 'net:crafted',
  [S.CHAT]: 'net:chat',
  [S.CORRECT]: 'net:correct',
  [S.ERROR]: 'net:error',
  [S.TRAVEL]: 'net:travel',
};

function storageOf(persist) {
  if (!persist) return null;
  try {
    const s = window.localStorage;
    const k = '__o_net_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export async function install(ctx) {
  const { state, events, loop, params } = ctx;
  const persist = !params.nosave;
  const storage = storageOf(persist);
  const offline = params.offline !== undefined && params.offline !== false && params.offline !== '0';

  if (params.fresh && storage) {
    try {
      storage.removeItem(LOCAL_SAVE_KEY);
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ visible session state
  const vis = { mode: 'connecting', online: false, ready: false, everWelcomed: false, reconnecting: false, reason: null, id: null, name: null, welcome: null, worldN: 0 };
  const subs = new Map(); // message type → Set(fn)
  let released = false;
  const gate = [];
  let gatedSnap = null;
  const gated = (fn) => (released ? fn() : gate.push(fn));

  const remotes = createRemotes({
    delay: NET.INTERP_DELAY_MS,
    onUnknownPlayer: (e) => {
      // seen in a snapshot before its JOIN: announce it so avatars appear; JOIN fills in the name
      events.emit('net:join', { id: e.id, name: e.name, appearance: e.appearance, unknown: true });
    },
  });

  // ------------------------------------------------------------ token / hello / migration
  let memToken = null;
  const readToken = () => {
    if (!storage) return memToken;
    try {
      return storage.getItem(TOKEN_KEY) || null;
    } catch {
      return memToken;
    }
  };
  const writeToken = (tok) => {
    memToken = tok;
    if (!storage || !tok) return;
    try {
      storage.setItem(TOKEN_KEY, tok);
    } catch {
      /* ignore */
    }
  };

  function platformToken() {
    try {
      if (typeof ctx.platform?.token === 'string') return ctx.platform.token;
      const raw = storage?.getItem('o-universe-account');
      const acc = raw ? JSON.parse(raw) : null;
      return typeof acc?.token === 'string' ? acc.token : null;
    } catch {
      return null;
    }
  }

  let helloAuth = null; // the account token the current session was opened with
  function hello() {
    const prof = state.get('profile') || {};
    const msg = {
      world: WORLD_NAME,
      name: String(prof.name || 'Traveler').slice(0, 24),
      appearance: cleanAppearance(prof.appearance),
      lang: String(ctx.i18n?.lang?.() || state.get('settings.language') || 'en').slice(0, 8),
      device: ctx.device?.phone ? 'phone' : ctx.device?.tablet ? 'tablet' : 'desktop',
    };
    const auth = platformToken();
    if (auth && auth.length <= 256) msg.auth = auth;
    helloAuth = msg.auth || null;
    return msg;
  }

  /** One-time seed of the local world from the single-player save. */
  function migrate() {
    const d = state.data;
    const prof = d.profile || {};
    const pos = d.player?.position;
    const owned = Array.isArray(d.owned?.items) ? d.owned.items : [];
    const res = {};
    const START = shared.items?.START || { res: { metal: 0, stone: 0, wood: 0, energy: 0 } };
    const MARKET = shared.market?.MARKET || {};
    for (const k of Object.keys(START.res)) res[k] = Math.max(0, Math.floor(Number(d.resources?.[k]) || 0));
    const player = {
      v: 1,
      h: Number(d.player?.heading) || 0,
      inv: {
        ...JSON.parse(JSON.stringify(START)),
        res,
        credits: Math.max(0, Math.floor(Number(d.credits) || 0)),
        unlocks: owned.filter((id) => MARKET[id]),
      },
      stats: { hp: 100, sh: 50, en: 100 },
    };
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
      const gy = ctx.world?.getHeightAt?.(pos.x, pos.z) ?? 0;
      player.p = [pos.x, Number.isFinite(pos.y) ? pos.y : gy, pos.z];
    }
    let maxS = 0;
    const structures = [];
    for (const s of Array.isArray(d.structures) ? d.structures : []) {
      if (!s || typeof s.id !== 'string' || !Number.isFinite(s.x)) continue;
      const n = /^s(\d+)$/.exec(s.id);
      if (n) maxS = Math.max(maxS, +n[1]);
      structures.push({ ...s, owner: s.owner || LOCAL_PLAYER_ID, ownerName: s.ownerName || prof.name });
    }
    const world = { v: 1, time: Number(d.world?.time) || undefined, ids: { s: maxS }, structures, claims: [], loot: [] };
    return { world, player, profile: { name: prof.name, appearance: prof.appearance } };
  }

  // the local world uses the same world providers as the server (server/worldgen.js): shared/worldgen
  // around the hub heightfield, else the shared/sim stand-in. The hub queries are captured now, before
  // a later module (frontier) wraps ctx.world.getHeightAt with the procedural terrain.
  const shared = await loadShared();
  // the frontier bridge (src/world/frontier-bridge.js) may already have wrapped ctx.world — the originals live in ctx.world.hub
  const rawHeightAt = ctx.world?.hub?.getHeightAt ?? ctx.world?.getHeightAt;
  const rawIsWater = ctx.world?.hub?.isWater ?? ctx.world?.isWater;
  const providers = await createProviders({
    seed: LOCAL_SEED,
    hub: {
      heightAt: typeof rawHeightAt === 'function' ? (x, z) => rawHeightAt(x, z) : () => 0,
      isWater: typeof rawIsWater === 'function' ? (x, z) => !!rawIsWater(x, z) : () => false,
    },
    loaders: {
      worldgen: Object.values(WORLDGEN)[0] || null,
      standin: () => import('../../shared/sim/standin.js'),
      defs: () => import('../../shared/defs/world.js'),
    },
  });

  const createLocal = shared.sim?.createSim
    ? () =>
        new LocalServer({
          createSim: (o) => shared.sim.createSim({ ...o, trusted: true, worldgen: providers.impl || undefined }),
          getHeightAt: providers.heightAt,
          isWater: providers.isWater,
          seed: LOCAL_SEED,
          worldInfo: { id: WORLD_NAME, gen: providers.source },
          storage,
          migrate,
        })
    : null;

  // ------------------------------------------------------------ the api object (ctx.net)
  const api = {
    get online() {
      return vis.online;
    },
    get mode() {
      return vis.mode;
    },
    get connected() {
      return vis.ready;
    },
    get id() {
      return vis.id;
    },
    get name() {
      return vis.name;
    },
    get ping() {
      return client.ping;
    },
    get local() {
      return client.kind === 'local' ? client.local : null;
    },
    get welcome() {
      return vis.welcome;
    },
    get world() {
      return vis.welcome?.world || null;
    },
    get reconnecting() {
      return vis.reconnecting;
    },
    /** The guest session token of the online world (null offline / before the first welcome). */
    get token() {
      const tok = client.token || readToken();
      return typeof tok === 'string' && tok && tok !== 'local' ? tok : null;
    },
    /** World instance name (one world per server, PLATFORM.md §11). */
    worldName: WORLD_NAME,
    /** World providers of the local world: { source: 'worldgen'|'standin'|'hub', heightAt, isWater, isSafe, biomeAt, hubDist, hub }. */
    providers,
    players: remotes.players,
    enemies: remotes.enemies,
    loot: remotes.loot,
    projectiles: remotes.projectiles,
    send: (msg) => client.send(msg),
    on(type, fn) {
      let set = subs.get(type);
      if (!set) subs.set(type, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    off(type, fn) {
      subs.get(type)?.delete(fn);
    },
    serverTime: () => client.serverTime(),
    /** Render time of the interpolated views (serverTime − NET.INTERP_DELAY_MS): C.FIRE `vt`. */
    viewTime: () => client.serverTime() - NET.INTERP_DELAY_MS,
    interp: (entity) => remotes.interp(entity, client.serverTime()),
    /** Players in the world incl. you (the server's count when it sends one: players beyond the interest radius too). */
    count: () => Math.max(remotes.players.size + 1, vis.mode === 'online' ? vis.worldN : 0),
    /** C.TRAVEL: 'hub' (Return to hub, 10 s channel) | 'wild' | 'base' | 'beacon' (hub Gateway) | 'cancel'. */
    travel: (to) => client.send({ t: C.TRAVEL, to: String(to) }),
    predict: (fn) => bridge.predict(fn),
    markTeleport: () => sync.markTeleport(),
    retryOnline: () => client.retryOnline(),
    goOffline: () => client.goLocal('manual'),
    colorFor: (id) => bridge.colorFor(id),
    touchMenu: [],
    dispatching: 0,
  };
  ctx.net = api;

  // internal view for the helpers
  const inner = {
    ready: () => vis.ready,
    hasSession: () => vis.everWelcomed,
    mode: () => vis.mode,
    id: () => vis.id,
    /** The server turned chat off for this account (under-13 restrictions). */
    chatOff: () => vis.mode === 'online' && vis.welcome?.you?.chat === false,
    local: () => (client.kind === 'local' ? client.local : null),
    send: (msg) => client.send(msg),
    sendRaw: (msg) => client.send(msg),
    players: remotes.players,
    get dispatching() {
      return api.dispatching;
    },
  };

  const bridge = createBridge(ctx, inner);
  const sync = createSync(ctx, inner);
  const ui = createNetUi(ctx, {
    status: () => vis,
    count: () => api.count(),
    ping: () => client.ping,
    id: () => vis.id,
    players: remotes.players,
    colorFor: (id) => bridge.colorFor(id),
    selfMode: () => sync.lastSent?.m || 'foot',
    canGoOnline: () => !!client.url && !!client.WS && !offline,
    retryOnline: () => client.retryOnline(),
  });
  api.touchMenu = ui.touchMenu;

  // ------------------------------------------------------------ dispatch
  const emit = (name, payload) => events.emit(name, payload);

  function onWelcome(msg) {
    const wasOnline = vis.everWelcomed && client.kind === 'ws';
    vis.ready = true;
    vis.everWelcomed = true;
    vis.welcome = msg;
    vis.id = msg.you?.id ?? vis.id;
    vis.name = msg.you?.name ?? vis.name;
    vis.worldN = Number.isFinite(msg.world?.n) ? msg.world.n : 0;
    if (client.kind === 'ws' && msg.you?.token) writeToken(msg.you.token);
    // players: reconcile with the welcome list (reconnects keep the avatars that are still here)
    const list = Array.isArray(msg.world?.players) ? msg.world.players : [];
    const keep = new Set();
    for (const p of list) {
      if (!p || p.id == null || p.id === vis.id) continue;
      keep.add(p.id);
      const { isNew, wasKnown } = remotes.join(p.id, { name: p.name, appearance: p.appearance });
      if (isNew) emit('net:join', { id: p.id, name: p.name, appearance: p.appearance });
      else if (!wasKnown) emit('net:profile', { id: p.id, name: p.name, appearance: p.appearance });
    }
    for (const id of [...remotes.players.keys()]) {
      if (keep.has(id)) continue;
      const e = remotes.leave(id);
      if (e) emit('net:leave', { id, name: e.name });
    }
    remotes.clear({ keepPlayers: true });
    for (const l of Array.isArray(msg.loot) ? msg.loot : []) remotes.addLoot(l);
    bridge.onWelcome(msg);
    sync.onWelcome(msg);
    if (wasOnline && !quietWelcome) ui.toastStatus('back');
    quietWelcome = false;
  }

  function onJoin(msg) {
    if (msg.id == null || msg.id === vis.id) return;
    const { isNew, wasKnown } = remotes.join(msg.id, { name: msg.name, appearance: msg.appearance });
    const info = { id: msg.id, name: msg.name, appearance: msg.appearance };
    if (isNew) emit('net:join', info);
    else emit('net:profile', info);
    if ((isNew || !wasKnown) && vis.mode === 'online') ui.toastJoin(msg.name || '?');
  }

  function onLeave(msg) {
    const e = remotes.leave(msg.id);
    if (!e) return;
    emit('net:leave', { id: msg.id, name: e.name });
    if (vis.mode === 'online') ui.toastLeave(e.name || '?');
  }

  function onLoot(msg) {
    for (const l of Array.isArray(msg.add) ? msg.add : []) remotes.addLoot(l);
    for (const id of Array.isArray(msg.remove) ? msg.remove : []) remotes.removeLoot(id);
  }

  function dispatch(msg) {
    api.dispatching++;
    try {
      switch (msg.t) {
        case S.WELCOME:
          onWelcome(msg);
          break;
        case S.JOIN:
          onJoin(msg);
          break;
        case S.LEAVE:
          onLeave(msg);
          break;
        case S.SNAP:
          remotes.applySnapshot(msg, vis.id);
          sync.onSnapTime(msg.tod);
          if (Number.isFinite(msg.n)) vis.worldN = msg.n;
          break;
        case S.TRAVEL:
          sync.onTravel(msg);
          break;
        case S.INV:
          bridge.onInv(msg);
          break;
        case S.STATS:
          bridge.onStats(msg);
          break;
        case S.CHAT:
          bridge.onChat(msg);
          break;
        case S.CORRECT:
          sync.onCorrect(msg);
          break;
        case S.RESPAWNED:
          sync.onRespawned(msg);
          break;
        case S.LOOT:
          onLoot(msg);
          break;
        case S.DENY:
          bridge.onDeny(msg);
          break;
        case S.DEATH:
          if (msg.id === vis.id) state.set('smp.dead', true);
          break;
        default:
          break;
      }
      const set = subs.get(msg.t);
      if (set) for (const fn of [...set]) safe(fn, msg);
      const any = subs.get('*');
      if (any) for (const fn of [...any]) safe(fn, msg);
      if (msg.t === S.WELCOME) emit('net:welcome', msg);
      else {
        const ev = EVENT_OF[msg.t];
        if (ev) emit(ev, msg);
      }
    } finally {
      api.dispatching--;
    }
  }

  function safe(fn, msg) {
    try {
      fn(msg);
    } catch (err) {
      console.error(`[net] handler for "${msg.t}" failed`, err);
    }
  }

  let lastStatus = null;
  let quietWelcome = false; // a deliberate re-hello (sign in / out): no "lost" / "back online" toasts
  function onStatus(st) {
    const prev = lastStatus;
    lastStatus = st;
    vis.mode = st.mode;
    vis.online = st.online;
    vis.ready = st.ready;
    vis.reconnecting = st.reconnecting;
    vis.reason = st.reason;
    if (st.mode === 'connecting' && st.reason === 'auth') quietWelcome = true;
    else if (st.mode === 'connecting' && st.reconnecting && prev && prev.mode === 'online') ui.toastStatus('lost');
    if (st.mode === 'local' && prev?.mode !== 'local' && st.reason && st.reason !== 'offline' && st.reason !== 'manual' && st.reason !== 'reset') ui.toastStatus('offline', st.reason);
    if (st.mode === 'offline' && st.reason === 'replaced') ui.toastStatus('replaced');
    if (st.mode !== 'online' && st.mode !== 'local') {
      // the remote world froze: keep the avatars, but nothing is in range any more
      for (const p of remotes.players.values()) p.inRange = st.reconnecting ? p.inRange : false;
    }
    if (st.mode === 'local' && prev?.mode === 'online') {
      for (const id of [...remotes.players.keys()]) {
        const e = remotes.leave(id);
        if (e) emit('net:leave', { id, name: e.name });
      }
      remotes.clear();
    }
    emit('net:status', { mode: st.mode, online: st.online, reconnecting: st.reconnecting, reason: st.reason });
  }

  // ------------------------------------------------------------ client
  const client = new NetClient({
    url: offline ? null : serverUrl(params, window.location),
    offline,
    token: readToken(),
    hello,
    createLocal,
    onMessage: (msg) => {
      if (released) dispatch(msg);
      else if (msg.t === S.SNAP) gatedSnap = msg; // while booting only the newest snapshot matters
      else gate.push(() => dispatch(msg));
    },
    onStatus: (st) => gated(() => onStatus(st)),
    onSent: (msg) => bridge.onSent(msg),
    isHidden: () => document.hidden,
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) client.visible?.();
  });
  window.addEventListener('pagehide', () => client.local?.save?.());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) client.local?.save?.();
  });

  // signing in / out switches the server save (guest ↔ account): a fresh HELLO carries the new `auth`
  const reauth = () => {
    if (offline) return;
    const auth = platformToken();
    if (client.kind === 'ws' && (auth || null) === helloAuth && vis.ready) return; // same account: nothing changes
    if (client.kind === 'ws') client.reconnect('auth');
    else if (client.kind === 'local' && client.url && client.WS) client.retryOnline();
  };
  events.on('platform:login', reauth);
  events.on('platform:logout', reauth);

  // local world reset together with the single-player save (pause menu → reset)
  events.on('state:reset', () => {
    if (client.kind !== 'local' || !client.local) return;
    client.local.reset({ migrate });
    client.goLocal('reset');
  });

  // ------------------------------------------------------------ loop
  loop.add('net-local', (dt) => client.local?.tick(dt), { order: 14, when: () => released && client.kind === 'local' });
  loop.add('net-remotes', () => remotes.update(client.serverTime()), { order: 15, pausable: false, when: () => released });

  // modules installed after us (combat, smp, systems…) must see the welcome: messages wait for them
  // (game.js always emits game:installed, also when a module failed; no timeout — a slow boot on a
  // weak device must not release the welcome before those modules listen)
  const release = () => {
    if (released) return;
    released = true;
    for (const fn of gate.splice(0)) fn();
    const snap = gatedSnap;
    gatedSnap = null;
    if (snap) dispatch(snap);
  };
  events.on('game:installed', release);
  if (ctx.ready) release(); // installed into a running game (hot reload / tools)

  client.start();

  api.debug = {
    client,
    remotes,
    bridge,
    sync,
    ui,
    vis,
    /** Feed a server message as if it arrived (tests). */
    inject: (msg) => dispatch(msg),
  };
  return api;
}
