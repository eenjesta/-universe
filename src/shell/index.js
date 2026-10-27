/**
 * Shell module — title mode + title screen, pause/settings/help menus, the
 * world map, and the navigation HUD (minimap, compass strip, screen markers,
 * zone label, key hints, FPS/debug overlay). Owns `state.settings`.
 *
 * install(ctx) registers mode 'title' and returns the public API (ctx.shell):
 *   settings            get(key) / set(key, v) / onChange(fn)
 *   openPause(tab?) closePause() paused   openSettings()
 *   openMap() closeMap() toggleMap()      openHelp() closeHelp() toggleHelp()
 *   showZoneLabel(name, {iconName, sub})  track(markerId | null)
 *   currentZone()  fastTravel(zoneId)  goToTitle()  hasProgress()
 *   setHudVisible(bool)  refreshThumbnails()
 * Events: emits `title:start` {action, mode, params} and `pause` {open}.
 * URL hooks: ?pause[=settings|controls|about|reset], ?map, ?help, ?debug,
 *            ?thumbs=0 (no live card thumbnails) / ?thumbs (render at once).
 */
import './shell.css';
import './title/title.css';
import './hud/hud.css';
import './menu/menu.css';
import './map/map.css';
import { registerShellIcons } from './icons.js';
import { createSettings } from './settings.js';
import { HudFrame } from './hud/hudFrame.js';
import { Minimap } from './hud/minimap.js';
import { Compass } from './hud/compass.js';
import { ScreenMarkers } from './hud/screenMarkers.js';
import { ZoneLabel } from './hud/zoneLabel.js';
import { KeyHints } from './hud/keyHints.js';
import { DebugOverlay } from './hud/debugOverlay.js';
import { MapImage } from './map/mapImage.js';
import { WorldMap } from './map/worldMap.js';
import { PauseMenu } from './menu/pauseMenu.js';
import { HelpOverlay } from './menu/help.js';
import { registerTitleMode } from './title/titleMode.js';
import { ZONES } from '../world/layout.js';

const GAME_MODES = ['explore', 'drive', 'space'];
const WORLD_MODES = ['explore', 'drive'];

export async function install(ctx, { progress = () => {} } = {}) {
  registerShellIcons();
  const { modes, events, ui, state } = ctx;
  const shell = {}; // filled below; becomes ctx.shell
  let sessionStarted = false;
  let resumePos = null;

  // ---------------------------------------------------------------- core
  const settings = createSettings(ctx);
  state.ensure('shell', { visited: [] });
  const frame = new HudFrame(ctx);
  const mapImage = new MapImage(ctx, { size: 2048 });
  progress(0.15);

  // ----------------------------------------------------------------- HUD
  const zoneLabel = new ZoneLabel(ctx, frame);
  const minimap = new Minimap(ctx, frame, mapImage);
  const compass = new Compass(ctx, frame);
  const screenMarkers = new ScreenMarkers(ctx, frame);
  const debug = new DebugOverlay(ctx, frame, { verbose: !!ctx.params.debug });
  debug.setShowFps(settings.get('showFps'));
  settings.onChange((key) => {
    if (key === 'showFps' || key === '*') debug.setShowFps(settings.get('showFps'));
  });
  progress(0.35);

  // --------------------------------------------------------------- menus
  const pause = new PauseMenu(ctx, shell);
  const help = new HelpOverlay(ctx);
  const map = new WorldMap(ctx, shell, mapImage, frame);
  // Clicking a key hint behaves exactly like pressing that key.
  const pressKey = (code) => {
    const key = code.replace(/^Key/, '').toLowerCase();
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), 90);
  };
  const keyHints = new KeyHints(ctx, {
    B: () => pressKey('KeyB'),
    F: () => pressKey('KeyF'),
    G: () => pressKey('KeyG'),
    J: () => pressKey('KeyJ'),
    M: () => pressKey('KeyM'),
    H: () => pressKey('KeyH'),
  });
  progress(0.55);

  // ---------------------------------------------------------- title mode
  const title = registerTitleMode(ctx, shell);
  progress(0.75);

  // ------------------------------------------------------------- helpers
  const visited = new Set(state.get('shell.visited') || []);
  const markVisited = (id) => {
    if (!id || !ZONES[id] || visited.has(id)) return;
    visited.add(id);
    state.set('shell.visited', [...visited]);
  };

  function hasProgress() {
    return !!(state.loadedFromSave || sessionStarted || state.get('profile.created'));
  }

  function rememberPosition(from) {
    if (!WORLD_MODES.includes(from)) return;
    const p = ctx.player?.position;
    if (p?.isVector3) resumePos = { x: p.x, z: p.z, heading: ctx.player.heading || 0 };
  }

  function savedPosition() {
    if (resumePos) return resumePos;
    const p = state.get('player.position');
    const x = Array.isArray(p) ? p[0] : p?.x;
    const z = Array.isArray(p) ? p[2] : p?.z;
    if (Number.isFinite(x) && Number.isFinite(z)) return { x, z, heading: state.get('player.heading') || 0 };
    return null;
  }

  /** If the characters module ignored a requested position, place the player there. */
  function ensureArrived(pos) {
    const pl = ctx.player;
    if (!pos || !pl?.position?.isVector3 || !modes.is('explore')) return;
    if (Math.hypot(pl.position.x - pos.x, pl.position.z - pos.z) > 25) pl.teleport?.({ x: pos.x, z: pos.z }, pos.heading);
  }

  async function startGame(mode, params, action) {
    sessionStarted = true;
    events.emit('title:start', { action, mode, params });
    await modes.go(mode, params);
    ctx.loop.paused = false;
  }

  /** Title menu + card actions (called by the title screen). */
  async function titleAction(id) {
    switch (id) {
      case 'play': {
        if (hasProgress()) {
          const pos = savedPosition();
          const params = pos ? { resume: true, position: pos } : { resume: true, zone: state.get('player.zone') || 'spawn' };
          await startGame('explore', params, 'continue');
          ensureArrived(pos);
        } else if (modes.has('customize')) {
          await startGame('customize', { returnTo: 'explore', returnParams: { zone: 'spawn' } }, 'new');
        } else await startGame('explore', { zone: 'spawn' }, 'new');
        break;
      }
      case 'character':
        if (modes.has('customize')) await modes.go('customize', { returnTo: 'title' });
        break;
      case 'card:explore':
        await startGame('explore', { zone: 'spawn' }, 'explore');
        break;
      case 'card:build':
        await startGame('explore', { zone: 'base' }, 'build');
        try {
          if (!ctx.build?.active) ctx.build?.enter?.();
        } catch (err) {
          console.warn('[shell] build.enter failed', err);
        }
        break;
      case 'card:meet':
        await startGame('explore', { zone: 'plaza' }, 'meet');
        break;
      case 'card:more':
        if (modes.has('space')) await startGame('space', { from: 'title' }, 'space');
        else await startGame('explore', { zone: 'spaceport' }, 'space');
        break;
      default:
        break;
    }
  }

  async function fastTravel(zoneId) {
    if (!ZONES[zoneId]) return;
    if (pause.isOpen) pause.close({ keepPaused: true });
    await modes.go('explore', { zone: zoneId, travel: true });
    ctx.loop.paused = false;
    const z = ZONES[zoneId];
    ensureArrived({ x: z.x, z: z.z, heading: z.heading });
  }

  function goToTitle() {
    if (pause.isOpen) pause.close({ keepPaused: true });
    if (map.isOpen) map.close();
    return modes.go('title', {});
  }

  function wipeProgress() {
    try {
      state.reset();
    } catch (err) {
      console.error('[shell] reset failed', err);
    }
    // nothing may write a (default) save before the reload, or the fresh
    // start would look like an existing save ("Continue" instead of "Play")
    state.persist = false;
    clearTimeout(state._saveTimer);
    ui.fade(true, 500).then(() => {
      const keep = new URLSearchParams();
      for (const k of ['nosave', 'quality', 'debug']) if (k in ctx.params) keep.set(k, ctx.params[k] === true ? '' : ctx.params[k]);
      // the wiped save also held the language: keep playing in the same one
      const lang = ctx.i18n?.lang?.();
      if (lang && (lang !== 'en' || 'lang' in ctx.params)) keep.set('lang', lang);
      const qs = keep.toString().replace(/=(&|$)/g, '$1');
      location.replace(`${location.pathname}${qs ? `?${qs}` : ''}`);
    });
  }

  // --------------------------------------------------------- input wiring
  const noOtherModal = (mine) => !ui.isModalOpen() || (mine && ui.isModalOpen(mine) && ui.modals[ui.modals.length - 1]?.id === mine);

  function openPauseIfPlaying(tab) {
    if (!modes.is(...GAME_MODES) || modes.transitioning || pause.isOpen) return;
    if (ui.isModalOpen()) return; // another dialog owns the screen
    pause.open({ tab, context: 'game' });
  }

  events.on('ui:escape', () => openPauseIfPlaying());
  events.on('input:lockLost', () => {
    // A real Escape keydown may follow the pointer-lock release; let it win.
    setTimeout(() => openPauseIfPlaying(), 90);
  });
  events.on('input:key', ({ code }) => {
    if (ctx.input.textFocus) return;
    if (code === 'KeyP') {
      if (pause.isOpen && ui.modals[ui.modals.length - 1]?.id === 'shell-pause') pause.close({ resume: true });
      else openPauseIfPlaying();
    } else if (code === 'KeyM') {
      if (map.isOpen && noOtherModal('shell-map')) map.close();
      else if (modes.is(...WORLD_MODES) && !modes.transitioning && !ui.isModalOpen() && !ctx.build?.active) map.open();
    } else if (code === 'KeyH' || code === 'F1') {
      if (help.isOpen && noOtherModal('shell-help')) help.close();
      else if (modes.is(...GAME_MODES) && !modes.transitioning && !ui.isModalOpen()) help.open();
    }
  });

  events.on('mode:change', ({ to }) => {
    if (!WORLD_MODES.includes(to) && map.isOpen) map.close();
    if (help.isOpen && !GAME_MODES.includes(to)) help.close();
    if (!pause.isOpen) ctx.loop.paused = false;
    keyHints.sync();
  });
  events.on('player:zone', (p) => markVisited(typeof p?.zone === 'object' ? p?.zone?.id : p?.zone));

  // -------------------------------------------------------------- frame
  let hudVisible = true;
  ctx.loop.add(
    'shell-hud',
    (dt) => {
      frame.update(dt);
      const inWorld = modes.is(...WORLD_MODES);
      if (inWorld && !ctx.loop.paused) {
        minimap.update(dt);
        compass.update();
        zoneLabel.update(dt);
        if (zoneLabel.zone) markVisited(zoneLabel.zone);
      }
      screenMarkers.enabled = hudVisible;
      screenMarkers.update();
      if (map.isOpen) map.update();
      pause.watchdog();
      debug.update(dt);
    },
    { order: 92, pausable: false },
  );

  // -------------------------------------------------------- boot & hooks
  events.on('game:ready', () => {
    mapImage.start(450);
    const p = ctx.params;
    setTimeout(() => {
      if (p.pause) {
        const tab = typeof p.pause === 'string' ? p.pause : null;
        if (modes.is(...GAME_MODES)) pause.open({ tab, context: 'game' });
        else if (modes.is('title')) pause.open({ tab: tab || 'settings', context: 'title' });
      } else if (p.map && modes.is(...WORLD_MODES)) map.open();
      else if (p.help && modes.is(...GAME_MODES)) help.open();
    }, 120);
  });

  // ---------------------------------------------------------- public API
  Object.assign(shell, {
    settings,
    pause,
    map,
    help,
    title,
    minimap,
    compass,
    screenMarkers,
    zoneLabel,
    mapImage,
    frame,
    hasProgress,
    rememberPosition,
    titleAction,
    fastTravel,
    goToTitle,
    wipeProgress,
    openPause: (tab) => (modes.is('title') ? pause.open({ tab: tab || 'settings', context: 'title' }) : pause.open({ tab, context: 'game' })),
    closePause: () => pause.close({ resume: true }),
    get paused() {
      return pause.isOpen && pause.context === 'game';
    },
    openSettings: () => shell.openPause('settings'),
    openMap: (opts) => map.open(opts),
    closeMap: () => map.close(),
    toggleMap: () => map.toggle(),
    openHelp: () => help.open(),
    closeHelp: () => help.close(),
    toggleHelp: () => help.toggle(),
    showZoneLabel: (name, opts) => zoneLabel.show(name, opts),
    currentZone: () => zoneLabel.zone,
    track(id) {
      frame.trackedId = id || null;
    },
    setHudVisible(on) {
      hudVisible = !!on;
      for (const el of [minimap.el, compass.el, keyHints.el]) ui.setVisible(el, hudVisible);
      if (hudVisible) keyHints.sync();
    },
    refreshThumbnails() {
      title.thumbs.cache.clear();
      if (modes.is('title')) title.screen.mount({ intro: false });
    },
  });
  progress(1);
  return shell;
}
