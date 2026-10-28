import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Project root (server/..) — used to resolve the default static dir. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

/**
 * Server configuration from env + argv (PLATFORM.md §5).
 *
 *   PORT (8080) · HOST (0.0.0.0, or 127.0.0.1 with --local) · DATA_DIR (./data)
 *   DATABASE_URL (Postgres; wins over DATA_DIR for the store) · STATIC_DIR (dist)
 *   ALLOWED_ORIGINS (comma list; default same host) · LOG_LEVEL (info)
 *   LOG_FORMAT (json | pretty; default pretty on a TTY) · SIM (auto | real | stub)
 *   WORLDGEN (auto | worldgen | standin | hub) · WORLD_SEED (procedural world seed; new worlds only)
 *   TRUST_PROXY (1 = use X-Forwarded-For for per-IP limits; default on unless --local)
 *   WS_DEFLATE (1 = permessage-deflate on, default 1) · TERRAIN_CACHE_DIR (DATA_DIR/cache)
 *   AUTOSAVE_MS (30000) · IDLE_TIMEOUT_MS (60000) · HEARTBEAT_MS (20000) · MAX_CONNS_PER_IP (16)
 *
 * Relative paths resolve against the current directory (Docker WORKDIR /app,
 * `npm run server` → project root).
 */
export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const local = argv.includes('--local') || env.LOCAL === '1';
  const resolve = (p, def) => path.resolve(p || def);
  return {
    local,
    port: int(env.PORT, 8080),
    host: env.HOST || (local ? '127.0.0.1' : '0.0.0.0'),
    // a Railway volume announces its mount path; DATA_DIR wins when both are set
    dataDir: resolve(env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH, './data'),
    terrainCacheDir: env.TERRAIN_CACHE_DIR ? path.resolve(env.TERRAIN_CACHE_DIR) : null, // default DATA_DIR/cache
    databaseUrl: env.DATABASE_URL || '',
    staticDir: resolve(env.STATIC_DIR, 'dist'),
    allowedOrigins: (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, '').toLowerCase())
      .filter(Boolean),
    logLevel: (env.LOG_LEVEL || 'info').toLowerCase(),
    logFormat: env.LOG_FORMAT || (process.stdout.isTTY ? 'pretty' : 'json'),
    sim: env.SIM || 'auto',
    // world beyond the hub: auto = shared/worldgen, else the shared/sim stand-in; or force 'worldgen' | 'standin' | 'hub'
    worldgen: env.WORLDGEN || 'auto',
    // procedural-world seed (default WORLD.seed from src/world/layout.js). Only for a NEW world: saved
    // bases sit on the terrain of the seed they were built on, and clients use welcome.world.seed.
    worldSeed: env.WORLD_SEED || null,
    trustProxy: env.TRUST_PROXY != null ? env.TRUST_PROXY === '1' : !local,
    deflate: env.WS_DEFLATE !== '0',
    autosaveMs: int(env.AUTOSAVE_MS, 30_000),
    idleTimeoutMs: int(env.IDLE_TIMEOUT_MS, 60_000),
    heartbeatMs: int(env.HEARTBEAT_MS, 20_000),
    maxConnsPerIp: int(env.MAX_CONNS_PER_IP, 16),
    shutdownGraceMs: int(env.SHUTDOWN_GRACE_MS, 8_000),
    version: (env.RAILWAY_GIT_COMMIT_SHA || env.GIT_SHA || '').slice(0, 12) || null,
  };
}
