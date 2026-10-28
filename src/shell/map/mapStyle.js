/**
 * Shared map art style — pure JS, no DOM. Used by the hub map bake (mapBake.js, shell map worker) AND by
 * the procedural planet's map tiles (src/frontier/mapTile.js, frontier worker), so the hub map and the
 * infinite world around it read as ONE map: same palette, light (golden hour from the north-north-east,
 * 30° high), hill shading, water, beaches, canopies and colour grade.
 *
 * Everything that varies over the ground is defined in WORLD space (macro / ripple noise, hashes per
 * metre cell), so it continues across the hub border instead of restarting per image or per tile.
 */

// ------------------------------------------------------------- palette (sRGB)
export const GRASS_LUSH = [72, 100, 38];
export const GRASS_DRY = [146, 130, 70];
export const GRASS_JUNGLE = [40, 96, 50];
export const FOREST_FLOOR = [52, 50, 30];
export const DIRT = [112, 88, 60];
export const GRAVEL = [128, 116, 100];
export const SAND = [204, 180, 136];
export const RED_SAND = [184, 118, 76];
export const RED_SAND_DARK = [142, 82, 54];
export const ROCK = [110, 104, 98];
export const ROCK_DARK = [64, 59, 54];
export const RED_ROCK = [150, 82, 50];
export const RED_ROCK_LIGHT = [200, 148, 104];
export const SNOW = [238, 236, 242];
export const LAKE_BED = [92, 84, 60];
export const PAVED = [62, 64, 70];

export const WATER_SHALLOW = [70, 150, 146];
export const WATER_MID = [30, 96, 114];
export const WATER_DEEP = [12, 44, 72];
export const FOAM = [218, 232, 226];
export const SHEEN = [255, 196, 128];

/** Canopy colours per tree kind: [dark, lit]. Kind ids: see TREE_KINDS. */
export const CANOPY = [
  [[22, 44, 28], [64, 100, 54]], // 0 pine / spruce
  [[30, 62, 28], [100, 136, 58]], // 1 broadleaf (oak)
  [[60, 88, 40], [150, 168, 84]], // 2 birch
  [[70, 80, 38], [150, 148, 74]], // 3 acacia
  [[16, 52, 38], [50, 108, 70]], // 4 jungle
  [[48, 84, 36], [116, 152, 66]], // 5 palm
  [[36, 58, 28], [88, 116, 54]], // 6 bush
];
export const TREE_KINDS = { pine: 0, broadleaf: 1, birch: 2, acacia: 3, jungle: 4, palm: 5, bush: 6 };

/** Golden-hour light from the north-north-east, 30° high (unit vector toward the light; x east, z south). */
export const MAP_LIGHT = (() => {
  const az = (28 * Math.PI) / 180; // compass bearing, east of north
  const el = (30 * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
})();

export const NOISE_SEED = 0x5e11;
/** World-space frequencies of the macro (colour variation) and ripple (water) noise — the hub bake's
 * original 256-cell grid over ±1200 m, expressed per metre so every map tile samples the same field. */
const NOISE_ORIGIN = 1200;
const MACRO_K = (0.045 * 255) / 2400;
const RIPPLE_K = (0.16 * 255) / 2400;

export const smooth = (e0, e1, x) => {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

/** Seeded value noise in [0, 1] with fbm (no allocations per call). */
export function makeNoise(seed = NOISE_SEED) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const P = new Uint16Array(512);
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const V = new Float32Array(256);
  for (let i = 0; i < 256; i++) V[i] = rnd();
  function n2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const X = xi & 255;
    const Y = yi & 255;
    const a = V[P[P[X] + Y]];
    const b = V[P[P[X + 1] + Y]];
    const c = V[P[P[X] + Y + 1]];
    const d = V[P[P[X + 1] + Y + 1]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct = 4) {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * n2(x * f + o * 17.3, y * f - o * 9.1);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }
  return {
    n2,
    fbm,
    /** Low-frequency colour variation at world (x, z), [0, 1]. */
    macro: (x, z) => fbm((x + NOISE_ORIGIN) * MACRO_K, (z + NOISE_ORIGIN) * MACRO_K, 4),
    /** Water ripple field at world (x, z), [0, 1]. */
    ripple: (x, z) => fbm((x + NOISE_ORIGIN) * RIPPLE_K + 40, (z + NOISE_ORIGIN) * RIPPLE_K - 12, 3),
  };
}

/** Integer hash → [0, 1). */
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const mixInto = (col, c, k) => {
  col[0] += (c[0] - col[0]) * k;
  col[1] += (c[1] - col[1]) * k;
  col[2] += (c[2] - col[2]) * k;
};

/**
 * Water colour into col: depth tint, lake bed in the shallows, a warm sheen (0..1, broken by ripples —
 * the caller decides how much), cast shadow (lit 0..1) and shore foam (foamRnd 0..1 per pixel).
 */
export function shadeWater(col, depth, sheen, lit, foamRnd) {
  col[0] = WATER_SHALLOW[0];
  col[1] = WATER_SHALLOW[1];
  col[2] = WATER_SHALLOW[2];
  mixInto(col, WATER_MID, smooth(0.6, 5, depth));
  mixInto(col, WATER_DEEP, smooth(4, 24, depth));
  mixInto(col, LAKE_BED, (1 - smooth(0, 1.8, depth)) * 0.55);
  mixInto(col, SHEEN, sheen * 0.34);
  const sh = 0.62 + 0.38 * lit;
  col[0] *= sh;
  col[1] *= sh;
  col[2] *= sh * 0.98 + 0.02;
  const foam = (1 - smooth(0.04, 0.55, depth)) * (0.55 + 0.45 * foamRnd);
  mixInto(col, FOAM, foam * 0.5);
}

/** Seamless water sheen (the same everywhere on the planet): ripples, faded in over the first metres of depth. */
export const seamlessSheen = (rip, depth) => 0.3 * (0.55 + 0.45 * smooth(0.35, 0.7, rip)) * smooth(1, 6, depth);

/**
 * Ground colour into col (before light). p: { h, slope, moist, mac, sand, canyon, jungle, pad, rockO, ffloor,
 * snow (−1 = derive from height like the hub), dry (extra dryness, e.g. golden meadows), fine (0.9..1.1 grain),
 * rockV (0..1 rock grain), strata (0..1 sandstone band contrast, default 1) }.
 */
export function shadeLand(col, p) {
  const { h, slope, mac, canyon } = p;
  let dry = 0.66 - p.moist * 0.8 + (mac - 0.5) * 1.1 + (h - 35) * 0.004 + (p.dry || 0);
  dry = dry < 0 ? 0 : dry > 1 ? 1 : dry;
  col[0] = GRASS_LUSH[0];
  col[1] = GRASS_LUSH[1];
  col[2] = GRASS_LUSH[2];
  mixInto(col, GRASS_DRY, dry * 0.85);
  mixInto(col, GRASS_JUNGLE, p.jungle);
  col[0] *= p.fine;
  col[1] *= p.fine;
  col[2] *= p.fine;
  mixInto(col, FOREST_FLOOR, p.ffloor * 0.7);
  const pad = p.pad;
  if (pad > 0.01) {
    const dc = DIRT[0] + (GRAVEL[0] - DIRT[0]) * pad * 0.6;
    const dg = DIRT[1] + (GRAVEL[1] - DIRT[1]) * pad * 0.6;
    const db = DIRT[2] + (GRAVEL[2] - DIRT[2]) * pad * 0.6;
    col[0] += (dc - col[0]) * pad;
    col[1] += (dg - col[1]) * pad;
    col[2] += (db - col[2]) * pad;
  }
  if (canyon > 0.01) {
    const r = RED_SAND[0] + (RED_SAND_DARK[0] - RED_SAND[0]) * mac;
    const g = RED_SAND[1] + (RED_SAND_DARK[1] - RED_SAND[1]) * mac;
    const b = RED_SAND[2] + (RED_SAND_DARK[2] - RED_SAND[2]) * mac;
    const kk = canyon * 0.92;
    col[0] += (r - col[0]) * kk;
    col[1] += (g - col[1]) * kk;
    col[2] += (b - col[2]) * kk;
  }
  const sand = p.sand;
  if (sand > 0.01) {
    const r = SAND[0] + (RED_SAND[0] - SAND[0]) * canyon;
    const g = SAND[1] + (RED_SAND[1] - SAND[1]) * canyon;
    const b = SAND[2] + (RED_SAND[2] - SAND[2]) * canyon;
    col[0] += (r - col[0]) * sand;
    col[1] += (g - col[1]) * sand;
    col[2] += (b - col[2]) * sand;
  }
  let rockW = smooth(0.3, 0.5, slope + (mac - 0.5) * 0.2);
  if (p.rockO > rockW) rockW = p.rockO;
  if (rockW > 0.01) {
    const v = smooth(0.3, 0.72, p.rockV * 0.5 + mac * 0.5);
    let r = ROCK_DARK[0] + (ROCK[0] - ROCK_DARK[0]) * v;
    let g = ROCK_DARK[1] + (ROCK[1] - ROCK_DARK[1]) * v;
    let b = ROCK_DARK[2] + (ROCK[2] - ROCK_DARK[2]) * v;
    if (canyon > 0.01) {
      // sandstone strata (p.strata < 1 fades them where they would alias: steep ground on coarse pixels)
      const band = 0.5 + 0.5 * Math.sin(h * 1.3 + mac * 3) * (p.strata ?? 1);
      r += (RED_ROCK[0] + (RED_ROCK_LIGHT[0] - RED_ROCK[0]) * band - r) * canyon;
      g += (RED_ROCK[1] + (RED_ROCK_LIGHT[1] - RED_ROCK[1]) * band - g) * canyon;
      b += (RED_ROCK[2] + (RED_ROCK_LIGHT[2] - RED_ROCK[2]) * band - b) * canyon;
    }
    col[0] += (r - col[0]) * rockW;
    col[1] += (g - col[1]) * rockW;
    col[2] += (b - col[2]) * rockW;
  }
  const snow = p.snow >= 0 ? p.snow : smooth(305, 360, h + mac * 50) * (1 - smooth(0.42, 0.68, slope));
  if (snow > 0) mixInto(col, SNOW, snow);
}

/** Warm sun with soft shadows (lit 0..1), cool sky ambient and cavity AO (cav −1..1) on a land colour. */
export function lightLand(col, nx, ny, nz, lit, cav, wet, L = MAP_LIGHT) {
  const wd = 1 - 0.38 * wet;
  let ndl = nx * L[0] + ny * L[1] + nz * L[2];
  if (ndl < 0) ndl = 0;
  const sun = ndl * lit * 1.18;
  const sky = 0.5 + 0.28 * ny;
  let ao = 1 - cav * 0.45;
  ao = ao < 0.55 ? 0.55 : ao > 1.18 ? 1.18 : ao;
  col[0] *= (sky * 0.86 + sun * 1.0) * ao * wd;
  col[1] *= (sky * 0.92 + sun * 0.84) * ao * wd;
  col[2] *= (sky * 1.12 + sun * 0.64) * ao * wd;
}

/** Final grade (a little more saturation, gentle S-curve) of one RGBA pixel at o, in place. */
export function gradePixel(out, o) {
  let r = out[o];
  let g = out[o + 1];
  let b = out[o + 2];
  const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const lc = l / 255;
  const curve = (lc * lc * (3 - 2 * lc) * 0.45 + lc * 0.55) / Math.max(1e-3, lc);
  r = (l + (r - l) * 1.04) * curve;
  g = (l + (g - l) * 1.04) * curve;
  b = (l + (b - l) * 1.04) * curve;
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
}

/** Multiplies a soft disc into the pixels (k = darkening at the centre). Pixel space of a W × Hh image. */
export function stampShadow(out, W, Hh, cx, cz, r, k) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + r + 1));
  const z0 = Math.max(0, Math.floor(cz - r - 1));
  const z1 = Math.min(Hh - 1, Math.ceil(cz + r + 1));
  const r2 = (r + 0.5) * (r + 0.5);
  for (let py = z0; py <= z1; py++) {
    const dz = py + 0.5 - cz;
    for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - cx;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const e = 1 - Math.sqrt(d2) / (r + 0.5);
      const m = 1 - k * Math.min(1, e * 2.2);
      const o = (py * W + px) * 4;
      out[o] *= m;
      out[o + 1] *= m;
      out[o + 2] *= m * 1.04;
    }
  }
}

/** A round canopy lit from (ldx, ldz): darker rim, bright cap toward the light. Pixel space of W × Hh. */
export function stampCanopy(out, W, Hh, cx, cz, r, pal, ldx, ldz, jitter, pointy) {
  const [dk, lt] = pal;
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + r + 1));
  const z0 = Math.max(0, Math.floor(cz - r - 1));
  const z1 = Math.min(Hh - 1, Math.ceil(cz + r + 1));
  const rr = r + 0.5;
  for (let py = z0; py <= z1; py++) {
    const dz = py + 0.5 - cz;
    for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > rr) continue;
      const nd = d / rr;
      const up = Math.sqrt(Math.max(0, 1 - nd * nd)) * pointy;
      const side = (dx * ldx + dz * ldz) / rr;
      let s = 0.32 + 0.55 * up + 0.5 * side;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      s *= jitter;
      const a = Math.min(1, (rr - d) * 1.6);
      const o = (py * W + px) * 4;
      out[o] += (dk[0] + (lt[0] - dk[0]) * s - out[o]) * a;
      out[o + 1] += (dk[1] + (lt[1] - dk[1]) * s - out[o + 1]) * a;
      out[o + 2] += (dk[2] + (lt[2] - dk[2]) * s - out[o + 2]) * a;
    }
  }
}

/** Hub map ↔ procedural map cross-fade band (metres inside the hub image's ±extent edge). */
export const HUB_FEATHER = 110;
