/**
 * The Home screen (Roblox-like hub, Ø Universe style): shown with
 * ui.showScreen('platform-home') over the title mode's live world after the
 * title's Play.
 *
 *   top bar     back to title · Ø UNIVERSE / HOME · search · status · Ø-credits · language · settings · account
 *   main        greeting · guest/offline banner · hero (flagship "Ø Universe — SMP") ·
 *               rows: Your creations (+ Create new) · Popular · New  (search → results grid)
 *   side        player card (portrait, name, level, Ø-credits, Edit avatar, account) · friends panel
 *   compact     (phones / short landscape) tab bar: Home · Discover · Create · Friends · Me
 *
 * Text is resolved when built (the language never changes without a reload).
 */
import { t, locale } from '../core/i18n.js';
import { icon } from '../ui/icons.js';
import { ZONES } from '../world/layout.js';
import { experienceArt, heroArt, nameHue } from './thumbs.js';
import { compactNumber, relativeTime } from './validate.js';
import { errorText } from './api.js';

export const SCREEN_ID = 'platform-home';
const ROW_TTL = 60000;
const POLL_MS = 30000;

/** The Ø mark (thin ring + long slash), as on the poster. */
export function markSVG(size = 26, stroke = 5) {
  return `<svg class="plat-mark" width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" aria-hidden="true"><circle cx="50" cy="50" r="35.5" stroke="currentColor" stroke-width="${stroke}"/><path d="M17.5 92.5 82.5 7.5" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"/></svg>`;
}

const fmtCount = (n) => compactNumber(n, locale());

function formatPlaytime(sec) {
  const m = Math.floor((Number(sec) || 0) / 60);
  if (m < 1) return '';
  const hh = Math.floor(m / 60);
  return hh ? t({ en: '{h} h {m} min played', nl: '{h} u {m} min gespeeld' }, { h: hh, m: m % 60 }) : t({ en: '{m} min played', nl: '{m} min gespeeld' }, { m });
}

export function createHome(ctx, core) {
  const { ui, state } = ctx;
  const h = ui.h;
  const S = {
    el: null,
    open: false,
    tab: 'home',
    q: '',
    searchSeq: 0,
    offs: [],
    timers: [],
    popEscape: null,
    menuEl: null,
    playBusy: false,
    rowEls: {},
    lists: { popular: null, new: null, mine: null },
    listAt: { popular: 0, new: 0, mine: 0 },
    listErr: { popular: null, new: null, mine: null },
    loading: { popular: null, new: null, mine: null },
    live: null,
    portrait: null,
    portraitKey: '',
  };
  const $ = (sel) => S.el?.querySelector(sel);

  // ------------------------------------------------------------ helpers
  const btn = (cls, label, iconName, onclick, extra = {}) =>
    h(
      'button',
      { class: cls, type: 'button', onclick, ...extra },
      iconName ? h('span', { class: 'plat-btn-icon', html: icon(iconName, extra.iconSize || 16) }) : null,
      label != null ? h('span', { class: 'plat-btn-label', text: label }) : null,
    );
  const studioReady = () => !!ctx.studio && ctx.studio.available !== false && typeof ctx.studio.open === 'function';
  const userName = () => core.user?.displayName || core.user?.username || state.get('profile.name') || t({ en: 'Traveler', nl: 'Reiziger' });
  const initials = (name) =>
    String(name || '?')
      .replace(/[^a-z0-9]/gi, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() || '')
      .join('') || '?';
  function avatarEl(name, { online = null, size = 36 } = {}) {
    const el = h('span', { class: 'plat-avatar', 'aria-hidden': 'true', text: initials(name) });
    el.style.setProperty('--hue', String(nameHue(name)));
    el.style.setProperty('--size', `${size}px`);
    if (online != null) el.appendChild(h('i', { class: `plat-dot${online ? ' is-on' : ''}` }));
    return el;
  }

  // ------------------------------------------------------------- show / hide
  function show({ tab = null, focus = true } = {}) {
    if (S.open && S.el) {
      if (tab) setTab(tab);
      return;
    }
    // the poster title steps aside while Home is open (the world stays live behind it)
    try {
      ctx.shell?.title?.screen?.unmount?.();
    } catch (err) {
      console.warn('[platform] could not hide the title screen', err);
    }
    S.open = true;
    S.q = '';
    S.tab = tab || 'home';
    S.el = build();
    ui.showScreen(SCREEN_ID, S.el);
    S.popEscape = ui.pushEscape(onEscape);
    S.offs.push(
      ctx.events.on('platform:user', () => refreshAccountUI()),
      ctx.events.on('platform:status', () => refreshAccountUI()),
      ctx.events.on('platform:friends', () => renderFriends()),
      ctx.events.on('platform:creations', () => loadRow('mine', true)),
      ctx.events.on('state:change', (e) => {
        const p = e?.path || '';
        if (p === 'credits' || p.startsWith('progress') || p.startsWith('profile')) renderPlayerStats();
      }),
    );
    loadAll();
    S.timers.push(
      setInterval(() => {
        if (!S.open || document.hidden) return;
        if (core.user && core.online) core.friends.refresh().catch(() => {});
        refreshLive();
      }, POLL_MS),
    );
    // the portrait renders through the engine: after the screen has faded in
    S.timers.push(setTimeout(() => renderPortrait(), 420));
    // the staged entrance plays once: sections revealed later (compact tabs) appear at once
    S.timers.push(setTimeout(() => S.el?.querySelectorAll('.plat-rise').forEach((e) => e.classList.remove('plat-rise')), 1700));
    if (focus) requestAnimationFrame(() => requestAnimationFrame(() => $('.plat-hero .plat-play')?.focus({ preventScroll: true })));
    ctx.events.emit('platform:home', { open: true });
  }

  function hide({ toTitle = false } = {}) {
    if (!S.open) return;
    S.open = false;
    closeMenu();
    S.popEscape?.();
    S.popEscape = null;
    S.offs.forEach((off) => off?.());
    S.offs = [];
    S.timers.forEach((id) => (clearInterval(id), clearTimeout(id)));
    S.timers = [];
    ui.hideScreen(SCREEN_ID);
    S.el = null;
    S.rowEls = {};
    ctx.events.emit('platform:home', { open: false });
    if (toTitle && ctx.modes.is('title')) {
      try {
        ctx.shell?.title?.screen?.mount?.({ intro: 'short' });
      } catch (err) {
        console.warn('[platform] could not show the title screen', err);
      }
    }
  }

  function onEscape() {
    if (S.menuEl) return closeMenu();
    if (S.q) return clearSearch();
    if (S.tab !== 'home' && S.el?.matches?.('.is-compact')) return setTab('home');
    hide({ toTitle: true });
  }

  // ------------------------------------------------------------------ build
  function build() {
    const root = h(
      'div',
      { class: 'plat-home', dataset: { tab: S.tab }, role: 'main', 'aria-label': t({ en: 'Ø Universe Home', nl: 'Ø Universe Home' }) },
      h('div', { class: 'plat-scrim' }),
      buildTop(),
      h(
        'div',
        { class: 'plat-body' },
        h(
          'div',
          { class: 'plat-main scroll' },
          h('div', { class: 'plat-greet plat-rise' }),
          buildHero(),
          h('div', { class: 'plat-banner-slot' }),
          h('section', { class: 'plat-results', hidden: true, 'aria-live': 'polite' }),
          rowSection('mine', t({ en: 'Your creations', nl: 'Jouw creaties' }), 2),
          rowSection('popular', t({ en: 'Popular', nl: 'Populair' }), 3),
          rowSection('new', t({ en: 'New & updated', nl: 'Nieuw & bijgewerkt' }), 4),
          h('footer', { class: 'plat-foot' }, buildFootLinks()),
        ),
        h(
          'aside',
          { class: 'plat-side scroll', 'aria-label': t({ en: 'You and your friends', nl: 'Jij en je vrienden' }) },
          h('section', { class: 'plat-panel plat-player plat-rise', style: '--d: 0.12s' }),
          h('section', { class: 'plat-panel plat-me plat-rise', style: '--d: 0.16s' }),
          h('section', { class: 'plat-panel plat-friends plat-rise', style: '--d: 0.2s' }),
        ),
      ),
      buildTabs(),
    );
    // compact layout flag (phones / short landscape) mirrors the CSS breakpoint
    const mq = window.matchMedia?.('(max-width: 760px), (max-height: 500px)');
    const sync = () => root.classList.toggle('is-compact', !!mq?.matches);
    sync();
    mq?.addEventListener?.('change', sync);
    S.offs.push(() => mq?.removeEventListener?.('change', sync));
    S.el = root;
    renderGreeting();
    renderBanner();
    renderTopRight();
    renderPlayer();
    renderMe();
    renderFriends();
    return root;
  }

  // ---------------------------------------------------------------- top bar
  function buildTop() {
    const input = h('input', {
      class: 'plat-search-input',
      type: 'search',
      name: 'q',
      maxlength: '40',
      autocomplete: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
      placeholder: t({ en: 'Search experiences', nl: 'Zoek ervaringen' }),
      'aria-label': t({ en: 'Search experiences', nl: 'Zoek ervaringen' }),
    });
    let deb = 0;
    input.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => runSearch(input.value), 320);
    });
    const form = h(
      'form',
      { class: 'plat-search', role: 'search', onsubmit: (e) => (e.preventDefault(), clearTimeout(deb), runSearch(input.value, true)) },
      h('span', { class: 'plat-search-icon', html: icon('plat-search', 17) }),
      input,
      h('button', { class: 'plat-search-clear', type: 'button', 'aria-label': t({ en: 'Clear search', nl: 'Zoekopdracht wissen' }), onclick: () => clearSearch(true), html: icon('plat-x', 14) }),
    );
    return h(
      'header',
      { class: 'plat-top' },
      h('button', {
        class: 'plat-iconbtn plat-back',
        type: 'button',
        title: t({ en: 'Back to the title screen', nl: 'Terug naar het titelscherm' }),
        'aria-label': t({ en: 'Back to the title screen', nl: 'Terug naar het titelscherm' }),
        onclick: () => hide({ toTitle: true }),
        html: icon('chevron-left', 20),
      }),
      h(
        'div',
        { class: 'plat-brand', 'aria-label': 'Ø Universe' },
        h('span', { class: 'plat-brand-mark', html: markSVG(28, 5) }),
        h('span', { class: 'plat-brand-word', text: 'UNIVERSE' }),
        h('span', { class: 'plat-brand-sep', 'aria-hidden': 'true' }),
        h('span', { class: 'plat-brand-page', text: t({ en: 'Home', nl: 'Home' }) }),
      ),
      form,
      h('div', { class: 'plat-top-right' }),
    );
  }

  function renderTopRight() {
    const box = $('.plat-top-right');
    if (!box) return;
    const kids = [];
    if (core.probed && !core.online) {
      kids.push(
        h(
          'button',
          {
            class: 'plat-chip plat-chip-offline',
            type: 'button',
            title: t({ en: 'Offline — sign-in unavailable. Click to try again.', nl: 'Offline — inloggen niet beschikbaar. Klik om het opnieuw te proberen.' }),
            onclick: () => retryOnline(),
          },
          h('span', { html: icon('plat-offline', 15) }),
          h('span', { class: 'plat-chip-label', text: t({ en: 'Offline', nl: 'Offline' }) }),
        ),
      );
    }
    kids.push(
      h(
        'div',
        { class: 'plat-chip plat-credits', title: t({ en: 'Ø-credits', nl: 'Ø-credits' }) },
        h('span', { class: 'plat-credits-icon', html: icon('coin', 15) }),
        h('span', { class: 'plat-credits-num num', text: Math.round(Number(state.get('credits')) || 0).toLocaleString(locale()) }),
      ),
    );
    kids.push(
      h('button', {
        class: 'plat-iconbtn plat-lang',
        type: 'button',
        title: t({ en: 'Language', nl: 'Taal' }),
        'aria-label': t({ en: 'Language: English. Switch to Nederlands', nl: 'Taal: Nederlands. Wissel naar English' }),
        onclick: (e) => openLangMenu(e.currentTarget),
        text: (ctx.i18n?.lang?.() || 'en').toUpperCase(),
      }),
      h('button', {
        class: 'plat-iconbtn plat-settings',
        type: 'button',
        title: t({ en: 'Settings', nl: 'Instellingen' }),
        'aria-label': t({ en: 'Settings', nl: 'Instellingen' }),
        onclick: () => core.actions.openSettings(),
        html: icon('settings', 19),
      }),
    );
    if (core.user) {
      kids.push(
        h(
          'button',
          {
            class: 'plat-userbtn',
            type: 'button',
            'aria-haspopup': 'menu',
            'aria-label': t({ en: 'Account menu for @{u}', nl: 'Accountmenu van @{u}' }, { u: core.user.username }),
            onclick: (e) => openAccountMenu(e.currentTarget),
          },
          miniPortrait(),
          h('span', { class: 'plat-userbtn-name', text: core.user.username }),
          h('span', { class: 'plat-userbtn-caret', html: icon('chevron-down', 14) }),
        ),
      );
    } else if (core.online || !core.probed) {
      kids.push(btn('btn btn-sm plat-signin-btn', t({ en: 'Sign in', nl: 'Inloggen' }), 'plat-login', () => core.dialogs.auth('signin')));
    } else {
      kids.push(
        h(
          'button',
          { class: 'plat-userbtn is-guest', type: 'button', onclick: (e) => openAccountMenu(e.currentTarget), 'aria-haspopup': 'menu', 'aria-label': t({ en: 'Account menu', nl: 'Accountmenu' }) },
          miniPortrait(),
          h('span', { class: 'plat-userbtn-name', text: t({ en: 'Guest', nl: 'Gast' }) }),
          h('span', { class: 'plat-userbtn-caret', html: icon('chevron-down', 14) }),
        ),
      );
    }
    box.replaceChildren(...kids);
  }

  // --------------------------------------------------------------- greeting
  function renderGreeting() {
    const el = $('.plat-greet');
    if (!el) return;
    const hr = new Date().getHours();
    const hello =
      hr >= 5 && hr < 12
        ? t({ en: 'Good morning', nl: 'Goedemorgen' })
        : hr >= 12 && hr < 18
          ? t({ en: 'Good afternoon', nl: 'Goedemiddag' })
          : t({ en: 'Good evening', nl: 'Goedenavond' });
    const sub = core.user
      ? t({ en: 'Pick up where you left off — or discover something new.', nl: 'Ga verder waar je gebleven was — of ontdek iets nieuws.' })
      : t({ en: 'Explore, create and connect. Your universe starts here.', nl: 'Verken, creëer en verbind. Jouw universum begint hier.' });
    el.replaceChildren(h('div', { class: 'plat-greet-caps', text: t({ en: 'Welcome to Ø Universe', nl: 'Welkom in Ø Universe' }) }), h('h1', { class: 'plat-greet-title', text: `${hello}, ${userName()}` }), h('p', { class: 'plat-greet-sub', text: sub }));
  }

  function renderBanner() {
    const slot = $('.plat-banner-slot');
    if (!slot) return;
    let el = null;
    if (!core.probed) el = null;
    else if (!core.online) {
      el = h(
        'div',
        { class: 'plat-banner is-offline', role: 'status' },
        h('span', { class: 'plat-banner-icon', html: icon('plat-offline', 20) }),
        h(
          'div',
          { class: 'plat-banner-text' },
          h('strong', { text: t({ en: 'Offline — sign-in unavailable', nl: 'Offline — inloggen niet beschikbaar' }) }),
          h('span', { text: t({ en: 'You can still play Ø Universe and your local creations.', nl: 'Je kunt Ø Universe en je lokale creaties nog steeds spelen.' }) }),
        ),
        btn('btn btn-sm', t({ en: 'Try again', nl: 'Opnieuw' }), 'plat-refresh', () => retryOnline()),
      );
    } else if (!core.user && !core.bannerDismissed) {
      el = h(
        'div',
        { class: 'plat-banner is-guest', role: 'note' },
        h('span', { class: 'plat-banner-icon', html: icon('plat-cloud', 20) }),
        h(
          'div',
          { class: 'plat-banner-text' },
          h('strong', { text: t({ en: "You're playing as a guest", nl: 'Je speelt als gast' }) }),
          h('span', { text: t({ en: 'Create a free account to keep your progress and play on any device.', nl: 'Maak een gratis account om je voortgang te bewaren en op elk apparaat te spelen.' }) }),
        ),
        btn('btn btn-sm btn-primary', t({ en: 'Save your progress', nl: 'Bewaar je voortgang' }), null, () => core.dialogs.auth('save')),
        h('button', {
          class: 'plat-iconbtn plat-banner-close',
          type: 'button',
          'aria-label': t({ en: 'Dismiss', nl: 'Sluiten' }),
          onclick: () => {
            core.bannerDismissed = true;
            renderBanner();
          },
          html: icon('plat-x', 14),
        }),
      );
    }
    slot.replaceChildren(...(el ? [el] : []));
  }

  // ------------------------------------------------------------------- hero
  function buildHero() {
    const hasSave = !!ctx.shell?.hasProgress?.();
    const img = h('img', { class: 'plat-hero-img is-art', alt: '', decoding: 'async', src: heroArt(1280, 600) });
    const media = h('div', { class: 'plat-hero-media' }, img);
    // the live-rendered world thumbnail (title's thumbnail renderer) crossfades in when available
    try {
      ctx.shell?.title?.thumbs?.request?.('spawn', (canvas) => {
        if (!canvas || !media.isConnected || !canvas.width) return;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        copy.getContext('2d').drawImage(canvas, 0, 0);
        copy.className = 'plat-hero-img is-live';
        media.appendChild(copy);
        requestAnimationFrame(() => copy.classList.add('is-in'));
      });
    } catch {
      /* the painted hero stays */
    }
    const zone = ZONES[state.get('player.zone')]?.label;
    const metaBits = hasSave
      ? [t({ en: 'Level {n}', nl: 'Niveau {n}' }, { n: state.get('progress.level', 1) }), zone, formatPlaytime(state.get('stats.playtime', 0))].filter(Boolean)
      : [t({ en: 'New here? Create your character and step into the world.', nl: 'Nieuw hier? Maak je personage en stap de wereld in.' })];
    const feats = [
      ['shield', t({ en: 'Survive', nl: 'Overleef' })],
      ['structure', t({ en: 'Build', nl: 'Bouw' })],
      ['target', t({ en: 'Fight', nl: 'Vecht' })],
      ['rocket', t({ en: 'Explore', nl: 'Verken' })],
    ];
    return h(
      'section',
      { class: 'plat-hero plat-rise', style: '--d: 0.06s', 'aria-label': 'Ø Universe — SMP' },
      media,
      h('div', { class: 'plat-hero-shade' }),
      h(
        'div',
        { class: 'plat-hero-body' },
        h(
          'div',
          { class: 'plat-hero-tags' },
          h('span', { class: 'plat-tag is-gold', text: t({ en: 'Flagship', nl: 'Vlaggenschip' }) }),
          h('span', { class: 'plat-tag', text: t({ en: 'Survival · Multiplayer', nl: 'Survival · Multiplayer' }) }),
          h('span', { class: 'plat-live', hidden: true }, h('i'), h('span', { class: 'plat-live-text' })),
        ),
        h('h2', { class: 'plat-hero-title' }, h('span', { text: 'Ø UNIVERSE' }), h('span', { class: 'plat-hero-dash', text: '— SMP' })),
        h('p', {
          class: 'plat-hero-text',
          text: t({
            en: 'One persistent world, shared with everyone. Gather, craft and claim your land — then hold out together when night falls.',
            nl: 'Eén blijvende wereld, gedeeld met iedereen. Verzamel, craft en claim je land — en houd samen stand als de nacht valt.',
          }),
        }),
        h(
          'div',
          { class: 'plat-hero-actions' },
          h(
            'button',
            { class: 'plat-play', type: 'button', onclick: () => playFlagship() },
            h('span', { class: 'plat-play-icon', html: icon('play', 18) }),
            h('span', { class: 'plat-play-label', text: hasSave ? t({ en: 'Continue', nl: 'Doorgaan' }) : t({ en: 'Play', nl: 'Speel' }) }),
          ),
          btn('btn plat-btn-glass', t({ en: 'Character', nl: 'Karakter' }), 'user', () => core.actions.editAvatar()),
        ),
        h('div', { class: 'plat-hero-meta', text: metaBits.join(' · ') }),
      ),
      h(
        'ul',
        { class: 'plat-hero-feats', 'aria-hidden': 'true' },
        feats.map(([ic, label]) => h('li', {}, h('span', { html: icon(ic, 18) }), h('span', { text: label }))),
      ),
    );
  }

  async function playFlagship() {
    if (S.playBusy || ctx.modes.transitioning) return;
    S.playBusy = true;
    $('.plat-hero')?.classList.add('is-launching');
    try {
      await core.actions.playFlagship();
    } finally {
      S.playBusy = false;
      $('.plat-hero')?.classList.remove('is-launching');
    }
  }

  async function refreshLive() {
    const n = await core.livePlayers().catch(() => null);
    const el = $('.plat-live');
    if (!el) return;
    // a zero count reads as "dead game": only show it when someone is in the world
    el.hidden = !(n > 0);
    if (n > 0) el.querySelector('.plat-live-text').textContent = n === 1 ? t({ en: '1 player online', nl: '1 speler online' }) : t({ en: '{n} players online', nl: '{n} spelers online' }, { n: fmtCount(n) });
  }

  // ------------------------------------------------------------------- rows
  function rowSection(key, title, order) {
    const track = h('div', { class: 'plat-track', role: 'group', 'aria-label': title });
    const prev = h('button', { class: 'plat-rownav', type: 'button', 'aria-label': t({ en: 'Scroll left', nl: 'Naar links' }), html: icon('chevron-left', 18), onclick: () => scrollRow(track, -1) });
    const next = h('button', { class: 'plat-rownav', type: 'button', 'aria-label': t({ en: 'Scroll right', nl: 'Naar rechts' }), html: icon('chevron-right', 18), onclick: () => scrollRow(track, 1) });
    const syncNav = () => {
      const max = track.scrollWidth - track.clientWidth - 2;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max;
      prev.parentElement.hidden = max <= 0;
    };
    track.addEventListener('scroll', syncNav, { passive: true });
    track.addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowRight' && e.code !== 'ArrowLeft') return;
      const cards = [...track.querySelectorAll('.plat-card')];
      const i = cards.indexOf(document.activeElement);
      if (i < 0) return;
      const nxt = cards[i + (e.code === 'ArrowRight' ? 1 : -1)];
      if (nxt) {
        nxt.focus();
        nxt.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
      e.preventDefault();
    });
    const sec = h(
      'section',
      { class: 'plat-row plat-rise', dataset: { row: key }, style: `--d: ${(0.08 + order * 0.05).toFixed(2)}s` },
      h('header', { class: 'plat-row-head' }, h('h2', { class: 'plat-row-title', text: title }), h('span', { class: 'plat-row-count' }), h('div', { class: 'plat-row-tools' }, prev, next)),
      track,
    );
    S.rowEls[key] = { sec, track, syncNav };
    return sec;
  }

  function scrollRow(track, dir) {
    track.scrollBy({ left: dir * Math.max(200, track.clientWidth * 0.82), behavior: 'smooth' });
  }

  function skeletons(n = 5) {
    return Array.from({ length: n }, () => h('div', { class: 'plat-card is-skeleton', 'aria-hidden': 'true' }, h('div', { class: 'plat-card-media' }), h('div', { class: 'plat-card-body' }, h('i'), h('i'))));
  }

  function card(exp, { mine = false } = {}) {
    const img = h('img', { class: 'plat-card-img', alt: '', decoding: 'async', loading: 'lazy', src: exp.thumbnail || experienceArt(exp) });
    img.addEventListener('error', () => (img.src = experienceArt(exp)), { once: true });
    let badge = null;
    if (exp.local) badge = h('span', { class: 'plat-badge', text: t({ en: 'Local draft', nl: 'Lokaal concept' }) });
    else if (mine && !exp.published) badge = h('span', { class: 'plat-badge', text: t({ en: 'Draft', nl: 'Concept' }) });
    else if (mine) badge = h('span', { class: 'plat-badge is-live', text: t({ en: 'Published', nl: 'Gepubliceerd' }) });
    const by = exp.creator ? `@${exp.creator}` : exp.local ? t({ en: 'On this device', nl: 'Op dit apparaat' }) : '';
    return h(
      'button',
      {
        class: 'plat-card',
        type: 'button',
        dataset: { id: exp.id },
        'aria-label': `${exp.title}${by ? ` — ${by}` : ''}`,
        onclick: () => core.dialogs.experience(exp, { mine }),
      },
      h('div', { class: 'plat-card-media' }, img, badge, h('span', { class: 'plat-card-play', html: icon('play', 16) })),
      h(
        'div',
        { class: 'plat-card-body' },
        h('div', { class: 'plat-card-title', text: exp.title }),
        h('div', { class: 'plat-card-by', text: by }),
        exp.local
          ? h('div', { class: 'plat-card-stats' }, h('span', { text: relativeTime(exp.updatedAt, locale()) }))
          : h(
              'div',
              { class: 'plat-card-stats' },
              h('span', { class: 'plat-stat', title: t({ en: 'Likes', nl: 'Likes' }) }, h('span', { html: icon('plat-heart', 13) }), fmtCount(exp.likes)),
              h('span', { class: 'plat-stat', title: t({ en: 'Plays', nl: 'Keer gespeeld' }) }, h('span', { html: icon('play', 13) }), fmtCount(exp.plays)),
            ),
      ),
    );
  }

  function createCard() {
    const ok = studioReady();
    return h(
      'button',
      {
        class: 'plat-card plat-card-create',
        type: 'button',
        disabled: ok ? null : true,
        title: ok ? null : t({ en: 'Ø Studio is not available right now', nl: 'Ø Studio is nu niet beschikbaar' }),
        onclick: () => core.actions.createNew(),
      },
      h('div', { class: 'plat-card-media' }, h('span', { class: 'plat-create-icon', html: icon('plus', 30) })),
      h('div', { class: 'plat-card-body' }, h('div', { class: 'plat-card-title', text: t({ en: 'Create new', nl: 'Nieuw maken' }) }), h('div', { class: 'plat-card-by', text: t({ en: 'Open Ø Studio', nl: 'Open Ø Studio' }) })),
    );
  }

  function noteCard(text, actionLabel, action, iconName = 'info') {
    return h(
      'div',
      { class: 'plat-card plat-card-note' },
      h('span', { class: 'plat-note-icon', html: icon(iconName, 22) }),
      h('p', { text }),
      actionLabel ? btn('btn btn-sm', actionLabel, null, action) : null,
    );
  }

  function renderRow(key) {
    const row = S.rowEls[key];
    if (!row) return;
    const list = S.lists[key];
    const err = S.listErr[key];
    const kids = [];
    if (key === 'mine') kids.push(createCard());
    if (key !== 'mine' && !core.probed) kids.push(...skeletons(5));
    else if (key !== 'mine' && !core.online) {
      kids.push(
        noteCard(
          t({ en: "Discover is offline. Experiences from other creators appear here when you're connected.", nl: 'Ontdekken is offline. Ervaringen van andere makers verschijnen hier zodra je verbonden bent.' }),
          t({ en: 'Try again', nl: 'Opnieuw' }),
          () => retryOnline(),
          'plat-offline',
        ),
      );
    } else if (list == null && !err) kids.push(...skeletons(key === 'mine' ? 3 : 5));
    else if (err && !list) kids.push(noteCard(errorText(err), t({ en: 'Try again', nl: 'Opnieuw' }), () => loadRow(key, true), 'info'));
    else if (list.length) kids.push(...list.map((x) => card(x, { mine: key === 'mine' })));
    else if (key === 'mine') {
      if (!core.user && core.online)
        kids.push(noteCard(t({ en: 'Sign in to publish your creations and share them with everyone.', nl: 'Log in om je creaties te publiceren en met iedereen te delen.' }), t({ en: 'Sign in', nl: 'Inloggen' }), () => core.dialogs.auth('signin'), 'plat-studio'));
      else kids.push(noteCard(t({ en: 'Build your first world in Ø Studio — blocks, lights, spawn points and more.', nl: 'Bouw je eerste wereld in Ø Studio — blokken, lampen, spawnpunten en meer.' }), null, null, 'plat-studio'));
    } else kids.push(noteCard(t({ en: 'No experiences yet — be the first to publish one!', nl: 'Nog geen ervaringen — publiceer als eerste iets!' }), null, null, 'sparkle'));
    row.track.replaceChildren(...kids);
    const count = row.sec.querySelector('.plat-row-count');
    if (count) count.textContent = list?.length ? String(list.length) : '';
    requestAnimationFrame(() => row.syncNav());
  }

  async function loadRow(key, force = false) {
    if (!S.open) return;
    if (!force && S.lists[key] && performance.now() - S.listAt[key] < ROW_TTL) return renderRow(key);
    if (S.loading[key]) return S.loading[key];
    if (S.lists[key] == null) renderRow(key);
    S.loading[key] = loadRowNow(key).finally(() => (S.loading[key] = null));
    return S.loading[key];
  }

  async function loadRowNow(key) {
    if (key !== 'mine' && !core.probed) await core.whenProbed();
    if (!S.open) return;
    try {
      const list = key === 'mine' ? await core.experiences.mine() : core.online ? await core.experiences.list(key) : null;
      S.lists[key] = list ? list.filter((x) => !x.flagship) : null;
      S.listErr[key] = null;
      S.listAt[key] = performance.now();
    } catch (err) {
      S.listErr[key] = err;
      if (err.offline) S.lists[key] = null;
    }
    if (!S.open) return;
    renderRow(key);
    // friends "Playing {title}" can name the experience once a row knows it
    if (core.friends.list.some((f) => f.status === 'in-game' && f.experienceId && f.experienceId !== 'o-universe')) renderFriends();
  }

  function loadAll(force = false) {
    loadRow('mine', force);
    loadRow('popular', force);
    loadRow('new', force);
    refreshLive();
    if (core.user && core.online) core.friends.refresh().catch(() => {});
  }

  // ----------------------------------------------------------------- search
  async function runSearch(raw, submit = false) {
    const q = String(raw || '').trim().slice(0, 40);
    S.q = q;
    const box = $('.plat-results');
    if (!box) return;
    S.el.classList.toggle('is-searching', q.length >= 2);
    if (q.length < 2) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    box.hidden = false;
    const seq = ++S.searchSeq;
    const head = h('header', { class: 'plat-row-head' }, h('h2', { class: 'plat-row-title', text: t({ en: 'Results for “{q}”', nl: 'Resultaten voor “{q}”' }, { q }) }));
    const grid = h('div', { class: 'plat-grid', role: 'group' }, ...skeletons(4));
    box.replaceChildren(head, grid);
    if (submit) $('.plat-main')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    if (!core.online) {
      grid.replaceChildren(noteCard(t({ en: 'Search is offline right now.', nl: 'Zoeken is nu offline.' }), t({ en: 'Try again', nl: 'Opnieuw' }), () => retryOnline(), 'plat-offline'));
      return;
    }
    try {
      const list = (await core.experiences.list('popular', q)).filter((x) => !x.flagship);
      if (seq !== S.searchSeq || !S.open) return;
      grid.replaceChildren(...(list.length ? list.map((x) => card(x)) : [noteCard(t({ en: 'Nothing found. Try another word.', nl: 'Niets gevonden. Probeer een ander woord.' }), null, null, 'plat-search')]));
    } catch (err) {
      if (seq !== S.searchSeq || !S.open) return;
      grid.replaceChildren(noteCard(errorText(err), null, null, 'info'));
    }
  }

  function clearSearch(focus = false) {
    const input = $('.plat-search-input');
    if (input) input.value = '';
    runSearch('');
    if (focus) input?.focus();
  }

  // ----------------------------------------------------------- player card
  function miniPortrait() {
    const c = h('canvas', { class: 'plat-mini', width: '64', height: '64', 'aria-hidden': 'true' });
    if (S.portrait) drawPortrait(c, S.portrait, 'face');
    else {
      const g = c.getContext('2d');
      g.fillStyle = `hsl(${nameHue(userName())} 30% 28%)`;
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#ece6dc';
      g.font = '500 24px Jost, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(initials(userName()), 32, 34);
    }
    return c;
  }

  function drawPortrait(target, src, crop = 'bust') {
    const g = target.getContext('2d');
    const w = target.width;
    const hh = target.height;
    g.clearRect(0, 0, w, hh);
    if (crop === 'face') {
      // square crop around the head of a bust render
      const s = Math.min(src.width, src.height) * 0.56;
      g.drawImage(src, (src.width - s) / 2, src.height * 0.05, s, s, 0, 0, w, hh);
    } else g.drawImage(src, 0, 0, w, hh);
  }

  function renderPortrait() {
    if (!S.open || !ctx.portraits?.render) return;
    const key = JSON.stringify(ctx.player?.appearance || state.get('profile.appearance') || {});
    try {
      if (!S.portrait || key !== S.portraitKey) {
        S.portrait = ctx.portraits.render('player', { width: 240, height: 280, framing: 'bust' });
        S.portraitKey = key;
      }
    } catch (err) {
      console.warn('[platform] portrait failed', err);
      return;
    }
    const box = $('.plat-portrait');
    if (box && S.portrait?.width) {
      const c = h('canvas', { class: 'plat-portrait-img', width: '240', height: '280', 'aria-hidden': 'true' });
      drawPortrait(c, S.portrait);
      box.replaceChildren(c);
      requestAnimationFrame(() => c.classList.add('is-in'));
    }
    S.el?.querySelectorAll('.plat-mini').forEach((m) => drawPortrait(m, S.portrait, 'face'));
  }

  function renderPlayer() {
    const el = $('.plat-player');
    if (!el) return;
    const u = core.user;
    const handle = u
      ? h('span', { class: 'plat-handle', text: `@${u.username}` })
      : h('span', { class: 'plat-handle is-guest', text: core.online ? t({ en: 'Guest — progress on this device only', nl: 'Gast — voortgang alleen op dit apparaat' }) : t({ en: 'Guest', nl: 'Gast' }) });
    const safe = u?.under13 ? h('span', { class: 'plat-tag is-safe', title: t({ en: 'Safety settings for players under 13 are on', nl: 'Veiligheidsinstellingen voor spelers onder 13 staan aan' }), text: t({ en: 'Safe mode', nl: 'Veilige modus' }) }) : null;
    const actions = [btn('btn btn-sm plat-btn-glass', t({ en: 'Edit avatar', nl: 'Avatar bewerken' }), 'plat-edit', () => core.actions.editAvatar())];
    if (u) actions.push(btn('btn btn-sm btn-ghost plat-signout', t({ en: 'Sign out', nl: 'Uitloggen' }), 'plat-logout', () => core.actions.logout()));
    else if (core.online || !core.probed) actions.push(btn('btn btn-sm btn-primary', t({ en: 'Save your progress', nl: 'Bewaar je voortgang' }), 'plat-cloud', () => core.dialogs.auth('save')));
    const foot = !u
      ? core.online || !core.probed
        ? h('div', { class: 'plat-player-foot' }, h('span', { text: t({ en: 'Already have an account?', nl: 'Heb je al een account?' }) }), h('button', { class: 'plat-link', type: 'button', onclick: () => core.dialogs.auth('signin'), text: t({ en: 'Sign in', nl: 'Inloggen' }) }))
        : h('div', { class: 'plat-player-foot is-offline' }, h('span', { html: icon('plat-offline', 14) }), h('span', { text: t({ en: 'Offline — sign-in unavailable', nl: 'Offline — inloggen niet beschikbaar' }) }))
      : null;
    const portrait = h('div', { class: 'plat-portrait' });
    if (S.portrait?.width) {
      const c = h('canvas', { class: 'plat-portrait-img is-in', width: '240', height: '280', 'aria-hidden': 'true' });
      drawPortrait(c, S.portrait);
      portrait.appendChild(c);
    } else portrait.appendChild(h('span', { class: 'plat-portrait-ph', html: markSVG(40, 4) }));
    el.replaceChildren(
      h('h3', { class: 'plat-panel-title', text: t({ en: 'Your profile', nl: 'Jouw profiel' }) }),
      h(
        'div',
        { class: 'plat-player-row' },
        portrait,
        h(
          'div',
          { class: 'plat-player-info' },
          // signed in: the account's display name (the game server shows accounts under it); guests: the character name
          h('div', { class: 'plat-player-name', text: userName() }),
          h('div', { class: 'plat-player-handle' }, handle, safe),
        ),
      ),
      h('div', { class: 'plat-player-stats' }),
      h('div', { class: 'plat-player-actions' }, actions),
      ...(foot ? [foot] : []),
    );
    renderPlayerStats();
  }

  function renderPlayerStats() {
    const box = $('.plat-player-stats');
    if (box) {
      box.replaceChildren(
        h('div', { class: 'plat-statbox' }, h('span', { class: 'plat-statbox-k', text: t({ en: 'Level', nl: 'Niveau' }) }), h('span', { class: 'plat-statbox-v num', text: String(state.get('progress.level', 1)) })),
        h(
          'div',
          { class: 'plat-statbox' },
          h('span', { class: 'plat-statbox-k', text: t({ en: 'Ø-credits', nl: 'Ø-credits' }) }),
          h('span', { class: 'plat-statbox-v num is-gold' }, h('span', { html: icon('coin', 14) }), Math.round(Number(state.get('credits')) || 0).toLocaleString(locale())),
        ),
      );
    }
    const top = $('.plat-credits-num');
    if (top) top.textContent = Math.round(Number(state.get('credits')) || 0).toLocaleString(locale());
  }

  /** "Me" panel (compact layout only): account + settings + language + safety. */
  function renderMe() {
    const el = $('.plat-me');
    if (!el) return;
    const item = (iconName, label, onclick, cls = '') => h('button', { class: `plat-me-item ${cls}`, type: 'button', onclick }, h('span', { html: icon(iconName, 18) }), h('span', { text: label }), h('span', { class: 'plat-me-chev', html: icon('chevron-right', 16) }));
    const u = core.user;
    const items = [];
    if (u) items.push(item('plat-logout', t({ en: 'Sign out', nl: 'Uitloggen' }), () => core.actions.logout()));
    else if (core.online) {
      items.push(item('plat-cloud', t({ en: 'Save your progress', nl: 'Bewaar je voortgang' }), () => core.dialogs.auth('save'), 'is-accent'));
      items.push(item('plat-login', t({ en: 'Sign in', nl: 'Inloggen' }), () => core.dialogs.auth('signin')));
    }
    items.push(item('settings', t({ en: 'Settings', nl: 'Instellingen' }), () => core.actions.openSettings()));
    // the title's floating full-screen toggle is hidden under Home's top bar: offer it here instead
    if (ctx.touch?.enabled && ctx.touch.canFullscreen) {
      items.push(item('plat-expand', t({ en: 'Full screen', nl: 'Volledig scherm' }), () => ctx.touch.toggleFullscreen()));
    }
    items.push(item('shield', t({ en: 'Privacy & safety', nl: 'Privacy & veiligheid' }), () => core.dialogs.safety()));
    items.push(item('chevron-left', t({ en: 'Back to the title screen', nl: 'Terug naar het titelscherm' }), () => hide({ toTitle: true })));
    const cur = ctx.i18n?.lang?.() || 'en';
    const langs = h(
      'div',
      { class: 'plat-seg', role: 'radiogroup', 'aria-label': t({ en: 'Language', nl: 'Taal' }) },
      (ctx.i18n?.LANGUAGES || [
        { id: 'en', label: 'English' },
        { id: 'nl', label: 'Nederlands' },
      ]).map((L) =>
        h('button', { class: `plat-seg-btn${L.id === cur ? ' is-on' : ''}`, type: 'button', role: 'radio', 'aria-checked': L.id === cur ? 'true' : 'false', onclick: () => core.actions.setLanguage(L.id), text: L.label }),
      ),
    );
    el.replaceChildren(h('h3', { class: 'plat-panel-title', text: t({ en: 'Account & settings', nl: 'Account & instellingen' }) }), h('div', { class: 'plat-me-lang' }, h('span', { html: icon('globe', 18) }), langs), h('div', { class: 'plat-me-list' }, items));
  }

  function buildFootLinks() {
    return [
      h('span', { class: 'plat-foot-brand', html: markSVG(16, 6) }),
      h('button', { class: 'plat-link', type: 'button', onclick: () => core.dialogs.safety(), text: t({ en: 'Privacy & safety', nl: 'Privacy & veiligheid' }) }),
      h('span', { class: 'plat-foot-sep', text: '·' }),
      h('button', { class: 'plat-link', type: 'button', onclick: () => core.actions.openSettings(), text: t({ en: 'Settings', nl: 'Instellingen' }) }),
      h('span', { class: 'plat-foot-sep', text: '·' }),
      h('span', { class: 'plat-foot-ver', text: 'Ø Universe · Platform v1' }),
    ];
  }

  // ---------------------------------------------------------------- friends
  function renderFriends() {
    const el = $('.plat-friends');
    if (!el) return;
    const F = core.friends;
    const u = core.user;
    const onlineCount = F.list.filter((f) => f.online).length;
    const head = h(
      'header',
      { class: 'plat-panel-head' },
      h('h3', { class: 'plat-panel-title', text: t({ en: 'Friends', nl: 'Vrienden' }) }),
      u && F.loaded ? h('span', { class: 'plat-panel-count' }, h('i', { class: 'plat-dot is-on' }), t({ en: '{n} online', nl: '{n} online' }, { n: onlineCount })) : null,
    );
    const kids = [head];
    if (!core.probed) kids.push(h('ul', { class: 'plat-flist' }, [0, 1, 2].map(() => h('li', { class: 'plat-fitem is-skeleton' }, h('span', { class: 'plat-avatar' }), h('i')))));
    else if (!core.online) {
      kids.push(h('p', { class: 'plat-empty' }, h('span', { html: icon('plat-offline', 16) }), t({ en: "Offline — friends will show up when you're connected.", nl: 'Offline — vrienden verschijnen zodra je verbonden bent.' })));
    } else if (!u) {
      kids.push(
        h('p', { class: 'plat-empty', text: t({ en: 'Sign in to add friends and see when they are online.', nl: 'Log in om vrienden toe te voegen en te zien wanneer ze online zijn.' }) }),
        h('div', { class: 'plat-row-btns' }, btn('btn btn-sm btn-primary', t({ en: 'Sign in', nl: 'Inloggen' }), 'plat-login', () => core.dialogs.auth('signin')), btn('btn btn-sm', t({ en: 'Create account', nl: 'Account maken' }), null, () => core.dialogs.auth('register'))),
      );
    } else {
      if (u.restricted?.friends) {
        kids.push(
          h(
            'div',
            { class: 'plat-note is-safe' },
            h('span', { html: icon('plat-lock', 16) }),
            h('span', { text: t({ en: 'Friend requests are turned off on accounts for players under 13 — to keep you safe.', nl: 'Vriendschapsverzoeken staan uit op accounts van spelers onder 13 — voor je veiligheid.' }) }),
          ),
        );
      } else kids.push(addFriendForm());
      if (F.incoming.length) {
        kids.push(h('div', { class: 'plat-sub' }, t({ en: 'Requests', nl: 'Verzoeken' }), h('span', { class: 'plat-pill', text: String(F.incoming.length) })));
        kids.push(h('ul', { class: 'plat-flist' }, F.incoming.map((f) => requestItem(f))));
      }
      if (!F.loaded && F.loading) kids.push(h('ul', { class: 'plat-flist' }, [0, 1, 2].map(() => h('li', { class: 'plat-fitem is-skeleton' }, h('span', { class: 'plat-avatar' }), h('i')))));
      else if (F.error && !F.list.length) kids.push(h('p', { class: 'plat-empty', text: errorText(F.error) }));
      else if (!F.list.length && !F.outgoing.length && !F.incoming.length && !u.restricted?.friends) {
        kids.push(h('p', { class: 'plat-empty', text: t({ en: 'No friends yet. Add someone by their username!', nl: 'Nog geen vrienden. Voeg iemand toe met zijn of haar gebruikersnaam!' }) }));
      }
      if (F.list.length) kids.push(h('ul', { class: 'plat-flist' }, F.list.map((f) => friendItem(f))));
      if (F.outgoing.length) {
        kids.push(h('div', { class: 'plat-sub' }, t({ en: 'Sent', nl: 'Verstuurd' })));
        kids.push(h('ul', { class: 'plat-flist is-dim' }, F.outgoing.map((f) => pendingItem(f))));
      }
    }
    el.replaceChildren(...kids);
    // tab badge (compact layout): incoming requests
    const badge = $('.plat-tab[data-tab="friends"] .plat-tab-badge');
    if (badge) {
      badge.textContent = F.incoming.length ? String(F.incoming.length) : '';
      badge.hidden = !F.incoming.length;
    }
  }

  function addFriendForm() {
    const input = h('input', {
      class: 'plat-input',
      type: 'text',
      name: 'friend',
      maxlength: '20',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      enterkeyhint: 'send',
      placeholder: t({ en: 'Add by username', nl: 'Toevoegen via gebruikersnaam' }),
      'aria-label': t({ en: 'Add friend by username', nl: 'Vriend toevoegen via gebruikersnaam' }),
    });
    const msg = h('div', { class: 'plat-form-msg', role: 'status' });
    const submit = h('button', { class: 'plat-iconbtn plat-add-btn', type: 'submit', 'aria-label': t({ en: 'Send friend request', nl: 'Vriendschapsverzoek sturen' }), html: icon('plat-user-plus', 18) });
    const form = h(
      'form',
      {
        class: 'plat-addfriend',
        onsubmit: async (e) => {
          e.preventDefault();
          const name = input.value.trim().toLowerCase();
          if (!name) return input.focus();
          if (name === core.user?.username) {
            msg.className = 'plat-form-msg is-err';
            msg.textContent = t({ en: "You can't add yourself.", nl: 'Je kunt jezelf niet toevoegen.' });
            return;
          }
          submit.disabled = true;
          msg.className = 'plat-form-msg';
          msg.textContent = '';
          try {
            await core.friends.request(name);
            input.value = '';
            msg.className = 'plat-form-msg is-ok';
            msg.textContent = t({ en: 'Friend request sent to @{u}.', nl: 'Vriendschapsverzoek verstuurd naar @{u}.' }, { u: name });
          } catch (err) {
            msg.className = 'plat-form-msg is-err';
            msg.textContent = errorText(err);
          } finally {
            submit.disabled = false;
          }
        },
      },
      h('div', { class: 'plat-addfriend-row' }, input, submit),
      msg,
    );
    return form;
  }

  /** "In Ø Universe — SMP" / "Playing Sky Islands" / "Online" / "Offline". */
  function friendStatus(f) {
    if (!f.online) return t({ en: 'Offline', nl: 'Offline' });
    if (f.status === 'in-game') {
      if (!f.experienceId || f.experienceId === 'o-universe') return t({ en: 'In Ø Universe — SMP', nl: 'In Ø Universe — SMP' });
      let title = '';
      for (const list of Object.values(S.lists)) {
        const x = list?.find?.((e) => e.id === f.experienceId);
        if (x) {
          title = x.title;
          break;
        }
      }
      return title ? t({ en: 'Playing {x}', nl: 'Speelt {x}' }, { x: title }) : t({ en: 'Playing an experience', nl: 'Speelt een ervaring' });
    }
    return f.activity || t({ en: 'Online', nl: 'Online' });
  }

  function friendItem(f) {
    const status = friendStatus(f);
    const inSmp = f.online && f.status === 'in-game' && (!f.experienceId || f.experienceId === 'o-universe');
    const more = h('div', { class: 'plat-fmore', hidden: true });
    const join = inSmp
      ? h('button', {
          class: 'plat-joinbtn',
          type: 'button',
          title: t({ en: 'Join @{u} in Ø Universe — SMP', nl: 'Speel met @{u} in Ø Universe — SMP' }, { u: f.username }),
          'aria-label': t({ en: 'Join @{u} in Ø Universe — SMP', nl: 'Speel met @{u} in Ø Universe — SMP' }, { u: f.username }),
          text: t({ en: 'Join', nl: 'Meedoen' }),
          onclick: () => playFlagship(),
        })
      : null;
    const li = h(
      'li',
      { class: `plat-fitem${f.online ? ' is-online' : ''}${f.status === 'in-game' ? ' is-ingame' : ''}` },
      avatarEl(f.username, { online: f.online }),
      h('div', { class: 'plat-fbody' }, h('div', { class: 'plat-fname', text: f.displayName || f.username }), h('div', { class: 'plat-fstatus', text: status })),
      join,
      h('button', {
        class: 'plat-iconbtn plat-fdots',
        type: 'button',
        'aria-label': t({ en: 'More options for @{u}', nl: 'Meer opties voor @{u}' }, { u: f.username }),
        'aria-expanded': 'false',
        html: icon('plat-dots', 18),
        onclick: (e) => {
          more.hidden = !more.hidden;
          e.currentTarget.setAttribute('aria-expanded', String(!more.hidden));
        },
      }),
      more,
    );
    more.append(
      btn('btn btn-sm btn-ghost', t({ en: 'Remove friend', nl: 'Vriend verwijderen' }), 'plat-x', async () => {
        try {
          await core.friends.remove(f.id);
          ui.toast({ title: t({ en: 'Friend removed', nl: 'Vriend verwijderd' }), text: `@${f.username}`, icon: 'people' });
        } catch (err) {
          ui.toast({ title: t({ en: 'Could not remove', nl: 'Verwijderen mislukt' }), text: errorText(err), kind: 'error', icon: 'info' });
        }
      }),
      btn('btn btn-sm btn-ghost', t({ en: 'Report', nl: 'Melden' }), 'plat-flag', () => core.dialogs.report({ kind: 'user', targetId: f.userId, label: `@${f.username}` })),
    );
    return li;
  }

  function requestItem(f) {
    const busy = (on, li) => li.querySelectorAll('button').forEach((b) => (b.disabled = on));
    const li = h(
      'li',
      { class: 'plat-fitem is-request' },
      avatarEl(f.username),
      h('div', { class: 'plat-fbody' }, h('div', { class: 'plat-fname', text: f.displayName || f.username }), h('div', { class: 'plat-fstatus', text: t({ en: 'Wants to be friends', nl: 'Wil vrienden worden' }) })),
    );
    li.append(
      h('button', {
        class: 'plat-iconbtn is-ok',
        type: 'button',
        'aria-label': t({ en: 'Accept @{u}', nl: '@{u} accepteren' }, { u: f.username }),
        html: icon('plat-check', 18),
        onclick: async () => {
          busy(true, li);
          try {
            await core.friends.accept(f.id);
            ui.toast({ title: t({ en: 'New friend', nl: 'Nieuwe vriend' }), text: t({ en: "You and @{u} are now friends.", nl: 'Jij en @{u} zijn nu vrienden.' }, { u: f.username }), icon: 'people', kind: 'success' });
          } catch (err) {
            busy(false, li);
            ui.toast({ title: t({ en: 'Could not accept', nl: 'Accepteren mislukt' }), text: errorText(err), kind: 'error', icon: 'info' });
          }
        },
      }),
      h('button', {
        class: 'plat-iconbtn',
        type: 'button',
        'aria-label': t({ en: 'Decline @{u}', nl: '@{u} weigeren' }, { u: f.username }),
        html: icon('plat-x', 16),
        onclick: async () => {
          busy(true, li);
          try {
            await core.friends.remove(f.id);
          } catch (err) {
            busy(false, li);
            ui.toast({ title: t({ en: 'Could not decline', nl: 'Weigeren mislukt' }), text: errorText(err), kind: 'error', icon: 'info' });
          }
        },
      }),
    );
    return li;
  }

  function pendingItem(f) {
    return h(
      'li',
      { class: 'plat-fitem' },
      avatarEl(f.username),
      h('div', { class: 'plat-fbody' }, h('div', { class: 'plat-fname', text: f.displayName || f.username }), h('div', { class: 'plat-fstatus', text: t({ en: 'Request pending', nl: 'Verzoek in afwachting' }) })),
      h('button', {
        class: 'plat-iconbtn',
        type: 'button',
        'aria-label': t({ en: 'Cancel request to @{u}', nl: 'Verzoek aan @{u} annuleren' }, { u: f.username }),
        html: icon('plat-x', 16),
        onclick: () => core.friends.remove(f.id).catch((err) => ui.toast({ title: t({ en: 'Could not cancel', nl: 'Annuleren mislukt' }), text: errorText(err), kind: 'error', icon: 'info' })),
      }),
    );
  }

  // ------------------------------------------------------------------ tabs
  function buildTabs() {
    const tab = (id, iconName, label, onclick) =>
      h(
        'button',
        { class: 'plat-tab', type: 'button', role: 'tab', dataset: { tab: id }, 'aria-selected': id === S.tab ? 'true' : 'false', onclick: onclick || (() => setTab(id)) },
        h('span', { class: 'plat-tab-icon', html: icon(iconName, 21) }),
        h('span', { class: 'plat-tab-label', text: label }),
        id === 'friends' ? h('span', { class: 'plat-tab-badge', hidden: true }) : null,
      );
    return h(
      'nav',
      { class: 'plat-tabs', role: 'tablist', 'aria-label': t({ en: 'Home sections', nl: 'Home-onderdelen' }) },
      tab('home', 'home', t({ en: 'Home', nl: 'Home' })),
      tab('discover', 'plat-compass', t({ en: 'Discover', nl: 'Ontdek' })),
      tab('create', 'plat-studio', t({ en: 'Create', nl: 'Maak' }), () => core.actions.createNew()),
      tab('friends', 'people', t({ en: 'Friends', nl: 'Vrienden' })),
      tab('me', 'user', t({ en: 'Me', nl: 'Ik' })),
    );
  }

  function setTab(id) {
    if (!S.el) return;
    S.tab = id;
    S.el.dataset.tab = id;
    S.el.querySelectorAll('.plat-tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false'));
    $('.plat-main')?.scrollTo?.({ top: 0 });
    $('.plat-side')?.scrollTo?.({ top: 0 });
    if (id === 'discover') requestAnimationFrame(() => $('.plat-search-input')?.focus({ preventScroll: true }));
    if (id === 'friends' && core.user && core.online) core.friends.refresh().catch(() => {});
  }

  // ------------------------------------------------------------ popovers
  function closeMenu() {
    if (!S.menuEl) return;
    const m = S.menuEl;
    S.menuEl = null;
    m.classList.remove('is-open');
    setTimeout(() => m.remove(), 180);
    document.removeEventListener('pointerdown', onOutside, true);
  }

  function onOutside(e) {
    if (S.menuEl && !S.menuEl.contains(e.target) && !e.target.closest?.('.plat-userbtn, .plat-lang')) closeMenu();
  }

  function popover(anchor, children, label) {
    closeMenu();
    if (!S.el) return null;
    const r = anchor.getBoundingClientRect();
    const host = S.el.getBoundingClientRect();
    const m = h('div', { class: 'plat-menu', role: 'menu', 'aria-label': label }, children);
    m.style.top = `${r.bottom - host.top + 8}px`;
    m.style.right = `${Math.max(8, host.right - r.right)}px`;
    S.el.appendChild(m);
    S.menuEl = m;
    requestAnimationFrame(() => {
      m.classList.add('is-open');
      m.querySelector('button')?.focus({ preventScroll: true });
    });
    document.addEventListener('pointerdown', onOutside, true);
    m.addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
      const items = [...m.querySelectorAll('button:not([disabled])')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.code === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      e.preventDefault();
    });
    return m;
  }

  const menuItem = (iconName, label, onclick, cls = '') =>
    h(
      'button',
      {
        class: `plat-menu-item ${cls}`,
        type: 'button',
        role: 'menuitem',
        onclick: () => {
          closeMenu();
          onclick();
        },
      },
      h('span', { html: icon(iconName, 17) }),
      h('span', { text: label }),
    );

  function openAccountMenu(anchor) {
    if (S.menuEl) return closeMenu();
    const u = core.user;
    const head = h(
      'div',
      { class: 'plat-menu-head' },
      miniPortrait(),
      h('div', {}, h('div', { class: 'plat-menu-name', text: u ? u.displayName || u.username : t({ en: 'Guest', nl: 'Gast' }) }), h('div', { class: 'plat-menu-sub', text: u ? `@${u.username}` : core.online ? t({ en: 'Not signed in', nl: 'Niet ingelogd' }) : t({ en: 'Offline', nl: 'Offline' }) })),
    );
    const items = [head, h('div', { class: 'plat-menu-sep' })];
    items.push(menuItem('plat-edit', t({ en: 'Edit avatar', nl: 'Avatar bewerken' }), () => core.actions.editAvatar()));
    items.push(
      menuItem('plat-studio', t({ en: 'Your creations', nl: 'Jouw creaties' }), () => {
        S.rowEls.mine?.sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
    );
    items.push(menuItem('settings', t({ en: 'Settings', nl: 'Instellingen' }), () => core.actions.openSettings()));
    items.push(menuItem('shield', t({ en: 'Privacy & safety', nl: 'Privacy & veiligheid' }), () => core.dialogs.safety()));
    items.push(h('div', { class: 'plat-menu-sep' }));
    if (u) items.push(menuItem('plat-logout', t({ en: 'Sign out', nl: 'Uitloggen' }), () => core.actions.logout(), 'is-danger'));
    else if (core.online) {
      items.push(menuItem('plat-login', t({ en: 'Sign in', nl: 'Inloggen' }), () => core.dialogs.auth('signin')));
      items.push(menuItem('plat-cloud', t({ en: 'Create account', nl: 'Account maken' }), () => core.dialogs.auth('register')));
    } else items.push(menuItem('plat-refresh', t({ en: 'Try to connect', nl: 'Opnieuw verbinden' }), () => retryOnline()));
    popover(anchor, items, t({ en: 'Account', nl: 'Account' }));
  }

  function openLangMenu(anchor) {
    if (S.menuEl) return closeMenu();
    const cur = ctx.i18n?.lang?.() || 'en';
    const langs = ctx.i18n?.LANGUAGES || [
      { id: 'en', label: 'English' },
      { id: 'nl', label: 'Nederlands' },
    ];
    popover(
      anchor,
      [
        h('div', { class: 'plat-menu-caps', text: t({ en: 'Language', nl: 'Taal' }) }),
        ...langs.map((L) => menuItem(L.id === cur ? 'plat-check' : 'globe', L.label, () => core.actions.setLanguage(L.id), L.id === cur ? 'is-on' : '')),
      ],
      t({ en: 'Language', nl: 'Taal' }),
    );
  }

  // ------------------------------------------------------------- refresh
  function refreshAccountUI() {
    if (!S.open) return;
    renderTopRight();
    renderGreeting();
    renderBanner();
    renderPlayer();
    renderMe();
    renderFriends();
    if (S.portrait) S.el?.querySelectorAll('.plat-mini').forEach((m) => drawPortrait(m, S.portrait, 'face'));
    loadRow('mine', true);
    if (core.online && (S.lists.popular == null || S.listErr.popular)) loadRow('popular', true);
    if (core.online && (S.lists.new == null || S.listErr.new)) loadRow('new', true);
    if (!core.online) {
      renderRow('popular');
      renderRow('new');
    }
  }

  async function retryOnline() {
    const was = core.online;
    await core.refresh();
    if (!core.online) {
      ui.toast({ title: t({ en: 'Still offline', nl: 'Nog steeds offline' }), text: t({ en: "Can't reach the Ø Universe servers right now.", nl: 'De Ø Universe-servers zijn nu niet bereikbaar.' }), icon: 'plat-offline', kind: 'warn' });
    } else if (!was) {
      refreshAccountUI();
      loadAll(true);
    }
  }

  return {
    show,
    hide,
    setTab,
    refresh: () => (S.open ? (refreshAccountUI(), loadAll(true)) : null),
    get open() {
      return S.open;
    },
    get el() {
      return S.el;
    },
    /** Updates one experience everywhere it is shown (likes/plays after the page changed it). */
    patchExperience(exp) {
      if (!exp || !S.el) return;
      for (const key of Object.keys(S.lists)) {
        const list = S.lists[key];
        const i = list ? list.findIndex((x) => x.id === exp.id) : -1;
        if (i >= 0) list[i] = { ...list[i], likes: exp.likes, plays: exp.plays, liked: exp.liked };
      }
      S.el.querySelectorAll(`.plat-card[data-id="${CSS.escape(exp.id)}"] .plat-card-stats`).forEach((stats) => {
        const spans = stats.querySelectorAll('.plat-stat');
        if (spans[0]) spans[0].lastChild.textContent = fmtCount(exp.likes);
        if (spans[1]) spans[1].lastChild.textContent = fmtCount(exp.plays);
      });
    },
    removeExperience(id) {
      for (const key of Object.keys(S.lists)) if (S.lists[key]) S.lists[key] = S.lists[key].filter((x) => x.id !== id);
      for (const key of Object.keys(S.rowEls)) renderRow(key);
    },
  };
}
