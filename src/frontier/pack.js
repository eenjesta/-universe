/**
 * Worker-side packing of worldgen output into GPU-ready typed arrays (pure JS,
 * no three.js — also usable on the main thread as a fallback).
 *
 * Tile vertex layout ((cells + 1)² grid vertices, then 4 × (cells + 1) skirt vertices):
 *   position  Float32 ×3   relative to the 1024 m block origin (bx, 0, bz) the tile lies in, so
 *                          `position.xz` doubles as a precise, wrap-free detail-texture coordinate
 *                          (all detail scales are k / 1024 m⁻¹); skirts hang `skirt` m lower
 *   normal    Int8 ×4      xyz (normalised ×127), w = cavity (−127 … 127, + = hollow)
 *   splatA    Uint8 ×4     sand, red (badlands), jungle, bare dirt
 *   splatB    Uint8 ×4     rock override, wet, forest floor, snow
 *   splatC    Uint8 ×4     moisture, golden (meadow), crystal tint (highlands), biome id × 32
 *   morph     Float32      parent-LOD height − height (geomorph target)
 *   rules     Uint8 ×2     §11.2 static build verdict (worldgen.isBuildable): x = 255 where building is
 *                          refused, y = reason code × 63 (1 safe, 2 hub buffer, 3 highway, 4 POI) — the
 *                          'build rules' overlay of the lab
 */
const REASON_CODE = { safe: 1, hub: 2, highway: 3, poi: 4 };
import { snowAt, BIOME_LIST, BIOME_INDEX, FIELDS } from '../../shared/worldgen/index.js';
import { hash3, u01, nextHash, sstep } from '../../shared/worldgen/noise.js';

const { S_LEN, S_T, S_M, S_RIVER, S_LAKE, S_MOUNT, S_BAD, S_PLAT } = FIELDS;
const S = new Float64Array(S_LEN);
const W = new Float32Array(8);
const clampByte = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

export const TREE_VARIANTS = ['pineTall', 'pineMid', 'spruce', 'oak', 'birch', 'acacia', 'jungleTree', 'palm'];
export const BUSH_VARIANTS = ['bushGreen', 'bushJuniper', 'fern', 'tropic', 'glowPlant'];
export const ROCK_VARIANTS = ['boulder', 'slab', 'shard', 'outcrop', 'hoodoo', 'pebble'];
const TREE_IDX = Object.fromEntries(TREE_VARIANTS.map((v, i) => [v, i]));
const BUSH_IDX = Object.fromEntries(BUSH_VARIANTS.map((v, i) => [v, i]));
const ROCK_IDX = Object.fromEntries(ROCK_VARIANTS.map((v, i) => [v, i]));
// per-biome grass density (index order of BIOME_LIST)
const GRASS = BIOME_LIST.map((b) => b.grass || 0);

export function packTile(wg, { id, x0, z0, size, cells }) {
  const step = size / cells;
  const n = cells + 3;
  const v = cells + 1;
  const nv = v * v;
  const total = nv + 4 * v;
  const H = new Float64Array(n * n);
  const pos = new Float32Array(total * 3);
  const nrm = new Int8Array(total * 4);
  const sa = new Uint8Array(total * 4);
  const sb = new Uint8Array(total * 4);
  const sc = new Uint8Array(total * 4);
  const morph = new Float32Array(total);
  const rules = new Uint8Array(total * 2);
  let minH = Infinity;
  let maxH = -Infinity;
  let water = 0;
  const bx = Math.floor(x0 / 1024) * 1024;
  const bz = Math.floor(z0 / 1024) * 1024;
  for (let j = 0; j < n; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < n; i++) {
      const x = x0 + (i - 1) * step;
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) {
        H[j * n + i] = wg.heightAt(x, z);
        continue;
      }
      const h = wg._sample(x, z, S, W);
      H[j * n + i] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      if (h < 0) water++;
      const k = (j - 1) * v + (i - 1);
      const o = k * 4;
      const coastal = W[0] + W[1];
      // sand: beaches, river / lake gravel, low land by the water
      const sand = (1 - sstep(1.0, 3.6, h)) * (0.55 + 0.45 * coastal) + 0.6 * W[1] * (1 - sstep(3.5, 7, h));
      sa[o] = clampByte(sand);
      sa[o + 1] = clampByte(W[6] + 0.4 * S[S_BAD]);
      sa[o + 2] = clampByte(W[4]);
      sa[o + 3] = clampByte(0.35 * W[5] + 0.2 * W[7] + 0.12 * W[6] + 0.1 * W[3]);
      sb[o] = clampByte(0.45 * W[5] + 0.3 * W[7] + 0.6 * S[S_MOUNT] + 0.25 * S[S_PLAT]);
      sb[o + 1] = clampByte((1 - sstep(0.2, 1.7, h)) * (h > -1.5 ? 1 : 0) + 0.5 * S[S_RIVER] + 0.3 * S[S_LAKE]);
      sb[o + 2] = clampByte(0.85 * W[3] + 0.6 * W[4]);
      sb[o + 3] = clampByte(snowAt(S, h));
      sc[o] = clampByte(S[S_M]);
      sc[o + 1] = clampByte(W[2] + 0.3 * W[1]);
      sc[o + 2] = clampByte(W[5]);
      sc[o + 3] = Math.min(255, S[15] * 32);
      const verdict = wg.isBuildable(x, z);
      if (!verdict.ok) {
        rules[k * 2] = 255;
        rules[k * 2 + 1] = (REASON_CODE[verdict.reason] || 0) * 63;
      }
    }
  }
  // positions, normals, cavity, morph
  const morphOf = (i, j) => {
    // parent grid (2× spacing) surface at this vertex, using the same triangulation (diagonal b–c)
    const oi = i & 1;
    const oj = j & 1;
    const h = (a, b) => H[(b + 1) * n + (a + 1)];
    if (!oi && !oj) return 0;
    if (oi && !oj) return (h(i - 1, j) + h(i + 1, j)) * 0.5 - h(i, j);
    if (!oi && oj) return (h(i, j - 1) + h(i, j + 1)) * 0.5 - h(i, j);
    return (h(i + 1, j - 1) + h(i - 1, j + 1)) * 0.5 - h(i, j);
  };
  for (let j = 0; j < v; j++) {
    for (let i = 0; i < v; i++) {
      const k = j * v + i;
      const c = (j + 1) * n + (i + 1);
      const h = H[c];
      pos[k * 3] = x0 - bx + i * step;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z0 - bz + j * step;
      const hx = H[c - 1] - H[c + 1];
      const hz = H[c - n] - H[c + n];
      const l = Math.sqrt(hx * hx + 4 * step * step + hz * hz);
      nrm[k * 4] = Math.round((hx / l) * 127);
      nrm[k * 4 + 1] = Math.round(((2 * step) / l) * 127);
      nrm[k * 4 + 2] = Math.round((hz / l) * 127);
      const lap = (H[c - 1] + H[c + 1] + H[c - n] + H[c + n] - 4 * h) / step;
      const cav = lap * 0.22;
      nrm[k * 4 + 3] = Math.round((cav < -1 ? -1 : cav > 1 ? 1 : cav) * 127);
      morph[k] = morphOf(i, j);
    }
  }
  // skirts: copies of the edge vertices, lowered
  const skirt = 3 + size * 0.03;
  let s = nv;
  const edges = [
    (t) => t, // north row j = 0
    (t) => cells * v + t, // south row
    (t) => t * v, // west column
    (t) => t * v + cells, // east column
  ];
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < v; t++, s++) {
      const k = edges[e](t);
      pos[s * 3] = pos[k * 3];
      pos[s * 3 + 1] = pos[k * 3 + 1] - skirt;
      pos[s * 3 + 2] = pos[k * 3 + 2];
      for (let q = 0; q < 4; q++) {
        nrm[s * 4 + q] = nrm[k * 4 + q];
        sa[s * 4 + q] = sa[k * 4 + q];
        sb[s * 4 + q] = sb[k * 4 + q];
        sc[s * 4 + q] = sc[k * 4 + q];
      }
      morph[s] = morph[k];
      rules[s * 2] = rules[k * 2];
      rules[s * 2 + 1] = rules[k * 2 + 1];
    }
  }
  const msg = { type: 'tile', id, x0, z0, bx, bz, size, cells, minH, maxH, skirt, water: water / nv, pos, nrm, sa, sb, sc, morph, rules };
  return { msg, transfer: [pos.buffer, nrm.buffer, sa.buffer, sb.buffer, sc.buffer, morph.buffer, rules.buffer] };
}

/**
 * Chunk features → decor (Float32 ×8 per item: kind, variant, x, y, z, rot, scale, biome index;
 * kind 0 tree, 1 bush, 2 rock, 3 crystal), nodes / pois / waystones as small
 * objects, and optional grass clumps (Float32 ×5: x, y, z, rot, scale + Uint8 ×4 colour + Uint8 kind:
 * 0 grass, 1 meadow flowers, 2 glowing flowers).
 */
export function packChunk(wg, { id, cx, cz, grass = false, gstep = 2.2 }) {
  const feats = wg.features(cx, cz);
  let nd = 0;
  for (const f of feats) if (f.type === 'tree' || f.type === 'bush' || f.type === 'rock' || f.type === 'crystal') nd++;
  const decor = new Float32Array(nd * 8);
  const nodes = [];
  const pois = [];
  let d = 0;
  for (const f of feats) {
    let kind = -1;
    let variant = 0;
    if (f.type === 'tree') {
      kind = 0;
      variant = TREE_IDX[f.variant] ?? 1;
    } else if (f.type === 'bush') {
      kind = 1;
      variant = BUSH_IDX[f.variant] ?? 0;
    } else if (f.type === 'rock') {
      kind = 2;
      variant = ROCK_IDX[f.variant] ?? 0;
    } else if (f.type === 'crystal') {
      kind = 3;
      variant = f.variant | 0;
    }
    if (kind >= 0) {
      const o = d * 8;
      decor[o] = kind;
      decor[o + 1] = variant;
      decor[o + 2] = f.x;
      decor[o + 3] = f.y;
      decor[o + 4] = f.z;
      decor[o + 5] = f.rot;
      decor[o + 6] = f.scale;
      decor[o + 7] = BIOME_INDEX[f.biome] ?? 2;
      d++;
    } else if (f.type === 'node') nodes.push({ id: f.id, type: f.resource, x: f.x, y: f.y, z: f.z, rot: f.rot, scale: f.scale });
    else pois.push({ id: f.id, type: f.type, variant: f.variant | 0, x: f.x, y: f.y, z: f.z, rot: f.rot, radius: f.radius || 0, name: f.name || null, km: f.km || 0 });
  }
  const msg = { type: 'chunk', id, cx, cz, decor, nodes, pois, grass: null, gcol: null, gkind: null };
  const transfer = [decor.buffer];
  if (grass) {
    const g = grassClumps(wg, cx, cz, gstep);
    msg.grass = g.inst;
    msg.gcol = g.col;
    msg.gkind = g.kind;
    transfer.push(g.inst.buffer, g.col.buffer, g.kind.buffer);
  }
  return { msg, transfer };
}

// grass ramp (linear-ish sRGB bytes): lush → olive → golden, jungle green, red-dust tint
const G_LUSH = [74, 102, 38];
const G_OLIVE = [110, 110, 48];
const G_DRY = [196, 160, 78];
const G_JUNGLE = [44, 90, 46];
const G_RED = [176, 120, 70];

/** Smooth 0..1 value noise on a 11 m lattice (flower patches; pure hashing, deterministic). */
function patchNoise(x, z) {
  const fx = x / 11;
  const fz = z / 11;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  let tx = fx - i;
  let tz = fz - j;
  tx = tx * tx * (3 - 2 * tx);
  tz = tz * tz * (3 - 2 * tz);
  const a = u01(hash3(i, j, 3, 0x51f0a1));
  const b = u01(hash3(i + 1, j, 3, 0x51f0a1));
  const c = u01(hash3(i, j + 1, 3, 0x51f0a1));
  const d = u01(hash3(i + 1, j + 1, 3, 0x51f0a1));
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/**
 * Grass clumps near the camera; a few become flower clumps in patches: kind 1 = meadow
 * flowers (Golden Meadows, coast), kind 2 = bioluminescent flowers (Lumen Forest / Wilds).
 */
function grassClumps(wg, cx, cz, step) {
  const x0 = cx * 64;
  const z0 = cz * 64;
  const nPer = Math.max(1, Math.floor(64 / step));
  const inst = [];
  const col = [];
  const kinds = [];
  let k = 0;
  const seed = 0x9a3f17;
  for (let j = 0; j < nPer; j++) {
    for (let i = 0; i < nPer; i++, k++) {
      let h = hash3(cx, cz, k, seed);
      const x = x0 + (i + u01(h)) * step;
      h = nextHash(h);
      const z = z0 + (j + u01(h)) * step;
      if (Math.max(Math.abs(x), Math.abs(z)) < 1201) continue;
      const y = wg._sample(x, z, S, W);
      if (y < 0.7) continue;
      let dens = 0;
      for (let b = 0; b < 8; b++) dens += W[b] * GRASS[b];
      dens *= 1 - sstep(330, 390, y);
      h = nextHash(h);
      if (u01(h) >= dens) continue;
      if (wg.highwayDistance(x, z, 12) < 7) continue;
      const p = wg.poiAt(x, z);
      if (p && (p.x - x) ** 2 + (p.z - z) ** 2 < (p.radius * 0.8) ** 2) continue;
      // slope from two extra samples
      const sx = wg.heightAt(x + 1.2, z) - y;
      const sz = wg.heightAt(x, z + 1.2) - y;
      if (sx * sx + sz * sz > 0.85) continue;
      h = nextHash(h);
      const rot = u01(h) * Math.PI * 2;
      h = nextHash(h);
      const golden = W[2] + 0.3 * W[1];
      const scale = (0.65 + 0.6 * u01(h)) * (0.85 + 0.45 * golden + 0.25 * W[4]);
      inst.push(x, y - 0.05, z, rot, scale);
      // flower patches
      h = nextHash(h);
      const pf = sstep(0.4, 0.75, patchNoise(x, z));
      const uf = u01(h);
      const pm = 0.3 * (W[2] + 0.5 * W[1]) * pf;
      const pg = 0.2 * (W[3] + W[4]) * pf;
      kinds.push(uf < pm ? 1 : uf < pm + pg ? 2 : 0);
      // colour: moisture / golden ramp like the terrain shader
      const dry = Math.min(1, Math.max(0, 0.66 - S[S_M] * 0.8 + golden * 0.45 + (y - 35) * 0.003));
      const a = dry < 0.5 ? G_LUSH : G_OLIVE;
      const b = dry < 0.5 ? G_OLIVE : G_DRY;
      const t = dry < 0.5 ? dry * 2 : dry * 2 - 1;
      let r = a[0] + (b[0] - a[0]) * t;
      let gg = a[1] + (b[1] - a[1]) * t;
      let bb = a[2] + (b[2] - a[2]) * t;
      const jw = W[4];
      r += (G_JUNGLE[0] - r) * jw;
      gg += (G_JUNGLE[1] - gg) * jw;
      bb += (G_JUNGLE[2] - bb) * jw;
      const rw = W[6] * 0.7;
      r += (G_RED[0] - r) * rw;
      gg += (G_RED[1] - gg) * rw;
      bb += (G_RED[2] - bb) * rw;
      h = nextHash(h);
      const v = 0.85 + 0.3 * u01(h);
      col.push(Math.min(255, r * v), Math.min(255, gg * v), Math.min(255, bb * v), 255);
    }
  }
  return { inst: Float32Array.from(inst), col: Uint8Array.from(col), kind: Uint8Array.from(kinds) };
}

/** Minimap tile: px × px RGBA (biome colours, hill shading, water depth). */
export function mapTile(wg, { x0, z0, size, px }) {
  const step = size / px;
  const rgba = new Uint8ClampedArray(px * px * 4);
  const hs = new Float64Array((px + 1) * (px + 1));
  for (let j = 0; j <= px; j++) for (let i = 0; i <= px; i++) hs[j * (px + 1) + i] = wg.heightAt(x0 + i * step, z0 + j * step);
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const x = x0 + (i + 0.5) * step;
      const z = z0 + (j + 0.5) * step;
      const h = hs[j * (px + 1) + i];
      let r;
      let g;
      let b;
      if (h < 0) {
        const t = Math.min(1, -h / 40);
        r = 40 - 22 * t;
        g = 104 - 46 * t;
        b = 128 - 30 * t;
      } else {
        wg._sample(x, z, S, W);
        r = 0;
        g = 0;
        b = 0;
        for (let k = 0; k < 8; k++) {
          const c = BIOME_LIST[k].color;
          r += c[0] * W[k];
          g += c[1] * W[k];
          b += c[2] * W[k];
        }
        const snow = snowAt(S, h);
        r = (r + (0.92 - r) * snow) * 255;
        g = (g + (0.93 - g) * snow) * 255;
        b = (b + (0.96 - b) * snow) * 255;
        // light from the north-west
        const dx = hs[j * (px + 1) + i + 1] - h;
        const dz = hs[(j + 1) * (px + 1) + i] - h;
        const shade = 1 + Math.max(-0.45, Math.min(0.35, (-dx - dz) * (6 / step)));
        r *= shade;
        g *= shade;
        b *= shade;
      }
      const o = (j * px + i) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}
