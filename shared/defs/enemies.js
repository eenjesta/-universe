/**
 * Enemy definitions + spawn rules (SMP, PLATFORM.md §8 / §11). Pure data (+ tiny
 * pure helpers shared by the server sim and the client), bilingual names. The
 * server sim (shared/sim/enemies.js) drives the AI; clients render from snapshots.
 *
 * Snapshot rows: [id, type, x, y, z, h, s, hp, target | null, flags?]
 *   s = ES state code (protocol.js), flags = FLAG bits below (omitted when 0).
 *
 * Fields: hp, speed (m/s), flying, hover [min, max] m above ground, keep [min, max]
 * preferred engage distance, aggro (detection range; night × aggroNight), leash (max
 * distance from home), hit (target shape for hit validation: sphere {r, y}, capsule
 * {r, h, crit} (crit above crit × h), box (barriers) or 'boss' (WARDEN_PARTS)),
 * attack {kind, dmg, rate (/s), range, accuracy (chance at point blank), charge / aim
 * (telegraph seconds before the shot leaves)}, leap / hop (pounce), squad [min, max]
 * (spawned together, fight as a group), retreatAt (hp fraction → falls back),
 * loot (table: [min, max] per entry, chance optional; items only drop when they exist
 * in shared/defs/items.js), xp.
 */

export const ENEMIES = {
  drone: {
    id: 'drone',
    name: { en: 'Security drone', nl: 'Beveiligingsdrone' },
    hp: 60,
    speed: 9,
    flying: true,
    hover: [6, 12],
    keep: [15, 30],
    aggro: 55,
    aggroNight: 1,
    leash: 110,
    hit: { shape: 'sphere', r: 0.85, y: 0 },
    // a 0.55 s red charge-up telegraphs every shot: strafe, dodge [Q] or break line of sight
    attack: { kind: 'laser', dmg: 7, rate: 0.95, range: 45, accuracy: 0.82, minAccuracy: 0.15, charge: 0.55 },
    retreatAt: 0.3,
    loot: { res: { metal: [3, 8], energy: [2, 5] }, ammo: { pulse: [8, 16] } },
    rare: { chance: 0.02, weapon: 'railgun' },
    xp: 25,
  },
  stalker: {
    id: 'stalker',
    name: { en: 'Jungle stalker', nl: 'Junglesluiper' },
    hp: 90,
    speed: 11,
    flying: false,
    aggro: 42,
    aggroNight: 1.3,
    leash: 80,
    hit: { shape: 'capsule', r: 0.7, h: 1.6, crit: 0.72 },
    attack: { kind: 'claw', dmg: 14, rate: 0.9, range: 2.6 },
    // the crouch before the pounce is the tell: dodge [Q] sideways as it springs
    leap: { min: 5, max: 12, speed: 17, cooldown: 4, time: 0.55, windup: 0.32 },
    retreatAt: 0.25,
    pack: 60, // howl reach: the pack joins the hunt
    loot: { pick: { wood: [4, 10], stone: [4, 10] }, items: { ration: [1, 1, 0.6], 'raw-meat': [1, 2, 0.5] } },
    xp: 35,
  },
  raider: {
    id: 'raider',
    name: { en: 'Pirate raider', nl: 'Piratenraider' },
    hp: 110,
    speed: 5.4,
    flying: false,
    keep: [13, 32],
    aggro: 62,
    aggroNight: 0.9,
    leash: 150,
    hit: { shape: 'capsule', r: 0.5, h: 1.95, crit: 0.8 },
    // 3-bolt bursts after a 0.45 s red aim line; one squad member suppresses while the others move
    attack: { kind: 'bolt', dmg: 5, burst: 3, gap: 0.1, rate: 0.6, range: 70, accuracy: 0.55, minAccuracy: 0.1, aim: 0.45 },
    squad: [2, 4],
    cover: true,
    retreatAt: 0.35,
    loot: { res: { metal: [5, 11] }, ammo: { plasma: [12, 30], pulse: [6, 14] }, credits: [10, 30], items: { medkit: [1, 1, 0.15], 'shock-grenade': [1, 1, 0.12], bandage: [1, 2, 0.3], fiber: [2, 5, 0.35] } },
    xp: 45,
  },
  mite: {
    id: 'mite',
    name: { en: 'Crystal mite', nl: 'Kristalmijt' },
    hp: 26,
    speed: 9.5,
    flying: false,
    small: true,
    aggro: 32,
    aggroNight: 1.3,
    leash: 70,
    hit: { shape: 'sphere', r: 0.6, y: 0.45 },
    attack: { kind: 'bite', dmg: 4, rate: 1.4, range: 1.8 },
    hop: { min: 3, max: 7.5, speed: 12, cooldown: 2.2, time: 0.38, windup: 0.16 },
    squad: [4, 7],
    loot: { res: { energy: [1, 3] }, items: { 'crystal-shard': [1, 1, 0.25] } },
    xp: 10,
  },
  warden: {
    id: 'warden',
    name: { en: 'De Wachter', nl: 'De Wachter' },
    boss: true,
    hp: 4200, // + hpPerPlayer for every extra fighter when it wakes (cap maxHpCap)
    hpPerPlayer: 1700,
    maxHpCap: 12000,
    speed: 2.2,
    flying: false,
    aggro: 75,
    leash: 34, // never leaves its arena
    hit: { shape: 'boss' },
    attack: { kind: 'stomp', dmg: 30, rate: 0.2, range: 22 },
    beam: { dmg: 7, tick: 0.12, range: 62, sweep: 2.2, arc: 1.9, windup: 1.0 },
    stomp: { windup: 1.15, speed: 21, radius: 24, band: 1.8, dmg: 30 },
    rune: { hp: 260, mult: 2.4, stagger: 3.2, bonus: 0.06 },
    // + the railgun itself for anyone who doesn't own one yet (shared/sim/enemies.js bossDeath)
    loot: { credits: [380, 560], res: { metal: [90, 140], energy: [60, 90], stone: [30, 60] }, ammo: { rail: [6, 10], plasma: [60, 90] }, items: { medkit: [2, 3], 'shield-cell': [2, 3], 'crystal-shard': [3, 6], 'shield-module': [1, 1, 0.5], 'schem-shield-module-2': [1, 1, 0.5], 'schem-heavy-techwear': [1, 1, 0.45], 'schem-fabricator': [1, 1, 0.35] } },
    xp: 1500,
  },
  barrier: {
    id: 'barrier',
    name: { en: 'Barrier', nl: 'Barrière' },
    prop: true, // no AI, no loot, not a spawn / kill-feed target
    hp: 140,
    hit: { shape: 'box', w: 2.6, h: 1.5, d: 0.35 },
    life: 16,
    xp: 0,
  },
};

/** Snapshot flag bits (row index 9). Boss rows use BOSS_BITS instead. */
export const FLAG = {
  CROUCH: 1, // raider in cover
  AIM: 2, // telegraph: aiming / charging a shot
  RETREAT: 4, // hurt, falling back
  ALERT: 8, // investigating a noise / a fallen friend
  ELITE: 16, // squad leader / garrison captain
  WINDUP: 32, // crouched for a pounce / hop
  SUPPRESS: 64, // laying down suppressive fire
  HUNT: 128, // part of a night hunt tracking a player
};

/** Boss row flags: bits 0–1 phase (0 dormant, 1–3), bit 2 waking, bits 3–5 runes broken, bit 6 staggered. */
export const BOSS_BITS = { PHASE: 3, WAKING: 4, RUNE0: 8, STAGGER: 64 };

/**
 * De Wachter (PLATFORM.md "later phases" → this wave): an ancient guardian mech, ~20 m tall,
 * kneeling dormant at a fixed arena in the Sunfall Badlands east of the hub until players come close.
 * The site is a flat badlands plateau 3.5 km east of the hub, > 400 m from highways and POIs
 * (shared/worldgen, seed 'o-universe' — the badlands hold outposts and crash sites, no Ø ruins).
 */
export const BOSS = {
  type: 'warden',
  id: 'warden',
  name: ENEMIES.warden.name,
  site: { x: 3440, z: 660, h: Math.PI / 2 }, // faces west (−X), toward the hub (heading h faces (−sin h, −cos h))
  siteName: { en: "The Warden's Rest", nl: 'Rustplaats van De Wachter' },
  arena: 70, // m: the fight; players beyond arena + 30 for resetAfter seconds → it resets
  wake: 52, // m: a targetable player this close wakes it
  wakeTime: 3.6, // s of the rise (invulnerable)
  spawnRange: 650, // the boss entity exists while a player is this close to the site
  resetAfter: 22, // s without fighters → back to dormant, full health
  respawn: 20 * 60, // s after it fell
  phases: [1, 0.66, 0.33], // hp fraction at which phase 1 / 2 / 3 begins
  summon: { type: 'drone', n: 3, max: 4, every: 26 },
  cooldowns: { stomp: [5.5, 7.5], beam: [8, 11], summon: [24, 28] },
};

/**
 * Hit volumes of De Wachter in its local frame (metres, front = −Z, feet at y = 0):
 * [x, y, z, r, part] — part 0 = armour, 1..3 = the glowing Ø runes (weak points: chest, left / right shoulder).
 * Shared by the server (hit validation) and the client (raycast), so claims always agree.
 */
export const WARDEN_PARTS = [
  [0, 12.4, 0, 4.3, 0], // torso
  [0, 8.6, 0.2, 3.0, 0], // pelvis
  [0, 17.6, -0.4, 2.3, 0], // head
  [-2.7, 4.4, 0.3, 2.0, 0], // left leg
  [2.7, 4.4, 0.3, 2.0, 0], // right leg
  [-2.6, 1.4, 0.0, 1.6, 0], // left foot
  [2.6, 1.4, 0.0, 1.6, 0], // right foot
  [-6.1, 12.8, 0.2, 2.0, 0], // left upper arm
  [6.1, 12.8, 0.2, 2.0, 0], // right upper arm
  [-6.6, 6.8, -0.8, 2.1, 0], // left fist
  [6.6, 6.8, -0.8, 2.1, 0], // right fist
  [0, 12.9, -4.15, 1.35, 1], // chest rune
  [-5.4, 15.6, -1.9, 1.05, 2], // left shoulder rune
  [5.4, 15.6, -1.9, 1.05, 3], // right shoulder rune
];
/** The eye (beam origin) in the local frame. */
export const WARDEN_EYE = [0, 18.1, -2.3];
/** Kneeling (dormant / staggered) lowers everything by this much. */
export const WARDEN_KNEEL = 5.2;

/**
 * World-space hit parts of the warden at (x, y, z) facing h → flat out [x, y, z, r, part] × n; returns n.
 * `kneel` 0..1 lowers the body (dormant / stagger pose).
 */
export function wardenParts(x, y, z, h, out, kneel = 0) {
  const c = Math.cos(h);
  const s = Math.sin(h);
  let n = 0;
  for (const p of WARDEN_PARTS) {
    // local (lx, lz) rotated by h: forward (−Z) maps to (−sin h, −cos h)
    const lx = p[0];
    const lz = p[2];
    out[n * 5] = x + lx * c + lz * s;
    out[n * 5 + 1] = y + p[1] - kneel * WARDEN_KNEEL * Math.min(1, p[1] / 10);
    out[n * 5 + 2] = z - lx * s + lz * c;
    out[n * 5 + 3] = p[3];
    out[n * 5 + 4] = p[4];
    n++;
  }
  return n;
}

/** Eye position in world space (beam origin). */
export function wardenEye(x, y, z, h, out, kneel = 0) {
  const c = Math.cos(h);
  const s = Math.sin(h);
  out[0] = x + WARDEN_EYE[0] * c + WARDEN_EYE[2] * s;
  out[1] = y + WARDEN_EYE[1] - kneel * WARDEN_KNEEL;
  out[2] = z - WARDEN_EYE[0] * s + WARDEN_EYE[2] * c;
  return out;
}

/** Sweep heading at time t of a beam {a0, a1, dur}: linear from a0 to a1 (shortest way). */
export function beamHeading(a0, a1, dur, t) {
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const k = dur > 0 ? Math.max(0, Math.min(1, t / dur)) : 1;
  return a0 + d * k;
}

/**
 * Spawning (PLATFORM.md §11): enemies live only OUTSIDE the hub. Where and what
 * spawns comes from the world provider `spawnRules(x, z, hour)` (shared/worldgen,
 * or the stand-in in shared/sim/standin.js using SPAWN_TABLES below), which
 * returns a table `{ biome, density, list: [{ type, w, nightOnly? }] }` or null;
 * SPAWN_EXTRA adds this wave's enemies per biome on top. Around every player outside
 * the spawn buffer the sim keeps up to `perPlayer × density` enemies within
 * `activeRange` (scaled +50 % per extra player in the group, max ×3); spawns happen
 * `minPlayerDist`–`maxPlayerDist` away from the player, never in safe zones / claims
 * / near fresh arrivals, global cap `maxTotal`. Squads (raiders, mites) spawn whole.
 */
export const SPAWN = {
  maxTotal: 120, // global enemy cap (perf budget: 50 players + 120 enemies)
  perPlayer: 3, // enemies near one player at density 1
  activeRange: 160, // enemies within this of a player count toward its cap
  groupRange: 120, // players within this count as one group (cap scaling)
  minPlayerDist: 45, // never spawn closer than this to a player
  maxPlayerDist: 150, // spawn ring around the player
  interval: [3, 7], // seconds between spawn attempts per player while below cap
  despawnDist: 300, // despawn when no player within this for despawnAfter seconds
  despawnAfter: 20,
  perPlayerScale: 0.5,
  maxScale: 3,
  nightBelow: 0.25, // dayFactor below this counts as night
  claimMargin: 10, // no spawns within claim radius + margin
};

/**
 * Fairness: a player who just arrived (Gateway, Return to hub, respawn, login, fast travel) gets
 * `arrive` seconds in which no enemy picks them as a target (ends early when they shoot) and
 * `spawnFree` seconds without spawns within `spawnFreeR` metres.
 */
export const GRACE = { arrive: 8, spawnFree: 25, spawnFreeR: 110, dodge: 0.62, dodgeCooldown: 0.9 };

/**
 * Night hunts (tense but fair): at night, every `every` seconds per player out in the wild a group
 * picks up the player's trail `dist` metres away and tracks them — announced first (S.EVENT
 * {kind: 'hunt'}: a howl / radio chatter + HUD warning), then it closes in. Not in claims, not right
 * after arriving, not while already fighting a lot.
 */
export const HUNT = {
  every: [110, 170],
  first: [50, 90], // after nightfall
  dist: [95, 125],
  maxNear: 4, // skip when this many enemies are already near the player
  // biome → [type, n] of the hunting group
  groups: { jungle: ['stalker', 3], forest: ['stalker', 2], meadow: ['stalker', 2], coast: ['raider', 3], badlands: ['raider', 3], highlands: ['mite', 6], peaks: ['mite', 5], mountains: ['drone', 2] },
  fallback: ['drone', 2],
};

/**
 * Stand-in spawn tables per biome (day / night), used until shared/worldgen
 * provides its own: drones in the red badlands (Sunfall Canyon continues east)
 * and the highlands, stalkers in the jungles (Lumen Jungle continues west),
 * forests and meadows get stalkers at night. More (density) at night.
 */
export const SPAWN_TABLES = {
  jungle: { day: { density: 1, list: [{ type: 'stalker', w: 1 }] }, night: { density: 1.6, list: [{ type: 'stalker', w: 1 }] } },
  badlands: { day: { density: 1, list: [{ type: 'drone', w: 1 }] }, night: { density: 2, list: [{ type: 'drone', w: 1 }] } },
  mountains: { day: { density: 0.7, list: [{ type: 'drone', w: 1 }] }, night: { density: 1.4, list: [{ type: 'drone', w: 1 }] } },
  forest: { day: { density: 0.4, list: [{ type: 'drone', w: 1 }] }, night: { density: 1.3, list: [{ type: 'stalker', w: 3, nightOnly: true }, { type: 'drone', w: 1 }] } },
  meadow: { day: { density: 0.35, list: [{ type: 'drone', w: 1 }] }, night: { density: 1, list: [{ type: 'stalker', w: 2, nightOnly: true }, { type: 'drone', w: 1 }] } },
  ocean: null,
  hub: null,
};

/**
 * This wave's enemies per biome, added to whatever the world provider returns:
 * [type, weight, max near one player, nightOnly?]. Pirate raiders roam the Sunfall Badlands and the
 * coasts (their outposts are there), crystal mites swarm the Crystal Highlands and the Frost Peaks.
 */
export const SPAWN_EXTRA = {
  badlands: { day: [['raider', 0.8, 4]], night: [['raider', 1.1, 6]] },
  coast: { day: [['raider', 0.35, 3]], night: [['raider', 0.5, 4]] },
  meadow: { day: [['raider', 0.2, 3]], night: [] },
  highlands: { day: [['mite', 1.1, 7]], night: [['mite', 1.5, 8]] },
  mountains: { day: [['mite', 0.6, 6]], night: [['mite', 0.9, 7]] },
  peaks: { day: [['mite', 0.5, 6]], night: [['mite', 0.9, 7]] },
};

/**
 * POI garrisons (shared/worldgen POIs, when the world provider exposes poisNear): who guards it,
 * how many, and the supply cache dropped at the centre once the garrison is wiped out.
 */
export const GARRISONS = {
  outpost: { type: 'raider', n: [3, 5], elite: 1, wake: 240, respawn: 15 * 60, cache: 'outpost' },
  ruin: { type: 'drone', n: [3, 4], elite: 0, wake: 220, respawn: 12 * 60, cache: 'ruin' },
  wreck: { type: 'mite', n: [5, 7], elite: 0, wake: 200, respawn: 12 * 60, cache: 'wreck' },
};

/** Loot by danger: multipliers on resource / ammo / credit rolls, extra caches. */
export const DANGER = {
  night: 1.3, // kills at night
  garrison: 1.5, // POI guards
  hunt: 1.25, // night-hunt groups
  elite: 1.6, // squad leaders / captains
  summon: 0.3, // the boss's drones
};

/**
 * Supply caches dropped when a POI garrison is wiped out (item ids: shared/defs/items.js — schematics are the
 * rare prize: Vanguard plating at outposts, Shield module Mk II in Ø ruins, the Fabricator core at crash sites).
 */
export const CACHES = {
  outpost: { credits: [60, 120], res: { metal: [20, 40], energy: [10, 20] }, ammo: { plasma: [40, 80], pulse: [30, 60] }, items: { medkit: [1, 2], 'shock-grenade': [1, 2, 0.6], bandage: [1, 3], fiber: [5, 12, 0.7], 'schem-heavy-techwear': [1, 1, 0.35] } },
  ruin: { credits: [40, 90], res: { energy: [20, 40], stone: [20, 40] }, ammo: { rail: [2, 4, 0.5] }, items: { 'shield-cell': [1, 2], 'crystal-shard': [1, 3], 'schem-shield-module-2': [1, 1, 0.3] } },
  wreck: { credits: [30, 70], res: { metal: [30, 50] }, ammo: { pulse: [20, 40] }, items: { medkit: [1, 1], 'shield-cell': [1, 2], 'schem-fabricator': [1, 1, 0.3] } },
};

/**
 * Rare extras by danger (chance per kill, rolled on top of the enemy's table; ids from shared/defs/items.js):
 * night kills, captains (elite) and night-hunt groups can carry gear and schematics.
 */
export const RARE = {
  night: { 'shield-module': 0.012, 'shield-cell': 0.08 },
  elite: { 'schem-heavy-techwear': 0.05, 'shield-cell': 0.25, 'shock-grenade': 0.3 },
  hunt: { 'shield-module': 0.03, medkit: 0.2 },
};
