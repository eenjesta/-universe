import * as THREE from 'three';
import { createFastNoise } from './noise.js';
import { WORLD } from '../layout.js';

/**
 * Backdrop: a ring of distant mountain ranges beyond the ±1200 m terrain so
 * the horizon never shows an edge. Polar mesh: one vertex column per bearing,
 * starting on the terrain's square border (tucked just under its edge height
 * so there are no cracks) and running ~4.2 km outward.
 *
 * Heights blend from the real edge profile into layered ranges: a nearer
 * foothill chain, a main range with dendritic ridges (domain-warped ridged
 * multifractal whose finer octaves are damped on the valley floors) and
 * taller snowy peaks behind — so the haze stacks them into receding
 * silhouettes like the poster instead of isolated cones. The open sea sector
 * (N/NE, where the sun sets over water) sinks below the water plane.
 * Vertex colours: forest → scree/rock (darker gullies, lighter ribs) → snow
 * (favouring shaded north faces). One draw call, fogged like the rest.
 */
const SEA_FROM = -0.42; // bearing (rad from north toward east) where the open sea starts
const SEA_TO = 1.26; // … and ends
// ring offsets beyond the border: -3 (tucked under the edge), then 6 m … 4.2 km
const RING_COUNT = 58;
const RINGS = [-3, ...Array.from({ length: RING_COUNT }, (_, k) => Math.round(4200 * Math.pow((k + 1) / RING_COUNT, 1.6)))];
const NA = 900; // columns (0.4° each)

const sst = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createBackdrop(getHeightAt) {
  const noise = createFastNoise(`${WORLD.seed}-backdrop`);
  const HALF = WORLD.half;
  const cols = NA + 1;
  const rows = RINGS.length;
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3);
  const ridgeArr = new Float32Array(cols * rows); // crest-ness for colouring

  /** Mountain height (m) at world (x, z), `e` metres beyond the border. */
  const mountain = (x, z, e, out) => {
    // domain warp: bends the chains so they never run parallel to the edge
    const wx = x + 520 * noise.fbm(x * 0.00031 + 4.7, z * 0.00031 - 1.3, 3);
    const wz = z + 520 * noise.fbm(x * 0.00031 - 6.2, z * 0.00031 + 8.1, 3);
    // massifs (where the big mountains stand)
    const massif = 0.5 + 0.5 * noise.fbm(wx * 0.00042 + 1.9, wz * 0.00042 + 4.4, 3);
    // main crests (~2.4 km), dendritic side ridges (~700 m), crags (~180 m)
    const r1 = noise.ridged(wx * 0.00042 + 3.1, wz * 0.00042 - 7.7, 3);
    const r2 = noise.ridged(wx * 0.0014 - 2.3, wz * 0.0014 + 5.6, 3);
    const r3 = noise.ridged(wx * 0.0055 + 9.4, wz * 0.0055 - 4.1, 2);
    const crest = r1 * r1;
    // finer ridges ride on the high ground only (valleys stay smooth)
    const hi = sst(0.15, 0.7, crest + 0.3 * massif - 0.15);
    // ranges grow with distance: foothills → main range → high peaks behind
    const near = sst(0, 700, e);
    const far = sst(900, 2600, e);
    let h = 70 + 90 * near + (260 + 420 * far) * (0.35 + 0.65 * massif) * crest;
    h += (120 + 160 * far) * hi * r2 * r2;
    h += 34 * hi * r3 * near;
    // valleys between the chains: smooth, forested floors
    h += 40 * noise.fbm(x * 0.0021 + 0.7, z * 0.0021 - 2.2, 2) * near;
    out.ridge = Math.min(1, hi * (0.4 * r2 + 0.6 * r3));
    return h;
  };

  const m = { ridge: 0 };
  for (let c = 0; c < cols; c++) {
    const beta = (c / NA) * Math.PI * 2 - Math.PI;
    const dx = Math.sin(beta);
    const dz = -Math.cos(beta);
    const s = HALF / Math.max(Math.abs(dx), Math.abs(dz));
    const bx = dx * s;
    const bz = dz * s;
    const cx = Math.max(-HALF + 0.5, Math.min(HALF - 0.5, bx));
    const cz = Math.max(-HALF + 0.5, Math.min(HALF - 0.5, bz));
    const he = getHeightAt(cx, cz);
    for (let r = 0; r < rows; r++) {
      const e = RINGS[r];
      const x = bx + dx * e;
      const z = bz + dz * e;
      // the open sea (N/NE): a rugged coastline whose bays and headlands vary
      // with distance; the ranges dwindle toward it instead of sliding in
      const wig = e > 0 ? 0.09 * noise.n2(e * 0.0021 + 1.7, beta * 2.3) + 0.03 * noise.n2(e * 0.009, beta * 9.1) : 0;
      const bw = beta + wig;
      const be = beta - wig;
      const sea = sst(SEA_FROM - 0.022, SEA_FROM + 0.022, bw) * (1 - sst(SEA_TO - 0.022, SEA_TO + 0.022, be));
      const taper = Math.max(sst(SEA_FROM - 0.38, SEA_FROM - 0.02, bw), 1 - sst(SEA_TO + 0.02, SEA_TO + 0.38, be));
      let hf = mountain(x, z, Math.max(0, e), m);
      hf = 55 + (hf - 55) * (1 - 0.72 * taper);
      // never dip below the terrain's own edge profile right at the border
      hf = Math.max(hf, he * 0.92 + 30 * sst(0, 300, e));
      let h = e <= 0 ? he - 2.5 : he + (hf - he) * sst(0, 460, e);
      // open sea: everything sinks to the sea floor beyond the border
      if (sea > 0 && e > 0) h += (Math.min(he, -30) - 10 * sst(0, 400, e) - h) * sea;
      else if (sea > 0) h += (Math.min(he, -30) - h) * sea;
      const k = (r * cols + c) * 3;
      pos[k] = x;
      pos[k + 1] = h;
      pos[k + 2] = z;
      ridgeArr[r * cols + c] = m.ridge;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = new Uint32Array((rows - 1) * NA * 6);
  let o = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < NA; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // alternate the diagonal so long faces do not all slant the same way
      if ((r + c) & 1) {
        idx[o++] = a;
        idx[o++] = b;
        idx[o++] = d;
        idx[o++] = b;
        idx[o++] = e;
        idx[o++] = d;
      } else {
        idx[o++] = a;
        idx[o++] = e;
        idx[o++] = d;
        idx[o++] = a;
        idx[o++] = b;
        idx[o++] = e;
      }
    }
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  // vertex colours: forest → scree/rock (gullies darker, ribs lighter) → snow
  const nrm = geo.attributes.normal;
  for (let i = 0; i < cols * rows; i++) {
    const x = pos[i * 3];
    const h = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    const slope = 1 - ny;
    const n = noise.n2(x * 0.004, z * 0.004);
    const n2 = noise.n2(x * 0.013 + 3.3, z * 0.013 - 1.1);
    // forest (dark green-brown, warm at the edges)
    let r = 0.055 + 0.015 * n2;
    let g = 0.075 + 0.012 * n2;
    let b = 0.04;
    // rock / scree above the tree line and on steep faces
    const rock = Math.min(1, sst(150, 380, h + n * 70) + sst(0.28, 0.55, slope));
    const rib = ridgeArr[i];
    const rv = 0.15 + 0.07 * rib + 0.03 * n2;
    r += (rv * 1.08 - r) * rock;
    g += (rv * 0.98 - g) * rock;
    b += (rv * 0.9 - b) * rock;
    // snow: high ground, gentler slopes, more on north-facing (shaded) sides
    const north = Math.max(0, -nz);
    const snow = sst(560, 760, h + n * 110 + north * 90) * (1 - sst(0.5, 0.78, slope - north * 0.15));
    r += (0.8 - r) * snow;
    g += (0.81 - g) * snow;
    b += (0.86 - b) * snow;
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  material.name = 'terrain-backdrop';
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'terrain-backdrop';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.raycast = () => {};
  mesh.matrixAutoUpdate = false;
  return { mesh, material };
}
