/**
 * Build placement: 4 m grid math, slot layout, aim raycast (placed pieces +
 * terrain + foreign solids), snapping and validation.
 *
 * Grid: cells of 4 m aligned to ZONES.base.buildArea (the same global grid is
 * used anywhere in the world). Storeys: deck top Y(L+1) = Y(L) + 3.2; walls
 * are 3.0 m and a 0.2 m slab (floor / roof) sits on top.
 * Slots (occupancy keys):
 *   d:i:j:L  deck surface of cell (i, j) at storey L (foundation, floors, roofs)
 *   r:i:j:L  room volume (stairs, prefabs, canopy)
 *   ex:i:j:L wall on the x-aligned edge at z = lineZ(j) (between cells j-1, j)
 *   ez:i:j:L wall on the z-aligned edge at x = lineX(i)
 *   v:i:j:L  pillar on the grid vertex (lineX(i), lineZ(j))
 * Snapping:
 *   floors / roofs on upper storeys: "support volumes" above walls/pillars
 *   (aim anywhere at a room → the roof ghost sits on its walls) and next to
 *   upper decks (extend a floor outwards); ground storey from the terrain hit
 *   (flush with neighbouring foundations)
 *   walls / pillars / prefabs on upper decks: horizontal deck planes
 *   decor / power: any flat surface, 0.5 m snapping
 * Validation: reach, world bounds, water, roads, protected landmark areas,
 * landmark / foreign physics boxes, slots, support, slope, overlaps with
 * placed pieces, cost and blueprints.
 */
import * as THREE from 'three';
import { ZONES, ROADS, CITY_ISLANDS, WORLD } from '../world/layout.js';
import { CELL, LEVEL_H, MAX_LEVEL, REACH, PIECE } from './catalog.js';
import { pieceInfo, normVariant } from './pieces.js';
import { t } from '../core/i18n.js';

const BA = ZONES.base.buildArea;
export const ORIGIN_X = BA.x - BA.size / 2;
export const ORIGIN_Z = BA.z - BA.size / 2;

export const cellI = (x) => Math.floor((x - ORIGIN_X) / CELL);
export const cellJ = (z) => Math.floor((z - ORIGIN_Z) / CELL);
export const cellX = (i) => ORIGIN_X + i * CELL + CELL / 2;
export const cellZ = (j) => ORIGIN_Z + j * CELL + CELL / 2;
export const lineX = (i) => ORIGIN_X + i * CELL;
export const lineZ = (j) => ORIGIN_Z + j * CELL;
export const dkey = (i, j, L) => `d:${i}:${j}:${L}`;
export const rkey = (i, j, L) => `r:${i}:${j}:${L}`;
export const vkey = (i, j, L) => `v:${i}:${j}:${L}`;
export const ekey = (dir, i, j, L) => `e${dir}:${i}:${j}:${L}`;

export const REASONS = {
  far: { en: 'Too far away', nl: 'Te ver weg' },
  water: { en: 'Not on the water', nl: 'Niet op het water' },
  road: { en: 'Not on a road', nl: 'Niet op de weg' },
  steep: { en: 'Too steep here', nl: 'Te steil hier' },
  blocked: { en: 'Blocked', nl: 'Geblokkeerd' },
  occupied: { en: 'Space occupied', nl: 'Plek is bezet' },
  support: { en: 'Needs support', nl: 'Heeft steun nodig' },
  roofSupport: { en: 'Needs walls or pillars', nl: 'Heeft muren of pilaren nodig' },
  flat: { en: 'Needs a flat surface', nl: 'Heeft een vlakke ondergrond nodig' },
  protected: { en: 'Too close to {name}', nl: 'Te dicht bij {name}' },
  bounds: { en: 'Edge of the world', nl: 'Rand van de wereld' },
  height: { en: 'Too high', nl: 'Te hoog' },
  cost: { en: 'Not enough {res}', nl: 'Niet genoeg {res}' },
  locked: { en: 'Blueprint required — Marketplace', nl: 'Blauwdruk nodig — Marktplaats' },
  ground: { en: 'Needs open ground', nl: 'Heeft open terrein nodig' },
  uneven: { en: 'Uneven support', nl: 'Ongelijke ondergrond' },
  nothing: { en: 'Aim at the ground', nl: 'Richt op de grond' },
  custom: { en: '{text}', nl: '{text}' }, // text supplied by the online authority (claims …)
  pending: { en: 'Waiting for the server…', nl: 'Wachten op de server…' },
};

const HOUSE_NAME = { en: 'your house', nl: 'je huis' };
const PAD_NAME = { en: 'the landing pad', nl: 'het landingsplatform' };
const PROTECTED = [
  { c: [360, -150, 92], name: () => ZONES.plaza.label },
  { r: [374, 571, 169, 336], name: () => ZONES.spaceport.label },
  { c: [250, 95, 42], name: () => ZONES.ruins.label },
  { c: [-280, 30, 12], name: () => ZONES.lookout.label },
  { c: [-120, -152, 22], name: () => ZONES.signal.label },
  { c: [0, 150, 22], name: () => ZONES.spawn.label },
  { c: [ZONES.waterfall.lip.x, ZONES.waterfall.lip.z, 16], name: () => ZONES.waterfall.label },
  { r: [-284, -244, 322, 362], name: () => t(HOUSE_NAME) },
  { c: [-245.5, 344.5, 6.5], name: () => t(HOUSE_NAME) },
  { c: [ZONES.base.landingPad.x, ZONES.base.landingPad.z, 10.5], name: () => t(PAD_NAME) },
  ...CITY_ISLANDS.map((c) => ({ c: [c.x, c.z, c.radius], name: () => ZONES.city.label })),
];

/** First protected landmark area within r of (x, z), or null. */
export function protectedAt(x, z, r = 0) {
  for (const p of PROTECTED) {
    if (p.c ? Math.hypot(x - p.c[0], z - p.c[1]) < p.c[2] + r : x + r > p.r[0] && x - r < p.r[1] && z + r > p.r[2] && z - r < p.r[3]) return p;
  }
  return null;
}

/** Squared distance from (x, z) to the nearest road centre line minus its half width (≤ 0 = on the road). */
export function roadClearance(x, z) {
  let best = Infinity;
  for (const road of ROADS) {
    const pts = road.points;
    for (let k = 0; k < pts.length - 1; k++) {
      const d = Math.sqrt(segDist2(x, z, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1])) - road.width / 2;
      if (d < best) best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- geometry
/** World OBB of a local box placed with a piece at (x, y, z, rotY). */
export function toWorldBox(b, x, y, z, rotY, out = {}) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  out.x = x + b.x * c + b.z * s;
  out.y = y + b.y;
  out.z = z - b.x * s + b.z * c;
  out.hw = b.w / 2;
  out.hh = b.h / 2;
  out.hd = b.d / 2;
  out.rot = rotY + (b.rotY || 0);
  out.c = Math.cos(out.rot);
  out.s = Math.sin(out.rot);
  out.solid = b.solid !== false;
  out.walkable = b.walkable !== false;
  return out;
}

/** 2D separating-axis overlap of two OBBs (rotation about Y), each shrunk by `shrink`. */
export function obbOverlap2D(a, b, shrink = 0.05) {
  const ax = [a.c, -a.s];
  const az = [a.s, a.c];
  const bxv = [b.c, -b.s];
  const bzv = [b.s, b.c];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const ahw = Math.max(0, a.hw - shrink);
  const ahd = Math.max(0, a.hd - shrink);
  const bhw = Math.max(0, b.hw - shrink);
  const bhd = Math.max(0, b.hd - shrink);
  for (const ax2 of [ax, az, bxv, bzv]) {
    const ra = ahw * Math.abs(ax[0] * ax2[0] + ax[1] * ax2[1]) + ahd * Math.abs(az[0] * ax2[0] + az[1] * ax2[1]);
    const rb = bhw * Math.abs(bxv[0] * ax2[0] + bxv[1] * ax2[1]) + bhd * Math.abs(bzv[0] * ax2[0] + bzv[1] * ax2[1]);
    if (Math.abs(dx * ax2[0] + dz * ax2[1]) > ra + rb) return false;
  }
  return true;
}

/** OBB from a physics box ({x,y,z,w,h,d,rotY} or prepped {hw,hh,hd,c,s}). */
function physToObb(b, out) {
  out.x = b.x;
  out.y = b.y;
  out.z = b.z;
  out.hw = b.w / 2;
  out.hh = b.h / 2;
  out.hd = b.d / 2;
  out.rot = b.rotY || 0;
  out.c = Math.cos(out.rot);
  out.s = Math.sin(out.rot);
  return out;
}

/**
 * Ray (o + d·t) vs OBB (rotation about Y). Returns t (or -1) and writes the
 * world-space face normal into `n`.
 */
export function rayObb(o, d, b, maxT, n) {
  // world → local (inverse rotation): lx = dx·c − dz·s, lz = dx·s + dz·c
  const ox = o.x - b.x;
  const oz = o.z - b.z;
  const lox = ox * b.c - oz * b.s;
  const loz = ox * b.s + oz * b.c;
  const loy = o.y - b.y;
  const ldx = d.x * b.c - d.z * b.s;
  const ldz = d.x * b.s + d.z * b.c;
  const ldy = d.y;
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 0;
  const O = [lox, loy, loz];
  const D = [ldx, ldy, ldz];
  const H = [b.hw, b.hh, b.hd];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(D[k]) < 1e-9) {
      if (O[k] < -H[k] || O[k] > H[k]) return -1;
      continue;
    }
    let t1 = (-H[k] - O[k]) / D[k];
    let t2 = (H[k] - O[k]) / D[k];
    let s = -1;
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = k;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (axis < 0) {
    // origin inside the box
    n.set(0, 1, 0);
    return 0;
  }
  // local normal → world (rotate by +rot): wx = lx·c + lz·s, wz = −lx·s + lz·c
  const ln = [0, 0, 0];
  ln[axis] = sign;
  n.set(ln[0] * b.c + ln[2] * b.s, ln[1], -ln[0] * b.s + ln[2] * b.c);
  return tmin;
}

function rayAabb(o, d, minX, minY, minZ, maxX, maxY, maxZ, maxT) {
  let tmin = 0;
  let tmax = maxT;
  const O = [o.x, o.y, o.z];
  const D = [d.x, d.y, d.z];
  const MN = [minX, minY, minZ];
  const MX = [maxX, maxY, maxZ];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(D[k]) < 1e-9) {
      if (O[k] < MN[k] || O[k] > MX[k]) return -1;
      continue;
    }
    let t1 = (MN[k] - O[k]) / D[k];
    let t2 = (MX[k] - O[k]) / D[k];
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

function segDist2(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz || 1e-9;
  let k = ((px - ax) * vx + (pz - az) * vz) / l2;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const dx = px - (ax + vx * k);
  const dz = pz - (az + vz * k);
  return dx * dx + dz * dz;
}

// ------------------------------------------------------------- slot layout
/** Footprint cells of a room piece centred at (x, z) with rotation rot. */
export function roomCells(def, x, z, rot) {
  const [sx0, sz0] = def.size || [1, 1];
  const sx = rot % 2 ? sz0 : sx0;
  const sz = rot % 2 ? sx0 : sz0;
  const i0 = Math.round((x - ORIGIN_X) / CELL - sx / 2);
  const j0 = Math.round((z - ORIGIN_Z) / CELL - sz / 2);
  const cells = [];
  for (let a = 0; a < sx; a++) for (let b = 0; b < sz; b++) cells.push([i0 + a, j0 + b]);
  return { i0, j0, sx, sz, cells };
}

/**
 * Occupied slots + provided deck surfaces of a placed piece (deterministic
 * from its saved transform, so saves only store type/x/y/z/rot/level/variant).
 */
export function slotLayout(def, x, y, z, rot, L, variant) {
  const slots = [];
  const provides = [];
  const cells = [];
  const id = def.id;
  if (def.snap === 'deck' || def.snap === 'roof') {
    const i = cellI(x);
    const j = cellJ(z);
    cells.push([i, j]);
    slots.push(dkey(i, j, L));
    if (id !== 'pitched-roof') provides.push({ key: dkey(i, j, L), y, level: L, i, j });
  } else if (def.snap === 'edge') {
    const dir = rot % 2 ? 'z' : 'x';
    const i = dir === 'x' ? cellI(x) : Math.round((x - ORIGIN_X) / CELL);
    const j = dir === 'x' ? Math.round((z - ORIGIN_Z) / CELL) : cellJ(z);
    slots.push(ekey(dir, i, j, L));
  } else if (def.snap === 'corner') {
    slots.push(vkey(Math.round((x - ORIGIN_X) / CELL), Math.round((z - ORIGIN_Z) / CELL), L));
  } else if (def.snap === 'room') {
    const rc = roomCells(def, x, z, rot);
    const storeys = def.storeys || 1;
    for (const [i, j] of rc.cells) {
      cells.push([i, j]);
      for (let l = L; l < L + storeys; l++) slots.push(rkey(i, j, l));
      if (id === 'stairs') slots.push(dkey(i, j, L + 1));
      if (id === 'cube-module' || id === 'workshop') {
        slots.push(dkey(i, j, L + 1));
        provides.push({ key: dkey(i, j, L + 1), y: y + LEVEL_H, level: L + 1, i, j });
      }
      if ((id === 'cube-module' || id === 'workshop' || id === 'landing-pad') && variant === 'ground') {
        slots.push(dkey(i, j, L));
        if (id !== 'landing-pad') provides.push({ key: dkey(i, j, L), y, level: L, i, j });
      }
    }
    if (id === 'canopy') {
      const [i, j] = rc.cells[0];
      slots.push(vkey(i, j, L), vkey(i + 1, j, L), vkey(i, j + 1, L), vkey(i + 1, j + 1, L));
    }
  }
  return { slots, provides, cells };
}

// --------------------------------------------------------------- placement
/** Resource affordability without the creative-mode shortcut of state.canAfford. */
function canAffordRes(state, cost = {}) {
  const res = state.data?.resources || {};
  for (const k in cost) {
    if (k === 'credits' ? (state.data?.credits ?? 0) < cost[k] : (res[k] ?? 0) < cost[k]) return false;
  }
  return true;
}

export function createPlacement(ctx, reg) {
  const world = ctx.world;
  const physics = ctx.physics;
  const nrm = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const P = new THREE.Vector3();
  const segEnd = new THREE.Vector3();
  const hit = { t: Infinity, kind: 'none', point: new THREE.Vector3(), normal: new THREE.Vector3(), rec: null };
  const terrainHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  const obbA = {};
  const obbB = {};
  const qList = [];
  const planes = [];
  const vols = [];
  const seen = new Set();
  let tPlayer = 0;

  const height = (x, z) => (world?.getHeightAt ? world.getHeightAt(x, z) : 0);

  // ------------------------------------------------------------- aim
  /** Nearest hit of the ray among placed pieces, terrain and foreign solids. */
  function aim(o, d, maxT) {
    hit.t = Infinity;
    hit.kind = 'none';
    hit.rec = null;
    // placed pieces
    for (const rec of reg.records.values()) {
      const sp = rec.sphere;
      const ox = sp.x - o.x;
      const oy = sp.y - o.y;
      const oz = sp.z - o.z;
      const along = ox * d.x + oy * d.y + oz * d.z;
      if (along < -sp.r || along - sp.r > maxT) continue;
      const perp2 = ox * ox + oy * oy + oz * oz - along * along;
      if (perp2 > sp.r * sp.r) continue;
      for (const b of rec.hitObbs) {
        const tt = rayObb(o, d, b, Math.min(maxT, hit.t), tmpN);
        if (tt >= 0 && tt < hit.t) {
          hit.t = tt;
          hit.kind = 'structure';
          hit.rec = rec;
          hit.normal.copy(tmpN);
        }
      }
    }
    // terrain
    if (world?.raycastInto) {
      const r = world.raycastInto(o, d, Math.min(maxT, hit.t), terrainHit);
      if (r && r.distance < hit.t) {
        hit.t = r.distance;
        hit.kind = 'terrain';
        hit.rec = null;
        hit.normal.copy(r.normal);
      }
    }
    // foreign solids (landmarks, vehicles, rocks…) in front of everything else
    if (physics?.segmentHit) {
      const len = Math.min(maxT, hit.t);
      segEnd.copy(o).addScaledVector(d, len);
      const ft = physics.segmentHit(o, segEnd);
      if (ft < 1) {
        const dist = ft * len;
        if (dist < hit.t - 0.08) {
          hit.t = dist;
          hit.kind = 'foreign';
          hit.rec = null;
          hit.normal.set(-d.x, -d.y, -d.z);
        }
      }
    }
    if (Number.isFinite(hit.t)) hit.point.copy(o).addScaledVector(d, hit.t);
    return hit;
  }

  // ------------------------------------------------------- support queries
  const deckAt = (i, j, L) => reg.decks.get(dkey(i, j, L)) || null;
  const supportsAbove = (rec) => rec && (rec.def.snap === 'edge' || rec.def.snap === 'corner') && !rec.def.half;

  /** y of walls/pillars (storey L−1) around cell (i, j) that can carry a slab at storey L, or null. */
  function slabSupport(i, j, L) {
    if (L < 1) return null;
    const keys = [ekey('x', i, j, L - 1), ekey('x', i, j + 1, L - 1), ekey('z', i, j, L - 1), ekey('z', i + 1, j, L - 1), vkey(i, j, L - 1), vkey(i + 1, j, L - 1), vkey(i, j + 1, L - 1), vkey(i + 1, j + 1, L - 1)];
    for (const k of keys) {
      const r = reg.slots.get(k);
      if (supportsAbove(r)) return r.y + LEVEL_H;
    }
    return null;
  }

  /** Number of walls / pillars (storey L−1) around cell (i, j) whose tops carry a slab at y. */
  function supportCount(i, j, L, y) {
    let n = 0;
    const keys = [ekey('x', i, j, L - 1), ekey('x', i, j + 1, L - 1), ekey('z', i, j, L - 1), ekey('z', i + 1, j, L - 1), vkey(i, j, L - 1), vkey(i + 1, j, L - 1), vkey(i, j + 1, L - 1), vkey(i + 1, j + 1, L - 1)];
    for (const k of keys) {
      const r = reg.slots.get(k);
      if (supportsAbove(r) && Math.abs(r.y + LEVEL_H - y) < 0.06) n++;
    }
    return n;
  }

  /**
   * A plane crossing at tt is hidden when the first surface along the ray lies
   * clearly before it AND that surface is well above / below the plane (a wall,
   * a house) — low things standing on the plane (furniture, decor) don't hide it.
   */
  function occluded(o, d, h, tt, py) {
    if (!Number.isFinite(h.t) || tt <= h.t + 1.0) return false;
    return Math.abs(o.y + d.y * h.t - py) > 1.2;
  }

  function adjacentDeckY(i, j, L, y = null) {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const dk = deckAt(i + di, j + dj, L);
      if (dk && (y == null || Math.abs(dk.y - y) < 0.06)) return dk.y;
    }
    return null;
  }

  function terrainRange(pts, out) {
    let mn = Infinity;
    let mx = -Infinity;
    let wet = false;
    for (let k = 0; k < pts.length; k += 2) {
      const h = height(pts[k], pts[k + 1]);
      if (h < mn) mn = h;
      if (h > mx) mx = h;
      if (h < 0.35 || world?.isWater?.(pts[k], pts[k + 1])) wet = true;
    }
    out.min = mn;
    out.max = mx;
    out.wet = wet;
    return out;
  }
  const rangeOut = { min: 0, max: 0, wet: false };
  const samplePts = [];

  function cellSamples(cells, pad = 0.15) {
    samplePts.length = 0;
    for (const [i, j] of cells) {
      const x0 = lineX(i) + pad;
      const z0 = lineZ(j) + pad;
      const x1 = lineX(i + 1) - pad;
      const z1 = lineZ(j + 1) - pad;
      const xm = (x0 + x1) / 2;
      const zm = (z0 + z1) / 2;
      samplePts.push(x0, z0, x1, z0, x0, z1, x1, z1, xm, zm, xm, z0, xm, z1, x0, zm, x1, zm);
    }
    return samplePts;
  }

  // ---------------------------------------------------------- the target
  const target = {
    valid: false,
    reason: 'nothing',
    reasonVars: null,
    def: null,
    info: null,
    variant: 'raised',
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    rotY: 0,
    level: 0,
    has: false,
    flatY: null,
    rect: [0, 0, 0, 0],
    edge: null,
    edgeArr: [0, 0, 0, 0],
    gridX: 0,
    gridZ: 0,
    cursorX: 0,
    cursorZ: 0,
    layout: null,
    groundTouch: false,
  };

  function setReason(code, vars = null) {
    if (target.valid) {
      target.valid = false;
      target.reason = code;
      target.reasonVars = vars;
    }
  }

  function reasonText(tg = target) {
    const r = REASONS[tg.reason] || REASONS.blocked;
    return t(r, tg.reasonVars || undefined);
  }

  /** Fills `target` for an anchor; returns target. */
  function finish(def, rot, x, y, z, L, variant, opts) {
    target.def = def;
    target.rot = rot;
    target.rotY = rot * (Math.PI / 2);
    target.x = x;
    target.y = y;
    target.z = z;
    target.level = L;
    target.variant = normVariant(def.id, variant);
    target.info = pieceInfo(def.id, target.variant);
    target.has = true;
    target.layout = slotLayout(def, x, y, z, rot, L, target.variant);
    return target;
  }

  // ------------------------------------------------------ main compute
  /**
   * Computes the snapped, validated target for piece `def` along the ray.
   * opts: { player: Vector3 (reach check), ignoreReach, maxT }
   */
  function compute(def, rot, o, d, opts = {}) {
    const maxT = opts.maxT ?? 42;
    target.valid = true;
    target.reason = null;
    target.reasonVars = null;
    target.has = false;
    target.edge = null;
    target.flatY = null;
    target.groundTouch = false;
    const h = aim(o, d, maxT);
    // plane crossings must lie beyond the player (not above the camera's head)
    const pl = opts.player;
    tPlayer = pl ? Math.max(0, (pl.x - o.x) * d.x + (pl.y + 1 - o.y) * d.y + (pl.z - o.z) * d.z) : 0;
    target.cursorX = Number.isFinite(h.t) ? h.point.x : o.x + d.x * 10;
    target.cursorZ = Number.isFinite(h.t) ? h.point.z : o.z + d.z * 10;

    let ok = false;
    switch (def.snap) {
      case 'deck':
      case 'roof':
        ok = snapSlab(def, rot, o, d, h, maxT);
        break;
      case 'edge':
      case 'corner':
        ok = snapLinear(def, rot, o, d, h, maxT);
        break;
      case 'room':
        ok = snapRoom(def, rot, o, d, h, maxT);
        break;
      default:
        ok = snapFree(def, rot, h);
    }
    if (!ok) {
      target.valid = false;
      if (!target.reason) target.reason = 'nothing';
      return target;
    }
    validate(def, opts);
    return target;
  }

  // ---------------------------------------------------- floors / roofs
  function snapSlab(def, rot, o, d, h, maxT) {
    const isRoof = def.snap === 'roof';
    let bestT = Infinity;
    let bi = 0;
    let bj = 0;
    let bL = 0;
    let by = 0;
    if (def.id !== 'foundation') {
      // A. room volumes over walls / pillars: aim anywhere at a room → slab on its walls
      vols.length = 0;
      seen.clear();
      // a cell gets a "room volume" when ≥ 2 walls / pillars of one storey surround it
      const addVol = (i, j, L, y) => {
        if (L < 1 || L > MAX_LEVEL) return;
        const k = `${i}:${j}:${L}`;
        if (seen.has(k)) return;
        seen.add(k);
        if (supportCount(i, j, L, y) < 2) return;
        vols.push(i, j, L, y);
      };
      for (const rec of reg.records.values()) {
        if (!supportsAbove(rec)) continue;
        const top = rec.y + LEVEL_H;
        const L = rec.level + 1;
        const parts = rec.layout.slots[0].split(':');
        const i = +parts[1];
        const j = +parts[2];
        if (rec.def.snap === 'edge') {
          if (parts[0] === 'ex') {
            addVol(i, j - 1, L, top);
            addVol(i, j, L, top);
          } else {
            addVol(i - 1, j, L, top);
            addVol(i, j, L, top);
          }
        } else {
          addVol(i - 1, j - 1, L, top);
          addVol(i, j - 1, L, top);
          addVol(i - 1, j, L, top);
          addVol(i, j, L, top);
        }
      }
      for (let k = 0; k < vols.length; k += 4) {
        const i = vols[k];
        const j = vols[k + 1];
        const y = vols[k + 3];
        const x0 = lineX(i);
        const z0 = lineZ(j);
        const x1 = x0 + CELL;
        const z1 = z0 + CELL;
        const y0 = y - LEVEL_H;
        const y1 = y + 0.35;
        let tt;
        if (o.x > x0 && o.x < x1 && o.z > z0 && o.z < z1 && o.y > y0 && o.y < y1) {
          // camera inside this room: only aiming up through its ceiling counts
          if (d.y < 0.05) continue;
          tt = (y1 - o.y) / d.y;
          const px = o.x + d.x * tt;
          const pz = o.z + d.z * tt;
          if (px < x0 || px > x1 || pz < z0 || pz > z1) continue;
        } else tt = rayAabb(o, d, x0, y0, z0, x1, y1, z1, maxT);
        if (tt < 0 || tt >= bestT) continue;
        if (Number.isFinite(h.t) && tt > h.t + 0.6) continue;
        bestT = tt;
        bi = i;
        bj = j;
        bL = vols[k + 2];
        by = y;
      }
      // B. upper deck planes: extend floors / roofs outwards next to an existing deck
      planes.length = 0;
      for (const dk of reg.decks.values()) {
        if (dk.level < 1) continue;
        let dup = false;
        for (let k = 0; k < planes.length; k += 2) if (Math.abs(planes[k] - dk.y) < 0.02 && planes[k + 1] === dk.level) dup = true;
        if (!dup) planes.push(dk.y, dk.level);
      }
      for (let k = 0; k < planes.length; k += 2) {
        if (Math.abs(d.y) < 1e-4) continue;
        const py = planes[k];
        const L = planes[k + 1];
        const tt = (py - o.y) / d.y;
        if (tt <= Math.max(0.2, tPlayer + 0.5) || tt > maxT || tt >= bestT) continue;
        if (occluded(o, d, h, tt, py)) continue;
        P.copy(o).addScaledVector(d, tt);
        const i = cellI(P.x);
        const j = cellJ(P.z);
        if (adjacentDeckY(i, j, L, py) == null) continue;
        bestT = tt;
        bi = i;
        bj = j;
        bL = L;
        by = py;
      }
    }
    if (Number.isFinite(bestT)) {
      finish(def, rot, cellX(bi), by, cellZ(bj), bL, 'raised');
      target.flatY = by;
      setRect1(bi, bj);
      const sup = slabSupport(bi, bj, bL);
      const adj = adjacentDeckY(bi, bj, bL, by);
      if ((sup == null || Math.abs(sup - by) > 0.06) && adj == null) setReason(isRoof ? 'roofSupport' : 'support');
      return true;
    }
    if (isRoof) {
      // nothing to rest on: show the ghost at the aim point (invalid)
      if (!Number.isFinite(h.t)) return false;
      const i = cellI(h.point.x);
      const j = cellJ(h.point.z);
      const gy = height(cellX(i), cellZ(j));
      finish(def, rot, cellX(i), gy + LEVEL_H, cellZ(j), 1, 'raised');
      setRect1(i, j);
      target.flatY = null;
      setReason('roofSupport');
      return true;
    }
    // C. ground storey (terrain hit / in front of a structure face)
    if (!Number.isFinite(h.t)) return false;
    let px = h.point.x;
    let pz = h.point.z;
    if (h.kind === 'structure') {
      if (h.normal.y > 0.5) {
        const i = cellI(px);
        const j = cellJ(pz);
        for (let L = 0; L <= MAX_LEVEL; L++) {
          const dk = deckAt(i, j, L);
          if (dk && Math.abs(dk.y - h.point.y) < 0.4) {
            finish(def, rot, cellX(i), dk.y, cellZ(j), L, L === 0 ? 'ground' : 'raised');
            target.flatY = dk.y;
            setRect1(i, j);
            setReason('occupied');
            return true;
          }
        }
      }
      px += h.normal.x * 0.3;
      pz += h.normal.z * 0.3;
    }
    ground1(def, rot, cellI(px), cellJ(pz));
    return true;
  }

  function setRect1(i, j) {
    target.rect[0] = lineX(i);
    target.rect[1] = lineZ(j);
    target.rect[2] = lineX(i + 1);
    target.rect[3] = lineZ(j + 1);
    target.gridX = cellX(i);
    target.gridZ = cellZ(j);
  }

  /** Ground-storey slab in cell (i, j): natural height or flush with a neighbouring deck. */
  function ground1(def, rot, i, j) {
    const pts = cellSamples([[i, j]]);
    terrainRange(pts, rangeOut);
    const lift = def.id === 'foundation' ? 0.25 : 0.2;
    const depth = def.id === 'foundation' ? 3.1 : def.id === 'glass-floor' ? 1.0 : def.id === 'wood-deck' ? 1.35 : 1.3;
    let y = rangeOut.max + lift;
    const flush = adjacentDeckY(i, j, 0);
    if (flush != null && flush >= rangeOut.max + 0.04 && flush - rangeOut.min <= depth && Math.abs(flush - y) <= 1.0) y = flush;
    finish(def, rot, cellX(i), y, cellZ(j), 0, 'ground');
    setRect1(i, j);
    target.groundTouch = true;
    if (rangeOut.wet) setReason('water');
    else if (y - rangeOut.min > depth) setReason('steep');
  }

  // ------------------------------------------------------- walls / pillars
  function snapLinear(def, rot, o, d, h, maxT) {
    const isEdge = def.snap === 'edge';
    // horizontal planes: deck surfaces (storey L) + wall/pillar tops (storey L+1)
    planes.length = 0;
    const addPlane = (y, L) => {
      if (L > MAX_LEVEL) return;
      for (let k = 0; k < planes.length; k += 2) if (Math.abs(planes[k] - y) < 0.02 && planes[k + 1] === L) return;
      planes.push(y, L);
    };
    for (const dk of reg.decks.values()) addPlane(dk.y, dk.level);
    for (const rec of reg.records.values()) {
      if (!supportsAbove(rec)) continue;
      if (isEdge ? rec.def.snap === 'edge' : rec.def.snap === 'corner') addPlane(rec.y + LEVEL_H, rec.level + 1);
    }
    let best = null;
    let bestT = Infinity;
    for (let k = 0; k < planes.length; k += 2) {
      const py = planes[k];
      const L = planes[k + 1];
      if (Math.abs(d.y) < 1e-4) continue;
      const tt = (py - o.y) / d.y;
      if (tt <= Math.max(0.2, tPlayer + 0.5) || tt > maxT || tt >= bestT) continue;
      if (occluded(o, d, h, tt, py)) continue;
      P.copy(o).addScaledVector(d, tt);
      const a = isEdge ? edgeAt(P.x, P.z) : vertexAt(P.x, P.z);
      if (!linearSupported(isEdge, a, L, py)) continue;
      bestT = tt;
      best = bestLin;
      best.px = P.x;
      best.pz = P.z;
      best.L = L;
      best.y = py;
    }
    if (best) {
      const a = isEdge ? edgeAt(best.px, best.pz) : vertexAt(best.px, best.pz);
      placeLinear(def, rot, a, best.L, best.y, 'raised');
      target.flatY = best.y;
      return true;
    }
    if (!Number.isFinite(h.t)) return false;
    // ground storey on the terrain (or in front of a structure face)
    let px = h.point.x;
    let pz = h.point.z;
    if (h.kind === 'structure' && h.normal.y < 0.5 && h.rec?.def.snap !== 'free') {
      px += h.normal.x * 0.3;
      pz += h.normal.z * 0.3;
    }
    const a = isEdge ? edgeAt(px, pz) : vertexAt(px, pz);
    samplePts.length = 0;
    if (isEdge) {
      for (let f = 0; f <= 4; f++) {
        const k = f / 4;
        samplePts.push(a.x0 + (a.x1 - a.x0) * k, a.z0 + (a.z1 - a.z0) * k);
      }
    } else samplePts.push(a.x - 0.25, a.z - 0.25, a.x + 0.25, a.z - 0.25, a.x - 0.25, a.z + 0.25, a.x + 0.25, a.z + 0.25, a.x, a.z);
    terrainRange(samplePts, rangeOut);
    const y = rangeOut.max - 0.02;
    placeLinear(def, rot, a, 0, y, 'ground');
    target.groundTouch = true;
    if (rangeOut.wet) setReason('water');
    else if (rangeOut.max - rangeOut.min > (isEdge ? 1.1 : 0.9)) setReason('steep');
    else if (h.kind === 'structure' && h.normal.y >= 0.5 && h.rec?.def.snap !== 'free') setReason('support');
    return true;
  }

  const bestLin = { px: 0, pz: 0, L: 0, y: 0 };
  const edgeA = { dir: 'x', i: 0, j: 0, x: 0, z: 0, x0: 0, z0: 0, x1: 0, z1: 0, ci: 0, cj: 0 };
  /** Nearest cell edge to a point. */
  function edgeAt(x, z) {
    const i = cellI(x);
    const j = cellJ(z);
    const u = x - lineX(i);
    const v = z - lineZ(j);
    const dn = v;
    const ds = CELL - v;
    const dw = u;
    const de = CELL - u;
    const m = Math.min(dn, ds, dw, de);
    const a = edgeA;
    a.ci = i;
    a.cj = j;
    if (m === dn || m === ds) {
      a.dir = 'x';
      a.i = i;
      a.j = m === dn ? j : j + 1;
      a.x = cellX(i);
      a.z = lineZ(a.j);
      a.x0 = lineX(i);
      a.x1 = lineX(i + 1);
      a.z0 = a.z1 = a.z;
    } else {
      a.dir = 'z';
      a.i = m === dw ? i : i + 1;
      a.j = j;
      a.x = lineX(a.i);
      a.z = cellZ(j);
      a.z0 = lineZ(j);
      a.z1 = lineZ(j + 1);
      a.x0 = a.x1 = a.x;
    }
    return a;
  }

  const vertA = { i: 0, j: 0, x: 0, z: 0, ci: 0, cj: 0 };
  function vertexAt(x, z) {
    vertA.i = Math.round((x - ORIGIN_X) / CELL);
    vertA.j = Math.round((z - ORIGIN_Z) / CELL);
    vertA.x = lineX(vertA.i);
    vertA.z = lineZ(vertA.j);
    vertA.ci = cellI(x);
    vertA.cj = cellJ(z);
    return vertA;
  }

  function linearSupported(isEdge, a, L, y) {
    if (isEdge) {
      const c1 = a.dir === 'x' ? deckAt(a.i, a.j - 1, L) : deckAt(a.i - 1, a.j, L);
      const c2 = deckAt(a.i, a.j, L);
      if ((c1 && Math.abs(c1.y - y) < 0.06) || (c2 && Math.abs(c2.y - y) < 0.06)) return true;
      const below = reg.slots.get(ekey(a.dir, a.i, a.j, L - 1));
      return !!(below && supportsAbove(below) && Math.abs(below.y + LEVEL_H - y) < 0.06);
    }
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const dk = deckAt(a.i + di, a.j + dj, L);
      if (dk && Math.abs(dk.y - y) < 0.06) return true;
    }
    const below = reg.slots.get(vkey(a.i, a.j, L - 1));
    return !!(below && supportsAbove(below) && Math.abs(below.y + LEVEL_H - y) < 0.06);
  }

  function placeLinear(def, rot, a, L, y, variant) {
    if (def.snap === 'edge') {
      const flip = rot >= 2 ? 2 : 0;
      const r = (a.dir === 'x' ? 0 : 1) + flip;
      finish(def, r, a.x, y, a.z, L, variant);
      target.edge = target.edgeArr;
      target.edgeArr[0] = a.x0;
      target.edgeArr[1] = a.z0;
      target.edgeArr[2] = a.x1;
      target.edgeArr[3] = a.z1;
      const pad = 0.15;
      target.rect[0] = Math.min(a.x0, a.x1) - pad;
      target.rect[1] = Math.min(a.z0, a.z1) - pad;
      target.rect[2] = Math.max(a.x0, a.x1) + pad;
      target.rect[3] = Math.max(a.z0, a.z1) + pad;
    } else {
      finish(def, rot, a.x, y, a.z, L, variant);
      target.rect[0] = a.x - 0.3;
      target.rect[1] = a.z - 0.3;
      target.rect[2] = a.x + 0.3;
      target.rect[3] = a.z + 0.3;
    }
    target.gridX = cellX(a.ci);
    target.gridZ = cellZ(a.cj);
  }

  // ------------------------------------------------------------ rooms
  function snapRoom(def, rot, o, d, h, maxT) {
    // deck planes: footprint fully on decks of one storey → raised variant
    if (!def.groundOnly) {
      planes.length = 0;
      for (const dk of reg.decks.values()) {
        let dup = false;
        for (let k = 0; k < planes.length; k += 2) if (Math.abs(planes[k] - dk.y) < 0.02 && planes[k + 1] === dk.level) dup = true;
        if (!dup) planes.push(dk.y, dk.level);
      }
      let bestT = Infinity;
      let bx = 0;
      let bz = 0;
      let bL = 0;
      let by = 0;
      for (let k = 0; k < planes.length; k += 2) {
        if (Math.abs(d.y) < 1e-4) continue;
        const py = planes[k];
        const tt = (py - o.y) / d.y;
        if (tt <= Math.max(0.2, tPlayer + 0.5) || tt > maxT || tt >= bestT) continue;
        if (occluded(o, d, h, tt, py)) continue;
        P.copy(o).addScaledVector(d, tt);
        const rc = roomCells(def, P.x, P.z, rot);
        let all = true;
        for (const [i, j] of rc.cells) {
          const dk = deckAt(i, j, planes[k + 1]);
          if (!dk || Math.abs(dk.y - py) > 0.06) {
            all = false;
            break;
          }
        }
        if (!all) continue;
        bestT = tt;
        bx = lineX(rc.i0) + (rc.sx * CELL) / 2;
        bz = lineZ(rc.j0) + (rc.sz * CELL) / 2;
        bL = planes[k + 1];
        by = py;
      }
      if (Number.isFinite(bestT)) {
        finish(def, rot, bx, by, bz, bL, 'raised');
        target.flatY = by;
        setRoomRect(def, bx, bz, rot);
        if (bL + (def.storeys || 1) > MAX_LEVEL + 1) setReason('height');
        return true;
      }
    }
    if (!Number.isFinite(h.t)) return false;
    let px = h.point.x;
    let pz = h.point.z;
    if (h.kind === 'structure' && h.normal.y < 0.5 && h.rec?.def.snap !== 'free') {
      px += h.normal.x * 0.3;
      pz += h.normal.z * 0.3;
    }
    const rc = roomCells(def, px, pz, rot);
    const cx = lineX(rc.i0) + (rc.sx * CELL) / 2;
    const cz = lineZ(rc.j0) + (rc.sz * CELL) / 2;
    // footprint fully on ground-storey decks (plane hidden from view) → stand on them
    let decks = 0;
    let dy = null;
    let flat = true;
    for (const [i, j] of rc.cells) {
      const dk = deckAt(i, j, 0);
      if (!dk) continue;
      decks++;
      if (dy == null) dy = dk.y;
      else if (Math.abs(dk.y - dy) > 0.06) flat = false;
    }
    if (decks && decks === rc.cells.length && flat && !def.groundOnly) {
      finish(def, rot, cx, dy, cz, 0, 'raised');
      target.flatY = dy;
      setRoomRect(def, cx, cz, rot);
      return true;
    }
    const pts = cellSamples(rc.cells, 0.1);
    terrainRange(pts, rangeOut);
    const lift = { 'cube-module': 0.25, workshop: 0.25, stairs: 0.2, canopy: 0.0, tower: 0.05, 'landing-pad': 0.0 }[def.id] ?? 0.1;
    const limit = { 'cube-module': 1.4, workshop: 1.4, stairs: 1.1, canopy: 0.6, tower: 1.5, 'landing-pad': 1.15 }[def.id] ?? 1.0;
    const y = rangeOut.max + lift;
    finish(def, rot, cx, y, cz, 0, 'ground');
    setRoomRect(def, cx, cz, rot);
    target.groundTouch = true;
    if (rangeOut.wet) setReason('water');
    else if (decks) setReason(def.groundOnly ? 'ground' : 'uneven');
    else if (rangeOut.max - rangeOut.min > limit) setReason('steep');
    return true;
  }

  function setRoomRect(def, cx, cz, rot) {
    const [sx0, sz0] = def.size || [1, 1];
    const sx = (rot % 2 ? sz0 : sx0) * CELL;
    const sz = (rot % 2 ? sx0 : sz0) * CELL;
    target.rect[0] = cx - sx / 2;
    target.rect[1] = cz - sz / 2;
    target.rect[2] = cx + sx / 2;
    target.rect[3] = cz + sz / 2;
    target.gridX = cellX(cellI(cx - sx / 2 + 0.01));
    target.gridZ = cellZ(cellJ(cz - sz / 2 + 0.01));
  }

  // ------------------------------------------------------------- decor
  function snapFree(def, rot, h) {
    if (!Number.isFinite(h.t)) return false;
    const snap = 0.5;
    const x = Math.round(h.point.x / snap) * snap;
    const z = Math.round(h.point.z / snap) * snap;
    const r = def.radius || 0.6;
    let y;
    let raised = false;
    if (h.kind === 'structure') {
      if (h.normal.y < 0.6) {
        finish(def, rot, x, h.point.y, z, 0, 'raised');
        setFreeRect(x, z, r);
        setReason('flat');
        return true;
      }
      y = physics.groundHeight(x, z, h.point.y + 0.25, 0.5, 0);
      raised = y > height(x, z) + 0.05;
    } else if (h.kind === 'terrain') {
      samplePts.length = 0;
      const k = r * 0.7;
      samplePts.push(x, z, x - k, z, x + k, z, x, z - k, x, z + k);
      terrainRange(samplePts, rangeOut);
      y = Math.min(rangeOut.min, height(x, z)) - 0.02;
      finish(def, rot, x, y, z, 0, 'raised');
      setFreeRect(x, z, r);
      target.groundTouch = true;
      if (rangeOut.wet) setReason('water');
      else if (rangeOut.max - rangeOut.min > Math.max(0.45, r * 0.7)) setReason('steep');
      return true;
    } else {
      y = h.point.y;
    }
    finish(def, rot, x, y, z, 0, 'raised');
    setFreeRect(x, z, r);
    target.flatY = raised ? y : null;
    if (h.kind === 'foreign') setReason('blocked');
    return true;
  }

  function setFreeRect(x, z, r) {
    target.rect[0] = x - r;
    target.rect[1] = z - r;
    target.rect[2] = x + r;
    target.rect[3] = z + r;
    target.gridX = cellX(cellI(x));
    target.gridZ = cellZ(cellJ(z));
  }

  // ----------------------------------------------------------- validate
  function validate(def, opts) {
    const tg = target;
    // reach
    const pl = opts.player;
    if (pl && !opts.ignoreReach) {
      const dist = Math.hypot(tg.x - pl.x, tg.z - pl.z);
      if (dist > REACH + (def.size ? (Math.max(...def.size) * CELL) / 2 : 0)) setReason('far');
    }
    // world bounds
    if (Math.abs(tg.x) > WORLD.playBounds - 10 || Math.abs(tg.z) > WORLD.playBounds - 10) setReason('bounds');
    if (tg.level > MAX_LEVEL) setReason('height');
    // ground: water, roads, protected areas
    const r = Math.max(tg.rect[2] - tg.rect[0], tg.rect[3] - tg.rect[1]) / 2;
    const cx = (tg.rect[0] + tg.rect[2]) / 2;
    const cz = (tg.rect[1] + tg.rect[3]) / 2;
    if (tg.groundTouch || tg.level === 0) {
      for (const road of ROADS) {
        const lim = road.width / 2 + 0.6 + r * 0.7;
        const lim2 = lim * lim;
        const pts = road.points;
        for (let k = 0; k < pts.length - 1; k++) {
          if (segDist2(cx, cz, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]) < lim2) {
            setReason('road');
            break;
          }
        }
      }
    }
    for (const p of PROTECTED) {
      let inside = false;
      if (p.c) inside = Math.hypot(cx - p.c[0], cz - p.c[1]) < p.c[2] + r * 0.7;
      else inside = cx + r > p.r[0] && cx - r < p.r[1] && cz + r > p.r[2] && cz - r < p.r[3];
      if (inside) {
        setReason('protected', { name: p.name() });
        break;
      }
    }
    // physics: foreign boxes + placed pieces
    const info = tg.info;
    const obbs = reg._tmpObbs || (reg._tmpObbs = []);
    let n = 0;
    for (const b of info.boxes) {
      if (!obbs[n]) obbs[n] = {};
      toWorldBox(b, tg.x, tg.y, tg.z, tg.rotY, obbs[n]);
      n++;
    }
    if (n === 0) {
      if (!obbs[0]) obbs[0] = {};
      const rr = def.radius || 0.5;
      toWorldBox({ x: 0, y: 0.6, z: 0, w: rr * 2, h: 1.2, d: rr * 2 }, tg.x, tg.y, tg.z, tg.rotY, obbs[0]);
      n = 1;
    }
    if (tg.valid && physics?.queryRect) {
      qList.length = 0;
      physics.queryRect(tg.rect[0] - 0.5, tg.rect[1] - 0.5, tg.rect[2] + 0.5, tg.rect[3] + 0.5, qList);
      outer: for (const b of qList) {
        if (b.tag === 'build') continue;
        if (b.tag === 'terrain-tree') continue; // cleared when building
        if (b.tag === 'terrain-rock' && b.w * b.d < 10) continue;
        physToObb(b, obbB);
        const bBottom = b.y - b.h / 2;
        const bTop = b.y + b.h / 2;
        for (let k = 0; k < n; k++) {
          const a = obbs[k];
          if (a.y + a.hh <= bBottom + 0.05 || a.y - a.hh >= bTop - 0.05) continue;
          if (obbOverlap2D(a, obbB, 0.04)) {
            setReason('blocked');
            break outer;
          }
        }
      }
    }
    // slots (placed pieces + placements waiting for the server)
    if (tg.valid) {
      for (const key of tg.layout.slots) {
        if (reg.slots.has(key) || reg.pendingSlots?.has(key)) {
          setReason('occupied');
          break;
        }
      }
    }
    // overlaps with placed pieces (rooms / decor vs everything)
    if (tg.valid) {
      const mineLoose = def.snap === 'room' || def.snap === 'free';
      for (const rec of reg.records.values()) {
        if (!mineLoose && rec.def.snap !== 'room' && rec.def.snap !== 'free') continue;
        const sp = rec.sphere;
        if (Math.hypot(sp.x - cx, sp.z - cz) > sp.r + r + 1) continue;
        let hitAny = false;
        for (let k = 0; k < n && !hitAny; k++) {
          const a = obbs[k];
          for (const b of rec.obbs) {
            if (a.y + a.hh <= b.y - b.hh + 0.06 || a.y - a.hh >= b.y + b.hh - 0.06) continue;
            if (obbOverlap2D(a, b, 0.06)) {
              hitAny = true;
              break;
            }
          }
        }
        if (hitAny) {
          setReason('occupied');
          break;
        }
      }
    }
    // online authority: client-side prediction (someone else's claim, limits …)
    const auth = reg.authority;
    if (tg.valid && auth?.check) {
      let why = null;
      try {
        why = auth.check(tg, def);
      } catch {
        why = null;
      }
      if (why) setReason('custom', { text: typeof why === 'string' ? why : why.text || '' });
    }
    // blueprint + cost (creative mode only counts in single-player)
    const creativeOn = !auth && !!ctx.state?.get?.('settings.creative');
    if (def.unlock && !opts.ignoreUnlock) {
      const owned = ctx.state?.get?.('owned.items') || [];
      if (!owned.includes(def.unlock) && !creativeOn) setReason('locked');
    }
    if (!opts.ignoreCost && ctx.state && !(creativeOn || canAffordRes(ctx.state, def.cost))) {
      const res = ctx.state.data.resources || {};
      let miss = null;
      for (const [k, v] of Object.entries(def.cost)) if ((res[k] ?? 0) < v) miss = miss || k;
      const RES = { metal: { en: 'metal', nl: 'metaal' }, stone: { en: 'stone', nl: 'steen' }, wood: { en: 'wood', nl: 'hout' }, energy: { en: 'energy', nl: 'energie' } };
      setReason('cost', { res: t(RES[miss] || RES.metal) });
    }
  }

  return { compute, aim, target, reasonText, deckAt, slabSupport };
}
