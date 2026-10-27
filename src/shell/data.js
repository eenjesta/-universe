/**
 * Static shell content (all player-facing text is Dutch): the poster's four
 * pillars, the gameplay-overview cards, "Kern gameplay elementen", the
 * controls reference (ARCHITECTURE §9), key hints and zone/region icons.
 */
import { ZONES, REGIONS } from '../world/layout.js';

export const VERSION = 'v0.1 — A Brighter Tomorrow';

export const TAGLINE = 'Een eindeloze, levende wereld waar technologie, creativiteit en mensen samenkomen.';
export const MOTTO = 'Explore · Create · Connect';
export const BRIGHTER = 'A Brighter Tomorrow.';

/** Right-hand pillar panel of the poster (crop_features.png). */
export const PILLARS = [
  { icon: 'globe', title: 'One World', text: 'Beleef één naadloze wereld op alle platforms.' },
  { icon: 'infinity', title: 'Infinite Possibilities', text: 'Ontdek, bouw, creëer en bepaal je eigen pad.' },
  { icon: 'people', title: 'Built by People', text: 'Een wereld gevormd door spelers en creators.' },
  { icon: 'chip', title: 'Powered by AI', text: 'Levendige NPC’s, dynamische evenementen en unieke verhalen.' },
];

/** "Gameplay overview" cards (crop_overview.png). `thumb` = thumbnail preset id. */
export const CARDS = [
  { id: 'explore', n: 1, title: 'Verken', text: 'Ontdek unieke omgevingen, steden, planeten en geheimen.', thumb: 'spawn', cta: 'Start bij het Uitzichtpunt' },
  { id: 'build', n: 2, title: 'Bouw', text: 'Creëer bases, steden en complete werelden.', thumb: 'base', cta: 'Bouw je basis' },
  { id: 'meet', n: 3, title: 'Ontmoet', text: 'Werk samen, vorm communities en beleef verhalen met anderen.', thumb: 'plaza', cta: 'Naar het Nexus-plein' },
  { id: 'more', n: 4, title: 'Ontdek meer', text: 'Reis tussen planeten, neem deel aan missies en ontdek het onbekende.', thumb: 'space', cta: 'Vlieg de ruimte in' },
];

/** "Kern gameplay elementen" (crop_kern.png): left column first, then right. */
export const KERN = [
  { icon: 'globe', title: 'Open wereld', text: 'Naadloze werelden en planeten' },
  { icon: 'cube', title: 'Bouwen & creëren', text: 'Van kleine bases tot complete steden' },
  { icon: 'people', title: 'Sociale ervaring', text: 'Samen spelen en communities vormen' },
  { icon: 'swords', title: 'Missies & verhalen', text: 'Dynamische quests en live events' },
  { icon: 'creative', title: 'Creative mode', text: 'Onbeperkt bouwen en ontwerpen' },
  { icon: 'cart', title: 'Marketplace', text: 'Koop, verkoop en deel content' },
  { icon: 'palette', title: 'Customisatie', text: 'Personages, voertuigen, items en meer' },
  { icon: 'chip', title: 'AI-integratie', text: 'Levende NPC’s en dynamische wereld' },
];

/**
 * Controls reference. `k` is a token string: plain tokens are key caps,
 * '/', '–' and 'of' are separators, '@muis' '@scroll' '@klik' '@rechts' are
 * mouse glyphs. `modes` = game modes in which the group is most relevant.
 */
export const CONTROLS = [
  {
    id: 'foot', title: 'Te voet', icon: 'user', modes: ['explore'],
    rows: [
      { k: 'W A S D', t: 'Lopen' },
      { k: '↑ ← ↓ →', t: 'Lopen met de pijltjes' },
      { k: 'Shift', t: 'Sprinten' },
      { k: 'Spatie', t: 'Springen' },
      { k: '@muis', t: 'Rondkijken', d: 'Klik om de muis te vangen, Esc om los te laten' },
      { k: '@scroll', t: 'Zoomen' },
      { k: 'E', t: 'Interactie', d: 'Houd vast om te scannen of te oogsten' },
      { k: 'F', t: 'Voertuig in/uit' },
      { k: 'G', t: 'Garage' },
      { k: 'B', t: 'Bouwmodus' },
      { k: 'Enter / T', t: 'Chat' },
      { k: 'J', t: 'Missies' },
      { k: 'M', t: 'Kaart' },
      { k: 'C', t: 'Karakter' },
      { k: 'K', t: 'Marktplaats' },
      { k: 'H', t: 'Help' },
      { k: 'Esc / P', t: 'Pauze' },
    ],
  },
  {
    id: 'build', title: 'Bouwen', icon: 'cube', modes: ['explore'],
    rows: [
      { k: '1 – 6', t: 'Categorie' },
      { k: '@scroll / Tab', t: 'Onderdeel kiezen' },
      { k: 'R', t: 'Draaien' },
      { k: '@klik', t: 'Plaatsen' },
      { k: 'X / @rechts', t: 'Verwijderen' },
      { k: 'B / Esc', t: 'Stoppen' },
    ],
  },
  {
    id: 'car', title: 'Auto', icon: 'car', modes: ['drive'],
    rows: [
      { k: 'W / S', t: 'Gas / rem' },
      { k: 'A / D', t: 'Sturen' },
      { k: 'Spatie', t: 'Handrem' },
      { k: 'Shift', t: 'Boost' },
      { k: 'F', t: 'Uitstappen' },
    ],
  },
  {
    id: 'air', title: 'VTOL & schip', icon: 'plane', modes: ['drive'],
    rows: [
      { k: 'W / S', t: 'Vooruit / achteruit' },
      { k: 'A / D', t: 'Zijwaarts' },
      { k: '@muis', t: 'Richting' },
      { k: 'Spatie', t: 'Stijgen' },
      { k: 'C', t: 'Dalen' },
      { k: 'Shift', t: 'Boost' },
      { k: 'L', t: 'Lanceren naar de ruimte', d: 'Alleen met het ruimteschip' },
    ],
  },
  {
    id: 'space', title: 'Ruimte', icon: 'rocket', modes: ['space'],
    rows: [
      { k: '@muis', t: 'Sturen' },
      { k: 'W / S', t: 'Stuwkracht' },
      { k: 'A / D of Q / E', t: 'Rollen' },
      { k: 'Shift', t: 'Boost' },
      { k: '@klik / Spatie', t: 'Vuren' },
      { k: 'E', t: 'Scannen / aanmeren' },
      { k: 'L', t: 'Landen' },
    ],
  },
];

/** Bottom-right key hints while exploring on foot. */
export const KEY_HINTS = [
  { k: 'B', t: 'Bouwen' },
  { k: 'F', t: 'Voertuig' },
  { k: 'G', t: 'Garage' },
  { k: 'J', t: 'Missies' },
  { k: 'M', t: 'Kaart' },
  { k: 'H', t: 'Help' },
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

/** Zone or region definition by id (layout.js). */
export function place(id) {
  return ZONES[id] || REGIONS[id] || null;
}

/** Places considered for the "you are here" label, smallest radius wins. */
export const LABEL_PLACES = (() => {
  const out = [];
  for (const z of Object.values(ZONES)) {
    if (z.id === 'spaceport') {
      const r = z.rect;
      out.push({ id: z.id, label: z.label, rect: { minX: r.minX - 25, maxX: r.maxX + 25, minZ: r.minZ - 25, maxZ: r.maxZ + 25 }, size: 120 });
    } else {
      // generous enter radius (zones flatten ~radius; the scenery extends further)
      const radius = z.id === 'city' ? z.radius : Math.max(z.radius * 1.9, 45);
      out.push({ id: z.id, label: z.label, x: z.x, z: z.z, radius, size: radius });
    }
  }
  for (const r of Object.values(REGIONS)) out.push({ id: r.id, label: r.label, x: r.x, z: r.z, radius: r.radius, size: r.radius + 1000 });
  return out.sort((a, b) => a.size - b.size);
})();
