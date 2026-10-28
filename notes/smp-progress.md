# SMP engineer — progress log (src/smp/** + src/build/**)

Read this first when resuming. Brief: inventory & crafting UI, consumables, loot, claims,
build-online authority, new build pieces (Workbench, Claim beacon, Spawn beacon), survival quests.

## Done (code written)
- build: catalog 7th category `survival` (key 7, only visible while an authority is set) with
  `workbench`, `workbench-2` (hidden, upgrade), `claim-beacon`, `spawn-beacon` (+ models in pieces.js,
  icons); `setAuthority/applyRemote/applyHarvest/placeAtAsync/targetRef` in index.js; pending phantoms,
  deny flash (red ghost + reason), owner-tagged records, claim prediction via `authority.check`,
  creative ignored online, power accrual off online, harvest.js uses shared/sim/nodes.js (ids n0…)
  and the online path (C.HARVEST → S.HARVESTED).
- smp: logic.js (+ logic.test.js, `node --test src/smp/` 4/4 pass), bridge.js (server msgs + build
  authority), claims.js (store + terrain fences + placement preview ring), loot.js (instanced crates,
  labels, interactions, death-drop marker), hud.js (quick bar 5–7 + bag, claim pill, warnings, tips),
  screen.js + smp.css (inventory & crafting modal, phone tabs), icons.js, index.js (ctx.smp).
- systems/quests/data.js: `survival` (ration, workbench, claim) → `survival2` (drone, plasma rifle).
- dev harness `?smplocal` (src/smp/dev/localnet.js): real LocalServer + shared/sim while ctx.net is
  the fallback (net module still a placeholder at 22:40). Verified boot: welcome → ready, START inv,
  authority on, survival tile visible, 40 shared nodes.

- (run 2, until 23:11) §11 update: world.js (rules provider: ctx.worldgen → shared/worldgen → the sim's
  resolveWorld stand-in; dev ?smphub=<half>[,<buffer>]), zone.js (+ zone.test.js: hub square, buffer,
  tracker with hysteresis, border posts), border.js (instanced Ø beacons on the hub square), HUD zone pill,
  canEnter (no build mode in the safe zone), build.setNodeSource (wilderness nodes from the provider).
- (run 3, 03:02) resumed: `node --test src/smp/` 9/9, `npx vite build` passes (platform.css fixed).
- (run 3) src/smp/flow.test.js: the smp bridge (build authority + server messages) against the REAL shared/sim
  for two players outside the hub — harvest (world nodes), craft (denied without / OK at a workbench), use
  ('full' deny, then OK), loot pickup, claim (own OK, other player's foundation denied "Claimed by Alice" by the
  client prediction AND the server), one claim / one spawn beacon, remove denied for non-owners, hub refused,
  structures reach the second client. `node --test src/smp/` → 11/11.
- (run 3) quest order: workbench → ration → claim; reasonText for 'claimGap' (+ name).
- (run 3) browser offline (LocalServer, ?smphub=150,0 + test patch of the local sim's isSafe/isBuildable,
  second player "Rhea" injected into the local sim): claim + workbench + spawn beacon + foundations OK; 2nd spawn
  beacon refused; foundation in Rhea's claim refused "Claimed by Rhea"; crafting screen shows "Workbench · tier 1
  in range". Test harness: scratchpad t/mk.mjs + helpers.js (+ server-smp.mjs = own server :8093 with a shrunken
  hub and a WebSocket bot "Rhea"). NOTE: the machine is overloaded (load 40–55, ~9 headless browsers) → use
  __game.debug.simulate for key input (hold-E at <1 fps never completes with real key events).

- (run 3) ONLINE (own server :8093 = scratchpad t/server-smp.mjs: server/app.js + hub shrunk to 150 + bot "Rhea",
  production build in /tmp/build-smp, client ?smphub=150,0): harvest (hold-E, +7 metal), claim + workbench,
  loot crate pickup (+15 metal), spawn beacon (hasBeacon), craft ration ×2 at the workbench, use ration (5),
  foundation in Rhea's claim refused (client "Claimed by Rhea"; forced request → server 'claim' "Claimed by Rhea"),
  the bot (second client) received claim-beacon / claim (owner name) / workbench / spawn-beacon "by Traveler".
  Survival quest completed (+credits via GRANT). 0 page errors. Movement on the loaded box: use allowed
  fast-travel hops (tp within 80 m of the 'base' zone, ≥ 3 s apart) — walking got corrected ('far').
- (run 3) polish: claim fence subtle while exploring (wall fades in only from 6–34 m camera distance, ground line
  stays; preview + build mode unchanged), locked weapon art without a box edge, build reticle label above the
  reticle on screens < 640 px high (combat vitals overlap).

- (run 4, 2026-10-28 08:00–) resumed on an idle box: `node --test src/smp/` 11/11, vite build OK (1.6 s).
  Added: §11.2 claim decay + moderation on the client — normClaim keeps `decay` (0..1), the fence of a decaying
  claim fades to grey, the claim pill says "abandoned · decaying", welcome `notices` (claim-restored /
  claim-removed) → toasts, S.STRUCT {remove, by: null, reason: 'decay' | 'admin'} that takes my pieces → toast
  (bridge `noticeText` / `lostText`); `smp:claimed` only for a NEW own claim (decay updates no longer re-fire it);
  world.js reuses an existing generator for the welcome's seed (ctx.worldgen, else the LocalServer's
  ctx.net.providers.impl) instead of building a second one (~0.5 s main thread), `rules.sync()` picks up a
  ctx.worldgen that appears after the welcome (node source re-pointed); workbench tip says "beyond the hub".
  flow.test.js +2 tests against the real sim: workbench Mk II upgrade (same record → 'workbench-2', railgun 'tier'
  deny → OK after the upgrade, plasma rifle at tier 1) and claim decay/moderation (Bob sees decay, Alice gets
  claim-restored / claim-removed notices, admin removal → lost toast). `node --test src/smp/` → 13/13.

- (run 4) browser, offline LocalServer (`?offline&smphub=150,0`, 1280x720, scratchpad t/mk2.mjs `final`): harvest
  (hold-E, +7 metal), base (claim, workbench, spawn beacon, 4 foundations, decor — all OK; 2nd spawn beacon refused
  "You already have a spawn beacon — remove it first"), ration crafted through the screen button at the workbench
  (tier-2 gate text "Needs a Workbench (tier 2) nearby"), workbench → Mk II through the screen (station tier 2,
  railgun button enabled), ration via key 5 (en 20 → 55), loot crate via E (+12 metal; the ammo that didn't fit
  stays in the crate), build mode aimed into Rhea's claim → red ghost "Claimed by Rhea" (placement refused), final
  `__game.debug.info().errors` = []. Shots: shots/smp/smp-craft.png, smp-base.png, smp-deny.png.
  Also: weapon cards re-render only when their content changes (no hover flicker while harvesting); the inventory
  modal respects phone safe areas (notch) and uses dvh.

- (run 4) ONLINE re-run (own server :8093 = t/server-smp.mjs, fresh DATA_DIR, production build, bot "Rhea" = second
  client, client `?smphub=150,0`, 960x540): claim + workbench (server ids s5/s6), loot crate via E (+15 metal, pulse
  48 → 60), spawn beacon (hasBeacon), ration ×2 crafted at my workbench (3 → 5), ration used via key 5, foundation in
  Rhea's claim refused by the client ("Claimed by Rhea") AND by the server (forced request → 'claim', "Claimed by
  Rhea"); the bot received claim-beacon / claim (owner name) / workbench / spawn-beacon "by Traveler"; errors [].
  Harvest (hold-E on n9) was credited (+7 metal, visible in the next step's inventory) but later than the step's 8 s
  wait on the loaded box (load 20–28); the first online run of this session credited it in time. That first run was
  idle-kicked by the server right after boot (no message for 60 s during a slow boot) → reconnect; build requests
  in that window were refused with "Connecting to the server…" (by design) — noted in smp-requests.md.

- (run 4) single-player fallback (t/sp.mjs: the net module import is blocked → fallback net, mode 'off'): smp
  dormant (enabled/ready false), no build authority, survival category hidden, no quick bar, no border beacons;
  foundation placed + paid locally (metal 4, stone 24), node harvested locally (+10) — unchanged SP behaviour; the
  only error is the deliberately blocked net import.
- (run 4) phones: portrait phones get the core's "rotate your device" overlay (landscape-only), so the phone shots
  are landscape 844x390; short screens (≤ 460 px high) get a compact header + compact weapon cards.

- (run 4, final 09:10) `node --test src/smp/` 13/13, vite build OK. Final shots in shots/smp/: smp-craft.png
  (inventory + crafting at a workbench, tier-2 gate), smp-base.png (claimed base: claim fence, Workbench Mk II, claim +
  spawn beacons), smp-deny.png (red ghost "Claimed by Rhea"), smp-phone-land-inv.png / smp-phone-land-craft.png.
  The 4th weapon card's lock line looks doubled in headless captures — a SwiftShader compositing artifact: the DOM
  has one span and nothing overlaps it (checked with elementsFromPoint, t/dom.json).

## Next
- nothing blocking. Optional: a Return-to-hub / Gateway entry in the inventory (C.TRAVEL is the net/combat side).

## Open problems
- (none in smp) — the box is shared: screenshots at 1280x720 can take minutes under load (use --shotTimeout,
  --globalTimeout); a cold boot over ~60 s gets idle-kicked once by the server (reconnects as the same player).
- Real wilderness testing waits for the integrator (frontier wiring + lifted play bounds); until then `?smphub=150,0`
  + a server with the hub shrunk the same way (t/server-smp.mjs SMP_TEST_HUB=150).
