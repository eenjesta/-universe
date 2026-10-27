/**
 * Landmarks — Nexus-plein, the social heart around the purple Levensboom.
 *
 * Circular wet stone paving (shader pattern + glowing inlays), the tree with
 * its ring planter, benches, lamp posts, tall pillars with navy Ø banners,
 * curved arcade buildings with warm shop fronts and lit balconies, the
 * holographic marketplace terminal, the Starfall stage (stage.js), the
 * lantern bazaar / Nachtmarkt (bazaar.js), planters with violet flowers,
 * small violet trees, bollards and additive light pools.
 *
 * Provides navigation data: walkPoints (on the paving, never inside props),
 * benches [{position, rotY}], spawnPoints, stage.crowdPoints.
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { Rng } from '../core/math.js';
import { GeoBuilder, Frame, Footprints, addBeam, mat, sweepProfile, TAU, hdr, distToRoads } from './common.js';
import { createBuildingKit } from './cityBuildings.js';
import { holoTexture, canopyLeafTexture } from './textures.js';
import { buildTree } from './tree.js';
import { buildStage } from './stage.js';
import { buildBazaar } from './bazaar.js';
import { buildFlowerBeds } from './flora.js';

const DEG = Math.PI / 180;
const PAVE_R = 84;
const WARM = hdr(0xffc27a, 1.7);

export function buildPlaza(env) {
  const { mats, physics, ground, quality } = env;
  const Z = ZONES.plaza;
  const rng = new Rng('nexus-plein');
  const group = new THREE.Group();
  group.name = 'landmarks-plaza';
  const cx = Z.x;
  const cz = Z.z;
  const gy = ground.at(cx, cz);
  const center = new THREE.Vector3(cx, gy, cz);
  const at = (b, r) => ({ x: cx + Math.sin(b) * r, z: cz - Math.cos(b) * r });
  const gAt = (x, z) => ground.at(x, z);
  const fp = new Footprints();
  const pools = [];
  const clearDiscs = [{ x: cx, z: cz, r: PAVE_R + 6 }]; // terrain trees / rocks removed here
  const lamps = []; // baked warm light (lamp posts, shop fronts) for the *Lit materials

  const stone = new GeoBuilder({ uv: true });
  const painted = new GeoBuilder({ uv: false });
  const facade = new GeoBuilder({ facade: true, uv: false });
  const metal = new GeoBuilder({ uv: false });
  const woodB = new GeoBuilder({ uv: true });
  const glow = new GeoBuilder({ glow: true, uv: false });
  const glass = new GeoBuilder({ uv: false });
  const banners = new GeoBuilder({ uv: true });
  const stoneOpts = (color = 0xb5aea4) => ({ color, uvMode: 'box', uvDiv: 3 });

  const flowerData = [];
  const flowerBed = (x, z, y, r, n) => {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU);
      const rr = Math.sqrt(rng.random()) * r;
      flowerData.push([x + Math.cos(a) * rr, y + rng.range(0, 0.22), z + Math.sin(a) * rr, rng.range(0.07, 0.13)]);
    }
  };

  // ---------------------------------------------------------- paving
  {
    const rings = 44;
    const segs = 120;
    const pos = [];
    const idx = [];
    const uv = [];
    pos.push(cx, gAt(cx, cz) + 0.05, cz);
    uv.push(0, 0);
    for (let r = 1; r <= rings; r++) {
      const rr = (r / rings) * PAVE_R;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * TAU;
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        pos.push(x, gAt(x, z) + 0.05, z);
        uv.push(x / 4, z / 4);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        if (r === 0) idx.push(0, 1 + s1, 1 + s);
        else {
          const a0 = 1 + (r - 1) * segs;
          const a1 = 1 + r * segs;
          idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const pave = new THREE.Mesh(g, mats.paving(center, { radius: PAVE_R }));
    pave.material.polygonOffset = true;
    pave.material.polygonOffsetFactor = -1;
    pave.material.polygonOffsetUnits = -2;
    pave.name = 'plaza-paving';
    pave.receiveShadow = true;
    pave.matrixAutoUpdate = false;
    group.add(pave);
    // curb ring at the paving edge
    const curb = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * TAU;
      const x = cx + Math.cos(a) * PAVE_R;
      const z = cz + Math.sin(a) * PAVE_R;
      curb.push(new THREE.Vector3(x, gAt(x, z) - 0.1, z));
    }
    const cg = sweepProfile(curb, [[-0.35, 0], [0.35, 0], [0.35, 0.28], [-0.35, 0.28]], { closed: true });
    stone.add(cg, undefined, stoneOpts(0x9a948c));
    cg.dispose();
  }

  // ---------------------------------------------------------- tree + planter
  const tree = buildTree(env, { x: Z.tree.x, z: Z.tree.z, gy, height: Z.tree.height, canopyRadius: Z.tree.canopyRadius });
  group.add(tree.group);
  // giant holographic orbit rings around the crown (only during the Starfall show)
  const orbitMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true });
  mats.list.push(orbitMat);
  const orbits = new THREE.Group();
  orbits.name = 'plaza-show-orbits';
  orbits.position.set(cx, gy + Z.tree.height * 0.66, cz);
  for (const [r, tilt, ry] of [[27, 0.3, 0.3], [33, -0.2, 1.4], [22, 0.14, 2.4]]) {
    const holder = new THREE.Group();
    holder.rotation.set(0, ry, tilt);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.08, 4, 180).rotateX(Math.PI / 2), orbitMat);
    holder.add(ring);
    orbits.add(holder);
  }
  orbits.visible = false;
  group.add(orbits);
  const PLANTER_R = 10.5;
  {
    const ring = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * TAU;
      ring.push(new THREE.Vector3(cx + Math.cos(a) * PLANTER_R, gy, cz + Math.sin(a) * PLANTER_R));
    }
    const wall = sweepProfile(ring, [[-0.55, 0], [0.55, 0], [0.55, 0.62], [0.42, 0.75], [-0.42, 0.75], [-0.55, 0.62]], { closed: true });
    stone.add(wall, undefined, stoneOpts(0xc2bab0));
    wall.dispose();
    // glowing inner lip
    const lip = sweepProfile(ring.map((p) => p.clone().setY(gy + 0.76)), [[-0.44, 0], [-0.38, 0], [-0.38, 0.03], [-0.44, 0.03]], { closed: true });
    glow.add(lip, undefined, { color: hdr(0xa47cff, 1.6), glow: [0, 0, 0.2] });
    lip.dispose();
    // soil disc inside
    painted.add(new THREE.CircleGeometry(PLANTER_R - 0.5, 48).rotateX(-Math.PI / 2), mat(cx, gy + 0.45, cz), { color: 0x2a2018 });
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU;
      physics?.addBox({ x: cx + Math.cos(a) * PLANTER_R, y: gy + 0.38, z: cz + Math.sin(a) * PLANTER_R, w: 1.1, h: 0.76, d: 2.9, rotY: -a, tag: 'landmarks' });
    }
    fp.circle(cx, cz, PLANTER_R + 0.8);
    pools.push({ x: cx, z: cz, r: 26, color: 0x8a5cff, k: 0.85 });
  }

  // ---------------------------------------------------------- stage + bazaar + terminal
  const sgy = gAt(Z.stage.x, Z.stage.z);
  const stage = buildStage(env, { x: Z.stage.x, z: Z.stage.z, gy: sgy });
  group.add(stage.group);
  // stage footprint (platform + apron + speakers + truss)
  fp.rect(Z.stage.x, Z.stage.z + 0.8, 35.5, 22.5, 0);
  pools.push({ x: Z.stage.x, z: Z.stage.z + 12, r: 14, color: 0x7a5cff, k: 0.5 });

  const bazaar = buildBazaar(env, { x0: Z.bazaar.x - 1, zMin: Z.bazaar.z - Z.bazaar.length / 2 - 1, zMax: Z.bazaar.z + Z.bazaar.length / 2 + 1, oran: Z.oran, groundAt: gAt, footprints: fp, pools });
  group.add(bazaar.group);

  const terminal = buildTerminal(env, { x: Z.market.x, z: Z.market.z, gy: gAt(Z.market.x, Z.market.z), group, metal, glow, glass, fp, pools });

  // ---------------------------------------------------------- arcade buildings
  const sectors = [
    { b0: 20, b1: 50, r0: 70, floors: 3 },
    { b0: 133, b1: 165, r0: 70, floors: 3 },
    { b0: 214, b1: 262, r0: 70, floors: 4 },
  ];
  for (const s of sectors) {
    const arcLen = (s.b1 - s.b0) * DEG * s.r0;
    const n = Math.max(2, Math.round(arcLen / 9));
    for (let i = 0; i < n; i++) {
      const a0 = (s.b0 + ((s.b1 - s.b0) * i) / n) * DEG;
      const a1 = (s.b0 + ((s.b1 - s.b0) * (i + 1)) / n) * DEG;
      const p0 = at(a0, s.r0);
      const p1 = at(a1, s.r0);
      const mx = (p0.x + p1.x) / 2;
      const mz = (p0.z + p1.z) / 2;
      const L = Math.hypot(p1.x - p0.x, p1.z - p0.z) + 0.05;
      // local −Z faces the plaza centre
      const rotY = Math.atan2(mx - cx, mz - cz);
      const floors = s.floors + (rng.chance(0.3) ? 1 : 0) + (i === Math.floor(n / 2) ? 2 : 0);
      arcadeSegment(new Frame(mx, minAround(gAt, mx, mz, 8), mz, rotY), L, floors, i === 0, i === n - 1);
    }
  }
  // straight row of shophouses behind the bazaar (front faces west)
  {
    const x = Z.bazaar.x + 14.5;
    const zs = Z.bazaar.z - Z.bazaar.length / 2 - 8;
    const ze = Z.bazaar.z + Z.bazaar.length / 2 + 4;
    const n = Math.round((ze - zs) / 9);
    for (let i = 0; i < n; i++) {
      const z = zs + ((ze - zs) * (i + 0.5)) / n;
      arcadeSegment(new Frame(x, minAround(gAt, x, z, 8), z, Math.PI / 2), (ze - zs) / n + 0.05, 2 + (i % 3 === 1 ? 2 : 0) + (rng.chance(0.4) ? 1 : 0), i === 0, i === n - 1, { shopDepth: 2.4 });
    }
  }

  function arcadeSegment(F, L, floors, capStart, capEnd, o = {}) {
    const ARC_H = 4.6;
    const FLOOR = 3.6;
    const DEPTH = 15;
    const SET = 3.4; // upper storeys step back behind a terrace
    const lowF = Math.min(floors, 3);
    const highF = floors - lowF;
    const seed = rng.random();
    const tone = rng.pick([0xcfc6b8, 0xc4baa9, 0xb9b3aa, 0xd6cdbd, 0xaaa59c]);
    const style = rng.pick([2, 2, 3, 1]);
    const dens = rng.range(0.6, 0.95);
    // columns
    for (const lx of capEnd ? [-L / 2, L / 2] : [-L / 2]) {
      stone.box(0.6, ARC_H, 0.6, F.m(lx, ARC_H / 2, 0.4), stoneOpts(0xc8c0b4));
      F.box(physics, lx, ARC_H / 2, 0.4, 0.6, ARC_H, 0.6, 0, { walkable: false });
    }
    void capStart;
    // arcade ceiling + warm strip
    painted.box(L, 0.5, 3.4, F.m(0, ARC_H + 0.25, 1.6), { color: 0x6a645c });
    glow.box(L - 0.4, 0.06, 0.16, F.m(0, ARC_H - 0.04, 1.4), { color: WARM, glow: [0, 0, 0.45] });
    // shop front (lit glass) + mullions + sign band
    const sd = o.shopDepth ?? 3.2;
    glow.box(L - 0.9, 3.1, 0.06, F.m(0, 2.0, sd), { color: hdr(rng.pick([0xffb878, 0xffc88e, 0xffa86a, 0xffd2a0]), rng.range(0.6, 0.85)), glow: [0, 0, 0.55] });
    {
      const sp = F.p(0, 2.2, sd - 1.2);
      lamps.push({ x: sp.x, y: sp.y, z: sp.z, r: 7.5, k: 0.55 });
    }
    for (let k = 0; k <= 3; k++) metal.box(0.08, 3.2, 0.12, F.m(-L / 2 + 0.45 + (k / 3) * (L - 0.9), 2.0, sd - 0.04), { color: 0x1d2025 });
    painted.box(L, 0.9, 0.3, F.m(0, 4.0, sd - 0.1), { color: 0x23262c });
    glow.box(L * rng.range(0.3, 0.6), 0.14, 0.05, F.m(rng.range(-L * 0.15, L * 0.15), 4.0, sd - 0.27), { color: rng.pick([hdr(0x7fe0ff, 2), hdr(0xffc27a, 2), hdr(0xc49bff, 2)]), glow: [0, 0, 0.3] });
    // ground floor mass behind the shop
    painted.box(L, ARC_H + 2, DEPTH - sd, F.m(0, ARC_H / 2 - 1, sd + (DEPTH - sd) / 2), { color: 0x4a463f });
    F.box(physics, 0, ARC_H / 2, sd + (DEPTH - sd) / 2, L, ARC_H, DEPTH - sd);
    // lower storeys (facade shader) overhanging the arcade
    const lowH = lowF * FLOOR;
    facade.box(L, lowH, DEPTH, F.m(0, ARC_H + 0.5 + lowH / 2, DEPTH / 2), { color: tone, baseY: F.y + ARC_H + 0.5, win: [seed, style, dens, 0.9] });
    F.box(physics, 0, ARC_H + 0.5 + lowH / 2, DEPTH / 2, L, lowH, DEPTH);
    // balconies with glass railings + warm strips
    for (let f = 0; f < lowF; f++) {
      if (f === 1 && rng.chance(0.4)) continue;
      const y = ARC_H + 0.5 + f * FLOOR;
      painted.box(L, 0.22, 1.6, F.m(0, y + 0.11, -0.8), { color: 0xd9d2c6 });
      glass.box(L, 1.0, 0.04, F.m(0, y + 0.72, -1.56), { color: 0xffffff });
      metal.box(L, 0.06, 0.08, F.m(0, y + 1.24, -1.56), { color: 0x2a2d33 });
      glow.box(L - 0.2, 0.05, 0.08, F.m(0, y - 0.03, -1.5), { color: WARM, glow: [0, 0, 0.35] });
      if (rng.chance(0.35)) painted.add(new THREE.IcosahedronGeometry(0.45, 0), F.m(rng.range(-L / 2 + 1, L / 2 - 1), y + 0.6, -0.9), { flat: true, color: rng.pick([0x5a7a34, 0x7a4fc0]) });
    }
    let roofY = ARC_H + 0.5 + lowH;
    if (highF > 0) {
      // roof terrace on the setback: railing, planters with violet flowers, warm edge light
      painted.box(L, 0.3, SET, F.m(0, roofY + 0.15, SET / 2), { color: 0xd2cabc });
      glass.box(L, 1.0, 0.04, F.m(0, roofY + 0.8, 0.12), { color: 0xffffff });
      metal.box(L, 0.06, 0.08, F.m(0, roofY + 1.32, 0.12), { color: 0x2a2d33 });
      glow.box(L - 0.2, 0.05, 0.08, F.m(0, roofY - 0.04, 0.02), { color: WARM, glow: [0, 0, 0.35] });
      const plx = rng.range(-L / 4, L / 4);
      const pl = F.p(plx, 0, SET - 0.8);
      painted.box(L * 0.35, 0.55, 0.8, F.m(plx, roofY + 0.58, SET - 0.8), { color: 0x3f5a2a });
      flowerBed(pl.x, pl.z, F.y + roofY + 0.9, 0.5, 10);
      const hiH = highF * FLOOR;
      facade.box(L, hiH, DEPTH - SET, F.m(0, roofY + 0.3 + hiH / 2, SET + (DEPTH - SET) / 2), { color: tone, baseY: F.y + roofY + 0.3, win: [seed, style, dens, 0.9] });
      F.box(physics, 0, roofY + 0.3 + hiH / 2, SET + (DEPTH - SET) / 2, L, hiH, DEPTH - SET);
      roofY += 0.3 + hiH;
    }
    // crown: parapet + planters, occasional rooftop pavilion
    const front = highF > 0 ? SET : 0;
    painted.box(L, 0.9, 0.35, F.m(0, roofY + 0.45, front - 0.1), { color: 0xd2cabc });
    glow.box(L - 0.3, 0.05, 0.06, F.m(0, roofY + 0.88, front - 0.3), { color: hdr(0xffd2a0, 1.5), glow: [0, 0, 0.12] });
    painted.box(L * 0.8, 0.5, 1.2, F.m(0, roofY + 0.25, front + 1.2), { color: 0x3f5a2a });
    if (rng.chance(0.3)) painted.box(L * 0.5, 2.4, 4, F.m(0, roofY + 1.2, front + 6), { color: 0x6a645c });
    // vertical accent light on some corners + neon blade signs
    if (rng.chance(0.4)) {
      const h = roofY - ARC_H - 0.5;
      glow.box(0.07, h - 0.6, 0.07, F.m(L / 2 - 0.05, ARC_H + 0.5 + h / 2, -0.03), { color: rng.pick([hdr(0x7fe0ff, 1.6), hdr(0xb48cff, 1.6)]), glow: [0, 0, 0.1] });
    }
    if (rng.chance(0.35)) {
      const neon = rng.pick([hdr(0xff5fd2, 1.6), hdr(0x6fe0ff, 1.6), hdr(0xffb45a, 1.6), hdr(0xb48cff, 1.6)]);
      const bx = rng.chance(0.5) ? -L / 2 + 0.6 : L / 2 - 0.6;
      painted.box(0.14, 2.6, 1.2, F.m(bx, ARC_H + 2.6, -0.75), { color: 0x1a1c22 });
      glow.box(0.16, 2.3, 0.08, F.m(bx, ARC_H + 2.6, -1.32), { color: neon, glow: [0, 0, 0.12] });
      glow.box(0.18, 0.08, 1.0, F.m(bx, ARC_H + 3.75, -0.75), { color: neon, glow: [0, 0, 0.12] });
      glow.box(0.18, 0.08, 1.0, F.m(bx, ARC_H + 1.45, -0.75), { color: neon, glow: [0, 0, 0.12] });
    }
    fp.rect(F.p(0, 0, DEPTH / 2 - 1).x, F.p(0, 0, DEPTH / 2 - 1).z, L + 1, DEPTH + 1.5, F.rotY);
    const pp = F.p(0, 0, -2.4);
    pools.push({ x: pp.x, z: pp.z, r: L * 0.55, color: 0xffb070, k: 0.35 });
  }

  // ---------------------------------------------------------- backdrop towers on the hills around the plaza
  {
    const kit = createBuildingKit({ F: facade, S: metal, L: glow, physics, rng });
    const defs = [
      [40, 104, 58, 'tower'],
      [74, 100, 44, 'tower'],
      [104, 106, 64, 'twisted'],
      [136, 100, 46, 'terraces'],
      [164, 102, 40, 'tower'],
      [222, 100, 52, 'tower'],
      [248, 98, 34, 'block'],
    ];
    for (const [b, r, h, type] of defs) {
      const p = at(b * DEG, r);
      if (distToRoads(p.x, p.z) < 16) continue;
      const g0 = minAround(gAt, p.x, p.z, 9);
      if (g0 < 1.5) continue;
      clearDiscs.push({ x: p.x, z: p.z, r: 14 });
      const rot = Math.atan2(p.x - cx, p.z - cz);
      if (type === 'tower') kit.tower(p.x, p.z, g0, h, rng.range(15, 20), rng.range(12, 16), rot, { tiers: 2, strips: true, style: rng.pick([2, 3]) });
      else if (type === 'twisted') kit.twisted(p.x, p.z, g0, h, 9.5);
      else if (type === 'terraces') kit.terraces(p.x, p.z, g0, h, 24, 20, rot);
      else kit.block(p.x, p.z, g0, h, 18, 14, rot);
    }
  }

  // ---------------------------------------------------------- banner pillars
  const pillarDefs = [
    { b: 166, r: 62 },
    { b: 214, r: 62 },
    { b: 323, r: 43 },
    { b: 37, r: 43 },
    { b: 287, r: 60 },
    { b: 312, r: 64 },
    { b: 240, r: 58 },
    { b: 148, r: 58 },
    { b: 112, r: 50 },
  ];
  for (const d of pillarDefs) {
    const p = at(d.b * DEG, d.r);
    const pg = gAt(p.x, p.z);
    // local −Z faces the plaza centre
    const F = new Frame(p.x, pg, p.z, Math.atan2(p.x - cx, p.z - cz));
    const H = 17;
    stone.box(1.9, 0.8, 1.9, F.m(0, 0.4, 0), stoneOpts(0x8e8880));
    metal.box(1.25, H, 1.25, F.m(0, H / 2, 0), { color: 0x23262d });
    metal.box(5.2, 0.7, 1.2, F.m(0, H + 0.35, -0.3), { color: 0x23262d });
    metal.box(1.6, 0.4, 1.6, F.m(0, H + 0.9, 0), { color: 0x2c3038 });
    for (const sx of [-1, 1]) glow.box(0.05, H - 2, 0.05, F.m(sx * 0.66, H / 2 + 0.6, -0.66), { color: hdr(0x7fd8ff, 1.4), glow: [0, 0, 0.15] });
    // banner hanging from the crossbeam, in front of the pillar
    const bw = 3.3;
    const bh = 9.5;
    const plane = new THREE.PlaneGeometry(bw, bh, 2, 10);
    banners.add(plane, F.m(0, H - 0.1 - bh / 2, -1.0, 0, Math.PI, 0), {});
    plane.dispose();
    metal.box(bw + 0.3, 0.12, 0.12, F.m(0, H - 0.05, -1.0), { color: 0x6a6e76 });
    metal.box(bw + 0.2, 0.1, 0.1, F.m(0, H - 0.25 - bh, -1.0), { color: 0x6a6e76 });
    F.box(physics, 0, H / 2, 0, 1.3, H, 1.3, 0, { walkable: false });
    fp.circle(p.x, p.z, 1.6);
    pools.push({ x: p.x, z: p.z, r: 4, color: 0x7fd8ff, k: 0.25 });
  }

  // ---------------------------------------------------------- lamps
  const lampAt = (x, z) => {
    if (!fp.free(x, z, 1.2)) return;
    const lg = gAt(x, z);
    metal.add(new THREE.CylinderGeometry(0.09, 0.14, 5.6, 8), mat(x, lg + 2.8, z), { color: 0x24272d });
    metal.add(new THREE.CylinderGeometry(0.28, 0.32, 0.3, 10), mat(x, lg + 0.15, z), { color: 0x24272d });
    metal.add(new THREE.CylinderGeometry(0.55, 0.2, 0.22, 12), mat(x, lg + 5.75, z), { color: 0x24272d });
    glow.add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12), mat(x, lg + 5.62, z), { color: hdr(0xffc890, 1.6), glow: [0, 0, 0.2] });
    glow.add(new THREE.SphereGeometry(0.16, 8, 6), mat(x, lg + 5.5, z), { color: hdr(0xffd6a0, 3), glow: [0, 0, 0.2] });
    physics?.addBox({ x, y: lg + 2.8, z, w: 0.35, h: 5.6, d: 0.35, tag: 'landmarks', walkable: false });
    fp.circle(x, z, 0.6);
    pools.push({ x, z, r: 6.5, color: 0xffb46a, k: 0.75 });
    lamps.push({ x, y: lg + 5.4, z, r: 8.5, k: 0.85 });
  };
  for (let i = 0; i < 10; i++) {
    const b = (i / 10) * TAU + 0.31;
    const deg = ((b / DEG) % 360 + 360) % 360;
    if (deg < 32 || deg > 328) continue; // keep the view on the stage clear
    const p = at(b, 31);
    lampAt(p.x, p.z);
  }
  for (let i = 0; i < 16; i++) {
    const p = at((i / 16) * TAU + 0.1, 57);
    lampAt(p.x, p.z);
  }

  // ---------------------------------------------------------- benches
  const benches = [];
  const bench = (x, z, rotY, back = true) => {
    // rotY = heading a seated person faces
    const F = new Frame(x, gAt(x, z), z, rotY);
    for (const sx of [-0.9, 0.9]) stone.box(0.35, 0.42, 0.55, F.m(sx, 0.21, 0.05), stoneOpts(0x9a948c));
    for (let k = 0; k < 4; k++) woodB.box(2.3, 0.05, 0.12, F.m(0, 0.45, -0.16 + k * 0.14), { color: 0xc09060, uvMode: 'box', uvDiv: 1.5 });
    if (back) for (let k = 0; k < 2; k++) woodB.box(2.3, 0.1, 0.05, F.m(0, 0.72 + k * 0.18, 0.34, 0.12), { color: 0xc09060, uvMode: 'box', uvDiv: 1.5 });
    F.box(physics, 0, 0.24, 0.05, 2.3, 0.48, 0.65);
    fp.rect(x, z, 2.6, 1.1, rotY);
    benches.push({ position: F.p(0, 0.45, -0.05), rotY });
  };
  for (let i = 0; i < 8; i++) {
    const b = (i / 8) * TAU + 0.2;
    const p = at(b, PLANTER_R + 1.35);
    bench(p.x, p.z, -b); // facing outwards, back to the tree
  }
  for (let i = 0; i < 12; i++) {
    const b = (i / 12) * TAU + 0.12;
    const deg = ((b / DEG) % 360 + 360) % 360;
    if (deg < 40 || deg > 320) continue; // crowd area in front of the stage
    const p = at(b, 39);
    if (!fp.free(p.x, p.z, 1.6)) continue;
    bench(p.x, p.z, Math.PI - b); // facing the tree
    // flower planters flanking the bench
    for (const off of [-2.4, 2.4]) {
      const q = at(b + off / 39, 39);
      if (!fp.free(q.x, q.z, 0.8)) continue;
      const qF = new Frame(q.x, gAt(q.x, q.z), q.z, Math.PI - b);
      stone.box(1.4, 0.6, 1.4, qF.m(0, 0.3, 0), stoneOpts(0xb0a89c));
      qF.box(physics, 0, 0.3, 0, 1.4, 0.6, 1.4);
      fp.circle(q.x, q.z, 1.1);
      flowerBed(q.x, q.z, qF.y + 0.62, 0.6, 26);
    }
  }

  // ---------------------------------------------------------- flowers (instanced)
  // flowers in the tree planter
  for (let i = 0; i < 560; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(5.5, PLANTER_R - 0.6);
    flowerData.push([cx + Math.cos(a) * rr, gy + 0.5 + rng.range(0, 0.3), cz + Math.sin(a) * rr, rng.range(0.09, 0.16)]);
  }

  // ---------------------------------------------------------- small violet trees + bollards (lake side)
  const smallTrees = [];
  const treeSpots = [[270, 71], [296, 71], [330, 71], [196, 66], [184, 66], [248, 71], [120, 71], [70, 26], [115, 26], [160, 26], [205, 26], [250, 26], [295, 26]];
  const spots = treeSpots.map(([b, r]) => at(b * DEG, r)).concat(bazaar.trees || []);
  for (const p of spots) {
    if (!fp.free(p.x, p.z, 2)) continue;
    smallTrees.push({ x: p.x, z: p.z, y: gAt(p.x, p.z) });
    stone.add(new THREE.CylinderGeometry(1.7, 1.8, 0.7, 20), mat(p.x, gAt(p.x, p.z) + 0.35, p.z), stoneOpts(0xb5aea4));
    physics?.addBox({ x: p.x, y: gAt(p.x, p.z) + 0.35, z: p.z, w: 3.2, h: 0.7, d: 3.2, tag: 'landmarks' });
    fp.circle(p.x, p.z, 2.2);
    flowerBed(p.x, p.z, gAt(p.x, p.z) + 0.72, 1.4, 40);
    pools.push({ x: p.x, z: p.z, r: 6, color: 0x9a6cff, k: 0.4 });
  }
  for (let b = 262; b <= 342; b += 4) {
    const p = at(b * DEG, PAVE_R - 1.5);
    const lg = gAt(p.x, p.z);
    metal.add(new THREE.CylinderGeometry(0.16, 0.18, 0.9, 10), mat(p.x, lg + 0.45, p.z), { color: 0x25282e });
    glow.add(new THREE.CylinderGeometry(0.13, 0.13, 0.25, 10), mat(p.x, lg + 0.78, p.z), { color: hdr(0xffc890, 2.2), glow: [0, 0, 0.2] });
    pools.push({ x: p.x, z: p.z, r: 2.4, color: 0xffb070, k: 0.5 });
  }

  // ---------------------------------------------------------- holo info totems (rotating Ø holograms)
  const totems = [];
  for (const bDeg of [92, 228]) {
    const p = at(bDeg * DEG, 17.5);
    if (!fp.free(p.x, p.z, 1.2)) continue;
    const ty = gAt(p.x, p.z);
    metal.add(new THREE.CylinderGeometry(0.42, 0.55, 0.3, 16), mat(p.x, ty + 0.15, p.z), { color: 0x23262d });
    metal.box(0.5, 2.3, 0.5, mat(p.x, ty + 1.3, p.z, 0, bDeg * DEG, 0), { color: 0x23262d });
    glow.box(0.06, 2.0, 0.52, mat(p.x, ty + 1.3, p.z, 0, bDeg * DEG, 0), { color: hdr(0x7fe0ff, 1.8), glow: [0, 0, 0.25] });
    glow.add(new THREE.TorusGeometry(0.55, 0.04, 4, 24), mat(p.x, ty + 2.5, p.z, Math.PI / 2, 0, 0), { color: hdr(0x9fe8ff, 2.5), glow: [-0.5, bDeg, 0.3] });
    physics?.addBox({ x: p.x, y: ty + 1.2, z: p.z, w: 0.7, h: 2.4, d: 0.7, tag: 'landmarks', walkable: false });
    fp.circle(p.x, p.z, 1.0);
    pools.push({ x: p.x, z: p.z, r: 3.5, color: 0x7fd8ff, k: 0.45 });
    totems.push(new THREE.Vector3(p.x, ty + 3.4, p.z));
  }
  const holoEmblem = (() => {
    if (!totems.length) return null;
    const tex = holoTexture('logo');
    const m = mats.holo(tex, { intensity: 1.4, dayLevel: 0.6, scan: 1 });
    const g = new THREE.Group();
    g.name = 'plaza-holo-totems';
    for (const t of totems) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), m);
      plane.position.copy(t);
      g.add(plane);
    }
    group.add(g);
    return g;
  })();

  // ---------------------------------------------------------- build meshes
  group.add(stone.mesh(mats.stoneClean, { name: 'plaza-stone', castShadow: true, receiveShadow: true }));
  group.add(painted.mesh(mats.paintedLit || mats.painted, { name: 'plaza-buildings', castShadow: true, receiveShadow: true, lamps: mats.paintedLit ? lamps : null }));
  group.add(facade.mesh(mats.facade, { name: 'plaza-facades', castShadow: true, receiveShadow: true }));
  group.add(metal.mesh(mats.metalLit || mats.metal, { name: 'plaza-metal', castShadow: true, lamps: mats.metalLit ? lamps : null }));
  group.add(woodB.mesh(mats.woodLit || mats.wood, { name: 'plaza-benches', castShadow: true, receiveShadow: true, lamps: mats.woodLit ? lamps : null }));
  group.add(glow.mesh(mats.glow, { name: 'plaza-lights' }));
  const glassMesh = glass.mesh(mats.glass, { name: 'plaza-glass' });
  if (glassMesh) group.add(glassMesh);
  const bannerMat = mats.banner();
  group.add(banners.mesh(bannerMat, { name: 'plaza-banners', castShadow: true }));

  // flowers
  group.add(buildFlowerBeds(mats, flowerData, { name: 'plaza-flowers', seed: 'plaza-flowers' }));

  // small violet trees: trunks + instanced leaf cards (shares the leaf texture)
  if (smallTrees.length) {
    const tb = new GeoBuilder({ uv: false });
    const cards = [];
    for (const t of smallTrees) {
      tb.add(new THREE.CylinderGeometry(0.22, 0.38, 4.2, 7), mat(t.x, t.y + 2.8, t.z), { color: 0x4a3446 });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + rng.range(0, 1);
        addBeam(tb, new THREE.Vector3(t.x, t.y + 4.2, t.z), new THREE.Vector3(t.x + Math.cos(a) * 2, t.y + 5.8, t.z + Math.sin(a) * 2), 0.1, { color: 0x4a3446 }, 5);
      }
      for (let k = 0; k < 70; k++) {
        const a = rng.range(0, TAU);
        const rr = Math.sqrt(rng.random()) * 3.1;
        cards.push([t.x + Math.cos(a) * rr, t.y + 6 + rng.gauss() * 0.8 - rr * 0.25, t.z + Math.sin(a) * rr]);
      }
    }
    group.add(tb.mesh(mats.painted, { name: 'plaza-small-trunks', castShadow: true }));
    const cardMat = new THREE.MeshStandardMaterial({ map: canopyLeafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, emissive: 0x7a4adf, emissiveIntensity: 0.35 });
    cardMat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = mats.U.uNight;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * mix(0.24, 0.7, uNight);');
    };
    cardMat.customProgramCacheKey = () => 'lm-small-leaf';
    mats.list.push(cardMat);
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cardMat, cards.length);
    im.name = 'plaza-small-canopies';
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    cards.forEach((p, i) => {
      const sc = rng.range(1.6, 2.6);
      m4.compose(new THREE.Vector3(p[0], p[1], p[2]), q.setFromEuler(new THREE.Euler(rng.range(-1, 1), rng.range(0, TAU), rng.range(-0.5, 0.5))), new THREE.Vector3(sc, sc, sc));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, c.setHSL(0.77 + rng.range(-0.02, 0.02), 0.65, rng.range(0.45, 0.68)));
    });
    im.castShadow = true;
    im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: canopyLeafTexture(), alphaTest: 0.45, side: THREE.DoubleSide });
    im.computeBoundingSphere();
    group.add(im);
  }

  // light pools (additive ground glow, instanced)
  const poolMesh = buildPools(mats, pools, (x, z) => gAt(x, z) + 0.09);
  group.add(poolMesh);

  // ---------------------------------------------------------- navigation data
  const walkPoints = [];
  for (let r = 14; r <= 76; r += 6.5) {
    const n = Math.max(6, Math.round((TAU * r) / 9));
    for (let i = 0; i < n; i++) {
      const b = (i / n) * TAU + r * 0.13;
      const p = at(b, r);
      if (!fp.free(p.x, p.z, 1.3)) continue;
      walkPoints.push(new THREE.Vector3(p.x, gAt(p.x, p.z), p.z));
    }
  }
  for (const w of bazaar.walk) if (fp.free(w.x, w.z, 0.6)) walkPoints.push(w);

  // crowd points in front of the stage (between the stage and the tree)
  const crowdPoints = [];
  const sf = stage.frame;
  for (let row = 0; row < 6; row++) {
    for (let col = -7; col <= 7; col++) {
      const lx = col * 2.1 + (row % 2) * 1.05;
      const lz = -14.5 - row * 2.2;
      const p = sf.p(lx, 0, lz);
      p.x += rng.range(-0.35, 0.35);
      p.z += rng.range(-0.35, 0.35);
      if (!fp.free(p.x, p.z, 0.7)) continue;
      p.y = gAt(p.x, p.z);
      crowdPoints.push(p);
    }
  }
  stage.crowdPoints = crowdPoints;

  // spawn points: spread over the paving south of the tree, facing it
  const spawnPoints = walkPoints
    .filter((p) => {
      const d = Math.hypot(p.x - cx, p.z - cz);
      return d > 16 && d < 52 && p.z > cz;
    })
    .filter((_, i) => i % 2 === 0)
    .slice(0, 16);
  const spawn = at(185 * DEG, 30);

  const setShow = (on) => stage.setShow(on);
  return {
    group,
    center,
    tree: tree.group,
    treeInfo: { position: tree.base, radius: tree.radius, footprint: PLANTER_R + 0.6, canopyCenter: tree.canopyCenter },
    walkPoints,
    benches,
    spawnPoints,
    spawn: { x: spawn.x, z: spawn.z, heading: Math.atan2(spawn.x - cx, spawn.z - cz) },
    stage,
    setShow,
    market: terminal.position,
    terminal,
    bazaar: { street: bazaar.street, oran: new THREE.Vector3(Z.oran.x, gAt(Z.oran.x, Z.oran.z), Z.oran.z), oranCounter: bazaar.oranCounter, passage: bazaar.passage },
    radius: PAVE_R,
    footprints: fp,
    // no terrain grass through the paving / shophouse row (see groundClear.js)
    groundShapes: [
      { x: cx, z: cz, r: PAVE_R + 1, soft: 3 },
      { x: Z.bazaar.x + 22, z: Z.bazaar.z - 2, w: 18, d: 88, soft: 2 },
    ],
    clearDiscs,
    update(dt, cam, t) {
      if (holoEmblem) for (const c of holoEmblem.children) c.rotation.y = t * 0.8;
      const show = mats.U.uShow.value;
      orbits.visible = show > 0.01;
      if (orbits.visible) {
        orbitMat.color.setRGB(0.55, 0.72, 1.0).multiplyScalar(show * (1.6 + 0.4 * Math.sin(t * 2.3)));
        orbits.children.forEach((h, i) => (h.rotation.y += dt * (0.05 + i * 0.03) * (i % 2 ? -1 : 1)));
      }
      tree.update(dt, cam, t);
      stage.update(dt, cam, t);
      bazaar.update(dt, cam, t);
      terminal.update(dt, cam, t);
    },
    setQuality(q) {
      tree.setQuality(q);
    },
  };
}

function minAround(gAt, x, z, r) {
  let m = gAt(x, z);
  for (let k = 0; k < 6; k++) m = Math.min(m, gAt(x + Math.cos((k / 6) * TAU) * r, z + Math.sin((k / 6) * TAU) * r));
  return m;
}

/** Holographic marketplace terminal (front faces the tree). */
function buildTerminal(env, { x, z, gy, group, metal, glow, fp, pools }) {
  const { mats, physics } = env;
  const cxp = ZONES.plaza.x;
  const czp = ZONES.plaza.z;
  // local −Z faces the tree
  const F = new Frame(x, gy, z, Math.atan2(x - cxp, z - czp));
  metal.box(3.4, 0.9, 1.7, F.m(0, 0.45, 0), { color: 0x2a2e36 });
  metal.box(3.6, 0.12, 1.9, F.m(0, 0.92, 0), { color: 0x9aa0aa });
  metal.box(3.2, 0.14, 1.5, F.m(0, 1.05, 0.05, -0.28, 0, 0), { color: 0x1a1d22 });
  glow.box(3.5, 0.05, 0.05, F.m(0, 0.9, -0.96), { color: hdr(0x7fe0ff, 2), glow: [0, 0, 0.4] });
  glow.box(0.05, 0.05, 1.8, F.m(-1.78, 0.9, 0), { color: hdr(0x7fe0ff, 2), glow: [0, 0, 0.4] });
  glow.box(0.05, 0.05, 1.8, F.m(1.78, 0.9, 0), { color: hdr(0x7fe0ff, 2), glow: [0, 0, 0.4] });
  // projector posts
  for (const sx of [-1.3, 1.3]) {
    metal.box(0.08, 1.0, 0.08, F.m(sx, 1.55, 0.45), { color: 0x9aa0aa });
    glow.add(new THREE.SphereGeometry(0.07, 6, 4), F.m(sx, 2.08, 0.45), { color: hdr(0x9fe8ff, 4), glow: [-0.5, sx, 0.5] });
  }
  F.box(physics, 0, 0.6, 0, 3.6, 1.2, 1.9, 0, { walkable: false });
  fp.rect(x, z, 4.4, 2.8, F.rotY);
  // console surface + floating panel
  const tex = holoTexture('market');
  const deskMat = mats.holo(tex, { intensity: 0.9, dayLevel: 0.8, scan: 0.6, tint: [0.6, 0.9, 1.1] });
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.3), deskMat);
  desk.position.copy(F.p(0, 1.13, 0.05));
  desk.rotation.set(-Math.PI / 2 + 0.28, F.rotY, 0, 'YXZ');
  desk.name = 'market-desk';
  group.add(desk);
  const panelMat = mats.holo(tex, { intensity: 1.5, dayLevel: 0.8, scan: 1 });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.8), panelMat);
  panel.position.copy(F.p(0, 2.55, 0.35));
  panel.rotation.set(-0.12, F.heading(Math.PI), 0, 'YXZ');
  panel.name = 'market-panel';
  group.add(panel);
  pools.push({ x, z, r: 4.5, color: 0x6fd8ff, k: 0.6 });
  const base = panel.position.y;
  return {
    position: new THREE.Vector3(x, gy, z),
    front: F.p(0, 0, -1.8),
    update(dt, cam, t) {
      panel.position.y = base + Math.sin(t * 1.4) * 0.05;
    },
  };
}

/** Instanced additive light pools on the ground. */
export function buildPools(mats, pools, yAt) {
  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, mats.pool, Math.max(1, pools.length));
  mesh.name = 'light-pools';
  const m4 = new THREE.Matrix4();
  const c = new THREE.Color();
  pools.forEach((p, i) => {
    m4.makeScale(p.r, 1, p.r);
    m4.setPosition(p.x, yAt(p.x, p.z), p.z);
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, c.set(p.color).multiplyScalar(p.k ?? 1));
  });
  mesh.count = pools.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.renderOrder = 2;
  return mesh;
}
