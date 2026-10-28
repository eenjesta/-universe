/**
 * Enemy definitions + spawn regions (SMP v1, PLATFORM.md §8). Pure data,
 * bilingual names. The server sim drives the AI; clients render from snapshots
 * (en rows: [id, type, x, y, z, h, s, hp], s = ES state code from protocol.js).
 *
 * Fields: hp, speed (m/s), flying, hover [min, max] m above ground, keep [min, max]
 * preferred engage distance, aggro (detection range), leash (max distance from
 * home), hit (target shape for hit validation: sphere {r, y} or capsule {r, h}),
 * attack {kind, dmg, rate (/s), range, accuracy (drone: chance at point blank)},
 * leap (stalker), loot (table: [min, max] per entry, chance optional).
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
    leash: 110,
    hit: { shape: 'sphere', r: 0.85, y: 0 },
    attack: { kind: 'laser', dmg: 6, rate: 1.2, range: 45, accuracy: 0.85, minAccuracy: 0.2 },
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
    leash: 80,
    hit: { shape: 'capsule', r: 0.7, h: 1.6 },
    attack: { kind: 'claw', dmg: 14, rate: 0.9, range: 2.6 },
    leap: { min: 5, max: 12, speed: 17, cooldown: 4, time: 0.55 },
    loot: { pick: { wood: [4, 10], stone: [4, 10] }, items: { ration: [1, 1, 0.6] } },
    xp: 35,
  },
};

/**
 * Spawning (PLATFORM.md §11): enemies live only OUTSIDE the hub. Where and what
 * spawns comes from the world provider `spawnRules(x, z, hour)` (shared/worldgen,
 * or the stand-in in shared/sim/standin.js using SPAWN_TABLES below), which
 * returns a table `{ biome, density, list: [{ type, w, nightOnly? }] }` or null.
 * Around every player outside the spawn buffer the sim keeps up to
 * `perPlayer × density` enemies within `activeRange` (scaled +50 % per extra
 * player in the group, max ×3); spawns happen `minPlayerDist`–`maxPlayerDist`
 * away from the player, never in safe zones / claims, global cap `maxTotal`.
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
