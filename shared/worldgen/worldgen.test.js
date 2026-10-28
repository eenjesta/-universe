// node --test shared/worldgen/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldgen, CHUNK_SIZE, BIOME_LIST, isSafe as moduleIsSafe, hubDist as moduleHubDist } from './index.js';

// a cheap synthetic hub: hills + a sea in the north, defined on ±1200 m like the real one
const hubHeight = (x, z) => {
  const cx = Math.max(-1200, Math.min(1200, x));
  const cz = Math.max(-1200, Math.min(1200, z));
  return 40 + 60 * Math.sin(cx * 0.004) * Math.cos(cz * 0.003) - 90 * Math.max(0, (-cz - 500) / 700);
};
const HUB = { heightAt: hubHeight, isWater: (x, z) => hubHeight(x, z) < -0.3, radius: 1100, blend: 300 };
const wg = createWorldgen({ seed: 'o-universe', hub: HUB });
const wg2 = createWorldgen({ seed: 'o-universe', hub: HUB });
const other = createWorldgen({ seed: 'another-seed', hub: HUB });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('deterministic per seed, different across seeds', () => {
  const r = rng(1);
  let diff = 0;
  for (let i = 0; i < 2000; i++) {
    const x = (r() - 0.5) * 60000;
    const z = (r() - 0.5) * 60000;
    assert.equal(wg.heightAt(x, z), wg2.heightAt(x, z));
    assert.equal(String(wg.biomeAt(x, z)), String(wg2.biomeAt(x, z)));
    if (Math.abs(wg.heightAt(x, z) - other.heightAt(x, z)) > 0.5) diff++;
  }
  assert.ok(diff > 1500, `other seed differs (${diff}/2000)`);
  assert.deepEqual(JSON.stringify(wg.chunk(40, -12).features), JSON.stringify(wg2.chunk(40, -12).features));
  assert.deepEqual(wg.highways.map((h) => Array.from(h.points)), wg2.highways.map((h) => Array.from(h.points)));
});

test('heights are finite everywhere, also far away', () => {
  for (const [x, z] of [[0, 150], [1250, 0], [0, -2600], [-5000, 7000], [31000, -27000], [89000, -89000], [1e5, 1e5], [-1e5, 3]]) {
    const h = wg.heightAt(x, z);
    assert.ok(Number.isFinite(h), `heightAt(${x}, ${z}) = ${h}`);
    assert.ok(h > -150 && h < 1200, `plausible height ${h} at ${x},${z}`);
  }
});

test('continuous: no jumps between neighbouring points (incl. the hub seam and 100 km out)', () => {
  const r = rng(7);
  let jumps = 0;
  let steep = 0;
  let n = 0;
  const probe = (x, z) => {
    for (const [dx, dz] of [[0.25, 0], [0, 0.25]]) {
      const h0 = wg.heightAt(x, z);
      const d1 = Math.abs(wg.heightAt(x + dx, z + dz) - h0);
      n++;
      if (d1 > 0.75) steep++; // > 72° over 25 cm
      if (d1 > 0.05) {
        // continuous ⇒ halving the step roughly halves the difference; a tear does not shrink
        const d2 = Math.abs(wg.heightAt(x + dx / 64, z + dz / 64) - h0);
        if (d2 > d1 * 0.25) jumps++;
      }
    }
  };
  for (let i = 0; i < 6000; i++) probe((r() - 0.5) * 30000, (r() - 0.5) * 30000);
  // across the hub mesh border (e = 0) and inside the blend band
  for (let i = 0; i < 2000; i++) {
    const s = (r() - 0.5) * 2400;
    const e = r() * 320 - 10;
    probe(1200 + e, s);
    probe(-1200 - e, s);
    probe(s, 1200 + e);
    probe(s, -1200 - e);
  }
  for (let i = 0; i < 1000; i++) probe(100000 + r() * 500, -100000 + r() * 500);
  assert.equal(jumps, 0, `discontinuities found: ${jumps}`);
  assert.ok(steep / n < 0.006, `near-vertical samples ${steep}/${n}`);
});

test('seam: hub heights inside the hub mesh, exact at the border', () => {
  for (let s = -1200; s <= 1200; s += 37) {
    for (const [x, z] of [[s, 1200], [s, -1200], [1200, s], [-1200, s], [s * 0.5, s * 0.3]]) {
      assert.equal(wg.heightAt(x, z), hubHeight(x, z));
    }
  }
  assert.equal(wg.isSafe(0, 0), true);
  assert.equal(wg.isSafe(1100, -1100), true);
  assert.equal(wg.isSafe(1101, 0), false);
  assert.equal(moduleIsSafe(500, 500), true);
  assert.equal(moduleIsSafe(-1150, 0), false);
  assert.equal(moduleHubDist(1600, 0), 500);
  assert.equal(String(wg.biomeAt(10, 10)), 'hub');
});

test('chunk grids are continuous across chunk borders and match heightAt', () => {
  for (const [cx, cz] of [[30, -5], [-40, 12], [19, 18], [-19, -18], [500, 500]]) {
    const a = wg.chunk(cx, cz, { features: false });
    const b = wg.chunk(cx + 1, cz, { features: false });
    const c = wg.chunk(cx, cz + 1, { features: false });
    const n = a.cells + 3;
    for (let j = 0; j < n; j++) {
      // a's column at x0 + 64 (i = cells + 1) is b's column at its x0 (i = 1)
      assert.equal(a.heights[j * n + a.cells + 1], b.heights[j * n + 1]);
      assert.equal(a.heights[(a.cells + 1) * n + j], c.heights[1 * n + j]);
    }
    assert.equal(a.heights[1 * n + 1], Math.fround(wg.heightAt(a.x0, a.z0)));
    const lo = wg.chunk(cx, cz, { lod: 2, features: false });
    assert.equal(lo.cells, 8);
    assert.equal(lo.heights[1 * 11 + 1], a.heights[1 * n + 1]);
  }
});

test('all biomes occur over a large sample, with smooth weights', () => {
  const counts = Object.fromEntries(BIOME_LIST.map((b) => [b.id, 0]));
  const N = 160;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -60000 + (i + 0.5) * (120000 / N);
      const z = -60000 + (j + 0.5) * (120000 / N);
      const b = wg.biomeAt(x, z);
      if (b.id === 'hub') continue;
      counts[b.id]++;
      const sum = Object.values(b.weights).reduce((s, v) => s + v, 0);
      assert.ok(Math.abs(sum - 1) < 0.02, `weights sum ${sum}`);
    }
  }
  const total = N * N;
  for (const [id, c] of Object.entries(counts)) assert.ok(c / total > 0.004, `biome ${id} covers ${((c / total) * 100).toFixed(2)} %`);
  // hub themes: jungle to the west, badlands to the east, ocean to the north
  const near = (x0, z0) => {
    const k = {};
    for (let i = 0; i < 400; i++) {
      const id = wg.biomeIdAt(x0 + ((i % 20) - 10) * 120, z0 + (Math.floor(i / 20) - 10) * 120);
      k[id] = (k[id] || 0) + 1;
    }
    return k;
  };
  assert.ok((near(-4200, 0).jungle || 0) > 150, `jungle west ${JSON.stringify(near(-4200, 0))}`);
  assert.ok((near(4000, -300).badlands || 0) > 120, `badlands east ${JSON.stringify(near(4000, -300))}`);
  assert.ok((near(1500, -4500).ocean || 0) > 300, `ocean north ${JSON.stringify(near(1500, -4500))}`);
});

test('resource nodes: stable ids, outside the safe zone + buffer, consistent with nodesNear', () => {
  let total = 0;
  const seen = new Set();
  for (let cz = -40; cz < 40; cz += 7) {
    for (let cx = -40; cx < 40; cx += 3) {
      const nodes = wg.chunk(cx, cz).features.filter((f) => f.type === 'node');
      for (const n of nodes) {
        assert.match(n.id, /^n:-?\d+:-?\d+:\d+$/);
        assert.ok(!seen.has(n.id));
        seen.add(n.id);
        assert.ok(wg.hubDist(n.x, n.z) >= 200, `node ${n.id} too close to the hub`);
        assert.ok(['metal', 'stone', 'wood', 'energy'].includes(n.resource));
        const near = wg.nodesNear(n.x, n.z, 1);
        assert.ok(near.some((m) => m.id === n.id && m.x === n.x && m.z === n.z), 'nodesNear finds the chunk node');
        total++;
      }
    }
  }
  assert.ok(total > 50, `nodes found: ${total}`);
  // a fresh generator agrees (server vs client)
  const n0 = wg.nodesNear(5000, 5000, 300);
  const n1 = createWorldgen({ seed: 'o-universe', hub: HUB }).nodesNear(5000, 5000, 300);
  assert.deepEqual(n0.map((n) => n.id), n1.map((n) => n.id));
});

test('POIs: spaced, stable ids, never near the hub, ruins / outposts / wrecks all occur', () => {
  const pois = wg.poisNear(0, 0, 22000);
  const types = {};
  for (const p of pois) {
    types[p.type] = (types[p.type] || 0) + 1;
    assert.match(p.id, /^p:-?\d+:-?\d+$/);
    assert.ok(wg.hubDist(p.x, p.z) >= 250, `${p.id} near hub`);
    assert.ok(p.y > 1);
    assert.ok(Math.abs(wg.heightAt(p.x, p.z) - p.y) < 0.6, 'pad is flat at the centre');
  }
  for (let i = 0; i < pois.length; i++) for (let j = i + 1; j < pois.length; j++) assert.ok(Math.hypot(pois[i].x - pois[j].x, pois[i].z - pois[j].z) >= 290);
  assert.ok(types.ruin > 5 && types.outpost > 5 && types.wreck > 5, JSON.stringify(types));
});

test('highways (§11.2): 6–8 roads from the hub border, flat paving, waystones every km', () => {
  const hw = wg.highways;
  assert.ok(hw.length >= 6 && hw.length <= 8, `${hw.length} highways`);
  for (const r of hw) {
    assert.ok(r.length > 4000, `${r.id} length ${r.length}`);
    const p = r.points;
    assert.ok(Math.abs(Math.max(Math.abs(p[0]), Math.abs(p[2])) - 1200) < 1, `${r.id} starts on the hub mesh border`);
    assert.ok(r.waystones.length >= 3, `${r.id} waystones ${r.waystones.length}`);
    for (let i = 0; i + 5 < p.length; i += 30) {
      const x = p[i];
      const z = p[i + 2];
      if (Math.max(Math.abs(x), Math.abs(z)) < 1240) continue;
      assert.ok(wg.isOnHighway(x, z), `${r.id} centre is on the highway`);
      assert.ok(Math.abs(wg.heightAt(x, z) - p[i + 1]) < 0.05, `${r.id} flattened to its profile`);
      assert.equal(wg.isBuildable(x + 12, z).ok, false);
    }
    // grade-limited profile
    for (let i = 3; i + 2 < p.length; i += 3) {
      const ds = Math.hypot(p[i] - p[i - 3], p[i + 2] - p[i - 1]);
      assert.ok(Math.abs(p[i + 1] - p[i - 2]) <= ds * 0.091 + 1e-6, `${r.id} grade`);
    }
  }
  const q = wg.roadsNear(hw[0].points[300], hw[0].points[302], 50);
  assert.ok(q.length >= 1 && q[0].id === hw[0].id && q[0].distance < 1);
});

test('highway distance is exact at any reach; POIs keep ≥ 150 m from the roads', () => {
  const brute = (x, z) => {
    let best = Infinity;
    for (const r of wg.highways) {
      const p = r.points;
      for (let i = 0; i + 5 < p.length; i += 3) {
        const vx = p[i + 3] - p[i];
        const vz = p[i + 5] - p[i + 2];
        const l2 = vx * vx + vz * vz || 1e-9;
        const t = Math.min(1, Math.max(0, ((x - p[i]) * vx + (z - p[i + 2]) * vz) / l2));
        best = Math.min(best, Math.hypot(x - p[i] - vx * t, z - p[i + 2] - vz * t));
      }
    }
    return best;
  };
  let s = 99;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const r0 = wg.highways[1].points;
  for (let k = 0; k < 300; k++) {
    const i = 3 * Math.floor(rnd() * (r0.length / 3));
    const x = r0[i] + (rnd() - 0.5) * 400;
    const z = r0[i + 2] + (rnd() - 0.5) * 400;
    const b = brute(x, z);
    const d = wg.highwayDistance(x, z, 160);
    if (b < 160) assert.ok(Math.abs(d - b) < 1e-6, `distance ${d} vs ${b}`);
    else assert.equal(d, Infinity);
  }
  const pois = wg.poisNear(0, 0, 9000);
  assert.ok(pois.length > 10);
  for (const p of pois) assert.ok(brute(p.x, p.z) >= 150, `${p.id} ${brute(p.x, p.z).toFixed(0)} m from a highway`);
  assert.deepEqual(wg.rules, { noBuild: 500, highwayClear: 20, poiClear: 60, heightLimitDist: 2000, heightLimit: 16 });
});

test('isBuildable: safe zone, 500 m buffer, highways, POIs', () => {
  assert.deepEqual(wg.isBuildable(0, 0), { ok: false, reason: 'safe' });
  assert.equal(wg.isBuildable(1400, 300).reason, 'hub');
  assert.equal(wg.isBuildable(-1550, 200).reason, 'hub');
  const p = wg.poisNear(0, 0, 20000).find((q) => wg.hubDist(q.x, q.z) > 600 && wg.highwayDistance(q.x, q.z, 200) > 150);
  assert.ok(p, 'a POI away from roads');
  assert.equal(wg.isBuildable(p.x + p.radius + 20, p.z).reason, 'poi');
  let ok = 0;
  for (let i = 0; i < 400; i++) if (wg.isBuildable(3000 + i * 37, -200 + (i % 20) * 97).ok) ok++;
  assert.ok(ok > 100, `buildable spots ${ok}`);
});

test('spawn rules: none in the safe zone + buffer, tables per biome, more at night', () => {
  assert.equal(wg.spawnRules(0, 0, 22), null);
  assert.equal(wg.spawnRules(1250, 0, 22), null);
  let day = 0;
  let night = 0;
  for (let i = 0; i < 200; i++) {
    const x = -9000 + i * 91;
    const z = 4000 - i * 13;
    const d = wg.spawnRules(x, z, 12);
    const n = wg.spawnRules(x, z, 23);
    if (d) day += d.density;
    if (n) night += n.density;
    if (n) for (const e of n.list) assert.ok(['drone', 'stalker'].includes(e.type));
  }
  assert.ok(night > day, `night ${night} > day ${day}`);
  assert.ok(wg.spawnTable('jungle', 23).some((e) => e.enemy === 'stalker'));
  assert.deepEqual(wg.spawnTable('ocean', 12), []);
});

test('worker export rebuilds an identical generator (beyond the hub mesh)', () => {
  // structured clone (postMessage) and JSON both work
  const w = createWorldgen(structuredClone(wg.exportForWorker()));
  const wj = createWorldgen(JSON.parse(JSON.stringify(wg.exportForWorker())));
  assert.equal(wj.heightAt(5000, -3000), wg.heightAt(5000, -3000));
  const r = rng(3);
  for (let i = 0; i < 3000; i++) {
    const x = (r() - 0.5) * 40000;
    const z = (r() - 0.5) * 40000;
    if (Math.max(Math.abs(x), Math.abs(z)) <= 1200) continue;
    assert.equal(w.heightAt(x, z), wg.heightAt(x, z));
  }
  assert.equal(JSON.stringify(w.chunk(-30, 22).features), JSON.stringify(wg.chunk(-30, 22).features));
  assert.equal(JSON.stringify(w.nodesNear(-2500, 1800, 400)), JSON.stringify(wg.nodesNear(-2500, 1800, 400)));
});

test('planets without a hub: a safe landing meadow at the origin', () => {
  const p = createWorldgen({ seed: 'kepler', planet: 'kepler-o7' });
  assert.equal(p.highways.length, 0);
  assert.equal(p.isSafe(0, 0), true);
  assert.equal(p.spawnRules(50, 50, 23), null);
  const h = p.heightAt(0, 0);
  assert.ok(h > 1 && h < 60, `landing height ${h}`);
});

test('speed: heightAt and chunk(…) budgets', () => {
  const r = rng(11);
  const xs = new Float64Array(200000);
  for (let i = 0; i < xs.length; i++) xs[i] = (r() - 0.5) * 40000;
  let acc = 0;
  for (let i = 0; i < 20000; i++) acc += wg.heightAt(xs[i], xs[(i + 7) % xs.length]);
  const t0 = performance.now();
  for (let i = 0; i < xs.length; i++) acc += wg.heightAt(xs[i], xs[(i * 7 + 3) % xs.length]);
  const us = ((performance.now() - t0) / xs.length) * 1000;
  for (let i = 0; i < 4; i++) wg.chunk(200 + i, 90);
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) wg.chunk(100 + (i % 5), -70 - Math.floor(i / 5));
  const ms = (performance.now() - t1) / 20;
  console.log(`# heightAt ${us.toFixed(2)} µs avg · chunk(64 m, lod 0, features) ${ms.toFixed(2)} ms · (acc ${acc > 0})`);
  // generous ceilings: the shared CI machine is often heavily loaded (targets: 2 µs / 4 ms idle)
  assert.ok(us < 15, `heightAt ${us} µs`);
  assert.ok(ms < 60, `chunk ${ms} ms`);
});

test('CHUNK_SIZE and provider shape the sim expects', () => {
  assert.equal(CHUNK_SIZE, 64);
  assert.equal(wg.CHUNK_SIZE, 64);
  for (const k of ['heightAt', 'isWater', 'isSafe', 'biomeAt', 'spawnRules', 'spawnTable', 'nodesNear', 'chunk', 'isBuildable', 'poisNear', 'roadsNear', 'isOnHighway', 'describe', 'normalAt']) {
    assert.equal(typeof wg[k], 'function', k);
  }
  const d = wg.describe(3000, 2000);
  assert.ok(d.text && d.biome.id && Number.isFinite(d.height));
  const n = wg.normalAt(3000, 2000);
  assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9);
});
