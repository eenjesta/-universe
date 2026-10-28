import * as THREE from 'three';
import { PartBuilder, ring, polygon, tubeGeometry } from './geo.js';
import { hullTextures, plumeMaterial, plumeCone, stripGeometry, ENGINE_COLORS } from './ship-model.js';
import { mulberry32 } from '../core/math.js';

/**
 * Side models of the space scene, all procedural + faceted like the player
 * ship (see ship-model.js):
 *   createPirateModel()          red-glowing claw-winged fighter (~11 m)
 *   createFreighterModel(seed)   convoy hauler with coloured cargo blocks (~44 m)
 *   createShuttleGeometry()      one merged geometry for instanced station traffic
 *   createShuttleModel()         the same as a Group (lab / previews)
 *   createColonyFallback(opts)   colony ship used when vehicles/colony-model.js is missing (~250 m)
 *   createWreckModel()           the derelict "Silver Horizon" (broken colony hull + debris)
 * Every Group gets userData { radius, engines?, setThrust?(t, b), update?(t) }.
 */

const PIRATE_PAL = { base: '#2a1d1c', vary: 0.14, line: 'rgba(8,4,4,0.95)', hi: 'rgba(255,170,150,0.07)', metal: 0.55, trim: 0x3a2a28 };
const COLONY_PAL = { base: '#8d9096', vary: 0.18, line: 'rgba(30,32,36,0.9)', hi: 'rgba(255,255,255,0.1)', metal: 0.5, trim: 0x55595f };
const WRECK_PAL = { base: '#4c4640', vary: 0.26, line: 'rgba(16,12,10,0.95)', hi: 'rgba(255,220,190,0.06)', metal: 0.35, trim: 0x2a2724 };
const FREIGHT_PAL = { base: '#5d6168', vary: 0.16, line: 'rgba(18,19,22,0.9)', hi: 'rgba(255,255,255,0.08)', metal: 0.45, trim: 0x3d4148 };

const matCache = new Map();
function hullMat(name, pal, { metal = pal.metal, rough = 1, repeat = 1 } = {}) {
  const key = `${name}:${repeat}`;
  if (matCache.has(key)) return matCache.get(key);
  const tex = hullTextures(name, pal);
  const m = new THREE.MeshStandardMaterial({ name: `space-${name}`, map: tex.map, roughnessMap: tex.roughnessMap, metalness: metal, roughness: rough });
  matCache.set(key, m);
  return m;
}
const basic = (name, rgb) => {
  if (matCache.has(name)) return matCache.get(name);
  const m = new THREE.MeshBasicMaterial({ name: `space-${name}`, color: new THREE.Color(...rgb) });
  matCache.set(name, m);
  return m;
};
const std = (name, color, metal = 0.6, rough = 0.5) => {
  if (matCache.has(name)) return matCache.get(name);
  const m = new THREE.MeshStandardMaterial({ name: `space-${name}`, color, metalness: metal, roughness: rough });
  matCache.set(name, m);
  return m;
};

/** Window-light texture (emissive grid of warm/cool dots) for big hulls. */
let windowTex = null;
function windowsTexture() {
  if (windowTex) return windowTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const rng = mulberry32(99);
  for (let y = 6; y < S; y += 16) {
    if (rng() < 0.25) continue;
    for (let x = 4; x < S; x += 8) {
      if (rng() < 0.45) continue;
      const warm = rng() < 0.8;
      const a = 0.5 + rng() * 0.5;
      g.fillStyle = warm ? `rgba(255,190,120,${a})` : `rgba(140,220,255,${a})`;
      g.fillRect(x, y, 4, 3);
    }
  }
  windowTex = new THREE.CanvasTexture(c);
  windowTex.colorSpace = THREE.SRGBColorSpace;
  windowTex.wrapS = windowTex.wrapT = THREE.RepeatWrapping;
  windowTex.anisotropy = 4;
  return windowTex;
}

function windowsMat(name, pal, intensity) {
  const key = `win:${name}`;
  if (matCache.has(key)) return matCache.get(key);
  const tex = hullTextures(name, pal);
  const m = new THREE.MeshStandardMaterial({
    name: `space-${name}-windows`,
    map: tex.map,
    roughnessMap: tex.roughnessMap,
    metalness: pal.metal,
    roughness: 1,
    emissive: new THREE.Color(1, 1, 1),
    emissiveMap: windowsTexture(),
    emissiveIntensity: intensity,
  });
  matCache.set(key, m);
  return m;
}

/** Plume pair (outer + inner) for AI ships; returns {group, set(t, boost), update(t)}. */
function plumes(offsets, z, radius, color) {
  const ec = ENGINE_COLORS[color] || ENGINE_COLORS.orange;
  const mo = plumeMaterial(ec.hot.map((v) => v * 0.35), ec.cool.map((v) => v * 0.5));
  const mi = plumeMaterial(ec.hot.map((v) => v * 1.2), ec.cool.map((v) => v * 0.8));
  const outer = new THREE.Mesh(plumeCone(radius, 0.1, offsets), mo);
  const inner = new THREE.Mesh(plumeCone(radius * 0.55, 0.05, offsets), mi);
  const group = new THREE.Group();
  for (const p of [outer, inner]) {
    p.position.z = z;
    p.renderOrder = 3;
    p.frustumCulled = false;
    group.add(p);
  }
  return {
    group,
    set(t, b = 0) {
      const len = radius * (3 + t * 10 + b * 14);
      outer.scale.set(1, 1, len);
      inner.scale.set(1, 1, len * 0.45);
      mo.uniforms.uIntensity.value = 0.3 + t * 0.8 + b * 0.6;
      mi.uniforms.uIntensity.value = 0.4 + t * 0.7 + b * 0.5;
    },
    update(t) {
      mo.uniforms.uTime.value = t;
      mi.uniforms.uTime.value = t;
    },
    dispose() {
      outer.geometry.dispose();
      inner.geometry.dispose();
      mo.dispose();
      mi.dispose();
    },
  };
}

// ---------------------------------------------------------------- pirate
function pirateSection(w, top, bot, y0) {
  return [
    [w, y0],
    [w * 0.55, y0 + top * 0.8],
    [0, y0 + top],
    [-w * 0.55, y0 + top * 0.8],
    [-w, y0],
    [-w * 0.4, y0 - bot],
    [w * 0.4, y0 - bot],
  ];
}

let pirateGeo = null;
function buildPirateGeometry() {
  if (pirateGeo) return pirateGeo;
  const b = new PartBuilder({ uvScale: 1 / 2.5 });
  const F = [
    [-6.2, 0.05, 0.04, 0.04, -0.1],
    [-4.8, 0.5, 0.35, 0.3, -0.05],
    [-2.6, 0.95, 0.75, 0.5, 0],
    [-0.6, 1.15, 1.05, 0.6, 0.05],
    [1.8, 1.1, 0.85, 0.62, 0.05],
    [4.2, 0.8, 0.55, 0.5, 0],
  ];
  b.loft('hull', F.map(([z, w, t, bt, y]) => ring(pirateSection(w, t, bt, y), [0, 0, z], 'z')));
  // canopy hump (dark glass-like)
  b.loft('glass', [
    ring(pirateSection(0.05, 0.03, 0.05, 0.6), [0, 0, -3.4], 'z'),
    ring(pirateSection(0.5, 0.42, 0.2, 0.7), [0, 0, -2.0], 'z'),
    ring(pirateSection(0.45, 0.36, 0.2, 0.85), [0, 0, -0.6], 'z'),
    ring(pirateSection(0.1, 0.05, 0.1, 0.95), [0, 0, 0.4], 'z'),
  ]);
  // forward-swept claw wings (loft along +X; r = −z)
  const wing = (le, te, y, t) => [
    [-le, y],
    [-le - 0.25 * (te - le), y + t / 2],
    [-te + 0.2 * (te - le), y + t * 0.3],
    [-te, y],
    [-te + 0.2 * (te - le), y - t * 0.3],
    [-le - 0.25 * (te - le), y - t / 2],
  ];
  b.loftMirrored('hull', [
    ring(wing(-1.4, 3.6, 0, 0.36), [0.8, 0, 0], 'x'),
    ring(wing(-1.8, 2.2, -0.15, 0.28), [3.0, 0, 0], 'x'),
    ring(wing(-3.6, -1.6, -0.3, 0.16), [5.4, 0, 0], 'x'),
  ]);
  // vertical claw blades at the tips (loft along +Y; r = x, u = −z)
  const blade = (cx, le, te, t) => [
    [cx + t / 2, -le - 0.25 * (te - le)],
    [cx, -le],
    [cx - t / 2, -le - 0.25 * (te - le)],
    [cx - t / 2, -te + 0.2 * (te - le)],
    [cx, -te],
    [cx + t / 2, -te + 0.2 * (te - le)],
  ];
  b.loftMirrored('hull', [
    ring(blade(5.3, -3.2, -1.2, 0.14), [0, -1.3, 0], 'y'),
    ring(blade(5.4, -3.7, -1.5, 0.18), [0, -0.3, 0], 'y'),
    ring(blade(5.3, -3.0, -1.8, 0.1), [0, 1.1, 0], 'y'),
  ]);
  // engine pods
  const pod = [
    [0.6, 0.45],
    [1.0, 0.62],
    [4.4, 0.66],
    [5.2, 0.58],
  ].map(([z, r]) => ring(polygon(8, [r, r * 0.9], Math.PI / 8), [1.05, -0.1, z], 'z'));
  b.loftMirrored('hull', pod);
  b.addMirrored('trim', tubeGeometry(
    [ring(polygon(10, 0.62), [1.05, -0.1, 5.0], 'z'), ring(polygon(10, 0.55), [1.05, -0.1, 5.6], 'z')],
    [ring(polygon(10, 0.48), [1.05, -0.1, 5.0], 'z'), ring(polygon(10, 0.46), [1.05, -0.1, 5.6], 'z')],
  ));
  const disc = new THREE.CircleGeometry(0.5, 10);
  b.addMirrored('core', disc, new THREE.Matrix4().makeTranslation(1.05, -0.1, 5.2));
  // red accent strips + guns
  b.addMirrored('red', stripGeometry([1.2, 0.12, -1.0], [4.9, -0.12, -3.0], 0.06, 0.05));
  b.addMirrored('red', stripGeometry([0.5, 0.62, -0.2], [0.75, 0.5, 2.6], 0.05, 0.04));
  const gun = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  gun.setPosition(2.6, -0.3, -2.6);
  b.addMirrored('trim', new THREE.CylinderGeometry(0.08, 0.1, 2.4, 6), gun);
  pirateGeo = b;
  return b;
}

export function createPirateModel() {
  const b = buildPirateGeometry();
  // geometries are consumed by build(); rebuild a fresh builder copy per call
  pirateGeo = null;
  const mats = {
    hull: hullMat('pirate', PIRATE_PAL),
    glass: std('pirate-glass', 0x1a0a08, 1, 0.08),
    trim: std('pirate-trim', 0x3a2a28, 0.85, 0.35),
    red: basic('pirate-red', [6.5, 0.5, 0.35]),
    core: basic('pirate-core', [9, 1.2, 0.6]),
  };
  const group = b.build(mats);
  group.name = 'pirate';
  const pl = plumes(
    [
      [-1.05, -0.1],
      [1.05, -0.1],
    ],
    5.55,
    0.5,
    'red',
  );
  group.add(pl.group);
  pl.set(0.7, 0);
  const guns = [-1, 1].map((s) => {
    const o = new THREE.Object3D();
    o.position.set(s * 2.6, -0.3, -3.9);
    group.add(o);
    return o;
  });
  group.userData = { kind: 'pirate', radius: 6.2, guns, setThrust: pl.set, update: pl.update, dispose: pl.dispose };
  return group;
}

// ---------------------------------------------------------------- freighter
export function createFreighterModel(seed = 1) {
  const rng = mulberry32(seed * 7919 + 3);
  const b = new PartBuilder({ uvScale: 1 / 6 });
  // spine + cockpit block + engine block
  b.box('hull', [3.2, 3.0, 40], [0, 0, 0]);
  b.loft('hull', [
    ring(polygon(6, [0.6, 0.5], Math.PI / 6), [0, 0.8, -27], 'z'),
    ring(polygon(6, [3.6, 3.0], Math.PI / 6), [0, 0.8, -23], 'z'),
    ring(polygon(6, [4.6, 3.6], Math.PI / 6), [0, 0.6, -17], 'z'),
    ring(polygon(6, [4.2, 3.4], Math.PI / 6), [0, 0.4, -13], 'z'),
  ]);
  b.box('glass', [3.4, 0.9, 2.2], [0, 2.4, -22.4], [-0.5, 0, 0]);
  b.box('hull', [9, 6, 7], [0, 0, 17]);
  b.box('trim', [10, 1.0, 2], [0, 3.3, 15]);
  // cargo containers in coloured stacks
  const keys = ['cargoA', 'cargoB', 'cargoC'];
  for (let i = 0; i < 4; i++) {
    const z = -8 + i * 6.4;
    const k1 = keys[Math.floor(rng() * 3)];
    const k2 = keys[Math.floor(rng() * 3)];
    b.box(k1, [3.2, 3.2, 5.8], [3.4, 1.7, z]);
    b.box(k2, [3.2, 3.2, 5.8], [-3.4, 1.7, z]);
    if (rng() < 0.7) b.box(keys[Math.floor(rng() * 3)], [3.2, 3.2, 5.8], [3.4, -1.7, z]);
    if (rng() < 0.7) b.box(keys[Math.floor(rng() * 3)], [3.2, 3.2, 5.8], [-3.4, -1.7, z]);
  }
  // engines (3)
  const eng = [
    [-2.8, -1.2],
    [2.8, -1.2],
    [0, 1.8],
  ];
  for (const [x, y] of eng) {
    b.loft('trim', [ring(polygon(10, 1.5), [x, y, 20.4], 'z'), ring(polygon(10, 1.3), [x, y, 22.2], 'z')], { capEnd: false });
    b.add('core', new THREE.CircleGeometry(1.15, 10), new THREE.Matrix4().makeTranslation(x, y, 21.6));
  }
  // running lights
  b.box('orangeL', [0.3, 0.3, 30], [0, -1.62, -2]);
  b.box('blueL', [0.25, 0.25, 0.25], [4.6, 0, -16], null, true);
  const mats = {
    hull: hullMat('freighter', FREIGHT_PAL),
    trim: std('freight-trim', 0x30343a, 0.8, 0.4),
    glass: std('freight-glass', 0x0b1520, 1, 0.08),
    cargoA: std('cargo-orange', 0x9a4a22, 0.35, 0.6),
    cargoB: std('cargo-steel', 0x6c727a, 0.5, 0.5),
    cargoC: std('cargo-teal', 0x2a5560, 0.4, 0.55),
    core: basic('freight-core', [1.6, 3.6, 8]),
    orangeL: basic('freight-orange', [5, 1.8, 0.5]),
    blueL: basic('freight-blue', [0.6, 2.4, 6]),
  };
  const group = b.build(mats);
  group.name = 'freighter';
  const pl = plumes(
    eng.map(([x, y]) => [x, y]),
    22.2,
    1.2,
    'blue',
  );
  pl.set(0.6, 0);
  group.add(pl.group);
  group.userData = { kind: 'freighter', radius: 24, setThrust: pl.set, update: pl.update, dispose: pl.dispose };
  return group;
}

// ---------------------------------------------------------------- shuttle
export function createShuttleGeometry() {
  const b = new PartBuilder({ uvScale: 1 / 2 });
  b.loft('hull', [
    ring(polygon(6, [0.4, 0.3], Math.PI / 6), [0, 0, -4.2], 'z'),
    ring(polygon(6, [1.3, 1.0], Math.PI / 6), [0, 0, -2.6], 'z'),
    ring(polygon(6, [1.5, 1.2], Math.PI / 6), [0, 0, 1.8], 'z'),
    ring(polygon(6, [1.2, 1.0], Math.PI / 6), [0, 0, 3.6], 'z'),
  ]);
  b.box('hull', [5.2, 0.25, 2.0], [0, -0.3, 1.6]);
  b.box('hull', [0.8, 0.8, 1.6], [2.4, -0.3, 2.6], null, true);
  return b.geometry('hull');
}

export function createShuttleModel() {
  const mesh = new THREE.Mesh(createShuttleGeometry(), hullMat('wingman-shuttle', FREIGHT_PAL));
  const g = new THREE.Group();
  g.add(mesh);
  g.userData = { kind: 'shuttle', radius: 5 };
  return g;
}

// ---------------------------------------------------------------- colony ship
/**
 * Long colony hull (front −Z): octagonal spine with module rings, a bridge
 * tower, a rotating habitat ring and a 4-engine block. ~250 m long.
 * opts: { broken: false (wreck variant), seed }
 */
export function createColonyFallback({ broken = false, seed = 5 } = {}) {
  const rng = mulberry32(seed);
  const pal = broken ? WRECK_PAL : COLONY_PAL;
  const name = broken ? 'wreck' : 'colony';
  const front = new PartBuilder({ uvScale: 1 / 14 });
  const back = broken ? new PartBuilder({ uvScale: 1 / 14 }) : front;
  const SPINE = [
    [-128, 4],
    [-118, 11],
    [-104, 15],
    [-60, 15],
    [-54, 17],
    [-40, 17],
    [-34, 15],
    [20, 15],
    [26, 17],
    [40, 17],
    [46, 15],
    [104, 15],
    [112, 12],
  ];
  const cut = broken ? 8 : 1e9;
  const spineA = SPINE.filter(([z]) => z <= cut);
  const spineB = SPINE.filter(([z]) => z >= cut);
  const toRings = (list) => list.map(([z, r]) => ring(polygon(8, r, Math.PI / 8), [0, 0, z], 'z'));
  if (broken) {
    front.loft('hull', toRings([...spineA, [cut, 15]]), { capEnd: false });
    back.loft('hull', toRings([[cut, 15], ...spineB]), { capStart: false });
  } else front.loft('hull', toRings(SPINE));
  // modules around the spine
  for (const zc of [-88, -72, -16, 0, 62, 80]) {
    const B = zc < cut ? front : back;
    for (let k = 0; k < 8; k++) {
      if (rng() < 0.25) continue;
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const r = 17.5;
      const m = new THREE.Matrix4().makeRotationZ(a - Math.PI / 2);
      m.setPosition(Math.cos(a) * r, Math.sin(a) * r, zc);
      B.add(rng() < 0.6 ? 'windows' : 'hull', new THREE.BoxGeometry(7 + rng() * 3, 5 + rng() * 3, 12 + rng() * 6), m);
    }
  }
  // bridge tower + antennas
  front.box('windows', [12, 14, 18], [0, 20, -84]);
  front.box('hull', [16, 4, 22], [0, 28, -84]);
  front.box('trim', [1, 26, 1], [0, 42, -88]);
  front.box('trim', [0.8, 16, 0.8], [5, 36, -80]);
  // habitat ring (24 segments) + spokes
  const R = 52;
  const HZ = 33;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const m = new THREE.Matrix4().makeRotationZ(a);
    m.setPosition(Math.cos(a) * R, Math.sin(a) * R, HZ);
    if (broken && i % 7 === 3) continue;
    back.add(i % 2 ? 'windows' : 'hull', new THREE.BoxGeometry(10, 14.4, 16), m);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const m = new THREE.Matrix4().makeRotationZ(a);
    m.setPosition(Math.cos(a) * (R / 2 + 8), Math.sin(a) * (R / 2 + 8), HZ);
    back.add('trim', new THREE.BoxGeometry(R - 16, 3, 4), m);
  }
  // engine block
  const engs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 13;
    const y = Math.sin(a) * 13;
    engs.push([x, y]);
    back.loft('hull', [ring(polygon(10, 6), [x, y, 92], 'z'), ring(polygon(10, 7), [x, y, 104], 'z'), ring(polygon(10, 6.4), [x, y, 116], 'z')]);
    back.add('trim', tubeGeometry([ring(polygon(12, 6.6), [x, y, 114], 'z'), ring(polygon(12, 5.8), [x, y, 121], 'z')], [ring(polygon(12, 5.2), [x, y, 114], 'z'), ring(polygon(12, 5.0), [x, y, 121], 'z')]));
    if (!broken) back.add('core', new THREE.CircleGeometry(5.2, 12), new THREE.Matrix4().makeTranslation(x, y, 117));
  }
  // light strips
  if (!broken) {
    front.add('lightW', stripGeometry([0, 15.3, -100], [0, 15.3, -64], 0.6, 0.4));
    front.add('lightW', stripGeometry([0, -15.3, -100], [0, -15.3, -64], 0.6, 0.4));
    back.add('lightB', stripGeometry([15.3, 0, 48], [15.3, 0, 100], 0.4, 0.6));
    back.add('lightB', stripGeometry([-15.3, 0, 48], [-15.3, 0, 100], 0.4, 0.6));
  }
  const mats = {
    hull: hullMat(name, pal, { repeat: 1 }),
    windows: windowsMat(name, pal, broken ? 0.15 : 2.2),
    trim: std(`${name}-trim`, pal.trim, 0.8, 0.4),
    core: basic('colony-core', [1.4, 3.4, 8]),
    lightW: basic('colony-light-warm', [6, 4, 2.2]),
    lightB: basic('colony-light-blue', [1.2, 3, 7]),
  };
  const group = new THREE.Group();
  group.name = broken ? 'wreck' : 'colony-ship';
  const partA = front.build(mats);
  group.add(partA);
  let partB = partA;
  if (broken) {
    partB = back.build(mats);
    group.add(partB);
  }
  let pl = null;
  if (!broken) {
    pl = plumes(engs, 121, 5.4, 'blue');
    pl.set(0.5, 0);
    group.add(pl.group);
  }
  group.userData = {
    kind: broken ? 'wreck' : 'colony',
    radius: 135,
    length: 250,
    parts: [partA, partB],
    setThrust: pl ? pl.set : () => {},
    update: pl ? pl.update : () => {},
  };
  return group;
}

/** Derelict "Silver Horizon": broken colony hull, drifting halves, debris, red distress beacon. */
export function createWreckModel() {
  const g = createColonyFallback({ broken: true, seed: 11 });
  const [front, back] = g.userData.parts;
  front.rotation.set(0.12, 0.35, 0.5);
  front.position.set(-16, 10, -26);
  back.rotation.set(-0.18, -0.2, -0.3);
  back.position.set(10, -8, 22);
  // debris chunks (instanced)
  const rng = mulberry32(42);
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), hullMat('wreck', WRECK_PAL), 70);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  for (let i = 0; i < 70; i++) {
    p.set((rng() - 0.5) * 160, (rng() - 0.5) * 90, (rng() - 0.5) * 120 + 4);
    e.set(rng() * 6, rng() * 6, rng() * 6);
    q.setFromEuler(e);
    const k = 1.5 + rng() * rng() * 9;
    s.set(k * (0.5 + rng()), k * (0.3 + rng() * 0.5), k * (0.6 + rng()));
    m.compose(p, q, s);
    debris.setMatrixAt(i, m);
  }
  debris.computeBoundingSphere();
  g.add(debris);
  // distress beacon on the bridge tower
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 0.8, 0.5) }));
  beacon.position.set(0, 44, -88);
  front.add(beacon);
  g.userData.beacon = beacon;
  g.userData.update = (t) => {
    beacon.visible = t % 2.2 < 0.35;
  };
  return g;
}
