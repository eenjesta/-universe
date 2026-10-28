import * as THREE from 'three';
import { ihash, makeFarMaterial } from '../world/terrain/instancing.js';

/**
 * Streaming instanced layer (one plant / rock / prop variant) for the endless
 * world — the dynamic sibling of the hub's ScatterLayer:
 *
 *   far   one InstancedMesh holding every streamed instance (dense, swap-remove
 *         on chunk unload); its vertex shader collapses the instances drawn by the
 *         near mesh and those beyond `farRadius` (FAR_VS_COLLAPSE of the hub)
 *   near  detailed InstancedMesh refilled on the CPU with the instances within
 *         ~`nearRadius` of the camera (same per-instance dither as the shader,
 *         ihash(slot)), casting shadows
 *
 * Instances arrive per owner (a chunk key) and leave together. No per-frame
 * allocations; GPU uploads cover only the changed slot range.
 */
const STRIDE = 8; // x, y, z, rot, scale, r, g, b

export class DynamicScatter {
  constructor({ name, parent, near, far = null, capacity = 4096, dither = null, refresh = 6, tilt = 0 }) {
    this.name = name;
    this.parent = parent;
    this.capacity = capacity;
    this.nearRadius = near.radius;
    this.dither = dither ?? Math.min(14, near.radius * 0.12);
    this.refresh = refresh;
    this.tilt = tilt;
    this.data = new Float32Array(capacity * STRIDE);
    this.owner = new Int32Array(capacity);
    this.count = 0;
    this.owners = new Map(); // owner → Int32 slot list (JS array)
    this.ownerIds = new Map(); // owner key → numeric id
    this.ownerKeys = [];
    this.matrices = new Float32Array(capacity * 16);
    this.colors = new Float32Array(capacity * 3);
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    this.center = new THREE.Vector3(1e9, 0, 1e9);
    this.changed = false;
    this.density = 1;

    const nearCap = near.capacity ?? Math.min(capacity, 512);
    const nm = new THREE.InstancedMesh(near.geometry, near.material, nearCap);
    nm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nearCap * 3), 3);
    nm.instanceColor.setUsage(THREE.DynamicDrawUsage);
    nm.count = 0;
    nm.name = `${name}-near`;
    nm.castShadow = !!near.castShadow;
    nm.receiveShadow = true;
    if (near.depthMaterial) nm.customDepthMaterial = near.depthMaterial;
    nm.frustumCulled = false; // bounds follow the camera; culling per instance is the shader's job
    nm.raycast = () => {};
    this.near = nm;
    this.nearCap = nearCap;
    parent.add(nm);

    this.far = null;
    if (far) {
      this.farUniforms = {
        uNearCenter: { value: new THREE.Vector3(1e9, 0, 1e9) },
        uNearRadius: { value: this.nearRadius },
        uNearDither: { value: this.dither },
        uFarRadius: { value: far.radius ?? 1500 },
      };
      const mat = far.material.clone();
      mat.onBeforeCompile = far.material.onBeforeCompile;
      mat.customProgramCacheKey = far.material.customProgramCacheKey;
      makeFarMaterial(mat, this.farUniforms);
      const fm = new THREE.InstancedMesh(far.geometry, mat, capacity);
      fm.instanceMatrix = new THREE.InstancedBufferAttribute(this.matrices, 16);
      fm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      fm.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
      fm.instanceColor.setUsage(THREE.DynamicDrawUsage);
      fm.count = 0;
      fm.name = `${name}-far`;
      fm.castShadow = false;
      fm.receiveShadow = true;
      fm.frustumCulled = false;
      fm.raycast = () => {};
      this.far = fm;
      this.farMat = mat;
      parent.add(fm);
    }
  }

  _ownerId(key) {
    let id = this.ownerIds.get(key);
    if (id === undefined) {
      id = this.ownerKeys.length;
      this.ownerKeys.push(key);
      this.ownerIds.set(key, id);
    }
    return id;
  }

  _writeMatrix(i) {
    const d = this.data;
    const o = i * STRIDE;
    const s = d[o + 4];
    const c = Math.cos(d[o + 3]) * s;
    const sn = Math.sin(d[o + 3]) * s;
    const m = this.matrices;
    const k = i * 16;
    m[k] = c;
    m[k + 1] = 0;
    m[k + 2] = -sn;
    m[k + 3] = 0;
    m[k + 4] = 0;
    m[k + 5] = s;
    m[k + 6] = 0;
    m[k + 7] = 0;
    m[k + 8] = sn;
    m[k + 9] = 0;
    m[k + 10] = c;
    m[k + 11] = 0;
    m[k + 12] = d[o];
    m[k + 13] = d[o + 1];
    m[k + 14] = d[o + 2];
    m[k + 15] = 1;
    this.colors[i * 3] = d[o + 5];
    this.colors[i * 3 + 1] = d[o + 6];
    this.colors[i * 3 + 2] = d[o + 7];
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  /** Adds instances for `owner`: flat array of [x, y, z, rot, scale, r, g, b] × n. */
  add(owner, list, n = list.length / STRIDE) {
    if (!n) return;
    this.remove(owner);
    const oid = this._ownerId(owner);
    const slots = [];
    for (let k = 0; k < n; k++) {
      if (this.count >= this.capacity) break;
      const i = this.count++;
      this.data.set(list.subarray ? list.subarray(k * STRIDE, k * STRIDE + STRIDE) : list.slice(k * STRIDE, k * STRIDE + STRIDE), i * STRIDE);
      this.owner[i] = oid;
      slots.push(i);
      this._writeMatrix(i);
    }
    this.owners.set(owner, slots);
    this.changed = true;
  }

  remove(owner) {
    const slots = this.owners.get(owner);
    if (!slots) return;
    this.owners.delete(owner);
    // remove from the highest slot down so swap sources are never our own slots
    slots.sort((a, b) => b - a);
    for (const i of slots) {
      const last = this.count - 1;
      if (i !== last) {
        this.data.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
        const lo = this.owner[last];
        this.owner[i] = lo;
        const list = this.owners.get(this.ownerKeys[lo]);
        if (list) {
          const p = list.indexOf(last);
          if (p >= 0) list[p] = i;
        }
        this._writeMatrix(i);
      }
      this.count--;
    }
    this.changed = true;
  }

  has(owner) {
    return this.owners.has(owner);
  }

  setFarRadius(r) {
    if (this.farUniforms) this.farUniforms.uFarRadius.value = r;
  }

  /** Uploads changes and refills the near set when the camera moved (or instances changed). */
  update(cam) {
    if (this.far) {
      this.far.count = this.count;
      if (this.dirtyMax >= this.dirtyMin) {
        const a = this.far.instanceMatrix;
        a.clearUpdateRanges();
        a.addUpdateRange(this.dirtyMin * 16, (this.dirtyMax - this.dirtyMin + 1) * 16);
        a.needsUpdate = true;
        const c = this.far.instanceColor;
        c.clearUpdateRanges();
        c.addUpdateRange(this.dirtyMin * 3, (this.dirtyMax - this.dirtyMin + 1) * 3);
        c.needsUpdate = true;
      }
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    const dx = cam.x - this.center.x;
    const dz = cam.z - this.center.z;
    if (!this.changed && dx * dx + dz * dz < this.refresh * this.refresh) return;
    this.changed = false;
    this.center.set(cam.x, 0, cam.z);
    if (this.farUniforms) this.farUniforms.uNearCenter.value.copy(this.center);
    const nm = this.near;
    const nmat = nm.instanceMatrix.array;
    const ncol = nm.instanceColor.array;
    const d = this.data;
    const R = this.nearRadius;
    const D = this.dither;
    const lim = Math.round(this.count * this.density);
    let n = 0;
    for (let i = 0; i < lim && n < this.nearCap; i++) {
      const o = i * STRIDE;
      const ex = d[o] - cam.x;
      const ez = d[o + 2] - cam.z;
      const r = R + (ihash(i) - 0.5) * 2 * D;
      if (ex * ex + ez * ez >= r * r) continue;
      nmat.set(this.matrices.subarray(i * 16, i * 16 + 16), n * 16);
      ncol[n * 3] = this.colors[i * 3];
      ncol[n * 3 + 1] = this.colors[i * 3 + 1];
      ncol[n * 3 + 2] = this.colors[i * 3 + 2];
      n++;
    }
    nm.count = n;
    nm.instanceMatrix.clearUpdateRanges();
    nm.instanceMatrix.needsUpdate = true;
    nm.instanceColor.clearUpdateRanges();
    nm.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.parent.remove(this.near);
    this.near.dispose();
    if (this.far) {
      this.parent.remove(this.far);
      this.far.dispose();
      this.farMat.dispose();
    }
  }
}
