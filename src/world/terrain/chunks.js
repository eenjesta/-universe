import * as THREE from 'three';
import { createTerrainMaterial } from './material.js';

/**
 * Chunked GPU-displaced terrain.
 *
 * 10×10 chunks of 240 m, each a THREE.LOD with four levels (vertex spacing
 * 2 / 4 / 8 / 16 m). All chunks of a level share one flat grid (+ skirts) —
 * heights come from the height texture in the vertex shader — but every chunk
 * gets its own lightweight BufferGeometry (shared attributes) carrying a
 * correct bounding sphere, so three's per-camera frustum culling and LOD
 * selection work for every render (main view, snapshots, shadow passes).
 *
 * Geomorph ranges are chosen so a chunk is fully morphed to the next level
 * before THREE.LOD switches it (switch distance − chunk half-diagonal).
 */
const CHUNKS = 10;
const CHUNK = 240; // metres
const LEVELS = [
  { step: 1, switchAt: 0, morph: [230, 350], skirt: 6 },
  { step: 2, switchAt: 520, morph: [610, 730], skirt: 12 },
  { step: 4, switchAt: 900, morph: [1210, 1330], skirt: 24 },
  { step: 8, switchAt: 1500, morph: [1e9, 1e9 + 1], skirt: 48 },
];

export function createTerrainChunks(data, uniforms) {
  const { heights, N, HALF } = data;
  const group = new THREE.Group();
  group.name = 'terrain';
  const materials = LEVELS.map((l) => createTerrainMaterial(uniforms, l.step, l.morph));
  const shared = LEVELS.map((l) => buildLevelGeometry(CHUNK, l.step * 2, l.skirt));
  const noRaycast = () => {};
  const chunks = [];
  const samplesPerChunk = CHUNK / 2;

  for (let cz = 0; cz < CHUNKS; cz++) {
    for (let cx = 0; cx < CHUNKS; cx++) {
      // height range of the chunk (for culling bounds and the LOD pivot)
      let minH = Infinity;
      let maxH = -Infinity;
      const i0 = cx * samplesPerChunk;
      const j0 = cz * samplesPerChunk;
      for (let j = j0; j <= j0 + samplesPerChunk; j++) {
        for (let i = i0; i <= i0 + samplesPerChunk; i++) {
          const h = heights[Math.min(N - 1, j) * N + Math.min(N - 1, i)];
          if (h < minH) minH = h;
          if (h > maxH) maxH = h;
        }
      }
      const x0 = -HALF + cx * CHUNK;
      const z0 = -HALF + cz * CHUNK;
      const midH = (minH + maxH) / 2;
      const lod = new THREE.LOD();
      lod.name = `terrain-chunk-${cx}-${cz}`;
      lod.position.set(x0 + CHUNK / 2, midH, z0 + CHUNK / 2);
      lod.raycast = noRaycast;
      LEVELS.forEach((level, li) => {
        const src = shared[li];
        const geo = new THREE.BufferGeometry();
        geo.setIndex(src.index);
        geo.setAttribute('position', src.position);
        const lo = minH - level.skirt - 2;
        const hi = maxH + 2;
        geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, lo, 0), new THREE.Vector3(CHUNK, hi, CHUNK));
        geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
        const mesh = new THREE.Mesh(geo, materials[li]);
        mesh.position.set(-CHUNK / 2, -midH, -CHUNK / 2);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.raycast = noRaycast;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        lod.addLevel(mesh, level.switchAt, 0.06);
      });
      lod.updateMatrix();
      lod.matrixAutoUpdate = false;
      group.add(lod);
      chunks.push({ lod, cx, cz, minH, maxH });
    }
  }
  return { group, materials, chunks, levels: LEVELS };
}

/**
 * Flat grid of `size` metres with `spacing` metre cells, plus outward-facing
 * skirts (local y = −depth) along the four borders.
 */
function buildLevelGeometry(size, spacing, depth) {
  const q = Math.round(size / spacing);
  const v = q + 1;
  const pos = [];
  for (let j = 0; j <= q; j++) for (let i = 0; i <= q; i++) pos.push(i * spacing, 0, j * spacing);
  const idx = [];
  const at = (i, j) => j * v + i;
  for (let j = 0; j < q; j++) {
    for (let i = 0; i < q; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  // skirts
  const base = pos.length / 3;
  const borders = [
    { list: Array.from({ length: v }, (_, i) => at(i, 0)), flip: false }, // north (−z)
    { list: Array.from({ length: v }, (_, i) => at(i, q)), flip: true }, // south (+z)
    { list: Array.from({ length: v }, (_, j) => at(0, j)), flip: true }, // west (−x)
    { list: Array.from({ length: v }, (_, j) => at(q, j)), flip: false }, // east (+x)
  ];
  let next = base;
  for (const b of borders) {
    const skirt = b.list.map((vi) => {
      pos.push(pos[vi * 3], -depth, pos[vi * 3 + 2]);
      return next++;
    });
    for (let k = 0; k < b.list.length - 1; k++) {
      const p0 = b.list[k];
      const p1 = b.list[k + 1];
      const s0 = skirt[k];
      const s1 = skirt[k + 1];
      if (b.flip) idx.push(p0, s0, p1, p1, s0, s1);
      else idx.push(p0, p1, s0, p1, s1, s0);
    }
  }
  const position = new THREE.Float32BufferAttribute(pos, 3);
  const index = new THREE.BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
  return { position, index };
}
