import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Loop } from './core/loop.js';
import { Input } from './core/input.js';
import { Events } from './core/events.js';
import { State } from './core/state.js';
import { Physics } from './core/physics.js';
import { Interactions } from './core/interactions.js';
import { Markers } from './core/markers.js';
import { Modes } from './core/modes.js';
import { UI } from './core/ui.js';
import { AudioEngine } from './core/audio.js';
import { ZONES, WORLD } from './world/layout.js';
import { installGfx } from './core/gfxpanel.js';
import { i18n, initLanguage, t } from './core/i18n.js';

/**
 * Module manifest. Each module's index.js exports `install(ctx, helpers)`
 * (may be async) and returns its public API, stored as ctx[name]. Modules may
 * also attach extra APIs to ctx themselves (see ARCHITECTURE.md).
 * If a module fails to load or install, its fallback (src/fallback/*) is used
 * so the rest of the game keeps working.
 */
const MODULES = [
  { name: 'world', label: { en: 'Terrain, water and sky', nl: 'Terrein, water en lucht' }, load: () => import('./world/index.js'), fallback: () => import('./fallback/world.js') },
  { name: 'landmarks', label: { en: 'City and landmarks', nl: 'Stad en bezienswaardigheden' }, load: () => import('./landmarks/index.js'), fallback: () => import('./fallback/landmarks.js') },
  { name: 'characters', label: { en: 'Characters', nl: 'Personages' }, load: () => import('./characters/index.js'), fallback: () => import('./fallback/characters.js') },
  { name: 'vehicles', label: { en: 'Vehicles', nl: 'Voertuigen' }, load: () => import('./vehicles/index.js'), fallback: () => import('./fallback/vehicles.js') },
  { name: 'build', label: { en: 'Building', nl: 'Bouwsysteem' }, load: () => import('./build/index.js'), fallback: () => import('./fallback/build.js') },
  { name: 'space', label: { en: 'Space', nl: 'Ruimte' }, load: () => import('./space/index.js'), fallback: () => import('./fallback/space.js') },
  { name: 'systems', label: { en: 'Missions, stories and chat', nl: 'Missies, verhalen en chat' }, load: () => import('./systems/index.js'), fallback: () => import('./fallback/systems.js') },
  { name: 'sound', label: { en: 'Sound', nl: 'Geluid' }, load: () => import('./audio/index.js'), fallback: () => import('./fallback/audio.js') },
  { name: 'shell', label: { en: 'Interface', nl: 'Interface' }, load: () => import('./shell/index.js'), fallback: () => import('./fallback/shell.js') },
];

function parseParams() {
  const q = new URLSearchParams(location.search);
  const out = {};
  for (const [k, v] of q) out[k] = v === '' ? true : v;
  return out;
}

export async function createGame() {
  const params = parseParams();
  const canvas = document.getElementById('gl');
  const events = new Events();
  const state = new State(events, { persist: !params.nosave });
  if (!params.fresh) state.load();
  else state.reset();
  initLanguage(params.lang || state.get('settings.language') || 'en');

  const qualityId = params.quality || state.get('settings.quality') || 'high';
  const engine = new Engine(canvas, qualityId, params);
  engine.events = events;
  const loop = new Loop();
  const input = new Input(canvas, events);
  input.sensitivity = state.get('settings.sensitivity') ?? 1;
  input.invertY = !!state.get('settings.invertY');

  const ctx = {
    THREE,
    params,
    events,
    state,
    engine,
    loop,
    input,
    physics: new Physics(),
    markers: new Markers(events),
    audio: new AudioEngine(events),
    camera: new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.15, 6000),
    ready: false,
    errors: [],
  };
  ctx.audio.setVolumes({
    master: state.get('settings.volume'),
    music: state.get('settings.music'),
    sfx: state.get('settings.sfx'),
  });
  ctx.i18n = i18n;
  ctx.ui = new UI(ctx);
  ctx.gfx = installGfx(ctx); // graphics diagnostics switches + panel (` key / ?gfx)
  ctx.modes = new Modes(ctx);
  ctx.interactions = new Interactions(ctx);
  ctx.debug = createDebug(ctx);
  window.__game = ctx;

  // Core systems (modules add their own with loop.add).
  loop.add('modes', (dt, t) => ctx.modes.update(dt, t), { order: 20 });
  loop.add('interactions', (dt) => ctx.interactions.update(dt), { order: 45 });
  loop.add('ui-prompts', () => ctx.ui.prompt.update(), { order: 96, pausable: false });
  loop.add('playtime', (dt) => {
    ctx._playtime = (ctx._playtime || 0) + dt;
    if (ctx._playtime > 10) {
      state.data.stats.playtime += ctx._playtime;
      ctx._playtime = 0;
    }
  }, { order: 99 });
  loop.render = (dt, t) => engine.render(dt, t);
  loop.afterFrame = () => input.endFrame();
  engine.setView(ctx.modes.current.scene, ctx.modes.current.camera);
  loop.start();

  // Boot UI
  const bar = document.getElementById('boot-progress');
  const status = document.getElementById('boot-status');
  const setProgress = (p, text) => {
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    if (status && text) status.textContent = text;
  };

  // Install modules sequentially (later modules may use earlier APIs).
  for (let i = 0; i < MODULES.length; i++) {
    const m = MODULES[i];
    setProgress(i / MODULES.length, `${t(m.label)}…`);
    await new Promise((r) => setTimeout(r, 0)); // let the progress bar paint
    const helpers = {
      progress: (p) => setProgress((i + Math.max(0, Math.min(1, p))) / MODULES.length),
    };
    let api = null;
    try {
      const mod = await m.load();
      api = await mod.install(ctx, helpers);
    } catch (err) {
      console.error(`[game] module "${m.name}" failed — using fallback`, err);
      ctx.errors.push({ module: m.name, error: String(err?.stack || err) });
      try {
        const fb = await m.fallback();
        api = await fb.install(ctx, helpers);
      } catch (err2) {
        console.error(`[game] fallback for "${m.name}" failed too`, err2);
      }
    }
    ctx[m.name] = api ?? ctx[m.name] ?? {};
  }
  setProgress(1, t({ en: 'Ready', nl: 'Klaar' }));

  events.emit('game:installed', ctx);
  await startInitialMode(ctx);

  // Fade out the boot screen once a few frames have rendered.
  await waitFrames(loop, 3);
  document.getElementById('boot')?.classList.add('done');
  setTimeout(() => document.getElementById('boot')?.remove(), 900);
  ctx.ready = true;
  events.emit('game:ready', ctx);
  if (params.diag) {
    // GPU diagnostics on the player's machine (see src/core/diag.js)
    const delay = Number(params.diag) > 100 ? Number(params.diag) : 6000;
    setTimeout(() => import('./core/diag.js').then((m) => m.runDiagnostics(ctx)).catch((err) => console.error('[diag] failed', err)), delay);
  }
  return ctx;
}

function waitFrames(loop, n) {
  const target = loop.frame + n;
  return new Promise((res) => {
    const check = () => (loop.frame >= target ? res() : requestAnimationFrame(check));
    check();
  });
}

async function startInitialMode(ctx) {
  const p = ctx.params;
  let mode = p.mode || (p.zone || p.vehicle || p.build ? 'explore' : 'title');
  if (!ctx.modes.has(mode)) {
    console.warn(`[game] mode "${mode}" not registered, falling back`);
    mode = ctx.modes.has('title') ? 'title' : ctx.modes.has('explore') ? 'explore' : 'boot';
  }
  if (p.time != null && ctx.world?.setTimeOfDay) ctx.world.setTimeOfDay(parseFloat(p.time));
  await ctx.modes.go(mode, { zone: p.zone || null, initial: true }, { fade: false });
  if (p.vehicle && ctx.vehicles?.summonAndEnter) await ctx.vehicles.summonAndEnter(p.vehicle);
  if (p.build && ctx.build?.enter) ctx.build.enter();
  ctx.events.emit('game:start', { mode });
}

function createDebug(ctx) {
  return {
    /** Teleport the player to a zone id or {x, z}. */
    teleport(target, heading) {
      return ctx.player?.teleport?.(target, heading);
    },
    go(mode, params) {
      return ctx.modes.go(mode, params || {});
    },
    setTime(h) {
      ctx.world?.setTimeOfDay?.(h);
    },
    zones: ZONES,
    world: WORLD,
    /** Resolves after n rendered frames (used by tools/shot.mjs). */
    frames(n = 1) {
      return waitFrames(ctx.loop, n);
    },
    /**
     * Fast, frame-rate independent simulation for headless tests: runs every
     * loop system `seconds / dt` times without rendering while the given keys
     * are held. `press` keys are pressed on the first step only.
     *   __game.debug.simulate(2, { hold: ['KeyW', 'ShiftLeft'] })
     *   __game.debug.simulate(0.1, { press: ['KeyB'] })
     *   __game.debug.simulate(1, { look: [300, 0] })   // mouse-look pixels spread over the run
     */
    simulate(seconds = 1, { hold = [], press = [], look = null, dt = 1 / 30 } = {}) {
      const input = ctx.input;
      const steps = Math.max(1, Math.round(seconds / dt));
      hold.forEach((c) => input.keys.add(c));
      for (let i = 0; i < steps; i++) {
        if (i === 0) {
          press.forEach((c) => {
            input.keys.add(c);
            input._pressed.add(c);
          });
        }
        if (look) {
          input.lookX = (look[0] / steps) * input.sensitivity;
          input.lookY = (look[1] / steps) * input.sensitivity;
        }
        ctx.loop.step(dt);
        if (i === 0) press.forEach((c) => input.keys.delete(c) || input._released.add(c));
      }
      hold.forEach((c) => input.keys.delete(c));
      return { steps, time: ctx.loop.time };
    },
    /** Simple overview of what is running. */
    info() {
      return {
        mode: ctx.modes.name,
        fps: Math.round(ctx.loop.fps),
        systems: ctx.loop.systems.map((s) => s.name + (s.disabled ? ' (disabled)' : '')),
        errors: ctx.errors,
        drawCalls: ctx.engine.renderer.info.render.calls,
        triangles: ctx.engine.renderer.info.render.triangles,
        geometries: ctx.engine.renderer.info.memory.geometries,
        textures: ctx.engine.renderer.info.memory.textures,
      };
    },
  };
}
