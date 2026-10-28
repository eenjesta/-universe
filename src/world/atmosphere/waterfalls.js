import * as THREE from 'three';
import { WATERFALLS } from '../layout.js';
import { Rng } from '../../core/math.js';
import { fogUniforms } from './fog.js';

/**
 * Waterfalls: animated falling-water sheets for the cliff falls (WATERFALLS)
 * and the thin streams pouring off floating islands, plus plunge-pool foam
 * and spray droplets. The path of each cliff fall is simulated against the
 * live terrain (free fall where the cliff is sheer, cascading where it
 * slopes) so it always hugs whatever the terrain engineer sculpted.
 * Island streams follow their island's bob (uIslandBob, shared with
 * islands.js) and dissolve into mist on the way down.
 * All sheets are merged into one mesh (2 layers), foam into one, spray into
 * one Points object → 3 draw calls.
 */

const SHEET_VERT = /* glsl */ `
attribute float aProg;
attribute float aIsland;
attribute float aDissolve;
attribute float aWidth;
attribute vec3 aNormal2;
attribute float aLayer;
uniform float uIslandBob[16];
varying vec2 vUv;
varying float vLayer;
varying float vProg;
varying float vDissolve;
varying float vWidth;
varying vec3 vWorld;
varying vec3 vN;
#include <fog_pars_vertex>
void main() {
	vUv = uv;
	vLayer = aLayer;
	vProg = aProg;
	vDissolve = aDissolve;
	vWidth = aWidth;
	vN = aNormal2;
	vec3 p = position;
	if ( aIsland > - 0.5 ) p.y += uIslandBob[ int( aIsland + 0.5 ) ] * ( 1.0 - aProg );
	vec4 wp = modelMatrix * vec4( p, 1.0 );
	vWorld = wp.xyz;
	vec4 mvPosition = viewMatrix * wp;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

const SHEET_FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoise;
uniform vec3 uSunDir;
uniform vec3 uKeyColor;
uniform vec3 uSkyAmbient;
varying vec2 vUv;
varying float vLayer;
varying float vProg;
varying float vDissolve;
varying float vWidth;
varying vec3 vWorld;
varying vec3 vN;
#include <fog_pars_fragment>
void main() {
	// water accelerates under gravity: sample the streak noise at the moment
	// this parcel left the lip, so features stretch as the fall speeds up
	float v0 = 2.8;
	float tFall = ( sqrt( v0 * v0 + 19.62 * vUv.y ) - v0 ) / 9.81;
	float phase = uTime - tFall + vLayer * 3.7;
	vec2 q = vec2( vUv.x * vWidth / 7.0 + vLayer * 0.31, phase * 0.42 );
	float n1 = texture( uNoise, q * vec2( 1.0, 0.5 ) ).g;
	float n2 = texture( uNoise, q * vec2( 2.7, 1.3 ) + vec2( 0.37, 0.0 ) ).b;
	float n3 = texture( uNoise, q * vec2( 6.0, 2.9 ) + vec2( 0.71, 0.13 ) ).a;
	float streak = smoothstep( 0.3, 0.85, n1 * 0.55 + n2 * 0.3 + n3 * 0.25 );
	float edgeX = smoothstep( 0.0, 0.16, vUv.x ) * smoothstep( 1.0, 0.84, vUv.x );
	float strands = smoothstep( 0.22, 0.62, n2 * 0.8 + edgeX * 0.55 );
	float top = smoothstep( 0.0, 0.035, vProg );
	float foamy = smoothstep( 0.6, 1.0, vProg );
	float a = ( 0.32 + 0.52 * streak + foamy * 0.3 ) * edgeX * strands * top;
	a *= 1.0 - smoothstep( 0.9, 1.0, vProg ) * 0.7;
	// island streams: thin, broken ribbons that thin out into spray and mist
	a *= mix( 1.0, ( 0.7 - 0.45 * vProg ) * ( 1.0 - smoothstep( 0.18, 0.72, vProg ) ) * smoothstep( 0.3, 0.7, n1 + n3 * 0.45 ), vDissolve );
	vec3 V = normalize( cameraPosition - vWorld );
	float back = pow( max( dot( - V, uSunDir ), 0.0 ), 5.0 );
	float facing = abs( dot( vN, uSunDir ) );
	vec3 base = mix( vec3( 0.5, 0.64, 0.68 ), vec3( 0.95, 0.97, 1.0 ), clamp( streak * 0.65 + foamy * 0.5, 0.0, 1.0 ) );
	vec3 col = base * ( uSkyAmbient * 1.5 + uKeyColor * ( 0.12 + 0.2 * facing + back * 0.6 ) );
	col *= mix( vec3( 1.0 ), vec3( 0.66, 0.7, 0.76 ), vDissolve ); // airborne island streams: thin, greyer spray
	gl_FragColor = vec4( col, clamp( a, 0.0, 1.0 ) );
	#include <fog_fragment>
}
`;

const FOAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
	vUv = uv;
	vec4 wp = modelMatrix * vec4( position, 1.0 );
	vWorld = wp.xyz;
	vec4 mvPosition = viewMatrix * wp;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

const FOAM_FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoise;
uniform vec3 uKeyColor;
uniform vec3 uSkyAmbient;
varying vec2 vUv;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
	vec2 c = vUv * 2.0 - 1.0;
	float r = length( c );
	float ang = r > 0.0 ? atan( c.y, c.x ) : 0.0; // atan( 0, 0 ) at the disc centre is undefined
	float ring = fract( r * 1.6 - uTime * 0.35 );
	float n = texture( uNoise, vWorld.xz * 0.09 + vec2( uTime * 0.03, 0.0 ) ).a;
	float n2 = texture( uNoise, vec2( ang * 0.6, r * 0.8 - uTime * 0.25 ) ).g;
	float foam = smoothstep( 0.42, 0.85, n * 0.6 + n2 * 0.5 + ( 1.0 - r ) * 0.35 );
	foam *= 1.0 - smoothstep( 0.55, 1.0, r );
	foam *= 0.75 + 0.25 * ring;
	vec3 col = vec3( 0.96, 0.98, 1.0 ) * ( uSkyAmbient * 1.6 + uKeyColor * 0.22 );
	gl_FragColor = vec4( col, foam * 0.9 );
	#include <fog_fragment>
}
`;

const SPRAY_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute vec3 aVel;
uniform float uTime;
uniform float uScale;
varying float vAlpha;
void main() {
	float life = fract( uTime * ( 0.35 + aSeed.y * 0.3 ) + aSeed.x );
	vec3 p = position + aVel * life * 2.2;
	p.y += 3.5 * life - 6.0 * life * life;
	vec4 mvPosition = viewMatrix * modelMatrix * vec4( p, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	float size = aSeed.z * ( 0.6 + life * 1.6 );
	gl_PointSize = clamp( size * uScale / max( - mvPosition.z, 0.5 ), 0.0, 48.0 );
	vAlpha = sin( life * 3.14159 ) * ( 0.35 + 0.4 * aSeed.w ) * smoothstep( 4.0, 20.0, - mvPosition.z );
}
`;

const SPRAY_FRAG = /* glsl */ `
uniform vec3 uKeyColor;
uniform vec3 uSkyAmbient;
varying float vAlpha;
void main() {
	vec2 c = gl_PointCoord * 2.0 - 1.0;
	float d = dot( c, c );
	if ( d > 1.0 ) discard;
	float a = ( 1.0 - d ) * ( 1.0 - d ) * vAlpha;
	vec3 col = uSkyAmbient * 1.8 + uKeyColor * 0.3;
	gl_FragColor = vec4( col, a );
}
`;

/** Simulates water leaving the lip; returns points [{x,y,z}] from top to the pool. */
export function simulateFallPath(world, fall) {
  const level = world.waterLevel ?? 0;
  const ground = (x, z) => {
    const g = world.getHeightAt?.(x, z);
    return Number.isFinite(g) ? g : level;
  };
  const dx = fall.bottom.x - fall.lip.x;
  const dz = fall.bottom.z - fall.lip.z;
  const L = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / L;
  const uz = dz / L;
  let x = fall.lip.x;
  let z = fall.lip.z;
  let y = Math.max(fall.top, ground(x, z)) + 0.35;
  let vh = 2.8;
  let vy = 0;
  const pts = [{ x, y, z }];
  let travelled = 0;
  let sinceRecord = 0;
  const dt = 0.04;
  for (let i = 0; i < 1200; i++) {
    vy -= 9.81 * dt;
    const sx = ux * vh * dt;
    const sz = uz * vh * dt;
    x += sx;
    z += sz;
    y += vy * dt;
    travelled += Math.hypot(sx, sz);
    const g = ground(x, z) + 0.45;
    if (y < g) {
      // sliding down a slope: keep hugging the rock, pick up speed
      y = g;
      vy = Math.max(vy, -3);
      vh = Math.min(vh + 6 * dt, 7);
    }
    sinceRecord += Math.hypot(sx, sz, vy * dt);
    if (sinceRecord > 1.6) {
      pts.push({ x, y, z });
      sinceRecord = 0;
    }
    if (y <= level + 0.3 || travelled > L * 1.8) break;
  }
  pts.push({ x, y: Math.max(level + 0.05, y), z });
  // light smoothing, then keep above the terrain
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i + 1];
      pts[i].x = (a.x + pts[i].x * 2 + b.x) / 4;
      pts[i].y = Math.max((a.y + pts[i].y * 2 + b.y) / 4, ground(pts[i].x, pts[i].z) + 0.35);
      pts[i].z = (a.z + pts[i].z * 2 + b.z) / 4;
    }
  }
  return pts;
}

/** Straight free fall from a floating island's rim, `length` metres long. */
export function islandFallPath(start, outward, length) {
  const pts = [];
  const n = Math.max(8, Math.round(length / 3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const drop = t * length;
    const out = 1.2 + Math.sqrt(drop) * 0.9;
    pts.push({ x: start.x + outward.x * out, y: start.y - drop, z: start.z + outward.z * out });
  }
  return pts;
}

/**
 * Builds a ribbon along `pts`. Appends to the arrays in `acc`.
 * opts: { width, widen, island (-1 none), dissolve (0/1), layerOffset }
 */
function addSheet(acc, pts, opts) {
  const { width, widen = 1.25, island = -1, dissolve = 0 } = opts;
  const across = 4;
  let total = 0;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    lens.push(total);
  }
  // horizontal flow direction → sheet side vector
  const f = new THREE.Vector3(pts[pts.length - 1].x - pts[0].x, 0, pts[pts.length - 1].z - pts[0].z);
  if (f.lengthSq() < 1e-4) f.set(opts.outward?.x ?? 1, 0, opts.outward?.z ?? 0);
  f.normalize();
  const side = new THREE.Vector3(-f.z, 0, f.x);
  for (const layer of [0, 1]) {
    const base = acc.pos.length / 3;
    const off = layer === 0 ? 0 : -0.7;
    const wl = layer === 0 ? 1 : 0.82;
    for (let i = 0; i < pts.length; i++) {
      const prog = total > 0 ? lens[i] / total : 0;
      const w = (width * wl * (1 + (widen - 1) * prog) + (dissolve ? prog * prog * width * 4.5 : 0)) / 2;
      for (let j = 0; j <= across; j++) {
        const t = j / across;
        const o = (t - 0.5) * 2 * w;
        acc.pos.push(pts[i].x + side.x * o + f.x * off, pts[i].y, pts[i].z + side.z * o + f.z * off);
        acc.uv.push(t, lens[i]);
        acc.layer.push(layer);
        acc.prog.push(prog);
        acc.island.push(island);
        acc.dissolve.push(dissolve);
        acc.width.push(w * 2);
        acc.n.push(f.x, 0, f.z);
      }
    }
    const row = across + 1;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = 0; j < across; j++) {
        const a = base + i * row + j;
        acc.idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      }
    }
  }
}

export function createWaterfalls(ctx, world, shared, { islandFalls = [], particles = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'atmo-waterfalls';
  const acc = { pos: [], uv: [], layer: [], prog: [], island: [], dissolve: [], width: [], n: [], idx: [] };
  const plunges = []; // {x, y, z, width}

  for (const fall of WATERFALLS) {
    const pts = simulateFallPath(world, fall);
    if (pts.length < 3) continue;
    addSheet(acc, pts, { width: fall.width, widen: 1.3 });
    const end = pts[pts.length - 1];
    plunges.push({ x: end.x, y: Math.max(world.waterLevel ?? 0, end.y - 0.3), z: end.z, width: fall.width, id: fall.id });
  }
  for (const f of islandFalls) {
    addSheet(acc, f.points, { width: f.width, widen: 1.6, island: f.island, dissolve: 1, outward: f.outward });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
  geo.setAttribute('aProg', new THREE.Float32BufferAttribute(acc.prog, 1));
  geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(acc.layer, 1));
  geo.setAttribute('aIsland', new THREE.Float32BufferAttribute(acc.island, 1));
  geo.setAttribute('aDissolve', new THREE.Float32BufferAttribute(acc.dissolve, 1));
  geo.setAttribute('aWidth', new THREE.Float32BufferAttribute(acc.width, 1));
  geo.setAttribute('aNormal2', new THREE.Float32BufferAttribute(acc.n, 3));
  geo.setIndex(acc.idx);
  geo.computeBoundingSphere();
  const sheetMat = new THREE.ShaderMaterial({
    name: 'AtmoWaterfall',
    uniforms: {
      ...fogUniforms(),
      uTime: shared.uTime,
      uNoise: shared.uNoise,
      uSunDir: shared.uSunDir,
      uKeyColor: shared.uKeyColor,
      uSkyAmbient: shared.uAmbientSky,
      uIslandBob: shared.uIslandBob,
    },
    vertexShader: SHEET_VERT,
    fragmentShader: SHEET_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const sheets = new THREE.Mesh(geo, sheetMat);
  sheets.name = 'atmo-waterfall-sheets';
  sheets.frustumCulled = false; // island streams bob outside the static bounds
  sheets.renderOrder = 2;
  group.add(sheets);

  // ---- plunge foam discs (merged quads)
  const fpos = [];
  const fuv = [];
  const fidx = [];
  for (const p of plunges) {
    const r = p.width * 0.95;
    const b = fpos.length / 3;
    const y = (world.waterLevel ?? 0) + 0.08 + Math.max(0, p.y - (world.waterLevel ?? 0));
    fpos.push(p.x - r, y, p.z - r, p.x + r, y, p.z - r, p.x + r, y, p.z + r, p.x - r, y, p.z + r);
    fuv.push(0, 0, 1, 0, 1, 1, 0, 1);
    fidx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const foamGeo = new THREE.BufferGeometry();
  foamGeo.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
  foamGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
  foamGeo.setIndex(fidx);
  foamGeo.computeBoundingSphere();
  const foamMat = new THREE.ShaderMaterial({
    name: 'AtmoPlungeFoam',
    uniforms: {
      ...fogUniforms(),
      uTime: shared.uTime,
      uNoise: shared.uNoise,
      uKeyColor: shared.uKeyColor,
      uSkyAmbient: shared.uAmbientSky,
    },
    vertexShader: FOAM_VERT,
    fragmentShader: FOAM_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: true,
  });
  const foam = new THREE.Mesh(foamGeo, foamMat);
  foam.name = 'atmo-waterfall-foam';
  foam.renderOrder = 1;
  group.add(foam);

  // ---- spray droplets
  const rng = new Rng('atmo-spray');
  const perFall = Math.round(110 * particles);
  const spos = [];
  const seed = [];
  const vel = [];
  for (const p of plunges) {
    const n = Math.round(perFall * Math.min(1.6, p.width / 16));
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, p.width * 0.45);
      spos.push(p.x + Math.cos(a) * r, p.y + 0.3, p.z + Math.sin(a) * r);
      seed.push(rng.random(), rng.random(), rng.range(1.2, 3.4), rng.random());
      vel.push(Math.cos(a) * rng.range(0.5, 2.5), rng.range(0.2, 1.5), Math.sin(a) * rng.range(0.5, 2.5));
    }
  }
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
  sprayGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  sprayGeo.setAttribute('aVel', new THREE.Float32BufferAttribute(vel, 3));
  sprayGeo.computeBoundingSphere();
  const sprayMat = new THREE.ShaderMaterial({
    name: 'AtmoSpray',
    uniforms: {
      uTime: shared.uTime,
      uScale: shared.uPointScale,
      uKeyColor: shared.uKeyColor,
      uSkyAmbient: shared.uAmbientSky,
    },
    vertexShader: SPRAY_VERT,
    fragmentShader: SPRAY_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const spray = new THREE.Points(sprayGeo, sprayMat);
  spray.name = 'atmo-waterfall-spray';
  spray.renderOrder = 3;
  group.add(spray);

  return { group, sheets, foam, spray, plunges, materials: [sheetMat, foamMat, sprayMat] };
}
