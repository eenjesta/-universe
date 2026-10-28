import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './_testkit.js';
import { C, S, NET } from '../protocol.js';
import { WEAPONS } from '../defs/weapons.js';

const EYE = 1.45;

/** A frozen drone at (x, y, z) that we move by hand. */
function drone(k, x, y, z) {
  const e = k.W.enemiesSys.create('drone', x, z, null);
  e.ai = false;
  e.x = x;
  e.y = y;
  e.z = z;
  e.hist.fill(0);
  e.hn = 0;
  return e;
}

function shoot(k, id, p, target, { seq, w = 'pulse-pistol', vt, ct, aim } = {}) {
  const o = [p.x, p.y + EYE, p.z];
  const a = aim || [target[0], target[1], target[2]];
  const d = [a[0] - o[0], a[1] - o[1], a[2] - o[2]];
  const fired = k.send(id, { t: C.FIRE, w, o, d, seq, ct: ct ?? k.clock.t, vt });
  return { fired, o, d };
}

test('hitscan hit at the current position is accepted and damages the enemy', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const e = drone(k, 0, 18, 2880);
  k.run(0.2);
  k.clear();
  const { fired } = shoot(k, 'p1', p, [e.x, e.y, e.z], { seq: 1, vt: k.clock.t });
  assert.equal(fired, true);
  assert.equal(k.of(S.FIRED).length, 1);
  assert.equal(k.send('p1', { t: C.HIT, seq: 1, target: e.id, at: [e.x, e.y, e.z + 0.6] }), true);
  const dmg = k.of(S.DAMAGE, 'p1');
  assert.equal(dmg.length, 1);
  assert.equal(dmg[0].target, e.id);
  assert.equal(dmg[0].amount, WEAPONS['pulse-pistol'].dmg);
  assert.equal(e.hp, 60 - 14);
  // the same shot can't hit twice
  assert.equal(k.send('p1', { t: C.HIT, seq: 1, target: e.id, at: [e.x, e.y, e.z] }), false);
  assert.equal(p.inv.mag['pulse-pistol'], 11);
});

test('lag compensation: hits on the rewound position are accepted, stale ones rejected', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const e = drone(k, -10, 18, 2870);
  // the drone flies +x at 9 m/s; history at 20 Hz
  for (let i = 0; i < 20; i++) {
    e.x += 9 * 0.05;
    k.run(0.05);
  }
  const now = k.clock.t;
  const old = [0, 0, 0];
  k.W.enemiesSys.posAt(e, now - 300, old);
  assert.ok(Math.abs(e.x - old[0] - 2.7) < 0.05, 'history interpolation');
  k.clear();
  // client saw the drone 300 ms ago (vt) → accepted
  shoot(k, 'p1', p, old, { seq: 2, vt: now - 300 });
  assert.equal(k.send('p1', { t: C.HIT, seq: 2, target: e.id, at: old }), true);
  // same claim without rewind (vt = now): the drone is 2.7 m further → miss
  k.wait(300);
  shoot(k, 'p1', p, old, { seq: 3, vt: k.clock.t });
  assert.equal(k.send('p1', { t: C.HIT, seq: 3, target: e.id, at: old }), false);
  assert.equal(k.lastDeny('p1').reason, 'miss');
});

test('rewind is clamped to NET.LAG_COMP_MS', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const e = drone(k, -20, 18, 2870);
  for (let i = 0; i < 40; i++) {
    e.x += 9 * 0.05;
    k.run(0.05);
  }
  const now = k.clock.t;
  const veryOld = [e.x - 9 * 1.2, e.y, e.z]; // where it was 1.2 s ago
  shoot(k, 'p1', p, veryOld, { seq: 4, vt: now - 1200 });
  assert.equal(k.send('p1', { t: C.HIT, seq: 4, target: e.id, at: veryOld }), false);
  const atLimit = [0, 0, 0];
  k.W.enemiesSys.posAt(e, now - NET.LAG_COMP_MS, atLimit);
  shoot(k, 'p1', p, atLimit, { seq: 5, vt: now - 1200 });
  k.wait(260); // rate of fire
  assert.equal(k.send('p1', { t: C.HIT, seq: 5, target: e.id, at: atLimit }), true);
});

test('clock offset estimate from ct when vt is missing', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const e = drone(k, -10, 18, 2870);
  for (let i = 0; i < 20; i++) {
    e.x += 9 * 0.05;
    k.run(0.05);
  }
  // client clock is 5 s behind the server, latency ~0: tView = ct + ofs − INTERP_DELAY
  const now = k.clock.t;
  const seen = [0, 0, 0];
  k.W.enemiesSys.posAt(e, now - NET.INTERP_DELAY_MS, seen);
  shoot(k, 'p1', p, seen, { seq: 6, ct: now - 5000 });
  assert.equal(k.send('p1', { t: C.HIT, seq: 6, target: e.id, at: seen }), true);
});

test('range, spread cone and terrain line of sight', () => {
  // a 30 m high wall at z ∈ [2880, 2884]
  const H = (x, z) => (z > 2880 && z < 2884 ? 40 : 10);
  const k = makeSim({ H });
  const { p } = k.join('p1', 0, 2900);
  const far = drone(k, 0, 12, 2830); // 70 m: beyond the pistol's 60 m
  const behind = drone(k, 30, 12, 2870); // behind the wall
  const near = drone(k, 30, 12, 2895);
  k.run(0.2);
  shoot(k, 'p1', p, [far.x, far.y, far.z], { seq: 1, vt: k.clock.t });
  assert.equal(k.send('p1', { t: C.HIT, seq: 1, target: far.id, at: [far.x, far.y, far.z] }), false);
  assert.equal(k.lastDeny('p1').reason, 'far');
  k.wait(300);
  shoot(k, 'p1', p, [behind.x, behind.y, behind.z], { seq: 2, vt: k.clock.t });
  assert.equal(k.send('p1', { t: C.HIT, seq: 2, target: behind.id, at: [behind.x, behind.y, behind.z] }), false);
  assert.equal(k.lastDeny('p1').reason, 'blocked');
  k.wait(300);
  // aimed 90° away from the target: outside the spread cone
  shoot(k, 'p1', p, [near.x, near.y, near.z], { seq: 3, vt: k.clock.t, aim: [p.x - 30, p.y + EYE, p.z] });
  assert.equal(k.send('p1', { t: C.HIT, seq: 3, target: near.id, at: [near.x, near.y, near.z] }), false);
  assert.equal(k.lastDeny('p1').reason, 'invalid');
});

test('rate of fire, magazine, reload and safe zones', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const at = [0, 12, 2880];
  let ok = 0;
  for (let i = 0; i < 6; i++) if (shoot(k, 'p1', p, at, { seq: 10 + i }).fired) ok++;
  assert.equal(ok, 2, 'burst tolerance of 2 at the same instant');
  assert.equal(k.lastDeny('p1').reason, 'rate');
  // spaced shots empty the magazine
  for (let i = 0; i < 12; i++) {
    k.wait(260);
    shoot(k, 'p1', p, at, { seq: 20 + i });
  }
  assert.equal(p.inv.mag['pulse-pistol'], 0);
  k.wait(260);
  assert.equal(shoot(k, 'p1', p, at, { seq: 40 }).fired, false);
  assert.equal(k.lastDeny('p1').reason, 'empty');
  const reserve = p.inv.ammo.pulse;
  assert.equal(k.send('p1', { t: C.RELOAD, w: 'pulse-pistol' }), true);
  k.run(0.5);
  assert.equal(shoot(k, 'p1', p, at, { seq: 41 }).fired, false);
  assert.equal(k.lastDeny('p1').reason, 'reloading');
  k.run(1.0);
  assert.equal(p.inv.mag['pulse-pistol'], 12);
  assert.equal(p.inv.ammo.pulse, reserve - 12);
  const inv = k.of(S.INV, 'p1').pop();
  assert.equal(inv.mag['pulse-pistol'], 12);
  // no weapons in the plaza
  k.put(p, 360, -150);
  k.wait(500);
  assert.equal(shoot(k, 'p1', p, [360, 12, -170], { seq: 50 }).fired, false);
  assert.equal(k.lastDeny('p1').reason, 'safe');
  // weapons you don't own
  k.put(p, 0, 2900);
  assert.equal(shoot(k, 'p1', p, at, { seq: 51, w: 'railgun' }).fired, false);
  assert.equal(k.lastDeny('p1').reason, 'noWeapon');
});

test('kills drop loot, count kills and send the killfeed death', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const e = drone(k, 0, 18, 2885);
  k.run(0.1);
  for (let i = 0; i < 5; i++) {
    k.wait(300);
    shoot(k, 'p1', p, [e.x, e.y, e.z], { seq: 100 + i, vt: k.clock.t });
    k.send('p1', { t: C.HIT, seq: 100 + i, target: e.id, at: [e.x, e.y, e.z] });
  }
  assert.equal(k.W.enemies.has(e.id), false);
  const death = k.of(S.DEATH).find((m) => m.id === e.id);
  assert.ok(death, 'death message');
  assert.equal(death.by, 'p1');
  assert.equal(death.type, 'drone');
  assert.ok(death.drop, 'loot crate id');
  const loot = k.W.loot.get(death.drop);
  assert.ok(loot.items.res.metal >= 3 && loot.items.res.metal <= 8);
  assert.equal(p.kills, 1);
  // pick it up
  k.put(p, loot.p[0], loot.p[2]);
  p.inv.ammo.pulse = 0; // room for the dropped pulse cells, so the crate empties
  const before = p.inv.res.metal;
  const metal = loot.items.res.metal; // (ammo that does not fit stays in the crate and replaces its items)
  assert.equal(k.send('p1', { t: C.PICKUP, loot: death.drop }), true);
  assert.equal(p.inv.res.metal, before + metal);
  assert.equal(k.W.loot.get(death.drop), undefined);
});

test('PvE only: players can not be hit', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  const { p: q } = k.join('p2', 0, 2890);
  shoot(k, 'p1', p, [q.x, q.y + 1, q.z], { seq: 1 });
  assert.equal(k.send('p1', { t: C.HIT, seq: 1, target: 'p2', at: [q.x, q.y + 1, q.z] }), false);
  assert.equal(q.hp, 100);
});

test('shock grenade: arc, fuse, AoE falloff and stun', () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 2900);
  p.inv.items['shock-grenade'] = 2;
  const a = k.W.enemiesSys.create('stalker', 0, 2880, null);
  const b = k.W.enemiesSys.create('stalker', 3.5, 2881, null);
  const c = k.W.enemiesSys.create('stalker', 0, 2860, null); // far from the blast
  for (const e of [a, b, c]) e.ai = false;
  // throw at ~45° toward −z, landing ~15 m away
  const v = [0, 12.2, -12.2];
  assert.equal(k.send('p1', { t: C.THROW, w: 'shock-grenade', o: [0, p.y + 1.6, 2900], v }), true);
  assert.equal(p.inv.items['shock-grenade'], 1);
  const g = [...k.W.projectiles.values()][0];
  assert.ok(g);
  k.run(0.5);
  const snap = k.sim.snapshotFor('p1');
  assert.equal(snap.px.length, 1);
  k.run(1.6);
  assert.equal(k.W.projectiles.size, 0);
  const boom = k.of(S.EXPLODE);
  assert.equal(boom.length, 1);
  const bz = boom[0].at[2];
  assert.ok(bz < 2886 && bz > 2874, `landed around z 2880 (${bz})`);
  assert.ok(a.hp < 90, 'a damaged');
  assert.ok(b.hp < 90, 'b damaged');
  assert.equal(c.hp, 90, 'c out of range');
  assert.ok(a.stunUntil > k.clock.t, 'stunned');
  // too fast throws are clamped (no 60 m grenades)
  k.wait(1200);
  k.send('p1', { t: C.THROW, w: 'shock-grenade', o: [0, p.y + 1.6, 2900], v: [0, 100, -100] });
  const g2 = [...k.W.projectiles.values()][0];
  assert.ok(Math.hypot(g2.vx, g2.vy, g2.vz) <= WEAPONS['shock-grenade'].throwSpeed + 1e-6);
});

test('equip only owned weapons', () => {
  const k = makeSim();
  k.join('p1', 0, 2900);
  assert.equal(k.send('p1', { t: C.EQUIP, slot: 1 }), false);
  assert.equal(k.lastDeny('p1').reason, 'noWeapon');
  assert.equal(k.send('p1', { t: C.EQUIP, slot: 0 }), true);
});
