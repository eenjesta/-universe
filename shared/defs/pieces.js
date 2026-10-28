/**
 * Build pieces — SMP-relevant data mirrored from src/build/catalog.js (ids,
 * snap types, footprints, costs, unlocks) + the survival pieces. The server
 * validates C.BUILD_PLACE with this (cost, unlock, occupancy slots, limits).
 * Pure data; names bilingual.
 *
 * Grid: 4 m cells aligned to ZONES.base.buildArea (ORIGIN_X/Z), storeys 3.2 m.
 */
export const CELL = 4;
export const LEVEL_H = 3.2;
export const MAX_LEVEL = 6;
export const REACH = 24; // max horizontal player → piece distance (+ tolerance on the server)
export const CLAIM_RADIUS = 24;
export const MAX_STRUCTURES_PER_PLAYER = 400;
/** Build-plot origin (ZONES.base.buildArea {x: -205, z: 318, size: 48}). */
export const ORIGIN_X = -205 - 48 / 2;
export const ORIGIN_Z = 318 - 48 / 2;

const P = (category, id, name, cost, snap, extra = {}) => ({ category, id, name, cost, snap, ...extra });

export const PIECES = [
  // STRUCTURE
  P('structure', 'foundation', { en: 'Foundation', nl: 'Fundering' }, { stone: 24, metal: 4 }, 'deck'),
  P('structure', 'cube-module', { en: 'Cube Module', nl: 'Kubusmodule' }, { metal: 40, stone: 20, wood: 10 }, 'room', { size: [1, 1], storeys: 1 }),
  P('structure', 'stairs', { en: 'Stairs', nl: 'Trap' }, { wood: 16, metal: 4 }, 'room', { size: [1, 1], storeys: 1 }),
  P('structure', 'pillar', { en: 'Pillar', nl: 'Pilaar' }, { stone: 6, metal: 2 }, 'corner'),
  P('structure', 'tower', { en: 'Tower', nl: 'Toren' }, { metal: 90, stone: 60, energy: 20 }, 'room', { size: [2, 2], storeys: 4 }),
  P('structure', 'landing-pad', { en: 'Landing Pad', nl: 'Landingsplatform' }, { metal: 50, stone: 40 }, 'room', { size: [2, 2], storeys: 1, groundOnly: true }),
  P('structure', 'workshop', { en: 'Workshop', nl: 'Werkplaats' }, { metal: 45, wood: 30, stone: 20 }, 'room', { size: [2, 1], storeys: 1 }),
  // WALL
  P('wall', 'wall', { en: 'Wall', nl: 'Muur' }, { stone: 10, wood: 4 }, 'edge'),
  P('wall', 'glass-wall', { en: 'Glass Wall', nl: 'Glaswand' }, { metal: 6, stone: 8 }, 'edge'),
  P('wall', 'window-wall', { en: 'Window Wall', nl: 'Raamwand' }, { stone: 8, metal: 4, wood: 2 }, 'edge'),
  P('wall', 'door-wall', { en: 'Door Wall', nl: 'Deurwand' }, { stone: 6, wood: 8, metal: 2 }, 'edge'),
  P('wall', 'half-wall', { en: 'Half Wall', nl: 'Halve muur' }, { stone: 5, wood: 2 }, 'edge'),
  // FLOOR
  P('floor', 'floor', { en: 'Floor', nl: 'Vloer' }, { stone: 10, metal: 2 }, 'deck'),
  P('floor', 'glass-floor', { en: 'Glass Floor', nl: 'Glasvloer' }, { metal: 6, stone: 8 }, 'deck'),
  P('floor', 'wood-deck', { en: 'Wooden Deck', nl: 'Houten terras' }, { wood: 14 }, 'deck'),
  // ROOF
  P('roof', 'flat-roof', { en: 'Flat Roof', nl: 'Plat dak' }, { stone: 10, metal: 4 }, 'roof'),
  P('roof', 'pitched-roof', { en: 'Pitched Roof', nl: 'Schuin dak' }, { wood: 14, stone: 6 }, 'roof'),
  P('roof', 'canopy', { en: 'Canopy', nl: 'Luifel' }, { metal: 6, wood: 8 }, 'room', { size: [1, 1], storeys: 1 }),
  // DECOR
  P('decor', 'planter', { en: 'Planter', nl: 'Plantenbak' }, { stone: 4, wood: 2 }, 'free', { radius: 0.7 }),
  P('decor', 'lamp', { en: 'Lamp', nl: 'Lamp' }, { metal: 3, energy: 1 }, 'free', { radius: 0.3 }),
  P('decor', 'bench', { en: 'Bench', nl: 'Bank' }, { wood: 6 }, 'free', { radius: 0.9 }),
  P('decor', 'table', { en: 'Table', nl: 'Tafel' }, { wood: 6 }, 'free', { radius: 0.85 }),
  P('decor', 'banner', { en: 'Ø Banner', nl: 'Ø-banier' }, { wood: 2, metal: 2 }, 'free', { radius: 0.4 }),
  P('decor', 'brazier', { en: 'Fire Basket', nl: 'Vuurkorf' }, { metal: 4, wood: 4 }, 'free', { radius: 0.5, smp: { fire: 5 } }),
  P('decor', 'crates', { en: 'Crates', nl: 'Kratten' }, { wood: 6 }, 'free', { radius: 0.8 }),
  P('decor', 'statue', { en: 'Ø Statue', nl: 'Ø-standbeeld' }, { stone: 30 }, 'free', { radius: 1.0, unlock: 'decor-statue' }),
  P('decor', 'neon-tree', { en: 'Neon Tree', nl: 'Neonboom' }, { metal: 10, energy: 10 }, 'free', { radius: 1.0, unlock: 'decor-neon-tree' }),
  // POWER
  P('power', 'solar-panel', { en: 'Solar Panel', nl: 'Zonnepaneel' }, { metal: 12, stone: 4 }, 'free', { radius: 1.3 }),
  P('power', 'generator', { en: 'Generator', nl: 'Generator' }, { metal: 20, wood: 10 }, 'free', { radius: 1.0 }),
  P('power', 'battery', { en: 'Battery', nl: 'Accu' }, { metal: 16 }, 'free', { radius: 0.6 }),
  P('power', 'light-mast', { en: 'Light Mast', nl: 'Lichtmast' }, { metal: 6 }, 'free', { radius: 0.35 }),
  P('power', 'fusion-core', { en: 'Fusion Core', nl: 'Fusiekern' }, { metal: 60, energy: 30 }, 'free', { radius: 1.3, unlock: 'power-fusion' }),
  // SURVIVAL (SMP)
  P('survival', 'workbench', { en: 'Workbench', nl: 'Werkbank' }, { metal: 30, wood: 20, stone: 10 }, 'free', {
    radius: 1.25,
    smp: { station: 'workbench', tier: 1 },
  }),
  P('survival', 'workbench-2', { en: 'Workbench Mk II', nl: 'Werkbank Mk II' }, { metal: 120, stone: 80, energy: 40 }, 'free', {
    radius: 1.35,
    hidden: true, // created by the 'workbench-t2' upgrade recipe, not placed directly
    smp: { station: 'workbench', tier: 2 },
  }),
  P('survival', 'claim-beacon', { en: 'Claim Beacon', nl: 'Claimbaken' }, { metal: 25, stone: 20, energy: 10 }, 'free', {
    radius: 0.8,
    smp: { claim: CLAIM_RADIUS },
    limit: 1,
  }),
  P('survival', 'spawn-beacon', { en: 'Spawn Beacon', nl: 'Spawnbaken' }, { metal: 20, energy: 15 }, 'free', {
    radius: 1.1,
    smp: { spawn: true },
    limit: 1,
  }),
  // ---- survival depth (campfire, storage, beds, doors, light, Workbench Mk III)
  P('survival', 'campfire', { en: 'Campfire', nl: 'Kampvuur' }, { stone: 8, wood: 10 }, 'free', {
    radius: 0.95,
    smp: { fire: 8, station: 'campfire', cook: 3 }, // warmth radius (m), cooking slots
    limit: 8,
  }),
  P('survival', 'sleeping-bag', { en: 'Sleeping Bag', nl: 'Slaapzak' }, { fiber: 10, wood: 2 }, 'free', {
    radius: 0.6,
    smp: { bed: { side: 0.95 } },
    limit: 3,
  }),
  P('survival', 'bed', { en: 'Bed', nl: 'Bed' }, { wood: 18, fiber: 12, metal: 2 }, 'free', {
    radius: 1.05,
    smp: { bed: { side: 1.25 } },
    limit: 3,
  }),
  P('survival', 'storage-chest', { en: 'Storage Chest', nl: 'Opslagkist' }, { wood: 24, metal: 6 }, 'free', {
    radius: 0.7,
    smp: { storage: { stacks: 24 } },
    limit: 24,
  }),
  P('survival', 'door', { en: 'Door', nl: 'Deur' }, { wood: 12, metal: 6 }, 'edge', {
    smp: { door: true },
    limit: 32,
  }),
  P('survival', 'torch', { en: 'Torch', nl: 'Fakkel' }, { wood: 3, fiber: 2 }, 'free', {
    radius: 0.3,
    smp: { light: 'torch' },
    limit: 40,
  }),
  P('survival', 'workbench-3', { en: 'Workbench Mk III', nl: 'Werkbank Mk III' }, { metal: 160, energy: 80 }, 'free', {
    radius: 1.35,
    hidden: true, // created by the 'workbench-t3' upgrade recipe
    smp: { station: 'workbench', tier: 3 },
  }),
];

/** One-tier station upgrades (recipes with `upgrade`): the bench type → the next tier's type. */
export const UPGRADES = { workbench: 'workbench-2', 'workbench-2': 'workbench-3' };

export const PIECE = Object.fromEntries(PIECES.map((p) => [p.id, p]));

/** Refund of a removed piece: 50 % of the cost, rounded down (same as the build module). */
export function refundOf(cost = {}) {
  const out = {};
  for (const [k, v] of Object.entries(cost)) {
    const r = Math.floor(v / 2);
    if (r > 0) out[k] = r;
  }
  return out;
}

/**
 * Protected landmark areas (no building; mirrors src/build/placement.js PROTECTED):
 * circles {c: [x, z, r]} and rects {r: [minX, maxX, minZ, maxZ]}.
 */
export const BUILD_PROTECTED = [
  { id: 'plaza', c: [360, -150, 92] },
  { id: 'spaceport', r: [374, 571, 169, 336] },
  { id: 'ruins', c: [250, 95, 42] },
  { id: 'lookout', c: [-280, 30, 12] },
  { id: 'signal', c: [-120, -152, 22] },
  { id: 'spawn', c: [0, 150, 22] },
  { id: 'waterfall', c: [-322, -228, 16] },
  { id: 'house', r: [-284, -244, 322, 362] },
  { id: 'house', c: [-245.5, 344.5, 6.5] },
  { id: 'landing-pad', c: [-186, 368, 10.5] },
  { id: 'city', c: [60, -810, 185] },
  { id: 'city', c: [-225, -760, 110] },
  { id: 'city', c: [305, -765, 120] },
  { id: 'city', c: [130, -1005, 140] },
  { id: 'city', c: [-125, -955, 95] },
];

/** First protected area within r of (x, z), or null. */
export function protectedAt(x, z, r = 0) {
  for (const p of BUILD_PROTECTED) {
    if (p.c ? Math.hypot(x - p.c[0], z - p.c[1]) < p.c[2] + r : x + r > p.r[0] && x - r < p.r[1] && z + r > p.r[2] && z - r < p.r[3]) return p;
  }
  return null;
}
