/**
 * Dialogue trees ("Maak je eigen verhaal"). Each tree:
 *   { id, name, role, accent, home: zoneId, backdrop(ctx) → {x, z} (deep links: framed behind the NPC),
 *     approach: 'center' (deep links: stand on the zone-centre side), talkDist (deep links, m),
 *     cam: {zoom, shoulder, aim, pitch, npcX} (dialogue framing overrides),
 *     look: {...placeholder portrait}, start(h) → nodeId,
 *     nodes: { id: { text: string | (h) => string, onEnter(h), choices: [...] | (h) => [...] } } }
 * Choice: { text, next: nodeId, end: true, market: 'buy'|'sell'|'mine', if(h) → bool, do(h), tag }
 * `h` is the helper API built in story/dialogue.js (flags, quests, party, rewards, events …).
 */
import { ZONES } from '../../world/layout.js';

const bye = (text = 'Tot ziens.') => ({ text, end: true });

/** Tip based on the player's progress (used by several NPCs). */
function progressTip(h) {
  if (!h.quest.objectiveDone('horizon', 'lookout')) return 'Klim naar de uitkijkpost op de westelijke heuvels. Vanaf daar zie je bijna het hele meer — en de stad.';
  if (!h.flag('ruinsScanned')) return 'In de oude ruïnes, ten oosten van het uitzichtpunt, zit een inscriptie in de steen. Houd [E] ingedrukt om hem te scannen.';
  if (!h.flag('signalFound')) return 'Volg de oever van het meer naar het noorden. Daar pulseert het signaal — je kunt het niet missen.';
  if (h.quest.isActive('community')) return 'Op het Nexus-plein vind je Luna. En zeg gerust iets in de chat — druk op [Enter].';
  if (h.quest.isActive('firstflight')) return 'Jules wacht bij je schip op de ruimtehaven. Hij kent elke bout van dat ding.';
  if (h.quest.isActive('home')) return 'Op je basis in het bos druk je op [B] om te bouwen. Fundering eerst, dan muren, een dak en energie.';
  if (!h.quest.isDone('highabove')) return 'Pak eens de VTOL en klim boven de driehonderd meter. Het uitzicht is onbeschrijflijk.';
  return h.night() ? "Kijk 's nachts naar de lucht. Soms vallen er sterren — en die brokstukken zitten vol energie." : 'Ken je de vijf watervallen al? De grootste stort zich vlak bij de westelijke rivier in het meer.';
}

const invite = (id, line) => ({
  onEnter: (h) => h.party.join(id),
  // onEnter runs first: when the group was full the NPC says so instead
  text: (h) => (h.party.has(id) ? line : 'Je groep is al vol! Roep me maar als er weer plek is.'),
  choices: (h) => [bye(h.party.has(id) ? 'Top, laten we gaan.' : 'Oké, tot later.')],
});

export function buildTrees() {
  return {
    // ------------------------------------------------------------------ Aria
    aria: {
      id: 'aria',
      name: 'Aria',
      role: 'Signaalonderzoeker',
      accent: '#7fe0ff',
      home: 'signal',
      // deep links: the player stands south of Aria, the obelisk behind her (10_signal_aria.png)
      backdrop: (ctx) => ctx.landmarks?.beacon?.position || { x: ZONES.signal.x, z: ZONES.signal.z - 24 },
      look: { body: 'f', hair: 'ponytail', hairColor: '#21160f', skin: '#c99272', outfit: '#16181e' },
      start: (h) => (h.flag('metAria') ? 'again' : 'intro'),
      nodes: {
        intro: {
          onEnter: (h) => h.setFlag('metAria'),
          text: 'Deze plek heeft een geschiedenis die verder gaat dan wat we denken. Wat wil je doen?',
          choices: [
            { text: 'Vertel me meer over deze locatie.', next: 'history' },
            { text: 'Laten we samenwerken.', next: 'together', tag: 'Groep' },
            { text: 'Ik ga eerst verder verkennen.', next: 'later' },
          ],
        },
        history: {
          onEnter: (h) => h.lore('founders'),
          text: 'Dit baken zendt al eeuwen hetzelfde signaal uit: drie korte pulsen en één lange stilte. De Stichters bouwden het, lang voordat Aurora-stad bestond. Overal waar zij zijn geweest, vind je het Ø-symbool.',
          choices: [
            { text: 'Wie waren de Stichters?', next: 'founders' },
            { text: 'Wat betekent het Ø-symbool?', next: 'symbol' },
            { text: 'Laten we samenwerken.', next: 'together', tag: 'Groep', if: (h) => !h.party.has('aria') },
          ],
        },
        founders: {
          text: 'Niemand weet het zeker. Ze lieten geen namen achter — alleen ruïnes, inscripties en dit signaal. Alsof ze wilden dat iemand het ooit zou beantwoorden.',
          choices: [
            { text: 'Wat betekent het Ø-symbool?', next: 'symbol' },
            { text: 'Laten we samenwerken.', next: 'together', tag: 'Groep', if: (h) => !h.party.has('aria') },
            { text: 'Ik ga eerst verder verkennen.', next: 'later' },
          ],
        },
        symbol: {
          onEnter: (h) => h.lore('symbol'),
          text: 'Een cirkel, doorkruist door één lijn die verder reikt dan de cirkel zelf. Een einde dat ook een begin is. Ik denk dat het een uitnodiging is.',
          choices: [
            { text: 'Laten we samenwerken.', next: 'together', tag: 'Groep', if: (h) => !h.party.has('aria') },
            { text: 'Heb je een tip voor me?', next: 'tip' },
            { text: 'Ik ga eerst verder verkennen.', next: 'later' },
          ],
        },
        together: {
          onEnter: (h) => {
            h.party.join('aria');
            h.setFlag('ariaAlly');
            h.quest.start('community', { track: true });
          },
          text: (h) =>
            'Graag. Met z’n tweeën zien we meer dan alleen. ' +
            (h.flag('ruinsScanned')
              ? 'Jij hebt de inscriptie al gescand — dan is het Nexus-plein onze volgende stap. Daar vinden we mensen die ons kunnen helpen.'
              : 'Laten we beginnen bij de mensen op het Nexus-plein. En kom je langs de oude ruïnes: scan de inscriptie, dan probeer ik hem te ontcijferen.'),
          choices: [
            { text: 'Wat is het Nexus-plein?', next: 'plaza' },
            { text: 'Wat weet je van de ruimtehaven?', next: 'spaceport' },
            bye('Kom, we gaan.'),
          ],
        },
        plaza: {
          text: 'Het plein rond de Levensboom, die enorme paarse boom aan de oostkant van de baai. Iedereen komt daar samen. Luna weet altijd wat er speelt.',
          choices: [{ text: 'Wat weet je van de ruimtehaven?', next: 'spaceport' }, bye('Kom, we gaan.')],
        },
        spaceport: {
          text: 'Ten zuiden van het plein staan de schepen klaar die naar Station Halo vliegen. Als het signaal naar de sterren wijst, zullen we ooit moeten vertrekken.',
          choices: [{ text: 'Wat is het Nexus-plein?', next: 'plaza' }, bye('Kom, we gaan.')],
        },
        later: {
          text: 'Natuurlijk. Neem je tijd. Het signaal loopt niet weg — en ik ook niet. Je weet me te vinden.',
          choices: [bye('Tot later, Aria.')],
        },
        tip: {
          text: (h) => progressTip(h),
          choices: [{ text: 'Vertel me meer over deze locatie.', next: 'history' }, bye('Bedankt, Aria.')],
        },
        again: {
          text: (h) =>
            h.party.has('aria')
              ? 'Ik ben er. Het signaal klinkt sterker sinds we samen reizen. Wat heb je nodig?'
              : h.night()
                ? 'Zie je hoe het baken ’s nachts oplicht? Het lijkt wel of het ons roept. Wat heb je nodig?'
                : 'Het signaal klinkt sterker vandaag. Wat heb je nodig?',
          choices: [
            { text: 'Vertel me meer over deze locatie.', next: 'history' },
            { text: 'Ga je met me mee?', next: 'join', tag: 'Groep', if: (h) => !h.party.has('aria') },
            { text: 'Wacht hier even op me.', next: 'leave', if: (h) => h.party.has('aria') },
            { text: 'Heb je een tip voor me?', next: 'tip' },
            bye('Tot later.'),
          ],
        },
        join: invite('aria', 'Altijd. Met z’n tweeën zien we meer.'),
        leave: {
          onEnter: (h) => h.party.leave('aria'),
          text: 'Goed. Ik blijf bij het baken en luister naar het signaal. Roep me maar als je me nodig hebt.',
          choices: [bye('Tot snel.')],
        },
      },
    },

    // ------------------------------------------------------------------ Oran
    oran: {
      id: 'oran',
      name: 'Oran',
      role: 'Handelaar · Bazaar',
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
          text: 'Ik heb geruchten gehoord over een verloren schip in de Noordelijke Ringen…',
          choices: [
            { text: 'Vertel me meer over dat schip.', next: 'ship' },
            { text: 'Waar zijn de Noordelijke Ringen?', next: 'rings' },
            { text: 'Laat me zien wat je verkoopt.', market: 'buy', tag: 'Markt' },
          ],
        },
        ship: {
          text: 'De Zilveren Horizon. Een kolonieschip, veertig jaar geleden vertrokken met tweeduizend zielen aan boord. Het is nooit aangekomen. Maar piloten zweren dat ze tussen de ringen nog een noodsignaal opvangen…',
          choices: [
            { text: 'Ik ga het zoeken.', next: 'accept', tag: 'Missie', if: (h) => !h.quest.has('lostship') },
            { text: 'Waarom vertel je mij dit?', next: 'why' },
            { text: 'Waar zijn de Noordelijke Ringen?', next: 'rings' },
          ],
        },
        rings: {
          onEnter: (h) => h.lore('rings'),
          text: 'Voorbij de atmosfeer, ten noorden van de planeet: een gordel van ijs en gesteente. Je hebt een schip nodig — de ruimtehaven ligt ten zuiden van het plein.',
          choices: [
            { text: 'Vertel me meer over dat schip.', next: 'ship', if: (h) => !h.quest.has('lostship') },
            { text: 'Laat me zien wat je verkoopt.', market: 'buy', tag: 'Markt' },
            { text: 'Bedankt, Oran.', next: 'bye' },
          ],
        },
        why: {
          text: 'Omdat je de ogen hebt van een verkenner. En omdat een oude man als ik niet meer zo snel vliegt. Als je het vindt, deel je het verhaal met mij — afgesproken?',
          choices: [
            { text: 'Afgesproken. Ik ga het zoeken.', next: 'accept', tag: 'Missie', if: (h) => !h.quest.has('lostship') },
            { text: 'Laat me zien wat je verkoopt.', market: 'buy', tag: 'Markt' },
            bye('Ik denk er nog over na.'),
          ],
        },
        accept: {
          onEnter: (h) => {
            h.quest.start('lostship', { track: true });
            if (!h.flag('oranGift')) {
              h.setFlag('oranGift');
              h.reward({ resources: { energy: 20 } }, 'Oran gaf je een energiecel');
            }
          },
          text: 'Ha! Ik wist het. Neem deze energiecel mee uit mijn eigen voorraad. Vlieg naar de ringen en luister goed — en kom heelhuids terug.',
          choices: [{ text: 'Laat me zien wat je verkoopt.', market: 'buy', tag: 'Markt' }, bye('Tot ziens, Oran.')],
        },
        trade: {
          text: 'Metaal is schaars sinds ze in Aurora-stad nieuwe torens bouwen. Breng me grondstoffen en ik betaal je in Ø-credits. En die neonbomen? Die verkopen als warme broodjes!',
          choices: [{ text: 'Ik wil iets verkopen.', market: 'sell', tag: 'Markt' }, { text: 'Laat me zien wat je verkoopt.', market: 'buy', tag: 'Markt' }, bye()],
        },
        bye: { text: 'Moge de sterren je pad verlichten, reiziger.', choices: [bye()] },
        again: {
          text: (h) =>
            h.quest.isDone('lostship')
              ? 'Je hebt de Zilveren Horizon gevonden! Wat een verhaal… Kijk gerust rond, vriend. Voor jou altijd een eerlijke prijs.'
              : h.quest.isActive('lostship')
                ? 'Nog nieuws over de Zilveren Horizon? De ringen geven hun geheimen niet zomaar prijs.'
                : h.night()
                  ? 'Ah, de nachtmarkt is mooi vanavond, niet? Wat kan ik voor je doen?'
                  : 'Welkom terug, reiziger! Wat kan ik voor je doen?',
          choices: [
            { text: 'Vertel me over het verloren schip.', next: 'ship', if: (h) => !h.quest.has('lostship') },
            { text: 'Laat me zien wat je verkoopt.', market: 'buy', tag: 'Markt' },
            { text: 'Hoe gaat de handel?', next: 'trade' },
            bye(),
          ],
        },
      },
    },

    // ------------------------------------------------------------------ Luna
    luna: {
      id: 'luna',
      name: 'Luna_Ø',
      role: 'Gids · Nexus-plein',
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
              ? 'Hé, jij bent er ook! Het Starfall Festival is begonnen — zullen we naar het podium gaan?'
              : 'Hé, jij bent nieuw hier, toch? Welkom op het Nexus-plein! Zullen we de nieuwe missie proberen?',
          choices: [
            { text: 'Welke missie?', next: 'mission' },
            { text: 'Doe je mee met mijn groep?', next: 'invite', tag: 'Groep' },
            { text: 'Wat is er te doen op het plein?', next: 'plaza' },
          ],
        },
        mission: {
          text: 'Er staat een schip voor je klaar op de ruimtehaven, ten zuiden van hier. Jules, de vluchttechnicus, wacht op je. Je eerste vlucht naar de sterren — klinkt goed, toch?',
          choices: [
            { text: 'Laten we gaan! 🚀', next: 'go', tag: 'Missie' },
            { text: 'Doe je mee met mijn groep?', next: 'invite', tag: 'Groep', if: (h) => !h.party.has('luna') },
            bye('Later misschien.'),
          ],
        },
        go: {
          onEnter: (h) => h.quest.start('firstflight', { track: true }),
          text: 'Super! Ik zie je bij de lanceerplatforms. Vergeet niet even te zwaaien in de chat!',
          choices: [bye('Tot zo!')],
        },
        invite: invite('luna', 'Natuurlijk! Samen is alles leuker. Ik volg je wel — ik ken alle snelste routes.'),
        plaza: {
          text: (h) =>
            'Oran verkoopt de mooiste spullen in de bazaar, de marktterminal staat naast de Levensboom en elke nacht is er het Starfall Festival. ' +
            (h.night() ? 'Het is nu nacht — kom mee naar het podium!' : 'Kom vanavond terug, dan is het hier op z’n mooist.'),
          choices: [
            { text: 'Welke missie?', next: 'mission', if: (h) => !h.quest.isDone('firstflight') },
            { text: 'Start het festival!', next: 'festival', tag: 'Event', if: (h) => h.night() && !h.event.isActive('starfall') },
            bye('Bedankt, Luna.'),
          ],
        },
        festival: {
          onEnter: (h) => h.event.start('starfall'),
          text: 'Daar gaan we! Kijk naar de lucht… en dan naar het podium. Dit wordt een avond om nooit te vergeten! ✨',
          choices: [bye('Laten we gaan!')],
        },
        leave: {
          onEnter: (h) => h.party.leave('luna'),
          text: 'Oké! Ik blijf hier bij de boom. Stuur maar een berichtje als je me nodig hebt.',
          choices: [bye('Tot later!')],
        },
        again: {
          text: (h) =>
            h.event.isActive('starfall')
              ? 'Wat een lichtshow, hè? ✨ Kom, dichter bij het podium!'
              : h.party.has('luna')
                ? 'Waar gaan we heen, kapitein?'
                : 'Hé, daar ben je weer! Wat gaan we doen?',
          choices: [
            { text: 'Doe je mee met mijn groep?', next: 'invite', tag: 'Groep', if: (h) => !h.party.has('luna') },
            { text: 'Blijf hier op het plein.', next: 'leave', if: (h) => h.party.has('luna') },
            { text: 'Welke missie?', next: 'mission', if: (h) => !h.quest.isDone('firstflight') },
            { text: 'Wat is er te doen op het plein?', next: 'plaza' },
            bye('Tot later!'),
          ],
        },
      },
    },

    // ------------------------------------------------------------------ Kai
    kai: {
      id: 'kai',
      name: 'Kai',
      role: 'Bouwer',
      accent: '#7ee8c9',
      home: 'plaza',
      backdrop: () => ZONES.plaza.tree, // the Levensboom behind them
      look: { body: 'm', hair: 'short', hairColor: '#1b1410', skin: '#8f5f42', outfit: '#1c1f25' },
      start: () => 'intro',
      nodes: {
        intro: {
          text: (h) => (h.party.has('kai') ? 'Ik ben erbij! Wat gaan we bouwen?' : 'Jo, ik ben erbij! Zeg het maar — bouwen, verkennen, of gewoon chillen onder de boom?'),
          choices: [
            { text: 'Hoe begin ik met bouwen?', next: 'build', tag: 'Missie' },
            { text: 'Doe je mee met mijn groep?', next: 'invite', tag: 'Groep', if: (h) => !h.party.has('kai') },
            { text: 'Ga maar even je eigen gang.', next: 'leave', if: (h) => h.party.has('kai') },
            { text: 'Heb je een tip?', next: 'tip' },
            bye('Tot later.'),
          ],
        },
        build: {
          onEnter: (h) => {
            h.quest.start('home', { track: true });
            h.quest.start('collector', { track: false });
          },
          text: 'Ga naar de open plek bij je basis in het bos, druk op [B] en kies een fundering. Dan muren, een dak en energie — en klaar is je thuis. Grondstoffen nodig? Houd [E] ingedrukt bij rotsen en bomen.',
          choices: [{ text: 'Heb je nog een tip?', next: 'tip' }, bye('Bedankt, Kai!')],
        },
        tip: {
          text: (h) => (Math.random() < 0.5 ? progressTip(h) : 'Met [R] draai je een bouwdeel, met [X] haal je het weg. En in de marktplaats koop je blauwdrukken voor beelden en neonbomen.'),
          choices: [{ text: 'Hoe begin ik met bouwen?', next: 'build' }, bye('Top, bedankt.')],
        },
        invite: invite('kai', 'Ja, ik ben erbij! Ik neem mijn gereedschap mee.'),
        leave: { onEnter: (h) => h.party.leave('kai'), text: 'Prima, ik ga nog wat blauwdrukken tekenen. Tot zo!', choices: [bye()] },
      },
    },

    // ------------------------------------------------------------------ Nova
    nova: {
      id: 'nova',
      name: 'Nova',
      role: 'Piloot',
      accent: '#f0b46a',
      home: 'plaza',
      backdrop: () => ZONES.plaza.tree, // the Levensboom behind them
      look: { body: 'f', hair: 'short', hairColor: '#e8e2d6', skin: '#e6bf9e', outfit: '#1c1f25' },
      start: () => 'intro',
      nodes: {
        intro: {
          text: 'Deze plek is prachtig ✨ Maar weet je wat nóg mooier is? Het uitzicht vanaf driehonderd meter hoogte.',
          choices: [
            { text: 'Hoe kom ik daar?', next: 'vtol', tag: 'Missie', if: (h) => !h.quest.isDone('highabove') },
            { text: 'Vertel eens over de ruimte.', next: 'space' },
            { text: 'Doe je mee met mijn groep?', next: 'invite', tag: 'Groep', if: (h) => !h.party.has('nova') },
            { text: 'Ga maar even je eigen gang.', next: 'leave', if: (h) => h.party.has('nova') },
            bye('Tot later.'),
          ],
        },
        vtol: {
          onEnter: (h) => h.quest.start('highabove', { track: true }),
          text: 'Pak de VTOL op de ruimtehaven, of roep hem op in je garage met [G]. [Spatie] om te stijgen, [C] om te dalen. Boven de driehonderd meter word je er stil van, beloofd.',
          choices: [{ text: 'Vertel eens over de ruimte.', next: 'space' }, bye('Ik ga het proberen!')],
        },
        space: {
          text: 'Station Halo is een ring zo groot als een stad. Daaronder ligt een asteroïdenveld waar piraten op de loer liggen. Neem je schilden serieus — en vlieg nooit alleen.',
          choices: [{ text: 'Doe je mee met mijn groep?', next: 'invite', tag: 'Groep', if: (h) => !h.party.has('nova') }, bye('Goed om te weten.')],
        },
        invite: invite('nova', 'Altijd! Ik vlieg wel achter je aan.'),
        leave: { onEnter: (h) => h.party.leave('nova'), text: 'Oké, ik ga even naar de hangar. Goede vlucht!', choices: [bye()] },
      },
    },

    // ------------------------------------------------------------------ Yara
    yara: {
      id: 'yara',
      name: 'Yara',
      role: 'Muzikant',
      accent: '#ff8ad8',
      home: 'plaza',
      backdrop: () => ZONES.plaza.tree, // the Levensboom behind them
      look: { body: 'f', hair: 'curly', hairColor: '#2a1712', skin: '#7a4d34', outfit: '#e9e4dc' },
      start: () => 'intro',
      nodes: {
        intro: {
          text: (h) =>
            h.event.isActive('starfall')
              ? 'Hoor je dat? Dit is mijn favoriete nummer! Kom dichter bij het podium!'
              : 'Vanavond speel ik op het Starfall Festival. Kom je kijken?',
          choices: [
            { text: 'Wanneer begint het festival?', next: 'when', if: (h) => !h.event.isActive('starfall') },
            { text: 'Laten we het festival starten!', next: 'start', tag: 'Event', if: (h) => h.night() && !h.event.isActive('starfall') },
            { text: 'Doe je mee met mijn groep?', next: 'invite', tag: 'Groep', if: (h) => !h.party.has('yara') },
            bye('Tot later.'),
          ],
        },
        when: {
          text: 'Zodra de zon onder is en de eerste sterren vallen. Kijk gewoon naar de lucht — of start het vanuit je journaal [J].',
          choices: [bye('Ik ben erbij!')],
        },
        start: { onEnter: (h) => h.event.start('starfall'), text: 'Jaaa! Lichten aan, volume omhoog! 🎶', choices: [bye('Laten we gaan!')] },
        invite: invite('yara', 'Gezellig! Ik neem mijn gitaar mee.'),
      },
    },

    // ------------------------------------------------------------------ Milan
    milan: {
      id: 'milan',
      name: 'Milan',
      role: 'Ontdekkingsreiziger',
      accent: '#8fe3a8',
      home: 'plaza',
      backdrop: () => ZONES.plaza.tree, // the Levensboom behind them
      look: { body: 'm', hair: 'swept', hairColor: '#4a2e1c', skin: '#d9a47c', beard: 'stubble', outfit: '#7a2a2a' },
      start: () => 'intro',
      nodes: {
        intro: {
          text: 'Ik heb deze week alle watervallen bezocht. Wist je dat er vijf zijn? En die zwevende eilanden… daar wil ik ooit landen.',
          choices: [
            { text: 'Waar moet ik heen?', next: 'where' },
            { text: 'Wat weet je van het signaal?', next: 'signal' },
            { text: 'Doe je mee met mijn groep?', next: 'invite', tag: 'Groep', if: (h) => !h.party.has('milan') },
            bye('Tot later.'),
          ],
        },
        where: { text: (h) => h.suggestPlace(), choices: [{ text: 'Wat weet je van het signaal?', next: 'signal' }, bye('Bedankt, Milan.')] },
        signal: {
          text: 'Soms stuurt het baken een echo uit die ergens anders in de wereld weerkaatst. Wie hem op tijd vindt, hoort een stukje van een oude boodschap.',
          choices: [{ text: 'Waar moet ik heen?', next: 'where' }, bye('Interessant…')],
        },
        invite: invite('milan', 'Graag! Ik ken de mooiste uitzichtpunten.'),
      },
    },

    // ------------------------------------------------------------------ Jules
    jules: {
      id: 'jules',
      name: 'Jules',
      role: 'Vluchttechnicus',
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
          text: 'Jij moet de nieuwe piloot zijn! Ik heb alle systemen nagelopen: schilden, stuwkracht, navigatie. Ze is klaar voor vertrek.',
          choices: [
            { text: 'Hoe vlieg ik ermee?', next: 'controls' },
            { text: 'Waar kan ik heen?', next: 'where' },
            { text: 'Ik ben er klaar voor.', next: 'ready' },
          ],
        },
        controls: {
          text: 'Druk op [F] om in te stappen. [W] en [S] voor stuwkracht, de muis om te sturen, [Spatie] om te stijgen. Hoog genoeg? Dan lanceert [L] je naar de ruimte.',
          choices: [{ text: 'Waar kan ik heen?', next: 'where' }, { text: 'Ik ben er klaar voor.', next: 'ready' }],
        },
        where: {
          text: 'Boven de atmosfeer ligt het asteroïdenveld, en daarachter Station Halo. Een konvooi vraagt om escorte — houd je ogen open voor piraten.',
          choices: [{ text: 'Hoe vlieg ik ermee?', next: 'controls' }, { text: 'Ik ben er klaar voor.', next: 'ready' }],
        },
        ready: { text: 'Veel succes daarboven. En breng haar heelhuids terug, hè?', choices: [bye('Komt goed!')] },
        again: {
          text: 'Alles in orde met je schip? Ik heb de stuwraketten nog wat bijgesteld.',
          choices: [{ text: 'Hoe vlieg ik ermee?', next: 'controls' }, { text: 'Waar kan ik heen?', next: 'where' }, bye('Alles top, bedankt.')],
        },
      },
    },
  };
}

/** Short generic conversation for citizens / NPCs without a tree. */
export function genericTree(id, name, h) {
  const lines = h.night()
    ? [
        'Mooie nacht, hè? Kijk hoe de Levensboom oplicht.',
        'Ik hoorde dat er vannacht meteoren vallen. De brokstukken zitten vol energie!',
        'Ga je ook naar het Starfall Festival? Iedereen is er.',
      ]
    : [
        'Mooie dag, hè? Kijk eens naar die planeet aan de hemel.',
        'Ben je al op het Nexus-plein geweest? Iedereen komt daar samen.',
        'Ik spaar voor een neonboom voor mijn basis. Nog even…',
        'Heb je de uitkijkpost al beklommen? Het uitzicht is adembenemend.',
      ];
  return {
    id,
    name: name || 'Inwoner',
    role: 'Inwoner',
    accent: '#ece6dc',
    look: { body: id.length % 2 ? 'f' : 'm', hair: 'short', hairColor: '#2a1d15', skin: '#c68e67', outfit: '#1c1f25' },
    start: () => 'intro',
    nodes: {
      intro: { text: lines[Math.floor(Math.random() * lines.length)], choices: [{ text: 'Heb je een tip?', next: 'tip' }, bye()] },
      tip: { text: (hh) => progressTip(hh), choices: [bye('Bedankt!')] },
    },
  };
}
