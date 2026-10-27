/**
 * Quest definitions (Dutch). Main chain:
 *   horizon → signal → community → firstflight → asteroid → halo → colony
 * plus side quests (ruins, home, collector, highabove, nightmarket, lostship)
 * and repeatable event quests (starfall, meteorshower, echo).
 * Predicates null-check every cross-module API (modules may be missing).
 */
import { ZONES } from '../../world/layout.js';
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
      title: 'Verken de Horizon',
      giver: null,
      location: 'Uitzichtpunt',
      summary:
        'Sinds je aankomst trilt er een vreemd signaal door de lucht. Verken de omgeving: klim naar de uitkijkpost, onderzoek de oude ruïnes en vind de bron van het signaal.',
      objectives: [
        { id: 'lookout', type: 'reach', zone: 'lookout', radius: 24, text: 'Bereik de uitkijkpost', markerLabel: 'Uitkijkpost' },
        {
          id: 'ruins',
          event: 'scan:complete',
          filter: (p) => p?.target === 'ruins',
          flag: 'ruinsScanned',
          zone: 'ruins',
          marker: (ctx) => refs.ruinsTarget(ctx),
          text: 'Scan de oude ruïnes',
          markerLabel: 'Oude ruïnes',
        },
        { id: 'signal', flag: 'signalFound', zone: 'signal', text: 'Ontdek het signaal', markerLabel: 'Het signaal' },
      ],
      rewards: { xp: 600, credits: 300 },
    },
    {
      id: 'signal',
      type: 'main',
      title: 'Het signaal',
      giver: 'Aria',
      location: 'Het signaal',
      summary: 'Bij het pulserende baken aan de oever wacht iemand op je. Wie is zij, en wat weet ze over het signaal?',
      objectives: [
        {
          id: 'aria',
          event: 'dialogue:open',
          filter: (p) => p?.npc === 'aria',
          flag: 'metAria',
          npc: 'aria',
          zone: 'signal',
          text: 'Spreek met Aria',
          markerLabel: 'Aria',
        },
      ],
      rewards: { xp: 250, credits: 150, lore: ['signal'] },
    },
    {
      id: 'community',
      type: 'main',
      title: 'Ontmoet de gemeenschap',
      giver: 'Aria',
      location: 'Nexus-plein',
      summary:
        'Het Nexus-plein rond de paarse Levensboom is het sociale hart van Ø Universe. Maak kennis met de mensen die er samenkomen — samen kom je verder.',
      // an early chat message starts it quietly (no tracker change); arriving at the plaza tracks it
      triggers: [{ zone: 'plaza' }, { event: 'chat:sent', track: false }],
      objectives: [
        { id: 'plaza', type: 'reach', zone: 'plaza', radius: 72, text: 'Bezoek het Nexus-plein', markerLabel: 'Nexus-plein' },
        {
          id: 'luna',
          event: 'dialogue:open',
          filter: (p) => p?.npc === 'luna',
          npc: 'luna',
          zone: 'plaza',
          text: 'Praat met Luna',
          markerLabel: 'Luna',
        },
        { id: 'chat', event: 'chat:sent', text: 'Stuur een bericht in de chat' },
      ],
      rewards: { xp: 400, credits: 250 },
      next: ['firstflight'],
    },
    {
      id: 'firstflight',
      type: 'main',
      title: 'Eerste vlucht',
      giver: 'Luna',
      location: 'Ruimtehaven',
      sequential: true,
      summary:
        'Je eigen ruimteschip staat klaar op platform 03 van de ruimtehaven. Laat de vluchttechnicus de systemen controleren en maak je eerste vlucht.',
      triggers: [{ zone: 'spaceport' }],
      objectives: [
        { id: 'ship', type: 'reach', point: shipPad, radius: 22, text: 'Ga naar je ruimteschip', markerLabel: 'Ruimteschip' },
        {
          id: 'jules',
          event: 'dialogue:open',
          filter: (p) => p?.npc === 'jules',
          flag: 'julesBriefed',
          npc: 'jules',
          point: JULES_SPOT,
          text: 'Praat met de vluchttechnicus',
          markerLabel: 'Jules',
        },
        {
          id: 'launch',
          on: [
            { event: 'vehicle:launch', filter: (p) => !p?.type || /ship/i.test(p.type) },
            { event: 'mode:change', filter: (p) => p?.to === 'space' },
          ],
          check: leftSpaceport,
          text: 'Stap in en verlaat de ruimtehaven',
        },
      ],
      rewards: { xp: 600, credits: 400 },
      next: ['asteroid'],
    },
    {
      id: 'asteroid',
      type: 'space',
      scope: 'space',
      title: 'Asteroid Field',
      giver: 'Jules',
      location: 'Baan om de planeet',
      summary:
        'Voorbij de atmosfeer ligt een dicht asteroïdenveld. Een konvooi vraagt om escorte en tussen de rotsen pulseert een vreemde anomalie.',
      triggers: [{ event: 'mode:change', filter: (p) => p?.to === 'space' }],
      objectives: [
        {
          id: 'scan',
          on: [{ event: 'space:scan', filter: (p) => !p?.target || /anomal/i.test(String(p.target)) }],
          marker: spaceTarget('anomaly'),
          scope: 'space',
          text: 'Scan de anomalie',
          markerLabel: 'Anomalie',
        },
        { id: 'convoy', on: [{ event: 'space:convoy', filter: convoyOK }], marker: spaceTarget('convoy'), scope: 'space', text: 'Verdedig het konvooi', markerLabel: 'Konvooi' },
        {
          id: 'station',
          on: [{ event: 'space:dock' }],
          flag: 'dockedHalo',
          check: nearStation(900),
          marker: spaceTarget('station'),
          scope: 'space',
          text: 'Bereik het ruimtestation',
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
      title: 'Aanmeren bij Station Halo',
      giver: null,
      location: 'Station Halo',
      titleOnly: true,
      summary: 'Station Halo, de reusachtige ring boven de planeet, verwacht je. Vlieg langzaam naar de dokpoort en meer aan.',
      objectives: [
        { id: 'dock', on: [{ event: 'space:dock' }], flag: 'dockedHalo', marker: spaceTarget('station'), scope: 'space', text: 'Meer aan bij Station Halo', markerLabel: 'Station Halo' },
      ],
      rewards: { xp: 500, credits: 500, lore: ['halo'] },
      next: ['colony'],
    },
    {
      id: 'colony',
      type: 'space',
      scope: 'space',
      title: 'Verdedig het kolonieschip',
      giver: 'Station Halo',
      location: 'Nevelveld',
      sequential: true,
      summary: 'Piraten belagen het kolonieschip dat naar Kepler-Ø 7 vertrekt. Help het squadron om het schip te beschermen.',
      triggers: [{ event: 'space:kill' }],
      objectives: [
        { id: 'pirates', on: [{ event: 'space:kill' }], count: 8, scope: 'space', text: 'Schakel piraten uit' },
        { id: 'report', on: [{ event: 'space:dock' }], marker: spaceTarget('station'), scope: 'space', text: 'Meld je bij Station Halo', markerLabel: 'Station Halo' },
      ],
      rewards: { xp: 1000, credits: 900 },
    },

    // ------------------------------------------------------------- side quests
    {
      id: 'ruins',
      type: 'side',
      title: 'Oude ruïnes',
      giver: null,
      location: 'Oude ruïnes',
      summary:
        'Tussen de overwoekerde pilaren is een eeuwenoude inscriptie in de steen gegraveerd, met in het midden het Ø-symbool. Scan hem om de betekenis te achterhalen.',
      triggers: [{ zone: 'ruins', when: (ctx) => !ctx.state.get('flags.ruinsScanned') }],
      objectives: [
        {
          id: 'scan',
          event: 'scan:complete',
          filter: (p) => p?.target === 'ruins',
          flag: 'ruinsScanned',
          marker: (ctx) => refs.ruinsTarget(ctx),
          zone: 'ruins',
          text: 'Scan de inscriptie',
          markerLabel: 'Inscriptie',
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
                text: 'Scan de runenstenen',
              },
            ]
          : []),
      ],
      rewards: { xp: 300, credits: 200, lore: ['inscription'] },
    },
    {
      id: 'home',
      type: 'side',
      title: 'Een thuis bouwen',
      giver: 'Kai',
      location: 'Jouw basis',
      summary:
        'Op de open plek in het bos is ruimte voor je eigen basis. Leg een fundering, zet er vier muren op, sluit af met een dak en breng de stroom op gang. [B] opent de bouwmodus.',
      triggers: [{ zone: 'base' }, { event: 'build:mode', filter: (p) => !!p?.active }],
      objectives: [
        {
          id: 'foundation',
          event: 'build:placed',
          filter: isFoundation,
          point: { x: ZONES.base.buildArea.x, z: ZONES.base.buildArea.z },
          text: 'Plaats een fundering',
          markerLabel: 'Bouwplaats',
        },
        { id: 'walls', event: 'build:placed', filter: isWall, count: 4, text: 'Bouw vier muren' },
        { id: 'roof', event: 'build:placed', filter: isRoof, text: 'Plaats een dak' },
        {
          id: 'power',
          on: [
            { event: 'build:placed', filter: isPower },
            { event: 'power:change', filter: (p) => (p?.production || 0) > 0 },
          ],
          text: 'Activeer energie',
        },
      ],
      rewards: { xp: 700, credits: 400, items: ['decor-statue'] },
    },
    {
      id: 'collector',
      type: 'side',
      title: 'Verzamelaar',
      giver: 'Kai',
      location: 'Overal',
      autoTrack: false,
      summary: 'Metaal in de rotsen, hout in het bos, energie in kristallen: verzamel genoeg grondstoffen om te kunnen bouwen. Houd [E] ingedrukt bij een grondstof.',
      triggers: [{ event: 'harvest' }, { event: 'quest:start', filter: (p) => p?.id === 'home' }],
      objectives: [{ id: 'harvest', on: [{ event: 'harvest' }], count: 5, text: 'Oogst grondstoffen' }],
      rewards: { xp: 300, resources: { metal: 40, wood: 40, stone: 30 } },
    },
    {
      id: 'highabove',
      type: 'side',
      title: 'Hoog boven',
      giver: 'Nova',
      location: 'Het luchtruim',
      summary: 'Nova zweert dat het uitzicht vanaf driehonderd meter hoogte alles verandert. Neem de VTOL en klim boven de wolken. [Spatie] stijgen.',
      triggers: [{ event: 'vehicle:enter', filter: (p) => /vtol/i.test(String(p?.type || '')) }],
      objectives: [{ id: 'climb', check: vtolAbove(300), text: 'Vlieg met de VTOL boven 300 m' }],
      rewards: { xp: 350, credits: 250 },
    },
    {
      id: 'nightmarket',
      type: 'side',
      title: 'Nachtmarkt',
      giver: 'Oran',
      location: 'Bazaar, Nexus-plein',
      autoTrack: false, // announced with a banner; the night's festival keeps the tracker
      summary: 'Als de zon ondergaat, gaan de lantaarns aan in de bazaar naast het Nexus-plein: handelaars, muziek en verhalen tot diep in de nacht.',
      triggers: [{ check: (ctx) => isNight(ctx) && nearPoint(ZONES.plaza.x, ZONES.plaza.z, 260)(ctx) }],
      objectives: [
        {
          id: 'explore',
          type: 'reach',
          point: { x: ZONES.plaza.bazaar.x, z: ZONES.plaza.bazaar.z },
          radius: 42,
          dwell: 12,
          when: (ctx) => isNight(ctx),
          text: 'Verken de nachtmarkt',
          markerLabel: 'Nachtmarkt',
        },
        // interaction objective: press [E] at Oran's stall
        { id: 'oran', type: 'interact', target: 'oran', text: 'Praat met Oran bij zijn kraam', markerLabel: 'Oran' },
      ],
      rewards: { xp: 300, credits: 200 },
    },
    {
      id: 'lostship',
      type: 'side',
      title: 'Het verloren schip',
      giver: 'Oran',
      location: 'Noordelijke Ringen',
      sequential: true,
      summary:
        'Oran heeft geruchten gehoord over de Zilveren Horizon, een kolonieschip dat veertig jaar geleden verdween in de Noordelijke Ringen. Piloten vangen nog steeds zijn noodsignaal op.',
      objectives: [
        { id: 'launch', on: [{ event: 'mode:change', filter: (p) => p?.to === 'space' }], check: (ctx) => !!ctx.modes?.is('space'), zone: 'spaceport', text: 'Vlieg naar de ruimte', markerLabel: 'Ruimtehaven' },
        {
          id: 'wreck',
          on: [{ event: 'space:scan' }],
          marker: (ctx) => spaceTarget('wreck')(ctx) || spaceTarget('anomaly')(ctx),
          scope: 'space',
          text: 'Scan het wrak in de Noordelijke Ringen',
          markerLabel: 'Noodsignaal',
        },
      ],
      rewards: { xp: 900, credits: 600, items: ['skin-ship-gold'], lore: ['lostship'] },
    },

    // ------------------------------------------------------------- event quests
    {
      id: 'starfall',
      type: 'event',
      title: 'Starfall Festival',
      giver: null,
      location: 'Nexus-plein',
      repeatable: true,
      summary: 'Eén keer per nacht verandert het Nexus-plein in een zee van licht en muziek. Iedereen is welkom onder de Levensboom.',
      objectives: [
        {
          id: 'meet',
          on: [{ event: 'dialogue:open' }, { event: 'chat:sent' }, { event: 'npc:interact' }],
          zone: 'plaza',
          text: 'Ontmoet andere spelers',
          markerLabel: 'Nexus-plein',
        },
        { id: 'enjoy', type: 'reach', point: STAGE_FRONT, radius: 34, dwell: 20, text: 'Geniet van het Starfall Festival', markerLabel: 'Podium' },
        {
          id: 'city',
          type: 'reach',
          point: { x: ZONES.plaza.bazaar.x, z: ZONES.plaza.bazaar.z },
          radius: 40,
          check: nearPoint(ZONES.city.x, ZONES.city.z, ZONES.city.radius),
          text: 'Verken de stad',
          markerLabel: 'Bazaar',
        },
      ],
      rewards: { xp: 500, credits: 300, lore: ['festival'] },
    },
    {
      id: 'meteorshower',
      type: 'event',
      title: 'Meteorenregen',
      giver: null,
      location: 'Nachtlucht',
      repeatable: true,
      summary: 'Vallende sterren kleuren de nachtlucht. Sommige brokstukken bereiken de grond — gloeiend en vol metaal en energie.',
      objectives: [
        {
          id: 'collect',
          on: [{ event: 'harvest', filter: (p) => p?.source === 'meteor' }],
          count: 3,
          marker: () => refs.nearestFragment?.() || null,
          text: 'Oogst meteorietfragmenten',
          markerLabel: 'Meteorietfragment',
        },
      ],
      rewards: { xp: 300, credits: 150 },
    },
    {
      id: 'echo',
      type: 'event',
      title: 'Signaal-echo',
      giver: null,
      location: 'Onbekend',
      repeatable: true,
      summary: 'Het baken zond een echo uit die ergens in de wereld weerkaatst. Volg hem voordat hij vervaagt.',
      objectives: [{ id: 'reach', type: 'reach', marker: () => refs.echoPoint?.() || null, radius: 14, text: 'Volg de lichtzuil', markerLabel: 'Signaal-echo' }],
      rewards: { xp: 200, resources: { energy: 25 } },
    },
  ];
}

export const QUEST_TYPE_LABEL = { main: 'Hoofdverhaal', side: 'Zijmissie', event: 'Evenement', space: 'Ruimtemissie' };
