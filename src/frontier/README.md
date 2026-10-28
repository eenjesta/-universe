# src/frontier — the infinite planet around the hub (client renderer)

PLATFORM.md §11 (one seamless planet) + §11.2 (keeping the hub open). The generator lives in
`shared/worldgen` (pure JS, same code on the server, contract in `shared/worldgen/README.md`); this folder
streams it into the **existing** world scene, only outside the hub mesh square (|x|, |z| > 1200 m), under the
hub's own sky, giant planet, water plane, fog, sun, shadows and time of day. It never creates a scene, sky,
water or lights.

```js
import { createFrontierWorld } from './frontier/index.js';
const frontier = createFrontierWorld(ctx, { seed, quality, renderNodes });
// per frame (world modes): frontier.update(dt, ctx.camera)
```

| member | |
|---|---|
| `group` | THREE.Group inside `ctx.world.scene` (terrain tiles, vegetation, rocks, crystals, grass + flowers, nodes, POI models, waystones, highway ribbons) |
| `worldgen` | the `createWorldgen({ seed, hub })` instance (share it: `ctx.worldgen = frontier.worldgen`) |
| `getHeightAt(x, z)` / `getNormalAt(x, z, out?)` | COMBINED: the hub's exact heights inside ±1200 m, the seam blend 1200 → 1500 m, procedural beyond (POI pads + flattened highways included) |
| `isWater`, `getWaterHeightAt` | hub rules inside the hub mesh, `height < −0.3` / water level 0 beyond |
| `isSafe(x, z)`, `hubDist(x, z)` | safe zone = hub square ±1100 m; distance outside it |
| `biomeAt(x, z)` | `{ id, index, name: { en, nl }, weights }` (`String(…) === id`, `'hub'` inside the safe zone) |
| `isBuildable(x, z)` → `{ ok, reason }` | §11.2 static rules: `'safe'`, `'hub'` (hubDist < 500 m, + `need`), `'highway'` (< 20 m of a centreline), `'poi'` (< pad + 60 m) |
| `roadsNear(x, z, r)`, `isOnHighway(x, z, margin)`, `highways` | the 7 protected highways (`worldgen.highways`) |
| `raycast(origin, dir, maxDist)` / `raycastInto(…, out)` | height-field march + bisection on the combined heights → `{ point, normal, distance }` or null; `group`'s terrain also answers `THREE.Raycaster` outside the hub |
| `nodes` | `Map id → { id: 'n:<cx>:<cz>:<i>', type: metal|stone|wood|energy, x, y, z, rot, scale }` streamed around the camera (same ids as the server's `nodesNear`) |
| `pois` | `Map id → { id: 'p:<ci>:<cj>' or 'w:<road>:<km>', type: ruin|outpost|wreck|waystone, … }` streamed around the camera |
| `collidersNear(x, z, r)` | box colliders of the streamed POI models (world space) for `ctx.physics.addBox` |
| `minimap.draw(ctx2d, cx, cz, metersPerPixel, { rotate, rules })` | top-down biome colours + hill shade, highways, waystones, POI markers, outside the hub square; `rules: true` adds the §11.2 zones |
| `setOverlay('biomes' | 'rules' | false)` | debug colours on the terrain (`'rules'` = hatched no-build zones, green = buildable) |
| `update(dt, camera)`, `setQuality(id)`, `quality`, `enabled`, `busy`, `ready`, `stats()`, `dispose()` | |

Quality (`FRONTIER_QUALITY` in index.js; follows `quality:change` by itself):

| | terrain reaches | vegetation | grass + flowers | caps |
|---|---|---|---|---|
| low | 3.2 km | 600 m (trees 60 %) | — | 3 000 trees |
| medium | 4.6 km | 1 000 m (85 %) | 48 m | 7 000 trees |
| high | 6 km | 1 500 m | 70 m | 12 000 trees |

## Integration (exact steps for the integrator)

1. After `ctx.world = await installWorld(ctx, …)` and BEFORE anything replaces `ctx.world.getHeightAt`
   (the hub's original height function is captured here; `opts.hubHeightAt` overrides):
   ```js
   const frontier = createFrontierWorld(ctx, { seed: welcome?.world?.seed ?? 'o-universe', quality: ctx.engine.quality.id, renderNodes: false });
   ctx.frontier = frontier;
   ctx.worldgen = frontier.worldgen; // smp / combat / net reuse it (same seed as the server!)
   ```
   On a seed change (a server `welcome` with another seed): `frontier.dispose()` and create it again.
2. Delegate the world queries (identical to the hub inside ±1200 m; keep the originals for hub-only code):
   ```js
   const w = ctx.world;
   w.hub = { getHeightAt: w.getHeightAt, getNormalAt: w.getNormalAt, isWater: w.isWater, raycast: w.raycast };
   w.getHeightAt = frontier.getHeightAt;
   w.getNormalAt = frontier.getNormalAt;
   w.isWater = frontier.isWater;
   w.getWaterHeightAt = frontier.getWaterHeightAt;
   w.raycast = frontier.raycast;
   ctx.physics.setTerrain(frontier.getHeightAt);
   ```
3. Loop (world modes only; the group lives in `ctx.world.scene`, other scenes never draw it):
   `ctx.loop.add('frontier', (dt) => frontier.update(dt, ctx.camera), { order: 12 })`.
4. Hide the hub's distant backdrop ring: `ctx.world.terrain.backdrop.mesh.visible = false`.
5. Lift the play bounds: `WORLD.playBounds` (src/world/layout.js, 1050) is used by vehicles/fleet.js,
   vehicles/controllers.js, build/placement.js, shell/map — use `WORLD_LIMIT` (90 km, shared/defs/world.js)
   beyond the hub, or skip the clamp when `ctx.frontier` exists.
6. Minimap / map: after the hub layer, `frontier.minimap.draw(ctx2d, centerX, centerZ, metersPerPixel, { rotate })`
   (it clips out the hub square ±1200 m itself). In build mode pass `{ rules: true }` to show where building is refused.
7. Physics for POI models (optional): every ~1 s, add/remove `ctx.physics.addBox(…)` for `frontier.collidersNear(px, pz, 120)`.
8. Server: `server/worldgen.js` already loads `shared/worldgen/index.js` with the Node-baked hub heightfield — the
   same seed gives the same heights, node ids, POIs, highways and build verdicts as the client.
9. Resource nodes: keep `src/build/harvest.js` (interaction / depletion) and pass `renderNodes: false` so they are
   not drawn twice; `frontier.nodes` still lists the streamed ids.

## Dev lab

`/src/frontier/dev/lab.html?view=seam-west&time=17.6&quality=medium` — fly camera (click = mouse look, WASD,
Shift ×6, Space / C, wheel = speed), teleport, views (seams at the highway gates, every biome, coast, mountains,
POIs, night, 100 km out, `rules`), time slider, quality switch, overlay (biomes / build rules), stats, minimap.
`&x=…&z=…&alt=…&yaw=…&pitch=…&overlay=rules&ui=0` for screenshots (`node tools/shot.mjs`, `__game.lab.settle()`
waits until streaming is done).
