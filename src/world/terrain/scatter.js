import { ZONES, WORLD } from '../layout.js';
import { Rng } from '../../core/math.js';
import { hash2 } from './noise.js';
import { sstep, spaceportDistance, PADS, len2, footprintDistance } from './shape.js';
import { sampleCoarse } from './heightfield.js';
import { spawnViewFactor } from './biome.js';

/**
 * Seeded vegetation placement. Jittered grids per layer; each candidate is
 * tested against the baked masks (water, slope, cliffs, roads, river, zone
 * pads, spaceport, city land) and accepted by biome-dependent densities
 * (forest field, jungle, canyon, altitude, moisture).
 *
 * Returns { layerName: [{x, y, z, ry, s, tx, tz, color}] } with every list
 * shuffled (density truncation = random subset).
 */

/** Mask lookups at the nearest 2 m grid sample. */
export function createSampler(data, q) {
  const { N, STEP, HALF } = data;
  const idx = (x, z) => {
    let i = Math.round((x + HALF) / STEP);
    let j = Math.round((z + HALF) / STEP);
    i = i < 0 ? 0 : i >= N ? N - 1 : i;
    j = j < 0 ? 0 : j >= N ? N - 1 : j;
    return [i, j, j * N + i];
  };
  return {
    h: q.getHeightAt,
    at(x, z) {
      const [i, j, k] = idx(x, z);
      const ri = data.river.index(i, j);
      return {
        k,
        slope: data.slope[k],
        cliff: data.cliff[k] / 255,
        pad: data.pad[k] / 255,
        canyon: data.canyon[k] / 255,
        city: data.city[k] / 255,
        rocky: data.rocky[k] / 255,
        outcrop: data.outcrop ? data.outcrop[k] / 255 : 0,
        shore: data.shore[k],
        road: data.roads.region.get(i, j),
        river: ri >= 0 && data.river.cap[ri] === 0 ? data.river.dist[ri] - data.river.halfWidth[ri] : 1e9,
        jungle: sampleCoarse(data.coarse.jungle, x, z),
        moist: sampleCoarse(data.coarse.moist, x, z),
        mount: sampleCoarse(data.coarse.mount, x, z),
        forest: sampleCoarse(data.forest, x, z),
      };
    },
  };
}

/** Zone exclusion: distance outside the zone pad (negative inside). */
export function zoneClearance(x, z) {
  let best = 1e9;
  for (const p of PADS) {
    const d = len2(x - p.x, z - p.z) - p.r;
    if (p.id === 'base') {
      // the base keeps its forest ring right outside the clearing
      best = Math.min(best, d + 4);
    } else best = Math.min(best, d - 8);
  }
  best = Math.min(best, spaceportDistance(x, z) - 10);
  // extra clearances around landmark footprints that extend past their pads
  const ruins = ZONES.ruins;
  best = Math.min(best, len2(x - ruins.x, z - ruins.z) - ruins.radius - 22);
  const plaza = ZONES.plaza;
  best = Math.min(best, len2(x - plaza.bazaar.x, z - plaza.bazaar.z) - 50);
  const base = ZONES.base;
  best = Math.min(best, len2(x - base.landingPad.x, z - base.landingPad.z) - 22);
  best = Math.min(best, len2(x - base.house.x, z - base.house.z) - 24);
  // built-up footprints (house rect, obelisk shore, plaza disc, spaceport apron…)
  best = Math.min(best, footprintDistance(x, z) - 4);
  return best;
}

/**
 * Small trees allowed in the hero view cone: on the headland slope (≥ 45 m
 * from the spawn) and not within ±11° of the line of sight to the city.
 */
function heroTreeOk(x, z) {
  const s = ZONES.spawn;
  const dx = x - s.x;
  const dz = z - s.z;
  const d = len2(dx, dz);
  if (d < 45) return false;
  const c = ZONES.city;
  const bCity = Math.atan2(c.x - s.x, -(c.z - s.z));
  let a = Math.atan2(dx, -dz) - bCity;
  a = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
  return a > 0.19;
}

function shuffle(arr, seed) {
  const rng = new Rng(seed);
  return rng.shuffle(arr);
}

export function scatterVegetation(data, q, lib) {
  const S = createSampler(data, q);
  const half = WORLD.half - 6;
  const out = {};
  const push = (name, it) => (out[name] || (out[name] = [])).push(it);
  const signal = ZONES.signal;
  const ruins = ZONES.ruins;
  const base = ZONES.base;
  const lookout = ZONES.lookout;
  const n2 = (x, z) => Math.sin(x * 0.013 + Math.cos(z * 0.011) * 2.1) * Math.cos(z * 0.017 - x * 0.004); // cheap species field

  // common ground test; returns the sample or null
  const ground = (x, z, { maxSlope = 0.42, roadPad = 3.5, zonePad = 0, minH = 1.2 } = {}) => {
    if (x < -half || x > half || z < -half || z > half) return null;
    const h = S.h(x, z);
    if (h < minH) return null;
    const m = S.at(x, z);
    if (m.slope > maxSlope || m.cliff > 0.25 || m.city > 0.01) return null;
    if (m.road < roadPad || m.river < 3) return null;
    if (zoneClearance(x, z) < zonePad) return null;
    m.y = h;
    return m;
  };

  // ------------------------------------------------------------- trees (6 m)
  const TREE = 7;
  for (let gz = -half; gz < half; gz += TREE) {
    for (let gx = -half; gx < half; gx += TREE) {
      const ci = Math.round(gx / TREE);
      const cj = Math.round(gz / TREE);
      const x = gx + hash2(ci, cj, 1) * TREE;
      const z = gz + hash2(ci, cj, 2) * TREE;
      const r = hash2(ci, cj, 3);
      // the hero view cone north of the spawn: only a few small trees on the
      // headland slope (never on the brow or straight in front of the city)
      const svf = spawnViewFactor(x, z);
      const hero = svf < 0.35;
      // cheap early-out with the forest field
      const fq = sampleCoarse(data.forest, x, z);
      if (r > (hero ? 0.05 : fq * 0.86 + 0.02)) continue;
      const m = ground(x, z, { maxSlope: 0.45 });
      if (!m) continue;
      if (m.canyon > 0.3 && r > 0.04) continue;
      if (hero && !heroTreeOk(x, z)) continue;
      const sp = hash2(ci, cj, 4);
      const alt = m.y + m.mount * 60;
      let kind;
      if (hero) kind = sp < 0.5 ? 'spruce' : sp < 0.78 ? 'pineMid' : 'oak';
      else if (m.jungle > 0.5) kind = sp < 0.45 ? 'jungleTree' : sp < 0.7 ? 'palm' : sp < 0.9 ? 'oak' : 'birch';
      else if (m.canyon > 0.3) kind = sp < 0.55 ? 'acacia' : 'spruce';
      else if (alt > 120) kind = sp < 0.45 ? 'pineTall' : sp < 0.8 ? 'spruce' : 'pineMid';
      else if (len2(x - base.x, z - base.z) < 300) kind = sp < 0.38 ? 'pineTall' : sp < 0.68 ? 'pineMid' : sp < 0.84 ? 'spruce' : 'birch';
      else if (m.shore < 70 && m.y < 14) kind = sp < 0.4 ? 'oak' : sp < 0.68 ? 'birch' : 'pineMid';
      else {
        const conifer = n2(x, z) * 0.5 + 0.5 < 0.55;
        kind = conifer ? (sp < 0.35 ? 'pineTall' : sp < 0.75 ? 'pineMid' : 'spruce') : sp < 0.55 ? 'oak' : sp < 0.85 ? 'birch' : 'acacia';
      }
      const sc = hero ? 0.55 + hash2(ci, cj, 5) * 0.3 : 0.72 + hash2(ci, cj, 5) * 0.55;
      const dry = Math.max(0, 0.5 - m.moist) + m.canyon * 0.6;
      const v = 0.88 + hash2(ci, cj, 6) * 0.24;
      push(kind, {
        x, z, y: m.y - 0.2,
        ry: hash2(ci, cj, 7) * Math.PI * 2,
        s: sc,
        sy: sc * (0.9 + hash2(ci, cj, 8) * 0.22),
        tx: (hash2(ci, cj, 9) - 0.5) * 0.08,
        tz: (hash2(ci, cj, 10) - 0.5) * 0.08,
        color: [v * (1 + dry * 0.25), v * (1 + dry * 0.08), v * (1 - dry * 0.3)],
      });
    }
  }

  // ----------------------------------------------------------- bushes (5 m)
  const BUSH = 5;
  for (let gz = -half; gz < half; gz += BUSH) {
    for (let gx = -half; gx < half; gx += BUSH) {
      const ci = Math.round(gx / BUSH);
      const cj = Math.round(gz / BUSH);
      const x = gx + hash2(ci, cj, 11) * BUSH;
      const z = gz + hash2(ci, cj, 12) * BUSH;
      const r = hash2(ci, cj, 13);
      if (r > 0.16) continue;
      const m = ground(x, z, { maxSlope: 0.5, roadPad: 2.5, zonePad: -2 });
      if (!m) continue;
      const edge = 4 * m.forest * (1 - m.forest);
      let p = 0.012 + 0.07 * edge + 0.02 * m.moist + 0.04 * m.rocky * (1 - m.canyon) + 0.06 * m.outcrop;
      if (spawnViewFactor(x, z) < 0.5 && len2(x - ZONES.spawn.x, z - ZONES.spawn.z) > 30) p += 0.05;
      if (m.canyon > 0.3) p = 0.03;
      if (m.y > 230) p *= 0.3;
      if (r > p) continue;
      const juniper = m.canyon > 0.3 || m.y > 120 || m.moist < 0.35;
      const sc = 0.6 + hash2(ci, cj, 14) * 0.85;
      const v = 0.85 + hash2(ci, cj, 15) * 0.3;
      push(juniper ? 'bushJuniper' : 'bushGreen', {
        x, z, y: m.y - 0.15, ry: hash2(ci, cj, 16) * 6.283, s: sc, sy: sc * (0.8 + hash2(ci, cj, 17) * 0.4),
        color: juniper ? [v * 1.05, v, v * 0.85] : [v, v, v],
      });
    }
  }

  // ------------------------------------------------ undergrowth + flowers (3 m)
  const SMALL = 3;
  for (let gz = -half; gz < half; gz += SMALL) {
    for (let gx = -half; gx < half; gx += SMALL) {
      const ci = Math.round(gx / SMALL);
      const cj = Math.round(gz / SMALL);
      const r = hash2(ci, cj, 21);
      if (r > 0.3) continue;
      const x = gx + hash2(ci, cj, 22) * SMALL;
      const z = gz + hash2(ci, cj, 23) * SMALL;
      const fq = sampleCoarse(data.forest, x, z);
      const ju = sampleCoarse(data.coarse.jungle, x, z);
      const dSig = len2(x - signal.x, z - signal.z);
      const dRu = len2(x - ruins.x, z - ruins.z);
      const dBase = len2(x - base.x, z - base.z);
      const dSpawn = len2(x - ZONES.spawn.x, z - ZONES.spawn.z);
      // quick reject far from anything interesting
      if (fq < 0.25 && ju < 0.1 && dSig > 110 && dRu > 140 && r > 0.03 && dBase > 120 && dSpawn > 240) continue;
      const m = ground(x, z, { maxSlope: 0.5, roadPad: 1.5, zonePad: -4, minH: 0.6 });
      if (!m) continue;
      const k = hash2(ci, cj, 24);
      const sc = 0.7 + hash2(ci, cj, 25) * 0.6;
      const it = { x, z, y: m.y - 0.05, ry: hash2(ci, cj, 26) * 6.283, s: sc };
      const glowZone = Math.max(1 - sstep(25, 90, dSig), (1 - sstep(40, 120, dRu)) * 0.8, ju * 0.6);
      if (m.jungle > 0.4) {
        if (r < 0.1) push(k < 0.55 ? 'fern' : 'tropic', it);
        else if (r < 0.125) push('glowPlant', { ...it, s: sc * 1.2 });
        else if (r < 0.15) push('flowersGlow', it);
      } else if (glowZone > 0.2 && r < 0.06 * glowZone) {
        push(k < 0.45 ? 'glowPlant' : 'flowersGlow', it);
      } else if (m.forest > 0.45 && r < 0.09 * m.forest) {
        push('fern', it);
      } else if (m.canyon > 0.3) {
        if (r < 0.05) push('tuftDry', { ...it, color: [1.05, 0.95, 0.8] });
      } else if (r < (dSpawn < 240 ? 0.05 : 0.022) * (0.3 + m.moist) * (1 - m.forest) && m.slope < 0.3) {
        push('flowersMeadow', it);
      } else if (dSpawn > 60 && dSpawn < 240 && r < 0.035 && m.slope < 0.4 && m.outcrop < 0.5) {
        push('tuftDry', { ...it, s: it.s * 0.8 });
      } else if (m.moist < 0.45 && r < 0.03 && m.slope < 0.35) {
        push('tuftDry', it);
      }
    }
  }
  // violet glow accents ringed around the signal and at the base clearing edge
  const accents = new Rng('terrain-accents');
  const ring = (cx, cz, r0, r1, n, kinds) => {
    for (let i = 0; i < n; i++) {
      const a = accents.random() * Math.PI * 2;
      const d = r0 + accents.random() * (r1 - r0);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const m = ground(x, z, { maxSlope: 0.55, roadPad: 1, zonePad: -1000, minH: 0.4 });
      if (!m) continue;
      push(accents.pick(kinds), { x, z, y: m.y - 0.05, ry: accents.random() * 6.283, s: 0.8 + accents.random() * 0.5 });
    }
  };
  ring(signal.x, signal.z, signal.radius + 2, signal.radius + 26, 70, ['flowersGlow', 'flowersGlow', 'glowPlant']);
  ring(ruins.x, ruins.z, ruins.radius + 4, ruins.radius + 40, 60, ['flowersGlow', 'fern', 'glowPlant']);
  ring(base.x, base.z, base.radius - 4, base.radius + 16, 40, ['flowersGlow', 'flowersMeadow', 'fern']);
  ring(lookout.x, lookout.z, lookout.radius + 2, lookout.radius + 20, 30, ['tuftDry', 'flowersMeadow']);
  ring(ZONES.spawn.x, ZONES.spawn.z, 8, 34, 26, ['flowersMeadow', 'flowersMeadow', 'flowersGlow']);

  let seed = 1;
  for (const k of Object.keys(out)) out[k] = shuffle(out[k], `veg-${k}-${seed++}`);
  return out;
}

export { spawnViewFactor };
