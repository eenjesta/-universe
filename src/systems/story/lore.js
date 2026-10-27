/**
 * Lore entries ("Verhalen" tab in the journal). Unlocked by discoveries,
 * dialogue choices, scans and signal echoes. Keys are stable ids stored in
 * state.systems.lore.
 */
export const LORE = {
  world: {
    title: 'Ø Universe',
    tag: 'Wereld',
    text: 'Een eindeloze, levende wereld waar technologie, creativiteit en mensen samenkomen. Niemand weet precies wie haar heeft gebouwd — alleen dat het Ø-symbool overal terugkeert.',
  },
  signal: {
    title: 'Het signaal',
    tag: 'Ontdekking',
    text: 'Aan de oever van het meer staat een donkere obelisk van kristal. Al eeuwen zendt hij hetzelfde ritme uit: drie korte pulsen, één lange stilte. Aria noemt het "de hartslag van de wereld".',
  },
  symbol: {
    title: 'Het Ø-symbool',
    tag: 'Aria',
    text: 'Een cirkel, doorkruist door één lijn die verder reikt dan de cirkel zelf. Een einde dat ook een begin is. De oudste kaarten tonen het symbool op plekken waar ooit steden stonden.',
  },
  founders: {
    title: 'De Stichters',
    tag: 'Aria',
    text: 'Lang voordat Aurora-stad bestond, bouwden de Stichters de ruïnes in het oosten. Ze lieten geen namen achter, alleen hun signaal — en de belofte dat iemand het ooit zou beantwoorden.',
  },
  inscription: {
    title: 'De inscriptie',
    tag: 'Oude ruïnes',
    text: '"Wie de cirkel volgt, keert terug naar het begin. Wie hem doorbreekt, vindt de sterren." — vertaling van de gescande inscriptie in de oude ruïnes.',
  },
  runes: {
    title: 'De runenstenen',
    tag: 'Oude ruïnes',
    text: 'Rond de ruïnes staan stenen met dezelfde vier tekens: een cirkel, een lijn, een ster en een golf. Samen vormen ze een kaart van de hemel boven het meer — met het Ø-symbool precies op de plek van het signaal.',
  },
  lostship: {
    title: 'De Zilveren Horizon',
    tag: 'Oran',
    text: 'Veertig jaar geleden vertrok het kolonieschip Zilveren Horizon met tweeduizend kolonisten naar Kepler-Ø 7. Het kwam nooit aan. Het laatste bericht kwam uit de Noordelijke Ringen.',
  },
  rings: {
    title: 'De Noordelijke Ringen',
    tag: 'Oran',
    text: 'Een gordel van ijs en gesteente ten noorden van de planeet. Navigatiesystemen raken er de weg kwijt, en oude piloten zweren dat je er soms muziek hoort.',
  },
  festival: {
    title: 'Starfall Festival',
    tag: 'Evenement',
    text: 'De eerste kolonisten vierden hier de nacht waarin de sterren leken te vallen. Sindsdien komt iedereen samen onder de Levensboom zodra de meteoren verschijnen.',
  },
  halo: {
    title: 'Station Halo',
    tag: 'Ruimte',
    text: 'Een ringvormig station hoog boven de planeet: haven, handelspost en thuis voor duizenden. Wie er aanmeert, wordt begroet met "Welkom thuis, reiziger".',
  },
  aurora: {
    title: 'Aurora-stad',
    tag: 'Locatie',
    text: 'De torenstad aan de overkant van het meer. Haar naaldtorens vangen het laatste zonlicht en houden het vast tot diep in de nacht.',
  },
  lookout: {
    title: 'De uitkijkpost',
    tag: 'Locatie',
    text: 'Een roestige toren van staal en hout op de hoogste top van de westelijke heuvels. De eerste kolonisten zochten hier naar een plek om te landen — en zagen het meer, de watervallen en, heel in de verte, het licht van het baken.',
  },
  waterfall: {
    title: 'De vijf watervallen',
    tag: 'Locatie',
    text: 'Vijf watervallen storten zich van de kliffen in het meer. De grootste wordt gevoed door de westelijke rivier; bij zonsondergang hangt er goud in de nevel en vangen de druppels het licht van de planeet.',
  },
  plaza: {
    title: 'De Levensboom',
    tag: 'Nexus-plein',
    text: 'Niemand plantte de Levensboom: hij stond er al toen het plein werd aangelegd. Zijn bladeren gloeien violet zodra het donker wordt, en wie onder zijn takken staat, hoort soms een zacht gezoem — op het ritme van het signaal.',
  },
  spaceport: {
    title: 'De ruimtehaven',
    tag: 'Locatie',
    text: 'Vanaf de platforms vertrekken de schepen naar Station Halo. In de reusachtige hangar ligt het kolonieschip dat ooit naar Kepler-Ø 7 zal vliegen — als de piraten in het asteroïdenveld het toelaten.',
  },
  base: {
    title: 'Jouw basis',
    tag: 'Locatie',
    text: 'Een open plek in het pijnbos, met een glazen huis dat op je wachtte. Wat je hier bouwt, blijft staan: muren, daken, lichten — een thuis aan de rand van een onbekende wereld.',
  },
  echo1: { title: 'Echo 1/5', tag: 'Signaal-echo', text: '"…de cirkel is nooit gesloten geweest. Wij lieten hem open, voor wie na ons komt…"' },
  echo2: { title: 'Echo 2/5', tag: 'Signaal-echo', text: '"…bouw niet om te bezitten, maar om te delen. Wat je maakt, maakt jou…"' },
  echo3: { title: 'Echo 3/5', tag: 'Signaal-echo', text: '"…de lichtboom onthoudt iedere stem die onder haar takken heeft gezongen…"' },
  echo4: { title: 'Echo 4/5', tag: 'Signaal-echo', text: '"…tussen de ringen wacht een schip dat nooit verloren was — alleen nog niet gevonden…"' },
  echo5: { title: 'Echo 5/5', tag: 'Signaal-echo', text: '"…als je dit hoort, ben je thuis. Welkom, reiziger. Een betere morgen begint bij jou."' },
};

/** Journal order: the world and its mystery, places, people's stories, space, the echoes. */
const ORDER = ['world', 'signal', 'symbol', 'founders', 'inscription', 'runes', 'lookout', 'waterfall', 'plaza', 'base', 'spaceport', 'aurora', 'festival', 'lostship', 'rings', 'halo'];
export const LORE_ORDER = [...ORDER.filter((id) => LORE[id]), ...Object.keys(LORE).filter((id) => !ORDER.includes(id))];
