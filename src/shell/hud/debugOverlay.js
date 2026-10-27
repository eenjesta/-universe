/**
 * FPS / debug overlay. `settings.showFps` (or `?debug`) shows a one-line
 * readout in the top-right corner: FPS · draw calls · triangles; `?debug`
 * adds a panel with frame time, memory, mode, camera/player position and
 * module errors. Everything comes from ctx.debug.info(), sampled twice per
 * second (the engine resets its render counters once per frame).
 */
import { t, locale } from '../../core/i18n.js';
import { formatNumber } from '../util.js';

/** 1240000 → "1.24 M", 85400 → "85.4 k" (decimal sign of the active language). */
function compact(n) {
  if (!Number.isFinite(n)) return '–';
  const dec = (v, d) => v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
  if (n >= 1e6) return `${dec(n / 1e6, 2)} M`;
  if (n >= 1e4) return `${dec(n / 1e3, 1)} k`;
  return formatNumber(n);
}

export class DebugOverlay {
  constructor(ctx, frame, { verbose = false } = {}) {
    this.ctx = ctx;
    this.frame = frame;
    this.verbose = verbose;
    const h = ctx.ui.h;
    this.fpsNum = h('b', { class: 'shell-fps-num' });
    this.fpsStats = h('span', { class: 'shell-fps-stats' });
    this.fpsEl = h('div', { class: 'shell-fps', 'aria-hidden': 'true' }, this.fpsNum, this.fpsStats);
    ctx.ui.layers.hud.appendChild(this.fpsEl);
    this.panel = null;
    this.rows = {};
    if (verbose) {
      const row = (key, label) => {
        const v = h('span', { class: 'shell-debug-v' });
        this.rows[key] = v;
        return h('div', { class: 'shell-debug-row' }, h('span', { class: 'shell-debug-k', text: t(label) }), v);
      };
      this.panel = h(
        'div',
        { class: 'shell-debug' },
        h('div', { class: 'shell-debug-title', text: 'Debug' }),
        row('fps', 'FPS'),
        row('ms', 'Frame'),
        row('calls', 'Draw calls'),
        row('tris', { en: 'Triangles', nl: 'Driehoeken' }),
        row('mem', 'Geo / tex'),
        row('mode', { en: 'Mode', nl: 'Modus' }),
        row('cam', 'Camera'),
        row('pos', { en: 'Position', nl: 'Positie' }),
        row('errors', { en: 'Errors', nl: 'Fouten' }),
      );
      ctx.ui.layers.hud.appendChild(this.panel);
    }
    this.showFps = false;
    this._acc = 1;
    this._frames = 0;
    this._time = 0;
    this.setShowFps(false);
  }

  setShowFps(on) {
    this.showFps = !!on;
    this.fpsEl.hidden = !(this.showFps || this.verbose);
  }

  update(dt) {
    if (this.fpsEl.hidden) return;
    this._acc += dt;
    this._frames++;
    this._time += dt;
    if (this._acc < 0.5) return;
    const fps = this._frames / Math.max(1e-3, this._time);
    this._acc = 0;
    this._frames = 0;
    this._time = 0;
    let info = null;
    try {
      info = this.ctx.debug?.info?.();
    } catch {
      info = null;
    }
    this.fpsNum.textContent = `${Math.round(fps)} FPS`;
    this.fpsStats.textContent = info
      ? t({ en: ' · {calls} draw calls · {tris} triangles', nl: ' · {calls} draw calls · {tris} driehoeken' }, { calls: compact(info.drawCalls ?? 0), tris: compact(info.triangles ?? 0) })
      : '';
    this.fpsEl.classList.toggle('is-low', fps < 30);
    if (!this.panel) return;
    const r = this.rows;
    r.fps.textContent = `${Math.round(fps)}`;
    r.ms.textContent = `${(1000 / Math.max(1, fps)).toFixed(1)} ms`;
    if (info) {
      r.calls.textContent = formatNumber(info.drawCalls ?? 0);
      r.tris.textContent = formatNumber(info.triangles ?? 0);
      r.mem.textContent = `${info.geometries ?? 0} / ${info.textures ?? 0}`;
      r.mode.textContent = `${info.mode} · ${this.ctx.engine.quality?.id ?? ''}`;
      const n = info.errors?.length || 0;
      r.errors.textContent = n ? `${n} (${info.errors.map((e) => e.module).join(', ')})` : '0';
      r.errors.classList.toggle('is-bad', n > 0);
    }
    const cam = this.ctx.engine.camera;
    if (cam) {
      const p = cam.position;
      r.cam.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · ${Math.round(this.frame.bearing)}°`;
    }
    const f = this.frame.focus;
    r.pos.textContent = `${f.x.toFixed(1)}, ${f.y.toFixed(1)}, ${f.z.toFixed(1)}`;
  }
}
