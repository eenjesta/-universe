/**
 * Dev-only atmosphere lab (not part of the game build): boots the real core
 * engine/post chain with only the world (terrain + atmosphere) and,
 * optionally, the landmarks — much faster to iterate on sky, water and light
 * than the full game. Exposes window.__game (ready, debug.frames, info) so
 * tools/shot.mjs can capture it.
 *
 *   /src/world/atmosphere/dev/lab.html?view=hero&time=17.6&lm=1&quality=high
 *   views: hero (title framing), high, city, waterfall, signal, base, planet, islands
 *   custom: &p=x,y,z&l=x,y,z&fov=50   (y values are metres above the ground with &rel=1)
 */
import * as THREE from 'three';
import { Engine } from '../../../core/engine.js';
import { Loop } from '../../../core/loop.js';
import { Events } from '../../../core/events.js';
import { State } from '../../../core/state.js';
import { Physics } from '../../../core/physics.js';
import { Markers } from '../../../core/markers.js';
import { ZONES } from '../../layout.js';
import { install as installWorld } from '../../index.js';
import { TitleCamera } from '../../../shell/title/titleCamera.js';

const q = Object.fromEntries(new URLSearchParams(location.search));
const info = document.getElementById('lab-info');

const events = new Events();
const state = new State(events, { persist: false });
const engine = new Engine(document.getElementById('gl'), q.quality || 'high');
engine.events = events;
const loop = new Loop();
const ctx = {
  THREE,
  params: q,
  events,
  state,
  engine,
  loop,
  physics: new Physics(),
  markers: new Markers(events),
  camera: new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 6000),
  input: { mouse: { x: 0, y: 0, ndcX: 0, ndcY: 0 } },
  modes: { name: 'explore', is: (...n) => n.includes('explore'), current: null },
  errors: [],
  ready: false,
};
const frames = (n = 1) =>
  new Promise((res) => {
    const target = loop.frame + n;
    const check = () => (loop.frame >= target ? res() : requestAnimationFrame(check));
    check();
  });
window.__game = ctx;
ctx.debug = {
  frames,
  info: () => ({
    drawCalls: engine.renderer.info.render.calls,
    triangles: engine.renderer.info.render.triangles,
    textures: engine.renderer.info.memory.textures,
    geometries: engine.renderer.info.memory.geometries,
    errors: ctx.errors,
    fps: Math.round(loop.fps),
  }),
  simulate(seconds = 1, { dt = 1 / 30 } = {}) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) loop.step(dt);
  },
};

loop.render = (dt, t) => engine.render(dt, t);
loop.start();

const t0 = performance.now();
const world = await installWorld(ctx, { progress: (p) => (info.textContent = `laden ${Math.round(p * 100)}%`) });
ctx.world = world;
if (q.lm === '1') {
  try {
    const lm = await import('../../../landmarks/index.js');
    ctx.landmarks = await lm.install(ctx, {});
  } catch (err) {
    console.error('[lab] landmarks failed', err);
  }
}

// ------------------------------------------------------------ stand-in hero
const spawn = ZONES.spawn;
const ground = (x, z) => world.getHeightAt(x, z);
const player = new THREE.Group();
if (q.player !== '0') {
  const mat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 1.15, 4, 12), mat);
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ color: 0x9c6b4b, roughness: 0.7 }));
  head.position.y = 1.68;
  body.castShadow = head.castShadow = true;
  player.add(body, head);
  player.position.set(spawn.x, ground(spawn.x, spawn.z), spawn.z);
  world.scene.add(player);
}
ctx.player = { position: player.position, object: player };

// ------------------------------------------------------------ views
const H = (x, z, dy) => ground(x, z) + dy;
const VIEWS = {
  high: () => ({ p: [-40, H(-40, 210, 45), 210], l: [160, 40, -700], fov: 50 }),
  city: () => ({ p: [0, H(0, 154, 1.8), 154], l: [60, 70, -820], fov: 55 }),
  waterfall: () => ({ p: [-250, 22, -318], l: [-318, 22, -236], fov: 55 }),
  signal: () => ({ p: [-112, H(-112, -118, 1.7), -118], l: [-40, 30, -600], fov: 55 }),
  base: () => ({ p: [-200, H(-200, 300, 1.8), 300], l: [-262, H(-262, 342, 4), 342], fov: 55 }),
  planet: () => ({ p: [0, H(0, 150, 1.8), 150], l: [-25, 360, -820], fov: 55 }),
  islands: () => ({ p: [-120, H(-120, -60, 30), -60], l: [-235, 170, -335], fov: 55 }),
  river: () => ({ p: [-585, H(-585, -118, 16), -118], l: [-420, 40, -205], fov: 55 }),
  lookout: () => ({ p: [-280, H(-280, 30, 20), 30], l: [80, 10, -560], fov: 60 }),
};
const title = new TitleCamera(ctx);
let current = null;
const vec = (s) => s.split(',').map(Number);
function setView(name, opts = {}) {
  if (name === 'hero') {
    current = 'hero';
    title.begin(false);
    return;
  }
  const v = VIEWS[name] ? VIEWS[name]() : null;
  current = v || current;
}
if (q.p && q.l) {
  const p = vec(q.p);
  const l = vec(q.l);
  if (q.rel === '1') {
    p[1] = H(p[0], p[2], p[1]);
  }
  current = { p, l, fov: Number(q.fov || 55) };
} else setView(q.view || 'hero');

const cam = ctx.camera;
loop.add(
  'lab-camera',
  (dt) => {
    if (current === 'hero') {
      title.update(dt);
      return;
    }
    if (!current) return;
    cam.position.set(...current.p);
    cam.lookAt(...current.l);
    if (cam.fov !== current.fov) {
      cam.fov = current.fov;
      cam.updateProjectionMatrix();
    }
  },
  { order: 20 },
);
engine.setView(world.scene, cam);
if (q.time != null) world.setTimeOfDay(Number(q.time));
// &refl=1 forces the planar reflection on medium quality (faster headless iteration)
if (q.refl === '1' && world.atmosphere?.reflection) world.atmosphere.reflection.state.enabled = true;
if (q.ui === '0') info.style.display = 'none';
state.data.settings.timeFlow = q.flow === '1';

/** Custom camera: { p: [x, y, z], l: [x, y, z], fov }. */
function setCustom(v) {
  current = { p: v.p, l: v.l, fov: v.fov || 55 };
}
ctx.lab = { setView, setCustom, views: VIEWS, title, player };
await frames(2);
ctx.ready = true;
info.textContent = `lab klaar in ${Math.round(performance.now() - t0)} ms`;
console.log(`[atmo-lab] ready in ${Math.round(performance.now() - t0)} ms`);
