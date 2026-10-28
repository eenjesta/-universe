/**
 * The hub safe zone and the no-build buffer around it (PLATFORM.md §11 / §11.2) —
 * pure stand-in rules (no DOM, node --test). src/smp/world.js prefers the real
 * world provider (ctx.worldgen / shared/worldgen: isSafe, isBuildable) and falls
 * back to these until it lands.
 *
 *   HUB square: max(|x|, |z|) ≤ HUB_HALF → safe zone (no enemies, combat, damage, hunger, building)
 *   hubDist(x, z) = max(|x|, |z|) − HUB_HALF, ≥ 0 (distance outside the hub square)
 *   no building / claims where hubDist < BUILD_BUFFER
 */
import { HUB } from '../../shared/defs/world.js';

export const HUB_HALF = HUB.half;
export const BUILD_BUFFER = HUB.noBuild;
/** "Leaving the safe zone" band just inside the border (m). */
export const LEAVING_WARN = 120;
/** Hysteresis for the crossing events (m). */
export const ZONE_HYST = 10;
/** Spacing of the Ø border beacons along the hub square (m). */
export const POST_SPACING = 110;

/** Signed distance to the hub border: negative inside the safe zone. */
export function borderDist(x, z, half = HUB_HALF) {
  return Math.max(Math.abs(x), Math.abs(z)) - half;
}

/** Distance outside the hub square (0 inside). */
export function hubDist(x, z, half = HUB_HALF) {
  const d = borderDist(x, z, half);
  return d > 0 ? d : 0;
}

/**
 * Static build rules (stand-in for worldgen.isBuildable): null when building is
 * allowed, else { reason: 'safe' | 'buffer', need } (need = metres still to go).
 */
export function standInBuildable(x, z, { half = HUB_HALF, buffer = BUILD_BUFFER } = {}) {
  const d = borderDist(x, z, half);
  if (d <= 0) return { reason: 'safe', need: buffer - d };
  if (d < buffer) return { reason: 'buffer', need: buffer - d };
  return null;
}

/**
 * Normalises a provider answer (worldgen.isBuildable → {ok, reason} | bool | null)
 * into null (ok) or { reason }.
 */
export function normBuildable(r) {
  if (r == null || r === true) return null;
  if (r === false) return { reason: 'invalid' };
  if (typeof r === 'object') {
    if (r.ok === false || (r.ok === undefined && r.reason)) return { ...r, reason: String(r.reason || 'invalid') };
    return null;
  }
  return null;
}

/**
 * Tracks the player's zone with hysteresis. update(d) with d = borderDist →
 * { kind: 'safe' | 'leaving' | 'buffer' | 'wild', crossed: 0 | 1 (entered the hub) | -1 (left it) }.
 */
export function createZoneTracker({ buffer = BUILD_BUFFER, warn = LEAVING_WARN, hyst = ZONE_HYST } = {}) {
  let safe = null;
  const out = { kind: 'safe', crossed: 0, safe: true };
  return {
    get safe() {
      return safe;
    },
    reset() {
      safe = null;
    },
    update(d) {
      let crossed = 0;
      if (safe === null) safe = d <= 0;
      else if (safe && d > hyst) {
        safe = false;
        crossed = -1;
      } else if (!safe && d < -hyst) {
        safe = true;
        crossed = 1;
      }
      out.kind = safe ? (d > -warn ? 'leaving' : 'safe') : d < buffer ? 'buffer' : 'wild';
      out.crossed = crossed;
      out.safe = safe;
      return out;
    },
  };
}

/** Positions [[x, z, side], …] of the border beacons along the hub square (corners once). */
export function borderPosts(half = HUB_HALF, spacing = POST_SPACING) {
  const out = [];
  const n = Math.max(1, Math.round((half * 2) / spacing));
  const step = (half * 2) / n;
  // side 0: north edge (z = −half) west→east, 1: east (x = +half) north→south, 2: south east→west, 3: west south→north
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < n; k++) {
      const s = -half + k * step;
      if (side === 0) out.push([s, -half, side]);
      else if (side === 1) out.push([half, s, side]);
      else if (side === 2) out.push([-s, half, side]);
      else out.push([-half, -s, side]);
    }
  }
  return out;
}
