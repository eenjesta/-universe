# Requests from systems (quests, dialogue, chat, economy, events)

Everything below is optional — systems null-checks all of it and falls back
gracefully — but these hooks make the story read much better in-game.

## landmarks
- Thanks for `ruins.relief`, `ruins.center`, `scanPoints`, `runeStones [{stand, center}]`,
  `setScanProgress`, the crisp cyan scan reveal and the dormant beacon look — all used.
  The relief is scanned at range: hold [E] 3 s anywhere ~1–19 m in front of it while
  looking at it (interaction spot 7 m along `reliefNormal`, radius 12 m, covers
  `scanPoints[0]`); the bracket frames the relief and a camera assist keeps it right of
  the player. Rune stones: `scanPoints[1…]` (1.6 s optional scans, bracket around
  `runeStones[i].center`).
- **Beacon:** systems keeps the beacon **dormant during play** (`setActive(false)` in
  explore/drive) until the player has found the signal, so reaching it is a real
  moment: `setActive(true)` + a cyan shockwave/light column (systems FX). Outside
  explore/drive (title screen) your default (active) is restored. After discovery it
  stays active; the "Signaal-echo" event wakes it too.
- Plaza: `plaza.setShow(true/false)` on Starfall start/end; `plaza.market` hosts
  "[E] Marketplace openen" (radius 4 m); `bazaar.oran` / `bazaar.oranCounter` place
  Oran's talk point when the characters module has no `oran` NPC.

## characters
- Thanks for oran / jules / yara / milan. Systems opens dialogues on `npc:interact`
  and uses `say`, `follow`, `setGoal`, `faceHeading`, `talkT`, `home` / `homeHeading`
  (Aria walks back to the beacon after talking unless she joined the party).
- `portraits.render(id, {framing: 'bust', width: 360, height: 450})` once per NPC (cached
  on our side). It is called ~140 ms *after* a dialogue opens (the panel shows a drawn
  stand-in, then cross-fades), never during free play until a first dialogue has compiled
  the portrait studio — after that, chat avatars / party list crops and pre-warming of
  NPCs within 16 m render in the background, one per slot. (The first render takes ~70 s
  under SwiftShader in headless tests, so other modules' tests don't pay for it.)
- Dialogue + scan framing: systems eases `cameraRig.yaw / pitch / _zoom / aimHeight /
  shoulder` and `player.heading` (loop order 19, before modes) for an over-the-shoulder
  shot (player left, NPC right, heads above the dialogue panel). `cameraRig.focus()`
  has no yaw offset / aim height, so systems keeps its own framing (a `yawOffset` +
  `aimHeight` option on `focus` would let us switch).

## space
- Quests listen to `space:scan {target}`, `space:convoy {status}`, `space:dock`,
  `space:kill`. "Verdedig het konvooi" completes on a convoy status matching
  /safe|veilig|defend|complete|success|done|arriv|won|secure/.
- "Het verloren schip" (from Oran) ends with *any* `space:scan` — a derelict
  `space:scan {target: 'wreck'}` ("Zilveren Horizon") in the northern rings would
  make it a proper finale.
- Quest markers in space read `ctx.space.station | anomaly | convoy | wreck`
  (Vector3, Object3D or `{position}`; also under `targets` / `entities` / `objects`)
  and the player ship from `ctx.space.ship.position`.
- The quest tracker is visible in mode `space` (top-left) and shows the tracked
  space quest ("Asteroid Field", "Aanmeren bij Station Halo", …).

## build
- "Een thuis bouwen" matches `build:placed` loosely on `{category, piece}` text:
  wall = /wall|muur/, roof = /roof|dak/, power = /power|energ|solar|fusion|generator/
  (or a `power:change` with production > 0), foundation = /struct|found|fundering|
  floor|vloer|platform/ unless the piece is a wall/roof/power piece. "Verzamelaar"
  counts `harvest` events.
- Market blueprints (`decor-statue`, `decor-neon-tree`, `power-fusion`) are added to
  `state.owned.items` on purchase.

## vehicles
- "Eerste vlucht": `vehicle:launch {type: 'ship'}` or entering mode `space`, or the
  ship > 140 m above ground / far outside the spaceport. "Hoog boven": reads
  `ctx.vehicles.current` (type /vtol/, `object.position.y > 300`).
- Skins bought in the market land in `state.owned.items` + `state.owned.skins`.

## audio
- Used: `quest.update`, `quest.complete`, `reward`, `toast`, `chat`, `dialogue.open`,
  `ui.open/close/click/hover/error`, `harvest`, `explosion` (meteor impacts, with
  position), `warp` (signal activation) and the `scan` loop (receives
  `set({progress})` while scanning).
- Music director: `event:start {id: 'starfall'}` / `event:end` is the cue for
  festival music on the plaza.

## shell
- Done: the quest marker `sys-quest` has `tracked: true` (kind `quest`, icon
  `sys-diamond`, position is a function).
- `ctx.progress.levelInfo()` → `{level, xp, from, to, t}` for a level badge;
  `ctx.systems.journal.open(tab)` opens the journal (tabs active/done/lore/events).
- Meteor fragments add `sys-frag-*` markers (kind `poi`), the marketplace terminal
  `sys-market` (compass only).

## core / tools
- Same as characters: `tools/shot.mjs` would benefit from a configurable
  `page.screenshot` timeout (high-quality shots time out at 30 s under load).

## shell (07:55)
- On-screen markers clamped to the left screen edge (e.g. "Uitkijkpost 247 m" when the
  lookout is behind-left) are drawn over the quest tracker (top-left slot, ~22–150 px)
  — see shots/systems/42_dialogue_aria_low.png. Clamping edge markers below the top-left
  slot (or hiding edge markers while a modal such as the dialogue is open) would fix it.

## landmarks (08:05)
- Oran's stall lanterns hang at head height (`ly = 1.75–2.45 m`, size up to 1.6 → bodies
  down to ~1.45 m) right between the street and Oran, so in the dialogue shot
  (shots/systems/28_dialogue_oran.png) a lantern fills the frame and hides him. Hanging
  them at ~2.3–2.8 m (bottoms above 2.1 m) would keep his face clear and look like
  08_npc_dialogue.png (lanterns above the merchant). Systems now uses a lower camera for
  Oran as a workaround.
