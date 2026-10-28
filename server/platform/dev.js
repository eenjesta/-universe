#!/usr/bin/env node
/**
 * Standalone dev runner for the platform API (before / without the game server):
 *
 *   node server/platform/dev.js --port 8095 [--host 127.0.0.1] [--data /tmp/data-platform] [--static /tmp/build] [--demo]
 *
 * env: PORT, HOST, DATA_DIR (default ./data), DATABASE_URL (Postgres instead of JSON files), STATIC_DIR,
 *      ALLOWED_ORIGINS (comma list), LOG_LEVEL. Loopback origins are allowed (Vite dev on :5199 etc.).
 *
 * Serves /api/* (platform.handle), GET /healthz, and — with --static/STATIC_DIR — the built client
 * (so a page can call /api same-origin). --demo seeds two demo accounts with published experiences
 * and a friendship (password for both: demo-password-1) when they don't exist yet:
 *   demo_builder (3 experiences) · demo_friend
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createPlatform } from './index.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const port = Number(arg('port', process.env.PORT || 8095));
const host = String(arg('host', process.env.HOST || '127.0.0.1'));
const dataDir = path.resolve(String(arg('data', process.env.DATA_DIR || './data')));
const staticArg = arg('static', process.env.STATIC_DIR || '');
const staticDir = staticArg && staticArg !== true ? path.resolve(String(staticArg)) : '';
const demo = !!arg('demo', false);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
};

const platform = createPlatform({
  dataDir,
  databaseUrl: process.env.DATABASE_URL || '',
  allowLocalOrigins: true,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
});

async function serveStatic(req, res) {
  if (!staticDir) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('platform dev runner: no STATIC_DIR (try /api/status)');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (rel.includes('\0')) {
    res.writeHead(400);
    return res.end();
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(staticDir, path.posix.normalize(rel).replace(/^(\.\.(\/|$))+/, ''));
  if (file !== staticDir && !file.startsWith(staticDir + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  let st = null;
  try {
    st = await fsp.stat(file);
  } catch {}
  if (!st || !st.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

const server = http.createServer((req, res) => {
  if (platform.handle(req, res)) return;
  if ((req.url || '').split('?')[0] === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: platform.state === 'ready', platform: platform.state, store: platform.store?.kind || null }));
  }
  serveStatic(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

/** Seed demo accounts/experiences through the public API (idempotent). */
async function seedDemo(base) {
  const call = async (method, url, body, token) => {
    const r = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const account = async (username) => {
    let r = await call('POST', '/api/auth/login', { username, password: 'demo-password-1' });
    if (r.status === 200) return { token: r.body.token, fresh: false };
    r = await call('POST', '/api/auth/register', { username, password: 'demo-password-1', birthYear: 1995 });
    if (r.status !== 201) throw new Error(`demo register ${username}: ${JSON.stringify(r.body)}`);
    return { token: r.body.token, fresh: true };
  };
  const builder = await account('demo_builder');
  const friend = await account('demo_friend');
  if (builder.fresh) {
    const tower = (n, color) =>
      Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: i % 5 === 4 ? 'cylinder' : 'block', p: [0, 1 + i * 2, 0], s: [6 - (i % 3), 2, 6 - (i % 3)], color, material: i % 2 ? 'metal' : 'plastic' }));
    const worlds = [
      { title: 'Neon Obby', description: 'Jump across glowing platforms to the top.', sky: 'night', parts: [{ id: 'spawn', type: 'spawn', p: [0, 0.5, 0], s: [6, 1, 6], color: '#44e0ff', material: 'neon' }, ...Array.from({ length: 24 }, (_, i) => ({ id: `n${i}`, type: 'block', p: [Math.sin(i) * 12, 2 + i * 1.5, i * 6], s: [4, 1, 4], color: i % 2 ? '#ff4fd8' : '#44e0ff', material: 'neon' }))] },
      { title: 'Golden Tower', description: 'A calm climb at golden hour.', sky: 'golden', parts: [{ id: 'spawn', type: 'spawn', p: [0, 0.5, -10], s: [6, 1, 6], color: '#ffd27a', material: 'neon' }, ...tower(30, '#e8c27a')] },
      { title: 'Ice Rink', description: 'Slide around on a frozen lake.', sky: 'day', parts: [{ id: 'spawn', type: 'spawn', p: [0, 0.5, 0], s: [6, 1, 6], color: '#ffffff', material: 'neon' }, { id: 'ice', type: 'block', p: [0, 0.1, 30], s: [80, 0.2, 60], color: '#bfe8ff', material: 'ice' }, { id: 'sign', type: 'text', p: [0, 6, 10], s: [8, 2, 0.2], color: '#ffffff', props: { text: 'Welcome to the rink!' } }] },
    ];
    for (const w of worlds) {
      const data = { format: 'o-universe-experience', v: 1, meta: { title: w.title, description: w.description, maxPlayers: 20 }, settings: { time: 17.6, sky: w.sky, gravity: 1, baseplate: { size: 512, color: '#3a3f47', material: 'concrete' } }, parts: w.parts, groups: [], logic: [] };
      const c = await call('POST', '/api/experiences', { data }, builder.token);
      if (c.status !== 201) throw new Error(`demo create: ${JSON.stringify(c.body)}`);
      await call('POST', `/api/experiences/${c.body.experience.id}/publish`, {}, builder.token);
      await call('POST', `/api/experiences/${c.body.experience.id}/play`, {}, friend.token);
    }
  }
  const req = await call('POST', '/api/friends/request', { username: 'demo_friend' }, builder.token);
  if (req.status === 201) await call('POST', '/api/friends/accept', { username: 'demo_builder' }, friend.token);
  console.log('[platform-dev] demo accounts ready: demo_builder / demo_friend (password demo-password-1)');
}

server.listen(port, host, async () => {
  const actual = server.address().port;
  console.log(`[platform-dev] http://${host}:${actual}  data=${process.env.DATABASE_URL ? 'postgres' : dataDir}${staticDir ? `  static=${staticDir}` : ''}`);
  await platform.ready;
  if (demo) seedDemo(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual}`).catch((err) => console.error('[platform-dev] demo seed failed', err));
});

let stopping = false;
async function stop(sig) {
  if (stopping) return;
  stopping = true;
  console.log(`[platform-dev] ${sig}: shutting down`);
  server.close();
  await platform.close().catch((err) => console.error(err));
  process.exit(0);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
