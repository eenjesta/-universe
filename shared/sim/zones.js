/**
 * Safe zone + the shared world clock (pure JS).
 *
 * Safe zone (PLATFORM.md §11): the whole hub — the hand-made area in the middle
 * (|x|, |z| ≤ HUB.half = 1100 m): no enemies, no combat (weapons holstered), no
 * damage, no hunger drain, no building. The sim asks its world provider
 * (`isSafe(x, z)`, worldgen or shared/sim/standin.js); this file keeps the
 * static stand-in geometry for clients that want the same rule without a
 * provider (`safeZoneAt(x, z, margin)` → zone | null). "Inside your own claim
 * during the day" (enemies ignore you) is dynamic: isSafeFor in players.js.
 *
 * World clock: 1 game hour = 2 real minutes (HOURS_PER_SECOND = 1/120), start 17.6;
 * dayFactor uses the same sun model as src/world/atmosphere/time.js.
 */
import { smoothstep } from './util.js';
import { HUB } from '../defs/world.js';

export const SAFE_ZONES = [{ id: 'hub', name: { en: 'Safe zone', nl: 'Veilige zone' }, r: [-HUB.half, HUB.half, -HUB.half, HUB.half] }];

/** Safe zone containing (x, z) (with an optional margin), or null. */
export function safeZoneAt(x, z, margin = 0) {
  for (const s of SAFE_ZONES) {
    if (s.c) {
      if (Math.hypot(x - s.c[0], z - s.c[1]) < s.c[2] + margin) return s;
    } else if (x >= s.r[0] - margin && x <= s.r[1] + margin && z >= s.r[2] - margin && z <= s.r[3] + margin) return s;
  }
  return null;
}

/** Distance from (x, z) to the edge of a safe zone (negative inside). */
export function safeZoneDistance(s, x, z) {
  if (s.c) return Math.hypot(x - s.c[0], z - s.c[1]) - s.c[2];
  const dx = Math.max(s.r[0] - x, 0, x - s.r[1]);
  const dz = Math.max(s.r[2] - z, 0, z - s.r[3]);
  if (dx === 0 && dz === 0) return -Math.min(x - s.r[0], s.r[1] - x, z - s.r[2], s.r[3] - z);
  return Math.hypot(dx, dz);
}

// ------------------------------------------------------------------ clock
export const DEFAULT_HOUR = 17.6;
export const HOURS_PER_SECOND = 1 / 120;
const SUN_MAX_SIN = Math.sin((62 * Math.PI) / 180);

export const wrapHour = (h) => {
  h = Number(h);
  if (!Number.isFinite(h)) return DEFAULT_HOUR;
  return ((h % 24) + 24) % 24;
};

/** 0 at night … 1 in full daylight (≈0.43 at 17.6), identical to the client sky. */
export function dayFactorAt(hour) {
  const w = ((hour - 12) / 24) * Math.PI * 2;
  const sinEl = SUN_MAX_SIN * Math.cos(w);
  return smoothstep(-0.12, 0.35, sinEl);
}

/** Respawn / travel destinations in the hub (C.RESPAWN {at: 'spawn'}, C.TRAVEL {to: 'hub'}). */
export const RESPAWN_POINTS = {
  spawn: { x: 0, z: 150, h: 0 }, // the Overlook
};
