/**
 * Static shell content: the poster's four pillars, the gameplay-overview
 * cards, "Core gameplay elements", the controls reference (ARCHITECTURE §9),
 * key hints and zone/region icons. Player-facing text is bilingual
 * ({ en, nl }) and resolved with t()/pick() where it is displayed.
 */
import { ZONES, REGIONS } from '../world/layout.js';

export const VERSION = 'v0.1 — A Brighter Tomorrow';

export const TAGLINE = {
  en: 'An endless, living world where technology, creativity and people come together.',
  nl: 'Een eindeloze, levende wereld waar technologie, creativiteit en mensen samenkomen.',
};
/** The tagline as the two lines of the title screen (poster layout). */
export const TAGLINE_LINES = {
  en: ['An endless, living world where technology,', 'creativity and people come together.'],
  nl: ['Een eindeloze, levende wereld waar technologie,', 'creativiteit en mensen samenkomen.'],
};
export const MOTTO = 'Explore · Create · Connect';
export const BRIGHTER = 'A Brighter Tomorrow.';

/** Right-hand pillar panel of the poster (crop_features.png); titles are English in both languages. */
export const PILLARS = [
  { icon: 'globe', title: 'One World', text: { en: 'Experience one seamless world across every platform.', nl: 'Beleef één naadloze wereld op alle platforms.' } },
  { icon: 'infinity', title: 'Infinite Possibilities', text: { en: 'Discover, build, create and choose your own path.', nl: 'Ontdek, bouw, creëer en bepaal je eigen pad.' } },
  { icon: 'people', title: 'Built by People', text: { en: 'A world shaped by players and creators.', nl: 'Een wereld gevormd door spelers en creators.' } },
  { icon: 'chip', title: 'Powered by AI', text: { en: 'Lifelike NPCs, dynamic events and unique stories.', nl: 'Levendige NPC’s, dynamische evenementen en unieke verhalen.' } },
];

/** "Gameplay overview" cards (crop_overview.png). `thumb` = thumbnail preset id. */
export const CARDS = [
  {
    id: 'explore', n: 1, thumb: 'spawn',
    title: { en: 'Explore', nl: 'Verken' },
    text: { en: 'Discover unique landscapes, cities, planets and secrets.', nl: 'Ontdek unieke omgevingen, steden, planeten en geheimen.' },
    cta: { en: 'Start at the Overlook', nl: 'Start bij het Uitzichtpunt' },
  },
  {
    id: 'build', n: 2, thumb: 'base',
    title: { en: 'Build', nl: 'Bouw' },
    text: { en: 'Create bases, cities and entire worlds.', nl: 'Creëer bases, steden en complete werelden.' },
    cta: { en: 'Build your base', nl: 'Bouw je basis' },
  },
  {
    id: 'meet', n: 3, thumb: 'plaza',
    title: { en: 'Meet', nl: 'Ontmoet' },
    text: { en: 'Team up, build communities and share stories with others.', nl: 'Werk samen, vorm communities en beleef verhalen met anderen.' },
    cta: { en: 'Go to Nexus Plaza', nl: 'Naar het Nexus-plein' },
  },
  {
    id: 'more', n: 4, thumb: 'space',
    title: { en: 'Discover more', nl: 'Ontdek meer' },
    text: { en: 'Travel between planets, take on missions and explore the unknown.', nl: 'Reis tussen planeten, neem deel aan missies en ontdek het onbekende.' },
    cta: { en: 'Fly into space', nl: 'Vlieg de ruimte in' },
  },
];

/** "Core gameplay elements" (crop_kern.png): left column first, then right. */
export const KERN = [
  { icon: 'globe', title: { en: 'Open world', nl: 'Open wereld' }, text: { en: 'Seamless worlds and planets', nl: 'Naadloze werelden en planeten' } },
  { icon: 'cube', title: { en: 'Build & create', nl: 'Bouwen & creëren' }, text: { en: 'From small bases to entire cities', nl: 'Van kleine bases tot complete steden' } },
  { icon: 'people', title: { en: 'Social experience', nl: 'Sociale ervaring' }, text: { en: 'Play together and build communities', nl: 'Samen spelen en communities vormen' } },
  { icon: 'swords', title: { en: 'Missions & stories', nl: 'Missies & verhalen' }, text: { en: 'Dynamic quests and live events', nl: 'Dynamische quests en live events' } },
  { icon: 'creative', title: { en: 'Creative mode', nl: 'Creative mode' }, text: { en: 'Unlimited building and designing', nl: 'Onbeperkt bouwen en ontwerpen' } },
  { icon: 'cart', title: { en: 'Marketplace', nl: 'Marketplace' }, text: { en: 'Buy, sell and share content', nl: 'Koop, verkoop en deel content' } },
  { icon: 'palette', title: { en: 'Customisation', nl: 'Customisatie' }, text: { en: 'Characters, vehicles, items and more', nl: 'Personages, voertuigen, items en meer' } },
  { icon: 'chip', title: { en: 'AI integration', nl: 'AI-integratie' }, text: { en: 'Living NPCs and a dynamic world', nl: 'Levende NPC’s en dynamische wereld' } },
];

/** The Space key cap in the active language (the token in `k` strings). */
const SPACE = { en: 'Space', nl: 'Spatie' };

/**
 * Controls reference. `k` is a token string (or { en, nl } of token strings):
 * plain tokens are key caps, '/', '–', 'or' and 'of' are separators, '@mouse'
 * '@scroll' '@click' '@right' are mouse glyphs. `t` = label, `d` = detail
 * line. `modes` = game modes in which the group is most relevant.
 */
export const CONTROLS = [
  {
    id: 'foot', title: { en: 'On foot', nl: 'Te voet' }, icon: 'user', modes: ['explore'],
    rows: [
      { k: 'W A S D', t: { en: 'Walk', nl: 'Lopen' } },
      { k: '↑ ← ↓ →', t: { en: 'Walk with the arrow keys', nl: 'Lopen met de pijltjes' } },
      { k: 'Shift', t: { en: 'Sprint', nl: 'Sprinten' } },
      { k: SPACE, t: { en: 'Jump', nl: 'Springen' } },
      { k: '@mouse', t: { en: 'Look around', nl: 'Rondkijken' }, d: { en: 'Click to capture the mouse, Esc to release it', nl: 'Klik om de muis te vangen, Esc om los te laten' } },
      { k: '@scroll', t: { en: 'Zoom', nl: 'Zoomen' } },
      { k: 'E', t: { en: 'Interact', nl: 'Interactie' }, d: { en: 'Hold to scan or harvest', nl: 'Houd vast om te scannen of te oogsten' } },
      { k: 'F', t: { en: 'Enter / exit vehicle', nl: 'Voertuig in/uit' } },
      { k: 'G', t: { en: 'Garage', nl: 'Garage' } },
      { k: 'B', t: { en: 'Build mode', nl: 'Bouwmodus' } },
      { k: 'Enter / T', t: { en: 'Chat', nl: 'Chat' } },
      { k: 'J', t: { en: 'Missions', nl: 'Missies' } },
      { k: 'M', t: { en: 'Map', nl: 'Kaart' } },
      { k: 'C', t: { en: 'Character', nl: 'Karakter' } },
      { k: 'K', t: { en: 'Marketplace', nl: 'Marktplaats' } },
      { k: 'H', t: { en: 'Help', nl: 'Help' } },
      { k: 'Esc / P', t: { en: 'Pause', nl: 'Pauze' } },
    ],
  },
  {
    id: 'build', title: { en: 'Building', nl: 'Bouwen' }, icon: 'cube', modes: ['explore'],
    rows: [
      { k: '1 – 6', t: { en: 'Category', nl: 'Categorie' } },
      { k: '@scroll / Tab', t: { en: 'Choose a piece', nl: 'Onderdeel kiezen' } },
      { k: 'R', t: { en: 'Rotate', nl: 'Draaien' } },
      { k: '@click', t: { en: 'Place', nl: 'Plaatsen' } },
      { k: 'X / @right', t: { en: 'Remove', nl: 'Verwijderen' } },
      { k: 'B / Esc', t: { en: 'Stop building', nl: 'Stoppen' } },
    ],
  },
  {
    id: 'car', title: { en: 'Car', nl: 'Auto' }, icon: 'car', modes: ['drive'],
    rows: [
      { k: 'W / S', t: { en: 'Throttle / brake', nl: 'Gas / rem' } },
      { k: 'A / D', t: { en: 'Steer', nl: 'Sturen' } },
      { k: SPACE, t: { en: 'Handbrake', nl: 'Handrem' } },
      { k: 'Shift', t: { en: 'Boost', nl: 'Boost' } },
      { k: 'F', t: { en: 'Get out', nl: 'Uitstappen' } },
    ],
  },
  {
    id: 'air', title: { en: 'VTOL & ship', nl: 'VTOL & schip' }, icon: 'plane', modes: ['drive'],
    rows: [
      { k: 'W / S', t: { en: 'Forward / back', nl: 'Vooruit / achteruit' } },
      { k: 'A / D', t: { en: 'Strafe', nl: 'Zijwaarts' } },
      { k: '@mouse', t: { en: 'Heading', nl: 'Richting' } },
      { k: SPACE, t: { en: 'Climb', nl: 'Stijgen' } },
      { k: 'C', t: { en: 'Descend', nl: 'Dalen' } },
      { k: 'Shift', t: { en: 'Boost', nl: 'Boost' } },
      { k: 'L', t: { en: 'Launch into space', nl: 'Lanceren naar de ruimte' }, d: { en: 'Spaceship only', nl: 'Alleen met het ruimteschip' } },
    ],
  },
  {
    id: 'space', title: { en: 'Space', nl: 'Ruimte' }, icon: 'rocket', modes: ['space'],
    rows: [
      { k: '@mouse', t: { en: 'Steer', nl: 'Sturen' } },
      { k: 'W / S', t: { en: 'Thrust', nl: 'Stuwkracht' } },
      { k: { en: 'A / D or Q / E', nl: 'A / D of Q / E' }, t: { en: 'Roll', nl: 'Rollen' } },
      { k: 'Shift', t: { en: 'Boost', nl: 'Boost' } },
      { k: { en: '@click / Space', nl: '@click / Spatie' }, t: { en: 'Fire', nl: 'Vuren' } },
      { k: 'E', t: { en: 'Scan / dock', nl: 'Scannen / aanmeren' } },
      { k: 'L', t: { en: 'Land', nl: 'Landen' } },
    ],
  },
];

/** Bottom-right key hints while exploring on foot. */
export const KEY_HINTS = [
  { k: 'B', t: { en: 'Build', nl: 'Bouwen' } },
  { k: 'F', t: { en: 'Vehicle', nl: 'Voertuig' } },
  { k: 'G', t: { en: 'Garage', nl: 'Garage' } },
  { k: 'J', t: { en: 'Missions', nl: 'Missies' } },
  { k: 'M', t: { en: 'Map', nl: 'Kaart' } },
  { k: 'H', t: { en: 'Help', nl: 'Help' } },
];

/** Map / label icon per zone or region id (19_world_map.png). */
export const PLACE_ICONS = {
  spawn: 'shell-mountain',
  lookout: 'shell-binoculars',
  ruins: 'shell-columns',
  signal: 'shell-antenna',
  waterfall: 'shell-waves',
  base: 'cube',
  plaza: 'people',
  spaceport: 'shell-plane',
  city: 'shell-city',
  jungle: 'shell-leaf',
  canyon: 'shell-canyon',
};

/** Legend order of the world map (19_world_map.png), regions last. */
export const MAP_PLACES = ['base', 'city', 'plaza', 'spaceport', 'spawn', 'lookout', 'waterfall', 'ruins', 'signal', 'jungle', 'canyon'];

/** Zones that are always available for fast travel (you start there / it is yours). */
export const ALWAYS_KNOWN = ['spawn', 'base'];

/** Zone or region definition by id (layout.js; `label` / `desc` are in the active language). */
export function place(id) {
  return ZONES[id] || REGIONS[id] || null;
}

/** Places considered for the "you are here" label, smallest radius wins (id + shape only). */
export const LABEL_PLACES = (() => {
  const out = [];
  for (const z of Object.values(ZONES)) {
    if (z.id === 'spaceport') {
      const r = z.rect;
      out.push({ id: z.id, rect: { minX: r.minX - 25, maxX: r.maxX + 25, minZ: r.minZ - 25, maxZ: r.maxZ + 25 }, size: 120 });
    } else {
      // generous enter radius (zones flatten ~radius; the scenery extends further)
      const radius = z.id === 'city' ? z.radius : Math.max(z.radius * 1.9, 45);
      out.push({ id: z.id, x: z.x, z: z.z, radius, size: radius });
    }
  }
  for (const r of Object.values(REGIONS)) out.push({ id: r.id, x: r.x, z: r.z, radius: r.radius, size: r.radius + 1000 });
  return out.sort((a, b) => a.size - b.size);
})();
