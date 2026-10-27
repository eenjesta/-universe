/**
 * Landmarks — life on the lake: a few sailboats (one InstancedMesh, gently
 * bobbing, some slowly sailing loops in deep water) and a lakeside promenade
 * with railing, lamps, benches and a jetty on the shore north-west of the
 * plaza. The shoreline is found by sampling the terrain, so the promenade
 * follows whatever coast the terrain module produced.
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { Rng } from '../core/math.js';
import { GeoBuilder, mat, addBeam, sweepProfile, TAU, hdr } from './common.js';
import { buildPools } from './plaza.js';

const BOAT_SPOTS = [
  [-40, -385, 46],
  [195, -300, 60],
  [-262, -330, 0],
  [95, -465, 70],
  [-115, -470, 40],
  [250, -395, 0],
  [-330, -470, 55],
];

export function buildLake(env) {
  const { mats, physics, ground } = env;
  const rng = new Rng('meer');
  const group = new THREE.Group();
  group.name = 'landmarks-lake';

  // ---------------------------------------------------------- sailboats
  const deep = (x, z, r) => {
    for (let k = 0; k < 8; k++) if (ground.at(x + Math.cos((k / 8) * TAU) * r, z + Math.sin((k / 8) * TAU) * r) > -2.2) return false;
    return ground.at(x, z) < -2.5;
  };
  const boats = [];
  for (const [x, z, loop] of BOAT_SPOTS) {
    let bx = x;
    let bz = z;
    let ok = deep(bx, bz, 9);
    for (let tries = 0; tries < 20 && !ok; tries++) {
      bx = x + rng.range(-40, 40);
      bz = z + rng.range(-40, 40);
      ok = deep(bx, bz, 9);
    }
    if (!ok) continue;
    let radius = loop;
    if (radius > 0) {
      for (let k = 0; k < 16 && radius > 0; k++) {
        const a = (k / 16) * TAU;
        if (!deep(bx + Math.cos(a) * radius, bz + Math.sin(a) * radius, 8)) radius = 0;
      }
    }
    boats.push({ cx: bx, cz: bz, radius, speed: rng.range(0.25, 0.45) / Math.max(radius, 1), phase: rng.range(0, TAU), bob: rng.range(0, TAU), dir: rng.chance(0.5) ? 1 : -1, heading: rng.range(0, TAU) });
  }
  const boatGeo = makeBoatGeometry();

  // ---------------------------------------------------------- promenade (shore north-west of the plaza)
  const P = ZONES.plaza;
  const shore = [];
  for (let b = 236; b <= 356; b += 4) {
    const a = (b * Math.PI) / 180;
    const dx = Math.sin(a);
    const dz = -Math.cos(a);
    let found = null;
    for (let r = 70; r < 260; r += 2) {
      const x = P.x + dx * r;
      const z = P.z + dz * r;
      if (ground.at(x, z) < 1.0) {
        found = { x: P.x + dx * (r - 3.5), z: P.z + dz * (r - 3.5), r, dx, dz };
        break;
      }
    }
    shore.push(found);
  }
  // longest run of consecutive shore hits without big jumps
  let best = [];
  let cur = [];
  for (let i = 0; i < shore.length; i++) {
    const s = shore[i];
    const prev = cur[cur.length - 1];
    if (s && (!prev || Math.hypot(s.x - prev.x, s.z - prev.z) < 26)) cur.push(s);
    else {
      if (cur.length > best.length) best = cur;
      cur = s ? [s] : [];
    }
  }
  if (cur.length > best.length) best = cur;
  const promenade = { walkPoints: [], benches: [], jetty: null };
  if (best.length >= 6) {
    // smooth the path
    const pts = best.map((s, i) => {
      let x = 0;
      let z = 0;
      let n = 0;
      for (let k = -2; k <= 2; k++) {
        const q = best[Math.min(best.length - 1, Math.max(0, i + k))];
        x += q.x;
        z += q.z;
        n++;
      }
      return new THREE.Vector3(x / n, 0, z / n);
    });
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    const samples = curve.getSpacedPoints(Math.ceil(len / 3)).map((p) => p.setY(Math.max(ground.at(p.x, p.z), 1.4) + 0.25));
    const deck = new GeoBuilder({ uv: true });
    const steel = new GeoBuilder({ uv: false });
    const glow = new GeoBuilder({ glow: true, uv: false });
    const pools = [];
    const W = 5;
    // walkway (stone deck with dark edge)
    const dg = sweepProfile(samples, [[-W / 2, -1.2], [W / 2, -1.2], [W / 2, 0], [-W / 2, 0]], { closed: true });
    deck.add(dg, undefined, { color: 0xb2aca2, uvMode: 'box', uvDiv: 3 });
    dg.dispose();
    // railing on the lake side (right side of the path direction is computed per segment)
    const water = [];
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const q = samples[Math.min(samples.length - 1, i + 1)];
      const o = samples[Math.max(0, i - 1)];
      const tx = q.x - o.x;
      const tz = q.z - o.z;
      const tl = Math.hypot(tx, tz) || 1;
      let nx = -tz / tl;
      let nz = tx / tl;
      // make the normal point away from the plaza (towards the water)
      if ((p.x - P.x) * nx + (p.z - P.z) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      water.push([nx, nz]);
    }
    const rail = samples.map((p, i) => new THREE.Vector3(p.x + water[i][0] * (W / 2 - 0.15), p.y + 1.05, p.z + water[i][1] * (W / 2 - 0.15)));
    const rg = sweepProfile(rail, [[-0.06, -0.05], [0.06, -0.05], [0.06, 0.05], [-0.06, 0.05]], { closed: true });
    steel.add(rg, undefined, { color: 0x2a2d33 });
    rg.dispose();
    for (let i = 0; i < samples.length; i += 2) {
      const r = rail[i];
      addBeam(steel, new THREE.Vector3(r.x, samples[i].y, r.z), r, 0.04, { color: 0x2a2d33 }, 4);
    }
    // physics: deck + railing segments
    for (let i = 0; i < samples.length - 1; i++) {
      const p = samples[i];
      const q = samples[i + 1];
      const rot = Math.atan2(q.x - p.x, q.z - p.z);
      const mx = (p.x + q.x) / 2;
      const mz = (p.z + q.z) / 2;
      const l = Math.hypot(q.x - p.x, q.z - p.z) + 0.3;
      physics?.addBox({ x: mx, y: (p.y + q.y) / 2 - 0.6, z: mz, w: W, h: 1.2, d: l, rotY: rot, tag: 'landmarks' });
      const [nx, nz] = water[i];
      physics?.addBox({ x: mx + nx * (W / 2 - 0.15), y: (p.y + q.y) / 2 + 0.55, z: mz + nz * (W / 2 - 0.15), w: 0.15, h: 1.1, d: l, rotY: rot, tag: 'landmarks', walkable: false });
      if (i % 3 === 0) promenade.walkPoints.push(new THREE.Vector3(mx - nx * 0.8, (p.y + q.y) / 2, mz - nz * 0.8));
    }
    // lamps + benches
    for (let i = 2, n = 0; i < samples.length - 2; i += 4, n++) {
      const p = samples[i];
      const [nx, nz] = water[i];
      const lx = p.x - nx * (W / 2 - 0.3);
      const lz = p.z - nz * (W / 2 - 0.3);
      addBeam(steel, new THREE.Vector3(lx, p.y, lz), new THREE.Vector3(lx, p.y + 4.6, lz), 0.07, { color: 0x24272d }, 6);
      glow.add(new THREE.SphereGeometry(0.22, 8, 6), mat(lx, p.y + 4.75, lz), { color: hdr(0xffd09a, 3.8), glow: [0, 0, 0.25] });
      physics?.addBox({ x: lx, y: p.y + 2.3, z: lz, w: 0.3, h: 4.6, d: 0.3, tag: 'landmarks', walkable: false });
      pools.push({ x: lx, z: lz, r: 5, color: 0xffb46a, k: 0.7 });
      if (n % 2 === 1) {
        // bench facing the water
        const bx = p.x + nx * 0.9;
        const bz = p.z + nz * 0.9;
        const rotY = Math.atan2(-nx, -nz); // faces the water direction
        deck.box(2.2, 0.08, 0.5, mat(bx, p.y + 0.46, bz, 0, rotY, 0), { color: 0xb08860, uvMode: 'box', uvDiv: 1.5 });
        deck.box(2.2, 0.4, 0.08, mat(bx - nx * 0.28, p.y + 0.7, bz - nz * 0.28, 0, rotY, 0), { color: 0xb08860, uvMode: 'box', uvDiv: 1.5 });
        for (const s of [-0.85, 0.85]) steel.box(0.08, 0.44, 0.45, mat(bx + Math.cos(rotY) * s, p.y + 0.22, bz - Math.sin(rotY) * s, 0, rotY, 0), { color: 0x24272d });
        physics?.addBox({ x: bx, y: p.y + 0.25, z: bz, w: 2.2, h: 0.5, d: 0.55, rotY, tag: 'landmarks' });
        promenade.benches.push({ position: new THREE.Vector3(bx, p.y + 0.46, bz), rotY });
      }
    }
    // jetty at the middle of the promenade
    const mid = Math.floor(samples.length / 2);
    {
      const p = samples[mid];
      const [nx, nz] = water[mid];
      const rot = Math.atan2(nx, nz);
      const L = 26;
      const cx = p.x + nx * (W / 2 + L / 2 - 0.5);
      const cz = p.z + nz * (W / 2 + L / 2 - 0.5);
      const y = p.y - 0.05;
      deck.box(3.4, 0.25, L, mat(cx, y - 0.12, cz, 0, rot, 0), { color: 0x9a7a54, uvMode: 'box', uvDiv: 2 });
      for (let k = 0; k <= 5; k++) {
        for (const s of [-1.5, 1.5]) {
          const t = -L / 2 + (k / 5) * L;
          const px = cx + nx * t + Math.cos(rot) * s;
          const pz = cz + nz * t - Math.sin(rot) * s;
          steel.add(new THREE.CylinderGeometry(0.16, 0.16, y + 4, 6), mat(px, (y - 4) / 2, pz), { color: 0x3a2e24 });
        }
      }
      glow.add(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8), mat(cx + nx * (L / 2 - 0.4), y + 0.6, cz + nz * (L / 2 - 0.4)), { color: hdr(0x7fe0ff, 3.4), glow: [-0.5, 0, 0.3] });
      physics?.addBox({ x: cx, y: y - 0.12, z: cz, w: 3.4, h: 0.25, d: L, rotY: rot, tag: 'landmarks' });
      promenade.jetty = new THREE.Vector3(cx + nx * (L / 2 - 1), y, cz + nz * (L / 2 - 1));
      pools.push({ x: cx, z: cz, r: 6, color: 0x7fd8ff, k: 0.25 });
      // moor one more (static) boat at the jetty
      boats.push({ cx: cx + Math.cos(rot) * 4.5 + nx * 4, cz: cz - Math.sin(rot) * 4.5 + nz * 4, radius: 0, speed: 0, phase: 0, bob: rng.range(0, TAU), dir: 1, heading: rot + Math.PI, moored: true });
    }
    group.add(deck.mesh(mats.stoneClean, { name: 'promenade-deck', castShadow: true, receiveShadow: true }));
    group.add(steel.mesh(mats.metal, { name: 'promenade-steel', castShadow: true }));
    group.add(glow.mesh(mats.glow, { name: 'promenade-lights' }));
    group.add(buildPools(mats, pools, (x, z) => Math.max(ground.at(x, z), 1.4) + 0.33));
    promenade.path = samples;
  }

  // boat instances (incl. the boat moored at the jetty)
  const boatsMesh = new THREE.InstancedMesh(boatGeo, mats.painted, Math.max(1, boats.length));
  boatsMesh.name = 'lake-sailboats';
  boatsMesh.count = boats.length;
  boatsMesh.castShadow = true;
  boatsMesh.receiveShadow = true;
  // bounding sphere covering every sailing loop (instances move, the sphere does not)
  {
    const c = new THREE.Vector3();
    boats.forEach((b) => c.add(new THREE.Vector3(b.cx, 0, b.cz)));
    if (boats.length) c.multiplyScalar(1 / boats.length);
    let r = 0;
    for (const b of boats) r = Math.max(r, Math.hypot(b.cx - c.x, b.cz - c.z) + b.radius + 14);
    boatsMesh.boundingSphere = new THREE.Sphere(c, r);
  }
  group.add(boatsMesh);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const place = (t) => {
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i];
      let x = b.cx;
      let z = b.cz;
      let h = b.heading;
      if (b.radius > 0) {
        const a = b.phase + t * b.speed * b.dir;
        x = b.cx + Math.cos(a) * b.radius;
        z = b.cz + Math.sin(a) * b.radius;
        // tangent heading (front = −Z)
        const tx = -Math.sin(a) * b.dir;
        const tz = Math.cos(a) * b.dir;
        h = Math.atan2(-tx, -tz);
      } else if (!b.moored) {
        h = b.heading + Math.sin(t * 0.05 + b.bob) * 0.3;
      }
      const bob = Math.sin(t * 0.9 + b.bob) * 0.12;
      e.set(Math.sin(t * 0.7 + b.bob) * 0.035, h, Math.sin(t * 0.55 + b.bob * 2) * 0.05 + (b.radius > 0 ? 0.08 * b.dir : 0), 'YXZ');
      m4.compose(pos.set(x, bob - 0.15, z), q.setFromEuler(e), one);
      boatsMesh.setMatrixAt(i, m4);
    }
    boatsMesh.instanceMatrix.needsUpdate = true;
  };
  place(0);

  // no grass blades through the promenade deck, no trees on it
  const groundShapes = [];
  const clearDiscs = [];
  if (promenade.path) {
    for (let i = 0; i < promenade.path.length; i += 2) {
      const p = promenade.path[i];
      groundShapes.push({ x: p.x, z: p.z, r: 3.2, soft: 1.5 });
      if (i % 4 === 0) clearDiscs.push({ x: p.x, z: p.z, r: 5 });
    }
  }

  let acc = 0;
  return {
    group,
    groundShapes,
    clearDiscs,
    boats: boats.length,
    promenade,
    update(dt, cam, t) {
      acc += dt;
      if (acc < 1 / 30) return; // boats move slowly: 30 Hz is plenty
      acc = 0;
      place(t);
    },
  };
}

/** One merged sailboat (front = −Z): hull, deck, cabin, mast, boom, sails. */
function makeBoatGeometry() {
  const b = new GeoBuilder({ uv: false });
  const hull = new THREE.BoxGeometry(2.6, 1.3, 8.4, 4, 3, 10);
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const bow = THREE.MathUtils.smoothstep(-z, 0.5, 4.2); // 0 aft … 1 at the bow
    x *= 1 - bow * 0.92;
    x *= 0.55 + 0.45 * THREE.MathUtils.smoothstep(y, -0.65, 0.4);
    const sheer = bow * 0.35;
    p.setXYZ(i, x, y + (y > 0 ? sheer : 0), z * (z > 3.5 ? 0.98 : 1));
  }
  hull.computeVertexNormals();
  b.add(hull, mat(0, 0.25, 0), { color: 0xe9e6e0 });
  hull.dispose();
  b.box(2.3, 0.08, 6.2, mat(0, 0.92, 0.6), { color: 0x9a7650 });
  b.box(1.4, 0.6, 2.0, mat(0, 1.2, 0.8), { color: 0xdedad2 });
  b.box(2.66, 0.12, 8.0, mat(0, 0.45, 0.15), { color: 0x2a3a5a });
  addBeam(b, new THREE.Vector3(0, 0.9, -0.6), new THREE.Vector3(0, 11.5, -0.6), 0.07, { color: 0xb8bcc2 }, 6);
  addBeam(b, new THREE.Vector3(0, 2.0, -0.55), new THREE.Vector3(0, 2.0, 3.6), 0.05, { color: 0xb8bcc2 }, 5);
  // sails (double sided, slight camber)
  const sail = (pts, camber, color) => {
    const g = new THREE.BufferGeometry();
    const [a, c, d] = pts;
    const mid = new THREE.Vector3().addVectors(a, c).add(d).multiplyScalar(1 / 3);
    mid.x += camber;
    const v = [a, c, mid, c, d, mid, d, a, mid];
    const arr = [];
    for (const q of v) arr.push(q.x, q.y, q.z);
    for (let i = v.length - 1; i >= 0; i--) arr.push(v[i].x + 0.01, v[i].y, v[i].z);
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    b.add(g, undefined, { color });
    g.dispose();
  };
  sail([new THREE.Vector3(0, 2.1, -0.5), new THREE.Vector3(0, 11.2, -0.5), new THREE.Vector3(0, 2.1, 3.5)], 0.45, 0xf2efe8);
  sail([new THREE.Vector3(0, 1.0, -4.0), new THREE.Vector3(0, 10.4, -0.7), new THREE.Vector3(0, 1.4, -0.9)], 0.4, 0xe8e4dc);
  const geo = b.build();
  geo.computeBoundingSphere();
  return geo;
}
