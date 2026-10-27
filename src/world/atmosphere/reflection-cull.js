import * as THREE from 'three';
import { WORLD } from '../layout.js';

/**
 * Mirror culling for the planar reflection pass. For the duration of one
 * reflection render it hides everything that cannot contribute to the image
 * in the lake, so the mirror costs a fraction of the main pass:
 *  - particles (Points) and lines;
 *  - tiny instanced props (tufts, ferns, flowers, pebbles): invisible in a
 *    rippled half-resolution mirror;
 *  - objects that are far too small to cover a mirror pixel;
 *  - objects entirely below the water plane;
 *  - objects whose reflection lands on land. A point at height h above the
 *    water, seen from a camera at height hc, is mirrored at the water point
 *    C + hc / (hc + h) · (P − C). The footprint of an object's bounding
 *    sphere is the segment between the mirror points of its top and bottom,
 *    widened by its radius; if no part of it is over water (coarse distance
 *    field to the nearest water, outside the map counts as sea), the object
 *    is skipped.
 * No allocations per frame; the traversal callback is created once.
 */

const GRID = 96; // water-mask resolution over the terrain square
const TINY_RADIUS = 1.1; // instanced geometry smaller than this (m) never shows in the mirror
const MIN_ANGULAR = 0.0022; // radius / distance below ~1 mirror pixel

export function createMirrorCull(world) {
  const level = world.waterLevel ?? 0;
  const half = WORLD.half;
  const cell = (half * 2) / GRID;
  let dist = null; // Float32Array GRID², metres to the nearest water cell

  /** Builds the distance-to-water field from the terrain heights (lazy, once). */
  function buildField() {
    const h = world.getHeightAt;
    const water = new Uint8Array(GRID * GRID);
    const probe = [
      [0.5, 0.5],
      [0.15, 0.15],
      [0.85, 0.15],
      [0.15, 0.85],
      [0.85, 0.85],
    ];
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        let wet = 0;
        for (const [u, v] of probe) {
          const g = typeof h === 'function' ? h(-half + (i + u) * cell, -half + (j + v) * cell) : level - 1;
          if (!Number.isFinite(g) || g < level + 0.4) {
            wet = 1;
            break;
          }
        }
        water[j * GRID + i] = wet;
      }
    }
    // two-pass chamfer distance transform (in metres)
    const INF = 1e9;
    const d = new Float32Array(GRID * GRID);
    for (let k = 0; k < d.length; k++) d[k] = water[k] ? 0 : INF;
    const a = cell;
    const b = cell * Math.SQRT2;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const k = j * GRID + i;
        let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + a);
        if (j > 0) {
          v = Math.min(v, d[k - GRID] + a);
          if (i > 0) v = Math.min(v, d[k - GRID - 1] + b);
          if (i < GRID - 1) v = Math.min(v, d[k - GRID + 1] + b);
        }
        d[k] = v;
      }
    }
    for (let j = GRID - 1; j >= 0; j--) {
      for (let i = GRID - 1; i >= 0; i--) {
        const k = j * GRID + i;
        let v = d[k];
        if (i < GRID - 1) v = Math.min(v, d[k + 1] + a);
        if (j < GRID - 1) {
          v = Math.min(v, d[k + GRID] + a);
          if (i < GRID - 1) v = Math.min(v, d[k + GRID + 1] + b);
          if (i > 0) v = Math.min(v, d[k + GRID - 1] + b);
        }
        d[k] = v;
      }
    }
    // the map edge borders the open sea: distance to the outside counts too
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const edge = Math.min(i + 0.5, j + 0.5, GRID - i - 0.5, GRID - j - 0.5) * cell;
        const k = j * GRID + i;
        if (edge < d[k]) d[k] = edge;
      }
    }
    dist = d;
  }

  /** Metres from (x, z) to the nearest water (0 on water / outside the map). */
  function waterDistance(x, z) {
    const i = Math.floor((x + half) / cell);
    const j = Math.floor((z + half) / cell);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return 0;
    return dist[j * GRID + i];
  }

  // ------------------------------------------------------------ per pass
  const hidden = [];
  const tinyCache = new WeakMap();
  const sphere = new THREE.Sphere();
  const cam = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const tmpS = new THREE.Vector3();
  let excluded = null;
  const stats = { tested: 0, culled: 0 };

  /** Is this instanced set made of tiny props? (cached per mesh) */
  function isTinyInstanced(o) {
    let tiny = tinyCache.get(o);
    if (tiny !== undefined) return tiny;
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    let r = g.boundingSphere ? g.boundingSphere.radius : 10;
    // typical instance scale from a few matrices
    let s = 0;
    const n = Math.min(o.count || 0, 24);
    for (let i = 0; i < n; i++) {
      o.getMatrixAt(i, tmpM);
      s = Math.max(s, tmpS.setFromMatrixScale(tmpM).x, tmpS.y, tmpS.z);
    }
    if (n > 0) r *= s;
    tiny = r < TINY_RADIUS;
    // near sets start empty and fill later: only cache a real measurement
    if (n > 0 || !o.isInstancedMesh) tinyCache.set(o, tiny);
    return tiny;
  }

  function mirrorVisible(o) {
    // world bounding sphere (same data three's frustum culling uses)
    if (o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) {
      if (o.boundingSphere === null) o.computeBoundingSphere();
      sphere.copy(o.boundingSphere).applyMatrix4(o.matrixWorld);
    } else {
      const g = o.geometry;
      if (!g) return true;
      if (g.boundingSphere === null) g.computeBoundingSphere();
      if (!g.boundingSphere) return true;
      sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
    }
    const r = sphere.radius;
    if (!(r > 0) || r > 2500) return true;
    const P = sphere.center;
    if (P.y + r < level) return false; // entirely under water
    const dx = P.x - cam.x;
    const dz = P.z - cam.z;
    const dy = P.y - cam.y;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (r * r < MIN_ANGULAR * MIN_ANGULAR * d2) return false; // sub-pixel in the mirror
    if (!dist) return true;
    // footprint of the mirror image on the water plane
    const hc = cam.y - level;
    const hTop = P.y + r - level;
    const hBot = Math.max(P.y - r - level, 0);
    const tA = hc / (hc + hTop);
    const tB = hc / (hc + hBot);
    const len = Math.hypot(dx, dz) * (tB - tA);
    const n = Math.min(24, Math.max(2, Math.ceil(len / cell) + 1));
    for (let i = 0; i < n; i++) {
      const t = tA + ((tB - tA) * i) / (n - 1);
      if (waterDistance(cam.x + dx * t, cam.z + dz * t) <= r * t + cell) return true;
    }
    return false;
  }

  function visit(o) {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    if (excluded && excluded.has(o)) return;
    stats.tested++;
    let keep;
    if (o.isPoints || o.isLine) keep = false;
    else if (o.isInstancedMesh && isTinyInstanced(o)) keep = false;
    else if (o.frustumCulled === false) keep = true;
    else keep = mirrorVisible(o);
    if (!keep) {
      o.visible = false;
      hidden.push(o);
    }
  }

  return {
    stats,
    /** Hides what the mirror cannot show (call right before the reflection render). */
    apply(scene, camPos, excludedSet) {
      if (!dist && typeof world.getHeightAt === 'function') buildField();
      cam.copy(camPos);
      excluded = excludedSet;
      stats.tested = 0;
      hidden.length = 0;
      scene.traverseVisible(visit);
      stats.culled = hidden.length;
    },
    /** Restores everything apply() hid. */
    restore() {
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      hidden.length = 0;
      excluded = null;
    },
    /** Rebuild the water field (e.g. after the terrain changed). */
    invalidate() {
      dist = null;
    },
  };
}
