import { hash3, u01, nextHash, sstep } from './noise.js';
import { BIOME_LIST, BIOME_COUNT } from './biomes.js';
import { HIGHWAY } from './highways.js';

/**
 * Per-chunk features (64 m chunks): trees, bushes, rocks, energy-crystal
 * clusters, harvestable resource nodes, plus the POIs / waystones whose centre
 * lies in the chunk. Candidates sit on jittered grids; each picks a biome from
 * the local biome weights (so borders mix naturally) and passes that biome's
 * density, slope, water, road, POI and hub rules. Fully deterministic per
 * (seed, cx, cz); ids are stable: 'n:<cx>:<cz>:<i>' for nodes (server harvest
 * validation), 't|b|r|c:<cx>:<cz>:<k>' for decoration.
 */
export const CHUNK_SIZE = 64;

const NODE_SLOTS = 6;
const NODE_P = 0.17;
// slot grid: 3 × 2 jittered regions per chunk
const SLOT_X = [0, 1, 2, 0, 1, 2];
const SLOT_Z = [0, 0, 0, 1, 1, 1];

const ROCK_SCALE = {
  boulder: [0.8, 2.6],
  slab: [1.0, 2.8],
  shard: [0.9, 2.2],
  outcrop: [2.4, 5.5],
  hoodoo: [0.7, 1.35],
  pebble: [0.3, 0.7],
};
const BROADLEAF = { oak: 1, birch: 1, acacia: 1, jungleTree: 1, palm: 1 };

function pick(mix, u) {
  let total = 0;
  for (let i = 0; i < mix.length; i++) total += mix[i][1];
  let r = u * total;
  for (let i = 0; i < mix.length; i++) {
    r -= mix[i][1];
    if (r < 0) return mix[i][0];
  }
  return mix[mix.length - 1][0];
}

/**
 * @param g.sample(x, z, S, W) → final height, fills terrain scratch S + biome weights W
 * @param g.heightAt(x, z)
 * @param g.noise     terrain noise (clumping)
 * @param g.seedHash  uint32
 * @param g.hubDist(x, z)   distance outside the safe zone
 * @param g.outside(x, z)   distance outside the hub mesh square
 * @param g.roadDist(x, z, reach)
 * @param g.poiCovering(x, z) → poi | null
 * @param g.pois.near / g.waystonesIn(x0, z0, x1, z1)
 */
export function createFeatures(g) {
  const S = new Float64Array(16);
  const W = new Float32Array(BIOME_COUNT);
  const seed = g.seedHash;

  function slopeAt(x, z, h) {
    const e = 1.5;
    const sx = g.heightAt(x - e, z) - g.heightAt(x + e, z);
    const sz = g.heightAt(x, z - e) - g.heightAt(x, z + e);
    return 1 - (2 * e) / Math.sqrt(sx * sx + sz * sz + 4 * e * e);
  }

  function pickBiome(u) {
    let r = u;
    for (let i = 0; i < BIOME_COUNT; i++) {
      r -= W[i];
      if (r < 0) return i;
    }
    return BIOME_COUNT - 1;
  }

  function poiClear(x, z, extra) {
    const p = g.poiCovering(x, z);
    if (!p) return true;
    const dx = x - p.x;
    const dz = z - p.z;
    const r = p.radius + extra;
    return dx * dx + dz * dz > r * r;
  }

  // One function per layer: each gets its own (complete) type feedback, so the
  // optimised code stays stable instead of deoptimising whenever a new loop runs.

  function trees(cx, cz, x0, z0, out) {
    let k = 0;
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++, k++) {
        let h = hash3(cx, cz, k, seed ^ 0x51ed27);
        const x = x0 + (i + 0.1 + 0.8 * u01(h)) * 8;
        h = nextHash(h);
        const z = z0 + (j + 0.1 + 0.8 * u01(h)) * 8;
        if (g.outside(x, z) < 3) continue;
        const y = g.sample(x, z, S, W);
        if (y < 0.5) continue;
        h = nextHash(h);
        const b = pickBiome(u01(h));
        const B = BIOME_LIST[b];
        if (!B.trees) continue;
        let dens = B.trees;
        if (b === 3 || b === 4) dens *= 0.35 + 1.05 * sstep(-0.35, 0.45, g.noise.n2(x * 0.0118 + 3.3, z * 0.0118 - 1.1));
        else if (b === 2) dens *= 0.15 + 1.9 * sstep(0.15, 0.6, g.noise.n2(x * 0.0071 - 5.1, z * 0.0071 + 2.7));
        dens *= 1 - sstep(300, 365, y);
        if (b !== 1 && y < 1.6) dens *= 0.2;
        h = nextHash(h);
        if (u01(h) >= dens) continue;
        if (g.roadDist(x, z, 32) < 12 || !poiClear(x, z, 5)) continue;
        if (slopeAt(x, z, y) > 0.42) continue;
        h = nextHash(h);
        let variant = pick(B.treeMix, u01(h));
        if (y > 190 && BROADLEAF[variant]) variant = y > 250 ? 'spruce' : 'pineMid';
        h = nextHash(h);
        const rot = u01(h) * Math.PI * 2;
        h = nextHash(h);
        const scale = 0.72 + 0.52 * u01(h);
        out.push({ id: `t:${cx}:${cz}:${k}`, type: 'tree', variant, x, y: y - 0.15, z, rot, scale, biome: B.id });
      }
    }
  }

  function bushes(cx, cz, x0, z0, out) {
    let k = 0;
    for (let j = 0; j < 10; j++) {
      for (let i = 0; i < 10; i++, k++) {
        let h = hash3(cx, cz, k, seed ^ 0x2b3c4d);
        const x = x0 + (i + 0.05 + 0.9 * u01(h)) * 6.4;
        h = nextHash(h);
        const z = z0 + (j + 0.05 + 0.9 * u01(h)) * 6.4;
        if (g.outside(x, z) < 2) continue;
        const y = g.sample(x, z, S, W);
        if (y < 0.7) continue;
        h = nextHash(h);
        const b = pickBiome(u01(h));
        const B = BIOME_LIST[b];
        if (!B.bushes) continue;
        let dens = B.bushes * (1 - sstep(320, 380, y));
        if (b === 3 || b === 4) dens *= 0.5 + 0.8 * sstep(-0.4, 0.4, g.noise.n2(x * 0.0118 + 3.3, z * 0.0118 - 1.1));
        h = nextHash(h);
        if (u01(h) >= dens) continue;
        if (g.roadDist(x, z, 30) < 10 || !poiClear(x, z, 3)) continue;
        if (slopeAt(x, z, y) > 0.5) continue;
        h = nextHash(h);
        const variant = pick(B.bushMix, u01(h));
        h = nextHash(h);
        const rot = u01(h) * Math.PI * 2;
        h = nextHash(h);
        const scale = 0.7 + 0.6 * u01(h);
        out.push({ id: `b:${cx}:${cz}:${k}`, type: 'bush', variant, x, y: y - 0.05, z, rot, scale, biome: B.id });
      }
    }
  }

  function rocks(cx, cz, x0, z0, out) {
    let k = 0;
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 6; i++, k++) {
        let h = hash3(cx, cz, k, seed ^ 0x7a1b9c);
        const x = x0 + (i + 0.1 + 0.8 * u01(h)) * 10.6667;
        h = nextHash(h);
        const z = z0 + (j + 0.1 + 0.8 * u01(h)) * 10.6667;
        if (g.outside(x, z) < 3) continue;
        const y = g.sample(x, z, S, W);
        if (y < -0.5) continue;
        h = nextHash(h);
        const b = pickBiome(u01(h));
        const B = BIOME_LIST[b];
        if (!B.rocks) continue;
        const slope = slopeAt(x, z, y);
        const dens = B.rocks * (1 + 2.2 * sstep(0.18, 0.5, slope));
        h = nextHash(h);
        if (u01(h) >= dens) continue;
        if (g.roadDist(x, z, 30) < 10 || !poiClear(x, z, 2)) continue;
        h = nextHash(h);
        let variant = pick(B.rockMix, u01(h));
        if (variant === 'hoodoo' && slope > 0.3) variant = 'boulder';
        const sr = ROCK_SCALE[variant];
        h = nextHash(h);
        const scale = sr[0] + (sr[1] - sr[0]) * u01(h) * u01(nextHash(h));
        h = nextHash(nextHash(h));
        const rot = u01(h) * Math.PI * 2;
        out.push({ id: `r:${cx}:${cz}:${k}`, type: 'rock', variant, x, y: y - 0.2 * scale, z, rot, scale, biome: B.id });
      }
    }
  }

  function crystals(cx, cz, x0, z0, out) {
    let k = 0;
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++, k++) {
        let h = hash3(cx, cz, k, seed ^ 0x3c6ef3);
        const x = x0 + (i + 0.15 + 0.7 * u01(h)) * 16;
        h = nextHash(h);
        const z = z0 + (j + 0.15 + 0.7 * u01(h)) * 16;
        if (g.outside(x, z) < 3) continue;
        const y = g.sample(x, z, S, W);
        if (y < 2) continue;
        let dens = 0;
        for (let bi = 0; bi < BIOME_COUNT; bi++) dens += (BIOME_LIST[bi].crystals || 0) * W[bi];
        h = nextHash(h);
        if (u01(h) >= dens) continue;
        if (g.roadDist(x, z, 30) < 12 || !poiClear(x, z, 4)) continue;
        if (slopeAt(x, z, y) > 0.55) continue;
        h = nextHash(h);
        const variant = h % 3;
        h = nextHash(h);
        const rot = u01(h) * Math.PI * 2;
        h = nextHash(h);
        const scale = 0.9 + 1.5 * u01(h);
        out.push({ id: `c:${cx}:${cz}:${k}`, type: 'crystal', variant, x, y: y - 0.3, z, rot, scale, biome: 'highlands' });
      }
    }
  }

  function nodes(cx, cz, x0, z0, out) {
    let n = 0;
    for (let s = 0; s < NODE_SLOTS; s++) {
      let h = hash3(cx, cz, s, seed ^ 0x6a09e6);
      const x = x0 + (SLOT_X[s] + 0.12 + 0.76 * u01(h)) * (CHUNK_SIZE / 3);
      h = nextHash(h);
      const z = z0 + (SLOT_Z[s] + 0.12 + 0.76 * u01(h)) * (CHUNK_SIZE / 2);
      if (g.hubDist(x, z) < 200) continue;
      const y = g.sample(x, z, S, W);
      if (y < 0.6) continue;
      h = nextHash(h);
      const b = pickBiome(u01(h));
      const B = BIOME_LIST[b];
      if (!B.nodes) continue;
      h = nextHash(h);
      if (u01(h) >= B.nodes * NODE_P) continue;
      if (g.roadDist(x, z, 30) < 14 || !poiClear(x, z, -8)) continue;
      if (slopeAt(x, z, y) > 0.4) continue;
      h = nextHash(h);
      const type = pick(B.nodeMix, u01(h));
      h = nextHash(h);
      const rot = u01(h) * Math.PI * 2;
      h = nextHash(h);
      const scale = 0.85 + 0.35 * u01(h);
      out.push({ id: `n:${cx}:${cz}:${n}`, type: 'node', node: true, variant: type, resource: type, x, y, z, rot, rotY: rot, scale, biome: B.id });
      n++;
    }
  }

  function landmarks(x0, z0, out) {
    const cxm = x0 + CHUNK_SIZE / 2;
    const czm = z0 + CHUNK_SIZE / 2;
    for (const p of g.poisNear(cxm, czm, CHUNK_SIZE)) {
      if (p.x < x0 || p.x >= x0 + CHUNK_SIZE || p.z < z0 || p.z >= z0 + CHUNK_SIZE) continue;
      out.push({ id: p.id, type: p.type, variant: p.variant, x: p.x, y: p.y, z: p.z, rot: p.rot, scale: 1, radius: p.radius, poi: true, biome: BIOME_LIST[p.biome]?.id, name: p.name, loot: p.loot });
    }
    for (const w of g.waystonesIn(x0, z0, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE)) {
      out.push({ id: w.id, type: 'waystone', variant: 0, x: w.x, y: g.heightAt(w.x, w.z), z: w.z, rot: w.rot, scale: 1, road: w.road, km: w.km });
    }
  }

  /** Features of chunk (cx, cz) → array of plain objects (see module doc). */
  function chunk(cx, cz, opts) {
    const decor = !opts || opts.decor !== false;
    const withNodes = !opts || opts.nodes !== false;
    const withPois = !opts || opts.pois !== false;
    const out = [];
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    // the whole chunk inside the hub mesh: nothing procedural here
    if (x0 > -g.extent && x0 + CHUNK_SIZE < g.extent && z0 > -g.extent && z0 + CHUNK_SIZE < g.extent && g.outside(x0, z0) < 0) return out;
    if (decor) {
      trees(cx, cz, x0, z0, out);
      bushes(cx, cz, x0, z0, out);
      rocks(cx, cz, x0, z0, out);
      crystals(cx, cz, x0, z0, out);
    }
    if (withNodes) nodes(cx, cz, x0, z0, out);
    if (withPois) landmarks(x0, z0, out);
    return out;
  }

  return { chunk, slopeAt, clearance: HIGHWAY.clear };
}
