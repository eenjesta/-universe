import { HAZE_GLSL } from './fog.js';

/**
 * GLSL for the analytic sky. One fragment function renders, in order:
 * gradient sky (horizon haze shared with the fog → mid → zenith) + sun glow
 * + night city glow → stars + milky band (masked by the bodies) → giant
 * planet (textured sphere, bump, soft terminator, atmosphere rim + halo) →
 * faint rings (planet-shadowed, hidden behind the planet) → two moons → sun
 * disc → lit cloud deck → distant cumulus banks on the horizon → a breath
 * of horizon haze.
 * Everything is composited analytically in one pass, so the dome, the planar
 * reflection and the equirect environment capture all agree. The same
 * program renders the dome and the equirect capture (uEquirect = 1: full-
 * screen quad, direction from uv); stars and the sun disc are switched off
 * by uniforms for the capture.
 */

export const SKY_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunDisc;
uniform float uSunRadius;
uniform float uSunDiscOn;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec4 uFogSun;
uniform vec4 uGlow;
uniform vec4 uSkyShape;
uniform vec3 uGroundHaze;
uniform vec3 uCityDir;
uniform vec3 uCityGlow;
uniform float uTime;
uniform float uStars;
uniform mat3 uStarRot;
uniform sampler2D uNoise;
uniform vec3 uCamPos;

uniform vec3 uPlanetDir;
uniform float uPlanetSin;
uniform mat3 uPlanetFrame;
uniform sampler2D uPlanetTex;
uniform vec3 uPlanetLightL;
uniform vec3 uPlanetLightW;
uniform vec3 uPlanetLightCol;
uniform vec3 uPlanetDark;
uniform vec3 uPlanetRim;
uniform float uPlanetSpin;
uniform float uPlanetOccl;
uniform vec3 uRingNormal;
uniform vec4 uRing;
uniform vec3 uRingColor;

uniform sampler2D uMoonTex;
uniform vec4 uMoonA;
uniform vec4 uMoonB;
uniform vec3 uMoonALight;
uniform vec3 uMoonBLight;
uniform vec3 uMoonATint;
uniform vec3 uMoonBTint;

uniform vec4 uCloud;
uniform vec4 uCloudWind;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec4 uBand;
uniform vec3 uBandLit;
uniform vec3 uBandShade;
uniform float uEquirect;
`;

export const SKY_FUNCTIONS_GLSL = /* glsl */ `
#define A_PI 3.14159265
#define A_TAU 6.28318531

${HAZE_GLSL}

vec3 aHash33( vec3 p3 ) {
	p3 = fract( p3 * vec3( 0.1031, 0.1030, 0.0973 ) );
	p3 += dot( p3, p3.yxz + 33.33 );
	return fract( ( p3.xxy + p3.yxx ) * p3.zyx );
}

// horizon haze colour (identical to the fog's in-scatter colour, without the glow)
vec3 aHaze( vec3 dir ) {
	return atmoHazeColor( dir, uSunDir, uHorizon, uFogSun, uGlow.w );
}

vec3 aSkyBase( vec3 dir ) {
	float h = dir.y;
	float hp = max( h, 0.0 );
	vec3 hor = aHaze( dir );
	// the mid sky brightens toward the sun's side of the sky
	float az = atmoSunAz( dir, uSunDir );
	vec3 mid = uMid * ( 1.0 + uSkyShape.x * az * az );
	vec3 c = mix( hor, mid, smoothstep( 0.0, uSkyShape.y, pow( hp, 0.9 ) ) );
	c = mix( c, uZenith, smoothstep( uSkyShape.z, 1.0, hp ) );
	// forward-scattering glow around the sun (same lobes as the haze)
	c += atmoSunGlow( dir, uSunDir, uGlow.rgb ) * mix( 1.0, 0.6, smoothstep( 0.0, 0.5, hp ) );
	// night: violet light dome over the city
	vec2 dxz = dir.xz / max( length( dir.xz ), 1e-4 );
	c += uCityGlow * pow( max( dot( dxz, uCityDir.xz ), 0.0 ), 9.0 ) * exp( - hp * 10.0 );
	// below the horizon: ground haze (the fog colour continues seamlessly)
	c = mix( c, uGroundHaze, smoothstep( 0.0, - 0.25, h ) );
	return c;
}

vec3 aStars( vec3 dir, float pxA ) {
	float h = dir.y;
	// stars appear around the zenith first at dusk, everywhere at night
	float vis = uStars * smoothstep( 0.04, 0.55 - uStars * 0.4, h );
	vec3 sd = uStarRot * dir;
	vec3 col = vec3( 0.0 );
	for ( int L = 0; L < 2; L ++ ) {
		float scale = L == 0 ? 110.0 : 230.0;
		vec3 p = sd * scale;
		vec3 cell = floor( p );
		vec3 r = aHash33( cell + float( L ) * 31.7 );
		float on = step( L == 0 ? 0.945 : 0.962, r.x );
		vec3 sp = normalize( cell + 0.2 + 0.6 * aHash33( cell * 1.31 + 7.7 ) );
		float ang = length( sd - sp ) * scale;
		float pxc = max( pxA * scale * 0.8, 0.024 );
		float core = exp( - ang * ang / ( pxc * pxc * 0.85 ) );
		// the faint layer only joins once the sky is properly dark
		float bright = ( ( L == 0 ? 1.5 : 0.3 ) * pow( r.y, 9.0 ) + ( L == 0 ? 0.05 : 0.028 ) ) * ( L == 0 ? 1.0 : uStars * uStars );
		float tw = 0.72 + 0.28 * sin( uTime * ( 1.3 + r.z * 3.1 ) + r.y * 41.0 );
		vec3 tint = mix( vec3( 0.72, 0.8, 1.0 ), vec3( 1.0, 0.85, 0.68 ), r.z );
		col += tint * core * bright * tw * on;
	}
	// milky band: a great circle of patchy glow with darker dust lanes
	vec3 bn = normalize( vec3( - 0.42, 0.55, 0.72 ) );
	float bd = dot( sd, bn );
	float band = exp( - bd * bd * 15.0 );
	float n = ( textureLod( uNoise, sd.xy * 0.9 + 0.13, 0.0 ).g + textureLod( uNoise, sd.yz * 0.9 + 0.41, 0.0 ).g + textureLod( uNoise, sd.zx * 0.9 + 0.77, 0.0 ).g ) * 0.3333;
	float lanes = smoothstep( 0.45, 0.66, textureLod( uNoise, sd.xz * 2.1 + sd.y * 0.7, 0.0 ).b ) * exp( - bd * bd * 90.0 );
	float mw = band * smoothstep( 0.28, 0.82, n ) * ( 1.0 - 0.7 * lanes );
	col += mix( vec3( 0.42, 0.48, 0.9 ), vec3( 0.95, 0.8, 0.78 ), n ) * mw * 0.12;
	return col * vis;
}

// Ray vs a sphere "at infinity" (centre direction C, sin of angular radius sR).
// N is continued smoothly outside the disc so derivatives stay well defined.
void aBodyHit( vec3 dir, vec3 C, float sR, out vec3 N, out float t, out float theta ) {
	float cT = dot( dir, C );
	float s2 = max( sR * sR - ( 1.0 - cT * cT ), 0.0 );
	t = cT - sqrt( s2 );
	N = normalize( dir * t - C );
	theta = acos( clamp( cT, - 1.0, 1.0 ) );
}

vec2 aSphereUV( vec3 nl ) {
	return vec2( atan( nl.z, nl.x ) * 0.15915494 + 0.5, asin( clamp( nl.y, - 1.0, 1.0 ) ) * 0.31830989 + 0.5 );
}

vec3 aMoon( vec3 dir, vec4 M, vec3 L, vec3 tint, vec2 uvOff, float lod, float pxA, out float cover ) {
	vec3 N; float t; float th;
	aBodyHit( dir, M.xyz, M.w, N, t, th );
	float R = asin( M.w );
	cover = 1.0 - smoothstep( R - pxA, R + pxA, th );
	if ( th > R * 1.6 ) return vec3( 0.0 );
	vec3 X = - M.xyz;
	vec3 Z = normalize( cross( X, vec3( 0.0, 1.0, 0.0 ) ) );
	vec3 Y = cross( Z, X );
	vec3 nl = vec3( dot( N, X ), dot( N, Y ), dot( N, Z ) );
	vec2 uv = aSphereUV( nl ) + uvOff;
	vec4 tx = textureLod( uMoonTex, uv, lod );
	vec3 a = tx.rgb * tint;
	float ndl = dot( N, L );
	float term = smoothstep( - 0.05, 0.22, ndl );
	vec3 c = a * uPlanetLightCol * 1.5 * ( max( ndl, 0.0 ) * 0.8 + 0.2 ) * term;
	c += a * uPlanetDark * 0.8 * ( 1.0 - term );
	// faint limb brightening on the lit side + soft glow
	float mu = clamp( dot( N, - dir ), 0.0, 1.0 );
	c += uPlanetRim * 0.22 * pow( 1.0 - mu, 3.0 ) * term;
	float halo = exp( - max( th - R, 0.0 ) / R * 9.0 ) * ( 1.0 - cover );
	c = c * cover + a * uPlanetLightCol * 0.03 * halo * smoothstep( - 0.2, 0.5, dot( normalize( dir - M.xyz ), L ) );
	return c;
}

// Cloud-deck density at deck coordinates q (noise-tile units): a very large
// coverage map decides where cloud fields are, mid octaves shape soft
// clumps, a little fine detail roughens the edges.
float aCloudField( vec2 q, float cov ) {
	vec2 w = texture( uNoise, q * 0.11 + vec2( 0.17, 0.61 ) ).ba - 0.5;
	q += w * 0.38;
	float big = texture( uNoise, q * 0.045 + vec2( 0.4, 0.2 ) ).r;
	float n = texture( uNoise, q * 0.16 ).r * 0.6;
	n += texture( uNoise, q * 0.43 + vec2( 0.31, 0.12 ) ).g * 0.28;
	n += texture( uNoise, q * 1.35 + vec2( 0.71, 0.53 ) ).b * 0.12;
	float c = clamp( cov + ( big - 0.5 ) * 0.8, 0.0, 1.0 );
	float lo = 1.0 - c;
	return smoothstep( lo, lo + 0.32, n );
}

vec4 aClouds( vec3 dir ) {
	if ( uCloud.y < 0.001 ) return vec4( 0.0 ); // uniform branch only: the fetches below need derivatives
	float h = max( dir.y, 0.012 );
	// curved cloud deck (exaggerated planet curvature → finite horizon distance)
	float Re = 90000.0;
	float oy = Re + uCamPos.y;
	float Rc = Re + uCloud.z;
	float b = oy * h;
	float t = - b + sqrt( b * b + ( Rc - oy ) * ( Rc + oy ) );
	vec2 q = ( uCamPos.xz + dir.xz * t ) / uCloud.w + uCloudWind.xy;
	float dens = aCloudField( q, uCloud.x );
	vec2 sxz = uSunDir.xz;
	float sl = length( sxz );
	sxz = sl > 1e-4 ? sxz / sl : vec2( 0.0 );
	float dens2 = aCloudField( q + sxz * 0.05, uCloud.x );
	float edge = 1.0 - dens;
	// light reaching this column: less cloud toward the sun = lit side
	float lit = clamp( 0.62 + ( dens - dens2 ) * 1.9 + edge * 0.3, 0.0, 1.0 );
	float mu = max( dot( dir, uSunDir ), 0.0 );
	float fwd = pow( mu, 10.0 ) * 1.8 + pow( mu, 3.0 ) * 0.3;
	vec3 c = uCloudShade * ( 0.72 + 0.28 * edge ) + uCloudLit * lit * ( 0.5 + fwd * ( 0.45 + edge * 1.1 ) );
	// distant clouds dissolve into the horizon haze
	float far = smoothstep( 5000.0, 30000.0, t );
	c = mix( c, aHaze( dir ) * 1.05, far * 0.6 );
	float a = dens * uCloud.y;
	a *= smoothstep( 0.012, 0.07, dir.y );
	a *= 1.0 - smoothstep( 24000.0, 42000.0, t ) * 0.75;
	return vec4( c, a );
}

// One octave of rounded cloud heads along the horizon: each azimuth cell
// holds a half-ellipse head (random centre, width, height); the tallest
// head wins. Returns (top height, lateral position inside the head -1..1).
vec2 aHeads( float x, float N, float seed, float hMax, float group ) {
	float ci = floor( x );
	vec2 best = vec2( 0.0, 0.0 );
	for ( int k = - 1; k <= 1; k ++ ) {
		float c = ci + float( k );
		vec3 r = aHash33( vec3( mod( c, N ), seed, 7.13 ) );
		float w = 0.55 + 0.75 * r.y;
		float dx = ( x - ( c + 0.5 + ( r.x - 0.5 ) * 0.6 ) ) / w;
		float hgt = hMax * ( 0.3 + 0.7 * r.z * r.z ) * group;
		float e = hgt * sqrt( max( 1.0 - dx * dx, 0.0 ) );
		if ( e > best.x ) best = vec2( e, dx );
	}
	return best;
}

// Distant cumulus banks along the horizon (2.5D): clusters of rounded heads
// whose silhouette normal is lit by the sun in the cloud's own frame — lit
// flanks away from the sun, dark bodies with bright silver rims toward it —
// sinking into the horizon haze at their bases.
vec4 aCloudBand( vec3 dir ) {
	float h = dir.y;
	if ( uBand.w < 0.001 || h > uBand.y * 1.05 + 0.005 || h < - 0.03 ) return vec4( 0.0 );
	float az = atan( dir.x, - dir.z );
	float u = az * 0.15915494 + uBand.z;
	float g = textureLod( uNoise, vec2( u * 4.0, 0.37 ), 0.0 ).r;
	float group = smoothstep( 1.0 - uBand.x, 1.3 - uBand.x, g );
	if ( group < 0.001 ) return vec4( 0.0 );
	vec2 big = aHeads( u * 56.0, 56.0, 1.7, uBand.y, group );
	vec2 sml = aHeads( u * 170.0, 170.0, 5.3, uBand.y * 0.38, smoothstep( 0.0, 0.4, big.x / uBand.y ) );
	// irregular, wind-torn outline
	float fz = textureLod( uNoise, vec2( u * 31.0, 0.83 ), 0.0 ).b;
	float top = max( big.x, big.x * 0.72 + sml.x ) * ( 0.86 + 0.28 * fz );
	float dx = sml.x > big.x * 0.2 ? mix( big.y, sml.y, 0.55 ) : big.y;
	float soft = 0.0018 + top * 0.11;
	float inside = 1.0 - smoothstep( top - soft, top + soft * 0.35, h );
	if ( top < 0.0015 || inside < 0.001 ) return vec4( 0.0 );
	float yr = clamp( h / top, 0.0, 1.0 );
	// silhouette normal in the cloud frame (x along the horizon, y up, z toward the viewer)
	float k = smoothstep( 0.35, 1.0, yr );
	vec3 n = normalize( vec3( dx * k, sqrt( max( 1.0 - dx * dx, 0.0 ) ) * k, 1.0 - k * 0.8 ) );
	float sAz = atan( uSunDir.x, - uSunDir.z );
	float cE = length( uSunDir.xz );
	vec3 sl = vec3( sin( sAz - az ) * cE, uSunDir.y, - cos( sAz - az ) * cE );
	float lit = max( dot( n, sl ), 0.0 );
	float back = max( - sl.z, 0.0 ); // sun behind the bank
	float edge = smoothstep( top - soft * 6.0, top - soft * 0.5, h );
	float tex = 0.86 + 0.28 * textureLod( uNoise, vec2( u * 47.0, h * 12.0 + 0.5 ), 0.0 ).g;
	vec3 c = uBandShade * ( 0.75 + 0.35 * yr ) * tex;
	c += uBandLit * lit * ( 0.35 + 0.65 * yr ) * tex;
	c += uBandLit * edge * back * back * 0.55; // silver / golden lining
	c = mix( c, aHaze( dir ), 0.22 + 0.55 * ( 1.0 - yr ) * ( 1.0 - yr ) );
	return vec4( c, inside * uBand.w );
}

vec3 aSky( vec3 dir, float pxA ) {
	vec3 col = aSkyBase( dir );
	// transmittance of our own atmosphere toward the bodies (low = hazier)
	float T = smoothstep( - 0.03, 0.17, dir.y );

	// ---------------- planet (uniform-flow geometry, branch only for shading)
	vec3 Np; float tP; float thP;
	aBodyHit( dir, uPlanetDir, uPlanetSin, Np, tP, thP );
	vec3 nl = uPlanetFrame * Np;
	vec2 puv = aSphereUV( nl );
	vec2 gx = dFdx( puv );
	vec2 gy = dFdy( puv );
	// Tarini's trick: take the u-derivative of a copy whose seam sits elsewhere
	float u2 = fract( puv.x + 0.5 );
	float gx2 = dFdx( u2 );
	float gy2 = dFdy( u2 );
	if ( abs( gx2 ) < abs( gx.x ) ) gx.x = gx2;
	if ( abs( gy2 ) < abs( gy.x ) ) gy.x = gy2;
	float Rp = asin( uPlanetSin );
	float coverP = 1.0 - smoothstep( Rp - pxA, Rp + pxA, thP );
	// ring plane intersection (also uniform flow, for derivatives)
	float dn = dot( dir, uRingNormal );
	float tr = dot( uPlanetDir, uRingNormal ) / ( abs( dn ) > 1e-5 ? dn : 1e-5 );
	vec3 Q = dir * tr;
	float rr = length( Q - uPlanetDir ) / uPlanetSin;
	float rN = ( rr - uRing.x ) / ( uRing.y - uRing.x );
	float rfw = fwidth( rN );

	vec3 prad = vec3( 0.0 );
	float ringA = 0.0;
	vec3 ringCol = vec3( 0.0 );
	if ( thP < Rp * 2.6 ) {
		vec2 suv = puv + vec2( uPlanetSpin, 0.0 );
		vec4 ptex = textureGrad( uPlanetTex, suv, gx, gy );
		float hx = textureGrad( uPlanetTex, suv + vec2( 0.0016, 0.0 ), gx, gy ).a;
		float hy = textureGrad( uPlanetTex, suv + vec2( 0.0, 0.0032 ), gx, gy ).a;
		float lon = ( puv.x - 0.5 ) * A_TAU;
		float clat = length( nl.xz );
		vec3 Tl = vec3( - sin( lon ), 0.0, cos( lon ) );
		vec3 Bl = vec3( - nl.y * cos( lon ), clat, - nl.y * sin( lon ) );
		vec2 dh = vec2( hx - ptex.a, hy - ptex.a ) * 3.4;
		vec3 nb = normalize( nl - dh.x * Tl - dh.y * Bl );
		float ndlS = dot( nl, uPlanetLightL );
		float ndl = dot( nb, uPlanetLightL );
		float term = smoothstep( - 0.12, 0.38, ndlS );
		vec3 albedo = ptex.rgb;
		vec3 lit = albedo * uPlanetLightCol * ( clamp( ndl, 0.0, 1.0 ) * 0.9 + 0.1 ) * term;
		// warm band along the terminator (light refracted through its atmosphere)
		lit += albedo * uPlanetLightCol * vec3( 1.0, 0.55, 0.36 ) * exp( - pow( ( ndlS - 0.03 ) * 8.0, 2.0 ) ) * 0.09;
		vec3 dark = albedo * uPlanetDark * ( 1.0 - term ) * ( 0.6 + 0.4 * ptex.a );
		float muV = clamp( dot( Np, - dir ), 0.0, 1.0 );
		vec3 atmo = uPlanetRim * pow( 1.0 - muV, 3.0 ) * smoothstep( - 0.3, 0.55, ndlS ) * 1.5;
		prad = ( lit + dark + atmo ) * coverP;
		// thin atmospheric halo just outside the limb, on the lit side
		vec3 perp = normalize( dir - uPlanetDir * dot( dir, uPlanetDir ) );
		float hl = smoothstep( - 0.4, 0.7, dot( perp, uPlanetLightW ) );
		prad += uPlanetRim * exp( - max( thP - Rp, 0.0 ) / Rp * 28.0 ) * ( 1.0 - coverP ) * hl * 0.55;

		// rings
		float inside = step( 0.0, rN ) * step( rN, 1.0 ) * step( 0.0, tr );
		// a few broad rings with fine ringlets (noise), a Cassini-like gap and a thin outer gap
		float ringlets = textureLod( uNoise, vec2( rN * 2.3, 0.31 ), 0.0 ).b * 0.65 + textureLod( uNoise, vec2( rN * 7.9, 0.67 ), 0.0 ).g * 0.35;
		ringlets = mix( ringlets, 0.55, smoothstep( 0.02, 0.08, rfw ) ); // fade sub-pixel detail
		float bands = ( 0.35 + 0.9 * ringlets ) * mix( 0.55, 1.0, smoothstep( 0.18, 0.4, rN ) );
		bands *= smoothstep( 0.0, 0.06, rN ) * ( 1.0 - smoothstep( 0.86, 1.0, rN ) );
		bands *= 1.0 - 0.9 * exp( - pow( ( rN - 0.62 ) * 22.0, 2.0 ) );
		bands *= 1.0 - 0.7 * exp( - pow( ( rN - 0.9 ) * 60.0, 2.0 ) );
		float behind = step( tP, tr ) * coverP;
		vec3 toC = uPlanetDir - Q;
		float s = dot( toC, uPlanetLightW );
		float d2 = dot( toC, toC ) - s * s;
		float sh = step( 0.0, s ) * ( 1.0 - smoothstep( uPlanetSin * uPlanetSin * 0.82, uPlanetSin * uPlanetSin * 1.04, d2 ) );
		ringA = clamp( bands * uRing.z * inside * ( 1.0 - behind ), 0.0, 1.0 );
		ringCol = uRingColor * uPlanetLightCol * ( 0.4 + 0.6 * abs( dot( uRingNormal, uPlanetLightW ) ) ) * mix( 1.0, 0.1, sh );
		ringCol += uRingColor * uPlanetDark * 2.0;
	}

	// ---------------- moons
	float coverA; float coverB;
	vec3 mA = aMoon( dir, uMoonA, uMoonALight, uMoonATint, vec2( 0.13, 0.02 ), 1.5, pxA, coverA );
	vec3 mB = aMoon( dir, uMoonB, uMoonBLight, uMoonBTint, vec2( 0.57, - 0.05 ), 2.5, pxA, coverB );

	if ( uStars > 0.001 ) col += aStars( dir, pxA ) * ( 1.0 - max( coverP, max( coverA, coverB ) ) );

	// bodies: their light, attenuated near the horizon, over the in-scattered sky
	col = col * ( 1.0 - coverP * uPlanetOccl ) + prad * T;
	col = mix( col, ringCol * T + col * 0.5, ringA );
	col = col * ( 1.0 - coverA * 0.85 ) + mA * T;
	col = col * ( 1.0 - coverB * 0.85 ) + mB * T;

	// ---------------- sun disc + corona
	float chord = length( dir - uSunDir );
	float disc = 1.0 - smoothstep( uSunRadius - pxA * 1.5, uSunRadius + pxA * 1.5, chord );
	float limb = 1.0 - 0.45 * pow( clamp( chord / uSunRadius, 0.0, 1.0 ), 2.0 );
	float up = smoothstep( - 0.012, 0.004, dir.y );
	col += uSunDisc * disc * limb * uSunDiscOn * up;
	col += uSunDisc * 0.02 * exp( - max( chord - uSunRadius, 0.0 ) / uSunRadius * 2.2 ) * ( 1.0 - disc ) * uSunDiscOn * up;

	// ---------------- clouds: deck, then the distant banks in front of everything
	vec4 cl = aClouds( dir );
	col = mix( col, cl.rgb, cl.a );
	vec4 cb = aCloudBand( dir );
	col = mix( col, cb.rgb, cb.a );

	// a breath of horizon haze over everything near the horizon line
	col = mix( col, aHaze( dir ), smoothstep( 0.04, 0.0, abs( dir.y ) ) * 0.3 );
	return col;
}
`;

/**
 * Dome: a unit sphere drawn around whatever camera renders it, at the far
 * plane. Capture (uEquirect = 1): a full-screen quad, direction from uv.
 */
export const SKY_VERTEX = /* glsl */ `
uniform float uEquirect;
varying vec3 vDir;
varying vec2 vUv;
void main() {
	vUv = uv;
	vDir = position;
	if ( uEquirect > 0.5 ) {
		gl_Position = vec4( position.xy, 0.0, 1.0 );
	} else {
		vec4 p = viewMatrix * vec4( cameraPosition + position * 1000.0, 1.0 );
		gl_Position = projectionMatrix * p;
		gl_Position.z = gl_Position.w * 0.99999;
	}
}
`;

export const SKY_FRAGMENT = /* glsl */ `
${SKY_UNIFORMS_GLSL}
${SKY_FUNCTIONS_GLSL}
varying vec3 vDir;
varying vec2 vUv;
void main() {
	vec3 dir;
	if ( uEquirect > 0.5 ) {
		// matches three's equirectUv(): u = atan(z, x), v = asin(y)
		float lon = ( vUv.x - 0.5 ) * A_TAU;
		float lat = ( vUv.y - 0.5 ) * A_PI;
		dir = vec3( cos( lat ) * cos( lon ), sin( lat ), cos( lat ) * sin( lon ) );
	} else {
		dir = normalize( vDir );
	}
	float pxA = max( length( fwidth( dir ) ), 1e-5 );
	gl_FragColor = vec4( aSky( dir, pxA ), 1.0 );
}
`;
