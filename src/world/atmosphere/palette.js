import * as THREE from 'three';
import { clamp } from '../../core/math.js';

/**
 * Time-of-day palette, keyed by sun elevation (degrees) so dusk and dawn
 * share a look. Sky colours are authored as the *displayed* sRGB colour we
 * want on screen (sampled from the poster / concept art: crop_hero for the
 * 17.6 golden hour, 12_lookout / 16_vtol for the late afternoon) and
 * converted to scene-linear HDR by inverting the ACES curve at that key's
 * exposure, so tuning reads directly against the reference images. Light
 * colours are plain colour + intensity.
 *
 * evaluatePalette(elevationDeg, out) interpolates every field without allocating.
 */

const _c = new THREE.Color();

/** Inverse of three's ACES RRT/ODT fit (per channel approximation). */
function invRRT(y) {
  y = Math.min(y, 0.995);
  const A = 1 - 0.983729 * y;
  const B = 0.0245786 - 0.432951 * y;
  const C = -(0.000090537 + 0.238081 * y);
  return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
}

/**
 * Display sRGB hex → scene-linear colour (before ACES at `exposure`), times
 * `gain`. Display values are capped at 0.78 (linear) first: the ACES curve
 * flattens toward 1, so inverting saturated channels would explode into
 * HDR glare — real brightness near the sun comes from the explicit glow terms.
 */
function display(hex, exposure, gain = 1) {
  _c.set(hex); // → linear working space
  const k = 0.6 / exposure;
  const cap = (v) => invRRT(Math.min(v, 0.78)) * k * gain;
  return new THREE.Color(cap(_c.r), cap(_c.g), cap(_c.b));
}

/** Light colour × intensity (linear). */
function light(hex, intensity = 1) {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Raw keys. Fields:
 *  sky: zenith, mid, horizon (away from the sun = fog colour), horizonSun (warm
 *       band toward the sun's azimuth = fog in-scatter colour), ground
 *       (below-horizon haze) — display colours; glow (HDR glow around the
 *       sun), disc (HDR sun disc); sunExp (azimuth exponent of the warm band),
 *       hazeFall (its vertical falloff, sin elevation); sunSide (mid-sky
 *       brightening toward the sun), midH (horizon → mid height), zenH
 *  light: sun (directional colour×intensity), hemiSky, hemiGround, hemi, planetKey
 *  fog: fogDensity (exp²), heightFog (density at y=0), fogHeight (scale m), fogGlow
 *  clouds: cloudLit, cloudShade (HDR), cloudCover, cloudOpacity; horizon banks:
 *          bandLit, bandShade (HDR), bandCover, bandHeight (sin el), bandOpacity
 *  stars (0..1), env (environmentIntensity)
 *  post: exposure, bloom, bloomRadius, threshold, saturation, contrast,
 *        vignette, shadowTint, highlightTint
 *  bodies: planetLight (HDR light on the planet), planetDark (worldshine), rim
 */
const RAW = [
  {
    // deep night: deep blue sky, the giant planet is the key light
    el: -90,
    exposure: 1.8,
    zenith: '#050b1c', mid: '#0b1736', horizon: '#18284e', horizonSun: '#1a2a52', ground: '#0c1530',
    glow: ['#000000', 0], disc: ['#000000', 0], sunExp: 3, hazeFall: 0.12, sunSide: 0.1, midH: 0.45, zenH: 0.3,
    sun: ['#000000', 0], hemiSky: ['#5470b8', 1], hemiGround: ['#1c2434', 1], hemi: 1.45, planetKey: ['#b4c4ff', 0.85],
    fogDensity: 0.0002, heightFog: 0.0006, fogHeight: 55, fogGlow: 0,
    cloudLit: ['#46598e', 0.34], cloudShade: ['#0c1428', 0.25], cloudCover: 0.42, cloudOpacity: 0.75,
    bandLit: ['#3a4a7a', 0.3], bandShade: ['#0e1630', 0.28], bandCover: 0.5, bandHeight: 0.05, bandOpacity: 0.85,
    stars: 1, env: 2.1,
    bloom: 0.55, bloomRadius: 0.5, threshold: 0.9, saturation: 0.98, contrast: 1.05, vignette: 0.38,
    shadowTint: v3(0.84, 0.92, 1.24), highlightTint: v3(0.97, 1.0, 1.06),
    planetLight: ['#e8eeff', 0.5], planetDark: ['#1a2440', 0.05], rim: ['#86a6ff', 0.32],
  },
  {
    el: -15,
    exposure: 1.76,
    zenith: '#060c20', mid: '#0e1a3e', horizon: '#1e2c58', horizonSun: '#26305e', ground: '#0f1834',
    glow: ['#2a2c55', 0.05], disc: ['#000000', 0], sunExp: 3, hazeFall: 0.12, sunSide: 0.15, midH: 0.45, zenH: 0.3,
    sun: ['#000000', 0], hemiSky: ['#5470b8', 1], hemiGround: ['#1c2434', 1], hemi: 1.45, planetKey: ['#b4c4ff', 0.85],
    fogDensity: 0.0002, heightFog: 0.0006, fogHeight: 55, fogGlow: 0.2,
    cloudLit: ['#46598e', 0.34], cloudShade: ['#0c1428', 0.25], cloudCover: 0.42, cloudOpacity: 0.75,
    bandLit: ['#3a4a7a', 0.3], bandShade: ['#0e1630', 0.28], bandCover: 0.5, bandHeight: 0.05, bandOpacity: 0.85,
    stars: 1, env: 2.1,
    bloom: 0.55, bloomRadius: 0.5, threshold: 0.9, saturation: 0.98, contrast: 1.05, vignette: 0.38,
    shadowTint: v3(0.84, 0.92, 1.24), highlightTint: v3(0.97, 1.0, 1.06),
    planetLight: ['#e8eeff', 0.5], planetDark: ['#1a2440', 0.05], rim: ['#86a6ff', 0.32],
  },
  {
    // blue hour
    el: -8,
    exposure: 1.55,
    zenith: '#0a142e', mid: '#1c2a56', horizon: '#3a4270', horizonSun: '#6a4e6e', ground: '#20223e',
    glow: ['#80506a', 0.2], disc: ['#000000', 0], sunExp: 3, hazeFall: 0.1, sunSide: 0.3, midH: 0.45, zenH: 0.3,
    sun: ['#000000', 0], hemiSky: ['#5a6cb4', 1], hemiGround: ['#201e2a', 1], hemi: 1.3, planetKey: ['#c4d0ff', 0.8],
    fogDensity: 0.00021, heightFog: 0.0007, fogHeight: 55, fogGlow: 0.25,
    cloudLit: ['#7a5a8a', 0.5], cloudShade: ['#161c3a', 0.35], cloudCover: 0.45, cloudOpacity: 0.8,
    bandLit: ['#6a4e78', 0.45], bandShade: ['#141a36', 0.35], bandCover: 0.52, bandHeight: 0.055, bandOpacity: 0.9,
    stars: 0.78, env: 1.8,
    bloom: 0.6, bloomRadius: 0.5, threshold: 0.88, saturation: 1.02, contrast: 1.06, vignette: 0.37,
    shadowTint: v3(0.84, 0.91, 1.2), highlightTint: v3(1.0, 0.98, 1.03),
    planetLight: ['#eef0ff', 0.55], planetDark: ['#1a2440', 0.04], rim: ['#9aaeff', 0.34],
  },
  {
    // dusk, sun just under the horizon: afterglow
    el: -2.5,
    exposure: 1.3,
    zenith: '#0b1428', mid: '#1e2a4c', horizon: '#4c4866', horizonSun: '#e88a60', ground: '#3a3044',
    glow: ['#ff6a30', 0.55], disc: ['#000000', 0], sunExp: 4, hazeFall: 0.08, sunSide: 0.5, midH: 0.48, zenH: 0.3,
    sun: ['#ff6a30', 0.2], hemiSky: ['#6670b8', 1], hemiGround: ['#30242a', 1], hemi: 0.8, planetKey: ['#c4d0ff', 0.35],
    fogDensity: 0.00022, heightFog: 0.00075, fogHeight: 58, fogGlow: 0.35,
    cloudLit: ['#ff7a50', 1.0], cloudShade: ['#2c2a52', 0.42], cloudCover: 0.46, cloudOpacity: 0.85,
    bandLit: ['#f07a58', 0.85], bandShade: ['#2a2446', 0.4], bandCover: 0.55, bandHeight: 0.06, bandOpacity: 0.92,
    stars: 0.42, env: 1.25,
    bloom: 0.75, bloomRadius: 0.55, threshold: 0.86, saturation: 1.1, contrast: 1.08, vignette: 0.36,
    shadowTint: v3(0.84, 0.9, 1.16), highlightTint: v3(1.07, 0.98, 0.9),
    planetLight: ['#fff0ea', 0.75], planetDark: ['#1c2242', 0.03], rim: ['#a6b4ff', 0.34],
  },
  {
    // sunset
    el: 1.5,
    exposure: 1.0,
    zenith: '#0c1424', mid: '#28324c', horizon: '#6a5e70', horizonSun: '#ec915e', ground: '#4c3c46',
    glow: ['#ff8a46', 1.5], disc: ['#ffc890', 24], sunExp: 4.5, hazeFall: 0.075, sunSide: 0.6, midH: 0.5, zenH: 0.3,
    sun: ['#ff9450', 2.3], hemiSky: ['#7076c0', 1], hemiGround: ['#3e2c22', 1], hemi: 0.55, planetKey: ['#c4d0ff', 0],
    fogDensity: 0.00021, heightFog: 0.0005, fogHeight: 60, fogGlow: 0.24,
    cloudLit: ['#ff9058', 1.7], cloudShade: ['#3a3460', 0.45], cloudCover: 0.46, cloudOpacity: 0.9,
    bandLit: ['#ffa070', 1.4], bandShade: ['#3c3256', 0.42], bandCover: 0.56, bandHeight: 0.075, bandOpacity: 0.95,
    stars: 0.2, env: 0.95,
    bloom: 0.34, bloomRadius: 0.3, threshold: 0.9, saturation: 1.12, contrast: 1.1, vignette: 0.36,
    shadowTint: v3(0.85, 0.92, 1.15), highlightTint: v3(1.09, 0.98, 0.87),
    planetLight: ['#fff2e6', 0.66], planetDark: ['#1e2444', 0.03], rim: ['#b0bcff', 0.3],
  },
  {
    // golden hour — the poster (default 17.6 ≈ 5.3°)
    el: 5.5,
    exposure: 0.97,
    zenith: '#0e1628', mid: '#2c3852', horizon: '#76768a', horizonSun: '#eaa874', ground: '#4e4650',
    glow: ['#ffa462', 1.35], disc: ['#fff0d0', 30], sunExp: 5, hazeFall: 0.085, sunSide: 0.65, midH: 0.5, zenH: 0.3,
    sun: ['#ffbb78', 3.0], hemiSky: ['#8088c4', 1], hemiGround: ['#4a3626', 1], hemi: 0.42, planetKey: ['#c4d0ff', 0],
    fogDensity: 0.0002, heightFog: 0.00045, fogHeight: 62, fogGlow: 0.22,
    cloudLit: ['#ffb070', 2.0], cloudShade: ['#4a4670', 0.5], cloudCover: 0.44, cloudOpacity: 0.9,
    bandLit: ['#ffbc88', 1.6], bandShade: ['#4c4466', 0.46], bandCover: 0.56, bandHeight: 0.08, bandOpacity: 0.95,
    stars: 0.12, env: 0.85,
    bloom: 0.3, bloomRadius: 0.26, threshold: 0.9, saturation: 1.12, contrast: 1.12, vignette: 0.36,
    shadowTint: v3(0.86, 0.93, 1.14), highlightTint: v3(1.09, 0.99, 0.87),
    planetLight: ['#fff4ea', 0.68], planetDark: ['#20284a', 0.025], rim: ['#b8c4ff', 0.3],
  },
  {
    // late afternoon (12_lookout / 16_vtol)
    el: 14,
    exposure: 1.0,
    zenith: '#1a2c5a', mid: '#3c5486', horizon: '#9a9cb0', horizonSun: '#efc496', ground: '#6a6672',
    glow: ['#ffc888', 0.95], disc: ['#fff6e2', 40], sunExp: 4, hazeFall: 0.12, sunSide: 0.5, midH: 0.5, zenH: 0.3,
    sun: ['#ffd29c', 3.4], hemiSky: ['#98aae0', 1], hemiGround: ['#55483a', 1], hemi: 0.5, planetKey: ['#c4d0ff', 0],
    fogDensity: 0.00019, heightFog: 0.00045, fogHeight: 65, fogGlow: 0.25,
    cloudLit: ['#ffe0b8', 2.4], cloudShade: ['#6c7098', 0.7], cloudCover: 0.4, cloudOpacity: 0.9,
    bandLit: ['#ffe4c4', 2.0], bandShade: ['#686c90', 0.66], bandCover: 0.52, bandHeight: 0.075, bandOpacity: 0.92,
    stars: 0, env: 1.0,
    bloom: 0.38, bloomRadius: 0.45, threshold: 0.9, saturation: 1.08, contrast: 1.06, vignette: 0.32,
    shadowTint: v3(0.9, 0.95, 1.1), highlightTint: v3(1.05, 1.0, 0.93),
    planetLight: ['#ffffff', 0.75], planetDark: ['#000000', 0], rim: ['#c4d0ff', 0.26],
  },
  {
    // day
    el: 32,
    exposure: 0.95,
    zenith: '#2052aa', mid: '#5482c8', horizon: '#b4c8e2', horizonSun: '#ece6d8', ground: '#8a94a2',
    glow: ['#fff0d8', 0.55], disc: ['#fffaf0', 50], sunExp: 3, hazeFall: 0.2, sunSide: 0.3, midH: 0.5, zenH: 0.3,
    sun: ['#fff0dc', 3.6], hemiSky: ['#a8c4ec', 1], hemiGround: ['#58503e', 1], hemi: 0.55, planetKey: ['#c4d0ff', 0],
    fogDensity: 0.00016, heightFog: 0.00045, fogHeight: 70, fogGlow: 0.3,
    cloudLit: ['#ffffff', 2.4], cloudShade: ['#8e9cb8', 0.9], cloudCover: 0.38, cloudOpacity: 0.88,
    bandLit: ['#ffffff', 2.2], bandShade: ['#8a98b8', 0.85], bandCover: 0.5, bandHeight: 0.07, bandOpacity: 0.9,
    stars: 0, env: 1.0,
    bloom: 0.32, bloomRadius: 0.45, threshold: 0.9, saturation: 1.06, contrast: 1.04, vignette: 0.28,
    shadowTint: v3(0.94, 0.98, 1.06), highlightTint: v3(1.03, 1.0, 0.96),
    planetLight: ['#ffffff', 0.85], planetDark: ['#000000', 0], rim: ['#d0dcff', 0.22],
  },
  {
    el: 90,
    exposure: 0.95,
    zenith: '#1e4ea6', mid: '#527ec4', horizon: '#b0c6e2', horizonSun: '#e8e6dc', ground: '#8a94a2',
    glow: ['#fff4e0', 0.5], disc: ['#ffffff', 52], sunExp: 3, hazeFall: 0.2, sunSide: 0.25, midH: 0.5, zenH: 0.3,
    sun: ['#fff4e4', 3.7], hemiSky: ['#a8c4ec', 1], hemiGround: ['#58503e', 1], hemi: 0.55, planetKey: ['#c4d0ff', 0],
    fogDensity: 0.00015, heightFog: 0.0004, fogHeight: 70, fogGlow: 0.3,
    cloudLit: ['#ffffff', 2.5], cloudShade: ['#94a2bc', 0.95], cloudCover: 0.38, cloudOpacity: 0.88,
    bandLit: ['#ffffff', 2.3], bandShade: ['#90a0bc', 0.9], bandCover: 0.5, bandHeight: 0.07, bandOpacity: 0.9,
    stars: 0, env: 1.0,
    bloom: 0.32, bloomRadius: 0.45, threshold: 0.9, saturation: 1.06, contrast: 1.04, vignette: 0.28,
    shadowTint: v3(0.94, 0.98, 1.06), highlightTint: v3(1.03, 1.0, 0.96),
    planetLight: ['#ffffff', 0.85], planetDark: ['#000000', 0], rim: ['#d0dcff', 0.22],
  },
];

const SKY_FIELDS = ['zenith', 'mid', 'horizon', 'horizonSun', 'ground'];
const HDR_FIELDS = ['glow', 'disc', 'cloudLit', 'cloudShade', 'bandLit', 'bandShade', 'planetLight', 'planetDark', 'rim', 'planetKey'];
const LIGHT_FIELDS = ['sun', 'hemiSky', 'hemiGround'];
const VEC_FIELDS = ['shadowTint', 'highlightTint'];
const NUM_FIELDS = [
  'exposure', 'sunExp', 'hazeFall', 'sunSide', 'midH', 'zenH', 'hemi', 'fogDensity', 'heightFog', 'fogHeight', 'fogGlow',
  'cloudCover', 'cloudOpacity', 'bandCover', 'bandHeight', 'bandOpacity',
  'stars', 'env', 'bloom', 'bloomRadius', 'threshold', 'saturation', 'contrast', 'vignette',
];
const COLOR_FIELDS = [...SKY_FIELDS, ...HDR_FIELDS, ...LIGHT_FIELDS];

/** Compiled keys (linear colours). */
export const KEYS = RAW.map((k) => {
  const o = { el: k.el };
  for (const f of SKY_FIELDS) o[f] = display(k[f], k.exposure);
  for (const f of HDR_FIELDS) o[f] = light(k[f][0], k[f][1]);
  for (const f of LIGHT_FIELDS) o[f] = light(k[f][0], k[f][1]);
  for (const f of VEC_FIELDS) o[f] = k[f].clone();
  for (const f of NUM_FIELDS) o[f] = k[f];
  return o;
});

/** Creates an output object with the same shape as a compiled key. */
export function createPaletteState() {
  const o = { el: 0 };
  for (const f of COLOR_FIELDS) o[f] = new THREE.Color();
  for (const f of VEC_FIELDS) o[f] = new THREE.Vector3();
  for (const f of NUM_FIELDS) o[f] = 0;
  return o;
}

/** Interpolates the palette at a sun elevation (degrees) into `out`. */
export function evaluatePalette(elDeg, out) {
  const e = clamp(elDeg, KEYS[0].el, KEYS[KEYS.length - 1].el);
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].el) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  let t = (e - a.el) / (b.el - a.el);
  t = t * t * (3 - 2 * t);
  out.el = elDeg;
  for (const f of COLOR_FIELDS) out[f].copy(a[f]).lerp(b[f], t);
  for (const f of VEC_FIELDS) out[f].copy(a[f]).lerp(b[f], t);
  for (const f of NUM_FIELDS) out[f] = a[f] + (b[f] - a[f]) * t;
  return out;
}
