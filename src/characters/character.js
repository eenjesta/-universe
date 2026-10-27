/**
 * Character = appearance + bones + animator + cached skinned geometry arrays
 * (characters module). Characters are drawn by a CharacterBatch (batch.js):
 * many characters share one SkinnedMesh / draw call.
 *
 *   const chr = new Character(app, { lod: 0, name: 'aria' });
 *   scene.add(chr.object);          // world placement: position + rotation.y = heading
 *   batch.add(chr); batch.rebuild();
 *   chr.anim.update(dt);            // procedural animation → bones
 */
import * as THREE from 'three';
import { normalizeAppearance, appearanceKey } from './appearance.js';
import { bodyFrame, createBones, applyFrame, BONE_COUNT } from './skeleton.js';
import { GeoBuilder } from './builder.js';
import { addBody } from './body.js';
import { addHead } from './head.js';
import { Animator } from './animator.js';
import { requestArrays } from './build-client.js';

const geoCache = new Map(); // key → arrays (LRU)
const CACHE_MAX = 72; // total entries
const HERO_MAX = 18; // LOD0 entries (≈2.5 MB each)

/** Cache key of an appearance + LOD build. */
export const arraysKey = (app, lod) => `${appearanceKey(normalizeAppearance(app))}#${lod}`;

/** Builds fresh (uncached) skinned geometry arrays — also used by the build worker. */
export function buildArrays(app, lod = 1) {
  const a = normalizeAppearance(app);
  const frame = bodyFrame(a);
  const b = new GeoBuilder(frame);
  const pal = addBody(b, a, frame, lod);
  addHead(b, a, frame, lod, pal);
  const arr = b.toArrays();
  arr.key = `${appearanceKey(a)}#${lod}`;
  return arr;
}

/** Cached arrays for a key (LRU touch), or null. */
export function cachedArrays(key) {
  const arr = geoCache.get(key);
  if (!arr) return null;
  geoCache.delete(key);
  geoCache.set(key, arr);
  return arr;
}

/** Builds (or fetches) the skinned geometry arrays for an appearance + LOD. */
export function buildCharacterArrays(app, lod = 1) {
  const key = arraysKey(app, lod);
  const hit = cachedArrays(key);
  if (hit) return hit;
  return putArrays(key, buildArrays(app, lod));
}

/** Inserts arrays (e.g. from the build worker) into the LRU cache. */
export function putArrays(key, arr) {
  arr.key = key;
  geoCache.set(key, arr);
  let hero = 0;
  for (const k of geoCache.keys()) if (k.endsWith('#0')) hero++;
  for (const k of geoCache.keys()) {
    if (geoCache.size <= CACHE_MAX && hero <= HERO_MAX) break;
    if (k === key) continue;
    if (geoCache.size > CACHE_MAX || k.endsWith('#0')) {
      if (k.endsWith('#0')) hero--;
      geoCache.delete(k);
    }
  }
  return arr;
}

let _id = 0;

/** Zero-size arrays: a character that is still waiting for its mesh draws nothing. */
const EMPTY = {
  position: new Float32Array(0),
  normal: new Float32Array(0),
  uv: new Float32Array(0),
  color: new Float32Array(0),
  aMat: new Float32Array(0),
  aDetail: new Float32Array(0),
  skinIndex: new Uint16Array(0),
  skinWeight: new Float32Array(0),
  index: new Uint32Array(0),
  count: 0,
  key: 'empty',
};

export class Character {
  /**
   * opts: { lod, name, seed, deferLoad } — with deferLoad the character starts
   * without a mesh (draws nothing, `pending` = true) until load() delivers it
   * from the build worker; otherwise the mesh is built (or fetched) right away.
   */
  constructor(app, { lod = 1, name = 'chr', seed, deferLoad = false } = {}) {
    this.id = ++_id;
    this.name = name;
    this.lod = lod;
    this.appearance = normalizeAppearance(app);
    this.frame = bodyFrame(this.appearance);
    const { root, bones } = createBones(this.frame, name);
    this.root = root;
    this.bones = bones;
    this.bindLocal = bones.map((b) => b.position.clone());
    /** World placement: position on the ground, rotation.y = heading. */
    this.object = new THREE.Group();
    this.object.name = `${name}-object`;
    this.object.add(root);
    this.batch = null;
    this.hidden = false;
    this.onArrays = null; // (chr) => void, called when an async mesh arrives
    this._want = null;
    const hit = deferLoad ? cachedArrays(arraysKey(this.appearance, lod)) : null;
    if (deferLoad && !hit) {
      this.arrays = EMPTY;
      this.pending = true;
    } else {
      this.arrays = hit || buildCharacterArrays(this.appearance, lod);
      this.pending = false;
    }
    this.anim = new Animator(this, seed ?? this.id * 7919);
  }

  /** Requests the mesh of a deferred character from the build worker. */
  load() {
    if (!this.pending) return Promise.resolve(this);
    return this._fetch(this.appearance, this.lod);
  }

  _fetch(app, lod) {
    const key = arraysKey(app, lod);
    this._want = key;
    return requestArrays(app, lod).then((arr) => {
      if (this._want !== key) return this; // superseded by a newer request
      this._want = null;
      this._apply(app, lod, arr);
      this.onArrays?.(this);
      return this;
    });
  }

  _apply(a, lod, arr) {
    const sameFrame = appearanceKey(a) === appearanceKey(this.appearance);
    this.appearance = a;
    this.lod = lod;
    if (!sameFrame) {
      this.frame = bodyFrame(a);
      applyFrame(this.bones, this.frame);
      this.bindLocal = this.bones.map((b) => b.position.clone());
    }
    this.arrays = arr;
    this.pending = false;
    this.batch?.markDirty();
  }

  get position() {
    return this.object.position;
  }

  /** Heading (rotation.y of the placement group). */
  get heading() {
    return this.object.rotation.y;
  }
  set heading(h) {
    this.object.rotation.y = h;
  }

  /** Changes the look; the owning batch rebuilds its mesh (returns true if changed). */
  setAppearance(app, lod = this.lod) {
    const a = normalizeAppearance(app);
    if (appearanceKey(a) === appearanceKey(this.appearance) && lod === this.lod && !this.pending && !this._want) return false;
    this._want = null;
    this._apply(a, lod, buildCharacterArrays(a, lod));
    return true;
  }

  /**
   * Like setAppearance but never blocks: cached meshes swap immediately,
   * otherwise the current mesh stays until the worker delivers the new one
   * (onArrays fires; the latest request wins). Returns true if a change started.
   */
  setAppearanceAsync(app, lod = this.lod) {
    const a = normalizeAppearance(app);
    const key = arraysKey(a, lod);
    if (key === arraysKey(this.appearance, this.lod) && !this.pending) {
      this._want = null;
      return false;
    }
    if (this._want === key) return true;
    const hit = cachedArrays(key);
    if (hit) {
      this._want = null;
      this._apply(a, lod, hit);
      return true;
    }
    this._fetch(a, lod);
    return true;
  }

  /** Hides this character inside its batch (collapses its bones). */
  setHidden(h) {
    if (this.hidden === h) return;
    this.hidden = h;
    this.root.scale.setScalar(h ? 1e-4 : 1);
  }

  /** World position of a joint (no allocation when `out` is given). */
  jointWorld(index, out = new THREE.Vector3()) {
    const b = this.bones[index];
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  /** Approximate head-top world position without matrix updates (cheap). */
  headTop(out = new THREE.Vector3()) {
    const p = this.object.position;
    const top = this.frame.headC.y + 0.16 * this.frame.headScale;
    return out.set(p.x, p.y + top + this.anim.hipOff.y, p.z);
  }

  static get BONES() {
    return BONE_COUNT;
  }
}
