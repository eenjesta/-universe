/**
 * Appearance catalog + helpers (characters module).
 *
 * An appearance is a plain JSON object (saved in state.profile.appearance):
 *   { body: 'm'|'f', skin, hair, hairColor, face (0–5), beard: 'none'|'stubble'|'full',
 *     outfit, outfitColor, accentColor, glasses,
 *     // optional extras (characters module; safe to omit):
 *     eyewear: 'none'|'glasses'|'shades'|'visor', backpack: 'none'|'pack'|'tech',
 *     gloves: bool, patch: bool, eyeColor, headwear: 'none'|'cap'|'headband'|'headset'|'hood',
 *     prop: 'none'|'tablet', height (0.9–1.08), build (0.85–1.2), age (0–1) }
 * normalizeAppearance() fills every field so builders never null-check.
 */
import { DEFAULT_APPEARANCE } from '../core/state.js';
import { Rng } from '../core/math.js';
import { t } from '../core/i18n.js';

export const SKIN_TONES = ['#f2c9a8', '#d9a47c', '#c68e67', '#9c6b4b', '#6e4630', '#8d9098', '#9db59a'];
export const OUTFIT_COLORS = ['#15171b', '#5d6066', '#d8cdb8', '#4f5634', '#7a5238', '#1f2a44', '#4a2f73', '#7a2a2a'];
export const HAIR_COLORS = ['#1a1412', '#2a1d15', '#4a3122', '#6b4a2f', '#a8743f', '#d9c08a', '#e8e4dc', '#8a8d93', '#5b3a7a'];
export const ACCENT_COLORS = ['#d8d2c6', '#7fe0ff', '#f0b46a', '#ff8a3d', '#c64a3e', '#b48cff', '#8fe3a8', '#15171b'];
export const EYE_COLORS = ['#4a3020', '#6b4a2a', '#3d5a3a', '#3c5f7d', '#5d6670', '#2a1c14'];

/**
 * Catalog texts are bilingual ({en, nl} in `text`); `label` / `desc` are getters
 * that return the active language (core/i18n.js), so `item.label` stays a string
 * for every consumer (creator, ctx.characters.catalog).
 */
function localise(list) {
  for (const item of list) {
    for (const key of Object.keys(item.text || {})) {
      Object.defineProperty(item, key, { get: () => t(item.text[key]), enumerable: true });
    }
  }
  return list;
}

/** Hair styles shown in the creator. */
export const HAIR_STYLES = localise([
  { id: 'swept', text: { label: { en: 'Swept', nl: 'Geveegd' } } },
  { id: 'short', text: { label: { en: 'Short', nl: 'Kort' } } },
  { id: 'buzz', text: { label: { en: 'Buzz Cut', nl: 'Gemillimeterd' } } },
  { id: 'curly', text: { label: { en: 'Curly', nl: 'Krullen' } } },
  { id: 'long', text: { label: { en: 'Long', nl: 'Lang' } } },
  { id: 'ponytail', text: { label: { en: 'Ponytail', nl: 'Paardenstaart' } } },
  { id: 'bun', text: { label: { en: 'Bun', nl: 'Knot' } } },
  { id: 'none', text: { label: { en: 'Bald', nl: 'Kaal' } } },
]);

export const FACES = localise([
  { id: 0, text: { label: { en: 'Classic', nl: 'Klassiek' } } },
  { id: 1, text: { label: { en: 'Angular', nl: 'Hoekig' } } },
  { id: 2, text: { label: { en: 'Soft', nl: 'Zacht' } } },
  { id: 3, text: { label: { en: 'Strong', nl: 'Krachtig' } } },
  { id: 4, text: { label: { en: 'Narrow', nl: 'Smal' } } },
  { id: 5, text: { label: { en: 'Delicate', nl: 'Fijn' } } },
]);

export const BEARDS = localise([
  { id: 'none', text: { label: { en: 'None', nl: 'Geen' } } },
  { id: 'stubble', text: { label: { en: 'Stubble', nl: 'Stoppels' } } },
  { id: 'full', text: { label: { en: 'Full Beard', nl: 'Baard' } } },
]);

/**
 * Outfits. `player: true` ones appear in the creator; `unlock` is the market
 * item id that must be in state.owned.items; `price` is only a hint (the
 * economy module owns real prices).
 */
export const OUTFITS = localise([
  { id: 'pathfinder', text: { label: 'Pathfinder', desc: { en: 'Hooded techwear jacket with Ø backpack', nl: 'Techwear jas met capuchon en Ø-rugzak' } }, color: '#1c1f25', accent: '#d8d2c6', player: true },
  { id: 'scout', text: { label: 'Scout', desc: { en: 'Light utility suit with harness', nl: 'Licht utility-pak met harnas' } }, color: '#d8cdb8', accent: '#15171b', player: true },
  { id: 'ranger', text: { label: 'Ranger', desc: { en: 'Brown field jacket full of pockets', nl: 'Bruine veldjas vol zakken' } }, color: '#7a5238', accent: '#d8d2c6', player: true },
  { id: 'nomad', text: { label: { en: 'Nomad', nl: 'Nomade' }, desc: { en: 'Olive-brown hooded poncho', nl: 'Olijfbruine poncho met kap' } }, color: '#4f5634', accent: '#d8d2c6', player: true, unlock: 'outfit-nomad', price: 450 },
  { id: 'vanguard', text: { label: 'Vanguard', desc: { en: 'Armored suit with cyan seams', nl: 'Gepantserd pak met cyaan naden' } }, color: '#1f2a44', accent: '#7fe0ff', player: true, unlock: 'outfit-vanguard', price: 900 },
  { id: 'drifter', text: { label: 'Drifter', desc: { en: 'Long dark coat', nl: 'Lange donkere jas' } }, color: '#15171b', accent: '#d8d2c6', player: true, unlock: 'outfit-drifter', price: 650 },
  // NPC-only outfits
  { id: 'robe', text: { label: { en: 'Robe', nl: 'Gewaad' } }, color: '#5a3424', accent: '#c9a25a' },
  { id: 'tech', text: { label: { en: 'Technician', nl: 'Technicus' } }, color: '#3a3f47', accent: '#ff9a4a' },
]);
export const OUTFIT_MAP = Object.fromEntries(OUTFITS.map((o) => [o.id, o]));
export const PLAYER_OUTFITS = OUTFITS.filter((o) => o.player);

export const BACKPACKS = localise([
  { id: 'tech', text: { label: { en: 'Ø Backpack', nl: 'Ø-rugzak' } } },
  { id: 'pack', text: { label: { en: 'Compact', nl: 'Compact' } } },
  { id: 'none', text: { label: { en: 'None', nl: 'Geen' } } },
]);
export const EYEWEAR = localise([
  { id: 'none', text: { label: { en: 'None', nl: 'Geen' } } },
  { id: 'glasses', text: { label: { en: 'Glasses', nl: 'Bril' } } },
  { id: 'shades', text: { label: { en: 'Shades', nl: 'Zonnebril' } } },
  { id: 'visor', text: { label: { en: 'Visor', nl: 'Vizier' } } },
]);

const HAIR_IDS = new Set(HAIR_STYLES.map((h) => h.id));
const pickIn = (v, list, def) => (list.includes(v) ? v : def);
const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const num = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Returns a complete, validated copy of an appearance (never mutates the input). */
export function normalizeAppearance(app = {}) {
  const a = { ...DEFAULT_APPEARANCE, ...(app || {}) };
  const out = {
    body: a.body === 'f' ? 'f' : 'm',
    skin: isColor(a.skin) ? a.skin : DEFAULT_APPEARANCE.skin,
    hair: HAIR_IDS.has(a.hair) ? a.hair : DEFAULT_APPEARANCE.hair,
    hairColor: isColor(a.hairColor) ? a.hairColor : DEFAULT_APPEARANCE.hairColor,
    face: Math.round(num(a.face, 0, 0, 5)),
    beard: pickIn(a.beard, ['none', 'stubble', 'full'], 'none'),
    outfit: OUTFIT_MAP[a.outfit] ? a.outfit : 'pathfinder',
    outfitColor: isColor(a.outfitColor) ? a.outfitColor : DEFAULT_APPEARANCE.outfitColor,
    accentColor: isColor(a.accentColor) ? a.accentColor : DEFAULT_APPEARANCE.accentColor,
    glasses: !!a.glasses,
    eyewear: pickIn(a.eyewear, ['none', 'glasses', 'shades', 'visor'], a.glasses ? 'shades' : 'none'),
    backpack: pickIn(a.backpack, ['none', 'pack', 'tech'], 'tech'),
    gloves: a.gloves == null ? false : !!a.gloves,
    patch: a.patch == null ? true : !!a.patch,
    eyeColor: isColor(a.eyeColor) ? a.eyeColor : '#4a3020',
    headwear: pickIn(a.headwear, ['none', 'cap', 'headband', 'headset', 'hood'], 'none'),
    prop: pickIn(a.prop, ['none', 'tablet'], 'none'),
    height: num(a.height, 1, 0.9, 1.08),
    build: num(a.build, 1, 0.85, 1.2),
    age: num(a.age, 0, 0, 1),
  };
  out.glasses = out.eyewear !== 'none';
  return out;
}

/** Stable cache key for an appearance (after normalisation). */
export function appearanceKey(app) {
  const a = normalizeAppearance(app);
  return [
    a.body, a.skin, a.hair, a.hairColor, a.face, a.beard, a.outfit, a.outfitColor, a.accentColor,
    a.eyewear, a.backpack, a.gloves ? 1 : 0, a.patch ? 1 : 0, a.eyeColor, a.headwear, a.prop,
    a.height.toFixed(3), a.build.toFixed(3), a.age.toFixed(2),
  ].join('|');
}

/** Is the outfit available to the player (owned or free)? */
export function outfitUnlocked(outfitId, ownedItems = []) {
  const o = OUTFIT_MAP[outfitId];
  if (!o || !o.player) return false;
  return !o.unlock || ownedItems.includes(o.unlock);
}

/**
 * Random appearance. `opts.outfits` limits the outfit pool (default: player
 * outfits); `opts.rng` is an Rng or seed; `opts.palette: 'crowd'` biases colours
 * toward the poster's dark techwear look.
 */
export function randomAppearance(opts = {}) {
  const rng = opts.rng instanceof Rng ? opts.rng : new Rng(opts.rng ?? Math.floor(Math.random() * 1e9));
  const body = opts.body || (rng.chance(0.5) ? 'm' : 'f');
  const outfitPool = opts.outfits || PLAYER_OUTFITS.map((o) => o.id);
  const outfit = rng.pick(outfitPool);
  const od = OUTFIT_MAP[outfit];
  const crowd = opts.palette === 'crowd';
  const hairPool = body === 'f'
    ? ['ponytail', 'long', 'bun', 'curly', 'short', 'swept', 'ponytail', 'long']
    : ['swept', 'short', 'buzz', 'curly', 'short', 'swept', 'none', 'long'];
  const hairColorPool = rng.chance(0.85) ? HAIR_COLORS.slice(0, 6) : HAIR_COLORS;
  let outfitColor = od.color;
  if (crowd) {
    // Mostly dark techwear, occasionally a light suit or a coloured jacket.
    const r = rng.random();
    outfitColor = r < 0.55 ? rng.pick(['#15171b', '#1c1f25', '#202329', '#26282d']) : r < 0.72 ? od.color : rng.pick(OUTFIT_COLORS);
  } else if (rng.chance(0.4)) outfitColor = rng.pick(OUTFIT_COLORS);
  return normalizeAppearance({
    body,
    skin: rng.pick(SKIN_TONES.slice(0, 5)),
    hair: rng.pick(hairPool),
    hairColor: rng.pick(hairColorPool),
    face: rng.int(0, 5),
    beard: body === 'm' ? rng.pick(['none', 'none', 'stubble', 'stubble', 'full']) : 'none',
    outfit,
    outfitColor,
    accentColor: crowd ? rng.pick(['#d8d2c6', '#d8d2c6', '#d8d2c6', '#7fe0ff', '#f0b46a', '#ff8a3d']) : rng.pick(ACCENT_COLORS.slice(0, 7)),
    eyewear: rng.chance(0.12) ? rng.pick(['glasses', 'shades', 'visor']) : 'none',
    backpack: rng.chance(0.7) ? 'tech' : rng.chance(0.5) ? 'pack' : 'none',
    gloves: rng.chance(0.35),
    patch: rng.chance(0.8),
    eyeColor: rng.pick(EYE_COLORS),
    height: body === 'f' ? rng.range(0.95, 1.04) : rng.range(0.96, 1.06),
    build: rng.range(0.92, 1.12),
  });
}
