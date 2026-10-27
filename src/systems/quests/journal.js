/**
 * Journal modal (J): "Missies & verhalen" — active / completed quests with
 * objectives and rewards (track a quest with "Volgen"), unlocked lore, live
 * world events (start the Starfall Festival from here), level + XP bar and
 * discovery stats.
 */
import '../css/journal.css';
import { TRAVEL } from '../../world/layout.js';
import { fmt, RESOURCE_LABELS } from '../shared/util.js';
import { QUEST_TYPE_LABEL } from './data.js';
import { LORE, LORE_ORDER } from '../story/lore.js';
import { ITEM } from '../economy/items.js';

const MODAL = 'journal';
const TABS = [
  { id: 'active', label: 'Actief', icon: 'sys-diamond' },
  { id: 'done', label: 'Voltooid', icon: 'check-circle' },
  { id: 'lore', label: 'Verhalen', icon: 'book' },
  { id: 'events', label: 'Evenementen', icon: 'sys-flag' },
];

export function createJournal(ctx, { quests, progress, rewards, refs, sys }) {
  const { ui, state } = ctx;
  let tab = 'active';
  let sel = null;
  let r = null;

  function build() {
    const o = {};
    o.level = ui.h('div', { class: 'sys-jrn-level' });
    o.stats = ui.h('div', { class: 'sys-jrn-stats' });
    o.nav = ui.h('nav', { class: 'sys-jrn-nav' });
    o.list = ui.h('div', { class: 'sys-jrn-list scroll' });
    o.detail = ui.h('div', { class: 'sys-jrn-detail scroll' });
    o.el = ui.h(
      'div',
      { class: 'sys-jrn', role: 'dialog', 'aria-label': 'Journaal' },
      ui.h(
        'div',
        { class: 'sys-jrn-head' },
        ui.h('div', { class: 'sys-jrn-title' }, ui.h('span', { class: 'sys-jrn-ticon', html: ui.icon('book', 22) }), ui.h('div', {}, ui.h('div', { class: 'title-md', text: 'Missies & verhalen' }), ui.h('div', { class: 'sys-jrn-subtitle', text: 'Maak je eigen verhaal' }))),
        o.level,
        o.stats,
        ui.h('button', { class: 'modal-close', title: 'Sluiten (Esc)', html: ui.icon('close', 18), onclick: () => close() }),
      ),
      ui.h('div', { class: 'sys-jrn-main' }, o.nav, o.list, o.detail),
      ui.h('div', { class: 'sys-jrn-foot', html: '<span class="kbd">J</span> sluiten &nbsp;·&nbsp; <span class="kbd">Esc</span> terug naar het spel' }),
    );
    return o;
  }

  // ---------------------------------------------------------------- data
  const lists = () => {
    const all = quests.list();
    return {
      active: all.filter((q) => q.status === 'active').sort((a, b) => rank(a) - rank(b)),
      done: all.filter((q) => q.status === 'done').sort((a, b) => (b.completed || 0) - (a.completed || 0)),
    };
  };
  const rank = (q) => (q.id === quests.activeId ? -1 : { main: 0, event: 1, space: 2, side: 3 }[q.type] ?? 4);
  const unlockedLore = () => LORE_ORDER.filter((id) => rewards.hasLore(id));

  // ---------------------------------------------------------------- render
  function render() {
    if (!r) return;
    const info = progress.levelInfo();
    r.level.innerHTML = '';
    r.level.append(
      ui.h('div', { class: 'sys-jrn-lvl', title: `Niveau ${info.level}` }, ui.h('span', { class: 'sys-jrn-lvl-n', text: String(info.level) })),
      ui.h(
        'div',
        { class: 'sys-jrn-xp' },
        ui.h('div', { class: 'sys-jrn-xp-h' }, ui.h('span', { text: `Niveau ${info.level}` }), ui.h('span', { class: 'sys-jrn-xp-t', text: `${fmt(info.xp)} / ${fmt(info.to)} XP` })),
        ui.h('div', { class: 'bar' }, ui.h('i')),
      ),
    );
    r.level.querySelector('.bar > i').style.setProperty('--v', info.t);
    const disc = TRAVEL.concat(['city']).filter((z) => progress.isDiscovered(z)).length;
    r.stats.innerHTML = '';
    r.stats.append(
      ui.h('span', { class: 'chip', html: `${ui.icon('pin', 14)}<span>${disc}/${TRAVEL.length + 1} locaties</span>` }),
      ui.h('span', { class: 'chip sys-jrn-gold', html: `${ui.icon('sys-credit', 14)}<span>${fmt(state.get('credits') || 0)}</span>` }),
    );

    const L = lists();
    const counts = { active: L.active.length, done: L.done.length, lore: unlockedLore().length, events: refs.events?.list?.().filter((e) => e.active).length || 0 };
    r.nav.textContent = '';
    for (const t of TABS) {
      r.nav.appendChild(
        ui.h(
          'button',
          {
            class: `sys-jrn-tab${tab === t.id ? ' active' : ''}`,
            onclick: () => {
              tab = t.id;
              sel = null;
              ctx.audio.play('ui.click');
              render();
            },
          },
          ui.h('span', { class: 'sys-jrn-tic', html: ui.icon(t.icon, 16) }),
          ui.h('span', { text: t.label }),
          counts[t.id] ? ui.h('b', { text: String(counts[t.id]) }) : null,
        ),
      );
    }

    r.list.textContent = '';
    if (tab === 'active' || tab === 'done') renderQuests(L[tab]);
    else if (tab === 'lore') renderLore();
    else renderEvents();
  }

  function renderQuests(items) {
    if (!items.length) {
      r.list.appendChild(ui.h('div', { class: 'sys-jrn-empty', text: tab === 'active' ? 'Geen actieve missies. Verken de wereld of praat met mensen op het Nexus-plein.' : 'Nog geen voltooide missies.' }));
      r.detail.textContent = '';
      return;
    }
    if (!sel || !items.some((q) => q.id === sel)) sel = items[0].id;
    for (const q of items) {
      const req = q.objectives.filter((o) => !o.optional);
      const done = req.filter((o) => o.done).length;
      r.list.appendChild(
        ui.h(
          'button',
          {
            class: `sys-jrn-item${sel === q.id ? ' sel' : ''}${q.id === quests.activeId ? ' tracked' : ''}`,
            dataset: { type: q.type },
            onclick: () => {
              sel = q.id;
              ctx.audio.play('ui.click');
              render();
            },
          },
          ui.h('span', { class: 'sys-jrn-iic', html: ui.icon(q.status === 'done' ? 'sys-diamond-check' : 'sys-diamond', 18) }),
          ui.h(
            'span',
            { class: 'sys-jrn-itext' },
            ui.h('span', { class: 'sys-jrn-iname', text: q.title }),
            ui.h('span', { class: 'sys-jrn-imeta', text: `${QUEST_TYPE_LABEL[q.type] || ''}${q.status === 'active' ? ` · ${done}/${req.length}` : ''}` }),
          ),
          q.id === quests.activeId ? ui.h('span', { class: 'sys-jrn-badge', text: 'Gevolgd' }) : null,
        ),
      );
    }
    renderQuestDetail(quests.get(sel));
  }

  function rewardChips(rw = {}) {
    const chips = [];
    if (rw.xp) chips.push(ui.h('span', { class: 'sys-jrn-rw xp', html: `${ui.icon('sparkle', 14)}<span>+${fmt(rw.xp)} XP</span>` }));
    if (rw.credits) chips.push(ui.h('span', { class: 'sys-jrn-rw cr', html: `${ui.icon('sys-credit', 14)}<span>+${fmt(rw.credits)} Ø-credits</span>` }));
    for (const [k, v] of Object.entries(rw.resources || {})) chips.push(ui.h('span', { class: 'sys-jrn-rw res', html: `${ui.icon(k, 14)}<span>+${fmt(v)} ${RESOURCE_LABELS[k] || k}</span>` }));
    for (const id of rw.items || []) chips.push(ui.h('span', { class: 'sys-jrn-rw item', html: `${ui.icon('gift', 14)}<span>${ITEM[id]?.name || id}</span>` }));
    for (const id of rw.lore || []) chips.push(ui.h('span', { class: 'sys-jrn-rw lore', html: `${ui.icon('book', 14)}<span>${LORE[id]?.title || id}</span>` }));
    return chips;
  }

  function renderQuestDetail(q) {
    r.detail.textContent = '';
    if (!q) return;
    const def = quests.defs.get(q.id);
    const objs = ui.h('ul', { class: 'sys-jrn-objs' });
    for (const o of q.objectives) {
      objs.appendChild(
        ui.h(
          'li',
          { class: `${o.done ? 'done' : ''}${o.current ? ' current' : ''}` },
          ui.h('span', { class: 'sys-tr-check' }),
          ui.h('span', { text: o.text }),
          o.dwell != null && !o.done && o.dwell > 0 ? ui.h('span', { class: 'sys-jrn-dwell', text: `${Math.round(o.dwell * 100)}%` }) : null,
        ),
      );
    }
    const actions = ui.h('div', { class: 'sys-jrn-actions' });
    if (q.status === 'active') {
      const tracked = quests.activeId === q.id;
      actions.appendChild(
        ui.h('button', {
          class: `btn btn-sm${tracked ? '' : ' btn-primary'}`,
          disabled: tracked ? true : null,
          html: tracked ? `${ui.icon('check', 14)}<span>Gevolgd</span>` : `${ui.icon('target', 14)}<span>Volgen</span>`,
          onclick: () => {
            quests.track(q.id);
            ctx.audio.play('ui.click');
            render();
          },
        }),
      );
    }
    r.detail.append(
      ui.h('div', { class: 'sys-jrn-dtype', dataset: { type: q.type } }, ui.h('span', { text: QUEST_TYPE_LABEL[q.type] || '' }), q.status === 'done' ? ui.h('span', { class: 'sys-jrn-done', html: `${ui.icon('check', 13)}<span>Voltooid</span>` }) : null),
      ui.h('h2', { class: 'sys-jrn-dtitle', text: q.title }),
      ui.h(
        'div',
        { class: 'sys-jrn-dmeta' },
        def?.location ? ui.h('span', { html: `${ui.icon('pin', 13)}<span>${def.location}</span>` }) : null,
        q.giver ? ui.h('span', { html: `${ui.icon('user', 13)}<span>${q.giver}</span>` }) : null,
      ),
      ui.h('p', { class: 'sys-jrn-summary', text: q.summary }),
      ui.h('div', { class: 'sys-jrn-h', text: 'Doelen' }),
      objs,
      ui.h('div', { class: 'sys-jrn-h', text: 'Beloningen' }),
      ui.h('div', { class: 'sys-jrn-rws' }, rewardChips(q.rewards)),
      actions,
    );
  }

  function renderLore() {
    const ids = unlockedLore();
    if (!sel || !ids.includes(sel)) sel = ids[ids.length - 1] || null;
    for (const id of LORE_ORDER) {
      const known = ids.includes(id);
      r.list.appendChild(
        ui.h(
          'button',
          {
            class: `sys-jrn-item lore${sel === id ? ' sel' : ''}${known ? '' : ' locked'}`,
            disabled: known ? null : true,
            onclick: () => {
              sel = id;
              ctx.audio.play('ui.click');
              render();
            },
          },
          ui.h('span', { class: 'sys-jrn-iic', html: ui.icon(known ? 'sys-scroll' : 'sys-lock', 17) }),
          ui.h('span', { class: 'sys-jrn-itext' }, ui.h('span', { class: 'sys-jrn-iname', text: known ? LORE[id].title : 'Onbekend verhaal' }), ui.h('span', { class: 'sys-jrn-imeta', text: known ? LORE[id].tag : '???' })),
        ),
      );
    }
    r.detail.textContent = '';
    if (sel && LORE[sel]) {
      r.detail.append(
        ui.h('div', { class: 'sys-jrn-dtype', dataset: { type: 'lore' } }, ui.h('span', { text: LORE[sel].tag })),
        ui.h('h2', { class: 'sys-jrn-dtitle', text: LORE[sel].title }),
        ui.h('p', { class: 'sys-jrn-lore', text: LORE[sel].text }),
        ui.h('div', { class: 'sys-jrn-loreseal', html: ui.icon('emblem', 28) }),
      );
    }
  }

  function renderEvents() {
    const evs = refs.events?.list?.() || [];
    if (!sel || !evs.some((e) => e.id === sel)) sel = evs[0]?.id || null;
    for (const e of evs) {
      r.list.appendChild(
        ui.h(
          'button',
          {
            class: `sys-jrn-item${sel === e.id ? ' sel' : ''}${e.active ? ' live' : ''}`,
            onclick: () => {
              sel = e.id;
              ctx.audio.play('ui.click');
              render();
            },
          },
          ui.h('span', { class: 'sys-jrn-iic', html: ui.icon(e.icon || 'sys-flag', 17) }),
          ui.h('span', { class: 'sys-jrn-itext' }, ui.h('span', { class: 'sys-jrn-iname', text: e.name }), ui.h('span', { class: 'sys-jrn-imeta', text: e.active ? 'Nu live' : e.when })),
          e.active ? ui.h('span', { class: 'sys-jrn-live', text: 'Live' }) : null,
        ),
      );
    }
    r.detail.textContent = '';
    const e = evs.find((x) => x.id === sel);
    if (!e) return;
    const actions = ui.h('div', { class: 'sys-jrn-actions' });
    if (e.canStart && !e.active) {
      actions.appendChild(
        ui.h('button', {
          class: 'btn btn-sm btn-primary',
          html: `${ui.icon('play', 14)}<span>Nu starten</span>`,
          onclick: () => {
            refs.events.start(e.id, { from: 'journal' });
            close();
          },
        }),
      );
    }
    if (e.active && e.id === 'starfall') {
      actions.appendChild(
        ui.h('button', {
          class: 'btn btn-sm',
          html: `${ui.icon('pin', 14)}<span>Volg het festival</span>`,
          onclick: () => {
            quests.track('starfall');
            close();
          },
        }),
      );
    }
    r.detail.append(
      ui.h('div', { class: 'sys-jrn-dtype', dataset: { type: 'event' } }, ui.h('span', { text: 'Live evenement' }), e.active ? ui.h('span', { class: 'sys-jrn-live', text: 'Live' }) : null),
      ui.h('h2', { class: 'sys-jrn-dtitle', text: e.name }),
      ui.h('div', { class: 'sys-jrn-dmeta' }, ui.h('span', { html: `${ui.icon('pin', 13)}<span>${e.where}</span>` }), ui.h('span', { html: `${ui.icon('sys-clock', 13)}<span>${e.when}</span>` })),
      ui.h('p', { class: 'sys-jrn-summary', text: e.desc }),
      e.rewards ? ui.h('div', { class: 'sys-jrn-h', text: 'Beloningen' }) : null,
      e.rewards ? ui.h('div', { class: 'sys-jrn-rws' }, rewardChips(e.rewards)) : null,
      actions,
    );
  }

  // ---------------------------------------------------------------- open / close
  let keyHandler = null;
  const offs = [];
  function open(t = null, id = null) {
    if (t) tab = TABS.some((x) => x.id === t) ? t : 'active';
    if (id) sel = id;
    if (!r || !ui.isModalOpen(MODAL)) {
      r = build();
      ui.openModal(MODAL, r.el, { className: 'sys-jrn-wrap', onClose: cleanup });
      ctx.audio.play('ui.open');
      keyHandler = (e) => {
        if (e.code === 'KeyJ' && !e.repeat && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
          e.preventDefault();
          close();
        }
      };
      window.addEventListener('keydown', keyHandler, true);
      offs.push(sys.on('quests:changed', () => render()));
      offs.push(ctx.events.on('event:start', () => render()));
      offs.push(ctx.events.on('event:end', () => render()));
      // XP, level, discoveries and new lore can change while the journal is open
      offs.push(ctx.events.on('progress:xp', () => render()));
      offs.push(ctx.events.on('progress:discover', () => render()));
      offs.push(ctx.events.on('lore:unlock', () => render()));
    }
    if (!sel && tab === 'active') sel = quests.activeId;
    render();
    return true;
  }
  function cleanup() {
    window.removeEventListener('keydown', keyHandler, true);
    offs.splice(0).forEach((off) => off?.());
    r = null;
    ctx.audio.play('ui.close');
  }
  function close() {
    ui.closeModal(MODAL);
  }

  sys.on('journal:open', ({ id } = {}) => {
    if (ui.isModalOpen() || !ctx.modes.is('explore', 'drive', 'space')) return;
    const q = id && quests.get(id);
    open(q?.status === 'done' ? 'done' : 'active', id || null);
  });

  ctx.loop.add(
    'sys-journal-key',
    () => {
      if (ctx.input.actionPressed('journal') && !ui.isModalOpen() && ctx.modes.is('explore', 'drive', 'space')) open();
    },
    { order: 49 },
  );

  return {
    open,
    close,
    get isOpen() {
      return ui.isModalOpen(MODAL);
    },
    render,
  };
}

