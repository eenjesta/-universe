import * as THREE from 'three';
import { LAKE, ISLANDS, WATERFALLS } from '../layout.js';
import { Rng } from '../../core/math.js';
import { fogUniforms } from './fog.js';

/**
 * Low mist: soft camera-facing puffs in one instanced draw.
 *  kind 0 — lake banks drifting along shores, islands and below cliffs
 *  kind 1 — rising plumes at waterfall plunge pools
 *  kind 2 — mist trails where floating-island streams dissolve
 * Puffs fade near the camera, toward the water plane and toward the terrain
 * (height texture) so their intersections never show hard edges. Lit by the
 * sky ambient plus a strong forward-scattering lobe: backlit mist glows gold
 * at sunset like the lookout concept art.
 */

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec2 aSize;
attribute vec4 aParams; // kind, seed, opacity, island
uniform float uTime;
uniform float uIslandBob[16];
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vKind;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
	float kind = aParams.x;
	float seed = aParams.y;
	vec3 c = aCenter;
	vec2 size = aSize;
	float alpha = aParams.z;
	if ( kind < 0.5 ) {
		// slow drift around the anchor + gentle breathing
		c.x += sin( uTime * 0.021 + seed * 6.28 ) * 14.0;
		c.z += cos( uTime * 0.017 + seed * 9.1 ) * 10.0;
		size *= 0.9 + 0.1 * sin( uTime * 0.05 + seed * 4.0 );
	} else if ( kind < 1.5 ) {
		float life = fract( uTime * ( 0.045 + seed * 0.03 ) + seed );
		c.y += life * 16.0;
		c.x += sin( seed * 40.0 ) * life * 8.0;
		c.z += cos( seed * 40.0 ) * life * 8.0;
		size *= 0.55 + life * 1.1;
		alpha *= sin( life * 3.14159 );
	} else {
		float life = fract( uTime * ( 0.03 + seed * 0.02 ) + seed );
		c.y -= life * 10.0;
		size *= 0.7 + life * 0.8;
		alpha *= sin( life * 3.14159 );
		if ( aParams.w > - 0.5 ) c.y += uIslandBob[ int( aParams.w + 0.5 ) ] * 0.5;
	}
	// camera-facing quad
	vec4 mv = viewMatrix * vec4( c, 1.0 );
	vec2 corner = ( uv - 0.5 ) * size;
	mv.xy += corner;
	vec4 mvPosition = mv;
	gl_Position = projectionMatrix * mvPosition;
	vUv = uv;
	vSeed = seed;
	vKind = kind;
	// world position of this corner (view-space offset back to world)
	vWorld = c + ( vec4( corner, 0.0, 0.0 ) * viewMatrix ).xyz;
	float d = - mv.z;
	vAlpha = alpha * smoothstep( 6.0, 45.0, d );
	#include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoise;
uniform sampler2D uHeightTex;
uniform float uHasHeight;
uniform vec4 uHeightXform;
uniform float uWaterLevel;
uniform vec3 uSunDir;
uniform vec3 uKeyColor;
uniform vec3 uSkyAmbient;
uniform float uDensity;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vKind;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
	vec2 c = vUv * 2.0 - 1.0;
	float r = length( c * vec2( 1.0, 1.25 ) );
	vec2 q = vUv * 0.55 + vec2( vSeed * 7.3, vSeed * 3.1 ) + vec2( uTime * 0.004, uTime * 0.0025 );
	float n = texture( uNoise, q ).a * 0.6 + texture( uNoise, q * 2.3 + 0.4 ).g * 0.4;
	float puff = smoothstep( 1.0, 0.15, r + ( n - 0.5 ) * 0.9 );
	float a = puff * vAlpha * uDensity;
	// soften against the water plane and the terrain
	a *= smoothstep( uWaterLevel - 0.5, uWaterLevel + 3.5, vWorld.y );
	if ( uHasHeight > 0.5 ) {
		vec2 huv = vec2( vWorld.x * uHeightXform.x + uHeightXform.z, vWorld.z * uHeightXform.y + uHeightXform.w );
		float g = texture( uHeightTex, clamp( huv, 0.0, 1.0 ) ).r;
		a *= smoothstep( g - 1.0, g + 5.0, vWorld.y );
	}
	vec3 V = normalize( cameraPosition - vWorld );
	// seen from above we look through a thin layer, not along the bank
	a *= 1.0 - 0.75 * smoothstep( 0.15, 0.7, V.y ) * step( vKind, 0.5 );
	if ( a < 0.003 ) discard;
	float fwd = pow( max( dot( - V, uSunDir ), 0.0 ), 4.0 );
	float side = 0.35 + 0.65 * clamp( uSunDir.y * 3.0 + 0.3, 0.0, 1.0 );
	vec3 col = uSkyAmbient * ( 1.15 + n * 0.25 ) + uKeyColor * ( 0.08 * side + fwd * 0.22 );
	gl_FragColor = vec4( col, clamp( a, 0.0, 1.0 ) );
	#include <fog_fragment>
}
`;

/** Finds water points near shores (banks hug coasts, islands and cliff feet). */
function placeBanks(world, rng, count) {
  const out = [];
  const ground = (x, z) => {
    const g = world.getHeightAt?.(x, z);
    return Number.isFinite(g) ? g : 0;
  };
  const level = world.waterLevel ?? 0;
  let tries = 0;
  while (out.length < count && tries < count * 60) {
    tries++;
    const a = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.random()) * 1.15;
    const x = LAKE.x + Math.cos(a) * LAKE.radiusX * rr;
    const z = LAKE.z + Math.sin(a) * LAKE.radiusZ * rr;
    if (ground(x, z) > level - 0.8) continue;
    // near land? probe a ring around the point
    let nearLand = 0;
    for (let k = 0; k < 8; k++) {
      const b = (k / 8) * Math.PI * 2;
      if (ground(x + Math.cos(b) * 55, z + Math.sin(b) * 55) > level + 1.5) nearLand++;
    }
    if (nearLand === 0 && rng.random() > 0.15) continue;
    out.push({ x, z });
  }
  // extra banks hugging the islands and the waterfall pools
  for (const isl of ISLANDS) {
    const n = 1 + Math.round(isl.radius / 22);
    for (let i = 0; i < n; i++) {
      const b = rng.range(0, Math.PI * 2);
      const d = isl.radius * rng.range(1.0, 1.6);
      out.push({ x: isl.x + Math.cos(b) * d, z: isl.z + Math.sin(b) * d });
    }
  }
  for (const f of WATERFALLS) {
    out.push({ x: f.bottom.x + rng.range(-10, 10), z: f.bottom.z + rng.range(-10, 10) });
    out.push({ x: f.bottom.x + (f.bottom.x - f.lip.x) * 1.2, z: f.bottom.z + (f.bottom.z - f.lip.z) * 1.2 });
  }
  return out;
}

export function createMist(ctx, world, shared, { plunges = [], islandStreams = [], density = 1 } = {}) {
  const rng = new Rng('atmo-mist');
  const level = world.waterLevel ?? 0;
  const inst = []; // [cx, cy, cz, w, h, kind, seed, opacity, island]
  const banks = placeBanks(world, rng, Math.round(46 * density));
  for (const b of banks) {
    const w = rng.range(55, 130);
    inst.push([b.x, level + rng.range(2.5, 6), b.z, w, w * rng.range(0.16, 0.26), 0, rng.random(), rng.range(0.2, 0.36), -1]);
  }
  for (const p of plunges) {
    const n = Math.max(4, Math.round(p.width * 0.5 * density));
    for (let i = 0; i < n; i++) {
      const w = p.width * rng.range(0.9, 1.6);
      inst.push([p.x + rng.range(-4, 4), p.y + 1, p.z + rng.range(-4, 4), w, w * 0.75, 1, rng.random(), rng.range(0.45, 0.7), -1]);
    }
  }
  for (const s of islandStreams) {
    const n = Math.max(4, Math.round(8 * density));
    for (let i = 0; i < n; i++) {
      const t = rng.range(0.45, 1.0);
      const pt = s.points[Math.min(s.points.length - 1, Math.round(t * (s.points.length - 1)))];
      const w = s.width * rng.range(3, 6);
      inst.push([pt.x + rng.range(-3, 3), pt.y, pt.z + rng.range(-3, 3), w, w * 0.8, 2, rng.random(), rng.range(0.35, 0.6), s.island]);
    }
  }

  const n = inst.length;
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const center = new Float32Array(n * 3);
  const size = new Float32Array(n * 2);
  const params = new Float32Array(n * 4);
  inst.forEach((v, i) => {
    center.set([v[0], v[1], v[2]], i * 3);
    size.set([v[3], v[4]], i * 2);
    params.set([v[5], v[6], v[7], v[8]], i * 4);
  });
  geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  geo.instanceCount = n;

  const uniforms = {
    ...fogUniforms(),
    uTime: shared.uTime,
    uNoise: shared.uNoise,
    uHeightTex: { value: null },
    uHasHeight: { value: 0 },
    uHeightXform: { value: new THREE.Vector4() },
    uWaterLevel: { value: level },
    uSunDir: shared.uSunDir,
    uKeyColor: shared.uKeyColor,
    uSkyAmbient: shared.uAmbientSky,
    uIslandBob: shared.uIslandBob,
    uDensity: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'AtmoMist',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'atmo-mist';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  function attachHeight(tex, xform) {
    uniforms.uHeightTex.value = tex;
    uniforms.uHasHeight.value = tex ? 1 : 0;
    if (xform) uniforms.uHeightXform.value.copy(xform);
  }

  return { mesh, material, uniforms, attachHeight, count: n };
}
