/**
 * On-screen world markers (explore/drive): a diamond at the target with a
 * thin stem up to "label + distance" (16_vtol_flight.png: "Aurora City
 * 1.2 km"). Quest / tracked / waypoint / boss markers clamp to the screen
 * edges with an arrow; POIs only show while in view and in range (hub
 * landmarks ≤ 2.6 km inside the hub, ≤ 1.4 km from the wilderness), and so do
 * wilderness POIs: their name once discovered, a "?" until then (≤ 520 m).
 * Labels flip below the diamond where they would run into the top HUD band
 * (compass, zone pill, banners). DOM pool, no per-frame allocations.
 */
import * as THREE from 'three';
import { t } from '../../core/i18n.js';
import { formatDistance } from '../util.js';
import { DISCOVERY } from '../logic.js';
import { poiName } from '../wild.js';

const EDGE = 54; // px margin for clamped markers
const EDGE_BOTTOM = 118; // clamped markers stay above the vitals / ammo / channel bar band (diamond + label)
const MAX_POI = 6;
const EDGE_KINDS = new Set(['quest', 'waypoint', 'boss']);
const byDistance = (a, b) => a.dist - b.dist;

export class ScreenMarkers {
  constructor(ctx, frame, { topBand = () => 0 } = {}) {
    this.ctx = ctx;
    this.frame = frame;
    this.topBand = topBand;
    this.root = ctx.ui.h('div', { class: 'shell-smarkers', 'aria-hidden': 'true' });
    ctx.ui.layers.hud.appendChild(this.root);
    this.pool = [];
    this.used = 0;
    this._v = new THREE.Vector3();
    this._cands = [];
    this._candPool = [];
    this.enabled = true;
  }

  _item(i) {
    let it = this.pool[i];
    if (!it) {
      const h = this.ctx.ui.h;
      const label = h('div', { class: 'shell-sm-label' });
      const dist = h('div', { class: 'shell-sm-dist' });
      const el = h(
        'div',
        { class: 'shell-sm' },
        h('div', { class: 'shell-sm-text' }, label, dist),
        h('div', { class: 'shell-sm-stem' }),
        h('div', { class: 'shell-sm-gem' }),
        h('div', { class: 'shell-sm-arrow' }),
      );
      this.root.appendChild(el);
      it = this.pool[i] = { el, label, dist, labelText: null, distText: null, distKey: -1, kind: null, edge: null, flip: null, x: -1, y: -1, o: -1, rot: 0 };
    }
    return it;
  }

  /** Pooled candidate: { x, y, z, dist, kind, label, edge (may clamp), lift (m above the point) }. */
  _cand(i) {
    return this._candPool[i] || (this._candPool[i] = { x: 0, y: 0, z: 0, dist: 0, kind: '', label: '', edge: false, lift: 1.2 });
  }

  update() {
    const ctx = this.ctx;
    const show = this.enabled && ctx.modes.is('explore', 'drive') && !ctx.modes.transitioning;
    this.root.hidden = !show;
    if (!show) return;
    const f = this.frame;
    const cam = f.camera;
    if (!cam) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const v = this._v;
    const wild = Math.max(Math.abs(f.focus.x), Math.abs(f.focus.z)) > 1100;
    const poiMax = wild ? 1400 : 2600;

    // collect candidates (pooled)
    const cands = this._cands;
    cands.length = 0;
    let n = 0;
    for (let i = 0; i < f.count; i++) {
      const e = f.entries[i];
      const m = e.m;
      if (m.screen === false || e.hidden) continue;
      const tracked = e === f.tracked;
      const kind = tracked && !EDGE_KINDS.has(m.kind) ? 'quest' : m.kind;
      let ok = false;
      if (tracked || EDGE_KINDS.has(m.kind)) ok = true;
      else if (m.kind === 'poi' && e.dist > 32 && e.dist < poiMax) ok = true;
      else if ((m.kind === 'vehicle' || m.kind === 'station') && e.dist > 6 && e.dist < 260) ok = true;
      else if (m.kind === 'loot' && e.dist > 3 && e.dist < 600) ok = true;
      if (!ok) continue;
      const c = this._cand(n++);
      c.x = e.x;
      c.y = e.y;
      c.z = e.z;
      c.dist = e.dist;
      c.kind = kind === 'quest' && m.color && m.color !== '#7fe0ff' ? 'quest-alt' : kind;
      c.label = t(m.label); // strings pass through; { en, nl } just in case
      c.edge = tracked || EDGE_KINDS.has(m.kind);
      c.lift = m.kind === 'poi' ? 1.5 : 1.2;
      c.color = m.color;
      cands.push(c);
    }
    for (let i = 0; i < f.wildCount; i++) {
      const e = f.wildEntries[i];
      if (e.dist < 30) continue;
      if (e.known ? e.dist > 1400 : e.dist > DISCOVERY.reveal) continue;
      const c = this._cand(n++);
      c.x = e.x;
      c.y = e.y;
      c.z = e.z;
      c.dist = e.dist;
      c.kind = e.known ? `wild-${e.poi.type}` : 'unknown';
      c.label = e.known ? poiName(e.poi) : '';
      c.edge = false;
      c.lift = 4;
      cands.push(c);
    }
    // nearest first so the POI cap keeps the most relevant ones
    cands.sort(byDistance);

    const band = Math.max(60, (this.topBand() || 0) + 8);
    let used = 0;
    let poiCount = 0;
    for (let i = 0; i < cands.length; i++) {
      const e = cands[i];
      v.set(e.x, e.y + e.lift, e.z).applyMatrix4(cam.matrixWorldInverse);
      const behind = v.z > -0.2;
      v.applyMatrix4(cam.projectionMatrix);
      const nx = behind ? -v.x : v.x;
      const ny = behind ? -v.y : v.y;
      let x = (nx * 0.5 + 0.5) * W;
      let y = (-ny * 0.5 + 0.5) * H;
      const onScreen = !behind && x > 0 && x < W && y > band * 0.5 && y < H;
      if (!onScreen && !e.edge) continue;
      if (!e.edge && ++poiCount > MAX_POI) continue;

      let edge = false;
      let rot = 0;
      if (!onScreen) {
        // clamp along the direction from the screen centre
        edge = true;
        const dx = x - W / 2;
        let dy = y - H / 2;
        if (behind) dy = Math.abs(dy) + H; // behind you → bottom edge
        // touch devices: keep clamped markers off the side HUD columns (minimap + tracker left,
        // Chat/Menu + panels right) — they clamp inside the central band instead
        const edgeX = this.ctx.device?.touch ? EDGE + Math.min(W * 0.33, 300) : EDGE;
        const sx = (W / 2 - edgeX) / Math.max(1e-3, Math.abs(dx));
        const sy = (H / 2 - (dy > 0 ? Math.min(EDGE_BOTTOM, H * 0.3) : EDGE)) / Math.max(1e-3, Math.abs(dy));
        const s = Math.min(sx, sy);
        x = W / 2 + dx * s;
        y = Math.max(band + 12, H / 2 + dy * s);
        rot = Math.atan2(dy, dx);
      }

      const it = this._item(used++);
      if (it.labelText !== e.label) {
        it.label.textContent = it.labelText = e.label;
        it.label.hidden = !e.label;
      }
      // format only when the shown value changes (1 m below 1 km, 0.1 km above): no per-frame strings
      const dk = e.dist < 1000 ? Math.round(e.dist) : 100000 + Math.round(e.dist / 100);
      if (it.distKey !== dk) {
        it.distKey = dk;
        const dt = formatDistance(e.dist);
        if (it.distText !== dt) it.dist.textContent = it.distText = dt;
      }
      if (it.kind !== e.kind) {
        it.el.dataset.kind = it.kind = e.kind;
        if (e.kind === 'quest-alt' && e.color) it.el.style.setProperty('--sm-color', e.color);
      }
      if (it.edge !== edge) {
        it.el.classList.toggle('is-edge', edge);
        it.edge = edge;
      }
      // labels that would run into the top band (compass, pills, banners) go below the diamond
      const flip = !edge && y - 64 < band;
      if (it.flip !== flip) {
        it.el.classList.toggle('is-flip', flip);
        it.flip = flip;
      }
      // POIs fade with distance and near the screen edges
      let o = 1;
      if (!e.edge) {
        o = 0.95 - Math.min(0.4, e.dist / 6000);
        const ex = Math.min(x, W - x) / 90;
        const ey = Math.min(y, H - y) / 90;
        o *= Math.min(1, ex, ey);
        if (e.kind === 'unknown') o *= 0.85;
      }
      const rx = Math.round(x);
      const ry = Math.round(y);
      if (rx !== it.x || ry !== it.y) {
        it.el.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
        it.x = rx;
        it.y = ry;
      }
      const ro = Math.round(o * 100) / 100;
      if (ro !== it.o) {
        it.el.style.opacity = ro;
        it.o = ro;
      }
      if (edge && Math.abs(rot - it.rot) > 0.01) {
        it.el.style.setProperty('--rot', `${rot}rad`);
        it.rot = rot;
      }
      it.el.hidden = false;
    }
    for (let i = used; i < this.used; i++) this.pool[i].el.hidden = true;
    this.used = used;
  }
}
