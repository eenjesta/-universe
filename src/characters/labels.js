/**
 * Name tags + speech bubbles (characters module). DOM labels in the HUD layer,
 * projected above NPC heads every frame (poster style: small dark rounded label
 * with a ▼ pointer; bubbles are dark glass with warm text). Distance fade and a
 * cheap, throttled occlusion test against physics boxes. No allocations per frame.
 */
import * as THREE from 'three';

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

  /** Registers a label for an NPC-like object { headTop(out), id, name }. */
  add(owner, name, { kind = 'npc' } = {}) {
    const tag = this.ctx.ui.h('div', { class: `chr-tag chr-tag-${kind}` }, this.ctx.ui.h('span', { class: 'chr-tag-name', text: name }), this.ctx.ui.h('i', { class: 'chr-tag-arrow' }));
    const bubble = this.ctx.ui.h('div', { class: 'chr-bubble' }, this.ctx.ui.h('span', { class: 'chr-bubble-text' }));
    const wrap = this.ctx.ui.h('div', { class: 'chr-label', style: { display: 'none' } }, bubble, tag);
    this.root.appendChild(wrap);
    const item = { owner, wrap, tag, bubble, text: bubble.firstChild, sayUntil: 0, occluded: false, shown: false, x: 0, y: 0, o: 0 };
    this.items.push(item);
    return item;
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    item.wrap.remove();
  }

  say(item, text, seconds = 4) {
    if (!item) return;
    item.text.textContent = text;
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
      const maxD = talking ? 60 : 42;
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
