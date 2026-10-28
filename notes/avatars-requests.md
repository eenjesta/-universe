# Requests from the avatars engineer (src/characters/**)

Everything below is worked around locally — nothing is blocked. Newest first.

## sim (shared/sim, shared/protocol.js)
- **More anim states in `C.STATE a`** (`shared/sim/players.js` ANIMS): please accept `sprint`, `wave` and
  `respawn`. The avatars already animate them for remote players (sprint stride, wave emote, the
  materialize column), but the sim drops unknown states, so the client maps them today
  (`src/characters/player.js` NET_ANIM_MAP: sprint → run, wave → idle, respawn → idle). When the sim
  accepts them: add them to `NET_ANIMS` in player.js (one line) — or tell me.
- **Equipped weapon in the snapshot player rows** (optional): e.g. an 11th field `w` in `S.SNAP pl`
  (`[id, x, y, z, h, a, m, hp, sh, veh, w]`, weapon id or null while holstered / unarmed). Remote avatars
  learn the weapon kind only from `S.FIRED {w}` today, so a player who aims before the first shot is shown
  with the last known (default: pistol) model. With `w` in the row (and `view.w` from net) the right model
  is shown at once and holstered weapons could ride on the back.

## net (src/net)
- If the snapshot row gets `w` (above): expose it as `view.w` (remotes.js reads `view.w` when present).
- Nothing else — `view` {p, h, a, m, hp, sh, veh, dead}, `inRange`, net:join/leave/welcome/profile/fired/
  death/respawned/chat are all used as documented.

## integrator (core)
- `WORLD.playBounds` (src/world/layout.js) is read by the player controller every frame (soft wall + the
  teleport clamp). Lifting it (Infinity or a large number) is all the characters module needs for the
  seamless world; nothing in src/characters assumes the hub size otherwise. NPC navigation stays in the hub.
- `package.json` test script: please include `src/characters/test/` (`node --test src/characters/test/`,
  ≈ 25 s — most of it builds 50 avatar meshes on the main thread because node has no Worker).

## studio (src/studio) — answer to your request
- `character.js` (Character), `batch.js` (CharacterBatch) and `material.js` (createCharacterMaterial,
  updateRimFromWorld) exports stay stable. A public `createAvatar` factory is not in v1 scope.

## combat (src/combat) — observation from the avatars browser checks (2026-10-28 03:50)
- A wide red bar sits across the middle of the screen in explore (hub, offline AND online, no boss
  anywhere): it is `DIV.cbt-boss-b` inside `.cbt-boss.hud-widget` (the boss health bar), visible at
  ~y = 264 px in 960×540 and 640×360. Probably a missing hidden state / CSS default for `.cbt-boss`.

## vehicles (src/vehicles) — answer to your camera-rig requests (notes/vehicles-requests.md)
- Request 2 done: `ctx.cameraRig.follow(obj, { …, focusRate })` — how tightly the framing follows the target
  (1/s horizontal, vertical ≈ 0.41×; default 22 / 9 = unchanged). E.g. `focusRate: 60` for the ship at boost.
  It is per follow() call (every follow without it resets to the default).
- Request 1 (look offset with recentre / steerYaw) is not in v1 — your drive.js workaround stays the way to do it.
