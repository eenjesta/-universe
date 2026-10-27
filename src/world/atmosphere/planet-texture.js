import * as THREE from 'three';

/**
 * One-off GPU bake of the giant planet's and the moons' surfaces into
 * equirectangular render targets (RGB = albedo, A = height for bump).
 * Planet: pale icy giant — soft swirling latitude bands, storm ovals, a few
 * large impact basins and fine craters (the concept art mixes both).
 * Moons: grey/rose cratered rock with maria.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform float uMode;
varying vec2 vUv;

float h13( vec3 p ) {
	p = fract( p * 0.1031 );
	p += dot( p, p.zyx + 31.32 );
	return fract( ( p.x + p.y ) * p.z );
}
vec3 h33( vec3 p3 ) {
	p3 = fract( p3 * vec3( 0.1031, 0.1030, 0.0973 ) );
	p3 += dot( p3, p3.yxz + 33.33 );
	return fract( ( p3.xxy + p3.yxx ) * p3.zyx );
}
float vnoise( vec3 p ) {
	vec3 i = floor( p );
	vec3 f = fract( p );
	vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
	float a = h13( i );
	float b = h13( i + vec3( 1, 0, 0 ) );
	float c = h13( i + vec3( 0, 1, 0 ) );
	float d = h13( i + vec3( 1, 1, 0 ) );
	float e = h13( i + vec3( 0, 0, 1 ) );
	float f1 = h13( i + vec3( 1, 0, 1 ) );
	float g = h13( i + vec3( 0, 1, 1 ) );
	float h = h13( i + vec3( 1, 1, 1 ) );
	return mix( mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ), mix( mix( e, f1, u.x ), mix( g, h, u.x ), u.y ), u.z );
}
float fbm( vec3 p, int oct ) {
	float s = 0.0;
	float a = 0.5;
	float n = 0.0;
	for ( int i = 0; i < 7; i ++ ) {
		if ( i >= oct ) break;
		s += vnoise( p ) * a;
		n += a;
		p = p * 2.03 + vec3( 1.7, 9.2, 3.1 );
		a *= 0.5;
	}
	return s / n;
}
// crater field: returns (height contribution, darkening). Only the 2×2×2
// cells nearest to p are visited (craters never reach further).
vec2 craters( vec3 p, float density ) {
	vec3 i = floor( p );
	vec3 f = fract( p );
	vec3 s = step( 0.5, f ) - 1.0; // -1 or 0: lower corner of the 2x2x2 block
	float hgt = 0.0;
	float shade = 0.0;
	for ( int z = 0; z < 2; z ++ )
	for ( int y = 0; y < 2; y ++ )
	for ( int x = 0; x < 2; x ++ ) {
		vec3 o = s + vec3( float( x ), float( y ), float( z ) );
		vec3 r = h33( i + o );
		if ( r.x > density ) continue;
		vec3 c = o + 0.15 + 0.7 * h33( i + o + 11.3 );
		float rad = 0.12 + 0.26 * r.y * r.y;
		float d = length( f - c ) / rad;
		if ( d > 1.5 ) continue;
		// flat-ish floor, soft raised rim, faint bright ejecta blanket
		float bowl = d < 1.0 ? ( smoothstep( 0.0, 1.0, d ) - 1.0 ) * 0.7 : 0.0;
		float rim = exp( - pow( ( d - 1.0 ) * 3.2, 2.0 ) ) * 0.28;
		float ej = d > 1.0 ? exp( - ( d - 1.0 ) * 2.6 ) * 0.1 : 0.0;
		hgt += ( bowl + rim ) * ( 0.45 + r.z * 0.8 );
		shade += ( d < 1.0 ? 0.1 * ( 1.0 - d * d ) : 0.0 ) - ej - rim * 0.1;
	}
	return vec2( hgt, shade );
}

void main() {
	float lon = ( vUv.x - 0.5 ) * 6.2831853;
	float lat = ( vUv.y - 0.5 ) * 3.1415927;
	vec3 p = vec3( cos( lat ) * cos( lon ), sin( lat ), cos( lat ) * sin( lon ) );
	vec3 col;
	float hgt;
	if ( uMode < 0.5 ) {
		// ---- giant planet
		float w1 = fbm( p * 2.1 + 3.1, 5 );
		float w2 = fbm( p * 5.3 - 1.7, 4 );
		vec3 sw = p + vec3( w1 - 0.5, 0.0, w2 - 0.5 ) * 0.35;
		float latw = sw.y + 0.11 * ( fbm( sw * 3.2 + 7.0, 4 ) - 0.5 ) + 0.035 * ( w2 - 0.5 );
		float b1 = sin( latw * 10.0 + 0.6 ) * 0.5 + 0.5;
		float b2 = sin( latw * 23.0 + 2.1 ) * 0.5 + 0.5;
		float streak = fbm( vec3( latw * 21.0, sw.x * 1.6, sw.z * 1.6 ), 4 );
		vec3 cBlue = vec3( 0.6, 0.66, 0.8 );
		vec3 cCream = vec3( 0.88, 0.83, 0.76 );
		vec3 cLav = vec3( 0.62, 0.6, 0.74 );
		vec3 cWhite = vec3( 0.93, 0.93, 0.95 );
		vec3 cRose = vec3( 0.84, 0.72, 0.72 );
		col = mix( cBlue, cCream, smoothstep( 0.25, 0.85, b1 ) );
		col = mix( col, cLav, smoothstep( 0.6, 0.95, b2 ) * 0.55 );
		col = mix( col, cWhite, smoothstep( 0.55, 0.8, streak ) * 0.55 );
		col = mix( col, cRose, smoothstep( 0.62, 0.85, fbm( sw * 4.0 + 2.0, 3 ) ) * 0.3 );
		// storm ovals
		float st = 0.0;
		for ( int k = 0; k < 4; k ++ ) {
			vec3 sc = normalize( h33( vec3( float( k ) * 7.1, 2.3, 5.9 ) ) * 2.0 - 1.0 );
			sc.y *= 0.55;
			sc = normalize( sc );
			vec3 dd = p - sc;
			float e = length( vec3( dd.x, dd.y * 2.6, dd.z ) ) / ( 0.09 + 0.06 * float( k == 0 ) );
			st = max( st, exp( - e * e ) );
		}
		col = mix( col, vec3( 0.95, 0.9, 0.86 ), st * 0.55 );
		// impact basins + fine craters (an old, frozen surface under thin bands)
		vec2 c1 = craters( p * 3.2, 0.22 );
		vec2 c2 = craters( p * 9.0 + 4.0, 0.4 );
		vec2 c3 = craters( p * 22.0 + 9.0, 0.5 );
		vec2 c4 = craters( p * 52.0 + 2.0, 0.55 );
		hgt = 0.5 + c1.x * 0.2 + c2.x * 0.1 + c3.x * 0.045 + c4.x * 0.02 + ( fbm( p * 12.0, 4 ) - 0.5 ) * 0.12 + streak * 0.04;
		col *= 1.0 - ( c1.y * 0.55 + c2.y * 0.45 + c3.y * 0.3 + c4.y * 0.2 );
		// a few young ray craters: bright streaks radiating from small impacts
		for ( int k = 0; k < 3; k ++ ) {
			vec3 rc = normalize( h33( vec3( float( k ) * 3.7 + 1.3, 8.1, 2.9 ) ) * 2.0 - 1.0 );
			vec3 dd = p - rc;
			float dist = length( dd );
			vec3 tang = normalize( dd - rc * dot( dd, rc ) + 1e-5 );
			float ang = atan( dot( tang, normalize( cross( rc, vec3( 0.0, 1.0, 0.0 ) ) ) ), dot( tang, normalize( cross( rc, cross( rc, vec3( 0.0, 1.0, 0.0 ) ) ) ) ) );
			float rays = pow( vnoise( vec3( cos( ang ) * 5.0, sin( ang ) * 5.0, float( k ) * 9.0 ) ), 3.0 );
			col += vec3( 0.16 ) * rays * exp( - dist * 9.0 ) * smoothstep( 0.015, 0.05, dist );
		}
		// darker maria-like patches
		float maria = smoothstep( 0.55, 0.72, fbm( p * 1.6 + 11.0, 5 ) );
		col = mix( col, col * vec3( 0.78, 0.8, 0.9 ), maria * 0.5 );
	} else {
		// ---- moons
		float m = fbm( p * 2.4 + 5.0, 5 );
		col = mix( vec3( 0.72, 0.7, 0.69 ), vec3( 0.5, 0.49, 0.5 ), smoothstep( 0.45, 0.7, m ) );
		vec2 c1 = craters( p * 4.0, 0.5 );
		vec2 c2 = craters( p * 11.0 + 3.0, 0.6 );
		vec2 c3 = craters( p * 26.0 + 8.0, 0.65 );
		hgt = 0.5 + c1.x * 0.25 + c2.x * 0.12 + c3.x * 0.05 + ( fbm( p * 16.0, 3 ) - 0.5 ) * 0.1;
		col *= 1.0 - ( c1.y * 0.8 + c2.y * 0.6 + c3.y * 0.4 );
		col *= 0.92 + 0.16 * fbm( p * 30.0, 3 );
	}
	gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), clamp( hgt, 0.0, 1.0 ) );
}
`;

/**
 * Renders the planet (mode 0) or moon (mode 1) texture once and returns the
 * render target (texture has mipmaps, linear, repeat-wrapped in U).
 */
export function bakeBodyTexture(renderer, mode, width, height) {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    anisotropy: 4,
  });
  rt.texture.name = mode === 0 ? 'atmo-planet' : 'atmo-moon';
  const material = new THREE.ShaderMaterial({
    name: 'AtmoBodyBake',
    uniforms: { uMode: { value: mode } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  material.dispose();
  return rt;
}
