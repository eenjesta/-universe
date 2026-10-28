import { smoothstep } from '../../core/math.js';
import { sampleChannel } from './textures.js';

/**
 * CPU replicas of the sky shader's cloud layers (sky-glsl.js), evaluated
 * only in the sun's direction: how much of the sun is hidden by the cloud
 * deck and by the distant cumulus banks on the horizon. Drives the sunlight
 * dimming and the lens-flare fade (the flare's GPU occlusion queries only
 * see real geometry, not clouds painted by the sky shader).
 * Keep the maths in sync with aCloudField / aClouds / aHeads / aCloudBand.
 */

const fract = (x) => x - Math.floor(x);
const _h = [0, 0, 0];

/** GLSL aHash33 replica → _h. */
function hash33(px, py, pz) {
  let x = fract(px * 0.1031);
  let y = fract(py * 0.103);
  let z = fract(pz * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d;
  y += d;
  z += d;
  _h[0] = fract((x + y) * z);
  _h[1] = fract((x + x) * y);
  _h[2] = fract((y + x) * x);
  return _h;
}

/** aHeads replica: height of the tallest rounded head at x (cells), returns [top, dx]. */
function heads(x, N, seed, hMax, group, out) {
  const ci = Math.floor(x);
  out[0] = 0;
  out[1] = 0;
  for (let k = -1; k <= 1; k++) {
    const c = ci + k;
    const r = hash33(((c % N) + N) % N, seed, 7.13);
    const w = 0.55 + 0.75 * r[1];
    const dx = (x - (c + 0.5 + (r[0] - 0.5) * 0.6)) / w;
    const hgt = hMax * (0.3 + 0.7 * r[2] * r[2]) * group;
    const e = hgt * Math.sqrt(Math.max(1 - dx * dx, 0));
    if (e > out[0]) {
      out[0] = e;
      out[1] = dx;
    }
  }
  return out;
}

export function createSunOcclusion(noise, uniforms) {
  const N = (ch, u, v) => sampleChannel(noise, ch, u, v);
  const big = [0, 0];
  const sml = [0, 0];

  function cloudField(qx, qy, cov) {
    const wx = N(2, qx * 0.11 + 0.17, qy * 0.11 + 0.61) - 0.5;
    const wy = N(3, qx * 0.11 + 0.17, qy * 0.11 + 0.61) - 0.5;
    qx += wx * 0.38;
    qy += wy * 0.38;
    const bigN = N(0, qx * 0.045 + 0.4, qy * 0.045 + 0.2);
    const n = N(0, qx * 0.16, qy * 0.16) * 0.6 + N(1, qx * 0.43 + 0.31, qy * 0.43 + 0.12) * 0.28 + N(2, qx * 1.35 + 0.71, qy * 1.35 + 0.53) * 0.12;
    const c = Math.min(1, Math.max(0, cov + (bigN - 0.5) * 0.8));
    return smoothstep(1 - c, 1.32 - c, n);
  }

  /** Cloud-deck opacity in direction d (unit Vector3) seen from camPos. */
  function deck(d, camPos) {
    const cl = uniforms.uCloud.value;
    if (d.y < 0.012 || cl.y < 0.001) return 0;
    const Re = 90000;
    const oy = Re + camPos.y;
    const Rc = Re + cl.z;
    const b = oy * d.y;
    // max(): above the deck the ray can miss the shell → sqrt(< 0) = NaN, which
    // would latch into the smoothed sun dimming (and the sun colour) for good
    const t = -b + Math.sqrt(Math.max(0, b * b + (Rc - oy) * (Rc + oy)));
    const wind = uniforms.uCloudWind.value;
    const qx = (camPos.x + d.x * t) / cl.w + wind.x;
    const qy = (camPos.z + d.z * t) / cl.w + wind.y;
    let dens = cloudField(qx, qy, cl.x) * cl.y;
    dens *= smoothstep(0.012, 0.07, d.y) * (1 - smoothstep(24000, 42000, t) * 0.75);
    return dens;
  }

  /** Horizon-bank opacity over the sun disc (direction d), softened by the disc radius. */
  function band(d, discRadius = 0.015) {
    const bd = uniforms.uBand.value;
    const h = d.y;
    if (bd.w < 0.001 || h > bd.y * 1.05 + 0.02 || h < -0.03) return 0;
    const az = Math.atan2(d.x, -d.z);
    const u = az * 0.15915494 + bd.z;
    const g = N(0, u * 4, 0.37);
    const group = smoothstep(1 - bd.x, 1.3 - bd.x, g);
    if (group < 0.001) return 0;
    heads(u * 56, 56, 1.7, bd.y, group, big);
    heads(u * 170, 170, 5.3, bd.y * 0.38, smoothstep(0, 0.4, big[0] / bd.y), sml);
    const fz = N(2, u * 31, 0.83);
    const top = Math.max(big[0], big[0] * 0.72 + sml[0]) * (0.86 + 0.28 * fz);
    if (top < 0.0015) return 0;
    const soft = 0.0018 + top * 0.11 + discRadius;
    return (1 - smoothstep(top - soft, top + soft * 0.35, h)) * bd.w;
  }

  /** Total fraction of the sun hidden by clouds (0..1). */
  function atSun(sunDir, camPos) {
    const a = deck(sunDir, camPos);
    const b = band(sunDir);
    return 1 - (1 - a) * (1 - b);
  }

  return { atSun, deck, band };
}
