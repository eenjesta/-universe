/**
 * Key hints (bottom-right, explore on foot): B Build · F Vehicle · G Garage
 * · J Missions · M Map · H Help. Hidden while build mode shows its own hints.
 * Clicking a hint triggers the same action as the key.
 */
import { t } from '../../core/i18n.js';
import { KEY_HINTS } from '../data.js';

export class KeyHints {
  constructor(ctx, actions = {}) {
    this.ctx = ctx;
    const h = ctx.ui.h;
    this.el = h(
      'div',
      { class: 'shell-keyhints', role: 'note', 'aria-label': t({ en: 'Shortcuts', nl: 'Sneltoetsen' }) },
      KEY_HINTS.map((k, i) => [
        i ? h('span', { class: 'shell-keyhints-dot', 'aria-hidden': 'true' }) : null,
        h(
          'button',
          {
            class: 'shell-keyhint',
            type: 'button',
            title: `${t(k.t)} (${k.k})`,
            onclick: (e) => {
              e.currentTarget.blur();
              actions[k.k]?.();
            },
          },
          h('span', { class: 'kbd shell-kbd', text: k.k }),
          h('span', { class: 'shell-keyhint-label', text: t(k.t) }),
        ),
      ]),
    );
    ctx.ui.addWidget('bottom-right', this.el, { modes: ['explore'], order: 10 });
    this._build = null;
    const sync = () => {
      const active = !!ctx.build?.active;
      if (active === this._build) return;
      this._build = active;
      ctx.ui.setVisible(this.el, !active);
    };
    ctx.events.on('build:mode', sync);
    ctx.events.on('mode:change', sync);
    this.sync = sync;
    sync();
  }
}
