import { hash2, u01, nextHash, sstep, mix } from './noise.js';

/**
 * Points of interest: ancient Ø ruins (loot caches), pirate outposts, crash
 * sites (crashed ships). At most one per 900 m cell, kept ≥ 150 m from the cell
 * edges (so POIs are ≥ 300 m apart and a POI's pad never crosses into another
 * cell), never in the safe zone + spawn buffer, on water, on steep ground or
 * within 150 m of a highway. The pad (flattened ground under the model) is
 * applied by heightAt. Stable ids: 'p:<ci>:<cj>'.
 */
export const POI_CELL = 1100;
const MARGIN = 150;

export const POI_TYPES = {
  ruin: { name: { en: 'Ancient Ø Ruins', nl: 'Oude Ø-ruïnes' }, radius: 26, loot: 'relic', enemies: [['drone', 3, 4]], density: 1.6 },
  outpost: { name: { en: 'Pirate Outpost', nl: 'Piratenbuitenpost' }, radius: 30, loot: 'pirate', enemies: [['drone', 3, 5], ['stalker', 1, 1, true]], density: 2 },
  wreck: { name: { en: 'Crash Site', nl: 'Neerstortplek' }, radius: 24, loot: 'salvage', enemies: [['drone', 2, 3], ['stalker', 2, 2, true]], density: 1.4 },
};

// POI type preference per biome index (ocean, coast, meadow, forest, jungle, highlands, badlands, peaks)
const TYPE_WEIGHTS = [
  null,
  { ruin: 1, outpost: 2, wreck: 1 },
  { ruin: 1, outpost: 1.5, wreck: 1.5 },
  { ruin: 2, outpost: 1, wreck: 1 },
  { ruin: 3, outpost: 0.6, wreck: 1 },
  { ruin: 2, outpost: 1, wreck: 1.2 },
  { ruin: 0.6, outpost: 3, wreck: 2 },
  { ruin: 1, outpost: 0.5, wreck: 1.5 },
];

/**
 * @param o.seedHash  uint32
 * @param o.baseH     (x, z) → combined natural height
 * @param o.biomeAt   (x, z) → dominant biome index
 * @param o.hubDist   (x, z) → distance outside the safe zone (0 inside)
 * @param o.roadDist  (x, z, reach) → distance to the nearest highway centreline (Infinity if none within)
 * @param o.minHubDist  no POIs closer to the safe zone than this (m)
 */
export function createPois({ seedHash, baseH, biomeAt, hubDist, roadDist, minHubDist = 260, chance = 0.42 }) {
  const CAP = 128; // direct-mapped cache 128 × 128 cells (≈ 115 km square)
  const keyI = new Int32Array(CAP * CAP).fill(0x7fffffff);
  const keyJ = new Int32Array(CAP * CAP);
  const vals = new Array(CAP * CAP).fill(null);

  function generate(ci, cj) {
    let h = hash2(ci, cj, seedHash);
    if (u01(h) > chance) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      h = nextHash(h);
      const x = ci * POI_CELL + MARGIN + u01(h) * (POI_CELL - 2 * MARGIN);
      h = nextHash(h);
      const z = cj * POI_CELL + MARGIN + u01(h) * (POI_CELL - 2 * MARGIN);
      if (hubDist(x, z) < minHubDist) continue;
      const y = baseH(x, z);
      if (y < 3) continue;
      // flat enough: ±18 m height spread
      const a = baseH(x + 18, z);
      const b = baseH(x - 18, z);
      const c = baseH(x, z + 18);
      const d = baseH(x, z - 18);
      const spread = Math.max(Math.abs(a - y), Math.abs(b - y), Math.abs(c - y), Math.abs(d - y));
      if (spread > 7 || Math.min(a, b, c, d) < 1.5) continue;
      if (roadDist(x, z, 160) < 150) continue;
      const bi = biomeAt(x, z);
      const tw = TYPE_WEIGHTS[bi];
      if (!tw) continue;
      h = nextHash(h);
      let r = u01(h) * (tw.ruin + tw.outpost + tw.wreck);
      const type = (r -= tw.ruin) < 0 ? 'ruin' : (r -= tw.outpost) < 0 ? 'outpost' : 'wreck';
      const T = POI_TYPES[type];
      h = nextHash(h);
      const variant = h % 3;
      h = nextHash(h);
      const rot = u01(h) * Math.PI * 2;
      // the pad sits slightly below the mean so the edges blend down rather than up
      const padY = (y * 2 + a + b + c + d) / 6 - 0.3;
      return {
        id: `p:${ci}:${cj}`,
        type,
        variant,
        x,
        z,
        y: padY,
        rot,
        radius: T.radius,
        biome: bi,
        name: T.name,
        loot: { table: T.loot, tier: 1 + (hubDist(x, z) > 4000 ? 1 : 0) + (hubDist(x, z) > 9000 ? 1 : 0) },
      };
    }
    return null;
  }

  function at(ci, cj) {
    const k = (ci & (CAP - 1)) * CAP + (cj & (CAP - 1));
    if (keyI[k] === ci && keyJ[k] === cj) return vals[k];
    const v = generate(ci, cj);
    keyI[k] = ci;
    keyJ[k] = cj;
    vals[k] = v;
    return v;
  }

  /** The POI whose pad may cover (x, z), or null. */
  function covering(x, z) {
    return at(Math.floor(x / POI_CELL), Math.floor(z / POI_CELL));
  }

  /** Pad: blend the terrain to the POI's flat ground within radius + 30 m. */
  function pad(x, z, h) {
    const p = covering(x, z);
    if (!p) return h;
    const dx = x - p.x;
    const dz = z - p.z;
    const R = p.radius + 30;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) return h;
    const d = Math.sqrt(d2);
    return mix(h, p.y, 1 - sstep(p.radius * 0.7, R, d));
  }

  function near(x, z, r) {
    const out = [];
    const i0 = Math.floor((x - r - 100) / POI_CELL);
    const i1 = Math.floor((x + r + 100) / POI_CELL);
    const j0 = Math.floor((z - r - 100) / POI_CELL);
    const j1 = Math.floor((z + r + 100) / POI_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const p = at(i, j);
        if (!p) continue;
        const d = Math.sqrt((p.x - x) ** 2 + (p.z - z) ** 2);
        if (d <= r) out.push(p);
      }
    }
    return out;
  }

  return { at, covering, pad, near, cell: POI_CELL };
}
