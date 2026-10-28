/**
 * Weapon models for remote players (characters module): compact procedural
 * pulse pistol, plasma rifle and railgun in the held-weapon convention (barrel
 * −Z, top +Y, origin at the trigger grip; see weapon-rig.js). Dark gunmetal with
 * cyan energy cells/strips (vertex colours > 1 glow through bloom). One merged
 * geometry per kind; RemoteWeapons draws all remote weapons of a kind with one
 * InstancedMesh (3 draw calls + shadows for any number of players).
 *
 *   createWeaponMesh('rifle')            → THREE.Mesh (also handy as a stand-in for the local player)
 *   const rw = new RemoteWeapons(scene); rw.begin(); rw.push('rifle', matrixWorld); rw.end();
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HOT = /* glsl */ `
{
  vec3 vc = vColor.rgb;
  float hot = step(1.001, max(vc.r, max(vc.g, vc.b)));
  totalEmissiveRadiance += vc * hot * 0.9;
}`;

let material = null;
/** Shared weapon material (vertex colours; colours above 1 are emissive). */
export function weaponMaterial() {
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ name: 'chr-weapon', color: 0xffffff, vertexColors: true, metalness: 0.6, roughness: 0.38 });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${HOT}`);
  };
  material.customProgramCacheKey = () => 'chr-weapon-hot';
  return material;
}

const DARK = new THREE.Color(0x1b1e24);
const MID = new THREE.Color(0x2c3038);
const TRIM = new THREE.Color(0x4a4f58);
const GLOW = new THREE.Color(0x5fd6ff).multiplyScalar(3.2);

function part(geo, color, x, y, z, rx = 0, ry = 0, rz = 0) {
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
const cyl = (r, l, seg = 10) => new THREE.CylinderGeometry(r, r, l, seg).rotateX(Math.PI / 2);

const BUILDERS = {
  pistol() {
    return [
      part(box(0.034, 0.105, 0.046), DARK, 0, -0.035, 0.012, 0.22),
      part(box(0.042, 0.052, 0.215), MID, 0, 0.052, -0.07),
      part(box(0.036, 0.022, 0.2), DARK, 0, 0.086, -0.065),
      part(cyl(0.012, 0.05), TRIM, 0, 0.05, -0.19),
      part(box(0.046, 0.012, 0.11), GLOW, 0, 0.038, -0.09),
      part(box(0.03, 0.008, 0.03), GLOW, 0, 0.05, -0.215),
      part(box(0.03, 0.024, 0.05), DARK, 0, 0.012, -0.03),
    ];
  },
  rifle() {
    return [
      part(box(0.044, 0.092, 0.2), DARK, 0, 0.018, 0.18),
      part(box(0.058, 0.082, 0.36), MID, 0, 0.042, -0.1),
      part(box(0.05, 0.03, 0.3), DARK, 0, 0.098, -0.12),
      part(box(0.034, 0.1, 0.046), DARK, 0, -0.04, 0.005, 0.2),
      part(box(0.042, 0.105, 0.065), DARK, 0, -0.035, -0.12),
      part(box(0.044, 0.07, 0.05), GLOW, 0, -0.07, -0.12),
      part(box(0.052, 0.064, 0.2), DARK, 0, 0.022, -0.36),
      part(cyl(0.017, 0.24), TRIM, 0, 0.045, -0.54),
      part(box(0.062, 0.012, 0.24), GLOW, 0, 0.06, -0.14),
      part(box(0.026, 0.034, 0.11), DARK, 0, 0.13, -0.07),
      part(box(0.02, 0.012, 0.012), GLOW, 0, 0.132, -0.13),
      part(box(0.03, 0.022, 0.02), GLOW, 0, 0.045, -0.665),
    ];
  },
  heavy() {
    return [
      part(box(0.05, 0.1, 0.24), DARK, 0, 0.02, 0.23),
      part(box(0.075, 0.11, 0.5), MID, 0, 0.05, -0.15),
      part(box(0.035, 0.1, 0.046), DARK, 0, -0.04, 0.005, 0.2),
      part(box(0.05, 0.07, 0.16), DARK, 0, -0.01, -0.3),
      part(box(0.022, 0.03, 0.62), TRIM, -0.022, 0.07, -0.66),
      part(box(0.022, 0.03, 0.62), TRIM, 0.022, 0.07, -0.66),
      part(box(0.012, 0.016, 0.56), GLOW, 0, 0.07, -0.66),
      part(box(0.09, 0.07, 0.03), GLOW, 0, 0.06, -0.32),
      part(box(0.09, 0.07, 0.03), GLOW, 0, 0.06, -0.47),
      part(box(0.09, 0.07, 0.03), GLOW, 0, 0.06, -0.62),
      part(box(0.03, 0.04, 0.14), DARK, 0, 0.13, -0.05),
      part(box(0.05, 0.03, 0.03), GLOW, 0, 0.07, -0.975),
    ];
  },
};

const geoCache = {};
/** Merged geometry of a weapon kind ('pistol' | 'rifle' | 'heavy'). */
export function weaponGeometry(kind) {
  const k = BUILDERS[kind] ? kind : 'pistol';
  if (!geoCache[k]) {
    const g = mergeGeometries(BUILDERS[k]());
    g.computeVertexNormals();
    g.computeBoundingSphere();
    geoCache[k] = g;
  }
  return geoCache[k];
}

/** A standalone weapon mesh (shared geometry + material). */
export function createWeaponMesh(kind) {
  const m = new THREE.Mesh(weaponGeometry(kind), weaponMaterial());
  m.name = `chr-weapon-${kind}`;
  m.castShadow = true;
  m.userData.grip = BUILDERS[kind] ? kind : 'pistol';
  return m;
}

/** All remote players' weapons: one InstancedMesh per kind, refilled every frame. */
export class RemoteWeapons {
  constructor(parent, capacity = 64) {
    this.meshes = {};
    this.counts = {};
    for (const k of Object.keys(BUILDERS)) {
      const m = new THREE.InstancedMesh(weaponGeometry(k), weaponMaterial(), capacity);
      m.name = `remote-weapons-${k}`;
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false; // instances move every frame; tiny vertex cost
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent?.add(m);
      this.meshes[k] = m;
      this.counts[k] = 0;
    }
    this.capacity = capacity;
  }

  begin() {
    for (const k in this.counts) this.counts[k] = 0;
  }

  push(kind, matrix) {
    const m = this.meshes[kind] || this.meshes.pistol;
    const k = m === this.meshes[kind] ? kind : 'pistol';
    const i = this.counts[k];
    if (i >= this.capacity) return;
    m.setMatrixAt(i, matrix);
    this.counts[k] = i + 1;
  }

  end() {
    for (const k in this.meshes) {
      const m = this.meshes[k];
      const n = this.counts[k];
      if (m.count !== n) m.count = n;
      m.visible = n > 0;
      if (n) m.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const k in this.meshes) {
      this.meshes[k].removeFromParent();
      this.meshes[k].dispose();
    }
  }
}
