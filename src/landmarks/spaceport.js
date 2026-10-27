/**
 * Landmarks — Ruimtehaven. Wet concrete apron over the spaceport rect,
 * numbered landing pads (ship / VTOL / car / colony ship) with chasing edge
 * lights, the giant open hangar for the colony ship (open front + apron side,
 * trusses, catwalks, gantry crane, ceiling lights, Ø banners, RUIMTEHAVEN
 * fascia), a control tower with a turning radar, fuel tanks, container stacks
 * under a gantry crane, floodlight masts, Ø banner poles, painted taxi lines
 * and runway lights. The vehicles module parks the ships on `pads`.
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { Rng } from '../core/math.js';
import { GeoBuilder, Frame, addBeam, mat, TAU, hdr } from './common.js';
import { padTexture, ribTexture, signTexture } from './textures.js';
import { buildPools } from './plaza.js';

const PADS = [
  { key: 'ship', r: 16, label: '01', cell: 0 },
  { key: 'vtol', r: 11, label: '02', cell: 1 },
  { key: 'car', r: 8.5, label: '03', cell: 2 },
  { key: 'colony', r: 34, label: '04', cell: 3 },
];
const YELLOW = 0xd9a520;

export function buildSpaceport(env) {
  const { mats, physics, ground } = env;
  const Z = ZONES.spaceport;
  const R = Z.rect;
  const rng = new Rng('ruimtehaven');
  const group = new THREE.Group();
  group.name = 'landmarks-spaceport';
  const gAt = (x, z) => ground.at(x, z);
  const elev = gAt(Z.x, Z.z);
  const painted = new GeoBuilder({ uv: false });
  const metal = new GeoBuilder({ uv: false });
  const glow = new GeoBuilder({ glow: true, uv: false });
  const glassB = new GeoBuilder({ uv: false });
  const decal = new GeoBuilder({ uv: false });
  const marks = new GeoBuilder({ uv: true });
  const banners = new GeoBuilder({ uv: true });
  const pools = [];
  const BLUE_L = hdr(0x5aa0ff, 2.6);
  const AMBER_L = hdr(0xffb04a, 2.6);

  // ---------------------------------------------------------- apron
  {
    const m = 5;
    const x0 = R.minX - m;
    const x1 = R.maxX + m;
    const z0 = R.minZ - m;
    const z1 = R.maxZ + m;
    const nx = 64;
    const nz = 54;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx;
        const z = z0 + ((z1 - z0) * j) / nz;
        pos.push(x, gAt(x, z) + 0.06, z);
        uv.push(x / 8, z / 8);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const apron = new THREE.Mesh(g, mats.apron);
    apron.name = 'spaceport-apron';
    apron.receiveShadow = true;
    apron.matrixAutoUpdate = false;
    group.add(apron);
    // perimeter edge lights (blue)
    const per = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
    for (const [ax, az, bx, bz] of per) {
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 4; d < len; d += 9) {
        const x = ax + ((bx - ax) * d) / len;
        const z = az + ((bz - az) * d) / len;
        glow.add(new THREE.CylinderGeometry(0.16, 0.2, 0.32, 6), mat(x, gAt(x, z) + 0.2, z), { color: BLUE_L, glow: [0, 0, 0.3] });
      }
    }
  }

  // ---------------------------------------------------------- pads
  const pads = {};
  for (const p of PADS) {
    const def = Z.pads[p.key];
    if (!def) continue;
    const top = Math.max(gAt(def.x, def.z), ground.max(def.x, def.z, p.r * 0.7)) + 0.14;
    if (p.key !== 'colony') {
      painted.add(new THREE.CylinderGeometry(p.r, p.r + 0.35, 0.4, 56), mat(def.x, top - 0.2, def.z), { color: 0x34373d });
      physics?.addBox({ x: def.x, y: top - 0.2, z: def.z, w: p.r * 1.42, h: 0.4, d: p.r * 1.42, rotY: def.rotY, tag: 'landmarks' });
      physics?.addBox({ x: def.x, y: top - 0.2, z: def.z, w: p.r * 1.42, h: 0.4, d: p.r * 1.42, rotY: def.rotY + Math.PI / 4, tag: 'landmarks' });
      // chasing edge lights
      const n = Math.round((TAU * p.r) / 2.6);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        glow.box(0.35, 0.12, 0.35, mat(def.x + Math.cos(a) * (p.r + 0.1), top + 0.02, def.z + Math.sin(a) * (p.r + 0.1), 0, -a, 0), {
          color: k % 2 ? AMBER_L : hdr(0xffe0b0, 3),
          glow: [-0.5, k / n, 0.35],
        });
      }
      pools.push({ x: def.x, z: def.z, r: p.r * 1.2, color: 0xffb060, k: 0.25 });
    }
    // marking decal (atlas cell)
    const plane = new THREE.PlaneGeometry(p.r * 2, p.r * 2).rotateX(-Math.PI / 2);
    const uv = plane.attributes.uv;
    const u0 = (p.cell % 2) * 0.5;
    const v0 = 0.5 - Math.floor(p.cell / 2) * 0.5;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
    marks.add(plane, mat(def.x, top + 0.015, def.z, 0, def.rotY + Math.PI, 0), {});
    plane.dispose();
    pads[p.key] = { x: def.x, z: def.z, rotY: def.rotY, radius: p.r, label: p.label, position: new THREE.Vector3(def.x, top, def.z) };
  }

  // ---------------------------------------------------------- hangar
  // own builders: the structure gets baked cool light from the ceiling panels
  const hp = new GeoBuilder({ uv: false });
  const hm = new GeoBuilder({ uv: false });
  const hangarLamps = [];
  const HD = Z.hangar;
  const hgy = gAt(Z.pads.colony.x, Z.pads.colony.z);
  const HF = new Frame(HD.x, hgy, HD.z, HD.rotY);
  const HW = HD.w / 2;
  const HDp = HD.d / 2;
  const HH = HD.h;
  const colX = [-75, -45, -15, 15, 45, 75].map((x) => (x / 75) * (HW - 1.5));
  // floor + foundation
  hp.box(HD.w + 2, 14, HD.d + 2, HF.m(0, -7.02, 0), { color: 0x55585e });
  const floor = new THREE.PlaneGeometry(HD.w, HD.d).rotateX(-Math.PI / 2);
  const floorMesh = new THREE.Mesh(floor, mats.apron);
  floorMesh.applyMatrix4(HF.m(0, 0.08, 0));
  floorMesh.name = 'hangar-floor';
  floorMesh.receiveShadow = true;
  group.add(floorMesh);
  HF.box(physics, 0, -0.5, 0, HD.w, 1, HD.d);
  // columns: lattice steel (4 chords + zig-zag lacing) on concrete footings, cyan edge light
  const CW = 3.0;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const column = (lx, lz) => {
    hp.box(4.4, 2.2, 4.4, HF.m(lx, 1.1, lz), { color: 0x3a3e45 });
    // solid plated foot (vehicles bump into it) + chunky chords above
    hp.box(CW + 0.5, 9, CW + 0.5, HF.m(lx, 2.2 + 4.5, lz), { color: 0x454a52 });
    hp.box(CW + 0.7, 0.5, CW + 0.7, HF.m(lx, 11.2, lz), { color: 0x30343a });
    glow.box(CW * 0.6, 0.12, 0.1, HF.m(lx, 6.2, lz - (CW + 0.5) / 2 - 0.06), { color: hdr(0xffb04a, 2.2), glow: [0, 0, 0.3] });
    for (const [sx, sz] of corners) addBeam(hm, HF.p(lx + (sx * CW) / 2, 2, lz + (sz * CW) / 2), HF.p(lx + (sx * CW) / 2, HH, lz + (sz * CW) / 2), 0.42, { color: 0x5a6068 }, 6);
    const n = Math.round((HH - 2) / 3.2);
    for (let i = 0; i < n; i++) {
      const y0 = 2 + (i * (HH - 2)) / n;
      const y1 = 2 + ((i + 1) * (HH - 2)) / n;
      for (let f = 0; f < 4; f++) {
        const a = corners[f];
        const b = corners[(f + 1) % 4];
        const [p0, p1] = i % 2 ? [a, b] : [b, a];
        if (y1 < 11) continue; // inside the plated foot
        addBeam(hm, HF.p(lx + (p0[0] * CW) / 2, y0, lz + (p0[1] * CW) / 2), HF.p(lx + (p1[0] * CW) / 2, y1, lz + (p1[1] * CW) / 2), 0.14, { color: 0x6a7078 }, 4);
      }
      if (i % 4 === 0) hp.box(CW + 0.3, 0.35, CW + 0.3, HF.m(lx, y0, lz), { color: 0x4a4f57 });
    }
    glow.box(0.12, HH - 14, 0.12, HF.m(lx, HH / 2 - 2, lz - CW / 2 - 0.12), { color: hdr(0x7fd8ff, 2.2), glow: [0, 0, 0.2] });
    HF.box(physics, lx, HH / 2, lz, CW + 0.4, HH, CW + 0.4, 0, { walkable: false });
  };
  for (const lx of colX) {
    column(lx, -HDp + 1.6);
    column(lx, HDp - 1.6);
  }
  for (const lz of [-16, 16]) column(-HW + 1.6, lz);
  // closed walls: back (+Z) and right (+X), ribbed cladding + clerestory light bands
  // tessellated so the baked ceiling light can form a gradient down the walls
  hp.add(new THREE.BoxGeometry(HD.w, HH - 8, 1.2, 30, 12, 1), HF.m(0, (HH - 8) / 2, HDp - 0.6), { color: 0x3a3f47 });
  hp.add(new THREE.BoxGeometry(1.2, HH - 8, HD.d, 1, 12, 20), HF.m(HW - 0.6, (HH - 8) / 2, 0), { color: 0x3a3f47 });
  HF.box(physics, 0, (HH - 8) / 2, HDp - 0.6, HD.w, HH - 8, 1.2, 0, { walkable: false });
  HF.box(physics, HW - 0.6, (HH - 8) / 2, 0, 1.2, HH - 8, HD.d, 0, { walkable: false });
  for (let x = -HW + 6; x < HW - 2; x += 6) {
    for (const side of [-1, 1]) hp.box(0.5, HH - 8, 0.5, HF.m(x, (HH - 8) / 2, HDp - 0.6 + side * 0.85), { color: side > 0 ? 0x30343b : 0x2c3036 });
  }
  for (let z = -HDp + 6; z < HDp - 2; z += 6) {
    for (const side of [-1, 1]) hp.box(0.5, HH - 8, 0.5, HF.m(HW - 0.6 + side * 0.85, (HH - 8) / 2, z), { color: side > 0 ? 0x30343b : 0x2c3036 });
  }
  for (const y of [HH - 16, HH - 13.5]) {
    glow.box(HD.w - 3, 1.1, 0.08, HF.m(0, y, HDp - 1.25), { color: hdr(0xcfe8ff, 1.15), glow: [0, 0, 0.5] });
    glow.box(0.08, 1.1, HD.d - 3, HF.m(HW - 1.25, y, 0), { color: hdr(0xcfe8ff, 1.15), glow: [0, 0, 0.5] });
    glow.box(HD.w - 3, 1.1, 0.08, HF.m(0, y, HDp + 0.05), { color: hdr(0xffd8a8, 1.0), glow: [0, 0, 0.12] });
  }
  for (let y = 12; y < HH - 18; y += 12) {
    hp.box(HD.w, 0.6, 0.8, HF.m(0, y, HDp - 1.4), { color: 0x2c3036 });
    glow.box(HD.w - 4, 0.12, 0.1, HF.m(0, y - 0.5, HDp - 1.85), { color: hdr(0xbfe6ff, 1.4), glow: [0, 0, 0.45] });
    hp.box(0.8, 0.6, HD.d, HF.m(HW - 1.4, y, 0), { color: 0x2c3036 });
  }
  // telescopic door leaves parked outside the right edge of the open front
  for (let k = 0; k < 3; k++) {
    const lx = HW + 2.2 + k * 1.6;
    const lz = -HDp + 9 + k * 7.5;
    hp.box(1.1, HH - 9, 14.5, HF.m(lx, (HH - 9) / 2, lz), { color: k % 2 ? 0x41464e : 0x383c43 });
    for (let y = 6; y < HH - 10; y += 6) hp.box(1.2, 0.35, 14.6, HF.m(lx, y, lz), { color: 0x2c3036 });
    glow.box(0.1, HH - 12, 0.1, HF.m(lx - 0.6, (HH - 9) / 2, lz - 7.2), { color: hdr(0xffb04a, 2.2), glow: [-0.3, k * 0.3, 0.3] });
    HF.box(physics, lx, (HH - 9) / 2, lz, 1.1, HH - 9, 14.5, 0, { walkable: false });
  }
  // roof deck, fascia, trusses
  hp.box(HD.w + 4, 1.6, HD.d + 4, HF.m(0, HH + 0.8, 0), { color: 0x3c4048 });
  HF.box(physics, 0, HH + 0.8, 0, HD.w + 4, 1.6, HD.d + 4);
  hp.box(HD.w + 4, 9, 2.4, HF.m(0, HH - 3.5, -HDp - 1.2), { color: 0x2b2f35 });
  glow.box(HD.w + 4, 0.18, 0.1, HF.m(0, HH - 8.1, -HDp - 2.45), { color: hdr(0x7fd8ff, 3), glow: [0, 0, 0.3] });
  for (const lx of colX) {
    const a = HF.p(lx, HH - 1.2, -HDp + 1.6);
    const b = HF.p(lx, HH - 1.2, HDp - 1.6);
    addBeam(hm, a, b, 0.45, { color: 0x6a7078 }, 4);
    addBeam(hm, HF.p(lx, HH - 9, -HDp + 1.6), HF.p(lx, HH - 9, HDp - 1.6), 0.4, { color: 0x6a7078 }, 4);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const z0 = -HDp + 1.6 + ((HD.d - 3.2) * i) / n;
      const z1 = -HDp + 1.6 + ((HD.d - 3.2) * (i + 1)) / n;
      addBeam(hm, HF.p(lx, i % 2 ? HH - 9 : HH - 1.2, z0), HF.p(lx, i % 2 ? HH - 1.2 : HH - 9, z1), 0.22, { color: 0x6a7078 }, 4);
    }
  }
  // ceiling light panels
  for (let i = 0; i < colX.length - 1; i++) {
    const lx = (colX[i] + colX[i + 1]) / 2;
    for (let k = -2; k <= 2; k++) {
      glow.box(9, 0.25, 1.4, HF.m(lx, HH - 10, k * 17), { color: hdr(0xeaf4ff, 1.6), glow: [0, 0, 0.6] });
      const lp = HF.p(lx, HH - 11, k * 17);
      hangarLamps.push({ x: lp.x, y: lp.y, z: lp.z, r: 64, k: 0.12 });
    }
  }
  // catwalks along the back wall
  for (const y of [20, 38]) {
    hm.box(HD.w - 8, 0.3, 3, HF.m(0, y, HDp - 3.2), { color: 0x5a6068 });
    addBeam(hm, HF.p(-HW + 4, y + 1.1, HDp - 4.6), HF.p(HW - 4, y + 1.1, HDp - 4.6), 0.06, { color: YELLOW }, 4);
    for (let x = -HW + 4; x <= HW - 4; x += 6) addBeam(hm, HF.p(x, y, HDp - 4.6), HF.p(x, y + 1.1, HDp - 4.6), 0.05, { color: YELLOW }, 4);
    glow.box(HD.w - 8, 0.08, 0.08, HF.m(0, y - 0.2, HDp - 4.7), { color: AMBER_L, glow: [0, 0, 0.3] });
  }
  // gantry crane bridge across the hangar
  {
    const y = HH - 13;
    hm.box(HD.w - 6, 3, 2.6, HF.m(0, y, 4), { color: YELLOW });
    hm.box(4, 2.6, 6, HF.m(-20, y - 2.6, 4), { color: 0x9a7a18 });
    addBeam(hm, HF.p(-20, y - 3.8, 4), HF.p(-20, y - 22, 4), 0.08, { color: 0x222222 }, 4);
    hm.box(2.4, 1.4, 2.4, HF.m(-20, y - 22.6, 4), { color: YELLOW });
    for (const lx of [-HW + 3, HW - 3]) hm.box(3, 2, 6, HF.m(lx, y + 0.5, 4), { color: 0x9a7a18 });
  }
  // fascia sign
  const sign = signTexture('RUIMTEHAVEN', { color: '#e8f4ff', glow: 'rgba(120,200,255,1)', height: 128 });
  const sw = 46;
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / sign.userData.aspect), mats.holo(sign, { intensity: 1.3, dayLevel: 0.5, scan: 0, side: THREE.FrontSide }));
  signMesh.position.copy(HF.p(-30, HH - 3.6, -HDp - 2.45));
  signMesh.rotation.y = HF.heading(Math.PI);
  signMesh.name = 'hangar-sign';
  group.add(signMesh);
  // big Ø banners on the front columns
  for (const lx of [colX[1], colX[2], colX[3], colX[4]]) {
    const bw = 8;
    const bh = 30;
    const plane = new THREE.PlaneGeometry(bw, bh, 2, 12);
    banners.add(plane, HF.m(lx, HH - 11 - bh / 2, -HDp - 0.3, 0, Math.PI, 0), {});
    plane.dispose();
    hm.box(bw + 0.6, 0.4, 0.4, HF.m(lx, HH - 10.8, -HDp - 0.3), { color: 0x6a6e76 });
  }
  // colony floor guide lines
  for (const lx of [-22, 22]) decal.box(0.6, 0.02, HD.d - 10, HF.m(lx - 7.2, 0.12, 0), { color: YELLOW });
  decal.box(HD.w - 20, 0.02, 0.6, HF.m(0, 0.12, -HDp + 6), { color: YELLOW });
  pools.push({ x: HD.x, z: HD.z, r: 45, color: 0xbfe0ff, k: 0.12 });

  // ---------------------------------------------------------- control tower
  const tower = { x: 549, z: 189 };
  {
    const ty = gAt(tower.x, tower.z);
    const TF = new Frame(tower.x, ty, tower.z, -0.9);
    painted.box(13, 5, 13, TF.m(0, 1.5, 0), { color: 0x7d8288 });
    TF.box(physics, 0, 1.5, 0, 13, 5, 13);
    painted.add(new THREE.CylinderGeometry(3.1, 3.9, 34, 20), TF.m(0, 4 + 17, 0), { color: 0xb6b8bb });
    TF.box(physics, 0, 21, 0, 6.6, 34, 6.6, 0, { walkable: false });
    painted.add(new THREE.CylinderGeometry(5.2, 5.2, 0.6, 20), TF.m(0, 22, 0), { color: 0x8a8e94 });
    glow.add(new THREE.TorusGeometry(5.25, 0.08, 4, 40), TF.m(0, 21.7, 0, Math.PI / 2, 0, 0), { color: hdr(0x7fd8ff, 3), glow: [0, 0, 0.3] });
    // cab
    painted.add(new THREE.CylinderGeometry(7, 4, 2.4, 8), TF.m(0, 38.8, 0), { flat: true, color: 0x5d6168 });
    glassB.add(new THREE.CylinderGeometry(7.6, 6.6, 5, 8, 1, true), TF.m(0, 42.5, 0), {});
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      addBeam(metal, TF.p(Math.sin(a) * 6.6, 40, Math.cos(a) * 6.6), TF.p(Math.sin(a) * 7.6, 45, Math.cos(a) * 7.6), 0.14, { color: 0x2a2d33 }, 4);
    }
    glow.add(new THREE.CylinderGeometry(6.2, 6.2, 0.9, 8, 1, true), TF.m(0, 40.6, 0), { color: hdr(0x9fdcff, 1.4), glow: [0, 0, 0.5] });
    painted.add(new THREE.CylinderGeometry(8.3, 7.7, 1, 8), TF.m(0, 45.5, 0), { flat: true, color: 0x4a4e55 });
    addBeam(metal, TF.p(0, 46, 0), TF.p(0, 62, 0), 0.18, { color: 0xc0c4ca }, 5);
    glow.add(new THREE.SphereGeometry(0.45, 8, 6), TF.m(0, 62.4, 0), { color: hdr(0xff3020, 6), glow: [0.6, 0, 0.8] });
    pools.push({ x: tower.x, z: tower.z, r: 9, color: 0x9fdcff, k: 0.3 });
  }
  const radar = new THREE.Group();
  {
    const rb = new GeoBuilder({ uv: false });
    rb.add(new THREE.SphereGeometry(2.6, 16, 8, 0, TAU, 0, Math.PI / 2.6), mat(0, 0, 0, Math.PI / 2, 0, 0, 1, 1, 0.45), { color: 0xd8dadc });
    rb.box(0.5, 1.2, 0.5, mat(0, -0.8, 0), { color: 0x5a5e64 });
    const m = rb.mesh(mats.metal, { name: 'tower-radar', castShadow: true });
    m.matrixAutoUpdate = true;
    radar.add(m);
    const ty = gAt(tower.x, tower.z);
    radar.position.set(tower.x, ty + 48.4, tower.z);
    group.add(radar);
  }

  // ---------------------------------------------------------- fuel tanks (north-west corner)
  for (const [x, z, h] of [[392, 188, 13], [404.5, 186, 11], [393, 201, 12]]) {
    const ty = gAt(x, z);
    painted.add(new THREE.CylinderGeometry(4.4, 4.4, h, 28), mat(x, ty + h / 2, z), { color: 0xd9dadb });
    painted.add(new THREE.SphereGeometry(4.4, 28, 8, 0, TAU, 0, Math.PI / 2), mat(x, ty + h, z, 0, 0, 0, 1, 0.35, 1), { color: 0xd0d2d4 });
    painted.add(new THREE.CylinderGeometry(4.46, 4.46, 1.1, 28, 1, true), mat(x, ty + h * 0.62, z), { color: 0xd06a20 });
    painted.add(new THREE.CylinderGeometry(4.46, 4.46, 0.5, 28, 1, true), mat(x, ty + h * 0.62 - 1.2, z), { color: 0x2a2d33 });
    addBeam(metal, new THREE.Vector3(x + 4.5, ty, z), new THREE.Vector3(x + 4.5, ty + h + 1, z), 0.06, { color: 0x6a6e74 }, 4);
    addBeam(metal, new THREE.Vector3(x + 5.1, ty, z), new THREE.Vector3(x + 5.1, ty + h + 1, z), 0.06, { color: 0x6a6e74 }, 4);
    glow.add(new THREE.SphereGeometry(0.25, 6, 4), mat(x, ty + h + 1.7, z), { color: hdr(0xff3020, 5), glow: [0.45, x * 0.01, 0.6] });
    physics?.addBox({ x, y: ty + h / 2, z, w: 7.8, h, d: 7.8, tag: 'landmarks', walkable: false });
  }
  {
    // spherical tank on legs + pipes to the apron
    const x = 410;
    const z = 199;
    const ty = gAt(x, z);
    painted.add(new THREE.SphereGeometry(4.6, 24, 16), mat(x, ty + 7.5, z), { color: 0xe2e3e4 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      addBeam(metal, new THREE.Vector3(x + Math.cos(a) * 4.2, ty, z + Math.sin(a) * 4.2), new THREE.Vector3(x + Math.cos(a) * 3.6, ty + 7.5, z + Math.sin(a) * 3.6), 0.22, { color: 0x6a6e74 }, 6);
    }
    physics?.addBox({ x, y: ty + 5, z, w: 8.5, h: 10, d: 8.5, tag: 'landmarks', walkable: false });
    for (const [a, b] of [[[397, 196], [406, 199]], [[397, 188], [406, 195]], [[410, 199], [420, 208]]]) {
      addBeam(metal, new THREE.Vector3(a[0], gAt(a[0], a[1]) + 0.9, a[1]), new THREE.Vector3(b[0], gAt(b[0], b[1]) + 0.9, b[1]), 0.32, { color: 0x9a9ea4 }, 8);
    }
  }

  // ---------------------------------------------------------- containers + gantry crane (west edge)
  const containers = [];
  const contColors = [0xb04a2a, 0x2f5e8a, 0x3a7a6a, 0x8a8e94, 0xc28a2a, 0x5a3a6a, 0x2a2d33];
  for (const rx of [386, 389.6, 393.2]) {
    for (const zc of [244, 257, 270, 283]) {
      if (rng.chance(0.15)) continue;
      const stack = rng.int(1, 3);
      for (let k = 0; k < stack; k++) containers.push({ x: rx, z: zc + rng.range(-0.4, 0.4), y: k * 2.62, rot: rng.range(-0.02, 0.02), c: rng.pick(contColors) });
      physics?.addBox({ x: rx, y: gAt(rx, zc) + (stack * 2.62) / 2, z: zc, w: 2.5, h: stack * 2.62, d: 12.3, tag: 'landmarks' });
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = 452 + i * 2.8;
    const z = 318 + rng.range(-0.5, 0.5);
    containers.push({ x, z, y: 0, rot: Math.PI / 2 + rng.range(-0.05, 0.05), c: rng.pick(contColors) });
    physics?.addBox({ x, y: gAt(x, z) + 1.3, z, w: 2.5, h: 2.62, d: 12.3, rotY: Math.PI / 2, tag: 'landmarks' });
  }
  const ribs = ribTexture();
  ribs.wrapS = ribs.wrapT = THREE.RepeatWrapping;
  ribs.repeat.set(3, 1);
  const contMat = new THREE.MeshStandardMaterial({ map: ribs, roughness: 0.62, metalness: 0.35 });
  mats.list.push(contMat);
  const contMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.44, 2.6, 12.2), contMat, containers.length);
  contMesh.name = 'spaceport-containers';
  {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    containers.forEach((k, i) => {
      m4.compose(new THREE.Vector3(k.x, gAt(k.x, k.z) + 1.3 + k.y, k.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k.rot), new THREE.Vector3(1, 1, 1));
      contMesh.setMatrixAt(i, m4);
      contMesh.setColorAt(i, c.set(k.c));
    });
    contMesh.instanceMatrix.needsUpdate = true;
    contMesh.instanceColor.needsUpdate = true;
    contMesh.castShadow = true;
    contMesh.receiveShadow = true;
    contMesh.computeBoundingSphere();
  }
  group.add(contMesh);
  {
    // gantry crane straddling the container rows
    const gy0 = gAt(389, 263);
    const H = 17;
    for (const z of [243, 284]) {
      for (const x of [381.8, 397.6]) {
        addBeam(metal, new THREE.Vector3(x, gy0, z - 2.5), new THREE.Vector3(x, gy0 + H, z), 0.35, { color: YELLOW }, 4);
        addBeam(metal, new THREE.Vector3(x, gy0, z + 2.5), new THREE.Vector3(x, gy0 + H, z), 0.35, { color: YELLOW }, 4);
        physics?.addBox({ x, y: gy0 + H / 2, z, w: 0.8, h: H, d: 5, tag: 'landmarks', walkable: false });
      }
      metal.box(17, 1.6, 1.6, mat(389.7, gy0 + H, z), { color: YELLOW });
    }
    for (const x of [382.5, 396.9]) metal.box(1.4, 1.6, 42, mat(x, gy0 + H + 1.4, 263.5), { color: YELLOW });
    metal.box(16, 2.2, 3.4, mat(389.7, gy0 + H + 2.6, 262), { color: 0xb58a18 });
    addBeam(metal, new THREE.Vector3(389.7, gy0 + H + 1.5, 262), new THREE.Vector3(389.7, gy0 + 10.5, 262), 0.06, { color: 0x222222 }, 4);
    metal.box(3, 0.6, 12, mat(389.7, gy0 + 10.2, 262), { color: 0x9a7a18 });
    glow.add(new THREE.SphereGeometry(0.3, 6, 4), mat(389.7, gy0 + H + 4, 262), { color: AMBER_L, glow: [0.7, 0.3, 0.6] });
  }

  // ---------------------------------------------------------- floodlight masts + banner poles
  for (const [x, z] of [[384, 179], [470, 179], [384, 326]]) {
    const ty = gAt(x, z);
    addBeam(metal, new THREE.Vector3(x, ty, z), new THREE.Vector3(x, ty + 28, z), 0.3, { color: 0x50555c }, 6);
    metal.box(4.2, 1.6, 1.2, mat(x, ty + 28.5, z, -0.35, Math.atan2(Z.x - x, Z.z - z) + Math.PI, 0), { color: 0x30343a });
    glow.box(3.8, 1.2, 0.1, mat(x + Math.sin(Math.atan2(Z.x - x, Z.z - z)) * 0.65, ty + 28.3, z + Math.cos(Math.atan2(Z.x - x, Z.z - z)) * 0.65, -0.35, Math.atan2(Z.x - x, Z.z - z), 0), { color: hdr(0xfff0d0, 3.2), glow: [0, 0, 0.35] });
    physics?.addBox({ x, y: ty + 14, z, w: 0.8, h: 28, d: 0.8, tag: 'landmarks', walkable: false });
    pools.push({ x: x + (Z.x - x) * 0.12, z: z + (Z.z - z) * 0.12, r: 18, color: 0xfff0d0, k: 0.22 });
  }
  for (const [x, z, rot] of [[420, 178, 0], [452, 178, 0], [383, 212, Math.PI / 2], [383, 228, Math.PI / 2], [510, 178, 0]]) {
    const ty = gAt(x, z);
    const H = 14;
    addBeam(metal, new THREE.Vector3(x, ty, z), new THREE.Vector3(x, ty + H, z), 0.14, { color: 0x2a2d33 }, 6);
    metal.box(3.2, 0.14, 0.14, mat(x, ty + H - 0.4, z, 0, rot, 0), { color: 0x6a6e76 });
    const plane = new THREE.PlaneGeometry(2.8, 7.5, 1, 8);
    banners.add(plane, mat(x + Math.sin(rot) * 0.25, ty + H - 0.5 - 3.75, z + Math.cos(rot) * 0.25, 0, rot, 0), {});
    plane.dispose();
    physics?.addBox({ x, y: ty + H / 2, z, w: 0.35, h: H, d: 0.35, tag: 'landmarks', walkable: false });
  }

  // ---------------------------------------------------------- taxi lines + lights
  const line = (ax, az, bx, bz, w = 0.45, color = YELLOW, lights = true) => {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(bx - ax, bz - az);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    decal.box(w, 0.02, len, mat(mx, gAt(mx, mz) + 0.1, mz, 0, rot, 0), { color });
    if (lights) {
      for (let d = 3; d < len - 2; d += 7) {
        const x = ax + ((bx - ax) * d) / len;
        const z = az + ((bz - az) * d) / len;
        glow.add(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 6), mat(x, gAt(x, z) + 0.12, z), { color: AMBER_L, glow: [-0.4, d * 0.05, 0.25] });
      }
    }
  };
  const ps = Z.pads;
  line(ps.ship.x, ps.ship.z, ps.vtol.x, ps.vtol.z);
  line(ps.vtol.x, ps.vtol.z, 470, 252);
  line(ps.ship.x, ps.ship.z, 418, 270);
  line(418, 270, ps.car.x, ps.car.z, 0.45, YELLOW, false);
  // safety boxes around the north pads
  for (const k of ['ship', 'vtol']) {
    const p = ps[k];
    const r = PADS.find((d) => d.key === k).r + 3;
    const F = new Frame(p.x, 0, p.z, p.rotY);
    for (const [ax, az, bx, bz] of [[-r, -r, r, -r], [r, -r, r, r], [r, r, -r, r], [-r, r, -r, -r]]) {
      const a = F.p(ax, 0, az);
      const b = F.p(bx, 0, bz);
      line(a.x, a.z, b.x, b.z, 0.3, 0xe8e2d4, false);
    }
  }

  // ---------------------------------------------------------- cargo crates near the ship pad
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, TAU);
    const p = { x: ps.ship.x + Math.cos(a) * 21, z: ps.ship.z + Math.sin(a) * 21 };
    if (p.x < 386 || p.z < 180) continue;
    const s = rng.range(1.1, 1.6);
    const ty = gAt(p.x, p.z);
    painted.box(s * 1.4, s, s, mat(p.x, ty + s / 2, p.z, 0, rng.range(0, TAU), 0), { color: 0x24272c });
    glow.box(s * 1.42, 0.08, 0.06, mat(p.x, ty + s * 0.7, p.z, 0, 0, 0), { color: hdr(0x7fd8ff, 2.5), glow: [0, 0, 0.35] });
    physics?.addBox({ x: p.x, y: ty + s / 2, z: p.z, w: s * 1.4, h: s, d: s * 1.4, tag: 'landmarks' });
  }

  // ---------------------------------------------------------- meshes
  group.add(painted.mesh(mats.painted, { name: 'spaceport-structures', castShadow: true, receiveShadow: true }));
  group.add(hp.mesh(mats.paintedLitCool || mats.painted, { name: 'hangar-structure', castShadow: true, receiveShadow: true, lamps: { list: hangarLamps, ambient: 0.1, wrap: 0, max: 1.4 } }));
  group.add(hm.mesh(mats.metalLitCool || mats.metal, { name: 'hangar-steel', castShadow: true, receiveShadow: true, lamps: { list: hangarLamps, ambient: 0.1, wrap: 0, max: 1.4 } }));
  group.add(metal.mesh(mats.metal, { name: 'spaceport-steel', castShadow: true, receiveShadow: true }));
  group.add(glow.mesh(mats.glow, { name: 'spaceport-lights' }));
  const glassMesh = glassB.mesh(mats.glass, { name: 'tower-glass' });
  if (glassMesh) group.add(glassMesh);
  group.add(decal.mesh(mats.decal, { name: 'spaceport-markings', receiveShadow: true }));
  const markMat = new THREE.MeshStandardMaterial({ map: padTexture(), alphaTest: 0.3, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  mats.list.push(markMat);
  group.add(marks.mesh(markMat, { name: 'spaceport-pad-markings', receiveShadow: true }));
  group.add(banners.mesh(mats.banner(), { name: 'spaceport-banners', castShadow: true }));
  group.add(buildPools(mats, pools, (x, z) => gAt(x, z) + 0.14));

  // built-up ground: no terrain grass on the apron / hangar floor, no trees or rocks
  const groundShapes = [
    { x: (R.minX + R.maxX) / 2, z: (R.minZ + R.maxZ) / 2, w: R.maxX - R.minX + 12, d: R.maxZ - R.minZ + 12, soft: 3 },
    { x: HD.x, z: HD.z, w: HD.w + 10, d: HD.d + 10, rotY: HD.rotY, soft: 3 },
  ];
  const clearDiscs = [];
  for (let x = R.minX; x <= R.maxX + 40; x += 40) for (let z = R.minZ; z <= R.maxZ + 30; z += 40) clearDiscs.push({ x, z, r: 31 });
  for (let lx = -HW; lx <= HW; lx += 40) for (const lz of [-HDp / 2, HDp / 2]) clearDiscs.push({ ...HF.p(lx, 0, lz), r: 34 });

  return {
    group,
    groundShapes,
    clearDiscs,
    center: new THREE.Vector3(Z.x, elev, Z.z),
    pads,
    hangar: { position: new THREE.Vector3(HD.x, hgy, HD.z), rotY: HD.rotY, w: HD.w, d: HD.d, h: HD.h, front: HF.p(0, 0, -HDp - 10), floorY: hgy },
    tower: new THREE.Vector3(tower.x, gAt(tower.x, tower.z) + 45, tower.z),
    update(dt) {
      radar.rotation.y += dt * 0.9;
    },
  };
}
