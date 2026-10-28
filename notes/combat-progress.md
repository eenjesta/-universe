# Combat (src/combat/**) — progress log

Owner: combat engineer (multiplayer + SMP v1). Contract: PLATFORM.md §1/§7/§8/§11, shared/protocol.js.
Read this first when resuming.

## Plan
1. pure logic + data (weapon-data.js, logic.js) + node tests (node --test src/combat/)
2. weapon models (models.js), FX (fx.js: ribbons/glows/smoke/debris), enemy visuals (enemies.js)
3. HUD (hud.js + combat.css): vitals, ammo, crosshair/hit markers, damage numbers, vignette,
   direction indicators, killfeed, enemy pings; death screen (death.js)
4. controller.js: equip/switch/aim/fire/reload/grenade arc/dodge, holster rules, C.* messages
5. sounds.js (recipes on ctx.audio), touch.js (ctx.touch.setLayout overlay), mock.js (local fake server)
6. index.js wiring → ctx.combat; build check; headless tests with the mock
7. switch to real ctx.net (LocalServer) + shared/defs/weapons.js; online test on :8092; screenshots

## Done + verified
- (22:25) read contracts, concept art 24–28, touch/input/ui/audio/camera-rig/player code.
- (run 1, until 22:51) all files written: weapon-data, logic (+test 15/15), geo, models, fx, enemies,
  hud + combat.css, death, controller, sounds, touch, mock, index. NOT yet browser-verified.
- (run 2, 22:57) resumed. Real APIs now exist: ctx.net (src/net, LocalServer + shared/sim),
  shared/defs/weapons.js, ctx.player.holdWeapon/setAim/playAction/aimAt/muzzleWorld, cameraRig.aimRay.

## Run 2 fixes (in progress)
- ES state codes (4 leap, 5 stun, 6 dead, 7 return) in logic.enemyState
- §11 safe zone: provider chain (ctx.*.isSafe → shared/worldgen → hub stand-in r 1100 ∪ sim zones);
  `?combatsafe=static` = only the sim's static zones (testing while the sim still spawns in the hub)
- C.FIRE vt = ctx.net.viewTime(); stalker y = server feet y; hit volumes closer to the sim capsule
- death screen texts (§11), touch menuExtra += ctx.net.touchMenu

## Run 3 (2026-10-28 03:00–)
- hub stand-in is now the SQUARE |x|,|z| ≤ 1100 (shared/defs/world.js HUB), provider chain adds
  ctx.net.providers.isSafe (the LocalServer/server world provider); zone chip defers to smp's zone HUD
  (smp.hud.setZone) to avoid a duplicate "Safe zone" chip; deny texts from shared/defs/reasons.js,
  'rate'/'reloading'/'invalid' denies reconcile silently, 'empty' deny syncs mag/reserve.
- test recipe (dev server, offline): `__game.debug.world.playBounds = 90000`; in-hub "wilderness" override
  for tests/staged shots: `(await import('/shared/defs/world.js')).HUB.enemyMargin = -1e9;
  net.local.sim._w.world.isSafe = () => false; net.providers.isSafe = () => false` + `?combatsafe=off`;
  enemies: `net.local.sim._w.enemiesSys.create('drone'|'stalker', x, z)`; fast logic runs with
  `__game.debug.simulate(sec, {press|hold: ['Digit1','Mouse0','Mouse2','KeyR','KeyQ']})` (LocalServer clock
  follows the loop). The machine is heavily loaded (5+ browsers of other engineers): a page load ≈ 100 s.

## Verified (run 3)
- offline (dev server, LocalServer, in-hub "wilderness" override, simulate-driven): equip 1–4, aim (RMB), pistol
  kills a drone (5 shots, server DAMAGE/DEATH, killfeed), reload (R) 12/43, rifle auto + aim kills a stalker,
  railgun charge one-shots a drone (75), dodge (Q) 3.9 m, drone lasers hurt me (efire, damage, Enemy ping +
  compass marker), death → "You died / Killed by Security drone" (beacon disabled without a beacon), respawn at
  the Overlook after 5 s → re-equipped. __game.debug.info().errors empty.
- online (own server :8092, built client): hub = safe (holstered, block 'safe'), Gateway travel 'wild' →
  combat enabled, drone/stalker damage, death screen + respawn at the Overlook (holstered again in the hub).
  Server-validated kill online with combat's claim format: src/combat/dev/online-bot.mjs (5/5 hits, drone killed).
- bugs fixed this run: boss bar + wave banner were always visible (widget roots: the ui widget system owns
  `hidden` → ui.setVisible); grenade release required input.released (throw now on hold end); after respawn
  the grenade was re-drawn (now a gun); death delay + respawn countdown run on max(game, wall) time (slow
  devices clamp dt; the server counts 5 s real time).
- machine note: with 5+ browsers of other engineers the game ran at ~0.03–0.05× real time in headless
  Chrome; real-time browser tests are unreliable → logic via simulate() + the Node bot for the online path.

## Next
- (nothing open in combat) — integrator items in notes/combat-requests.md

## Open problems
- play bounds (1050) < hub radius (1100): outside the hub is unreachable until the integrator lifts them.

## Run 4 (2026-10-28 08:00–)
- resumed; machine idle now (load 0.15). Since run 3: src/frontier + shared/worldgen landed (not yet integrated:
  playBounds still 1050, ctx.world.getHeightAt = hub only). Plan: re-verify (node tests, build, offline browser),
  ctx.worldgen/ctx.frontier in the safe-zone chain, online :8092, final screenshots, summary.
- (08:20) node tests 17/17, build ok. Offline in the REAL wilderness (test wires src/frontier like the integrator will,
  with the LocalServer's worldgen; no safe overrides): Ø ruin POI in the jungle → safe false, rifle kills a drone, no errors.
- fixes: trace() prefers ctx.frontier.raycastInto (hub raycastInto only knows ±1200 m); safe zone re-checked at once
  after a teleport (respawn in the hub stayed armed for a few frames on slow clients); narrow-desktop HUD (≤ 1140 px
  vitals/ammo overlapped); phones: tappable weapon/ammo chip inside the vitals (switch), ammo card + Switch button
  hidden on phones (they sat under the resources panel / above the cluster).
- ONLINE browser test (own server :8092, dev client ?server=ws://127.0.0.1:8092/ws, loop frozen + simulate-paced
  because SwiftShader renders ~0.1 fps): hub safe + deny text, travel 'wild' → combat on at once, pistol kills a drone
  (server-validated, 11 shots / 5 hits / 1 'miss' deny), dodge 3.3 m, killed by a drone → death screen → Overlook →
  respawn in the hub: safe + holstered. errors []. Bot (online-bot.mjs): 5/5 hits, kill.
- (09:10–09:55) FX/HUD polish from the screenshots: own muzzle flash + point-blank impact glows shrink/dim near the
  camera (fx.glow, camera distance) — before, one rifle shot whited out a third of the screen; flash light 26→14;
  damage-direction arc thinner; player bolts longer/wider (readability); shield-hit ring subtler; death screen disables
  Base without an own claim ("No base claimed yet", sim falls back to the Overlook anyway).
- FINAL offline regression in the real wilderness (frontier wired, simulate-driven): pistol kills a stalker, R reload
  (5/48 → 12/41), rifle kills a drone, railgun charge one-shots a drone, grenade arc shown while held → throw →
  S.EXPLODE (3 → 2), dodge 4 m, death screen → Overlook → respawn in the hub (safe, holstered, hp 100), errors [].
- final screenshots: shots/combat/combat-ruins.png (Ø ruin POI, 1280×720 high), combat-jungle-night.png (stalkers,
  22:20), combat-death.png, combat-touch-phone.png (844×390 @2×, iOS UA). Test scripts (not shipped): scratchpad
  combat4/wild.js + mk*.mjs (wire the frontier like the integrator, freeze rendering, simulate, render one exact frame).
- headless note: SwiftShader renders ~0.1 fps even on an idle machine (1.6 M tris) → real-time browser tests are not
  possible; online tests freeze the loop and drive it with debug.simulate at real-time pace.
