# Audio module — progress log

## Status
- [x] 1. Core helpers (src/audio/lib/dsp.js, lib/voices.js) — verified via lab
- [x] 2. One-shot recipes (recipes/ui.js, game.js, space.js) + loops (scan, engines.js) — measured
- [x] 3. Ambient loops (recipes/ambient.js) — measured
- [x] 4. Music (music/instruments.js, composer.js, pieces.js, recipes/music.js) — measured
- [x] 5. Director (director.js) — verified in game: title→explore→plaza(murmur .94)→festival→night→space→title
- [x] 6. Event wiring (wiring.js) — verified: no doubles (build/harvest/toast/modal/journal/btn), throttles ok
- [x] 7. index.js + mixer.js (voice limits, reaper, mute+limiter stage) — installs with 0 errors
- [x] 8. Dev lab (src/audio/dev/lab.html + lab.js, runner: node src/audio/dev/run-lab.mjs [--only a,b] [--wav label])
- [x] 9. In-game verification (unlock, mode switching, soak, vehicles/space integration, nl, settings, hysteresis)

## Findings (read before continuing)
- Sounds already played by other modules (do NOT wire again): systems plays quest.update
  (objective done + notifier), quest.complete (notifier, delayed with the banner), reward,
  toast (notifier banner), chat (NPC messages only), dialogue.open, ui.* in menus, harvest +
  explosion (meteors), warp (signal). Shell plays ui.click/hover/open/close/error itself.
- Most ui.toast callers already play a sound → toast/modal/click/hover use "fill-in"
  (play only when no other one-shot started in a short window).
- player:footstep {surface: grass|stone|metal|wood|water|sand|rock, side, speed},
  player:land {speed}, player:jump {position}.

## Lab results (2026-10-27)
- All 64 cases non-silent, peak < 0.94 after rebalancing (quest.complete clipped at 1.28 before; fixed).
- Music RMS ≈ −18…−21 dBFS, peaks 0.45–0.6. Offline render ≈ 0.2× real time on the loaded box
  after chunked offline scheduling (offlineAt suspend/resume) + filter-free plucks.

## In-game results
- t1 (scratchpad batch): locked before gesture, running after key press; loops per mode correct.
- t2: wiring de-dup verified; dialogue ducks music 0.85 → 0.38 → 0.85.
- Soak 5 min: voices 0 at end, loops 5, live AudioNodes 3656 (GC lag) → 302 after 8 s, heap flat 286 MB.
- Full `vite build` fails only in src/vehicles (another engineer's missing ./traffic.js at that time);
  audio builds clean with a scoped config (scratchpad vite.audio.config.mjs, input src/audio/index.js).

- t3: car.engine runs in drive and stops on exit; space module's ship.engine + music.space +
  ambient.space; reaper killed nothing legit; mute ok; ?lang=nl ok (no player-facing strings in audio).
- Full `vite build` passes again (vehicles fixed by its owner); lab re-run 0 problems.
- Requests/notes for other modules: notes/audio-requests.md.

- t4 (default quality): settings → bus gains ok (music 0/0.5, sfx 0.4 → ambient 0.32), real walking
  footsteps play, 0 errors.
- t5: festival at plaza → still festival at ruins (271 m, hysteresis) → explore at spawn; water/city
  loops only run while audible; waterfall roar 0.95 panned right. Director throttle now uses
  max(game dt, real dt) so slow frames don't stall it.

## Status: DONE (brief's "Done when" met). Remaining ideas only: npc voice babble, vtol in-game check.

## 2026-10-27 fix: engines ("vtol rotgeluid, pieperig") — see notes/fix-audio-progress.md
- vtol.engine rebuilt (rotor whump + thumps + warm hum, no tone > 800 Hz); car/ship whines moved < 800 Hz;
  laser/boost/warp/scan tamed for laptop speakers. Lab: `--only engines`, spectral/loudness/click columns,
  WAV CLI src/audio/dev/wav-metrics.mjs. VTOL in-game check done (loop start/stop, errors []).
