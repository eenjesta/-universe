/**
 * Inventory helpers (server truth). Shape: see shared/defs/items.js.
 * All amounts are integers ≥ 0; carry limits from the defs.
 * Costs ({metal, stone, wood, energy, credits, <item id>…}) may include item ids (fiber,
 * crystal-shard, schematics …): canAfford / pay check and take them from `items`.
 * Equipped gear lives in `gear` ({armor, module}: item id | null), not in `items`.
 */
import { RESOURCE_IDS, RESOURCE_MAX, CREDITS_MAX, AMMO_IDS, ITEMS, ITEM_IDS, START, GEAR_SLOTS } from '../defs/items.js';
import { WEAPONS, WEAPON_SLOTS } from '../defs/weapons.js';
import { MARKET } from '../defs/market.js';

const int = (v, max = 1e9) => {
  v = Math.floor(Number(v) || 0);
  return v < 0 ? 0 : v > max ? max : v;
};

/** Ammo type → max reserve (from the weapon defs). */
export const AMMO_MAX = Object.fromEntries(
  AMMO_IDS.map((a) => [a, Object.values(WEAPONS).reduce((m, w) => (w.ammo === a ? Math.max(m, w.reserve || 0) : m), 0)]),
);

/** A clean inventory from a save (or the start inventory). */
export function newInventory(save) {
  const src = save && typeof save === 'object' ? save : START;
  const inv = { res: {}, credits: 0, ammo: {}, items: {}, weapons: [], slot: 0, mag: {}, unlocks: [], gear: {} };
  for (const r of RESOURCE_IDS) inv.res[r] = int(src.res?.[r], RESOURCE_MAX);
  inv.credits = int(src.credits, CREDITS_MAX);
  for (const a of AMMO_IDS) inv.ammo[a] = int(src.ammo?.[a], AMMO_MAX[a] || 0);
  for (const i of ITEM_IDS) inv.items[i] = int(src.items?.[i], ITEMS[i].max);
  const weapons = Array.isArray(src.weapons) ? src.weapons : START.weapons;
  for (const w of weapons) if (WEAPONS[w] && WEAPONS[w].kind !== 'throw' && !inv.weapons.includes(w)) inv.weapons.push(w);
  if (!inv.weapons.includes('pulse-pistol')) inv.weapons.unshift('pulse-pistol');
  for (const w of inv.weapons) inv.mag[w] = int(src.mag?.[w] ?? (save ? 0 : WEAPONS[w].mag), WEAPONS[w].mag || 0);
  inv.slot = int(src.slot, 3);
  if (!hasSlot(inv, inv.slot)) inv.slot = 0;
  const unlocks = Array.isArray(src.unlocks) ? src.unlocks : [];
  for (const u of unlocks) if (typeof u === 'string' && MARKET[u] && !inv.unlocks.includes(u)) inv.unlocks.push(u);
  for (const slot of GEAR_SLOTS) {
    const g = src.gear?.[slot];
    inv.gear[slot] = typeof g === 'string' && ITEMS[g]?.gear?.slot === slot ? g : null;
  }
  return inv;
}

/** Gear stats of an inventory: {dr, maxHp, maxSh, regenDelay, sprint}. */
export function gearStats(inv) {
  const out = { dr: 0, maxHp: 0, maxSh: 0, regenDelay: 0, sprint: 1 };
  for (const slot of GEAR_SLOTS) {
    const g = ITEMS[inv?.gear?.[slot]]?.gear;
    if (!g) continue;
    out.dr = Math.min(0.6, out.dr + (g.dr || 0));
    out.maxHp += g.maxHp || 0;
    out.maxSh += g.maxSh || 0;
    out.regenDelay += g.regenDelay || 0;
    out.sprint *= g.sprint || 1;
  }
  return out;
}

/** Owns the weapon in slot (grenade slot: owns ≥ 1 grenade). */
export function hasSlot(inv, slot) {
  const w = WEAPON_SLOTS[slot];
  if (!w) return false;
  if (WEAPONS[w].kind === 'throw') return (inv.items[WEAPONS[w].item] || 0) > 0;
  return inv.weapons.includes(w);
}

export function hasWeapon(inv, w) {
  const def = WEAPONS[w];
  if (!def) return false;
  if (def.kind === 'throw') return (inv.items[def.item] || 0) > 0;
  return inv.weapons.includes(w);
}

/** cost = {metal, stone, wood, energy, credits, <item id>} */
export function canAfford(inv, cost) {
  if (!cost) return true;
  for (const [k, v] of Object.entries(cost)) {
    const n = int(v);
    if (n <= 0) continue;
    if (k === 'credits') {
      if (inv.credits < n) return false;
    } else if (inv.res[k] !== undefined) {
      if (inv.res[k] < n) return false;
    } else if (ITEMS[k]) {
      if ((inv.items[k] || 0) < n) return false;
    } else return false;
  }
  return true;
}

/** The first cost key the inventory can't cover (for deny / UI texts), or null. */
export function missingOf(inv, cost) {
  for (const [k, v] of Object.entries(cost || {})) {
    const n = int(v);
    if (n <= 0) continue;
    const have = k === 'credits' ? inv.credits : inv.res[k] !== undefined ? inv.res[k] : ITEMS[k] ? inv.items[k] || 0 : 0;
    if (have < n) return k;
  }
  return null;
}

/** Subtracts a cost (call canAfford first); marks dirty sections on `dirty` (Set). */
export function pay(inv, cost, dirty) {
  for (const [k, v] of Object.entries(cost || {})) {
    const n = int(v);
    if (n <= 0) continue;
    if (k === 'credits') {
      inv.credits = Math.max(0, inv.credits - n);
      dirty?.add('credits');
    } else if (inv.res[k] !== undefined) {
      inv.res[k] = Math.max(0, inv.res[k] - n);
      dirty?.add('res');
    } else if (ITEMS[k]) {
      inv.items[k] = Math.max(0, (inv.items[k] || 0) - n);
      dirty?.add('items');
    }
  }
}

/**
 * Adds {res: {}, credits, ammo: {}, items: {}} or a flat {metal, credits, …} with carry
 * limits; returns what was actually added (same shape, flat resources merged into res).
 */
export function gain(inv, amounts, dirty) {
  const got = {};
  if (!amounts) return got;
  const add = (section, key, n, max) => {
    n = int(n);
    if (n <= 0) return;
    const cur = inv[section][key] || 0;
    const room = Math.max(0, max - cur);
    const k = Math.min(room, n);
    if (k <= 0) return;
    inv[section][key] = cur + k;
    (got[section] || (got[section] = {}))[key] = k;
    dirty?.add(section);
  };
  for (const [k, v] of Object.entries(amounts)) {
    if (k === 'credits') {
      const n = Math.min(int(v), CREDITS_MAX - inv.credits);
      if (n > 0) {
        inv.credits += n;
        got.credits = n;
        dirty?.add('credits');
      }
    } else if (RESOURCE_IDS.includes(k)) add('res', k, v, RESOURCE_MAX);
    else if (k === 'res' && v) for (const [r, n] of Object.entries(v)) RESOURCE_IDS.includes(r) && add('res', r, n, RESOURCE_MAX);
    else if (k === 'ammo' && v) for (const [a, n] of Object.entries(v)) AMMO_IDS.includes(a) && add('ammo', a, n, AMMO_MAX[a] || 0);
    else if (k === 'items' && v) for (const [i, n] of Object.entries(v)) ITEMS[i] && add('items', i, n, ITEMS[i].max);
    else if (ITEMS[k]) add('items', k, v, ITEMS[k].max); // flat item ids ({fiber: 3}) like flat resources
  }
  return got;
}

/** Adds a weapon (with a full magazine); false when already owned. */
export function giveWeapon(inv, w, dirty) {
  const def = WEAPONS[w];
  if (!def || def.kind === 'throw' || inv.weapons.includes(w)) return false;
  inv.weapons.push(w);
  inv.weapons.sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);
  inv.mag[w] = def.mag;
  dirty?.add('weapons');
  dirty?.add('mag');
  return true;
}

/** True when the inventory has nothing worth a crate. */
export const isEmptyBundle = (b) => !b || Object.values(b).every((sec) => (typeof sec === 'number' ? sec <= 0 : !sec || Object.values(sec).every((n) => !n)));

/** Full S.INV payload (copies). */
export function invPayload(inv, sections = null) {
  const all = !sections;
  const out = {};
  if (all || sections.has('res')) out.res = { ...inv.res };
  if (all || sections.has('credits')) out.credits = inv.credits;
  if (all || sections.has('ammo')) out.ammo = { ...inv.ammo };
  if (all || sections.has('items')) out.items = { ...inv.items };
  if (all || sections.has('weapons')) out.weapons = inv.weapons.slice();
  if (all || sections.has('slot')) out.slot = inv.slot;
  if (all || sections.has('mag')) out.mag = { ...inv.mag };
  if (all || sections.has('unlocks')) out.unlocks = inv.unlocks.slice();
  if (all || sections.has('gear')) out.gear = { ...(inv.gear || {}) };
  return out;
}

/** Save form (plain JSON). */
export const invSave = (inv) => invPayload(inv);
