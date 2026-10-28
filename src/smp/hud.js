/**
 * SMP HUD: consumables quick bar (bottom-right, keys 5–7 + inventory button;
 * tappable on touch), the claim pill (top-centre: "Claimed by Kai" / "Your
 * claim"), survival warnings (hunger, starving, low health) and the one-time
 * onboarding tips for new players (pistol issued, find a workbench, claim your
 * land, set a spawn beacon). Styles in smp.css.
 */
import { ITEMS, BUFFS } from '../../shared/defs/items.js';
import { t } from '../core/i18n.js';
import { bestFood, foodCount, clock } from './logic.js';
import { itemIcon } from './icons.js';

/** Quick bar slots (keys 5–7): 'food' = the best food you carry (meals → ration → raw food). */
export const CONSUMABLES = ['food', 'medkit', 'shield-cell'];
const BUFF_ORDER = ['cold', 'warm', 'fed', 'swift', 'charged', 'rested'];

const TXT = {
  inventory: { en: 'Inventory', nl: 'Inventaris' },
  eat: { en: 'Eat', nl: 'Eten' },
  claimedBy: { en: 'Claimed by {name}', nl: 'Geclaimd door {name}' },
  claimed: { en: 'Claimed land', nl: 'Geclaimd land' },
  yourClaim: { en: 'Your claim', nl: 'Jouw claim' },
  locked: { en: 'building locked', nl: 'bouwen vergrendeld' },
  protectedTxt: { en: 'protected', nl: 'beschermd' },
  decaying: { en: 'abandoned · decaying', nl: 'verlaten · vervalt' },
  safeZone: { en: 'Safe zone', nl: 'Veilige zone' },
  safeSub: { en: 'no combat · no building', nl: 'geen gevechten · niet bouwen' },
  leaving: { en: 'Leaving the safe zone', nl: 'Je verlaat de veilige zone' },
  wild: { en: 'Wilderness', nl: 'Wildernis' },
  bufferSub: { en: 'building {m} m further out', nl: 'bouwen {m} m verderop' },
  leavingTitle: { en: 'Leaving the safe zone', nl: 'Je verlaat de veilige zone' },
  leavingText: { en: 'Enemies roam out here, hunger sets in and the night is dangerous. Building is allowed from {m} m beyond the border.', nl: 'Hier zwerven vijanden, je krijgt honger en de nacht is gevaarlijk. Bouwen mag vanaf {m} m voorbij de grens.' },
  enteredText: { en: 'Weapons holstered · no damage · no hunger.', nl: 'Wapens opgeborgen · geen schade · geen honger.' },
  hungryTitle: { en: 'You’re hungry', nl: 'Je hebt honger' },
  hungry: { en: 'Eat something — press 5.', nl: 'Eet iets — druk op 5.' },
  hungryTouch: { en: 'Eat something — tap the food slot in the quick bar.', nl: 'Eet iets — tik op het eten in de snelbalk.' },
  hungryNone: { en: 'Pick berries and glowcaps in the wild, or cook a meal at a campfire.', nl: 'Pluk bessen en gloeikappen in de wildernis, of kook een maaltijd op een kampvuur.' },
  coldTitle: { en: 'A cold night', nl: 'Een koude nacht' },
  coldText: { en: 'Out in the dark you get hungry faster. Build a campfire (B → 7) — its warmth heals you.', nl: 'In het donker krijg je sneller honger. Bouw een kampvuur (B → 7) — de warmte geneest je.' },
  coldTouch: { en: 'Out in the dark you get hungry faster. Build a campfire (Menu → Build → Survival).', nl: 'In het donker krijg je sneller honger. Bouw een kampvuur (Menu → Bouwen → Overleven).' },
  starvingTitle: { en: 'Starving!', nl: 'Je verhongert!' },
  starving: { en: 'You are losing health — eat a ration now.', nl: 'Je verliest gezondheid — eet nu een rantsoen.' },
  lowHpTitle: { en: 'Low health', nl: 'Weinig gezondheid' },
  lowHp: { en: 'Use a medkit — press 6.', nl: 'Gebruik een medkit — druk op 6.' },
  lowHpTouch: { en: 'Use a medkit from the quick bar.', nl: 'Gebruik een medkit uit de snelbalk.' },
  crate: { en: 'Your crate · {d}', nl: 'Je krat · {d}' },
  crateDesc: { en: 'The supplies you dropped — only you can open the crate. Follow the gold marker.', nl: 'De voorraad die je liet vallen — alleen jij kunt de krat openen. Volg de gouden markering.' },
  tipPistolTitle: { en: 'Survival — welcome', nl: 'Overleven — welkom' },
  tipPistol: { en: 'You carry a Pulse Pistol, rations, bandages and a handful of berries. 1 draws the pistol, I opens your inventory and crafting.', nl: 'Je hebt een Pulspistool, rantsoenen, verband en een handvol bessen bij je. 1 trekt het pistool, I opent je inventaris en het maken.' },
  tipPistolTouch: { en: 'You carry a Pulse Pistol, rations, bandages and a handful of berries. Menu → Inventory shows your gear and crafting.', nl: 'Je hebt een Pulspistool, rantsoenen, verband en een handvol bessen bij je. Menu → Inventaris toont je uitrusting en het maken.' },
  tipBenchTitle: { en: 'Workbench', nl: 'Werkbank' },
  tipBench: { en: 'Open your inventory (I) next to it: ammo, medkits, weapons and gear. Upgrade it to Mk II and Mk III for better recipes.', nl: 'Open je inventaris (I) ernaast: munitie, medkits, wapens en uitrusting. Upgrade naar Mk II en Mk III voor betere recepten.' },
  tipBenchTouch: { en: 'Open your inventory next to it: ammo, medkits, weapons and gear. Upgrade it to Mk II and Mk III for better recipes.', nl: 'Open je inventaris ernaast: munitie, medkits, wapens en uitrusting. Upgrade naar Mk II en Mk III voor betere recepten.' },
  tipFireTitle: { en: 'Campfire', nl: 'Kampvuur' },
  tipFire: { en: 'Step up to it ([E]) to cook raw food into meals. Its warmth heals you and keeps the night chill away.', nl: 'Loop erheen ([E]) om rauw eten tot maaltijden te koken. De warmte geneest je en houdt de nachtkou weg.' },
  tipClaimTitle: { en: 'Claim your land', nl: 'Claim je land' },
  tipClaim: { en: 'Place a Claim Beacon (Survival): nobody else can build or demolish within 24 m of it.', nl: 'Plaats een claimbaken (Overleven): niemand anders kan binnen 24 m bouwen of slopen.' },
  tipSpawnTitle: { en: 'Respawn at home', nl: 'Respawnen in je basis' },
  tipSpawn: { en: 'Build a Bed or Sleeping Bag (Survival) and sleep in it: after a defeat you wake up there.', nl: 'Bouw een bed of slaapzak (Overleven) en slaap erin: na een nederlaag word je daar wakker.' },
};

export function createSmpHud(ctx, smp) {
  const { ui, state, events } = ctx;
  const h = ui.h.bind(ui);
  const touch = !!ctx.device?.touch;

  // ------------------------------------------------------------ quick bar
  const slots = {};
  const bar = h(
    'div',
    { class: 'smp-quick', role: 'toolbar', 'aria-label': t(TXT.inventory) },
    CONSUMABLES.map((id, k) => {
      const def = ITEMS[id];
      const count = h('span', { class: 'smp-quick-count num', text: '0' });
      const iconEl = h('span', { class: 'smp-quick-icon', html: ui.icon(id === 'food' ? 'smp-food' : itemIcon(id), 22) });
      const el = h(
        'button',
        {
          class: `smp-quick-slot${id === 'food' ? ' smp-quick-food' : ''}`,
          type: 'button',
          dataset: { item: id },
          title: `${id === 'food' ? t(TXT.eat) : t(def.name)} [${5 + k}]`,
          onclick: (e) => {
            e.currentTarget.blur();
            id === 'food' ? smp.eat() : smp.use(id);
          },
        },
        h('span', { class: 'smp-quick-key', text: String(5 + k) }),
        iconEl,
        count,
      );
      slots[id] = { el, count, iconEl, n: -1, icon: '' };
      return el;
    }),
    h(
      'button',
      {
        class: 'smp-quick-slot smp-quick-bag',
        type: 'button',
        title: `${t(TXT.inventory)} [I]`,
        onclick: (e) => {
          e.currentTarget.blur();
          smp.toggle();
        },
      },
      h('span', { class: 'smp-quick-key', text: 'I' }),
      h('span', { class: 'smp-quick-icon', html: ui.icon('smp-bag', 22) }),
    ),
  );
  ui.addWidget('bottom-right', bar, { modes: ['explore'], order: 6 });
  ui.setVisible(bar, false);

  // ------------------------------------------------------------ buff strip (above the vitals)
  const strip = h('div', { class: 'smp-buffs', role: 'status' });
  ui.addWidget('bottom-center', strip, { modes: ['explore'], order: 21 });
  ui.setVisible(strip, false);
  const pills = new Map(); // id → {el, time}
  let stripKey = '';
  const dist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
  function renderBuffs() {
    const fx = smp.fx || {};
    const ids = BUFF_ORDER.filter((id) => fx[id]);
    // your death crate: time left + distance (the compass / screen marker shows where)
    const drop = smp.deathDrop && !smp.stats?.dead ? smp.deathDrop : null;
    if (drop) ids.unshift('crate');
    const now = typeof ctx.net?.serverTime === 'function' ? ctx.net.serverTime() : Date.now();
    const key = ids.join(',');
    if (key !== stripKey) {
      stripKey = key;
      strip.innerHTML = '';
      pills.clear();
      for (const id of ids) {
        if (id === 'crate') {
          const time = h('span', { class: 'smp-buff-time num' });
          const name = h('span', { class: 'smp-buff-name' });
          const el = h('div', { class: 'smp-buff crate', dataset: { buff: 'crate' }, title: t(TXT.crateDesc) }, h('span', { class: 'smp-buff-icon', html: ui.icon('smp-skull', 14) }), name, time);
          strip.appendChild(el);
          pills.set(id, { el, time, name, last: '' });
          continue;
        }
        const b = BUFFS[id];
        const time = h('span', { class: 'smp-buff-time num' });
        const el = h('div', { class: `smp-buff${b.bad ? ' bad' : ''}`, dataset: { buff: id }, title: t(b.desc) }, h('span', { class: 'smp-buff-icon', html: ui.icon(b.icon, 14) }), h('span', { class: 'smp-buff-name', text: t(b.name) }), time);
        strip.appendChild(el);
        pills.set(id, { el, time, last: '' });
      }
    }
    for (const [id, p] of pills) {
      if (id === 'crate') {
        if (!drop) continue;
        const pp = ctx.player?.position;
        const left = Math.max(0, drop.until - ctx.loop.time);
        const txt = `${t(TXT.crate, { d: pp ? dist(Math.hypot(drop.pos.x - pp.x, drop.pos.z - pp.z)) : '' })}|${clock(left)}`;
        if (txt !== p.last) {
          p.last = txt;
          const [a, b] = txt.split('|');
          p.name.textContent = a;
          p.time.textContent = b;
          p.el.classList.toggle('ending', left < 60);
        }
        continue;
      }
      const v = fx[id];
      const txt = v > 1 ? clock((v - now) / 1000) : '';
      if (txt !== p.last) {
        p.last = txt;
        p.time.textContent = txt;
        p.el.classList.toggle('ending', v > 1 && v - now < 30000);
      }
    }
    ui.setVisible(strip, !!smp.ready && ids.length > 0 && !ctx.build?.active);
  }
  events.on('smp:fx', () => {
    renderBuffs();
    if (smp.fx?.cold && !warn.coldShown) {
      warn.coldShown = true;
      tip('cold', TXT.coldTitle, touch ? TXT.coldTouch : TXT.coldText);
    }
  });

  function refreshBar() {
    const inv = smp.inv;
    for (const id of CONSUMABLES) {
      const s = slots[id];
      let n = inv.items?.[id] | 0;
      if (id === 'food') {
        n = foodCount(inv);
        const best = bestFood(inv);
        const ic = best ? itemIcon(best.id) : 'smp-food';
        if (ic !== s.icon) {
          s.icon = ic;
          s.iconEl.innerHTML = ui.icon(ic, 22);
        }
        s.el.title = `${t(TXT.eat)}${best ? ` — ${t(ITEMS[best.id].name)}` : ''} [5]`;
      }
      if (n !== s.n) {
        if (s.n >= 0 && n > s.n) {
          s.el.classList.remove('gain');
          void s.el.offsetWidth;
          s.el.classList.add('gain');
        }
        s.n = n;
        s.count.textContent = String(n);
        s.el.classList.toggle('empty', n <= 0);
      }
    }
  }

  function flashSlot(id, ok) {
    const k = ITEMS[id]?.kind;
    const s = slots[id] || (k === 'food' || k === 'meal' || id === 'ration' || id === 'food' ? slots.food : null);
    if (!s) return;
    const cls = ok ? 'used' : 'denied';
    s.el.classList.remove('used', 'denied');
    void s.el.offsetWidth;
    s.el.classList.add(cls);
  }

  // ------------------------------------------------------------ zone / claim pill (top-centre)
  // priority: inside a claim > leaving the safe zone > safe zone > no-build band > (wilderness: hidden)
  const pillIcon = h('span', { class: 'smp-claim-icon' });
  const pillText = h('span', { class: 'smp-claim-text' });
  const pillSub = h('span', { class: 'smp-claim-sub num' });
  const pill = h('div', { class: 'smp-claim', role: 'status' }, pillIcon, pillText, pillSub);
  ui.addWidget('top-center', pill, { modes: ['explore', 'drive'], order: 30 });
  ui.setVisible(pill, false);
  const pillState = { claim: null, mine: false, zone: null, d: 0, need: 0, key: '' };
  const iconCache = {};
  const iconHtml = (name) => (iconCache[name] ??= ui.icon(name, 16));

  function renderPill() {
    const { claim, mine, zone } = pillState;
    let kind = '';
    let icon = 'smp-claim';
    let text = '';
    let sub = '';
    if (claim) {
      kind = mine ? 'mine' : 'claim';
      text = mine ? t(TXT.yourClaim) : claim.name ? t(TXT.claimedBy, { name: claim.name }) : t(TXT.claimed);
      sub = mine ? t(TXT.protectedTxt) : claim.decay > 0 ? t(TXT.decaying) : t(TXT.locked);
    } else if (zone === 'leaving') {
      kind = 'leaving';
      icon = 'smp-wild';
      text = t(TXT.leaving);
      sub = `${Math.max(0, Math.round(-pillState.d))} m`;
    } else if (zone === 'safe') {
      kind = 'safe';
      icon = 'smp-safe';
      text = t(TXT.safeZone);
      sub = t(TXT.safeSub);
    } else if (zone === 'buffer') {
      kind = 'buffer';
      icon = 'smp-wild';
      text = t(TXT.wild);
      sub = t(TXT.bufferSub, { m: Math.max(10, Math.ceil(pillState.need / 10) * 10) });
    }
    const key = `${kind}|${text}|${sub}`;
    if (key === pillState.key) return;
    pillState.key = key;
    if (!kind || !smp.ready) {
      ui.setVisible(pill, false);
      return;
    }
    pill.dataset.kind = kind;
    pill.dataset.mine = kind === 'mine' ? '1' : '0';
    if (pillIcon.dataset.icon !== icon) {
      pillIcon.dataset.icon = icon;
      pillIcon.innerHTML = iconHtml(icon);
    }
    pillText.textContent = text;
    pillSub.textContent = sub;
    ui.setVisible(pill, true);
  }

  function setClaim(claim, mine) {
    pillState.claim = claim || null;
    pillState.mine = !!mine;
    renderPill();
  }

  /** Zone state from the tracker: kind 'safe' | 'leaving' | 'buffer' | 'wild', d = signed border distance. */
  function setZone(kind, d, need = 0, crossed = 0) {
    pillState.zone = kind;
    pillState.d = d;
    pillState.need = need;
    renderPill();
    if (!crossed || !smp.ready) return;
    if (crossed < 0) {
      ui.toast({ title: t(TXT.leavingTitle), text: t(TXT.leavingText, { m: smp.world?.buffer ?? 500 }), icon: 'smp-wild', kind: 'warn', duration: 6500 });
    } else {
      ui.toast({ title: t(TXT.safeZone), text: t(TXT.enteredText), icon: 'smp-safe', kind: 'success', duration: 4500 });
    }
  }

  // ------------------------------------------------------------ visibility
  function refreshVisible() {
    const on = !!smp.ready && !ctx.build?.active;
    ui.setVisible(bar, on);
    renderBuffs();
  }
  events.on('build:mode', refreshVisible);

  // ------------------------------------------------------------ warnings
  const warn = { hungry: false, starving: false, lowHp: 0 };
  function onStats(s) {
    if (!smp.ready || !s) return;
    const en = Number(s.en);
    const hp = Number(s.hp);
    if (Number.isFinite(en)) {
      if (en <= 0.5 && !warn.starving) {
        warn.starving = true;
        ui.toast({ title: t(TXT.starvingTitle), text: t(TXT.starving), icon: 'smp-ration', kind: 'error', duration: 6000 });
        ctx.audio?.play?.('ui.error');
      } else if (en > 5) warn.starving = false;
      if (en < 25 && en > 0.5 && !warn.hungry) {
        warn.hungry = true;
        const has = foodCount(smp.inv) > 0;
        ui.toast({ title: t(TXT.hungryTitle), text: t(has ? (touch ? TXT.hungryTouch : TXT.hungry) : TXT.hungryNone), icon: 'smp-food', kind: 'warn', duration: 6000 });
        flashSlot('food', true);
      } else if (en > 35) warn.hungry = false;
    }
    if (Number.isFinite(hp) && hp > 0 && hp < 35 && (smp.inv.items?.medkit | 0) > 0 && ctx.loop.time - warn.lowHp > 30) {
      warn.lowHp = ctx.loop.time;
      ui.toast({ title: t(TXT.lowHpTitle), text: t(touch ? TXT.lowHpTouch : TXT.lowHp), icon: 'smp-medkit', kind: 'warn', duration: 4500 });
    }
  }

  // ------------------------------------------------------------ onboarding tips
  state.ensure('smpTips', {});
  const shown = (id) => !!state.get(`smpTips.${id}`);
  const tipQueue = [];
  let tipT = 0;
  function tip(id, title, text) {
    if (shown(id) || tipQueue.some((q) => q.id === id)) return;
    tipQueue.push({ id, title, text });
  }
  function flushTips(dt) {
    tipT -= dt;
    if (tipT > 0 || !tipQueue.length || !ctx.modes?.is?.('explore') || ui.isModalOpen()) return;
    const q = tipQueue.shift();
    if (shown(q.id)) return;
    state.set(`smpTips.${q.id}`, true);
    ui.toast({ title: t(q.title), text: t(q.text), icon: 'smp-tip', kind: 'quest', duration: 9000 });
    tipT = 10;
  }
  let readyAt = -1;
  const owns = (type) => {
    const id = smp.me();
    const recs = ctx.build?.registry?.records;
    if (!recs || id == null) return false;
    for (const r of recs.values()) if (r.owner === id && (r.type === type || (type === 'workbench' && r.type === 'workbench-2'))) return true;
    return false;
  };
  function onReady() {
    readyAt = ctx.loop.time;
    pillState.key = '';
    renderPill();
    if ((smp.inv.weapons || []).includes('pulse-pistol')) tip('pistol', TXT.tipPistolTitle, touch ? TXT.tipPistolTouch : TXT.tipPistol);
    refreshVisible();
    refreshBar();
  }
  events.on('build:placed', ({ piece } = {}) => {
    if (!smp.ready) return;
    if (piece === 'workbench') tip('bench2', TXT.tipBenchTitle, touch ? TXT.tipBenchTouch : TXT.tipBench);
    if (piece === 'campfire') tip('fire', TXT.tipFireTitle, TXT.tipFire);
    if (piece === 'claim-beacon' && !smp.bedId) tip('bed', TXT.tipSpawnTitle, TXT.tipSpawn);
  });
  let slowAcc = 0;
  let buffAcc = 0;
  function update(dt) {
    flushTips(dt);
    buffAcc += dt;
    if (buffAcc > 0.5 && (pills.size || smp.deathDrop)) {
      buffAcc = 0;
      renderBuffs();
    }
    slowAcc += dt;
    if (slowAcc < 1) return;
    slowAcc = 0;
    if (!smp.ready || readyAt < 0) return;
    const since = ctx.loop.time - readyAt;
    // (the survival onboarding quests guide the rest: src/systems/quests/data.js wild1 … wild6)
    if (since > 40 && owns('workbench') && !owns('claim-beacon') && !ctx.quests?.isActive?.('wild4')) tip('claim', TXT.tipClaimTitle, TXT.tipClaim);
  }

  return { bar, pill, refreshBar, refreshVisible, flashSlot, setClaim, setZone, onStats, onReady, update, tip };
}
