import * as THREE from 'three';
import { Rng } from '../../core/math.js';
import { TERRAIN_PALETTE } from './material.js';

/**
 * GPU grass around the camera (no per-frame CPU work).
 *
 * Two rings of instanced tufts on world-anchored grids: an inner dense ring
 * (multi-segment blades) and an outer sparse ring (single-triangle blades).
 * The vertex shader places every tuft from its world cell index (stable
 * jitter / rotation / size hashes, so blades never swim as the camera moves),
 * samples the exact height grid, the grass-density splat (0 on rock, sand,
 * roads, pads, water…) and the moisture, bends the blades in gusting wind
 * and fades them out toward the ring radius. Colours follow the terrain's
 * own lush ↔ dry grass blend so the fade-out is invisible; tips glow when
 * backlit by a low sun.
 *
 * Density comes from ctx.engine.quality.grassDensity (cell size ∝ 1/√density).
 */
export function createGrass(textures, quality, { sunVis = null } = {}) {
  const shared = {
    tHeight: { value: textures.heightGrid },
    tNormal: { value: textures.normal },
    tSplatA: { value: textures.splatA },
    tSplatB: { value: textures.splatB },
    tDetail: { value: textures.detail },
    uTime: { value: 0 },
    uWind: { value: 1 },
    uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0, 0, 0) },
    c_grassLush: { value: new THREE.Color(TERRAIN_PALETTE.grassLush) },
    c_grassOlive: { value: new THREE.Color(TERRAIN_PALETTE.grassOlive) },
    c_grassDry: { value: new THREE.Color(TERRAIN_PALETTE.grassDry) },
    c_grassJungle: { value: new THREE.Color(TERRAIN_PALETTE.grassJungle) },
  };
  const group = new THREE.Group();
  group.name = 'grass';
  const rings = [];

  function build(q) {
    for (const r of rings) {
      group.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    }
    rings.length = 0;
    const d = Math.max(0.05, q?.grassDensity ?? 1);
    const k = 1 / Math.sqrt(d);
    rings.push(makeRing({ cell: 0.62 * k, radius: 30, inner: 0, blades: 5, segments: 3, height: 0.62, seed: 'grass-inner' }));
    if (d > 0.3) rings.push(makeRing({ cell: 1.25 * k, radius: 86, inner: 26, blades: 3, segments: 1, height: 0.66, seed: 'grass-outer' }));
    for (const r of rings) group.add(r.mesh);
  }

  function makeRing({ cell, radius, inner, blades, segments, height, seed }) {
    const n = Math.ceil(radius / cell);
    const side = n * 2 + 1;
    const cells = new Float32Array(side * side * 2);
    let c = 0;
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const dd = Math.hypot(i, j) * cell;
        if (dd > radius + cell * 1.5 || (inner > 0 && dd < inner - cell * 2)) continue;
        cells[c++] = i;
        cells[c++] = j;
      }
    }
    const geo = tuftGeometry(blades, segments, seed);
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = geo.index;
    for (const [name, attr] of Object.entries(geo.attributes)) ig.setAttribute(name, attr);
    ig.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells.slice(0, c), 2));
    ig.instanceCount = c / 2;
    ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const uniforms = { ...shared, uCenter: { value: new THREE.Vector3() }, uCell: { value: cell }, uRadius: { value: radius }, uInner: { value: inner }, uHeight: { value: height } };
    const mat = grassMaterial(uniforms);
    if (sunVis) sunVis.applySunVisibility(mat);
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = `grass-${seed}`;
    mesh.raycast = () => {};
    return { mesh, uniforms, cell, count: c / 2, tris: (geo.index.count / 3) * (c / 2) };
  }

  build(quality);

  return {
    group,
    shared,
    rings,
    setQuality: build,
    /** Per frame: follow the camera, time, sun. */
    update(t, camPos, world) {
      shared.uTime.value = t;
      for (const r of rings) r.uniforms.uCenter.value.copy(camPos);
      if (world?.sun && world.sunDirection) {
        shared.uSunDirW.value.copy(world.sunDirection).normalize();
        const up = Math.max(0, world.sunDirection.y);
        const k = 0.55 * (1 - Math.min(1, up * 1.6)) * Math.min(1, up * 12 + 0.05);
        shared.uSunColor.value.copy(world.sun.color).multiplyScalar(world.sun.intensity * k);
      }
    },
    stats() {
      return rings.map((r) => ({ instances: r.count, tris: r.tris, cell: +r.cell.toFixed(2) }));
    },
  };
}

/** A tuft of tapered, pre-curved blades (local y 0..1, `uv.y` = height fraction). */
function tuftGeometry(blades, segments, seed) {
  const rng = new Rng(seed);
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rng.random() * Math.PI * 2;
    const r = Math.sqrt(rng.random()) * 0.22;
    const ox = Math.cos(a) * r;
    const oz = Math.sin(a) * r;
    const face = rng.random() * Math.PI * 2;
    const fx = Math.cos(face);
    const fz = Math.sin(face);
    const lean = 0.15 + rng.random() * 0.35;
    const hgt = 0.65 + rng.random() * 0.5;
    const w = 0.028 + rng.random() * 0.02;
    const base = pos.length / 3;
    const rows = segments + 1;
    for (let k = 0; k < rows; k++) {
      const t = k / segments;
      const y = t * hgt;
      const bend = lean * t * t;
      const cx = ox + -fz * bend;
      const cz = oz + fx * bend;
      if (k === rows - 1) {
        pos.push(cx, y, cz);
        nor.push(-fz * 0.4, 1, fx * 0.4);
        uv.push(0.5, t);
      } else {
        const ww = w * (1 - t * 0.7);
        pos.push(cx - fx * ww, y, cz - fz * ww, cx + fx * ww, y, cz + fz * ww);
        nor.push(-fz * 0.4, 1, fx * 0.4, -fz * 0.4, 1, fx * 0.4);
        uv.push(0, t, 1, t);
      }
    }
    for (let k = 0; k < segments; k++) {
      const a0 = base + k * 2;
      if (k === segments - 1) idx.push(a0, a0 + 1, a0 + 2);
      else idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const GRASS_VS_PARS = /* glsl */ `
attribute vec2 aCell;
uniform highp sampler2D tHeight;
uniform sampler2D tNormal;
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform sampler2D tDetail;
uniform vec3 uCenter;
uniform float uCell;
uniform float uRadius;
uniform float uInner;
uniform float uHeight;
uniform float uTime;
uniform float uWind;
uniform vec3 c_grassLush;
uniform vec3 c_grassOlive;
uniform vec3 c_grassDry;
uniform vec3 c_grassJungle;
varying vec3 vGrassColor;
varying float vGrassT;

float gHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float gHeight(vec2 g) {
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

// replaces <beginnormal_vertex> (runs before begin_vertex)
const GRASS_VS = /* glsl */ `
vec2 gCell = floor(uCenter.xz / uCell) + aCell;
vec2 gXZ = (gCell + vec2(gHash(gCell), gHash(gCell + 17.3))) * uCell;
float gDist = distance(gXZ, uCenter.xz);
vec2 gUv = (gXZ + 1201.0) / 2402.0;
vec4 gSb = textureLod(tSplatB, gUv, 0.0);
vec4 gSa = textureLod(tSplatA, gUv, 0.0);
vec4 gNt = textureLod(tNormal, gUv, 0.0);
float gKeep = step(gHash(gCell + 5.7), gSb.b * 1.05);
float gFade = 1.0 - smoothstep(uRadius * 0.7, uRadius, gDist);
float gIn = uInner > 0.0 ? smoothstep(uInner - 3.0, uInner + 1.0, gDist) : 1.0;
// meadow clumps: taller, denser patches
float gClump = textureLod(tDetail, gXZ * 0.045, 0.0).b;
// the hub height grid only covers ±1200 m: outside it the infinite world (src/frontier) has its own
// grass — hub grass out there would sit at clamped edge heights and float above the real terrain
float gHub = 1.0 - step(1190.0, max(abs(gXZ.x), abs(gXZ.y)));
float gS = gHub * gKeep * gFade * gIn * (0.55 + 0.9 * gHash(gCell + 3.1)) * (0.6 + 0.8 * gClump) * (0.7 + 0.5 * gSa.b);
float gRot = gHash(gCell + 9.2) * 6.2831;
float gc = cos(gRot);
float gs = sin(gRot);
vec3 gP = position;
gP.y *= uHeight * (0.7 + 0.6 * gNt.a) * gS;
gP.xz *= step(0.001, gS) * (0.8 + 0.4 * gS);
// wind: travelling gusts + flutter, stronger toward the tip
float gT = uv.y;
float gGust = 0.55 + 0.45 * sin(uTime * 0.6 + gXZ.x * 0.035 + gXZ.y * 0.02);
float gW = (sin(uTime * 1.9 + gXZ.x * 0.21 + gXZ.y * 0.13) * 0.6 + sin(uTime * 3.7 + gXZ.x * 0.7) * 0.25) * gGust * uWind;
gP.x += gW * gT * gT * 0.32 * uHeight;
gP.z += gW * gT * gT * 0.18 * uHeight;
vec3 gR = vec3(gP.x * gc - gP.z * gs, gP.y, gP.x * gs + gP.z * gc);
float gH = gHeight((gXZ + 1200.0) * 0.5);
vec3 gWorld = vec3(gXZ.x, gH - 0.04, gXZ.y) + gR;
// terrain-matched colour (same lush ↔ dry blend as the ground material)
float gMacro = textureLod(tDetail, gXZ * 0.0093 + 0.31, 0.0).b;
float gDry = clamp(0.66 - gNt.a * 0.8 + (gMacro - 0.5) * 1.1 + (gH - 35.0) * 0.004, 0.0, 1.0);
vec3 gCol = gDry < 0.5 ? mix(c_grassLush, c_grassOlive, gDry * 2.0) : mix(c_grassOlive, c_grassDry, gDry * 2.0 - 1.0);
gCol = mix(gCol, c_grassJungle, gSa.b);
gCol *= 0.85 + 0.3 * gHash(gCell + 1.3);
vGrassColor = gCol;
vGrassT = gT;
vec3 gTerrN = vec3(gNt.r * 2.0 - 1.0, 0.0, gNt.g * 2.0 - 1.0);
gTerrN.y = sqrt(max(0.0, 1.0 - dot(gTerrN.xz, gTerrN.xz)));
vec3 objectNormal = normalize(gTerrN * 1.2 + vec3(normal.x * gc - normal.z * gs, normal.y, normal.x * gs + normal.z * gc) * 0.6);
`;

function grassMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GRASS_VS_PARS}`)
      .replace('#include <beginnormal_vertex>', GRASS_VS)
      .replace('#include <begin_vertex>', 'vec3 transformed = gWorld;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassColor;\nvarying float vGrassT;\nuniform vec3 uSunDirW;\nuniform vec3 uSunColor;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb = vGrassColor * mix(0.42, 1.15, vGrassT);')
      .replace('normal *= faceDirection;', '')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 vdir = normalize(vViewPosition);
          vec3 sunView = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
          float tr = pow(max(0.0, dot(-vdir, sunView)), 3.0) * vGrassT * vGrassT;
#ifdef TERRAIN_SUNVIS
          tr *= vSunVis; // no backlit glow inside terrain shadow
#endif
          totalEmissiveRadiance += vGrassColor * uSunColor * tr * 1.8;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-grass-v3';
  mat.name = 'terrain-grass';
  return mat;
}
