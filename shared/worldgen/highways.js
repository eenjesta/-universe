import { sstep, mix } from './noise.js';

/**
 * Protected highways from the hub border outward (PLATFORM.md §11.2 — keeping
 * the hub open). Deterministic for a seed + hub:
 *
 *   gates     for each of 7 land bearings, the lowest point (a pass) of the
 *             smoothed hub border profile within ±260 m of where the bearing
 *             leaves the hub mesh square
 *   routing   weighted A* on a 70 m grid in a ±1.2 km corridor along the bearing: grade,
 *             water, sideways drift, a push away from the hub border (no contour-hugging
 *             around the ring mountains) and a penalty where a 9 % road from the gate
 *             could not follow the ground; then smoothed into gentle curves
 *   profile   centreline resampled every 10 m, heights of the (corridor-damped)
 *             terrain smoothed over ±60 m, grade-limited to 9 %, kept ≥ 1.6 m
 *             above the water (causeways)
 *   stamp     10 m paving, flat to 6.5 m, blended to the terrain by 20.5 m
 *   shoulders where the grade-limited road runs > 3 m above / below the terrain, the ground
 *             follows it in a wide smooth shoulder (20.5 + 2.4·|fill| m, ≤ 160 m): tall fills
 *             become natural spurs carrying the road and deep cuts become cuttings / passes,
 *             instead of 60 m walls (blended over all nearby segments → continuous)
 *   corridor  mountains / mesas are damped within ~300 m (passes + valleys)
 *   waystones a beacon every km, 8.5 m right of the centreline
 *
 * Spatial queries use a 32 m cell index (CSR) over the network's bounds.
 */
export const HIGHWAY = {
  width: 10,
  half: 5,
  flat: 6.5,
  reach: 20.5,
  clear: 20, // no building within this of a centreline (§11.2)
  length: 6000,
  maxGrade: 0.09,
  waystoneEvery: 1000,
  waystoneSide: 8.5,
};

// bearings (deg clockwise from north) as literal unit vectors (x east, z south) — engine independent
const ROUTES = [
  { b: 315, dx: -0.7071067811865476, dz: -0.7071067811865476, name: { en: 'Northwest Highway', nl: 'Noordwestweg' } },
  { b: 272, dx: -0.9993908270190958, dz: -0.03489949670250097, name: { en: 'West Highway', nl: 'Westweg' } },
  { b: 232, dx: -0.7880107536067219, dz: 0.6156614753256583, name: { en: 'Southwest Highway', nl: 'Zuidwestweg' } },
  { b: 196, dx: -0.27563735581699916, dz: 0.9612616959383189, name: { en: 'South Highway', nl: 'Zuidweg' } },
  { b: 160, dx: 0.3420201433256687, dz: 0.9396926207859084, name: { en: 'South-East Highway', nl: 'Zuidoosterweg' } },
  { b: 128, dx: 0.7880107536067219, dz: 0.6156614753256583, name: { en: 'Southeast Highway', nl: 'Zuidoostweg' } },
  { b: 98, dx: 0.9902680687415704, dz: 0.13917310096006544, name: { en: 'East Highway', nl: 'Oostweg' } },
];
// heading rotations: cos/sin of 0°, ±12°, ±24°
const TURNS = [
  [1, 0],
  [0.9781476007338057, 0.20791169081775934],
  [0.9781476007338057, -0.20791169081775934],
  [0.9135454576426009, 0.40673664307580015],
  [0.9135454576426009, -0.40673664307580015],
];

const SPACING = 10;
const CELL = 32;
const RASTER = 32;
const CORR_REACH = 320;
const SH_CELL = 64; // shoulder index cell (m)
const SH_MAX = 160; // widest shoulder (m)
const SH_K = 2.4; // shoulder width per metre of fill / cut

/**
 * @param o.seam   hub seam (hub.js)
 * @param o.baseH  (x, z) → combined natural height (seam + procedural, no roads / pads)
 * @param o.setCorridor  terrain.setCorridor
 * @param o.data   previously exported data (worker): skips routing, identical result
 */
export function createHighways({ seam, baseH, setCorridor, data = null }) {
  const extent = seam.extent;
  let roads;
  if (data && Array.isArray(data.roads)) {
    roads = data.roads.map((r) => ({ ...r, points: Float64Array.from(r.points) }));
  } else {
    roads = [];
    if (seam.hasHub) {
      for (let k = 0; k < ROUTES.length; k++) {
        const route = ROUTES[k];
        const gate = findGate(seam, route);
        if (!gate) continue;
        const xz = trace(route, gate, baseH, extent);
        if (xz.length < 2 * 30) continue; // < 600 m: not worth a highway
        roads.push({ id: `hw-${k}`, index: roads.length, bearing: route.b, name: route.name, gate, xz });
      }
    }
  }

  // corridor raster (distance to the nearest centreline) → terrain damping
  const corr = buildCorridor(roads.map((r) => r.points ? xzOf(r.points) : r.xz));
  if (setCorridor && corr) setCorridor((x, z) => corr.weight(x, z));

  // elevation profiles from the damped terrain
  if (!data) {
    for (const r of roads) {
      r.points = profile(r.xz, baseH);
      delete r.xz;
      r.length = arcLength(r.points);
    }
  }

  // segment arrays + CSR index
  let segCount = 0;
  for (const r of roads) segCount += Math.max(0, r.points.length / 3 - 1);
  const sAx = new Float64Array(segCount);
  const sAz = new Float64Array(segCount);
  const sAy = new Float64Array(segCount);
  const sBx = new Float64Array(segCount);
  const sBz = new Float64Array(segCount);
  const sBy = new Float64Array(segCount);
  const sS = new Float64Array(segCount); // arc length at A
  const sRoad = new Int16Array(segCount);
  let g = 0;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of roads) {
    const p = r.points;
    let s = 0;
    for (let i = 0; i + 5 < p.length; i += 3) {
      sAx[g] = p[i];
      sAy[g] = p[i + 1];
      sAz[g] = p[i + 2];
      sBx[g] = p[i + 3];
      sBy[g] = p[i + 4];
      sBz[g] = p[i + 5];
      sS[g] = s;
      sRoad[g] = r.index;
      s += Math.sqrt((p[i + 3] - p[i]) ** 2 + (p[i + 5] - p[i + 2]) ** 2);
      minX = Math.min(minX, p[i], p[i + 3]);
      maxX = Math.max(maxX, p[i], p[i + 3]);
      minZ = Math.min(minZ, p[i + 2], p[i + 5]);
      maxZ = Math.max(maxZ, p[i + 2], p[i + 5]);
      g++;
    }
    r.waystones = waystones(r);
  }
  const PAD = 40;
  const ix0 = Math.floor((minX - PAD) / CELL);
  const iz0 = Math.floor((minZ - PAD) / CELL);
  const nx = segCount ? Math.floor((maxX + PAD) / CELL) - ix0 + 1 : 0;
  const nz = segCount ? Math.floor((maxZ + PAD) / CELL) - iz0 + 1 : 0;
  const start = new Int32Array(nx * nz + 1);
  const REG = HIGHWAY.reach + 4;
  const cellsOf = (k, fn) => {
    const a0 = Math.floor((Math.min(sAx[k], sBx[k]) - REG) / CELL) - ix0;
    const a1 = Math.floor((Math.max(sAx[k], sBx[k]) + REG) / CELL) - ix0;
    const b0 = Math.floor((Math.min(sAz[k], sBz[k]) - REG) / CELL) - iz0;
    const b1 = Math.floor((Math.max(sAz[k], sBz[k]) + REG) / CELL) - iz0;
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) fn(b * nx + a);
  };
  for (let k = 0; k < segCount; k++) cellsOf(k, (c) => start[c + 1]++);
  for (let c = 0; c < nx * nz; c++) start[c + 1] += start[c];
  const list = new Int32Array(start[nx * nz] || 0);
  const fill = start.slice(0, nx * nz);
  for (let k = 0; k < segCount; k++) cellsOf(k, (c) => (list[fill[c]++] = k));

  // ---- wide shoulders: coarse (30 m) segments with the road's fill / cut against the base terrain
  let cCount = 0;
  for (const r of roads) cCount += Math.max(0, Math.ceil((r.points.length / 3 - 1) / 3));
  const cAx = new Float64Array(cCount);
  const cAz = new Float64Array(cCount);
  const cAy = new Float64Array(cCount);
  const cAf = new Float64Array(cCount);
  const cBx = new Float64Array(cCount);
  const cBz = new Float64Array(cCount);
  const cBy = new Float64Array(cCount);
  const cBf = new Float64Array(cCount);
  {
    const fillAt = (x, y, z) => (seam.outside(x, z) > 0.5 ? y - baseH(x, z) : 0);
    let k = 0;
    for (const r of roads) {
      const p = r.points;
      const n = p.length / 3;
      let i = 0;
      let fa = fillAt(p[0], p[1], p[2]);
      while (i < n - 1) {
        const j = Math.min(n - 1, i + 3);
        const fb = fillAt(p[j * 3], p[j * 3 + 1], p[j * 3 + 2]);
        cAx[k] = p[i * 3];
        cAy[k] = p[i * 3 + 1];
        cAz[k] = p[i * 3 + 2];
        cAf[k] = fa;
        cBx[k] = p[j * 3];
        cBy[k] = p[j * 3 + 1];
        cBz[k] = p[j * 3 + 2];
        cBf[k] = fb;
        fa = fb;
        i = j;
        k++;
      }
    }
    cCount = k;
  }
  const SREG = SH_MAX + 2;
  let cx0 = 0;
  let cz0 = 0;
  let cnx = 0;
  let cnz = 0;
  if (cCount) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let k = 0; k < cCount; k++) {
      x0 = Math.min(x0, cAx[k], cBx[k]);
      x1 = Math.max(x1, cAx[k], cBx[k]);
      z0 = Math.min(z0, cAz[k], cBz[k]);
      z1 = Math.max(z1, cAz[k], cBz[k]);
    }
    cx0 = Math.floor((x0 - SREG) / SH_CELL);
    cz0 = Math.floor((z0 - SREG) / SH_CELL);
    cnx = Math.floor((x1 + SREG) / SH_CELL) - cx0 + 1;
    cnz = Math.floor((z1 + SREG) / SH_CELL) - cz0 + 1;
  }
  const cStart = new Int32Array(cnx * cnz + 1);
  const cCells = (k, fn) => {
    // only segments that can have a shoulder at all (|fill| ≥ 3 m at one end)
    if (Math.abs(cAf[k]) < 3 && Math.abs(cBf[k]) < 3) return;
    const a0 = Math.floor((Math.min(cAx[k], cBx[k]) - SREG) / SH_CELL) - cx0;
    const a1 = Math.floor((Math.max(cAx[k], cBx[k]) + SREG) / SH_CELL) - cx0;
    const b0 = Math.floor((Math.min(cAz[k], cBz[k]) - SREG) / SH_CELL) - cz0;
    const b1 = Math.floor((Math.max(cAz[k], cBz[k]) + SREG) / SH_CELL) - cz0;
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) fn(b * cnx + a);
  };
  for (let k = 0; k < cCount; k++) cCells(k, (c) => cStart[c + 1]++);
  for (let c = 0; c < cnx * cnz; c++) cStart[c + 1] += cStart[c];
  const cList = new Int32Array(cStart[cnx * cnz] || 0);
  {
    const fill2 = cStart.slice(0, cnx * cnz);
    for (let k = 0; k < cCount; k++) cCells(k, (c) => (cList[fill2[c]++] = k));
  }

  /**
   * Wide shoulders on a terrain height: the ground follows the road where it runs high
   * above (spur) or deep below (cutting) the terrain; weights blended over every nearby
   * segment, so the result is continuous at bends and between roads.
   */
  function shoulder(x, z, h) {
    if (!cList.length) return h;
    const a = Math.floor(x / SH_CELL) - cx0;
    const b = Math.floor(z / SH_CELL) - cz0;
    if (a < 0 || b < 0 || a >= cnx || b >= cnz) return h;
    const c = b * cnx + a;
    const q1 = cStart[c + 1];
    let q = cStart[c];
    if (q === q1) return h;
    let sw = 0;
    let sy = 0;
    let wmax = 0;
    for (; q < q1; q++) {
      const k = cList[q];
      const vx = cBx[k] - cAx[k];
      const vz = cBz[k] - cAz[k];
      const l2 = vx * vx + vz * vz || 1e-9;
      let t = ((x - cAx[k]) * vx + (z - cAz[k]) * vz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - cAx[k] - vx * t;
      const ez = z - cAz[k] - vz * t;
      const d2 = ex * ex + ez * ez;
      if (d2 >= SH_MAX * SH_MAX) continue;
      const f = cAf[k] + (cBf[k] - cAf[k]) * t;
      const af = f < 0 ? -f : f;
      if (af <= 3) continue;
      const W = Math.min(SH_MAX, HIGHWAY.reach + SH_K * af);
      const d = Math.sqrt(d2);
      if (d >= W) continue;
      const w = (1 - sstep(HIGHWAY.flat, W, d)) * sstep(3, 9, af);
      if (w <= 0) continue;
      sw += w;
      sy += w * (cAy[k] + (cBy[k] - cAy[k]) * t);
      if (w > wmax) wmax = w;
    }
    if (!(sw > 0)) return h;
    const e = seam.outside(x, z);
    if (e < 30) wmax *= e <= 0 ? 0 : sstep(0, 30, e);
    return mix(h, sy / sw, wmax);
  }

  // nearest-segment query result (reused)
  const Q = { seg: -1, dist: 0, t: 0, x: 0, z: 0, y: 0 };

  /** Exact distance to the nearest centreline for any reach (scans the cells of the query box). */
  function distanceWide(x, z, reach) {
    if (!segCount) return Infinity;
    const a0 = Math.max(0, Math.floor((x - reach) / CELL) - ix0);
    const a1 = Math.min(nx - 1, Math.floor((x + reach) / CELL) - ix0);
    const b0 = Math.max(0, Math.floor((z - reach) / CELL) - iz0);
    const b1 = Math.min(nz - 1, Math.floor((z + reach) / CELL) - iz0);
    let best = reach * reach;
    let found = false;
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        const c = b * nx + a;
        for (let q = start[c]; q < start[c + 1]; q++) {
          const k = list[q];
          const vx = sBx[k] - sAx[k];
          const vz = sBz[k] - sAz[k];
          const l2 = vx * vx + vz * vz || 1e-9;
          let t = ((x - sAx[k]) * vx + (z - sAz[k]) * vz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = x - sAx[k] - vx * t;
          const ez = z - sAz[k] - vz * t;
          const d2 = ex * ex + ez * ez;
          if (d2 < best) {
            best = d2;
            found = true;
          }
        }
      }
    }
    return found ? Math.sqrt(best) : Infinity;
  }

  /** Nearest centreline point within `reach` m → Q (shared object) or null. */
  function nearest(x, z, reach = HIGHWAY.reach) {
    if (!segCount) return null;
    const a = Math.floor(x / CELL) - ix0;
    const b = Math.floor(z / CELL) - iz0;
    if (a < 0 || b < 0 || a >= nx || b >= nz) return null;
    const c = b * nx + a;
    let best = reach * reach;
    let bs = -1;
    let bt = 0;
    for (let q = start[c]; q < start[c + 1]; q++) {
      const k = list[q];
      const vx = sBx[k] - sAx[k];
      const vz = sBz[k] - sAz[k];
      const l2 = vx * vx + vz * vz || 1e-9;
      let t = ((x - sAx[k]) * vx + (z - sAz[k]) * vz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - sAx[k] - vx * t;
      const ez = z - sAz[k] - vz * t;
      const d2 = ex * ex + ez * ez;
      if (d2 < best) {
        best = d2;
        bs = k;
        bt = t;
      }
    }
    if (bs < 0) return null;
    Q.seg = bs;
    Q.t = bt;
    Q.dist = Math.sqrt(best);
    Q.x = sAx[bs] + (sBx[bs] - sAx[bs]) * bt;
    Q.z = sAz[bs] + (sBz[bs] - sAz[bs]) * bt;
    Q.y = sAy[bs] + (sBy[bs] - sAy[bs]) * bt;
    return Q;
  }

  /** Road stamp on a terrain height (flat paving, smooth shoulders); fades in over the first 30 m past the hub. */
  function stamp(x, z, h) {
    const q = nearest(x, z, HIGHWAY.reach);
    if (!q) return h;
    let w = 1 - sstep(HIGHWAY.flat, HIGHWAY.reach, q.dist);
    if (w <= 0) return h;
    const e = seam.outside(x, z);
    if (e < 30) w *= e <= 0 ? 0 : sstep(0, 30, e);
    return mix(h, q.y, w);
  }

  /** Public info about the road near (x, z) within r → [{ id, name, distance, point, heading, width }]. */
  function near(x, z, r) {
    const out = [];
    if (!segCount) return out;
    const R = Math.max(1, r);
    // walk the cells of the query box; keep the nearest point per road
    const a0 = Math.max(0, Math.floor((x - R) / CELL) - ix0);
    const a1 = Math.min(nx - 1, Math.floor((x + R) / CELL) - ix0);
    const b0 = Math.max(0, Math.floor((z - R) / CELL) - iz0);
    const b1 = Math.min(nz - 1, Math.floor((z + R) / CELL) - iz0);
    const best = new Map();
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        const c = b * nx + a;
        for (let q = start[c]; q < start[c + 1]; q++) {
          const k = list[q];
          const vx = sBx[k] - sAx[k];
          const vz = sBz[k] - sAz[k];
          const l2 = vx * vx + vz * vz || 1e-9;
          let t = ((x - sAx[k]) * vx + (z - sAz[k]) * vz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = sAx[k] + vx * t;
          const pz = sAz[k] + vz * t;
          const d = Math.sqrt((x - px) ** 2 + (z - pz) ** 2);
          if (d > R) continue;
          const prev = best.get(sRoad[k]);
          if (!prev || d < prev.distance) {
            const l = Math.sqrt(l2);
            best.set(sRoad[k], {
              road: sRoad[k],
              distance: d,
              point: { x: px, y: sAy[k] + (sBy[k] - sAy[k]) * t, z: pz },
              dir: { x: vx / l, z: vz / l },
              s: sS[k] + t * l,
            });
          }
        }
      }
    }
    for (const v of best.values()) {
      const r0 = roads[v.road];
      out.push({ id: r0.id, name: r0.name, width: HIGHWAY.width, distance: v.distance, point: v.point, dir: v.dir, along: v.s, heading: Math.atan2(-v.dir.x, -v.dir.z) });
    }
    out.sort((p, q) => p.distance - q.distance);
    return out;
  }

  return {
    roads,
    count: roads.length,
    nearest,
    stamp,
    shoulder,
    near,
    corridor: corr,
    /** Distance to the nearest centreline (exact up to `reach`), Infinity when none within. */
    distance(x, z, reach = 60) {
      if (reach > REG) return distanceWide(x, z, reach);
      const q = nearest(x, z, reach);
      return q ? q.dist : Infinity;
    },
    exportData() {
      return { roads: roads.map((r) => ({ id: r.id, index: r.index, bearing: r.bearing, name: r.name, gate: r.gate, points: Array.from(r.points), length: r.length })) };
    },
  };
}

function xzOf(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 3) out.push(points[i], points[i + 2]);
  return out;
}

/** Lowest point of the smoothed border profile near where the bearing leaves the hub square. */
function findGate(seam, route) {
  const E = seam.extent;
  const prof = seam.edgeProfile;
  // exit point of the ray from the origin
  const s = E / Math.max(Math.abs(route.dx), Math.abs(route.dz));
  const ex = route.dx * s;
  const ez = route.dz * s;
  let side;
  let along;
  if (Math.abs(route.dx) >= Math.abs(route.dz)) {
    side = route.dx < 0 ? 2 : 3;
    along = ez;
  } else {
    side = route.dz < 0 ? 0 : 1;
    along = ex;
  }
  let best = Infinity;
  let bestS = along;
  for (let o = -260; o <= 260; o += 10) {
    const a = along + o;
    if (a < -E + 120 || a > E - 120) continue;
    const k = Math.round((a + E) / prof.step);
    const h = prof.smooth[side * prof.n + k];
    if (h < 1.5) continue; // the gate must be on land
    const score = h + Math.abs(o) * 0.12;
    if (score < best) {
      best = score;
      bestS = a;
    }
  }
  if (best === Infinity) return null;
  const x = side === 2 ? -E : side === 3 ? E : bestS;
  const z = side === 0 ? -E : side === 1 ? E : bestS;
  const nxo = side === 2 ? -1 : side === 3 ? 1 : 0;
  const nzo = side === 0 ? -1 : side === 1 ? 1 : 0;
  return { x, z, side, nx: nxo, nz: nzo };
}

// A* move set on the (u along the bearing, v across) grid: 8 neighbours + knight moves (smoother angles)
const MOVES = [
  [1, 0], [1, 1], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, -1], [-1, 0],
  [2, 1], [2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2], [-2, 1], [-2, -1],
];
const ACELL = 70; // m
const AHALF = 17; // cells either side of the bearing line (±1.2 km)
const AEPS = 1.5; // weighted A*: slightly greedy, far fewer expansions

/**
 * Route from the gate along the bearing: A* on a 60 m grid in a ±1.3 km
* corridor (weighted ×1.5), cost = length × (1 + 30·grade²) + steepness above 10 % + water,
 * goal = any cell ~HIGHWAY.length beyond the gate (or the last land before open
 * sea). Returns a smoothed polyline resampled every 10 m (flat [x, z, …]).
 */
function trace(route, gate, H, extent) {
  const ux = route.dx;
  const uz = route.dz;
  const vx = -uz;
  const vz = ux;
  // start a little outside the gate (the first cell), heading out of the hub
  const sx = gate.x + gate.nx * 30;
  const sz = gate.z + gate.nz * 30;
  // how far does land reach along the bearing? (stop before open sea)
  let goalU = Math.round(HIGHWAY.length / ACELL);
  {
    let wet = 0;
    for (let iu = 4; iu <= goalU; iu++) {
      const h = H(sx + ux * iu * ACELL, sz + uz * iu * ACELL);
      wet = h < -1 ? wet + 1 : 0;
      if (wet >= 6) {
        goalU = Math.max(Math.round(1500 / ACELL), iu - wet - 1);
        break;
      }
    }
  }
  const NU = goalU + 3;
  const NV = 2 * AHALF + 1;
  const n = NU * NV;
  const hgt = new Float32Array(n).fill(NaN);
  const g = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const px = (iu, iv) => sx + ux * iu * ACELL + vx * iv * ACELL;
  const pz = (iu, iv) => sz + uz * iu * ACELL + vz * iv * ACELL;
  const heightOf = (k) => {
    let h = hgt[k];
    if (h !== h) {
      const iu = (k / NV) | 0;
      const iv = (k % NV) - AHALF;
      const x = px(iu, iv);
      const z = pz(iu, iv);
      h = Math.max(Math.abs(x), Math.abs(z)) < extent + 20 ? 1e6 : H(x, z);
      hgt[k] = h;
    }
    return h;
  };
  // binary heap of cell indices keyed by f
  const heap = new Int32Array(n * 4 + 16);
  const fkey = new Float64Array(n);
  let hn = 0;
  const push = (k, f) => {
    fkey[k] = f;
    let i = hn++;
    heap[i] = k;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fkey[heap[p]] <= f) break;
      heap[i] = heap[p];
      heap[p] = k;
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap[--hn];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= hn) break;
      const r = l + 1;
      const c = r < hn && fkey[heap[r]] < fkey[heap[l]] ? r : l;
      if (fkey[heap[c]] >= fkey[last]) break;
      heap[i] = heap[c];
      i = c;
    }
    heap[i] = last;
    return top;
  };
  const start = AHALF; // (iu 0, iv 0)
  g[start] = 0;
  const hStart = heightOf(start);
  push(start, goalU * ACELL);
  let goal = -1;
  while (hn > 0) {
    const k = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    const iu = (k / NV) | 0;
    const iv = (k % NV) - AHALF;
    if (iu >= goalU) {
      goal = k;
      break;
    }
    const h0 = hgt[k];
    for (let m = 0; m < MOVES.length; m++) {
      const nu = iu + MOVES[m][0];
      const nv = iv + MOVES[m][1];
      if (nu < 0 || nu >= NU || nv < -AHALF || nv > AHALF) continue;
      const q = nu * NV + nv + AHALF;
      if (closed[q]) continue;
      const h1 = heightOf(q);
      if (h1 > 1e5) continue;
      const len = ACELL * Math.sqrt(MOVES[m][0] * MOVES[m][0] + MOVES[m][1] * MOVES[m][1]);
      const gr = Math.abs(h1 - h0) / len;
      let cost = len * (1 + 30 * gr * gr);
      if (gr > 0.1) cost += (gr - 0.1) * len * 120;
      if (h1 < 1.5) cost += len * 10;
      // stay near the bearing line (soft): sideways drift costs a little
      cost += len * 0.004 * Math.abs(nv);
      // leave the hub border behind (no contour-hugging along the ring mountains) …
      const qx = px(nu, nv);
      const qz = pz(nu, nv);
      const eo = Math.max(Math.abs(qx), Math.abs(qz)) - extent;
      cost += len * 1.5 * (1 - sstep(60, 450, eo));
      // … and only where a ≤ 9 % road from the gate can actually follow the ground (else: walls / deep cuts)
      const reach = Math.abs(h1 - hStart) - 0.11 * (nu + 1) * ACELL;
      if (reach > 0) cost += len * reach * 0.25;
      const ng = g[k] + cost;
      if (ng < g[q]) {
        g[q] = ng;
        from[q] = k;
        push(q, ng + AEPS * (goalU - nu > 0 ? (goalU - nu) * ACELL : 0));
      }
    }
  }
  const pts = [gate.x, gate.z];
  if (goal >= 0) {
    const cells = [];
    for (let k = goal; k >= 0; k = from[k]) cells.push(k);
    cells.reverse();
    for (const k of cells) {
      const iu = (k / NV) | 0;
      const iv = (k % NV) - AHALF;
      pts.push(px(iu, iv), pz(iu, iv));
    }
  }
  // resample at 20 m, smooth hard (grid corners → gentle curves; gate fixed), resample at 10 m
  let p = resample(pts, 20);
  for (let pass = 0; pass < 24; pass++) {
    const q = p.slice();
    for (let i = 2; i + 2 < p.length; i += 2) {
      q[i] = p[i - 2] * 0.25 + p[i] * 0.5 + p[i + 2] * 0.25;
      q[i + 1] = p[i - 1] * 0.25 + p[i + 1] * 0.5 + p[i + 3] * 0.25;
    }
    p = q;
  }
  return resample(p, SPACING);
}

function resample(p, spacing) {
  const out = [p[0], p[1]];
  let carry = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i];
    const az = p[i + 1];
    const dx = p[i + 2] - ax;
    const dz = p[i + 3] - az;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-9) continue;
    let s = spacing - carry;
    while (s <= l) {
      out.push(ax + (dx * s) / l, az + (dz * s) / l);
      s += spacing;
    }
    carry = l - (s - spacing);
  }
  const lx = p[p.length - 2];
  const lz = p[p.length - 1];
  if (Math.hypot(out[out.length - 2] - lx, out[out.length - 1] - lz) > spacing * 0.3) out.push(lx, lz);
  return out;
}

/** Heights along the centreline: smoothed terrain, grade-limited, dry → Float64Array [x, y, z, …]. */
function profile(xz, H) {
  const n = xz.length / 2;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = H(xz[2 * i], xz[2 * i + 1]);
  let y = Float64Array.from(raw);
  for (let pass = 0; pass < 3; pass++) {
    const q = new Float64Array(n);
    const R = 6;
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      for (let k = -R; k <= R; k++) {
        const j = i + k < 0 ? 0 : i + k >= n ? n - 1 : i + k;
        s += y[j];
        c++;
      }
      q[i] = s / c;
    }
    y = q;
  }
  // start exactly on the hub border, easing into the smoothed grade over 50 m
  for (let i = 0; i < Math.min(n, 6); i++) y[i] = mix(raw[0], y[i], sstep(0, 5, i));
  y[0] = raw[0];
  for (let i = 0; i < n; i++) if (y[i] < 1.6) y[i] = 1.6;
  // grade limit with the real spacing of every segment; the gate end is pinned, so
  // forward → backward → forward (the last pass restores the pinned side)
  const lim = new Float64Array(n);
  for (let i = 1; i < n; i++) lim[i] = HIGHWAY.maxGrade * Math.sqrt((xz[2 * i] - xz[2 * i - 2]) ** 2 + (xz[2 * i + 1] - xz[2 * i - 1]) ** 2);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n; i++) y[i] = Math.min(y[i - 1] + lim[i], Math.max(y[i - 1] - lim[i], y[i]));
    if (pass === 0) for (let i = n - 2; i >= 1; i--) y[i] = Math.min(y[i + 1] + lim[i + 1], Math.max(y[i + 1] - lim[i + 1], y[i]));
  }
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[3 * i] = xz[2 * i];
    out[3 * i + 1] = y[i];
    out[3 * i + 2] = xz[2 * i + 1];
  }
  return out;
}

function arcLength(p) {
  let s = 0;
  for (let i = 0; i + 5 < p.length; i += 3) s += Math.sqrt((p[i + 3] - p[i]) ** 2 + (p[i + 5] - p[i + 2]) ** 2);
  return s;
}

function waystones(r) {
  const out = [];
  const p = r.points;
  let s = 0;
  let next = HIGHWAY.waystoneEvery;
  let km = 1;
  for (let i = 0; i + 5 < p.length; i += 3) {
    const dx = p[i + 3] - p[i];
    const dz = p[i + 5] - p[i + 2];
    const l = Math.sqrt(dx * dx + dz * dz);
    while (l > 0 && s + l >= next) {
      const t = (next - s) / l;
      const ux = dx / l;
      const uz = dz / l;
      // right-hand side of the direction of travel (away from the hub): (−uz, ux)
      const x = p[i] + dx * t - uz * HIGHWAY.waystoneSide;
      const z = p[i + 2] + dz * t + ux * HIGHWAY.waystoneSide;
      out.push({ id: `w:${r.index}:${km}`, type: 'waystone', road: r.id, km, x, z, y: p[i + 1] + (p[i + 4] - p[i + 1]) * t, dir: [ux, uz], rot: Math.atan2(-ux, -uz) });
      km++;
      next += HIGHWAY.waystoneEvery;
    }
    s += l;
  }
  return out;
}

/** Distance raster (32 m) to the nearest centreline within 320 m → smooth damping weight. */
function buildCorridor(lines) {
  if (!lines.length) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const xz of lines) {
    for (let i = 0; i < xz.length; i += 2) {
      minX = Math.min(minX, xz[i]);
      maxX = Math.max(maxX, xz[i]);
      minZ = Math.min(minZ, xz[i + 1]);
      maxZ = Math.max(maxZ, xz[i + 1]);
    }
  }
  const x0 = Math.floor((minX - CORR_REACH) / RASTER) * RASTER;
  const z0 = Math.floor((minZ - CORR_REACH) / RASTER) * RASTER;
  const nx = Math.ceil((maxX + CORR_REACH - x0) / RASTER) + 1;
  const nz = Math.ceil((maxZ + CORR_REACH - z0) / RASTER) + 1;
  const dist = new Float32Array(nx * nz).fill(CORR_REACH);
  for (const xz of lines) {
    // every 3rd point (30 m segments) is plenty for a 60–300 m ramp
    for (let i = 0; i + 2 < xz.length; i += 6) {
      const j = Math.min(i + 6, xz.length - 2);
      const ax = xz[i];
      const az = xz[i + 1];
      const vx = xz[j] - ax;
      const vz = xz[j + 1] - az;
      const l2 = vx * vx + vz * vz || 1e-9;
      const a0 = Math.max(0, Math.floor((Math.min(ax, ax + vx) - CORR_REACH - x0) / RASTER));
      const a1 = Math.min(nx - 1, Math.ceil((Math.max(ax, ax + vx) + CORR_REACH - x0) / RASTER));
      const b0 = Math.max(0, Math.floor((Math.min(az, az + vz) - CORR_REACH - z0) / RASTER));
      const b1 = Math.min(nz - 1, Math.ceil((Math.max(az, az + vz) + CORR_REACH - z0) / RASTER));
      for (let b = b0; b <= b1; b++) {
        const pz = z0 + b * RASTER;
        for (let a = a0; a <= a1; a++) {
          const px = x0 + a * RASTER;
          let t = ((px - ax) * vx + (pz - az) * vz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - ax - vx * t;
          const ez = pz - az - vz * t;
          const d = Math.sqrt(ex * ex + ez * ez);
          const k = b * nx + a;
          if (d < dist[k]) dist[k] = d;
        }
      }
    }
  }
  function distanceAt(x, z) {
    let fx = (x - x0) / RASTER;
    let fz = (z - z0) / RASTER;
    if (fx < 0 || fz < 0 || fx > nx - 1.001 || fz > nz - 1.001) return CORR_REACH;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * nx + i;
    return (dist[k] * (1 - tx) + dist[k + 1] * tx) * (1 - tz) + (dist[k + nx] * (1 - tx) + dist[k + nx + 1] * tx) * tz;
  }
  return {
    distanceAt,
    weight: (x, z) => {
      if (x < x0 || z < z0 || x > x0 + (nx - 1) * RASTER || z > z0 + (nz - 1) * RASTER) return 0;
      return 1 - sstep(60, 300, distanceAt(x, z));
    },
  };
}
