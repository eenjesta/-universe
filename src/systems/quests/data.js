/**
 * Quest definitions (bilingual: text is resolved with t() when the quests are
 * built at install, so titles / objectives / marker labels stay plain strings
 * for the engine, tracker, journal and other modules). Main chain:
 *   horizon → signal → community → firstflight → asteroid → halo → colony
 * plus side quests (ruins, home, collector, highabove, nightmarket, lostship)
 * and repeatable event quests (starfall, meteorshower, echo).
 * Predicates null-check every cross-module API (modules may be missing).
 */
import { ZONES } from '../../world/layout.js';
import { t } from '../../core/i18n.js';
import { playerPos, isNight, groundY } from '../shared/util.js';

const str = (v) => (typeof v === 'string' ? v : v?.id || v?.name || v?.label || v?.category || '');
const pieceText = (p) => `${str(p?.category)} ${str(p?.piece)} ${str(p?.type)}`;
const pieceIs = (re) => (p) => re.test(pieceText(p));
// build:placed {category, piece}: loose matching on ids / Dutch names (STRUCTUUR/fundering …)
export const isWall = pieceIs(/wall|muur|wand/i);
export const isRoof = pieceIs(/roof|dak/i);
export const isPower = pieceIs(/power|energ|solar|zonne|fusion|fusie|generator|reactor|accu|battery/i);
// a wall/roof/power piece in the STRUCTURE category is not a foundation
export const isFoundation = (p) => !isWall(p) && !isRoof(p) && !isPower(p) && /struct|found|fundering|fundament|floor|vloer|platform/i.test(pieceText(p));

const convoyOK = (p) => /safe|veilig|defend|verdedigd|complete|success|done|arriv|won|secure/i.test(String(p?.status ?? p?.state ?? ''));

/** Position of a named target in the space scene (station, anomaly, convoy, wreck), if the space module exposes it. */
export const spaceTarget = (kind) => (ctx) => {
  const s = ctx.space;
  if (!s) return null;
  const c = s[kind] ?? s.targets?.[kind] ?? s.entities?.[kind] ?? s.objects?.[kind];
  const pos = c?.isVector3 ? c : c?.position || c?.object?.position || c?.group?.position || null;
  return pos?.isVector3 ? pos : null;
};

function shipPosition(ctx) {
  const s = ctx.space;
  const p = s?.ship?.position || s?.ship?.object?.position || s?.player?.position || null;
  return p?.isVector3 ? p : null;
}

const nearStation = (dist) => (ctx) => {
  if (!ctx.modes?.is('space')) return false;
  const st = spaceTarget('station')(ctx);
  const ship = shipPosition(ctx);
  if (!st || !ship) return false;
  const r = ctx.space?.station?.radius || ctx.space?.station?.dockRadius || 0;
  return ship.distanceTo(st) < Math.max(dist, r * 3);
};

const vtolAbove = (h) => (ctx) => {
  const v = ctx.vehicles?.current;
  if (!v || !/vtol/i.test(v.type || v.id || '')) return false;
  const y = v.object?.position?.y ?? v.position?.y;
  return typeof y === 'number' && y > h;
};

function leftSpaceport(ctx) {
  if (ctx.modes?.is('space')) return true;
  const v = ctx.vehicles?.current;
  if (!v || !/ship/i.test(v.type || v.id || '')) return false;
  const p = v.object?.position || v.position;
  if (!p) return false;
  const r = ZONES.spaceport.rect;
  const far = p.x < r.minX - 120 || p.x > r.maxX + 120 || p.z < r.minZ - 120 || p.z > r.maxZ + 120;
  return far || p.y - groundY(ctx, p.x, p.z) > 140;
}

const nearPoint = (x, z, r) => (ctx) => {
  const p = playerPos(ctx);
  return !!p && Math.hypot(p.x - x, p.z - z) < r;
};

/** Where the flight technician stands when the characters module has no "jules" NPC. */
export const JULES_SPOT = { x: 441, z: 233 };
export const STAGE_FRONT = { x: ZONES.plaza.stage.x, z: ZONES.plaza.stage.z + 24 };

function shipPad(ctx) {
  const ship = ctx.vehicles?.list?.find?.((v) => /ship/i.test(v.type || '') && !/colony/i.test(v.type || ''));
  const p = ship?.object?.position;
  if (p?.isVector3 && ctx.vehicles?.current !== ship) return p;
  const pad = ZONES.spaceport.pads.ship;
  return { x: pad.x, z: pad.z };
}

/**
 * @param refs { ruinsTarget(ctx) → Vector3|null, echoPoint() → Vector3|null }
 */
export function buildQuests(refs) {
  return [
    // ------------------------------------------------------------- main chain
    {
      id: 'horizon',
      type: 'main',
      title: t({ en: 'Explore the Horizon', nl: 'Verken de Horizon' }),
      giver: null,
      location: ZONES.spawn.label,
      summary: t({
        en: 'Ever since you arrived, a strange signal has been humming through the air. Explore your surroundings: climb the Lookout, investigate the Ancient Ruins and find the source of the signal.',
        nl: 'Sinds je aankomst trilt er een vreemd signaal door de lucht. Verken de omgeving: klim naar de uitkijkpost, onderzoek de oude ruïnes en vind de bron van het signaal.',
      }),
      objectives: [
        { id: 'lookout', type: 'reach', zone: 'lookout', radius: 24, text: t({ en: 'Reach the Lookout', nl: 'Bereik de uitkijkpost' }), markerLabel: ZONES.lookout.label },
        {
          id: 'ruins',
          event: 'scan:complete',
          filter: (p) => p?.target === 'ruins',
          flag: 'ruinsScanned',
          zone: 'ruins',
          marker: (ctx) => refs.ruinsTarget(ctx),
          text: t({ en: 'Scan the Ancient Ruins', nl: 'Scan de oude ruïnes' }),
          markerLabel: ZONES.ruins.label,
        },
        { id: 'signal', flag: 'signalFound', zone: 'signal', text: t({ en: 'Discover the Signal', nl: 'Ontdek het signaal' }), markerLabel: ZONES.signal.label },
      ],
      rewards: { xp: 600, credits: 300 },
    },
    {
      id: 'signal',
      type: 'main',
      title: t({ en: 'The Signal', nl: 'Het signaal' }),
      giver: 'Aria',
      location: ZONES.signal.label,
      summary: t({
        en: 'Someone is waiting for you at the pulsing beacon on the shore. Who is she, and what does she know about the signal?',
        nl: 'Bij het pulserende baken aan de oever wacht iemand op je. Wie is zij, en wat weet ze over het signaal?',
      }),
      objectives: [
        {
          id: 'aria',
          event: 'dialogue:open',
          filter: (p) => p?.npc === 'aria',
          flag: 'metAria',
          npc: 'aria',
          zone: 'signal',
          text: t({ en: 'Talk to Aria', nl: 'Spreek met Aria' }),
          markerLabel: 'Aria',
        },
      ],
      rewards: { xp: 250, credits: 150, lore: ['signal'] },
    },
    {
      id: 'community',
      type: 'main',
      title: t({ en: 'Meet the Community', nl: 'Ontmoet de gemeenschap' }),
      giver: 'Aria',
      location: ZONES.plaza.label,
      summary: t({
        en: 'Nexus Plaza, around the purple Tree of Life, is the social heart of Ø Universe. Get to know the people who gather there — together you get further.',
        nl: 'Het Nexus-plein rond de paarse Levensboom is het sociale hart van Ø Universe. Maak kennis met de mensen die er samenkomen — samen kom je verder.',
      }),
      // an early chat message starts it quietly (no tracker change); arriving at the plaza tracks it
      triggers: [{ zone: 'plaza' }, { event: 'chat:sent', track: false }],
      objectives: [
        { id: 'plaza', type: 'reach', zone: 'plaza', radius: 72, text: t({ en: 'Visit Nexus Plaza', nl: 'Bezoek het Nexus-plein' }), markerLabel: ZONES.plaza.label },
        {
          id: 'luna',
          event: 'dialogue:open',
          filter: (p) => p?.npc === 'luna',
          npc: 'luna',
          zone: 'plaza',
          text: t({ en: 'Talk to Luna', nl: 'Praat met Luna' }),
          markerLabel: 'Luna',
        },
        { id: 'chat', event: 'chat:sent', text: t({ en: 'Send a message in the chat', nl: 'Stuur een bericht in de chat' }) },
      ],
      rewards: { xp: 400, credits: 250 },
      next: ['firstflight'],
    },
    {
      id: 'firstflight',
      type: 'main',
      title: t({ en: 'First Flight', nl: 'Eerste vlucht' }),
      giver: 'Luna',
      location: ZONES.spaceport.label,
      sequential: true,
      summary: t({
        en: 'Your own spaceship is ready on pad 03 at the Spaceport. Let the flight technician check its systems, then make your first flight.',
        nl: 'Je eigen ruimteschip staat klaar op platform 03 van de ruimtehaven. Laat de vluchttechnicus de systemen controleren en maak je eerste vlucht.',
      }),
      triggers: [{ zone: 'spaceport' }],
      objectives: [
        { id: 'ship', type: 'reach', point: shipPad, radius: 22, text: t({ en: 'Go to your spaceship', nl: 'Ga naar je ruimteschip' }), markerLabel: t({ en: 'Spaceship', nl: 'Ruimteschip' }) },
        {
          id: 'jules',
          event: 'dialogue:open',
          filter: (p) => p?.npc === 'jules',
          flag: 'julesBriefed',
          npc: 'jules',
          point: JULES_SPOT,
          text: t({ en: 'Talk to the flight technician', nl: 'Praat met de vluchttechnicus' }),
          markerLabel: 'Jules',
        },
        {
          id: 'launch',
          on: [
            { event: 'vehicle:launch', filter: (p) => !p?.type || /ship/i.test(p.type) },
            { event: 'mode:change', filter: (p) => p?.to === 'space' },
          ],
          check: leftSpaceport,
          text: t({ en: 'Board it and leave the Spaceport', nl: 'Stap in en verlaat de ruimtehaven' }),
        },
      ],
      rewards: { xp: 600, credits: 400 },
      next: ['asteroid'],
    },
    {
      id: 'asteroid',
      type: 'space',
      scope: 'space',
      title: t({ en: 'Asteroid Field', nl: 'Asteroid Field' }),
      giver: 'Jules',
      location: t({ en: 'Planetary orbit', nl: 'Baan om de planeet' }),
      summary: t({
        en: 'Beyond the atmosphere lies a dense asteroid field. A convoy is calling for an escort, and a strange anomaly pulses between the rocks.',
        nl: 'Voorbij de atmosfeer ligt een dicht asteroïdenveld. Een konvooi vraagt om escorte en tussen de rotsen pulseert een vreemde anomalie.',
      }),
      triggers: [{ event: 'mode:change', filter: (p) => p?.to === 'space' }],
      objectives: [
        {
          id: 'scan',
          on: [{ event: 'space:scan', filter: (p) => !p?.target || /anomal/i.test(String(p.target)) }],
          marker: spaceTarget('anomaly'),
          scope: 'space',
          text: t({ en: 'Scan the anomaly', nl: 'Scan de anomalie' }),
          markerLabel: t({ en: 'Anomaly', nl: 'Anomalie' }),
        },
        { id: 'convoy', on: [{ event: 'space:convoy', filter: convoyOK }], marker: spaceTarget('convoy'), scope: 'space', text: t({ en: 'Defend the convoy', nl: 'Verdedig het konvooi' }), markerLabel: t({ en: 'Convoy', nl: 'Konvooi' }) },
        {
          id: 'station',
          on: [{ event: 'space:dock' }],
          flag: 'dockedHalo',
          check: nearStation(900),
          marker: spaceTarget('station'),
          scope: 'space',
          text: t({ en: 'Reach the space station', nl: 'Bereik het ruimtestation' }),
          markerLabel: 'Station Halo',
        },
      ],
      rewards: { xp: 900, credits: 700 },
      next: ['halo'],
    },
    {
      id: 'halo',
      type: 'space',
      scope: 'space',
      title: t({ en: 'Dock at Station Halo', nl: 'Aanmeren bij Station Halo' }),
      giver: null,
      location: 'Station Halo',
      titleOnly: true,
      summary: t({
        en: 'Station Halo, the colossal ring above the planet, is expecting you. Fly slowly to the docking port and dock.',
        nl: 'Station Halo, de reusachtige ring boven de planeet, verwacht je. Vlieg langzaam naar de dokpoort en meer aan.',
      }),
      objectives: [
        { id: 'dock', on: [{ event: 'space:dock' }], flag: 'dockedHalo', marker: spaceTarget('station'), scope: 'space', text: t({ en: 'Dock at Station Halo', nl: 'Meer aan bij Station Halo' }), markerLabel: 'Station Halo' },
      ],
      rewards: { xp: 500, credits: 500, lore: ['halo'] },
      next: ['colony'],
    },
    {
      id: 'colony',
      type: 'space',
      scope: 'space',
      title: t({ en: 'Defend the Colony Ship', nl: 'Verdedig het kolonieschip' }),
      giver: 'Station Halo',
      location: t({ en: 'Nebula Field', nl: 'Nevelveld' }),
      sequential: true,
      summary: t({
        en: 'Pirates are attacking the colony ship bound for Kepler-Ø 7. Help the squadron protect it.',
        nl: 'Piraten belagen het kolonieschip dat naar Kepler-Ø 7 vertrekt. Help het squadron om het schip te beschermen.',
      }),
      triggers: [{ event: 'space:kill' }],
      objectives: [
        { id: 'pirates', on: [{ event: 'space:kill' }], count: 8, scope: 'space', text: t({ en: 'Take out pirates', nl: 'Schakel piraten uit' }) },
        { id: 'report', on: [{ event: 'space:dock' }], marker: spaceTarget('station'), scope: 'space', text: t({ en: 'Report to Station Halo', nl: 'Meld je bij Station Halo' }), markerLabel: 'Station Halo' },
      ],
      rewards: { xp: 1000, credits: 900 },
    },

    // ------------------------------------------------------------- side quests
    {
      id: 'ruins',
      type: 'side',
      title: t({ en: 'Ancient Ruins', nl: 'Oude ruïnes' }),
      giver: null,
      location: ZONES.ruins.label,
      summary: t({
        en: 'Among the overgrown pillars, an age-old inscription is carved into the stone, with the Ø symbol at its center. Scan it to uncover its meaning.',
        nl: 'Tussen de overwoekerde pilaren is een eeuwenoude inscriptie in de steen gegraveerd, met in het midden het Ø-symbool. Scan hem om de betekenis te achterhalen.',
      }),
      triggers: [{ zone: 'ruins', when: (ctx) => !ctx.state.get('flags.ruinsScanned') }],
      objectives: [
        {
          id: 'scan',
          event: 'scan:complete',
          filter: (p) => p?.target === 'ruins',
          flag: 'ruinsScanned',
          marker: (ctx) => refs.ruinsTarget(ctx),
          zone: 'ruins',
          text: t({ en: 'Scan the inscription', nl: 'Scan de inscriptie' }),
          markerLabel: t({ en: 'Inscription', nl: 'Inscriptie' }),
        },
        // optional: the rune stones around the ruins (only when landmarks has them)
        ...(refs.runeCount?.() > 0
          ? [
              {
                id: 'runes',
                optional: true,
                event: 'scan:complete',
                filter: (p) => p?.target === 'rune',
                count: refs.runeCount(),
                text: t({ en: 'Scan the rune stones', nl: 'Scan de runenstenen' }),
              },
            ]
          : []),
      ],
      rewards: { xp: 300, credits: 200, lore: ['inscription'] },
    },
    {
      id: 'home',
      type: 'side',
      title: t({ en: 'Build a Home', nl: 'Een thuis bouwen' }),
      giver: 'Kai',
      location: ZONES.base.label,
      summary: t({
        en: 'The clearing in the forest has room for a base of your own. Lay a foundation, raise four walls, top it off with a roof and get the power running. [B] opens build mode.',
        nl: 'Op de open plek in het bos is ruimte voor je eigen basis. Leg een fundering, zet er vier muren op, sluit af met een dak en breng de stroom op gang. [B] opent de bouwmodus.',
      }),
      triggers: [{ zone: 'base' }, { event: 'build:mode', filter: (p) => !!p?.active }],
      objectives: [
        {
          id: 'foundation',
          event: 'build:placed',
          filter: isFoundation,
          point: { x: ZONES.base.buildArea.x, z: ZONES.base.buildArea.z },
          text: t({ en: 'Place a foundation', nl: 'Plaats een fundering' }),
          markerLabel: t({ en: 'Building site', nl: 'Bouwplaats' }),
        },
        { id: 'walls', event: 'build:placed', filter: isWall, count: 4, text: t({ en: 'Build four walls', nl: 'Bouw vier muren' }) },
        { id: 'roof', event: 'build:placed', filter: isRoof, text: t({ en: 'Place a roof', nl: 'Plaats een dak' }) },
        {
          id: 'power',
          on: [
            { event: 'build:placed', filter: isPower },
            { event: 'power:change', filter: (p) => (p?.production || 0) > 0 },
          ],
          text: t({ en: 'Activate power', nl: 'Activeer energie' }),
        },
      ],
      rewards: { xp: 700, credits: 400, items: ['decor-statue'] },
    },
    {
      id: 'collector',
      type: 'side',
      title: t({ en: 'Collector', nl: 'Verzamelaar' }),
      giver: 'Kai',
      location: t({ en: 'Everywhere', nl: 'Overal' }),
      autoTrack: false,
      summary: t({
        en: 'Metal in the rocks, wood in the forest, energy in crystals: gather enough resources to build with. Hold [E] at a resource.',
        nl: 'Metaal in de rotsen, hout in het bos, energie in kristallen: verzamel genoeg grondstoffen om te kunnen bouwen. Houd [E] ingedrukt bij een grondstof.',
      }),
      triggers: [{ event: 'harvest' }, { event: 'quest:start', filter: (p) => p?.id === 'home' }],
      objectives: [{ id: 'harvest', on: [{ event: 'harvest' }], count: 5, text: t({ en: 'Harvest resources', nl: 'Oogst grondstoffen' }) }],
      rewards: { xp: 300, resources: { metal: 40, wood: 40, stone: 30 } },
    },
    {
      id: 'highabove',
      type: 'side',
      title: t({ en: 'High Above', nl: 'Hoog boven' }),
      giver: 'Nova',
      location: t({ en: 'The skies', nl: 'Het luchtruim' }),
      summary: t({
        en: 'Nova swears the view from three hundred meters up changes everything. Take the VTOL and climb above the clouds. [Space] to ascend.',
        nl: 'Nova zweert dat het uitzicht vanaf driehonderd meter hoogte alles verandert. Neem de VTOL en klim boven de wolken. [Spatie] stijgen.',
      }),
      triggers: [{ event: 'vehicle:enter', filter: (p) => /vtol/i.test(String(p?.type || '')) }],
      objectives: [{ id: 'climb', check: vtolAbove(300), text: t({ en: 'Fly the VTOL above 300 m', nl: 'Vlieg met de VTOL boven 300 m' }) }],
      rewards: { xp: 350, credits: 250 },
    },
    {
      id: 'nightmarket',
      type: 'side',
      title: t({ en: 'Night Market', nl: 'Nachtmarkt' }),
      giver: 'Oran',
      location: t({ en: 'Bazaar, Nexus Plaza', nl: 'Bazaar, Nexus-plein' }),
      autoTrack: false, // announced with a banner; the night's festival keeps the tracker
      summary: t({
        en: 'When the sun goes down, the lanterns light up in the bazaar next to Nexus Plaza: traders, music and stories until deep into the night.',
        nl: 'Als de zon ondergaat, gaan de lantaarns aan in de bazaar naast het Nexus-plein: handelaars, muziek en verhalen tot diep in de nacht.',
      }),
      triggers: [{ check: (ctx) => isNight(ctx) && nearPoint(ZONES.plaza.x, ZONES.plaza.z, 260)(ctx) }],
      objectives: [
        {
          id: 'explore',
          type: 'reach',
          point: { x: ZONES.plaza.bazaar.x, z: ZONES.plaza.bazaar.z },
          radius: 42,
          dwell: 12,
          when: (ctx) => isNight(ctx),
          text: t({ en: 'Explore the night market', nl: 'Verken de nachtmarkt' }),
          markerLabel: t({ en: 'Night Market', nl: 'Nachtmarkt' }),
        },
        // interaction objective: press [E] at Oran's stall
        { id: 'oran', type: 'interact', target: 'oran', text: t({ en: 'Talk to Oran at his stall', nl: 'Praat met Oran bij zijn kraam' }), markerLabel: 'Oran' },
      ],
      rewards: { xp: 300, credits: 200 },
    },
    {
      id: 'lostship',
      type: 'side',
      title: t({ en: 'The Lost Ship', nl: 'Het verloren schip' }),
      giver: 'Oran',
      location: t({ en: 'Northern Rings', nl: 'Noordelijke Ringen' }),
      sequential: true,
      summary: t({
        en: 'Oran has heard rumors about the Silver Horizon, a colony ship that vanished in the Northern Rings forty years ago. Pilots still pick up its distress signal.',
        nl: 'Oran heeft geruchten gehoord over de Zilveren Horizon, een kolonieschip dat veertig jaar geleden verdween in de Noordelijke Ringen. Piloten vangen nog steeds zijn noodsignaal op.',
      }),
      objectives: [
        { id: 'launch', on: [{ event: 'mode:change', filter: (p) => p?.to === 'space' }], check: (ctx) => !!ctx.modes?.is('space'), zone: 'spaceport', text: t({ en: 'Fly into space', nl: 'Vlieg naar de ruimte' }), markerLabel: ZONES.spaceport.label },
        {
          id: 'wreck',
          on: [{ event: 'space:scan' }],
          marker: (ctx) => spaceTarget('wreck')(ctx) || spaceTarget('anomaly')(ctx),
          scope: 'space',
          text: t({ en: 'Scan the wreck in the Northern Rings', nl: 'Scan het wrak in de Noordelijke Ringen' }),
          markerLabel: t({ en: 'Distress signal', nl: 'Noodsignaal' }),
        },
      ],
      rewards: { xp: 900, credits: 600, items: ['skin-ship-gold'], lore: ['lostship'] },
    },

    // ------------------------------------------------------------- event quests
    {
      id: 'starfall',
      type: 'event',
      title: t({ en: 'Starfall Festival', nl: 'Starfall Festival' }),
      giver: null,
      location: ZONES.plaza.label,
      repeatable: true,
      summary: t({
        en: 'Once every night, Nexus Plaza turns into a sea of light and music. Everyone is welcome under the Tree of Life.',
        nl: 'Eén keer per nacht verandert het Nexus-plein in een zee van licht en muziek. Iedereen is welkom onder de Levensboom.',
      }),
      objectives: [
        {
          id: 'meet',
          on: [{ event: 'dialogue:open' }, { event: 'chat:sent' }, { event: 'npc:interact' }],
          zone: 'plaza',
          text: t({ en: 'Meet other players', nl: 'Ontmoet andere spelers' }),
          markerLabel: ZONES.plaza.label,
        },
        { id: 'enjoy', type: 'reach', point: STAGE_FRONT, radius: 34, dwell: 20, text: t({ en: 'Enjoy the Starfall Festival', nl: 'Geniet van het Starfall Festival' }), markerLabel: t({ en: 'Stage', nl: 'Podium' }) },
        {
          id: 'city',
          type: 'reach',
          point: { x: ZONES.plaza.bazaar.x, z: ZONES.plaza.bazaar.z },
          radius: 40,
          check: nearPoint(ZONES.city.x, ZONES.city.z, ZONES.city.radius),
          text: t({ en: 'Explore the city', nl: 'Verken de stad' }),
          markerLabel: t({ en: 'Bazaar', nl: 'Bazaar' }),
        },
      ],
      rewards: { xp: 500, credits: 300, lore: ['festival'] },
    },
    {
      id: 'meteorshower',
      type: 'event',
      title: t({ en: 'Meteor Shower', nl: 'Meteorenregen' }),
      giver: null,
      location: t({ en: 'Night sky', nl: 'Nachtlucht' }),
      repeatable: true,
      summary: t({
        en: 'Shooting stars streak across the night sky. Some of the debris reaches the ground — glowing, and full of metal and energy.',
        nl: 'Vallende sterren kleuren de nachtlucht. Sommige brokstukken bereiken de grond — gloeiend en vol metaal en energie.',
      }),
      objectives: [
        {
          id: 'collect',
          on: [{ event: 'harvest', filter: (p) => p?.source === 'meteor' }],
          count: 3,
          marker: () => refs.nearestFragment?.() || null,
          text: t({ en: 'Harvest meteorite fragments', nl: 'Oogst meteorietfragmenten' }),
          markerLabel: t({ en: 'Meteorite fragment', nl: 'Meteorietfragment' }),
        },
      ],
      rewards: { xp: 300, credits: 150 },
    },
    {
      id: 'echo',
      type: 'event',
      title: t({ en: 'Signal Echo', nl: 'Signaal-echo' }),
      giver: null,
      location: t({ en: 'Unknown', nl: 'Onbekend' }),
      repeatable: true,
      summary: t({
        en: 'The beacon sent out an echo that is bouncing back from somewhere in the world. Follow it before it fades.',
        nl: 'Het baken zond een echo uit die ergens in de wereld weerkaatst. Volg hem voordat hij vervaagt.',
      }),
      objectives: [{ id: 'reach', type: 'reach', marker: () => refs.echoPoint?.() || null, radius: 14, text: t({ en: 'Follow the pillar of light', nl: 'Volg de lichtzuil' }), markerLabel: t({ en: 'Signal Echo', nl: 'Signaal-echo' }) }],
      rewards: { xp: 200, resources: { energy: 25 } },
    },
  ];
}

const QUEST_TYPE = {
  main: { en: 'Main Story', nl: 'Hoofdverhaal' },
  side: { en: 'Side Mission', nl: 'Zijmissie' },
  event: { en: 'Event', nl: 'Evenement' },
  space: { en: 'Space Mission', nl: 'Ruimtemissie' },
};
/** "Main Story" / "Hoofdverhaal" … for a quest type, in the active language. */
export const questTypeLabel = (type) => (QUEST_TYPE[type] ? t(QUEST_TYPE[type]) : '');
