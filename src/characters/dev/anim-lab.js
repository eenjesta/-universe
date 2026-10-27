/**
 * Dev-only animation contact sheet (not part of the game build): renders the
 * procedural animator at several phases of each state, side and 3/4 views.
 *   /src/characters/dev/anim.html?set=walk   (walk | run | sprint | air | swim | actions)
 */
import * as THREE from 'three';
import { Character } from '../character.js';
import { CharacterBatch } from '../batch.js';
import { createCharacterMaterial } from '../material.js';
import { normalizeAppearance } from '../appearance.js';

const q = Object.fromEntries(new URLSearchParams(location.search));
const W = +(q.w || 200);
const H = +(q.h || 300);
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2230);
scene.add(new THREE.HemisphereLight(0xb8c6e8, 0x40342a, 1.1));
const key = new THREE.DirectionalLight(0xfff0e0, 2.2);
key.position.set(-2, 3, -3);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffa060, 1.6);
rim.position.set(2, 2, 3);
scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const material = createCharacterMaterial({ rim: 0.6 });
const app = normalizeAppearance(q.app ? JSON.parse(q.app) : {});
const chr = new Character(app, { lod: 0, name: 'anim', seed: 5 });
const batch = new CharacterBatch({ material, parent: chr.object, name: 'anim', localBounds: new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2) });
batch.add(chr);
batch.rebuild();
scene.add(chr.object);
const camera = new THREE.PerspectiveCamera(32, W / H, 0.05, 50);
const a = chr.anim;
const out = document.getElementById('out');

function shot(label, view = 'side') {
  const d = 4.2;
  const az = view === 'side' ? Math.PI / 2 : view === 'front' ? 0.2 : view === 'back' ? Math.PI - 0.5 : 0.75;
  camera.position.set(Math.sin(az) * -d, 1.05, -Math.cos(az) * d);
  camera.lookAt(0, 0.95 + a.hipOff.y * 0.5, 0);
  chr.object.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.drawImage(renderer.domElement, 0, 0);
  g.fillStyle = '#fff';
  g.font = '12px sans-serif';
  g.fillText(label, 6, 16);
  out.appendChild(c);
}

function reset() {
  for (const k of Object.keys(a.targets)) a.targets[k] = 0;
  a.speed = 0;
  a.grounded = true;
  a.swimming = false;
  a.vy = 0;
  a.turnRate = 0;
  a.settle();
}

function cycle(speed, n, view, label) {
  reset();
  a.speed = speed;
  for (let i = 0; i < 90; i++) a.update(1 / 30); // settle blend weights
  const start = a.phase;
  for (let k = 0; k < n; k++) {
    // advance to the next phase sample
    const target = (start + k / n) % 1;
    let guard = 0;
    while (Math.abs(((a.phase - target + 1.5) % 1) - 0.5) > 0.012 && guard++ < 400) a.update(1 / 240);
    shot(`${label} ${(k / n).toFixed(2)}`, view);
  }
}

const set = q.set || 'walk';
const view = q.view || 'side';
if (set === 'walk') cycle(1.6, 8, view, 'walk');
else if (set === 'jog') cycle(4.4, 8, view, 'jog');
else if (set === 'sprint') cycle(7.7, 8, view, 'sprint');
else if (set === 'air') {
  reset();
  a.grounded = false;
  for (const vy of [6, 3, 0, -3, -6, -10]) {
    a.vy = vy;
    for (let i = 0; i < 30; i++) a.update(1 / 30);
    shot(`air vy=${vy}`, view);
  }
  a.grounded = true;
  a.land(9);
  for (let i = 0; i < 3; i++) a.update(1 / 30);
  shot('land', view);
} else if (set === 'swim') {
  reset();
  a.swimming = true;
  a.grounded = true;
  a.speed = 0;
  for (let i = 0; i < 60; i++) a.update(1 / 30);
  shot('tread', view);
  a.speed = 2.1;
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < 8; i++) a.update(1 / 30);
    shot(`swim ${k}`, view);
  }
} else if (set === 'actions') {
  for (const act of ['talk', 'wave', 'cheer', 'clap', 'tablet', 'sit']) {
    reset();
    a.set(act, 1);
    for (let i = 0; i < 40; i++) a.update(1 / 30);
    shot(act, view);
  }
  reset();
  for (let i = 0; i < 40; i++) a.update(1 / 30);
  shot('idle', view);
}
window.__game = { ready: true, debug: { info: () => ({ shots: out.children.length }) } };
