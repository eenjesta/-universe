/**
 * The one seamless world (PLATFORM.md §11 / §11.2): a protected social HUB in
 * the middle (the hand-made area, |x|, |z| ≤ 1100 m) and the infinite survival
 * planet around it. Pure data + tiny pure helpers, shared by the sim, the
 * stand-in world provider (shared/sim/standin.js) and clients (HUD "Safe zone",
 * build previews, death screen, Gateway menu).
 *
 * hubDist(x, z) = distance outside the hub square (max(|x|, |z|) − 1100, ≥ 0).
 */

export const HUB = {
  half: 1100, // hub square half-size: |x|, |z| ≤ 1100 → SAFE ZONE (no enemies, combat, damage, hunger, building)
  blend: 300, // seam band where worldgen blends the hub heightfield into the procedural terrain
  spawnBuffer: 200, // no enemy spawns where hubDist < 200 (≈ 1300 m from the centre)
  enemyMargin: 12, // enemies steer away from the hub border (m)
  noBuild: 500, // no building / claims where hubDist < 500 (§11.2 anti-wall-in buffer)
  heightLimitDist: 2000, // where hubDist < 2000 ...
  heightLimit: 16, // ... structures may not rise more than 16 m above the terrain
  highwayClear: 20, // no building within 20 m of a highway centreline (worldgen roads)
  poiClear: 60, // claims stay ≥ 60 m away from POIs (worldgen)
};

/** Claims (§11.2): one per player, radius 24 m, ≥ 30 m apart (edge to edge), decay after 30 days away. */
export const CLAIM_RULES = {
  radius: 24,
  perPlayer: 1,
  gap: 30, // m between the edges of claims of different owners
  expireDays: 30, // owner inactivity before the base starts to decay
  decayDays: 3, // decay to ruins over 3 days, then removed
};

/** Travel (§11.2): Gateway in the hub + "Return to hub" from anywhere (C.TRAVEL). */
export const TRAVEL_RULES = {
  hubChannel: 10, // s channel for "Return to hub" (cancelled by damage, firing or moving > moveTol m)
  hubCooldown: 120, // s between hub returns
  combatLock: 8, // s after the last combat action (shot, hit taken) before a channel may start
  moveTol: 4, // m of movement allowed while channelling
  wildMin: 2000, // "Random wilderness": a safe spot 2–8 km from the centre
  wildMax: 8000,
};

/** Coordinates beyond this (m) are rejected as nonsense (the server schema allows 1e5). */
export const WORLD_LIMIT = 90000;

/** Distance outside the hub square (0 inside). */
export function hubDist(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z)) - HUB.half;
  return d > 0 ? d : 0;
}

/** Inside the hub square (the safe zone of the stand-in world; worldgen.isSafe is the authority). */
export const inHub = (x, z) => Math.abs(x) <= HUB.half && Math.abs(z) <= HUB.half;

/** Biomes of the procedural world (names for HUD / map; worldgen may add more). */
export const BIOMES = {
  hub: { id: 'hub', name: { en: 'Safe zone', nl: 'Veilige zone' } },
  jungle: { id: 'jungle', name: { en: 'Lumen Wilds', nl: 'Lumen-wildernis' } },
  badlands: { id: 'badlands', name: { en: 'Red Badlands', nl: 'Rode woestenij' } },
  ocean: { id: 'ocean', name: { en: 'Open sea', nl: 'Open zee' } },
  forest: { id: 'forest', name: { en: 'Deep forest', nl: 'Diep woud' } },
  meadow: { id: 'meadow', name: { en: 'Meadows', nl: 'Weides' } },
  mountains: { id: 'mountains', name: { en: 'Highlands', nl: 'Hooglanden' } },
};

/** HUD strings for the border (client: t(ZONE_TEXT.safe)). */
export const ZONE_TEXT = {
  safe: { en: 'Safe zone', nl: 'Veilige zone' },
  leaving: { en: 'Leaving the safe zone', nl: 'Je verlaat de veilige zone' },
  wild: { en: 'Wilderness — survival', nl: 'Wildernis — overleven' },
};
