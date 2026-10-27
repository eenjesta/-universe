/**
 * Ambient chat content: the poster conversation (crop_action_social.png),
 * plaza / festival / world chatter and party remarks per zone. Text is
 * bilingual ({ en, nl }) and resolved with t() / pick() by chat/chat.js.
 */
/** Poster conversation + ambient plaza / festival / world chatter. */
export const POSTER_TALK = [
  ['luna', { en: 'Shall we try the new mission?', nl: 'Zullen we de nieuwe missie proberen?' }],
  ['kai', { en: "Yeah, I'm in!", nl: 'Ja, ik ben erbij!' }],
  ['nova', { en: 'This place is beautiful ✨', nl: 'Deze plek is prachtig ✨' }],
];

export const PLAZA_LINES = [
  ['luna', { en: "Who's coming to the Spaceport?", nl: 'Wie gaat er mee naar de ruimtehaven?' }],
  ['kai', { en: 'Just placed a neon tree at my base 💜', nl: 'Ik heb net een neonboom geplaatst bij mijn basis 💜' }],
  ['nova', { en: 'Anyone up for a flight around the waterfalls?', nl: 'Iemand zin in een vlucht rond de watervallen?' }],
  ['yara', { en: "I'm playing at the festival tonight! 🎶", nl: 'Vanavond speel ik op het festival! 🎶' }],
  ['milan', { en: "Did you know there are five waterfalls? I've seen them all.", nl: 'Wist je dat er vijf watervallen zijn? Ik heb ze allemaal gezien.' }],
  ['Mira_Ø', { en: 'Oran has new outfits in the bazaar!', nl: 'Oran heeft nieuwe outfits in de bazaar!' }],
  ['Jonas', { en: 'Anyone want to trade metal for wood?', nl: 'Wie ruilt er metaal tegen hout?' }],
  ['luna', { en: 'The Tree of Life looks so beautiful today.', nl: 'De Levensboom is zo mooi vandaag.' }],
  ['kai', { en: 'Yo, who can help me with a roof? 😅', nl: 'Jo, wie helpt me met een dak? 😅' }],
  ['StarRider', { en: "Just docked at Station Halo, it's seriously huge 🚀", nl: 'Net aangemeerd bij Station Halo, echt gigantisch 🚀' }],
];

export const FESTIVAL_LINES = [
  ['luna', { en: 'What a light show!', nl: 'Wat een lichtshow!' }],
  ['kai', { en: 'Come to the stage!', nl: 'Kom naar het podium!' }],
  ['nova', { en: 'This is amazing!', nl: 'Dit is geweldig!' }],
  ['yara', { en: 'This song is for all of you! 🎶', nl: 'Dit nummer is voor jullie! 🎶' }],
  ['milan', { en: 'Look at the sky — shooting stars! ✨', nl: 'Kijk naar de lucht — vallende sterren! ✨' }],
  ['Mira_Ø', { en: 'Best festival ever 💜', nl: 'Beste festival ooit 💜' }],
  ['StarRider', { en: 'Did anyone get a photo of the holograms?', nl: 'Iemand een foto van de hologrammen gemaakt?' }],
];

export const WORLD_LINES = [
  ['StarRider', { en: 'Just found a meteorite near the ruins!', nl: 'Net een meteoriet gevonden bij de ruïnes!' }],
  ['Mira_Ø', { en: 'Anyone fancy flying to Station Halo?', nl: 'Iemand zin om naar Station Halo te vliegen?' }],
  ['Jonas', { en: 'My base finally has a roof 😅', nl: 'Mijn basis heeft eindelijk een dak 😅' }],
  ['nova', { en: 'The view from the Lookout at sunset… ✨', nl: 'Het uitzicht vanaf de uitkijkpost bij zonsondergang… ✨' }],
  ['kai', { en: 'Anyone got wood to spare?', nl: 'Wie heeft er nog hout over?' }],
  ['luna', { en: "Don't forget the festival tonight!", nl: 'Vergeet het festival vanavond niet!' }],
  ['milan', { en: "There's an island with a waterfall floating above the lake. Seriously!", nl: 'Er zweeft een eiland met een waterval boven het meer. Echt!' }],
];

export const ZONE_REMARKS = {
  aria: {
    ruins: { en: 'Do you feel that? The signal is stronger here.', nl: 'Voel je dat? Hier is het signaal sterker.' },
    lookout: { en: "What a view… that's Aurora City over there.", nl: 'Wat een uitzicht… daar ligt Aurora-stad.' },
    plaza: { en: 'The plaza! Luna must be around here somewhere.', nl: 'Het plein! Luna is hier vast ergens.' },
    spaceport: { en: "Those ships… one day we'll fly to Halo together.", nl: 'Die schepen… ooit vliegen we samen naar Halo.' },
    waterfall: { en: 'Hear that? The water almost sounds like music.', nl: 'Hoor je dat? Het water klinkt bijna als muziek.' },
    base: { en: 'Your base. We can build something beautiful here.', nl: 'Jouw basis. Hier kunnen we iets moois bouwen.' },
    city: { en: 'Aurora City up close… even more beautiful than I thought.', nl: 'Aurora-stad van dichtbij… nog mooier dan ik dacht.' },
    signal: { en: 'This is where it all began.', nl: 'Hier begon alles.' },
  },
  default: {
    ruins: { en: 'Exciting, walking between these old pillars.', nl: 'Spannend hier, tussen die oude pilaren.' },
    lookout: { en: 'Wow, what a view!', nl: 'Wauw, wat een uitzicht!' },
    plaza: { en: 'The plaza is nice and busy!', nl: 'Gezellig druk op het plein!' },
    spaceport: { en: 'Look at that colony ship in the hangar!', nl: 'Kijk dat kolonieschip in de hangar!' },
    waterfall: { en: 'What a waterfall!', nl: 'Wat een waterval!' },
    base: { en: 'Nice spot for a base.', nl: 'Mooi plekje voor een basis.' },
    city: { en: 'Aurora City! Finally.', nl: 'Aurora-stad! Eindelijk.' },
    signal: { en: 'That beacon gives me goosebumps.', nl: 'Dat baken geeft me kippenvel.' },
  },
};

/** Party banter on story beats ({quest} = quest title, {level} = new level); pick() the language first. */
export const PARTY_BANTER = {
  quest: {
    en: ['Mission complete! Well done 🙌', '"{quest}" — checked off! What now?', 'Nice! On to the next one.', 'That went smoothly! ✨'],
    nl: ['Missie voltooid! Goed gedaan 🙌', '"{quest}" — afgevinkt! Wat nu?', 'Nice! Op naar de volgende.', 'Dat ging lekker! ✨'],
  },
  level: {
    en: ['Level {level}! You keep getting better 💪', 'Level up! Level {level} 🎉'],
    nl: ['Niveau {level}! Je wordt steeds beter 💪', 'Level up! Niveau {level} 🎉'],
  },
  festival: {
    en: ['The festival is starting! To the stage! 🎶', 'Hear that? The Starfall Festival! ✨'],
    nl: ['Het festival begint! Naar het podium! 🎶', 'Hoor je dat? Het Starfall Festival! ✨'],
  },
  meteors: {
    en: ['Look up — shooting stars! ☄️', 'Meteors! There must be fragments out there.'],
    nl: ['Kijk omhoog — vallende sterren! ☄️', 'Meteoren! Daar liggen vast fragmenten.'],
  },
  ruinsAria: {
    en: ['“Whoever follows the circle returns to the beginning…” I have to write this down.', 'The inscription speaks of the stars. The signal is pointing somewhere.'],
    nl: ['“Wie de cirkel volgt, keert terug naar het begin…” Dit moet ik opschrijven.', 'De inscriptie spreekt over de sterren. Het signaal wijst ergens naartoe.'],
  },
};
