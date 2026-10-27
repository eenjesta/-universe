import * as THREE from 'three';
import { DEG } from '../../core/math.js';
import { BODIES, STAR_POLE, dirFromAzEl, bodyLightDir } from './time.js';
import { FOG } from './fog.js';
import { bakeBodyTexture } from './planet-texture.js';
import { SKY_VERTEX, SKY_FRAGMENT } from './sky-glsl.js';

/**
 * Sky dome + celestial bodies + clouds (one analytic shader, see sky-glsl.js)
 * and the environment capture:
 *   sky shader → equirect HDR target (no sun disc, no stars) → PMREM → scene.environment
 * The equirect target doubles as a cheap reflection map for water/rivers/
 * waterfalls (sampled with equirectUv). The capture is refreshed by the
 * caller when the time of day changed noticeably.
 */

const CITY = new THREE.Vector3(60, 0, -820);
// how far body lighting is pulled toward the viewer: the sun sets only ~22°
// from the planet, which would leave a thin crescent; the poster shows a
// pale, mostly lit gibbous planet with a soft terminator toward the upper left
const PHOTO_K = 1.15;
const PHOTO_K_MOON = 1.3; // moons read as bright gibbous discs (poster), not dark half-moons

export function createSky(ctx, shared, { quality }) {
  const renderer = ctx.engine.renderer;
  const high = quality.id !== 'low';

  const planetRT = bakeBodyTexture(renderer, 0, high ? 1024 : 512, high ? 512 : 256);
  const moonRT = bakeBodyTexture(renderer, 1, 512, 256);

  const planetDir = dirFromAzEl(BODIES.planet.az, BODIES.planet.el);
  const moonADir = dirFromAzEl(BODIES.moonA.az, BODIES.moonA.el);
  const moonBDir = dirFromAzEl(BODIES.moonB.az, BODIES.moonB.el);

  // Planet frame: X ≈ toward the viewer (texture seam on the far side), Y = spin
  // axis (tilted in the image plane, then leaned toward us), Z completes it.
  const X0 = planetDir.clone().negate();
  const Y0 = new THREE.Vector3(0, 1, 0).addScaledVector(X0, -X0.y).normalize().applyAxisAngle(X0, BODIES.planet.tilt);
  const Z = new THREE.Vector3().crossVectors(X0, Y0).normalize();
  const lean = BODIES.planet.axisLean;
  const Y = Y0.clone().multiplyScalar(Math.cos(lean)).addScaledVector(X0, Math.sin(lean)).normalize();
  const X = X0.clone().multiplyScalar(Math.cos(lean)).addScaledVector(Y0, -Math.sin(lean)).normalize();
  const planetFrame = new THREE.Matrix3().set(X.x, X.y, X.z, Y.x, Y.y, Y.z, Z.x, Z.y, Z.z);
  // rings lie in the equatorial plane: with the small axis lean they are seen
  // nearly edge-on — a thin ellipse tilted with the spin axis (04_alien_jungle)
  const ringNormal = Y.clone();

  const uniforms = {
    uSunDir: shared.uSunDir,
    uSunDisc: { value: new THREE.Color() },
    uSunRadius: { value: 0.85 * DEG },
    uSunDiscOn: { value: 1 },
    uZenith: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uFogSun: { value: FOG.sun }, // shared with the fog: warm horizon colour + azimuth exponent
    uGroundHaze: { value: new THREE.Color() },
    uGlow: { value: new THREE.Vector4() }, // rgb sun glow (HDR), w = warm-band falloff
    uSkyShape: { value: new THREE.Vector4(0.6, 0.5, 0.3, 0) }, // sun-side brightening, mid height, zenith start
    uCityDir: { value: new THREE.Vector3(0, 0, -1) },
    uCityGlow: { value: new THREE.Color() },
    uTime: shared.uTime,
    uStars: { value: 0 },
    uStarRot: { value: new THREE.Matrix3() },
    uNoise: shared.uNoise,
    uCamPos: { value: new THREE.Vector3() },

    uPlanetDir: { value: planetDir },
    uPlanetSin: { value: Math.sin(BODIES.planet.radius) },
    uPlanetFrame: { value: planetFrame },
    uPlanetTex: { value: planetRT.texture },
    uPlanetLightL: { value: new THREE.Vector3() },
    uPlanetLightW: { value: new THREE.Vector3() },
    uPlanetLightCol: { value: new THREE.Color() },
    uPlanetDark: { value: new THREE.Color() },
    uPlanetRim: { value: new THREE.Color() },
    uPlanetSpin: { value: 0 },
    uPlanetOccl: { value: 0.62 }, // how much sky the planet body hides (rest = our own atmosphere's in-scatter)
    uRingNormal: { value: ringNormal },
    uRing: { value: new THREE.Vector4(1.38, 2.05, 0.12, 0) }, // inner/outer radius (planet radii), opacity
    uRingColor: { value: new THREE.Color(0.86, 0.82, 0.78) },

    uMoonTex: { value: moonRT.texture },
    uMoonA: { value: new THREE.Vector4(moonADir.x, moonADir.y, moonADir.z, Math.sin(BODIES.moonA.radius)) },
    uMoonB: { value: new THREE.Vector4(moonBDir.x, moonBDir.y, moonBDir.z, Math.sin(BODIES.moonB.radius)) },
    uMoonALight: { value: new THREE.Vector3() },
    uMoonBLight: { value: new THREE.Vector3() },
    uMoonATint: { value: new THREE.Color(1.08, 0.9, 0.88) },
    uMoonBTint: { value: new THREE.Color(0.92, 0.94, 1.0) },

    uCloud: { value: new THREE.Vector4(0.44, 0.92, 3800, 4200) }, // cover, opacity, deck height (m), feature scale (m)
    uCloudWind: { value: new THREE.Vector4(0.3, 0.7, 0, 0) },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uBand: { value: new THREE.Vector4(0.55, 0.07, 0.0, 0.95) }, // horizon banks: cover, height (sin el), drift (turns), opacity
    uBandLit: { value: new THREE.Color() },
    uBandShade: { value: new THREE.Color() },
    uEquirect: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    name: 'AtmoSky',
    uniforms,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.DoubleSide, // same program for the dome (back faces) and the capture quad
    depthWrite: false,
    depthTest: true, // drawn last among opaques at the far plane: only uncovered pixels pay for the sky
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.name = 'atmo-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 999;
  mesh.matrixAutoUpdate = false;
  // keep the CPU-side camera position uniform in sync with whoever renders
  mesh.onBeforeRender = (r, s, camera) => {
    uniforms.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  };

  // ------------------------------------------------------------ environment
  // the capture reuses the dome's material/program (uEquirect switches the mapping)
  const envQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  envQuad.frustumCulled = false;
  const envScene = new THREE.Scene();
  envScene.add(envQuad);
  const envCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let envW = high ? 512 : 256;
  const makeEquirect = (w) =>
    new THREE.WebGLRenderTarget(w, w / 2, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  let equirect = makeEquirect(envW);
  equirect.texture.name = 'atmo-sky-equirect';
  shared.uEnvMap.value = equirect.texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  let pmremTarget = null;

  /** Re-renders the equirect sky capture and its PMREM; returns the PMREM texture. */
  function captureEnvironment(camPos) {
    uniforms.uCamPos.value.copy(camPos);
    const prev = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const stars = uniforms.uStars.value;
    const disc = uniforms.uSunDiscOn.value;
    uniforms.uEquirect.value = 1;
    uniforms.uStars.value = 0; // stars/sun disc stay out of the lighting environment
    uniforms.uSunDiscOn.value = 0;
    renderer.autoClear = true;
    renderer.setRenderTarget(equirect);
    renderer.render(envScene, envCam);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAuto;
    uniforms.uEquirect.value = 0;
    uniforms.uStars.value = stars;
    uniforms.uSunDiscOn.value = disc;
    pmremTarget = pmrem.fromEquirectangular(equirect.texture, pmremTarget);
    return pmremTarget.texture;
  }

  function setQuality(q) {
    const w = q.id === 'low' ? 256 : 512;
    if (w === envW) return;
    envW = w;
    equirect.dispose();
    equirect = makeEquirect(w);
    shared.uEnvMap.value = equirect.texture;
    pmremTarget?.dispose();
    pmremTarget = null;
  }

  // ------------------------------------------------------------ per frame
  const starRot4 = new THREE.Matrix4();
  const tmpL = new THREE.Vector3();
  const cityDir = new THREE.Vector3();

  /**
   * @param pal  evaluated palette
   * @param f    { hour, day, night, sunDir }
   * @param cam  camera (for the city glow direction)
   */
  function update(pal, f, cam, dt) {
    const u = uniforms;
    u.uZenith.value.copy(pal.zenith);
    u.uMid.value.copy(pal.mid);
    u.uHorizon.value.copy(pal.horizon);
    u.uGroundHaze.value.copy(pal.ground);
    u.uGlow.value.set(pal.glow.r, pal.glow.g, pal.glow.b, pal.hazeFall);
    u.uSkyShape.value.set(pal.sunSide, pal.midH, pal.zenH, 0);
    u.uSunDisc.value.copy(pal.disc);
    u.uStars.value = pal.stars;
    u.uCloudLit.value.copy(pal.cloudLit);
    u.uCloudShade.value.copy(pal.cloudShade);
    u.uCloud.value.x = pal.cloudCover;
    u.uCloud.value.y = pal.cloudOpacity;
    // wind: ~9 m/s drift of the cloud deck (in noise-tile units)
    u.uCloudWind.value.x += (dt * 9.0) / u.uCloud.value.w;
    u.uCloudWind.value.y += (dt * 3.5) / u.uCloud.value.w;
    // distant cumulus banks: very slow drift along the horizon (≈1 turn per 6 h)
    u.uBand.value.set(pal.bandCover, pal.bandHeight, (u.uBand.value.z + dt / 21600) % 1, pal.bandOpacity);
    u.uBandLit.value.copy(pal.bandLit);
    u.uBandShade.value.copy(pal.bandShade);

    // stars turn once per day around the pole
    starRot4.makeRotationAxis(STAR_POLE, (f.hour / 24) * Math.PI * 2);
    u.uStarRot.value.setFromMatrix4(starRot4);

    // bodies lit by the sun (pulled toward the viewer for photogenic phases)
    bodyLightDir(f.sunDir, planetDir, PHOTO_K, tmpL);
    u.uPlanetLightW.value.copy(tmpL);
    u.uPlanetLightL.value.copy(tmpL).applyMatrix3(planetFrame);
    bodyLightDir(f.sunDir, moonADir, PHOTO_K_MOON, u.uMoonALight.value);
    bodyLightDir(f.sunDir, moonBDir, PHOTO_K_MOON, u.uMoonBLight.value);
    u.uPlanetLightCol.value.copy(pal.planetLight);
    u.uPlanetDark.value.copy(pal.planetDark);
    u.uPlanetRim.value.copy(pal.rim);
    u.uPlanetSpin.value = (f.hour / 24) * 0.25; // slow visible rotation of the bands

    // night glow over Aurora-stad
    if (cam) {
      cityDir.set(CITY.x - cam.position.x, 0, CITY.z - cam.position.z);
      if (cityDir.lengthSq() > 1) cityDir.normalize();
      u.uCityDir.value.copy(cityDir);
      const near = 1 - Math.min(1, Math.max(0, (cam.position.distanceTo(CITY) - 300) / 1800));
      u.uCityGlow.value.setRGB(0.32, 0.16, 0.42).multiplyScalar(f.night * (0.035 + 0.06 * near));
    }
  }

  return {
    mesh,
    material,
    uniforms,
    planetDir,
    moonADir,
    moonBDir,
    planetFrame,
    planetTexture: planetRT.texture,
    get equirect() {
      return equirect;
    },
    get envTexture() {
      return pmremTarget?.texture || null;
    },
    captureEnvironment,
    setQuality,
    update,
    dispose() {
      material.dispose();
      mesh.geometry.dispose();
      envQuad.geometry.dispose();
      equirect.dispose();
      pmremTarget?.dispose();
      pmrem.dispose();
      planetRT.dispose();
      moonRT.dispose();
    },
  };
}
