/**
 * Help overlay (H): the controls reference as a modal, with the groups for
 * the current mode first and highlighted, plus a few short tips.
 */
import { icon } from '../../ui/icons.js';
import { t } from '../../core/i18n.js';
import { controlsPanel } from './panels.js';
import { uiSound } from '../util.js';

const MODAL_ID = 'shell-help';

const TIPS = {
  explore: {
    en: 'Click in the world to capture the mouse. Follow the cyan marker on your compass to your next objective.',
    nl: 'Klik in de wereld om de muis te vangen. Volg de cyaan markering op je kompas naar je volgende doel.',
  },
  drive: {
    en: 'In the spaceship, climb above 600 m or press L at the spaceport to fly into space.',
    nl: 'Met het ruimteschip vlieg je boven de 600 m of met L vanaf de ruimtehaven de ruimte in.',
  },
  space: {
    en: 'Scan the anomaly with E and press L to return to the planet.',
    nl: 'Scan de anomalie met E en keer met L terug naar de planeet.',
  },
};

/** Touch devices (src/core/touch.js): the same tips without mouse / keys. */
const TOUCH_TIPS = {
  explore: {
    en: 'Walk with the joystick on the left and drag on the right to look around. Follow the cyan marker on your compass to your next objective.',
    nl: 'Loop met de joystick links en sleep rechts om rond te kijken. Volg de cyaan markering op je kompas naar je volgende doel.',
  },
  drive: {
    en: 'In the spaceship, climb above 600 m or tap the rocket button at the spaceport to fly into space.',
    nl: 'Met het ruimteschip vlieg je boven de 600 m of met de raketknop vanaf de ruimtehaven de ruimte in.',
  },
  space: {
    en: 'Hold the action button to scan the anomaly and tap Land to return to the planet.',
    nl: 'Houd de actieknop vast om de anomalie te scannen en tik op Landen om terug te keren naar de planeet.',
  },
};

export class HelpOverlay {
  constructor(ctx) {
    this.ctx = ctx;
  }

  get isOpen() {
    return this.ctx.ui.isModalOpen(MODAL_ID);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    const ctx = this.ctx;
    const h = ctx.ui.h;
    const mode = ctx.modes.name;
    const tip = t((ctx.device?.touch && TOUCH_TIPS[mode]) || TIPS[mode] || TIPS.explore);
    const helpWord = t({ en: 'Help', nl: 'Help' });
    const el = h(
      'div',
      { class: 'shell-help', role: 'dialog', 'aria-modal': 'true', 'aria-label': helpWord },
      h(
        'header',
        { class: 'shell-help-head' },
        h('div', null, h('div', { class: 'shell-help-k', text: helpWord }), h('h2', { class: 'shell-help-title', text: t({ en: 'Controls', nl: 'Besturing' }) })),
        h('button', { class: 'modal-close', type: 'button', 'aria-label': t({ en: 'Close', nl: 'Sluiten' }), html: icon('close', 20), onclick: () => this.close() }),
      ),
      h('div', { class: 'shell-help-tip' }, h('span', { html: icon('info', 18) }), h('span', { text: tip })),
      h('div', { class: 'shell-help-body scroll' }, controlsPanel(ctx, { mode, compact: true })),
      h(
        'footer',
        { class: 'shell-help-foot' },
        h('span', { class: 'kbd shell-kbd', text: 'H' }),
        h('span', { text: t({ en: 'or', nl: 'of' }) }),
        h('span', { class: 'kbd shell-kbd', text: 'Esc' }),
        h('span', { text: t({ en: 'to close', nl: 'om te sluiten' }) }),
      ),
    );
    ctx.ui.openModal(MODAL_ID, el, { className: 'shell-help-wrap', onClose: () => uiSound(ctx, 'ui.close') });
    uiSound(ctx, 'ui.open');
  }

  close() {
    this.ctx.ui.closeModal(MODAL_ID);
  }
}
