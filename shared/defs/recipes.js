/**
 * Crafting recipes (C.CRAFT {recipe, n}) — all need a Workbench structure of at
 * least `tier` within RECIPE_RANGE metres (PLATFORM.md §8). Pure data.
 *
 *   cost   resources per craft
 *   out    { ammo: {type: n} } | { items: {id: n} } | { weapon: id }
 *   upgrade  'workbench' → turns the nearest own tier-1 workbench into 'workbench-2'
 *   max    max crafts per message (n is clamped)
 */
export const RECIPE_RANGE = 6;

export const RECIPES = {
  'pulse-ammo': {
    id: 'pulse-ammo',
    name: { en: 'Pulse cells ×30', nl: 'Pulscellen ×30' },
    cost: { metal: 4, energy: 2 },
    out: { ammo: { pulse: 30 } },
    tier: 1,
    max: 10,
  },
  'plasma-cells': {
    id: 'plasma-cells',
    name: { en: 'Plasma cells ×40', nl: 'Plasmacellen ×40' },
    cost: { metal: 6, energy: 4 },
    out: { ammo: { plasma: 40 } },
    tier: 1,
    max: 10,
  },
  'rail-slugs': {
    id: 'rail-slugs',
    name: { en: 'Rail slugs ×4', nl: 'Railkogels ×4' },
    cost: { metal: 10, energy: 8 },
    out: { ammo: { rail: 4 } },
    tier: 2,
    max: 10,
  },
  ration: {
    id: 'ration',
    name: { en: 'Ration', nl: 'Rantsoen' },
    cost: { wood: 2, energy: 1 },
    out: { items: { ration: 1 } },
    tier: 1,
    max: 10,
  },
  medkit: {
    id: 'medkit',
    name: { en: 'Medkit', nl: 'Medkit' },
    cost: { metal: 2, energy: 3 },
    out: { items: { medkit: 1 } },
    tier: 1,
    max: 5,
  },
  'shield-cell': {
    id: 'shield-cell',
    name: { en: 'Shield cell', nl: 'Schildcel' },
    cost: { energy: 6 },
    out: { items: { 'shield-cell': 1 } },
    tier: 1,
    max: 5,
  },
  'shock-grenade': {
    id: 'shock-grenade',
    name: { en: 'Shock grenade', nl: 'Schokgranaat' },
    cost: { metal: 8, energy: 6 },
    out: { items: { 'shock-grenade': 1 } },
    tier: 1,
    max: 3,
  },
  'plasma-rifle': {
    id: 'plasma-rifle',
    name: { en: 'Plasma rifle', nl: 'Plasmageweer' },
    cost: { metal: 60, energy: 25 },
    out: { weapon: 'plasma-rifle' },
    tier: 1,
    max: 1,
  },
  'workbench-t2': {
    id: 'workbench-t2',
    name: { en: 'Workbench Mk II upgrade', nl: 'Upgrade werkbank Mk II' },
    cost: { metal: 120, stone: 80, energy: 40 },
    upgrade: 'workbench',
    tier: 1,
    max: 1,
  },
  railgun: {
    id: 'railgun',
    name: { en: 'Railgun', nl: 'Railgun' },
    cost: { metal: 140, energy: 60 },
    out: { weapon: 'railgun' },
    tier: 2,
    max: 1,
  },
};
export const RECIPE_IDS = Object.keys(RECIPES);
