import * as THREE from 'three';
import { ZONES, WORLD, WATERFALLS, ISLANDS, RACE_TRACK } from '../layout.js';
import { Rng } from '../../core/math.js';
import { hash2 } from './noise.js';
import { sstep, TRACK_SPLINE } from './shape.js';
import { createSampler, zoneClearance } from './scatter.js';
import { ScatterLayer } from './instancing.js';
import { rockGeometry, hoodooGeometry, archGeometry, mergeGeometries, fixNormals } from './rockgeo.js';
import { createRockMaterial } from './rockmaterial.js';
import { createCliffs } from './cliffs.js';

/**
 * Rocks: boulders, rock clusters, slabs, talus shards, big outcrops, canyon
 * hoodoos and natural arches — seeded placement over the baked masks plus a
 * few hand-shaped sets (spawn outcrop framing the hero view, waterfall talus,
 * the wet signal shore, island rims). Every kind is a ScatterLayer (near:
 * detailed + shadows, far: low-poly to the horizon); all share one material
 * (rockmaterial.js). Big rocks get walkable physics boxes.
 */
const LAYERS = {
  small: { near: 85, far: 0, phys: false },
  rockA: { near: 170, far: 650, phys: true },
  rockB: { near: 170, far: 650, phys: true },
  slab: { near: 170, far: 520, phys: true },
  shard: { near: 210, far: 900, phys: true },
  outcrop: { near: 330, far: 2400, phys: true },
  column: { near: 380, far: 2000, phys: false },
  hoodoo: { near: 430, far: 2800, phys: true },
};

function buildGeometries() {
  const A = { size: [1, 0.8, 0.92] };
  const B = { size: [1.15, 0.64, 1.0], cuts: 5, bump: 0.3 };
  const SL = { size: [1.5, 0.4, 1.2], cuts: 3, cutDepth: [0.38, 0.62], bump: 0.2, flatten: -0.3 };
  const SH = { size: [0.6, 1.7, 0.66], cuts: 6, taper: 0.45, bump: 0.22, sink: 0.12 };
  const O = { size: [1.2, 0.72, 1.0], cuts: 6, bump: 0.34, freq: 1.8, sink: 0.3 };
  // cliff columns: tall jointed blocks with flat fracture faces
  const COL = { size: [0.95, 2.3, 0.75], cuts: 7, cutDepth: [0.45, 0.68], bump: 0.13, freq: 1.1, taper: 0.04, sink: 0.04, flatten: -3, crease: 0.55, unitHeight: true };
  return {
    small: { near: rockGeometry('s', { detail: 1, size: [1, 0.72, 0.9], bump: 0.3, cuts: 3 }) },
    rockA: { near: rockGeometry('a', { ...A, detail: 3 }), far: rockGeometry('a', { ...A, detail: 0 }) },
    rockB: { near: rockGeometry('b', { ...B, detail: 3 }), far: rockGeometry('b', { ...B, detail: 0 }) },
    slab: { near: rockGeometry('slab', { ...SL, detail: 3 }), far: rockGeometry('slab', { ...SL, detail: 0 }) },
    shard: { near: rockGeometry('shard', { ...SH, detail: 3 }), far: rockGeometry('shard', { ...SH, detail: 0 }) },
    outcrop: { near: rockGeometry('o', { ...O, detail: 4 }), far: rockGeometry('o', { ...O, detail: 1 }) },
    column: { near: rockGeometry('col', { ...COL, detail: 2 }), far: rockGeometry('col', { ...COL, detail: 0 }) },
    hoodoo: { near: hoodooGeometry('h', { rings: 16, seg: 9, capDetail: 1 }), far: hoodooGeometry('h', { rings: 7, seg: 5, capDetail: 0 }) },
  };
}

const HALF_TRACK = RACE_TRACK.width / 2;
const _n = new THREE.Vector3();

/**
 * Seeded rock placement → { layer: [{x, y, z, ry, s, sy, tx, tz, color}] }.
 * `avoid(x, z)` → true where dedicated cliff meshes stand (no columns there).
 */
export function scatterRocks(data, q, { avoid = null } = {}) {
  const S = createSampler(data, q);
  const out = Object.fromEntries(Object.keys(LAYERS).map((k) => [k, []]));
  const half = WORLD.half - 4;
  const track = (x, z) => data.track.sample(x, z);

  const spot = (x, z, { minH = -1.4, roadPad = 1.2, zonePad = 2, trackPad = 3 } = {}) => {
    if (x < -half || x > half || z < -half || z > half) return null;
    const h = S.h(x, z);
    if (h < minH) return null;
    const m = S.at(x, z);
    if (m.city > 0.01 || m.road < roadPad || m.river < 0.6) return null;
    if (zonePad > -999 && zoneClearance(x, z) < zonePad) return null;
    if (m.canyon > 0.05 && track(x, z) < HALF_TRACK + trackPad) return null;
    m.y = h;
    return m;
  };

  /** Adds one rock: tilted toward the slope, sunk a little (more on slopes). */
  const add = (kind, x, z, m, s, rnd, { sy = 1, sink = 0.1, align = 0.6, tint = 1, warm = 0 } = {}) => {
    const ry = rnd(1) * Math.PI * 2;
    q.getNormalAt(x, z, _n);
    const c = Math.cos(ry);
    const sn = Math.sin(ry);
    const lx = _n.x * c - _n.z * sn;
    const lz = _n.x * sn + _n.z * c;
    const tx = Math.asin(Math.max(-1, Math.min(1, lz))) * align + (rnd(2) - 0.5) * 0.3;
    const tz = -Math.asin(Math.max(-1, Math.min(1, lx))) * align + (rnd(3) - 0.5) * 0.3;
    const v = (0.82 + rnd(4) * 0.32) * tint;
    out[kind].push({
      x, z, y: m.y - s * (sink + m.slope * 0.55),
      ry, s, sy: s * sy, tx, tz,
      color: [v * (1 + warm * 0.07), v, v * (1 - warm * 0.07)],
    });
  };

  // ---------------------------------------------------- general boulders (7 m)
  const G = 7;
  for (let gz = -half; gz < half; gz += G) {
    for (let gx = -half; gx < half; gx += G) {
      const ci = Math.round(gx / G);
      const cj = Math.round(gz / G);
      const r = hash2(ci, cj, 101);
      if (r > 0.55) continue;
      const x = gx + hash2(ci, cj, 102) * G;
      const z = gz + hash2(ci, cj, 103) * G;
      const m = spot(x, z);
      if (!m) continue;
      if (m.cliff > 0.3 && avoid?.(x, z)) continue; // the cliff mesh covers this face
      const steep = sstep(0.26, 0.62, m.slope);
      let p = 0.006 + 0.05 * m.rocky + 0.3 * steep + 0.42 * m.cliff + 0.05 * m.mount + 0.03 * m.forest + 0.02 * m.jungle + 0.2 * m.outcrop;
      if (m.y < 2.5 && m.shore > -12 && m.shore < 16) p += 0.24 * sstep(0.35, 0.7, m.rocky);
      if (m.canyon > 0.3) p = 0.02 + 0.32 * steep + 0.2 * m.cliff;
      p *= 1 - 0.9 * m.pad;
      if (m.y < -0.6) p *= 0.45;
      if (r > p) continue;
      const rnd = (k) => hash2(ci, cj, 110 + k);
      const t = rnd(0);
      let s = (0.26 + 2.2 * t * t * t) * (1 + 0.7 * m.cliff + 0.5 * m.mount);
      const warm = m.canyon;
      if (s < 0.9) {
        add('small', x, z, m, s, rnd, { warm });
        continue;
      }
      const k = rnd(5);
      if ((m.cliff > 0.3 || m.slope > 0.5) && k < 0.45) add('shard', x, z, m, s * 0.8, rnd, { sy: 0.8 + rnd(6) * 0.6, align: 0.3, warm });
      else if (m.slope < 0.22 && k < 0.3 + 0.35 * m.outcrop) add('slab', x, z, m, s, rnd, { sink: 0.05, warm, align: 0.85 });
      else add(k < 0.65 ? 'rockA' : 'rockB', x, z, m, s, rnd, { warm });
    }
  }

  // ------------------------------------------- pebbles + small clusters (3 m)
  const P = 3;
  for (let gz = -half; gz < half; gz += P) {
    for (let gx = -half; gx < half; gx += P) {
      const ci = Math.round(gx / P);
      const cj = Math.round(gz / P);
      const r = hash2(ci, cj, 201);
      if (r > 0.06) continue;
      const x = gx + hash2(ci, cj, 202) * P;
      const z = gz + hash2(ci, cj, 203) * P;
      const m = spot(x, z, { zonePad: -6, roadPad: 0.8 });
      if (!m) continue;
      let p = 0.002 + 0.02 * m.rocky + 0.04 * sstep(0.2, 0.5, m.slope) + 0.03 * m.canyon + 0.04 * m.outcrop;
      if (m.y < 1.6 && m.shore > -6 && m.shore < 10) p += 0.03;
      if (m.river < 6) p += 0.03;
      if (r > p) continue;
      const rnd = (k) => hash2(ci, cj, 210 + k);
      add('small', x, z, m, 0.12 + rnd(0) * 0.3, rnd, { warm: m.canyon });
    }
  }

  // ----------------------------------------------- big outcrops (36 m grid)
  const O = 36;
  for (let gz = -half; gz < half; gz += O) {
    for (let gx = -half; gx < half; gx += O) {
      const ci = Math.round(gx / O);
      const cj = Math.round(gz / O);
      const r = hash2(ci, cj, 301);
      if (r > 0.4) continue;
      const x = gx + hash2(ci, cj, 302) * O;
      const z = gz + hash2(ci, cj, 303) * O;
      const m = spot(x, z, { minH: 0.5, zonePad: 14, roadPad: 6, trackPad: 9 });
      if (!m) continue;
      let p = 0.32 * sstep(0.16, 0.5, m.slope) + 0.22 * m.mount + 0.07 * m.rocky + 0.25 * m.cliff + 0.3 * m.outcrop;
      if (m.canyon > 0.3) p = 0.1 + 0.2 * sstep(0.1, 0.4, m.slope);
      if (m.jungle > 0.5) p *= 0.6;
      if (r > p) continue;
      const rnd = (k) => hash2(ci, cj, 310 + k);
      const s = (3 + 6 * rnd(0) * rnd(0)) * (1 + 0.6 * m.mount);
      add('outcrop', x, z, m, s, rnd, { sink: 0.18, align: 0.75, sy: 0.75 + rnd(6) * 0.5, warm: m.canyon });
    }
  }

  // ------------------------------------------------------ canyon hoodoos
  const Hc = 21;
  for (let gz = -half; gz < half; gz += Hc) {
    for (let gx = 300; gx < half; gx += Hc) {
      const ci = Math.round(gx / Hc);
      const cj = Math.round(gz / Hc);
      const r = hash2(ci, cj, 401);
      if (r > 0.32) continue;
      const x = gx + hash2(ci, cj, 402) * Hc;
      const z = gz + hash2(ci, cj, 403) * Hc;
      const m = spot(x, z, { minH: 3, zonePad: 20, roadPad: 6, trackPad: 9 });
      if (!m || m.canyon < 0.45 || m.slope > 0.42) continue;
      if (r > 0.32 * m.canyon) continue;
      const rnd = (k) => hash2(ci, cj, 410 + k);
      const hgt = 7 + 19 * rnd(0) * rnd(1);
      const w = hgt * (0.55 + rnd(2) * 0.35);
      out.hoodoo.push({ x, z, y: m.y - 1.2, ry: rnd(3) * 6.283, s: w, sy: hgt, tx: (rnd(4) - 0.5) * 0.06, tz: (rnd(5) - 0.5) * 0.06, color: [1.05, 1, 0.94] });
    }
  }

  // ------------------------------- cliff columns on steep faces (8 m grid)
  // jointed rock pillars standing in the cliff, sized to the local relief:
  // they hide the heightfield's flat walls and sawtooth rims
  const colH = 1; // geometry height is normalised below (instance sy)
  const fallsAvoid = WATERFALLS.map((w) => ({ ax: w.lip.x, az: w.lip.z, bx: w.bottom.x, bz: w.bottom.z, r: w.width * 0.5 + 6 }));
  const nearFall = (x, z) => {
    for (const f of fallsAvoid) {
      const dx = f.bx - f.ax;
      const dz = f.bz - f.az;
      const l2 = dx * dx + dz * dz;
      let u = ((x - f.ax) * dx + (z - f.az) * dz) / l2;
      u = u < -0.3 ? -0.3 : u > 1.2 ? 1.2 : u;
      const ex = x - f.ax - dx * u;
      const ez = z - f.az - dz * u;
      if (ex * ex + ez * ez < f.r * f.r) return true;
    }
    return false;
  };
  const CG = 8;
  for (let gz = -half; gz < half; gz += CG) {
    for (let gx = -half; gx < half; gx += CG) {
      const ci = Math.round(gx / CG);
      const cj = Math.round(gz / CG);
      const r = hash2(ci, cj, 501);
      if (r > 0.66) continue;
      const x = gx + hash2(ci, cj, 502) * CG;
      const z = gz + hash2(ci, cj, 503) * CG;
      const k = data.N * Math.round((z + data.HALF) / data.STEP) + Math.round((x + data.HALF) / data.STEP);
      if (!(data.slope[k] > 0.58)) continue;
      const h0 = S.h(x, z);
      let hmin = h0;
      let hmax = h0;
      for (let a = 0; a < 8; a++) {
        const hh = S.h(x + Math.cos(a * 0.785) * 5, z + Math.sin(a * 0.785) * 5);
        if (hh < hmin) hmin = hh;
        if (hh > hmax) hmax = hh;
      }
      const rise = hmax - Math.max(hmin, -6);
      if (rise < 5 || hmax < 1) continue;
      if (nearFall(x, z) || avoid?.(x, z)) continue;
      const m = spot(x, z, { minH: -30, zonePad: 6, roadPad: 4, trackPad: 4 });
      if (!m) continue;
      const rnd = (k2) => hash2(ci, cj, 510 + k2);
      q.getNormalAt(x, z, _n);
      // set the block into the face: shift it a little uphill (into the cliff)
      const nl = Math.hypot(_n.x, _n.z) || 1;
      const s0 = 4.2 + 3.6 * rnd(1);
      const px = x - (_n.x / nl) * s0 * 0.35;
      const pz = z - (_n.z / nl) * s0 * 0.35;
      out.column.push({
        x: px, z: pz, y: Math.max(hmin, -6) - 1.5,
        ry: Math.atan2(_n.x, _n.z) + (rnd(0) - 0.5) * 0.5,
        s: s0,
        sy: (rise * (0.92 + 0.2 * rnd(2)) + 2) / colH,
        tx: (rnd(3) - 0.5) * 0.08,
        tz: (rnd(4) - 0.5) * 0.08,
        color: [0.9 + rnd(5) * 0.2, 0.9 + rnd(5) * 0.18, 0.9 + rnd(5) * 0.16],
      });
    }
  }

  // --------------------------------------------------- hand-shaped sets
  const rng = new Rng('terrain-rock-sets');
  const R = () => rng.random();
  const place = (kind, x, z, s, o = {}) => {
    const m = spot(x, z, { zonePad: -1000, roadPad: o.roadPad ?? 0.5, minH: o.minH ?? -1.6, trackPad: 3 });
    if (!m) return false;
    const seed = [R(), R(), R(), R(), R(), R(), R()];
    add(kind, x, z, m, s, (k) => seed[k % 7], o);
    return true;
  };

  // spawn outcrop: big rounded rocks + slabs framing the hero view, pebbles
  const sp = ZONES.spawn;
  const SPAWN_SET = [
    // [distance, bearing° (0 = north, + = east), size, kind]
    [7.5, -64, 1.35, 'rockA'], [10.5, -49, 2.0, 'rockB'], [13.5, -76, 1.2, 'slab'], [17, -58, 2.6, 'rockA'],
    [7, 60, 1.0, 'slab'], [10.5, 48, 1.6, 'rockA'], [14.5, 66, 2.3, 'rockB'], [19, 54, 1.4, 'shard'],
    [21, -38, 1.5, 'rockB'], [24, 33, 1.3, 'rockA'], [30, -22, 1.6, 'slab'], [33, 15, 1.2, 'rockB'],
    [5.5, 125, 0.9, 'slab'], [6.5, -135, 1.1, 'slab'], [9, 165, 0.8, 'slab'], [12, -100, 1.0, 'rockA'], [12, 100, 1.1, 'slab'],
  ];
  for (const [d, b, s, kind] of SPAWN_SET) {
    const a = (b * Math.PI) / 180;
    place(kind, sp.x + Math.sin(a) * d, sp.z - Math.cos(a) * d, s, { sink: kind === 'slab' ? 0.08 : 0.14, align: 0.5 });
  }
  for (let i = 0; i < 46; i++) {
    const a = (R() * 2 - 1) * Math.PI;
    const d = 3 + R() * 24;
    // keep the line of sight over the brow free of anything taller than pebbles
    if (Math.abs(a) < 0.5 && d < 10) continue;
    place('small', sp.x + Math.sin(a) * d, sp.z - Math.cos(a) * d, 0.14 + R() * (Math.abs(a) < 0.7 ? 0.2 : 0.5), { sink: 0.15 });
  }

  // waterfalls: talus at the foot, boulders flanking the lip (not in the falling water)
  for (const w of WATERFALLS) {
    const fx = w.bottom.x - w.lip.x;
    const fz = w.bottom.z - w.lip.z;
    const fl = Math.hypot(fx, fz) || 1;
    const inFall = (x, z) => {
      const u = Math.max(0, Math.min(1.3, ((x - w.lip.x) * fx + (z - w.lip.z) * fz) / (fl * fl)));
      return Math.hypot(x - (w.lip.x + fx * u), z - (w.lip.z + fz * u)) < w.width * 0.5 + 4;
    };
    const n = 10 + Math.round(w.width * 0.9);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const d = w.width * 0.45 + R() * (14 + w.width);
      const x = w.bottom.x + Math.cos(a) * d;
      const z = w.bottom.z + Math.sin(a) * d;
      if (inFall(x, z)) continue;
      const s = 0.8 + R() * R() * 3.4;
      place(R() < 0.3 ? 'shard' : R() < 0.5 ? 'rockB' : 'rockA', x, z, s, { sink: 0.2, align: 0.4, minH: -3 });
    }
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      const along = 6 + R() * 22;
      const sx = (-fz / fl) * side;
      const sz = (fx / fl) * side;
      const x = w.lip.x + sx * (w.width * 0.5 + along) - (fx / fl) * R() * 10;
      const z = w.lip.z + sz * (w.width * 0.5 + along) - (fz / fl) * R() * 10;
      if (inFall(x, z)) continue;
      place(R() < 0.5 ? 'rockB' : 'shard', x, z, 1 + R() * 2.2, { sink: 0.15 });
    }
  }

  // the signal shore: dark wet rocks scattered in the shallows (concept 10)
  const sig = { x: ZONES.signal.x, z: ZONES.signal.z - 23 }; // obelisk ≈ (−120, −163)
  for (let i = 0, made = 0; i < 160 && made < 34; i++) {
    const a = R() * Math.PI * 2;
    const d = 17 + R() * 34;
    const x = sig.x + Math.cos(a) * d;
    const z = sig.z + Math.sin(a) * d;
    const h = q.getHeightAt(x, z);
    if (h < -1.1 || h > 2.2) continue;
    if (place(R() < 0.55 ? 'small' : R() < 0.6 ? 'rockA' : 'rockB', x, z, 0.4 + R() * R() * 1.8, { sink: 0.2, minH: -1.2 })) made++;
  }

  // island rims
  for (const isl of ISLANDS) {
    const n = Math.round(isl.radius * 0.45);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const d = isl.radius * (0.82 + R() * 0.3);
      const x = isl.x + Math.cos(a) * d;
      const z = isl.z + Math.sin(a) * d;
      const h = q.getHeightAt(x, z);
      if (h < -1.2 || h > 4) continue;
      place(R() < 0.4 ? 'small' : R() < 0.5 ? 'rockB' : 'rockA', x, z, 0.5 + R() * R() * 2.6, { sink: 0.2, minH: -1.3 });
    }
  }

  // shuffle (density truncation = random subset)
  let seed = 1;
  for (const k of Object.keys(out)) out[k] = new Rng(`rocks-${k}-${seed++}`).shuffle(out[k]);
  return out;
}

/** Natural sandstone arches spanning the race-track canyon (world-space mesh). */
function buildArches(q) {
  const geos = [];
  const feet = [];
  const L = TRACK_SPLINE.length;
  const specs = [
    { t: 0.215, rise: 21, thick: 3.4, reach: 22 },
    { t: 0.665, rise: 25, thick: 3.8, reach: 24 },
  ];
  const p = {};
  specs.forEach((s, i) => {
    TRACK_SPLINE.at(L * s.t, p);
    const nx = -p.tz;
    const nz = p.tx;
    const a = new THREE.Vector3(p.x + nx * s.reach, 0, p.z + nz * s.reach);
    const b = new THREE.Vector3(p.x - nx * s.reach, 0, p.z - nz * s.reach);
    a.y = q.getHeightAt(a.x, a.z);
    b.y = q.getHeightAt(b.x, b.z);
    geos.push(archGeometry(`arch-${i}`, a, b, s.rise, s.thick));
    feet.push({ p: a, thick: s.thick }, { p: b, thick: s.thick });
  });
  const geometry = mergeGeometries(geos);
  geometry.computeVertexNormals();
  fixNormals(geometry);
  return { geometry, feet };
}

export function createRocks(ctx, world, data, q, textures, { sunVis = null } = {}) {
  const t0 = performance.now();
  const material = createRockMaterial(textures);
  if (sunVis) sunVis.applySunVisibility(material);
  const geos = buildGeometries();
  // high-resolution cliff faces along the waterfall escarpments
  const cliffs = createCliffs(q.getHeightAt, material);
  const instances = scatterRocks(data, q, { avoid: cliffs.columnsAvoid });
  const group = new THREE.Group();
  group.name = 'rocks';
  world.scene.add(group);
  group.add(cliffs.mesh);
  const quality = ctx.engine?.quality || { drawDistance: 3000 };

  const layers = {};
  for (const [name, cfg] of Object.entries(LAYERS)) {
    const list = instances[name];
    if (!list?.length) continue;
    const g = geos[name];
    const layer = new ScatterLayer({
      name: `rock-${name}`,
      parent: group,
      instances: list,
      near: { geometry: g.near, material, radius: cfg.near, castShadow: true, capacity: 256 },
      far: cfg.far && g.far ? { geometry: g.far, material, radius: Math.min(cfg.far, quality.drawDistance) } : null,
    });
    layer.cfg = cfg;
    layer.geoTop = g.near.userData.top ?? g.near.userData.height ?? 1;
    layers[name] = layer;
  }

  // arches (one merged mesh)
  const arches = buildArches(q);
  const archMesh = new THREE.Mesh(arches.geometry, material);
  archMesh.name = 'rock-arches';
  archMesh.castShadow = true;
  archMesh.receiveShadow = true;
  archMesh.geometry.computeBoundingSphere();
  group.add(archMesh);

  // physics: walkable boxes inside the big rocks (inscribed, so edges stay soft)
  const physics = ctx.physics;
  const pb = WORLD.playBounds + 20;
  let boxes = 0;
  if (physics?.addBox) {
    for (const layer of Object.values(layers)) {
      if (!layer.cfg.phys) continue;
      const bb = layer.nearGeo.boundingBox;
      const top = layer.geoTop;
      layer.forEach((i, x, z, m, o) => {
        if (Math.abs(x) > pb || Math.abs(z) > pb) return;
        const sx = Math.hypot(m[o], m[o + 1], m[o + 2]);
        const sy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
        if (sx < 0.85) return;
        const w = (bb.max.x - bb.min.x) * sx * 0.62;
        const d = (bb.max.z - bb.min.z) * sx * 0.62;
        const h = top * sy * 0.86;
        const y0 = m[o + 13];
        const rotY = Math.atan2(m[o + 8], m[o + 10]);
        layer.boxIds[i] = physics.addBox({ x, y: y0 + h / 2, z, w, h, d, rotY, solid: true, walkable: true, tag: 'terrain-rock', owner: layer.name });
        boxes++;
      });
    }
    for (const f of arches.feet) {
      physics.addBox({ x: f.p.x, y: f.p.y + 5, z: f.p.z, w: f.thick * 3, h: 14, d: f.thick * 3, solid: true, walkable: true, tag: 'terrain-rock', owner: 'rock-arches' });
      boxes++;
    }
  }

  const camPos = new THREE.Vector3();
  return {
    group,
    layers,
    material,
    arches: archMesh,
    cliffs: cliffs.mesh,
    physicsBoxes: boxes,
    buildMs: Math.round(performance.now() - t0),
    update(cam) {
      cam.getWorldPosition(camPos);
      for (const name in layers) layers[name].update(camPos);
    },
    setDrawDistance(dist) {
      for (const [name, layer] of Object.entries(layers)) if (layer.cfg.far) layer.setFarRadius(Math.min(layer.cfg.far, dist));
    },
    clearArea(x, z, r) {
      let n = 0;
      for (const layer of Object.values(layers)) n += layer.clearArea(x, z, r, physics);
      return n;
    },
    stats() {
      const o = {};
      for (const [k, l] of Object.entries(layers)) o[k] = { total: l.total, near: l.nearCount };
      return o;
    },
  };
}
