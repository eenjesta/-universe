/**
 * Title screen UI in the poster layout: Ø UNIVERSE logo, motto, tagline,
 * "A BRIGHTER TOMORROW.", the menu (Play/Continue · Character · Settings),
 * the four pillars panel on the right and the "Gameplay overview" cards with
 * live thumbnails at the bottom. Handles the staged reveal, including the
 * logo hand-off from the boot screen (FLIP). Text is resolved when built.
 */
import { icon } from '../../ui/icons.js';
import { t, pick } from '../../core/i18n.js';
import { ZONES } from '../../world/layout.js';
import { PILLARS, CARDS, TAGLINE_LINES, MOTTO, BRIGHTER, VERSION, place } from '../data.js';
import { logoMarkSVG, formatDuration, uiSound } from '../util.js';

export class TitleScreen {
  constructor(ctx, shell, thumbs) {
    this.ctx = ctx;
    this.shell = shell;
    this.thumbs = thumbs;
    this.el = null;
    this._busy = false;
  }

  get mounted() {
    return !!this.el;
  }

  /** intro: 'long' (boot, with logo hand-off) | 'short' | false */
  mount({ intro = 'short' } = {}) {
    const ctx = this.ctx;
    this.unmount(true);
    this.el = this._build();
    this.el.classList.add(intro === 'long' ? 'is-long' : 'is-short');
    ctx.ui.showScreen('title', this.el);
    this._busy = false;
    const boot = document.getElementById('boot');
    const flip = intro === 'long' && boot && !boot.classList.contains('done') ? this._prepareFlip(boot) : false;
    if (flip) {
      // the reveal starts when the core begins fading the boot overlay
      ctx.events.once('game:ready', () => this._reveal(true));
      // safety net if game:ready already happened / never comes
      this._flipTimer = setTimeout(() => this._reveal(true), 12000);
    } else requestAnimationFrame(() => requestAnimationFrame(() => this._reveal(false)));
    this._loadThumbs();
  }

  unmount(immediate = false) {
    if (!this.el) return;
    clearTimeout(this._flipTimer);
    if (immediate) {
      this.el.remove();
    } else this.ctx.ui.hideScreen('title');
    this.el = null;
  }

  /**
   * The part of the viewport the title UI leaves open for the 3D scene:
   * { right, bottom } as fractions (left of the pillars panel, above the
   * cards band). Layout offsets ignore the reveal transforms; cached briefly.
   */
  sceneFrame() {
    const now = performance.now();
    if (this._frame && now - this._frameAt < 400) return this._frame;
    this._frameAt = now;
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    let right = 1;
    let bottom = 1;
    const pil = this.el?.querySelector('.shell-pillars');
    if (pil && pil.offsetWidth > 0) right = pil.offsetLeft / W;
    const ov = this.el?.querySelector('.shell-overview');
    if (ov && ov.offsetHeight > 0) bottom = ov.offsetTop / H;
    if (!this.el && this._frame) return this._frame;
    this._frame = { right: Math.min(1, Math.max(0.5, right)), bottom: Math.min(1, Math.max(0.45, bottom)) };
    return this._frame;
  }

  refreshMenu() {
    if (!this.el) return;
    const fresh = this._menu();
    this.el.querySelector('.shell-tmenu')?.replaceWith(fresh);
    if (this.el.classList.contains('is-in')) fresh.classList.add('is-ready');
  }

  // -------------------------------------------------------------- build
  _build() {
    const h = this.ctx.ui.h;
    let d = 0;
    const rv = (el, delay) => {
      el.classList.add('shell-rv');
      el.style.setProperty('--d', `${delay}s`);
      return el;
    };
    const letters = 'UNIVERSE'.split('').map((ch, i) => {
      const s = h('span', { class: 'shell-logo-ch', text: ch });
      s.style.setProperty('--i', String(i));
      return s;
    });
    const logo = h(
      'h1',
      { class: 'shell-logo', 'aria-label': 'Ø Universe' },
      h('span', { class: 'shell-logo-mark', html: logoMarkSVG({ size: 100, stroke: 4.4 }) }),
      h('span', { class: 'shell-logo-word', 'aria-hidden': 'true' }, letters),
    );
    const [l1, l2] = pick(TAGLINE_LINES);
    const brand = h(
      'header',
      { class: 'shell-brand' },
      logo,
      rv(h('div', { class: 'shell-motto', text: MOTTO }), (d = 0.55)),
      rv(h('p', { class: 'shell-tagline' }, `${l1} `, h('br', { class: 'shell-br' }), l2), (d += 0.18)),
      rv(h('div', { class: 'shell-rule' }), (d += 0.16)),
      rv(h('div', { class: 'shell-brighter', text: BRIGHTER }), (d += 0.12)),
    );
    this.menuEl = this._menu();

    const pillars = h(
      'aside',
      { class: 'shell-pillars', 'aria-label': t({ en: 'Ø Universe at a glance', nl: 'Ø Universe in het kort' }) },
      PILLARS.map((p, i) =>
        rv(
          h(
            'div',
            { class: 'shell-pillar' },
            h('span', { class: 'shell-pillar-icon', html: icon(p.icon, 34) }),
            h('div', { class: 'shell-pillar-body' }, h('div', { class: 'shell-pillar-title', text: t(p.title) }), h('div', { class: 'shell-pillar-text', text: t(p.text) })),
          ),
          0.5 + i * 0.12,
        ),
      ),
    );

    this.cardEls = new Map();
    const cards = h('div', { class: 'shell-cards' });
    CARDS.forEach((def, i) => {
      const c = { ...def, title: t(def.title), text: t(def.text), cta: t(def.cta) };
      if (i) cards.appendChild(rv(h('span', { class: 'shell-chev', 'aria-hidden': 'true', html: icon('chevron-right', 22) }), 1.05 + i * 0.11));
      const media = h('div', { class: 'shell-card-media' }, h('div', { class: `shell-card-ph shell-card-ph-${c.id}`, html: icon(['shell-mountain', 'cube', 'people', 'rocket'][i], 30) }));
      const card = h(
        'button',
        {
          class: 'shell-card',
          type: 'button',
          dataset: { card: c.id },
          'aria-label': `${c.n}. ${c.title}: ${c.text}`,
          onclick: () => this._action(`card:${c.id}`),
          onmouseenter: () => uiSound(this.ctx, 'ui.hover'),
        },
        media,
        h('div', { class: 'shell-card-shade' }),
        h(
          'div',
          { class: 'shell-card-body' },
          h('span', { class: 'shell-card-num', text: String(c.n) }),
          h('div', { class: 'shell-card-copy' }, h('div', { class: 'shell-card-title', text: c.title }), h('div', { class: 'shell-card-text', text: c.text })),
        ),
        h('div', { class: 'shell-card-cta' }, h('span', { text: c.cta }), h('span', { html: icon('chevron-right', 14) })),
      );
      this.cardEls.set(c.id, { el: card, media, thumb: c.thumb });
      cards.appendChild(rv(card, 0.95 + i * 0.11));
    });

    const overview = h(
      'section',
      { class: 'shell-overview', 'aria-label': 'Gameplay overview' },
      rv(
        h(
          'header',
          { class: 'shell-ov-head' },
          h('h2', { class: 'shell-ov-title', text: 'Gameplay overview' }),
          h('p', { class: 'shell-ov-sub', text: t({ en: 'Complete freedom in a dynamic, online world.', nl: 'Volledige vrijheid in een dynamische, online wereld.' }) }),
        ),
        0.85,
      ),
      cards,
    );

    return h(
      'div',
      { class: 'shell-title' },
      h('div', { class: 'shell-title-scrim' }),
      h('div', { class: 'shell-title-main' }, brand, this.menuEl),
      pillars,
      overview,
      rv(h('div', { class: 'shell-version', text: VERSION }), 1.6),
    );
  }

  _menu() {
    const ctx = this.ctx;
    const h = ctx.ui.h;
    const resume = this.shell.hasProgress();
    const st = ctx.state;
    const sub = resume
      ? [
          place(st.get('player.zone'))?.label || ZONES.spawn.label,
          t({ en: 'Level {n}', nl: 'Niveau {n}' }, { n: st.get('progress.level', 1) }),
          formatDuration(st.get('stats.playtime', 0)),
        ].join(' · ')
      : t({ en: 'Create your character and step into the world', nl: 'Maak je personage en stap de wereld in' });
    const item = (id, label, iconName, extra = {}) =>
      h(
        'button',
        {
          class: `shell-tmenu-item${extra.primary ? ' is-primary' : ''}`,
          type: 'button',
          dataset: { action: id },
          onclick: () => this._action(id),
          onmouseenter: (e) => {
            uiSound(ctx, 'ui.hover');
            e.currentTarget.focus({ preventScroll: true });
          },
        },
        h('span', { class: 'shell-tmenu-icon', html: icon(iconName, extra.primary ? 18 : 16) }),
        h('span', { class: 'shell-tmenu-text' }, h('span', { class: 'shell-tmenu-label', text: t(label) }), extra.sub ? h('span', { class: 'shell-tmenu-sub', text: extra.sub }) : null),
      );
    const nav = h(
      'nav',
      { class: 'shell-tmenu', 'aria-label': t({ en: 'Main menu', nl: 'Hoofdmenu' }) },
      item('play', resume ? { en: 'Continue', nl: 'Doorgaan' } : { en: 'Play', nl: 'Speel' }, 'play', { primary: true, sub }),
      item('character', { en: 'Character', nl: 'Karakter' }, 'user'),
      item('settings', { en: 'Settings', nl: 'Instellingen' }, 'settings'),
    );
    nav.addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
      const items = [...nav.querySelectorAll('.shell-tmenu-item')];
      const i = items.indexOf(document.activeElement);
      const next = items[(i + (e.code === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      next?.focus();
      e.preventDefault();
    });
    nav.querySelectorAll('.shell-tmenu-item').forEach((el, i) => {
      el.classList.add('shell-rv');
      el.style.setProperty('--d', `${1.15 + i * 0.1}s`);
    });
    return nav;
  }

  async _action(id) {
    if (this._busy || this.ctx.modes.transitioning) return;
    uiSound(this.ctx, 'ui.click');
    if (id === 'settings') {
      this.shell.pause.open({ context: 'title', tab: 'settings' });
      return;
    }
    this._busy = true;
    this.el?.classList.add('is-leaving');
    try {
      await this.shell.titleAction(id);
    } finally {
      this._busy = false;
      this.el?.classList.remove('is-leaving');
    }
  }

  // ----------------------------------------------------------- thumbnails
  _loadThumbs() {
    for (const [, c] of this.cardEls) {
      this.thumbs.request(c.thumb, (canvas) => {
        if (!canvas || !this.el || !c.media.isConnected) return;
        canvas.classList.add('shell-card-img');
        c.media.appendChild(canvas);
        requestAnimationFrame(() => c.el.classList.add('has-thumb'));
      });
    }
  }

  // ---------------------------------------------------------------- reveal
  /** Positions the logo over the boot logo so it can glide into place. */
  _prepareFlip(boot) {
    try {
      const src = boot.querySelector('.boot-logo');
      const logo = this.el.querySelector('.shell-logo');
      if (!src || !logo) return false;
      const a = src.getBoundingClientRect();
      const b = logo.getBoundingClientRect();
      if (!a.width || !b.width) return false;
      const s = a.width / b.width;
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      logo.style.transformOrigin = '50% 50%';
      logo.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      this.el.classList.add('is-flip');
      this._bootLogo = src;
      return true;
    } catch {
      return false;
    }
  }

  _reveal(flip) {
    if (!this.el || this.el.classList.contains('is-in')) return;
    clearTimeout(this._flipTimer);
    const logo = this.el.querySelector('.shell-logo');
    if (flip && logo) {
      if (this._bootLogo) this._bootLogo.style.opacity = '0';
      // let the boot overlay start fading, then glide the logo into place
      void logo.offsetWidth;
      logo.style.transition = 'transform 1.7s cubic-bezier(0.65, 0, 0.2, 1)';
      logo.style.transform = 'none';
      setTimeout(() => {
        if (logo.isConnected) logo.style.transition = '';
      }, 1900);
    }
    this.el.classList.add('is-in');
    setTimeout(() => {
      if (!this.el) return;
      this.el.querySelector('.shell-tmenu')?.classList.add('is-ready');
      const primary = this.el.querySelector('.shell-tmenu-item.is-primary');
      if (primary && !this.ctx.ui.isModalOpen()) primary.focus({ preventScroll: true });
    }, flip ? 1900 : 900);
  }
}
