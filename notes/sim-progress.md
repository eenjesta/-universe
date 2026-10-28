# sim engineer — progress log

## Done (verified)
- shared/defs/*: weapons, enemies (+ SPAWN rules, stand-in SPAWN_TABLES per biome), items (resources, ammo,
  consumables, survival, start inventory, loot, grant caps), recipes, pieces (catalog port + workbench /
  workbench-2 / claim / spawn beacon, BUILD_PROTECTED), market (prices + sell), reasons (deny codes, bilingual),
  world (§11: HUB, CLAIM_RULES, TRAVEL_RULES, hubDist, BIOMES, ZONE_TEXT), index.
- shared/protocol.js: ES enemy state codes, optional fields (STATE tp, FIRE vt, SNAP tod/n, TRAVEL, …).
- shared/sim = full API (createSim, addPlayer → welcome, removePlayer, handle, step, drain, snapshotFor,
  exportWorld/importWorld, exportPlayer, stats + helpers recipients/playersNear/playerPos/setProfile/setClock/
  teleport/time/setTime/nodes/nodesNear/isSafe/biomeAt).
- §11 one seamless world: world providers (world.js resolveWorld: explicit fns > worldgen object > stand-in),
  standin.js (hub heightfield + fBm outside, biomes, spawn tables, 64 m node cells, isBuildable), travel.js
  (C.TRAVEL hub channel / gateway wild|base|beacon), claim decay (30 d + 3 d), §11.2 build rules (buffer 500 m,
  height limit 16 m within 2 km, claim gap 30 m, claimForeign).
- (run 3) test suite repaired after a bad search/replace in the previous run (1000 → 3000 ms in the testkit
  clock and waits) and migrated to §11 (players at z≈2900 outside the hub, provider-driven spawn tests, new
  build reason codes): `node --test shared/sim/*.test.js` → 43/43 pass.

- (run 3) world.test.js (9 tests): stand-in provider, resolveWorld adapters (spawnTable biome fill-in, chunk
  features, explicit > worldgen, throwing providers → static hub square safe), hub safety, world-node harvest,
  C.TRAVEL (channel / combat lock / cooldown / cancel / gateway wild|base|beacon), claimForeign, claim decay
  (+ restore / removal notices), downtime shift (exportWorld.at) + no decay when trusted, moderation
  `sim.removeStructures`. Perf test moved to the wild (stand-in world like the server), CPU-time based:
  ≈1.0–1.7 ms CPU per step (wall 1.8–3.9 ms on a box with load avg 20–40). Tier-0 recipes supported.
- (run 3) full suite 54/54; server 20/20, net 15/15, smp+combat 28/28 against the sim; vite build OK.
- README rewritten for §11 (providers, hub rules, travel, claims/decay, moderation); sim-requests.md rewritten.

- (run 3) shared/worldgen landed (worldgen.js, no index.js yet): adapters extended (tuple tables [type, w, max,
  nightOnly], per-type `max` caps, BiomeSample → id, nodes-only chunk opts); real-worldgen test in terrain.test.js
  (index.js → worldgen.js fallback): night spawns in the wild only, `n:cx:cz:i` node harvest, gateway. 50 players
  + real worldgen at night: 117 enemies over 9 biome/type combos, 1.7 ms CPU mean per step (heightAt ≈10 µs).
- (run 3) online smoke (own server, PORT=0, stand-in world on the baked hub): welcome in the hub (safe), Gateway →
  wild (−4406, −4886), snapshots with enemies, energy drain, no corrections, Return-to-hub channel; no server errors.
- (run 3) claim decay off when `trusted` (LocalServer) / `claimDecay: false`; exportWorld.at → downtime shift.

## Next
- offline browser check (skipped: load avg 40+, ~9 other headless browsers running) — net's node tests cover the
  LocalServer + real sim path.

- (run 3, final) sim 54/54, consumers (server + net + smp + combat) 75/75 against the current sim, vite build OK.

## Open problems
- Browser (headless) check not done this run: the shared box was at load avg 40+ with ~9 other headless browsers.
- shared/worldgen has no index.js yet (server/LocalServer fall back to the stand-in until it exists).
- Night rule mismatch with worldgen's isNightHour (requested in sim-requests.md); harmless (night-only stalkers
  linger until the sim's daybreak ≈ 6.1 h).
