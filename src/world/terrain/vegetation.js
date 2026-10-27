import * as THREE from 'three';
import { WORLD } from '../layout.js';
import { createAtlas } from './atlas.js';
import { createVegetationMaterials } from './vegmaterial.js';
import { createPlantLibrary } from './plants.js';
import { scatterVegetation } from './scatter.js';
import { ScatterLayer } from './instancing.js';
import { bakeImpostors, impostorQuad, createImpostorMaterial } from './impostor.js';

/**
 * Vegetation: builds every plant layer (trees, bushes, undergrowth, flowers)
 * as ScatterLayers, registers trunk physics boxes and keeps the near sets
 * around the camera. Exposed as `world.vegetation`:
 *   createTree(type) → Mesh       a standalone plant (same material/wind)
 *   types                         available plant types
 *   clearArea(x, z, r) → count    removes plants (+ their physics boxes)
 *   layers, materials, atlas, stats()
 */
const LAYERS = {
  // trees: detailed within ~150 m, low-poly beyond (up to the draw distance)
  pineTall: { near: 150, far: true, shadow: true, trunk: true, group: 'tree' },
  pineMid: { near: 150, far: true, shadow: true, trunk: true, group: 'tree' },
  spruce: { near: 150, far: true, shadow: true, trunk: true, group: 'tree' },
  oak: { near: 150, far: true, shadow: true, trunk: true, group: 'tree' },
  birch: { near: 150, far: true, shadow: true, trunk: true, group: 'tree' },
  acacia: { near: 150, far: true, shadow: true, trunk: true, group: 'tree' },
  jungleTree: { near: 160, far: true, shadow: true, trunk: true, group: 'tree' },
  palm: { near: 150, far: true, shadow: true, trunk: true, group: 'tree' },
  // bushes: detailed within 90 m, blobs up to 700 m
  bushGreen: { near: 90, far: true, farRadius: 520, shadow: true, group: 'bush' },
  bushJuniper: { near: 90, far: true, farRadius: 520, shadow: true, group: 'bush' },
  // undergrowth / flowers: near only
  fern: { near: 70, group: 'small' },
  tropic: { near: 75, group: 'small' },
  glowPlant: { near: 85, group: 'small' },
  flowersMeadow: { near: 60, group: 'small' },
  flowersGlow: { near: 70, group: 'small' },
  tuftDry: { near: 60, group: 'small' },
};

export function createVegetation(ctx, world, data, q, { sunVis = null } = {}) {
  const t0 = performance.now();
  const timings = {};
  let tm = t0;
  const lap = (name) => {
    const t = performance.now();
    timings[name] = Math.round(t - tm);
    tm = t;
  };
  const atlas = createAtlas();
  lap('atlas');
  const mats = createVegetationMaterials(atlas);
  // key light × terrain visibility (before the far layers clone the materials)
  if (sunVis) for (const m of [mats.near, mats.far]) sunVis.applySunVisibility(m);
  const lib = createPlantLibrary();
  lap('library');
  const instances = scatterVegetation(data, q, lib);
  lap('scatter');
  const group = new THREE.Group();
  group.name = 'vegetation';
  world.scene.add(group);
  const quality = ctx.engine?.quality || { treeDensity: 1, grassDensity: 1, drawDistance: 3000 };

  // far LOD: baked impostor cards (falls back to the low-poly shapes without a renderer)
  let impostors = null;
  const renderer = ctx.engine?.renderer;
  if (renderer) {
    try {
      const bakeSet = {};
      for (const [name, cfg] of Object.entries(LAYERS)) if (cfg.far && lib.near[name]) bakeSet[name] = lib.near[name];
      const bake = bakeImpostors(renderer, bakeSet, atlas.map);
      impostors = { bake, material: createImpostorMaterial(bake, mats.shared), quads: {} };
      if (sunVis) sunVis.applySunVisibility(impostors.material);
      for (const name of Object.keys(bakeSet)) impostors.quads[name] = impostorQuad(bake.slots[name]);
    } catch (err) {
      console.warn('[terrain] impostor bake failed, using low-poly far trees', err);
      impostors = null;
    }
  }
  lap('impostors');
  const farFor = (name, cfg) => {
    if (!cfg.far) return null;
    const radius = cfg.farRadius || quality.drawDistance;
    if (impostors?.quads[name]) return { geometry: impostors.quads[name], material: impostors.material, radius };
    return lib.far[name] ? { geometry: lib.far[name], material: mats.far, radius } : null;
  };

  const layers = {};
  for (const [name, list] of Object.entries(instances)) {
    const cfg = LAYERS[name];
    const plant = lib.near[name];
    if (!cfg || !plant || !list.length) continue;
    const layer = new ScatterLayer({
      name: `veg-${name}`,
      parent: group,
      instances: list,
      near: { geometry: plant.geometry, material: mats.near, radius: cfg.near, castShadow: !!cfg.shadow, depthMaterial: mats.depth, capacity: 256 },
      far: farFor(name, cfg),
    });
    layer.cfg = cfg;
    layer.meta = plant.meta;
    layers[name] = layer;
  }

  lap('layers');
  // trunk collision boxes (trees inside the playable area)
  const physics = ctx.physics;
  const pb = WORLD.playBounds + 20;
  let boxes = 0;
  if (physics?.addBox) {
    for (const layer of Object.values(layers)) {
      if (!layer.cfg.trunk) continue;
      const meta = layer.meta;
      layer.forEach((i, x, z, m, o) => {
        if (Math.abs(x) > pb || Math.abs(z) > pb) return;
        const s = Math.hypot(m[o], m[o + 1], m[o + 2]);
        const sy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
        const r = Math.max(0.28, meta.trunkR * s * 1.1);
        const h = Math.min(7, meta.height * sy * 0.5);
        layer.boxIds[i] = physics.addBox({ x, y: m[o + 13] + h / 2, z, w: r * 2, h, d: r * 2, solid: true, walkable: false, tag: 'terrain-tree', owner: layer.name });
        boxes++;
      });
    }
  }

  lap('physics');
  const applyQuality = (qq) => {
    for (const layer of Object.values(layers)) {
      const g = layer.cfg.group;
      layer.setDensity(g === 'small' ? Math.min(1, 0.35 + qq.grassDensity * 0.65) : qq.treeDensity);
      if (!layer.cfg.farRadius) layer.setFarRadius(qq.drawDistance);
    }
  };
  applyQuality(quality);
  ctx.events?.on?.('quality:change', applyQuality);

  const camPos = new THREE.Vector3();
  function update(dt, t) {
    const cam = ctx.camera;
    if (!cam) return;
    cam.getWorldPosition(camPos);
    for (const name in layers) layers[name].update(camPos);
    mats.update(t, world);
  }

  function clearArea(x, z, r) {
    let n = 0;
    for (const layer of Object.values(layers)) n += layer.clearArea(x, z, r, physics);
    return n;
  }

  function createTree(type = 'pineMid') {
    const plant = lib.near[type] || lib.near.pineMid;
    const mesh = new THREE.Mesh(plant.geometry, mats.near);
    mesh.customDepthMaterial = mats.depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `plant-${type}`;
    mesh.userData.meta = plant.meta;
    return mesh;
  }

  function stats() {
    const out = { instances: 0, near: 0, layers: {} };
    for (const [k, l] of Object.entries(layers)) {
      out.instances += l.count;
      out.near += l.nearCount;
      out.layers[k] = { total: l.total, near: l.nearCount };
    }
    return out;
  }

  const api = {
    group,
    layers,
    materials: mats,
    atlas,
    impostors,
    library: lib,
    types: Object.keys(lib.near),
    createTree,
    clearArea,
    update,
    stats,
    physicsBoxes: boxes,
    buildMs: Math.round(performance.now() - t0),
    timings,
  };
  return api;
}
