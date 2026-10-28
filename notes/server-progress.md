# server — progress log

Owner: server engineer (server/** except server/platform/**, Dockerfile, .dockerignore, railway.json, docs/DEPLOY.md).

## Done + verified
- terrain bake runs in Node (1.7–2.9 s); server/terrain.js caches it in DATA_DIR/cache (binary, 7.4 MB,
  keyed by a hash of the terrain sources + three version) → 70 ms restarts; heights/isWater/getWaterHeightAt
  identical to src/world/terrain/queries.js (20k random samples, 0 diff).
- modules: config, log (json/pretty, throttle), http (static, MIME, immutable assets, no-cache html, ETag/304,
  br/gzip + LRU, /healthz, /api → server/platform when present), transport (ws /ws, origin, per-IP cap,
  heartbeat, idle, hello timeout, MSG_RATE bucket, schema, violations → 1008), hub (hello/guest tokens,
  replace same-token sessions, welcome merge, chat global/local + filter + CHAT_RATE, profile, routing
  to id/'*'/near/[ids]/except, tick loop drift-corrected, snapshots w/ backpressure, autosave, reload newer
  world when empty, shutdown), schema, filter (en+nl), store/json + store/pg, sim loader (auto/real/stub), simstub.
- smoke: two ws clients against the REAL shared/sim: welcome (token, inv, spawn), snapshots show the other,
  chat relay + filter, shutdown → S.ERROR shutdown + 1012 + final save.

- (run 2) tests: node --test server/*.test.js → 17/17 pass (~11 s); Dockerfile, .dockerignore, railway.json,
  docs/DEPLOY.md written (previous run, not yet re-reviewed).

## Done in run 2 (PLATFORM.md §11 — one seamless world per server), verified by node --test (20/20)
- server/worldgen.js: provider = shared/worldgen (createWorldgen({seed, hub:{heightAt,isWater,half,radius,blend}}))
  → else shared/sim/standin.js createStandin({noise:true}) → else the bare hub heightfield. Passed to createSim as
  getHeightAt/isWater (combined) + `worldgen` (the generator object; the sim's resolveWorld picks isSafe,
  spawnRules|spawnTable, nodesNear|chunk, isBuildable, biomeAt). WORLDGEN=auto|worldgen|standin|hub, WORLD_SEED.
- hub.js → world.js (createWorld, WORLD_ID 'world'; welcome.world.{id:'world', gen}); stores write id 'world'
  (pg reads the legacy 'hub' row until the first save).
- per-account saves: hello.auth → platform.resolveToken → the guest save linked at register (guestTokenHash) or
  the account's own record (token hash sha256('acct:'+userId)); account display name (PROFILE can't rename);
  under-13 restricted chat (no chat in/out); presence for guests as 'guest:<id>'; platform mount options
  (allowedOrigins, allowLocalOrigins, trustProxy).
- schema coordinate cap 1e6; testkit client `deflate:false` for timing-sensitive tests (ws client compresses
  every frame with context takeover → async zlib per frame → floods trickle in on a loaded box).
- import closure of the server checked (module hook): server/**, shared/**, src/world/**, src/core/**, ws, three
  (+ pg lazily) — all in the Docker runtime stage.

## Done in run 3 (verified)
- schema rule for C.TRAVEL (+ unit test); S.TRAVEL 'done' keeps the session's position copy in step.
- pg store accepts DATABASE_SSL=1 (same switch as the platform store; PGSSL=1 still works).
- docs/DEPLOY.md rewritten for §11 (one seamless world per server, env table incl. WORLDGEN/WORLD_SEED/
  TRUST_PROXY/DATABASE_SSL/…, saves, backups, troubleshooting, NL quick start); notes/server-requests.md.
- Docker: `docker build` OK (image 399 MB), container: terrain bake 1.8 s, sim real, gen standin, JSON
  store in /data as user node, ws smoke (2 guests: welcome, snapshot movement, chat filter, sys line,
  pong), br + immutable assets, SIGTERM → graceful stop < 1 s. (scratchpad/server/wsmoke.mjs)
- scratchpad is SHARED with all engineers: my files live in scratchpad/server/ only.
- REAL Postgres (docker postgres:17-alpine on 127.0.0.1:55432): new server/pg.test.js (skipped without
  TEST_DATABASE_URL) → 2/2 pass: concurrent schema boot, players, partial saves, legacy 'hub' row, and a
  full server boot on Postgres with restart persistence (+ platform tables). Platform store tests on the
  same DB: 22/22.
- shared/worldgen LANDED (03:40): auto mode picks it (`gen: worldgen`, init ~0.5–0.8 s). Checked: hub
  heights identical inside |x|,|z| ≤ 1100 (20k samples, diff 0), heightAt ~7 µs, isBuildable ~1.3 µs,
  sim with 10 wild players at night: enemies spawn (47), step avg 1.0 ms (stand-in 0.7 ms; spikes ≤ 26 ms
  are machine load, same with the stand-in). hubArg now passes extent = baked grid HALF (1200).
  Unit test asserts the worldgen contract the sim relies on when it is present.
- healthz net.helloMsAvg/helloMsMax + `ms` on "player joined" (hello → welcome latency).

- BROWSER CHECK PASSED (run 5, 03:58): own server :8090 (gen worldgen, real sim, JSON store, fresh client
  build) + two headless clients (scratchpad/server/two-clients.mjs, report + shots in shots/server/):
  both online, see each other, A walks 10.7 m (server accepts, no snap back), B's view follows (10.9 m),
  chat through the real UI both ways, server filter ("wat een *** spel") shown in B's log + speech bubble,
  debug.info().errors empty, no console errors. A's save on disk after leave: p = [0.95, 41.8, 139.12].
  Runs 1–4 failed on the ENVIRONMENT (load 40–55): SwiftShader frames blocked the pages' main threads for
  minutes (no pings → server idle close 4000; keyboard.press hung) → harness v2 freezes the loops and drives
  with debug.simulate. Observation for client owners: a red horizontal bar (y≈268, x 160–800) in both shots.

- Browser persistence (run 6): server restarted → A reloads with its stored guest token → same id p10,
  isNew false, position [0.95, 41.8, 139.12] restored exactly; walk + chat checks pass again. ALL PASS.
- Final docker build + run (scratchpad/server/docker-check.sh): image 399 MB, gen worldgen, sim real, JSON
  store in /data as `node`, ws smoke OK, br assets, SIGTERM → graceful stop.
- FIX: duplicate shutdown signals (npm run + Ctrl+C: the process group AND npm's forwarding; `timeout`)
  made the old handler exit at once WITHOUT the final save ("second signal"). Now repeats within 1.5 s
  are ignored; verified with SIGINT to the npm process group + the process test sends SIGTERM twice.
- Tests: node --test server/*.test.js 22/22 (incl. 2 real-Postgres tests with TEST_DATABASE_URL),
  node --test server/platform/ 93/93.
- railway.json watchPatterns += .dockerignore, railway.json. DEPLOY.md: two tabs = same guest (fixed text),
  Ctrl+C semantics.

## Status: DONE (v1). Possible follow-ups
- Reject / route hello.world ≠ 'world' when there are more worlds per server.
- The world save now carries `server: {seed, gen}` (a different WORLD_SEED at boot is logged as an error,
  tested). Not covered: shared/worldgen changing its terrain formula under existing bases (no generator
  version in the save yet — worldgen would need to export one).

## Next
- (none)

## Open problems
- (none yet)
