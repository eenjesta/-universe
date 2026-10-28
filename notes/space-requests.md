# Space — requests & integration notes

The space module works without any of these (everything is null-checked / has local
fallbacks). Public API: see the header of `src/space/index.js` (`ctx.space`).

## systems
- Events emitted (payloads):
  `space:enter {from, stage}` · `space:scan {target: 'anomaly' | 'wreck'}` ·
  `space:convoy {status: 'start' | 'attack' (+ wave, waves) | 'safe' | 'lost'}` ('safe' only once the
  convoy reached Station Halo with all three pirate waves destroyed; mid-mission words never match
  your /safe|…|defend|…/ filter) · `space:dock {station: 'halo'}` ·
  `space:kill {enemy: 'pirate', id, by: 'player', wave}` (player kills only; wingmen kills don't count) ·
  `space:damage {shield, hull}`.
- Quest markers: `ctx.space.station` ({position, radius ≈ 1100, dockRadius 260, dock, object}),
  `ctx.space.anomaly` / `ctx.space.wreck` / `ctx.space.convoy` (Object3Ds), `ctx.space.targets`
  (Vector3s), player ship `ctx.space.ship.position`. Markers with scope 'space' are drawn by the space
  HUD (on-screen diamond + distance, radar diamond); the station / anomaly / wreck / convoy get their
  own POI markers unless a quest marker sits within 120 m of them.
- Docking pays 150 credits once (first dock, `state.space.docks`) and repairs + restocks every time.
- State: `state.space = { scanned: {anomaly, wreck}, convoyDone, docks }`.

## audio
- Used: `laser` (player shots; AI shots ~35 % with `position`, pitch 0.8 pirates / 1.1 wingmen),
  `explosion` ({position, volume}; also hull hits with pitch 1.6), `shield.hit`, `boost`, `dock`,
  `warp` (arrival + landing), loop `scan` (`set({progress})` while holding E), loop `ship.engine`
  (`set({thrust 0..1, boost 0|1})` every frame).
- Missiles currently play `laser` with pitch 0.45 — a `missile` recipe (whoosh) would be nicer.
- Music cue idea: `space:convoy {status: 'attack'}` → combat layer, `'safe' | 'lost'` → back to calm.

## vehicles
- `createShipModel(opts)` (src/space/ship-model.js): opts `{variant: 'player' | 'gold' | 'wingman',
  engineColor: 'orange' | 'blue' | 'red', plumes = true, gear = false, lite = false, scale = 1}`.
  userData: `engines` (2 main nozzles, +Z = exhaust), `thrusters`, `guns`, `size`, `groundOffset`
  (2.16 m with the gear down), `setThrust(throttle, boost)`, `setGear(bool)`, `update(t)` (nav-light
  blink + plume flicker), `materials`, `dispose()`.
- The colony ship in space comes from `createColonyShipModel({length: 250, legs: false, lights: 1.3})`
  (loaded via `import.meta.glob`, so it is optional); it is re-centred and its `update(dt, t)` is called
  with dt = 1/60. If it throws, `models.js#createColonyFallback` is used.

## shell
- Title card 4: `ctx.space.renderPreview(w, h)` poses the ship at the arrival point, applies the space
  post look (bloom / grade / exposure), renders through `engine.snapshot` and restores everything;
  `ctx.space.previewCamera` is exposed too.
- The pause menu still has Dutch-only strings for space ('In de ruimte', 'Je vliegt tussen de sterren…',
  'Wereldkaart') in `src/shell/menu/pauseMenu.js`.

## core / tools
- High-quality SwiftShader shots of the space scene take 1–2 min each under the current load (sky cube,
  planet maps and bloom at pixel ratio 1.5). Use the lab: `/src/space/dev/lab.html?stage=…&quality=low`.
