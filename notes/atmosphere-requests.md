# Atmosphere — requests & integration notes

Everything below is optional: the atmosphere null-checks all of it. Public API is on
`ctx.world` (contract) and `ctx.world.atmosphere` (helpers, see the header of
`src/world/atmosphere/index.js`).

## everyone
- **Time of day**: read `world.dayFactor` (0 night … 1 day; ≈ 0.43 at the 17.6 golden hour, so
  window lights are already on) or listen to `world:time` {hour, dayFactor} (emitted at most
  once per game minute and on every `setTimeOfDay`). `world.atmosphere.nightFactor` is 0 by day
  … 1 at full night.
- **Fog**: all built-in materials get the atmospheric height fog + sun-tinted haze
  automatically. Custom `ShaderMaterial`s: spread `THREE.UniformsLib.fog` into the uniforms
  (after the world installed), set `fog: true` and use the standard `#include <fog_*>` chunks.
- **Planar reflection** (lake/sea, high quality only): the world scene is re-rendered mirrored
  at half resolution, but each pass is *mirror-culled* automatically
  (`src/world/atmosphere/reflection-cull.js`): Points/Lines, tiny instanced props (geometry
  radius < 1.1 m: tufts, flowers, pebbles), sub-pixel objects, objects under the water and
  objects whose reflection would land on land are skipped. You only need
  `ctx.world.atmosphere.excludeFromReflection(object)` for things that *would* pass that test
  but should not be mirrored (e.g. glow sprites or decals lying on the water). Objects with
  `frustumCulled = false` are never mirror-culled (their bounds are unknown) — keep correct
  bounds + `frustumCulled = true` where you can. Stats: `world.atmosphere.reflection.cull.stats`.
- **Emissive glow**: bloom threshold stays 0.88–0.9 (HDR) at all times of day; use
  `emissiveIntensity` ≥ 1.5 for things that must glow. Bloom strength is lower at golden hour
  (0.3) than at night (0.55).
- **Taking over the grade**: `world.atmosphere.post.enabled = false` (or
  `post.override = { exposure, bloomStrength, bloomRadius, bloomThreshold, uSaturation, … }`)
  if a mode needs its own look; restore afterwards.

## shell (title)
- `world.setTimeOfDay(h)` is cheap now (the PMREM environment refresh is deferred to the next
  world tick), so pinning the title hour is fine.
- The planet + moons are analytic sky bodies, not Object3Ds:
  `world.atmosphere.bodies = { planet: { direction, radius }, moons: [{ direction, radius }, …] }`
  (unit vectors, angular radii in radians). Planet: azimuth 0° (due north), elevation 17°,
  radius 12.5°; moons at (17°, 15.5°) and (13°, 10°). With the current title camera (fov 40,
  pitch −0.7°) the planet centre sits right at the top edge and its lower half hangs over the
  city like `crop_hero.png`. A pitch of about +1.5° would show a bit more of it if wanted.
- The poster hero is a *high* vantage point looking down over the lake; the more of the lake
  is in frame, the more the sun-glitter path and the city reflections sell the shot.

## landmarks
- The beacon sky beam is very bright/wide in the title view (it sits right next to the hero).
  A slimmer beam, or fading it during the golden hour (`world.dayFactor`), would keep the
  poster composition calmer.
