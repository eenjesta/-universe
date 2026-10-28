// node --test src/characters/test/
// Avatars (characters module): animator combat layers, weapon IK, net anim contract,
// remote players end to end (shared/sim → src/net registry → ctx.remotes), mock players.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Character } from '../character.js';
import { WeaponRig, GRIPS } from '../weapon-rig.js';
import { J } from '../skeleton.js';
import { normalizeAppearance } from '../appearance.js';
import { COMBAT_TIMING } from '../animator.js';
import { createRemotes } from '../remotes.js';
import { createMockNet } from '../remotes-mock.js';
import { toNetAnim, NET_ANIMS } from '../player.js';
import { createRemotes as createNetRegistry } from '../../net/remotes.js';
import { C, S, NET } from '../../../shared/protocol.js';

// shared/sim is built in parallel by the sim engineer: the end-to-end tests skip while it can't load
let makeSim = null;
let killPlayer = null;
let simSkip = false;
try {
  ({ makeSim } = await import('../../../shared/sim/_testkit.js'));
  ({ killPlayer } = await import('../../../shared/sim/players.js'));
} catch (err) {
  simSkip = `shared/sim not loadable right now (${String(err?.message || err).slice(0, 120)})`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const finiteBones = (chr) => chr.bones.every((b) => Number.isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w + b.position.x + b.position.y + b.position.z));

function stubLabels() {
  const items = new Set();
  return {
    items,
    add(owner, name, opts) {
      const it = { owner, name, opts, hp: -1, sh: -1, dim: false, said: null };
      items.add(it);
      return it;
    },
    remove(it) {
      items.delete(it);
    },
    setBars(it, hp, sh) {
      it.hp = hp;
      it.sh = sh;
    },
    setDim(it, d) {
      it.dim = !!d;
    },
    setName(it, n) {
      it.name = n;
    },
    say(it, text) {
      it.said = text;
    },
  };
}

function stubCtx(net = null, { cam = [0, 3, 12] } = {}) {
  const handlers = new Map();
  const events = {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type).delete(fn);
    },
    once(type, fn) {
      const off = events.on(type, (p) => {
        off();
        fn(p);
      });
      return off;
    },
    emit(type, p) {
      for (const fn of [...(handlers.get(type) || [])]) fn(p);
    },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 20000);
  camera.position.set(cam[0], cam[1], cam[2]);
  camera.lookAt(cam[0], 1, cam[2] - 12);
  camera.updateMatrixWorld();
  return { world: { scene, getHeightAt: () => 0, waterLevel: 0 }, events, camera, engine: { camera }, net, params: {} };
}

function makeRemotes(net, opts) {
  const ctx = stubCtx(net, opts);
  const labels = stubLabels();
  const remotes = createRemotes(ctx, { material: new THREE.MeshStandardMaterial(), labels, fx: null });
  return { ctx, labels, remotes };
}

/** Waits until every remote has its mesh (node builds them on the main thread). */
async function meshes(remotes, ms = 8000) {
  const t0 = Date.now();
  while (remotes.list.some((r) => r.character.pending) && Date.now() - t0 < ms) await sleep(20);
}

test('animator: random inputs + combat one-shots never produce NaN poses', () => {
  const chr = new Character(normalizeAppearance({ body: 'f' }), { lod: 1, deferLoad: true, seed: 7 });
  const rig = new WeaponRig(chr);
  const a = chr.anim;
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const kinds = ['pistol', 'rifle', 'heavy', null];
  for (let i = 0; i < 1500; i++) {
    if (i % 150 === 0) rig.set(kinds[(i / 150) % 4 | 0]);
    a.speed = rnd() < 0.3 ? 0 : rnd() * 9;
    a.grounded = rnd() > 0.1;
    a.vy = (rnd() - 0.5) * 14;
    a.swimming = rnd() < 0.05;
    a.turnRate = (rnd() - 0.5) * 12;
    a.aimOn = rnd() < 0.5;
    a.strafe = a.aimOn;
    a.moveAngle = (rnd() - 0.5) * 7;
    a.aimPitch = (rnd() - 0.5) * 3;
    a.aimYaw = (rnd() - 0.5) * 2;
    const r = rnd();
    if (r < 0.03) a.fire(rnd() * 1.5);
    else if (r < 0.04) a.hit(rnd() < 0.5 ? -1 : 1, rnd() * 2);
    else if (r < 0.045) a.reload(0.5 + rnd() * 2);
    else if (r < 0.05) a.dodge();
    else if (r < 0.052) a.die({ dir: rnd() < 0.5 ? 1 : -1 });
    else if (r < 0.056) {
      a.revive();
      a.materialize();
    }
    a.set('sit', rnd() < 0.02 ? 1 : 0);
    a.set('wave', rnd() < 0.02 ? 1 : 0);
    a.update(rnd() < 0.05 ? 0.2 : 1 / 60);
    rig.update(true);
    if (i % 10 === 0) assert.ok(finiteBones(chr), `finite pose at frame ${i}`);
    assert.ok(Number.isFinite(a.hipOff.x + a.hipOff.y + a.hipOff.z + a.roll));
  }
  // one-shot timing
  a.revive();
  a.dodge();
  assert.ok(a.dodging);
  for (let t = 0; t < COMBAT_TIMING.dodge + 0.05; t += 1 / 60) a.update(1 / 60);
  assert.ok(!a.dodging, 'roll ends');
  a.die({});
  for (let t = 0; t < COMBAT_TIMING.die + 0.6; t += 1 / 60) a.update(1 / 60);
  assert.ok(a.dead && a.deadW > 0.95, `lying down (deadW ${a.deadW})`);
  a.revive();
  a.materialize(0.8);
  a.update(1 / 60);
  assert.ok(!a.dead && a.materializing && a.spawnScale < 1);
  for (let t = 0; t < 0.9; t += 1 / 60) a.update(1 / 60);
  assert.ok(!a.materializing && Math.abs(a.spawnScale - 1) < 1e-6);
});

test('weapon rig: wrists reach the grip / support point, the barrel follows the aim', () => {
  const chr = new Character(normalizeAppearance({ body: 'm' }), { lod: 1, deferLoad: true, seed: 3 });
  const rig = new WeaponRig(chr);
  const a = chr.anim;
  const hand = new THREE.Vector3();
  const want = new THREE.Vector3();
  const dir = new THREE.Vector3();
  // weapons only (tool grips are placed by the work actions: see fp-anim.test.js)
  for (const kind of Object.keys(GRIPS).filter((k) => !GRIPS[k].tool)) {
    rig.set(kind);
    for (const pitch of [-0.5, 0, 0.45]) {
      a.aimOn = true;
      a.aimPitch = pitch;
      a.aimYaw = 0.1;
      a.speed = 0;
      for (let i = 0; i < 120; i++) {
        a.update(1 / 60);
        rig.update(true);
      }
      chr.jointWorld(J.handR, hand);
      want.copy(rig.wristR).applyMatrix4(rig.matrixWorld);
      assert.ok(hand.distanceTo(want) < 0.02, `${kind} p${pitch}: right wrist ${hand.distanceTo(want).toFixed(3)} m off`);
      chr.jointWorld(J.handL, hand);
      want.copy(rig.support).applyMatrix4(rig.matrixWorld);
      assert.ok(hand.distanceTo(want) < 0.035, `${kind} p${pitch}: left wrist ${hand.distanceTo(want).toFixed(3)} m off`);
      dir.set(0, 0, -1).transformDirection(rig.matrixWorld);
      const barrelPitch = Math.asin(dir.y);
      assert.ok(Math.abs(barrelPitch - pitch) < 0.12, `${kind}: barrel pitch ${barrelPitch.toFixed(2)} vs aim ${pitch}`);
    }
    // relaxed carry (not aiming): still finite, holstered rides on the body
    a.aimOn = false;
    for (let i = 0; i < 40; i++) {
      a.update(1 / 60);
      rig.update(true);
    }
    rig.setHolstered(true);
    rig.update(true);
    assert.ok(finiteBones(chr));
    rig.setHolstered(false);
  }
});

test('netAnim contract: every mapped state is accepted by the sim', { skip: simSkip }, () => {
  const k = makeSim();
  const { p } = k.join('p1', 0, 900);
  const rich = ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'swim', 'aim', 'shoot', 'reload', 'hit', 'dodge', 'dead', 'respawn', 'sit', 'wave', 'drive', 'build'];
  for (const a of rich) {
    const na = toNetAnim(a);
    assert.ok(NET_ANIMS.has(na), `${a} → ${na}`);
    p.a = '__';
    k.clock.t += 100;
    k.send('p1', { t: C.STATE, p: [p.x, p.y, p.z], h: 0, v: [0, 0, 0], a: na, m: 'foot' });
    assert.equal(p.a, na, `sim accepts '${na}'`);
  }
  assert.equal(toNetAnim('sprint'), 'sprint'); // the sim accepts sprint / wave / respawn since the integration
});

test('remotes end to end: sim snapshots → net views → avatars (walk, death, respawn, leave)', { skip: simSkip }, async () => {
  const k = makeSim();
  k.join('p1', 0, 165); // near the Overlook respawn point (0, 150): the bot stays in the interest radius
  const { p: bot } = k.join('p2', 4, 165);
  const reg = createNetRegistry({ delay: NET.INTERP_DELAY_MS });
  const net = { id: 'p1', players: reg.players };
  const { ctx, labels, remotes } = makeRemotes(net, { cam: [0, 4, 177] });
  reg.join('p2', { name: 'Bot', appearance: { body: 'f' } });
  ctx.events.emit('net:welcome', { t: S.WELCOME, world: { players: [{ id: 'p1', name: 'Me' }, { id: 'p2', name: 'Bot', appearance: { body: 'f' } }] } });
  assert.equal(remotes.count, 1, 'no avatar for myself');
  const r = remotes.get('p2');
  assert.ok(r && r.name === 'Bot');
  await meshes(remotes);
  const dt = 1 / 60;
  let tState = 0;
  let tStep = 0;
  let tSnap = 0;
  let speedSum = 0;
  let speedN = 0;
  const deliver = () => {
    for (const o of k.flush().splice(0)) {
      const m = o.msg;
      if (m.t === S.DEATH) ctx.events.emit('net:death', m);
      else if (m.t === S.RESPAWNED) ctx.events.emit('net:respawned', m);
    }
  };
  const frame = (botMove) => {
    tState += dt;
    tStep += dt;
    tSnap += dt;
    k.clock.t += dt * 1000;
    if (botMove && tState >= 1 / NET.STATE_HZ) {
      tState = 0;
      bot.x += 4 / NET.STATE_HZ;
      k.send('p2', { t: C.STATE, p: [bot.x, 10, bot.z], h: -Math.PI / 2, v: [4, 0, 0], a: 'walk', m: 'foot' });
    }
    if (tStep >= 1 / NET.TICK_HZ) {
      tStep = 0;
      k.sim.step(1 / NET.TICK_HZ);
    }
    if (tSnap >= 1 / NET.SNAPSHOT_HZ) {
      tSnap = 0;
      const snap = k.sim.snapshotFor('p1');
      if (snap) reg.applySnapshot(snap, 'p1');
    }
    deliver();
    reg.update(k.clock.t);
    remotes.update(dt);
  };
  // walk east at 4 m/s for 3 s
  for (let i = 0; i < 180; i++) {
    frame(true);
    if (i > 90) {
      speedSum += r.character.anim.speed;
      speedN++;
    }
  }
  assert.equal(r.anim, 'walk');
  assert.ok(!r.character.hidden, 'avatar visible');
  const lag = bot.x - r.position.x;
  assert.ok(lag > 0 && lag < 1.6, `follows the view (lag ${lag.toFixed(2)} m)`);
  assert.ok(Math.abs(r.position.z - 165) < 0.05);
  assert.ok(Math.abs(speedSum / speedN - 4) < 0.6, `animated speed ≈ 4 m/s (${(speedSum / speedN).toFixed(2)})`);
  assert.ok(Math.abs(r.heading - -Math.PI / 2) < 0.05, 'faces east');
  assert.equal(r.label.hp, 1);
  assert.equal(r.label.sh, 1);

  // death (enemy laser) → collapse, dimmed tag
  killPlayer(k.W, bot, 'e1', 'laser');
  for (let i = 0; i < 90; i++) frame(false);
  assert.ok(r.character.anim.dead, 'collapsed');
  assert.equal(r.anim, 'dead');
  assert.ok(r.label.dim, 'tag dimmed');
  assert.ok(r.label.hp === 0);
  // respawn at the spawn point → materialize there, never collapses again
  k.clock.t += 5000;
  k.send('p2', { t: C.RESPAWN, at: 'spawn' });
  const resp = k.of(S.RESPAWNED).pop();
  assert.ok(resp, 'server respawned the bot');
  ctx.events.emit('net:respawned', resp);
  let collapsed = false;
  let printed = false;
  for (let i = 0; i < 120; i++) {
    frame(false);
    collapsed ||= r.character.anim.dead;
    printed ||= r.character.anim.materializing;
  }
  assert.ok(printed, 'materialized');
  assert.ok(!collapsed, 'no second collapse while the view still lags');
  assert.ok(r.position.distanceTo(new THREE.Vector3(...resp.p)) < 0.6, 'at the respawn point');
  assert.ok(!r.label.dim && r.label.hp === 1);

  // leave → gone from the scene
  const obj = r.object;
  ctx.events.emit('net:leave', { id: 'p2' });
  assert.equal(remotes.get('p2'), null);
  assert.equal(remotes.count, 0);
  assert.equal(obj.parent, null);
  assert.equal(labels.items.size, 0);
  remotes.dispose();
});

test('remotes: vehicles, space, interest range, far-out coordinates', async () => {
  const players = new Map();
  const view = (x, y, z, extra = {}) => ({ p: new THREE.Vector3(x, y, z), h: 0.5, a: 'idle', m: 'foot', hp: 100, sh: 50, veh: null, ...extra });
  players.set('far', { view: view(5200.25, 140, -7300.5, { a: 'run' }), inRange: true });
  players.set('car', { view: view(10, 0, 0, { m: 'car', a: 'drive', veh: { type: 'car', p: new THREE.Vector3(10, 0.4, 0), h: 1 } }), inRange: true });
  players.set('astro', { view: view(0, 0, 5, { m: 'space' }), inRange: true });
  players.set('gone', { view: view(3, 0, 3), inRange: true });
  const { ctx, remotes } = makeRemotes({ id: 'me', players }, { cam: [5200, 145, -7285] });
  for (const id of players.keys()) remotes.add(id, { name: id });
  await meshes(remotes);
  for (let i = 0; i < 30; i++) remotes.update(1 / 60);
  const far = remotes.get('far');
  assert.ok(!far.character.hidden, 'far-out avatar shown');
  assert.ok(far.position.distanceTo(players.get('far').view.p) < 1e-6, 'exact position at large coordinates');
  far.object.updateMatrixWorld(true);
  assert.ok(finiteBones(far.character));
  const head = far.character.jointWorld(J.head, new THREE.Vector3());
  assert.ok(head.y > 140.8 && head.y < 142.2 && Math.abs(head.x - 5200.25) < 0.5, `head at ${head.toArray().map((v) => v.toFixed(2))}`);
  // back to the hub: the far-out player is culled (not drawn, not animated)
  ctx.camera.position.set(0, 3, 14);
  ctx.camera.lookAt(0, 1, 0);
  ctx.camera.updateMatrixWorld();
  for (let i = 0; i < 10; i++) remotes.update(1 / 60);
  assert.ok(far.character.hidden && far.hiddenTag, 'culled by distance');
  assert.ok(!remotes.get('gone').character.hidden, 'near avatar shown');
  assert.ok(remotes.get('car').character.hidden, 'driver avatar hidden');
  assert.equal(remotes.get('car').mode, 'drive');
  assert.ok(remotes.get('astro').character.hidden, 'space: hidden');
  // out of the interest radius → hidden; forgotten by the source → removed after a while
  players.get('gone').inRange = false;
  remotes.update(1 / 60);
  assert.ok(remotes.get('gone').character.hidden);
  players.delete('gone');
  for (let i = 0; i < 14 * 4; i++) remotes.update(0.25);
  assert.equal(remotes.get('gone'), null, 'dropped');
  remotes.dispose();
});

test('remotes: snapshot weapon id picks the model; a swapped world scene re-parents everything', async () => {
  const players = new Map();
  players.set('a', { view: { p: new THREE.Vector3(0, 0, -6), h: 0, a: 'aim', m: 'foot', hp: 100, sh: 50, veh: null, w: 'railgun' }, inRange: true });
  const { ctx, remotes } = makeRemotes({ id: 'me', players }, { cam: [0, 3, 6] });
  remotes.add('a', { name: 'A' });
  await meshes(remotes);
  for (let i = 0; i < 5; i++) remotes.update(1 / 60);
  const r = remotes.get('a');
  assert.equal(r.weapon, 'heavy', 'railgun → heavy model while aiming');
  const old = ctx.world.scene;
  const next = new THREE.Scene();
  ctx.world.scene = next;
  remotes.update(1 / 60);
  assert.equal(r.object.parent, next);
  assert.ok(remotes.batches.length && remotes.batches.every((b) => b.mesh && b.mesh.parent === next));
  assert.equal(remotes.vehicles.root.parent, next);
  assert.ok(Object.values(remotes.weapons.meshes).every((m) => m.parent === next));
  assert.equal(old.children.length, 0, 'nothing left in the old scene');
  remotes.dispose();
});

test('remotes: 50 players stay cheap (LOD), mock players cover every anim state', async () => {
  const ctx = stubCtx(null);
  const mock = createMockNet(ctx, 50, { center: new THREE.Vector3(0, 0, 0), radius: 40 });
  const seen = new Set();
  const modes = new Set();
  for (let i = 0; i < 30 * 60; i++) {
    mock.update(1 / 30);
    for (const p of mock.list) {
      seen.add(p.view.a);
      modes.add(p.view.m);
      assert.ok(Number.isFinite(p.view.p.x + p.view.p.y + p.view.p.z + p.view.h), `${p.id} finite`);
    }
  }
  for (const a of ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'aim', 'shoot', 'reload', 'hit', 'dodge', 'dead', 'respawn', 'sit', 'wave']) assert.ok(seen.has(a), `mock shows '${a}'`);
  assert.ok(modes.has('drive') && modes.has('foot'));

  const { remotes } = makeRemotes(null, { cam: [0, 3, 30] });
  remotes.mock(50, { radius: 40 });
  assert.equal(remotes.count, 50);
  await meshes(remotes, 20000);
  for (let i = 0; i < 60; i++) remotes.update(1 / 60);
  const t0 = performance.now();
  const N = 240;
  for (let i = 0; i < N; i++) remotes.update(1 / 60);
  const ms = (performance.now() - t0) / N;
  console.log(`# 50 remotes: ${ms.toFixed(2)} ms per update (node, CPU only), ${remotes.batches.length} batches, ${remotes.triangles()} triangles`);
  assert.ok(ms < 12, `update cost ${ms.toFixed(2)} ms`);
  assert.ok(remotes.batches.length <= 7);
  for (const r of remotes.list) assert.ok(Number.isFinite(r.position.x + r.position.y + r.position.z + r.heading));
  remotes.mock(0);
  assert.equal(remotes.count, 0);
  remotes.dispose();
});
