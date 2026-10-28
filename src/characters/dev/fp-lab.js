/**
 * Dev-only contact sheet (not part of the game build) for the work actions and the
 * first-person view model, without the world:
 *   /src/characters/dev/fp-lab.html?set=3p   third-person action poses (chop, mine, laser, gather, eat, use, build)
 *   /src/characters/dev/fp-lab.html?set=fp   first-person frames (guns hip / ADS / sprint / reload, tools, gestures)
 * Params: w, h (tile size), app (appearance JSON), view (3p: 'side' | 'front' | 'three'), light (day | sunset | night),
 * only (fp: comma-separated frame labels to render).
 */
import * as THREE from 'three';
import { Character } from '../character.js';
import { CharacterBatch } from '../batch.js';
import { createCharacterMaterial } from '../material.js';
import { normalizeAppearance } from '../appearance.js';
import { WeaponRig, solveGesture } from '../weapon-rig.js';
import { createToolModel, createFoodModel } from '../tool-models.js';
import { actionTiming } from '../tool-actions.js';
import { createViewModel } from '../viewmodel.js';
import { createWeaponModel, HOLD } from '../../combat/models.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const q = Object.fromEntries(new URLSearchParams(location.search));
const W = +(q.w || 240);
const H = +(q.h || 300);
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6d86a8);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const hemi = new THREE.HemisphereLight(0xc8d6f0, 0x4a3c2c, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2c0, 2.6);
sun.position.set(-3, 5, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -4;
sun.shadow.camera.right = sun.shadow.camera.top = 4;
scene.add(sun);
scene.add(sun.target);
// lighting presets (?light=day | sunset | night): the view-model fill must keep the arms readable when backlit
if (q.light === 'sunset') {
  sun.position.set(0.6, 0.45, -3);
  sun.color.set(0xffa060);
  sun.intensity = 1.8;
  hemi.color.set(0x8a7ca8);
  hemi.groundColor.set(0x3a2820);
  hemi.intensity = 0.55;
  scene.background = new THREE.Color(0xd89a70);
  scene.environmentIntensity = 0.3;
} else if (q.light === 'night') {
  sun.position.set(-1.5, 2.2, -3);
  sun.color.set(0x8fb0ff);
  sun.intensity = 0.35;
  hemi.color.set(0x24304a);
  hemi.groundColor.set(0x10141c);
  hemi.intensity = 0.25;
  scene.background = new THREE.Color(0x0d1424);
  scene.environmentIntensity = 0.12;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const out = document.getElementById('out');
const material = createCharacterMaterial({ rim: 0.5 });
const app = normalizeAppearance(q.app ? JSON.parse(q.app) : {});

function tile(label, cam) {
  renderer.render(scene, cam);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.drawImage(renderer.domElement, 0, 0);
  g.fillStyle = '#fff';
  g.font = '12px sans-serif';
  g.fillText(label, 6, 16);
  out.appendChild(c);
  return g;
}

// ------------------------------------------------------------------ 3P sheet
function sheet3p() {
  const chr = new Character(app, { lod: 0, name: 'lab', seed: 5 });
  const batch = new CharacterBatch({ material, parent: chr.object, name: 'lab', localBounds: new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.2) });
  batch.add(chr);
  batch.rebuild();
  scene.add(chr.object);
  // target: a tree trunk + a rock in front
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 4, 14), new THREE.MeshStandardMaterial({ color: 0x5a4130, roughness: 0.9 }));
  trunk.position.set(0, 2, -1.35);
  trunk.castShadow = true;
  scene.add(trunk);
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.9 }));
  rock.position.set(0.9, 0.25, -1.3);
  scene.add(rock);
  const tool = new WeaponRig(chr, { tool: true });
  const a = chr.anim;
  const cam = new THREE.PerspectiveCamera(34, W / H, 0.05, 60);
  const view = q.view || 'three';
  const az = view === 'side' ? Math.PI / 2 : view === 'front' ? 0.25 : view === 'back' ? Math.PI - 0.6 : 0.85;
  const foodObj = createFoodModel(q.food || 'jungle-fruit');
  chr.object.add(foodObj);
  const im = new THREE.Matrix4();
  const runs = [
    ['chop', 'axe', [0, 0.25, 0.4, 0.47, 0.5, 0.62, 0.85]],
    ['chop', 'plasma-axe', [0.4, 0.5]],
    ['mine', 'pickaxe', [0.25, 0.42, 0.52, 0.66]],
    ['mine', 'mining-laser', [0.1, 0.4]],
    ['gather', null, [0.25, 0.47, 0.7]],
    ['eat', null, [0.3, 0.5]],
    ['use', null, [0.47]],
    ['build', null, [0.42]],
  ];
  for (const [name, toolId, phases] of runs) {
    let model = null;
    if (toolId) {
      model = createToolModel(toolId);
      tool.set(toolId === 'pickaxe' ? 'pick' : toolId === 'mining-laser' ? 'laser' : 'axe', { object: model, muzzle: model.userData.tip.toArray(), support: model.userData.support });
    } else tool.set(null);
    const tm = actionTiming(name, toolId);
    for (const ph of phases) {
      // settle: run the action from the start to the phase
      a.stopAction();
      for (let i = 0; i < 30; i++) a.update(1 / 30);
      a.action(name, tm.dur);
      const steps = Math.max(1, Math.round((ph * tm.dur) / (1 / 120)));
      for (let i = 0; i < steps; i++) a.update(1 / 120);
      a.update(0);
      if (toolId) tool.update(true);
      else solveGesture(chr, true, im);
      foodObj.visible = name === 'eat';
      if (name === 'eat') {
        foodObj.position.copy(a.itemPos);
        foodObj.quaternion.copy(a.itemQuat);
      }
      const d = 4.1;
      cam.position.set(-Math.sin(az) * d, 1.25, -Math.cos(az) * d * (view === 'back' ? -1 : 1));
      if (view === 'back') cam.position.set(Math.sin(0.6) * d, 1.6, Math.cos(0.6) * d);
      cam.lookAt(0, 1.0, -0.3);
      chr.object.updateMatrixWorld(true);
      tile(`${name}${toolId ? ` ${toolId}` : ''} ${ph.toFixed(2)}${Math.abs(ph - tm.impact / tm.dur) < 0.02 ? ' IMPACT' : ''}`, cam);
    }
    if (model) model.removeFromParent();
  }
}

// ------------------------------------------------------------------ FP sheet
function sheetFp() {
  const chr = new Character(app, { lod: 1, name: 'fp', seed: 7, deferLoad: true });
  const weapon = new WeaponRig(chr);
  const tool = new WeaponRig(chr, { tool: true });
  const camera = new THREE.PerspectiveCamera(70, W / H, 0.06, 500);
  camera.position.set(0, 1.62, 0);
  camera.rotation.set(-0.06, 0, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  // a world to look at
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 6, 16), new THREE.MeshStandardMaterial({ color: 0x5a4130, roughness: 0.9 }));
  trunk.position.set(0.05, 3, -1.25);
  scene.add(trunk);
  for (let i = 0; i < 6; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + i * 0.1, 0), new THREE.MeshStandardMaterial({ color: 0x7b746a, roughness: 0.9 }));
    r.position.set(-6 + i * 2.6, 0.3, -9 - i);
    scene.add(r);
  }
  const player = {
    character: chr,
    weaponRig: weapon,
    toolRig: tool,
    appearance: app,
    velocity: new THREE.Vector3(),
    aiming: false,
    sprinting: false,
    grounded: true,
    swimming: false,
    dead: false,
  };
  const ctx = {
    camera,
    engine: null,
    world: { scene, sun, hemi, sunDirection: sun.position.clone().normalize(), waterLevel: 0 },
    modes: { is: (m) => m === 'explore' },
    input: { lookX: 0, lookY: 0 },
    state: { get: () => undefined },
    cameraRig: { shake() {} },
  };
  const vm = createViewModel(ctx, { player });
  const models = {};
  const gun = (id) => (models[id] ||= createWeaponModel(id));
  function holdWeapon(id) {
    tool.set(null);
    const m = gun(id);
    const h = HOLD[id];
    weapon.set(h.grip, { object: m.group, muzzle: h.muzzle, support: h.support, stock: h.stock });
  }
  function holdTool(id) {
    const m = (models[id] ||= createToolModel(id));
    tool.set(id === 'pickaxe' ? 'pick' : id === 'mining-laser' ? 'laser' : 'axe', { object: m, muzzle: m.userData.tip.toArray(), support: m.userData.support });
  }
  const only = q.only ? q.only.split(',') : null;
  function frame(label, setup, t = 0.6) {
    setup();
    if (only && !only.includes(label)) {
      for (let i = 0; i < Math.round(t * 60); i++) {
        chr.anim.update(1 / 60);
        vm.update(1 / 60, 1);
      }
      return;
    }
    for (let i = 0; i < Math.round(t * 60); i++) {
      chr.anim.update(1 / 60);
      vm.update(1 / 60, 1);
    }
    renderer.autoClear = true;
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(vm.scene, vm.camera);
    renderer.autoClear = true;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.drawImage(renderer.domElement, 0, 0);
    // crosshair + muzzle marker (projected into the world camera)
    g.strokeStyle = 'rgba(255,255,255,.7)';
    g.beginPath();
    g.arc(W / 2, H / 2, 3, 0, Math.PI * 2);
    g.stroke();
    const mz = new THREE.Vector3();
    if (vm.muzzleWorld(mz)) {
      mz.project(camera);
      g.strokeStyle = '#ff4060';
      g.strokeRect(((mz.x + 1) / 2) * W - 3, ((1 - mz.y) / 2) * H - 3, 6, 6);
    }
    g.fillStyle = '#fff';
    g.font = '12px sans-serif';
    g.fillText(label, 6, 16);
    out.appendChild(c);
  }
  const act = (name, x, toolId) => {
    const tm = actionTiming(name, toolId);
    vm.onAction(name, { item: 'berries' }, tm.dur, tm.impact);
    let n = Math.round((x * tm.dur) * 60);
    for (let i = 0; i < n; i++) vm.update(1 / 60, 1);
  };
  const reset = () => {
    player.aiming = false;
    player.sprinting = false;
    player.velocity.set(0, 0, 0);
  };
  frame('rifle hip', () => (reset(), holdWeapon('plasma-rifle')));
  frame('rifle ADS', () => (reset(), (player.aiming = true)));
  frame('rifle sprint', () => (reset(), (player.sprinting = true), player.velocity.set(0, 0, -7.5)));
  frame('rifle reload 0.45', () => (reset(), vm.onAction('reload', {}, 1.45)), 0.65);
  frame('rifle recoil', () => (reset(), vm.onAction('shoot', { recoil: 0.7 })), 0.04);
  frame('pistol hip', () => (reset(), holdWeapon('pulse-pistol')));
  frame('pistol ADS', () => (reset(), (player.aiming = true)));
  frame('railgun hip', () => (reset(), holdWeapon('railgun')));
  frame('railgun ADS', () => (reset(), (player.aiming = true)));
  frame('grenade', () => (reset(), holdWeapon('shock-grenade')));
  frame('axe ready', () => (reset(), weapon.set(null), holdTool('axe')));
  frame('chop wind-up', () => (reset(), act('chop', 0.38, 'axe')), 0.0);
  frame('chop impact', () => (reset(), act('chop', 0.5, 'axe')), 0.0);
  frame('pickaxe ready', () => (reset(), holdTool('pickaxe')));
  frame('mine wind-up', () => (reset(), act('mine', 0.42, 'pickaxe')), 0.0);
  frame('mine impact', () => (reset(), act('mine', 0.53, 'pickaxe')), 0.0);
  frame('plasma-axe', () => (reset(), holdTool('plasma-axe')));
  frame('laser mining', () => (reset(), holdTool('mining-laser'), act('mine', 0.5, 'mining-laser')), 0.0);
  frame('gather reach', () => (reset(), tool.set(null), act('gather', 0.46)), 0.0);
  frame('eat bite', () => (reset(), act('eat', 0.5)), 0.0);
  frame('use press', () => (reset(), act('use', 0.47)), 0.0);
}

const set = q.set || '3p';
try {
  if (set === 'fp') sheetFp();
  else sheet3p();
} catch (err) {
  console.error('[fp-lab] failed', err);
}
window.__game = { ready: true, debug: { info: () => ({ shots: out.children.length, errors: [] }) } };
