/**
 * Portraits (characters module) → ctx.portraits.
 *
 *   ctx.portraits.render('aria', { width: 320, height: 320, framing: 'bust' }) → <canvas>
 *   ctx.portraits.render(appearance, { framing: 'face' | 'bust' | 'full', view: 'front' | 'back', fast })
 *
 * A small studio scene (warm key, cool fill, orange rim, dark gradient with
 * soft bokeh) with one hero-LOD character posed neutrally and looking at the
 * camera. Normal renders go through ctx.engine.snapshot (full post chain);
 * `fast: true` renders a supersampled viewport straight to the canvas (no
 * bloom/grade) for creator thumbnails. Results are cached (LRU).
 */
import * as THREE from 'three';
import { Character } from './character.js';
import { CharacterBatch } from './batch.js';
import { createCharacterMaterial } from './material.js';
import { appearanceKey, normalizeAppearance } from './appearance.js';
import { canvasTexture } from '../core/textures.js';

const CACHE_MAX = 90;

export function createPortraits(ctx, { resolveAppearance }) {
  const scene = new THREE.Scene();
  scene.name = 'portrait-studio';
  scene.background = canvasTexture(512, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#1d2433');
    grd.addColorStop(0.55, '#121620');
    grd.addColorStop(1, '#0b0d12');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // warm bokeh on the left, cool on the right
    const blob = (x, y, r, c) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    blob(w * 0.12, h * 0.3, w * 0.32, 'rgba(255,170,90,0.35)');
    blob(w * 0.2, h * 0.62, w * 0.12, 'rgba(255,200,140,0.25)');
    blob(w * 0.05, h * 0.12, w * 0.08, 'rgba(255,210,160,0.3)');
    blob(w * 0.86, h * 0.22, w * 0.3, 'rgba(90,130,200,0.22)');
    blob(w * 0.7, h * 0.8, w * 0.22, 'rgba(60,80,120,0.25)');
  });
  scene.background.colorSpace = THREE.SRGBColorSpace;

  const key = new THREE.DirectionalLight(0xfff1e6, 2.2);
  key.position.set(-1.1, 1.9, -2.9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  Object.assign(key.shadow.camera, { left: -1.2, right: 1.2, top: 2.2, bottom: -0.2, near: 0.1, far: 8 });
  const fill = new THREE.DirectionalLight(0xb4c6ff, 1.05);
  fill.position.set(2.2, 1.2, -1.5);
  const rim = new THREE.DirectionalLight(0xffa860, 2.0);
  rim.position.set(1.8, 2.2, 2.6);
  const hemi = new THREE.HemisphereLight(0x95a6cc, 0x3a2a20, 0.75);
  scene.add(key, key.target, fill, fill.target, rim, rim.target, hemi);

  const material = createCharacterMaterial({ rim: 1, name: 'chr-portrait' });
  material.userData.rimColor.setRGB(1.0, 0.62, 0.36).multiplyScalar(0.5);
  material.userData.sunDir.copy(rim.position).normalize();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
  let chr = null;
  let batch = null;
  const cache = new Map();
  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();

  function ensure(app) {
    if (!chr) {
      chr = new Character(app, { lod: 0, name: 'portrait', seed: 99 });
      batch = new CharacterBatch({
        material,
        parent: chr.object,
        name: 'portrait-mesh',
        castShadow: true,
        receiveShadow: true,
        localBounds: new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.8),
      });
      batch.add(chr);
      batch.rebuild();
      scene.add(chr.object);
    } else if (chr.setAppearance(app, 0)) batch.rebuild();
  }

  function frameCamera(framing, view) {
    const fr = chr.frame;
    const hc = fr.headC;
    let d;
    let ty;
    let az = 0.42;
    let up = 0.02;
    if (framing === 'face') {
      d = 0.66;
      ty = hc.y - 0.005;
    } else if (framing === 'full') {
      d = 4.6 * fr.s;
      ty = 0.92 * fr.s;
      up = 0.35;
      az = 0.5;
    } else {
      d = 0.92;
      ty = hc.y - 0.085;
      up = 0.05;
    }
    if (view === 'back') az = Math.PI + 0.62;
    else if (view === 'side') az = 1.35;
    else if (view === 'front') az = 0.12;
    // character faces −Z; camera in front = −Z side
    camera.position.set(Math.sin(az) * d, ty + up, -Math.cos(az) * d);
    look.set(0, ty, 0);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    // light rig follows the view so the back view still gets a rim
    const flip = view === 'back' ? -1 : 1;
    key.position.set(-1.1 * flip, 1.9, -2.9 * flip);
    rim.position.set(1.8 * flip, 2.2, 2.6 * flip);
    fill.position.set(2.2 * flip, 1.2, -1.5 * flip);
    material.userData.sunDir.copy(rim.position).normalize();
  }

  function pose(framing, view, look = true) {
    const a = chr.anim;
    a.speed = 0;
    a.grounded = true;
    a.swimming = false;
    a.turnRate = 0;
    a.vy = 0;
    for (const k of Object.keys(a.targets)) a.targets[k] = 0;
    a.settle();
    a.t = 31.7;
    a.blinkT = 99;
    a.blinkPh = -1;
    if (look && view !== 'back' && framing !== 'full') {
      camera.getWorldPosition(tmp);
      a.lookAt(tmp);
    } else a.lookAt(null);
    for (let i = 0; i < 12; i++) a.update(0.1);
    a.t = 31.7;
    a.update(0.0005);
    chr.object.updateMatrixWorld(true);
  }

  function resolve(appOrId) {
    if (typeof appOrId === 'string') return resolveAppearance(appOrId);
    return normalizeAppearance(appOrId);
  }

  function renderFast(w, h) {
    const r = ctx.engine.renderer;
    const pr = r.getPixelRatio();
    const cw = r.domElement.width / pr;
    const ch = r.domElement.height / pr;
    // supersample ×2 when it fits; always keep the requested aspect ratio
    const ss = Math.min(2, cw / w, ch / h);
    const vw = Math.floor(w * ss);
    const vh = Math.floor(h * ss);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    r.setScissorTest(true);
    r.setViewport(0, 0, vw, vh);
    r.setScissor(0, 0, vw, vh);
    r.setRenderTarget(null);
    r.render(scene, camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, cw, ch);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const src = r.domElement;
    g.drawImage(src, 0, src.height - vh * pr, vw * pr, vh * pr, 0, 0, w, h);
    return out;
  }

  const portraits = {
    scene,
    camera,
    /** Renders a portrait canvas (cached). */
    render(appOrId, { width = 256, height = 256, framing = 'bust', view = 'three-quarter', fast = false, noCache = false, look = true } = {}) {
      const app = resolve(appOrId);
      if (!app) return document.createElement('canvas');
      const k = `${appearanceKey(app)}|${framing}|${view}|${width}x${height}|${fast ? 1 : 0}|${look ? 1 : 0}`;
      const hit = cache.get(k);
      if (hit && !noCache) {
        cache.delete(k);
        cache.set(k, hit);
        return hit;
      }
      let canvas;
      try {
        ensure(app);
        frameCamera(framing, view);
        pose(framing, view, look);
        canvas = fast ? renderFast(width, height) : ctx.engine.snapshot(scene, camera, width, height);
      } catch (err) {
        console.error('[characters] portrait failed', err);
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
      }
      cache.set(k, canvas);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return canvas;
    },
    /** Is a portrait already cached (no render needed)? */
    has(appOrId, opts = {}) {
      const app = resolve(appOrId);
      if (!app) return false;
      const { width = 256, height = 256, framing = 'bust', view = 'three-quarter', fast = false } = opts;
      return cache.has(`${appearanceKey(app)}|${framing}|${view}|${width}x${height}|${fast ? 1 : 0}|1`);
    },
    clearCache() {
      cache.clear();
    },
  };
  return portraits;
}
