import * as THREE from 'three';
import { DynamicScatter } from './scatter.js';
import { TREE_VARIANTS, BUSH_VARIANTS, ROCK_VARIANTS } from './pack.js';
import { createPoiLibrary, crystalGeometry, nodeGeometry, ROCK_GEOMETRIES, createPropMaterials } from './models.js';
import { createAtlas } from '../world/terrain/atlas.js';
import { createVegetationMaterials } from '../world/terrain/vegmaterial.js';
import { createPlantLibrary } from '../world/terrain/plants.js';
import { bakeImpostors, impostorQuad, createImpostorMaterial } from '../world/terrain/impostor.js';
import { ihash } from '../world/terrain/instancing.js';

/**
 * Everything that stands on the frontier terrain, streamed per 64 m chunk from
 * the 'detail' worker: trees + bushes (the hub's plant library, near detail +
 * far impostors), rocks, energy crystals, grass clumps near the camera,
 * resource nodes (optional visuals; ids for interaction), POI models and
 * waystone beacons. Uses the hub's vegetation materials / atlas / impostors
 * when the hub world is installed (one program, one atlas), else builds them.
 */
const CHUNK = 64;
const BIOME_ROCK_TINT = [
  [0.7, 0.68, 0.64], // ocean
  [0.86, 0.8, 0.7], // coast
  [0.78, 0.74, 0.68], // meadow
  [0.6, 0.62, 0.56], // forest
  [0.55, 0.6, 0.52], // jungle
  [0.84, 0.88, 0.92], // highlands
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
  const layers = { tree: [], bush: [], rock: [], crystal: [], grass: null, flowers: [], node: {} };
  const farOf = (name, radius) => {
    if (impostors?.quads?.[name]) return { geometry: impostors.quads[name], material: impostors.material, radius };
    if (lib.far[name]) return { geometry: lib.far[name], material: mats.far, radius };
    return null;
  };
  TREE_VARIANTS.forEach((name, i) => {
    layers.tree[i] = new DynamicScatter({
      name: `frontier-tree-${name}`,
      parent: group,
      capacity: Q.treeCap,
      near: { geometry: lib.near[name].geometry, material: mats.near, depthMaterial: mats.depth, castShadow: true, radius: Q.treeNear, capacity: 700 },
      far: farOf(name, Q.vegRadius),
    });
  });
  BUSH_VARIANTS.forEach((name, i) => {
    const far = name === 'bushGreen' || name === 'bushJuniper' ? farOf(name, Math.min(Q.vegRadius, 520)) : null;
    layers.bush[i] = new DynamicScatter({
      name: `frontier-bush-${name}`,
      parent: group,
      capacity: Q.bushCap,
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
  const crystalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.1, emissive: new THREE.Color(0x2fd8ff), emissiveIntensity: 0.9 });
  crystalMat.name = 'frontier-crystal';
  for (let v = 0; v < 3; v++) {
    const g = crystalGeometry(v);
    layers.crystal[v] = new DynamicScatter({ name: `frontier-crystal-${v}`, parent: group, capacity: 1200, near: { geometry: g, material: crystalMat, castShadow: true, radius: 140, capacity: 300 }, far: { geometry: g, material: crystalMat, radius: Math.min(Q.vegRadius, 900) } });
  }
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
    const R = Q.vegRadius + CHUNK;
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
        if (d > Q.vegRadius) continue;
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
          if (!c.bush && d < bushRadius()) setBushes(c, true);
          else if (c.bush && d > bushRadius() + 50) setBushes(c, false);
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
    const d = msg.decor;
    const n = d.length / 8;
    // bucket per layer
    const buckets = new Map();
    for (let k = 0; k < n; k++) {
      const o = k * 8;
      const kind = d[o];
      const variant = d[o + 1];
      const x = d[o + 2];
      const y = d[o + 3];
      const z = d[o + 4];
      // bushes only in the inner ring (added / removed as the camera moves, see setBushes)
      if (kind === 1 && !(c.d < bushRadius())) continue;
      // quality density: a stable subset
      if (kind <= 1 && Q.treeDensity < 1 && ihash(((Math.round(x * 4) * 73856093) ^ (Math.round(z * 4) * 19349663)) >>> 0) > Q.treeDensity) continue;
      const layer = kind === 0 ? layers.tree[variant] : kind === 1 ? layers.bush[variant] : kind === 2 ? layers.rock[variant] : layers.crystal[variant];
      if (!layer) continue;
      let arr = buckets.get(layer);
      if (!arr) buckets.set(layer, (arr = []));
      let r = 1;
      let g = 1;
      let b = 1;
      if (kind === 2) {
        const t = BIOME_ROCK_TINT[d[o + 7] | 0] || BIOME_ROCK_TINT[2];
        const v = 0.85 + 0.3 * ihash((Math.round(x * 7) ^ Math.round(z * 13)) >>> 0);
        r = t[0] * v;
        g = t[1] * v;
        b = t[2] * v;
      } else if (kind <= 1) {
        const v = 0.88 + 0.24 * ihash((Math.round(x * 5) * 31 + Math.round(z * 3)) >>> 0);
        r = v;
        g = v;
        b = v * 0.96;
      }
      arr.push(x, y, z, d[o + 5], d[o + 6], r, g, b);
    }
    for (const [layer, arr] of buckets) layer.add(c.key, Float32Array.from(arr));
    c.decor = d;
    c.bush = c.d < bushRadius();
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

  const bushRadius = () => Math.min(Q.vegRadius, Q.bushRadius ?? 560);

  /** Adds / removes the bushes of a loaded chunk (from its cached decor list). */
  function setBushes(c, on) {
    c.bush = on;
    if (!on) {
      for (const l of layers.bush) l.remove(c.key);
      return;
    }
    const d = c.decor;
    if (!d) return;
    const per = [];
    for (let k = 0; k < d.length / 8; k++) {
      const o = k * 8;
      if (d[o] !== 1) continue;
      const v = d[o + 1] | 0;
      const x = d[o + 2];
      const z = d[o + 4];
      if (Q.treeDensity < 1 && ihash(((Math.round(x * 4) * 73856093) ^ (Math.round(z * 4) * 19349663)) >>> 0) > Q.treeDensity) continue;
      const t = 0.88 + 0.24 * ihash((Math.round(x * 5) * 31 + Math.round(z * 3)) >>> 0);
      (per[v] ||= []).push(x, d[o + 3], z, d[o + 5], d[o + 6], t, t, t * 0.96);
    }
    per.forEach((arr, v) => arr && layers.bush[v]?.add(c.key, Float32Array.from(arr)));
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
    for (const list of [layers.tree, layers.bush, layers.rock, layers.crystal]) for (const l of list) l?.remove(c.key);
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

  const all = () => [...layers.tree, ...layers.bush, ...layers.rock, ...layers.crystal, ...(layers.grass ? [layers.grass] : []), ...layers.flowers.filter(Boolean), ...Object.values(layers.node)];

  return {
    layers,
    nodes,
    pois,
    poiObjects,
    materials: { vegetation: mats, rock: rockMat, crystal: crystalMat, grass: grassMat, node: nodeMat, props: propMats },
    receive,
    update(cam, now, dt, world) {
      if (now - lastPlan > 0.3 || cam.distanceToSquared(camLast) > 64) {
        camLast.copy(cam);
        lastPlan = now;
        plan(cam, now);
      }
      for (const l of all()) l.update(cam);
      const night = 1 - (world?.dayFactor ?? 1);
      crystalMat.emissiveIntensity = 0.9 + night * 2.2 + 0.25 * Math.sin(now * 1.7);
      propMats.shared.uGlow.value = 1.4 + night * 2.4;
      propMats.shared.uTime.value = now;
      if (ownMats) mats.update(now, world || {});
    },
    setQuality(q) {
      Object.assign(Q, q);
      for (const l of layers.tree) {
        l.nearRadius = Q.treeNear;
        l.setFarRadius(Q.vegRadius);
      }
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
      for (const m of [rockMat, crystalMat, grassMat, nodeMat, propMats.stone, propMats.metal]) m.dispose();
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
