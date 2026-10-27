# Landmarks — requests & integration notes

Short list of things other modules can do to make the landmarks fit perfectly.
All landmark data lives on `ctx.landmarks` (see the header of `src/landmarks/index.js`).

## terrain
- **Local workaround active (07:30):** landmarks now lowers the grass-density channel (B) of
  `world.terrain.textures.splatB` inside its built-up footprints once at install (plaza disc +
  shophouse row, spaceport rect + hangar, beacon shore r 12, promenade, city islands; soft 1.5–4 m
  edge) and calls the public `world.vegetation.clearArea` for trees/rocks inside buildings
  (`ctx.landmarks.groundStats` reports the counts). It only touches those texels and is skipped if the
  terrain API changes. A terrain-side `NO_GRASS` entry (below) would still be cleaner.
- **Grass grows through the plaza paving** (seen in every plaza shot): the plaza pad only scales grass
  by `1 - dirt*0.92` (≈ 17 % density left). Please add to `NO_GRASS` in `src/world/terrain/surface.js`:
  `{ x: 360, z: -150, r: 86, k: 0 }` (paved Nexus-plein, incl. curb) and zero grass inside the
  spaceport rect (x 375…570, z 170…335) + hangar footprint (paved apron), `{ x: -280, z: 30, r: 8, k: 0 }`
  (lookout footing) and `{ x: -120, z: -164, r: 13, k: 0.2 }` (wet shore around the signal obelisk).
- Hangar footprint: thanks — already flat at 14 m (checked at all four corners).
- Please keep trees / rocks / grass out of these footprints (they are built-up areas):
  plaza disc r = 86 around (360, −150); ruins r = 40 around (250, 95) (except the roads);
  lookout r = 8 around (−280, 30); signal r = 16 around the obelisk (≈ (−120, −163), on the shore);
  spaceport rect + hangar footprint; base: house rect ≈ x −282…−246, z 324…360 and the landing pad
  (−186, 368) r = 9; city islands (`CITY_ISLANDS`, r × 0.97).
- `CITY_ISLANDS` should be dry land at ≈ 3 m. If an island is missing (mostly water), landmarks
  build an artificial platform (sea wall + deck at 3 m) there automatically.

## characters
- `ctx.landmarks.spawnFor(zoneId)` returns a free arrival spot `{x, z, heading}` (plaza: south of
  the tree facing it; lookout: at the foot of the stair; signal: in front of the obelisk; base: in
  front of the house; spaceport: near pad 01). The zone x/z of `plaza` is the tree trunk and of
  `lookout` the tower core (both have solid colliders).
- Lookout stair: `ctx.landmarks.lookout.stairStart {position, heading}` and `stairPath` (centre
  line points, rise 0.39 m per step, square spiral, 8 flights) — useful for NPC routes / tests.
- Plaza NPCs: `plaza.walkPoints` (on the paving, outside props), `plaza.benches` ({position = seat
  point, rotY = facing}), `plaza.spawnPoints`, `plaza.stage.crowdPoints`, `plaza.treeInfo`
  ({position, footprint}). Promenade benches are appended to `plaza.benches`;
  `lake.promenade.walkPoints` are extra strolling points along the lake.

## systems
- Ruins: `ruins.scanPoints[0]` is the big Ø relief (stand-on point on the terrace in front of it);
  `[1…]` are rune stones. `ruins.setScanProgress(0…1)` makes the Ø glow gradually while holding E;
  `ruins.setScanned(true)` = full cyan glow.
- Beacon: `beacon.setActive(bool)` — **active by default** (sky beam visible from afar as a guide).
  `beacon.front` is a free spot in front of the obelisk (Aria).
- Plaza: `plaza.setShow(true)` starts the Starfall light show (beams sweep over the crowd, planets
  spin, holograms brighten); `plaza.market` = terminal position (the hologram terminal faces the tree).

## vehicles
- `spaceport.pads.{ship|vtol|car|colony}` = `{x, z, rotY, radius, position}` — `position.y` is the
  top of the raised pad (0.14 m above the apron; walkable physics box). Colony pad is a floor
  marking inside the hangar (`spaceport.hangar.floorY`).
- Base landing pad: `house.landingPad {position, rotY}` (raised 0.9 m deck, walkable, stairs).

## shell
- Optional: call `ctx.landmarks.precompile()` while the title screen is idle to warm up all
  landmark shaders (avoids first-view hitches on slow GPUs).
- POI markers: ids `poi-<zone>` (kind `poi`, Dutch labels, icons `lm-*` registered in the icon
  set); only `poi-city` has `screen: true`.

## systems (update 07:30)
- `ruins.runeStones: [{ stand, center }]` now exists (same order as `scanPoints[1…]`; `center` = middle
  of the glowing rune column on the stone face).
- Relief scan: `setScanProgress(p)` now lights the engraving progressively *along its lines* (ring
  clockwise from the top + the slash from the lower left, with a bright scan front) at a moderate cyan
  gain; only `setScanned(true)` gives the full flowing glow. No more white bloom at 64 %.
- Beacon: `setActive(false)` is now a real dormant look — faint breathing emblem, light line and veins
  at ~30 %, only the inner ground rings breathe faintly, no pulses/sky beam/motes, weak point light.

## atmosphere
- Beacon sky beam is now slimmer (core r 0.42 → 0.28 m, halo r 1.5 m at 30 % gain) and nearly invisible
  at golden hour (5 %), full only after dusk; the obelisk's light line was toned down from 5× to 2.6×.
