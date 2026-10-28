/**
 * Contextual key hints (bottom-right, explore on foot, desktop). They follow what
 * you are doing (logic.js hintContext / hintKeys):
 *   hub (safe zone)   M Map & travel · J Missions · F Vehicle · V First person · H Help
 *   wilderness        M Map · I Inventory · B Build (only ≥ 500 m out) · U Return to hub · V … · 1 Draw weapon
 *   armed             R Reload · Q Dodge · Z Grenade · I Inventory · M Map · V …
 *   (the V hint retires once the player switched the camera — state shell.tips.camera)
 *   building, driving, dialogue, dead, touch → hidden (those HUDs show their own hints).
 * They are fully visible for a few seconds after the context changes, then dim
 * (hover brings them back). Clicking a hint presses that key. settings.keyHints
 * turns them off.
 */
import { t } from '../../core/i18n.js';
import { KEY_HINT_TEXT } from '../data.js';
import { hintContext, hintKeys, NO_BUILD } from '../logic.js';

const DIM_AFTER = 9; // s

export class KeyHints {
  constructor(ctx, { press, wild, settings } = {}) {
    this.ctx = ctx;
    this.press = press;
    this.wild = wild;
    this.settings = settings;
    this.el = ctx.ui.h('div', { class: 'shell-keyhints', role: 'note', 'aria-label': t({ en: 'Shortcuts', nl: 'Sneltoetsen' }) });
    ctx.ui.addWidget('bottom-right', this.el, { modes: ['explore'], order: 10 });
    this._key = null;
    this._shown = null;
    this._since = 0;
    this._acc = 1;
    this.el.addEventListener('pointerenter', () => this.el.classList.remove('is-dim'));
    this.el.addEventListener('pointerleave', () => this._since > DIM_AFTER && this.el.classList.add('is-dim'));
    const kick = () => (this._acc = 1);
    ctx.events.on('build:mode', kick);
    ctx.events.on('mode:change', kick);
    // the V hint retires once the player switched the camera (the first event is the initial view)
    this._camMode = null;
    ctx.events.on('camera:mode', ({ mode } = {}) => {
      if (this._camMode && mode && mode !== this._camMode && !ctx.state.get('shell.tips.camera')) ctx.state.set('shell.tips.camera', true);
      if (mode) this._camMode = mode;
      kick();
    });
    this.sync = () => {
      this._acc = 1;
      this._key = null;
      this._shown = null;
      this.update(0);
    };
  }

  _state() {
    const ctx = this.ctx;
    const p = ctx.player?.position;
    const inHub = p && this.wild ? this.wild.inHub(p.x, p.z) : true;
    return {
      mode: ctx.modes.name,
      building: !!ctx.build?.active,
      inHub,
      armed: !!ctx.combat?.armed,
      dead: !!ctx.combat?.dead,
      dialogue: !!ctx.dialogue?.isOpen,
      touch: !!ctx.device?.touch,
    };
  }

  update(dt) {
    this._since += dt;
    if (this._since > DIM_AFTER && !this.el.classList.contains('is-dim') && !this.el.matches(':hover')) this.el.classList.add('is-dim');
    this._acc += dt;
    if (this._acc < 0.3) return;
    this._acc = 0;
    const ctx = this.ctx;
    const on = this.settings?.get?.('keyHints') !== false;
    const context = on ? hintContext(this._state()) : 'none';
    const firstPerson = (ctx.player?.view || this.settings?.get?.('camera')) === 'first';
    const p = ctx.player?.position;
    const keys = hintKeys(context, {
      firstPerson,
      hasInventory: !!ctx.smp?.enabled,
      canBuild: !!(ctx.build?.toggle || ctx.build?.enter),
      buildHere: !p || !this.wild || this.wild.hubDist(p.x, p.z) >= NO_BUILD,
      cameraKnown: !!ctx.state.get('shell.tips.camera'),
    });
    const key = `${context}|${keys.map((k) => k.k + k.t).join(',')}`;
    if (key === this._key) return;
    this._key = key;
    const visible = keys.length > 0;
    if (visible !== this._shown) {
      this._shown = visible;
      ctx.ui.setVisible(this.el, visible);
    }
    if (!visible) return;
    this._since = 0;
    this.el.classList.remove('is-dim');
    this.el.dataset.context = context;
    this._render(keys);
    // keep clear of the left HUD column (minimap + chat): drop the least important hints until it fits
    const left = this._leftLimit();
    let n = keys.length;
    while (n > 2 && this.el.getBoundingClientRect().left < left) this._render(keys.slice(0, --n));
  }

  /** x (px) the hints must stay right of: the bottom-left slot (minimap, chat) or 35 % of the width. */
  _leftLimit() {
    const slot = this.ctx.ui.slots?.['bottom-left'];
    const r = slot?.getBoundingClientRect?.();
    return Math.max(window.innerWidth * 0.35, r && r.width > 0 ? r.right + 16 : 0);
  }

  _render(keys) {
    const ctx = this.ctx;
    const h = ctx.ui.h;
    this.el.replaceChildren(
      ...keys.flatMap((k, i) => {
        const label = t(KEY_HINT_TEXT[k.t] || k.t);
        const btn = h(
          'button',
          {
            class: 'shell-keyhint',
            type: 'button',
            title: `${label} (${k.k})`,
            onclick: (e) => {
              e.currentTarget.blur();
              this.press?.(k.code);
            },
          },
          h('span', { class: 'kbd shell-kbd', text: k.k }),
          h('span', { class: 'shell-keyhint-label', text: label }),
        );
        return i ? [h('span', { class: 'shell-keyhints-dot', 'aria-hidden': 'true' }), btn] : [btn];
      }),
    );
  }
}
