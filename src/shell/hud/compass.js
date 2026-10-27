/**
 * Compass strip (top-center, explore/drive): cardinal + intercardinal letters
 * (N, NE, E, SE, S, SW, W, NW; Dutch N, NO, O, ZO, Z, ZW, W, NW), tick marks
 * every 15°, a centre caret, marker ticks at their bearing and the distance
 * of the tracked quest marker (clamped to the strip ends with an arrow when
 * it is behind you).
 */
import { t } from '../../core/i18n.js';
import { degDiff, formatDistance } from '../util.js';

/** Compass points; `t` = letter(s) per language, resolved when the strip is built. */
const DIRS = [
  { b: 0, t: 'N', major: true },
  { b: 45, t: { en: 'NE', nl: 'NO' } },
  { b: 90, t: { en: 'E', nl: 'O' }, major: true },
  { b: 135, t: { en: 'SE', nl: 'ZO' } },
  { b: 180, t: { en: 'S', nl: 'Z' }, major: true },
  { b: 225, t: { en: 'SW', nl: 'ZW' } },
  { b: 270, t: 'W', major: true },
  { b: 315, t: 'NW' },
];
const SPAN = 82; // degrees visible to each side of the centre

export class Compass {
  constructor(ctx, frame) {
    this.ctx = ctx;
    this.frame = frame;
    const h = ctx.ui.h;
    this.canvas = h('canvas', { class: 'shell-compass-canvas', 'aria-hidden': 'true' });
    this.el = h('div', { class: 'shell-compass', role: 'img', 'aria-label': t({ en: 'Compass', nl: 'Kompas' }) }, this.canvas);
    this.dirs = DIRS.map((d) => ({ b: d.b, major: !!d.major, north: d.b === 0, text: t(d.t) }));
    ctx.ui.addWidget('top-center', this.el, { modes: ['explore', 'drive'], order: 10 });
    this.g = this.canvas.getContext('2d');
    this.w = 0;
    this.hgt = 56;
    this.dpr = 1;
    this._dirty = true;
    this._last = '';
    window.addEventListener('resize', () => (this._dirty = true));
  }

  _layout() {
    const w = Math.round(this.el.clientWidth || 520);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && dpr === this.dpr && !this._dirty) return;
    this._dirty = false;
    this.w = w;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(this.hgt * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${this.hgt}px`;
  }

  update() {
    if (this.el.hidden) return;
    this._layout();
    if (this.w < 60) return;
    const f = this.frame;
    // skip redraws when nothing visible changed (heading to 0.1°, tracked distance to 1 m)
    const tr = f.tracked;
    const key = `${f.bearing.toFixed(1)}|${f.count}|${tr ? `${tr.m.id}:${Math.round(tr.dist)}:${tr.bearing.toFixed(1)}` : '-'}|${this.w}`;
    if (key === this._last) return;
    this._last = key;
    this._draw();
  }

  _draw() {
    const g = this.g;
    const f = this.frame;
    const W = this.w;
    const cx = W / 2;
    const lineY = 27;
    const ppd = (W / 2 - 8) / SPAN; // pixels per degree
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, this.hgt);

    // base line
    g.strokeStyle = 'rgba(236, 230, 220, 0.42)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, lineY + 0.5);
    g.lineTo(W, lineY + 0.5);
    g.stroke();

    // ticks every 15°
    const start = Math.ceil((f.bearing - SPAN) / 15) * 15;
    for (let b = start; b <= f.bearing + SPAN; b += 15) {
      const x = cx + degDiff(f.bearing, b) * ppd;
      const major = ((b % 90) + 90) % 90 === 0;
      const mid = ((b % 45) + 45) % 45 === 0;
      g.strokeStyle = major ? 'rgba(236, 230, 220, 0.85)' : 'rgba(236, 230, 220, 0.45)';
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, lineY - (major ? 6 : mid ? 4 : 3));
      g.lineTo(Math.round(x) + 0.5, lineY);
      g.stroke();
    }

    // letters
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.shadowColor = 'rgba(0, 0, 0, 0.75)';
    g.shadowBlur = 4;
    for (const d of this.dirs) {
      const diff = degDiff(f.bearing, d.b);
      if (Math.abs(diff) > SPAN) continue;
      const x = cx + diff * ppd;
      const fade = 1 - Math.max(0, (Math.abs(diff) - SPAN * 0.7) / (SPAN * 0.3));
      g.globalAlpha = fade;
      g.font = d.major ? '500 14px Jost, system-ui, sans-serif' : '400 11px Jost, system-ui, sans-serif';
      g.fillStyle = d.north ? '#ffffff' : d.major ? 'rgba(236, 230, 220, 0.92)' : 'rgba(236, 230, 220, 0.6)';
      g.fillText(d.text, x, lineY - 10);
    }
    g.globalAlpha = 1;

    // markers on the line (poi/npc: small diamonds; quest: cyan diamond)
    for (let i = 0; i < f.count; i++) {
      const e = f.entries[i];
      const m = e.m;
      if (m.compass === false || e.hidden || e === f.tracked) continue;
      if (m.kind !== 'quest' && e.dist > 1600) continue;
      const diff = degDiff(f.bearing, e.bearing);
      if (Math.abs(diff) > SPAN) continue;
      const x = cx + diff * ppd;
      const quest = m.kind === 'quest';
      this._diamond(g, x, lineY + 0.5, quest ? 4.5 : 3.2, quest ? '#7fe0ff' : m.kind === 'npc' ? '#b48cff' : 'rgba(236, 230, 220, 0.85)', quest);
    }

    // tracked quest marker: diamond + distance (clamped to the ends)
    const tr = f.tracked;
    if (tr) {
      const diff = degDiff(f.bearing, tr.bearing);
      const inside = Math.abs(diff) <= SPAN;
      const x = inside ? cx + diff * ppd : diff < 0 ? 14 : W - 14;
      this._diamond(g, x, lineY + 0.5, 5.5, '#7fe0ff', true);
      g.font = '500 12px Jost, system-ui, sans-serif';
      g.fillStyle = '#ffffff';
      g.textAlign = inside ? 'center' : diff < 0 ? 'left' : 'right';
      const text = inside ? formatDistance(tr.dist) : diff < 0 ? `‹ ${formatDistance(tr.dist)}` : `${formatDistance(tr.dist)} ›`;
      g.fillText(text, inside ? x : diff < 0 ? 4 : W - 4, lineY + 22);
    }
    g.shadowBlur = 0;

    // centre caret
    g.fillStyle = '#7fe0ff';
    g.beginPath();
    g.moveTo(cx - 5, lineY + 9);
    g.lineTo(cx + 5, lineY + 9);
    g.lineTo(cx, lineY + 3.5);
    g.closePath();
    g.fill();
  }

  _diamond(g, x, y, s, color, glow) {
    g.save();
    if (glow) {
      g.shadowColor = 'rgba(127, 224, 255, 0.8)';
      g.shadowBlur = 7;
    }
    g.fillStyle = 'rgba(8, 12, 18, 0.9)';
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s, y);
    g.lineTo(x, y + s);
    g.lineTo(x - s, y);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
