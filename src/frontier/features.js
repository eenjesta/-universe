import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rockGeometry } from '../world/terrain/rockgeo.js';
import { REGROW, GROW_PHASE, MUSHROOMS, PLANT_VARIANTS } from '../../shared/defs/tools.js';

/**
 * Gathering visuals of the frontier (per-instance world-feature state, PLATFORM.md §11 survival):
 * stumps of felled trees, rubble of broken rocks / crystal formations, berry crops on bushes,
 * mushroom clusters at the foot of forest / jungle trees, and the growth curves that bring
 * everything back. Geometry is unit-sized (front −Z, base y = 0) and RGBA vertex-coloured:
 * alpha marks emissive parts (glowing jungle mushrooms), like the frontier props.
 *
 * Decor kinds of the 'detail' worker (pack.js): 0 tree, 1 bush, 2 rock, 3 crystal, 4 mushroom,
 * 5 crop (berries on a bush; its state is the bush's), each with the feature index k (ids array):
 * id = `${KIND_PREFIX[kind]}:${cx}:${cz}:${k}`.
 */
export const KIND_PREFIX = ['t', 'b', 'r', 'c', 'm', 'b'];
export const PREFIX_SLOT = { t: 0, b: 1, r: 2, c: 3, m: 4 };
export const CROP_VARIANT = { 'berries-red': 0, 'berries-blue': 1 };

const avg = (r) => (r[0] + r[1]) / 2;
/** Seconds before regrowAt during which a harvested feature visibly grows back, per decor kind. */
export const GROW_SECONDS = {
  tree: GROW_PHASE.tree * avg(REGROW.tree),
  rock: GROW_PHASE.rock * avg(REGROW.rock),
  pebble: GROW_PHASE.pebble * avg(REGROW.pebble),
  crystal: GROW_PHASE.crystal * avg(REGROW.crystal),
  plant: GROW_PHASE.plant * avg(PLANT_VARIANTS.fern.regrow),
  crop: GROW_PHASE.plant * avg(PLANT_VARIANTS.bushGreen.regrow),
  mushroom: GROW_PHASE.mushroom * avg(MUSHROOMS.regrow),
};

export const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

/** Small deterministic RNG. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function colorize(g, rgb, a = 0, fn = null) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 4);
  const p = g.attributes.position;
  for (let i = 0; i < n; i++) {
    const k = fn ? fn(p.getX(i), p.getY(i), p.getZ(i)) : 1;
    c[i * 4] = rgb[0] * k;
    c[i * 4 + 1] = rgb[1] * k;
    c[i * 4 + 2] = rgb[2] * k;
    c[i * 4 + 3] = a;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 4));
  if (g.index) g = g.toNonIndexed();
  return g;
}

function clean(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}

/**
 * Tree stump for a unit trunk radius: bark sides, a pale cut face with growth rings, a few
 * splinters; height 1.5 (× radius). Origin at the ground centre.
 */
export function stumpGeometry() {
  const R = rng(17);
  const parts = [];
  const side = new THREE.CylinderGeometry(1.0, 1.18, 1.5, 12, 2, true);
  side.translate(0, 0.62, 0);
  // jitter the rim a little (no perfect cylinder)
  const p = side.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const j = 1 + 0.06 * Math.sin(a * 5 + 1.3) + 0.04 * Math.sin(a * 9);
    p.setX(i, p.getX(i) * j);
    p.setZ(i, p.getZ(i) * j);
  }
  side.computeVertexNormals();
  parts.push(colorize(clean(side), [0.33, 0.24, 0.17], 0, (x, y) => 0.75 + 0.25 * Math.min(1, y / 1.3)));
  // cut face (tilted slightly — an axe cut): rings in the vertex colours
  const top = new THREE.CircleGeometry(1.02, 24, 0, Math.PI * 2);
  top.rotateX(-Math.PI / 2);
  top.rotateZ(0.12);
  top.translate(0, 1.37, 0);
  parts.push(
    colorize(clean(top), [0.86, 0.68, 0.46], 0, (x, y, z) => {
      const r = Math.hypot(x, z);
      return r > 0.9 ? 0.55 : 0.86 + 0.14 * Math.cos(r * 24);
    }),
  );
  // splinters on the high side of the cut
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + R() * 1.8;
    const s = new THREE.ConeGeometry(0.12 + R() * 0.1, 0.35 + R() * 0.4, 4);
    s.translate(Math.cos(a) * 0.75, 1.48 + R() * 0.1, Math.sin(a) * 0.75);
    parts.push(colorize(clean(s), [0.8, 0.62, 0.4], 0));
  }
  const g = mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)));
  g.computeBoundingSphere();
  return g;
}

/** Rubble pile of a broken rock (≈ unit radius, 0.45 high): a few broken stones, fresh pale faces. */
export function rubbleGeometry(seed = 3) {
  const R = rng(seed);
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const a = R() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.35 + R() * 0.6;
    const s = 0.22 + R() * 0.28;
    const g = rockGeometry(`rubble-${seed}-${i}`, { size: [s, s * 0.7, s * 0.9], detail: 1, cuts: 3, bump: 0.25 });
    g.translate(Math.cos(a) * r, s * 0.25, Math.sin(a) * r);
    g.rotateY(R() * 6.28);
    parts.push(colorize(clean(g), [1, 1, 1], 0, (x, y) => 0.8 + 0.35 * Math.min(1, Math.max(0, y / 0.4))));
  }
  const g = mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)));
  g.computeBoundingSphere();
  return g;
}

/**
 * Berry crop for a bush of radius `r` (the plant library's bushGreen r 1.3, bushJuniper r 1.0):
 * small glossy berries in clusters on the upper shell of the dome.
 */
export function cropGeometry(r = 1.3, color = [0.78, 0.07, 0.12], seed = 5, n = 26) {
  const R = rng(seed);
  const parts = [];
  const cy = r * 0.62;
  for (let c = 0; c < n; c++) {
    // cluster centre on the shell (upper 70 %)
    const th = R() * Math.PI * 2;
    const el = 0.15 + R() * 1.0;
    const rr = r * (0.78 + R() * 0.12);
    const cx = Math.cos(th) * Math.cos(el) * rr;
    const cz = Math.sin(th) * Math.cos(el) * rr;
    const yy = cy + Math.sin(el) * rr * 0.8;
    const k = 2 + Math.floor(R() * 3);
    for (let i = 0; i < k; i++) {
      const s = 0.045 + R() * 0.03;
      const b = new THREE.IcosahedronGeometry(s, 0);
      b.translate(cx + (R() - 0.5) * 0.12, yy + (R() - 0.5) * 0.1, cz + (R() - 0.5) * 0.12);
      const v = 0.75 + R() * 0.4;
      parts.push(colorize(clean(b), [color[0] * v, color[1] * v, color[2] * v], 0.35));
    }
  }
  const g = mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)));
  g.computeBoundingSphere();
  return g;
}

/** Mushroom cluster (3–5 mushrooms, ≈ 0.5 m across); glow = bioluminescent jungle caps. */
export function mushroomGeometry(glow = false, seed = 11) {
  const R = rng(seed + (glow ? 5 : 0));
  const parts = [];
  const n = 4 + (glow ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.12 + R() * 0.2;
    const h = (i === 0 ? 0.26 : 0.12 + R() * 0.14) * (glow ? 1.25 : 1);
    const capR = (i === 0 ? 0.13 : 0.06 + R() * 0.06) * (glow ? 1.1 : 1);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const lean = (R() - 0.5) * 0.4;
    const stem = new THREE.CylinderGeometry(capR * 0.28, capR * 0.36, h, 6);
    stem.translate(0, h / 2, 0);
    stem.rotateZ(lean);
    stem.translate(x, 0, z);
    parts.push(colorize(clean(stem), glow ? [0.62, 0.78, 0.86] : [0.9, 0.85, 0.74], glow ? 0.25 : 0));
    const cap = new THREE.SphereGeometry(capR, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
    cap.scale(1, glow ? 0.75 : 0.62, 1);
    cap.translate(0, h - capR * 0.08, 0);
    cap.rotateZ(lean);
    cap.translate(x, 0, z);
    const capC = glow ? [0.25, 0.85, 1.0] : i % 2 ? [0.72, 0.36, 0.16] : [0.62, 0.42, 0.24];
    parts.push(colorize(clean(cap), capC, glow ? 1.6 : 0, (px, py) => 0.75 + 0.35 * Math.min(1, Math.max(0, (py - h * 0.8) / (capR * 0.6)))));
  }
  const g = mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)));
  g.computeBoundingSphere();
  return g;
}

/**
 * A variant of the (shared) vegetation material that screen-door fades FOLIAGE close to the
 * camera: fragments nearer than fade.x m are gone, beyond fade.y m untouched, dithered between
 * (interleaved gradient noise — stable per pixel, no sorting, no transparency pass). Trunks stay
 * solid: only vertices with a wind weight > 0.1 (branches, needles, leaves — the plant library
 * gives the lower trunk ≈ 0) fade, so the tree you chop never turns see-through. Keeps the base
 * material's hooks (wind, sun visibility, translucency): its onBeforeCompile runs first and the
 * uniforms stay shared. setFade(near, far) per view (3P: the camera sits behind the woodcutter,
 * inside low canopies; FP: the eye). emissiveIntensity must be mirrored from the base each frame.
 */
export function createNearFadeMaterial(base, { near = 0.9, far = 2.6 } = {}) {
  const m = base.clone();
  m.name = `${base.name || 'vegetation'}-nearfade`;
  const uFade = { value: new THREE.Vector2(near, far) };
  m.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile?.call(base, shader, renderer);
    shader.uniforms.uGthFade = uFade;
    if (shader.vertexShader.includes('attribute float wind;')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vGthWind;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGthWind = wind;');
    } else {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vGthWind;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGthWind = 1.0;');
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec2 uGthFade;\nvarying float vGthWind;').replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      {
        float gthD = length(vViewPosition);
        if (gthD < uGthFade.y && vGthWind > 0.1) {
          float gthK = clamp((gthD - uGthFade.x) / max(uGthFade.y - uGthFade.x, 0.001), 0.0, 1.0);
          gthK = max(gthK, 1.0 - smoothstep(0.1, 0.3, vGthWind)); // branch roots fade less
          float gthN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (gthK < 0.999 && gthN > gthK) discard;
        }
      }`,
    );
  };
  const baseKey = () => (typeof base.customProgramCacheKey === 'function' ? base.customProgramCacheKey() : '');
  m.customProgramCacheKey = () => `${baseKey()}|gth-nearfade2`;
  m.userData.uFade = uFade;
  m.userData.setFade = (n, f) => uFade.value.set(n, f);
  return m;
}

/**
 * MeshStandardMaterial with RGBA vertex colours where alpha = emissive weight (like the
 * frontier props); `glow` = HDR boost of that emission (bloom), finite, night-scaled by uGlow.
 */
export function createGatherMaterial(name, { roughness = 0.8, metalness = 0, glow = 1.2 } = {}) {
  const uGlow = { value: glow };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
  m.name = name;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGatherGlow = uGlow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGatherGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#if defined( USE_COLOR_ALPHA )
      totalEmissiveRadiance += vColor.rgb * clamp(vColor.a, 0.0, 4.0) * uGatherGlow;
#endif`,
      );
  };
  m.customProgramCacheKey = () => `gather-mat-${name}`;
  m.userData.uGlow = uGlow;
  return m;
}
