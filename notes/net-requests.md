# net (src/net) — requests & integration notes

Owner: net engineer. Public API: `ctx.net` (header of src/net/index.js). Everything below is optional
for the others — net works without it — but makes the integration smoother.

## What ctx.net gives you (summary)
- `ctx.net.mode` `'connecting' | 'online' | 'local' | 'offline'` (`offline` = this tab was replaced by another
  tab/device; no auto-reconnect), `online` (real server), `connected` (welcome received), `id`, `name`, `ping`.
- `players` / `enemies` / `loot` / `projectiles` Maps. Each entity has `view` interpolated every frame (loop
  order 15) at `serverTime() − NET.INTERP_DELAY_MS`:
  players `{ p: Vector3, h, a, m, hp, sh, veh: null | { type, p: Vector3, h }, v: Vector3, speed, dead }` plus
  `name, appearance, inRange` (false = outside the 260 m interest radius — hide the avatar);
  enemies `{ p, h, s (ES code 0..7), hp, type, v, speed, dead }`; projectiles `{ p, type, v }`; loot `{ p }`
  (+ `items, owner, ttl, expires, raw`).
- `send(msg)`, `on(type | '*', fn) → off`, `serverTime()`, `viewTime()` (= the interpolation render time — use it as
  `vt` in C.FIRE), `interp(entity)`, `count()`, `welcome`, `world`, `local` (LocalServer offline).
- `predict(fn)`: credits/resource changes made inside `fn` stay local predictions (never turned into GRANT/SPEND).
- `markTeleport()`: the next C.STATE carries `tp: 1` (fast travel). Jumps are detected automatically too.
- `touchMenu`: `[{ id: 'net-players', label, icon, run }]` — the "Players" tile for touch menus.
- Events (payload = raw message): `net:status {mode, online, reconnecting, reason}`, `net:welcome`,
  `net:join {id, name, appearance}`, `net:leave {id, name}`, `net:profile {id, name, appearance}` (a known player
  changed name/appearance — the server re-sends JOIN as an upsert), `net:damage`, `net:death`, `net:respawned`,
  `net:stats`, `net:inv`, `net:loot`, `net:struct`, `net:claims`, `net:event`, `net:deny`, `net:fired`, `net:efire`,
  `net:boom`, `net:harvested`, `net:crafted`, `net:chat`, `net:correct`, `net:error`.
- Messages are held back until `game:installed`, so modules installed after net (combat, smp, systems) always
  see `net:welcome` (and `ctx.net.connected` is false until then).
- State mirror: `state.resources`, `state.credits`, `state.smp = { hp, sh, en, maxHp, maxSh, maxEn, dead, ammo,
  items, weapons, slot, mag, unlocks }`; server `unlocks` are added to `state.owned.items` (add-only).
- Local credits/resource changes while connected become GRANT/SPEND (see the header of src/net/bridge.js). A change
  followed (same synchronous task) by an outgoing BUILD_PLACE / BUILD_REMOVE / HARVEST / CRAFT / PICKUP / USE /
  GRANT / SPEND, or by an `smp:*` / `combat:*` event, or made while net dispatches a server message, is treated as
  a prediction of that server action (not forwarded).

## sim (shared/sim)
- **Trusted LocalServer**: I pass `createSim({ …, trusted: true })` for the in-page world. Please skip the hourly
  grant budget (`GRANT_CAPS.hourCredits/hourRes`) when `trusted` — offline single-player quests, meteor fragments
  and (until smp routes harvesting through C.HARVEST) node harvesting go through C.GRANT, and the 600 res/hour
  budget would be a regression for solo players. Per-grant caps are fine.
- **`sim.teleport(id, [x, y, z], h)`** (sets the position, clears `expect`): the LocalServer accepts the page's
  movement instead of correcting it (fast travel by map / zone links / resume positions offline). Meanwhile I use
  `sim._w.players.get(id)` as a fallback.
- Optional: an `S.SNAP` field `n` = total players in the world (for "Online · N" with players outside interest
  range I count JOIN/LEAVE, which works too).

## combat (src/combat)
- Your touch overlay `'combat'`: please also spread `...(ctx.net?.touchMenu || [])` into `menuExtra` (the
  "Players" tile). I add it to the `explore` and `drive` layouts myself but never re-register overlays (that would
  change their priority).
- `C.FIRE.vt`: `ctx.net.viewTime()` is exactly what the sim wants (`serverTime() − INTERP_DELAY_MS`).
- Enemy views: `ctx.net.enemies.get(id).view` = `{ p, h, s, hp, type, dead }` — `s` is the sim's ES code
  (IDLE 0, PATROL 1, CHASE 2, ATTACK 3, LEAP 4, STUN 5, DEAD 6, RETURN 7).

## smp (src/smp + src/build)
- Harvest / build / craft: send your C.HARVEST / C.BUILD_PLACE / … in the same synchronous task as any local
  `state.spend/gain` prediction (or wrap the prediction in `ctx.net.predict(() => …)`); then net never forwards it.
  Changes you make inside a handler of a server message (e.g. on S.STRUCT) are never forwarded either.
- Legacy flows without a server message (single-player build:placed / build:removed / harvest) are forwarded as
  `SPEND {reason: 'build'|'harvest'}` / `GRANT {source: 'event'}` so the offline game keeps working until your
  authority is in place.

## avatars (src/characters)
- `ctx.player.netAnim()` (string from the sim's ANIMS: idle walk run jump fall swim drive aim shoot dodge build sit
  dead hit reload) is used for the outgoing `a` when it exists; otherwise net derives it from `player.state`
  (+ 'drive' in vehicles, 'build' while building and idle, 'dead').
- Remote player out of range: `entity.inRange === false` (and `view` holds the last position).

## vehicles (src/vehicles) — for the flight engineer, when convenient
- `ctx.vehicles.teleport?.({x, y, z}, heading)` (move the current vehicle + its controller state). A server
  correction while driving currently exits the vehicle and teleports the player.

## integrator (core)
- `package.json` test script: please include `src/net/test/` (`node --test shared/ server/ src/net/test/`).
  `src/net/test/online.test.js` boots the real server in-process (server/testkit.js, random port, temp
  DATA_DIR, ~6 s) — it needs `ws` and the terrain cache like the server tests.
- shell pause menu: while `ctx.net.online`, "Pause" doesn't stop the world — a small "Online — the world keeps
  running" line would help (net keeps remote players and the clock running while paused).

## server (FYI)
- On a starved box (load 40, 7 headless SwiftShader browsers) a page can go > 60 s without running a timer
  while it boots, so the idle sweep kicks it (S.ERROR idle, 4000). net reconnects with backoff and the token
  resumes the same player, so this is only noise in tests. Optional: count the first minute after the
  welcome as active, or treat ws-level pongs as activity until the first C.STATE.

## platform-client (FYI)
- With no session the page logs "Failed to load resource: 401 (Unauthorized)" (GET /api/me) as a console
  error, which tools/shot.mjs counts as an error. Skipping /me when there's no account token avoids it.
- net listens to `platform:login` / `platform:logout` and re-sends HELLO (with `auth` = ctx.platform.token,
  or the stored account token) so the server switches between the guest save and the account save
  without a "connection lost" toast. `ctx.net.token` is the guest token for `register({ guestToken })`.

## everyone: world time
- Online the server's time of day is the truth (S.SNAP tod). net lets the sky flow locally and re-sets it with
  ctx.world.setTimeOfDay only when it drifted > 0.05 h (each call re-captures the environment map). Don't
  call setTimeOfDay yourself while `ctx.net.online` (it would be undone within a second if > 0.05 h off).

## combat (FYI, seen in every net screenshot)
- `.cbt-boss` (top-center boss bar) is displayed with no boss around: a red bar across the screen at ~50 %
  height, above other HUD (e.g. over the Tab player list) — shots/net/offline-tab.png, two-bob.png.
