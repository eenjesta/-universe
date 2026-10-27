import { sstep, len2, footprintGrass, SPACEPORT } from './shape.js';
import { ZONES, WORLD } from '../layout.js';
import { createFastNoise } from './noise.js';

// short/no grass where buildings stand (grass would poke through floors):
// footprints live in shape.js (FOOTPRINTS + the spaceport apron)
const BASE = ZONES.base;
const FP_BOX = { minX: SPACEPORT.rect.minX - 40, maxX: 640, minZ: SPACEPORT.rect.minZ - 40, maxZ: 400 };
const PLOT = { x: BASE.buildArea.x, z: BASE.buildArea.z, h: BASE.buildArea.size / 2 + 2 };
// the spawn ledge is a weathered rock outcrop (title-view foreground)
const SPAWN = ZONES.spawn;
import { sampleCoarse } from './heightfield.js';

/**
 * Per-sample surface data for the terrain material, grass and scatter
 * (all at the 1201² grid resolution, RGBA8):
 *   normal : R,G = world normal x,z (·0.5+0.5)  B = cavity (0.5 neutral)  A = moisture
 *   splatA : R = sand   G = canyon (red)  B = jungle (lush)  A = pad / bare dirt
 *   splatB : R = rock override (cliffs)  G = wetness  B = grass density  A = forest floor
 * Also returns a Float32 slope array (1 − n.y) used by the scatter rules and
 * `outcrop` (Uint8): exposed bedrock patches on hillsides (material rock +
 * boulder scatter share it), incl. the slab-and-grass spawn ledge.
 */
export function computeSurface(data) {
  const { N, STEP, HALF, heights } = data;
  const size = N * N;
  const normal = new Uint8Array(size * 4);
  const splatA = new Uint8Array(size * 4);
  const splatB = new Uint8Array(size * 4);
  const slopeArr = new Float32Array(size);
  const outcropArr = new Uint8Array(size);
  const cav = cavity(heights, N, 4);
  const noise = createFastNoise(`${WORLD.seed}-surface`);
  const { moist, jungle, mount } = data.coarse;
  const roadReg = data.roads.region;
  const inv2s = 1 / (2 * STEP);
  // coarse (4 m) fields bilinearly upsampled one row at a time (exactly what
  // sampleCoarse returns at the 2 m sample positions, without per-sample calls)
  const CN = data.coarse.n;
  const rMo = new Float32Array(N);
  const rJu = new Float32Array(N);
  const rMt = new Float32Array(N);
  const rFo = new Float32Array(N);
  const forest = data.forest;

  const C = { N, STEP, HALF, heights, normal, splatA, splatB, slopeArr, outcropArr, noise, cav, roadReg, inv2s, rMo, rJu, rMt, rFo, forest, data };
  for (let j = 0; j < N; j++) {
    upRow(moist, CN, j, rMo);
    upRow(jungle, CN, j, rJu);
    upRow(mount, CN, j, rMt);
    if (forest) upRow(forest, CN, j, rFo);
    surfaceRow(C, j);
  }
  return { normal, splatA, splatB, slope: slopeArr, outcrop: outcropArr };
}

/** One 2 m row of the surface masks (own function: keeps V8's inlining budget for the helpers). */
function surfaceRow(C, j) {
  const { N, STEP, HALF, heights, normal, splatA, splatB, slopeArr, outcropArr, noise, cav, roadReg, inv2s, rMo, rJu, rMt, rFo, forest, data } = C;
  const z = -HALF + j * STEP;
  const jm = j > 0 ? j - 1 : 0;
  const jp = j < N - 1 ? j + 1 : N - 1;
  for (let i = 0; i < N; i++) {
    const x = -HALF + i * STEP;
    const k = j * N + i;
    const im = i > 0 ? i - 1 : 0;
    const ip = i < N - 1 ? i + 1 : N - 1;
    const h = heights[k];
    const gx = (heights[j * N + im] - heights[j * N + ip]) * inv2s;
    const gz = (heights[jm * N + i] - heights[jp * N + i]) * inv2s;
    const il = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
    const nx = gx * il;
    const ny = il;
    const nz = gz * il;
    const slope = 1 - ny;
    slopeArr[k] = slope;

    const mo = rMo[i];
    const ju = rJu[i];
    const mt = rMt[i];
    const fo = forest ? rFo[i] : 0;
    const canyon = data.canyon[k] / 255;
    const pad = data.pad[k] / 255;
    const cliff = data.cliff[k] / 255;
    const rocky = data.rocky[k] / 255;
    const wetR = data.wetRiver[k] / 255;
    const city = data.city[k] / 255;
    const sd = data.shore[k];
    const nearWater = sd < 70 ? 1 : 0;
    const rd = roadReg.get(i, j); // signed distance to the paving edge

    // sand: lake/sea beaches, island shores, river gravel, canyon flats
    let sand = nearWater * (1 - sstep(1.1, 2.6, h)) * (1 - sstep(0.2, 0.36, slope)) * (1 - sstep(0.55, 0.85, rocky));
    if (h < -0.5) sand = Math.max(sand, 0.55 * (1 - sstep(0.25, 0.5, slope)));
    sand = Math.max(sand, wetR * 0.7);
    sand = Math.max(sand, canyon * (1 - sstep(0.06, 0.2, slope)) * 0.85);
    sand *= 1 - city;

    // rock override: cliffs, the high mountains, hillside outcrops, the spawn ledge
    let rock = Math.max(cliff, sstep(230, 330, h) * 0.6 * (0.5 + mt));
    // exposed bedrock on slopes: patchy (~25 m) and broken up (~6 m), more where
    // the macro rockiness is high; none on beaches, pads, roads, city, canyon floors
    let outcrop = 0;
    if (slope > 0.08 && h > 1.5 && city < 0.01) {
      const on = noise.fbm(x * 0.04 + 3.1, z * 0.04 - 7.7, 2) + 0.3 * noise.n2(x * 0.17 + 1.3, z * 0.17 + 5.5);
      outcrop = sstep(0.1, 0.28, slope + 0.06 * on) * sstep(0.12, 0.4, on + 0.42 * rocky - 0.12 + 0.25 * mt);
      outcrop *= (1 - 0.85 * canyon) * (1 - 0.7 * ju) * (1 - pad) * sstep(1.5, 4, h);
      if (rd < 6) outcrop *= sstep(2, 6, rd);
    }
    // the spawn ledge: weathered slabs with dry grass in the gaps (hero foreground)
    let ledgeGrass = 0;
    const dSp = len2(x - SPAWN.x, z - SPAWN.z);
    if (dSp < 46) {
      const core = 1 - sstep(12, 44, dSp);
      const patch = noise.fbm(x * 0.12 + 9.2, z * 0.12 - 4.4, 2) + 0.35 * noise.n2(x * 0.34 - 2.7, z * 0.34 + 0.6);
      const slabs = sstep(-0.12, 0.16, patch + 0.22 * core - 0.08);
      outcrop = Math.max(outcrop, core * slabs);
      ledgeGrass = core * (1 - slabs);
    }
    rock = Math.max(rock, outcrop * 0.94);
    outcropArr[k] = clamp01(outcrop) * 255;
    // bare dirt: pads, road shoulders, worn ground
    let dirt = pad;
    if (rd < 3.5) dirt = Math.max(dirt, 1 - sstep(1.5, 3.5, rd));
    dirt = Math.max(dirt, city * 0.55);

    // wetness: shoreline band, underwater bed, river banks
    let wet = nearWater * (1 - sstep(0.12, 0.95, h));
    wet = Math.max(wet, wetR);

    // grass density (GPU grass + material tint)
    let grass = 1 - sstep(0.3, 0.46, slope);
    grass *= 1 - sand;
    grass *= 1 - rock;
    grass *= sstep(0.35, 1.1, h);
    grass *= 1 - dirt * 0.92;
    grass *= 1 - city * 0.8;
    grass *= 1 - canyon * 0.86;
    grass *= 1 - sstep(170, 245, h);
    grass *= 1 - fo * 0.45;
    if (ju > 0) grass = Math.max(grass, ju * 0.95 * (1 - sstep(0.35, 0.5, slope)) * sstep(0.5, 1.2, h));
    if (ledgeGrass > 0) grass = Math.max(grass, 0.78 * ledgeGrass);
    if (grass > 0) grass *= footprintGrassFast(x, z);
    if (Math.abs(x - PLOT.x) < PLOT.h && Math.abs(z - PLOT.z) < PLOT.h) grass *= 0.12;

    const o = k * 4;
    normal[o] = (nx * 0.5 + 0.5) * 255;
    normal[o + 1] = (nz * 0.5 + 0.5) * 255;
    normal[o + 2] = cav[k];
    normal[o + 3] = clamp01(mo + ju * 0.4) * 255;
    splatA[o] = clamp01(sand) * 255;
    splatA[o + 1] = canyon * 255;
    splatA[o + 2] = clamp01(ju) * 255;
    splatA[o + 3] = clamp01(dirt) * 255;
    splatB[o] = clamp01(rock) * 255;
    splatB[o + 1] = clamp01(wet) * 255;
    splatB[o + 2] = clamp01(grass) * 255;
    splatB[o + 3] = clamp01(fo) * 255;
  }
}

/** Row j of the 2 m grid from a CN² 4 m grid (bilinear, half-way samples averaged). */
function upRow(src, cn, j, out) {
  const cj = j >> 1;
  const cj2 = (j & 1) === 1 && cj + 1 < cn ? cj + 1 : cj;
  const a = cj * cn;
  const b = cj2 * cn;
  const n = out.length;
  for (let i = 0; i < n; i += 2) {
    const ci = i >> 1;
    out[i] = (src[a + ci] + src[b + ci]) * 0.5;
  }
  for (let i = 1; i < n; i += 2) out[i] = (out[i - 1] + out[i + 1]) * 0.5;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Cavity term: 128 + k·(local mean − height), separable box blur of radius r. */
function cavity(h, n, r) {
  const tmp = new Float32Array(n * n);
  const out = new Uint8Array(n * n);
  const w = 2 * r + 1;
  for (let j = 0; j < n; j++) {
    let sum = 0;
    const row = j * n;
    for (let i = -r; i <= r; i++) sum += h[row + Math.min(n - 1, Math.max(0, i))];
    for (let i = 0; i < n; i++) {
      tmp[row + i] = sum / w;
      sum += h[row + Math.min(n - 1, i + r + 1)] - h[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -r; j <= r; j++) sum += tmp[Math.min(n - 1, Math.max(0, j)) * n + i];
    for (let j = 0; j < n; j++) {
      const k = j * n + i;
      const v = 128 + (sum / w - h[k]) * 26;
      out[k] = v < 0 ? 0 : v > 255 ? 255 : v;
      sum += tmp[Math.min(n - 1, j + r + 1) * n + i] - tmp[Math.max(0, j - r) * n + i];
    }
  }
  return out;
}

/** footprintGrass with a cheap bounding pre-check (it runs for every 2 m sample). */
const FP_CIRCLES = [ZONES.plaza, ZONES.lookout, ZONES.signal, BASE.landingPad, BASE.house];
function footprintGrassFast(x, z) {
  let near = x > FP_BOX.minX && x < FP_BOX.maxX && z > FP_BOX.minZ && z < FP_BOX.maxZ;
  if (!near) {
    for (let i = 0; i < FP_CIRCLES.length; i++) {
      const c = FP_CIRCLES[i];
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < 120 * 120) {
        near = true;
        break;
      }
    }
  }
  return near ? footprintGrass(x, z) : 1;
}
