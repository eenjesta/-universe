import * as THREE from 'three';
import { WORLD, ZONES } from './layout.js';
import { installTerrain } from './terrain/index.js';
import { installAtmosphere } from './atmosphere/index.js';

/**
 * Open-world composition (core-owned; do not edit).
 *   ./terrain/     → terrain, roads, vegetation, rocks, minimap  (terrain agent)
 *   ./atmosphere/  → sky, sun, planet, time of day, lights, fog, water, waterfall (atmosphere agent)
 * Each half fills in its part of the `world` contract (ARCHITECTURE.md §5).
 * A failure in one half is contained so the other still works.
 */
export async function install(ctx, helpers = {}) {
  const progress = helpers.progress || (() => {});
  const scene = new THREE.Scene();
  scene.name = 'world';

  const world = {
    scene,
    zones: ZONES,
    waterLevel: WORLD.waterLevel,
    // --- terrain contract (installTerrain)
    getHeightAt: () => 0,
    getNormalAt: (x, z, target = new THREE.Vector3()) => target.set(0, 1, 0),
    isWater: () => false,
    raycast: () => null,
    terrainMesh: null,
    heightTexture: null, // DataTexture (R = height in metres) covering ±WORLD.half
    minimap: null, // { canvas, worldToMap(x, z) → [u, v] }
    // --- atmosphere contract (installAtmosphere)
    sun: null,
    hemi: null,
    timeOfDay: 17.6,
    dayFactor: 1,
    sunDirection: new THREE.Vector3(0.35, 0.12, -1).normalize(),
    setTimeOfDay(h) {
      world.timeOfDay = h;
    },
  };

  try {
    await installTerrain(ctx, world, { progress: (p) => progress(p * 0.6) });
  } catch (err) {
    console.error('[world] terrain install failed — flat ground fallback', err);
    ctx.errors.push({ module: 'world/terrain', error: String(err?.stack || err) });
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.size, WORLD.size).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x55623c, roughness: 1 }),
    );
    ground.receiveShadow = true;
    scene.add(ground);
    world.terrainMesh = ground;
    world.getHeightAt = () => 0;
  }
  ctx.physics.setTerrain(world.getHeightAt);

  try {
    await installAtmosphere(ctx, world, { progress: (p) => progress(0.6 + p * 0.4) });
  } catch (err) {
    console.error('[world] atmosphere install failed — basic lights fallback', err);
    ctx.errors.push({ module: 'world/atmosphere', error: String(err?.stack || err) });
    scene.background = new THREE.Color(0x8fa6c4);
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x3a3226, 1.2);
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
    sun.position.set(150, 200, -120);
    scene.add(hemi, sun, sun.target);
    world.sun = sun;
    world.hemi = hemi;
  }
  progress(1);
  return world;
}
