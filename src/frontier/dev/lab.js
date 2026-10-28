/**
 * Frontier dev lab (not part of the game build): boots the real core engine /
 * post chain with the hub world (terrain + atmosphere) and the frontier around
 * it. Fly camera, teleport, views, biome overlay, time of day, quality, stats,
 * minimap. Exposes window.__game (ready, loop, debug.frames, debug.info) for
 * tools/shot.mjs.
 *
 *   /src/frontier/dev/lab.html?view=seam-west&time=17.6&quality=high
 *   custom: &x=…&z=…&alt=…&yaw=…(deg, 0 = north)&pitch=…(deg)&fov=…  &overlay=biomes|rules  &ui=0  &seed=…
 *   overlay=rules shows the §11.2 build verdict on the terrain + minimap (the 'rules' view frames the West gate)
 */
import * as THREE from 'three';
import { Engine } from '../../core/engine.js';
import { Loop } from '../../core/loop.js';
import { Events } from '../../core/events.js';
import { State } from '../../core/state.js';
import { Physics } from '../../core/physics.js';
import { Markers } from '../../core/markers.js';
import { install as installWorld } from '../../world/index.js';
import { createFrontierWorld } from '../index.js';

const q = Object.fromEntries(new URLSearchParams(location.search));
const $ = (id) => document.getElementById(id);
const events = new Events();
const state = new State(events, { persist: false });
const quality = q.quality || 'high';
const engine = new Engine($('gl'), quality);
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
  camera: new THREE.PerspectiveCamera(Number(q.fov || 55), innerWidth / innerHeight, 0.15, 6000),
  input: { mouse: { x: 0, y: 0, ndcX: 0, ndcY: 0 } },
  modes: { name: 'explore', is: (...n) => n.includes('explore'), current: null },
  errors: [],
  ready: false,
};
window.__game = ctx;
if (q.ui === '0') document.body.classList.add('ui-off');
const frames = (n = 1) =>
  new Promise((res) => {
    const target = loop.frame + n;
    const check = () => (loop.frame >= target ? res() : requestAnimationFrame(check));
    check();
  });
loop.render = (dt, t) => engine.render(dt, t);
loop.start();
addEventListener('resize', () => {
  ctx.camera.aspect = innerWidth / innerHeight;
  ctx.camera.updateProjectionMatrix();
});

const t0 = performance.now();
const world = await installWorld(ctx, { progress: (p) => ($('stats').textContent = `hub world ${Math.round(p * 100)}%`) });
ctx.world = world;
engine.setView(world.scene, ctx.camera);
// the frontier replaces the hub's distant backdrop mountains
if (world.terrain?.backdrop?.mesh) world.terrain.backdrop.mesh.visible = false;
state.data.settings = state.data.settings || {};
state.data.settings.timeFlow = q.flow === '1';

const frontier = createFrontierWorld(ctx, { seed: q.seed || 'o-universe', quality, renderNodes: q.nodes !== '0' });
ctx.frontier = frontier;
const wg = frontier.worldgen;
loop.add('frontier', (dt) => frontier.update(dt, ctx.camera), { order: 12 });

// ------------------------------------------------------------------ views
const VIEWS = {
  // from inside the hub, above the mountain-ring passes where the highways leave it, looking out
  'seam-west': { p: [-1150, 40, -42], yaw: 90, pitch: -12, time: 16.4 },
  'seam-south': { p: [-194, 50, 1100], yaw: 180, pitch: -10, time: 16.4 },
  'seam-east': { p: [1100, 40, 139], yaw: -90, pitch: -8, time: 16.4 },
  'seam-north': { p: [-1190, 8, -900], yaw: 40, pitch: -7 },
  // §11.2 keeping the hub open: build-rule overlay over the West gate (buffer ring, corridors, POIs)
  rules: { p: [-2700, 900, 900], look: [-1500, 0, -60], time: 13, overlay: 'rules' },
  // from the frontier looking back at the hub's mountain ring
  'seam-back': { p: [-2300, 160, 150], yaw: -90, pitch: -6 },
  // biome views: afternoon side light (sun ≈ NE at 16.2); POIs looked at from the south-east
  meadow: { p: [390, 10, 1962], yaw: 70, pitch: -4, time: 16.2 },
  forest: { p: [-1269, 8, 1546], yaw: 70, pitch: -3, time: 16.2 },
  jungle: { p: [-1962, 9, 390], yaw: 70, pitch: -3, time: 16.2 },
  highlands: { p: [2778, 26, 4157], yaw: 70, pitch: -6, time: 16.2 },
  badlands: { p: [1990, 24, -196], yaw: 160, pitch: -5, time: 16.2 },
  peaks: { p: [1073, 60, 5394], yaw: 70, pitch: -2, time: 15.2 },
  mountains: { p: [2500, 240, 5200], yaw: 90, pitch: -7, time: 16.2 },
  coast: { p: [-3868, 12, -6100], yaw: 20, pitch: -5, time: 17.6 },
  ruin: { poi: 'ruin', time: 16.2 },
  outpost: { poi: 'outpost', time: 16.2 },
  wreck: { poi: 'wreck', time: 16.2 },
  highway: { p: [-3000, 6, 60], yaw: 90, pitch: -3, time: 16.2 },
  'jungle-night': { p: [-1962, 4, 390], yaw: 70, pitch: -2, time: 22.5 },
  'forest-night': { p: [-1269, 4, 1546], yaw: 70, pitch: -2, time: 22.5 },
  far: { p: [12500, 60, -6200], yaw: 45, pitch: -5, time: 16.2 },
  'far-100k': { p: [100000, 40, -100000], yaw: 70, pitch: -6, time: 16.2 },
  aerial: { p: [0, 1400, 2600], yaw: 180, pitch: -38, time: 16.2 },
};
for (const name of Object.keys(VIEWS)) {
  const o = document.createElement('option');
  o.textContent = name;
  $('views').appendChild(o);
}

// ------------------------------------------------------------------ fly camera
const cam = ctx.camera;
const fly = { yaw: 0, pitch: 0, speed: Number(q.speed || 40), alt: 30 };
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('wheel', (e) => (fly.speed = Math.min(2000, Math.max(2, fly.speed * (e.deltaY > 0 ? 0.85 : 1.18)))), { passive: true });
$('gl').addEventListener('click', () => $('gl').requestPointerLock?.());
let drag = null;
$('gl').addEventListener('mousedown', (e) => (drag = [e.clientX, e.clientY]));
addEventListener('mouseup', () => (drag = null));
addEventListener('mousemove', (e) => {
  const locked = document.pointerLockElement === $('gl');
  if (!locked && !drag) return;
  fly.yaw -= e.movementX * 0.0025;
  fly.pitch = Math.max(-1.5, Math.min(1.5, fly.pitch - e.movementY * 0.0025));
});
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
function applyCam() {
  cam.rotation.set(fly.pitch, fly.yaw, 0, 'YXZ');
  cam.updateMatrixWorld();
}
loop.add(
  'lab-fly',
  (dt) => {
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6 : 1;
    const v = fly.speed * boost * dt;
    fwd.set(-Math.sin(fly.yaw) * Math.cos(fly.pitch), Math.sin(fly.pitch), -Math.cos(fly.yaw) * Math.cos(fly.pitch));
    right.set(Math.cos(fly.yaw), 0, -Math.sin(fly.yaw));
    if (keys.has('KeyW')) cam.position.addScaledVector(fwd, v);
    if (keys.has('KeyS')) cam.position.addScaledVector(fwd, -v);
    if (keys.has('KeyD')) cam.position.addScaledVector(right, v);
    if (keys.has('KeyA')) cam.position.addScaledVector(right, -v);
    if (keys.has('Space')) cam.position.y += v;
    if (keys.has('KeyC') || keys.has('ControlLeft')) cam.position.y -= v;
    const g = wg.heightAt(cam.position.x, cam.position.z);
    const floor = Math.max(g, 0) + 1.6;
    if (cam.position.y < floor) cam.position.y = floor;
    applyCam();
  },
  { order: 20 },
);

function teleport(x, z, alt = 30, yawDeg = null, pitchDeg = null) {
  const g = wg.heightAt(x, z);
  cam.position.set(x, Math.max(g, 0) + alt, z);
  if (yawDeg != null) fly.yaw = (yawDeg * Math.PI) / 180;
  if (pitchDeg != null) fly.pitch = (pitchDeg * Math.PI) / 180;
  applyCam();
  $('tx').value = Math.round(x);
  $('tz').value = Math.round(z);
  $('ta').value = Math.round(alt);
}
function setView(name) {
  let v = VIEWS[name];
  if (!v) return false;
  if (v.poi) {
    // the nearest POI of that type (positions follow the generator, never stale)
    const p = wg.poisNear(0, 0, 9000).filter((o) => o.type === v.poi).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    if (p) v = { ...v, p: [p.x + 42, 20, p.z + 42], look: [p.x, 0, p.z] };
  }
  teleport(v.p[0], v.p[2], v.p[1], v.yaw ?? 0, v.pitch ?? -5);
  if (v.time != null) {
    world.setTimeOfDay(v.time);
    $('time').value = v.time;
    $('timev').textContent = v.time.toFixed(1);
  }
  if (v.overlay !== undefined || q.overlay == null) setOverlay(v.overlay || '');
  if (v.look) {
    const target = new THREE.Vector3(v.look[0], wg.heightAt(v.look[0], v.look[2]) + 4, v.look[2]);
    const d = target.sub(cam.position);
    fly.yaw = Math.atan2(-d.x, -d.z);
    fly.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    applyCam();
  }
  $('views').value = name;
  return true;
}

// ------------------------------------------------------------------ UI
$('go').onclick = () => teleport(Number($('tx').value), Number($('tz').value), Number($('ta').value));
$('views').onchange = (e) => setView(e.target.value);
$('time').oninput = (e) => {
  world.setTimeOfDay(Number(e.target.value));
  $('timev').textContent = Number(e.target.value).toFixed(1);
};
$('quality').value = quality;
$('quality').onchange = (e) => {
  engine.setQuality(e.target.value);
  frontier.setQuality(e.target.value);
};
let overlay = '';
function setOverlay(mode) {
  overlay = mode === '1' || mode === true ? 'biomes' : mode || '';
  frontier.setOverlay(overlay);
  $('overlay').value = overlay;
  $('legend').hidden = overlay !== 'rules';
}
$('overlay').onchange = (e) => setOverlay(e.target.value);
const time = q.time != null ? Number(q.time) : 17.6;
world.setTimeOfDay(time);
$('time').value = time;
$('timev').textContent = time.toFixed(1);
if (q.overlay) setOverlay(q.overlay);

const mini = $('mini').getContext('2d');
let statT = 0;
loop.add(
  'lab-ui',
  (dt) => {
    statT -= dt;
    if (statT > 0 || q.ui === '0') return;
    statT = 0.5;
    refreshUI();
  },
  { order: 95 },
);
function refreshUI() {
  {
    const p = cam.position;
    const s = frontier.stats();
    const info = engine.renderer.info.render;
    const d = wg.describe(p.x, p.z);
    $('stats').textContent =
      `fps ${Math.round(loop.fps)}  calls ${info.calls}  tris ${(info.triangles / 1e6).toFixed(2)}M\n` +
      `pos ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}  ground ${d.height.toFixed(1)}\n` +
      `${d.biome.name.en} · ${d.text}\n` +
      `tiles ${s.tiles.shown}/${s.tiles.tiles} pend ${s.tiles.pending} q ${s.tiles.queued}  tri ${(s.tiles.triangles / 1e3).toFixed(0)}k\n` +
      `chunks ${s.detail.chunks} inst ${s.detail.instances} near ${s.detail.near} grass ${s.detail.grass}\n` +
      `nodes ${s.detail.nodes} pois ${s.detail.pois}  gen ${s.genMs} ms`;
    mini.clearRect(0, 0, 220, 220);
    mini.save();
    mini.beginPath();
    mini.arc(110, 110, 110, 0, Math.PI * 2);
    mini.clip();
    mini.fillStyle = '#24303a';
    mini.fillRect(0, 0, 220, 220);
    frontier.minimap.draw(mini, p.x, p.z, overlay === 'rules' ? 24 : 12, { rules: overlay === 'rules' });
    mini.fillStyle = '#fff';
    mini.beginPath();
    mini.arc(110, 110, 3, 0, Math.PI * 2);
    mini.fill();
    mini.restore();
  }
}

// ------------------------------------------------------------------ start
if (q.x != null && q.z != null) teleport(Number(q.x), Number(q.z), Number(q.alt ?? 30), Number(q.yaw ?? 0), Number(q.pitch ?? -5));
else setView(q.view || 'seam-west');

ctx.debug = {
  frames,
  info: () => ({
    drawCalls: engine.renderer.info.render.calls,
    triangles: engine.renderer.info.render.triangles,
    textures: engine.renderer.info.memory.textures,
    geometries: engine.renderer.info.memory.geometries,
    fps: Math.round(loop.fps),
    frontier: frontier.stats(),
    errors: ctx.errors,
  }),
  simulate(seconds = 1, { dt = 1 / 30 } = {}) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) loop.step(dt);
  },
};
/**
 * Resolves when the terrain + detail around the camera finished streaming (or after maxMs).
 * Rendering is frozen meanwhile and the frontier is pumped on a timer: under headless
 * SwiftShader one frame of the full hub world can take seconds, and streaming would
 * otherwise only advance once per frame.
 */
async function settle(maxMs = 90000) {
  const start = performance.now();
  await frontier.ready;
  loop.frozen = true;
  let calm = 0;
  try {
    while (performance.now() - start < maxMs) {
      frontier.update(0.05, cam);
      await new Promise((r) => setTimeout(r, 25));
      calm = frontier.busy ? 0 : calm + 1;
      if (calm >= 12) break;
    }
  } finally {
    loop.frozen = false;
  }
  if (q.ui !== '0') {
    // let the minimap tiles arrive, then show fresh stats
    for (let i = 0; i < 40 && frontier.stats().inflight.map > 0; i++) await new Promise((r) => setTimeout(r, 50));
    refreshUI();
  }
  await frames(2);
}
ctx.lab = { setView, teleport, views: VIEWS, frontier, settle, fly };
await settle(Number(q.settle || 90000));
ctx.ready = true;
console.log(`[frontier-lab] ready in ${Math.round(performance.now() - t0)} ms ${JSON.stringify(frontier.stats())}`);
