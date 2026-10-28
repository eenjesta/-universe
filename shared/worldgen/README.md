# shared/worldgen — the infinite planet around the hub

Pure JS (no DOM, Node APIs or three.js), synchronous, deterministic per `seed` + hub heightfield, bit-identical in
Node, browsers and Web Workers (only + − × ÷, floor, sqrt in anything that decides heights, biomes or ids).
PLATFORM.md §11 (one seamless planet) and §11.2 (keeping the hub open). Tests: `node --test shared/worldgen/*.test.js`.

```js
import { createWorldgen } from '../shared/worldgen/index.js';
const wg = createWorldgen({ seed: 'o-universe', hub: { heightAt, isWater, getWaterHeightAt, radius: 1100, blend: 300 } });
```

## Hub seam
* `hub.heightAt` is the hub's ORIGINAL height function (server: `sampleGrid(bake.heights)`, client: the terrain's
  `world.getHeightAt` captured before anything delegates it). `extent` (default 1200) = half-size of the hub heightfield/mesh.
* `heightAt` = the hub height for |x|, |z| ≤ 1200 (exact, so the hub mesh, vegetation and roads stay put); beyond it the
  hub border profile (sampled once every 2 m) is extended outward with its own slope (C1 across the seam) and blended
  into the procedural terrain over `blend` m (1200 → 1500 m) with a smoothstep.
* Safe zone = the hub square |x|, |z| ≤ `radius` (1100). `hubDist(x, z) = max(|x|, |z|) − 1100`.
* No POIs (hubDist < 260), resource nodes and enemy spawns (hubDist < 200) near the hub; no building where hubDist < 500.

## API (instance)
| member | |
|---|---|
| `CHUNK_SIZE` (64), `waterLevel` (0), `seed`, `hub` {radius, extent, blend, noBuild, spawnBuffer, present} | |
| `heightAt(x, z)` / `getHeightAt` | combined height (hub · seam · procedural · POI pads · highways) |
| `normalAt(x, z, out?)` | unit normal (±1 m central differences); `out` may be a Vector3 or `{x,y,z}` |
| `isWater(x, z)` / `getWaterHeightAt(x, z)` | hub rules inside the hub mesh, else height < −0.3 / water level 0 |
| `isSafe(x, z)`, `hubDist(x, z)` | safe zone + distance outside it |
| `biomeAt(x, z)` → `{ id, index, name: {en, nl}, weights: {id: w} }` | `String(biomeAt(...)) === id` ('hub' inside the safe zone) |
| `biomeIdAt(x, z)` → id string | cheap form |
| `chunk(cx, cz, { lod = 0, features = true })` | `{ cx, cz, x0, z0, size, cells (32 >> lod), step, heights: Float32Array((cells+3)²)` with a 1-cell skirt (sample (i, j) at `x0 + (i−1)·step`), `biome: Uint8Array((cells+1)²)` (255 = hub), `weights: Uint8Array((cells+1)²·8)` (0–255), `biomes` (index → id), `features }` |
| `features(cx, cz)` | `[{ id, type: 'tree'|'bush'|'rock'|'crystal'|'node'|'ruin'|'outpost'|'wreck'|'waystone', variant, x, y, z, rot, scale, biome, resource?, radius?, name?, loot? }]` |
| `nodesNear(x, z, r)` | resource nodes `{ id: 'n:<cx>:<cz>:<i>', type: 'node', resource: metal|stone|wood|energy, x, y, z, rot, rotY, scale }` (stable ids for server harvest validation; LRU-cached per chunk) |
| `spawnRules(x, z, hour)` | `{ biome, density, list: [{ type: 'drone'|'stalker', w, max, nightOnly }], poi }` or null (safe zone + 200 m buffer, ocean) — more at night, POIs guarded, calmer along highways |
| `spawnTable(biomeId, hour)` | `[{ enemy, weight, max, nightOnly, density }]` |
| `poisNear(x, z, r)` / `poiAt(x, z)` | `{ id: 'p:<ci>:<cj>', type: 'ruin'|'outpost'|'wreck', variant, x, y, z, rot, radius, name, biome, loot: {table, tier} }` |
| `highways` | 7 roads `{ id: 'hw-<k>', name, bearing, gate {x, z, side}, points: Float64Array [x, y, z …] every 10 m, length, waystones: [{ id: 'w:<k>:<km>', x, y, z, rot, km }] }` |
| `roadsNear(x, z, r)` | `[{ id, name, width, distance, point, dir, along, heading }]` nearest point per road |
| `isOnHighway(x, z, margin = 0)` | on the 10 m paving (+margin) |
| `isBuildable(x, z)` → `{ ok, reason?, need?, poi? }` | static §11.2 rules: `'safe'`, `'hub'` (+`need` m), `'highway'` (< 20 m from a centreline), `'poi'` (< pad radius + 60 m) |
| `rules` | `{ noBuild: 500, highwayClear: 20, poiClear: 60, heightLimitDist: 2000, heightLimit: 16 }` — the §11.2 numbers (the sim enforces the dynamic ones: height limit, claims) |
| `highwayDistance(x, z, reach = 60)` | exact distance to the nearest centreline up to `reach` (Infinity beyond) |
| `describe(x, z)` | debug: height, biome, climate, fields, build verdict, nearest road / POI, spawn rules, `text` |
| `exportForWorker()` | plain data (hub border profile + coarse 8 m hub grid + highway polylines) → `createWorldgen(data)` in a worker reproduces everything beyond the hub mesh bit-for-bit |

Module exports: `createWorldgen`, `isSafe(x, z)` / `hubDist(x, z)` (hub square, no instance needed), `CHUNK_SIZE`,
`BIOME_LIST`, `BIOMES`, `BIOME_INDEX`, `HIGHWAY`, `POI_TYPES`, `PLANETS`, `snowAt`, `FIELDS` (terrain scratch slots).

## Geography
Continents + oceans (warped ~16 km fBm), beaches (~7 % at the waterline), archipelagos, lowland rivers + lakes
(carved to −2.6 / −3.4 m, the global water plane fills them), rolling hills, ridged mountain chains (a ring continues
the hub's mountains on the land sides), stepped table-land plateaus, terraced red mesas cut by canyons. Hub themes
fade out over ~16 km: open sea N/NE, jungle W (Lumen Jungle), red badlands E (Sunfall Canyon), forests / meadows /
highlands / peaks S. Biomes (ids, en / nl): `ocean` Open Sea / Open zee, `coast` Azure Coast / Azuurkust, `meadow`
Golden Meadows / Gouden Weiden, `forest` Lumen Forest / Lumenwoud, `jungle` Lumen Wilds / Lumen-wildernis,
`highlands` Crystal Highlands / Kristalhooglanden, `badlands` Sunfall Badlands / Zonneval-woestenij, `peaks`
Frost Peaks / Vorstpieken. Weights blend over ~0.3–1 km.

## Highways (§11.2 — keeping the hub open)
Seven land bearings (NW, W, SW, S, SSE, SE, E). Gate = lowest point of the smoothed hub border profile within ±260 m of
where the bearing leaves the hub mesh; route = weighted A* on a 70 m grid in a ±1.2 km corridor (cost: length ×
(1 + 30·grade²), steep > 10 %, water, a push away from the hub border so roads never hug the ring mountains, and a
penalty where a 9 % road from the gate could not follow the ground), smoothed and resampled every 10 m; profile =
smoothed terrain, grade ≤ 9 %, ≥ 1.6 m above water (causeways). Mountains and mesas are damped within ~300 m of a road
(passes and valleys), the paving is flat over 6.5 m and blends into the terrain by 20.5 m. Where the road still runs
> 3 m above / below the ground (near the hub's ring mountains: up to ±90 m) the terrain follows it in a wide shoulder
(20.5 + 2.4·|fill| m, ≤ 160 m) — tall fills become natural spurs carrying the road, deep cuts become cuttings / passes
(no walls; blended over all nearby segments, so it stays continuous). Waystone beacon every km.

How the hub stays open (the owner's question "hoe zorgen we dat ze niet om de sociale hub alles heenbouwen en
dichtbouwen?"): nothing can be built in the safe zone nor within 500 m of it (a 500 m ring nobody can wall off), the
seven highways cross that ring and run ~7 km out with a 40 m no-build corridor each (`isBuildable` → `'highway'`), POIs
keep a 60 m clearance, and the sim adds the dynamic rules (16 m height limit within 2 km, one claim per player, ≥ 30 m
between claims, 30-day decay). The dev lab's `overlay=rules` (src/frontier/dev/lab.html?view=rules) paints exactly these
verdicts on the terrain and the minimap.

## Planets
`createWorldgen({ seed, planet: 'kepler-o7' })` without a hub: no highways, a flat safe landing meadow (150 m) at the
origin, the same biomes with the profile's biases (`PLANETS` in terrain.js — the seam for later planets).
