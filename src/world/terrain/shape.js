import {
  WORLD, ZONES, LAKE, ISLANDS, CITY_ISLANDS, RIVERS, WATERFALLS, ROADS, REGIONS, RACE_TRACK,
} from '../layout.js';
import { Rng } from '../../core/math.js';

/**
 * Terrain shaping data derived from layout.js plus small pure helpers
 * (polylines, splines, smooth min/max). Everything here is plain data/math so
 * the heightfield bake also runs outside the browser (Node tests).
 *
 * Feature overview (see heightfield.js for how they combine):
 *   - western ridge: spawn ledge (46 m) rising WNW to the lookout peak (92 m)
 *   - escarpments: cliff lines through the waterfall lips (lake on one side)
 *   - pads: flat zone areas (+ the spaceport rectangle and hangar footprint)
 *   - islets: extra small rocky islets / sea stacks for a richer lake
 */

export const GRID_N = 1201; // samples per side (2 m spacing over ±1200 m)
export const GRID_STEP = WORLD.size / (GRID_N - 1);
export const HALF = WORLD.half;

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const sstep = (e0, e1, x) => {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, t) => a + (b - a) * t;
/** sqrt(a² + b²) — Math.hypot is several times slower in V8 hot loops. */
export const len2 = (a, b) => Math.sqrt(a * a + b * b);
/** Polynomial smooth minimum (k = blend radius). */
export function smin(a, b, k) {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return mix(b, a, h) - k * h * (1 - h);
}
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}
/** Approximate signed distance to an axis-aligned ellipse (negative inside). */
export function ellipseSD(dx, dz, rx, rz) {
  const k0 = Math.sqrt((dx * dx) / (rx * rx) + (dz * dz) / (rz * rz));
  const k1 = Math.sqrt((dx * dx) / (rx * rx * rx * rx) + (dz * dz) / (rz * rz * rz * rz));
  return k1 < 1e-9 ? -Math.min(rx, rz) : (k0 * (k0 - 1)) / k1;
}

// ------------------------------------------------------------------ polylines
/**
 * Polyline with per-vertex values (e.g. water height). `nearest(x, z)` writes
 * {d (unsigned), s (signed: + on the left normal (-dz, dx)), t (arc length),
 * v (interpolated value), u (0..1 on the segment), seg} into `out`.
 */
export class Polyline {
  constructor(points, { closed = false } = {}) {
    this.closed = closed;
    this.pts = points.map((p) => [p[0], p[1], p[2] ?? 0]);
    const n = this.pts.length;
    const segCount = closed ? n : n - 1;
    this.seg = [];
    let acc = 0;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < segCount; i++) {
      const a = this.pts[i];
      const b = this.pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1e-6;
      this.seg.push({ ax: a[0], az: a[1], dx, dz, len, len2: len * len, t0: acc, va: a[2], vb: b[2] });
      acc += len;
      minX = Math.min(minX, a[0], b[0]);
      maxX = Math.max(maxX, a[0], b[0]);
      minZ = Math.min(minZ, a[1], b[1]);
      maxZ = Math.max(maxZ, a[1], b[1]);
    }
    this.length = acc;
    this.bbox = { minX, minZ, maxX, maxZ };
  }

  nearest(x, z, out = {}) {
    let best = Infinity;
    for (let i = 0; i < this.seg.length; i++) {
      const s = this.seg[i];
      let u = ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.len2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const px = s.ax + s.dx * u;
      const pz = s.az + s.dz * u;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) {
        best = d2;
        out.seg = i;
        out.u = u;
        out.px = px;
        out.pz = pz;
      }
    }
    const s = this.seg[out.seg];
    out.d = Math.sqrt(best);
    // signed lateral offset relative to the segment's left normal (-dz, dx)
    out.s = ((x - s.ax) * -s.dz + (z - s.az) * s.dx) / s.len;
    out.t = s.t0 + s.len * out.u;
    out.v = s.va + (s.vb - s.va) * out.u;
    // projection beyond the open ends (for caps)
    out.beyondStart = !this.closed && out.seg === 0 && out.u <= 0;
    out.beyondEnd = !this.closed && out.seg === this.seg.length - 1 && out.u >= 1;
    return out;
  }

  /**
   * Allocation-free nearest(): writes [d, s (signed lateral), t (arc length),
   * v (interpolated value), u, seg] into the Float64Array `o`.
   */
  nearestInto(x, z, o) {
    let best = Infinity;
    let bi = 0;
    let bu = 0;
    const segs = this.seg;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      let u = ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.len2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = x - s.ax - s.dx * u;
      const ez = z - s.az - s.dz * u;
      const d2 = ex * ex + ez * ez;
      if (d2 < best) {
        best = d2;
        bi = i;
        bu = u;
      }
    }
    const s = segs[bi];
    o[0] = Math.sqrt(best);
    o[1] = ((x - s.ax) * -s.dz + (z - s.az) * s.dx) / s.len;
    o[2] = s.t0 + s.len * bu;
    o[3] = s.va + (s.vb - s.va) * bu;
    o[4] = bu;
    o[5] = bi;
    return o;
  }

  /** Point + tangent at arc length t (clamped / wrapped when closed). */
  at(t, out = {}) {
    if (this.closed) t = ((t % this.length) + this.length) % this.length;
    else t = Math.max(0, Math.min(this.length, t));
    let i = 0;
    while (i < this.seg.length - 1 && this.seg[i].t0 + this.seg[i].len < t) i++;
    const s = this.seg[i];
    const u = Math.max(0, Math.min(1, (t - s.t0) / s.len));
    out.x = s.ax + s.dx * u;
    out.z = s.az + s.dz * u;
    out.v = s.va + (s.vb - s.va) * u;
    out.tx = s.dx / s.len;
    out.tz = s.dz / s.len;
    return out;
  }
}

/**
 * Centripetal Catmull-Rom resampling of a polyline ([x, z, v?] points) with
 * roughly `spacing` metres between output points. Third component (if any)
 * is interpolated linearly.
 */
export function catmullRom(points, { closed = false, spacing = 2, alpha = 0.5 } = {}) {
  const P = points.map((p) => [p[0], p[1], p[2] ?? 0]);
  const n = P.length;
  const get = (i) => {
    if (closed) return P[((i % n) + n) % n];
    if (i < 0) return [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1], P[0][2]];
    if (i >= n) return [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1], P[n - 1][2]];
    return P[i];
  };
  const out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const td = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-4, alpha);
    const t0 = 0;
    const t1 = t0 + td(p0, p1);
    const t2 = t1 + td(p1, p2);
    const t3 = t2 + td(p2, p3);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(1, Math.ceil(len / spacing));
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const pt = [0, 0];
      for (let c = 0; c < 2; c++) {
        const A1 = ((t1 - t) / (t1 - t0)) * p0[c] + ((t - t0) / (t1 - t0)) * p1[c];
        const A2 = ((t2 - t) / (t2 - t1)) * p1[c] + ((t - t1) / (t2 - t1)) * p2[c];
        const A3 = ((t3 - t) / (t3 - t2)) * p2[c] + ((t - t2) / (t3 - t2)) * p3[c];
        const B1 = ((t2 - t) / (t2 - t0)) * A1 + ((t - t0) / (t2 - t0)) * A2;
        const B2 = ((t3 - t) / (t3 - t1)) * A2 + ((t - t1) / (t3 - t1)) * A3;
        pt[c] = ((t2 - t) / (t2 - t1)) * B1 + ((t - t1) / (t2 - t1)) * B2;
      }
      out.push([pt[0], pt[1], p1[2] + ((p2[2] - p1[2]) * k) / steps]);
    }
  }
  if (!closed) out.push([P[n - 1][0], P[n - 1][1], P[n - 1][2]]);
  return out;
}

// ------------------------------------------------------------------ features
/**
 * Escarpments: cliff lines (x, z, top height). Points are ordered so the
 * LEFT normal (-dz, dx) points toward the water. Waterfall lips are vertices.
 */
const fall = Object.fromEntries(WATERFALLS.map((w) => [w.id, w]));
export const ESCARPMENTS = [
  {
    id: 'west',
    points: [
      [-246, -188, 22],
      [fall.main.lip.x, fall.main.lip.z, fall.main.top],
      [fall['west-1'].lip.x, fall['west-1'].lip.z, fall['west-1'].top],
      [fall['west-2'].lip.x, fall['west-2'].lip.z, fall['west-2'].top],
      [-468, -470, 28],
      [fall['north-west'].lip.x, fall['north-west'].lip.z, fall['north-west'].top],
      [-500, -652, 18],
    ],
    fade: [70, 70], // metres of fade at the start / end
  },
  {
    id: 'east',
    points: [
      [532, -322, 20],
      [fall.east.lip.x, fall.east.lip.z, fall.east.top],
      [430, -214, 12],
    ],
    fade: [45, 45],
  },
].map((e) => ({ ...e, line: new Polyline(e.points) }));

/** Lips of all waterfalls (cliff noise is suppressed around them). */
export const LIPS = WATERFALLS.map((w) => ({ x: w.lip.x, z: w.lip.z, top: w.top, width: w.width }));

/**
 * Western ridge crest: spawn ledge → lookout peak → jungle edge (x, z, crest).
 * The LEFT normal of this polyline points north (toward the lake).
 */
export const RIDGE = new Polyline([
  [110, 136, 30],
  [ZONES.spawn.x, ZONES.spawn.z, 43],
  [-82, 124, 55],
  [-160, 90, 67],
  [-228, 52, 78],
  [ZONES.lookout.x, ZONES.lookout.z, 89],
  [-336, 6, 78],
  [-404, -22, 69],
  [-460, -48, 64],
]);

/**
 * Title-view headland: the spawn ledge's north side falls as a concave
 * hillside to the lake, so the low hero camera (1.3 m above the spawn, 4.4 m
 * behind it) sees the water from the shore to the city. Inside the sector the
 * terrain is capped by `profile` (distance from the spawn centre → height),
 * which stays below every sightline from that camera over the brow.
 */
export const HEADLAND = {
  x: ZONES.spawn.x,
  z: ZONES.spawn.z,
  bearing: 0, // sector centre (radians from north toward east)
  half: [0.72, 1.02], // full effect within ±41°, fades out by ±58°
  reach: 290,
  profile: [
    [0, 46], [2, 45.75], [4.5, 44.9], [8, 43.2], [14, 40.4], [25, 35.6], [50, 28],
    [90, 19.5], [140, 10.5], [190, 3], [225, -1.2], [260, -4.5], [290, -7],
  ],
};
const HEAD_LUT_STEP = 0.5;
const HEAD_LUT = (() => {
  // monotone cubic (Fritsch–Carlson) through the profile, tabulated every 0.5 m
  const P = HEADLAND.profile;
  const n = P.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((P[i + 1][1] - P[i][1]) / (P[i + 1][0] - P[i][0]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  const size = Math.ceil(HEADLAND.reach / HEAD_LUT_STEP) + 2;
  const lut = new Float32Array(size);
  let seg = 0;
  for (let k = 0; k < size; k++) {
    const a = Math.min(P[n - 1][0], k * HEAD_LUT_STEP);
    while (seg < n - 2 && a > P[seg + 1][0]) seg++;
    const x0 = P[seg][0];
    const h = P[seg + 1][0] - x0;
    const t = (a - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    lut[k] = (2 * t3 - 3 * t2 + 1) * P[seg][1] + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * P[seg + 1][1] + (t3 - t2) * h * m[seg + 1];
  }
  return lut;
})();
/** Headland cap height at `a` metres from the spawn centre. */
export function headlandHeight(a) {
  const f = a / HEAD_LUT_STEP;
  const i = f | 0;
  if (i >= HEAD_LUT.length - 1) return HEAD_LUT[HEAD_LUT.length - 1];
  const t = f - i;
  return HEAD_LUT[i] + (HEAD_LUT[i + 1] - HEAD_LUT[i]) * t;
}

/** Flat zone pads (+ blend widths). The spaceport is a rotated-rect union. */
export const PADS = [
  { id: 'spawn', ...pick(ZONES.spawn), blend: 30, dirt: 0.2 },
  { id: 'lookout', ...pick(ZONES.lookout), blend: 34, dirt: 0.6 },
  { id: 'ruins', ...pick(ZONES.ruins), blend: 46, dirt: 0.45 },
  { id: 'signal', ...pick(ZONES.signal), blend: 20, dirt: 0.5 },
  { id: 'waterfall', ...pick(ZONES.waterfall), blend: 18, dirt: 0.3 },
  { id: 'base', ...pick(ZONES.base), blend: 46, dirt: 0.12 },
  { id: 'plaza', ...pick(ZONES.plaza), blend: 40, dirt: 0.9 },
];
function pick(z) {
  return { x: z.x, z: z.z, r: z.radius, elev: z.elevation };
}

const sp = ZONES.spaceport;
const hg = sp.hangar;
/** Spaceport flat area: the rectangle plus the rotated hangar footprint. */
export const SPACEPORT = {
  elev: sp.elevation,
  blend: 46,
  dirt: 0.92,
  rect: { ...sp.rect },
  // hangar as an oriented rect (centre, half sizes, rotation like Object3D.rotation.y)
  hangar: { x: hg.x, z: hg.z, hw: hg.w / 2 + 8, hd: hg.d / 2 + 8, c: Math.cos(hg.rotY), s: Math.sin(hg.rotY) },
};

/** Distance from (x, z) to the spaceport flat area (0 inside). */
export function spaceportDistance(x, z) {
  const r = SPACEPORT.rect;
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  const dRect = Math.sqrt(dx * dx + dz * dz);
  const h = SPACEPORT.hangar;
  // world → hangar local (inverse of rotation about Y)
  const ox = x - h.x;
  const oz = z - h.z;
  const lx = ox * h.c - oz * h.s;
  const lz = ox * h.s + oz * h.c;
  const ex = Math.max(Math.abs(lx) - h.hw, 0);
  const ez = Math.max(Math.abs(lz) - h.hd, 0);
  const dHangar = Math.sqrt(ex * ex + ez * ez);
  return dRect < dHangar ? dRect : dHangar;
}

/**
 * Built-up footprints (from the landmarks engineer): no grass, plants or
 * rocks inside. `grass` = remaining grass factor (0 = none), `pad` = extra
 * metres kept free of plants/rocks around the shape.
 */
const base = ZONES.base;
export const FOOTPRINTS = {
  circles: [
    { id: 'plaza', x: ZONES.plaza.x, z: ZONES.plaza.z, r: 86, grass: 0 }, // paved Nexus-plein incl. curb
    { id: 'lookout', x: ZONES.lookout.x, z: ZONES.lookout.z, r: 8, grass: 0 }, // tower footing
    { id: 'obelisk', x: ZONES.signal.x, z: -163, r: 16, grassR: 13, grass: 0.2 }, // wet shore round the obelisk
    { id: 'landing-pad', x: base.landingPad.x, z: base.landingPad.z, r: 9, grassR: 13, grass: 0 },
  ],
  rects: [
    // base glass house (front faces +X)
    { id: 'house', minX: -282, maxX: -246, minZ: 324, maxZ: 360, grass: 0 },
  ],
};

const FP_REACH = 80; // beyond this the exact distance does not matter (scatter pads ≤ 30 m)
const SP_BOX = { minX: 380 - 120, maxX: 640, minZ: 175 - 120, maxZ: 420 };

/**
 * Signed distance to the nearest built-up footprint (negative inside), incl.
 * the spaceport; returns ≥ FP_REACH (cheaply) when nothing is that close.
 */
export function footprintDistance(x, z) {
  let best = 1e9;
  if (x > SP_BOX.minX && x < SP_BOX.maxX && z > SP_BOX.minZ && z < SP_BOX.maxZ) {
    best = spaceportDistance(x, z);
    if (best <= 0) {
      // inside the rect/hangar union: approximate depth for a negative value
      const r = SPACEPORT.rect;
      best = -Math.min(x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z, 1);
    }
  }
  for (const c of FOOTPRINTS.circles) {
    const dx = x - c.x;
    const dz = z - c.z;
    const lim = c.r + FP_REACH;
    if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
    const d = len2(dx, dz) - c.r;
    if (d < best) best = d;
  }
  for (const b of FOOTPRINTS.rects) {
    if (x < b.minX - FP_REACH || x > b.maxX + FP_REACH || z < b.minZ - FP_REACH || z > b.maxZ + FP_REACH) continue;
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    const out = len2(dx, dz);
    const d = out > 0 ? out : -Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    if (d < best) best = d;
  }
  return best;
}

/** Grass factor 0..1 from the footprints (soft 4 m rim). */
export function footprintGrass(x, z) {
  let g = 1;
  if (spaceportDistance(x, z) < 6) g = Math.min(g, sstep(0, 6, spaceportDistance(x, z)));
  for (const c of FOOTPRINTS.circles) {
    const r = c.grassR ?? c.r;
    const d = len2(x - c.x, z - c.z);
    if (d < r + 4) g = Math.min(g, c.grass + (1 - c.grass) * sstep(r, r + 4, d));
  }
  for (const b of FOOTPRINTS.rects) {
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    const out = len2(dx, dz);
    if (out < 4) g = Math.min(g, b.grass + (1 - b.grass) * sstep(1, 4, out));
  }
  return g;
}

export const JUNGLE = REGIONS.jungle;
export const CANYON = REGIONS.canyon;

/** Race track: straight polygon + centripetal spline (the floor contains both). */
export const TRACK_POLY = new Polyline(RACE_TRACK.points, { closed: true });
export const TRACK_SPLINE = new Polyline(catmullRom(RACE_TRACK.points, { closed: true, spacing: 4 }), { closed: true });

/** Rivers with their straight polylines (third value = water height). */
export const RIVER_LINES = RIVERS.map((r) => ({ ...r, line: new Polyline(r.points) }));

/** Road centrelines (smoothed, ~2 m spacing). */
export const ROAD_LINES = ROADS.map((r) => ({ ...r, dense: catmullRom(r.points, { spacing: 2 }) }));

/** Coastline of the northern sea (z of the coast as a function of x). */
export function coastZ(x) {
  // NW land bulges south-west, the NE coast swings south to the canyon cliffs
  const nw = softplus(-430 - x, 70) * 1.7;
  return -650 - nw + 330 * sstep(330, 720, x);
}
function softplus(v, k) {
  return k * Math.log(1 + Math.exp(v / k));
}

export { WORLD, LAKE, ISLANDS, CITY_ISLANDS, WATERFALLS, ZONES, RACE_TRACK };

/**
 * Extra decorative islets + sea stacks (seeded). `isOpenWater(x, z)` decides
 * whether a candidate lies well inside the water (provided by the bake).
 */
export function makeIslets(isOpenWater) {
  const rng = new Rng('terrain-islets');
  const out = [];
  const blockers = [
    ...ISLANDS.map((i) => ({ x: i.x, z: i.z, r: i.radius + 26 })),
    ...CITY_ISLANDS.map((c) => ({ x: c.x, z: c.z, r: c.radius + 40 })),
    ...WATERFALLS.map((w) => ({ x: w.bottom.x, z: w.bottom.z, r: 40 })),
  ];
  const ok = (x, z, r) => blockers.every((b) => Math.hypot(x - b.x, z - b.z) > b.r + r) && out.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + r + 22);
  // small wooded / rocky islets in the lake (not straight in front of the city centre)
  let tries = 0;
  while (out.length < 16 && tries++ < 900) {
    const x = rng.range(-520, 520);
    const z = rng.range(-720, -170);
    const r = rng.range(7, 17);
    if (!isOpenWater(x, z, r + 14)) continue;
    if (!ok(x, z, r)) continue;
    out.push({ x, z, r, h: rng.range(2.5, 7.5), kind: rng.chance(0.3) ? 'rock' : 'wood' });
  }
  // a few tall sea stacks near the west cliffs and along the NE coast
  const stackZones = [
    { x: -400, z: -330, s: 70 },
    { x: -470, z: -500, s: 60 },
    { x: 560, z: -420, s: 80 },
    { x: 720, z: -380, s: 70 },
    { x: -560, z: -760, s: 80 },
  ];
  for (const zn of stackZones) {
    for (let k = 0; k < 2; k++) {
      for (let t = 0; t < 40; t++) {
        const x = zn.x + rng.range(-zn.s, zn.s);
        const z = zn.z + rng.range(-zn.s, zn.s);
        const r = rng.range(5, 9);
        if (!isOpenWater(x, z, r + 6) || !ok(x, z, r)) continue;
        out.push({ x, z, r, h: rng.range(12, 26), kind: 'stack' });
        break;
      }
    }
  }
  return out;
}
