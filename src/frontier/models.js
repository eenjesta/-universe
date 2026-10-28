import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rockGeometry, hoodooGeometry } from '../world/terrain/rockgeo.js';

/**
 * Procedural props for the frontier (front = −Z, metres, base at y = 0):
 * ancient Ø ruins, pirate outposts, crash sites (3 variants each), waystone
 * beacons, energy-crystal clusters, resource nodes and rocks.
 *
 * Every prop is merged geometry with RGBA vertex colours; alpha marks emissive
 * parts (glowing Ø glyphs, lamps, crystals), so one material per surface kind
 * ('stone' rough, 'metal' satin) draws everything. Glow is HDR (bloom picks it
 * up) and brightens at night through the shared `uGlow` uniform.
 * POI builders also return simple box colliders for the integrator (physics).
 */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

export function createPropMaterials() {
  const shared = { uGlow: { value: 1.6 }, uTime: { value: 0 } };
  const make = (name, roughness, metalness) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
    m.name = `frontier-${name}`;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;\nuniform float uTime;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
#if defined( USE_COLOR_ALPHA )
          totalEmissiveRadiance += vColor.rgb * vColor.a * uGlow * (0.85 + 0.15 * sin(uTime * 2.1 + vViewPosition.x * 0.3));
#endif`,
        );
    };
    m.customProgramCacheKey = () => `frontier-prop-${name}-v1`;
    return m;
  };
  return { stone: make('stone', 0.9, 0.0), metal: make('metal', 0.55, 0.55), shared };
}

// ------------------------------------------------------------------ geometry helpers
function prep(geo, color, glow = 0) {
  let g = geo.index ? geo : geo;
  g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 4);
  const pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    // gentle vertical gradient (darker at the base, like AO)
    const y = pos.getY(i);
    const ao = glow > 0 ? 1 : 0.72 + 0.28 * Math.min(1, Math.max(0, (y + 0.5) / 3));
    col[i * 4] = color[0] * ao;
    col[i * 4 + 1] = color[1] * ao;
    col[i * 4 + 2] = color[2] * ao;
    col[i * 4 + 3] = glow;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  if (!g.index) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g;
}

function place(g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

function merge(list) {
  if (!list.length) return null;
  const clean = list.map((g) => {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    return g.index ? g.toNonIndexed() : g;
  });
  for (const g of clean) g.setIndex(null);
  const out = mergeGeometries(clean, false);
  for (const g of clean) g.dispose();
  out.computeBoundingSphere();
  return out;
}

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STONE = [0.5, 0.48, 0.43]; // weathered, not bleached (bright daylight on 0.62 read as plaster)
const STONE_DARK = [0.32, 0.31, 0.29];
const MOSS = [0.34, 0.42, 0.22];
const GLYPH = [0.25, 0.95, 1.0];
const RUST = [0.45, 0.24, 0.14];
const STEEL = [0.32, 0.34, 0.36];
const DARK = [0.12, 0.13, 0.15];
const WOOD = [0.42, 0.29, 0.18];
const ORANGE = [1.0, 0.55, 0.18];
const RED = [0.55, 0.12, 0.1];

/** The Ø glyph: ring + diagonal bar (emissive). */
function glyph(list, x, y, z, r, ry = 0, rx = 0) {
  list.push(place(prep(new THREE.TorusGeometry(r, r * 0.11, 6, 28), GLYPH, 3.2), x, y, z, rx, ry, 0));
  list.push(place(prep(new THREE.BoxGeometry(r * 0.18, r * 2.5, r * 0.18), GLYPH, 3.2), x, y, z, rx, ry, -0.62));
}

// ------------------------------------------------------------------ POIs
function ruin(variant, seed) {
  const R = rng(seed);
  const stone = [];
  const glow = [];
  const colliders = [];
  const plat = 9 + variant * 2.5;
  stone.push(place(prep(new THREE.CylinderGeometry(plat, plat + 0.8, 1.0, 28), STONE), 0, 0.2, 0));
  stone.push(place(prep(new THREE.CylinderGeometry(plat * 0.55, plat * 0.6, 0.5, 24), STONE_DARK), 0, 0.9, 0));
  colliders.push({ x: 0, y: 0.45, z: 0, w: plat * 1.6, h: 0.9, d: plat * 1.6, rotY: 0 });
  // ring of pillars, some broken or toppled
  const n = 7 + variant;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.1;
    const r = plat - 1.4;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const state = R();
    if (state < 0.18) {
      // toppled drum lying on the ground
      stone.push(place(prep(new THREE.CylinderGeometry(0.85, 0.85, 5 + R() * 3, 10), STONE), x * 1.25, 0.9, z * 1.25, Math.PI / 2, a + 0.6, 0));
      continue;
    }
    const h = state < 0.5 ? 3 + R() * 3 : 8 + R() * 4;
    const tilt = (R() - 0.5) * 0.12;
    stone.push(place(prep(new THREE.CylinderGeometry(0.75, 0.95, h, 8), state < 0.5 ? STONE_DARK : STONE), x, 0.7 + h / 2, z, tilt, 0, tilt * 0.7));
    stone.push(place(prep(new THREE.BoxGeometry(2.0, 0.5, 2.0), STONE), x, 0.7 + h + 0.25, z, 0, a, 0));
    if (R() < 0.6) stone.push(place(prep(new THREE.SphereGeometry(1.0, 6, 4), MOSS), x, 0.7 + h * 0.15, z, 0, 0, 0, 1.1, 0.5, 1.1));
    colliders.push({ x, y: 0.7 + h / 2, z, w: 1.8, h, d: 1.8, rotY: 0 });
  }
  // gate arch facing −Z
  const gz = -plat - 2;
  stone.push(place(prep(new THREE.BoxGeometry(1.6, 9, 1.6), STONE), -3.4, 4.5, gz));
  stone.push(place(prep(new THREE.BoxGeometry(1.6, 9, 1.6), STONE), 3.4, 4.5, gz));
  stone.push(place(prep(new THREE.BoxGeometry(9.6, 1.4, 2.0), STONE_DARK), 0, 9.6, gz, 0, 0, variant === 1 ? 0.08 : 0));
  glyph(glow, 0, 9.6, gz - 1.05, 0.55);
  colliders.push({ x: -3.4, y: 4.5, z: gz, w: 1.6, h: 9, d: 1.6, rotY: 0 }, { x: 3.4, y: 4.5, z: gz, w: 1.6, h: 9, d: 1.6, rotY: 0 });
  // central monolith with the glowing Ø
  stone.push(place(prep(new THREE.BoxGeometry(2.6, 7.5, 0.9), DARK), 0, 1.2 + 3.75, 0, 0, variant * 0.7, 0));
  const gy = 1.2 + 5.2;
  const ry = variant * 0.7;
  glyph(glow, Math.sin(ry) * -0.5, gy, Math.cos(ry) * -0.5, 0.9, ry);
  glyph(glow, Math.sin(ry) * 0.5, gy, Math.cos(ry) * 0.5, 0.9, ry);
  // inlaid glowing ring on the floor
  glow.push(place(prep(new THREE.TorusGeometry(plat * 0.45, 0.07, 4, 48), GLYPH, 1.8), 0, 1.16, 0, Math.PI / 2, 0, 0));
  colliders.push({ x: 0, y: 4.95, z: 0, w: 2.6, h: 7.5, d: 1.0, rotY: ry });
  return { stone: merge(stone), metal: merge(glow), colliders, height: 13 };
}

function outpost(variant, seed) {
  const R = rng(seed);
  const metal = [];
  const lamps = [];
  const colliders = [];
  const huts = 2 + (variant % 2);
  for (let i = 0; i < huts; i++) {
    const a = (i / huts) * Math.PI * 2 + 0.5 + variant;
    const x = Math.sin(a) * 9;
    const z = Math.cos(a) * 9;
    const w = 5 + R() * 2;
    const d = 4 + R() * 1.5;
    const h = 3.2;
    const ry = a + Math.PI;
    metal.push(place(prep(new THREE.BoxGeometry(w, h, d), i % 2 ? RUST : STEEL), x, h / 2, z, 0, ry, 0));
    // sloped corrugated roof
    metal.push(place(prep(new THREE.BoxGeometry(w + 0.8, 0.25, d + 1.2), DARK), x, h + 0.35, z, 0.18, ry, 0));
    // door + window lamp
    lamps.push(place(prep(new THREE.BoxGeometry(1.0, 0.5, 0.1), ORANGE, 2.4), x + Math.sin(ry) * -(d / 2 + 0.06), 2.3, z + Math.cos(ry) * -(d / 2 + 0.06), 0, ry, 0));
    colliders.push({ x, y: h / 2, z, w, h, d, rotY: ry });
  }
  // watchtower
  const tx = variant === 2 ? -6 : 6;
  const tz = -6;
  const th = 10;
  for (const [ox, oz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) metal.push(place(prep(new THREE.BoxGeometry(0.3, th, 0.3), STEEL), tx + ox, th / 2, tz + oz, ox * 0.02, 0, oz * 0.02));
  metal.push(place(prep(new THREE.BoxGeometry(4, 0.3, 4), RUST), tx, th, tz));
  metal.push(place(prep(new THREE.BoxGeometry(4.2, 1.0, 0.12), STEEL), tx, th + 0.6, tz - 2));
  metal.push(place(prep(new THREE.BoxGeometry(4.2, 1.0, 0.12), STEEL), tx, th + 0.6, tz + 2));
  metal.push(place(prep(new THREE.ConeGeometry(3.2, 1.6, 4), DARK), tx, th + 2.8, tz, 0, Math.PI / 4, 0));
  lamps.push(place(prep(new THREE.SphereGeometry(0.35, 8, 6), ORANGE, 4.5), tx, th + 1.6, tz));
  colliders.push({ x: tx, y: th / 2, z: tz, w: 3, h: th, d: 3, rotY: 0 });
  // pirate banner
  metal.push(place(prep(new THREE.CylinderGeometry(0.08, 0.08, 7, 6), DARK), tx + 2.2, th + 3.5, tz));
  metal.push(place(prep(new THREE.BoxGeometry(1.8, 1.1, 0.04), RED), tx + 3.1, th + 6.2, tz, 0, 0, 0.05));
  // scrap palisade (broken ring of panels)
  const pr = 17 + variant * 2;
  for (let i = 0; i < 26; i++) {
    if (R() < 0.22 || (i > 11 && i < 14)) continue; // gaps + the gate on the −Z side
    const a = (i / 26) * Math.PI * 2;
    const x = Math.sin(a) * pr;
    const z = -Math.cos(a) * pr;
    const h = 2.4 + R() * 1.4;
    metal.push(place(prep(new THREE.BoxGeometry(4.2, h, 0.2), R() < 0.5 ? RUST : STEEL), x, h / 2 - 0.2, z, (R() - 0.5) * 0.15, -a, (R() - 0.5) * 0.12));
  }
  // crates + barrels + a fire pit
  for (let i = 0; i < 8; i++) {
    const a = R() * Math.PI * 2;
    const r = 3 + R() * 9;
    if (R() < 0.5) metal.push(place(prep(new THREE.BoxGeometry(1.2, 1.2, 1.2), WOOD), Math.sin(a) * r, 0.6, Math.cos(a) * r, 0, R() * 3, 0));
    else metal.push(place(prep(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), i % 2 ? RED : STEEL), Math.sin(a) * r, 0.55, Math.cos(a) * r));
  }
  lamps.push(place(prep(new THREE.ConeGeometry(0.7, 1.1, 7), ORANGE, 5), 0, 0.55, 0));
  return { stone: merge(lamps), metal: merge(metal), colliders, height: 14 };
}

function wreck(variant, seed) {
  const R = rng(seed);
  const metal = [];
  const glow = [];
  const colliders = [];
  const L = 30 + variant * 6;
  // hull: lathe profile (nose → engines), tilted and half buried
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const r = 3.6 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5) * (1 - 0.25 * t);
    prof.push(new THREE.Vector2(Math.max(0.05, r), t * L - L / 2));
  }
  const hull = prep(new THREE.LatheGeometry(prof, 14), DARK);
  const pitch = -0.12 - variant * 0.03;
  const roll = 0.42 - variant * 0.15;
  metal.push(place(hull, 0, 1.0, 0, Math.PI / 2 + pitch, 0, roll));
  // accent stripe + cockpit glass (dim glow)
  metal.push(place(prep(new THREE.BoxGeometry(0.4, 0.5, L * 0.7), STEEL), 0.4, 3.9, 1, pitch, 0, roll));
  glow.push(place(prep(new THREE.SphereGeometry(1.6, 10, 8), [0.25, 0.55, 0.7], 0.6), 0, 2.6, -L / 2 + 3.5, 0, 0, 0, 1, 0.6, 1.6));
  // broken wing stuck in the ground + one torn away
  metal.push(place(prep(new THREE.BoxGeometry(12, 0.5, 6), STEEL), 6.5, 1.6, 4, 0.1, 0.25, -0.5 + roll));
  metal.push(place(prep(new THREE.BoxGeometry(9, 0.5, 5), STEEL), -12 - R() * 4, 0.4, 10 + R() * 4, 0.05, 1.2, 0.3));
  // engines with ember glow
  for (const s of [-1.6, 1.6]) {
    metal.push(place(prep(new THREE.CylinderGeometry(1.3, 1.5, 4, 12), STEEL), s, 1.9, L / 2 - 1, Math.PI / 2 + pitch, 0, 0));
    glow.push(place(prep(new THREE.CircleGeometry(1.15, 12), ORANGE, 3.0), s, 1.9 + Math.sin(-pitch) * 2.1, L / 2 + 1.05, 0, 0, 0));
  }
  // debris field
  for (let i = 0; i < 14; i++) {
    const a = R() * Math.PI * 2;
    const r = 6 + R() * 18;
    const s = 0.5 + R() * 1.8;
    metal.push(place(prep(new THREE.BoxGeometry(s * 1.6, s * 0.3, s), R() < 0.5 ? STEEL : DARK), Math.sin(a) * r, 0.15, Math.cos(a) * r - 4, R(), R() * 3, R()));
  }
  // smouldering spots
  for (let i = 0; i < 3; i++) glow.push(place(prep(new THREE.SphereGeometry(0.4 + R() * 0.3, 6, 4), ORANGE, 2.2), (R() - 0.5) * 10, 0.2, (R() - 0.5) * 20));
  colliders.push({ x: 0, y: 2, z: 0, w: 7, h: 5, d: L * 0.95, rotY: 0 });
  return { stone: merge(glow), metal: merge(metal), colliders, height: 8 };
}

function waystone() {
  const stone = [];
  const glow = [];
  stone.push(prep(new THREE.CylinderGeometry(1.2, 1.4, 0.6, 6), STONE_DARK));
  stone[0].translate(0, 0.3, 0);
  stone.push(place(prep(new THREE.CylinderGeometry(0.42, 0.55, 4.6, 6), DARK), 0, 2.9, 0));
  stone.push(place(prep(new THREE.CylinderGeometry(0.2, 0.42, 0.6, 6), DARK), 0, 5.5, 0));
  glyph(glow, 0, 4.2, -0.5, 0.42);
  glyph(glow, 0, 4.2, 0.5, 0.42);
  glow.push(place(prep(new THREE.SphereGeometry(0.16, 8, 6), GLYPH, 6), 0, 5.95, 0));
  glow.push(place(prep(new THREE.BoxGeometry(0.06, 3.2, 0.06), GLYPH, 2), 0.47, 2.4, 0));
  glow.push(place(prep(new THREE.BoxGeometry(0.06, 3.2, 0.06), GLYPH, 2), -0.47, 2.4, 0));
  return { stone: merge(stone), metal: merge(glow), colliders: [{ x: 0, y: 2.5, z: 0, w: 1.1, h: 5, d: 1.1, rotY: 0 }], height: 6 };
}

/** Builds (and caches) the geometry set for a POI type + variant. */
export function createPoiLibrary() {
  const cache = new Map();
  return {
    get(type, variant = 0) {
      const k = `${type}:${variant}`;
      let v = cache.get(k);
      if (!v) {
        const seed = 1000 + variant * 77 + type.length * 13;
        v = type === 'ruin' ? ruin(variant, seed) : type === 'outpost' ? outpost(variant, seed) : type === 'wreck' ? wreck(variant, seed) : waystone();
        cache.set(k, v);
      }
      return v;
    },
    dispose() {
      for (const v of cache.values()) {
        v.stone?.dispose();
        v.metal?.dispose();
      }
      cache.clear();
    },
  };
}

// ------------------------------------------------------------------ instanced props
/** Energy-crystal cluster (unit ≈ 2.5 m tall). */
export function crystalGeometry(variant = 0) {
  const R = rng(91 + variant * 7);
  const list = [];
  const n = 5 + variant * 2;
  for (let i = 0; i < n; i++) {
    const h = (0.9 + R() * 1.6) * (i === 0 ? 1.4 : 1);
    const r = 0.14 + R() * 0.12;
    const tilt = i === 0 ? 0 : 0.25 + R() * 0.45;
    const a = R() * Math.PI * 2;
    const body = new THREE.CylinderGeometry(r, r * 1.1, h, 6);
    body.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2.4, 6);
    tip.translate(0, h + r * 1.2, 0);
    const g = merge([prep(body, [0.35, 0.9, 1.0], 1.0), prep(tip, [0.6, 1.0, 1.0], 1.6)]);
    list.push(place(g, Math.sin(a) * 0.25 * (i > 0), 0, Math.cos(a) * 0.25 * (i > 0), Math.cos(a) * tilt, 0, Math.sin(a) * tilt));
  }
  list.push(place(prep(new THREE.DodecahedronGeometry(0.55, 0), STONE_DARK), 0, 0.1, 0, 0, 0, 0, 1.3, 0.5, 1.3));
  return merge(list);
}

/** Resource-node visuals (metal ore vein, stone boulder, wood pile, energy crystal). */
export function nodeGeometry(type) {
  if (type === 'metal') {
    const rock = prep(rockGeometry('node-metal', { detail: 2, size: [1.3, 0.9, 1.1], cuts: 5 }), [0.3, 0.31, 0.34]);
    const parts = [rock];
    const R = rng(5);
    for (let i = 0; i < 5; i++) {
      const c = new THREE.OctahedronGeometry(0.22 + R() * 0.12, 0);
      parts.push(place(prep(c, [0.35, 0.6, 1.0], 1.4), (R() - 0.5) * 1.6, 0.4 + R() * 0.5, (R() - 0.5) * 1.3, R(), R(), R(), 1, 1.8, 1));
    }
    return merge(parts);
  }
  if (type === 'stone') return merge([prep(rockGeometry('node-stone', { detail: 2, size: [1.2, 0.85, 1.05], cuts: 4 }), [0.66, 0.64, 0.6])]);
  if (type === 'wood') {
    const parts = [];
    const R = rng(9);
    for (let i = 0; i < 6; i++) {
      const row = i < 3 ? 0 : i < 5 ? 1 : 2;
      const k = i < 3 ? i : i < 5 ? i - 3 : 0;
      const log = new THREE.CylinderGeometry(0.22, 0.24, 2.4 + R() * 0.4, 9);
      parts.push(place(prep(log, WOOD), (k - (row === 0 ? 1 : row === 1 ? 0.5 : 0)) * 0.46, 0.22 + row * 0.4, 0, Math.PI / 2, 0, 0));
    }
    return merge(parts);
  }
  return crystalGeometry(1);
}

export const ROCK_GEOMETRIES = () => ({
  boulder: { near: rockGeometry('fa', { size: [1, 0.8, 0.92], detail: 3 }), far: rockGeometry('fa', { size: [1, 0.8, 0.92], detail: 0 }) },
  slab: { near: rockGeometry('fslab', { size: [1.5, 0.4, 1.2], cuts: 3, cutDepth: [0.38, 0.62], bump: 0.2, flatten: -0.3, detail: 3 }), far: rockGeometry('fslab', { size: [1.5, 0.4, 1.2], cuts: 3, detail: 0 }) },
  shard: { near: rockGeometry('fshard', { size: [0.6, 1.7, 0.66], cuts: 6, taper: 0.45, bump: 0.22, sink: 0.12, detail: 3 }), far: rockGeometry('fshard', { size: [0.6, 1.7, 0.66], cuts: 6, taper: 0.45, detail: 0 }) },
  outcrop: { near: rockGeometry('fo', { size: [1.2, 0.72, 1.0], cuts: 6, bump: 0.34, freq: 1.8, sink: 0.3, detail: 4 }), far: rockGeometry('fo', { size: [1.2, 0.72, 1.0], cuts: 6, detail: 1 }) },
  hoodoo: { near: scaleGeo(hoodooGeometry('fh', { rings: 16, seg: 9, capDetail: 1 }), 9), far: scaleGeo(hoodooGeometry('fh', { rings: 7, seg: 5, capDetail: 0 }), 9) },
  pebble: { near: rockGeometry('fs', { detail: 1, size: [1, 0.72, 0.9], bump: 0.3, cuts: 3 }), far: null },
});

function scaleGeo(g, s) {
  g.scale(s, s, s);
  g.computeBoundingSphere();
  return g;
}
