# Avatars (src/characters/**) — progress log

Owner: avatars engineer (multiplayer + SMP v1). Contract: PLATFORM.md §7 + §11, brief in the workflow task.
Read this first when resuming.

## Files (mine)
- animator.js — combat layers (aim torso/pitch, strafe/backpedal, recoil, hit flinch, reload, dodge roll,
  die/dead collapse, revive, materialize), COMBAT_TIMING
- weapon-rig.js — WeaponRig: weapon placement (aim / carry / hand / holster) + two-bone arm IK; GRIPS presets
- weapon-models.js — procedural pistol / rifle / heavy meshes + RemoteWeapons (InstancedMesh per kind)
- player.js — holdWeapon / holster / setAim / aimAt / playAction / dodging / rolling / dead / netAnim / muzzleWorld
- camera-rig.js — aim mode (rig.aim settings, aimW blend, closer OTS + FOV 45) + aimRay() {origin, dir (= direction), near}
- combat-fx.js — respawn materialize beam pool
- labels.js — player tags (cyan, shield + health bars, dim when dead)
- remotes.js — ctx.remotes (add/remove/get/list/count/clear/mock), net views, LOD, weapons, vehicles;
  scene read lazily (re-parents everything when ctx.world.scene changes); view.w (weapon) read when present
- remote-vehicles.js — car / vtol / ship models (vehicles module factories, read-only) for drivers
- remotes-mock.js — fake players (?mockRemotes=N or ctx.remotes.mock(n))
- index.js — wiring (ctx.remotes, loop 'chr-remotes' order 34, 'chr-fx' 35, aim reset on mode change)
- test/avatars.test.js — node --test src/characters/test/ (6 tests)

## Status
- (run 1, cut off ~22:46) all files above written.
- (run 2, 22:56–23:07) review, tests, net integration (cut off before notes).
- (run 3, 03:00) resumed:
  - e2e test fixed (the sim's respawn point moved to the Overlook (0, 150): test players now stand there,
    otherwise the respawned bot left the 260 m interest radius) → all 6 node tests pass
  - remotes: lazy scene + reparent; view.w; aimRay().direction alias; mock loafer hop fix
  - notes/avatars-requests.md written (sim ANIMS sprint/wave/respawn, snapshot weapon `w`, playBounds, tests)
  - build passes (npx vite build --outDir /tmp/build-avatars)
  - ONLINE verified (server :8094 + scripted node bot scratchpad/avatars/bot.mjs + headless client):
    "Online · 2 players", remote 'Botje' tag, avatar walking in front, remote car shown while driving

  - player.js / combat-fx.js read ctx.world lazily (player re-parents into a swapped world scene);
    camera-rig follow(…, {focusRate}) for the vehicles engineer (default unchanged); new node test
    (snapshot weapon id + scene swap) → 7 tests

  - online run 2 (bot + browser): remote states sampled per frame: aim, shoot, reload, sit, dead, fall
    (+ walk / car from run 1); bot saw the browser player's relayed anims idle → aim → shoot → aim → reload
  - offline ?mockRemotes=10 at the plaza: 10 remotes + 37 NPCs, tags with bars, remote car + tag, errors []
  - remote vehicles culled beyond cull distance × 1.6; vehicle type falls back to the mode (vtol/ship)
  - the red bar across the screen in all shots = combat's `.cbt-boss` (noted in avatars-requests.md)

  - local combat in the browser (offline plaza, combat's plasma-rifle model via holdWeapon): carry pose shot,
    setAim → aimW 1.00, FOV 45, state aim/aim, aimRay dir/near/direction alias OK (OTS shot); reload state;
    dodge → rolling + i-frames true mid-roll; die → 'dead', dodge refused while dead
    (dead/respawn screenshots lost to the harness global timeout under load 30–55)

  - remote aim poses (mock remotes, side/front views): pistol two-handed isosceles, plasma rifle shouldered
    (mock views now carry `w` like a future snapshot field → right model at once); local die → collapsed on
    the ground; respawn → materialize column; creator (customize) opens without errors, portraits present

  - final online smoke on the new build (server :8094 with gen 'worldgen', bot + browser): remote Botje
    sampled sit → aim (pistol) → dead (collapsed) → idle (revived); __game errors [] / 0 console errors;
    server stopped afterwards. Final build passes; node --test src/characters/test/ → 7/7.

## Status: DONE (run 3). Remaining ideas, not required for v1:
- sim: accept sprint/wave/respawn + snapshot `w` (requests file) — then extend NET_ANIMS / net view.w
- studio's createAvatar factory (declined for v1), vehicles' look-offset-with-recentre rig option

## Open problems / notes
- machine heavily loaded during run 3 (load 30–55, several engineers' browsers): SwiftShader pages ran at
  0.2–1 fps, so browser checks were sampled per frame and screenshots were few
- the red bar across the screen in many shots is combat's `.cbt-boss` (reported in avatars-requests.md)
- scratch tools: scratchpad/avatars/bot.mjs (scripted second player: node bot.mjs ws://127.0.0.1:8094/ws 300)
