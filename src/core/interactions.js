import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1.7, 0);

/**
 * Proximity interactions ("[E] Talk to Aria", "[E] Scan ruins" (hold), …).
 *
 *   const id = ctx.interactions.add({
 *     id: 'aria-talk',            // optional stable id
 *     scope: 'world',             // 'world' (on foot) | 'space' | 'vehicle'
 *     position: vec3 | () => vec3,
 *     radius: 3,                  // metres
 *     label: 'Praat met Aria',
 *     key: 'KeyE',                // KeyboardEvent.code, default 'KeyE'
 *     hold: 0,                    // seconds to hold (0 = press)
 *     priority: 0,                // higher wins when several are in range
 *     anchor: vec3 | () => vec3 | false,  // where the prompt floats on screen
 *                                 // (default: position + 1.7 m up; false = bottom of the screen)
 *     enabled: () => true,
 *     onInteract: (ctx) => {},
 *   });
 *   ctx.interactions.remove(id);
 *
 * Each frame the active controller sets `interactions.origin` and `scope`
 * (player → 'world', vehicles → 'vehicle', ship → 'space'). The system picks
 * the best candidate, shows the prompt through `ctx.ui.prompt` and fires it.
 */
export class Interactions {
  constructor(ctx) {
    this.ctx = ctx;
    this.items = new Map();
    this.origin = new THREE.Vector3();
    this.scope = 'world';
    this.active = false; // set true by the controller that owns the origin this frame
    this.current = null;
    this.holdTime = 0;
    this._n = 0;
    this._tmp = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
  }

  add(def) {
    const id = def.id || `int-${++this._n}`;
    this.items.set(id, { scope: 'world', radius: 3, key: 'KeyE', hold: 0, priority: 0, ...def, id });
    return id;
  }

  remove(id) {
    this.items.delete(id);
    if (this.current?.id === id) this._clear();
  }

  get(id) {
    return this.items.get(id);
  }

  _pos(item) {
    return typeof item.position === 'function' ? item.position() : item.position;
  }

  _clear() {
    if (this.current) this.ctx.ui.prompt.hide('interact');
    this.current = null;
    this.holdTime = 0;
  }

  update(dt) {
    const input = this.ctx.input;
    if (!this.active || !input.gameEnabled) {
      this._clear();
      this.active = false;
      return;
    }
    this.active = false; // controller must re-arm every frame

    let best = null;
    let bestScore = Infinity;
    for (const it of this.items.values()) {
      if (it.scope !== this.scope) continue;
      if (it.enabled && !it.enabled()) continue;
      const p = this._pos(it);
      if (!p) continue;
      const d = this.origin.distanceTo(p);
      if (d > it.radius) continue;
      const score = d - it.priority * 100;
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }

    if (best !== this.current) {
      this.holdTime = 0;
      this.current = best;
    }
    if (!best) {
      this.ctx.ui.prompt.hide('interact');
      return;
    }

    const keyLabel = best.key.replace(/^Key/, '').replace(/^Digit/, '');
    let progress = null;
    if (best.hold > 0) {
      if (input.down(best.key)) {
        this.holdTime += dt;
        if (this.holdTime >= best.hold) {
          this.holdTime = 0;
          this._fire(best);
          return;
        }
      } else {
        this.holdTime = Math.max(0, this.holdTime - dt * 2);
      }
      progress = this.holdTime / best.hold;
    } else if (input.pressed(best.key)) {
      this._fire(best);
      return;
    }
    let anchor = null;
    if (best.anchor !== false) {
      if (best.anchor) anchor = this._anchor.copy(typeof best.anchor === 'function' ? best.anchor() : best.anchor);
      else anchor = this._anchor.copy(this._pos(best)).add(UP);
    }
    this.ctx.ui.prompt.show('interact', {
      key: keyLabel,
      text: typeof best.label === 'function' ? best.label() : best.label,
      hold: best.hold > 0,
      progress,
      anchor,
    });
  }

  _fire(item) {
    this.ctx.ui.prompt.hide('interact');
    this.current = null;
    try {
      item.onInteract?.(this.ctx, item);
    } catch (err) {
      console.error('[interactions] handler failed', item.id, err);
    }
    this.ctx.events.emit('interact', { id: item.id });
  }
}
