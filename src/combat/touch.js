/**
 * Touch layout for combat (ctx.touch.setLayout overlay 'combat'): active in
 * explore whenever combat is allowed (not building, not in a safe zone, …).
 * Cluster: Fire (main, held = Mouse0) · Aim (toggle) · Reload · Switch (draws
 * when holstered; on phones the tappable weapon chip in the vitals does this) ·
 * Grenade (hold = arc, release = throw) · Dodge · Jump, plus the contextual
 * action button. Fire is hidden while holstered, then Jump takes
 * the big corner slot. Light aim assist lives in the controller (bullet
 * magnetism + aim friction while aiming).
 */
import { registerIcons } from '../ui/icons.js';

export function installCombatTouch(ctx, combat) {
  if (!ctx.touch?.enabled) return null;
  registerIcons({
    'cbt-t-fire': '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 1.8v4M12 18.2v4M1.8 12h4M18.2 12h4"/>',
  });
  const c = combat;
  const active = () => ctx.modes.is('explore') && !ctx.build?.active && !c.dead && !c.blockReason;
  const def = {
    when: active,
    joystick: 'analog',
    look: true,
    jump: false,
    action: true,
    sprint: 'ShiftLeft',
    buttons: [
      { id: 'fire', label: { en: 'Fire', nl: 'Vuren' }, icon: 'cbt-t-fire', code: 'Mouse0', hold: true, main: true, accent: 'red', when: () => c.armed },
      { id: 'jump', label: { en: 'Jump', nl: 'Springen' }, icon: 'touch-jump', code: 'Space', hold: true, main: true },
      { id: 'aim', label: { en: 'Aim', nl: 'Richten' }, icon: 'cbt-aim', onTap: () => c.toggleAim(), when: () => c.armed && c.current?.kind !== 'throw' },
      { id: 'reload', label: { en: 'Reload', nl: 'Herladen' }, icon: 'cbt-reload', code: 'KeyR', when: () => c.armed && c.current?.kind !== 'throw' },
      {
        id: 'switch',
        label: { en: 'Switch', nl: 'Wissel' },
        icon: 'cbt-switch',
        onTap: () => (c.armed ? c.cycle(1) : c.draw(c.current?.id)),
        // phones: the weapon chip in the vitals (bottom-center) switches — fewer buttons over the HUD
        when: () => !ctx.device?.phone,
      },
      { id: 'grenade', label: { en: 'Grenade', nl: 'Granaat' }, icon: 'cbt-grenade', accent: 'cyan', onPress: () => c.startQuickThrow(), onTap: () => c.releaseQuickThrow(), when: () => c.grenades > 0 },
      { id: 'dodge', label: { en: 'Dodge', nl: 'Ontwijken' }, icon: 'cbt-dodge', code: 'KeyQ' },
    ],
    menu: ['missions', 'map', 'market', 'chat', 'vehicle', 'build', 'garage', 'character', 'help', 'pause', 'fullscreen'],
    // net (players list) and smp (inventory, installs after combat): read when the layout is applied
    get menuExtra() {
      const out = [];
      if (Array.isArray(ctx.net?.touchMenu)) out.push(...ctx.net.touchMenu);
      if (Array.isArray(ctx.smp?.touchMenu)) out.push(...ctx.smp.touchMenu);
      return out;
    },
  };
  ctx.touch.setLayout('combat', def);
  return def;
}
