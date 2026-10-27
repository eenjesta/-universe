/**
 * Dialogue trees ("Create your own story" / "Maak je eigen verhaal"). Each tree:
 *   { id, name, role, accent, home: zoneId, backdrop(ctx) → {x, z} (deep links: framed behind the NPC),
 *     approach: 'center' (deep links: stand on the zone-centre side), talkDist (deep links, m),
 *     cam: {zoom, shoulder, aim, pitch, npcX} (dialogue framing overrides),
 *     look: {...placeholder portrait}, start(h) → nodeId,
 *     nodes: { id: { text: text | (h) => text, onEnter(h), choices: [...] | (h) => [...] } } }
 * Choice: { text, next: nodeId, end: true, market: 'buy'|'sell'|'mine', if(h) → bool, do(h), tag }
 * Player-facing text (role, node text, choice text, tag) is bilingual { en, nl } (or a plain
 * string) and resolved with t() by story/dialogue.js when it is shown; `name` is a proper name.
 * `h` is the helper API built in story/dialogue.js (flags, quests, party, rewards, events …).
 */
import { ZONES } from '../../world/layout.js';

const bye = (text = { en: 'Goodbye.', nl: 'Tot ziens.' }) => ({ text, end: true });

// recurring choice tags + choices
const PARTY = { en: 'Party', nl: 'Groep' };
const MISSION = { en: 'Mission', nl: 'Missie' };
const MARKET = { en: 'Market', nl: 'Markt' };
const EVENT = { en: 'Event', nl: 'Event' };
const LATER = { en: 'See you later.', nl: 'Tot later.' };
const JOIN_PARTY = { en: 'Want to join my party?', nl: 'Doe je mee met mijn groep?' };
const OWN_WAY = { en: 'Go do your own thing for a bit.', nl: 'Ga maar even je eigen gang.' };
const TELL_PLACE = { en: 'Tell me more about this place.', nl: 'Vertel me meer over deze locatie.' };
const WORK_TOGETHER = { en: "Let's work together.", nl: 'Laten we samenwerken.' };
const EXPLORE_FIRST = { en: "I'll explore a bit more first.", nl: 'Ik ga eerst verder verkennen.' };
const SHOW_WARES = { en: "Show me what you're selling.", nl: 'Laat me zien wat je verkoopt.' };
const LETS_GO = { en: "Let's go!", nl: 'Laten we gaan!' };

/** Tip based on the player's progress (used by several NPCs). */
function progressTip(h) {
  if (!h.quest.objectiveDone('horizon', 'lookout'))
    return { en: 'Climb the Lookout in the western hills. From up there you can see almost the whole lake — and the city.', nl: 'Klim naar de uitkijkpost op de westelijke heuvels. Vanaf daar zie je bijna het hele meer — en de stad.' };
  if (!h.flag('ruinsScanned'))
    return { en: "In the Ancient Ruins, east of the Overlook, there's an inscription carved into the stone. Hold [E] to scan it.", nl: 'In de oude ruïnes, ten oosten van het uitzichtpunt, zit een inscriptie in de steen. Houd [E] ingedrukt om hem te scannen.' };
  if (!h.flag('signalFound'))
    return { en: "Follow the lakeshore to the north. That's where the Signal pulses — you can't miss it.", nl: 'Volg de oever van het meer naar het noorden. Daar pulseert het signaal — je kunt het niet missen.' };
  if (h.quest.isActive('community'))
    return { en: "You'll find Luna at Nexus Plaza. And feel free to say something in the chat — press [Enter].", nl: 'Op het Nexus-plein vind je Luna. En zeg gerust iets in de chat — druk op [Enter].' };
  if (h.quest.isActive('firstflight'))
    return { en: 'Jules is waiting by your ship at the Spaceport. He knows every bolt of that thing.', nl: 'Jules wacht bij je schip op de ruimtehaven. Hij kent elke bout van dat ding.' };
  if (h.quest.isActive('home'))
    return { en: 'At your base in the forest, press [B] to build. Foundation first, then walls, a roof and power.', nl: 'Op je basis in het bos druk je op [B] om te bouwen. Fundering eerst, dan muren, een dak en energie.' };
  if (!h.quest.isDone('highabove'))
    return { en: 'Take the VTOL and climb above three hundred meters. The view is indescribable.', nl: 'Pak eens de VTOL en klim boven de driehonderd meter. Het uitzicht is onbeschrijflijk.' };
  return h.night()
    ? { en: 'Watch the sky at night. Sometimes stars fall — and the debris is full of energy.', nl: "Kijk 's nachts naar de lucht. Soms vallen er sterren — en die brokstukken zitten vol energie." }
    : { en: 'Have you seen the five waterfalls yet? The biggest one plunges into the lake right by the western river.', nl: 'Ken je de vijf watervallen al? De grootste stort zich vlak bij de westelijke rivier in het meer.' };
}

const invite = (id, line) => ({
  onEnter: (h) => h.party.join(id),
  // onEnter runs first: when the group was full the NPC says so instead
  text: (h) => (h.party.has(id) ? line : { en: "Your party is already full! Just call me when there's room again.", nl: 'Je groep is al vol! Roep me maar als er weer plek is.' }),
  choices: (h) => [bye(h.party.has(id) ? { en: "Great, let's go.", nl: 'Top, laten we gaan.' } : { en: 'Okay, see you later.', nl: 'Oké, tot later.' })],
});

export function buildTrees() {
  return {
    // ------------------------------------------------------------------ Aria
    aria: {
      id: 'aria',
      name: 'Aria',
      role: { en: 'Signal Researcher', nl: 'Signaalonderzoeker' },
      accent: '#7fe0ff',
      home: 'signal',
      // deep links: the player stands south of Aria, the obelisk behind her (10_signal_aria.png)
      backdrop: (ctx) => ctx.landmarks?.beacon?.position || { x: ZONES.signal.x, z: ZONES.signal.z - 24 },
      look: { body: 'f', hair: 'ponytail', hairColor: '#21160f', skin: '#c99272', outfit: '#16181e' },
      start: (h) => (h.flag('metAria') ? 'again' : 'intro'),
      nodes: {
        intro: {
          onEnter: (h) => h.setFlag('metAria'),
          text: { en: 'This place has a history that goes deeper than we think. What do you want to do?', nl: 'Deze plek heeft een geschiedenis die verder gaat dan wat we denken. Wat wil je doen?' },
          choices: [
            { text: TELL_PLACE, next: 'history' },
            { text: WORK_TOGETHER, next: 'together', tag: PARTY },
            { text: EXPLORE_FIRST, next: 'later' },
          ],
        },
        history: {
          onEnter: (h) => h.lore('founders'),
          text: {
            en: "This beacon has been sending the same signal for centuries: three short pulses and one long silence. The Founders built it, long before Aurora City existed. Wherever they went, you'll find the Ø symbol.",
            nl: 'Dit baken zendt al eeuwen hetzelfde signaal uit: drie korte pulsen en één lange stilte. De Stichters bouwden het, lang voordat Aurora-stad bestond. Overal waar zij zijn geweest, vind je het Ø-symbool.',
          },
          choices: [
            { text: { en: 'Who were the Founders?', nl: 'Wie waren de Stichters?' }, next: 'founders' },
            { text: { en: 'What does the Ø symbol mean?', nl: 'Wat betekent het Ø-symbool?' }, next: 'symbol' },
            { text: WORK_TOGETHER, next: 'together', tag: PARTY, if: (h) => !h.party.has('aria') },
          ],
        },
        founders: {
          text: {
            en: 'Nobody knows for sure. They left no names behind — only ruins, inscriptions and this signal. As if they wanted someone to answer it one day.',
            nl: 'Niemand weet het zeker. Ze lieten geen namen achter — alleen ruïnes, inscripties en dit signaal. Alsof ze wilden dat iemand het ooit zou beantwoorden.',
          },
          choices: [
            { text: { en: 'What does the Ø symbol mean?', nl: 'Wat betekent het Ø-symbool?' }, next: 'symbol' },
            { text: WORK_TOGETHER, next: 'together', tag: PARTY, if: (h) => !h.party.has('aria') },
            { text: EXPLORE_FIRST, next: 'later' },
          ],
        },
        symbol: {
          onEnter: (h) => h.lore('symbol'),
          text: {
            en: "A circle, crossed by a single line that reaches beyond the circle itself. An ending that is also a beginning. I think it's an invitation.",
            nl: 'Een cirkel, doorkruist door één lijn die verder reikt dan de cirkel zelf. Een einde dat ook een begin is. Ik denk dat het een uitnodiging is.',
          },
          choices: [
            { text: WORK_TOGETHER, next: 'together', tag: PARTY, if: (h) => !h.party.has('aria') },
            { text: { en: 'Do you have a tip for me?', nl: 'Heb je een tip voor me?' }, next: 'tip' },
            { text: EXPLORE_FIRST, next: 'later' },
          ],
        },
        together: {
          onEnter: (h) => {
            h.party.join('aria');
            h.setFlag('ariaAlly');
            h.quest.start('community', { track: true });
          },
          text: (h) =>
            h.flag('ruinsScanned')
              ? {
                  en: "Gladly. Two of us see more than one. You've already scanned the inscription — so Nexus Plaza is our next step. We'll find people there who can help us.",
                  nl: 'Graag. Met z’n tweeën zien we meer dan alleen. Jij hebt de inscriptie al gescand — dan is het Nexus-plein onze volgende stap. Daar vinden we mensen die ons kunnen helpen.',
                }
              : {
                  en: "Gladly. Two of us see more than one. Let's start with the people at Nexus Plaza. And if you pass the Ancient Ruins, scan the inscription — I'll try to decipher it.",
                  nl: 'Graag. Met z’n tweeën zien we meer dan alleen. Laten we beginnen bij de mensen op het Nexus-plein. En kom je langs de oude ruïnes: scan de inscriptie, dan probeer ik hem te ontcijferen.',
                },
          choices: [
            { text: { en: 'What is Nexus Plaza?', nl: 'Wat is het Nexus-plein?' }, next: 'plaza' },
            { text: { en: 'What do you know about the Spaceport?', nl: 'Wat weet je van de ruimtehaven?' }, next: 'spaceport' },
            bye({ en: "Come on, let's go.", nl: 'Kom, we gaan.' }),
          ],
        },
        plaza: {
          text: {
            en: "The plaza around the Tree of Life, that huge purple tree on the east side of the bay. Everyone gathers there. Luna always knows what's going on.",
            nl: 'Het plein rond de Levensboom, die enorme paarse boom aan de oostkant van de baai. Iedereen komt daar samen. Luna weet altijd wat er speelt.',
          },
          choices: [{ text: { en: 'What do you know about the Spaceport?', nl: 'Wat weet je van de ruimtehaven?' }, next: 'spaceport' }, bye({ en: "Come on, let's go.", nl: 'Kom, we gaan.' })],
        },
        spaceport: {
          text: {
            en: "South of the plaza, the ships to Station Halo stand ready. If the signal points to the stars, one day we'll have to leave.",
            nl: 'Ten zuiden van het plein staan de schepen klaar die naar Station Halo vliegen. Als het signaal naar de sterren wijst, zullen we ooit moeten vertrekken.',
          },
          choices: [{ text: { en: 'What is Nexus Plaza?', nl: 'Wat is het Nexus-plein?' }, next: 'plaza' }, bye({ en: "Come on, let's go.", nl: 'Kom, we gaan.' })],
        },
        later: {
          text: {
            en: "Of course. Take your time. The signal isn't going anywhere — and neither am I. You know where to find me.",
            nl: 'Natuurlijk. Neem je tijd. Het signaal loopt niet weg — en ik ook niet. Je weet me te vinden.',
          },
          choices: [bye({ en: 'See you later, Aria.', nl: 'Tot later, Aria.' })],
        },
        tip: {
          text: (h) => progressTip(h),
          choices: [{ text: TELL_PLACE, next: 'history' }, bye({ en: 'Thanks, Aria.', nl: 'Bedankt, Aria.' })],
        },
        again: {
          text: (h) =>
            h.party.has('aria')
              ? { en: "I'm here. The signal sounds stronger since we started traveling together. What do you need?", nl: 'Ik ben er. Het signaal klinkt sterker sinds we samen reizen. Wat heb je nodig?' }
              : h.night()
                ? { en: "See how the beacon lights up at night? It's almost as if it's calling us. What do you need?", nl: 'Zie je hoe het baken ’s nachts oplicht? Het lijkt wel of het ons roept. Wat heb je nodig?' }
                : { en: 'The signal sounds stronger today. What do you need?', nl: 'Het signaal klinkt sterker vandaag. Wat heb je nodig?' },
          choices: [
            { text: TELL_PLACE, next: 'history' },
            { text: { en: 'Will you come with me?', nl: 'Ga je met me mee?' }, next: 'join', tag: PARTY, if: (h) => !h.party.has('aria') },
            { text: { en: 'Wait here for me.', nl: 'Wacht hier even op me.' }, next: 'leave', if: (h) => h.party.has('aria') },
            { text: { en: 'Do you have a tip for me?', nl: 'Heb je een tip voor me?' }, next: 'tip' },
            bye(LATER),
          ],
        },
        join: invite('aria', { en: 'Always. Two of us see more.', nl: 'Altijd. Met z’n tweeën zien we meer.' }),
        leave: {
          onEnter: (h) => h.party.leave('aria'),
          text: {
            en: "All right. I'll stay by the beacon and listen to the signal. Call me if you need me.",
            nl: 'Goed. Ik blijf bij het baken en luister naar het signaal. Roep me maar als je me nodig hebt.',
          },
          choices: [bye({ en: 'See you soon.', nl: 'Tot snel.' })],
        },
      },
    },

    // ------------------------------------------------------------------ Oran
    oran: {
      id: 'oran',
      name: 'Oran',
      role: { en: 'Trader · Bazaar', nl: 'Handelaar · Bazaar' },
      accent: '#f0b46a',
      home: 'plaza',
      approach: 'center',
      talkDist: 2.3, // just in front of his counter
      // low-angle shot: his stall's lanterns hang at head height, so the camera sits low
      // (pitch > 0, ~0.85 m) and close, looking under them at his face with the lanterns
      // glowing above (08_npc_dialogue)
      cam: { zoom: 1.6, pitch: 0.42, aim: -1.52 },
      position: { x: ZONES.plaza.oran.x, z: ZONES.plaza.oran.z },
      look: { body: 'm', hair: 'headband', hairColor: '#cfc8bd', skin: '#b98262', beard: 'full', beardColor: '#e4ddd2', outfit: '#3a2a20' },
      start: (h) => (h.flag('metOran') ? 'again' : 'intro'),
      nodes: {
        intro: {
          onEnter: (h) => h.setFlag('metOran'),
          text: { en: "I've heard rumors about a lost ship in the Northern Rings…", nl: 'Ik heb geruchten gehoord over een verloren schip in de Noordelijke Ringen…' },
          choices: [
            { text: { en: 'Tell me more about that ship.', nl: 'Vertel me meer over dat schip.' }, next: 'ship' },
            { text: { en: 'Where are the Northern Rings?', nl: 'Waar zijn de Noordelijke Ringen?' }, next: 'rings' },
            { text: SHOW_WARES, market: 'buy', tag: MARKET },
          ],
        },
        ship: {
          text: {
            en: 'The Silver Horizon. A colony ship that left forty years ago with two thousand souls on board. It never arrived. But pilots swear they still pick up a distress signal between the rings…',
            nl: 'De Zilveren Horizon. Een kolonieschip, veertig jaar geleden vertrokken met tweeduizend zielen aan boord. Het is nooit aangekomen. Maar piloten zweren dat ze tussen de ringen nog een noodsignaal opvangen…',
          },
          choices: [
            { text: { en: "I'll go look for it.", nl: 'Ik ga het zoeken.' }, next: 'accept', tag: MISSION, if: (h) => !h.quest.has('lostship') },
            { text: { en: 'Why are you telling me this?', nl: 'Waarom vertel je mij dit?' }, next: 'why' },
            { text: { en: 'Where are the Northern Rings?', nl: 'Waar zijn de Noordelijke Ringen?' }, next: 'rings' },
          ],
        },
        rings: {
          onEnter: (h) => h.lore('rings'),
          text: {
            en: "Beyond the atmosphere, north of the planet: a belt of ice and rock. You'll need a ship — the Spaceport is south of the plaza.",
            nl: 'Voorbij de atmosfeer, ten noorden van de planeet: een gordel van ijs en gesteente. Je hebt een schip nodig — de ruimtehaven ligt ten zuiden van het plein.',
          },
          choices: [
            { text: { en: 'Tell me more about that ship.', nl: 'Vertel me meer over dat schip.' }, next: 'ship', if: (h) => !h.quest.has('lostship') },
            { text: SHOW_WARES, market: 'buy', tag: MARKET },
            { text: { en: 'Thanks, Oran.', nl: 'Bedankt, Oran.' }, next: 'bye' },
          ],
        },
        why: {
          text: {
            en: "Because you have the eyes of an explorer. And because an old man like me doesn't fly so fast anymore. If you find it, you share the story with me — deal?",
            nl: 'Omdat je de ogen hebt van een verkenner. En omdat een oude man als ik niet meer zo snel vliegt. Als je het vindt, deel je het verhaal met mij — afgesproken?',
          },
          choices: [
            { text: { en: "Deal. I'll go look for it.", nl: 'Afgesproken. Ik ga het zoeken.' }, next: 'accept', tag: MISSION, if: (h) => !h.quest.has('lostship') },
            { text: SHOW_WARES, market: 'buy', tag: MARKET },
            bye({ en: "I'll think about it.", nl: 'Ik denk er nog over na.' }),
          ],
        },
        accept: {
          onEnter: (h) => {
            h.quest.start('lostship', { track: true });
            if (!h.flag('oranGift')) {
              h.setFlag('oranGift');
              h.reward({ resources: { energy: 20 } }, { en: 'Oran gave you an energy cell', nl: 'Oran gaf je een energiecel' });
            }
          },
          text: {
            en: 'Ha! I knew it. Take this energy cell from my own stock. Fly to the rings and listen carefully — and come back in one piece.',
            nl: 'Ha! Ik wist het. Neem deze energiecel mee uit mijn eigen voorraad. Vlieg naar de ringen en luister goed — en kom heelhuids terug.',
          },
          choices: [{ text: SHOW_WARES, market: 'buy', tag: MARKET }, bye({ en: 'Goodbye, Oran.', nl: 'Tot ziens, Oran.' })],
        },
        trade: {
          text: {
            en: "Metal has been scarce since they started building new towers in Aurora City. Bring me resources and I'll pay you in Ø-credits. And those neon trees? They're selling like hotcakes!",
            nl: 'Metaal is schaars sinds ze in Aurora-stad nieuwe torens bouwen. Breng me grondstoffen en ik betaal je in Ø-credits. En die neonbomen? Die verkopen als warme broodjes!',
          },
          choices: [{ text: { en: 'I want to sell something.', nl: 'Ik wil iets verkopen.' }, market: 'sell', tag: MARKET }, { text: SHOW_WARES, market: 'buy', tag: MARKET }, bye()],
        },
        bye: { text: { en: 'May the stars light your path, traveler.', nl: 'Moge de sterren je pad verlichten, reiziger.' }, choices: [bye()] },
        again: {
          text: (h) =>
            h.quest.isDone('lostship')
              ? { en: 'You found the Silver Horizon! What a story… Feel free to look around, friend. For you, always a fair price.', nl: 'Je hebt de Zilveren Horizon gevonden! Wat een verhaal… Kijk gerust rond, vriend. Voor jou altijd een eerlijke prijs.' }
              : h.quest.isActive('lostship')
                ? { en: "Any news about the Silver Horizon? The rings don't give up their secrets easily.", nl: 'Nog nieuws over de Zilveren Horizon? De ringen geven hun geheimen niet zomaar prijs.' }
                : h.night()
                  ? { en: "Ah, the night market is lovely tonight, isn't it? What can I do for you?", nl: 'Ah, de nachtmarkt is mooi vanavond, niet? Wat kan ik voor je doen?' }
                  : { en: 'Welcome back, traveler! What can I do for you?', nl: 'Welkom terug, reiziger! Wat kan ik voor je doen?' },
          choices: [
            { text: { en: 'Tell me about the lost ship.', nl: 'Vertel me over het verloren schip.' }, next: 'ship', if: (h) => !h.quest.has('lostship') },
            { text: SHOW_WARES, market: 'buy', tag: MARKET },
            { text: { en: "How's business?", nl: 'Hoe gaat de handel?' }, next: 'trade' },
            bye(),
          ],
        },
      },
    },

    // ------------------------------------------------------------------ Luna
    luna: {
      id: 'luna',
      name: 'Luna_Ø',
      role: { en: 'Guide · Nexus Plaza', nl: 'Gids · Nexus-plein' },
      accent: '#b48cff',
      home: 'plaza',
      backdrop: () => ZONES.plaza.tree, // the Levensboom behind them
      look: { body: 'f', hair: 'long', hairColor: '#3b2416', skin: '#e0b089', outfit: '#e9e4dc' },
      start: (h) => (h.flag('metLuna') ? 'again' : 'intro'),
      nodes: {
        intro: {
          onEnter: (h) => h.setFlag('metLuna'),
          text: (h) =>
            h.event.isActive('starfall')
              ? { en: 'Hey, you made it too! The Starfall Festival has started — shall we head to the stage?', nl: 'Hé, jij bent er ook! Het Starfall Festival is begonnen — zullen we naar het podium gaan?' }
              : { en: "Hey, you're new here, right? Welcome to Nexus Plaza! Shall we try the new mission?", nl: 'Hé, jij bent nieuw hier, toch? Welkom op het Nexus-plein! Zullen we de nieuwe missie proberen?' },
          choices: [
            { text: { en: 'What mission?', nl: 'Welke missie?' }, next: 'mission' },
            { text: JOIN_PARTY, next: 'invite', tag: PARTY },
            { text: { en: 'What is there to do on the plaza?', nl: 'Wat is er te doen op het plein?' }, next: 'plaza' },
          ],
        },
        mission: {
          text: {
            en: "There's a ship waiting for you at the Spaceport, south of here. Jules, the flight technician, is expecting you. Your first flight to the stars — sounds good, right?",
            nl: 'Er staat een schip voor je klaar op de ruimtehaven, ten zuiden van hier. Jules, de vluchttechnicus, wacht op je. Je eerste vlucht naar de sterren — klinkt goed, toch?',
          },
          choices: [
            { text: { en: "Let's go! 🚀", nl: 'Laten we gaan! 🚀' }, next: 'go', tag: MISSION },
            { text: JOIN_PARTY, next: 'invite', tag: PARTY, if: (h) => !h.party.has('luna') },
            bye({ en: 'Maybe later.', nl: 'Later misschien.' }),
          ],
        },
        go: {
          onEnter: (h) => h.quest.start('firstflight', { track: true }),
          text: { en: "Awesome! I'll see you at the launch pads. Don't forget to wave in the chat!", nl: 'Super! Ik zie je bij de lanceerplatforms. Vergeet niet even te zwaaien in de chat!' },
          choices: [bye({ en: 'See you there!', nl: 'Tot zo!' })],
        },
        invite: invite('luna', { en: "Of course! Everything's more fun together. I'll follow you — I know all the fastest routes.", nl: 'Natuurlijk! Samen is alles leuker. Ik volg je wel — ik ken alle snelste routes.' }),
        plaza: {
          text: (h) =>
            h.night()
              ? {
                  en: "Oran sells the finest goods in the bazaar, the market terminal is next to the Tree of Life, and every night there's the Starfall Festival. It's night now — come with me to the stage!",
                  nl: 'Oran verkoopt de mooiste spullen in de bazaar, de marktterminal staat naast de Levensboom en elke nacht is er het Starfall Festival. Het is nu nacht — kom mee naar het podium!',
                }
              : {
                  en: "Oran sells the finest goods in the bazaar, the market terminal is next to the Tree of Life, and every night there's the Starfall Festival. Come back tonight — that's when it's at its most beautiful.",
                  nl: 'Oran verkoopt de mooiste spullen in de bazaar, de marktterminal staat naast de Levensboom en elke nacht is er het Starfall Festival. Kom vanavond terug, dan is het hier op z’n mooist.',
                },
          choices: [
            { text: { en: 'What mission?', nl: 'Welke missie?' }, next: 'mission', if: (h) => !h.quest.isDone('firstflight') },
            { text: { en: 'Start the festival!', nl: 'Start het festival!' }, next: 'festival', tag: EVENT, if: (h) => h.night() && !h.event.isActive('starfall') },
            bye({ en: 'Thanks, Luna.', nl: 'Bedankt, Luna.' }),
          ],
        },
        festival: {
          onEnter: (h) => h.event.start('starfall'),
          text: { en: 'Here we go! Look at the sky… and then at the stage. This is going to be a night to remember! ✨', nl: 'Daar gaan we! Kijk naar de lucht… en dan naar het podium. Dit wordt een avond om nooit te vergeten! ✨' },
          choices: [bye(LETS_GO)],
        },
        leave: {
          onEnter: (h) => h.party.leave('luna'),
          text: { en: "Okay! I'll stay here by the tree. Just send me a message if you need me.", nl: 'Oké! Ik blijf hier bij de boom. Stuur maar een berichtje als je me nodig hebt.' },
          choices: [bye({ en: 'See you later!', nl: 'Tot later!' })],
        },
        again: {
          text: (h) =>
            h.event.isActive('starfall')
              ? { en: 'What a light show, huh? ✨ Come on, closer to the stage!', nl: 'Wat een lichtshow, hè? ✨ Kom, dichter bij het podium!' }
              : h.party.has('luna')
                ? { en: 'Where are we headed, captain?', nl: 'Waar gaan we heen, kapitein?' }
                : { en: 'Hey, there you are again! What are we doing?', nl: 'Hé, daar ben je weer! Wat gaan we doen?' },
          choices: [
            { text: JOIN_PARTY, next: 'invite', tag: PARTY, if: (h) => !h.party.has('luna') },
            { text: { en: 'Stay here on the plaza.', nl: 'Blijf hier op het plein.' }, next: 'leave', if: (h) => h.party.has('luna') },
            { text: { en: 'What mission?', nl: 'Welke missie?' }, next: 'mission', if: (h) => !h.quest.isDone('firstflight') },
            { text: { en: 'What is there to do on the plaza?', nl: 'Wat is er te doen op het plein?' }, next: 'plaza' },
            bye({ en: 'See you later!', nl: 'Tot later!' }),
          ],
        },
      },
    },

    // ------------------------------------------------------------------ Kai
    kai: {
      id: 'kai',
      name: 'Kai',
      role: { en: 'Builder', nl: 'Bouwer' },
      accent: '#7ee8c9',
      home: 'plaza',
      backdrop: () => ZONES.plaza.tree, // the Levensboom behind them
      look: { body: 'm', hair: 'short', hairColor: '#1b1410', skin: '#8f5f42', outfit: '#1c1f25' },
      start: () => 'intro',
      nodes: {
        intro: {
          text: (h) =>
            h.party.has('kai')
              ? { en: "I'm in! What are we building?", nl: 'Ik ben erbij! Wat gaan we bouwen?' }
              : { en: "Yo, I'm in! You name it — building, exploring, or just chilling under the tree?", nl: 'Jo, ik ben erbij! Zeg het maar — bouwen, verkennen, of gewoon chillen onder de boom?' },
          choices: [
            { text: { en: 'How do I start building?', nl: 'Hoe begin ik met bouwen?' }, next: 'build', tag: MISSION },
            { text: JOIN_PARTY, next: 'invite', tag: PARTY, if: (h) => !h.party.has('kai') },
            { text: OWN_WAY, next: 'leave', if: (h) => h.party.has('kai') },
            { text: { en: 'Got a tip?', nl: 'Heb je een tip?' }, next: 'tip' },
            bye(LATER),
          ],
        },
        build: {
          onEnter: (h) => {
            h.quest.start('home', { track: true });
            h.quest.start('collector', { track: false });
          },
          text: {
            en: 'Head to the clearing at your base in the forest, press [B] and pick a foundation. Then walls, a roof and power — and your home is done. Need resources? Hold [E] at rocks and trees.',
            nl: 'Ga naar de open plek bij je basis in het bos, druk op [B] en kies een fundering. Dan muren, een dak en energie — en klaar is je thuis. Grondstoffen nodig? Houd [E] ingedrukt bij rotsen en bomen.',
          },
          choices: [{ text: { en: 'Got another tip?', nl: 'Heb je nog een tip?' }, next: 'tip' }, bye({ en: 'Thanks, Kai!', nl: 'Bedankt, Kai!' })],
        },
        tip: {
          text: (h) =>
            Math.random() < 0.5
              ? progressTip(h)
              : { en: '[R] rotates a building piece, [X] removes it. And in the Marketplace you can buy blueprints for statues and neon trees.', nl: 'Met [R] draai je een bouwdeel, met [X] haal je het weg. En in de marktplaats koop je blauwdrukken voor beelden en neonbomen.' },
          choices: [{ text: { en: 'How do I start building?', nl: 'Hoe begin ik met bouwen?' }, next: 'build' }, bye({ en: 'Great, thanks.', nl: 'Top, bedankt.' })],
        },
        invite: invite('kai', { en: "Yeah, I'm in! I'll bring my tools.", nl: 'Ja, ik ben erbij! Ik neem mijn gereedschap mee.' }),
        leave: { onEnter: (h) => h.party.leave('kai'), text: { en: "Fine, I'll go draw some more blueprints. See you soon!", nl: 'Prima, ik ga nog wat blauwdrukken tekenen. Tot zo!' }, choices: [bye()] },
      },
    },

    // ------------------------------------------------------------------ Nova
    nova: {
      id: 'nova',
      name: 'Nova',
      role: { en: 'Pilot', nl: 'Piloot' },
      accent: '#f0b46a',
      home: 'plaza',
      backdrop: () => ZONES.plaza.tree, // the Levensboom behind them
      look: { body: 'f', hair: 'short', hairColor: '#e8e2d6', skin: '#e6bf9e', outfit: '#1c1f25' },
      start: () => 'intro',
      nodes: {
        intro: {
          text: { en: "This place is beautiful ✨ But do you know what's even more beautiful? The view from three hundred meters up.", nl: 'Deze plek is prachtig ✨ Maar weet je wat nóg mooier is? Het uitzicht vanaf driehonderd meter hoogte.' },
          choices: [
            { text: { en: 'How do I get up there?', nl: 'Hoe kom ik daar?' }, next: 'vtol', tag: MISSION, if: (h) => !h.quest.isDone('highabove') },
            { text: { en: 'Tell me about space.', nl: 'Vertel eens over de ruimte.' }, next: 'space' },
            { text: JOIN_PARTY, next: 'invite', tag: PARTY, if: (h) => !h.party.has('nova') },
            { text: OWN_WAY, next: 'leave', if: (h) => h.party.has('nova') },
            bye(LATER),
          ],
        },
        vtol: {
          onEnter: (h) => h.quest.start('highabove', { track: true }),
          text: {
            en: "Grab the VTOL at the Spaceport, or call it up from your garage with [G]. [Space] to climb, [C] to descend. Above three hundred meters it'll leave you speechless, I promise.",
            nl: 'Pak de VTOL op de ruimtehaven, of roep hem op in je garage met [G]. [Spatie] om te stijgen, [C] om te dalen. Boven de driehonderd meter word je er stil van, beloofd.',
          },
          choices: [{ text: { en: 'Tell me about space.', nl: 'Vertel eens over de ruimte.' }, next: 'space' }, bye({ en: "I'll give it a try!", nl: 'Ik ga het proberen!' })],
        },
        space: {
          text: {
            en: 'Station Halo is a ring as big as a city. Below it lies an asteroid field where pirates lie in wait. Take your shields seriously — and never fly alone.',
            nl: 'Station Halo is een ring zo groot als een stad. Daaronder ligt een asteroïdenveld waar piraten op de loer liggen. Neem je schilden serieus — en vlieg nooit alleen.',
          },
          choices: [{ text: JOIN_PARTY, next: 'invite', tag: PARTY, if: (h) => !h.party.has('nova') }, bye({ en: 'Good to know.', nl: 'Goed om te weten.' })],
        },
        invite: invite('nova', { en: "Always! I'll fly right behind you.", nl: 'Altijd! Ik vlieg wel achter je aan.' }),
        leave: { onEnter: (h) => h.party.leave('nova'), text: { en: "Okay, I'm off to the hangar for a bit. Have a good flight!", nl: 'Oké, ik ga even naar de hangar. Goede vlucht!' }, choices: [bye()] },
      },
    },

    // ------------------------------------------------------------------ Yara
    yara: {
      id: 'yara',
      name: 'Yara',
      role: { en: 'Musician', nl: 'Muzikant' },
      accent: '#ff8ad8',
      home: 'plaza',
      backdrop: () => ZONES.plaza.tree, // the Levensboom behind them
      look: { body: 'f', hair: 'curly', hairColor: '#2a1712', skin: '#7a4d34', outfit: '#e9e4dc' },
      start: () => 'intro',
      nodes: {
        intro: {
          text: (h) =>
            h.event.isActive('starfall')
              ? { en: 'Hear that? This is my favorite song! Come closer to the stage!', nl: 'Hoor je dat? Dit is mijn favoriete nummer! Kom dichter bij het podium!' }
              : { en: "Tonight I'm playing at the Starfall Festival. Will you come and watch?", nl: 'Vanavond speel ik op het Starfall Festival. Kom je kijken?' },
          choices: [
            { text: { en: 'When does the festival start?', nl: 'Wanneer begint het festival?' }, next: 'when', if: (h) => !h.event.isActive('starfall') },
            { text: { en: "Let's start the festival!", nl: 'Laten we het festival starten!' }, next: 'start', tag: EVENT, if: (h) => h.night() && !h.event.isActive('starfall') },
            { text: JOIN_PARTY, next: 'invite', tag: PARTY, if: (h) => !h.party.has('yara') },
            bye(LATER),
          ],
        },
        when: {
          text: { en: 'As soon as the sun has set and the first stars fall. Just watch the sky — or start it from your journal [J].', nl: 'Zodra de zon onder is en de eerste sterren vallen. Kijk gewoon naar de lucht — of start het vanuit je journaal [J].' },
          choices: [bye({ en: "I'll be there!", nl: 'Ik ben erbij!' })],
        },
        start: { onEnter: (h) => h.event.start('starfall'), text: { en: 'Yesss! Lights on, volume up! 🎶', nl: 'Jaaa! Lichten aan, volume omhoog! 🎶' }, choices: [bye(LETS_GO)] },
        invite: invite('yara', { en: "Fun! I'll bring my guitar.", nl: 'Gezellig! Ik neem mijn gitaar mee.' }),
      },
    },

    // ------------------------------------------------------------------ Milan
    milan: {
      id: 'milan',
      name: 'Milan',
      role: { en: 'Explorer', nl: 'Ontdekkingsreiziger' },
      accent: '#8fe3a8',
      home: 'plaza',
      backdrop: () => ZONES.plaza.tree, // the Levensboom behind them
      look: { body: 'm', hair: 'swept', hairColor: '#4a2e1c', skin: '#d9a47c', beard: 'stubble', outfit: '#7a2a2a' },
      start: () => 'intro',
      nodes: {
        intro: {
          text: { en: 'I visited every waterfall this week. Did you know there are five? And those floating islands… one day I want to land on one.', nl: 'Ik heb deze week alle watervallen bezocht. Wist je dat er vijf zijn? En die zwevende eilanden… daar wil ik ooit landen.' },
          choices: [
            { text: { en: 'Where should I go?', nl: 'Waar moet ik heen?' }, next: 'where' },
            { text: { en: 'What do you know about the signal?', nl: 'Wat weet je van het signaal?' }, next: 'signal' },
            { text: JOIN_PARTY, next: 'invite', tag: PARTY, if: (h) => !h.party.has('milan') },
            bye(LATER),
          ],
        },
        where: { text: (h) => h.suggestPlace(), choices: [{ text: { en: 'What do you know about the signal?', nl: 'Wat weet je van het signaal?' }, next: 'signal' }, bye({ en: 'Thanks, Milan.', nl: 'Bedankt, Milan.' })] },
        signal: {
          text: {
            en: 'Sometimes the beacon sends out an echo that bounces back somewhere else in the world. Whoever finds it in time hears a piece of an ancient message.',
            nl: 'Soms stuurt het baken een echo uit die ergens anders in de wereld weerkaatst. Wie hem op tijd vindt, hoort een stukje van een oude boodschap.',
          },
          choices: [{ text: { en: 'Where should I go?', nl: 'Waar moet ik heen?' }, next: 'where' }, bye({ en: 'Interesting…', nl: 'Interessant…' })],
        },
        invite: invite('milan', { en: 'Gladly! I know the best viewpoints.', nl: 'Graag! Ik ken de mooiste uitzichtpunten.' }),
      },
    },

    // ------------------------------------------------------------------ Jules
    jules: {
      id: 'jules',
      name: 'Jules',
      role: { en: 'Flight Technician', nl: 'Vluchttechnicus' },
      accent: '#ff9a4a',
      home: 'spaceport',
      position: { x: 441, z: 233 },
      backdrop: () => ZONES.spaceport.pads.ship, // the ship behind him
      look: { body: 'm', hair: 'cap', hairColor: '#20160f', skin: '#a8714f', outfit: '#3a3f47' },
      start: (h) => (h.flag('julesBriefed') ? 'again' : 'intro'),
      nodes: {
        intro: {
          onEnter: (h) => {
            h.setFlag('julesBriefed');
            h.quest.start('firstflight', { track: true });
          },
          text: { en: "You must be the new pilot! I've checked every system: shields, thrust, navigation. She's ready for departure.", nl: 'Jij moet de nieuwe piloot zijn! Ik heb alle systemen nagelopen: schilden, stuwkracht, navigatie. Ze is klaar voor vertrek.' },
          choices: [
            { text: { en: 'How do I fly her?', nl: 'Hoe vlieg ik ermee?' }, next: 'controls' },
            { text: { en: 'Where can I go?', nl: 'Waar kan ik heen?' }, next: 'where' },
            { text: { en: "I'm ready.", nl: 'Ik ben er klaar voor.' }, next: 'ready' },
          ],
        },
        controls: {
          text: {
            en: 'Press [F] to board. [W] and [S] for thrust, the mouse to steer, [Space] to climb. High enough? Then [L] launches you into space.',
            nl: 'Druk op [F] om in te stappen. [W] en [S] voor stuwkracht, de muis om te sturen, [Spatie] om te stijgen. Hoog genoeg? Dan lanceert [L] je naar de ruimte.',
          },
          choices: [{ text: { en: 'Where can I go?', nl: 'Waar kan ik heen?' }, next: 'where' }, { text: { en: "I'm ready.", nl: 'Ik ben er klaar voor.' }, next: 'ready' }],
        },
        where: {
          text: {
            en: 'Above the atmosphere lies the asteroid field, and beyond it Station Halo. A convoy is asking for an escort — keep your eyes open for pirates.',
            nl: 'Boven de atmosfeer ligt het asteroïdenveld, en daarachter Station Halo. Een konvooi vraagt om escorte — houd je ogen open voor piraten.',
          },
          choices: [{ text: { en: 'How do I fly her?', nl: 'Hoe vlieg ik ermee?' }, next: 'controls' }, { text: { en: "I'm ready.", nl: 'Ik ben er klaar voor.' }, next: 'ready' }],
        },
        ready: { text: { en: 'Good luck up there. And bring her back in one piece, okay?', nl: 'Veel succes daarboven. En breng haar heelhuids terug, hè?' }, choices: [bye({ en: 'Will do!', nl: 'Komt goed!' })] },
        again: {
          text: { en: "Everything all right with your ship? I've fine-tuned the thrusters a bit more.", nl: 'Alles in orde met je schip? Ik heb de stuwraketten nog wat bijgesteld.' },
          choices: [
            { text: { en: 'How do I fly her?', nl: 'Hoe vlieg ik ermee?' }, next: 'controls' },
            { text: { en: 'Where can I go?', nl: 'Waar kan ik heen?' }, next: 'where' },
            bye({ en: 'All good, thanks.', nl: 'Alles top, bedankt.' }),
          ],
        },
      },
    },
  };
}

/** Short generic conversation for citizens / NPCs without a tree. */
export function genericTree(id, name, h) {
  const lines = h.night()
    ? [
        { en: "Beautiful night, isn't it? Look how the Tree of Life lights up.", nl: 'Mooie nacht, hè? Kijk hoe de Levensboom oplicht.' },
        { en: 'I heard meteors are falling tonight. The debris is full of energy!', nl: 'Ik hoorde dat er vannacht meteoren vallen. De brokstukken zitten vol energie!' },
        { en: "Are you going to the Starfall Festival too? Everyone's there.", nl: 'Ga je ook naar het Starfall Festival? Iedereen is er.' },
      ]
    : [
        { en: "Beautiful day, isn't it? Just look at that planet in the sky.", nl: 'Mooie dag, hè? Kijk eens naar die planeet aan de hemel.' },
        { en: 'Have you been to Nexus Plaza yet? Everyone gathers there.', nl: 'Ben je al op het Nexus-plein geweest? Iedereen komt daar samen.' },
        { en: "I'm saving up for a neon tree for my base. Almost there…", nl: 'Ik spaar voor een neonboom voor mijn basis. Nog even…' },
        { en: 'Have you climbed the Lookout yet? The view is breathtaking.', nl: 'Heb je de uitkijkpost al beklommen? Het uitzicht is adembenemend.' },
      ];
  return {
    id,
    name: name || { en: 'Resident', nl: 'Inwoner' },
    role: { en: 'Resident', nl: 'Inwoner' },
    accent: '#ece6dc',
    look: { body: id.length % 2 ? 'f' : 'm', hair: 'short', hairColor: '#2a1d15', skin: '#c68e67', outfit: '#1c1f25' },
    start: () => 'intro',
    nodes: {
      intro: { text: lines[Math.floor(Math.random() * lines.length)], choices: [{ text: { en: 'Got a tip?', nl: 'Heb je een tip?' }, next: 'tip' }, bye()] },
      tip: { text: (hh) => progressTip(hh), choices: [bye({ en: 'Thanks!', nl: 'Bedankt!' })] },
    },
  };
}
