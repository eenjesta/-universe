/**
 * Weapon definitions (SMP v1, PLATFORM.md §8) — shared by the server sim and the
 * client (src/combat reads these). Pure data. Names are bilingual {en, nl}.
 *
 *   slot        weapon slot 0..3 (keys 1–4); C.EQUIP {slot}
 *   kind        'hitscan' (FIRE + HIT claims) | 'throw' (THROW → server projectile)
 *   dmg         damage per hit (shield first, then health)
 *   rate        shots per second (server enforces with a small burst tolerance)
 *   auto        hold-to-fire (client feel only)
 *   charge      seconds of charge before the shot leaves (client side; server rate covers it)
 *   mag         magazine size; reserve = max reserve ammo carried of `ammo`
 *   ammo        ammo type id (shared/defs/items.js AMMO)
 *   range       max hit distance (m); falloff = damage multiplier at max range (linear from falloffStart)
 *   spread      hip-fire cone half-angle (degrees); spreadAim when aiming (right mouse)
 *   reload      seconds
 *   crit        damage multiplier on weak spots (stalker head)
 *   fx          client-side look (colour, tracer speed m/s)
 * Throwables: radius (AoE, linear falloff to 35 % at the edge), stun (s), fuse (s),
 *   throwSpeed (max launch speed m/s; with PROJECTILES.grenade.gravity 18 m/s² ≈ 25 m at 45°),
 *   carry (max count),
 *   item (inventory item consumed).
 */

export const WEAPONS = {
  'pulse-pistol': {
    id: 'pulse-pistol',
    slot: 0,
    kind: 'hitscan',
    name: { en: 'Pulse pistol', nl: 'Pulspistool' },
    desc: { en: 'Reliable sidearm. Every traveller starts with one.', nl: 'Betrouwbaar handwapen. Elke reiziger begint ermee.' },
    dmg: 14,
    rate: 4,
    auto: false,
    mag: 12,
    reserve: 60,
    ammo: 'pulse',
    range: 60,
    falloffStart: 35,
    falloff: 0.6,
    spread: 1.0,
    spreadAim: 0.35,
    reload: 1.3,
    crit: 1.5,
    start: true,
    fx: { color: '#7fe0ff', tracer: 220, icon: 'wpn-pistol' },
  },
  'plasma-rifle': {
    id: 'plasma-rifle',
    slot: 1,
    kind: 'hitscan',
    name: { en: 'Plasma rifle', nl: 'Plasmageweer' },
    desc: { en: 'Automatic rifle. Crafted at a workbench (tier 1).', nl: 'Automatisch geweer. Te maken aan een werkbank (niveau 1).' },
    dmg: 9,
    rate: 9,
    auto: true,
    mag: 24,
    reserve: 120,
    ammo: 'plasma',
    range: 90,
    falloffStart: 50,
    falloff: 0.65,
    spread: 1.2,
    spreadAim: 0.4,
    reload: 1.9,
    crit: 1.4,
    fx: { color: '#b98bff', tracer: 160, icon: 'wpn-rifle' },
  },
  railgun: {
    id: 'railgun',
    slot: 2,
    kind: 'hitscan',
    name: { en: 'Railgun', nl: 'Railgun' },
    desc: { en: 'Charged long-range shot. Workbench tier 2 or rare loot.', nl: 'Opgeladen schot op lange afstand. Werkbank niveau 2 of zeldzame buit.' },
    dmg: 75,
    rate: 0.8,
    charge: 0.4,
    auto: false,
    mag: 4,
    reserve: 16,
    ammo: 'rail',
    range: 250,
    falloffStart: 250,
    falloff: 1,
    spread: 0.15,
    spreadAim: 0.05,
    reload: 2.4,
    crit: 1.5,
    fx: { color: '#ffd27f', tracer: 900, icon: 'wpn-rail' },
  },
  'shock-grenade': {
    id: 'shock-grenade',
    slot: 3,
    kind: 'throw',
    name: { en: 'Shock grenade', nl: 'Schokgranaat' },
    desc: { en: 'Throw it: 60 damage within 6 m and a 1.5 s stun.', nl: 'Gooi hem: 60 schade binnen 6 m en 1,5 s verdoving.' },
    dmg: 60,
    radius: 6,
    edge: 0.35,
    stun: 1.5,
    fuse: 1.8,
    throwSpeed: 21,
    range: 25,
    rate: 1.0,
    carry: 3,
    item: 'shock-grenade',
    fx: { color: '#7fe0ff', icon: 'wpn-grenade' },
  },
};

/** Weapon id per slot (keys 1–4). */
export const WEAPON_SLOTS = ['pulse-pistol', 'plasma-rifle', 'railgun', 'shock-grenade'];

export const weaponOf = (id) => WEAPONS[id] || null;

/** Projectile kinds in snapshots (px rows: [id, type, x, y, z]). */
export const PROJECTILES = { grenade: { id: 'grenade', radius: 0.12, bounce: 0.38, friction: 0.7, gravity: 18 } };
