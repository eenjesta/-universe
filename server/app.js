import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { NET, PROTOCOL_VERSION } from '../shared/protocol.js';
import { createLogger } from './log.js';
import { createHttpHandler } from './http.js';
import { createStore } from './store/index.js';
import { loadTerrain } from './terrain.js';
import { loadWorldgen } from './worldgen.js';
import { createWorld } from './world.js';
import { attachTransport } from './transport.js';
import { loadSim } from './sim.js';

const PLATFORM_ENTRY = new URL('./platform/index.js', import.meta.url);

async function dirWritable(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    await fsp.writeFile(probe, 'ok');
    await fsp.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Boots the whole game service and returns a handle:
 *   hub terrain (cached bake) → world provider (shared/worldgen | stand-in, §11) →
 *   store (Postgres | JSON) → sim + world instance → http (static, /healthz,
 *   /api → server/platform when present) → WebSocket /ws → listen → tick loop.
 *
 * `startServer(loadConfig())` is what server/index.js runs; tests call it with
 * port 0 and a temp DATA_DIR. Extra test knobs: config.terrain = 'flat' (skip
 * the bake), config.worldgen ('auto' | 'worldgen' | 'standin'), opts.log (custom logger).
 *
 * @returns {Promise<{ port, url, world, hub (= world, old name), store, server, metrics, health, shutdown(reason), config, provider, platform (null when /api is off) }>}
 */
export async function startServer(config, opts = {}) {
  const log = opts.log || createLogger({ level: config.logLevel, format: config.logFormat });
  const t0 = performance.now();
  const startedAt = Date.now();
  const metrics = {};

  // server clock: epoch-based but monotonic (immune to wall-clock jumps)
  const base = Date.now() - performance.now();
  const clock = { now: () => Math.floor(base + performance.now()) };

  let seed = 'o-universe';
  try {
    seed = (await import('../src/world/layout.js')).WORLD.seed || seed;
  } catch (err) {
    log.warn('world layout not importable, using the default seed', { err: err.message });
  }
  if (config.worldSeed) seed = config.worldSeed;

  const writable = await dirWritable(config.dataDir);
  if (!writable && !config.databaseUrl) {
    throw new Error(
      `DATA_DIR ${config.dataDir} is not writable by uid ${process.getuid?.()} — saves would be lost. ` +
        'Fix the permissions, mount a volume there (Railway: also set RAILWAY_RUN_UID=0), or set DATABASE_URL.',
    );
  }
  if (!writable) log.warn('DATA_DIR not writable — terrain cache goes to the temp dir', { dataDir: config.dataDir });
  const cacheDir = config.terrainCacheDir || (writable ? path.join(config.dataDir, 'cache') : path.join(os.tmpdir(), 'o-universe-cache'));
  const terrain = await loadTerrain({ cacheDir, log, flat: config.terrain === 'flat' });
  const provider = await loadWorldgen({ hub: terrain, seed, log, waterLevel: terrain.waterLevel, mode: config.worldgen || 'auto' });
  const store = await createStore({ databaseUrl: config.databaseUrl, dataDir: config.dataDir, log });
  const sim = await loadSim(config.sim, log);

  // ------------------------------------------------------------ platform layer (accounts / friends / experiences)
  let platform = null;
  if (config.platform !== false && fs.existsSync(PLATFORM_ENTRY)) {
    try {
      const mod = await import(PLATFORM_ENTRY.href);
      platform = await mod.createPlatform({
        dataDir: config.dataDir,
        databaseUrl: config.databaseUrl,
        log: log.child({ mod: 'platform' }),
        allowedOrigins: config.allowedOrigins,
        allowLocalOrigins: config.local,
        trustProxy: config.trustProxy,
      });
      log.info('platform API mounted at /api');
    } catch (err) {
      log.error('platform layer failed to start — /api disabled', { err });
      platform = null;
    }
  }
  // friends see signed-in players 'in-game'; guests count towards the flagship's "playing" number
  const presence = platform?.setPresence
    ? (event, s) => {
        const id = s.userId || (s.id ? `guest:${s.id}` : null);
        if (!id) return;
        Promise.resolve(platform.setPresence(id, event === 'online' ? 'in-game' : 'offline')).catch((err) => log.debug('presence failed', { err: err.message }));
      }
    : null;
  const resolveAccount = platform?.resolveToken ? (token) => platform.resolveToken(token) : null;

  const world = await createWorld({ simFactory: sim.createSim, provider, store, log, clock, seed, config, metrics, presence, resolveAccount });

  // ------------------------------------------------------------ http + ws
  const health = () => {
    const mem = process.memoryUsage();
    const h = metrics.world;
    return {
      ok: true,
      players: world.players,
      uptime: Math.round((Date.now() - startedAt) / 1000),
      version: config.version || undefined,
      protocol: PROTOCOL_VERSION,
      max: NET.MAX_PLAYERS_PER_WORLD,
      sim: sim.kind,
      store: store.kind,
      terrain: terrain.source,
      gen: provider.source,
      world: world.stats(),
      tick: { hz: NET.TICK_HZ, avgMs: Math.round(h.tickMsAvg * 100) / 100, maxMs: Math.round(h.tickMsMax * 100) / 100, ticks: h.ticks, resyncs: h.resyncs, simErrors: h.simErrors },
      net: { ...metrics.ws, snaps: h.snaps, snapsSkipped: h.snapsSkipped, routed: h.routed, chat: h.chat, joins: h.joins, leaves: h.leaves, helloMsAvg: Math.round(h.helloMsAvg), helloMsMax: h.helloMsMax },
      saves: { count: h.saves, errors: h.saveErrors, lastMs: h.lastSaveMs, lastAt: h.lastSaveAt || null },
      http: metrics.http,
      memory: { rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576) },
    };
  };
  const handler = createHttpHandler({ staticDir: config.staticDir, log, health, metrics, api: platform?.handle ? (req, res) => platform.handle(req, res) : null });
  const server = http.createServer(handler);
  server.keepAliveTimeout = 65_000; // longer than typical proxy idle timeouts (Railway, nginx)
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;
  const transport = attachTransport({ server, world, log, config, metrics });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.on('error', (err) => log.error('http server error', { err }));
  const port = server.address().port;
  world.start();
  const url = `http://${config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host}:${port}`;
  log.info('Ø Universe server listening', {
    url,
    ws: `${url.replace('http', 'ws')}/ws`,
    bootMs: Math.round(performance.now() - t0),
    sim: sim.kind,
    gen: provider.source,
    store: store.kind,
    staticDir: config.staticDir,
  });
  // pre-compress the client bundles in the background
  const warm = setTimeout(() => handler.warm().then((n) => log.debug('static cache warm', { files: n })), 500);
  warm.unref?.();

  let closing = null;
  async function shutdown(reason = 'shutdown') {
    if (closing) return closing;
    closing = (async () => {
      clearTimeout(warm);
      await world.shutdown(reason, { graceMs: config.shutdownGraceMs });
      // let the close frames go out, then stop everything
      await new Promise((r) => setTimeout(r, 150));
      transport.close();
      await new Promise((r) => {
        server.close(() => r());
        server.closeAllConnections?.();
      });
      await platform?.close?.()?.catch?.(() => {});
      await store.close().catch((err) => log.warn('store close failed', { err }));
      log.info('server stopped', { reason });
    })();
    return closing;
  }

  return { port, url, world, hub: world, store, server, metrics, health, shutdown, config, provider, platform };
}
