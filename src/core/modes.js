import * as THREE from 'three';

/**
 * Game modes (one active at a time): 'boot', 'title', 'customize', 'explore',
 * 'drive', 'space'. A mode is a plain object:
 *
 *   ctx.modes.register('space', {
 *     scene, camera,              // what the engine renders while active
 *     pointerLock: true,          // mouse-look mode (click grabs the mouse)
 *     hud: 'space',               // free-form tag; body[data-hud] for CSS
 *     async enter(params, from) {},
 *     exit(to) {},
 *     update(dt, t) {},           // runs every frame while active (loop order 20)
 *   });
 *   await ctx.modes.go('space', { from: 'spaceport' });
 *
 * A later register() with the same name replaces the earlier definition.
 * Modes may swap their camera at runtime with ctx.engine.setView(scene, cam).
 */
export class Modes {
  constructor(ctx) {
    this.ctx = ctx;
    this.modes = new Map();
    this.name = null;
    this.current = null;
    this.previous = null;
    this.transitioning = false;
    this._queue = Promise.resolve();
    // Fallback so the engine always has something to render.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090d);
    this.register('boot', { scene, camera: new THREE.PerspectiveCamera(50, 1, 0.1, 100), pointerLock: false, hud: 'none' });
    this.name = 'boot';
    this.current = this.modes.get('boot');
  }

  register(name, mode) {
    this.modes.set(name, mode);
    if (this.name === name) {
      this.current = mode;
      this._applyView();
    }
    return mode;
  }

  has(name) {
    return this.modes.has(name);
  }

  is(...names) {
    return names.includes(this.name);
  }

  /** Switch modes (serialised: concurrent calls run one after another). */
  go(name, params = {}, { fade = true } = {}) {
    this._queue = this._queue.then(() => this._go(name, params, fade)).catch((err) => {
      console.error(`[modes] failed to enter "${name}"`, err);
      this.transitioning = false;
    });
    return this._queue;
  }

  async _go(name, params, fade) {
    const next = this.modes.get(name);
    if (!next) throw new Error(`unknown mode "${name}"`);
    const { ui, input, events } = this.ctx;
    this.transitioning = true;
    if (fade) await ui.fade(true, params.fadeOut ?? 380);
    const from = this.name;
    try {
      this.current?.exit?.(name, params);
    } catch (err) {
      console.error(`[modes] exit of "${from}" failed`, err);
    }
    this.previous = from;
    this.name = name;
    this.current = next;
    document.body.dataset.mode = name;
    document.body.dataset.hud = next.hud || name;
    input.wantsPointerLock = !!next.pointerLock;
    if (!next.pointerLock) input.exitPointerLock();
    await next.enter?.(params, from);
    this._applyView();
    events.emit('mode:change', { from, to: name, params });
    this.transitioning = false;
    if (fade) await ui.fade(false, params.fadeIn ?? 520);
  }

  _applyView() {
    const m = this.current;
    if (m?.scene && m?.camera) this.ctx.engine.setView(m.scene, m.camera);
  }

  update(dt, t) {
    this.current?.update?.(dt, t);
  }
}
