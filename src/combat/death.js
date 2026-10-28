/**
 * Death & respawn screen: "You died" / "Je bent gestorven", the cause, a 5 s
 * countdown ring and three respawn choices (Spawn beacon / Base / Overlook →
 * C.RESPAWN {at}). Opened as a blocking modal (input off, pointer released,
 * touch controls hidden); keys 1–3 pick an option once the countdown is done.
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

  const OPTS = [
    { at: 'beacon', icon: 'cbt-beacon', title: TXT.beacon, sub: TXT.beaconSub },
    { at: 'base', icon: 'home', title: TXT.base, sub: TXT.baseSub },
    { at: 'spawn', icon: 'cbt-ridge', title: TXT.spawn, sub: TXT.spawnSub },
  ];

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
    const beaconOk = !!hasBeacon();
    const baseOk = !!hasBase();
    btns = OPTS.map((o, i) => {
      const disabled = (o.at === 'beacon' && !beaconOk) || (o.at === 'base' && !baseOk);
      const b = h(
        'button',
        { class: 'cbt-death-opt', type: 'button', disabled: true, dataset: { at: o.at }, onclick: () => choose(o.at) },
        h('span', { class: 'ic', html: icon(o.icon, 26) }),
        h('span', { class: 't', text: t(o.title) }),
        h('span', { class: 's', text: t(disabled ? (o.at === 'base' ? TXT.noBase : TXT.noBeacon) : o.sub) }),
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
      h('div', { class: 'cbt-death-opts' }, btns.map((b) => b.el)),
    );
    ui.openModal('cbt-death', el, { closeOnEsc: false, closeOnBackdrop: false, className: 'cbt-death-wrap' });
    open = true;
    const onKey = (e) => {
      if (!open) return;
      const i = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code) % 3;
      if (i >= 0 && e.code.match(/[123]$/)) choose(OPTS[i].at);
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
