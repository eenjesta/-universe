/**
 * Landmarks — the player's base in the forest clearing: a modern two-storey
 * glass villa (dark frames, floor-to-ceiling glass, warm-lit interior with
 * furniture silhouettes, cantilevered upper floor, interior stair, wooden deck
 * with steps), a fire pit with lounge chairs, a small workshop wing with
 * solar panels, crates, an Ø banner and the starter VTOL landing pad.
 * Front of the house = local −Z (faces +X in the world, towards the build plot).
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { Rng } from '../core/math.js';
import { GeoBuilder, Frame, addBeam, mat, TAU, hdr } from './common.js';
import { padTexture, radialTexture } from './textures.js';
import { buildPools } from './plaza.js';

const GF = { x0: -8, x1: 8, z0: -4.5, z1: 4.5, y: 0.6, h: 3.3 };
const UF = { x0: -6, x1: 10, z0: -6, z1: 4, y: 4.2, h: 3.1 };
const FRAME = 0x1c1f24;

export function buildHouse(env) {
  const { mats, physics, ground } = env;
  const B = ZONES.base;
  const H = B.house;
  const rng = new Rng('glazen-huis');
  const group = new THREE.Group();
  group.name = 'landmarks-house';
  const gy = ground.max(H.x, H.z, 9);
  const F = new Frame(H.x, gy, H.z, H.rotY);
  const dark = new GeoBuilder({ uv: false });
  const wood = new GeoBuilder({ uv: true });
  const concrete = new GeoBuilder({ uv: true });
  const glass = new GeoBuilder({ uv: false });
  const glow = new GeoBuilder({ glow: true, uv: false });
  const furn = new GeoBuilder({ uv: false });
  const pools = [];
  const wo = (c = 0xffffff) => ({ color: c, uvMode: 'box', uvDiv: 2.4 });
  const co = (c = 0xa8a49c) => ({ color: c, uvMode: 'box', uvDiv: 3 });
  const INTERIOR = hdr(0xffc888, 0.8);
  /** Warm-lit interior back wall: panels of varying warmth, darker skirting band. */
  const litWall = (x0, x1, y0, h, z) => {
    const n = Math.max(3, Math.round((x1 - x0) / 2.6));
    for (let i = 0; i < n; i++) {
      const w = (x1 - x0) / n;
      const lx = x0 + w * (i + 0.5);
      const k = rng.range(0.55, 1.0);
      const tint = rng.pick([0xffc888, 0xffd0a0, 0xffb878, 0xffe0bc]);
      glow.box(w - 0.02, h - 0.95, 0.02, F.m(lx, y0 + 0.8 + (h - 0.95) / 2, z), { color: hdr(tint, 0.8 * k), glow: [0, 0, 0.55 * k] });
      glow.box(w - 0.02, 0.62, 0.02, F.m(lx, y0 + 0.47, z), { color: hdr(tint, 0.32 * k), glow: [0, 0, 0.25 * k] });
    }
  };
  const LAMP = hdr(0xffd6a0, 2.6);

  // ---------------------------------------------------------- plinth + ground floor slab
  concrete.box(GF.x1 - GF.x0 + 0.6, GF.y + 3, GF.z1 - GF.z0 + 0.6, F.m((GF.x0 + GF.x1) / 2, GF.y - (GF.y + 3) / 2, 0), co(0x8e8a84));
  F.box(physics, (GF.x0 + GF.x1) / 2, GF.y / 2 - 0.5, 0, GF.x1 - GF.x0, GF.y + 1, GF.z1 - GF.z0);
  // interior floor (warm wood)
  wood.box(GF.x1 - GF.x0 - 0.2, 0.04, GF.z1 - GF.z0 - 0.2, F.m(0, GF.y + 0.02, 0), wo(0xc8a070));

  // ---------------------------------------------------------- ground floor walls
  const gTop = GF.y + GF.h;
  // back wall: wood cladding outside, lit interior face
  wood.box(GF.x1 - GF.x0, GF.h, 0.3, F.m(0, GF.y + GF.h / 2, GF.z1 - 0.15), wo(0x6a4a32));
  litWall(GF.x0 + 0.3, GF.x1 - 0.3, GF.y, GF.h, GF.z1 - 0.32);
  F.box(physics, 0, GF.y + GF.h / 2, GF.z1 - 0.15, GF.x1 - GF.x0, GF.h, 0.3, 0, { walkable: false });
  // left wall (stone) with chimney
  concrete.box(0.5, GF.h, GF.z1 - GF.z0, F.m(GF.x0 + 0.25, GF.y + GF.h / 2, 0), co(0x9a948a));
  concrete.box(1.6, UF.y + UF.h + 2.4, 1.6, F.m(GF.x0 - 0.6, (UF.y + UF.h + 2.4) / 2, 1.5), co(0x8a847a));
  F.box(physics, GF.x0 + 0.25, GF.y + GF.h / 2, 0, 0.5, GF.h, GF.z1 - GF.z0, 0, { walkable: false });
  F.box(physics, GF.x0 - 0.6, (UF.y + UF.h + 2.4) / 2, 1.5, 1.6, UF.y + UF.h + 2.4, 1.6, 0, { walkable: false });
  // glass front (door gap in the middle) + right side glass
  const glassWall = (ax, az, bx, bz, y0, h, doorFrom = null, doorTo = null) => {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
    const n = Math.max(1, Math.round(len / 2.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      dark.box(0.14, h, 0.14, F.m(x, y0 + h / 2, z), { color: FRAME });
    }
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    glass.box(len, h - 0.1, 0.04, F.m(mx, y0 + h / 2, mz, 0, rot, 0), {});
    dark.box(len + 0.14, 0.16, 0.18, F.m(mx, y0 + h - 0.08, mz, 0, rot, 0), { color: FRAME });
    dark.box(len + 0.14, 0.1, 0.18, F.m(mx, y0 + 0.05, mz, 0, rot, 0), { color: FRAME });
    // colliders (leave the door open)
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const seg = (s0, s1) => {
      if (s1 - s0 < 0.05) return;
      const cxl = ax + ux * ((s0 + s1) / 2);
      const czl = az + uz * ((s0 + s1) / 2);
      F.box(physics, cxl, y0 + h / 2, czl, Math.abs(ux) > 0.5 ? s1 - s0 : 0.15, h, Math.abs(ux) > 0.5 ? 0.15 : s1 - s0, 0, { walkable: false });
    };
    if (doorFrom != null) {
      seg(0, doorFrom);
      seg(doorTo, len);
    } else seg(0, len);
  };
  glassWall(GF.x0 + 0.5, GF.z0, GF.x1, GF.z0, GF.y, GF.h, 6.5, 9.5);
  glassWall(GF.x1, GF.z0, GF.x1, GF.z1, GF.y, GF.h);
  // ground floor ceiling (lit) = upper floor slab
  // upper floor slab with a hole over the stair (stair at x ∈ [−5.4, 0.2], z ∈ [2.9, 4.2])
  const slabT = 0.3;
  const slab = (x0, x1, z0, z1) => {
    concrete.box(x1 - x0, slabT, z1 - z0, F.m((x0 + x1) / 2, UF.y - slabT / 2, (z0 + z1) / 2), co(0xc8c4bc));
    F.box(physics, (x0 + x1) / 2, UF.y - slabT / 2, (z0 + z1) / 2, x1 - x0, slabT, z1 - z0);
  };
  slab(UF.x0, UF.x1, UF.z0, 2.85);
  slab(0.3, UF.x1, 2.85, UF.z1);
  slab(UF.x0, -5.5, 2.85, UF.z1);
  // ground floor area outside the upper footprint gets its own roof (x ∈ [−8, −6])
  concrete.box(2.1, slabT, GF.z1 - GF.z0, F.m(-7, gTop + 0.15, 0), co(0xc8c4bc));
  // warm ceiling panels
  for (const [lx, lz] of [[-3.5, -1.5], [2, -1.5], [5.5, 1.5], [-3, 1.2]]) glow.box(2.2, 0.04, 1.2, F.m(lx, UF.y - slabT - 0.03, lz), { color: hdr(0xffe0b8, 1.4), glow: [0, 0, 0.6] });
  wood.box(UF.x1 - UF.x0 - 0.2, 0.04, UF.z1 - UF.z0 - 0.2, F.m((UF.x0 + UF.x1) / 2, UF.y + 0.02, (UF.z0 + UF.z1) / 2 - 0.4), wo(0xc8a070));

  // ---------------------------------------------------------- interior stair (GF → UF)
  const nSteps = 9;
  const rise = (UF.y - GF.y) / nSteps;
  for (let i = 1; i <= nSteps; i++) {
    const lx = -5.4 + (i - 0.5) * 0.62;
    const top = GF.y + i * rise;
    wood.box(0.64, 0.08, 1.3, F.m(lx, top - 0.04, 3.55), wo(0xa07850));
    dark.box(0.64, 0.06, 0.08, F.m(lx, top - 0.3, 2.95), { color: FRAME });
    F.box(physics, lx, top - 0.2, 3.55, 0.62, 0.4, 1.3);
  }
  addBeam(dark, F.p(-5.4, GF.y + 1, 2.85), F.p(0.2, UF.y + 1, 2.85), 0.03, { color: 0x8a8e94 }, 4);

  // ---------------------------------------------------------- upper floor walls
  const uTop = UF.y + UF.h;
  wood.box(UF.x1 - UF.x0, UF.h, 0.3, F.m((UF.x0 + UF.x1) / 2, UF.y + UF.h / 2, UF.z1 - 0.15), wo(0x5a3e2a));
  litWall(UF.x0 + 0.3, UF.x1 - 0.3, UF.y, UF.h, UF.z1 - 0.32);
  F.box(physics, (UF.x0 + UF.x1) / 2, UF.y + UF.h / 2, UF.z1 - 0.15, UF.x1 - UF.x0, UF.h, 0.3, 0, { walkable: false });
  wood.box(0.3, UF.h, UF.z1 - UF.z0, F.m(UF.x0 + 0.15, UF.y + UF.h / 2, (UF.z0 + UF.z1) / 2), wo(0x5a3e2a));
  F.box(physics, UF.x0 + 0.15, UF.y + UF.h / 2, (UF.z0 + UF.z1) / 2, 0.3, UF.h, UF.z1 - UF.z0, 0, { walkable: false });
  glassWall(UF.x0 + 0.3, UF.z0, UF.x1, UF.z0, UF.y, UF.h);
  glassWall(UF.x1, UF.z0, UF.x1, UF.z1, UF.y, UF.h);
  // roof slab with overhang + fascia light
  concrete.box(UF.x1 - UF.x0 + 1.2, 0.45, UF.z1 - UF.z0 + 1.2, F.m((UF.x0 + UF.x1) / 2, uTop + 0.22, (UF.z0 + UF.z1) / 2), co(0x3a3c40));
  F.box(physics, (UF.x0 + UF.x1) / 2, uTop + 0.22, (UF.z0 + UF.z1) / 2, UF.x1 - UF.x0 + 1.2, 0.45, UF.z1 - UF.z0 + 1.2);
  glow.box(UF.x1 - UF.x0 + 1.0, 0.05, 0.05, F.m((UF.x0 + UF.x1) / 2, uTop - 0.02, UF.z0 - 0.58), { color: hdr(0xffd6a0, 2.4), glow: [0, 0, 0.3] });
  for (const [lx, lz] of [[-3, -2.5], [2.5, -2.5], [7, -2.5], [4, 1.5]]) glow.box(1.8, 0.04, 1.0, F.m(lx, uTop - 0.03, lz), { color: hdr(0xffe0b8, 1.4), glow: [0, 0, 0.6] });
  // dark slab edges (fascia) for the cantilever
  dark.box(UF.x1 - UF.x0 + 0.1, 0.35, 0.12, F.m((UF.x0 + UF.x1) / 2, UF.y - 0.17, UF.z0 - 0.06), { color: FRAME });
  // soffit lights over the covered porch (under the cantilever)
  for (const lx of [-3, 1, 5, 9]) glow.add(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10), F.m(lx, UF.y - slabT - 0.02, -5.2), { color: LAMP, glow: [0, 0, 0.35] });

  // ---------------------------------------------------------- furniture silhouettes
  const sofa = (lx, lz, rot, w = 2.6) => {
    furn.box(w, 0.45, 0.95, F.m(lx, GF.y + 0.23, lz, 0, rot, 0), { color: 0x4a4a4e });
    furn.box(w, 0.5, 0.25, F.m(lx + Math.sin(rot) * 0.4, GF.y + 0.65, lz + Math.cos(rot) * 0.4, 0, rot, 0), { color: 0x3e3e42 });
  };
  sofa(-2.2, -0.6, 0);
  sofa(-4.3, -1.6, Math.PI / 2, 1.8);
  furn.box(1.3, 0.35, 0.7, F.m(-2.4, GF.y + 0.18, -1.9), { color: 0x2a2420 });
  F.box(physics, -2.6, GF.y + 0.3, -1.0, 4, 0.6, 2.2);
  // dining table + chairs
  furn.box(2.2, 0.06, 1.0, F.m(3.5, GF.y + 0.75, 0.5), { color: 0x5a3e2a });
  for (const sx of [-0.7, 0.7]) furn.box(0.08, 0.72, 0.8, F.m(3.5 + sx, GF.y + 0.36, 0.5), { color: 0x2a2420 });
  for (const [cx, cz] of [[2.9, -0.2], [4.1, -0.2], [2.9, 1.2], [4.1, 1.2]]) furn.box(0.45, 0.9, 0.45, F.m(cx, GF.y + 0.45, cz), { color: 0x2e2a26 });
  F.box(physics, 3.5, GF.y + 0.4, 0.5, 2.4, 0.8, 2.0);
  // kitchen island + shelves along the back wall
  furn.box(2.6, 0.95, 0.9, F.m(6.2, GF.y + 0.48, 2.6), { color: 0xd8d4cc });
  for (let k = 0; k < 4; k++) furn.box(0.04, 2.6, 0.4, F.m(1.0 + k * 0.9, GF.y + 1.3, 4.05), { color: 0x2a2420 });
  for (let k = 0; k < 4; k++) furn.box(2.8, 0.04, 0.4, F.m(2.35, GF.y + 0.5 + k * 0.62, 4.05), { color: 0x2a2420 });
  for (let k = 0; k < 10; k++) furn.box(0.18, rng.range(0.2, 0.35), 0.25, F.m(1.1 + rng.range(0, 2.6), GF.y + 0.62 + rng.int(0, 3) * 0.62, 4.0), { color: rng.pick([0x8a3a2a, 0x2f5e7a, 0xc9a46a, 0x4a6a3a]) });
  // plants + floor lamp
  for (const [lx, lz] of [[7.2, -3.6], [-6.8, -3.6], [0.5, -3.7]]) {
    furn.add(new THREE.CylinderGeometry(0.25, 0.2, 0.45, 10), F.m(lx, GF.y + 0.23, lz), { color: 0xc8c0b4 });
    furn.add(new THREE.IcosahedronGeometry(0.55, 0), F.m(lx, GF.y + 0.95, lz, 0.3, 0.5, 0, 1, 1.3, 1), { flat: true, color: 0x3f6a2a });
  }
  addBeam(dark, F.p(-0.4, GF.y, -1.2), F.p(-0.4, GF.y + 1.6, -1.2), 0.02, { color: FRAME }, 4);
  glow.add(new THREE.CylinderGeometry(0.18, 0.26, 0.3, 10), F.m(-0.4, GF.y + 1.7, -1.2), { color: LAMP, glow: [0, 0, 0.5] });
  // upstairs: bed, desk, armchair, pendant
  furn.box(2.2, 0.5, 2.0, F.m(6.5, UF.y + 0.25, 1.4), { color: 0xd8d2c6 });
  furn.box(2.2, 0.9, 0.15, F.m(6.5, UF.y + 0.45, 2.45), { color: 0x4a3426 });
  furn.box(1.6, 0.06, 0.7, F.m(1.5, UF.y + 0.75, 2.9), { color: 0x2a2420 });
  furn.box(0.9, 0.85, 0.85, F.m(-2.5, UF.y + 0.43, -2.5, 0, 0.6, 0), { color: 0x5a4a3e });
  F.box(physics, 6.5, UF.y + 0.25, 1.4, 2.2, 0.5, 2.0);
  glow.add(new THREE.SphereGeometry(0.22, 10, 8), F.m(3.5, UF.y - 1.1, 0.5), { color: LAMP, glow: [0, 0, 0.5] });
  // signature ring pendant over the upstairs lounge + wall lights
  glow.add(new THREE.TorusGeometry(0.9, 0.05, 6, 40), F.m(2.2, UF.y + UF.h - 0.75, -2.0, Math.PI / 2, 0, 0), { color: hdr(0xffe2b8, 2.4), glow: [0, 0, 0.6] });
  for (const dx of [-0.6, 0.6]) addBeam(dark, F.p(2.2 + dx, UF.y + UF.h - 0.75, -2.0), F.p(2.2 + dx, UF.y + UF.h - 0.02, -2.0), 0.008, { color: FRAME }, 3);
  for (const lx of [-6.2, -1.2, 4.6]) glow.box(0.25, 0.32, 0.05, F.m(lx, GF.y + 2.1, GF.z1 - 0.36), { color: LAMP, glow: [0, 0, 0.5] });
  for (const lx of [-1.5, 6.8]) glow.box(0.25, 0.32, 0.05, F.m(lx, UF.y + 2.0, UF.z1 - 0.36), { color: LAMP, glow: [0, 0, 0.5] });
  // framed pictures (dark silhouettes against the lit back wall)
  furn.box(1.4, 0.9, 0.04, F.m(-3.8, GF.y + 1.9, GF.z1 - 0.36), { color: 0x2a2420 });
  furn.box(1.0, 1.2, 0.04, F.m(4.2, UF.y + 1.7, UF.z1 - 0.36), { color: 0x2a2420 });
  addBeam(dark, F.p(3.5, UF.y - 0.9, 0.5), F.p(3.5, UF.y - slabT, 0.5), 0.01, { color: FRAME }, 3);

  // ---------------------------------------------------------- deck + steps
  const DECK = { x0: -8.6, x1: 11, z0: -10.5, z1: GF.z0 };
  wood.box(DECK.x1 - DECK.x0, 0.14, DECK.z1 - DECK.z0, F.m((DECK.x0 + DECK.x1) / 2, GF.y - 0.07, (DECK.z0 + DECK.z1) / 2), wo(0xb08a62));
  dark.box(DECK.x1 - DECK.x0, GF.y + 1.2, 0.2, F.m((DECK.x0 + DECK.x1) / 2, (GF.y - 1.2) / 2 - 0.07, DECK.z0 + 0.1), { color: 0x3a2a20 });
  F.box(physics, (DECK.x0 + DECK.x1) / 2, GF.y / 2 - 0.4, (DECK.z0 + DECK.z1) / 2, DECK.x1 - DECK.x0, GF.y + 0.8, DECK.z1 - DECK.z0);
  for (let i = 0; i < 3; i++) {
    const top = GF.y - (i + 1) * 0.2;
    const lz = DECK.z0 - 0.4 - i * 0.42;
    wood.box(5, 0.14, 0.44, F.m(1.2, top - 0.07, lz), wo(0xa07850));
    dark.box(5, Math.max(0.05, top), 0.4, F.m(1.2, top / 2 - 0.1, lz + 0.02), { color: 0x3a2a20 });
    F.box(physics, 1.2, top / 2 - 0.1, lz, 5, Math.max(0.2, top + 0.2), 0.44);
  }
  // deck edge lights
  for (let x = DECK.x0 + 1; x < DECK.x1; x += 2.4) glow.box(0.25, 0.05, 0.05, F.m(x, GF.y - 0.12, DECK.z0 - 0.02), { color: LAMP, glow: [0, 0, 0.3] });
  // outdoor lounge on the deck (under the cantilever)
  for (const lx of [-5.5, -2.8]) {
    furn.box(1.0, 0.4, 1.0, F.m(lx, GF.y + 0.2, -7.4, 0, 0.3, 0), { color: 0x6a6a6e });
    furn.box(1.0, 0.45, 0.2, F.m(lx + 0.1, GF.y + 0.62, -7.0, 0, 0.3, 0), { color: 0x5a5a5e });
  }
  for (let k = 0; k < 4; k++) {
    const p = F.p(DECK.x1 - 1.2, 0, DECK.z0 + 1 + k * 1.5);
    furn.add(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 10), mat(p.x, gy + GF.y + 0.25, p.z), { color: 0x2e3036 });
    furn.add(new THREE.IcosahedronGeometry(0.5, 0), mat(p.x, gy + GF.y + 0.85, p.z, 0.2, k, 0), { flat: true, color: rng.pick([0x3f6a2a, 0x5a7a34]) });
  }

  // ---------------------------------------------------------- fire pit + lounge chairs (in front)
  const fpLocal = [2.5, -16.5];
  const fp = F.p(fpLocal[0], 0, fpLocal[1]);
  const fpy = ground.at(fp.x, fp.z);
  concrete.add(new THREE.CylinderGeometry(1.3, 1.4, 0.5, 20, 1, true), mat(fp.x, fpy + 0.25, fp.z), co(0x6a6560));
  concrete.add(new THREE.TorusGeometry(1.32, 0.14, 6, 24), mat(fp.x, fpy + 0.5, fp.z, Math.PI / 2, 0, 0), co(0x7a756e));
  physics?.addBox({ x: fp.x, y: fpy + 0.25, z: fp.z, w: 2.6, h: 0.5, d: 2.6, tag: 'landmarks' });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    dark.add(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 5), mat(fp.x + Math.cos(a) * 0.35, fpy + 0.35, fp.z + Math.sin(a) * 0.35, Math.PI / 2, a, 0.4), { color: 0x2a1a10 });
  }
  glow.add(new THREE.CircleGeometry(1.1, 20).rotateX(-Math.PI / 2), mat(fp.x, fpy + 0.3, fp.z), { color: hdr(0xff6a20, 2.4), glow: [-1.7, 0, 1] });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.5;
    const cx = fp.x + Math.cos(a) * 3.2;
    const cz = fp.z + Math.sin(a) * 3.2;
    const rot = Math.atan2(cx - fp.x, cz - fp.z);
    furn.box(0.9, 0.35, 1.6, mat(cx, ground.at(cx, cz) + 0.3, cz, 0, rot, 0), { color: 0x7a6a5a });
    furn.box(0.9, 0.7, 0.2, mat(cx + Math.sin(rot) * 0.75, ground.at(cx, cz) + 0.7, cz + Math.cos(rot) * 0.75, -0.35, rot, 0), { color: 0x6a5a4a });
    physics?.addBox({ x: cx, y: ground.at(cx, cz) + 0.3, z: cz, w: 0.9, h: 0.6, d: 1.6, rotY: rot, tag: 'landmarks' });
  }
  pools.push({ x: fp.x, z: fp.z, r: 7, color: 0xff7a30, k: 0.9 });
  const flames = makeFlames(mats, fp.x, fpy + 0.4, fp.z);
  group.add(flames);

  // ---------------------------------------------------------- workshop wing + solar panels
  const WS = { x0: -16, x1: -8.8, z0: -3.4, z1: 4.4, h: 3.6 };
  // workshop mass with a shallow open bay at the front (lit interior)
  const BAY = 1.3;
  concrete.box(WS.x1 - WS.x0, WS.h + 1, WS.z1 - WS.z0 - BAY, F.m((WS.x0 + WS.x1) / 2, (WS.h - 1) / 2, (WS.z0 + BAY + WS.z1) / 2), co(0x6e6a64));
  for (const wx of [WS.x0 + 0.15, WS.x1 - 0.15]) concrete.box(0.3, WS.h + 1, BAY, F.m(wx, (WS.h - 1) / 2, WS.z0 + BAY / 2), co(0x6e6a64));
  concrete.box(WS.x1 - WS.x0, 0.4, BAY, F.m((WS.x0 + WS.x1) / 2, WS.h - 0.2, WS.z0 + BAY / 2), co(0x6e6a64));
  F.box(physics, (WS.x0 + WS.x1) / 2, WS.h / 2, (WS.z0 + BAY + WS.z1) / 2, WS.x1 - WS.x0, WS.h, WS.z1 - WS.z0 - BAY, 0, { walkable: true });
  {
    // open workshop bay: lit interior wall with tool silhouettes, half-raised door
    const wx = (WS.x0 + WS.x1) / 2;
    glow.box(4.0, 2.7, 0.04, F.m(wx, 1.45, WS.z0 + BAY - 0.04), { color: hdr(0xffd2a0, 0.75), glow: [0, 0, 0.5] });
    for (let k = 0; k < 9; k++) furn.box(0.06, rng.range(0.3, 0.7), 0.04, F.m(wx - 1.6 + k * 0.4, 1.9 + rng.range(-0.1, 0.1), WS.z0 + BAY - 0.08, 0, 0, rng.range(-0.3, 0.3)), { color: 0x2a2620 });
    furn.box(3.4, 0.9, 0.7, F.m(wx, 0.45, WS.z0 + 0.75), { color: 0x4a3a2c });
    for (let k = 0; k < 5; k++) furn.box(0.25, 0.22, 0.3, F.m(wx - 1.3 + k * 0.6, 1.0, WS.z0 + 0.7), { color: rng.pick([0xb04a2a, 0x2f5e8a, 0xc9a46a, 0x5a6068]) });
    dark.box(4.2, 0.9, 0.1, F.m(wx, 2.65, WS.z0 - 0.05), { color: 0x2c2f35 });
    for (let k = 0; k < 3; k++) dark.box(4.2, 0.04, 0.12, F.m(wx, 2.3 + k * 0.3, WS.z0 - 0.05), { color: 0x3a3e45 });
    glow.box(4.4, 0.08, 0.08, F.m(wx, 3.05, WS.z0 - 0.12), { color: LAMP, glow: [0, 0, 0.35] });
    pools.push({ x: F.p(wx, 0, WS.z0 - 2).x, z: F.p(wx, 0, WS.z0 - 2).z, r: 4.5, color: 0xffb070, k: 0.5 });
  }
  for (let i = 0; i < 3; i++) {
    const lx = WS.x0 + 1.3 + i * 2.3;
    dark.box(2.1, 0.08, 3.2, F.m(lx, WS.h + 0.9, (WS.z0 + WS.z1) / 2 - 0.6, 0.45, 0, 0), { color: 0x1a2a4a });
    for (let k = 0; k < 3; k++) glow.box(2.1, 0.02, 0.03, F.m(lx, WS.h + 0.9 + (k - 1) * 0.45, (WS.z0 + WS.z1) / 2 - 0.6 + (k - 1) * -0.98 * 0, 0.45, 0, 0), { color: hdr(0x5a7ab0, 0.5), glow: [0, 0, 1] });
    addBeam(dark, F.p(lx, WS.h, (WS.z0 + WS.z1) / 2 + 0.6), F.p(lx, WS.h + 1.4, (WS.z0 + WS.z1) / 2 + 0.2), 0.04, { color: 0x8a8e94 }, 4);
  }
  // crates
  for (let i = 0; i < 5; i++) {
    const p = F.p(WS.x0 + rng.range(0, 6), 0, WS.z0 - rng.range(1.2, 3.5));
    const s = rng.range(0.7, 1.1);
    wood.box(s, s, s, mat(p.x, ground.at(p.x, p.z) + s / 2, p.z, 0, rng.range(0, 1), 0), wo(0x8a6a44));
    physics?.addBox({ x: p.x, y: ground.at(p.x, p.z) + s / 2, z: p.z, w: s, h: s, d: s, tag: 'landmarks' });
  }

  // ---------------------------------------------------------- landing pad (starter VTOL)
  const LP = B.landingPad;
  let landingPad = null;
  if (LP) {
    const lpy = ground.max(LP.x, LP.z, 8) + 0.9;
    const PF = new Frame(LP.x, lpy, LP.z, H.rotY);
    dark.box(15, 0.4, 15, PF.m(0, -0.2, 0), { color: 0x2c2f35 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = PF.p(sx * 6.5, 0, sz * 6.5);
      const gyp = ground.at(p.x, p.z);
      dark.box(0.5, lpy - gyp + 0.6, 0.5, mat(p.x, (lpy + gyp) / 2 - 0.3, p.z), { color: 0x3a3e45 });
    }
    PF.box(physics, 0, -0.3, 0, 15, 0.6, 15);
    // steps down to the ground on the house side
    const steps = Math.ceil((lpy - ground.at(LP.x, LP.z)) / 0.35);
    for (let i = 1; i <= steps; i++) {
      const top = 0 - i * ((lpy - ground.at(LP.x, LP.z)) / steps);
      PF.box(physics, 0, top - 0.15, 7.5 + i * 0.5, 3, 0.3, 0.5);
      dark.box(3, 0.12, 0.5, PF.m(0, top - 0.06, 7.5 + i * 0.5), { color: 0x3a3e45 });
    }
    const marking = new THREE.Mesh(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: padTexture(['B1']), alphaTest: 0.3, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 }));
    mats.list.push(marking.material);
    marking.position.copy(PF.p(0, 0.02, 0));
    marking.rotation.y = PF.rotY;
    marking.name = 'base-pad-marking';
    group.add(marking);
    const n = 20;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const side = Math.floor(t * 4);
      const f = t * 4 - side;
      const pts = [[-7.4 + f * 14.8, -7.4], [7.4, -7.4 + f * 14.8], [7.4 - f * 14.8, 7.4], [-7.4, 7.4 - f * 14.8]][side];
      glow.box(0.3, 0.1, 0.3, PF.m(pts[0], 0.05, pts[1]), { color: hdr(0xffb04a, 3.4), glow: [-0.5, t, 0.3] });
    }
    // Ø banner on a pole next to the pad
    const bp = PF.p(-8.6, 0, -6);
    const bgy = ground.at(bp.x, bp.z);
    addBeam(dark, new THREE.Vector3(bp.x, bgy, bp.z), new THREE.Vector3(bp.x, bgy + 7, bp.z), 0.08, { color: FRAME }, 6);
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.8, 1, 6).translate(0, -1.9, 0), mats.banner());
    bm.position.set(bp.x, bgy + 6.8, bp.z);
    bm.rotation.y = H.rotY + Math.PI / 2;
    bm.name = 'base-banner';
    group.add(bm);
    pools.push({ x: LP.x, z: LP.z, r: 9, color: 0xffb060, k: 0.3 });
    landingPad = { position: PF.p(0, 0, 0), rotY: H.rotY };
  }

  pools.push({ x: F.p(1, 0, -8).x, z: F.p(1, 0, -8).z, r: 10, color: 0xffb070, k: 0.45 });

  // ---------------------------------------------------------- meshes
  group.add(concrete.mesh(mats.stoneClean, { name: 'house-concrete', castShadow: true, receiveShadow: true }));
  group.add(wood.mesh(mats.wood, { name: 'house-wood', castShadow: true, receiveShadow: true }));
  group.add(dark.mesh(mats.dark, { name: 'house-frames', castShadow: true, receiveShadow: true }));
  group.add(furn.mesh(mats.painted, { name: 'house-furniture', castShadow: true, receiveShadow: true }));
  group.add(glow.mesh(mats.glow, { name: 'house-lights' }));
  const g = glass.mesh(mats.glass, { name: 'house-glass', castShadow: false });
  if (g) {
    g.renderOrder = 1;
    group.add(g);
  }
  group.add(buildPools(mats, pools, (x, z) => Math.max(ground.at(x, z), gy - 1) + 0.08));

  const hc = F.p(-2.5, 0, -3);
  return {
    group,
    // no forest trees / rocks inside the house, deck, fire pit or on the landing pad
    clearDiscs: [{ x: hc.x, z: hc.z, r: 15 }, ...(LP ? [{ x: LP.x, z: LP.z, r: 10 }] : [])],
    position: F.p(0, GF.y, 0),
    rotY: H.rotY,
    door: F.p(0.5, GF.y, GF.z0 - 1.2),
    stairBottom: F.p(-5.9, GF.y, 3.55),
    front: F.p(1.2, 0, -14),
    upstairs: F.p(5, UF.y, -2),
    firePit: new THREE.Vector3(fp.x, fpy, fp.z),
    landingPad,
    update(dt, cam, t) {
      flames.material.uniforms.uTime.value = t;
    },
  };
}

/** Flickering additive flame cards. */
function makeFlames(mats, x, y, z) {
  const g = new GeoBuilder({ uv: true });
  for (let k = 0; k < 4; k++) {
    const plane = new THREE.PlaneGeometry(1.4, 1.9).translate(0, 0.95, 0);
    g.add(plane, mat(x, y, z, 0, (k / 4) * Math.PI, 0), {});
    plane.dispose();
  }
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, map: { value: radialTexture() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
      void main() {
        vec2 uv = vUv;
        float t = uTime * 2.4;
        float flick = n(vec2(uv.x * 4.0, uv.y * 3.0 - t)) * 0.6 + n(vec2(uv.x * 9.0, uv.y * 6.0 - t * 1.7)) * 0.4;
        float shape = (1.0 - uv.y) * (1.0 - abs(uv.x - 0.5) * 2.0 * (0.6 + uv.y));
        float f = smoothstep(0.15, 0.75, shape * (0.55 + flick * 0.9));
        vec3 col = mix(vec3(1.0, 0.35, 0.06), vec3(1.0, 0.85, 0.45), f) * f * 3.2;
        gl_FragColor = vec4(col, f);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mats.list.push(m);
  const mesh = g.mesh(m, { name: 'house-fire' });
  return mesh;
}
