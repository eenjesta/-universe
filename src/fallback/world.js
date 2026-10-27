import * as THREE from 'three';
import { WORLD } from '../world/layout.js';

/**
 * FALLBACK world (do not edit — used only when src/world fails to load).
 * Flat ground, plain gradient sky, one sun. Implements the ctx.world contract.
 */
export function install(ctx) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fa6c4);
  scene.fog = new THREE.Fog(0x8fa6c4, 200, 1800);

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x3a3226, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
  sun.position.set(150, 200, -120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 600 });
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, WORLD.size, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x5d6b3e, roughness: 1 }),
  );
  ground.receiveShadow = true;
  ground.name = 'fallback-ground';
  scene.add(ground);

  const grid = new THREE.GridHelper(WORLD.size, 240, 0x44502e, 0x4c5a33);
  grid.position.y = 0.02;
  scene.add(grid);

  ctx.physics.setTerrain(() => 0);

  const world = {
    scene,
    sun,
    hemi,
    waterLevel: -100,
    timeOfDay: 15,
    dayFactor: 1,
    sunDirection: sun.position.clone().normalize(),
    terrainMesh: ground,
    getHeightAt: () => 0,
    getNormalAt: (x, z, target = new THREE.Vector3()) => target.set(0, 1, 0),
    isWater: () => false,
    setTimeOfDay(h) {
      world.timeOfDay = h;
    },
    raycast(origin, dir, maxDist = 500) {
      if (dir.y >= -1e-4) return null;
      const t = -origin.y / dir.y;
      if (t < 0 || t > maxDist) return null;
      const point = origin.clone().addScaledVector(dir, t);
      return { point, normal: new THREE.Vector3(0, 1, 0), distance: t };
    },
    minimap: null,
    update() {
      const cam = ctx.engine.camera;
      sun.target.position.set(cam.position.x, 0, cam.position.z);
      sun.position.copy(sun.target.position).add(new THREE.Vector3(150, 200, -120));
    },
  };
  ctx.loop.add('world', (dt, t) => world.update(dt, t), { order: 10 });
  return world;
}
