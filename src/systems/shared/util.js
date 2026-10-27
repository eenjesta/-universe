/**
 * Shared helpers for the systems module: player position, zone detection,
 * time of day, text templating and small formatting utilities.
 * Pure functions + a few reusable scratch vectors (no per-frame allocation).
 */
import * as THREE from 'three';
import { ZONES } from '../../world/layout.js';
import { formatNumber, formatDistance } from '../../core/math.js';
import { t } from '../../core/i18n.js';

export const fmt = formatNumber;
export const fmtDist = formatDistance;

// ----------------------------------------------------------------- time
export const NIGHT_START = 19.6;
export const NIGHT_END = 5.2;

/** Current hour of day (0–24) from the world, falling back to the saved state. */
export function hourOf(ctx) {
  const h = ctx.world?.timeOfDay ?? ctx.state.get('world.time');
  return typeof h === 'number' && isFinite(h) ? ((h % 24) + 24) % 24 : 17.6;
}

export function isNight(ctx) {
  const h = hourOf(ctx);
  return h >= NIGHT_START || h < NIGHT_END;
}

/** Part of day id: 'morning' | 'afternoon' | 'evening' | 'night' (stable, language-neutral). */
export function partOfDay(ctx) {
  const h = hourOf(ctx);
  if (h >= 5.2 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21.5) return 'evening';
  return 'night';
}

const PART_OF_DAY = {
  morning: { en: 'morning', nl: 'ochtend' },
  afternoon: { en: 'afternoon', nl: 'middag' },
  evening: { en: 'evening', nl: 'avond' },
  night: { en: 'night', nl: 'nacht' },
};
/** The part of day as a word in the active language ("evening" / "avond") for {daypart} templates. */
export function partOfDayText(ctx, id = partOfDay(ctx)) {
  return t(PART_OF_DAY[id] || PART_OF_DAY.evening);
}

// ------------------------------------------------------------- position
const _pos = new THREE.Vector3();

/**
 * World position of the player (or of the vehicle they drive). Returns `out`
 * (or a shared scratch vector) — or null when not in the open world.
 */
export function playerPos(ctx, out = _pos) {
  if (!ctx.modes?.is('explore', 'drive')) return null;
  const veh = ctx.vehicles?.current;
  if (ctx.modes.is('drive') && veh?.object?.position) return out.copy(veh.object.position);
  const p = ctx.player?.position || ctx.player?.object?.position;
  return p ? out.copy(p) : null;
}

export function groundY(ctx, x, z) {
  try {
    const y = ctx.world?.getHeightAt?.(x, z);
    return typeof y === 'number' && isFinite(y) ? y : 0;
  } catch {
    return 0;
  }
}

/** Heading (rotation.y) that faces from (fx, fz) toward (tx, tz). */
export function headingTo(fx, fz, tx, tz) {
  return Math.atan2(-(tx - fx), -(tz - fz));
}

// ---------------------------------------------------------------- zones
/** Discovery / presence radius per zone (larger than the flattened pad). */
export function zoneRadius(zone) {
  if (!zone) return 0;
  if (zone.id === 'city') return zone.radius;
  return Math.max(zone.radius + 12, 26);
}

/** Smallest zone that contains (x, z), or null. */
export function zoneAt(x, z) {
  const sp = ZONES.spaceport.rect;
  if (x >= sp.minX - 8 && x <= sp.maxX + 8 && z >= sp.minZ - 8 && z <= sp.maxZ + 8) return 'spaceport';
  let best = null;
  let bestR = Infinity;
  for (const zn of Object.values(ZONES)) {
    if (!zn.radius) continue;
    const r = zoneRadius(zn);
    if (r >= bestR) continue;
    if (Math.hypot(x - zn.x, z - zn.z) <= r) {
      best = zn.id;
      bestR = r;
    }
  }
  return best;
}

export function zoneLabel(id) {
  return ZONES[id]?.label || id || '';
}

/** Locative per zone ("at Nexus Plaza" / "op het Nexus-plein"). */
const ZONE_AT = {
  spawn: { en: 'at the Overlook', nl: 'op het uitzichtpunt' },
  lookout: { en: 'at the Lookout', nl: 'bij de uitkijkpost' },
  ruins: { en: 'at the Ancient Ruins', nl: 'bij de oude ruïnes' },
  signal: { en: 'at the Signal', nl: 'bij het signaal' },
  waterfall: { en: 'at the Waterfall', nl: 'bij de waterval' },
  base: { en: 'at your base', nl: 'bij je basis' },
  plaza: { en: 'at Nexus Plaza', nl: 'op het Nexus-plein' },
  spaceport: { en: 'at the Spaceport', nl: 'in de ruimtehaven' },
  city: { en: 'in Aurora City', nl: 'in Aurora-stad' },
};
export function zoneAtText(id) {
  if (ZONE_AT[id]) return t(ZONE_AT[id]);
  return ZONES[id] ? t({ en: 'at {zone}', nl: 'bij {zone}' }, { zone: ZONES[id].label }) : '';
}

/** Ground-level position of a zone centre (new Vector3 unless `out` given). */
export function zonePoint(ctx, id, out = new THREE.Vector3(), lift = 0) {
  const z = ZONES[id];
  if (!z) return null;
  return out.set(z.x, groundY(ctx, z.x, z.z) + lift, z.z);
}

// ----------------------------------------------------------------- text
/** Replaces {key} placeholders with values from `vars` (functions are called). */
export function fill(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    if (v == null) return m;
    return typeof v === 'function' ? v() : v;
  });
}

export function pick(arr, rnd = Math.random) {
  return arr[Math.floor(rnd() * arr.length)];
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** "3:07" style mm:ss. */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Resource names, capitalised (labels) and lower case (inside a sentence: "+20 metal"). */
const RESOURCES = {
  metal: { en: 'Metal', nl: 'Metaal' },
  stone: { en: 'Stone', nl: 'Steen' },
  wood: { en: 'Wood', nl: 'Hout' },
  energy: { en: 'Energy', nl: 'Energie' },
};
/** "Metal" / "Metaal" in the active language. */
export const resourceLabel = (k) => (RESOURCES[k] ? t(RESOURCES[k]) : k);
/** "metal" / "metaal" (lower case, for running text). */
export const resourceWord = (k) => resourceLabel(k).toLowerCase();

/** Reward summary like "+500 XP · +300 Ø-credits · +20 metal". */
export function rewardText(r = {}) {
  const parts = [];
  if (r.xp) parts.push(`+${fmt(r.xp)} XP`);
  if (r.credits) parts.push(`+${fmt(r.credits)} Ø-credits`);
  for (const [k, v] of Object.entries(r.resources || {})) if (v) parts.push(`+${fmt(v)} ${resourceWord(k)}`);
  if (r.items?.length) parts.push(r.items.length === 1 ? t({ en: '1 item', nl: '1 item' }) : t({ en: '{n} items', nl: '{n} items' }, { n: r.items.length }));
  return parts.join(' · ');
}

/** Fires `fn` once after `ms`, unless cancelled; returns cancel(). */
export function later(ms, fn) {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}
