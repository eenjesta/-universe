# Threats & combat (wave "survival play + first person") → other owners

Owner: threats engineer — `src/combat/**`, `shared/sim/enemies.js`, `shared/sim/combat.js`, `shared/sim/los.js`,
`shared/defs/enemies.js`, `shared/defs/weapons.js`. Log: `notes/threats-progress.md`.

## Contracts that exist now
- Enemy types (`shared/defs/enemies.js` ENEMIES): `drone`, `stalker`, `raider` (pirate combat robots, squads 2–4, rifles),
  `mite` (Crystal Highlands / peaks swarm), `warden` (De Wachter, world boss), `barrier` (a raider's deployable shield
  wall — a prop: no AI / loot / kill feed). Snapshot rows `[id, type, x, y, z, h, s, hp, target | null, flags?]`; `flags` =
  `FLAG` bits (crouch, aim, retreat, alert, elite, windup, suppress, hunt); the boss row uses `BOSS_BITS` (phase, waking,
  runes broken, stagger).
- `S.ENEMY_FIRE w`: `laser` (+ `phase: 'charge'` telegraph), `bolt` (raider), `claw`, `bite`, `howl`, `aim` (raider aim
  line), `barrier` (deployed), boss: `stomp` (`phase: 'windup' | 'hit'`, `at`, `r`), `beam` (`a0`, `a1`, `dur`, `o`,
  `range`), `summon`, `roar`.
- `S.EVENT kind`: `boss` (`phase: 'start' | 'phase' | 'rune' | 'end'`, `result: 'defeated' | 'reset'`, `respawnAt`, `drops`),
  `hunt` (`phase: 'start'`, `type`, `n`, `from: [x, z]` — a night-hunt group picked up your trail), `poi`
  (`phase: 'cleared'`, `type`, `at`, `drop` — a POI garrison was wiped out, a supply cache dropped), `dodged` (`w`).
- `S.DAMAGE` may carry `weak` (1..3: a De Wachter rune hit). Loot crates may have `kind: 'cache' | 'boss'`.
- Markers set by combat: `cbt-enemy-<id>` (kind `'enemy'`, color `#ff5a4e`, compass), `cbt-hunt` (kind `'enemy'`),
  `cbt-boss` (kind `'boss'`, color `#ff3b2f`, fixed at De Wachter's arena `BOSS.site` (3440, 660) — always on the
  compass / map), `cbt-cache` (kind `'loot'`, gold, after a POI is cleared).

## ux (src/shell)
1. **Compass / map markers:** please draw kind `'enemy'` in `m.color` (red) and give kind `'boss'` a distinct boss
   glyph (red skull / crown) on the compass + world map, kind `'loot'` gold. Label of the boss marker: "De Wachter".
2. **Keys changed:** V is the camera toggle now → the **quick grenade moved to middle mouse / Z** (hold = arc, release =
   throw). Help / key hints: 1–4 / wheel weapons (same key = holster), RMB aim, LMB fire (hold = auto / railgun
   charge), R reload, Q dodge roll (rolls through stomps, beams, bolts and lasers), middle mouse / Z quick grenade,
   4 = grenade slot.
3. Boss bar sits in top-center (combat widget order 31, under the banner order 30) — keep the compass above it.

## survival (src/smp, shared/defs/items.js)
4. Done (your request 1): the death screen renders `ctx.smp.respawnOptions()` (up to 4, bed first, `ok` = enabled,
   keys 1–4). Your request 2: loot uses your ids — raiders `bandage`, `fiber`; outpost cache `schem-heavy-techwear`
   (35 %), ruin cache `schem-shield-module-2` (30 %) + `crystal-shard`, crash-site cache `schem-fabricator` (30 %) +
   `shield-cell`; De Wachter: `shield-module` (50 %), all three schematics (35–50 %), crystal shards, medkits, shield
   cells, credits + the railgun for anyone without one; night / captain / hunter kills roll `RARE` extras
   (`shield-module`, schematics, cells). Request 3 (stalker `raw-meat`) is in. Combat owns the **cleared-garrison
   supply cache** (`CACHES`); your own small POI caches are welcome as exploration loot — keep them modest so a
   cleared outpost stays the jackpot.

## integrator (shared/sim/index.js)
5. Please keep the generator on W (same as gather's request 1): `W.worldgen = opts.worldgen`. POI garrisons need
   `poisNear`; until W.worldgen exists, `shared/sim/enemies.js` makes one private generator copy (same recipe as the
   economy's) and leaves it on `W.worldgen` so the economy can reuse it when it resolves later.
6. `shared/protocol.js` doc only: the `S.ENEMY_FIRE` kinds, `S.EVENT` kinds and the `S.DAMAGE weak` field listed above.

## gather
7. Done (your request 4): the draw-on-click branch is skipped while `ctx.gather?.wantsClick` is true.

## fp-anim (src/characters)
8. Combat uses `ctx.player.muzzleWorld(out)` for every tracer / muzzle flash / grenade origin, `playAction('shoot',
   {recoil})`, `'reload'`, `'hit'`, `'dodge'`, `'die'`, `'respawn'`, `setAim`, `holdWeapon(group, HOLD[id])`. In first
   person the crosshair keeps only its dot while aiming (`.cbt-xh.is-fpaim`); recoil kicks the camera pitch/yaw ×1.15.
