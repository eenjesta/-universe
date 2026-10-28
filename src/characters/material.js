/**
 * Shared character material (characters module).
 *
 * Every character batch is ONE skinned mesh drawn with ONE material. Per-part
 * surface properties travel as vertex attributes instead of separate materials:
 *   color    (vec3)  albedo (linear)
 *   aMat     (vec4)  roughness, metalness, emissive strength, sheen
 *   aDetail  (float) detail normal strength; > 0 = fabric weave, < 0 = hair strands
 * The detail normal map packs two tangent-space normal patterns: fabric in RG,
 * hair strands in BA. A cheap view-dependent rim term (sun-coloured) gives the
 * backlit silhouettes of the concept art; modes update its uniforms.
 */
import * as THREE from 'three';

let detailTexture = null;

/** 256² tileable detail normals: RG = twill fabric, BA = hair strands. */
export function getDetailTexture() {
  if (detailTexture) return detailTexture;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  // tileable value noise
  const G = 32;
  const grid = new Float32Array(G * G);
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const vnoise = (x, y, f) => {
    // x, y in [0,1); f = cells per tile (divides G)
    const fx = x * f;
    const fy = y * f;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const g = (a, b) => grid[((b % f) * (G / f)) * G + (a % f) * (G / f)];
    const a = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * sx;
    const b = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
  const TAU = Math.PI * 2;
  const fabricH = (x, y) => {
    // diagonal twill + fine weave + slubs
    const tw = Math.sin((x * 48 + y * 48) * TAU / 2) * 0.5 + 0.5;
    const weave = Math.sin(x * 96 * TAU / 2) * Math.sin(y * 96 * TAU / 2) * 0.25;
    return tw * 0.55 + weave + vnoise(x, y, 16) * 0.5 + vnoise(x, y, 32) * 0.25;
  };
  const hairH = (x, y) => {
    // strands run along v (y); slight waviness
    const w = vnoise(x, y, 4) * 0.8;
    const s1 = Math.sin((x * 64 + w) * TAU) * 0.5;
    const s2 = Math.sin((x * 151 + w * 2.3) * TAU) * 0.3;
    return s1 + s2 + vnoise(x * 1.0, y, 8) * 0.4;
  };
  const e = 1 / S;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = i / S;
      const y = j / S;
      const fx = (fabricH((x + e) % 1, y) - fabricH((x - e + 1) % 1, y)) * 0.9;
      const fy = (fabricH(x, (y + e) % 1) - fabricH(x, (y - e + 1) % 1)) * 0.9;
      const hx = (hairH((x + e) % 1, y) - hairH((x - e + 1) % 1, y)) * 0.55;
      const hy = (hairH(x, (y + e) % 1) - hairH(x, (y - e + 1) % 1)) * 0.25;
      const k = (j * S + i) * 4;
      data[k] = Math.max(0, Math.min(255, Math.round((-fx * 0.5 + 0.5) * 255)));
      data[k + 1] = Math.max(0, Math.min(255, Math.round((-fy * 0.5 + 0.5) * 255)));
      data[k + 2] = Math.max(0, Math.min(255, Math.round((-hx * 0.5 + 0.5) * 255)));
      data[k + 3] = Math.max(0, Math.min(255, Math.round((-hy * 0.5 + 0.5) * 255)));
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  detailTexture = tex;
  return tex;
}

/**
 * Creates a character material. Each scene context (world, studio, portraits)
 * gets its own instance so the rim uniforms can differ; the shader program is
 * shared. `userData.rimColor` (Color) and `userData.sunDir` (Vector3, world)
 * drive the rim light.
 */
export function createCharacterMaterial({ rim = 0.0, name = 'character', fpHide = false } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    name,
    vertexColors: true,
    roughness: 1,
    metalness: 1,
    sheen: 1,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(1, 1, 1),
    normalMap: getDetailTexture(),
    normalScale: new THREE.Vector2(1, 1),
  });
  const uRimColor = { value: new THREE.Color(1, 0.7, 0.45).multiplyScalar(rim) };
  const uSunDir = { value: new THREE.Vector3(0.3, 0.2, -1).normalize() };
  mat.userData.rimColor = uRimColor.value;
  mat.userData.sunDir = uSunDir.value;
  // first person (the local player only): bones whose weight is 1 in uHideBone are discarded in the
  // colour pass (dithered while uFpHide fades in); the shadow pass uses three's depth material → full shadow
  const uFpHide = { value: 0 };
  const uHideBone = { value: new Float32Array(32) };
  if (fpHide) {
    mat.defines = { ...(mat.defines || {}), CHR_FP_HIDE: '' };
    mat.userData.fpHide = uFpHide;
    mat.userData.hideBones = uHideBone.value;
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = uRimColor;
    shader.uniforms.uSunDir = uSunDir;
    if (fpHide) {
      shader.uniforms.uFpHide = uFpHide;
      shader.uniforms.uHideBone = uHideBone;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n#ifdef CHR_FP_HIDE\nuniform float uHideBone[ 32 ];\nvarying float vFpHide;\n#endif')
        .replace(
          '#include <skinning_vertex>',
          `#include <skinning_vertex>
          #if defined( CHR_FP_HIDE ) && defined( USE_SKINNING )
            vFpHide = skinWeight.x * uHideBone[ int( skinIndex.x ) & 31 ] + skinWeight.y * uHideBone[ int( skinIndex.y ) & 31 ]
              + skinWeight.z * uHideBone[ int( skinIndex.z ) & 31 ] + skinWeight.w * uHideBone[ int( skinIndex.w ) & 31 ];
          #elif defined( CHR_FP_HIDE )
            vFpHide = 0.0;
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n#ifdef CHR_FP_HIDE\nuniform float uFpHide;\nvarying float vFpHide;\n#endif')
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          #ifdef CHR_FP_HIDE
            if ( uFpHide > 0.0 ) {
              float hideV = vFpHide * uFpHide;
              float dith = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
              if ( hideV > ( uFpHide >= 0.999 ? 0.5 : dith * 0.98 + 0.01 ) ) discard;
            }
          #endif`,
        );
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aMat;\nattribute float aDetail;\nvarying vec4 vMat;\nvarying float vDetail;',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMat = aMat;\n\tvDetail = aDetail;')
      // a zero normal (surface-nets vertex with a vanishing SDF gradient) must not
      // become normalize(0) = NaN, which shades the whole triangle black
      .replace(
        '#include <normal_vertex>',
        THREE.ShaderChunk.normal_vertex.replace(
          'vNormal = normalize( transformedNormal );',
          'vNormal = transformedNormal * inversesqrt( max( dot( transformedNormal, transformedNormal ), 1e-30 ) );',
        ),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec4 vMat;\nvarying float vDetail;\nuniform vec3 uRimColor;\nuniform vec3 uSunDir;',
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = abs( vMat.x );')
      .replace(
        '#include <lights_physical_pars_fragment>',
        `#include <lights_physical_pars_fragment>
        // skin (negative roughness flag): warm wrapped diffuse in the terminator ≈ subsurface scattering
        void RE_Direct_Chr( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
          RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          if ( vMat.x < 0.0 ) {
            float ndl = dot( geometryNormal, directLight.direction );
            float wrapL = max( 0.0, ( ndl + 0.5 ) / 1.5 ) - max( 0.0, ndl );
            reflectedLight.directDiffuse += wrapL * directLight.color * BRDF_Lambert( material.diffuseColor ) * vec3( 1.0, 0.45, 0.33 );
          }
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Chr`,
      )
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.y;')
      .replace(
        '#include <normal_fragment_maps>',
        `
        if ( abs( vDetail ) > 0.001 ) {
          vec4 dtex = texture2D( normalMap, vNormalMapUv );
          vec2 dn = ( vDetail > 0.0 ? dtex.rg : dtex.ba ) * 2.0 - 1.0;
          vec3 mapN = normalize( vec3( dn * abs( vDetail ), 1.0 ) );
          normal = normalize( tbn * mapN );
        }
        `,
      )
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = diffuseColor.rgb * vMat.z;')
      .replace(
        '#include <lights_physical_fragment>',
        // max(): with MSAA the vertex colour is extrapolated at triangle edges and can dip below 0 → sqrt = NaN
        '#include <lights_physical_fragment>\n\tmaterial.sheenColor *= vMat.w * ( 0.4 + 0.6 * sqrt( max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0 ) ) );',
      )
      .replace(
        '#include <opaque_fragment>',
        `
        {
          // warm rim (concept-art backlight): strongest when the sun is behind the
          // character as seen from the camera; dark cloth keeps a soft sheen-like rim
          vec3 vdir = normalize( vViewPosition );
          float fres = pow( 1.0 - saturate( dot( normal, vdir ) ), 3.0 );
          vec3 sunV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
          float side = saturate( dot( normal, sunV ) * 0.6 + 0.4 );
          float back = saturate( dot( -vdir, sunV ) );
          float facing = mix( side, 1.0, back * back * 0.85 );
          float lumD = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          vec3 tint = mix( vec3( lumD ), diffuseColor.rgb, 0.65 );
          outgoingLight += fres * facing * uRimColor * ( ( 0.35 + 0.65 * ( 1.0 - vMat.y ) ) * tint * 2.2 + 0.075 );
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => (fpHide ? 'chr-v4-fp' : 'chr-v4');
  return mat;
}

/** Copies the world sun into a material's rim uniforms (call once per frame). */
export function updateRimFromWorld(mat, world, strength = 0.55) {
  if (!mat || !world) return;
  const sun = world.sun;
  const day = world.dayFactor ?? 1;
  if (world.sunDirection) mat.userData.sunDir.copy(world.sunDirection);
  const c = mat.userData.rimColor;
  if (sun?.color) c.copy(sun.color);
  else c.setRGB(1, 0.72, 0.48);
  // stronger at golden hour (low sun), softer at noon, faint moonlight at night
  const low = world.sunDirection ? 1 - Math.min(1, Math.max(0, world.sunDirection.y) * 1.6) : 0.6;
  const k = strength * (0.25 + 0.75 * low) * (0.25 + 0.75 * day);
  c.multiplyScalar(k);
}
