import { Vector3 } from 'three';
import { icon } from '../ui/icons.js';
import { t } from './i18n.js';

/**
 * DOM UI facade shared by every module. Layers (index.html):
 *   #hud      in-game widgets (pointer-events off except on widgets)
 *   #screens  full-screen screens (title, customize)
 *   #modals   blocking dialogs (pause, dialogue, market, garage, journal)
 *   #toasts   notifications
 *   #fade     black fade for transitions
 *
 * HUD widgets are mounted into named slots so modules never fight over layout:
 *   ui.addWidget('top-left', el, { modes: ['explore', 'drive'], order: 10 })
 * Slots: top-left, top-center, top-right, left, right, bottom-left,
 *        bottom-center, bottom-right, center.
 * A widget is visible only while the current mode is in `modes` (omit = always)
 * and `el.dataset.hidden !== 'true'` (use ui.setVisible(el, bool) for manual toggles).
 */
export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.layers = {
      hud: document.getElementById('hud'),
      screens: document.getElementById('screens'),
      modals: document.getElementById('modals'),
      toasts: document.getElementById('toasts'),
      fade: document.getElementById('fade'),
    };
    this.slots = {};
    this.widgets = [];
    this.modals = []; // stack of {id, el, opts}
    this.escapeStack = [];
    this.prompt = new Prompts(this);
    this.icon = icon;

    ctx.events.on('mode:change', () => this.refreshWidgets());
    window.addEventListener('keydown', (e) => this._onKey(e), true);
  }

  // ------------------------------------------------------------ helpers
  /**
   * Hyperscript helper: h('div', { class: 'panel', onclick, style: {…}, html }, ...children)
   * Children may be nodes, strings, arrays, null/false (skipped).
   */
  h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  }

  // ------------------------------------------------------------ widgets
  slot(name) {
    if (!this.slots[name]) {
      const el = this.h('div', { class: `hud-slot hud-slot-${name}` });
      this.layers.hud.appendChild(el);
      this.slots[name] = el;
    }
    return this.slots[name];
  }

  addWidget(slotName, el, { modes = null, order = 0 } = {}) {
    el.classList.add('hud-widget');
    el.dataset.order = order;
    const slot = this.slot(slotName);
    const siblings = [...slot.children].filter((c) => Number(c.dataset.order) > order);
    if (siblings.length) slot.insertBefore(el, siblings[0]);
    else slot.appendChild(el);
    const w = { el, modes, slot: slotName };
    this.widgets.push(w);
    this._applyWidget(w);
    return el;
  }

  removeWidget(el) {
    const i = this.widgets.findIndex((w) => w.el === el);
    if (i >= 0) this.widgets.splice(i, 1);
    el.remove();
  }

  setVisible(el, visible) {
    el.dataset.hidden = visible ? 'false' : 'true';
    const w = this.widgets.find((x) => x.el === el);
    if (w) this._applyWidget(w);
    else el.hidden = !visible;
  }

  refreshWidgets() {
    this.widgets.forEach((w) => this._applyWidget(w));
  }

  _applyWidget(w) {
    const mode = this.ctx.modes?.name;
    const inMode = !w.modes || w.modes.includes(mode);
    w.el.hidden = !inMode || w.el.dataset.hidden === 'true';
  }

  // ------------------------------------------------------------- toasts
  /**
   * toast({ title, text, icon: 'check', kind: 'info'|'success'|'quest'|'warn'|'error'|'reward', duration })
   */
  toast({ title = '', text = '', icon: iconName = null, kind = 'info', duration = 3600 } = {}) {
    // text is normally a string; a bilingual { en, nl } is resolved too
    title = t(title);
    text = t(text);
    const el = this.h(
      'div',
      { class: `toast toast-${kind}` },
      iconName ? this.h('div', { class: 'toast-icon', html: icon(iconName, 20) }) : null,
      this.h(
        'div',
        { class: 'toast-body' },
        title ? this.h('div', { class: 'toast-title', text: title }) : null,
        text ? this.h('div', { class: 'toast-text', text }) : null,
      ),
    );
    this.layers.toasts.appendChild(el);
    while (this.layers.toasts.children.length > 4) this.layers.toasts.firstChild.remove();
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, duration);
    this.ctx.events.emit('ui:toast', { title, text, kind });
    return el;
  }

  // --------------------------------------------------------------- fade
  fade(toBlack, ms = 400) {
    const el = this.layers.fade;
    el.style.transitionDuration = `${ms}ms`;
    el.classList.toggle('on', !!toBlack);
    return new Promise((res) => setTimeout(res, ms));
  }

  // ------------------------------------------------------------- modals
  /**
   * Opens a blocking modal. `el` is your dialog element; it is wrapped in a
   * backdrop. Gameplay input is blocked and the mouse released until closed.
   * opts: { onClose, closeOnEsc = true, closeOnBackdrop = true, className }
   */
  openModal(id, el, opts = {}) {
    this.closeModal(id, { silent: true });
    const wrap = this.h('div', { class: `modal-wrap ${opts.className || ''}`, dataset: { modal: id } });
    const backdrop = this.h('div', { class: 'modal-backdrop' });
    if (opts.closeOnBackdrop !== false) backdrop.addEventListener('click', () => this.closeModal(id));
    wrap.append(backdrop, el);
    el.classList.add('modal');
    this.layers.modals.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    this.modals.push({ id, el, wrap, opts: { closeOnEsc: true, ...opts } });
    this.ctx.input.block(`modal:${id}`, true);
    this.ctx.events.emit('ui:modal', { id, open: true });
    return el;
  }

  closeModal(id, { silent = false } = {}) {
    const i = this.modals.findIndex((m) => m.id === id);
    if (i < 0) return false;
    const [m] = this.modals.splice(i, 1);
    m.wrap.classList.remove('show');
    setTimeout(() => m.wrap.remove(), 220);
    this.ctx.input.block(`modal:${id}`, false);
    if (!silent) {
      try {
        m.opts.onClose?.();
      } catch (err) {
        console.error('[ui] onClose failed', err);
      }
      this.ctx.events.emit('ui:modal', { id, open: false });
    }
    return true;
  }

  isModalOpen(id = null) {
    return id ? this.modals.some((m) => m.id === id) : this.modals.length > 0;
  }

  // ------------------------------------------------------------- screens
  /** Mounts a full-screen screen element (title, customize…). Returns it. */
  showScreen(id, el) {
    this.hideScreen(id);
    el.dataset.screen = id;
    el.classList.add('screen');
    this.layers.screens.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    return el;
  }

  hideScreen(id) {
    const el = this.layers.screens.querySelector(`[data-screen="${id}"]`);
    if (!el) return;
    el.classList.remove('show');
    el.dataset.screen = `${id}-closing`;
    setTimeout(() => el.remove(), 400);
  }

  // -------------------------------------------------------------- escape
  /**
   * Registers an Escape handler (LIFO). Return value: function to unregister.
   * Escape closes the top modal first; otherwise the newest handler runs;
   * with no handlers the 'ui:escape' event fires (pause menu).
   */
  pushEscape(fn) {
    this.escapeStack.push(fn);
    return () => {
      const i = this.escapeStack.lastIndexOf(fn);
      if (i >= 0) this.escapeStack.splice(i, 1);
    };
  }

  _onKey(e) {
    if (e.code !== 'Escape' || e.repeat) return;
    const top = this.modals[this.modals.length - 1];
    if (top) {
      if (top.opts.closeOnEsc) this.closeModal(top.id);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      document.activeElement.blur();
      return;
    }
    const handler = this.escapeStack[this.escapeStack.length - 1];
    if (handler) {
      handler();
      return;
    }
    this.ctx.events.emit('ui:escape');
  }
}

/**
 * Keyed prompts ("[E] Talk"). By default they stack above the bottom-centre
 * slot; with `anchor` (a world position) the prompt floats next to that point
 * on screen (falls back to the stack when the point is off-screen).
 */
class Prompts {
  constructor(ui) {
    this.ui = ui;
    this.items = new Map();
    this.el = null;
    this.floatRoot = null;
    this._v = new Vector3();
  }

  _root() {
    if (!this.el) {
      this.el = this.ui.h('div', { class: 'prompts' });
      this.ui.layers.hud.appendChild(this.el);
    }
    return this.el;
  }

  _float() {
    if (!this.floatRoot) {
      this.floatRoot = this.ui.h('div', { class: 'prompts-float' });
      this.ui.layers.hud.appendChild(this.floatRoot);
    }
    return this.floatRoot;
  }

  /** show(channel, { key: 'E', text, hold: false, progress: 0..1 | null, anchor: Vector3 | null }) */
  show(channel, { key = 'E', text = '', hold = false, progress = null, anchor = null } = {}) {
    text = t(text); // strings pass through; a bilingual { en, nl } is resolved
    let it = this.items.get(channel);
    if (!it) {
      const el = this.ui.h(
        'div',
        { class: 'prompt' },
        this.ui.h('span', { class: 'kbd' }),
        this.ui.h('span', { class: 'prompt-text' }),
        this.ui.h('span', { class: 'prompt-ring' }),
      );
      this._root().appendChild(el);
      it = { el, key: null, text: null, anchor: null, channel, hold: false, progress: null };
      el.dataset.channel = channel;
      this.items.set(channel, it);
    }
    if (it.key !== key) {
      it.el.children[0].textContent = it.key = key;
      it.el.dataset.key = key; // touch: tapping the prompt presses this key
    }
    if (it.text !== text) it.el.children[1].textContent = it.text = text;
    it.el.classList.toggle('hold', !!hold);
    it.hold = !!hold;
    it.progress = progress;
    it.el.style.setProperty('--p', progress == null ? 0 : Math.max(0, Math.min(1, progress)));
    if (anchor) (it.anchor || (it.anchor = new Vector3())).copy(anchor);
    else it.anchor = null;
    this._place(it);
  }

  _place(it) {
    const cam = this.ui.ctx.engine?.camera;
    let onScreen = false;
    if (it.anchor && cam) {
      const v = this._v.copy(it.anchor).project(cam);
      onScreen = v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.9;
      if (onScreen) {
        const x = (v.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
        if (it.el.parentNode !== this._float()) this._float().appendChild(it.el);
        it.el.classList.add('floating');
        it.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-12px, -50%)`;
      }
    }
    if (!onScreen) {
      if (it.el.parentNode !== this._root()) this._root().appendChild(it.el);
      it.el.classList.remove('floating');
      it.el.style.transform = '';
    }
  }

  /** Re-projects anchored prompts (called every frame by the core loop). */
  update() {
    for (const it of this.items.values()) if (it.anchor) this._place(it);
  }

  hide(channel) {
    const it = this.items.get(channel);
    if (!it) return;
    it.el.remove();
    this.items.delete(channel);
  }

  clear() {
    for (const ch of [...this.items.keys()]) this.hide(ch);
  }
}
