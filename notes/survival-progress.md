# Survival engineer — progress log (survival depth, bases & onboarding)

Owner (this wave): src/smp/**, src/build/** (except harvest.js), shared/sim/{players,inventory,loot,build,travel,storage,zones}.js,
shared/defs/{items,recipes,pieces,market,reasons}.js, src/systems/quests/data.js. Requests to others: notes/survival-requests.md.
Test harness (not shipped): scratchpad/survival/{mk.mjs, helpers.js, *.js jobs} → `node mk.mjs job.js` → tools/shot.mjs --batch.

## Assessment (played 2026-10-28 10:50, offline LocalServer, 960x540 low, simulate-driven)
Run: hub spawn → teleport to the east badlands (1800, 300) → build → inventory/crafting → night 22:30 → death.
Shots: shots/survival/a1-hub.png … a6-death.png.

1. **Food doesn't matter and there is no food loop.** Energy drains 1 per 40 s (100 → 0 in 66 min) and you start
   with 3 rations (+105) → 2+ hours before hunger bites. The only food is a crafted ration (wood + energy) at a
   workbench: no foraging, no cooking, no meals with buffs. Hunger is a toast, not a mechanic.
2. **Onboarding is broken for survival.** In the hub only the single-player "Explore the Horizon" chain runs.
   Out in the wild "Survival Basics" starts at once with "Build a workbench" (no hint to gather first, no waypoint,
   nothing about leaving the hub through the Gateway / highways). Placing a foundation starts the single-player
   "Build a Home" quest ("Activate power" — power accrual is off online) which takes over the tracker.
   Nothing guides the player to a goal for the first night.
3. **A base has no survival function beyond the workbench.** Survival category = workbench, claim beacon, spawn
   beacon. No campfire, no storage (everything rides in your pockets and 30 % is lost on death), no bed (the
   respawn point costs a 35-resource spawn beacon), no door (anyone walks in), no light that works at night
   without power (online power accrual is off). At 22:30 the base is pitch black (a5-night.png).
4. **No gear or progression after the plasma rifle.** Workbench Mk II only unlocks railgun + rail slugs;
   no armour, no shield upgrades, nothing found in POIs (ruins / outposts / crash sites have no loot of their own).
   Credits have no survival sinks.
5. **Night is only "dark + more drones".** No warmth / comfort, no reason to be home at night, no cosy moment.
6. **Death UX:** respawn options are Spawn beacon / Base / Overlook (no bed); the "You dropped your supplies"
   toast covers the death screen's title (a6-death.png); the crate timer only lives in the marker label.
7. **HUD clutter, bottom-right:** key hints + consumable quick bar + weapon card stack in one corner (a2-wild.png);
   on phones the resources panel overlaps the touch cluster (open request from mobile/combat).
8. **Placement in rugged biomes:** in the badlands the claim / spawn beacon fail with "Too steep here" at most
   spots near the player (free pieces need near-flat ground); the reason gives no hint where it would fit.
9. **First person (new this wave):** build mode lerps the third-person build camera (shoulder 1.1, zoom 6.4);
   in first person that would fight the FP camera. The ghost already aims along the camera ray (= eye ray in FP).

## Plan (priority order)
1. Items for the other slices (berries, mushroom, jungle-fruit, fiber, crystal-shard, raw-meat) + item costs.
2. Food & cooking: eat raw food, Campfire (warmth + timed cooking via C.STORE), cooked meals with buffs,
   energy rebalance (hunger matters in a 40-min day/night, night cold away from a fire).
3. Base pieces: campfire, storage chest (server contents, owner lock, persistent), bed / sleeping bag (respawn +
   rested), door (owner lock), torch; FP-safe build camera; demolish preview; §11.2 rules overlay while building.
4. Onboarding chain: leave the hub → gather → tools → campfire + cook → claim → shelter + bed → survive the night.
5. Gear: armour + shield modules (gear slots), schematics from POI caches, Workbench Mk III.
6. HUD: buff strip, food quick slot, death crate chip, phone resources panel.

## Log
- (10:50) read PLATFORM/ARCHITECTURE/protocol + previous wave notes (sim, smp, net, combat, frontier, server …);
  harness in scratchpad/survival; assessment run (above).
- (11:05–11:37, previous session, reconstructed 13:05 from the files) M1–M3 done:
  items (food, materials, meals, gear, schematics, BUFFS, FOOD_ORDER, DROPPABLE_ITEMS) + item costs in
  inventory.js; COOK_RECIPES; pieces campfire / sleeping-bag / bed / storage-chest / door / torch / workbench-3
  (+ UPGRADES); shared/sim/storage.js (C.STORE chest / fire / bed / door, persistence, spill on demolish);
  players.js (buffs, warm / cold statuses, gear, bed respawn, energy 1/24 s); reasons; storage.test.js (7 tests);
  client: src/smp/base.js (campfire + chest panels, bed, door prompts), screen.js (gear slots, food, tools),
  hud.js (buff strip, quick bar 'food'), bridge (S.STORAGE, fx), src/build pieces (models), firelight.js
  (pooled warm lights). Shots b1-cook, b2-chest, b3-inventory, b4-night (shots/survival/).
- (13:05) resumed. npm test 292/292 green. Still open: onboarding chain (quests/data.js), threats' loot ids
  (rare-alloy, warden-core, blueprint-*) not defined, death toast over the death screen + crate chip, phone
  resources panel, gear card layout (b3), build polish (rules overlay), online checks (restart + 2 clients).
- (13:15) onboarding chain in src/systems/quests/data.js (wild1 Into the Wild → wild2 Tools of the Trade → wild3 Fire
  and Food → wild4 A Place of Your Own → wild5 The First Night → survival2 Armed and Ready → wild6 Salvage and Gear),
  Gateway marker in the hub, home marker at night, "survive until dawn" (a defeat waits for the next night);
  single-player 'home' quest off while smp.online; HUD tips rewritten (workbench / campfire / bed, no "find a
  workbench" nag). node test src/smp/onboarding.test.js drives the chain through the real quest engine.
- (13:25) death UX: smp.stats.dead tracked; the drop toast waits for the respawn; gold crate chip (distance + timer)
  in the buff strip. smp:pickup carries the crate kind ('cache' → wild6). Phone: compact resources chip row
  (touch + height ≤ 540). Gear slots one per row. Free pieces on slopes: threshold max(0.75, 1.05 r) + hint
  "flatter ground or on a foundation". Fruit skewer 4 berries → +40 en (cooking now always beats raw).
  Hub supply depot in the inventory (credit sink: rations, medkits, shield cells, fiber, grenades, crystal shards;
  MARKET 'supply-*' + SUPPLY_IDS, C.SPEND market, hub only in the UI).
- (13:30) online: src/smp/online.test.js — real server (SIM real): Gateway → wild, claim + chest + bed, put items,
  a second client sees the chest but gets 'private' (open / take / sleep) and 'claim' (build); restart → contents +
  home bed persist. Browser run (offline LocalServer): the whole chain hub → dawn completes with real crafting,
  placing, cooking, eating, sleeping (gather events synthetic); shots c1-hub, c2-tracker.

