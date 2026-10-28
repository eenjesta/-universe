import * as THREE from 'three';
import { ihash } from '../world/terrain/instancing.js';

/**
 * Streaming instanced layer (one plant / rock / prop variant) for the endless
 * world — the dynamic sibling of the hub's ScatterLayer:
 *
 *   far   one InstancedMesh holding every streamed instance (dense, swap-remove
 *         on chunk unload); its vertex shader collapses the instances drawn by the
 *         near mesh and those beyond `farRadius`, and shrinks them over the last
 *         few % before `farRadius` (no hard pop at the streaming edge)
 *   near  detailed InstancedMesh refilled on the CPU with the instances within
 *         ~`nearRadius` of the camera, casting shadows
 *
 * Stability (nothing may jump while the camera moves):
 *   - the per-instance near/far dither is a hash of the instance's POSITION, not of
 *     its slot: swap-remove moves instances between slots whenever a chunk unloads
 *     or refills, and a slot hash then made trees flip between their near model and
 *     their impostor (the impostor's mirror flip is position-hashed too, impostor.js)
 *   - capacities GROW (far up to `maxCapacity`, near up to `maxNear`) instead of
 *     silently dropping instances: a fixed cap used to drop whole chunks of trees
 *     in dense forests, and which chunks lost them depended on the load order —
 *     trees vanished and others appeared while flying
 *
 * Instances arrive per owner (a chunk key) and leave together. No per-frame
 * allocations (growth is rare and amortised ×1.5); GPU uploads cover only the
 * changed slot range.
 */
const STRIDE = 8; // x, y, z, rot, scale, r, g, b

// float bits of a position (same bits as floatBitsToUint() of the instance matrix in the shader)
const f32 = new Float32Array(2);
const u32 = new Uint32Array(f32.buffer);
/** Position hash ∈ [0, 1] — identical to FAR_POS_HASH in the far vertex shader. */
export function posHash(x, z) {
  f32[0] = x;
  f32[1] = z;
  return ihash((u32[0] ^ Math.imul(u32[1], 0x9e3779b1)) >>> 0);
}

const FAR_VS_PARS = /* glsl */ `
uniform vec3 uNearCenter;
uniform float uNearRadius;
uniform float uNearDither;
uniform float uFarRadius;
float farPosHash(vec2 p) {
  uint x = floatBitsToUint(p.x) ^ (floatBitsToUint(p.y) * 0x9e3779b1u);
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return float(x) / 4294967295.0;
}
`;
const FAR_VS_COLLAPSE = /* glsl */ `
{
  vec2 iPos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float iR = uNearRadius + (farPosHash(iPos) - 0.5) * 2.0 * uNearDither;
  float iD = distance(iPos, cameraPosition.xz);
  if (distance(iPos, uNearCenter.xz) < iR || iD > uFarRadius) transformed = vec3(0.0);
  else transformed *= 1.0 - smoothstep(uFarRadius - min(60.0, uFarRadius * 0.08), uFarRadius, iD);
}
`;

function makeFarMaterial(material, uniforms) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FAR_VS_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FAR_VS_COLLAPSE}`);
  };
  const key = material.customProgramCacheKey?.() ?? '';
  material.customProgramCacheKey = () => `${key}|frontier-far-v2`;
  return material;
}

export class DynamicScatter {
  constructor({ name, parent, near, far = null, capacity = 4096, maxCapacity = 0, dither = null, refresh = 6, tilt = 0 }) {
    this.name = name;
    this.parent = parent;
    this.capacity = capacity;
    this.maxCapacity = Math.max(capacity, maxCapacity || capacity * 8);
    this.nearRadius = near.radius;
    this.dither = dither ?? Math.min(14, near.radius * 0.12);
    this.refresh = refresh;
    this.tilt = tilt;
    this.data = new Float32Array(capacity * STRIDE);
    this.owner = new Int32Array(capacity);
    this.hash = new Float32Array(capacity); // posHash per slot (near/far dither)
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
    this.dropped = 0; // instances refused at maxCapacity (should stay 0)

    this.nearGeo = near.geometry;
    this.nearMat = near.material;
    this.nearDepth = near.depthMaterial || null;
    this.nearCast = !!near.castShadow;
    this.maxNear = Math.max(near.capacity ?? 512, near.maxCapacity ?? 8192);
    this.near = null;
    this._allocNear(near.capacity ?? Math.min(capacity, 512));

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
      this.farGeo = far.geometry;
      this.farMat = mat;
      this._allocFar();
    }
  }

  _allocNear(cap) {
    const old = this.near;
    const nm = new THREE.InstancedMesh(this.nearGeo, this.nearMat, cap);
    nm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    nm.instanceColor.setUsage(THREE.DynamicDrawUsage);
    nm.count = 0;
    nm.name = `${this.name}-near`;
    nm.castShadow = this.nearCast;
    nm.receiveShadow = true;
    if (this.nearDepth) nm.customDepthMaterial = this.nearDepth;
    nm.frustumCulled = false; // bounds follow the camera; culling per instance is the shader's job
    nm.raycast = () => {};
    this.near = nm;
    this.nearCap = cap;
    this.parent.add(nm);
    if (old) {
      this.parent.remove(old);
      old.dispose(); // frees its instance buffers (geometry + material are shared)
    }
  }

  _allocFar() {
    const old = this.far;
    const fm = new THREE.InstancedMesh(this.farGeo, this.farMat, 1);
    fm.instanceMatrix = new THREE.InstancedBufferAttribute(this.matrices, 16);
    fm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fm.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    fm.instanceColor.setUsage(THREE.DynamicDrawUsage);
    fm.count = this.count;
    fm.name = `${this.name}-far`;
    fm.castShadow = false;
    fm.receiveShadow = true;
    fm.frustumCulled = false;
    fm.raycast = () => {};
    this.far = fm;
    this.parent.add(fm);
    if (old) {
      this.parent.remove(old);
      old.dispose();
    }
  }

  /** Makes room for `need` instances (×1.5 steps up to maxCapacity); false when full. */
  _grow(need) {
    if (need <= this.capacity) return true;
    if (this.capacity >= this.maxCapacity) return false;
    const cap = Math.min(this.maxCapacity, Math.max(need, Math.ceil(this.capacity * 1.5)));
    const grow = (Arr, a, per) => {
      const b = new Arr(cap * per);
      b.set(a.subarray(0, this.count * per));
      return b;
    };
    this.data = grow(Float32Array, this.data, STRIDE);
    this.owner = grow(Int32Array, this.owner, 1);
    this.hash = grow(Float32Array, this.hash, 1);
    this.matrices = grow(Float32Array, this.matrices, 16);
    this.colors = grow(Float32Array, this.colors, 3);
    this.capacity = cap;
    if (this.far) {
      this._allocFar(); // new GPU buffers: upload everything once
      this.dirtyMin = Infinity;
      this.dirtyMax = -1;
    }
    return need <= cap;
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
    this.hash[i] = posHash(d[o], d[o + 2]);
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  /** Adds instances for `owner`: flat array of [x, y, z, rot, scale, r, g, b] × n. */
  add(owner, list, n = list.length / STRIDE) {
    this.remove(owner);
    if (!n) return;
    if (this.count + n > this.capacity && !this._grow(this.count + n)) {
      this.dropped += this.count + n - this.capacity;
      if (!this._warned) {
        this._warned = true;
        console.warn(`[frontier] ${this.name}: more than ${this.capacity} instances — some are not drawn`);
      }
    }
    const oid = this._ownerId(owner);
    const slots = [];
    for (let k = 0; k < n; k++) {
      if (this.count >= this.capacity) break;
      const i = this.count++;
      const src = k * STRIDE;
      const dst = i * STRIDE;
      for (let q = 0; q < STRIDE; q++) this.data[dst + q] = list[src + q];
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

  get farRadius() {
    return this.farUniforms ? this.farUniforms.uFarRadius.value : 0;
  }

  /** True when slot i is in the near set for a near centre (cx, cz) — the shader's rule. */
  inNear(i, cx, cz) {
    const o = i * STRIDE;
    const ex = this.data[o] - cx;
    const ez = this.data[o + 2] - cz;
    const r = this.nearRadius + (this.hash[i] - 0.5) * 2 * this.dither;
    return ex * ex + ez * ez < r * r;
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
    const lim = Math.round(this.count * this.density);
    let n = this._fillNear(cam, lim);
    if (n < 0) {
      // more instances in the near ring than the near mesh holds: grow it (rare) and refill —
      // the far mesh already hides them there, so a full near mesh would leave holes
      let need = 0;
      for (let i = 0; i < lim; i++) if (this.inNear(i, cam.x, cam.z)) need++;
      this._allocNear(Math.min(this.maxNear, Math.max(need + 64, Math.ceil(this.nearCap * 1.5))));
      n = Math.abs(this._fillNear(cam, lim));
    }
    const nm = this.near;
    nm.count = n;
    nm.instanceMatrix.clearUpdateRanges();
    nm.instanceMatrix.needsUpdate = true;
    nm.instanceColor.clearUpdateRanges();
    nm.instanceColor.needsUpdate = true;
  }

  /** Copies the near ring into the near mesh → count, or −count when the mesh was too small. */
  _fillNear(cam, lim) {
    const nmat = this.near.instanceMatrix.array;
    const ncol = this.near.instanceColor.array;
    const m = this.matrices;
    const col = this.colors;
    const cap = this.nearCap;
    let n = 0;
    for (let i = 0; i < lim; i++) {
      if (!this.inNear(i, cam.x, cam.z)) continue;
      if (n >= cap) return -n;
      const s = i * 16;
      const t = n * 16;
      for (let q = 0; q < 16; q++) nmat[t + q] = m[s + q];
      ncol[n * 3] = col[i * 3];
      ncol[n * 3 + 1] = col[i * 3 + 1];
      ncol[n * 3 + 2] = col[i * 3 + 2];
      n++;
    }
    return n;
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
