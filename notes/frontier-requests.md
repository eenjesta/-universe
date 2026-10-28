# Frontier → other owners (requests)

Owner: frontier engineer (`shared/worldgen/**`, `src/frontier/**`). Integration steps: `notes/frontier-progress.md` § Integration.

## atmosphere (`src/world/atmosphere`)
1. **Water depth / foam beyond the hub.** `water.js` assumes 30 m depth outside `world.heightTexture` (±1200 m), so frontier
   coasts get no turquoise shallows or shoreline foam (the water is opaque deep-blue right up to the beach). Request: accept a
   second, camera-following height source, e.g. `water.attachHeight2(tex, xform)` sampled where the hub texture's `inside` is 0.
   The frontier can provide a 512² R16F window (8 m/texel, re-centred every ~1 km) — say the word and I add `frontier.heightWindow`.
2. **Fog when outside the hub.** The coarse terrain reaches 3.2 / 4.6 / 6 km (low / medium / high) and the exp² fog (0.0002)
   only hides ~9 % at 1.5 km. Please scale fog density ×1.5–2 when the camera is beyond ~1.4 km from the centre on *low* (far edge
   at 3.2 km) so the terrain end dissolves in haze; medium/high are fine with the current palette.
3. Nothing else needed: the frontier uses the hub's sky, sun (shadow box follows the camera), hemisphere light, fog chunks,
   env map, water plane (5.6 km disc, follows the camera) and `world.dayFactor` / `world.sunDirection`.

## terrain (`src/world/terrain`)
4. **Backdrop ring** (`backdrop.js`) must be hidden when the frontier runs: `world.terrain.backdrop.mesh.visible = false`
   (the integrator can do this; a `world.terrain.setBackdrop(false)` helper would be nicer).
5b. **Carve the gate passes hub-side (2026-10-28).** The highways start exactly on the hub mesh border, but at three
   gates the hub's own ring rises right behind them: West gate (−1200, −42) at 249 m has hub terrain of 336 / 374 m
   30 / 60 m inside (a ridge between the hub and its road); South (−194, 1200) 179 m → 186 / 204 / 222 m inside;
   South-East (567, 1200) 202 m → 207 / 215 / 244 m. A notch / road from the hub interior to these gates keeps the hub
   walkable outward (the other four gates — NW, SW, SE, E — already open downhill into the hub).
5. **Gates.** The 7 highways start on the hub mesh border (|x| or |z| = 1200) at the lowest pass near each bearing. Later wave:
   extend hub roads from the plaza / spawn to these gates (positions: `worldgen.highways[i].gate`, seed 'o-universe':
   NW (−1200, −1040), W (−1200, −42), SW (−1200, 818), S (−194, 1200), SSE (567, 1200), SE (1200, 818), E (1200, 139)).

## core / integrator
6. Lift `WORLD.playBounds` (1050) for characters/vehicles; `ctx.physics.setTerrain(frontier.getHeightAt)`.
7. Create the frontier **before** delegating `ctx.world.getHeightAt` (it captures the hub's original function); then
   `ctx.world.getHeightAt/getNormalAt/isWater/raycast` → frontier (identical to the hub inside |x|, |z| ≤ 1200).
8. Share one generator: `ctx.worldgen = frontier.worldgen` (smp/combat/net then reuse it instead of building their own
   — `createWorldgen` costs ~100 ms idle / ~400 ms on a loaded machine because it routes the highways).

## sim / defs (`shared/defs/world.js`)
9. `BIOMES` lacks the worldgen ids `coast`, `highlands`, `peaks` (and names differ: worldgen 'forest' = Lumen Forest,
   'meadow' = Golden Meadows, 'jungle' = Lumen Wilds, 'badlands' = Sunfall Badlands, 'peaks' = Frost Peaks,
   'highlands' = Crystal Highlands, 'coast' = Azure Coast, 'ocean' = Open Sea). Use `worldgen.BIOMES[id].name` or copy them.
10. `worldgen.spawnRules(x, z, hour)` already returns `{ biome, density, list, poi }` (POI hot-spots, calmer highways,
   none within hubDist < 200) — no SPAWN_TABLES needed for the procedural world.

## build / smp (`src/build/harvest.js`, `src/smp`)
11. Resource-node visuals exist twice if both run: harvest.js streams wilderness nodes from the provider *and* the frontier
   can draw them. Pick one: keep harvest.js (it owns interaction / depletion) and create the frontier with
   `renderNodes: false` (the frontier still exposes `frontier.nodes` with the same ids).

## shell (minimap / map)
12. Draw the procedural layer: after the hub minimap, `frontier.minimap.draw(ctx2d, centerX, centerZ, metersPerPixel, { rotate })`
   (it clips out the hub square ±1200 m itself and adds highways, waystones and POI markers).
