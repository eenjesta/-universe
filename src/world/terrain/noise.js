import { createNoise } from '../../core/noise.js';

/**
 * Fast seeded 2D noise for the terrain bake.
 *
 * Uses the permutation table of `core/noise.js` (same seed → identical values
 * to `createNoise(seed).n2`), but evaluates it with typed arrays and no
 * per-call allocations, which is ~1.5–2× faster than three's SimplexNoise.
 * The heightfield evaluates millions of samples at install, so this matters.
 * Pure JS (no DOM, no three.js objects) so it also runs in Node tests.
 */
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const G22 = 2 * G2 - 1;
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0],
  [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1],
];

export function createFastNoise(seed = 'o-universe') {
  const base = createNoise(seed);
  const perm = new Int32Array(512);
  const pm12 = new Int32Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = base.simplex.perm[i];
    pm12[i] = perm[i] % 12;
  }
  const GX = new Float64Array(12);
  const GY = new Float64Array(12);
  for (let i = 0; i < 12; i++) {
    GX[i] = GRAD[i][0];
    GY[i] = GRAD[i][1];
  }

  /** Simplex noise in [-1, 1] (bit-identical to core noise n2). */
  function n2(xin, yin) {
    const s = (xin + yin) * F2;
    const xs = xin + s;
    const ys = yin + s;
    let i = xs | 0;
    if (xs < i) i--;
    let j = ys | 0;
    if (ys < j) j--;
    const t = (i + j) * G2;
    const x0 = xin - i + t;
    const y0 = yin - j + t;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = pm12[ii + perm[jj]];
      t0 *= t0;
      n += t0 * t0 * (GX[g] * x0 + GY[g] * y0);
    }
    let x1;
    let y1;
    let g1;
    if (x0 > y0) {
      x1 = x0 - 1 + G2;
      y1 = y0 + G2;
      g1 = pm12[ii + 1 + perm[jj]];
    } else {
      x1 = x0 + G2;
      y1 = y0 - 1 + G2;
      g1 = pm12[ii + perm[jj + 1]];
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      n += t1 * t1 * (GX[g1] * x1 + GY[g1] * y1);
    }
    const x2 = x0 + G22;
    const y2 = y0 + G22;
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = pm12[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n += t2 * t2 * (GX[g] * x2 + GY[g] * y2);
    }
    return 70 * n;
  }

  /** fBm in roughly [-1, 1]. */
  function fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * n2(x, y);
      norm += amp;
      amp *= gain;
      x *= lacunarity;
      y *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1] (sharp crests). */
  function ridged(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 0.5;
    let sum = 0;
    let norm = 0;
    let prev = 1;
    for (let o = 0; o < octaves; o++) {
      let v = 1 - Math.abs(n2(x, y));
      v *= v;
      sum += v * amp * prev;
      norm += amp;
      prev = v;
      amp *= gain;
      x *= lacunarity;
      y *= lacunarity;
    }
    return sum / norm;
  }

  return { n2, fbm, ridged, perm };
}

/** Integer hash → [0, 1) (stateless, for per-cell jitter). */
export function hash2(ix, iz, seed = 0) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
