/**
 * Travel (PLATFORM.md §11.2 "Spreading players out") — the client side of C.TRAVEL / S.TRAVEL:
 *   - hub Gateway (only inside the safe zone, instant): 'wild' (random safe spot 2–8 km out),
 *     'base' (next to your claim beacon), 'beacon' (your spawn beacon);
 *   - "Return to hub" from anywhere outside it: a 10 s channel (moving > 4 m, firing or taking
 *     damage cancels), not in combat, 2 min cooldown — the server decides, this shows it:
 *     a channel bar above the vitals (bottom-center) with a countdown and Cancel.
 * Without a game server (fallback net) "Return to hub" simply fast-travels to the Overlook.
 * The physical hub Gateway (src/gateway: the Ø ring behind the Overlook, E menu, U = Return to hub)
 * toasts the server's travel results itself; while it is installed this module only adds the
 * channel bar and the map buttons (no duplicate toasts).
 *
 *   options() → travelOptions(...) (logic.js)   go(to) → bool (sent)   cancel()   channel   reasonText(r, wait)
 * Events: `shell:travel` { phase: 'sent' | 'channel' | 'cancel' | 'done' | 'deny', to, reason? }.
 */
import { t } from '../core/i18n.js';
import { icon } from '../ui/icons.js';
import { REASONS } from '../../shared/defs/reasons.js';
import { travelOptions, formatWait } from './logic.js';
import { uiSound } from './util.js';

const COMBAT_LOCK = 8; // s (TRAVEL_RULES.combatLock)
const HUB_COOLDOWN = 120; // s (TRAVEL_RULES.hubCooldown)
const TXT = {
  channel: { en: 'Returning to the hub', nl: 'Terug naar de hub' },
  channelSub: { en: 'Stand still · moving, firing or taking damage cancels', nl: 'Blijf staan · bewegen, schieten of schade breekt af' },
  cancel: { en: 'Cancel', nl: 'Annuleren' },
  cancelled: { en: 'Return to hub cancelled', nl: 'Terugkeer naar de hub afgebroken' },
  why: {
    moved: { en: 'You moved.', nl: 'Je bewoog.' },
    combat: { en: 'You are in combat.', nl: 'Je bent in gevecht.' },
    dead: { en: 'You were defeated.', nl: 'Je bent uitgeschakeld.' },
    player: { en: 'Cancelled.', nl: 'Afgebroken.' },
  },
  denied: { en: 'Can’t travel', nl: 'Reizen lukt niet' },
  arrivedWild: { en: 'The wilderness', nl: 'De wildernis' },
  arrivedWildSub: { en: 'Enemies roam out here — stay sharp', nl: 'Hier zwerven vijanden — blijf alert' },
  wait: { en: 'Ready in {t}', nl: 'Klaar over {t}' },
  // shell-only reasons
  planet: { en: 'Only on the planet', nl: 'Alleen op de planeet' },
  offline: { en: 'Needs the game server', nl: 'Werkt alleen met de spelserver' },
  leaveWild: { en: 'Return to the hub first', nl: 'Keer eerst terug naar de hub' },
};

export function createTravel(ctx, { wild, shell }) {
  const { events, ui } = ctx;
  const h = ui.h;
  /** The Gateway module already toasts S.TRAVEL / travel denies. */
  const gatewayToasts = () => typeof ctx.gateway?.open === 'function';
  const now = () => performance.now() / 1000;
  let channel = null; // { to, until, secs }
  let cooldownUntil = 0;
  let combatUntil = 0;

  // ------------------------------------------------------------- widget
  const fill = h('i', { class: 'shell-travel-fill' });
  const secsEl = h('span', { class: 'shell-travel-secs num' });
  const el = h(
    'div',
    { class: 'shell-travel', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'shell-travel-icon', html: icon('shell-hub', 20) }),
    h(
      'div',
      { class: 'shell-travel-body' },
      h('div', { class: 'shell-travel-row' }, h('span', { class: 'shell-travel-title', text: t(TXT.channel) }), secsEl),
      h('div', { class: 'shell-travel-bar' }, fill),
      h('div', { class: 'shell-travel-sub', text: t(TXT.channelSub) }),
    ),
    h('button', { class: 'shell-travel-cancel', type: 'button', text: t(TXT.cancel), onclick: () => cancel() }),
  );
  ui.addWidget('bottom-center', el, { modes: ['explore', 'drive'], order: 25 });
  ui.setVisible(el, false);

  function showChannel(on) {
    ui.setVisible(el, on);
    el.classList.toggle('is-on', on);
  }

  // ------------------------------------------------------------- state
  const net = () => ctx.net;
  const netMode = () => {
    const n = net();
    if (!n || typeof n.travel !== 'function' || n.mode === 'off') return 'off';
    return n.mode === 'online' || n.mode === 'local' ? n.mode : n.online ? 'online' : n.mode || 'off';
  };

  function snapshot() {
    const p = shell.frame.focus;
    return {
      net: netMode(),
      mode: ctx.modes.name,
      inHub: wild.inHub(p.x, p.z),
      dead: !!ctx.combat?.dead,
      hasClaim: !!wild.myClaim(),
      hasBeacon: !!(ctx.smp?.hasBeacon?.() || wild.beacon()),
      channel: !!channel,
      now: now(),
      cooldownUntil,
      combatUntil,
    };
  }
  const options = () => travelOptions(snapshot());

  function reasonText(reason, wait = 0) {
    const base = TXT[reason] || REASONS[reason] || { en: 'Not possible right now', nl: 'Nu niet mogelijk' };
    const s = t(base);
    return wait > 0 ? `${s} · ${t(TXT.wait, { t: formatWait(wait) })}` : s;
  }

  function deny(reason, wait, fromServer = false) {
    uiSound(ctx, 'ui.error');
    events.emit('shell:travel', { phase: 'deny', reason });
    if (fromServer && gatewayToasts()) return;
    ui.toast({ title: t(TXT.denied), text: reasonText(reason, wait), icon: 'shell-gateway', kind: 'warn', duration: 3600 });
  }

  /** Starts a trip: 'wild' | 'base' | 'beacon' (Gateway) or 'hub' (Return to hub). */
  function go(to) {
    const o = options();
    const opt = to === 'hub' ? o.hub : o.gateway[to];
    if (!opt) return false;
    if (!opt.ok) {
      deny(opt.reason, opt.wait);
      return false;
    }
    if (netMode() === 'off') {
      // single-player fallback: no server rules, just take the player home
      if (to === 'hub') shell.fastTravel?.('spawn');
      return true;
    }
    uiSound(ctx, 'ui.click');
    net().travel(to);
    events.emit('shell:travel', { phase: 'sent', to });
    return true;
  }

  function cancel() {
    if (!channel) return;
    if (netMode() !== 'off') net().travel('cancel');
  }

  // ------------------------------------------------------------- server
  events.on('net:travel', (m) => {
    if (!m) return;
    if (m.phase === 'channel') {
      let secs = Number(m.secs) || 10;
      const st = net()?.serverTime?.();
      if (Number.isFinite(m.at) && Number.isFinite(st)) secs = Math.max(0.5, Math.min(secs + 1, (m.at - st) / 1000));
      channel = { to: m.to, until: now() + secs, secs: Number(m.secs) || secs };
      showChannel(true);
      uiSound(ctx, 'ui.open');
    } else if (m.phase === 'cancel') {
      channel = null;
      showChannel(false);
      const why = TXT.why[m.reason];
      if (!gatewayToasts()) ui.toast({ title: t(TXT.cancelled), text: why ? t(why) : '', icon: 'shell-hub', kind: 'warn', duration: 3200 });
    } else if (m.phase === 'done') {
      const was = channel?.to || m.to;
      channel = null;
      showChannel(false);
      if (was === 'hub' || m.to === 'hub') cooldownUntil = now() + HUB_COOLDOWN;
      if (m.to === 'wild' && !gatewayToasts()) setTimeout(() => shell.zoneLabel?.show(TXT.arrivedWild, { iconName: 'shell-shuffle', sub: TXT.arrivedWildSub }), 600);
    }
    events.emit('shell:travel', { phase: m.phase, to: m.to, reason: m.reason });
  });
  events.on('net:deny', (m) => {
    if (m?.of !== 'travel') return;
    const wait = Number(m.wait) || 0;
    if (m.reason === 'cooldown') cooldownUntil = now() + wait;
    if (m.reason === 'combat') combatUntil = now() + wait;
    deny(m.reason, wait, true);
  });
  // combat lock (the server is stricter; this only greys the button out early)
  events.on('combat:fire', () => (combatUntil = now() + COMBAT_LOCK));
  events.on('net:damage', (m) => {
    const me = net()?.id;
    if (m && me != null && m.target === me) combatUntil = now() + COMBAT_LOCK;
  });
  events.on('net:respawned', () => {
    channel = null;
    showChannel(false);
  });

  // ------------------------------------------------------------- frame
  let lastSecs = -1;
  function update() {
    if (!channel) return;
    const left = channel.until - now();
    const k = 1 - Math.max(0, left) / Math.max(0.1, channel.secs);
    fill.style.transform = `scaleX(${Math.min(1, Math.max(0, k)).toFixed(3)})`;
    const s = Math.max(0, Math.ceil(left));
    if (s !== lastSecs) {
      lastSecs = s;
      secsEl.textContent = `${s} s`;
    }
    // the server's 'done' is late (or lost): don't leave the bar up forever
    if (left < -6) {
      channel = null;
      showChannel(false);
    }
  }

  return {
    options,
    go,
    cancel,
    update,
    reasonText,
    get channel() {
      return channel;
    },
    get cooldownLeft() {
      return Math.max(0, cooldownUntil - now());
    },
  };
}
