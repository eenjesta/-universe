# shared/sim — the SMP simulation

Authoritative survival-multiplayer simulation in **pure JS** (no DOM, no Node
APIs). The same code runs in the Node game server (`server/`) and in the
browser LocalServer (`src/net/`, offline mode). Wire contract:
`shared/protocol.js`; data: `shared/defs/*`; platform contract: `PLATFORM.md` §4 + §11.

**The world (PLATFORM.md §11):** one seamless world per server. The hand-made area in the
middle (|x|, |z| ≤ 1100 m) is the **hub = safe zone** (no enemies, no combat, no damage, no hunger
drain, no building; social only). Around it the survival planet continues infinitely: biomes,
resource nodes, enemies (more at night) and player bases (claims). Everything location-specific
comes from **world providers** (below); same sky, water and time of day everywhere.

```js
import { createSim } from '../shared/sim/index.js';

const sim = createSim({
  getHeightAt,          // (x, z) → terrain height (m) — the COMBINED world: hub heightfield + procedural planet
  isWater,              // (x, z) → bool
  now: () => Date.now(), // ms; the ONLY clock the sim reads (snapshots' st, lag compensation, timers)
  seed: 'o-universe',   // seeded spawns / loot rolls / stand-in world
  world: savedWorld,    // exportWorld() output or null
  worldgen,             // optional: a createWorldgen() / createStandin() instance (providers picked up from it)
  // optional explicit providers (win over worldgen): isSafe, spawnRules, nodesNear, isBuildable, biomeAt
  trusted: false,       // true for the in-browser LocalServer (no hourly grant budget, no claim decay)
  claimDecay: true,     // §11.2 decay of absent owners' claims (default: !trusted)
});

const welcome = sim.addPlayer({ id, name, appearance, save }); // → S.WELCOME message
welcome.you.token = token;                                       // the server adds the session token
send(id, welcome);

sim.handle(id, msg);          // every client message except hello / chat / ping / profile → bool (false = ignored/denied)
setInterval(() => {           // NET.TICK_HZ (20 Hz)
  sim.step(1 / 20);
  for (const { to, msg } of sim.drain()) for (const pid of sim.recipients(to)) send(pid, msg);
}, 50);
setInterval(() => {           // NET.SNAPSHOT_HZ (12 Hz), per client
  for (const pid of sim.playerIds()) send(pid, sim.snapshotFor(pid));
}, 1000 / 12);

const save = sim.removePlayer(id);   // on disconnect → persist per account (also queues S.LEAVE to everyone)
store.saveWorld(sim.exportWorld());  // autosave every 30 s + on shutdown
```

**Player ids must be stable across sessions** (the store's per-account player id): structures,
claims, death crates and claim decay reference their owner by it.

## World providers (`world.js`, `standin.js`)

`resolveWorld()` normalizes whatever the host passes into the provider set the sim uses:

| provider | contract | used for |
|---|---|---|
| `isSafe(x, z)` | → bool | safe zone (hub): no damage / hunger / firing / building, enemies drop targets |
| `spawnRules(x, z, hour)` | → `{biome, density, list: [{type, w, nightOnly?}]}` \| null | what spawns where (also accepts worldgen `spawnTable(biome, hour)`, arrays, `{entries / enemies / spawns}`, `{enemy / kind, weight / chance}`) |
| `nodesNear(x, z, r)` | → `[{id, type, x, z, y?}]` with **stable ids** | harvest nodes outside the hub (also worldgen `chunk(cx, cz).features` / `.nodes`, chunk size `CHUNK`) |
| `isBuildable(x, z)` | → `{ok, reason?}` \| bool | static build rules (hub, buffer, highways, POIs) |
| `biomeAt(x, z)` | → string | enemy records, HUD/map |

`spawnRules` entries may carry `max` (per-type cap near one player × group scale, on top of the total cap);
shared/worldgen's tuples `[type, w, max, nightOnly]` are accepted too.
Precedence: explicit function > `worldgen` object > the **stand-in** (`createStandin({seed, hub:
{heightAt, isWater}, noise})`, used by the server and the LocalServer until `shared/worldgen` lands):
hub heightfield inside, blended over 300 m into fBm terrain outside; biomes by compass direction
(jungle W, red badlands E/SE, open sea N/NE, forest / meadows / highlands S); spawn tables
`SPAWN_TABLES` (defs/enemies.js); 64 m resource-node cells with ids `w<i>.<j>.<k>`; `isBuildable` =
hub `safe` + 500 m buffer `hub`. A throwing provider never takes the world down: safe only inside
the static hub square, nothing spawns, no nodes, not buildable (logged once).

## API

| call | what |
|---|---|
| `createSim(opts)` | see above. `world` restores structures, claims, claim owners (last seen), loot, the clock and id counters |
| `addPlayer({id, name, appearance, save})` | creates/restores the player (position, stats, inventory, unlocks, grant ids, dead state); queues `S.JOIN` to every other player; returns the `S.WELCOME` message: `{t, v, you:{id, name, p, h, dead?, safe, claim?:{id,p,r}, beacon?:[x,z]}, world:{seed, time, dayFactor, st, n, players:[{id,name,appearance}], hub: HUB, claims: CLAIM_RULES, provider}, inv, stats, structures, claims, loot, nodes:[[nodeId, respawnAt]], notices?}` (`nodes` = depleted harvest nodes; `notices` = `claim-restored` / `claim-removed`) |
| `removePlayer(id)` | → playerSave; queues `S.LEAVE {id}` to `'*'` |
| `handle(id, msg)` | dispatches `C.STATE / FIRE / HIT / THROW / RELOAD / EQUIP / RESPAWN / HARVEST / CRAFT / USE / PICKUP / BUILD_PLACE / BUILD_REMOVE / GRANT / SPEND / TRAVEL`; never throws |
| `step(dt)` | clock, survival, travel channels, reloads, grenades, enemy spawns + AI, loot expiry, claim decay, stat/inventory flushes. `dt` in seconds (clamped to 0.25) |
| `drain()` | `[{to, msg}]` since the last drain; `to` = player id \| `'*'` \| `{near: [x, z, r]}` |
| `recipients(to)` | resolves a `to` into player ids (use it to route `drain()` output) |
| `snapshotFor(id)` | `S.SNAP {st, tod, n, pl, en, px}` with everything inside `NET.INTEREST_RADIUS` (260 m) of the player, the player itself excluded. Lists are complete: an entity missing from a snapshot is gone or out of range |
| `exportWorld()` / `importWorld(save)` | `{v, time, ids, structures, claims, owners, loot}` (loot ttl stored as remaining seconds) |
| `exportPlayer(id)` | `{v, p, h, stats:{hp, sh, en, kills, deaths}, inv, unlocks, grants, dead?}` |
| `stats()` | `{players, enemies, loot, structures, claims, projectiles, world}` |
| `setProfile(id, {name, appearance})` | after `C.PROFILE` (the server filters the name); re-broadcasts `S.JOIN` as an upsert |
| `teleport(id, [x, y, z], h?)` | trusted host move (LocalServer page teleports, admin tools): no validation, no `S.CORRECT` |
| `removeStructures({ids?, owner?, near?: [x, z, r]}, reason = 'admin')` | moderation (§11.2): no refund; claims go with their beacon; `S.STRUCT {remove, by: null, reason}` → removed ids |
| `setClock(id, {offset})` | optional: server-measured clock offset (serverTime − clientTime) used to rewind hits when a FIRE has no `vt` |
| `playersNear(x, z, r)`, `playerPos(id)`, `has(id)`, `playerIds()` | helpers for local chat (60 m) etc. |
| `time()` / `setTime(hour)` | world clock `{hour, dayFactor}` (1 game hour = 2 real minutes, start 17.6) |
| `nodes` / `nodesNear(x, z, r)` | the hub's generated harvest nodes (`nodes.js`, ids `n0…`) / hub + provider nodes near a point |
| `isSafe(x, z)`, `biomeAt(x, z)` | the resolved providers |

## What the client sends / receives (behaviour notes)

- **Safe hub**: inside `isSafe` → `C.FIRE` / `C.THROW` denied (`safe`), no damage, no energy drain, building
  denied (`safe`), enemies never target you (and turn back at the border). Harvesting the hub's hand-placed
  nodes, crafting, the market, loot pickup and consumables keep working. You start (and respawn by default)
  at the Overlook (0, 150) in the hub.
- **Movement** `C.STATE {p, h, v, a, m, veh?, tp?}` at 15 Hz. Modes `foot swim build car vtol ship space`
  (`dead` ignored). Speed caps `NET.SPEED × 1.25 + 3 m` per message (horizontal; vertical: falls up to
  75 m/s); the world is infinite (coordinates beyond ±90 km are nonsense → `bounds`). Violations →
  `S.CORRECT {p, reason}` (snap back; then positions far from `p` are ignored for 2 s). Fast travel inside
  the hub: send the first STATE at the destination with `tp: 1` (allowed near a `TRAVEL` zone of
  src/world/layout.js, your claim or spawn beacon; ≤ 1 per 3 s). Returning from space near the spaceport
  is allowed. After `S.RESPAWNED` / `S.TRAVEL done` / joining, positions far from the server position are
  ignored until you get there.
- **Travel** (§11.2) `C.TRAVEL {to, cid?}`: `'hub'` = "Return to hub" from anywhere outside the hub — refused
  `combat` (8 s after your last shot / enemy hit, `wait` s), `cooldown` (2 min, `wait`), `busy`, `here`; else
  `S.TRAVEL {phase: 'channel', at, secs: 10}`, cancelled (`S.TRAVEL {phase: 'cancel', reason: 'moved' | 'combat' |
  'dead' | 'player'}`) by moving > 4 m, taking enemy damage, firing, dying or `{to: 'cancel'}`; then
  `S.TRAVEL {phase: 'done', p, h}` at the Overlook (the server already moved you). The hub **Gateway**
  (`'wild'` = a random dry, flat, enemy-free spot 2–8 km out, beyond the no-build buffer; `'base'` = next to
  your claim beacon; `'beacon'` = your spawn beacon) is instant and only works inside the hub (`gateway`
  otherwise; `noBase` / `noBeacon` / `noSpot`).
- **Weapons** (`shared/defs/weapons.js`): `C.EQUIP {slot}`; `C.FIRE {w, o, d, seq, ct, vt?}` — server checks
  ownership, the safe zone, mode `foot`, reload state, magazine, rate (token bucket, small burst);
  the magazine is decremented silently (the client counts locally; `S.INV` mag/ammo arrive on reload, equip,
  pickups, or in `S.DENY {reason: 'empty', mag, ammo}`). Then `S.FIRED {id, w, o, d}` to players near (incl. the shooter).
  `C.HIT {seq, target, at}` per hitscan shot (one target): validated against the target's rewound position
  (see Lag compensation) → `S.DAMAGE {target, by, amount, hp, sh: 0, kind: weaponId, at, crit?}` to the
  shooter (hit marker); kills → `S.DEATH {id, type, by, byName, w, at, drop}` to players near (killfeed).
  `C.RELOAD {w?}` → reload timer (`def.reload` s) → `S.INV` patch `{mag, ammo}`.
  `C.THROW {w: 'shock-grenade', o, v}` (|v| ≤ 21 m/s) → server projectile (gravity 18, bounces, 1.8 s fuse) in
  snapshot `px` rows; `S.FIRED {…, v, px, fuse}`; `S.EXPLODE {at, r: 6, kind: 'shock', by}`; 60 dmg linear to 35 % at the
  edge + 1.5 s stun on enemies. PvE only: players are never damaged by players.
- **Survival** (outside the hub): hp 100, shield 50 (regen 10/s after 4 s without damage), energy 100 (−1 per
  40 s, −1 per 8 s extra while sprinting (`a: 'run'`), 1 hp/s starvation at 0). `S.STATS {hp, sh, en, maxHp, maxSh,
  maxEn, dead?}` private, ≤ 4 Hz + on every damage. `S.DAMAGE` to the victim: `{target, by: enemyId | null, amount, hp,
  sh, kind: 'laser' | 'claw' | 'starve', at, from?}`. `C.USE {item: 'ration' | 'medkit' | 'shield-cell'}` (0.8 s
  cooldown; `full` when it would do nothing).
- **Death**: `S.DEATH {id, by, kind, at, name, drop?, byType?}` to everyone; 30 % of carried resources + ammo go
  into an owner-only crate (`S.LOOT add {…, owner, kind: 'grave', ttl: 600}`). `C.RESPAWN {at: 'beacon' | 'base'
  | 'spawn'}` after 5 s → `S.RESPAWNED {id, p, h}` to everyone + full stats. beacon = own spawn beacon (else own
  claim, else the Overlook), base = own claim (else the Overlook), spawn = the Overlook. Dead players can't act
  (`S.DENY {reason: 'dead'}`), their STATE is ignored.
- **Loot**: `S.LOOT {add: [{id, p, items: {res?, ammo?, items?, weapons?}, owner?, ttl, kind}]}` / `{remove: [id], by?,
  got?}` to everyone. `C.PICKUP {loot}` within 3.5 m (+1); owner-only crates. What doesn't fit stays in the crate
  (re-sent as `add`). Enemy drops are public for 180 s.
- **Harvest**: the hub's nodes from `generateNodes()` (ids `n0…`, shared with `src/build/harvest.js`) + the
  provider's nodes outside (stable ids; the server only looks around the player). `C.HARVEST {node}` (≤ 4 m,
  ≥ 0.9 s apart) → `S.HARVESTED {node, by, res, respawnAt, respawnIn}` to players near + `S.INV` patch;
  depleted → `S.DENY {reason: 'depleted', node, respawnAt}`.
- **Crafting**: `C.CRAFT {recipe, n?}` needs a Workbench (tier ≥ recipe tier; tier 0 = anywhere) within 6 m
  (`shared/defs/recipes.js`); `n` is clamped to the recipe max and what fits → `S.CRAFTED {recipe, n}` + `S.INV`
  patch (ack = cid). `workbench-t2` turns your nearest own `workbench` into `workbench-2` (`S.STRUCT add` with the
  same id = update).
- **Rewards / market**: `C.GRANT {source: 'quest' | 'event' | 'mission' | 'discovery', id, amounts: {credits, metal…,
  items: [unlock ids, quest only]}}` once per `source:id`, capped (1000 credits / 120 per resource per grant, hourly
  budget unless `trusted`) → `S.INV` patch with `ack`. `C.SPEND {reason: 'market', id, cost?: {credits}}` buys at the
  server price (`price` deny with the real price when it differs); `{reason: 'sell', id: 'metal', cost: {metal: n}}`
  sells resources; `{reason: 'sell', id: unlockId}` sells an unlock back for 50 %; any other reason = generic sink.
- **Building** (§11.2): `C.BUILD_PLACE {piece, p, rot, level?, variant?, cid}` → success `S.STRUCT {add: [record], by,
  cid, ok: true}` to everyone (record `{id, type, x, y, z, rot, level, variant?, owner, ownerName}`); failure
  `S.STRUCT {cid, ok: false, reason, name?}` to the placer. Checks in order: dead, piece (not hidden), reach 24 m (+8),
  height sanity (`height`), water, ground-only pieces, the provider's static rules over the footprint (`safe` hub,
  `hub` = 500 m no-build buffer, worldgen `highway` / `poi` …), `heightLimit` (≤ 16 m above the terrain where
  hubDist < 2000 m), protected hub landmarks, someone else's claim (`claim` + `name`), unlock (`locked`), 400 pieces
  per player (`limit`), claim beacon: one per player (`claimLimit`), ≥ 30 m between claim edges of different owners
  (`claimGap` + `name`), no foreign structures inside (`claimForeign`), the whole 24 m circle must pass the static
  rules; one spawn beacon (`spawnLimit`); slot occupancy (same keys as the build module) / free-piece overlap
  (`occupied`); cost. `C.BUILD_REMOVE {id, cid?}` → owner only (or the claim owner for ownerless legacy pieces),
  50 % refund → `S.STRUCT {remove: [id], by, cid, ok, refund}`; else `S.DENY`.
- **Claims**: a claim beacon creates `{id, owner, ownerName, name, p: [x, z], r: 24, sid}` (`S.CLAIMS add/remove` to
  everyone). Inside your own claim during the day enemies ignore you; no spawns inside claims + 10 m. Owners
  absent for 30 days: the claim decays over 3 days (`S.CLAIMS add {…, decay: 0.05…1}`), then the base (claim +
  the owner's structures inside it) is removed (`S.STRUCT {remove, by: null, reason: 'decay'}`). Logging in
  restores a decaying claim; `welcome.notices` tells the owner (`claim-restored` / `claim-removed {p, n}`).
- **Denials**: `S.DENY {of: msg.t, reason, cid?, …}`; reason codes + bilingual texts in `shared/defs/reasons.js`.

## Enemies

`shared/defs/enemies.js`: security drone (60 hp, hovers 6–12 m above ground/roofs, keeps 15–30 m, strafes,
laser 6 dmg 1.2/s ≤ 45 m with accuracy falloff by distance and target speed) and jungle stalker (90 hp, 11 m/s
chase, leap 5–12 m, claw 14 dmg). **Only outside the hub**: once per second each player outside the hub's 200 m
spawn buffer may get a spawn attempt on a 45–150 m ring (every 3–7 s while below its cap); the provider's table
at that spot decides the type (weighted) and the density: cap = `SPAWN.perPlayer (3) × density × group scale`
(+50 % per extra player within 120 m, max ×3), global cap 120. Stand-in tables: badlands drones (×2 at night),
highlands drones, jungle stalkers (×1.6 at night), forest / meadows: a few drones by day, night-only stalkers
at night; open sea: nothing. Never in safe zones, the spawn buffer, claims (+10 m) or within 45 m of a player.
Leash → return home (full heal); despawn after 20 s without a player within 300 m (night-only creatures also at
daybreak). Enemies steer away from the hub border and drop their target inside a safe zone. Snapshot rows
`[id, type, x, y, z, h, s, hp, target?]`, `s` = `ES` code (`IDLE 0, PATROL 1, CHASE 2, ATTACK 3, LEAP 4, STUN 5,
DEAD 6, RETURN 7`). Enemy attacks: `S.ENEMY_FIRE {id, w: 'laser' | 'claw', o, d, hit, target}` to players near.

## Lag compensation

Every enemy keeps a 16-sample position ring buffer (one per step). A FIRE stores `tView`: `msg.vt` (best: the
client's `serverTime() − NET.INTERP_DELAY_MS` at the moment of the shot), else `ct + offset − INTERP_DELAY_MS`
(offset from `setClock` or a min-filtered `now − ct`), clamped to `[now − NET.LAG_COMP_MS, now]`. The HIT is
accepted when, at one of tView + {0, ±80, ±160} ms, the shot ray passes the target shape (drone sphere r 0.85,
stalker capsule r 0.7 h 1.6) within 0.55 m + 0.4 % of the distance (+0.6) and `at` lies on it; plus range, spread
cone (+2.5°) and a terrain line-of-sight ray-march from the muzzle to `at`.

## Safe zone & clock (`zones.js`, `shared/defs/world.js`)

`HUB` (half 1100, blend 300, spawn buffer 200, no-build 500, height limit 16 m within 2000 m), `hubDist(x, z)`,
`inHub(x, z)`, `CLAIM_RULES`, `TRAVEL_RULES`, `BIOMES`, `ZONE_TEXT` (HUD "Safe zone" / "Leaving the safe zone").
`SAFE_ZONES` / `safeZoneAt(x, z)` = the static hub square (for clients without a provider; the provider's
`isSafe` is the authority). `dayFactorAt(hour)` = the client sky's `dayFactor`. Snapshots carry `tod` (hours)
and the welcome `world.time` so all clients share the sky.

## Defs (`shared/defs/`, all bilingual `{en, nl}` names)

| file | exports |
|---|---|
| `weapons.js` | `WEAPONS` (pulse-pistol, plasma-rifle, railgun, shock-grenade: slot, dmg, rate, mag, reserve, ammo, range, falloff, spread/spreadAim, reload, crit, fx), `WEAPON_SLOTS`, `PROJECTILES` |
| `enemies.js` | `ENEMIES` (drone, stalker), `SPAWN` (caps, ring, despawn), `SPAWN_TABLES` (stand-in, per biome, day/night) |
| `items.js` | `RESOURCES`, `AMMO`, `ITEMS` (ration, medkit, shield-cell, shock-grenade: use effects + carry max), `SURVIVAL`, `DEATH_DROP`, `LOOT`, `START` (new player inventory), `GRANT_CAPS` |
| `recipes.js` | `RECIPES`, `RECIPE_RANGE` (6 m) |
| `pieces.js` | `PIECES` / `PIECE` (build pieces with snap/size/cost/unlock + workbench, workbench-2, claim-beacon, spawn-beacon), grid constants, `BUILD_PROTECTED`, `protectedAt`, `refundOf` |
| `market.js` | `MARKET` (prices / give), `SELL_PRICES`, `SELL_BACK` |
| `reasons.js` | `REASONS` deny codes → `{en, nl}` |
| `world.js` | `HUB`, `CLAIM_RULES`, `TRAVEL_RULES`, `WORLD_LIMIT`, `hubDist`, `inHub`, `BIOMES`, `ZONE_TEXT` |
| `index.js` | everything above |

## Files

`index.js` (composition, snapshots, persistence) · `world.js` (provider normalization) · `standin.js` (stand-in
world) · `players.js` (records, survival, damage, death, respawn, movement) · `combat.js` (fire / hit / throw /
reload / equip, grenades) · `enemies.js` (spawning, AI, history) · `economy.js` (harvest, craft, grant, spend) ·
`build.js` (structures, claims, decay, moderation) · `travel.js` (C.TRAVEL) · `loot.js` · `inventory.js` ·
`nodes.js` (hub harvest node generator, shared with `src/build/harvest.js`) · `zones.js` · `los.js` · `rng.js` ·
`util.js` · tests `*.test.js` (`node --test shared/sim/`; `terrain.test.js` bakes the real heightfield,
measures 50 players + 120 enemies (≈1–2 ms CPU per step) and runs the sim on the real `shared/worldgen`).
