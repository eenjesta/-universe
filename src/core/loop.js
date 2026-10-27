import * as THREE from 'three';

/**
 * Frame loop. Systems are registered with a name, an update function and
 * options; they run in ascending `order` every frame:
 *
 *   loop.add('world', (dt, t) => world.update(dt, t), { order: 10 });
 *   loop.add('quests', fn, { order: 60, when: () => ctx.modes.is('explore') });
 *
 * - `when()`     optional predicate; the system is skipped while it returns false
 * - `pausable`   (default true) skipped while `loop.paused` (pause menu)
 *
 * A system that throws is logged (throttled) and keeps running next frame;
 * after 300 consecutive failures it is disabled so the game stays playable.
 */
export class Loop {
  constructor() {
    this.systems = [];
    this.timer = new THREE.Timer();
    this.paused = false;
    this.frozen = false; // test harness: skip systems + render, the canvas keeps the last frame
    this.time = 0; // seconds of unpaused game time
    this.realTime = 0;
    this.frame = 0;
    this.fps = 60;
    this.dt = 0;
    this.render = null; // (dt, t) => void, injected by Game
    this.afterFrame = null; // () => void, injected by Game (input.endFrame)
    this._sorted = true;
    this._tick = this._tick.bind(this);
  }

  add(name, fn, { order = 0, when = null, pausable = true } = {}) {
    this.remove(name);
    this.systems.push({ name, fn, order, when, pausable, errors: 0, lastLog: -1e9, disabled: false });
    this._sorted = false;
    return () => this.remove(name);
  }

  remove(name) {
    const i = this.systems.findIndex((s) => s.name === name);
    if (i >= 0) this.systems.splice(i, 1);
  }

  has(name) {
    return this.systems.some((s) => s.name === name);
  }

  start() {
    this.timer.connect(document);
    requestAnimationFrame(this._tick);
  }

  _runSystems(dt) {
    if (!this._sorted) {
      this.systems.sort((a, b) => a.order - b.order);
      this._sorted = true;
    }

    for (const s of this.systems) {
      if (s.disabled) continue;
      if (this.paused && s.pausable) continue;
      try {
        if (s.when && !s.when()) continue;
        s.fn(dt, s.pausable ? this.time : this.realTime);
        s.errors = 0;
      } catch (err) {
        s.errors++;
        if (this.realTime - s.lastLog > 2) {
          s.lastLog = this.realTime;
          console.error(`[loop] system "${s.name}" threw (x${s.errors})`, err);
        }
        if (s.errors > 300) {
          s.disabled = true;
          console.error(`[loop] system "${s.name}" disabled after repeated errors`);
        }
      }
    }
  }

  /**
   * Runs every system once with a fixed dt, without rendering (used by
   * debug.simulate for fast, frame-rate independent tests).
   */
  step(dt = 1 / 30) {
    this.dt = dt;
    this.realTime += dt;
    if (!this.paused) this.time += dt;
    this._runSystems(dt);
    this.afterFrame?.();
  }

  _tick(ts) {
    requestAnimationFrame(this._tick);
    this.timer.update(ts);
    if (this.frozen) return;
    const raw = this.timer.getDelta();
    const dt = Math.min(raw, 0.05);
    this.dt = dt;
    this.realTime += dt;
    if (!this.paused) this.time += dt;
    if (raw > 0) this.fps += (1 / Math.max(raw, 1e-4) - this.fps) * 0.05;
    this.frame++;

    this._runSystems(dt);

    try {
      this.render?.(dt, this.realTime);
    } catch (err) {
      if (this.frame % 120 === 1) console.error('[loop] render failed', err);
    }
    this.afterFrame?.();
  }
}
