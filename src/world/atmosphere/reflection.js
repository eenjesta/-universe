import * as THREE from 'three';
import { setFogMirror } from './fog.js';
import { createMirrorCull } from './reflection-cull.js';

/**
 * Planar reflection of the world in the water plane (y = waterLevel), used by
 * the lake/sea shader on high quality. Rendered from scene.onBeforeRender —
 * before the main pass, for whichever camera renders the world — at reduced
 * resolution into an HDR target, with an oblique near plane clipping
 * everything below the water (Lengyel), shadows frozen and the sun disc
 * hidden (the water shader adds an analytic sun glitter instead).
 * Objects can opt out (`exclude(obj)`), e.g. particles or the water itself;
 * everything else is mirror-culled per pass (reflection-cull.js: tiny props,
 * particles and objects whose reflection would land on land are skipped).
 */
export function createReflection(ctx, world, { scale = 0.5 } = {}) {
  const renderer = ctx.engine.renderer;
  const plane = new THREE.Plane();
  const normal = new THREE.Vector3(0, 1, 0);
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const target = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const virtualCam = new THREE.PerspectiveCamera();
  virtualCam.name = 'atmo-reflection-camera';
  const textureMatrix = new THREE.Matrix4();
  const excluded = new Set();
  const hiddenState = [];
  const hooks = { before: [], after: [] }; // callbacks around the pass (e.g. sky sun disc off)
  const cull = createMirrorCull(world);

  let rt = new THREE.WebGLRenderTarget(16, 16, {
    type: THREE.HalfFloatType,
    samples: 0,
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  rt.texture.name = 'atmo-reflection';

  const state = { enabled: true, rendering: false, valid: false, scale, lastFrame: -1 };

  const size = new THREE.Vector2();
  function resize() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(16, Math.round(size.x * state.scale));
    const h = Math.max(16, Math.round(size.y * state.scale));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
  }

  /** Renders the reflection for `camera`. Returns false when skipped. */
  function render(scene, camera) {
    if (!state.enabled || state.rendering) return false;
    const level = world.waterLevel ?? 0;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= level + 0.05) {
      state.valid = false;
      return false; // under water: no mirror
    }
    resize();
    // mirrored camera
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    virtualCam.position.set(camPos.x, 2 * level - camPos.y, camPos.z);
    target.set(lookAt.x, 2 * level - lookAt.y, lookAt.z);
    virtualCam.up.set(0, 1, 0).applyMatrix4(rot);
    virtualCam.up.y = -virtualCam.up.y;
    virtualCam.lookAt(target);
    virtualCam.near = camera.near;
    virtualCam.far = camera.far;
    virtualCam.updateMatrixWorld();
    virtualCam.projectionMatrix.copy(camera.projectionMatrix);
    virtualCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(virtualCam.projectionMatrix);
    textureMatrix.multiply(virtualCam.matrixWorldInverse);

    // oblique near plane = water plane (in reflection-camera space)
    plane.setFromNormalAndCoplanarPoint(normal, target.set(0, level, 0));
    plane.applyMatrix4(virtualCam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = virtualCam.projectionMatrix;
    q.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm.elements[2] = clip.x;
    pm.elements[6] = clip.y;
    pm.elements[10] = clip.z + 1.0 - 0.003;
    pm.elements[14] = clip.w;

    // hide excluded objects
    hiddenState.length = 0;
    for (const o of excluded) {
      hiddenState.push(o.visible);
      o.visible = false;
    }
    cull.apply(scene, camPos, excluded);
    for (const fn of hooks.before) fn(virtualCam);
    setFogMirror(true);

    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevAutoClear = renderer.autoClear;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    state.rendering = true;
    try {
      renderer.setRenderTarget(rt);
      renderer.state.buffers.depth.setMask(true);
      renderer.autoClear = false;
      renderer.clear(true, true, false);
      renderer.render(scene, virtualCam);
    } finally {
      state.rendering = false;
      renderer.autoClear = prevAutoClear;
      renderer.xr.enabled = prevXr;
      renderer.shadowMap.autoUpdate = prevShadow;
      renderer.setRenderTarget(prevTarget);
      setFogMirror(false);
      for (const fn of hooks.after) fn(virtualCam);
      cull.restore();
      let i = 0;
      for (const o of excluded) o.visible = hiddenState[i++];
    }
    state.valid = true;
    return true;
  }

  return {
    get texture() {
      return rt.texture;
    },
    textureMatrix,
    camera: virtualCam,
    state,
    hooks,
    cull,
    render,
    exclude(obj) {
      if (obj) excluded.add(obj);
    },
    include(obj) {
      excluded.delete(obj);
    },
    setScale(s) {
      state.scale = s;
    },
    dispose() {
      rt.dispose();
    },
  };
}
