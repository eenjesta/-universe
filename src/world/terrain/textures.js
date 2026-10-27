import * as THREE from 'three';
import { HALF } from './shape.js';

/**
 * GPU textures built from the bake:
 *   heightGrid   R32F 1201² (nearest, texelFetch): exact heights for vertex
 *                displacement (terrain chunks, grass)
 *   heightPublic R16F 1024² (linear): the contract's `world.heightTexture`
 *                (R = metres, uv = (xz + 1200) / 2400) for the water shader
 *   data RGBA8   normal / splatA / splatB (see surface.js)
 *   detail       256² tileable RGBA noise: R,G = height gradient, B = height,
 *                A = cellular pattern (cracks / pebbles)
 */

export function heightGridTexture(heights, n) {
  const tex = new THREE.DataTexture(heights, n, n, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'terrain-height-grid';
  return tex;
}

export function publicHeightTexture(getHeightAt, size = 1024) {
  const data = new Uint16Array(size * size);
  const span = HALF * 2;
  for (let j = 0; j < size; j++) {
    const z = -HALF + ((j + 0.5) / size) * span;
    for (let i = 0; i < size; i++) {
      const x = -HALF + ((i + 0.5) / size) * span;
      data[j * size + i] = THREE.DataUtils.toHalfFloat(getHeightAt(x, z));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'terrain-height';
  // documentation for consumers (water shader): uv = (worldXZ + half) / size
  tex.userData = { size: span, half: HALF, uv: 'uv = (worldXZ + 1200.0) / 2400.0', unit: 'metres' };
  return tex;
}

export function dataTexture(rgba, n, name) {
  const tex = new THREE.DataTexture(rgba, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.anisotropy = 1; // low-frequency data: anisotropy buys nothing here
  tex.needsUpdate = true;
  tex.name = name;
  return tex;
}

/** Tileable detail noise (periodic gradient noise fBm + cellular). */
export function detailTexture(size = 256, seed = 7) {
  const rnd = mulberry(seed);
  const height = new Float32Array(size * size);
  // periodic value-gradient noise: random gradients on a wrapping lattice
  const octaves = [
    { cells: 8, amp: 0.5 },
    { cells: 16, amp: 0.26 },
    { cells: 32, amp: 0.14 },
    { cells: 64, amp: 0.07 },
    { cells: 128, amp: 0.03 },
  ];
  for (const o of octaves) {
    const c = o.cells;
    const gx = new Float32Array(c * c);
    const gy = new Float32Array(c * c);
    for (let k = 0; k < c * c; k++) {
      const a = rnd() * Math.PI * 2;
      gx[k] = Math.cos(a);
      gy[k] = Math.sin(a);
    }
    const cell = size / c;
    for (let y = 0; y < size; y++) {
      const fy = y / cell;
      const iy = Math.floor(fy);
      const ty = fy - iy;
      for (let x = 0; x < size; x++) {
        const fx = x / cell;
        const ix = Math.floor(fx);
        const tx = fx - ix;
        const dot = (cx, cy, dx, dy) => {
          const k = ((cy % c) + c) % c * c + (((cx % c) + c) % c);
          return gx[k] * dx + gy[k] * dy;
        };
        const n00 = dot(ix, iy, tx, ty);
        const n10 = dot(ix + 1, iy, tx - 1, ty);
        const n01 = dot(ix, iy + 1, tx, ty - 1);
        const n11 = dot(ix + 1, iy + 1, tx - 1, ty - 1);
        const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
        const v = (n00 + (n10 - n00) * sx) * (1 - sy) + (n01 + (n11 - n01) * sx) * sy;
        height[y * size + x] += v * o.amp * 1.6;
      }
    }
  }
  // cellular (worley F2-F1 edges) for cracks / pebbles
  const pts = [];
  const pc = 24;
  for (let k = 0; k < pc * pc; k++) pts.push([((k % pc) + rnd()) / pc, (Math.floor(k / pc) + rnd()) / pc]);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const h = height[k];
      const hx = height[y * size + ((x + 1) % size)] - height[y * size + ((x - 1 + size) % size)];
      const hy = height[((y + 1) % size) * size + x] - height[((y - 1 + size) % size) * size + x];
      // worley
      const u = x / size;
      const v = y / size;
      const cx = Math.floor(u * pc);
      const cy = Math.floor(v * pc);
      let f1 = 9;
      let f2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const qx = (cx + ox + pc) % pc;
          const qy = (cy + oy + pc) % pc;
          const p = pts[qy * pc + qx];
          let dx = p[0] - u;
          let dy = p[1] - v;
          dx -= Math.round(dx);
          dy -= Math.round(dy);
          const d = Math.sqrt(dx * dx + dy * dy) * pc;
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      const edge = Math.min(1, (f2 - f1) * 1.6);
      data[k * 4] = clamp255(128 + hx * 900);
      data[k * 4 + 1] = clamp255(128 + hy * 900);
      data[k * 4 + 2] = clamp255(128 + h * 150);
      data[k * 4 + 3] = clamp255(edge * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.name = 'terrain-detail';
  return tex;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
