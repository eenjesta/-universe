/**
 * Inventory items (SMP v1): resources, ammo, consumables, survival numbers,
 * start inventory and loot rules. Pure data, bilingual names.
 *
 * Inventory shape (S.INV, server truth):
 *   { res: {metal, stone, wood, energy}, credits, ammo: {pulse, plasma, rail},
 *     items: {ration, medkit, 'shield-cell', 'shock-grenade'}, weapons: [ids],
 *     slot: 0..3, mag: {weaponId: rounds in the magazine}, unlocks: [market ids] }
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
export const ITEMS = {
  ration: {
    id: 'ration',
    name: { en: 'Ration', nl: 'Rantsoen' },
    desc: { en: 'Restores 35 energy.', nl: 'Herstelt 35 energie.' },
    use: { en: 35 },
    max: 10,
    hotkey: 5,
    icon: 'item-ration',
  },
  medkit: {
    id: 'medkit',
    name: { en: 'Medkit', nl: 'Medkit' },
    desc: { en: 'Restores 40 health.', nl: 'Herstelt 40 gezondheid.' },
    use: { hp: 40 },
    max: 5,
    hotkey: 6,
    icon: 'item-medkit',
  },
  'shield-cell': {
    id: 'shield-cell',
    name: { en: 'Shield cell', nl: 'Schildcel' },
    desc: { en: 'Recharges 50 shield instantly.', nl: 'Laadt direct 50 schild op.' },
    use: { sh: 50 },
    max: 5,
    hotkey: 7,
    icon: 'item-shield',
  },
  'shock-grenade': {
    id: 'shock-grenade',
    name: { en: 'Shock grenade', nl: 'Schokgranaat' },
    desc: { en: 'Throwable (weapon slot 4).', nl: 'Werpwapen (wapenslot 4).' },
    max: 3,
    weapon: 'shock-grenade',
    icon: 'wpn-grenade',
  },
};
export const ITEM_IDS = Object.keys(ITEMS);
export const USE_COOLDOWN = 0.8; // seconds between consumables

/** Survival model (PLATFORM.md §1). Rates per second unless noted. */
export const SURVIVAL = {
  maxHp: 100,
  maxSh: 50,
  maxEn: 100,
  shieldDelay: 4, // s after the last damage before the shield regenerates
  shieldRegen: 10, // per s
  hpRegen: 0, // natural health regeneration (none in v1: medkits)
  energyDrain: 1 / 40, // per s (1 per 40 s)
  sprintDrain: 1 / 8, // extra per s while sprinting (anim 'run')
  starve: 1, // hp per s at 0 energy
  respawnDelay: 5, // s
  respawnEnergy: 60, // energy is topped up to at least this on respawn
  fallSafe: 14, // m/s vertical impact speed without damage (client reports falls; v1: unused)
};

/** Death drop (PLATFORM.md §1): carried resources (not weapons) into an owner-only crate. */
export const DEATH_DROP = { fraction: 0.3, ttl: 600, ammoFraction: 0.3 };
/** Enemy loot crates: public, despawn after ttl seconds. Pickup range in metres. */
export const LOOT = { ttl: 180, pickupRange: 3.5, maxWorld: 400 };

/** New player inventory. */
export const START = {
  res: { metal: 60, stone: 120, wood: 120, energy: 40 },
  credits: 500,
  ammo: { pulse: 48, plasma: 0, rail: 0 },
  items: { ration: 3, medkit: 1, 'shield-cell': 0, 'shock-grenade': 0 },
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
