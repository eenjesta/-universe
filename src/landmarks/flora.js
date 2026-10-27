/**
 * Landmarks — small flora shared by the plaza, ruins and base: instanced flower
 * beds (5-point star blossoms that glow softly at night, on green leaf clumps).
 * Two InstancedMeshes per bed list, a few hundred triangles of template.
 */
import * as THREE from 'three';
import { Rng } from '../core/math.js';

let blossomGeo = null;
let leafGeo = null;
let leafMat = null;

/** Flat 5-point star blossom (top + bottom fan, ~20 triangles), radius 1. */
function getBlossomGeometry() {
  if (blossomGeo) return blossomGeo;
  const pos = [0, 0.18, 0];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 ? 0.42 : 1;
    pos.push(Math.cos(a) * r, i % 2 ? 0.02 : 0.06, Math.sin(a) * r);
  }
  pos.push(0, -0.06, 0);
  const idx = [];
  for (let i = 0; i < 10; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % 10);
    idx.push(0, b, a, 11, a, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  blossomGeo = g;
  return g;
}

function getLeafGeometry() {
  if (!leafGeo) leafGeo = new THREE.IcosahedronGeometry(1, 0).scale(1, 0.38, 1);
  return leafGeo;
}

/**
 * Builds instanced flower beds from `list` = [[x, y, z, size], …].
 * opts.hues: blossom hues (HSL), opts.leafEvery: one leaf clump per n blossoms.
 */
export function buildFlowerBeds(mats, list, { name = 'flowers', seed = 'flora', hues = [0.76, 0.8, 0.72, 0.85, 0.78], leafEvery = 2, white = 0.12 } = {}) {
  const rng = new Rng(seed);
  const group = new THREE.Group();
  group.name = name;
  if (!list.length) return group;
  if (!leafMat) {
    leafMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    mats.list.push(leafMat);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();

  const blossoms = new THREE.InstancedMesh(getBlossomGeometry(), mats.flower, list.length);
  blossoms.name = `${name}-blossoms`;
  list.forEach((f, i) => {
    const sz = f[3] * 0.75;
    m4.compose(p.set(f[0], f[1] + 0.04, f[2]), q.setFromEuler(e.set(rng.range(-0.35, 0.35), rng.range(0, 6.28), rng.range(-0.35, 0.35))), s.set(sz, sz, sz));
    blossoms.setMatrixAt(i, m4);
    c.setHSL(rng.pick(hues), rng.range(0.6, 0.88), rng.range(0.5, 0.74));
    if (rng.chance(white)) c.setRGB(0.95, 0.9, 1.0);
    blossoms.setColorAt(i, c);
  });
  blossoms.instanceMatrix.needsUpdate = true;
  blossoms.instanceColor.needsUpdate = true;
  blossoms.computeBoundingSphere();
  group.add(blossoms);

  const nLeaf = Math.ceil(list.length / leafEvery);
  const leaves = new THREE.InstancedMesh(getLeafGeometry(), leafMat, nLeaf);
  leaves.name = `${name}-leaves`;
  for (let i = 0; i < nLeaf; i++) {
    const f = list[i * leafEvery];
    const sz = f[3] * rng.range(1.5, 2.3);
    m4.compose(p.set(f[0] + rng.range(-0.08, 0.08), f[1] - sz * 0.15, f[2] + rng.range(-0.08, 0.08)), q.setFromEuler(e.set(0, rng.range(0, 6.28), 0)), s.set(sz, sz, sz));
    leaves.setMatrixAt(i, m4);
    leaves.setColorAt(i, c.setHSL(rng.range(0.24, 0.3), rng.range(0.35, 0.55), rng.range(0.16, 0.26)));
  }
  leaves.instanceMatrix.needsUpdate = true;
  leaves.instanceColor.needsUpdate = true;
  leaves.computeBoundingSphere();
  group.add(leaves);
  return group;
}
