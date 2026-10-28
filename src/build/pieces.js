/**
 * Procedural geometry for every build piece (glass-villa style: dark metal
 * frames, light concrete, warm wood, glass, warm LED strips), built once per
 * piece id + variant and cached:
 *   parts  per-material merged geometries (one instanced draw call each)
 *   ghost  all visible parts merged (hologram) + `edges` (wireframe lines)
 *   boxes  physics boxes in local space {x, y, z, w, h, d, rotY, solid, walkable}
 *   hits   raycast boxes (physics boxes + hit-only boxes)
 *
 * Local frames (front = −Z, y = 0 as below):
 *   deck / roof  cell centre, y = deck top surface (geometry mostly below)
 *   edge         edge midpoint, wall runs along local X, y = wall bottom
 *   corner       grid vertex, y = bottom
 *   room         footprint centre, y = deck / ground top
 *   free         base centre on the surface
 * Variant 'ground' adds footings / skirts / slabs reaching into the terrain;
 * 'raised' stands on an existing deck or wall.
 */
import * as THREE from 'three';
import { GeoBuilder, mergeParts } from './geo.js';
import { Rng } from '../core/math.js';

const FRAME = 0x1c1f24;
const FRAME2 = 0x2c3038;
const STEEL = 0x9a9ea6;
const CONC = 0xc4bfb6;
const CONC_D = 0x8e8a84;
const CONC_L = 0xd8d4cc;
const WOOD = 0xb88a5c;
const WOOD_D = 0x6a4a32;
const LAMP = { color: 0xffd6a0, intensity: 2.6 };
const CEIL = { color: 0xffe0b8, intensity: 1.5 };

export const PART_ORDER = ['concrete', 'metal', 'wood', 'matte', 'solar', 'banner', 'glass', 'glow', 'neon', 'decal', 'pool', 'flame'];
const NOT_IN_GHOST = new Set(['pool', 'flame', 'decal']);

/** Pieces whose 'ground' variant differs (footings, skirts, own floor slab). */
const HAS_GROUND = new Set(['floor', 'glass-floor', 'wood-deck', 'wall', 'glass-wall', 'window-wall', 'door-wall', 'half-wall', 'pillar', 'cube-module', 'stairs', 'canopy', 'workshop', 'tower']);
const ALWAYS_GROUND = new Set(['foundation', 'landing-pad']);

export function normVariant(id, variant) {
  if (ALWAYS_GROUND.has(id)) return 'ground';
  if (!HAS_GROUND.has(id)) return 'raised';
  return variant === 'ground' ? 'ground' : 'raised';
}

class PartSet {
  constructor() {
    this.b = {};
  }
}
for (const k of PART_ORDER) {
  Object.defineProperty(PartSet.prototype, k, {
    get() {
      return this.b[k] || (this.b[k] = new GeoBuilder());
    },
  });
}

const bx = (x, y, z, w, h, d, solid = true, walkable = true, extra = {}) => ({ x, y, z, w, h, d, rotY: 0, solid, walkable, ...extra });
const hplane = (w, d) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
const ico = (r, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
const torus = (r, t, rs = 8, ts = 32) => new THREE.TorusGeometry(r, t, rs, ts);
const KEEP = { uv: 'keep' };

// ------------------------------------------------------------------ helpers
/** Concrete roof slab (top at y) with a metal fascia frame + dark membrane, w × d. */
function roofSlab(S, y, w = 4, d = 4, glow = true) {
  S.concrete.box(w - 0.08, 0.24, d - 0.08, 0, y - 0.12, 0, { color: CONC_L });
  S.metal.box(w, 0.3, 0.04, 0, y - 0.12, -(d / 2 - 0.02), { color: FRAME });
  S.metal.box(w, 0.3, 0.04, 0, y - 0.12, d / 2 - 0.02, { color: FRAME });
  S.metal.box(0.04, 0.3, d - 0.08, -(w / 2 - 0.02), y - 0.12, 0, { color: FRAME });
  S.metal.box(0.04, 0.3, d - 0.08, w / 2 - 0.02, y - 0.12, 0, { color: FRAME });
  S.matte.box(w - 0.08, 0.02, d - 0.08, 0, y + 0.01, 0, { color: 0x4a4d52 });
  if (glow) {
    const nx = Math.max(1, Math.round(w / 4));
    for (let i = 0; i < nx; i++) S.glow.box(2.4, 0.02, 1.4, -w / 2 + 2 + i * 4, y - 0.25, 0, CEIL);
  }
}

/** Warm LED strip around the top side faces of a w × d slab at height y. */
function ledRing(S, w, d, y, c = { color: 0xffb070, intensity: 2.2 }) {
  S.glow.box(w - 0.6, 0.03, 0.02, 0, y, -d / 2 - 0.006, c);
  S.glow.box(w - 0.6, 0.03, 0.02, 0, y, d / 2 + 0.006, c);
  S.glow.box(0.02, 0.03, d - 0.6, -w / 2 - 0.006, y, 0, c);
  S.glow.box(0.02, 0.03, d - 0.6, w / 2 + 0.006, y, 0, c);
}

/** Wall posts at both ends (inset so neighbouring walls never overlap). */
function wallPosts(S, h = 3.0) {
  S.metal.box(0.16, h, 0.24, -1.92, h / 2, 0, { color: FRAME });
  S.metal.box(0.16, h, 0.24, 1.92, h / 2, 0, { color: FRAME });
}

function wallFooting(S) {
  S.concrete.box(4.0, 1.2, 0.3, 0, -0.6, 0, { color: CONC_D });
}

const WALL_BOX = () => bx(0, 1.5, 0, 4, 3.0, 0.22, true, false);

/** A few low-poly leaves (matte, flat shaded) around a point. */
function shrub(S, x, y, z, r, rng, colors = [0x3f6a2a, 0x557a34, 0x2f5a26]) {
  const n = 3 + Math.floor(rng.random() * 2);
  for (let i = 0; i < n; i++) {
    const g = ico(r * rng.range(0.55, 0.85));
    S.matte.geo(g, x + rng.range(-r, r) * 0.6, y + rng.range(0, r * 0.7), z + rng.range(-r, r) * 0.6, { color: rng.pick(colors), rx: rng.random() * 3, ry: rng.random() * 3 });
    g.dispose();
  }
}

/** Workbench body (tier 1 + 2): steel-framed table, wood top, drawer cabinet, tool board, holo screen. */
function benchBase(S, B, accent = 0x7fe0ff) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.metal.box(0.08, 0.9, 0.08, sx * 1.02, 0.45, sz * 0.38, { color: FRAME });
  S.metal.box(2.04, 0.04, 0.8, 0, 0.22, 0, { color: FRAME2 });
  S.wood.box(2.2, 0.07, 0.95, 0, 0.935, 0, { color: WOOD });
  S.metal.box(2.22, 0.06, 0.03, 0, 0.935, -0.485, { color: STEEL });
  S.neon.box(1.9, 0.015, 0.015, 0, 0.885, -0.47, { color: accent, intensity: 1.6 });
  // drawer cabinet (right) + parts crates on the shelf (left)
  S.metal.box(0.7, 0.66, 0.8, 0.62, 0.55, 0, { color: 0x3a3e46 });
  for (let k = 0; k < 3; k++) {
    S.metal.box(0.62, 0.17, 0.02, 0.62, 0.35 + k * 0.2, -0.405, { color: 0xc4c8ce });
    S.metal.box(0.18, 0.025, 0.03, 0.62, 0.38 + k * 0.2, -0.42, { color: FRAME });
  }
  S.wood.box(0.5, 0.3, 0.42, -0.62, 0.39, 0.05, { color: 0x9a7448 });
  S.metal.box(0.34, 0.22, 0.34, -0.15, 0.35, 0.1, { color: FRAME2 });
  S.neon.box(0.2, 0.03, 0.02, -0.15, 0.4, -0.075, { color: accent, intensity: 1.8 });
  // tool board with a warm light bar, tools, holo screen
  S.metal.box(0.06, 1.15, 0.06, -1.02, 1.5, 0.42, { color: FRAME });
  S.metal.box(0.06, 1.15, 0.06, 1.02, 1.5, 0.42, { color: FRAME });
  S.matte.box(2.0, 0.95, 0.03, 0, 1.45, 0.44, { color: 0x2b2f36 });
  S.metal.box(2.1, 0.06, 0.16, 0, 2.06, 0.38, { color: FRAME });
  S.glow.box(1.8, 0.02, 0.06, 0, 2.025, 0.36, { color: 0xffd6a0, intensity: 2.4 });
  S.metal.box(0.05, 0.42, 0.03, 0.2, 1.45, 0.42, { rz: 0.25, color: STEEL });
  S.metal.box(0.05, 0.36, 0.03, 0.34, 1.48, 0.42, { rz: -0.2, color: STEEL });
  S.metal.box(0.22, 0.08, 0.03, 0.27, 1.72, 0.42, { color: 0xc94a2a });
  S.metal.box(0.04, 0.3, 0.03, 0.55, 1.42, 0.42, { color: STEEL });
  S.metal.box(0.6, 0.38, 0.03, -0.52, 1.5, 0.405, { color: FRAME });
  S.neon.box(0.54, 0.32, 0.01, -0.52, 1.5, 0.388, { color: accent, intensity: 1.15 });
  // vise + a part on the top
  S.metal.box(0.22, 0.12, 0.18, -0.92, 1.03, -0.3, { color: FRAME2 });
  S.metal.box(0.06, 0.16, 0.16, -0.84, 1.08, -0.3, { color: STEEL });
  S.metal.cyl(0.08, 0.08, 0.18, 0.05, 1.06, -0.12, { seg: 10, rz: Math.PI / 2, color: STEEL });
  B.push(bx(0, 0.5, 0, 2.2, 1.0, 0.95));
  B.push(bx(0, 1.5, 0.42, 2.1, 1.1, 0.12, true, false));
}

// ------------------------------------------------------------------ builders
const BUILD = {
  // ================================================================ STRUCTURE
  foundation(S, ground, B) {
    S.concrete.box(4, 0.4, 4, 0, -0.2, 0, { color: CONC });
    S.concrete.box(3.94, 3.0, 3.94, 0, -1.9, 0, { color: CONC_D });
    S.metal.box(4.02, 0.05, 0.05, 0, -0.025, -1.995, { color: FRAME });
    S.metal.box(4.02, 0.05, 0.05, 0, -0.025, 1.995, { color: FRAME });
    S.metal.box(0.05, 0.05, 3.94, -1.995, -0.025, 0, { color: FRAME });
    S.metal.box(0.05, 0.05, 3.94, 1.995, -0.025, 0, { color: FRAME });
    ledRing(S, 4, 4, -0.14);
    B.push(bx(0, -1.6, 0, 4, 3.2, 4));
  },

  'cube-module'(S, ground, B) {
    if (ground) {
      S.concrete.box(4, 0.3, 4, 0, -0.15, 0, { color: CONC_L });
      S.concrete.box(3.94, 1.5, 3.94, 0, -1.05, 0, { color: CONC_D });
      ledRing(S, 4, 4, -0.12);
      B.push(bx(0, -0.9, 0, 4, 1.8, 4));
    }
    S.wood.box(3.68, 0.03, 3.68, 0, 0.015, 0, { color: WOOD });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.metal.box(0.16, 2.96, 0.16, sx * 1.92, 1.48, sz * 1.92, { color: FRAME });
    for (const s of [-1, 1]) {
      S.metal.box(3.68, 0.12, 0.16, 0, 0.06, s * 1.92, { color: FRAME });
      S.metal.box(0.16, 0.12, 3.68, s * 1.92, 0.06, 0, { color: FRAME });
      S.metal.box(3.68, 0.16, 0.16, 0, 2.88, s * 1.92, { color: FRAME });
      S.metal.box(0.16, 0.16, 3.68, s * 1.92, 2.88, 0, { color: FRAME });
      S.glass.box(0.03, 2.68, 3.68, s * 1.92, 1.46, 0);
      S.glass.box(1.24, 2.68, 0.03, s * 1.22, 1.46, -1.92);
      S.metal.box(0.06, 2.68, 0.1, s * 0.6, 1.46, -1.92, { color: FRAME });
    }
    S.glass.box(3.68, 2.68, 0.03, 0, 1.46, 1.92);
    S.glass.box(1.14, 0.42, 0.03, 0, 2.59, -1.92);
    S.metal.box(1.2, 0.05, 0.1, 0, 2.36, -1.92, { color: FRAME });
    roofSlab(S, 3.2, 4, 4, false);
    S.glow.box(2.6, 0.02, 1.6, 0, 2.93, 0, { color: 0xffe0b8, intensity: 1.7 });
    // furniture silhouettes (read as a lived-in room through the glass)
    S.matte.box(1.8, 0.42, 0.8, 0, 0.24, 1.3, { color: 0x6b6b70 });
    S.matte.box(1.8, 0.45, 0.18, 0, 0.64, 1.62, { color: 0x5e5e64 });
    S.wood.box(0.9, 0.05, 0.5, 0, 0.42, 0.25, { color: WOOD_D });
    S.metal.box(0.06, 0.4, 0.06, 0, 0.2, 0.25, { color: FRAME });
    S.matte.cyl(0.18, 0.14, 0.4, -1.45, 0.2, -1.35, { color: 0x2e3036, seg: 10 });
    shrub(S, -1.45, 0.62, -1.35, 0.42, new Rng('cube-plant'));
    S.metal.cyl(0.02, 0.02, 1.5, 1.45, 0.78, 1.45, { color: FRAME, seg: 6 });
    S.glow.cyl(0.13, 0.17, 0.22, 1.45, 1.6, 1.45, { color: 0xffd6a0, intensity: 1.8, seg: 10 });
    B.push(bx(0, 1.5, 1.92, 4, 3.0, 0.16, true, false));
    B.push(bx(-1.92, 1.5, 0, 0.16, 3.0, 4, true, false));
    B.push(bx(1.92, 1.5, 0, 0.16, 3.0, 4, true, false));
    B.push(bx(-1.22, 1.5, -1.92, 1.24, 3.0, 0.16, true, false));
    B.push(bx(1.22, 1.5, -1.92, 1.24, 3.0, 0.16, true, false));
    B.push(bx(0, 2.65, -1.92, 1.2, 0.7, 0.16, true, false));
    B.push(bx(0, 3.08, 0, 4, 0.24, 4));
    B.push(bx(0, 0.62, 1.4, 1.8, 0.4, 0.8, true, true)); // sofa (sit/jump)
  },

  stairs(S, ground, B) {
    const n = 10;
    const rise = 0.32;
    const run = 0.36;
    if (ground) {
      S.concrete.box(2.0, 0.25, 4.0, 0, -0.125, 0, { color: CONC_D });
      S.concrete.box(1.9, 1.2, 3.9, 0, -0.85, 0, { color: CONC_D });
    }
    for (let k = 0; k < n; k++) {
      const top = (k + 1) * rise;
      const z = 1.8 - (k + 0.5) * run;
      S.wood.box(1.6, 0.06, run + 0.02, 0, top - 0.03, z, { color: WOOD });
      S.glow.box(1.2, 0.015, 0.02, 0, top - 0.07, z - run / 2 + 0.02, { color: 0xffc080, intensity: 1.8 });
      B.push(bx(0, top / 2, z, 1.6, top, run));
    }
    for (const sx of [-0.84, 0.84]) S.metal.beam([sx, 0.02, 1.86], [sx, 3.2, -1.8], 0.09, { color: FRAME });
    S.metal.beam([0.84, 1.0, 1.86], [0.84, 4.2, -1.8], 0.05, { color: FRAME });
    for (const k of [0, 3, 6, 9]) {
      const top = (k + 1) * rise;
      const z = 1.8 - (k + 0.5) * run;
      S.metal.box(0.03, 0.92, 0.03, 0.84, top + 0.46, z, { color: FRAME });
    }
  },

  pillar(S, ground, B) {
    if (ground) S.concrete.box(0.6, 1.0, 0.6, 0, -0.5, 0, { color: CONC_D });
    S.concrete.box(0.36, 2.88, 0.36, 0, 1.5, 0, { color: CONC });
    S.metal.box(0.42, 0.08, 0.42, 0, 0.04, 0, { color: FRAME });
    S.metal.box(0.42, 0.08, 0.42, 0, 2.96, 0, { color: FRAME });
    S.glow.box(0.04, 1.6, 0.02, 0, 1.5, -0.186, { color: 0xffc890, intensity: 1.6 });
    B.push(bx(0, 1.5, 0, 0.38, 3.0, 0.38, true, false));
  },

  tower(S, ground, B) {
    const R = 3.2;
    const base = 0.5;
    const top = base + 4 * 3.2;
    S.concrete.cyl(3.9, 4.0, 0.5, 0, 0.25, 0, { seg: 32, color: CONC_D });
    if (ground) S.concrete.cyl(3.85, 3.85, 1.6, 0, -0.8, 0, { seg: 32, color: CONC_D });
    S.concrete.cyl(1.0, 1.0, top - base, 0, (top + base) / 2, 0, { seg: 20, color: CONC });
    for (let k = 0; k < 4; k++) {
      const y0 = base + k * 3.2;
      S.glass.cyl(R, R, 2.95, 0, y0 + 1.475, 0, { seg: 32, open: true });
      S.glow.cyl(1.03, 1.03, 0.08, 0, y0 + 2.3, 0, { seg: 20, open: true, color: 0xffd6a0, intensity: 1.6 });
      S.matte.box(1.6, 0.4, 0.7, 1.9, y0 + 0.2, 0.6, { color: 0x6b6b70, ry: 0.4 });
    }
    for (let k = 1; k <= 4; k++) {
      const y = base + k * 3.2;
      S.concrete.cyl(3.45, 3.45, 0.25, 0, y - 0.125, 0, { seg: 32, color: CONC_L });
      S.glow.cyl(2.6, 2.6, 0.02, 0, y - 0.26, 0, { seg: 24, color: 0xffe0b8, intensity: 1.3 });
      // spiralling balcony arcs (like the blueprint tower of 03_building_city)
      const a0 = k * 1.35;
      const segs = 12;
      const span = 3.6;
      const dA = span / segs;
      for (let i = 0; i < segs; i++) {
        const a = a0 + (i + 0.5) * dA;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const ry = Math.PI / 2 - a;
        S.concrete.box(3.6 * dA + 0.03, 0.14, 0.75, c * 3.575, y - 0.07, s * 3.575, { ry, color: CONC_L });
        S.glass.box(3.92 * dA + 0.02, 0.9, 0.03, c * 3.92, y + 0.45, s * 3.92, { ry });
        S.metal.box(3.92 * dA + 0.03, 0.04, 0.05, c * 3.92, y + 0.92, s * 3.92, { ry, color: FRAME });
      }
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      S.metal.box(0.08, top - base, 0.08, Math.cos(a) * 3.22, (top + base) / 2, Math.sin(a) * 3.22, { color: FRAME, ry: Math.PI / 2 - a });
    }
    // crown, cyan halo ring and antenna with a red beacon
    S.metal.cyl(3.5, 3.5, 0.45, 0, top + 0.22, 0, { seg: 32, color: FRAME });
    S.neon.cyl(3.53, 3.53, 0.07, 0, top + 0.12, 0, { seg: 40, open: true, color: 0x7fe0ff, intensity: 2.2 });
    S.metal.cyl(0.05, 0.09, 4, 0, top + 2.4, 0, { seg: 8, color: STEEL });
    S.neon.box(0.16, 0.16, 0.16, 0, top + 4.45, 0, { color: 0xff3a24, intensity: 3.2 });
    // entrance canopy
    S.metal.box(2.0, 0.08, 0.7, 0, base + 2.7, -3.55, { color: FRAME });
    S.glow.box(1.6, 0.02, 0.04, 0, base + 2.65, -3.85, LAMP);
    B.push(bx(0, 0.25, 0, 7.8, 0.5, 7.8));
    B.push(bx(0, (top + 0.45 + base) / 2, 0, 6.6, top + 0.45 - base, 6.6));
  },

  'landing-pad'(S, ground, B) {
    S.metal.box(7.9, 0.3, 7.0, 0, 0.95, -0.45, { color: 0x2c2f35 });
    S.decal.geo(hplane(6.4, 6.4), 0, 1.106, -0.45, KEEP);
    for (const sx of [-1, 0, 1]) {
      for (const sz of [-1, 1]) S.metal.box(0.35, 2.3, 0.35, sx * 3.6, -0.05, sz * 3.1 - 0.45, { color: 0x3a3e45 });
    }
    const n = 28;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const side = Math.floor(t * 4);
      const f = t * 4 - side;
      const hx = 3.82;
      const z0 = -3.87;
      const z1 = 2.97;
      const pts = [
        [-hx + f * 2 * hx, z0],
        [hx, z0 + f * (z1 - z0)],
        [hx - f * 2 * hx, z1],
        [-hx, z1 - f * (z1 - z0)],
      ][side];
      if (side === 2 && Math.abs(pts[0]) < 1.3) continue; // stair opening
      S.glow.box(0.22, 0.05, 0.22, pts[0], 1.125, pts[1], { color: 0xffb04a, intensity: 3.2 });
    }
    S.concrete.box(2.4, 0.733, 0.35, 0, 0.367, 3.225, { color: CONC_D });
    S.concrete.box(2.4, 0.367, 0.35, 0, 0.183, 3.575, { color: CONC_D });
    S.metal.box(2.4, 0.03, 0.06, 0, 0.745, 3.07, { color: STEEL });
    S.metal.box(2.4, 0.03, 0.06, 0, 0.38, 3.42, { color: STEEL });
    S.pool.geo(hplane(10, 10), 0, 1.12, -0.45, { uv: 'keep', color: 0xffb060, intensity: 0.5 });
    B.push(bx(0, 0.55, -0.45, 7.9, 1.1, 7.0));
    B.push(bx(0, 0.367, 3.225, 2.4, 0.733, 0.35));
    B.push(bx(0, 0.183, 3.575, 2.4, 0.367, 0.35));
  },

  workshop(S, ground, B) {
    if (ground) {
      S.concrete.box(8, 0.3, 4, 0, -0.15, 0, { color: CONC_D });
      S.concrete.box(7.94, 1.5, 3.94, 0, -1.05, 0, { color: CONC_D });
      B.push(bx(0, -0.9, 0, 8, 1.8, 4));
    }
    S.concrete.box(7.5, 2.96, 0.25, 0, 1.48, 1.875, { color: 0x9a958c });
    for (const s of [-1, 1]) {
      S.concrete.box(0.25, 2.96, 3.47, s * 3.875, 1.48, 0.0, { color: 0x9a958c });
      S.metal.box(0.28, 2.96, 0.28, s * 3.86, 1.48, -1.86, { color: FRAME });
      S.metal.box(0.28, 2.96, 0.28, s * 3.86, 1.48, 1.86, { color: FRAME });
    }
    roofSlab(S, 3.2, 8, 4, false);
    // half-raised roller door + header light
    S.metal.box(7.2, 0.9, 0.08, 0, 2.5, -1.85, { color: 0x2c2f35 });
    for (let k = 0; k < 3; k++) S.metal.box(7.2, 0.03, 0.1, 0, 2.2 + k * 0.3, -1.86, { color: 0x3a3e45 });
    S.metal.box(7.5, 0.2, 0.3, 0, 2.95, -1.9, { color: FRAME });
    S.glow.box(7.0, 0.04, 0.04, 0, 2.83, -2.03, LAMP);
    // lit interior: back wall glow, tools, bench, crates
    S.glow.box(7.0, 2.1, 0.03, 0, 1.2, 1.73, { color: 0xffd2a0, intensity: 0.8 });
    S.glow.box(6.0, 0.03, 1.2, 0, 2.92, 0.6, { color: 0xffe0b8, intensity: 1.5 });
    const rng = new Rng('workshop');
    for (let k = 0; k < 11; k++) S.matte.box(0.06, rng.range(0.3, 0.7), 0.04, -3.0 + k * 0.32, 1.95, 1.69, { color: 0x2a2620, rz: rng.range(-0.3, 0.3) });
    S.wood.box(3.4, 0.08, 0.8, -1.3, 0.9, 1.3, { color: WOOD_D });
    S.wood.box(3.3, 0.04, 0.7, -1.3, 0.35, 1.3, { color: WOOD_D });
    for (const sx of [-2.9, 0.3]) for (const sz of [0.98, 1.62]) S.metal.box(0.06, 0.88, 0.06, sx, 0.44, sz, { color: FRAME });
    for (let k = 0; k < 5; k++) S.matte.box(0.26, 0.22, 0.3, -2.6 + k * 0.6, 1.05, 1.3, { color: rng.pick([0xb04a2a, 0x2f5e8a, 0xc9a46a, 0x5a6068]) });
    S.wood.box(0.8, 0.8, 0.8, 2.7, 0.4, 1.0, { color: WOOD });
    S.wood.box(0.6, 0.6, 0.6, 2.75, 1.1, 1.05, { color: 0x9a7448, ry: 0.4 });
    S.matte.cyl(0.32, 0.32, 0.9, 2.4, 0.45, -0.6, { color: 0xb05a2a, seg: 14 });
    // solar panels on the roof (like the workshop wing in 13_player_base)
    for (let i = 0; i < 3; i++) {
      const x = -2.6 + i * 2.6;
      S.solar.box(2.3, 0.05, 1.6, x, 3.62, 0.15, { rx: -0.35, color: 0xffffff });
      S.metal.box(2.36, 0.04, 1.66, x, 3.59, 0.16, { rx: -0.35, color: STEEL });
      S.metal.beam([x, 3.2, 0.6], [x, 3.82, 0.45], 0.05, { color: STEEL });
    }
    S.pool.geo(hplane(7, 5), 0, 0.04, -3.4, { uv: 'keep', color: 0xffb070, intensity: 0.6 });
    B.push(bx(0, 1.5, 1.875, 8, 3.0, 0.25, true, false));
    B.push(bx(-3.875, 1.5, 0, 0.25, 3.0, 4, true, false));
    B.push(bx(3.875, 1.5, 0, 0.25, 3.0, 4, true, false));
    B.push(bx(0, 3.08, 0, 8, 0.24, 4));
    B.push(bx(-1.3, 0.47, 1.3, 3.4, 0.94, 0.8));
    B.push(bx(2.7, 0.4, 1.0, 0.8, 0.8, 0.8));
  },

  // ===================================================================== WALL
  wall(S, ground, B) {
    if (ground) wallFooting(S);
    wallPosts(S);
    S.concrete.box(3.68, 3.0, 0.18, 0, 1.5, 0, { color: CONC });
    S.wood.box(3.68, 2.72, 0.04, 0, 1.46, -0.11, { color: WOOD });
    S.metal.box(3.68, 0.08, 0.26, 0, 2.96, 0, { color: FRAME });
    S.metal.box(3.68, 0.06, 0.24, 0, 0.03, 0, { color: FRAME });
    B.push(WALL_BOX());
  },

  'glass-wall'(S, ground, B) {
    if (ground) wallFooting(S);
    wallPosts(S);
    S.metal.box(0.07, 2.84, 0.12, 0, 1.5, 0, { color: FRAME });
    S.metal.box(3.68, 0.16, 0.2, 0, 2.92, 0, { color: FRAME });
    S.metal.box(3.68, 0.1, 0.2, 0, 0.05, 0, { color: FRAME });
    S.glass.box(3.68, 2.74, 0.03, 0, 1.47, 0);
    B.push(WALL_BOX());
  },

  'window-wall'(S, ground, B) {
    if (ground) wallFooting(S);
    wallPosts(S);
    S.concrete.box(3.68, 1.0, 0.2, 0, 0.5, 0, { color: CONC });
    S.concrete.box(3.68, 0.6, 0.2, 0, 2.7, 0, { color: CONC });
    S.concrete.box(0.14, 1.4, 0.2, -1.77, 1.7, 0, { color: CONC });
    S.concrete.box(0.14, 1.4, 0.2, 1.77, 1.7, 0, { color: CONC });
    S.wood.box(3.68, 0.92, 0.04, 0, 0.5, -0.12, { color: WOOD });
    S.metal.box(3.44, 0.06, 0.3, 0, 1.0, -0.02, { color: FRAME });
    S.metal.box(3.44, 0.06, 0.24, 0, 2.4, 0, { color: FRAME });
    S.metal.box(0.06, 1.4, 0.24, -1.7, 1.7, 0, { color: FRAME });
    S.metal.box(0.06, 1.4, 0.24, 1.7, 1.7, 0, { color: FRAME });
    S.metal.box(0.05, 1.34, 0.12, 0, 1.7, 0, { color: FRAME });
    S.glass.box(3.36, 1.34, 0.03, 0, 1.7, 0);
    B.push(WALL_BOX());
  },

  'door-wall'(S, ground, B) {
    if (ground) wallFooting(S);
    wallPosts(S);
    for (const s of [-1, 1]) {
      S.concrete.box(1.24, 3.0, 0.18, s * 1.22, 1.5, 0, { color: CONC });
      S.wood.box(1.24, 2.72, 0.04, s * 1.22, 1.46, -0.11, { color: WOOD });
      S.metal.box(0.08, 2.3, 0.26, s * 0.64, 1.15, 0, { color: FRAME });
      B.push(bx(s * 1.22, 1.5, 0, 1.24, 3.0, 0.22, true, false));
    }
    S.concrete.box(1.2, 0.7, 0.18, 0, 2.65, 0, { color: CONC });
    S.wood.box(1.2, 0.5, 0.04, 0, 2.55, -0.11, { color: WOOD });
    S.metal.box(1.36, 0.08, 0.26, 0, 2.34, 0, { color: FRAME });
    S.metal.box(3.68, 0.08, 0.26, 0, 2.96, 0, { color: FRAME });
    S.metal.box(0.34, 0.06, 0.12, 0, 2.52, -0.18, { color: FRAME });
    S.glow.box(0.3, 0.02, 0.08, 0, 2.485, -0.18, LAMP);
    B.push(bx(0, 2.65, 0, 1.2, 0.7, 0.22, true, false));
  },

  'half-wall'(S, ground, B) {
    if (ground) wallFooting(S);
    wallPosts(S, 1.1);
    S.concrete.box(3.68, 1.02, 0.18, 0, 0.51, 0, { color: CONC });
    S.wood.box(4.0, 0.06, 0.3, 0, 1.08, 0, { color: WOOD });
    B.push(bx(0, 0.55, 0, 4, 1.1, 0.22, true, false));
  },

  // ==================================================================== FLOOR
  floor(S, ground, B) {
    S.concrete.box(3.88, 0.2, 3.88, 0, -0.1, 0, { color: CONC_L });
    S.metal.box(4.0, 0.2, 0.06, 0, -0.1, -1.97, { color: FRAME });
    S.metal.box(4.0, 0.2, 0.06, 0, -0.1, 1.97, { color: FRAME });
    S.metal.box(0.06, 0.2, 3.88, -1.97, -0.1, 0, { color: FRAME });
    S.metal.box(0.06, 0.2, 3.88, 1.97, -0.1, 0, { color: FRAME });
    if (ground) {
      S.concrete.box(3.86, 1.2, 3.86, 0, -0.8, 0, { color: CONC_D });
      ledRing(S, 4, 4, -0.1, { color: 0xffb070, intensity: 1.8 });
      B.push(bx(0, -0.7, 0, 4, 1.4, 4));
    } else {
      S.glow.box(2.2, 0.02, 1.2, 0, -0.21, 0, CEIL);
      B.push(bx(0, -0.1, 0, 4, 0.2, 4));
    }
  },

  'glass-floor'(S, ground, B) {
    S.metal.box(4.0, 0.2, 0.1, 0, -0.1, -1.95, { color: FRAME });
    S.metal.box(4.0, 0.2, 0.1, 0, -0.1, 1.95, { color: FRAME });
    S.metal.box(0.1, 0.2, 3.8, -1.95, -0.1, 0, { color: FRAME });
    S.metal.box(0.1, 0.2, 3.8, 1.95, -0.1, 0, { color: FRAME });
    S.metal.box(3.8, 0.16, 0.06, 0, -0.1, 0, { color: FRAME });
    S.metal.box(0.06, 0.16, 3.8, 0, -0.1, 0, { color: FRAME });
    S.glass.box(3.8, 0.04, 3.8, 0, -0.03, 0);
    if (ground) {
      S.concrete.box(3.86, 0.9, 3.86, 0, -0.65, 0, { color: CONC_D });
      S.matte.box(3.78, 0.04, 3.78, 0, -0.2, 0, { color: 0x3a3c40 });
      S.glow.box(3.5, 0.02, 0.04, 0, -0.17, -1.8, { color: 0x9fd8ff, intensity: 1.6 });
      S.glow.box(3.5, 0.02, 0.04, 0, -0.17, 1.8, { color: 0x9fd8ff, intensity: 1.6 });
      B.push(bx(0, -0.55, 0, 4, 1.1, 4));
    } else {
      S.glow.box(3.6, 0.02, 0.04, 0, -0.205, -1.85, { color: 0xbfe6ff, intensity: 1.5 });
      S.glow.box(3.6, 0.02, 0.04, 0, -0.205, 1.85, { color: 0xbfe6ff, intensity: 1.5 });
      B.push(bx(0, -0.1, 0, 4, 0.2, 4));
    }
  },

  'wood-deck'(S, ground, B) {
    S.wood.box(4.0, 0.06, 4.0, 0, -0.03, 0, { color: WOOD });
    for (const z of [-1.8, -0.6, 0.6, 1.8]) S.wood.box(3.9, 0.14, 0.1, 0, -0.13, z, { color: WOOD_D });
    S.metal.box(4.0, 0.16, 0.05, 0, -0.1, -1.985, { color: FRAME });
    S.metal.box(4.0, 0.16, 0.05, 0, -0.1, 1.985, { color: FRAME });
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) {
        S.glow.box(0.22, 0.03, 0.03, t, -0.1, s * 2.02, LAMP);
        S.glow.box(0.03, 0.03, 0.22, s * 2.0, -0.1, t, LAMP);
      }
    }
    if (ground) {
      for (const sx of [-1.8, 0, 1.8]) for (const sz of [-1.8, 0, 1.8]) S.wood.box(0.12, 1.4, 0.12, sx, -0.85, sz, { color: WOOD_D });
      B.push(bx(0, -0.6, 0, 4, 1.2, 4));
    } else B.push(bx(0, -0.1, 0, 4, 0.2, 4));
  },

  // ===================================================================== ROOF
  'flat-roof'(S, ground, B) {
    roofSlab(S, 0, 4, 4, true);
    B.push(bx(0, -0.125, 0, 4, 0.25, 4));
  },

  'pitched-roof'(S, ground, B) {
    const a = Math.atan2(1.4, 4); // rise 1.4 m from the +Z eave to the −Z ridge
    const nY = Math.cos(a);
    const nZ = Math.sin(a);
    const cy = 0.5;
    S.metal.box(4.2, 0.12, 4.84, 0, cy + nY * 0.06, nZ * 0.06, { rx: a, color: 0x34383f });
    for (let x = -1.8; x <= 1.81; x += 0.45) S.metal.box(0.03, 0.05, 4.84, x, cy + nY * 0.14, nZ * 0.14, { rx: a, color: 0x4a4f57 });
    S.wood.box(4.2, 0.03, 4.84, 0, cy - nY * 0.02, -nZ * 0.02, { rx: a, color: WOOD });
    const tri = new THREE.Shape();
    tri.moveTo(2, -0.2);
    tri.lineTo(-2, -0.2);
    tri.lineTo(-2, 1.2);
    tri.closePath();
    const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.16, bevelEnabled: false });
    S.wood.geo(gable, 2.0, 0, 0, { ry: -Math.PI / 2, color: WOOD });
    S.wood.geo(gable, -1.84, 0, 0, { ry: -Math.PI / 2, color: WOOD });
    gable.dispose();
    S.wood.box(4.0, 1.4, 0.16, 0, 0.5, -1.92, { color: WOOD });
    S.glow.box(3.6, 0.03, 0.05, 0, -0.3, 2.2, LAMP);
    B.push(bx(0, 0.5, 0, 4.0, 1.4, 4.0, true, false));
  },

  canopy(S, ground, B) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        S.metal.box(0.12, 2.9, 0.12, sx * 1.85, 1.45, sz * 1.85, { color: FRAME });
        if (ground) S.concrete.box(0.32, 0.6, 0.32, sx * 1.85, -0.3, sz * 1.85, { color: CONC_D });
        B.push(bx(sx * 1.85, 1.45, sz * 1.85, 0.14, 2.9, 0.14, true, false));
      }
      S.metal.box(3.82, 0.2, 0.12, 0, 2.95, sx * 1.85, { color: FRAME });
      S.metal.box(0.12, 0.2, 3.58, sx * 1.85, 2.95, 0, { color: FRAME });
    }
    for (let k = 0; k < 14; k++) S.wood.box(0.08, 0.07, 3.9, -1.82 + k * 0.28, 3.09, 0, { color: WOOD });
    for (let k = 0; k < 7; k++) S.glow.box(0.07, 0.07, 0.07, -1.5 + k * 0.5, 2.78 - Math.sin((k / 6) * Math.PI) * 0.18, 0, { color: 0xffcf8a, intensity: 2.4 });
    B.push(bx(0, 3.05, 0, 4, 0.25, 4, false, false, { hitOnly: true }));
  },

  // ==================================================================== DECOR
  planter(S, ground, B) {
    S.concrete.box(1.3, 0.5, 0.5, 0, 0.25, 0, { color: 0x9a958d });
    S.matte.box(1.2, 0.04, 0.4, 0, 0.48, 0, { color: 0x3a2a1e });
    const rng = new Rng('planter');
    for (const x of [-0.4, 0, 0.4]) shrub(S, x, 0.62, 0, 0.3, rng);
    for (let k = 0; k < 5; k++) S.matte.cyl(0.0, 0.03, rng.range(0.4, 0.7), rng.range(-0.55, 0.55), 0.7, rng.range(-0.12, 0.12), { seg: 4, color: 0x6a8a3a, rx: rng.range(-0.3, 0.3), rz: rng.range(-0.3, 0.3) });
    B.push(bx(0, 0.25, 0, 1.3, 0.5, 0.5));
  },

  lamp(S, ground, B) {
    S.metal.cyl(0.16, 0.2, 0.06, 0, 0.03, 0, { seg: 12, color: FRAME });
    S.metal.cyl(0.04, 0.05, 2.3, 0, 1.18, 0, { seg: 8, color: FRAME });
    S.metal.box(0.5, 0.05, 0.08, 0.2, 2.31, 0, { color: FRAME });
    S.metal.box(0.38, 0.1, 0.24, 0.4, 2.27, 0, { color: FRAME });
    S.glow.box(0.32, 0.02, 0.19, 0.4, 2.214, 0, { color: 0xffd6a0, intensity: 3.2 });
    S.pool.geo(hplane(3.4, 3.4), 0.4, 0.05, 0, { uv: 'keep', color: 0xffc890, intensity: 0.9 });
    B.push(bx(0, 1.2, 0, 0.18, 2.4, 0.18, true, false));
  },

  bench(S, ground, B) {
    for (let k = 0; k < 3; k++) S.wood.box(1.8, 0.05, 0.13, 0, 0.45, -0.15 + k * 0.15, { color: WOOD });
    for (const s of [-1, 1]) {
      S.metal.box(0.06, 0.43, 0.42, s * 0.75, 0.215, 0, { color: FRAME });
      S.metal.box(0.05, 0.5, 0.04, s * 0.75, 0.7, 0.22, { color: FRAME });
    }
    S.wood.box(1.8, 0.12, 0.04, 0, 0.66, 0.24, { color: WOOD });
    S.wood.box(1.8, 0.12, 0.04, 0, 0.84, 0.25, { color: WOOD });
    B.push(bx(0, 0.25, 0, 1.8, 0.5, 0.5));
  },

  table(S, ground, B) {
    S.wood.box(1.6, 0.06, 0.9, 0, 0.75, 0, { color: WOOD });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.metal.box(0.06, 0.72, 0.06, sx * 0.7, 0.36, sz * 0.36, { color: FRAME });
    S.matte.cyl(0.06, 0.05, 0.12, 0.3, 0.84, 0.1, { seg: 8, color: 0xd8d2c6 });
    B.push(bx(0, 0.39, 0, 1.6, 0.78, 0.9));
  },

  banner(S, ground, B) {
    S.metal.cyl(0.25, 0.3, 0.1, 0, 0.05, 0, { seg: 12, color: FRAME });
    S.metal.cyl(0.045, 0.05, 4.6, 0, 2.3, 0, { seg: 8, color: FRAME });
    S.metal.box(1.2, 0.05, 0.05, 0, 4.45, 0, { color: FRAME });
    S.metal.cyl(0.0, 0.06, 0.16, 0, 4.68, 0, { seg: 8, color: STEEL });
    S.banner.geo(new THREE.PlaneGeometry(1.1, 2.9, 1, 1), 0, 2.95, 0.03, KEEP);
    B.push(bx(0, 2.3, 0, 0.2, 4.6, 0.2, true, false));
  },

  brazier(S, ground, B) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      S.metal.beam([Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4], [Math.cos(a) * 0.26, 0.78, Math.sin(a) * 0.26], 0.05, { color: FRAME });
    }
    S.metal.cyl(0.42, 0.26, 0.32, 0, 0.9, 0, { seg: 14, color: 0x2a2420 });
    S.metal.geo(torus(0.42, 0.03, 6, 20), 0, 1.06, 0, { rx: Math.PI / 2, color: FRAME });
    const rng = new Rng('embers');
    for (let k = 0; k < 7; k++) {
      const g = ico(rng.range(0.08, 0.14));
      const a = rng.random() * Math.PI * 2;
      const r = rng.range(0, 0.26);
      S.neon.geo(g, Math.cos(a) * r, 1.07, Math.sin(a) * r, { color: 0xff5a18, intensity: 2.4, rx: rng.random() * 3 });
      g.dispose();
    }
    for (let k = 0; k < 3; k++) {
      const plane = new THREE.PlaneGeometry(0.7, 1.0).translate(0, 0.5, 0);
      S.flame.geo(plane, 0, 1.0, 0, { uv: 'keep', ry: (k / 3) * Math.PI });
      plane.dispose();
    }
    S.pool.geo(hplane(4.2, 4.2), 0, 0.05, 0, { uv: 'keep', color: 0xff9a50, intensity: 1.0 });
    B.push(bx(0, 0.55, 0, 0.84, 1.1, 0.84, true, false));
  },

  crates(S, ground, B) {
    S.wood.box(0.9, 0.8, 0.9, -0.3, 0.4, 0, { color: WOOD });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.metal.box(0.06, 0.8, 0.06, -0.3 + sx * 0.43, 0.4, sz * 0.43, { color: FRAME });
    S.wood.box(0.7, 0.6, 0.7, -0.25, 1.1, 0.05, { ry: 0.3, color: 0x9a7448 });
    S.metal.box(0.9, 0.6, 0.6, 0.62, 0.3, 0.15, { color: FRAME2 });
    S.metal.box(0.92, 0.05, 0.62, 0.62, 0.45, 0.15, { color: 0x3a3e46 });
    S.neon.box(0.16, 0.05, 0.02, 0.62, 0.36, -0.16, { color: 0x7fe0ff, intensity: 2.2 });
    B.push(bx(-0.3, 0.4, 0, 0.9, 0.8, 0.9));
    B.push(bx(-0.25, 1.1, 0.05, 0.7, 0.6, 0.7, true, true, { rotY: 0.3 }));
    B.push(bx(0.62, 0.3, 0.15, 0.9, 0.6, 0.6));
  },

  statue(S, ground, B) {
    S.concrete.box(1.4, 0.8, 1.4, 0, 0.4, 0, { color: CONC_D });
    S.concrete.box(1.5, 0.08, 1.5, 0, 0.84, 0, { color: CONC_L });
    S.metal.geo(torus(0.85, 0.11, 10, 44), 0, 2.0, 0, { color: 0xd8d2c6 });
    S.metal.beam([-0.95, 1.05, 0], [0.95, 2.95, 0], 0.16, { color: 0xd8d2c6 });
    S.metal.box(0.22, 0.22, 0.22, -0.88, 0.97, 0, { color: 0xd8d2c6 });
    S.neon.geo(torus(0.85, 0.022, 6, 52), 0, 2.0, -0.11, { color: 0x7fe0ff, intensity: 2.2 });
    S.neon.geo(torus(0.85, 0.022, 6, 52), 0, 2.0, 0.11, { color: 0x7fe0ff, intensity: 2.2 });
    S.glow.box(1.2, 0.02, 0.04, 0, 0.82, -0.73, LAMP);
    B.push(bx(0, 1.5, 0, 1.4, 3.0, 1.4, true, false));
  },

  'neon-tree'(S, ground, B) {
    S.matte.cyl(0.1, 0.2, 2.4, 0, 1.2, 0, { seg: 8, color: 0x3a2e34 });
    for (const [x, y, z] of [[0.75, 2.45, 0.2], [-0.65, 2.35, -0.3], [0.1, 2.7, -0.7], [-0.2, 2.6, 0.7]]) S.matte.beam([0, 1.7, 0], [x, y, z], 0.08, { color: 0x3a2e34 });
    const rng = new Rng('neon-tree');
    for (let k = 0; k < 16; k++) {
      const a = rng.random() * Math.PI * 2;
      const r = rng.range(0.2, 1.25);
      const g = ico(rng.range(0.22, 0.42));
      const c = k % 5 === 0 ? { color: 0x7fe0ff, intensity: 1.8 } : k % 2 ? { color: 0xb48cff, intensity: 2.1 } : { color: 0xd07cff, intensity: 1.8 };
      S.neon.geo(g, Math.cos(a) * r, 2.75 + rng.range(-0.35, 0.45), Math.sin(a) * r, { ...c, rx: rng.random() * 3, ry: rng.random() * 3 });
      g.dispose();
    }
    S.pool.geo(hplane(4.4, 4.4), 0, 0.05, 0, { uv: 'keep', color: 0xb48cff, intensity: 0.8 });
    B.push(bx(0, 1.2, 0, 0.42, 2.4, 0.42, true, false));
  },

  // ==================================================================== POWER
  'solar-panel'(S, ground, B) {
    const a = -0.528;
    const nY = Math.cos(a);
    const nZ = Math.sin(a);
    for (const s of [-1, 1]) {
      S.metal.box(0.06, 1.2, 0.06, s * 1.15, 0.6, 0.6, { color: FRAME });
      S.metal.box(0.06, 0.5, 0.06, s * 1.15, 0.25, -0.6, { color: FRAME });
      S.metal.box(1.24, 0.06, 1.64, s * 0.62, 0.86, 0, { rx: a, color: STEEL });
      S.solar.box(1.2, 0.05, 1.6, s * 0.62, 0.86 + nY * 0.02, nZ * 0.02, { rx: a, color: 0xffffff });
    }
    S.metal.box(2.36, 0.06, 0.06, 0, 1.18, 0.6, { color: FRAME });
    S.metal.box(2.36, 0.06, 0.06, 0, 0.5, -0.6, { color: FRAME });
    S.metal.box(0.4, 0.3, 0.15, 0, 0.45, 0.62, { color: FRAME2 });
    S.neon.box(0.06, 0.03, 0.02, 0.1, 0.52, 0.538, { color: 0x6dff9a, intensity: 2.0 });
    B.push(bx(0, 0.7, 0, 2.5, 1.4, 1.5, true, false));
  },

  generator(S, ground, B) {
    for (const s of [-1, 1]) S.metal.box(0.12, 0.12, 1.1, s * 0.6, 0.06, 0, { color: FRAME });
    S.metal.box(1.6, 1.0, 1.0, 0, 0.62, 0, { color: 0x3a3e46 });
    S.metal.box(1.64, 0.06, 1.04, 0, 1.15, 0, { color: 0x2a2d33 });
    for (let k = 0; k < 5; k++) S.metal.box(0.5, 0.04, 0.02, -0.35, 0.42 + k * 0.1, -0.51, { color: 0x16181c });
    S.matte.box(0.5, 0.42, 0.02, 0.4, 0.58, -0.51, { color: 0xd8d2c6 });
    S.neon.box(0.42, 0.05, 0.02, 0.4, 0.95, -0.515, { color: 0x7fe0ff, intensity: 2.4 });
    S.metal.cyl(0.07, 0.07, 0.6, 0.55, 1.45, 0.3, { seg: 10, color: STEEL });
    S.metal.cyl(0.1, 0.08, 0.08, 0.55, 1.76, 0.3, { seg: 10, color: FRAME });
    B.push(bx(0, 0.6, 0, 1.7, 1.2, 1.1));
  },

  battery(S, ground, B) {
    // graphite power-wall cabinet: light front panel, cooling fins, charge bars
    S.concrete.box(1.1, 0.12, 0.9, 0, 0.06, 0, { color: CONC_D });
    S.metal.box(0.9, 1.7, 0.7, 0, 0.97, 0, { color: 0x30343b });
    S.metal.box(0.76, 1.46, 0.03, 0, 1.0, -0.36, { color: 0xc4c8ce });
    S.metal.box(0.94, 0.08, 0.74, 0, 1.86, 0, { color: STEEL });
    S.metal.box(0.5, 0.36, 0.02, 0, 1.45, -0.38, { color: 0x1b1e23 });
    for (let k = 0; k < 6; k++) S.neon.box(0.36, 0.09, 0.02, 0, 0.42 + k * 0.15, -0.385, { color: 0x7fe0ff, intensity: k < 4 ? 1.8 : 0.2 });
    S.neon.box(0.3, 0.04, 0.02, 0, 1.52, -0.395, { color: 0x6dff9a, intensity: 1.6 });
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) S.metal.box(0.04, 1.2, 0.03, sx * 0.47, 0.98, -0.2 + k * 0.13, { color: 0x1c1f24 });
    B.push(bx(0, 0.95, 0, 1.0, 1.9, 0.8));
  },

  'light-mast'(S, ground, B) {
    S.concrete.box(0.6, 0.3, 0.6, 0, 0.15, 0, { color: CONC_D });
    S.metal.cyl(0.07, 0.1, 6.2, 0, 3.4, 0, { seg: 10, color: FRAME });
    S.metal.box(1.2, 0.08, 0.08, 0, 6.42, 0, { color: FRAME });
    const rx = -0.6;
    for (const s of [-1, 1]) {
      S.metal.box(0.45, 0.28, 0.2, s * 0.45, 6.3, -0.1, { rx, color: FRAME });
      S.glow.box(0.38, 0.22, 0.02, s * 0.45, 6.3 - 0.0593, -0.1 - 0.0867, { rx, color: 0xfff0d8, intensity: 4.0 });
    }
    S.pool.geo(hplane(9, 9), 0, 0.06, -2.4, { uv: 'keep', color: 0xfff0d8, intensity: 0.5 });
    B.push(bx(0, 3.2, 0, 0.3, 6.4, 0.3, true, false));
  },

  'fusion-core'(S, ground, B) {
    S.metal.cyl(1.2, 1.3, 0.5, 0, 0.25, 0, { seg: 24, color: FRAME2 });
    S.neon.cyl(1.215, 1.215, 0.05, 0, 0.42, 0, { seg: 32, open: true, color: 0x7fe0ff, intensity: 2.0 });
    S.glass.cyl(0.62, 0.62, 1.7, 0, 1.35, 0, { seg: 24, open: true });
    S.neon.geo(ico(0.32, 2), 0, 1.35, 0, { color: 0x9fe8ff, intensity: 4.5 });
    S.neon.cyl(0.06, 0.06, 1.7, 0, 1.35, 0, { seg: 8, color: 0x7fe0ff, intensity: 3.5 });
    for (let k = 0; k < 3; k++) S.metal.geo(torus(0.78, 0.06, 8, 32), 0, 0.75 + k * 0.55, 0, { rx: Math.PI / 2, color: STEEL });
    S.metal.cyl(0.9, 0.75, 0.3, 0, 2.35, 0, { seg: 24, color: FRAME2 });
    S.neon.cyl(0.76, 0.76, 0.04, 0, 2.19, 0, { seg: 32, open: true, color: 0x7fe0ff, intensity: 2.2 });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      S.metal.beam([Math.cos(a) * 0.85, 2.3, Math.sin(a) * 0.85], [Math.cos(a) * 1.15, 0.45, Math.sin(a) * 1.15], 0.09, { color: 0x3a3e46 });
    }
    S.pool.geo(hplane(5.5, 5.5), 0, 0.05, 0, { uv: 'keep', color: 0x7fe0ff, intensity: 0.6 });
    B.push(bx(0, 1.25, 0, 2.4, 2.5, 2.4, true, false));
  },
  // ================================================================= SURVIVAL
  workbench(S, ground, B) {
    benchBase(S, B);
    // tier 1: a single cyan status light on the cabinet
    S.neon.box(0.12, 0.03, 0.02, 0.62, 0.84, -0.416, { color: 0x7fe0ff, intensity: 2.2 });
  },

  'workbench-2'(S, ground, B) {
    benchBase(S, B, 0xc9a45a);
    // fabricator arm (right): turntable, two links, cyan emitter
    S.metal.cyl(0.16, 0.19, 0.1, 0.78, 1.02, 0.18, { seg: 14, color: FRAME2 });
    S.metal.beam([0.78, 1.06, 0.18], [0.6, 1.62, 0.02], 0.07, { color: STEEL });
    S.metal.beam([0.6, 1.62, 0.02], [0.3, 1.36, -0.16], 0.055, { color: STEEL });
    S.metal.geo(ico(0.07, 0), 0.6, 1.62, 0.02, { color: FRAME });
    S.neon.cyl(0.0, 0.04, 0.1, 0.27, 1.3, -0.17, { seg: 8, color: 0x9fe8ff, intensity: 3.2 });
    // hologram projector ring + core (left)
    S.metal.cyl(0.22, 0.24, 0.05, -0.5, 1.0, -0.05, { seg: 18, color: FRAME });
    S.neon.geo(torus(0.2, 0.012, 4, 28), -0.5, 1.03, -0.05, { rx: Math.PI / 2, color: 0x7fe0ff, intensity: 2.4 });
    S.neon.geo(torus(0.27, 0.008, 4, 28), -0.5, 1.32, -0.05, { rx: Math.PI / 2, color: 0x7fe0ff, intensity: 1.6 });
    S.neon.geo(ico(0.09, 1), -0.5, 1.3, -0.05, { color: 0x9fe8ff, intensity: 2.6 });
    // energy cells on the back board + tier badge (two lights)
    for (const x of [0.62, 0.82]) {
      S.metal.cyl(0.07, 0.07, 0.42, x, 1.32, 0.38, { seg: 10, color: FRAME2 });
      S.neon.cyl(0.05, 0.05, 0.3, x, 1.32, 0.33, { seg: 10, color: 0x7fe0ff, intensity: 2.0 });
    }
    S.neon.box(0.12, 0.03, 0.02, 0.55, 0.84, -0.416, { color: 0x7fe0ff, intensity: 2.2 });
    S.neon.box(0.12, 0.03, 0.02, 0.69, 0.84, -0.416, { color: 0x7fe0ff, intensity: 2.2 });
  },

  'claim-beacon'(S, ground, B) {
    S.concrete.box(1.2, 0.3, 1.2, 0, 0.15, 0, { color: CONC_D });
    S.concrete.box(0.84, 0.22, 0.84, 0, 0.41, 0, { color: CONC_L });
    S.metal.cyl(0.13, 0.2, 2.7, 0, 1.87, 0, { seg: 6, color: FRAME });
    for (const sx of [-1, 1]) S.metal.box(0.04, 1.9, 0.34, sx * 0.17, 1.55, 0.02, { color: FRAME2 });
    // light seams down the front + a ring at the collar
    S.neon.box(0.035, 2.1, 0.02, 0, 1.62, -0.17, { color: 0x7fe0ff, intensity: 2.0 });
    S.neon.cyl(0.215, 0.215, 0.04, 0, 0.62, 0, { seg: 18, open: true, color: 0x7fe0ff, intensity: 1.8 });
    // Ø emblem near the top, facing front (−Z) and back
    S.metal.geo(torus(0.34, 0.05, 6, 28), 0, 3.0, 0, { color: 0xd8d2c6 });
    S.metal.beam([-0.38, 2.62, 0], [0.38, 3.38, 0], 0.045, { color: 0xd8d2c6 });
    S.neon.geo(torus(0.34, 0.014, 4, 32), 0, 3.0, -0.055, { color: 0x7fe0ff, intensity: 2.4 });
    S.neon.geo(torus(0.34, 0.014, 4, 32), 0, 3.0, 0.055, { color: 0x7fe0ff, intensity: 2.4 });
    // beacon lamp
    S.metal.cyl(0.1, 0.14, 0.12, 0, 3.27, 0, { seg: 10, color: FRAME });
    S.neon.geo(ico(0.12, 1), 0, 3.45, 0, { color: 0x9fe8ff, intensity: 3.6 });
    S.pool.geo(hplane(4.2, 4.2), 0, 0.05, 0, { uv: 'keep', color: 0x38d2ff, intensity: 0.8 });
    B.push(bx(0, 0.26, 0, 1.2, 0.52, 1.2));
    B.push(bx(0, 1.9, 0, 0.5, 2.8, 0.5, true, false));
  },

  'spawn-beacon'(S, ground, B) {
    S.metal.cyl(1.08, 1.14, 0.16, 0, 0.08, 0, { seg: 28, color: FRAME2 });
    S.concrete.cyl(0.94, 0.94, 0.04, 0, 0.17, 0, { seg: 28, color: CONC_L });
    S.neon.geo(torus(1.0, 0.022, 4, 48), 0, 0.165, 0, { rx: Math.PI / 2, color: 0x7fe0ff, intensity: 2.2 });
    // Ø on the pad
    S.neon.geo(torus(0.42, 0.03, 4, 36), 0, 0.195, 0, { rx: Math.PI / 2, color: 0x9fe8ff, intensity: 1.8 });
    S.neon.box(1.02, 0.012, 0.06, 0, 0.195, 0, { ry: Math.PI / 4, color: 0x9fe8ff, intensity: 1.8 });
    // three light posts around the rim
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * 1.22;
      const z = Math.sin(a) * 1.22;
      S.metal.cyl(0.06, 0.08, 0.95, x, 0.475, z, { seg: 8, color: FRAME });
      S.neon.cyl(0.045, 0.045, 0.22, x, 1.02, z, { seg: 8, color: 0x7fe0ff, intensity: 2.6 });
    }
    S.pool.geo(hplane(4.4, 4.4), 0, 0.04, 0, { uv: 'keep', color: 0x38d2ff, intensity: 0.7 });
    B.push(bx(0, 0.095, 0, 2.2, 0.19, 2.2, true, true));
  },
};

// ------------------------------------------------------------------- cache
const CACHE = new Map();

/** Cached geometry + boxes of a piece variant (see the header). */
export function pieceInfo(id, variant = 'raised') {
  const v = normVariant(id, variant);
  const key = `${id}:${v}`;
  let info = CACHE.get(key);
  if (info) return info;
  const fn = BUILD[id];
  if (!fn) throw new Error(`build: unknown piece "${id}"`);
  const S = new PartSet();
  const boxes = [];
  fn(S, v === 'ground', boxes);
  const parts = [];
  for (const mat of PART_ORDER) {
    const b = S.b[mat];
    if (!b || b.empty) continue;
    parts.push({ mat, geometry: b.build() });
  }
  const ghost = mergeParts(parts.filter((p) => !NOT_IN_GHOST.has(p.mat)).map((p) => p.geometry));
  const edges = new THREE.EdgesGeometry(ghost, 28);
  ghost.computeBoundingBox();
  const bb = ghost.boundingBox;
  info = {
    id,
    variant: v,
    key,
    parts,
    ghost,
    edges,
    boxes: boxes.filter((b) => !b.hitOnly),
    hits: boxes,
    minY: bb.min.y,
    maxY: bb.max.y,
    bounds: bb.clone(),
  };
  CACHE.set(key, info);
  return info;
}

export function hasBuilder(id) {
  return !!BUILD[id];
}
