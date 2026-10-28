# Survival (survival depth, bases & onboarding) → other owners

Owner: survival engineer — src/smp/**, src/build/** (except harvest.js), shared/sim/{players,inventory,loot,build,travel,
storage,zones}.js, shared/defs/{items,recipes,pieces,market,reasons}.js, src/systems/quests/data.js. Log: notes/survival-progress.md.

## Contracts that exist now (2026-10-28 11:15, sim tests: shared/sim/storage.test.js)

### Items (shared/defs/items.js — `ITEMS[id]`, all in `inv.items`, carry limit `max`, `kind`, `icon`)
- Food (raw, `kind: 'food'`): `berries` (+8 en +2 hp, max 40), `mushroom` (+6 en, max 30), `jungle-fruit` (+14 en +4 hp, max 20),
  `raw-meat` (+4 en raw, max 20 — cook it). Eat with `C.USE {item}`.
- Materials (`kind: 'material'`): `fiber` (max 250), `crystal-shard` (rare, max 60).
- Meals (`kind: 'meal'`, campfire): `fruit-skewer` (berries ×4), `roast-glowcaps` (mushroom ×3), `crystal-tea` (crystal-shard + berries ×2 → 2),
  `grilled-meat` (raw-meat), `hearty-stew` (raw-meat + mushroom ×2 + jungle-fruit). `use` + `buff {id, secs}`.
- Medical: `bandage` (+18 hp; field craft from fiber ×4, tier 0).
- Gear (`kind: 'gear'`, `gear: {slot, dr?, maxHp?, maxSh?, regenDelay?, sprint?}`): `light-techwear`, `heavy-techwear` (armor slot),
  `shield-module`, `shield-module-2` (module slot). `C.USE {item}` equips (swap), `C.USE {item, op: 'unequip'}` takes it off.
- Schematics (`kind: 'schematic'`, POI loot, consumed by a recipe): `schem-heavy-techwear` (outposts), `schem-shield-module-2` (Ø ruins),
  `schem-fabricator` (crash sites → Workbench Mk III).
- `FOOD_ORDER`, `GEAR_SLOTS`, `DROPPABLE_ITEMS` (materials + raw food: 30 % go into the death crate), `BUFFS` (fed, swift,
  charged, rested; statuses warm / cold).
- Costs may contain item ids (`canAfford` / `pay` in shared/sim/inventory.js take them from `items`): e.g. `{fiber: 4}`,
  `{…, 'schem-heavy-techwear': 1}`. `gain(inv, {fiber: 3})` (flat item ids) works like flat resources.

### Messages (no new types — fields on existing ones)
- `C.STORE { struct, op, … }` = the generic **structure interaction**: chest `op: 'open' | 'put' | 'take'` (+ `item` | `res`, `n`),
  campfire `op: 'open' | 'cook' (+ recipe, n) | 'collect'`, bed `op: 'sleep'`, door `op: 'toggle'`. Optional `cid` → `ack`.
- `S.STORAGE { struct, kind: 'chest' | 'fire' | 'bed' | 'door', … }`: chest `{items, res, stacks}` (to the opener), fire
  `{cook: [{recipe, n, by, done (server ms)}], slots, got?}` (to players within 40 m), bed `{bed: true, rested: until}`, door `{open}`.
- `S.DENY {of: 'store', reason: 'private', name}` (someone else's chest / bed / door), `'far'`, `'full'`, `'cost'`, `'wait'`, `'combat'`.
- `S.STATS` now carries `fx: {buffId: until (server ms) | 1 (status: warm / cold)}` and gear-adjusted `maxHp` / `maxSh`.
- `S.INV` has a `gear: {armor, module}` section (item id | null).
- `C.RESPAWN {at: 'bed'}` → your bed (else spawn beacon, else claim, else the Overlook); `'beacon'` falls back to the bed.
- Structure records may carry `open: true` (doors); S.STRUCT `{add: [rec], upd: true}` updates them.
- New deny reasons in shared/defs/reasons.js: `private`, `pieceLimit` (+ `n`), `tool` (gather asked for it).

### Supply depot (credit sink) + quests
- `MARKET['supply-*']` (shared/defs/market.js, `SUPPLY_IDS`): rations ×4 120, medkits ×2 260, shield cells ×2 280,
  fiber ×30 160, shock grenades ×2 340, crystal shards ×2 950 — bought with `C.SPEND {reason: 'market', id, cost}` (the
  server's existing market path; `give` = item ids). Offered in the inventory screen's "Supply depot" while in the hub.
- Survival onboarding quest ids: wild1 … wild5, survival2, wild6 (src/systems/quests/data.js); `SHELTER` (piece regexp).

### Pieces (shared/defs/pieces.js, survival category)
`campfire` (warmth 8 m, cooking 3 slots), `sleeping-bag` + `bed` (respawn, Rested buff), `storage-chest` (24 stacks, owner lock),
`door` (edge piece, owner lock, `open`), `torch` (light), hidden `workbench-3` (Mk III: recipe `workbench-t3` upgrades a Mk II;
`W.build.upgrade(rec)` now goes one tier up via `UPGRADES`). Fire Basket (`brazier`) also warms (5 m).

## Requests

### threats (src/combat, shared/sim/enemies.js)
0. (13:30) Thanks — CACHES / boss loot now use my ids (schematics, crystal-shard, raw-meat) and the death screen has the
   Bed option. FYI `ctx.smp.stats.dead` is now reliable (S.STATS `dead`), and the "You dropped your supplies" toast waits
   for the respawn (your death screen already says it) — after the respawn a gold "Your crate · 120 m · 9:41" chip sits in
   the buff strip. Quest hooks I listen to: `smp:kill` (any hostile), `smp:pickup {loot, got, kind}` (kind 'cache' = a
   POI supply cache → onboarding quest "Salvage and Gear").
1. **Death screen: a Bed option.** Please render the respawn choices from `ctx.smp.respawnOptions?.()` when it exists →
   `[{at: 'bed' | 'beacon' | 'base' | 'spawn', title: {en, nl}, sub: {en, nl}, ok: bool, icon}]` (smp keeps it current: bed first
   when you own one). Until then smp's `hasBeacon()` returns true for a bed as well — the server's `'beacon'` falls back to your bed.
2. **Loot tables by danger** (your plan item 6): POI / guardian drops can use my ids — Ø ruins: `schem-shield-module-2` (rare),
   `crystal-shard` 1–3; pirate outposts: `schem-heavy-techwear` (rare), `fiber`, `bandage`; crash sites: `schem-fabricator` (rare),
   `shield-cell`, metal. Night / boss: anything above + `shield-module`. Loot bundles may carry `items: {id: n}` (loot.js handles them).
   I also add small **POI supply caches** myself (loot.js) unless you tell me you own POI loot entirely.
3. Optional: jungle stalkers drop `raw-meat` 0–1 (gives the grilled meat / stew recipes a source before hunting exists).

### integrator (shared/protocol.js doc only — behaviour works today)
4. Document in `shared/protocol.js`: `C.STORE` ops above (`open | put | take | cook | collect | sleep | toggle`), `S.STORAGE` kinds,
   `S.STATS fx`, `S.INV gear`, `C.RESPAWN at: 'bed'`, `C.USE op: 'unequip'`, records `open`.

### gather (shared/sim/economy.js)
5. Nothing blocking: `craft()` already works with item costs + the generic upgrade (`W.build.upgrade` picks the next tier).
   FYI the client shows "Needs the schematic" for recipes whose missing cost is a schematic.

### fp-anim (src/characters)
6. I call `ctx.player.playAction?.('eat')` (food), `'use'` (chest / door / campfire), `'build'` (placing) when they exist.
   Build mode no longer lerps the third-person build camera while `ctx.player.view === 'first'` (the ghost aims along the camera
   ray = the eye ray in first person).

### ux (src/shell)
7. Key hints / help: `5` eat (best food you carry), `6` medkit, `7` shield cell, `I` inventory (gear, food, crafting); in the world
   `[E]` campfire (cook), chest (open), bed (sleep / set home), door (open / close). Survival HUD: smp shows a buff strip
   (Warm / Cold night / Well fed …) just above the vitals (bottom-center, order 19) — tell me if you move the vitals.

### gather (src/gather)
8. Onboarding quests listen to `gather:done {state}`: 'felled' (Into the Wild: fell a tree), 'picked' with `got.items`
   berries / mushroom / jungle-fruit (pick food), 'broken' (Tools of the Trade: break a rock). Please keep those fields.

### integrator / systems
9. The survival onboarding chain lives in src/systems/quests/data.js: wild1 Into the Wild → wild2 Tools of the Trade →
   wild3 Fire and Food → wild4 A Place of Your Own → wild5 The First Night → survival2 Armed and Ready → wild6 Salvage
   and Gear (old 'survival' removed; 'home' — the single-player base quest — no longer triggers while `ctx.smp.online`).
   Tested headless through the real engine: src/smp/onboarding.test.js. Online bases: src/smp/online.test.js (real server).

