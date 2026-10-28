/**
 * Vehicles — "Grondvoertuig": a low futuristic sports car (22_vehicle_sheet
 * "Sportauto", crop_vehicles). The body is a loft of 46 hand-shaped
 * cross-sections (fender bulges over a sunken hood, waisted doors, wide rear
 * haunches, kamm tail) with real wheel arches carved into the sections, a
 * fastback glass greenhouse with a painted roof, carbon splitter / skirts /
 * diffuser / wing, swept LED strips, a full-width tail bar and a white Ø on
 * the doors. Wheels are three InstancedMeshes (tyres, rims, calipers).
 *
 * createCarModel(mats, { glow }) → THREE.Group (front −Z, origin on the ground
 * between the wheels). userData: body (Group that may bob/roll), paint,
 * glowMat, wheels { pos: [[x,y,z]…], radius, setPose(steer, spin, drops[4]) },
 * lights { head, tail, beams }, underglow, length, width, height.
 */
import * as THREE from 'three';
import { PartBuilder, M, loft, latheX, strip, strut, flipFaces } from './geo.js';
import { hdr } from './materials.js';

export const CAR = { length: 4.76, width: 2.04, height: 1.17, wheelR: 0.36, wheelX: 0.86, wheelZ: 1.42, wheelBase: 2.84 };

/** Piecewise smooth curve through [[z, value]…] keys (smoothstep between keys). */
function keyCurve(keys) {
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [z1, v1] = keys[i];
      if (z <= z1) {
        const [z0, v0] = keys[i - 1];
        const t = (z - z0) / (z1 - z0 || 1);
        const s = t * t * (3 - 2 * t);
        return v0 + (v1 - v0) * s;
      }
    }
    return keys[keys.length - 1][1];
  };
}

const HW = keyCurve([[-2.38, 0.74], [-2.24, 0.88], [-1.9, 0.97], [-1.42, 1.0], [-0.8, 0.965], [0.2, 0.95], [0.95, 0.985], [1.42, 1.02], [1.95, 0.99], [2.25, 0.88], [2.38, 0.78]]);
const Y_TOP = keyCurve([[-2.38, 0.4], [-2.26, 0.5], [-1.95, 0.66], [-1.42, 0.84], [-0.9, 0.865], [-0.4, 0.875], [0.6, 0.895], [1.42, 0.955], [2.0, 0.95], [2.38, 0.86]]);
const Y_MID = keyCurve([[-2.38, 0.4], [-2.24, 0.47], [-1.85, 0.58], [-1.25, 0.7], [-0.75, 0.79], [-0.55, 0.84], [0.6, 0.88], [1.3, 0.92], [2.0, 0.94], [2.38, 0.85]]);
const Y_SILL = keyCurve([[-2.38, 0.3], [-2.24, 0.26], [2.12, 0.27], [2.38, 0.46]]);
const Y_FLOOR = keyCurve([[-2.38, 0.27], [-2.2, 0.2], [2.12, 0.2], [2.38, 0.42]]);
const ARCH_R = 0.44;

function archY(z) {
  let y = 0;
  for (const zw of [-CAR.wheelZ, CAR.wheelZ]) {
    const d = z - zw;
    if (Math.abs(d) < ARCH_R) y = Math.max(y, CAR.wheelR + Math.sqrt(ARCH_R * ARCH_R - d * d));
  }
  return y;
}

/** One body cross-section ring (21 points, CCW seen from +Z). */
function bodyRing(z) {
  const hw = HW(z);
  const yTop = Y_TOP(z);
  const yMid = Y_MID(z);
  const ySill = Math.min(yTop - 0.04, Math.max(Y_SILL(z), archY(z)));
  const yFloor = Math.min(ySill, Y_FLOOR(z));
  const span = yTop - ySill;
  const pts = [];
  const side = [
    [hw * 0.93, ySill],
    [hw * 0.99, ySill + span * 0.3],
    [hw * 1.0, ySill + span * 0.62],
    [hw * 0.985, ySill + span * 0.88],
  ];
  for (const [x, y] of side) pts.push(new THREE.Vector3(x, y, z));
  const top = [0, 0.25, 0.5, 0.75, 1];
  for (const t of top) {
    const s = t * t * (3 - 2 * t);
    pts.push(new THREE.Vector3(hw * 0.95 * (1 - t), yTop + (yMid - yTop) * s + 0.012 * Math.sin(t * Math.PI), z));
  }
  for (let i = top.length - 2; i >= 0; i--) {
    const t = top[i];
    const s = t * t * (3 - 2 * t);
    pts.push(new THREE.Vector3(-hw * 0.95 * (1 - t), yTop + (yMid - yTop) * s + 0.012 * Math.sin(t * Math.PI), z));
  }
  for (let i = side.length - 1; i >= 0; i--) pts.push(new THREE.Vector3(-side[i][0], side[i][1], z));
  pts.push(new THREE.Vector3(-0.62, ySill, z), new THREE.Vector3(-0.62, yFloor, z), new THREE.Vector3(0.62, yFloor, z), new THREE.Vector3(0.62, ySill, z));
  return pts;
}

const CAB_TOP = keyCurve([[-0.72, 0.86], [-0.45, 0.975], [-0.15, 1.085], [0.2, 1.155], [0.55, 1.165], [0.9, 1.12], [1.12, 1.03], [1.3, 0.945]]);

/** Greenhouse arc (open, from the right base over the roof to the left base). */
function cabinRing(z, a0 = 0, a1 = Math.PI, n = 13, grow = 0) {
  const yb = Y_TOP(z) - 0.015;
  const yr = Math.max(yb + 0.001, CAB_TOP(z));
  const hwc = HW(z) * 0.8;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (n - 1);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const X = Math.sign(c) * Math.pow(Math.abs(c), 0.62);
    const Y = Math.pow(Math.abs(s), 0.7);
    pts.push(new THREE.Vector3(X * hwc * (1 - 0.3 * Y) * (1 + grow), yb + (yr - yb) * Y + grow * 0.6, z));
  }
  return pts;
}

export function createCarModel(mats, { glowMat = null, paintMat = null } = {}) {
  const group = new THREE.Group();
  group.name = 'car';
  const body = new THREE.Group();
  body.name = 'car-body';
  group.add(body);
  const paint = paintMat || mats.paint;
  const glowM = glowMat || mats.glow;

  // ------------------------------------------------------------ body loft
  const P = new PartBuilder();
  const rings = [];
  const N = 46;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    // denser sampling near the ends (smooth nose/tail)
    const z = -2.38 + 4.76 * (u - Math.sin(u * Math.PI * 2) * 0.035);
    rings.push(bodyRing(z));
  }
  P.add(loft(rings), null, { color: 0xffffff });
  // painted roof over the glass
  const roofRings = [];
  for (let i = 0; i < 16; i++) {
    const z = -0.28 + (1.22 * i) / 15;
    roofRings.push(cabinRing(z, 0.2 * Math.PI, 0.8 * Math.PI, 9, 0.006));
  }
  P.add(loft(roofRings, { closed: false }), null, { color: 0xffffff });
  // mirrors
  for (const s of [-1, 1]) {
    P.box(0.15, 0.065, 0.11, M(s * 0.99, 0.935, -0.5, 0, s * 0.2, 0), { color: 0xffffff });
    P.add(strut([s * 0.8, 0.9, -0.48], [s * 0.93, 0.935, -0.5], 0.015, 5), null, { color: 0x404040 });
  }
  const paintMesh = P.mesh(paint, { name: 'car-paint' });

  // ------------------------------------------------------------ glass
  const Gl = new PartBuilder();
  const cab = [];
  for (let i = 0; i < 22; i++) {
    const z = -0.72 + (2.02 * i) / 21;
    cab.push(cabinRing(z));
  }
  Gl.add(loft(cab, { closed: false }));
  const glassMesh = Gl.mesh(mats.glass, { name: 'car-glass' });

  // ------------------------------------------------------------ carbon / trims
  const Cb = new PartBuilder();
  const carbon = 0xffffff;
  Cb.box(1.62, 0.035, 0.36, M(0, 0.235, -2.21), { color: carbon }); // splitter
  Cb.box(1.24, 0.09, 0.06, M(0, 0.3, -2.355, 0.25), { color: 0x777777 }); // lower grille
  for (const s of [-1, 1]) {
    Cb.box(0.07, 0.09, 1.82, M(s * 0.955, 0.27, 0), { color: carbon }); // side skirts
    Cb.box(0.07, 0.25, 0.56, M(s * 0.975, 0.57, 0.66, 0, s * -0.12, 0.12 * s), { color: 0x555555 }); // side intakes
    Cb.box(0.3, 0.08, 0.06, M(s * 0.6, 0.315, -2.34, 0.3), { color: 0x666666 }); // corner vents
  }
  Cb.box(1.56, 0.16, 0.42, M(0, 0.28, 2.2, -0.2), { color: carbon }); // diffuser
  for (const x of [-0.5, -0.17, 0.17, 0.5]) Cb.box(0.025, 0.18, 0.4, M(x, 0.27, 2.2, -0.2), { color: carbon });
  // rear wing
  Cb.box(1.76, 0.035, 0.34, M(0, 1.13, 2.1, 0.1), { color: carbon });
  for (const s of [-1, 1]) {
    Cb.box(0.03, 0.2, 0.36, M(s * 0.88, 1.08, 2.1), { color: carbon });
    Cb.add(strut([s * 0.5, 0.96, 2.04], [s * 0.5, 1.12, 2.1], 0.025, 5), null, { color: carbon });
  }
  // wheel-well liners (dark, read as depth inside the arches)
  for (const zw of [-CAR.wheelZ, CAR.wheelZ]) {
    for (const s of [-1, 1]) {
      const liner = flipFaces(new THREE.CylinderGeometry(ARCH_R - 0.01, ARCH_R - 0.01, 0.34, 18, 1, true, 0, Math.PI));
      Cb.add(liner, M(s * 0.79, CAR.wheelR, zw, 0, 0, Math.PI / 2), { color: 0x222222 });
    }
  }
  // rear: black mesh panel under the light bar, quad exhausts in the diffuser, engine-cover louvres
  Cb.box(1.2, 0.16, 0.03, M(0, 0.67, 2.388), { color: 0x2c2c2c });
  for (let i = 0; i < 4; i++) Cb.box(0.92, 0.022, 0.07, M(0, 0.958, 1.38 + i * 0.15, -0.08), { color: carbon });
  for (const s of [-1, 1]) {
    for (const dx of [0.22, 0.36]) Cb.add(new THREE.CylinderGeometry(0.055, 0.062, 0.16, 12), M(s * dx, 0.37, 2.36, Math.PI / 2), { color: 0xb0b0b0 });
  }
  const carbonMesh = Cb.mesh(mats.carbon, { name: 'car-carbon' });

  // ------------------------------------------------------------ lights
  const G = new PartBuilder();
  const head = hdr(0xd8f4ff, 4.2);
  const cyan = hdr(0x5fd4ff, 4);
  const red = hdr(0xff1010, 2.2);
  for (const s of [-1, 1]) {
    G.add(strip([s * 0.48, 0.53, -2.3], [s * 0.9, 0.63, -2.0], 0.05, 0.035), null, { color: head });
    G.add(strip([s * 0.86, 0.62, -2.04], [s * 0.9, 0.46, -2.15], 0.04, 0.03), null, { color: cyan });
    G.add(strip([s * 0.95, 0.37, -0.75], [s * 0.95, 0.37, 0.55], 0.02, 0.022), null, { color: cyan }); // side accent
    G.add(strip([s * 0.74, 0.85, 2.35], [s * 0.76, 0.66, 2.385], 0.04, 0.035), null, { color: red });
  }
  G.add(strip([-0.72, 0.8, 2.385], [0.72, 0.8, 2.385], 0.05, 0.035), null, { color: red });
  G.add(strip([-0.34, 0.37, -2.39], [0.34, 0.37, -2.39], 0.02, 0.02), null, { color: cyan });
  for (const s of [-1, 1]) for (const dx of [0.22, 0.36]) G.add(new THREE.CircleGeometry(0.042, 10), M(s * dx, 0.37, 2.441), { color: hdr(0xff7a2a, 2.4) });
  G.add(strip([-0.5, 0.56, 2.392], [0.5, 0.56, 2.392], 0.02, 0.018), null, { color: red });
  const glowMesh = G.mesh(glowM, { name: 'car-lights', castShadow: false, receiveShadow: false });

  // ------------------------------------------------------------ Ø decals on the doors
  const Dc = new PartBuilder();
  for (const s of [-1, 1]) Dc.add(new THREE.PlaneGeometry(0.44, 0.44), M(s * 0.958, 0.64, -0.06, 0, (s * Math.PI) / 2, 0));
  const decalMesh = Dc.mesh(mats.decal, { name: 'car-emblem', castShadow: false });
  decalMesh.renderOrder = 1;

  body.add(paintMesh, glassMesh, carbonMesh, glowMesh, decalMesh);

  // ------------------------------------------------------------ wheels (instanced)
  const R = CAR.wheelR;
  const tyreGeo = latheX([[0.245, -0.15], [0.31, -0.158], [0.345, -0.145], [0.36, -0.11], [0.362, 0], [0.36, 0.11], [0.345, 0.145], [0.31, 0.158], [0.245, 0.15]], 28);
  const RB = new PartBuilder();
  RB.add(new THREE.CylinderGeometry(0.248, 0.248, 0.27, 24, 1, true), M(0, 0, 0, 0, 0, Math.PI / 2), { color: 0x30333a });
  RB.add(new THREE.CylinderGeometry(0.205, 0.205, 0.024, 24), M(-0.01, 0, 0, 0, 0, Math.PI / 2), { color: 0x5a5d63 }); // disc
  RB.add(new THREE.TorusGeometry(0.236, 0.013, 6, 28), M(0.128, 0, 0, 0, Math.PI / 2, 0), { color: 0xc8ccd2 });
  RB.add(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 12), M(0.12, 0, 0, 0, 0, Math.PI / 2), { color: 0x9a9da3 });
  for (let k = 0; k < 5; k++) {
    for (const off of [-0.11, 0.11]) {
      const a = (k / 5) * Math.PI * 2 + off;
      RB.box(0.032, 0.19, 0.04, M(0.112, Math.cos(a) * 0.14, Math.sin(a) * 0.14, a, 0, 0), { color: 0x24272c });
    }
  }
  const rimGeo = RB.build();
  const CL = new PartBuilder();
  CL.box(0.07, 0.15, 0.11, M(0.045, 0.13, -0.11, 0.6), { color: 0xd04a1c });
  const caliperGeo = CL.build();
  const tyres = new THREE.InstancedMesh(tyreGeo, mats.rubber, 4);
  const rims = new THREE.InstancedMesh(rimGeo, mats.rim, 4);
  const calipers = new THREE.InstancedMesh(caliperGeo, mats.dark, 4);
  for (const m of [tyres, rims, calipers]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // tiny, always near its car
  }
  tyres.name = 'car-tyres';
  rims.name = 'car-rims';
  calipers.name = 'car-calipers';
  group.add(tyres, rims, calipers);
  const wheelPos = [
    [-CAR.wheelX, R, -CAR.wheelZ],
    [CAR.wheelX, R, -CAR.wheelZ],
    [-CAR.wheelX, R, CAR.wheelZ],
    [CAR.wheelX, R, CAR.wheelZ],
  ];
  const _m = new THREE.Matrix4();
  const _mc = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _qs = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _one = new THREE.Vector3(1, 1, 1);
  const wheels = {
    pos: wheelPos,
    radius: R,
    /** steer (rad, + = left), spin (rad), drops: per-wheel y offsets (suspension). */
    setPose(steer = 0, spin = 0, drops = null) {
      for (let i = 0; i < 4; i++) {
        const left = wheelPos[i][0] < 0;
        const front = i < 2;
        _e.set(0, (front ? steer : 0) + (left ? Math.PI : 0), 0);
        _q.setFromEuler(_e);
        _p.set(wheelPos[i][0], wheelPos[i][1] + (drops ? drops[i] : 0), wheelPos[i][2]);
        _mc.compose(_p, _q, _one);
        calipers.setMatrixAt(i, _mc);
        _e.set(left ? spin : -spin, 0, 0);
        _qs.setFromEuler(_e);
        _q.multiply(_qs);
        _m.compose(_p, _q, _one);
        tyres.setMatrixAt(i, _m);
        rims.setMatrixAt(i, _m);
      }
      tyres.instanceMatrix.needsUpdate = true;
      rims.instanceMatrix.needsUpdate = true;
      calipers.instanceMatrix.needsUpdate = true;
    },
  };
  wheels.setPose(0, 0);

  // ------------------------------------------------------------ underglow + beams
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 6.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: hdr(0x5fd4ff, 0.35), map: mats.tex.radial, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  under.position.y = 0.04;
  under.name = 'car-underglow';
  under.renderOrder = 2;
  group.add(under);
  const beamMat = new THREE.MeshBasicMaterial({ color: hdr(0xdff2ff, 0.32), map: mats.tex.beam, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beams = new THREE.Group();
  beams.name = 'car-beams';
  for (const s of [-1, 1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 16, 18, 1, true).translate(0, -8, 0).rotateX(Math.PI / 2 - 0.08), beamMat);
    // cone apex at the lamp, opening forward (−Z); texture v=1 at the apex
    cone.position.set(s * 0.7, 0.62, -2.25);
    beams.add(cone);
  }
  beams.visible = false;
  group.add(beams);

  group.userData = {
    body,
    paint,
    glowMat: glowM,
    wheels,
    underglow: under,
    lights: { beams, beamMat },
    length: CAR.length,
    width: CAR.width,
    bounds: new THREE.Box3(new THREE.Vector3(-1.04, 0, -2.42), new THREE.Vector3(1.04, 1.2, 2.42)),
    height: CAR.height,
    door: new THREE.Vector3(-1.05, 0.6, -0.1),
    type: 'car',
  };
  return group;
}
