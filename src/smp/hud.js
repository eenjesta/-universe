/**
 * SMP HUD: consumables quick bar (bottom-right, keys 5–7 + inventory button;
 * tappable on touch), the claim pill (top-centre: "Claimed by Kai" / "Your
 * claim"), survival warnings (hunger, starving, low health) and the one-time
 * onboarding tips for new players (pistol issued, find a workbench, claim your
 * land, set a spawn beacon). Styles in smp.css.
 */
import { ITEMS } from '../../shared/defs/items.js';
import { t } from '../core/i18n.js';

export const CONSUMABLES = ['ration', 'medkit', 'shield-cell'];

const TXT = {
  inventory: { en: 'Inventory', nl: 'Inventaris' },
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
  hungry: { en: 'Eat a ration — press 5.', nl: 'Eet een rantsoen — druk op 5.' },
  hungryTouch: { en: 'Eat a ration — tap it in the quick bar.', nl: 'Eet een rantsoen — tik erop in de snelbalk.' },
  hungryNone: { en: 'Craft rations at a workbench (2 wood, 1 energy).', nl: 'Maak rantsoenen aan een werkbank (2 hout, 1 energie).' },
  starvingTitle: { en: 'Starving!', nl: 'Je verhongert!' },
  starving: { en: 'You are losing health — eat a ration now.', nl: 'Je verliest gezondheid — eet nu een rantsoen.' },
  lowHpTitle: { en: 'Low health', nl: 'Weinig gezondheid' },
  lowHp: { en: 'Use a medkit — press 6.', nl: 'Gebruik een medkit — druk op 6.' },
  lowHpTouch: { en: 'Use a medkit from the quick bar.', nl: 'Gebruik een medkit uit de snelbalk.' },
  tipPistolTitle: { en: 'Survival — welcome', nl: 'Overleven — welkom' },
  tipPistol: { en: 'You were issued a Pulse Pistol and 3 rations. Press 1 to draw the pistol, I for your inventory.', nl: 'Je hebt een Pulspistool en 3 rantsoenen gekregen. Druk op 1 om het pistool te trekken, I voor je inventaris.' },
  tipPistolTouch: { en: 'You were issued a Pulse Pistol and 3 rations. Menu → Inventory shows your gear.', nl: 'Je hebt een Pulspistool en 3 rantsoenen gekregen. Menu → Inventaris toont je uitrusting.' },
  tipBenchTitle: { en: 'Find a workbench', nl: 'Zoek een werkbank' },
  tipBench: { en: 'Crafting needs a Workbench. Out beyond the hub, harvest wood, stone and metal (hold E), then press B → 7 Survival → Workbench.', nl: 'Maken kan aan een werkbank. Oogst buiten de hub hout, steen en metaal (houd E vast) en druk dan op B → 7 Overleven → Werkbank.' },
  tipBenchTouch: { en: 'Crafting needs a Workbench. Out beyond the hub, harvest resources, then Menu → Build → Survival → Workbench.', nl: 'Maken kan aan een werkbank. Oogst buiten de hub grondstoffen, dan Menu → Bouwen → Overleven → Werkbank.' },
  tipClaimTitle: { en: 'Claim your land', nl: 'Claim je land' },
  tipClaim: { en: 'Place a Claim Beacon (Survival): nobody else can build or demolish within 24 m of it.', nl: 'Plaats een claimbaken (Overleven): niemand anders kan binnen 24 m bouwen of slopen.' },
  tipSpawnTitle: { en: 'Respawn at home', nl: 'Respawnen in je basis' },
  tipSpawn: { en: 'Build a Spawn Beacon in your base: after a defeat you can return there.', nl: 'Bouw een spawnbaken in je basis: na een nederlaag kun je daar terugkeren.' },
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
    CONSUMABLES.map((id) => {
      const def = ITEMS[id];
      const count = h('span', { class: 'smp-quick-count num', text: '0' });
      const el = h(
        'button',
        {
          class: 'smp-quick-slot',
          type: 'button',
          dataset: { item: id },
          title: `${t(def.name)} [${def.hotkey}]`,
          onclick: (e) => {
            e.currentTarget.blur();
            smp.use(id);
          },
        },
        h('span', { class: 'smp-quick-key', text: String(def.hotkey) }),
        h('span', { class: 'smp-quick-icon', html: ui.icon(id === 'ration' ? 'smp-ration' : id === 'medkit' ? 'smp-medkit' : 'smp-shield', 22) }),
        count,
      );
      slots[id] = { el, count, n: -1 };
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

  function refreshBar() {
    const inv = smp.inv;
    for (const id of CONSUMABLES) {
      const s = slots[id];
      const n = inv.items?.[id] | 0;
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
    const s = slots[id];
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
        const has = (smp.inv.items?.ration | 0) > 0;
        ui.toast({ title: t(TXT.hungryTitle), text: t(has ? (touch ? TXT.hungryTouch : TXT.hungry) : TXT.hungryNone), icon: 'smp-ration', kind: 'warn', duration: 6000 });
        flashSlot('ration', true);
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
    if (piece === 'workbench') tip('claim', TXT.tipClaimTitle, TXT.tipClaim);
    if (piece === 'claim-beacon') tip('spawn', TXT.tipSpawnTitle, TXT.tipSpawn);
  });
  let slowAcc = 0;
  function update(dt) {
    flushTips(dt);
    slowAcc += dt;
    if (slowAcc < 1) return;
    slowAcc = 0;
    if (!smp.ready || readyAt < 0) return;
    const since = ctx.loop.time - readyAt;
    if (since > 40 && !owns('workbench') && !smp.station()) tip('bench', TXT.tipBenchTitle, touch ? TXT.tipBenchTouch : TXT.tipBench);
    if (since > 40 && owns('workbench') && !owns('claim-beacon')) tip('claim', TXT.tipClaimTitle, TXT.tipClaim);
  }

  return { bar, pill, refreshBar, refreshVisible, flashSlot, setClaim, setZone, onStats, onReady, update, tip };
}
