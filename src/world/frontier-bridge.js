import { WORLD } from './layout.js';

/**
 * Joins the infinite procedural planet (src/frontier + shared/worldgen) onto the
 * hand-made hub world — PLATFORM.md §11: one seamless world, the hub in the
 * middle as the safe zone, survival terrain streaming around it in the same scene.
 *
 * Called by the game right after the world module installed (before landmarks,
 * characters, … install, so every later module sees the combined queries):
 *   - creates the frontier (it captures the hub's own height function first),
 *   - makes ctx.world.getHeightAt / getNormalAt / isWater / getWaterHeightAt /
 *     raycast answer for the whole planet (identical to the hub inside ±1200 m)
 *     and keeps the originals in ctx.world.hub,
 *   - points the physics ground at the combined heights,
 *   - hides the hub's painted backdrop mountains (real terrain replaces them),
 *   - lifts the play bounds (WORLD.hubPlayBounds keeps the hub value for the map),
 *   - streams the frontier while the world scene is the one being rendered.
 */
export const FRONTIER_LIMIT = 90000; // m — float precision stays fine for gameplay out here

export async function attachFrontier(ctx, { seed = 'o-universe' } = {}) {
  const w = ctx.world;
  if (!w || w.frontier) return w?.frontier ?? null;
  const { createFrontierWorld } = await import('../frontier/index.js');
  const frontier = createFrontierWorld(ctx, { seed, quality: ctx.engine.quality.id, renderNodes: false });

  w.hub = {
    getHeightAt: w.getHeightAt,
    getNormalAt: w.getNormalAt,
    isWater: w.isWater,
    getWaterHeightAt: w.getWaterHeightAt,
    raycast: w.raycast,
    raycastInto: w.raycastInto,
  };
  w.getHeightAt = frontier.getHeightAt;
  w.getNormalAt = frontier.getNormalAt;
  w.isWater = frontier.isWater;
  if (frontier.getWaterHeightAt) w.getWaterHeightAt = frontier.getWaterHeightAt;
  w.raycast = frontier.raycast;
  if (frontier.raycastInto) w.raycastInto = frontier.raycastInto; // combat hitscan + build placement
  w.isSafe = frontier.isSafe;
  w.isBuildable = frontier.isBuildable;
  w.biomeAt = frontier.biomeAt;
  w.frontier = frontier;
  ctx.frontier = frontier;
  ctx.worldgen = frontier.worldgen;
  ctx.physics.setTerrain(frontier.getHeightAt);

  if (w.terrain?.backdrop?.mesh) w.terrain.backdrop.mesh.visible = false;
  WORLD.playBounds = FRONTIER_LIMIT;

  ctx.loop.add('frontier', (dt) => frontier.update(dt, ctx.camera), {
    order: 12,
    pausable: false,
    when: () => ctx.engine.scene === w.scene,
  });
  ctx.events.emit('world:frontier', { frontier });

  // a server running another seed (WORLD_SEED) → rebuild the planet with it
  w.frontierOff?.();
  w.frontierOff = ctx.events.on('net:welcome', (msg) => {
    const s = msg?.world?.seed;
    if (s && s !== frontier.seed && s !== seed) {
      console.warn(`[frontier] server seed '${s}' ≠ '${seed}' — rebuilding the planet`);
      reattach(ctx, s).catch((err) => console.error('[frontier] reseed failed', err));
    }
  });
  return frontier;
}

async function reattach(ctx, seed) {
  const w = ctx.world;
  const old = w.frontier;
  if (!old) return;
  ctx.loop.remove('frontier');
  w.frontierOff?.();
  w.frontierOff = null;
  for (const k of ['getHeightAt', 'getNormalAt', 'isWater', 'getWaterHeightAt', 'raycast', 'raycastInto']) {
    if (w.hub[k]) w[k] = w.hub[k];
  }
  old.dispose?.();
  w.frontier = null;
  ctx.frontier = null;
  await attachFrontier(ctx, { seed });
}
