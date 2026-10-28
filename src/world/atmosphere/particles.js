import * as THREE from 'three';
import { ZONES, LAKE, CITY_ISLANDS } from '../layout.js';
import { Rng } from '../../core/math.js';

/**
 * Ambient particles (2 draw calls):
 *  - fireflies: warm blinking HDR sparks (bloom) hovering 0.4–3 m above the
 *    ground around the player at dusk/night — dense in the forest around the
 *    base, sparse elsewhere, never over water or in the city. CPU-simulated
 *    (a few hundred points, written into one buffer per frame).
 *  - motes: dust specks that light up when looking toward the sun (sunbeams)
 *    plus fluffy pollen drifting in the breeze by day. Pure GPU: a box of
 *    points wrapped around whichever camera renders.
 */

const FIRE_VERT = /* glsl */ `
attribute vec2 aSeed;
uniform float uTime;
uniform float uScale;
uniform float uIntensity;
varying float vGlow;
void main() {
	vec4 mvPosition = viewMatrix * modelMatrix * vec4( position, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	// max(): GPU sin() may overshoot -1 by an ulp → pow() of a negative base = NaN
	float blink = 0.1 + 0.9 * pow( max( 0.5 + 0.5 * sin( uTime * ( 1.4 + aSeed.y * 2.2 ) + aSeed.x * 31.0 ), 0.0 ), 3.0 );
	vGlow = blink * uIntensity * smoothstep( 110.0, 25.0, - mvPosition.z );
	// tiny sparks: a few pixels even up close (the bloom pass adds the halo)
	gl_PointSize = clamp( ( 0.11 + blink * 0.09 ) * uScale / max( - mvPosition.z, 0.3 ), 1.5, 9.0 );
}
`;

const FIRE_FRAG = /* glsl */ `
varying float vGlow;
void main() {
	vec2 c = gl_PointCoord * 2.0 - 1.0;
	float d = dot( c, c );
	if ( d > 1.0 || vGlow < 0.01 ) discard;
	float core = exp( - d * 6.0 );
	float halo = exp( - d * 2.2 ) * 0.25;
	vec3 col = vec3( 1.0, 0.84, 0.4 ) * ( core * 9.0 + halo * 2.0 ) * vGlow;
	gl_FragColor = vec4( col, ( core + halo ) * min( vGlow * 1.5, 1.0 ) );
}
`;

const MOTE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uScale;
uniform vec3 uSunDir;
uniform float uDust;
uniform float uPollen;
uniform vec3 uWind;
varying float vA;
varying float vKind;
void main() {
	float kind = step( 0.72, aSeed.w ); // 28% pollen
	float box = mix( 26.0, 44.0, kind );
	vec3 drift = uWind * uTime * mix( 0.25, 1.0, kind ) + vec3( sin( uTime * 0.3 + aSeed.x * 20.0 ), sin( uTime * 0.23 + aSeed.y * 17.0 ) * 0.6, cos( uTime * 0.27 + aSeed.z * 13.0 ) ) * mix( 0.6, 1.6, kind );
	vec3 p = position * box + drift;
	vec3 rel = mod( p - cameraPosition + box * 0.5, box ) - box * 0.5;
	vec3 wp = cameraPosition + rel;
	vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	float dist = length( rel );
	vec3 V = rel / max( dist, 1e-3 );
	float beam = pow( max( dot( V, uSunDir ), 0.0 ), 6.0 );
	float fade = smoothstep( box * 0.5, box * 0.25, dist ) * smoothstep( 0.6, 2.5, dist );
	vA = fade * mix( uDust * ( 0.1 + beam * 1.6 ), uPollen * ( 0.5 + beam * 0.8 ), kind );
	vKind = kind;
	gl_PointSize = clamp( mix( 0.03, 0.09, kind ) * uScale / max( - mvPosition.z, 0.3 ), 1.0, 12.0 );
}
`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uKeyColor;
uniform vec3 uSkyAmbient;
varying float vA;
varying float vKind;
void main() {
	vec2 c = gl_PointCoord * 2.0 - 1.0;
	float d = dot( c, c );
	if ( d > 1.0 || vA < 0.004 ) discard;
	float a = ( 1.0 - d ) * vA;
	vec3 col = uKeyColor * mix( 0.5, 0.25, vKind ) + uSkyAmbient * 0.6;
	gl_FragColor = vec4( col, a );
}
`;

export function createParticles(ctx, world, shared, { quality }) {
  const rng = new Rng('atmo-particles');
  const group = new THREE.Group();
  group.name = 'atmo-particles';
  const amount = quality.particles ?? 1;

  // ------------------------------------------------------------ fireflies
  const MAXF = 640;
  const fpos = new Float32Array(MAXF * 3);
  const fseed = new Float32Array(MAXF * 2);
  const fvel = new Float32Array(MAXF * 3);
  const fhome = new Float32Array(MAXF * 3);
  for (let i = 0; i < MAXF; i++) {
    fseed[i * 2] = rng.random();
    fseed[i * 2 + 1] = rng.random();
    fpos[i * 3 + 1] = -1e5; // parked until first spawn
  }
  const fgeo = new THREE.BufferGeometry();
  const fposAttr = new THREE.BufferAttribute(fpos, 3).setUsage(THREE.DynamicDrawUsage);
  fgeo.setAttribute('position', fposAttr);
  fgeo.setAttribute('aSeed', new THREE.BufferAttribute(fseed, 2));
  fgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const fireUniforms = { uTime: shared.uTime, uScale: shared.uPointScale, uIntensity: { value: 0 } };
  const fireMat = new THREE.ShaderMaterial({
    name: 'AtmoFireflies',
    uniforms: fireUniforms,
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const fireflies = new THREE.Points(fgeo, fireMat);
  fireflies.name = 'atmo-fireflies';
  fireflies.frustumCulled = false;
  fireflies.renderOrder = 6;
  group.add(fireflies);

  const base = ZONES.base;
  const level = world.waterLevel ?? 0;
  const ground = (x, z) => {
    const g = world.getHeightAt?.(x, z);
    return Number.isFinite(g) ? g : level;
  };
  /** 0..1 how firefly-friendly a spot is (forest/meadow, not water or city). */
  function habitat(x, z, g) {
    if (g < level + 0.6) return 0;
    for (const c of CITY_ISLANDS) if (Math.hypot(x - c.x, z - c.z) < c.radius) return 0;
    const lx = (x - LAKE.x) / LAKE.radiusX;
    const lz = (z - LAKE.z) / LAKE.radiusZ;
    if (lx * lx + lz * lz < 0.8) return 0.15;
    const dBase = Math.hypot(x - base.x, z - base.z);
    if (dBase < 180) return 1;
    if (Math.hypot(x - ZONES.plaza.x, z - ZONES.plaza.z) < 90) return 0.1;
    return g > 70 ? 0.12 : 0.22; // open meadows and ridges: a few strays
  }
  const RADIUS = 48;
  const camPos = new THREE.Vector3();
  function spawn(i, cx, cz, anywhere) {
    for (let k = 0; k < 6; k++) {
      const a = rng.random() * Math.PI * 2;
      const r = anywhere ? Math.sqrt(rng.random()) * RADIUS : RADIUS * rng.range(0.75, 1);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const g = ground(x, z);
      if (rng.random() > habitat(x, z, g)) continue;
      const y = g + rng.range(0.35, 2.8);
      fpos[i * 3] = fhome[i * 3] = x;
      fpos[i * 3 + 1] = fhome[i * 3 + 1] = y;
      fpos[i * 3 + 2] = fhome[i * 3 + 2] = z;
      fvel[i * 3] = rng.range(-0.3, 0.3);
      fvel[i * 3 + 1] = rng.range(-0.1, 0.1);
      fvel[i * 3 + 2] = rng.range(-0.3, 0.3);
      return;
    }
    fpos[i * 3 + 1] = -1e5;
  }
  let fireInit = false;
  let fireCount = Math.round(MAXF * amount);
  fgeo.setDrawRange(0, fireCount);

  function updateFireflies(dt, t, cam, night) {
    const intensity = THREE.MathUtils.smoothstep(night, 0.15, 0.7);
    fireUniforms.uIntensity.value = intensity;
    fireflies.visible = intensity > 0.01;
    if (!fireflies.visible || !cam) return;
    camPos.copy(cam.position);
    if (!fireInit) {
      for (let i = 0; i < fireCount; i++) spawn(i, camPos.x, camPos.z, true);
      fireInit = true;
    }
    const wobble = Math.min(dt, 0.1);
    for (let i = 0; i < fireCount; i++) {
      const o = i * 3;
      if (fpos[o + 1] < -1e4 || Math.hypot(fpos[o] - camPos.x, fpos[o + 2] - camPos.z) > RADIUS * 1.15) {
        spawn(i, camPos.x, camPos.z, fpos[o + 1] < -1e4 && rng.random() < 0.02);
        continue;
      }
      // wander around the home point
      const s = fseed[i * 2] * 50;
      fvel[o] += (Math.sin(t * 0.7 + s) * 0.6 - (fpos[o] - fhome[o]) * 0.08) * wobble;
      fvel[o + 1] += (Math.sin(t * 1.1 + s * 1.3) * 0.25 - (fpos[o + 1] - fhome[o + 1]) * 0.3) * wobble;
      fvel[o + 2] += (Math.cos(t * 0.6 + s * 0.7) * 0.6 - (fpos[o + 2] - fhome[o + 2]) * 0.08) * wobble;
      fvel[o] *= 0.985;
      fvel[o + 1] *= 0.97;
      fvel[o + 2] *= 0.985;
      fpos[o] += fvel[o] * wobble;
      fpos[o + 1] += fvel[o + 1] * wobble;
      fpos[o + 2] += fvel[o + 2] * wobble;
    }
    fposAttr.needsUpdate = true;
  }

  // ------------------------------------------------------------ motes
  const MAXM = 900;
  const mpos = new Float32Array(MAXM * 3);
  const mseed = new Float32Array(MAXM * 4);
  for (let i = 0; i < MAXM; i++) {
    mpos[i * 3] = rng.random();
    mpos[i * 3 + 1] = rng.random();
    mpos[i * 3 + 2] = rng.random();
    mseed[i * 4] = rng.random();
    mseed[i * 4 + 1] = rng.random();
    mseed[i * 4 + 2] = rng.random();
    mseed[i * 4 + 3] = rng.random();
  }
  const mgeo = new THREE.BufferGeometry();
  mgeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
  mgeo.setAttribute('aSeed', new THREE.BufferAttribute(mseed, 4));
  mgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  mgeo.setDrawRange(0, Math.round(MAXM * amount));
  const moteUniforms = {
    uTime: shared.uTime,
    uScale: shared.uPointScale,
    uSunDir: shared.uSunDir,
    uKeyColor: shared.uKeyColor,
    uSkyAmbient: shared.uAmbientSky,
    uDust: { value: 1 },
    uPollen: { value: 1 },
    uWind: { value: new THREE.Vector3(0.6, 0.05, -0.25) },
  };
  const moteMat = new THREE.ShaderMaterial({
    name: 'AtmoMotes',
    uniforms: moteUniforms,
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const motes = new THREE.Points(mgeo, moteMat);
  motes.name = 'atmo-motes';
  motes.frustumCulled = false;
  motes.renderOrder = 6;
  group.add(motes);

  function update(dt, t, cam, f) {
    updateFireflies(dt, t, cam, f.night);
    const sunUp = THREE.MathUtils.smoothstep(f.sunDir.y, -0.02, 0.12);
    moteUniforms.uDust.value = sunUp * (0.35 + 0.65 * f.twilight);
    moteUniforms.uPollen.value = f.day * 0.5;
    motes.visible = moteUniforms.uDust.value + moteUniforms.uPollen.value > 0.01;
  }

  function setQuality(q) {
    const a = q.particles ?? 1;
    fireCount = Math.round(MAXF * a);
    fgeo.setDrawRange(0, fireCount);
    fireInit = false;
    mgeo.setDrawRange(0, Math.round(MAXM * a));
  }

  return { group, fireflies, motes, update, setQuality };
}
