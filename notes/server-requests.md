# server (server/**, Dockerfile, railway.json, docs/DEPLOY.md) — requests & integration notes

Owner: server engineer. Entry: `server/index.js` (header lists every module). Deploy: `docs/DEPLOY.md`.
Tests: `node --test server/*.test.js` (game server, 20 tests) · `node --test server/platform/` (platform API).

## Running your own server for online tests (everyone)

```bash
npx vite build --outDir /tmp/build-<you> --emptyOutDir
STATIC_DIR=/tmp/build-<you> PORT=809x DATA_DIR=/tmp/data-<you> node server/index.js --local
# → http://127.0.0.1:809x  (/healthz shows players, sim, gen, store, tick timing)
```
- `--local` binds 127.0.0.1 and accepts any localhost origin (the Vite `/ws` proxy works too).
- `LOG_LEVEL=debug` logs every connect/close (with the close code), chat, saves.
- Fresh world: delete `DATA_DIR` (or point it at an empty dir). The terrain cache lives in
  `DATA_DIR/cache` (~7 MB; `TERRAIN_CACHE_DIR` shares one between data dirs).
- `WORLDGEN=standin|worldgen|hub` forces a world provider; `/healthz` → `gen` tells which one runs.
- Headless online tests on this (overloaded) box: a SwiftShader frame can block a page's main thread for
  minutes → no timers → no C.PING → the server drops the client after 60 s (S.ERROR `idle`, close 4000;
  `LOG_LEVEL=debug` shows `ws close … code 4000`). Freeze the loop after load (`__game.loop.frozen = true`)
  and drive the game with `__game.debug.simulate(...)` (no rendering; net stays event-driven), render
  only for screenshots (`frames(2)`). My harness: scratchpad/server/two-clients.mjs. The same rule
  applies to real browsers: a tab hidden > 5 min gets ~1 timer wake-up per minute in Chrome and is
  dropped; net already defers the reconnect until the tab is visible again (intended: AFK tabs leave).

## What the server does around the sim (for net / LocalServer parity)

- HELLO `{v, token?, auth?, name, appearance, lang, device, world?}`: version check → S.ERROR
  `{code: 'version', v}`; full → `{code: 'full', max}`; `auth` (platform session token) → the account's
  save; else `token` (43-char base64url) → that guest; else a new guest whose token comes ONCE in
  `welcome.you.token`. `hello.world` is ignored (one world per server, id `'world'`).
- WELCOME = `sim.addPlayer(...)` + `you.{id, name, appearance, guest, isNew, token?, account?, chat?: false}`
  + `world.{id: 'world', seed, gen, st (server ms), max}`. Player ids are the stable store ids (`p<n>`).
  `world.gen` = the server's world provider (`'worldgen'` since shared/worldgen landed, else `'standin'` |
  `'hub'`) and `world.seed` its seed (WORLD.seed, or WORLD_SEED on the server): the client's terrain
  outside the hub (src/frontier, net providers) must use the same generator + seed, or heights disagree
  (respawn / travel spots, loot crates, enemies and resource nodes sit on the server's heights).
- Fatal errors: S.ERROR `{code, msg}` (msg in the hello's `lang`), then close with
  full 4003 · version 4004 · replaced 4005 (same token in another tab) · idle 4000 (60 s without any
  message) · hello 4001 (no hello within 15 s) · slow 4002 (client not reading, > 4 MB queued) ·
  protocol 1008 (too many invalid / rate-limited messages) · server 1011 · shutdown 1012 (restart:
  reconnect with backoff).
- Rate limits: `NET.MSG_RATE` per connection (excess dropped + counted as violations; 120 violations
  burst / 2 per s → 1008), `NET.CHAT_RATE` → S.DENY `{of: 'chat', reason: 'rate'}`. Chat `party` →
  S.DENY `{reason: 'invalid', detail: 'no-party'}`; restricted (under-13) accounts → `{reason: 'restricted'}`.
- C.PROFILE at most every 2 s (`{reason: 'rate'}`); signed-in players keep their account display name.
- Snapshots are skipped for a client whose socket has > 64 kB queued (backpressure).
- The server does NOT call `sim.setClock` (C.PING `ct` is the client's performance.now, C.FIRE `ct` is
  server time — the sim's own min-filter / `vt` is right).

## Requests

### platform-client (src/platform)
1. `GET /api/me` without a session (the signed-out reachability probe in `refresh()`) answers 401, and
   Chromium logs every 401 as a console error ("Failed to load resource: … 401 (Unauthorized)"). Seen once
   in a headless check against a real server (not in later runs). Please skip the call when there is no
   session token (reachability: `GET /healthz` → 200 `{ok}`), or treat it as expected.

### whoever owns it (combat / avatars / integrator) — observation, not a server issue
1. A thin red horizontal bar (≈ y 268 of 540, x 160–800, i.e. camera-attached, drawn in the WebGL canvas —
   `elementsFromPoint` finds only `canvas#gl` there) shows in every screenshot of my online two-client checks
   (hub / Overlook, quality=low, 960×540, after `debug.simulate` + `frames(2)`): shots/server/a-sees-b.png,
   b-sees-a.png. Could be a combat/aim/charge indicator or a remote health bar mesh; worth a look.

### integrator (core)
1. `vite.config.js`: also proxy `/api` (and optionally `/healthz`) to the game server, like `/ws`
   (same request as notes/platform-server-requests.md):
   `'/api': { target: process.env.API_TARGET || 'http://127.0.0.1:8080', changeOrigin: true }`.
2. `package.json`: nothing needed — `npm run server` (`node server/index.js --local`), `npm start`
   (production) and `npm test` (`node --test shared/ server/`) exist. Optional: add `src/net/test/`
   to `npm test` (net's request).
3. Railway `watchPatterns` (railway.json) cover `src/ shared/ server/ public/ index.html vite.config.js
   package*.json Dockerfile` — tell me (or edit it) when a new top-level folder becomes part of the build.
4. The Docker runtime stage copies all of `src/` because the server imports the terrain code
   (`src/world/terrain/*`, `src/world/layout.js`, `src/core/noise.js`, `src/core/math.js`, i18n). Keep those
   free of DOM/browser globals at import time (they run in Node).
