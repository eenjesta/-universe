import * as THREE from 'three';
import { mulberry32 } from '../../core/math.js';

/**
 * Procedural textures for the atmosphere (all generated at start-up, no files):
 *  - tileable RGBA noise used by clouds, mist, waterfalls and the milky band
 *    (R: large Perlin fbm, G: Perlin-Worley mix, B: fine Perlin, A: Worley cells)
 *  - tileable water normal map (RG = slope, B = 1, A = foam noise)
 *  - one canvas atlas with the lens-flare sprites
 * The raw noise channels are kept on the CPU so clouds can be sampled in JS
 * (sun dimming / flare occlusion behind clouds).
 */

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Periodic 2D Perlin noise on a P×P lattice. Returns f(x, y) in ≈[-1, 1] (x, y in lattice units). */
function periodicPerlin(P, rnd) {
  const gx = new Float32Array(P * P);
  const gy = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) {
    const a = rnd() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % P) + P) % P;
    const y0 = ((yi % P) + P) % P;
    const x1 = (x0 + 1) % P;
    const y1 = (y0 + 1) % P;
    const i00 = y0 * P + x0;
    const i10 = y0 * P + x1;
    const i01 = y1 * P + x0;
    const i11 = y1 * P + x1;
    const n00 = gx[i00] * xf + gy[i00] * yf;
    const n10 = gx[i10] * (xf - 1) + gy[i10] * yf;
    const n01 = gx[i01] * xf + gy[i01] * (yf - 1);
    const n11 = gx[i11] * (xf - 1) + gy[i11] * (yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.414;
  };
}

/** Periodic Worley (F1) noise with one feature point per cell on a P×P grid; returns f(x, y) in [0, ~1]. */
function periodicWorley(P, rnd) {
  const px = new Float32Array(P * P);
  const py = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) {
    px[i] = rnd();
    py[i] = rnd();
  }
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let best = 9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = xi + ox;
        const cy = yi + oy;
        const k = (((cy % P) + P) % P) * P + (((cx % P) + P) % P);
        const dx = cx + px[k] - x;
        const dy = cy + py[k] - y;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
    }
    return Math.min(1, Math.sqrt(best));
  };
}

/** Tileable fbm built from periodic Perlin octaves (base period P, doubling). */
function makeFbm(P, octaves, rnd, gain = 0.5) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(periodicPerlin(P << o, rnd));
  return (u, v) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const p = P << o;
      sum += layers[o](u * p, v * p) * amp;
      norm += amp;
      amp *= gain;
    }
    return sum / norm;
  };
}

/**
 * RGBA tileable noise, `size`² pixels. Returns { texture, channels } where
 * channels are Float32Arrays (0..1) for CPU sampling via sampleChannel().
 */
export function createNoiseTexture(size = 256, seed = 1337) {
  const rnd = mulberry32(seed);
  const fbmLow = makeFbm(4, 5, rnd, 0.52);
  const fbmMid = makeFbm(8, 4, rnd, 0.5);
  const wMid = periodicWorley(8, rnd);
  const wMid2 = periodicWorley(16, rnd);
  const fbmHigh = makeFbm(16, 3, rnd, 0.55);
  const wCell = periodicWorley(6, rnd);
  const wCell2 = periodicWorley(12, rnd);

  const n = size * size;
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const A = new Float32Array(n);
  const data = new Uint8Array(n * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const r = 0.5 + 0.5 * fbmLow(u, v);
      const pw = 0.5 + 0.5 * fbmMid(u, v);
      const wor = 1 - (wMid(u * 8, v * 8) * 0.65 + wMid2(u * 16, v * 16) * 0.35);
      const g = pw * 0.55 + wor * 0.45;
      const b = 0.5 + 0.5 * fbmHigh(u, v);
      const a = 1 - (wCell(u * 6, v * 6) * 0.7 + wCell2(u * 12, v * 12) * 0.3);
      R[i] = Math.min(1, Math.max(0, (r - 0.5) * 1.35 + 0.5));
      G[i] = Math.min(1, Math.max(0, (g - 0.5) * 1.5 + 0.5));
      B[i] = Math.min(1, Math.max(0, (b - 0.5) * 1.3 + 0.5));
      A[i] = Math.min(1, Math.max(0, a));
      data[i * 4] = R[i] * 255;
      data[i * 4 + 1] = G[i] * 255;
      data[i * 4 + 2] = B[i] * 255;
      data[i * 4 + 3] = A[i] * 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.NoColorSpace;
  texture.name = 'atmo-noise';
  texture.needsUpdate = true;
  return { texture, size, channels: [R, G, B, A] };
}

/** Bilinear, wrapping sample of one CPU noise channel at uv (tile units). */
export function sampleChannel(noise, ch, u, v) {
  const s = noise.size;
  const arr = noise.channels[ch];
  const x = u * s - 0.5;
  const y = v * s - 0.5;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const x0 = ((xi % s) + s) % s;
  const y0 = ((yi % s) + s) % s;
  const x1 = (x0 + 1) % s;
  const y1 = (y0 + 1) % s;
  const a = arr[y0 * s + x0];
  const b = arr[y0 * s + x1];
  const c = arr[y1 * s + x0];
  const d = arr[y1 * s + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * Tileable water normal map: sum of Perlin octaves + a few integer-wavenumber
 * swells. RG encode the surface slope (x, z), B = 1, A = foam/breakup noise.
 */
export function createWaterNormals(size = 256, seed = 4242) {
  const rnd = mulberry32(seed);
  const o1 = periodicPerlin(6, rnd);
  const o2 = periodicPerlin(12, rnd);
  const o3 = periodicPerlin(24, rnd);
  const o4 = periodicPerlin(48, rnd);
  const foam = makeFbm(8, 4, rnd, 0.55);
  const swells = [
    [3, 1, 0.18, rnd() * 6.28],
    [-2, 3, 0.12, rnd() * 6.28],
    [5, -2, 0.08, rnd() * 6.28],
    [1, 6, 0.05, rnd() * 6.28],
  ];
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let h = o1(u * 6, v * 6) * 0.5 + o2(u * 12, v * 12) * 0.28 + o3(u * 24, v * 24) * 0.14 + o4(u * 48, v * 48) * 0.07;
      for (const [kx, ky, amp, ph] of swells) h += Math.sin((kx * u + ky * v) * Math.PI * 2 + ph) * amp;
      H[y * size + x] = h;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const k = 2.2; // slope scale before encoding
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const yu = (y - 1 + size) % size;
      const yd = (y + 1) % size;
      const sx = (H[y * size + xr] - H[y * size + xl]) * k;
      const sy = (H[yd * size + x] - H[yu * size + x]) * k;
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, (sx * 0.5 + 0.5) * 255));
      data[i + 1] = Math.max(0, Math.min(255, (sy * 0.5 + 0.5) * 255));
      data[i + 2] = 255;
      data[i + 3] = Math.max(0, Math.min(255, (0.5 + 0.5 * foam(x / size, y / size)) * 255));
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.NoColorSpace;
  texture.name = 'atmo-water-normals';
  texture.needsUpdate = true;
  return texture;
}

/**
 * Lens-flare sprites drawn side by side into one canvas atlas (white; the
 * flare tints every element in its shader), so the whole flare is a single
 * draw call. Cells: glow, star, ring, hex, streak — each 256² with soft,
 * fully transparent borders so mipmaps never bleed between cells.
 * Returns { texture, cells: { name: [u0, u1] } }.
 */
export function createFlareAtlas() {
  const C = 256;
  const names = ['glow', 'star', 'ring', 'hex', 'streak'];
  const canvas = document.createElement('canvas');
  canvas.width = C * names.length;
  canvas.height = C;
  const g = canvas.getContext('2d');
  const cells = {};
  const cx = C / 2;
  names.forEach((name, i) => {
    cells[name] = [(i * C + 0.5) / canvas.width, ((i + 1) * C - 0.5) / canvas.width];
    g.save();
    g.translate(i * C, 0);
    g.beginPath();
    g.rect(0, 0, C, C);
    g.clip();
    if (name === 'glow') {
      const r = g.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.96);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.12, 'rgba(255,255,255,0.55)');
      r.addColorStop(0.35, 'rgba(255,255,255,0.14)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, C, C);
    } else if (name === 'star') {
      g.translate(cx, cx);
      for (let k = 0; k < 12; k++) {
        g.save();
        g.rotate((k / 12) * Math.PI * 2 + (k % 2) * 0.13);
        const len = C * (k % 2 ? 0.3 : 0.47);
        const lg = g.createLinearGradient(0, 0, len, 0);
        lg.addColorStop(0, 'rgba(255,255,255,0.8)');
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = lg;
        g.beginPath();
        g.moveTo(0, -1.4);
        g.lineTo(len, 0);
        g.lineTo(0, 1.4);
        g.closePath();
        g.fill();
        g.restore();
      }
    } else if (name === 'ring') {
      const r = g.createRadialGradient(cx, cx, C * 0.34, cx, cx, C * 0.47);
      r.addColorStop(0, 'rgba(255,255,255,0)');
      r.addColorStop(0.45, 'rgba(255,255,255,0.7)');
      r.addColorStop(0.6, 'rgba(255,255,255,0.35)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, C, C);
    } else if (name === 'hex') {
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const x = cx + Math.cos(a) * C * 0.4;
        const y = cx + Math.sin(a) * C * 0.4;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      const r = g.createRadialGradient(cx, cx, 0, cx, cx, C * 0.43);
      r.addColorStop(0, 'rgba(255,255,255,0.35)');
      r.addColorStop(0.75, 'rgba(255,255,255,0.55)');
      r.addColorStop(1, 'rgba(255,255,255,0.9)');
      g.fillStyle = r;
      g.filter = 'blur(3px)';
      g.fill();
      g.filter = 'none';
    } else {
      // anamorphic streak: horizontal gradient × vertical falloff (stretched by the quad)
      const h = g.createLinearGradient(4, 0, C - 4, 0);
      h.addColorStop(0, 'rgba(255,255,255,0)');
      h.addColorStop(0.5, 'rgba(255,255,255,1)');
      h.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = h;
      g.fillRect(0, 0, C, C);
      g.globalCompositeOperation = 'destination-in';
      const v = g.createLinearGradient(0, 4, 0, C - 4);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(0.5, 'rgba(0,0,0,1)');
      v.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = v;
      g.fillRect(0, 0, C, C);
    }
    g.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace; // tints are applied as linear colours in the shader
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.name = 'atmo-flare-atlas';
  return { texture, cells };
}
