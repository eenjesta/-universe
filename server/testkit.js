/**
 * Test helpers for server/*.test.js (not a test file itself): start a server on
 * a random port with a temp DATA_DIR, and small WebSocket clients that queue
 * messages and can wait for one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { loadConfig } from './config.js';
import { startServer } from './app.js';
import { createLogger } from './log.js';

export const TERRAIN_CACHE = path.join(os.tmpdir(), 'o-universe-test-terrain');

export function tempDir(prefix = 'ou-server-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Starts a server; `env` overrides (DATA_DIR, SIM, STATIC_DIR …), `extra` patches the config object. */
export async function boot(env = {}, extra = {}) {
  const lines = [];
  const config = {
    ...loadConfig(['--local'], { PORT: '0', LOG_FORMAT: 'json', TERRAIN_CACHE_DIR: TERRAIN_CACHE, ...env }),
    ...extra,
  };
  const log = createLogger({ level: process.env.TEST_LOG || 'warn', format: 'pretty', write: (l) => (process.env.TEST_LOG ? console.log(l) : lines.push(l)) });
  const app = await startServer(config, { log });
  app.wsUrl = app.url.replace('http', 'ws') + '/ws';
  app.lines = lines;
  return app;
}

/**
 * A WebSocket client with a message queue. `deflate: false` turns permessage-deflate off: with it on
 * (the default, like browsers) every client frame is compressed, and on a busy machine the async
 * zlib round trips spread a burst of frames over seconds (timing-sensitive tests use false).
 */
export function client(url, { headers, origin, deflate = true } = {}) {
  const ws = new WebSocket(url, { headers, origin, perMessageDeflate: deflate });
  const c = {
    ws,
    msgs: [],
    waiters: [],
    closed: null,
    send: (m) => ws.send(JSON.stringify(m)),
    /** Resolves with the first message (already received or future) matching `pred`. */
    wait(pred, ms = 4000, from = 0) {
      const p = typeof pred === 'string' ? (m) => m.t === pred : pred;
      for (let i = from; i < c.msgs.length; i++) if (p(c.msgs[i])) return Promise.resolve(c.msgs[i]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = c.waiters.indexOf(w);
          if (i >= 0) {
            c.waiters.splice(i, 1);
            reject(new Error(`timeout waiting for message (have: ${c.msgs.map((m) => m.t).join(',')})`));
          }
        }, ms);
        const w = {
          p,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        };
        c.waiters.push(w);
      });
    },
    /** Only messages that arrive after this call. */
    next(pred, ms = 4000) {
      return c.wait(pred, ms, c.msgs.length);
    },
    opened: new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
      ws.once('unexpected-response', (req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    }),
    closedP: null,
    close() {
      ws.close();
      return c.closedP;
    },
  };
  c.closedP = new Promise((resolve) => {
    ws.on('close', (code, reason) => {
      c.closed = { code, reason: String(reason) };
      resolve(c.closed);
    });
  });
  ws.on('error', () => {});
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    c.msgs.push(m);
    for (const w of [...c.waiters]) {
      if (w.p(m)) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  return c;
}

/** Connects, sends hello and waits for the welcome. */
export async function join(app, hello = {}, opts = {}) {
  const c = client(app.wsUrl, opts);
  await c.opened;
  c.send({ t: 'hello', v: 1, name: 'Tester', lang: 'en', appearance: { body: 'm', skin: '#c68e67' }, ...hello });
  c.welcome = await c.wait((m) => m.t === 'welcome' || m.t === 'error');
  return c;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
