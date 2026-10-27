import { CITY_ISLANDS } from '../layout.js';

/**
 * Top-down colour map for the shell's round minimap and the world map
 * ("Wereldkaart"): 1024² canvas, north up, covering ±1200 m.
 *
 * Built straight from the bake + surface masks (no GPU): biome colours
 * (golden ↔ lush grass, dark forest, jungle, red canyon, sand, rock, snow,
 * paved city land), water by depth with a light shallow rim, rivers and
 * roads, then a NW-lit hillshade with vertical exaggeration for relief.
 * The canvas is CPU-backed (willReadFrequently) so consumers can read pixels
 * without a GPU readback.
 *
 *   world.minimap = { canvas, size, worldToMap(x, z) → [u, v] (0..1),
 *                     mapToWorld(u, v) → [x, z] }
 */
export function createMinimap(data, surface, size = 1024) {
  const { HALF } = data;
  const span = HALF * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(size, size);
  minimapPixels(data, surface, size, img.data);
  g.putImageData(img, 0, 0);

  const worldToMap = (x, z) => [(x + HALF) / span, (z + HALF) / span];
  const mapToWorld = (u, v) => [u * span - HALF, v * span - HALF];
  return { canvas, size, worldToMap, mapToWorld, extent: HALF, cityIslands: CITY_ISLANDS };
}

/** Fills `px` (RGBA, size²) with the map colours (pure JS, also runs in Node). */
export function minimapPixels(data, surface, size, px = new Uint8ClampedArray(size * size * 4)) {
  const { N, heights } = data;
  const cityMask = data.city;
  const { normal, splatA, splatB } = surface;
  const roadReg = data.roads.region;
  const river = data.river;
  const gridPerPx = (N - 1) / size;
  // light from the north-west, 40° up (cartographic convention)
  const L = norm3(-0.62, 0.78, -0.62);
  const exag = 2.2;
  const flat = L[1]; // lambert term of a flat surface
  const col = [0, 0, 0];

  for (let py = 0; py < size; py++) {
    const gj = Math.min(N - 1, Math.round((py + 0.5) * gridPerPx));
    for (let pxi = 0; pxi < size; pxi++) {
      const gi = Math.min(N - 1, Math.round((pxi + 0.5) * gridPerPx));
      const k = gj * N + gi;
      const h = heights[k];
      const o4 = k * 4;
      const o = (py * size + pxi) * 4;
      const ri = river.index(gi, gj);
      const inRiver = ri >= 0 && river.cap[ri] === 0 && river.dist[ri] < river.halfWidth[ri] - 0.5;

      if (h < 0 || inRiver) {
        // water: shallow teal → deep blue (sea darker), a light foam line at the shore
        const depth = inRiver ? 1.2 : -h;
        const t = Math.min(1, Math.sqrt(depth / 26));
        col[0] = 58 + (10 - 58) * t;
        col[1] = 128 + (38 - 128) * t;
        col[2] = 136 + (70 - 136) * t;
        const rim = Math.max(0, 1 - depth / 0.9);
        col[0] += (210 - col[0]) * rim * 0.55;
        col[1] += (222 - col[1]) * rim * 0.55;
        col[2] += (212 - col[2]) * rim * 0.55;
      } else {
        landColour(h, splatA, splatB, normal, o4, col);
        // forest canopy texture (tree crowns ≈ 5 m)
        const fo = splatB[o4 + 3] / 255 + splatA[o4 + 2] / 340;
        if (fo > 0.05) {
          const cr = crown(gi, gj);
          const k = 1 + Math.min(1, fo) * (cr - 0.5) * 0.5;
          col[0] *= k;
          col[1] *= k;
          col[2] *= k;
        }
        // city land: dark urban fabric (blocks + lighter streets every ~26 m)
        const city = cityMask[k] / 255;
        if (city > 0) {
          const street = gi % 13 === 0 || gj % 13 === 0 ? 1 : 0;
          const v = street ? 118 : 64 + 30 * crown(gi >> 2, gj >> 2);
          col[0] += (v - col[0]) * city * 0.9;
          col[1] += (v + 2 - col[1]) * city * 0.9;
          col[2] += (v + 8 - col[2]) * city * 0.9;
        }
        // roads: dark paving with a light edge line
        const rd = roadReg.get(gi, gj);
        if (rd < 0.2) {
          const edge = rd > -1.6 ? 1 : 0;
          const v = edge ? 150 : 58;
          col[0] = v;
          col[1] = v;
          col[2] = v + (edge ? 6 : 4);
        }
        // hillshade from the surface normals (vertically exaggerated)
        const nx = (normal[o4] / 255) * 2 - 1;
        const nz = (normal[o4 + 1] / 255) * 2 - 1;
        const ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz)) / exag;
        const il = 1 / Math.hypot(nx, ny, nz);
        const lam = (nx * L[0] + ny * L[1] + nz * L[2]) * il;
        const shade = Math.max(0.35, Math.min(1.45, 0.82 + (lam - flat) * 1.25));
        const cav = (normal[o4 + 2] - 128) / 128; // + in hollows
        const k2 = shade * (1 - Math.max(-0.12, Math.min(0.2, cav * 0.4)));
        col[0] *= k2;
        col[1] *= k2;
        col[2] *= k2;
      }
      px[o] = clamp255(col[0]);
      px[o + 1] = clamp255(col[1]);
      px[o + 2] = clamp255(col[2]);
      px[o + 3] = 255;
    }
  }
  return px;
}

/** Biome colour of a land sample (splat masks, see surface.js). */
function landColour(h, A, B, Nm, o4, out) {
  const sand = A[o4] / 255;
  const canyon = A[o4 + 1] / 255;
  const jungle = A[o4 + 2] / 255;
  const dirt = A[o4 + 3] / 255;
  const rock = B[o4] / 255;
  const grass = B[o4 + 2] / 255;
  const forest = B[o4 + 3] / 255;
  const moist = Nm[o4 + 3] / 255;
  const slope = 1 - Math.sqrt(Math.max(0, 1 - ((Nm[o4] / 255) * 2 - 1) ** 2 - ((Nm[o4 + 1] / 255) * 2 - 1) ** 2));
  // grass: golden dry ↔ lush green (darker, map-like)
  const dry = Math.min(1, Math.max(0, 0.75 - moist * 0.9 + (h - 35) * 0.004));
  let r = mixv(70, 138, dry);
  let gg = mixv(100, 124, dry);
  let b = mixv(42, 64, dry);
  // forest canopy (dark green), jungle (deep blue-green)
  const fo = Math.min(1, forest * 1.15);
  r = mixv(r, 30, fo);
  gg = mixv(gg, 56, fo);
  b = mixv(b, 30, fo);
  r = mixv(r, 26, jungle * 0.8);
  gg = mixv(gg, 70, jungle * 0.8);
  b = mixv(b, 40, jungle * 0.8);
  // bare dirt / pads, red canyon soil, sand (red in the canyon)
  r = mixv(r, 132, dirt * 0.8);
  gg = mixv(gg, 116, dirt * 0.8);
  b = mixv(b, 92, dirt * 0.8);
  r = mixv(r, 168, canyon * 0.92);
  gg = mixv(gg, 86, canyon * 0.92);
  b = mixv(b, 50, canyon * 0.92);
  r = mixv(r, mixv(214, 182, canyon), sand);
  gg = mixv(gg, mixv(194, 104, canyon), sand);
  b = mixv(b, mixv(146, 62, canyon), sand);
  // rock on cliffs / steep slopes / outcrops, snow on the high peaks
  const rk = Math.max(rock, Math.min(1, Math.max(0, (slope - 0.32) * 4)) * (1 - grass * 0.5));
  r = mixv(r, mixv(118, 128, canyon), rk);
  gg = mixv(gg, mixv(112, 66, canyon), rk);
  b = mixv(b, mixv(104, 44, canyon), rk);
  const snow = Math.min(1, Math.max(0, (h - 300) / 60)) * (1 - Math.min(1, Math.max(0, (slope - 0.45) * 4)));
  r = mixv(r, 236, snow);
  gg = mixv(gg, 236, snow);
  b = mixv(b, 242, snow);
  out[0] = r;
  out[1] = gg;
  out[2] = b;
}

const mixv = (a, b, t) => a + (b - a) * t;
/** Blobby value noise on ~5 m cells (tree crowns), 0..1. */
function crown(gi, gj) {
  const ci = gi >> 1;
  const cj = gj >> 1;
  let h = Math.imul(ci, 374761393) ^ Math.imul(cj, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
function norm3(x, y, z) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
