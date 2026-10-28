# Frontier progress (shared/worldgen + src/frontier)

PLATFORM.md §11 (one seamless planet: hand-made hub in the middle, infinite procedural survival world around it) and
§11.2 (keeping the hub open). Contract: `shared/worldgen/README.md`. Requests to other owners: `notes/frontier-requests.md`.

## Done
- **shared/worldgen** (pure JS, sync, deterministic, engine-independent maths): continents/oceans, beaches, archipelagos,
  lowland rivers + lakes, hills, ridged mountain chains (continuing the hub's ring), stepped plateaus, terraced mesas +
  canyons; 8 biomes with smooth weights and hub themes (sea N/NE, jungle W, badlands E, forests/meadows/highlands/peaks S);
  C1 hub seam (exact hub heights to ±1200 m, border profile extended + 300 m smoothstep blend); 7 A*-routed highways with
  grade-limited profiles, flattened corridors, mountain damping and waystones every km; POIs (ruins / outposts / wrecks,
  ≥ 300 m apart, flattened pads, stable ids); per-chunk features with stable node ids; spawn rules (POI hot spots, night,
  calmer highways, none near the hub); `isBuildable` (safe / hub buffer 500 m / highway 20 m / POI 60 m); worker export.
- **Tests**: `node --test shared/worldgen/*.test.js` — 18 tests (determinism, finiteness to 100 km, continuity incl. the
  seam (tear detector), real-hub seam, chunk border continuity, biome coverage + hub themes, node ids vs nodesNear, POI
  spacing, highways (start on the border, flat, ≤ 9 % grade, waystones), build rules, spawn rules, worker roundtrip,
  hub-less planet, speed, provider shape).
- **src/frontier**: `createFrontierWorld(ctx, { seed, quality })` — two Web Workers (terrain tiles + minimap tiles /
  chunk features + grass), quadtree LOD tiles (64 m … 4 km, 33² vertices, geomorph + skirts, hub-square clipping),
  terrain material ported from the hub (same palette + ramps, block-local detail coordinates → crisp at 100 km), vegetation
  via the hub's plant library / materials / impostors (near detail + far impostors, swap-remove instanced streaming),
  rocks, energy crystals, grass clumps, resource nodes (optional visuals), POI models (Ø ruins with glowing glyphs, pirate
  outposts with lamps + watchtower, crashed ships with embers), waystone beacons, highway ribbons (hub road look),
  minimap layer, queries (getHeightAt / getNormalAt / isWater / isSafe / biomeAt / raycast / collidersNear …).
- **Lab** `src/frontier/dev/lab.html` (fly camera, teleport, views, overlay, time, quality, stats, minimap).

## Update 2026-10-28 (polish pass)
- **§11.2 "keep the hub open" made visible + robust.** `worldgen.rules` exposes the static numbers; `highwayDistance`
  is now exact at any reach (it silently missed roads > ~25 m away → POIs could sit 25 m from a highway; now ≥ 150 m,
  tested). Router: pushes routes away from the hub border (no contour-hugging around the ring) and avoids ground a
  9 % road from the gate can't follow. **Shoulders:** where the road still runs high above / deep below the terrain
  (near the ring: up to ±90 m) the ground follows it in a wide smooth shoulder — the 60 m embankment walls next to the
  West gate are gone (natural spurs / cuttings; test `real hub: highways ride natural shoulders`).
- **Lab overlay `rules`** (`?view=rules` or the overlay select): hatched orange = 500 m hub buffer, red = 40 m highway
  corridors, violet = POI clearance, green = buildable, dashed = 16 m height-limit zone on the minimap. Same verdicts as
  the server (per-vertex `worldgen.isBuildable`, 0.27 µs). `frontier.setOverlay('rules')`,
  `frontier.minimap.draw(…, { rules: true })` for the integrator's build mode.
- **Terrain look:** no more polka dots / honeycombs (bare-earth and rock-slab masks now from smooth noise instead of the
  cellular channel), rock layering fades with distance (no contour-line stripes), red strata anti-aliased, paler sunlit
  granite on high ground away from the hub, snow no longer blooms into a white haze, distant forest floors read as
  canopy, badlands soil patches; bioluminescent forest / jungle floors at night (crack lines, moss dots, soft carpets).
- **Flowers:** meadow flower patches and bioluminescent flowers (hub plant library) from the grass stream.
- Seam views moved onto the ring passes where the highways leave the hub; `src/frontier/README.md` (contract + exact
  integration steps).
- Shots: `shots/frontier/final-*.png` (1280×720) and `j-*.png` / `i-*.png` (960×540).

## Integration (exact steps for the integrator)
1. After the world is installed (`ctx.world = await installWorld(...)`) and BEFORE anything replaces `ctx.world.getHeightAt`:
   ```js
   import { createFrontierWorld } from './frontier/index.js';
   const frontier = createFrontierWorld(ctx, { seed: welcome?.world?.seed ?? 'o-universe', quality: ctx.engine.quality.id, renderNodes: false });
   ctx.frontier = frontier;
   ctx.worldgen = frontier.worldgen; // smp / combat / net reuse this instance (same seed as the server!)
   ```
   On a seed change (server welcome with another seed): `frontier.dispose()` and create it again.
2. Delegate the world queries (identical to the hub inside ±1200 m; keep the hub originals for hub-only code):
   ```js
   const w = ctx.world;
   w.hub = { getHeightAt: w.getHeightAt, getNormalAt: w.getNormalAt, isWater: w.isWater, raycast: w.raycast };
   w.getHeightAt = frontier.getHeightAt;
   w.getNormalAt = frontier.getNormalAt;
   w.isWater = frontier.isWater;            // hub rivers/lake rules inside, height < −0.3 beyond
   w.getWaterHeightAt = frontier.getWaterHeightAt;
   w.raycast = frontier.raycast;            // height-field march on the combined heights
   ctx.physics.setTerrain(frontier.getHeightAt);
   ```
3. Loop: `ctx.loop.add('frontier', (dt) => frontier.update(dt, ctx.camera), { order: 12 })` (world modes only; the
   group lives in `ctx.world.scene`, so other scenes never draw it). It follows `quality:change` by itself.
4. Hide the hub's distant backdrop ring: `ctx.world.terrain.backdrop.mesh.visible = false`.
5. Lift the play bounds (`WORLD.playBounds` 1050 → e.g. `WORLD_LIMIT` 90 km from shared/defs/world.js) in characters /
   vehicles clamps.
6. Minimap / map: after the hub layer, `frontier.minimap.draw(ctx2d, centerX, centerZ, metersPerPixel, { rotate })`
   (`{ rules: true }` in build mode shows where building is refused).
7. Physics for POI models (optional): every ~1 s add/remove `ctx.physics.addBox(...)` for `frontier.collidersNear(px, pz, 120)`.
8. Server: `server/worldgen.js` already loads `shared/worldgen/index.js` with the Node-baked hub heightfield — the same
   seed gives the same heights, nodes (`n:<cx>:<cz>:<i>`), POIs, highways and build verdicts as the client.
9. Resource nodes: keep `src/build/harvest.js` streaming wilderness nodes from the provider (interaction, depletion) and
   pass `renderNodes: false` (as above) so they are not drawn twice; `frontier.nodes` still lists the streamed nodes.
