/**
 * Seeded hashing + fast 2D noise for the world generator (pure JS, no DOM /
 * Node APIs, no three.js). Everything is allocation-free in the hot paths and
 * uses only + − × ÷, floor and sqrt (no trig / exp / pow), so results are
 * bit-identical in every JS engine (server V8, Safari JSC, workers).
 *
 *   hashString(str) → uint32           FNV-1a + avalanche
 *   hash2(i, j, seed) / hash3(i, j, k, seed) → uint32
 *   u01(h) → [0, 1)                    uint32 → unit float
 *   mulberry32(seed) → () → [0, 1)     small PRNG (setup code only)
 *   createNoise(seed) → { n2, fbm2, fbm3, fbm4, ridged }   simplex-based, values ≈ [-1, 1]
 */

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return avalanche(h);
}

function avalanche(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of two integers + a seed → uint32 (well mixed, cheap). */
export function hash2(i, j, seed) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hash3(i, j, k, seed) {
  return hash2(i, (j | 0) ^ Math.imul(k | 0, 0x9e3779b1), seed);
}

/** uint32 → [0, 1). */
export const u01 = (h) => (h >>> 0) / 4294967296;

/** Next hash in a per-item sequence (for several random numbers from one seed). */
export const nextHash = (h) => avalanche((h + 0x9e3779b9) | 0);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.36602540378443865; // (sqrt(3) - 1) / 2
const G2 = 0.21132486540518713; // (3 - sqrt(3)) / 6
const G2X2M1 = 2 * G2 - 1;
// 12 gradient directions (unit-ish), as in the classic simplex reference
const GX = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]);
const GY = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1]);
// rotated variants of the 12 gradients so the diagonal bias of the set averages out
const GX2 = new Float64Array(12);
const GY2 = new Float64Array(12);
{
  // rotation by ~22.5° (cos, sin as literals → engine independent)
  const c = 0.9238795325112867;
  const s = 0.3826834323650898;
  for (let i = 0; i < 12; i++) {
    let x = GX[i];
    let y = GY[i];
    if (i >= 4 && i < 8) x *= 1.4142135623730951;
    if (i >= 8) y *= 1.4142135623730951;
    GX2[i] = (x * c - y * s) * 0.7071067811865476 * 1.08;
    GY2[i] = (x * s + y * c) * 0.7071067811865476 * 1.08;
  }
}

/**
 * Seeded 2D simplex noise + fractal sums. Each octave of a fractal sum is
 * offset and slightly rotated so lattice artefacts never line up.
 */
export function createNoise(seed) {
  const s0 = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  const perm = new Uint8Array(512);
  const pm12 = new Uint8Array(512);
  {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    const rnd = mulberry32(s0 || 1);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
      pm12[i] = perm[i] % 12;
    }
  }

  /** Simplex noise, ≈ [-1, 1]. */
  function n2(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    let i1 = 0;
    let j1 = 1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 + G2X2M1;
    const y2 = y0 + G2X2M1;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = pm12[ii + perm[jj]];
      t0 *= t0;
      n += t0 * t0 * (GX2[g] * x0 + GY2[g] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = pm12[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n += t1 * t1 * (GX2[g] * x1 + GY2[g] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = pm12[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n += t2 * t2 * (GX2[g] * x2 + GY2[g] * y2);
    }
    return 70 * n;
  }

  // per-octave rotation (≈ 37°) + offsets; literals keep it engine independent
  const RC = 0.7986355100472928;
  const RS = 0.6018150231520483;

  /** 2-octave fBm (normalised to ≈ [-1, 1]). */
  function fbm2(x, y) {
    let v = n2(x, y);
    const x2 = (x * RC - y * RS) * 2.03 + 17.31;
    const y2 = (x * RS + y * RC) * 2.03 - 9.17;
    v += 0.5 * n2(x2, y2);
    return v * 0.6666666666666666;
  }

  /** 3-octave fBm. */
  function fbm3(x, y) {
    let v = n2(x, y);
    let ax = (x * RC - y * RS) * 2.03 + 17.31;
    let ay = (x * RS + y * RC) * 2.03 - 9.17;
    v += 0.5 * n2(ax, ay);
    const bx = (ax * RC - ay * RS) * 2.01 - 31.7;
    const by = (ax * RS + ay * RC) * 2.01 + 5.13;
    v += 0.25 * n2(bx, by);
    return v * 0.5714285714285714;
  }

  /** 4-octave fBm. */
  function fbm4(x, y) {
    let v = n2(x, y);
    let ax = (x * RC - y * RS) * 2.03 + 17.31;
    let ay = (x * RS + y * RC) * 2.03 - 9.17;
    v += 0.5 * n2(ax, ay);
    let bx = (ax * RC - ay * RS) * 2.01 - 31.7;
    let by = (ax * RS + ay * RC) * 2.01 + 5.13;
    v += 0.25 * n2(bx, by);
    ax = (bx * RC - by * RS) * 2.02 + 3.71;
    ay = (bx * RS + by * RC) * 2.02 - 47.9;
    v += 0.125 * n2(ax, ay);
    return v * 0.5333333333333333;
  }

  /**
   * Ridged multifractal in [0, 1]: sharp crests (1) along the noise's zero
   * lines, finer octaves weighted by the coarser crest value (dendritic ridges
   * on the high ground, smooth valleys).
   */
  function ridged(x, y, octaves) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let w = 1;
    let ax = x;
    let ay = y;
    for (let o = 0; o < octaves; o++) {
      let r = 1 - Math.abs(n2(ax, ay));
      r *= r;
      const ww = w < 0 ? 0 : w > 1 ? 1 : w;
      sum += r * amp * ww;
      norm += amp;
      w = r * 1.6;
      amp *= 0.5;
      const nx = (ax * RC - ay * RS) * 2.07 + 13.7;
      ay = (ax * RS + ay * RC) * 2.07 - 21.3;
      ax = nx;
    }
    return sum / norm;
  }

  return { seed: s0, n2, fbm2, fbm3, fbm4, ridged };
}

// ------------------------------------------------------------------ small maths
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function sstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
export const mix = (a, b, t) => a + (b - a) * t;
