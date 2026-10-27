import * as THREE from 'three';
import { ESCARPMENTS, WATERFALLS, sstep } from './shape.js';
import { createFastNoise } from './noise.js';
import { WORLD } from '../layout.js';

/**
 * Cliff faces along the waterfall escarpments (shape.js ESCARPMENTS).
 *
 * The 2 m heightfield can only express a cliff as a steep sigmoid that
 * collapses into a sawtooth wall at the coarser terrain LODs. Here every
 * escarpment gets a dedicated high-resolution "curtain" mesh that follows
 * the baked face (found by marching the height field along the lakeward
 * normal, so it always agrees with what the water engineer's falls hug)
 * and adds rock relief on top of it: buttresses every ~20 m, columnar
 * jointing, protruding bedding ledges, rough noise and a talus flare at the
 * foot. The relief only ever pushes the rock lakeward (≥ the heightfield
 * face), fades to zero at the rim (the plateau grass overlaps the top edge)
 * and at the waterfall notches (the water pours into a recess).
 *
 * Rendered with the shared rock material (triplanar granite, moss on the
 * ledges, wet near the water); vertex colours carry the relief AO.
 *   createCliffs(getHeightAt, material) → { mesh, columnsAvoid(x, z) → bool }
 */
const COL_STEP = 1.5; // metres between columns along the cliff
const ROW_STEP = 1.6; // metres between rows (vertical)
const FOOT_Y = -5; // curtain bottom (below the water)

export function createCliffs(getHeightAt, material) {
  const noise = createFastNoise(`${WORLD.seed}-cliffs`);
  const pos = [];
  const col = [];
  const idx = [];
  const lips = WATERFALLS.map((w) => ({ x: w.lip.x, z: w.lip.z, half: w.width * 0.5 + 2.5 }));
  const spans = []; // for columnsAvoid: sampled points of every curtain

  for (const esc of ESCARPMENTS) {
    const line = esc.line;
    const L = line.length;
    const cols = Math.floor(L / COL_STEP) + 1;
    // per column: the face profile s(y) (distance along the lakeward normal)
    const columns = [];
    const p = {};
    for (let c = 0; c < cols; c++) {
      const t = Math.min(L, c * COL_STEP);
      line.at(t, p);
      const nx = -p.tz; // left normal (-dz, dx) points to the water
      const nz = p.tx;
      const fade = sstep(0, esc.fade[0], t) * sstep(0, esc.fade[1], L - t);
      // waterfall notch weight (0 inside the falling water → 1 outside)
      let notch = 1;
      let inFall = false;
      for (const l of lips) {
        const d = Math.hypot(p.x - l.x, p.z - l.z);
        if (d < l.half) inFall = true;
        notch = Math.min(notch, sstep(l.half, l.half + 9, d));
      }
      const top = p.v;
      // march the baked height field along the normal
      const prof = [];
      let rimS = null;
      let footS = null;
      for (let s = -30; s <= 45; s += 0.5) {
        const h = getHeightAt(p.x + nx * s, p.z + nz * s);
        prof.push([s, h]);
        if (rimS === null && s > -20 && h < top - 1.2) rimS = s;
        if (rimS !== null && footS === null && h < -0.4) footS = s;
      }
      const ok = fade > 0.45 && !inFall && rimS !== null && footS !== null && footS - rimS < 30;
      columns.push({ t, x: p.x, z: p.z, nx, nz, prof, rimS, footS, top, fade, notch, ok });
    }

    // rows from the rim down to below the water, per run of usable columns
    let run = [];
    const flush = () => {
      if (run.length >= 3) buildRun(run);
      run = [];
    };
    for (const c of columns) {
      if (c.ok) run.push(c);
      else flush();
    }
    flush();
  }

  /** Face distance where the profile crosses height y (between rim and foot). */
  function faceS(cl, y) {
    const pr = cl.prof;
    for (let k = 1; k < pr.length; k++) {
      const [s0, h0] = pr[k - 1];
      const [s1, h1] = pr[k];
      if (s1 < cl.rimS - 1) continue;
      if (h0 >= y && h1 < y) return s0 + ((h0 - y) / (h0 - h1 || 1e-6)) * (s1 - s0);
    }
    return cl.footS + Math.max(0, -y) * 0.35;
  }

  function buildRun(run) {
    // shared row heights for the run: from the highest rim down to FOOT_Y
    let rimY = -Infinity;
    for (const c of run) rimY = Math.max(rimY, c.top + 0.6);
    const rows = Math.max(3, Math.ceil((rimY - FOOT_Y) / ROW_STEP) + 1);
    const base = pos.length / 3;
    const n = run.length;
    for (let ci = 0; ci < n; ci++) {
      const c = run[ci];
      const edge = Math.min(ci, n - 1 - ci); // taper at the run ends
      const endFade = sstep(0, 4, edge) * c.notch * sstep(0.45, 0.8, c.fade);
      // the rim height of this column: plateau surface just behind the edge
      const rimH = getHeightAt(c.x + c.nx * (c.rimS - 1.2), c.z + c.nz * (c.rimS - 1.2));
      for (let r = 0; r < rows; r++) {
        const f = r / (rows - 1);
        // first row tucked under the plateau surface, then down the face
        let y;
        let s;
        if (r === 0) {
          y = rimH - 0.9;
          s = c.rimS - 2.2;
        } else {
          y = Math.min(rimH - 0.5, rimY - (rimY - FOOT_Y) * f);
          s = faceS(c, y);
        }
        const depth = rimH - y; // metres below the rim
        // relief (always lakeward), fading at the rim and the notches
        const t = c.t;
        const b = noise.n2(t * 0.048 + 3.7, y * 0.006);
        const buttress = Math.pow(Math.max(0, b), 1.4) * 3.4;
        const joint = Math.pow(noise.n2(t * 0.33 + 1.1, y * 0.025) * 0.5 + 0.5, 2) * 1.3;
        const bedding = sstep(0.62, 0.92, 0.5 + 0.5 * Math.sin(y * 0.52 + noise.n2(t * 0.02, 5.5) * 2.4)) * 0.75;
        const rough = noise.n2(t * 0.14 + 7.2, y * 0.14) * 0.7 + noise.n2(t * 0.45, y * 0.45 - 3.1) * 0.25;
        const talus = Math.max(0, 1.2 - y) * 0.45;
        let relief = (0.5 + buttress + joint + bedding + rough) * sstep(0.3, 4.5, depth) + talus;
        relief = Math.max(0.15, relief) * endFade + 0.12;
        const ss = s + relief;
        pos.push(c.x + c.nx * ss, y, c.z + c.nz * ss);
        // AO: recesses and the base darker, buttress fronts / ledges lighter
        const ao = Math.min(1, 0.5 + 0.12 * buttress + 0.18 * joint + 0.25 * bedding + 0.12 * rough) * (0.72 + 0.28 * sstep(-2, 12, y));
        col.push(ao, ao, ao);
        if (r % 3 === 0) spans.push([c.x + c.nx * ss, c.z + c.nz * ss]);
      }
    }
    for (let ci = 0; ci < n - 1; ci++) {
      for (let r = 0; r < rows - 1; r++) {
        const a = base + ci * rows + r;
        const b2 = a + rows;
        // faces point lakeward (left of the walking direction)
        idx.push(a, a + 1, b2, b2, a + 1, b2 + 1);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'terrain-cliffs';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.raycast = () => {};

  // spatial hash of the curtain footprint (rock columns stay out of it)
  const cell = 8;
  const hash = new Set();
  for (const [x, z] of spans) hash.add(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
  const columnsAvoid = (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (hash.has(`${cx + dx},${cz + dz}`)) return true;
    return false;
  };
  return { mesh, columnsAvoid, triangles: idx.length / 3 };
}
