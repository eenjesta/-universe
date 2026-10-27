import * as THREE from 'three';
import { WORLD } from '../layout.js';
import { fogUniforms } from './fog.js';

/**
 * Lake + sea surface at the water level, out to the horizon.
 * Fresnel blend of a body colour (turquoise shallows → deep blue-green from
 * world.heightTexture) and the reflection: planar render target on high
 * quality, the equirect sky capture otherwise. Animated multi-scale normals
 * calm down with distance (mirror-like far lake as on the poster); an
 * analytic sun glitter path; foam where the lake bed comes up to the surface.
 * The mesh is a disc that follows the rendering camera.
 */

const VERT = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
	vec4 wp = modelMatrix * vec4( position, 1.0 );
	vWorld = wp.xyz;
	vec4 mvPosition = viewMatrix * wp;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunSpec;
uniform vec3 uGlintDir;
uniform vec3 uGlintSpec;
uniform vec3 uSkyAmbient;
uniform sampler2D uNormalMap;
uniform sampler2D uReflection;
uniform mat4 uTexMatrix;
uniform float uPlanarOn;
uniform sampler2D uEnvMap;
uniform sampler2D uHeightTex;
uniform float uHasHeight;
uniform vec4 uHeightXform;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoamColor;
uniform float uWaves;
uniform vec4 uGlitter; // x: facet slope variance up close, y: extra unresolved variance far away, z: scale, w: planet glint variance
varying vec3 vWorld;
#include <fog_pars_fragment>

vec2 eqUv( vec3 d ) {
	return vec2( atan( d.z, d.x ) * 0.15915494 + 0.5, asin( clamp( d.y, - 1.0, 1.0 ) ) * 0.31830989 + 0.5 );
}

void main() {
	vec3 toCam = cameraPosition - vWorld;
	float dist = length( toCam );
	vec3 V = toCam / dist;
	vec2 p = vWorld.xz;

	// animated normals at four scales, each drifting its own way
	vec2 s1 = texture( uNormalMap, p * 0.021 + uTime * vec2( 0.0045, 0.0032 ) ).xy * 2.0 - 1.0;
	vec2 s2 = texture( uNormalMap, p * 0.057 + uTime * vec2( - 0.0068, 0.0051 ) ).xy * 2.0 - 1.0;
	vec2 s3 = texture( uNormalMap, p * 0.0046 + uTime * vec2( 0.0012, - 0.0017 ) ).xy * 2.0 - 1.0;
	vec2 s4 = texture( uNormalMap, p * 0.17 + uTime * vec2( 0.013, 0.0094 ) ).xy * 2.0 - 1.0;
	float near = 1.0 - smoothstep( 8.0, 90.0, dist );
	float calm = mix( 1.0, 0.2, smoothstep( 40.0, 1600.0, dist ) );
	vec2 slope = ( s1 * 0.42 + s2 * 0.3 + s3 * 0.55 + s4 * 0.22 * near ) * uWaves * calm;
	vec3 N = normalize( vec3( - slope.x, 1.0, - slope.y ) );
	float under = gl_FrontFacing ? 1.0 : - 1.0;
	N *= under;

	float NdV = clamp( dot( N, V ), 0.0, 1.0 );
	float F = 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 );
	vec3 R = reflect( - V, N );

	// reflection
	vec3 Rs = R;
	Rs.y = max( Rs.y, 0.015 );
	vec3 refl = texture( uEnvMap, eqUv( normalize( Rs ) ) ).rgb;
	if ( uPlanarOn > 0.5 ) {
		vec4 pr = uTexMatrix * vec4( vWorld, 1.0 );
		vec2 ruv = pr.xy / pr.w + slope * ( 0.045 - 0.025 * smoothstep( 100.0, 2000.0, dist ) );
		refl = texture( uReflection, clamp( ruv, vec2( 0.001 ), vec2( 0.999 ) ) ).rgb;
	}

	// depth of the lake bed under this point (terrain height texture)
	float depth = 24.0;
	if ( uHasHeight > 0.5 ) {
		vec2 huv = vec2( vWorld.x * uHeightXform.x + uHeightXform.z, vWorld.z * uHeightXform.y + uHeightXform.w );
		float inside = step( 0.0, huv.x ) * step( huv.x, 1.0 ) * step( 0.0, huv.y ) * step( huv.y, 1.0 );
		float bed = texture( uHeightTex, clamp( huv, 0.0, 1.0 ) ).r;
		depth = mix( 30.0, max( - bed, 0.0 ), inside );
	}
	float view = depth * ( 1.0 + ( 1.0 - NdV ) * 1.5 );
	float k = 1.0 - exp( - view * 0.2 );
	vec3 body = mix( uShallow, uDeep, k ) * uSkyAmbient;
	// light scattered back out of the water column toward the viewer
	float sunUp = clamp( uSunDir.y * 4.0, 0.0, 1.0 );
	body += uShallow * uSunSpec * 0.0012 * sunUp * ( 1.0 - k * 0.7 );

	// sun glitter: a Beckmann distribution of wave facets on the half vector —
	// the resolved normal-map slope plus unresolved sub-pixel variance that
	// grows with distance. Toward a low sun this gives the tall, narrow
	// glitter column of the poster (sparkling up close, smooth far away).
	float sig2 = uGlitter.x + uGlitter.y * smoothstep( 20.0, 1400.0, dist );
	vec3 Hs = normalize( uSunDir + V );
	float nh = max( dot( N, Hs ), 1e-3 );
	float nh2 = nh * nh;
	float Ds = exp( - ( 1.0 - nh2 ) / ( nh2 * sig2 ) ) / ( 3.14159 * sig2 * nh2 * nh2 );
	float Fs = 0.02 + 0.98 * pow( 1.0 - clamp( dot( Hs, V ), 0.0, 1.0 ), 5.0 );
	vec3 spec = uSunSpec * min( Ds * Fs * uGlitter.z / max( 4.0 * NdV, 0.6 ), 1.6 );
	// the giant planet at night: a broad, soft glint (it is a huge area light)
	float sigP = sig2 + uGlitter.w;
	vec3 Hp = normalize( uGlintDir + V );
	float np = max( dot( N, Hp ), 1e-3 );
	float np2 = np * np;
	float Dp = exp( - ( 1.0 - np2 ) / ( np2 * sigP ) ) / ( 3.14159 * sigP * np2 * np2 );
	float Fp = 0.02 + 0.98 * pow( 1.0 - clamp( dot( Hp, V ), 0.0, 1.0 ), 5.0 );
	spec += uGlintSpec * ( Dp * Fp * uGlitter.z / max( 4.0 * NdV, 0.6 ) );

	vec3 col = mix( body, refl, F ) + spec * step( 0.0, under );

	// shoreline foam: bands lapping where the bed rises to the surface
	float shore = 1.0 - smoothstep( 0.0, 1.6, depth );
	float fn = texture( uNormalMap, p * 0.11 + vec2( uTime * 0.012, 0.0 ) ).a;
	float lap = sin( depth * 4.5 - uTime * 1.4 + fn * 5.0 ) * 0.5 + 0.5;
	float foam = shore * smoothstep( 0.5, 0.9, fn * 0.55 + lap * 0.55 ) * uHasHeight;
	foam += shore * shore * 0.35 * uHasHeight;
	foam *= 1.0 - smoothstep( 120.0, 520.0, dist );
	col = mix( col, uFoamColor * ( uSkyAmbient + uSunSpec * 0.02 * sunUp ), clamp( foam, 0.0, 1.0 ) * 0.85 );

	// clear shallows, opaque reflections
	float alpha = clamp( k * 1.25 + 0.1, 0.0, 1.0 );
	alpha = mix( alpha, 1.0, F );
	alpha = max( alpha, clamp( foam, 0.0, 1.0 ) );
	if ( under < 0.0 ) {
		col = uDeep * uSkyAmbient * 0.6;
		alpha = 0.85;
	}
	gl_FragColor = vec4( col, alpha );
	#include <fog_fragment>
}
`;

export function createWater(ctx, world, shared, reflection) {
  const uniforms = {
    ...fogUniforms(),
    uTime: shared.uTime,
    uSunDir: shared.uSunDir,
    uSunSpec: shared.uSunSpec,
    uGlintDir: { value: new THREE.Vector3(0, 1, 0) },
    uGlintSpec: { value: new THREE.Color(0, 0, 0) },
    uSkyAmbient: shared.uAmbientSky,
    uNormalMap: shared.uWaterNormals,
    uReflection: { value: reflection ? reflection.texture : null },
    uTexMatrix: { value: reflection ? reflection.textureMatrix : new THREE.Matrix4() },
    uPlanarOn: { value: 0 },
    uEnvMap: shared.uEnvMap,
    uHeightTex: { value: null },
    uHasHeight: { value: 0 },
    uHeightXform: { value: new THREE.Vector4(1 / WORLD.size, 1 / WORLD.size, 0.5, 0.5) },
    uShallow: { value: new THREE.Color(0.16, 0.62, 0.6) },
    uDeep: { value: new THREE.Color(0.012, 0.075, 0.09) },
    uFoamColor: { value: new THREE.Color(1.0, 0.98, 0.95) },
    uWaves: { value: 0.32 },
    uGlitter: { value: new THREE.Vector4(0.0025, 0.016, 0.0035, 0.05) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'AtmoWater',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  // radial disc: dense rings near the centre for good varying precision
  const geo = new THREE.RingGeometry(0.01, 5600, 64, 24);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y);
    // remap radius so rings are denser near the camera
    const t = r / 5600;
    const nr = 5600 * t * t;
    const s = r > 1e-6 ? nr / r : 0;
    pos.setXY(i, x * s, y * s);
  }
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'atmo-water';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10; // before other transparents (mist/waterfalls blend over it)
  mesh.position.y = world.waterLevel ?? 0;
  // the planar reflection is rendered from here: during the main pass, after
  // the shadow maps are up to date, and only for the main view camera
  const view = { camera: null };
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const cx = Math.round(camera.matrixWorld.elements[12] / 50) * 50;
    const cz = Math.round(camera.matrixWorld.elements[14] / 50) * 50;
    if (mesh.position.x !== cx || mesh.position.z !== cz) {
      mesh.position.x = cx;
      mesh.position.z = cz;
      mesh.updateMatrixWorld();
    }
    let planar = false;
    if (reflection && reflection.state.enabled && camera === view.camera) {
      try {
        planar = reflection.render(scene, camera);
      } catch (err) {
        reflection.state.enabled = false;
        console.error('[atmosphere] reflection pass failed — disabled', err);
      }
    }
    uniforms.uPlanarOn.value = planar ? 1 : 0;
  };

  /** Hooks up world.heightTexture once the terrain provides it (orientation auto-detected). */
  function attachHeight(tex) {
    if (!tex || uniforms.uHeightTex.value === tex) return;
    uniforms.uHeightTex.value = tex;
    uniforms.uHasHeight.value = 1;
    const xf = detectHeightTransform(tex, world);
    uniforms.uHeightXform.value.copy(xf);
  }

  return { mesh, material, uniforms, attachHeight, view };
}

/**
 * The contract says R = metres covering ±WORLD.half, but not the row order;
 * compare the CPU data with getHeightAt at a few probes to pick the mapping.
 */
function detectHeightTransform(tex, world) {
  const s = 1 / WORLD.size;
  const normal = new THREE.Vector4(s, s, 0.5, 0.5);
  const flipped = new THREE.Vector4(s, -s, 0.5, 0.5);
  const img = tex.image;
  if (!img?.data || !img.width || !img.height || typeof world.getHeightAt !== 'function') return normal;
  const { data, width, height } = img;
  const stride = data.length / (width * height);
  if (!(stride >= 1)) return normal;
  const read = (u, v) => {
    const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
    const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
    let val = data[(y * width + x) * stride];
    if (tex.type === THREE.HalfFloatType) val = THREE.DataUtils.fromHalfFloat(val);
    return val;
  };
  let errN = 0;
  let errF = 0;
  const probes = [[-400, -500], [300, 200], [-600, 300], [100, -900], [700, -200], [-200, 700], [0, 150], [500, 500]];
  for (const [x, z] of probes) {
    const h = world.getHeightAt(x, z);
    const u = x * s + 0.5;
    errN += Math.abs(read(u, z * s + 0.5) - h);
    errF += Math.abs(read(u, -z * s + 0.5) - h);
  }
  return errF < errN * 0.5 ? flipped : normal;
}
