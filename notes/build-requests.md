# Build — requests & integration notes

Everything below is optional: the build module null-checks other modules. Public API: see the
header of `src/build/index.js` (`ctx.build`).

## everyone
- Placed pieces live in `scene` under the group `build-structures` (instanced meshes, one per piece
  variant × material) and have physics boxes with tag `'build'` (owner = structure id). Floors,
  foundations, roofs, stairs and the landing pad are walkable; walls are solid, not walkable.
- `ctx.build.placeAt(pieceId, {x, z, rot, free})` places through the same snapping + validation as
  the crosshair (aiming straight down at x/z) — handy for tests and scripted scenes.
- Events: `build:mode {active}`, `build:select {category, piece}`, `build:placed {piece, category, id,
  position, name, level}`, `build:removed {…, refund}`, `build:invalid {reason, text, piece}`,
  `build:level {level, prev, points}`, `harvest {resource, amount, source: 'node', node, position}`,
  `power:change {production, consumption, net, capacity}` (per-minute rates).

## shell
- Thanks: the explore key hints already hide on `build:mode`; build hints use the bottom-right slot.
- On-screen edge markers clamped to the right screen edge (e.g. "Lookout 319 m") are drawn over the
  resources panel (top-right, ~22–245 px). Clamping edge markers below the top-right slot (or
  hiding them behind HUD panels) would keep the panel readable.
- Esc while the pointer is locked: browsers release the lock first; the shell then opens the pause
  menu while build mode stays active (a second Esc / B leaves build mode). If the shell skipped
  `input:lockLost` → pause while `ctx.build.active`, Esc would leave build mode directly.

## audio
- Used: `build.place`, `build.remove` (with `{position}`), `build.invalid`, `harvest` (with
  `{position}`), `ui.click` (piece/category change), `ui.hover` (rotate), `ui.open` / `ui.close`
  (enter / leave build mode), `reward` (base level up).

## systems
- "Een thuis bouwen" completes by building (verified): foundation (category `structure`, piece
  `foundation`), 4 walls (`wall`, `glass-wall`, `window-wall`, `door-wall`, `half-wall`), a roof
  (`flat-roof`, `pitched-roof`; the `canopy` is in the roof category too), power (`solar-panel`,
  `generator`, `battery`, `light-mast`, `fusion-core`) or `power:change` with production > 0.
- Note: `isFoundation` also matches the other STRUCTURE pieces (cube module, stairs, tower…),
  which is fine for the quest.
- "Build a Home" only counts `build:placed` events after the quest starts (zone trigger). A player
  who already owns structures (save from before the quest, or pieces placed in the same frame the
  zone trigger fires) has to build new ones. Optional: when the quest starts, pre-complete the
  objectives from `ctx.build.structures` (types: `foundation`, walls `wall|glass-wall|…`, roofs
  `flat-roof|pitched-roof`, power `solar-panel|generator|battery|light-mast|fusion-core`).
- Blueprints `decor-statue`, `decor-neon-tree`, `power-fusion` unlock the pieces as soon as they
  are in `state.owned.items` (the piece strip shows a lock + "Blueprint" until then).

## vehicles
- Player-built landing pads: `ctx.build.registry.records` entries with `type === 'landing-pad'`
  (`x, y, z`; the deck top is at `y + 1.1`, 8 × 7 m) could serve as extra VTOL landing spots.

## core (touch)
- The default `build` touch layout in src/core/touch.js fits: build mode reads the core action map
  (`place`, `remove`, `rotate`, `cycle`, `slot1`–`slot6`, plus `build` to leave), so the virtual
  Mouse0 / KeyX / KeyR / Tab / KeyB taps work. The keyboard hints (bottom-right) hide on
  `body[data-touch='1']`; the build bar categories and the piece strip are tappable.
