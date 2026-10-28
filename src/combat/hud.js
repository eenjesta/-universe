/**
 * Combat HUD (DOM, styled in combat.css): vitals (health / shield / energy,
 * bottom-center), ammo + weapon (bottom-right, order 5), crosshair with dynamic
 * spread, railgun charge ring and hit markers (center), damage numbers, damage
 * vignette + directional indicators + low-health heartbeat tint, killfeed
 * (right), enemy health bars + "Enemy" pings, deny messages, wave banner and a
 * boss bar (for later phases). Values are written to the DOM only when they
 * change; per-frame work is projection + transforms on pooled elements.
 */
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { clamp } from '../core/math.js';
import { registerIcons, icon } from '../ui/icons.js';
import { weaponIcon } from './models.js';
import { damageAngle, hpFrac } from './logic.js';

export const TXT = {
  health: { en: 'Health', nl: 'Gezondheid' },
  shield: { en: 'Shield', nl: 'Schild' },
  energy: { en: 'Energy', nl: 'Energie' },
  safe: { en: 'Safe zone', nl: 'Veilige zone' },
  safeSub: { en: 'No combat', nl: 'Geen gevechten' },
  entering: { en: 'Entering the safe zone', nl: 'Je betreedt de veilige zone' },
  leaving: { en: 'Leaving the safe zone', nl: 'Je verlaat de veilige zone' },
  leavingSub: { en: 'Weapons free — stay alert', nl: 'Wapens vrij — blijf alert' },
  holstered: { en: 'Holstered', nl: 'Weggestopt' },
  draw: { en: 'Draw weapon', nl: 'Wapen trekken' },
  reloading: { en: 'Reloading', nl: 'Herladen' },
  reload: { en: 'Reload', nl: 'Herladen' },
  empty: { en: 'Empty — reload', nl: 'Leeg — herladen' },
  noAmmo: { en: 'Out of ammo', nl: 'Geen munitie' },
  enemy: { en: 'Enemy', nl: 'Vijand' },
  grenades: { en: 'Grenades', nl: 'Granaten' },
  charge: { en: 'Charging', nl: 'Laden' },
  you: { en: 'You', nl: 'Jij' },
  killed: { en: 'eliminated', nl: 'uitgeschakeld' },
  switchW: { en: 'Switch weapon', nl: 'Wissel wapen' },
};

registerIcons({
  'cbt-health': '<path d="M9.5 4.5h5v5h5v5h-5v5h-5v-5h-5v-5h5z"/>',
  'cbt-shield': '<path d="M12 3.2 19 6v5.6c0 4.3-2.9 7.6-7 9.2-4.1-1.6-7-4.9-7-9.2V6Z"/>',
  'cbt-energy': '<path d="M13.2 3 6 13.4h5.3L10.6 21 18 10.4h-5.4Z"/>',
  'cbt-fire': '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  'cbt-aim': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/>',
  'cbt-switch': '<path d="M4 8.5h13.5M14 5l3.5 3.5L14 12"/><path d="M20 15.5H6.5M10 12l-3.5 3.5L10 19"/>',
  'cbt-grenade': '<circle cx="12" cy="14" r="6.2"/><path d="M9.5 7.4V5.2h5v2.2M14.5 5.2l3-1.7M6.2 12.4h11.6M6.2 15.6h11.6"/>',
  'cbt-dodge': '<path d="M5 17.5c1.5-6 6-9.5 12.5-9.5"/><path d="m14.5 5 3 3-3 3"/><circle cx="7.4" cy="19" r="1.6"/>',
  'cbt-reload': '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19.4 4.5v4.2h-4.2"/>',
  'cbt-skull': '<path d="M12 3.5c-4.4 0-7.5 3-7.5 7.2 0 2.6 1.2 4.4 3 5.5v3.3h9v-3.3c1.8-1.1 3-2.9 3-5.5 0-4.2-3.1-7.2-7.5-7.2Z"/><circle cx="9.2" cy="11" r="1.6"/><circle cx="14.8" cy="11" r="1.6"/><path d="M10.5 16.5h3"/>',
  'cbt-beacon': '<path d="M12 21V11"/><path d="M8.5 21h7"/><circle cx="12" cy="8" r="2.4"/><path d="M7.4 4.2a6.5 6.5 0 0 0 0 7.6M16.6 4.2a6.5 6.5 0 0 1 0 7.6"/>',
  'cbt-ridge': '<path d="M2.5 19.5 9 9l3.5 5 2.8-3.6 6.2 9.1Z"/><path d="M15.8 6.3h3.7M17.65 4.5v3.6"/>',
});

const ARC_SVG =
  '<svg viewBox="0 0 200 200" aria-hidden="true"><path d="M58 30 A86 86 0 0 1 142 30" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" opacity="0.9"/><path d="M93.5 17 L100 7 L106.5 17 Z" fill="currentColor"/></svg>';

export function createHud(ctx, { defs, getState, enemies }) {
  const { ui } = ctx;
  const h = ui.h;
  const camera = ctx.camera;
  const _v = new THREE.Vector3();
  let W = window.innerWidth;
  let H = window.innerHeight;
  window.addEventListener('resize', () => {
    W = window.innerWidth;
    H = window.innerHeight;
  });

  // ------------------------------------------------------------ vitals
  const bar = (cls) => {
    const fill = h('i', { class: 'cbt-bar-fill' });
    const lag = h('i', { class: 'cbt-bar-lag' });
    const el = h('div', { class: `cbt-bar ${cls}` }, lag, fill);
    return { el, fill, lag, v: -1, lv: 1 };
  };
  const hp = bar('cbt-bar-hp');
  const sh = bar('cbt-bar-sh');
  const en = { fill: h('i'), v: -1 };
  const hpNum = h('span', { class: 'cbt-vnum num', text: '100' });
  const shNum = h('span', { class: 'cbt-vnum num', text: '50' });
  const enNum = h('span', { class: 'cbt-enum num', text: '100' });
  const safeText = h('span', { class: 'cbt-safe-t', text: t(TXT.safe) });
  const safeSub = h('span', { class: 'cbt-safe-s', text: t(TXT.safeSub) });
  const safeChip = h('div', { class: 'cbt-safe', hidden: true }, h('span', { class: 'cbt-safe-ic', html: icon('cbt-shield', 14) }), safeText, safeSub);
  // phones: a compact, tappable weapon + ammo chip inside the vitals (the bottom-right slot sits under the
  // button cluster / resources panel there); a tap switches weapon (draws it when holstered)
  const vamIcon = h('span', { class: 'cbt-vam-ic' });
  const vamMag = h('span', { class: 'cbt-vam-mag num' });
  const vamRes = h('span', { class: 'cbt-vam-res num' });
  const vamGren = h('span', { class: 'cbt-vam-gnum num' });
  const vam = h(
    'button',
    { class: 'cbt-vam', type: 'button', 'aria-label': t(TXT.switchW), title: t(TXT.switchW) },
    vamIcon,
    h('span', { class: 'cbt-vam-count' }, vamMag, vamRes),
    h('span', { class: 'cbt-vam-gren' }, h('span', { html: icon('cbt-grenade', 13) }), vamGren),
  );
  let onSwitch = null;
  vam.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSwitch?.();
  });
  const vitals = h(
    'div',
    { class: 'cbt-vitals', role: 'group', 'aria-label': `${t(TXT.health)} / ${t(TXT.shield)}` },
    h(
      'div',
      { class: 'cbt-vrow' },
      h('div', { class: 'cbt-vital cbt-vital-hp', title: t(TXT.health) }, h('span', { class: 'cbt-vic', html: icon('cbt-health', 15) }), hpNum, hp.el),
      h('div', { class: 'cbt-vital cbt-vital-sh', title: t(TXT.shield) }, h('span', { class: 'cbt-vic', html: icon('cbt-shield', 15) }), shNum, sh.el),
      vam,
    ),
    h(
      'div',
      { class: 'cbt-erow', title: t(TXT.energy) },
      h('span', { class: 'cbt-elbl', text: t(TXT.energy) }),
      h('div', { class: 'cbt-ebar' }, en.fill),
      enNum,
    ),
    safeChip,
  );
  ui.addWidget('bottom-center', vitals, { modes: ['explore'], order: 20 });
  const vit = { hp: 100, sh: 50, en: 100, maxHp: 100, maxSh: 50, maxEn: 100 };

  function setBar(b, frac) {
    if (Math.abs(frac - b.v) < 0.002) return;
    if (frac < b.v) b.hitAt = performance.now();
    b.v = frac;
    b.fill.style.transform = `scaleX(${frac.toFixed(4)})`;
    // the red "lag" segment follows after a short delay (CSS transition) → damage trail
    b.lag.style.transform = `scaleX(${frac.toFixed(4)})`;
  }

  function setVitals(s = {}) {
    for (const k of ['hp', 'sh', 'en', 'maxHp', 'maxSh']) if (Number.isFinite(s[k])) vit[k] = s[k];
    const fh = clamp(vit.hp / Math.max(1, vit.maxHp), 0, 1);
    const fs = clamp(vit.sh / Math.max(1, vit.maxSh), 0, 1);
    const fe = clamp(vit.en / Math.max(1, vit.maxEn), 0, 1);
    setBar(hp, fh);
    setBar(sh, fs);
    const hpT = String(Math.max(0, Math.ceil(vit.hp)));
    if (hpNum.textContent !== hpT) hpNum.textContent = hpT;
    const shT = String(Math.max(0, Math.ceil(vit.sh)));
    if (shNum.textContent !== shT) shNum.textContent = shT;
    const enT = String(Math.max(0, Math.round(vit.en)));
    if (enNum.textContent !== enT) enNum.textContent = enT;
    if (Math.abs(fe - en.v) > 0.002) {
      en.v = fe;
      en.fill.style.transform = `scaleX(${fe.toFixed(4)})`;
    }
    vitals.classList.toggle('is-low', fh < 0.3);
    vitals.classList.toggle('is-starving', fe <= 0.001);
    vitals.classList.toggle('is-noshield', fs <= 0.001);
  }
  setVitals();

  // -------------------------------------------------------------- ammo
  const amName = h('div', { class: 'cbt-am-name' });
  const amIcon = h('div', { class: 'cbt-am-icon' });
  const amMag = h('span', { class: 'cbt-am-mag num' });
  const amRes = h('span', { class: 'cbt-am-res num' });
  const amGren = h('span', { class: 'cbt-am-gnum num' });
  const amHint = h('div', { class: 'cbt-am-hint' });
  const amReload = h('i');
  const slots = [];
  const slotRow = h('div', { class: 'cbt-am-slots' });
  for (let i = 0; i < 4; i++) {
    const d = defs.bySlot[i];
    const el = h('span', { class: 'cbt-am-slot', title: d ? t(d.name) : '' }, h('b', { text: String(i + 1) }));
    slots.push(el);
    slotRow.appendChild(el);
  }
  const ammo = h(
    'div',
    { class: 'cbt-ammo' },
    h('div', { class: 'cbt-am-top' }, amName, slotRow),
    h(
      'div',
      { class: 'cbt-am-row' },
      amIcon,
      h('span', { class: 'cbt-am-sep' }),
      h('div', { class: 'cbt-am-count' }, amMag, amRes),
      h('div', { class: 'cbt-am-gren', title: t(TXT.grenades) }, h('span', { html: icon('cbt-grenade', 18) }), amGren, h('span', { class: 'cbt-am-key', text: '4' })),
    ),
    h('div', { class: 'cbt-am-reload' }, amReload),
    amHint,
  );
  ui.addWidget('bottom-right', ammo, { modes: ['explore'], order: 5 });
  const am = { id: null, mag: null, res: null, gren: null, hint: null, reload: -1, owned: '', slot: -2, armed: null };

  // ---------------------------------------------------------- crosshair
  const xh = {};
  xh.lines = ['t', 'b', 'l', 'r'].map((k) => h('i', { class: `cbt-xh-line cbt-xh-${k}` }));
  xh.dot = h('i', { class: 'cbt-xh-dot' });
  xh.hit = h('div', { class: 'cbt-xh-hit' }, h('i'), h('i'), h('i'), h('i'));
  xh.ring = h('div', { class: 'cbt-xh-ring', html: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" pathLength="100"/></svg>' });
  xh.ringC = xh.ring.querySelector('circle');
  xh.deny = h('div', { class: 'cbt-deny' });
  xh.el = h('div', { class: 'cbt-xh' }, ...xh.lines, xh.dot, xh.ring, xh.hit);
  ui.addWidget('center', xh.el, { modes: ['explore'], order: 20 });
  xh.gap = -1;
  xh.charge = -1;
  xh.kind = '';
  xh.hitFlip = false;
  xh.denyT = 0;

  // ------------------------------------------------------ overlay layer
  const ov = h('div', { class: 'cbt-overlay', 'aria-hidden': 'true' });
  const vign = h('div', { class: 'cbt-vignette' });
  const lowEl = h('div', { class: 'cbt-lowhp' });
  const dirsEl = h('div', { class: 'cbt-dirs' });
  const numsEl = h('div', { class: 'cbt-nums' });
  const barsEl = h('div', { class: 'cbt-ebars' });
  const pingsEl = h('div', { class: 'cbt-pings' });
  ov.append(lowEl, vign, dirsEl, barsEl, pingsEl, numsEl, xh.deny);
  ui.layers.hud.appendChild(ov);

  const dirs = [];
  for (let i = 0; i < 4; i++) {
    const el = h('div', { class: 'cbt-dir', html: ARC_SVG });
    dirsEl.appendChild(el);
    dirs.push({ el, life: 0, x: 0, z: 0, shown: false });
  }
  const nums = [];
  for (let i = 0; i < 14; i++) {
    const el = h('div', { class: 'cbt-num num' });
    numsEl.appendChild(el);
    nums.push({ el, life: 0, max: 1, x: 0, y: 0, z: 0, ox: 0, shown: false });
  }
  let numNext = 0;
  const ebars = [];
  for (let i = 0; i < 8; i++) {
    const fill = h('i');
    const el = h('div', { class: 'cbt-ebar-w' }, h('div', { class: 'cbt-ebar-b' }, fill));
    barsEl.appendChild(el);
    ebars.push({ el, fill, shown: false, v: -1 });
  }
  const pings = [];
  for (let i = 0; i < 6; i++) {
    const el = h('div', { class: 'cbt-ping' }, h('span', { class: 'cbt-ping-t', text: t(TXT.enemy) }), h('i'));
    pingsEl.appendChild(el);
    pings.push({ el, shown: false });
  }

  // ---------------------------------------------------------- killfeed
  const feed = h('div', { class: 'cbt-feed', role: 'log', 'aria-live': 'polite' });
  ui.addWidget('right', feed, { modes: ['explore', 'drive'], order: 20 });
  const feedItems = [];

  // ---------------------------------------------- banner + boss bar (later)
  const bannerTitle = h('div', { class: 'cbt-banner-t' });
  const bannerSub = h('div', { class: 'cbt-banner-s' });
  const banner = h('div', { class: 'cbt-banner', hidden: true }, bannerTitle, h('i', { class: 'cbt-banner-line' }), bannerSub);
  const bossName = h('div', { class: 'cbt-boss-n' });
  const bossFill = h('i');
  const boss = h('div', { class: 'cbt-boss', hidden: true }, bossName, h('div', { class: 'cbt-boss-b' }, bossFill));
  ui.addWidget('top-center', banner, { modes: ['explore', 'drive'], order: 30 });
  ui.addWidget('top-center', boss, { modes: ['explore', 'drive'], order: 31 });
  // widget roots: the ui widget system owns `hidden` (mode filter) → toggle through ui.setVisible
  ui.setVisible(banner, false);
  ui.setVisible(boss, false);
  let bannerT = 0;
  let bannerOffT = 0;

  // ------------------------------------------------------------ effects
  let hurtA = 0;
  let lowPulse = 0;
  let heartT = 0;
  let lastVign = -1;
  let lastLow = -1;

  function hitMarker(kind = 'hit') {
    xh.hitFlip = !xh.hitFlip;
    xh.hit.className = `cbt-xh-hit is-${kind} ${xh.hitFlip ? 'pop-a' : 'pop-b'}`;
  }

  function damageNumber(pos, amount, kind = 'hit') {
    if (!pos || !Number.isFinite(amount)) return;
    const n = nums[numNext];
    numNext = (numNext + 1) % nums.length;
    n.x = pos.x ?? pos[0];
    n.y = (pos.y ?? pos[1]) + 0.25;
    n.z = pos.z ?? pos[2];
    n.ox = (Math.random() - 0.5) * 26;
    n.life = n.max = kind === 'kill' ? 1.25 : 0.95;
    n.el.textContent = String(Math.max(1, Math.round(amount)));
    n.el.className = `cbt-num num is-${kind}`;
    n.shown = true;
  }

  function hurt(amount = 10, from = null) {
    hurtA = Math.min(1, hurtA + 0.25 + amount / 40);
    if (from && Number.isFinite(from.x)) {
      // reuse the slot of the same source (within 3 m) or the oldest
      let best = dirs[0];
      for (const d of dirs) {
        if (d.life > 0 && Math.abs(d.x - from.x) < 3 && Math.abs(d.z - from.z) < 3) {
          best = d;
          break;
        }
        if (d.life < best.life) best = d;
      }
      best.x = from.x;
      best.z = from.z;
      best.life = 1.6;
    }
  }

  function deny(text) {
    xh.deny.textContent = typeof text === 'string' ? text : t(text);
    xh.denyT = 1.6;
    xh.deny.classList.add('show');
  }

  function killfeed(killer, weaponId, victim, { mine = false, meVictim = false, enemyKiller = false } = {}) {
    const row = h(
      'div',
      { class: `cbt-feed-row${mine ? ' is-mine' : ''}${meVictim ? ' is-me' : ''}` },
      h('span', { class: `cbt-feed-k${enemyKiller ? ' is-enemy' : ''}`, text: killer }),
      weaponId ? h('span', { class: 'cbt-feed-w', html: weaponIcon(weaponId) }) : h('span', { class: 'cbt-feed-x', html: icon('cbt-skull', 14) }),
      h('span', { class: `cbt-feed-v${enemyKiller ? '' : ' is-enemy'}`, text: victim }),
    );
    feed.prepend(row);
    feedItems.unshift({ el: row, life: 6 });
    while (feedItems.length > 5) feedItems.pop().el.remove();
  }

  function showBanner(title, sub = '', { kind = 'wave', duration = 4 } = {}) {
    bannerTitle.textContent = t(title);
    bannerSub.textContent = t(sub);
    banner.dataset.kind = kind;
    ui.setVisible(banner, true);
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    bannerT = duration;
  }

  function bossBar(name, frac) {
    if (name == null) {
      ui.setVisible(boss, false);
      return;
    }
    ui.setVisible(boss, true);
    bossName.textContent = t(name);
    bossFill.style.transform = `scaleX(${clamp(frac ?? 1, 0, 1).toFixed(4)})`;
  }

  let safeOn = false;
  let zoneT = 0;
  const smpZone = () => !!(ctx.smp && ctx.smp.zone && typeof ctx.smp.hud?.setZone === 'function');
  /** Safe-zone state (§11). `transition` = the player just crossed the border (not at boot). */
  function setSafe(on, transition = false) {
    on = !!on;
    if (on === safeOn && !transition) return;
    const changed = on !== safeOn;
    safeOn = on;
    vitals.classList.toggle('is-safe', on);
    ammo.classList.toggle('is-safe', on);
    // the smp module owns the zone chip + "Leaving the safe zone" toast when it is installed (no duplicate)
    if (smpZone()) {
      safeChip.hidden = true;
      zoneT = 0;
      return;
    }
    if (transition && changed) {
      safeChip.hidden = false;
      safeChip.classList.toggle('is-leaving', !on);
      safeChip.classList.toggle('is-entering', on);
      safeText.textContent = t(on ? TXT.entering : TXT.leaving);
      safeSub.textContent = on ? t(TXT.safeSub) : t(TXT.leavingSub);
      zoneT = 3.2;
      ctx.audio?.play?.(on ? 'ui.open' : 'combat.zone.leave', { volume: 0.6 });
    } else if (zoneT <= 0) safeChip.hidden = !on;
  }

  // ------------------------------------------------------------- update
  function project(x, y, z) {
    _v.set(x, y, z).project(camera);
    if (_v.z > 1 || _v.z < -1) return false;
    _v.x = (_v.x * 0.5 + 0.5) * W;
    _v.y = (-_v.y * 0.5 + 0.5) * H;
    return true;
  }

  function updateAmmo(st) {
    const def = st.def;
    const armed = !!st.armed;
    if (am.armed !== armed) {
      am.armed = armed;
      ammo.classList.toggle('is-armed', armed);
      vitals.classList.toggle('is-armed', armed);
    }
    const id = def?.id || null;
    if (id !== am.id) {
      am.id = id;
      amIcon.innerHTML = id ? weaponIcon(id) : '';
      vamIcon.innerHTML = amIcon.innerHTML;
      amName.textContent = def ? t(def.name) : '';
      ammo.dataset.kind = def?.kind || '';
      vam.dataset.kind = ammo.dataset.kind;
    }
    const ws = st.ws;
    let mag = '';
    let res = '';
    if (ws && def) {
      if (def.kind === 'throw') {
        mag = String(ws.reserve);
        res = `/ ${def.carry}`;
      } else {
        mag = String(ws.mag);
        res = `/ ${ws.reserve}`;
      }
    }
    if (mag !== am.mag) {
      am.mag = mag;
      amMag.textContent = mag;
      vamMag.textContent = mag;
      const empty = mag === '0';
      const low = !!def && def.kind !== 'throw' && Number(mag) > 0 && Number(mag) <= Math.ceil(def.mag * 0.25);
      ammo.classList.toggle('is-empty', empty);
      ammo.classList.toggle('is-lowmag', low);
      vam.classList.toggle('is-empty', empty);
      vam.classList.toggle('is-lowmag', low);
    }
    if (res !== am.res) {
      am.res = res;
      amRes.textContent = res;
      vamRes.textContent = res;
    }
    const g = String(st.grenades ?? 0);
    if (g !== am.gren) {
      am.gren = g;
      amGren.textContent = g;
      vamGren.textContent = g;
      ammo.classList.toggle('no-gren', g === '0');
      vam.classList.toggle('no-gren', g === '0');
    }
    const owned = st.ownedKey || '';
    if (owned !== am.owned || st.slot !== am.slot) {
      am.owned = owned;
      am.slot = st.slot;
      for (let i = 0; i < 4; i++) {
        const d = defs.bySlot[i];
        slots[i].classList.toggle('is-owned', !!d && st.owned?.has(d.id));
        slots[i].classList.toggle('is-active', armed && st.slot === i);
      }
    }
    let hint = '';
    if (st.safe) hint = t(TXT.safe);
    else if (!armed) hint = `[1–4]  ${t(TXT.draw)}`;
    else if (ws?.reloading) hint = t(TXT.reloading);
    else if (def && def.kind !== 'throw' && ws && ws.mag === 0) hint = ws.reserve > 0 ? `[R]  ${t(TXT.empty)}` : t(TXT.noAmmo);
    if (hint !== am.hint) {
      am.hint = hint;
      amHint.textContent = hint;
      amHint.hidden = !hint;
    }
    const rp = ws?.reloading ? ws.reloadProgress : -1;
    if (Math.abs(rp - am.reload) > 0.01) {
      am.reload = rp;
      ammo.classList.toggle('is-reloading', rp >= 0);
      vam.classList.toggle('is-reloading', rp >= 0);
      amReload.style.transform = `scaleX(${Math.max(0, rp).toFixed(3)})`;
    }
  }

  function updateCrosshair(st, dt) {
    const show = !!st.armed && !st.dead && !ctx.build?.active;
    if (xh.el.dataset.hidden === (show ? 'true' : 'false') || xh.el.dataset.hidden == null) ui.setVisible(xh.el, show);
    if (!show) return;
    const kind = st.def?.kind || '';
    if (kind !== xh.kind) {
      xh.kind = kind;
      xh.el.dataset.kind = kind;
    }
    const fov = (camera.fov * Math.PI) / 180;
    const sp = (Math.tan(((st.spread || 0) * Math.PI) / 180) / Math.tan(fov / 2)) * (H / 2);
    const gap = Math.round(clamp(sp + 5, 5, 90));
    if (gap !== xh.gap) {
      xh.gap = gap;
      xh.el.style.setProperty('--gap', `${gap}px`);
    }
    const ch = kind === 'charge' ? st.charge || 0 : 0;
    if (Math.abs(ch - xh.charge) > 0.01) {
      xh.charge = ch;
      xh.ringC.style.strokeDashoffset = String(100 - ch * 100);
      xh.ring.classList.toggle('show', ch > 0.01);
      xh.ring.classList.toggle('full', ch >= 0.999);
    }
  }

  function updateOverlay(st, dt) {
    const show = ctx.modes.is('explore') && !ui.isModalOpen('cbt-death');
    if (ov.hidden === show) ov.hidden = !show;
    if (!show) return;
    // vignette + low health
    hurtA = Math.max(0, hurtA - dt * 1.4);
    if (Math.abs(hurtA - lastVign) > 0.01) {
      lastVign = hurtA;
      vign.style.opacity = hurtA.toFixed(3);
    }
    const fh = vit.hp / Math.max(1, vit.maxHp);
    const low = st.dead ? 0 : clamp((0.32 - fh) / 0.32, 0, 1);
    let lowA = 0;
    if (low > 0) {
      const rate = 1.1 + low * 0.9;
      lowPulse += dt * rate;
      const ph = lowPulse % 1;
      const beat = Math.exp(-ph * 9) + Math.exp(-Math.max(0, ph - 0.22) * 9) * 0.7 * (ph > 0.22 ? 1 : 0);
      lowA = clamp(0.35 + low * 0.35 + beat * 0.3 * low, 0, 1);
      heartT -= dt;
      if (heartT <= 0) {
        heartT = 1 / rate;
        ctx.audio?.play?.('combat.heartbeat', { volume: 0.35 + low * 0.5, intensity: 0.6 + low * 0.4 });
      }
    } else heartT = 0;
    if (Math.abs(lowA - lastLow) > 0.01) {
      lastLow = lowA;
      lowEl.style.opacity = lowA.toFixed(3);
    }
    // direction indicators (relative to the camera yaw, follow turning)
    const pp = ctx.player?.position;
    const yaw = ctx.cameraRig?.yaw ?? 0;
    for (const d of dirs) {
      if (d.life <= 0) {
        if (d.shown) {
          d.shown = false;
          d.el.style.opacity = '0';
        }
        continue;
      }
      d.life -= dt;
      const a = pp ? damageAngle(yaw, pp.x, pp.z, d.x, d.z) : 0;
      d.shown = true;
      d.el.style.opacity = (clamp(d.life / 0.8, 0, 1) * 0.85).toFixed(3);
      d.el.style.transform = `translate(-50%, -50%) rotate(${a.toFixed(3)}rad)`;
    }
    // damage numbers
    for (const n of nums) {
      if (!n.shown) continue;
      n.life -= dt;
      if (n.life <= 0 || !project(n.x, n.y + (1 - n.life / n.max) * 0.9, n.z)) {
        n.shown = n.life > 0;
        n.el.style.opacity = '0';
        continue;
      }
      const k = n.life / n.max;
      const pop = k > 0.85 ? 1 + (k - 0.85) * 2.4 : 1;
      n.el.style.opacity = clamp(k * 2.2, 0, 1).toFixed(3);
      n.el.style.transform = `translate3d(${(_v.x + n.ox).toFixed(1)}px, ${_v.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
    }
    // enemy health bars + pings
    let nb = 0;
    let np = 0;
    if (enemies) {
      const now = ctx.loop.time;
      enemies.records.forEach((rec) => {
        if (rec.dead || rec.gone || !rec.visible || rec.markerY == null) return;
        const damaged = rec.hp < rec.maxHp - 0.01 && rec.dist < 75 && now - rec.lastHit < 10;
        const ping = rec.targetsMe > 0 && rec.dist < 120;
        if (!damaged && !ping) return;
        if (!project(rec.pos.x, rec.markerY, rec.pos.z)) return;
        if (damaged && nb < ebars.length) {
          const b = ebars[nb++];
          if (!b.shown) {
            b.shown = true;
            b.el.style.opacity = '1';
          }
          const f = hpFrac(rec.hp, rec.maxHp);
          if (Math.abs(f - b.v) > 0.004) {
            b.v = f;
            b.fill.style.transform = `scaleX(${f.toFixed(3)})`;
          }
          b.el.style.transform = `translate3d(${_v.x.toFixed(1)}px, ${_v.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
        }
        if (ping && np < pings.length) {
          const p = pings[np++];
          if (!p.shown) {
            p.shown = true;
            p.el.style.opacity = '1';
          }
          p.el.style.transform = `translate3d(${_v.x.toFixed(1)}px, ${(_v.y - (damaged ? 16 : 4)).toFixed(1)}px, 0) translate(-50%, -100%)`;
        }
      });
    }
    for (let i = nb; i < ebars.length; i++) {
      if (ebars[i].shown) {
        ebars[i].shown = false;
        ebars[i].el.style.opacity = '0';
      }
    }
    for (let i = np; i < pings.length; i++) {
      if (pings[i].shown) {
        pings[i].shown = false;
        pings[i].el.style.opacity = '0';
      }
    }
  }

  function update(dt) {
    const st = getState();
    if (xh.denyT > 0) {
      xh.denyT -= dt;
      if (xh.denyT <= 0) xh.deny.classList.remove('show');
    }
    if (zoneT > 0) {
      zoneT -= dt;
      if (zoneT <= 0) {
        safeChip.classList.remove('is-leaving', 'is-entering');
        safeText.textContent = t(TXT.safe);
        safeSub.textContent = t(TXT.safeSub);
        safeChip.hidden = !safeOn || smpZone();
      }
    }
    updateAmmo(st);
    updateCrosshair(st, dt);
    updateOverlay(st, dt);
    vitals.classList.toggle('is-compact', !!ctx.build?.active);
    ammo.classList.toggle('is-building', !!ctx.build?.active);

    // killfeed fade
    for (let i = feedItems.length - 1; i >= 0; i--) {
      const it = feedItems[i];
      it.life -= dt;
      if (it.life <= 0) {
        it.el.remove();
        feedItems.splice(i, 1);
      } else if (it.life < 0.8 && !it.fading) {
        it.fading = true;
        it.el.classList.add('fade');
      }
    }
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) {
        banner.classList.remove('show');
        bannerOffT = 0.5; // after the fade: out of the top-center slot again
      }
    } else if (bannerOffT > 0) {
      bannerOffT -= dt;
      if (bannerOffT <= 0) ui.setVisible(banner, false);
    }
  }

  return {
    update,
    setVitals,
    vitals: vit,
    hitMarker,
    damageNumber,
    hurt,
    deny,
    killfeed,
    banner: showBanner,
    bossBar,
    setSafe,
    /** Tap on the phone weapon chip (index.js wires it to the controller's switch / draw). */
    set onSwitch(fn) {
      onSwitch = typeof fn === 'function' ? fn : null;
    },
    els: { vitals, ammo, crosshair: xh.el, overlay: ov, feed, weaponChip: vam },
  };
}
