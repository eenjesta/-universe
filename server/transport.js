import { WebSocketServer } from 'ws';
import { NET, decode } from '../shared/protocol.js';
import { TokenBucket } from './ratelimit.js';
import { validate } from './schema.js';
import { CLOSE } from './world.js';

/**
 * WebSocket transport on `/ws` (ws library) in front of the world instance:
 *   - upgrade checks: path, Origin (ALLOWED_ORIGINS, the same host, or any
 *     localhost origin with --local for the Vite /ws proxy), per-IP connection
 *     cap, a global connection cap
 *   - maxPayload 16 kB (ws closes 1009 on bigger frames), optional permessage-deflate
 *   - heartbeat: ws ping every HEARTBEAT_MS, terminate when the previous ping got no pong
 *   - idle: no message for IDLE_TIMEOUT_MS → S.ERROR {code:'idle'} + close; no hello within 15 s → close
 *   - per-connection rate limit (NET.MSG_RATE token bucket; excess is dropped) and
 *     schema checks; repeated violations close the socket (1008)
 *   - every handler runs in try/catch: a bad message never takes the server down
 */
const HELLO_TIMEOUT_MS = 15_000;
const VIOLATIONS = { burst: 120, perSec: 2 };

export function attachTransport({ server, world, log, config, metrics = {} }) {
  const M = (metrics.ws = { connections: 0, accepted: 0, rejected: 0, msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, dropped: 0, invalid: 0 });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
    clientTracking: true,
    perMessageDeflate: config.deflate
      ? {
          threshold: 512,
          serverMaxWindowBits: 13,
          concurrencyLimit: 8,
          zlibDeflateOptions: { level: 4, memLevel: 7 },
        }
      : false,
  });
  const perIp = new Map();
  let seq = 0;

  function clientIp(req) {
    if (config.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      if (xff) return String(xff).split(',')[0].trim();
    }
    return req.socket.remoteAddress || '?';
  }

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser (tests, bots): the Origin check only stops cross-site pages
    let o;
    try {
      o = new URL(origin);
    } catch {
      return false;
    }
    const norm = `${o.protocol}//${o.host}`.toLowerCase();
    if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(norm)) return true;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (host && o.host.toLowerCase() === host) return true;
    if (config.local && (o.hostname === 'localhost' || o.hostname === '127.0.0.1' || o.hostname === '[::1]')) return true;
    return false;
  }

  function reject(socket, status, text) {
    M.rejected++;
    try {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`);
    } catch {}
    socket.destroy();
  }

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    try {
      const path = (req.url || '').split('?')[0];
      if (path !== '/ws') return reject(socket, 404, 'Not Found');
      if (!originAllowed(req)) {
        log.warn('ws origin rejected', { origin: req.headers.origin, host: req.headers.host });
        return reject(socket, 403, 'Forbidden');
      }
      const ip = clientIp(req);
      if ((perIp.get(ip) || 0) >= config.maxConnsPerIp) return reject(socket, 429, 'Too Many Connections');
      if (wss.clients.size >= NET.MAX_PLAYERS_PER_WORLD + 50) return reject(socket, 503, 'Service Unavailable');
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req, ip));
    } catch (err) {
      log.error('upgrade failed', { err });
      socket.destroy();
    }
  });

  function onConnection(ws, req, ip) {
    M.accepted++;
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    const now = Date.now();
    const conn = {
      id: ++seq,
      ip,
      ws,
      closed: false,
      alive: true,
      openedAt: now,
      lastMsgAt: now,
      bucket: new TokenBucket(NET.MSG_RATE, now),
      violations: new TokenBucket(VIOLATIONS, now),
      get bufferedAmount() {
        return ws.bufferedAmount;
      },
      send(str) {
        if (conn.closed || ws.readyState !== 1) return;
        M.msgsOut++;
        M.bytesOut += str.length;
        ws.send(str, (err) => {
          if (err) log.debug('ws send failed', { conn: conn.id, err: err.message });
        });
      },
      close(code = 1000, reason = '') {
        if (conn.closed) return;
        conn.closed = true;
        try {
          ws.close(code, reason);
        } catch {}
        // a peer that never completes the close handshake
        setTimeout(() => ws.terminate(), 3000).unref?.();
      },
    };
    ws._conn = conn;
    M.connections = wss.clients.size;
    const session = world.connect(conn);
    conn.session = session;
    log.debug('ws open', { conn: conn.id, ip, ua: String(req.headers['user-agent'] || '').slice(0, 80) });

    const helloTimer = setTimeout(() => {
      if (!session.joined && !session.helloing && !conn.closed) world.fatal(session, 'hello');
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref?.();

    function violation(why, t) {
      M.invalid++;
      log.throttle(`violation:${conn.id}`, 10_000).debug('invalid message', { conn: conn.id, why, t });
      if (!conn.violations.take(Date.now())) {
        log.warn('too many invalid messages, closing', { conn: conn.id, ip, id: session.id });
        world.fatal(session, 'protocol');
      }
    }

    ws.on('message', (data, isBinary) => {
      if (conn.closed) return;
      const t = Date.now();
      conn.lastMsgAt = t;
      M.msgsIn++;
      M.bytesIn += data.length;
      if (isBinary) return violation('binary');
      if (!conn.bucket.take(t)) {
        M.dropped++;
        return violation('rate');
      }
      const msg = decode(data.toString());
      if (!msg) return violation('json');
      const bad = validate(msg);
      if (bad) return violation(bad, msg.t);
      try {
        world.message(session, msg);
      } catch (err) {
        log.throttle(`msg:${msg.t}`, 10_000).error('message handler failed', { err, t: msg.t });
      }
    });
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('error', (err) => log.debug('ws error', { conn: conn.id, err: err.message }));
    ws.on('close', (code) => {
      conn.closed = true;
      clearTimeout(helloTimer);
      const n = (perIp.get(ip) || 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
      M.connections = wss.clients.size;
      try {
        world.disconnect(session);
      } catch (err) {
        log.error('disconnect failed', { err });
      }
      log.debug('ws close', { conn: conn.id, code, id: session.id });
    });
  }

  // heartbeat + idle sweep
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      const c = ws._conn;
      if (!c) continue;
      if (!c.alive) {
        log.debug('heartbeat lost, terminating', { conn: c.id });
        ws.terminate();
        continue;
      }
      if (now - c.lastMsgAt > config.idleTimeoutMs) {
        if (c.session) world.fatal(c.session, 'idle');
        else c.close(CLOSE.idle, 'idle');
        continue;
      }
      c.alive = false;
      try {
        ws.ping();
      } catch {}
    }
  }, Math.min(config.heartbeatMs, config.idleTimeoutMs / 2));
  sweep.unref?.();

  return {
    wss,
    close() {
      clearInterval(sweep);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
