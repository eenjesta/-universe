# Shell → requests to other modules / core

The shell works without any of these (local workarounds are in place), but the
results get better if the owners pick them up. Status as of the latest shell pass.

## For everyone taking title screenshots
- On software GL (SwiftShader, headless tests) the title card thumbnails start
  **25 s after `game:ready`** and the camera intro is skipped, so title shots
  with the usual `--wait 6000–12000` are not slowed down by the shell. Add
  `&thumbs=0` to never render them (placeholders), `&thumbs` to render at once.
- At the current machine load a high-quality frame can take 5–20 s, which
  makes Playwright's default 30 s screenshot timeout in `tools/shot.mjs` fail
  (“taking page screenshot … fonts loaded … Timeout”). What works: stop the
  loop before the shot (`const L = __game.loop; L.systems = []; L.render = () => {}`),
  wait until `requestAnimationFrame` round-trips are fast again, then capture —
  the compositor keeps showing the last rendered frame.

## core
- `tools/shot.mjs`: a `--shotTimeout` option (or a built-in “freeze” step as
  above) would make screenshots reliable on a loaded machine.
- While the in-game pause menu is open the shell wraps `ctx.loop.render` so the
  frozen frame is only re-rendered on demand (first frames, resize, quality
  change) instead of 60×/s; the original is restored on close (with a
  watchdog). A core option (`loop.renderWhilePaused = false`) would be cleaner.
- `ctx.engine.snapshot` always renders at full canvas resolution; an optional
  internal render size would make the four title thumbnails cheaper.

## space
- **Title card 4 thumbnail.** Please expose `ctx.space.previewCamera` (a
  `PerspectiveCamera` framing ship + asteroids + planet as they are right after
  install) or `ctx.space.renderPreview(width, height) → canvas`. The shell uses
  them first. Without them it uses `ctx.space.camera` only when the module is
  more than the bare fallback, otherwise it renders its own small space
  vignette (ship, asteroids, planet, nebula — `src/shell/title/spaceVignette.js`).

## world (atmosphere) — resolved
- `world.atmosphere.bodies.planet` now exposes the planet direction (not
  needed so far: the title camera composes on the sun + city and the planet
  sits in the top of that frame, cut by the edge as on the poster). The
  atmosphere already stops time flow in title mode — thanks.

## systems — resolved
- The quest marker carries `tracked: true`; the compass strip shows its
  distance. `ctx.shell.track(markerId)` can still override it.
- Fast travel uses `state.progress.discovered` (plus spawn/base and places the
  shell saw the player visit, `state.shell.visited`).

## characters — resolved
- `explore` honours `{ resume: true, position: { x, z, heading } }` (the shell
  still teleports if the player ends up > 25 m away) and `chr-player-idle`
  poses the player on the title.
- Thumbnails temporarily move `player.object` for one snapshot and restore it
  in the same frame. If the player is drawn through a batch, the thumbnails
  simply won't show the player.
