// node --test src/frontier/ — streamed vegetation must be stable: the same trees at the same
// places whatever the load order, slot churn (swap-remove) or density of the forest.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DynamicScatter, posHash } from './scatter.js';
import { createWorldgen } from '../../shared/worldgen/index.js';

const CHUNK = 64;
const wg = createWorldgen({ seed: 'o-universe' });
const geo = new THREE.BoxGeometry(1, 1, 1);
const mat = new THREE.MeshBasicMaterial();

/** One layer for every tree of the planet (variant ignored) + a detail-like chunk streamer. */
function stream({ capacity = 256, nearCap = 64, vegRadius = 600, nearRadius = 120, order = 1 }) {
  const parent = new THREE.Group();
  const layer = new DynamicScatter({ name: 't', parent, capacity, maxCapacity: 65536, near: { geometry: geo, material: mat, radius: nearRadius, capacity: nearCap }, far: { geometry: geo, material: mat, radius: vegRadius } });
  const loaded = new Map();
  const cache = new Map();
  const treesOf = (i, j) => {
    const k = `${i},${j}`;
    if (!cache.has(k)) {
      const arr = [];
      for (const f of wg.features(i, j)) if (f.type === 'tree') arr.push(f.x, f.y, f.z, f.rot, f.scale, 1, 1, 1);
      cache.set(k, Float32Array.from(arr));
    }
    return cache.get(k);
  };
  return {
    layer,
    moveTo(x, z) {
      const want = [];
      const R = vegRadius + 128;
      for (let j = Math.floor((z - R) / CHUNK); j <= Math.floor((z + R) / CHUNK); j++)
        for (let i = Math.floor((x - R) / CHUNK); i <= Math.floor((x + R) / CHUNK); i++) {
          const dx = Math.max(i * CHUNK - x, 0, x - (i + 1) * CHUNK);
          const dz = Math.max(j * CHUNK - z, 0, z - (j + 1) * CHUNK);
          if (Math.hypot(dx, dz) <= R) want.push(`${i},${j}`);
        }
      const keep = new Set(want);
      for (const k of [...loaded.keys()]) if (!keep.has(k)) (layer.remove(k), loaded.delete(k));
      if (order < 0) want.reverse();
      for (const k of want)
        if (!loaded.has(k)) {
          const [i, j] = k.split(',').map(Number);
          layer.add(k, treesOf(i, j));
          loaded.set(k, true);
        }
      layer.update({ x, z });
    },
    /** What the GPU would draw within r of (x, z): 'n|f:x,z' per tree (near mesh ∪ far mesh). */
    visible(x, z, r) {
      const out = new Set();
      const nm = layer.near.instanceMatrix.array;
      for (let n = 0; n < layer.near.count; n++) {
        const px = nm[n * 16 + 12];
        const pz = nm[n * 16 + 14];
        if (Math.hypot(px - x, pz - z) <= r) out.add(`n:${px},${pz}`);
      }
      const m = layer.matrices;
      for (let i = 0; i < layer.count; i++) {
        const px = m[i * 16 + 12];
        const pz = m[i * 16 + 14];
        if (Math.hypot(px - x, pz - z) > Math.min(r, layer.farRadius)) continue;
        if (!layer.inNear(i, layer.center.x, layer.center.z)) out.add(`f:${px},${pz}`);
      }
      return out;
    },
  };
}

function expected(x, z, r) {
  const out = new Set();
  for (let j = Math.floor((z - r) / CHUNK); j <= Math.floor((z + r) / CHUNK); j++)
    for (let i = Math.floor((x - r) / CHUNK); i <= Math.floor((x + r) / CHUNK); i++)
      for (const f of wg.features(i, j)) if (f.type === 'tree' && Math.hypot(f.x - x, f.z - z) <= r) out.add(`${Math.fround(f.x)},${Math.fround(f.z)}`);
  return out;
}
const strip = (s) => new Set([...s].map((k) => k.slice(2)));

test('posHash is a stable [0, 1] hash of the float32 position', () => {
  const a = posHash(1234.5, -987.25);
  assert.equal(a, posHash(Math.fround(1234.5), Math.fround(-987.25)));
  assert.ok(a >= 0 && a <= 1);
  assert.notEqual(a, posHash(1234.5, -987.5));
});

test('dense jungle: every tree within the radius is drawn exactly once (capacity grows, no drops)', () => {
  // (-9000, 4000) is jungle: ~6.5 k trees within 700 m — far beyond the initial capacity of 256
  const s = stream({ capacity: 256, nearCap: 64 });
  for (let x = -9000; x <= -8400; x += 100) {
    s.moveTo(x, 4000);
    const vis = s.visible(x, 4000, 560);
    const want = expected(x, 4000, 560);
    const got = strip(vis);
    assert.equal(got.size, vis.size, `no tree drawn twice (near + far) at x=${x}`);
    let missing = 0;
    for (const k of want) if (!got.has(k)) missing++;
    assert.equal(missing, 0, `x=${x}: ${missing} of ${want.size} trees missing`);
    assert.equal(got.size, want.size, `x=${x}: no extra trees`);
  }
  assert.equal(s.layer.dropped, 0);
});

test('the near/far choice of a tree depends on its position only (not on its slot / load order)', () => {
  const a = stream({ order: 1 });
  const b = stream({ order: -1 });
  // fly both along the same path, b loading chunks in the opposite order (different slots)
  for (let x = -9000; x <= -8600; x += 50) {
    a.moveTo(x, 4000);
    b.moveTo(x, 4000);
    const va = a.visible(x, 4000, 560);
    const vb = b.visible(x, 4000, 560);
    assert.deepEqual([...va].sort(), [...vb].sort(), `x=${x}: same trees, same LOD`);
  }
});

test('flying: a tree visible in two consecutive frames keeps its place and its LOD unless it crossed the ring', () => {
  const s = stream({});
  let prev = null;
  let px = 0;
  for (let x = 2400; x <= 2800; x += 7) {
    s.moveTo(x, 300);
    const vis = s.visible(x, 300, 520);
    if (prev) {
      for (const k of prev) {
        const pos = k.slice(2);
        const [tx, tz] = pos.split(',').map(Number);
        const d = Math.hypot(tx - x, tz - 300);
        if (d > 500) continue; // left the compared disc
        // still drawn, at the same position
        assert.ok(vis.has(`n:${pos}`) || vis.has(`f:${pos}`), `tree ${pos} vanished at x=${x}`);
        // LOD changed only within the dithered near ring
        if (!vis.has(k)) assert.ok(Math.abs(d - 120) < 120 * 0.12 + 14, `tree ${pos} switched LOD at ${d.toFixed(0)} m`);
      }
    }
    prev = vis;
    px = x;
  }
  assert.ok(px > 2700);
});
