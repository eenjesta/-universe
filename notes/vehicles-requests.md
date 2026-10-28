# Vehicles — requests & integration notes

Everything below is optional: the vehicles module null-checks all of it. Public API: header of
`src/vehicles/index.js` (`ctx.vehicles`).

## space
- `createColonyShipModel(opts)` lives in `src/vehicles/colony-model.js` (also re-exported from
  `src/vehicles/index.js` and on `ctx.vehicles.createColonyShipModel`). Front −Z, origin on the hull centre
  line, ~150 m (`opts.length`), `opts.legs: false` for flight (no landing legs), `opts.lights` (window /
  strip brightness, default 1), `opts.lifters` (belly glow 0…1). `userData.engines` = 4 Object3D at the
  rear nozzles (local +Z = exhaust direction), `userData.lifters` (belly, local +Z points down),
  `userData.update(dt)` blinks the nav strobes, `userData.setLegs(0…1)`, `userData.groundOffset`.
  Materials are shared module singletons (do not dispose them); `userData.dispose()` frees geometry only.
- The atmospheric ship uses your `createShipModel({ variant: 'player' | 'gold', gear: true })`
  (wrapped: origin on the ground, boarding stairs, engine glow sprites). `skin-ship-gold` → variant 'gold'.
- Launch: `vehicle:launch {type: 'ship', id}` then `ctx.modes.go('space', { from: 'planet' })` (with fade).
  Return with `ctx.modes.go('explore', { zone: 'spaceport', arrival: 'ship' })` — vehicles puts the ship
  back on pad 01 and the player at the foot of its stairs.

## shell
- In mode `drive` the vehicle HUD sits in the bottom-center slot (~110 px high). On-screen markers
  clamped to the bottom screen edge (e.g. "Jules 341 m" when the target is behind) are drawn over it —
  clamping edge markers above ~150 px from the bottom in `drive` would keep the speedometer readable.

## audio
- Loops are started on every `vehicle:enter` with `ctx.audio.loop('car.engine' | 'vtol.engine' |
  'ship.engine', { volume: 0.9 })` and updated every frame:
  car `set({ rpm 0…1, load 0…1, boost 0|1, speed m/s })`,
  VTOL / ship `set({ thrust 0…1, boost 0|1, rpm (rotor 0…1), load, altitude m, speed m/s })`;
  `stop(0.5)` on exit / launch.

## systems
- `ctx.vehicles.current` = the driven vehicle record `{ id, type: 'car'|'vtol'|'ship', object, heading,
  speed (m/s), velocity }`; `ctx.vehicles.list` includes the parked colony ship (`type: 'colony'`).
- Extra events: `vehicle:land {type, id}` (VTOL / ship touched down), `vehicle:arrived {type, id}` (a
  summoned air vehicle finished landing next to the player).
- Market skins: the garage reads `state.owned.items` / `state.owned.skins`; on `market:buy` the bought
  skin is applied at once. The selected skin is saved in `state.vehicles.skins`.

## atmosphere / landmarks (optional, visual)
- At the default time (17.6) the spaceport apron and the base clearing sit in deep shadow, so the dark
  vehicles read mostly as silhouettes + light strips there (16.4 looks great at the base, see
  shots/vehicles/final_base.png). A little warm fill / pad floodlight contribution on the apron and the base
  landing pad would help the "15_spaceport" look. Vehicles keep one shared SpotLight (car headlights) in the
  scene permanently, so no light-count recompiles come from this module.
- The spaceport fuel tanks have no physics box for the camera rig to collide with (the rig clips into them
  when the player stands right next to one).
