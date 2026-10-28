# Ø Universe — Platform & SMP v1 contract

Ø Universe grows into a modern Roblox-like platform whose flagship experience is
a complete **SMP** (survival multiplayer) in the existing world. This file is the
contract for v1 (multiplayer + SMP core). `ARCHITECTURE.md` stays the client
contract; `shared/protocol.js` is the wire contract. English by default + Dutch
(`t({ en, nl })`) everywhere, desktop + touch.

## 1. v1 scope (what friends can play)

- One persistent shared world (the hub = the existing world) with up to 50 players:
  see each other walk/drive/fly/build, name tags, global/local chat (filtered).
- Guest accounts (no login yet): a server-issued token in localStorage; profile
  (name + appearance from the character creator), inventory, stats and position
  are saved **on the server**. Real accounts (e-mail/OAuth) come in v2.
- Survival: health 100, shield 50 (regenerates 4 s after damage, 10/s), energy 100
  (drains 1 per 40 s, faster when sprinting; at 0 you lose 1 hp/s). Rations
  restore energy, medkits health, shield cells shield.
- Combat (third person, PvE only in v1): weapons pulse pistol, plasma rifle,
  railgun, shock grenade; aim (right mouse), fire (left), reload (R), switch
  (1–4 / wheel when not building), dodge roll (Q). Server-validated damage.
- Enemies (server AI): security drones (flying, ranged) around the ruins, the
  signal and the canyon, more at night; jungle stalkers (fast melee creatures)
  in the Lumen Jungle and forests at night. They drop loot.
- Death & respawn: on death you drop 30 % of carried resources (not weapons) in a
  loot crate only you can open for 10 minutes; respawn at your spawn beacon, your
  base or the Overlook.
- Gathering + crafting: harvest nodes (existing build module) give resources via
  the server; a **workbench** build piece unlocks crafting (ammo, rations,
  medkits, shield cells, plasma rifle, grenades; railgun at workbench tier 2).
- Building in the shared world with **claims**: a claim beacon piece protects a
  radius (24 m) — only the owner (and later their party) can build/remove there;
  structures persist for everyone. Spawn beacon piece = respawn point.
- Safe zones (no enemy spawns, no combat): Nexus Plaza, the Overlook spawn ridge,
  the spaceport apron, inside your own claim during the day.
- Offline / single-player still works: when no server is reachable the client
  runs the same simulation in the browser (LocalServer) — one code path.

Later phases: real accounts + friends/parties/squads, base-defense night raids with
turrets and shield domes, the boss "De Wachter" (Sunfall Canyon), loadout screen
with upgrades, opt-in PvP, Ø Studio (create/publish experiences), creator logic,
discovery, marketplace, colony frontier (Kepler-Ø 7).

## 2. Layout & ownership

| path | what | owner (v1 engineer) |
|---|---|---|
| `shared/protocol.js` | wire contract (message types, rates, caps) | sim (others request changes in `notes/`) |
| `shared/defs/*.js` | weapons, enemies, items, recipes, build-piece SMP stats (data, bilingual names) | sim |
| `shared/sim/**` | the SMP simulation (pure JS: no DOM, no Node APIs) | sim |
| `server/**`, `Dockerfile`, `.dockerignore`, `railway.json` | Node service: http static + WebSocket, sessions, persistence, chat, ops | server |
| `src/net/**` | client transport (WebSocket or LocalServer), sync, interpolation, `ctx.net`, chat/state bridges, presence UI | net |
| `src/characters/**` | remote player avatars, weapon holding + aim/shoot/hit/death poses | avatars |
| `src/combat/**` | weapons client, aiming/firing/FX, crosshair/hit markers, HP/shield/ammo HUD, enemy visuals, death/respawn screen, touch combat layout | combat |
| `src/smp/**` + `src/build/**` | inventory & crafting UI, consumables, loot pickups, claims, build-online authority, new SMP build pieces | smp |

`package.json` scripts/deps and `vite.config.js` are core (integrator); ask in `notes/`.

## 3. Runtime topology

```
browser ── WebSocket /ws ──▶ server/ (Node 26, ws) ──▶ shared/sim (authoritative)
   │                              │                       └─ terrain heights: src/world/terrain/heightfield.js (bakeTerrain + sampleGrid in Node)
   │                              └─ store: JSON files in DATA_DIR  |  Postgres via DATABASE_URL
   └─ offline: src/net/LocalServer (same protocol, shared/sim in the page, localStorage store)
```

The Node server also serves the built client (`dist/`) on the same port, so one
Railway service runs everything. Health check: `GET /healthz` → `{ok, players}`.

## 4. Simulation API (`shared/sim/index.js`)

```js
const sim = createSim({ getHeightAt, isWater, now: () => ms, seed, world /* persisted world data or null */ })
sim.addPlayer({ id, name, appearance, save /* persisted player data or null */ }) → welcomePayload  // inv, stats, structures, claims, loot
sim.removePlayer(id) → playerSave                           // data to persist
sim.handle(id, msg)                                          // any client message except hello/chat/ping/profile
sim.step(dtSeconds)                                          // AI, projectiles, regen/drain, spawns, loot ttl, respawn timers
sim.drain() → [{ to: id | '*' | { near: [x, z, r] }, msg }]  // outgoing messages since the last drain
sim.snapshotFor(id) → S.SNAP message                         // interest-managed (NET.INTEREST_RADIUS)
sim.exportWorld() → worldSave                                // structures, claims, loot; importWorld via createSim({ world })
sim.exportPlayer(id) → playerSave                            // { p, h, stats, inv, unlocks }
sim.stats() → { players, enemies, loot, structures }
```
Deterministic where it matters (seeded spawns per region); no wall-clock calls
inside the sim except through `now()`.

## 5. Server (`server/`)

- `node server/index.js` — env: `PORT` (default 8080), `HOST` (default 0.0.0.0 in
  production, 127.0.0.1 locally via `--local`), `DATA_DIR` (default `./data`),
  `DATABASE_URL` (Postgres; when set it wins over DATA_DIR), `STATIC_DIR` (default `dist`),
  `ALLOWED_ORIGINS` (comma list; default same-origin), `LOG_LEVEL`.
- Sessions: `hello` with an unknown/no token creates a guest (random 32-byte token,
  stored hashed); replies `welcome` with the token. Name filter + length 2–20.
- One world instance (`hub`), `NET.MAX_PLAYERS_PER_WORLD`; overflow gets `error {code:'full'}` in v1.
- Per-connection rate limits (`NET.MSG_RATE`, chat `NET.CHAT_RATE`), max frame 16 kB,
  movement validation (`NET.SPEED`), message schema checks, ping/pong, idle timeout 60 s.
- Chat: filtered (bilingual word list → asterisks), `local` = within 60 m, `global` = everyone;
  `sys` messages for join/leave.
- Persistence: autosave every 30 s + on SIGTERM/SIGINT; player saves on leave.
  Store interface: `loadWorld()`, `saveWorld(data)`, `getPlayerByToken(hash)`,
  `createPlayer({tokenHash, name, appearance})`, `savePlayer(id, data)`.
- Deploy: `Dockerfile` (node:26-slim, `npm ci`, `npm run build`, `node server/index.js`),
  `railway.json` (healthcheck `/healthz`, restart on failure). Railway: one service +
  optional Postgres plugin (`DATABASE_URL`) or a volume mounted at `DATA_DIR`.

## 6. Client net layer (`src/net/` → `ctx.net`)

- Installed as a core module before `systems` (manifest entry `net` in `src/game.js`).
- Connects to `ws(s)://<host>/ws` unless `?offline`; `?server=<url>` overrides; falls back
  to LocalServer automatically when the socket can't open within 4 s (toast "Offline mode").
- `ctx.net = { online, mode: 'online'|'local'|'connecting', id, players (Map id → remote),
  enemies (Map), loot (Map), send(msg), on(type, fn) → off, ping, serverTime(), interp(entity) }`.
- Events on `ctx.events`: `net:status {mode}`, `net:welcome`, `net:join {id,name,appearance}`,
  `net:leave {id}`, `net:damage`, `net:death`, `net:respawned`, `net:stats`, `net:inv`,
  `net:loot`, `net:struct`, `net:claims`, `net:event`, `net:deny`, `net:fired`, `net:efire`, `net:boom`.
- Sends the local player's state at `NET.STATE_HZ` (position/heading/anim/mode/vehicle).
- Remote players & enemies: snapshot buffers + interpolation (`NET.INTERP_DELAY_MS`);
  modules read `ctx.net.players.get(id).view` → `{p:Vector3, h, a, m, hp, sh, veh}` each frame.
- State bridge: server `inv`/`stats` are the truth — mirrored into `ctx.state`
  (`resources`, `credits`, `smp.*`); quest/event rewards and market purchases go through
  `GRANT`/`SPEND` (patch `ctx.state.gain/spend` only while online/local-server mode).
- Chat bridge: outgoing player chat (systems `chat:sent`) → `C.CHAT`; incoming `S.CHAT` →
  `ctx.chat.post(...)` (NPC chat replies stay local). Presence: "Online · N" indicator and a
  player list (Tab), connection status.

## 7. Client modules

- **avatars** (`src/characters`): `ctx.remotes = { add(id, {name, appearance}), remove(id), get(id) }`
  driven by `ctx.net` views each frame (walk/run/jump/swim/drive-seated/aim/shoot/hit/dead),
  name tags with health bars; `ctx.player.holdWeapon(mesh | null, {grip})`, `ctx.player.setAim(bool)`,
  `ctx.player.playAction('shoot' | 'reload' | 'hit' | 'dodge' | 'die' | 'respawn')`.
- **combat** (`src/combat` → `ctx.combat`): reads weapon defs from `shared/defs/weapons.js`;
  local firing feels instant (client FX + recoil) and sends `FIRE`/`HIT`; the server decides damage.
  HUD: health/shield/energy (bottom-center in explore), ammo (bottom-right, order 5), crosshair +
  hit markers (center), damage vignette, killfeed (right). Enemy visuals from `ctx.net.enemies`.
  Death screen with respawn choices. Touch: `ctx.touch.setLayout` overlay with Fire/Aim/Reload/Switch/Dodge.
  Combat is disabled in build mode, vehicles, space, safe zones (holstered) and dialogues.
- **smp** (`src/smp` → `ctx.smp`): inventory + crafting screen (key I; touch menu entry),
  consumables (hotkeys 5–7: ration, medkit, shield cell), loot crates (pickup via E), death-drop
  marker, claims overlay, survival tips; and the build module's online authority:
  `ctx.build.setAuthority({ place(rec) → Promise<{ok, record|reason}>, remove(id) → Promise })`,
  `ctx.build.applyRemote({ add, remove })`; new pieces: Workbench, Claim beacon, Spawn beacon.

## 8. Gameplay numbers v1 (live in `shared/defs`)

| weapon | dmg | rate | mag / reserve | range | notes |
|---|---|---|---|---|---|
| Pulse pistol (Pulspistool) | 14 | 4/s | 12 / 60 | 60 m | start weapon |
| Plasma rifle (Plasmageweer) | 9 | 9/s auto | 24 / 120 | 90 m | spread 1.2° → 0.4° aimed; crafted (tier 1) |
| Railgun | 75 | 0.8/s, 0.4 s charge | 4 / 16 | 250 m | crafted (tier 2) / rare loot |
| Shock grenade (Schokgranaat) | 60 in 6 m | throw | carry 3 | 25 m throw | stuns 1.5 s; crafted |

| enemy | hp | attack | speed | where |
|---|---|---|---|---|
| Security drone | 60 | laser 6 dmg, 1.2/s, 45 m | 9 m/s flying | ruins, signal, canyon; ×2 at night |
| Jungle stalker | 90 | claw 14 dmg melee | 11 m/s | Lumen Jungle; forests at night |

Loot: drones → metal 3–8, energy 2–5, pulse ammo; stalkers → wood/stone 4–10, rations.
Respawn delay 5 s. Recipes (workbench): pulse ammo ×30 (metal 4, energy 2), plasma cells ×40
(metal 6, energy 4), ration (wood 2, energy 1), medkit (metal 2, energy 3), shield cell (energy 6),
plasma rifle (metal 60, energy 25, tier 1), shock grenade (metal 8, energy 6), workbench tier 2
upgrade (metal 120, stone 80, energy 40), railgun (metal 140, energy 60, tier 2).

## 9. Dev & test

- `npm run server` → `node server/index.js --local` on 127.0.0.1:8080 serving `dist/`
  (run `npm run build` first). `npm run dev` (Vite) proxies `/ws` to `WS_TARGET`
  (default `ws://127.0.0.1:8080`).
- Node-level tests: `node --test shared/sim/*.test.js server/*.test.js` (protocol + sim
  logic + two fake WebSocket clients). Browser checks: `tools/shot.mjs` against
  `http://127.0.0.1:8090` (a test server started by the engineer with `PORT=8090`),
  two low-quality clients max. The machine is shared: one browser at a time.

## 10. Platform layer v1 (Roblox model): accounts, friends, experiences, Home, Ø Studio

Ownership: `server/platform/**` (platform-server), `src/platform/**` (platform-client,
may also edit `src/shell/title/**` to route Play → Home), `src/studio/**` (studio).

**HTTP API** (JSON, under `/api`; auth = `Authorization: Bearer <token>`), implemented in
`server/platform/` as `createPlatform({ dataDir, databaseUrl, log }) → { handle(req, res) → bool,
resolveToken(token) → user|null, setPresence(userId, status), close() }`. The game server mounts it:
any request whose path starts with `/api/` goes to `platform.handle` (integrator wires it if the server
engineer hasn't). Its own store: JSON files in `DATA_DIR/platform/` or Postgres tables
(`users, sessions, friends, experiences, experience_versions, likes, reports`) when `DATABASE_URL` is set.
- `POST /api/auth/register {username, password, birthYear, guestToken?}` → `{token, user}` (scrypt hashes;
  username 3–20 `[a-z0-9_]`, filtered; under-13 accounts get chat/friends restricted by default;
  `guestToken` links the guest's game save to the account).
- `POST /api/auth/login {username, password}` → `{token, user}` · `POST /api/auth/logout` · `GET /api/me`.
- `GET /api/friends` (with online status) · `POST /api/friends/request {username}` ·
  `POST /api/friends/accept {id}` · `POST /api/friends/remove {id}`.
- `GET /api/experiences?sort=popular|new&q=` · `GET /api/experiences/:id` (meta + latest published
  version) · `POST /api/experiences` (create draft) · `PUT /api/experiences/:id` (save draft) ·
  `POST /api/experiences/:id/publish` · `POST /api/experiences/:id/like` · `POST /api/experiences/:id/play` ·
  `DELETE /api/experiences/:id` · `GET /api/users/:username/experiences`.
- `POST /api/report {kind, targetId, reason}`. Rate limits per IP/user; text filters on names/titles.
- The flagship SMP world is experience `o-universe` (built in, not stored).

**Experience format** (`format: 'o-universe-experience', v: 1`):
```json
{ "meta": { "title": "", "description": "", "maxPlayers": 20 },
  "settings": { "time": 17.6, "sky": "golden|day|night|space", "gravity": 1,
                "baseplate": { "size": 512, "color": "#3a3f47", "material": "concrete" } },
  "parts": [ { "id": "p1", "type": "block|wedge|cylinder|sphere|cone|spawn|light|text", "name": "Part",
               "p": [0,0,0], "r": [0,0,0], "s": [4,1,2], "color": "#ffffff",
               "material": "plastic|metal|glass|neon|wood|concrete|grass|ice",
               "anchored": true, "collide": true, "transparency": 0, "group": null, "props": {} } ],
  "groups": [ { "id": "g1", "name": "Model", "parent": null } ],
  "logic": [] }
```
Limits v1: 5000 parts, 2 MB JSON; thumbnails as small JPEG data URLs.

**Client:** `src/platform` → `ctx.platform = { user, token, login(), register(), logout(), api(path, opts),
friends, openHome(), openExperience(id) }` and the **Home** screen (after Play on the title): experience
rows (Ø Universe SMP first, Popular, New, Mine), friends + online status, avatar + Ø-credits, login /
register / "save your progress" (guest → account), touch-friendly. `src/studio` → mode `studio`
(Ø Studio editor, own scene) and mode `experience` (plays a published experience: own scene, parts as
physics, a simple third-person controller with the player's avatar, spawn parts, respawn on fall);
`ctx.studio = { open(draftId?), play(experienceJson) }`. User experiences are single-player in v1;
multiplayer per experience comes with v2.

## 11. The world: a safe social hub in the middle, infinite survival around it (DECIDED 2026-10-27 — overrides §1 where they differ)

> The owner: the current world becomes a safe social hub without survival; survival happens in an
> infinite world "like Minecraft" where you build your own base; items travel with you — and then:
> "Of kunnen we om de sociale hub niet de survival wereld maken" → YES: ONE seamless planet.

- **One world per server** (instance `world`, ≤ 50 players; more servers/shards later, each its own
  persistent world — like Minecraft servers with a protected spawn town).
- **The HUB = the existing hand-made area in the middle** (Aurora City, Nexus Plaza, the lake, the
  spaceport, …, roughly |x|, |z| ≤ 1100 m around the origin): a protected SAFE ZONE — no enemies,
  no combat (weapons holstered), no damage, no hunger drain, no building. Social: presence, chat,
  market, festivals, NPCs, vehicles. The old base area (glass villa + plot) will be replaced later.
- **Beyond the hub the planet continues INFINITELY** (procedural, `shared/worldgen`, smooth Ø-style
  terrain, not voxels): survival — biomes, resources, POIs (Ø ruins, pirate outposts, crash sites,
  energy crystals), enemies (more at night), your own base anywhere via claims (persistent).
  Same sky (with the giant planet), same water plane (y = 0), same time of day as the hub.
- **Seam:** `shared/worldgen` blends from the hub heightfield to the procedural terrain in a band
  (≈ 1100 → 1400 m); continuity of themes: Lumen Jungle → jungles to the west, Sunfall Canyon → red
  badlands to the east, the open sea → ocean to the north/north-east, forests/mountains/meadows south.
  `createWorldgen({ seed, hub: { heightAt, isWater, radius: 1100, blend: 300 } })` gives the combined
  `heightAt` (server: hub heightfield baked in Node; client: the terrain module's getHeightAt).
- **Border:** a visible boundary (Ø beacons/markers) and a HUD state "Safe zone" / "Leaving the safe
  zone"; `isSafe(x, z)` = inside the hub radius (plus buffer for spawns: no enemy spawns within ~1300 m).
- **Client rendering:** the hub terrain + atmosphere stay; `src/frontier` streams the procedural terrain,
  vegetation, POIs and resource nodes ONLY outside the hub (same scene, same atmosphere, matching
  materials at the seam); the hub's distant backdrop mountains (src/world/terrain/backdrop.js) give way
  to the real terrain (integrator), the play bounds are lifted, the minimap/map get a procedural layer.
- **Items** are simply yours everywhere (one world, per-account save).
- **Later:** other planets (e.g. Kepler-Ø 7 via the colony ship) as separate worlds/instances.

### 11.2 Keeping the hub open — anti-wall-in rules (decided 2026-10-27)

The owner: "Hoe zorgen we dat ze niet om de sociale hub alles heenbouwen en dichtbouwen?"
`hubDist(x, z)` = distance outside the hub square (max(|x|, |z|) − 1100, ≥ 0).
- **No-build buffer:** no building/claims where hubDist < 500 m (survival, combat, harvesting are allowed there).
- **Protected highways:** worldgen lays 6–8 roads from the hub border outward (~6 km; land directions only,
  gently following the terrain; flattened, road surface like the hub roads; a waystone beacon every km).
  No building within 20 m of a highway centreline (40 m corridor). `roadsNear(x, z, r)` / `isOnHighway(x, z)`.
- **Height limit:** where hubDist < 2000 m, structures may not rise more than 16 m above the terrain.
- **Claims:** one claim per player in v1 (radius 24 m); ≥ 30 m between claims of different owners; not on or
  within 60 m of POIs (ruins, outposts, crash sites); claims expire after 30 days of owner inactivity →
  the base decays to ruins over 3 days and is then removed (the owner is warned on login).
- `worldgen.isBuildable(x, z) → { ok, reason }` combines the static rules (safe zone, buffer, highways, POIs);
  the sim adds the dynamic ones (claims spacing, height, limits, decay).
- **Spreading players out:** a Gateway in the hub offers "Random wilderness" (a safe spot 2–8 km out),
  "My base / spawn beacon"; from anywhere "Return to hub" (10 s channel, not in combat, 2 min cooldown).
- **Moderation:** report a build (POST /api/report kind 'build'); admins can remove it.
