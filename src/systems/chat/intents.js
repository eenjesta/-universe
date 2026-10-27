/**
 * Lightweight intent engine for NPC chat replies. Keyword intents match what
 * the player types in English AND Dutch (whatever the UI language; Unicode-aware
 * word boundaries, tolerant of inflections) → templated replies in the active
 * language that use the context: zone, time of day, tracked quest + current
 * objective, party, live events, the player's position (directions to places),
 * the marketplace catalog (prices), the replying NPC's personality and the
 * player's name.
 */
import { ZONES } from '../../world/layout.js';
import { t, pick as pickLang } from '../../core/i18n.js';
import { ITEMS } from '../economy/items.js';
import { fmt, fmtDist, zoneAtText } from '../shared/util.js';

const L = '\\p{L}\\p{N}';
const words = (list) => new RegExp(`(?:^|[^${L}])(?:${list.join('|')})(?=$|[^${L}])`, 'iu');

/** Intents with English + Dutch keywords (the player may type either language). */
export const INTENTS = [
  {
    id: 'greet',
    re: words([
      // nl
      'hoi', 'hallo', 'hé', 'hej', 'goeiedag', 'goedemorgen', 'goedemiddag', 'goedenavond', 'moi', 'hoihoi', 'heuj', 'dag allemaal', 'hallo allemaal',
      // en (+ shared)
      'hey', 'hee+y*', 'yo', 'hi', 'hiya', 'hello', 'howdy', 'greetings', 'sup', "what'?s up", 'good morning', 'good afternoon', 'good evening', 'hello everyone', 'hi everyone', 'hi all',
    ]),
  },
  {
    id: 'bye',
    re: words([
      'doei', 'doeg', 'tot ziens', 'tot later', 'tot straks', 'tot zo', 'slaap lekker', 'welterusten', 'ik ga ervandoor',
      'bye', 'bye bye', 'goodbye', 'good bye', 'ciao', 'see you', 'see ya', 'cya', 'good night', 'gotta go', 'farewell',
    ]),
  },
  {
    id: 'thanks',
    re: words(['dank', 'dankje\\p{L}*', 'dank je', 'dank u', 'bedankt', 'merci', 'top van je', 'thanks', 'thank you', 'thank u', 'thx', 'cheers', 'appreciated?', 'much obliged']),
  },
  {
    id: 'howareyou',
    re: /hoe gaat( het)?|hoe is het|alles goed|alles oké|wat ben je aan het doen|wat doe je|how are you|how'?s it going|how are things|how(?: are)? you doing|what are you (?:doing|up to)/iu,
  },
  {
    id: 'name',
    re: /hoe heet (?:je|jij)|wat is (?:je|jouw) naam|wie ben (?:je|jij)(?!\s+\p{L})|stel je (?:eens )?voor|what(?:'s| is) your name|who are you(?!\s+\p{L})|introduce yourself/iu,
  },
  { id: 'who', re: /(?:^|[^\p{L}])(?:wie (?:is|zijn|was|ben)|ken je|wat doet|who (?:is|are|was)|do you know|what does)(?=$|[^\p{L}])/iu },
  {
    id: 'mission',
    re: words([
      'missie\\p{L}*', 'quests?', 'opdracht\\p{L}*', 'taak', 'doel', 'wat moet ik', 'waar moet ik', 'wat nu', 'wat te doen', 'wat kan ik doen',
      'missions?', 'tasks?', 'objectives?', 'goal', 'what should i do', 'where should i go', 'what now', 'what to do', 'what can i do', 'what do i do', "what'?s next",
    ]),
  },
  {
    id: 'help',
    re: words(['help', 'hulp', 'hoe werkt', 'besturing', 'toetsen', 'controls', 'uitleg', 'snap het niet', 'hoe doe ik', 'how does', 'how do i', 'keys', 'explain', "don'?t get it", 'confused', 'tutorial']),
  },
  {
    id: 'build',
    re: words([
      'bouw\\p{L}*', 'huis', 'basis', 'muur', 'muren', 'dak', 'daken', 'fundering', 'blauwdruk\\p{L}*', 'creatief', 'bouwmodus',
      'build\\p{L}*', 'house', 'home', 'base', 'walls?', 'roofs?', 'foundations?', 'blueprints?', 'creative', 'build mode',
    ]),
  },
  {
    id: 'space',
    re: words([
      'ruimte', 'ruimteschip', 'schip', 'station', 'halo', 'asteroïde\\p{L}*', 'asteroide\\p{L}*', 'sterren', 'lanceren', 'piraten', 'konvooi', 'kolonieschip',
      'space', 'spaceships?', 'ships?', 'asteroids?', 'stars', 'launch\\p{L}*', 'pirates?', 'convoy', 'colony ship', 'orbit',
    ]),
  },
  {
    id: 'vehicle',
    re: words(['auto', 'vtol', 'rijden', 'vliegen', 'voertuig\\p{L}*', 'garage', 'race', 'racen', 'cars?', 'drive', 'driving', 'fly', 'flying', 'vehicles?', 'hoverbike', 'racing']),
  },
  {
    id: 'market',
    re: words([
      'markt\\p{L}*', 'kopen', 'koop', 'verkoop\\p{L}*', 'credits', 'winkel', 'kost', 'kosten', 'prijs', 'prijzen', 'geld', 'skin', 'lak', 'outfit\\p{L}*', 'poncho', 'pantser', 'jas', 'neonboom', 'standbeeld', 'reactor', 'fusiereactor',
      'market\\p{L}*', 'buy\\p{L}*', 'sell\\p{L}*', 'shop\\p{L}*', 'store', 'costs?', 'price\\p{L}*', 'money', 'skins', 'paint', 'armou?r', 'jacket', 'coat', 'neon tree', 'statue', 'fusion reactor', 'how much',
    ]),
  },
  {
    id: 'festival',
    re: words(['festival', 'starfall', 'feest', 'concert', 'muziek', 'podium', 'dansen', 'event', 'show', 'music', 'stage', 'danc\\p{L}*', 'celebrat\\p{L}*']),
  },
  {
    id: 'party',
    re: words(['groep', 'party', 'samen', 'meedoen', 'doe je mee', 'join\\p{L}*', 'team', 'volg me', 'kom mee', 'meegaan', 'ga je mee', 'group', 'together', 'follow me', 'come with me', 'come along', 'squad']),
  },
  { id: 'meteor', re: words(['meteor\\p{L}*', 'meteoor', 'meteoriet\\p{L}*', 'vallende sterren?', 'fragment\\p{L}*', 'shooting stars?', 'falling stars?']) },
  {
    id: 'world',
    re: words([
      'signaal', 'ruïne\\p{L}*', 'ruine\\p{L}*', 'inscriptie', 'stichters', 'runen\\p{L}*', 'ø', 'symbool', 'aria', 'baken', 'obelisk', 'geschiedenis', 'planeet', 'maan', 'manen', 'ringen', 'levensboom', 'boom', 'aurora', 'stad', 'waterval\\p{L}*', 'lucht', 'hemel', 'paars\\p{L}*', 'eiland\\p{L}*', 'zwevend\\p{L}*', 'meer', 'jungle', 'lumen\\p{L}*', 'kloof', 'zonnekloof', 'canyon',
      'signal', 'ruins?', 'inscription', 'founders?', 'runes?', 'symbol', 'beacon', 'history', 'planet', 'moons?', 'rings', 'tree of life', 'trees?', 'city', 'waterfalls?', 'sky', 'purple', 'violet', 'islands?', 'floating', 'lake', 'sunfall',
    ]),
  },
  {
    id: 'where',
    re: words([
      'waar ben ik', 'waar is', 'waar ligt', 'waar vind ik', 'hoe kom ik', 'hoe ver', 'welke kant', 'route', 'kaart', 'richting', 'verdwaald', 'kwijt',
      'where am i', "where'?s", 'where is', 'where are', 'where can i find', 'how do i get', 'how to get', 'how far', 'which way', 'map', 'directions?', "i'?m lost", 'got lost',
    ]),
  },
  {
    id: 'time',
    re: words(['hoe laat', 'nacht', 'donker', 'zonsondergang', 'zon', 'avond', 'ochtend', 'dag', 'what time', "what'?s the time", '(?<!good )night', 'dark', 'sunset', 'sunrise', 'sun', '(?<!good )(?:morning|afternoon|evening)', 'daytime']),
  },
  {
    id: 'compliment',
    re: words([
      'mooi\\p{L}*', 'prachtig\\p{L}*', 'gaaf', 'gave', 'vet', 'vette', 'cool\\p{L}*', 'geweldig\\p{L}*', 'wow+', 'super\\p{L}*', 'nice', 'tof', 'toffe', 'schitterend\\p{L}*', 'machtig\\p{L}*', 'episch\\p{L}*', 'magisch\\p{L}*', 'indrukwekkend\\p{L}*', 'awesome', 'wauw', 'top',
      'beautiful', 'pretty', 'gorgeous', 'amazing', 'great', 'stunning', 'lovely', 'incredible', 'wonderful', 'fantastic', 'epic', 'magic\\p{L}*', 'impressive', 'neat', 'love it', 'love this',
    ]),
  },
  { id: 'negative', re: words(['saai', 'stom', 'haat', 'slecht', 'irritant', 'moeilijk', 'lastig', 'boring', 'stupid', 'hate', 'bad', 'annoying', 'hard', 'difficult', 'sucks', 'lame', 'confusing']) },
];

/** Only emoji / symbols, no letters. */
const EMOJI_ONLY = /^[\s\p{Extended_Pictographic}\p{Emoji_Component}‍️!?.]+$/u;

export function detectIntents(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  if (EMOJI_ONLY.test(s) && /\p{Extended_Pictographic}/u.test(s)) return ['emoji'];
  const hits = INTENTS.filter((i) => i.re.test(s)).map((i) => i.id);
  if (!hits.length && /\?\s*$/.test(s)) hits.push('question');
  return hits;
}

// ------------------------------------------------------------------ knowledge
/** Places the player can ask directions to, in English or Dutch (first match wins). */
const PLACES = [
  ['lookout', /uitkijk\p{L}*|toren|lookout|watchtower|tower/iu],
  ['ruins', /ru[iï]ne\p{L}*|ruins?|inscripti\p{L}*|runen\p{L}*|runes?/iu],
  ['signal', /signaal|signal|baken|beacon|obelisk/iu],
  ['waterfall', /waterval\p{L}*|waterfall\p{L}*/iu],
  ['base', /basis|thuis|bouwplaats|glazen huis|(?:^|[^\p{L}])(?:base|home)(?=$|[^\p{L}])|building site|glass house/iu],
  ['plaza', /plein|plaza|nexus|levensboom|tree of life|bazaar|nachtmarkt|night market|marktterminal|market terminal/iu],
  ['spaceport', /ruimtehaven|haven|spaceport|space port|lanceerplatform\p{L}*|launch ?pads?|hangar/iu],
  ['city', /aurora|stad|city/iu],
  ['spawn', /uitzichtpunt|overlook|viewpoint/iu],
];
const PLACE_NAME = {
  lookout: { en: 'The Lookout', nl: 'De uitkijkpost' },
  ruins: { en: 'The Ancient Ruins', nl: 'De oude ruïnes' },
  signal: { en: 'The Signal', nl: 'Het signaal' },
  waterfall: { en: 'The Waterfall', nl: 'De waterval' },
  base: { en: 'Your base', nl: 'Je basis' },
  plaza: { en: 'Nexus Plaza', nl: 'Het Nexus-plein' },
  spaceport: { en: 'The Spaceport', nl: 'De ruimtehaven' },
  city: { en: 'Aurora City', nl: 'Aurora-stad' },
  spawn: { en: 'The Overlook', nl: 'Het uitzichtpunt' },
};
export function placeIn(text) {
  for (const [id, re] of PLACES) if (re.test(text || '')) return id;
  return null;
}

const COMPASS = {
  en: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'],
  nl: ['het noorden', 'het noordoosten', 'het oosten', 'het zuidoosten', 'het zuiden', 'het zuidwesten', 'het westen', 'het noordwesten'],
};
/** "about 1.2 km to the northwest" / "ongeveer 1,2 km naar het noordwesten" from the player position to a zone. */
function directions(pos, id) {
  const z = ZONES[id];
  if (!z || !pos) return null;
  const dx = z.x - pos.x;
  const dz = z.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 40) return t({ en: "close by — you're almost there", nl: 'vlakbij — je bent er bijna' });
  const bearing = (Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2); // 0 = north, clockwise
  const dir = pickLang(COMPASS)[Math.round(bearing / (Math.PI / 4)) % 8];
  return t({ en: 'about {d} to the {dir}', nl: 'ongeveer {d} naar {dir}' }, { d: fmtDist(d), dir });
}

/** Who is who (third person), how each describes themselves and where they usually are. */
const PEOPLE = {
  aria: {
    name: 'Aria',
    home: 'signal',
    re: /aria/iu,
    about: { en: "Aria studies the signal at the beacon by the lake. If anyone understands the Founders, it's her.", nl: 'Aria onderzoekt het signaal bij het baken aan het meer. Als iemand de Stichters begrijpt, is zij het.' },
    self: { en: "That's me. I've been listening to the signal for years — three short pulses, one long silence.", nl: 'Dat ben ik. Ik luister al jaren naar het signaal — drie korte pulsen, één lange stilte.' },
  },
  oran: {
    name: 'Oran',
    home: 'plaza',
    re: /oran/iu,
    about: { en: 'Oran is the old trader in the bazaar. He knows everything — especially rumors about lost ships.', nl: 'Oran is de oude handelaar in de bazaar. Hij weet álles, vooral geruchten over verloren schepen.' },
    self: { en: "Ha! That's me, friend. Trader, storyteller and collector of rumors.", nl: 'Ha! Dat ben ik, vriend. Handelaar, verteller en verzamelaar van geruchten.' },
  },
  luna: {
    name: 'Luna',
    home: 'plaza',
    re: /luna/iu,
    about: { en: 'Luna is the guide of Nexus Plaza. She knows everyone, and everyone knows her.', nl: 'Luna is de gids van het Nexus-plein. Ze kent iedereen, en iedereen kent haar.' },
    self: { en: "That's me! 😄 Guide of the plaza and always up for a new mission.", nl: 'Dat ben ik! 😄 Gids van het plein en altijd in voor een nieuwe missie.' },
  },
  kai: {
    name: 'Kai',
    home: 'plaza',
    re: /(?:^|[^\p{L}])kai(?=$|[^\p{L}])/iu,
    about: { en: 'Kai builds anything you can imagine. Feel free to ask him for building tips.', nl: 'Kai bouwt alles wat je kunt bedenken. Vraag hem gerust om bouwtips.' },
    self: { en: 'Me! Builder, tinkerer and roofing expert. 😅', nl: 'Ik! Bouwer, sleutelaar en dakenexpert. 😅' },
  },
  nova: {
    name: 'Nova',
    home: 'plaza',
    re: /nova/iu,
    about: { en: "Nova is a pilot. She'd rather fly than walk.", nl: 'Nova is piloot. Ze vliegt liever dan dat ze loopt.' },
    self: { en: "It's me, your favorite pilot ✨", nl: 'Ik ben het, je favoriete piloot ✨' },
  },
  yara: {
    name: 'Yara',
    home: 'plaza',
    re: /yara/iu,
    about: { en: "Yara makes music. Tonight she's playing at the Starfall Festival!", nl: 'Yara maakt muziek. Vanavond speelt ze op het Starfall Festival!' },
    self: { en: "That's me! Musician, and on stage tonight 🎶", nl: 'Dat ben ik! Muzikant, en vanavond op het podium 🎶' },
  },
  milan: {
    name: 'Milan',
    home: 'plaza',
    re: /milan/iu,
    about: { en: "Milan is an explorer. He's seen all five waterfalls.", nl: 'Milan is ontdekkingsreiziger. Hij heeft alle vijf de watervallen gezien.' },
    self: { en: 'Me! Always on my way to the next horizon.', nl: 'Ik! Altijd onderweg naar de volgende horizon.' },
  },
  jules: {
    name: 'Jules',
    home: 'spaceport',
    re: /jules/iu,
    about: { en: 'Jules is a flight technician at the Spaceport. He knows every bolt of your ship.', nl: 'Jules is vluchttechnicus in de ruimtehaven. Hij kent elke bout van je schip.' },
    self: { en: 'Jules, flight technician. Nice to meet you! Your ship is ready.', nl: 'Jules, vluchttechnicus. Aangenaam! Je schip staat klaar.' },
  },
};
const personIn = (text) => Object.keys(PEOPLE).find((id) => PEOPLE[id].re.test(text || '')) || null;

/** World sub-topics (English or Dutch keywords): the first matching topic answers. */
const WORLD = [
  [
    /signaal|signal|baken|beacon|obelisk|aria/iu,
    {
      en: ['The signal comes from the beacon by the lake: three short pulses, one long silence. Aria knows everything about it.', 'Some say the signal is a heartbeat. Of the world itself.'],
      nl: ['Het signaal komt van het baken aan het meer: drie korte pulsen, één lange stilte. Aria weet er alles van.', 'Sommigen zeggen dat het signaal een hartslag is. Van de wereld zelf.'],
    },
  ],
  [
    /ru[iï]ne|ruins?|inscripti|stichters|founders?|runen|runes?/iu,
    {
      en: ['The Ancient Ruins are older than Aurora City. Try scanning the inscription: hold [E].', 'The Founders built those ruins. Nobody knows what became of them.'],
      nl: ['De oude ruïnes zijn ouder dan Aurora-stad. Scan de inscriptie maar eens: houd [E] ingedrukt.', 'De Stichters bouwden die ruïnes. Niemand weet waar ze gebleven zijn.'],
    },
  ],
  [
    /ø|symbool|symbol/iu,
    {
      en: ['The Ø symbol is everywhere: on the ruins, on the beacon, on our jackets. A circle that is never closed.', 'A circle with one line through it — an ending that is also a beginning.'],
      nl: ['Het Ø-symbool staat overal: op de ruïnes, op het baken, op onze jassen. Een cirkel die nooit gesloten is.', 'Een cirkel met één lijn erdoor — een einde dat ook een begin is.'],
    },
  ],
  [
    /levensboom|tree of life|boom|tree/iu,
    {
      en: ['The Tree of Life glows purple at night. Some say it sings.', 'Everyone gathers under the Tree of Life. Especially during the festival.'],
      nl: ['De Levensboom gloeit ’s nachts paars. Sommigen zeggen dat ze zingt.', 'Onder de Levensboom komt iedereen samen. Zeker tijdens het festival.'],
    },
  ],
  [
    /planeet|planet|maan|manen|moons?|ringen|rings/iu,
    {
      en: ['That giant planet in the sky has two moons. On a clear day you can even see its rings.', 'North of the planet lie the Northern Rings. Ask Oran about the lost ship sometime…'],
      nl: ['Die reusachtige planeet aan de hemel heeft twee manen. Bij helder weer zie je zelfs haar ringen.', 'Ten noorden van de planeet liggen de Noordelijke Ringen. Vraag Oran maar eens naar het verloren schip…'],
    },
  ],
  [
    /aurora|stad|city/iu,
    {
      en: ['Aurora City lies across the lake. Those towers catch the last of the sunlight.', 'Aurora City looks its best from the Lookout.'],
      nl: ['Aurora-stad ligt aan de overkant van het meer. Die torens vangen het laatste zonlicht.', 'Vanaf de uitkijkpost zie je Aurora-stad het mooist.'],
    },
  ],
  [
    /waterval|waterfall/iu,
    {
      en: ['There are five waterfalls around the lake. The biggest one is in the northwest.', 'Go to the waterfall at sunset: that is when there is gold in the mist.'],
      nl: ['Er zijn vijf watervallen rond het meer. De grootste ligt in het noordwesten.', 'Ga bij zonsondergang naar de waterval: dan hangt er goud in de nevel.'],
    },
  ],
  [
    /lucht|hemel|paars|sky|purple|violet/iu,
    {
      en: ['The atmosphere turns violet when the sun goes down. Above it you can see the planet and its two moons.', 'That purple glow? Dust from the rings, Aria says. At night it gets even more beautiful.'],
      nl: ['De atmosfeer kleurt violet als de zon zakt. Daarboven zie je de planeet en haar twee manen.', 'Die paarse gloed? Stof uit de ringen, zegt Aria. ’s Nachts wordt het nog mooier.'],
    },
  ],
  [
    /eiland|zwevend|island|floating/iu,
    {
      en: ['The floating islands have hung above the lake for centuries. Waterfalls pour from some of them into the depths.', 'With the VTOL you can reach the floating islands. Landing is another story…'],
      nl: ['De zwevende eilanden hangen al eeuwen boven het meer. Uit sommige stroomt een waterval de diepte in.', 'Met de VTOL kun je bij de zwevende eilanden komen. Landen is een ander verhaal…'],
    },
  ],
  [
    /(?:^|[^\p{L}])(?:meer|lake)(?=$|[^\p{L}])/iu,
    {
      en: ['The lake lies between the Overlook and Aurora City. When there is no wind, it mirrors the whole city.', 'The oldest trees in the world grow on the islands in the lake.'],
      nl: ['Het meer ligt tussen het uitzichtpunt en Aurora-stad. Bij windstil weer weerspiegelt het de hele stad.', 'Op de eilanden in het meer groeien de oudste bomen van de wereld.'],
    },
  ],
  [
    /jungle|lumen/iu,
    {
      en: ['The Lumen Jungle lies on the western plateau. At night everything there glows — plants, river, everything.', 'Milan says there are species living in the Lumen Jungle that nobody has scanned yet.'],
      nl: ['De Lumen-jungle ligt op het westelijke plateau. ’s Nachts licht daar alles op — planten, rivier, alles.', 'Milan zegt dat er in de Lumen-jungle soorten leven die nog niemand heeft gescand.'],
    },
  ],
  [
    /kloof|canyon|sunfall/iu,
    {
      en: ["Sunfall Canyon in the east: red rocks, arches and a hoverbike circuit. One day we'll race there!"],
      nl: ['De Zonnekloof in het oosten: rode rotsen, bogen en een circuit voor hoverbikes. Ooit rijden we daar een race!'],
    },
  ],
];

/** Emoji answers mirror what was sent. */
const EMOJI_REPLY = [
  [/🚀/u, { en: ['🚀🚀', "Let's go! 🚀"], nl: ['🚀🚀', 'Gaan! 🚀'] }],
  [/✨|⭐|🌟|💫/u, ['✨✨', '✨']],
  [/👋/u, { en: ['👋', 'Hi! 👋'], nl: ['👋', 'Hoi! 👋'] }],
  [/💜|❤|♥|🥰|😍/u, ['💜', '💜✨']],
  [/😂|🤣|😄|😁|😆|😅/u, ['😄', 'Haha 😆']],
  [/🎶|🎵|🎸|🎤/u, ['🎶', '🎶✨']],
  [/🙌|👏|👍/u, ['🙌', '👏👏']],
  [/😢|😭|😞/u, ['Aww 🫂', '💜']],
];

/** Extra search keys (lower case, English + Dutch) for catalog items besides their names. */
const ITEM_KEYS = {
  'skin-car-sunset': ['sunset'],
  'skin-car-aurora': ['aurora-lak', 'aurora lak', 'aurora paint'],
  'skin-ship-gold': ['gouden romp', 'goud', 'golden hull', 'gold'],
  'power-fusion': ['fusie', 'fusion', 'reactor'],
  'decor-neon-tree': ['neonboom', 'neon'],
  'decor-statue': ['standbeeld', 'beeld', 'statue'],
  'outfit-nomad': ['nomade', 'nomad', 'poncho'],
  'outfit-vanguard': ['vanguard', 'pantser', 'armor', 'armour'],
  'outfit-drifter': ['drifter', 'jas', 'coat', 'jacket'],
};
/** Grammar per item: Dutch 'het'-words, and plurals (both languages). */
const NEUTER = new Set(['decor-statue', 'outfit-vanguard']);
const PLURAL = new Set(['res-stone-100']);
function itemIn(text) {
  const s = String(text || '').toLowerCase();
  const names = (it) => (it.text?.name && typeof it.text.name === 'object' ? Object.values(it.text.name) : [it.name]);
  return ITEMS.find((it) => names(it).some((n) => s.includes(String(n).toLowerCase())) || (ITEM_KEYS[it.id] || []).some((k) => s.includes(k))) || null;
}

// ------------------------------------------------------------------ choosing
/** Most informative intent first (questions about missions beat a greeting). */
const PRIORITY = ['name', 'who', 'mission', 'help', 'party', 'festival', 'meteor', 'build', 'space', 'vehicle', 'market', 'world', 'where', 'howareyou', 'negative', 'thanks', 'time', 'compliment', 'bye', 'greet', 'emoji', 'question'];

/**
 * Picks the intent to answer. Directions win when a known place or person is
 * named ("How do I get to the waterfall?", "Waar is Aria?"), "who" only when a
 * known person is named.
 */
export function primaryIntent(intents, text = '') {
  if (intents.includes('where') && (placeIn(text) || personIn(text))) return 'where';
  for (const id of PRIORITY) {
    if (!intents.includes(id)) continue;
    if (id === 'who' && !personIn(text)) continue;
    return id;
  }
  return 'default';
}

const rand = (a) => a[Math.floor(Math.random() * a.length)];
/** One random line from a bilingual list ({en: [...], nl: [...]}), a plain list or a single text. */
const one = (v) => {
  const a = pickLang(v);
  return Array.isArray(a) ? t(rand(a)) : t(a);
};
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Speaker personalities: optional per-intent lines. */
const VOICES = {
  luna: {
    greet: { en: ['Hi {player}! 👋', "Heeey! So glad you're here ✨", 'Hi hi! Are you on the plaza too?'], nl: ['Hoi {player}! 👋', 'Heeey! Fijn dat je er bent ✨', 'Hoi hoi! Ben je ook op het plein?'] },
    default: { en: ['Haha, really? 😄', 'Shall we go do something together?', "It's so cozy here today!"], nl: ['Haha, echt? 😄', 'Zullen we samen iets gaan doen?', 'Ik vind het hier zo gezellig vandaag!'] },
    compliment: { en: ['Right?! I never get tired of it ✨', 'Totally, especially when the tree lights up 💜'], nl: ['Toch?! Ik krijg er nooit genoeg van ✨', 'Echt hè, vooral als de boom oplicht 💜'] },
  },
  kai: {
    greet: { en: ['Yo! 🙌', "Yo {player}, how's it going?", 'Hey hey! Ready to build?'], nl: ['Jo! 🙌', 'Yo {player}, alles goed?', 'Hé hé! Klaar om te bouwen?'] },
    default: { en: ["Yeah, I'm in!", 'Sounds good, man.', 'Haha, for sure.'], nl: ['Ja, ik ben erbij!', 'Klinkt goed, man.', 'Haha, zeker weten.'] },
    compliment: { en: ['Sick, right? Wait till your base is finished.', 'Totally awesome. 🙌'], nl: ['Vet hè? Wacht maar tot je basis af is.', 'Echt top. 🙌'] },
  },
  nova: {
    greet: { en: ['Hi! ✨', "Hey {player}! Lovely {daypart}, isn't it?", 'Hello there, pilot!'], nl: ['Hoi! ✨', 'Hé {player}! Mooie {daypart}, hè?', 'Hallo daar, piloot!'] },
    default: { en: ['This place is beautiful ✨', "Honestly, I'd rather be in the air, haha.", 'Agreed!'], nl: ['Deze plek is prachtig ✨', 'Ik zit eigenlijk liever in de lucht, haha.', 'Mee eens!'] },
    compliment: { en: ['Wait till you see it from three hundred meters up ✨', 'Beautiful, right?'], nl: ['Wacht tot je het van driehonderd meter hoogte ziet ✨', 'Prachtig, toch?'] },
  },
  aria: {
    greet: { en: ['Hello, {player}.', 'There you are. The signal is calm today.', 'Hey. Good to hear from you.'], nl: ['Hallo, {player}.', 'Daar ben je. Het signaal is rustig vandaag.', 'Hé. Goed je te horen.'] },
    default: { en: ['Interesting…', 'I think the Founders thought so too.', "Let's keep looking."], nl: ['Interessant…', 'Ik denk dat de Stichters dat ook dachten.', 'Laten we verder kijken.'] },
    compliment: { en: ['Yes. Sometimes I forget how beautiful it is here.', "The Ø symbol fits this place, don't you think?"], nl: ['Ja. Soms vergeet ik hoe mooi het hier is.', 'Het Ø-symbool past hier, vind je niet?'] },
  },
  oran: {
    greet: { en: ['Ah, traveler! Welcome.', 'Good day, friend!', 'Hello! Do stop by the bazaar sometime.'], nl: ['Ah, reiziger! Welkom.', 'Goedendag, vriend!', 'Hallo! Kom gerust eens langs in de bazaar.'] },
    default: { en: ['Mm-hm, my grandfather used to say that too.', "Ha! You're a clever one.", 'Everything has its price, friend.'], nl: ['Hm-hm, dat zei mijn grootvader ook al.', 'Ha! Je bent een slimme, jij.', 'Alles heeft zijn prijs, vriend.'] },
  },
  yara: { greet: { en: ['Hi! 🎶', 'Heyyy {player}!'], nl: ['Hoi! 🎶', 'Heey {player}!'] }, default: { en: ['That sounds like a song, haha 🎶', 'Definitely!'], nl: ['Dit klinkt als een liedje, haha 🎶', 'Zeker!'] } },
  milan: { greet: { en: ['Hey, adventurer!', 'Hi {player}!'], nl: ['Hé, avonturier!', 'Hoi {player}!'] }, default: { en: ['I want to go there someday.', 'Have you seen the waterfalls yet?'], nl: ['Daar wil ik ooit heen.', 'Heb je de watervallen al gezien?'] } },
  jules: { greet: { en: ['Hey, pilot!', 'Hello {player}! All green here.'], nl: ['Hé, piloot!', 'Hallo {player}! Alles groen hier.'] }, default: { en: ['Copy that.', "I'll check it in the systems."], nl: ['Begrepen.', 'Ik check het even in de systemen.'] } },
};

/**
 * Builds a reply in the active language. `c` = { speaker, player, text, pos {x, z}, zone, zoneLabel,
 *   at ('at Nexus Plaza' / 'op het Nexus-plein'), night, daypart ('morning' | 'afternoon' | 'evening' | 'night'),
 *   daypartText, clock ('21:40'), quest, objective, partyIds, partyNames, partySize, festival, meteors, nearPlaza }.
 * Templates may contain {player}, {at}, {zone}, {daypart} and {speakerName} (filled by chat.js).
 */
export function replyFor(intent, c) {
  const v = VOICES[c.speaker] || {};
  const q = c.quest;
  const text = c.text || '';
  switch (intent) {
    case 'greet':
      return one(
        v.greet || {
          en: ['Hi {player}! 👋', 'Hey! Good to see you.', "Hello! Lovely {daypart}, isn't it?", c.at ? 'Yo! Are you {at} too?' : 'Hi!'],
          nl: ['Hoi {player}! 👋', 'Hé! Goed je te zien.', 'Hallo! Mooie {daypart}, hè?', c.at ? 'Yo! Ben jij ook {at}?' : 'Hoi!'],
        },
      );
    case 'bye':
      return one({ en: ['Bye! See you soon 👋', 'See you later!', 'Safe travels, {player}!', 'Take care out there.'], nl: ['Doei! Tot snel 👋', 'Tot later!', 'Fijne reis, {player}!', 'Pas goed op jezelf daarbuiten.'] });
    case 'thanks':
      return one({ en: ["You're welcome! 😊", 'No problem!', 'Anytime!', "That's what we're here for."], nl: ['Graag gedaan! 😊', 'Geen probleem!', 'Altijd!', 'Daar zijn we voor.'] });
    case 'howareyou':
      return one(
        c.festival
          ? { en: ['Great, the festival has started! And you?', 'Amazing — can you hear that music? 🎶'], nl: ['Super, het festival is begonnen! En jij?', 'Geweldig, hoor je die muziek? 🎶'] }
          : {
              en: ['Good! Enjoying the view. And you?', 'Fine, just exploring a bit.', c.speaker === 'kai' ? 'Busy building, man!' : 'Doing well! Nice and quiet today.'],
              nl: ['Goed! Ik geniet van het uitzicht. En jij?', 'Prima, beetje aan het verkennen.', c.speaker === 'kai' ? 'Druk met bouwen, man!' : 'Goed hoor! Lekker rustig vandaag.'],
            },
      );
    case 'name': {
      const me = PEOPLE[c.speaker];
      return me ? t(me.self) : one({ en: ["I'm {speakerName}. Nice to meet you, {player}!", "Call me {speakerName}. And you're {player}, right?"], nl: ['Ik ben {speakerName}. Aangenaam, {player}!', 'Noem me maar {speakerName}. En jij bent {player}, toch?'] });
    }
    case 'who': {
      const id = personIn(text);
      if (!id) return t({ en: 'No idea who that is. Ask Luna — she knows everyone.', nl: 'Geen idee wie dat is. Vraag het Luna, zij kent iedereen.' });
      return t(id === c.speaker ? PEOPLE[id].self : PEOPLE[id].about);
    }
    case 'mission':
      if (q && c.objective)
        return one({
          en: [
            `Your mission is "${q.title}", right? Next step: ${lower(c.objective)}.`,
            `"${c.objective}" — that's your next step. Follow the cyan marker!`,
            `Your next objective: ${lower(c.objective)}. Check your journal [J] if you lose track.`,
          ],
          nl: [
            `Jouw missie is "${q.title}", toch? Volgende stap: ${lower(c.objective)}.`,
            `"${c.objective}" — dat is je volgende stap. Volg de cyaan markering!`,
            `Je volgende doel: ${lower(c.objective)}. Kijk in je journaal [J] als je het kwijt bent.`,
          ],
        });
      return one({
        en: ['Open your journal with [J] — all your missions are in there.', 'Talk to Aria at the Signal — she always knows what needs to happen.'],
        nl: ['Open je journaal met [J], daar staan al je missies.', 'Praat eens met Aria bij het signaal — zij weet altijd wat er moet gebeuren.'],
      });
    case 'help':
      return one({
        en: [
          '[J] for your missions, [M] for the map, [K] for the Marketplace and [E] to interact.',
          'Hold [E] to scan or harvest. [B] opens build mode.',
          '[G] calls up a vehicle. In the VTOL, [Space] climbs and [C] descends.',
        ],
        nl: [
          '[J] voor je missies, [M] voor de kaart, [K] voor de marktplaats en [E] voor interactie.',
          'Houd [E] ingedrukt om te scannen of te oogsten. Met [B] open je de bouwmodus.',
          'Met [G] roep je een voertuig op. In de VTOL stijg je met [Spatie] en daal je met [C].',
        ],
      });
    case 'build':
      return one({
        en: [
          'You build with [B]: first a foundation, then walls, a roof and power.',
          'Your base is in the forest southwest of the Overlook. Plenty of room there!',
          "Tip: in the Marketplace [K] you'll find blueprints for neon trees and statues.",
        ],
        nl: [
          'Bouwen doe je met [B]: eerst een fundering, dan muren, een dak en energie.',
          'Je basis ligt in het bos ten zuidwesten van het uitzichtpunt. Daar is ruimte genoeg!',
          'Tip: in de marktplaats [K] vind je blauwdrukken voor neonbomen en standbeelden.',
        ],
      });
    case 'space':
      return one({
        en: [
          'Go to the Spaceport, board your ship with [F] and press [L] to launch. 🚀',
          'Station Halo is seriously huge. Watch out for pirates in the asteroid field, though!',
          "In space you scan with [E]. There's a strange anomaly out there somewhere…",
        ],
        nl: [
          'Ga naar de ruimtehaven, stap in je schip met [F] en druk op [L] om te lanceren. 🚀',
          'Station Halo is echt gigantisch. Pas wel op voor piraten in het asteroïdenveld!',
          'In de ruimte scan je met [E]. Er hangt daar ergens een vreemde anomalie…',
        ],
      });
    case 'vehicle':
      return one({
        en: ['[G] opens your garage: car, VTOL or spaceship.', 'The VTOL is the most fun — [Space] to climb, [C] to descend.', "In the car, [Shift] gives you a boost. Stick to the roads, it's faster."],
        nl: ['Met [G] open je je garage: auto, VTOL of ruimteschip.', 'De VTOL is het leukst — [Spatie] stijgen, [C] dalen.', 'In de auto geeft [Shift] een boost. Rijd wel over de wegen, dat gaat sneller.'],
      });
    case 'market': {
      const it = itemIn(text);
      if (it) {
        const name = it.name;
        const price = `${fmt(it.price)} Ø-credits`;
        const plural = PLURAL.has(it.id);
        const art = NEUTER.has(it.id) ? 'Het' : 'De';
        const verb = plural ? 'kosten' : 'kost';
        const pron = NEUTER.has(it.id) ? 'het' : plural ? 'ze' : 'hem';
        return c.speaker === 'oran'
          ? t({
              en: `The ${name}? ${price}, friend — and that's a fair price. Take a look in the Marketplace [K].`,
              nl: `${art} ${name}? ${price}, vriend — en dat is een eerlijke prijs. Kijk maar in de marktplaats [K].`,
            })
          : t({
              en: `The ${name} ${plural ? 'cost' : 'costs'} ${price}. You'll find ${plural ? 'them' : 'it'} in the Marketplace [K] or at the terminal next to the Tree of Life.`,
              nl: `${art} ${name} ${verb} ${price}. Je vindt ${pron} in de marktplaats [K] of bij de terminal naast de Levensboom.`,
            });
      }
      return one({
        en: [
          'The market terminal is next to the Tree of Life at Nexus Plaza. Or just press [K].',
          'Oran in the bazaar pays well for metal!',
          c.speaker === 'oran' ? 'For you I always have a fair price, friend.' : "That Aurora Paint for the car… I'm saving up for it!",
        ],
        nl: [
          'De marktterminal staat naast de Levensboom op het Nexus-plein. Of druk gewoon op [K].',
          'Oran in de bazaar betaalt goed voor metaal!',
          c.speaker === 'oran' ? 'Voor jou heb ik altijd een eerlijke prijs, vriend.' : 'Die Aurora-lak voor de auto… ik spaar ervoor!',
        ],
      });
    }
    case 'festival':
      if (c.festival)
        return one({
          en: ['The Starfall Festival is on right now! Come to the stage! 🎶', 'What a light show! ✨', 'Come to the stage!'],
          nl: ['Het Starfall Festival is nu bezig! Kom naar het podium! 🎶', 'Wat een lichtshow! ✨', 'Kom naar het podium!'],
        });
      return c.night
        ? one({
            en: ['The festival could start any moment — come to Nexus Plaza!', "The Starfall Festival is on again tonight. I'll be there!"],
            nl: ['Het festival kan elk moment beginnen — kom naar het Nexus-plein!', 'Vannacht is er weer het Starfall Festival. Ik ben erbij!'],
          })
        : one({
            en: ['The Starfall Festival is on at Nexus Plaza every night. Come by tonight!', 'As soon as the sun sets, the festival begins. 🎶'],
            nl: ['Het Starfall Festival is elke nacht op het Nexus-plein. Kom vanavond!', 'Zodra de zon onder is, begint het festival. 🎶'],
          });
    case 'party':
      if (c.partySize)
        return one({
          en: [`There are already ${c.partySize + 1} of us! Nice.`, `I see ${c.partyNames} with you already. Nice!`],
          nl: [`We zijn al met ${c.partySize + 1}! Gezellig.`, `Ik zie ${c.partyNames} al bij je. Nice!`],
        });
      return one({ en: ["Talk to me and I'll join you!", 'Fun! Come over and ask me.'], nl: ['Praat even met me, dan sluit ik me aan!', 'Leuk! Kom naar me toe en vraag het me.'] });
    case 'meteor':
      return c.meteors
        ? one({ en: ["They're falling now! Look up! ☄️", "Follow the orange glow — that's where the fragments full of metal are."], nl: ['Ze vallen nu! Kijk omhoog! ☄️', 'Volg de oranje gloed — daar liggen fragmenten vol metaal.'] })
        : one({
            en: ['Meteor showers only happen at night. Keep an eye on the sky!', 'The fragments are full of energy. Hold [E] to harvest them.'],
            nl: ['Meteorenregens zijn er alleen ’s nachts. Houd de lucht in de gaten!', 'De fragmenten zitten vol energie. Houd [E] ingedrukt om te oogsten.'],
          });
    case 'world': {
      const topic = WORLD.find(([re]) => re.test(text));
      if (topic) return one(topic[1]);
      return t(rand(WORLD.map((w) => ({ en: w[1].en[0], nl: w[1].nl[0] }))));
    }
    case 'where': {
      const pid = personIn(text);
      if (pid) {
        const pp = PEOPLE[pid];
        if (c.partyIds?.includes(pid)) return pid === c.speaker ? t({ en: "I'm right behind you! 😄", nl: 'Ik loop vlak achter je! 😄' }) : t({ en: '{name} is walking with you!', nl: '{name} loopt met je mee!' }, { name: pp.name });
        const dir = directions(c.pos, pp.home);
        const at = zoneAtText(pp.home);
        return pid === c.speaker
          ? t({ en: "I'm {at}{dir}.", nl: 'Ik ben {at}{dir}.' }, { at, dir: dir ? ` — ${dir}` : '' })
          : t({ en: '{name} is usually {at}{dir}.', nl: '{name} is meestal {at}{dir}.' }, { name: pp.name, at, dir: dir ? `, ${dir}` : '' });
      }
      const place = placeIn(text);
      const dir = place && directions(c.pos, place);
      if (dir) return t({ en: "{place}? That's {dir}. Open the map with [M] to fast travel.", nl: '{place}? Dat is {dir}. Open de kaart met [M] om snel te reizen.' }, { place: t(PLACE_NAME[place]), dir });
      return c.at
        ? t({ en: "You're {at} right now. Open the map with [M] to fast travel.", nl: 'Je bent nu {at}. Open de kaart met [M] om snel te reizen.' }, { at: c.at })
        : t({ en: 'Open the map with [M] — it shows every location and lets you fast travel.', nl: 'Open de kaart met [M], daar zie je alle locaties en kun je snel reizen.' });
    }
    case 'time': {
      const clock = c.clock ? t({ en: "It's {clock}. ", nl: 'Het is {clock}. ' }, { clock: c.clock }) : '';
      if (c.night)
        return clock + one({ en: ['Night, so — look at the stars! Sometimes meteors fall.', "Beautiful night, isn't it? The whole plaza lights up."], nl: ['Nacht dus — kijk naar de sterren! Soms vallen er meteoren.', 'Mooie nacht, hè? Het plein licht helemaal op.'] });
      if (c.daypart === 'evening')
        return clock + one({ en: ["The sun is about to set — that's when it gets really beautiful.", 'Golden hour! Perfect for a photo at the waterfall.'], nl: ['De zon gaat zo onder, dan wordt het pas echt mooi.', 'Gouden uurtje! Perfect voor een foto bij de waterval.'] });
      if (c.daypart === 'morning')
        return clock + one({ en: ["It's still early! The mist is still hanging over the lake.", 'Morning — the light is soft and clear now.'], nl: ['Nog vroeg! De nevel hangt nog boven het meer.', 'Ochtend — het licht is nu zacht en helder.'] });
      return clock + one({ en: ['The middle of the day. The Starfall Festival is on again tonight!', 'A few more hours until sunset.'], nl: ['Midden op de dag. Vanavond is er weer het Starfall Festival!', 'Nog een paar uur tot zonsondergang.'] });
    }
    case 'compliment':
      return one(
        v.compliment || {
          en: ['Right? I never get tired of it. ✨', c.at ? 'Totally! I love hanging out {at}.' : 'Totally agree! 😄', 'Definitely! 🙌'],
          nl: ['Toch? Ik krijg er nooit genoeg van. ✨', c.at ? 'Echt hè! Ik kom graag {at}.' : 'Helemaal mee eens! 😄', 'Zeker! 🙌'],
        },
      );
    case 'negative':
      return one({
        en: ['Aw, bummer. Try the VTOL — it makes everything better. 😉', 'Lost? Open the map with [M] — you can fast travel.', "Hey, chin up! Come to the plaza and we'll do something together."],
        nl: ['Ah, balen. Probeer eens de VTOL, dat maakt alles beter. 😉', 'Verdwaald? Open de kaart met [M] — je kunt snel reizen.', 'Hé, kop op! Kom naar het plein, dan doen we samen iets.'],
      });
    case 'emoji': {
      const m = EMOJI_REPLY.find(([re]) => re.test(text));
      return one(m ? m[1] : ['😄', '✨', '🙌', '👋', '💜']);
    }
    case 'question':
      return one({
        en: ['Good question! Maybe Aria knows — or check your journal [J].', 'Hmm, no idea actually. Ask Oran, he knows everything.', 'I wonder that too!'],
        nl: ['Goede vraag! Misschien weet Aria het — of kijk in je journaal [J].', 'Hmm, geen idee eigenlijk. Vraag het Oran, die weet alles.', 'Dat vraag ik me ook af!'],
      });
    default:
      return one(v.default || { en: ['Haha, totally! 😄', 'Really? Tell me more!', 'Sounds good!', 'Agreed.', "Glad you're here, {player}!"], nl: ['Haha, zeker! 😄', 'Echt? Vertel!', 'Klinkt goed!', 'Mee eens.', 'Leuk dat je er bent, {player}!'] });
  }
}
