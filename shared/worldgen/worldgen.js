import { hashString, mix, sstep } from './noise.js';
import { createTerrain, PLANETS, S_LEN, S_T, S_M, S_C, S_RIVER, S_LAKE, S_MOUNT, S_PLAT, S_BAD } from './terrain.js';
import { BIOME_LIST, BIOME_COUNT, BIOMES, HUB_BIOME, SPAWNS, biomeWeights, isNightHour } from './biomes.js';
import { createHubSeam } from './hub.js';
import { createHighways, HIGHWAY } from './highways.js';
import { createPois, POI_TYPES } from './pois.js';
import { createFeatures, CHUNK_SIZE } from './features.js';

/**
 * createWorldgen({ seed, hub, planet }) — the infinite procedural planet around
 * the hand-made hub (PLATFORM.md §11 / §11.2). Synchronous, pure JS (no DOM,
 * Node APIs or three.js), deterministic per seed + hub, identical in Node,
 * browsers and workers. See shared/worldgen/README.md for the full contract.
 *
 * hub: { heightAt, isWater?, getWaterHeightAt?, radius = 1100 (safe zone),
 *        blend = 300, extent = 1200 (hub heightfield half-size) }
 *   or the worker form { edge, coarse, radius, blend, extent } from exportForWorker().
 */
const WATER_LEVEL = 0;
const NO_BUILD = 500; // §11.2 no-build buffer (hubDist)
const SPAWN_BUFFER = 200; // no enemy spawns / nodes where hubDist < this
const POI_CLEAR = 60; // no building within this of a POI's pad
const LANDING_SAFE = 150; // planets without a hub: safe landing circle

class BiomeSample {
  constructor(id, index, name, weights) {
    this.id = id;
    this.index = index;
    this.name = name;
    this.weights = weights;
  }
  /** String(biomeAt(x, z)) === id, so providers that expect a string keep working. */
  toString() {
    return this.id;
  }
  toJSON() {
    return { id: this.id, weights: this.weights };
  }
}

export function createWorldgen(opts = {}) {
  const seed = String(opts.seed ?? 'o-universe');
  const seedHash = hashString(seed);
  const planet = (typeof opts.planet === 'string' ? PLANETS[opts.planet] : opts.planet) || PLANETS['o-prime'];
  const hubOpt = opts.hub && typeof opts.hub === 'object' ? opts.hub : null;
  const seam = createHubSeam(hubOpt || {}, {});
  const hasHub = !!hubOpt && seam.hasHub;
  const terrain = createTerrain(seed, { hub: hasHub, planet });
  const S0 = new Float64Array(S_LEN);
  const S1 = new Float64Array(S_LEN);
  const W1 = new Float32Array(BIOME_COUNT);
  const R = seam.radius; // safe-zone half size
  const EXT = seam.extent;
  const BL = seam.blend;
  const hubIsWater = hasHub && typeof hubOpt.isWater === 'function' ? hubOpt.isWater : null;
  const hubWaterH = hasHub && typeof hubOpt.getWaterHeightAt === 'function' ? hubOpt.getWaterHeightAt : null;

  // ------------------------------------------------------------ rules geometry
  const hubDist = hasHub
    ? (x, z) => {
        const d = Math.max(x < 0 ? -x : x, z < 0 ? -z : z) - R;
        return d > 0 ? d : 0;
      }
    : (x, z) => {
        const d = Math.sqrt(x * x + z * z) - LANDING_SAFE;
        return d > 0 ? d : 0;
      };
  const isSafe = hasHub ? (x, z) => (x < 0 ? -x : x) <= R && (z < 0 ? -z : z) <= R : (x, z) => x * x + z * z <= LANDING_SAFE * LANDING_SAFE;

  // ------------------------------------------------------------ heights
  /** Seam + procedural terrain (no POI pads, no roads), scratch S. */
  function baseInto(x, z, S) {
    if (hasHub) {
      const e = seam.outside(x, z);
      if (e <= 0) {
        terrain.natural(x, z, S); // climate for biomes; height is the hub's
        const hh = seam.inside(x, z);
        S[0] = hh;
        return hh;
      }
      const P = terrain.natural(x, z, S);
      if (e >= BL) return P;
      const hb = mix(seam.extension(x, z, e), P, seam.weight(e));
      S[0] = hb;
      return hb;
    }
    return terrain.natural(x, z, S);
  }
  function baseH(x, z) {
    if (hasHub && seam.outside(x, z) <= 0) return seam.inside(x, z);
    return baseInto(x, z, S0);
  }

  // highways (+ the corridor damping they put into the terrain)
  const highways = createHighways({ seam: { ...seam, hasHub }, baseH, setCorridor: terrain.setCorridor, data: opts.highways || null });

  const biomeIndexBase = (x, z) => {
    const h = baseInto(x, z, S1);
    return biomeWeights(S1, h, W1);
  };
  const pois = createPois({
    seedHash: seedHash ^ 0x5bd1e995,
    baseH,
    biomeAt: biomeIndexBase,
    hubDist,
    roadDist: (x, z, reach) => highways.distance(x, z, reach),
    minHubDist: hasHub ? 260 : 350,
  });

  function finish(x, z, h) {
    if (hasHub && seam.outside(x, z) <= 0) return h;
    h = highways.shoulder(x, z, h);
    h = pois.pad(x, z, h);
    return highways.stamp(x, z, h);
  }

  /** Combined height (hub inside, seam blend, procedural beyond, POI pads, highways). */
  function heightAt(x, z) {
    if (hasHub && seam.outside(x, z) <= 0) return seam.inside(x, z);
    return finish(x, z, baseInto(x, z, S0));
  }

  /** Full sample: final height + terrain fields (S) + biome weights (W) → dominant biome index in S[15]. */
  function sample(x, z, S, W) {
    const h = finish(x, z, baseInto(x, z, S));
    S[0] = h;
    S[15] = biomeWeights(S, h, W);
    return h;
  }

  function normalAt(x, z, out) {
    const e = 1;
    const hx = heightAt(x - e, z) - heightAt(x + e, z);
    const hz = heightAt(x, z - e) - heightAt(x, z + e);
    const l = Math.sqrt(hx * hx + 4 * e * e + hz * hz);
    const o = out || { x: 0, y: 1, z: 0 };
    if (typeof o.set === 'function') o.set(hx / l, (2 * e) / l, hz / l);
    else {
      o.x = hx / l;
      o.y = (2 * e) / l;
      o.z = hz / l;
    }
    return o;
  }

  function isWater(x, z) {
    if (hubIsWater && seam.outside(x, z) <= 0) return !!hubIsWater(x, z);
    return heightAt(x, z) < WATER_LEVEL - 0.3;
  }

  function getWaterHeightAt(x, z) {
    if (hubWaterH && seam.outside(x, z) <= 0) return hubWaterH(x, z);
    return heightAt(x, z) < WATER_LEVEL ? WATER_LEVEL : null;
  }

  // ------------------------------------------------------------ biomes
  const SB = new Float64Array(S_LEN);
  const WB = new Float32Array(BIOME_COUNT);
  function biomeIndexAt(x, z) {
    sample(x, z, SB, WB);
    return SB[15];
  }
  function biomeIdAt(x, z) {
    if (hasHub && isSafe(x, z)) return 'hub';
    return BIOME_LIST[biomeIndexAt(x, z)].id;
  }
  function biomeAt(x, z) {
    if (hasHub && isSafe(x, z)) return new BiomeSample('hub', -1, HUB_BIOME.name, { hub: 1 });
    const bi = biomeIndexAt(x, z);
    const weights = {};
    for (let i = 0; i < BIOME_COUNT; i++) if (WB[i] > 0.005) weights[BIOME_LIST[i].id] = Math.round(WB[i] * 1000) / 1000;
    return new BiomeSample(BIOME_LIST[bi].id, bi, BIOME_LIST[bi].name, weights);
  }

  // ------------------------------------------------------------ features + nodes
  const feat = createFeatures({
    sample,
    heightAt,
    noise: terrain.noise,
    seedHash,
    extent: EXT,
    hubDist,
    outside: hasHub ? seam.outside : () => 1e9,
    roadDist: (x, z, reach) => highways.distance(x, z, reach),
    poiCovering: (x, z) => pois.covering(x, z),
    poisNear: (x, z, r) => pois.near(x, z, r),
    waystonesIn: (x0, z0, x1, z1) => {
      const out = [];
      for (const r of highways.roads) for (const w of r.waystones) if (w.x >= x0 && w.x < x1 && w.z >= z0 && w.z < z1) out.push(w);
      return out;
    },
  });

  const nodeCache = new Map();
  function chunkNodes(cx, cz) {
    const key = `${cx},${cz}`;
    let list = nodeCache.get(key);
    if (list) {
      nodeCache.delete(key);
      nodeCache.set(key, list);
      return list;
    }
    list = feat.chunk(cx, cz, { decor: false, nodes: true, pois: false });
    if (nodeCache.size >= 4096) nodeCache.delete(nodeCache.keys().next().value);
    nodeCache.set(key, list);
    return list;
  }

  function nodesNear(x, z, r) {
    const out = [];
    const i0 = Math.floor((x - r) / CHUNK_SIZE);
    const i1 = Math.floor((x + r) / CHUNK_SIZE);
    const j0 = Math.floor((z - r) / CHUNK_SIZE);
    const j1 = Math.floor((z + r) / CHUNK_SIZE);
    const rr = r * r;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const n of chunkNodes(i, j)) {
          const dx = n.x - x;
          const dz = n.z - z;
          if (dx * dx + dz * dz <= rr) out.push(n);
        }
      }
    }
    return out;
  }

  /**
   * Chunk (cx, cz) of CHUNK_SIZE m: heights on a (cells + 3)² grid with a
   * 1-cell skirt (sample (i, j) at x0 + (i − 1)·step), dominant biome + biome
   * weights (0–255, BIOME_COUNT per vertex) on the (cells + 1)² vertices, and
   * the features. lod 0 = 32 cells (2 m), each lod halves the resolution.
   */
  function chunk(cx, cz, { lod = 0, features = true } = {}) {
    const cells = Math.max(1, 32 >> Math.max(0, Math.min(5, lod | 0)));
    const step = CHUNK_SIZE / cells;
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const n = cells + 3;
    const v = cells + 1;
    const heights = new Float32Array(n * n);
    const biome = new Uint8Array(v * v);
    const weights = new Uint8Array(v * v * BIOME_COUNT);
    const S = new Float64Array(S_LEN);
    const W = new Float32Array(BIOME_COUNT);
    for (let j = 0; j < n; j++) {
      const z = z0 + (j - 1) * step;
      for (let i = 0; i < n; i++) {
        const x = x0 + (i - 1) * step;
        const inner = i >= 1 && j >= 1 && i <= v && j <= v;
        if (!inner) {
          heights[j * n + i] = heightAt(x, z);
          continue;
        }
        const h = sample(x, z, S, W);
        heights[j * n + i] = h;
        const k = (j - 1) * v + (i - 1);
        biome[k] = hasHub && isSafe(x, z) ? 255 : S[15];
        for (let b = 0; b < BIOME_COUNT; b++) weights[k * BIOME_COUNT + b] = Math.round(W[b] * 255);
      }
    }
    return {
      cx,
      cz,
      lod,
      size: CHUNK_SIZE,
      cells,
      step,
      x0,
      z0,
      heights,
      skirt: 1,
      biome,
      weights,
      biomes: BIOME_LIST.map((b) => b.id),
      features: features ? feat.chunk(cx, cz) : [],
    };
  }

  // ------------------------------------------------------------ enemies
  function spawnTable(biomeId, hour) {
    const T = SPAWNS[String(biomeId)];
    if (!T) return [];
    const night = isNightHour(hour);
    const t = night ? T.night : T.day;
    return t.list.filter((e) => night || !e[3]).map((e) => ({ enemy: e[0], weight: e[1], max: e[2], nightOnly: !!e[3], density: t.density }));
  }

  function spawnRules(x, z, hour) {
    if (isSafe(x, z)) return null;
    const hd = hubDist(x, z);
    if (hd < SPAWN_BUFFER) return null;
    const b = biomeIdAt(x, z);
    const T = SPAWNS[b];
    if (!T) return null;
    const night = isNightHour(hour);
    const t = night ? T.night : T.day;
    let density = t.density * (hasHub ? sstep(SPAWN_BUFFER, SPAWN_BUFFER + 250, hd) * 0.85 + 0.15 : 1);
    const list = t.list.filter((e) => night || !e[3]).map((e) => ({ type: e[0], w: e[1], max: e[2], nightOnly: !!e[3] }));
    // hot spots: POIs are guarded
    let best = null;
    let bd = 230;
    for (const p of pois.near(x, z, 230)) {
      const d = Math.sqrt((p.x - x) ** 2 + (p.z - z) ** 2);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      const P = POI_TYPES[best.type];
      density *= mix(P.density, 1, sstep(80, 230, bd));
      for (const e of P.enemies) {
        if (e[3] && !night) continue;
        const have = list.find((l) => l.type === e[0]);
        if (have) have.w += e[1];
        else list.push({ type: e[0], w: e[1], max: e[2], nightOnly: !!e[3] });
      }
    }
    // calmer along the highways
    const rd = highways.distance(x, z, 60);
    if (rd < 60) density *= 0.55 + 0.45 * sstep(15, 60, rd);
    if (!list.length || !(density > 0)) return null;
    return { biome: b, density: Math.min(density, 6), list, poi: best ? best.id : null };
  }

  // ------------------------------------------------------------ POIs, highways, build rules
  function publicPoi(p) {
    return { id: p.id, type: p.type, variant: p.variant, x: p.x, y: p.y, z: p.z, rot: p.rot, radius: p.radius, name: p.name, biome: BIOME_LIST[p.biome]?.id, loot: p.loot };
  }
  function poisNear(x, z, r) {
    return pois.near(x, z, r).map(publicPoi);
  }

  function isBuildable(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: 'invalid' };
    if (isSafe(x, z)) return { ok: false, reason: 'safe' };
    const hd = hubDist(x, z);
    if (hasHub && hd < NO_BUILD) return { ok: false, reason: 'hub', need: Math.ceil(NO_BUILD - hd) };
    if (highways.distance(x, z, HIGHWAY.clear + 1) < HIGHWAY.clear) return { ok: false, reason: 'highway' };
    for (const p of pois.near(x, z, 160)) {
      const d = Math.sqrt((p.x - x) ** 2 + (p.z - z) ** 2);
      if (d < p.radius + POI_CLEAR) return { ok: false, reason: 'poi', poi: p.id };
    }
    return { ok: true };
  }

  const roadsNear = (x, z, r) => highways.near(x, z, r);
  const isOnHighway = (x, z, margin = 0) => highways.distance(x, z, HIGHWAY.half + margin + 0.5) <= HIGHWAY.half + margin;

  function describe(x, z) {
    const S = new Float64Array(S_LEN);
    const W = new Float32Array(BIOME_COUNT);
    const h = sample(x, z, S, W);
    const b = biomeAt(x, z);
    const road = roadsNear(x, z, 120)[0] || null;
    const poi = poisNear(x, z, 400).sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z))[0] || null;
    const safe = isSafe(x, z);
    const build = isBuildable(x, z);
    const water = isWater(x, z);
    const parts = [`${b.id} ${h.toFixed(1)} m`];
    if (safe) parts.push('safe zone');
    if (water) parts.push('water');
    if (road) parts.push(`${road.id} ${road.distance.toFixed(0)} m`);
    if (poi) parts.push(`${poi.type} ${poi.id}`);
    parts.push(build.ok ? 'buildable' : `no build (${build.reason})`);
    return {
      x,
      z,
      height: h,
      water,
      safe,
      hubDist: hubDist(x, z),
      biome: { id: b.id, name: b.name, weights: b.weights },
      climate: { temperature: S[S_T], moisture: S[S_M], continent: S[S_C] },
      fields: { river: S[S_RIVER], lake: S[S_LAKE], mountain: S[S_MOUNT], plateau: S[S_PLAT], badlands: S[S_BAD] },
      buildable: build,
      highway: road && { id: road.id, name: road.name, distance: road.distance },
      poi,
      spawn: spawnRules(x, z, 22),
      text: parts.join(' · '),
    };
  }

  return {
    seed,
    planet: planet.id,
    CHUNK_SIZE,
    CHUNK: CHUNK_SIZE,
    chunkSize: CHUNK_SIZE,
    waterLevel: WATER_LEVEL,
    hub: { radius: R, half: R, extent: EXT, blend: BL, noBuild: NO_BUILD, spawnBuffer: SPAWN_BUFFER, present: hasHub },
    biomes: BIOME_LIST,
    BIOMES,
    heightAt,
    getHeightAt: heightAt,
    normalAt,
    getNormalAt: normalAt,
    isWater,
    getWaterHeightAt,
    isSafe,
    hubDist,
    biomeAt,
    biomeIdAt,
    biomeIndexAt,
    chunk,
    features: (cx, cz) => feat.chunk(cx, cz),
    nodesNear,
    spawnTable,
    spawnRules,
    poisNear,
    poiAt: (x, z) => {
      const p = pois.covering(x, z);
      return p ? publicPoi(p) : null;
    },
    highways: highways.roads,
    /** §11.2 static rule numbers (m): building refused within these of the hub square / a highway centreline / a POI pad. */
    rules: { noBuild: hasHub ? NO_BUILD : 0, highwayClear: HIGHWAY.clear, poiClear: POI_CLEAR, heightLimitDist: 2000, heightLimit: 16 },
    highwayClear: HIGHWAY.clear,
    poiClear: POI_CLEAR,
    roadsNear,
    isOnHighway,
    highwayDistance: (x, z, reach = 60) => highways.distance(x, z, reach),
    isBuildable,
    describe,
    /** Plain data to rebuild an identical generator in a Web Worker (no functions). */
    exportForWorker() {
      return { seed, planet: planet.id, hub: hasHub ? seam.exportData(true) : null, highways: highways.exportData() };
    },
    /** Internal (renderer worker): final height + terrain fields + biome weights. */
    _sample: sample,
    _base: baseH,
  };
}

export { CHUNK_SIZE, BIOME_LIST, BIOMES, HIGHWAY, POI_TYPES, PLANETS };
