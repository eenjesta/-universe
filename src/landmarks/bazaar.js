/**
 * Landmarks — the lantern-lit bazaar street east of the tree (north–south),
 * Oran's stall, lantern strings across the street, crates and goods. At night
 * it turns into the neon "Nachtmarkt": neon awning outlines, a NACHTMARKT sign
 * over the passage from the plaza, a cylindrical hologram billboard and flat
 * holo boards brighten with the night factor. A slowly turning double-ring
 * sculpture stands at the south end.
 */
import * as THREE from 'three';
import { Rng } from '../core/math.js';
import { GeoBuilder, Frame, addBeam, mat, TAU, hdr } from './common.js';
import { holoTexture } from './textures.js';

const AWNING_COLS = [
  [0xb23a26, 0xe0b880],
  [0x9a2a38, 0x3a4878],
  [0xc8602e, 0xf0d8a8],
  [0x2f6a7c, 0xe0c890],
  [0x7a3266, 0xf0c27a],
  [0xb04a1e, 0x5a3a2a],
  [0xd08a2a, 0x7a2430],
];
const GOODS = [0xb8432e, 0xd98c3a, 0x2f7f86, 0x6a4f9a, 0xc9b27a, 0x5a7a3a, 0x9a2f4a, 0xe2d2b0, 0x3a5a8a];
const WARM_LANTERN = hdr(0xffa850, 2.8);
const AMBER_LANTERN = hdr(0xff8a3a, 2.5);
const RED_LANTERN = hdr(0xff5a3a, 2.4);

export function buildBazaar(env, { x0 = 423, zMin = -186, zMax = -114, oran, groundAt, footprints, pools }) {
  const { mats, physics } = env;
  const rng = new Rng('bazaar');
  const group = new THREE.Group();
  group.name = 'bazaar';
  const wood = new GeoBuilder({ uv: true });
  const cloth = new GeoBuilder({ uv: true });
  const goods = new GeoBuilder({ uv: false });
  const metal = new GeoBuilder({ uv: false });
  const glow = new GeoBuilder({ glow: true, uv: false });
  const woodOpts = (color = 0xffffff) => ({ color, uvMode: 'box', uvDiv: 1.6 });
  const lamps = []; // baked warm light around every lantern (see common.js bakeLamps)

  const lantern = (x, y, z, size, color, anchorY) => {
    lamps.push({ x, y, z, r: 2.4 + 2.6 * size, k: 0.8 + 0.35 * size });
    glow.add(new THREE.CylinderGeometry(0.15 * size, 0.19 * size, 0.42 * size, 8), mat(x, y, z), { color, glow: [0, 0, 0.45] });
    metal.add(new THREE.ConeGeometry(0.24 * size, 0.18 * size, 8), mat(x, y + 0.3 * size, z), { color: 0x4a3622 });
    metal.add(new THREE.CylinderGeometry(0.2 * size, 0.2 * size, 0.05 * size, 8), mat(x, y - 0.23 * size, z), { color: 0x4a3622 });
    if (anchorY > y + 0.4 * size) addBeam(metal, new THREE.Vector3(x, y + 0.38 * size, z), new THREE.Vector3(x, anchorY, z), 0.012, { color: 0x222222 }, 3);
  };

  /** Awning made of colour strips, sagging between back and front; uv.y = attachment. */
  const awning = (F, W, D, back, front, cols) => {
    const strips = 6;
    for (let s = 0; s < strips; s++) {
      const x0s = -W / 2 - 0.3 + ((W + 0.6) / strips) * s;
      const x1s = x0s + (W + 0.6) / strips;
      const pos = [];
      const uv = [];
      const idx = [];
      const seg = 8;
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const lz = THREE.MathUtils.lerp(D + 0.2, -1.1, t);
        const ly = THREE.MathUtils.lerp(back, front, t) - Math.sin(t * Math.PI) * 0.22;
        for (const lx of [x0s, x1s]) {
          const p = F.p(lx, ly, lz);
          pos.push(p.x, p.y, p.z);
          uv.push(lx, 1 - Math.sin(t * Math.PI) * 0.8);
        }
      }
      for (let i = 0; i < seg; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      cloth.add(g, undefined, { color: cols[s % 2] });
      g.dispose();
    }
    // front valance (hanging strip, free bottom edge)
    const val = new THREE.PlaneGeometry(W + 0.6, 0.5, 8, 1);
    cloth.add(val, F.m(0, front - 0.27, -1.1, 0, Math.PI, 0), { color: cols[0] });
    val.dispose();
  };

  /** One market stall. F origin = front centre on the ground, local −Z = towards the street. */
  const stall = (F, W, D, o = {}) => {
    const cols = o.colors || rng.pick(AWNING_COLS);
    const back = 3.6;
    const front = 2.8;
    // posts
    for (const [lx, lz, h] of [[-W / 2 + 0.12, -0.9, front], [W / 2 - 0.12, -0.9, front], [-W / 2 + 0.12, D - 0.1, back], [W / 2 - 0.12, D - 0.1, back]]) {
      wood.box(0.16, h, 0.16, F.m(lx, h / 2, lz), woodOpts(0x8a6a4a));
      F.box(physics, lx, h / 2, lz, 0.2, h, 0.2, 0, { walkable: false });
    }
    // counter + runner
    wood.box(W - 0.6, 1.0, 0.75, F.m(0, 0.5, 0.55), woodOpts(0xa07850));
    cloth.add(new THREE.PlaneGeometry(W - 0.8, 0.62).rotateX(-Math.PI / 2), F.m(0, 1.012, 0.55), { color: cols[1] });
    F.box(physics, 0, 0.5, 0.55, W - 0.6, 1.0, 0.75, 0, { walkable: false });
    // back shelf unit
    wood.box(W - 0.3, 2.5, 0.12, F.m(0, 1.25, D - 0.15), woodOpts(0x7a5a3c));
    for (const y of [0.75, 1.4, 2.05]) wood.box(W - 0.5, 0.06, 0.48, F.m(0, y, D - 0.45), woodOpts(0x9a7450));
    F.box(physics, 0, 1.25, D - 0.35, W - 0.3, 2.5, 0.6, 0, { walkable: false });
    // hanging side cloths at the back half of some stalls (the front stays open)
    // (only on request: seen along the street they read as flat boards)
    if (o.sides === true) {
      for (const side of [-1, 1]) {
        const sw = new THREE.PlaneGeometry(D * 0.32, 1.2, 4, 1);
        cloth.add(sw, F.m(side * (W / 2 - 0.05), 2.5, D * 0.78, 0, Math.PI / 2, 0), { color: rng.chance(0.5) ? cols[1] : cols[0] });
        sw.dispose();
      }
    }
    // goods on shelves + counter
    const items = o.items ?? 22;
    for (let i = 0; i < items; i++) {
      const onCounter = i < items * 0.35;
      const lx = rng.range(-W / 2 + 0.6, W / 2 - 0.6);
      const ly = onCounter ? 1.02 : rng.pick([0.78, 1.43, 2.08]);
      const lz = onCounter ? rng.range(0.35, 0.75) : D - rng.range(0.35, 0.6);
      const c = rng.pick(GOODS);
      const kind = rng.int(0, 3);
      const s = rng.range(0.12, 0.26);
      if (kind === 0) goods.box(s * 1.4, s, s, F.m(lx, ly + s / 2, lz, 0, rng.range(-0.4, 0.4), 0), { color: c });
      else if (kind === 1) goods.add(new THREE.CylinderGeometry(s * 0.45, s * 0.55, s * 1.3, 8), F.m(lx, ly + s * 0.65, lz), { color: c });
      else if (kind === 2) goods.add(new THREE.SphereGeometry(s * 0.6, 8, 6), F.m(lx, ly + s * 0.6, lz), { color: c });
      else metal.add(new THREE.SphereGeometry(s * 0.55, 10, 8), F.m(lx, ly + s * 0.55, lz), { color: 0xb08a4a });
    }
    // colourful fabric goods (scarves, rugs) hanging at the back corners
    for (const side of [-1, 1]) {
      if (o.items === 0 || rng.chance(0.25)) continue;
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const hw = rng.range(0.32, 0.52);
        const hl = rng.range(0.9, 1.5);
        const pg = new THREE.PlaneGeometry(hw, hl, 1, 4);
        cloth.add(pg, F.m(side * (W / 2 - 0.42 - k * 0.5), 2.48 - hl / 2, D - 0.78 - k * 0.04, 0, Math.PI, 0), { color: rng.pick(GOODS) });
        pg.dispose();
      }
    }
    awning(F, W, D, back, front, cols);
    // lanterns under the front edge
    const nl = o.lanterns ?? rng.int(2, 3);
    for (let i = 0; i < nl; i++) {
      const lx = THREE.MathUtils.lerp(-W / 2 + 0.7, W / 2 - 0.7, nl === 1 ? 0.5 : i / (nl - 1));
      const p = F.p(lx, 0, -0.75);
      const ly = front - rng.range(0.42, 0.62);
      lantern(p.x, ly + F.y, p.z, rng.range(1.05, 1.35), rng.pick([WARM_LANTERN, WARM_LANTERN, AMBER_LANTERN, RED_LANTERN]), front + F.y - 0.15);
      pools.push({ x: p.x, z: p.z, r: 3.0, color: 0xffa860, k: 0.26 });
    }
    // neon outline along the awning front (night only)
    const neon = rng.pick([hdr(0xff4fd8, 2.4), hdr(0x4fe0ff, 2.4), hdr(0xb07bff, 2.4)]);
    glow.box(W + 0.5, 0.05, 0.05, F.m(0, front + 0.02, -1.16), { color: neon, glow: [0, 0, 0.02] });
    glow.box(W + 0.5, 0.05, 0.05, F.m(0, front - 0.52, -1.16), { color: neon, glow: [0, 0, 0.02] });
    // crates outside
    const nc = rng.int(1, 3);
    for (let i = 0; i < nc; i++) {
      const side = rng.chance(0.5) ? -1 : 1;
      const lx = side * (W / 2 + rng.range(0.5, 0.9));
      const lz = rng.range(0.4, D - 0.8);
      const cs = rng.range(0.55, 0.85);
      const stack = rng.chance(0.3) ? 2 : 1;
      for (let k = 0; k < stack; k++) {
        wood.box(cs, cs, cs, F.m(lx, cs / 2 + k * cs, lz, 0, rng.range(-0.3, 0.3), 0), woodOpts(0xb08a5a));
      }
      F.box(physics, lx, (cs * stack) / 2, lz, cs, cs * stack, cs, 0, { walkable: true });
    }
    // footprint for walk points
    const c = F.p(0, 0, D / 2 - 0.45);
    footprints.rect(c.x, c.z, W + 1.6, D + 1.4, F.rotY);
  };

  // ---------------------------------------------------------- stalls
  const westX = x0 - 3.5; // west stall fronts (face east, +X)
  const eastX = x0 + 3.5; // east stall fronts (face west, −X)
  const westZ = [-180, -172, -164, -136, -128, -120];
  const eastZ = [-181, -173, -165, -157, -148, -117];
  const D = 5.5;
  for (const zc of westZ) {
    const W = 7.2;
    stall(new Frame(westX, groundAt(westX - D / 2, zc), zc, -Math.PI / 2), W, D);
  }
  for (const zc of eastZ) {
    const W = 7.4;
    stall(new Frame(eastX, groundAt(eastX + D / 2, zc), zc, Math.PI / 2), W, D);
  }
  // Oran's stall: bigger, crowded with lanterns, brass orbs, his sigil banner
  const oranZ = oran?.z ?? -132;
  const OF = new Frame(eastX, groundAt(eastX + 3, oranZ), oranZ, Math.PI / 2);
  stall(OF, 11.5, 6.5, { colors: [0x6a1e1a, 0x2a2420], lanterns: 0, items: 34, sides: true });
  for (let i = 0; i < 9; i++) {
    const lx = -4.8 + i * 1.2 + rng.range(-0.2, 0.2);
    const lz = rng.range(-0.6, 2.8);
    const p = OF.p(lx, 0, lz);
    const ly = OF.y + rng.range(1.75, 2.45);
    lantern(p.x, ly, p.z, rng.range(0.9, 1.6), rng.pick([WARM_LANTERN, AMBER_LANTERN, WARM_LANTERN]), OF.y + 3.0);
  }
  pools.push({ x: OF.p(0, 0, -1.5).x, z: OF.p(0, 0, -1.5).z, r: 6, color: 0xffa050, k: 0.7 });
  // brass orb devices with glowing blue cores
  for (let i = 0; i < 4; i++) {
    const p = OF.p(-4 + i * 2.6, 0, 6.5 - 0.5);
    metal.add(new THREE.SphereGeometry(0.32, 14, 10), mat(p.x, OF.y + 1.78, p.z), { color: 0xa8823e });
    glow.add(new THREE.SphereGeometry(0.13, 8, 6), mat(p.x, OF.y + 1.78, p.z + 0.01), { color: hdr(0x5fb0ff, 5), glow: [-0.3, i * 0.37, 0.5] });
  }
  // sigil banner on the back wall (regular lit cloth)
  const sigil = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshStandardMaterial({ map: holoTexture('oran'), roughness: 0.95, side: THREE.DoubleSide }));
  mats.list.push(sigil.material);
  sigil.position.copy(OF.p(2.6, 2.05, 6.5 - 0.24));
  sigil.rotation.y = OF.heading(Math.PI);
  sigil.name = 'oran-banner';
  group.add(sigil);
  // rug in front of the counter
  cloth.add(new THREE.PlaneGeometry(4, 2.4).rotateX(-Math.PI / 2), OF.m(0, 0.03, -2.2), { color: 0x6a2420 });

  // lantern strings across the street
  for (let zc = zMin + 6; zc < zMax - 4; zc += 9) {
    const a = new THREE.Vector3(westX + 0.1, groundAt(westX, zc) + 3.5, zc);
    const b = new THREE.Vector3(eastX - 0.1, groundAt(eastX, zc) + 3.5, zc);
    const n = 7;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * 0.75;
      if (prev) addBeam(metal, prev, p, 0.012, { color: 0x1a1a1a }, 3);
      if (i > 0 && i < n) lantern(p.x, p.y - 0.36, p.z, 0.95, rng.pick([WARM_LANTERN, AMBER_LANTERN, RED_LANTERN]), p.y);
      prev = p;
    }
    // thin posts carrying the strings
    for (const px of [westX - 0.05, eastX + 0.05]) {
      if (Math.abs(zc - oranZ) < 7) continue;
      const gy = groundAt(px, zc);
      addBeam(metal, new THREE.Vector3(px, gy, zc), new THREE.Vector3(px, gy + 3.7, zc), 0.05, { color: 0x2a2622 }, 5);
    }
    pools.push({ x: x0, z: zc, r: 3.4, color: 0xff9a50, k: 0.22 });
  }

  // ---------------------------------------------------------- night market
  // NACHTMARKT sign over the passage (faces the tree, west)
  const signZ = (westZ[2] + westZ[3]) / 2;
  const signX = westX - 2.2;
  const sgy = groundAt(signX, signZ);
  for (const dz of [-6.2, 6.2]) {
    metal.box(0.35, 6.2, 0.35, mat(signX, sgy + 3.1, signZ + dz), { color: 0x1d2026 });
    physics?.addBox({ x: signX, y: sgy + 3.1, z: signZ + dz, w: 0.4, h: 6.2, d: 0.4, tag: 'landmarks', walkable: false });
  }
  metal.box(0.4, 0.4, 12.8, mat(signX, sgy + 6.2, signZ), { color: 0x1d2026 });
  const signMat = mats.holo(holoTexture('nachtmarkt'), { intensity: 1.8, dayLevel: 0.08, scan: 0.25 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), signMat);
  sign.position.set(signX - 0.05, sgy + 7.6, signZ);
  sign.rotation.y = -Math.PI / 2;
  sign.name = 'nachtmarkt-sign';
  group.add(sign);
  glow.box(0.06, 0.06, 11.2, mat(signX - 0.1, sgy + 6.45, signZ), { color: hdr(0xff4fd8, 3), glow: [0, 0, 0.05] });

  // cylindrical hologram billboard at the north end of the street
  const cylZ = zMin - 7;
  const cgy = groundAt(x0, cylZ);
  metal.add(new THREE.CylinderGeometry(2.0, 2.3, 1.2, 24), mat(x0, cgy + 0.6, cylZ), { color: 0x2a2d34 });
  glow.add(new THREE.TorusGeometry(2.05, 0.06, 4, 48), mat(x0, cgy + 1.22, cylZ, Math.PI / 2, 0, 0), { color: hdr(0x6fd8ff, 3), glow: [0, 0, 0.2] });
  metal.add(new THREE.CylinderGeometry(1.9, 1.9, 0.3, 24), mat(x0, cgy + 9.4, cylZ), { color: 0x2a2d34 });
  physics?.addBox({ x: x0, y: cgy + 0.6, z: cylZ, w: 3.6, h: 1.2, d: 3.6, tag: 'landmarks' });
  const portrait = holoTexture('portrait');
  portrait.wrapS = THREE.RepeatWrapping;
  // the portrait repeats 3× around the drum so it keeps its proportions
  const cylGeo = new THREE.CylinderGeometry(1.75, 1.75, 7.8, 48, 1, true);
  const cuv = cylGeo.attributes.uv;
  for (let i = 0; i < cuv.count; i++) cuv.setX(i, cuv.getX(i) * 3);
  const cyl = new THREE.Mesh(cylGeo, mats.holo(portrait, { intensity: 1.2, dayLevel: 0.32, scan: 1 }));
  cyl.position.set(x0, cgy + 5.3, cylZ);
  cyl.name = 'holo-billboard';
  group.add(cyl);
  // flat holo boards on poles
  const boardDefs = [
    { x: x0 + 13, z: -176, rot: -Math.PI / 2, tex: 'logo' },
    { x: x0 - 13, z: -112, rot: Math.PI / 2, tex: 'logo' },
  ];
  for (const b of boardDefs) {
    const gy = groundAt(b.x, b.z);
    metal.box(0.3, 7, 0.3, mat(b.x, gy + 3.5, b.z), { color: 0x1d2026 });
    physics?.addBox({ x: b.x, y: gy + 3.5, z: b.z, w: 0.4, h: 7, d: 0.4, tag: 'landmarks', walkable: false });
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), mats.holo(holoTexture(b.tex), { intensity: 1.5, dayLevel: 0.2, scan: 1 }));
    bm.position.set(b.x, gy + 8.4, b.z);
    bm.rotation.y = b.rot;
    bm.name = 'holo-board';
    group.add(bm);
  }

  // ---------------------------------------------------------- Ø banner poles at both street ends
  const banners = new GeoBuilder({ uv: true });
  for (const [bx, bz, rot] of [[x0 - 4.6, zMin - 2.5, 0], [x0 + 4.6, zMin - 2.5, 0], [x0 - 4.6, zMax + 3.5, Math.PI], [x0 + 4.6, zMax + 3.5, Math.PI]]) {
    const gy = groundAt(bx, bz);
    addBeam(metal, new THREE.Vector3(bx, gy, bz), new THREE.Vector3(bx, gy + 9, bz), 0.1, { color: 0x1d2026 }, 6);
    metal.box(2.4, 0.1, 0.1, mat(bx, gy + 8.7, bz, 0, rot, 0), { color: 0x6a6e76 });
    const plane = new THREE.PlaneGeometry(2.1, 5.2, 1, 6);
    banners.add(plane, mat(bx + Math.sin(rot) * 0.15, gy + 8.6 - 2.6, bz + Math.cos(rot) * 0.15, 0, rot, 0), {});
    plane.dispose();
    glow.box(0.05, 0.05, 0.05, mat(bx, gy + 9.05, bz), { color: hdr(0x7fe0ff, 4), glow: [-0.4, bx, 0.3] });
    physics?.addBox({ x: bx, y: gy + 4.5, z: bz, w: 0.3, h: 9, d: 0.3, tag: 'landmarks', walkable: false });
    footprints.circle(bx, bz, 0.6);
  }
  group.add(banners.mesh(mats.banner(), { name: 'bazaar-banners', castShadow: true }));

  // ---------------------------------------------------------- portrait holo billboards on the shophouse facades
  for (const bz of [-176, -126]) {
    const bx = x0 + 13.2;
    const gy = groundAt(bx, bz);
    const holo = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 8.4), mats.holo(holoTexture('portrait'), { intensity: 1.35, dayLevel: 0.32, scan: 1 }));
    holo.position.set(bx, gy + 10.6, bz);
    holo.rotation.y = -Math.PI / 2;
    holo.name = 'bazaar-holo-billboard';
    group.add(holo);
    metal.box(0.3, 9.0, 5.2, mat(bx + 0.25, gy + 10.6, bz), { color: 0x15171c });
    glow.box(0.08, 9.0, 0.08, mat(bx - 0.05, gy + 10.6, bz - 2.62), { color: hdr(0xff5fd2, 2.2), glow: [0, 0, 0.1] });
    glow.box(0.08, 9.0, 0.08, mat(bx - 0.05, gy + 10.6, bz + 2.62), { color: hdr(0xff5fd2, 2.2), glow: [0, 0, 0.1] });
  }

  // ---------------------------------------------------------- double-ring sculpture (south end)
  const sculpt = new THREE.Group();
  sculpt.name = 'ring-sculpture';
  const sx = x0;
  const sz = zMax + 11;
  const sgy2 = groundAt(sx, sz);
  const ped = new GeoBuilder({ uv: true });
  ped.add(new THREE.CylinderGeometry(3.4, 3.8, 0.9, 32), mat(sx, sgy2 + 0.45, sz), { color: 0x8a8580, uvMode: 'box', uvDiv: 2 });
  ped.add(new THREE.CylinderGeometry(0.5, 0.8, 2.2, 12), mat(sx, sgy2 + 1.9, sz), { color: 0x6a6560, uvMode: 'box', uvDiv: 2 });
  group.add(ped.mesh(mats.stoneClean, { name: 'sculpture-base', castShadow: true, receiveShadow: true }));
  physics?.addBox({ x: sx, y: sgy2 + 0.45, z: sz, w: 6.4, h: 0.9, d: 6.4, tag: 'landmarks' });
  physics?.addBox({ x: sx, y: sgy2 + 3, z: sz, w: 1.2, h: 5, d: 1.2, tag: 'landmarks', walkable: false });
  const ringB = new GeoBuilder({ uv: false });
  const ringL = new GeoBuilder({ glow: true, uv: false });
  ringB.add(new THREE.TorusGeometry(5.2, 0.32, 10, 90), mat(0, 0, 0, 0, 0, 0.55), { color: 0xc9a46a });
  ringB.add(new THREE.TorusGeometry(4.6, 0.26, 10, 90), mat(0, 0, 0, 0, Math.PI / 2, -0.75), { color: 0xb8bcc4 });
  ringL.add(new THREE.TorusGeometry(5.2 - 0.3, 0.05, 4, 90), mat(0, 0, 0, 0, 0, 0.55), { color: hdr(0xffd08a, 3.5), glow: [0, 0, 0.3] });
  ringL.add(new THREE.TorusGeometry(4.6 - 0.24, 0.05, 4, 90), mat(0, 0, 0, 0, Math.PI / 2, -0.75), { color: hdr(0x8fd8ff, 3.5), glow: [0, 0, 0.3] });
  const rb = ringB.mesh(mats.metal, { name: 'sculpture-rings', castShadow: true });
  const rl = ringL.mesh(mats.glow, { name: 'sculpture-glow' });
  rb.matrixAutoUpdate = rl.matrixAutoUpdate = true;
  sculpt.add(rb, rl);
  sculpt.position.set(sx, sgy2 + 7.6, sz);
  group.add(sculpt);
  pools.push({ x: sx, z: sz, r: 9, color: 0xffc070, k: 0.6 });
  footprints.circle(sx, sz, 4.2);
  footprints.circle(x0, cylZ, 2.8);
  for (const b of boardDefs) footprints.circle(b.x, b.z, 0.8);
  footprints.circle(signX, signZ - 6.2, 0.7);
  footprints.circle(signX, signZ + 6.2, 0.7);

  // ---------------------------------------------------------- meshes
  group.add(wood.mesh(mats.woodLit, { name: 'bazaar-wood', castShadow: true, receiveShadow: true, lamps }));
  group.add(cloth.mesh(mats.clothLit, { name: 'bazaar-cloth', castShadow: true, receiveShadow: true, lamps }));
  group.add(goods.mesh(mats.paintedLit, { name: 'bazaar-goods', castShadow: true, lamps }));
  group.add(metal.mesh(mats.metalLit, { name: 'bazaar-metal', castShadow: true, lamps }));
  group.add(glow.mesh(mats.glow, { name: 'bazaar-lights' }));

  // street walk points (aisle centre + both sides)
  const walk = [];
  for (let zc = zMin + 2; zc <= zMax - 2; zc += 5) for (const dx of [-1.6, 0, 1.6]) walk.push(new THREE.Vector3(x0 + dx, groundAt(x0 + dx, zc), zc));

  return {
    group,
    walk,
    street: { x: x0, zMin, zMax },
    oranCounter: OF.p(0, 1.0, 0.55),
    /** spots for violet street trees (planted by the plaza) */
    trees: [{ x: x0 - 7.5, z: zMin - 6 }, { x: x0 + 7.5, z: zMin - 6 }, { x: x0 - 9, z: zMax + 9 }],
    passage: new THREE.Vector3(westX, 0, signZ),
    update(dt) {
      sculpt.rotation.y += dt * 0.12;
      sculpt.children[0].rotation.x += dt * 0.05;
      sculpt.children[1].rotation.x = sculpt.children[0].rotation.x;
    },
  };
}
