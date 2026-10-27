/**
 * Landmarks — Oude ruïnes: the massive overgrown remains of an ancient
 * Ø-civilisation around the road junction at the ruins zone.
 *
 *  - a great gate arch (coursed piers + true wedge voussoirs, broken attic)
 *    spanning the road to the plaza
 *  - a two-tier aqueduct arcade (partly collapsed) in the north-west
 *  - the relief terrace with the great engraved Ø wall that glows cyan when
 *    scanned (setScanned / setScanProgress), flanked by stepped pylons
 *  - a colonnade of fluted drum columns with capitals + an architrave
 *  - a broken watch tower with arched openings in the south
 *  - foundation walls, fallen blocks/drums, a flagstone path, rune stones
 *  - instanced hanging vines, ivy patches, ferns and glowing violet flowers
 *  - dust motes + soft god rays
 * Masonry joints come from real block courses (big blocks read from afar);
 * the stone shader adds moss on top faces and damp streaks.
 */
import * as THREE from 'three';
import { Rng } from '../core/math.js';
import { drawEmblem, canvasTexture } from '../core/textures.js';
import { GeoBuilder, Frame, mat, TAU, distToRoads, hdr } from './common.js';
import { vineTexture, radialTexture, weatheredTexture, ivyTexture, fernTexture } from './textures.js';
import { buildFlowerBeds } from './flora.js';

// near-white tints: the weathered texture defines the sandstone albedo (~25–35 %)
const SAND = [0xf4ead9, 0xe9dcc8, 0xfbf2e4, 0xdfd1bc, 0xf0e2cc, 0xe2d8c8];

export function buildRuins(env, zone) {
  const { mats, physics, ground } = env;
  const rng = new Rng('oude-ruines-2');
  const group = new THREE.Group();
  group.name = 'landmarks-ruins';
  const cx = zone.x;
  const cz = zone.z;
  const gAt = (x, z) => ground.at(x, z);
  const stone = new GeoBuilder({ uv: true });
  const carve = new GeoBuilder({ uv: true });
  const runes = new GeoBuilder({ glow: true, uv: false });
  const vines = []; // {x, y, z, len, rot, w}
  const ivy = []; // {x, y, z, rot, s}
  const ferns = []; // {x, y, z, s}
  const flowers = []; // [x, y, z, s]
  const sandC = () => rng.pick(SAND);
  const so = (c = sandC(), div = 4.5) => ({ color: c, uvMode: 'box', uvDiv: div });
  const at = (bearingDeg, r) => {
    const b = (bearingDeg * Math.PI) / 180;
    return { x: cx + Math.sin(b) * r, z: cz - Math.cos(b) * r };
  };
  const cornerJitter = new Map();

  // ------------------------------------------------------------ primitives
  /** Rough block: a box whose 8 corners are jittered (stays closed), flat shaded. */
  function roughBox(matrix, w, h, d, color, jit = 0.05, div = 4.5) {
    const g = new THREE.BoxGeometry(w, h, d);
    const p = g.attributes.position;
    cornerJitter.clear();
    for (let i = 0; i < p.count; i++) {
      const key = `${Math.sign(p.getX(i))}${Math.sign(p.getY(i))}${Math.sign(p.getZ(i))}`;
      if (!cornerJitter.has(key)) cornerJitter.set(key, [rng.range(-jit, jit), rng.range(-jit, jit) * 0.6, rng.range(-jit, jit)]);
      const j = cornerJitter.get(key);
      p.setXYZ(i, p.getX(i) + j[0] * w, p.getY(i) + j[1] * h, p.getZ(i) + j[2] * d);
    }
    g.computeVertexNormals();
    stone.add(g, matrix, so(color, div));
    g.dispose();
  }

  /** Pier of stacked block courses (local frame F, centre lx/lz, from y0 up H metres). */
  function pier(F, lx, lz, w, d, y0, H, { courseH = 1.15, broken = 0, color = null, plinth = true } = {}) {
    let y = y0;
    if (plinth) {
      roughBox(F.m(lx, y0 + 0.45, lz), w + 0.7, 0.9, d + 0.7, color ?? sandC(), 0.02);
      y += 0.9;
    }
    const top = y0 + H;
    let k = 0;
    while (y < top - 0.2) {
      let h = Math.min(courseH * rng.range(0.85, 1.12), top - y);
      const last = y + h >= top - 0.2;
      // two blocks per course on wide piers, joints alternating
      const split = w > 2.6 ? (k % 2 ? 0.42 : 0.58) : 1;
      const ww = w + rng.range(-0.08, 0.08);
      const dd = d + rng.range(-0.08, 0.08);
      const tilt = last && broken ? rng.range(-0.08, 0.08) : rng.range(-0.012, 0.012);
      if (last && broken) h *= rng.range(0.5, 0.9);
      if (split < 1) {
        const w0 = ww * split;
        const w1 = ww - w0;
        roughBox(F.m(lx - ww / 2 + w0 / 2, y + h / 2, lz, tilt, 0, 0), w0 - 0.04, h - 0.04, dd, color ?? sandC());
        if (!(last && broken && rng.chance(0.5))) roughBox(F.m(lx + ww / 2 - w1 / 2, y + h / 2, lz, 0, 0, tilt), w1 - 0.04, h - 0.04, dd, color ?? sandC());
      } else roughBox(F.m(lx, y + h / 2, lz, tilt, rng.range(-0.02, 0.02), 0), ww - 0.04, h - 0.04, dd, color ?? sandC());
      y += h;
      k++;
    }
    return y;
  }

  /** Arch of wedge voussoirs (true annular sectors) in the frame's XY plane at depth lz. */
  function archRing(F, ax, ay, lz, rIn, rOut, depth, n, { skip = [], drop = [] } = {}) {
    for (let i = 0; i < n; i++) {
      if (skip.includes(i)) continue;
      const a0 = Math.PI - (i / n) * Math.PI;
      const a1 = Math.PI - ((i + 1) / n) * Math.PI;
      const am = (a0 + a1) / 2;
      const span = (a0 - a1) * 0.985;
      const rMid = (rIn + rOut) / 2;
      const g = new THREE.BoxGeometry(1, rOut - rIn, depth, 3, 1, 1);
      const p = g.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const t = p.getX(v); // −0.5…0.5 along the arc
        const ry = rMid + p.getY(v);
        const ang = am - t * span;
        p.setXYZ(v, Math.cos(ang) * ry, Math.sin(ang) * ry, p.getZ(v));
      }
      g.computeVertexNormals();
      const sag = drop.includes(i) ? rng.range(0.15, 0.4) : 0;
      stone.add(g, F.m(ax, ay - sag, lz, 0, 0, sag * 0.1), so(sandC(), 4));
      g.dispose();
    }
  }

  /** Fluted drum column with base + capital; returns the top y. */
  function column(x, z, h, r, { capital = false, broken = true, lean = 0 } = {}) {
    const gy = ground.min(x, z, r * 1.6) - 0.15;
    const rot = rng.range(0, TAU);
    const F = new Frame(x, gy, z, rot);
    roughBox(F.m(0, 0.35, 0), r * 3, 0.7, r * 3, sandC(), 0.02);
    stone.add(new THREE.TorusGeometry(r * 1.08, r * 0.16, 6, 24).rotateX(Math.PI / 2), F.m(0, 0.82, 0), so(sandC(), 3));
    let y = 0.85;
    const drumH = 1.5;
    while (y < h - 0.1) {
      let dh = Math.min(drumH * rng.range(0.9, 1.1), h - y);
      const last = y + dh >= h - 0.1;
      const g = new THREE.CylinderGeometry(r * 0.94, r, dh - 0.04, 24, 2, false);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i);
        const vz = p.getZ(i);
        const rr = Math.hypot(vx, vz);
        if (rr < 1e-3) continue;
        const a = Math.atan2(vx, vz);
        const flute = 1 - 0.07 * Math.pow(0.5 + 0.5 * Math.cos(a * 12), 2);
        let vy = p.getY(i);
        if (last && broken && vy > 0) vy -= rng.range(0, dh * 0.45);
        p.setXYZ(i, (vx / rr) * rr * flute * rng.range(0.985, 1.015), vy, (vz / rr) * rr * flute * rng.range(0.985, 1.015));
      }
      g.computeVertexNormals();
      stone.add(g, F.m(Math.sin(lean) * y * 0.3, y + dh / 2, 0, lean * 0.3, 0, lean), so(sandC(), 3));
      g.dispose();
      y += dh;
    }
    if (capital) {
      stone.add(new THREE.CylinderGeometry(r * 1.35, r * 0.95, 0.7, 20), F.m(0, h + 0.35, 0), so(sandC(), 3));
      roughBox(F.m(0, h + 1.0, 0), r * 3, 0.65, r * 3, sandC(), 0.025);
    }
    physics?.addBox({ x, y: gy + h / 2, z, w: r * 1.9, h, d: r * 1.9, tag: 'landmarks', walkable: false });
    physics?.addBox({ x, y: gy + 0.35, z, w: r * 3, h: 0.7, d: r * 3, tag: 'landmarks' });
    if (h > 6) {
      for (let k = 0; k < 2; k++) {
        const a = rng.range(0, TAU);
        vines.push({ x: x + Math.sin(a) * r * 1.05, y: gy + h - rng.range(0.2, 1.2), z: z + Math.cos(a) * r * 1.05, len: rng.range(3, Math.min(9, h * 0.6)), rot: a, w: rng.range(1.2, 2) });
      }
      ivy.push({ x: x + rng.range(-0.2, 0.2), y: gy + rng.range(1.2, 3), z: z + rng.range(-0.2, 0.2), rot: rng.range(0, TAU), s: rng.range(2.2, 3.2), wrap: r });
    }
    for (let k = 0; k < 4; k++) ferns.push({ x: x + rng.range(-2.2, 2.2), y: gy + 0.1, z: z + rng.range(-2.2, 2.2), s: rng.range(0.9, 1.6) });
    return gy + h + (capital ? 1.3 : 0);
  }

  /** Free spot for scattered things (off the roads, away from reserved discs). */
  const reserved = [];
  const reserve = (x, z, r) => reserved.push({ x, z, r });
  const free = (x, z, r, road = 6) => {
    if (distToRoads(x, z) < road + r) return false;
    for (const q of reserved) if (Math.hypot(x - q.x, z - q.z) < q.r + r) return false;
    return true;
  };

  // ------------------------------------------------------------ great gate (over the road to the plaza)
  const roadDir = new THREE.Vector2(320 - cx, -10 - cz).normalize();
  const gate = { x: cx + roadDir.x * 25, z: cz + roadDir.y * 25 };
  const gateGy = ground.min(gate.x, gate.z, 10) - 0.2;
  const GF = new Frame(gate.x, gateGy, gate.z, Math.atan2(roadDir.x, roadDir.y)); // local Z along the road
  {
    const half = 6.2; // inner half span
    const PW = 3.8;
    const PD = 4.6;
    const spring = 11;
    for (const side of [-1, 1]) {
      const lx = side * (half + PW / 2);
      pier(GF, lx, 0, PW, PD, 0, spring, { courseH: 1.25 });
      // impost moulding
      roughBox(GF.m(lx, spring + 0.25, 0), PW + 0.6, 0.5, PD + 0.6, sandC(), 0.015);
      GF.box(physics, lx, spring / 2, 0, PW + 0.6, spring, PD + 0.6, 0, { walkable: false });
      // pilaster strips on the faces
      for (const fz of [-1, 1]) roughBox(GF.m(lx, spring / 2 + 0.9, fz * (PD / 2 + 0.12)), PW * 0.5, spring - 1.6, 0.26, sandC(), 0.02);
      for (let k = 0; k < 3; k++) {
        const p = GF.p(lx + side * (PW / 2 + 0.05), spring - rng.range(0, 3), rng.range(-1.6, 1.6));
        vines.push({ x: p.x, y: p.y, z: p.z, len: rng.range(4, 9), rot: GF.rotY + (side > 0 ? -Math.PI / 2 : Math.PI / 2), w: rng.range(1.4, 2.2) });
      }
      ivy.push({ ...GF.p(lx, 2.2, -PD / 2 - 0.35), rot: GF.rotY, s: rng.range(3, 4) });
      reserve(GF.p(lx, 0, 0).x, GF.p(lx, 0, 0).z, 4.5);
    }
    // the arch: wedge voussoirs (one dropped, one missing at the top right)
    const rIn = half;
    const rOut = half + 2.2;
    archRing(GF, 0, spring + 0.5, 0, rIn, rOut, PD - 0.3, 13, { skip: [9], drop: [8, 10] });
    // spandrel fill + attic (left part survives, right part broken off)
    roughBox(GF.m(-half - PW / 2, spring + 0.5 + rOut * 0.5, 0), PW + 2.4, rOut, PD - 0.4, sandC(), 0.03);
    roughBox(GF.m(half + PW / 2 + 0.3, spring + 0.5 + rOut * 0.32, 0), PW + 1.6, rOut * 0.64, PD - 0.4, sandC(), 0.05);
    const attY = spring + 0.5 + rOut;
    roughBox(GF.m(-half * 0.45, attY + 0.6, 0), half * 1.9, 1.2, PD + 0.2, sandC(), 0.02);
    roughBox(GF.m(-half * 0.55, attY + 1.9, 0, 0, 0, 0.03), half * 1.5, 1.4, PD - 0.3, sandC(), 0.04);
    roughBox(GF.m(-half - 1.2, attY + 3.1, 0, 0, 0, -0.04), 3.2, 1.2, PD - 0.6, sandC(), 0.06);
    for (let k = 0; k < 8; k++) {
      const p = GF.p(rng.range(-half - 2, half * 0.4), attY + rng.range(0, 1.5), rng.range(-1.8, 1.8) * (k % 2 ? 1 : -1));
      vines.push({ x: p.x, y: p.y, z: p.z, len: rng.range(4, 10), rot: GF.rotY + (k % 2 ? 0 : Math.PI), w: rng.range(1.4, 2.4) });
    }
    // fallen voussoirs + attic block beside the road
    for (let k = 0; k < 3; k++) {
      const p = GF.p(half + PW + 2 + k * 2.4, 0, rng.range(-4, 4));
      const gy = gAt(p.x, p.z);
      roughBox(mat(p.x, gy + 0.55, p.z, rng.range(-0.3, 0.3), rng.range(0, TAU), rng.range(-0.3, 0.3)), 2.2, 1.3, 2.6, sandC(), 0.08);
      physics?.addBox({ x: p.x, y: gy + 0.55, z: p.z, w: 2.2, h: 1.2, d: 2.4, tag: 'landmarks' });
      ferns.push({ x: p.x + 1.2, y: gy, z: p.z + 0.6, s: 1.3 });
    }
  }

  // ------------------------------------------------------------ relief terrace + wall (north)
  const rp = at(352, 19);
  const relRot = Math.atan2(rp.x - cx, rp.z - cz); // local −Z faces the junction
  const rgy = ground.min(rp.x, rp.z, 10);
  const RF = new Frame(rp.x, rgy, rp.z, relRot);
  const TER_H = 0.9;
  const WALL_W = 15;
  const WALL_H = 12.5;
  const WALL_D = 2.8;
  const wallZ = 3.4;
  {
    // terrace (big slabs) + 3 steps
    for (let i = 0; i < 5; i++) roughBox(RF.m(-9.2 + i * 4.6, (TER_H - 1) / 2, 1.2), 4.55, TER_H + 1, 9.4, sandC(), 0.012);
    for (let s = 0; s < 3; s++) {
      const h = TER_H * (3 - s) / 3;
      roughBox(RF.m(0, h / 2, -4.5 - s * 0.9), 9 - s * 0.6, h, 0.9, sandC(), 0.015);
      RF.box(physics, 0, h / 2, -4.5 - s * 0.9, 9 - s * 0.6, h, 0.9);
    }
    RF.box(physics, 0, TER_H / 2, 1.2, 23, TER_H, 9.4);
    // wall: courses of big blocks, irregular broken crown
    const rows = 8;
    const rowH = WALL_H / rows;
    for (let row = 0; row < rows; row++) {
      const y = TER_H + row * rowH;
      let x = -WALL_W / 2 + (row % 2 ? 0.8 : 0);
      if (row % 2) roughBox(RF.m(-WALL_W / 2 + 0.4, y + rowH / 2, wallZ), 0.76, rowH - 0.04, WALL_D, sandC(), 0.02);
      while (x < WALL_W / 2 - 0.2) {
        const w = Math.min(rng.range(1.9, 3.3), WALL_W / 2 - x);
        const topRows = row >= rows - 2;
        const gone = topRows && rng.chance(row === rows - 1 ? 0.5 : 0.18) && Math.abs(x + w / 2) > 3.8;
        if (!gone) roughBox(RF.m(x + w / 2, y + rowH / 2, wallZ + rng.range(-0.08, 0.08)), w - 0.05, rowH - 0.04, WALL_D + rng.range(-0.15, 0.15), sandC(), 0.025);
        x += w;
      }
    }
    // cornice over the relief panel
    roughBox(RF.m(0, TER_H + WALL_H - rowH * 1.5, wallZ - WALL_D / 2 - 0.15), 9.4, 0.55, 0.6, sandC(), 0.02);
    RF.box(physics, 0, TER_H + WALL_H / 2, wallZ, WALL_W, WALL_H, WALL_D, 0, { walkable: false });
    // stepped pylons flanking the wall
    for (const side of [-1, 1]) {
      const lx = side * (WALL_W / 2 + 1.9);
      let y = TER_H;
      for (let t = 0; t < 4; t++) {
        const h = [5.5, 4.5, 3.5, 2.6][t] * (side > 0 ? 1 : 0.9);
        const s = 3.6 - t * 0.55;
        if (side > 0 && t === 3) break; // the east pylon lost its top
        y = pier(RF, lx, wallZ, s, s + 0.4, y, h, { courseH: 1.1, plinth: t === 0, broken: t === 3 || (side > 0 && t === 2) ? 1 : 0 });
        roughBox(RF.m(lx, y + 0.18, wallZ), s + 0.3, 0.36, s + 0.7, sandC(), 0.015);
        y += 0.36;
      }
      RF.box(physics, lx, (TER_H + y) / 2, wallZ, 3.6, y - TER_H, 4, 0, { walkable: false });
      for (let k = 0; k < 3; k++) {
        const p = RF.p(lx + rng.range(-1.4, 1.4), y - rng.range(0, 2), wallZ - 2.1);
        vines.push({ x: p.x, y: p.y, z: p.z, len: rng.range(4, 9), rot: relRot + Math.PI, w: rng.range(1.4, 2.2) });
      }
    }
    // vines + ivy on the wall face
    for (let k = 0; k < 12; k++) {
      const lx = rng.range(-WALL_W / 2 + 0.5, WALL_W / 2 - 0.5);
      if (Math.abs(lx) < 3.6 && rng.chance(0.7)) continue; // keep the relief readable
      const p = RF.p(lx, TER_H + WALL_H - rng.range(0.4, 2.5), wallZ - WALL_D / 2 - 0.08);
      vines.push({ x: p.x, y: p.y, z: p.z, len: rng.range(3, 9), rot: relRot + Math.PI, w: rng.range(1.3, 2.3) });
    }
    for (const [lx, ly] of [[-6, 2.5], [-4.8, 6], [5.4, 3], [6.2, 7.5], [-6.6, 9.5], [4.4, 10.4], [-2.2, 11.2], [6.8, 1.2]]) {
      const p = RF.p(lx, TER_H + ly + rng.range(-0.6, 0.6), wallZ - WALL_D / 2 - 0.06);
      ivy.push({ x: p.x, y: p.y, z: p.z, rot: relRot + Math.PI, s: rng.range(3, 4.6) });
    }
    // ivy cascading over the back of the wall too
    for (let k = 0; k < 4; k++) {
      const p = RF.p(rng.range(-6, 6), TER_H + rng.range(4, 10), wallZ + WALL_D / 2 + 0.06);
      ivy.push({ x: p.x, y: p.y, z: p.z, rot: relRot, s: rng.range(3.4, 4.8) });
    }
    for (let k = 0; k < 10; k++) {
      const p = RF.p(rng.range(-8, 8), 0, rng.range(-6, 6.8));
      if (Math.abs(p.x - rp.x) < 4.5 && rng.chance(0.6)) continue;
      ferns.push({ x: p.x, y: rgy + TER_H, z: p.z, s: rng.range(0.9, 1.5) });
    }
    reserve(rp.x, rp.z, 12);
  }
  // carved Ø relief (raised ring + slash) on the wall face
  const faceZ = wallZ - WALL_D / 2;
  const reliefY = TER_H + 5.8;
  const RR = 3.1;
  carve.add(new THREE.TorusGeometry(RR, 0.34, 8, 64), RF.m(0, reliefY, faceZ - 0.05), so(0xd8ccb8, 1.5));
  carve.box(0.58, RR * 2.9, 0.44, RF.m(0, reliefY, faceZ - 0.08, 0, 0, -Math.PI / 4), so(0xd8ccb8, 1.5));
  carve.add(new THREE.TorusGeometry(RR + 1.0, 0.13, 6, 64), RF.m(0, reliefY, faceZ - 0.04), so(0xcabda8, 1.5));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    carve.add(new THREE.CircleGeometry(0.16, 10), RF.m(Math.cos(a) * (RR + 1.6), reliefY + Math.sin(a) * (RR + 1.6), faceZ - 0.035, 0, Math.PI, 0), so(0xb8aa94, 1.5));
  }
  for (let i = 0; i < 11; i++) carve.box(0.5, 0.72, 0.12, RF.m(-5 + i, TER_H + 1.5, faceZ - 0.05, 0, 0, rng.range(-0.3, 0.3)), so(0xc4b8a2, 1.2));
  // glow decal (additive). While scanning (uScan 0…1) the engraving lights up
  // along its lines — the ring clockwise from the top, the slash from the
  // lower left — behind a bright scan front; when the scan completes (uDone)
  // the whole Ø glows with a slow flowing pulse. Gains stay moderate so the
  // lines read as crisp cyan instead of blooming to white.
  const scanU = { value: 0 };
  const doneU = { value: 0 };
  const reliefMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: makeReliefTexture() }, uScan: scanU, uDone: doneU, uTime: mats.U.uTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uScan; uniform float uDone; uniform float uTime; varying vec2 vUv;
      void main() {
        vec4 t = texture2D(map, vUv);
        vec2 d = vUv - 0.5;
        float r = length(d);
        float ang = atan(d.y, d.x);
        // reveal parameter along the engraving (ring + dotted ring: angle, slash: position)
        float onRing = max(1.0 - smoothstep(0.035, 0.06, abs(r - 0.31)), 1.0 - smoothstep(0.018, 0.03, abs(r - 0.37)));
        float pRing = fract(0.25 - ang / 6.2831853);
        float pSlash = clamp(dot(d, vec2(0.70710678)) / 0.45 * 0.5 + 0.5, 0.0, 1.0);
        float param = mix(pSlash, pRing, onRing);
        float prog = uScan * 1.04;
        float lit = max(smoothstep(param - 0.03, param, prog), uDone);
        float front = (1.0 - smoothstep(0.0, 0.045, abs(prog - param))) * step(0.002, uScan) * (1.0 - uDone);
        float flow = mix(1.0, 0.72 + 0.28 * sin(ang * 3.0 - uTime * 2.2 + r * 20.0), uDone);
        float line = t.r * (0.05 + lit * mix(1.05, 1.75, uDone) * flow + front * 1.1);
        float halo = t.g * (lit * mix(0.22, 0.5, uDone) * flow + front * 0.35);
        vec3 c = vec3(0.22, 0.82, 1.0) * line + vec3(0.3, 0.75, 1.0) * halo;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  });
  mats.list.push(reliefMat);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), reliefMat);
  decal.position.copy(RF.p(0, reliefY, faceZ - 0.5));
  decal.rotation.y = RF.heading(Math.PI);
  decal.name = 'ruins-relief-glow';
  group.add(decal);

  // ------------------------------------------------------------ aqueduct arcade (north-west)
  const aqA = at(286, 32);
  const aqB = at(334, 33);
  const aqLen = Math.hypot(aqB.x - aqA.x, aqB.z - aqA.z);
  const aqMid = { x: (aqA.x + aqB.x) / 2, z: (aqA.z + aqB.z) / 2 };
  const AQ = new Frame(aqMid.x, ground.min(aqMid.x, aqMid.z, 16) - 0.3, aqMid.z, Math.atan2(aqB.x - aqA.x, aqB.z - aqA.z) - Math.PI / 2); // local X along the arcade
  {
    const N = 4;
    const PW = 2.6;
    const open = (aqLen - PW) / N - PW;
    const D = 3.2;
    const spring1 = 7.5;
    const r1 = open / 2;
    const tier1Top = spring1 + 0.5 + r1 + 1.6;
    const x0 = -((N * (open + PW)) / 2);
    const pierX = [];
    for (let i = 0; i <= N; i++) pierX.push(x0 + i * (open + PW));
    pierX.forEach((px, i) => {
      const collapsed = i === N; // the east end pier stands alone, broken
      pier(AQ, px, 0, PW, D, 0, collapsed ? 6.2 : spring1, { courseH: 1.1, broken: collapsed ? 1 : 0 });
      if (!collapsed) roughBox(AQ.m(px, spring1 + 0.25, 0), PW + 0.4, 0.5, D + 0.4, sandC(), 0.015);
      AQ.box(physics, px, (collapsed ? 6.2 : spring1) / 2, 0, PW + 0.4, collapsed ? 6.2 : spring1, D + 0.4, 0, { walkable: false });
      reserve(AQ.p(px, 0, 0).x, AQ.p(px, 0, 0).z, 3);
    });
    for (let i = 0; i < N - 1; i++) {
      const ax = (pierX[i] + pierX[i + 1]) / 2;
      archRing(AQ, ax, spring1 + 0.5, 0, r1, r1 + 1.25, D - 0.2, 7, { drop: i === 2 ? [5] : [] });
      // spandrels between arches
      roughBox(AQ.m(pierX[i + 1], spring1 + 0.5 + (r1 + 1.25) * 0.55, 0), PW + 1.2, (r1 + 1.25) * 1.1, D - 0.3, sandC(), 0.03);
    }
    roughBox(AQ.m(pierX[0], spring1 + 0.5 + (r1 + 1.25) * 0.55, 0), PW + 1.2, (r1 + 1.25) * 1.1, D - 0.3, sandC(), 0.03);
    // string course + upper tier over the first three bays
    const sx0 = pierX[0] - PW / 2;
    const sx1 = pierX[N - 1] + PW / 2;
    roughBox(AQ.m((sx0 + sx1) / 2, tier1Top - 0.4, 0), sx1 - sx0, 0.8, D + 0.3, sandC(), 0.012);
    AQ.box(physics, (sx0 + sx1) / 2, tier1Top / 2, 0, sx1 - sx0, tier1Top, D, 0, { walkable: false });
    const up = [];
    const upOpen = (open + PW) / 2 - 1.5;
    for (let i = 0; i <= 5; i++) up.push(sx0 + 0.75 + i * (upOpen + 1.5));
    up.forEach((px, i) => {
      if (px > sx1 - 0.6) return;
      const h = i === 5 ? 2.2 : i === 4 ? 3.4 : 4.4;
      pier(AQ, px, 0, 1.5, D - 0.6, tier1Top, h, { courseH: 0.9, plinth: false, broken: i >= 4 ? 1 : 0 });
      if (i < 3) archRing(AQ, px + (upOpen + 1.5) / 2, tier1Top + 4.4, 0, upOpen / 2, upOpen / 2 + 0.8, D - 0.8, 5, { drop: i === 2 ? [4] : [] });
    });
    roughBox(AQ.m(sx0 + 3.2 * (upOpen + 1.5) / 2 + 0.7, tier1Top + 4.4 + upOpen / 2 + 1.1, 0), 3 * (upOpen + 1.5) - 0.4, 0.7, D - 0.5, sandC(), 0.03);
    for (let k = 0; k < 16; k++) {
      const p = AQ.p(rng.range(sx0, sx1), tier1Top - rng.range(0, 1.2) + (k < 6 ? 4.6 : 0), (k % 2 ? 1 : -1) * (D / 2 + 0.05));
      vines.push({ x: p.x, y: p.y, z: p.z, len: rng.range(3, 9), rot: AQ.rotY + (k % 2 ? 0 : Math.PI), w: rng.range(1.3, 2.4) });
    }
    for (let k = 0; k < 4; k++) ivy.push({ ...AQ.p(pierX[k] + rng.range(-0.6, 0.6), rng.range(1.8, 4), -D / 2 - 0.08), rot: AQ.rotY + Math.PI, s: rng.range(2.6, 3.6) });
    for (let k = 0; k < 14; k++) {
      const p = AQ.p(rng.range(x0 - 2, -x0 + 2), 0, rng.range(-4, 4));
      ferns.push({ x: p.x, y: gAt(p.x, p.z), z: p.z, s: rng.range(1, 1.7) });
    }
    // rubble from the collapsed east end
    for (let k = 0; k < 5; k++) {
      const p = AQ.p(pierX[N] + rng.range(-3, 3), 0, rng.range(-3.5, 3.5));
      const gy = gAt(p.x, p.z);
      const s = rng.range(0.9, 1.6);
      roughBox(mat(p.x, gy + s * 0.35, p.z, rng.range(-0.4, 0.4), rng.range(0, TAU), rng.range(-0.4, 0.4)), s * 1.4, s, s * 1.1, sandC(), 0.1);
      physics?.addBox({ x: p.x, y: gy + s * 0.35, z: p.z, w: s * 1.3, h: s * 0.8, d: s, tag: 'landmarks' });
    }
  }

  // ------------------------------------------------------------ colonnade (east)
  const colTops = [];
  {
    const a = at(64, 23.5);
    const b = at(100, 24);
    const H = [16.5, 18, 7.5, 12.5, 4.2];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (!free(x, z, 1.5, 5.2)) continue;
      const top = column(x, z, H[i], 1.1, { capital: H[i] > 12, broken: H[i] < 17, lean: i === 3 ? 0.04 : 0 });
      colTops.push({ x, z, top, h: H[i] });
      reserve(x, z, 2.6);
    }
    // architrave across the two tall neighbours + its fallen partner
    const [c0, c1] = colTops;
    if (c0 && c1 && c0.h > 12 && c1.h > 12) {
      const y = Math.min(c0.top, c1.top) + 0.65;
      const len = Math.hypot(c1.x - c0.x, c1.z - c0.z) + 3;
      const rot = Math.atan2(c1.x - c0.x, c1.z - c0.z) + Math.PI / 2;
      roughBox(mat((c0.x + c1.x) / 2, y, (c0.z + c1.z) / 2, 0, rot, 0.03), len, 1.3, 2.4, sandC(), 0.02);
      roughBox(mat((c0.x + c1.x) / 2, y + 1.15, (c0.z + c1.z) / 2, 0, rot, 0.03), len * 0.8, 0.9, 2.2, sandC(), 0.04);
      for (let k = 0; k < 5; k++) vines.push({ x: (c0.x + c1.x) / 2 + rng.range(-2, 2), y: y - 0.6, z: (c0.z + c1.z) / 2 + rng.range(-1, 1), len: rng.range(3, 8), rot: rot + (k % 2 ? 0 : Math.PI), w: rng.range(1.2, 2) });
    }
    if (colTops[2]) {
      const c = colTops[2];
      const p = { x: c.x + 3.5, z: c.z + 2 };
      const gy = gAt(p.x, p.z);
      const rot = rng.range(0, TAU);
      for (let k = 0; k < 3; k++) {
        const g = new THREE.CylinderGeometry(1.05, 1.05, 1.45, 20);
        stone.add(g, mat(p.x + Math.sin(rot) * k * 1.55, gy + 0.9, p.z + Math.cos(rot) * k * 1.55, Math.PI / 2, rot, rng.range(-0.1, 0.1)), so(sandC(), 3));
        g.dispose();
      }
      physics?.addBox({ x: p.x + Math.sin(rot) * 1.55, y: gy + 0.9, z: p.z + Math.cos(rot) * 1.55, w: 2.1, h: 1.9, d: 4.8, rotY: rot, tag: 'landmarks' });
    }
  }

  // ------------------------------------------------------------ broken watch tower (south)
  {
    const tp = at(188, 27);
    const tgy = ground.min(tp.x, tp.z, 6) - 0.2;
    const TF = new Frame(tp.x, tgy, tp.z, Math.atan2(cx - tp.x, cz - tp.z) + Math.PI); // −Z faces the junction
    const S = 7.4;
    const T = 1.2;
    const H = [17.5, 14, 16.2, 11.5]; // per face (front, right, back, left)
    roughBox(TF.m(0, 0.5, 0), S + 1.4, 1.0, S + 1.4, sandC(), 0.015);
    for (let f = 0; f < 4; f++) {
      const rot = (f * Math.PI) / 2;
      const FF = new Frame(TF.p(Math.sin(rot) * (-(S - T) / 2), 0, Math.cos(rot) * (-(S - T) / 2)).x, tgy + 1, TF.p(Math.sin(rot) * (-(S - T) / 2), 0, Math.cos(rot) * (-(S - T) / 2)).z, TF.rotY + rot);
      const h = H[f] - 1;
      // wall face with an arched opening at 2.5–6 m (door on the front, windows elsewhere)
      const ow = f === 0 ? 2.6 : 1.6;
      const oy0 = f === 0 ? 0 : 5.2;
      const oy1 = f === 0 ? 4.2 : 7.6;
      const side = (S - ow) / 2;
      for (const sx of [-1, 1]) pier(FF, sx * (ow / 2 + side / 2), 0, side, T, 0, h, { courseH: 1.05, plinth: false, broken: 1 });
      if (oy0 > 0) pier(FF, 0, 0, ow + 0.1, T, 0, oy0, { courseH: 1.05, plinth: false });
      archRing(FF, 0, oy1, 0, ow / 2, ow / 2 + 0.7, T, 5);
      pier(FF, 0, 0, ow + 0.1, T, oy1 + ow / 2 + 0.7, Math.max(0.5, h - (oy1 + ow / 2 + 0.7) - (f === 1 ? 1.5 : 0)), { courseH: 1.05, plinth: false, broken: 1 });
      if (f === 0) {
        for (const sx of [-1, 1]) FF.box(physics, sx * (ow / 2 + side / 2), h / 2, 0, side, h, T, 0, { walkable: false });
        FF.box(physics, 0, (oy1 + h) / 2, 0, ow + 0.2, h - oy1, T, 0, { walkable: false });
      } else FF.box(physics, 0, h / 2, 0, S, h, T, 0, { walkable: false });
      for (let k = 0; k < 3; k++) {
        const p = FF.p(rng.range(-S / 2 + 0.6, S / 2 - 0.6), h - rng.range(0.4, 2.5), -T / 2 - 0.05);
        vines.push({ x: p.x, y: p.y, z: p.z, len: rng.range(3, 8), rot: FF.rotY + Math.PI, w: rng.range(1.2, 2) });
      }
    }
    TF.box(physics, 0, 0.5, 0, S + 1.4, 1.0, S + 1.4);
    reserve(tp.x, tp.z, 7);
    for (let k = 0; k < 8; k++) ferns.push({ x: tp.x + rng.range(-6, 6), y: tgy + 0.4, z: tp.z + rng.range(-6, 6), s: rng.range(1, 1.7) });
    ivy.push({ ...TF.p(-S / 2 - 0.06, 3, 0.8), rot: TF.rotY - Math.PI / 2, s: 4 });
  }

  // ------------------------------------------------------------ foundation walls + rubble
  for (const [b, r, len, rot0] of [[140, 15, 9, 0.3], [205, 16, 7, -0.4], [76, 32, 8, 0.2], [235, 30, 6, 0.8], [168, 34, 10, 0.5]]) {
    const p = at(b, r);
    if (!free(p.x, p.z, len * 0.4, 5)) continue;
    const gy = gAt(p.x, p.z);
    const rot = (b * Math.PI) / 180 + rot0;
    const WF = new Frame(p.x, gy - 0.2, p.z, rot);
    let x = -len / 2;
    while (x < len / 2 - 0.3) {
      const w = Math.min(rng.range(1.3, 2.4), len / 2 - x);
      const h = rng.range(0.5, 1.8);
      roughBox(WF.m(x + w / 2, h / 2, 0, 0, rng.range(-0.05, 0.05), 0), w - 0.05, h, 1.1, sandC(), 0.05);
      x += w;
    }
    WF.box(physics, 0, 0.6, 0, len, 1.2, 1.1);
    const corner = WF.p(len / 2 - 0.5, 0, 0);
    const WF2 = new Frame(corner.x, gy - 0.2, corner.z, rot + Math.PI / 2);
    for (let i = 0; i < 3; i++) roughBox(WF2.m(i * 1.6 + 0.8, rng.range(0.3, 0.6), 0), 1.5, rng.range(0.6, 1.2), 1.1, sandC(), 0.05);
    for (let k = 0; k < 3; k++) ferns.push({ x: p.x + rng.range(-3, 3), y: gy, z: p.z + rng.range(-3, 3), s: rng.range(0.8, 1.4) });
  }
  for (let i = 0; i < 26; i++) {
    const p = at(rng.range(0, 360), rng.range(9, 40));
    const w = rng.range(0.9, 2.8);
    if (!free(p.x, p.z, w * 0.6, 5.5)) continue;
    const gy = gAt(p.x, p.z);
    const h = rng.range(0.6, 1.8);
    const d = rng.range(0.9, 2.4);
    const rot = rng.range(0, TAU);
    roughBox(mat(p.x, gy + h * 0.36, p.z, rng.range(-0.25, 0.25), rot, rng.range(-0.2, 0.2)), w, h, d, sandC(), 0.09);
    if (w > 1.2) physics?.addBox({ x: p.x, y: gy + h * 0.33, z: p.z, w: w * 0.9, h: h * 0.75, d: d * 0.9, rotY: rot, tag: 'landmarks' });
    if (rng.chance(0.6)) ferns.push({ x: p.x + rng.range(-1.2, 1.2), y: gy, z: p.z + rng.range(-1.2, 1.2), s: rng.range(0.8, 1.3) });
  }

  // ------------------------------------------------------------ rune stones
  const runeStones = [];
  for (const [b, r] of [[80, 15], [165, 17], [215, 16], [300, 20]]) {
    const p = at(b, r);
    if (distToRoads(p.x, p.z) < 6) continue;
    const gy = gAt(p.x, p.z) - 0.4;
    const h = rng.range(2.9, 3.8);
    const g = new THREE.CylinderGeometry(0.42, 0.72, h, 6, 1);
    const rot = Math.atan2(p.x - cx, p.z - cz);
    const tilt = rng.range(-0.08, 0.08);
    stone.add(g, mat(p.x, gy + h / 2, p.z, tilt, rot, 0, 1, 1, 0.55), { flat: true, ...so(0xcfc4b2, 2) });
    g.dispose();
    const F = new Frame(p.x, gy, p.z, rot);
    for (let k = 0; k < 4; k++) {
      runes.box(0.26, 0.3, 0.05, F.m(0, 0.9 + k * 0.5, -0.36 + k * 0.02, tilt, 0, rng.range(-0.4, 0.4)), { color: hdr(0x6fdcff, 2.2), glow: [-0.25, b * 0.01 + k * 0.2, 0.12] });
    }
    physics?.addBox({ x: p.x, y: gy + h / 2, z: p.z, w: 1.2, h, d: 0.9, rotY: rot, tag: 'landmarks', walkable: false });
    // stand-on spot 1.8 m in front of the rune face (towards the junction) + the rune column centre
    runeStones.push({ stand: new THREE.Vector3(p.x - Math.sin(rot) * 1.8, gy + 0.4, p.z - Math.cos(rot) * 1.8), center: F.p(0, 0.9 + 0.75, -0.36) });
    for (let k = 0; k < 3; k++) flowers.push([p.x + rng.range(-1.2, 1.2), gy + 0.45, p.z + rng.range(-1.2, 1.2), rng.range(0.1, 0.18)]);
  }

  // ------------------------------------------------------------ flagstone path junction → terrace
  {
    const a = new THREE.Vector2(cx + roadDir.x * 4, cz + roadDir.y * 4);
    const bp = RF.p(0, 0, -7.4);
    const b = new THREE.Vector2(bp.x, bp.z);
    const len = a.distanceTo(b);
    const n = Math.round(len / 1.0);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      for (let k = 0; k < 3; k++) {
        const x = THREE.MathUtils.lerp(a.x, b.x, t) + rng.range(-1.6, 1.6);
        const z = THREE.MathUtils.lerp(a.y, b.y, t) + rng.range(-1.6, 1.6);
        const s = rng.range(0.7, 1.3);
        roughBox(mat(x, gAt(x, z) + 0.04, z, 0, rng.range(0, TAU), 0), s, 0.18, s * rng.range(0.7, 1.1), rng.pick([0xcfc4b2, 0xc2b6a2, 0xd8cdbb]), 0.06, 2);
      }
    }
  }

  // ------------------------------------------------------------ violet flowers in the undergrowth
  for (let i = 0; i < 46; i++) {
    const f = ferns[Math.floor(rng.random() * ferns.length)];
    if (!f) break;
    for (let k = 0; k < 6; k++) flowers.push([f.x + rng.range(-0.9, 0.9), f.y + rng.range(0.15, 0.5), f.z + rng.range(-0.9, 0.9), rng.range(0.07, 0.14)]);
  }

  // ------------------------------------------------------------ instanced vegetation
  group.add(buildCards(mats.foliageCard(vineTexture(), { anchor: 'top', amp: 0.18 }), vines, 'ruins-vines', (v, m4, q, s, p) => {
    q.setFromAxisAngle(_Y, v.rot + rng.range(-0.25, 0.25));
    m4.compose(p.set(v.x, v.y, v.z), q, s.set(v.w ?? 1.6, v.len, 1));
  }, new THREE.PlaneGeometry(1, 1, 1, 4).translate(0, -0.5, 0)));
  group.add(buildCards(mats.foliageCard(ivyTexture(), { anchor: 'none' }), ivy, 'ruins-ivy', (v, m4, q, s, p) => {
    q.setFromAxisAngle(_Y, v.rot);
    m4.compose(p.set(v.x, v.y, v.z), q, s.set(v.s, v.s * 1.25, 1));
  }, new THREE.PlaneGeometry(1, 1)));
  group.add(buildCards(mats.foliageCard(fernTexture(), { anchor: 'bottom', amp: 0.1 }), ferns.flatMap((f) => [f, { ...f, cross: true }]), 'ruins-ferns', (v, m4, q, s, p) => {
    q.setFromAxisAngle(_Y, (v.cross ? Math.PI / 2 : 0) + ((v.x * 13.1 + v.z * 7.7) % TAU));
    m4.compose(p.set(v.x, v.y - 0.05, v.z), q, s.set(v.s * 1.8, v.s * 1.4, 1));
  }, new THREE.PlaneGeometry(1, 1, 1, 2).translate(0, 0.5, 0)));
  group.add(buildFlowerBeds(mats, flowers, { name: 'ruins-flowers', seed: 'ruins-flowers', leafEvery: 3 }));

  // ------------------------------------------------------------ dust motes + god rays
  group.add(makeDust(mats, cx, gAt(cx, cz), cz, rng));
  const raySpots = [GF.p(0, 16, 0), AQ.p(-4, 14, 0), AQ.p(5, 12, 0), ...colTops.slice(0, 2).map((c) => new THREE.Vector3(c.x, c.top, c.z))];
  group.add(makeRays(mats, raySpots, rng));

  // ------------------------------------------------------------ meshes
  const ruinStone = mats.ruinStone || (mats.ruinStone = mats.stoneWith(weatheredTexture(), 1));
  group.add(stone.mesh(ruinStone, { name: 'ruins-stone', castShadow: true, receiveShadow: true }));
  group.add(carve.mesh(ruinStone, { name: 'ruins-relief', castShadow: true, receiveShadow: true }));
  group.add(runes.mesh(mats.glow, { name: 'ruins-runes' }));

  // scan state
  let scanTarget = 0;
  let doneTarget = 0;
  const scanPoint = RF.p(0, TER_H, -3.0);
  return {
    group,
    // forest trees / boulders would cut through the walls: clear the main structures
    clearDiscs: [
      { x: gate.x, z: gate.z, r: 10 },
      { x: rp.x, z: rp.z, r: 13 },
      { x: aqA.x, z: aqA.z, r: 8 },
      { x: aqMid.x, z: aqMid.z, r: 10 },
      { x: aqB.x, z: aqB.z, r: 8 },
      ...colTops.map((c) => ({ x: c.x, z: c.z, r: 4 })),
      { ...at(188, 27), r: 8 },
    ],
    center: new THREE.Vector3(cx, gAt(cx, cz), cz),
    relief: RF.p(0, reliefY, faceZ),
    reliefNormal: new THREE.Vector3(-Math.sin(relRot), 0, -Math.cos(relRot)),
    gate: GF.p(0, 0, 0),
    scanPoints: [scanPoint, ...runeStones.map((r) => r.stand)],
    /** [{stand, center}] per rune stone (same order as scanPoints[1…]) */
    runeStones,
    get scanned() {
      return doneTarget >= 1;
    },
    /** true: the whole relief glows cyan (scan complete) · false: back to plain stone */
    setScanned(on) {
      doneTarget = on ? 1 : 0;
      scanTarget = on ? 1 : 0;
    },
    /** 0…1 while the player holds E: the engraving lights up along its lines */
    setScanProgress(p) {
      scanTarget = THREE.MathUtils.clamp(p, 0, 1);
      if (scanTarget < 1) doneTarget = 0;
    },
    update(dt) {
      scanU.value += (scanTarget - scanU.value) * Math.min(1, dt * 4);
      doneU.value += (doneTarget - doneU.value) * Math.min(1, dt * 2);
    },
  };
}

const _Y = new THREE.Vector3(0, 1, 0);

/** Instanced alpha cards from a list (place(v, m4, q, s, p) sets the matrix). */
function buildCards(material, list, name, place, geo) {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
  mesh.name = name;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  list.forEach((v, i) => {
    place(v, m4, q, s, p);
    mesh.setMatrixAt(i, m4);
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: material.map, alphaTest: 0.42, side: THREE.DoubleSide });
  mesh.computeBoundingSphere();
  return mesh;
}

/** Emblem relief glow texture: R = ring/slash core, G = soft halo. */
function makeReliefTexture() {
  return canvasTexture(
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      g.filter = 'blur(10px)';
      drawEmblem(g, w / 2, h / 2, w * 0.31, w * 0.07, 'rgb(0,255,0)');
      g.filter = 'none';
      drawEmblem(g, w / 2, h / 2, w * 0.31, w * 0.022, 'rgb(255,0,0)');
      // dotted inner ring like the concept
      g.strokeStyle = 'rgb(255,0,0)';
      g.setLineDash([6, 10]);
      g.lineWidth = 3;
      g.beginPath();
      g.arc(w / 2, h / 2, w * 0.37, 0, Math.PI * 2);
      g.stroke();
    },
    { srgb: false },
  );
}

function makeDust(mats, x, y, z, rng) {
  const N = 300;
  const pos = new Float32Array(N * 3);
  const dat = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = x + rng.range(-36, 36);
    pos[i * 3 + 1] = y + rng.range(0.5, 16);
    pos[i * 3 + 2] = z + rng.range(-36, 36);
    dat[i * 2] = rng.range(0, 100);
    dat[i * 2 + 1] = rng.range(0.5, 1.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aData', new THREE.BufferAttribute(dat, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y + 8, z), 52);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: mats.U.uTime, uNight: mats.U.uNight, map: { value: radialTexture() } },
    vertexShader: /* glsl */ `
      attribute vec2 aData; uniform float uTime; uniform float uNight; varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * 0.15 + aData.x;
        p += vec3(sin(t * 1.3) * 1.5, sin(t * 0.7) * 0.8, cos(t * 1.1) * 1.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = (0.4 + 0.6 * sin(uTime * 0.8 + aData.x)) * (1.0 - uNight * 0.7);
        gl_PointSize = clamp(aData.y * 90.0 / -mv.z, 1.0, 5.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; varying float vA;
      void main() {
        float a = texture2D(map, gl_PointCoord).r * vA * 0.55;
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * a, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  mats.list.push(m);
  const p = new THREE.Points(g, m);
  p.name = 'ruins-dust';
  return p;
}

/** Soft light shafts slanting down from the tall structures (fade at night). */
function makeRays(mats, spots, rng) {
  const g = new GeoBuilder({ uv: true });
  for (const s of spots) {
    for (let k = 0; k < 2; k++) {
      const plane = new THREE.PlaneGeometry(rng.range(2.5, 4), 24).translate(0, -12, 0);
      g.add(plane, mat(s.x + rng.range(-3, 3), s.y + 4, s.z + rng.range(-3, 3), 0.42, rng.range(0, TAU), 0.32), {});
      plane.dispose();
    }
  }
  const m = new THREE.ShaderMaterial({
    uniforms: { uNight: mats.U.uNight, uTime: mats.U.uTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uNight; uniform float uTime; varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        float len = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        float a = edge * len * 0.075 * (1.0 - uNight) * (0.8 + 0.2 * sin(uTime * 0.5 + vUv.y * 3.0));
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * a, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mats.list.push(m);
  return g.mesh(m, { name: 'ruins-godrays' });
}
