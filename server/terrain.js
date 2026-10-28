import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { ROOT } from './config.js';
import { writeAtomic } from './store/fsutil.js';

/**
 * Terrain heights for the server sim: the same 1201² (2 m) height grid the
 * client bakes (src/world/terrain/heightfield.js bakeTerrain, ~1.7 s in Node),
 * cached as a small binary in DATA_DIR/cache so restarts take milliseconds.
 * The cache key is a hash of the terrain source files (+ the three version,
 * whose SimplexNoise permutation feeds the bake), so a terrain change rebakes.
 *
 * Returns { getHeightAt(x, z), isWater(x, z), getWaterHeightAt(x, z), waterLevel, source, ms }
 * — the same semantics as src/world/terrain/queries.js (without three.js).
 */
const SOURCES = [
  'src/world/terrain/heightfield.js',
  'src/world/terrain/shape.js',
  'src/world/terrain/noise.js',
  'src/world/layout.js',
  'src/core/noise.js',
  'src/core/math.js',
];
const MAGIC = 0x52544f55; // 'UOTR'
const FORMAT = 1;
const HEADER_U32 = 12;

async function sourceHash() {
  const h = crypto.createHash('sha256');
  h.update(`format${FORMAT}`);
  for (const rel of SOURCES) h.update(await fsp.readFile(path.join(ROOT, rel)));
  try {
    const req = createRequire(import.meta.url);
    h.update(String(req('three/package.json').version));
  } catch {}
  return h.digest('hex').slice(0, 16);
}

function encodeGrid(g) {
  const n2 = g.N * g.N;
  const rs = g.river.w * g.river.h;
  const header = new Uint32Array(HEADER_U32);
  const hf = new Float32Array(header.buffer);
  header[0] = MAGIC;
  header[1] = FORMAT;
  header[2] = g.N;
  hf[3] = g.STEP;
  hf[4] = g.HALF;
  header[5] = g.river.i0;
  header[6] = g.river.j0;
  header[7] = g.river.w;
  header[8] = g.river.h;
  header[9] = n2;
  header[10] = rs;
  const capPad = new Uint8Array(Math.ceil(rs / 4) * 4);
  capPad.set(g.river.cap);
  return Buffer.concat([
    Buffer.from(header.buffer),
    Buffer.from(g.heights.buffer, g.heights.byteOffset, g.heights.byteLength),
    Buffer.from(g.river.dist.buffer, g.river.dist.byteOffset, g.river.dist.byteLength),
    Buffer.from(g.river.water.buffer, g.river.water.byteOffset, g.river.water.byteLength),
    Buffer.from(g.river.halfWidth.buffer, g.river.halfWidth.byteOffset, g.river.halfWidth.byteLength),
    Buffer.from(capPad.buffer),
  ]);
}

function decodeGrid(buf) {
  // copy into an aligned ArrayBuffer (readFile buffers may sit at any offset)
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  if (buf.length < HEADER_U32 * 4) throw new Error('short terrain cache');
  const header = new Uint32Array(ab, 0, HEADER_U32);
  const hf = new Float32Array(ab, 0, HEADER_U32);
  if (header[0] !== MAGIC || header[1] !== FORMAT) throw new Error('bad terrain cache header');
  const N = header[2];
  const n2 = header[9];
  const rs = header[10];
  if (n2 !== N * N || rs !== header[7] * header[8]) throw new Error('bad terrain cache sizes');
  const expect = HEADER_U32 * 4 + n2 * 4 + rs * 12 + Math.ceil(rs / 4) * 4;
  if (buf.length !== expect) throw new Error(`terrain cache length ${buf.length} != ${expect}`);
  let o = HEADER_U32 * 4;
  const heights = new Float32Array(ab, o, n2);
  o += n2 * 4;
  const dist = new Float32Array(ab, o, rs);
  o += rs * 4;
  const water = new Float32Array(ab, o, rs);
  o += rs * 4;
  const halfWidth = new Float32Array(ab, o, rs);
  o += rs * 4;
  const cap = new Uint8Array(ab, o, rs);
  return { N, STEP: hf[3], HALF: hf[4], heights, river: { i0: header[5], j0: header[6], w: header[7], h: header[8], dist, water, halfWidth, cap } };
}

async function bake() {
  const { bakeTerrain } = await import('../src/world/terrain/heightfield.js');
  const d = await bakeTerrain({});
  const r = d.river;
  return {
    N: d.N,
    STEP: d.STEP,
    HALF: d.HALF,
    heights: d.heights,
    river: { i0: r.region.i0, j0: r.region.j0, w: r.region.w, h: r.region.h, dist: r.dist, water: r.water, halfWidth: r.halfWidth, cap: r.cap },
  };
}

/** Height/water queries over a baked grid (bilinear heights; river data at the nearest sample). */
export function createTerrainQueries(g, waterLevel = 0) {
  const { heights, N, STEP, HALF, river } = g;
  const max = N - 1.0001;
  function getHeightAt(x, z) {
    let fx = (x + HALF) / STEP;
    let fz = (z + HALF) / STEP;
    if (!(fx > 0)) fx = 0; // also catches NaN
    else if (fx > max) fx = max;
    if (!(fz > 0)) fz = 0;
    else if (fz > max) fz = max;
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * N + i;
    const a = heights[k];
    const b = heights[k + 1];
    const c = heights[k + N];
    const d = heights[k + N + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  function riverIndex(x, z) {
    const i = Math.round((x + HALF) / STEP) - river.i0;
    const j = Math.round((z + HALF) / STEP) - river.j0;
    if (!(i >= 0 && j >= 0 && i < river.w && j < river.h)) return -1;
    return j * river.w + i;
  }
  function isWater(x, z) {
    const h = getHeightAt(x, z);
    if (h < waterLevel - 0.3) return true;
    const ri = riverIndex(x, z);
    return ri >= 0 && river.cap[ri] === 0 && river.dist[ri] < river.halfWidth[ri] - 0.5 && h < river.water[ri] - 0.3;
  }
  function getWaterHeightAt(x, z) {
    const h = getHeightAt(x, z);
    const ri = riverIndex(x, z);
    if (ri >= 0 && river.cap[ri] === 0 && river.dist[ri] < river.halfWidth[ri] + 0.5 && h < river.water[ri]) return river.water[ri];
    return h < waterLevel ? waterLevel : null;
  }
  return { getHeightAt, isWater, getWaterHeightAt, waterLevel };
}

/**
 * @param {{ cacheDir?: string, log: any, flat?: boolean }} opts — flat: no bake (h = 2 m everywhere; transport tests)
 */
export async function loadTerrain({ cacheDir, log, flat = false }) {
  const t0 = performance.now();
  if (flat) {
    return { getHeightAt: () => 2, isWater: () => false, getWaterHeightAt: () => null, waterLevel: 0, source: 'flat', ms: 0 };
  }
  let waterLevel = 0;
  try {
    waterLevel = (await import('../src/world/layout.js')).WORLD.waterLevel ?? 0;
  } catch {}
  let grid = null;
  let source = 'bake';
  let file = null;
  if (cacheDir) {
    try {
      file = path.join(cacheDir, `terrain-${await sourceHash()}.bin`);
      grid = decodeGrid(await fsp.readFile(file));
      source = 'cache';
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('terrain cache unusable, rebaking', { err: err.message });
      grid = null;
    }
  }
  if (!grid) {
    grid = await bake();
    if (file) {
      try {
        await fsp.mkdir(cacheDir, { recursive: true });
        await writeAtomic(file, encodeGrid(grid));
        // drop caches of older terrain versions
        for (const f of await fsp.readdir(cacheDir)) {
          if (/^terrain-[0-9a-f]+\.bin$/.test(f) && path.join(cacheDir, f) !== file) await fsp.rm(path.join(cacheDir, f), { force: true });
        }
      } catch (err) {
        log.warn('terrain cache not written', { err: err.message });
      }
    }
  }
  const q = createTerrainQueries(grid, waterLevel);
  const ms = Math.round(performance.now() - t0);
  log.info('terrain ready', { source, ms });
  return { ...q, source, ms, grid };
}
