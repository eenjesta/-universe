import * as THREE from 'three';
import { HALF } from './shape.js';
import { sampleGrid } from './heightfield.js';

/**
 * Terrain sun visibility (long golden-hour shadows of hills, ridges and
 * cliffs at any distance — the camera-following shadow map only covers
 * ±80 m and the terrain does not cast into it).
 *
 * A 1024² R8 map over ±1200 m is rendered on the GPU by a full-screen pass
 * that marches the height field from every texel toward the key light (sun
 * by day, the giant planet at night) with soft penumbrae. It is re-rendered
 * only when the light direction moved by more than ~0.3° (time flows
 * slowly), so at runtime every consumer pays a single texture fetch:
 *   terrain (per fragment), grass (per tuft), plants + rocks (per vertex).
 *
 * `applySunVisibility(material)` patches any MeshStandardMaterial so its
 * directional (key) light is attenuated by the map — exposed on
 * world.terrain for other modules (characters, landmarks, vehicles) so
 * nothing stays sunlit inside a valley in terrain shadow.
 *   world.terrain.sunVisibility = { texture, uniforms, applySunVisibility, sample(x, z, y?) }
 */
const SIZE = 1024;

/** GLSL: uniforms + helper `float terrainSunVis(vec2 worldXZ)`. */
export const SUNVIS_PARS = /* glsl */ `
uniform sampler2D tSunVis;
uniform float uSunVisOn;
float terrainSunVis(vec2 xz) {
  float v = textureLod(tSunVis, xz * ${(1 / (HALF * 2)).toFixed(10)} + 0.5, 0.0).r;
  return mix(1.0, v, uSunVisOn);
}
`;

const PASS_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// march toward the light over the exact (half-float, bilinear) height grid
const PASS_FS = /* glsl */ `
precision highp float;
uniform sampler2D tHeight;
uniform vec3 uL;
uniform float uMaxH;
uniform float uN;
varying vec2 vUv;
float H(vec2 xz) {
  vec2 g = (xz + ${HALF.toFixed(1)}) * 0.5;
  return textureLod(tHeight, (g + 0.5) / uN, 0.0).r;
}
void main() {
  vec2 xz = vUv * ${(HALF * 2).toFixed(1)} - ${HALF.toFixed(1)};
  // average a few taps for the start height (texel = 2.3 m, grid = 2 m)
  float h0 = max(max(H(xz), H(xz + vec2(0.9, 0.0))), max(H(xz + vec2(0.0, 0.9)), H(xz - vec2(0.6))));
  vec3 o = vec3(xz.x, h0 + 0.9, xz.y);
  float vis = 1.0;
  float t = 2.0;
  for (int i = 0; i < 56; i++) {
    vec3 q = o + uL * t;
    if (q.y > uMaxH || abs(q.x) > ${HALF.toFixed(1)} || abs(q.z) > ${HALF.toFixed(1)}) break;
    float d = q.y - H(q.xz);
    // soft penumbra: ~2.5° wide, tighter close to the occluder
    vis = min(vis, clamp(d * 22.0 / t + 0.04, 0.0, 1.0));
    if (vis <= 0.0) break;
    t += max(1.2, t * 0.13);
  }
  gl_FragColor = vec4(vis, vis, vis, 1.0);
}
`;

export function createSunVisibility(renderer, data) {
  const { heights, N } = data;
  // exact grid as half floats (bilinear filtering is core in WebGL2 for half floats)
  const half = new Uint16Array(N * N);
  let maxH = -Infinity;
  for (let k = 0; k < half.length; k++) {
    const h = heights[k];
    if (h > maxH) maxH = h;
    half[k] = THREE.DataUtils.toHalfFloat(h);
  }
  const heightTex = new THREE.DataTexture(half, N, N, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.generateMipmaps = false;
  heightTex.needsUpdate = true;
  heightTex.name = 'terrain-height-half';

  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    format: THREE.RedFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.name = 'terrain-sun-visibility';

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tHeight: { value: heightTex },
      uL: { value: new THREE.Vector3(0, 1, 0) },
      uMaxH: { value: maxH + 2 },
      uN: { value: N },
    },
    vertexShader: PASS_VS,
    fragmentShader: PASS_FS,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** Shared uniforms for every consumer (value objects are shared by reference). */
  const uniforms = {
    tSunVis: { value: target.texture },
    uSunVisOn: { value: 0 }, // 0 until the first render (the map starts undefined)
  };

  const lastDir = new THREE.Vector3(0, -1, 0);
  const dir = new THREE.Vector3();
  const prevClear = new THREE.Color();
  let renders = 0;

  function render(lightDir) {
    material.uniforms.uL.value.copy(lightDir);
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.setClearColor(prevClear, prevAlpha);
    uniforms.uSunVisOn.value = 1;
    renders++;
  }

  /**
   * Per frame: reads the key light direction from the world's DirectionalLight
   * and re-renders the map when it moved noticeably. Returns true if rendered.
   */
  function update(world, force = false) {
    const sun = world?.sun;
    if (!sun?.isDirectionalLight) return false;
    // the atmosphere's key-light direction (sun by day, planet at night) is
    // current during the update phase; the light's position lags a frame
    const key = world.atmosphere?.lighting?.keyDir;
    if (key?.isVector3) dir.copy(key);
    else dir.subVectors(sun.position, sun.target.position);
    if (dir.lengthSq() < 1e-8) return false;
    dir.normalize();
    // light from (almost) below the horizon: lift it so the map stays sane
    if (dir.y < 0.015) {
      dir.y = 0.015;
      dir.normalize();
    }
    if (!force && dir.dot(lastDir) > Math.cos(0.3 * THREE.MathUtils.DEG2RAD)) return false;
    lastDir.copy(dir);
    render(dir);
    return true;
  }

  /** Patches a MeshStandard/Physical material: key light × terrain visibility. */
  function applySunVisibility(mat, { at = 'world' } = {}) {
    if (!mat || mat.userData.sunVis) return mat;
    mat.userData.sunVis = true;
    const prev = mat.onBeforeCompile;
    // three's default cache key is onBeforeCompile.toString(): keep the
    // ORIGINAL hook's source in the key, or every wrapped material would
    // share one program
    const ownKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey : null;
    const baseKey = () => (ownKey ? ownKey.call(mat) : String(prev));
    mat.onBeforeCompile = (shader, r) => {
      prev?.call(mat, shader, r);
      Object.assign(shader.uniforms, uniforms);
      injectVertexVisibility(shader, at);
      patchKeyLight(shader, 'vSunVis');
    };
    mat.customProgramCacheKey = () => `${baseKey()}|sunvis-${at}`;
    mat.needsUpdate = true;
    return mat;
  }

  /**
   * CPU equivalent of the map at one point (same march, no GPU readback):
   * 0 = in terrain shadow … 1 = lit. `y` defaults to the ground height.
   */
  function sample(x, z, y) {
    if (!uniforms.uSunVisOn.value) return 1;
    const L = lastDir;
    const oy = (y ?? sampleGrid(heights, x, z)) + 0.9;
    let vis = 1;
    let t = 2;
    for (let i = 0; i < 56; i++) {
      const qx = x + L.x * t;
      const qy = oy + L.y * t;
      const qz = z + L.z * t;
      if (qy > maxH + 2 || Math.abs(qx) > HALF || Math.abs(qz) > HALF) break;
      const d = qy - sampleGrid(heights, qx, qz);
      vis = Math.min(vis, Math.max(0, Math.min(1, (d * 22) / t + 0.04)));
      if (vis <= 0) break;
      t += Math.max(1.2, t * 0.13);
    }
    return vis;
  }

  return {
    texture: target.texture,
    heightTexture: heightTex,
    uniforms,
    update,
    render,
    applySunVisibility,
    sample,
    get renders() {
      return renders;
    },
    size: SIZE,
    dispose() {
      target.dispose();
      heightTex.dispose();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}

/**
 * Adds `varying float vSunVis` computed in the vertex shader from the world
 * position (`at: 'world'`) or the instance origin (`at: 'instance'`).
 */
export function injectVertexVisibility(shader, at = 'world') {
  if (shader.vertexShader.includes('vSunVis')) return;
  const pos =
    at === 'instance'
      ? `
#ifdef USE_INSTANCING
  vec2 svXZ = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
#else
  vec2 svXZ = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
#endif`
      : `
#ifdef USE_INSTANCING
  vec2 svXZ = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
#else
  vec2 svXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
#endif`;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n#define TERRAIN_SUNVIS\n${SUNVIS_PARS}\nvarying float vSunVis;`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n{${pos}\n  vSunVis = terrainSunVis(svXZ);\n}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n#define TERRAIN_SUNVIS\nvarying float vSunVis;');
}

/**
 * Multiplies the directional (key) light by `expr` inside three's light loop
 * (the world has exactly one directional light: the sun / planet key light).
 */
export function patchKeyLight(shader, expr) {
  const chunk = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    `getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ${expr};`,
  );
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
}
