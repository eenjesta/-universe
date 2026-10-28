/**
 * Map tile of the procedural planet in the HUB MAP's art style (src/shell/map/mapStyle.js — the same
 * palette, golden-hour light from the north-north-east with soft cast shadows, cavity AO, water depth
 * tint + lake bed + shore foam, beaches, lit tree canopies and colour grade as the baked hub map), so
 * the world map and the minimap read as one continuous map across the hub border.
 *
 *   mapTile(wg, { x0, z0, size, px }) → Uint8ClampedArray (px × px RGBA), north up (−Z), x east.
 *
 * Ground masks are the ones the 3D frontier terrain uses (src/frontier/pack.js packTile), coloured the
 * way mapBake colours the hub terrain's splat masks. Pure JS: runs in the frontier map worker.
 */
import { snowAt, BIOME_LIST, FIELDS } from '../../shared/worldgen/index.js';
import { sstep } from '../../shared/worldgen/noise.js';
import { MAP_LIGHT, CANOPY, makeNoise, hash2, shadeWater, seamlessSheen, shadeLand, lightLand, gradePixel, stampShadow, stampCanopy } from '../shell/map/mapStyle.js';

const { S_LEN, S_M, S_RIVER, S_LAKE, S_MOUNT, S_BAD, S_PLAT } = FIELDS;
const S = new Float64Array(S_LEN);
const W = new Float32Array(8);
const noise = makeNoise();
const [LX, LY, LZ] = MAP_LIGHT;
const LH = Math.hypot(LX, LZ);
const LDX = LX / LH; // horizontal direction toward the light
const LDZ = LZ / LH;
const TAN_EL = LY / LH;
const TREES = BIOME_LIST.map((b) => b.trees || 0);
// biome → canopy kind [main, alt] (0 pine, 1 broadleaf, 2 birch, 3 acacia, 4 jungle, 5 palm)
const KIND = [
  [5, 5], // ocean
  [5, 3], // coast
  [1, 2], // meadow
  [0, 1], // forest
  [4, 5], // jungle
  [0, 2], // highlands
  [3, 3], // badlands
  [0, 0], // peaks
];
const CROWN = [2.6, 3.8, 3.0, 4.2, 4.4, 2.8]; // crown radius (m) per kind
const TREE_SPACING = 7; // candidate grid (m)

const col = [0, 0, 0];
const P = { h: 0, slope: 0, moist: 0, mac: 0, sand: 0, canyon: 0, jungle: 0, pad: 0, rockO: 0, ffloor: 0, snow: 0, dry: 0, fine: 1, rockV: 0, strata: 1 };

// world-aligned coarse heights for the shadow march, cached in blocks (neighbouring tiles share them)
const HB = 32;
// sample a hair off the metre lattice: the worker-side hub border profile (shared/worldgen/hub.js extension)
// answers points EXACTLY on |x| = extent with the north/south edge's profile — a spike/trench on the map
const NUDGE = 0.013;
const hblocks = new Map(); // `${ss}:${bi}:${bj}` → Float32Array(HB²)
function hblock(wg, ss, bi, bj) {
  const key = `${ss}:${bi}:${bj}`;
  let b = hblocks.get(key);
  if (b) {
    hblocks.delete(key); // LRU: re-insert as newest
    hblocks.set(key, b);
    return b;
  }
  b = new Float32Array(HB * HB);
  for (let j = 0; j < HB; j++) for (let i = 0; i < HB; i++) b[j * HB + i] = wg.heightAt((bi * HB + i) * ss + NUDGE, (bj * HB + j) * ss + NUDGE);
  hblocks.set(key, b);
  if (hblocks.size > 600) hblocks.delete(hblocks.keys().next().value);
  return b;
}

/** Soft cast shadows (1 = lit) on a coarse grid over the tile + a margin toward the light. */
function shadowGrid(wg, x0, z0, size, step) {
  const ss = Math.max(8, step * 4);
  const reach = Math.min(64, Math.ceil(600 / ss)); // cells of margin toward the light (north-north-east)
  const mx = Math.ceil(reach * Math.abs(LDX)) + 1;
  const mz = Math.ceil(reach * Math.abs(LDZ)) + 1;
  // lattice-aligned grid: one cell west / south of the tile, mz cells north, mx cells east
  const gi0 = Math.floor(x0 / ss) - 1;
  const gj0 = Math.floor(z0 / ss) - mz;
  const gi1 = Math.ceil((x0 + size) / ss) + 1 + mx;
  const gj1 = Math.ceil((z0 + size) / ss) + 1;
  const gw = gi1 - gi0 + 1;
  const gh = gj1 - gj0 + 1;
  const gx0 = gi0 * ss;
  const gz0 = gj0 * ss;
  const n = Math.ceil((x0 + size) / ss) + 1 - gi0 + 1; // columns over the tile
  const H = new Float32Array(gw * gh);
  let maxH = -Infinity;
  for (let j = 0; j < gh; j++) {
    const gj = gj0 + j;
    const bj = Math.floor(gj / HB);
    const oj = gj - bj * HB;
    let bi = NaN;
    let blk = null;
    for (let i = 0; i < gw; i++) {
      const gi = gi0 + i;
      const b2 = Math.floor(gi / HB);
      if (b2 !== bi) {
        bi = b2;
        blk = hblock(wg, ss, bi, bj);
      }
      const h = blk[oj * HB + (gi - bi * HB)];
      H[j * gw + i] = h;
      if (h > maxH) maxH = h;
    }
  }
  const at = (fx, fz) => {
    if (fx < 0) fx = 0;
    else if (fx > gw - 1.001) fx = gw - 1.001;
    if (fz < 0) fz = 0;
    else if (fz > gh - 1.001) fz = gh - 1.001;
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * gw + i;
    return (H[k] + (H[k + 1] - H[k]) * tx) * (1 - tz) + (H[k + gw] + (H[k + gw + 1] - H[k + gw]) * tx) * tz;
  };
  const lit = new Float32Array(gw * gh).fill(1);
  const maxT = reach * ss;
  // only the cells over the tile (rows from z0 down, columns up to the tile's east edge)
  for (let j = Math.max(0, Math.floor(z0 / ss) - 1 - gj0); j < gh; j++) {
    for (let i = 0; i < n; i++) {
      const h0 = Math.max(H[j * gw + i], 0) + 0.6;
      let l = 1;
      let t = ss * 0.75;
      while (t < maxT) {
        const ry = h0 + t * TAN_EL;
        if (ry > maxH) break;
        const clear = ry - at(i + (LDX * t) / ss, j + (LDZ * t) / ss);
        if (clear < 0) {
          l = 0;
          break;
        }
        const soft = clear / (t * 0.09);
        if (soft < l) l = soft;
        t += Math.max(ss * 0.75, t * 0.05);
      }
      lit[j * gw + i] = l;
    }
  }
  return (x, z) => {
    let fx = (x - gx0) / ss;
    let fz = (z - gz0) / ss;
    if (fx < 0) fx = 0;
    else if (fx > gw - 1.001) fx = gw - 1.001;
    if (fz < 0) fz = 0;
    else if (fz > gh - 1.001) fz = gh - 1.001;
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * gw + i;
    const v = (lit[k] + (lit[k + 1] - lit[k]) * tx) * (1 - tz) + (lit[k + gw] + (lit[k + gw + 1] - lit[k + gw]) * tx) * tz;
    return v > 1 ? 1 : v;
  };
}

const NM = 10; // masks per sample node

export function mapTile(wg, { x0, z0, size, px }) {
  const step = size / px;
  const out = new Uint8ClampedArray(px * px * 4);
  // 1) samples on a lattice (every 2nd pixel at fine zooms — the terrain itself is ~4 m), plus a ring for
  //    the gradients: heights + the 3D terrain's ground masks (same formulas as packTile)
  const st = step <= 8 ? 2 : 1;
  const ls = step * st; // lattice spacing (m)
  const K = px / st;
  const N = K + 3; // nodes per side: k = 0 … K + 2 at x0 + (k − 1)·ls
  const Hs = new Float64Array(N * N);
  const masks = new Float32Array(N * N * NM);
  const dens = new Float32Array(N * N); // tree density
  const kindOf = new Uint8Array(N * N); // dominant biome
  for (let j = 0; j < N; j++) {
    const z = z0 + (j - 1) * ls + NUDGE;
    for (let i = 0; i < N; i++) {
      const x = x0 + (i - 1) * ls + NUDGE;
      const q = j * N + i;
      if (i === 0 || j === 0 || i === N - 1 || j === N - 1) {
        Hs[q] = wg.heightAt(x, z);
        continue;
      }
      const h = wg._sample(x, z, S, W);
      Hs[q] = h;
      const m = q * NM;
      const coastal = W[0] + W[1];
      masks[m] = Math.min(1, (1 - sstep(1.0, 3.6, h)) * (0.55 + 0.45 * coastal) + 0.6 * W[1] * (1 - sstep(3.5, 7, h))); // sand
      masks[m + 1] = Math.min(1, W[6] + 0.4 * S[S_BAD]); // canyon
      masks[m + 2] = W[4]; // jungle
      masks[m + 3] = 0.35 * W[5] + 0.2 * W[7] + 0.12 * W[6] + 0.1 * W[3]; // bare ground
      masks[m + 4] = Math.min(1, 0.45 * W[5] + 0.3 * W[7] + 0.6 * S[S_MOUNT] + 0.25 * S[S_PLAT]); // rock
      masks[m + 5] = Math.min(1, (1 - sstep(0.2, 1.7, h)) * (h > -1.5 ? 1 : 0) + 0.5 * S[S_RIVER] + 0.3 * S[S_LAKE]); // wet
      masks[m + 6] = Math.min(1, 0.85 * W[3] + 0.6 * W[4]); // forest floor
      masks[m + 7] = snowAt(S, h);
      masks[m + 8] = S[S_M];
      masks[m + 9] = W[2] + 0.3 * W[1]; // golden meadows
      let d = 0;
      let best = 0;
      for (let k = 0; k < 8; k++) {
        d += TREES[k] * W[k];
        if (W[k] > W[best]) best = k;
      }
      dens[q] = d;
      kindOf[q] = best;
    }
  }
  // gradients + cavity at the inner nodes
  const GX = new Float32Array(N * N);
  const GZ = new Float32Array(N * N);
  const CV = new Float32Array(N * N);
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      GX[c] = (Hs[c - 1] - Hs[c + 1]) / (2 * ls);
      GZ[c] = (Hs[c - N] - Hs[c + N]) / (2 * ls);
      const lap = (Hs[c - 1] + Hs[c + 1] + Hs[c - N] + Hs[c + N] - 4 * Hs[c]) / ls;
      const cav = lap * 0.22;
      CV[c] = cav < -1 ? -1 : cav > 1 ? 1 : cav;
    }
  }
  const litAt = shadowGrid(wg, x0, z0, size, step);
  const M = new Float32Array(NM);
  // 2) ground + water, lit
  for (let j = 0; j < px; j++) {
    const z = z0 + (j + 0.5) * step;
    const cj = Math.floor(z / step);
    const fz = (j + 0.5) / st + 1;
    const nj = fz | 0;
    const tz = fz - nj;
    for (let i = 0; i < px; i++) {
      const x = x0 + (i + 0.5) * step;
      const ci = Math.floor(x / step);
      const fx = (i + 0.5) / st + 1;
      const ni = fx | 0;
      const tx = fx - ni;
      const a = nj * N + ni;
      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;
      const h = Hs[a] * w00 + Hs[a + 1] * w10 + Hs[a + N] * w01 + Hs[a + N + 1] * w11;
      const o = (j * px + i) * 4;
      const lit = litAt(x, z);
      if (h < -0.04) {
        const depth = -h;
        shadeWater(col, depth, seamlessSheen(noise.ripple(x, z), depth), lit, hash2(ci >> 1, cj >> 1));
      } else {
        const gx = GX[a] * w00 + GX[a + 1] * w10 + GX[a + N] * w01 + GX[a + N + 1] * w11;
        const gz = GZ[a] * w00 + GZ[a + 1] * w10 + GZ[a + N] * w01 + GZ[a + N + 1] * w11;
        const cav = CV[a] * w00 + CV[a + 1] * w10 + CV[a + N] * w01 + CV[a + N + 1] * w11;
        const il = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        const ny = il;
        const ma = a * NM;
        for (let k = 0; k < NM; k++) M[k] = masks[ma + k] * w00 + masks[ma + NM + k] * w10 + masks[ma + N * NM + k] * w01 + masks[ma + (N + 1) * NM + k] * w11;
        P.h = h;
        P.slope = 1 - ny;
        P.moist = M[8];
        P.mac = noise.macro(x, z);
        P.sand = M[0];
        P.canyon = M[1];
        P.jungle = M[2];
        P.pad = M[3];
        P.rockO = M[4];
        P.ffloor = M[6] * 0.55;
        P.snow = M[7];
        P.dry = 0.45 * M[9];
        P.fine = 0.9 + 0.2 * hash2(ci, cj);
        P.rockV = hash2(ci >> 2, cj >> 2);
        // strata phase per pixel = 1.3·|∇h|·step: fade them out before they alias into moiré
        P.strata = 1 - sstep(0.5, 1.4, 1.3 * Math.sqrt(gx * gx + gz * gz) * step);
        shadeLand(col, P);
        // coarse zooms: canopies are sub-pixel — tint the ground by the forest cover instead
        const dn = dens[a] * w00 + dens[a + 1] * w10 + dens[a + N] * w01 + dens[a + N + 1] * w11;
        if (step > 8 && dn > 0.01) {
          const pal = CANOPY[KIND[kindOf[tz < 0.5 ? (tx < 0.5 ? a : a + 1) : tx < 0.5 ? a + N : a + N + 1]][0]];
          const k = Math.min(0.75, dn * 1.25) * (1 - P.sand) * (1 - P.snow);
          col[0] += ((pal[0][0] + pal[1][0]) * 0.5 - col[0]) * k;
          col[1] += ((pal[0][1] + pal[1][1]) * 0.5 - col[1]) * k;
          col[2] += ((pal[0][2] + pal[1][2]) * 0.5 - col[2]) * k;
        }
        lightLand(col, gx * il, ny, gz * il, lit, cav, M[5]);
      }
      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
      out[o + 3] = 255;
    }
  }
  // 3) trees (fine zooms): world-space jittered grid, so canopies continue across tile edges
  if (step <= 8) trees(out, px, x0, z0, size, step, ls, Hs, N, dens, kindOf, masks);
  // 4) grade
  for (let o = 0; o < out.length; o += 4) gradePixel(out, o);
  return out;
}

function trees(out, px, x0, z0, size, step, ls, Hs, N, dens, kindOf, masks) {
  const sp = TREE_SPACING;
  const pad = 14;
  const i0 = Math.floor((x0 - pad) / sp);
  const i1 = Math.floor((x0 + size + pad) / sp);
  const j0 = Math.floor((z0 - pad) / sp);
  const j1 = Math.floor((z0 + size + pad) / sp);
  const shx = -LDX / TAN_EL;
  const shz = -LDZ / TAN_EL;
  const list = [];
  for (let cj = j0; cj <= j1; cj++) {
    for (let ci = i0; ci <= i1; ci++) {
      const r1 = hash2(ci * 3 + 1, cj * 7 - 5);
      const x = (ci + 0.15 + 0.7 * hash2(ci, cj)) * sp;
      const z = (cj + 0.15 + 0.7 * hash2(cj + 911, ci - 77)) * sp;
      // nearest inner sample node (candidates in the margin borrow the edge node)
      let ni = Math.round((x - x0) / ls) + 1;
      let nj = Math.round((z - z0) / ls) + 1;
      ni = ni < 1 ? 1 : ni > N - 2 ? N - 2 : ni;
      nj = nj < 1 ? 1 : nj > N - 2 ? N - 2 : nj;
      const p = nj * N + ni;
      if (r1 >= dens[p] * 1.6) continue;
      const m = p * NM;
      const h = Hs[p];
      if (h < 0.6 || masks[m] > 0.45 || masks[m + 7] > 0.4 || masks[m + 4] > 0.6) continue;
      const kinds = KIND[kindOf[p]];
      const r2 = hash2(ci - 31, cj + 17);
      const kind = r2 < 0.7 ? kinds[0] : kinds[1];
      const crown = CROWN[kind] * (0.75 + 0.5 * r2);
      list.push(x, z, crown, kind, crown * 3.4, r1);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let t = 0; t < list.length; t += 6) {
      const x = list[t];
      const z = list[t + 1];
      const r = list[t + 2];
      const kind = list[t + 3];
      const rp = Math.max(0.75, r / step);
      if (pass === 0) {
        const len = Math.min(list[t + 4] * 0.55, 14);
        stampShadow(out, px, px, (x - x0 + shx * len) / step, (z - z0 + shz * len) / step, rp * 1.05, 0.5);
      } else {
        stampCanopy(out, px, px, (x - x0) / step, (z - z0) / step, rp, CANOPY[kind], LDX, LDZ, 0.86 + 0.28 * list[t + 5], kind === 0 ? 0.85 : 1);
      }
    }
  }
}
