# Ø Studio (src/studio/**) — progress log

Owner: studio engineer (platform layer v1). Contract: PLATFORM.md §10; brief in the workflow task.

## Plan
1. format.js (pure: experience format v1, validate/normalize, limits, text filter, templates) + collide.js
   (pure: rotation-only local-space SDF shapes, spatial hash, ray vs unit shapes) + node tests.
2. scene.js — shared 3D for editor + runtime: part materials (object-space triplanar detail, per-instance
   colour/alpha, neon HDR), geometries (wedge…), PartRenderer (InstancedMesh buckets, signs, light pool,
   spawn decals), sky presets (gradient sky + PMREM env + hemi/sun), baseplate + grid.
3. store.js — local drafts/published (localStorage, in-memory with ?nosave) + cloud adapter (ctx.platform.api).
4. editor.js + editor-ui.js + studio.css — mode 'studio' (camera, select, box select, gizmos, undo/redo,
   clipboard, explorer, properties, settings, autosave, publish, play-test).
5. runtime.js — mode 'experience' (collision world, controller, avatar, checkpoints/kill/finish, HUD, touch).
6. index.js — ctx.studio = { available, open(draftId?), play(json, {from}) … }, URL hooks.

## Decisions
- Runtime collision: own SDF world in src/studio/collide.js instead of the shared ctx.physics — the shared
  hash holds the hub's landmark/structure boxes at world coordinates (they would leak into the experience)
  and only supports yaw rotation (no wedge ramps / tilted parts). Nothing global is swapped, so leaving the
  experience can't corrupt the world physics.
- Part rotation `r` is stored in DEGREES, Euler order 'YXZ' (yaw, pitch, roll — like Roblox Orientation).

## Status
- (start) read PLATFORM.md, ARCHITECTURE.md, core modes/engine/physics/input/ui/touch, characters API.
- (run 1) wrote ALL modules: format.js, collide.js, scene.js, store.js, templates.js, icons.js, editor.js,
  panels.js, dialogs.js, runtime.js, index.js, studio.css, studio.test.js (8/8 node tests pass). Not yet
  verified in a browser.
- (run 2, resume) re-read everything; next: build check → browser checks (editor, play-test, publish local,
  API publish via own server :8097) → fixes/polish → screenshots.
- (run 2) VERIFIED in the browser (dev :5199 + own server :8097 with the real /api): editor mouse select,
  gizmo X drag (1 m snap), undo/redo, Ctrl+D, box select, copy/paste, Delete, library insert, settings +
  publish dialogs, play-test walk/jump/fall-respawn, touch joystick; cloud: register → save (create) →
  publish → GET → ctx.studio.play(response) → reopen via ctx.studio.open(cloudId).
  FIXED: stale world post look in Studio scenes (per-sky exposure/bloom/grade, saved+restored), brighter
  readable lighting, planet/sun disc, outline colour, `_d2` leaking into light parts' JSON, light-pool
  visibility toggles (shader recompiles), autosave on wall-clock (+idle cloud debounce, retry, flush on
  exit, publish waits for in-flight saves), draft extraction ({draft:{data}}), Esc in play-test → editor,
  explorer refresh on rename/colour, play counting/best-time keys, creator label. Tests 11/11.
- (run 2, later) VERIFIED obby behaviours with __game.debug.simulate (frame-independent; the box runs at
  load ~42 so SwiftShader frames stall for seconds): laser kill → respawn, checkpoint, respawn at checkpoint,
  jump pad 16 m/s, finish + best time, fall < −50 m → respawn; local publish → listLocal → playLocal;
  Leave → Home; Esc in play-test → editor; Studio exit → title/Home. 4001 parts: 25 draw calls, pick 1.2 ms,
  move-all 34 ms, group/undo/redo ≈ 0.2 s, runtime ≈ 3 ms/physics step.
  FIXED: exit target 'boot' when Studio was opened at boot (normFrom), contextOf() inside an experience,
  O(n²) selectionItems, i18n of two labels, banner legibility, sign glow, obby light placement, avatar
  rebuilt when the appearance changed.
- Requests written: notes/studio-requests.md (platform-client: play `local` items via ctx.studio.playLocal).
- (run 2, final) inserted models select as one group (name in Properties); hidden unanchored parts don't
  force rebuilds; final shots (medium, 1280×720): shots/studio/final-editor.png, final-editor-model.png,
  final-playtest.png, final-tablet.png (1024×768 touch). Build passes; node tests 11/11; page errors [].
  platform-client adopted ctx.studio.playLocal for local Home items.

## Status: DONE (v1). Follow-ups: creator logic (`logic` array), multiplayer per experience (v2), a public
avatar factory from src/characters (requested), unanchored-part physics beyond "fall until resting".
