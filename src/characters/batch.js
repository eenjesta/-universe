/**
 * CharacterBatch (characters module): draws many Characters with ONE
 * SkinnedMesh + ONE material (one draw call + one shadow draw call).
 * All characters' geometry arrays are merged; every character contributes
 * BONE_COUNT bones to a combined Skeleton (bone texture). The mesh sits at the
 * scene origin (or under `parent`) with identity bind matrix, so bone world
 * matrices place each character.
 *
 * Frustum culling uses a bounding sphere we maintain ourselves: fixed local
 * bounds for single-character batches attached to a moving parent, otherwise
 * recomputed from member positions each frame (updateBounds()).
 */
import * as THREE from 'three';
import { geometryFromArrays } from './builder.js';
import { BONE_COUNT } from './skeleton.js';

const IDENTITY = new THREE.Matrix4();

export class CharacterBatch {
  constructor({ material, parent, name = 'characters', castShadow = true, receiveShadow = true, localBounds = null }) {
    this.material = material;
    this.parent = parent;
    this.name = name;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.chars = [];
    this.mesh = null;
    this.skeleton = null;
    this.dirty = false;
    this.localBounds = localBounds;
    this.sphere = localBounds ? localBounds.clone() : new THREE.Sphere(new THREE.Vector3(), 1);
    this.visible = true;
  }

  add(chr) {
    if (chr.batch === this) return;
    chr.batch?.remove(chr);
    chr.batch = this;
    this.chars.push(chr);
    this.dirty = true;
  }

  remove(chr) {
    const i = this.chars.indexOf(chr);
    if (i >= 0) this.chars.splice(i, 1);
    if (chr.batch === this) chr.batch = null;
    this.dirty = true;
  }

  markDirty() {
    this.dirty = true;
  }

  /** Rebuilds the merged geometry + skeleton if anything changed. */
  rebuild(force = false) {
    if (!this.dirty && !force && this.mesh) return;
    this.dirty = false;
    const chars = this.chars;
    if (!chars.length) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    let vc = 0;
    let ic = 0;
    for (const c of chars) {
      vc += c.arrays.count;
      ic += c.arrays.index.length;
    }
    const m = {
      position: new Float32Array(vc * 3),
      normal: new Float32Array(vc * 3),
      uv: new Float32Array(vc * 2),
      color: new Float32Array(vc * 3),
      aMat: new Float32Array(vc * 4),
      aDetail: new Float32Array(vc),
      skinIndex: new Uint16Array(vc * 4),
      skinWeight: new Float32Array(vc * 4),
      index: new Uint32Array(ic),
    };
    let vo = 0;
    let io = 0;
    chars.forEach((c, slot) => {
      const a = c.arrays;
      m.position.set(a.position, vo * 3);
      m.normal.set(a.normal, vo * 3);
      m.uv.set(a.uv, vo * 2);
      m.color.set(a.color, vo * 3);
      m.aMat.set(a.aMat, vo * 4);
      m.aDetail.set(a.aDetail, vo);
      m.skinWeight.set(a.skinWeight, vo * 4);
      const boneBase = slot * BONE_COUNT;
      const si = a.skinIndex;
      for (let k = 0; k < si.length; k++) m.skinIndex[vo * 4 + k] = si[k] + boneBase;
      const idx = a.index;
      for (let k = 0; k < idx.length; k++) m.index[io + k] = idx[k] + vo;
      vo += a.count;
      io += idx.length;
    });
    const geo = geometryFromArrays(m);
    const bones = [];
    const inverses = [];
    for (const c of chars) {
      for (let i = 0; i < BONE_COUNT; i++) {
        bones.push(c.bones[i]);
        // the mesh is modelled in the A-pose bind (see skeleton.js)
        inverses.push(c.frame.bindInverse[i].clone());
      }
    }
    const skeleton = new THREE.Skeleton(bones, inverses);
    if (!this.mesh) {
      this.mesh = new THREE.SkinnedMesh(geo, this.material);
      this.mesh.name = this.name;
      this.mesh.castShadow = this.castShadow;
      this.mesh.receiveShadow = this.receiveShadow;
      this.mesh.frustumCulled = true;
      this.parent?.add(this.mesh);
    } else {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geo;
    }
    const old = this.skeleton;
    this.mesh.bind(skeleton, IDENTITY);
    this.skeleton = skeleton;
    old?.dispose();
    this.mesh.boundingSphere = this.sphere;
    this.mesh.visible = this.visible;
  }

  /** Recomputes the culling sphere from member positions (world-space batches). */
  updateBounds() {
    if (this.localBounds || !this.chars.length) return;
    const s = this.sphere;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const c of this.chars) {
      if (c.hidden) continue;
      const p = c.object.position;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }
    if (minX === Infinity) {
      s.center.set(0, -1e5, 0);
      s.radius = 0.1;
      return;
    }
    s.center.set((minX + maxX) / 2, (minY + maxY) / 2 + 1, (minZ + maxZ) / 2);
    s.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 2.2;
  }

  setVisible(v) {
    this.visible = v;
    if (this.mesh) this.mesh.visible = v;
  }

  get triangles() {
    return this.mesh ? this.mesh.geometry.index.count / 3 : 0;
  }

  dispose() {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
    }
    this.skeleton?.dispose();
    this.mesh = null;
    this.skeleton = null;
    for (const c of this.chars) c.batch = null;
    this.chars = [];
  }
}
