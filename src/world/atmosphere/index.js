import * as THREE from 'three';
import { DEG, smoothstep } from '../../core/math.js';
import { installFogChunks, setFog, setFogEnabled } from './fog.js';
import { createNoiseTexture, createWaterNormals, createFlareAtlas } from './textures.js';
import { createSunOcclusion } from './occlusion.js';
import { DEFAULT_HOUR, HOURS_PER_SECOND, BODIES, wrapHour, sunAngles, dirFromAzEl, factors } from './time.js';
import { createPaletteState, evaluatePalette } from './palette.js';
import { createSky } from './sky.js';
import { createLighting } from './lighting.js';
import { createReflection } from './reflection.js';
import { createWater } from './water.js';
import { createRivers } from './rivers.js';
import { createWaterfalls } from './waterfalls.js';
import { createIslands } from './islands.js';
import { createMist } from './mist.js';
import { createParticles } from './particles.js';
import { createFlare } from './flare.js';

/**
 * Atmosphere half of the world (ARCHITECTURE.md §5, world contract):
 * time of day, sky + giant planet + moons + stars + clouds, sun/planet key
 * light with camera-following shadows, hemisphere fill, atmospheric fog,
 * PMREM environment from the sky, colour grade/bloom/exposure per time,
 * lake/sea water with planar reflections, rivers, waterfalls, floating
 * islands, mist banks, fireflies/dust/pollen and a lens flare.
 *
 * Sets on `world`: sun, hemi, timeOfDay, setTimeOfDay, sunDirection,
 * dayFactor, atmosphere. Emits 'world:time' {hour, dayFactor}. Owns
 * state.world.time (flows while settings.timeFlow, 1 game hour = 2 min,
 * paused on the title screen so the poster shot holds).
 */
export async function installAtmosphere(ctx, world, { progress = () => {} } = {}) {
  const scene = world.scene;
  const engine = ctx.engine;
  const renderer = engine.renderer;
  let quality = engine.quality;
  const idle = () => new Promise((r) => setTimeout(r, 0));

  installFogChunks();
  scene.fog = new THREE.FogExp2(0xb09aa0, 0.0003);
  scene.background = null;

  // ------------------------------------------------------------ shared state
  const noise = createNoiseTexture(256);
  const shared = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.32, 0.09, -0.94).normalize() },
    uKeyColor: { value: new THREE.Color() },
    uSunSpec: { value: new THREE.Color() },
    uAmbientSky: { value: new THREE.Color(0.2, 0.2, 0.3) },
    uNoise: { value: noise.texture },
    uWaterNormals: { value: createWaterNormals(256) },
    uEnvMap: { value: null },
    uIslandBob: { value: new Float32Array(16) },
    uIslandBounce: { value: new THREE.Color() }, // warm light bounced up from the lit land onto island undersides
    uPointScale: { value: 600 },
  };
  if (!world.sunDirection?.isVector3) world.sunDirection = new THREE.Vector3();
  progress(0.08);
  await idle();

  // ------------------------------------------------------------ sky + lights
  const sky = createSky(ctx, shared, { quality });
  scene.add(sky.mesh);
  const lighting = createLighting(ctx, world);
  world.sun = lighting.sun;
  world.hemi = lighting.hemi;
  progress(0.25);
  await idle();

  // ------------------------------------------------------------ water
  const reflection = createReflection(ctx, world, { scale: 0.5 });
  reflection.state.enabled = quality.id === 'high';
  // grass blades are invisible in a half-resolution mirror but cost a full set of draw calls
  if (world.terrain?.grass?.group) reflection.exclude(world.terrain.grass.group);
  const water = createWater(ctx, world, shared, reflection);
  scene.add(water.mesh);
  reflection.exclude(water.mesh);
  reflection.hooks.before.push(() => {
    sky.uniforms.uSunDiscOn.value = 0;
  });
  reflection.hooks.after.push(() => {
    sky.uniforms.uSunDiscOn.value = 1;
  });
  const rivers = createRivers(ctx, world, shared);
  scene.add(rivers.group);
  reflection.exclude(rivers.group);
  progress(0.4);
  await idle();

  // ------------------------------------------------------------ islands, falls, mist
  const islands = createIslands(ctx, world, shared, { quality });
  scene.add(islands.group);
  const falls = createWaterfalls(ctx, world, shared, { islandFalls: islands.falls, particles: quality.particles ?? 1 });
  scene.add(falls.group);
  reflection.exclude(falls.foam);
  reflection.exclude(falls.spray);
  const mist = createMist(ctx, world, shared, { plunges: falls.plunges, islandStreams: islands.falls, density: quality.id === 'low' ? 0.6 : 1 });
  scene.add(mist.mesh);
  reflection.exclude(mist.mesh);
  progress(0.6);
  await idle();

  // ------------------------------------------------------------ particles, flare
  const particles = createParticles(ctx, world, shared, { quality });
  scene.add(particles.group);
  reflection.exclude(particles.group);
  const flare = createFlare(ctx, world, createFlareAtlas());
  scene.add(flare.mesh);
  reflection.exclude(flare.mesh);
  progress(0.75);

  // ------------------------------------------------------------ time of day
  const pal = createPaletteState();
  const angles = { el: 0, az: 0 };
  const f = { day: 1, night: 0, twilight: 0, sunDim: 0, hour: DEFAULT_HOUR, sunDir: world.sunDirection, planetDir: sky.planetDir };
  const rawSaved = ctx.state.get('world.time');
  const saved = rawSaved == null || rawSaved === '' ? NaN : Number(rawSaved); // null must not mean midnight
  const time = {
    hour: Number.isFinite(saved) ? wrapHour(saved) : DEFAULT_HOUR,
    lastEmit: -1,
    lastSave: 0,
    envHour: -99,
    envSunY: -9,
    envDirty: true,
  };

  function computeTime() {
    sunAngles(time.hour, angles);
    dirFromAzEl(angles.az, angles.el, world.sunDirection);
    shared.uSunDir.value.copy(world.sunDirection);
    factors(Math.sin(angles.el), f);
    f.hour = time.hour;
    world.timeOfDay = time.hour;
    world.dayFactor = f.day;
    evaluatePalette(angles.el / DEG, pal);
  }

  // clouds in front of the sun (CPU replica of the sky shader's cloud layers)
  const sunOcclusion = createSunOcclusion(noise, sky.uniforms);

  // ------------------------------------------------------------ apply per frame
  const tmpCam = new THREE.Vector3();
  const drawSize = new THREE.Vector2();
  function applyAll(dt, cam) {
    sky.update(pal, f, cam, dt);
    // fog matched to the sky horizon
    scene.fog.color.copy(pal.horizon);
    scene.fog.density = pal.fogDensity;
    setFog({
      sunColor: pal.horizonSun,
      exponent: pal.sunExp,
      sunDir: world.sunDirection,
      density: pal.heightFog,
      scaleHeight: pal.fogHeight,
      glow: pal.glow,
      glowScale: pal.fogGlow,
      falloff: pal.hazeFall,
    });
    lighting.update(pal, f);
    // colours for the custom (non-PBR) atmosphere materials
    shared.uKeyColor.value.copy(lighting.sun.color).multiplyScalar(lighting.sun.visible ? lighting.sun.intensity : 0);
    const amb = shared.uAmbientSky.value;
    amb.r = (pal.zenith.r * 0.35 + pal.mid.r * 0.4 + pal.horizon.r * 0.25) * 1.35;
    amb.g = (pal.zenith.g * 0.35 + pal.mid.g * 0.4 + pal.horizon.g * 0.25) * 1.35;
    amb.b = (pal.zenith.b * 0.35 + pal.mid.b * 0.4 + pal.horizon.b * 0.25) * 1.35;
    shared.uSunSpec.value.copy(pal.disc).multiplyScalar(0.42 * (1 - f.sunDim * 0.8));
    const bounce = shared.uIslandBounce.value.copy(shared.uKeyColor.value).multiplyScalar(0.05);
    bounce.r += amb.r * 0.5;
    bounce.g += amb.g * 0.5;
    bounce.b += amb.b * 0.5;
    water.uniforms.uGlintDir.value.copy(sky.planetDir);
    water.uniforms.uGlintSpec.value.copy(pal.planetLight).multiplyScalar(f.night * 9);
    // low mist is a dawn/dusk/night phenomenon: thin by day, thick at golden hour
    mist.uniforms.uDensity.value = 0.45 + f.twilight * 0.75 + f.night * 0.45;
    if (cam) particles.update(dt, shared.uTime.value, cam, f);
    flare.state.sunDir.copy(world.sunDirection);
    flare.state.strength = smoothstep(-0.01, 0.05, world.sunDirection.y) * (1 - f.night);
    flare.state.cloud = f.sunDim;
  }

  function captureEnv(cam) {
    tmpCam.copy(cam?.position || tmpCam.set(0, 50, 150));
    const tex = sky.captureEnvironment(tmpCam);
    if (scene.environment !== tex) scene.environment = tex;
    time.envHour = time.hour;
    time.envSunY = world.sunDirection.y;
    time.envDirty = false;
  }

  function emitTime(force) {
    if (!force && Math.abs(time.hour - time.lastEmit) < 1 / 60 && time.lastEmit >= 0) return;
    time.lastEmit = time.hour;
    ctx.events.emit('world:time', { hour: time.hour, dayFactor: world.dayFactor });
  }

  function persist() {
    ctx.state.set('world.time', Math.round(time.hour * 1000) / 1000);
  }

  world.setTimeOfDay = (h) => {
    time.hour = wrapHour(h);
    computeTime();
    f.sunDim = 0;
    applyAll(0, engine.camera);
    lighting.applyPost(pal);
    // the PMREM refresh is deferred to the next world tick: setTimeOfDay stays cheap
    time.envDirty = true;
    persist();
    emitTime(true);
  };

  // ------------------------------------------------------------ render hooks
  let renderDepth = 0;
  const prevBefore = scene.onBeforeRender;
  const prevAfter = scene.onAfterRender;
  scene.onBeforeRender = function (r, sc, camera, target) {
    renderDepth++;
    setFogEnabled(true);
    if (camera !== reflection.camera && camera.isCamera) lighting.placeShadow(camera);
    prevBefore?.call(this, r, sc, camera, target);
  };
  scene.onAfterRender = function (r, sc, camera) {
    renderDepth = Math.max(0, renderDepth - 1);
    if (renderDepth === 0) setFogEnabled(false);
    prevAfter?.call(this, r, sc, camera);
  };

  // ------------------------------------------------------------ loop
  let sunDimSmooth = 0;
  let saveTimer = 0;
  ctx.loop.add(
    'world-atmosphere',
    (dt, t) => {
      const cam = engine.camera;
      shared.uTime.value = t;
      const flow = ctx.state.data?.settings?.timeFlow !== false && !ctx.modes.is('title', 'boot');
      if (flow && dt > 0) time.hour = wrapHour(time.hour + dt * HOURS_PER_SECOND);
      computeTime();
      // terrain may hand over its height texture late
      if (world.heightTexture && water.uniforms.uHeightTex.value !== world.heightTexture) {
        water.attachHeight(world.heightTexture);
        mist.attachHeight(world.heightTexture, water.uniforms.uHeightXform.value);
      }
      if (cam) {
        sunDimSmooth += (sunOcclusion.atSun(world.sunDirection, cam.position) - sunDimSmooth) * (1 - Math.exp(-dt * 1.5));
        f.sunDim = sunDimSmooth;
        renderer.getDrawingBufferSize(drawSize);
        shared.uPointScale.value = drawSize.y / (2 * Math.tan(((cam.fov || 55) * Math.PI) / 360));
        flare.state.camera = cam;
        water.view.camera = cam;
        flare.cpuOcclusion(cam);
      }
      islands.update(t);
      applyAll(dt, cam);
      lighting.applyPost(pal);
      // refresh the environment capture when the sky changed noticeably
      const dh = Math.abs(time.hour - time.envHour);
      if (time.envDirty || Math.min(dh, 24 - dh) > 0.12 || Math.abs(world.sunDirection.y - time.envSunY) > 0.02) captureEnv(cam);
      if (flow) {
        saveTimer += dt;
        if (saveTimer > 2) {
          saveTimer = 0;
          persist();
        }
      }
      emitTime(false);
    },
    { order: 10, when: () => engine.scene === scene },
  );

  // ------------------------------------------------------------ quality / reset
  ctx.events.on('quality:change', (q) => {
    quality = q || engine.quality;
    reflection.state.enabled = quality.id === 'high';
    lighting.setShadowSize(quality.shadowMapSize);
    particles.setQuality(quality);
    sky.setQuality(quality);
    captureEnv(engine.camera);
  });
  ctx.events.on('state:reset', () => world.setTimeOfDay(DEFAULT_HOUR));

  // ------------------------------------------------------------ initial state
  computeTime();
  applyAll(0, engine.camera);
  lighting.applyPost(pal);
  captureEnv(null);
  progress(1);

  world.atmosphere = {
    sky,
    water,
    rivers,
    waterfalls: falls,
    islands,
    mist,
    particles,
    flare,
    reflection,
    lighting,
    palette: pal,
    factors: f,
    planetDirection: sky.planetDir,
    moonDirections: [sky.moonADir, sky.moonBDir],
    /** The sky bodies (drawn analytically in the sky shader): unit directions + angular radii (radians). */
    bodies: {
      planet: { direction: sky.planetDir, radius: BODIES.planet.radius },
      moons: [
        { direction: sky.moonADir, radius: BODIES.moonA.radius },
        { direction: sky.moonBDir, radius: BODIES.moonB.radius },
      ],
    },
    /** 0 by day … 1 at night. */
    get nightFactor() {
      return f.night;
    },
    /** Sun elevation in radians. */
    get sunElevation() {
      return angles.el;
    },
    /** Hide an object from the water's planar reflection. */
    excludeFromReflection: (o) => reflection.exclude(o),
    /** Set post.enabled = false or post.override = {exposure, bloomStrength, …} to take over the grade. */
    post: lighting.post,
    /** Forces an environment-map refresh (e.g. after big scene changes). */
    refreshEnvironment: () => captureEnv(engine.camera),
  };
  return world.atmosphere;
}
