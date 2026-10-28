# fp-anim (src/characters/**) — progress log

Owner: fp-anim engineer (wave "survival play beter + first person"). Brief: first-person mode + FP view model,
tool actions (holdTool / playAction chop·mine·gather·eat·use·build) in 3P + FP + remotes. Read this first when resuming.
Test harness (not shipped): scratchpad `fp/h.js` (page helper `__fp()`), `fp/scenarios.mjs` + `fp/mk.mjs` (batch
generator: `node mk.mjs <scenario>` → `b-<scenario>.json` for `tools/shot.mjs --batch`), shots in `fp/shots/`.

## Assessment (played 2026-10-28 10:58, offline LocalServer, east badlands (1800, 300), simulate-driven)
What a player gets today in my area, worst first:
1. **No first-person view at all.** V (`input` action `camera`, KeyV) does nothing for the camera — and while armed it
   *throws a shock grenade* (combat's quick-grenade binding still reads raw KeyV: grenades 3 → 2 on one V press).
   `state.settings.camera / fov / headBob` don't exist yet (undefined).
2. **Gathering has no body.** `ctx.player.holdTool` is undefined and `playAction('chop' | 'mine' | 'gather' | 'eat' |
   'use' | 'build')` returns false: the gather slice can't show a swing, can't sync hits/FX to an impact frame, and the
   player can't hold an axe/pickaxe. Eating a ration/berries has no gesture either.
3. **Other players never see you work.** The sim's anim set lacks chop/mine/gather/eat/use and remote avatars have no
   tool models → a remote player harvesting a tree just stands idle.
4. **Camera feel is tuned for 3P only:** shake moves the camera ±12 cm (fine at 2.4 m, nauseating at the eye),
   `aimRay().near` assumes the head is in front of the camera, `muzzleWorld()` is the 3P hand — all wrong at the eye.
5. **3P aim framing:** the shoulder/head block a big part of the lower-left quarter while aiming, the rifle itself is
   barely visible (OTS distance 1.5 m, FOV 45) — a FP option fixes this for players who prefer it.
6. Tools & food don't exist as models anywhere (no axe/pickaxe meshes for local or remote players).

## Plan (priority order)
1. FP camera in camera-rig (eye point, smooth 3P↔FP transition, FOV/head bob/landing dip, near plane, wall/terrain
   push-back, death cam → 3P), V toggle + persistence + `camera:mode`, touch button; body hiding (upper body discarded in
   the colour pass only → full shadow stays; legs visible looking down).
2. View model (overlay scene + camera, own composer pass after the world RenderPass, depth cleared): stylised arms in the
   outfit colours, weapons/tools re-parented automatically, sway/bob/sprint/recoil/reload/ADS/grenade/swings/eat/use;
   `muzzleWorld()` projected from the view model into the world camera.
3. Tool API: `holdTool(mesh | id | null, {grip})`, `playAction(...)` → duration + `action:impact` event, 3P animator
   poses (wind-up → impact → recovery), procedural tool models (axe, pickaxe, plasma-axe, mining-laser), remotes.
4. Tests (node: timing/impact, FP camera math, net anim mapping) + browser checks + screenshots.
5. Optional: cockpit view in vehicles.

## Status
- (10:58) assessment done (shots: fp/shots/assess-3p-*.png).
- (12:10) M1–M3 code written: tool-actions.js (timing, ActionClock, kf), action-poses.js (3P keyframes), tool-models.js
  (axe, plasma-axe, pickaxe, mining-laser + food), weapon-rig.js (tool grips, item-frame IK, solveGesture, detach /
  forceHolster), animator.js (action layer: item frame, torso, crouch), player.js (holdTool, work playAction → duration,
  action:start / action:impact, toolSocket, FP hooks, net anims), material.js (fpHide variant: upper body discarded in
  the colour pass only), camera-rig.js (FP blend, pitch range, FOV/near, zoom-into-FP, aimRay from the eye),
  first-person.js (settings, V / touch / scroll, eye provider, death cam, dot), viewmodel.js (overlay pass, arms,
  items, poses, springs, actions with slerped direction keys, muzzle projection). Dev lab: src/characters/dev/fp-lab.html
  (?set=3p | fp) — contact sheets without the world (fast in SwiftShader).
- node tests: src/characters/test/fp-anim.test.js (12 tests) + avatars (7) → 19/19.
- (13:44) browser checks fp1 / fp2 / phone (offline, east badlands): FP idle, rifle hip / ADS / ADS-fire, axe ready,
  FP chop impact, 3P chop, phone (touch View button + menu entry) → all `errors: []`.
- (16:20, resumed after the crash) fixed the failing node test "view model … still lowering": `holdTool(null)` clears
  the tool rig before the view model sees it, so the axe popped out instead of lowering. Now a put-away tool always
  lowers out of view first (also when a drawn weapon comes back: the weapon stays hidden in the body's hand until the
  hands take it); weapon ↔ weapon swaps stay instant; a rig that moved on gets its `detached` flag cleared (its new
  item lives on the body in 3P). FP eat gesture raised into the lower centre of the view (was at the bottom edge).
  New check fp3 (FP mine, tool → rifle, eat) → `errors: []`. Final shots at medium 1280×720: scratchpad
  `fp/shots/final-*.png` (FP rifle hip / ADS / ADS-fire, FP axe ready, FP chop impact, 3P chop wind-up, sunset);
  phone: `fp/shots/phone-*.png`. npm test 303/303 pass, vite build ok.
- Seen in the final run (NOT mine): `[loop] system "cbt-control" threw ReferenceError: pitchRange is not defined` when
  firing — src/combat/controller.js calls `pitchRange(rig)` (lines 629 / 1094 / 1630) without defining it → request #8.
- Not done: optional cockpit view in vehicles (vehicles stay 3P — the rig only goes FP when it follows the player, so
  no clipping in cars / VTOL / ship). Seat eye points per model would need its own visual pass.
