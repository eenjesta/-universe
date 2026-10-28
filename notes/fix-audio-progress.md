# Fix: audio engines (VTOL "rotgeluid, pieperig") — progress log

Owner of this task: src/audio/** only (vehicles drive the loops read-only from src/vehicles/drive.js).

## Plan
- [x] 1. Lab: add spectral metrics (centroid, >2 kHz energy, tonal peak > 900 Hz, click score) + steady-state cases
- [x] 2. Baseline measurements (before) for vtol/car/ship engines + laser/boost/warp/scan
- [x] 3. New vtol.engine (two rotors: AM'd low-passed noise whump + soft thumps, warm turbine hum 70–180 Hz,
        quiet slow whine < 900 Hz, thrust wash, speed rush; heavy smoothing; continuous speed mapping)
- [x] 4. Review car/ship engines + laser/boost/warp/scan (tame anything shrill on laptop speakers)
- [x] 5. After measurements + WAVs (shots/audio/), click test with 60 Hz jumpy set() calls
- [x] 6. In-game: drive vtol/car start/stop loops, errors [] ; build check

## Findings
- drive.js: `sound = ctx.audio.loop('vtol.engine', {volume: .9})`, every frame
  `set({thrust, boost, rpm: ctrl.rotor, load, altitude, speed (m/s)})`; stop(0.5) on exit.
  Controller thrust jumps instantly (digital keys: 0.35 / 0.6 / 0.75 / 1); rotor is damped (0.15 idle → 0.75–1 flying).
- Old vtol: two sine whines at 1.4–3 kHz and 2.1–4.5 kHz + Q=6 band-passed white noise at the same pitch
  (= the "pieperig" beeps, swooping with every key press), sawtooth AM (hard edge → buzz), 55 Hz hum
  (inaudible on laptop speakers). Bug: speed ≤ 1.01 treated as 0..1, > 1.01 as m/s → air rush jumps
  between full and ~0 while hovering slowly.

## Baseline (before) — node src/audio/dev/run-lab.mjs --only engines (scratchpad audio/before.json)
centroid Hz / >2 kHz % / tonal peak > 900 Hz (dB over local median @ Hz) / segRms / laptop RMS (HP 180)
- vtol@idle 113 / 0.4 / 38@2239 / −20.0 / −31.8      vtol@hover 224 / 1.0 / 40@2939 / −19.6 / −28.7
- vtol@climb 370 / 11 / 37@2358 / −19.2 / −26.6       vtol@cruise 509 / 14 / 32@2595 / −19.0 / −25.3
- vtol@boost 779 / 19.6 / 30@3004 / −18.3 / −23.5     vtol:game 390 / 9.8 / click 12.6 (steady 4.6–21.7)
- car@cruise 240 / 0.9 / 9@1992 / −15.6 / −20.6       car@boost 522 / 4.5 / 33@1540 (whine) / −13.5 / −15.9
- ship@full 208 / 2.4 / 22@1195 / −15.8 / −24.5       ship@boost 529 / 7.7 / 23@1798 (whine)
- laser 2148 / 52 / 6.6@2918; boost 197 / 0.2 / 11@1270; warp 469 / 4.3 / 15@1572; scan 391 / 0.35 / 27@1647
- WAVs: shots/audio/{vtol_hover,vtol_cruise,vtol_game,car_game,ship_game}-before.wav

## After (lab, same metrics; WAVs shots/audio/*-after.wav vs *-before.wav, CLI: node src/audio/dev/wav-metrics.mjs)
centroid / laptop centroid (HP 180) / >2 kHz % / tonal peak > 900 Hz / dB(A) / blade rhythm (env. modulation)
- vtol@idle 129 / 228 / 0 / none / −35.9 / 87%@13.5 Hz      vtol@hover 171 / 307 / 0 / 0.3 dB / −28.3 / 80%@19 Hz
- vtol@cruise 226 / 390 / 0.02 / 1.8 dB / −24.4 / 86%@23 Hz  vtol@boost 283 / 468 / 0.09 / 1.9 dB / −21.9 / 78%@24 Hz
- before: hover 229 / 1327 / 1.0 / 39.6 dB@2.9 kHz / −29.2 / 11%; cruise 495 / 1905 / 13.8 / 32 dB@2.6 kHz / −25.4
- loudness: laptop-A level unchanged (hover −29.1 vs −29.3) → as present as before, no beep; car cruise −23.8 dB(A),
  vtol cruise −24.4, music in game ≈ 6 dB below the engines. Peaks ≤ 0.78 (in game ≤ 0.55 on the sfx bus).
- clicks: vtol:game (60 Hz set(), instant key jumps) 12.5 dB vs steady 6.8–14.3 → no clicks / zipper from params.
- car: whine 1.3–1.5 kHz (33 dB) → 175–760 Hz quiet + slow vibrato; LP max 4 → 2.8 kHz, Q 3 → 2.2. Remaining
  "tone" at high rpm = growl harmonics (character). Loudness unchanged (car:game −22.3 → −22.5 dB(A)).
- ship: whine 1.2–1.8 kHz → 230–740 Hz; jet band ≤ 2.1 kHz; afterburner 1.1–3.2 kHz, triangle flutter (square clicked).
  boost centroid 524 → 301, laptop centroid 2006 → 1273, tonal peaks 23 → 2 dB.
- laser 1.9/3.8 kHz start → 1.5 kHz + 760 Hz body, LP 3 kHz: centroid 2148 → 1167, >2 kHz 52 → 17 %.
- boost whistle 1.2→2.4 kHz sine → 520→1040 Hz soft; warp shimmer softer FM / quieter top bell / whooshes ≤ 2.8 kHz;
  scan ticks 2.2–3.6 kHz → 1.15–1.85 kHz soft + LP, noise band 2.6–4.4 → 1.5–2.4 kHz, sweep 440–1320 → 330–990 Hz.
- full lab: 81 cases, 0 problems (no silence / clip / NaN).

## In game (tools/shot.mjs, quality=low, __game.debug.simulate to drive; AnalyserNode on the sfx bus)
- VTOL: enter → vtol.engine loop; idle −26.3 dB / 128 Hz, hover −21.3 / 162 Hz, forward 46 m/s −19.2 / 210 Hz,
  boost 76 m/s −18.6 / 264 Hz, >2 kHz ≤ 0.07 %; land (C) + F → loop released; errors [].
- car: enter → car.engine; exit (F, vehicles fade) → loop released (slow under SwiftShader, core stop timer 600 ms).
- note: the rAF loop doesn't advance during shot.mjs evals here → use __game.debug.simulate() to drive vehicles.

## Build
- npx vite build --outDir /tmp/build-fix-audio --emptyOutDir → ✓ built.

## Files
- src/audio/recipes/engines.js (new vtol.engine; car/ship whines + filters), src/audio/recipes/space.js (laser, boost,
  warp), src/audio/recipes/game.js (scan), src/audio/lib/dsp.js (shapeWave, 'hum' wave),
  src/audio/dev/lab.js + run-lab.mjs (steady / 60 Hz game cases, new columns, --only engines, --suffix),
  src/audio/dev/metrics.js (new, shared measurements), src/audio/dev/wav-metrics.mjs (new, WAV CLI),
  notes/audio-requests.md (vtol API: speed m/s, altitude).

## Status: DONE
