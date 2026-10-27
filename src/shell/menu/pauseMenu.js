/**
 * Pause / settings menu (modal 'shell-pause'). In-game ('game' context, from
 * explore/drive/space) it pauses the loop and offers: Hervatten, Instellingen,
 * Besturing, Over Ø Universe, Wereldkaart, Terug naar titelscherm, Voortgang
 * wissen. From the title screen ('title' context) it is the settings dialog.
 * Emits `pause` {open} for the in-game variant.
 */
import { icon } from '../../ui/icons.js';
import { ZONES } from '../../world/layout.js';
import { place } from '../data.js';
import { logoMarkSVG, formatDuration, formatDistance, formatNumber, uiSound } from '../util.js';
import { settingsPanel, controlsPanel, aboutPanel } from './panels.js';

const MODAL_ID = 'shell-pause';

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
          { id: 'resume', label: 'Hervatten', icon: 'play', primary: true },
          { id: 'overview', label: 'Overzicht', icon: 'shell-route' },
          { id: 'settings', label: 'Instellingen', icon: 'settings' },
          { id: 'controls', label: 'Besturing', icon: 'keyboard' },
          { id: 'about', label: 'Over Ø Universe', icon: 'info' },
          inSpace ? null : { id: 'map', label: 'Wereldkaart', icon: 'map' },
          { sep: true },
          { id: 'title', label: 'Terug naar titelscherm', icon: 'shell-exit' },
          { id: 'reset', label: 'Voortgang wissen', icon: 'trash', danger: true },
        ]
      : [
          { id: 'settings', label: 'Instellingen', icon: 'settings' },
          { id: 'controls', label: 'Besturing', icon: 'keyboard' },
          { id: 'about', label: 'Over Ø Universe', icon: 'info' },
          { sep: true },
          { id: 'reset', label: 'Voortgang wissen', icon: 'trash', danger: true },
          { id: 'close', label: 'Sluiten', icon: 'close' },
        ];

    this.content = h('div', { class: 'shell-menu-content scroll' });
    const nav = h(
      'nav',
      { class: 'shell-menu-nav', 'aria-label': game ? 'Pauzemenu' : 'Instellingen' },
      h(
        'div',
        { class: 'shell-menu-brand' },
        h('span', { html: logoMarkSVG({ size: 30, stroke: 5 }) }),
        h('span', { class: 'shell-menu-brand-word', text: 'UNIVERSE' }),
      ),
      h('div', { class: 'shell-menu-caption', text: game ? 'Gepauzeerd' : 'Menu' }),
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
                h('span', { class: 'shell-nav-label', text: it.label }),
              ),
        ),
      ),
      h('div', { class: 'shell-menu-foot' }, h('span', { class: 'kbd shell-kbd', text: 'Esc' }), h('span', { text: game ? 'Verder spelen' : 'Sluiten' })),
    );
    this.el = h('div', { class: `shell-menu is-${this.context}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': game ? 'Pauze' : 'Instellingen' }, nav, this.content);
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
      head = ['Instellingen', 'Beeld, geluid, besturing en spel. Wijzigingen worden direct toegepast en bewaard.'];
      this._settings = settingsPanel(ctx, this.shell.settings);
      body = this._settings.el;
    } else if (tab === 'controls') {
      head = ['Besturing', 'Alle toetsen op een rij. Druk in het spel op H voor deze hulp.'];
      body = controlsPanel(ctx, { mode: ctx.modes.is('title') ? null : ctx.modes.name });
    } else if (tab === 'about') {
      head = ['Over Ø Universe', 'Volledige vrijheid in een dynamische, online wereld.'];
      body = aboutPanel(ctx);
    } else if (tab === 'reset') {
      head = ['Voortgang wissen', 'Begin helemaal opnieuw.'];
      body = this._resetPanel();
    } else {
      head = ['Overzicht', 'Je avontuur tot nu toe.'];
      body = this._overview();
    }
    const view = h(
      'div',
      { class: 'shell-tab', dataset: { tab } },
      h('header', { class: 'shell-tab-head' }, h('h2', { class: 'shell-tab-title', text: head[0] }), h('p', { class: 'shell-tab-sub', text: head[1] })),
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
    const where = inSpace ? 'In de ruimte' : here?.label || 'Onderweg';
    const desc = inSpace ? 'Je vliegt tussen de sterren boven de planeet.' : here?.desc || 'Ergens in de open wereld van Ø.';

    let questTitle = null;
    try {
      const a = ctx.quests?.active;
      const q = typeof a === 'string' ? ctx.quests?.get?.(a) : a;
      questTitle = q?.title || q?.name || (typeof a === 'string' ? a : null);
    } catch {
      questTitle = null;
    }

    const stat = (iconName, label, value) =>
      h('div', { class: 'shell-stat' }, h('span', { class: 'shell-stat-icon', html: icon(iconName, 18) }), h('div', null, h('div', { class: 'shell-stat-value num', text: value }), h('div', { class: 'shell-stat-label', text: label })));

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
        h('div', null, h('div', { class: 'shell-ov-here-k', text: 'Huidige locatie' }), h('div', { class: 'shell-ov-here-name', text: where }), h('p', { class: 'shell-ov-here-desc', text: desc })),
      ),
      questTitle
        ? h('div', { class: 'shell-ov-quest' }, h('span', { html: icon('quest', 18) }), h('span', { class: 'shell-ov-quest-k', text: 'Actieve missie' }), h('span', { class: 'shell-ov-quest-name', text: questTitle }))
        : null,
      h(
        'div',
        { class: 'shell-stats' },
        stat('star', 'Niveau', `${level}`),
        stat('sparkle', 'Ervaring', `${formatNumber(xp)} XP`),
        stat('coin', 'Ø-credits', formatNumber(st.get('credits', 0))),
        stat('shell-clock', 'Speeltijd', formatDuration(st.get('stats.playtime', 0) + (ctx._playtime || 0))),
        stat('shell-route', 'Afgelegd', formatDistance(st.get('stats.distance', 0))),
        stat('pin', 'Ontdekt', `${discovered} / ${zonesTotal}`),
      ),
      h(
        'div',
        { class: 'shell-ov-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.close({ resume: true }) }, h('span', { html: icon('play', 16) }), 'Hervatten'),
        inSpace ? null : h('button', { class: 'btn', type: 'button', onclick: () => this.shell.map?.open({ from: 'pause' }) }, h('span', { html: icon('map', 16) }), 'Wereldkaart'),
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
      h('p', { class: 'shell-reset-text', text: 'Weet je het zeker? Al je voortgang wordt definitief gewist: missies, ontdekte locaties, gebouwen, grondstoffen, Ø-credits, je personage en je instellingen.' }),
      h('p', { class: 'shell-reset-note', text: 'Dit kan niet ongedaan worden gemaakt. Het spel start daarna opnieuw op.' }),
      h(
        'div',
        { class: 'shell-reset-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => this.show(this.context === 'game' ? 'overview' : 'settings') }, 'Annuleren'),
        h('button', { class: 'btn shell-btn-danger', type: 'button', onclick: () => this.shell.wipeProgress() }, h('span', { html: icon('trash', 16) }), 'Ja, wis alles'),
      ),
    );
  }
}
