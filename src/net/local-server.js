/**
 * LocalServer — the offline / single-player server: runs shared/sim inside
 * the page with exactly the message flow of the Node server (HELLO → WELCOME,
 * PING → PONG, CHAT echo, PROFILE, everything else → sim.handle), so every
 * module talks to ctx.net the same way online and offline.
 *
 *   const local = new LocalServer({ createSim, getHeightAt, isWater, storage: localStorage, migrate });
 *   const conn = local.connect((msg) => client.receive(msg));   // server → client (async, cloned)
 *   conn.send({ t: 'hello', ... });                               // client → server (cloned)
 *   loop: local.tick(dt)   // fixed steps at NET.TICK_HZ, snapshots at NET.SNAPSHOT_HZ
 *
 * Clock: `now()` starts at the wall clock and advances with stepped game time
 * (pausing the game pauses the local world, like single-player always did).
 * Persistence: one JSON blob in `storage` under LOCAL_SAVE_KEY
 * ({v, id, profile, world: sim.exportWorld(), player: sim.exportPlayer(id)}),
 * saved every SAVE_EVERY_S and on save(). The very first start (no blob) seeds
 * the world and the player from `migrate()` (the single-player save) once.
 * Messages are deep-copied both ways (JSON, like the wire) and delivered in a
 * microtask, never re-entrantly inside send().
 */
import { PROTOCOL_VERSION, NET, C, S, encode, decode } from '../../shared/protocol.js';

export const LOCAL_SAVE_KEY = 'o-universe-local-v1';
export const LOCAL_PLAYER_ID = 'p1';
export const SAVE_EVERY_S = 15;
const MAX_STEPS = 4;

const clone = (m) => decode(encode(m));

function cleanName(n) {
  const s = String(n ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 20);
  return s.length >= 2 ? s : '';
}

export class LocalServer {
  constructor(opts = {}) {
    this.createSim = opts.createSim;
    this.getHeightAt = opts.getHeightAt || (() => 0);
    this.isWater = opts.isWater || (() => false);
    this.seed = opts.seed ?? 1;
    this.storage = opts.storage || null;
    this.saveKey = opts.saveKey || LOCAL_SAVE_KEY;
    this.migrate = opts.migrate || null;
    this.log = opts.log || console;
    this.id = LOCAL_PLAYER_ID;
    this.clockMs = opts.startTime ?? Date.now();
    this.acc = 0;
    this.snapAcc = 0;
    this.saveAcc = 0;
    this.sim = null;
    this.saved = null;
    this.joined = false;
    this.name = null;
    this.migrated = false;
    this.pos = [0, 0, 0];
    this.lastH = 0;
    this.trustMovement = opts.trustMovement ?? true;
    this.worldInfo = opts.worldInfo || null;
    this.firstState = false;
    this.respawnAt = 0;
    this.sink = null;
    this.outbox = [];
    this._flushing = false;
    this._errAt = -1e9;
    this.ticks = 0;
  }

  /** Server clock (ms): smooth between steps so interpolation never stutters. */
  now() {
    return this.clockMs + this.acc * 1000;
  }

  // -------------------------------------------------------------- lifecycle
  start() {
    if (this.sim) return this;
    let saved = this._load();
    if (!saved) {
      let m = null;
      try {
        m = this.migrate?.() || null;
      } catch (err) {
        this.log.warn?.('[net/local] migration failed — fresh local world', err);
      }
      saved = { v: 1, id: this.id, world: m?.world ?? null, player: m?.player ?? null, profile: m?.profile ?? null, migrated: !!m };
      this.migrated = !!m;
    }
    this.saved = saved;
    this.sim = this.createSim({
      getHeightAt: this.getHeightAt,
      isWater: this.isWater,
      now: () => this.clockMs,
      seed: this.seed,
      world: saved.world ?? null,
    });
    if (this.migrated) this.save(); // the migration happens exactly once
    return this;
  }

  /** Opens the (single) client connection: returns { send(msg), close() }. */
  connect(onMessage) {
    this.start();
    this.sink = onMessage;
    const conn = {
      open: true,
      send: (msg) => {
        if (conn.open) this.receive(clone(msg));
      },
      close: () => {
        if (!conn.open) return;
        conn.open = false;
        if (this.conn === conn) this.disconnect();
      },
    };
    this.conn = conn;
    return conn;
  }

  /** The client left: keep its save (like the real server does on leave). */
  disconnect() {
    if (this.joined) {
      try {
        this.saved.player = this.sim.removePlayer(this.id) ?? this.saved.player;
      } catch (err) {
        this.log.warn?.('[net/local] removePlayer failed', err);
      }
      this.joined = false;
    }
    this.save();
    this.sink = null;
    this.conn = null;
    this.outbox.length = 0;
  }

  /** Wipes the local world + player and starts over (pause menu → reset). */
  reset({ migrate = this.migrate } = {}) {
    const sink = this.sink;
    this.joined = false;
    this.sim = null;
    try {
      this.storage?.removeItem(this.saveKey);
    } catch {
      /* ignore */
    }
    this.migrate = migrate;
    this.start();
    this.sink = sink;
  }

  // -------------------------------------------------------------- inbound
  receive(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case C.HELLO:
        this._hello(msg);
        return;
      case C.PING:
        this._deliver({ t: S.PONG, ct: msg.ct, st: this.now() });
        return;
      case C.CHAT:
        this._chat(msg);
        return;
      case C.PROFILE:
        this._profile(msg);
        return;
      default:
        break;
    }
    if (!this.joined) return;
    if (msg.t === C.STATE && Array.isArray(msg.p)) {
      this.pos[0] = +msg.p[0] || 0;
      this.pos[1] = +msg.p[1] || 0;
      this.pos[2] = +msg.p[2] || 0;
      this.lastH = Number.isFinite(msg.h) ? msg.h : this.lastH;
      if (this.firstState) {
        // single-player: the page decides where the player starts (zone links, resume)
        this.firstState = false;
        const sp = this.sim.playerPos?.(this.id);
        if (sp && Math.hypot(sp[0] - this.pos[0], sp[2] - this.pos[2]) > 2) this._forcePos(this.pos, this.lastH);
      }
    }
    try {
      this.sim.handle(this.id, msg);
    } catch (err) {
      this._err(`sim.handle(${msg.t}) failed`, err);
    }
    this._flush();
  }

  /**
   * Trusted host: the in-page simulation follows the page's movement (fast travel,
   * debug teleports, resume positions) instead of correcting it like the online server.
   */
  _forcePos(p, h) {
    try {
      if (typeof this.sim.teleport === 'function') {
        this.sim.teleport(this.id, [p[0], p[1], p[2]], h);
        return true;
      }
      const pl = this.sim._w?.players?.get?.(this.id);
      if (!pl) return false;
      pl.x = p[0];
      pl.y = p[1];
      pl.z = p[2];
      if (Number.isFinite(h)) pl.h = h;
      pl.expect = null;
      pl.lastStateAt = this.clockMs;
      return true;
    } catch (err) {
      this._err('teleport failed', err);
      return false;
    }
  }

  /** Keeps the simulation's clock on the page's time of day (enemy night spawns follow the sky). */
  syncTime(hour) {
    if (!this.sim?.setTime || !Number.isFinite(hour)) return;
    const cur = this.sim.time?.()?.hour;
    let d = Number.isFinite(cur) ? Math.abs(hour - cur) % 24 : 24;
    if (d > 12) d = 24 - d;
    if (d > 0.01) this.sim.setTime(hour);
  }

  _hello(msg) {
    if (msg.v !== PROTOCOL_VERSION) {
      this._deliver({ t: S.ERROR, code: 'version', msg: `protocol ${msg.v} ≠ ${PROTOCOL_VERSION}` });
      return;
    }
    const prof = this.saved.profile || {};
    const name = cleanName(msg.name) || cleanName(prof.name) || 'Traveler';
    const appearance = msg.appearance && typeof msg.appearance === 'object' ? msg.appearance : prof.appearance || null;
    if (this.joined) {
      try {
        this.saved.player = this.sim.removePlayer(this.id) ?? this.saved.player;
      } catch {
        /* ignore */
      }
    }
    let payload = null;
    try {
      payload = this.sim.addPlayer({ id: this.id, name, appearance, save: this.saved.player ?? null }) || {};
    } catch (err) {
      this._err('sim.addPlayer failed', err);
      this._deliver({ t: S.ERROR, code: 'local', msg: String(err?.message || err) });
      return;
    }
    this.joined = true;
    this.firstState = true;
    this.name = name;
    this.saved.profile = { name, appearance };
    const p = payload.you?.p || this.saved.player?.p;
    if (Array.isArray(p)) {
      this.pos[0] = +p[0] || 0;
      this.pos[1] = +p[1] || 0;
      this.pos[2] = +p[2] || 0;
    }
    const world = { seed: this.seed, players: [], ...(payload.world || {}), ...(this.worldInfo || {}) };
    if (world.time == null && payload.time != null) world.time = payload.time;
    this._deliver({
      ...payload,
      t: S.WELCOME,
      v: PROTOCOL_VERSION,
      you: { ...(payload.you || {}), id: this.id, token: 'local', name, local: true },
      world,
    });
    this._flush();
  }

  _chat(msg) {
    const text = String(msg.text ?? '').trim().slice(0, NET.CHAT_MAX_LEN);
    if (!text || !this.joined) return;
    const ch = msg.ch === 'local' || msg.ch === 'party' ? msg.ch : 'global';
    this._deliver({ t: S.CHAT, from: this.id, name: this.name, text, ch, ts: Date.now() });
  }

  _profile(msg) {
    const prof = (this.saved.profile = this.saved.profile || {});
    const name = cleanName(msg.name);
    if (name) prof.name = this.name = name;
    if (msg.appearance && typeof msg.appearance === 'object') prof.appearance = msg.appearance;
    try {
      this.sim.setProfile?.(this.id, { name: prof.name, appearance: prof.appearance });
    } catch {
      /* optional sim hook */
    }
  }

  // -------------------------------------------------------------- simulation
  /** Called every frame by the 'net-local' loop system (pausable). */
  tick(dt) {
    if (!this.sim || !this.joined) return;
    this.acc += Math.min(Math.max(dt || 0, 0), 0.25);
    const step = 1 / NET.TICK_HZ;
    let n = 0;
    while (this.acc >= step) {
      if (n >= MAX_STEPS) {
        this.acc = 0; // drop the backlog instead of spiralling
        break;
      }
      this.clockMs += step * 1000;
      this.acc -= step;
      try {
        this.sim.step(step);
      } catch (err) {
        this._err('sim.step failed', err);
      }
      n++;
    }
    if (!n) return;
    this.ticks += n;
    this._flush();
    this.snapAcc += n * step;
    const snapEvery = 1 / NET.SNAPSHOT_HZ;
    if (this.snapAcc >= snapEvery - 1e-6) {
      this.snapAcc = Math.min(this.snapAcc - snapEvery, snapEvery);
      try {
        const snap = this.sim.snapshotFor(this.id);
        if (snap) this._deliver(snap.t ? snap : { t: S.SNAP, ...snap });
      } catch (err) {
        this._err('sim.snapshotFor failed', err);
      }
    }
    this.saveAcc += n * step;
    if (this.saveAcc >= SAVE_EVERY_S) {
      this.saveAcc = 0;
      this.save();
    }
  }

  _flush() {
    let out = null;
    try {
      out = this.sim.drain();
    } catch (err) {
      this._err('sim.drain failed', err);
    }
    if (!out?.length) return;
    for (const o of out) {
      if (!o || !o.msg || !this._for(o.to, o.except)) continue;
      if (o.msg.t === S.CORRECT && this.trustMovement) {
        // offline nobody cheats against themselves: accept the page's position instead
        if (Date.now() - this.respawnAt > 3000) this._forcePos(this.pos, this.lastH);
        continue;
      }
      if (o.msg.t === S.RESPAWNED && o.msg.id === this.id) this.respawnAt = Date.now();
      this._deliver(o.msg);
    }
  }

  _for(to, except) {
    if (except != null && except === this.id) return false;
    if (to === this.id || to === '*' || to == null) return true;
    if (Array.isArray(to)) return to.includes(this.id);
    if (typeof to === 'object' && Array.isArray(to.near)) {
      const [x, z, r] = to.near;
      return Math.hypot(this.pos[0] - x, this.pos[2] - z) <= r;
    }
    return false;
  }

  _deliver(msg) {
    if (!this.sink) return;
    this.outbox.push(clone(msg));
    if (this._flushing) return;
    this._flushing = true;
    queueMicrotask(() => {
      this._flushing = false;
      const box = this.outbox;
      this.outbox = [];
      for (const m of box) {
        if (!m) continue;
        try {
          this.sink?.(m);
        } catch (err) {
          this._err(`client handler for ${m.t} failed`, err);
        }
      }
    });
  }

  // -------------------------------------------------------------- persistence
  _load() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.saveKey);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d && d.v === 1 ? d : null;
    } catch (err) {
      this.log.warn?.('[net/local] could not read the local world save', err);
      return null;
    }
  }

  save() {
    if (!this.storage || !this.sim || !this.saved) return false;
    try {
      if (this.joined) this.saved.player = this.sim.exportPlayer(this.id) ?? this.saved.player;
      this.saved.world = this.sim.exportWorld() ?? this.saved.world;
      this.saved.savedAt = Date.now();
      this.storage.setItem(this.saveKey, JSON.stringify(this.saved));
      return true;
    } catch (err) {
      this.log.warn?.('[net/local] could not save the local world', err);
      return false;
    }
  }

  stats() {
    try {
      return this.sim?.stats?.() || null;
    } catch {
      return null;
    }
  }

  _err(what, err) {
    const now = Date.now();
    if (now - this._errAt < 2000) return;
    this._errAt = now;
    this.log.error?.(`[net/local] ${what}`, err);
  }
}
