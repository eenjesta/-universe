/**
 * Marketplace catalog. Item ids follow ARCHITECTURE §7 (other modules check
 * state.owned.items for them: characters → outfits, build → decor/power,
 * vehicles → skins) plus consumable resource packs.
 * name / cat / desc are bilingual ({ en, nl }) in the data; on the exported
 * items they are getters returning the active language (it.name is a string),
 * and `it.text` keeps both languages (chat matches item names in either).
 */
import { t } from '../../core/i18n.js';

const CATALOG = [
  {
    id: 'skin-car-sunset',
    name: { en: 'Sunset Paint', nl: 'Sunset-lak' },
    kind: 'skin',
    cat: { en: 'Vehicle Skin', nl: 'Voertuigskin' },
    target: 'car',
    price: 750,
    thumb: 'car',
    palette: ['#ffb067', '#ff5f7e', '#2a1222'],
    glow: '#ff9a4a',
    desc: { en: 'An orange-pink gradient for your sports car. Shines like golden hour.', nl: 'Oranje-roze verloop voor je sportauto. Glanst als het gouden uur.' },
  },
  {
    id: 'skin-car-aurora',
    name: { en: 'Aurora Paint', nl: 'Aurora-lak' },
    kind: 'skin',
    cat: { en: 'Vehicle Skin', nl: 'Voertuigskin' },
    target: 'car',
    price: 900,
    thumb: 'car',
    palette: ['#66ffd1', '#8a6bff', '#101a2c'],
    glow: '#7fe0ff',
    desc: { en: 'Green-violet northern lights that seem to ripple across the bodywork.', nl: 'Groen-violet noorderlicht dat over de carrosserie lijkt te bewegen.' },
  },
  {
    id: 'skin-ship-gold',
    name: { en: 'Golden Hull', nl: 'Gouden romp' },
    kind: 'skin',
    cat: { en: 'Vehicle Skin', nl: 'Voertuigskin' },
    target: 'ship',
    price: 1500,
    thumb: 'ship',
    palette: ['#ffe2a0', '#c99a3d', '#3a2a10'],
    glow: '#f0b46a',
    desc: { en: 'Polished gold for your spaceship. You\'ll get noticed on Station Halo.', nl: 'Gepolijst goud voor je ruimteschip. Je wordt gezien op Station Halo.' },
  },
  {
    id: 'power-fusion',
    name: { en: 'Fusion Reactor', nl: 'Fusiereactor' },
    kind: 'blueprint',
    cat: { en: 'Blueprint', nl: 'Bouwblauwdruk' },
    price: 1200,
    thumb: 'reactor',
    glow: '#7fe0ff',
    desc: { en: 'A compact fusion reactor: delivers far more energy than solar panels.', nl: 'Compacte fusiereactor: levert veel meer energie dan zonnepanelen.' },
  },
  {
    id: 'decor-neon-tree',
    name: { en: 'Neon Tree', nl: 'Neonboom' },
    kind: 'blueprint',
    cat: { en: 'Blueprint', nl: 'Bouwblauwdruk' },
    price: 800,
    thumb: 'tree',
    glow: '#b48cff',
    desc: { en: 'A small Tree of Life for your base that glows violet at night.', nl: 'Een kleine Levensboom voor je basis die ’s nachts violet oplicht.' },
  },
  {
    id: 'decor-statue',
    name: { en: 'Ø Statue', nl: 'Ø-standbeeld' },
    kind: 'blueprint',
    cat: { en: 'Blueprint', nl: 'Bouwblauwdruk' },
    price: 600,
    thumb: 'statue',
    glow: '#7fe0ff',
    desc: { en: 'A stone monument bearing the Ø symbol, with a soft cyan glow.', nl: 'Een stenen monument met het Ø-symbool, met een zachte cyaan gloed.' },
  },
  {
    id: 'outfit-nomad',
    name: { en: 'Nomad Poncho', nl: 'Nomade-poncho' },
    kind: 'outfit',
    cat: { en: 'Outfit', nl: 'Outfit' },
    outfit: 'nomad',
    price: 950,
    thumb: 'outfit',
    style: 'nomad',
    palette: ['#6b6a45', '#a08a5a'],
    glow: '#f0b46a',
    desc: { en: 'An olive-brown hooded poncho for long treks through the wilderness.', nl: 'Olijfbruine capuchon-poncho voor lange tochten door de wildernis.' },
  },
  {
    id: 'outfit-vanguard',
    name: { en: 'Vanguard Armor', nl: 'Vanguard-pantser' },
    kind: 'outfit',
    cat: { en: 'Outfit', nl: 'Outfit' },
    outfit: 'vanguard',
    price: 1400,
    thumb: 'outfit',
    style: 'vanguard',
    palette: ['#232831', '#7fe0ff'],
    glow: '#7fe0ff',
    desc: { en: 'A dark armored suit with glowing cyan seams.', nl: 'Donker gepantserd pak met oplichtende cyaan naden.' },
  },
  {
    id: 'outfit-drifter',
    name: { en: 'Drifter Coat', nl: 'Drifter-jas' },
    kind: 'outfit',
    cat: { en: 'Outfit', nl: 'Outfit' },
    outfit: 'drifter',
    price: 1100,
    thumb: 'outfit',
    style: 'drifter',
    palette: ['#2a2d35', '#d8cdb8'],
    glow: '#d8cdb8',
    desc: { en: 'A long dark coat with a high collar. For those who like to travel unnoticed.', nl: 'Lange donkere jas met hoge kraag. Voor wie graag onopvallend reist.' },
  },
  {
    id: 'res-metal-100',
    name: { en: 'Metal Container', nl: 'Metaalcontainer' },
    kind: 'consumable',
    cat: { en: 'Resources', nl: 'Grondstoffen' },
    price: 250,
    thumb: 'crate',
    color: '#8d99a6',
    label: '100',
    give: { metal: 100 },
    desc: { en: '100 metal, straight into your inventory.', nl: '100 metaal, direct in je voorraad.' },
  },
  {
    id: 'res-energy-50',
    name: { en: 'Energy Cell', nl: 'Energiecel' },
    kind: 'consumable',
    cat: { en: 'Resources', nl: 'Grondstoffen' },
    price: 200,
    thumb: 'cell',
    label: '+50',
    give: { energy: 50 },
    desc: { en: '50 energy for your base and your vehicles.', nl: '50 energie voor je basis en je voertuigen.' },
  },
  {
    id: 'res-wood-100',
    name: { en: 'Wood Bundle', nl: 'Houtbundel' },
    kind: 'consumable',
    cat: { en: 'Resources', nl: 'Grondstoffen' },
    price: 150,
    thumb: 'crate',
    color: '#8a6142',
    glow: '#f0b46a',
    label: '100',
    give: { wood: 100 },
    desc: { en: '100 wood, sawn and ready to build with.', nl: '100 hout, gezaagd en klaar om mee te bouwen.' },
  },
  {
    id: 'res-stone-100',
    name: { en: 'Stone Blocks', nl: 'Steenblokken' },
    kind: 'consumable',
    cat: { en: 'Resources', nl: 'Grondstoffen' },
    price: 120,
    thumb: 'crate',
    color: '#8a8780',
    glow: '#d8cdb8',
    label: '100',
    give: { stone: 100 },
    desc: { en: '100 stone for foundations and walls.', nl: '100 steen voor funderingen en muren.' },
  },
];

const LOCALIZED = ['name', 'cat', 'desc'];
export const ITEMS = CATALOG.map((raw) => {
  const it = { ...raw, text: {} };
  for (const k of LOCALIZED) {
    it.text[k] = raw[k];
    Object.defineProperty(it, k, { get: () => t(it.text[k]), enumerable: true });
  }
  return it;
});

export const ITEM = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

/** Ø-credits paid per unit when selling resources. */
export const SELL_PRICES = { metal: 2, stone: 1, wood: 1.5, energy: 3 };

/** Marketplace filter chips (label: resolve with t()). */
export const FILTERS = [
  { id: 'all', label: { en: 'All', nl: 'Alles' } },
  { id: 'skin', label: { en: 'Vehicle Skins', nl: 'Voertuigskins' } },
  { id: 'blueprint', label: { en: 'Blueprints', nl: 'Bouwblauwdrukken' } },
  { id: 'outfit', label: { en: 'Outfits', nl: 'Outfits' } },
  { id: 'consumable', label: { en: 'Resources', nl: 'Grondstoffen' } },
  { id: 'fav', label: { en: '♥ Favorites', nl: '♥ Favorieten' } },
];
