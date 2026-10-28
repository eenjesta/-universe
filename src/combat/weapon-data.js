/**
 * Combat data (pure, no DOM / three): weapon + enemy numbers, the hub safe zone (§11) and the
 * v1 sim's static safe zones.
 *
 * The sim engineer owns the real tables (shared/defs/*.js). This file holds a
 * local copy of PLATFORM.md §8 and normalises whatever shape shared/defs uses
 * into the one combat reads, so the client keeps working while shared/defs is
 * missing or incomplete:
 *
 *   normalizeWeapons(raw) → { list: [def…] (by slot), byId: {id: def}, bySlot: [def…] }
 *   def = { id, slot, name:{en,nl}, short:{en,nl}, kind: 'hitscan'|'charge'|'throw',
 *           dmg, rate, auto, mag, reserve, range, spread, spreadAim, charge, reload, ammo,
 *           radius, stun, carry, throwSpeed, fuse, gravity, bounce, color, boltSpeed }
 */
import { HUB as WORLD_HUB } from '../../shared/defs/world.js';
import { ENEMIES as SHARED_ENEMIES } from '../../shared/defs/enemies.js';

/** PLATFORM.md §8 (+ client-only feel values: reload times, colours, bolt speeds). */
export const FALLBACK_WEAPONS = [
  {
    id: 'pulse-pistol',
    slot: 0,
    name: { en: 'Pulse pistol', nl: 'Pulspistool' },
    short: { en: 'Pistol', nl: 'Pistool' },
    kind: 'hitscan',
    dmg: 14,
    rate: 4,
    auto: false,
    mag: 12,
    reserve: 60,
    range: 60,
    spread: 0.9,
    spreadAim: 0.3,
    reload: 1.1,
    ammo: 'pulse',
  },
  {
    id: 'plasma-rifle',
    slot: 1,
    name: { en: 'Plasma rifle', nl: 'Plasmageweer' },
    short: { en: 'Rifle', nl: 'Geweer' },
    kind: 'hitscan',
    dmg: 9,
    rate: 9,
    auto: true,
    mag: 24,
    reserve: 120,
    range: 90,
    spread: 1.2,
    spreadAim: 0.4,
    reload: 1.6,
    ammo: 'plasma',
  },
  {
    id: 'railgun',
    slot: 2,
    name: { en: 'Railgun', nl: 'Railgun' },
    short: { en: 'Railgun', nl: 'Railgun' },
    kind: 'charge',
    dmg: 75,
    rate: 0.8,
    auto: false,
    charge: 0.4,
    mag: 4,
    reserve: 16,
    range: 250,
    spread: 0.25,
    spreadAim: 0,
    reload: 2.2,
    ammo: 'rail',
  },
  {
    id: 'shock-grenade',
    slot: 3,
    name: { en: 'Shock grenade', nl: 'Schokgranaat' },
    short: { en: 'Grenade', nl: 'Granaat' },
    kind: 'throw',
    dmg: 60,
    radius: 6,
    stun: 1.5,
    carry: 3,
    range: 25,
    rate: 1.2,
    mag: 1,
    reserve: 3,
    throwSpeed: 17,
    fuse: 1.6,
    gravity: 18,
    bounce: 0.35,
    ammo: 'shock-grenade',
  },
];

/** Client look per weapon (energy colours are linear HDR multipliers of these). */
export const WEAPON_LOOK = {
  'pulse-pistol': { color: [0.35, 0.72, 1.0], boltSpeed: 190, boltLen: 3.0, boltWidth: 0.085, flash: 0.55, kick: 0.012, shake: 0.06 },
  'plasma-rifle': { color: [0.32, 0.62, 1.0], boltSpeed: 230, boltLen: 3.9, boltWidth: 0.09, flash: 0.6, kick: 0.007, shake: 0.045 },
  railgun: { color: [0.55, 0.85, 1.0], boltSpeed: 0, boltLen: 0, boltWidth: 0.11, flash: 1.1, kick: 0.05, shake: 0.32 },
  'shock-grenade': { color: [0.35, 0.8, 1.0], boltSpeed: 0, boltLen: 0, boltWidth: 0, flash: 0, kick: 0, shake: 0.5 },
};

/**
 * Enemy numbers (PLATFORM §8) + client hit volumes [dx forward, dy, r] relative to the snapshot position.
 * The sim validates against a drone sphere (r 0.85 at the body centre) and a vertical stalker capsule
 * (r 0.7, feet → 1.6 m, crit above 72 % of the height): the volumes stay inside its tolerance.
 */
export const ENEMIES = {
  drone: {
    type: 'drone',
    name: { en: 'Security drone', nl: 'Beveiligingsdrone' },
    hp: 60,
    // the drone's snapshot position is the body centre
    volumes: [[0, 0, 0.85]],
    marker: 0.95, // health bar height above the position
  },
  stalker: {
    type: 'stalker',
    name: { en: 'Jungle stalker', nl: 'Junglesluiper' },
    hp: 90,
    // snapshot position = feet; body + head (head ≈ 1.3 m ahead of the centre)
    volumes: [
      [0, 0.95, 0.74],
      [1.08, 1.28, 0.42],
      [-0.78, 0.88, 0.5],
    ],
    marker: 2.05,
  },
  raider: {
    type: 'raider',
    name: SHARED_ENEMIES.raider?.name || { en: 'Pirate raider', nl: 'Piratenraider' },
    hp: SHARED_ENEMIES.raider?.hp || 110,
    // snapshot position = feet; legs / chest / head (the sim: capsule r 0.5, h 1.95, crit above 80 %)
    volumes: [
      [0, 0.55, 0.42],
      [0, 1.15, 0.48],
      [0, 1.72, 0.27],
    ],
    crouchVolumes: [
      [0, 0.45, 0.45],
      [0, 0.92, 0.46],
      [0.05, 1.3, 0.27],
    ],
    marker: 2.25,
  },
  mite: {
    type: 'mite',
    name: SHARED_ENEMIES.mite?.name || { en: 'Crystal mite', nl: 'Kristalmijt' },
    hp: SHARED_ENEMIES.mite?.hp || 26,
    volumes: [[0, 0.45, 0.6]],
    marker: 1.05,
  },
  warden: {
    type: 'warden',
    name: SHARED_ENEMIES.warden?.name || { en: 'De Wachter', nl: 'De Wachter' },
    hp: SHARED_ENEMIES.warden?.hp || 4200,
    boss: true,
    volumes: [], // WARDEN_PARTS (shared) via the warden visual
    marker: 21,
  },
  barrier: {
    type: 'barrier',
    name: SHARED_ENEMIES.barrier?.name || { en: 'Barrier', nl: 'Barrière' },
    hp: SHARED_ENEMIES.barrier?.hp || 140,
    prop: true,
    volumes: [],
    marker: 1.7,
  },
};

/**
 * PLATFORM.md §11: the hand-made hub in the middle of the planet is ONE protected safe zone
 * (no combat, weapons holstered) — the square |x|, |z| ≤ HUB.half (shared/defs/world.js).
 * Stand-in for the world provider's isSafe (shared/worldgen / ctx.net.providers) until one exists.
 */
export const HUB = { x: 0, z: 0, half: WORLD_HUB?.half ?? 1100, radius: WORLD_HUB?.half ?? 1100 };

/** True inside the hub square (|x|, |z| ≤ half around the hub centre). */
export function inHub(x, z, hub = HUB) {
  const h = hub.half ?? hub.radius;
  return Math.abs(x - (hub.x || 0)) <= h && Math.abs(z - (hub.z || 0)) <= h;
}

/** Distance outside the hub square (0 inside) — like shared/defs/world.js hubDist. */
export function hubDistance(x, z, hub = HUB) {
  const d = Math.max(Math.abs(x - (hub.x || 0)), Math.abs(z - (hub.z || 0))) - (hub.half ?? hub.radius);
  return d > 0 ? d : 0;
}

/** Static safe zones of the v1 sim (PLATFORM §1, all inside the hub): circles {x, z, r} and rects. */
export const SAFE_ZONES = [
  { id: 'plaza', x: 360, z: -150, r: 82 },
  { id: 'spawn', x: 0, z: 150, r: 40 },
  { id: 'spaceport', minX: 380, maxX: 565, minZ: 175, maxZ: 330 },
];

/** True when (x, z) lies in one of the zones. */
export function inSafeZone(x, z, zones = SAFE_ZONES) {
  for (const s of zones) {
    if (s.r != null) {
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz <= s.r * s.r) return true;
    } else if (s.minX != null && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return true;
  }
  return false;
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const text = (v, d) => {
  if (v && typeof v === 'object' && typeof v.en === 'string') return { en: v.en, nl: typeof v.nl === 'string' ? v.nl : v.en };
  if (typeof v === 'string' && v) return { en: v, nl: v };
  return d;
};

/** Finds a weapon table inside a module namespace / object / array. */
export function pickWeaponTable(mod) {
  if (!mod) return null;
  const cands = [mod.WEAPONS, mod.weapons, mod.default?.WEAPONS, mod.default];
  for (const c of cands) {
    if (Array.isArray(c) && c.length) return c;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const vals = Object.entries(c)
        .filter(([, v]) => v && typeof v === 'object' && (v.dmg != null || v.damage != null || v.id || v.name))
        .map(([k, v]) => ({ id: v.id || k, ...v }));
      if (vals.length) return vals;
    }
  }
  return null;
}

/**
 * Merges a shared/defs weapon table over the fallback (per id), fills missing
 * fields and indexes the result. Unknown extra weapons keep their own slot.
 */
export function normalizeWeapons(raw) {
  const table = Array.isArray(raw) ? raw : pickWeaponTable(raw) || [];
  const byId = {};
  for (const f of FALLBACK_WEAPONS) byId[f.id] = { ...f };
  for (const w of table) {
    if (!w) continue;
    const id = String(w.id || '').trim();
    if (!id) continue;
    const base = byId[id] || { ...FALLBACK_WEAPONS[0], id, slot: Object.keys(byId).length, name: { en: id, nl: id }, short: { en: id, nl: id } };
    const d = { ...base };
    d.name = text(w.name, base.name);
    d.short = text(w.short, d.name === base.name ? base.short : d.name);
    d.slot = Number.isInteger(w.slot) ? w.slot : base.slot;
    d.dmg = num(w.dmg ?? w.damage, base.dmg);
    d.rate = num(w.rate ?? w.fireRate, base.rate);
    d.auto = typeof w.auto === 'boolean' ? w.auto : w.mode === 'auto' ? true : base.auto;
    d.mag = num(w.mag ?? w.magazine, base.mag);
    d.reserve = num(w.reserve ?? w.maxReserve ?? w.carry, base.reserve);
    d.range = num(w.range, base.range);
    d.spread = num(w.spread ?? w.spreadHip, base.spread);
    d.spreadAim = num(w.spreadAim ?? w.spreadAimed, base.spreadAim);
    d.charge = num(w.charge ?? w.chargeTime, base.charge || 0);
    d.reload = num(w.reload ?? w.reloadTime, base.reload);
    d.ammo = typeof w.ammo === 'string' && w.ammo ? w.ammo : base.ammo;
    d.radius = num(w.radius, base.radius);
    d.stun = num(w.stun, base.stun);
    d.carry = num(w.carry, base.carry);
    d.throwSpeed = num(w.throwSpeed, base.throwSpeed);
    d.fuse = num(w.fuse, base.fuse);
    d.gravity = num(w.gravity, base.gravity);
    d.bounce = num(w.bounce, base.bounce);
    const kind = w.kind || w.type;
    if (kind === 'throw' || kind === 'grenade' || id.includes('grenade')) d.kind = 'throw';
    else if (d.charge > 0) d.kind = 'charge';
    else d.kind = 'hitscan';
    byId[id] = d;
  }
  for (const d of Object.values(byId)) {
    const look = WEAPON_LOOK[d.id] || WEAPON_LOOK['plasma-rifle'];
    d.color = look.color;
    d.boltSpeed = look.boltSpeed;
    d.boltLen = look.boltLen;
    d.boltWidth = look.boltWidth;
    d.flash = look.flash;
    d.kick = look.kick;
    d.shake = look.shake;
    if (d.kind === 'throw') d.carry = d.carry || d.reserve || 3;
  }
  const list = Object.values(byId).sort((a, b) => a.slot - b.slot);
  const bySlot = [];
  for (const d of list) if (bySlot[d.slot] == null) bySlot[d.slot] = d;
  return { list, byId, bySlot };
}
