/**
 * Deterministic harvest-node generator — shared by the server sim and the
 * client build module (src/build/harvest.js) so both agree on ids, positions
 * and types. Ported from the original src/build/harvest.js layout (same
 * regions, mixes, Rng('build-nodes') sequence and spot rules) minus the
 * client-only physics-box query; the slope test is computed from getHeightAt
 * (central differences ±1 m, like world.getNormalAt) so Node and the browser
 * produce identical lists. Pure JS.
 *
 *   generateNodes({ getHeightAt, isWater }) → [{ id: 'n0', type, resource, x, y, z, rotY, scale }]
 */
import { Rng } from './rng.js';
import { ROADS } from '../../src/world/layout.js';
import { protectedAt } from '../defs/pieces.js';

/** Node types: resource, amount range per harvest, hold seconds (client), respawn seconds. */
export const NODE_TYPES = {
  metal: { resource: 'metal', amount: [6, 9], hold: 1.6, respawn: [150, 240], name: { en: 'Metal ore', nl: 'Metaalerts' } },
  stone: { resource: 'stone', amount: [8, 12], hold: 1.4, respawn: [150, 240], name: { en: 'Stone', nl: 'Steen' } },
  wood: { resource: 'wood', amount: [8, 12], hold: 1.4, respawn: [150, 240], name: { en: 'Wood pile', nl: 'Houtstapel' } },
  energy: { resource: 'energy', amount: [5, 8], hold: 1.8, respawn: [150, 240], name: { en: 'Energy crystal', nl: 'Energiekristal' } },
};

export const NODE_REGIONS = [
  { x: -228, z: 330, rMin: 34, rMax: 86, n: 13, mix: ['wood', 'wood', 'wood', 'wood', 'stone', 'stone', 'stone', 'metal', 'metal', 'metal', 'energy', 'energy', 'wood'] },
  { x: -140, z: 248, rMin: 6, rMax: 46, n: 5, mix: ['wood', 'stone', 'wood', 'metal', 'stone'] },
  { x: -280, z: 30, rMin: 16, rMax: 64, n: 7, mix: ['stone', 'metal', 'stone', 'metal', 'energy', 'stone', 'metal'] },
  { x: 70, z: 215, rMin: 24, rMax: 72, n: 6, mix: ['stone', 'metal', 'wood', 'stone', 'wood', 'metal'] },
  { x: 250, z: 95, rMin: 46, rMax: 84, n: 9, mix: ['stone', 'metal', 'energy', 'stone', 'metal', 'energy', 'stone', 'metal', 'energy'] },
];

/** Build plot (ZONES.base.buildArea) — kept free of nodes. */
const BA = { x: -205, z: 318, size: 48 };

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

/** Distance from (x, z) to the nearest road edge (≤ 0 on the road). */
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

let cache = null;
let cacheKey = null;

/**
 * Generates the node list. Results are cached per getHeightAt function, so the
 * server and LocalServer can call it freely.
 */
export function generateNodes({ getHeightAt, isWater } = {}) {
  const H = typeof getHeightAt === 'function' ? getHeightAt : () => 0;
  const W = typeof isWater === 'function' ? isWater : () => false;
  if (cache && cacheKey === H) return cache;
  const rng = new Rng('build-nodes');
  const nodes = [];
  const okSpot = (x, z) => {
    const h = H(x, z);
    if (h < 1.5 || W(x, z)) return false;
    const hx = H(x - 1, z) - H(x + 1, z);
    const hz = H(x, z - 1) - H(x, z + 1);
    const ny = 2 / Math.sqrt(hx * hx + 4 + hz * hz);
    if (ny < 0.84) return false;
    if (roadClearance(x, z) < 3.5) return false;
    if (protectedAt(x, z, 4)) return false;
    if (Math.abs(x - BA.x) < BA.size / 2 + 5 && Math.abs(z - BA.z) < BA.size / 2 + 5) return false;
    for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < 8) return false;
    return true;
  };
  for (const R of NODE_REGIONS) {
    let placed = 0;
    for (let tries = 0; tries < R.n * 40 && placed < R.n; tries++) {
      const a = rng.random() * Math.PI * 2;
      const r = R.rMin + Math.sqrt(rng.random()) * (R.rMax - R.rMin);
      const x = R.x + Math.cos(a) * r;
      const z = R.z + Math.sin(a) * r;
      if (!okSpot(x, z)) continue;
      const type = R.mix[placed % R.mix.length];
      nodes.push({
        id: `n${nodes.length}`,
        type,
        resource: NODE_TYPES[type].resource,
        x,
        y: H(x, z),
        z,
        rotY: rng.random() * Math.PI * 2,
        scale: rng.range(0.85, 1.2),
      });
      placed++;
    }
  }
  cache = nodes;
  cacheKey = H;
  return nodes;
}
