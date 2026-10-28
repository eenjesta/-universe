# Gathering & tools (wave "survival play") — progress log

Owner: gather engineer. Files: `src/gather/**`, `src/build/harvest.js`, `src/frontier/**` (feature state + visuals),
`shared/sim/economy.js`, `shared/sim/nodes.js`, `shared/defs/tools.js` (+ `notes/gather-*.md`).
Requests to other owners: `notes/gather-requests.md`. Read this first when resuming.

## Assessment (played headless, offline LocalServer, real frontier, 2026-10-28 10:55)
Staged in a Lumen Forest clearing south of the hub (120, 1500): 14 trees / 8 rocks / 6 bushes within 30–60 m,
16 streamed resource nodes (nearest 19 m). Findings, biggest first:
1. **The wilderness is scenery.** Trees, bushes, boulders and the big energy-crystal formations of the frontier can't
   be touched: no prompt when looking at a tree, hold E / LMB do nothing. The only gatherables are the sparse
   resource nodes (≈ 1 per 50 m), so "survival" = walk to a glowing rock and hold E.
2. **No tools, no progression.** `TOOLS = {}`; every node is a generic 1.4–1.8 s hold-E timer. Nothing to craft
   first, no reason to come back with a better tool, no tier gates (crystals, big outcrops).
3. **No physical feedback.** Gathering = a cyan ring on the ground + the node shrinking + one generic `harvest`
   sound; no swing, no character action, no chips/sparks/dust, no impact, no camera shake, no tree ever falls.
   The "+6 Energy" float overlapped the mission toast.
4. **No food from the land.** No berries / mushrooms / fruit / fiber — energy comes only from crafted rations.
5. **No shared world state.** Only nodes deplete (S.HARVESTED); nothing about trees/rocks reaches other players,
   nothing persists, nothing visibly regrows.
6. **Targeting is proximity-only.** With several nodes in range the nearest one wins regardless of where you look.
7. **Camera inside canopies.** Standing next to a pine the third-person camera sits in the branches (the view is
   needles) — chopping needs the camera to stay readable (first-person helps; tree proxy fades near the camera).

## Plan (priority order)
1. Rules + server authority: `shared/defs/tools.js` (tools, recipes, feature rules), `shared/sim/economy.js`
   (C.HARVEST {feature, tool, hit}: reach, LOS, swing rate, tiers, HP, yields per hit + on completion, regrowth,
   S.FEATURE, welcome/save), node tests.
2. Frontier per-instance feature state (feature ids per instance, hide/stump/rubble/regrow, berry/mushroom layers).
3. `src/gather`: look-at targeting + context prompt, hold E / LMB / touch action, tool draw + swings, impact FX,
   felling physics, floating "+N Wood", HP indicator, sounds, S.FEATURE/welcome sync, nodes through the same flow.
4. Polish + screenshots (tree falling, mining sparks, stump field regrowing, picking berries) + online 2-client check.

## Log
- (10:55) assessment done (scratchpad `gather/` harness: gh.js + mk.mjs + jobs/*.js → tools/shot.mjs batches).
- (11:00–13:45, reconstructed after the terminal crash) milestones 1–3 built: `shared/defs/tools.js` (tools, recipes,
  feature rules, GATHER_REASONS), `shared/sim/economy.js` (C.HARVEST {feature, tool, hit}, S.FEATURE, regrowth,
  featureStates / exportFeatures / importFeatures) + `shared/sim/gather.test.js` (7 tests green), `src/frontier/features.js`
  (per-instance state: hide / stump / rubble / regrow, crop layers), `src/gather/*` (controller, anims, fx, hands,
  models, hud, sounds). Headless runs smoke / tour / tour2 / fall / fp: tree (axe) 4 hits → felled, boulder (pickaxe)
  → broken, crystal (mining laser) → broken + crystal-shard, berries / mushroom / fern picked, both camera views,
  errors [] (shots in scratchpad gather/shots, contact sheets sheet-3p / sheet-fp).
- (14:45) resumed after the crash: remaining = online two-client check, full npm test, build, final notes.
- (14:55) status check: `npm test` 305 tests — 302 pass, 1 fail (`src/characters/test/fp-anim.test.js` "view model … still
  lowering", fp-anim's slice, not gather), gather.test.js 8/8 green; `npx vite build` OK. Still open: online two-client
  check (own server :8101) + final screenshots set.
