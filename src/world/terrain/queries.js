import * as THREE from 'three';
import { sampleGrid } from './heightfield.js';

/**
 * Fast terrain queries on the baked 2 m grid (no allocations unless the
 * caller omits the optional output objects):
 *   getHeightAt(x, z)              bilinear height (clamped at the map edge)
 *   getNormalAt(x, z, target?)     central differences (±1 m)
 *   getWaterHeightAt(x, z)         water surface (lake 0, river ribbon) or null
 *   isWater(x, z)                  lake/sea below waterLevel − 0.3, river channel
 *   raycast(origin, dir, maxDist)  height-field march + bisection refine
 *   raycastInto(origin, dir, maxDist, out)  allocation-free variant
 */
export function createQueries(data, waterLevel = 0) {
  const { heights, river, N, STEP, HALF } = data;

  const getHeightAt = (x, z) => sampleGrid(heights, x, z);

  function getNormalAt(x, z, target = new THREE.Vector3()) {
    const e = 1;
    const hx = sampleGrid(heights, x - e, z) - sampleGrid(heights, x + e, z);
    const hz = sampleGrid(heights, x, z - e) - sampleGrid(heights, x, z + e);
    return target.set(hx, 2 * e, hz).normalize();
  }

  /** Index into the river stamp region for the nearest grid sample (or −1). */
  function riverIndex(x, z) {
    const i = Math.round((x + HALF) / STEP);
    const j = Math.round((z + HALF) / STEP);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return river.index(i, j);
  }

  function getWaterHeightAt(x, z) {
    const ri = riverIndex(x, z);
    if (ri >= 0 && river.cap[ri] === 0 && river.dist[ri] < river.halfWidth[ri] + 0.5) {
      const w = river.water[ri];
      if (getHeightAt(x, z) < w) return w;
    }
    return getHeightAt(x, z) < waterLevel ? waterLevel : null;
  }

  function isWater(x, z) {
    const h = getHeightAt(x, z);
    if (h < waterLevel - 0.3) return true;
    const ri = riverIndex(x, z);
    return ri >= 0 && river.cap[ri] === 0 && river.dist[ri] < river.halfWidth[ri] - 0.5 && h < river.water[ri] - 0.3;
  }

  const _p = new THREE.Vector3();
  /**
   * Marches the ray over the height field (adaptive steps ≤ 3 m so vertical
   * cliffs are not tunnelled), then refines the hit by bisection.
   */
  function raycastInto(origin, dir, maxDist = 1000, out) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;
    let t = 0;
    let prevT = 0;
    let above = origin.y - getHeightAt(origin.x, origin.z);
    if (above <= 0) {
      out.point.copy(origin);
      getNormalAt(origin.x, origin.z, out.normal);
      out.distance = 0;
      return out;
    }
    while (t < maxDist) {
      // big steps while far above the ground, ≤ 3 m near it
      const step = Math.max(0.4, Math.min(3, above * 0.5));
      prevT = t;
      t = Math.min(maxDist, t + step);
      const px = origin.x + dx * t;
      const py = origin.y + dy * t;
      const pz = origin.z + dz * t;
      above = py - getHeightAt(px, pz);
      if (above <= 0) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) * 0.5;
          const qx = origin.x + dx * mid;
          const qz = origin.z + dz * mid;
          if (origin.y + dy * mid - getHeightAt(qx, qz) > 0) lo = mid;
          else hi = mid;
        }
        out.point.set(origin.x + dx * hi, origin.y + dy * hi, origin.z + dz * hi);
        out.point.y = getHeightAt(out.point.x, out.point.z);
        getNormalAt(out.point.x, out.point.z, out.normal);
        out.distance = hi;
        return out;
      }
      // left the map going up: nothing to hit any more
      if (dy >= 0 && py > 900) break;
      if (t >= maxDist) break;
    }
    return null;
  }

  function raycast(origin, dir, maxDist = 1000) {
    return raycastInto(origin, dir, maxDist, { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 });
  }

  return { getHeightAt, getNormalAt, getWaterHeightAt, isWater, raycast, raycastInto, _p };
}
