/**
 * Shared helpers for the systems module: player position, zone detection,
 * time of day, text templating and small formatting utilities.
 * Pure functions + a few reusable scratch vectors (no per-frame allocation).
 */
import * as THREE from 'three';
import { ZONES } from '../../world/layout.js';
import { formatNumber, formatDistance } from '../../core/math.js';

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

/** Dutch part of day: 'ochtend' | 'middag' | 'avond' | 'nacht'. */
export function partOfDay(ctx) {
  const h = hourOf(ctx);
  if (h >= 5.2 && h < 12) return 'ochtend';
  if (h >= 12 && h < 17) return 'middag';
  if (h >= 17 && h < 21.5) return 'avond';
  return 'nacht';
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

/** Dutch locative per zone ("op het Nexus-plein", "in de ruimtehaven"). */
const ZONE_AT = {
  spawn: 'op het uitzichtpunt',
  lookout: 'bij de uitkijkpost',
  ruins: 'bij de oude ruïnes',
  signal: 'bij het signaal',
  waterfall: 'bij de waterval',
  base: 'bij je basis',
  plaza: 'op het Nexus-plein',
  spaceport: 'in de ruimtehaven',
  city: 'in Aurora-stad',
};
export function zoneAtText(id) {
  return ZONE_AT[id] || (ZONES[id] ? `bij ${ZONES[id].label}` : '');
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

/** Reward summary like "+500 XP · +300 Ø-credits · +20 metaal". */
export function rewardText(r = {}) {
  const parts = [];
  if (r.xp) parts.push(`+${fmt(r.xp)} XP`);
  if (r.credits) parts.push(`+${fmt(r.credits)} Ø-credits`);
  const names = { metal: 'metaal', stone: 'steen', wood: 'hout', energy: 'energie' };
  for (const [k, v] of Object.entries(r.resources || {})) if (v) parts.push(`+${fmt(v)} ${names[k] || k}`);
  if (r.items?.length) parts.push(`${r.items.length === 1 ? '1 item' : `${r.items.length} items`}`);
  return parts.join(' · ');
}

export const RESOURCE_LABELS = { metal: 'Metaal', stone: 'Steen', wood: 'Hout', energy: 'Energie' };

/** Fires `fn` once after `ms`, unless cancelled; returns cancel(). */
export function later(ms, fn) {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}
