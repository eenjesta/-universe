/**
 * Test helpers for server/platform/*.test.js (not a test file itself).
 *
 *   const k = await startPlatform({ store: 'json' | 'pg-fake' | 'pg' });
 *   const { status, body } = await k.call('POST', '/api/auth/register', {...}, { token });
 *   const alice = await k.register('alice_1');      // → { token, user }
 *   k.clock.advance(ms)                              // platform time (sessions, presence, rate limits)
 *   await k.stop();
 *
 * STORE_KINDS = ['json', 'pg-fake'] (+ 'pg' when TEST_DATABASE_URL points at a real Postgres;
 * tables then get a unique prefix and are dropped by stop()).
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createPlatform } from './index.js';
import { createFakePool } from './fake-pg.js';

export const FAST_SCRYPT = { N: 1024, r: 8, p: 1 };
export const LOOSE = { burst: 1e9, perSec: 1e9 };
export const LOOSE_LIMITS = Object.fromEntries(
  ['ip', 'auth', 'register', 'loginName', 'write', 'create', 'save', 'publish', 'friends', 'report', 'like', 'play'].map((k) => [k, LOOSE]),
);
export const STORE_KINDS = ['json', 'pg-fake', ...(process.env.TEST_DATABASE_URL ? ['pg'] : [])];
export const YEAR = new Date().getUTCFullYear();

export function makeClock(start = Date.now()) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => (t += ms);
  now.set = (v) => (t = v);
  return now;
}

export function quietLog() {
  const lines = [];
  const rec = (level) => (msg, fields) => lines.push({ level, msg, fields });
  return { debug: () => {}, info: rec('info'), warn: rec('warn'), error: rec('error'), lines };
}

export async function tempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ou-platform-test-'));
}

let prefixSeq = 0;

export async function startPlatform({ store = 'json', limits = {}, clock = makeClock(), dataDir, ...opts } = {}) {
  const dir = dataDir || (await tempDir());
  let pgPool;
  let tablePrefix;
  let realPool = null;
  if (store === 'pg-fake') pgPool = createFakePool();
  if (store === 'pg') {
    const pg = (await import('pg')).default;
    realPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3 });
    pgPool = realPool;
    tablePrefix = `t${Date.now().toString(36)}${prefixSeq++}_`;
  }
  const log = quietLog();
  const platform = createPlatform({ dataDir: dir, pgPool, tablePrefix, scrypt: FAST_SCRYPT, limits: { ...LOOSE_LIMITS, ...limits }, log, now: clock, sweepMs: 0, ...opts });
  await platform.ready;
  const server = http.createServer((req, res) => {
    if (!platform.handle(req, res)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not api');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, url, body, { token, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    let payload;
    if (body !== undefined) {
      payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
      if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    }
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await fetch(base + url, { method, headers: h, body: payload });
    if (raw) return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: r.status, body: json, text, headers: r.headers };
  }

  async function register(username, extra = {}) {
    const r = await call('POST', '/api/auth/register', { username, password: 'correct-horse-9', birthYear: 1990, ...extra });
    if (r.status !== 201) throw new Error(`register ${username} failed: ${r.status} ${r.text}`);
    return r.body;
  }

  async function stop() {
    await new Promise((r) => server.close(r));
    await platform.close();
    if (realPool) {
      for (const t of ['reports', 'likes', 'experience_versions', 'experiences', 'friends', 'sessions', 'users']) {
        await realPool.query(`DROP TABLE IF EXISTS ${tablePrefix}${t} CASCADE`).catch(() => {});
      }
      await realPool.end();
    }
    if (!dataDir) await fsp.rm(dir, { recursive: true, force: true });
  }

  return { platform, base, call, register, stop, dir, clock, log, pgPool, store: platform.store };
}

/** A tiny valid JPEG (1×1) as a data URL. */
export const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';

/** An experience document with `n` block parts. */
export function sampleExperience(n = 3, extra = {}) {
  return {
    format: 'o-universe-experience',
    v: 1,
    meta: { title: 'Sample', description: 'A sample world', maxPlayers: 10 },
    settings: { time: 12, sky: 'day', gravity: 1, baseplate: { size: 256, color: '#3a3f47', material: 'concrete' } },
    parts: [
      { id: 'spawn', type: 'spawn', name: 'Spawn', p: [0, 0.5, 0], r: [0, 0, 0], s: [6, 1, 6], color: '#44e0ff', material: 'neon', anchored: true, collide: true, transparency: 0, group: null, props: {} },
      ...Array.from({ length: n - 1 }, (_, i) => ({ id: `b${i}`, type: 'block', name: `Block ${i}`, p: [i * 4, 1, 0], r: [0, 0, 0], s: [4, 1, 2], color: '#ffffff', material: 'plastic', anchored: true, collide: true, transparency: 0, group: null, props: {} })),
    ],
    groups: [],
    logic: [],
    ...extra,
  };
}
