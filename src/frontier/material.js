import * as THREE from 'three';
import { TERRAIN_PALETTE } from '../world/terrain/material.js';
import { detailTexture } from '../world/terrain/textures.js';

/**
 * Frontier terrain material — the hub terrain's look (src/world/terrain/material.js:
 * same palette, same grass ramp, triplanar rock + strata, snow, wet shore,
 * cavity AO, three-scale detail noise + bump) driven by per-vertex splats from
 * the worker instead of the hub's baked textures. MeshStandardMaterial +
 * onBeforeCompile, so the hub's lights, shadows, fog chunks and env map apply.
 *
 * Per-level materials share one program; only uMorph differs (geomorph range).
 * Detail scales are k / 1024 m⁻¹ and sampled with the block-local position, so
 * textures stay crisp and seamless at any distance from the origin.
 * Night: faint bioluminescent speckles on Lumen forest / jungle floors.
 */
const COLOR_UNIFORMS = Object.keys(TERRAIN_PALETTE).map((k) => `uniform vec3 c_${k};`).join('\n');

const VS_PARS = /* glsl */ `
attribute vec4 nc;
attribute vec4 splatA;
attribute vec4 splatB;
attribute vec4 splatC;
attribute float morph;
attribute vec2 rules;
uniform vec2 uMorph;
varying vec2 vRules;
varying vec2 vWrap;
varying vec3 vTerrainPos;
varying vec3 vNw;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec4 vSplatC;
varying float vCav;
`;

const VS_NORMAL = /* glsl */ `
vec3 objectNormal = nc.xyz * inversesqrt(max(dot(nc.xyz, nc.xyz), 1e-6));
`;

const VS_BEGIN = /* glsl */ `
vec3 transformed = position;
{
  vec4 fwp = modelMatrix * vec4(position, 1.0);
  transformed.y += morph * smoothstep(uMorph.x, uMorph.y, distance(cameraPosition, fwp.xyz));
}
vWrap = position.xz;
vNw = objectNormal;
vSplatA = splatA;
vSplatB = splatB;
vSplatC = splatC;
vCav = nc.w;
vRules = rules;
`;

const FS_PARS = /* glsl */ `
uniform sampler2D tDetail;
uniform float uNight;
uniform float uTime;
uniform float uOverlay;
uniform vec2 uCanopy;
${COLOR_UNIFORMS}
varying vec2 vWrap;
varying vec3 vTerrainPos;
varying vec3 vNw;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec4 vSplatC;
varying float vCav;
varying vec2 vRules;

float triDetail(vec3 p, vec3 w, float s) {
  return texture2D(tDetail, p.zy * s).b * w.x + texture2D(tDetail, p.xz * s).b * w.y + texture2D(tDetail, p.xy * s).b * w.z;
}
float triEdge(vec3 p, vec3 w, float s) {
  return texture2D(tDetail, p.zy * s).a * w.x + texture2D(tDetail, p.xz * s).a * w.y + texture2D(tDetail, p.xy * s).a * w.z;
}
vec3 triBump(vec3 p, vec3 n, vec3 w, float s, float k) {
  vec2 gx = texture2D(tDetail, p.zy * s).rg - 0.5;
  vec2 gy = texture2D(tDetail, p.xz * s).rg - 0.5;
  vec2 gz = texture2D(tDetail, p.xy * s).rg - 0.5;
  vec3 b = vec3(0.0, gx.y, gx.x) * w.x + vec3(gy.x, 0.0, gy.y) * w.y + vec3(gz.x, gz.y, 0.0) * w.z;
  return n - b * k;
}
vec3 biomeDebug(float id) {
  if (id < 0.5) return vec3(0.1, 0.3, 0.6);
  if (id < 1.5) return vec3(0.95, 0.85, 0.55);
  if (id < 2.5) return vec3(0.9, 0.75, 0.25);
  if (id < 3.5) return vec3(0.15, 0.5, 0.15);
  if (id < 4.5) return vec3(0.0, 0.35, 0.25);
  if (id < 5.5) return vec3(0.45, 0.75, 0.85);
  if (id < 6.5) return vec3(0.85, 0.35, 0.15);
  return vec3(1.0);
}
`;

// replaces <map_fragment>
const FS_TERRAIN = /* glsl */ `
vec3 tP = vTerrainPos;
// block-local copy of the position for texture lookups (precise far from the origin)
vec3 tQ = vec3(vWrap.x, tP.y, vWrap.y);
vec3 tNw = vNw * inversesqrt(max(dot(vNw, vNw), 1e-8));
vec4 tSa = vSplatA;
vec4 tSb = vSplatB;
vec3 tGeo = cross(dFdx(tP), dFdy(tP));
float tGeoL = dot(tGeo, tGeo);
tGeo = tGeoL > 1e-14 ? tGeo * inversesqrt(tGeoL) : tNw;
if (dot(tGeo, cameraPosition - tP) < 0.0) tGeo = -tGeo;
float tCliff = smoothstep(0.45, 0.75, 1.0 - tGeo.y);
tNw = mix(tNw, tGeo, tCliff);
tNw *= inversesqrt(max(dot(tNw, tNw), 1e-8));
float tSlope = 1.0 - tNw.y;
float tCav = vCav;
float tCamDist = distance(cameraPosition, tP);
float tMoist = vSplatC.r;
float tGolden = vSplatC.g;

vec4 tD1 = texture2D(tDetail, tQ.xz * 0.0712890625);
vec4 tD2 = texture2D(tDetail, tQ.xz * 0.009765625 + 0.31);
vec4 tD3 = texture2D(tDetail, tQ.xz * 0.3701171875 + 0.57);
float tMacro = tD2.b;
float tMeso = tD1.b;
float tMicro = tD3.b;

// grass: lush ↔ dry golden by moisture, macro noise, altitude, meadow gold; jungle deep green
float tDry = clamp(0.66 - tMoist * 0.8 + (tMacro - 0.5) * 1.1 + (tP.y - 35.0) * 0.003 + tGolden * 0.45, 0.0, 1.0);
vec3 tGrass = tDry < 0.5 ? mix(c_grassLush, c_grassOlive, tDry * 2.0) : mix(c_grassOlive, c_grassDry, tDry * 2.0 - 1.0);
tGrass = mix(tGrass, c_grassJungle, tSa.b);
tGrass *= (0.78 + 0.44 * tMeso) * (0.9 + 0.2 * tMicro);
tGrass = mix(tGrass, c_forestFloor, tSb.b * 0.7);

// bare earth: organic patches from smooth macro / meso noise (the cellular channel made polka dots and
// honeycombs at this scale), mostly on dry highland / badland ground; pebbles only up close
float tPatch = tMacro * 0.6 + tMeso * 0.4 + (tMicro - 0.5) * 0.06;
float tBare = smoothstep(0.6, 0.78, tPatch) * (0.1 + 0.42 * max(tSa.a, tSa.g)) * (1.0 - tSa.b) * (1.0 - tSb.b);
float tDirtW = clamp(max(tSa.a * smoothstep(0.34, 0.62, tPatch), tBare), 0.0, 1.0);
float tPebble = mix(0.5, tD3.a, 1.0 - smoothstep(5.0, 18.0, tCamDist));
vec3 tDirt = mix(c_dirt, c_gravel, tSa.a * 0.6) * (0.82 + 0.36 * tMicro) * (0.95 + 0.1 * tPebble);
vec3 col = mix(tGrass, tDirt, tDirtW);

// badlands: dry red soil with darker wind-swept patches and pale caliche flats
vec3 tRedSoil = mix(c_redSand, c_redSandDark, tMacro) * (0.88 + 0.24 * tMeso) * (0.88 + 0.24 * smoothstep(0.3, 0.7, tPatch));
tRedSoil = mix(tRedSoil, c_redRockLight * 0.92, smoothstep(0.64, 0.82, tPatch) * 0.35);
col = mix(col, tRedSoil, tSa.g * 0.92);

// sand (beaches, river gravel)
vec3 tSand = mix(c_sand, c_redSand, tSa.g) * (0.88 + 0.22 * tMicro);
col = mix(col, tSand, tSa.r);

// rock: slope + override, triplanar detail, layering, streaks, joints; red strata in the badlands
vec3 tBw = abs(tNw);
tBw *= tBw;
tBw *= tBw;
tBw /= max(tBw.x + tBw.y + tBw.z, 1e-5);
float tTri = triDetail(tQ, tBw, 0.08984375);
float tTri2 = triDetail(tQ, tBw, 0.41015625);
float tTri3 = triDetail(tQ, tBw, 1.3701171875);
float tRockW = smoothstep(0.3, 0.5, tSlope + (tMeso - 0.5) * 0.2);
// rock slabs on rocky ground: organic patches (the cellular channel tiled flat ground into a honeycomb)
float tSlab = smoothstep(0.5, 0.64, tMacro * 0.5 + tMeso * 0.42 + tD2.a * 0.08);
float tOver = max(smoothstep(0.9, 1.0, tSb.r), tSb.r * tSlab);
tRockW = max(max(tRockW, tOver), tCliff);
// layering: wavy, and faded out with distance / when a band gets thinner than ~2 px (contour-line look)
float tYw = fwidth(tP.y);
float tLayer = smoothstep(0.3, 0.7, 0.5 + 0.5 * sin(tP.y * 0.62 + tTri * 5.0 + tMacro * 6.0));
tLayer = mix(0.5, tLayer, (1.0 - smoothstep(110.0, 420.0, tCamDist)) * (1.0 - smoothstep(0.5, 1.4, tYw * 0.62)));
vec3 tRock = mix(c_rockDark, c_rock, 0.2 + 0.42 * tTri + 0.18 * tLayer);
tRock *= 0.84 + 0.2 * tTri2 + 0.14 * tTri3;
float tStreak = texture2D(tDetail, vec2((tQ.x + tQ.z) * 0.044921875, tP.y * 0.004)).b;
tRock *= mix(1.0, 0.7 + 0.55 * tStreak, tCliff);
float tJoint = (1.0 - smoothstep(0.02, 0.1, triEdge(tQ, tBw, 0.0166015625))) * smoothstep(0.38, 0.7, tSlope);
tRock *= 1.0 - 0.38 * tJoint;
float tBand = mix(0.5, 0.5 + 0.5 * sin(tP.y * 1.3 + tTri * 3.0), 1.0 - smoothstep(0.6, 1.6, tYw * 1.3));
float tBand2 = mix(0.5, 0.5 + 0.5 * sin(tP.y * 0.41 + 1.7 + tMacro * 2.0), 1.0 - smoothstep(0.6, 1.6, tYw * 0.41));
vec3 tStrata = mix(c_redRock, c_redRockLight, tBand * 0.55 + tBand2 * 0.45) * (0.8 + 0.4 * tTri2) * (1.0 - 0.3 * tJoint);
tRock = mix(tRock, tStrata, tSa.g);
// Crystal Highlands: cooler, paler stone
tRock = mix(tRock, tRock * vec3(0.92, 1.0, 1.08) * 1.08, vSplatC.b * 0.6);
// high ground away from the hub ring: paler, sunlit granite (the hub's dark stone stays at the seam)
float tHubFar = smoothstep(150.0, 650.0, max(abs(tP.x), abs(tP.z)) - 1200.0);
float tAlp = smoothstep(120.0, 380.0, tP.y) * tHubFar * (1.0 - tSa.g);
tRock = mix(tRock, tRock * vec3(1.36, 1.37, 1.42) + vec3(0.025, 0.026, 0.032), tAlp);
tRock = mix(tRock, tDirt * 0.75, (1.0 - tSlab) * smoothstep(0.35, 0.65, tMeso) * tSb.r * (1.0 - tCliff) * 0.45);
col = mix(col, tRock, tRockW);

// snow (climate-zone snow line from the worker, broken up by noise, off the cliffs)
float tSnow = smoothstep(0.35, 0.65, tSb.a + (tMacro - 0.5) * 0.5 + (tMeso - 0.5) * 0.2) * (1.0 - smoothstep(0.26, 0.48, tSlope + (tMeso - 0.5) * 0.12));
// (×0.78: the hub's exposure is tuned for grass and stone; full-albedo snow blooms into a white haze)
col = mix(col, c_snow * (0.64 + 0.08 * tMicro), tSnow);

// distant forests: beyond the streamed trees the forest floor reads as canopy (clumped dark greens)
float tCanopy = tSb.b * smoothstep(uCanopy.x, uCanopy.y, tCamDist) * (1.0 - tRockW) * (1.0 - tSnow);
float tClump = smoothstep(0.35, 0.62, tMacro * 0.7 + tMeso * 0.5 - 0.1);
vec3 tCanCol = mix(vec3(0.03, 0.062, 0.022), vec3(0.068, 0.11, 0.035), tMeso) * (0.82 + 0.36 * tMicro);
tCanCol = mix(tCanCol, vec3(0.025, 0.07, 0.04), tSa.b);
col = mix(col, tCanCol, tCanopy * (0.5 + 0.42 * tClump));

// waterline: wet darkening, lake bed under water
float tWet = tSb.g;
float tUnder = smoothstep(0.05, -2.5, tP.y);
col *= 1.0 - 0.42 * tWet;
col = mix(col, c_lakeBed * (0.75 + 0.5 * tMeso), tUnder * 0.75);

// cavity AO
col *= clamp(1.0 - tCav * 0.45, 0.55, 1.18);
if (uOverlay > 1.5) {
  // §11.2 build rules: hatched where building is refused (orange hub buffer, red highway corridor,
  // violet POI clearance), faint green where it is allowed
  float tCode = vRules.y * 255.0 / 63.0;
  vec3 tRc = tCode < 1.5 ? vec3(0.85, 0.9, 1.0) : tCode < 2.5 ? vec3(1.0, 0.5, 0.12) : tCode < 3.5 ? vec3(1.0, 0.12, 0.16) : vec3(0.72, 0.28, 1.0);
  float tHatch = 0.65 + 0.35 * step(0.5, fract((tQ.x + tQ.z) * 0.0625));
  float tNo = smoothstep(0.35, 0.65, vRules.x);
  col = mix(mix(col, vec3(0.3, 0.85, 0.35), 0.18), mix(col, tRc, 0.62 * tHatch), tNo);
} else if (uOverlay > 0.5) col = mix(col, biomeDebug(floor(vSplatC.a * 255.0 / 32.0 + 0.5)), 0.65);
diffuseColor.rgb = col;

float tRough = mix(0.95, 0.84, tRockW);
tRough = mix(tRough, 0.26, tWet * (1.0 - tUnder * 0.6));
tRough = mix(tRough, 0.7, tSnow);

vec4 tD4 = texture2D(tDetail, tQ.xz * 1.900390625 + 0.13);
float tNear = 1.0 - smoothstep(25.0, 70.0, tCamDist);
vec2 tG = (tD1.rg - 0.5) * 0.1 + (tD3.rg - 0.5) * 0.3 + (tD4.rg - 0.5) * 0.28 * tNear;
vec3 tNd = normalize(tNw + vec3(tG.x, 0.0, tG.y) * (0.5 + 0.3 * tRockW) * (1.0 - tWet * 0.6) * (1.0 - tCliff) * (1.0 - 0.7 * tSnow));
float tRb = tRockW * (1.0 - smoothstep(60.0, 220.0, tCamDist));
tNd = normalize(triBump(tQ, tNd, tBw, 0.08984375, 0.9 * tRb));
tNd = normalize(triBump(tQ + 0.31, tNd, tBw, 0.41015625, 0.45 * tRb));

// bioluminescent speckles on Lumen forest / jungle floors at night (HDR, bloom picks them up)
// three scales so the glow survives mip-mapping: crack lines up close, moss dots, soft carpets far away
float tGlowMask = (tSb.b * 0.6 + tSa.b) * (1.0 - tRockW) * (1.0 - tSnow) * (1.0 - tUnder) * uNight;
float tSpots = smoothstep(0.035, 0.0, tD3.a) * smoothstep(0.45, 0.8, tMeso);
float tDots = smoothstep(0.88, 0.98, tD1.a) * smoothstep(0.5, 0.72, tMacro + (tMeso - 0.5) * 0.4);
float tCarpet = smoothstep(0.52, 0.72, tMacro + (tMeso - 0.5) * 0.3);
float tPulse = 0.75 + 0.25 * sin(uTime * 1.3 + tMacro * 20.0);
vec3 tGlow = mix(vec3(0.08, 0.8, 1.0), vec3(0.55, 0.16, 1.0), smoothstep(0.35, 0.65, tD2.b)) * (tSpots * 1.4 + tDots * 0.35 + tCarpet * 0.05) * tGlowMask * tPulse;
`;

const FS_NORMAL = /* glsl */ `
float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
vec3 normal = normalize((viewMatrix * vec4(tNd, 0.0)).xyz);
vec3 nonPerturbedNormal = normal;
`;

/** Shared uniforms (one detail texture, palette, night / time / overlay). */
export function createFrontierTerrainUniforms(detail = null) {
  const u = {
    tDetail: { value: detail || detailTexture(256, 11) },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uOverlay: { value: 0 },
    // camera distance over which forest floors turn into canopy colour (set from the vegetation radius)
    uCanopy: { value: new THREE.Vector2(550, 950) },
  };
  for (const [k, v] of Object.entries(TERRAIN_PALETTE)) u[`c_${k}`] = { value: new THREE.Color(v) };
  return u;
}

/** One material per LOD level (shared program); `morph` = [start, end] camera distance. */
export function createFrontierTerrainMaterial(uniforms, morph) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const lod = { uMorph: { value: new THREE.Vector2(morph[0], morph[1]) } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, lod);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VS_PARS}`)
      .replace('#include <beginnormal_vertex>', VS_NORMAL)
      .replace('#include <begin_vertex>', VS_BEGIN)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FS_PARS}`)
      .replace('#include <map_fragment>', FS_TERRAIN)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_begin>', FS_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tGlow;');
  };
  mat.customProgramCacheKey = () => 'frontier-terrain-v3';
  mat.name = 'frontier-terrain';
  mat.userData.lod = lod;
  return mat;
}
