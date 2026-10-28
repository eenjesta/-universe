// The seam against the REAL hub heightfield (src/world/terrain/heightfield.js, baked in Node ~3 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeTerrain, sampleGrid } from '../../src/world/terrain/heightfield.js';
import { createWorldgen } from './index.js';

const data = await bakeTerrain({});
const hubH = (x, z) => sampleGrid(data.heights, x, z);
const wg = createWorldgen({ seed: 'o-universe', hub: { heightAt: hubH, isWater: (x, z) => hubH(x, z) < -0.3, radius: 1100, blend: 300 } });

test('real hub: identical inside, C0 across the border, smooth blend band', () => {
  let worst = 0;
  for (let s = -1199; s <= 1199; s += 3.7) {
    for (const [x, z, dx, dz] of [[s, 1200, 0, 1], [s, -1200, 0, -1], [1200, s, 1, 0], [-1200, s, -1, 0]]) {
      assert.equal(wg.heightAt(x, z), hubH(x, z));
      assert.equal(wg.heightAt(x - dx * 50, z - dz * 50), hubH(x - dx * 50, z - dz * 50));
      // one step across the seam: no larger than the hub's own steepest 0.5 m steps (cliffs) allow
      const step = Math.abs(wg.heightAt(x + dx * 0.5, z + dz * 0.5) - wg.heightAt(x, z));
      const own = Math.abs(hubH(x, z) - hubH(x - dx * 0.5, z - dz * 0.5));
      worst = Math.max(worst, step - own);
    }
  }
  assert.ok(worst < 0.8, `seam step beyond the hub's own slope: ${worst.toFixed(3)} m`);
});

test('real hub: highway gates on land at hub passes, roads leave the hub', () => {
  assert.ok(wg.highways.length >= 6);
  for (const r of wg.highways) {
    assert.ok(r.gate && hubH(r.gate.x, r.gate.z) > 1, `${r.id} gate on land`);
    const p = r.points;
    const end = Math.max(Math.abs(p[p.length - 3]), Math.abs(p[p.length - 1]));
    assert.ok(end > 4000, `${r.id} reaches ${end.toFixed(0)} m out`);
  }
});

test('real hub: north is open sea beyond the border, west/east/south are land', () => {
  const water = (x0, z0) => {
    let w = 0;
    for (let i = 0; i < 100; i++) if (wg.isWater(x0 + (i % 10) * 90, z0 + Math.floor(i / 10) * 90)) w++;
    return w;
  };
  assert.ok(water(0, -3000) > 80, 'north sea');
  assert.ok(water(-3500, 0) < 30, 'west land');
  assert.ok(water(3500, 600) < 40, 'east land');
  assert.ok(water(0, 3500) < 30, 'south land');
});

test('real hub: highways ride natural shoulders (spurs / cuttings), never walls beside the road', () => {
  const grad = (f, x, z) => Math.hypot(f(x + 1, z) - f(x - 1, z), f(x, z + 1) - f(x, z - 1)) / 2;
  const base = (x, z) => wg._base(x, z);
  let worst = 0;
  let where = '';
  for (const r of wg.highways) {
    const p = r.points;
    for (let i = 3; i + 5 < p.length; i += 9) {
      const x = p[i];
      const z = p[i + 2];
      if (Math.max(Math.abs(x), Math.abs(z)) < 1260) continue;
      const tl = Math.hypot(p[i + 3] - p[i - 3], p[i + 5] - p[i - 1]) || 1;
      const nx = -(p[i + 5] - p[i - 1]) / tl;
      const nz = (p[i + 3] - p[i - 3]) / tl;
      for (const s of [-1, 1]) {
        for (let d = 24; d <= 120; d += 8) {
          const qx = x + nx * d * s;
          const qz = z + nz * d * s;
          if (wg.highwayDistance(qx, qz, 200) < 22) continue; // another stretch of road
          // the first 40 m past the hub mesh fade into the hub's own (exact) heights; gates are carved hub-side
          if (Math.max(Math.abs(qx), Math.abs(qz)) < 1240) continue;
          // a cutting on a steep mountainside may be steep; an embankment wall (60 m fill, gradient 4–5) may not
          const excess = grad(wg.heightAt, qx, qz) - Math.max(2.0, 1.3 * grad(base, qx, qz) + 0.8);
          if (excess > worst) {
            worst = excess;
            where = `${r.id} @ ${qx.toFixed(0)}, ${qz.toFixed(0)} (fill ${(p[i + 1] - base(x, z)).toFixed(1)} m)`;
          }
        }
      }
    }
  }
  assert.ok(worst <= 0, `road-side slope ${worst.toFixed(2)} steeper than the terrain allows: ${where}`);
});
