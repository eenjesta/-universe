/**
 * Landmarks — Uitkijkpost: a ~22 m rusty steel + timber lookout tower on the
 * lookout peak. A square-spiral staircase climbs around a braced steel core
 * (two full loops, 8 flights × 6 steps + corner landings, rise 0.39 m per
 * step — every step is a walkable physics box) up to a railed wooden deck
 * with a small roof, lamp, telescope and an antenna with a warning light.
 */
import * as THREE from 'three';
import { GeoBuilder, Frame, addBeam, mat, hdr } from './common.js';
import { meshPanelTexture, signTexture, signAspect } from './textures.js';
import { t } from '../core/i18n.js';

const H = 22; // platform height
const CORE = 2.4; // half size of the leg square
const BAND_IN = 2.65; // stair band inner edge (from centre)
const BAND_OUT = 3.95; // outer edge
const BAND_C = (BAND_IN + BAND_OUT) / 2;
const SIDES = 8;
const STEPS = 6;
const RISE = H / (SIDES * (STEPS + 1));
const DECK = 4.05; // half size of the top deck

export function buildLookout(env, zone) {
  const { mats, physics, ground } = env;
  const group = new THREE.Group();
  group.name = 'landmarks-lookout';
  const gy = ground.min(zone.x, zone.z, 4.5);
  const F = new Frame(zone.x, gy, zone.z, 0);
  const rust = new GeoBuilder({ uv: true });
  const wood = new GeoBuilder({ uv: true });
  const panels = new GeoBuilder({ uv: true });
  const glow = new GeoBuilder({ glow: true, uv: false });
  const rustO = (c = 0xffffff) => ({ color: c, uvMode: 'box', uvDiv: 2.5 });
  const woodO = (c = 0xffffff) => ({ color: c, uvMode: 'box', uvDiv: 2.2 });
  const V = (x, y, z) => F.p(x, y, z);

  // ---------------------------------------------------------- steel core
  const levels = [0, 5.5, 11, 16.5, H - 0.3];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    addBeam(rust, V(sx * (CORE + 0.35), -1.5, sz * (CORE + 0.35)), V(sx * CORE, H + 2.8, sz * CORE), 0.2, rustO(0xb0a090), 4);
    // concrete footing
    rust.box(1.1, 1.2, 1.1, F.m(sx * (CORE + 0.3), 0.1, sz * (CORE + 0.3)), rustO(0x8a8580));
  }
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i];
    const y1 = levels[i + 1];
    const c0 = CORE + 0.35 * (1 - (y0 + 1.5) / (H + 4.3));
    const c1 = CORE + 0.35 * (1 - (y1 + 1.5) / (H + 4.3));
    // girts + X bracing on each face
    const faces = [
      [[-1, -1], [1, -1]],
      [[1, -1], [1, 1]],
      [[1, 1], [-1, 1]],
      [[-1, 1], [-1, -1]],
    ];
    for (const [[ax, az], [bx, bz]] of faces) {
      addBeam(rust, V(ax * c1, y1, az * c1), V(bx * c1, y1, bz * c1), 0.09, rustO(0xa08a78), 4);
      addBeam(rust, V(ax * c0, y0 + 0.3, az * c0), V(bx * c1, y1, bz * c1), 0.05, rustO(0x9a8070), 4);
      addBeam(rust, V(bx * c0, y0 + 0.3, bz * c0), V(ax * c1, y1, az * c1), 0.05, rustO(0x9a8070), 4);
    }
  }
  F.box(physics, 0, H / 2 - 0.4, 0, 2 * (CORE + 0.4), H - 0.6, 2 * (CORE + 0.4), 0, { walkable: false });

  // ---------------------------------------------------------- spiral stair
  // side s runs from corner s to corner s+1 (counter-clockwise seen from above)
  const corners = [[-BAND_C, BAND_C], [BAND_C, BAND_C], [BAND_C, -BAND_C], [-BAND_C, -BAND_C]]; // SW, SE, NE, NW (local)
  const flightDirs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  const along = 2 * BAND_IN; // flight length between landings
  const tread = along / STEPS;
  const railH = 1.05;
  const path = []; // centre-line waypoints for tests / NPCs
  for (let s = 0; s < SIDES; s++) {
    const side = s % 4;
    const [c0x, c0z] = corners[side];
    const [dx, dz] = flightDirs[side];
    // outward normal of this side (away from the core)
    const nx = side === 1 ? 1 : side === 3 ? -1 : 0;
    const nz = side === 0 ? 1 : side === 2 ? -1 : 0;
    const startX = c0x + dx * (1.3 / 2);
    const startZ = c0z + dz * (1.3 / 2);
    const baseK = s * (STEPS + 1);
    for (let j = 1; j <= STEPS; j++) {
      const t = (j - 0.5) * tread;
      const lx = startX + dx * t;
      const lz = startZ + dz * t;
      const top = (baseK + j) * RISE;
      const w = Math.abs(dx) ? tread : 1.3;
      const d = Math.abs(dx) ? 1.3 : tread;
      wood.box(w + 0.02, 0.07, d, F.m(lx, top - 0.035, lz), woodO(0xb59a7a));
      F.box(physics, lx, top - 0.2, lz, w, 0.4, d);
      // railing collider on the outer edge
      F.box(physics, lx + nx * 0.72, top + railH / 2, lz + nz * 0.72, Math.abs(dx) ? tread : 0.12, railH, Math.abs(dx) ? 0.12 : tread, 0, { walkable: false });
      path.push(V(lx, top, lz));
    }
    // stringers (outer + inner) from landing to landing
    const yA = baseK * RISE;
    const yB = (baseK + STEPS + 1) * RISE;
    for (const off of [-0.68, 0.68]) {
      const a = V(startX + nx * off, yA - 0.15, startZ + nz * off);
      const b = V(startX + dx * along + nx * off, yB - RISE - 0.15, startZ + dz * along + nz * off);
      addBeam(rust, a, b, 0.07, rustO(0x9a7a64), 4);
    }
    // handrail + mid rail + posts on the outer edge
    const ra = V(startX + nx * 0.7, yA + railH, startZ + nz * 0.7);
    const rb = V(startX + dx * along + nx * 0.7, yB - RISE + railH, startZ + dz * along + nz * 0.7);
    addBeam(rust, ra, rb, 0.035, rustO(0x8a6a54), 5);
    addBeam(rust, ra.clone().setY(ra.y - 0.5), rb.clone().setY(rb.y - 0.5), 0.025, rustO(0x8a6a54), 4);
    for (let k = 0; k <= 2; k++) {
      const t = (k / 2) * along;
      const y = yA + (t / along) * (yB - RISE - yA);
      addBeam(rust, V(startX + dx * t + nx * 0.7, y, startZ + dz * t + nz * 0.7), V(startX + dx * t + nx * 0.7, y + railH, startZ + dz * t + nz * 0.7), 0.035, rustO(0x8a6a54), 4);
    }
    // corner landing at the end of this side
    const [c1x, c1z] = corners[(side + 1) % 4];
    const ly = (baseK + STEPS + 1) * RISE;
    if (s < SIDES - 1) {
      wood.box(1.32, 0.08, 1.32, F.m(c1x, ly - 0.04, c1z), woodO(0xb59a7a));
      rust.box(1.36, 0.14, 1.36, F.m(c1x, ly - 0.15, c1z), rustO(0x8a6a54));
      F.box(physics, c1x, ly - 0.2, c1z, 1.3, 0.4, 1.3);
      // two outer railing sides of the landing
      const ox = Math.sign(c1x);
      const oz = Math.sign(c1z);
      F.box(physics, c1x + ox * 0.72, ly + railH / 2, c1z, 0.12, railH, 1.3, 0, { walkable: false });
      F.box(physics, c1x, ly + railH / 2, c1z + oz * 0.72, 1.3, railH, 0.12, 0, { walkable: false });
      addBeam(rust, V(c1x + ox * 0.7, ly, c1z + oz * 0.7), V(c1x + ox * 0.7, ly + railH, c1z + oz * 0.7), 0.04, rustO(0x8a6a54), 4);
      addBeam(rust, V(c1x + ox * 0.7, ly + railH, c1z - oz * 0.65), V(c1x + ox * 0.7, ly + railH, c1z + oz * 0.7), 0.035, rustO(0x8a6a54), 4);
      addBeam(rust, V(c1x - ox * 0.65, ly + railH, c1z + oz * 0.7), V(c1x + ox * 0.7, ly + railH, c1z + oz * 0.7), 0.035, rustO(0x8a6a54), 4);
      // diagonal support from the landing to the core leg
      addBeam(rust, V(c1x, ly - 0.2, c1z), V(Math.sign(c1x) * CORE, ly - 1.6, Math.sign(c1z) * CORE), 0.06, rustO(0x8a6a54), 4);
      path.push(V(c1x, ly, c1z));
    }
  }

  // ---------------------------------------------------------- top deck (opening over the last flight on the west band)
  const deckY = H;
  const openMinZ = -BAND_IN;
  const deckBoxes = [
    // [cx, cz, w, d]
    [(DECK - BAND_IN) / 2 + -BAND_IN + BAND_IN * 0, 0, DECK + BAND_IN, 2 * DECK],
    [-(BAND_IN + DECK) / 2, (openMinZ - DECK) / 2, DECK - BAND_IN, DECK + openMinZ],
    [-(BAND_IN + DECK) / 2, (BAND_IN + DECK) / 2, DECK - BAND_IN, DECK - BAND_IN],
  ];
  // first box spans x ∈ [−BAND_IN, DECK]
  deckBoxes[0][0] = (DECK - BAND_IN) / 2;
  for (const [bx, bz, w, d] of deckBoxes) {
    wood.box(w, 0.12, d, F.m(bx, deckY - 0.06, bz), woodO(0xc0a684));
    rust.box(w, 0.3, d, F.m(bx, deckY - 0.27, bz), rustO(0x7a5a46));
    F.box(physics, bx, deckY - 0.2, bz, w, 0.4, d);
  }
  // deck joists visible from below
  for (let i = -3; i <= 3; i++) rust.box(0.12, 0.25, 2 * DECK, F.m(i * 1.2, deckY - 0.5, 0), rustO(0x6a4a3a));
  // perimeter railing with mesh panels (the arrival side SW is open towards the stair)
  const railY = deckY + railH;
  const edges = [
    { a: [-DECK, -DECK], b: [DECK, -DECK] }, // north
    { a: [DECK, -DECK], b: [DECK, DECK] }, // east
    { a: [DECK, DECK], b: [-DECK, DECK] }, // south
    { a: [-DECK, DECK], b: [-DECK, -DECK] }, // west (outer edge of the stairwell too)
  ];
  for (const e of edges) {
    const [ax, az] = e.a;
    const [bx, bz] = e.b;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.round(len / 1.6);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      rust.box(0.1, railH, 0.1, F.m(x, deckY + railH / 2, z), rustO(0x8a6a54));
    }
    addBeam(rust, V(ax, railY, az), V(bx, railY, bz), 0.05, rustO(0x9a7a64), 4);
    addBeam(rust, V(ax, deckY + 0.12, az), V(bx, deckY + 0.12, bz), 0.04, rustO(0x9a7a64), 4);
    // mesh panel
    const pg = new THREE.PlaneGeometry(len, railH - 0.2);
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    const rot = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
    panels.add(pg, F.m(midX, deckY + railH / 2 + 0.02, midZ, 0, rot, 0), { color: 0xffffff, uvScale: [len / 1.2, (railH - 0.2) / 1.2] });
    pg.dispose();
    const w = Math.abs(bx - ax) > 0.1 ? len : 0.12;
    const d = Math.abs(bz - az) > 0.1 ? len : 0.12;
    F.box(physics, midX, deckY + railH / 2, midZ, w, railH, d, 0, { walkable: false });
  }
  // stairwell guard on the inner side of the opening
  addBeam(rust, V(-BAND_IN, railY, -BAND_IN), V(-BAND_IN, railY, BAND_IN - 1.0), 0.05, rustO(0x9a7a64), 4);
  for (const z of [-BAND_IN, 0, BAND_IN - 1.0]) rust.box(0.1, railH, 0.1, F.m(-BAND_IN, deckY + railH / 2, z), rustO(0x8a6a54));
  F.box(physics, -BAND_IN - 0.05, deckY + railH / 2, -0.8, 0.12, railH, 2 * BAND_IN - 1.2, 0, { walkable: false });

  // ---------------------------------------------------------- roof, antenna, lamp, telescope
  const roofH = 2.7;
  for (const [sx, sz] of [[1, -1], [1, 1], [-0.1, -1], [-0.1, 1]]) {
    rust.box(0.14, roofH, 0.14, F.m(sx * DECK * 0.92, deckY + roofH / 2, sz * DECK * 0.92), rustO(0x8a6a54));
  }
  // corrugated roof (sloped), covering the east half of the deck
  const roof = new THREE.BoxGeometry(DECK * 1.25, 0.08, 2 * DECK + 0.6, 12, 1, 1);
  const rp = roof.attributes.position;
  for (let i = 0; i < rp.count; i++) rp.setY(i, rp.getY(i) + Math.sin(rp.getZ(i) * 9) * 0.03);
  rust.add(roof, F.m(DECK * 0.43, deckY + roofH + 0.2, 0, 0, 0, -0.12), rustO(0x8a5a40));
  roof.dispose();
  addBeam(rust, V(DECK * 0.92, deckY + roofH, -DECK * 0.92), V(DECK * 0.92, deckY + roofH + 7, -DECK * 0.92), 0.06, rustO(0x9a9a9a), 5);
  for (let k = 1; k <= 3; k++) addBeam(rust, V(DECK * 0.92 - 0.6, deckY + roofH + k * 1.8, -DECK * 0.92), V(DECK * 0.92 + 0.6, deckY + roofH + k * 1.8, -DECK * 0.92), 0.025, rustO(0x9a9a9a), 3);
  glow.add(new THREE.SphereGeometry(0.16, 8, 6), F.m(DECK * 0.92, deckY + roofH + 7.2, -DECK * 0.92), { color: hdr(0xff3020, 5), glow: [0.5, 0.2, 0.7] });
  // lamp under the roof
  glow.add(new THREE.CylinderGeometry(0.14, 0.2, 0.32, 8), F.m(DECK * 0.5, deckY + roofH - 0.3, 0), { color: hdr(0xffb060, 4), glow: [0, 0, 0.35] });
  rust.add(new THREE.ConeGeometry(0.3, 0.2, 8), F.m(DECK * 0.5, deckY + roofH - 0.08, 0), rustO(0x3a2a20));
  // telescope on a tripod, pointing at the city (north-east)
  const tp = [DECK * 0.6, deckY, -DECK * 0.6];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    addBeam(rust, V(tp[0] + Math.cos(a) * 0.4, tp[1], tp[2] + Math.sin(a) * 0.4), V(tp[0], tp[1] + 1.2, tp[2]), 0.025, rustO(0x6a6a6a), 4);
  }
  rust.add(new THREE.CylinderGeometry(0.07, 0.11, 1.0, 10), F.m(tp[0] + 0.1, tp[1] + 1.32, tp[2] - 0.2, 0.25, -0.45, 0, 1, 1, 1).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.3)), rustO(0x8a7a5a));
  wood.box(0.8, 0.6, 0.6, F.m(DECK * 0.62, deckY + 0.3, DECK * 0.62, 0, 0.3, 0), woodO(0x9a7a54));
  F.box(physics, DECK * 0.62, deckY + 0.3, DECK * 0.62, 0.8, 0.6, 0.6, 0.3);

  // sign at the stair entrance (letter height designed for 'UITKIJKPOST' on a 2.4 m board)
  const signOpts = { color: '#f0dcc0', glow: null, bg: '#3a2a1e', height: 96 };
  const sign = signTexture(t({ en: 'LOOKOUT', nl: 'UITKIJKPOST' }), signOpts);
  const letterH = 2.4 / signAspect('UITKIJKPOST', signOpts);
  const sw = Math.min(2.4, letterH * sign.userData.aspect);
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / sign.userData.aspect), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.9 }));
  mats.list.push(signMesh.material);
  signMesh.position.copy(V(-BAND_OUT - 1.6, 1.7, BAND_C + 1.2));
  signMesh.rotation.y = -Math.PI / 2 + 0.6;
  signMesh.name = 'lookout-sign';
  group.add(signMesh);
  addBeam(wood, V(-BAND_OUT - 1.6, -0.2, BAND_C + 1.2), V(-BAND_OUT - 1.6, 1.45, BAND_C + 1.2), 0.07, woodO(0x7a5a3c), 5);

  // ---------------------------------------------------------- meshes
  group.add(rust.mesh(mats.rust, { name: 'lookout-steel', castShadow: true, receiveShadow: true }));
  group.add(wood.mesh(mats.wood, { name: 'lookout-wood', castShadow: true, receiveShadow: true }));
  const panelMat = new THREE.MeshStandardMaterial({ map: meshPanelTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.4, transparent: false });
  panelMat.map.wrapS = panelMat.map.wrapT = THREE.RepeatWrapping;
  mats.list.push(panelMat);
  group.add(panels.mesh(panelMat, { name: 'lookout-mesh-panels', castShadow: false }));
  group.add(glow.mesh(mats.glow, { name: 'lookout-lights' }));

  const top = V(DECK * 0.15, deckY, 0);
  return {
    group,
    clearDiscs: [{ x: zone.x, z: zone.z, r: 7.5 }],
    top,
    base: V(0, 0, 0),
    height: H,
    rise: RISE,
    /** where the stair starts (outside the SW corner) and which way to face */
    stairStart: { position: V(-BAND_C - 0.2, 0, BAND_C), heading: -Math.PI / 2 },
    stairPath: path,
  };
}
