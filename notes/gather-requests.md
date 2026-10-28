# Gathering & tools → other owners (requests)

Owner: gather engineer (`src/gather/**`, `src/build/harvest.js`, `src/frontier/**`, `shared/sim/economy.js`,
`shared/sim/nodes.js`, `shared/defs/tools.js`). Progress: `notes/gather-progress.md`.

## integrator (shared/sim/index.js, shared/protocol.js)
1. **Keep the generator on W** — one line in `createSim`: `W.worldgen = opts.worldgen && typeof opts.worldgen === 'object' ? opts.worldgen : null;`
   (next to `W.world = resolveWorld(...)`). `shared/sim/economy.js` validates `C.HARVEST {feature}` against the real
   chunk features (`worldgen.features(cx, cz)`). Until the line exists the economy builds its OWN copy of the
   generator from `W.H` / `W.isWater` / `W.seed` on the first feature harvest (identical output, but ≈ 0.1–0.4 s CPU
   and a second copy in memory — on the server and in the offline LocalServer).
2. `shared/protocol.js` doc only (the fields already work): `S.FEATURE { id, state, hp?, max?, by?, regrowAt?, tool?,
   h? (heading the harvester faced: trees fall away from it), got? ({res, items} — what the harvester received) }`.
   `C.HARVEST { feature, tool?, hit? }` as pre-wired (`tool` = 'multitool' | 'axe' | 'pickaxe' | 'plasma-axe' |
   'mining-laser' | 'hands'; `hit` = client swing counter). `C.HARVEST { node, tool? }` for resource nodes (a better
   tool gives more). New deny reasons (texts in shared/defs/tools.js `GATHER_REASONS`, merged into nothing — please add
   them to shared/defs/reasons.js when convenient): `tool` (+ `need`: tier), `blocked` (exists), `depleted` (exists).

## survival (shared/defs/items.js)
3. Items gathering drops (guarded by id until they exist — `gain()` skips unknown ids): `berries`, `mushroom`,
   `jungle-fruit` (food: restore energy, small hp), `fiber` (crafting), `crystal-shard` (rare, from energy-crystal
   formations, mining laser), `raw-meat` (reserved). Tools live in `shared/defs/tools.js` (TOOL_ITEMS: `axe`,
   `pickaxe`, `plasma-axe`, `mining-laser`, max 1 each; merged into ITEMS by items.js).

## threats / combat (src/combat)
4. **Click-to-draw vs. gathering**: while `ctx.gather?.wantsClick` is true (the player looks at a gatherable within
   reach, no weapon drawn) LMB belongs to gathering — please skip the "draw on click when holstered" branch then.
   Until then gather consumes that Mouse0 press itself (it runs at loop order 20, before cbt-control at 21).
