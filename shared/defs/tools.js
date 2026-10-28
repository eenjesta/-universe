/**
 * Gathering tools + world-feature harvest rules (owned by the gathering engineer).
 * TOOL_ITEMS are merged into ITEMS (items.js) and TOOL_RECIPES into RECIPES (recipes.js),
 * so tools live in this one file. Pure data + tiny pure helpers (server sim AND client).
 *
 * Contextual use (no hotbar slot): look at a tree / rock / plant and hold the action — the
 * client picks the best owned tool for it (bestTool) and swings it; the server validates
 * every swing (shared/sim/economy.js, C.HARVEST { feature, tool, hit }).
 *
 *   TOOLS[id] = { id, name, tier, power: { chop, mine, gather }, swing (s per swing — matches the characters
 *                 module's action timing, src/characters/tool-actions.js; the server allows ≥ 80 % of it), yield (×),
 *                 builtin (everyone has it, no item), grip (ctx.player.holdTool grip), action (playAction) }
 *   damage per swing = power[act] × DMG (HP); a feature needs tool.tier ≥ rule.tier.
 *
 * World features (shared/worldgen ids): 't:cx:cz:k' trees, 'b:…' bushes, 'r:…' rocks, 'c:…' energy-crystal
 * formations, plus 'm:cx:cz:k' mushroom clusters derived from forest / jungle trees (shared/sim/nodes.js).
 * featureRule(f) → the harvest rule of one feature or null (scenery):
 *   { kind, act: 'chop'|'mine'|'gather', tier, hp,
 *     yield: { res: {wood: n} (total, × tool.yield; hitShare of it paid per hit by damage, the rest on completion),
 *              bonus: {metal: [a, b]} (completion, × tool.yield), items: {berries: [a, b]} (completion),
 *              chance: {'crystal-shard': p} (completion) },
 *     hitShare, regrow: [min, max] s, end: 'felled'|'broken'|'picked', reach (m, from the feature centre),
 *     hidesBase (the base instance disappears; false for berry bushes: only the crop goes) }
 */

/** HP of damage per unit of tool power. */
export const DMG = 10;

export const TOOLS = {
  hands: {
    id: 'hands',
    name: { en: 'Hands', nl: 'Handen' },
    tier: 0,
    power: { gather: 1, chop: 0, mine: 0 },
    swing: 0.8,
    yield: 1,
    builtin: true,
    grip: null,
    action: 'gather',
  },
  multitool: {
    id: 'multitool',
    name: { en: 'Ø Multitool', nl: 'Ø-multitool' },
    desc: { en: 'Everyone carries one: chops and mines slowly. Craft an axe and a pickaxe!', nl: 'Iedereen heeft er een: hakt en delft langzaam. Maak een bijl en een houweel!' },
    tier: 0,
    power: { chop: 1, mine: 1, gather: 1 },
    swing: 0.9,
    yield: 0.7,
    builtin: true,
    grip: 'multitool',
    color: '#9fd8ff',
  },
  axe: {
    id: 'axe',
    name: { en: 'Axe', nl: 'Bijl' },
    desc: { en: 'Fells trees fast. Hold E (or click) while looking at a tree.', nl: 'Velt bomen snel. Houd E vast (of klik) terwijl je naar een boom kijkt.' },
    tier: 1,
    power: { chop: 2.5, mine: 0.6, gather: 1 },
    swing: 0.9,
    yield: 1,
    grip: 'axe',
    color: '#e0a868',
  },
  pickaxe: {
    id: 'pickaxe',
    name: { en: 'Pickaxe', nl: 'Houweel' },
    desc: { en: 'Breaks rocks and ore — metal from shards, outcrops and red hoodoos.', nl: 'Breekt rotsen en erts — metaal uit splinters, rotspartijen en rode hoodoos.' },
    tier: 1,
    power: { chop: 0.6, mine: 2.5, gather: 1 },
    swing: 1.0,
    yield: 1,
    grip: 'pickaxe',
    color: '#c9d2dc',
  },
  'plasma-axe': {
    id: 'plasma-axe',
    name: { en: 'Plasma axe', nl: 'Plasmabijl' },
    desc: { en: 'A glowing edge: fells even jungle giants in a few swings, more wood per tree.', nl: 'Een gloeiende snede: velt zelfs junglereuzen in een paar slagen, meer hout per boom.' },
    tier: 2,
    power: { chop: 4.5, mine: 1, gather: 1 },
    swing: 0.74,
    yield: 1.25,
    grip: 'axe',
    color: '#ff9a4a',
  },
  'mining-laser': {
    id: 'mining-laser',
    name: { en: 'Mining laser', nl: 'Mijnlaser' },
    desc: { en: 'Cuts energy-crystal formations (crystal shards!) and any rock in pulses.', nl: 'Snijdt energiekristallen (kristalscherven!) en elke rots in pulsen.' },
    tier: 2,
    power: { chop: 1, mine: 4.5, gather: 1 },
    swing: 0.7,
    yield: 1.25,
    grip: 'laser',
    color: '#5fe0ff',
  },
};

/** Crafted tools in preference order per act (best first). */
export const TOOL_ORDER = {
  chop: ['plasma-axe', 'axe', 'mining-laser', 'multitool'],
  mine: ['mining-laser', 'pickaxe', 'plasma-axe', 'multitool'],
  gather: ['hands'],
};

/** Inventory items (merged into ITEMS): one of each tool. */
export const TOOL_ITEMS = Object.fromEntries(
  ['axe', 'pickaxe', 'plasma-axe', 'mining-laser'].map((id) => [
    id,
    { id, name: TOOLS[id].name, desc: TOOLS[id].desc, max: 1, tool: true, tier: TOOLS[id].tier, icon: `tool-${id}` },
  ]),
);

/**
 * Recipes (merged into RECIPES). Axe + pickaxe are field crafts (tier 0: anywhere — the very first
 * thing a new survivor makes, from the start resources); the tier-2 tools need a workbench.
 */
export const TOOL_RECIPES = {
  axe: { id: 'axe', name: { en: 'Axe', nl: 'Bijl' }, cost: { wood: 12, stone: 8, metal: 4 }, out: { items: { axe: 1 } }, tier: 0, max: 1, group: 'tools' },
  pickaxe: { id: 'pickaxe', name: { en: 'Pickaxe', nl: 'Houweel' }, cost: { wood: 10, stone: 12, metal: 6 }, out: { items: { pickaxe: 1 } }, tier: 0, max: 1, group: 'tools' },
  'plasma-axe': { id: 'plasma-axe', name: { en: 'Plasma axe', nl: 'Plasmabijl' }, cost: { metal: 40, energy: 25, wood: 10 }, out: { items: { 'plasma-axe': 1 } }, tier: 1, max: 1, group: 'tools' },
  'mining-laser': { id: 'mining-laser', name: { en: 'Mining laser', nl: 'Mijnlaser' }, cost: { metal: 50, energy: 30, stone: 10 }, out: { items: { 'mining-laser': 1 } }, tier: 1, max: 1, group: 'tools' },
};

/** Does an inventory ({items}) own a tool? Builtin tools always. */
export function hasTool(inv, id) {
  const T = TOOLS[id];
  if (!T) return false;
  if (T.builtin) return true;
  return (inv?.items?.[id] || 0) > 0;
}

/** The best owned tool for an act ('chop' | 'mine' | 'gather') that meets `tier` (or the best owned at all). */
export function bestTool(inv, act, tier = 0) {
  const order = TOOL_ORDER[act] || TOOL_ORDER.mine;
  let any = null;
  for (const id of order) {
    if (!hasTool(inv, id)) continue;
    if (TOOLS[id].tier >= tier && (TOOLS[id].power[act] || 0) > 0) return id;
    if (!any) any = id;
  }
  return any || (act === 'gather' ? 'hands' : 'multitool');
}

/** Damage of one swing (HP). */
export function toolDamage(toolId, act) {
  const T = TOOLS[toolId];
  return T ? (T.power[act] || 0) * DMG : 0;
}

/** Least tool tier that can do `act` at `tier` — the tool name players need (for "Needs a …" texts). */
export function toolNeeded(act, tier) {
  for (const id of [...(TOOL_ORDER[act] || [])].reverse()) {
    const T = TOOLS[id];
    if (T.tier >= tier && (T.power[act] || 0) >= 2) return id;
  }
  return act === 'chop' ? 'axe' : 'pickaxe';
}

// ------------------------------------------------------------------ feature rules
/** Trees: base hp, tier, wood at scale 1, extras on felling. */
const TREES = {
  pineTall: { hp: 110, wood: 16 },
  pineMid: { hp: 90, wood: 12 },
  spruce: { hp: 75, wood: 10 },
  oak: { hp: 120, wood: 16 },
  birch: { hp: 85, wood: 12 },
  acacia: { hp: 80, wood: 10 },
  jungleTree: { hp: 220, wood: 28, tier: 1 },
  palm: { hp: 70, wood: 9, items: { 'jungle-fruit': [1, 2] } },
};
/** Rocks (scale ranges differ a lot: outcrops 2.4–5.5, pebbles 0.3–0.7). */
const ROCKS = {
  boulder: { hp: 70, stone: [4, 5], tier: 0 },
  slab: { hp: 60, stone: [4, 4], tier: 0 },
  shard: { hp: 85, stone: [3, 3], metal: [1, 3], tier: 1 },
  outcrop: { hp: 150, stone: [8, 4], metal: [2, 5], tier: 1 },
  hoodoo: { hp: 110, stone: [6, 4], metal: [3, 6], tier: 1 },
  pebble: { gather: true, stone: [1, 3] },
};
/** Bush variants that are gatherable plants (share = fraction of that variant that carries a crop). */
const PLANTS = {
  bushGreen: { share: 0.55, items: { berries: [2, 4] }, regrow: [360, 600], keep: true, crop: 'berries-red' },
  bushJuniper: { share: 0.4, items: { berries: [1, 3] }, regrow: [420, 720], keep: true, crop: 'berries-blue' },
  fern: { share: 1, items: { fiber: [1, 3] }, regrow: [240, 420] },
  tropic: { share: 1, items: { fiber: [2, 3] }, regrow: [300, 480] },
  glowPlant: { share: 1, items: { 'jungle-fruit': [1, 2], fiber: [0, 1] }, regrow: [480, 720] },
};
export const PLANT_VARIANTS = PLANTS;
/** Mushroom clusters at the foot of forest / jungle trees (derived features 'm:…', see mushroomFor). */
export const MUSHROOMS = { share: 0.16, biomes: ['forest', 'jungle'], items: { mushroom: [1, 3] }, regrow: [360, 600] };

/** Regrowth windows (s): trees 20–40 min, rocks 15–25 min, crystals 25–40 min. */
export const REGROW = { tree: [1200, 2400], rock: [900, 1500], pebble: [300, 480], crystal: [1500, 2400] };
/** Fraction of the regrow time at the end during which the feature visibly grows back. */
export const GROW_PHASE = { tree: 0.3, rock: 0.2, crystal: 0.25, plant: 0.45, mushroom: 0.5, pebble: 0.3 };
/** A damaged feature heals completely when nobody hits it for this long (s). */
export const HEAL_AFTER = 75;
/** Server reach tolerance on top of the rule's reach (latency, capsule radius). */
export const REACH_SLACK = 1.6;

/**
 * Deterministic 0..1 per feature id (FNV-1a) — which bushes carry berries, which trees grow
 * mushrooms. Same on server and client.
 */
export function idHash01(id, salt = 0) {
  let h = 0x811c9dc5 ^ salt;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const lerpI = (r, k) => [Math.round(r[0] * k), Math.round(r[1] * k)];

/**
 * The harvest rule of a world feature ({ id, type, variant, scale, biome }) or null when it is
 * scenery. Kinds: 'tree' | 'rock' | 'pebble' | 'crystal' | 'plant' | 'berries' | 'mushroom'.
 */
export function featureRule(f) {
  if (!f || typeof f !== 'object') return null;
  const s = Number.isFinite(f.scale) ? f.scale : 1;
  if (f.type === 'tree') {
    const T = TREES[f.variant] || TREES.pineMid;
    const k = 0.6 + 0.4 * s;
    return {
      kind: 'tree',
      act: 'chop',
      tier: T.tier || 0,
      hp: Math.round(T.hp * k),
      yield: { res: { wood: Math.max(4, Math.round(T.wood * s)) }, bonus: null, items: T.items || null, chance: null },
      hitShare: 0.35,
      regrow: REGROW.tree,
      end: 'felled',
      reach: 2.6 + 0.5 * s,
      hidesBase: true,
    };
  }
  if (f.type === 'rock') {
    const R = ROCKS[f.variant] || ROCKS.boulder;
    if (R.gather) {
      return { kind: 'pebble', act: 'gather', tier: 0, hp: 1, yield: { res: null, bonus: { stone: R.stone }, items: null, chance: null }, hitShare: 0, regrow: REGROW.pebble, end: 'picked', reach: 2.4, hidesBase: true };
    }
    const size = f.variant === 'outcrop' ? s / 3 : s;
    const res = { stone: Math.max(2, Math.round(R.stone[0] * size + R.stone[1])) };
    const rule = {
      kind: 'rock',
      act: 'mine',
      tier: R.tier,
      hp: Math.round(R.hp * (0.55 + 0.45 * size)),
      yield: { res, bonus: R.metal ? { metal: lerpI(R.metal, Math.max(0.6, Math.min(1.6, size))) } : null, items: null, chance: null },
      hitShare: 0.35,
      regrow: REGROW.rock,
      end: 'broken',
      reach: 2.4 + rockRadius(f.variant, s),
      hidesBase: true,
    };
    return rule;
  }
  if (f.type === 'crystal') {
    return {
      kind: 'crystal',
      act: 'mine',
      tier: 2,
      hp: Math.round(120 * (0.6 + 0.4 * s)),
      yield: { res: { energy: Math.round(8 + 5 * s) }, bonus: null, items: null, chance: { 'crystal-shard': 0.35 + 0.2 * Math.min(1, Math.max(0, (s - 0.9) / 1.5)) } },
      hitShare: 0.3,
      regrow: REGROW.crystal,
      end: 'broken',
      reach: 2.8 + 0.6 * s,
      hidesBase: true,
    };
  }
  if (f.type === 'bush') {
    const P = PLANTS[f.variant];
    if (!P) return null;
    if (P.share < 1 && idHash01(f.id, 0x5eed) >= P.share) return null;
    return {
      kind: P.keep ? 'berries' : 'plant',
      act: 'gather',
      tier: 0,
      hp: 1,
      yield: { res: null, bonus: null, items: P.items, chance: null },
      hitShare: 0,
      regrow: P.regrow,
      end: 'picked',
      reach: 2.2 + 0.6 * s,
      hidesBase: !P.keep,
      crop: P.crop || null,
    };
  }
  if (f.type === 'mushroom') {
    return { kind: 'mushroom', act: 'gather', tier: 0, hp: 1, yield: { res: null, bonus: null, items: MUSHROOMS.items, chance: null }, hitShare: 0, regrow: MUSHROOMS.regrow, end: 'picked', reach: 2.2, hidesBase: true };
  }
  return null;
}

/** Rough horizontal radius of a rock variant at a scale (m) — reach / targeting. */
export function rockRadius(variant, s = 1) {
  const r = { boulder: 0.9, slab: 1.1, shard: 0.6, outcrop: 1.6, hoodoo: 0.9, pebble: 0.4 }[variant] ?? 0.9;
  return r * s;
}

/** Player-facing verbs / names for the context prompt ("Hold E — Chop tree"). */
export const GATHER_TEXT = {
  chop: { en: 'Chop', nl: 'Hakken' },
  mine: { en: 'Mine', nl: 'Delven' },
  pick: { en: 'Pick', nl: 'Plukken' },
  tree: { en: 'Chop tree', nl: 'Boom hakken' },
  rock: { en: 'Mine rock', nl: 'Rots hakken' },
  ore: { en: 'Mine ore', nl: 'Erts delven' },
  crystal: { en: 'Mine crystal', nl: 'Kristal delven' },
  pebble: { en: 'Pick up stones', nl: 'Stenen oprapen' },
  berries: { en: 'Pick berries', nl: 'Bessen plukken' },
  fiber: { en: 'Gather fiber', nl: 'Vezels plukken' },
  fruit: { en: 'Pick glowfruit', nl: 'Gloeivrucht plukken' },
  mushroom: { en: 'Pick mushrooms', nl: 'Paddenstoelen plukken' },
  node: { en: 'Harvest', nl: 'Oogsten' },
  needs: { en: 'Needs a {tool}', nl: 'Heeft een {tool} nodig' },
  with: { en: 'with {tool}', nl: 'met {tool}' },
};

/** Deny reasons of gathering (texts; shared/defs/reasons.js has the generic ones). */
export const GATHER_REASONS = {
  tool: { en: 'Needs a better tool', nl: 'Heeft beter gereedschap nodig' },
  blocked: { en: 'Can’t reach that', nl: 'Daar kun je niet bij' },
  depleted: { en: 'Already harvested — it grows back', nl: 'Al geoogst — het groeit terug' },
  safe: { en: 'No gathering in the safe zone', nl: 'Niet verzamelen in de veilige zone' },
  far: { en: 'Too far away', nl: 'Te ver weg' },
};

// ------------------------------------------------------------------ feature ids (server + client + worker)
const FEATURE_ID = /^([tbrcm]):(-?\d{1,7}):(-?\d{1,7}):(\d{1,4})$/;
const FEATURE_TYPE = { t: 'tree', b: 'bush', r: 'rock', c: 'crystal', m: 'mushroom' };
export const FEATURE_PREFIX = { tree: 't', bush: 'b', rock: 'r', crystal: 'c', mushroom: 'm' };

/** 't:12:-40:33' → { prefix: 't', type: 'tree', cx: 12, cz: -40, k: 33 } | null. */
export function parseFeatureId(id) {
  if (typeof id !== 'string' || id.length > 32) return null;
  const m = FEATURE_ID.exec(id);
  if (!m) return null;
  return { prefix: m[1], type: FEATURE_TYPE[m[1]], cx: +m[2], cz: +m[3], k: +m[4] };
}

/**
 * The mushroom cluster growing at the foot of a forest / jungle tree (or null): id 'm:<cx>:<cz>:<k>'
 * (same chunk + index as the tree), 0.9–1.6 m from the trunk, on the ground (H = combined heights).
 */
export function mushroomFor(tree, H) {
  if (!tree || tree.type !== 'tree' || !MUSHROOMS.biomes.includes(tree.biome)) return null;
  if (idHash01(tree.id, 0x6d75) >= MUSHROOMS.share) return null;
  const a = idHash01(tree.id, 0x616e) * Math.PI * 2;
  const r = (0.9 + 0.7 * idHash01(tree.id, 0x7261)) * Math.max(0.8, tree.scale || 1);
  const x = tree.x + Math.cos(a) * r;
  const z = tree.z + Math.sin(a) * r;
  const y = typeof H === 'function' ? H(x, z) : tree.y;
  return {
    id: `m${tree.id.slice(1)}`,
    type: 'mushroom',
    variant: tree.biome === 'jungle' ? 1 : 0, // 1 = glowing (jungle)
    x,
    y,
    z,
    rot: a * 3.7,
    scale: 0.8 + 0.5 * idHash01(tree.id, 0x7363),
    biome: tree.biome,
  };
}

/**
 * Every gatherable-candidate feature of a chunk: the generator's trees / bushes / rocks /
 * crystals (no nodes / POIs) + the derived mushroom clusters. gen = a createWorldgen() instance.
 */
export function chunkFeatures(gen, cx, cz) {
  const out = [];
  const list = typeof gen?.features === 'function' ? gen.features(cx, cz) : [];
  const H = typeof gen?.heightAt === 'function' ? (x, z) => gen.heightAt(x, z) : null;
  for (const f of list) {
    if (f.type !== 'tree' && f.type !== 'bush' && f.type !== 'rock' && f.type !== 'crystal') continue;
    out.push(f);
    if (f.type === 'tree') {
      const m = mushroomFor(f, H);
      if (m) out.push(m);
    }
  }
  return out;
}
