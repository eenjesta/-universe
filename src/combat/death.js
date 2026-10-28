/**
 * Death & respawn screen: "You died" / "Je bent gestorven", the cause, a 5 s
 * countdown ring and the respawn choices → C.RESPAWN {at}: smp's list when it
 * exists (ctx.smp.respawnOptions() → [{at, title, sub, ok, icon}], bed first), else
 * Spawn beacon / Base / Overlook. Opened as a blocking modal (input off, pointer
 * released, touch controls hidden); keys 1–4 pick an option once the countdown is done.
 *
 *   const death = createDeath(ctx, { onRespawn(at) })
 *   death.show({ cause, killer, drop, delay })   death.hide()   death.open
 */
import { t } from '../core/i18n.js';
import { icon } from '../ui/icons.js';

const TXT = {
  kicker: { en: 'Signal lost', nl: 'Signaal verloren' },
  title: { en: 'You died', nl: 'Je bent gestorven' },
  by: { en: 'Killed by {name}', nl: 'Gedood door {name}' },
  starve: { en: 'You ran out of energy', nl: 'Je energie raakte op' },
  fall: { en: 'You fell too far', nl: 'Je viel te diep' },
  unknown: { en: 'Your suit failed', nl: 'Je pak hield het niet' },
  drop: {
    en: 'You dropped 30 % of your resources — only you can open the crate for 10 minutes.',
    nl: 'Je liet 30 % van je grondstoffen vallen — alleen jij kunt de kist 10 minuten openen.',
  },
  respawnIn: { en: 'Respawn in', nl: 'Respawn over' },
  ready: { en: 'Choose a spawn point', nl: 'Kies een spawnpunt' },
  waiting: { en: 'Respawning…', nl: 'Respawnen…' },
  beacon: { en: 'Spawn beacon', nl: 'Spawnbaken' },
  beaconSub: { en: 'Your placed beacon', nl: 'Je geplaatste baken' },
  noBeacon: { en: 'No beacon placed', nl: 'Geen baken geplaatst' },
  base: { en: 'Base', nl: 'Basis' },
  baseSub: { en: 'Your claimed base', nl: 'Je geclaimde basis' },
  noBase: { en: 'No base claimed yet', nl: 'Nog geen basis geclaimd' },
  spawn: { en: 'Overlook', nl: 'Uitzichtpunt' },
  spawnSub: { en: 'Safe ridge in the hub', nl: 'Veilige richel in de hub' },
};

/** smp's respawn choices (bed / beacon / base / spawn) when the module provides them, else null. */
function smpOptions(ctx) {
  try {
    const list = ctx.smp?.respawnOptions?.();
    if (!Array.isArray(list) || !list.length) return null;
    const out = [];
    for (const o of list) {
      if (!o || typeof o.at !== 'string' || !o.title) continue;
      out.push({ at: o.at, icon: typeof o.icon === 'string' ? o.icon : 'cbt-ridge', title: o.title, sub: o.sub || '', ok: o.ok !== false });
    }
    return out.length ? out.slice(0, 4) : null;
  } catch {
    return null;
  }
}

export function createDeath(ctx, { onRespawn, hasBeacon = () => true, hasBase = () => true }) {
  const { ui } = ctx;
  const h = ui.h;
  let open = false;
  let remaining = 0;
  let total = 5;
  let waiting = false;
  let waitT = 0;
  let el = null;
  let numEl = null;
  let lblEl = null;
  let ringEl = null;
  let btns = [];
  let keyOff = null;

  const DEFAULT_OPTS = [
    { at: 'beacon', icon: 'cbt-beacon', title: TXT.beacon, sub: TXT.beaconSub },
    { at: 'base', icon: 'home', title: TXT.base, sub: TXT.baseSub },
    { at: 'spawn', icon: 'cbt-ridge', title: TXT.spawn, sub: TXT.spawnSub },
  ];
  let OPTS = DEFAULT_OPTS;

  function choose(at) {
    if (!open || remaining > 0 || waiting) return;
    const b = btns.find((x) => x.at === at);
    if (!b || b.el.disabled) return;
    waiting = true;
    waitT = 6;
    el.classList.add('is-waiting');
    lblEl.textContent = t(TXT.waiting);
    for (const x of btns) x.el.disabled = true;
    ctx.audio?.play?.('ui.click');
    try {
      onRespawn?.(at);
    } catch (err) {
      console.error('[combat] respawn failed', err);
    }
  }

  function show({ cause = null, killer = null, drop = false, delay = 5 } = {}) {
    if (open) hide(true);
    total = Math.max(0.5, delay);
    remaining = total;
    waiting = false;
    let causeText = t(TXT.unknown);
    if (killer) causeText = t(TXT.by, { name: killer });
    else if (cause === 'starve' || cause === 'energy') causeText = t(TXT.starve);
    else if (cause === 'fall') causeText = t(TXT.fall);
    numEl = h('div', { class: 'cbt-death-num num', text: String(Math.ceil(remaining)) });
    lblEl = h('div', { class: 'cbt-death-lbl', text: t(TXT.respawnIn) });
    const svg = '<svg viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="20" pathLength="100"/><circle class="fg" cx="22" cy="22" r="20" pathLength="100" style="stroke-dashoffset:0"/></svg>';
    const count = h('div', { class: 'cbt-death-count', html: svg }, numEl);
    ringEl = count.querySelector('.fg');
    const fromSmp = smpOptions(ctx);
    OPTS = fromSmp || DEFAULT_OPTS;
    const beaconOk = !!hasBeacon();
    const baseOk = !!hasBase();
    btns = OPTS.map((o, i) => {
      const disabled = fromSmp ? !o.ok : (o.at === 'beacon' && !beaconOk) || (o.at === 'base' && !baseOk);
      const sub = fromSmp ? o.sub : disabled ? (o.at === 'base' ? TXT.noBase : TXT.noBeacon) : o.sub;
      const b = h(
        'button',
        { class: 'cbt-death-opt', type: 'button', disabled: true, dataset: { at: o.at }, onclick: () => choose(o.at) },
        h('span', { class: 'ic', html: icon(o.icon, 26) }),
        h('span', { class: 't', text: t(o.title) }),
        h('span', { class: 's', text: sub ? t(sub) : '' }),
        h('span', { class: 'k', text: String(i + 1) }),
      );
      return { at: o.at, el: b, never: disabled };
    });
    el = h(
      'div',
      { class: 'cbt-death panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t(TXT.title) },
      h('div', { class: 'cbt-death-kicker', text: t(TXT.kicker) }),
      h('div', { class: 'cbt-death-title', text: t(TXT.title) }),
      h('div', { class: 'cbt-death-cause', text: causeText }),
      drop ? h('div', { class: 'cbt-death-drop', text: t(TXT.drop) }) : null,
      count,
      lblEl,
      h('div', { class: 'cbt-death-opts', dataset: { n: String(btns.length) } }, btns.map((b) => b.el)),
    );
    ui.openModal('cbt-death', el, { closeOnEsc: false, closeOnBackdrop: false, className: 'cbt-death-wrap' });
    open = true;
    const onKey = (e) => {
      if (!open) return;
      const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
      const o = m ? OPTS[Number(m[1]) - 1] : null;
      if (o) choose(o.at);
    };
    window.addEventListener('keydown', onKey);
    keyOff = () => window.removeEventListener('keydown', onKey);
  }

  function update(dt) {
    if (!open) return;
    if (remaining > 0) {
      remaining = Math.max(0, remaining - dt);
      const n = String(Math.ceil(remaining));
      if (numEl.textContent !== n) numEl.textContent = remaining > 0 ? n : '';
      ringEl.style.strokeDashoffset = String(((total - remaining) / total) * 100);
      if (remaining <= 0) {
        lblEl.textContent = t(TXT.ready);
        numEl.innerHTML = icon('check', 26);
        for (const b of btns) b.el.disabled = b.never;
        const first = btns.find((b) => !b.el.disabled);
        if (first && !ctx.device?.touch) first.el.focus({ preventScroll: true });
      }
    } else if (waiting) {
      waitT -= dt;
      if (waitT <= 0) {
        // no answer from the server: let the player try again
        waiting = false;
        el.classList.remove('is-waiting');
        lblEl.textContent = t(TXT.ready);
        for (const b of btns) b.el.disabled = b.never;
      }
    }
  }

  /** The server refused the respawn (e.g. no beacon): pick again. */
  function denied(text) {
    if (!open) return;
    waiting = false;
    waitT = 0;
    el.classList.remove('is-waiting');
    lblEl.textContent = text ? (typeof text === 'string' ? text : t(text)) : t(TXT.ready);
    for (const b of btns) b.el.disabled = b.never;
  }

  function hide(silent = false) {
    if (!open) return;
    open = false;
    keyOff?.();
    keyOff = null;
    ui.closeModal('cbt-death', { silent });
  }

  return {
    show,
    hide,
    update,
    choose,
    denied,
    get open() {
      return open;
    },
    get remaining() {
      return remaining;
    },
  };
}
