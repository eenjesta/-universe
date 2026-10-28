/**
 * Dev-only vehicles lab (not part of the game build): the real core engine +
 * post chain with only the vehicle models in the studio scene — fast model
 * iteration under SwiftShader. Exposes window.__game {ready, debug.frames, info}.
 *
 *   /src/vehicles/dev/lab.html?model=car|vtol|ship|colony|fleet&view=three-quarter|front|side|rear|top|low
 *        &zoom=1&skin=skin-car-sunset&rotor=1&tilt=0.4&gear=0&quality=high
 */
import * as THREE from 'three';
import { Engine } from '../../core/engine.js';
import { Loop } from '../../core/loop.js';
import { createVehicleMaterials, applySkin, SKINS } from '../materials.js';
import { createCarModel } from '../car-model.js';
import { createVtolModel } from '../vtol-model.js';
import { createColonyShipModel } from '../colony-model.js';
import { loadShipFactory, wrapShip } from '../ship-model.js';
import { createStudio } from '../studio.js';

const q = Object.fromEntries(new URLSearchParams(location.search));
const info = document.getElementById('lab-info');
const engine = new Engine(document.getElementById('gl'), q.quality || 'high', q);
const loop = new Loop();
engine.bloom.strength = Number(q.bloom || 0.3);
const ctx = { engine, loop, errors: [], ready: false };
window.__game = ctx;
ctx.debug = {
  frames: (n = 1) =>
    new Promise((res) => {
      const target = loop.frame + n;
      const check = () => (loop.frame >= target ? res() : requestAnimationFrame(check));
      check();
    }),
  info: () => ({ drawCalls: engine.renderer.info.render.calls, triangles: engine.renderer.info.render.triangles, errors: ctx.errors }),
};

const mats = createVehicleMaterials();
const studio = createStudio(engine.renderer, { sky: q.sky || 'sunset' });
let obj;
const kind = q.model || 'car';
if (kind === 'car') {
  obj = createCarModel(mats);
  if (q.skin) applySkin(obj.userData.paint, SKINS.car[q.skin]);
  if (q.steer) obj.userData.wheels.setPose(Number(q.steer), 0);
  if (q.beams) obj.userData.lights.beams.visible = true;
} else if (kind === 'vtol') {
  obj = createVtolModel(mats);
  obj.userData.setRotor(Number(q.rotor || 0), 0.3);
  obj.userData.setTilt(Number(q.tilt || 0));
  if (q.gear) obj.userData.setGear(Number(q.gear));
} else if (kind === 'ship') {
  const f = await loadShipFactory(mats);
  obj = wrapShip(f.create({ variant: q.skin === 'gold' ? 'gold' : 'player', gear: true }), mats);
  info.textContent = `ship source: ${f.source}`;
} else if (kind === 'colony') {
  obj = createColonyShipModel({ length: Number(q.len || 150), legs: q.legs !== '0' });
} else if (kind === 'fleet') {
  obj = new THREE.Group();
  const car = createCarModel(mats);
  car.position.set(-6, 0, 4);
  car.rotation.y = 0.5;
  const v = createVtolModel(mats);
  v.position.set(4, 0, -2);
  v.rotation.y = -0.4;
  obj.add(car, v);
}
studio.show(obj);
const aspect = innerWidth / innerHeight;
studio.frame(obj, q.view || 'three-quarter', { zoom: Number(q.zoom || 1), aspect, fov: Number(q.fov || 30) });
if (q.p) {
  const [x, y, z] = q.p.split(',').map(Number);
  studio.camera.position.set(x, y, z);
  const [lx, ly, lz] = (q.l || '0,1,0').split(',').map(Number);
  studio.camera.lookAt(lx, ly, lz);
}
engine.setView(studio.scene, studio.camera);
loop.render = (dt, t) => engine.render(dt, t);
loop.add('spin', (dt) => {
  if (kind === 'vtol' && q.rotor) obj.userData.setRotor(Number(q.rotor), dt);
  obj.userData?.update?.(dt);
});
loop.start();
await ctx.debug.frames(3);
ctx.ready = true;
