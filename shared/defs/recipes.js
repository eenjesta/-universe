import { TOOL_RECIPES } from './tools.js';
/**
 * Crafting recipes (C.CRAFT {recipe, n}) — need a Workbench structure of at
 * least `tier` within RECIPE_RANGE metres (PLATFORM.md §8); tier 0 = anywhere. Pure data.
 *
 *   cost   resources per craft; item ids are costs too (fiber, crystal-shard, schematics — used up)
 *   out    { ammo: {type: n} } | { items: {id: n} } | { weapon: id }
 *   upgrade  the bench type to upgrade: the nearest own bench of that type becomes the next tier
 *            (shared/defs/pieces.js UPGRADES: workbench → workbench-2 → workbench-3)
 *   max    max crafts per message (n is clamped)
 *   group  UI grouping ('tools' | 'gear' | 'supplies' …), optional
 *
 * COOK_RECIPES (campfire, C.STORE {struct, op: 'cook', recipe, n}): `cost` = items, `out` = {items},
 * `time` = seconds on the fire per batch (shared/sim/storage.js).
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
  // ---- survival depth: field crafts, gear, Mk III
  bandage: {
    id: 'bandage',
    name: { en: 'Fiber bandage', nl: 'Vezelverband' },
    cost: { fiber: 4 },
    out: { items: { bandage: 1 } },
    tier: 0,
    max: 5,
    group: 'supplies',
  },
  'light-techwear': {
    id: 'light-techwear',
    name: { en: 'Scout techwear', nl: 'Verkennerspak' },
    cost: { fiber: 24, wood: 10, metal: 16 },
    out: { items: { 'light-techwear': 1 } },
    tier: 1,
    max: 1,
    group: 'gear',
  },
  'shield-module': {
    id: 'shield-module',
    name: { en: 'Shield module Mk I', nl: 'Schildmodule Mk I' },
    cost: { metal: 40, energy: 30, 'crystal-shard': 2 },
    out: { items: { 'shield-module': 1 } },
    tier: 1,
    max: 1,
    group: 'gear',
  },
  'heavy-techwear': {
    id: 'heavy-techwear',
    name: { en: 'Vanguard plating', nl: 'Vanguard-bepantsering' },
    cost: { metal: 80, stone: 30, fiber: 30, 'schem-heavy-techwear': 1 },
    out: { items: { 'heavy-techwear': 1 } },
    tier: 2,
    max: 1,
    group: 'gear',
  },
  'workbench-t3': {
    id: 'workbench-t3',
    name: { en: 'Workbench Mk III upgrade', nl: 'Upgrade werkbank Mk III' },
    cost: { metal: 160, energy: 80, 'crystal-shard': 4, 'schem-fabricator': 1 },
    upgrade: 'workbench-2',
    tier: 2,
    max: 1,
  },
  'shield-module-2': {
    id: 'shield-module-2',
    name: { en: 'Shield module Mk II', nl: 'Schildmodule Mk II' },
    cost: { metal: 60, energy: 60, 'crystal-shard': 6, 'schem-shield-module-2': 1 },
    out: { items: { 'shield-module-2': 1 } },
    tier: 3,
    max: 1,
    group: 'gear',
  },
};
Object.assign(RECIPES, TOOL_RECIPES); // gathering tools (tools.js)
export const RECIPE_IDS = Object.keys(RECIPES);

/** Campfire cooking (shared/sim/storage.js): raw food in, meals out, `time` s on the fire per batch. */
export const COOK_RANGE = 4; // m from the campfire
export const COOK_RECIPES = {
  'fruit-skewer': { id: 'fruit-skewer', name: { en: 'Fruit skewer', nl: 'Fruitspies' }, cost: { berries: 4 }, out: { items: { 'fruit-skewer': 1 } }, time: 12, max: 5 },
  'roast-glowcaps': { id: 'roast-glowcaps', name: { en: 'Roasted glowcaps', nl: 'Geroosterde gloeikappen' }, cost: { mushroom: 3 }, out: { items: { 'roast-glowcaps': 1 } }, time: 12, max: 5 },
  'crystal-tea': { id: 'crystal-tea', name: { en: 'Crystal tea', nl: 'Kristalthee' }, cost: { 'crystal-shard': 1, berries: 2 }, out: { items: { 'crystal-tea': 2 } }, time: 18, max: 5 },
  'grilled-meat': { id: 'grilled-meat', name: { en: 'Grilled meat', nl: 'Gegrild vlees' }, cost: { 'raw-meat': 1 }, out: { items: { 'grilled-meat': 1 } }, time: 15, max: 5 },
  'hearty-stew': { id: 'hearty-stew', name: { en: 'Hearty stew', nl: 'Stevige stoofpot' }, cost: { 'raw-meat': 1, mushroom: 2, 'jungle-fruit': 1 }, out: { items: { 'hearty-stew': 1 } }, time: 24, max: 3 },
};
export const COOK_IDS = Object.keys(COOK_RECIPES);
