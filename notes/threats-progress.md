# Threats & combat (wave "survival play + first person") — progress log

Owner: threats engineer. Files: `src/combat/**`, `shared/sim/enemies.js`, `shared/sim/combat.js`, `shared/sim/los.js`,
`shared/defs/enemies.js`, `shared/defs/weapons.js` (+ `notes/threats-*.md`). Requests to others: `notes/threats-requests.md`.
Read this first when resuming. Previous wave's log: `notes/combat-progress.md` (test recipes still valid).

## Assessment (2026-10-28 10:50 — played headless before changing anything)

How I played: (1) a scripted bot against the REAL sim + shared/worldgen + the baked hub (scratchpad `threats/play*.mjs`):
standing / exploring / fighting in the badlands, jungle and forest by day and night, at an outpost and a ruin, and 12 Gateway
"Random wilderness" arrivals at night; (2) one browser pass in the east badlands (day + night fight, rifle, 960×540 low).

Numbers that matter:
- Standing in the badlands at night for 150 s: 6–7 drones exist around me, but only ever ONE engages (dmg 0.4/s). By day 0.1/s.
- Exploring at 5 m/s without shooting back (3 min): engaged 76 % of the time in the badlands at night (3 deaths), jungle night
  5 deaths (stalkers run 11 m/s — you cannot outrun them), forest day 32 % / 0 deaths. Max 2–3 simultaneous attackers.
- Night Gateway arrivals (AFK, 30 s): 1 of 12 died (jungle, targeted after 16 s), another took 140 damage; no grace at all.
- Outpost (4.2 km E) by day: three drones, same loot as anywhere. Ruin: three drones.

Top problems, biggest fun / clarity loss first:
1. **Monotone threats.** Two enemy types; a biome effectively spawns ONE type (badlands = drones only, jungle = stalkers only).
   "Pirate Outposts" have no pirates — just more drones. No boss. Nothing to look forward to or plan for.
2. **Isolated, dumb AI.** Enemies notice you only within 42–55 m with line of sight; neighbours ignore gunfire and dying friends
   (no alert / pack behaviour), nobody flanks, retreats or takes cover. Fights are a series of 1v1 duels.
3. **No counterplay against drones.** Lasers are instant hitscan with 85 % accuracy at short range and no telegraph — dodge [Q]
   does nothing against them; stalker claws land the moment they arrive. Damage feels random rather than earned.
4. **Unfair arrivals.** Gateway arrivals / respawns outside the hub have no grace: enemies spawn 45 m away and engage at once.
5. **Night = attrition, not tension.** More random patrols, no build-up (no warning, no searchlights, no howls), no escalation
   you can read; the payoff (better loot at night / at POIs) does not exist.
6. **Readability / feel** (browser shots): rifle damage numbers stack side by side ("9 9 9 9"); several "Enemy" pings stack
   into an unreadable column; the hurt vignette washes the WHOLE night screen red at 96 hp; drones / stalkers are small dark
   silhouettes at night (tiny red eye); the damage-direction arc is huge at the top centre; enemies only flash when hit (no
   stagger / knockback / hit reaction), kills are a small pop; no hit-stop.
7. **Loot ignores danger.** Drones always drop metal/energy/pulse cells; POIs drop the same as a random patrol.
8. Known from notes: compass enemy markers need colour/kind for ux; touch aim assist is a flat 4.5° magnet.
   The red `.cbt-boss` bar: hidden correctly now (computed display none in the badlands) — kept on the regression list.

## Plan (priority order)
1. Sim fairness + smarter AI: arrival / respawn grace (+ no spawns near fresh arrivals), alert & pack behaviour (gunfire and
   deaths alert neighbours, investigate), low-HP retreat, telegraphed drone shots (charge-up you can dodge), dodge i-frames.
2. Pirate raiders (humanoid combat robots, rifles, squads 2–4): outposts + badlands/coast patrols; cover / flank / suppress /
   retreat; client model + animation + red bolts.
3. A biome creature (Crystal Highlands swarmers) — packs, AoE-friendly.
4. De Wachter world boss (fixed site east, dormant, phases, weak points, boss bar, synced, loot, respawn timer).
5. Combat feel: damage-number accumulation, ping de-stacking, vignette, hit-stop, hit reactions / stagger, kill FX, recoil
   patterns, sounds, low-health feedback, first-person (muzzleWorld, ADS, crosshair).
6. Loot by danger (POI / night / boss tables; item ids coordinated with survival). 7. Touch aim assist tuning.

## Resume (2026-10-28 13:05) — state found after an interrupted run
The previous run implemented (11:00–11:38, not logged until now) and left green:
- sim: GRACE (arrival/respawn grace + spawn-free bubble), telegraphed drone charge, dodge windows (pending hits +
  HIT_SLACK), alerts (gunfire noise, deaths, hurt squadmates), stalker pack howl, low-HP retreat, raider squads
  (cover/peek/aim/burst, flanker, suppressor, barriers, fall back), crystal mites (swarm, hop-bites), POI garrisons
  + supply caches, night hunts (S.EVENT hunt), loot by danger (DANGER multipliers, CACHES), De Wachter (BOSS site
  3440/660, dormant → wake, stomp waves, beam sweep, drone summons, rune weak points + stagger, phases, reset,
  per-fighter crates, respawn timer). Tests in shared/sim/enemies.test.js (+ combat.test.js) — npm test 292/292.
- client: enemy-models.js (raider robot, mite, barrier), warden.js (boss visual), enemies.js (anims, telegraphs,
  hit-stop/push), controller (recoil patterns, boss bar/events, hunts, cache marker, boss compass marker), hud
  (damage-number accumulation, ping clustering, boss bar, dodged pop), sounds.
- browser: only two shots (scratchpad threats/B-raiders.png = broken camera framing, C-boss.png = boss + bar ok).
Open (this run): verify build + browser offline/online, integration requests (V = camera now → quick grenade
moves; gather wantsClick; smp respawnOptions; loot ids from survival), FP checks, polish, final screenshots.

## Run 2 log (2026-10-28 13:05–)
- (13:40) FOUND: POI garrisons never spawned in the real world — `W.world.poisNear` doesn't exist (only the test
  fake had it). Fix: enemies.js resolves POIs from W.world.poisNear → W.worldgen → a private createWorldgen copy
  (same recipe as the economy's; left on W.worldgen for reuse). Roaming squads of the garrison's type no longer
  spawn within 200 m of a garrisoned POI. Loot ids → survival's items (schematics, shield-module, bandage, fiber,
  crystal-shard) + RARE extras (night / captain / hunter). Death screen renders smp.respawnOptions (bed first).
  Quick grenade V → middle mouse / Z (V = camera). Draw-on-click skipped while ctx.gather.wantsClick.
- (14:05) Outpost structures are cover now (no shooting through walls, either way): shared/sim/los.js poiCover /
  segCover mirror the frontier's outpost model (huts, tower platform, palisade panels, crates, barrels) + wreck hulls
  (src/combat/cover.test.js checks the huts against src/frontier/models.js colliders). Enemy LOS (clearLine), the
  server's hit validation ('blocked'), grenade AoE LOS and the client's trace all use the same boxes. Raiders pick
  cover behind structures and LEAN OUT to a side peek point to shoot (back in after the burst or when hit).
  Node play at outpost p:3:-1: AFK player dies in ~25 s, a fighting bot (50 % hits) kills 3/4 in 40 s, takes 103.
