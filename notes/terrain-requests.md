# Terrain — requests & integration notes

Everything below is optional: the terrain null-checks other modules. Public API
on `ctx.world` (contract) and `ctx.world.terrain` (extras, see the header of
`src/world/terrain/index.js`).

## everyone — long terrain shadows (new)
- The terrain bakes a **sun-visibility map** on the GPU (hills, ridges and cliffs
  cast long golden-hour shadows anywhere on the map; re-baked when the key light
  moves > 0.3°). Terrain, grass, trees and rocks already use it.
- Things standing in a valley in terrain shadow will otherwise stay sunlit. One
  line fixes that for any `MeshStandardMaterial`/`MeshPhysicalMaterial` (it wraps
  `onBeforeCompile`, keeps your own hook and program cache key):
  `ctx.world.terrain?.sunVisibility?.applySunVisibility?.(material)`
  (per-vertex, by world position; pass `{ at: 'instance' }` for instanced meshes
  to sample once per instance origin). Good candidates: characters/NPCs,
  vehicles, base house, ruins, beacon, plaza props.
- CPU query: `ctx.world.terrain.sunVisibility.sample(x, z, y?)` → 0 (shadow) … 1 (lit),
  e.g. for gameplay ("rest in the shade") or audio. Texture:
  `sunVisibility.texture` (R8, uv = worldXZ / 2400 + 0.5).

## landmarks
- Done (thanks for the list): no grass inside the plaza disc (r 86), the spaceport
  rect + hangar apron, the lookout footing (r 8), the base house rect
  (x −282…−246, z 324…360), the landing pad, and short wet-shore grass (20 %)
  around the obelisk (r 13). Trees, bushes and rocks keep ≥ 4 m outside all of
  those footprints (`FOOTPRINTS` in `src/world/terrain/shape.js`).
- `ctx.world.vegetation.clearArea(x, z, r)` removes plants and rocks (incl. their
  physics boxes) if a landmark needs more room somewhere.

## atmosphere
- New mesh `terrain-cliffs` (group `rocks`): dedicated rock faces along the
  waterfall escarpments, slightly lakeward of the heightfield face, with a notch
  (no rock) within ±(width/2 + 2.5) m of every `WATERFALLS[].lip`. The falls
  still hug `getHeightAt` there, so nothing should change for the falling water.
- `world.terrain.sunVisibility.texture` might be useful for the water too
  (shadowed lake shallows / mist in terrain shadow).

## shell
- `world.terrain.data` / `textures.splatA|splatB|normal` / `vegetation.layers`
  keep their layout. `splatB.r` (rock) now also marks exposed bedrock outcrops on
  hillsides, so the baked map shows rocky patches there.
