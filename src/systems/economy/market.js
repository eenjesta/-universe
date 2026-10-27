/**
 * Economy + marketplace modal (K, or the holographic terminal on the
 * Nexus-plein at ZONES.plaza.market). Holographic glass window with tabs
 * Kopen / Verkopen / Mijn items, item cards with thumbnails, prices in
 * Ø-credits and favourite hearts (14_marketplace.png).
 * Emits market:buy {item, price} and market:sell {item, amount, credits}.
 */
import * as THREE from 'three';
import '../css/market.css';
import { ZONES } from '../../world/layout.js';
import { fmt, groundY, RESOURCE_LABELS } from '../shared/util.js';
import { ITEMS, ITEM, SELL_PRICES, FILTERS } from './items.js';
import { thumbnail } from './thumbs.js';

const RES_ICON = { metal: 'metal', stone: 'stone', wood: 'wood', energy: 'energy' };
const MODAL = 'market';

export function createMarket(ctx, { rewards }) {
  const { ui, state } = ctx;
  let tab = 'buy';
  let filter = 'all';
  let el = null;
  let refs = null;

  const credits = () => state.get('credits') || 0;
  const owns = (id) => rewards.ownsItem(id);
  const favs = () => state.get('systems.favorites') || [];
  const isFav = (id) => favs().includes(id);

  function toggleFav(id) {
    const f = favs();
    state.set('systems.favorites', f.includes(id) ? f.filter((x) => x !== id) : [...f, id]);
    ctx.audio.play('ui.click');
    render();
  }

  // ---------------------------------------------------------------- economy actions
  function buy(id) {
    const it = ITEM[id];
    if (!it) return false;
    if (it.kind !== 'consumable' && owns(id)) return false;
    if (credits() < it.price) {
      ctx.audio.play('ui.error');
      flash(id, 'Niet genoeg Ø-credits');
      return false;
    }
    state.add('credits', -it.price);
    if (it.kind === 'consumable') state.gain(it.give || {});
    else rewards.grantItem(id);
    ctx.audio.play('reward');
    ctx.events.emit('market:buy', { item: id, price: it.price });
    toastOutsideModal(`Gekocht: ${it.name}`, it.kind === 'consumable' ? 'Toegevoegd aan je grondstoffen' : hintFor(it));
    flash(id, it.kind === 'consumable' ? 'Toegevoegd!' : 'Gekocht!', 'ok');
    render();
    return true;
  }

  /** sell('metal', 50) for resources or sell('decor-statue') for an owned item (50% back). */
  function sell(what, amount = 1) {
    if (SELL_PRICES[what] != null) {
      const have = Math.floor(state.get(`resources.${what}`) || 0);
      const n = Math.min(have, Math.max(0, Math.floor(amount)));
      if (n <= 0) {
        ctx.audio.play('ui.error');
        return 0;
      }
      const gained = Math.round(n * SELL_PRICES[what]);
      state.add(`resources.${what}`, -n);
      state.add('credits', gained);
      ctx.audio.play('reward');
      ctx.events.emit('market:sell', { item: `res-${what}`, amount: n, credits: gained });
      render();
      return gained;
    }
    const it = ITEM[what];
    if (!it || it.kind === 'consumable' || !owns(what)) return 0;
    const gained = Math.round(it.price * 0.5);
    rewards.removeItem(what);
    state.add('credits', gained);
    ctx.audio.play('reward');
    ctx.events.emit('market:sell', { item: what, amount: 1, credits: gained });
    render();
    return gained;
  }

  function equip(id) {
    const it = ITEM[id];
    if (!it || it.kind !== 'outfit' || !owns(id)) return false;
    const app = { ...(state.get('profile.appearance') || {}), outfit: it.outfit };
    try {
      ctx.player?.setAppearance?.(app);
    } catch (err) {
      console.warn('[market] setAppearance failed', err);
    }
    state.set('profile.appearance', app);
    ctx.events.emit('market:equip', { item: id });
    ctx.audio.play('ui.click');
    render();
    return true;
  }

  function hintFor(it) {
    if (it.kind === 'outfit') return 'Aantrekken via Mijn items of de karakter-editor [C]';
    if (it.kind === 'skin') return 'Beschikbaar in je garage [G]';
    if (it.kind === 'blueprint') return 'Beschikbaar in de bouwmodus [B]';
    return '';
  }

  function toastOutsideModal(title, text) {
    ui.toast({ title, text, icon: 'cart', kind: 'reward', duration: 3000 });
  }

  // ---------------------------------------------------------------- UI
  function build() {
    const r = {};
    r.credits = ui.h('span', { class: 'sys-mkt-credits-n' });
    r.tabs = ui.h('div', { class: 'sys-mkt-tabs', role: 'tablist' });
    r.filters = ui.h('div', { class: 'sys-mkt-filters' });
    r.body = ui.h('div', { class: 'sys-mkt-body scroll' });
    const head = ui.h(
      'div',
      { class: 'sys-mkt-head' },
      ui.h('div', { class: 'sys-mkt-title', html: `${ui.icon('cube', 22)}<span>Marketplace</span>` }),
      ui.h('div', { class: 'sys-mkt-credits', title: 'Jouw saldo' }, ui.h('span', { html: ui.icon('sys-credit', 16) }), r.credits, ui.h('span', { class: 'sys-mkt-unit', text: 'Ø-credits' })),
      ui.h('button', { class: 'modal-close', title: 'Sluiten (Esc)', html: ui.icon('close', 18), onclick: () => close() }),
    );
    for (const [id, label] of [
      ['buy', 'Kopen'],
      ['sell', 'Verkopen'],
      ['mine', 'Mijn items'],
    ]) {
      r.tabs.appendChild(ui.h('button', { class: 'sys-mkt-tab', dataset: { tab: id }, role: 'tab', text: label, onclick: () => setTab(id) }));
    }
    const foot = ui.h(
      'div',
      { class: 'sys-mkt-foot' },
      ui.h('span', { text: 'Verdien Ø-credits met missies, ontdekkingen en de verkoop van grondstoffen.' }),
      ui.h('span', { class: 'sys-mkt-keys', html: '<span class="kbd">K</span> sluiten' }),
    );
    r.el = ui.h('div', { class: 'sys-mkt', role: 'dialog', 'aria-label': 'Marketplace' }, ui.h('i', { class: 'sys-mkt-scan' }), head, r.tabs, r.filters, r.body, foot);
    return r;
  }

  function setTab(t) {
    tab = t;
    ctx.audio.play('ui.click');
    render();
  }

  function render() {
    if (!refs) return;
    refs.credits.textContent = fmt(credits());
    for (const b of refs.tabs.children) b.classList.toggle('active', b.dataset.tab === tab);
    refs.filters.textContent = '';
    refs.filters.hidden = tab !== 'buy';
    if (tab === 'buy') {
      for (const f of FILTERS) {
        refs.filters.appendChild(
          ui.h('button', {
            class: `sys-mkt-filter${filter === f.id ? ' active' : ''}`,
            text: f.label,
            onclick: () => {
              filter = f.id;
              ctx.audio.play('ui.click');
              render();
            },
          }),
        );
      }
    }
    const scroll = refs.body.scrollTop;
    refs.body.textContent = '';
    if (tab === 'buy') renderBuy();
    else if (tab === 'sell') renderSell();
    else renderMine();
    refs.body.scrollTop = scroll;
  }

  function priceRow(price, extraClass = '') {
    return ui.h('div', { class: `sys-mkt-price ${extraClass}` }, ui.h('span', { html: ui.icon('sys-credit', 15) }), ui.h('span', { text: `${fmt(price)} Ø-credits` }));
  }

  function card(it, action) {
    const fav = isFav(it.id);
    return ui.h(
      'div',
      { class: `sys-mkt-card card${owns(it.id) && it.kind !== 'consumable' ? ' owned' : ''}`, dataset: { item: it.id } },
      ui.h(
        'div',
        { class: 'sys-mkt-thumb' },
        ui.h('img', { src: thumbnail(it), alt: it.name, draggable: 'false' }),
        ui.h('button', {
          class: `sys-mkt-fav${fav ? ' on' : ''}`,
          title: fav ? 'Verwijder uit favorieten' : 'Favoriet',
          html: ui.icon(fav ? 'sys-heart-fill' : 'sys-heart', 17),
          onclick: (e) => {
            e.stopPropagation();
            toggleFav(it.id);
          },
        }),
      ),
      ui.h('div', { class: 'sys-mkt-cat', text: it.cat }),
      ui.h('div', { class: 'sys-mkt-name', text: it.name }),
      ui.h('div', { class: 'sys-mkt-desc', text: it.desc }),
      action,
    );
  }

  function renderBuy() {
    let list = ITEMS;
    if (filter === 'fav') list = ITEMS.filter((i) => isFav(i.id));
    else if (filter !== 'all') list = ITEMS.filter((i) => i.kind === filter);
    if (!list.length) {
      refs.body.appendChild(ui.h('div', { class: 'sys-mkt-empty', text: filter === 'fav' ? 'Nog geen favorieten. Tik op een hartje om een item te bewaren.' : 'Geen items in deze categorie.' }));
      return;
    }
    const grid = ui.h('div', { class: 'sys-mkt-grid' });
    for (const it of list) {
      const owned = it.kind !== 'consumable' && owns(it.id);
      const poor = credits() < it.price;
      const btn = ui.h('button', {
        class: `sys-mkt-btn${owned ? ' owned' : ''}${poor && !owned ? ' poor' : ''}`,
        disabled: owned ? true : null,
        html: owned ? `${ui.icon('check', 15)}<span>In bezit</span>` : '<span>Kopen</span>',
        onclick: () => buy(it.id),
      });
      grid.appendChild(card(it, ui.h('div', { class: 'sys-mkt-act' }, priceRow(it.price, poor && !owned ? 'poor' : ''), btn)));
    }
    refs.body.appendChild(grid);
  }

  function renderSell() {
    const wrap = ui.h('div', { class: 'sys-mkt-sell' });
    wrap.appendChild(ui.h('div', { class: 'sys-mkt-sub', text: 'Grondstoffen' }));
    for (const res of Object.keys(SELL_PRICES)) {
      const have = Math.floor(state.get(`resources.${res}`) || 0);
      const btn = (n, label) =>
        ui.h('button', {
          class: 'sys-mkt-btn sm',
          disabled: have <= 0 ? true : null,
          text: label,
          onclick: () => sell(res, n === 'all' ? have : n),
        });
      wrap.appendChild(
        ui.h(
          'div',
          { class: 'sys-mkt-row' },
          ui.h('span', { class: 'sys-mkt-ric', html: ui.icon(RES_ICON[res], 22) }),
          ui.h('div', { class: 'sys-mkt-rname' }, ui.h('div', { text: RESOURCE_LABELS[res] }), ui.h('div', { class: 'sys-mkt-rhave', text: `${fmt(have)} in voorraad` })),
          ui.h('div', { class: 'sys-mkt-rprice' }, priceRow(SELL_PRICES[res]), ui.h('div', { class: 'sys-mkt-rhave', text: 'per stuk' })),
          ui.h('div', { class: 'sys-mkt-rbtns' }, btn(10, '10'), btn(50, '50'), btn('all', 'Alles')),
        ),
      );
    }
    const owned = ITEMS.filter((i) => i.kind !== 'consumable' && owns(i.id));
    if (owned.length) {
      wrap.appendChild(ui.h('div', { class: 'sys-mkt-sub', text: 'Jouw items (50% van de prijs)' }));
      for (const it of owned) {
        wrap.appendChild(
          ui.h(
            'div',
            { class: 'sys-mkt-row' },
            ui.h('img', { class: 'sys-mkt-rthumb', src: thumbnail(it), alt: '' }),
            ui.h('div', { class: 'sys-mkt-rname' }, ui.h('div', { text: it.name }), ui.h('div', { class: 'sys-mkt-rhave', text: it.cat })),
            ui.h('div', { class: 'sys-mkt-rprice' }, priceRow(Math.round(it.price * 0.5))),
            ui.h('div', { class: 'sys-mkt-rbtns' }, ui.h('button', { class: 'sys-mkt-btn sm', text: 'Verkopen', onclick: () => sell(it.id) })),
          ),
        );
      }
    }
    refs.body.appendChild(wrap);
  }

  function renderMine() {
    const owned = ITEMS.filter((i) => i.kind !== 'consumable' && owns(i.id));
    if (!owned.length) {
      refs.body.appendChild(
        ui.h(
          'div',
          { class: 'sys-mkt-empty' },
          ui.h('div', { text: 'Je hebt nog geen items.' }),
          ui.h('button', { class: 'btn btn-sm', text: 'Bekijk het aanbod', onclick: () => setTab('buy') }),
        ),
      );
      return;
    }
    const grid = ui.h('div', { class: 'sys-mkt-grid' });
    const wearing = state.get('profile.appearance.outfit');
    for (const it of owned) {
      let action;
      if (it.kind === 'outfit') {
        const on = wearing === it.outfit;
        action = ui.h('button', {
          class: `sys-mkt-btn${on ? ' owned' : ''}`,
          disabled: on ? true : null,
          html: on ? `${ui.icon('check', 15)}<span>Gedragen</span>` : '<span>Aantrekken</span>',
          onclick: () => equip(it.id),
        });
      } else action = ui.h('div', { class: 'sys-mkt-note', text: hintFor(it) });
      grid.appendChild(card(it, ui.h('div', { class: 'sys-mkt-act' }, action)));
    }
    refs.body.appendChild(grid);
  }

  function flash(id, text, kind = 'err') {
    const c = refs?.body.querySelector(`[data-item="${id}"]`);
    if (!c) return;
    c.classList.remove('shake', 'pulse');
    void c.offsetWidth;
    c.classList.add(kind === 'ok' ? 'pulse' : 'shake');
    const tip = ui.h('div', { class: `sys-mkt-flash ${kind}`, text });
    c.appendChild(tip);
    setTimeout(() => tip.remove(), 1500);
  }

  // ---------------------------------------------------------------- open / close
  let keyHandler = null;
  let unsub = null;
  function open(t = null) {
    if (t) tab = t === 'sell' || t === 'mine' ? t : 'buy';
    if (refs && ui.isModalOpen(MODAL)) {
      render();
      return true;
    }
    refs = build();
    el = refs.el;
    ui.openModal(MODAL, el, { className: 'sys-mkt-wrap', onClose: cleanup });
    ctx.audio.play('ui.open');
    render();
    keyHandler = (e) => {
      if (e.code === 'KeyK' && !e.repeat && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', keyHandler, true);
    unsub = state.subscribe('credits', () => refs && (refs.credits.textContent = fmt(credits())));
    return true;
  }
  function cleanup() {
    window.removeEventListener('keydown', keyHandler, true);
    unsub?.();
    unsub = null;
    refs = null;
    el = null;
    ctx.audio.play('ui.close');
  }
  function close() {
    ui.closeModal(MODAL);
  }

  // K shortcut + plaza terminal
  ctx.loop.add(
    'sys-market-key',
    () => {
      if (ctx.input.actionPressed('market') && !ui.isModalOpen() && ctx.modes.is('explore', 'drive')) open();
    },
    { order: 49 },
  );
  const termPos = new THREE.Vector3();
  const markPos = new THREE.Vector3();
  const M = ZONES.plaza.market;
  // the landmarks terminal position when available, else the layout spot
  const terminal = (lift, out = termPos) => {
    const t = ctx.landmarks?.plaza?.market;
    return t?.isVector3 ? out.set(t.x, t.y + lift, t.z) : out.set(M.x, groundY(ctx, M.x, M.z) + lift, M.z);
  };
  ctx.interactions.add({
    id: 'sys-market-terminal',
    scope: 'world',
    position: () => terminal(1.1),
    radius: 4,
    label: 'Marketplace openen',
    priority: 1,
    onInteract: () => open('buy'),
  });
  ctx.markers?.set('sys-market', {
    position: () => terminal(2.4, markPos),
    label: 'Marketplace',
    kind: 'poi',
    icon: 'cart',
    color: '#7fe0ff',
    scope: 'world',
    screen: false,
    compass: true,
  });

  return {
    items: ITEMS,
    get: (id) => ITEM[id] || null,
    owns,
    buy,
    sell,
    equip,
    prices: SELL_PRICES,
    get credits() {
      return credits();
    },
    open,
    close,
    get isOpen() {
      return ui.isModalOpen(MODAL);
    },
  };
}
