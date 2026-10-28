import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HUB_HALF,
  hubDist,
  inHubSquare,
  hubBorderPoint,
  travelOptions,
  hintContext,
  hintKeys,
  toScreen,
  toWorld,
  zoomAround,
  clampCenter,
  niceLength,
  viewBounds,
  declutter,
  discoveryHit,
  rememberPoi,
  DISCOVERY,
  bearingDeg,
  formatWait,
  fitView,
} from '../logic.js';

test('hub square, distance and border point', () => {
  assert.equal(hubDist(0, 0), 0);
  assert.equal(hubDist(HUB_HALF, -300), 0);
  assert.equal(hubDist(1800, 300), 700);
  assert.equal(hubDist(-200, -2600), 1500);
  assert.ok(inHubSquare(1099, -1099));
  assert.ok(!inHubSquare(1101, 0));
  assert.deepEqual(hubBorderPoint(5000, 300), { x: HUB_HALF, z: 300 });
  assert.deepEqual(hubBorderPoint(-4000, -9000), { x: -HUB_HALF, z: -HUB_HALF });
  assert.deepEqual(hubBorderPoint(10, 20), { x: 10, z: 20 });
});

const base = { net: 'local', mode: 'explore', inHub: true, dead: false, hasClaim: false, hasBeacon: false, channel: false, now: 100, cooldownUntil: 0, combatUntil: 0 };

test('travel: the hub Gateway only inside the hub, base/beacon need a claim/beacon', () => {
  let o = travelOptions(base);
  assert.equal(o.gateway.wild.ok, true);
  assert.equal(o.gateway.base.reason, 'noBase');
  assert.equal(o.gateway.beacon.reason, 'noBeacon');
  assert.equal(o.hub.reason, 'here');
  assert.equal(o.zones.ok, true);
  o = travelOptions({ ...base, hasClaim: true, hasBeacon: true });
  assert.ok(o.gateway.base.ok && o.gateway.beacon.ok);
  o = travelOptions({ ...base, inHub: false, hasClaim: true });
  assert.equal(o.gateway.wild.reason, 'gateway');
  assert.equal(o.gateway.base.reason, 'gateway');
  assert.equal(o.zones.ok, false, 'no hub fast travel from the wilderness');
  assert.equal(o.zones.reason, 'leaveWild');
  assert.equal(o.hub.ok, true);
});

test('travel: return to hub respects combat lock, cooldown, channel, death and mode', () => {
  const wild = { ...base, inHub: false };
  assert.deepEqual(travelOptions({ ...wild, combatUntil: 104.2 }).hub, { ok: false, reason: 'combat', wait: 5 });
  assert.deepEqual(travelOptions({ ...wild, cooldownUntil: 160 }).hub, { ok: false, reason: 'cooldown', wait: 60 });
  assert.equal(travelOptions({ ...wild, channel: true }).hub.reason, 'busy');
  assert.equal(travelOptions({ ...wild, dead: true }).hub.reason, 'dead');
  assert.equal(travelOptions({ ...wild, mode: 'space' }).hub.reason, 'planet');
  assert.equal(travelOptions({ ...wild, mode: 'drive' }).hub.ok, true);
  // without a server there is no Gateway, but "return to hub" still works (single-player fallback)
  const off = travelOptions({ ...wild, net: 'off' });
  assert.equal(off.hub.ok, true);
  assert.equal(travelOptions({ ...base, net: 'off' }).gateway.wild.reason, 'offline');
});

test('key hints follow the context', () => {
  assert.equal(hintContext({ mode: 'explore', inHub: true }), 'hub');
  assert.equal(hintContext({ mode: 'explore', inHub: false }), 'wild');
  assert.equal(hintContext({ mode: 'explore', inHub: false, armed: true }), 'armed');
  assert.equal(hintContext({ mode: 'explore', building: true }), 'none');
  assert.equal(hintContext({ mode: 'drive' }), 'none');
  assert.equal(hintContext({ mode: 'explore', touch: true }), 'none');
  const hub = hintKeys('hub').map((h) => h.k);
  assert.ok(!hub.includes('B'), 'no Build hint in the safe zone');
  assert.ok(hub.includes('M') && hub.includes('V'));
  const wild = hintKeys('wild', { firstPerson: true });
  assert.ok(wild.some((h) => h.k === 'B') && wild.some((h) => h.k === 'I') && wild.some((h) => h.k === 'U'));
  assert.equal(wild.find((h) => h.k === 'V').t, 'third');
  assert.ok(hintKeys('armed').some((h) => h.k === 'R'));
  assert.ok(!hintKeys('wild', { hasInventory: false, canBuild: false }).some((h) => h.k === 'I' || h.k === 'B'));
  assert.ok(!hintKeys('wild', { buildHere: false }).some((h) => h.k === 'B'), 'no Build hint in the no-build buffer');
  assert.ok(!hintKeys('wild', { cameraKnown: true }).some((h) => h.k === 'V'), 'the V hint retires once used');
  assert.ok(!hintKeys('hub', { cameraKnown: true }).some((h) => h.k === 'V'));
  const armed = hintKeys('armed').map((h) => h.k);
  assert.ok(armed.includes('Z') && armed.includes('Q') && armed.includes('V'));
  assert.deepEqual(hintKeys('none'), []);
});

test('map view: screen/world round trip and zoom around an anchor', () => {
  const v = { cx: 1800, cz: 300, ppm: 0.5, vw: 1000, vh: 600 };
  const s = toScreen(v, 2000, 100);
  assert.deepEqual(s, [600, 200]);
  assert.deepEqual(toWorld(v, s[0], s[1]), [2000, 100]);
  const before = toWorld(v, 120, 80);
  zoomAround(v, 2, 120, 80);
  const after = toWorld(v, 120, 80);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
  assert.equal(v.ppm, 1);
  zoomAround(v, 100);
  assert.equal(v.ppm, 3, 'clamped to the max');
  zoomAround(v, 1e-6);
  assert.equal(v.ppm, 0.02, 'clamped to the min');
  clampCenter(v, 1000);
  assert.ok(Math.abs(v.cx) <= 1000 && Math.abs(v.cz) <= 1000);
  const b = viewBounds({ cx: 0, cz: 0, ppm: 1, vw: 200, vh: 100 }, 10);
  assert.deepEqual(b, { x0: -110, z0: -60, x1: 110, z1: 60 });
});

test('map view: fitting a box into the overlay-free area', () => {
  const v = { cx: 0, cz: 0, ppm: 1, vw: 1000, vh: 600 };
  const ins = { l: 40, r: 80, t: 120, b: 60 };
  fitView(v, 1000, 0, 3000, 1000, ins, 0.02, 3);
  // the box fills the free width (880 px for 2000 m) or height (420 px for 1000 m), whichever is tighter
  assert.ok(Math.abs(v.ppm - 0.42) < 1e-9);
  // the box centre lands in the centre of the free area
  const c = toScreen(v, 2000, 500);
  assert.ok(Math.abs(c[0] - (40 + 880 / 2)) < 1e-6 && Math.abs(c[1] - (120 + 420 / 2)) < 1e-6);
  // corners stay inside the free area
  const a = toScreen(v, 1000, 0);
  const b = toScreen(v, 3000, 1000);
  assert.ok(a[0] >= 40 - 1e-6 && a[1] >= 120 - 1e-6 && b[0] <= 920 + 1e-6 && b[1] <= 540 + 1e-6);
  fitView(v, 0, 0, 1, 1, ins, 0.02, 0.6);
  assert.equal(v.ppm, 0.6, 'zoom clamped');
});

test('scale bar picks nice lengths', () => {
  assert.equal(niceLength(1, 190), 100);
  assert.equal(niceLength(0.05, 190), 2500);
  assert.equal(niceLength(0.02, 190), 5000);
  assert.equal(niceLength(3, 190), 50);
});

test('declutter keeps the highest priority items', () => {
  const kept = declutter(
    [
      { id: 'a', x: 10, p: 1 },
      { id: 'b', x: 14, p: 5 },
      { id: 'c', x: 40, p: 1 },
      { id: 'd', x: 43, p: 1 },
    ],
    8,
  );
  assert.deepEqual(kept.map((k) => k.id).sort(), ['b', 'c']);
});

test('POI discovery radius and remembered list', () => {
  const poi = { id: 'p:2:0', type: 'ruin', x: 2400, z: 300, radius: 26 };
  assert.ok(discoveryHit(poi, 2400 + 26 + DISCOVERY.enter - 1, 300));
  assert.ok(!discoveryHit(poi, 2400 + 26 + DISCOVERY.enter + 2, 300));
  let list = rememberPoi([], poi);
  assert.deepEqual(list, [['p:2:0', 'ruin', 2400, 300]]);
  assert.equal(rememberPoi(list, poi), list, 'no duplicates');
  for (let i = 0; i < 5; i++) list = rememberPoi(list, { id: `p:${i}:9`, type: 'wreck', x: i, z: 9 }, 3);
  assert.equal(list.length, 3);
  assert.equal(list[2][0], 'p:4:9');
});

test('bearings and waits', () => {
  assert.equal(Math.round(bearingDeg(0, 0, 0, -10)), 0);
  assert.equal(Math.round(bearingDeg(0, 0, 10, 0)), 90);
  assert.equal(Math.round(bearingDeg(0, 0, 0, 10)), 180);
  assert.equal(Math.round(bearingDeg(0, 0, -10, 0)), 270);
  assert.equal(formatWait(4.2), '5 s');
  assert.equal(formatWait(65), '1:05');
});
