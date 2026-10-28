/**
 * Base structures (survival): campfires, storage chests, beds and doors near the player.
 *
 *   [E] campfire  → Campfire panel: three grill slots with live timers, your raw food → meals
 *                   (shared/defs/recipes.js COOK_RECIPES), "Take meals" when they are done
 *   [E] chest     → transfer panel: your bag ↔ the chest (click = 10, ⇧ / All = everything,
 *                   "Store all resources", "Take all"); someone else's chest → "Locked · <name>"
 *   [E] bed       → sleep: your respawn point + the Rested buff (a short fade to dusk)
 *   [E] door      → open / close (the owner; others see "Locked door · <name>")
 *
 * Requests: C.STORE {struct, op, …} (shared/sim/storage.js); replies S.STORAGE / S.DENY {of: 'store'}
 * (routed here by bridge.js through smp.onStorage / smp.onDeny). Interaction points exist only for
 * structures within NEAR m (re-checked 2.5× per second) — a big world can hold thousands of records.
 */
import { C } from '../../shared/protocol.js';
import { ITEMS, RESOURCES, RESOURCE_IDS, BUFFS } from '../../shared/defs/items.js';
import { COOK_RECIPES } from '../../shared/defs/recipes.js';
import { REASONS } from '../../shared/defs/reasons.js';
import { t } from '../core/i18n.js';
import { formatNumber } from '../core/math.js';
import { itemIcon } from './icons.js';
import { cookStatus, claimAt, clock } from './logic.js';

const NEAR = 28;
const FIRE_MODAL = 'smp-campfire';
const CHEST_MODAL = 'smp-chest';

const TXT = {
  cook: { en: 'Campfire — cook', nl: 'Kampvuur — koken' },
  collect: { en: 'Campfire — take your meals', nl: 'Kampvuur — pak je maaltijden' },
  openChest: { en: 'Open chest', nl: 'Kist openen' },
  lockedChest: { en: 'Locked chest · {name}', nl: 'Kist op slot · {name}' },
  sleepHome: { en: 'Sleep — set as home', nl: 'Slapen — als thuis instellen' },
  sleep: { en: 'Sleep (your home)', nl: 'Slapen (je thuis)' },
  bedOf: { en: 'Bed · {name}', nl: 'Bed · {name}' },
  openDoor: { en: 'Open door', nl: 'Deur openen' },
  closeDoor: { en: 'Close door', nl: 'Deur sluiten' },
  lockedDoor: { en: 'Locked door · {name}', nl: 'Deur op slot · {name}' },
  someone: { en: 'someone', nl: 'iemand' },
  lockedTitle: { en: 'Locked', nl: 'Op slot' },
  lockedText: { en: 'This belongs to {name}.', nl: 'Dit is van {name}.' },
  // campfire panel
  fireTitle: { en: 'Campfire', nl: 'Kampvuur' },
  fireSub: { en: 'Cook what you gathered — meals restore more and give buffs', nl: 'Kook wat je verzamelde — maaltijden herstellen meer en geven buffs' },
  warmOn: { en: 'Warm · healing by the fire', nl: 'Warm · herstel bij het vuur' },
  warmOff: { en: 'Step closer to warm up', nl: 'Kom dichterbij om op te warmen' },
  grill: { en: 'On the fire', nl: 'Op het vuur' },
  recipes: { en: 'Recipes', nl: 'Recepten' },
  empty: { en: 'Empty spot', nl: 'Vrije plek' },
  ready: { en: 'Ready!', nl: 'Klaar!' },
  someoneElse: { en: 'cooked by {name}', nl: 'gekookt door {name}' },
  takeMeals: { en: 'Take meals', nl: 'Maaltijden pakken' },
  cookBtn: { en: 'Cook', nl: 'Koken' },
  full: { en: 'The fire is full', nl: 'Het vuur is vol' },
  need: { en: 'Need {list}', nl: 'Nodig: {list}' },
  secs: { en: '{s} s on the fire', nl: '{s} s op het vuur' },
  hint: { en: 'Pick berries, glowcaps and jungle fruit out in the wild.', nl: 'Pluk bessen, gloeikappen en junglevruchten in de wildernis.' },
  cooked: { en: 'Meals ready', nl: 'Maaltijden klaar' },
  // chest panel
  chestTitle: { en: 'Storage chest', nl: 'Opslagkist' },
  stacks: { en: '{n} / {max} stacks', nl: '{n} / {max} stapels' },
  bag: { en: 'Your bag', nl: 'Je tas' },
  chest: { en: 'Chest', nl: 'Kist' },
  storeRes: { en: 'Store all resources', nl: 'Alle grondstoffen opbergen' },
  storeMats: { en: 'Store materials', nl: 'Materialen opbergen' },
  takeAll: { en: 'Take all', nl: 'Alles pakken' },
  all: { en: 'All', nl: 'Alles' },
  chestEmpty: { en: 'The chest is empty. Things in here are never lost when you fall.', nl: 'De kist is leeg. Wat hierin zit, raak je nooit kwijt als je valt.' },
  bagEmpty: { en: 'Nothing to store.', nl: 'Niets om op te bergen.' },
  chestHint: { en: 'Click = 10 · ⇧ click = all', nl: 'Klik = 10 · ⇧ klik = alles' },
  // bed / door
  homeTitle: { en: 'Home set', nl: 'Thuis ingesteld' },
  homeText: { en: 'You rested — you will respawn at this bed. Rested: slower hunger, slow healing (10 min).', nl: 'Je hebt gerust — je respawnt bij dit bed. Uitgerust: tragere honger, langzaam genezen (10 min).' },
  combat: { en: 'You can’t sleep with enemies around', nl: 'Je kunt niet slapen met vijanden in de buurt' },
  close: { en: 'Close', nl: 'Sluiten' },
};

const KIND_ORDER = { material: 0, food: 1, meal: 2, consumable: 3, gear: 4, schematic: 5, tool: 6, throw: 7 };

export function createBase(ctx, smp) {
  const { ui, events } = ctx;
  const h = ui.h.bind(ui);
  const icon = (n, s) => ui.icon(n, s);
  const touch = !!ctx.device?.touch;
  const inter = new Map(); // record id → { kind, iid }
  const fires = new Map(); // record id → { cook: [{recipe, n, by, done}], slots }
  let fireOpen = null; // record of the open campfire panel
  let chestOpen = null; // { rec, items, res, stacks }
  const records = () => ctx.build?.registry?.records;
  const me = () => smp.me();
  const st = () => (typeof ctx.net?.serverTime === 'function' ? ctx.net.serverTime() : Date.now());
  const P = () => ctx.player?.position || null;

  const roleOf = (rec) => {
    const s = rec?.def?.smp;
    if (!s) return null;
    if (s.station === 'campfire') return 'fire';
    if (s.storage) return 'chest';
    if (s.bed) return 'bed';
    if (s.door) return 'door';
    return null;
  };
  /** Client-side access prediction (the server decides): your piece, or a piece in your claim. */
  const mine = (rec) => {
    const id = me();
    if (rec.owner != null && rec.owner === id) return true;
    const c = claimAt(smp.claims?.list, rec.x, rec.z);
    if (c) return c.owner === id;
    return rec.owner == null;
  };
  const nameOf = (rec) => rec.ownerName || ctx.net?.players?.get?.(rec.owner)?.name || t(TXT.someone);
  const send = (msg) => smp.send({ t: C.STORE, ...msg });
  const action = (name) => {
    try {
      ctx.player?.playAction?.(name);
    } catch {
      /* optional (fp-anim) */
    }
  };

  // ------------------------------------------------------------ interaction points
  function labelOf(rec, kind) {
    if (kind === 'fire') return t(readyFor(rec.id) ? TXT.collect : TXT.cook);
    if (kind === 'chest') return mine(rec) ? t(TXT.openChest) : t(TXT.lockedChest, { name: nameOf(rec) });
    if (kind === 'bed') return mine(rec) ? t(smp.bedId === rec.id ? TXT.sleep : TXT.sleepHome) : t(TXT.bedOf, { name: nameOf(rec) });
    if (kind === 'door') return mine(rec) ? t(rec.open ? TXT.closeDoor : TXT.openDoor) : t(TXT.lockedDoor, { name: nameOf(rec) });
    return '';
  }

  function onInteract(id) {
    const rec = records()?.get(id);
    const kind = roleOf(rec);
    if (!rec || !kind || !smp.ready) return;
    if (kind === 'fire') return openFire(rec);
    if (!mine(rec)) {
      ui.toast({ title: t(TXT.lockedTitle), text: t(TXT.lockedText, { name: nameOf(rec) }), icon: 'smp-lock', kind: 'warn', duration: 2400 });
      ctx.audio?.play?.('ui.error');
      return;
    }
    if (kind === 'chest') return openChest(rec);
    if (kind === 'bed') {
      action('use');
      send({ struct: rec.id, op: 'sleep' });
      return;
    }
    if (kind === 'door') {
      action('use');
      send({ struct: rec.id, op: 'toggle' });
    }
  }

  function ensure(rec, kind) {
    const cur = inter.get(rec.id);
    if (cur && cur.kind === kind) return;
    if (cur) ctx.interactions?.remove?.(cur.iid);
    const iid = `smp-base-${rec.id}`;
    const y = kind === 'door' ? 1.15 : kind === 'fire' ? 0.7 : kind === 'bed' ? 0.6 : 0.8;
    ctx.interactions?.add?.({
      id: iid,
      scope: 'world',
      position: new ctx.THREE.Vector3(rec.x, rec.y + y, rec.z),
      radius: kind === 'fire' ? 3.2 : kind === 'door' ? 2.6 : 2.5,
      label: () => labelOf(records()?.get(rec.id) || rec, kind),
      key: 'KeyE',
      priority: kind === 'door' ? 3 : 2,
      enabled: () => smp.ready && !ctx.build?.active,
      onInteract: () => onInteract(rec.id),
    });
    inter.set(rec.id, { kind, iid });
  }

  function syncNear() {
    const p = P();
    const recs = records();
    const seen = new Set();
    if (p && recs && smp.ready) {
      for (const rec of recs.values()) {
        const kind = roleOf(rec);
        if (!kind || Math.abs(rec.x - p.x) > NEAR || Math.abs(rec.z - p.z) > NEAR) continue;
        seen.add(rec.id);
        ensure(rec, kind);
      }
    }
    for (const [id, cur] of inter) {
      if (seen.has(id)) continue;
      ctx.interactions?.remove?.(cur.iid);
      inter.delete(id);
    }
  }

  // ------------------------------------------------------------ campfire
  const readyFor = (id) => {
    const f = fires.get(id);
    if (!f) return false;
    const now = st();
    return f.cook.some((s) => s.by === me() && s.done <= now);
  };

  let fireEls = null;
  function openFire(rec) {
    fireOpen = rec;
    action('use');
    send({ struct: rec.id, op: 'open' });
    if (!ui.isModalOpen(FIRE_MODAL)) {
      fireEls = buildFire();
      ui.openModal(FIRE_MODAL, fireEls.root, {
        className: 'smp-base-wrap',
        onClose: () => {
          fireOpen = null;
          fireEls = null;
        },
      });
      ctx.audio?.play?.('ui.open');
    }
    renderFire();
  }

  function buildFire() {
    const warm = h('span', { class: 'smp-base-warm' });
    const slots = h('div', { class: 'smp-grill' });
    const take = h('button', { class: 'btn btn-primary smp-take', type: 'button', text: t(TXT.takeMeals), onclick: () => fireOpen && send({ struct: fireOpen.id, op: 'collect' }) });
    const list = h('div', { class: 'smp-cook-list' });
    const root = h(
      'div',
      { class: 'smp-base smp-fire', role: 'dialog', 'aria-label': t(TXT.fireTitle) },
      h(
        'header',
        { class: 'smp-base-head' },
        h('span', { class: 'smp-base-icon fire', html: icon('smp-campfire', 26) }),
        h('div', { class: 'smp-base-titles' }, h('div', { class: 'smp-base-title', text: t(TXT.fireTitle) }), h('div', { class: 'smp-base-sub', text: t(TXT.fireSub) })),
        warm,
        h('button', { class: 'modal-close smp-inv-close', type: 'button', 'aria-label': t(TXT.close), html: icon('close', 22), onclick: () => ui.closeModal(FIRE_MODAL) }),
      ),
      h(
        'div',
        { class: 'smp-base-body' },
        h('section', { class: 'smp-base-col' }, h('div', { class: 'smp-sec-title', text: t(TXT.grill) }), slots, take),
        h('section', { class: 'smp-base-col smp-base-right' }, h('div', { class: 'smp-sec-title', text: t(TXT.recipes) }), list, h('div', { class: 'smp-base-hint', text: t(TXT.hint) })),
      ),
    );
    return { root, warm, slots, take, list, sig: '', slotEls: [] };
  }

  function chips(cost, inv, missing = {}) {
    return Object.entries(cost).map(([k, v]) =>
      h(
        'span',
        { class: `smp-chip${missing[k] ? ' short' : ''}`, title: t(ITEMS[k]?.name || RESOURCES[k]?.name || { en: k }) },
        h('span', { class: 'smp-chip-icon', html: icon(itemIcon(k), 12) }),
        `${v}`,
      ),
    );
  }

  function buffLine(id) {
    const it = ITEMS[id];
    const b = it?.buff ? BUFFS[it.buff.id] : null;
    const u = it?.use || {};
    const parts = [];
    if (u.en) parts.push(`+${u.en} ⚡`);
    if (u.hp) parts.push(`+${u.hp} ✚`);
    if (u.sh) parts.push(`+${u.sh} ⛉`);
    if (b) parts.push(`${t(b.name)} ${Math.round(it.buff.secs / 60)} min`);
    return parts.join(' · ');
  }

  function renderFire() {
    if (!fireEls || !fireOpen) return;
    const E = fireEls;
    const f = fires.get(fireOpen.id) || { cook: [], slots: fireOpen.def?.smp?.cook || 3 };
    const inv = smp.inv;
    const warm = !!smp.fx?.warm;
    E.warm.textContent = t(warm ? TXT.warmOn : TXT.warmOff);
    E.warm.classList.toggle('on', warm);
    // recipes (re-render only when the bag changes)
    const sig = `${JSON.stringify(inv.items)}|${f.cook.length}/${f.slots}`;
    if (sig !== E.sig) {
      E.sig = sig;
      E.list.innerHTML = '';
      const fullFire = f.cook.length >= f.slots;
      for (const r of Object.values(COOK_RECIPES)) {
        const cs = cookStatus(r, inv);
        const outId = Object.keys(r.out.items)[0];
        const outN = r.out.items[outId];
        const n = Math.min(cs.n, r.max || 1);
        const why = fullFire ? t(TXT.full) : cs.ok ? '' : t(TXT.need, { list: Object.entries(cs.missing).map(([k, v]) => `${v} ${t(ITEMS[k]?.name || { en: k }).toLowerCase()}`).join(', ') });
        E.list.appendChild(
          h(
            'div',
            { class: `smp-cook${cs.ok && !fullFire ? ' ok' : ''}`, dataset: { recipe: r.id } },
            h('span', { class: 'smp-cook-icon', html: icon(itemIcon(outId), 24) }),
            h(
              'span',
              { class: 'smp-cook-main' },
              h('span', { class: 'smp-cook-name', text: `${t(r.name)}${outN > 1 ? ` ×${outN}` : ''}` }),
              h('span', { class: 'smp-cook-fx', text: buffLine(outId) }),
              h('span', { class: 'smp-rcost' }, chips(r.cost, inv, cs.missing), h('span', { class: 'smp-cook-time', text: t(TXT.secs, { s: r.time }) })),
              why ? h('span', { class: 'smp-recipe-why', text: why }) : null,
            ),
            h(
              'span',
              { class: 'smp-recipe-actions' },
              n >= 2 && !fullFire ? h('button', { class: 'btn btn-sm', type: 'button', text: `×${n}`, onclick: () => cook(r.id, n) }) : null,
              h('button', { class: 'btn btn-sm smp-craft', type: 'button', disabled: cs.ok && !fullFire ? null : true, text: t(TXT.cookBtn), onclick: () => cook(r.id, 1) }),
            ),
          ),
        );
      }
    }
    renderGrill();
  }

  function renderGrill() {
    if (!fireEls || !fireOpen) return;
    const E = fireEls;
    const f = fires.get(fireOpen.id) || { cook: [], slots: fireOpen.def?.smp?.cook || 3 };
    const now = st();
    const myReady = f.cook.some((s) => s.by === me() && s.done <= now);
    E.take.disabled = !myReady;
    E.take.classList.toggle('pulse', myReady);
    while (E.slotEls.length < f.slots) {
      const ring = h('span', { class: 'smp-grill-ring' });
      const ic = h('span', { class: 'smp-grill-icon' });
      const name = h('span', { class: 'smp-grill-name' });
      const sub = h('span', { class: 'smp-grill-sub num' });
      const el = h('div', { class: 'smp-grill-slot' }, h('span', { class: 'smp-grill-dial' }, ring, ic), h('span', { class: 'smp-grill-main' }, name, sub));
      E.slots.appendChild(el);
      E.slotEls.push({ el, ring, ic, name, sub, key: '' });
    }
    for (let i = 0; i < E.slotEls.length; i++) {
      const S = E.slotEls[i];
      const s = f.cook[i];
      if (!s) {
        if (S.key !== 'empty') {
          S.key = 'empty';
          S.el.dataset.state = 'empty';
          S.ic.innerHTML = '';
          S.name.textContent = t(TXT.empty);
          S.sub.textContent = '';
          S.ring.style.setProperty('--p', '0');
        }
        continue;
      }
      const r = COOK_RECIPES[s.recipe];
      const outId = r ? Object.keys(r.out.items)[0] : s.recipe;
      const total = (r?.time || 10) * 1000;
      const left = Math.max(0, s.done - now);
      const p = Math.max(0, Math.min(1, 1 - left / total));
      const done = left <= 0;
      const own = s.by === me();
      const key = `${s.recipe}|${s.n}|${done}|${own}`;
      if (S.key !== key) {
        S.key = key;
        S.el.dataset.state = done ? 'done' : 'cooking';
        S.el.classList.toggle('foreign', !own);
        S.ic.innerHTML = icon(itemIcon(outId), 22);
        S.name.textContent = `${t(r?.name || { en: s.recipe })} ×${s.n * (r?.out.items[outId] || 1)}`;
      }
      S.ring.style.setProperty('--p', p.toFixed(3));
      S.sub.textContent = done ? (own ? t(TXT.ready) : t(TXT.someoneElse, { name: ctx.net?.players?.get?.(s.by)?.name || t(TXT.someone) })) : clock(left / 1000);
    }
  }

  function cook(recipe, n) {
    if (!fireOpen) return;
    action('use');
    ctx.audio?.play?.('ui.click');
    send({ struct: fireOpen.id, op: 'cook', recipe, n });
  }

  // ------------------------------------------------------------ chest
  let chestEls = null;
  function openChest(rec) {
    action('use');
    chestOpen = { rec, items: {}, res: {}, stacks: rec.def?.smp?.storage?.stacks || 24, loaded: false };
    send({ struct: rec.id, op: 'open' });
    if (!ui.isModalOpen(CHEST_MODAL)) {
      chestEls = buildChest();
      ui.openModal(CHEST_MODAL, chestEls.root, {
        className: 'smp-base-wrap',
        onClose: () => {
          chestOpen = null;
          chestEls = null;
        },
      });
      ctx.audio?.play?.('ui.open');
    }
    renderChest();
  }

  function buildChest() {
    const count = h('span', { class: 'smp-base-warm on' });
    const bag = h('div', { class: 'smp-xfer-list' });
    const box = h('div', { class: 'smp-xfer-list' });
    const root = h(
      'div',
      { class: 'smp-base smp-chest', role: 'dialog', 'aria-label': t(TXT.chestTitle) },
      h(
        'header',
        { class: 'smp-base-head' },
        h('span', { class: 'smp-base-icon', html: icon('smp-chest', 26) }),
        h('div', { class: 'smp-base-titles' }, h('div', { class: 'smp-base-title', text: t(TXT.chestTitle) }), h('div', { class: 'smp-base-sub', text: touch ? '' : t(TXT.chestHint) })),
        count,
        h('button', { class: 'modal-close smp-inv-close', type: 'button', 'aria-label': t(TXT.close), html: icon('close', 22), onclick: () => ui.closeModal(CHEST_MODAL) }),
      ),
      h(
        'div',
        { class: 'smp-base-body' },
        h(
          'section',
          { class: 'smp-base-col' },
          h('div', { class: 'smp-sec-title', text: t(TXT.bag) }),
          h('div', { class: 'smp-xfer-quick' }, h('button', { class: 'btn btn-sm', type: 'button', text: t(TXT.storeRes), onclick: () => storeAll('res') }), h('button', { class: 'btn btn-sm', type: 'button', text: t(TXT.storeMats), onclick: () => storeAll('mats') })),
          bag,
        ),
        h('section', { class: 'smp-base-col smp-base-right' }, h('div', { class: 'smp-sec-title', text: t(TXT.chest) }), h('div', { class: 'smp-xfer-quick' }, h('button', { class: 'btn btn-sm', type: 'button', text: t(TXT.takeAll), onclick: () => takeAll() })), box),
      ),
    );
    return { root, count, bag, box, sig: '' };
  }

  /** Entries of a {res, items} pair, resources first, then items by kind. */
  function entries(res, items) {
    const out = [];
    for (const k of RESOURCE_IDS) if ((res?.[k] | 0) > 0) out.push({ sec: 'res', id: k, n: res[k] | 0, name: t(RESOURCES[k].name), icon: RESOURCES[k].icon, color: RESOURCES[k].color, order: -1 });
    for (const [k, n] of Object.entries(items || {})) {
      if ((n | 0) <= 0 || !ITEMS[k]) continue;
      out.push({ sec: 'items', id: k, n: n | 0, name: t(ITEMS[k].name), icon: itemIcon(k), color: null, order: KIND_ORDER[ITEMS[k].kind] ?? 9 });
    }
    out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return out;
  }

  function xferRow(e, dir) {
    const move = (all) => {
      if (!chestOpen) return;
      const n = all ? e.n : Math.min(e.n, 10);
      action('use');
      send({ struct: chestOpen.rec.id, op: dir, [e.sec === 'res' ? 'res' : 'item']: e.id, n });
      ctx.audio?.play?.('ui.click');
    };
    return h(
      'div',
      { class: 'smp-xfer', dataset: { id: e.id } },
      h('button', { class: 'smp-xfer-main', type: 'button', onclick: (ev) => move(ev.shiftKey) }, h('span', { class: 'smp-row-icon', html: icon(e.icon, 16), style: e.color ? { color: e.color } : null }), h('span', { class: 'smp-row-name', text: e.name }), h('span', { class: 'smp-row-val num', text: formatNumber(e.n) })),
      h('button', { class: 'btn btn-sm smp-xfer-all', type: 'button', text: t(TXT.all), onclick: () => move(true) }),
    );
  }

  function renderChest() {
    if (!chestEls || !chestOpen) return;
    const E = chestEls;
    const inv = smp.inv;
    const sig = `${JSON.stringify(inv.res)}|${JSON.stringify(inv.items)}|${JSON.stringify(chestOpen.res)}|${JSON.stringify(chestOpen.items)}|${chestOpen.loaded}`;
    if (sig === E.sig) return;
    E.sig = sig;
    const inBox = entries(chestOpen.res, chestOpen.items);
    E.count.textContent = t(TXT.stacks, { n: inBox.length, max: chestOpen.stacks });
    E.bag.innerHTML = '';
    const bagList = entries(inv.res, inv.items).filter((e) => ITEMS[e.id]?.kind !== 'tool');
    for (const e of bagList) E.bag.appendChild(xferRow(e, 'put'));
    if (!bagList.length) E.bag.appendChild(h('div', { class: 'smp-base-hint', text: t(TXT.bagEmpty) }));
    E.box.innerHTML = '';
    for (const e of inBox) E.box.appendChild(xferRow(e, 'take'));
    if (!inBox.length && chestOpen.loaded) E.box.appendChild(h('div', { class: 'smp-base-hint', text: t(TXT.chestEmpty) }));
  }

  function storeAll(what) {
    if (!chestOpen) return;
    const inv = smp.inv;
    action('use');
    if (what === 'res') {
      for (const k of RESOURCE_IDS) if ((inv.res[k] | 0) > 0) send({ struct: chestOpen.rec.id, op: 'put', res: k, n: inv.res[k] | 0 });
    } else {
      for (const [k, n] of Object.entries(inv.items)) if ((n | 0) > 0 && ITEMS[k]?.kind === 'material') send({ struct: chestOpen.rec.id, op: 'put', item: k, n: n | 0 });
    }
    ctx.audio?.play?.('ui.click');
  }
  function takeAll() {
    if (!chestOpen) return;
    action('use');
    for (const e of entries(chestOpen.res, chestOpen.items)) send({ struct: chestOpen.rec.id, op: 'take', [e.sec === 'res' ? 'res' : 'item']: e.id, n: e.n });
    ctx.audio?.play?.('ui.click');
  }

  // ------------------------------------------------------------ server messages
  function onStorage(m) {
    if (m.kind === 'fire') {
      fires.set(String(m.struct), { cook: Array.isArray(m.cook) ? m.cook : [], slots: m.slots || 3 });
      if (m.got?.items) {
        const list = Object.entries(m.got.items).map(([k, n]) => `+${n} ${t(ITEMS[k]?.name || { en: k })}`);
        ui.toast({ title: t(TXT.cooked), text: list.join(' · '), icon: 'smp-meal', kind: 'reward', duration: 3000 });
        ctx.audio?.play?.('reward');
        events.emit('smp:cooked', { struct: m.struct, got: m.got.items });
      }
      if (fireOpen && String(fireOpen.id) === String(m.struct)) renderFire();
      return;
    }
    if (m.kind === 'chest') {
      if (chestOpen && String(chestOpen.rec.id) === String(m.struct)) {
        chestOpen.items = m.items || {};
        chestOpen.res = m.res || {};
        chestOpen.stacks = m.stacks || chestOpen.stacks;
        chestOpen.loaded = true;
        renderChest();
      }
      events.emit('smp:chest', { struct: m.struct });
      return;
    }
    if (m.kind === 'bed') {
      smp.bedId = String(m.struct);
      ui.toast({ title: t(TXT.homeTitle), text: t(TXT.homeText), icon: 'smp-bed', kind: 'success', duration: 6000 });
      ctx.audio?.play?.('reward');
      restFade();
      events.emit('smp:slept', { struct: m.struct });
    }
  }

  /** A short "rest" moment: the screen dims and comes back (the night can't be skipped in a shared world). */
  function restFade() {
    try {
      const p = ui.fade?.(true, 700);
      setTimeout(() => ui.fade?.(false, 900), 1100);
      return p;
    } catch {
      return null;
    }
  }

  function onDeny(m) {
    const reason = m.reason;
    let text = t(REASONS[reason] || REASONS.invalid);
    if (reason === 'private') text = t(TXT.lockedText, { name: m.name || t(TXT.someone) });
    if (reason === 'combat') text = t(TXT.combat);
    ui.toast({ title: t(reason === 'private' ? TXT.lockedTitle : REASONS.invalid), text, icon: reason === 'private' ? 'smp-lock' : 'smp-bag', kind: 'warn', duration: 2400 });
    ctx.audio?.play?.('ui.error');
  }

  // ------------------------------------------------------------ per frame
  let acc = 0;
  let grillAcc = 0;
  function update(dt) {
    acc += dt;
    if (acc > 0.4) {
      acc = 0;
      syncNear();
      // walked away from an open panel → close it
      const p = P();
      if (p && fireOpen && Math.hypot(fireOpen.x - p.x, fireOpen.z - p.z) > 7) ui.closeModal(FIRE_MODAL);
      if (p && chestOpen && Math.hypot(chestOpen.rec.x - p.x, chestOpen.rec.z - p.z) > 7) ui.closeModal(CHEST_MODAL);
      if (fireOpen && !records()?.has(fireOpen.id)) ui.closeModal(FIRE_MODAL);
      if (chestOpen && !records()?.has(chestOpen.rec.id)) ui.closeModal(CHEST_MODAL);
    }
    if (fireOpen) {
      grillAcc += dt;
      if (grillAcc > 0.2) {
        grillAcc = 0;
        renderFire();
      }
    }
  }

  function onInv() {
    if (fireOpen) renderFire();
    if (chestOpen) renderChest();
  }

  function reset() {
    fires.clear();
    for (const cur of inter.values()) ctx.interactions?.remove?.(cur.iid);
    inter.clear();
    if (ui.isModalOpen(FIRE_MODAL)) ui.closeModal(FIRE_MODAL);
    if (ui.isModalOpen(CHEST_MODAL)) ui.closeModal(CHEST_MODAL);
  }

  return {
    update,
    onStorage,
    onDeny,
    onInv,
    reset,
    openFire,
    openChest,
    fires,
    get fireOpen() {
      return fireOpen;
    },
    get chestOpen() {
      return chestOpen;
    },
    /** For tests / tools: the interaction ids near the player. */
    near: () => [...inter.keys()],
  };
}
