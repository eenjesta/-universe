/**
 * Build HUD (styles in build.css):
 *   resources panel  top-right (explore/drive): poster "Resources"/"Grondstoffen",
 *                    icons + Metal / Stone / Wood / Energy with animated counts and
 *                    +/− chips, power-grid line, Ø-credits; "∞" chip in creative mode
 *   build bar        bottom-centre while building: six category tiles (keys 1–6,
 *                    crop_action_build style) + a strip of the category's pieces with
 *                    names and costs (unaffordable dimmed, blueprints locked)
 *   key hints        bottom-right while building (mouse Place · R Rotate · X Remove …)
 *   crosshair        centre while building: cyan / red reticle + piece name or reason
 *   base label       top-left below the quest tracker: "Your base — Level N" near the base
 */
import { t } from '../core/i18n.js';
import { formatNumber } from '../core/math.js';
import { ZONES } from '../world/layout.js';
import { CATEGORIES, RESOURCES, piecesOf } from './catalog.js';

const L = {
  resources: { en: 'Resources', nl: 'Grondstoffen' },
  credits: { en: 'Ø-credits', nl: 'Ø-credits' },
  creative: { en: 'Creative', nl: 'Creatief' },
  grid: { en: 'Power grid', nl: 'Stroomnet' },
  perMin: { en: '/min', nl: '/min' },
  place: { en: 'Place', nl: 'Plaatsen' },
  rotate: { en: 'Rotate', nl: 'Draaien' },
  remove: { en: 'Remove', nl: 'Verwijderen' },
  next: { en: 'Next piece', nl: 'Volgend onderdeel' },
  cancel: { en: 'Cancel', nl: 'Annuleren' },
  blueprint: { en: 'Blueprint', nl: 'Blauwdruk' },
  free: { en: 'Free', nl: 'Gratis' },
  base: { en: 'Your base — Level {n}', nl: 'Jouw basis — Niveau {n}' },
};

const CROSS_SVG =
  '<svg class="build-cross-svg" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".75"/><path d="M24 5v9M24 34v9M5 24h9M34 24h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="24" cy="24" r="1.7" fill="currentColor"/></svg>';

export function createHud(ctx, api) {
  const { ui, state } = ctx;
  const h = ui.h.bind(ui);
  const icon = (n, s) => ui.icon(n, s);

  // ------------------------------------------------------------ resources
  const creativeChip = h('span', { class: 'build-res-creative', title: t(L.creative) }, h('span', { html: icon('infinity', 14) }), t(L.creative));
  const rows = {};
  const rowEls = RESOURCES.map((r) => {
    const val = h('span', { class: 'build-res-val num' });
    const delta = h('span', { class: 'build-res-delta num' });
    const el = h(
      'div',
      { class: 'build-res-row', dataset: { res: r.id } },
      h('span', { class: 'build-res-icon', html: icon(r.icon, 17), style: { color: r.color } }),
      h('span', { class: 'build-res-name', text: t(r.name) }),
      val,
      delta,
    );
    rows[r.id] = { el, val, delta, shown: state.get(`resources.${r.id}`) ?? 0, target: state.get(`resources.${r.id}`) ?? 0, flashT: 0 };
    return el;
  });
  const powerVal = h('span', { class: 'build-res-pval num' });
  const powerLine = h('div', { class: 'build-res-power' }, h('span', { class: 'build-res-picon', html: icon('power', 13) }), h('span', { text: t(L.grid) }), powerVal);
  const creditsVal = h('span', { class: 'build-res-val num' });
  const creditsDelta = h('span', { class: 'build-res-delta num' });
  const credits = { el: null, val: creditsVal, delta: creditsDelta, shown: state.get('credits') ?? 0, target: state.get('credits') ?? 0, flashT: 0 };
  credits.el = h(
    'div',
    { class: 'build-res-row build-res-credits' },
    h('span', { class: 'build-res-icon', html: icon('coin', 17), style: { color: 'var(--gold)' } }),
    h('span', { class: 'build-res-name', text: t(L.credits) }),
    creditsVal,
    creditsDelta,
  );
  const resPanel = h(
    'div',
    { class: 'build-res' },
    h('div', { class: 'build-res-head' }, h('span', { class: 'build-res-head-icon', html: icon('bld-resources', 16) }), h('span', { class: 'build-res-title', text: t(L.resources) }), creativeChip),
    rowEls,
    powerLine,
    h('div', { class: 'build-res-sep' }),
    credits.el,
  );
  ui.addWidget('top-right', resPanel, { modes: ['explore', 'drive'], order: 10 });

  function setRow(row, value, animate = true) {
    if (!Number.isFinite(value)) return;
    const diff = value - row.target;
    row.target = value;
    if (!animate) {
      row.shown = value;
      row.val.textContent = formatNumber(value);
      return;
    }
    // slow automatic energy accrual (power grid) updates silently
    if (Math.abs(diff) >= 1 && !(row === rows.energy && Math.abs(diff) < 2)) {
      row.delta.textContent = `${diff > 0 ? '+' : '−'}${formatNumber(Math.abs(diff))}`;
      row.delta.classList.remove('show', 'up', 'down');
      void row.delta.offsetWidth; // restart the CSS animation
      row.delta.classList.add('show', diff > 0 ? 'up' : 'down');
      (row.el || row.val.parentNode).classList.toggle('up', diff > 0);
      (row.el || row.val.parentNode).classList.toggle('down', diff < 0);
      row.flashT = 1.1;
    }
  }
  for (const r of RESOURCES) setRow(rows[r.id], state.get(`resources.${r.id}`) ?? 0, false);
  setRow(credits, state.get('credits') ?? 0, false);
  state.subscribe('resources', (v) => {
    for (const r of RESOURCES) setRow(rows[r.id], Number(v?.[r.id] ?? 0));
    refreshStrip();
  });
  state.subscribe('credits', (v) => setRow(credits, Number(v ?? 0)));
  const isCreative = () => (api.creative ? api.creative() : !!state.get('settings.creative'));
  const syncCreative = () => {
    ui.setVisible(creativeChip, isCreative());
    creativeChip.hidden = !isCreative();
    refreshStrip();
  };
  state.subscribe('settings', syncCreative);
  state.subscribe('owned', () => refreshStrip());

  // ------------------------------------------------------------ build bar
  const strip = h('div', { class: 'build-strip' });
  const tiles = {};
  const cats = h(
    'div',
    { class: 'build-cats' },
    CATEGORIES.map((c, k) => {
      const el = h(
        'button',
        {
          class: 'build-cat',
          type: 'button',
          dataset: { cat: c.id },
          title: `${t(c.name)} [${k + 1}]`,
          onclick: (e) => {
            e.currentTarget.blur();
            api.selectCategory(c.id);
          },
        },
        h('span', { class: 'build-cat-key', text: String(k + 1) }),
        h('span', { class: 'build-cat-icon', html: icon(c.icon, 28) }),
        h('span', { class: 'build-cat-label', text: t(c.name) }),
      );
      tiles[c.id] = el;
      return el;
    }),
  );
  const bar = h('div', { class: 'build-bar' }, strip, cats);
  ui.addWidget('bottom-center', bar, { modes: ['explore'], order: 10 });

  let stripCat = null;
  let cards = [];
  function buildStrip(catId) {
    stripCat = catId;
    strip.innerHTML = '';
    cards = piecesOf(catId).map((def) => {
      const cost = h('span', { class: 'build-piece-cost' });
      const el = h(
        'button',
        {
          class: 'build-piece',
          type: 'button',
          dataset: { piece: def.id },
          onclick: (e) => {
            e.currentTarget.blur();
            api.selectPiece(def.id);
          },
        },
        h('span', { class: 'build-piece-name' }, h('span', { class: 'build-piece-icon', html: icon(def.icon || 'cube', 16) }), h('span', { text: t(def.name) })),
        cost,
      );
      strip.appendChild(el);
      return { def, el, cost, key: '' };
    });
    refreshStrip(true);
  }

  function refreshStrip(force = false) {
    if (!cards.length) return;
    const creative = isCreative();
    const res = state.get('resources') || {};
    for (const c of cards) {
      const locked = !api.isOwned(c.def);
      const short = {};
      let afford = true;
      for (const [k, v] of Object.entries(c.def.cost)) {
        if (!creative && (res[k] ?? 0) < v) {
          short[k] = true;
          afford = false;
        }
      }
      const key = `${creative}|${locked}|${Object.keys(short).join(',')}`;
      c.el.classList.toggle('unaffordable', !afford && !locked);
      c.el.classList.toggle('locked', locked);
      if (key === c.key && !force) continue;
      c.key = key;
      c.cost.innerHTML = '';
      if (locked) {
        c.cost.append(h('span', { class: 'build-cost build-cost-lock', html: icon('bld-lock', 13) }), h('span', { class: 'build-cost-text', text: t(L.blueprint) }));
      } else if (creative) {
        c.cost.append(h('span', { class: 'build-cost build-cost-free', html: icon('infinity', 15) }), h('span', { class: 'build-cost-text', text: t(L.free) }));
      } else {
        for (const r of RESOURCES) {
          const v = c.def.cost[r.id];
          if (!v) continue;
          c.cost.append(h('span', { class: `build-cost${short[r.id] ? ' short' : ''}` }, h('span', { class: 'build-cost-icon', html: icon(r.icon, 13), style: { color: r.color } }), String(v)));
        }
      }
    }
  }

  /** Shows / hides a category tile (the SMP 'survival' tile only exists while a server is authoritative). */
  function setCategoryVisible(id, on) {
    const el = tiles[id];
    if (el) el.hidden = !on;
  }

  function setSelection(catId, pieceId) {
    for (const [id, el] of Object.entries(tiles)) el.classList.toggle('active', id === catId);
    if (stripCat !== catId) buildStrip(catId);
    for (const c of cards) c.el.classList.toggle('selected', c.def.id === pieceId);
    const sel = cards.find((c) => c.def.id === pieceId);
    sel?.el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  // ------------------------------------------------------------ key hints
  const hint = (keyEl, text) => h('div', { class: 'build-hint' }, keyEl, h('span', { class: 'build-hint-label', text }));
  const kbd = (k) => h('span', { class: 'kbd build-kbd', text: k });
  const hints = h(
    'div',
    { class: 'build-hints' },
    hint(h('span', { class: 'build-hint-mouse', html: icon('bld-mouse-left', 22) }), t(L.place)),
    hint(kbd('R'), t(L.rotate)),
    hint(kbd('X'), t(L.remove)),
    hint(kbd('Tab'), t(L.next)),
    hint(kbd('Esc'), t(L.cancel)),
  );
  ui.addWidget('bottom-right', hints, { modes: ['explore'], order: 10 });

  // ------------------------------------------------------------ crosshair
  const crossLabel = h('div', { class: 'build-cross-label' });
  const cross = h('div', { class: 'build-cross', html: CROSS_SVG }, crossLabel);
  ui.addWidget('center', cross, { modes: ['explore'], order: 10 });
  let crossKey = '';
  function setCross(valid, text) {
    const key = `${valid}|${text}`;
    if (key === crossKey) return;
    crossKey = key;
    cross.classList.toggle('bad', !valid);
    crossLabel.textContent = text || '';
    crossLabel.hidden = !text;
  }
  function flashInvalid() {
    cross.classList.remove('shake');
    void cross.offsetWidth;
    cross.classList.add('shake');
  }

  // ------------------------------------------------------------ base label
  const baseText = h('span', { class: 'build-base-text' });
  const baseLabel = h('div', { class: 'build-base' }, h('span', { class: 'build-base-icon', html: icon('home', 18) }), baseText);
  ui.addWidget('top-left', baseLabel, { modes: ['explore', 'drive'], order: 30 });
  let baseVisible = null;
  let baseLevel = -1;
  function setBaseLevel(n) {
    if (n === baseLevel) return;
    baseLevel = n;
    baseText.textContent = t(L.base, { n });
  }

  // ------------------------------------------------------------ build mode
  let building = null;
  function setBuilding(on) {
    if (on === building) return;
    building = on;
    for (const el of [bar, hints, cross]) ui.setVisible(el, on);
    resPanel.classList.toggle('building', on);
  }
  setBuilding(false);
  syncCreative();

  let powerKey = '';
  function setPower(st) {
    const show = !!st.hasPower;
    const key = `${show}|${st.net.toFixed(1)}`;
    if (key === powerKey) return;
    powerKey = key;
    powerLine.hidden = !show;
    const net = st.net;
    powerVal.textContent = `${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(1)}${t(L.perMin)}`;
    powerLine.classList.toggle('neg', net < -0.05);
  }

  /** Per frame (order 93): number tweens, base label visibility. */
  let animRows = null; // built once (no per-frame allocation)
  function update(dt) {
    if (!animRows) animRows = [...Object.values(rows), credits];
    for (const row of animRows) {
      if (row.shown !== row.target) {
        const d = row.target - row.shown;
        row.shown = Math.abs(d) < 0.6 ? row.target : row.shown + d * Math.min(1, dt * 7);
        row.val.textContent = formatNumber(row.shown);
      }
      if (row.flashT > 0) {
        row.flashT -= dt;
        if (row.flashT <= 0) {
          const el = row.el || row.val.parentNode;
          el.classList.remove('up', 'down');
        }
      }
    }
    const p = ctx.vehicles?.current?.object?.position || ctx.player?.position;
    const B = ZONES.base;
    const near = !!p && Math.hypot(p.x - B.x, p.z - B.z) < 100;
    if (near !== baseVisible) {
      baseVisible = near;
      ui.setVisible(baseLabel, near);
    }
  }

  return { setSelection, setCategoryVisible, syncCreative, setCross, flashInvalid, setBuilding, setPower, setBaseLevel, refreshStrip, update, el: { resPanel, bar, hints, cross, baseLabel } };
}
