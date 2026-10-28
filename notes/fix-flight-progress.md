# Fix flight / chase camera / parked-ship visibility — progress log

Scope: src/vehicles/** (all), src/space/flight.js (player flight + chase camera only).
Not touched: src/characters (camera-rig request → notes/vehicles-requests.md), src/core, src/shell,
src/systems, src/audio, src/space shader/material/sky/nebula/asteroid files.
Scratch files: scratchpad/ff/ (shared scratchpad → own subfolder).

## Status — DONE (run 2, 23:10)
- [x] baseline measurements (before) — scratchpad/ff/b-vtol.log, b2.log
- [x] A: air attitude (VTOL/ship) + car attitude; drive-mode chase camera — measured a1/a3/a4, re-verified f1/f2/f6
- [x] B: space flight roll / chase camera — measured a4, re-verified f2 (+ f2_space_release.png)
- [x] C: parked ship visibility (golden hour + night), VTOL/car fill — medium shots c4 (17.6 / 20.0), d1 approach
      from the east road (First Flight marker path), d1 VTOL + car pads, f3 arrival at the stairs, f5 base-pad VTOL
- [x] D: vehicles shader / CPU NaN audit (see below)
- [x] camera-rig request written (notes/vehicles-requests.md → "characters (camera rig)"); drive.js works around it
- [x] build passes (npx vite build --outDir /tmp/build-fix-flight, 365 modules) — errors [] from vehicles everywhere

## Run 2 (resume 22:00)
- look.js: NaN-safe atmosphere inputs (core clamp() passes NaN); sun visibility smoothed (no popping at shadow
  edges, snapped on the first sample); mats.fill (car / VTOLs) now uses the shade at the DRIVEN car / VTOL
  (parked: the ship's, as before) → no golden-hour shade boost on a vehicle driven in the sun.
- ship-model.js wrapShip.setThrust: the planet core ×1.9 relies on the space model re-setting the colour each
  call (it does: setRGB(coreBase × k ≤ 1.6) → ≤ ~10 HDR) — now capped at 40 / reset if non-finite.
- controllers.js CarController: transform NaN guard (back to the last good position), like AirController.
- drive.js: the characters rig gained a combat aim mode (setAim) at 22:33 — drive mode clears it on enter and
  every frame (verified f6: entered the VTOL while aiming → aiming false, aimW 0, rig distance 15).
- Shots: the shared server now and then shows a Vite error overlay / module failures from OTHER in-progress
  modules (src/platform missing platform.css 22:4x, src/combat mergeGeometries 22:5x) — not vehicles; the
  overlay was removed in-page for the shots (f4/f5). Machine load ~30: keep medium batches ≤ 2 shots.

## D audit (src/vehicles)
- materials.js patchMaterial / patchFill: every division has max(·, ε) (uPanel, uWinCell, uSkinLen, texel,
  uUpRange span), fwidth floored (1e-4 / 1e-5), smoothstep edges ordered (seam: e1 = e0 + 1.5·pw > e0), no
  pow/normalize/log (fV = v·inversesqrt(max(dot, 1e-8)); glint = x^16 by squaring), fill output clamped
  0…16, roughness clamped.
- fx.js / traffic.js point shaders: dist = max(0.5 | 1.0, −mv.z), point size clamped, smoothstep(0.35, 1) /
  (0, 1); vertex-colour HDR ≤ 7; traffic HOT = step(1.001, …).
- CPU: spring() resets non-finite state; AirController + CarController transform guards; queueYaw ignores
  non-finite input; yawRate uses dt ≥ 1e-4; chase yaw guarded; car follow ÷ max(dt, 1e-3); geo.js strut/strip
  degenerate cases are safe in three r186 (normalize(0) → 0 → identity quaternion; lookAt eye==target handled);
  atan2 only (no acos/asin) in vehicles; space flight.js rollToLevel guarded (len > 1e-3, dot clamped).

## Findings

### Root causes (A)
- drive.js ran the AirController 2× per frame when dt > 21 ms and AirController.step applied the
  per-frame mouse delta (`-lookX*0.0026`) in EVERY substep, while the rig turned once → vehicle heading
  turned 2× the camera; the rig only re-aligned after 1.2 s without mouse movement (align 1.6/s), so with
  continuous mouse steering the camera ended up beside/in front of the vehicle (baseline: camErr up to
  ±179°). Camera pitch drifted with mouse Y and never recentred (to −40°).
- Fix: mouse yaw queued ONCE per frame (AirController.queueYaw) and eased in at 16/s (loss-free);
  drive mode owns the rig yaw/pitch (rig.lookEnabled=false, align 0): yaw = dampAngle → heading
  (air 8–9/s, car 4.5/s), free-look/pitch offsets spring back (ω 4.5) 0.9 s after the mouse goes quiet;
  mouse X on air vehicles = steering (camera stays behind). Attitude = critically damped springs toward
  input/velocity targets (bank ∝ yaw rate + strafe input, pitch ∝ commanded speed change + climb rate),
  clamped VTOL 25°/17°, ship 28.6°/24°. Velocity carves partly with the nose (VTOL 0.7, ship 0.55).
- Car: airborne pitch follows the trajectory, roll relaxes to 0 (was held) → always level on level ground.

### Final re-verification (run 2, low, f1/f2/f6: same 20 s program, then release)
- VTOL @30: |roll| ≤ 25.2° (clamp), |pitch| ≤ 10.6°, camErr ≤ 8.5° in flight → roll ≤ 0.5° 1.0 s, pitch ≤ 0.5°
  1.75 s (short flare), camErr ≤ 0.5° 0.25 s after release; final 0 / 0 / 0, vehicle at scr (0, −0.225).
- ship @30 (2 substeps/frame — the case that broke): roll ≤ 28.6°, pitch ≤ 13.7° (climb), camErr ≤ 9.7° →
  roll 1.25 s, pitch 1.75 s, camErr 0.5 s; final 0 / 0 / 0.
- car: jump roll 13.9° / pitch 16.1° → 0 / 0 within 0.75 s of landing; at rest 0 / 0; camErr 0 (look-around
  offsets of up to 87° spring back after 0.9 s; steady lag ~25° only in a 140°/s hand-brake circle).
- space: ship always centred (|scrX| 0.000, scrY −0.35…−0.33), camera roll vs ship ≤ 25° while rolling →
  roll vs horizon < 1° 1.5 s, model bank < 1° 1.0 s, camera aligned 0.75 s / roll 1.75 s after release.

### Measurements (low, simulate, 20 s mixed turns/strafes/climbs/boost, then release)
| | before | after |
|---|---|---|
| ship camErr in flight | up to ±179° | ±10.4° (turn lag) |
| ship camErr after release | 151° → 1° after 3.75 s | 0.6° @0.25 s, 0 @0.5 s |
| ship roll max / after release | 33° / ~1 s | 28.6° clamp / <1° @0.75 s |
| ship pitch after release | — | 5° flare → <1° @1.25 s |
| VTOL camErr in flight | up to −142° | ±8.5° |
| VTOL roll / pitch after release | — | 0 @0.75 s / <1° @1.25 s |
| ship @60 fps | — | same as @30 (frame-rate independent) |
| car after jump (roll 12°, pitch 16°) | — | 0/0 @0.75 s after landing, 0/0 at rest |
| space: roll vs horizon after stick release | (yaw added roll rate, no level) | 15° → 0.2° in 1.75 s; model bank → 0 in 1 s; scr pos const |

### C (look) notes
- Ship sits in terrain shadow at 17.6 (sunVis sample at the pad = 0); look.js state: lowSun 0.8, shade 1.
- Ship hull: space materials are per instance → retuned only on the planet (wrapShip/planetLook).
- Medium shots (copies in shots/vehicles/fix-flight/; originals scratchpad/ff): c4_1760 / c4_2000 (walk-up, 31 m: light gunmetal hull, warm glint, panel
  detail on the fin; night: silver-blue under the pad light), d1_approach_1760 (east road, 50 m, rear-left
  against the lit hangar: Ø fin, engines, lit edges), f3_arrival_1760 (foot of the stairs: warm uplight on the
  wing undersides, lit treads, no blow-out), d1_vtol_1760 / f5_base_vtol_1760 (VTOLs in shade: light hull +
  orange strips), d1_car_1760 (silver car + light strips). All readable at 17.6 and 20.0.
- The black box at the right edge of the c4 apron shots is not a vehicle (no vehicle mesh there).
