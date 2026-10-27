import * as THREE from 'three';

/**
 * Lights of the open world:
 *  - `sun`: the single shadow-casting DirectionalLight. By day it is the sun;
 *    at night it smoothly becomes the cool light of the giant planet (the key
 *    light direction swaps while its intensity is ~0 during twilight).
 *    Its shadow box (±80 m) follows whichever camera renders the world
 *    (placed from scene.onBeforeRender) and is snapped to shadow-map texels
 *    in light space so shadows do not shimmer while the camera moves.
 *  - `hemi`: sky/ground fill (cool from above, warm bounce from below).
 * Also applies the per-time post look (colour grade, bloom, exposure) while
 * the world scene is on screen.
 */

const SHADOW_HALF = 80; // → 160 m coverage
const LIGHT_DIST = 650;

export function createLighting(ctx, world) {
  const scene = world.scene;
  const engine = ctx.engine;

  const sun = new THREE.DirectionalLight(0xffc48a, 3);
  sun.name = 'atmo-sun';
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_HALF;
  sc.right = SHADOW_HALF;
  sc.top = SHADOW_HALF;
  sc.bottom = -SHADOW_HALF;
  sc.near = 1;
  sc.far = LIGHT_DIST + 520;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 2.5;
  setShadowSize(engine.quality.shadowMapSize);
  sun.target.name = 'atmo-sun-target';
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x3b2c22, 0.6);
  hemi.name = 'atmo-hemi';
  scene.add(hemi);

  function setShadowSize(size) {
    const s = Math.max(256, size | 0 || 2048);
    if (sun.shadow.mapSize.x === s) return;
    sun.shadow.mapSize.set(s, s);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }

  // ---------------------------------------------------------------- shadows
  const keyDir = new THREE.Vector3(0, 1, 0);
  const focus = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const ax = new THREE.Vector3();
  const ay = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** Centres the shadow box in front of `camera` and snaps it to texels. */
  function placeShadow(camera) {
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    const l = fwd.length();
    if (l > 1e-3) fwd.multiplyScalar(1 / l);
    focus.setFromMatrixPosition(camera.matrixWorld).addScaledVector(fwd, SHADOW_HALF * 0.45);
    const g = world.getHeightAt?.(focus.x, focus.z);
    focus.y = Number.isFinite(g) ? Math.max(g, world.waterLevel ?? 0) : focus.y - 20;

    // light-space basis identical to Matrix4.lookAt(eye = focus + dir, target = focus, up = Y)
    ax.crossVectors(UP, keyDir);
    if (ax.lengthSq() < 1e-8) ax.set(1, 0, 0);
    ax.normalize();
    ay.crossVectors(keyDir, ax);
    const texel = (SHADOW_HALF * 2) / sun.shadow.mapSize.x;
    const lx = Math.round(focus.dot(ax) / texel) * texel;
    const ly = Math.round(focus.dot(ay) / texel) * texel;
    const lz = focus.dot(keyDir);
    focus.copy(ax).multiplyScalar(lx).addScaledVector(ay, ly).addScaledVector(keyDir, lz);

    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(keyDir, LIGHT_DIST);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- per time
  const keyColor = new THREE.Color();

  /**
   * @param pal evaluated palette
   * @param f   { sunDir, night, planetDir, sunDim (0..1 cloud cover at the sun) }
   */
  function update(pal, f) {
    const sunStrength = Math.max(pal.sun.r, pal.sun.g, pal.sun.b) * (1 - 0.45 * f.sunDim);
    const planetStrength = Math.max(pal.planetKey.r, pal.planetKey.g, pal.planetKey.b) * f.night;
    if (sunStrength >= planetStrength * 1.2 || f.night < 0.05) {
      keyDir.copy(f.sunDir);
      keyColor.copy(pal.sun).multiplyScalar(1 - 0.45 * f.sunDim);
    } else {
      // night: the giant planet is the key light (cool, from the north)
      keyDir.copy(f.planetDir);
      keyColor.copy(pal.planetKey).multiplyScalar(f.night);
    }
    // never light from below the horizon
    if (keyDir.y < 0.02) {
      keyDir.y = 0.02;
      keyDir.normalize();
    }
    const m = Math.max(keyColor.r, keyColor.g, keyColor.b);
    sun.intensity = m;
    if (m > 1e-5) sun.color.copy(keyColor).multiplyScalar(1 / m);
    sun.visible = m > 1e-3;
    // softer, wider penumbra at low light (planet is a huge area light)
    sun.shadow.radius = f.night > 0.5 ? 5 : 2.5;

    hemi.color.copy(pal.hemiSky);
    hemi.groundColor.copy(pal.hemiGround);
    hemi.intensity = pal.hemi;
    scene.environmentIntensity = pal.env;
  }

  // ---------------------------------------------------------------- post look
  const post = { enabled: true, override: {} };
  function applyPost(pal) {
    if (!post.enabled) return;
    const o = post.override;
    const g = engine.grade?.uniforms;
    if (g) {
      if (g.uSaturation) g.uSaturation.value = o.uSaturation ?? pal.saturation;
      if (g.uContrast) g.uContrast.value = o.uContrast ?? pal.contrast;
      if (g.uVignette) g.uVignette.value = o.uVignette ?? pal.vignette;
      if (g.uShadowTint) {
        if (o.uShadowTint) g.uShadowTint.value.copy(o.uShadowTint);
        else g.uShadowTint.value.setRGB(pal.shadowTint.x, pal.shadowTint.y, pal.shadowTint.z);
      }
      if (g.uHighlightTint) {
        if (o.uHighlightTint) g.uHighlightTint.value.copy(o.uHighlightTint);
        else g.uHighlightTint.value.setRGB(pal.highlightTint.x, pal.highlightTint.y, pal.highlightTint.z);
      }
    }
    const b = engine.bloom;
    if (b) {
      b.strength = o.bloomStrength ?? pal.bloom;
      b.radius = o.bloomRadius ?? pal.bloomRadius;
      b.threshold = o.bloomThreshold ?? pal.threshold;
    }
    engine.renderer.toneMappingExposure = o.exposure ?? pal.exposure;
  }

  return { sun, hemi, keyDir, placeShadow, update, applyPost, post, setShadowSize };
}
