import * as THREE from 'three';
import { createWorldgen } from '../../shared/worldgen/index.js';
import { createWorkers } from './workers.js';
import { createTiles } from './tiles.js';
import { createDetail } from './detail.js';
import { createHighwayMeshes } from './roads.js';
import { createFrontierMinimap } from './minimap.js';
import { createFrontierTerrainUniforms } from './material.js';

/**
 * The infinite planet around the hub (PLATFORM.md §11): streams procedural
 * terrain, vegetation, POIs, resource nodes and the protected highways into the
 * EXISTING world scene, only outside the hub mesh square (|x|, |z| > 1200 m),
 * under the hub's own sky, water plane, fog, lights, shadows and time of day.
 *
 *   const frontier = createFrontierWorld(ctx, { seed, quality })
 *   loop: frontier.update(dt, camera)
 *
 * Call it BEFORE ctx.world.getHeightAt is delegated to it: the hub's original
 * height function is captured here (opts.hubHeightAt overrides). See
 * src/frontier/README.md for the exact integration steps.
 */
export const FRONTIER_QUALITY = {
  low: { K: 1.5, far: 3200, maxTiles: 420, buildPerFrame: 4, vegRadius: 600, bushRadius: 300, treeNear: 100, treeDensity: 0.6, treeCap: 3000, bushCap: 1800, rockCap: 1500, grassRadius: 0, grassCap: 0, grassStep: 3 },
  medium: { K: 1.8, far: 4600, maxTiles: 560, buildPerFrame: 5, vegRadius: 1000, bushRadius: 420, treeNear: 125, treeDensity: 0.85, treeCap: 7000, bushCap: 3000, rockCap: 2500, grassRadius: 48, grassCap: 9000, grassStep: 2.0 },
  high: { K: 2.1, far: 6000, maxTiles: 720, buildPerFrame: 6, vegRadius: 1500, bushRadius: 560, treeNear: 150, treeDensity: 1, treeCap: 12000, bushCap: 4500, rockCap: 4000, grassRadius: 70, grassCap: 16000, grassStep: 1.7 },
};

export function createFrontierWorld(ctx, opts = {}) {
  const world = ctx.world;
  if (!world?.scene) throw new Error('createFrontierWorld: ctx.world.scene is required (install the world first)');
  const seed = String(opts.seed ?? 'o-universe');
  const qid = FRONTIER_QUALITY[opts.quality] ? opts.quality : FRONTIER_QUALITY[ctx.engine?.quality?.id] ? ctx.engine.quality.id : 'high';
  let Q = { ...FRONTIER_QUALITY[qid] };

  // ---------------------------------------------------------------- generator (main thread, exact hub)
  const hubHeightAt = opts.hubHeightAt || (opts.hub === false ? null : world.getHeightAt);
  const hubIsWater = opts.hubIsWater || world.isWater;
  const hub = hubHeightAt
    ? { heightAt: hubHeightAt, isWater: hubIsWater, getWaterHeightAt: world.getWaterHeightAt, radius: opts.radius ?? 1100, blend: opts.blend ?? 300, extent: opts.extent ?? 1200 }
    : null;
  const t0 = performance.now();
  const worldgen = opts.worldgen || createWorldgen({ seed, hub, planet: opts.planet });
  const genMs = Math.round(performance.now() - t0);
  const hubExtent = worldgen.hub.present ? worldgen.hub.extent : 0;

  // ---------------------------------------------------------------- scene graph
  const group = new THREE.Group();
  group.name = 'frontier';
  const terrainGroup = new THREE.Group();
  terrainGroup.name = 'frontier-terrain';
  const detailGroup = new THREE.Group();
  detailGroup.name = 'frontier-detail';
  group.add(terrainGroup, detailGroup);
  world.scene.add(group);

  const sharedDetail = world.terrain?.textures?.detail || null;
  const uniforms = createFrontierTerrainUniforms(sharedDetail);
  const canopyRange = () => uniforms.uCanopy.value.set(Q.vegRadius * 0.55, Q.vegRadius * 0.95);
  canopyRange();
  let tiles = null;
  let detail = null;
  let minimap = null;
  const workers = createWorkers({
    data: worldgen.exportForWorker(),
    onMessage(type, msg) {
      if (type === 'tile') tiles?.receive(msg);
      else if (type === 'chunk') detail?.receive(msg);
      else if (type === 'map') minimap?.receive(msg);
    },
  });
  tiles = createTiles({ group: terrainGroup, uniforms, worker: workers, hubExtent, quality: Q });
  detail = createDetail(ctx, { group: detailGroup, worker: workers, worldgen, hubExtent, quality: Q, renderNodes: opts.renderNodes !== false });
  const roads = createHighwayMeshes(worldgen);
  group.add(roads.group);
  minimap = createFrontierMinimap({ worker: workers, worldgen, hubExtent });

  // ---------------------------------------------------------------- queries
  const getHeightAt = (x, z) => worldgen.heightAt(x, z);
  const getNormalAt = (x, z, target = new THREE.Vector3()) => worldgen.normalAt(x, z, target);
  const isWater = (x, z) => worldgen.isWater(x, z);
  const isSafe = (x, z) => worldgen.isSafe(x, z);
  const biomeAt = (x, z) => worldgen.biomeAt(x, z);

  /** Height-field march (≤ 3 m steps near the ground) + bisection; allocation-free with `out`. */
  function raycastInto(origin, dir, maxDist, out) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;
    let t = 0;
    let prev = 0;
    let above = origin.y - getHeightAt(origin.x, origin.z);
    if (above <= 0) {
      out.point.copy(origin);
      getNormalAt(origin.x, origin.z, out.normal);
      out.distance = 0;
      return out;
    }
    while (t < maxDist) {
      const step = Math.max(0.4, Math.min(above > 400 ? 60 : 3 + above * 0.05, above * 0.5));
      prev = t;
      t = Math.min(maxDist, t + step);
      const px = origin.x + dx * t;
      const py = origin.y + dy * t;
      const pz = origin.z + dz * t;
      above = py - getHeightAt(px, pz);
      if (above <= 0) {
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 14; k++) {
          const mid = (lo + hi) * 0.5;
          if (origin.y + dy * mid - getHeightAt(origin.x + dx * mid, origin.z + dz * mid) > 0) lo = mid;
          else hi = mid;
        }
        out.point.set(origin.x + dx * hi, 0, origin.z + dz * hi);
        out.point.y = getHeightAt(out.point.x, out.point.z);
        getNormalAt(out.point.x, out.point.z, out.normal);
        out.distance = hi;
        return out;
      }
      if (dy >= 0 && py > 1400) break;
      if (t >= maxDist) break;
    }
    return null;
  }
  const raycast = (origin, dir, maxDist = 2000) => raycastInto(origin, dir, maxDist, { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 });
  // THREE.Raycaster support (frontier terrain only)
  const hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  terrainGroup.raycast = (raycaster, intersects) => {
    const r = raycastInto(raycaster.ray.origin, raycaster.ray.direction, raycaster.far === Infinity ? 4000 : raycaster.far, hit);
    if (!r || r.distance < raycaster.near) return;
    if (hubExtent > 0 && Math.max(Math.abs(r.point.x), Math.abs(r.point.z)) <= hubExtent) return; // the hub terrain answers there
    intersects.push({ distance: r.distance, point: r.point.clone(), normal: r.normal.clone(), face: null, object: terrainGroup });
  };

  // ---------------------------------------------------------------- loop
  const cam = new THREE.Vector3();
  let time = 0;
  let enabled = true;
  function update(dt, camera = ctx.camera) {
    if (!enabled || !camera) return;
    time += dt || 0;
    camera.getWorldPosition(cam);
    workers.pump();
    const ground = getHeightAt(cam.x, cam.z);
    tiles.update(cam, ground, time);
    detail.update(cam, time, dt, world);
    const day = world.dayFactor ?? 1;
    uniforms.uNight.value = Math.min(1, Math.max(0, (0.55 - day) / 0.45));
    uniforms.uTime.value = time;
    roads.setDayFactor(day);
  }

  function setQuality(id) {
    if (!FRONTIER_QUALITY[id]) return;
    Q = { ...FRONTIER_QUALITY[id] };
    canopyRange();
    tiles.setQuality(Q);
    detail.setQuality(Q);
  }
  const offQuality = ctx.events?.on?.('quality:change', (q) => q?.id && setQuality(q.id));

  const api = {
    group,
    worldgen,
    seed,
    ready: workers.ready,
    getHeightAt,
    heightAt: getHeightAt,
    getNormalAt,
    isWater,
    getWaterHeightAt: (x, z) => worldgen.getWaterHeightAt(x, z),
    isSafe,
    hubDist: (x, z) => worldgen.hubDist(x, z),
    biomeAt,
    describe: (x, z) => worldgen.describe(x, z),
    isBuildable: (x, z) => worldgen.isBuildable(x, z),
    roadsNear: (x, z, r) => worldgen.roadsNear(x, z, r),
    isOnHighway: (x, z, m) => worldgen.isOnHighway(x, z, m),
    raycast,
    raycastInto,
    /** Streamed resource nodes around the camera: Map id → { id, type, x, y, z, rot, scale }. */
    nodes: detail.nodes,
    /** Streamed POIs + waystones around the camera: Map id → { id, type, variant, x, y, z, rot, radius, name }. */
    pois: detail.pois,
    /** Box colliders of the streamed POI models (world space) for ctx.physics. */
    collidersNear(x, z, r) {
      const out = [];
      for (const o of detail.poiObjects.values()) {
        const p = o.poi;
        if (Math.hypot(p.x - x, p.z - z) > r + 60) continue;
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        for (const b of o.colliders || []) out.push({ id: p.id, x: p.x + b.x * c + b.z * s, y: p.y + b.y, z: p.z - b.x * s + b.z * c, w: b.w, h: b.h, d: b.d, rotY: p.rot + b.rotY });
      }
      return out;
    },
    highways: worldgen.highways,
    minimap,
    update,
    setQuality,
    get quality() {
      return { ...Q };
    },
    /**
     * Debug colours on the terrain: 'biomes' (or true), 'rules' (§11.2 build verdict: hatched orange
     * hub buffer, red highway corridors, violet POI clearance, green = buildable) or off.
     */
    setOverlay(mode) {
      uniforms.uOverlay.value = mode === 'rules' ? 2 : mode ? 1 : 0;
    },
    set enabled(v) {
      enabled = !!v;
      group.visible = enabled;
    },
    get enabled() {
      return enabled;
    },
    /** True while terrain tiles or detail chunks around the camera are still streaming. */
    get busy() {
      return tiles.busy || workers.inflight().chunk > 0;
    },
    stats() {
      return { genMs, worker: workers.inWorker, inflight: workers.inflight(), tiles: tiles.stats(), detail: detail.stats(), minimapTiles: minimap.size };
    },
    dispose() {
      offQuality?.();
      workers.terminate();
      tiles.dispose();
      detail.dispose();
      roads.dispose();
      minimap.dispose();
      if (!sharedDetail) uniforms.tDetail.value?.dispose?.();
      world.scene.remove(group);
    },
  };
  return api;
}
