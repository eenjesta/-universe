/**
 * Round HUD minimap (bottom-left; top-left on touch), explore/drive. Rotates with the camera
 * (or north-up: settings.minimapRotate = false) and shows, bottom to top:
 *   - the hub map image (terrain preview, then the baked map) inside ±1200 m,
 *   - the infinite planet beyond it (ctx.frontier.minimap via a cached FrontierLayer that keeps
 *     painting tiles while they stream in),
 *   - the safe-zone border (cyan dashed square |x|, |z| = 1100), claims (yours cyan, others amber,
 *     decaying grey), wilderness POIs (type icon once discovered, "?" until then), other players (violet dots),
 *   - ctx.markers by kind: quest / waypoint / boss clamp to the rim; enemy red dots; POI icons,
 *   - N/E/S/W around the ring (nl N/O/Z/W), the view cone and the player arrow.
 * Zooms out with vehicle speed and a little in the wilderness. Drawn on a 2D canvas, redrawn only
 * when something visible changed.
 */
import { worldToUV, MAP_EXTENT } from '../map/mapImage.js';
import { FrontierLayer, quantMpp, HUB_HOLE } from '../map/frontierLayer.js';
import { POI_STYLE } from '../wild.js';
import { HUB_HALF } from '../logic.js';
import { iconImage, imageReady } from '../util.js';
import { damp, clamp } from '../../core/math.js';
import { t } from '../../core/i18n.js';

const TAU = Math.PI * 2;
/** Ring letters; `t` per language, resolved when the minimap is built. */
const LETTERS = [
  { t: 'N', dx: 0, dz: -1 },
  { t: { en: 'E', nl: 'O' }, dx: 1, dz: 0 },
  { t: { en: 'S', nl: 'Z' }, dx: 0, dz: 1 },
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

/** The HUD's dark, cool, quiet grade of the map — the hub image and the planet layer alike. */
const HUD_FILTER = 'saturate(0.62) brightness(0.72) contrast(1.06)';

const KIND_COLORS = {
  quest: '#7fe0ff',
  poi: '#ece6dc',
  npc: '#b48cff',
  friendly: '#8fe3a8',
  vehicle: '#ece6dc',
  enemy: '#ff5a4e',
  boss: '#ff4a3d',
  waypoint: '#ffd27a',
  station: '#ece6dc',
};
/** Markers that stay visible on the rim when out of range (boss: only out in the wilds within this many m). */
const RIM_KINDS = new Set(['quest', 'waypoint', 'boss']);
const BOSS_RIM = 2500;
const RADIUS_HUB = 115; // m from centre to rim on foot in the hub
const RADIUS_WILD = 150; // … in the wilderness (less detail, more navigation)

export class Minimap {
  constructor(ctx, frame, mapImage, wild = null, settings = null) {
    this.ctx = ctx;
    this.frame = frame;
    this.mapImage = mapImage;
    this.wild = wild;
    this.settings = settings;
    const h = ctx.ui.h;
    this.canvas = h('canvas', { class: 'shell-minimap-canvas', 'aria-hidden': 'true' });
    this.el = h('div', { class: 'shell-minimap', role: 'img', 'aria-label': t({ en: 'Minimap', nl: 'Minikaart' }) }, this.canvas);
    this.letters = LETTERS.map((L) => ({ text: t(L.t), dx: L.dx, dz: L.dz, north: L.dz === -1 }));
    ctx.ui.addWidget('bottom-left', this.el, { modes: ['explore', 'drive'], order: 10 });
    this.g = this.canvas.getContext('2d');
    this.size = 0;
    this.dpr = 1;
    this.radiusM = RADIUS_HUB; // world metres from centre to rim
    this.mapAlpha = 0; // baked high-res map
    this.previewAlpha = 0; // terrain preview (world.minimap)
    this.layer = new FrontierLayer({ settle: 3, every: 0.25 });
    this._uv = [0, 0];
    this._sig = { x: NaN, z: NaN, h: NaN, fh: NaN, r: NaN, a: NaN, m: NaN, v: -1 };
    this._force = true;
    this._dirty = true;
    this._discGrad = null;
    this._vignette = null;
    this._cone = null;
    this._time = 0;
    window.addEventListener('resize', () => (this._dirty = true));
  }

  /** Map rotation (rad): the camera heading, or 0 when the player chose a north-up minimap. */
  get rotation() {
    return this.settings?.get?.('minimapRotate') === false ? 0 : this.frame.heading;
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
    this._cone = g.createLinearGradient(0, 0, 0, -this.R);
    this._cone.addColorStop(0, 'rgba(236, 230, 220, 0.16)');
    this._cone.addColorStop(1, 'rgba(236, 230, 220, 0)');
  }

  update(dt) {
    if (this.el.hidden) return;
    this._layout();
    if (!this.R || this.R < 20) return;
    this._time += dt;
    const f = this.frame;
    // zoom: vehicles zoom out with speed (and altitude); on foot a little wider in the wilderness
    const veh = f.vehicle();
    const wildNow = Math.max(Math.abs(f.focus.x), Math.abs(f.focus.z)) > HUB_HALF;
    let target = wildNow ? RADIUS_WILD : RADIUS_HUB;
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
    // the procedural planet beyond the hub: (re)paint the cached layer when needed
    const fr = this.ctx.frontier;
    const pxPerM = this.R / this.radiusM;
    if (fr?.minimap && this._seesFrontier(f.focus.x, f.focus.z)) {
      const mpp = quantMpp(1 / (pxPerM * this.dpr));
      const side = Math.ceil(this.R * this.dpr * 2 * 1.5); // covers the rotated disc + some travel
      this.layer.ensure(fr, f.focus.x, f.focus.z, mpp, side, side, this._time);
    }
    // redraw only when something visible changed (standing still costs nothing)
    const s = this._sig;
    const fx = f.focus.x;
    const fz = f.focus.z;
    const rot = this.rotation;
    const dyn = this._dynamicSum();
    if (
      !this._force &&
      Math.abs(s.x - fx) < 0.04 &&
      Math.abs(s.z - fz) < 0.04 &&
      Math.abs(s.h - rot) < 0.0015 &&
      Math.abs(s.fh - f.focusHeading) < 0.01 &&
      Math.abs(s.r - this.radiusM) < 0.05 &&
      s.a === this.mapAlpha + this.previewAlpha * 2 &&
      Math.abs(s.m - dyn) < 0.01 &&
      s.v === this.layer.version
    )
      return;
    this._force = false;
    s.x = fx;
    s.z = fz;
    s.h = rot;
    s.fh = f.focusHeading;
    s.r = this.radiusM;
    s.a = this.mapAlpha + this.previewAlpha * 2;
    s.m = dyn;
    s.v = this.layer.version;
    this._draw();
  }

  /** True when the disc (plus rotation margin) reaches beyond the hub map image. */
  _seesFrontier(x, z) {
    const reach = this.radiusM * 1.5;
    return Math.abs(x) + reach > HUB_HOLE || Math.abs(z) + reach > HUB_HOLE;
  }

  /** Cheap checksum of everything dynamic drawn on the disc (markers, players, claims, waypoint, cache). */
  _dynamicSum() {
    const f = this.frame;
    let sum = f.count;
    for (let i = 0; i < f.count; i++) sum += f.entries[i].x * 0.37 + f.entries[i].z * 0.73;
    const players = this.ctx.net?.players;
    if (players?.size) {
      for (const p of players.values()) {
        const v = p?.view?.p;
        if (v) sum += v.x * 0.11 + v.z * 0.29 + 1;
      }
    }
    const claims = this.wild?.claims?.() || [];
    sum += claims.length * 7 + (claims.length ? claims[0].x * 0.01 : 0);
    sum += this.wild?.discovered?.size || 0;
    return sum;
  }

  _draw() {
    const g = this.g;
    const f = this.frame;
    const css = this.size;
    const c = css / 2;
    const R = this.R;
    const h = this.rotation;
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
    // the infinite planet first (PLATFORM.md §11; it paints outside the hub's core), then the hub map on top —
    // its feathered edge cross-fades into the planet, both through the same HUD grade (one continuous map)
    const L = this.layer;
    if (this.ctx.frontier?.minimap && L.version > 0 && Number.isFinite(L.cx) && this._seesFrontier(f.focus.x, f.focus.z)) {
      const k = pxPerM * L.mpp; // canvas px → minimap css px
      g.save();
      g.translate(c, c);
      g.rotate(h);
      g.translate((L.cx - f.focus.x) * pxPerM, (L.cz - f.focus.z) * pxPerM);
      g.scale(k, k);
      g.globalAlpha = 0.92;
      g.imageSmoothingEnabled = true;
      if (HAS_FILTER) g.filter = HUD_FILTER;
      g.drawImage(L.canvas, -L.w / 2, -L.h / 2);
      g.filter = 'none';
      g.restore();
      drew = true;
    }
    const preview = this.mapAlpha < 1 ? this.mapImage.preview() : null;
    const nearHub = Math.abs(f.focus.x) - this.radiusM * 1.5 < MAP_EXTENT && Math.abs(f.focus.z) - this.radiusM * 1.5 < MAP_EXTENT;
    if (nearHub && preview && this.previewAlpha > 0) drew = this._drawMap(g, preview.canvas, preview.extent, c, h, pxPerM, this.previewAlpha) || drew;
    if (nearHub && this.mapImage.ready && this.mapAlpha > 0) drew = this._drawMap(g, this.mapImage.canvas, MAP_EXTENT, c, h, pxPerM, this.mapAlpha) || drew;
    if (drew) {
      g.fillStyle = HAS_FILTER ? 'rgba(8, 18, 30, 0.22)' : 'rgba(8, 18, 30, 0.45)';
      g.fillRect(0, 0, css, css);
    }
    // world-space overlays: safe-zone border, claims, discovered POIs, players
    g.save();
    g.translate(c, c);
    g.rotate(h);
    g.scale(pxPerM, pxPerM);
    g.translate(-f.focus.x, -f.focus.z);
    this._drawWorldOverlays(g, pxPerM);
    g.restore();

    g.fillStyle = this._vignette;
    g.fillRect(0, 0, css, css);

    // view cone (points where the camera looks)
    const half = 0.62;
    const coneAng = -Math.PI / 2 - (f.heading - h);
    g.save();
    g.translate(c, c);
    g.rotate(coneAng + Math.PI / 2);
    g.fillStyle = this._cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, R, -Math.PI / 2 - half, -Math.PI / 2 + half);
    g.closePath();
    g.fill();
    g.restore();

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
    const wildNow = !(this.wild ? this.wild.inHub(f.focus.x, f.focus.z) : Math.max(Math.abs(f.focus.x), Math.abs(f.focus.z)) <= HUB_HALF);
    for (let i = 0; i < f.count; i++) {
      const e = f.entries[i];
      const m = e.m;
      if (m.compass === false || e.hidden) continue;
      const dx = (e.x - f.focus.x) * pxPerM;
      const dz = (e.z - f.focus.z) * pxPerM;
      let sx = dx * cos - dz * sin;
      let sy = dx * sin + dz * cos;
      const r = Math.hypot(sx, sy);
      if (r > rim) {
        if (!RIM_KINDS.has(m.kind) && e !== f.tracked) continue;
        if (m.kind === 'boss' && e !== f.tracked && (e.dist > BOSS_RIM || !wildNow)) continue;
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
      if (a % 3 === 0) continue; // cardinal positions carry the letters instead
      const ang = (a / 12) * TAU;
      const wx = Math.sin(ang);
      const wz = -Math.cos(ang);
      const tx = wx * cos - wz * sin;
      const ty = wx * sin + wz * cos;
      g.strokeStyle = 'rgba(236, 230, 220, 0.45)';
      g.beginPath();
      g.moveTo(c + tx * (R - 4), c + ty * (R - 4));
      g.lineTo(c + tx * R, c + ty * R);
      g.stroke();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const Lt of this.letters) {
      const tx = Lt.dx * cos - Lt.dz * sin;
      const ty = Lt.dx * sin + Lt.dz * cos;
      const isN = Lt.north;
      g.font = `${isN ? 600 : 500} ${isN ? 12 : 11}px Jost, system-ui, sans-serif`;
      g.fillStyle = isN ? '#ffffff' : 'rgba(236, 230, 220, 0.78)';
      g.shadowColor = 'rgba(0, 0, 0, 0.8)';
      g.shadowBlur = 4;
      g.fillText(Lt.text, c + tx * (R + 11), c + ty * (R + 11) + 0.5);
      g.shadowBlur = 0;
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

  /** Overlays in world metres (the caller set up translate/rotate/scale). */
  _drawWorldOverlays(g, pxPerM) {
    const f = this.frame;
    const fx = f.focus.x;
    const fz = f.focus.z;
    const reach = this.radiusM * 1.5;
    const px = 1 / pxPerM; // one css pixel in metres
    // safe-zone border: dashed cyan square, a faint tint inside (only when the border is in view)
    const H = HUB_HALF;
    const nearBorder = Math.abs(Math.abs(fx) - H) < reach || Math.abs(Math.abs(fz) - H) < reach;
    if (nearBorder && Math.abs(fx) < H + reach && Math.abs(fz) < H + reach) {
      g.save();
      g.lineWidth = 6 * px;
      g.strokeStyle = 'rgba(127, 224, 255, 0.14)';
      g.strokeRect(-H, -H, 2 * H, 2 * H);
      g.setLineDash([7 * px, 5 * px]);
      g.lineWidth = 1.6 * px;
      g.strokeStyle = 'rgba(127, 224, 255, 0.9)';
      g.strokeRect(-H, -H, 2 * H, 2 * H);
      g.restore();
    }
    // claims
    const wild = this.wild;
    const me = wild?.me?.();
    for (const cl of wild?.claims?.() || []) {
      if (Math.abs(cl.x - fx) > reach + cl.r || Math.abs(cl.z - fz) > reach + cl.r) continue;
      const mine = me != null && cl.owner === me;
      const col = cl.decay > 0 ? '150, 146, 140' : mine ? '127, 224, 255' : '255, 160, 80';
      g.fillStyle = `rgba(${col}, ${mine ? 0.16 : 0.1})`;
      g.strokeStyle = `rgba(${col}, 0.9)`;
      g.lineWidth = 1.4 * px;
      g.beginPath();
      g.arc(cl.x, cl.z, cl.r, 0, TAU);
      g.fill();
      g.stroke();
    }
    // wilderness POIs over the layer's diamond: their icon once discovered, a dim "?" until then
    if (wild && !(Math.abs(fx) < HUB_HALF - reach && Math.abs(fz) < HUB_HALF - reach)) {
      for (const p of wild.poisNear(fx, fz, reach)) {
        if (Math.abs(p.x - fx) > reach || Math.abs(p.z - fz) > reach) continue;
        const st = POI_STYLE[p.type];
        if (wild.isDiscovered(p.id) && st) this._iconAt(g, p.x, p.z, st.icon, st.color, px, 7.5);
        else this._iconAt(g, p.x, p.z, 'shell-question', 'rgba(236, 230, 220, 0.8)', px, 6.5);
      }
    }
    // other players (violet dots; names live on the world map)
    const players = this.ctx.net?.players;
    if (players?.size) {
      g.fillStyle = '#c4a2ff';
      g.strokeStyle = 'rgba(8, 10, 16, 0.9)';
      g.lineWidth = 1.2 * px;
      for (const p of players.values()) {
        const v = p?.view;
        if (!v?.p || v.dead) continue;
        if (Math.abs(v.p.x - fx) > reach || Math.abs(v.p.z - fz) > reach) continue;
        g.beginPath();
        g.arc(v.p.x, v.p.z, 3 * px, 0, TAU);
        g.fill();
        g.stroke();
      }
    }
  }

  /** An icon on a small dark disc at a world point (world-space transform active; px = metres per css px). */
  _iconAt(g, x, z, name, color, px, r) {
    const img = iconImage(name, color, 32, 1.8);
    g.save();
    g.translate(x, z);
    g.rotate(-this.rotation); // keep the icon upright
    g.scale(px, px);
    g.fillStyle = 'rgba(6, 10, 16, 0.78)';
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.stroke();
    if (imageReady(img)) g.drawImage(img, -r + 1.5, -r + 1.5, 2 * r - 3, 2 * r - 3);
    else this._force = true;
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
      g.filter = HUD_FILTER;
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
    const kind = m.kind;
    const color = m.color && kind !== 'poi' ? m.color : KIND_COLORS[kind] || '#ece6dc';
    if (kind === 'enemy') {
      g.fillStyle = color;
      g.strokeStyle = 'rgba(20, 4, 4, 0.9)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, 3.2, 0, TAU);
      g.fill();
      g.stroke();
      return;
    }
    if (kind === 'boss' || kind === 'waypoint') {
      const img = iconImage(kind === 'boss' ? 'shell-boss' : 'shell-waypoint', color, 32, 1.9);
      const r = clamped ? 7 : 8.5;
      g.save();
      g.shadowColor = kind === 'boss' ? 'rgba(255, 74, 61, 0.85)' : 'rgba(255, 210, 122, 0.8)';
      g.shadowBlur = 8;
      g.fillStyle = 'rgba(8, 10, 14, 0.88)';
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      g.restore();
      g.strokeStyle = color;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.stroke();
      if (imageReady(img)) g.drawImage(img, x - r + 2, y - r + 2, 2 * r - 4, 2 * r - 4);
      else this._force = true;
      return;
    }
    if (kind === 'quest' || tracked) {
      // diamond with glow (+ the marker's own colour, e.g. the gold death crate)
      const s = clamped ? 5 : 6.5;
      const qc = kind === 'quest' && m.color ? m.color : color;
      g.save();
      g.shadowColor = qc === '#7fe0ff' ? 'rgba(127, 224, 255, 0.85)' : qc;
      g.shadowBlur = 8;
      g.fillStyle = 'rgba(8, 14, 20, 0.85)';
      g.strokeStyle = qc;
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
      g.fillStyle = qc;
      g.beginPath();
      g.arc(x, y, 1.7, 0, TAU);
      g.fill();
      return;
    }
    if (kind === 'npc' || kind === 'friendly') {
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
