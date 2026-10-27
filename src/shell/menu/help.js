/**
 * Help overlay (H): the controls reference as a modal, with the groups for
 * the current mode first and highlighted, plus a few short tips.
 */
import { icon } from '../../ui/icons.js';
import { controlsPanel } from './panels.js';
import { uiSound } from '../util.js';

const MODAL_ID = 'shell-help';

const TIPS = {
  explore: 'Klik in de wereld om de muis te vangen. Volg de cyaan markering op je kompas naar je volgende doel.',
  drive: 'Met het ruimteschip vlieg je boven de 600 m of met L vanaf de ruimtehaven de ruimte in.',
  space: 'Scan de anomalie met E en keer met L terug naar de planeet.',
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
    const tip = TIPS[mode] || TIPS.explore;
    const el = h(
      'div',
      { class: 'shell-help', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Help' },
      h(
        'header',
        { class: 'shell-help-head' },
        h('div', null, h('div', { class: 'shell-help-k', text: 'Help' }), h('h2', { class: 'shell-help-title', text: 'Besturing' })),
        h('button', { class: 'modal-close', type: 'button', 'aria-label': 'Sluiten', html: icon('close', 20), onclick: () => this.close() }),
      ),
      h('div', { class: 'shell-help-tip' }, h('span', { html: icon('info', 18) }), h('span', { text: tip })),
      h('div', { class: 'shell-help-body scroll' }, controlsPanel(ctx, { mode, compact: true })),
      h('footer', { class: 'shell-help-foot' }, h('span', { class: 'kbd shell-kbd', text: 'H' }), h('span', { text: 'of' }), h('span', { class: 'kbd shell-kbd', text: 'Esc' }), h('span', { text: 'om te sluiten' })),
    );
    ctx.ui.openModal(MODAL_ID, el, { className: 'shell-help-wrap', onClose: () => uiSound(ctx, 'ui.close') });
    uiSound(ctx, 'ui.open');
  }

  close() {
    this.ctx.ui.closeModal(MODAL_ID);
  }
}
