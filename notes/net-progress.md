# net (src/net/**) — progress log

Owner: net engineer (multiplayer + SMP v1). Contract: PLATFORM.md §6, shared/protocol.js.
Read this first when resuming.

## Files
- `index.js` install → ctx.net (api, dispatch, events, token, migration, gating until game:installed)
- `client.js` NetClient (WebSocket / LocalServer, HELLO→WELCOME, 4 s open timeout, reconnect backoff,
  hidden-tab deferral, 'replaced' → mode 'offline', ping/clock, rate limit, queue for GRANT/SPEND/CHAT/PROFILE)
- `local-server.js` LocalServer (shared/sim in the page, JSON-cloned async delivery, trusted movement
  (CORRECT → teleport sim), localStorage 'o-universe-local-v1', migrate once)
- `remotes.js` + `interp.js` registries + snapshot ring buffers + interpolation
- `sync.js` C.STATE 15 Hz (tp flag on jumps), CORRECT / RESPAWNED / welcome placement, world time (tod)
- `bridge.js` inv/stats mirror (+ cid in-flight predictions), state.set wrapper → GRANT/SPEND attribution,
  chat bridge, profile bridge
- `ui.js` + `net.css` status pill, Tab player list / modal, toasts, touch menu entry
- `providers.js` location providers for the LocalServer (§11): shared/worldgen via import.meta.glob when it
  exists, else stand-in (hub heightfield inside the 1100 m square, value-noise hills blended over 300 m outside,
  isSafe = inside the hub square)
- `test/net.test.js` (units + LocalServer), `test/bridge.test.js` (state/chat/profile bridges with the real
  core State/Events), `test/online.test.js` (NetClient against the REAL server booted in-process)

## Done + verified
- (22:50) all modules written; node tests 12/12 green (LocalServer with the real shared/sim).

- (22:58 resume) §11 update: hello {world: 'world'}, cleanAppearance (server schema), ctx.net.token getter,
  local token never overwrites the guest token, providers for the LocalServer, net-time only in explore/drive.

- (03:05 run 3) resumed: providers test rewritten for the async createProviders({seed, hub, loaders}) API (+ a
  LocalServer stand-in test); node --test src/net/test/ → 15/15; vite build OK.

- (03:20) offline browser check (:5199 ?offline&nosave&zone=plaza): mode local, stand-in world, market buy/sell,
  quest-style reward, misc gain/spend all settle with the server ack (inflight 0, same numbers), chat no
  duplicate, sim follows movement, time in sync, status pill 'Offline', errors [] — shots/net/offline-plaza.png.
- (03:25) online browser + Node bot on my server :8091: browser sees the bot (view.a walk, ctx.remotes avatar),
  'Online · 2 players', chat both ways with names, bot sees the browser's walk/run; errors [].
- (03:30) src/net/test/online.test.js: NetClient against the REAL server in-process (two clients see each other
  + chat + clock, PROFILE upsert, reconnect after a server restart keeps the same id/token + queued chat,
  unreachable → local) → 4/4.

- (03:35) two headless browsers (Alice, Bob) on :8091: each sees the other (ctx.remotes avatar, name tag),
  Bob sees Alice walk (view.a idle → walk), chat both ways, PROFILE names propagate, 'Online · 2 players',
  errors [] — shots/net/two-bob.png. Box at load ~40: boots took 215–230 s, the server idle-kicked both
  clients (no message for 60 s while the page was starved) and both reconnected as the same player.
- (03:40) client.reconnect('auth') + re-hello on platform:login / platform:logout (guest ↔ account save);
  restricted chat (welcome you.chat === false) → system line instead of C.CHAT; time sync only re-sets
  the sky when it drifted > 0.05 h (setTimeOfDay re-captures the env map); boot gate without the 30 s
  timeout and only the newest snapshot kept while gated; bridge tests (src/net/test/bridge.test.js);
  first C.PROFILE no longer waits 2.2 s. node --test src/net/test/ → 27/27; build OK.

- (03:55) final offline run (desktop): local + stand-in, isSafe hub/wild, market buy settles (inflight 0),
  errors [], Tab list + Players modal — shots/net/offline-tab.png, offline-modal.png (modal header got room
  for the close button). Mobile (844x390, iOS UA): explore menuExtra [net-players, smp-inventory], drive
  [net-players]; the touch menu shows the Players tile — shots/net/mobile-menu.png. The red bar across every
  shot is combat's `.cbt-boss` widget (noted in net-requests.md). Re-hello skipped when the account token
  didn't change. node --test src/net/test/ → 27/27; build OK.

## Next (v1 is done — possible follow-ups)
- vehicles: use ctx.vehicles.teleport for S.CORRECT/RESPAWNED while driving once it exists (now: exit + teleport)
- a browser-level reconnect check with the toasts (the Node test covers the logic; the starved two-browser
  run showed real reconnects resuming the same player)

## Open problems
- none yet
