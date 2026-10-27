/**
 * Landmarks — Aurora-stad, the spire city on CITY_ISLANDS across the lake.
 *
 * Layout: an iconic central cluster of needle spires (up to ~320 m) on the
 * main island, secondary spire clusters on the other islands, then a dense
 * fill of towers, twisted towers, terraces, domes and low blocks whose height
 * falls off away from the cores. Curving elevated viaducts link the islands,
 * a low bridge crosses to a lake island, a giant ring arch stands on the
 * south waterfront, piers line the shores and small air traffic circles.
 *
 * Draw calls: per island 3 merged meshes (facades / structure / lights) +
 * shared infrastructure meshes; a near-detail layer (street trees, lamps)
 * per island is only shown when the camera is within ~650 m (LOD).
 */
import * as THREE from 'three';
import { CITY_ISLANDS } from '../world/layout.js';
import { Rng } from '../core/math.js';
import { GeoBuilder, mat, addBeam, sweepProfile, TAU, hdr } from './common.js';
import { createBuildingKit, CITY_PALETTE } from './cityBuildings.js';
import { makeRoadTraffic } from './cityTraffic.js';

const CORE = { x: 60, z: -845 };
const PLATFORM_Y = 3;
const WARM = hdr(0xffc890, 1.8);
const CYAN = hdr(0x7fd8ff, 1.9);

// iconic central cluster (offsets from CORE): the poster's needle spires
const ICONIC = [
  { dx: 0, dz: 0, h: 322, r: 15, sides: 8, rings: 2 },
  { dx: -31, dz: 15, h: 272, r: 12, sides: 6, rings: 1 },
  { dx: 31, dz: -12, h: 290, r: 13, sides: 8, rings: 0 },
  { dx: -10, dz: -38, h: 246, r: 11, sides: 12, rings: 1 },
  { dx: 24, dz: 36, h: 224, r: 11, sides: 6, rings: 0 },
  { dx: -52, dz: -14, h: 206, r: 10, sides: 8, rings: 1 },
  { dx: 56, dz: 22, h: 188, r: 10, sides: 6, rings: 0 },
  { dx: 6, dz: 66, h: 170, r: 12, sides: 8, rings: 1 },
  { dx: -38, dz: 54, h: 152, r: 9, sides: 6, rings: 0 },
  { dx: 50, dz: -50, h: 176, r: 10, sides: 12, rings: 0 },
  { dx: -64, dz: 30, h: 132, r: 9, sides: 8, rings: 0 },
];

// secondary clusters per island index (offsets from the island centre)
const CLUSTERS = [
  [], // main island uses ICONIC
  [{ dx: -12, dz: 4, h: 236, r: 11 }, { dx: 24, dz: 22, h: 186, r: 9 }, { dx: -32, dz: 34, h: 158, r: 8 }, { dx: 30, dz: -26, h: 132, r: 7 }],
  [{ dx: 0, dz: -8, h: 252, r: 12 }, { dx: -30, dz: 20, h: 196, r: 9 }, { dx: 28, dz: 26, h: 172, r: 9 }, { dx: 22, dz: -42, h: 150, r: 8 }, { dx: -40, dz: -30, h: 128, r: 7 }],
  [{ dx: 0, dz: 0, h: 268, r: 12 }, { dx: -32, dz: -20, h: 214, r: 10 }, { dx: 34, dz: 14, h: 196, r: 10 }, { dx: 10, dz: 44, h: 162, r: 9 }, { dx: -44, dz: 30, h: 140, r: 8 }],
  [{ dx: 0, dz: 0, h: 186, r: 10 }, { dx: 26, dz: 22, h: 152, r: 8 }, { dx: -28, dz: 16, h: 124, r: 7 }],
];
const FILL_COUNT = [150, 62, 66, 72, 42];
const FILL_HMAX = [215, 170, 180, 190, 150];

const VIADUCTS = [
  { y: 19, pts: [[-312, -712], [-226, -742], [-124, -756], [-30, -758], [60, -745], [152, -768], [236, -770], [332, -726]] },
  { y: 24, pts: [[152, -768], [178, -846], [168, -930], [126, -1004], [86, -1090]] },
  { y: 14, pts: [[-30, -758], [-82, -842], [-122, -930], [-176, -1006]] },
];
const ARCH = { x: -22, z: -642, R: 52, tube: 3.4 };

export function buildCity(env) {
  const { mats, physics, ground } = env;
  const rng = new Rng('aurora-stad');
  const root = new THREE.Group();
  root.name = 'landmarks-city';

  // ---------------------------------------------------------- islands
  const islands = CITY_ISLANDS.map((isl, id) => {
    let land = ground.at(isl.x, isl.z) > 0.6 ? 1 : 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      if (ground.at(isl.x + Math.cos(a) * isl.radius * 0.55, isl.z + Math.sin(a) * isl.radius * 0.55) > 0.6) land++;
    }
    return { ...isl, id, natural: land >= 7, platformR: land >= 7 ? 0 : isl.radius * 0.9 };
  });
  const cityGround = (x, z) => {
    const h = ground.at(x, z);
    for (const isl of islands) if (isl.platformR && Math.hypot(x - isl.x, z - isl.z) < isl.platformR - 1) return Math.max(h, PLATFORM_Y);
    return h;
  };
  const minGround = (x, z, r) => {
    let m = cityGround(x, z);
    for (let k = 0; k < 6; k++) m = Math.min(m, cityGround(x + Math.cos((k / 6) * TAU) * r, z + Math.sin((k / 6) * TAU) * r));
    return m;
  };
  const nearestIsland = (x, z) => {
    let best = islands[0];
    let bd = Infinity;
    for (const isl of islands) {
      const d = Math.hypot(x - isl.x, z - isl.z) / isl.radius;
      if (d < bd) {
        bd = d;
        best = isl;
      }
    }
    return best;
  };

  // per-island builders
  const districts = islands.map((isl) => ({
    island: isl,
    F: new GeoBuilder({ facade: true, uv: false }),
    S: new GeoBuilder({ uv: false }),
    L: new GeoBuilder({ glow: true, uv: false }),
    N: new GeoBuilder({ uv: false }), // near detail (trees, street furniture)
    NL: new GeoBuilder({ glow: true, uv: false }),
    kits: null,
  }));
  for (const d of districts) d.kit = createBuildingKit({ F: d.F, S: d.S, L: d.L, physics, rng });
  const infraS = new GeoBuilder({ uv: false });
  const infraL = new GeoBuilder({ glow: true, uv: false });
  const plates = new GeoBuilder({ uv: true });

  // ---------------------------------------------------------- viaduct paths (smoothed)
  const viaducts = VIADUCTS.map((v) => {
    const curve = new THREE.CatmullRomCurve3(v.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.5);
    const len = curve.getLength();
    const n = Math.ceil(len / 3);
    const pts = curve.getSpacedPoints(n);
    return { ...v, curve, pts, len };
  });
  const distToViaduct = (x, z) => {
    let best = Infinity;
    for (const v of viaducts) for (let i = 0; i < v.pts.length; i += 2) best = Math.min(best, Math.hypot(x - v.pts[i].x, z - v.pts[i].z));
    return best;
  };

  // ---------------------------------------------------------- placement
  const placed = [];
  const tops = [];
  const isFree = (x, z, r) => {
    for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < r + p.r) return false;
    if (Math.abs(x - ARCH.x) < ARCH.R + 10 && Math.abs(z - ARCH.z) < 18) return false;
    return true;
  };
  const reserve = (x, z, r) => placed.push({ x, z, r });

  // foundations for hand-placed buildings standing in the water
  const foundation = (d, x, z, r, topY) => {
    d.S.add(new THREE.CylinderGeometry(r, r * 1.08, topY + 10, 16), mat(x, (topY - 10) / 2, z), { color: CITY_PALETTE.graphite });
    physics?.addBox({ x, y: (topY - 10) / 2, z, w: r * 1.6, h: topY + 10, d: r * 1.6, tag: 'landmarks' });
  };

  // iconic cluster
  const dMain = districts[0];
  for (const s of ICONIC) {
    const x = CORE.x + s.dx;
    const z = CORE.z + s.dz;
    let gy = minGround(x, z, s.r * 1.6);
    if (gy < 0.8) {
      foundation(dMain, x, z, s.r * 2, 2);
      gy = 2;
    }
    const t = dMain.kit.spire(x, z, gy, s.h, s.r, { sides: s.sides, rings: s.rings, style: s.r > 12 ? 4 : undefined, scale: 1.35 });
    reserve(x, z, s.r * 1.9);
    tops.push(t);
  }
  // sky-bridges in the core
  const skyPairs = [[0, 1, 118], [0, 2, 158], [1, 5, 86], [2, 9, 96], [0, 4, 74]];
  for (const [a, b, y] of skyPairs) {
    const A = ICONIC[a];
    const B = ICONIC[b];
    const gy = cityGround(CORE.x, CORE.z);
    dMain.kit.skybridge({ x: CORE.x + A.dx, z: CORE.z + A.dz }, { x: CORE.x + B.dx, z: CORE.z + B.dz }, gy + y, 5);
  }

  // secondary clusters
  islands.forEach((isl, i) => {
    const d = districts[i];
    for (const s of CLUSTERS[i]) {
      const x = isl.x + s.dx;
      const z = isl.z + s.dz;
      let gy = minGround(x, z, s.r * 1.6);
      if (gy < 0.8) {
        foundation(d, x, z, s.r * 2, 2);
        gy = 2;
      }
      tops.push(d.kit.spire(x, z, gy, s.h, s.r, { scale: 1.3 }));
      reserve(x, z, s.r * 1.9);
    }
  });

  // Centrum: an open fountain plaza with a giant Ø sculpture (kept free of fill buildings)
  const CENTRUM = { x: -12, z: -712, r: 23 };
  reserve(CENTRUM.x, CENTRUM.z, CENTRUM.r + 4);

  // fill
  // tall = buildings of 60 m or more (incl. the hand-placed spire clusters)
  const stats = { busy: 0, viaduct: 0, water: 0, ok: 0, tall: ICONIC.length + CLUSTERS.reduce((n, c) => n + c.length, 0) };
  islands.forEach((isl, i) => {
    const d = districts[i];
    const k = d.kit;
    let made = 0;
    const maxAttempts = FILL_COUNT[i] * 24;
    for (let attempt = 0; attempt < maxAttempts && made < FILL_COUNT[i]; attempt++) {
      // later attempts use smaller footprints so they fill the gaps
      const shrink = THREE.MathUtils.lerp(1, 0.55, attempt / maxAttempts);
      const a = rng.range(0, TAU);
      const rr = Math.sqrt(rng.random()) * isl.radius * 0.94;
      const x = isl.x + Math.cos(a) * rr;
      const z = isl.z + Math.sin(a) * rr;
      const t = rr / isl.radius;
      const coreD = Math.hypot(x - CORE.x, z - CORE.z);
      const coreBoost = i === 0 ? (1 - THREE.MathUtils.smoothstep(coreD, 60, 220)) * 0.6 : 0;
      let h = FILL_HMAX[i] * Math.pow(1 - t, 1.0) * rng.range(0.45, 1.05) * (1 + coreBoost) + rng.range(10, 22);
      let type;
      const roll = rng.random();
      if (h > 95) type = roll < 0.36 ? 'tower' : roll < 0.6 ? 'twisted' : 'spire';
      else if (h > 50) type = roll < 0.55 ? 'tower' : roll < 0.75 ? 'twisted' : roll < 0.92 ? 'terraces' : 'dome';
      else type = roll < 0.6 ? 'block' : roll < 0.82 ? 'terraces' : roll < 0.9 ? 'dome' : 'tower';
      let W = 0;
      let D = 0;
      let R = 0;
      // R = footprint radius used for spacing (slightly less than the
      // circumscribed radius: neighbouring blocks may nearly touch)
      if (type === 'tower') {
        W = rng.range(12, 24);
        D = rng.range(12, 22);
        R = Math.max(W, D) * 0.5;
      } else if (type === 'twisted') {
        R = rng.range(8, 13);
      } else if (type === 'spire') {
        R = rng.range(5, 8);
        h = Math.max(h, 120) * rng.range(1, 1.25);
      } else if (type === 'terraces') {
        W = rng.range(18, 28);
        D = rng.range(16, 24);
        R = Math.max(W, D) * 0.5;
        h = Math.min(h, 46);
      } else if (type === 'dome') {
        R = rng.range(14, 24);
        h = R;
      } else {
        W = rng.range(10, 24);
        D = rng.range(10, 22);
        R = Math.max(W, D) * 0.5;
        h = Math.min(h, 48);
      }
      W *= shrink;
      D *= shrink;
      R *= shrink;
      const clear = (type === 'spire' ? R * 1.8 : R) + 1.6;
      if (!isFree(x, z, clear)) {
        stats.busy++;
        continue;
      }
      if (distToViaduct(x, z) < R + 8.5) {
        stats.viaduct++;
        continue;
      }
      const gy = minGround(x, z, R * 0.8);
      if (gy < 0.8) {
        stats.water++;
        continue;
      }
      stats.ok++;
      const rotY = rng.chance(0.7) ? Math.atan2(x - CORE.x, z - CORE.z) : rng.range(0, TAU);
      let res;
      if (type === 'tower') res = k.tower(x, z, gy, h, W, D, rotY);
      else if (type === 'twisted') res = k.twisted(x, z, gy, h, R);
      else if (type === 'spire') res = k.spire(x, z, gy, h, R, { segments: 2 });
      else if (type === 'terraces') res = k.terraces(x, z, gy, h, W, D, rotY);
      else if (type === 'dome') res = k.dome(x, z, gy, R);
      else res = k.block(x, z, gy, h, W, D, rotY);
      reserve(x, z, clear);
      if (res && res.top > 120) tops.push(res);
      if (res && res.top - gy >= 60) stats.tall++;
      made++;
    }
    d.count = made + CLUSTERS[i].length + (i === 0 ? ICONIC.length : 0);
  });

  // ---------------------------------------------------------- viaducts
  const roads = []; // deck centre lines for the GPU traffic
  const deckProfile = [
    [-7, -1.4], [7, -1.4], [7, 0], [6.7, 0], [6.7, 1.1], [6.2, 1.1], [6.2, 0.08], [-6.2, 0.08], [-6.2, 1.1], [-6.7, 1.1], [-6.7, 0], [-7, 0],
  ];
  for (const v of viaducts) {
    const n = v.pts.length;
    const deck = v.pts.map((p, i) => {
      const t = i / (n - 1);
      const g = Math.max(cityGround(p.x, p.z), 0.6);
      const ramp = THREE.MathUtils.smoothstep(t, 0, 0.22) * THREE.MathUtils.smoothstep(1 - t, 0, 0.22);
      return new THREE.Vector3(p.x, THREE.MathUtils.lerp(g + 0.4, Math.max(v.y, g + 9), ramp), p.z);
    });
    v.deck = deck;
    roads.push({ pts: deck, lanes: [2.0, 4.6], density: 2.4 });
    const g = sweepProfile(deck, deckProfile, { closed: true });
    infraS.add(g, undefined, { color: CITY_PALETTE.pearl });
    g.dispose();
    // light strips under both deck edges + lamp dots on the barriers
    for (const side of [-1, 1]) {
      const strip = sweepProfile(deck, [[side * 7.05, -0.9], [side * 7.05, -0.6]]);
      infraL.add(strip, undefined, { color: CYAN, glow: [0, 0, 0.3] });
      strip.dispose();
    }
    for (let i = 0; i < n; i += 4) {
      const p = deck[i];
      const q = deck[Math.min(n - 1, i + 1)];
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) {
        infraL.box(0.5, 0.25, 0.5, mat(p.x + (-dz / l) * side * 6.45, p.y + 1.25, p.z + (dx / l) * side * 6.45), { color: WARM, glow: [0, 0, 0.25] });
      }
    }
    // piers + physics
    let lastPier = -999;
    for (let i = 0; i < n - 1; i++) {
      const p = deck[i];
      const q = deck[i + 1];
      const gy = cityGround(p.x, p.z);
      const along = (i / (n - 1)) * v.len;
      if (p.y - gy > 5 && along - lastPier > 34) {
        lastPier = along;
        infraS.add(new THREE.CylinderGeometry(1.5, 1.9, p.y - gy + 4, 10), mat(p.x, (p.y - 1.4 + gy - 4) / 2, p.z), { color: CITY_PALETTE.silver });
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        infraS.box(15, 1.2, 3, mat(p.x, p.y - 2, p.z, 0, Math.atan2(dx, dz) + Math.PI / 2, 0), { color: CITY_PALETTE.steel });
        physics?.addBox({ x: p.x, y: (p.y - 1.4 + gy) / 2, z: p.z, w: 3.4, h: Math.max(1, p.y - 1.4 - gy), d: 3.4, tag: 'landmarks' });
      }
      const mx = (p.x + q.x) / 2;
      const mz = (p.z + q.z) / 2;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const top = (p.y + q.y) / 2;
      physics?.addBox({ x: mx, y: top - 0.7, z: mz, w: 14, h: 1.4, d: len + 0.4, rotY: Math.atan2(q.x - p.x, q.z - p.z), tag: 'landmarks' });
    }
  }

  // ---------------------------------------------------------- lake bridge
  {
    const a = new THREE.Vector3(76, 0, -642);
    const b = new THREE.Vector3(62, 0, -534);
    const pts = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = THREE.MathUtils.lerp(a.x, b.x, t) + Math.sin(t * Math.PI) * 6;
      const z = THREE.MathUtils.lerp(a.z, b.z, t);
      const gy = Math.max(ground.at(x, z), 0);
      const y = Math.max(gy + 0.6, 3.2 + Math.sin(t * Math.PI) * 4.5);
      pts.push(new THREE.Vector3(x, y, z));
    }
    roads.push({ pts, lanes: [1.8], density: 1.6 });
    const prof = [[-4.5, -1], [4.5, -1], [4.5, 0], [4.2, 0], [4.2, 1.0], [3.9, 1.0], [3.9, 0.06], [-3.9, 0.06], [-3.9, 1.0], [-4.2, 1.0], [-4.2, 0], [-4.5, 0]];
    const g = sweepProfile(pts, prof, { closed: true });
    infraS.add(g, undefined, { color: CITY_PALETTE.white });
    g.dispose();
    // arches under the deck (3 spans)
    for (let s = 0; s < 3; s++) {
      const arc = [];
      for (let j = 0; j <= 12; j++) {
        const t = (s + j / 12) / 3;
        const i = Math.round(t * n);
        const p = pts[i];
        const sag = Math.sin((j / 12) * Math.PI);
        arc.push(new THREE.Vector3(p.x, p.y - 1 - (1 - sag) * 5.5, p.z));
      }
      for (const side of [-1, 1]) {
        const ag = sweepProfile(arc, [[side * 3.4 - 0.5, -0.6], [side * 3.4 + 0.5, -0.6], [side * 3.4 + 0.5, 0.6], [side * 3.4 - 0.5, 0.6]], { closed: true });
        infraS.add(ag, undefined, { color: CITY_PALETTE.pearl });
        ag.dispose();
      }
      const p = pts[Math.round((s / 3) * n)];
      infraS.add(new THREE.CylinderGeometry(1.4, 1.8, p.y + 6, 8), mat(p.x, (p.y - 6) / 2, p.z), { color: CITY_PALETTE.silver });
    }
    for (let i = 0; i <= n; i += 4) {
      const p = pts[i];
      for (const side of [-1, 1]) {
        addBeam(infraS, new THREE.Vector3(p.x + side * 4.05, p.y, p.z), new THREE.Vector3(p.x + side * 4.05, p.y + 4.2, p.z), 0.09, { color: CITY_PALETTE.graphite }, 5);
        infraL.add(new THREE.SphereGeometry(0.28, 6, 4), mat(p.x + side * 4.05, p.y + 4.3, p.z), { color: WARM, glow: [0, 0, 0.2] });
      }
    }
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      physics?.addBox({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 - 0.5, z: (p.z + q.z) / 2, w: 9, h: 1, d: p.distanceTo(q) + 0.3, rotY: Math.atan2(q.x - p.x, q.z - p.z), tag: 'landmarks' });
    }
  }

  // ---------------------------------------------------------- ring arch monument
  {
    const gy = Math.max(cityGround(ARCH.x, ARCH.z), 0);
    const cy = gy + ARCH.R - 7;
    infraS.add(new THREE.TorusGeometry(ARCH.R, ARCH.tube, 14, 160), mat(ARCH.x, cy, ARCH.z), { color: CITY_PALETTE.white });
    infraS.add(new THREE.TorusGeometry(ARCH.R - 6, 1.1, 8, 140), mat(ARCH.x, cy, ARCH.z - 3.2), { color: CITY_PALETTE.silver });
    infraL.add(new THREE.TorusGeometry(ARCH.R - ARCH.tube - 0.1, 0.42, 4, 160), mat(ARCH.x, cy, ARCH.z + 1.8), { color: hdr(0xffd7a0, 2.4), glow: [0, 0, 0.35] });
    infraL.add(new THREE.TorusGeometry(ARCH.R - 6, 0.3, 4, 140), mat(ARCH.x, cy, ARCH.z - 4.4), { color: CYAN, glow: [-0.15, 0, 0.3] });
    // plinths where the ring meets the ground / water
    const foot = Math.sqrt(Math.max(0, ARCH.R * ARCH.R - (ARCH.R - 7) * (ARCH.R - 7)));
    for (const side of [-1, 1]) {
      const px = ARCH.x + side * foot;
      const pg = Math.min(ground.at(px, ARCH.z), gy);
      infraS.box(12, gy - pg + 8, 12, mat(px, (gy + pg) / 2 - 2, ARCH.z), { color: CITY_PALETTE.graphite });
      physics?.addBox({ x: px, y: (gy + pg) / 2 - 2, z: ARCH.z, w: 12, h: gy - pg + 8, d: 12, tag: 'landmarks' });
    }
    infraS.box(foot * 2 + 14, 1.6, 16, mat(ARCH.x, gy + 0.2, ARCH.z), { color: CITY_PALETTE.pearl });
  }

  // ---------------------------------------------------------- piers / docks
  const docks = [];
  islands.forEach((isl, i) => {
    let made = 0;
    for (let k = 0; k < 9 && made < (i === 0 ? 4 : 2); k++) {
      const a = (-0.95 + (k / 8) * 1.9) + rng.range(-0.08, 0.08); // southern arc (towards the viewer)
      const dirX = Math.sin(a);
      const dirZ = Math.cos(a);
      let shore = null;
      for (let r = isl.radius * 0.5; r < isl.radius * 1.6; r += 3) {
        const x = isl.x + dirX * r;
        const z = isl.z + dirZ * r;
        if (cityGround(x, z) < 0.25) {
          shore = { x, z, r };
          break;
        }
      }
      if (!shore) continue;
      const endX = shore.x + dirX * 28;
      const endZ = shore.z + dirZ * 28;
      if (ground.at(endX, endZ) > -1.2) continue;
      if (docks.some((d) => Math.hypot(d.x - shore.x, d.z - shore.z) < 60)) continue;
      const rotY = Math.atan2(dirX, dirZ);
      const cx = shore.x + dirX * 12;
      const cz = shore.z + dirZ * 12;
      infraS.box(4.5, 0.6, 32, mat(cx, 1.3, cz, 0, rotY, 0), { color: CITY_PALETTE.steel });
      for (let j = 0; j < 7; j++) {
        const t = -14 + j * 5;
        for (const side of [-1, 1]) {
          infraS.add(new THREE.CylinderGeometry(0.25, 0.25, 6, 6), mat(cx + dirX * t + Math.cos(rotY) * side * 2, -1.5, cz + dirZ * t - Math.sin(rotY) * side * 2), { color: CITY_PALETTE.graphite });
        }
      }
      infraL.box(0.5, 0.5, 0.5, mat(endX - dirX * 2, 1.9, endZ - dirZ * 2), { color: WARM, glow: [-0.4, rng.random(), 0.3] });
      // a moored boat
      const bx = cx + Math.cos(rotY) * 5.5;
      const bz = cz - Math.sin(rotY) * 5.5;
      infraS.add(new THREE.CylinderGeometry(0.1, 1.6, 9, 6, 1), mat(bx, 0.5, bz, Math.PI / 2, rotY, 0, 1, 1, 0.55), { color: CITY_PALETTE.white });
      infraS.box(2, 1.1, 3, mat(bx, 1.3, bz, 0, rotY, 0), { color: CITY_PALETTE.dark });
      physics?.addBox({ x: cx, y: 1.3, z: cz, w: 4.5, h: 0.6, d: 32, rotY, tag: 'landmarks' });
      docks.push(shore);
      made++;
    }
  });

  // ---------------------------------------------------------- waterfront lights
  // a string of warm lamps along every island's lake-facing shore: from the
  // spawn ridge and the lookout they glitter (and mirror in the lake) along the far shore
  islands.forEach((isl) => {
    let prev = null;
    for (let deg = -105; deg <= 105; deg += 2.4) {
      const a = (deg * Math.PI) / 180;
      const dirX = Math.sin(a);
      const dirZ = Math.cos(a);
      let shore = null;
      for (let r = isl.radius * 0.55; r < isl.radius * 1.5; r += 2) {
        if (cityGround(isl.x + dirX * r, isl.z + dirZ * r) < 0.3) {
          shore = { x: isl.x + dirX * (r - 3), z: isl.z + dirZ * (r - 3) };
          break;
        }
      }
      if (!shore) continue;
      if (prev && Math.hypot(shore.x - prev.x, shore.z - prev.z) < 7) continue;
      const gy = cityGround(shore.x, shore.z);
      if (gy < 0.6) continue;
      prev = shore;
      addBeam(infraS, new THREE.Vector3(shore.x, gy, shore.z), new THREE.Vector3(shore.x, gy + 4.2, shore.z), 0.09, { color: CITY_PALETTE.graphite }, 4);
      infraL.add(new THREE.SphereGeometry(0.34, 6, 4), mat(shore.x, gy + 4.35, shore.z), { color: rng.chance(0.85) ? WARM : CYAN, glow: [0, 0, 0.3] });
    }
  });

  // ---------------------------------------------------------- ground plates (city paving)
  {
    for (const isl of islands) {
      const rings = 10;
      const segs = 40;
      const R = isl.radius * 0.97;
      const pos = [];
      const idx = [];
      const uv = [];
      for (let r = 0; r <= rings; r++) {
        const rr = (r / rings) * R;
        for (let s = 0; s < (r === 0 ? 1 : segs); s++) {
          const a = (s / segs) * TAU;
          const x = isl.x + Math.cos(a) * rr;
          const z = isl.z + Math.sin(a) * rr;
          const h = cityGround(x, z);
          pos.push(x, Math.max(h, -0.6) + 0.35, z);
          uv.push(x / 8, z / 8);
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
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      pg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      pg.setIndex(idx);
      pg.computeVertexNormals();
      plates.add(pg, undefined, { color: 0xb8b4ae });
      pg.dispose();
      if (isl.platformR) {
        // artificial island (the terrain has no land here): sea wall + deck
        const wall = new THREE.CylinderGeometry(isl.platformR, isl.platformR * 1.04, PLATFORM_Y + 10, 48, 1, true);
        infraS.add(wall, mat(isl.x, (PLATFORM_Y - 10) / 2, isl.z), { color: CITY_PALETTE.graphite });
        wall.dispose();
        infraS.add(new THREE.CircleGeometry(isl.platformR, 48).rotateX(-Math.PI / 2), mat(isl.x, PLATFORM_Y, isl.z), { color: 0x8c8a86 });
        for (let k = 0; k < 4; k++) {
          physics?.addBox({ x: isl.x, y: PLATFORM_Y - 5, z: isl.z, w: isl.platformR * 2, h: 10, d: isl.platformR * 0.83, rotY: (k / 4) * (Math.PI / 2), tag: 'landmarks' });
        }
      }
    }
  }

  // ---------------------------------------------------------- Centrum: Ø fountain plaza
  const cityBanners = new GeoBuilder({ uv: true });
  const fountainWater = new GeoBuilder({ uv: false });
  {
    const { x, z, r } = CENTRUM;
    const gy = cityGround(x, z);
    const dm = districts[0];
    // paving + raised rim
    dm.S.add(new THREE.CylinderGeometry(r, r + 0.4, 0.5, 56), mat(x, gy + 0.1, z), { color: 0xa9a49c });
    physics?.addBox({ x, y: gy + 0.1, z, w: r * 1.42, h: 0.5, d: r * 1.42, tag: 'landmarks' });
    physics?.addBox({ x, y: gy + 0.1, z, w: r * 1.42, h: 0.5, d: r * 1.42, rotY: Math.PI / 4, tag: 'landmarks' });
    // fountain basin (low wall + water) around the sculpture
    const BR = 8.5;
    dm.S.add(new THREE.CylinderGeometry(BR, BR + 0.2, 0.9, 48, 1, true), mat(x, gy + 0.8, z), { color: CITY_PALETTE.white });
    dm.S.add(new THREE.TorusGeometry(BR + 0.1, 0.32, 6, 48), mat(x, gy + 1.25, z, Math.PI / 2, 0, 0), { color: CITY_PALETTE.pearl });
    fountainWater.add(new THREE.CircleGeometry(BR - 0.1, 40).rotateX(-Math.PI / 2), mat(x, gy + 1.0, z), { color: 0x1d3846 });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      physics?.addBox({ x: x + Math.cos(a) * BR, y: gy + 0.8, z: z + Math.sin(a) * BR, w: 0.6, h: 0.9, d: 3.4, rotY: -a, walkable: true, tag: 'landmarks' });
    }
    // water jets: glowing arcs of spray around the basin edge, aimed at the centre
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      let prev = new THREE.Vector3(x + Math.cos(a) * (BR - 0.6), gy + 1.0, z + Math.sin(a) * (BR - 0.6));
      for (let j = 1; j <= 6; j++) {
        const t = j / 6;
        const rr = (BR - 0.6) * (1 - t * 0.55);
        const p = new THREE.Vector3(x + Math.cos(a) * rr, gy + 1.0 + Math.sin(t * Math.PI) * 3.2, z + Math.sin(a) * rr);
        addBeam(infraL, prev, p, 0.07, { color: hdr(0xc8f0ff, 1.4), glow: [0, 0, 0.55] }, 4);
        prev = p;
      }
    }
    // the Ø: a polished ring on a plinth, crossed by the slash, facing south (the lake)
    const RR = 5.6;
    const cy = gy + 2.2 + RR + 1.2;
    dm.S.add(new THREE.CylinderGeometry(1.8, 2.3, 2.2, 24), mat(x, gy + 1.1 + 0.9, z), { color: CITY_PALETTE.graphite });
    dm.S.add(new THREE.TorusGeometry(RR, 0.62, 16, 72), mat(x, cy, z), { color: 0xd4d7db });
    const ext = RR * 1.45;
    addBeam(dm.S, new THREE.Vector3(x - ext * 0.7071, cy - ext * 0.7071, z), new THREE.Vector3(x + ext * 0.7071, cy + ext * 0.7071, z), 0.55, { color: 0xd4d7db }, 10);
    dm.L.add(new THREE.TorusGeometry(RR, 0.1, 4, 72), mat(x, cy, z - 0.62), { color: CYAN, glow: [-0.2, 0, 0.3] });
    physics?.addBox({ x, y: gy + 1.9, z, w: 3.4, h: 2.6, d: 3.4, tag: 'landmarks', walkable: false });
    // Ø banner poles around the plaza
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.2;
      const px = x + Math.cos(a) * (r - 2.5);
      const pz = z + Math.sin(a) * (r - 2.5);
      const pg = cityGround(px, pz);
      addBeam(dm.S, new THREE.Vector3(px, pg, pz), new THREE.Vector3(px, pg + 11, pz), 0.12, { color: CITY_PALETTE.graphite }, 6);
      const rot = Math.atan2(x - px, z - pz) + Math.PI; // banner faces outwards
      dm.S.box(2.6, 0.12, 0.12, mat(px, pg + 10.7, pz, 0, rot, 0), { color: CITY_PALETTE.silver });
      const plane = new THREE.PlaneGeometry(2.3, 6.2, 1, 6);
      cityBanners.add(plane, mat(px - Math.sin(rot) * 0.2, pg + 10.6 - 3.1, pz - Math.cos(rot) * 0.2, 0, rot, 0), {});
      plane.dispose();
      dm.L.add(new THREE.SphereGeometry(0.16, 6, 4), mat(px, pg + 11.2, pz), { color: CYAN, glow: [-0.4, k * 0.13, 0.3] });
      physics?.addBox({ x: px, y: pg + 5.5, z: pz, w: 0.3, h: 11, d: 0.3, tag: 'landmarks', walkable: false });
    }
  }

  // ---------------------------------------------------------- near detail (LOD): street trees + lamps
  districts.forEach((d) => {
    const isl = d.island;
    let trees = 0;
    for (let attempt = 0; attempt < 700 && trees < 70; attempt++) {
      const a = rng.range(0, TAU);
      const rr = Math.sqrt(rng.random()) * isl.radius * 0.92;
      const x = isl.x + Math.cos(a) * rr;
      const z = isl.z + Math.sin(a) * rr;
      if (!isFree(x, z, 2.5)) continue;
      const gy = cityGround(x, z);
      if (gy < 0.8) continue;
      const s = rng.range(0.8, 1.3);
      const violet = rng.chance(0.35);
      d.N.add(new THREE.CylinderGeometry(0.18 * s, 0.3 * s, 4 * s, 5), mat(x, gy + 2 * s, z), { color: 0x3a2c22 });
      d.N.add(new THREE.IcosahedronGeometry(2.4 * s, 0), mat(x, gy + 5 * s, z, rng.range(0, 3), rng.range(0, 3), 0, 1, 0.8, 1), {
        flat: true,
        color: violet ? 0x7a4fc0 : rng.pick([0x4b6b2e, 0x5a7a34, 0x3f5c28]),
      });
      if (violet) d.NL.add(new THREE.IcosahedronGeometry(2.45 * s, 0), mat(x, gy + 5 * s, z, 0.3, 0.2, 0, 1, 0.8, 1), { color: hdr(0x9b6cff, 0.35), glow: [0, 0, 0.15] });
      reserve(x, z, 1.2);
      trees++;
      if (rng.chance(0.35)) {
        const lx = x + 3;
        const lz = z;
        const lg = cityGround(lx, lz);
        addBeam(d.N, new THREE.Vector3(lx, lg, lz), new THREE.Vector3(lx, lg + 5.5, lz), 0.08, { color: 0x2a2d33 }, 5);
        d.NL.add(new THREE.SphereGeometry(0.3, 6, 4), mat(lx, lg + 5.6, lz), { color: WARM, glow: [0, 0, 0.1] });
      }
    }
  });

  // ---------------------------------------------------------- meshes
  const nearGroups = [];
  for (const d of districts) {
    const g = new THREE.Group();
    g.name = `city-district-${d.island.id}`;
    const f = d.F.mesh(mats.cityFacade, { name: 'city-facades', castShadow: true, receiveShadow: true });
    const s = d.S.mesh(mats.cityMetal, { name: 'city-structure', castShadow: true, receiveShadow: true });
    const l = d.L.mesh(mats.glow, { name: 'city-lights' });
    [f, s, l].forEach((m) => m && g.add(m));
    const near = new THREE.Group();
    near.name = 'city-near-detail';
    const n1 = d.N.mesh(mats.matte, { name: 'city-trees', castShadow: true, receiveShadow: true });
    const n2 = d.NL.mesh(mats.glow, { name: 'city-near-lights' });
    [n1, n2].forEach((m) => m && near.add(m));
    near.visible = false;
    g.add(near);
    nearGroups.push({ group: near, x: d.island.x, z: d.island.z, r: d.island.radius });
    root.add(g);
  }
  const bannerMesh = cityBanners.mesh(mats.banner(), { name: 'city-banners', castShadow: true });
  if (bannerMesh) root.add(bannerMesh);
  const waterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.04, metalness: 0.3, envMapIntensity: 1.4 });
  mats.list.push(waterMat);
  const waterMesh = fountainWater.mesh(waterMat, { name: 'city-fountain-water', receiveShadow: true });
  if (waterMesh) root.add(waterMesh);
  const infra = infraS.mesh(mats.cityMetal, { name: 'city-infrastructure', castShadow: true, receiveShadow: true });
  const infraLights = infraL.mesh(mats.glow, { name: 'city-infra-lights' });
  const plateMesh = plates.mesh(mats.apron, { name: 'city-ground', receiveShadow: true });
  if (plateMesh) root.add(plateMesh);
  [infra, infraLights].forEach((m) => m && root.add(m));

  // ---------------------------------------------------------- air traffic (GPU-animated dots)
  const traffic = makeTraffic(mats, rng);
  root.add(traffic);
  // head/tail-light streams on the viaducts + lake bridge (GPU animated)
  const roadTraffic = makeRoadTraffic(mats, roads, rng);
  if (roadTraffic) root.add(roadTraffic);

  // tallest point (for markers / camera targets)
  tops.sort((a, b) => b.top - a.top);
  const tallest = tops[0] || { x: CORE.x, z: CORE.z, top: 300 };

  let lodTimer = 0;
  return {
    group: root,
    // paved city islands: no terrain grass through the plates, no forest trees
    groundShapes: islands.map((isl) => ({ x: isl.x, z: isl.z, r: isl.radius * 0.97, soft: 4 })),
    clearDiscs: islands.map((isl) => ({ x: isl.x, z: isl.z, r: isl.radius * 0.97 })),
    center: new THREE.Vector3(CORE.x, cityGround(CORE.x, CORE.z), CORE.z),
    top: new THREE.Vector3(tallest.x, tallest.top, tallest.z),
    islands,
    buildingCount: districts.reduce((n, d) => n + (d.count || 0), 0),
    stats,
    viaducts: viaducts.map((v) => v.deck),
    /** LOD: near detail only within ~650 m of the camera. */
    update(dt, camera) {
      lodTimer -= dt;
      if (lodTimer > 0) return;
      lodTimer = 0.25;
      const cp = camera.position;
      for (const n of nearGroups) n.group.visible = Math.hypot(cp.x - n.x, cp.z - n.z) < n.r + 520 && cp.y < 900;
    },
  };
}

/** Small aircraft lights circling the skyline (vertex-shader animated Points). */
function makeTraffic(mats, rng) {
  const N = 70;
  const center = new Float32Array(N * 3);
  const orbit = new Float32Array(N * 4);
  const color = new Float32Array(N * 3);
  const position = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    center[i * 3] = CORE.x + rng.range(-160, 160);
    center[i * 3 + 1] = rng.range(70, 240);
    center[i * 3 + 2] = CORE.z + rng.range(-120, 120);
    orbit[i * 4] = rng.range(120, 420); // radius x
    orbit[i * 4 + 1] = rng.range(80, 260); // radius z
    orbit[i * 4 + 2] = rng.range(0.012, 0.035) * (rng.chance(0.5) ? 1 : -1); // angular speed
    orbit[i * 4 + 3] = rng.range(0, TAU);
    const c = rng.pick([[1, 0.85, 0.6], [0.6, 0.85, 1], [1, 0.5, 0.3], [0.9, 0.9, 1]]);
    color.set(c, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
  g.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
  g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CORE.x, 150, CORE.z), 700);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: mats.U.uTime, uNight: mats.U.uNight },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter; attribute vec4 aOrbit; attribute vec3 aColor;
      uniform float uTime; uniform float uNight;
      varying vec3 vColor;
      void main() {
        float a = aOrbit.w + uTime * aOrbit.z;
        vec3 p = aCenter + vec3(cos(a) * aOrbit.x, sin(a * 2.0 + aOrbit.w) * 6.0, sin(a) * aOrbit.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float blink = 0.65 + 0.35 * step(0.5, fract(uTime * 0.9 + aOrbit.w));
        vColor = aColor * mix(0.35, 4.0, uNight) * blink;
        gl_PointSize = clamp(1800.0 / -mv.z, 1.2, 3.5) * mix(0.8, 1.2, uNight);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, length(d));
        gl_FragColor = vec4(vColor * a, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  mats.list.push(m);
  const p = new THREE.Points(g, m);
  p.name = 'city-air-traffic';
  p.frustumCulled = true;
  return p;
}
