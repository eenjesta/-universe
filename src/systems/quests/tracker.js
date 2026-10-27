/**
 * Quest tracker widget (top-left, modes explore/drive/space) in the poster
 * style: cyan diamond + quest title, thin progress line, objectives with cyan
 * circle checks, live distance (or dwell %) on the current objective and an
 * animated completion ("Mission complete") before switching to the next quest.
 */
import { t } from '../../core/i18n.js';
import { fmtDist, playerPos } from '../shared/util.js';

export function createTracker(ctx, { quests, sys }) {
  const { ui } = ctx;
  // clicking the tracker (with a free mouse) opens the journal on the shown quest
  const root = ui.h('div', { class: 'sys-tracker', title: t({ en: 'Missions [J]', nl: 'Missies [J]' }), onclick: () => shownId && sys.emit('journal:open', { id: shownId }) });
  ui.addWidget('top-left', root, { modes: ['explore', 'drive', 'space'], order: 10 });

  let card = null;
  let shownId = null;
  let holdUntil = 0; // keeps the "complete" state visible until this time (ms)
  let holdTimer = null;
  let lastDone = new Map(); // objective id → done (drives the check "pop")
  let lastMeta = '';

  function buildCard(q) {
    const compact = q.objectives.length === 1;
    const showObj = compact && !q.titleOnly; // "The Signal — Talk to Aria" vs "Dock at Station Halo"
    const el = ui.h('div', { class: `sys-tr-card${compact ? ' compact' : ''}`, dataset: { type: q.type, quest: q.id } });
    const head = ui.h(
      'div',
      { class: 'sys-tr-head' },
      ui.h('span', { class: 'sys-tr-icon', html: ui.icon('sys-diamond', 18) }),
      ui.h(
        'span',
        { class: 'sys-tr-title' },
        ui.h('span', { class: 'sys-tr-name', text: q.title }),
        showObj ? ui.h('span', { class: 'sys-tr-sep', text: ' — ' }) : null,
        showObj ? ui.h('span', { class: 'sys-tr-only' }) : null,
      ),
      ui.h('span', { class: 'sys-tr-meta sys-tr-head-meta' }),
    );
    const bar = ui.h('div', { class: 'sys-tr-bar' }, ui.h('i'));
    const list = compact ? null : ui.h('ul', { class: 'sys-tr-objs' });
    const done = ui.h('div', { class: 'sys-tr-done' }, ui.h('span', { class: 'sys-tr-done-ic', html: ui.icon('check', 13) }), ui.h('span', { text: t({ en: 'Mission complete', nl: 'Missie voltooid' }) }));
    el.append(head, bar);
    if (list) el.append(list);
    el.append(done);
    el._refs = { head, bar, list, compact, headMeta: head.querySelector('.sys-tr-head-meta'), only: head.querySelector('.sys-tr-only') };
    return el;
  }

  function fillCard(el, q, animate) {
    const { bar, list, compact, only } = el._refs;
    const req = q.objectives.filter((o) => !o.optional);
    const n = req.filter((o) => o.done).length;
    bar.firstChild.style.setProperty('--v', req.length ? n / req.length : 0);
    if (compact) {
      const o = q.objectives[0];
      if (only) only.textContent = o.text;
      el.classList.toggle('obj-done', o.done);
      return;
    }
    if (list.children.length !== q.objectives.length) {
      list.textContent = '';
      for (const o of q.objectives) {
        list.appendChild(
          ui.h('li', { class: 'sys-tr-obj', dataset: { obj: o.id } }, ui.h('span', { class: 'sys-tr-check' }), ui.h('span', { class: 'sys-tr-text' }), ui.h('span', { class: 'sys-tr-meta' })),
        );
      }
    }
    q.objectives.forEach((o, i) => {
      const li = list.children[i];
      li.children[1].textContent = o.text;
      li.classList.toggle('done', o.done);
      li.classList.toggle('current', o.current);
      li.classList.toggle('optional', o.optional);
      if (animate && o.done && lastDone.get(o.id) === false) {
        li.classList.remove('just-done');
        void li.offsetWidth;
        li.classList.add('just-done');
      }
      lastDone.set(o.id, o.done);
    });
  }

  function swapTo(q) {
    const old = card;
    shownId = q?.id || null;
    lastDone = new Map(q ? q.objectives.map((o) => [o.id, o.done]) : []);
    lastMeta = '';
    if (old) {
      old.classList.add('leaving');
      setTimeout(() => old.remove(), 380);
    }
    card = null;
    if (!q) {
      ui.setVisible(root, false);
      return;
    }
    ui.setVisible(root, true);
    card = buildCard(q);
    fillCard(card, q, false);
    root.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => card?.classList.add('in')));
  }

  function scheduleAfterHold() {
    if (holdTimer) return;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      render();
    }, Math.max(0, holdUntil - performance.now()) + 30);
  }

  function render() {
    if (performance.now() < holdUntil) {
      scheduleAfterHold();
      return;
    }
    const q = quests.active;
    if (!q) {
      if (shownId || card) swapTo(null);
      else ui.setVisible(root, false);
      return;
    }
    if (q.id !== shownId || !card) swapTo(q);
    else fillCard(card, q, true);
    updateMeta(true);
  }

  sys.on('quests:changed', ({ id, reason }) => {
    if (reason === 'complete' && id === shownId && card) {
      const q = quests.get(id);
      if (q) fillCard(card, q, true);
      card.classList.add('complete');
      holdUntil = performance.now() + 2900;
      scheduleAfterHold();
      return;
    }
    render();
  });
  sys.on('quests:dwell', ({ id }) => {
    if (id === shownId) updateMeta(false);
  });
  ctx.events.on('mode:change', () => render());

  // ---------------------------------------------------------------- distance / dwell read-out
  function updateMeta(force) {
    if (!card || card.classList.contains('complete')) return;
    const target = quests.currentTarget();
    let dist = '';
    if (target) {
      const p = playerPos(ctx);
      if (p) {
        const d = Math.hypot(p.x - target.position.x, p.z - target.position.z);
        if (d > 12) dist = fmtDist(d);
      }
    }
    const q = quests.get(shownId);
    if (!q) return;
    const metaOf = (o) => {
      if (o.done) return '';
      if (o.dwell != null && o.dwell > 0) return `${Math.round(o.dwell * 100)}%`;
      return target && o.id === target.objective ? dist : '';
    };
    const metas = q.objectives.map(metaOf);
    const sig = metas.join('|');
    if (!force && sig === lastMeta) return;
    lastMeta = sig;
    const { list, compact, headMeta } = card._refs;
    if (compact) {
      headMeta.textContent = metas[0];
      return;
    }
    metas.forEach((t, i) => {
      const li = list.children[i];
      if (li && li.children[2].textContent !== t) li.children[2].textContent = t;
    });
  }

  let acc = 0;
  ctx.loop.add(
    'sys-tracker',
    (dt) => {
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      if (!root.hidden) updateMeta(false);
    },
    { order: 95 },
  );

  render();
  return { el: root, render };
}
