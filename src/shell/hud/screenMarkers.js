/**
 * On-screen world markers (explore/drive): a diamond at the target with a
 * thin stem up to "label + distance" (16_vtol_flight.png: "Aurora City
 * 1.2 km"). Quest/tracked markers clamp to the screen edges with an arrow;
 * POIs only show while in view and in range. DOM pool, no per-frame allocs.
 */
import * as THREE from 'three';
import { t } from '../../core/i18n.js';
import { formatDistance } from '../util.js';

const EDGE = 54; // px margin for clamped markers
const MAX_POI = 6;
const byDistance = (a, b) => a.dist - b.dist;

export class ScreenMarkers {
  constructor(ctx, frame) {
    this.ctx = ctx;
    this.frame = frame;
    this.root = ctx.ui.h('div', { class: 'shell-smarkers', 'aria-hidden': 'true' });
    ctx.ui.layers.hud.appendChild(this.root);
    this.pool = [];
    this.used = 0;
    this._v = new THREE.Vector3();
    this._cands = [];
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
      it = this.pool[i] = { el, label, dist, labelText: null, distText: null, kind: null, edge: null, x: -1, y: -1, o: -1, rot: 0 };
    }
    return it;
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

    // collect candidates (pooled array of entries)
    const cands = this._cands;
    cands.length = 0;
    let poiCount = 0;
    for (let i = 0; i < f.count; i++) {
      const e = f.entries[i];
      const m = e.m;
      if (m.screen === false || e.hidden) continue;
      const tracked = e === f.tracked;
      if (tracked || m.kind === 'quest') cands.push(e);
      else if (m.kind === 'poi' && e.dist > 32 && e.dist < 2600) cands.push(e);
      else if ((m.kind === 'vehicle' || m.kind === 'station') && e.dist > 6 && e.dist < 260) cands.push(e);
    }
    // nearest first so the POI cap keeps the most relevant ones
    cands.sort(byDistance);

    let used = 0;
    for (let i = 0; i < cands.length; i++) {
      const e = cands[i];
      const m = e.m;
      const tracked = e === f.tracked;
      const quest = tracked || m.kind === 'quest';
      v.set(e.x, e.y + (m.kind === 'poi' ? 1.5 : 1.2), e.z).applyMatrix4(cam.matrixWorldInverse);
      const behind = v.z > -0.2;
      v.applyMatrix4(cam.projectionMatrix);
      let nx = behind ? -v.x : v.x;
      let ny = behind ? -v.y : v.y;
      let x = (nx * 0.5 + 0.5) * W;
      let y = (-ny * 0.5 + 0.5) * H;
      const onScreen = !behind && x > 0 && x < W && y > 60 && y < H;
      if (!onScreen && !quest) continue;
      if (!quest && ++poiCount > MAX_POI) continue;

      let edge = false;
      let rot = 0;
      if (!onScreen) {
        // clamp along the direction from the screen centre
        edge = true;
        let dx = x - W / 2;
        let dy = y - H / 2;
        if (behind) dy = Math.abs(dy) + H; // behind you → bottom edge
        // touch devices: keep clamped markers off the side HUD columns (minimap + tracker left,
        // Chat/Menu + panels right) — they clamp inside the central band instead
        const edgeX = this.ctx.device?.touch ? EDGE + Math.min(W * 0.33, 300) : EDGE;
        const sx = (W / 2 - edgeX) / Math.max(1e-3, Math.abs(dx));
        const sy = (H / 2 - EDGE) / Math.max(1e-3, Math.abs(dy));
        const s = Math.min(sx, sy);
        x = W / 2 + dx * s;
        y = H / 2 + dy * s;
        rot = Math.atan2(dy, dx);
      }

      const it = this._item(used++);
      const label = t(m.label); // strings pass through; { en, nl } just in case
      if (it.labelText !== label) {
        it.label.textContent = it.labelText = label;
        it.label.hidden = !label;
      }
      const dt = formatDistance(e.dist);
      if (it.distText !== dt) it.dist.textContent = it.distText = dt;
      const kind = quest ? 'quest' : m.kind;
      if (it.kind !== kind) it.el.dataset.kind = it.kind = kind;
      if (it.edge !== edge) {
        it.el.classList.toggle('is-edge', edge);
        it.edge = edge;
      }
      // POIs fade with distance and near the screen edges
      let o = 1;
      if (!quest) {
        o = 0.95 - Math.min(0.4, e.dist / 6000);
        const ex = Math.min(x, W - x) / 90;
        const ey = Math.min(y, H - y) / 90;
        o *= Math.min(1, ex, ey);
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
