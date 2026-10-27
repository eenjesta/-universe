/**
 * Ambient chat content: the poster conversation (crop_action_social.png),
 * plaza / festival / world chatter and party remarks per zone (Dutch).
 */
/** Poster conversation + ambient plaza / festival / world chatter. */
export const POSTER_TALK = [
  ['luna', 'Zullen we de nieuwe missie proberen?'],
  ['kai', 'Ja, ik ben erbij!'],
  ['nova', 'Deze plek is prachtig ✨'],
];

export const PLAZA_LINES = [
  ['luna', 'Wie gaat er mee naar de ruimtehaven?'],
  ['kai', 'Ik heb net een neonboom geplaatst bij mijn basis 💜'],
  ['nova', 'Iemand zin in een vlucht rond de watervallen?'],
  ['yara', 'Vanavond speel ik op het festival! 🎶'],
  ['milan', 'Wist je dat er vijf watervallen zijn? Ik heb ze allemaal gezien.'],
  ['Mira_Ø', 'Oran heeft nieuwe outfits in de bazaar!'],
  ['Jonas', 'Wie ruilt er metaal tegen hout?'],
  ['luna', 'De Levensboom is zo mooi vandaag.'],
  ['kai', 'Jo, wie helpt me met een dak? 😅'],
  ['StarRider', 'Net aangemeerd bij Station Halo, echt gigantisch 🚀'],
];

export const FESTIVAL_LINES = [
  ['luna', 'Wat een lichtshow!'],
  ['kai', 'Kom naar het podium!'],
  ['nova', 'Dit is geweldig!'],
  ['yara', 'Dit nummer is voor jullie! 🎶'],
  ['milan', 'Kijk naar de lucht — vallende sterren! ✨'],
  ['Mira_Ø', 'Beste festival ooit 💜'],
  ['StarRider', 'Iemand een foto van de hologrammen gemaakt?'],
];

export const WORLD_LINES = [
  ['StarRider', 'Net een meteoriet gevonden bij de ruïnes!'],
  ['Mira_Ø', 'Iemand zin om naar Station Halo te vliegen?'],
  ['Jonas', 'Mijn basis heeft eindelijk een dak 😅'],
  ['nova', 'Het uitzicht vanaf de uitkijkpost bij zonsondergang… ✨'],
  ['kai', 'Wie heeft er nog hout over?'],
  ['luna', 'Vergeet het festival vanavond niet!'],
  ['milan', 'Er zweeft een eiland met een waterval boven het meer. Echt!'],
];

export const ZONE_REMARKS = {
  aria: {
    ruins: 'Voel je dat? Hier is het signaal sterker.',
    lookout: 'Wat een uitzicht… daar ligt Aurora-stad.',
    plaza: 'Het plein! Luna is hier vast ergens.',
    spaceport: 'Die schepen… ooit vliegen we samen naar Halo.',
    waterfall: 'Hoor je dat? Het water klinkt bijna als muziek.',
    base: 'Jouw basis. Hier kunnen we iets moois bouwen.',
    city: 'Aurora-stad van dichtbij… nog mooier dan ik dacht.',
    signal: 'Hier begon alles.',
  },
  default: {
    ruins: 'Spannend hier, tussen die oude pilaren.',
    lookout: 'Wauw, wat een uitzicht!',
    plaza: 'Gezellig druk op het plein!',
    spaceport: 'Kijk dat kolonieschip in de hangar!',
    waterfall: 'Wat een waterval!',
    base: 'Mooi plekje voor een basis.',
    city: 'Aurora-stad! Eindelijk.',
    signal: 'Dat baken geeft me kippenvel.',
  },
};

/** Party banter on story beats ({quest} = quest title, {level} = new level). */
export const PARTY_BANTER = {
  quest: ['Missie voltooid! Goed gedaan 🙌', '"{quest}" — afgevinkt! Wat nu?', 'Nice! Op naar de volgende.', 'Dat ging lekker! ✨'],
  level: ['Niveau {level}! Je wordt steeds beter 💪', 'Level up! Niveau {level} 🎉'],
  festival: ['Het festival begint! Naar het podium! 🎶', 'Hoor je dat? Het Starfall Festival! ✨'],
  meteors: ['Kijk omhoog — vallende sterren! ☄️', 'Meteoren! Daar liggen vast fragmenten.'],
  ruinsAria: ['“Wie de cirkel volgt, keert terug naar het begin…” Dit moet ik opschrijven.', 'De inscriptie spreekt over de sterren. Het signaal wijst ergens naartoe.'],
};

