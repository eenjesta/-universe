/**
 * Vehicles — colony ship ("Kolonieschip") model: an enormous modular carrier
 * after 07_space_battle / 18_colony_landing / 22_vehicle_sheet — armoured
 * bow with a lit bridge band, a chain of faceted habitat drums and cargo
 * container blocks on a spine, a command tower with a white Ø, a habitat
 * ring, a heavy engine block with four nozzles, belly lifters with blue
 * glow and six landing legs. Lit windows come from the object-space window
 * shader (no textures). ~6 draw calls, ~10k triangles.
 *
 *   import { createColonyShipModel } from '../vehicles/colony-model.js';
 *   const ship = createColonyShipModel({ length: 150, legs: true });
 *
 * opts: { length = 150, legs = true (build + deploy landing legs), lights = 1
 *         (window/strip brightness multiplier), lifters = 0.25 (belly glow) }
 * Front is −Z, origin on the hull centre line.
 * userData: engines (Object3D[] at the four rear nozzles; local +Z = exhaust
 *   direction = world +Z of the ship), lifters (Object3D[] under the belly;
 *   local +Z points down), groundOffset (metres from
 *   the origin down to the bottom of the deployed feet, already scaled),
 *   length, setLegs(0…1), setLifters(0…1), update(dt, t) (blinking nav
 *   lights; optional), dispose().
 */
import * as THREE from 'three';
import { Rng } from '../core/math.js';
import { PartBuilder, M, loft, chamferSection, latheZ, strut } from './geo.js';
import { patchMaterial, vehicleTextures, hdr } from './materials.js';

const BASE_LEN = 150;
let MATS = null;

function colonyMaterials() {
  if (MATS) return MATS;
  const tex = vehicleTextures();
  const hull = new THREE.MeshStandardMaterial({ name: 'colony-hull', color: 0xffffff, vertexColors: true, metalness: 0.5, roughness: 0.52, envMapIntensity: 1 });
  patchMaterial(hull, { panels: { size: [5.6, 2.6], variation: 0.2, seam: 0.5, seamWidth: 0.08 }, windows: { color: 0xffc98a, gain: 1.8, cell: [1.25, 1.9] } });
  const dark = new THREE.MeshStandardMaterial({ name: 'colony-dark', color: 0xffffff, vertexColors: true, metalness: 0.6, roughness: 0.55 });
  patchMaterial(dark, { panels: { size: [1.6, 1.2], variation: 0.25, seam: 0.3, seamWidth: 0.05 } });
  const glow = new THREE.MeshBasicMaterial({ name: 'colony-glow', color: 0xffffff, vertexColors: true });
  const strobe = new THREE.MeshBasicMaterial({ name: 'colony-strobe', color: 0xffffff, vertexColors: true });
  const engine = new THREE.MeshBasicMaterial({ name: 'colony-engine', color: hdr(0x9fd2ff, 2.4), map: tex.radial, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const lifter = new THREE.MeshBasicMaterial({ name: 'colony-lifter', color: hdr(0x8cc8ff, 1.6), map: tex.radial, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.25 });
  const decal = new THREE.MeshStandardMaterial({ name: 'colony-decal', map: tex.emblem, transparent: true, depthWrite: false, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, emissive: 0xffffff, emissiveMap: tex.emblem, emissiveIntensity: 0.35 });
  MATS = { hull, dark, glow, strobe, engine, lifter, decal };
  return MATS;
}

const C = {
  light: 0x8b9199,
  light2: 0x989a97,
  mid: 0x767c84,
  warm: 0x8e877b,
  rust: 0x8a5a3c,
  blue: 0x4f5d70,
  dark: 0x3a3e45,
  darker: 0x24272c,
};

/** Faceted drum along Z (flat-shaded prism). */
function drum(r, len, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / seg);
  const ng = g.toNonIndexed();
  g.dispose();
  ng.computeVertexNormals();
  return ng;
}

export function createColonyShipModel(opts = {}) {
  const length = opts.length ?? BASE_LEN;
  const withLegs = opts.legs !== false;
  const lightK = opts.lights ?? 1;
  const mats = colonyMaterials();
  const rng = new Rng('kolonieschip');
  const H = new PartBuilder();
  const D = new PartBuilder();
  const G = new PartBuilder();
  const S = new PartBuilder();
  const group = new THREE.Group();
  group.name = 'colony-ship';
  const inner = new THREE.Group(); // modelled at 150 m, scaled to `length`
  group.add(inner);
  const amber = hdr(0xffb35a, 3.2 * lightK);
  const warmWin = hdr(0xffd9a6, 3.4 * lightK);
  const cyan = hdr(0x7fdcff, 3 * lightK);

  // ------------------------------------------------------------ bow
  H.add(
    loft(
      [
        chamferSection(-76, 7.4, 3.2, 4.4, 0.22, 0.8),
        chamferSection(-72.5, 11.4, 6.2, 6.8, 0.2, 0.4),
        chamferSection(-63, 13.4, 8.4, 8.0, 0.2, 0),
        chamferSection(-47, 13.4, 8.6, 8.2, 0.2, 0),
      ],
      { flat: true },
    ),
    null,
    { color: C.light, win: 0.2 },
  );
  // bridge window band + nose plating
  G.box(15.5, 0.5, 0.5, M(0, 4.7, -72.8, -0.72), { color: warmWin });
  G.box(12.5, 0.3, 0.4, M(0, 3.7, -74.3, -0.72), { color: warmWin });
  D.box(6, 1.2, 6, M(0, -3.8, -70), { color: C.dark });
  // bow face: dark visor plate, bridge windows, floodlights
  D.box(12.6, 6.2, 0.6, M(0, 0.7, -76.05), { color: C.darker });
  G.box(10.4, 0.5, 0.3, M(0, 2.55, -76.4), { color: warmWin });
  G.box(8.2, 0.34, 0.3, M(0, 1.65, -76.4), { color: warmWin });
  for (const s of [-1, 1]) {
    G.add(new THREE.CircleGeometry(0.75, 16), M(s * 4.9, -1.5, -76.4, 0, Math.PI, 0), { color: hdr(0xeaf4ff, 5 * lightK) });
    G.add(new THREE.CircleGeometry(0.45, 12), M(s * 3.3, -1.5, -76.4, 0, Math.PI, 0), { color: hdr(0xeaf4ff, 3.5 * lightK) });
    D.box(0.5, 5.6, 0.9, M(s * 6.6, 0.7, -76.0), { color: C.mid });
  }
  for (const s of [-1, 1]) {
    D.box(1.2, 3.2, 9, M(s * 12.9, 0, -58, 0, s * 0.05, 0), { color: C.dark });
    G.box(0.2, 0.25, 7.5, M(s * 13.55, -1.4, -58), { color: amber });
  }
  D.box(26.6, 1.4, 1.2, M(0, 0, -47), { color: C.dark });

  // ------------------------------------------------------------ spine + keel
  D.add(drum(7.6, 104, 10), M(0, 0, 2), { color: C.dark });
  D.box(10, 3, 92, M(0, -8.6, -2), { color: C.darker });
  for (const s of [-1, 1]) D.box(1.2, 1.2, 100, M(s * 5.2, -10.3, 0), { color: C.mid });

  // ------------------------------------------------------------ modules
  const drumMod = (z0, z1, r, win, color) => {
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    H.add(drum(r, len - 2.4), M(0, 0, zc), { color, win });
    for (const zz of [z0 + 0.7, z1 - 0.7]) D.add(drum(r + 0.9, 1.4), M(0, 0, zz), { color: C.dark });
    // longitudinal rails
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      D.box(0.9, 0.6, len - 3, M(Math.cos(a) * (r + 0.2), Math.sin(a) * (r + 0.2), zc, 0, 0, a + Math.PI / 2), { color: C.mid });
    }
    // amber running lights along the flanks
    for (let z = z0 + 3; z < z1 - 2; z += 4) for (const s of [-1, 1]) G.box(0.3, 0.3, 0.3, M(s * (r + 0.35), -r * 0.35, z), { color: amber });
  };
  const flange = (z, hw) => D.add(loft([chamferSection(z - 0.5, hw, hw, hw, 0.3), chamferSection(z + 0.5, hw, hw, hw, 0.3)], { flat: true }), null, { color: C.dark });
  const cargoMod = (z0, z1, palette) => {
    const zc = (z0 + z1) / 2;
    const len = z1 - z0 - 2;
    const cols = palette;
    H.box(15, 7, len, M(0, 11.2, zc), { color: cols[0] });
    H.box(15, 7, len, M(0, -11.2, zc), { color: cols[1] });
    for (const s of [-1, 1]) {
      H.box(7, 15, len, M(s * 11.2, 0, zc), { color: cols[s > 0 ? 2 : 3] });
      // container doors / ribs
      for (let z = z0 + 2.5; z < z1 - 1.5; z += 2.6) D.box(0.4, 13.5, 0.35, M(s * 14.85, 0, z), { color: C.darker });
    }
    for (let z = z0 + 2.5; z < z1 - 1.5; z += 2.6) {
      D.box(13.5, 0.4, 0.35, M(0, 14.85, z), { color: C.darker });
    }
    flange(z0 + 0.6, 16.2);
    flange(z1 - 0.6, 16.2);
  };
  drumMod(-46, -30, 12.6, 0.55, C.light);
  cargoMod(-30, -14, [C.warm, C.blue, C.rust, C.mid]);
  drumMod(-14, 6, 13.6, 0.62, C.light2);
  cargoMod(6, 22, [C.mid, C.rust, C.warm, C.blue]);
  drumMod(22, 40, 12.6, 0.45, C.light);

  // side habitat pods
  for (const s of [-1, 1]) {
    for (const [zc, len] of [[-4, 13], [31, 11]]) {
      H.box(4.2, 7, len, M(s * 15.6, -1.2, zc), { color: C.light2, win: 0.7 });
      D.box(4.6, 0.8, len + 0.6, M(s * 15.6, 2.5, zc), { color: C.dark });
      G.box(0.15, 0.25, len - 1, M(s * 17.75, -4.2, zc), { color: cyan });
    }
  }

  // ------------------------------------------------------------ ring section
  D.add(drum(10.5, 12, 10), M(0, 0, 46), { color: C.dark });
  for (const zz of [40.6, 51.4]) D.add(drum(11.6, 1.2, 10), M(0, 0, zz), { color: C.mid });
  const torus = new THREE.TorusGeometry(23, 1.7, 8, 56);
  H.add(torus, M(0, 0, 46), { color: C.light, win: 0.5 });
  const torus2 = new THREE.TorusGeometry(23, 0.5, 6, 56);
  D.add(torus2, M(0, 0, 47.9), { color: C.dark });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    D.add(strut([Math.cos(a) * 10, Math.sin(a) * 10, 46], [Math.cos(a) * 21.6, Math.sin(a) * 21.6, 46], 0.9, 6), null, { color: C.mid });
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    G.box(0.35, 0.35, 0.35, M(Math.cos(a) * 24.75, Math.sin(a) * 24.75, 46), { color: k % 6 === 0 ? cyan : amber });
  }

  // ------------------------------------------------------------ engine block
  H.add(
    loft(
      [
        chamferSection(52, 13.5, 9.2, 8.6, 0.3),
        chamferSection(55, 14.4, 9.8, 9.2, 0.3),
        chamferSection(66, 14.4, 9.8, 9.2, 0.3),
        chamferSection(69, 13.4, 9.0, 8.4, 0.34),
      ],
      { flat: true },
    ),
    null,
    { color: C.mid, win: 0.12 },
  );
  for (const s of [-1, 1]) {
    D.box(2.4, 14, 10, M(s * 15.2, 0, 60.5), { color: C.dark });
    G.box(0.2, 12, 0.3, M(s * 16.45, 0, 56), { color: amber });
    G.box(0.2, 12, 0.3, M(s * 16.45, 0, 65), { color: amber });
  }
  const engines = [];
  const nozzleProfile = [[2.9, 67.5], [3.6, 70], [4.25, 73], [4.45, 75], [4.05, 75.2], [3.6, 73.1], [3.0, 70.6], [2.3, 69.6], [0.01, 69.6]];
  const nozzlePos = [[-6.6, 3.9], [6.6, 3.9], [-6.6, -4.3], [6.6, -4.3]];
  const discGeo = new THREE.CircleGeometry(3.6, 24);
  const engineGlow = new PartBuilder();
  for (const [x, y] of nozzlePos) {
    D.add(latheZ(nozzleProfile, 20), M(x, y, 0), { color: C.dark });
    G.add(new THREE.TorusGeometry(3.0, 0.22, 6, 24), M(x, y, 69.8), { color: hdr(0x9fd2ff, 5 * lightK) });
    engineGlow.add(discGeo.clone(), M(x, y, 69.75), { color: 0xffffff });
    engineGlow.add(discGeo.clone(), M(x, y, 72.5, 0, 0, 0, 1.25), { color: 0x9a9a9a });
    const e = new THREE.Object3D();
    e.name = 'colony-engine';
    e.position.set(x, y, 75.4);
    inner.add(e);
    engines.push(e);
  }
  discGeo.dispose();

  // ------------------------------------------------------------ command tower
  H.box(12, 6, 18, M(0, 15.2, -36), { color: C.light2, win: 0.35 });
  H.box(8.4, 12, 10, M(0, 23.6, -35), { color: C.light, win: 0.55 });
  H.add(loft([chamferSection(-39.5, 8.2, 2.2, 2.2, 0.4, 31.6), chamferSection(-30.5, 8.2, 2.2, 2.2, 0.4, 31.6)], { flat: true }), null, { color: C.light2 });
  G.box(16.6, 0.6, 9.2, M(0, 32.1, -35), { color: warmWin });
  D.box(6, 1.5, 6, M(0, 34.4, -34), { color: C.dark });
  D.add(strut([2, 35, -33], [2, 41.5, -33], 0.22, 5), null, { color: C.mid });
  D.add(strut([-2.4, 35, -35.5], [-2.4, 39, -35.5], 0.18, 5), null, { color: C.mid });
  D.add(new THREE.CylinderGeometry(1.8, 0.3, 0.8, 12), M(-4.5, 35.8, -32, 0.5, 0, 0.3), { color: C.mid });
  S.box(0.6, 0.6, 0.6, M(2, 41.9, -33), { color: hdr(0xff3a2a, 6) });
  S.box(0.5, 0.5, 0.5, M(-2.4, 39.3, -35.5), { color: hdr(0xffffff, 6) });

  // ------------------------------------------------------------ greebles on top
  for (let i = 0; i < 70; i++) {
    const z = rng.range(-44, 38);
    if (z > -40 && z < -27) continue; // tower base
    const a = rng.range(-0.9, 0.9) + Math.PI / 2;
    const r = z < -30 || (z > -14 && z < 6) || z > 22 ? 12.6 : 14.6;
    const w = rng.range(0.8, 2.6);
    const h = rng.range(0.5, 1.8);
    const d = rng.range(1, 4.5);
    D.box(w, h, d, M(Math.cos(a) * (r + h / 2 - 0.2), Math.sin(a) * (r + h / 2 - 0.2), z, 0, 0, a - Math.PI / 2), { color: rng.chance(0.3) ? C.mid : C.dark });
  }

  // ------------------------------------------------------------ nav lights / strobes
  S.box(0.8, 0.8, 0.8, M(-13.4, 0, -60), { color: hdr(0xff2a20, 6) });
  S.box(0.8, 0.8, 0.8, M(13.4, 0, -60), { color: hdr(0x2aff70, 6) });
  for (const s of [-1, 1]) S.box(0.7, 0.7, 0.7, M(s * 14.5, 9.6, 68), { color: hdr(0xffffff, 7) });
  S.box(0.7, 0.7, 0.7, M(0, -9.9, -48), { color: hdr(0xffffff, 7) });

  // ------------------------------------------------------------ belly lifters
  const lifters = [];
  const lifterGlow = new PartBuilder();
  const lglow = new THREE.CircleGeometry(2.6, 20).rotateX(Math.PI / 2);
  for (const z of [-38, 0, 30]) {
    for (const s of [-1, 1]) {
      D.add(new THREE.CylinderGeometry(2.2, 2.6, 1.6, 14), M(s * 7.8, -10.6, z), { color: C.dark });
      G.add(new THREE.TorusGeometry(1.9, 0.16, 5, 18), M(s * 7.8, -11.45, z, Math.PI / 2), { color: hdr(0x8cc8ff, 4 * lightK) });
      lifterGlow.add(lglow.clone(), M(s * 7.8, -11.5, z), { color: 0xffffff });
      const o = new THREE.Object3D();
      o.name = 'colony-lifter';
      o.position.set(s * 7.8, -11.5, z);
      o.rotation.x = Math.PI / 2; // local −Z… looks down
      inner.add(o);
      lifters.push(o);
    }
  }
  lglow.dispose();

  // ------------------------------------------------------------ landing legs
  const legGroups = [];
  if (withLegs) {
    const legMat = mats.dark;
    for (const z of [-40, 0, 34]) {
      for (const s of [-1, 1]) {
        const L = new PartBuilder();
        const knee = [s * 8.4, -7.2, 0];
        const foot = [s * 6.6, -18.6, 0];
        L.add(strut([0, 0, -1.6], knee, 1.15, 8), null, { color: C.mid });
        L.add(strut([0, 0, 1.6], knee, 1.15, 8), null, { color: C.mid });
        L.add(strut(knee, foot, 0.95, 8), null, { color: C.dark });
        L.add(strut([s * -3.6, -1.5, 0], [s * 7.2, -9.4, 0], 0.42, 6), null, { color: 0x9a9ea4 });
        L.add(new THREE.SphereGeometry(1.5, 10, 8), M(...knee), { color: C.dark });
        L.add(new THREE.CylinderGeometry(2.6, 3.3, 1.3, 14), M(foot[0], foot[1] - 0.35, 0), { color: C.dark });
        L.box(1.6, 2.4, 3.6, M(0, -0.4, 0), { color: C.dark });
        const mesh = L.mesh(legMat, { name: 'colony-leg' });
        const pivot = new THREE.Group();
        pivot.position.set(s * 9.5, -9.2, z);
        pivot.add(mesh);
        inner.add(pivot);
        legGroups.push(pivot);
        G.box(0.25, 0.25, 0.25, M(s * 9.5 + foot[0], -9.2 + foot[1] + 0.6, z + 3.4), { color: amber });
      }
    }
  }

  // ------------------------------------------------------------ meshes
  const hullMesh = H.mesh(mats.hull, { name: 'colony-hull' });
  const darkMesh = D.mesh(mats.dark, { name: 'colony-structure' });
  const glowMesh = G.mesh(mats.glow, { name: 'colony-lights', castShadow: false, receiveShadow: false });
  const strobeMesh = S.mesh(mats.strobe, { name: 'colony-strobes', castShadow: false, receiveShadow: false });
  const engMesh = engineGlow.mesh(mats.engine, { name: 'colony-engine-glow', castShadow: false, receiveShadow: false });
  const liftMesh = lifterGlow.mesh(mats.lifter, { name: 'colony-lifter-glow', castShadow: false, receiveShadow: false });
  engMesh.renderOrder = 2;
  liftMesh.renderOrder = 2;
  inner.add(hullMesh, darkMesh, glowMesh, strobeMesh, engMesh, liftMesh);

  // Ø emblems: tower sides + engine block sides
  const decals = new PartBuilder();
  const plane = new THREE.PlaneGeometry(1, 1);
  decals.add(plane.clone(), M(0, -0.4, -76.38, 0, Math.PI, 0, [3.4, 3.4, 1]));
  for (const s of [-1, 1]) {
    decals.add(plane.clone(), M(s * 4.23, 24, -35, 0, (s * Math.PI) / 2, 0, [7.5, 7.5, 1]));
    decals.add(plane.clone(), M(s * 14.43, 0.4, 60.5, 0, (s * Math.PI) / 2, 0, [11, 11, 1]));
  }
  plane.dispose();
  const decalMesh = decals.mesh(mats.decal, { name: 'colony-emblems', castShadow: false });
  decalMesh.renderOrder = 1;
  inner.add(decalMesh);

  const scale = length / BASE_LEN;
  inner.scale.setScalar(scale);
  const groundOffset = (withLegs ? 29.3 : 13) * scale;

  let strobeT = 0;
  group.userData = {
    engines,
    lifters,
    length,
    groundOffset,
    legs: legGroups,
    setLegs(k) {
      const v = Math.max(0, Math.min(1, k));
      for (const g of legGroups) {
        g.visible = v > 0.02;
        g.scale.set(1, 0.2 + 0.8 * v, 1);
      }
    },
    setLifters(k) {
      mats.lifter.opacity = Math.max(0, Math.min(1, k));
    },
    update(dt = 0.016) {
      strobeT += dt;
      strobeMesh.visible = strobeT % 1.6 < 0.12 || (strobeT % 1.6 > 0.3 && strobeT % 1.6 < 0.4);
    },
    dispose() {
      group.traverse((o) => o.geometry?.dispose());
    },
  };
  group.userData.setLifters(opts.lifters ?? 0.25);
  return group;
}
