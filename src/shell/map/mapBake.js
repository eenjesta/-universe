/**
 * Map bake — pure JS, no DOM: runs in a Web Worker (mapWorker.js) or, as a
 * fallback, time-sliced on the main thread. Paints the relief map shared by
 * the world map and the HUD minimap in the style of 19_world_map.png:
 *
 *   terrain colours   from the terrain's own splat masks (grass / dry grass /
 *                     jungle / forest floor / dirt / sand / canyon red / rock /
 *                     snow / wet shores), or synthesised from height + slope
 *   light             golden hour from the north-east: warm sun, cool sky
 *                     ambient, cavity AO and soft cast shadows (height-field
 *                     ray march on a 4 m grid)
 *   water             depth tint, lake bed in the shallows, shore foam, a warm
 *                     sunset sheen toward the north-east, rivers
 *   trees             every tree / bush as a lit canopy with its shadow
 *   edges             dusky mist and lit clouds outside the playable area
 *
 * Input (typed arrays are optional unless noted):
 *   size, extent                    output pixels / half-size in metres (required)
 *   grid {n, step, half, heights}   height grid (required)
 *   splatA, splatB, normal          terrain RGBA masks on the same grid
 *   city                            Uint8 city-land mask on the same grid
 *   cityIslands [{x, z, radius}]    city land discs (paved even without the mask)
 *   forest {n, step, half, data}    coarse forest density
 *   river {n, step, x0, z0, data}   river water-surface heights (NaN = none)
 *   trees                           Float32Array [x, z, crownR, kind, height] × count
 *   light [x, y, z]                 unit vector toward the light
 *   playBounds                      playable half-size (m)
 * Output: Uint8ClampedArray (size × size × 4).
 */

import {
  PAVED,
  FOREST_FLOOR,
  CANOPY,
  TREE_KINDS,
  smooth,
  makeNoise,
  hash2,
  shadeWater,
  seamlessSheen,
  shadeLand,
  lightLand,
  stampShadow,
  stampCanopy,
  NOISE_SEED,
} from './mapStyle.js';

export { TREE_KINDS };

// edge-only colours (not used when the map is seamless)
const MIST = [30, 36, 48];
const CLOUD_LIT = [238, 226, 212];
const CLOUD_SHADE = [112, 122, 142];
const INV255 = 1 / 255;

function sampleGrid(arr, n, step, half, x, z) {
  let fx = (x + half) / step;
  let fz = (z + half) / step;
  if (fx < 0) fx = 0;
  else if (fx > n - 1.0001) fx = n - 1.0001;
  if (fz < 0) fz = 0;
  else if (fz > n - 1.0001) fz = n - 1.0001;
  const i = fx | 0;
  const j = fz | 0;
  const tx = fx - i;
  const tz = fz - j;
  const k = j * n + i;
  const a = arr[k];
  const b = arr[k + 1];
  const c = arr[k + n];
  const d = arr[k + n + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// ------------------------------------------------------------------ bake
/**
 * @param {object} input see the file header
 * @param {{ yieldFn?: () => Promise<void>, budget?: number }} opts — on the
 *   main thread pass a yieldFn; work then pauses every `budget` ms.
 */
export async function bakeMap(input, { yieldFn = null, budget = 8 } = {}) {
  const S = input.size;
  const E = input.extent;
  const mpp = (2 * E) / S; // metres per pixel
  const G = input.grid;
  const gn = G.n;
  const gstep = G.step;
  const ghalf = G.half;
  const H = G.heights;
  const A = input.splatA || null;
  const B = input.splatB || null;
  const NT = input.normal || null;
  const CITY = input.city || null;
  const ISLANDS = input.cityIslands || [];
  let iMinX = Infinity;
  let iMaxX = -Infinity;
  let iMinZ = Infinity;
  let iMaxZ = -Infinity;
  for (const c of ISLANDS) {
    iMinX = Math.min(iMinX, c.x - c.radius);
    iMaxX = Math.max(iMaxX, c.x + c.radius);
    iMinZ = Math.min(iMinZ, c.z - c.radius);
    iMaxZ = Math.max(iMaxZ, c.z + c.radius);
  }
  const FOREST = input.forest || null;
  const RIVER = input.river || null;
  const playable = input.playBounds || E * 0.875;
  // seamless: the procedural planet continues around the hub (PLATFORM.md §11) — no edge mist,
  // no edge clouds, no corner glow, so the hub image meets the frontier layer without a frame
  const seamless = !!input.seamless;
  const [lx, ly, lz] = input.light || [0.43, 0.5, -0.75];
  const lh = Math.hypot(lx, lz) || 1;
  const ldx = lx / lh; // horizontal direction toward the light
  const ldz = lz / lh;
  const tanEl = ly / lh;
  const out = new Uint8ClampedArray(S * S * 4);
  const noise = makeNoise(NOISE_SEED);
  const LIGHT_V = [lx, ly, lz];
  const P = { h: 0, slope: 0, moist: 0, mac: 0, sand: 0, canyon: 0, jungle: 0, pad: 0, rockO: 0, ffloor: 0, snow: -1, dry: 0, fine: 1, rockV: 0 };

  let t0 = Date.now();
  const maybeYield = async () => {
    if (yieldFn && Date.now() - t0 > budget) {
      await yieldFn();
      t0 = Date.now();
    }
  };
  const heightAt = (x, z) => sampleGrid(H, gn, gstep, ghalf, x, z);

  let maxH = -Infinity;
  for (let i = 0; i < H.length; i++) if (H[i] > maxH) maxH = H[i];

  // 1) soft cast shadows on a 4 m grid (1 = lit) -----------------------------
  const SN = Math.min(601, Math.round((2 * E) / 4) + 1);
  const sstep = (2 * E) / (SN - 1);
  const shadow = new Float32Array(SN * SN);
  for (let j = 0; j < SN; j++) {
    const z = -E + j * sstep;
    for (let i = 0; i < SN; i++) {
      const x = -E + i * sstep;
      const h0 = Math.max(heightAt(x, z), 0) + 0.6;
      let lit = 1;
      let t = 3;
      while (t < 1400) {
        const ry = h0 + t * tanEl;
        if (ry > maxH) break;
        const clear = ry - heightAt(x + ldx * t, z + ldz * t);
        if (clear < 0) {
          lit = 0;
          break;
        }
        const soft = clear / (t * 0.09); // penumbra widens with distance
        if (soft < lit) lit = soft;
        t += t < 60 ? 3 : t * 0.05;
      }
      shadow[j * SN + i] = lit;
    }
    if ((j & 7) === 7) await maybeYield();
  }

  // 2) low-frequency colour variation grids (fast bilinear lookups later) ----
  const NN = 256;
  const nstep = (2 * E) / (NN - 1);
  const macro = new Float32Array(NN * NN);
  const ripple = new Float32Array(NN * NN);
  for (let j = 0; j < NN; j++) {
    for (let i = 0; i < NN; i++) {
      // world-space fields (mapStyle.js), so they continue in the procedural map tiles around the hub
      macro[j * NN + i] = noise.macro(-E + i * nstep, -E + j * nstep);
      ripple[j * NN + i] = noise.ripple(-E + i * nstep, -E + j * nstep);
    }
  }

  // per-column / per-row lookup tables into the terrain grid
  const ci = new Int32Array(S);
  const ct = new Float32Array(S);
  for (let p = 0; p < S; p++) {
    let f = (-E + (p + 0.5) * mpp + ghalf) / gstep;
    if (f < 0) f = 0;
    else if (f > gn - 1.0001) f = gn - 1.0001;
    ci[p] = f | 0;
    ct[p] = f - (f | 0);
  }

  const col = [0, 0, 0];
  const mix3 = (c, k) => {
    col[0] += (c[0] - col[0]) * k;
    col[1] += (c[1] - col[1]) * k;
    col[2] += (c[2] - col[2]) * k;
  };

  // 3) per-pixel terrain + water --------------------------------------------
  for (let py = 0; py < S; py++) {
    const z = -E + (py + 0.5) * mpp;
    const j = ci[py]; // same table works for rows (square grid, same extent)
    const tz = ct[py];
    const fzs = (z + E) / sstep;
    for (let px = 0; px < S; px++) {
      const x = -E + (px + 0.5) * mpp;
      const i = ci[px];
      const tx = ct[px];
      const k = j * gn + i;
      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;
      const h = H[k] * w00 + H[k + 1] * w10 + H[k + gn] * w01 + H[k + gn + 1] * w11;

      // ---- shared lookups
      const mi = (x + E) / nstep;
      const mj = (z + E) / nstep;
      const mac = sampleGrid(macro, NN, 1, 0, mi, mj);
      let lit = sampleGrid(shadow, SN, 1, 0, (x + E) / sstep, fzs);
      if (lit > 1) lit = 1;

      // ---- normal (terrain normal map, else from the heights)
      let nx;
      let nz;
      let cav = 0;
      let moist = 0.5;
      if (NT) {
        const a = k * 4;
        const b = a + 4;
        const c = a + gn * 4;
        const d = c + 4;
        nx = (NT[a] * w00 + NT[b] * w10 + NT[c] * w01 + NT[d] * w11) * INV255 * 2 - 1;
        nz = (NT[a + 1] * w00 + NT[b + 1] * w10 + NT[c + 1] * w01 + NT[d + 1] * w11) * INV255 * 2 - 1;
        cav = (NT[a + 2] * w00 + NT[b + 2] * w10 + NT[c + 2] * w01 + NT[d + 2] * w11) * INV255 * 2 - 1;
        moist = NT[a + 3] * INV255;
      } else {
        const e = gstep;
        const gx = (heightAt(x - e, z) - heightAt(x + e, z)) / (2 * e);
        const gz = (heightAt(x, z - e) - heightAt(x, z + e)) / (2 * e);
        const il = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        nx = gx * il;
        nz = gz * il;
      }
      const nyy = 1 - nx * nx - nz * nz;
      const ny = nyy > 0 ? Math.sqrt(nyy) : 0;
      const slope = 1 - ny;

      // ---- water surface (lake at 0, rivers above it)
      let wsurf = h < 0 ? 0 : NaN;
      if (RIVER) {
        const rx = (x - RIVER.x0) / RIVER.step;
        const rz = (z - RIVER.z0) / RIVER.step;
        if (rx >= 0 && rz >= 0 && rx < RIVER.n - 1 && rz < RIVER.m - 1) {
          const ri = (rz | 0) * RIVER.n + (rx | 0);
          const rv = RIVER.data[ri];
          if (rv === rv && h < rv) wsurf = rv; // rv === rv: not NaN
        }
      }

      const o = (py * S + px) * 4;
      if (wsurf === wsurf && h < wsurf - 0.04) {
        // =================================================== water
        const depth = wsurf - h;
        // sunset sheen toward the north-east of the hub (or the same everywhere when seamless), broken by ripples
        const rip = sampleGrid(ripple, NN, 1, 0, mi, mj);
        let sheen;
        if (seamless) sheen = seamlessSheen(rip, depth);
        else {
          const ne = smooth(0.1, 1.15, (x * ldx + z * ldz) / E);
          sheen = ne * ne * (0.55 + 0.45 * smooth(0.35, 0.7, rip)) * smooth(1, 6, depth);
        }
        shadeWater(col, depth, sheen, lit, hash2(px >> 1, py >> 1));
      } else {
        // ==================================================== land
        let sand = 0;
        let canyon = 0;
        let jungle = 0;
        let pad = 0;
        let rockO = 0;
        let wet = 0;
        let ffloor = 0;
        if (A && B) {
          const a = k * 4;
          const b = a + 4;
          const c = a + gn * 4;
          const d = c + 4;
          sand = (A[a] * w00 + A[b] * w10 + A[c] * w01 + A[d] * w11) * INV255;
          canyon = (A[a + 1] * w00 + A[b + 1] * w10 + A[c + 1] * w01 + A[d + 1] * w11) * INV255;
          jungle = (A[a + 2] * w00 + A[b + 2] * w10 + A[c + 2] * w01 + A[d + 2] * w11) * INV255;
          pad = (A[a + 3] * w00 + A[b + 3] * w10 + A[c + 3] * w01 + A[d + 3] * w11) * INV255;
          rockO = (B[a] * w00 + B[b] * w10 + B[c] * w01 + B[d] * w11) * INV255;
          wet = B[a + 1] * INV255;
          ffloor = (B[a + 3] * w00 + B[b + 3] * w10 + B[c + 3] * w01 + B[d + 3] * w11) * INV255;
        } else {
          // synthesised masks: beaches, highland rock
          sand = 1 - smooth(0.4, 3.2, h);
          rockO = smooth(150, 260, h) * 0.6;
          moist = 0.55 - h * 0.002;
        }
        // ground colour (shared with the procedural planet's map tiles, mapStyle.js)
        P.h = h;
        P.slope = slope;
        P.moist = moist;
        P.mac = mac;
        P.sand = sand;
        P.canyon = canyon;
        P.jungle = jungle;
        P.pad = pad;
        P.rockO = rockO;
        P.ffloor = ffloor;
        P.fine = 0.9 + 0.2 * hash2(px, py);
        P.rockV = hash2(px >> 2, py >> 2);
        shadeLand(col, P);
        // city land: paved (mask and/or the city island discs)
        let cv = CITY ? CITY[k] * INV255 : 0;
        const nearCity = x > iMinX && x < iMaxX && z > iMinZ && z < iMaxZ;
        for (let q = 0; nearCity && q < ISLANDS.length; q++) {
          const isl = ISLANDS[q];
          const dd = Math.hypot(x - isl.x, z - isl.z);
          if (dd < isl.radius) {
            const w = 1 - smooth(isl.radius * 0.88, isl.radius, dd);
            if (w > cv) cv = w;
          }
        }
        if (cv > 0.01) mix3(PAVED, cv * 0.86);
        // forest: darker ground between the trees
        if (FOREST) {
          const fv = sampleGrid(FOREST.data, FOREST.n, FOREST.step, FOREST.half, x, z);
          if (fv > 0.02) mix3(FOREST_FLOOR, fv * 0.38);
        }
        // ---- lighting: warm sun with soft shadows, cool sky ambient, AO
        lightLand(col, nx, ny, nz, lit, cav, wet, LIGHT_V);
      }

      // ---- outside the playable area: dusky mist
      const edge = Math.max(Math.abs(x), Math.abs(z));
      if (!seamless && edge > playable - 90) {
        const k2 = smooth(playable - 90, E - 4, edge) * 0.66;
        mix3(MIST, k2);
      }

      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
      out[o + 3] = 255;
    }
    if ((py & 3) === 3) await maybeYield();
  }

  // 4) trees: shadow first, then a lit canopy ------------------------------------
  const trees = input.trees;
  if (trees && trees.length >= 5) {
    const count = (trees.length / 5) | 0;
    const shx = -ldx / tanEl; // shadow offset per metre of height
    const shz = -ldz / tanEl;
    for (let pass = 0; pass < 2; pass++) {
      for (let t = 0; t < count; t++) {
        const b = t * 5;
        const tx = trees[b];
        const tz = trees[b + 1];
        const r = trees[b + 2];
        const kind = trees[b + 3] | 0;
        const th = trees[b + 4];
        const rp = Math.max(0.75, r / mpp);
        if (pass === 0) {
          // shadow: soft dark disc offset away from the light (length capped)
          const len = Math.min(th * 0.55, 14);
          const cx = (tx + E + shx * len) / mpp;
          const cz = (tz + E + shz * len) / mpp;
          stampShadow(out, S, S, cx, cz, rp * 1.05, 0.5);
        } else {
          const cx = (tx + E) / mpp;
          const cz = (tz + E) / mpp;
          const pal = CANOPY[kind] || CANOPY[0];
          const jitter = 0.86 + 0.28 * hash2(t, 7);
          stampCanopy(out, S, S, cx, cz, rp, pal, ldx, ldz, jitter, kind === 0 ? 0.85 : 1);
        }
        if ((t & 2047) === 2047) await maybeYield();
      }
    }
  }

  // 5) clouds around the edges (lit from the light, with ground shadows) --------
  const cloudAt = (x, z) => {
    if (seamless) return 0;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const m = smooth(playable - 60, E - 20, edge);
    if (m <= 0) return 0;
    const n = noise.fbm(x * 0.0036 + 3.7, z * 0.0036 - 1.3, 5);
    return smooth(0.5 - m * 0.12, 0.8 - m * 0.1, n) * m;
  };
  const cs = 2; // cloud field resolution (px)
  const cw = Math.ceil(S / cs);
  const cloud = new Float32Array(cw * cw);
  for (let j = 0; j < cw && !seamless; j++) {
    for (let i = 0; i < cw; i++) cloud[j * cw + i] = cloudAt(-E + (i + 0.5) * cs * mpp, -E + (j + 0.5) * cs * mpp);
    if ((j & 15) === 15) await maybeYield();
  }
  const cshift = 60 / mpp / cs; // cloud shadow offset (cells)
  for (let py = 0; py < S && !seamless; py++) {
    const cj = py / cs;
    for (let px = 0; px < S; px++) {
      const cii = px / cs;
      const c = sampleGrid(cloud, cw, 1, 0, cii, cj);
      // shadow of the cloud above (it sits toward the light)
      const cshd = sampleGrid(cloud, cw, 1, 0, cii + ldx * cshift, cj + ldz * cshift);
      if (c < 0.004 && cshd < 0.004) continue;
      const o = (py * S + px) * 4;
      const sh = 1 - cshd * 0.45;
      let r = out[o] * sh;
      let g = out[o + 1] * sh;
      let b = out[o + 2] * sh;
      if (c > 0.004) {
        // light side: the cloud thins toward the light
        const toward = sampleGrid(cloud, cw, 1, 0, cii + ldx * 3, cj + ldz * 3);
        const lit = 0.5 + 0.5 * Math.max(-1, Math.min(1, (c - toward) * 6));
        const cr = CLOUD_SHADE[0] + (CLOUD_LIT[0] - CLOUD_SHADE[0]) * lit;
        const cg = CLOUD_SHADE[1] + (CLOUD_LIT[1] - CLOUD_SHADE[1]) * lit;
        const cb = CLOUD_SHADE[2] + (CLOUD_LIT[2] - CLOUD_SHADE[2]) * lit;
        const a = Math.min(1, c * 1.1) * 0.78;
        r += (cr - r) * a;
        g += (cg - g) * a;
        b += (cb - b) * a;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    if ((py & 7) === 7) await maybeYield();
  }

  // 6) grade: a little more saturation, warm light from the north-east ----------
  for (let py = 0; py < S; py++) {
    const v = py / S;
    for (let px = 0; px < S; px++) {
      const u = px / S;
      const o = (py * S + px) * 4;
      let r = out[o];
      let g = out[o + 1];
      let b = out[o + 2];
      const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
      // gentle S-curve for a deeper, more dramatic relief
      const lc = l / 255;
      const curve = (lc * lc * (3 - 2 * lc) * 0.45 + lc * 0.55) / Math.max(1e-3, lc);
      r = (l + (r - l) * 1.04) * curve;
      g = (l + (g - l) * 1.04) * curve;
      b = (l + (b - l) * 1.04) * curve;
      // golden glow from the top-right corner, cool toward the bottom-left (not when seamless)
      const d = seamless ? 0.9 : Math.hypot(1.05 - u, v + 0.05);
      const warm = seamless ? 0 : Math.max(0, 1 - d / 1.2);
      const w2 = warm * warm * 0.2; // screen-blend a sunset haze (255, 190, 120)
      r = 255 - (255 - r) * (1 - w2);
      g = 255 - (255 - g) * (1 - w2 * 0.75);
      b = 255 - (255 - b) * (1 - w2 * 0.47);
      const cool = Math.max(0, d - 0.9) * 0.6;
      r -= 10 * cool;
      g -= 4 * cool;
      b += 6 * cool;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    if ((py & 15) === 15) await maybeYield();
  }
  return out;
}

