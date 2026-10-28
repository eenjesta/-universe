/**
 * Connection manager for ctx.net: the online WebSocket (4 s open timeout,
 * HELLO → WELCOME handshake, reconnect with backoff) or the in-page
 * LocalServer (offline / single-player) behind the same message flow; ping/pong
 * clock sync, outgoing rate limiting (mirrors the server's NET.MSG_RATE so the
 * client never kicks itself) and a small queue for important messages sent
 * while not connected.
 *
 * Pure of DOM/game state: every dependency is injected (tests run it in Node
 * against the real server with Node's global WebSocket).
 *
 *   const client = new NetClient({ url, offline, hello: () => ({...}), createLocal, onMessage, onStatus });
 *   client.start();
 *   client.send({ t: C.CHAT, text, ch: 'global' });
 *
 * Status (onStatus): { mode: 'connecting'|'online'|'local'|'offline'|'off', online, ready, reconnecting, attempt, reason }
 * ('offline' = replaced by another tab/device, no auto-reconnect; 'off' = no server and no local world)
 */
import { PROTOCOL_VERSION, NET, C, S, encode, decode } from '../../shared/protocol.js';
import { ClockSync } from './clock.js';
import { TokenBucket } from './ratelimit.js';

export const OPEN_TIMEOUT_MS = 4000;
export const WELCOME_TIMEOUT_MS = 6000;
export const PING_MS = 2000;
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
/** Messages kept (in order) while disconnected and sent after the next WELCOME. */
const QUEUED = new Set([C.GRANT, C.SPEND, C.CHAT, C.PROFILE]);
const QUEUE_MAX = 64;
/** Fatal server errors that switch to the local world instead of reconnecting. */
const FATAL_LOCAL = new Set(['full', 'version', 'banned', 'protocol']);

/** ws(s) URL of the game server for this page (or `?server=`), null when there is none. */
export function serverUrl(params = {}, loc = globalThis.location) {
  const secure = loc?.protocol === 'https:';
  let u = typeof params.server === 'string' ? params.server.trim() : '';
  if (u) {
    if (/^https?:\/\//i.test(u)) u = u.replace(/^http/i, 'ws');
    else if (!/^wss?:\/\//i.test(u)) u = `${secure ? 'wss' : 'ws'}://${u}`;
    try {
      const url = new URL(u);
      if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
      return url.toString();
    } catch {
      return null;
    }
  }
  if (!loc?.host || !/^https?:$/.test(loc.protocol || '')) return null;
  return `${secure ? 'wss' : 'ws'}://${loc.host}/ws`;
}

export class NetClient {
  constructor(opts = {}) {
    this.url = opts.url ?? null;
    this.offline = !!opts.offline;
    this.WS = opts.WebSocket ?? globalThis.WebSocket ?? null;
    this.hello = opts.hello || (() => ({}));
    this.createLocal = opts.createLocal || null;
    this.onMessage = opts.onMessage || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.onSent = opts.onSent || null;
    this.isHidden = opts.isHidden || (() => false);
    this.now = opts.now || (() => performance.now());
    this.log = opts.log || console;
    this.timers = opts.timers || globalThis;
    this.openTimeout = opts.openTimeout ?? OPEN_TIMEOUT_MS;
    this.welcomeTimeout = opts.welcomeTimeout ?? WELCOME_TIMEOUT_MS;
    this.backoff = opts.backoff || BACKOFF_MS;

    this.mode = 'connecting';
    this.kind = null; // 'ws' | 'local'
    this.online = false; // connected to a real server (welcome received)
    this.ready = false; // welcome received on the current transport
    this.reconnecting = false;
    this.everOnline = false;
    this.attempt = 0;
    this.reason = null;
    this.id = null;
    this.token = opts.token ?? null;
    this.name = null;
    this.welcome = null;
    this.ws = null;
    this.local = null;
    this.localConn = null;
    this.clock = new ClockSync();
    this.bucket = new TokenBucket(NET.MSG_RATE.burst - 10, NET.MSG_RATE.perSec * 0.9, this.now());
    this.queue = [];
    this.stats = { sent: 0, received: 0, dropped: 0, bytesIn: 0, bytesOut: 0, reconnects: 0 };
    this._timers = { open: 0, welcome: 0, retry: 0, ping: 0 };
    this._stopped = false;
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this._stopped = false;
    if (this.offline || !this.url || !this.WS) this._startLocal(this.offline ? 'offline' : 'no-server');
    else this._connectOnline();
  }

  stop() {
    this._stopped = true;
    this._clearTimers();
    this._closeWs();
    this.localConn?.close();
    this.localConn = null;
    this.ready = false;
    this.online = false;
  }

  /** Leaves the online world for the local one (or restarts the local session). */
  goLocal(reason = 'manual') {
    this._clearTimers();
    this._closeWs();
    this.reconnecting = false;
    this._startLocal(reason);
  }

  /** The page became visible again: a deferred reconnect starts now. */
  visible() {
    if (!this.waitVisible || this._stopped) return;
    this.waitVisible = false;
    this.attempt = 0;
    this._connectOnline();
  }

  /**
   * Starts a fresh online session right away (new HELLO — e.g. after signing in or out, so the
   * server switches between the guest and the account save). Online only; returns false otherwise.
   */
  reconnect(reason = 'auth') {
    if (this.kind !== 'ws' || this._stopped || !this.url || !this.WS) return false;
    this._clearTimers();
    this._closeWs();
    this.ready = false;
    this.online = false;
    this.reconnecting = true;
    this.reason = reason;
    this.attempt = 0;
    this._connectOnline();
    return true;
  }

  /** Tries the online server again (from the local world); falls back to local on failure. */
  retryOnline() {
    if (!this.url || !this.WS) return false;
    this._clearTimers();
    this.localConn?.close();
    this.localConn = null;
    this.ready = false;
    this.everOnline = false;
    this.attempt = 0;
    this._connectOnline();
    return true;
  }

  serverTime() {
    if (this.kind === 'local' && this.local) return this.local.now();
    return this.clock.serverTime(this.now());
  }

  get ping() {
    return this.kind === 'ws' ? Math.round(this.clock.rtt) : 0;
  }

  // ---------------------------------------------------------------- sending
  /** Sends a message; returns false when it was dropped (not connected / rate limit). */
  send(msg) {
    if (!msg || typeof msg.t !== 'string') return false;
    if (!this.ready) {
      if (QUEUED.has(msg.t) && this.queue.length < QUEUE_MAX) {
        this.queue.push(msg);
        return true;
      }
      this.stats.dropped++;
      return false;
    }
    if (this.kind === 'ws') {
      // position updates (lossy) never eat into the budget of actions and chat
      const reserve = msg.t === C.STATE ? 12 : 0;
      if (!this.bucket.take(this.now(), 1, reserve)) {
        this.stats.dropped++;
        return false;
      }
      return this._sendWs(msg);
    }
    if (this.kind === 'local' && this.localConn) {
      this.localConn.send(msg);
      this._sent(msg, 0);
      return true;
    }
    return false;
  }

  _sendWs(msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      const raw = encode(msg);
      ws.send(raw);
      this._sent(msg, raw.length);
      return true;
    } catch (err) {
      this.log.warn?.('[net] send failed', err);
      return false;
    }
  }

  _sent(msg, bytes) {
    this.stats.sent++;
    this.stats.bytesOut += bytes;
    this.onSent?.(msg);
  }

  _flushQueue() {
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.send(m);
  }

  // ---------------------------------------------------------------- online
  _connectOnline() {
    if (this._stopped) return;
    this.kind = 'ws';
    this.ready = false;
    this.online = false;
    this.fatal = null;
    this.waitVisible = false;
    this._status('connecting');
    let ws;
    try {
      ws = new this.WS(this.url);
    } catch (err) {
      this.log.warn?.('[net] cannot open socket', err?.message || err);
      this._onlineFailed('error');
      return;
    }
    this.ws = ws;
    let opened = false;
    this._timers.open = this.timers.setTimeout(() => {
      if (opened || this.ws !== ws) return;
      this._closeWs();
      this._onlineFailed('timeout');
    }, this.openTimeout);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      opened = true;
      this.timers.clearTimeout(this._timers.open);
      this._sendWs({ t: C.HELLO, v: PROTOCOL_VERSION, token: this.token || undefined, ...this.hello() });
      this._timers.welcome = this.timers.setTimeout(() => {
        if (this.ready || this.ws !== ws) return;
        this._closeWs();
        this._onlineFailed('no-welcome');
      }, this.welcomeTimeout);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      const raw = ev.data;
      this.stats.bytesIn += typeof raw === 'string' ? raw.length : raw?.byteLength || 0;
      const msg = decode(raw);
      if (msg) this._receive(msg);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.timers.clearTimeout(this._timers.open);
      this.timers.clearTimeout(this._timers.welcome);
      this._stopPing();
      const wasReady = this.ready;
      this.ready = false;
      this.online = false;
      if (this._stopped || this.kind !== 'ws') return;
      if (this.fatal) return;
      if (!opened || !wasReady) {
        this._onlineFailed(opened ? 'closed' : 'unreachable', ev?.code);
        return;
      }
      this.log.info?.(`[net] connection lost (${ev?.code ?? '?'}) — reconnecting`);
      this._scheduleReconnect('lost');
    };
  }

  _onlineFailed(reason) {
    if (this._stopped) return;
    if (!this.everOnline) {
      this.log.info?.(`[net] server unreachable (${reason}) — local world`);
      this._startLocal(reason);
    } else this._scheduleReconnect(reason);
  }

  _scheduleReconnect(reason) {
    if (this._stopped) return;
    this.reconnecting = true;
    this.reason = reason;
    if (this.isHidden()) {
      // a background tab reconnects when it is looked at again (no join/leave churn for others)
      this.waitVisible = true;
      this._status('connecting');
      return;
    }
    const base = this.backoff[Math.min(this.attempt, this.backoff.length - 1)];
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.attempt++;
    this.stats.reconnects++;
    this._status('connecting');
    this.timers.clearTimeout(this._timers.retry);
    this._timers.retry = this.timers.setTimeout(() => this._connectOnline(), delay);
  }

  _closeWs() {
    const ws = this.ws;
    this.ws = null;
    this._stopPing();
    if (!ws) return;
    try {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    } catch {
      /* ignore */
    }
  }

  _startPing() {
    this._stopPing();
    const ping = () => {
      if (this.ready && this.kind === 'ws') this._sendWs({ t: C.PING, ct: Math.round(this.now() * 10) / 10 });
    };
    ping();
    this._timers.ping = this.timers.setInterval(ping, PING_MS);
  }

  _stopPing() {
    if (this._timers.ping) this.timers.clearInterval(this._timers.ping);
    this._timers.ping = 0;
  }

  _clearTimers() {
    this.timers.clearTimeout(this._timers.open);
    this.timers.clearTimeout(this._timers.welcome);
    this.timers.clearTimeout(this._timers.retry);
    this._stopPing();
  }

  // ---------------------------------------------------------------- local
  _startLocal(reason) {
    if (this._stopped) return;
    if (!this.createLocal) {
      this._noWorld(reason);
      return;
    }
    this.kind = 'local';
    this.online = false;
    this.ready = false;
    this.reconnecting = false;
    this.reason = reason;
    try {
      this.local = this.local || this.createLocal();
      this.localConn?.close();
      this.localConn = this.local.connect((msg) => {
        this.stats.received++;
        this._receive(msg);
      });
    } catch (err) {
      this.log.error?.('[net] local server failed to start', err);
      this.local = null;
      this._noWorld(reason);
      return;
    }
    this._status('connecting');
    this.localConn.send({ t: C.HELLO, v: PROTOCOL_VERSION, ...this.hello() });
  }

  /** Neither the server nor a local world is available: plain single-player (mode 'off'). */
  _noWorld(reason) {
    this.kind = null;
    this.online = false;
    this.ready = false;
    this.reconnecting = false;
    this.reason = reason;
    this._status('off');
  }

  // ---------------------------------------------------------------- receive
  _receive(msg) {
    if (this.kind === 'ws') this.stats.received++;
    switch (msg.t) {
      case S.WELCOME: {
        this.ready = true;
        this.fatal = null;
        this.welcome = msg;
        this.id = msg.you?.id ?? this.id;
        // only the online server issues guest tokens (the local world's is a placeholder)
        if (this.kind === 'ws' && typeof msg.you?.token === 'string' && msg.you.token) this.token = msg.you.token;
        this.name = msg.you?.name ?? this.name;
        if (this.kind === 'ws') {
          this.online = true;
          if (this.everOnline) this.stats.reconnects = Math.max(0, this.stats.reconnects);
          this.everOnline = true;
          this.attempt = 0;
          this.reconnecting = false;
          this.timers.clearTimeout(this._timers.welcome);
          this.clock.reset();
          this._startPing();
          this._status('online');
        } else this._status('local');
        this.onMessage(msg);
        this._flushQueue();
        return;
      }
      case S.PONG:
        if (this.kind === 'ws') this.clock.sample(Number(msg.ct), Number(msg.st), this.now());
        break;
      case S.SNAP:
        // until the first pong: server time ≈ snapshot time + ~one-way latency
        if (this.kind === 'ws' && !this.clock.synced) this.clock.hint(Number(msg.st), this.now() - 40);
        break;
      case S.ERROR: {
        const code = String(msg.code || 'error');
        this.log.warn?.(`[net] server error: ${code} ${msg.msg || ''}`);
        if (this.kind === 'ws' && code === 'replaced') {
          // the same player joined from another tab/device: stay out instead of fighting over it
          this.fatal = code;
          this.reason = code;
          this.onMessage(msg);
          this._closeWs();
          this.ready = false;
          this.online = false;
          this.reconnecting = false;
          this._status('offline');
          return;
        }
        if (this.kind === 'ws' && (FATAL_LOCAL.has(code) || (!this.ready && code !== 'shutdown' && code !== 'server'))) {
          this.fatal = code;
          this.onMessage(msg);
          this._closeWs();
          this.ready = false;
          this.online = false;
          this.everOnline = false;
          this._startLocal(code);
          return;
        }
        break;
      }
      default:
        break;
    }
    this.onMessage(msg);
  }

  _status(mode) {
    this.mode = mode;
    try {
      this.onStatus({ mode, online: this.online, ready: this.ready, reconnecting: this.reconnecting, attempt: this.attempt, reason: this.reason, kind: this.kind });
    } catch (err) {
      this.log.error?.('[net] status listener failed', err);
    }
  }
}
