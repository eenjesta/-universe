/**
 * Stand-in world provider (PLATFORM.md §11) — used until shared/worldgen lands,
 * and by the tests. Same interface the sim expects from worldgen:
 *
 *   const w = createStandin({ seed, hub: { heightAt, isWater }, noise = true })
 *   w.heightAt(x, z)        hub heightfield inside; outside blended (300 m) into simple fBm terrain
 *   w.isWater(x, z)         hub water inside; outside height < −0.3 (sea level y = 0)
 *   w.isSafe(x, z)          inside the hub square (|x|, |z| ≤ 1100) → safe zone
 *   w.hubDist(x, z)         distance outside the hub square
 *   w.biomeAt(x, z)         'hub' | 'jungle' (W) | 'badlands' (E/SE) | 'ocean' (N/NE) | 'forest' | 'meadow' | 'mountains' (S)
 *   w.spawnRules(x, z, hour) → { biome, density, list: [{ type, w, nightOnly? }] } | null   (shared/defs/enemies.js SPAWN_TABLES)
 *   w.nodesNear(x, z, r)    → [{ id: 'w12.-40.1', type, resource, x, y, z, rotY, scale }] stable ids, outside the hub only
 *   w.isBuildable(x, z)     → { ok, reason? } static rules: safe zone ('safe'), §11.2 no-build buffer ('hub')
 *
 * With `noise: false` heightAt / isWater are the hub functions unchanged (the
 * sim's fallback: it never invents terrain the client doesn't render).
 * Pure JS, deterministic per seed, no allocations in heightAt.
 */
import { HUB, hubDist, inHub } from '../defs/world.js';
import { SPAWN, SPAWN_TABLES } from '../defs/enemies.js';
import { NODE_TYPES } from './nodes.js';
import { dayFactorAt } from './zones.js';
import { mulberry32, hashString } from './rng.js';
import { smoothstep, lerp } from './util.js';

const NODE_CELL = 64; // m — stand-in resource-node grid
const NODE_MIX = {
  jungle: ['wood', 'wood', 'wood', 'energy', 'energy', 'stone'],
  badlands: ['metal', 'metal', 'metal', 'stone', 'stone', 'energy'],
  mountains: ['stone', 'stone', 'stone', 'metal', 'metal', 'energy'],
  forest: ['wood', 'wood', 'wood', 'wood', 'stone', 'stone', 'metal'],
  meadow: ['stone', 'stone', 'wood', 'wood', 'energy', 'metal'],
};

/** Hashed value noise in [-1, 1] (smooth, deterministic, allocation-free). */
function makeNoise(seed) {
  const s = hashString(String(seed)) | 0;
  const h = (i, j) => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ s;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return ((n >>> 0) / 4294967295) * 2 - 1;
  };
  const noise = (x, z) => {
    const i = Math.floor(x);
    const j = Math.floor(z);
    const fx = x - i;
    const fz = z - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fz * fz * (3 - 2 * fz);
    const a = h(i, j);
    const b = h(i + 1, j);
    const c = h(i, j + 1);
    const d = h(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, z) => noise(x, z) * 0.55 + noise(x * 2.03 + 17.3, z * 2.03 - 9.1) * 0.28 + noise(x * 4.11 - 3.7, z * 4.11 + 5.2) * 0.17;
  return { noise, fbm };
}

export function createStandin({ seed = 'o-universe', hub = {}, noise = true } = {}) {
  const hubH = typeof hub.heightAt === 'function' ? hub.heightAt : typeof hub.getHeightAt === 'function' ? hub.getHeightAt : () => 2;
  const hubWater = typeof hub.isWater === 'function' ? hub.isWater : () => false;
  const N = makeNoise(`${seed}:terrain`);

  /** Compass angle (0 = north/−Z, +π/2 = east/+X), wobbled so biome borders aren't straight. */
  const angleAt = (x, z) => Math.atan2(x, -z) + 0.45 * N.noise(x / 1700 + 11.5, z / 1700 - 4.2);

  function biomeAt(x, z) {
    if (inHub(x, z)) return 'hub';
    const a = angleAt(x, z) * (180 / Math.PI);
    if (a >= -25 && a < 70) return 'ocean';
    if (a >= 70 && a < 150) return 'badlands';
    if (a >= -125 && a < -25) return 'jungle';
    const n = N.fbm(x / 900 + 3.1, z / 900 - 7.7);
    return n > 0.22 ? 'mountains' : n < -0.18 ? 'meadow' : 'forest';
  }

  /** Procedural terrain outside the hub (no hub blending). */
  function procHeight(x, z) {
    const a = angleAt(x, z);
    const ocean = smoothstep(0.42, 0.8, Math.cos(a - 0.38)); // north / north-east
    const south = smoothstep(0.2, 0.7, -Math.cos(a));
    const east = smoothstep(0.3, 0.8, Math.sin(a) * (1 - ocean));
    let h = 9 + 11 * N.fbm(x / 420, z / 420);
    const m = Math.max(0, N.fbm(x / 1100 + 5.3, z / 1100 - 3.1));
    h += (26 + 40 * south) * m * m * 2.2; // highlands to the south
    h += east * 10 * Math.abs(N.noise(x / 160, z / 160)); // badland mesas
    return lerp(h, -16 + 5 * N.noise(x / 300, z / 300), ocean);
  }

  const heightAt = noise
    ? (x, z) => {
        const d = hubDist(x, z);
        if (d <= 0) return hubH(x, z);
        const t = smoothstep(0, HUB.blend, d);
        if (t >= 1) return procHeight(x, z);
        return lerp(hubH(x, z), procHeight(x, z), t);
      }
    : hubH;
  const isWater = noise ? (x, z) => (inHub(x, z) ? hubWater(x, z) : heightAt(x, z) < -0.3) : hubWater;

  const isSafe = (x, z) => inHub(x, z);

  function spawnRules(x, z, hour) {
    if (hubDist(x, z) < HUB.spawnBuffer) return null;
    const T = SPAWN_TABLES[biomeAt(x, z)];
    if (!T) return null;
    const night = dayFactorAt(hour) < SPAWN.nightBelow;
    const t = night ? T.night : T.day;
    return t ? { biome: biomeAt(x, z), density: t.density, list: t.list } : null;
  }

  // -------------------------------------------------------------- resource nodes
  const cells = new Map(); // "i,j" → nodes (bounded cache)
  function cellNodes(i, j) {
    const key = `${i},${j}`;
    let list = cells.get(key);
    if (list) return list;
    list = [];
    const rnd = mulberry32(hashString(`${seed}:nodes:${i}:${j}`));
    const count = Math.floor(rnd() * 3.2);
    for (let k = 0; k < count; k++) {
      const x = i * NODE_CELL + 6 + rnd() * (NODE_CELL - 12);
      const z = j * NODE_CELL + 6 + rnd() * (NODE_CELL - 12);
      const pick = rnd();
      const rotY = rnd() * Math.PI * 2;
      const scale = 0.85 + rnd() * 0.35;
      if (hubDist(x, z) < 40) continue; // the hub keeps its hand-placed nodes (nodes.js)
      const mix = NODE_MIX[biomeAt(x, z)];
      if (!mix) continue;
      const y = heightAt(x, z);
      if (y < 0.5 || isWater(x, z)) continue;
      const sx = heightAt(x - 1, z) - heightAt(x + 1, z);
      const sz = heightAt(x, z - 1) - heightAt(x, z + 1);
      if (2 / Math.sqrt(sx * sx + 4 + sz * sz) < 0.8) continue; // too steep
      const type = mix[Math.floor(pick * mix.length)];
      list.push({ id: `w${i}.${j}.${k}`, type, resource: NODE_TYPES[type].resource, x, y, z, rotY, scale });
    }
    if (cells.size > 4096) cells.delete(cells.keys().next().value);
    cells.set(key, list);
    return list;
  }

  function nodesNear(x, z, r) {
    const out = [];
    const i0 = Math.floor((x - r) / NODE_CELL);
    const i1 = Math.floor((x + r) / NODE_CELL);
    const j0 = Math.floor((z - r) / NODE_CELL);
    const j1 = Math.floor((z + r) / NODE_CELL);
    const rr = r * r;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const n of cellNodes(i, j)) {
          const dx = n.x - x;
          const dz = n.z - z;
          if (dx * dx + dz * dz <= rr) out.push(n);
        }
      }
    }
    return out;
  }

  /** Static build rules (§11.2): the safe hub and the 500 m no-build buffer around it. */
  function isBuildable(x, z) {
    if (inHub(x, z)) return { ok: false, reason: 'safe' };
    if (hubDist(x, z) < HUB.noBuild) return { ok: false, reason: 'hub' };
    return { ok: true };
  }

  return { kind: 'standin', heightAt, isWater, isSafe, hubDist, biomeAt, spawnRules, nodesNear, isBuildable };
}
