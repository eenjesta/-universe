import * as THREE from 'three';
import { SUNVIS_PARS, patchKeyLight } from './sunvis.js';

/**
 * Terrain material: MeshStandardMaterial (lights, shadows, fog, env map for
 * free) extended with onBeforeCompile.
 *
 * Vertex: chunks are flat grids; the height comes from the exact R32F grid
 * (texelFetch + manual bilinear), with CDLOD-style geomorphing toward the next
 * coarser grid by camera distance so LOD switches don't pop. Skirt vertices
 * carry a negative local y.
 *
 * Fragment: world-space normal from the normal texture (independent of the
 * LOD mesh), splat blend of warm/dry/lush grass, forest floor, dirt, sand,
 * red canyon soil, triplanar rock with sandstone strata in the canyon, snow
 * on the highest peaks, wet darkening + gloss at the waterline, cavity AO and
 * procedural detail noise at three scales. The key light is attenuated by the
 * baked terrain sun-visibility map (long hill shadows, see sunvis.js).
 *
 * All LOD materials share one program (same source); only uLodStep / uMorph
 * differ per material.
 */

export const TERRAIN_PALETTE = {
  grassLush: '#4a6626',
  grassOlive: '#6e6e30',
  grassDry: '#a88f48',
  grassJungle: '#2c5a2e',
  forestFloor: '#3a3020',
  dirt: '#6e5539',
  gravel: '#7d7060',
  sand: '#c8ae82',
  redSand: '#c47a48',
  redSandDark: '#9a5532',
  rock: '#6f675e',
  rockDark: '#36312c',
  redRock: '#a5532c',
  redRockLight: '#d69a66',
  snow: '#eeeaf0',
  lakeBed: '#4d4632',
};

export function createTerrainUniforms(textures, sunUniforms = null) {
  const u = {
    tHeight: { value: textures.heightGrid },
    tNormal: { value: textures.normal },
    tSplatA: { value: textures.splatA },
    tSplatB: { value: textures.splatB },
    tDetail: { value: textures.detail },
    uTime: { value: 0 },
    // shared with sunvis.js (white until the first bake)
    tSunVis: sunUniforms?.tSunVis ?? { value: null },
    uSunVisOn: sunUniforms?.uSunVisOn ?? { value: 0 },
  };
  for (const [k, v] of Object.entries(TERRAIN_PALETTE)) u[`c_${k}`] = { value: new THREE.Color(v) };
  return u;
}

const COLOR_UNIFORMS = Object.keys(TERRAIN_PALETTE).map((k) => `uniform vec3 c_${k};`).join('\n');

const VS_PARS = /* glsl */ `
uniform highp sampler2D tHeight;
uniform sampler2D tNormal;
uniform float uLodStep;
uniform vec2 uMorph;
varying vec3 vTerrainPos;

float terrainHeight(vec2 g) {
  g = clamp(g, vec2(0.0), vec2(1200.0));
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

// replaces <beginnormal_vertex>: displacement + morph, object normal
const VS_TERRAIN = /* glsl */ `
vec4 tW0 = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);
vec2 tGrid = (tW0.xz + 1200.0) * 0.5;
float tH0 = terrainHeight(tGrid);
float tDist = distance(cameraPosition, vec3(tW0.x, tH0, tW0.z));
float tMorph = smoothstep(uMorph.x, uMorph.y, tDist);
vec2 tOdd = step(0.5, fract(tGrid / (2.0 * uLodStep) + 0.001));
tGrid -= tOdd * uLodStep * tMorph;
float tH = terrainHeight(tGrid);
vec3 tLocal = vec3(position.x + (tGrid.x * 2.0 - 1200.0) - tW0.x, tH + position.y, position.z + (tGrid.y * 2.0 - 1200.0) - tW0.z);
vec4 tNs = textureLod(tNormal, (tGrid + 0.5) / 1201.0, 0.0);
vec3 objectNormal = vec3(tNs.r * 2.0 - 1.0, 0.0, tNs.g * 2.0 - 1.0);
objectNormal.y = sqrt(max(0.0, 1.0 - dot(objectNormal.xz, objectNormal.xz)));
`;

const FS_PARS = /* glsl */ `
${SUNVIS_PARS}
uniform sampler2D tNormal;
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform sampler2D tDetail;
${COLOR_UNIFORMS}
varying vec3 vTerrainPos;

float triDetail(vec3 p, vec3 w, float s) {
  return texture2D(tDetail, p.zy * s).b * w.x + texture2D(tDetail, p.xz * s).b * w.y + texture2D(tDetail, p.xy * s).b * w.z;
}
float triEdge(vec3 p, vec3 w, float s) {
  return texture2D(tDetail, p.zy * s).a * w.x + texture2D(tDetail, p.xz * s).a * w.y + texture2D(tDetail, p.xy * s).a * w.z;
}
// triplanar bump from the detail texture's stored gradients (R, G), UDN blend
vec3 triBump(vec3 p, vec3 n, vec3 w, float s, float k) {
  vec2 gx = texture2D(tDetail, p.zy * s).rg - 0.5;
  vec2 gy = texture2D(tDetail, p.xz * s).rg - 0.5;
  vec2 gz = texture2D(tDetail, p.xy * s).rg - 0.5;
  vec3 b = vec3(0.0, gx.y, gx.x) * w.x + vec3(gy.x, 0.0, gy.y) * w.y + vec3(gz.x, gz.y, 0.0) * w.z;
  return n - b * k;
}
`;

// replaces <map_fragment>: albedo, roughness and world normal
const FS_TERRAIN = /* glsl */ `
vec3 tP = vTerrainPos;
vec2 tUv = (tP.xz + 1201.0) / 2402.0;
vec4 tNt = texture2D(tNormal, tUv);
vec3 tNw = vec3(tNt.r * 2.0 - 1.0, 0.0, tNt.g * 2.0 - 1.0);
tNw.y = sqrt(max(0.0, 1.0 - dot(tNw.xz, tNw.xz)));
vec4 tSa = texture2D(tSplatA, tUv);
vec4 tSb = texture2D(tSplatB, tUv);
// exact triangle normal: on cliffs the 2 m XZ textures smear into vertical
// stripes, so steep faces take their slope, triplanar axes and shading from it
vec3 tGeo = cross(dFdx(tP), dFdy(tP));
float tGeoL = dot(tGeo, tGeo);
tGeo = tGeoL > 1e-14 ? tGeo * inversesqrt(tGeoL) : tNw;
if (dot(tGeo, cameraPosition - tP) < 0.0) tGeo = -tGeo;
float tCliff = smoothstep(0.45, 0.75, 1.0 - tGeo.y);
tNw = normalize(mix(tNw, tGeo, tCliff));
float tSlope = 1.0 - tNw.y;
float tCav = tNt.b * 2.0 - 1.0;
float tCamDist = distance(cameraPosition, tP);
float tMoist = tNt.a;

vec4 tD1 = texture2D(tDetail, tP.xz * 0.071);
vec4 tD2 = texture2D(tDetail, tP.xz * 0.0093 + 0.31);
vec4 tD3 = texture2D(tDetail, tP.xz * 0.37 + 0.57);
float tMacro = tD2.b;
float tMeso = tD1.b;
float tMicro = tD3.b;

// grass: lush ↔ dry golden by moisture, macro noise and altitude; jungle deep green
float tDry = clamp(0.66 - tMoist * 0.8 + (tMacro - 0.5) * 1.1 + (tP.y - 35.0) * 0.004, 0.0, 1.0);
// three stops: fresh green → olive → golden (the grass blades use the same ramp)
vec3 tGrass = tDry < 0.5 ? mix(c_grassLush, c_grassOlive, tDry * 2.0) : mix(c_grassOlive, c_grassDry, tDry * 2.0 - 1.0);
tGrass = mix(tGrass, c_grassJungle, tSa.b);
// clumps (~14 m) and tufts (~3 m)
tGrass *= (0.78 + 0.44 * tMeso) * (0.9 + 0.2 * tMicro);
tGrass = mix(tGrass, c_forestFloor, tSb.a * 0.7);

// bare earth: pads, shoulders and natural patches
float tBare = smoothstep(0.7, 0.86, tD2.a * 0.7 + tMeso * 0.45) * 0.55 * (1.0 - tSa.b) * (1.0 - tSb.a);
float tDirtW = clamp(max(tSa.a, tBare), 0.0, 1.0);
vec3 tDirt = mix(c_dirt, c_gravel, tSa.a * 0.6) * (0.82 + 0.36 * tMicro) * (0.9 + 0.2 * tD3.a);
vec3 col = mix(tGrass, tDirt, tDirtW);

// canyon: dry red soil
vec3 tRedSoil = mix(c_redSand, c_redSandDark, tMacro) * (0.88 + 0.24 * tMeso);
col = mix(col, tRedSoil, tSa.g * 0.92);

// sand (beaches, river gravel, canyon flats)
vec3 tSand = mix(c_sand, c_redSand, tSa.g) * (0.88 + 0.22 * tMicro);
col = mix(col, tSand, tSa.r);

// rock: slope + override, triplanar detail, sheet layering, streaks, joints;
// sandstone strata in the canyon
vec3 tBw = pow(abs(tNw), vec3(4.0));
tBw /= (tBw.x + tBw.y + tBw.z);
float tTri = triDetail(tP, tBw, 0.09);
float tTri2 = triDetail(tP, tBw, 0.41);
float tTri3 = triDetail(tP, tBw, 1.37);
float tRockW = smoothstep(0.3, 0.5, tSlope + (tMeso - 0.5) * 0.2);
// partial overrides (outcrops, high slopes) break into slabs with soil in the cracks
float tSlab = smoothstep(0.1, 0.32, tD2.a + (tMeso - 0.5) * 0.15);
float tOver = max(smoothstep(0.9, 1.0, tSb.r), tSb.r * tSlab);
tRockW = max(max(tRockW, tOver), tCliff);
float tLayer = smoothstep(0.3, 0.7, 0.5 + 0.5 * sin(tP.y * 0.62 + tTri * 5.0));
vec3 tRock = mix(c_rockDark, c_rock, 0.2 + 0.42 * tTri + 0.18 * tLayer);
tRock *= 0.84 + 0.2 * tTri2 + 0.14 * tTri3;
// vertical water staining on steep faces
float tStreak = texture2D(tDetail, vec2((tP.x + tP.z) * 0.045, tP.y * 0.004)).b;
tRock *= mix(1.0, 0.7 + 0.55 * tStreak, tCliff);
// joints (cellular cracks ~2.5 m apart) on steep faces only
float tJoint = (1.0 - smoothstep(0.02, 0.1, triEdge(tP, tBw, 0.017))) * smoothstep(0.38, 0.7, tSlope);
tRock *= 1.0 - 0.38 * tJoint;
float tBand = 0.5 + 0.5 * sin(tP.y * 1.3 + tTri * 3.0);
float tBand2 = 0.5 + 0.5 * sin(tP.y * 0.41 + 1.7 + tMacro * 2.0);
vec3 tStrata = mix(c_redRock, c_redRockLight, tBand * 0.55 + tBand2 * 0.45) * (0.8 + 0.4 * tTri2) * (1.0 - 0.3 * tJoint);
tRock = mix(tRock, tStrata, tSa.g);
// soil-filled cracks between outcrop slabs
tRock = mix(tRock, tDirt * 0.75, (1.0 - tSlab) * smoothstep(0.35, 0.65, tMeso) * tSb.r * (1.0 - tCliff) * 0.45);
col = mix(col, tRock, tRockW);

// snow on the highest peaks
float tSnow = smoothstep(305.0, 360.0, tP.y + tMacro * 50.0) * (1.0 - smoothstep(0.42, 0.68, tSlope));
col = mix(col, c_snow, tSnow);

// waterline: wet darkening, lake bed under water
float tWet = tSb.g;
float tUnder = smoothstep(0.05, -2.5, tP.y);
col *= 1.0 - 0.42 * tWet;
col = mix(col, c_lakeBed * (0.75 + 0.5 * tMeso), tUnder * 0.75);

// cavity AO
col *= clamp(1.0 - tCav * 0.45, 0.55, 1.18);
diffuseColor.rgb = col;

float tRough = mix(0.95, 0.84, tRockW);
tRough = mix(tRough, 0.26, tWet * (1.0 - tUnder * 0.6));
tRough = mix(tRough, 0.7, tSnow);

// detail bump: texture gradients on gentle ground, triplanar relief on rock.
// The low sun (~5°) turns any broad tilt into a lit/unlit blotch, so the
// relief energy sits in the fine scales (clumps ~2.7 m, tufts ~0.5 m) that
// read as texture; the 14 m layer only adds a whisper.
vec4 tD4 = texture2D(tDetail, tP.xz * 1.9 + 0.13);
float tNear = 1.0 - smoothstep(25.0, 70.0, tCamDist);
vec2 tG = (tD1.rg - 0.5) * 0.1 + (tD3.rg - 0.5) * 0.3 + (tD4.rg - 0.5) * 0.28 * tNear;
vec3 tNd = normalize(tNw + vec3(tG.x, 0.0, tG.y) * (0.5 + 0.3 * tRockW) * (1.0 - tWet * 0.6) * (1.0 - tCliff));
float tRb = tRockW * (1.0 - smoothstep(60.0, 220.0, tCamDist));
tNd = normalize(triBump(tP, tNd, tBw, 0.09, 0.9 * tRb));
tNd = normalize(triBump(tP + 0.31, tNd, tBw, 0.41, 0.45 * tRb));
// long terrain shadows (hills, ridges, cliffs) from the baked visibility map
float tSunVisF = terrainSunVis(tP.xz);
`;

const FS_NORMAL = /* glsl */ `
float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
vec3 normal = normalize((viewMatrix * vec4(tNd, 0.0)).xyz);
vec3 nonPerturbedNormal = normal;
`;

function patchTerrainShader(shader, uniforms, lod) {
  Object.assign(shader.uniforms, uniforms, lod);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VS_PARS}`)
    .replace('#include <beginnormal_vertex>', VS_TERRAIN)
    .replace('#include <begin_vertex>', 'vec3 transformed = tLocal;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FS_PARS}`)
    .replace('#include <map_fragment>', FS_TERRAIN)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
    .replace('#include <normal_fragment_begin>', FS_NORMAL);
  patchKeyLight(shader, 'tSunVisF');
}

/**
 * One material per LOD level (shared program). `lodStep` = grid samples per
 * vertex; `morph` = [start, end] camera distance of the geomorph.
 */
export function createTerrainMaterial(uniforms, lodStep, morph) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const lod = {
    uLodStep: { value: lodStep },
    uMorph: { value: new THREE.Vector2(morph[0], morph[1]) },
  };
  mat.onBeforeCompile = (shader) => patchTerrainShader(shader, uniforms, lod);
  mat.customProgramCacheKey = () => 'terrain-v7';
  mat.name = `terrain-lod${lodStep}`;
  mat.userData.lod = lod;
  return mat;
}
