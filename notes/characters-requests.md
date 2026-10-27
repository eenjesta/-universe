# Characters — requests & integration notes

Everything below is optional: the characters module null-checks other modules and
works without these. Public API: see the header of `src/characters/index.js`.

## core / tools
- **`tools/shot.mjs` screenshot timeout.** `page.screenshot()` uses Playwright's
  default 30 s timeout. With several engineers rendering at once (load avg 20–35 on
  8 cores) a single SwiftShader frame of the full world takes 10–60 s, so
  high-quality world shots fail with `TimeoutError` even at `quality=medium`.
  Please pass a timeout, e.g. `page.screenshot({ path, timeout: Number(args.shotTimeout || 300000) })`
  (also for `{"shot": …}` steps). Workaround: a private copy of the harness with
  that one change.

## shell
- `player.setPose('idle')` now exists (also `'wave' | 'cheer' | 'clap' | 'talk' |
  'tablet' | 'sit'`, held until `setPose('idle')`). It zeroes velocity and sets
  `player.state = 'idle'`.
- The player is drawn through its own single-character batch parented to
  `player.object`, so moving/rotating `player.object` for a thumbnail moves the
  mesh too (thumbnails can show the player).

## systems
- **Dialogue framing:** `ctx.cameraRig.focus(targetVec3OrObject3D, { distance = 2.3, pitch = -0.04, rate = 3 })`
  eases the camera behind the player so it looks past them at the target;
  `focus(null)` releases it and restores the previous zoom. You can keep damping
  `yaw/pitch/_zoom` yourself — both work.
- Named NPCs exist with the requested ids: `luna`, `kai`, `nova`, `yara`, `milan`
  (plaza), `aria` (signal), `oran` (Oran's counter in the bazaar), `jules` (next to
  the ship pad). E → `npc:interact {id}`; if no dialogue opens within 60 ms the NPC
  answers with a speech bubble instead.
- `ctx.portraits.render(npcId, { framing: 'bust', width: 360, height: 450 })` is
  framed for the dialogue panel (head ≈ half the height). Extra options:
  `view: 'three-quarter' | 'front' | 'side' | 'back'`.
- Starfall: on `event:start {id: 'starfall'}` the plaza crowd walks (A* over
  `plaza.walkPoints`) to `plaza.stage.crowdPoints` and cheers/claps/waves;
  `event:end` sends everyone home. `ctx.npcs.startGathering()/endGathering()` are
  also exposed.

## vehicles
- Camera: `ctx.cameraRig.follow(vehicle.object, { distance: 7, height: 1.6, shoulder: 0, align: 2 })`
  then call `ctx.cameraRig.update(dt)` from the drive mode's update; `align` > 0
  auto-yaws behind the vehicle after 1.2 s without mouse look. `zoomEnabled` /
  `lookEnabled` are honoured; `shake(amount)` for impacts.
- Player: `ctx.player.setVisible(false)` and `ctx.player.onFoot = false` while
  driving (stops saves/footsteps); leave with `ctx.modes.go('explore', { position: { x, z, heading } })`
  — explore teleports the player there and re-attaches the camera.

## landmarks
- Thanks for `spawnFor`, `beacon.front`, `bazaar.oranCounter`, `stage.crowdPoints`,
  `walkPoints`, `benches` and `lookout.stairPath` — all used. NPCs are placed with
  `physics.groundHeight`, so raised paving/benches work.
