import * as THREE from 'three';
import { bakeTerrain } from './heightfield.js';
import { createFastNoise } from './noise.js';
import { computeForest } from './biome.js';
import { computeSurface } from './surface.js';
import { createQueries } from './queries.js';
import { heightGridTexture, publicHeightTexture, dataTexture, detailTexture } from './textures.js';
import { createTerrainUniforms } from './material.js';
import { createTerrainChunks } from './chunks.js';
import { createRoads } from './roads.js';
import { createVegetation } from './vegetation.js';
import { createGrass } from './grass.js';
import { createRocks } from './rocks.js';
import { createMinimap } from './minimap.js';
import { createBackdrop } from './backdrop.js';
import { createSunVisibility } from './sunvis.js';
import { WORLD } from '../layout.js';

/**
 * Terrain half of the world (see ARCHITECTURE.md §5):
 *   bake (heightfield.js) → biome + surface masks → GPU textures → chunked
 *   GPU-displaced terrain (chunks.js, material.js) → queries (queries.js)
 * Fills world.getHeightAt / getNormalAt / isWater / raycast / terrainMesh /
 * heightTexture / minimap (+ extras: getWaterHeightAt, raycastInto, terrain).
 */
export async function installTerrain(ctx, world, { progress = () => {} } = {}) {
  const t0 = performance.now();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const stage = (a, b) => (p) => progress(a + (b - a) * p);
  const timings = {};
  let tMark = performance.now();
  const mark = (name) => {
    const now = performance.now();
    timings[name] = Math.round(now - tMark);
    tMark = now;
  };

  // ---------------------------------------------------------------- bake
  const data = await bakeTerrain({ tick, onProgress: stage(0, 0.55) });
  mark('bake');
  const noise = createFastNoise(`${WORLD.seed}-biome`);
  data.forest = computeForest(data, noise);
  mark('forest');
  await tick();
  const surface = computeSurface(data);
  data.slope = surface.slope;
  data.outcrop = surface.outcrop;
  mark('surface');
  progress(0.65);
  await tick();

  // ---------------------------------------------------------------- queries
  const q = createQueries(data, world.waterLevel ?? WORLD.waterLevel);
  world.getHeightAt = q.getHeightAt;
  world.getNormalAt = q.getNormalAt;
  world.isWater = q.isWater;
  world.raycast = q.raycast;
  world.raycastInto = q.raycastInto;
  world.getWaterHeightAt = q.getWaterHeightAt;

  // ---------------------------------------------------------------- textures
  const textures = {
    heightGrid: heightGridTexture(data.heights, data.N),
    normal: dataTexture(surface.normal, data.N, 'terrain-normal'),
    splatA: dataTexture(surface.splatA, data.N, 'terrain-splat-a'),
    splatB: dataTexture(surface.splatB, data.N, 'terrain-splat-b'),
    detail: detailTexture(256, 11),
  };
  mark('textures');
  world.heightTexture = publicHeightTexture(q.getHeightAt, 1024);
  mark('heightTexture');
  world.minimap = createMinimap(data, surface, 1024);
  mark('minimap');
  progress(0.72);
  await tick();

  // terrain sun visibility (long hill shadows), baked on the GPU per light direction
  let sunVis = null;
  if (ctx.engine?.renderer) {
    try {
      sunVis = createSunVisibility(ctx.engine.renderer, data);
    } catch (err) {
      console.warn('[terrain] sun visibility unavailable', err);
      sunVis = null;
    }
  }
  mark('sunvis');

  // ---------------------------------------------------------------- terrain mesh
  const uniforms = createTerrainUniforms(textures, sunVis?.uniforms);
  const terrain = createTerrainChunks(data, uniforms);
  world.scene.add(terrain.group);
  // THREE.Raycaster support: hit the height field instead of the flat grids
  const hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  terrain.group.raycast = (raycaster, intersects) => {
    const r = q.raycastInto(raycaster.ray.origin, raycaster.ray.direction, raycaster.far, hit);
    if (!r || r.distance < raycaster.near) return;
    intersects.push({
      distance: r.distance,
      point: r.point.clone(),
      normal: r.normal.clone(),
      face: { a: 0, b: 0, c: 0, normal: r.normal.clone(), materialIndex: 0 },
      object: terrain.group,
    });
  };
  world.terrainMesh = terrain.group;
  mark('chunks');
  // mountain ring beyond the map edge (open sea to the N/NE)
  const backdrop = createBackdrop(q.getHeightAt);
  world.scene.add(backdrop.mesh);
  mark('backdrop');
  progress(0.78);

  // ---------------------------------------------------------------- roads
  const roads = createRoads(data, q.getHeightAt);
  world.scene.add(roads.mesh);
  mark('roads');
  await tick();

  // ---------------------------------------------------------------- vegetation
  const vegetation = createVegetation(ctx, world, data, q, { sunVis });
  world.vegetation = vegetation;
  mark('vegetation');
  progress(0.9);
  await tick();

  // ---------------------------------------------------------------- rocks
  const rocks = createRocks(ctx, world, data, q, textures, { sunVis });
  // world.vegetation.clearArea clears plants and rocks alike
  const clearPlants = vegetation.clearArea;
  vegetation.clearArea = (x, z, r) => clearPlants(x, z, r) + rocks.clearArea(x, z, r);
  ctx.events?.on?.('quality:change', (qq) => rocks.setDrawDistance(qq.drawDistance));
  mark('rocks');
  await tick();

  // ---------------------------------------------------------------- grass
  const grass = createGrass(textures, ctx.engine?.quality, { sunVis });
  world.scene.add(grass.group);
  ctx.events?.on?.('quality:change', (qq) => grass.setQuality(qq));
  mark('grass');
  progress(0.94);

  const api = {
    data,
    textures,
    uniforms,
    chunks: terrain,
    backdrop,
    roads,
    vegetation,
    rocks,
    grass,
    /** Terrain shadow map + `applySunVisibility(material)` for other modules (see sunvis.js). */
    sunVisibility: sunVis
      ? { texture: sunVis.texture, uniforms: sunVis.uniforms, applySunVisibility: sunVis.applySunVisibility, sample: sunVis.sample, uv: 'uv = worldXZ / 2400 + 0.5' }
      : null,
    stats: { bakeMs: Math.round(data.bakeMs), vegetationMs: vegetation.buildMs, installMs: 0, timings },
  };
  world.terrain = api;

  const camPos = new THREE.Vector3();
  ctx.loop.add(
    'terrain',
    (dt, t) => {
      uniforms.uTime.value = t;
      sunVis?.update(world);
      vegetation.update(dt, t);
      rocks.update(ctx.camera);
      ctx.camera.getWorldPosition(camPos);
      grass.update(t, camPos, world);
      roads.setDayFactor(world.dayFactor ?? 1);
    },
    { order: 11 },
  );

  api.stats.installMs = Math.round(performance.now() - t0);
  api.stats.bake = data.bakeTimings;
  api.stats.vegetation = vegetation.timings;
  console.log(`[terrain] installed in ${api.stats.installMs} ms ${JSON.stringify(timings)} bake ${JSON.stringify(data.bakeTimings)} veg ${JSON.stringify(vegetation.timings)}`);
  progress(1);
  return api;
}
