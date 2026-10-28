/**
 * Procedural tool + food models (characters module), Ø style: dark composite handles,
 * brushed steel, cyan energy strips (vertex colours > 1 glow through bloom).
 *
 * TOOL CONVENTION (ctx.player.holdTool(mesh, { grip })): origin at the main (right) hand
 * grip, the handle runs along +Y toward the head, the striking face / emitter points
 * along −Z, metres. Optional userData: `tip` (Vector3 | [x,y,z], impact point / beam
 * origin), `support` ([x,y,z], left-hand point for two-handed swings), `grip` (tool id
 * or family 'axe' | 'pick' | 'laser').
 *
 *   createToolModel('axe' | 'plasma-axe' | 'pickaxe' | 'mining-laser', material?) → THREE.Group
 *   createFoodModel('berries' | 'mushroom' | 'jungle-fruit' | 'raw-meat' | 'ration' | …) → THREE.Group
 *   TOOL_BUILDERS  id → () => BufferGeometry[] (vertex-coloured parts; RemoteWeapons instances them)
 * One merged geometry per id (cached); materials are shared.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HOT = /* glsl */ `
{
  vec3 vc = vColor.rgb;
  float hot = step(1.001, max(vc.r, max(vc.g, vc.b)));
  totalEmissiveRadiance += vc * hot * 0.9;
}`;

const MATS = {};
/** Vertex-colour material (colours above 1 are emissive). */
export function vertexColorMaterial(name, metalness, roughness) {
  if (MATS[name]) return MATS[name];
  const m = new THREE.MeshStandardMaterial({ name, color: 0xffffff, vertexColors: true, metalness, roughness });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${HOT}`);
  };
  m.customProgramCacheKey = () => 'chr-vc-hot';
  MATS[name] = m;
  return m;
}
export const toolMaterial = () => vertexColorMaterial('chr-tool', 0.55, 0.42);
export const foodMaterial = () => vertexColorMaterial('chr-food', 0.0, 0.6);

const c = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const COL = {
  handle: c(0x2a241e),
  wrap: c(0x121418),
  dark: c(0x1b1e24),
  mid: c(0x3a3f48),
  steel: c(0x8f979f),
  edge: c(0xd4dbe2),
  trim: c(0x4a4f58),
  glow: c(0x5fd6ff, 3.0),
  plasma: c(0x8fe8ff, 4.2),
  violet: c(0xb48cff, 3.4),
  orange: c(0xff8a3d, 2.4),
};

function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
/** Cylinder along Y. */
const cylY = (r0, r1, l, seg = 10) => new THREE.CylinderGeometry(r1, r0, l, seg);
/** Cylinder along Z. */
const cylZ = (r, l, seg = 10) => new THREE.CylinderGeometry(r, r, l, seg).rotateX(Math.PI / 2);
/** Blade: a wedge in the YZ plane (thin along X) — edge toward −Z. */
function blade(t, h0, h1, len) {
  // trapezoid: height h0 at the handle side (z = 0), h1 at the edge (z = −len); thickness tapers to the edge
  const s = new THREE.Shape();
  s.moveTo(0, -h0 / 2);
  s.lineTo(-len, -h1 / 2);
  s.quadraticCurveTo(-len - 0.012, 0, -len, h1 / 2);
  s.lineTo(0, h0 / 2);
  s.lineTo(0, -h0 / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: t * 0.25, bevelSize: 0.003, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -t / 2);
  // a rotation (not a mirror, which would flip the winding): shape x → z (edge toward −Z), extrude z → −x
  g.rotateY(-Math.PI / 2);
  return g;
}

/** Common axe handle (origin = right-hand grip). */
function handle(len, below, r = 0.016) {
  return [
    part(cylY(r * 1.05, r * 0.9, len, 8), COL.handle, 0, len / 2 - below, 0),
    part(cylY(r * 1.25, r * 1.25, 0.2, 10), COL.wrap, 0, -below + 0.12, 0),
    part(cylY(r * 1.45, r * 1.2, 0.03, 10), COL.trim, 0, -below - 0.005, 0),
  ];
}

export const TOOL_BUILDERS = {
  axe() {
    return [
      ...handle(0.68, 0.17),
      part(box(0.03, 0.075, 0.06), COL.dark, 0, 0.47, 0.012),
      part(blade(0.014, 0.07, 0.15, 0.13), COL.steel, 0, 0.47, -0.016),
      part(box(0.008, 0.13, 0.012), COL.edge, 0, 0.47, -0.152),
      part(box(0.017, 0.012, 0.07), COL.glow, 0, 0.495, -0.06),
      part(box(0.034, 0.04, 0.03), COL.trim, 0, 0.47, 0.05),
    ];
  },
  'plasma-axe'() {
    return [
      ...handle(0.7, 0.17, 0.017),
      part(cylY(0.022, 0.022, 0.07, 10), COL.mid, 0, 0.2, 0),
      part(cylY(0.024, 0.024, 0.012, 10), COL.glow, 0, 0.2, 0),
      part(box(0.032, 0.085, 0.07), COL.dark, 0, 0.48, 0.012),
      part(blade(0.012, 0.08, 0.17, 0.12), COL.mid, 0, 0.48, -0.02),
      part(blade(0.006, 0.05, 0.19, 0.16), COL.plasma, 0, 0.48, -0.004),
      part(box(0.01, 0.17, 0.014), COL.violet, 0, 0.48, -0.172),
      part(box(0.03, 0.05, 0.04), COL.trim, 0, 0.48, 0.06),
    ];
  },
  pickaxe() {
    const head = new THREE.ConeGeometry(0.022, 0.21, 6).rotateX(-Math.PI / 2); // tip toward −Z
    const back = new THREE.ConeGeometry(0.02, 0.14, 4).rotateX(Math.PI / 2); // chisel toward +Z
    return [
      ...handle(0.74, 0.2, 0.017),
      part(box(0.036, 0.05, 0.07), COL.dark, 0, 0.5, 0),
      part(head, COL.steel, 0, 0.505, -0.135, 0.12, 0, 0),
      part(back, COL.steel, 0, 0.5, 0.1, -0.1, 0, 0),
      part(box(0.04, 0.014, 0.05), COL.orange, 0, 0.5, 0),
      part(cylY(0.021, 0.021, 0.012, 10), COL.glow, 0, 0.44, 0),
    ];
  },
  'mining-laser'() {
    return [
      part(box(0.034, 0.11, 0.046), COL.dark, 0, -0.035, 0.01, 0.25, 0, 0),
      part(box(0.056, 0.07, 0.2), COL.mid, 0, 0.055, -0.06),
      part(box(0.05, 0.022, 0.18), COL.dark, 0, 0.098, -0.06),
      part(cylZ(0.026, 0.06, 12), COL.trim, 0, 0.055, -0.185),
      part(new THREE.ConeGeometry(0.024, 0.05, 12).rotateX(-Math.PI / 2), COL.dark, 0, 0.055, -0.235),
      part(new THREE.OctahedronGeometry(0.014, 0), COL.plasma, 0, 0.055, -0.262),
      part(box(0.06, 0.014, 0.1), COL.glow, 0, 0.04, -0.06),
      part(cylZ(0.012, 0.09, 8), COL.orange, 0.03, 0.075, -0.04),
    ];
  },
};
TOOL_BUILDERS.hatchet = TOOL_BUILDERS.axe;
TOOL_BUILDERS.pick = TOOL_BUILDERS.pickaxe;
TOOL_BUILDERS.laser = TOOL_BUILDERS['mining-laser'];

/** Impact / emitter point (tool space) + left-hand point for two-handed swings, per tool id. */
export const TOOL_POINTS = {
  axe: { tip: [0, 0.47, -0.16], support: [0, -0.115, 0] },
  'plasma-axe': { tip: [0, 0.48, -0.18], support: [0, -0.115, 0] },
  pickaxe: { tip: [0, 0.49, -0.25], support: [0, -0.14, 0] },
  'mining-laser': { tip: [0, 0.055, -0.27], support: [-0.028, 0.012, -0.11] },
};
TOOL_POINTS.hatchet = TOOL_POINTS.axe;
TOOL_POINTS.pick = TOOL_POINTS.pickaxe;
TOOL_POINTS.laser = TOOL_POINTS['mining-laser'];

const GEO = new Map();
/** Merged geometry of a tool id (cached). Unknown ids → the axe. */
export function toolGeometry(id) {
  const key = TOOL_BUILDERS[id] ? id : 'axe';
  let g = GEO.get(key);
  if (!g) {
    g = mergeGeometries(TOOL_BUILDERS[key]());
    g.computeBoundingSphere();
    GEO.set(key, g);
  }
  return g;
}

/** A held tool: Group (origin = grip) with userData { tool, grip, tip, support }. */
export function createToolModel(id, material = toolMaterial()) {
  const key = TOOL_BUILDERS[id] ? id : 'axe';
  const group = new THREE.Group();
  group.name = `chr-tool-${key}`;
  const mesh = new THREE.Mesh(toolGeometry(key), material);
  mesh.castShadow = true;
  mesh.name = `chr-tool-${key}-mesh`;
  group.add(mesh);
  const pts = TOOL_POINTS[key] || TOOL_POINTS.axe;
  group.userData.tool = id || key;
  group.userData.grip = id || key;
  group.userData.tip = new THREE.Vector3().fromArray(pts.tip);
  group.userData.support = pts.support.slice();
  group.userData.ownedBy = 'characters';
  return group;
}

// ------------------------------------------------------------------ food
/** Food held in the fingers for the eat gesture (origin = where the fist holds it). */
const FOOD_BUILDERS = {
  berries() {
    const out = [];
    const cols = [c(0xa0183a), c(0x7a1450), c(0xc02848), c(0x5a1660), c(0xb01c40)];
    const pts = [
      [0, 0.03, -0.035, 0.016],
      [0.016, 0.04, -0.03, 0.014],
      [-0.015, 0.038, -0.028, 0.0135],
      [0.004, 0.054, -0.026, 0.013],
      [0.008, 0.026, -0.05, 0.012],
    ];
    pts.forEach(([x, y, z, r], i) => out.push(part(new THREE.IcosahedronGeometry(r, 1), cols[i % cols.length], x, y, z)));
    out.push(part(box(0.03, 0.002, 0.016), c(0x3f7a3a), 0.004, 0.07, -0.028, 0.2, 0.4, 0));
    return out;
  },
  mushroom() {
    const cap = new THREE.SphereGeometry(0.03, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    return [
      part(cylY(0.011, 0.009, 0.055, 8), c(0xd8cdb8), 0, 0.035, -0.03),
      part(cap, c(0x5a3c8c), 0, 0.06, -0.03),
      part(new THREE.IcosahedronGeometry(0.005, 0), c(0x9fe8ff, 2.2), 0.012, 0.078, -0.022),
      part(new THREE.IcosahedronGeometry(0.004, 0), c(0x9fe8ff, 2.2), -0.014, 0.072, -0.036),
    ];
  },
  'jungle-fruit'() {
    const f = new THREE.SphereGeometry(0.03, 12, 9);
    f.scale(1, 1.35, 1);
    return [part(f, c(0x2fb8a0, 1.06), 0, 0.045, -0.035), part(cylY(0.003, 0.002, 0.02, 5), c(0x3a5a2a), 0, 0.09, -0.035)];
  },
  'raw-meat'() {
    const m = new THREE.SphereGeometry(0.035, 10, 7);
    m.scale(1.3, 0.8, 1);
    return [part(m, c(0x9a3a36), 0, 0.035, -0.04), part(cylY(0.006, 0.006, 0.07, 6), c(0xe8e0d0), 0.04, 0.035, -0.04, 0, 0, 1.4)];
  },
  ration() {
    return [
      part(box(0.034, 0.022, 0.095), c(0x2c3036), 0, 0.03, -0.04),
      part(box(0.036, 0.006, 0.03), c(0xd8d2c6), 0, 0.042, -0.05),
      part(box(0.03, 0.012, 0.012), c(0xb88a52), 0, 0.03, -0.092),
    ];
  },
  medkit() {
    return [part(cylZ(0.012, 0.11, 10), c(0xe8eef4), 0, 0.03, -0.04), part(cylZ(0.014, 0.02, 10), c(0xff5a4e, 1.4), 0, 0.03, -0.075), part(cylZ(0.004, 0.03, 6), c(0x9aa3ad), 0, 0.03, -0.11)];
  },
  'shield-cell'() {
    return [part(cylZ(0.02, 0.08, 10), c(0x23272e), 0, 0.03, -0.04), part(cylZ(0.021, 0.05, 10), c(0x5fd6ff, 2.6), 0, 0.03, -0.04)];
  },
};
FOOD_BUILDERS.food = FOOD_BUILDERS.ration;
const FOOD_GEO = new Map();

/** Food / consumable model for the eat + use gestures (unknown ids → a ration bar). */
export function createFoodModel(id) {
  const key = FOOD_BUILDERS[id] ? id : 'ration';
  let g = FOOD_GEO.get(key);
  if (!g) {
    g = mergeGeometries(FOOD_BUILDERS[key]());
    g.computeBoundingSphere();
    FOOD_GEO.set(key, g);
  }
  const group = new THREE.Group();
  group.name = `chr-food-${key}`;
  const mesh = new THREE.Mesh(g, foodMaterial());
  mesh.castShadow = true;
  group.add(mesh);
  group.userData.food = key;
  return group;
}

export const FOOD_IDS = Object.keys(FOOD_BUILDERS);
