/**
 * shared/worldgen — the infinite procedural planet around the hand-made hub
 * (PLATFORM.md §11 / §11.2). Pure JS; see README.md for the contract.
 *
 *   import { createWorldgen } from 'shared/worldgen/index.js'
 *   const wg = createWorldgen({ seed, hub: { heightAt, isWater, radius: 1100, blend: 300 } })
 *
 * Module-level helpers (no instance needed): isSafe(x, z) / hubDist(x, z) for the
 * hub square (|x|, |z| ≤ 1100 m), CHUNK_SIZE, BIOME_LIST / BIOMES, HIGHWAY, POI_TYPES.
 */
export { createWorldgen, CHUNK_SIZE, BIOME_LIST, BIOMES, HIGHWAY, POI_TYPES, PLANETS } from './worldgen.js';
export { snowAt, BIOME_INDEX } from './biomes.js';
export * as FIELDS from './terrain.js';

export const HUB_RADIUS = 1100;

/** Inside the hub square (the safe zone). Instances answer the same via wg.isSafe. */
export function isSafe(x, z) {
  return Math.abs(x) <= HUB_RADIUS && Math.abs(z) <= HUB_RADIUS;
}

/** Distance outside the hub square (0 inside). */
export function hubDist(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z)) - HUB_RADIUS;
  return d > 0 ? d : 0;
}
