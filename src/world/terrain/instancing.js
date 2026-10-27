import * as THREE from 'three';

/**
 * ScatterLayer: one instanced kind (tree variant, rock shape, flower clump…)
 * with two LODs.
 *
 *   near  InstancedMesh holding only instances within ~`nearRadius` of the
 *         camera; refilled from a 64 m spatial grid when the camera has moved
 *         more than `refresh` metres (detailed geometry, wind, shadows).
 *   far   InstancedMesh holding ALL instances (static buffers); its vertex
 *         shader collapses the instances the near mesh draws (same per-instance
 *         dithered threshold as the CPU selection, via gl_InstanceID) and the
 *         ones beyond `farRadius`.
 *
 * Instances are stored shuffled, so a density < 1 (quality presets) is a
 * uniform random subset: the first `round(n · density)` instances.
 * `clearArea(x, z, r)` removes instances (e.g. under a landmark), including
 * their physics boxes.
 */

const CELL = 64;

/** Integer hash → [0, 1], identical in JS and GLSL (see FAR_VS_PARS). */
export function ihash(i) {
  let x = i >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}

export const FAR_VS_PARS = /* glsl */ `
uniform vec3 uNearCenter;
uniform float uNearRadius;
uniform float uNearDither;
uniform float uFarRadius;
float ihash(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return float(x) / 4294967295.0;
}
`;

/** Snippet to insert after `vec3 transformed = …` in a far-LOD vertex shader. */
export const FAR_VS_COLLAPSE = /* glsl */ `
{
  vec2 iPos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float iR = uNearRadius + (ihash(uint(gl_InstanceID)) - 0.5) * 2.0 * uNearDither;
  if (distance(iPos, uNearCenter.xz) < iR || distance(iPos, cameraPosition.xz) > uFarRadius) transformed = vec3(0.0);
}
`;

/** Patches a material so it can serve as a far LOD (adds the collapse logic). */
export function makeFarMaterial(material, uniforms) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FAR_VS_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FAR_VS_COLLAPSE}`);
  };
  const key = material.customProgramCacheKey?.() ?? '';
  material.customProgramCacheKey = () => `${key}|far`;
  return material;
}

export class ScatterLayer {
  /**
   * @param {object} o
   *  name, parent (Object3D)
   *  instances: array of {x, y, z, ry, s, sy?, tx?, tz?, color?: [r,g,b], box?: {w,h,d,walkable}}
   *  near: {geometry, material, radius, castShadow, depthMaterial?}
   *  far:  {geometry, material, radius} | null  (material must be shared-uniform-ready)
   *  dither: metres of per-instance jitter of the near radius
   */
  constructor(o) {
    this.name = o.name;
    this.parent = o.parent;
    this.nearRadius = o.near.radius;
    this.dither = o.dither ?? Math.min(18, o.near.radius * 0.12);
    this.refresh = o.refresh ?? Math.max(6, o.near.radius * 0.06);
    this.density = 1;
    const list = o.instances;
    const n = list.length;
    this.total = n;
    this.count = n;
    this.matrices = new Float32Array(n * 16);
    this.colors = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 2);
    this.radiusSq = new Float32Array(n); // per-instance dithered near radius²
    this.removed = new Uint8Array(n);
    this.boxIds = new Int32Array(n).fill(-1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const it = list[i];
      e.set(it.tx || 0, it.ry || 0, it.tz || 0, 'YXZ');
      q.setFromEuler(e);
      p.set(it.x, it.y, it.z);
      s.set(it.s, it.sy ?? it.s, it.s);
      m.compose(p, q, s);
      m.toArray(this.matrices, i * 16);
      const c = it.color || [1, 1, 1];
      this.colors[i * 3] = c[0];
      this.colors[i * 3 + 1] = c[1];
      this.colors[i * 3 + 2] = c[2];
      this.pos[i * 2] = it.x;
      this.pos[i * 2 + 1] = it.z;
      const r = this.nearRadius + (ihash(i) - 0.5) * 2 * this.dither;
      this.radiusSq[i] = r * r;
    }
    // spatial grid (cell → instance indices)
    this.cells = new Map();
    for (let i = 0; i < n; i++) {
      const key = this._key(Math.floor(this.pos[i * 2] / CELL), Math.floor(this.pos[i * 2 + 1] / CELL));
      let arr = this.cells.get(key);
      if (!arr) this.cells.set(key, (arr = []));
      arr.push(i);
    }
    for (const [k, arr] of this.cells) this.cells.set(k, Int32Array.from(arr));

    // near mesh
    this.nearGeo = o.near.geometry;
    this.nearMat = o.near.material;
    this.nearCast = !!o.near.castShadow;
    this.nearDepth = o.near.depthMaterial || null;
    this.near = null;
    this._allocNear(Math.min(n, Math.max(64, o.near.capacity || 256)));

    // far mesh (static)
    this.far = null;
    this.farUniforms = null;
    if (o.far && n > 0) {
      this.farUniforms = {
        uNearCenter: { value: new THREE.Vector3(1e6, 0, 1e6) },
        uNearRadius: { value: this.nearRadius },
        uNearDither: { value: this.dither },
        uFarRadius: { value: o.far.radius ?? 3000 },
      };
      const mat = o.far.material.clone();
      mat.onBeforeCompile = o.far.material.onBeforeCompile;
      mat.customProgramCacheKey = o.far.material.customProgramCacheKey;
      makeFarMaterial(mat, this.farUniforms);
      this.farMat = mat;
      const far = new THREE.InstancedMesh(o.far.geometry, mat, n);
      far.instanceMatrix = new THREE.InstancedBufferAttribute(this.matrices, 16);
      far.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
      far.name = `${this.name}-far`;
      far.castShadow = false;
      far.receiveShadow = true;
      far.frustumCulled = true;
      far.computeBoundingSphere();
      far.raycast = () => {};
      this.far = far;
      this.parent.add(far);
    }
    this.center = new THREE.Vector3(1e6, 0, 1e6);
    this.nearCount = 0;
  }

  _key(cx, cz) {
    return cx * 4096 + cz;
  }

  _allocNear(capacity) {
    if (this.near) {
      this.parent.remove(this.near);
      this.near.dispose();
    }
    const mesh = new THREE.InstancedMesh(this.nearGeo, this.nearMat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.name = `${this.name}-near`;
    mesh.castShadow = this.nearCast;
    mesh.receiveShadow = true;
    if (this.nearDepth) mesh.customDepthMaterial = this.nearDepth;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.nearRadius + this.dither + 40);
    mesh.raycast = () => {};
    this.near = mesh;
    this.capacity = capacity;
    this.parent.add(mesh);
  }

  /** Re-selects the near set when the camera moved far enough (or `force`). */
  update(cam, force = false) {
    const dx = cam.x - this.center.x;
    const dz = cam.z - this.center.z;
    if (!force && dx * dx + dz * dz < this.refresh * this.refresh) return false;
    this.center.set(cam.x, 0, cam.z);
    if (this.farUniforms) this.farUniforms.uNearCenter.value.copy(this.center);
    const reach = this.nearRadius + this.dither;
    const c0x = Math.floor((cam.x - reach) / CELL);
    const c1x = Math.floor((cam.x + reach) / CELL);
    const c0z = Math.floor((cam.z - reach) / CELL);
    const c1z = Math.floor((cam.z + reach) / CELL);
    let k = 0;
    let need = 0;
    // count first (grow capacity if needed), then fill
    for (let pass = 0; pass < 2; pass++) {
      k = 0;
      for (let cx = c0x; cx <= c1x; cx++) {
        for (let cz = c0z; cz <= c1z; cz++) {
          const arr = this.cells.get(this._key(cx, cz));
          if (!arr) continue;
          for (let a = 0; a < arr.length; a++) {
            const i = arr[a];
            if (i >= this.count || this.removed[i]) continue;
            const ex = this.pos[i * 2] - cam.x;
            const ez = this.pos[i * 2 + 1] - cam.z;
            if (ex * ex + ez * ez >= this.radiusSq[i]) continue;
            if (pass === 1) {
              this.near.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), k * 16);
              this.near.instanceColor.array.set(this.colors.subarray(i * 3, i * 3 + 3), k * 3);
            }
            k++;
          }
        }
      }
      if (pass === 0) {
        need = k;
        if (need > this.capacity) this._allocNear(Math.ceil(need * 1.3));
      }
    }
    this.near.count = need;
    this.nearCount = need;
    this.near.instanceMatrix.needsUpdate = true;
    this.near.instanceColor.needsUpdate = true;
    this.near.instanceMatrix.clearUpdateRanges();
    this.near.instanceMatrix.addUpdateRange(0, need * 16);
    this.near.instanceColor.clearUpdateRanges();
    this.near.instanceColor.addUpdateRange(0, need * 3);
    this.near.boundingSphere.center.set(cam.x, cam.y, cam.z);
    return true;
  }

  setDensity(d) {
    this.density = Math.max(0, Math.min(1, d));
    this.count = Math.round(this.total * this.density);
    if (this.far) this.far.count = this.count;
    this.center.set(1e6, 0, 1e6); // force a near refresh
  }

  setFarRadius(r) {
    if (this.farUniforms) this.farUniforms.uFarRadius.value = r;
  }

  /** Removes instances inside the circle; returns how many were removed. */
  clearArea(x, z, r, physics = null) {
    let removed = 0;
    const r2 = r * r;
    const c0x = Math.floor((x - r) / CELL);
    const c1x = Math.floor((x + r) / CELL);
    const c0z = Math.floor((z - r) / CELL);
    const c1z = Math.floor((z + r) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = this.cells.get(this._key(cx, cz));
        if (!arr) continue;
        for (const i of arr) {
          if (this.removed[i]) continue;
          const ex = this.pos[i * 2] - x;
          const ez = this.pos[i * 2 + 1] - z;
          if (ex * ex + ez * ez > r2) continue;
          this.removed[i] = 1;
          // collapse the static far instance
          for (let c = 0; c < 16; c++) this.matrices[i * 16 + c] = 0;
          if (this.boxIds[i] >= 0 && physics) physics.remove(this.boxIds[i]);
          this.boxIds[i] = -1;
          removed++;
        }
      }
    }
    if (removed) {
      if (this.far) this.far.instanceMatrix.needsUpdate = true;
      this.center.set(1e6, 0, 1e6);
    }
    return removed;
  }

  /** Iterates live instances: fn(index, x, z, matrixArray, offset). */
  forEach(fn) {
    for (let i = 0; i < this.total; i++) if (!this.removed[i]) fn(i, this.pos[i * 2], this.pos[i * 2 + 1], this.matrices, i * 16);
  }

  dispose() {
    if (this.near) {
      this.parent.remove(this.near);
      this.near.dispose();
    }
    if (this.far) {
      this.parent.remove(this.far);
      this.far.dispose();
      this.farMat?.dispose();
    }
  }
}
