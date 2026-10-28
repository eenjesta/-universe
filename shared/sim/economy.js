/**
 * Harvesting (C.HARVEST), crafting (C.CRAFT), rewards (C.GRANT) and spending
 * (C.SPEND: market purchases, selling, generic sinks). Server truth; replies
 * with S.HARVESTED / S.FEATURE / S.CRAFTED / S.INV patches (ack = msg.cid) or S.DENY.
 *
 * Harvest nodes (C.HARVEST { node, tool? }): the hub's hand-placed nodes (nodes.js, ids n0…) + the
 * world provider's nodes outside the hub (W.world.nodesNear, stable ids from worldgen / the stand-in).
 * Depleted state: W.nodeState id → respawnAt (ms), pruned when expired. S.HARVESTED goes to players
 * near the node; a client that missed it learns on its own attempt (S.DENY {reason: 'depleted', node,
 * respawnAt}). A tool of tier ≥ 1 that is good at the node's act multiplies the yield (NODE_TOOL_BONUS).
 *
 * World features (C.HARVEST { feature, tool?, hit? }) — the frontier's trees / bushes / rocks /
 * energy-crystal formations (shared/worldgen ids) + mushroom clusters at the foot of forest trees
 * (nodes.js mushroomFor). Rules: shared/defs/tools.js featureRule. Every swing is validated: the
 * feature exists (regenerated from the chunk), outside the safe zone, within reach (+ slack) with
 * terrain line of sight, the tool is owned and of the needed tier, the player's swing rate. Each hit
 * removes tool damage from the feature's HP and pays the hit share of the yield (by damage); the
 * last hit pays the rest (+ bonus / items / chances) and the feature becomes 'felled' | 'broken' |
 * 'picked' until regrowAt. Damaged features heal after HEAL_AFTER s without hits.
 * S.FEATURE { id, state, hp, max, by, tool, dir?: [dx, dz] (from the harvester to the feature),
 * regrowAt?, hit?, got? (what the harvester received) } goes to players near the feature.
 * featureStates() → [[id, state, regrowAt]] for the welcome; exportFeatures() / importFeatures(save)
 * for the world save. The generator is W.worldgen (createSim opts.worldgen) — until the sim keeps it,
 * an identical private copy is created on the first feature harvest (W.world.kind 'worldgen' only).
 */
import { S, NET } from '../protocol.js';
import { RECIPES, RECIPE_RANGE } from '../defs/recipes.js';
import { MARKET, SELL_PRICES, SELL_BACK } from '../defs/market.js';
import { GRANT_CAPS, RESOURCE_IDS, ITEMS } from '../defs/items.js';
import { WEAPONS } from '../defs/weapons.js';
import { HUB } from '../defs/world.js';
import { TOOLS, featureRule, hasTool, toolDamage, HEAL_AFTER, REACH_SLACK } from '../defs/tools.js';
import { NODE_TYPES, NODE_GATHER, NODE_TOOL_BONUS, parseFeatureId, chunkFeatures } from './nodes.js';
import { terrainLOS } from './los.js';
import { createWorldgen } from '../worldgen/index.js';
import { canAfford, pay, gain, giveWeapon, AMMO_MAX } from './inventory.js';
import { randInt, isNum, r2 } from './util.js';

export const HARVEST_RANGE = 4;
const GRANT_SOURCES = new Set(['quest', 'event', 'mission', 'discovery', 'scan', 'achievement']);

const int = (v) => Math.max(0, Math.floor(Number(v) || 0));

export function createEconomy(W) {
  // ------------------------------------------------------------ world features (gathering)
  const feats = new Map(); // id → { s: 'hit'|'felled'|'broken'|'picked', hp, max, acc: {res: frac}, at, regrowAt, by }
  const chunkCache = new Map(); // 'cx,cz' → gatherable-candidate features (LRU)
  let gen; // undefined = not resolved yet, null = no generator (stand-in world)

  function generator() {
    if (gen !== undefined) return gen;
    gen = W.worldgen && typeof W.worldgen.features === 'function' ? W.worldgen : null;
    if (!gen && W.world?.kind === 'worldgen') {
      try {
        // identical to the host's generator: the combined heights equal the hub's inside its extent
        gen = createWorldgen({ seed: W.seed, hub: { heightAt: W.H, isWater: W.isWater, half: HUB.half, radius: HUB.half, blend: HUB.blend } });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[sim] gathering: no world generator', err?.message || err);
        gen = null;
      }
    }
    return gen;
  }

  /** A world feature by id (regenerated from its chunk) or null. */
  function featureById(id) {
    const pid = parseFeatureId(id);
    if (!pid) return null;
    const g = generator();
    if (!g) return null;
    const key = `${pid.cx},${pid.cz}`;
    let list = chunkCache.get(key);
    if (list) {
      chunkCache.delete(key);
      chunkCache.set(key, list);
    } else {
      list = chunkFeatures(g, pid.cx, pid.cz);
      chunkCache.set(key, list);
      if (chunkCache.size > 256) chunkCache.delete(chunkCache.keys().next().value);
    }
    for (const f of list) if (f.id === id) return f;
    return null;
  }

  const fstate = (id, now) => {
    const st = feats.get(id);
    if (!st) return null;
    if ((st.regrowAt && now >= st.regrowAt) || (st.s === 'hit' && now - st.at > HEAL_AFTER * 1000)) {
      feats.delete(id); // regrown / healed
      return null;
    }
    return st;
  };

  function harvestFeature(p, msg) {
    const id = typeof msg.feature === 'string' ? msg.feature : String(msg.feature ?? '');
    const deny = (reason, extra) => W.deny(p, msg, reason, { feature: id, ...extra });
    if (p.dead) return deny('dead');
    if (p.veh) return deny('invalid');
    const f = featureById(id);
    if (!f) return deny('unknown');
    const rule = featureRule(f);
    if (!rule) return deny('invalid');
    if (W.world.isSafe(f.x, f.z)) return deny('safe');
    const now = W.now();
    let st = fstate(id, now);
    if (st && st.s !== 'hit') return deny('depleted', { state: st.s, regrowAt: st.regrowAt });
    // reach + line of sight (terrain): from the eyes to the middle of the feature
    if (Math.hypot(p.x - f.x, p.z - f.z) > rule.reach + REACH_SLACK || Math.abs(p.y - f.y) > 3.5 + (rule.kind === 'rock' ? f.scale || 1 : 0)) return deny('far');
    if (!terrainLOS(W.H, p.x, p.y + 1.6, p.z, f.x, f.y + 0.9, f.z, 0.35)) return deny('blocked');
    // the tool: builtin (hands / multitool) or carried; tier gate (crystals, jungle giants, ore rocks)
    const toolId = typeof msg.tool === 'string' && TOOLS[msg.tool] ? msg.tool : rule.act === 'gather' ? 'hands' : 'multitool';
    if (!hasTool(p.inv, toolId)) return deny('noItem', { tool: toolId });
    const T = TOOLS[toolId];
    const dmg = rule.act === 'gather' ? rule.hp : toolDamage(toolId, rule.act);
    if (rule.act !== 'gather' && (T.tier < rule.tier || !(dmg > 0))) return deny('tool', { need: rule.tier, act: rule.act, tool: toolId });
    // swing rate (latency slack 20 %)
    if (now - (p.gatherAt ?? -1e9) < T.swing * 800) return deny('rate');
    p.gatherAt = now;
    if (!st) {
      st = { s: 'hit', hp: rule.hp, max: rule.hp, acc: {}, at: now, regrowAt: 0, by: p.id };
      feats.set(id, st);
    }
    const d = Math.min(st.hp, dmg);
    st.hp -= d;
    st.at = now;
    st.by = p.id;
    const add = {};
    const y = rule.yield;
    // the hit share of the resources, by damage dealt (fractions carry over)
    if (y.res && rule.hitShare > 0) {
      for (const [k, total] of Object.entries(y.res)) {
        const v = (st.acc[k] || 0) + total * T.yield * rule.hitShare * (d / st.max);
        const n = Math.floor(v);
        st.acc[k] = v - n;
        if (n > 0) add[k] = (add[k] || 0) + n;
      }
    }
    const done = st.hp <= 0;
    if (done) {
      if (y.res) for (const [k, total] of Object.entries(y.res)) {
        const n = Math.round(total * T.yield * (1 - rule.hitShare) + (st.acc[k] || 0));
        if (n > 0) add[k] = (add[k] || 0) + n;
      }
      if (y.bonus) for (const [k, r] of Object.entries(y.bonus)) {
        const n = Math.round(randInt(W.rng, r[0], r[1]) * T.yield);
        if (n > 0) add[k] = (add[k] || 0) + n;
      }
      const items = {};
      if (y.items) for (const [k, r] of Object.entries(y.items)) {
        const n = randInt(W.rng, r[0], r[1]);
        if (n > 0) items[k] = n;
      }
      if (y.chance) for (const [k, pr] of Object.entries(y.chance)) if (W.rng() < pr) items[k] = (items[k] || 0) + 1;
      if (Object.keys(items).length) add.items = items;
      st.s = rule.end;
      st.hp = 0;
      st.acc = {};
      st.regrowAt = now + randInt(W.rng, rule.regrow[0], rule.regrow[1]) * 1000;
    }
    const got = gain(p.inv, add, p.dirty); // unknown item ids (not defined yet) are skipped
    const m = { t: S.FEATURE, id, state: st.s, hp: Math.max(0, Math.round(st.hp)), max: st.max, by: p.id, tool: toolId };
    const dx = f.x - p.x;
    const dz = f.z - p.z;
    const l = Math.hypot(dx, dz);
    if (l > 0.01) m.dir = [r2(dx / l), r2(dz / l)];
    if (done) m.regrowAt = st.regrowAt;
    if (isNum(msg.hit)) m.hit = msg.hit | 0;
    if (got.res || got.items) m.got = { res: got.res, items: got.items };
    W.emit({ near: [f.x, f.z, NET.INTEREST_RADIUS] }, m);
    W.flushInv(p);
    return true;
  }

  /** Felled / broken / picked features: [[id, state, regrowAt]] (welcome). */
  function featureStates() {
    const now = W.now();
    const out = [];
    for (const [id, st] of feats) {
      if (st.s === 'hit' || !(st.regrowAt > now)) continue;
      out.push([id, st.s, st.regrowAt]);
      if (out.length >= 4000) break;
    }
    return out;
  }

  /** World save: { v, list: [[id, state, regrowAt, by]] }. */
  function exportFeatures() {
    const now = W.now();
    const list = [];
    for (const [id, st] of feats) if (st.s !== 'hit' && st.regrowAt > now) list.push([id, st.s, st.regrowAt, st.by || null]);
    return { v: 1, list };
  }

  function importFeatures(save) {
    const list = Array.isArray(save?.list) ? save.list : Array.isArray(save) ? save : [];
    for (const e of list) {
      if (!Array.isArray(e)) continue;
      const [id, s, at, by] = e;
      if (!parseFeatureId(id) || !(s === 'felled' || s === 'broken' || s === 'picked') || !isNum(at)) continue;
      feats.set(id, { s, hp: 0, max: 1, acc: {}, at: 0, regrowAt: at, by: typeof by === 'string' ? by : null });
    }
  }

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
    if (msg.feature !== undefined && msg.feature !== null) return harvestFeature(p, msg);
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
    let amount = randInt(W.rng, T.amount[0], T.amount[1]);
    // a real tool for the job pays more (pickaxe / mining laser on ore, axe on a wood pile)
    const tool = typeof msg.tool === 'string' && TOOLS[msg.tool] && hasTool(p.inv, msg.tool) ? TOOLS[msg.tool] : null;
    const act = NODE_GATHER[node.type]?.act || 'mine';
    if (tool && tool.tier > 0 && (tool.power[act] || 0) >= 2) amount = Math.round(amount * (NODE_TOOL_BONUS[tool.tier] || 1));
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

  /** Forgets nodes / features that have respawned or healed (keeps the maps bounded in an infinite world). */
  function prune() {
    const now = W.now();
    for (const [id, at] of W.nodeState) if (at <= now) W.nodeState.delete(id);
    for (const id of [...feats.keys()]) fstate(id, now);
  }

  return {
    harvest,
    craft,
    grant,
    spend,
    prune,
    findNode,
    weapons: WEAPONS,
    featureById,
    featureStates,
    exportFeatures,
    importFeatures,
    /** Current state of a feature ({ s, hp, max, regrowAt, by } | null) — tests / debugging. */
    featureState: (id) => fstate(id, W.now()),
    get generator() {
      return generator();
    },
  };
}
