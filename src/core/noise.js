import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { Rng } from './math.js';

/**
 * Seeded noise helpers. `createNoise('terrain')` returns an object whose
 * functions are deterministic for the given seed, so every module that asks
 * for the same seed gets the same field (e.g. the minimap and the terrain).
 */
export function createNoise(seed = 'o-universe') {
  const rng = new Rng(seed);
  const simplex = new SimplexNoise({ random: () => rng.random() });

  const n2 = (x, y) => simplex.noise(x, y); // [-1, 1]
  const n3 = (x, y, z) => simplex.noise3d(x, y, z);

  /** Fractal Brownian motion, returns roughly [-1, 1]. */
  function fbm2(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal, returns [0, 1]; good for mountain crests. */
  function ridged2(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    let prev = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(n2(x * freq, y * freq));
      n *= n;
      sum += n * amp * prev;
      norm += amp;
      prev = n;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Domain-warped fbm for organic shapes (lake shores, biomes). */
  function warped2(x, y, warp = 0.6, octaves = 4) {
    const wx = fbm2(x + 13.1, y - 7.7, 3);
    const wy = fbm2(x - 21.4, y + 3.3, 3);
    return fbm2(x + wx * warp, y + wy * warp, octaves);
  }

  return { n2, n3, fbm2, ridged2, warped2, simplex };
}
