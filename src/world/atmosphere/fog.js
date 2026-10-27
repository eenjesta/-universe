import * as THREE from 'three';

/**
 * Atmospheric fog for every material in the world scene.
 *
 * Extends three's fog shader chunks (once, globally) with
 *  - exponential height fog (analytic integral along the view ray), so the
 *    lake and valleys sit in low haze while ridges and spires stay crisp;
 *  - a direction-dependent in-scatter colour identical to the sky shader's
 *    horizon (HAZE_GLSL): cool away from the sun, a warm band hugging the
 *    horizon around the sun's azimuth, plus the forward-scattering glow
 *    around the sun — so distant terrain melts seamlessly into the sky.
 * scene.fog stays a regular THREE.FogExp2 (colour = away-from-sun haze,
 * density = uniform exp² part). The extra parameters live in shared vec4
 * uniforms whose *values are shared plain objects*, injected into
 * UniformsLib.fog and every built-in ShaderLib entry (UniformsUtils.clone
 * copies plain objects by reference). They are only enabled while the world
 * scene renders (scene.onBeforeRender), so other scenes get plain fog.
 * Custom ShaderMaterials get the extension by merging THREE.UniformsLib.fog
 * (after the world installed) and using the standard fog includes; without
 * the extra uniforms they silently fall back to plain fog.
 */

/** Shared values (plain objects so every cloned uniform references them). */
export const FOG = {
  sun: { x: 1, y: 0.8, z: 0.5, w: 4 }, // rgb warm horizon colour toward the sun, w = azimuth exponent
  dir: { x: 0, y: 0.1, z: -1, w: 0 }, // xyz = sun direction, w = 1 while rendering a mirrored (reflection) view
  params: { x: 0.0015, y: 1 / 60, z: 0.985, w: 0 }, // x = height-fog density at y=0, y = 1/scale height, z = max opacity, w = enabled
  glow: { x: 1, y: 0.6, z: 0.3, w: 0.12 }, // rgb = sun glow colour (HDR), w = vertical falloff of the warm band (sin elevation)
};

/**
 * Haze colour functions shared by the sky dome and the fog (identical maths
 * keeps the horizon seamless). `d` and `s` are unit directions.
 */
export const HAZE_GLSL = /* glsl */ `
float atmoSunAz( vec3 d, vec3 s ) {
	float ld = length( d.xz );
	float ls = length( s.xz );
	return ( ld > 1e-4 && ls > 1e-4 ) ? 0.5 + 0.5 * dot( d.xz, s.xz ) / ( ld * ls ) : 1.0;
}
// cool haze away from the sun, a warm band toward its azimuth that hugs the horizon
vec3 atmoHazeColor( vec3 d, vec3 s, vec3 cool, vec4 warm, float falloff ) {
	float w = pow( atmoSunAz( d, s ), warm.w ) * exp( - max( d.y, 0.0 ) / falloff );
	return mix( cool, warm.rgb, w );
}
// forward-scattering (Mie) glow around the sun: broad sheen → tight halo
vec3 atmoSunGlow( vec3 d, vec3 s, vec3 glow ) {
	float mu = clamp( dot( d, s ), 1e-5, 1.0 );
	return glow * ( 0.07 * pow( mu, 12.0 ) + 0.26 * pow( mu, 90.0 ) + 0.75 * pow( mu, 700.0 ) );
}
`;

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorldDir;
#endif
`;

const VERTEX = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorldDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorldDir;
	uniform vec4 atmoFogSun;
	uniform vec4 atmoFogDir;
	uniform vec4 atmoFogParams;
	uniform vec4 atmoFogGlow;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	// Average of exp(-b*y) along a vertical span starting at y0 and rising dy.
	float atmoFogAvg( float y0, float dy, float b ) {
		float e0 = exp( - b * y0 );
		float k = b * dy;
		return abs( k ) > 1e-3 ? e0 * ( 1.0 - exp( - k ) ) / k : e0 * ( 1.0 - 0.5 * k );
	}
	${HAZE_GLSL}
#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 atmoFogTint = fogColor;
	if ( atmoFogParams.w > 0.5 ) {
		float fogDist = length( vFogWorldDir );
		vec3 fogDir = vFogWorldDir / max( fogDist, 1e-4 );
		float b = atmoFogParams.y;
		float y0 = cameraPosition.y;
		float dy = vFogWorldDir.y;
		float avg;
		if ( atmoFogDir.w > 0.5 && y0 < 0.0 && y0 + dy > 0.0 ) {
			// mirrored reflection view: the real light path bounces at y = 0,
			// so integrate |y| (split at the water plane)
			float f = - y0 / dy;
			avg = f * atmoFogAvg( 0.0, - y0, b ) + ( 1.0 - f ) * atmoFogAvg( 0.0, y0 + dy, b );
		} else {
			avg = atmoFogAvg( max( y0, - 50.0 ), dy, b );
		}
		float tau = atmoFogParams.x * fogDist * avg;
		#ifdef FOG_EXP2
			tau += fogDensity * fogDensity * fogDist * fogDist;
		#endif
		fogFactor = min( 1.0 - exp( - tau ), atmoFogParams.z );
		// (mirrored views use the virtual camera's ray + the real sun, exactly
		// like the sky dome drawn in the same reflection pass)
		atmoFogTint = atmoHazeColor( fogDir, atmoFogDir.xyz, fogColor, atmoFogSun, atmoFogGlow.w );
		atmoFogTint += atmoSunGlow( fogDir, atmoFogDir.xyz, atmoFogGlow.rgb );
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, atmoFogTint, fogFactor );
#endif
`;

let installed = false;

/** Patches the fog chunks + uniform libraries once. Safe to call repeatedly. */
export function installFogChunks() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FRAGMENT;
  const extra = {
    atmoFogSun: { value: FOG.sun },
    atmoFogDir: { value: FOG.dir },
    atmoFogParams: { value: FOG.params },
    atmoFogGlow: { value: FOG.glow },
  };
  Object.assign(THREE.UniformsLib.fog, extra);
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib?.uniforms && 'fogColor' in lib.uniforms) {
      for (const [k, u] of Object.entries(extra)) lib.uniforms[k] = { value: u.value };
    }
  }
}

/** Uniform objects for custom ShaderMaterials that want the full atmospheric fog. */
export function fogUniforms() {
  return THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
}

/**
 * Sets the shared fog values. Colours are linear THREE.Colors, `sunDir` a
 * unit Vector3. Height-fog `density` is the extinction per metre at y = 0.
 * `glow` is the HDR sun-glow colour scaled for the haze (`glowScale`).
 */
export function setFog({ sunColor, exponent, sunDir, density, scaleHeight, glow, glowScale = 1, falloff = 0.12, maxOpacity = 0.985 }) {
  FOG.sun.x = sunColor.r;
  FOG.sun.y = sunColor.g;
  FOG.sun.z = sunColor.b;
  FOG.sun.w = exponent;
  FOG.dir.x = sunDir.x;
  FOG.dir.y = sunDir.y;
  FOG.dir.z = sunDir.z;
  FOG.params.x = density;
  FOG.params.y = 1 / Math.max(1, scaleHeight);
  FOG.params.z = maxOpacity;
  if (glow) {
    FOG.glow.x = glow.r * glowScale;
    FOG.glow.y = glow.g * glowScale;
    FOG.glow.z = glow.b * glowScale;
  }
  FOG.glow.w = falloff;
}

/** Enables/disables the extension (only while the world scene renders). */
export function setFogEnabled(on) {
  FOG.params.w = on ? 1 : 0;
}

/** Mirror mode for planar reflection passes (height fog integrates |y| across the water plane). */
export function setFogMirror(on) {
  FOG.dir.w = on ? 1 : 0;
}

/**
 * onBeforeCompile helper: inserts GLSL right before the final fog mix of a
 * material's fog_fragment (variables in scope: fogFactor, atmoFogTint,
 * vFogDepth, vFogWorldDir). Returns false if the material has no fog.
 */
export function patchFogFragment(shader, glsl) {
  const chunk = THREE.ShaderChunk.fog_fragment;
  const at = chunk.lastIndexOf('gl_FragColor.rgb = mix(');
  if (at < 0 || !shader.fragmentShader.includes('#include <fog_fragment>')) return false;
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `${chunk.slice(0, at)}${glsl}\n${chunk.slice(at)}`);
  return true;
}
