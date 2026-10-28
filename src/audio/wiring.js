/**
 * Event → sound wiring. Sounds that other modules already play themselves
 * (quest.update/complete, reward, toast banners, chat for NPC messages,
 * dialogue.open, menu clicks, meteor harvest/explosions, warp) are NOT wired
 * again. Everything that might or might not be played by its emitter uses a
 * "fill-in": the sound plays only if no other one-shot started in a short
 * window around the event, so nothing ever doubles:
 *   build:placed/removed/invalid/mode, harvest, ui:toast, ui:modal, chat:sent,
 *   system chat lines, npc:say after [E], interact, vehicle:enter/exit/summon/
 *   launch, space:dock/kill/damage, customize:done.
 * Direct (nobody else plays them): player:footstep (surface/speed/side),
 * player:jump, player:land (speed, last surface).
 * DOM: hover/click on .btn, .card.interactive, .modal-close, button, [role=button|tab]
 * and [data-sound] (data-sound="none" silences an element, data-sound="ui.open"
 * picks another click sound, data-sound-hover="none" silences its hover).
 */
const QUIET = ['footstep', 'ui.hover'];

export function installWiring(ctx, mixer) {
  const A = ctx.audio;
  const on = (name, fn) => ctx.events.on(name, fn);
  const timers = new Set();

  /** Plays `name` unless another one-shot started within `window` ms before the event (or before `delay` passed). */
  function fill(name, opts = {}, { delay = 60, window = 160, ignore = QUIET, only = null } = {}) {
    const t0 = performance.now();
    const id = setTimeout(() => {
      timers.delete(id);
      if (!mixer.playedSince(t0 - window, { ignore, only })) A.play(name, opts);
    }, delay);
    timers.add(id);
  }

  /** Per-event-type rate limit (ms). */
  const lastEvt = new Map();
  const throttle = (key, ms) => {
    const now = performance.now();
    if (now - (lastEvt.get(key) ?? -1e9) < ms) return false;
    lastEvt.set(key, now);
    return true;
  };

  // ------------------------------------------------------------ player
  let surface = 'grass';
  on('player:footstep', (p = {}) => {
    if (p.surface) surface = p.surface;
    if (ctx.player && ctx.player.onFoot === false) return;
    A.play('footstep', { surface, speed: p.speed, side: p.side, volume: 0.9 });
  });
  on('player:jump', () => A.play('jump', { volume: 0.85 }));
  on('player:land', (p = {}) => A.play('land', { speed: p.speed, surface }));

  // ------------------------------------------------------------ build / harvest
  on('build:placed', () => fill('build.place', {}, { delay: 40, window: 120 }));
  on('build:removed', () => fill('build.remove', {}, { delay: 40, window: 120 }));
  on('build:invalid', () => throttle('invalid', 250) && fill('build.invalid', {}, { delay: 40, window: 120 }));
  on('build:mode', (p = {}) => fill('build.mode', { active: p.active !== false }, { delay: 50, window: 150 }));
  on('harvest', (p = {}) => fill('harvest', { resource: p.resource }, { delay: 50, window: 150 }));

  // ------------------------------------------------------------ UI events
  on('ui:toast', (p = {}) => {
    const k = p.kind;
    const name = k === 'error' || k === 'warn' ? 'ui.error' : k === 'reward' ? 'reward' : 'toast';
    fill(name, {}, { delay: 70, window: 150 });
  });
  on('ui:modal', (p = {}) => {
    if (p.open) {
      if (p.id !== 'dialogue') fill('ui.open', {}, { delay: 60, window: 150 });
    } else fill('ui.close', {}, { delay: 60, window: 150 });
  });
  on('chat:sent', () => fill('chat', { variant: 'send' }, { delay: 30, window: 100 }));
  on('chat:message', (p = {}) => {
    if (p.kind === 'system' && throttle('sys-chat', 600)) fill('chat', { variant: 'system', volume: 0.7 }, { delay: 60, window: 150 });
  });
  let lastTalk = { id: null, at: -1e9 };
  on('npc:interact', (p = {}) => {
    lastTalk = { id: p.id, at: performance.now() };
  });
  on('npc:say', (p = {}) => {
    if (p.id && p.id === lastTalk.id && performance.now() - lastTalk.at < 1500) fill('chat', { variant: 'say' }, { delay: 30, window: 150 });
  });
  on('interact', () => fill('interact', {}, { delay: 120, window: 150 }));
  on('customize:done', () => fill('toast', {}, { delay: 80, window: 150 }));

  // ------------------------------------------------------------ vehicles / space
  on('vehicle:enter', () => fill('vehicle.enter', {}, { delay: 50, window: 150 }));
  on('vehicle:exit', () => fill('vehicle.exit', {}, { delay: 50, window: 150 }));
  on('vehicle:summon', () => fill('vehicle.summon', {}, { delay: 60, window: 150 }));
  on('vehicle:launch', () => fill('launch', {}, { delay: 60, window: 150 }));
  on('space:dock', () => fill('dock', {}, { delay: 80, window: 150 }));
  on('space:kill', () => fill('explosion', { size: 1 }, { delay: 60, window: 150, only: (n) => n === 'explosion' }));
  on('space:damage', () => throttle('dmg', 250) && fill('shield.hit', {}, { delay: 40, window: 150, only: (n) => n === 'shield.hit' || n === 'explosion' }));

  // ------------------------------------------------------------ DOM delegation
  const CLICK_SEL = '.btn, .card.interactive, .modal-close, [data-sound], button, [role="button"], [role="tab"]';
  const HOVER_SEL = '.btn, .card.interactive, [data-sound], button, [role="button"], [role="tab"]';
  const usable = (el) => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  let lastHover = null;

  const onClick = (e) => {
    const el = e.target?.closest?.(CLICK_SEL);
    if (!usable(el)) return;
    const name = el.dataset?.sound;
    if (name === 'none' || name === 'off') return;
    // element handlers already ran (bubble phase): skip if they played anything
    fill(A.has(name) ? name : 'ui.click', {}, { delay: 0, window: 90 });
  };
  const onOver = (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target?.closest?.(HOVER_SEL);
    if (el === lastHover) return;
    lastHover = el;
    if (!usable(el) || el.dataset?.soundHover === 'none' || el.dataset?.sound === 'none') return;
    // modules' own mouseenter sounds fire after pointerover: decide a moment later
    fill('ui.hover', {}, { delay: 30, window: 80, ignore: null, only: (n) => n.startsWith('ui.') });
  };
  document.addEventListener('click', onClick, false);
  document.addEventListener('pointerover', onOver, true);

  return {
    fill,
    dispose() {
      document.removeEventListener('click', onClick, false);
      document.removeEventListener('pointerover', onOver, true);
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };
}
