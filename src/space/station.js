import * as THREE from 'three';
import { PartBuilder, ring, polygon } from './geo.js';
import { hullTextures, stripGeometry } from './ship-model.js';
import { createShuttleGeometry } from './models.js';
import { emblemTexture } from '../core/textures.js';
import { mulberry32 } from '../core/math.js';
import { SPACE } from './layout.js';

/**
 * Station Halo: a 1.8 km ring of hull modules with window bands and cyan
 * edge lights, spires with blinking beacons on top (a few hanging below), a
 * central hub with long needle spires, spokes, a counter-rotating habitat
 * ring, the docking block with a lit bay, frame lights, an Ø emblem and a
 * hanging tower beneath it, plus instanced shuttle traffic.
 *
 * Local frame: ring axis +Y, dock bay facing +Z on the outer rim. The group
 * is oriented so that from `approach.position`, looking at the bay, the
 * planet's limb sits just below it (generated/02_space_station.png).
 *   station.dock      { mouth: Vector3, inside: Vector3, normal: Vector3 } (world)
 *   station.approach  { position, lookAt } (world) — stage=station spawn
 *   station.sdf(p)    signed distance (m) to the hull (world point)
 *   station.update(dt, t)
 */

const R = 900;
const SEGMENTS = 56;
const RING_H = 64;
const RING_D = 88;
const DOCK_Z = R + RING_D / 2 + 120; // outer face of the dock block
const PAL = { base: '#9a9da3', vary: 0.2, line: 'rgba(40,42,46,0.85)', hi: 'rgba(255,255,255,0.1)', metal: 0.45, trim: 0x2f3237 };

function windowTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const rng = mulberry32(5);
  for (let y = 4; y < S; y += 10) {
    if (rng() < 0.3) continue;
    let x = 2;
    while (x < S) {
      const run = 4 + Math.floor(rng() * 24);
      if (rng() < 0.7) {
        const warm = rng() < 0.82;
        const a = 0.45 + rng() * 0.55;
        g.fillStyle = warm ? `rgba(255,196,128,${a})` : `rgba(150,225,255,${a})`;
        g.fillRect(x, y, run, 4);
      }
      x += run + 3 + Math.floor(rng() * 10);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Basis that frames the dock (see the header): returns {quaternion, dockWorld, camera}. */
function solveOrientation() {
  const L = SPACE.stationView.clone().normalize();
  const camUp = new THREE.Vector3(0, 1, 0).addScaledVector(L, -L.y).normalize();
  const alpha = (18 * Math.PI) / 180;
  const Ys = camUp.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(L, -Math.sin(alpha)).normalize();
  const Zs = L.clone().multiplyScalar(-Math.cos(alpha)).addScaledVector(camUp, -Math.sin(alpha)).normalize();
  const Xs = new THREE.Vector3().crossVectors(Ys, Zs).normalize();
  const m = new THREE.Matrix4().makeBasis(Xs, Ys, Zs);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  const center = SPACE.station.clone();
  const mouth = center.clone().addScaledVector(Zs, DOCK_Z);
  const camera = mouth.clone().addScaledVector(L, -560);
  return { quaternion, center, mouth, camera, L, Zs };
}

// --------------------------------------------------------------- SDF helpers (local space)
function box2(qx, qy, hx, hy) {
  const dx = Math.abs(qx) - hx;
  const dy = Math.abs(qy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}
function box3(x, y, z, cx, cy, cz, hx, hy, hz) {
  const dx = Math.abs(x - cx) - hx;
  const dy = Math.abs(y - cy) - hy;
  const dz = Math.abs(z - cz) - hz;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0);
}
function capsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax;
  const pay = y - ay;
  const paz = z - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

export function createStation(ctx, { quality }) {
  const rng = mulberry32(777);
  const lowQ = quality.id === 'low';
  const group = new THREE.Group();
  group.name = 'station-halo';
  const tex = hullTextures('station', PAL);
  const winTex = windowTexture();
  const mats = {
    hull: new THREE.MeshStandardMaterial({ name: 'halo-hull', map: tex.map, roughnessMap: tex.roughnessMap, metalness: 0.5, roughness: 1 }),
    dark: new THREE.MeshStandardMaterial({ name: 'halo-dark', color: 0x24262b, metalness: 0.7, roughness: 0.45 }),
    windows: new THREE.MeshStandardMaterial({
      name: 'halo-windows',
      color: 0x55585e,
      metalness: 0.6,
      roughness: 0.5,
      emissive: 0xffffff,
      emissiveMap: winTex,
      emissiveIntensity: 1.7,
    }),
    cyan: new THREE.MeshBasicMaterial({ name: 'halo-cyan', color: new THREE.Color(0.5, 2.4, 3.6) }),
    warm: new THREE.MeshBasicMaterial({ name: 'halo-warm', color: new THREE.Color(4.2, 2.6, 1.3) }),
    bay: new THREE.MeshStandardMaterial({ name: 'halo-bay', color: 0x2a2c31, metalness: 0.4, roughness: 0.6, emissive: new THREE.Color(0.1, 0.085, 0.07), emissiveIntensity: 1 }),
  };
  const b = new PartBuilder({ uvScale: 1 / 30 });
  const w = new PartBuilder({ uvScale: 1 / 70 });

  const place = (geo, x, y, z, rotY = 0) => {
    const m = new THREE.Matrix4().makeRotationY(rotY);
    m.setPosition(x, y, z);
    return [geo, m];
  };

  // ---------------------------------------------------------- ring modules
  const segLen = (2 * Math.PI * R) / SEGMENTS;
  const spireAngles = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const th = (i / SEGMENTS) * Math.PI * 2;
    const nearDock = Math.abs(Math.atan2(Math.sin(th - Math.PI / 2), Math.cos(th - Math.PI / 2))) < 0.2;
    const cx = Math.cos(th);
    const cz = Math.sin(th);
    const rot = -th;
    const tall = !nearDock && rng() < 0.22;
    const h = tall ? RING_H + 30 + rng() * 40 : RING_H;
    const yOff = tall ? (h - RING_H) * 0.5 * (rng() < 0.5 ? 1 : -1) : 0;
    b.add('hull', ...place(new THREE.BoxGeometry(RING_D, h, segLen - 5), cx * R, yOff, cz * R, rot));
    // inner ribbing + outer window band + top light strip
    b.add('dark', ...place(new THREE.BoxGeometry(RING_D + 6, 8, segLen - 1), cx * R, RING_H / 2 - 6, cz * R, rot));
    b.add('dark', ...place(new THREE.BoxGeometry(RING_D + 6, 8, segLen - 1), cx * R, -RING_H / 2 + 6, cz * R, rot));
    if (!nearDock) {
      w.add('windows', ...place(new THREE.BoxGeometry(3, h * 0.55, segLen - 14), cx * (R + RING_D / 2 + 1.2), yOff, cz * (R + RING_D / 2 + 1.2), rot));
      w.add('windows', ...place(new THREE.BoxGeometry(3, h * 0.4, segLen - 18), cx * (R - RING_D / 2 - 1.2), yOff, cz * (R - RING_D / 2 - 1.2), rot));
    }
    b.add('cyan', ...place(new THREE.BoxGeometry(2.2, 1.6, segLen - 8), cx * (R + RING_D / 2 + 3.5), RING_H / 2 - 1.5, cz * (R + RING_D / 2 + 3.5), rot));
    if (i % 2 === 0) b.add('warm', ...place(new THREE.BoxGeometry(2, 1.4, segLen * 0.5), cx * (R - RING_D / 2 - 3.5), -RING_H / 2 + 2, cz * (R - RING_D / 2 - 3.5), rot));
    // greebles on top
    if (rng() < 0.6) {
      const gx = R + (rng() - 0.5) * 50;
      b.add(rng() < 0.5 ? 'hull' : 'dark', ...place(new THREE.BoxGeometry(14 + rng() * 20, 6 + rng() * 14, 14 + rng() * 30), cx * gx, h / 2 + yOff + 5, cz * gx, rot));
    }
    if (!nearDock && i % 4 === 1) spireAngles.push(th + (rng() - 0.5) * 0.04);
  }

  // ---------------------------------------------------------- spires
  const beaconPos = [];
  const spire = (x, z, base, height, r0, up = 1) => {
    const rings = [
      [0, r0],
      [height * 0.18, r0 * 0.92],
      [height * 0.22, r0 * 0.7],
      [height * 0.65, r0 * 0.45],
      [height * 0.7, r0 * 0.32],
      [height, r0 * 0.12],
    ].map(([y, r]) => ring(polygon(6, r, Math.PI / 6), [x, base + y * up, z], 'y'));
    if (up < 0) rings.reverse();
    b.loft('hull', rings);
    const tip = base + (height + 70) * up;
    b.add('dark', stripGeometry([x, base + height * up, z], [x, tip, z], 2.2, 2.2, [1, 0, 0]));
    w.add('windows', ...place(new THREE.BoxGeometry(r0 * 1.5, height * 0.14, r0 * 1.5), x, base + height * 0.42 * up, z));
    beaconPos.push(new THREE.Vector3(x, tip + 3 * up, z));
  };
  spireAngles.forEach((th, k) => {
    const rr = R + (rng() - 0.5) * 30;
    const height = 110 + rng() * 170;
    spire(Math.cos(th) * rr, Math.sin(th) * rr, RING_H / 2, height, 16 + rng() * 10, 1);
    if (k % 3 === 1) spire(Math.cos(th + 0.05) * rr, Math.sin(th + 0.05) * rr, -RING_H / 2, 70 + rng() * 90, 12 + rng() * 6, -1);
  });

  // ---------------------------------------------------------- hub + spokes
  const hubRings = [
    [-170, 30],
    [-130, 100],
    [-60, 150],
    [50, 150],
    [120, 110],
    [170, 46],
  ].map(([y, r]) => ring(polygon(12, r, Math.PI / 12), [0, y, 0], 'y'));
  b.loft('hull', hubRings);
  w.add('windows', new THREE.CylinderGeometry(152, 152, 50, 24, 1, true), new THREE.Matrix4().makeTranslation(0, -5, 0));
  b.loft('hull', [
    ring(polygon(6, 40, Math.PI / 6), [0, 160, 0], 'y'),
    ring(polygon(6, 24, Math.PI / 6), [0, 380, 0], 'y'),
    ring(polygon(6, 14, Math.PI / 6), [0, 520, 0], 'y'),
    ring(polygon(6, 4, Math.PI / 6), [0, 660, 0], 'y'),
  ]);
  b.add('dark', stripGeometry([0, 650, 0], [0, 820, 0], 3, 3, [1, 0, 0]));
  beaconPos.push(new THREE.Vector3(0, 824, 0));
  b.loft('hull', [
    ring(polygon(6, 4, Math.PI / 6), [0, -560, 0], 'y'),
    ring(polygon(6, 18, Math.PI / 6), [0, -400, 0], 'y'),
    ring(polygon(6, 36, Math.PI / 6), [0, -165, 0], 'y'),
  ]);
  beaconPos.push(new THREE.Vector3(0, -566, 0));
  const spokeAngles = [Math.PI / 6, (5 * Math.PI) / 6, (3 * Math.PI) / 2];
  for (const a of spokeAngles) {
    const r0 = 150;
    const r1 = R - RING_D / 2;
    const mid = (r0 + r1) / 2;
    b.add('dark', ...place(new THREE.BoxGeometry(r1 - r0, 16, 18), Math.cos(a) * mid, 0, Math.sin(a) * mid, -a));
    b.add('cyan', ...place(new THREE.BoxGeometry(r1 - r0 - 20, 1.2, 1.2), Math.cos(a) * mid, 9, Math.sin(a) * mid, -a));
  }

  // ---------------------------------------------------------- dock block (+Z)
  const dz0 = R + RING_D / 2 - 6;
  const dz1 = DOCK_Z;
  const dzc = (dz0 + dz1) / 2;
  const dd = dz1 - dz0;
  const BW = 120; // bay width
  const BH = 60; // bay height
  b.box('hull', [140, 160, dd], [-(BW / 2 + 70), 0, dzc]);
  b.box('hull', [140, 160, dd], [BW / 2 + 70, 0, dzc]);
  b.box('hull', [BW, 50, dd], [0, BH / 2 + 25, dzc]);
  b.box('hull', [BW, 50, dd], [0, -BH / 2 - 25, dzc]);
  b.box('bay', [BW, BH, 10], [0, 0, dz0 + 5]);
  // bay interior: floor + ceiling panels, light rows, landing ring
  b.box('bay', [BW - 4, 2, dd - 12], [0, -BH / 2 + 1, dzc + 2]);
  for (let k = -1; k <= 1; k += 2) {
    b.add('cyan', stripGeometry([k * (BW / 2 - 4), -BH / 2 + 2.5, dz0 + 14], [k * (BW / 2 - 4), -BH / 2 + 2.5, dz1 - 3], 1.4, 1.0));
    b.add('warm', stripGeometry([k * 20, BH / 2 - 1.5, dz0 + 14], [k * 20, BH / 2 - 1.5, dz1 - 6], 3, 0.8));
  }
  for (let a = 0; a < 16; a++) {
    const t0 = (a / 16) * Math.PI * 2;
    const t1 = ((a + 0.6) / 16) * Math.PI * 2;
    b.add('cyan', stripGeometry([Math.cos(t0) * 16, -BH / 2 + 2.3, dzc + Math.sin(t0) * 16], [Math.cos(t1) * 16, -BH / 2 + 2.3, dzc + Math.sin(t1) * 16], 1.2, 0.6));
  }
  // frame lights around the opening
  const fz = dz1 + 1.2;
  b.add('cyan', stripGeometry([-BW / 2 - 3, -BH / 2 - 3, fz], [BW / 2 + 3, -BH / 2 - 3, fz], 2.2, 2.2));
  b.add('cyan', stripGeometry([-BW / 2 - 3, BH / 2 + 3, fz], [BW / 2 + 3, BH / 2 + 3, fz], 2.2, 2.2));
  b.add('cyan', stripGeometry([-BW / 2 - 3, -BH / 2 - 3, fz], [-BW / 2 - 3, BH / 2 + 3, fz], 2.2, 2.2, [1, 0, 0]));
  b.add('cyan', stripGeometry([BW / 2 + 3, -BH / 2 - 3, fz], [BW / 2 + 3, BH / 2 + 3, fz], 2.2, 2.2, [1, 0, 0]));
  w.add('windows', ...place(new THREE.BoxGeometry(250, 18, 3), 0, BH / 2 + 34, dz1 + 1));
  w.add('windows', ...place(new THREE.BoxGeometry(250, 14, 3), 0, -BH / 2 - 30, dz1 + 1));
  b.box('dark', [300, 8, dd + 6], [0, 82, dzc]);
  b.box('dark', [300, 8, dd + 6], [0, -82, dzc]);
  // hanging tower below the dock
  b.loft('hull', [
    ring(polygon(8, 6, Math.PI / 8), [0, -470, dzc - 10], 'y'),
    ring(polygon(8, 22, Math.PI / 8), [0, -300, dzc - 10], 'y'),
    ring(polygon(8, 40, Math.PI / 8), [0, -160, dzc - 10], 'y'),
    ring(polygon(8, 62, Math.PI / 8), [0, -84, dzc - 10], 'y'),
  ]);
  w.add('windows', ...place(new THREE.BoxGeometry(60, 70, 60), 0, -150, dzc - 10));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.add('dark', stripGeometry([Math.cos(a) * 30, -100, dzc - 10 + Math.sin(a) * 30], [Math.cos(a) * 12, -330 - k * 18, dzc - 10 + Math.sin(a) * 12], 4, 4, [1, 0, 0]));
  }
  beaconPos.push(new THREE.Vector3(0, -476, dzc - 10));
  // spires on the dock block
  spire(-150, dzc, 80, 150, 14, 1);
  spire(150, dzc, 80, 210, 16, 1);
  spire(-205, dzc - 20, 80, 90, 10, 1);

  const main = b.build(mats);
  const winGroup = w.build(mats);
  group.add(main, winGroup);

  // Ø emblem on the dock block
  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 64),
    new THREE.MeshBasicMaterial({ map: emblemTexture({ size: 256, color: '#ffffff', scale: 0.3, line: 0.05 }), color: new THREE.Color(2.2, 2.1, 2.0), transparent: true, depthWrite: false }),
  );
  emblem.position.set(BW / 2 + 72, 6, dz1 + 1.5);
  group.add(emblem);

  // ---------------------------------------------------------- rotating habitat ring around the hub
  const rot = new PartBuilder({ uvScale: 1 / 20 });
  const RR = 300;
  for (let i = 0; i < 40; i++) {
    const th = (i / 40) * Math.PI * 2;
    const len = (2 * Math.PI * RR) / 40 - 4;
    rot.add(i % 3 ? 'hull' : 'windows', ...place(new THREE.BoxGeometry(34, 26, len), Math.cos(th) * RR, 0, Math.sin(th) * RR, -th));
    if (i % 2 === 0) rot.add('cyan', ...place(new THREE.BoxGeometry(1.5, 1.2, len * 0.8), Math.cos(th) * (RR + 18), 10, Math.sin(th) * (RR + 18), -th));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    rot.add('dark', ...place(new THREE.BoxGeometry(RR - 150, 8, 8), Math.cos(a) * (RR + 150) * 0.5, 0, Math.sin(a) * (RR + 150) * 0.5, -a));
  }
  const habitat = rot.build(mats);
  habitat.position.y = 105;
  group.add(habitat);

  // ---------------------------------------------------------- beacons
  const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(4, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.8, 0.5) }), beaconPos.length);
  const m4 = new THREE.Matrix4();
  beaconPos.forEach((p, i) => beacons.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  beacons.computeBoundingSphere();
  group.add(beacons);

  // ---------------------------------------------------------- shuttle traffic
  const routes = [];
  const lane = (pts) => new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const dockLanes = [
    lane([[-900, 260, 2600], [-420, 120, 1700], [-60, 10, DOCK_Z + 220], [0, -18, DOCK_Z - 40]]),
    lane([[1100, -200, 2500], [500, -80, 1650], [50, -10, DOCK_Z + 200], [10, -18, DOCK_Z - 40]]),
    lane([[200, 600, 2900], [120, 260, 1900], [-20, 20, DOCK_Z + 260], [-10, -18, DOCK_Z - 40]]),
  ];
  const nShuttle = lowQ ? 10 : 20;
  for (let i = 0; i < nShuttle; i++) {
    if (i < 6) {
      routes.push({ curve: dockLanes[i % 3], speed: 0.018 + rng() * 0.01, t: rng(), dir: i < 3 ? 1 : -1, orbit: false });
    } else {
      const rr = R + (rng() < 0.5 ? -1 : 1) * (140 + rng() * 120);
      routes.push({ orbit: true, r: rr, y: (rng() - 0.5) * 260, speed: (0.012 + rng() * 0.02) * (rng() < 0.5 ? -1 : 1), t: rng() * Math.PI * 2, wob: rng() * 6 });
    }
  }
  const shuttleGeo = createShuttleGeometry();
  shuttleGeo.scale(1.6, 1.6, 1.6);
  const shuttles = new THREE.InstancedMesh(shuttleGeo, mats.hull, nShuttle);
  shuttles.frustumCulled = false;
  group.add(shuttles);
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  const glowMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        c.xy += position.xy * 9.0;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float a = exp(-r * r * 9.0);
        gl_FragColor = vec4(vec3(1.6, 3.2, 6.0) * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glows = new THREE.InstancedMesh(glowGeo, glowMat, nShuttle);
  glows.frustumCulled = false;
  group.add(glows);

  // ---------------------------------------------------------- orientation + dock data
  const solved = solveOrientation();
  group.position.copy(solved.center);
  group.quaternion.copy(solved.quaternion);
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const dock = {
    mouth: group.localToWorld(new THREE.Vector3(0, -6, DOCK_Z + 4)),
    entry: group.localToWorld(new THREE.Vector3(0, -6, DOCK_Z + 260)),
    inside: group.localToWorld(new THREE.Vector3(0, -BH / 2 + 10, dzc + 6)),
    normal: new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion),
  };
  const approach = { position: solved.camera.clone(), lookAt: dock.mouth.clone() };

  // ---------------------------------------------------------- SDF (world point)
  const lp = new THREE.Vector3();
  function sdfLocal(x, y, z) {
    const rad = Math.hypot(x, z);
    let d = box2(rad - R, y, RING_D / 2, RING_H / 2 + 10);
    const blk = box3(x, y, z, 0, 0, dzc, BW / 2 + 140, 80, dd / 2);
    const bay = box3(x, y, z, 0, 0, dzc + 12, BW / 2, BH / 2, dd / 2 + 4);
    d = Math.min(d, Math.max(blk, -bay));
    d = Math.min(d, capsule(x, y, z, 0, -90, dzc - 10, 0, -470, dzc - 10, 40));
    d = Math.min(d, Math.hypot(x, y * 1.15, z) - 155);
    d = Math.min(d, capsule(x, y, z, 0, 160, 0, 0, 660, 0, 30));
    d = Math.min(d, capsule(x, y, z, 0, -165, 0, 0, -560, 0, 30));
    d = Math.min(d, box2(Math.hypot(x, z) - RR, y - 105, 18, 14));
    return d;
  }
  function sdf(p) {
    lp.copy(p).applyMatrix4(inv);
    return sdfLocal(lp.x, lp.y, lp.z);
  }
  const grad = new THREE.Vector3();
  /** Outward normal (world) at a world point, by central differences. */
  function normalAt(p, out = grad) {
    lp.copy(p).applyMatrix4(inv);
    const e = 1.5;
    out.set(
      sdfLocal(lp.x + e, lp.y, lp.z) - sdfLocal(lp.x - e, lp.y, lp.z),
      sdfLocal(lp.x, lp.y + e, lp.z) - sdfLocal(lp.x, lp.y - e, lp.z),
      sdfLocal(lp.x, lp.y, lp.z + e) - sdfLocal(lp.x, lp.y, lp.z - e),
    );
    if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
    return out.normalize().transformDirection(group.matrixWorld);
  }

  // ---------------------------------------------------------- update
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3(1, 1, 1);
  const p0 = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const look = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);
  function update(dt, t) {
    habitat.rotation.y = t * 0.03;
    beacons.visible = t % 1.6 < 0.5;
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (r.orbit) {
        r.t += r.speed * dt;
        const a = r.t;
        p0.set(Math.cos(a) * r.r, r.y + Math.sin(a * 3 + r.wob) * 20, Math.sin(a) * r.r);
        tan.set(-Math.sin(a) * Math.sign(r.speed), 0, Math.cos(a) * Math.sign(r.speed));
      } else {
        r.t += r.speed * dt;
        if (r.t > 1) r.t -= 1;
        const u = r.dir > 0 ? r.t : 1 - r.t;
        r.curve.getPointAt(u, p0);
        r.curve.getTangentAt(u, tan);
        if (r.dir < 0) tan.negate();
      }
      look.lookAt(p0, tan.add(p0), UP);
      q.setFromRotationMatrix(look);
      m4.compose(p0, q, sc);
      shuttles.setMatrixAt(i, m4);
      // engine glow behind (shuttle front is −Z → back is +Z)
      tan.sub(p0).normalize();
      p0.addScaledVector(tan, -7);
      glows.setMatrixAt(i, m4.makeTranslation(p0.x, p0.y, p0.z));
    }
    shuttles.instanceMatrix.needsUpdate = true;
    glows.instanceMatrix.needsUpdate = true;
  }
  update(0, 0);

  return {
    group,
    position: group.position,
    radius: R + 200,
    dockRadius: 260,
    dock,
    approach,
    sdf,
    normalAt,
    update,
    dispose() {
      group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      Object.values(mats).forEach((m) => m.dispose());
      glowMat.dispose();
      winTex.dispose();
    },
  };
}
