# Shader NaN/Inf audit — progress log

Task: static audit of every custom shader in src/world, src/landmarks, src/characters (material files),
src/systems (shader code), src/build, src/space for NaN/Inf sources (Apple GPU black pixels/lines/areas).
Not in scope: src/vehicles, src/core.

## Status
- [x] baseline screenshots (medium, 960x540) → scratchpad/shaders/shots/before-*.png (title, plaza, base20, signal, space)
- [x] audit files (list below)
- [x] fixes applied
- [x] build check passes (vite build → /tmp/build-fix-shaders), re-run after the last edit
- [x] after screenshots (medium, 960x540) title/plaza/base20/signal/space: identical apart from animation + film
      grain (pixel diff mean 1–6/255, no structural change); 0 console errors, __game.debug.info().errors = []
- [x] forced compile of every program (all 324 hidden world objects made visible + all 5 lazily created
      events/fx.js classes): 183 programs, 0 link/compile failures, 0 errors

## Key findings (why "light goes black in many places, then normal again")
- The sky shader also renders the equirect environment capture (uEquirect=1) → PMREM → scene.environment
  (IBL of every PBR material) + the water/river/waterfall reflection map. ONE NaN texel in that capture
  is blurred by PMREM over large parts of the env map → black patches on everything lit by IBL, until the
  next capture (every ~0.12 game-hour ≈ 15 s real time, or when the sun moves). The anti-sun haze pow()
  (already fixed in fog.js) was exactly such a direction-dependent NaN. Remaining sky NaN sources are fixed
  below and the capture output is now sanitised (bit test) so no future NaN can poison the IBL.
- MSAA (medium = 2x, high = 4x; low = off) evaluates varyings at the pixel centre even when it lies outside
  the triangle → uv / vertex colours are extrapolated slightly outside [0,1] at triangle edges →
  pow(1.0 - vUv.y, k) / sqrt(colour) of a negative value → NaN → black lines along mesh edges
  (only from medium up, matching the owner's report).
- Fresnel terms pow(1.0 - abs(dot(N, V)), k): with normalised N and V the dot can round to 1.0000001
  → negative base → NaN black dot where a surface faces the camera (sphere centres, flat faces head-on).

## Files reviewed
(all custom GLSL / onBeforeCompile patches + the CPU code feeding their uniforms)
- world/atmosphere: fog.js, sky-glsl.js, sky.js, index.js (uniform feeds), lighting.js, occlusion.js, time.js,
  palette.js (values), water.js, reflection.js, rivers.js, waterfalls.js, mist.js, islands.js, particles.js,
  flare.js, planet-texture.js, textures.js
- world/terrain: material.js, chunks.js (morph uniforms), grass.js, vegmaterial.js, rockmaterial.js,
  impostor.js, instancing.js, sunvis.js (cliffs/rocks/plants/backdrop/roads: no shader code, normals via three)
- landmarks: materials.js, tree.js, beacon.js, stage.js, plaza.js, city.js, cityTraffic.js, house.js, ruins.js
- characters: material.js, studio.js (surface-nets.js read for normal generation, not edited)
- systems: events/fx.js
- build: hologram.js, harvest.js, materials.js (already hardened, no change needed)
- space: sky.js, nebula.js, asteroids.js, fx.js, ship-model.js, station.js (mostly hardened already)

## Hazards found / fixed (file — hazard — fix)
- world/atmosphere/sky-glsl.js — env capture (uEquirect) feeds PMREM/IBL + water reflections; a single NaN texel
  spreads over the env map → capture output sanitised with a bit test (aFinite, NaN/Inf → 0; capture only).
- world/atmosphere/sky-glsl.js aClouds — sqrt(b² + (Rc-oy)(Rc+oy)) < 0 with the camera above the deck → sqrt(max(…,0)).
- world/atmosphere/sky-glsl.js planet — pow((ndlS-0.03)*8, 2.0), pow((rN-0.62)*22, 2.0), pow((rN-0.9)*60, 2.0):
  negative bases → explicit squares.
- world/atmosphere/sky-glsl.js — normalize(dir - moonDir) / normalize(dir - planetDir*dot) = normalize(0) on the
  exact body-centre ray → aNormalize (v * inversesqrt(max(dot, 1e-30))).
- world/atmosphere/sky-glsl.js aSphereUV — atan(0,0) at the body poles → guarded.
- world/atmosphere/occlusion.js deck() — Math.sqrt(<0) above the cloud deck → NaN latched into sunDimSmooth
  (and the key-light colour) forever → Math.max(0, …); index.js only integrates finite occlusion values.
- world/terrain/chunks.js — far LOD morph [1e9, 1e9+1] is ONE value in float32 → smoothstep(e, e, x) undefined
  → [1e9, 2e9] (same: never morphs).
- world/atmosphere/water.js — normalize(uSunDir + V) / normalize(uGlintDir + V) zero on the pixel looking exactly
  at the set sun → safeNormalize; eqUv atan(0,0) (reflection straight up) → guarded. rivers.js eqUv same.
- world/atmosphere/waterfalls.js plunge foam — atan(0,0) at the disc centre → guarded.
- world/atmosphere/particles.js fireflies — pow(0.5+0.5*sin(), 3) with sin overshooting -1 → max(…,0).
- world/atmosphere/planet-texture.js craters — pow((d-1)*3.2, 2.0) negative base → explicit square.
- world/terrain/impostor.js — removed tree instances have all-zero matrices → inverse() = Inf/NaN vertex
  positions → collapse them (transformed = 0) like the far-LOD cull.
- landmarks/materials.js lmRim (city facades/metal, stone) — pow(1-|dot(n,V)|, 3) with |dot| rounding > 1 → max(…,0).
- landmarks/materials.js fresnel (stage holo planets/rings, beacon spheres…) — pow(1-|dot|, uPower) → max(…,0).
- landmarks/materials.js paving — atan(0,0) at the plaza centre → guarded.
- landmarks/beacon.js crystal rim — pow(1-|dot|, 3) → max(…,0); pulse-ring atan(0,0) at the centre vertex → guarded.
- landmarks/tree.js foliage — thin = pow(1-|dot(normal,V)|, 2) → max(…,0).
- landmarks/ruins.js relief decal — atan(0,0) at the decal centre → guarded.
- characters/material.js — sheen sqrt(luma(diffuse)) with MSAA-extrapolated (negative) vertex colours → max(…,0);
  vNormal = normalize(0) for a zero surface-nets normal → inversesqrt(max(dot, 1e-30)).
- characters/studio.js vista — c/(1+0.75c) with an Inf texel = NaN → clamp(c, 0, 65504) first.
- systems/events/fx.js — MSAA uv extrapolation: streak pow(vUv.x, 2.6), beam pow(1-vUv.y, 1.6), echo pillar
  pow(1-vUv.y, 1.25), shock column pow(1-vUv.y, 1.4) → max(…,0) (black line along the top edge from medium up).
- space/sky.js planet + gas giant — fresnel pow(1 - max(dot(N,V),0), k) with dot rounding > 1 → clamp(…,0,1).
- world/atmosphere/fog.js atmoFogAvg — e0*(1-exp(-k))/k: exp(-k) → Inf while e0 → 0 when looking far down from
  very high up (Inf*0 = NaN) → same value written as (exp(-b*y0) - exp(-b*(y0+dy)))/k (no overflow).
- world/atmosphere/sky-glsl.js aCloudBand — atan(0,0) for the sun azimuth with the sun at the zenith → guarded.

## Checked, no change needed (unreachable / already guarded)
- (fixed anyway although unreachable today: fog overflow needs the camera > ~4.8 km up — ships switch to space
  at 600 m; aCloudBand atan(0,0) needs the sun at the zenith — max elevation 62°.)
- sky-glsl aMoon frame normalize(cross(X, up)) needs a moon at the zenith: moons are fixed at 10–15.5° → left as is.
- beacon/stage beam vV = normalize(-mv) per vertex then renormalised per fragment: only zero if the camera sits
  exactly on a beam edge → left as is (changing it would alter the beam look).
- build/* (hologram, harvest, materials) and most of space/* were already hardened (guarded normalisations, clamped HDR).
- terrain material/grass/rock/veg: normals reconstructed with sqrt(max(0,…)), cross-product normals guarded.

## Notes for other engineers (not in this task's scope)
- core/engine.js sanitize pass: it samples the HDR target with linear filtering. If a pixel ever holds +Inf
  (half-float overflow > 65504 on an extreme glint), bilinear taps with weight 0 compute 0 × Inf = NaN, so the
  neighbouring pixels could come out black. Sampling with texelFetch / nearest filtering in that pass avoids it.
- Dev labs (src/*/dev) have no shader code of their own; they reuse the modules audited above.

## Done
All custom shaders in scope reviewed; every hazard found is fixed or documented above; visuals unchanged; build passes.
