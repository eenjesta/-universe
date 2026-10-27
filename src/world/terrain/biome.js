import { ZONES, CITY_ISLANDS, ISLANDS } from '../layout.js';
import { sstep, mix, JUNGLE, CANYON, len2 } from './shape.js';
import { sampleGrid, sampleCoarse } from './heightfield.js';

/**
 * Biome fields shared by the material, the scatter and the minimap:
 *   forest density (coarse 4 m grid): patchy woods, a forest ring around the
 *   base clearing, wooded islands and far shores, dense jungle, sparse canyon,
 *   no trees above the tree line or in the title view cone north of the spawn.
 */

/**
 * Title/hero view cone north of the spawn (matches the headland sector in
 * shape.js): keep it open — no forest, only low vegetation. 0 inside → 1 out.
 */
export function spawnViewFactor(x, z) {
  const s = ZONES.spawn;
  const dx = x - s.x;
  const dz = z - s.z;
  if (dz > -8) return 1;
  const dist = len2(dx, dz);
  const ang = Math.abs(Math.atan2(dx, -dz)); // 0 = due north
  const cone = 1 - sstep(0.62, 0.92, ang); // ±35–53°
  const range = 1 - sstep(260, 330, dist);
  return 1 - cone * range;
}

export function computeForest(data, noise) {
  const cn = data.coarse.n;
  const out = new Float32Array(cn * cn);
  for (let cj = 0; cj < cn; cj++) forestRow(data, noise, cj, out);
  return out;
}

/** One coarse row of the forest field (own function: keeps V8's inlining budget). */
function forestRow(data, noise, cj, out) {
  const { n: cn, step: cs, moist, jungle, canyon, mount } = data.coarse;
  const half = data.HALF;
  const base = ZONES.base;
  const plaza = ZONES.plaza;
  const z = -half + cj * cs;
  for (let ci = 0; ci < cn; ci++) {
    const x = -half + ci * cs;
    const k = cj * cn + ci;
    const h = sampleGrid(data.heights, x, z);
    if (h < 1.2) continue;
    let f = 0.36 + 0.75 * noise.fbm(x * 0.0032 + 5.1, z * 0.0032 - 2.7, 3);
    f += 0.35 * (moist[k] - 0.5);
    // forest ring around the base clearing (glass house among pines)
    const db = len2(x - base.x, z - base.z);
    f += 0.75 * sstep(base.radius + 4, base.radius + 30, db) * (1 - sstep(220, 320, db));
    // islands are wooded
    for (let q = 0; q < ISLANDS.length; q++) {
      const isl = ISLANDS[q];
      if (len2(x - isl.x, z - isl.z) < isl.radius) f += 0.6;
    }
    // far shores (NW) and the southern foothills are forested
    f += 0.25 * sstep(-500, -720, z) * sstep(-300, -520, x);
    f += 0.2 * sstep(380, 620, z);
    // dense jungle
    f = mix(f, 0.95 + 0.2 * noise.n2(x * 0.01, z * 0.01), jungle[k]);
    // open areas
    f *= spawnViewFactor(x, z);
    const dp = len2(x - plaza.x, z - plaza.z);
    f *= 0.25 + 0.75 * sstep(plaza.radius + 30, plaza.radius + 150, dp);
    f *= 1 - 0.93 * canyon[k];
    // tree line
    f *= 1 - sstep(185, 265, h + 30 * mount[k]);
    for (let q = 0; q < CITY_ISLANDS.length; q++) {
      const c = CITY_ISLANDS[q];
      if (len2(x - c.x, z - c.z) < c.radius + 10) f = 0;
    }
    out[k] = f < 0 ? 0 : f > 1 ? 1 : f;
  }
}

/** Forest density at (x, z) from the coarse field. */
export function forestAt(data, x, z) {
  return sampleCoarse(data.forest, x, z);
}

export { JUNGLE, CANYON };
