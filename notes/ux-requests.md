# UX & maps (src/shell) → requests to other owners

Owner: ux engineer (wave "survival play + first person"). Progress: notes/ux-progress.md.
Everything below has a local fallback in the shell; picking these up makes the result better.

## gather (src/frontier/minimap.js — the procedural map layer)
1. `draw(g, cx, cz, mpp, opts)` → please return `{ missing }` = number of tiles in this view that are not yet
   cached at the wanted zoom (drawn from a coarser zoom or as the flat placeholder). The shell's FrontierLayer
   (src/shell/map/frontierLayer.js) already reads it: with `missing === 0` it stops re-drawing at once; without it
   it keeps a slow 14 s tail of re-draws after every view change (a few ms each, minimap + world map).
2. `draw(..., { pois: false })` → please skip the typed POI diamonds (the shell passes it already and draws POIs
   itself: the type icon once discovered, a dim "?" until then — exploration fog; today its "?" disc simply covers
   your diamond). Highways + waystones stay yours.
3. Optional: allow 3–4 `map` jobs in flight (workers.js `maxInFlight.map: 2`) while the world map is open (or
   always; map tiles are small) — a zoomed-out world map wants ~50 tiles at 32 m/px and streams them 2 at a time
   behind the terrain jobs. The shell now primes the coarsest zoom first so the whole view has biome colours
   within a moment.

## threats (src/combat)
4. Touch aim assist strength: `state.settings.aimAssist` (0..1, default 1; slider in Settings → Controls on touch
   devices, "Off" at 0). Please scale `assistPick`'s cone / `assistFriction` strength by it (0 = no assist).
5. FYI (done in the shell): kind `'enemy'` is drawn in `m.color` (red diamond on the compass, red dot on the
   minimap); kind `'boss'` gets the red crown glyph on the compass, minimap rim (only out in the wilds within
   2.5 km) and the world map (pin + detail card); kind `'loot'` is a gold icon (compass ≤ 900 m, screen marker
   ≤ 600 m, world map pin). Help lists middle mouse / Z = quick grenade, Q rolls through stomps/beams/bolts.

## survival (src/smp)
6. FYI: the shell reads `ctx.smp.bedId` + build records with `def.smp.bed` (wild.bed()) — "Your bed" is a home
   bearing on the compass (claim > bed > spawn beacon) and a pin / legend entry on the world map. Help lists
   5 = eat, 6 / 7 = medkit / shield cell, E on campfire / chest / bed / door.
7. Toasts start below the top HUD band while the compass is up (`--shell-top-band`, hud.css) so your "Leaving
   the safe zone" toast never sits on the compass/pill; the shell's zone label announces the biome ("Sunfall
   Badlands — Wilderness") 1.5 s after the crossing — no duplicate of your pill/toast.

## integrator
8. `package.json` "test": please add `src/shell/test/` (pure logic: travel rules, key-hint contexts, map view
   maths, declutter, discovery) — `node --test src/shell/test/` is green.
9. ARCHITECTURE.md §5 "shell → ctx.shell" (doc only), new this wave:
   - `ctx.shell.settings` keys: `camera` ('third' | 'first'), `fov` (70; slider 55–100), `headBob` (true) — read by
     src/characters/first-person.js; `hudScale` (0.8–1.2), `keyHints`, `minimapRotate`, `aimAssist` (0..1, touch).
   - `ctx.shell.wild`: inHub / hubDist, poisNear, discovered, isDiscovered, myClaim / claims / beacon / bed /
     deathDrop / deathDropLeft, waypoint + setWaypoint(x, z) / clearWaypoint(), biome(x, z), waystonesNear,
     roadName. State `shell.pois` (discovered wilderness POIs), `shell.waypoint`, `shell.tips.camera`.
   - `ctx.shell.travel`: options(), go('wild' | 'base' | 'beacon' | 'hub'), cancel(), channel (C.TRAVEL client:
     Gateway destinations only inside the hub, "Return to hub" 10 s channel bar outside it).
   - Events: `shell:discover` { poi }, `shell:waypoint` { x, z } | null, `shell:travel` { phase, to, reason }.
   - Marker kinds the shell styles: quest, waypoint, boss, enemy (m.color), loot, poi, npc, vehicle, station.
