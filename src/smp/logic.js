/**
 * SMP client logic — pure functions (no DOM, no three) so they can be tested
 * with `node --test src/smp/` and shared by the UI parts of src/smp.
 *
 *   emptyInv() / mergeInv(inv, msg)        local mirror of the server inventory (S.INV full or patch)
 *   recipeOutputs(recipe)                   [{kind: 'ammo'|'item'|'weapon'|'upgrade', id, n}]
 *   recipeStatus(recipe, inv, station)      {ok, reason, missing} — tier gating + costs (UI prediction;
 *                                           the server decides)
 *   stationNear(records, x, z, range)       best workbench tier within range ({tier, dist, id} | null)
 *   claimAt(claims, x, z, pad)              the claim covering (x, z) | null
 *   foreignClaimAt(claims, me, x, z, pad)   …owned by someone else | null
 *   claimOverlap(claims, me, x, z, r, gap)  someone else's claim closer than r + its r + gap (§11.2: 30 m) | null
 *   bundleList(bundle)                      loot/crate contents → [{kind, id, n}]
 *   clock(sec)                              "9:05"
 *   haveOf(inv, key)                         amount of a cost key (resource, credits or item id)
 *   bestFood(inv, stats)                     the food the quick bar's eat slot uses ({id, n} | null)
 *   cookStatus(recipe, inv)                  {ok, n (affordable batches), missing}
 *   stationTier(type)                        workbench tier of a structure type (0 = none)
 */
import { RECIPES, RECIPE_RANGE } from '../../shared/defs/recipes.js';
import { RESOURCE_IDS, AMMO_IDS, ITEM_IDS, ITEMS, FOOD_ORDER, GEAR_SLOTS } from '../../shared/defs/items.js';
import { CLAIM_RADIUS, PIECE } from '../../shared/defs/pieces.js';
import { CLAIM_RULES } from '../../shared/defs/world.js';

/** Minimum gap between the edges of claims of different owners (§11.2). */
export const CLAIM_GAP = Number(CLAIM_RULES?.gap) >= 0 ? Number(CLAIM_RULES.gap) : 0;
export { RECIPE_RANGE, CLAIM_RADIUS };

const int = (v) => {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? n : 0;
};

export function emptyInv() {
  return {
    res: Object.fromEntries(RESOURCE_IDS.map((k) => [k, 0])),
    credits: 0,
    ammo: Object.fromEntries(AMMO_IDS.map((k) => [k, 0])),
    items: Object.fromEntries(ITEM_IDS.map((k) => [k, 0])),
    weapons: [],
    slot: 0,
    mag: {},
    unlocks: [],
    gear: Object.fromEntries(GEAR_SLOTS.map((k) => [k, null])),
    known: false, // true once the server sent an inventory
  };
}

/** Amount of a cost key: a resource, credits or an item id (fiber, crystal-shard, schematics …). */
export function haveOf(inv, k) {
  if (k === 'credits') return inv?.credits ?? 0;
  if (RESOURCE_IDS.includes(k)) return inv?.res?.[k] ?? 0;
  return inv?.items?.[k] ?? 0;
}

/** Workbench tier of a structure type (shared piece defs; 0 = not a workbench). */
export function stationTier(type) {
  const smp = PIECE[type]?.smp;
  return smp?.station === 'workbench' ? smp.tier | 0 : 0;
}

/** The food the eat slot would use: meals first (FOOD_ORDER), then rations / raw food. */
export function bestFood(inv) {
  for (const id of FOOD_ORDER) {
    const n = inv?.items?.[id] | 0;
    if (n > 0) return { id, n };
  }
  return null;
}

/** Total food portions carried (eat slot count). */
export function foodCount(inv) {
  let n = 0;
  for (const id of FOOD_ORDER) n += inv?.items?.[id] | 0;
  return n;
}

/** Campfire recipe: how many batches the bag pays for. */
export function cookStatus(recipe, inv) {
  const missing = {};
  let n = recipe?.max || 1;
  for (const [k, v] of Object.entries(recipe?.cost || {})) {
    const have = haveOf(inv, k);
    if (have < v) missing[k] = v - have;
    n = Math.min(n, Math.floor(have / v));
  }
  return { ok: !Object.keys(missing).length && n > 0, n: Math.max(0, n), missing };
}

/**
 * Applies an S.INV message ({res, credits, ammo, items, weapons, slot, mag, unlocks, patch?}).
 * Every section present replaces the mirrored section (a patch only carries the changed
 * sections); returns the list of changed section names.
 */
export function mergeInv(inv, msg) {
  if (!inv || !msg || typeof msg !== 'object') return [];
  const changed = [];
  const obj = (key) => {
    const v = msg[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    const next = msg.patch ? { ...inv[key] } : {};
    for (const [k, n] of Object.entries(v)) next[k] = int(n);
    if (!msg.patch) for (const k of Object.keys(inv[key] || {})) if (!(k in next)) next[k] = 0;
    inv[key] = next;
    changed.push(key);
  };
  obj('res');
  obj('ammo');
  obj('items');
  obj('mag');
  if (msg.credits != null) {
    inv.credits = int(msg.credits);
    changed.push('credits');
  }
  if (Array.isArray(msg.weapons)) {
    inv.weapons = msg.weapons.map((w) => (typeof w === 'string' ? w : w?.id)).filter(Boolean);
    changed.push('weapons');
  }
  if (msg.slot != null && Number.isFinite(+msg.slot)) {
    inv.slot = +msg.slot | 0;
    changed.push('slot');
  }
  if (Array.isArray(msg.unlocks)) {
    inv.unlocks = msg.unlocks.filter((u) => typeof u === 'string');
    changed.push('unlocks');
  }
  if (msg.gear && typeof msg.gear === 'object' && !Array.isArray(msg.gear)) {
    const next = { ...(inv.gear || {}) };
    for (const k of GEAR_SLOTS) if (k in msg.gear) next[k] = typeof msg.gear[k] === 'string' && ITEMS[msg.gear[k]] ? msg.gear[k] : null;
    inv.gear = next;
    changed.push('gear');
  }
  if (changed.length) inv.known = true;
  return changed;
}

/** What a recipe produces. */
export function recipeOutputs(recipe) {
  const out = [];
  if (!recipe) return out;
  const o = recipe.out || {};
  for (const [id, n] of Object.entries(o.ammo || {})) out.push({ kind: 'ammo', id, n: int(n) });
  for (const [id, n] of Object.entries(o.items || {})) out.push({ kind: 'item', id, n: int(n) });
  if (o.weapon) out.push({ kind: 'weapon', id: o.weapon, n: 1 });
  if (recipe.upgrade) out.push({ kind: 'upgrade', id: recipe.upgrade, n: 1 });
  return out;
}

/**
 * Prediction for the crafting UI.
 * station = { tier } of the best workbench in reach (null = none).
 * reason: null | 'workbench' (no station) | 'tier' (needs Mk II) | 'cost' | 'owned' | 'upgrade' (no tier-1 bench of yours)
 */
export function recipeStatus(recipe, inv, station = null, { ownStation = null } = {}) {
  const missing = {};
  if (!recipe) return { ok: false, reason: 'unknown', missing };
  const tier = recipe.tier | 0;
  for (const [k, v] of Object.entries(recipe.cost || {})) {
    const have = haveOf(inv, k);
    if (have < v) missing[k] = v - have;
  }
  const outItem = Object.keys(recipe.out?.items || {})[0];
  const upgradeFrom = recipe.upgrade ? stationTier(recipe.upgrade) : 0;
  let reason = null;
  if (tier > 0 && !station) reason = 'workbench';
  else if (tier > 0 && (station.tier | 0) < tier) reason = 'tier';
  else if (recipe.out?.weapon && inv?.weapons?.includes(recipe.out.weapon)) reason = 'owned';
  else if (outItem && ITEMS[outItem]?.max === 1 && (inv?.items?.[outItem] | 0) >= 1) reason = 'owned';
  else if (recipe.upgrade && !(ownStation && ownStation.tier === upgradeFrom)) reason = 'upgrade';
  else if (Object.keys(missing).some((k) => ITEMS[k]?.kind === 'schematic')) reason = 'schematic';
  else if (Object.keys(missing).length) reason = 'cost';
  return { ok: !reason, reason, missing };
}

/** How many times a recipe is affordable (0 when not), capped by recipe.max. */
export function craftableCount(recipe, inv) {
  if (!recipe) return 0;
  let n = recipe.max || 1;
  for (const [k, v] of Object.entries(recipe.cost || {})) {
    if (!(v > 0)) continue;
    n = Math.min(n, Math.floor(haveOf(inv, k) / v));
  }
  return Math.max(0, n);
}

/**
 * Best workbench within `range` of (x, z). records: iterable of {type, x, z, owner?}.
 * Returns {tier, dist, id, owner} of the highest tier (nearest on ties) or null.
 */
export function stationNear(records, x, z, range = RECIPE_RANGE, owner = null) {
  let best = null;
  for (const r of records || []) {
    const tier = stationTier(r?.type);
    if (!tier) continue;
    if (owner && r.owner !== owner) continue;
    const d = Math.hypot(r.x - x, r.z - z);
    if (d > range) continue;
    if (!best || tier > best.tier || (tier === best.tier && d < best.dist)) best = { tier, dist: d, id: r.id, owner: r.owner ?? null };
  }
  return best;
}

/** Claim covering (x, z) (claims: iterable of {id, owner, name, x, z, r}). */
export function claimAt(claims, x, z, pad = 0) {
  let best = null;
  let bestD = Infinity;
  for (const c of claims || []) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d <= (c.r || CLAIM_RADIUS) + pad && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

export function foreignClaimAt(claims, me, x, z, pad = 0) {
  let best = null;
  let bestD = Infinity;
  for (const c of claims || []) {
    if (me != null && c.owner === me) continue;
    const d = Math.hypot(c.x - x, c.z - z);
    if (d <= (c.r || CLAIM_RADIUS) + pad && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** Someone else's claim whose circle comes within `gap` m of the circle (x, z, r). */
export function claimOverlap(claims, me, x, z, r = CLAIM_RADIUS, gap = CLAIM_GAP) {
  for (const c of claims || []) {
    if (me != null && c.owner === me) continue;
    if (Math.hypot(c.x - x, c.z - z) < (c.r || CLAIM_RADIUS) + r + gap) return c;
  }
  return null;
}

/** Normalises a claim record from S.CLAIMS / welcome ({id, owner, name, p:[x,z] | x,z, r}). */
export function normClaim(c) {
  if (!c || c.id == null) return null;
  const x = Number(c.x ?? c.p?.[0]);
  const z = Number(c.z ?? (c.p?.length === 3 ? c.p[2] : c.p?.[1]));
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const decay = Number(c.decay) > 0 ? Math.min(1, Number(c.decay)) : 0; // 0..1 while an absent owner's base decays (§11.2)
  return { id: String(c.id), owner: c.owner ?? null, name: c.name ?? c.ownerName ?? '', x, z, r: Number(c.r) > 0 ? Number(c.r) : CLAIM_RADIUS, decay };
}

/** Loot bundle ({res, ammo, items, credits, weapons|weapon}) → flat list for labels / UI. */
export function bundleList(bundle) {
  const out = [];
  if (!bundle || typeof bundle !== 'object') return out;
  for (const [id, n] of Object.entries(bundle.res || {})) if (int(n)) out.push({ kind: 'res', id, n: int(n) });
  for (const [id, n] of Object.entries(bundle.ammo || {})) if (int(n)) out.push({ kind: 'ammo', id, n: int(n) });
  for (const [id, n] of Object.entries(bundle.items || {})) if (int(n)) out.push({ kind: 'item', id, n: int(n) });
  if (int(bundle.credits)) out.push({ kind: 'credits', id: 'credits', n: int(bundle.credits) });
  const ws = Array.isArray(bundle.weapons) ? bundle.weapons : bundle.weapon ? [bundle.weapon] : [];
  for (const w of ws) if (typeof w === 'string') out.push({ kind: 'weapon', id: w, n: 1 });
  return out;
}

/** m:ss for timers. */
export function clock(sec) {
  const s = Math.max(0, Math.ceil(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Crafting group of a recipe (UI sections). */
export function recipeGroup(r) {
  if (r.upgrade) return 'upgrades';
  if (r.group === 'tools' || ITEMS[Object.keys(r.out?.items || {})[0]]?.tool) return 'tools';
  if (r.group === 'gear' || ITEMS[Object.keys(r.out?.items || {})[0]]?.kind === 'gear') return 'gear';
  if (r.out?.weapon || r.out?.items?.['shock-grenade']) return 'weapons';
  if (r.out?.ammo) return 'ammo';
  return 'supplies';
}

const GROUP_ORDER = { tools: 0, supplies: 1, gear: 2, ammo: 3, weapons: 4, upgrades: 5 };

/** All recipes in display order (tools, supplies, gear, ammo, weapons, upgrades), then by tier. */
export function recipeList() {
  const order = (r) => GROUP_ORDER[recipeGroup(r)] ?? 9;
  return Object.values(RECIPES).sort((a, b) => order(a) - order(b) || (a.tier | 0) - (b.tier | 0));
}
