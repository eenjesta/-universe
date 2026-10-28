/**
 * Dev-only build lab (not part of the game): boots the real engine + post
 * chain, core UI/input/physics and the build module on a small procedural
 * stand-in terrain at the base coordinates — seconds instead of a full game
 * load. Exposes window.__game (ready, build, debug.frames/info) for
 * tools/shot.mjs.
 *
 *   /src/build/dev/lab.html?view=sheet|house|ghost|nodes&time=17.6|20&hud=1&piece=cube-module
 */
import * as THREE from 'three';
import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import '../../ui/base.css';
import { Engine } from '../../core/engine.js';
import { Loop } from '../../core/loop.js';
import { Events } from '../../core/events.js';
import { State } from '../../core/state.js';
import { Physics } from '../../core/physics.js';
import { Markers } from '../../core/markers.js';
import { Input } from '../../core/input.js';
import { UI } from '../../core/ui.js';
import { Interactions } from '../../core/interactions.js';
import { i18n, initLanguage } from '../../core/i18n.js';
import { ZONES } from '../../world/layout.js';
import { install } from '../index.js';

const q = Object.fromEntries(new URLSearchParams(location.search));
initLanguage(q.lang || 'en');
const info = document.getElementById('lab-info');
const canvas = document.getElementById('gl');
const events = new Events();
const state = new State(events, { persist: false });
if (q.creative) state.data.settings.creative = true;
if (q.owned) state.data.owned.items = ['decor-statue', 'decor-neon-tree', 'power-fusion'];
const engine = new Engine(canvas, q.quality || 'high', q);
engine.events = events;
const loop = new Loop();
const input = new Input(canvas, events);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 3000);
const BA = ZONES.base.buildArea;

// ------------------------------------------------------------ stand-in world
const scene = new THREE.Scene();
const H0 = 22;
const height = (x, z) => H0 + 0.9 * Math.sin((x + 200) * 0.045) * Math.cos((z - 300) * 0.037) + 0.35 * Math.sin(x * 0.13 + z * 0.09);
const normalAt = (x, z, out = new THREE.Vector3()) => {
  const e = 0.5;
  return out.set(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)).normalize();
};
const hour = Number(q.time ?? 17.6);
const night = hour >= 19.5 || hour < 5;
const dayFactor = night ? 0.04 : hour > 16.5 ? 0.43 : 1;
const world = {
  scene,
  getHeightAt: height,
  getNormalAt: normalAt,
  isWater: () => false,
  waterLevel: 0,
  dayFactor,
  sunDirection: new THREE.Vector3(),
  raycastInto(o, d, maxT, out) {
    let tPrev = 0;
    let above = o.y - height(o.x, o.z);
    if (above < 0) return null;
    for (let tt = 0.4; tt <= maxT; tt += 0.4) {
      const x = o.x + d.x * tt;
      const y = o.y + d.y * tt;
      const z = o.z + d.z * tt;
      const a = y - height(x, z);
      if (a < 0) {
        let lo = tPrev;
        let hi = tt;
        for (let k = 0; k < 12; k++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m - height(o.x + d.x * m, o.z + d.z * m) < 0) hi = m;
          else lo = m;
        }
        out.distance = hi;
        out.point.set(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
        normalAt(out.point.x, out.point.z, out.normal);
        return out;
      }
      tPrev = tt;
    }
    return null;
  },
  vegetation: { clearArea: () => 0 },
};

// ground
{
  const size = 260;
  const seg = 130;
  const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c1 = new THREE.Color(0x4a5a2c);
  const c2 = new THREE.Color(0x6a6a3a);
  const c3 = new THREE.Color(0x3a4424);
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + BA.x;
    const z = p.getZ(i) + BA.z;
    p.setY(i, height(x, z));
    const n = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.cos(z * 0.17) * 2.0) * Math.cos(z * 0.13);
    tmp.copy(c1).lerp(c2, n * 0.6).lerp(c3, Math.max(0, Math.sin(x * 0.05 - z * 0.07)) * 0.5);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  m.position.set(BA.x, 0, BA.z);
  m.receiveShadow = true;
  scene.add(m);
  // a few dark pines as backdrop
  const rng = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const r = rng(7);
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 4, 6);
  const coneGeo = new THREE.ConeGeometry(2.2, 9, 8);
  const tm = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
  const cm = new THREE.MeshStandardMaterial({ color: 0x1f3320, roughness: 1, flatShading: true });
  for (let k = 0; k < 70; k++) {
    const a = r() * Math.PI * 2;
    const d = 55 + r() * 60;
    const x = BA.x + Math.cos(a) * d;
    const z = BA.z + Math.sin(a) * d;
    const s = 0.8 + r() * 0.8;
    const tr = new THREE.Mesh(trunkGeo, tm);
    tr.position.set(x, height(x, z) + 2 * s, z);
    tr.scale.setScalar(s);
    const co = new THREE.Mesh(coneGeo, cm);
    co.position.set(x, height(x, z) + 7.5 * s, z);
    co.scale.setScalar(s);
    tr.castShadow = co.castShadow = true;
    scene.add(tr, co);
  }
}

// sky + lights
const skyTop = new THREE.Color(night ? 0x060a18 : 0x3a5a8a);
const skyMid = new THREE.Color(night ? 0x141c34 : 0x9a8aa0);
const skyLow = new THREE.Color(night ? 0x2a2440 : 0xffb070);
{
  const g = new THREE.SphereGeometry(1500, 32, 16);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 1500;
    if (y < 0.08) tmp.copy(skyLow).lerp(skyMid, Math.max(0, y / 0.08));
    else tmp.copy(skyMid).lerp(skyTop, Math.min(1, (y - 0.08) / 0.5));
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(sky);
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  const pm = new THREE.PMREMGenerator(engine.renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = night ? 0.25 : 0.8;
}
scene.fog = new THREE.FogExp2(night ? 0x141a2c : 0xb09aa0, night ? 0.006 : 0.004);
const sun = new THREE.DirectionalLight(night ? 0x8090c0 : 0xffb070, night ? 0.35 : 2.6);
const sunDir = night ? new THREE.Vector3(-0.3, 0.6, 0.4).normalize() : new THREE.Vector3(0.45, 0.18, -0.88).normalize();
world.sunDirection.copy(sunDir);
sun.castShadow = engine.quality.shadows;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -40;
sun.shadow.camera.right = sun.shadow.camera.top = 40;
sun.shadow.camera.far = 200;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(night ? 0x2a3456 : 0x9ab0d0, night ? 0x10140c : 0x4a3a28, night ? 0.35 : 0.9);
scene.add(hemi);
world.sun = sun;
world.hemi = hemi;

// ------------------------------------------------------------ ctx
const player = {
  position: new THREE.Vector3(BA.x - 4, 0, BA.z + 10),
  heading: 0,
  onFoot: true,
  teleport(p, h) {
    this.position.set(p.x, height(p.x, p.z), p.z);
    if (h != null) this.heading = h;
  },
};
player.position.y = height(player.position.x, player.position.z);
const ctx = {
  THREE,
  params: q,
  events,
  state,
  engine,
  loop,
  input,
  physics: new Physics(),
  markers: new Markers(events),
  camera,
  world,
  player,
  audio: { play() {}, loop: () => ({ set() {}, stop() {} }) },
  modes: { name: 'explore', is: (...n) => n.includes('explore'), transitioning: false, current: null },
  errors: [],
  ready: false,
};
ctx.i18n = i18n;
ctx.ui = new UI(ctx);
ctx.interactions = new Interactions(ctx);
ctx.physics.setTerrain(height);
window.__game = ctx;
const frames = (n = 1) =>
  new Promise((res) => {
    const target = loop.frame + n;
    const check = () => (loop.frame >= target ? res() : requestAnimationFrame(check));
    check();
  });
ctx.debug = {
  frames,
  info: () => ({ drawCalls: engine.renderer.info.render.calls, triangles: engine.renderer.info.render.triangles, errors: ctx.errors, fps: Math.round(loop.fps) }),
  simulate(seconds = 1, { dt = 1 / 30 } = {}) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) loop.step(dt);
  },
};
loop.render = (dt, t) => engine.render(dt, t);
loop.afterFrame = () => input.endFrame();
engine.setView(scene, camera);
loop.add('interactions', (dt) => ctx.interactions.update(dt), { order: 45 });
loop.add('ui-prompts', () => ctx.ui.prompt.update(), { order: 96, pausable: false });
loop.start();

const t0 = performance.now();
const build = await install(ctx, {});
ctx.build = build;

// ------------------------------------------------------------ views
const cam = { p: new THREE.Vector3(), l: new THREE.Vector3() };
const at = (x, z, dy = 0) => new THREE.Vector3(x, height(x, z) + dy, z);
const X = (i) => BA.x - BA.size / 2 + i * 4 + 2; // cell centre
const Z = (j) => BA.z - BA.size / 2 + j * 4 + 2;
const EX = (i) => BA.x - BA.size / 2 + i * 4; // grid line
const EZ = (j) => BA.z - BA.size / 2 + j * 4;
const P = (id, x, z, rot = 0) => {
  const r = build.placeAt(id, { x, z, rot, free: true, ignoreUnlock: true });
  if (!r.ok) console.warn('[lab] place failed', id, x, z, r.reason, r.text);
  return r;
};

function house(i0, j0) {
  // 2×2 foundation, walls, roof, decor — a small villa block
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) P('foundation', X(i0 + a), Z(j0 + b));
  P('glass-wall', X(i0), EZ(j0) + 0.3, 0);
  P('door-wall', X(i0 + 1), EZ(j0) + 0.3, 0);
  P('wall', EX(i0) + 0.3, Z(j0), 1);
  P('window-wall', EX(i0) + 0.3, Z(j0 + 1), 1);
  P('wall', X(i0), EZ(j0 + 2) - 0.3, 2);
  P('glass-wall', X(i0 + 1), EZ(j0 + 2) - 0.3, 2);
  P('glass-wall', EX(i0 + 2) - 0.3, Z(j0), 3);
  P('glass-wall', EX(i0 + 2) - 0.3, Z(j0 + 1), 3);
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) P('flat-roof', X(i0 + a), Z(j0 + b));
}

const view = q.view || 'house';
if (view === 'sheet') {
  // every piece on its own foundation / spot
  const list = build.catalog.flatMap((c) => c.pieces);
  let k = 0;
  for (const p of list) {
    const i = -1 + (k % 8) * 2;
    const j = -11 + Math.floor(k / 8) * 3;
    const x = X(i);
    const z = Z(j);
    if (p.snap === 'edge') {
      P('foundation', x, z);
      P(p.id, x, EZ(j) + 0.3, 0);
    } else if (p.snap === 'roof') {
      P('foundation', x, z);
      P('pillar', EX(i) + 0.2, EZ(j) + 0.2);
      P('pillar', EX(i + 1) - 0.2, EZ(j) + 0.2);
      P('pillar', EX(i) + 0.2, EZ(j + 1) - 0.2);
      P('pillar', EX(i + 1) - 0.2, EZ(j + 1) - 0.2);
      P(p.id, x, z);
    } else if (p.snap === 'corner') {
      P('foundation', x, z);
      P(p.id, EX(i) + 0.2, EZ(j) + 0.2);
    } else if (p.snap === 'room' && (p.size?.[0] > 1 || p.size?.[1] > 1)) {
      P(p.id, x + 2, z + 2);
    } else P(p.id, x, z);
    k++;
  }
  cam.p.copy(at(X(6), Z(-19), 24));
  cam.l.copy(at(X(6), Z(-6), 0));
} else if (view === 'nodes') {
  const n = build.nodes;
  cam.p.set(BA.x, height(BA.x, BA.z) + 3, BA.z);
  cam.l.set(BA.x + 4, height(BA.x, BA.z), BA.z);
} else {
  house(2, 3);
  P('wood-deck', X(4), Z(3));
  P('wood-deck', X(4), Z(4));
  P('planter', X(4) + 1.2, Z(3) - 1.2);
  P('bench', X(4) + 0.5, Z(4) + 0.5, 1);
  P('lamp', X(4) + 1.5, Z(4) + 1.5);
  P('solar-panel', X(6), Z(2));
  P('light-mast', X(7), Z(5));
  P('brazier', X(5), Z(6));
  P('banner', X(1), Z(2));
  if (view === 'ghost' || q.hud) {
    player.position.copy(at(X(5) + 1, Z(9)));
    cam.p.copy(at(X(5) + 4, Z(11) + 2, 4.2));
    cam.l.copy(at(X(5) - 1, Z(5), 0.6));
  } else {
    cam.p.copy(at(X(7), Z(10), 5.5));
    cam.l.copy(at(X(3), Z(4), 1.5));
  }
}
if (q.focus) {
  const rec = [...build.registry.records.values()].find((r) => r.type === q.focus);
  if (rec) {
    const bb = rec.info.bounds;
    const hgt = Math.max(2, bb.max.y);
    const dist = Number(q.dist || Math.max(7, hgt * 1.5));
    const a = Number(q.az ?? 0.6);
    cam.l.set(rec.x, rec.y + hgt * 0.45, rec.z);
    cam.p.set(rec.x + Math.sin(a) * dist, rec.y + hgt * 0.45 + dist * 0.35, rec.z + Math.cos(a) * dist);
  }
}
if (q.cam) {
  const v = q.cam.split(',').map(Number);
  cam.p.set(v[0], height(v[0], v[2]) + v[1], v[2]);
  cam.l.set(v[3], height(v[3], v[5]) + v[4], v[5]);
}
camera.position.copy(cam.p);
camera.lookAt(cam.l);
sun.position.copy(cam.l).addScaledVector(sunDir, 80);
sun.target.position.copy(cam.l);
loop.add(
  'lab-camera',
  () => {
    camera.position.copy(cam.p);
    camera.lookAt(cam.l);
  },
  { order: 20 },
);
if (q.hud || view === 'ghost') {
  build.enter({ piece: q.piece || 'cube-module' });
}
// finish the materialise animations before the first capture
ctx.debug.simulate(Number(q.settle ?? 3));
ctx.lab = { cam, at, X, Z, EX, EZ, P, height, player };
await frames(3);
ctx.ready = true;
info.textContent = `build lab ${view} — ${build.count()} pieces — ${Math.round(performance.now() - t0)} ms`;
console.log(`[build-lab] ready in ${Math.round(performance.now() - t0)} ms, ${build.count()} pieces`);
