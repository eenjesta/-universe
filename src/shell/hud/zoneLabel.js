/**
 * "You are here" label (top-left, explore/drive): pin icon + place name
 * ("Nexus Plaza"), shown for a few seconds when entering a zone or region.
 * Listens to `player:zone` and also detects zones itself from the layout,
 * de-duplicated, so it works even when the characters module is a fallback.
 */
import { icon } from '../../ui/icons.js';
import { t } from '../../core/i18n.js';
import { LABEL_PLACES, place } from '../data.js';

const SHOW_MS = 5600;
const REPEAT_COOLDOWN = 25; // s before the same place is announced again

export class ZoneLabel {
  constructor(ctx, frame) {
    this.ctx = ctx;
    this.frame = frame;
    const h = ctx.ui.h;
    this.iconEl = h('span', { class: 'shell-zone-icon', html: icon('pin', 18) });
    this.nameEl = h('span', { class: 'shell-zone-name' });
    this.subEl = h('span', { class: 'shell-zone-sub' });
    this.el = h(
      'div',
      { class: 'shell-zone', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'shell-zone-inner' }, this.iconEl, h('div', { class: 'shell-zone-text' }, this.nameEl, this.subEl)),
    );
    ctx.ui.addWidget('top-left', this.el, { modes: ['explore', 'drive'], order: 5 });
    ctx.ui.setVisible(this.el, false);
    this.current = undefined; // undefined = not detected yet, null = wilderness
    this.lastShown = new Map();
    this._timer = null;
    this._acc = 0;
    ctx.events.on('player:zone', (p) => {
      const id = typeof p?.zone === 'object' ? p.zone?.id : p?.zone;
      this._enter(id || null);
    });
    ctx.events.on('mode:change', ({ to, from }) => {
      // announce the start location after a fast travel / new session
      if (to === 'explore' && from !== 'drive') {
        this.current = undefined;
        this.lastShown.clear();
      }
    });
  }

  /** Public: show any text (e.g. "Your Base — Level 3"); strings or { en, nl }. */
  show(name, { iconName = 'pin', sub = '' } = {}) {
    const ui = this.ctx.ui;
    this.iconEl.innerHTML = icon(iconName, 18);
    this.nameEl.textContent = t(name);
    sub = t(sub);
    this.subEl.textContent = sub;
    this.subEl.hidden = !sub;
    clearTimeout(this._timer);
    clearTimeout(this._hideTimer);
    this.el.classList.remove('is-on');
    ui.setVisible(this.el, true); // takes space in the slot only while shown
    void this.el.offsetWidth; // restart the entrance transition
    this.el.classList.add('is-on');
    this._timer = setTimeout(() => {
      this.el.classList.remove('is-on');
      this._hideTimer = setTimeout(() => ui.setVisible(this.el, false), 640);
    }, SHOW_MS);
  }

  _enter(id) {
    if (id === this.current) return;
    this.current = id;
    if (!id) return;
    const p = place(id);
    if (!p) return;
    const now = this.ctx.loop.realTime;
    if (now - (this.lastShown.get(id) ?? -1e9) < REPEAT_COOLDOWN) return;
    this.lastShown.set(id, now);
    const level = this.ctx.state.get('progress.level');
    const sub = id === 'base' && level > 1 ? t({ en: 'Level {n}', nl: 'Niveau {n}' }, { n: level }) : '';
    this.show(p.label, { iconName: id === 'base' ? 'home' : 'pin', sub });
  }

  /** Own zone detection (4×/s), smallest containing place wins. */
  update(dt) {
    this._acc += dt;
    if (this._acc < 0.25) return;
    this._acc = 0;
    if (!this.ctx.modes.is('explore', 'drive') || this.ctx.modes.transitioning) return;
    const { x, z } = this.frame.focus;
    let found = null;
    for (const p of LABEL_PLACES) {
      if (p.rect) {
        if (x >= p.rect.minX && x <= p.rect.maxX && z >= p.rect.minZ && z <= p.rect.maxZ) {
          found = p.id;
          break;
        }
      } else if (Math.hypot(x - p.x, z - p.z) <= p.radius) {
        found = p.id;
        break;
      }
    }
    this._enter(found);
  }

  /** Place id the shell currently considers "here" (or null). */
  get zone() {
    return this.current ?? null;
  }
}
