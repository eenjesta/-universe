# UX & maps (src/shell/**) — progress log

Owner: ux engineer (wave "survival play + first person"). Slice: minimap + world map for the infinite
world, compass & markers, help/controls + key hints, settings (camera / FOV / head bob / HUD), HUD
declutter + phone layout, safe-zone transition. Requests to others: notes/ux-requests.md.
Test harness (not shipped): scratchpad ux/helper.js + mk.mjs (freeze the loop, debug.simulate pacing,
render one frame before each shot).

## Assessment (played 2026-10-28 10:50, offline LocalServer, 960x540 low + phone 844x390)
Shots: shots/ux/a-*.png. Top problems, biggest first:
1. **Minimap is empty beyond the hub** (confirmed at (1800, 300) and (6200, 2600): dark disc, faint grid
   only). Cause: the frontier layer requests tiles only while drawing (max 2 jobs in flight), but the shell
   minimap redraws only when the player moves/turns — standing still, the requested tiles arrive and are
   never painted, the next ones are never requested (frontier stats: 2–4 minimap tiles cached after 40 s).
   Also no safe-zone border, no claims, no death crate, no waystone/POI context in the 115 m disc.
2. **World map is locked to the hub square** (±1200 m clamp): in the wilderness "you are here" is off the
   map, no procedural terrain, highways, waystones, POIs, claims, death crate or Gateway.
3. **Travel ignores §11.2**: "Fast travel" to hub zones works from anywhere in the wilderness (the server's
   tp rule allows it too), while the real rules — hub Gateway (Random wilderness / My base / Spawn beacon,
   only inside the hub) and "Return to hub" (10 s channel, not in combat, 2 min cooldown) — have NO client
   UI at all (nobody sends C.TRAVEL).
4. **Top-centre pile-up**: compass strip + smp zone pill + systems notice banner + toasts ("Leaving the safe
   zone" toast drawn under the compass ticks) + screen-marker labels ("Aurora City 997 m" right under the
   compass) collide.
5. **Key hints are static and cluttered**: "B Build" in the hub where building is impossible; nothing about
   combat, gathering, inventory, supplies or the new camera; the 6-key pill stacks above the smp quick bar +
   ammo card and reaches toward the screen centre.
6. **Help / controls** lack combat (1–4, RMB/LMB, R, Q, grenade), gathering (hold E / LMB), inventory I,
   supplies 5–7, camera V, travel, and touch equivalents for them.
7. **Settings** lack Camera (third / first person), Field of view, Head bob, HUD scale, (touch) aim assist.
8. **Compass / markers**: combat's red 'enemy' markers are drawn neutral grey; no boss / death-crate styling;
   hub POIs 2+ km away ("Aurora City 2.1 km") float in the middle of the wilderness view; wilderness POIs and
   waystones are invisible to the compass and screen markers.
9. **No sense of place outside the hub**: the zone label only knows hub zones — no biome / highway names, no
   "Location discovered" for ruins, outposts or crash sites.
10. Phone: minimap (top-left) fine; the right column (resources panel, not shell) is crowded; key hints
   correctly hidden.

## Plan (priority order)
1. Minimap: keep painting frontier tiles while they stream (cached FrontierLayer), safe-zone border, claims, POIs, players.
2. World map: infinite pan/zoom (±60 km, 25 km across), frontier layer + hub map, highways + names, waystones, POIs,
   claims, death crate, Gateway, waypoint, "you are here"; travel per §11.2 (Gateway in the hub, Return to hub outside).
3. Compass / screen markers: enemy red, boss, waystones/POIs, safe-zone + base bearings, declutter.
4. Help + contextual key hints (hub / wild / armed / building / driving), touch equivalents.
5. Settings: camera, FOV, head bob, HUD scale, key hints, rotating minimap, touch aim assist.
6. HUD tidy desktop + phone, safe-zone transition.

## Log
- (10:50) assessment (above). (11:05–11:28) wild.js (discovery, waypoint, biome/highway/POI announcements),
  travel.js (C.TRAVEL client: Gateway + Return-to-hub channel bar), map/frontierLayer.js (cached frontier layer
  that keeps re-drawing while tiles stream in), minimap (frontier layer, safe-zone border, claims, POIs, players,
  enemy dots, boss/waypoint rim icons), world map (infinite view, frontier layer, overlays, legend with travel),
  compass (enemy/boss/waypoint/POI/hub/base symbols + declutter), screen markers (wild POIs, waypoint, boss, band
  flip), key hints (hint contexts in logic.js), help (combat/survival groups), settings (camera/FOV/head bob/HUD
  scale/key hints/minimap rotation/aim assist), hud/layout.js (--shell-top-band, --shell-hud-scale).
  Shots v1-*, v2-* (11:22–11:38). shell tests 9/9.
- (13:05) resumed after a context loss: re-read code + shots. Open issues seen in v1/v2 shots: world-map frontier
  tiles stream slowly (big flat fallback areas; far zoom shows no layer at all), opening view puts "you" under the
  brand overlay, help shot captured the map (help didn't open over it), phone map legend 1/3 of the width.
- (13:45) FrontierLayer: primes the coarsest zoom first for a new area (whole view coloured at once, fine tiles
  refine) + slow 14 s re-draw tail (+ reads draw() → {missing} when the frontier provides it); `pois: false`.
  World map: opening view fits you + the way home inside the overlay-free area (brand / zoom / scale insets);
  undiscovered POIs = dim "?" (exploration fog; discovered = typed pin), loot-cache + boss pins, "My bed".
  Compass: numeric redraw signature (no per-frame strings), `loot` (gold), nearest 2 highway waystones
  ("East Highway · km 3"), home = claim > bed > spawn beacon (resolved 2×/s, no per-frame record scans).
  Minimap: boss on the rim only out in the wilds within 2.5 km, "?" for undiscovered POIs. Screen markers: `loot`
  kind, distance text formatted only when the shown value changes. Key hints: B only ≥ 500 m out (no-build
  buffer), V hint retires after the first camera switch (state shell.tips.camera), armed: Z grenade. Help: combat
  per threats' new keys (middle mouse / Z quick grenade, Q through stomps/beams), survival (5 eat, 6/7, E on
  campfire / chest / bed / door), touch rows (Grenade, View button, base pieces). Dutch "Poort" (= gateway module).
  Settings: segmented rows wrap below the label. Requests: notes/ux-requests.md. Build ok; shell tests 9/9.
- Test harness note: run tools/shot.mjs with --noFreeze (helper keeps the loop frozen, renders explicitly) —
  without it each capture unfreezes the loop and SwiftShader renders full frames between steps (minutes).
- (16:20) resumed after the terminal crash: verified the src/gateway integration (shell travel defers toasts to
  ctx.gateway, map pins ctx.gateway.position; U handled by the gateway, shell shows the channel bar only).
  Final shots f-* / g-* (hub, settings, hub map, phone far-out + waypoint, phone map). Fixes: edge-clamped screen
  markers (waypoint / quest / boss behind you) now stay above the vitals/ammo band (EDGE_BOTTOM, was overlapping
  the vitals on phones); phone world map brand overlay toned down (no subtitle) so it doesn't cover the hub
  label. __game.debug.info().errors empty in every run (only console noise: the offline ws probe + 502).
  Build ok; shell tests 10/10. DONE for this wave.

## Map continuity (hub map ↔ procedural planet) — owner report "map should continue from the safe zone"
- Was: the planet layer was a different renderer (flat biome colours, light from the SE instead of the hub's NNE,
  own water colours, pale single-stroke highways, extra CSS/ctx filters), its fine tiles queued behind terrain
  jobs in the shared terrain worker (views stayed on blurry 32/128 m-per-pixel fallbacks), and the hub image
  ended in a hard square seam at ±1200 m. Minimap: frontier drawn over the hub with a different filter.
- Now: src/shell/map/mapStyle.js holds the shared art style (palette, light, shadeLand / shadeWater /
  lightLand / grade, canopy + shadow stamps, world-space macro/ripple noise). mapBake.js uses it (bit-identical
  for the non-seamless bake; seamless = uniform water sheen). src/frontier/mapTile.js paints planet tiles with it
  (3D terrain masks → hub colours, soft cast shadows on a coarse grid, procedural canopies ≤ 8 m/px, forest tint
  coarser) in a dedicated map worker (src/frontier/mapWorker.js, 3 in flight). minimap.js: `hole` option
  (planet paints outside ±(1200 − 110) m), hub-road styled highways, `pois:false` honoured, returns {missing}.
  mapImage feathers the outer 110 m of the hub image (destination-out ramps) → cross-fade over the planet layer.
  World map + minimap use one filter for both layers; minimap draws planet first, hub on top.
  (pack.js mapTile is now unused by the layer; left in place for the frontier owner.)
  Tile zoom levels now [2, 4, 8, 16, 32, 128] m/px, capped at 72 tiles per view; 2 map workers (≥ 4 cores), nearest
  tiles first; FrontierLayer re-draws while tiles are missing and nothing is in flight.
- FOUND (not fixed, shared/worldgen/hub.js — not my slice): worker-side `extension()` answers points EXACTLY on
  |x| = extent (|z| < extent) with the north/south edge profile (`if (ax <= extent)` branch) → e.g.
  heightAt(1200, −400) = −35.4 vs −15.6 one metre either side. Showed as a dark trench line on the map; mapTile
  now samples 1.3 cm off the lattice. Frontier terrain tiles built in the worker may have the same spike on
  vertices along x = ±1200 — worth a look by the worldgen/frontier owner.
