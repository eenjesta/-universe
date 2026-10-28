/**
 * Compass strip (top-center, explore/drive): cardinal + intercardinal letters
 * (N, NE, E, SE, S, SW, W, NW; Dutch N, NO, O, ZO, Z, ZW, W, NW), tick marks
 * every 15°, a centre caret and, at their bearings:
 *   - ctx.markers by kind: quest (cyan diamond, or the marker's colour — the gold
 *     death crate), waypoint (gold pin), boss (red crown), enemy (small red
 *     diamond, m.color), loot (gold icon, e.g. a cleared POI's cache, ≤ 900 m),
 *     npc (violet), poi (light diamond, ≤ 1.6 km);
 *   - wilderness POIs (type icon; undiscovered ones as a dim "?" within ~520 m), the two nearest
 *     highway waystones (small cyan diamonds, "East Highway · km 3");
 *   - the safe zone (Ø, when you are outside it) and your base (claim / spawn beacon);
 * plus the distance of the tracked marker (clamped to the strip ends with an arrow
 * when it is behind you) and a name + distance label for whatever sits right under
 * the caret. Overlapping symbols are decluttered by priority.
 */
import { t } from '../../core/i18n.js';
import { degDiff, formatDistance, iconImage, imageReady } from '../util.js';
import { declutter, DISCOVERY } from '../logic.js';
import { POI_STYLE, poiName } from '../wild.js';

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
const LABEL_SPAN = 7; // a symbol within this many degrees of the caret gets a name label
const PRIORITY = { boss: 9, waypoint: 8, quest: 7, enemy: 6, loot: 6, hub: 5, base: 5, wild: 4, npc: 3, poi: 2, waystone: 2, unknown: 1 };
const HOME_ICONS = { base: 'shell-home', bed: 'shell-bed', beacon: 'shell-beacon' };
const TXT = {
  safeZone: { en: 'Safe zone', nl: 'Veilige zone' },
  base: { en: 'Your base', nl: 'Jouw basis' },
  bed: { en: 'Your bed', nl: 'Jouw bed' },
  beacon: { en: 'Spawn beacon', nl: 'Spawnbaken' },
  unknown: { en: 'Unexplored', nl: 'Onontdekt' },
};

export class Compass {
  constructor(ctx, frame) {
    this.ctx = ctx;
    this.frame = frame;
    const h = ctx.ui.h;
    this.canvas = h('canvas', { class: 'shell-compass-canvas', 'aria-hidden': 'true' });
    this.el = h('div', { class: 'shell-compass', role: 'img', 'aria-label': t({ en: 'Compass', nl: 'Kompas' }) }, this.canvas);
    this.dirs = DIRS.map((d) => ({ b: d.b, major: !!d.major, north: d.b === 0, text: t(d.t) }));
    this.txt = Object.fromEntries(Object.entries(TXT).map(([k, v]) => [k, t(v)]));
    ctx.ui.addWidget('top-center', this.el, { modes: ['explore', 'drive'], order: 10 });
    this.g = this.canvas.getContext('2d');
    this.w = 0;
    this.hgt = 56;
    this.dpr = 1;
    this._dirty = true;
    this._sigv = null;
    this._lastTracked = null;
    this._items = [];
    this._pool = [];
    this._iconsPending = false;
    window.addEventListener('resize', () => (this._dirty = true));
  }

  _layout() {
    const w = Math.round(this.el.clientWidth || 520);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && dpr === this.dpr && !this._dirty) return;
    this._dirty = false;
    if (this._sigv) this._sigv.fill(NaN);
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
    // skip redraws when nothing visible changed (heading to 0.1°, positions to ~4 m, tracked distance to 1 m);
    // a numeric signature — no per-frame string building
    const tr = f.tracked;
    const sig = this._sigv || (this._sigv = new Float64Array(11));
    const v0 = Math.round(f.bearing * 10);
    const v1 = f.count;
    const v2 = Math.round(f.focus.x / 4);
    const v3 = Math.round(f.focus.z / 4);
    const v4 = f.wildCount * 16 + f.wayCount * 4 + (f.home.hub ? 1 : 0) + (f.home.base ? 2 : 0);
    const v5 = tr ? Math.round(tr.dist) : -1;
    const v6 = tr ? Math.round(tr.bearing * 10) : -1;
    const v7 = this.w;
    const v8 = this._iconsPending ? 1 : 0;
    const v9 = this._markerSum();
    if (
      !v8 &&
      this._lastTracked === (tr ? tr.m : null) &&
      sig[0] === v0 && sig[1] === v1 && sig[2] === v2 && sig[3] === v3 && sig[4] === v4 &&
      sig[5] === v5 && sig[6] === v6 && sig[7] === v7 && sig[9] === v9
    )
      return;
    sig[0] = v0;
    sig[1] = v1;
    sig[2] = v2;
    sig[3] = v3;
    sig[4] = v4;
    sig[5] = v5;
    sig[6] = v6;
    sig[7] = v7;
    sig[9] = v9;
    this._lastTracked = tr ? tr.m : null;
    this._draw();
  }

  /** Coarse checksum of the marker bearings (moving enemies change the strip without the player moving). */
  _markerSum() {
    const f = this.frame;
    let sum = 0;
    for (let i = 0; i < f.count; i++) sum += Math.round(f.entries[i].bearing) * (i + 1);
    return sum;
  }

  _item(i) {
    let it = this._pool[i];
    if (!it) it = this._pool[i] = { x: 0, p: 0, kind: '', color: '', icon: null, label: '', dist: 0, diff: 0 };
    return it;
  }

  /** Collects the symbols to draw this frame (pooled, no allocations except the declutter result). */
  _collect(ppd, cx) {
    const f = this.frame;
    const items = this._items;
    items.length = 0;
    let n = 0;
    const push = (kind, bearing, dist, color, icon, label, p = PRIORITY[kind] ?? 1) => {
      const diff = degDiff(f.bearing, bearing);
      if (Math.abs(diff) > SPAN) return;
      const it = this._item(n++);
      it.x = cx + diff * ppd;
      it.diff = diff;
      it.p = p;
      it.kind = kind;
      it.color = color;
      it.icon = icon;
      it.label = label;
      it.dist = dist;
      items.push(it);
    };
    for (let i = 0; i < f.count; i++) {
      const e = f.entries[i];
      const m = e.m;
      if (m.compass === false || e.hidden || e === f.tracked) continue;
      const kind = m.kind;
      if (kind === 'poi' && e.dist > 1600) continue;
      if ((kind === 'npc' || kind === 'vehicle' || kind === 'friendly') && e.dist > 400) continue;
      const label = typeof m.label === 'string' ? m.label : t(m.label || '');
      if (kind === 'quest') push('quest', e.bearing, e.dist, m.color || '#7fe0ff', null, label);
      else if (kind === 'waypoint') push('waypoint', e.bearing, e.dist, m.color || '#ffd27a', 'shell-waypoint', label);
      else if (kind === 'boss') push('boss', e.bearing, e.dist, m.color || '#ff4a3d', 'shell-boss', label);
      else if (kind === 'enemy') push('enemy', e.bearing, e.dist, m.color || '#ff5a4e', null, label);
      else if (kind === 'loot') e.dist <= 900 && push('loot', e.bearing, e.dist, m.color || '#ffd27f', m.icon || 'star', label);
      else if (kind === 'npc') push('npc', e.bearing, e.dist, '#b48cff', null, label);
      else push('poi', e.bearing, e.dist, 'rgba(236, 230, 220, 0.85)', null, label);
    }
    for (let i = 0; i < f.wildCount; i++) {
      const e = f.wildEntries[i];
      const st = POI_STYLE[e.poi.type];
      if (e.known) {
        if (e.dist <= 1600) push('wild', e.bearing, e.dist, st?.color || '#ece6dc', st?.icon || 'pin', poiName(e.poi));
      } else if (e.dist <= DISCOVERY.reveal) push('unknown', e.bearing, e.dist, 'rgba(236, 230, 220, 0.55)', 'shell-question', this.txt.unknown);
    }
    for (let i = 0; i < f.wayCount; i++) {
      const e = f.wayEntries[i];
      if (e.dist > 14) push('waystone', e.bearing, e.dist, '#5ff2ff', null, e.label);
    }
    if (f.home.hub) push('hub', f.home.hub.bearing, f.home.hub.dist, '#7fe0ff', 'shell-hub', this.txt.safeZone);
    const hb = f.home.base;
    if (hb) push('base', hb.bearing, hb.dist, '#7fe0ff', HOME_ICONS[hb.kind] || 'shell-home', this.txt[hb.kind] || this.txt.base);
    return declutter(items, 11);
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
    g.shadowBlur = 0;

    // symbols on the line
    this._iconsPending = false;
    const kept = this._collect(ppd, cx);
    let label = null;
    for (const it of kept) {
      const fade = 1 - Math.max(0, (Math.abs(it.diff) - SPAN * 0.75) / (SPAN * 0.25));
      g.globalAlpha = fade;
      this._symbol(g, it, lineY + 0.5);
      if (Math.abs(it.diff) <= LABEL_SPAN && it.label && (!label || it.p > label.p || (it.p === label.p && Math.abs(it.diff) < Math.abs(label.diff)))) label = it;
    }
    g.globalAlpha = 1;

    // tracked marker: diamond + distance (clamped to the ends)
    const tr = f.tracked;
    let trackedNear = false;
    if (tr) {
      const diff = degDiff(f.bearing, tr.bearing);
      const inside = Math.abs(diff) <= SPAN;
      trackedNear = Math.abs(diff) < 16;
      const x = inside ? cx + diff * ppd : diff < 0 ? 14 : W - 14;
      const kind = tr.m.kind;
      const color = kind === 'waypoint' ? tr.m.color || '#ffd27a' : kind === 'boss' ? '#ff4a3d' : tr.m.color && kind === 'quest' ? tr.m.color : '#7fe0ff';
      if (kind === 'waypoint' || kind === 'boss') this._symbol(g, { x, kind, color, icon: kind === 'boss' ? 'shell-boss' : 'shell-waypoint' }, lineY + 0.5, 1.25);
      else this._diamond(g, x, lineY + 0.5, 5.5, color, true);
      g.shadowColor = 'rgba(0, 0, 0, 0.75)';
      g.shadowBlur = 4;
      g.font = '500 12px Jost, system-ui, sans-serif';
      g.fillStyle = '#ffffff';
      g.textAlign = inside ? 'center' : diff < 0 ? 'left' : 'right';
      const text = inside ? formatDistance(tr.dist) : diff < 0 ? `‹ ${formatDistance(tr.dist)}` : `${formatDistance(tr.dist)} ›`;
      g.fillText(text, inside ? x : diff < 0 ? 4 : W - 4, lineY + 22);
      g.shadowBlur = 0;
    }

    // name + distance of the symbol under the caret
    if (label && !trackedNear) {
      g.shadowColor = 'rgba(0, 0, 0, 0.8)';
      g.shadowBlur = 4;
      g.textAlign = 'center';
      g.font = '500 11.5px Jost, system-ui, sans-serif';
      g.fillStyle = label.kind === 'enemy' || label.kind === 'boss' ? '#ffb1a8' : 'rgba(255, 255, 255, 0.95)';
      g.fillText(`${label.label} · ${formatDistance(label.dist)}`, cx, lineY + 23);
      g.shadowBlur = 0;
    }

    // centre caret
    g.fillStyle = '#7fe0ff';
    g.beginPath();
    g.moveTo(cx - 5, lineY + 9);
    g.lineTo(cx + 5, lineY + 9);
    g.lineTo(cx, lineY + 3.5);
    g.closePath();
    g.fill();
  }

  _symbol(g, it, y, scale = 1) {
    const x = it.x;
    switch (it.kind) {
      case 'quest':
        this._diamond(g, x, y, 4.5, it.color, true);
        return;
      case 'enemy':
        this._diamond(g, x, y, 3.6, it.color, false, true);
        return;
      case 'npc':
        this._diamond(g, x, y, 3.2, it.color, false);
        return;
      case 'poi':
        this._diamond(g, x, y, 3.2, it.color, false);
        return;
      case 'waystone':
        this._diamond(g, x, y, 3, it.color, true);
        return;
      default: {
        // icon symbols: dark disc + line icon
        const r = 6.5 * scale;
        g.save();
        if (it.kind === 'boss' || it.kind === 'waypoint' || it.kind === 'hub' || it.kind === 'loot') {
          g.shadowColor = it.kind === 'boss' ? 'rgba(255, 74, 61, 0.8)' : it.kind === 'hub' ? 'rgba(127, 224, 255, 0.7)' : 'rgba(255, 210, 122, 0.75)';
          g.shadowBlur = 7;
        }
        g.fillStyle = 'rgba(8, 12, 18, 0.9)';
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.strokeStyle = it.color;
        g.lineWidth = 1.1;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
        const img = iconImage(it.icon || 'pin', it.color, 32, 1.9);
        if (imageReady(img)) g.drawImage(img, x - r + 1.8, y - r + 1.8, 2 * r - 3.6, 2 * r - 3.6);
        else this._iconsPending = true;
      }
    }
  }

  _diamond(g, x, y, s, color, glow, filled = false) {
    g.save();
    if (glow) {
      g.shadowColor = color === '#7fe0ff' ? 'rgba(127, 224, 255, 0.8)' : color;
      g.shadowBlur = 7;
    }
    g.fillStyle = filled ? color : 'rgba(8, 12, 18, 0.9)';
    g.strokeStyle = filled ? 'rgba(30, 6, 6, 0.9)' : color;
    g.lineWidth = filled ? 1 : 1.5;
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
