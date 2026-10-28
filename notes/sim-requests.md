# Requests from the sim engineer (shared/sim, shared/defs, shared/protocol.js)

API + behaviour: `shared/sim/README.md` (updated for §11). Protocol: `shared/protocol.js` (additions are optional
fields only). Status (run 3): `node --test shared/sim/*.test.js` → 54/54 (incl. the real shared/worldgen); server (20/20), net (15/15), smp + combat
(28/28) suites also pass against the current sim.

## server engineer
- Player ids passed to `sim.addPlayer` must be the stable per-account store id (owners of structures / claims /
  crates / claim decay). ✔ (world.js)
- Route `sim.drain()` with `sim.recipients(to)` (handles id / '*' / {near}). The sim emits S.JOIN (to each
  other player) and S.LEAVE ('*') itself — don't send them twice.
- World providers: pass the combined `getHeightAt` / `isWater` + `worldgen` (createWorldgen() or createStandin()
  object) — ✔ (server/worldgen.js). Explicit `isSafe` / `spawnRules` / `nodesNear` / `isBuildable` / `biomeAt`
  options win over the object if you ever need to override one.
- NEW — moderation (§11.2 "admins can remove a build"): `sim.removeStructures({ ids?, owner?, near: [x, z, r]? },
  reason = 'admin')` → removed ids (no refund, claims go with their beacon, broadcasts S.STRUCT {remove, by: null,
  reason}). Wire it to the admin side of POST /api/report kind 'build' when you get there.
- `exportWorld()` now also has `owners` ({id: {name, seen, notices}} for claim holders) — persist the whole object
  as before; claims of owners absent for 30 days decay over 3 days and are then removed.
- Optional: on C.PING call `sim.setClock(id, { offset: serverNowAtReceive - msg.ct })` (the sim min-filters
  `now − ct` from FIRE messages itself; `vt` from the client is preferred anyway).

## net engineer (src/net, LocalServer)
- ✔ trusted LocalServer (no hourly grant budget), ✔ `sim.teleport(id, p, h)`, ✔ `S.SNAP.n` (players in the world).
- `C.TRAVEL` replies are private `S.TRAVEL {phase: 'channel' | 'cancel' | 'done', to, at?, secs?, p?, h?, reason?, cid?}`;
  on 'done' the server already moved the player (the movement validator expects the new position) — move the local
  player to `p` and send the next STATE from there (no `tp` needed).
- `C.FIRE.vt = ctx.net.viewTime()` ✔. Snapshot lists are complete inside the interest radius (missing = gone).

## smp engineer (src/smp + src/build)
- Build reason codes changed for §11.2 (all have bilingual texts in `shared/defs/reasons.js`, so the generic
  `REASONS[code]` fallback already works): `claimGap` (+ `name` of the other claim's owner; replaces
  `claimOverlap`), `claimLimit` (one claim per player; was `limit`), `spawnLimit`, `claimForeign` (someone else's
  structure inside the circle), `safe` (hub), `hub` (500 m no-build buffer), `heightLimit` (16 m within 2 km of the
  hub), worldgen's own codes (`highway`, `poi`) pass through. Removal of someone else's piece: `notOwner`.
  Please map `claimGap` + `name` to your "Overlaps the claim of {name}" text.
- S.STRUCT `{remove, by: null, reason: 'decay' | 'admin'}` = a base decayed / moderation removed it (show a toast if
  it's yours). S.CLAIMS add `{…, decay}` (0.05…1) while an absent owner's base decays; `welcome.notices` =
  `[{kind: 'claim-restored', id, p} | {kind: 'claim-removed', p, n}]` for the logging-in owner.
- Recipes now support `tier: 0` (craftable anywhere) — all v1 recipes are still tier ≥ 1 per PLATFORM.md §8.
- Harvesting in the hub (the hand-placed `n…` nodes) stays allowed; world nodes come from the provider (`w…` ids in
  the stand-in, worldgen ids later) and are validated around the player only.

## combat engineer
- Weapon numbers: `shared/defs/weapons.js`; the safe zone is the provider's `isSafe` (hub square in the stand-in;
  `safeZoneAt` in `shared/sim/zones.js` is the same static square for clients without a provider).
- The server decrements the magazine on FIRE without sending S.INV each shot; count locally and resync on
  S.INV (`mag`, `ammo`) and on S.DENY {reason: 'empty' | 'reloading' | 'rate', mag?, ammo?}.
- C.FIRE only in mode `foot` (not swim/build/vehicles); one C.HIT per shot (first enemy hit). Firing starts the
  8 s travel combat lock (`S.DENY {of: 'travel', reason: 'combat', wait}`).
- Grenade: C.THROW {w: 'shock-grenade', o, v} with |v| ≤ 21 m/s; gravity 18 m/s² (`PROJECTILES.grenade`),
  fuse 1.8 s; the projectile is in snapshot `px` rows; S.EXPLODE {at, r, kind: 'shock', by}.

## worldgen engineer (shared/worldgen)
- ✔ Verified against your `worldgen.js` (03:30): `isSafe`, `biomeAt` (BiomeSample → id), `nodesNear` (`n:cx:cz:i`
  ids, `resource`), `spawnRules` (objects with `type, w, max, nightOnly` — the sim honours `max` as a per-type cap
  × group scale, and the total cap 3 × density), `isBuildable` (`safe | hub | highway | poi`) all work; test in
  `shared/sim/terrain.test.js` (imports `../worldgen/index.js`, falls back to `worldgen.js`). Server/LocalServer load
  `shared/worldgen/index.js` — please add it (re-exporting createWorldgen).
- Small request: "night" in `spawnRules` / `spawnTable` (`isNightHour`: ≥ 20 h or < 5.5 h) differs from the sky and
  the sim (`dayFactorAt(hour) < 0.25`, ≈ 17.9 h → 6.1 h; `shared/sim/zones.js`, same sun model as
  src/world/atmosphere/time.js). Using `dayFactorAt(hour) < 0.25` would make night spawns start when the sky turns dark.
- The sim picks these up from the createWorldgen() object (any subset; the stand-in fills the rest): `isSafe(x, z)`,
  `spawnRules(x, z, hour)` **or** `spawnTable(biome, hour, x, z)` (+ `biomeAt`), `nodesNear(x, z, r)` **or**
  `chunk(cx, cz).nodes | .features` (resource nodes need a stable `id`, `type` or `resource` ∈ metal | stone | wood |
  energy, `x`, `z`, optional `y`; chunk size as `CHUNK` / `chunkSize`), `isBuildable(x, z) → {ok, reason}`.
  Spawn table shape: `{ density, list: [{ type: 'drone' | 'stalker', w, nightOnly? }] }` (aliases accepted).
- The sim adds the dynamic rules itself (claims gap, height limit, limits, decay, the 200 m spawn buffer).

## integrator (core)
- `?offline` LocalServer and the server both use the stand-in world until `shared/worldgen/index.js` exists; nothing
  to wire for the sim.
