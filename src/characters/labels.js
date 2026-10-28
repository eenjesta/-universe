/**
 * Name tags + speech bubbles (characters module). DOM labels in the HUD layer,
 * projected above NPC heads every frame (poster style: small dark rounded label
 * with a ▼ pointer; bubbles are dark glass with warm text). Distance fade and a
 * cheap, throttled occlusion test against physics boxes. No allocations per frame.
 * Player tags (kind 'player', bars: true): cyan name + thin shield / health bars
 * (setBars(item, hp01, sh01)), dimmed while dead (setDim).
 */
import * as THREE from 'three';
import { t } from '../core/i18n.js';

const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();

export class Labels {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = ctx.ui.h('div', { class: 'chr-labels' });
    ctx.ui.layers.hud.appendChild(this.root);
    this.items = [];
    this.frame = 0;
    this.visibleModes = ['explore', 'drive'];
  }

  /**
   * Registers a label for an NPC-like object { headTop(out), id, name }. `name`: string or bilingual {en, nl}.
   * opts: { kind: 'npc' | 'anon' | 'player', bars: bool (shield + health bars), maxDistance }
   */
  add(owner, name, { kind = 'npc', bars = false, maxDistance = 42 } = {}) {
    const h = this.ctx.ui.h;
    const nameEl = h('span', { class: 'chr-tag-name', text: t(name) });
    let hpEl = null;
    let shEl = null;
    let barsEl = null;
    if (bars) {
      shEl = h('i', { class: 'chr-bar-fill chr-bar-sh' });
      hpEl = h('i', { class: 'chr-bar-fill chr-bar-hp' });
      barsEl = h('span', { class: 'chr-tag-bars' }, h('span', { class: 'chr-bar' }, shEl), h('span', { class: 'chr-bar' }, hpEl));
    }
    const tag = h('div', { class: `chr-tag chr-tag-${kind}` }, nameEl, barsEl, h('i', { class: 'chr-tag-arrow' }));
    const bubble = h('div', { class: 'chr-bubble' }, h('span', { class: 'chr-bubble-text' }));
    const wrap = h('div', { class: 'chr-label', style: { display: 'none' } }, bubble, tag);
    this.root.appendChild(wrap);
    const item = { owner, wrap, tag, nameEl, bubble, text: bubble.firstChild, hpEl, shEl, hp: -1, sh: -1, dim: false, maxD: maxDistance, sayUntil: 0, occluded: false, shown: false, x: 0, y: 0, o: 0 };
    this.items.push(item);
    return item;
  }

  /** Health / shield fractions (0…1) of a label with bars; DOM writes only on change. */
  setBars(item, hp, sh) {
    if (!item?.hpEl) return;
    hp = Math.max(0, Math.min(1, hp || 0));
    sh = Math.max(0, Math.min(1, sh || 0));
    if (Math.abs(hp - item.hp) > 0.004) {
      item.hp = hp;
      item.hpEl.style.transform = `scaleX(${hp.toFixed(3)})`;
      item.hpEl.classList.toggle('low', hp < 0.3);
    }
    if (Math.abs(sh - item.sh) > 0.004) {
      item.sh = sh;
      item.shEl.style.transform = `scaleX(${sh.toFixed(3)})`;
    }
  }

  /** Dimmed tag (e.g. a dead player). */
  setDim(item, dim) {
    if (!item || item.dim === !!dim) return;
    item.dim = !!dim;
    item.tag.classList.toggle('dim', item.dim);
  }

  /** Renames a label. */
  setName(item, name) {
    if (item?.nameEl) item.nameEl.textContent = t(name);
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    item.wrap.remove();
  }

  /** Shows a speech bubble; `text`: string or bilingual {en, nl}. */
  say(item, text, seconds = 4) {
    if (!item) return;
    item.text.textContent = t(text);
    item.sayUntil = this.ctx.loop.realTime + seconds;
    item.bubble.classList.add('show');
  }

  update() {
    const ctx = this.ctx;
    const show = this.visibleModes.includes(ctx.modes.name) && !ctx.ui.isModalOpen();
    this.root.style.display = show ? '' : 'none';
    if (!show) return;
    const cam = ctx.engine.camera;
    cam.getWorldPosition(_cam);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const now = ctx.loop.realTime;
    this.frame++;
    for (let k = 0; k < this.items.length; k++) {
      const it = this.items[k];
      const o = it.owner;
      if (it.sayUntil && now > it.sayUntil) {
        it.sayUntil = 0;
        it.bubble.classList.remove('show');
      }
      if (o.hiddenTag || !o.headTop) {
        this.hide(it);
        continue;
      }
      o.headTop(_v);
      _v.y += 0.32;
      const d = _v.distanceTo(_cam);
      const talking = it.sayUntil > 0;
      const maxD = talking ? Math.max(60, it.maxD) : it.maxD;
      if (d > maxD) {
        this.hide(it);
        continue;
      }
      // occlusion (staggered: each label tested every 6th frame)
      if ((this.frame + k) % 6 === 0 && ctx.physics?.segmentHit) {
        it.occluded = ctx.physics.segmentHit(_cam, _v) < 0.97;
      }
      if (it.occluded) {
        this.hide(it);
        continue;
      }
      _v.project(cam);
      if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) {
        this.hide(it);
        continue;
      }
      const x = (_v.x * 0.5 + 0.5) * W;
      const y = (-_v.y * 0.5 + 0.5) * H;
      const op = Math.min(1, (maxD - d) / 10);
      const sc = Math.max(0.72, Math.min(1, 9 / Math.max(d, 1)) * 0.28 + 0.72);
      if (!it.shown) {
        it.wrap.style.display = '';
        it.shown = true;
      }
      if (Math.abs(x - it.x) > 0.3 || Math.abs(y - it.y) > 0.3 || Math.abs(op - it.o) > 0.02) {
        it.x = x;
        it.y = y;
        it.o = op;
        it.wrap.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(3)})`;
        it.wrap.style.opacity = op.toFixed(2);
      }
    }
  }

  hide(it) {
    if (it.shown) {
      it.wrap.style.display = 'none';
      it.shown = false;
    }
  }

  dispose() {
    this.root.remove();
    this.items = [];
  }
}
