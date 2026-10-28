// node --test src/combat/ — the sim's POI cover (shared/sim/los.js) must match the frontier's POI models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { poiCoverLocal, poiCover, segCover } from '../../shared/sim/los.js';
import { createPoiLibrary } from '../frontier/models.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('outpost cover mirrors the frontier model: huts at the same spots, sizes and headings', () => {
  const lib = createPoiLibrary();
  for (const v of [0, 1, 2]) {
    const model = lib.get('outpost', v);
    const huts = model.colliders.filter((c) => near(c.h, 3.2));
    const cover = poiCoverLocal('outpost', v);
    assert.ok(huts.length >= 2, `variant ${v}: huts in the model`);
    for (let i = 0; i < huts.length; i++) {
      const h = huts[i];
      const c = cover[i];
      assert.ok(near(c[0], h.x) && near(c[2], h.z), `variant ${v} hut ${i} position`);
      assert.ok(near(c[3] * 2, h.w) && near(c[5] * 2, h.d), `variant ${v} hut ${i} size`);
      assert.ok(near(c[6], h.rotY), `variant ${v} hut ${i} heading`);
    }
    // palisade panels on the ring, crates / barrels inside it
    const pr = 17 + v * 2;
    const panels = cover.filter((b) => near(b[3], 2.1) && near(b[5], 0.12));
    assert.ok(panels.length >= 12 && panels.length <= 24, `variant ${v}: ${panels.length} palisade panels`);
    for (const b of panels) assert.ok(near(Math.hypot(b[0], b[2]), pr, 1e-6));
    assert.equal(cover.filter((b) => b[1] < 1 && b[4] <= 0.6).length, 8, 'eight crates / barrels');
  }
  lib.dispose();
});

test('cover blocks lines through walls (not over them, not from inside a hut)', () => {
  const poi = { type: 'outpost', variant: 0, x: 100, y: 20, z: -50, rot: 0.7 };
  const boxes = poiCover(poi);
  const L = poiCoverLocal('outpost', 0);
  // hut 0 in world space
  const c = Math.cos(poi.rot);
  const s = Math.sin(poi.rot);
  const hx = poi.x + L[0][0] * c + L[0][2] * s;
  const hz = poi.z - L[0][0] * s + L[0][2] * c;
  const y = poi.y - 0.05 + 1.3;
  // a line straight through the hut's centre at chest height is blocked
  const t = segCover(hx - 6, y, hz - 6, hx + 6, y, hz + 6, boxes);
  assert.ok(t > 0 && t < 1, `blocked (${t})`);
  // 3 m above the roof is clear
  assert.equal(segCover(hx - 6, y + 4, hz - 6, hx + 6, y + 4, hz + 6, boxes), -1);
  // standing inside the hut: not hidden by it
  assert.equal(segCover(hx, y, hz, hx + 30, y + 30, hz + 30, boxes), -1);
});
