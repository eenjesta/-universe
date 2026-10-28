import { TOOL_ITEMS } from './tools.js';
/**
 * Inventory items (SMP): resources, ammo, consumables, food, materials, gear, schematics,
 * buffs, survival numbers, start inventory and loot rules. Pure data, bilingual names.
 *
 * Inventory shape (S.INV, server truth):
 *   { res: {metal, stone, wood, energy}, credits, ammo: {pulse, plasma, rail},
 *     items: {id: n} (every ITEMS id, carry limit `max`), weapons: [ids],
 *     slot: 0..3, mag: {weaponId: rounds in the magazine}, unlocks: [market ids],
 *     gear: {armor: itemId | null, module: itemId | null} (equipped gear, not in `items`) }
 *
 * Item fields: id, name, desc, kind ('consumable' | 'food' | 'meal' | 'material' | 'gear' | 'schematic' | 'tool' |
 *   'throw'), max (carry limit), icon (ctx.ui icon name, registered by src/smp/icons.js), hotkey?,
 *   use? {en, hp, sh} (C.USE restores, clamped), buff? {id, secs} (C.USE also grants a buff, see BUFFS),
 *   gear? {slot: 'armor' | 'module', dr? (damage reduction 0..1), maxHp?, maxSh?, regenDelay? (s, negative = sooner),
 *   sprint? (× sprint energy cost)} — C.USE on a gear item equips it (the old one goes back into items),
 *   C.USE {item, op: 'unequip'} takes it off. Recipes may use item ids as costs (fiber, crystal-shard, schematics).
 */

export const RESOURCES = {
  metal: { id: 'metal', name: { en: 'Metal', nl: 'Metaal' }, icon: 'metal', color: '#9fc6ff' },
  stone: { id: 'stone', name: { en: 'Stone', nl: 'Steen' }, icon: 'stone', color: '#d9d2c4' },
  wood: { id: 'wood', name: { en: 'Wood', nl: 'Hout' }, icon: 'wood', color: '#e0a868' },
  energy: { id: 'energy', name: { en: 'Energy', nl: 'Energie' }, icon: 'energy', color: '#7fe0ff' },
};
export const RESOURCE_IDS = ['metal', 'stone', 'wood', 'energy'];
export const RESOURCE_MAX = 99999;
export const CREDITS_MAX = 9999999;

export const AMMO = {
  pulse: { id: 'pulse', name: { en: 'Pulse cells', nl: 'Pulscellen' }, weapon: 'pulse-pistol', icon: 'ammo-pulse' },
  plasma: { id: 'plasma', name: { en: 'Plasma cells', nl: 'Plasmacellen' }, weapon: 'plasma-rifle', icon: 'ammo-plasma' },
  rail: { id: 'rail', name: { en: 'Rail slugs', nl: 'Railkogels' }, weapon: 'railgun', icon: 'ammo-rail' },
};
export const AMMO_IDS = ['pulse', 'plasma', 'rail'];

/**
 * Consumables (C.USE {item}) and carried items. `use` effects are applied by the
 * server: energy / hp / shield restore (clamped to max). `max` = carry limit.
 */
const I = (id, kind, name, desc, extra) => ({ id, kind, name, desc, ...extra });

export const ITEMS = {
  // ------------------------------------------------------------ supplies (workbench)
  ration: I('ration', 'consumable', { en: 'Ration', nl: 'Rantsoen' }, { en: 'Restores 35 energy.', nl: 'Herstelt 35 energie.' }, { use: { en: 35 }, max: 10, hotkey: 5, icon: 'smp-ration' }),
  medkit: I('medkit', 'consumable', { en: 'Medkit', nl: 'Medkit' }, { en: 'Restores 40 health.', nl: 'Herstelt 40 gezondheid.' }, { use: { hp: 40 }, max: 5, hotkey: 6, icon: 'smp-medkit' }),
  'shield-cell': I('shield-cell', 'consumable', { en: 'Shield cell', nl: 'Schildcel' }, { en: 'Recharges 50 shield instantly.', nl: 'Laadt direct 50 schild op.' }, { use: { sh: 50 }, max: 5, hotkey: 7, icon: 'smp-shield' }),
  bandage: I('bandage', 'consumable', { en: 'Fiber bandage', nl: 'Vezelverband' }, { en: 'Restores 18 health. Crafted anywhere from plant fiber.', nl: 'Herstelt 18 gezondheid. Overal te maken van plantenvezel.' }, { use: { hp: 18 }, max: 10, icon: 'smp-bandage' }),
  'shock-grenade': I('shock-grenade', 'throw', { en: 'Shock grenade', nl: 'Schokgranaat' }, { en: 'Throwable (weapon slot 4).', nl: 'Werpwapen (wapenslot 4).' }, { max: 3, weapon: 'shock-grenade', icon: 'smp-grenade' }),
  // ------------------------------------------------------------ food from the land (gathering) — eat raw or cook
  berries: I('berries', 'food', { en: 'Lumen berries', nl: 'Lumenbessen' }, { en: 'Sweet and glowing. +8 energy raw — better on the campfire.', nl: 'Zoet en gloeiend. +8 energie rauw — beter op het kampvuur.' }, { use: { en: 8, hp: 2 }, max: 40, icon: 'smp-berries' }),
  mushroom: I('mushroom', 'food', { en: 'Glowcap', nl: 'Gloeikap' }, { en: 'Forest mushroom. +6 energy raw — roast them on a campfire.', nl: 'Paddenstoel uit het bos. +6 energie rauw — rooster ze op een kampvuur.' }, { use: { en: 6 }, max: 30, icon: 'smp-mushroom' }),
  'jungle-fruit': I('jungle-fruit', 'food', { en: 'Jungle fruit', nl: 'Junglevrucht' }, { en: 'Juicy palm fruit. +14 energy and +4 health.', nl: 'Sappige palmvrucht. +14 energie en +4 gezondheid.' }, { use: { en: 14, hp: 4 }, max: 20, icon: 'smp-fruit' }),
  'raw-meat': I('raw-meat', 'food', { en: 'Raw meat', nl: 'Rauw vlees' }, { en: 'Cook it on a campfire first (+4 energy raw).', nl: 'Eerst op een kampvuur garen (+4 energie rauw).' }, { use: { en: 4 }, max: 20, icon: 'smp-meat' }),
  // ------------------------------------------------------------ campfire meals (COOK_RECIPES in recipes.js)
  'roast-glowcaps': I('roast-glowcaps', 'meal', { en: 'Roasted glowcaps', nl: 'Geroosterde gloeikappen' }, { en: '+30 energy, +10 health. Well fed: hunger slows down.', nl: '+30 energie, +10 gezondheid. Goed gevoed: honger gaat trager.' }, { use: { en: 30, hp: 10 }, buff: { id: 'fed', secs: 480 }, max: 10, icon: 'smp-meal' }),
  'fruit-skewer': I('fruit-skewer', 'meal', { en: 'Fruit skewer', nl: 'Fruitspies' }, { en: '+40 energy, +10 health. Energised: sprinting costs less.', nl: '+40 energie, +10 gezondheid. Energiek: sprinten kost minder.' }, { use: { en: 40, hp: 10 }, buff: { id: 'swift', secs: 420 }, max: 10, icon: 'smp-skewer' }),
  'crystal-tea': I('crystal-tea', 'meal', { en: 'Crystal tea', nl: 'Kristalthee' }, { en: '+14 energy, +25 shield. Shield surge: faster shield recharge.', nl: '+14 energie, +25 schild. Schildstoot: schild laadt sneller op.' }, { use: { en: 14, sh: 25 }, buff: { id: 'charged', secs: 360 }, max: 10, icon: 'smp-tea' }),
  'grilled-meat': I('grilled-meat', 'meal', { en: 'Grilled meat', nl: 'Gegrild vlees' }, { en: '+38 energy, +15 health. Well fed.', nl: '+38 energie, +15 gezondheid. Goed gevoed.' }, { use: { en: 38, hp: 15 }, buff: { id: 'fed', secs: 600 }, max: 10, icon: 'smp-meat-cooked' }),
  'hearty-stew': I('hearty-stew', 'meal', { en: 'Hearty stew', nl: 'Stevige stoofpot' }, { en: '+60 energy, +30 health. Well fed for 15 minutes.', nl: '+60 energie, +30 gezondheid. 15 minuten goed gevoed.' }, { use: { en: 60, hp: 30 }, buff: { id: 'fed', secs: 900 }, max: 5, icon: 'smp-stew' }),
  // ------------------------------------------------------------ materials
  fiber: I('fiber', 'material', { en: 'Plant fiber', nl: 'Plantenvezel' }, { en: 'From ferns and jungle plants: bandages, beds, techwear.', nl: 'Van varens en jungleplanten: verband, bedden, techwear.' }, { max: 250, icon: 'smp-fiber' }),
  'crystal-shard': I('crystal-shard', 'material', { en: 'Crystal shard', nl: 'Kristalscherf' }, { en: 'Rare: cut from energy crystals. Shield tech and crystal tea.', nl: 'Zeldzaam: gesneden uit energiekristallen. Schildtechniek en kristalthee.' }, { max: 60, icon: 'smp-crystal' }),
  // ------------------------------------------------------------ gear (equipped in the inventory's gear slots)
  'light-techwear': I('light-techwear', 'gear', { en: 'Scout techwear', nl: 'Verkennerspak' }, { en: 'Woven armour panels: −12 % damage taken.', nl: 'Geweven pantserpanelen: −12 % schade.' }, { gear: { slot: 'armor', dr: 0.12 }, max: 1, icon: 'smp-armor' }),
  'heavy-techwear': I('heavy-techwear', 'gear', { en: 'Vanguard plating', nl: 'Vanguard-bepantsering' }, { en: 'Heavy plates: −25 % damage, +20 max health; sprinting costs more.', nl: 'Zware platen: −25 % schade, +20 max gezondheid; sprinten kost meer.' }, { gear: { slot: 'armor', dr: 0.25, maxHp: 20, sprint: 1.3 }, max: 1, icon: 'smp-armor-heavy' }),
  'shield-module': I('shield-module', 'gear', { en: 'Shield module Mk I', nl: 'Schildmodule Mk I' }, { en: '+25 max shield.', nl: '+25 max schild.' }, { gear: { slot: 'module', maxSh: 25 }, max: 1, icon: 'smp-module' }),
  'shield-module-2': I('shield-module-2', 'gear', { en: 'Shield module Mk II', nl: 'Schildmodule Mk II' }, { en: '+50 max shield, recharges 1.5 s sooner.', nl: '+50 max schild, laadt 1,5 s eerder op.' }, { gear: { slot: 'module', maxSh: 50, regenDelay: -1.5 }, max: 1, icon: 'smp-module-2' }),
  // ------------------------------------------------------------ schematics (found in POI caches, consumed by the recipe)
  'schem-heavy-techwear': I('schem-heavy-techwear', 'schematic', { en: 'Schematic: Vanguard plating', nl: 'Bouwtekening: Vanguard-bepantsering' }, { en: 'Found at pirate outposts. Needed (and used up) to fabricate Vanguard plating at a Workbench Mk II.', nl: 'Te vinden bij piratenposten. Nodig (en verbruikt) om Vanguard-bepantsering te maken aan een Werkbank Mk II.' }, { max: 3, icon: 'smp-schematic' }),
  'schem-shield-module-2': I('schem-shield-module-2', 'schematic', { en: 'Schematic: Shield module Mk II', nl: 'Bouwtekening: Schildmodule Mk II' }, { en: 'Found in Ø ruins. Needed (and used up) to fabricate a Shield module Mk II at a Workbench Mk III.', nl: 'Te vinden in Ø-ruïnes. Nodig (en verbruikt) om een Schildmodule Mk II te maken aan een Werkbank Mk III.' }, { max: 3, icon: 'smp-schematic' }),
  'schem-fabricator': I('schem-fabricator', 'schematic', { en: 'Schematic: Fabricator core', nl: 'Bouwtekening: Fabricatorkern' }, { en: 'Salvaged from crash sites. Upgrades a Workbench Mk II to Mk III.', nl: 'Geborgen uit neergestorte schepen. Upgradet een Werkbank Mk II naar Mk III.' }, { max: 3, icon: 'smp-schematic' }),
};
Object.assign(ITEMS, TOOL_ITEMS); // gathering tools (tools.js)
for (const it of Object.values(ITEMS)) if (!it.kind) it.kind = it.tool ? 'tool' : 'consumable';
export const ITEM_IDS = Object.keys(ITEMS);
export const USE_COOLDOWN = 0.8; // seconds between consumables
/** Raw + cooked food, best first (the quick bar's "eat" slot picks the first one you carry). */
export const FOOD_ORDER = ['hearty-stew', 'grilled-meat', 'roast-glowcaps', 'fruit-skewer', 'crystal-tea', 'ration', 'jungle-fruit', 'berries', 'mushroom', 'raw-meat'];
/** Gear slots (inv.gear). */
export const GEAR_SLOTS = ['armor', 'module'];
/** Items that go into the death crate (DEATH_DROP.itemFraction): materials + raw food. */
export const DROPPABLE_ITEMS = ITEM_IDS.filter((id) => ITEMS[id].kind === 'material' || ITEMS[id].kind === 'food');

/**
 * Buffs (server: p.buffs id → until ms; S.STATS `fx` lists them) and statuses (computed each tick):
 *   fed      hunger ×0.5                        swift    sprint cost ×0.35
 *   charged  shield recharge ×2, 2 s sooner    rested   hunger ×0.75, +0.25 hp/s (bed)
 *   warm     status: ≤ 8 m from a campfire — +1.5 hp/s out of combat, shield ×1.5, no night chill
 *   cold     status: night outside the hub, not warm — hunger ×1.6
 */
export const BUFFS = {
  fed: { id: 'fed', name: { en: 'Well fed', nl: 'Goed gevoed' }, desc: { en: 'Hunger slows down', nl: 'Honger gaat trager' }, icon: 'smp-buff-fed', drain: 0.5 },
  swift: { id: 'swift', name: { en: 'Energised', nl: 'Energiek' }, desc: { en: 'Sprinting costs less', nl: 'Sprinten kost minder' }, icon: 'smp-buff-swift', sprint: 0.35 },
  charged: { id: 'charged', name: { en: 'Shield surge', nl: 'Schildstoot' }, desc: { en: 'Faster shield recharge', nl: 'Schild laadt sneller op' }, icon: 'smp-buff-charged', regen: 2, regenDelay: -2 },
  rested: { id: 'rested', name: { en: 'Rested', nl: 'Uitgerust' }, desc: { en: 'Slower hunger, slow healing', nl: 'Tragere honger, langzaam genezen' }, icon: 'smp-buff-rested', drain: 0.75, hpRegen: 0.25 },
  warm: { id: 'warm', name: { en: 'Warm', nl: 'Warm' }, desc: { en: 'Healing by the fire', nl: 'Herstel bij het vuur' }, icon: 'smp-buff-warm', status: true, hpRegen: 1.5, regen: 1.5 },
  cold: { id: 'cold', name: { en: 'Cold night', nl: 'Koude nacht' }, desc: { en: 'Hunger rises — find a fire', nl: 'Honger stijgt — zoek een vuur' }, icon: 'smp-buff-cold', status: true, drain: 1.6, bad: true },
};
export const BUFF_IDS = Object.keys(BUFFS);


/** Survival model (PLATFORM.md §1). Rates per second unless noted. */
export const SURVIVAL = {
  maxHp: 100,
  maxSh: 50,
  maxEn: 100,
  shieldDelay: 4, // s after the last damage before the shield regenerates
  shieldRegen: 10, // per s
  hpRegen: 0, // natural health regeneration (none in v1: medkits)
  energyDrain: 1 / 24, // per s (1 per 24 s: a full belly lasts ~40 min ≈ most of a day/night cycle)
  sprintDrain: 1 / 10, // extra per s while sprinting (anim 'run')
  starve: 1, // hp per s at 0 energy
  respawnDelay: 5, // s
  respawnEnergy: 60, // energy is topped up to at least this on respawn
  fallSafe: 14, // m/s vertical impact speed without damage (client reports falls; v1: unused)
  warmRange: 8, // m from a campfire → 'warm'
  nightCold: 0.25, // dayFactor below this = night (cold away from a fire)
  regenCombat: 8, // s without damage before 'warm' / 'rested' healing starts
};

/** Death drop (PLATFORM.md §1): carried resources (not weapons) into an owner-only crate. */
export const DEATH_DROP = { fraction: 0.3, ttl: 600, ammoFraction: 0.3, itemFraction: 0.3 };
/** Enemy loot crates: public, despawn after ttl seconds. Pickup range in metres. */
export const LOOT = { ttl: 180, pickupRange: 3.5, maxWorld: 400 };

/** New player inventory. */
export const START = {
  res: { metal: 60, stone: 120, wood: 120, energy: 40 },
  credits: 500,
  ammo: { pulse: 48, plasma: 0, rail: 0 },
  items: { ration: 3, medkit: 1, 'shield-cell': 0, 'shock-grenade': 0, bandage: 2, berries: 4 },
  weapons: ['pulse-pistol'],
  mag: { 'pulse-pistol': 12 },
  slot: 0,
};

/** Rewards through C.GRANT (quest / event): applied once per id, capped. */
export const GRANT_CAPS = {
  credits: 1000, // per grant
  res: 120, // per resource per grant
  hourCredits: 5000, // rolling per-player hourly budget
  hourRes: 600,
  maxIds: 4000, // remembered grant ids per player
  items: ['decor-statue', 'skin-ship-gold', 'decor-neon-tree', 'power-fusion', 'outfit-nomad', 'outfit-vanguard', 'outfit-drifter', 'skin-car-sunset', 'skin-car-aurora'],
};
