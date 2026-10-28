/**
 * Vehicles — "Luchtvoertuig": black tilt-rotor VTOL (16_vtol_flight,
 * 22_vehicle_sheet, 13_player_base). Faceted armoured fuselage with a
 * panel-seam hull, dark glass canopy, big white Ø on the dorsal plate, stub
 * wings carrying two large ducted rotors (orange light strips, five blades,
 * motion-blur disc), twin canted tail fins, rear engine glow, blue nav lights
 * and a retractable tricycle landing gear.
 *
 * createVtolModel(mats, { armorMat, glowMat }) → THREE.Group (front −Z, origin
 * on the ground under the gear). userData: nacelles [L, R] (tilt about X),
 * rotors [L, R] (spin about Y), blades/discs (swap with rotor speed via
 * setRotor(speed01, dt)), gear (Group; setGear(0…1)), engines (Object3D[]),
 * length, span, door.
 */
import * as THREE from 'three';
import { PartBuilder, M, loft, chamferSection, latheY, latheZ, strip, strut } from './geo.js';
import { hdr } from './materials.js';

const DUCT_X = 4.38;
const DUCT_Y = 1.62;
const DUCT_Z = 0.35;

export function createVtolModel(mats, { armorMat = null, glowMat = null } = {}) {
  const armor = armorMat || mats.armor;
  const glowM = glowMat || mats.glow;
  const group = new THREE.Group();
  group.name = 'vtol';
  const A = new PartBuilder(); // armour hull
  const D = new PartBuilder(); // dark trims
  const G = new PartBuilder(); // glow
  const Gl = new PartBuilder(); // glass
  const hullC = 0x2a2e35;
  const hullC2 = 0x343941;
  const orange = hdr(0xff8a3a, 6);
  const blue = hdr(0x5fc8ff, 6);

  // ------------------------------------------------------------ fuselage
  const st = [
    [-5.3, 0.3, 0.22, 0.26, 0.4, 1.0],
    [-4.75, 0.85, 0.55, 0.5, 0.36, 1.02],
    [-3.7, 1.18, 0.92, 0.72, 0.32, 1.08],
    [-2.3, 1.34, 1.12, 0.84, 0.3, 1.12],
    [-0.6, 1.4, 1.2, 0.9, 0.3, 1.12],
    [1.4, 1.36, 1.16, 0.86, 0.3, 1.12],
    [2.9, 1.08, 0.98, 0.66, 0.32, 1.18],
    [4.25, 0.72, 0.74, 0.46, 0.34, 1.28],
    [5.25, 0.5, 0.56, 0.34, 0.36, 1.34],
  ];
  A.add(loft(st.map(([z, hw, t, b, ch, cy]) => chamferSection(z, hw, t, b, ch, cy)), { flat: true }), null, { color: hullC });
  // dorsal plate (Ø sits on it) + spine
  A.box(1.5, 0.16, 3.6, M(0, 2.36, 0.25), { color: hullC2 });
  A.box(0.5, 0.3, 2.2, M(0, 2.3, 2.9, 0.12), { color: hullC2 });
  // armour side plates + chin
  for (const s of [-1, 1]) {
    A.box(0.16, 0.7, 3.2, M(s * 1.39, 1.25, -0.4, 0, s * 0.03, 0), { color: hullC2 });
    A.box(0.5, 0.35, 1.8, M(s * 0.95, 0.38, -2.6, 0, 0, s * 0.35), { color: hullC2 });
    D.box(0.12, 0.42, 1.0, M(s * 1.44, 1.3, 1.6), { color: 0x101215 }); // side door recess
    G.add(strip([s * 1.47, 0.98, -1.6], [s * 1.47, 0.98, 0.9], 0.03, 0.04), null, { color: orange });
    G.add(strip([s * 0.62, 0.82, -5.05], [s * 0.95, 0.9, -4.55], 0.04, 0.05), null, { color: blue });
  }
  D.box(1.2, 0.2, 5.4, M(0, 0.24, -0.2), { color: 0x15171a }); // belly
  for (const s of [-1, 1]) {
    G.box(0.16, 0.06, 0.16, M(s * 0.35, 0.33, -3.9), { color: hdr(0xeaf6ff, 7) }); // landing lights
    G.add(strip([s * 1.15, 0.5, -2.6], [s * 1.25, 0.62, 1.4], 0.03, 0.035), null, { color: orange });
  }

  // ------------------------------------------------------------ canopy
  const canopy = [];
  const cz = [-4.55, -4.1, -3.4, -2.6, -1.9, -1.5];
  const ch = [0.0, 0.32, 0.52, 0.56, 0.42, 0.0];
  cz.forEach((z, i) => {
    const s = st.find((r) => r[0] >= z) || st[3];
    const baseY = s[5] + s[2] * 0.55;
    const hw = s[1] * 0.78;
    const ring = [];
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * Math.PI;
      ring.push(new THREE.Vector3(Math.cos(a) * hw * (1 - 0.25 * Math.sin(a)), baseY + Math.sin(a) * (ch[i] + 0.12) + 0.02, z));
    }
    canopy.push(ring);
  });
  Gl.add(loft(canopy, { closed: false, flat: true }));
  D.add(strip([0, 2.0, -3.5], [0, 2.32, -2.0], 0.08, 0.06), null, { color: 0x111111 }); // canopy frame

  // ------------------------------------------------------------ wings
  for (const s of [-1, 1]) {
    A.box(1.05, 0.3, 1.7, M(s * 1.72, 1.55, DUCT_Z, 0, 0, s * -0.05), { color: hullC });
    A.box(0.7, 0.5, 2.0, M(s * 1.6, 1.5, DUCT_Z + 0.1), { color: hullC2 });
    G.add(strip([s * 1.6, 1.72, DUCT_Z - 0.87], [s * 2.0, 1.72, DUCT_Z - 0.87], 0.04, 0.03), null, { color: orange });
  }

  // ------------------------------------------------------------ tail
  for (const s of [-1, 1]) {
    A.box(0.12, 1.35, 1.2, M(s * 0.55, 2.25, 4.7, -0.32, 0, s * -0.32), { color: hullC });
    A.box(1.7, 0.1, 0.85, M(s * 1.15, 1.52, 4.95, 0, s * -0.12, 0), { color: hullC });
    G.add(strip([s * 0.72, 2.92, 4.98], [s * 0.82, 2.95, 5.15], 0.05, 0.05), null, { color: hdr(s < 0 ? 0xff3030 : 0x30ff70, 5) });
  }
  // twin turbine pods on the rear flanks: armoured cowling, dark nozzle, orange afterglow
  const POD_X = 1.02;
  const POD_Y = 1.22;
  for (const s of [-1, 1]) {
    A.add(latheZ([[0.05, 2.0], [0.3, 2.1], [0.46, 2.6], [0.5, 3.6], [0.47, 4.8], [0.41, 5.32]], 14), M(s * POD_X, POD_Y, 0), { color: hullC2 });
    D.add(latheZ([[0.41, 5.32], [0.36, 5.36], [0.3, 5.2], [0.12, 5.05]], 14), M(s * POD_X, POD_Y, 0), { color: 0x0c0d0f });
    G.add(new THREE.RingGeometry(0.18, 0.31, 16), M(s * POD_X, POD_Y, 5.22), { color: orange });
    G.add(new THREE.CircleGeometry(0.17, 12), M(s * POD_X, POD_Y, 5.12), { color: hdr(0xffb070, 3.5) });
    // intake lip + armour strakes
    D.add(new THREE.TorusGeometry(0.31, 0.05, 6, 14), M(s * POD_X, POD_Y, 2.12), { color: 0x16181b });
    A.box(0.08, 0.34, 2.2, M(s * (POD_X + 0.47), POD_Y + 0.02, 3.7), { color: hullC });
    G.add(strip([s * (POD_X + 0.52), POD_Y - 0.08, 3.0], [s * (POD_X + 0.52), POD_Y - 0.08, 4.6], 0.03, 0.04), null, { color: orange });
    // ventral fins under the tail
    A.box(0.1, 0.95, 1.35, M(s * 0.62, 0.6, 4.25, 0.32, 0, s * 0.42), { color: hullC });
    G.add(strip([s * 0.86, 0.22, 4.55], [s * 0.86, 0.22, 4.95], 0.04, 0.04), null, { color: orange });
  }
  // rear light bar + tail cap
  D.box(0.95, 0.5, 0.16, M(0, 1.36, 5.24), { color: 0x0e0f11 });
  G.add(strip([-0.38, 1.17, 5.33], [0.38, 1.17, 5.33], 0.05, 0.06), null, { color: orange });
  G.add(strip([-0.3, 1.52, 5.33], [0.3, 1.52, 5.33], 0.03, 0.035), null, { color: hdr(0xff2a20, 4) });
  const engines = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Object3D();
    e.position.set(s * POD_X, POD_Y, 5.4);
    engines.push(e);
    group.add(e);
  }

  // ------------------------------------------------------------ nacelles (ducted rotors)
  const nacelles = [];
  const rotors = [];
  const bladeMeshes = [];
  const discs = [];
  const ductProfile = [[1.8, 0.4], [1.78, -0.38], [1.98, -0.46], [2.24, -0.38], [2.3, 0], [2.24, 0.38], [1.98, 0.47], [1.8, 0.4]];
  const discMat = new THREE.MeshBasicMaterial({ map: mats.tex.rotor, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 });
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? 'vtol-nacelle-l' : 'vtol-nacelle-r';
    pivot.position.set(s * DUCT_X, DUCT_Y, DUCT_Z);
    const NA = new PartBuilder();
    const ND = new PartBuilder();
    const NG = new PartBuilder();
    NA.add(latheY(ductProfile.slice().reverse(), 40), null, { color: hullC });
    // pylon joining the wing
    NA.box(0.9, 0.55, 1.4, M(-s * 2.25, 0, 0), { color: hullC2 });
    // stator struts + hub
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
      ND.add(strut([Math.cos(a) * 0.3, -0.18, Math.sin(a) * 0.3], [Math.cos(a) * 1.8, -0.18, Math.sin(a) * 1.8], 0.05, 5), null, { color: 0x202226 });
    }
    ND.add(new THREE.CylinderGeometry(0.34, 0.3, 0.55, 16), M(0, -0.05, 0), { color: 0x2a2d32 });
    ND.add(new THREE.ConeGeometry(0.2, 0.3, 14), M(0, 0.38, 0), { color: 0x3a3e45 });
    // light strips on the outer wall (orange) + lower ring
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.26;
      NG.box(0.05, 0.11, 0.85, M(Math.cos(a) * 2.315, 0.02, Math.sin(a) * 2.315, 0, -a, 0), { color: orange });
    }
    NG.add(new THREE.TorusGeometry(1.86, 0.025, 4, 48), M(0, -0.36, 0, Math.PI / 2), { color: hdr(0xff9a4a, 2.5) });
    pivot.add(NA.mesh(armor, { name: 'vtol-duct' }), ND.mesh(mats.dark, { name: 'vtol-hub' }), NG.mesh(glowM, { name: 'vtol-duct-lights', castShadow: false }));
    // rotor
    const rotor = new THREE.Group();
    rotor.position.y = 0.12;
    const BL = new PartBuilder();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      BL.box(1.42, 0.035, 0.26, M(Math.cos(a) * 1.04, 0, -Math.sin(a) * 1.04, 0.32, a, 0, 1, 'YXZ'), { color: 0x2b2e33 });
    }
    const blades = BL.mesh(mats.dark, { name: 'vtol-blades' });
    rotor.add(blades);
    pivot.add(rotor);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.77, 40).rotateX(-Math.PI / 2), discMat);
    disc.position.y = 0.12;
    disc.renderOrder = 3;
    disc.visible = false;
    disc.name = 'vtol-rotor-blur';
    pivot.add(disc);
    group.add(pivot);
    nacelles.push(pivot);
    rotors.push(rotor);
    bladeMeshes.push(blades);
    discs.push(disc);
  }

  // ------------------------------------------------------------ landing gear
  const gear = new THREE.Group();
  gear.name = 'vtol-gear';
  const GR = new PartBuilder();
  const legs = [[0, -3.3], [-1.05, 2.0], [1.05, 2.0]];
  for (const [x, z] of legs) {
    GR.add(strut([x, 0.62, z], [x, 0.2, z], 0.07, 6), null, { color: 0x3a3e45 });
    GR.add(strut([x, 0.62, z - 0.25], [x, 0.3, z], 0.035, 5), null, { color: 0x6a6e75 });
    GR.add(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 14), M(x, 0.19, z, 0, 0, Math.PI / 2), { color: 0x111214 });
  }
  gear.add(GR.mesh(mats.dark, { name: 'vtol-gear' }));
  group.add(gear);

  // ------------------------------------------------------------ Ø decal (dorsal)
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25).rotateX(-Math.PI / 2), mats.decal);
  decal.position.set(0, 2.445, 0.1);
  decal.renderOrder = 1;
  decal.name = 'vtol-emblem';

  group.add(A.mesh(armor, { name: 'vtol-hull' }), D.mesh(mats.dark, { name: 'vtol-trim' }), G.mesh(glowM, { name: 'vtol-lights', castShadow: false }), Gl.mesh(mats.glass, { name: 'vtol-glass' }), decal);

  let gearK = 1;
  let rotorAngle = 0;
  group.userData = {
    type: 'vtol',
    nacelles,
    rotors,
    discs,
    gear,
    engines,
    length: 10.6,
    span: 2 * (DUCT_X + 2.3),
    door: new THREE.Vector3(-1.6, 1.0, 1.6),
    /** speed01: 0 idle … 1 full power. Spins the rotors and swaps in the blur disc. */
    setRotor(speed01, dt) {
      rotorAngle += dt * (2 + speed01 * 38);
      rotors[0].rotation.y = rotorAngle;
      rotors[1].rotation.y = -rotorAngle;
      const blur = speed01 > 0.3;
      for (let i = 0; i < 2; i++) {
        bladeMeshes[i].visible = !blur;
        discs[i].visible = blur;
        discs[i].rotation.y = rotorAngle * 0.07 * (i ? -1 : 1);
      }
      discMat.opacity = Math.min(0.9, 0.4 + speed01 * 0.5);
    },
    setGear(k) {
      gearK = Math.max(0, Math.min(1, k));
      gear.visible = gearK > 0.03;
      gear.scale.set(1, gearK, 1);
      gear.position.y = (1 - gearK) * 0.6;
    },
    get gearK() {
      return gearK;
    },
    /** Tilts both nacelles (rad, + = rotor discs lean forward). */
    setTilt(a) {
      nacelles[0].rotation.x = -a;
      nacelles[1].rotation.x = -a;
    },
  };
  return group;
}
