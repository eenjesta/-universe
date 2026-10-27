import { ZONES } from '../world/layout.js';
import { icon } from '../ui/icons.js';
import { t } from '../core/i18n.js';

/** FALLBACK shell (do not edit): minimal title screen + Esc → title. */
export function install(ctx) {
  const { ui, modes, camera } = ctx;
  let t0 = 0;
  modes.register('title', {
    scene: ctx.world.scene,
    camera,
    pointerLock: false,
    hud: 'title',
    enter() {
      const s = ZONES.spawn;
      ctx.player?.teleport?.('spawn', 0);
      const el = ui.h(
        'div',
        { style: { position: 'absolute', left: '6vw', top: '12vh' } },
        ui.h('div', { class: 'row', style: { gap: '24px' } }, ui.h('div', { html: icon('emblem', 84) }), ui.h('div', { class: 'title-xl', text: 'UNIVERSE' })),
        ui.h('div', { class: 'caps muted', style: { margin: '18px 0 40px 110px', letterSpacing: '.5em' }, text: 'Explore · Create · Connect' }),
        ui.h('button', { class: 'btn btn-primary', onclick: () => modes.go('explore', { zone: 'spawn' }) }, t({ en: 'Play', nl: 'Speel' })),
      );
      ui.showScreen('title', el);
      t0 = 0;
      camera.position.set(s.x + 3, ctx.world.getHeightAt(s.x, s.z) + 3, s.z + 7);
    },
    exit() {
      ui.hideScreen('title');
    },
    update(dt) {
      t0 += dt;
      const s = ZONES.spawn;
      const y = ctx.world.getHeightAt(s.x, s.z);
      camera.position.set(s.x + 3 + Math.sin(t0 * 0.05) * 2, y + 3, s.z + 7);
      camera.lookAt(s.x + 40, y + 10, s.z - 400);
    },
  });
  ctx.events.on('ui:escape', () => {
    if (modes.is('explore', 'drive', 'space')) modes.go('title');
  });
  return {};
}
