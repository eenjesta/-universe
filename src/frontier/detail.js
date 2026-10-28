import * as THREE from 'three';
import { DynamicScatter } from './scatter.js';
import { TREE_VARIANTS, BUSH_VARIANTS, ROCK_VARIANTS } from './pack.js';
import { createPoiLibrary, crystalGeometry, nodeGeometry, ROCK_GEOMETRIES, createPropMaterials } from './models.js';
import { createAtlas } from '../world/terrain/atlas.js';
import { createVegetationMaterials } from '../world/terrain/vegmaterial.js';
import { createPlantLibrary } from '../world/terrain/plants.js';
import { bakeImpostors, impostorQuad, createImpostorMaterial } from '../world/terrain/impostor.js';
import { ihash } from '../world/terrain/instancing.js';
import { KIND_PREFIX, PREFIX_SLOT, GROW_SECONDS, easeOut, stumpGeometry, rubbleGeometry, cropGeometry, mushroomGeometry, createGatherMaterial, createNearFadeMaterial } from './features.js';
import { rockRadius } from '../../shared/defs/tools.js';
import { BIOME_LIST } from '../../shared/worldgen/index.js';

const BIOME_IDS = BIOME_LIST.map((b) => b.id);

/**
 * Everything that stands on the frontier terrain, streamed per 64 m chunk from
 * the 'detail' worker: trees + bushes (the hub's plant library, near detail +
 * far impostors), rocks, energy crystals, grass clumps near the camera,
 * resource nodes (optional visuals; ids for interaction), POI models and
 * waystone beacons. Uses the hub's vegetation materials / atlas / impostors
 * when the hub world is installed (one program, one atlas), else builds them.
 *
 * Gathering (src/gather): every decor instance keeps its world-feature id (worker `ids`), and a
 * per-feature state (felled / broken / picked + regrowAt, or `hidden` while gather draws its own
 * animated proxy) rebuilds only the affected chunk: felled trees leave stumps, broken rocks rubble,
 * picked plants / berry crops / mushrooms vanish — and everything grows back visibly during the
 * last part of its regrow time (GROW_SECONDS). See `features` in the returned object.
 */
const CHUNK = 64;
// albedo-ish rock tints (× the geometry's AO): real rock sits around 0.3–0.5 — brighter reads as
// snow in the sun; the highlands keep their pale granite, the badlands their red sandstone
const BIOME_ROCK_TINT = [
  [0.56, 0.54, 0.51], // ocean
  [0.68, 0.63, 0.55], // coast
  [0.6, 0.57, 0.52], // meadow
  [0.47, 0.48, 0.44], // forest
  [0.43, 0.47, 0.41], // jungle
  [0.74, 0.77, 0.8], // highlands
  [0.72, 0.36, 0.22], // badlands
  [0.5, 0.52, 0.56], // peaks (dark granite against the snow)
];

export function createDetail(ctx, { group, worker, worldgen, hubExtent, quality, renderNodes = true }) {
  const renderer = ctx.engine?.renderer || null;
  const hubVeg = ctx.world?.vegetation || null;
  // ---------------------------------------------------------------- shared assets
  let ownMats = false;
  let lib = hubVeg?.library || null;
  let mats = hubVeg?.materials || null;
  let atlas = hubVeg?.atlas || null;
  let impostors = hubVeg?.impostors || null;
  if (!lib || !mats) {
    atlas = createAtlas();
    mats = createVegetationMaterials(atlas);
    lib = createPlantLibrary();
    ownMats = true;
    if (renderer) {
      try {
        const bakeSet = {};
        for (const name of [...TREE_VARIANTS, 'bushGreen', 'bushJuniper']) if (lib.near[name]) bakeSet[name] = lib.near[name];
        const bake = bakeImpostors(renderer, bakeSet, atlas.map);
        impostors = { bake, material: createImpostorMaterial(bake, mats.shared), quads: {} };
        for (const name of Object.keys(bakeSet)) impostors.quads[name] = impostorQuad(bake.slots[name]);
      } catch (err) {
        console.warn('[frontier] impostor bake failed — low-poly far trees', err);
        impostors = null;
      }
    }
  }

  const Q = { ...quality };
  const bushRadius = () => Math.min(Q.vegRadius, Q.bushRadius ?? 560);
  // chunks stream PREFETCH m beyond the visible radius so a tree is loaded before it
  // can be seen (the far shader hides everything past the radius per instance)
  const PREFETCH = 128;
  const layers = { tree: [], bush: [], rock: [], crystal: [], grass: null, flowers: [], node: {}, mushroom: [], crop: [], stump: null, rubble: null };
  const farOf = (name, radius) => {
    if (impostors?.quads?.[name]) return { geometry: impostors.quads[name], material: impostors.material, radius };
    if (lib.far[name]) return { geometry: lib.far[name], material: mats.far, radius };
    return null;
  };
  // trees: the vegetation material + a screen-door fade of foliage right at the camera (3P camera
  // behind a woodcutter / walking under low branches); shadows keep the full crown (mats.depth)
  const treeMat = createNearFadeMaterial(mats.near);
  TREE_VARIANTS.forEach((name, i) => {
    layers.tree[i] = new DynamicScatter({
      name: `frontier-tree-${name}`,
      parent: group,
      capacity: Q.treeCap,
      maxCapacity: 65536, // grows instead of dropping trees (dense jungle at 'high' ≈ 35 k of one variant)
      near: { geometry: lib.near[name].geometry, material: treeMat, depthMaterial: mats.depth, castShadow: true, radius: Q.treeNear, capacity: 700 },
      far: farOf(name, Q.vegRadius),
    });
  });
  BUSH_VARIANTS.forEach((name, i) => {
    // far bushes end at the bush ring per instance (shader), not per chunk (setBushes) → no chunk pops
    const far = name === 'bushGreen' || name === 'bushJuniper' ? farOf(name, bushRadius()) : null;
    layers.bush[i] = new DynamicScatter({
      name: `frontier-bush-${name}`,
      parent: group,
      capacity: Q.bushCap,
      maxCapacity: 65536,
      near: { geometry: lib.near[name].geometry, material: mats.near, depthMaterial: mats.depth, castShadow: name.startsWith('bush'), radius: far ? 85 : 70, capacity: 900 },
      far,
    });
  });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  rockMat.name = 'frontier-rock';
  const rockGeos = ROCK_GEOMETRIES();
  ROCK_VARIANTS.forEach((name, i) => {
    const g = rockGeos[name];
    layers.rock[i] = new DynamicScatter({
      name: `frontier-rock-${name}`,
      parent: group,
      capacity: Q.rockCap,
      near: { geometry: g.near, material: rockMat, castShadow: name !== 'pebble', radius: name === 'pebble' ? 70 : name === 'hoodoo' || name === 'outcrop' ? 320 : 170, capacity: 500 },
      far: g.far ? { geometry: g.far, material: rockMat, radius: Math.min(Q.vegRadius, name === 'hoodoo' || name === 'outcrop' ? 2400 : 700) } : null,
    });
  });
  const props = { stone: null, metal: null };
  let density0 = Q.treeDensity;
  const crystalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.1, emissive: new THREE.Color(0x2fd8ff), emissiveIntensity: 0.9 });
  crystalMat.name = 'frontier-crystal';
  for (let v = 0; v < 3; v++) {
    const g = crystalGeometry(v);
    layers.crystal[v] = new DynamicScatter({ name: `frontier-crystal-${v}`, parent: group, capacity: 1200, near: { geometry: g, material: crystalMat, castShadow: true, radius: 140, capacity: 300 }, far: { geometry: g, material: crystalMat, radius: Math.min(Q.vegRadius, 900) } });
  }
  // gathering: stumps, rubble, berry crops, mushroom clusters (near only — they are small)
  const gatherMats = {
    wood: createGatherMaterial('frontier-stump', { roughness: 0.86 }),
    rubble: rockMat,
    crop: createGatherMaterial('frontier-crop', { roughness: 0.32, glow: 0.35 }),
    mushroom: createGatherMaterial('frontier-mushroom', { roughness: 0.6, glow: 1.4 }),
  };
  layers.stump = new DynamicScatter({ name: 'frontier-stump', parent: group, capacity: 1500, near: { geometry: stumpGeometry(), material: gatherMats.wood, castShadow: true, radius: 160, capacity: 400 }, far: null, dither: 0 });
  layers.rubble = new DynamicScatter({ name: 'frontier-rubble', parent: group, capacity: 1200, near: { geometry: rubbleGeometry(), material: rockMat, castShadow: true, radius: 140, capacity: 300 }, far: null, dither: 0 });
  layers.crop = [
    new DynamicScatter({ name: 'frontier-crop-red', parent: group, capacity: 1500, near: { geometry: cropGeometry(1.3, [0.8, 0.07, 0.12], 5), material: gatherMats.crop, castShadow: false, radius: 90, capacity: 600 }, far: null, dither: 0 }),
    new DynamicScatter({ name: 'frontier-crop-blue', parent: group, capacity: 1500, near: { geometry: cropGeometry(1.0, [0.22, 0.2, 0.7], 9, 22), material: gatherMats.crop, castShadow: false, radius: 90, capacity: 600 }, far: null, dither: 0 }),
  ];
  layers.mushroom = [
    new DynamicScatter({ name: 'frontier-mushroom', parent: group, capacity: 1500, near: { geometry: mushroomGeometry(false), material: gatherMats.mushroom, castShadow: false, radius: 80, capacity: 500 }, far: null, dither: 0 }),
    new DynamicScatter({ name: 'frontier-mushroom-glow', parent: group, capacity: 800, near: { geometry: mushroomGeometry(true), material: gatherMats.mushroom, castShadow: false, radius: 110, capacity: 300 }, far: null, dither: 0 }),
  ];
  const TRUNK = TREE_VARIANTS.map((name) => {
    const m = lib.near[name]?.meta || {};
    return { r: (m.trunkR || 0.3) * (name === 'jungleTree' ? 1.4 : 1), h: m.height || 12 };
  });

  // grass clumps (near only, fade out toward the grass radius)
  const grassShared = { uTime: mats.shared.uTime, uGrassFade: { value: new THREE.Vector2(Q.grassRadius * 0.65, Q.grassRadius) } };
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  grassMat.name = 'frontier-grass';
  grassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, grassShared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float wind;\nuniform float uTime;\nuniform vec2 uGrassFade;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float fade = 1.0 - smoothstep(uGrassFade.x, uGrassFade.y, distance(ip, cameraPosition));
  float ph = dot(ip.xz, vec2(0.071, 0.113));
  float sw = (sin(uTime * 1.6 + ph) + 0.5 * sin(uTime * 3.1 + ph * 1.7)) * wind;
  transformed.x += sw * 0.12;
  transformed.z += sw * 0.07;
  transformed *= fade;
}`,
      );
  };
  grassMat.customProgramCacheKey = () => 'frontier-grass-v1';
  if (Q.grassRadius > 0) {
    layers.grass = new DynamicScatter({ name: 'frontier-grass', parent: group, capacity: Q.grassCap, near: { geometry: grassClump(), material: grassMat, castShadow: false, radius: Q.grassRadius, capacity: Q.grassCap }, far: null, dither: 0, refresh: 4 });
    // flower patches from the grass stream (hub plant library: meadow flowers, bioluminescent flowers)
    const fcap = Math.round(Q.grassCap * 0.2);
    layers.flowers = [lib.near.flowersMeadow, lib.near.flowersGlow].map((p, i) =>
      p ? new DynamicScatter({ name: `frontier-flowers-${i}`, parent: group, capacity: fcap, near: { geometry: p.geometry, material: mats.near, depthMaterial: mats.depth, castShadow: false, radius: Q.grassRadius, capacity: fcap }, far: null, dither: 0, refresh: 4 }) : null,
    );
  }
  // resource nodes (optional visuals)
  const nodeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15 });
  nodeMat.name = 'frontier-node';
  nodeMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
#if defined( USE_COLOR_ALPHA )
      totalEmissiveRadiance += vColor.rgb * vColor.a * 0.8;
#endif`,
    );
  };
  nodeMat.customProgramCacheKey = () => 'frontier-node-v1';
  if (renderNodes) {
    for (const t of ['metal', 'stone', 'wood', 'energy']) {
      layers.node[t] = new DynamicScatter({ name: `frontier-node-${t}`, parent: group, capacity: 1500, near: { geometry: nodeGeometry(t), material: nodeMat, castShadow: true, radius: 230, capacity: 300 }, far: null, dither: 0 });
    }
  }

  // POIs + waystones: individual objects (few)
  const poiLib = createPoiLibrary();
  const propMats = createPropMaterials();
  const poiObjects = new Map(); // id → { object, poi, chunk }
  const nodes = new Map(); // id → node (visible chunks)
  const pois = new Map(); // id → poi info (visible chunks)

  // ---------------------------------------------------------------- chunk streaming
  const chunks = new Map(); // key → { cx, cz, state, job, grass, used }
  const byJob = new Map();
  let jobSeq = 1;
  const camLast = new THREE.Vector3(1e9, 0, 1e9);
  let lastPlan = -1;

  function ckey(cx, cz) {
    return `${cx},${cz}`;
  }

  function plan(cam, now) {
    const R = Q.vegRadius + PREFETCH + CHUNK;
    const i0 = Math.floor((cam.x - R) / CHUNK);
    const i1 = Math.floor((cam.x + R) / CHUNK);
    const j0 = Math.floor((cam.z - R) / CHUNK);
    const j1 = Math.floor((cam.z + R) / CHUNK);
    const want = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x0 = i * CHUNK;
        const z0 = j * CHUNK;
        if (hubExtent > 0 && x0 >= -hubExtent && x0 + CHUNK <= hubExtent && z0 >= -hubExtent && z0 + CHUNK <= hubExtent) continue;
        const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + CHUNK));
        const dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + CHUNK));
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > Q.vegRadius + PREFETCH) continue;
        const k = ckey(i, j);
        let c = chunks.get(k);
        const grass = !!layers.grass && d < Q.grassRadius + 8;
        if (!c) {
          c = { key: k, cx: i, cz: j, state: 'new', job: 0, grass: false, used: now, d };
          chunks.set(k, c);
        }
        c.used = now;
        c.d = d;
        if (c.state === 'ready') {
          if (!c.bush && d < bushRadius() + PREFETCH * 0.5) setBushes(c, true);
          else if (c.bush && d > bushRadius() + PREFETCH) setBushes(c, false);
        }
        // grass came into range after a decor-only load: reload with grass
        if (c.state === 'ready' && grass && !c.grass) c.state = 'regrass';
        if (c.state === 'new' || c.state === 'regrass') want.push(c);
        c.wantGrass = grass;
      }
    }
    want.sort((a, b) => a.d - b.d);
    let free = worker.capacity('chunk');
    for (const c of want) {
      if (free <= 0) break;
      c.job = jobSeq++;
      byJob.set(c.job, c);
      c.state = c.state === 'regrass' ? 'pending-grass' : 'pending';
      worker.send('chunk', { type: 'chunk', id: c.job, cx: c.cx, cz: c.cz, grass: c.wantGrass, gstep: Q.grassStep });
      free--;
    }
    // unload chunks out of range (hysteresis 1.25×) and drop stale jobs
    const stale = [];
    for (const [k, c] of chunks) {
      const far = now - c.used > 0.6;
      if (!far) {
        // grass leaving its radius: drop the clumps but keep the decor
        if (c.grass && !c.wantGrass && c.d > Q.grassRadius + 40) {
          layers.grass?.remove(k);
          for (const l of layers.flowers) l?.remove(k);
          c.grass = false;
        }
        continue;
      }
      if (c.state === 'pending' || c.state === 'pending-grass') {
        stale.push(c.job);
        byJob.delete(c.job);
      }
      unloadChunk(c);
      chunks.delete(k);
    }
    if (stale.length) worker.drop('chunk', stale);
  }

  const tmp = {};
  function receive(msg) {
    const c = byJob.get(msg.id);
    if (!c) return;
    byJob.delete(msg.id);
    if (c.state === 'pending-grass') {
      // only the grass is new
      ingestGrass(c, msg);
      c.state = 'ready';
      return;
    }
    ingest(c, msg);
    c.state = 'ready';
  }

  function ingest(c, msg) {
    c.decor = msg.decor;
    c.ids = msg.ids || null;
    c.fid = null; // feature id strings (lazily, featuresNear)
    c.bush = c.d < bushRadius() + PREFETCH * 0.5;
    fill(c, ALL);
    // nodes
    c.nodes = msg.nodes;
    const nb = {};
    for (const nd of msg.nodes) {
      nodes.set(nd.id, nd);
      if (renderNodes && layers.node[nd.type]) (nb[nd.type] ||= []).push(nd.x, nd.y - 0.05, nd.z, nd.rot, nd.scale, 1, 1, 1);
    }
    for (const [t, arr] of Object.entries(nb)) layers.node[t].add(c.key, Float32Array.from(arr));
    // POIs + waystones
    c.pois = msg.pois;
    for (const p of msg.pois) {
      if (poiObjects.has(p.id)) continue;
      const geo = poiLib.get(p.type, p.variant);
      const obj = new THREE.Group();
      obj.name = `frontier-${p.type}-${p.id}`;
      if (geo.stone) obj.add(meshOf(geo.stone, propMats.stone));
      if (geo.metal) obj.add(meshOf(geo.metal, propMats.metal));
      obj.position.set(p.x, p.y - 0.05, p.z);
      obj.rotation.y = p.rot;
      obj.updateMatrixWorld(true);
      obj.matrixAutoUpdate = false;
      group.add(obj);
      poiObjects.set(p.id, { object: obj, poi: p, chunk: c.key, colliders: geo.colliders });
      pois.set(p.id, p);
    }
    if (msg.grass) ingestGrass(c, msg);
  }

  /** Adds / removes the bushes (+ their berry crops) of a loaded chunk (from its cached decor list). */
  function setBushes(c, on) {
    c.bush = on;
    fill(c, M_BUSH | M_CROP);
  }

  // ---------------------------------------------------------------- instances + feature state
  const M_TREE = 1;
  const M_BUSH = 2;
  const M_ROCK = 4;
  const M_CRYSTAL = 8;
  const M_MUSH = 16;
  const M_CROP = 32;
  const M_STUMP = 64;
  const M_RUBBLE = 128;
  const ALL = 255;
  const MASK_OF_KIND = [M_TREE | M_STUMP | M_MUSH, M_BUSH | M_CROP, M_ROCK | M_RUBBLE, M_CRYSTAL | M_RUBBLE, M_MUSH, M_CROP | M_BUSH];
  /** chunk key → Map(slot × 10000 + k → { state, regrowAt, hidden }) — survives chunk unloads. */
  const fsByChunk = new Map();
  let clock = () => Date.now();
  const dirty = new Set(); // chunk keys to rebuild
  let growTick = 0;
  const buckets = new Map(); // layer → number[] (reused)
  const usedLayers = new Set();

  function instColor(kind, x, z, biome, out) {
    if (kind === 2 || kind === 3) {
      const t = kind === 2 ? BIOME_ROCK_TINT[biome | 0] || BIOME_ROCK_TINT[2] : [1, 1, 1];
      const v = kind === 2 ? 0.85 + 0.3 * ihash((Math.round(x * 7) ^ Math.round(z * 13)) >>> 0) : 1;
      out[0] = t[0] * v;
      out[1] = t[1] * v;
      out[2] = t[2] * v;
    } else if (kind <= 1 || kind === 5) {
      const v = 0.88 + 0.24 * ihash((Math.round(x * 5) * 31 + Math.round(z * 3)) >>> 0);
      out[0] = v;
      out[1] = v;
      out[2] = kind === 5 ? v : v * 0.96;
    } else {
      out[0] = out[1] = out[2] = 1;
    }
    return out;
  }
  const col3 = [1, 1, 1];
  const densityCull = (x, z) => Q.treeDensity < 1 && ihash(((Math.round(x * 4) * 73856093) ^ (Math.round(z * 4) * 19349663)) >>> 0) > Q.treeDensity;
  const push = (layer, x, y, z, rot, scale, c) => {
    if (!layer || !(scale > 0.002)) return;
    let arr = buckets.get(layer);
    if (!arr) buckets.set(layer, (arr = []));
    arr.push(x, y, z, rot, scale, c[0], c[1], c[2]);
  };
  const layerFor = (kind, v) => (kind === 0 ? layers.tree[v] : kind === 1 ? layers.bush[v] : kind === 2 ? layers.rock[v] : kind === 3 ? layers.crystal[v] : kind === 4 ? layers.mushroom[v] : layers.crop[v]);
  const growKind = (kind, v) => (kind === 0 ? 'tree' : kind === 2 ? (v === 5 ? 'pebble' : 'rock') : kind === 3 ? 'crystal' : kind === 4 ? 'mushroom' : kind === 5 ? 'crop' : 'plant');

  /** 0 = just harvested … 1 = grown back (null rec = untouched). */
  function growth(rec, kind, v, now) {
    if (!rec || rec.state === 'ok' || rec.state === 'hit') return 1;
    if (!(rec.regrowAt > 0)) return 0;
    const g = 1 - (rec.regrowAt - now) / (GROW_SECONDS[growKind(kind, v)] * 1000);
    return g <= 0 ? 0 : g >= 1 ? 1 : g;
  }

  /**
   * (Re)builds the instances of chunk c for the layers in `mask` from its decor + feature states:
   * hidden (gather's proxy) → nothing; felled / broken / picked → stump / rubble / nothing, growing
   * back during the last GROW_SECONDS before regrowAt.
   */
  function fill(c, mask) {
    const d = c.decor;
    if (!d) return;
    buckets.clear();
    usedLayers.clear();
    const st = fsByChunk.get(c.key) || null;
    const ids = c.ids;
    const now = st ? clock() : 0;
    let growing = false;
    const n = d.length / 8;
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      const kind = d[o];
      if (!(MASK_OF_KIND[kind] & mask)) continue;
      if ((kind === 1 || kind === 5) && !c.bush) continue; // bushes + crops only in the inner ring
      const v = d[o + 1] | 0;
      const x = d[o + 2];
      const y = d[o + 3];
      const z = d[o + 4];
      const rot = d[o + 5];
      const sc = d[o + 6];
      if (kind <= 1 || kind === 5) {
        if (densityCull(x, z)) continue;
      }
      instColor(kind, x, z, d[o + 7], col3);
      const rec = st && ids ? st.get(PREFIX_SLOT[KIND_PREFIX[kind]] * 10000 + ids[i]) : null;
      if (rec?.hidden) continue;
      // berry bushes keep their bush (only the crop goes); everything else follows its state
      const g = kind === 1 && v <= 1 ? 1 : growth(rec, kind, v, now);
      if (g > 0 && g < 1) growing = true;
      const layer = layerFor(kind, v);
      if (g >= 1) {
        if (MASK_OF_KIND[kind] & mask & (M_TREE | M_BUSH | M_ROCK | M_CRYSTAL | M_MUSH | M_CROP)) push(layer, x, y, z, rot, sc, col3);
        continue;
      }
      const e = easeOut(g);
      if (kind === 0) {
        const T = TRUNK[v] || TRUNK[1];
        // the stump stays until the sapling is half grown, sinking into the ground
        if (mask & M_STUMP && g < 0.55) {
          const k = g < 0.3 ? 1 : 1 - (g - 0.3) / 0.25;
          push(layers.stump, x, y - 0.05 - (1 - k) * T.r * sc * 1.5, z, rot, T.r * sc * 1.12, [1, 1, 1]);
        }
        if (mask & M_TREE && g > 0) push(layer, x, y, z, rot, sc * (0.1 + 0.9 * e), col3);
      } else if (kind === 2 || kind === 3) {
        const r = kind === 2 ? rockRadius(['boulder', 'slab', 'shard', 'outcrop', 'hoodoo', 'pebble'][v], sc) : 0.55 * sc;
        if (mask & M_RUBBLE && v !== 5 && g < 0.6 && kind === 2) push(layers.rubble, x, y - 0.05 - g * 0.4, z, rot, Math.max(0.45, r * 0.9) * (1 - g * 0.6), col3);
        if (mask & M_RUBBLE && kind === 3 && g < 0.6) push(layers.rubble, x, y, z, rot, Math.max(0.5, r * 1.2), [0.42, 0.45, 0.5]);
        if (MASK_OF_KIND[kind] & mask & (M_ROCK | M_CRYSTAL)) {
          if (kind === 3) push(layer, x, y - 0.15 * (1 - e), z, rot, sc * (0.3 + 0.7 * e), col3);
          else if (g > 0) push(layer, x, y - (1 - e) * r * 0.8, z, rot, sc * (0.35 + 0.65 * e), col3);
        }
      } else if (g > 0) {
        // plants, crops, mushrooms: grow from small
        push(layer, x, y, z, rot, sc * (0.15 + 0.85 * e), col3);
      }
    }
    // upload: every layer this mask covers gets its bucket (or loses this chunk's instances)
    for (const [layer, arr] of buckets) {
      layer.add(c.key, Float32Array.from(arr));
      usedLayers.add(layer);
    }
    const clearIf = (list) => {
      for (const l of list) if (l && !usedLayers.has(l) && l.has(c.key)) l.remove(c.key);
    };
    if (mask & M_TREE) clearIf(layers.tree);
    if (mask & M_BUSH) clearIf(layers.bush);
    if (mask & M_ROCK) clearIf(layers.rock);
    if (mask & M_CRYSTAL) clearIf(layers.crystal);
    if (mask & M_MUSH) clearIf(layers.mushroom);
    if (mask & M_CROP) clearIf(layers.crop);
    if (mask & M_STUMP) clearIf([layers.stump]);
    if (mask & M_RUBBLE) clearIf([layers.rubble]);
    c.growing = growing;
  }

  function featureSlot(id) {
    const p = typeof id === 'string' ? id.split(':') : null;
    if (!p || p.length !== 4) return null;
    const slot = PREFIX_SLOT[p[0]];
    if (slot === undefined) return null;
    return { key: `${p[1]},${p[2]}`, num: slot * 10000 + (+p[3] | 0), cx: +p[1], cz: +p[2] };
  }

  function setRec(id, fn) {
    const fs = featureSlot(id);
    if (!fs) return false;
    let m = fsByChunk.get(fs.key);
    if (!m) fsByChunk.set(fs.key, (m = new Map()));
    const rec = m.get(fs.num) || { state: 'ok', regrowAt: 0, hidden: false };
    fn(rec);
    if (rec.state === 'ok' && !rec.hidden) m.delete(fs.num);
    else m.set(fs.num, rec);
    if (!m.size) fsByChunk.delete(fs.key);
    if (chunks.get(fs.key)?.state === 'ready') dirty.add(fs.key);
    return true;
  }

  /** Expired states (grown back) leave the map; growing chunks rebuild every ~1 s. */
  function tickFeatures(dt) {
    growTick -= dt;
    if (growTick <= 0) {
      growTick = 1;
      const now = clock();
      for (const [key, m] of fsByChunk) {
        let changed = false;
        for (const [num, rec] of m) {
          if (rec.regrowAt > 0 && now >= rec.regrowAt && rec.state !== 'ok') {
            rec.state = 'ok';
            rec.regrowAt = 0;
            if (!rec.hidden) m.delete(num);
            changed = true;
          }
        }
        if (!m.size) fsByChunk.delete(key);
        const c = chunks.get(key);
        if (c?.state === 'ready' && (changed || c.growing)) dirty.add(key);
      }
    }
    if (dirty.size) {
      for (const key of dirty) {
        const c = chunks.get(key);
        if (c?.state === 'ready' || c?.state === 'pending-grass') fill(c, ALL);
      }
      dirty.clear();
    }
  }

  // ---------------------------------------------------------------- queries for gathering
  const BUSH_NAMES = BUSH_VARIANTS;
  const pool = [];
  /**
   * Loaded, visible, not-harvested features within r of (x, z) → out (reused records):
   * { id, type, kind, variant, name, x, y, z, rot, scale, biome }. Returns the count.
   */
  function featuresNear(x, z, r, out) {
    let n = 0;
    const i0 = Math.floor((x - r) / CHUNK);
    const i1 = Math.floor((x + r) / CHUNK);
    const j0 = Math.floor((z - r) / CHUNK);
    const j1 = Math.floor((z + r) / CHUNK);
    const now = clock();
    for (let cj = j0; cj <= j1; cj++) {
      for (let ci = i0; ci <= i1; ci++) {
        const c = chunks.get(ckey(ci, cj));
        if (!c?.decor || !c.ids) continue;
        const st = fsByChunk.get(c.key) || null;
        const d = c.decor;
        for (let i = 0, nn = d.length / 8; i < nn; i++) {
          const o = i * 8;
          const kind = d[o];
          if (kind === 5) continue; // crops are gathered through their bush
          const fx = d[o + 2];
          const fz = d[o + 4];
          const dx = fx - x;
          const dz = fz - z;
          if (dx * dx + dz * dz > r * r) continue;
          if ((kind <= 1) && densityCull(fx, fz)) continue;
          const rec = st ? st.get(PREFIX_SLOT[KIND_PREFIX[kind]] * 10000 + c.ids[i]) : null;
          if (rec && rec.state !== 'ok' && rec.state !== 'hit' && !(rec.regrowAt > 0 && now >= rec.regrowAt)) continue;
          let f = pool[n];
          if (!f) pool[n] = f = {};
          const fid = c.fid || (c.fid = new Array(nn));
          f.id = fid[i] || (fid[i] = `${KIND_PREFIX[kind]}:${c.cx}:${c.cz}:${c.ids[i]}`);
          f.kind = kind;
          f.type = kind === 0 ? 'tree' : kind === 1 ? 'bush' : kind === 2 ? 'rock' : kind === 3 ? 'crystal' : 'mushroom';
          f.variant = d[o + 1] | 0;
          f.name = kind === 0 ? TREE_VARIANTS[f.variant] : kind === 1 ? BUSH_NAMES[f.variant] : kind === 2 ? ROCK_VARIANTS[f.variant] : f.variant;
          f.x = fx;
          f.y = d[o + 3];
          f.z = fz;
          f.rot = d[o + 5];
          f.scale = d[o + 6];
          f.biome = BIOME_IDS[d[o + 7] | 0] || 'meadow';
          f.hidden = !!rec?.hidden;
          out[n++] = f;
        }
      }
    }
    out.length = n;
    return n;
  }

  /** Geometry / material / colour of a feature for gather's animated proxy (same look as the instance). */
  function partsFor(f) {
    const color = instColor(f.kind, f.x, f.z, BIOME_IDS.indexOf(f.biome), [1, 1, 1]);
    if (f.kind === 0) {
      const name = TREE_VARIANTS[f.variant];
      const p = lib.near[name];
      return { geometry: p.geometry, material: treeMat, depthMaterial: mats.depth, color, height: (p.meta?.height || 12) * f.scale, trunkR: TRUNK[f.variant].r * f.scale, kind: 'tree' };
    }
    if (f.kind === 1) {
      const p = lib.near[BUSH_VARIANTS[f.variant]];
      return { geometry: p.geometry, material: mats.near, depthMaterial: mats.depth, color, height: (p.meta?.height || 1) * f.scale, kind: 'bush' };
    }
    if (f.kind === 2) return { geometry: rockGeos[ROCK_VARIANTS[f.variant]].near, material: rockMat, depthMaterial: null, color, height: rockRadius(ROCK_VARIANTS[f.variant], f.scale) * 1.2, kind: 'rock' };
    if (f.kind === 3) return { geometry: layers.crystal[f.variant].near.geometry, material: crystalMat, depthMaterial: null, color, height: 2.6 * f.scale, kind: 'crystal' };
    return { geometry: layers.mushroom[f.variant].near.geometry, material: gatherMats.mushroom, depthMaterial: null, color, height: 0.35 * f.scale, kind: 'mushroom' };
  }

  /** A loaded feature by id → a fresh record (like near()'s) or null (chunk not loaded / no such feature). */
  function getFeature(id) {
    const fs = featureSlot(id);
    if (!fs) return null;
    const c = chunks.get(fs.key);
    if (!c?.decor || !c.ids) return null;
    const d = c.decor;
    const k = fs.num % 10000;
    const slot = (fs.num - k) / 10000;
    for (let i = 0, n = d.length / 8; i < n; i++) {
      const kind = d[i * 8];
      if (kind === 5 || PREFIX_SLOT[KIND_PREFIX[kind]] !== slot || c.ids[i] !== k) continue;
      const o = i * 8;
      const v = d[o + 1] | 0;
      return {
        id,
        kind,
        type: kind === 0 ? 'tree' : kind === 1 ? 'bush' : kind === 2 ? 'rock' : kind === 3 ? 'crystal' : 'mushroom',
        variant: v,
        name: kind === 0 ? TREE_VARIANTS[v] : kind === 1 ? BUSH_NAMES[v] : kind === 2 ? ROCK_VARIANTS[v] : v,
        x: d[o + 2],
        y: d[o + 3],
        z: d[o + 4],
        rot: d[o + 5],
        scale: d[o + 6],
        biome: BIOME_IDS[d[o + 7] | 0] || 'meadow',
      };
    }
    return null;
  }

  /** The berry-crop geometry of a bush (for the pick animation) or null. */
  function cropFor(f) {
    if (f.kind !== 1) return null;
    const c = chunks.get(ckey(Math.floor(f.x / CHUNK), Math.floor(f.z / CHUNK)));
    if (!c?.decor) return null;
    const d = c.decor;
    const k = +f.id.slice(f.id.lastIndexOf(':') + 1);
    for (let i = 0, n = d.length / 8; i < n; i++) if (d[i * 8] === 5 && c.ids[i] === k) return { geometry: layers.crop[d[i * 8 + 1] | 0].near.geometry, material: gatherMats.crop, variant: d[i * 8 + 1] | 0 };
    return null;
  }

  function ingestGrass(c, msg) {
    if (!layers.grass || !msg.grass) return;
    const g = msg.grass;
    const col = msg.gcol;
    const kind = msg.gkind;
    const n = g.length / 5;
    const arr = new Float32Array(n * 8);
    const fl = [[], []];
    let m = 0;
    for (let k = 0; k < n; k++) {
      const f = kind ? kind[k] : 0;
      if (f > 0 && layers.flowers[f - 1]) {
        const v = 0.9 + 0.2 * ihash((k * 2654435761) >>> 0);
        fl[f - 1].push(g[k * 5], g[k * 5 + 1] + 0.02, g[k * 5 + 2], g[k * 5 + 3], 1.1 + 0.6 * (g[k * 5 + 4] - 0.55), v, v, v);
        continue;
      }
      const o = m * 8;
      arr[o] = g[k * 5];
      arr[o + 1] = g[k * 5 + 1];
      arr[o + 2] = g[k * 5 + 2];
      arr[o + 3] = g[k * 5 + 3];
      arr[o + 4] = g[k * 5 + 4];
      // sRGB bytes → linear-ish (instance colours are linear)
      arr[o + 5] = (col[k * 4] / 255) ** 2.2;
      arr[o + 6] = (col[k * 4 + 1] / 255) ** 2.2;
      arr[o + 7] = (col[k * 4 + 2] / 255) ** 2.2;
      m++;
    }
    layers.grass.add(c.key, arr.subarray(0, m * 8));
    fl.forEach((list, i) => list.length && layers.flowers[i]?.add(c.key, Float32Array.from(list)));
    c.grass = true;
  }

  function meshOf(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.raycast = () => {};
    return m;
  }

  function unloadChunk(c) {
    for (const list of [layers.tree, layers.bush, layers.rock, layers.crystal, layers.mushroom, layers.crop, [layers.stump, layers.rubble]]) for (const l of list) l?.remove(c.key);
    layers.grass?.remove(c.key);
    for (const l of layers.flowers) l?.remove(c.key);
    for (const l of Object.values(layers.node)) l.remove(c.key);
    for (const nd of c.nodes || []) nodes.delete(nd.id);
    for (const p of c.pois || []) {
      const o = poiObjects.get(p.id);
      if (o && o.chunk === c.key) {
        group.remove(o.object);
        poiObjects.delete(p.id);
        pois.delete(p.id);
      }
    }
  }

  const all = () => [...layers.tree, ...layers.bush, ...layers.rock, ...layers.crystal, ...layers.mushroom, ...layers.crop, layers.stump, layers.rubble, ...(layers.grass ? [layers.grass] : []), ...layers.flowers.filter(Boolean), ...Object.values(layers.node)];

  const allList = all();

  return {
    layers,
    nodes,
    pois,
    poiObjects,
    materials: { vegetation: mats, tree: treeMat, rock: rockMat, crystal: crystalMat, grass: grassMat, node: nodeMat, props: propMats, gather: gatherMats },
    /**
     * World-feature state for gathering (ids 't|b|r|c|m:<cx>:<cz>:<k>'):
     *   set(id, state, regrowAt)   'felled' | 'broken' | 'picked' (regrowAt = clock ms) or 'ok'
     *   hide(id, on)               gather's animated proxy replaces the instance while on
     *   setClock(fn)               the clock regrowAt is measured in (default Date.now; gather: server time)
     *   near(x, z, r, out) → n     loaded, visible, available features (reused records)
     *   parts(f) → {geometry, material, depthMaterial, color, height, trunkR?}  proxy look
     *   crop(f) → {geometry, material} | null   the berry crop of a bush
     *   state(id) → {state, regrowAt, hidden} | null
     */
    features: {
      set(id, state, regrowAt = 0) {
        return setRec(id, (r) => {
          r.state = state || 'ok';
          r.regrowAt = Number.isFinite(regrowAt) ? regrowAt : 0;
        });
      },
      hide(id, on = true) {
        return setRec(id, (r) => {
          r.hidden = !!on;
        });
      },
      setClock(fn) {
        if (typeof fn === 'function') clock = fn;
      },
      near: featuresNear,
      get: getFeature,
      parts: partsFor,
      /** Forget every state (a fresh welcome follows); proxies' hidden flags are kept. */
      reset() {
        for (const [key, m] of fsByChunk) {
          for (const [num, rec] of m) {
            if (rec.hidden) {
              rec.state = 'ok';
              rec.regrowAt = 0;
            } else m.delete(num);
          }
          if (!m.size) fsByChunk.delete(key);
          if (chunks.get(key)?.state === 'ready') dirty.add(key);
        }
      },
      crop: cropFor,
      state(id) {
        const fs = featureSlot(id);
        return (fs && fsByChunk.get(fs.key)?.get(fs.num)) || null;
      },
      get size() {
        let n = 0;
        for (const m of fsByChunk.values()) n += m.size;
        return n;
      },
    },
    receive,
    update(cam, now, dt, world) {
      if (now - lastPlan > 0.3 || cam.distanceToSquared(camLast) > 64) {
        camLast.copy(cam);
        lastPlan = now;
        plan(cam, now);
      }
      tickFeatures(dt || 0);
      for (const l of allList) l.update(cam);
      const night = 1 - (world?.dayFactor ?? 1);
      treeMat.emissiveIntensity = mats.near.emissiveIntensity; // the hub animates it (night glow)
      // foliage fade at the camera: behind the shoulder (3P) further out than at the eye (FP)
      if (ctx.player?.view === 'first') treeMat.userData.uFade.value.set(0.35, 1.2);
      else treeMat.userData.uFade.value.set(0.9, 2.6);
      gatherMats.mushroom.userData.uGlow.value = 0.5 + night * 2.2;
      crystalMat.emissiveIntensity = 0.9 + night * 2.2 + 0.25 * Math.sin(now * 1.7);
      propMats.shared.uGlow.value = 1.4 + night * 2.4;
      propMats.shared.uTime.value = now;
      if (ownMats) mats.update(now, world || {});
    },
    setQuality(q) {
      Object.assign(Q, q);
      const densityChanged = q.treeDensity !== undefined && q.treeDensity !== density0;
      density0 = Q.treeDensity;
      for (const l of layers.tree) {
        l.nearRadius = Q.treeNear;
        l.farUniforms && (l.farUniforms.uNearRadius.value = Q.treeNear);
        l.setFarRadius(Q.vegRadius);
        l.changed = true;
      }
      for (const l of layers.bush) l.setFarRadius(bushRadius());
      ROCK_VARIANTS.forEach((name, i) => layers.rock[i].setFarRadius(Math.min(Q.vegRadius, name === 'hoodoo' || name === 'outcrop' ? 2400 : 700)));
      for (const l of layers.crystal) l.setFarRadius(Math.min(Q.vegRadius, 900));
      // the density cull (trees / bushes) is applied when a chunk is filled: refill them all
      if (densityChanged) for (const c of chunks.values()) if (c.state === 'ready' || c.state === 'pending-grass') dirty.add(c.key);
      grassShared.uGrassFade.value.set(Q.grassRadius * 0.65, Q.grassRadius);
      if (layers.grass) layers.grass.nearRadius = Q.grassRadius;
      for (const l of layers.flowers) if (l) l.nearRadius = Q.grassRadius;
      lastPlan = -1;
    },
    stats() {
      let instances = 0;
      let near = 0;
      for (const l of all()) {
        instances += l.count;
        near += l.near.count;
      }
      return { chunks: chunks.size, instances, near, grass: layers.grass ? layers.grass.near.count : 0, nodes: nodes.size, pois: pois.size };
    },
    dispose() {
      for (const c of chunks.values()) unloadChunk(c);
      chunks.clear();
      for (const l of all()) l.dispose();
      poiLib.dispose();
      for (const m of [rockMat, crystalMat, grassMat, nodeMat, propMats.stone, propMats.metal, gatherMats.wood, gatherMats.crop, gatherMats.mushroom, treeMat]) m.dispose();
      if (ownMats) {
        mats.near.dispose();
        mats.depth.dispose();
        mats.far.dispose();
        atlas?.map?.dispose?.();
        atlas?.emissiveMap?.dispose?.();
      }
    },
  };
}


/** A clump of 14 curved, tapered blades (≈ 0.2–0.45 m, wind weight at the tips). */
function grassClump() {
  const pos = [];
  const nor = [];
  const col = [];
  const wind = [];
  const idx = [];
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const blades = 14;
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 0.42;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const h = 0.2 + rnd() * 0.26;
    const w = 0.022 + rnd() * 0.016;
    const lean = 0.06 + rnd() * 0.14;
    const dir = rnd() * Math.PI * 2;
    const lx = Math.cos(dir);
    const lz = Math.sin(dir);
    const px = -lz;
    const pz = lx;
    const base = pos.length / 3;
    const SEG = 3;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const y = h * t;
      const off = lean * t * t;
      const ww = w * (1 - t * 0.85);
      const cx = bx + lx * off;
      const cz = bz + lz * off;
      pos.push(cx - px * ww, y, cz - pz * ww, cx + px * ww, y, cz + pz * ww);
      // soft, mostly-up normals (no dark backfaces)
      nor.push(lx * 0.3, 1, lz * 0.3, lx * 0.3, 1, lz * 0.3);
      const c = 0.5 + 0.5 * t;
      col.push(c, c, c, c, c, c);
      wind.push(t * t, t * t);
    }
    for (let k = 0; k < SEG; k++) {
      const a0 = base + k * 2;
      idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(wind, 1));
  g.setIndex(idx);
  g.normalizeNormals();
  g.computeBoundingSphere();
  return g;
}
