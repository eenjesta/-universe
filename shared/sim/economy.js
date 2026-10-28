/**
 * Harvesting (C.HARVEST), crafting (C.CRAFT), rewards (C.GRANT) and spending
 * (C.SPEND: market purchases, selling, generic sinks). Server truth; replies
 * with S.HARVESTED / S.CRAFTED / S.INV patches (ack = msg.cid) or S.DENY.
 *
 * Harvest nodes: the hub's hand-placed nodes (nodes.js, ids n0…) + the world
 * provider's nodes outside the hub (W.world.nodesNear, stable ids from
 * worldgen / the stand-in). Depleted state: W.nodeState id → respawnAt (ms),
 * pruned when expired. S.HARVESTED goes to players near the node; a client that
 * missed it learns on its own attempt (S.DENY {reason: 'depleted', node, respawnAt}).
 */
import { S, NET } from '../protocol.js';
import { RECIPES, RECIPE_RANGE } from '../defs/recipes.js';
import { MARKET, SELL_PRICES, SELL_BACK } from '../defs/market.js';
import { GRANT_CAPS, RESOURCE_IDS, ITEMS } from '../defs/items.js';
import { WEAPONS } from '../defs/weapons.js';
import { NODE_TYPES } from './nodes.js';
import { canAfford, pay, gain, giveWeapon, AMMO_MAX } from './inventory.js';
import { randInt, isNum } from './util.js';

export const HARVEST_RANGE = 4;
const GRANT_SOURCES = new Set(['quest', 'event', 'mission', 'discovery', 'scan', 'achievement']);

const int = (v) => Math.max(0, Math.floor(Number(v) || 0));

export function createEconomy(W) {
  // ------------------------------------------------------------ harvest
  /** A hub node by id, or a world node near the player. */
  function findNode(p, id) {
    const hub = W.nodeById.get(id);
    if (hub) return hub;
    if (typeof id !== 'string' || !id) return null;
    for (const n of W.world.nodesNear(p.x, p.z, HARVEST_RANGE + 8)) if (n.id === id) return n;
    return null;
  }

  function harvest(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    const node = findNode(p, msg.node);
    if (!node) return W.deny(p, msg, 'unknown', { node: msg.node });
    const now = W.now();
    const until = W.nodeState.get(node.id) || 0;
    if (now < until) return W.deny(p, msg, 'depleted', { node: node.id, respawnAt: until });
    if (Math.hypot(p.x - node.x, p.z - node.z) > HARVEST_RANGE || Math.abs(p.y - node.y) > 4) return W.deny(p, msg, 'far', { node: node.id });
    // the hub is a safe social space (PLATFORM.md §11): no gathering there
    if (W.world.isSafe(node.x, node.z)) return W.deny(p, msg, 'safe', { node: node.id });
    if (now - p.harvestAt < 900) return W.deny(p, msg, 'rate', { node: node.id });
    const T = NODE_TYPES[node.type];
    const amount = randInt(W.rng, T.amount[0], T.amount[1]);
    const got = gain(p.inv, { [T.resource]: amount }, p.dirty);
    const respawnIn = randInt(W.rng, T.respawn[0], T.respawn[1]);
    const respawnAt = now + respawnIn * 1000;
    W.nodeState.set(node.id, respawnAt);
    p.harvestAt = now;
    W.emit({ near: [node.x, node.z, NET.INTEREST_RADIUS] }, { t: S.HARVESTED, node: node.id, by: p.id, res: got.res || { [T.resource]: 0 }, respawnAt, respawnIn });
    W.flushInv(p);
    return true;
  }

  // ------------------------------------------------------------ craft
  function craft(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    const r = RECIPES[msg.recipe];
    if (!r) return W.deny(p, msg, 'unknown');
    let n = Math.max(1, Math.min(r.max || 1, int(msg.n) || 1));
    // tier 0 = craftable anywhere; tier ≥ 1 needs a workbench of at least that tier within RECIPE_RANGE
    if (r.tier > 0 && !W.build.workbenchNear(p.x, p.y, p.z, RECIPE_RANGE, r.tier)) {
      return W.deny(p, msg, r.tier > 1 && W.build.workbenchNear(p.x, p.y, p.z, RECIPE_RANGE, 1) ? 'tier' : 'workbench');
    }
    if (r.upgrade) {
      // the nearest own tier-1 workbench becomes a Workbench Mk II
      let own = null;
      W.build.forNear(p.x, p.z, RECIPE_RANGE + 2, (rec) => {
        if (rec.type === r.upgrade && rec.owner === p.id && Math.hypot(rec.x - p.x, rec.z - p.z) <= RECIPE_RANGE) own = rec;
        return !!own;
      });
      if (!own) return W.deny(p, msg, 'workbench');
      if (!canAfford(p.inv, r.cost)) return W.deny(p, msg, 'cost');
      pay(p.inv, r.cost, p.dirty);
      W.build.upgrade(own, 'workbench-2');
      W.emit(p.id, { t: S.CRAFTED, recipe: r.id, n: 1, structure: own.id });
      W.flushInv(p, msg.cid);
      return true;
    }
    const out = r.out || {};
    if (out.weapon) {
      if (p.inv.weapons.includes(out.weapon)) return W.deny(p, msg, 'owned');
      n = 1;
    }
    // clamp n to what fits (the last craft may top up to the carry limit)
    for (const [a, k] of Object.entries(out.ammo || {})) n = Math.min(n, Math.ceil(Math.max(0, AMMO_MAX[a] - p.inv.ammo[a]) / k));
    for (const [i, k] of Object.entries(out.items || {})) n = Math.min(n, Math.ceil(Math.max(0, ITEMS[i].max - (p.inv.items[i] || 0)) / k));
    if (n <= 0) return W.deny(p, msg, 'full');
    const cost = {};
    for (const [k, v] of Object.entries(r.cost)) cost[k] = v * n;
    if (!canAfford(p.inv, cost)) return W.deny(p, msg, 'cost');
    pay(p.inv, cost, p.dirty);
    if (out.weapon) giveWeapon(p.inv, out.weapon, p.dirty);
    const scaled = {};
    if (out.ammo) scaled.ammo = Object.fromEntries(Object.entries(out.ammo).map(([k, v]) => [k, v * n]));
    if (out.items) scaled.items = Object.fromEntries(Object.entries(out.items).map(([k, v]) => [k, v * n]));
    gain(p.inv, scaled, p.dirty);
    W.emit(p.id, { t: S.CRAFTED, recipe: r.id, n });
    W.flushInv(p, msg.cid);
    return true;
  }

  // ------------------------------------------------------------ grant
  function budgetLeft(p, now) {
    // the in-browser LocalServer (offline single-player) has no hourly budget, only per-grant caps
    if (W.trusted) return { credits: Infinity, res: Infinity };
    const hourAgo = now - 3600 * 1000;
    while (p.grantLog.length && p.grantLog[0].t < hourAgo) p.grantLog.shift();
    let credits = 0;
    let res = 0;
    for (const g of p.grantLog) {
      credits += g.credits;
      res += g.res;
    }
    return { credits: Math.max(0, GRANT_CAPS.hourCredits - credits), res: Math.max(0, GRANT_CAPS.hourRes - res) };
  }

  /** C.GRANT {source, id, amounts: {credits, metal, …, items: [unlock ids]}} — once per id, capped. */
  function grant(p, msg) {
    const source = String(msg.source || '');
    const id = String(msg.id ?? '').slice(0, 64);
    if (!GRANT_SOURCES.has(source) || !id) return W.deny(p, msg, 'invalid');
    const key = `${source}:${id}`;
    if (p.grants.has(key)) return W.deny(p, msg, 'granted');
    const now = W.now();
    const left = budgetLeft(p, now);
    const a = msg.amounts && typeof msg.amounts === 'object' ? msg.amounts : {};
    const add = {};
    let credits = Math.min(int(a.credits), GRANT_CAPS.credits, left.credits);
    if (credits > 0) add.credits = credits;
    let resTotal = 0;
    const res = a.res && typeof a.res === 'object' ? { ...a, ...a.res } : a;
    for (const r of RESOURCE_IDS) {
      const n = Math.min(int(res[r]), GRANT_CAPS.res, left.res - resTotal);
      if (n > 0) {
        add[r] = n;
        resTotal += n;
      }
    }
    const got = gain(p.inv, add, p.dirty);
    const unlocked = [];
    if (source === 'quest' && Array.isArray(a.items)) {
      for (const it of a.items) {
        if (typeof it === 'string' && GRANT_CAPS.items.includes(it) && MARKET[it] && !p.inv.unlocks.includes(it)) {
          p.inv.unlocks.push(it);
          unlocked.push(it);
          p.dirty.add('unlocks');
        }
      }
    }
    p.grants.add(key);
    if (p.grants.size > GRANT_CAPS.maxIds) p.grants.delete(p.grants.values().next().value);
    p.grantLog.push({ t: now, credits: got.credits || 0, res: Object.values(got.res || {}).reduce((s, v) => s + v, 0) });
    W.flushInv(p, msg.cid ?? key);
    return true;
  }

  // ------------------------------------------------------------ spend
  /**
   * C.SPEND
   *   {reason: 'market', id: itemId, cost?: {credits}}   buy (price from shared/defs/market.js)
   *   {reason: 'sell', id: resource, cost: {[resource]: n}} sell resources for credits
   *   {reason: 'sell', id: unlockId}                      sell an owned unlock back (50 %)
   *   {reason: <other>, id?, cost}                        generic sink (validated + paid)
   */
  function spend(p, msg) {
    const reason = String(msg.reason || '');
    const cost = msg.cost && typeof msg.cost === 'object' ? msg.cost : {};
    if (reason === 'market') {
      const it = MARKET[msg.id];
      if (!it) return W.deny(p, msg, 'unknown');
      if (isNum(cost.credits) && Math.round(cost.credits) !== it.price) return W.deny(p, msg, 'price', { price: it.price });
      if (!it.give && p.inv.unlocks.includes(it.id)) return W.deny(p, msg, 'owned');
      if (p.inv.credits < it.price) return W.deny(p, msg, 'credits');
      pay(p.inv, { credits: it.price }, p.dirty);
      if (it.give) gain(p.inv, it.give, p.dirty);
      else {
        p.inv.unlocks.push(it.id);
        p.dirty.add('unlocks');
      }
      W.flushInv(p, msg.cid ?? msg.id);
      return true;
    }
    if (reason === 'sell') {
      const id = String(msg.id || '').replace(/^res-/, '');
      if (SELL_PRICES[id] !== undefined) {
        const n = int(cost[id] ?? msg.n);
        if (n <= 0) return W.deny(p, msg, 'invalid');
        if (p.inv.res[id] < n) return W.deny(p, msg, 'cost');
        p.inv.res[id] -= n;
        p.dirty.add('res');
        gain(p.inv, { credits: Math.round(n * SELL_PRICES[id]) }, p.dirty);
        W.flushInv(p, msg.cid ?? msg.id);
        return true;
      }
      const it = MARKET[msg.id];
      if (!it || it.give) return W.deny(p, msg, 'unknown');
      const k = p.inv.unlocks.indexOf(it.id);
      if (k < 0) return W.deny(p, msg, 'noItem');
      p.inv.unlocks.splice(k, 1);
      p.dirty.add('unlocks');
      gain(p.inv, { credits: Math.round(it.price * SELL_BACK) }, p.dirty);
      W.flushInv(p, msg.cid ?? msg.id);
      return true;
    }
    if (!reason || reason.length > 32) return W.deny(p, msg, 'invalid');
    const c = {};
    for (const k of ['credits', ...RESOURCE_IDS]) if (int(cost[k]) > 0) c[k] = int(cost[k]);
    if (!Object.keys(c).length) return W.deny(p, msg, 'invalid');
    if (!canAfford(p.inv, c)) return W.deny(p, msg, c.credits && p.inv.credits < c.credits ? 'credits' : 'cost');
    pay(p.inv, c, p.dirty);
    W.flushInv(p, msg.cid ?? msg.id ?? reason);
    return true;
  }

  /** Forgets nodes that have respawned (keeps the depleted map bounded in an infinite world). */
  function prune() {
    const now = W.now();
    for (const [id, at] of W.nodeState) if (at <= now) W.nodeState.delete(id);
  }

  return { harvest, craft, grant, spend, prune, findNode, weapons: WEAPONS };
}
