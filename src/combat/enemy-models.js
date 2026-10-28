/**
 * Procedural models for this wave's enemies (front = −Z, metres), built with the
 * combat geometry kit (vertex albedo + HDR emissive `aEmit`), drawn as instanced
 * rigid parts by enemies.js:
 *
 *   raiderGeometries()  pirate combat robot (25_coop_squad.png "Gevechtsrobot"): white /
 *                       grey armour, dark joints, red visor, orange pirate paint, scrap
 *                       power pack; parts torso · head · upperArm · foreArm · thigh · shin ·
 *                       rifle · crest (squad captains). Joint layout: RAIDER.
 *   miteGeometries()    crystal mite (Crystal Highlands swarmer): dark violet shell with
 *                       glowing cyan crystal spines; parts body · leg (×6). Layout: MITE.
 *   barrierGeometries() a raider's portable shield wall: emitter base (lit) + the energy
 *                       pane (shader material in enemies.js, uv 0..1).
 */
import * as THREE from 'three';
import { box, rbox, cyl, sphere, cone, torus, paint, merge, lin, hash3, place, ALONG_Z, ALONG_X } from './geo.js';

const setC = (c, v, k = 1) => {
  c[0] = v[0] * k;
  c[1] = v[1] * k;
  c[2] = v[2] * k;
};

// ------------------------------------------------------------------ raider
export const RAIDER = {
  hipY: 1.0, // pelvis pivot above the feet (standing)
  neck: [0, 0.74, 0.0],
  shoulder: [0.27, 0.6, 0.02],
  hip: [0.12, -0.04, 0.0],
  upper: 0.31,
  fore: 0.29,
  thigh: 0.47,
  shin: 0.47,
  rifle: [0.1, 0.42, -0.2], // grip pivot in torso space (rifle points −Z)
  muzzle: 0.95, // grip → muzzle along −Z
};

export function raiderGeometries() {
  const WHITE = lin(0xdfe3e8);
  const PALE = lin(0xb9bfc7);
  const MID = lin(0x7b828c);
  const DARK = lin(0x1d2026);
  const ORANGE = lin(0xd0582a);
  const RED = [7.2, 0.45, 0.25];
  const EYE = [5.5, 0.35, 0.2];
  // paint: white plates, an orange pirate stripe across the chest + one shoulder
  const armour = (x, y, z, nx, ny, nz, c) => {
    if (Math.abs(y - 0.5) < 0.04 && nz < -0.3) setC(c, ORANGE);
    else if (ny < -0.6) setC(c, MID);
  };
  const torso = [
    // pelvis + belt
    paint(rbox(0.36, 0.2, 0.24, 0.05, { p: [0, 0.02, 0] }), MID),
    paint(box(0.4, 0.05, 0.27, { p: [0, 0.12, 0] }), DARK),
    // abdomen (dark flexible core) + chest plates
    paint(cyl(0.12, 0.14, 0.26, 12, { p: [0, 0.26, 0.01] }), DARK),
    paint(rbox(0.48, 0.34, 0.3, 0.08, { p: [0, 0.52, 0] }), WHITE, [0, 0, 0], armour),
    paint(rbox(0.3, 0.12, 0.06, 0.03, { p: [0, 0.6, -0.16] }), PALE),
    // the red core light in the chest
    paint(cyl(0.05, 0.05, 0.03, 14, { p: [0, 0.48, -0.16], r: ALONG_Z }), DARK, [RED[0] * 0.55, RED[1] * 0.55, RED[2] * 0.55]),
    // shoulder pads (orange-tipped on the left: pirate paint)
    paint(rbox(0.2, 0.12, 0.24, 0.05, { p: [0.31, 0.68, 0], r: [0, 0, -0.25] }), WHITE),
    paint(rbox(0.2, 0.12, 0.24, 0.05, { p: [-0.31, 0.68, 0], r: [0, 0, 0.25] }), WHITE, [0, 0, 0], (x, y, z, nx, ny, nz, c) => {
      if (x < -0.36) setC(c, ORANGE);
    }),
    // scrap power pack + vents + antenna mast
    paint(rbox(0.34, 0.36, 0.18, 0.04, { p: [0, 0.5, 0.22] }), MID, [0, 0, 0], (x, y, z, nx, ny, nz, c) => {
      if (hash3(Math.round(x * 14), Math.round(y * 14), 3) > 0.82) setC(c, DARK);
    }),
    paint(box(0.24, 0.04, 0.02, { p: [0, 0.42, 0.32] }), DARK, [4.0, 0.9, 0.25]),
    paint(box(0.24, 0.04, 0.02, { p: [0, 0.5, 0.32] }), DARK, [4.0, 0.9, 0.25]),
    paint(cyl(0.012, 0.012, 0.42, 6, { p: [0.12, 0.86, 0.26] }), DARK),
    paint(sphere(0.025, 8, 6, { p: [0.12, 1.08, 0.26] }), DARK, RED),
  ];
  const head = [
    paint(rbox(0.22, 0.24, 0.24, 0.07, { p: [0, 0.14, 0] }), WHITE),
    paint(rbox(0.2, 0.07, 0.04, 0.02, { p: [0, 0.16, -0.12] }), DARK),
    // visor slit (the red eye line) + the main eye
    paint(box(0.17, 0.025, 0.02, { p: [0, 0.165, -0.136] }), DARK, EYE),
    paint(sphere(0.03, 10, 8, { p: [0.04, 0.165, -0.14] }), DARK, RED),
    paint(cyl(0.05, 0.06, 0.06, 10, { p: [0, 0.0, 0] }), DARK),
    paint(box(0.03, 0.1, 0.1, { p: [0.12, 0.17, 0.02] }), MID),
    paint(box(0.03, 0.1, 0.1, { p: [-0.12, 0.17, 0.02] }), MID),
  ];
  const upperArm = [
    paint(sphere(0.07, 10, 8), DARK),
    paint(rbox(0.12, RAIDER.upper - 0.04, 0.12, 0.04, { p: [0, -RAIDER.upper / 2, 0] }), WHITE),
    paint(sphere(0.055, 10, 8, { p: [0, -RAIDER.upper, 0] }), DARK),
  ];
  const foreArm = [
    paint(rbox(0.11, RAIDER.fore - 0.04, 0.11, 0.04, { p: [0, -RAIDER.fore / 2, 0] }), PALE),
    paint(box(0.12, 0.03, 0.12, { p: [0, -0.06, 0] }), ORANGE),
    paint(rbox(0.09, 0.1, 0.1, 0.03, { p: [0, -RAIDER.fore - 0.04, 0] }), DARK),
  ];
  const thigh = [
    paint(sphere(0.08, 10, 8), DARK),
    paint(rbox(0.15, RAIDER.thigh - 0.05, 0.16, 0.05, { p: [0, -RAIDER.thigh / 2, 0] }), WHITE),
    paint(sphere(0.065, 10, 8, { p: [0, -RAIDER.thigh, 0] }), DARK),
  ];
  const shin = [
    paint(rbox(0.13, RAIDER.shin - 0.06, 0.14, 0.04, { p: [0, -RAIDER.shin / 2, 0] }), PALE),
    paint(rbox(0.1, 0.16, 0.06, 0.03, { p: [0, -0.12, -0.08] }), WHITE),
    paint(rbox(0.14, 0.07, 0.28, 0.03, { p: [0, -RAIDER.shin - 0.01, -0.05] }), DARK),
  ];
  // plasma carbine: dark receiver, orange stripe, red emitter at the muzzle (barrel along −Z)
  const rifle = [
    paint(rbox(0.07, 0.12, 0.58, 0.02, { p: [0, 0.02, -0.18] }), DARK),
    paint(rbox(0.05, 0.09, 0.22, 0.015, { p: [0, 0.0, 0.2] }), MID),
    paint(cyl(0.022, 0.026, 0.42, 10, { p: [0, 0.035, -0.62], r: ALONG_Z }), MID),
    paint(box(0.075, 0.02, 0.3, { p: [0, 0.09, -0.2] }), ORANGE),
    paint(torus(0.03, 0.008, 6, 14, { p: [0, 0.035, -0.84] }), DARK, [RED[0] * 0.6, RED[1] * 0.6, RED[2] * 0.6]),
    paint(box(0.04, 0.12, 0.05, { p: [0, -0.08, -0.02], r: [0.3, 0, 0] }), DARK),
    paint(box(0.05, 0.1, 0.07, { p: [0, -0.06, -0.26] }), DARK),
  ];
  // captains: an orange crest + a tattered pirate banner on the pack
  const crest = [
    paint(box(0.04, 0.12, 0.24, { p: [0, 0.3, 0.02] }), ORANGE),
    paint(box(0.3, 0.42, 0.015, { p: [0, 0.52, 0.34], r: [0.12, 0, 0] }), ORANGE, [0, 0, 0], (x, y, z, nx, ny, nz, c) => {
      if (Math.abs(x) < 0.05 && y > 0.48 && y < 0.62) setC(c, DARK);
    }),
  ];
  return {
    torso: merge(torso),
    head: merge(head),
    upperArm: merge(upperArm),
    foreArm: merge(foreArm),
    thigh: merge(thigh),
    shin: merge(shin),
    rifle: merge(rifle),
    crest: merge(crest),
  };
}

// ------------------------------------------------------------------ crystal mite
export const MITE = {
  bodyY: 0.38,
  // hip anchors (x, z) of the six legs; legs splay outward
  hips: [
    [0.2, -0.22],
    [0.24, 0.0],
    [0.2, 0.22],
    [-0.2, -0.22],
    [-0.24, 0.0],
    [-0.2, 0.22],
  ],
  leg: 0.52,
};

export function miteGeometries() {
  const SHELL = lin(0x1c1530);
  const BELLY = lin(0x34284d);
  const CYAN = [0.35, 2.6, 3.2];
  const VIOLET = [1.6, 0.5, 2.8];
  const body = [
    paint(place(new THREE.IcosahedronGeometry(0.34, 1), { s: [0.95, 0.6, 1.3] }), SHELL, [0, 0, 0], (x, y, z, nx, ny, nz, c, e) => {
      if (ny < -0.4) setC(c, BELLY);
      if (ny > 0.55 && hash3(Math.round(x * 20), Math.round(y * 20), Math.round(z * 20)) > 0.7) setC(e, VIOLET, 0.6);
    }),
    // head + mandibles
    paint(place(new THREE.IcosahedronGeometry(0.16, 1), { p: [0, -0.02, -0.44], s: [1, 0.75, 1.1] }), SHELL),
    paint(cone(0.03, 0.18, 6, { p: [0.07, -0.06, -0.6], r: [-Math.PI / 2, 0, -0.35] }), BELLY, [0.4, 1.4, 1.8]),
    paint(cone(0.03, 0.18, 6, { p: [-0.07, -0.06, -0.6], r: [-Math.PI / 2, 0, 0.35] }), BELLY, [0.4, 1.4, 1.8]),
    paint(sphere(0.03, 8, 6, { p: [0.07, 0.03, -0.55] }), SHELL, CYAN),
    paint(sphere(0.03, 8, 6, { p: [-0.07, 0.03, -0.55] }), SHELL, CYAN),
    // the glowing core under a crack in the shell
    paint(place(new THREE.OctahedronGeometry(0.11, 0), { p: [0, 0.16, 0.05], s: [1, 1.2, 1.4] }), SHELL, [CYAN[0] * 0.9, CYAN[1] * 0.9, CYAN[2] * 0.9]),
  ];
  // crystal spines along the back
  const spines = [
    [0, 0.2, -0.12, 0.2, 0],
    [0.1, 0.18, 0.12, 0.17, 0.35],
    [-0.1, 0.18, 0.12, 0.17, -0.35],
    [0.05, 0.14, 0.32, 0.14, 0.2],
    [-0.05, 0.14, 0.32, 0.14, -0.2],
  ];
  for (const [x, y, z, h, tilt] of spines) {
    body.push(paint(place(new THREE.OctahedronGeometry(0.06, 0), { p: [x, y + h * 0.55, z], r: [-0.5, 0, tilt], s: [0.7, h / 0.06, 0.7] }), [0.1, 0.4, 0.5], CYAN));
  }
  // one leg: hip at the origin, the foot reaches out (+X) and down; mirrored by the instance transform
  const leg = [
    paint(cyl(0.028, 0.022, MITE.leg * 0.55, 6, { p: [MITE.leg * 0.22, 0.08, 0], r: [0, 0, -1.15] }), SHELL),
    paint(sphere(0.035, 6, 5, { p: [MITE.leg * 0.44, 0.17, 0] }), BELLY),
    paint(cone(0.026, MITE.leg * 0.62, 6, { p: [MITE.leg * 0.6, -0.08, 0], r: [0, 0, 2.6] }), SHELL, [0, 0, 0], (x, y, z, nx, ny, nz, c, e) => {
      if (y < -0.25) setC(e, CYAN, 0.5);
    }),
  ];
  return { body: merge(body), leg: merge(leg) };
}

// ------------------------------------------------------------------ barrier
export const BARRIER = { w: 2.6, h: 1.5 };

export function barrierGeometries() {
  const DARK = lin(0x202329);
  const MID = lin(0x5d636c);
  const ORANGE = [3.6, 1.0, 0.3];
  const base = merge([
    paint(rbox(BARRIER.w * 0.92, 0.12, 0.26, 0.04, { p: [0, 0.06, 0] }), DARK),
    paint(box(BARRIER.w * 0.86, 0.03, 0.06, { p: [0, 0.13, 0] }), DARK, ORANGE),
    paint(rbox(0.18, 0.3, 0.22, 0.04, { p: [BARRIER.w * 0.44, 0.15, 0] }), MID),
    paint(rbox(0.18, 0.3, 0.22, 0.04, { p: [-BARRIER.w * 0.44, 0.15, 0] }), MID),
    paint(cyl(0.025, 0.025, 0.3, 6, { p: [BARRIER.w * 0.44, 0.45, 0] }), DARK, ORANGE),
    paint(cyl(0.025, 0.025, 0.3, 6, { p: [-BARRIER.w * 0.44, 0.45, 0] }), DARK, ORANGE),
  ]);
  const pane = new THREE.PlaneGeometry(BARRIER.w * 0.9, BARRIER.h - 0.12, 1, 1);
  pane.translate(0, 0.12 + (BARRIER.h - 0.12) / 2, 0);
  return { base, pane };
}

void ALONG_X;
