# Audio — requests & integration notes

Everything below is optional: audio null-checks all of it. Public API: `ctx.sound`
(see the header of `src/audio/index.js`); recipes are registered on `ctx.audio`.

## everyone
- **Recipes you can play** (all procedural): `ui.click ui.hover ui.open ui.close ui.error toast
  chat (opts.variant: msg|send|system|say) dialogue.open interact quest.update quest.complete
  reward build.place build.remove build.invalid build.mode (opts.active) harvest (opts.resource:
  metal|stone|wood|energy) footstep (opts.surface, speed, side) jump land (opts.speed, surface)
  vehicle.enter vehicle.exit vehicle.summon launch laser explosion (opts.size 0.3–2, distant,
  pitch) shield.hit boost dock warp`; loops `scan {progress}`, `car.engine {rpm, load, boost}`,
  `vtol.engine {thrust, rpm (rotor), speed (m/s), altitude (m), boost}`, `ship.engine {thrust, boost}`,
  `ambient.*` and `music.*` (driven by the director — please don't start those yourself).
- **No doubles:** audio only *fills in* sounds for `build:*`, `harvest`, `ui:toast`, `ui:modal`,
  `vehicle:*`, `space:dock/kill/damage`, `interact`, `chat:sent` when nothing else played a
  one-shot within ~150 ms of the event. Play your own sound right before/after emitting and the
  fill-in stays silent. `data-sound="none"` on a button silences the hover/click delegation,
  `data-sound="ui.open"` picks another click sound, `data-sound-hover="none"` only the hover.
- Gameplay loops (engines, scan) still running ~2 s after a mode change into another "world"
  (title/customize ↔ explore/drive ↔ space) are faded out by audio as a safety net
  (`ctx.sound.debug().reaped` counts them). Within explore ↔ drive nothing is touched.
- `ctx.sound.director.setMusic('music.festival' | null)` forces / releases a music cue.

## core
- **Output stage:** audio inserts `mute gain → safety limiter (−3 dB, 20:1)` between the four
  buses and `buses.master` on `audio:ready` (re-routes each bus with `bus.disconnect()` +
  `connect(mute)`); master volume and the core compressor are untouched. A core `muted`
  flag / exposed compressor node would make this unnecessary.
- `play()` disconnects its chain after `maxDuration` (6 s); all audio one-shots end < 5 s and
  clean themselves up (`Graph.finish()`), so no change needed.

## vehicles
- `vtol.engine` now reads `rpm` as rotor speed (blade-pass rate), `speed` in m/s only (the old 0–1 vs m/s
  guess made the air rush jump at ~1 m/s) and `altitude` (rotor wash grows near the ground) — drive.js
  already sends all of these; nothing to change. 2026-10-27: rebuilt as a deep tilt-rotor (no whine > 800 Hz).
  `summonAndEnter('vtol')` from the spawn now works (3 runs, loop starts/stops). FYI: it returned
  null after first driving the car ~70 m from the spawn, and `summonAndEnter('car')` returned null
  where the VTOL had just landed (summon spot search?) — not an audio issue.
- Optional: emit `vehicle:launch {type: 'ship'}` *before* switching to space mode, the
  `launch` roar then plays across the transition.

## space
- Everything already wired (your own laser/explosion/shield/dock/warp/scan/engine sounds).
  `explosion` honours `pitch` (small bright hit at 1.6, `size` defaults to 1/pitch).
  Positions are relative to the listener; audio calls `ctx.audio.setListener(engine.camera)`
  every frame (order 55), so your space camera is used automatically.

## systems
- Starfall: festival music plays while `event:start {id: 'starfall'}` is active and the
  listener is within ~260 m of the plaza (fades out to explore music beyond ~330 m).
