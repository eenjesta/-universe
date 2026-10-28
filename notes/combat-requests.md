# Combat (src/combat) — requests & integration notes

Owner: combat engineer. Public API: `ctx.combat` (header of src/combat/index.js). Combat null-checks every
cross-module API. State 2026-10-28 (run 4): runs on the real ctx.net (LocalServer + Node server), shared/defs/weapons.js,
shared/worldgen's / ctx.net.providers' / ctx.frontier's isSafe, ctx.player.holdWeapon/setAim/playAction, cameraRig.aimRay.

## OPEN — integrator (core)
1. **Lift `WORLD.playBounds` (src/world/layout.js, 1050)** — PLATFORM §11: all combat happens OUTSIDE the hub
   (|x|, |z| > 1100), so with the current bounds a player can never fight (player.js clamps every move and teleport,
   also the Gateway "Random wilderness" destination). Tests use `__game.debug.world.playBounds = 90000`.
2. Frontier wiring (frontier-progress.md steps 1–5): please also delegate **`w.raycastInto = frontier.raycastInto`**
   (combat's hitscan + build placement call `ctx.world.raycastInto`; the hub's version only knows ±1200 m). Combat
   already prefers `ctx.frontier.raycastInto` when `ctx.frontier` is set, and reads `ctx.world.getHeightAt` lazily
   (impacts, grenade arc); enemy heights come from the server. Pass the LocalServer's generator to the frontier
   (`createFrontierWorld(ctx, { worldgen: ctx.net.providers.impl, … })`) so offline heights/POIs match the sim exactly.
   Verified in tests with exactly that wiring (offline + online): safe zone off outside the hub, kills, death/respawn.
3. Optional ACTIONS: `reload: ['KeyR']`, `dodge: ['KeyQ']` (combat reads raw codes meanwhile). While armed the
   wheel switches weapons: combat sets `ctx.cameraRig.zoomEnabled = false` and restores it when holstered.

## OPEN — systems / build (phones)
- Phone landscape: the resources panel (top-right slot) reaches down into the touch button cluster (combat's
  Grenade / Dodge sit in the cluster's upper slots). A compact phone variant (one row of icons + numbers) or hiding
  it while `ctx.combat.armed` would fix the overlap. Combat itself moved its ammo readout into the vitals on phones.

## OPEN — shell
- Compass strip: markers of kind `'enemy'` should be drawn in `m.color` (red). Combat sets
  `ctx.markers.set('cbt-enemy-<id>', { kind: 'enemy', label: 'Enemy', color: '#ff5a4e', screen: false, compass: true })`
  while an enemy targets me (and draws its own on-screen "Enemy" ping above the enemy).
- Help / controls screen: 1–4 / wheel switch weapon (same key again = holster), RMB aim, LMB fire (hold = auto /
  railgun charge), R reload, Q dodge roll, 4 = shock grenade (hold LMB = arc preview, release = throw), V quick grenade.

## Notes for the others (no action needed unless you disagree)
- **smp**: the "Safe zone / Leaving the safe zone" chip is yours (smp.hud.setZone); combat only minimises its own
  HUD in the hub (`.is-safe`) and shows its own chip only when `ctx.smp.zone` is missing. `C.EQUIP {w}` from the
  inventory: combat follows `net:inv` `slot` changes. Combat's touch overlay `'combat'` spreads `ctx.net.touchMenu`
  + `ctx.smp.touchMenu` into `menuExtra` (read when applied).
- **sim**: everything combat needed is in (mag in INV, ES codes, DAMAGE kill/crit/from, en `target`, DEATH
  type/byName/kind). Combat sends `C.FIRE {w, o, d, seq, ct, vt}` (vt = `ctx.net.viewTime()`), one `C.HIT` per hitscan
  shot that hits an enemy volume (drone sphere r 0.85 at the snapshot y; stalker = body + head spheres from feet y),
  `C.THROW {w:'shock-grenade', o, v}` (|v| ≤ throwSpeed 21), `C.RELOAD {w}`, `C.EQUIP {slot}`, `C.RESPAWN {at}`.
  Deny reasons `rate` / `reloading` / `invalid` are reconciled silently; `empty` takes the deny's `mag` / `ammo`.
- **net**: LocalServer delivers via `queueMicrotask` — test scripts that drive `__game.debug.simulate()` must
  `await Promise.resolve()` between steps or nothing arrives until the script yields.
- **avatars**: combat calls `holdWeapon(group, {grip})` (group origin = grip, `userData.muzzle`), `setAim`,
  `playAction('shoot'|'reload'|'dodge'|'hit'|'die'|'respawn')`, `aimAt`, `muzzleWorld`.

## Test hooks (URL)
`?combatsafe=off` (never safe — staged tests / shots, the server still decides), `?combatsafe=static` (only the
sim's static zones), `?combatmock[=near]` (local fake server when there is no ctx.net). Debug: `ctx.combat.debug`
`{ info(), nearest(type), aimAt(id | point), track(id | point | null) }`.
