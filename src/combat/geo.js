/**
 * Small geometry kit for the combat models (weapons, drones, stalkers):
 * primitives placed with {p, r, s}, vertex painting (albedo `color` + HDR
 * emissive `aEmit` per vertex, optionally from a function of position/normal)
 * and merging into one BufferGeometry per material / instanced part.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Applies position / rotation (Euler XYZ) / scale to a geometry. */
export function place(g, { p = null, r = null, s = null } = {}) {
  _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
  _q.setFromEuler(_e);
  _m.compose(_p.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0), _q, _s.set(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1));
  g.applyMatrix4(_m);
  return g;
}

export const box = (w, h, d, o) => place(new THREE.BoxGeometry(w, h, d), o);
export const rbox = (w, h, d, rad, o) => place(new RoundedBoxGeometry(w, h, d, 2, Math.min(rad, w / 2.05, h / 2.05, d / 2.05)), o);
/** Cylinder along Y (rotate with r: [π/2, 0, 0] → along Z). */
export const cyl = (rt, rb, len, seg, o) => place(new THREE.CylinderGeometry(rt, rb, len, seg, 1), o);
export const sphere = (rad, ws, hs, o) => place(new THREE.SphereGeometry(rad, ws, hs), o);
export const torus = (rad, tube, rs, ts, o) => place(new THREE.TorusGeometry(rad, tube, rs, ts), o);
export const cone = (rad, h, seg, o) => place(new THREE.ConeGeometry(rad, h, seg), o);
/** Z axis rotation helper: cylinders/cones along Z. */
export const ALONG_Z = [Math.PI / 2, 0, 0];
export const ALONG_X = [0, 0, Math.PI / 2];

/**
 * Adds `color` (albedo, linear) and `aEmit` (HDR emissive) vertex attributes.
 * `fn(x, y, z, nx, ny, nz, outColor, outEmit)` may override per vertex.
 */
export function paint(g, color = [0.5, 0.5, 0.5], emit = [0, 0, 0], fn = null) {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const em = new Float32Array(n * 3);
  const c = [0, 0, 0];
  const e = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    c[0] = color[0];
    c[1] = color[1];
    c[2] = color[2];
    e[0] = emit[0];
    e[1] = emit[1];
    e[2] = emit[2];
    if (fn) {
      _n.set(nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0);
      fn(pos.getX(i), pos.getY(i), pos.getZ(i), _n.x, _n.y, _n.z, c, e);
    }
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
    em[i * 3] = e[0];
    em[i * 3 + 1] = e[1];
    em[i * 3 + 2] = e[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmit', new THREE.BufferAttribute(em, 3));
  return g;
}

/**
 * Merges geometries (same attribute set) and disposes the inputs. Non-indexed parts
 * (e.g. RoundedBoxGeometry) get a sequential index so they merge with indexed primitives.
 */
export function merge(list) {
  const parts = list.filter(Boolean);
  for (const g of parts) {
    // uv is not needed by these materials: drop it so primitives without uv merge too
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
  }
  const out = mergeGeometries(parts, false);
  if (!out) throw new Error('combat geo: mergeGeometries failed');
  for (const g of parts) g.dispose();
  out.computeBoundingSphere();
  return out;
}

/** sRGB hex → linear [r, g, b]. */
export function lin(hex, k = 1) {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}

/** Cheap deterministic hash in [0, 1) of three numbers (for vertex painting patterns). */
export function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
