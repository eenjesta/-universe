/**
 * HUD layout helper: tracks the bottom edge of the top-center slot (compass strip,
 * zone pill, banners) so other HUD pieces stay out of it:
 *   - CSS var --shell-top-band on :root (px) → toasts start below the stack (hud.css),
 *   - screen markers flip their labels below the diamond near the band,
 *   - --shell-hud-scale (settings.hudScale) for the HUD scale setting.
 * One ResizeObserver; no per-frame layout reads.
 */
export class HudLayout {
  constructor(ctx) {
    this.ctx = ctx;
    this.top = 0;
    const slot = ctx.ui.slot('top-center');
    const root = document.documentElement;
    const measure = () => {
      const r = slot.getBoundingClientRect();
      const top = r.height > 4 ? Math.round(r.bottom) : 0;
      if (top === this.top) return;
      this.top = top;
      root.style.setProperty('--shell-top-band', `${top}px`);
    };
    this.measure = measure;
    try {
      this._ro = new ResizeObserver(measure);
      this._ro.observe(slot);
    } catch {
      /* old browsers: resize + mode changes only */
    }
    window.addEventListener('resize', measure);
    ctx.events.on('mode:change', () => requestAnimationFrame(measure));
    measure();
  }

  setScale(v) {
    const s = Math.max(0.7, Math.min(1.3, Number(v) || 1));
    document.documentElement.style.setProperty('--shell-hud-scale', String(s));
    requestAnimationFrame(this.measure);
  }
}
