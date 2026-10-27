/**
 * Lightweight Dutch intent engine for NPC chat replies. Keyword intents
 * (Unicode-aware word boundaries, tolerant of inflections) → templated replies
 * that use the context: zone, time of day, tracked quest + current objective,
 * party, live events, the player's position (directions to places), the
 * marketplace catalog (prices), the replying NPC's personality and the
 * player's name.
 */
import { ZONES } from '../../world/layout.js';
import { ITEMS } from '../economy/items.js';
import { fmt, fmtDist, zoneAtText } from '../shared/util.js';

const L = '\\p{L}\\p{N}';
const words = (list) => new RegExp(`(?:^|[^${L}])(?:${list.join('|')})(?=$|[^${L}])`, 'iu');

export const INTENTS = [
  { id: 'greet', re: words(['hoi', 'hallo', 'hey', 'hee+y*', 'hé', 'hej', 'yo', 'hi', 'hello', 'goeiedag', 'goedemorgen', 'goedemiddag', 'goedenavond', 'moi', 'hoihoi', 'heuj', 'dag allemaal', 'hallo allemaal']) },
  { id: 'bye', re: words(['doei', 'doeg', 'tot ziens', 'tot later', 'tot straks', 'tot zo', 'bye', 'ciao', 'slaap lekker', 'welterusten', 'ik ga ervandoor']) },
  { id: 'thanks', re: words(['dank', 'dankje\\p{L}*', 'dank je', 'dank u', 'bedankt', 'thanks', 'thx', 'merci', 'top van je']) },
  { id: 'howareyou', re: /hoe gaat( het)?|hoe is het|alles goed|alles oké|how are you|wat ben je aan het doen|wat doe je/iu },
  { id: 'name', re: /hoe heet (?:je|jij)|wat is (?:je|jouw) naam|wie ben (?:je|jij)(?!\s+\p{L})|stel je (?:eens )?voor/iu },
  { id: 'who', re: /(?:^|[^\p{L}])(?:wie (?:is|zijn|was|ben)|ken je|wat doet)(?=$|[^\p{L}])/iu },
  { id: 'mission', re: words(['missie\\p{L}*', 'quests?', 'opdracht\\p{L}*', 'taak', 'doel', 'wat moet ik', 'waar moet ik', 'wat nu', 'wat te doen', 'wat kan ik doen']) },
  { id: 'help', re: words(['help', 'hulp', 'hoe werkt', 'besturing', 'toetsen', 'controls', 'uitleg', 'snap het niet', 'hoe doe ik']) },
  { id: 'build', re: words(['bouw\\p{L}*', 'huis', 'basis', 'muur', 'muren', 'dak', 'daken', 'fundering', 'blauwdruk\\p{L}*', 'creatief', 'bouwmodus']) },
  { id: 'space', re: words(['ruimte', 'ruimteschip', 'schip', 'station', 'halo', 'asteroïde\\p{L}*', 'asteroide\\p{L}*', 'sterren', 'lanceren', 'piraten', 'konvooi', 'kolonieschip']) },
  { id: 'vehicle', re: words(['auto', 'vtol', 'rijden', 'vliegen', 'voertuig\\p{L}*', 'garage', 'race', 'racen']) },
  { id: 'market', re: words(['markt\\p{L}*', 'marketplace', 'kopen', 'koop', 'verkoop\\p{L}*', 'credits', 'winkel', 'kost', 'kosten', 'prijs', 'prijzen', 'geld', 'skin', 'lak', 'outfit\\p{L}*', 'poncho', 'pantser', 'jas', 'neonboom', 'standbeeld', 'reactor', 'fusiereactor']) },
  { id: 'festival', re: words(['festival', 'starfall', 'feest', 'concert', 'muziek', 'podium', 'dansen', 'event', 'show']) },
  { id: 'party', re: words(['groep', 'party', 'samen', 'meedoen', 'doe je mee', 'join', 'team', 'volg me', 'kom mee', 'meegaan', 'ga je mee']) },
  { id: 'meteor', re: words(['meteor\\p{L}*', 'meteoor', 'meteoriet\\p{L}*', 'vallende sterren?', 'fragment\\p{L}*']) },
  { id: 'world', re: words(['signaal', 'ruïne\\p{L}*', 'ruine\\p{L}*', 'inscriptie', 'stichters', 'runen\\p{L}*', 'ø', 'symbool', 'aria', 'baken', 'obelisk', 'geschiedenis', 'planeet', 'maan', 'manen', 'ringen', 'levensboom', 'boom', 'aurora', 'stad', 'waterval\\p{L}*', 'lucht', 'hemel', 'paars\\p{L}*', 'eiland\\p{L}*', 'zwevend\\p{L}*', 'meer', 'jungle', 'lumen\\p{L}*', 'kloof', 'zonnekloof', 'canyon']) },
  { id: 'where', re: words(['waar ben ik', 'waar is', 'waar ligt', 'waar vind ik', 'hoe kom ik', 'hoe ver', 'welke kant', 'route', 'kaart', 'richting', 'verdwaald', 'kwijt']) },
  { id: 'time', re: words(['hoe laat', 'nacht', 'donker', 'zonsondergang', 'zon', 'avond', 'ochtend', 'dag']) },
  {
    id: 'compliment',
    re: words(['mooi\\p{L}*', 'prachtig\\p{L}*', 'gaaf', 'gave', 'vet', 'vette', 'cool\\p{L}*', 'geweldig\\p{L}*', 'wow+', 'super\\p{L}*', 'nice', 'tof', 'toffe', 'schitterend\\p{L}*', 'machtig\\p{L}*', 'episch\\p{L}*', 'magisch\\p{L}*', 'indrukwekkend\\p{L}*', 'awesome', 'wauw', 'top']),
  },
  { id: 'negative', re: words(['saai', 'stom', 'haat', 'slecht', 'boring', 'irritant', 'moeilijk', 'lastig']) },
];

/** Only emoji / symbols, no letters. */
const EMOJI_ONLY = /^[\s\p{Extended_Pictographic}\p{Emoji_Component}‍️!?.]+$/u;

export function detectIntents(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (EMOJI_ONLY.test(t) && /\p{Extended_Pictographic}/u.test(t)) return ['emoji'];
  const hits = INTENTS.filter((i) => i.re.test(t)).map((i) => i.id);
  if (!hits.length && /\?\s*$/.test(t)) hits.push('question');
  return hits;
}

// ------------------------------------------------------------------ knowledge
/** Places the player can ask directions to (first match wins). */
const PLACES = [
  ['lookout', /uitkijk\p{L}*|toren/iu],
  ['ruins', /ru[iï]ne\p{L}*|inscriptie|runen\p{L}*/iu],
  ['signal', /signaal|baken|obelisk/iu],
  ['waterfall', /waterval\p{L}*/iu],
  ['base', /basis|thuis|bouwplaats|glazen huis/iu],
  ['plaza', /plein|nexus|levensboom|bazaar|nachtmarkt|marktterminal/iu],
  ['spaceport', /ruimtehaven|haven|lanceerplatform\p{L}*|hangar/iu],
  ['city', /aurora|stad/iu],
  ['spawn', /uitzichtpunt/iu],
];
const PLACE_NAME = {
  lookout: 'De uitkijkpost',
  ruins: 'De oude ruïnes',
  signal: 'Het signaal',
  waterfall: 'De waterval',
  base: 'Je basis',
  plaza: 'Het Nexus-plein',
  spaceport: 'De ruimtehaven',
  city: 'Aurora-stad',
  spawn: 'Het uitzichtpunt',
};
export function placeIn(text) {
  for (const [id, re] of PLACES) if (re.test(text || '')) return id;
  return null;
}

const COMPASS = ['het noorden', 'het noordoosten', 'het oosten', 'het zuidoosten', 'het zuiden', 'het zuidwesten', 'het westen', 'het noordwesten'];
/** "ongeveer 1,2 km naar het noordwesten" from the player position to a zone. */
function directions(pos, id) {
  const z = ZONES[id];
  if (!z || !pos) return null;
  const dx = z.x - pos.x;
  const dz = z.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 40) return 'vlakbij — je bent er bijna';
  const bearing = (Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2); // 0 = north, clockwise
  return `ongeveer ${fmtDist(d)} naar ${COMPASS[Math.round(bearing / (Math.PI / 4)) % 8]}`;
}

/** Who is who (third person), how each describes themselves and where they usually are. */
const PEOPLE = {
  aria: { name: 'Aria', home: 'signal', re: /aria/iu, about: 'Aria onderzoekt het signaal bij het baken aan het meer. Als iemand de Stichters begrijpt, is zij het.', self: 'Dat ben ik. Ik luister al jaren naar het signaal — drie korte pulsen, één lange stilte.' },
  oran: { name: 'Oran', home: 'plaza', re: /oran/iu, about: 'Oran is de oude handelaar in de bazaar. Hij weet álles, vooral geruchten over verloren schepen.', self: 'Ha! Dat ben ik, vriend. Handelaar, verteller en verzamelaar van geruchten.' },
  luna: { name: 'Luna', home: 'plaza', re: /luna/iu, about: 'Luna is de gids van het Nexus-plein. Ze kent iedereen, en iedereen kent haar.', self: 'Dat ben ik! 😄 Gids van het plein en altijd in voor een nieuwe missie.' },
  kai: { name: 'Kai', home: 'plaza', re: /(?:^|[^\p{L}])kai(?=$|[^\p{L}])/iu, about: 'Kai bouwt alles wat je kunt bedenken. Vraag hem gerust om bouwtips.', self: 'Ik! Bouwer, sleutelaar en dakenexpert. 😅' },
  nova: { name: 'Nova', home: 'plaza', re: /nova/iu, about: 'Nova is piloot. Ze vliegt liever dan dat ze loopt.', self: 'Ik ben het, je favoriete piloot ✨' },
  yara: { name: 'Yara', home: 'plaza', re: /yara/iu, about: 'Yara maakt muziek. Vanavond speelt ze op het Starfall Festival!', self: 'Dat ben ik! Muzikant, en vanavond op het podium 🎶' },
  milan: { name: 'Milan', home: 'plaza', re: /milan/iu, about: 'Milan is ontdekkingsreiziger. Hij heeft alle vijf de watervallen gezien.', self: 'Ik! Altijd onderweg naar de volgende horizon.' },
  jules: { name: 'Jules', home: 'spaceport', re: /jules/iu, about: 'Jules is vluchttechnicus in de ruimtehaven. Hij kent elke bout van je schip.', self: 'Jules, vluchttechnicus. Aangenaam! Je schip staat klaar.' },
};
const personIn = (text) => Object.keys(PEOPLE).find((id) => PEOPLE[id].re.test(text || '')) || null;

/** World sub-topics: the first matching topic answers. */
const WORLD = [
  [/signaal|baken|obelisk|aria/iu, ['Het signaal komt van het baken aan het meer: drie korte pulsen, één lange stilte. Aria weet er alles van.', 'Sommigen zeggen dat het signaal een hartslag is. Van de wereld zelf.']],
  [/ru[iï]ne|inscriptie|stichters|runen/iu, ['De oude ruïnes zijn ouder dan Aurora-stad. Scan de inscriptie maar eens: houd [E] ingedrukt.', 'De Stichters bouwden die ruïnes. Niemand weet waar ze gebleven zijn.']],
  [/ø|symbool/iu, ['Het Ø-symbool staat overal: op de ruïnes, op het baken, op onze jassen. Een cirkel die nooit gesloten is.', 'Een cirkel met één lijn erdoor — een einde dat ook een begin is.']],
  [/levensboom|boom/iu, ['De Levensboom gloeit ’s nachts paars. Sommigen zeggen dat ze zingt.', 'Onder de Levensboom komt iedereen samen. Zeker tijdens het festival.']],
  [/planeet|maan|manen|ringen/iu, ['Die reusachtige planeet aan de hemel heeft twee manen. Bij helder weer zie je zelfs haar ringen.', 'Ten noorden van de planeet liggen de Noordelijke Ringen. Vraag Oran maar eens naar het verloren schip…']],
  [/aurora|stad/iu, ['Aurora-stad ligt aan de overkant van het meer. Die torens vangen het laatste zonlicht.', 'Vanaf de uitkijkpost zie je Aurora-stad het mooist.']],
  [/waterval/iu, ['Er zijn vijf watervallen rond het meer. De grootste ligt in het noordwesten.', 'Ga bij zonsondergang naar de waterval: dan hangt er goud in de nevel.']],
  [/lucht|hemel|paars/iu, ['De atmosfeer kleurt violet als de zon zakt. Daarboven zie je de planeet en haar twee manen.', 'Die paarse gloed? Stof uit de ringen, zegt Aria. ’s Nachts wordt het nog mooier.']],
  [/eiland|zwevend/iu, ['De zwevende eilanden hangen al eeuwen boven het meer. Uit sommige stroomt een waterval de diepte in.', 'Met de VTOL kun je bij de zwevende eilanden komen. Landen is een ander verhaal…']],
  [/(?:^|[^\p{L}])meer(?=$|[^\p{L}])/iu, ['Het meer ligt tussen het uitzichtpunt en Aurora-stad. Bij windstil weer weerspiegelt het de hele stad.', 'Op de eilanden in het meer groeien de oudste bomen van de wereld.']],
  [/jungle|lumen/iu, ['De Lumen-jungle ligt op het westelijke plateau. ’s Nachts licht daar alles op — planten, rivier, alles.', 'Milan zegt dat er in de Lumen-jungle soorten leven die nog niemand heeft gescand.']],
  [/kloof|canyon/iu, ['De Zonnekloof in het oosten: rode rotsen, bogen en een circuit voor hoverbikes. Ooit rijden we daar een race!']],
];

/** Emoji answers mirror what was sent. */
const EMOJI_REPLY = [
  [/🚀/u, ['🚀🚀', 'Gaan! 🚀']],
  [/✨|⭐|🌟|💫/u, ['✨✨', '✨']],
  [/👋/u, ['👋', 'Hoi! 👋']],
  [/💜|❤|♥|🥰|😍/u, ['💜', '💜✨']],
  [/😂|🤣|😄|😁|😆|😅/u, ['😄', 'Haha 😆']],
  [/🎶|🎵|🎸|🎤/u, ['🎶', '🎶✨']],
  [/🙌|👏|👍/u, ['🙌', '👏👏']],
  [/😢|😭|😞/u, ['Aww 🫂', '💜']],
];

/** Extra search keys for catalog items (besides their name). */
const ITEM_KEYS = {
  'skin-car-sunset': ['sunset'],
  'skin-car-aurora': ['aurora-lak', 'aurora lak'],
  'skin-ship-gold': ['gouden romp', 'goud'],
  'power-fusion': ['fusie', 'reactor'],
  'decor-neon-tree': ['neonboom', 'neon'],
  'decor-statue': ['standbeeld', 'beeld'],
  'outfit-nomad': ['nomade', 'poncho'],
  'outfit-vanguard': ['vanguard', 'pantser'],
  'outfit-drifter': ['drifter', 'jas'],
};
/** Dutch grammar per item: 'het'-words and plurals. */
const NEUTER = new Set(['decor-statue', 'outfit-vanguard']);
const PLURAL = new Set(['res-stone-100']);
function itemIn(text) {
  const t = String(text || '').toLowerCase();
  return ITEMS.find((it) => t.includes(it.name.toLowerCase()) || (ITEM_KEYS[it.id] || []).some((k) => t.includes(k))) || null;
}

// ------------------------------------------------------------------ choosing
/** Most informative intent first (questions about missions beat a greeting). */
const PRIORITY = ['name', 'who', 'mission', 'help', 'party', 'festival', 'meteor', 'build', 'space', 'vehicle', 'market', 'world', 'where', 'howareyou', 'negative', 'thanks', 'time', 'compliment', 'bye', 'greet', 'emoji', 'question'];

/**
 * Picks the intent to answer. Directions win when a known place or person is
 * named ("Hoe kom ik bij de waterval?", "Waar is Aria?"), "who" only when a
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

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Speaker personalities: optional per-intent lines. */
const VOICES = {
  luna: {
    greet: ['Hoi {player}! 👋', 'Heeey! Fijn dat je er bent ✨', 'Hoi hoi! Ben je ook op het plein?'],
    default: ['Haha, echt? 😄', 'Zullen we samen iets gaan doen?', 'Ik vind het hier zo gezellig vandaag!'],
    compliment: ['Toch?! Ik krijg er nooit genoeg van ✨', 'Echt hè, vooral als de boom oplicht 💜'],
  },
  kai: {
    greet: ['Jo! 🙌', 'Yo {player}, alles goed?', 'Hé hé! Klaar om te bouwen?'],
    default: ['Ja, ik ben erbij!', 'Klinkt goed, man.', 'Haha, zeker weten.'],
    compliment: ['Vet hè? Wacht maar tot je basis af is.', 'Echt top. 🙌'],
  },
  nova: {
    greet: ['Hoi! ✨', 'Hé {player}! Mooie {dagdeel}, hè?', 'Hallo daar, piloot!'],
    default: ['Deze plek is prachtig ✨', 'Ik zit eigenlijk liever in de lucht, haha.', 'Mee eens!'],
    compliment: ['Wacht tot je het van driehonderd meter hoogte ziet ✨', 'Prachtig, toch?'],
  },
  aria: {
    greet: ['Hallo, {player}.', 'Daar ben je. Het signaal is rustig vandaag.', 'Hé. Goed je te horen.'],
    default: ['Interessant…', 'Ik denk dat de Stichters dat ook dachten.', 'Laten we verder kijken.'],
    compliment: ['Ja. Soms vergeet ik hoe mooi het hier is.', 'Het Ø-symbool past hier, vind je niet?'],
  },
  oran: {
    greet: ['Ah, reiziger! Welkom.', 'Goedendag, vriend!', 'Hallo! Kom gerust eens langs in de bazaar.'],
    default: ['Hm-hm, dat zei mijn grootvader ook al.', 'Ha! Je bent een slimme, jij.', 'Alles heeft zijn prijs, vriend.'],
  },
  yara: { greet: ['Hoi! 🎶', 'Heey {player}!'], default: ['Dit klinkt als een liedje, haha 🎶', 'Zeker!'] },
  milan: { greet: ['Hé, avonturier!', 'Hoi {player}!'], default: ['Daar wil ik ooit heen.', 'Heb je de watervallen al gezien?'] },
  jules: { greet: ['Hé, piloot!', 'Hallo {player}! Alles groen hier.'], default: ['Begrepen.', 'Ik check het even in de systemen.'] },
};

/**
 * Builds a reply. `c` = { speaker, player, text, pos {x, z}, zone, zoneLabel, at ('op het Nexus-plein'),
 *   night, dagdeel, clock ('21:40'), quest, objective, partyIds, partyNames, partySize, festival, meteors, nearPlaza }.
 * Templates may contain {player}, {at}, {zone}, {dagdeel} and {speakerName}.
 */
export function replyFor(intent, c) {
  const v = VOICES[c.speaker] || {};
  const q = c.quest;
  const text = c.text || '';
  const L1 = (arr) => pick(arr);
  switch (intent) {
    case 'greet':
      return L1(v.greet || ['Hoi {player}! 👋', 'Hé! Goed je te zien.', 'Hallo! Mooie {dagdeel}, hè?', c.at ? 'Yo! Ben jij ook {at}?' : 'Hoi!']);
    case 'bye':
      return L1(['Doei! Tot snel 👋', 'Tot later!', 'Fijne reis, {player}!', 'Pas goed op jezelf daarbuiten.']);
    case 'thanks':
      return L1(['Graag gedaan! 😊', 'Geen probleem!', 'Altijd!', 'Daar zijn we voor.']);
    case 'howareyou':
      return L1(
        c.festival
          ? ['Super, het festival is begonnen! En jij?', 'Geweldig, hoor je die muziek? 🎶']
          : ['Goed! Ik geniet van het uitzicht. En jij?', 'Prima, beetje aan het verkennen.', c.speaker === 'kai' ? 'Druk met bouwen, man!' : 'Goed hoor! Lekker rustig vandaag.'],
      );
    case 'name': {
      const me = PEOPLE[c.speaker];
      return me ? me.self : L1(['Ik ben {speakerName}. Aangenaam, {player}!', 'Noem me maar {speakerName}. En jij bent {player}, toch?']);
    }
    case 'who': {
      const id = personIn(text);
      if (!id) return L1(['Geen idee wie dat is. Vraag het Luna, zij kent iedereen.']);
      return id === c.speaker ? PEOPLE[id].self : PEOPLE[id].about;
    }
    case 'mission':
      if (q && c.objective)
        return L1([
          `Jouw missie is "${q.title}", toch? Volgende stap: ${lower(c.objective)}.`,
          `"${c.objective}" — dat is je volgende stap. Volg de cyaan markering!`,
          `Je volgende doel: ${lower(c.objective)}. Kijk in je journaal [J] als je het kwijt bent.`,
        ]);
      return L1(['Open je journaal met [J], daar staan al je missies.', 'Praat eens met Aria bij het signaal — zij weet altijd wat er moet gebeuren.']);
    case 'help':
      return L1([
        '[J] voor je missies, [M] voor de kaart, [K] voor de marktplaats en [E] voor interactie.',
        'Houd [E] ingedrukt om te scannen of te oogsten. Met [B] open je de bouwmodus.',
        'Met [G] roep je een voertuig op. In de VTOL stijg je met [Spatie] en daal je met [C].',
      ]);
    case 'build':
      return L1([
        'Bouwen doe je met [B]: eerst een fundering, dan muren, een dak en energie.',
        'Je basis ligt in het bos ten zuidwesten van het uitzichtpunt. Daar is ruimte genoeg!',
        'Tip: in de marktplaats [K] vind je blauwdrukken voor neonbomen en standbeelden.',
      ]);
    case 'space':
      return L1([
        'Ga naar de ruimtehaven, stap in je schip met [F] en druk op [L] om te lanceren. 🚀',
        'Station Halo is echt gigantisch. Pas wel op voor piraten in het asteroïdenveld!',
        'In de ruimte scan je met [E]. Er hangt daar ergens een vreemde anomalie…',
      ]);
    case 'vehicle':
      return L1(['Met [G] open je je garage: auto, VTOL of ruimteschip.', 'De VTOL is het leukst — [Spatie] stijgen, [C] dalen.', 'In de auto geeft [Shift] een boost. Rijd wel over de wegen, dat gaat sneller.']);
    case 'market': {
      const it = itemIn(text);
      if (it) {
        const price = `${fmt(it.price)} Ø-credits`;
        const art = NEUTER.has(it.id) ? 'Het' : 'De';
        const verb = PLURAL.has(it.id) ? 'kosten' : 'kost';
        const pron = NEUTER.has(it.id) ? 'het' : PLURAL.has(it.id) ? 'ze' : 'hem';
        return c.speaker === 'oran'
          ? `${art} ${it.name}? ${price}, vriend — en dat is een eerlijke prijs. Kijk maar in de marktplaats [K].`
          : `${art} ${it.name} ${verb} ${price}. Je vindt ${pron} in de marktplaats [K] of bij de terminal naast de Levensboom.`;
      }
      return L1([
        'De marktterminal staat naast de Levensboom op het Nexus-plein. Of druk gewoon op [K].',
        'Oran in de bazaar betaalt goed voor metaal!',
        c.speaker === 'oran' ? 'Voor jou heb ik altijd een eerlijke prijs, vriend.' : 'Die Aurora-lak voor de auto… ik spaar ervoor!',
      ]);
    }
    case 'festival':
      if (c.festival) return L1(['Het Starfall Festival is nu bezig! Kom naar het podium! 🎶', 'Wat een lichtshow! ✨', 'Kom naar het podium!']);
      return c.night
        ? L1(['Het festival kan elk moment beginnen — kom naar het Nexus-plein!', 'Vannacht is er weer het Starfall Festival. Ik ben erbij!'])
        : L1(['Het Starfall Festival is elke nacht op het Nexus-plein. Kom vanavond!', 'Zodra de zon onder is, begint het festival. 🎶']);
    case 'party':
      if (c.partySize) return L1([`We zijn al met ${c.partySize + 1}! Gezellig.`, `Ik zie ${c.partyNames} al bij je. Nice!`]);
      return L1(['Praat even met me, dan sluit ik me aan!', 'Leuk! Kom naar me toe en vraag het me.']);
    case 'meteor':
      return c.meteors
        ? L1(['Ze vallen nu! Kijk omhoog! ☄️', 'Volg de oranje gloed — daar liggen fragmenten vol metaal.'])
        : L1(['Meteorenregens zijn er alleen ’s nachts. Houd de lucht in de gaten!', 'De fragmenten zitten vol energie. Houd [E] ingedrukt om te oogsten.']);
    case 'world': {
      const topic = WORLD.find(([re]) => re.test(text));
      return L1(topic ? topic[1] : WORLD.map((w) => w[1][0]));
    }
    case 'where': {
      const pid = personIn(text);
      if (pid) {
        const pp = PEOPLE[pid];
        if (c.partyIds?.includes(pid)) return pid === c.speaker ? 'Ik loop vlak achter je! 😄' : `${pp.name} loopt met je mee!`;
        const dir = directions(c.pos, pp.home);
        const at = zoneAtText(pp.home);
        return pid === c.speaker ? `Ik ben ${at}${dir ? ` — ${dir}` : ''}.` : `${pp.name} is meestal ${at}${dir ? `, ${dir}` : ''}.`;
      }
      const place = placeIn(text);
      const dir = place && directions(c.pos, place);
      if (dir) return `${PLACE_NAME[place]}? Dat is ${dir}. Open de kaart met [M] om snel te reizen.`;
      return c.at ? `Je bent nu ${c.at}. Open de kaart met [M] om snel te reizen.` : 'Open de kaart met [M], daar zie je alle locaties en kun je snel reizen.';
    }
    case 'time': {
      const t = c.clock ? `Het is ${c.clock}. ` : '';
      if (c.night) return t + L1(['Nacht dus — kijk naar de sterren! Soms vallen er meteoren.', 'Mooie nacht, hè? Het plein licht helemaal op.']);
      if (c.dagdeel === 'avond') return t + L1(['De zon gaat zo onder, dan wordt het pas echt mooi.', 'Gouden uurtje! Perfect voor een foto bij de waterval.']);
      if (c.dagdeel === 'ochtend') return t + L1(['Nog vroeg! De nevel hangt nog boven het meer.', 'Ochtend — het licht is nu zacht en helder.']);
      return t + L1(['Midden op de dag. Vanavond is er weer het Starfall Festival!', 'Nog een paar uur tot zonsondergang.']);
    }
    case 'compliment':
      return L1(v.compliment || ['Toch? Ik krijg er nooit genoeg van. ✨', c.at ? 'Echt hè! Ik kom graag {at}.' : 'Helemaal mee eens! 😄', 'Zeker! 🙌']);
    case 'negative':
      return L1(['Ah, balen. Probeer eens de VTOL, dat maakt alles beter. 😉', 'Verdwaald? Open de kaart met [M] — je kunt snel reizen.', 'Hé, kop op! Kom naar het plein, dan doen we samen iets.']);
    case 'emoji': {
      const m = EMOJI_REPLY.find(([re]) => re.test(text));
      return L1(m ? m[1] : ['😄', '✨', '🙌', '👋', '💜']);
    }
    case 'question':
      return L1(['Goede vraag! Misschien weet Aria het — of kijk in je journaal [J].', 'Hmm, geen idee eigenlijk. Vraag het Oran, die weet alles.', 'Dat vraag ik me ook af!']);
    default:
      return L1(v.default || ['Haha, zeker! 😄', 'Echt? Vertel!', 'Klinkt goed!', 'Mee eens.', 'Leuk dat je er bent, {player}!']);
  }
}
