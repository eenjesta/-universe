// node --test src/combat/
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeapons, FALLBACK_WEAPONS, inSafeZone, inHub, HUB, pickWeaponTable, ENEMIES } from './weapon-data.js';
import {
  WeaponState,
  spreadDeg,
  spreadDir,
  raySphere,
  enemyVolumes,
  simulateArc,
  damageAngle,
  enemyState,
  mergeInv,
  ownedWeapons,
  readInv,
  assistPick,
  hpFrac,
} from './logic.js';

const W = normalizeWeapons(null);

test('fallback weapons follow PLATFORM §8', () => {
  assert.equal(W.list.length, 4);
  assert.equal(W.byId['pulse-pistol'].dmg, 14);
  assert.equal(W.byId['pulse-pistol'].mag, 12);
  assert.equal(W.byId['plasma-rifle'].auto, true);
  assert.equal(W.byId['plasma-rifle'].rate, 9);
  assert.equal(W.byId['plasma-rifle'].reserve, 120);
  assert.equal(W.byId.railgun.kind, 'charge');
  assert.equal(W.byId.railgun.charge, 0.4);
  assert.equal(W.byId['shock-grenade'].kind, 'throw');
  assert.equal(W.byId['shock-grenade'].carry, 3);
  assert.deepEqual(W.bySlot.map((d) => d.id), ['pulse-pistol', 'plasma-rifle', 'railgun', 'shock-grenade']);
});

test('normalizeWeapons merges a shared/defs table of any shape', () => {
  const asObject = { WEAPONS: { 'plasma-rifle': { dmg: 10, name: { en: 'Plasma Rifle', nl: 'Plasmageweer' }, slot: 1, mag: 30 } } };
  const a = normalizeWeapons(asObject);
  assert.equal(a.byId['plasma-rifle'].dmg, 10);
  assert.equal(a.byId['plasma-rifle'].mag, 30);
  assert.equal(a.byId['plasma-rifle'].reserve, 120); // fallback kept
  assert.equal(a.byId['pulse-pistol'].dmg, 14); // untouched fallback still there
  const asArray = normalizeWeapons([{ id: 'railgun', damage: 80, chargeTime: 0.5 }]);
  assert.equal(asArray.byId.railgun.dmg, 80);
  assert.equal(asArray.byId.railgun.charge, 0.5);
  assert.equal(asArray.byId.railgun.kind, 'charge');
  assert.ok(pickWeaponTable({ default: [{ id: 'x' }] }));
  assert.equal(pickWeaponTable({}), null);
  // every def has look values
  for (const d of a.list) assert.ok(Array.isArray(d.color) && d.color.length === 3, d.id);
  assert.equal(FALLBACK_WEAPONS.length, 4);
});

test('safe zones', () => {
  assert.equal(inSafeZone(360, -150), true); // plaza
  assert.equal(inSafeZone(0, 150), true); // overlook
  assert.equal(inSafeZone(470, 250), true); // spaceport apron
  assert.equal(inSafeZone(250, 95), false); // ruins
  assert.equal(inSafeZone(-640, -40), false); // jungle
  // §11: the whole hand-made hub is safe, the planet beyond it is not
  assert.equal(HUB.radius, 1100);
  assert.equal(inHub(250, 95), true);
  assert.equal(inHub(-1000, 300), true);
  assert.equal(inHub(1150, 0), false);
  assert.equal(inHub(900, 900), true); // the hub is a square (shared/defs/world.js)
  assert.equal(inHub(1050, -1101), false);
});

test('WeaponState: fire cooldown, magazine, reload', () => {
  const s = new WeaponState(W.byId['pulse-pistol']);
  assert.equal(s.mag, 12);
  assert.equal(s.fire(), true);
  assert.equal(s.mag, 11);
  assert.equal(s.fire(), false, 'cooldown 1/4 s');
  s.update(0.26);
  assert.equal(s.fire(), true);
  // empty the magazine
  for (let i = 0; i < 20; i++) {
    s.update(0.3);
    s.fire();
  }
  assert.equal(s.mag, 0);
  assert.equal(s.canFire, false);
  assert.equal(s.startReload(), true);
  assert.equal(s.reloading, true);
  assert.ok(s.reloadProgress < 0.01);
  let ev = null;
  for (let i = 0; i < 12 && !ev; i++) ev = s.update(0.1);
  assert.equal(ev, 'reloaded');
  assert.equal(s.mag, 12);
  assert.equal(s.reserve, 60 - 12);
  assert.equal(s.startReload(), false, 'full magazine');
});

test('WeaponState: railgun charges before it can fire', () => {
  const s = new WeaponState(W.byId.railgun);
  let ev = null;
  for (let i = 0; i < 3; i++) ev = s.update(0.1, true) || ev;
  assert.ok(s.charge > 0.7 && s.charge < 1);
  assert.equal(ev, null);
  ev = s.update(0.15, true);
  assert.equal(ev, 'charged');
  assert.equal(s.charge, 1);
  assert.equal(s.fire(), true);
  assert.equal(s.charge, 0);
  assert.equal(s.mag, 3);
  // releasing drains the charge
  s.update(2, true);
  s.update(0.1, false);
  assert.ok(s.charge < 1);
});

test('WeaponState: grenades count down the carried reserve; sync from server', () => {
  const g = new WeaponState(W.byId['shock-grenade']);
  assert.equal(g.rounds, 3);
  assert.equal(g.fire(), true);
  assert.equal(g.rounds, 2);
  g.sync(undefined, 1);
  assert.equal(g.rounds, 1);
  const r = new WeaponState(W.byId['plasma-rifle']);
  r.sync(7, 33);
  assert.equal(r.mag, 7);
  assert.equal(r.reserve, 33);
  assert.equal(r.known, true);
  r.sync(99, undefined);
  assert.equal(r.mag, 24, 'clamped to the magazine size');
});

test('spread: aiming tightens, moving / airborne / bloom widen', () => {
  const d = W.byId['plasma-rifle'];
  assert.equal(spreadDeg(d), 1.2);
  assert.ok(Math.abs(spreadDeg(d, { aiming: true }) - 0.4) < 1e-9);
  assert.ok(spreadDeg(d, { moving: 1 }) > 1.2);
  assert.ok(spreadDeg(d, { airborne: true }) > 2);
  assert.ok(spreadDeg(d, { bloom: 1 }) > spreadDeg(d));
});

test('spreadDir stays inside the cone and is unit length', () => {
  const d = { x: 0, y: 0, z: -1 };
  const out = { x: 0, y: 0, z: 0 };
  for (const [u1, u2] of [[0, 0], [1, 0], [1, 0.25], [0.5, 0.8], [0.99, 0.6]]) {
    spreadDir(d, 2, u1, u2, out);
    const len = Math.hypot(out.x, out.y, out.z);
    assert.ok(Math.abs(len - 1) < 1e-9);
    const ang = (Math.acos(-out.z) * 180) / Math.PI;
    assert.ok(ang <= 2.0001, `angle ${ang}`);
  }
  spreadDir({ x: 0, y: 1, z: 0 }, 3, 1, 0.3, out); // straight up (basis switch)
  assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < 1e-9);
});

test('raySphere', () => {
  assert.ok(Math.abs(raySphere(0, 0, 0, 0, 0, -1, 0, 0, -10, 1) - 9) < 1e-9);
  assert.equal(raySphere(0, 0, 0, 0, 0, -1, 0, 3, -10, 1), -1);
  assert.equal(raySphere(0, 0, 0, 0, 0, -1, 0, 0, 10, 1), -1, 'behind');
  assert.equal(raySphere(0, 0, 0, 0, 0, -1, 0, 0, 0, 1), 0, 'inside');
});

test('enemyVolumes follow the heading convention (forward = −sin h, −cos h)', () => {
  const out = new Float32Array(16);
  const n = enemyVolumes(ENEMIES.stalker.volumes, 10, 5, 20, 0, out);
  assert.equal(n, 3);
  const ahead = ENEMIES.stalker.volumes[1][0];
  // head (index 1) is `ahead` m in front = −Z for heading 0
  assert.ok(Math.abs(out[4] - 10) < 1e-6 && Math.abs(out[6] - (20 - ahead)) < 1e-5);
  enemyVolumes(ENEMIES.stalker.volumes, 0, 0, 0, Math.PI / 2, out); // facing west (−X)
  assert.ok(Math.abs(out[4] + ahead) < 1e-5 && Math.abs(out[6]) < 1e-5);
  // every stalker volume stays within the sim's capsule tolerance (r 0.7 + ~0.85 from the axis)
  for (const [fwd, , r] of ENEMIES.stalker.volumes) assert.ok(Math.abs(fwd) + r <= 1.55, `volume reaches ${Math.abs(fwd) + r} m`);
  // the head sits in the crit band (> 72 % of the 1.6 m capsule)
  assert.ok(ENEMIES.stalker.volumes[1][1] > 1.6 * 0.72);
});

test('simulateArc: falls, bounces, settles before the fuse', () => {
  const pts = new Float32Array(64 * 3);
  const r = simulateArc({ x: 0, y: 2, z: 0 }, { x: 0, y: 6, z: -12 }, { gravity: 18, bounce: 0.35, fuse: 3, ground: () => 0 }, pts, 64);
  assert.ok(r.n > 10);
  assert.ok(r.z < -10, `travelled ${r.z}`);
  assert.ok(r.y >= 0.1 - 1e-6);
  assert.ok(r.bounces >= 1);
  // the first point is the start
  assert.equal(pts[1], 2);
  // a slope: ground(x, z) = -z * 0.1 (rising toward −z) stops it earlier
  const r2 = simulateArc({ x: 0, y: 2, z: 0 }, { x: 0, y: 6, z: -12 }, { gravity: 18, fuse: 3, ground: (x, z) => -z * 0.5 }, pts, 64);
  assert.ok(r2.z > r.z);
});

test('damageAngle: ahead 0, right +90°, behind ±180°', () => {
  const yaw = 0; // camera looks north (−Z)
  assert.ok(Math.abs(damageAngle(yaw, 0, 0, 0, -10)) < 1e-9);
  assert.ok(Math.abs(damageAngle(yaw, 0, 0, 10, 0) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(damageAngle(yaw, 0, 0, 0, 10)) - Math.PI) < 1e-9);
  // camera yaw π/2 looks west (−X): a source in the west is ahead
  assert.ok(Math.abs(damageAngle(Math.PI / 2, 0, 0, -10, 0)) < 1e-9);
});

test('enemyState maps ints, strings and aliases', () => {
  assert.equal(enemyState(0), 'idle');
  assert.equal(enemyState(3), 'attack');
  // shared/protocol.js ES codes
  assert.equal(enemyState(4), 'leap');
  assert.equal(enemyState(5), 'stunned');
  assert.equal(enemyState(6), 'dead');
  assert.equal(enemyState(7), 'return');
  assert.equal(enemyState('Hunt'), 'chase');
  assert.equal(enemyState('shoot'), 'attack');
  assert.equal(enemyState('weird'), 'patrol');
  assert.equal(enemyState(undefined), 'idle');
});

test('inventory readers tolerate several shapes', () => {
  let inv = mergeInv(null, { t: 'inv', ammo: { pulse: 48, plasma: 80 }, mag: { 'pulse-pistol': 9 }, weapons: ['pulse-pistol', 'plasma-rifle'], slot: 0 });
  assert.deepEqual(readInv(inv, W.byId['pulse-pistol']), { mag: 9, reserve: 48 });
  assert.deepEqual(readInv(inv, W.byId['plasma-rifle']), { mag: undefined, reserve: 80 });
  inv = mergeInv(inv, { t: 'inv', patch: true, ammo: { pulse: 40 } });
  assert.equal(inv.ammo.pulse, 40);
  assert.equal(inv.ammo.plasma, 80, 'patch keeps the other keys');
  assert.deepEqual([...ownedWeapons(inv)], ['pulse-pistol', 'plasma-rifle']);
  const inv2 = { weapons: [{ id: 'railgun', mag: 2 }], items: { 'shock-grenade': 2 }, ammo: { 'railgun': 8 } };
  assert.deepEqual(readInv(inv2, W.byId.railgun), { mag: 2, reserve: 8 });
  assert.deepEqual(readInv(inv2, W.byId['shock-grenade']), { mag: undefined, reserve: 2 });
  assert.equal(ownedWeapons({}), null);
  // a full (non-patch) message replaces
  inv = mergeInv(inv, { t: 'inv', ammo: { rail: 4 } });
  assert.equal(inv.ammo.pulse, undefined);
});

test('assistPick prefers the target nearest to the ray inside the cone', () => {
  const c = new Float32Array([
    0.9, 0, -20, 0.8, // ~2.6° right
    5, 0, -20, 0.8, // ~14° right
    0, 0, 20, 0.8, // behind
  ]);
  assert.equal(assistPick(0, 0, 0, 0, 0, -1, c, 3, 4), 0);
  assert.equal(assistPick(0, 0, 0, 0, 0, -1, c, 3, 1), 0, 'radius slack widens the cone');
  assert.equal(assistPick(0, 0, 0, 1, 0, 0, c, 3, 4), -1);
  assert.equal(hpFrac(45, 90), 0.5);
  assert.equal(hpFrac(undefined, 90), 1);
});
