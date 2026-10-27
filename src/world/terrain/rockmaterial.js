import * as THREE from 'three';
import { TERRAIN_PALETTE } from './material.js';

/**
 * Shared rock material (boulders, slabs, shards, hoodoos, arches): one
 * MeshStandardMaterial program patched with onBeforeCompile.
 *
 * The vertex shader samples the terrain's own data textures at the instance
 * origin, so every rock adapts to where it lies:
 *   canyon (splat A.g)        → red sandstone with horizontal strata
 *   moisture / forest / jungle → moss + lichen on upward faces
 *   world y near the water    → wet, darker, glossy
 *   height above the terrain  → dusty dirt/sand tint at the ground contact
 * Fragment: triplanar detail (terrain detail texture, two scales), cellular
 * cracks, derivative bump mapping, vertex-colour AO × instance tint.
 */
export const ROCK_PALETTE = {
  granite: '#7b746b',
  graniteDark: '#3f3a35',
  graniteWarm: '#8d7d6a',
  moss: '#4a5524',
  mossLight: '#7c8a3c',
  lichen: '#a9a17a',
  dust: TERRAIN_PALETTE.dirt,
  sandDust: TERRAIN_PALETTE.sand,
  redRock: TERRAIN_PALETTE.redRock,
  redRockLight: TERRAIN_PALETTE.redRockLight,
};

const VS_PARS = /* glsl */ `
uniform highp sampler2D tHeight;
uniform sampler2D tNormal;
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
varying vec3 vRockW;
varying vec3 vRockN;
varying vec4 vRockCtx; // canyon, moss, dust, ground distance
float rockTerrainH(vec2 xz) {
  vec2 g = clamp((xz + 1200.0) * 0.5, vec2(0.0), vec2(1200.0));
  vec2 gi = min(floor(g), vec2(1199.0));
  vec2 f = g - gi;
  ivec2 p = ivec2(gi);
  float a = texelFetch(tHeight, p, 0).r;
  float b = texelFetch(tHeight, p + ivec2(1, 0), 0).r;
  float c = texelFetch(tHeight, p + ivec2(0, 1), 0).r;
  float d = texelFetch(tHeight, p + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

const VS_MAIN = /* glsl */ `
{
#ifdef USE_INSTANCING
  mat4 rM = modelMatrix * instanceMatrix;
#else
  mat4 rM = modelMatrix;
#endif
  vec4 rW = rM * vec4(transformed, 1.0);
  vRockW = rW.xyz;
  // normal → world with non-uniform instance scale handled like three does
  vec3 rN0 = objectNormal;
#ifdef USE_INSTANCING
  mat3 rIm = mat3(instanceMatrix);
  rN0 /= vec3(dot(rIm[0], rIm[0]), dot(rIm[1], rIm[1]), dot(rIm[2], rIm[2]));
  rN0 = rIm * rN0;
#endif
  rN0 = mat3(modelMatrix) * rN0;
  vRockN = dot(rN0, rN0) > 1e-12 ? normalize(rN0) : vec3(0.0, 1.0, 0.0);
#ifdef USE_INSTANCING
  vec2 io = (rM * vec4(0.0, 0.0, 0.0, 1.0)).xz;
#else
  // merged world-space meshes (arches, cliff faces): context per vertex
  vec2 io = rW.xz;
#endif
  vec2 ruv = (io + 1201.0) / 2402.0;
  vec4 sa = textureLod(tSplatA, ruv, 0.0);
  vec4 sb = textureLod(tSplatB, ruv, 0.0);
  float moist = textureLod(tNormal, ruv, 0.0).a;
  float canyon = smoothstep(0.25, 0.6, sa.g);
  float moss = clamp((moist - 0.35) * 1.4 + sb.a * 0.6 + sa.b * 0.8, 0.0, 1.0) * (1.0 - canyon);
  float dust = max(sa.r, sa.a * 0.8);
  vRockCtx = vec4(canyon, moss, dust, rW.y - rockTerrainH(rW.xz));
}
`;

const FS_PARS = /* glsl */ `
uniform sampler2D tDetail;
uniform vec3 r_granite;
uniform vec3 r_graniteDark;
uniform vec3 r_graniteWarm;
uniform vec3 r_moss;
uniform vec3 r_mossLight;
uniform vec3 r_lichen;
uniform vec3 r_dust;
uniform vec3 r_sandDust;
uniform vec3 r_redRock;
uniform vec3 r_redRockLight;
varying vec3 vRockW;
varying vec3 vRockN;
varying vec4 vRockCtx;
vec4 rockTri(vec3 p, vec3 w) {
  return texture2D(tDetail, p.zy) * w.x + texture2D(tDetail, p.xz) * w.y + texture2D(tDetail, p.xy) * w.z;
}
// triplanar bump from the detail texture's stored height gradients (R, G):
// mip-filtered, so no screen-derivative blockiness on high-frequency noise
vec3 rockTriBump(vec3 p, vec3 n, vec3 w, float s, float k) {
  vec2 gx = texture2D(tDetail, p.zy * s).rg - 0.5;
  vec2 gy = texture2D(tDetail, p.xz * s).rg - 0.5;
  vec2 gz = texture2D(tDetail, p.xy * s).rg - 0.5;
  vec3 b = vec3(0.0, gx.y, gx.x) * w.x + vec3(gy.x, 0.0, gy.y) * w.y + vec3(gz.x, gz.y, 0.0) * w.z;
  return n - b * k;
}
`;

// replaces <map_fragment>
const FS_ALBEDO = /* glsl */ `
vec3 rN = dot(vRockN, vRockN) > 1e-12 ? normalize(vRockN) : vec3(0.0, 1.0, 0.0);
vec3 rBw = pow(abs(rN), vec3(3.0));
rBw /= (rBw.x + rBw.y + rBw.z);
vec4 rD1 = rockTri(vRockW * 0.19, rBw);
vec4 rD2 = rockTri(vRockW * 0.61 + 0.37, rBw);
vec4 rD3 = rockTri(vRockW * 0.043 + 0.11, rBw);
vec4 rC = rockTri(vRockW * 0.045 + 0.71, rBw);
float rCanyon = vRockCtx.x;
// granite / weathered stone: broad, low-contrast variation
vec3 rCol = mix(r_graniteDark, r_granite, 0.3 + 0.55 * smoothstep(0.25, 0.75, rD3.b));
rCol = mix(rCol, r_graniteWarm, smoothstep(0.5, 0.8, rD1.b) * 0.35);
rCol *= 0.88 + 0.16 * rD1.b + 0.08 * rD2.b;
// sandstone strata in the canyon (same bands as the canyon walls)
float rB1 = 0.5 + 0.5 * sin(vRockW.y * 1.3 + rD1.b * 3.0);
float rB2 = 0.5 + 0.5 * sin(vRockW.y * 0.41 + 1.7 + rD3.b * 2.0);
vec3 rSand = mix(r_redRock, r_redRockLight, rB1 * 0.55 + rB2 * 0.45) * (0.86 + 0.24 * rD1.b);
rCol = mix(rCol, rSand, rCanyon);
// sun-bleached tops, darker undersides
rCol *= 0.86 + 0.24 * clamp(rN.y, -0.5, 1.0);
// bedding: faint horizontal strata on steep faces (matches the cliff bands)
float rSteep = 1.0 - smoothstep(0.35, 0.75, abs(rN.y));
float rBed = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(vRockW.y * 0.62 + rD1.b * 5.0));
rCol *= mix(1.0, 0.86 + 0.2 * rBed, rSteep * (1.0 - rCanyon));
// fractures (cells ≈ 0.9 m)
float rCrack = 1.0 - smoothstep(0.03, 0.11, rC.a);
rCol *= 1.0 - 0.32 * rCrack;
// moss on top in moist / forest areas
float rUp = smoothstep(0.3, 0.8, rN.y + (rD1.b - 0.5) * 0.5);
float rMoss = rUp * vRockCtx.y * smoothstep(0.35, 0.6, rD3.b + rD2.b * 0.3);
rCol = mix(rCol, mix(r_moss, r_mossLight, rD1.b), rMoss);
// a few broad lichen patches
float rLichen = smoothstep(0.64, 0.72, rD3.b + rD1.b * 0.12) * (1.0 - rCanyon) * 0.3;
rCol = mix(rCol, r_lichen, rLichen * (1.0 - rMoss));
// dust / dirt where the rock meets the ground
float rGround = 1.0 - smoothstep(0.0, 0.5 + rD1.b * 0.4, vRockCtx.w);
vec3 rDust = mix(r_dust, r_sandDust, vRockCtx.z);
rDust = mix(rDust, r_redRock * 1.15, rCanyon);
rCol = mix(rCol, rDust, rGround * 0.65);
// wet at the waterline
float rWet = 1.0 - smoothstep(0.05, 0.75, vRockW.y + rD2.b * 0.3);
rCol *= 1.0 - 0.5 * rWet;
diffuseColor.rgb = rCol;
float rRough = mix(0.88, 0.97, rMoss);
rRough = mix(rRough, 0.32, rWet);
`;

// after <normal_fragment_maps>: triplanar gradient bump (two scales) in world space
const FS_NORMAL = /* glsl */ `
{
  vec3 rNb = rockTriBump(vRockW, rN, rBw, 0.19, 1.1 * (1.0 - rMoss * 0.6));
  rNb = rockTriBump(vRockW + 0.37, rNb, rBw, 0.61, 0.55 * (1.0 - rMoss * 0.6));
  vec3 rV = (viewMatrix * vec4(rNb, 0.0)).xyz;
  normal = normalize(dot(rV, rV) > 1e-12 ? rV : normal);
}
`;

export function createRockMaterial(textures) {
  const uniforms = {
    tHeight: { value: textures.heightGrid },
    tNormal: { value: textures.normal },
    tSplatA: { value: textures.splatA },
    tSplatB: { value: textures.splatB },
    tDetail: { value: textures.detail },
  };
  for (const [k, v] of Object.entries(ROCK_PALETTE)) uniforms[`r_${k}`] = { value: new THREE.Color(v) };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true });
  mat.name = 'terrain-rock';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VS_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VS_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FS_PARS}`)
      .replace('#include <map_fragment>', FS_ALBEDO)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FS_NORMAL}`);
  };
  mat.customProgramCacheKey = () => 'terrain-rock-v5';
  return mat;
}
