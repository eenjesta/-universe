/**
 * Pause / settings menu (modal 'shell-pause'). In-game ('game' context, from
 * explore/drive/space) it pauses the loop and offers: Resume, Overview,
 * Settings, Controls, About Ø Universe, World map, Back to title screen,
 * Reset progress. From the title screen ('title' context) it is the settings
 * dialog. Emits `pause` {open} for the in-game variant.
 */
import { icon } from '../../ui/icons.js';
import { t } from '../../core/i18n.js';
import { ZONES } from '../../world/layout.js';
import { place } from '../data.js';
import { logoMarkSVG, formatDuration, formatDistance, formatNumber, uiSound } from '../util.js';
import { settingsPanel, controlsPanel, aboutPanel } from './panels.js';

const MODAL_ID = 'shell-pause';

/** Labels used in more than one place (menu items, tab titles, buttons). */
const TXT = {
  resume: { en: 'Resume', nl: 'Hervatten' },
  overview: { en: 'Overview', nl: 'Overzicht' },
  settings: { en: 'Settings', nl: 'Instellingen' },
  controls: { en: 'Controls', nl: 'Besturing' },
  about: { en: 'About Ø Universe', nl: 'Over Ø Universe' },
  map: { en: 'World map', nl: 'Wereldkaart' },
  reset: { en: 'Reset progress', nl: 'Voortgang wissen' },
  close: { en: 'Close', nl: 'Sluiten' },
};

export class PauseMenu {
  constructor(ctx, shell) {
    this.ctx = ctx;
    this.shell = shell;
    this.el = null;
    this.context = 'game';
    this.tab = 'overview';
    this._settings = null;
    this._openedAt = 0;
  }

  get isOpen() {
    return this.ctx.ui.isModalOpen(MODAL_ID);
  }

  /** open({ tab, context: 'game' | 'title' }) */
  open({ tab = null, context = null } = {}) {
    const ctx = this.ctx;
    const ctxName = context || (ctx.modes.is('title') ? 'title' : 'game');
    if (this.isOpen) {
      if (tab) this.show(tab);
      return;
    }
    this.context = ctxName;
    this.tab = tab || (ctxName === 'title' ? 'settings' : 'overview');
    this._build();
    ctx.ui.openModal(MODAL_ID, this.el, { className: 'shell-pause-wrap', onClose: () => this._onClosed() });
    this._openedAt = performance.now();
    if (ctxName === 'game') {
      ctx.loop.paused = true;
      this._idleRender(true);
      ctx.events.emit('pause', { open: true });
    }
    uiSound(ctx, 'ui.open');
    this.show(this.tab);
    requestAnimationFrame(() => this.el?.querySelector('.shell-nav-item.is-active, .shell-nav-item')?.focus({ preventScroll: true }));
  }

  /** Closes the menu; `resume` re-grabs the mouse (needs a user gesture). */
  close({ resume = false, keepPaused = false } = {}) {
    if (!this.isOpen) return;
    this._keepPaused = keepPaused;
    this.ctx.ui.closeModal(MODAL_ID);
    if (resume && this.ctx.input.wantsPointerLock) this.ctx.input.requestPointerLock();
  }

  /**
   * While the world is frozen behind the pause menu there is nothing new to
   * draw: render only the first frames and on demand (resize, quality change)
   * instead of re-rendering the same image 60×/s. Wraps loop.render and
   * restores the original on close.
   */
  _idleRender(on) {
    const ctx = this.ctx;
    const loop = ctx.loop;
    if (on) {
      if (this._origRender || typeof loop.render !== 'function') return;
      const orig = loop.render;
      let force = 3;
      const wrapper = (dt, t) => {
        if (force <= 0) return;
        force--;
        orig(dt, t);
      };
      wrapper.shellIdle = true;
      this._origRender = orig;
      loop.render = wrapper;
      const kick = () => (force = Math.max(force, 2));
      this._idleOffs = [ctx.events.on('resize', kick), ctx.events.on('quality:change', kick), ctx.events.on('mode:change', kick)];
      this.kickRender = kick;
    } else {
      if (loop.render?.shellIdle && this._origRender) loop.render = this._origRender;
      this._origRender = null;
      this._idleOffs?.forEach((off) => off());
      this._idleOffs = null;
      this.kickRender = null;
    }
  }

  /** Safety net (called every frame): never leave rendering idle without the menu. */
  watchdog() {
    if (this._origRender && !this.isOpen) this._idleRender(false);
  }

  _onClosed() {
    const ctx = this.ctx;
    this._settings?.dispose?.();
    this._settings = null;
    this._idleRender(false);
    if (this.context === 'game') {
      if (!this._keepPaused) ctx.loop.paused = false;
      ctx.events.emit('pause', { open: false });
    }
    this._keepPaused = false;
    uiSound(ctx, 'ui.close');
    this.el = null;
  }

  // ------------------------------------------------------------------ build
  _build() {
    const ctx = this.ctx;
    const h = ctx.ui.h;
    const game = this.context === 'game';
    const inSpace = ctx.modes.is('space');
    const items = game
      ? [
          { id: 'resume', label: TXT.resume, icon: 'play', primary: true },
          { id: 'overview', label: TXT.overview, icon: 'shell-route' },
          { id: 'settings', label: TXT.settings, icon: 'settings' },
          { id: 'controls', label: TXT.controls, icon: 'keyboard' },
          { id: 'about', label: TXT.about, icon: 'info' },
          inSpace ? null : { id: 'map', label: TXT.map, icon: 'map' },
          { sep: true },
          { id: 'title', label: { en: 'Back to title screen', nl: 'Terug naar titelscherm' }, icon: 'shell-exit' },
          { id: 'reset', label: TXT.reset, icon: 'trash', danger: true },
        ]
      : [
          { id: 'settings', label: TXT.settings, icon: 'settings' },
          { id: 'controls', label: TXT.controls, icon: 'keyboard' },
          { id: 'about', label: TXT.about, icon: 'info' },
          { sep: true },
          { id: 'reset', label: TXT.reset, icon: 'trash', danger: true },
          { id: 'close', label: TXT.close, icon: 'close' },
        ];

    this.content = h('div', { class: 'shell-menu-content scroll' });
    const nav = h(
      'nav',
      { class: 'shell-menu-nav', 'aria-label': game ? t({ en: 'Pause menu', nl: 'Pauzemenu' }) : t(TXT.settings) },
      h(
        'div',
        { class: 'shell-menu-brand' },
        h('span', { html: logoMarkSVG({ size: 30, stroke: 5 }) }),
        h('span', { class: 'shell-menu-brand-word', text: 'UNIVERSE' }),
      ),
      h('div', { class: 'shell-menu-caption', text: game ? t({ en: 'Paused', nl: 'Gepauzeerd' }) : t({ en: 'Menu', nl: 'Menu' }) }),
      h(
        'div',
        { class: 'shell-menu-items' },
        items.filter(Boolean).map((it) =>
          it.sep
            ? h('div', { class: 'shell-nav-sep' })
            : h(
                'button',
                {
                  class: `shell-nav-item${it.primary ? ' is-primary' : ''}${it.danger ? ' is-danger' : ''}`,
                  type: 'button',
                  dataset: { item: it.id },
                  onclick: () => this._select(it.id),
                  onmouseenter: () => uiSound(ctx, 'ui.hover'),
                },
                h('span', { class: 'shell-nav-icon', html: icon(it.icon, 18) }),
                h('span', { class: 'shell-nav-label', text: t(it.label) }),
              ),
        ),
      ),
      h('div', { class: 'shell-menu-foot' }, h('span', { class: 'kbd shell-kbd', text: 'Esc' }), h('span', { text: game ? t({ en: 'Keep playing', nl: 'Verder spelen' }) : t(TXT.close) })),
    );
    this.el = h('div', { class: `shell-menu is-${this.context}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': game ? t({ en: 'Pause', nl: 'Pauze' }) : t(TXT.settings) }, nav, this.content);
  }

  _select(id) {
    const ctx = this.ctx;
    uiSound(ctx, 'ui.click');
    switch (id) {
      case 'resume':
        this.close({ resume: true });
        break;
      case 'close':
        this.close();
        break;
      case 'map':
        this.shell.map?.open({ from: 'pause' });
        break;
      case 'title':
        this.close({ keepPaused: true });
        this.shell.goToTitle();
        break;
      default:
        this.show(id);
    }
  }

  /** Shows a tab: overview | settings | controls | about | reset. */
  show(tab) {
    if (!this.el) return;
    const ctx = this.ctx;
    const h = ctx.ui.h;
    this.tab = tab;
    for (const b of this.el.querySelectorAll('.shell-nav-item')) b.classList.toggle('is-active', b.dataset.item === tab);
    this._settings?.dispose?.();
    this._settings = null;
    let head = null;
    let body = null;
    if (tab === 'settings') {
      head = [TXT.settings, { en: 'Language, graphics, sound, controls and game. Changes are applied and saved right away.', nl: 'Taal, beeld, geluid, besturing en spel. Wijzigingen worden direct toegepast en bewaard.' }];
      this._settings = settingsPanel(ctx, this.shell.settings);
      body = this._settings.el;
    } else if (tab === 'controls') {
      head = [TXT.controls, { en: 'Every key at a glance. Press H in the game to open this help.', nl: 'Alle toetsen op een rij. Druk in het spel op H voor deze hulp.' }];
      body = controlsPanel(ctx, { mode: ctx.modes.is('title') ? null : ctx.modes.name });
    } else if (tab === 'about') {
      head = [TXT.about, { en: 'Complete freedom in a dynamic, online world.', nl: 'Volledige vrijheid in een dynamische, online wereld.' }];
      body = aboutPanel(ctx);
    } else if (tab === 'reset') {
      head = [TXT.reset, { en: 'Start over from scratch.', nl: 'Begin helemaal opnieuw.' }];
      body = this._resetPanel();
    } else {
      head = [TXT.overview, { en: 'Your adventure so far.', nl: 'Je avontuur tot nu toe.' }];
      body = this._overview();
    }
    const view = h(
      'div',
      { class: 'shell-tab', dataset: { tab } },
      h('header', { class: 'shell-tab-head' }, h('h2', { class: 'shell-tab-title', text: t(head[0]) }), h('p', { class: 'shell-tab-sub', text: t(head[1]) })),
      body,
    );
    this.content.replaceChildren(view);
    this.content.scrollTop = 0;
  }

  // ------------------------------------------------------------- overview
  _overview() {
    const ctx = this.ctx;
    const h = ctx.ui.h;
    const st = ctx.state;
    const zoneId = this.shell.currentZone?.() || st.get('player.zone');
    const here = place(zoneId);
    const inSpace = ctx.modes.is('space');
    const where = inSpace ? t({ en: 'In space', nl: 'In de ruimte' }) : here?.label || t({ en: 'Out exploring', nl: 'Onderweg' });
    const desc = inSpace
      ? t({ en: 'You are flying among the stars above the planet.', nl: 'Je vliegt tussen de sterren boven de planeet.' })
      : here?.desc || t({ en: 'Somewhere in the open world of Ø.', nl: 'Ergens in de open wereld van Ø.' });

    let questTitle = null;
    try {
      const a = ctx.quests?.active;
      const q = typeof a === 'string' ? ctx.quests?.get?.(a) : a;
      // t(): quest titles are strings, but resolve { en, nl } too, just in case
      questTitle = t(q?.title || q?.name || (typeof a === 'string' ? a : '')) || null;
    } catch {
      questTitle = null;
    }

    const stat = (iconName, label, value) =>
      h('div', { class: 'shell-stat' }, h('span', { class: 'shell-stat-icon', html: icon(iconName, 18) }), h('div', null, h('div', { class: 'shell-stat-value num', text: value }), h('div', { class: 'shell-stat-label', text: t(label) })));

    const level = st.get('progress.level', 1);
    const xp = st.get('progress.xp', 0);
    const discovered = (st.get('progress.discovered') || []).length;
    const zonesTotal = Object.keys(ZONES).length;
    return h(
      'div',
      { class: 'shell-overview' },
      h(
        'div',
        { class: 'shell-ov-here' },
        h('div', { class: 'shell-ov-here-icon', html: icon(inSpace ? 'rocket' : 'pin', 22) }),
        h('div', null, h('div', { class: 'shell-ov-here-k', text: t({ en: 'Current location', nl: 'Huidige locatie' }) }), h('div', { class: 'shell-ov-here-name', text: where }), h('p', { class: 'shell-ov-here-desc', text: desc })),
      ),
      questTitle
        ? h('div', { class: 'shell-ov-quest' }, h('span', { html: icon('quest', 18) }), h('span', { class: 'shell-ov-quest-k', text: t({ en: 'Active mission', nl: 'Actieve missie' }) }), h('span', { class: 'shell-ov-quest-name', text: questTitle }))
        : null,
      h(
        'div',
        { class: 'shell-stats' },
        stat('star', { en: 'Level', nl: 'Niveau' }, `${level}`),
        stat('sparkle', { en: 'Experience', nl: 'Ervaring' }, `${formatNumber(xp)} XP`),
        stat('coin', 'Ø-credits', formatNumber(st.get('credits', 0))),
        stat('shell-clock', { en: 'Playtime', nl: 'Speeltijd' }, formatDuration(st.get('stats.playtime', 0) + (ctx._playtime || 0))),
        stat('shell-route', { en: 'Distance travelled', nl: 'Afgelegd' }, formatDistance(st.get('stats.distance', 0))),
        stat('pin', { en: 'Discovered', nl: 'Ontdekt' }, `${discovered} / ${zonesTotal}`),
      ),
      h(
        'div',
        { class: 'shell-ov-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.close({ resume: true }) }, h('span', { html: icon('play', 16) }), t(TXT.resume)),
        inSpace ? null : h('button', { class: 'btn', type: 'button', onclick: () => this.shell.map?.open({ from: 'pause' }) }, h('span', { html: icon('map', 16) }), t(TXT.map)),
      ),
    );
  }

  // ---------------------------------------------------------------- reset
  _resetPanel() {
    const ctx = this.ctx;
    const h = ctx.ui.h;
    return h(
      'div',
      { class: 'shell-reset' },
      h('div', { class: 'shell-reset-icon', html: icon('trash', 30) }),
      h('p', {
        class: 'shell-reset-text',
        text: t({
          en: 'Are you sure? All your progress will be erased for good: missions, discovered locations, buildings, resources, Ø-credits, your character and your settings.',
          nl: 'Weet je het zeker? Al je voortgang wordt definitief gewist: missies, ontdekte locaties, gebouwen, grondstoffen, Ø-credits, je personage en je instellingen.',
        }),
      }),
      h('p', { class: 'shell-reset-note', text: t({ en: 'This cannot be undone. The game will restart afterwards.', nl: 'Dit kan niet ongedaan worden gemaakt. Het spel start daarna opnieuw op.' }) }),
      h(
        'div',
        { class: 'shell-reset-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => this.show(this.context === 'game' ? 'overview' : 'settings') }, t({ en: 'Cancel', nl: 'Annuleren' })),
        h('button', { class: 'btn shell-btn-danger', type: 'button', onclick: () => this.shell.wipeProgress() }, h('span', { html: icon('trash', 16) }), t({ en: 'Yes, erase everything', nl: 'Ja, wis alles' })),
      ),
    );
  }
}
