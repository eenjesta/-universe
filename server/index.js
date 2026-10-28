#!/usr/bin/env node
/**
 * Ø Universe game service — `node server/index.js [--local]` (PLATFORM.md §3, §5).
 *
 * One process serves the built client (STATIC_DIR, default dist/), the game
 * WebSocket (/ws, one persistent hub world with shared/sim authoritative),
 * /healthz and — when server/platform exists — the platform API under /api.
 *
 * Env: PORT (8080) · HOST (0.0.0.0; 127.0.0.1 with --local) · DATA_DIR (./data)
 *      DATABASE_URL (Postgres store; wins over the JSON files) · STATIC_DIR (dist)
 *      ALLOWED_ORIGINS (comma list) · LOG_LEVEL (debug|info|warn|error) · LOG_FORMAT (json|pretty)
 *      SIM (auto|real|stub) · see server/config.js for the rest.
 * Modules: config · log · http (static + gzip/br + /healthz) · transport (ws) ·
 *          hub (sessions, tick, snapshots, chat, saves) · schema · filter ·
 *          terrain (baked heights, cached in DATA_DIR/cache) · store/ (json | pg) · sim (loader) · simstub
 *
 * SIGTERM / SIGINT → final save of the world and every online player, clients
 * get S.ERROR {code:'shutdown'} and a 1012 close, then the process exits.
 */
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { startServer } from './app.js';

const config = loadConfig();
const log = createLogger({ level: config.logLevel, format: config.logFormat });

let app = null;
let stopping = 0; // time of the first signal

// `npm run server` + Ctrl+C, `timeout`, process managers: the same signal often arrives twice within
// milliseconds (the terminal signals the whole process group AND npm forwards it to us). Only a
// deliberate repeat (≥ 1.5 s later, e.g. a second Ctrl+C) skips the final save and exits at once.
const REPEAT_MS = 1500;

async function stop(signal, code = 0) {
  if (stopping) {
    if (signal === 'crash' || Date.now() - stopping < REPEAT_MS) return;
    log.warn('second signal — exiting now (final save skipped)', { signal });
    process.exit(1);
  }
  stopping = Date.now();
  const hard = setTimeout(() => {
    log.error('shutdown took too long — exiting');
    process.exit(1);
  }, config.shutdownGraceMs + 4000);
  hard.unref();
  try {
    await app?.shutdown(signal);
  } catch (err) {
    log.error('shutdown failed', { err });
  }
  process.exit(code);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }));
process.on('uncaughtException', (err) => {
  // state may be inconsistent now: save what we can and let the platform restart us
  log.error('uncaught exception — saving and exiting', { err });
  stop('crash', 1);
});

try {
  app = await startServer(config, { log });
} catch (err) {
  log.error('server failed to start', { err, port: config.port, host: config.host });
  process.exit(1);
}
