/**
 * Round HUD minimap (bottom-left, explore/drive). Rotates with the camera
 * heading, shows the shared map image (terrain), N/O/Z/W around the ring, a
 * view cone, the player arrow and ctx.markers as icons (quest markers clamp
 * to the rim). Zooms out with vehicle speed. Drawn on a 2D canvas.
 */
import { worldToUV, MAP_EXTENT } from '../map/mapImage.js';
import { iconImage, imageReady } from '../util.js';
import { damp, clamp } from '../../core/math.js';

const TAU = Math.PI * 2;
const LETTERS = [
  { t: 'N', dx: 0, dz: -1 },
  { t: 'O', dx: 1, dz: 0 },
  { t: 'Z', dx: 0, dz: 1 },
  { t: 'W', dx: -1, dz: 0 },
];
/** CanvasRenderingContext2D.filter support (not in every Safari). */
const HAS_FILTER = (() => {
  try {
    const g = document.createElement('canvas').getContext('2d');
    if (!('filter' in g)) return false;
    g.filter = 'brightness(0.5)';
    return g.filter === 'brightness(0.5)';
  } catch {
    return false;
  }
})();

const KIND_COLORS = {
  quest: '#7fe0ff',
  poi: '#ece6dc',
  npc: '#b48cff',
  friendly: '#8fe3a8',
  vehicle: '#ece6dc',
  enemy: '#ff7a6e',
  station: '#ece6dc',
};

export class Minimap {
  constructor(ctx, frame, mapImage) {
    this.ctx = ctx;
    this.frame = frame;
    this.mapImage = mapImage;
    const h = ctx.ui.h;
    this.canvas = h('canvas', { class: 'shell-minimap-canvas', 'aria-hidden': 'true' });
    this.el = h('div', { class: 'shell-minimap', role: 'img', 'aria-label': 'Minikaart' }, this.canvas);
    ctx.ui.addWidget('bottom-left', this.el, { modes: ['explore', 'drive'], order: 10 });
    this.g = this.canvas.getContext('2d');
    this.size = 0;
    this.dpr = 1;
    this.radiusM = 115; // world metres from centre to rim
    this.mapAlpha = 0; // baked high-res map
    this.previewAlpha = 0; // terrain preview (world.minimap)
    this._uv = [0, 0];
    this._sig = { x: NaN, z: NaN, h: NaN, fh: NaN, r: NaN, a: NaN, m: NaN };
    this._force = true;
    this._dirty = true;
    this._discGrad = null;
    this._vignette = null;
    this._cone = null;
    window.addEventListener('resize', () => (this._dirty = true));
  }

  _layout() {
    const css = Math.round(this.el.clientWidth || 190);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (css === this.size && dpr === this.dpr && !this._dirty) return;
    this._dirty = false;
    this._force = true;
    this.size = css;
    this.dpr = dpr;
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
    this.canvas.style.width = `${css}px`;
    this.canvas.style.height = `${css}px`;
    const c = css / 2;
    this.R = c - 17; // leave room for the letters outside the ring
    const g = this.g;
    this._discGrad = g.createRadialGradient(c, c, 0, c, c, this.R);
    this._discGrad.addColorStop(0, 'rgba(14, 22, 32, 0.80)');
    this._discGrad.addColorStop(1, 'rgba(6, 10, 16, 0.86)');
    this._vignette = g.createRadialGradient(c, c, this.R * 0.45, c, c, this.R);
    this._vignette.addColorStop(0, 'rgba(6, 10, 16, 0)');
    this._vignette.addColorStop(1, 'rgba(6, 10, 16, 0.62)');
    this._cone = g.createLinearGradient(c, c, c, c - this.R);
    this._cone.addColorStop(0, 'rgba(236, 230, 220, 0.16)');
    this._cone.addColorStop(1, 'rgba(236, 230, 220, 0)');
  }

  update(dt) {
    if (this.el.hidden) return;
    this._layout();
    if (!this.R || this.R < 20) return;
    const f = this.frame;
    // zoom out with speed (vehicles), a little more when flying high
    const veh = f.vehicle();
    let target = 115;
    if (veh) {
      const ground = this.ctx.world?.getHeightAt?.(f.focus.x, f.focus.z) ?? 0;
      const alt = Math.max(0, f.focus.y - ground);
      target = clamp(140 + f.speed * 5.5 + alt * 1.2, 140, 520);
    }
    this.radiusM = damp(this.radiusM, target, 2.2, dt);
    // terrain preview fades in at once; the baked map cross-fades over it
    if (this.mapImage.preview()) this.previewAlpha = Math.min(1, this.previewAlpha + dt * 1.6);
    if (this.mapImage.ready && this.mapAlpha < 1) {
      this.mapAlpha = Math.min(1, this.mapAlpha + dt * 1.2);
      // fully cross-faded: the preview's filtered copy is no longer needed
      if (this.mapAlpha >= 1) for (const key of [...(this._hudCache?.keys() || [])]) if (key !== this.mapImage.canvas) this._hudCache.delete(key);
    }
    // redraw only when something visible changed (standing still costs nothing)
    const s = this._sig;
    const fx = f.focus.x;
    const fz = f.focus.z;
    let markerSum = f.count;
    for (let i = 0; i < f.count; i++) markerSum += f.entries[i].x * 0.37 + f.entries[i].z * 0.73;
    if (
      !this._force &&
      Math.abs(s.x - fx) < 0.04 &&
      Math.abs(s.z - fz) < 0.04 &&
      Math.abs(s.h - f.heading) < 0.0015 &&
      Math.abs(s.fh - f.focusHeading) < 0.01 &&
      Math.abs(s.r - this.radiusM) < 0.05 &&
      s.a === this.mapAlpha + this.previewAlpha * 2 &&
      Math.abs(s.m - markerSum) < 0.01
    )
      return;
    this._force = false;
    s.x = fx;
    s.z = fz;
    s.h = f.heading;
    s.fh = f.focusHeading;
    s.r = this.radiusM;
    s.a = this.mapAlpha + this.previewAlpha * 2;
    s.m = markerSum;
    this._draw();
  }

  _draw() {
    const g = this.g;
    const f = this.frame;
    const css = this.size;
    const c = css / 2;
    const R = this.R;
    const h = f.heading;
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    const pxPerM = R / this.radiusM;

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, css, css);

    // ---- disc ------------------------------------------------------------
    g.save();
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.clip();
    g.fillStyle = this._discGrad;
    g.fillRect(0, 0, css, css);

    let drew = false;
    const preview = this.mapAlpha < 1 ? this.mapImage.preview() : null;
    if (preview && this.previewAlpha > 0) drew = this._drawMap(g, preview.canvas, preview.extent, c, h, pxPerM, this.previewAlpha);
    if (this.mapImage.ready && this.mapAlpha > 0) drew = this._drawMap(g, this.mapImage.canvas, MAP_EXTENT, c, h, pxPerM, this.mapAlpha) || drew;
    if (drew) {
      g.fillStyle = HAS_FILTER ? 'rgba(8, 18, 30, 0.26)' : 'rgba(8, 18, 30, 0.5)';
      g.fillRect(0, 0, css, css);
    }
    g.fillStyle = this._vignette;
    g.fillRect(0, 0, css, css);

    // view cone (camera looks "up" on a rotating map)
    const half = 0.62;
    g.fillStyle = this._cone;
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, R, -Math.PI / 2 - half, -Math.PI / 2 + half);
    g.closePath();
    g.fill();

    // faint grid: cross + inner ring
    g.strokeStyle = 'rgba(236, 230, 220, 0.10)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(c - R, c);
    g.lineTo(c + R, c);
    g.moveTo(c, c - R);
    g.lineTo(c, c + R);
    g.stroke();
    g.beginPath();
    g.arc(c, c, R * 0.5, 0, TAU);
    g.stroke();
    g.restore();

    // ---- markers -----------------------------------------------------------
    const rim = R - 8;
    for (let i = 0; i < f.count; i++) {
      const e = f.entries[i];
      const m = e.m;
      if (m.compass === false || e.hidden) continue;
      const dx = (e.x - f.focus.x) * pxPerM;
      const dz = (e.z - f.focus.z) * pxPerM;
      let sx = dx * cos - dz * sin;
      let sy = dx * sin + dz * cos;
      const r = Math.hypot(sx, sy);
      const isQuest = m.kind === 'quest';
      if (r > rim) {
        if (!isQuest && e !== f.tracked) continue;
        sx *= rim / r;
        sy *= rim / r;
      }
      this._drawMarker(g, c + sx, c + sy, m, e === f.tracked, r > rim);
    }

    // ---- ring, ticks, letters ----------------------------------------------
    g.strokeStyle = 'rgba(236, 230, 220, 0.55)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(236, 230, 220, 0.18)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(c, c, R + 3.5, 0, TAU);
    g.stroke();
    // ticks every 30°, rotating with the map
    g.lineWidth = 1;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * TAU;
      const wx = Math.sin(ang);
      const wz = -Math.cos(ang);
      const tx = wx * cos - wz * sin;
      const ty = wx * sin + wz * cos;
      if (a % 3 === 0) continue; // cardinal positions carry the letters instead
      g.strokeStyle = 'rgba(236, 230, 220, 0.45)';
      g.beginPath();
      g.moveTo(c + tx * (R - 4), c + ty * (R - 4));
      g.lineTo(c + tx * R, c + ty * R);
      g.stroke();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const L of LETTERS) {
      const tx = L.dx * cos - L.dz * sin;
      const ty = L.dx * sin + L.dz * cos;
      const isN = L.t === 'N';
      g.font = `${isN ? 600 : 500} ${isN ? 12 : 11}px Jost, system-ui, sans-serif`;
      g.fillStyle = isN ? '#ffffff' : 'rgba(236, 230, 220, 0.78)';
      g.shadowColor = 'rgba(0, 0, 0, 0.8)';
      g.shadowBlur = 4;
      g.fillText(L.t, c + tx * (R + 11), c + ty * (R + 11) + 0.5);
      g.shadowBlur = 0;
      // small cyan notch on the ring for north
      if (isN) {
        g.fillStyle = '#7fe0ff';
        g.beginPath();
        g.arc(c + tx * R, c + ty * R, 2.2, 0, TAU);
        g.fill();
      }
    }

    // ---- player arrow ------------------------------------------------------
    g.save();
    g.translate(c, c);
    g.rotate(h - f.focusHeading);
    g.shadowColor = 'rgba(0, 0, 0, 0.7)';
    g.shadowBlur = 5;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3.6);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.fill();
    g.restore();
  }

  /**
   * The HUD wants a dark, cool, quiet version of the map (12/13/16_*.png).
   * The filter is applied once per source into a cached copy instead of on
   * every redraw (canvas filters on a 2048² image are costly per frame).
   */
  _hudVersion(map) {
    if (!HAS_FILTER) return map;
    const cache = this._hudCache || (this._hudCache = new Map());
    let out = cache.get(map);
    if (!out) {
      out = document.createElement('canvas');
      out.width = map.width;
      out.height = map.height;
      const g = out.getContext('2d');
      g.filter = 'saturate(0.62) brightness(0.72) contrast(1.06)';
      g.drawImage(map, 0, 0);
      // keep at most the preview + the baked map
      if (cache.size >= 2) cache.delete(cache.keys().next().value);
      cache.set(map, out);
    }
    return out;
  }

  /** Draws a square map canvas covering ±extent, rotated and centred on the focus. */
  _drawMap(g, src, extent, c, h, pxPerM, alpha) {
    if (!src) return false;
    const map = this._hudVersion(src);
    const S = map.width;
    const f = this.frame;
    worldToUV(f.focus.x, f.focus.z, this._uv, extent);
    const k = pxPerM * ((2 * extent) / S);
    g.save();
    g.translate(c, c);
    g.rotate(h);
    g.scale(k, k);
    g.globalAlpha = 0.92 * alpha;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'medium';
    g.drawImage(map, -this._uv[0] * S, -this._uv[1] * S);
    g.restore();
    return true;
  }

  _drawMarker(g, x, y, m, tracked, clamped) {
    const color = m.color && m.kind !== 'poi' ? m.color : KIND_COLORS[m.kind] || '#ece6dc';
    if (m.kind === 'quest' || tracked) {
      // cyan diamond with glow (+ icon when it fits)
      const s = clamped ? 5 : 6.5;
      g.save();
      g.shadowColor = 'rgba(127, 224, 255, 0.85)';
      g.shadowBlur = 8;
      g.fillStyle = 'rgba(8, 14, 20, 0.85)';
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x, y - s);
      g.lineTo(x + s, y);
      g.lineTo(x, y + s);
      g.lineTo(x - s, y);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, 1.7, 0, TAU);
      g.fill();
      return;
    }
    if (m.kind === 'npc' || m.kind === 'friendly' || m.kind === 'enemy') {
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, 2.6, 0, TAU);
      g.fill();
      return;
    }
    // poi / vehicle / station: line icon on a small dark disc
    const img = iconImage(m.icon || 'pin', color, 32, 1.8);
    g.fillStyle = 'rgba(6, 10, 16, 0.72)';
    g.beginPath();
    g.arc(x, y, 8, 0, TAU);
    g.fill();
    if (imageReady(img)) g.drawImage(img, x - 6.5, y - 6.5, 13, 13);
    else {
      this._force = true; // redraw once the icon has loaded
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, 2.4, 0, TAU);
      g.fill();
    }
  }
}
