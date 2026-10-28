/**
 * Presence UI (own widgets, `.net-` classes in net.css):
 *  - connection status "● Online · N players" / "● Offline" / "● Connecting…" /
 *    "● Reconnecting…" (top-right, below the resources panel; click → player list)
 *  - player list while holding Tab (explore / drive, not while building); the same list as a
 *    modal from the status widget or the touch menu ("Players")
 *  - toasts: join / leave (throttled), connection lost / back online, offline mode
 */
import { t } from '../core/i18n.js';
import { registerIcons } from '../ui/icons.js';

registerIcons({
  'net-players': '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.4 2.8-5.4 5.5-5.4s4.9 2 5.5 5.4"/><circle cx="16.8" cy="9.6" r="2.5"/><path d="M15.6 14.4c2.6-.3 4.5 1.4 5 4.6"/>',
  'net-signal': '<path d="M4.5 18.5h2v-3h-2zM9.5 18.5h2v-6h-2zM14.5 18.5h2v-9h-2zM19.5 18.5h.01"/><path d="M19.5 18.5v-12" opacity=".45"/>',
});

const TXT = {
  online: { en: 'Online', nl: 'Online' },
  offline: { en: 'Offline', nl: 'Offline' },
  connecting: { en: 'Connecting…', nl: 'Verbinden…' },
  reconnecting: { en: 'Reconnecting…', nl: 'Opnieuw verbinden…' },
  players1: { en: '1 player', nl: '1 speler' },
  playersN: { en: '{n} players', nl: '{n} spelers' },
  title: { en: 'Players', nl: 'Spelers' },
  you: { en: 'you', nl: 'jij' },
  far: { en: 'far away', nl: 'ver weg' },
  local: { en: 'Single player — this world is saved on this device.', nl: 'Singleplayer — deze wereld wordt op dit apparaat bewaard.' },
  alone: { en: 'Nobody else is here yet. Invite your friends!', nl: 'Er is nog niemand anders. Nodig je vrienden uit!' },
  hold: { en: 'Hold Tab', nl: 'Houd Tab ingedrukt' },
  ping: { en: 'Ping {ms} ms', nl: 'Ping {ms} ms' },
  joined: { en: '{name} joined', nl: '{name} is binnengekomen' },
  left: { en: '{name} left', nl: '{name} is vertrokken' },
  joinedMany: { en: '{n} players joined', nl: '{n} spelers binnengekomen' },
  lost: { en: 'Connection lost', nl: 'Verbinding verbroken' },
  lostText: { en: 'Reconnecting… you can keep exploring.', nl: 'Opnieuw verbinden… je kunt gewoon verder verkennen.' },
  back: { en: 'Back online', nl: 'Weer online' },
  offlineTitle: { en: 'Offline mode', nl: 'Offline modus' },
  offlineText: { en: 'No server reachable — playing single player. Progress is saved on this device.', nl: 'Geen server bereikbaar — je speelt singleplayer. Voortgang wordt op dit apparaat bewaard.' },
  replaced: { en: 'You joined from another tab or device.', nl: 'Je bent vanaf een ander tabblad of apparaat binnengekomen.' },
  full: { en: 'The world is full — playing offline for now.', nl: 'De wereld is vol — je speelt nu offline.' },
  version: { en: 'The game was updated — reload the page to play online.', nl: 'De game is bijgewerkt — herlaad de pagina om online te spelen.' },
  reconnect: { en: 'Reconnect', nl: 'Opnieuw verbinden' },
  goOnline: { en: 'Try online', nl: 'Online proberen' },
  modes: {
    foot: { en: 'on foot', nl: 'te voet' },
    swim: { en: 'swimming', nl: 'zwemt' },
    build: { en: 'building', nl: 'bouwt' },
    car: { en: 'driving', nl: 'rijdt' },
    vtol: { en: 'flying', nl: 'vliegt' },
    ship: { en: 'flying', nl: 'vliegt' },
    space: { en: 'in space', nl: 'in de ruimte' },
    dead: { en: 'down', nl: 'uitgeschakeld' },
  },
};
const MODE_ICON = { foot: 'user', swim: 'wind', build: 'cube', car: 'car', vtol: 'plane', ship: 'ship', space: 'rocket', dead: 'close' };

export function createNetUi(ctx, net) {
  const { ui, loop, input, modes, events } = ctx;
  const h = ui.h;

  // ------------------------------------------------------------ status widget
  const dot = h('span', { class: 'net-dot' });
  const label = h('span', { class: 'net-label' });
  const statusEl = h(
    'button',
    { class: 'net-status panel', type: 'button', dataset: { state: 'connecting' }, title: t(TXT.title), onclick: () => openList() },
    dot,
    label,
  );
  ui.addWidget('top-right', statusEl, { modes: ['explore', 'drive', 'space'], order: 15 });

  let lastMode = '';
  let lastCount = -1;
  let lastRe = null;
  let lastPing = -1;
  let statusAcc = 1;
  /** Cheap per-frame check; the label is rebuilt only when what it shows changed. */
  function refreshStatus(dt = 1) {
    statusAcc += dt;
    if (statusAcc < 0.25) return;
    statusAcc = 0;
    const st = net.status();
    const n = st.mode === 'online' ? net.count() : 0;
    const ping = st.mode === 'online' ? net.ping() : 0;
    if (st.mode === lastMode && n === lastCount && st.reconnecting === lastRe && Math.abs(ping - lastPing) < 5) return;
    lastMode = st.mode;
    lastCount = n;
    lastRe = st.reconnecting;
    lastPing = ping;
    let state = st.mode;
    let text;
    if (st.mode === 'online') text = `${t(TXT.online)} · ${n === 1 ? t(TXT.players1) : t(TXT.playersN, { n })}`;
    else if (st.mode === 'local' || st.mode === 'offline' || st.mode === 'off') {
      state = 'local';
      text = t(TXT.offline);
    } else text = st.reconnecting ? t(TXT.reconnecting) : t(TXT.connecting);
    label.textContent = text;
    statusEl.dataset.state = state;
    statusEl.title = st.mode === 'online' && ping ? `${t(TXT.title)} · ${t(TXT.ping, { ms: ping })}` : t(TXT.title);
  }

  // ------------------------------------------------------------ player list
  const listEl = h('div', { class: 'net-list panel', role: 'dialog', 'aria-label': t(TXT.title) });
  listEl.hidden = true;
  ui.addWidget('center', listEl, { modes: ['explore', 'drive'], order: 60 });
  ui.setVisible(listEl, false);
  let listShown = false;
  let listAcc = 0;

  const fmtDist = (d) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);

  function rows() {
    const me = ctx.player?.position;
    const out = [];
    out.push({ id: net.id() || 'me', name: ctx.state.get('profile.name') || 'Traveler', self: true, m: net.selfMode(), dist: 0, hp: ctx.state.get('smp.hp'), sh: ctx.state.get('smp.sh') });
    for (const p of net.players.values()) {
      const v = p.view;
      const d = me && p.inRange ? Math.hypot(v.p.x - me.x, v.p.z - me.z) : Infinity;
      out.push({ id: p.id, name: p.name, self: false, m: p.inRange ? v.m : null, dist: d, hp: p.inRange ? v.hp : null, sh: p.inRange ? v.sh : null });
    }
    out.sort((a, b) => (a.self ? -1 : b.self ? 1 : a.dist - b.dist || String(a.name).localeCompare(String(b.name))));
    return out;
  }

  function renderList(target) {
    const st = net.status();
    const list = rows();
    const n = list.length;
    const head = h(
      'div',
      { class: 'net-list-head' },
      h('span', { class: 'net-list-icon', html: ui.icon('net-players', 18) }),
      h('span', { class: 'net-list-title caps', text: t(TXT.title) }),
      h('span', { class: 'net-list-count', text: st.mode === 'online' ? String(n) : t(TXT.offline) }),
    );
    const body = h('div', { class: 'net-list-rows' });
    for (const r of list) {
      const hp = Number.isFinite(r.hp) ? Math.max(0, Math.min(1, r.hp / 100)) : null;
      const mode = r.m && TXT.modes[r.m] ? r.m : null;
      body.appendChild(
        h(
          'div',
          { class: `net-row${r.self ? ' is-self' : ''}` },
          h('span', { class: 'net-row-dot', style: { background: net.colorFor(r.id) } }),
          h('span', { class: 'net-row-name', text: r.name }, r.self ? h('em', { text: ` (${t(TXT.you)})` }) : null),
          h('span', { class: 'net-row-mode', title: mode ? t(TXT.modes[mode]) : '', html: mode ? ui.icon(MODE_ICON[mode] || 'user', 14) : '' }),
          h('span', { class: 'net-row-hp' }, hp != null ? h('i', { style: { width: `${Math.round(hp * 100)}%` } }) : null),
          h('span', { class: 'net-row-dist num', text: r.self ? '' : Number.isFinite(r.dist) ? fmtDist(r.dist) : t(TXT.far) }),
        ),
      );
    }
    const foot = h('div', { class: 'net-list-foot' });
    if (st.mode === 'online') {
      if (n === 1) foot.appendChild(h('span', { text: t(TXT.alone) }));
      const ping = net.ping();
      if (ping) foot.appendChild(h('span', { class: 'net-list-ping num', html: `${ui.icon('net-signal', 13)}<span>${t(TXT.ping, { ms: ping })}</span>` }));
    } else if (st.mode === 'local' || st.mode === 'offline' || st.mode === 'off') {
      foot.appendChild(h('span', { text: st.reason === 'replaced' ? t(TXT.replaced) : t(TXT.local) }));
      if (net.canGoOnline()) {
        foot.appendChild(
          h('button', { class: 'btn net-list-btn', type: 'button', text: st.mode === 'offline' ? t(TXT.reconnect) : t(TXT.goOnline), onclick: () => {
            ui.closeModal('net-players');
            net.retryOnline();
          } }),
        );
      }
    } else foot.appendChild(h('span', { text: st.reconnecting ? t(TXT.reconnecting) : t(TXT.connecting) }));
    target.replaceChildren(head, body, foot);
  }

  function showHoldList(on) {
    if (on === listShown) return;
    listShown = on;
    if (on) {
      renderList(listEl);
      listAcc = 0;
    }
    ui.setVisible(listEl, on);
  }

  let modalEl = null;
  let modalAcc = 0;
  function openList() {
    if (ui.isModalOpen('net-players')) return;
    modalEl = h('div', { class: 'net-list net-list-modal panel' });
    renderList(modalEl);
    const wrap = h(
      'div',
      { class: 'net-modal' },
      h('button', { class: 'modal-close net-modal-close', type: 'button', 'aria-label': 'Close', html: ui.icon('close', 20), onclick: () => ui.closeModal('net-players') }),
      modalEl,
    );
    ui.openModal('net-players', wrap, { closeOnEsc: true, closeOnBackdrop: true, onClose: () => (modalEl = null) });
    ctx.audio?.play?.('ui.open');
  }

  const holdOk = () => (modes.is('explore') && !ctx.build?.active) || modes.is('drive');
  loop.add(
    'net-ui',
    (dt) => {
      refreshStatus(dt);
      const want = holdOk() && input.down('Tab') && !ui.isModalOpen();
      showHoldList(want);
      if (listShown) {
        listAcc += dt;
        if (listAcc > 0.5) {
          listAcc = 0;
          renderList(listEl);
        }
      }
      if (modalEl) {
        modalAcc += dt;
        if (modalAcc > 0.75) {
          modalAcc = 0;
          renderList(modalEl);
        }
      }
    },
    { order: 94, pausable: false },
  );

  // ------------------------------------------------------------ toasts
  const pendingJoins = [];
  let joinTimer = 0;
  function flushJoins() {
    joinTimer = 0;
    if (!pendingJoins.length) return;
    if (pendingJoins.length === 1) ui.toast({ title: t(TXT.joined, { name: pendingJoins[0] }), icon: 'net-players', kind: 'info', duration: 2600 });
    else ui.toast({ title: t(TXT.joinedMany, { n: pendingJoins.length }), text: pendingJoins.slice(0, 4).join(', '), icon: 'net-players', kind: 'info', duration: 3000 });
    pendingJoins.length = 0;
  }
  function toastJoin(name) {
    pendingJoins.push(name);
    if (!joinTimer) joinTimer = setTimeout(flushJoins, 700);
  }
  function toastLeave(name) {
    ui.toast({ title: t(TXT.left, { name }), icon: 'net-players', kind: 'info', duration: 2200 });
  }
  function toastStatus(kind, reason) {
    if (kind === 'lost') ui.toast({ title: t(TXT.lost), text: t(TXT.lostText), icon: 'signal', kind: 'warn', duration: 4200 });
    else if (kind === 'back') ui.toast({ title: t(TXT.back), icon: 'signal', kind: 'success', duration: 2600 });
    else if (kind === 'offline') {
      const text = reason === 'full' ? t(TXT.full) : reason === 'version' ? t(TXT.version) : t(TXT.offlineText);
      ui.toast({ title: t(TXT.offlineTitle), text, icon: 'signal', kind: 'info', duration: 5200 });
    } else if (kind === 'replaced') ui.toast({ title: t(TXT.offline), text: t(TXT.replaced), icon: 'signal', kind: 'warn', duration: 6000 });
  }

  // ------------------------------------------------------------ touch
  // the mode layouts get the "Players" tile; overlay layouts (with `when`) are not re-registered
  // here because that would change their priority — their owners spread ctx.net.touchMenu
  const touchEntry = { id: 'net-players', icon: 'net-players', label: TXT.title, run: () => openList() };
  function mergeTouch() {
    const tc = ctx.touch;
    if (!tc?.enabled || !tc.getLayout) return;
    for (const name of ['explore', 'drive']) {
      const L = tc.getLayout(name);
      if (!L || typeof L.when === 'function') continue;
      const extra = Array.isArray(L.menuExtra) ? L.menuExtra : [];
      if (extra.some((x) => x?.id === touchEntry.id)) continue;
      tc.setLayout(name, { ...L, menuExtra: [...extra, touchEntry] });
    }
  }
  mergeTouch();
  events.on('game:installed', () => mergeTouch());
  events.on('game:start', () => mergeTouch());

  return { refreshStatus, openList, toastJoin, toastLeave, toastStatus, touchMenu: [touchEntry], mergeTouch, get listShown() {
    return listShown;
  } };
}
