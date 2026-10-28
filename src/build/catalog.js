/**
 * Build catalog — categories (keys 1–6, poster build bar order) and pieces.
 *
 * Ids are stable: they are saved in state.structures and matched by the
 * systems quest "Een thuis bouwen" (category/piece text: wall|roof|power|
 * struct|found|floor). Names are bilingual {en, nl}; resolve them with t().
 *
 * Piece fields:
 *   snap     'deck'   one 4 m cell, horizontal surface (foundation, floors)
 *            'edge'   on a cell edge (walls)
 *            'corner' on a grid vertex (pillar)
 *            'roof'   on top of walls/pillars of a cell
 *            'room'   occupies the volume of cells (stairs, prefabs, canopy)
 *            'free'   decor / power: anywhere flat, 0.5 m snapping
 *   size     [cellsX, cellsZ] footprint for 'room' pieces (rotated by R)
 *   storeys  levels a 'room' piece spans (tower = 4)
 *   cost     { metal, stone, wood, energy } spent with state.spend
 *   power    { produce (per min), solar: bool } | { consume (per min), night } | { store }
 *   unlock   market item id required in state.owned.items
 *   points   contribution to the base level
 *   radius   footprint radius of 'free' pieces (overlap checks)
 *   hidden   not in the build bar (e.g. 'workbench-2', created by the server's upgrade recipe)
 *   smp      survival role: { station: 'workbench', tier } | { claim: radius } | { spawn: true } | { fire: warmth m,
 *            station: 'campfire', cook: slots } | { bed } | { storage } | { door } | { light }
 *   light    a warm point light at night (src/build/firelight.js picks the nearest few)
 *
 * The 'survival' category (key 7: Workbench, Claim Beacon, Spawn Beacon) is only
 * shown while a server is authoritative (ctx.build.setAuthority, online or
 * LocalServer); the single-player fallback keeps the classic six categories.
 * Costs are mirrored in shared/defs/pieces.js (server truth when online).
 */

export const CELL = 4; // grid cell (m)
export const LEVEL_H = 3.2; // floor-to-floor height
export const WALL_H = 3.0; // wall height (a 0.2 m slab sits on top)
export const SLAB = 0.2;
export const MAX_LEVEL = 6;
export const REACH = 24; // max horizontal distance player → placement
export const CLAIM_RADIUS = 24; // claim beacon protection radius (PLATFORM.md §1)

export const RESOURCES = [
  { id: 'metal', icon: 'metal', name: { en: 'Metal', nl: 'Metaal' }, color: '#9fc6ff' },
  { id: 'stone', icon: 'stone', name: { en: 'Stone', nl: 'Steen' }, color: '#d9d2c4' },
  { id: 'wood', icon: 'wood', name: { en: 'Wood', nl: 'Hout' }, color: '#e0a868' },
  { id: 'energy', icon: 'energy', name: { en: 'Energy', nl: 'Energie' }, color: '#7fe0ff' },
];

export const CATEGORIES = [
  { id: 'structure', key: 'Digit1', icon: 'structure', name: { en: 'Structure', nl: 'Structuur' } },
  { id: 'wall', key: 'Digit2', icon: 'wall', name: { en: 'Wall', nl: 'Muur' } },
  { id: 'floor', key: 'Digit3', icon: 'floor', name: { en: 'Floor', nl: 'Vloer' } },
  { id: 'roof', key: 'Digit4', icon: 'roof', name: { en: 'Roof', nl: 'Dak' } },
  { id: 'decor', key: 'Digit5', icon: 'decor', name: { en: 'Decor', nl: 'Decor' } },
  { id: 'power', key: 'Digit6', icon: 'power', name: { en: 'Power', nl: 'Energie' } },
  { id: 'survival', key: 'Digit7', icon: 'bld-survival', name: { en: 'Survival', nl: 'Overleven' }, smp: true },
];

const P = (category, id, name, cost, snap, extra = {}) => ({ category, id, name, cost, snap, points: 1, ...extra });

export const PIECES = [
  // ------------------------------------------------------------- STRUCTURE
  P('structure', 'foundation', { en: 'Foundation', nl: 'Fundering' }, { stone: 24, metal: 4 }, 'deck', {
    desc: { en: 'Concrete slab, 4 × 4 m. Levels out slopes.', nl: 'Betonnen plaat, 4 × 4 m. Vlakt hellingen af.' },
    icon: 'bld-foundation',
  }),
  P('structure', 'cube-module', { en: 'Cube Module', nl: 'Kubusmodule' }, { metal: 40, stone: 20, wood: 10 }, 'room', {
    desc: { en: 'Prefab glass room module.', nl: 'Geprefabriceerde glazen kamermodule.' },
    size: [1, 1], storeys: 1, points: 6, icon: 'bld-cube',
  }),
  P('structure', 'stairs', { en: 'Stairs', nl: 'Trap' }, { wood: 16, metal: 4 }, 'room', {
    desc: { en: 'Climbs one storey.', nl: 'Gaat één verdieping omhoog.' },
    size: [1, 1], storeys: 1, icon: 'bld-stairs',
  }),
  P('structure', 'pillar', { en: 'Pillar', nl: 'Pilaar' }, { stone: 6, metal: 2 }, 'corner', {
    desc: { en: 'Supports floors and roofs.', nl: 'Draagt vloeren en daken.' },
    icon: 'bld-pillar',
  }),
  P('structure', 'tower', { en: 'Tower', nl: 'Toren' }, { metal: 90, stone: 60, energy: 20 }, 'room', {
    desc: { en: 'Four-storey glass tower prefab.', nl: 'Glazen toren met vier verdiepingen.' },
    size: [2, 2], storeys: 4, points: 12, icon: 'bld-tower',
  }),
  P('structure', 'landing-pad', { en: 'Landing Pad', nl: 'Landingsplatform' }, { metal: 50, stone: 40 }, 'room', {
    desc: { en: 'Raised 8 × 8 m pad for aircraft.', nl: 'Verhoogd platform van 8 × 8 m voor luchtvaartuigen.' },
    size: [2, 2], storeys: 1, points: 6, groundOnly: true, icon: 'bld-pad',
  }),
  P('structure', 'workshop', { en: 'Workshop', nl: 'Werkplaats' }, { metal: 45, wood: 30, stone: 20 }, 'room', {
    desc: { en: 'Prefab workshop with an open bay.', nl: 'Geprefabriceerde werkplaats met open werkruimte.' },
    size: [2, 1], storeys: 1, points: 8, icon: 'bld-workshop',
  }),
  // ------------------------------------------------------------------ WALL
  P('wall', 'wall', { en: 'Wall', nl: 'Muur' }, { stone: 10, wood: 4 }, 'edge', { icon: 'bld-wall' }),
  P('wall', 'glass-wall', { en: 'Glass Wall', nl: 'Glaswand' }, { metal: 6, stone: 8 }, 'edge', { icon: 'bld-glass-wall' }),
  P('wall', 'window-wall', { en: 'Window Wall', nl: 'Raamwand' }, { stone: 8, metal: 4, wood: 2 }, 'edge', { icon: 'bld-window-wall' }),
  P('wall', 'door-wall', { en: 'Door Wall', nl: 'Deurwand' }, { stone: 6, wood: 8, metal: 2 }, 'edge', { icon: 'bld-door-wall' }),
  P('wall', 'half-wall', { en: 'Half Wall', nl: 'Halve muur' }, { stone: 5, wood: 2 }, 'edge', { icon: 'bld-half-wall', half: true }),
  // ----------------------------------------------------------------- FLOOR
  P('floor', 'floor', { en: 'Floor', nl: 'Vloer' }, { stone: 10, metal: 2 }, 'deck', { icon: 'bld-floor' }),
  P('floor', 'glass-floor', { en: 'Glass Floor', nl: 'Glasvloer' }, { metal: 6, stone: 8 }, 'deck', { icon: 'bld-glass-floor' }),
  P('floor', 'wood-deck', { en: 'Wooden Deck', nl: 'Houten terras' }, { wood: 14 }, 'deck', { icon: 'bld-deck' }),
  // ------------------------------------------------------------------ ROOF
  P('roof', 'flat-roof', { en: 'Flat Roof', nl: 'Plat dak' }, { stone: 10, metal: 4 }, 'roof', { points: 2, icon: 'bld-flat-roof' }),
  P('roof', 'pitched-roof', { en: 'Pitched Roof', nl: 'Schuin dak' }, { wood: 14, stone: 6 }, 'roof', { points: 2, icon: 'bld-pitched-roof' }),
  P('roof', 'canopy', { en: 'Canopy', nl: 'Luifel' }, { metal: 6, wood: 8 }, 'room', {
    desc: { en: 'Free-standing slatted canopy.', nl: 'Vrijstaande lamellenluifel.' },
    size: [1, 1], storeys: 1, points: 2, icon: 'bld-canopy',
  }),
  // ----------------------------------------------------------------- DECOR
  P('decor', 'planter', { en: 'Planter', nl: 'Plantenbak' }, { stone: 4, wood: 2 }, 'free', { radius: 0.7, icon: 'bld-planter' }),
  P('decor', 'lamp', { en: 'Lamp', nl: 'Lamp' }, { metal: 3, energy: 1 }, 'free', { radius: 0.3, power: { consume: 0.2, night: true }, icon: 'bld-lamp' }),
  P('decor', 'bench', { en: 'Bench', nl: 'Bank' }, { wood: 6 }, 'free', { radius: 0.9, icon: 'bld-bench' }),
  P('decor', 'table', { en: 'Table', nl: 'Tafel' }, { wood: 6 }, 'free', { radius: 0.85, icon: 'bld-table' }),
  P('decor', 'banner', { en: 'Ø Banner', nl: 'Ø-banier' }, { wood: 2, metal: 2 }, 'free', { radius: 0.4, icon: 'bld-banner' }),
  P('decor', 'brazier', { en: 'Fire Basket', nl: 'Vuurkorf' }, { metal: 4, wood: 4 }, 'free', { radius: 0.5, icon: 'bld-brazier', smp: { fire: 5 }, light: { color: 0xff9a50, intensity: 16, range: 10, y: 1.2 } }),
  P('decor', 'crates', { en: 'Crates', nl: 'Kratten' }, { wood: 6 }, 'free', { radius: 0.8, icon: 'bld-crates' }),
  P('decor', 'statue', { en: 'Ø Statue', nl: 'Ø-standbeeld' }, { stone: 30 }, 'free', { radius: 1.0, unlock: 'decor-statue', points: 4, icon: 'bld-statue' }),
  P('decor', 'neon-tree', { en: 'Neon Tree', nl: 'Neonboom' }, { metal: 10, energy: 10 }, 'free', { radius: 1.0, unlock: 'decor-neon-tree', points: 4, icon: 'bld-neon-tree' }),
  // ----------------------------------------------------------------- POWER
  P('power', 'solar-panel', { en: 'Solar Panel', nl: 'Zonnepaneel' }, { metal: 12, stone: 4 }, 'free', {
    radius: 1.3, power: { produce: 4, solar: true }, points: 2, icon: 'bld-solar',
  }),
  P('power', 'generator', { en: 'Generator', nl: 'Generator' }, { metal: 20, wood: 10 }, 'free', {
    radius: 1.0, power: { produce: 3 }, points: 2, icon: 'bld-generator',
  }),
  P('power', 'battery', { en: 'Battery', nl: 'Accu' }, { metal: 16 }, 'free', { radius: 0.6, power: { store: 250 }, points: 2, icon: 'bld-battery' }),
  P('power', 'light-mast', { en: 'Light Mast', nl: 'Lichtmast' }, { metal: 6 }, 'free', {
    radius: 0.35, power: { consume: 0.5, night: true }, points: 1, icon: 'bld-mast',
  }),
  P('power', 'fusion-core', { en: 'Fusion Core', nl: 'Fusiekern' }, { metal: 60, energy: 30 }, 'free', {
    radius: 1.3, power: { produce: 15 }, unlock: 'power-fusion', points: 6, icon: 'bld-fusion',
  }),
  // -------------------------------------------------------------- SURVIVAL (SMP)
  P('survival', 'workbench', { en: 'Workbench', nl: 'Werkbank' }, { metal: 30, wood: 20, stone: 10 }, 'free', {
    desc: { en: 'Crafting station (tier 1): ammo, rations, medkits, shield cells, weapons.', nl: 'Werkstation (niveau 1): munitie, rantsoenen, medkits, schildcellen, wapens.' },
    radius: 1.25, points: 3, icon: 'bld-workbench', smp: { station: 'workbench', tier: 1 },
  }),
  P('survival', 'campfire', { en: 'Campfire', nl: 'Kampvuur' }, { stone: 8, wood: 10 }, 'free', {
    desc: { en: 'Warmth at night (heals you out of combat) and a cooking spot: [E] to cook meals.', nl: 'Warmte in de nacht (geneest je buiten gevechten) en een kookplek: [E] om maaltijden te koken.' },
    radius: 0.95, points: 2, icon: 'bld-campfire', smp: { fire: 8, station: 'campfire', cook: 3 }, light: { color: 0xff9a4a, intensity: 28, range: 14, y: 0.9 },
  }),
  P('survival', 'claim-beacon', { en: 'Claim Beacon', nl: 'Claimbaken' }, { metal: 25, stone: 20, energy: 10 }, 'free', {
    desc: { en: 'Claims the land within 24 m: only you can build or remove there.', nl: 'Claimt het land binnen 24 m: alleen jij kunt daar bouwen of slopen.' },
    radius: 0.8, points: 2, icon: 'bld-claim', smp: { claim: CLAIM_RADIUS },
  }),
  P('survival', 'sleeping-bag', { en: 'Sleeping Bag', nl: 'Slaapzak' }, { fiber: 10, wood: 2 }, 'free', {
    desc: { en: 'A respawn point you can carry the cost of: [E] to rest and set home.', nl: 'Een goedkoop respawnpunt: [E] om te rusten en je thuis in te stellen.' },
    radius: 0.6, points: 1, icon: 'bld-bag', smp: { bed: { side: 0.95 } },
  }),
  P('survival', 'storage-chest', { en: 'Storage Chest', nl: 'Opslagkist' }, { wood: 24, metal: 6 }, 'free', {
    desc: { en: 'Keeps 24 stacks safe — only you can open it. Nothing is lost here when you fall.', nl: 'Bewaart 24 stapels veilig — alleen jij kunt hem openen. Hier gaat niets verloren als je valt.' },
    radius: 0.7, points: 2, icon: 'bld-chest', smp: { storage: { stacks: 24 } },
  }),
  P('survival', 'bed', { en: 'Bed', nl: 'Bed' }, { wood: 18, fiber: 12, metal: 2 }, 'free', {
    desc: { en: 'Respawn here after a defeat. Sleeping makes you Rested.', nl: 'Respawn hier na een nederlaag. Slapen maakt je Uitgerust.' },
    radius: 1.05, points: 3, icon: 'bld-bed', smp: { bed: { side: 1.25 } },
  }),
  P('survival', 'door', { en: 'Door', nl: 'Deur' }, { wood: 12, metal: 6 }, 'edge', {
    desc: { en: 'A wall with a lockable door: only you can open it.', nl: 'Een muur met een deur op slot: alleen jij kunt hem openen.' },
    points: 2, icon: 'bld-door', smp: { door: true },
  }),
  P('survival', 'torch', { en: 'Torch', nl: 'Fakkel' }, { wood: 3, fiber: 2 }, 'free', {
    desc: { en: 'A warm light for paths and doorways — no power needed.', nl: 'Warm licht voor paden en deuren — geen stroom nodig.' },
    radius: 0.3, points: 1, icon: 'bld-torch', smp: { light: 'torch' }, light: { color: 0xffa860, intensity: 12, range: 9, y: 1.75 },
  }),
  P('survival', 'spawn-beacon', { en: 'Spawn Beacon', nl: 'Spawnbaken' }, { metal: 20, energy: 15 }, 'free', {
    desc: { en: 'Your respawn point after a defeat.', nl: 'Je respawnpunt na een nederlaag.' },
    radius: 1.1, points: 2, icon: 'bld-spawn', smp: { spawn: true },
  }),
  P('survival', 'workbench-2', { en: 'Workbench Mk II', nl: 'Werkbank Mk II' }, { metal: 120, stone: 80, energy: 40 }, 'free', {
    desc: { en: 'Upgraded crafting station (tier 2): railgun and advanced gear.', nl: 'Verbeterd werkstation (niveau 2): railgun en geavanceerde uitrusting.' },
    radius: 1.35, points: 5, icon: 'bld-workbench', hidden: true, smp: { station: 'workbench', tier: 2 },
  }),
  P('survival', 'workbench-3', { en: 'Workbench Mk III', nl: 'Werkbank Mk III' }, { metal: 160, energy: 80 }, 'free', {
    desc: { en: 'Fabricator (tier 3): shield module Mk II and the best gear.', nl: 'Fabricator (niveau 3): schildmodule Mk II en de beste uitrusting.' },
    radius: 1.35, points: 7, icon: 'bld-workbench', hidden: true, smp: { station: 'workbench', tier: 3 },
  }),
];

export const PIECE = Object.fromEntries(PIECES.map((p) => [p.id, p]));

/** Pieces of a category shown in the build bar (hidden pieces like 'workbench-2' excluded). */
export function piecesOf(categoryId) {
  return PIECES.filter((p) => p.category === categoryId && !p.hidden);
}

/** Base level thresholds (points → level 1…8). Level 1 = the landmarks base alone. */
export const LEVEL_POINTS = [0, 14, 34, 64, 104, 160, 240, 340];

export function levelFor(points) {
  let lvl = 1;
  for (let i = 1; i < LEVEL_POINTS.length; i++) if (points >= LEVEL_POINTS[i]) lvl = i + 1;
  return lvl;
}

/** Refund of a removed piece: 50 % of the cost, rounded down. */
export function refundOf(cost = {}) {
  const out = {};
  for (const [k, v] of Object.entries(cost)) {
    const r = Math.floor(v / 2);
    if (r > 0) out[k] = r;
  }
  return out;
}
