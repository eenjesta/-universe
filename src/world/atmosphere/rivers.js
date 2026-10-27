import * as THREE from 'three';
import { RIVERS } from '../layout.js';
import { fogUniforms } from './fog.js';

/**
 * Rivers: flowing water ribbons along RIVERS (polyline [x, z, waterHeight]).
 * The centre line is a gentle Catmull-Rom through the points (the river
 * polyline bends only a few degrees per vertex, so it stays inside the
 * channel the terrain carves). Normals scroll downstream, faster where the
 * river drops (rapids get white water); banks fade out under the terrain.
 * Reflection from the equirect sky capture.
 */

const VERT = /* glsl */ `
attribute float aSlope;
varying vec2 vUv;
varying float vSlope;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
	vUv = uv;
	vSlope = aSlope;
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
uniform vec3 uSkyAmbient;
uniform sampler2D uNormalMap;
uniform sampler2D uEnvMap;
uniform float uWidth;
varying vec2 vUv;
varying float vSlope;
varying vec3 vWorld;
#include <fog_pars_fragment>

vec2 eqUv( vec3 d ) {
	return vec2( atan( d.z, d.x ) * 0.15915494 + 0.5, asin( clamp( d.y, - 1.0, 1.0 ) ) * 0.31830989 + 0.5 );
}

void main() {
	vec3 toCam = cameraPosition - vWorld;
	float dist = length( toCam );
	vec3 V = toCam / dist;
	float speed = 1.6 + vSlope * 60.0;
	vec2 fp = vec2( vUv.x * uWidth, vUv.y );
	vec2 s1 = texture( uNormalMap, fp * vec2( 0.06, 0.035 ) + vec2( 0.0, - uTime * speed * 0.035 ) ).xy * 2.0 - 1.0;
	vec2 s2 = texture( uNormalMap, fp * vec2( 0.13, 0.08 ) + vec2( 0.31, - uTime * speed * 0.08 ) ).xy * 2.0 - 1.0;
	vec2 slope = ( s1 * 0.5 + s2 * 0.35 ) * ( 0.35 + min( vSlope, 0.15 ) * 3.0 );
	// the ribbon's local frame is unknown here: perturb in world xz (good enough for a river)
	vec3 N = normalize( vec3( - slope.x, 1.0, - slope.y ) );
	float NdV = clamp( dot( N, V ), 0.0, 1.0 );
	float F = 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 );
	vec3 R = reflect( - V, N );
	R.y = max( R.y, 0.02 );
	vec3 refl = texture( uEnvMap, eqUv( normalize( R ) ) ).rgb;
	vec3 body = vec3( 0.02, 0.085, 0.09 ) * uSkyAmbient * 1.4;
	float rs = max( dot( R, uSunDir ), 0.0 );
	vec3 spec = uSunSpec * ( pow( rs, 600.0 ) * 1.2 + pow( rs, 60.0 ) * 0.05 );
	vec3 col = mix( body, refl, F ) + spec * F;

	// white water: rapids + along the banks
	float edge = abs( vUv.x - 0.5 ) * 2.0;
	float fn = texture( uNormalMap, fp * vec2( 0.09, 0.05 ) + vec2( 0.7, - uTime * speed * 0.05 ) ).a;
	// white water only where the river really drops (its mean gradient is ~6 %)
	float rapid = smoothstep( 0.075, 0.16, vSlope );
	float foam = smoothstep( 0.7 - rapid * 0.3, 0.92, fn + edge * 0.2 ) * ( 0.18 + rapid * 0.82 );
	foam += smoothstep( 0.8, 0.98, edge ) * smoothstep( 0.5, 0.78, fn ) * 0.45;
	col = mix( col, vec3( 0.95, 0.97, 1.0 ) * ( uSkyAmbient + uSunSpec * 0.015 ), clamp( foam, 0.0, 1.0 ) * 0.8 );

	float alpha = ( 1.0 - smoothstep( 0.88, 1.0, edge ) ) * mix( 0.82, 1.0, F );
	gl_FragColor = vec4( col, alpha );
	#include <fog_fragment>
}
`;

/** Samples a Catmull-Rom curve through [x, z, h] points every `step` metres. */
function sampleRiver(points, step) {
  const pts = points.map(([x, z, h]) => new THREE.Vector3(x, h, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const len = curve.getLength();
  const n = Math.max(2, Math.ceil(len / step));
  return curve.getSpacedPoints(n);
}

export function createRivers(ctx, world, shared) {
  const group = new THREE.Group();
  group.name = 'atmo-rivers';
  const materials = [];
  for (const river of RIVERS) {
    const samples = sampleRiver(river.points, 4);
    const across = 6;
    const halfW = river.width / 2 + 2.5; // extend under the banks, faded in the shader
    const verts = [];
    const uvs = [];
    const slopes = [];
    const idx = [];
    let dist = 0;
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const a = samples[Math.max(0, i - 1)];
      const b = samples[Math.min(samples.length - 1, i + 1)];
      dir.set(b.x - a.x, 0, b.z - a.z).normalize();
      side.set(-dir.z, 0, dir.x);
      if (i > 0) dist += p.distanceTo(samples[i - 1]);
      const drop = Math.max(0, (a.y - b.y) / Math.max(1e-3, Math.hypot(b.x - a.x, b.z - a.z)));
      for (let j = 0; j <= across; j++) {
        const t = j / across;
        const o = (t - 0.5) * 2 * halfW;
        verts.push(p.x + side.x * o, p.y + 0.06, p.z + side.z * o);
        uvs.push(t, dist);
        slopes.push(drop);
      }
    }
    const row = across + 1;
    for (let i = 0; i < samples.length - 1; i++) {
      for (let j = 0; j < across; j++) {
        const a = i * row + j;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        idx.push(a, b, c, b, d, c); // counter-clockwise seen from above
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aSlope', new THREE.Float32BufferAttribute(slopes, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      name: 'AtmoRiver',
      uniforms: {
        ...fogUniforms(),
        uTime: shared.uTime,
        uSunDir: shared.uSunDir,
        uSunSpec: shared.uSunSpec,
        uSkyAmbient: shared.uAmbientSky,
        uNormalMap: shared.uWaterNormals,
        uEnvMap: shared.uEnvMap,
        uWidth: { value: halfW * 2 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `atmo-river-${river.id}`;
    mesh.renderOrder = -9;
    group.add(mesh);
  }
  return { group, materials };
}
