import { sstep } from './noise.js';
import { S_T, S_T0, S_M, S_C, S_PLAT, S_MM, S_BAD, S_RIVER, S_LAKE, S_JUNGLE } from './terrain.js';

/**
 * Biomes of the procedural planet: bilingual names, minimap colours, what grows
 * and lies there (feature recipes), which resources and which enemies.
 * Index order is the Uint8 id used in chunk grids (`BIOME_LIST[i].id`).
 *
 * Vegetation variant names are the plant library of src/world/terrain/plants.js
 * (pineTall, pineMid, spruce, oak, birch, acacia, jungleTree, palm, bushGreen,
 * bushJuniper, fern, tropic, glowPlant); rock variants: boulder, slab, shard,
 * outcrop, hoodoo, pebble.
 */
export const BIOME_LIST = [
  {
    id: 'ocean',
    name: { en: 'Open Sea', nl: 'Open zee' },
    color: [0.11, 0.3, 0.42],
    trees: 0, bushes: 0, rocks: 0, nodes: 0,
  },
  {
    id: 'coast',
    name: { en: 'Azure Coast', nl: 'Azuurkust' },
    color: [0.86, 0.78, 0.58],
    trees: 0.05, treeMix: [['palm', 6], ['acacia', 1]],
    bushes: 0.07, bushMix: [['bushGreen', 2], ['tropic', 2], ['bushJuniper', 1]],
    rocks: 0.035, rockMix: [['boulder', 3], ['slab', 2], ['pebble', 3]],
    nodes: 0.55, nodeMix: [['stone', 4], ['wood', 3], ['metal', 1]],
    grass: 0.25,
  },
  {
    id: 'meadow',
    name: { en: 'Golden Meadows', nl: 'Gouden Weiden' },
    color: [0.78, 0.66, 0.33],
    trees: 0.055, treeMix: [['oak', 4], ['birch', 2], ['acacia', 2], ['pineMid', 1]],
    bushes: 0.09, bushMix: [['bushGreen', 3], ['bushJuniper', 1], ['fern', 1]],
    rocks: 0.025, rockMix: [['boulder', 3], ['slab', 2], ['pebble', 3], ['outcrop', 1]],
    nodes: 0.75, nodeMix: [['stone', 3], ['wood', 3], ['metal', 1], ['energy', 1]],
    grass: 1,
  },
  {
    id: 'forest',
    name: { en: 'Lumen Forest', nl: 'Lumenwoud' },
    color: [0.2, 0.36, 0.17],
    trees: 0.5, treeMix: [['pineTall', 4], ['pineMid', 4], ['spruce', 2], ['oak', 2], ['birch', 1]],
    bushes: 0.24, bushMix: [['bushGreen', 2], ['fern', 3], ['bushJuniper', 1], ['glowPlant', 1]],
    rocks: 0.04, rockMix: [['boulder', 3], ['slab', 1], ['pebble', 2], ['outcrop', 1]],
    nodes: 0.9, nodeMix: [['wood', 5], ['stone', 2], ['metal', 1], ['energy', 1]],
    grass: 0.5, glow: 0.6,
  },
  {
    id: 'jungle',
    name: { en: 'Lumen Wilds', nl: 'Lumen-wildernis' },
    color: [0.13, 0.33, 0.2],
    trees: 0.55, treeMix: [['jungleTree', 6], ['palm', 2], ['birch', 1]],
    bushes: 0.4, bushMix: [['tropic', 4], ['fern', 3], ['glowPlant', 2], ['bushGreen', 1]],
    rocks: 0.03, rockMix: [['boulder', 3], ['outcrop', 1], ['pebble', 2]],
    nodes: 0.9, nodeMix: [['wood', 4], ['energy', 2], ['stone', 1], ['metal', 1]],
    grass: 0.45, glow: 1,
  },
  {
    id: 'highlands',
    name: { en: 'Crystal Highlands', nl: 'Kristalhooglanden' },
    color: [0.55, 0.58, 0.55],
    trees: 0.04, treeMix: [['spruce', 3], ['pineMid', 2], ['birch', 1]],
    bushes: 0.06, bushMix: [['bushJuniper', 3], ['bushGreen', 1]],
    rocks: 0.13, rockMix: [['boulder', 3], ['slab', 3], ['shard', 2], ['outcrop', 2], ['pebble', 2]],
    crystals: 0.07,
    nodes: 1.0, nodeMix: [['energy', 4], ['stone', 3], ['metal', 2]],
    grass: 0.35,
  },
  {
    id: 'badlands',
    name: { en: 'Sunfall Badlands', nl: 'Zonneval-woestenij' },
    color: [0.74, 0.39, 0.22],
    trees: 0.012, treeMix: [['acacia', 1]],
    bushes: 0.025, bushMix: [['bushJuniper', 2], ['bushGreen', 1]],
    rocks: 0.09, rockMix: [['hoodoo', 2], ['boulder', 3], ['slab', 2], ['shard', 1], ['pebble', 2]],
    nodes: 1.0, nodeMix: [['metal', 5], ['stone', 3], ['energy', 1]],
    grass: 0.12,
  },
  {
    id: 'peaks',
    name: { en: 'Frost Peaks', nl: 'Vorstpieken' },
    color: [0.88, 0.89, 0.93],
    trees: 0.03, treeMix: [['spruce', 3], ['pineTall', 1]],
    bushes: 0.02, bushMix: [['bushJuniper', 1]],
    rocks: 0.11, rockMix: [['boulder', 3], ['shard', 2], ['slab', 2], ['outcrop', 2]],
    nodes: 0.7, nodeMix: [['stone', 4], ['metal', 3], ['energy', 1]],
    grass: 0.08,
  },
];

export const BIOME_INDEX = Object.fromEntries(BIOME_LIST.map((b, i) => [b.id, i]));
export const BIOME_COUNT = BIOME_LIST.length;
/** The hub (safe zone) pseudo-biome returned by biomeAt inside the hub square. */
export const HUB_BIOME = { id: 'hub', name: { en: 'Safe zone', nl: 'Veilige zone' }, color: [0.5, 0.5, 0.5] };
export const BIOMES = Object.fromEntries([...BIOME_LIST, HUB_BIOME].map((b) => [b.id, b]));

/**
 * Enemy spawn tables per biome (day / night; PLATFORM.md §1/§8: drones around
 * ruins, canyons and highlands, stalkers in jungles + forests at night).
 * `max` = soft cap of that enemy near one player at density 1.
 */
export const SPAWNS = {
  ocean: null,
  coast: { day: { density: 0.3, list: [['drone', 1, 2]] }, night: { density: 0.8, list: [['stalker', 1, 2, true], ['drone', 1, 2]] } },
  meadow: { day: { density: 0.35, list: [['drone', 1, 2]] }, night: { density: 1, list: [['stalker', 2, 3, true], ['drone', 1, 2]] } },
  forest: { day: { density: 0.45, list: [['drone', 1, 2]] }, night: { density: 1.3, list: [['stalker', 3, 4, true], ['drone', 1, 2]] } },
  jungle: { day: { density: 1, list: [['stalker', 1, 3]] }, night: { density: 1.6, list: [['stalker', 1, 5]] } },
  highlands: { day: { density: 0.8, list: [['drone', 1, 3]] }, night: { density: 1.5, list: [['drone', 3, 4], ['stalker', 1, 2, true]] } },
  badlands: { day: { density: 1, list: [['drone', 1, 3]] }, night: { density: 2, list: [['drone', 1, 6]] } },
  peaks: { day: { density: 0.5, list: [['drone', 1, 2]] }, night: { density: 1, list: [['drone', 1, 3]] } },
};

/**
 * Biome weights from a terrain sample (S, final height h) into `out`
 * (Float32Array(BIOME_COUNT), sums to 1). Returns the dominant biome index.
 * Scores are smooth functions of climate / relief, sharpened (cubed) so the
 * regions read clearly with ~0.3–1 km blends between them.
 */
export function biomeWeights(S, h, out) {
  const T = S[S_T];
  const M = S[S_M];
  const c = S[S_C];
  const ocean = sstep(-1.2, -3.6, h);
  const land = 1 - ocean;
  const coast = (1 - sstep(0.012, 0.05, c)) * (1 - sstep(3.5, 8.5, h)) * land * (1 - S[S_LAKE]) * (1 - 0.8 * S[S_RIVER]);
  const hot = sstep(0.56, 0.68, T);
  const cold = sstep(0.38, 0.26, T);
  const temp = (1 - hot) * (1 - cold);
  const wet = sstep(0.5, 0.64, M);
  const dry = sstep(0.46, 0.33, M);
  // snow line by climate zone (pre-lapse temperature): hot lands keep bare red rock
  const snowLine = 300 + 300 * sstep(0.52, 0.66, S[S_T0]) - 40 * cold;
  const alpine = Math.min(1, sstep(snowLine, snowLine + 100, h) + cold * sstep(170, 280, h));
  const lowAlt = 1 - sstep(230, 340, h);
  const mm = S[S_MM];
  const plat = S[S_PLAT];

  let jungle = (hot * wet + 0.6 * S[S_JUNGLE]) * lowAlt;
  let badlands = hot * dry + 0.8 * S[S_BAD];
  let forest = (temp * wet + 0.7 * cold * (1 - dry) + 0.25 * temp * mm) * lowAlt;
  let meadow = (temp * (1 - wet) * (1 - 0.6 * mm) + 0.9 * hot * (1 - wet) * (1 - dry) + 0.06) * lowAlt;
  let highlands = 1.5 * plat + 0.6 * mm * (1 - 0.6 * wet) * (1 - alpine);
  let peaks = alpine * 1.4;
  const k = land * (1 - 0.9 * coast);
  jungle *= k;
  badlands *= k;
  forest *= k;
  meadow *= k;
  highlands *= k;
  peaks *= land * (1 - coast);
  const s0 = ocean * 1.2;
  const s1 = coast * 1.1;
  // cube-sharpen + normalise
  const w0 = s0 * s0 * s0;
  const w1 = s1 * s1 * s1;
  const w2 = meadow * meadow * meadow;
  const w3 = forest * forest * forest;
  const w4 = jungle * jungle * jungle;
  const w5 = highlands * highlands * highlands;
  const w6 = badlands * badlands * badlands;
  const w7 = peaks * peaks * peaks;
  const sum = w0 + w1 + w2 + w3 + w4 + w5 + w6 + w7;
  if (!(sum > 1e-12)) {
    out.fill(0);
    out[2] = 1;
    return 2;
  }
  const inv = 1 / sum;
  out[0] = w0 * inv;
  out[1] = w1 * inv;
  out[2] = w2 * inv;
  out[3] = w3 * inv;
  out[4] = w4 * inv;
  out[5] = w5 * inv;
  out[6] = w6 * inv;
  out[7] = w7 * inv;
  let best = 0;
  for (let i = 1; i < 8; i++) if (out[i] > out[best]) best = i;
  return best;
}

/** Day factor (0 night … 1 day) for an hour of the day — night ≈ 20:00–05:30. */
export function isNightHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  return h >= 20 || h < 5.5;
}

/** Snow cover 0..1 for a sample (same climate-zone snow line as the 'peaks' biome). */
export function snowAt(S, h) {
  const cold = sstep(0.38, 0.26, S[S_T]);
  const line = 300 + 300 * sstep(0.52, 0.66, S[S_T0]) - 40 * cold;
  return Math.min(1, sstep(line - 30, line + 80, h) + cold * sstep(190, 300, h));
}
