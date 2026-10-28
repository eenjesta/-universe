/**
 * Inventory & crafting screen (key I, touch menu "Inventory", the quick bar's
 * bag button, [E] at a workbench). Dark-glass modal in the 26_loadout_screen
 * style: weapons (equip with a click → C.EQUIP), supplies with Use (C.USE),
 * ammo, resources + Ø-credits on the left; crafting on the right: workbench
 * status, recipes from shared/defs/recipes.js with costs, tier gating
 * ("Needs a Workbench (tier 2) nearby") and Craft / ×5 buttons (C.CRAFT).
 * Phones: one column with Inventory / Crafting tabs.
 */
import { C } from '../../shared/protocol.js';
import { RESOURCES, RESOURCE_IDS, AMMO, AMMO_IDS, ITEMS, GEAR_SLOTS, FOOD_ORDER, SURVIVAL } from '../../shared/defs/items.js';
import { WEAPONS, WEAPON_SLOTS } from '../../shared/defs/weapons.js';
import { RECIPES, RECIPE_RANGE } from '../../shared/defs/recipes.js';
import { MARKET, SUPPLY_IDS as DEPOT_IDS } from '../../shared/defs/market.js';
import { AMMO_MAX } from '../../shared/sim/inventory.js';
import { t } from '../core/i18n.js';
import { formatNumber } from '../core/math.js';
import { ART, ICON_OF, itemIcon } from './icons.js';
import { recipeList, recipeOutputs, recipeStatus, craftableCount, recipeGroup } from './logic.js';

const MODAL = 'smp-inventory';
const TXT = {
  depot: { en: 'Supply depot · Ø-credits', nl: 'Voorraaddepot · Ø-credits' },
  depotFar: { en: 'The depot trades in the hub (safe zone) — stock up before you head out.', nl: 'Het depot handelt in de hub (veilige zone) — sla in voor je vertrekt.' },
  depotFull: { en: 'You can’t carry more', nl: 'Je kunt niet meer dragen' },
  depotCredits: { en: 'Not enough Ø-credits', nl: 'Niet genoeg Ø-credits' },
  buy: { en: 'Buy', nl: 'Kopen' },
  bought: { en: 'Bought {name}', nl: '{name} gekocht' },
  title: { en: 'Inventory', nl: 'Inventaris' },
  tagline: { en: 'Survival gear', nl: 'Overlevingsuitrusting' },
  inventory: { en: 'Inventory', nl: 'Inventaris' },
  crafting: { en: 'Crafting', nl: 'Maken' },
  weapons: { en: 'Weapons', nl: 'Wapens' },
  supplies: { en: 'Supplies', nl: 'Voorraad' },
  ammo: { en: 'Ammo', nl: 'Munitie' },
  resources: { en: 'Resources', nl: 'Grondstoffen' },
  credits: { en: 'Ø-credits', nl: 'Ø-credits' },
  equipped: { en: 'Equipped', nl: 'Uitgerust' },
  equip: { en: 'Equip', nl: 'Uitrusten' },
  locked: { en: 'Not owned', nl: 'Niet in bezit' },
  craftHint: { en: 'Craft at a workbench', nl: 'Te maken aan een werkbank' },
  craftHint2: { en: 'Workbench Mk II', nl: 'Werkbank Mk II' },
  use: { en: 'Use', nl: 'Gebruik' },
  craft: { en: 'Craft', nl: 'Maken' },
  dmg: { en: 'Damage', nl: 'Schade' },
  rate: { en: 'Fire rate', nl: 'Vuursnelheid' },
  range: { en: 'Range', nl: 'Bereik' },
  bench1: { en: 'Workbench · tier 1', nl: 'Werkbank · niveau 1' },
  bench2: { en: 'Workbench Mk II · tier 2', nl: 'Werkbank Mk II · niveau 2' },
  inRange: { en: 'in range ({d} m)', nl: 'binnen bereik ({d} m)' },
  noBench: { en: 'No workbench nearby', nl: 'Geen werkbank in de buurt' },
  noBenchHelp: { en: 'Stand within {r} m of a workbench to craft. Build one: B → 7 Survival → Workbench.', nl: 'Sta binnen {r} m van een werkbank om te maken. Bouw er een: B → 7 Overleven → Werkbank.' },
  noBenchHelpTouch: { en: 'Stand within {r} m of a workbench to craft. Build one: Menu → Build → Survival.', nl: 'Sta binnen {r} m van een werkbank om te maken. Bouw er een: Menu → Bouwen → Overleven.' },
  offline: { en: 'Survival needs the game server (online or offline mode).', nl: 'Overleven heeft de spelserver nodig (online of offline modus).' },
  needBench: { en: 'Needs a Workbench nearby', nl: 'Heeft een werkbank in de buurt nodig' },
  needTier: { en: 'Needs a Workbench (tier 2) nearby', nl: 'Heeft een werkbank (niveau 2) in de buurt nodig' },
  needUpgrade: { en: 'Stand at your own tier-1 workbench', nl: 'Sta bij je eigen werkbank van niveau 1' },
  owned: { en: 'Already owned', nl: 'Al in bezit' },
  short: { en: 'Not enough {res}', nl: 'Niet genoeg {res}' },
  tier: { en: 'Tier {n}', nl: 'Niveau {n}' },
  groupAmmo: { en: 'Ammo', nl: 'Munitie' },
  groupSupplies: { en: 'Survival', nl: 'Overleven' },
  groupTools: { en: 'Tools — craft anywhere', nl: 'Gereedschap — overal te maken' },
  groupGear: { en: 'Gear', nl: 'Uitrusting' },
  gear: { en: 'Gear', nl: 'Uitrusting' },
  slotArmor: { en: 'Armour', nl: 'Pantser' },
  slotModule: { en: 'Shield module', nl: 'Schildmodule' },
  noArmor: { en: 'None — craft Scout techwear at a workbench', nl: 'Geen — maak een verkennerspak aan een werkbank' },
  noModule: { en: 'None — a Shield module Mk I adds +25 shield', nl: 'Geen — een schildmodule Mk I geeft +25 schild' },
  unequip: { en: 'Take off', nl: 'Uitdoen' },
  equipGear: { en: 'Equip', nl: 'Aantrekken' },
  statHp: { en: 'Health {n}', nl: 'Gezondheid {n}' },
  statSh: { en: 'Shield {n}', nl: 'Schild {n}' },
  statDr: { en: 'Damage −{n} %', nl: 'Schade −{n} %' },
  food: { en: 'Food', nl: 'Eten' },
  foodHint: { en: 'Pick berries, glowcaps and fruit; cook them at a campfire for buffs.', nl: 'Pluk bessen, gloeikappen en fruit; kook ze op een kampvuur voor buffs.' },
  eat: { en: 'Eat', nl: 'Eten' },
  bag: { en: 'Bag', nl: 'Tas' },
  bagEmpty: { en: 'Materials, schematics and spare gear show up here.', nl: 'Materialen, bouwtekeningen en reserve-uitrusting verschijnen hier.' },
  needSchematic: { en: 'Needs the schematic (found at POIs)', nl: 'Heeft de bouwtekening nodig (te vinden bij bezienswaardigheden)' },
  needTier3: { en: 'Needs a Workbench Mk III nearby', nl: 'Heeft een Werkbank Mk III in de buurt nodig' },
  bench3: { en: 'Workbench Mk III · tier 3', nl: 'Werkbank Mk III · niveau 3' },
  needUpgrade2: { en: 'Stand at your own Workbench Mk II', nl: 'Sta bij je eigen Werkbank Mk II' },
  groupWeapons: { en: 'Weapons', nl: 'Wapens' },
  groupUpgrades: { en: 'Upgrades', nl: 'Upgrades' },
  upgradeOut: { en: 'Workbench → Mk II', nl: 'Werkbank → Mk II' },
  upgradeOut3: { en: 'Workbench Mk II → Mk III', nl: 'Werkbank Mk II → Mk III' },
  close: { en: 'Close', nl: 'Sluiten' },
  keys: { en: 'I close · 5–7 use supplies', nl: 'I sluiten · 5–7 voorraad gebruiken' },
};

const RES_NAME_LC = {
  metal: { en: 'metal', nl: 'metaal' },
  stone: { en: 'stone', nl: 'steen' },
  wood: { en: 'wood', nl: 'hout' },
  energy: { en: 'energy', nl: 'energie' },
  credits: { en: 'Ø-credits', nl: 'Ø-credits' },
};

const GROUP_TXT = { tools: 'groupTools', supplies: 'groupSupplies', gear: 'groupGear', ammo: 'groupAmmo', weapons: 'groupWeapons', upgrades: 'groupUpgrades' };
const groupOf = (r) => GROUP_TXT[recipeGroup(r)] || 'groupSupplies';
const SUPPLY_IDS = ['medkit', 'shield-cell', 'bandage'];

export function createScreen(ctx, smp) {
  const { ui, events } = ctx;
  const h = ui.h.bind(ui);
  const icon = (n, s) => ui.icon(n, s);
  let root = null;
  let tab = 'inv';
  const busy = new Map(); // recipe id → seconds left (waiting for the server)
  const parts = {};

  function header() {
    const creditsVal = h('span', { class: 'smp-inv-credits-val num' });
    parts.credits = creditsVal;
    return h(
      'header',
      { class: 'smp-inv-head' },
      h('div', { class: 'smp-inv-titles' }, h('div', { class: 'smp-inv-title', text: t(TXT.title) }), h('div', { class: 'smp-inv-tagline', text: t(TXT.tagline) })),
      h('div', { class: 'smp-inv-tabs', role: 'tablist' }, tabBtn('inv', TXT.inventory), tabBtn('craft', TXT.crafting)),
      h('div', { class: 'smp-inv-credits', title: t(TXT.credits) }, h('span', { class: 'smp-inv-credits-icon', html: icon('coin', 16) }), creditsVal),
      h('button', { class: 'modal-close smp-inv-close', type: 'button', 'aria-label': t(TXT.close), html: icon('close', 22), onclick: () => close() }),
    );
  }

  function tabBtn(id, label) {
    return h('button', {
      class: 'smp-inv-tab',
      type: 'button',
      role: 'tab',
      dataset: { tab: id },
      text: t(label),
      onclick: () => setTab(id),
    });
  }

  function setTab(id) {
    tab = id;
    if (!root) return;
    root.dataset.tab = id;
    for (const b of root.querySelectorAll('.smp-inv-tab')) b.classList.toggle('active', b.dataset.tab === id);
  }

  function build() {
    parts.gear = h('div', { class: 'smp-gear' });
    parts.food = h('div', { class: 'smp-tiles' });
    parts.bag = h('div', { class: 'smp-tiles' });
    parts.weapons = h('div', { class: 'smp-weapons' });
    parts.supplies = h('div', { class: 'smp-supplies' });
    parts.ammo = h('div', { class: 'smp-list' });
    parts.res = h('div', { class: 'smp-list' });
    parts.station = h('div', { class: 'smp-station' });
    parts.recipes = h('div', { class: 'smp-recipes' });
    parts.notice = h('div', { class: 'smp-notice' });
    parts.depot = h('div', { class: 'smp-recipes smp-depot' });
    const left = h(
      'section',
      { class: 'smp-inv-col smp-inv-left' },
      h('div', { class: 'smp-sec' }, h('div', { class: 'smp-sec-title', text: t(TXT.gear) }), parts.gear),
      h('div', { class: 'smp-sec' }, h('div', { class: 'smp-sec-title', text: t(TXT.food) }), parts.food),
      h('div', { class: 'smp-sec' }, h('div', { class: 'smp-sec-title', text: t(TXT.supplies) }), parts.supplies),
      h('div', { class: 'smp-sec' }, h('div', { class: 'smp-sec-title', text: t(TXT.weapons) }), parts.weapons),
      h('div', { class: 'smp-sec' }, h('div', { class: 'smp-sec-title', text: t(TXT.bag) }), parts.bag),
      h(
        'div',
        { class: 'smp-sec smp-sec-split' },
        h('div', {}, h('div', { class: 'smp-sec-title', text: t(TXT.ammo) }), parts.ammo),
        h('div', {}, h('div', { class: 'smp-sec-title', text: t(TXT.resources) }), parts.res),
      ),
    );
    const right = h(
      'section',
      { class: 'smp-inv-col smp-inv-right' },
      h('div', { class: 'smp-sec-title smp-craft-title', text: t(TXT.crafting) }),
      parts.station,
      parts.recipes,
      parts.depot,
    );
    root = h(
      'div',
      { class: 'smp-inv', role: 'dialog', 'aria-modal': 'true', 'aria-label': t(TXT.title), dataset: { tab } },
      header(),
      parts.notice,
      h('div', { class: 'smp-inv-body' }, left, right),
      h('footer', { class: 'smp-inv-foot', text: ctx.device?.touch ? '' : t(TXT.keys) }),
    );
    setTab(tab);
  }

  // ------------------------------------------------------------ render
  function bar(label, v) {
    return h('div', { class: 'smp-stat' }, h('span', { class: 'smp-stat-label', text: t(label) }), h('span', { class: 'smp-stat-track' }, h('span', { class: 'smp-stat-fill', style: { width: `${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%` } })));
  }

  let weaponsSig = '';
  function renderWeapons(inv) {
    const el = parts.weapons;
    // re-create the cards only when what they show changed (keeps hover/press transitions stable while harvesting)
    let sig = `${t(TXT.equipped)}|${inv.slot}|${(inv.weapons || []).join(',')}|${inv.items?.['shock-grenade'] | 0}`;
    for (const id of WEAPON_SLOTS) sig += `|${inv.mag?.[id] ?? ''}`;
    for (const k in inv.ammo || {}) sig += `|${k}${inv.ammo[k]}`;
    if (sig === weaponsSig && el.childElementCount) return;
    weaponsSig = sig;
    el.innerHTML = '';
    WEAPON_SLOTS.forEach((id, slot) => {
      const w = WEAPONS[id];
      if (!w) return;
      const throwable = w.kind === 'throw';
      const count = throwable ? inv.items?.[w.item || 'shock-grenade'] | 0 : 0;
      const owned = throwable ? count > 0 : inv.weapons.includes(id);
      const equipped = owned && inv.slot === slot;
      const recipe = Object.values(RECIPES).find((r) => r.out?.weapon === id || r.out?.items?.[id]);
      const ammoLine = throwable
        ? `× ${count} / ${ITEMS[w.item || 'shock-grenade']?.max ?? w.carry ?? 3}`
        : `${inv.mag?.[id] ?? 0} | ${formatNumber(inv.ammo?.[w.ammo] ?? 0)}`;
      const card = h(
        'button',
        {
          class: `smp-wcard${equipped ? ' equipped' : ''}${owned ? '' : ' locked'}`,
          type: 'button',
          dataset: { weapon: id },
          disabled: owned ? null : true,
          onclick: () => equip(slot, id),
        },
        h('span', { class: 'smp-wcard-key', text: String(slot + 1) }),
        h('span', { class: 'smp-wcard-art', html: ART[id] || '' }),
        h('span', { class: 'smp-wcard-name', text: t(w.name) }),
        h('span', { class: 'smp-wcard-ammo num', html: owned ? `<span class="smp-wcard-ammo-icon">${icon(ICON_OF[w.ammo] || 'smp-ammo', 13)}</span>${ammoLine}` : '' }),
        owned
          ? h('span', { class: 'smp-wcard-stats' }, bar(TXT.dmg, (w.dmg * (throwable ? 1 : 1)) / 75), bar(TXT.rate, (w.rate || 1) / 9), bar(TXT.range, (w.range || 25) / 250))
          : h('span', { class: 'smp-wcard-lock' }, h('span', { html: icon('bld-lock', 13) }), h('span', { text: recipe ? t(recipe.tier > 1 ? TXT.craftHint2 : TXT.craftHint) : t(TXT.locked) })),
        equipped ? h('span', { class: 'smp-wcard-badge', text: t(TXT.equipped) }) : null,
      );
      el.appendChild(card);
    });
  }

  function renderSupplies(inv) {
    const el = parts.supplies;
    el.innerHTML = '';
    for (const id of SUPPLY_IDS) {
      const def = ITEMS[id];
      const n = inv.items?.[id] | 0;
      const card = h(
        'div',
        { class: `smp-scard${n ? '' : ' empty'}`, dataset: { item: id } },
        h('span', { class: 'smp-scard-art', html: ART[id] || '' }),
        h('span', { class: 'smp-scard-main' }, h('span', { class: 'smp-scard-name', text: t(def.name) }), h('span', { class: 'smp-scard-desc', text: t(def.desc) })),
        h('span', { class: 'smp-scard-count num', text: `${n} / ${def.max}` }),
        h(
          'button',
          {
            class: 'btn btn-sm smp-use',
            type: 'button',
            disabled: n > 0 && smp.ready ? null : true,
            onclick: () => smp.use(id),
          },
          ctx.device?.touch || !def.hotkey ? null : h('span', { class: 'kbd smp-kbd', text: String(def.hotkey) }),
          t(TXT.use),
        ),
      );
      el.appendChild(card);
    }
  }

  // ------------------------------------------------------------ gear, food, bag
  function renderGear(inv) {
    const el = parts.gear;
    el.innerHTML = '';
    for (const slot of GEAR_SLOTS) {
      const id = inv.gear?.[slot] || null;
      const def = id ? ITEMS[id] : null;
      el.appendChild(
        h(
          'div',
          { class: `smp-gslot${def ? ' on' : ''}`, dataset: { slot } },
          h('span', { class: 'smp-gslot-icon', html: icon(def ? itemIcon(id) : slot === 'armor' ? 'smp-armor' : 'smp-module', 26) }),
          h(
            'span',
            { class: 'smp-gslot-main' },
            h('span', { class: 'smp-gslot-label', text: t(slot === 'armor' ? TXT.slotArmor : TXT.slotModule) }),
            h('span', { class: 'smp-gslot-name', text: def ? t(def.name) : t(slot === 'armor' ? TXT.noArmor : TXT.noModule) }),
            def ? h('span', { class: 'smp-gslot-desc', text: t(def.desc) }) : null,
          ),
          def ? h('button', { class: 'btn btn-sm', type: 'button', text: t(TXT.unequip), onclick: () => smp.equipGear(id, false) }) : null,
        ),
      );
    }
    const s = smp.stats || {};
    let dr = 0;
    for (const slot of GEAR_SLOTS) dr += ITEMS[inv.gear?.[slot]]?.gear?.dr || 0;
    el.appendChild(
      h(
        'div',
        { class: 'smp-gstats' },
        h('span', { text: t(TXT.statHp, { n: s.maxHp ?? SURVIVAL.maxHp }) }),
        h('span', { text: t(TXT.statSh, { n: s.maxSh ?? SURVIVAL.maxSh }) }),
        dr > 0 ? h('span', { text: t(TXT.statDr, { n: Math.round(dr * 100) }) }) : null,
      ),
    );
  }

  function tile(id, n, actionText, onAction) {
    const def = ITEMS[id];
    return h(
      'div',
      { class: `smp-tile k-${def.kind}`, dataset: { item: id }, title: t(def.desc || def.name) },
      h('span', { class: 'smp-tile-icon', html: icon(itemIcon(id), 22) }),
      h('span', { class: 'smp-tile-main' }, h('span', { class: 'smp-tile-name', text: t(def.name) }), h('span', { class: 'smp-tile-n num', text: `×${n}` })),
      actionText ? h('button', { class: 'btn btn-sm smp-tile-btn', type: 'button', disabled: smp.ready ? null : true, text: actionText, onclick: onAction }) : null,
    );
  }

  function renderFood(inv) {
    const el = parts.food;
    el.innerHTML = '';
    let any = false;
    for (const id of FOOD_ORDER) {
      const n = inv.items?.[id] | 0;
      if (n <= 0) continue;
      any = true;
      el.appendChild(tile(id, n, t(TXT.eat), () => smp.use(id)));
    }
    if (!any) el.appendChild(h('div', { class: 'smp-tiles-empty', text: t(TXT.foodHint) }));
  }

  function renderBag(inv) {
    const el = parts.bag;
    el.innerHTML = '';
    const order = { material: 0, schematic: 1, gear: 2, tool: 3 };
    const ids = Object.keys(inv.items || {})
      .filter((id) => (inv.items[id] | 0) > 0 && ITEMS[id] && order[ITEMS[id].kind] !== undefined)
      .sort((a, b) => order[ITEMS[a].kind] - order[ITEMS[b].kind]);
    for (const id of ids) {
      const def = ITEMS[id];
      el.appendChild(def.kind === 'gear' ? tile(id, inv.items[id] | 0, t(TXT.equipGear), () => smp.equipGear(id, true)) : tile(id, inv.items[id] | 0, null, null));
    }
    if (!ids.length) el.appendChild(h('div', { class: 'smp-tiles-empty', text: t(TXT.bagEmpty) }));
  }

  function row(iconName, color, name, value, max) {
    return h(
      'div',
      { class: 'smp-row' },
      h('span', { class: 'smp-row-icon', html: icon(iconName, 16), style: color ? { color } : null }),
      h('span', { class: 'smp-row-name', text: name }),
      h('span', { class: 'smp-row-val num', text: max ? `${formatNumber(value)} / ${formatNumber(max)}` : formatNumber(value) }),
    );
  }

  function renderLists(inv) {
    parts.ammo.innerHTML = '';
    for (const id of AMMO_IDS) parts.ammo.appendChild(row('smp-ammo', '#7fe0ff', t(AMMO[id].name), inv.ammo?.[id] | 0, AMMO_MAX[id] || 0));
    parts.res.innerHTML = '';
    for (const id of RESOURCE_IDS) parts.res.appendChild(row(RESOURCES[id].icon, RESOURCES[id].color, t(RESOURCES[id].name), inv.res?.[id] | 0));
    parts.credits.textContent = formatNumber(inv.credits | 0);
  }

  function renderStation() {
    const st = smp.station();
    const el = parts.station;
    el.innerHTML = '';
    el.classList.toggle('none', !st);
    if (st) {
      el.append(
        h('span', { class: 'smp-station-icon', html: icon('smp-workbench', 22) }),
        h('span', { class: 'smp-station-main' }, h('span', { class: 'smp-station-name', text: t(st.tier >= 3 ? TXT.bench3 : st.tier >= 2 ? TXT.bench2 : TXT.bench1) }), h('span', { class: 'smp-station-sub', text: t(TXT.inRange, { d: Math.max(1, Math.round(st.dist)) }) })),
      );
    } else {
      el.append(
        h('span', { class: 'smp-station-icon', html: icon('smp-workbench', 22) }),
        h('span', { class: 'smp-station-main' }, h('span', { class: 'smp-station-name', text: t(TXT.noBench) }), h('span', { class: 'smp-station-sub', text: t(ctx.device?.touch ? TXT.noBenchHelpTouch : TXT.noBenchHelp, { r: RECIPE_RANGE }) })),
      );
    }
    return st;
  }

  function reasonLine(st, r) {
    if (st.reason === 'workbench') return t(TXT.needBench);
    if (st.reason === 'tier') return t((r?.tier | 0) >= 3 ? TXT.needTier3 : TXT.needTier);
    if (st.reason === 'upgrade') return t(r?.upgrade === 'workbench-2' ? TXT.needUpgrade2 : TXT.needUpgrade);
    if (st.reason === 'schematic') return t(TXT.needSchematic);
    if (st.reason === 'owned') return t(TXT.owned);
    if (st.reason === 'cost') {
      const k = Object.keys(st.missing)[0];
      return t(TXT.short, { res: t(RES_NAME_LC[k] || { en: k }) });
    }
    return '';
  }

  function outLabel(r) {
    const outs = recipeOutputs(r);
    const o = outs[0];
    if (!o) return t(r.name);
    if (o.kind === 'upgrade') return t(r.upgrade === 'workbench-2' ? TXT.upgradeOut3 : TXT.upgradeOut);
    return t(r.name);
  }

  function outIcon(r) {
    const o = recipeOutputs(r)[0];
    if (!o) return 'smp-craft';
    if (o.kind === 'upgrade') return 'smp-workbench';
    return ITEMS[o.id] ? itemIcon(o.id) : ICON_OF[o.id] || 'smp-craft';
  }

  function renderRecipes(station) {
    const el = parts.recipes;
    el.innerHTML = '';
    const inv = smp.inv;
    const own = smp.station({ own: true });
    let group = null;
    for (const r of recipeList()) {
      const g = groupOf(r);
      if (g !== group) {
        group = g;
        el.appendChild(h('div', { class: 'smp-rgroup', text: t(TXT[g]) }));
      }
      const st = recipeStatus(r, inv, station, { ownStation: own });
      const waiting = busy.get(r.id) > 0;
      const cost = h(
        'span',
        { class: 'smp-rcost' },
        Object.entries(r.cost || {}).map(([k, v]) =>
          h(
            'span',
            { class: `smp-chip${st.missing[k] ? ' short' : ''}` },
            h('span', { class: 'smp-chip-icon', html: icon(RESOURCES[k]?.icon || (ITEMS[k] ? itemIcon(k) : 'coin'), 12), style: { color: RESOURCES[k]?.color || (ITEMS[k] ? (ITEMS[k].kind === 'schematic' ? '#b48cff' : '#b9d98a') : 'var(--gold)') } }),
            String(v),
          ),
        ),
      );
      const n5 = Math.min(5, craftableCount(r, inv));
      const card = h(
        'div',
        { class: `smp-recipe${st.ok ? ' ok' : ''}${st.reason === 'tier' || st.reason === 'workbench' ? ' gated' : ''}`, dataset: { recipe: r.id } },
        h('span', { class: 'smp-recipe-icon', html: icon(outIcon(r), 22) }),
        h(
          'span',
          { class: 'smp-recipe-main' },
          h('span', { class: 'smp-recipe-name' }, h('span', { text: outLabel(r) }), r.tier ? h('span', { class: `smp-tier t${r.tier}`, text: t(TXT.tier, { n: r.tier }) }) : null),
          cost,
          st.ok ? null : h('span', { class: `smp-recipe-why ${st.reason}`, text: reasonLine(st, r) }),
        ),
        h(
          'span',
          { class: 'smp-recipe-actions' },
          (r.max || 1) >= 5 && st.ok && n5 >= 2
            ? h('button', { class: 'btn btn-sm smp-craft-n', type: 'button', disabled: waiting ? true : null, text: `×${n5}`, onclick: () => craft(r.id, n5) })
            : null,
          h('button', { class: 'btn btn-sm smp-craft', type: 'button', disabled: !st.ok || waiting ? true : null, text: waiting ? '…' : t(TXT.craft), onclick: () => craft(r.id, 1) }),
        ),
      );
      el.appendChild(card);
    }
  }

  function render() {
    if (!root) return;
    const inv = smp.inv;
    parts.notice.textContent = smp.ready ? '' : t(TXT.offline);
    parts.notice.hidden = !!smp.ready;
    renderGear(inv);
    renderFood(inv);
    renderWeapons(inv);
    renderSupplies(inv);
    renderBag(inv);
    renderLists(inv);
    const st = renderStation();
    renderRecipes(st);
    renderDepot(inv);
  }

  // ------------------------------------------------------------ supply depot (credit sink, hub only)
  function renderDepot(inv) {
    const el = parts.depot;
    el.innerHTML = '';
    const inHub = smp.zone?.safe !== false;
    el.appendChild(h('div', { class: 'smp-rgroup', text: t(TXT.depot) }));
    if (!inHub) el.appendChild(h('div', { class: 'smp-recipe-why smp-depot-note', text: t(TXT.depotFar) }));
    for (const id of DEPOT_IDS) {
      const m = MARKET[id];
      const [item, n] = Object.entries(m.give)[0];
      const def = ITEMS[item];
      const fits = !def || (inv.items?.[item] || 0) + n <= def.max;
      const afford = (inv.credits || 0) >= m.price;
      const waiting = busy.get(id) > 0;
      const ok = inHub && fits && afford && smp.ready && !waiting;
      el.appendChild(
        h(
          'div',
          { class: `smp-recipe${ok ? ' ok' : ''}${inHub ? '' : ' gated'}`, dataset: { supply: id } },
          h('span', { class: 'smp-recipe-icon', html: icon(def ? itemIcon(item) : 'coin', 22) }),
          h(
            'span',
            { class: 'smp-recipe-main' },
            h('span', { class: 'smp-recipe-name', text: t(m.name) }),
            h('span', { class: 'smp-rcost' }, h('span', { class: `smp-chip${afford ? '' : ' short'}` }, h('span', { class: 'smp-chip-icon', html: icon('coin', 12), style: { color: 'var(--gold)' } }), formatNumber(m.price))),
            inHub && !(fits && afford) ? h('span', { class: 'smp-recipe-why', text: t(fits ? TXT.depotCredits : TXT.depotFull) }) : null,
          ),
          h('span', { class: 'smp-recipe-actions' }, h('button', { class: 'btn btn-sm smp-craft', type: 'button', disabled: ok ? null : true, text: waiting ? '…' : t(TXT.buy), onclick: () => buy(id) })),
        ),
      );
    }
  }
  function buy(id) {
    const m = MARKET[id];
    if (!m || !smp.ready || busy.get(id) > 0) return;
    ctx.audio?.play?.('ui.click');
    if (smp.send({ t: C.SPEND, reason: 'market', id, cost: { credits: m.price }, cid: `depot:${id}` })) {
      busy.set(id, 2.5);
      render();
    }
  }
  /** S.INV ack / S.DENY of a depot purchase (src/smp/index.js). */
  function depotDone(m, ok) {
    const id = String(m.ack ?? m.cid ?? '').slice('depot:'.length);
    busy.delete(id);
    if (ok && MARKET[id]) {
      ui.toast({ title: t(TXT.bought, { name: t(MARKET[id].name) }), icon: 'coin', kind: 'reward', duration: 2400 });
      ctx.audio?.play?.('reward');
    }
    render();
  }

  // ------------------------------------------------------------ actions
  function equip(slot, id) {
    if (!smp.ready) return;
    ctx.audio?.play?.('ui.click');
    smp.send({ t: C.EQUIP, slot });
    events.emit('smp:equip', { slot, weapon: id });
  }

  function craft(id, n = 1) {
    if (!smp.ready || busy.get(id) > 0) return;
    if (smp.craft(id, n)) {
      busy.set(id, 2.5);
      render();
    }
  }

  function done(recipe) {
    if (recipe) busy.delete(recipe);
    else busy.clear();
    render();
  }

  // ------------------------------------------------------------ open / close
  function open(which) {
    if (which === 'craft' || which === 'inv') tab = which;
    if (isOpen()) {
      setTab(tab);
      render();
      return;
    }
    build();
    render();
    ui.openModal(MODAL, root, { className: 'smp-inv-wrap', onClose: () => events.emit('smp:screen', { open: false }) });
    ctx.audio?.play?.('ui.open');
    events.emit('smp:screen', { open: true, tab });
  }
  function close() {
    if (ui.closeModal(MODAL)) ctx.audio?.play?.('ui.close');
  }
  const isOpen = () => ui.isModalOpen(MODAL);
  const toggle = (which) => (isOpen() ? close() : open(which));

  /** Per frame while open: craft requests that got no answer time out (re-render only on change). */
  function update(dt) {
    if (!isOpen() || !busy.size) return;
    let changed = false;
    for (const [k, v] of busy) {
      if (v - dt <= 0) {
        busy.delete(k);
        changed = true;
      } else busy.set(k, v - dt);
    }
    if (changed) render();
  }

  return { open, close, toggle, isOpen, render, done, depotDone, update, get tab() {
    return tab;
  } };
}
