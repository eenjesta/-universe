/**
 * Chat widget (bottom-left, above the minimap; modes explore/drive) in the
 * poster style: dark rounded panel, coloured names, emoji. Enter/T focuses
 * the input (gameplay input is blocked while typing), the player posts as
 * "Jij", NPCs reply via the intent engine (context-aware), ambient plaza and
 * festival chatter, party remarks, speech bubbles via npc.say.
 * Emits chat:message {from, text, color, self} and chat:sent {text}.
 */
import '../css/chat.css';
import { ZONES } from '../../world/layout.js';
import { detectIntents, primaryIntent, replyFor } from './intents.js';
import { POSTER_TALK, PLAZA_LINES, FESTIVAL_LINES, WORLD_LINES, ZONE_REMARKS, PARTY_BANTER } from './lines.js';
import { fill, hourOf, isNight, partOfDay, playerPos, pick, zoneLabel, zoneAtText } from '../shared/util.js';

/** Speakers: named NPCs + a few "online players". */
const SPEAKERS = {
  luna: { name: 'Luna_Ø', color: '#c7a8ff' },
  kai: { name: 'Kai', color: '#7ee8c9' },
  nova: { name: 'Nova', color: '#f3c27f' },
  aria: { name: 'Aria', color: '#7fe0ff' },
  oran: { name: 'Oran', color: '#ffb36b' },
  yara: { name: 'Yara', color: '#ff9ade' },
  milan: { name: 'Milan', color: '#9fe8b4' },
  jules: { name: 'Jules', color: '#ffa25e' },
  'Mira_Ø': { name: 'Mira_Ø', color: '#ffb8a0' },
  Jonas: { name: 'Jonas', color: '#a9bbff' },
  StarRider: { name: 'StarRider', color: '#8fd7ff' },
};
const NAMED = ['luna', 'kai', 'nova', 'aria', 'oran', 'yara', 'milan', 'jules'];
const ONLINE = ['luna', 'kai', 'nova', 'Mira_Ø', 'StarRider', 'Jonas'];
const MAX_LINES = 40;

export function createChat(ctx, { sys, refs, portraits }) {
  const { ui, state } = ctx;

  // ---------------------------------------------------------------- DOM
  const log = ui.h('div', { class: 'sys-chat-log', role: 'log', 'aria-live': 'polite' });
  const input = ui.h('input', {
    class: 'sys-chat-input',
    type: 'text',
    maxlength: '140',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: 'Druk op Enter om te chatten',
    'aria-label': 'Chatbericht',
  });
  const suggest = ui.h('div', { class: 'sys-chat-suggest' });
  const sendBtn = ui.h('button', { class: 'sys-chat-send', title: 'Versturen', html: ui.icon('sys-send', 15), onclick: () => submit() });
  const row = ui.h('div', { class: 'sys-chat-row' }, ui.h('span', { class: 'sys-chat-ic', html: ui.icon('chat', 15) }), input, sendBtn);
  const el = ui.h('div', { class: 'sys-chat' }, log, suggest, row);
  ui.addWidget('bottom-left', el, { modes: ['explore', 'drive'], order: 20 });
  el.addEventListener('mousedown', (e) => {
    if (e.target !== input && !e.target.closest('button')) {
      e.preventDefault();
      open();
    }
  });

  // ---------------------------------------------------------------- lines
  const lines = []; // {el, t}
  let lastActivity = 0;
  const now = () => ctx.loop.realTime;

  function colorOf(from) {
    return SPEAKERS[from]?.color || '#ece6dc';
  }

  /** Round avatar before a chat line: NPC face (cached), Ø for the player, monogram otherwise. */
  function avatarEl(from, name, color, self) {
    const av = ui.h('span', { class: 'sys-chat-av' });
    av.style.setProperty('--c', color);
    let url = null;
    if (!self && NAMED.includes(from) && portraits?.faceURL) {
      av.dataset.av = from;
      // the face is cropped from the NPC's portrait; until that has been rendered (in the
      // background) the avatar shows a monogram, then every line of that NPC gets the face
      url = portraits.faceURL(from, refs.dialogue?.trees?.[from], 40, (u) => u && applyFace(from, u));
    }
    if (url) av.style.backgroundImage = `url(${url})`;
    else av.textContent = self ? 'Ø' : (name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || '?';
    if (self) av.classList.add('self');
    return av;
  }

  function applyFace(id, url) {
    for (const av of log.querySelectorAll(`.sys-chat-av[data-av="${id}"]`)) {
      av.textContent = '';
      av.style.backgroundImage = `url(${url})`;
    }
  }

  function addLine({ from, name, text, color, kind = 'msg', self = false }) {
    const system = kind === 'system';
    const line = ui.h(
      'div',
      { class: `sys-chat-line k-${kind}${self ? ' self' : ''}` },
      system ? ui.h('span', { class: 'sys-chat-lic', html: ui.icon('sparkle', 13) }) : avatarEl(from, name, color, self),
      ui.h(
        'span',
        { class: 'sys-chat-body' },
        system ? null : ui.h('span', { class: 'sys-chat-name', style: { color }, text: `${name}:` }),
        ui.h('span', { class: 'sys-chat-text', text }),
      ),
    );
    log.appendChild(line);
    lines.push({ el: line, t: now() });
    while (lines.length > MAX_LINES) lines.shift().el.remove();
    log.scrollTop = log.scrollHeight;
    lastActivity = now();
    el.classList.remove('idle');
    return line;
  }

  /** Public: post a line as `from` (npc id, speaker key or display name). */
  function post(from, text, { color, self = false, kind = 'msg' } = {}) {
    if (!text) return;
    const sp = SPEAKERS[from];
    const name = self ? 'Jij' : sp?.name || from || '???';
    const col = color || (self ? '#ffffff' : colorOf(from));
    addLine({ from, name, text, color: col, kind, self });
    if (!self && kind !== 'system') ctx.audio.play('chat', { volume: 0.6 });
    ctx.events.emit('chat:message', { from: name, text, color: col, self, kind });
  }

  function system(text) {
    addLine({ text, kind: 'system', color: '#7fe0ff' });
    ctx.events.emit('chat:message', { from: 'Systeem', text, color: '#7fe0ff', self: false, kind: 'system' });
  }

  /** NPC line + speech bubble if the NPC is nearby. */
  function npcSay(id, text, { kind = 'msg', bubble = true } = {}) {
    post(id, text, { kind });
    if (!bubble) return;
    try {
      const npc = ctx.npcs?.get?.(id);
      const p = playerPos(ctx);
      if (npc?.say && p && npc.position && npc.position.distanceTo(p) < 45) npc.say(text, Math.min(7, 2.5 + text.length / 18));
    } catch {
      /* bubbles are optional */
    }
  }

  // ---------------------------------------------------------------- scheduler (game time, pauses with the game)
  const queue = [];
  function later(seconds, fn) {
    queue.push({ at: ctx.loop.time + seconds, fn });
  }
  let typingLine = null;
  function showTyping(id) {
    hideTyping();
    const sp = SPEAKERS[id];
    const name = sp?.name || id;
    typingLine = ui.h(
      'div',
      { class: 'sys-chat-line k-typing' },
      avatarEl(id, name, colorOf(id), false),
      ui.h('span', { class: 'sys-chat-body' }, ui.h('span', { class: 'sys-chat-name', style: { color: colorOf(id) }, text: name }), ui.h('span', { class: 'sys-chat-dots' }, ui.h('i'), ui.h('i'), ui.h('i'))),
    );
    log.appendChild(typingLine);
    log.scrollTop = log.scrollHeight;
  }
  function hideTyping() {
    typingLine?.remove();
    typingLine = null;
  }

  // ---------------------------------------------------------------- context for replies
  function context(speaker, text = '') {
    const q = refs.quests?.active;
    const cur = q?.objectives?.find((o) => o.current) || q?.objectives?.find((o) => !o.done);
    const party = refs.party?.members || [];
    const z = refs.zones?.current;
    const p = playerPos(ctx);
    return {
      speaker,
      text,
      pos: p ? { x: p.x, z: p.z } : null,
      player: state.get('profile.name') || 'Reiziger',
      zone: zoneLabel(z),
      zoneLabel: z ? zoneLabel(z) : '',
      at: z ? zoneAtText(z) : '',
      night: isNight(ctx),
      dagdeel: partOfDay(ctx),
      clock: clockText(),
      quest: q,
      objective: cur?.text?.replace(/\s*\(\d+\/\d+\)$/, '') || '',
      partySize: party.length,
      partyIds: party,
      partyNames: party.map((id) => SPEAKERS[id]?.name || id).join(' en '),
      festival: !!refs.events?.isActive('starfall'),
      meteors: !!refs.events?.isActive('meteors'),
      nearPlaza: !!p && Math.hypot(p.x - ZONES.plaza.x, p.z - ZONES.plaza.z) < 110,
    };
  }

  function clockText() {
    const h = hourOf(ctx);
    const m = Math.floor((h % 1) * 60);
    return `${Math.floor(h)}:${String(m).padStart(2, '0')}`;
  }

  function nearestNamed(maxDist) {
    const p = playerPos(ctx);
    if (!p) return null;
    let best = null;
    let bd = maxDist;
    for (const id of NAMED) {
      const n = ctx.npcs?.get?.(id)?.position;
      if (!n) continue;
      const d = n.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  function respondersFor(text) {
    const lower = text.toLowerCase();
    const mentioned = NAMED.filter((id) => lower.includes(id) || lower.includes((SPEAKERS[id].name || '').toLowerCase()));
    if (mentioned.length) return mentioned.slice(0, 2);
    const party = refs.party?.members || [];
    if (party.length) return [pick(party)];
    const near = nearestNamed(28);
    if (near) return [near];
    const c = context();
    if (c.nearPlaza) return [pick(['luna', 'kai', 'nova', 'yara', 'milan'])];
    return [pick(ONLINE)];
  }

  function reply(text) {
    const intents = detectIntents(text);
    const intent = primaryIntent(intents, text);
    const who = respondersFor(text);
    // greetings / festival hype get a second voice sometimes
    if ((intent === 'greet' || intent === 'festival' || intent === 'emoji') && who.length === 1 && Math.random() < 0.55) {
      const other = pick(ONLINE.filter((x) => x !== who[0]));
      who.push(other);
    }
    let delay = 0.9 + Math.random() * 0.8;
    who.forEach((id, i) => {
      const at = delay;
      later(Math.max(0.2, at - 0.7), () => showTyping(id));
      later(at, () => {
        hideTyping();
        const c = context(id, text);
        let line = fill(replyFor(intent, c), { player: c.player, zone: c.zoneLabel || 'hier', at: c.at || 'hier', dagdeel: c.dagdeel, speakerName: SPEAKERS[id]?.name || id });
        // a party invite through chat: a nearby named NPC joins
        if (intent === 'party' && NAMED.includes(id) && !refs.party?.has(id) && !refs.party?.full?.() && ctx.npcs?.get?.(id) && nearestNamed(40) === id) {
          line = pick(['Ik kom eraan! 🙌', 'Ja! Ik volg je.', 'Gezellig, ik doe mee!']);
          later(0.6, () => refs.party?.join(id));
        }
        npcSay(id, line, { kind: refs.party?.has(id) ? 'party' : 'msg' });
      });
      delay += 1.2 + Math.random() * 1.1 + i * 0.3;
    });
  }

  // ---------------------------------------------------------------- input
  let focused = false;
  function open() {
    if (focused || ui.isModalOpen() || !ctx.modes.is('explore', 'drive')) return;
    renderSuggestions();
    input.focus({ preventScroll: true });
  }
  function closeInput() {
    if (document.activeElement === input) input.blur();
  }
  input.addEventListener('focus', () => {
    focused = true;
    el.classList.add('focused');
    el.classList.remove('idle');
    ctx.input.block('chat', true);
  });
  input.addEventListener('blur', () => {
    focused = false;
    el.classList.remove('focused');
    ctx.input.block('chat', false);
    lastActivity = now();
  });
  input.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      submit();
      closeInput();
    }
    e.stopPropagation();
  });

  function submit() {
    const text = input.value.trim();
    input.value = '';
    if (text) send(text);
  }

  /** Public: the player says something in the chat. */
  function send(text) {
    text = String(text || '').trim().slice(0, 140);
    if (!text) return false;
    post('Jij', text, { self: true });
    ctx.events.emit('chat:sent', { text });
    reply(text);
    return true;
  }

  function renderSuggestions() {
    const c = context();
    const opts = ['Hoi! 👋', 'Laten we gaan! 🚀'];
    if (c.festival) opts.push('Wat een show! ✨');
    else if (c.quest) opts.push('Wat is de missie?');
    else opts.push('Wat kan ik doen?');
    suggest.textContent = '';
    for (const t of opts) {
      suggest.appendChild(
        ui.h('button', {
          class: 'sys-chat-chip',
          text: t,
          onmousedown: (e) => {
            e.preventDefault();
            send(t);
            closeInput();
          },
        }),
      );
    }
  }

  // ---------------------------------------------------------------- ambient chatter
  let ambientAt = 8;
  let worldAt = 40;
  let posterPlayed = false;
  const remarked = new Set();

  // party banter on story beats: one voice, a moment after the banner; when several beats
  // land together (scan → quest done) the most specific line (highest prio) is spoken
  let banterAt = -1e9;
  let pendingBanter = null;
  function banter(kind, vars = {}, who = null, prio = 0) {
    if (!(refs.party?.members || []).length || !PARTY_BANTER[kind]) return;
    if (pendingBanter) {
      if (prio > pendingBanter.prio) pendingBanter = { kind, vars, who, prio };
      return;
    }
    if (ctx.loop.time - banterAt < 6) return;
    pendingBanter = { kind, vars, who, prio };
    later(1.6, () => {
      const b = pendingBanter;
      pendingBanter = null;
      const members = refs.party?.members || [];
      if (!b || !members.length) return;
      banterAt = ctx.loop.time;
      const id = b.who && members.includes(b.who) ? b.who : pick(members);
      npcSay(id, fill(pick(PARTY_BANTER[b.kind]), b.vars), { kind: 'party' });
    });
  }
  ctx.events.on('quest:complete', ({ id } = {}) => {
    const def = refs.quests?.defs?.get?.(id);
    if (def && def.type !== 'event') banter('quest', { quest: def.title });
  });
  ctx.events.on('progress:level', ({ level } = {}) => banter('level', { level }));
  ctx.events.on('event:start', ({ id } = {}) => {
    if (id === 'starfall') banter('festival');
    else if (id === 'meteors') banter('meteors');
  });
  ctx.events.on('scan:complete', ({ target } = {}) => {
    if (target === 'ruins' && refs.party?.has?.('aria')) banter('ruinsAria', {}, 'aria', 1);
  });

  sys.on('zone', ({ zone }) => {
    if (!zone) return;
    // first visit to the plaza: the poster conversation
    if (zone === 'plaza' && !posterPlayed) {
      posterPlayed = true;
      POSTER_TALK.forEach(([id, text], i) => later(1.5 + i * 2.6, () => npcSay(id, text)));
      ambientAt = ctx.loop.time + 14;
    }
    // party remarks, once per zone per session
    const party = refs.party?.members || [];
    if (party.length && !remarked.has(zone)) {
      remarked.add(zone);
      const id = party.includes('aria') ? 'aria' : party[0];
      const text = ZONE_REMARKS[id]?.[zone] || ZONE_REMARKS.default[zone];
      if (text) later(2.2, () => npcSay(id, text, { kind: 'party' }));
    }
  });

  function tick() {
    const t = ctx.loop.time;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].at <= t) {
        const job = queue.splice(i, 1)[0];
        try {
          job.fn();
        } catch (err) {
          console.warn('[chat] job failed', err);
        }
      }
    }
    if (!ctx.modes.is('explore', 'drive')) return;
    if (t < ambientAt && t < worldAt) {
      if (!focused && now() - lastActivity > 14 && !el.classList.contains('idle')) el.classList.add('idle');
      return;
    }
    const pp = playerPos(ctx);
    const c = {
      festival: !!refs.events?.isActive('starfall'),
      nearPlaza: !!pp && Math.hypot(pp.x - ZONES.plaza.x, pp.z - ZONES.plaza.z) < 110,
    };
    if (t >= ambientAt) {
      if (c.festival && c.nearPlaza) {
        const [id, text] = pick(FESTIVAL_LINES);
        npcSay(id, text);
        ambientAt = t + 7 + Math.random() * 7;
      } else if (c.nearPlaza) {
        const [id, text] = pick(PLAZA_LINES);
        npcSay(id, text);
        ambientAt = t + 11 + Math.random() * 12;
      } else ambientAt = t + 5;
    }
    if (t >= worldAt) {
      if (!c.nearPlaza) {
        const [id, text] = pick(WORLD_LINES);
        post(id, text);
      }
      worldAt = t + 55 + Math.random() * 45;
    }
    // fade old lines when idle
    if (!focused && now() - lastActivity > 14 && !el.classList.contains('idle')) el.classList.add('idle');
  }

  let fadeAcc = 0;
  ctx.loop.add(
    'sys-chat',
    (dt) => {
      if (!focused && ctx.input.actionPressed('chat') && !ui.isModalOpen() && ctx.modes.is('explore', 'drive')) open();
      fadeAcc += dt;
      if (fadeAcc < 0.1) return;
      fadeAcc = 0;
      tick();
    },
    { order: 48 },
  );

  ctx.events.on('mode:change', ({ to }) => {
    if (to !== 'explore' && to !== 'drive') closeInput();
  });

  // greeting lines so the panel is never empty
  system('Welkom in Ø Universe! Zeg hallo tegen de andere reizigers.');
  later(4, () => post('luna', 'Hoi allemaal! 👋'));
  later(6.5, () => post('kai', 'Jo! 🙌'));

  return {
    post,
    send,
    system,
    say: npcSay,
    open,
    close: closeInput,
    get isOpen() {
      return focused;
    },
    get lines() {
      return lines.map((l) => l.el.textContent);
    },
    speakers: SPEAKERS,
    el,
  };
}
