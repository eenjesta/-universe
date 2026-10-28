import * as THREE from 'three';
import { createFrontierTerrainMaterial } from './material.js';

/**
 * Streaming quadtree terrain. Tiles of level ℓ cover 64·2^ℓ m with 32 × 32
 * cells (2·2^ℓ m spacing), levels 0 … 6 (64 m … 4 km). A tile splits while the
 * 3D distance from the camera to its box is < K · size, so detail falls off
 * with distance and altitude; the coarse levels reach the horizon (`far`).
 *
 *   - geomorph: every vertex carries (parent surface − height); level ℓ morphs
 *     fully into its parent's shape before the parent replaces it → no pops
 *   - skirts on all tile edges hide the remaining cracks between levels
 *   - a missing tile is covered by its nearest ready ancestor (never both)
 *   - tiles inside the hub mesh square are never generated; tiles crossing it
 *     drop the cells (and skirt segments) that lie inside
 *   - generation in a Web Worker, mesh builds limited per frame, LRU cache
 */
export const LEVELS = 7;
export const CELLS = 32;
export const tileSize = (l) => 64 * 2 ** l;
const key = (l, tx, tz) => `${l}:${tx}:${tz}`; // tile cache key
const noRaycast = () => {};

export function createTiles({ group, uniforms, worker, hubExtent = 0, quality = {} }) {
  let K = quality.K ?? 2;
  let far = quality.far ?? 5000;
  let maxTiles = quality.maxTiles ?? 700;
  let buildPerFrame = quality.buildPerFrame ?? 6;
  const E = hubExtent;
  const materials = [];
  for (let l = 0; l < LEVELS; l++) materials.push(createFrontierTerrainMaterial(uniforms, morphRange(l)));
  function morphRange(l) {
    if (l >= LEVELS - 1) return [1e9, 2e9]; // never morphs (not [1e9, 1e9 + 1]: equal in float32)
    const D = K * tileSize(l + 1);
    return [0.62 * D, 0.93 * D];
  }

  const sharedIndex = buildIndex(CELLS, null);
  const tiles = new Map(); // key → tile
  const pendingById = new Map(); // job id → tile
  const buildQueue = [];
  let shown = new Set();
  let jobSeq = 1;
  let lastPlan = 0;
  const camPrev = new THREE.Vector3(1e9, 0, 1e9);
  const stats = { tiles: 0, shown: 0, pending: 0, built: 0, triangles: 0, builds: 0, buildMs: 0 };

  function insideHub(x0, z0, S) {
    return E > 0 && x0 >= -E && x0 + S <= E && z0 >= -E && z0 + S <= E;
  }
  function crossesHub(x0, z0, S) {
    return E > 0 && x0 < E && x0 + S > -E && z0 < E && z0 + S > -E;
  }

  function getTile(l, tx, tz) {
    const k = key(l, tx, tz);
    let t = tiles.get(k);
    if (!t) {
      const S = tileSize(l);
      t = { key: k, l, tx, tz, x0: tx * S, z0: tz * S, size: S, state: 'new', mesh: null, job: 0, used: 0, minH: 0, maxH: 0, data: null };
      tiles.set(k, t);
    }
    return t;
  }

  // ------------------------------------------------------------ plan
  const desired = [];
  // Distance to a tile = horizontal distance to its box combined with the vertical gap
  // between the camera and the tile's highest point (known from the tile or an
  // ancestor, else 0). Every vertex is at least that far away, so a tile is always
  // fully geomorphed into its parent's shape where a coarser neighbour begins.
  function collect(l, tx, tz, cx, cz, cy, topH) {
    const S = tileSize(l);
    const x0 = tx * S;
    const z0 = tz * S;
    if (insideHub(x0, z0, S)) return;
    const dx = Math.max(x0 - cx, 0, cx - (x0 + S));
    const dz = Math.max(z0 - cz, 0, cz - (z0 + S));
    const dxz = Math.sqrt(dx * dx + dz * dz);
    if (dxz > far) return;
    const t = tiles.get(key(l, tx, tz));
    const top = t && t.state === 'ready' ? t.maxH : topH;
    const gap = cy > top ? cy - top : 0;
    const d = Math.sqrt(dxz * dxz + gap * gap);
    if (l > 0 && d < K * S) {
      const c = l - 1;
      collect(c, tx * 2, tz * 2, cx, cz, cy, top);
      collect(c, tx * 2 + 1, tz * 2, cx, cz, cy, top);
      collect(c, tx * 2, tz * 2 + 1, cx, cz, cy, top);
      collect(c, tx * 2 + 1, tz * 2 + 1, cx, cz, cy, top);
    } else desired.push(getTile(l, tx, tz), d / S);
  }

  function plan(cam, groundY, now) {
    desired.length = 0;
    const R = tileSize(LEVELS - 1);
    const i0 = Math.floor((cam.x - far) / R);
    const i1 = Math.floor((cam.x + far) / R);
    const j0 = Math.floor((cam.z - far) / R);
    const j1 = Math.floor((cam.z + far) / R);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) collect(LEVELS - 1, i, j, cam.x, cam.z, cam.y, Infinity);

    // display set: each desired leaf, or its nearest ready ancestor
    const display = new Set();
    const subst = new Set();
    const want = []; // [tile, priority]
    for (let k = 0; k < desired.length; k += 2) {
      const t = desired[k];
      const pri = desired[k + 1];
      t.used = now;
      if (t.state === 'ready') {
        display.add(t);
        continue;
      }
      if (t.state === 'new') want.push(t, pri);
      // fallback 1: its four ready children (moving away — the finer tiles are still cached and,
      // being this far out, already geomorphed into this tile's shape) → no hole, no coarse pop
      if (t.l > 0) {
        let all = true;
        for (let q = 0; q < 4 && all; q++) {
          const ch = tiles.get(key(t.l - 1, t.tx * 2 + (q & 1), t.tz * 2 + (q >> 1)));
          if (!ch || ch.state !== 'ready') all = false;
        }
        if (all) {
          for (let q = 0; q < 4; q++) {
            const ch = tiles.get(key(t.l - 1, t.tx * 2 + (q & 1), t.tz * 2 + (q >> 1)));
            ch.used = now;
            display.add(ch);
          }
          continue;
        }
      }
      // fallback 2: nearest ready ancestor
      let a = null;
      for (let l = t.l + 1; l < LEVELS; l++) {
        const sh = l - t.l;
        const p = tiles.get(key(l, Math.floor(t.tx / 2 ** sh), Math.floor(t.tz / 2 ** sh)));
        if (p && p.state === 'ready') {
          a = p;
          break;
        }
        // make sure some coarse ancestor is on its way (level ≥ 3 covers ~1 km)
        if (l >= Math.min(LEVELS - 1, t.l + 3) && (!p || p.state === 'new')) {
          const q = getTile(l, Math.floor(t.tx / 2 ** sh), Math.floor(t.tz / 2 ** sh));
          q.used = now;
          if (q.state === 'new') want.push(q, pri * 0.25);
          break;
        }
      }
      if (a) {
        a.used = now;
        display.add(a);
        subst.add(a);
      }
    }
    // a substituted ancestor hides its descendants
    if (subst.size) {
      for (const t of display) {
        for (let l = t.l + 1; l < LEVELS; l++) {
          const sh = l - t.l;
          const p = tiles.get(key(l, Math.floor(t.tx / 2 ** sh), Math.floor(t.tz / 2 ** sh)));
          if (p && subst.has(p) && p !== t) {
            display.delete(t);
            break;
          }
        }
      }
    }
    // swap visibility
    for (const t of shown) if (!display.has(t) && t.mesh) t.mesh.visible = false;
    for (const t of display) if (t.mesh) t.mesh.visible = true;
    shown = display;

    // requests: most urgent first (coarse + near), bounded in flight
    const order = [];
    for (let k = 0; k < want.length; k += 2) order.push(k);
    order.sort((a, b) => want[a + 1] - want[b + 1]);
    const free = worker.capacity('tile');
    let sent = 0;
    for (const k of order) {
      if (sent >= free) break;
      const t = want[k];
      if (t.state !== 'new') continue;
      t.state = 'pending';
      t.job = jobSeq++;
      pendingById.set(t.job, t);
      worker.send('tile', { type: 'tile', id: t.job, x0: t.x0, z0: t.z0, size: t.size, cells: CELLS });
      sent++;
    }
    // drop jobs nobody wants any more
    const stale = [];
    for (const [id, t] of pendingById) {
      if (now - t.used > 1.5) {
        stale.push(id);
        pendingById.delete(id);
        t.state = 'new';
      }
    }
    if (stale.length) worker.drop('tile', stale);
    evict(now);
  }

  function evict(now) {
    if (tiles.size <= maxTiles) return;
    const list = [];
    for (const t of tiles.values()) if (!shown.has(t) && t.state !== 'pending') list.push(t);
    list.sort((a, b) => a.used - b.used);
    for (let i = 0; i < list.length && tiles.size > maxTiles; i++) {
      const t = list[i];
      if (now - t.used < 0.5) break;
      disposeTile(t);
      tiles.delete(t.key);
    }
  }

  function disposeTile(t) {
    if (t.mesh) {
      group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh = null;
    }
    t.data = null;
    t.state = 'new';
  }

  // ------------------------------------------------------------ worker results
  function receive(msg) {
    const t = pendingById.get(msg.id);
    if (!t) return; // dropped or evicted meanwhile
    pendingById.delete(msg.id);
    t.data = msg;
    t.state = 'loaded';
    buildQueue.push(t);
  }

  function buildSome() {
    const t0 = performance.now();
    let n = 0;
    while (buildQueue.length && n < buildPerFrame && performance.now() - t0 < 4) {
      const t = buildQueue.shift();
      if (t.state !== 'loaded' || !t.data) continue;
      build(t);
      n++;
    }
    if (n) {
      stats.builds += n;
      stats.buildMs = performance.now() - t0;
    }
  }

  function build(t) {
    const d = t.data;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute('nc', new THREE.BufferAttribute(d.nrm, 4, true));
    g.setAttribute('splatA', new THREE.BufferAttribute(d.sa, 4, true));
    g.setAttribute('splatB', new THREE.BufferAttribute(d.sb, 4, true));
    g.setAttribute('splatC', new THREE.BufferAttribute(d.sc, 4, true));
    g.setAttribute('morph', new THREE.BufferAttribute(d.morph, 1));
    if (d.rules) g.setAttribute('rules', new THREE.BufferAttribute(d.rules, 2, true));
    const clip = crossesHub(t.x0, t.z0, t.size);
    g.setIndex(clip ? buildIndex(CELLS, { x0: t.x0, z0: t.z0, step: t.size / CELLS, E }) : sharedIndex);
    const lx = t.x0 - d.bx;
    const lz = t.z0 - d.bz;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(lx, d.minH - d.skirt - 1, lz), new THREE.Vector3(lx + t.size, d.maxH + 1, lz + t.size));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, materials[t.l]);
    mesh.name = `frontier-tile-${t.key}`;
    mesh.position.set(d.bx, 0, d.bz);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.raycast = noRaycast;
    mesh.visible = shown.has(t);
    mesh.userData.tile = t.key;
    group.add(mesh);
    t.mesh = mesh;
    t.minH = d.minH;
    t.maxH = d.maxH;
    t.state = 'ready';
    // keep only what queries need; the typed arrays now belong to the GPU buffers
    t.data = { minH: d.minH, maxH: d.maxH, water: d.water };
    stats.built++;
  }

  return {
    materials,
    update(cam, groundY, now, force = false) {
      buildSome();
      // re-plan when the camera moved, after builds, or periodically
      const moved = cam.distanceToSquared(camPrev) > 4;
      if (force || moved || now - lastPlan > 0.25) {
        camPrev.copy(cam);
        lastPlan = now;
        plan(cam, groundY, now);
      }
    },
    receive,
    setQuality(q) {
      K = q.K ?? K;
      far = q.far ?? far;
      maxTiles = q.maxTiles ?? maxTiles;
      buildPerFrame = q.buildPerFrame ?? buildPerFrame;
      for (let l = 0; l < LEVELS; l++) materials[l].userData.lod.uMorph.value.set(...morphRange(l));
      lastPlan = -1;
    },
    stats() {
      let tri = 0;
      let vis = 0;
      for (const t of shown) {
        if (!t.mesh) continue;
        vis++;
        tri += t.mesh.geometry.index.count / 3;
      }
      stats.tiles = tiles.size;
      stats.shown = vis;
      stats.pending = pendingById.size;
      stats.triangles = tri;
      stats.queued = buildQueue.length;
      return { ...stats };
    },
    /** True while tiles are still loading around the camera. */
    get busy() {
      return pendingById.size > 0 || buildQueue.length > 0;
    },
    dispose() {
      for (const t of tiles.values()) disposeTile(t);
      tiles.clear();
      for (const m of materials) m.dispose();
      sharedIndex.dispose?.();
    },
  };
}

/**
 * Index buffer for a (cells × cells) grid + skirts. With `clip` ({x0, z0, step, E}),
 * cells entirely inside the hub square |x|, |z| ≤ E and skirt segments on edges
 * inside it are left out.
 */
function buildIndex(cells, clip) {
  const v = cells + 1;
  const nv = v * v;
  const idx = [];
  const inside = (x, z) => clip && Math.abs(x) <= clip.E + 1e-6 && Math.abs(z) <= clip.E + 1e-6;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (clip) {
        const x0 = clip.x0 + i * clip.step;
        const z0 = clip.z0 + j * clip.step;
        if (inside(x0, z0) && inside(x0 + clip.step, z0 + clip.step) && inside(x0 + clip.step, z0) && inside(x0, z0 + clip.step)) continue;
      }
      const a = j * v + i;
      const b = a + 1;
      const c = a + v;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // skirts: north (j = 0), south (j = cells), west (i = 0), east (i = cells)
  const edges = [
    { at: (t) => t, flip: false, pos: (t) => [t, 0] },
    { at: (t) => cells * v + t, flip: true, pos: (t) => [t, cells] },
    { at: (t) => t * v, flip: true, pos: (t) => [0, t] },
    { at: (t) => t * v + cells, flip: false, pos: (t) => [cells, t] },
  ];
  edges.forEach((e, ei) => {
    for (let t = 0; t < cells; t++) {
      if (clip) {
        const [i0, j0] = e.pos(t);
        const [i1, j1] = e.pos(t + 1);
        const xa = clip.x0 + i0 * clip.step;
        const za = clip.z0 + j0 * clip.step;
        const xb = clip.x0 + i1 * clip.step;
        const zb = clip.z0 + j1 * clip.step;
        if (inside(xa, za) && inside(xb, zb)) continue;
      }
      const p0 = e.at(t);
      const p1 = e.at(t + 1);
      const s0 = nv + ei * v + t;
      const s1 = s0 + 1;
      if (e.flip) idx.push(p0, s0, p1, p1, s0, s1);
      else idx.push(p0, p1, s0, p1, s1, s0);
    }
  });
  const total = nv + 4 * v;
  return new THREE.BufferAttribute(total > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
}
