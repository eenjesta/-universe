import * as THREE from 'three';

/**
 * Plant impostors (far LOD for trees and bushes).
 *
 * bakeImpostors() renders every plant's detailed geometry once, at install,
 * from the side (orthographic) into two atlases — albedo (sRGB-encoded,
 * vertex AO applied) and the authored canopy normals — one 256×512 slot per
 * plant. Far instances then draw a single quad each: the vertex shader turns
 * it toward the camera around its base (tilting back when seen from above),
 * the fragment shader samples the atlases and lights the card with the baked
 * normals through the standard PBR path (shadows, fog, sun) plus the same
 * low-sun backlight as the near foliage, so the hand-over at the near radius
 * is barely visible. Instances are mirrored at random for variety.
 */
const SLOT_W = 256;
const SLOT_H = 512;
const COLS = 8;

const BAKE_VS = /* glsl */ `
attribute vec3 color;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vN;
void main() {
  vUv = uv;
  vCol = color;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BAKE_FS = /* glsl */ `
uniform sampler2D map;
uniform float uMode; // 0 = albedo (sRGB encoded), 1 = view-space normal
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vN;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.42) discard;
  if (uMode < 0.5) {
    vec3 lin = t.rgb * vCol;
    gl_FragColor = vec4(pow(max(lin, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
  } else {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n.z = abs(n.z);
    gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
  }
}
`;

/**
 * @param renderer WebGLRenderer
 * @param plants   { name: {geometry} } detailed plant geometries
 * @param map      the vegetation atlas texture
 * @returns { albedo, normal, slots: {name: {u0, v0, u1, v1, width, height, y0}}, dispose }
 */
export function bakeImpostors(renderer, plants, map) {
  const names = Object.keys(plants);
  const rows = Math.ceil(names.length / COLS);
  const W = SLOT_W * COLS;
  const H = SLOT_H * rows;
  const opts = {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  };
  const albedo = new THREE.WebGLRenderTarget(W, H, opts);
  const normal = new THREE.WebGLRenderTarget(W, H, opts);
  albedo.texture.name = 'impostor-albedo';
  normal.texture.name = 'impostor-normal';
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uMode: { value: 0 } },
    vertexShader: BAKE_VS,
    fragmentShader: BAKE_FS,
    side: THREE.DoubleSide,
  });
  // one scene in pixel units: every plant scaled into its own slot, so each
  // atlas is a single render (mipmaps are generated once per atlas)
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, W, H, 0, 1, 6000);
  cam.position.set(0, 0, 3000);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const slots = {};
  names.forEach((name, i) => {
    const geo = plants[name].geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const halfW = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) * 1.04;
    const h = (bb.max.y - Math.min(0, bb.min.y)) * 1.03;
    const scale = Math.min(SLOT_W / (2 * halfW), SLOT_H / h); // px per metre
    const y0 = Math.min(0, bb.min.y);
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(scale);
    mesh.position.set(col * SLOT_W + SLOT_W / 2, row * SLOT_H - y0 * scale, 0);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const inset = 0.5; // half-texel inset against bleeding between slots
    slots[name] = {
      u0: (col * SLOT_W + inset) / W,
      u1: ((col + 1) * SLOT_W - inset) / W,
      v0: (row * SLOT_H + inset) / H,
      v1: ((row + 1) * SLOT_H - inset) / H,
      width: SLOT_W / scale,
      height: SLOT_H / scale,
      y0,
    };
  });

  const prev = {
    target: renderer.getRenderTarget(),
    clear: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
  };
  renderer.autoClear = false;
  // transparent texels carry a foliage tone so mip levels never fringe to black
  for (const [rt, c, mode] of [[albedo, 0x223018, 0], [normal, 0x8080ff, 1]]) {
    mat.uniforms.uMode.value = mode;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(c, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.clear, prev.alpha);
  renderer.autoClear = prev.autoClear;
  mat.dispose();
  return {
    albedo: albedo.texture,
    normal: normal.texture,
    slots,
    dispose() {
      albedo.dispose();
      normal.dispose();
    },
  };
}

/** One card (4 vertices) covering a slot: x in metres around 0, y from y0. */
export function impostorQuad(slot) {
  const g = new THREE.BufferGeometry();
  const x0 = -slot.width / 2;
  const x1 = slot.width / 2;
  const y0 = slot.y0;
  const y1 = slot.y0 + slot.height;
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([slot.u0, slot.v0, slot.u1, slot.v0, slot.u1, slot.v1, slot.u0, slot.v1], 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, y0 + slot.height / 2, 0), Math.hypot(slot.width, slot.height) / 2);
  return g;
}

const IMP_VS_PARS = /* glsl */ `
varying vec3 vImpR;
varying vec3 vImpU;
varying vec3 vImpF;
float impHash(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return float(x) / 4294967295.0;
}
`;

// runs after begin_vertex (and after the far-LOD collapse, which zeroes `transformed`)
const IMP_VS = /* glsl */ `
{
  mat4 iM = modelMatrix * instanceMatrix;
  vec3 iO = iM[3].xyz;
  float iSx = length(iM[0].xyz);
  float iSy = length(iM[1].xyz);
  vec3 toCam = cameraPosition - iO;
  vec2 hz = normalize(toCam.xz + vec2(1e-4, 0.0));
  vec3 bR = vec3(hz.y, 0.0, -hz.x);
  // tilt the card back toward a camera above it (pivot at the base)
  float pitch = atan(toCam.y, length(toCam.xz));
  float tilt = clamp(pitch, 0.0, 1.3) * 0.6;
  vec3 bU = vec3(-hz.x * sin(tilt), cos(tilt), -hz.y * sin(tilt));
  vec3 bF = normalize(cross(bR, bU));
  // mirror flip from the instance's position, not gl_InstanceID: streamed layers (src/frontier)
  // move instances between slots, which made distant trees flip sideways while flying
  float flip = impHash((floatBitsToUint(iO.x) ^ (floatBitsToUint(iO.z) * 0x9e3779b1u)) * 7u + 3u) < 0.5 ? -1.0 : 1.0;
  vec3 wp = iO + bR * (transformed.x * iSx * flip) + bU * (transformed.y * iSy);
  vImpR = normalize((viewMatrix * vec4(bR * flip, 0.0)).xyz);
  vImpU = normalize((viewMatrix * vec4(bU, 0.0)).xyz);
  vImpF = normalize((viewMatrix * vec4(bF, 0.0)).xyz);
  // express the world position in the instance's local frame so every later
  // chunk (projection, shadows, fog) works unchanged; collapsed (far-LOD
  // culled) vertices stay at the origin
  // removed instances have an all-zero matrix (instancing.js): inverse() of it is
  // Inf/NaN, so collapse them like the far-LOD cull does
  if (iSx * iSy <= 0.0) transformed = vec3(0.0);
  if (dot(transformed, transformed) > 0.0) transformed = (inverse(iM) * vec4(wp, 1.0)).xyz;
}
`;

const IMP_FS_PARS = /* glsl */ `
uniform sampler2D tImpAlbedo;
uniform sampler2D tImpNormal;
uniform vec3 uSunDirW;
uniform vec3 uSunColor;
varying vec3 vImpR;
varying vec3 vImpU;
varying vec3 vImpF;
`;

const IMP_FS_ALBEDO = /* glsl */ `
vec4 impA = texture2D(tImpAlbedo, vMapUv);
if (impA.a < 0.45) discard;
diffuseColor.rgb = pow(impA.rgb, vec3(2.2));
`;

const IMP_FS_NORMAL = /* glsl */ `
float faceDirection = 1.0;
vec3 impN = texture2D(tImpNormal, vMapUv).xyz * 2.0 - 1.0;
vec3 normal = normalize(vImpR * impN.x + vImpU * impN.y + vImpF * max(impN.z, 0.05));
vec3 nonPerturbedNormal = normal;
`;

const IMP_FS_BACKLIGHT = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 vdir = normalize(vViewPosition);
  vec3 sunView = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
  float tr = pow(max(0.0, dot(-vdir, sunView)), 5.0);
#ifdef TERRAIN_SUNVIS
  tr *= vSunVis;
#endif
  totalEmissiveRadiance += diffuseColor.rgb * uSunColor * tr;
}
`;

/**
 * Impostor material (shared program for every far plant layer). `shared`
 * holds the vegetation's sun uniforms (uSunDirW, uSunColor).
 */
export function createImpostorMaterial(bake, shared) {
  const mat = new THREE.MeshStandardMaterial({
    map: bake.albedo, // enables vMapUv; sampled manually below
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  mat.name = 'vegetation-impostor';
  const uniforms = { tImpAlbedo: { value: bake.albedo }, tImpNormal: { value: bake.normal }, uSunDirW: shared.uSunDirW, uSunColor: shared.uSunColor };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${IMP_VS_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${IMP_VS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${IMP_FS_PARS}`)
      .replace('#include <map_fragment>', IMP_FS_ALBEDO)
      .replace('#include <normal_fragment_begin>', IMP_FS_NORMAL)
      .replace('#include <emissivemap_fragment>', IMP_FS_BACKLIGHT);
  };
  mat.customProgramCacheKey = () => 'veg-impostor-v2';
  return mat;
}
