/**
 * Placed structures registry: records, slot + deck maps, instanced rendering
 * (one InstancedMesh per piece variant × material, swap-remove), physics
 * boxes (tag 'build', owner = record id), persistence in state.structures
 * ({id, type, x, y, z, rot, level, variant}) and the materialise / dissolve
 * animation (per-instance `aReveal`, see materials.js) with a hologram
 * "phantom" showing the part that is not built yet.
 */
import * as THREE from 'three';
import { PIECE } from './catalog.js';
import { pieceInfo, normVariant } from './pieces.js';
import { slotLayout, toWorldBox } from './placement.js';
import { REVEAL_DONE } from './materials.js';
import { Ghost } from './hologram.js';
import { easeInOutCubic } from '../core/math.js';

const CASTS = new Set(['metal', 'concrete', 'wood', 'matte', 'solar', 'banner']);
const RECEIVES = new Set(['metal', 'concrete', 'wood', 'matte', 'solar', 'banner', 'decal']);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

/** One piece variant rendered as instanced meshes (one per material part). */
class InstSet {
  constructor(info, mats, parent) {
    this.info = info;
    this.mats = mats;
    this.parent = parent;
    this.cap = 0;
    this.count = 0;
    this.recs = [];
    this.parts = info.parts.map((p) => ({ mat: p.mat, geo: p.geometry.clone(), mesh: null, reveal: null }));
    this._grow(4);
  }

  _grow(cap) {
    for (const part of this.parts) {
      const reveal = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      reveal.setUsage(THREE.DynamicDrawUsage);
      if (part.reveal) reveal.array.set(part.reveal.array.subarray(0, this.count));
      part.geo.setAttribute('aReveal', reveal);
      part.reveal = reveal;
      const mesh = new THREE.InstancedMesh(part.geo, this.mats[part.mat], cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (part.mesh) {
        mesh.instanceMatrix.array.set(part.mesh.instanceMatrix.array.subarray(0, this.count * 16));
        this.parent.remove(part.mesh);
        part.mesh.dispose();
      }
      mesh.count = this.count;
      mesh.castShadow = CASTS.has(part.mat);
      mesh.receiveShadow = RECEIVES.has(part.mat);
      mesh.name = `build-${this.info.key}-${part.mat}`;
      if (part.mat === 'glass' || part.mat === 'pool' || part.mat === 'flame') mesh.renderOrder = 2;
      mesh.visible = this.count > 0;
      this.parent.add(mesh);
      part.mesh = mesh;
    }
    this.cap = cap;
  }

  add(rec, matrix, reveal) {
    if (this.count >= this.cap) this._grow(this.cap * 2);
    const idx = this.count++;
    for (const part of this.parts) {
      part.mesh.setMatrixAt(idx, matrix);
      part.mesh.count = this.count;
      part.mesh.instanceMatrix.needsUpdate = true;
      part.reveal.array[idx] = reveal;
      part.reveal.needsUpdate = true;
    }
    this.recs[idx] = rec;
    this._bounds();
    return idx;
  }

  /** Swap-remove; returns nothing (moved records get their index updated). */
  remove(idx) {
    const last = this.count - 1;
    if (idx < 0 || idx > last) return;
    for (const part of this.parts) {
      if (idx !== last) {
        part.mesh.instanceMatrix.array.copyWithin(idx * 16, last * 16, last * 16 + 16);
        part.reveal.array[idx] = part.reveal.array[last];
      }
      part.mesh.count = last;
      part.mesh.instanceMatrix.needsUpdate = true;
      part.reveal.needsUpdate = true;
    }
    if (idx !== last) {
      const moved = this.recs[last];
      this.recs[idx] = moved;
      moved.index = idx;
    }
    this.recs.length = last;
    this.count = last;
    this._bounds();
  }

  setReveal(idx, v) {
    for (const part of this.parts) {
      part.reveal.array[idx] = v;
      part.reveal.needsUpdate = true;
    }
  }

  _bounds() {
    for (const part of this.parts) {
      part.mesh.visible = this.count > 0;
      if (this.count > 0) part.mesh.computeBoundingSphere();
    }
  }

  dispose() {
    for (const part of this.parts) {
      this.parent.remove(part.mesh);
      part.mesh.dispose();
      part.geo.dispose();
    }
  }
}

export function createRegistry(ctx, mats, holoMats) {
  const root = new THREE.Group();
  root.name = 'build-structures';
  const reg = {
    root,
    records: new Map(),
    slots: new Map(),
    decks: new Map(),
    sets: new Map(),
    anims: [],
    nextId: 1,
    version: 0, // bumps on every change (HUD / power listeners)
  };
  const phantoms = [];

  function setFor(info) {
    let set = reg.sets.get(info.key);
    if (!set) {
      set = new InstSet(info, mats, root);
      reg.sets.set(info.key, set);
    }
    return set;
  }

  function matrixOf(rec) {
    _q.setFromAxisAngle(_up, rec.rot * (Math.PI / 2));
    return _m.compose(_p.set(rec.x, rec.y, rec.z), _q, _s);
  }

  /** Adds a piece from a plain entry {type, x, y, z, rot, level, variant, id?}. */
  function add(entry, { animate = false } = {}) {
    const def = PIECE[entry.type];
    if (!def) return null;
    const variant = normVariant(def.id, entry.variant);
    const info = pieceInfo(def.id, variant);
    const rot = ((entry.rot | 0) % 4 + 4) % 4;
    const rec = {
      id: entry.id || `s${reg.nextId++}`,
      type: def.id,
      def,
      variant,
      x: +entry.x,
      y: +entry.y,
      z: +entry.z,
      rot,
      level: entry.level | 0,
      owner: entry.owner ?? null, // online: owner player id (server record)
      ownerName: entry.ownerName ?? null,
      info,
      set: null,
      index: -1,
      layout: null,
      obbs: [],
      hitObbs: [],
      sphere: { x: 0, y: 0, z: 0, r: 1 },
      boxIds: [],
      anim: null,
      removing: false,
    };
    if (!Number.isFinite(rec.x) || !Number.isFinite(rec.y) || !Number.isFinite(rec.z)) return null;
    const n = /^s(\d+)$/.exec(rec.id);
    if (n) reg.nextId = Math.max(reg.nextId, +n[1] + 1);
    const rotY = rot * (Math.PI / 2);
    rec.layout = slotLayout(def, rec.x, rec.y, rec.z, rot, rec.level, variant);
    for (const key of rec.layout.slots) reg.slots.set(key, rec);
    for (const p of rec.layout.provides) reg.decks.set(p.key, { y: p.y, level: p.level, i: p.i, j: p.j, rec });
    for (const b of info.boxes) rec.obbs.push(toWorldBox(b, rec.x, rec.y, rec.z, rotY, {}));
    for (const b of info.hits) rec.hitObbs.push(toWorldBox(b, rec.x, rec.y, rec.z, rotY, {}));
    if (!rec.hitObbs.length) {
      const bb = info.bounds;
      const hb = { x: (bb.min.x + bb.max.x) / 2, y: (bb.min.y + bb.max.y) / 2, z: (bb.min.z + bb.max.z) / 2, w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y, d: bb.max.z - bb.min.z };
      rec.hitObbs.push(toWorldBox(hb, rec.x, rec.y, rec.z, rotY, {}));
    }
    // bounding sphere for quick ray rejection
    const bb = info.bounds;
    const cy = (Math.max(bb.min.y, -0.5) + bb.max.y) / 2;
    rec.sphere.x = rec.x;
    rec.sphere.y = rec.y + cy;
    rec.sphere.z = rec.z;
    rec.sphere.r = Math.hypot(Math.max(-bb.min.x, bb.max.x), Math.max(-bb.min.z, bb.max.z), (bb.max.y - Math.max(bb.min.y, -0.5)) / 2) + 0.2;
    // physics
    if (ctx.physics) {
      for (const o of rec.obbs) {
        rec.boxIds.push(
          ctx.physics.addBox({ x: o.x, y: o.y, z: o.z, w: o.hw * 2, h: o.hh * 2, d: o.hd * 2, rotY: o.rot, solid: o.solid, walkable: o.walkable, tag: 'build', owner: rec.id }),
        );
      }
    }
    // render
    rec.set = setFor(info);
    const from = Math.max(info.minY - 0.05, -0.6);
    rec.index = rec.set.add(rec, matrixOf(rec), animate ? from : REVEAL_DONE);
    if (animate) {
      const to = info.maxY + 0.45;
      const dur = Math.min(1.8, Math.max(0.85, 0.8 + (to - from) * 0.06));
      rec.anim = { t: 0, dur, from, to, out: false, phantom: takePhantom(rec) };
      reg.anims.push(rec);
    }
    reg.records.set(rec.id, rec);
    reg.version++;
    return rec;
  }

  /** Removes a record (optionally with a dissolve); frees slots + physics at once. */
  function remove(id, { animate = false } = {}) {
    const rec = reg.records.get(id);
    if (!rec || rec.removing) return null;
    rec.removing = true;
    for (const key of rec.layout.slots) if (reg.slots.get(key) === rec) reg.slots.delete(key);
    for (const p of rec.layout.provides) if (reg.decks.get(p.key)?.rec === rec) reg.decks.delete(p.key);
    for (const bid of rec.boxIds) ctx.physics?.remove(bid);
    rec.boxIds.length = 0;
    reg.records.delete(id);
    reg.version++;
    if (animate) {
      if (rec.anim?.phantom) releasePhantom(rec.anim.phantom);
      const from = rec.info.maxY + 0.45;
      const to = Math.max(rec.info.minY - 0.05, -0.6);
      rec.anim = { t: 0, dur: 0.55, from, to, out: true, phantom: null };
      if (!reg.anims.includes(rec)) reg.anims.push(rec);
    } else finalizeRemove(rec);
    return rec;
  }

  function finalizeRemove(rec) {
    if (rec.anim?.phantom) releasePhantom(rec.anim.phantom);
    rec.anim = null;
    if (rec.set && rec.index >= 0) rec.set.remove(rec.index);
    rec.index = -1;
  }

  // ------------------------------------------------------------ phantoms
  function takePhantom(rec) {
    if (!holoMats) return null;
    let g = phantoms.find((p) => !p.busy);
    if (!g) {
      if (phantoms.length >= 4) return null;
      g = new Ghost(holoMats, { clone: true });
      g.busy = false;
      root.add(g.group);
      phantoms.push(g);
    }
    g.busy = true;
    g.setPiece(rec.info);
    g.setValid(true);
    g.group.position.set(rec.x, rec.y, rec.z);
    g.group.rotation.set(0, rec.rot * (Math.PI / 2), 0);
    g.group.visible = true;
    g.setOpacity(0.8);
    return g;
  }

  function releasePhantom(g) {
    g.busy = false;
    g.group.visible = false;
    g.setClip(-1e4);
  }

  /** Per-frame reveal / dissolve animation. */
  function update(dt) {
    for (let k = reg.anims.length - 1; k >= 0; k--) {
      const rec = reg.anims[k];
      const a = rec.anim;
      if (!a) {
        reg.anims.splice(k, 1);
        continue;
      }
      a.t += dt;
      const f = Math.min(1, a.t / a.dur);
      const e = a.out ? f * f : easeInOutCubic(f);
      const v = a.from + (a.to - a.from) * e;
      if (rec.index >= 0) rec.set.setReveal(rec.index, f >= 1 && !a.out ? REVEAL_DONE : v);
      if (a.phantom) {
        a.phantom.setClip(v);
        a.phantom.setOpacity(0.85 * (1 - f * 0.6));
      }
      if (f >= 1) {
        reg.anims.splice(k, 1);
        if (a.out) finalizeRemove(rec);
        else {
          if (a.phantom) releasePhantom(a.phantom);
          rec.anim = null;
        }
      }
    }
  }

  // ---------------------------------------------------------- persistence
  function serialize() {
    const out = [];
    for (const rec of reg.records.values()) {
      out.push({
        id: rec.id,
        type: rec.type,
        x: Math.round(rec.x * 1000) / 1000,
        y: Math.round(rec.y * 1000) / 1000,
        z: Math.round(rec.z * 1000) / 1000,
        rot: rec.rot,
        level: rec.level,
        variant: rec.variant,
        ...(rec.owner ? { owner: rec.owner, ownerName: rec.ownerName } : null),
      });
    }
    return out;
  }

  function clear() {
    for (const id of [...reg.records.keys()]) remove(id);
    for (const rec of reg.anims) if (rec.anim?.out) finalizeRemove(rec);
    reg.anims.length = 0;
  }

  /** Rebuilds everything from a saved list (no animation). Returns the count. */
  function load(list) {
    clear();
    let n = 0;
    if (!Array.isArray(list)) return 0;
    for (const e of list) {
      if (!e || typeof e !== 'object' || !PIECE[e.type]) continue;
      try {
        if (add(e, { animate: false })) n++;
      } catch (err) {
        console.warn('[build] could not restore a structure', e, err);
      }
    }
    return n;
  }

  function dispose() {
    clear();
    for (const set of reg.sets.values()) set.dispose();
    reg.sets.clear();
    for (const g of phantoms) g.dispose();
  }

  Object.assign(reg, { add, remove, update, serialize, load, clear, dispose });
  return reg;
}
