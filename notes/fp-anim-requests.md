# fp-anim (first person + character actions) → other owners

Owner: fp-anim engineer — `src/characters/**` (+ optional cockpit view in `src/vehicles/drive.js`). Log: `notes/fp-anim-progress.md`.

## Contracts that exist now (2026-10-28)
- `ctx.player.holdTool(mesh | toolId | null, {grip, tip?, support?})` — built-in models for `axe`, `plasma-axe`, `pickaxe`,
  `mining-laser` (tool-models.js); any mesh in the tool convention (origin = right grip, handle +Y, striking face −Z,
  `userData.tip`). A drawn weapon rides holstered while a tool is held. Returns `{object, grip, id}` | null.
- `ctx.player.playAction(name, {at?, speed?, item?})` → duration (s) | false (busy / dead / swimming).
  Work: `chop` `mine` `gather` `eat` `use` `build`; combat: `shoot` `reload` `hit` `dodge` `die` `respawn`.
  `at` (Vector3) = the target: the 3P torso / item frame aim at it and the impact `dir` points there.
  `item` (eat / use) = the food / item id shown in the hand (berries, mushroom, jungle-fruit, raw-meat, ration, medkit, …).
- `ctx.player.actionTiming(name, tool?)` → `{dur, impact, move}` (know the cadence before swinging);
  `ctx.player.action` → `{name, t, dur, impact}` | null (the running one).
- Events: `action:start {action, tool, item, duration, impact, view}`, `action:impact {action, tool, view, at, dir, count}`
  on the impact frame (same frame in 3P and FP; the FP view model adds hit-stop + rebound + a small shake),
  `camera:mode {mode: 'third' | 'first', fov}`, `remote:impact {id, action, tool, at}` (a remote avatar's swing lands —
  hook remote chop / mine sounds or chips here if you like).
- `ctx.player.toolSocket` (Object3D, world matrix = tool tip / working hand, correct in BOTH views),
  `ctx.player.muzzleWorld(out)` (FP: the view-model muzzle mapped onto the world camera ray → tracers start at the gun on
  screen), `ctx.player.view` ('third' | 'first'), `ctx.player.firstPerson` ({setView, toggle, view, viewModel, settings}).
- Camera: `ctx.cameraRig.view`, `fpW` (0…1 blend), `firstPerson` (bool), `aimRay()` (from the eye in FP, `near` = 0.22),
  `pitchRange` → `[min, max]` of the current view (FP looks almost straight up / down).
- Settings (applied live by characters, persisted by state): `settings.camera` ('third' | 'first'), `settings.fov`
  (50–110, default 70 — 3P follows at half the change), `settings.headBob` (true).

## integrator (shared/sim/players.js, shared/protocol.js)
1. **Work anim states for remotes.** Please add `'chop', 'mine', 'gather', 'eat', 'use'` to `ANIMS` in
   `shared/sim/players.js` and **export it** (`export const ANIMS = new Set([...])`). The client detects support at
   runtime (dynamic import of players.js → `ANIMS.has('chop')`) and only then sends these states in `C.STATE a`; until
   then it sends `'idle'` for them (no stale 'aim' / 'walk' on remotes) and remote avatars swing on `S.FEATURE {by, tool}`
   instead (one swing per validated hit). Doc line in protocol.js `C.STATE a`: `… | chop | mine | gather | eat | use`.
   Test to extend: `src/characters/test/avatars.test.js` "netAnim contract" (I add the work states there once accepted).

## threats (src/combat)
2. **V belongs to the camera now** (input action `camera` = KeyV, PLATFORM brief). `controller.js` still reads raw
   `input.pressed('KeyV')` for the quick grenade; characters consume KeyV when the camera toggles (deleted from
   `input._pressed` in the explore update, before combat at order 21), so V never throws any more. Please move the quick
   grenade to another key (G is free in explore — `garage` uses KeyG only near a garage; or `KeyT`) and tell ux for the hints.
3. **Recoil clamp in first person:** `rig.pitch = clamp(rig.pitch + k, -1.15, 0.72)` snaps the view down when firing while
   looking up more than ~41° in FP (FP allows −1.52 … 1.45). Use `const [lo, hi] = rig.pitchRange ?? [-1.15, 0.72]` (new
   getter) or drop the clamp (the rig clamps every update anyway).
4. FYI first person: the drawn weapon's model object (`w.group`) is re-parented into the view-model overlay scene while FP
   is active and given back in 3P — `w.pulse()` / `setCharge()` keep working (same object). ADS = `player.aiming` (RMB);
   the view model centres the sight line, the world FOV zooms ×0.74, `combat/hud.js` `.is-fpaim` already hides the ring.

## ux (src/shell)
5. Settings → Camera: **View** (Third person / First person) → `state.settings.camera`; **Field of view** slider 50–110
   (default 70) → `settings.fov`; **Head bob** toggle → `settings.headBob`. All apply live (characters subscribe).
6. Help / controls: `V` (or scroll all the way in / out) switches the view; touch: a **View** button joins the explore /
   combat cluster when it has ≤ 6 buttons, and "Camera view" is always in the touch menu (menuExtra).

## gather / survival (FYI, nothing blocking)
7. For the hold-to-gather loop: `const d = ctx.player.playAction('chop', {at: target, speed})` → swing length;
   `action:impact` arrives once per swing at `impact` s (send C.HARVEST / spawn chips there); a new swing is accepted
   from 82 % of the running one (chains flow without a dip). `eat` with `{item: 'berries'}` shows the berries in the hand.

## threats (src/combat) — 2026-10-28 16:20
8. **Crash when firing:** `src/combat/controller.js` calls `pitchRange(rig)` at lines 629 / 1094 / 1630 but no such
   function is defined or imported → `[loop] system "cbt-control" threw ReferenceError: pitchRange is not defined`
   (seen in an offline FP ADS-fire run). Suggested helper: `const pitchRange = (rig) => rig?.pitchRange ?? [-1.15, 0.72];`
