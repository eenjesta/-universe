/**
 * Dev-only space lab (not part of the game build): boots the real core
 * (engine + post chain, loop, input, UI, modes, interactions, markers, audio
 * facade) with ONLY the space module — loads in seconds instead of a minute.
 * Exposes window.__game like the game (ready, debug.frames/simulate/info) so
 * tools/shot.mjs can drive it.
 *
 *   /src/space/dev/lab.html?stage=station&quality=low      full space mode
 *   /src/space/dev/lab.html?view=ship&variant=player&yaw=30&pitch=12&dist=24   model studio
 *   /src/space/dev/lab.html?view=models                    all side models in a row
 */
import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import '../../ui/base.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Engine } from '../../core/engine.js';
import { Loop } from '../../core/loop.js';
import { Input } from '../../core/input.js';
import { Events } from '../../core/events.js';
import { State } from '../../core/state.js';
import { Physics } from '../../core/physics.js';
import { Interactions } from '../../core/interactions.js';
import { Markers } from '../../core/markers.js';
import { Modes } from '../../core/modes.js';
import { UI } from '../../core/ui.js';
import { AudioEngine } from '../../core/audio.js';
import { i18n, initLanguage } from '../../core/i18n.js';

const params = Object.fromEntries([...new URLSearchParams(location.search)].map(([k, v]) => [k, v === '' ? true : v]));
initLanguage(params.lang || 'en');
const events = new Events();
const state = new State(events, { persist: false });
const engine = new Engine(document.getElementById('gl'), params.quality || 'high', params);
engine.events = events;
const loop = new Loop();
const input = new Input(document.getElementById('gl'), events);
const ctx = {
  THREE,
  params,
  events,
  state,
  engine,
  loop,
  input,
  physics: new Physics(),
  markers: new Markers(events),
  audio: new AudioEngine(events),
  camera: new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 6000),
  ready: false,
  errors: [],
};
ctx.i18n = i18n;
ctx.ui = new UI(ctx);
ctx.modes = new Modes(ctx);
ctx.interactions = new Interactions(ctx);
window.__game = ctx;

const waitFrames = (n) =>
  new Promise((res) => {
    const target = loop.frame + n;
    const check = () => (loop.frame >= target ? res() : requestAnimationFrame(check));
    check();
  });
ctx.debug = {
  frames: waitFrames,
  go: (m, p) => ctx.modes.go(m, p || {}),
  simulate(seconds = 1, { hold = [], press = [], look = null, dt = 1 / 30 } = {}) {
    const steps = Math.max(1, Math.round(seconds / dt));
    hold.forEach((c) => input.keys.add(c));
    for (let i = 0; i < steps; i++) {
      if (i === 0) press.forEach((c) => (input.keys.add(c), input._pressed.add(c)));
      if (look) {
        input.lookX = (look[0] / steps) * input.sensitivity;
        input.lookY = (look[1] / steps) * input.sensitivity;
      }
      loop.step(dt);
      if (i === 0) press.forEach((c) => input.keys.delete(c) || input._released.add(c));
    }
    hold.forEach((c) => input.keys.delete(c));
    return { steps, time: loop.time };
  },
  info: () => ({
    mode: ctx.modes.name,
    fps: Math.round(loop.fps),
    errors: ctx.errors,
    drawCalls: engine.renderer.info.render.calls,
    triangles: engine.renderer.info.render.triangles,
    geometries: engine.renderer.info.memory.geometries,
    textures: engine.renderer.info.memory.textures,
  }),
};

loop.add('modes', (dt, t) => ctx.modes.update(dt, t), { order: 20 });
loop.add('interactions', (dt) => ctx.interactions.update(dt), { order: 45 });
loop.add('ui-prompts', () => ctx.ui.prompt.update(), { order: 96, pausable: false });
loop.render = (dt, t) => engine.render(dt, t);
loop.afterFrame = () => input.endFrame();
engine.setView(ctx.modes.current.scene, ctx.modes.current.camera);
loop.start();

async function studio() {
  const { createShipModel } = await import('../ship-model.js');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d14);
  const pm = new THREE.PMREMGenerator(engine.renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  const sun = new THREE.DirectionalLight(0xffe2c0, 3.2);
  sun.position.set(30, 22, -18);
  scene.add(sun, new THREE.HemisphereLight(0x5a6a90, 0x101010, 0.6));
  const cam = new THREE.PerspectiveCamera(Number(params.fov || 40), innerWidth / innerHeight, 0.1, 2000);
  const objs = [];
  if (params.view === 'models') {
    const m = await import('../models.js');
    const list = [createShipModel({ variant: 'player' }), m.createPirateModel(), m.createFreighterModel(), m.createShuttleModel()];
    let x = -30;
    for (const o of list) {
      o.position.x = x;
      x += 22;
      objs.push(o);
    }
  } else {
    const ship = createShipModel({ variant: params.variant || 'player', gear: !!params.gear });
    ship.userData.setThrust(Number(params.thrust ?? 0.6), Number(params.boost ?? 0));
    objs.push(ship);
  }
  objs.forEach((o) => scene.add(o));
  const yaw = (Number(params.yaw ?? 35) * Math.PI) / 180;
  const pitch = (Number(params.pitch ?? 14) * Math.PI) / 180;
  const dist = Number(params.dist ?? 26);
  cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
  cam.lookAt(0, 0, 0);
  ctx.modes.register('studio', { scene, camera: cam, pointerLock: false, hud: 'none', update: (dt, t) => objs.forEach((o) => o.userData.update?.(t)) });
  await ctx.modes.go('studio', {}, { fade: false });
}

async function full() {
  try {
    const mod = await import('../index.js');
    ctx.space = await mod.install(ctx, { progress: () => {} });
  } catch (err) {
    console.error('[lab] space install failed', err);
    ctx.errors.push({ module: 'space', error: String(err?.stack || err) });
    return;
  }
  events.emit('game:installed', ctx);
  await ctx.modes.go('space', { initial: true, from: params.from || null }, { fade: false });
}

(params.view ? studio() : full()).then(async () => {
  await waitFrames(3);
  ctx.ready = true;
  events.emit('game:ready', ctx);
});
