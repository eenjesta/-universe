import { createFastNoise } from './noise.js';
import {
  GRID_N, GRID_STEP, HALF, LAKE, ISLANDS, CITY_ISLANDS, WATERFALLS, WORLD,
  ESCARPMENTS, LIPS, RIDGE, PADS, SPACEPORT, spaceportDistance, JUNGLE, CANYON, HEADLAND, headlandHeight,
  TRACK_POLY, TRACK_SPLINE, RIVER_LINES, ROAD_LINES, RACE_TRACK, ZONES,
  sstep, mix, smin, smax, ellipseSD, coastZ, makeIslets,
} from './shape.js';

/**
 * Heightfield bake (pure JS, no DOM): builds the 1201² height grid (2 m) and
 * per-sample feature flags from layout.js.
 *
 *   1. coarse pass (4 m): smooth land (hills, mountains, ridge, plateaus),
 *      warped shoreline distance, canyon/jungle masks, mesa noise, moisture
 *   2. full pass (2 m), streaming a bicubic 2× upsample of the coarse fields:
 *      fine detail, canyon mesas + race-track floor, shore profile (beaches,
 *      rocky shores, lake bed), islands, city land, escarpment cliffs at the
 *      waterfalls, zone pads, rivers, plunge pools
 *   3. roads: smoothed grade profiles stamped as flat corridors
 *
 * Deterministic for WORLD.seed. The hot loops live in small synchronous
 * per-row functions (V8 inlines the helpers there; the async driver only
 * yields between row bands). Polyline stamps cover their feature region only.
 */

// typed scratch slots (object fields holding doubles would allocate on every write)
const S_H = 0;
const S_CLIFF = 1;
const S_ROCKY = 2;
const S_PADW = 3;
const S_PADFULL = 4;
const S_CITY = 5;
const S_CANYON = 6;
const S_FINE = 7;
const S_WETRIVER = 8;
const M_SX = 0;
const M_SZ = 1;
const M_QX = 2;
const M_QZ = 3;
const M_MOIST = 4;
const M_ROCKY = 5;
const M_DEPTH = 6;
const N_D = 0;
const N_S = 1;
const N_T = 2;
const N_V = 3;

const N = GRID_N; // 1201
const STEP = GRID_STEP; // 2 m
const CN = (N + 1) / 2; // 601 coarse samples (4 m)
const CSTEP = STEP * 2;
const HALF_TRACK = RACE_TRACK.width / 2;

const CANYON_BOX = { minX: CANYON.x - 420, maxX: CANYON.x + 420, minZ: CANYON.z - 420, maxZ: CANYON.z + 420 };
const JUNGLE_BOX = { minX: JUNGLE.x - 340, maxX: JUNGLE.x + 340, minZ: JUNGLE.z - 340, maxZ: JUNGLE.z + 340 };
const SPACEPORT_BOX = {
  minX: SPACEPORT.rect.minX - 140, maxX: SPACEPORT.rect.maxX + 160,
  minZ: SPACEPORT.rect.minZ - 140, maxZ: SPACEPORT.rect.maxZ + 160,
};

export async function bakeTerrain({ tick = async () => {}, onProgress = () => {} } = {}) {
  const t0 = now();
  const timings = {};
  let tm = t0;
  const lap = (name) => {
    const t = now();
    timings[name] = Math.round(t - tm);
    tm = t;
  };
  const B = createBakeState();

  // ------------------------------------------------------------ 1. coarse
  macroPass(B);
  // JIT warm-up: sample every biome first so the optimised code sees all
  // branches/types (the real pass starts in the open sea and would otherwise
  // deoptimise repeatedly); these slots are recomputed below
  for (let wj = 0; wj < 24; wj++) {
    for (let wi = 0; wi < 24; wi++) {
      const ci = wi * 25 + 7;
      const cj = wj * 25 + 11;
      coarseSample(B, -HALF + ci * CSTEP, -HALF + cj * CSTEP, cj * CN + ci);
    }
  }
  for (let cj = 0; cj < CN; cj++) {
    coarseRow(B, cj);
    if ((cj & 31) === 31) {
      onProgress(0.35 * (cj / CN));
      await tick();
    }
  }

  lap('coarse');
  // islets need the water body to place themselves
  const sdAt = (x, z) => sampleCoarse(B.cShore, x, z);
  B.islets = makeIslets((x, z, r) => {
    if (sdAt(x, z) > -r - 22) return false;
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2;
      if (sdAt(x + Math.cos(ang) * r * 2.2, z + Math.sin(ang) * r * 2.2) > -14) return false;
    }
    return true;
  });
  B.lakeRegions = [
    ...ISLANDS.map((i) => makeRegion(i.x, i.z, i.radius, i.height, 'island')),
    ...B.islets.map((i) => makeRegion(i.x, i.z, i.r, i.h, i.kind)),
  ];

  // ------------------------------------------------------------ stamps
  lap('islets');
  B.track = stampPolylineDistance([TRACK_POLY, TRACK_SPLINE], 110);
  lap('track');
  B.river = stampRivers();
  lap('river');
  await tick();
  onProgress(0.42);

  // ------------------------------------------------------------ 2. full pass
  B.uLand = new RowUpsampler(B.cLand, CN);
  B.uShore = new RowUpsampler(B.cShore, CN);
  B.uRough = new RowUpsampler(B.cRough, CN);
  B.uRocky = new RowUpsampler(B.cRocky, CN);
  B.uDepth = new RowUpsampler(B.cDepth, CN);
  B.uCanyon = new RowUpsampler(B.cCanyon, CN);
  B.uMesa = new RowUpsampler(B.cMesa, CN);
  // JIT warm-up across the map (rows are recomputed in order below)
  for (let w = 1; w < 9; w++) fineRow(B, w * 133);
  for (let j = 0; j < N; j++) {
    fineRow(B, j);
    if ((j & 63) === 63) {
      onProgress(0.42 + 0.5 * (j / N));
      await tick();
    }
  }

  lap('fine');
  // ------------------------------------------------------------ 3. roads
  const roads = stampRoads(B.heights);
  lap('roads');
  // the title-view headland comes last so no corridor or pad lifts its brow
  stampHeadland(B);
  lap('headland');
  onProgress(0.98);
  await tick();

  const data = {
    N, STEP, HALF,
    heights: B.heights,
    coarse: { n: CN, step: CSTEP, moist: B.cMoist, jungle: B.cJungle, mount: B.cMount, canyon: B.cCanyon, shore: B.cShore },
    canyon: B.fCanyon, pad: B.fPad, cliff: B.fCliff, rocky: B.fRocky, wetRiver: B.fWetRiver, city: B.fCity, shore: B.fShore,
    roads,
    track: B.track,
    river: B.river,
    islets: B.islets,
    bakeMs: now() - t0,
    bakeTimings: timings,
  };
  onProgress(1);
  return data;
}

// ===================================================================== state
function createBakeState() {
  const C = CN * CN;
  const F = N * N;
  return {
    noise: createFastNoise(WORLD.seed),
    near: new Float64Array(6),
    // coarse fields
    cLand: new Float32Array(C),
    cShore: new Float32Array(C),
    cMesa: new Float32Array(C),
    cCanyon: new Float32Array(C),
    cJungle: new Float32Array(C),
    cMoist: new Float32Array(C),
    cMount: new Float32Array(C),
    cRough: new Float32Array(C),
    cRocky: new Float32Array(C),
    cDepth: new Float32Array(C),
    // full-resolution outputs
    heights: new Float32Array(F),
    fCanyon: new Uint8Array(F),
    fPad: new Uint8Array(F),
    fCliff: new Uint8Array(F),
    fRocky: new Uint8Array(F),
    fWetRiver: new Uint8Array(F),
    fCity: new Uint8Array(F),
    fShore: new Int8Array(F), // shoreline distance (m), clamped ±127
    pads: PADS.map((p) => ({ ...p, maxR: p.r + p.blend * 1.6 + 20 })),
    cities: CITY_ISLANDS.map((c, i) => ({ x: c.x, z: c.z, radius: c.radius, idx: i, lim: c.radius + 50 })),
    pools: WATERFALLS.map((w) => ({ x: w.bottom.x, z: w.bottom.z, r: Math.max(16, w.width * 1.1) })),
    // macro fields (16 m): smooth warps / moisture / rockiness / depth
    mac: null,
    M: new Float64Array(7),
    // per-sample scratch (stable shape → unboxed doubles)
    S: new Float64Array(9),
    lakeRegions: null,
    islets: null,
    track: null,
    river: null,
  };
}

function makeRegion(x, z, radius, height, kind) {
  return { x, z, radius, height, stack: kind === 'stack' ? 1 : 0, lim: radius * 2.1 + 12 };
}

// ================================================================ macro pass
const MSTEP = 16;
const MN = WORLD.size / MSTEP + 1; // 151
/**
 * Low-frequency fields (≥ 200 m wavelengths) on a 16 m grid; the coarse pass
 * samples them bilinearly instead of evaluating ~13 noise octaves per sample.
 */
function macroPass(B) {
  const { fbm, n2 } = B.noise;
  const n = MN * MN;
  const mac = { sx: new Float32Array(n), sz: new Float32Array(n), qx: new Float32Array(n), qz: new Float32Array(n), moist: new Float32Array(n), rocky: new Float32Array(n), depth: new Float32Array(n) };
  for (let mj = 0; mj < MN; mj++) {
    const z = -HALF + mj * MSTEP;
    for (let mi = 0; mi < MN; mi++) {
      const x = -HALF + mi * MSTEP;
      const k = mj * MN + mi;
      mac.sx[k] = 64 * fbm(x * 0.0024 + 31.7, z * 0.0024 + 5.2, 2);
      mac.sz[k] = 46 * fbm(x * 0.0024 - 12.4, z * 0.0024 - 22.8, 2);
      mac.qx[k] = 150 * fbm(x * 0.0011 + 17.3, z * 0.0011 - 3.9, 2);
      mac.qz[k] = 150 * fbm(x * 0.0011 - 8.1, z * 0.0011 + 12.6, 2);
      mac.moist[k] = 0.5 + 0.55 * fbm(x * 0.002 + 40.1, z * 0.002 - 13.3, 2);
      mac.rocky[k] = 0.42 + 0.75 * fbm(x * 0.0042 - 1.9, z * 0.0042 + 6.4, 2);
      mac.depth[k] = 4 * n2(x * 0.004, z * 0.004);
    }
  }
  B.mac = mac;
}

/** Bilinear macro lookup of every field into B.M (no allocations). */
function macroAt(B, x, z) {
  let fx = (x + HALF) / MSTEP;
  let fz = (z + HALF) / MSTEP;
  if (fx > MN - 1.0001) fx = MN - 1.0001;
  if (fz > MN - 1.0001) fz = MN - 1.0001;
  const i = fx | 0;
  const j = fz | 0;
  const tx = fx - i;
  const tz = fz - j;
  const k = j * MN + i;
  const w00 = (1 - tx) * (1 - tz);
  const w10 = tx * (1 - tz);
  const w01 = (1 - tx) * tz;
  const w11 = tx * tz;
  const m = B.mac;
  const M = B.M;
  M[M_SX] = m.sx[k] * w00 + m.sx[k + 1] * w10 + m.sx[k + MN] * w01 + m.sx[k + MN + 1] * w11;
  M[M_SZ] = m.sz[k] * w00 + m.sz[k + 1] * w10 + m.sz[k + MN] * w01 + m.sz[k + MN + 1] * w11;
  M[M_QX] = m.qx[k] * w00 + m.qx[k + 1] * w10 + m.qx[k + MN] * w01 + m.qx[k + MN + 1] * w11;
  M[M_QZ] = m.qz[k] * w00 + m.qz[k + 1] * w10 + m.qz[k + MN] * w01 + m.qz[k + MN + 1] * w11;
  M[M_MOIST] = m.moist[k] * w00 + m.moist[k + 1] * w10 + m.moist[k + MN] * w01 + m.moist[k + MN + 1] * w11;
  M[M_ROCKY] = m.rocky[k] * w00 + m.rocky[k + 1] * w10 + m.rocky[k + MN] * w01 + m.rocky[k + MN + 1] * w11;
  M[M_DEPTH] = m.depth[k] * w00 + m.depth[k + 1] * w10 + m.depth[k + MN] * w01 + m.depth[k + MN + 1] * w11;
}

// =============================================================== coarse pass
function coarseRow(B, cj) {
  const z = -HALF + cj * CSTEP;
  for (let ci = 0; ci < CN; ci++) coarseSample(B, -HALF + ci * CSTEP, z, cj * CN + ci);
}

function coarseSample(B, x, z, k) {
  const { n2, fbm, ridged } = B.noise;
  const near = B.near;
  macroAt(B, x, z);
  const M = B.M;

  // --- water body: warped lake ellipse ∪ northern sea, minus escarpment land
  const sx = x + M[M_SX];
  const sz = z + M[M_SZ];
  let sd = ellipseSD(sx - LAKE.x, sz - LAKE.z, LAKE.radiusX, LAKE.radiusZ);
  sd = smin(sd, sz - coastZ(sx), 60);
  for (let q = 0; q < ESCARPMENTS.length; q++) {
    const e = ESCARPMENTS[q];
    const b = e.line.bbox;
    if (x < b.minX - 260 || x > b.maxX + 260 || z < b.minZ - 260 || z > b.maxZ + 260) continue;
    e.line.nearestInto(x, z, near);
    const fade = sstep(0, e.fade[0], near[N_T]) * sstep(0, e.fade[1], e.line.length - near[N_T]);
    if (fade <= 0) continue;
    sd = smax(sd, mix(-240, -near[N_S], fade), 18);
  }
  sd += 9 * n2(x * 0.017 + 2.3, z * 0.017 - 8.1); // coves and points
  B.cShore[k] = sd;

  // --- smooth land
  const qx = x + M[M_QX];
  const qz = z + M[M_QZ];
  const lowland = 0.3 + 0.7 * sstep(10, 300, sd);
  const hillR = ridged(qx * 0.0023 + 3.7, qz * 0.0023 - 1.3, 4);
  let H = 17 + 8 * fbm(qx * 0.0011, qz * 0.0011, 2) + 26 * hillR * Math.sqrt(hillR) * lowland;
  let rough = 0.6 + 0.6 * hillR;
  H += 1.4 * fbm(x * 0.021 + 0.7, z * 0.021 - 3.1, 2) * rough; // ~50 m detail

  // mountains toward the W / S / E edges and the NW far shore (never N/NE)
  // canyon region (computed first: the mountains stay out of the canyon)
  let canyonR = 0;
  const inCanyonBox = x > CANYON_BOX.minX && x < CANYON_BOX.maxX && z > CANYON_BOX.minZ && z < CANYON_BOX.maxZ;
  if (inCanyonBox) {
    const dx = x - CANYON.x;
    const dz = z - CANYON.z;
    const d = Math.sqrt(dx * dx + dz * dz) + 85 * fbm(x * 0.0036 - 3.3, z * 0.0036 + 8.8, 2) + 25 * n2(x * 0.011 + 1.3, z * 0.011);
    canyonR = 1 - sstep(CANYON.radius * 0.98, CANYON.radius * 1.26, d);
  }
  const mm = mountainMask(qx, qz) * (1 - 0.92 * canyonR);
  B.cMount[k] = mm;
  if (mm > 0.001) {
    // main chains (~900 m, sharpened crests) + dendritic spurs and gullies on
    // the flanks (~300 m, independent of the crest weighting so the slopes
    // between the crests are not smooth pyramids)
    const r1 = ridged(qx * 0.0011 + 7.3, qz * 0.0011 - 2.1, 4);
    const r2 = ridged(qx * 0.0034 - 4.1, qz * 0.0034 + 1.7, 3);
    const crest = Math.pow(r1, 1.3) * 1.2;
    const mass = sstep(0.05, 0.5, r1 + 0.2 * mm);
    H += mm * (55 + 330 * crest + 95 * r2 * r2 * (0.35 + 0.65 * mass)) + mm * mm * 95;
    rough += mm * 2.2;
  }

  // western ridge: spawn ledge → lookout peak
  const rb = RIDGE.bbox;
  if (x > rb.minX - 320 && x < rb.maxX + 320 && z > rb.minZ - 320 && z < rb.maxZ + 320) {
    RIDGE.nearestInto(x, z, near);
    const crest = near[N_V] + 6 * ridged(x * 0.008 + 1.1, z * 0.008 - 4.2, 2) - 3;
    const W = near[N_S] > 0 ? mix(64, 130, sstep(40, 260, near[N_T])) : 175;
    const d = Math.max(0, near[N_D] + 16 * n2(x * 0.0065 + 4.1, z * 0.0065 - 2.2));
    const bump = 1 - sstep(0, W, d);
    if (bump > 0 && crest > H) H += (crest - H) * bump * (0.85 + 0.15 * bump);
    rough += bump * 0.9;
  }

  // ruins hill
  {
    const dx = x - ZONES.ruins.x;
    const dz = z - ZONES.ruins.z;
    if (dx * dx + dz * dz < 200 * 200) {
      const d = Math.sqrt(dx * dx + dz * dz) + 18 * n2(x * 0.008, z * 0.008 + 3);
      const bump = 1 - sstep(0, 150, d);
      const top = ZONES.ruins.elevation + 4;
      if (bump > 0 && top > H) H += (top - H) * bump;
    }
  }

  // jungle plateau (west), tilted so the river always runs in a valley
  if (x > JUNGLE_BOX.minX && x < JUNGLE_BOX.maxX && z > JUNGLE_BOX.minZ && z < JUNGLE_BOX.maxZ) {
    const dx = x - JUNGLE.x;
    const dz = z - JUNGLE.z;
    const d = Math.sqrt(dx * dx + dz * dz) + 50 * fbm(x * 0.004 + 9.1, z * 0.004 - 1.7, 2);
    const jm = 1 - sstep(JUNGLE.radius * 0.78, JUNGLE.radius * 1.02, d);
    B.cJungle[k] = jm;
    if (jm > 0) {
      const hj = JUNGLE.elevation + 3 + (JUNGLE.x - x) * 0.05 + 5 * fbm(x * 0.006 + 2.2, z * 0.006, 2) + 4 * ridged(x * 0.012, z * 0.012 + 7, 2);
      H = mix(H, hj, sstep(0, 1, jm));
      rough = mix(rough, 0.8, jm);
    }
  }

  // canyon region mask + mesa noise (terraced in the full pass)
  if (inCanyonBox) {
    B.cCanyon[k] = canyonR;
    const mx = x + 46 * n2(x * 0.0045 + 2.7, z * 0.0045 + 1.9);
    const mz = z + 46 * n2(x * 0.0045 - 6.1, z * 0.0045 - 4.4);
    B.cMesa[k] = fbm(mx * 0.0052 + 11.1, mz * 0.0052 - 5.5, 4);
  }

  B.cLand[k] = H;
  B.cRough[k] = rough;
  B.cMoist[k] = M[M_MOIST] + 0.25 * (1 - sstep(0, 160, sd));
  B.cRocky[k] = M[M_ROCKY] + mm * 0.8;
  B.cDepth[k] = M[M_DEPTH];
}

function mountainMask(x, z) {
  const s = sstep(620, 1130, z);
  const w = sstep(-840, -1150, x);
  const e = sstep(1010, 1290, x) * sstep(-430, -210, z);
  const nw = sstep(-430, -920, x) * sstep(-640, -1060, z) * 0.9;
  return Math.max(s, w, e, nw);
}

// ================================================================= full pass
function fineRow(B, j) {
  const z = -HALF + j * STEP;
  const rLand = B.uLand.row(j);
  const rShore = B.uShore.row(j);
  const rRough = B.uRough.row(j);
  const rRocky = B.uRocky.row(j);
  const rDepth = B.uDepth.row(j);
  const inCanyon = z > CANYON_BOX.minZ && z < CANYON_BOX.maxZ;
  const rCanyon = inCanyon ? B.uCanyon.row(j) : null;
  const rMesa = inCanyon ? B.uMesa.row(j) : null;
  const seaW = sstep(-640, -860, z);
  const depthBase = mix(LAKE.depth, 34, seaW);

  // per-row candidate features (z-range overlaps this row)
  const isl = B.lakeRegions.filter((r) => Math.abs(z - r.z) < r.lim);
  const cities = B.cities.filter((c) => Math.abs(z - c.z) < c.lim);
  const pads = B.pads.filter((p) => Math.abs(z - p.z) < p.maxR);
  const pools = B.pools.filter((p) => Math.abs(z - p.z) < p.r * 2);
  const escs = ESCARPMENTS.filter((e) => z > e.line.bbox.minZ - 170 && z < e.line.bbox.maxZ + 170);
  const inSpaceport = z > SPACEPORT_BOX.minZ && z < SPACEPORT_BOX.maxZ;
  const riverReg = B.river.region;
  const inRiver = j >= riverReg.j0 && j < riverReg.j0 + riverReg.h;

  const { n2 } = B.noise;
  const S = B.S;
  const row = j * N;

  for (let i = 0; i < N; i++) {
    const x = -HALF + i * STEP;
    const k = row + i;
    const rough = rRough[i];
    const fine = 0.32 * n2(x * 0.09, z * 0.09);
    S[S_H] = rLand[i] + fine * rough;
    S[S_FINE] = fine;
    S[S_CLIFF] = 0;
    S[S_CANYON] = 0;
    S[S_PADW] = 0;
    S[S_PADFULL] = 0;
    S[S_CITY] = 0;
    S[S_WETRIVER] = 0;

    // canyon: terraced mesas + buttes, carved race-track floor
    if (rCanyon !== null && x > CANYON_BOX.minX && x < CANYON_BOX.maxX) applyCanyon(B, S, x, z, i, j, rCanyon[i], rMesa[i]);

    // shoreline: beaches, rocky shores, lake/sea bed
    const sd = rShore[i] + fine * 9;
    let rocky = rRocky[i] + S[S_CANYON] * 1.2;
    S[S_ROCKY] = rocky < 0 ? 0 : rocky > 1 ? 1 : rocky;
    S[S_H] = shoreProfile(sd, S[S_H], S[S_ROCKY], depthBase + rDepth[i]);

    for (let r = 0; r < isl.length; r++) {
      const reg = isl[r];
      if (x - reg.x > reg.lim || reg.x - x > reg.lim) continue;
      applyIsland(B, S, x, z, reg, r);
    }
    for (let c = 0; c < cities.length; c++) {
      const ci = cities[c];
      if (x - ci.x > ci.lim || ci.x - x > ci.lim) continue;
      applyCity(B, S, x, z, ci);
    }
    for (let q = 0; q < escs.length; q++) {
      const b = escs[q].line.bbox;
      if (x < b.minX - 170 || x > b.maxX + 170) continue;
      applyEscarpment(B, S, x, z, escs[q], q);
    }
    for (let p = 0; p < pads.length; p++) {
      const pd = pads[p];
      if (x - pd.x > pd.maxR || pd.x - x > pd.maxR) continue;
      applyPad(B, S, x, z, pd, p);
    }
    if (inSpaceport && x > SPACEPORT_BOX.minX && x < SPACEPORT_BOX.maxX) applySpaceport(B, S, x, z);
    if (inRiver) {
      const ri = B.river.index(i, j);
      if (ri >= 0 && B.river.dist[ri] < 1e8) applyRiver(B, S, ri);
    }
    for (let w = 0; w < pools.length; w++) {
      const pl = pools[w];
      const dx = x - pl.x;
      const dz = z - pl.z;
      if (dx > pl.r * 2 || dx < -pl.r * 2) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      const pool = mix(-6.5, S[S_H], sstep(pl.r * 0.55, pl.r * 1.7, d));
      // deepen the basin only (never the cliff or the river lip above it)
      if (pool < S[S_H]) S[S_H] = mix(S[S_H], pool, 1 - sstep(1.5, 6, S[S_H]));
    }

    B.heights[k] = S[S_H];
    B.fCanyon[k] = S[S_CANYON] * 255;
    B.fPad[k] = S[S_PADW] * 255;
    B.fCliff[k] = (S[S_CLIFF] > 1 ? 1 : S[S_CLIFF]) * 255;
    B.fRocky[k] = S[S_ROCKY] * 255;
    B.fCity[k] = S[S_CITY] * 255;
    B.fWetRiver[k] = S[S_WETRIVER] * 255;
    B.fShore[k] = sd > 127 ? 127 : sd < -127 ? -127 : sd;
  }
}

function applyCanyon(B, S, x, z, i, j, region, m) {
  const { n2 } = B.noise;
  const dT = B.track.get(i, j);
  const band = 1 - sstep(40, 90, dT);
  const cm = region > band ? region : band;
  if (cm <= 0.002) return;
  const terr = 13 * sstep(-0.04, 0.03, m) + 15 * sstep(0.33, 0.385, m) + 2.5 * m;
  const hc = 46 + terr + S[S_FINE] * 1.5;
  const w = sstep(0.2, 0.75, cm + 0.12 * n2(x * 0.011, z * 0.011));
  S[S_CANYON] = w;
  S[S_H] = mix(S[S_H], hc, w);
  if (dT >= HALF_TRACK + 60) return;
  const a = dT - HALF_TRACK;
  if (a <= 0) {
    S[S_H] = RACE_TRACK.floor;
    return;
  }
  const wall = RACE_TRACK.floor + 1.2 * sstep(0, 2.2, a) + Math.max(0, a - 1.4) * (3.1 + 0.9 * n2(x * 0.05, z * 0.05)) + 1.6 * sstep(0.3, 0.6, n2(x * 0.03 + 5, z * 0.03));
  if (wall < S[S_H]) {
    S[S_CLIFF] = Math.max(S[S_CLIFF], sstep(0.5, 3, a) * sstep(4, 0, wall - S[S_H] + 4));
    S[S_H] = wall;
  }
}

/** Shore profile: `sd` metres from the shoreline (+ land), `H` land height. */
function shoreProfile(sd, H, rocky, depthMax) {
  if (sd >= 0) {
    const bw = mix(24, 2, rocky); // beach width
    const s0 = mix(0.065, 0.42, rocky); // slope at the waterline
    const s1 = mix(0.26, 1.2, rocky); // slope behind the beach
    const lim = sd <= bw ? 0.15 + sd * s0 : 0.15 + bw * s0 + (sd - bw) * s1;
    return smin(H, lim, 2.5);
  }
  const u = -sd;
  const shelf = mix(0.08, 0.55, rocky);
  const d = Math.min(u * shelf, 2.5) + Math.max(0, u - 2.5 / shelf) * mix(0.2, 0.55, rocky);
  return 0.15 - Math.min(depthMax, d);
}

/** Lake islands + islets: domed tops, rocky rims, underwater aprons (raise only). */
function applyIsland(B, S, x, z, reg, r) {
  const { n2 } = B.noise;
  const dx = x - reg.x;
  const dz = z - reg.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const inv = 1 / (dist || 1);
  const wob = 1 + 0.2 * n2(dx * inv * 1.3 + reg.x * 0.07, dz * inv * 1.3 - reg.z * 0.03) + 0.08 * n2(x * 0.08, z * 0.08);
  const t = dist / (reg.radius * wob);
  let hi;
  if (reg.stack === 1) {
    // tall sea stack: near-vertical sides, ragged top
    const t2 = t * t;
    hi = t < 1 ? reg.height * (1 - t2 * t2 * t2) + 2 * n2(x * 0.2, z * 0.2) : mix(-1, -40, sstep(1, 1.9, t));
    if (t < 1.05) S[S_CLIFF] = Math.max(S[S_CLIFF], sstep(0.55, 0.8, t));
  } else {
    const top = reg.height * (1 - 0.55 * t * t) + 1.2 * n2(x * 0.05 + r, z * 0.05);
    const rim = sstep(0.78, 1.02, t);
    hi = t < 1.02 ? mix(top, -1.5, rim) : mix(-1.5, -40, sstep(1.02, 2.0, t));
    if (t > 0.7 && t < 1.05) S[S_CLIFF] = Math.max(S[S_CLIFF], 0.7 * sstep(0.7, 0.85, t) * (1 - sstep(0.98, 1.05, t)));
  }
  if (hi > S[S_H]) S[S_H] = hi;
}

/**
 * City land: exactly flat at 3 m with a quay-like bank. The landmarks build
 * on the whole disc (r × 0.97), so the flat land always reaches r + 4 m; the
 * shoreline wobble only adds land outward (piers and points).
 */
function applyCity(B, S, x, z, ci) {
  const { n2 } = B.noise;
  const dx = x - ci.x;
  const dz = z - ci.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const inv = 1 / (d || 1);
  const w = n2(dx * inv * 2 + ci.idx * 5.3, dz * inv * 2 - ci.idx);
  const rr = ci.radius + 4 + ci.radius * 0.06 * (w > 0 ? w : 0);
  const e = d - rr;
  const hc = e <= 0 ? 3 : 3 - Math.min(e * 1.3, 3.8) - Math.max(0, e - 3) * 1.1;
  if (hc > S[S_H]) S[S_H] = hc;
  if (e < 2) S[S_CITY] = Math.max(S[S_CITY], 1 - sstep(-2, 2, e));
}

/** Escarpment: plateau at the lip height inland, a near-vertical drop lakeward. */
function applyEscarpment(B, S, x, z, esc, q) {
  const { n2 } = B.noise;
  const near = B.near;
  esc.line.nearestInto(x, z, near);
  const fade = sstep(0, esc.fade[0], near[N_T]) * sstep(0, esc.fade[1], esc.line.length - near[N_T]);
  if (fade <= 0) return;
  // keep the cliff line exactly through the lips, ragged elsewhere
  let lipD = 1e9;
  for (let l = 0; l < LIPS.length; l++) {
    const lx = x - LIPS[l].x;
    const lz = z - LIPS[l].z;
    const dd = Math.sqrt(lx * lx + lz * lz) - LIPS[l].width * 0.5;
    if (dd < lipD) lipD = dd;
  }
  const ragged = sstep(4, 40, lipD);
  const s = near[N_S] + ragged * (7 * n2(x * 0.03 + q, z * 0.03) + 2.5 * n2(x * 0.11, z * 0.11));
  const T = near[N_V];
  // ragged rim: crags and notches along the edge (exact at the waterfall lips)
  const crag = ragged * (2.4 * n2(x * 0.045 + q * 7.1, z * 0.045 - 3.3) + 1.1 * n2(x * 0.14 - 2.2, z * 0.14 + q));
  if (s < 0) {
    const wIn = (1 - sstep(26, 150, -s)) * fade;
    const plateau = T + 0.6 + -s * 0.06 + S[S_FINE] * 1.5 + crag * (1 - sstep(4, 30, -s));
    S[S_H] = mix(S[S_H], plateau, wIn);
  } else if (s < 16) {
    // the face: from the rim (lip height) down below the lake; the face raises
    // or cuts whatever is there, beyond its foot the lake bed is only cut
    const faceW = 7.5 * (1 + 0.45 * ragged * n2(x * 0.07 + 9.1, z * 0.07));
    const drop = sstep(0, faceW, s);
    const hcl = T + 0.6 + crag * (1 - sstep(0, 3, s)) - (T + 15) * Math.pow(drop, 0.85);
    const target = s < faceW ? hcl : S[S_H] < hcl ? S[S_H] : hcl;
    S[S_H] = mix(S[S_H], target, fade * (1 - sstep(11, 16, s)));
    S[S_CLIFF] = Math.max(S[S_CLIFF], fade * (1 - sstep(7, 11, s)));
  }
  const ns = near[N_S] < 0 ? -near[N_S] : near[N_S];
  S[S_ROCKY] = Math.max(S[S_ROCKY], fade * (1 - sstep(0, 60, ns)));
}

/** Zone pad: flat at its elevation, warped natural blend. */
function applyPad(B, S, x, z, pd, p) {
  const { n2 } = B.noise;
  const dx = x - pd.x;
  const dz = z - pd.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const dw = d <= pd.r ? d : d + (d - pd.r) * 0.35 * n2(x * 0.02 + p * 3.1, z * 0.02);
  const w = 1 - sstep(pd.r, pd.r + pd.blend, dw);
  if (w <= 0) return;
  S[S_H] = mix(S[S_H], pd.elev, w);
  if (w * pd.dirt > S[S_PADW]) S[S_PADW] = w * pd.dirt;
  if (w > S[S_PADFULL]) S[S_PADFULL] = w;
}

/**
 * Spawn headland (title view): north of the spawn the terrain is capped by a
 * concave hillside profile that falls from the 46 m brow to the lake. Only
 * lowers; the sector edges are noise-warped so the cove reads as natural.
 * Runs after the roads (their side corridors would otherwise lift the brow).
 */
function stampHeadland(B) {
  const { n2 } = B.noise;
  const H = HEADLAND;
  const reg = new Region(H.x - H.reach, H.z - H.reach, H.x + H.reach, H.z + 4);
  for (let j = reg.j0; j < reg.j0 + reg.h; j++) {
    const z = -HALF + j * STEP;
    const dz = z - H.z;
    if (dz > 4) continue;
    for (let i = reg.i0; i < reg.i0 + reg.w; i++) {
      const x = -HALF + i * STEP;
      const dx = x - H.x;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r < 1.5 || r > H.reach) continue;
      const far = sstep(20, 90, r);
      const beta = Math.atan2(dx, -dz) - H.bearing + 0.16 * far * n2(x * 0.011 + 3.3, z * 0.011 - 1.1);
      const w = (1 - sstep(H.half[0], H.half[1], beta < 0 ? -beta : beta)) * (1 - sstep(H.reach - 40, H.reach, r));
      if (w <= 0) continue;
      // gentle undulation of the lower slope (never on the brow the camera looks over)
      const a = r * (1 + 0.05 * far * n2(x * 0.02 - 5.1, z * 0.02 + 2.7));
      const hp = headlandHeight(a) - far * (1.1 + 1.1 * n2(x * 0.035, z * 0.035 + 9.9));
      const k = j * N + i;
      const h = B.heights[k];
      if (hp < h) B.heights[k] = mix(h, hp, w);
    }
  }
}

/** Spaceport: rectangle ∪ hangar footprint, flat. */
function applySpaceport(B, S, x, z) {
  const d = spaceportDistance(x, z);
  if (d >= SPACEPORT.blend * 1.6) return;
  const dw = d + d * 0.3 * B.noise.n2(x * 0.02 - 7, z * 0.02 + 2);
  const w = 1 - sstep(0, SPACEPORT.blend, dw);
  if (w <= 0) return;
  S[S_H] = mix(S[S_H], SPACEPORT.elev, w);
  if (w * SPACEPORT.dirt > S[S_PADW]) S[S_PADW] = w * SPACEPORT.dirt;
}

/** River: channel 2.5 m below the water, low banks, valley walls, levees. */
function applyRiver(B, S, ri) {
  const R = B.river;
  const a = R.dist[ri];
  const water = R.water[ri];
  const hw = R.halfWidth[ri];
  if (R.cap[ri] === 1) {
    // source gorge beyond the river start: the bed rises into the hills
    const bed = water - 2.5 + R.over[ri] * 0.55;
    const lim = bed + 0.5 + Math.max(0, a - hw * 0.6) * 0.6;
    if (S[S_H] > lim) S[S_H] = lim;
    return;
  }
  // never raise terrain that is far below the bed (cliff faces, the lake)
  if (S[S_H] <= water - 6) return;
  if (a <= hw + 1.5) {
    const bed = water - 2.5 + 0.9 * Math.pow(a / (hw + 1.5), 2.2);
    S[S_H] = a < hw - 2 ? bed : mix(bed, water + 0.6, sstep(hw - 2, hw + 1.5, a));
  } else {
    const wallTop = water + 0.6 + (a - hw - 1.5) * 0.55;
    if (S[S_H] > wallTop) S[S_H] = wallTop;
    const levee = water + 0.6;
    if (S[S_H] < levee) S[S_H] = mix(S[S_H], levee, (1 - sstep(hw + 4, hw + 26, a)) * (1 - S[S_PADFULL]));
  }
  if (a < hw + 3) S[S_WETRIVER] = 1 - sstep(hw, hw + 3, a);
}

// ==================================================================== stamps
function boundsOf(lines, pad) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const l of lines) {
    minX = Math.min(minX, l.bbox.minX - pad);
    maxX = Math.max(maxX, l.bbox.maxX + pad);
    minZ = Math.min(minZ, l.bbox.minZ - pad);
    maxZ = Math.max(maxZ, l.bbox.maxZ + pad);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Min distance to a set of polylines, stamped within `pad` metres (region grid). */
function stampPolylineDistance(lines, pad) {
  const b = boundsOf(lines, pad);
  const reg = new Region(b.minX, b.minZ, b.maxX, b.maxZ, 1e9);
  const dist = reg.data;
  for (const line of lines) {
    for (const s of line.seg) {
      const [i0, i1, j0, j1] = reg.range(Math.min(s.ax, s.ax + s.dx) - pad, Math.max(s.ax, s.ax + s.dx) + pad, Math.min(s.az, s.az + s.dz) - pad, Math.max(s.az, s.az + s.dz) + pad);
      stampSegment(reg, dist, s, i0, i1, j0, j1);
    }
  }
  return reg;
}

function stampSegment(reg, dist, s, i0, i1, j0, j1) {
  for (let j = j0; j <= j1; j++) {
    const z = -HALF + j * STEP;
    for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * STEP;
      let u = ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.len2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = x - s.ax - s.dx * u;
      const ez = z - s.az - s.dz * u;
      const d = Math.sqrt(ex * ex + ez * ez);
      const k = (j - reg.j0) * reg.w + (i - reg.i0);
      if (d < dist[k]) dist[k] = d;
    }
  }
}

/** River distance + water height (+ cap info beyond the river source). */
function stampRivers() {
  const pad = 150;
  const b = boundsOf(RIVER_LINES.map((r) => r.line), pad);
  const reg = new Region(b.minX, b.minZ, b.maxX, b.maxZ, 1e9);
  const size = reg.data.length;
  const dist = reg.data;
  const water = new Float32Array(size);
  const halfWidth = new Float32Array(size);
  const cap = new Uint8Array(size);
  const over = new Float32Array(size);
  for (const r of RIVER_LINES) {
    const hw = r.width / 2;
    const segs = r.line.seg;
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      const first = si === 0;
      const last = si === segs.length - 1;
      const [i0, i1, j0, j1] = reg.range(Math.min(s.ax, s.ax + s.dx) - pad, Math.max(s.ax, s.ax + s.dx) + pad, Math.min(s.az, s.az + s.dz) - pad, Math.max(s.az, s.az + s.dz) + pad);
      for (let j = j0; j <= j1; j++) {
        const z = -HALF + j * STEP;
        for (let i = i0; i <= i1; i++) {
          const x = -HALF + i * STEP;
          const uRaw = ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.len2;
          // beyond the mouth (waterfall lip): no channel, the cliff takes over
          if (last && uRaw > 1) continue;
          const u = uRaw < 0 ? 0 : uRaw > 1 ? 1 : uRaw;
          const ex = x - s.ax - s.dx * u;
          const ez = z - s.az - s.dz * u;
          const d = Math.sqrt(ex * ex + ez * ez);
          const k = reg.index(i, j);
          if (d < dist[k]) {
            dist[k] = d;
            water[k] = s.va + (s.vb - s.va) * u;
            halfWidth[k] = hw;
            if (first && uRaw < 0) {
              cap[k] = 1;
              over[k] = -uRaw * s.len;
            } else cap[k] = 0;
          }
        }
      }
    }
  }
  return { region: reg, dist, water, halfWidth, cap, over, index: (i, j) => reg.indexOrNeg(i, j) };
}

/** Road grade profiles + flattened corridors (region grid of signed distance). */
function stampRoads(hgt) {
  const reachPad = 30;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of ROAD_LINES) {
    for (const p of r.dense) {
      minX = Math.min(minX, p[0] - reachPad);
      maxX = Math.max(maxX, p[0] + reachPad);
      minZ = Math.min(minZ, p[1] - reachPad);
      maxZ = Math.max(maxZ, p[1] + reachPad);
    }
  }
  const reg = new Region(minX, minZ, maxX, maxZ, 1e9);
  const dist = reg.data;
  const target = new Float32Array(dist.length);
  const weight = new Float32Array(dist.length);
  const lines = [];
  for (const road of ROAD_LINES) {
    const pts = road.dense;
    // sample the pre-road terrain along the centreline, then smooth the grade
    const raw = pts.map((p) => sampleGrid(hgt, p[0], p[1]));
    const prof = smooth1D(raw, 9, 3);
    prof[0] = raw[0];
    prof[prof.length - 1] = raw[raw.length - 1];
    const prof2 = smooth1D(prof, 4, 2);
    prof2[0] = raw[0];
    prof2[prof2.length - 1] = raw[raw.length - 1];
    // roads arrive flat on zone pads (and never tilt a pad)
    for (let i = 0; i < pts.length; i++) {
      for (const pd of PADS) {
        const d = Math.hypot(pts[i][0] - pd.x, pts[i][1] - pd.z);
        if (d < pd.r + pd.blend) prof2[i] = mix(prof2[i], pd.elev, 1 - sstep(pd.r * 0.8, pd.r + pd.blend * 0.5, d));
      }
    }
    const hw = road.width / 2;
    const flat = hw + 1.6;
    const reach = flat + 13;
    for (let s = 0; s < pts.length - 1; s++) {
      const ax = pts[s][0];
      const az = pts[s][1];
      const dx = pts[s + 1][0] - ax;
      const dz = pts[s + 1][1] - az;
      const len2 = dx * dx + dz * dz || 1e-6;
      const [i0, i1, j0, j1] = reg.range(Math.min(ax, ax + dx) - reach, Math.max(ax, ax + dx) + reach, Math.min(az, az + dz) - reach, Math.max(az, az + dz) + reach);
      for (let j = j0; j <= j1; j++) {
        const z = -HALF + j * STEP;
        for (let i = i0; i <= i1; i++) {
          const x = -HALF + i * STEP;
          let u = ((x - ax) * dx + (z - az) * dz) / len2;
          // no round caps at the road ends: they always sit on flat zone pads
          // (a cap would flatten e.g. the spawn brow the title camera looks over)
          if ((s === 0 && u < -0.02) || (s === pts.length - 2 && u > 1.02)) continue;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const ex = x - ax - dx * u;
          const ez = z - az - dz * u;
          const d = Math.sqrt(ex * ex + ez * ez);
          const sdist = d - hw; // < 0 on the paving
          const k = reg.index(i, j);
          if (sdist < dist[k]) {
            dist[k] = sdist;
            target[k] = prof2[s] + (prof2[s + 1] - prof2[s]) * u;
            weight[k] = 1 - sstep(flat, reach, d);
          }
        }
      }
    }
    lines.push({ id: road.id, width: road.width, points: pts.map((p, i) => [p[0], prof2[i], p[1]]) });
  }
  for (let j = reg.j0; j < reg.j0 + reg.h; j++) {
    for (let i = reg.i0; i < reg.i0 + reg.w; i++) {
      const k = reg.index(i, j);
      const w = weight[k];
      if (w > 0) {
        const g = j * N + i;
        hgt[g] = mix(hgt[g], target[k], w);
      }
    }
  }
  return { region: reg, dist, lines };
}

// ------------------------------------------------------------------ helpers
function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** A sub-rectangle of the full grid (for feature stamps). */
export class Region {
  constructor(minX, minZ, maxX, maxZ, fill = 0) {
    this.i0 = Math.max(0, Math.floor((minX + HALF) / STEP));
    this.j0 = Math.max(0, Math.floor((minZ + HALF) / STEP));
    const i1 = Math.min(N - 1, Math.ceil((maxX + HALF) / STEP));
    const j1 = Math.min(N - 1, Math.ceil((maxZ + HALF) / STEP));
    this.w = Math.max(1, i1 - this.i0 + 1);
    this.h = Math.max(1, j1 - this.j0 + 1);
    this.fill = fill;
    this.data = new Float32Array(this.w * this.h).fill(fill);
  }
  range(minX, maxX, minZ, maxZ) {
    return [
      Math.max(this.i0, Math.floor((minX + HALF) / STEP)),
      Math.min(this.i0 + this.w - 1, Math.ceil((maxX + HALF) / STEP)),
      Math.max(this.j0, Math.floor((minZ + HALF) / STEP)),
      Math.min(this.j0 + this.h - 1, Math.ceil((maxZ + HALF) / STEP)),
    ];
  }
  index(i, j) {
    return (j - this.j0) * this.w + (i - this.i0);
  }
  indexOrNeg(i, j) {
    const li = i - this.i0;
    const lj = j - this.j0;
    if (li < 0 || lj < 0 || li >= this.w || lj >= this.h) return -1;
    return lj * this.w + li;
  }
  get(i, j) {
    const k = this.indexOrNeg(i, j);
    return k < 0 ? this.fill : this.data[k];
  }
  /** Bilinear sample in world coordinates (outside → fill). */
  sample(x, z) {
    const fx = (x + HALF) / STEP;
    const fz = (z + HALF) / STEP;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = this.get(i, j);
    const b = this.get(i + 1, j);
    const c = this.get(i, j + 1);
    const d = this.get(i + 1, j + 1);
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
}

/**
 * Streams rows of a Catmull-Rom 2× upsample of a CN² coarse grid (fixed
 * weights −1/16, 9/16, 9/16, −1/16 at the half-way points). Rows must be
 * requested in increasing order; a few x-upsampled coarse rows are cached.
 */
class RowUpsampler {
  constructor(src, cn) {
    this.src = src;
    this.cn = cn;
    this.n = cn * 2 - 1;
    this.cache = new Map(); // coarse row → x-upsampled Float32Array(n)
    this.out = new Float32Array(this.n);
  }
  _xrow(cj) {
    cj = cj < 0 ? 0 : cj > this.cn - 1 ? this.cn - 1 : cj;
    let r = this.cache.get(cj);
    if (r) return r;
    if (this.cache.size >= 6) {
      const oldest = this.cache.keys().next().value;
      r = this.cache.get(oldest);
      this.cache.delete(oldest);
    } else r = new Float32Array(this.n);
    const { src, cn } = this;
    const row = cj * cn;
    for (let ci = 0; ci < cn; ci++) {
      r[ci * 2] = src[row + ci];
      if (ci < cn - 1) {
        const p0 = src[row + (ci > 0 ? ci - 1 : 0)];
        const p1 = src[row + ci];
        const p2 = src[row + ci + 1];
        const p3 = src[row + (ci + 2 < cn ? ci + 2 : cn - 1)];
        r[ci * 2 + 1] = (9 * (p1 + p2) - (p0 + p3)) / 16;
      }
    }
    this.cache.set(cj, r);
    return r;
  }
  row(fj) {
    const cj = fj >> 1;
    if ((fj & 1) === 0) return this._xrow(cj);
    const r0 = this._xrow(cj - 1);
    const r1 = this._xrow(cj);
    const r2 = this._xrow(cj + 1);
    const r3 = this._xrow(cj + 2);
    const o = this.out;
    for (let i = 0; i < this.n; i++) o[i] = (9 * (r1[i] + r2[i]) - (r0[i] + r3[i])) / 16;
    return o;
  }
}

/** Bilinear sample of a full-resolution grid at world (x, z). */
export function sampleGrid(arr, x, z) {
  let fx = (x + HALF) / STEP;
  let fz = (z + HALF) / STEP;
  if (fx < 0) fx = 0;
  else if (fx > N - 1.0001) fx = N - 1.0001;
  if (fz < 0) fz = 0;
  else if (fz > N - 1.0001) fz = N - 1.0001;
  const i = fx | 0;
  const j = fz | 0;
  const tx = fx - i;
  const tz = fz - j;
  const k = j * N + i;
  const a = arr[k];
  const b = arr[k + 1];
  const c = arr[k + N];
  const d = arr[k + N + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** Bilinear sample of a coarse (CN²) grid at world (x, z). */
export function sampleCoarse(arr, x, z) {
  let fx = (x + HALF) / CSTEP;
  let fz = (z + HALF) / CSTEP;
  if (fx < 0) fx = 0;
  else if (fx > CN - 1.0001) fx = CN - 1.0001;
  if (fz < 0) fz = 0;
  else if (fz > CN - 1.0001) fz = CN - 1.0001;
  const i = fx | 0;
  const j = fz | 0;
  const tx = fx - i;
  const tz = fz - j;
  const k = j * CN + i;
  const a = arr[k];
  const b = arr[k + 1];
  const c = arr[k + CN];
  const d = arr[k + CN + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** Repeated moving average (box blur) of a 1D array. */
function smooth1D(arr, radius, passes) {
  let cur = Float32Array.from(arr);
  const n = cur.length;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let cnt = 0;
      for (let k = -radius; k <= radius; k++) {
        const q = i + k;
        if (q < 0 || q >= n) continue;
        sum += cur[q];
        cnt++;
      }
      next[i] = sum / cnt;
    }
    cur = next;
  }
  return cur;
}
