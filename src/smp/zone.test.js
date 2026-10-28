import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_HALF, BUILD_BUFFER, borderDist, hubDist, standInBuildable, normBuildable, createZoneTracker, borderPosts } from './zone.js';

test('hub square distances', () => {
  assert.equal(borderDist(0, 0), -HUB_HALF);
  assert.equal(borderDist(1100, 0), 0);
  assert.equal(borderDist(-1200, 300), 100);
  assert.equal(hubDist(500, -500), 0);
  assert.equal(hubDist(300, -1350), 250);
});

test('stand-in build rules: safe zone, buffer, wilderness', () => {
  assert.equal(standInBuildable(-205, 318).reason, 'safe');
  const b = standInBuildable(1300, 0);
  assert.equal(b.reason, 'buffer');
  assert.equal(b.need, BUILD_BUFFER - 200);
  assert.equal(standInBuildable(0, -1700), null);
  // dev override: small hub, no buffer
  assert.equal(standInBuildable(-205, 318, { half: 150, buffer: 0 }), null);
  assert.equal(standInBuildable(100, 100, { half: 150, buffer: 0 }).reason, 'safe');
});

test('provider answers are normalised', () => {
  assert.equal(normBuildable({ ok: true }), null);
  assert.equal(normBuildable(true), null);
  assert.equal(normBuildable(undefined), null);
  assert.deepEqual(normBuildable({ ok: false, reason: 'highway' }), { ok: false, reason: 'highway' });
  assert.equal(normBuildable(false).reason, 'invalid');
  assert.equal(normBuildable({ reason: 'poi' }).reason, 'poi');
});

test('zone tracker: hysteresis + crossings', () => {
  const zt = createZoneTracker({ buffer: 500, warn: 120, hyst: 10 });
  assert.equal(zt.update(-600).kind, 'safe');
  assert.equal(zt.update(-60).kind, 'leaving');
  let s = zt.update(5); // inside the hysteresis band: still safe
  assert.equal(s.kind, 'leaving');
  assert.equal(s.crossed, 0);
  s = zt.update(15);
  assert.equal(s.crossed, -1, 'left the hub');
  assert.equal(s.kind, 'buffer');
  assert.equal(zt.update(-5).crossed, 0, 'no flapping at the border');
  assert.equal(zt.update(700).kind, 'wild');
  s = zt.update(-20);
  assert.equal(s.crossed, 1, 'entered the hub');
  assert.equal(s.kind, 'leaving');
});

test('border posts: evenly spaced on the square, corners once', () => {
  const posts = borderPosts(1100, 110);
  assert.equal(posts.length, 80);
  const keys = new Set(posts.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`));
  assert.equal(keys.size, posts.length, 'no duplicates');
  for (const [x, z] of posts) assert.ok(Math.abs(Math.max(Math.abs(x), Math.abs(z)) - 1100) < 1e-6);
  for (const c of ['-1100.0,-1100.0', '1100.0,-1100.0', '1100.0,1100.0', '-1100.0,1100.0']) assert.ok(keys.has(c), c);
});
