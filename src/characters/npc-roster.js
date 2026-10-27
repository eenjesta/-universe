/**
 * NPC roster (characters module): named characters with their looks, homes and
 * lines, plus generators for crowd / technicians / builders. Lines are
 * bilingual ({ en: [...], nl: [...] }); npcs.js resolves them with pick().
 */
import { ZONES } from '../world/layout.js';
import { normalizeAppearance, randomAppearance } from './appearance.js';
import { Rng } from '../core/math.js';

export const NAMED = [
  {
    id: 'luna', name: 'Luna_Ø', area: 'plaza', group: 'a', lod: 1,
    app: { body: 'f', skin: '#d9a47c', hair: 'ponytail', hairColor: '#2a1d15', face: 5, outfit: 'scout', outfitColor: '#d8cdb8', accentColor: '#15171b', backpack: 'pack', gloves: true, eyeColor: '#6b4a2a' },
    lines: {
      en: ['Shall we try the new mission?', 'What a light show!', 'Have you scanned the ruins yet?'],
      nl: ['Zullen we de nieuwe missie proberen?', 'Wat een lichtshow!', 'Heb je de ruïnes al gescand?'],
    },
  },
  {
    id: 'kai', name: 'Kai', area: 'plaza', group: 'a', lod: 1,
    app: { body: 'm', skin: '#c68e67', hair: 'short', hairColor: '#1a1412', face: 0, outfit: 'pathfinder', outfitColor: '#1c1f25', accentColor: '#d8d2c6', backpack: 'tech', beard: 'stubble' },
    lines: {
      en: ["Yes, I'm in!", 'Come to the stage!', 'My base is almost finished.'],
      nl: ['Ja, ik ben erbij!', 'Kom naar het podium!', 'Mijn basis is bijna klaar.'],
    },
  },
  {
    id: 'nova', name: 'Nova', area: 'plaza', group: 'a', lod: 1,
    app: { body: 'f', skin: '#f2c9a8', hair: 'short', hairColor: '#e8e4dc', face: 1, outfit: 'pathfinder', outfitColor: '#15171b', accentColor: '#ff8a3d', backpack: 'pack', eyeColor: '#3c5f7d' },
    lines: {
      en: ['This place is beautiful.', 'This is amazing!', 'See those ships above the city?'],
      nl: ['Deze plek is prachtig.', 'Dit is geweldig!', 'Zie je die schepen boven de stad?'],
    },
  },
  {
    id: 'yara', name: 'Yara', area: 'plaza', group: 'b', lod: 1,
    app: { body: 'f', skin: '#9c6b4b', hair: 'curly', hairColor: '#1a1412', face: 2, outfit: 'scout', outfitColor: '#d8cdb8', accentColor: '#c64a3e', backpack: 'tech', gloves: true },
    lines: {
      en: ['Have you seen the Starfall Festival yet?', 'The Tree of Life is glowing extra bright tonight.', "I'm heading to the night market soon."],
      nl: ['Heb je het Starfall Festival al gezien?', 'De Levensboom gloeit vanavond extra mooi.', 'Ik ga zo naar de nachtmarkt.'],
    },
  },
  {
    id: 'milan', name: 'Milan', area: 'plaza', group: 'b', lod: 1,
    app: { body: 'm', skin: '#6e4630', hair: 'buzz', hairColor: '#1a1412', face: 3, beard: 'stubble', outfit: 'drifter', outfitColor: '#15171b', accentColor: '#c64a3e', backpack: 'none' },
    lines: {
      en: ['Come to the stage!', 'I know a faster route to the spaceport.', "Let's go!"],
      nl: ['Kom naar het podium!', 'Ik ken een snellere route naar de ruimtehaven.', 'Laten we gaan!'],
    },
  },
  {
    id: 'aria', name: 'Aria', area: 'signal', lod: 1,
    app: { body: 'f', skin: '#d9a47c', hair: 'ponytail', hairColor: '#1a1412', face: 5, outfit: 'pathfinder', outfitColor: '#1c1f25', accentColor: '#d8d2c6', backpack: 'pack', eyeColor: '#4a3020' },
    lines: {
      en: ['This place has a history that runs deeper than we think.', 'Do you feel the signal too?', 'The beacon is responding to you.'],
      nl: ['Deze plek heeft een geschiedenis die verder gaat dan wat we denken.', 'Voel je het signaal ook?', 'Het baken reageert op jou.'],
    },
  },
  {
    id: 'oran', name: 'Oran', area: 'plaza', lod: 1, post: 'oran',
    app: { body: 'm', skin: '#c68e67', hair: 'short', hairColor: '#cfcac2', face: 4, beard: 'full', outfit: 'robe', outfitColor: '#5a3424', accentColor: '#c9a25a', headwear: 'headband', age: 0.9, backpack: 'none', patch: false, eyeColor: '#5d6670', height: 0.97 },
    lines: {
      en: ["I've heard rumors of a lost ship in the Northern Rings…", 'Feel free to look around, traveler.', 'Rare goods, fair prices.'],
      nl: ['Ik heb geruchten gehoord over een verloren schip in de Noordelijke Ringen…', 'Kijk gerust rond, reiziger.', 'Zeldzame waren, eerlijke prijzen.'],
    },
  },
  {
    id: 'jules', name: 'Jules', area: 'spaceport', lod: 1,
    app: { body: 'm', skin: '#9c6b4b', hair: 'short', hairColor: '#2a1d15', face: 2, outfit: 'tech', outfitColor: '#3a3f47', accentColor: '#ff9a4a', headwear: 'headset', backpack: 'none', prop: 'tablet', gloves: true },
    lines: {
      en: ['Your ship is ready. All systems green.', "Don't forget your pre-flight check.", 'Pad three is clear for departure.'],
      nl: ['Je schip staat klaar. Alle systemen groen.', 'Vergeet je startcontrole niet.', 'Platform drie is vrij voor vertrek.'],
    },
  },
];

export const CROWD_LINES = {
  en: [
    'What a light show!', 'Come to the stage!', 'This is amazing!', 'See those ships?', "Let's go!",
    'Beautiful evening.', 'Have you seen the waterfall yet?', "I'm building a house by the forest.",
  ],
  nl: [
    'Wat een lichtshow!', 'Kom naar het podium!', 'Dit is geweldig!', 'Zie je die schepen?', 'Laten we gaan!',
    'Prachtige avond.', 'Heb je de waterval al gezien?', 'Ik bouw een huis bij het bos.',
  ],
};

/** Deterministic crowd appearances (poster look: mostly dark techwear, some light suits). */
export function crowdAppearances(count, seed = 'plaza-crowd') {
  const rng = new Rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const outfits = rng.chance(0.62) ? ['pathfinder'] : rng.pick([['scout'], ['ranger'], ['drifter'], ['vanguard'], ['nomad'], ['pathfinder']]);
    const a = randomAppearance({ rng, outfits, palette: 'crowd' });
    if (rng.chance(0.15)) a.headwear = rng.pick(['cap', 'hood']);
    if (a.headwear === 'hood' && a.outfit !== 'nomad' && a.outfit !== 'pathfinder') a.headwear = 'none';
    out.push(normalizeAppearance(a));
  }
  return out;
}

export function technicianAppearances(count, seed = 'techs') {
  const rng = new Rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = randomAppearance({ rng, outfits: ['tech'] });
    a.outfitColor = rng.pick(['#3a3f47', '#2d3138', '#454a52']);
    a.accentColor = rng.pick(['#ff9a4a', '#f0b46a', '#ff8a3d']);
    a.headwear = rng.pick(['cap', 'headset', 'headset']);
    a.backpack = 'none';
    a.prop = i === 0 ? 'tablet' : 'none';
    a.gloves = true;
    a.patch = false;
    out.push(normalizeAppearance(a));
  }
  return out;
}

export function builderAppearances(seed = 'builders') {
  const rng = new Rng(seed);
  return [0, 1].map((i) => {
    const a = randomAppearance({ rng, outfits: [i ? 'ranger' : 'scout'], body: i ? 'm' : 'f' });
    a.prop = 'tablet';
    a.headwear = i ? 'cap' : 'none';
    a.backpack = 'tech';
    return normalizeAppearance(a);
  });
}

/** Spots (x, z, heading) for fixed-post NPCs when landmarks provide nothing better. */
export function postSpots(ctx) {
  const sp = ZONES.spaceport;
  const pads = sp.pads;
  const base = ZONES.base;
  const ba = base.buildArea;
  const lm = ctx.landmarks || {};
  const sig = lm.beacon?.position || { x: ZONES.signal.x, z: ZONES.signal.z };
  const front = lm.beacon?.front || { x: sig.x + 4.2, z: sig.z + 5.2 };
  // Aria faces the path the player arrives on (south of the obelisk)
  const ax = front.x;
  const az = front.z;
  const arrive = { x: sig.x + 2, z: sig.z + 15 };
  const ariaHeading = Math.atan2(-(arrive.x - ax), -(arrive.z - az));
  const counter = lm.plaza?.bazaar?.oranCounter;
  const oran = counter ? { x: counter.x + 0.85, z: counter.z } : { x: ZONES.plaza.oran.x + 1.2, z: ZONES.plaza.oran.z };
  return {
    aria: { x: ax, z: az, heading: ariaHeading },
    oran: { x: oran.x, z: oran.z, heading: Math.PI / 2 },
    jules: { x: pads.ship.x + 9, z: pads.ship.z + 11, heading: 0.9 },
    techs: [
      { x: pads.ship.x - 6, z: pads.ship.z + 7, heading: -0.6, act: 'tablet' },
      { x: pads.vtol.x + 6, z: pads.vtol.z + 7, heading: 2.3, act: 'talk' },
      { x: pads.vtol.x + 7.6, z: pads.vtol.z + 5.4, heading: -0.9, act: 'talk' },
    ],
    builders: [
      { x: ba.x - ba.size / 2 - 2.5, z: ba.z - 6, heading: -Math.PI / 2, act: 'tablet' },
      { x: ba.x + 4, z: ba.z + ba.size / 2 + 2.5, heading: 0, act: 'tablet' },
    ],
  };
}
