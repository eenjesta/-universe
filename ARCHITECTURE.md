# Ø Universe — architecture & contracts

Ø Universe is a ThreeJS (r186, WebGL2) browser game prototype that recreates the
concept poster `reference/concept.png` ("Ø UNIVERSE — EXPLORE · CREATE · CONNECT").
All in-game text is **English by default**, with **Dutch** as the second language (settings → Language, or `?lang=nl`). Every player-facing string is written bilingually with `t({ en: '…', nl: '…' })` from `src/core/i18n.js` (see §3 `ctx.i18n`); code/comments are English.
Everything is procedural: no downloaded models, images or audio files.

Poster crops for reference (read them!):
`reference/crop_hero.png` (title/hero shot), `crop_features.png` (4 pillars),
`crop_overview.png` (4 gameplay steps), `crop_kern.png` (core elements),
`crop_action_explore.png`, `crop_action_build.png`, `crop_action_social.png`,
`crop_action_space.png`, `crop_vehicles.png`, `crop_story.png`, `crop_custom.png`.

---------------------------------------------------------------------------
## 1. Running & testing

```
npm run dev                         # http://localhost:5173 (user dev server, HMR)
./tools/test-server.sh              # shared test server :5199 (no HMR) — already running
node tools/shot.mjs --path "/?mode=explore&zone=plaza&nosave" --out shots/<you>/plaza.png
npm run build                       # production build → dist/
```

`tools/shot.mjs` loads the page in headless Chromium (SwiftShader WebGL), waits
for `__game.ready`, runs optional `--eval`/`--steps`, saves a screenshot and
prints console errors (exit code 2 if any). See the header of the file for all
step types. Read your screenshots with the Read tool and judge them critically.

* SwiftShader is **slow** (~1 fps at `quality=high`). Use `&quality=low` for
  logic tests; use `&quality=high` (default) only for final visual shots, with
  `--wait 4000` or more so a few frames render.
* Never rely on real-time key holding in headless tests. Use the fixed-step
  simulator, which runs every loop system without rendering:
  `__game.debug.simulate(2, { hold: ['KeyW','ShiftLeft'] })`,
  `__game.debug.simulate(0.1, { press: ['KeyB'] })`,
  `__game.debug.simulate(1, { look: [300, 0] })`.
* `window.__game` is the `ctx` object; inspect anything (`__game.player.position`,
  `__game.debug.info()` → draw calls, triangles, systems, module errors).
* Put your screenshots in `shots/<your-module>/`.

URL parameters (combine freely):

| param | effect |
|---|---|
| `mode=title\|customize\|explore\|space` | start mode (default `title`) |
| `zone=<zone id>` | start on foot in that zone (implies `explore`) |
| `vehicle=car\|vtol\|ship` | summon + enter that vehicle after start |
| `build=1` | enter build mode after start |
| `time=<hours>` | time of day (e.g. `time=21` night, default 17.6 golden hour) |
| `quality=low\|medium\|high` | render quality |
| `nosave` | don't read/write localStorage (always use in tests) |
| `fresh` | wipe the save |
| module hooks | `dialogue=aria`, `quest=<id>`, `market`, `journal` (systems) · `garage` (vehicles) · `pause`, `map`, `debug` (shell) · `stage=<id>` (space) |

---------------------------------------------------------------------------
## 2. Code layout & ownership

```
index.html, vite.config.js, src/main.js, src/game.js     core   (orchestrator)
src/core/*        engine, loop, input, events, state, physics, interactions,
                  markers, modes, ui facade, audio facade, math, noise, textures
src/ui/base.css   design tokens + shared components      core
src/ui/icons.js   SVG icon set — modules add icons via registerIcons({...}) at install
src/world/layout.js  zone coordinates contract           core (read-only)
src/fallback/*    stand-ins used when a module fails      core (read-only)

src/world/index.js   composition of the two world halves (core-owned)
src/world/terrain/     terrain, roads, vegetation, rocks, minimap, height texture
src/world/atmosphere/  sky, sun/time of day, planet + moons, stars, clouds, lights,
                       fog, environment map, lake/sea water, river, waterfall
src/landmarks/    city skyline, plaza + purple tree, lookout, ruins, beacon,
                  spaceport, glass house
src/characters/   humanoid generator, player, camera rig, NPCs, portraits,
                  'explore' + 'customize' modes, customization screen
src/vehicles/     car, VTOL, ship (atmospheric), colony ship, 'drive' mode, garage
src/build/        build mode, catalog, pieces, hologram, harvest nodes, resources HUD
src/space/        'space' mode: ship flight, asteroids, planet, station, combat, space HUD
src/systems/      quests, dialogue/story, chat + NPC AI, economy/market, world events, journal
src/audio/        procedural sound recipes + music director (registers on ctx.audio)
src/shell/        'title' mode + title screen, pause/settings/help/map, minimap,
                  screen markers, key hints, FPS/debug overlay
```

**Rules for module authors**

1. Only create/edit files inside your own directory. Never edit `src/core/*`,
   `src/game.js`, `src/fallback/*`, `src/world/index.js`, `src/world/layout.js`,
   `src/ui/*` or another module (add icons with `registerIcons` from
   `src/ui/icons.js` at install time). If you need a
   core change, work around it locally and write the request in
   `notes/<module>-requests.md`.
2. Your `index.js` exports `install(ctx, { progress })` (may be async) and
   returns your public API (stored as `ctx.<module>`). If install throws, the
   game falls back to `src/fallback/<module>.js` — so always test your module
   actually installs (check `__game.debug.info().errors` is empty).
3. CSS: create `src/<module>/<module>.css` and import it from your JS. Prefix
   every class with your module (`.build-…`, `.space-…`, `.sys-…`, `.shell-…`,
   `.chr-…`, `.veh-…`). Use the tokens from `base.css`.
4. Never allocate in per-frame hot paths (reuse Vector3s). Dispose what you
   replace. Use `InstancedMesh`/merged geometry for repeated things.
5. Other modules may be missing or still in development: **always null-check
   optional cross-module APIs** (`ctx.landmarks?.plaza?.tree`,
   `ctx.quests?.start?.('x')`). Prefer events for cross-module communication.
6. three r186 notes: `THREE.Clock` is deprecated → `THREE.Timer`;
   `PCFSoftShadowMap` was removed → `PCFShadowMap` (+ `shadow.radius`);
   `Source` → `TextureSource`; addons import from `three/addons/...`;
   colour management is on (`renderer.outputColorSpace = SRGB`), so set
   `texture.colorSpace = THREE.SRGBColorSpace` on colour textures.
   Tone mapping (ACES) + sRGB happen in the final OutputPass; bloom threshold
   is 0.86 (HDR) — make emissive things glow by using emissiveIntensity > 1.

---------------------------------------------------------------------------
## 3. Core API (`ctx`, also `window.__game`)

| key | what |
|---|---|
| `ctx.engine` | `renderer`, `composer`, `bloom` (UnrealBloomPass), `grade` (colour grade ShaderPass: `uniforms.uVignette/uSaturation/uContrast/uShadowTint/uHighlightTint/uGrain/uExposure`), `quality` (preset object: `id, pixelRatio, shadows, shadowMapSize, bloom, msaa, grassDensity, treeDensity, drawDistance, particles`), `setQuality(id)`, `setView(scene, camera)`, `snapshot(scene, camera, w, h) → canvas` (renders through the full post chain; use it for thumbnails/portraits) |
| `ctx.camera` | the shared world `PerspectiveCamera` (fov 55, near 0.15, far 6000) used by title/explore/drive |
| `ctx.loop` | `add(name, fn(dt, t), {order, when, pausable})`, `remove(name)`, `paused`, `time`, `fps`, `step(dt)` |
| `ctx.input` | `down/pressed/released(code)`, `action/actionPressed/actionReleased(name)`, `axis(neg, pos)`, `moveVector() → {x, y}`, `lookX/lookY` (per-frame mouse-look delta, already × sensitivity), `wheel`, `mouse` ({x, y, ndcX, ndcY}), `gameEnabled`, `block(reason, on)`, `wantsPointerLock`, `locked`, `requestPointerLock()`, `rawDown/rawPressed` (ignore blockers). Codes are `KeyboardEvent.code`; mouse buttons on the canvas are `Mouse0/1/2`. Action names: see `ACTIONS` in `src/core/input.js` |
| `ctx.events` | `on(name, fn) → off`, `once`, `off`, `emit(name, payload)` |
| `ctx.state` | `get(path)`, `set(path, v)`, `add(path, n)`, `update(path, fn)`, `ensure(path, default)`, `subscribe(prefix, fn)`, `canAfford(cost)`, `spend(cost)`, `gain(amounts)`, `save()`, `data` |
| `ctx.physics` | terrain height fn + oriented boxes: `addBox({x,y,z,w,h,d,rotY,solid,walkable,tag,owner}) → id`, `addFromObject(mesh, opts)`, `moveBox`, `remove(id)`, `clear(tag)`, `groundHeight(x, z, feetY, stepUp, radius)`, `resolveCylinder(pos, radius, height, stepUp)`, `segmentHit(a, b) → t` |
| `ctx.interactions` | `add({id, scope, position, radius, label, key, hold, priority, enabled, onInteract}) → id`, `remove(id)`; controllers set `origin`, `scope`, `active = true` each frame |
| `ctx.markers` | `set(id, {position, label, kind, color, icon, scope, screen, compass})`, `remove(id)`, `list(scope)` |
| `ctx.modes` | `register(name, mode)`, `go(name, params, {fade})`, `is(...names)`, `name`, `previous`, `transitioning` |
| `ctx.ui` | `h(tag, attrs, ...children)`, `addWidget(slot, el, {modes, order})`, `removeWidget`, `setVisible(el, bool)`, `toast({title, text, icon, kind, duration})`, `prompt.show(channel, {key, text, hold, progress, anchor})` / `prompt.hide(channel)` (with `anchor` = world Vector3 the prompt floats next to that point, like "[E] Praten" beside Aria; interactions do this automatically — option `anchor` on `interactions.add`), `fade(toBlack, ms)`, `openModal(id, el, {onClose, closeOnEsc, closeOnBackdrop, className})`, `closeModal(id)`, `isModalOpen(id?)`, `showScreen(id, el)`, `hideScreen(id)`, `pushEscape(fn) → pop`, `icon(name, size)`, `layers` |
| `ctx.audio` | `play(name, {volume, position, pitch})`, `loop(name, opts) → {set(params), stop(fade)}`, `register(name, recipe, {loop, bus})`, `setVolumes({master, music, sfx})`, `setListener(camera)` |
| `ctx.i18n` | `t({en, nl}, vars)` → text in the active language (`{placeholders}`; plain strings pass through), `pick({en, nl})` → raw variant (arrays/objects), `lang()` → `'en'`/`'nl'`, `locale()`, `setLanguage(id, state)` (saves + reloads), `LANGUAGES`. Also importable: `import { t, pick } from '../core/i18n.js'`. English is the default; `en` is required in every text, `nl` expected. Resolve text when you build UI (the language never changes without a reload). `formatNumber`/`formatDistance` in core/math follow the language |
| `ctx.params` | parsed URL query |
| `ctx.debug` | `teleport(zone \| {x,z}, heading)`, `go(mode, params)`, `setTime(h)`, `simulate(...)`, `frames(n)`, `info()` |

**Loop order convention** (`order` option of `loop.add`):
0–9 time/clock · 10–19 world simulation (sky, water, vegetation, city lights) ·
20 `modes` (the active mode's update: player/vehicle/ship control + camera) ·
30–39 NPCs, vehicles idle, build ghost, space entities · 40–49 interactions
(core, 45), quests, dialogue, chat, events · 50–59 audio · 90–99 HUD/UI (needs
final camera matrices).

---------------------------------------------------------------------------
## 4. World layout & conventions

See `src/world/layout.js` (`WORLD`, `ZONES`, `LAKE`, `ROADS`, `TRAVEL`).
Metres; +X east, −Z north, +Y up; water level y = 0; terrain spans ±1200 m,
playable inside ±1050 m.

**Heading convention:** an object with `rotation.y = h` faces
`(−sin h, 0, −cos h)`; heading 0 faces north (−Z). Build every model with its
front pointing to −Z in local space. A third-person camera "behind" heading h
sits at `+ (sin h, ·, cos h) × distance`.

Zones (x, z → intended pad elevation): spawn (0, 150 → 46, faces the lake + city
in the north), lookout (−280, 30 → 92), ruins (250, 95 → 28), signal (−120, −140
→ 4, lake shore), waterfall (−330, −205 → 40), base (−230, 330 → 22, forest
clearing, glass house + 48 m build plot), plaza (360, −150 → 5, purple tree),
spaceport (rect x 380–565, z 175–330 → 14; pads for ship/vtol/car/colony ship),
city (60, −820, radius 430, across the lake, mostly on islands/far shore).
Always place things with `ctx.world.getHeightAt(x, z)`.

More layout data in `layout.js`: `REGIONS` (jungle "Lumen-jungle" on the west
plateau, canyon "Zonnekloof" in the east), `RACE_TRACK` (closed loop through
the canyon), `ISLANDS` (wooded islands in the lake), `CITY_ISLANDS` (flat land
for the spire city), `RIVERS` (west river → main waterfall), `WATERFALLS` (5
cliff falls into the lake), `FLOATING_ISLANDS` (rock islands hovering 140–330 m
up; `fall: true` → a thin waterfall pours from it), plaza `stage` / `bazaar` /
`oran`, spaceport `hangar`, base `landingPad`.

---------------------------------------------------------------------------
## 5. Module contracts

### world → `ctx.world` (terrain half + atmosphere half, see src/world/index.js)
Terrain half (`installTerrain(ctx, world, {progress})` in `src/world/terrain/index.js`)
sets `getHeightAt`, `getNormalAt`, `isWater`, `raycast`, `terrainMesh`,
`heightTexture` (DataTexture, R = metres, covering ±1200 m; used by water for
depth tint/foam), `minimap`. Atmosphere half (`installAtmosphere(ctx, world,
{progress})` in `src/world/atmosphere/index.js`) sets `sun`, `hemi`,
`timeOfDay`, `setTimeOfDay`, `sunDirection`, `dayFactor` and adds sky, fog,
water. Full surface: `scene` (THREE.Scene for the whole open world — everyone adds their objects
here), `sun` (shadow-casting DirectionalLight that follows the camera),
`hemi`, `getHeightAt(x, z)`, `getNormalAt(x, z, target?)`, `isWater(x, z)`,
`waterLevel` (0), `raycast(origin, dir, maxDist) → {point, normal, distance} | null`
(terrain only, fast height-field march), `timeOfDay` (hours), `setTimeOfDay(h)`,
`sunDirection` (unit vector toward the sun), `dayFactor` (0 night … 1 day),
`minimap` (`{ canvas, worldToMap(x, z) → [u, v] }` top-down colour map 512²),
`terrainMesh`. Calls `ctx.physics.setTerrain(getHeightAt)`. Updates itself
(loop order 10) while the world is visible (modes title/explore/drive). Emits
`world:time`. Owns `state.world.time` (time flows when `settings.timeFlow`).

### landmarks → `ctx.landmarks`
`objects` {city, plaza, lookout, ruins, beacon, spaceport, house} (Groups) and
helper data: `plaza` {center, tree, walkPoints: Vector3[], benches: [{position,
rotY}], spawnPoints}, `ruins` {scanPoints: Vector3[], setScanned(bool)},
`beacon` {position, setActive(bool)}, `lookout` {top: Vector3}, `spaceport`
{pads}. Registers physics boxes for every building/wall/platform and POI markers
(kind `poi`). Emissive windows/lights react to `ctx.world.dayFactor`.

### characters → `ctx.player`, `ctx.cameraRig`, `ctx.npcs`, `ctx.portraits`
* `player`: `object`, `position`, `velocity`, `heading`, `state`
  ('idle'|'walk'|'run'|'jump'|'fall'|'swim'|'drive'), `onFoot`,
  `controlsEnabled`, `appearance`, `setAppearance(app)`, `setVisible(bool)`,
  `teleport(zoneId | {x, z} | Vector3, heading?)`.
* `cameraRig`: `camera` (=== ctx.camera), `yaw`, `pitch`, `distance`,
  `follow(object, {distance, height, minDistance, maxDistance, shoulder})`,
  `update(dt)`, `shake(amount)`, `zoomEnabled`, `lookEnabled`.
* `npcs`: `list`, `get(id)` → NPC {id, name, object, position, appearance,
  say(text, seconds), setGoal(vec3), follow(object | null), lookAt(vec3)};
  `party` (Set of ids following the player). Named NPCs: `luna` ("Luna_Ø"),
  `kai` ("Kai"), `nova` ("Nova") at the plaza, `aria` ("Aria") at the signal,
  plus ~16 citizens at the plaza. Name tags + speech bubbles above heads.
  Pressing E near a named NPC emits `npc:interact` {id}.
* `portraits.render(appearance | npcId, {width, height, framing: 'face'|'bust'|'full'}) → canvas`.
* Modes `explore` (on foot: params `zone`, `position` {x, z, heading}, `resume`)
  and `customize` (params `returnTo`, `returnParams`), plus the customization
  screen (poster "Karakter customisatie"). Owns `state.profile`, `state.player`.

Appearance object (`DEFAULT_APPEARANCE` in core/state.js):
`{ body: 'm'|'f', skin, hair, hairColor, face (0–5), beard: 'none'|'stubble'|'full',
outfit, outfitColor, accentColor, glasses }`.
Outfits (see `generated/17_character_creator.png`): `pathfinder` (default —
dark techwear jacket + backpack with a big white Ø, Ø shoulder patch), `scout`
(light grey/white utility suit), `ranger` (brown field jacket), `nomad`
(olive-brown hooded poncho/cloak, unlock `outfit-nomad`), `vanguard` (dark
armoured suit with cyan seams, unlock `outfit-vanguard`), `drifter` (long dark
coat, unlock `outfit-drifter`). Outfit colours ("Kleuren"): `#15171b #5d6066
#d8cdb8 #4f5634 #7a5238 #1f2a44 #4a2f73 #7a2a2a`. Skin swatches: `#f2c9a8
#d9a47c #c68e67 #9c6b4b #6e4630 #8d9098 #9db59a`. Gear ("Uitrusting"):
backpack style, visor/glasses, gloves, shoulder patch.

### vehicles → `ctx.vehicles`
`catalog` [{type: 'car'|'vtol'|'ship'|'colony', name, desc, icon}], `list`,
`current`, `summon(type)`, `summonAndEnter(type)`, `enter(vehicle)`, `exit()`.
Registers mode `drive` (params `{vehicle}`; enter/exit with `{fade: false}`;
leaving returns to `explore` with `{position}`), the garage modal (G), the
parked colony ship + ship/VTOL/car at the spaceport pads. Ship above ~600 m or
`L` at the spaceport → `ctx.modes.go('space', {from: 'planet'})`. When `explore`
is entered with `{arrival: 'ship'}` it puts the ship back on its pad. Emits
`vehicle:enter/exit/summon/launch`. Skins: `skin-car-sunset`,
`skin-car-aurora`, `skin-ship-gold`.

### build → `ctx.build`
`active`, `enter()`, `exit()`, `toggle()` (key B in explore), `catalog`
(categories STRUCTURE/WALL/FLOOR/ROOF/DECOR/POWER, pieces with `cost`),
`select(categoryId, pieceId)`. 4 m grid, hologram ghost (cyan valid / red
invalid), R rotate, wheel/Tab cycle, click place, X or right-click remove,
1–6 categories. Persists `state.structures`, spends resources
(`state.spend`, free when `settings.creative`). Harvestable resource nodes
in the world (E/hold) → `harvest` events. Power pieces add energy over time.
HUD: build bar (bottom-center), resources panel (top-right, poster
"Resources" with Metaal/Steen/Hout/Energie), crosshair while building. Unlocks:
`decor-statue`, `decor-neon-tree`, `power-fusion`. Emits `build:*`.

### space → `ctx.space`
Mode `space` (own scene + camera; params `{from}`; `stage` URL hook).
Ship flight, asteroid field, planet, sun, space station, convoy, pirate
drones, lasers, shield, boost, anomaly scan, docking, return to planet
(`ctx.modes.go('explore', {zone: 'spaceport', arrival: 'ship'})`). HUD per the
poster: radar (top-right), speed "520 m/s" + bar (bottom-left), systems
Laser Cannons / Shield / Boost (bottom-right), crosshair, target markers.
Emits `space:scan` {target: 'anomaly'}, `space:convoy` {status}, `space:dock`,
`space:kill`, `space:damage`.

### systems → `ctx.quests`, `ctx.dialogue`, `ctx.chat`, `ctx.economy`, `ctx.worldEvents`
* `quests`: `start(id)`, `active`, `get(id)`, `list()`, `complete(id)`;
  quest tracker widget (top-left, poster style: icon + title + objectives with
  cyan circle checks), quest markers via `ctx.markers`, journal modal (J).
  Quests: `horizon` "Verken de Horizon" (Bereik de uitkijkpost · Scan de oude
  ruïnes · Ontdek het signaal), `home` "Een thuis bouwen", `community`
  "Ontmoet de gemeenschap", `asteroid` "Asteroid Field" (Scan de anomalie ·
  Verdedig het konvooi · Bereik het ruimtestation) and more.
* `dialogue`: `open(npcId, nodeId?)`, `close()`, `isOpen`; the poster's
  "Maak je eigen verhaal" panel (portrait + speaker + text + numbered choices,
  keys 1–3). Aria's tree starts with "Deze plek heeft een geschiedenis die
  verder gaat dan wat we denken. Wat wil je doen?" → 1 Vertel me meer over deze
  locatie. 2 Laten we samenwerken. 3 Ik ga eerst verder verkennen.
* `chat`: `post(from, text, {color})`, `send(text)`; chat widget
  (bottom-left, above the minimap; Enter/T to type) with NPC replies.
* `economy`: marketplace modal (K or the plaza terminal): buy/sell; item ids
  in this document; `state.owned.items`.
* `worldEvents`: dynamic events (e.g. meteor shower) with banner + rewards.
Ruins scanning (hold E) and the signal discovery live here.

### audio (`src/audio`) → `ctx.sound`
Registers recipes on `ctx.audio`: `ui.click`, `ui.hover`, `ui.open`,
`ui.close`, `ui.error`, `quest.update`, `quest.complete`, `reward`, `toast`,
`build.place`, `build.remove`, `build.invalid`, `harvest`, `scan` (loop),
`footstep`, `jump`, `land`, `car.engine` (loop, `set({rpm, load})`),
`vtol.engine` (loop, `set({thrust})`), `ship.engine` (loop, `set({thrust,
boost})`), `laser`, `explosion`, `shield.hit`, `boost`, `dock`, `warp`,
`chat`, `dialogue.open`, `ambient.wind`/`ambient.water`/`ambient.city`/
`ambient.space` (loops), `music.title`/`music.explore`/`music.space` (loops).
Music/ambience director switches by mode/zone; UI click/hover sounds for
`.btn`/`.card.interactive` via event delegation.

### shell → `ctx.shell`
Mode `title` (cinematic camera at the spawn ridge behind the player, poster
hero layout: logo, "EXPLORE · CREATE · CONNECT", tagline, "A BRIGHTER
TOMORROW.", the 4 pillars panel, the 4 gameplay-overview cards with rendered
thumbnails, buttons Speel / Karakter / Instellingen). Pause menu on
`ui:escape`/`input:lockLost` (resume, settings incl. quality/volume/
sensitivity/invert/time flow/creative mode, controls help, "Kern gameplay
elementen", back to title, reset), map modal (M) with fast travel, minimap +
compass (bottom-left), on-screen quest/POI markers with distance, key hints
(bottom-right), FPS/debug overlay. Owns `state.settings`.

---------------------------------------------------------------------------
## 6. Event catalog

core: `game:installed`, `game:ready`, `game:start`, `mode:change` {from, to,
params}, `quality:change`, `resize`, `state:change` {path, value, prev},
`state:reset`, `input:key` {code}, `input:pointerlock` {locked},
`input:lockLost`, `ui:escape`, `ui:modal` {id, open}, `ui:toast`, `interact`
{id}, `markers:change`, `audio:ready`.
world: `world:time` {hour, dayFactor}.
characters: `player:zone` {zone, prev}, `player:jump`, `player:land` {speed},
`player:footstep` {surface}, `npc:interact` {id}, `npc:say` {id, text},
`customize:done` {appearance}.
vehicles: `vehicle:enter` / `vehicle:exit` / `vehicle:summon` {type, id},
`vehicle:launch` {type}.
build: `build:mode` {active}, `build:select` {category, piece},
`build:placed` {piece, category, id, position}, `build:removed`,
`build:invalid` {reason}, `harvest` {resource, amount}, `power:change`
{production, consumption}.
space: `space:scan` {target}, `space:convoy` {status}, `space:dock`
{station}, `space:kill` {enemy}, `space:damage` {shield, hull}.
systems: `scan:complete` {target}, `quest:start` {id}, `quest:progress` {id,
objective, done}, `quest:complete` {id, rewards}, `dialogue:open` {id, npc},
`dialogue:choice` {id, node, choice}, `dialogue:close` {id}, `chat:message`
{from, text, color, self}, `chat:sent` {text}, `market:buy` {item},
`market:sell` {item}, `event:start` {id, name}, `event:end` {id}.
shell: `title:start`, `pause` {open}.

## 7. State (`ctx.state`, saved in localStorage)

`progress` {xp, level, discovered} (systems) · `profile` (characters) · `credits`, `resources` {metal, stone, wood, energy}
(shared; use `spend/gain`) · `player` {zone, position, heading, vehicle}
(characters/vehicles) · `world.time` (world) · `quests` (systems) ·
`structures` (build) · `owned` {vehicles, items, skins} (systems/vehicles) ·
`flags` (systems) · `stats` (everyone may `add`) · `settings` (shell). Modules
may add their own top-level key with `state.ensure('space', {...})`.

Market item ids: `outfit-nomad`, `outfit-vanguard`, `outfit-drifter`,
`decor-statue`, `decor-neon-tree`, `power-fusion`, `skin-car-sunset`,
`skin-car-aurora`, `skin-ship-gold` (+ consumables `res-metal-100`,
`res-energy-50`).

---------------------------------------------------------------------------
## 8. UI layout (HUD slots — use exactly these)

| slot | widgets (owner, order) |
|---|---|
| top-left | quest tracker (systems 10) |
| top-center | compass strip (shell 10), world-event banner (systems 20) |
| top-right | resources panel (build 10), radar (space 10) |
| right | party list (systems 10) |
| bottom-left | minimap (shell 10) / space speed (space 10); chat (systems 20) stacks above |
| bottom-center | build bar (build 10), vehicle HUD (vehicles 10) |
| bottom-right | key hints (shell 10), space systems (space 10), vehicle hints (vehicles 10) |
| center | crosshairs (build / space) |

Interaction prompts are rendered by core (`ui.prompt`) above the bottom-center
slot. Give every widget a `modes` list. Style per the poster: dark glass panels
(`.panel`), 12 px radius, thin warm-white text, caps titles with wide tracking,
cyan for interactive/quest state, gold for rewards, violet for social.
Modals (pause, journal, market, garage, map, dialogue) use `ui.openModal`.

## 9. Controls (labels in help screens: English, Dutch in brackets)

On foot: WASD/pijltjes lopen · Shift sprinten · Spatie springen · muis
rondkijken (klik om de muis te vangen, Esc om los te laten) · scroll zoom ·
E interactie (houd vast voor scannen/oogsten) · F voertuig in/uit · G garage ·
B bouwmodus · Enter/T chat · J missies · M kaart · C karakter · K marktplaats ·
H help · Esc/P pauze.
Build: 1–6 categorie · scroll/Tab onderdeel · R draaien · klik plaatsen ·
X/rechtermuis verwijderen · B/Esc stoppen.
Car: W/S gas/rem · A/D sturen · Spatie handrem · Shift boost · F uitstappen.
VTOL & ship (atmosphere): W/S vooruit/achteruit · A/D zijwaarts · muis richting
· Spatie stijgen · C dalen · Shift boost · L lanceren naar de ruimte (schip).
Space: muis sturen · W/S stuwkracht · A/D of Q/E rollen · Shift boost ·
klik/Spatie vuren · E scannen/aanmeren · L landen.

## 10. Art direction

Golden-hour sunset by default (time 17.6): low warm sun (orange-gold) setting
behind the spire city in the north/north-east, cool blue → violet sky upward
with faint stars near the zenith, a **giant pale cratered planet** high in the
northern sky plus two small moons, warm haze near the horizon, mirror-like lake
reflecting sun + city. Rocky dark ridges, warm-lit grass, pines + broadleaf
trees, boulders, a waterfall. City: slender needle spires 150–300 m on islands
and the far shore, backlit silhouettes with warm/cyan window lights and bridges.
Plaza: paved circle, giant bioluminescent violet tree, navy banners with a
white Ø on tall pillars, warm shop lights, people. Base: modern two-storey
glass house (dark frames, warm interior light) among pines. Space: deep
blue-black, nebula, huge planet with atmospheric rim, blinding sun + bloom,
dense dark asteroid field with rim light, station (sphere + rings + arms),
sleek dark ships with orange engine glow and blue thruster trails. Characters:
dark tech-wear jackets with the Ø emblem on the back.

Performance budget (world, `high`): < 700 draw calls, < 3 M triangles,
one 4096² shadow map that follows the player (~160 m), instancing for
vegetation/rocks/asteroids/crowd, no per-frame allocations.

---------------------------------------------------------------------------
## 11. Extra concept art (`generated/`) — study the ones for your module

The user generated extra gameplay concepts in the poster's style. They are the
visual target together with the poster (prompts in `generated/_prompts/*.txt`):

| file | shows | modules |
|---|---|---|
| `01_neon_city.png` | city "Nachtmarkt" at night: wet reflective pavement, purple trees, holographic Ø billboards, a large ring sculpture, lantern stalls | landmarks, atmosphere, systems |
| `02_space_station.png` | docking at the huge ring "Station Halo" above a blue planet; HUD 120 m/s (bottom-left), "AANMEREN" docking reticle (centre), Schilden / Romp / Boost bars (bottom-right), quest "Aanmeren bij Station Halo" | space |
| `03_building_city.png` | build mode: cyan holographic tower blueprint with a projected grid on the ground; other builders with tablets; build bar Structuur/Muur/Vloer/Dak/Decor/Energie; resources top-right; hints "Plaatsen / R Draaien / ESC Annuleren" | build, characters |
| `04_alien_jungle.png` | (later wave) "Lumen-jungle": bioluminescent purple/turquoise giant plants, floating rocks with waterfalls, ringed planet; scan bracket "Nieuwe soort ontdekt" | terrain, atmosphere |
| `05_hoverbike_race.png` | (later wave) hoverbike race in a red canyon above the lake; POSITIE 2/8, RONDE 2/3, SNELHEID 286 km/u | terrain, vehicles |
| `06_social_hub.png` | plaza with the purple tree during "Live Event: Starfall Festival": holographic stage with band + floating planet holograms, Ø banners, crowd with name tags (Luna, Nova, Kai, Yara, Milan), chat bottom-left, objectives top-right, "[E] Interactie" | landmarks, characters, systems, audio |
| `07_space_battle.png` | squadron defends a colony ship against pirates in a purple/orange nebula with asteroids; radar top-right (N/O/Z/W), target bracket "Piraat", Schild 100% / Lasers 78% / Raketten 3/12 | space |
| `08_npc_dialogue.png` | merchant "Oran" in a lantern-lit bazaar; dialogue panel bottom-centre: name, line "Ik heb geruchten gehoord over een verloren schip in de Noordelijke Ringen…", 3 numbered choices; compass strip top-left with distance | landmarks, characters, systems |
| `09_key_art_poster.png` | key art: hero on a cliff, city with the purple tree, giant planet, ships flying, waterfalls into a misty lake | shell (title), atmosphere, landmarks |
| `10_signal_aria.png` | the signal: tall dark crystal obelisk with a glowing blue Ø + vertical light line, glowing rings on the wet shore, Aria (ponytail, dark techwear) waiting; "[E] Praten" floating beside her; quest "Het signaal — Spreek met Aria" | landmarks, characters, systems |
| `11_ancient_ruins.png` | overgrown giant broken pillars/arches, vines, engraved Ø glowing cyan, god rays + dust; scan bracket "Onbekende inscriptie — 64% gescand" | landmarks, systems, atmosphere |
| `12_lookout_waterfall.png` | top of a rusty metal/wood lookout tower: view over the lake with islands, big waterfalls, mist, sailboats, Aurora-stad; "Locatie ontdekt: Uitkijkpost" + "+250 XP" (top-centre), round minimap (N/O/Z/W) | landmarks, atmosphere, terrain, systems, shell |
| `13_player_base.png` | base at dusk: glass house + workshop extension, solar panels, landing pad with VTOL, fire pit, Ø banner, crates, fireflies; "Jouw basis — Niveau 3"; "Grondstoffen" panel | landmarks, build, atmosphere |
| `14_marketplace.png` | holographic market terminal under the purple tree: tabs Kopen / Verkopen / Mijn items, prices in Ø-credits | systems |
| `15_spaceport.png` | spaceport at golden hour: huge hangar with the colony ship, sleek black ship with boarding stairs, tilt-rotor VTOL, sports car, technicians, drones, pad numbers; "[F] Instappen — Ruimteschip"; quest "Eerste vlucht" | landmarks, vehicles, characters, systems |
| `16_vtol_flight.png` | black tilt-rotor VTOL with Ø low over the lake, rotor wash spray, other aircraft; HUD 180 km/u + HOOGTE 24 m (bottom-right), waypoint "Aurora-stad 1,2 km" | vehicles, shell |
| `17_character_creator.png` | full-screen creator: character on a turntable in a dark studio with warm rim light; tabs Gezicht/Haar/Outfit/Uitrusting/Kleuren; variants grid + swatches; Willekeurig / Bevestigen | characters |
| `18_colony_landing.png` | (later wave) colony ship landing on "Kepler-Ø 7" (pink sky, two moons, crystals) | space |
| `19_world_map.png` | dark relief world map with labelled zone icons, legend, "Snel reizen" | shell |

Some files may still be arriving — check `ls generated/` again later.

**Recurring visual motifs (everyone):** giant pale planet with faint thin rings
plus 1–2 small moons; floating rock islands with thin waterfalls; many
waterfalls off cliffs into the lake; wooded islands and low mist on the water;
ships/VTOLs flying in the sky; violet bioluminescent accents; dark techwear
characters with a big white Ø on the backpack and an Ø shoulder patch; wet,
reflective surfaces at dusk; thin elegant HUD (dark glass, cyan accents).

**HUD wording (en / nl):** compass N/E/S/W (nl N/O/Z/W); build bar Structure,
Wall, Floor, Roof, Decor, Power (Structuur, Muur, Vloer, Dak, Decor, Energie);
resources panel "Resources" (Metal, Stone, Wood, Energy) / "Grondstoffen"
(Metaal, Steen, Hout, Energie); vehicle HUD "180 km/h" + "ALTITUDE 24 m"
("180 km/u", "HOOGTE 24 m"); space "120 m/s", Shield, Hull, Lasers, Boost,
Missiles (Schild, Romp, Lasers, Boost, Raketten); notifications "Location
discovered: …" + "+250 XP" ("Locatie ontdekt: …"); prompts "[E] Talk",
"[F] Board — Spaceship" ("[E] Praten", "[F] Instappen — Ruimteschip").

**Later wave (not now unless your brief says so):** Lumen-jungle flora +
species scanning, hoverbike + canyon race, Kepler-Ø 7 colony landing.
