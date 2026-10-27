/**
 * Lore entries ("Stories" tab in the journal). Unlocked by discoveries,
 * dialogue choices, scans and signal echoes. Keys are stable ids stored in
 * state.systems.lore. Texts are bilingual ({en, nl}); `LORE[id].title`, `.tag`
 * and `.text` are getters that return the active language.
 */
import { t } from '../../core/i18n.js';

const DATA = {
  world: {
    title: 'Ø Universe',
    tag: { en: 'World', nl: 'Wereld' },
    text: {
      en: 'An endless, living world where technology, creativity and people come together. Nobody knows exactly who built it — only that the Ø symbol turns up everywhere.',
      nl: 'Een eindeloze, levende wereld waar technologie, creativiteit en mensen samenkomen. Niemand weet precies wie haar heeft gebouwd — alleen dat het Ø-symbool overal terugkeert.',
    },
  },
  signal: {
    title: { en: 'The Signal', nl: 'Het signaal' },
    tag: { en: 'Discovery', nl: 'Ontdekking' },
    text: {
      en: 'On the shore of the lake stands a dark crystal obelisk. For centuries it has sent out the same rhythm: three short pulses, one long silence. Aria calls it "the heartbeat of the world".',
      nl: 'Aan de oever van het meer staat een donkere obelisk van kristal. Al eeuwen zendt hij hetzelfde ritme uit: drie korte pulsen, één lange stilte. Aria noemt het "de hartslag van de wereld".',
    },
  },
  symbol: {
    title: { en: 'The Ø Symbol', nl: 'Het Ø-symbool' },
    tag: 'Aria',
    text: {
      en: 'A circle, crossed by a single line that reaches beyond the circle itself. An ending that is also a beginning. The oldest maps show the symbol in places where cities once stood.',
      nl: 'Een cirkel, doorkruist door één lijn die verder reikt dan de cirkel zelf. Een einde dat ook een begin is. De oudste kaarten tonen het symbool op plekken waar ooit steden stonden.',
    },
  },
  founders: {
    title: { en: 'The Founders', nl: 'De Stichters' },
    tag: 'Aria',
    text: {
      en: 'Long before Aurora City existed, the Founders built the ruins in the east. They left no names behind, only their signal — and the promise that someone would answer it one day.',
      nl: 'Lang voordat Aurora-stad bestond, bouwden de Stichters de ruïnes in het oosten. Ze lieten geen namen achter, alleen hun signaal — en de belofte dat iemand het ooit zou beantwoorden.',
    },
  },
  inscription: {
    title: { en: 'The Inscription', nl: 'De inscriptie' },
    tag: { en: 'Ancient Ruins', nl: 'Oude ruïnes' },
    text: {
      en: '"Whoever follows the circle returns to the beginning. Whoever breaks it finds the stars." — translation of the inscription scanned in the Ancient Ruins.',
      nl: '"Wie de cirkel volgt, keert terug naar het begin. Wie hem doorbreekt, vindt de sterren." — vertaling van de gescande inscriptie in de oude ruïnes.',
    },
  },
  runes: {
    title: { en: 'The Rune Stones', nl: 'De runenstenen' },
    tag: { en: 'Ancient Ruins', nl: 'Oude ruïnes' },
    text: {
      en: 'Around the ruins stand stones bearing the same four signs: a circle, a line, a star and a wave. Together they form a map of the sky above the lake — with the Ø symbol exactly where the Signal stands.',
      nl: 'Rond de ruïnes staan stenen met dezelfde vier tekens: een cirkel, een lijn, een ster en een golf. Samen vormen ze een kaart van de hemel boven het meer — met het Ø-symbool precies op de plek van het signaal.',
    },
  },
  lostship: {
    title: { en: 'The Silver Horizon', nl: 'De Zilveren Horizon' },
    tag: 'Oran',
    text: {
      en: 'Forty years ago the colony ship Silver Horizon left for Kepler-Ø 7 with two thousand colonists on board. It never arrived. Its last message came from the Northern Rings.',
      nl: 'Veertig jaar geleden vertrok het kolonieschip Zilveren Horizon met tweeduizend kolonisten naar Kepler-Ø 7. Het kwam nooit aan. Het laatste bericht kwam uit de Noordelijke Ringen.',
    },
  },
  rings: {
    title: { en: 'The Northern Rings', nl: 'De Noordelijke Ringen' },
    tag: 'Oran',
    text: {
      en: 'A belt of ice and rock to the north of the planet. Navigation systems lose their way there, and old pilots swear you can sometimes hear music.',
      nl: 'Een gordel van ijs en gesteente ten noorden van de planeet. Navigatiesystemen raken er de weg kwijt, en oude piloten zweren dat je er soms muziek hoort.',
    },
  },
  festival: {
    title: 'Starfall Festival',
    tag: { en: 'Event', nl: 'Evenement' },
    text: {
      en: 'The first colonists celebrated the night the stars seemed to fall here. Ever since, everyone gathers under the Tree of Life as soon as the meteors appear.',
      nl: 'De eerste kolonisten vierden hier de nacht waarin de sterren leken te vallen. Sindsdien komt iedereen samen onder de Levensboom zodra de meteoren verschijnen.',
    },
  },
  halo: {
    title: 'Station Halo',
    tag: { en: 'Space', nl: 'Ruimte' },
    text: {
      en: 'A ring-shaped station high above the planet: port, trading post and home to thousands. Whoever docks there is greeted with "Welcome home, traveler".',
      nl: 'Een ringvormig station hoog boven de planeet: haven, handelspost en thuis voor duizenden. Wie er aanmeert, wordt begroet met "Welkom thuis, reiziger".',
    },
  },
  aurora: {
    title: { en: 'Aurora City', nl: 'Aurora-stad' },
    tag: { en: 'Location', nl: 'Locatie' },
    text: {
      en: 'The city of spires across the lake. Its needle towers catch the last of the sunlight and hold on to it until deep into the night.',
      nl: 'De torenstad aan de overkant van het meer. Haar naaldtorens vangen het laatste zonlicht en houden het vast tot diep in de nacht.',
    },
  },
  lookout: {
    title: { en: 'The Lookout', nl: 'De uitkijkpost' },
    tag: { en: 'Location', nl: 'Locatie' },
    text: {
      en: 'A rusty tower of steel and wood on the highest peak of the western hills. The first colonists searched for a landing site from here — and saw the lake, the waterfalls and, far in the distance, the light of the beacon.',
      nl: 'Een roestige toren van staal en hout op de hoogste top van de westelijke heuvels. De eerste kolonisten zochten hier naar een plek om te landen — en zagen het meer, de watervallen en, heel in de verte, het licht van het baken.',
    },
  },
  waterfall: {
    title: { en: 'The Five Waterfalls', nl: 'De vijf watervallen' },
    tag: { en: 'Location', nl: 'Locatie' },
    text: {
      en: 'Five waterfalls plunge from the cliffs into the lake. The largest is fed by the western river; at sunset there is gold in the mist, and the droplets catch the light of the planet.',
      nl: 'Vijf watervallen storten zich van de kliffen in het meer. De grootste wordt gevoed door de westelijke rivier; bij zonsondergang hangt er goud in de nevel en vangen de druppels het licht van de planeet.',
    },
  },
  plaza: {
    title: { en: 'The Tree of Life', nl: 'De Levensboom' },
    tag: { en: 'Nexus Plaza', nl: 'Nexus-plein' },
    text: {
      en: 'Nobody planted the Tree of Life: it was already standing when the plaza was laid out. Its leaves glow violet as soon as it gets dark, and whoever stands beneath its branches sometimes hears a soft hum — in the rhythm of the signal.',
      nl: 'Niemand plantte de Levensboom: hij stond er al toen het plein werd aangelegd. Zijn bladeren gloeien violet zodra het donker wordt, en wie onder zijn takken staat, hoort soms een zacht gezoem — op het ritme van het signaal.',
    },
  },
  spaceport: {
    title: { en: 'The Spaceport', nl: 'De ruimtehaven' },
    tag: { en: 'Location', nl: 'Locatie' },
    text: {
      en: 'Ships leave the launch pads for Station Halo. In the gigantic hangar lies the colony ship that will one day fly to Kepler-Ø 7 — if the pirates in the asteroid field allow it.',
      nl: 'Vanaf de platforms vertrekken de schepen naar Station Halo. In de reusachtige hangar ligt het kolonieschip dat ooit naar Kepler-Ø 7 zal vliegen — als de piraten in het asteroïdenveld het toelaten.',
    },
  },
  base: {
    title: { en: 'Your Base', nl: 'Jouw basis' },
    tag: { en: 'Location', nl: 'Locatie' },
    text: {
      en: 'A clearing in the pine forest, with a glass house that was waiting for you. What you build here stays standing: walls, roofs, lights — a home on the edge of an unknown world.',
      nl: 'Een open plek in het pijnbos, met een glazen huis dat op je wachtte. Wat je hier bouwt, blijft staan: muren, daken, lichten — een thuis aan de rand van een onbekende wereld.',
    },
  },
  echo1: {
    title: 'Echo 1/5',
    tag: { en: 'Signal Echo', nl: 'Signaal-echo' },
    text: { en: '"…the circle was never closed. We left it open, for those who come after us…"', nl: '"…de cirkel is nooit gesloten geweest. Wij lieten hem open, voor wie na ons komt…"' },
  },
  echo2: {
    title: 'Echo 2/5',
    tag: { en: 'Signal Echo', nl: 'Signaal-echo' },
    text: { en: '"…do not build to own, but to share. What you make, makes you…"', nl: '"…bouw niet om te bezitten, maar om te delen. Wat je maakt, maakt jou…"' },
  },
  echo3: {
    title: 'Echo 3/5',
    tag: { en: 'Signal Echo', nl: 'Signaal-echo' },
    text: { en: '"…the tree of light remembers every voice that ever sang beneath its branches…"', nl: '"…de lichtboom onthoudt iedere stem die onder haar takken heeft gezongen…"' },
  },
  echo4: {
    title: 'Echo 4/5',
    tag: { en: 'Signal Echo', nl: 'Signaal-echo' },
    text: { en: '"…between the rings waits a ship that was never lost — only not yet found…"', nl: '"…tussen de ringen wacht een schip dat nooit verloren was — alleen nog niet gevonden…"' },
  },
  echo5: {
    title: 'Echo 5/5',
    tag: { en: 'Signal Echo', nl: 'Signaal-echo' },
    text: { en: '"…if you hear this, you are home. Welcome, traveler. A brighter tomorrow begins with you."', nl: '"…als je dit hoort, ben je thuis. Welkom, reiziger. Een betere morgen begint bij jou."' },
  },
};

/** id → { id, title, tag, text } (strings in the active language). */
export const LORE = Object.fromEntries(
  Object.entries(DATA).map(([id, e]) => [
    id,
    {
      id,
      get title() {
        return t(e.title);
      },
      get tag() {
        return t(e.tag);
      },
      get text() {
        return t(e.text);
      },
    },
  ]),
);

/** Journal order: the world and its mystery, places, people's stories, space, the echoes. */
const ORDER = ['world', 'signal', 'symbol', 'founders', 'inscription', 'runes', 'lookout', 'waterfall', 'plaza', 'base', 'spaceport', 'aurora', 'festival', 'lostship', 'rings', 'halo'];
export const LORE_ORDER = [...ORDER.filter((id) => LORE[id]), ...Object.keys(LORE).filter((id) => !ORDER.includes(id))];
