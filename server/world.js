import crypto from 'node:crypto';
import { C, S, NET, PROTOCOL_VERSION, encode } from '../shared/protocol.js';
import { TokenBucket } from './ratelimit.js';
import { filterText, cleanText, cleanName, guestName } from './filter.js';
import { cleanAppearance } from './schema.js';

/**
 * The world instance (id 'world', one per server process — PLATFORM.md §3–5, §11):
 * sessions, the authoritative shared/sim on the one seamless planet (the safe hub
 * in the middle + the infinite survival terrain around it, see server/worldgen.js),
 * the tick loop, snapshots, chat and persistence.
 *
 *   transport → world.connect(conn) → session; world.message(session, msg); world.disconnect(session)
 *
 * Sessions: C.HELLO (version check) → the player record:
 *   - signed-in platform account (hello.auth, server/platform resolveToken): the
 *     account's save — the guest save linked at register (user.guestTokenHash) or
 *     the account's own record (token hash sha256('acct:' + userId)); the name is
 *     the account's display name, chat follows the account's restrictions;
 *   - else the guest token (only its sha-256 is stored) or a new guest with a
 *     random 32-byte token (returned once in welcome.you.token).
 * → sim.addPlayer → S.WELCOME. The sim emits S.JOIN / S.LEAVE itself (drain), the
 * world adds the system chat lines. Player ids ('p<n>') come from the store and
 * are stable, so structure / claim owners survive reconnects.
 *
 * Tick loop: NET.TICK_HZ fixed steps on an absolute schedule (drift-corrected,
 * ≤ 4 catch-up steps, resync after a long stall) → sim.step → route sim.drain()
 * (to id / '*' / {near:[x,z,r]} / [ids], optional `except`) → snapshots at
 * NET.SNAPSHOT_HZ right after a tick (skipped for a client whose socket buffer
 * is backed up; a client that stops reading entirely is closed).
 *
 * Persistence: autosave every 30 s (world while players are/were online, all
 * online players), save on leave, final save on shutdown. A world written by
 * another instance (deploy overlap, shared Postgres) is reloaded before the
 * first player joins an empty world, so a stale copy never overwrites it.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const WORLD_ID = 'world';
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
/** Store token hash of a platform account's own game record (accounts that never played as a guest). */
export const accountHash = (userId) => sha256(`acct:${userId}`);

export const LOCAL_CHAT_RADIUS = 60;
const SNAP_SKIP_BYTES = 64 * 1024; // skip snapshots while this much is still queued
const SLOW_CLOSE_BYTES = 4 * 1024 * 1024; // the client stopped reading: close it
const PROFILE_MIN_MS = 2000;

const TXT = {
  join: { en: (n) => `${n} joined the world`, nl: (n) => `${n} is de wereld binnengekomen` },
  leave: { en: (n) => `${n} left the world`, nl: (n) => `${n} heeft de wereld verlaten` },
  full: { en: 'The world is full. Try again in a moment.', nl: 'De wereld is vol. Probeer het zo opnieuw.' },
  version: { en: 'The game was updated — reload the page.', nl: 'De game is bijgewerkt — herlaad de pagina.' },
  shutdown: { en: 'The server is restarting — reconnecting soon.', nl: 'De server herstart — zo weer verbonden.' },
  replaced: { en: 'You joined from another tab or device.', nl: 'Je bent vanaf een ander tabblad of apparaat binnengekomen.' },
  idle: { en: 'Disconnected after a minute without activity.', nl: 'Verbinding verbroken na een minuut zonder activiteit.' },
  server: { en: 'Server error — try again in a moment.', nl: 'Serverfout — probeer het zo opnieuw.' },
  hello: { en: 'Connection timed out.', nl: 'Verbinding verlopen.' },
  slow: { en: 'Connection too slow.', nl: 'Verbinding te traag.' },
  protocol: { en: 'Too many invalid messages.', nl: 'Te veel ongeldige berichten.' },
  restricted: { en: 'Chat is turned off for this account.', nl: 'Chat staat uit voor dit account.' },
};
/** WebSocket close codes per fatal error code. */
export const CLOSE = { full: 4003, version: 4004, shutdown: 1012, replaced: 4005, idle: 4000, server: 1011, hello: 4001, slow: 4002, protocol: 1008 };

function tr(key, lang, ...args) {
  const e = TXT[key];
  if (!e) return key;
  const v = e[lang] ?? e.en;
  return typeof v === 'function' ? v(...args) : v;
}
const isVec3 = (v) => Array.isArray(v) && v.length >= 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

/**
 * @param {object} o
 * @param {(opts) => object} o.simFactory  createSim
 * @param {object} o.provider              server/worldgen.js: { source, impl, heightAt, isWater, isSafe, … }
 * @param {object} o.store                 see store/index.js
 * @param {object} o.log
 * @param {{now: () => number}} o.clock     server time (ms, monotonic, epoch-based)
 * @param {string} o.seed
 * @param {object} [o.config]              { autosaveMs }
 * @param {object} [o.metrics]
 * @param {(event, session) => void} [o.presence]  'online' | 'offline' (platform presence, needs session.userId)
 * @param {(token) => Promise<{id}|null>} [o.resolveAccount]  platform account from hello.auth (optional)
 */
export async function createWorld({ simFactory, provider, store, log, clock, seed, config = {}, metrics = {}, presence = null, resolveAccount = null }) {
  const sessions = new Map(); // player id → joined session
  const conns = new Set(); // every session (joined or not)
  const pending = new Set(); // in-flight store writes (awaited on shutdown)
  let sim = null;
  let worldStamp = 0; // store.worldUpdatedAt() of the world the sim runs on
  let worldDirty = false;
  let joining = 0;
  let shuttingDown = false;
  let tickTimer = null;
  let autosaveTimer = null;
  let saving = null;
  let reloading = null;

  const M = (metrics.world = {
    ticks: 0,
    tickMsAvg: 0,
    tickMsMax: 0,
    resyncs: 0,
    snaps: 0,
    snapsSkipped: 0,
    routed: 0,
    chat: 0,
    joins: 0,
    leaves: 0,
    saves: 0,
    saveErrors: 0,
    lastSaveMs: 0,
    simErrors: 0,
    helloMsAvg: 0, // hello → welcome (store lookups / creates)
    helloMsMax: 0,
  });

  // ------------------------------------------------------------ sim
  async function buildSim() {
    const world = await store.loadWorld();
    worldStamp = (await store.worldUpdatedAt?.()) || 0;
    // bases outside the hub sit on the terrain of the seed they were built on (see WORLD_SEED)
    const saved = world && typeof world === 'object' ? world.server : null;
    if (saved?.seed && saved.seed !== seed) {
      log.error('the saved world was generated with another seed — bases outside the hub will not match the terrain', { savedSeed: saved.seed, seed, savedGen: saved.gen });
    }
    sim = await simFactory({
      // the one planet: hub heightfield blended into the procedural terrain (server/worldgen.js)
      getHeightAt: provider.heightAt,
      isWater: provider.isWater,
      // the generator: the sim picks up isSafe, spawnRules | spawnTable, nodesNear | chunk, isBuildable, biomeAt
      worldgen: provider.impl || undefined,
      now: clock.now,
      seed,
      world,
    });
    log.info('world loaded', { id: WORLD_ID, structures: sim.stats?.().structures ?? 0, fromSave: !!world, gen: provider.source });
  }
  await buildSim();

  /** Before the first player joins an empty world: pick up a newer world saved by another instance. */
  function maybeReloadWorld() {
    if (sessions.size > 0 || !store.worldUpdatedAt) return Promise.resolve();
    if (!reloading) {
      reloading = (async () => {
        const stamp = (await store.worldUpdatedAt()) || 0;
        if (stamp > worldStamp + 1 && sessions.size === 0) {
          log.info('newer world save found (another instance) — reloading');
          await buildSim();
        }
      })()
        .catch((err) => log.error('world reload failed', { err }))
        .finally(() => {
          reloading = null;
        });
    }
    return reloading;
  }

  // ------------------------------------------------------------ send helpers
  function sendRaw(s, str) {
    const c = s.conn;
    if (c.closed) return false;
    if (c.bufferedAmount > SLOW_CLOSE_BYTES) {
      if (!s.slow) {
        s.slow = true;
        log.warn('client not reading, closing', { id: s.id, conn: c.id, buffered: c.bufferedAmount });
        c.close(CLOSE.slow, 'slow');
      }
      return false;
    }
    c.send(str);
    return true;
  }
  const send = (s, msg) => sendRaw(s, encode(msg));

  function fatal(s, code, extra) {
    if (s.conn.closed) return;
    s.conn.send(encode({ t: S.ERROR, code, msg: tr(code, s.lang), ...extra }));
    s.conn.close(CLOSE[code] ?? 4000, code);
  }

  function track(p) {
    pending.add(p);
    p.finally(() => pending.delete(p));
    return p;
  }

  function posOf(s) {
    const p = sim.playerPos?.(s.id);
    return isVec3(p) ? p : s.pos;
  }

  function sysChat(key, name) {
    const ts = Date.now();
    const cache = {};
    for (const o of sessions.values()) {
      const str = (cache[o.lang] ??= encode({ t: S.CHAT, from: null, name: 'Ø', text: tr(key, o.lang, name), ch: 'global', ts, sys: key }));
      sendRaw(o, str);
    }
  }

  // ------------------------------------------------------------ sessions
  function connect(conn) {
    const s = {
      conn,
      id: null,
      name: '',
      appearance: null,
      lang: 'en',
      device: '',
      joined: false,
      helloing: false,
      slow: false,
      pos: [0, 0, 0],
      chat: new TokenBucket(NET.CHAT_RATE, clock.now()),
      profileAt: 0,
      joinedAt: 0,
      userId: null, // platform account id (signed in)
      account: null, // { id, username, displayName }
      chatRestricted: false, // account restriction (under-13 default): no free chat in or out
    };
    conns.add(s);
    return s;
  }

  function disconnect(s) {
    conns.delete(s);
    if (s.joined && !shuttingDown) leave(s, 'closed');
  }

  async function hello(s, m) {
    if (s.helloing || s.joined) return;
    s.helloing = true;
    s.helloAt = clock.now();
    s.lang = m.lang === 'nl' ? 'nl' : 'en';
    s.device = typeof m.device === 'string' ? m.device.slice(0, 16) : '';
    if (m.v !== PROTOCOL_VERSION) return fatal(s, 'version', { v: PROTOCOL_VERSION });
    if (shuttingDown) return fatal(s, 'shutdown');
    if (sessions.size + joining >= NET.MAX_PLAYERS_PER_WORLD) return fatal(s, 'full', { max: NET.MAX_PLAYERS_PER_WORLD });
    joining++;
    try {
      let rec = null;
      let token = null;
      let isNew = false;
      let account = null;
      if (resolveAccount && typeof m.auth === 'string' && m.auth.length <= 256) {
        // signed-in platform user: the save belongs to the account; a bad/expired token just means guest
        try {
          account = (await resolveAccount(m.auth)) || null;
        } catch (err) {
          log.debug('account token not resolved', { err: err.message });
        }
        if (s.conn.closed) return;
      }
      const guestHash = typeof m.token === 'string' && TOKEN_RE.test(m.token) ? sha256(m.token) : null;
      if (account?.id) {
        s.userId = String(account.id);
        s.account = { id: s.userId, username: account.username ?? null, displayName: account.displayName ?? account.username ?? null };
        s.chatRestricted = !!account.restrictions?.chat;
        // 1. the guest save linked at register, 2. the account's own record
        if (account.guestTokenHash) rec = await store.getPlayerByToken(account.guestTokenHash);
        if (!rec) rec = await store.getPlayerByToken(accountHash(s.userId));
        if (rec && guestHash && guestHash === account.guestTokenHash) token = m.token;
      } else if (guestHash) {
        rec = await store.getPlayerByToken(guestHash);
        if (rec) token = m.token;
      }
      // accounts play under their (filtered) display name; guests choose theirs
      const name = (s.account && (cleanName(s.account.displayName) || cleanName(s.account.username))) || cleanName(m.name);
      const appearance = m.appearance != null ? cleanAppearance(m.appearance) : null;
      if (!rec) {
        const fallbackName = name || guestName(s.lang, 1000 + crypto.randomInt(9000));
        if (s.account) {
          rec = await store.createPlayer({ tokenHash: accountHash(s.userId), name: fallbackName, appearance });
        } else {
          token = newToken();
          rec = await store.createPlayer({ tokenHash: sha256(token), name: fallbackName, appearance });
        }
        isNew = true;
      } else {
        // the hello carries the client's current profile (it may have changed offline)
        const patch = {};
        if (name && name !== rec.name) patch.name = rec.name = name;
        if (appearance && JSON.stringify(appearance) !== JSON.stringify(rec.appearance)) patch.appearance = rec.appearance = appearance;
        if (patch.name || patch.appearance) await track(store.savePlayer(rec.id, patch));
      }
      if (s.conn.closed) return;
      await maybeReloadWorld();
      if (s.conn.closed) return;
      if (shuttingDown) return fatal(s, 'shutdown');
      let save = rec.save;
      const old = sessions.get(rec.id);
      if (old) {
        // same guest in another tab/device: the newest connection wins, with the freshest save
        const fresh = leave(old, 'replaced');
        if (fresh) save = fresh;
        fatal(old, 'replaced');
      }
      join(s, rec, token, isNew, save, !!old);
    } catch (err) {
      log.error('hello failed', { err, conn: s.conn.id });
      fatal(s, 'server');
    } finally {
      joining--;
    }
  }

  function join(s, rec, token, isNew, save, quiet) {
    let welcome;
    try {
      welcome = sim.addPlayer({ id: rec.id, name: rec.name, appearance: rec.appearance, save }) || {};
    } catch (err) {
      M.simErrors++;
      log.error('sim.addPlayer failed', { err, id: rec.id });
      return fatal(s, 'server');
    }
    s.id = rec.id;
    s.name = rec.name;
    s.appearance = rec.appearance;
    s.joined = true;
    s.joinedAt = clock.now();
    const p = welcome.you?.p ?? save?.p;
    if (isVec3(p)) s.pos = [p[0], p[1], p[2]];
    sessions.set(s.id, s);
    worldDirty = true;
    M.joins++;
    const you = { ...(welcome.you || {}), id: s.id, name: s.name, appearance: s.appearance, guest: !s.account, isNew };
    if (token) you.token = token; // guests (and an account whose linked guest token came along)
    else delete you.token;
    if (s.account) {
      you.account = s.account;
      if (s.chatRestricted) you.chat = false;
    }
    const msg = {
      ...welcome,
      t: S.WELCOME,
      v: PROTOCOL_VERSION,
      you,
      world: { seed, players: [], ...(welcome.world || {}), id: WORLD_ID, gen: provider.source, st: clock.now(), max: NET.MAX_PLAYERS_PER_WORLD },
    };
    send(s, msg);
    if (!quiet) sysChat('join', s.name);
    try {
      presence?.('online', s);
    } catch {}
    const helloMs = s.joinedAt - (s.helloAt || s.joinedAt);
    M.helloMsAvg = M.joins === 1 ? helloMs : M.helloMsAvg + (helloMs - M.helloMsAvg) * 0.1;
    if (helloMs > M.helloMsMax) M.helloMsMax = helloMs;
    log.info('player joined', { id: s.id, name: s.name, isNew, account: s.userId || undefined, players: sessions.size, ip: s.conn.ip, device: s.device || undefined, ms: helloMs });
  }

  /** Removes a joined session from the world, saves it; returns the player save. */
  function leave(s, reason) {
    if (!s.joined) return null;
    s.joined = false;
    if (sessions.get(s.id) === s) sessions.delete(s.id);
    let save = null;
    try {
      save = sim.removePlayer(s.id);
    } catch (err) {
      M.simErrors++;
      log.error('sim.removePlayer failed', { err, id: s.id });
    }
    if (save) {
      const id = s.id;
      track(
        store
          .savePlayer(id, { save })
          .then(() => store.release?.(id))
          .catch((err) => {
            M.saveErrors++;
            log.error('save on leave failed', { err, id });
          }),
      );
    }
    M.leaves++;
    if (reason !== 'replaced') sysChat('leave', s.name);
    try {
      presence?.('offline', s);
    } catch {}
    log.info('player left', { id: s.id, reason, players: sessions.size, minutes: Math.round((clock.now() - s.joinedAt) / 6000) / 10 });
    return save;
  }

  // ------------------------------------------------------------ messages
  function message(s, m) {
    if (!s.joined) {
      if (m.t === C.HELLO) hello(s, m);
      else if (m.t === C.PING) pong(s, m);
      return; // nothing else before the welcome
    }
    switch (m.t) {
      case C.PING:
        return pong(s, m);
      case C.CHAT:
        return chat(s, m);
      case C.PROFILE:
        return profile(s, m);
      case C.HELLO:
        return;
      case C.STATE:
        s.pos[0] = m.p[0];
        s.pos[1] = m.p[1];
        s.pos[2] = m.p[2];
        break;
    }
    try {
      sim.handle(s.id, m);
    } catch (err) {
      M.simErrors++;
      log.throttle(`handle:${m.t}`, 10_000).error('sim.handle failed', { err, t: m.t });
    }
  }

  function pong(s, m) {
    send(s, { t: S.PONG, ct: m.ct, st: clock.now() });
  }

  function chat(s, m) {
    if (s.chatRestricted) return send(s, { t: S.DENY, of: C.CHAT, reason: 'restricted', msg: tr('restricted', s.lang) });
    if (!s.chat.take(clock.now())) return send(s, { t: S.DENY, of: C.CHAT, reason: 'rate' });
    const text = filterText(cleanText(m.text, NET.CHAT_MAX_LEN));
    if (!text) return;
    const ch = m.ch === 'local' ? 'local' : m.ch === 'party' ? 'party' : 'global';
    if (ch === 'party') return send(s, { t: S.DENY, of: C.CHAT, reason: 'invalid', detail: 'no-party' });
    M.chat++;
    const str = encode({ t: S.CHAT, from: s.id, name: s.name, text, ch, ts: Date.now() });
    if (ch === 'global') {
      for (const o of sessions.values()) if (!o.chatRestricted) sendRaw(o, str);
    } else {
      const [x, y, z] = posOf(s);
      const rr = LOCAL_CHAT_RADIUS * LOCAL_CHAT_RADIUS;
      for (const o of sessions.values()) {
        if (o.chatRestricted) continue;
        const q = o === s ? null : posOf(o);
        if (q && (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2 > rr) continue;
        sendRaw(o, str);
      }
    }
    log.debug('chat', { id: s.id, ch, len: text.length });
  }

  function profile(s, m) {
    const now = clock.now();
    if (now - s.profileAt < PROFILE_MIN_MS) return send(s, { t: S.DENY, of: C.PROFILE, reason: 'rate' });
    s.profileAt = now;
    const patch = {};
    if (m.name !== undefined && m.name !== null && !s.account) {
      // (signed-in players keep their account's display name)
      const n = cleanName(m.name);
      if (!n) return send(s, { t: S.DENY, of: C.PROFILE, reason: 'invalid', field: 'name' });
      if (n !== s.name) patch.name = n;
    }
    if (m.appearance !== undefined && m.appearance !== null) {
      const a = cleanAppearance(m.appearance);
      if (!a) return send(s, { t: S.DENY, of: C.PROFILE, reason: 'invalid', field: 'appearance' });
      patch.appearance = a;
    }
    if (!patch.name && !patch.appearance) return;
    if (patch.name) s.name = patch.name;
    if (patch.appearance) s.appearance = patch.appearance;
    try {
      sim.setProfile?.(s.id, patch); // re-announces S.JOIN {id, name, appearance} to the others
    } catch (err) {
      log.warn('sim.setProfile failed', { err });
    }
    track(store.savePlayer(s.id, patch).catch((err) => log.error('profile save failed', { err, id: s.id })));
  }

  // ------------------------------------------------------------ routing
  function deliver(item) {
    const msg = item?.msg;
    if (!msg) return;
    const to = item.to;
    const except = item.except;
    let str = null;
    const out = (s) => {
      if (!s || s.id === except) return;
      str ??= encode(msg);
      sendRaw(s, str);
      M.routed++;
    };
    if (to === '*') {
      for (const s of sessions.values()) out(s);
    } else if (typeof to === 'string') {
      out(sessions.get(to));
    } else if (Array.isArray(to)) {
      for (const id of to) out(sessions.get(id));
    } else if (to && Array.isArray(to.near)) {
      if (sim.recipients) {
        // the sim knows the authoritative positions (no per-player allocations)
        for (const id of sim.recipients(to)) out(sessions.get(id));
      } else {
        const [x, z, r] = to.near;
        const rr = r * r;
        for (const s of sessions.values()) {
          const dx = s.pos[0] - x;
          const dz = s.pos[2] - z;
          if (dx * dx + dz * dz <= rr) out(s);
        }
      }
    }
    // keep our position copy in step with server-side teleports (respawn, correction, travel)
    if ((msg.t === S.RESPAWNED || msg.t === S.CORRECT || (msg.t === S.TRAVEL && msg.phase === 'done')) && isVec3(msg.p)) {
      const s = sessions.get(msg.t === S.RESPAWNED ? msg.id : to);
      if (s) s.pos = [msg.p[0], msg.p[1], msg.p[2]];
    }
  }

  function route() {
    let list;
    try {
      list = sim.drain();
    } catch (err) {
      M.simErrors++;
      log.throttle('drain', 10_000).error('sim.drain failed', { err });
      return;
    }
    if (!list || !list.length) return;
    for (let i = 0; i < list.length; i++) {
      try {
        deliver(list[i]);
      } catch (err) {
        log.throttle('deliver', 10_000).warn('route failed', { err, t: list[i]?.msg?.t });
      }
    }
  }

  function sendSnapshots() {
    for (const s of sessions.values()) {
      if (s.conn.bufferedAmount > SNAP_SKIP_BYTES) {
        M.snapsSkipped++;
        continue;
      }
      let snap;
      try {
        snap = sim.snapshotFor(s.id);
      } catch (err) {
        M.simErrors++;
        log.throttle('snapshot', 10_000).error('sim.snapshotFor failed', { err });
        return;
      }
      if (snap && sendRaw(s, encode(snap))) M.snaps++;
    }
  }

  // ------------------------------------------------------------ tick loop
  const period = 1000 / NET.TICK_HZ;
  const snapPeriod = 1000 / NET.SNAPSHOT_HZ;
  const dt = 1 / NET.TICK_HZ;
  let nextTick = 0;
  let nextSnap = 0;

  function tickOnce() {
    const t0 = performance.now();
    try {
      sim.step(dt);
    } catch (err) {
      M.simErrors++;
      log.throttle('step', 10_000).error('sim.step failed', { err });
    }
    route();
    const ms = performance.now() - t0;
    M.ticks++;
    M.tickMsAvg += (ms - M.tickMsAvg) * 0.02;
    if (ms > M.tickMsMax) M.tickMsMax = ms;
  }

  function loop() {
    tickTimer = null;
    if (shuttingDown) return;
    let now = clock.now();
    let steps = 0;
    let lastTickAt = -Infinity;
    while (now >= nextTick && steps < 4) {
      lastTickAt = nextTick;
      tickOnce();
      nextTick += period;
      steps++;
    }
    // snapshots right after the tick whose (scheduled) time reached the snapshot deadline;
    // once per loop run even when it caught up several ticks
    if (lastTickAt >= nextSnap - 0.001) {
      const t0 = performance.now();
      sendSnapshots();
      route(); // anything snapshotFor queued
      while (nextSnap <= lastTickAt + 0.001) nextSnap += snapPeriod;
      M.snapMs = Math.round((performance.now() - t0) * 100) / 100;
    }
    now = clock.now();
    if (now - nextTick > 1000) {
      // stalled (GC pause, debugger, overloaded box): don't fast-forward, resync
      M.resyncs++;
      log.throttle('resync', 30_000).warn('tick loop behind, resyncing', { behindMs: Math.round(now - nextTick) });
      nextTick = now + period;
      nextSnap = now + snapPeriod;
    }
    tickTimer = setTimeout(loop, Math.max(0, nextTick - clock.now()));
  }

  function start() {
    nextTick = clock.now() + period;
    nextSnap = nextTick;
    tickTimer = setTimeout(loop, period);
    if (config.autosaveMs > 0) {
      autosaveTimer = setInterval(() => {
        saveAll('autosave').catch(() => {});
      }, config.autosaveMs);
      autosaveTimer.unref?.();
    }
  }

  // ------------------------------------------------------------ persistence
  /** Saves the world (when players are or were online since the last save) and every online player. */
  function saveAll(why = 'autosave', { force = false } = {}) {
    if (saving) return saving;
    saving = (async () => {
      const t0 = performance.now();
      const jobs = [];
      let world = false;
      if (worldDirty || force) {
        try {
          const data = sim.exportWorld();
          // server metadata next to the sim's save (the sim ignores unknown keys on import)
          if (data && typeof data === 'object') data.server = { seed, gen: provider.source };
          worldDirty = sessions.size > 0;
          world = true;
          jobs.push(
            store.saveWorld(data).then(async () => {
              worldStamp = Math.max(worldStamp, (await store.worldUpdatedAt?.()) || 0);
            }),
          );
        } catch (err) {
          M.simErrors++;
          log.error('sim.exportWorld failed', { err });
        }
      }
      for (const s of sessions.values()) {
        try {
          const save = sim.exportPlayer(s.id);
          if (save) jobs.push(store.savePlayer(s.id, { save }));
        } catch (err) {
          log.error('sim.exportPlayer failed', { err, id: s.id });
        }
      }
      const res = await Promise.allSettled(jobs);
      const failed = res.filter((r) => r.status === 'rejected');
      M.saves++;
      M.lastSaveMs = Math.round(performance.now() - t0);
      M.lastSaveAt = Date.now();
      if (failed.length) {
        M.saveErrors += failed.length;
        log.error('save failed', { why, failed: failed.length, err: failed[0].reason });
      } else if (jobs.length) log.debug('saved', { why, world, players: jobs.length - (world ? 1 : 0), ms: M.lastSaveMs });
    })().finally(() => {
      saving = null;
    });
    return saving;
  }

  /** Final save, then tell every client and close the sockets. */
  async function shutdown(reason = 'shutdown', { graceMs = 8000 } = {}) {
    if (shuttingDown) return;
    log.info('shutting down', { reason, players: sessions.size });
    if (tickTimer) clearTimeout(tickTimer);
    if (autosaveTimer) clearInterval(autosaveTimer);
    tickTimer = autosaveTimer = null;
    if (saving) await saving.catch(() => {});
    const timeout = new Promise((r) => setTimeout(r, graceMs).unref?.());
    shuttingDown = true; // after the in-flight save, before the final one (blocks new joins)
    await Promise.race([
      (async () => {
        await saveAll(reason, { force: worldDirty || sessions.size > 0 });
        await Promise.allSettled([...pending]);
      })(),
      timeout,
    ]);
    for (const s of conns) fatal(s, 'shutdown');
    sessions.clear();
  }

  return {
    connect,
    disconnect,
    message,
    start,
    shutdown,
    saveAll,
    get sim() {
      return sim;
    },
    get sessions() {
      return sessions;
    },
    get connections() {
      return conns.size;
    },
    get players() {
      return sessions.size;
    },
    /** Push a S.ERROR + close for a session (used by the transport for idle/protocol/hello timeouts). */
    fatal,
    stats() {
      let simStats = {};
      try {
        simStats = sim.stats?.() || {};
      } catch {}
      return { id: WORLD_ID, ...simStats, players: sessions.size, connections: conns.size, sim: sim?.stub ? 'stub' : 'real', gen: provider.source };
    },
  };
}
