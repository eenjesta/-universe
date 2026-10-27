import * as THREE from 'three';

/**
 * Shared vegetation materials (one atlas → one program for all plants):
 *   near   MeshStandardMaterial + alpha-tested atlas, double sided, vertex
 *          colours (baked AO), wind sway (per-vertex `wind` weight, per-
 *          instance phase), foliage normals kept as authored (no back-face
 *          flip → soft volumetric canopies), backlit translucency toward the
 *          sun, emissive atlas for bioluminescent plants (brighter at night)
 *   depth  matching shadow caster (same wind + alpha test)
 *   far    solid low-poly vertex-coloured material (far LODs)
 */
export function createVegetationMaterials(atlas) {
  const shared = {
    uTime: { value: 0 },
    uWindStrength: { value: 1 },
    uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0, 0, 0) },
  };

  const WIND_PARS = /* glsl */ `
attribute float wind;
uniform float uTime;
uniform float uWindStrength;
`;
  const WIND = /* glsl */ `
{
#ifdef USE_INSTANCING
  vec2 wp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
#else
  vec2 wp = vec2(modelMatrix[3][0], modelMatrix[3][2]);
#endif
  float ph = dot(wp, vec2(0.071, 0.113));
  float gust = 0.6 + 0.4 * sin(uTime * 0.31 + wp.x * 0.009 + wp.y * 0.006);
  float sw = (sin(uTime * 1.35 + ph) + 0.4 * sin(uTime * 2.8 + ph * 1.7)) * wind * uWindStrength * gust;
  transformed.x += sw * 0.26;
  transformed.z += sw * 0.17 * cos(ph);
  transformed += normal * sin(uTime * 6.5 + ph * 3.0 + position.y * 2.1 + position.x) * 0.03 * wind * uWindStrength;
}
`;

  const near = new THREE.MeshStandardMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissiveMap,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 1.6,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
  });
  near.name = 'vegetation';
  near.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDirW;\nuniform vec3 uSunColor;')
      // foliage normals are authored (spherical canopies): no back-face flip
      .replace('normal *= faceDirection;', '')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 vdir = normalize(vViewPosition);
          vec3 sunView = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
          float tr = pow(max(0.0, dot(-vdir, sunView)), 5.0);
#ifdef TERRAIN_SUNVIS
          tr *= vSunVis; // no backlit glow inside terrain shadow
#endif
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * tr;
        }`,
      );
  };
  near.customProgramCacheKey = () => 'veg-near-v2';

  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: atlas.map,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND}`);
  };
  depth.customProgramCacheKey = () => 'veg-depth-v1';

  const far = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  far.name = 'vegetation-far';
  far.customProgramCacheKey = () => 'veg-far-v1';

  return {
    near,
    depth,
    far,
    shared,
    /** Per-frame: time, sun (for translucency) and night glow. */
    update(t, world) {
      shared.uTime.value = t;
      const sun = world.sun;
      if (sun && world.sunDirection) {
        shared.uSunDirW.value.copy(world.sunDirection).normalize();
        const up = Math.max(0, world.sunDirection.y);
        // strongest near the horizon (backlit sunset), fades with altitude
        const k = 0.22 * (1 - Math.min(1, up * 1.6)) * Math.min(1, up * 12 + 0.05);
        shared.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity * k);
      }
      const day = world.dayFactor ?? 1;
      near.emissiveIntensity = 1.1 + (1 - day) * 2.6;
    },
  };
}
