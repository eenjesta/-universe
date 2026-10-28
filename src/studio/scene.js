/**
 * Ø Studio — shared 3D for the editor ('studio') and the runtime ('experience').
 *
 *   const stage = createStage(ctx, { editor: true });
 *   stage.scene                      THREE.Scene (sky dome, lights, baseplate, grid, parts)
 *   stage.applySettings(settings)    sky preset + time + baseplate (PMREM env rebuilt when needed)
 *   stage.parts.sync(parts)          full rebuild of the instanced buckets (structure changed)
 *   stage.parts.updatePart(part)     fast path (transform / colour / alpha of one part)
 *   stage.update(dt, camera, focus)  sky follows the camera, shadow box + light pool follow `focus`
 *   stage.dispose()
 *
 * Rendering: one InstancedMesh per (shape × material × opaque|alpha) bucket with per-instance colour
 * (+ per-instance alpha for the alpha buckets). Materials use object-space triplanar detail textures
 * (metric, follow the part), neon is unlit HDR (> 1 → bloom). Text signs are single meshes with a
 * canvas texture; spawn pads get an instanced Ø decal; light parts share a fixed pool of point lights
 * (fixed count → no shader recompiles). Real-GPU safety: no pow() of negative bases, guarded
 * normalisations and divisions in every shader below.
 */
import * as THREE from 'three';
import { canvasTexture, drawEmblem } from '../core/textures.js';

const D2R = Math.PI / 180;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

/** World matrix of a part (unit geometry scaled by s). */
export function partMatrix(part, out = new THREE.Matrix4(), scale = true) {
  _e.set(part.r[0] * D2R, part.r[1] * D2R, part.r[2] * D2R, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(part.p[0], part.p[1], part.p[2]);
  if (scale) _s.set(Math.max(part.s[0], 1e-4), Math.max(part.s[1], 1e-4), Math.max(part.s[2], 1e-4));
  else _s.set(1, 1, 1);
  return out.compose(_p, _q, _s);
}

// ---------------------------------------------------------------- textures
let TEX = null;
function noiseFill(g, w, h, lo, hi, rnd, n = 9000, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = Math.round(lo + (hi - lo) * rnd());
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rnd() * w, rnd() * h, size, size);
  }
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function textures() {
  if (TEX) return TEX;
  const opt = { repeat: [1, 1], anisotropy: 4 };
  TEX = {
    plastic: canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#f2f2f2';
      g.fillRect(0, 0, w, h);
      noiseFill(g, w, h, 226, 255, rng(1), 2400, 1);
    }, opt),
    metal: canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#d6d6d6';
      g.fillRect(0, 0, w, h);
      const r = rng(2);
      for (let i = 0; i < 520; i++) {
        const v = Math.round(185 + r() * 70);
        g.fillStyle = `rgba(${v},${v},${v},0.55)`;
        g.fillRect(0, r() * h, w, 1 + r() * 1.5);
      }
    }, opt),
    wood: canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#d9d9d9';
      g.fillRect(0, 0, w, h);
      const r = rng(3);
      for (let y = 0; y < h; y += 2) {
        const v = Math.round(190 + 50 * Math.sin(y * 0.21 + Math.sin(y * 0.05) * 3) + r() * 14);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(0, y, w, 2);
      }
      for (let i = 0; i < 26; i++) {
        g.fillStyle = 'rgba(120,120,120,0.35)';
        g.fillRect(r() * w, r() * h, 18 + r() * 60, 1);
      }
    }, opt),
    concrete: canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#e4e4e4';
      g.fillRect(0, 0, w, h);
      const r = rng(4);
      noiseFill(g, w, h, 190, 255, r, 12000, 2);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = 'rgba(110,110,110,0.45)';
        g.beginPath();
        g.arc(r() * w, r() * h, 0.6 + r() * 1.6, 0, Math.PI * 2);
        g.fill();
      }
    }, opt),
    grass: canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#d0d0d0';
      g.fillRect(0, 0, w, h);
      const r = rng(5);
      for (let i = 0; i < 9000; i++) {
        const v = Math.round(150 + r() * 105);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(r() * w, r() * h, 1, 2 + r() * 4);
      }
    }, opt),
    ice: canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#f4f4f4';
      g.fillRect(0, 0, w, h);
      const r = rng(6);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 1;
      for (let i = 0; i < 22; i++) {
        let x = r() * w;
        let y = r() * h;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += (r() - 0.5) * 50;
          y += (r() - 0.5) * 50;
          g.lineTo(x, y);
        }
        g.strokeStyle = `rgba(200,200,200,${0.4 + r() * 0.4})`;
        g.stroke();
      }
    }, opt),
    emblem: canvasTexture(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(236,230,220,0.55)';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(w / 2, h / 2, w * 0.45, 0, Math.PI * 2);
      g.stroke();
      drawEmblem(g, w / 2, h / 2, w * 0.27, w * 0.05, '#ece6dc');
    }, { anisotropy: 4 }),
  };
  return TEX;
}

// ---------------------------------------------------------------- materials
/** Look of each material: texture tiling (m per repeat), standard params, env strength. */
export const MATERIAL_LOOK = {
  plastic: { tile: 4, roughness: 0.48, metalness: 0, env: 1.0 },
  metal: { tile: 2, roughness: 0.4, metalness: 0.78, env: 1.1 },
  glass: { tile: 4, roughness: 0.05, metalness: 0.1, env: 1.5, opacity: 0.3 },
  neon: { neon: true },
  wood: { tile: 2.5, roughness: 0.78, metalness: 0, env: 0.85 },
  concrete: { tile: 4, roughness: 0.92, metalness: 0, env: 0.85 },
  grass: { tile: 3, roughness: 0.97, metalness: 0, env: 0.75 },
  ice: { tile: 5, roughness: 0.08, metalness: 0.05, env: 1.3, opacity: 0.86 },
};
const NEON_GAIN = 2.8;

const TRI_VERT_HEAD = /* glsl */ `
varying vec3 vTriP;
varying vec3 vTriN;
`;
const TRI_VERT_BODY = /* glsl */ `
#ifdef USE_INSTANCING
  vec3 triS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#else
  vec3 triS = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
#endif
  vTriP = position * triS;
  vTriN = normal;
`;
const TRI_FRAG_HEAD = /* glsl */ `
varying vec3 vTriP;
varying vec3 vTriN;
uniform float uTexScale;
`;
const TRI_MAP = /* glsl */ `
#ifdef USE_MAP
  vec3 triW = abs(vTriN);
  triW = triW * triW;
  triW = triW * triW;
  triW /= max(triW.x + triW.y + triW.z, 1e-5);
  vec4 triC = texture2D(map, vTriP.zy * uTexScale) * triW.x
            + texture2D(map, vTriP.xz * uTexScale) * triW.y
            + texture2D(map, vTriP.xy * uTexScale) * triW.z;
  diffuseColor *= triC;
#endif
`;

function patchMaterial(mat, { tri = false, alpha = false, tile = 4 }) {
  mat.onBeforeCompile = (sh) => {
    let vh = '';
    let vb = '';
    let fh = '';
    if (tri) {
      sh.uniforms.uTexScale = { value: 1 / tile };
      vh += TRI_VERT_HEAD;
      vb += TRI_VERT_BODY;
      fh += TRI_FRAG_HEAD;
    }
    if (alpha) {
      vh += 'attribute float aAlpha;\nvarying float vAlpha;\n';
      vb += 'vAlpha = aAlpha;\n';
      fh += 'varying float vAlpha;\n';
    }
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${vh}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${vb}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${fh}`);
    if (tri) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', TRI_MAP);
    if (alpha) sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n  diffuseColor.a *= clamp(vAlpha, 0.0, 1.0);');
  };
  mat.customProgramCacheKey = () => `studio-part-${tri ? 1 : 0}${alpha ? 1 : 0}-${tile}`;
  return mat;
}

const matCache = new Map();
/** Shared material for a part bucket (kind ∈ MATERIALS, alpha = per-instance opacity). */
export function partMaterial(kind, alpha = false) {
  const key = `${kind}|${alpha ? 1 : 0}`;
  let m = matCache.get(key);
  if (m) return m;
  const look = MATERIAL_LOOK[kind] || MATERIAL_LOOK.plastic;
  const tex = textures();
  if (look.neon) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON_GAIN, NEON_GAIN, NEON_GAIN), name: `studio-neon${alpha ? '-a' : ''}` });
    if (alpha) {
      m.transparent = true;
      m.depthWrite = false;
    }
    patchMaterial(m, { alpha });
  } else {
    m = new THREE.MeshStandardMaterial({
      name: `studio-${kind}${alpha ? '-a' : ''}`,
      color: 0xffffff,
      map: tex[kind] || null,
      roughness: look.roughness,
      metalness: look.metalness,
      envMapIntensity: look.env,
    });
    const seeThrough = alpha || look.opacity != null;
    if (seeThrough) {
      m.transparent = true;
      m.depthWrite = kind === 'ice' && !alpha;
      m.opacity = alpha ? 1 : look.opacity ?? 1; // alpha buckets carry look.opacity per instance
    }
    patchMaterial(m, { tri: !!m.map, alpha, tile: look.tile });
  }
  matCache.set(key, m);
  return m;
}

/** A standalone (non-instanced) material in a part material's look (baseplate). */
function soloMaterial(kind, color) {
  const look = MATERIAL_LOOK[kind] || MATERIAL_LOOK.concrete;
  if (look.neon) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
    m.color.multiplyScalar(NEON_GAIN * 0.5);
    return m;
  }
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    map: textures()[kind] || null,
    roughness: look.roughness,
    metalness: look.metalness,
    envMapIntensity: look.env,
  });
  return patchMaterial(m, { tri: !!m.map, tile: look.tile });
}

// --------------------------------------------------------------- geometries
function wedgeGeometry() {
  const A = [-0.5, -0.5, -0.5];
  const B = [0.5, -0.5, -0.5];
  const C = [-0.5, -0.5, 0.5];
  const D = [0.5, -0.5, 0.5];
  const E = [-0.5, 0.5, 0.5];
  const F = [0.5, 0.5, 0.5];
  const tris = [
    [A, B, D, [0, -1, 0]], [A, D, C, [0, -1, 0]],
    [C, D, F, [0, 0, 1]], [C, F, E, [0, 0, 1]],
    [A, E, F, [0, Math.SQRT1_2, -Math.SQRT1_2]], [A, F, B, [0, Math.SQRT1_2, -Math.SQRT1_2]],
    [A, C, E, [-1, 0, 0]],
    [B, F, D, [1, 0, 0]],
  ];
  const pos = [];
  const nrm = [];
  const uv = [];
  for (const [a, b, c, n] of tris) {
    for (const v of [a, b, c]) {
      pos.push(...v);
      nrm.push(...n);
      uv.push(v[0] + 0.5, v[1] + v[2] + 0.5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

let GEO = null;
export function geometries() {
  if (GEO) return GEO;
  const box = new THREE.BoxGeometry(1, 1, 1);
  GEO = {
    box,
    wedge: wedgeGeometry(),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1),
    sphere: new THREE.SphereGeometry(0.5, 32, 18),
    cone: new THREE.ConeGeometry(0.5, 1, 32, 1),
    bulb: new THREE.SphereGeometry(0.5, 16, 10),
  };
  return GEO;
}
export const GEO_OF = { block: 'box', spawn: 'box', text: 'box', wedge: 'wedge', cylinder: 'cylinder', sphere: 'sphere', cone: 'cone', light: 'bulb' };

// ------------------------------------------------------------ part renderer
class PartRenderer {
  constructor(stage, { editor = false } = {}) {
    this.stage = stage;
    this.editor = editor;
    this.root = new THREE.Group();
    this.root.name = 'studio-parts';
    this.buckets = new Map();
    this.index = new Map(); // part id → { bucket, i }
    this.signs = new Map(); // part id → { mesh, key, tex }
    this.decalIndex = new Map();
    this.lightParts = [];
    this.parts = [];
    this.dirty = true;
    const geo = geometries();
    // spawn decals
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({ map: textures().emblem, transparent: true, depthWrite: false, color: new THREE.Color(0.8, 0.95, 1.05), opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decals = new THREE.InstancedMesh(this.decalGeo, this.decalMat, 16);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    this.root.add(this.decals);
    this.geo = geo;
  }

  _bucket(type, kind, alpha, need) {
    const gk = GEO_OF[type] || 'box';
    const key = `${gk}|${kind}|${alpha ? 'a' : 'o'}`;
    let b = this.buckets.get(key);
    if (b && b.cap >= need) return b;
    const cap = Math.max(8, Math.ceil(need * 1.5));
    if (b) {
      this.root.remove(b.mesh);
      b.mesh.dispose();
      if (b.ownGeo) b.mesh.geometry.dispose();
    }
    let geometry = this.geo[gk];
    let alphaAttr = null;
    if (alpha) {
      geometry = geometry.clone();
      alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      alphaAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aAlpha', alphaAttr);
    }
    const mesh = new THREE.InstancedMesh(geometry, partMaterial(kind, alpha), cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    const neon = kind === 'neon';
    mesh.castShadow = !alpha && kind !== 'glass';
    mesh.receiveShadow = !neon;
    mesh.name = `studio-${key}`;
    if (alpha) mesh.renderOrder = 1;
    b = { key, mesh, cap, count: 0, ids: [], alphaAttr, ownGeo: alpha, kind, alpha };
    this.buckets.set(key, b);
    this.root.add(mesh);
    return b;
  }

  _alphaOf(part) {
    const look = MATERIAL_LOOK[part.material] || {};
    let a = (1 - part.transparency) * (look.opacity ?? 1);
    if (this.editor) a = Math.max(a, 0.14);
    return a;
  }

  _isAlpha(part) {
    return part.transparency > 0.001;
  }

  markDirty() {
    this.dirty = true;
  }

  /** Full rebuild from the part list (call after adds/removes/type or material changes). */
  sync(parts) {
    this.parts = parts;
    this.dirty = false;
    const counts = new Map();
    const hiddenRuntime = (p) => !this.editor && p.transparency >= 0.999;
    for (const p of parts) {
      if (hiddenRuntime(p)) continue;
      const k = `${GEO_OF[p.type] || 'box'}|${p.material}|${this._isAlpha(p) ? 'a' : 'o'}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const b of this.buckets.values()) {
      b.count = 0;
      b.ids.length = 0;
    }
    this.index.clear();
    for (const p of parts) {
      if (hiddenRuntime(p)) continue;
      const alpha = this._isAlpha(p);
      const k = `${GEO_OF[p.type] || 'box'}|${p.material}|${alpha ? 'a' : 'o'}`;
      const b = this._bucket(p.type, p.material, alpha, counts.get(k));
      const i = b.count++;
      b.ids[i] = p.id;
      this.index.set(p.id, { b, i });
      this._write(b, i, p);
    }
    for (const b of this.buckets.values()) {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      if (b.alphaAttr) b.alphaAttr.needsUpdate = true;
    }
    this._syncSigns(parts);
    this._syncDecals(parts);
    this.lightParts = parts.filter((p) => p.type === 'light');
  }

  _write(b, i, p) {
    b.mesh.setMatrixAt(i, partMatrix(p, _m));
    b.mesh.setColorAt(i, _c.set(p.color));
    if (b.alphaAttr) b.alphaAttr.array[i] = this._alphaOf(p);
  }

  /** Fast path for transform/colour/alpha edits; returns false when a full sync is needed. */
  updatePart(p) {
    if (!this.editor && p.transparency >= 0.999 && !this.index.has(p.id)) return true; // invisible in play: nothing drawn
    const rec = this.index.get(p.id);
    const alpha = this._isAlpha(p);
    if (!rec || rec.b.kind !== p.material || rec.b.alpha !== alpha || !rec.b.key.startsWith(`${GEO_OF[p.type] || 'box'}|`)) {
      this.dirty = true;
      return false;
    }
    this._write(rec.b, rec.i, p);
    rec.b.mesh.instanceMatrix.needsUpdate = true;
    rec.b.mesh.instanceColor.needsUpdate = true;
    if (rec.b.alphaAttr) rec.b.alphaAttr.needsUpdate = true;
    if (p.type === 'text') this._updateSign(p);
    if (p.type === 'spawn') {
      const di = this.decalIndex.get(p.id);
      if (di != null) {
        this.decals.setMatrixAt(di, this._decalMatrix(p, _m));
        this.decals.instanceMatrix.needsUpdate = true;
      }
    }
    return true;
  }

  _decalMatrix(p, out) {
    partMatrix(p, _m2, false);
    const k = Math.min(p.s[0], p.s[2]) * 0.74;
    _s.set(k, 1, k);
    _v.set(0, p.s[1] / 2 + 0.012, 0).applyMatrix4(_m2);
    _q.setFromRotationMatrix(_m2);
    return out.compose(_v, _q, _s);
  }

  _syncDecals(parts) {
    const spawns = parts.filter((p) => p.type === 'spawn' && (this.editor || p.transparency < 0.999));
    if (spawns.length > this.decals.instanceMatrix.count) {
      this.root.remove(this.decals);
      this.decals.dispose();
      this.decals = new THREE.InstancedMesh(this.decalGeo, this.decalMat, Math.ceil(spawns.length * 1.5));
      this.decals.frustumCulled = false;
      this.decals.renderOrder = 2;
      this.root.add(this.decals);
    }
    this.decalIndex.clear();
    spawns.forEach((p, i) => {
      this.decals.setMatrixAt(i, this._decalMatrix(p, _m));
      this.decalIndex.set(p.id, i);
    });
    this.decals.count = spawns.length;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  _signKey(p) {
    return `${p.props?.text}|${p.props?.textColor}|${Math.round((p.s[0] / Math.max(p.s[1], 0.01)) * 20)}`;
  }

  _syncSigns(parts) {
    const keep = new Set();
    for (const p of parts) {
      if (p.type !== 'text') continue;
      if (!this.editor && p.transparency >= 0.999) continue;
      keep.add(p.id);
      this._updateSign(p);
    }
    for (const [id, s] of this.signs) {
      if (keep.has(id)) continue;
      this.root.remove(s.mesh);
      s.tex.dispose();
      s.mesh.material.dispose();
      this.signs.delete(id);
    }
  }

  _updateSign(p) {
    let s = this.signs.get(p.id);
    const key = this._signKey(p);
    if (!s) {
      const mat = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new THREE.Mesh(this.signGeo || (this.signGeo = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI).translate(0, 0, -0.5 - 0.004)), mat);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 2;
      s = { mesh, key: null, tex: null };
      this.signs.set(p.id, s);
      this.root.add(mesh);
    }
    if (s.key !== key) {
      s.key = key;
      s.tex?.dispose();
      s.tex = signTexture(p.props?.text || '', p.props?.textColor || '#ece6dc', p.s[0] / Math.max(p.s[1], 0.01));
      s.mesh.material.map = s.tex;
      s.mesh.material.emissiveMap = s.tex;
      s.mesh.material.needsUpdate = true;
    }
    partMatrix(p, s.mesh.matrix);
    s.mesh.matrixWorldNeedsUpdate = true;
  }

  dispose() {
    for (const b of this.buckets.values()) {
      b.mesh.dispose();
      if (b.ownGeo) b.mesh.geometry.dispose();
    }
    for (const s of this.signs.values()) {
      s.tex.dispose();
      s.mesh.material.dispose();
    }
    this.signGeo?.dispose();
    this.decals.dispose();
    this.decalGeo.dispose();
    this.decalMat.dispose();
    this.buckets.clear();
    this.signs.clear();
  }
}

function signTexture(text, color, aspect) {
  const W = 512;
  const H = Math.max(48, Math.min(512, Math.round(W / Math.max(aspect, 0.2))));
  return canvasTexture(W, H, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const lines = String(text).split(/\n/).slice(0, 3);
    let size = Math.min(h * (lines.length > 1 ? 0.42 : 0.6), 200);
    const font = (px) => `500 ${px}px Jost, 'Futura', 'Avenir Next', system-ui, sans-serif`;
    g.font = font(size);
    try {
      g.letterSpacing = `${Math.round(size * 0.12)}px`;
    } catch {
      /* older canvas */
    }
    const widest = Math.max(...lines.map((l) => g.measureText(l).width), 1);
    if (widest > w * 0.88) size *= (w * 0.88) / widest;
    g.font = font(size);
    try {
      g.letterSpacing = `${Math.round(size * 0.12)}px`;
    } catch {
      /* older canvas */
    }
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = size * 0.12;
    const lh = size * 1.15;
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
  }, { anisotropy: 4 });
}

// --------------------------------------------------------------------- sky
const SKY_PRESETS = {
  golden: {
    top: '#1b2444', mid: '#4f5788', horizon: '#f0a66c', ground: '#2e2833', sun: '#ffcf9c', sunI: 3.1, hemiSky: '#c9c2dc', hemiGround: '#5c4a3c', hemiI: 1.25,
    stars: 0.22, fog: '#b48c84', planet: 1, sunAz: -25, minEl: 24, maxEl: 32, env: 1.0,
    post: { exposure: 1.05, bloom: 0.34, bloomRadius: 0.32, threshold: 0.9, saturation: 1.07, contrast: 1.07, vignette: 0.3, shadowTint: [0.9, 0.95, 1.1], highlightTint: [1.06, 1.0, 0.92] },
  },
  day: {
    top: '#2a63c9', mid: '#5f97e6', horizon: '#cfe4ff', ground: '#56606e', sun: '#fff3e0', sunI: 3.3, hemiSky: '#d8e8ff', hemiGround: '#6a6150', hemiI: 1.35,
    stars: 0, fog: '#bcd4ef', planet: 0.35, sunAz: 35, minEl: 30, maxEl: 62, env: 1.0,
    post: { exposure: 1.0, bloom: 0.3, bloomRadius: 0.4, threshold: 0.92, saturation: 1.05, contrast: 1.05, vignette: 0.26, shadowTint: [0.93, 0.97, 1.06], highlightTint: [1.03, 1.0, 0.96] },
  },
  night: {
    top: '#03050c', mid: '#0a1430', horizon: '#26365a', ground: '#07090f', sun: '#c8d4ff', sunI: 1.1, hemiSky: '#7084c4', hemiGround: '#2a3040', hemiI: 1.3,
    stars: 1, fog: '#16203a', planet: 1, sunAz: 140, minEl: 28, maxEl: 48, env: 1.5,
    post: { exposure: 1.45, bloom: 0.62, bloomRadius: 0.5, threshold: 0.86, saturation: 1.0, contrast: 1.05, vignette: 0.36, shadowTint: [0.86, 0.92, 1.2], highlightTint: [0.98, 1.0, 1.05] },
  },
  space: {
    top: '#000004', mid: '#04040e', horizon: '#0d1022', ground: '#000002', sun: '#ffffff', sunI: 3.4, hemiSky: '#7a88b8', hemiGround: '#141824', hemiI: 0.7,
    stars: 1.3, fog: null, planet: 1.6, sunAz: 60, minEl: 32, maxEl: 32, env: 0.8,
    post: { exposure: 1.1, bloom: 0.5, bloomRadius: 0.45, threshold: 0.88, saturation: 1.04, contrast: 1.08, vignette: 0.34, shadowTint: [0.88, 0.94, 1.14], highlightTint: [1.02, 1.0, 0.98] },
  },
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uStars; uniform float uTime;
uniform vec3 uPlanetDir; uniform vec3 uPT1; uniform vec3 uPT2; uniform vec3 uPlanetLight; uniform float uPlanet;
varying vec3 vDir;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 d = vDir / max(length(vDir), 1e-4);
  float h = d.y;
  vec3 up = mix(uMid, uTop, smoothstep(0.18, 0.95, h));
  vec3 col = mix(uHorizon, up, smoothstep(0.0, 0.32, h));
  col = mix(col, uGround, smoothstep(0.0, 0.14, -h));
  float sd = max(dot(d, uSunDir), 0.0);
  float sd2 = sd * sd; float sd4 = sd2 * sd2; float sd8 = sd4 * sd4; float sd16 = sd8 * sd8;
  float sd64 = sd16 * sd16; sd64 *= sd64;
  col += uSunColor * (sd16 * 0.22 + sd64 * 0.5 + smoothstep(0.99975, 0.99988, sd) * 12.0);
  if (uStars > 0.0) {
    vec3 p = d * 260.0;
    vec3 cell = floor(p);
    float r = hash13(cell);
    vec3 off = vec3(hash13(cell + 7.1), hash13(cell + 3.7), hash13(cell + 1.3)) * 0.6 + 0.2;
    float dist = length(fract(p) - off);
    float tw = 0.75 + 0.25 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
    float star = step(0.985, r) * (1.0 - smoothstep(0.03, 0.14, dist)) * tw;
    col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(-0.02, 0.25, h) * (1.4 + r * 3.0);
  }
  if (uPlanet > 0.0) {
    float pc = dot(d, uPlanetDir);
    if (pc > 0.985) {
      vec2 q = vec2(dot(d, uPT1), dot(d, uPT2)) / 0.168;
      float rr = dot(q, q);
      float z = sqrt(max(1.0 - rr, 0.0));
      vec3 n = vec3(q, z);
      float lit = clamp(dot(n, uPlanetLight), 0.0, 1.0);
      float bands = 0.92 + 0.08 * sin(q.y * 9.0 + sin(q.x * 3.0) * 1.5);
      float crater = hash13(floor(vec3(q * 9.0, 3.0)));
      vec3 pcol = vec3(0.86, 0.84, 0.82) * bands * (0.94 + 0.06 * crater) * (0.025 + lit * 1.1);
      float edge = 1.0 - smoothstep(0.96, 1.0, rr);
      float rim = smoothstep(0.75, 1.0, rr) * edge * 0.25;
      col = mix(col, pcol + uHorizon * rim, edge * clamp(uPlanet, 0.0, 1.0) * smoothstep(-0.05, 0.05, h));
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'studio-sky',
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uPlanetDir: { value: new THREE.Vector3(0, 0.4, -1).normalize() },
      uPT1: { value: new THREE.Vector3(1, 0, 0) },
      uPT2: { value: new THREE.Vector3(0, 1, 0) },
      uPlanetLight: { value: new THREE.Vector3(0, 0, 1) },
      uPlanet: { value: 0 },
    },
  });
}

/** Sun direction from the preset + time of day (hours); elevation stays in the preset's readable band. */
function sunDirection(preset, sky, time, out) {
  // day arc: 6h rise → 12h noon → 18h set; night presets use the moon (time + 12)
  const t = sky === 'night' ? time + 12 : time;
  const ph = ((((t - 6) / 12) % 2) + 2) % 2; // 0..2
  const arc = ph <= 1 ? Math.sin(ph * Math.PI) : 0;
  const elev = (preset.minEl + (preset.maxEl - preset.minEl) * arc) * D2R;
  const az = (preset.sunAz + (t - 12) * 8) * D2R;
  out.set(-Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev));
  return out.normalize();
}

/** Post look (exposure, bloom, grade) while a Studio scene is on screen; the world re-applies its own. */
function postState(engine) {
  const g = engine.grade?.uniforms;
  const b = engine.bloom;
  return {
    exposure: engine.renderer.toneMappingExposure,
    bloom: b ? [b.strength, b.radius, b.threshold] : null,
    grade: g ? [g.uSaturation?.value, g.uContrast?.value, g.uVignette?.value, g.uShadowTint?.value.clone(), g.uHighlightTint?.value.clone()] : null,
  };
}
function applyPostLook(engine, post) {
  const g = engine.grade?.uniforms;
  if (g) {
    if (g.uSaturation) g.uSaturation.value = post.saturation;
    if (g.uContrast) g.uContrast.value = post.contrast;
    if (g.uVignette) g.uVignette.value = post.vignette;
    g.uShadowTint?.value.setRGB(...post.shadowTint);
    g.uHighlightTint?.value.setRGB(...post.highlightTint);
  }
  const b = engine.bloom;
  if (b) {
    b.strength = post.bloom;
    b.radius = post.bloomRadius;
    b.threshold = post.threshold;
  }
  engine.renderer.toneMappingExposure = post.exposure;
}
function restorePostLook(engine, st) {
  if (!st) return;
  const g = engine.grade?.uniforms;
  if (g && st.grade) {
    if (g.uSaturation) g.uSaturation.value = st.grade[0];
    if (g.uContrast) g.uContrast.value = st.grade[1];
    if (g.uVignette) g.uVignette.value = st.grade[2];
    if (st.grade[3]) g.uShadowTint?.value.copy(st.grade[3]);
    if (st.grade[4]) g.uHighlightTint?.value.copy(st.grade[4]);
  }
  if (engine.bloom && st.bloom) [engine.bloom.strength, engine.bloom.radius, engine.bloom.threshold] = st.bloom;
  engine.renderer.toneMappingExposure = st.exposure;
}

// ------------------------------------------------------------------- stage
export function createStage(ctx, { editor = false } = {}) {
  const renderer = ctx.engine.renderer;
  const quality = ctx.engine.quality || {};
  const scene = new THREE.Scene();
  scene.name = editor ? 'studio' : 'experience';
  scene.background = new THREE.Color(0x07090d);

  // sky
  const skyMat = makeSkyMaterial();
  const skyGeo = new THREE.SphereGeometry(1, 48, 24);
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.scale.setScalar(2600);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(skyGeo, skyMat);
  envSky.scale.setScalar(40);
  envScene.add(envSky);
  let pmrem = null;
  let envRT = null;

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = !!quality.shadows;
  if (sun.castShadow) {
    const size = Math.min(quality.shadowMapSize || 2048, 2048);
    sun.shadow.mapSize.set(size, size);
    const cam = sun.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 1;
    cam.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 2;
  }
  scene.add(sun);
  scene.add(sun.target);
  const sunDir = new THREE.Vector3(0, 1, 0);

  const poolSize = quality.id === 'low' ? 4 : 8;
  const pool = [];
  for (let i = 0; i < poolSize; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 10, 2);
    l.castShadow = false;
    scene.add(l);
    pool.push(l);
  }

  // baseplate + grid
  const baseGeo = new THREE.BoxGeometry(1, 1, 1);
  let baseMat = soloMaterial('concrete', '#3a3f47');
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.receiveShadow = true;
  base.name = 'studio-baseplate';
  scene.add(base);
  const gridMat = new THREE.ShaderMaterial({
    name: 'studio-grid',
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    uniforms: { uCam: { value: new THREE.Vector3() }, uAlpha: { value: editor ? 1 : 0.35 }, uColor: { value: new THREE.Color('#ece6dc') }, uFar: { value: editor ? 260 : 160 } },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCam; uniform float uAlpha; uniform vec3 uColor; uniform float uFar; varying vec3 vW;
      float line(vec2 p, float s) {
        vec2 q = p / s;
        vec2 fw = max(fwidth(q), vec2(1e-4));
        vec2 g = abs(fract(q - 0.5) - 0.5) / fw;
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float dist = length(vW.xz - uCam.xz) + abs(uCam.y) * 0.4;
        float fade = 1.0 - smoothstep(uFar * 0.25, uFar, dist);
        float a = line(vW.xz, 1.0) * 0.035 + line(vW.xz, 4.0) * 0.075 + line(vW.xz, 32.0) * 0.06;
        gl_FragColor = vec4(uColor, a * fade * uAlpha);
      }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), gridMat);
  grid.position.y = 0.004;
  grid.renderOrder = 1;
  grid.frustumCulled = false;
  scene.add(grid);

  const parts = new PartRenderer(null, { editor });
  scene.add(parts.root);
  let settings = null;
  let envKey = '';
  let envTimer = 0;
  let lightTimer = 0;
  let post = SKY_PRESETS.golden.post;
  let active = false;
  let savedPost = null;
  const focus = new THREE.Vector3();

  function rebuildEnv() {
    try {
      if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(envScene, 0.02, 0.1, 100);
      envRT?.dispose();
      envRT = rt;
      scene.environment = rt.texture;
    } catch (err) {
      console.warn('[studio] env map failed', err);
    }
  }

  function applySettings(s, { env = true } = {}) {
    settings = s;
    const preset = SKY_PRESETS[s.sky] || SKY_PRESETS.golden;
    const u = skyMat.uniforms;
    u.uTop.value.set(preset.top);
    u.uMid.value.set(preset.mid);
    u.uHorizon.value.set(preset.horizon);
    u.uGround.value.set(preset.ground);
    u.uSunColor.value.set(preset.sun).multiplyScalar(s.sky === 'night' ? 0.4 : 1);
    u.uStars.value = preset.stars;
    u.uPlanet.value = preset.planet;
    sunDirection(preset, s.sky, s.time, sunDir);
    u.uSunDir.value.copy(sunDir);
    // planet: high in the north (−Z), lit from the sun side
    const pd = u.uPlanetDir.value.set(0.58, s.sky === 'space' ? 0.3 : 0.4, -1).normalize();
    u.uPT1.value.crossVectors(pd, _v.set(0, 1, 0)).normalize();
    u.uPT2.value.crossVectors(u.uPT1.value, pd).normalize();
    // planet frame (x = T1, y = T2, z = towards the viewer): lit from the front-left (the sun side)
    u.uPlanetLight.value.set(-0.62, 0.3, 0.72).normalize();
    scene.background = null;
    hemi.color.set(preset.hemiSky);
    hemi.groundColor.set(preset.hemiGround);
    hemi.intensity = preset.hemiI;
    sun.color.set(preset.sun);
    sun.intensity = preset.sunI;
    scene.environmentIntensity = preset.env;
    post = preset.post;
    if (active) applyPostLook(ctx.engine, post);
    if (preset.fog) {
      if (!scene.fog) scene.fog = new THREE.Fog(preset.fog, 220, editor ? 1700 : 1300);
      scene.fog.color.set(preset.fog);
    } else scene.fog = null;
    // baseplate
    const bp = s.baseplate;
    base.visible = bp.size > 0;
    grid.visible = bp.size > 0;
    if (bp.size > 0) {
      base.scale.set(bp.size, 8, bp.size);
      base.position.set(0, -4, 0);
      grid.scale.set(bp.size, 1, bp.size);
      const kind = bp.material;
      if (baseMat.userData.kind !== kind) {
        baseMat.dispose();
        baseMat = soloMaterial(kind, bp.color);
        baseMat.userData.kind = kind;
        base.material = baseMat;
      }
      baseMat.color.set(bp.color);
      if (kind === 'neon') baseMat.color.multiplyScalar(1.4);
    }
    const key = `${s.sky}|${Math.round(s.time * 4)}`;
    if (env && key !== envKey) {
      envKey = key;
      envTimer = 0.25; // debounce (time slider drags)
    }
  }

  function update(dt, camera, focusPoint) {
    if (camera) sky.position.copy(camera.position);
    skyMat.uniforms.uTime.value += dt;
    if (envTimer > 0) {
      envTimer -= dt;
      if (envTimer <= 0 || !scene.environment) {
        envTimer = 0;
        rebuildEnv();
      }
    }
    if (focusPoint) focus.copy(focusPoint);
    // shadow box follows the focus (snapped to texels against shimmer)
    const snap = 1;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + sunDir.x * 160, sunDir.y * 160, fz + sunDir.z * 160);
    gridMat.uniforms.uCam.value.copy(camera ? camera.position : focus);
    if (parts.dirty) parts.sync(parts.parts);
    lightTimer -= dt;
    if (lightTimer <= 0) {
      lightTimer = 0.25;
      assignLights();
    }
  }

  // nearest light parts get the pool (distances live in a side table: part objects stay plain data)
  const _tmpL = [];
  const _d2 = new Map();
  const byDist = (a, b) => _d2.get(a) - _d2.get(b);
  function assignLights() {
    const list = parts.lightParts;
    _tmpL.length = 0;
    _d2.clear();
    for (const p of list) {
      if ((p.props?.brightness ?? 4) <= 0) continue;
      const dx = p.p[0] - focus.x;
      const dy = p.p[1] - focus.y;
      const dz = p.p[2] - focus.z;
      _d2.set(p, dx * dx + dy * dy + dz * dz);
      _tmpL.push(p);
    }
    if (_tmpL.length > pool.length) _tmpL.sort(byDist);
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i];
      const p = _tmpL[i];
      if (!p) {
        l.intensity = 0; // stays visible: a fixed light count never recompiles the part shaders
        continue;
      }
      l.position.set(p.p[0], p.p[1], p.p[2]);
      l.color.set(p.color);
      l.intensity = (p.props?.brightness ?? 4) * 7;
      l.distance = p.props?.range ?? 18;
    }
  }

  function dispose() {
    parts.dispose();
    skyGeo.dispose();
    skyMat.dispose();
    baseGeo.dispose();
    baseMat.dispose();
    grid.geometry.dispose();
    gridMat.dispose();
    envRT?.dispose();
    pmrem?.dispose();
    sun.shadow?.map?.dispose();
  }

  return {
    scene,
    parts,
    sun,
    hemi,
    grid,
    baseplate: base,
    sunDir,
    applySettings,
    update,
    dispose,
    rebuildEnv,
    /** Call when this stage's scene goes on screen / off screen (post look save + restore). */
    activate() {
      if (active) return;
      active = true;
      savedPost = postState(ctx.engine);
      applyPostLook(ctx.engine, post);
    },
    deactivate() {
      if (!active) return;
      active = false;
      restorePostLook(ctx.engine, savedPost);
      savedPost = null;
    },
    get settings() {
      return settings;
    },
  };
}
