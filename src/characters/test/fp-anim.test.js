// node --test src/characters/test/
// fp-anim: work actions (timing, impact, 3P poses + IK, remotes' anim mapping), first-person camera
// (settings, eye maths, the rig's third ↔ first blend) and the view model's item handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Character } from '../character.js';
import { WeaponRig, GRIPS, TOOL_GRIP_OF, solveGesture } from '../weapon-rig.js';
import { J } from '../skeleton.js';
import { normalizeAppearance } from '../appearance.js';
import { ACTIONS, TOOL_ACTIONS, actionTiming, toolKind, kf, ease, envelope, ActionClock, usesTool } from '../tool-actions.js';
import { POSES, POSE_WIDTH, poseFor } from '../action-poses.js';
import { createToolModel, createFoodModel, TOOL_BUILDERS, TOOL_POINTS, toolGeometry } from '../tool-models.js';
import { cameraSettings, eyeFromBody, FP_HIDDEN_BONES } from '../first-person.js';
import { createCameraRig } from '../camera-rig.js';
import { createViewModel, GRIP_VM, VM_ACT } from '../viewmodel.js';
import { createPlayer, toNetAnim, NET_ANIMS, WORK_ANIMS, setWorkNetAnims, workNetAnims } from '../player.js';
import { createCharacterMaterial } from '../material.js';
import { createRemotes, featureAction } from '../remotes.js';
import { createSwingTrails, inStrike } from '../swing-trail.js';
import { S as SP } from '../../../shared/protocol.js';

const finite = (v) => Number.isFinite(v.x + v.y + v.z);

// ------------------------------------------------------------------ timing
test('action timing: every action has wind-up < impact < duration; tier-2 tools are faster', () => {
  for (const name of TOOL_ACTIONS) {
    const tm = actionTiming(name);
    assert.ok(tm && tm.dur > 0.2 && tm.impact > 0.05 && tm.impact < tm.dur, `${name}: ${JSON.stringify(tm)}`);
    assert.ok(tm.move > 0 && tm.move <= 1, `${name} move factor`);
  }
  assert.equal(actionTiming('fly'), null);
  const axe = actionTiming('chop', 'axe');
  const plasma = actionTiming('chop', 'plasma-axe');
  assert.ok(plasma.dur < axe.dur && plasma.impact < axe.impact, 'plasma axe swings faster');
  const laser = actionTiming('mine', 'mining-laser');
  assert.ok(laser.impact < 0.2, 'the mining laser fires almost at once');
  assert.equal(toolKind('plasma-axe'), 'axe');
  assert.equal(toolKind('pickaxe'), 'pick');
  assert.equal(toolKind('mining-laser'), 'laser');
  assert.equal(toolKind('weird-pick-thing'), 'pick');
  assert.ok(usesTool('chop') && usesTool('mine') && !usesTool('eat'));
  for (const id of ['axe', 'plasma-axe', 'pickaxe', 'mining-laser']) assert.ok(GRIPS[TOOL_GRIP_OF[id]]?.tool, `${id} has a tool grip`);
});

test('keyframe sampler + easings + envelope', () => {
  const keys = [
    [0, 'io', 0, 10],
    [0.5, 'in', 1, 20],
    [1, 'out', 0, 10],
  ];
  const o = [0, 0];
  assert.deepEqual(kf(keys, -1, o), [0, 10]);
  assert.deepEqual(kf(keys, 0.5, o), [1, 20]);
  assert.deepEqual(kf(keys, 2, o), [0, 10]);
  kf(keys, 0.25, o);
  assert.ok(Math.abs(o[0] - 0.125) < 1e-9, "the segment ending at an 'in' key accelerates");
  kf(keys, 0.75, o);
  assert.ok(o[0] < 0.5, "'out' decelerates: already past the middle of its way back");
  assert.equal(ease('in', 0.5), 0.125);
  assert.equal(ease('lin', 0.3), 0.3);
  assert.equal(envelope(0, 0.2, 0.2), 0);
  assert.equal(envelope(0.5, 0.2, 0.2), 1);
});

test('ActionClock: the impact fires exactly once per action at the impact time; chained starts', () => {
  const c = new ActionClock();
  const tm = actionTiming('chop', 'axe');
  const dur = c.start('chop', tm);
  assert.equal(dur, tm.dur);
  let impacts = 0;
  let at = -1;
  let t = 0;
  while (c.tick(1 / 60)) {
    t += 1 / 60;
    if (c.impact) {
      impacts++;
      at = t;
    }
  }
  assert.equal(impacts, 1);
  assert.ok(Math.abs(at - tm.impact) <= 1 / 60 + 1e-9, `impact at ${at} vs ${tm.impact}`);
  assert.ok(c.done && c.x === 1);
  // speed scales the whole action
  c.start('mine', actionTiming('mine'), 2);
  assert.ok(Math.abs(c.dur - ACTIONS.mine.dur / 2) < 1e-9 && Math.abs(c.impactAt - ACTIONS.mine.impact / 2) < 1e-9);
  c.cancel();
  assert.ok(!c.running && c.name === null);
});

test('3P action poses: well-formed, ready pose at both ends, impact key at the impact time', () => {
  for (const [name, pose] of Object.entries(POSES)) {
    const keys = pose.keys;
    assert.ok(keys.length >= 3, name);
    for (const k of keys) {
      assert.equal(k.length, POSE_WIDTH + 2, `${name}: key width`);
      assert.ok(k.slice(2).every(Number.isFinite), `${name}: finite`);
    }
    assert.deepEqual(keys[0].slice(2), keys[keys.length - 1].slice(2), `${name}: chains (first = last)`);
    const action = name === 'mine-laser' ? 'mine' : name;
    const tm = actionTiming(action, name === 'mine-laser' ? 'mining-laser' : null);
    const xi = tm.impact / tm.dur;
    if (action !== 'mine' || name === 'mine') {
      // a key sits on (or within 6 % of) the impact so the strike lands on the impact frame
      assert.ok(keys.some((k) => Math.abs(k[0] - xi) < 0.06), `${name}: key near the impact ${xi.toFixed(2)}`);
    }
  }
  assert.equal(poseFor('mine', 'laser'), POSES['mine-laser']);
  assert.equal(poseFor('mine', 'pick'), POSES.mine);
  assert.equal(poseFor('dance'), null);
});

// ------------------------------------------------------------------ 3P IK
function makeChr() {
  const chr = new Character(normalizeAppearance({ body: 'm' }), { lod: 1, deferLoad: true, seed: 3 });
  chr.object.updateMatrixWorld(true);
  return chr;
}
function runTo(chr, rig, name, toolId, x) {
  const a = chr.anim;
  const tm = actionTiming(name, toolId);
  a.stopAction();
  for (let i = 0; i < 40; i++) a.update(1 / 30);
  a.action(name, tm.dur);
  const steps = Math.round((x * tm.dur) / (1 / 120));
  for (let i = 0; i < steps; i++) a.update(1 / 120);
  a.update(0);
  if (rig) rig.update(true);
  return tm;
}

test('3P tools: the arms hold the tool through the swing, the blade lands in front at chest / waist height', () => {
  const hand = new THREE.Vector3();
  const want = new THREE.Vector3();
  const tip = new THREE.Vector3();
  for (const [toolId, action] of [
    ['axe', 'chop'],
    ['plasma-axe', 'chop'],
    ['pickaxe', 'mine'],
    ['mining-laser', 'mine'],
  ]) {
    const chr = makeChr();
    const rig = new WeaponRig(chr, { tool: true });
    const model = createToolModel(toolId);
    rig.set(TOOL_GRIP_OF[toolId], { object: model, muzzle: model.userData.tip.toArray(), support: model.userData.support });
    assert.equal(chr.anim.tool, TOOL_GRIP_OF[toolId]);
    const tm = actionTiming(action, toolId);
    for (const x of [0.2, tm.impact / tm.dur, 0.8]) {
      runTo(chr, rig, action, toolId, x);
      // right wrist on the grip
      chr.jointWorld(J.handR, hand);
      want.copy(rig.wristOffset()).applyMatrix4(rig.matrixWorld);
      const slack = 0.03 + (1 - chr.anim.actW) * 0.6; // the layer blends in over the first frames
      assert.ok(hand.distanceTo(want) < slack, `${toolId} ${x.toFixed(2)}: right wrist ${hand.distanceTo(want).toFixed(3)} m off (w ${chr.anim.actW.toFixed(2)})`);
      // two-handed: left wrist at the support grip
      if (chr.anim.toolTwoW > 0.9) {
        chr.jointWorld(J.handL, hand);
        want.copy(rig.support).add(rig.wristOffset()).applyMatrix4(rig.matrixWorld);
        assert.ok(hand.distanceTo(want) < 0.06, `${toolId} ${x.toFixed(2)}: left wrist ${hand.distanceTo(want).toFixed(3)} m off`);
      }
      assert.ok(chr.bones.every((b) => Number.isFinite(b.quaternion.x + b.quaternion.w)));
    }
    // at the impact the striking point is in front of the body (character faces −Z) at a working height
    runTo(chr, rig, action, toolId, tm.impact / tm.dur);
    tip.copy(rig.muzzle).applyMatrix4(rig.matrixWorld);
    assert.ok(tip.z < -0.55, `${toolId}: impact point ${tip.z.toFixed(2)} m in front`);
    assert.ok(tip.y > 0.25 && tip.y < 1.6, `${toolId}: impact height ${tip.y.toFixed(2)}`);
  }
});

test('3P gestures: eat brings the hand to the mouth, gather reaches down (crouch), use reaches forward', () => {
  const chr = makeChr();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  let tm = runTo(chr, null, 'eat', null, actionTiming('eat').impact / actionTiming('eat').dur);
  solveGesture(chr, true, m);
  p.setFromMatrixPosition(m);
  const mouth = new THREE.Vector3(0, chr.frame.headC.y - 0.09, -0.12);
  assert.ok(p.distanceTo(mouth) < 0.16, `food ${p.distanceTo(mouth).toFixed(2)} m from the mouth`);
  const hand = chr.jointWorld(J.handR, new THREE.Vector3());
  assert.ok(hand.distanceTo(p) < 0.15, 'the right hand holds the food');
  tm = runTo(chr, null, 'gather', null, tm && actionTiming('gather').impact / actionTiming('gather').dur);
  assert.ok(chr.anim.hipOff.y < -0.2, `gather crouches (${chr.anim.hipOff.y.toFixed(2)})`);
  solveGesture(chr, true, m);
  p.setFromMatrixPosition(m);
  assert.ok(p.y < 0.6 && p.z < -0.3, `gather reaches down-forward (${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  runTo(chr, null, 'use', null, actionTiming('use').impact / actionTiming('use').dur);
  solveGesture(chr, true, m);
  p.setFromMatrixPosition(m);
  assert.ok(p.z < -0.4 && p.y > 1.0, 'use reaches forward');
});

test('tool + food models: geometry for every tool id, tip / support points, cached', () => {
  for (const id of Object.keys(TOOL_BUILDERS)) {
    const g = toolGeometry(id);
    assert.ok(g.attributes.position.count > 50 && g.attributes.color, id);
    assert.equal(toolGeometry(id), g, 'cached');
    const m = createToolModel(id);
    assert.ok(m.userData.tip.isVector3 && TOOL_POINTS[id] && m.userData.support.length === 3);
    assert.ok(g.boundingSphere.radius < 0.6, `${id} fits a hand`);
  }
  for (const f of ['berries', 'mushroom', 'jungle-fruit', 'raw-meat', 'ration', 'nonsense']) assert.ok(createFoodModel(f).children[0].geometry.attributes.position.count > 10, f);
});

// ------------------------------------------------------------------ first person maths
test('camera settings: defaults, clamps, persistence values', () => {
  assert.deepEqual(cameraSettings({}), { view: 'third', fov: 70, headBob: true });
  assert.deepEqual(cameraSettings({ camera: 'first', fov: 200, headBob: false }), { view: 'first', fov: 110, headBob: false });
  assert.equal(cameraSettings({ fov: 20 }).fov, 50);
  assert.equal(cameraSettings({ camera: 'side' }).view, 'third');
  assert.ok(FP_HIDDEN_BONES.includes(J.head) && FP_HIDDEN_BONES.includes(J.armR) && !FP_HIDDEN_BONES.includes(J.thighL) && !FP_HIDDEN_BONES.includes(J.footR));
});

test('eye: 8.5 cm in front of the head along the view, moves forward / down when looking down', () => {
  const out = new THREE.Vector3();
  const p = new THREE.Vector3(10, 2, -5);
  eyeFromBody(out, p, 1.69, 0, 0, 0);
  assert.ok(Math.abs(out.y - (2 + 1.69)) < 1e-9 && Math.abs(out.z - (-5 - 0.085)) < 1e-9 && Math.abs(out.x - 10) < 1e-9);
  // heading convention: yaw h faces (−sin h, 0, −cos h)
  eyeFromBody(out, p, 1.69, 0, Math.PI / 2, 0);
  assert.ok(Math.abs(out.x - (10 - 0.085)) < 1e-9 && Math.abs(out.z + 5) < 1e-9);
  const down = new THREE.Vector3();
  eyeFromBody(down, p, 1.69, 0, 0, -1.2);
  assert.ok(down.y < 2 + 1.69 - 0.1 && down.z < -5 - 0.1, 'looking down: eyes move over the chest');
  eyeFromBody(out, p, 1.69, -0.14, 0, 0);
  assert.ok(Math.abs(out.y - (2 + 1.69 - 0.14)) < 1e-9, 'body dip (landing squash / crouch) lowers the eye');
});

function fakeCtx(extra = {}) {
  const events = new Map();
  const ctx = {
    camera: new THREE.PerspectiveCamera(55, 16 / 9, 0.15, 6000),
    input: { lookX: 0, lookY: 0, wheel: 0, gameEnabled: true, keys: new Set(), _pressed: new Set(), moveVector: () => ({ x: 0, y: 0 }), pressed: () => false, action: () => false, actionPressed: () => false },
    physics: { segmentHit: () => 1, groundHeight: () => 0, resolveCylinder: () => {} },
    world: { scene: new THREE.Scene(), getHeightAt: () => 0, getNormalAt: (x, z, o = new THREE.Vector3()) => o.set(0, 1, 0), isWater: () => false, waterLevel: -50 },
    events: {
      on: (n, f) => (events.set(n, [...(events.get(n) || []), f]), () => {}),
      once: () => {},
      emit: (n, p) => (events.get(n) || []).forEach((f) => f(p)),
    },
    state: { _d: { settings: {} }, get(path) { return path.split('.').reduce((o, k) => o?.[k], this._d); }, set(path, v) { const ks = path.split('.'); let o = this._d; for (const k of ks.slice(0, -1)) o = o[k] ||= {}; o[ks.at(-1)] = v; }, add() {}, subscribe() {} },
    modes: { name: 'explore', is: (...m) => m.includes('explore') },
    interactions: { origin: new THREE.Vector3(), scope: 'world', active: false },
    ...extra,
  };
  return ctx;
}

test('camera rig: third → first person blends in ~0.3 s to the eye (near plane, FOV), aim ray from the eye, back out', () => {
  const ctx = fakeCtx();
  const rig = createCameraRig(ctx);
  const target = new THREE.Object3D();
  target.position.set(5, 0, 5);
  target.updateMatrixWorld(true);
  const eye = new THREE.Vector3(5, 1.69, 4.915);
  rig.setFirstPerson({ target, eye: (out) => out.copy(eye) });
  rig.follow(target, { distance: 2.45, height: 1.5, shoulder: 0.44 });
  rig.update(1 / 60);
  const third = ctx.camera.position.clone();
  assert.ok(third.distanceTo(eye) > 1.5, 'starts behind the shoulder');
  rig.fov = 80;
  rig.setView('first');
  rig.update(0.15);
  assert.ok(rig.fpW > 0.2 && rig.fpW < 0.85, `mid-blend ${rig.fpW}`);
  for (let i = 0; i < 12; i++) rig.update(1 / 60);
  assert.equal(rig.fpW, 1);
  assert.ok(ctx.camera.position.distanceTo(eye) < 1e-6, 'camera at the eye');
  assert.ok(ctx.camera.near < 0.08, 'small near plane');
  for (let i = 0; i < 60; i++) rig.update(1 / 60);
  assert.ok(Math.abs(ctx.camera.fov - 80) < 0.5, `FP fov ${ctx.camera.fov}`);
  // FP pitch range is wider
  ctx.input.lookY = -3000;
  rig.update(1 / 60);
  ctx.input.lookY = 0;
  assert.ok(rig.pitch > 0.72, `looks up past the 3P limit (${rig.pitch.toFixed(2)})`);
  const r = rig.aimRay();
  assert.ok(r.origin.distanceTo(eye) < 1e-6 && r.near > 0 && r.near < 0.5);
  // death cam: blocked → back to third person
  rig.fpBlock = 'dead';
  for (let i = 0; i < 30; i++) rig.update(1 / 60);
  assert.equal(rig.fpW, 0);
  assert.ok(rig.pitch <= 0.72 + 1e-6, 'pitch pulled back into the 3P range');
  assert.ok(Math.abs(ctx.camera.near - 0.15) < 1e-6);
  rig.fpBlock = null;
  // scroll-in past the closest distance asks for first person
  let asked = null;
  rig.onViewRequest = (v) => (asked = v);
  rig.setView('third', { snap: true });
  rig._zoom = rig.minDistance;
  ctx.input.wheel = -1;
  rig.update(1 / 60);
  rig.update(1 / 60);
  ctx.input.wheel = 0;
  assert.equal(asked, 'first');
});

// ------------------------------------------------------------------ player API (node, fake world)
test('player: holdTool + playAction → durations, one action:impact per swing, chaining, net anim, socket', async () => {
  const ctx = fakeCtx();
  const impacts = [];
  const starts = [];
  ctx.events.on('action:impact', (e) => impacts.push({ ...e, at: e.at.clone() }));
  ctx.events.on('action:start', (e) => starts.push(e));
  const rig = createCameraRig(ctx);
  ctx.cameraRig = rig;
  const player = createPlayer(ctx, { material: createCharacterMaterial({ fpHide: true }) });
  player.teleport({ x: 0, z: 0 }, 0);
  rig.follow(player.object, { distance: 2.45, height: 1.5 });
  setWorkNetAnims(true); // as if the sim accepted the work states
  const info = player.holdTool('axe');
  assert.equal(info.grip, 'axe');
  assert.equal(player.tool.id, 'axe');
  assert.ok(player.toolSocket.isObject3D);
  const dur = player.playAction('chop');
  assert.ok(typeof dur === 'number' && Math.abs(dur - actionTiming('chop', 'axe').dur) < 1e-9);
  assert.equal(player.playAction('chop'), false, 'busy before the recovery');
  assert.equal(starts.length, 1);
  let t = 0;
  let sawChop = false;
  while (t < dur * 0.9) {
    player.update(1 / 60);
    rig.update(1 / 60);
    if (player.netAnim() === 'chop') sawChop = true;
    t += 1 / 60;
  }
  assert.ok(sawChop, 'net anim chop');
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].action, 'chop');
  assert.equal(impacts[0].tool, 'axe');
  assert.ok(finite(impacts[0].at) && impacts[0].at.distanceTo(player.position) < 2, 'impact at the tool tip near the player');
  const d2 = player.playAction('chop');
  assert.ok(d2 > 0, 'chained swing in the recovery');
  for (let i = 0; i < 90; i++) player.update(1 / 60);
  assert.equal(impacts.length, 2);
  // weapons + tools: a held weapon rides holstered while the tool is in hand, comes back after
  const gun = new THREE.Group();
  player.holdWeapon(gun, { grip: 'rifle' });
  player.update(1 / 60);
  assert.ok(player.weaponRig.forceHolster, 'the weapon rides on the back while chopping');
  player.holdTool(null);
  player.update(1 / 60);
  assert.equal(player.tool, null);
  for (let i = 0; i < 30; i++) player.update(1 / 60);
  assert.ok(!player.weaponRig.forceHolster, 'hands back to the weapon');
  // bare-hand gestures + every action returns a duration or false
  for (const a of ['gather', 'eat', 'use', 'build']) {
    for (let i = 0; i < 90; i++) player.update(1 / 60);
    const d = player.playAction(a, { item: 'berries' });
    assert.ok(d > 0, `${a} → ${d}`);
  }
  assert.ok(player.playAction('hit', {}) > 0 && player.playAction('reload') > 0 && player.playAction('shoot') > 0);
  assert.equal(player.playAction('nonsense'), false);
  // net anims: the work states go out as themselves once the sim accepts them, else as 'idle'
  for (const a of WORK_ANIMS) assert.equal(toNetAnim(a), a);
  setWorkNetAnims(false);
  assert.equal(workNetAnims(), false);
  for (const a of WORK_ANIMS) assert.equal(toNetAnim(a), 'idle', `${a} → idle until the sim knows it`);
  for (const a of WORK_ANIMS) assert.ok(!NET_ANIMS.has(a));
  assert.ok(NET_ANIMS.has('build'));
  assert.equal(player.view, 'third');
});

// ------------------------------------------------------------------ view model (no GPU)
test('view model: adopts the held weapon in FP, muzzle on the world camera ray, gives it back in 3P', () => {
  const ctx = fakeCtx({ engine: null });
  const chr = makeChr();
  const weapon = new WeaponRig(chr);
  const tool = new WeaponRig(chr, { tool: true });
  const player = {
    character: chr,
    weaponRig: weapon,
    toolRig: tool,
    appearance: normalizeAppearance({ outfit: 'vanguard', gloves: true }),
    velocity: new THREE.Vector3(),
    aiming: false,
    sprinting: false,
    grounded: true,
    swimming: false,
    dead: false,
  };
  const vm = createViewModel(ctx, { player });
  const gun = new THREE.Group();
  gun.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.6), new THREE.MeshBasicMaterial()));
  weapon.set('rifle', { object: gun, muzzle: [0, 0.06, -0.62] });
  // three.js objects: compare with assert.ok(a === b), never assert.equal — a failing equal makes node
  // diff both scene graphs (myersDiff) and that ate 20+ GB and OOM-killed the VPS.
  assert.ok(gun.parent === chr.object);
  ctx.camera.position.set(3, 1.7, 2);
  ctx.camera.rotation.set(-0.1, 0.4, 0, 'YXZ');
  ctx.camera.updateMatrixWorld(true);
  for (let i = 0; i < 40; i++) vm.update(1 / 60, 1);
  assert.ok(vm.item === gun, 'adopted');
  assert.ok(weapon.detached && gun.parent !== chr.object);
  const mz = new THREE.Vector3();
  assert.ok(vm.muzzleWorld(mz) && finite(mz));
  // the projected muzzle is in front of the camera, toward the lower right of the view
  const v = mz.clone().applyMatrix4(ctx.camera.matrixWorldInverse);
  assert.ok(v.z < -0.3 && v.x > 0 && v.y < 0, `muzzle in view space ${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`);
  // ADS centres the gun
  player.aiming = true;
  for (let i = 0; i < 60; i++) vm.update(1 / 60, 1);
  vm.muzzleWorld(mz);
  v.copy(mz).applyMatrix4(ctx.camera.matrixWorldInverse);
  assert.ok(Math.abs(v.x / v.z) < 0.08, `ADS: muzzle near the screen centre (${(v.x / v.z).toFixed(3)})`);
  // recoil + reload + a tool swing run without NaN
  vm.onAction('shoot', { recoil: 1 });
  vm.onAction('reload', {}, 1.4);
  for (let i = 0; i < 30; i++) vm.update(1 / 60, 1);
  assert.ok(finite(vm.root.children[0].position));
  // a tool takes over the hands; the weapon goes back to the character
  const axe = createToolModel('axe');
  tool.set('axe', { object: axe, muzzle: axe.userData.tip.toArray(), support: axe.userData.support });
  vm.update(1 / 60, 1);
  assert.ok(vm.item === axe);
  assert.ok(gun.parent === chr.object, 'the rifle went back to the body (holster)');
  vm.onAction('chop', {}, 0.9, 0.45);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 27; i++) vm.update(1 / 60, 1);
  assert.ok(vm.socketMatrix(m) && finite(new THREE.Vector3().setFromMatrixPosition(m)));
  // putting the tool away lowers it out of view first, then hands it back (no pop)
  for (let i = 0; i < 40; i++) vm.update(1 / 60, 1);
  tool.set(null);
  vm.update(1 / 60, 1);
  assert.ok(vm.item === axe, 'still lowering');
  assert.ok(vm.state.lowering);
  let n = 0;
  while (vm.item === axe && n < 120) {
    vm.update(1 / 60, 1);
    n++;
  }
  assert.ok(n > 8 && n < 60, `lowered in ${n} frames`);
  tool.set('axe', { object: axe, muzzle: axe.userData.tip.toArray(), support: axe.userData.support });
  for (let i = 0; i < 5; i++) vm.update(1 / 60, 1);
  assert.ok(vm.item === axe, 'drawn again');
  // the ready pose of the swing tools: the hip pose IS the first key of the swing (no pop when a swing starts)
  for (const [grip, track] of [['axe', 'chop'], ['pick', 'mine']]) {
    const h = GRIP_VM[grip].hip;
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(h[3], h[4], h[5], 'XYZ'));
    const k0 = VM_ACT[track][0];
    assert.ok(k0.p.distanceTo(new THREE.Vector3(h[0], h[1], h[2])) < 1e-6, `${grip} hip position = ${track} start`);
    assert.ok(Math.abs(q0.dot(k0.q)) > 0.999, `${grip} hip rotation = ${track} start (${q0.dot(k0.q).toFixed(4)})`);
  }
  // leaving FP returns the tool to the character
  vm.update(1 / 60, 0);
  assert.ok(axe.parent === chr.object);
  assert.ok(!tool.detached);
  // every grip has a pose; every action track starts / ends at the hip pose of its grip
  for (const k of Object.keys(GRIP_VM)) assert.equal(GRIP_VM[k].hip.length, 6);
  for (const [name, tr] of Object.entries(VM_ACT)) {
    if (['chop', 'mine', 'mine-laser'].includes(name)) assert.ok(tr[0].p.distanceTo(tr[tr.length - 1].p) < 1e-9, `${name} chains`);
    assert.ok(tr.every((k) => Number.isFinite(k.q.w) && Math.abs(k.q.length() - 1) < 1e-6), `${name} quats`);
  }
});

// ------------------------------------------------------------------ remotes (other players working)
test('remote avatars: work states loop swings with a tool, S.FEATURE hits swing once, remote:impact on the impact frame', async () => {
  const feats = new Set();
  const players = new Map();
  const net = { id: 'me', players, on: (t, fn) => (t === SP.FEATURE && feats.add(fn), () => feats.delete(fn)) };
  const ctx = fakeCtx({ net, engine: { camera: null } });
  ctx.camera.position.set(0, 3, 12);
  ctx.camera.lookAt(0, 1, 0);
  ctx.camera.updateMatrixWorld();
  ctx.engine.camera = ctx.camera;
  const labels = { add: () => ({}), remove() {}, setBars() {}, setDim() {}, setName() {}, say() {} };
  const remotes = createRemotes(ctx, { material: new THREE.MeshStandardMaterial(), labels, fx: null });
  const impacts = [];
  ctx.events.on('remote:impact', (e) => impacts.push({ id: e.id, action: e.action, tool: e.tool, at: e.at.clone() }));
  players.set('p2', { name: 'Bot', view: { p: [0, 0, 0], h: 0, a: 'idle', m: 'foot' } });
  remotes.add('p2', { name: 'Bot' });
  const r = remotes.get('p2');
  const step = (n) => {
    for (let i = 0; i < n; i++) remotes.update(1 / 60);
  };
  step(10);
  assert.ok(r.present);
  assert.equal(r.toolId, null);
  // 1) the anim state 'chop' (a sim that accepts the work states) loops swings with the axe
  players.get('p2').view.a = 'chop';
  step(4);
  assert.equal(r.toolId, 'axe');
  assert.equal(r.character.anim.tool, 'axe');
  assert.equal(r.work.name, 'chop');
  assert.ok(r.toolRig.object?.parent === r.object, 'the axe hangs on the avatar');
  const chop = actionTiming('chop', 'axe');
  step(Math.ceil(chop.dur * 60 * 2.3));
  assert.ok(impacts.length >= 2, `looped swings (${impacts.length})`);
  for (const e of impacts) {
    assert.equal(e.id, 'p2');
    assert.equal(e.action, 'chop');
    assert.ok(finite(e.at) && e.at.distanceTo(r.position) < 2.2, 'impact at the axe head near the avatar');
  }
  assert.equal(r.weapon, null, 'no gun while working');
  // 2) idle again: the tool goes away after the linger
  players.get('p2').view.a = 'idle';
  step(60 * 4);
  assert.equal(r.toolId, null);
  assert.ok(!r.toolRig.object, 'tool removed');
  // 3) S.FEATURE (a sim without the work states): one swing per validated hit, tool + action from the message
  const n0 = impacts.length;
  assert.equal(feats.size, 1, 'subscribed to S.FEATURE');
  for (const fn of feats) fn({ t: SP.FEATURE, id: 'r:3:4:1', state: 'hit', hp: 10, by: 'p2', tool: 'pickaxe' });
  step(2);
  assert.equal(r.toolId, 'pickaxe');
  assert.equal(r.work.name, 'mine');
  step(Math.ceil(actionTiming('mine', 'pickaxe').dur * 60) + 2);
  assert.equal(impacts.length, n0 + 1, 'exactly one swing');
  assert.equal(impacts.at(-1).action, 'mine');
  // other players' hits only (mine are mine), bare-hand picking → gather gesture, no tool
  for (const fn of feats) fn({ t: SP.FEATURE, id: 'b:1:1:2', state: 'picked', by: 'me', tool: 'hands' });
  step(2);
  assert.equal(r.work.name, null);
  for (const fn of feats) fn({ t: SP.FEATURE, id: 'b:1:1:2', state: 'picked', by: 'p2', tool: 'hands' });
  step(2);
  assert.equal(r.work.name, 'gather');
  assert.equal(r.toolId, null, 'gathering is bare-handed');
  // feature → action mapping
  assert.equal(featureAction({ id: 't:1:2:3', tool: 'multitool' }), 'chop');
  assert.equal(featureAction({ id: 'c:1:2:3', tool: 'mining-laser' }), 'mine');
  assert.equal(featureAction({ id: 'x', tool: 'plasma-axe' }), 'chop');
  assert.equal(featureAction({ id: 'x', tool: 'mining-laser' }), 'mine');
  assert.equal(featureAction({ id: 'm:9', state: 'picked' }), 'gather');
  remotes.remove('p2');
});

test('swing trails: a ribbon only through the strike, dead samples collapsed (no streaks), pooled', () => {
  const ctx = fakeCtx();
  const trails = createSwingTrails(ctx);
  const owner = {};
  const tm = actionTiming('chop', 'axe');
  assert.ok(inStrike(tm.impact - 0.05, tm.impact, tm.dur) && inStrike(tm.impact + 0.02, tm.impact, tm.dur));
  assert.ok(!inStrike(0.1, tm.impact, tm.dur) && !inStrike(tm.dur * 0.8, tm.impact, tm.dur));
  const tip = new THREE.Vector3();
  const base = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    tip.set(2000 + i * 0.1, 50, -300);
    base.set(2000 + i * 0.1, 49.8, -300);
    trails.sample(owner, tip, base, 'plasma-axe');
    trails.update(1 / 60);
  }
  assert.equal(trails.active, 1);
  const mesh = ctx.world.scene.children.find((m) => m.name === 'chr-swing-trail');
  assert.ok(mesh?.visible, 'in the world scene');
  const p = mesh.geometry.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) assert.ok(Math.abs(p[i] - 2000) < 1 && Math.abs(p[i + 1] - 50) < 1 && Math.abs(p[i + 2] + 300) < 1, 'every vertex on the swing (no streak to stale points)');
  const c = mesh.geometry.attributes.color.array;
  for (let i = 3; i < c.length; i += 4) assert.ok(c[i] >= 0 && c[i] <= 0.5 && Number.isFinite(c[i]));
  for (let i = 0; i < 20; i++) trails.update(1 / 60);
  assert.equal(trails.active, 0, 'faded out');
  assert.ok(!mesh.parent, 'back in the pool');
  trails.sample(owner, tip, base, 'axe');
  assert.equal(trails.made, 1, 'reused');
  trails.drop(owner);
  assert.equal(trails.active, 0);
});
