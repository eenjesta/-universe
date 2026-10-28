// node --test src/combat/ — every procedural combat mesh builds (weapons, drone, stalker) and is sane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { weaponGeometries, weaponIcon } from './models.js';
import { droneGeometry, stalkerGeometries } from './enemies.js';

const ok = (g, name) => {
  assert.ok(g && g.attributes.position.count > 0, `${name}: no vertices`);
  assert.ok(g.index, `${name}: not indexed`);
  for (const k of ['position', 'normal', 'color', 'aEmit']) assert.ok(g.attributes[k], `${name}: missing ${k}`);
  const a = g.attributes.position.array;
  for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${name}: NaN position`);
  const e = g.attributes.aEmit.array;
  let max = 0;
  for (let i = 0; i < e.length; i++) max = Math.max(max, e[i]);
  assert.ok(max <= 50, `${name}: emissive ${max} too hot`);
  return g.attributes.position.count;
};

test('weapon geometries build for every weapon', () => {
  for (const id of ['pulse-pistol', 'plasma-rifle', 'railgun', 'shock-grenade']) {
    const g = weaponGeometries(id);
    assert.ok(g.muzzle, `${id}: muzzle`);
    let n = 0;
    for (const k of ['body', 'panel', 'accent', 'accent2', 'charge']) if (g[k]) n += g[k].attributes.position.count;
    assert.ok(n > 50, `${id}: ${n} vertices`);
    assert.match(weaponIcon(id), /<svg/);
  }
});

test('drone + stalker geometries build (instanced parts)', () => {
  const d = ok(droneGeometry(), 'drone');
  assert.ok(d < 20000, `drone ${d} vertices`);
  const s = stalkerGeometries();
  let total = 0;
  for (const [k, g] of Object.entries(s)) total += ok(g, `stalker.${k}`);
  assert.ok(total < 30000, `stalker ${total} vertices`);
});
