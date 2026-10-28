# SMP (src/smp + src/build) — requests & integration notes

Owner: smp engineer. Public APIs: `ctx.smp` (src/smp/index.js header) and the build module's
online hooks `ctx.build.setAuthority(...)` / `ctx.build.applyRemote(...)` (src/build/index.js header).

## sim (shared/defs, shared/sim) — PROPOSALS (tell me in notes/sim-*.md if you prefer otherwise)

### New build pieces (src/build/catalog.js is the client catalog; please port to shared/defs/pieces.js)
| id | category | cost | notes |
|---|---|---|---|
| `workbench` | survival (new 7th build category, key 7) | metal 30, wood 20, stone 10 | crafting station tier 1 |
| `workbench-2` | (not in the build bar) | — | tier 2 model; created by the upgrade recipe (the server swaps the record's `type` to `workbench-2`, same id or new id — both handled) |
| `claim-beacon` | survival | metal 25, stone 20, energy 10 | claim radius `CLAIM_RADIUS = 24`; suggest max 1 per player in v1 (`deny reason 'claim-limit'`); its 24 m circle may not overlap another player's claim (`'claim-overlap'`) |
| `spawn-beacon` | survival | metal 20, energy 15 | respawn point (`RESPAWN {at:'beacon'}`); one per player — a new one replaces the old one's role |
All other piece costs: copy `PIECES[].cost` from src/build/catalog.js (unchanged from single-player).

### Build messages
- `C.BUILD_PLACE` — I send `{ piece, p:[x,y,z], rot, level, variant, cid }` (**`variant` added**: 'ground' | 'raised',
  please store + echo it in the record; without it remote pieces lose their footings).
- Records (`S.STRUCT add`, welcome `structures`): `{ id, type, x, y, z, rot, level, variant, owner, ownerName }`
  (`p:[x,y,z]` instead of x/y/z also works). Placer gets `{ add:[rec], cid, ok:true }`; everyone else `{ add:[rec] }`.
- Deny: `S.DENY { of:'build:place', reason, cid, name? }` or `S.STRUCT { cid, ok:false, reason }` — both handled.
  Reason codes I translate: `claim` (+ `name` = claim owner's name), `claim-overlap` (+ `name`), `claim-limit`,
  `spawn-limit`, `cost`, `owner` (removing someone else's piece), `far`, `limit` (structure cap), `invalid`,
  `safe` (safe zone). Unknown codes show a generic "Not allowed here".
- Removal: only the owner (or the claim owner) — `S.DENY { of:'build:remove', reason:'owner' }`. Refund 50 % like SP.
- Claims: `S.CLAIMS { add:[{ id, owner, name, p:[x,z], r }] }` — **please include the owner's `name`** (claims of
  offline players need it for "Claimed by <name>"). Claim id = the beacon's structure id is handy but not required.

### Crafting (shared/defs/recipes.js) — what the UI reads (tolerant, adapt freely)
`RECIPES = [{ id, name:{en,nl}, cost:{metal,stone,wood,energy}, tier: 0|1|2, out: { item|ammo|weapon: id, n } | { upgrade: 'workbench' } }]`
- tier 0 = craftable anywhere, 1 = within reach of any workbench, 2 = workbench-2. Suggest reach `CRAFT_RANGE = 8` m
  (any player's workbench works in v1). Deny reasons: `station` (no workbench nearby), `tier`, `cost`.
- Please consider **ration = tier 0** (field ration) so a brand-new player can eat before building a workbench
  (the survival quest asks "craft a ration" first). If you keep it at tier 1, the UI explains "Needs a Workbench".
- `S.CRAFTED { recipe, n }` → I emit `smp:crafted` for quests.

### Harvest nodes (shared/sim/nodes.js)
Please export a pure generator used by BOTH the sim and src/build/harvest.js so ids/positions match:
`generateNodes({ getHeightAt, isWater, getNormalAt? }) → [{ id, type:'metal'|'stone'|'wood'|'energy', x, y, z, rotY, scale }]`
plus `NODE_TYPES = { metal:{ resource, amount:[6,9], hold:1.6, respawn:[150,240] }, … }`. Porting the placement part of
src/build/harvest.js (REGIONS, okSpot without the physics query, seeded Rng) keeps today's layout; protectedAt /
roadClearance are pure (src/build/placement.js) — copy them. `C.HARVEST { node }` → `S.HARVESTED { node, by, res, respawnAt }`
to players near the node (respawnAt in server ms; I convert with ctx.net.serverTime()). Welcome: please add
`nodes: [[nodeId, respawnAt], …]` for depleted nodes so a joining client hides them.

### Loot / death / kills
- Loot records `{ id, p:[x,y,z], items, owner?, name? (owner's name), ttl (ms left), kind:'death'|'enemy'|'drop' }`.
- `S.DEATH` for enemies: please include `type` ('drone' | 'stalker') — the survival quest "defeat a security drone"
  counts `DEATH` with `by === me` and a drone type.

### Power pieces online
src/build/power.js adds energy to `state.resources.energy` in single-player. While a server is authoritative that would
fight the inventory mirror, so I switch it off online (production still shows in the HUD). Optional for v2: accrue energy
on the server from the owner's generators.

## net (src/net)
- I use: `ctx.net.mode/online/id`, `send(msg)`, `on(type, fn)` (for `S.HARVESTED`, `S.CRAFTED`, `S.STRUCT`, `S.CLAIMS`,
  `S.DENY`, `S.LOOT`), `serverTime()`, `loot` Map, `players.get(id)?.name`, events `net:status`, `net:welcome`
  (payload = the WELCOME message), `net:inv` (payload = the INV message incl. `patch`), `net:death`, `net:respawned`.
- `ctx.state.smp` mirror I read: `{ ammo:{}, items:{}, weapons:[], slot, hp, sh, en, maxHp, maxSh }` (I also merge
  `net:inv` myself, so any shape works as long as the event carries the raw message).
- LocalServer (suggestion): on its first run seed the local world with the single-player `state.structures`
  (owner = local player) so an offline player keeps their villa.

## combat (src/combat)
- Keys: consumables 5/6/7 (ration / medkit / shield cell) only when not building, not in dialogue/modals.
  Inventory = I. Clicking a weapon card in the inventory sends `C.EQUIP { w }`.
- Touch: the consumables quick bar is a tappable HUD widget (no cluster slots needed). The Inventory menu tile is
  merged into the `explore` layout's `menuExtra` at smp install (smp installs after combat) — if you call
  `ctx.touch.setLayout('explore' | <overlay>, …)` later, please spread `...(ctx.smp?.touchMenu || [])` into `menuExtra`.

## integrator (core)
- Optional: `inventory: ['KeyI']` and `slot7: ['Digit7']` in `ACTIONS` (src/core/input.js); I read raw keys meanwhile.
- Help screen (shell): I · Inventory / Inventaris, 5–7 consumables, build category 7 Survival / Overleven.

## Status / observations (run 3, 2026-10-28 03:50)
- Verified against the REAL sim (node --test src/smp/flow.test.js) and in the browser (LocalServer + own
  server :8093): harvest (hold-E → C.HARVEST → S.HARVESTED), craft at a workbench (screen button → C.CRAFT),
  consumables (5 → C.USE), loot pickup (E → C.PICKUP), claim + build in it, denial in someone else's claim
  ("Claimed by Rhea" — client prediction + server 'claim'), one spawn beacon, structures reaching other clients.
- **combat**: the boss bar `.cbt-boss` (red, 640 px) is visible in plain explore mode without any boss
  (offline, 960x540, quality=low) — seen in every SMP screenshot at y≈218.
- **combat**: in build mode the vitals (`bottom-center`, order 20) are pushed up by the build bar; on short
  screens they reached the build reticle's reason label (I moved that label above the reticle below 640 px
  height). Hiding the vitals while `ctx.build.active` would free the space (optional).
- **integrator**: until the play bounds are lifted and the frontier terrain exists, survival building can only be
  tested with the dev flag `?smphub=150,0` (client rules) + a server whose hub is shrunk the same way (my test
  launcher patches `sim._w.world.isSafe/isBuildable`; scratchpad t/server-smp.mjs). Production never sets it.

## Status / observations (run 4, 2026-10-28 08:30)
- **sim**: handled now — `claimGap` (+ name), S.STRUCT `{remove, by: null, reason: 'decay' | 'admin'}` (toast for the
  owner), S.CLAIMS `decay` (grey fading fence + "abandoned · decaying" pill), `welcome.notices` (claim-restored /
  claim-removed toasts). Verified against the real sim in src/smp/flow.test.js (13/13).
- **integrator / frontier**: smp reuses the world generator instead of building a third one: `ctx.worldgen` (any seed
  match, or no `seed` field) → else `ctx.net.providers.impl` when its `seed` equals the welcome's → else its own
  (~0.5 s main thread). Please set `ctx.worldgen = frontier.worldgen` as in frontier-progress step 1 — smp picks it up
  even when it appears after the welcome (checked every 2 s; wilderness harvest nodes are re-pointed to it).
- **integrator**: build placement (ghost ground snap, footings, claim fences) uses `ctx.world.getHeightAt` /
  `ctx.world.raycast` — correct beyond ±1100 m only once those are delegated to the frontier (frontier-progress
  step 2). Wilderness harvest nodes already take their y from the provider (worldgen heights).
- **integrator**: once the play bounds are lifted + the frontier is wired, the `?smphub=150,0` dev flag is no longer
  needed for browser tests; it stays harmless (never set in production URLs).
- **net / server** (observation, not blocking): on a loaded box a cold boot takes ~60 s; the client sent nothing in
  that time and the server idle-kicked it (`error idle` → reconnect, same player) right after `game:ready`. Build /
  craft requests made during that reconnect window are refused by smp with "Connecting to the server…" (by design —
  nothing hangs). A ping during the boot (before game:installed) would avoid the kick.
