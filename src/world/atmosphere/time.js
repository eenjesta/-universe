import * as THREE from 'three';
import { DEG, smoothstep, clamp } from '../../core/math.js';

/**
 * Time-of-day model: hour → sun path, day/night factors and the fixed
 * positions of the giant planet and its two moons.
 *
 * Sun path (alien planet, tuned for the poster): rises ≈06:00 in the SSW,
 * culminates at 62° in the ESE at noon and sets ≈18:00 in the NNE — so at
 * the default golden hour (17.6) it hangs ~5° above the horizon right of the
 * spire city as seen from the spawn ridge facing north. The path sweeps the
 * eastern sky and never crosses the giant planet or the moons (NNW–N).
 *
 * Directions use world axes: +X east, −Z north, +Y up. Azimuth is measured
 * from north toward east.
 */

export const SUN_MAX_SIN = Math.sin(62 * DEG);
export const SUN_NOON_AZIMUTH = 103 * DEG;

export const DEFAULT_HOUR = 17.6;
/** 1 game hour = 2 real minutes. */
export const HOURS_PER_SECOND = 1 / 120;

/** Giant planet + moons (fixed in the sky: the world is tidally locked to the planet). */
export const BODIES = {
  // the giant planet hangs over Aurora-stad, its lower limb sinking into the
  // horizon haze; the moons sit between it and the setting sun (crop_hero)
  planet: { az: 0 * DEG, el: 17 * DEG, radius: 12.5 * DEG, tilt: -24 * DEG, axisLean: 11 * DEG },
  moonA: { az: 17 * DEG, el: 15.5 * DEG, radius: 1.6 * DEG },
  moonB: { az: 13 * DEG, el: 10 * DEG, radius: 0.72 * DEG },
};

/** Celestial pole the stars rotate around (40° above the northern horizon). */
export const STAR_POLE = new THREE.Vector3(0, Math.sin(40 * DEG), -Math.cos(40 * DEG)).normalize();

export function wrapHour(h) {
  h = Number(h);
  if (!Number.isFinite(h)) return DEFAULT_HOUR;
  return ((h % 24) + 24) % 24;
}

export function dirFromAzEl(az, el, out = new THREE.Vector3()) {
  const c = Math.cos(el);
  return out.set(Math.sin(az) * c, Math.sin(el), -Math.cos(az) * c);
}

/** Sun elevation/azimuth (radians) for an hour; writes into `out` ({el, az}). */
export function sunAngles(hour, out = { el: 0, az: 0 }) {
  const w = ((hour - 12) / 24) * Math.PI * 2;
  out.el = Math.asin(SUN_MAX_SIN * Math.cos(w));
  out.az = SUN_NOON_AZIMUTH - (hour - 12) * 15 * DEG;
  return out;
}

/**
 * Scalar factors derived from the sun height (sin of elevation):
 *  day   — 0 at night … 1 in full daylight (the `world.dayFactor` contract;
 *          ≈0.43 at the 17.6 golden hour so city lights are already glowing)
 *  night — 0 by day … 1 when the sun is well below the horizon
 *  twilight — peaks around sunset/sunrise (warm, hazy light)
 */
export function factors(sinEl, out = {}) {
  out.day = smoothstep(-0.12, 0.35, sinEl);
  out.night = 1 - smoothstep(-0.22, -0.02, sinEl);
  out.twilight = clamp(1 - Math.abs(sinEl - 0.03) / 0.22, 0, 1);
  return out;
}

/** Light direction for shading a body near the sun "photographically" (fatter crescents). */
export function bodyLightDir(sunDir, bodyDir, k, out) {
  return out.copy(sunDir).addScaledVector(bodyDir, -k).normalize();
}
