/**
 * Space module (Ø Universe) — mode 'space': flight above the home planet.
 *
 * install(ctx) builds its own THREE.Scene + camera (procedural sky cube,
 * planet, gas giant, sun + flare, ≥1500-rock asteroid field, Station Halo,
 * nebula gas, the anomaly, the derelict "Silver Horizon", convoy + wingmen +
 * pirates), registers mode 'space' (params {from, stage}; URL hook
 * ?mode=space&stage=station|convoy|anomaly|wreck) and returns ctx.space:
 *
 *   scene, camera, previewCamera, renderPreview(w, h) → canvas   (title card 4)
 *   ship        the player ship ({position, velocity, quaternion, shield, hull, …})
 *   station     {position, radius, dockRadius, dock, object}
 *   anomaly / wreck / convoy   Object3Ds (quest markers read .position)
 *   targets     {station, anomaly, convoy, wreck} → Vector3
 *   stage(id)   jump to a stage spawn while in space
 *   debug       state(), killNearest(), completeScan(id), clearWaves(), arrive(), dock()
 * Events: space:enter {from, stage}, space:scan {target}, space:convoy {status},
 *         space:dock {station}, space:kill {enemy}, space:damage {shield, hull}.
 * Return to the planet: L → ctx.modes.go('explore', {zone: 'spaceport', arrival: 'ship'}).
 */
import './space.css';
import * as THREE from 'three';
import { createSky, SUN_DIR, SUN_COLOR } from './sky.js';
import { createAsteroidField } from './asteroids.js';
import { createStation } from './station.js';
import { createNebula, createAnomaly } from './nebula.js';
import { createWreckModel, createColonyFallback } from './models.js';
import { createFx } from './fx.js';
import { createCombat, BOLT_COLORS } from './combat.js';
import { createShips } from './ships.js';
import { createPlayer } from './flight.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { SPACE } from './layout.js';

const POST = {
  bloomStrength: 0.45,
  bloomRadius: 0.42,
  bloomThreshold: 1.0,
  exposure: 1.0,
  saturation: 1.1,
  contrast: 1.06,
  vignette: 0.4,
};

/** Wraps the vehicles module's colony model (any scale) to ~250 m, front −Z. */
function normalizeColony(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const len = Math.max(size.x, size.y, size.z, 1);
  const wrap = new THREE.Group();
  const k = 250 / len;
  obj.scale.multiplyScalar(k);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
  obj.position.sub(c);
  wrap.add(obj);
  const ud = obj.userData || {};
  wrap.userData = {
    kind: 'colony',
    radius: 135,
    length: 250,
    setThrust: typeof ud.setThrust === 'function' ? ud.setThrust : () => {},
    // vehicles' update is (dt, t); ours passes the game time
    update: typeof ud.update === 'function' ? (time) => ud.update(1 / 60, time) : () => {},
  };
  return wrap;
}

async function loadColonyFactory() {
  try {
    const mods = import.meta.glob('../vehicles/colony-model.js');
    const loader = mods['../vehicles/colony-model.js'];
    if (!loader) return null;
    const m = await loader();
    if (typeof m.createColonyShipModel !== 'function') return null;
    // probe once so a broken external model falls back cleanly
    const make = () => m.createColonyShipModel({ length: 250, legs: false, lights: 1.3 });
    const probe = make();
    if (!probe?.isObject3D) return null;
    let first = probe;
    return () => {
      const o = first || make();
      first = null;
      return normalizeColony(o);
    };
  } catch (err) {
    console.warn('[space] vehicles colony model unavailable, using the fallback', err);
    return null;
  }
}

export async function install(ctx, { progress = () => {} } = {}) {
  const quality = ctx.engine.quality;
  const idle = () => new Promise((r) => setTimeout(r, 0));
  const scene = new THREE.Scene();
  scene.name = 'space';
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / Math.max(1, window.innerHeight), 0.5, 60000);
  camera.name = 'space-camera';
  const S = { ctx, scene, camera, time: 0, quality, boltColor: BOLT_COLORS.player, sparkColor: new THREE.Color(4, 3, 2) };

  // ---------------------------------------------------------- sky + light
  const sky = createSky(ctx, { quality });
  S.sky = sky;
  scene.add(sky.group, sky.flare);
  scene.background = sky.background;
  scene.backgroundIntensity = 1;
  scene.environment = sky.environment;
  scene.environmentIntensity = 0.5;
  scene.onBeforeRender = (renderer, sc, cam) => sky.place(cam);
  const sun = new THREE.DirectionalLight(SUN_COLOR, 3.6);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  const hemi = new THREE.HemisphereLight(0x2e3a58, 0x120a14, 0.5);
  // cool fill from the south-below (planetshine-like): reads the hulls facing the chase/approach cameras
  const fill = new THREE.DirectionalLight(new THREE.Color(0.55, 0.66, 0.95), 1.1);
  fill.position.set(0.3, -0.45, 0.85).multiplyScalar(1000);
  scene.add(sun, hemi, fill);
  progress(0.25);
  await idle();

  // ---------------------------------------------------------- world content
  S.field = createAsteroidField(ctx, { quality });
  scene.add(S.field.group);
  progress(0.45);
  await idle();
  S.station = createStation(ctx, { quality });
  scene.add(S.station.group);
  S.nebula = createNebula(ctx, { quality });
  scene.add(S.nebula.group);
  S.anomaly = createAnomaly(ctx, { quality });
  scene.add(S.anomaly.group);
  const wreck = createWreckModel();
  wreck.position.copy(SPACE.wreck);
  wreck.rotation.set(0.3, 1.1, 0.4);
  scene.add(wreck);
  S.wreck = { object: wreck, position: wreck.position, radius: 160 };
  progress(0.6);
  await idle();

  // ---------------------------------------------------------- actors
  S.fx = createFx(ctx, { quality });
  scene.add(S.fx.group);
  S.combat = createCombat(S);
  scene.add(S.combat.group);
  const colonyFactory = (await loadColonyFactory()) || (() => createColonyFallback());
  S.ships = createShips(S, { colonyFactory });
  const player = createPlayer(S);
  scene.add(player.object);
  S.missions = createMissions(S);
  S.hud = createHud(S);
  progress(0.85);

  // scan beam (ship → scan target)
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(1.2, 3.2, 4.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.frustumCulled = false;
  beam.visible = false;
  scene.add(beam);

  // initial pose (also what the title preview shows)
  const spawnFwd = new THREE.Vector3(0, Math.sin(SPACE.spawn.pitch), -1).normalize();
  player.reset(SPACE.spawn.position, SPACE.spawn.position.clone().addScaledVector(spawnFwd, 800), 0);
  player.model.userData.setThrust(0.7, 0);

  // ---------------------------------------------------------- post look
  const saved = {};
  function applyPost() {
    const e = ctx.engine;
    if (e.bloom) {
      e.bloom.strength = POST.bloomStrength;
      e.bloom.radius = POST.bloomRadius;
      e.bloom.threshold = POST.bloomThreshold;
    }
    const g = e.grade?.uniforms;
    if (g) {
      g.uSaturation.value = POST.saturation;
      g.uContrast.value = POST.contrast;
      g.uVignette.value = POST.vignette;
      g.uShadowTint.value.setRGB(0.9, 0.95, 1.1);
      g.uHighlightTint.value.setRGB(1.06, 1.0, 0.93);
      if (g.uExposure) g.uExposure.value = 1;
    }
    e.renderer.toneMappingExposure = POST.exposure;
  }
  function savePost() {
    const e = ctx.engine;
    const g = e.grade?.uniforms;
    saved.bloom = e.bloom ? [e.bloom.strength, e.bloom.radius, e.bloom.threshold] : null;
    saved.grade = g ? [g.uSaturation.value, g.uContrast.value, g.uVignette.value, g.uShadowTint.value.clone(), g.uHighlightTint.value.clone(), g.uExposure?.value] : null;
    saved.exposure = e.renderer.toneMappingExposure;
  }
  function restorePost() {
    const e = ctx.engine;
    const g = e.grade?.uniforms;
    if (saved.bloom && e.bloom) [e.bloom.strength, e.bloom.radius, e.bloom.threshold] = saved.bloom;
    if (saved.grade && g) {
      g.uSaturation.value = saved.grade[0];
      g.uContrast.value = saved.grade[1];
      g.uVignette.value = saved.grade[2];
      g.uShadowTint.value.copy(saved.grade[3]);
      g.uHighlightTint.value.copy(saved.grade[4]);
      if (g.uExposure && saved.grade[5] != null) g.uExposure.value = saved.grade[5];
    }
    e.renderer.toneMappingExposure = saved.exposure;
  }

  // ---------------------------------------------------------- sun occlusion (10 Hz)
  const ray = new THREE.Vector3();
  const rayEnd = new THREE.Vector3();
  let sunVis = 1;
  let occT = 0;
  function sunVisible(cam) {
    ray.setFromMatrixPosition(cam.matrixWorld);
    rayEnd.copy(ray).addScaledVector(SUN_DIR, 4000);
    if (S.field.segmentHit(ray, rayEnd, 0) >= 0) return 0;
    const st = S.station;
    const toSt = rayEnd.copy(st.position).sub(ray);
    const along = toSt.dot(SUN_DIR);
    if (along > 0 && toSt.lengthSq() - along * along < (st.radius + 300) ** 2) {
      let tt = Math.max(0, along - st.radius - 400);
      for (let i = 0; i < 48 && tt < along + st.radius + 400; i++) {
        rayEnd.copy(ray).addScaledVector(SUN_DIR, tt);
        const d = st.sdf(rayEnd);
        if (d < 2) return 0;
        tt += Math.max(d, 6);
      }
    }
    for (const e of S.ships.list) {
      if (!e.alive || !e.convoy) continue;
      toSt.copy(e.position).sub(ray);
      const a = toSt.dot(SUN_DIR);
      if (a > 0 && toSt.lengthSq() - a * a < (e.kind === 'colony' ? 45 : 18) ** 2) return 0;
    }
    return 1;
  }

  // ---------------------------------------------------------- mode
  ctx.modes.register('space', {
    scene,
    camera,
    pointerLock: true,
    hud: 'space',
    enter(params = {}, from = null) {
      applyPost();
      camera.fov = 62;
      camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      camera.updateProjectionMatrix();
      S.missions.enter(params, from);
      player.updateCamera(1 / 60, camera);
      player.startSound();
      ctx.audio.setListener?.(camera);
    },
    exit() {
      player.stopSound();
      S.missions.exit();
      beam.visible = false;
    },
    update(dt) {
      S.time += dt;
      applyPost();
      player.update(dt);
      player.updateCamera(dt, camera);
    },
  });

  ctx.loop.add(
    'space-sim',
    (dt) => {
      const tt = S.time;
      S.ships.update(dt, tt);
      S.combat.update(dt);
      S.missions.update(dt);
      S.field.update(dt, tt, camera);
      S.station.update(dt, tt);
      S.nebula.update(dt, tt);
      const sc = S.missions.scan;
      S.anomaly.update(dt, tt, camera, sc.active?.id === 'anomaly' ? 1 : 0);
      wreck.userData.update?.(tt);
      occT -= dt;
      if (occT <= 0) {
        occT = 0.1;
        sunVis = sunVisible(camera);
      }
      sky.update(camera, dt, tt, sunVis);
      S.fx.update(dt, camera, player.velocity, player.boosting ? 1 : 0);
      // scan beam
      const scanning = sc.active && sc.progress > 0 && ctx.input.down('KeyE');
      beam.visible = !!scanning;
      if (scanning) {
        const a = beamGeo.attributes.position;
        ray.set(0, -0.6, -8).applyQuaternion(player.quaternion).add(player.position);
        a.setXYZ(0, ray.x, ray.y, ray.z);
        const tp = sc.active.obj.position;
        a.setXYZ(1, tp.x + Math.sin(tt * 13) * 6, tp.y + Math.cos(tt * 11) * 6, tp.z);
        a.needsUpdate = true;
        beam.material.opacity = 0.5 + 0.5 * Math.sin(tt * 30);
      }
    },
    { order: 32, when: () => ctx.modes.is('space') },
  );
  ctx.loop.add('space-hud', (dt) => S.hud.update(dt, S.time), { order: 92, when: () => ctx.modes.is('space') });

  // ---------------------------------------------------------- title preview
  const previewCamera = new THREE.PerspectiveCamera(52, 16 / 9, 0.5, 60000);
  {
    const sp = SPACE.spawn.position;
    previewCamera.position.set(sp.x + 12, sp.y + 7, sp.z + 30);
    previewCamera.lookAt(sp.x - 120, sp.y + 40, sp.z - 900);
    previewCamera.updateMatrixWorld();
  }
  const spawnQ = player.quaternion.clone();
  const keepPos = new THREE.Vector3();
  const keepQ = new THREE.Quaternion();
  function renderPreview(width = 320, height = 180) {
    savePost();
    applyPost();
    // pose the ship at the arrival point (where the preview camera frames it)
    keepPos.copy(player.position);
    keepQ.copy(player.quaternion);
    const wasVisible = player.object.visible;
    player.position.copy(SPACE.spawn.position);
    player.quaternion.copy(spawnQ);
    player.object.visible = true;
    player.object.updateMatrixWorld(true);
    try {
      previewCamera.aspect = width / height;
      previewCamera.updateProjectionMatrix();
      S.field.update(0, 0, previewCamera);
      sky.update(previewCamera, 1, 0, 1);
      return ctx.engine.snapshot(scene, previewCamera, width, height);
    } finally {
      player.position.copy(keepPos);
      player.quaternion.copy(keepQ);
      player.object.visible = wasVisible;
      restorePost();
    }
  }

  progress(1);
  const api = {
    scene,
    camera,
    previewCamera,
    renderPreview,
    ship: player,
    player,
    station: { position: S.station.position, radius: S.station.radius, dockRadius: S.station.dockRadius, dock: S.station.dock, object: S.station.group },
    anomaly: S.anomaly.group,
    wreck,
    convoy: S.ships.colony.object,
    targets: { station: S.station.position, anomaly: S.anomaly.position, convoy: S.ships.colony.position, wreck: wreck.position },
    layout: SPACE,
    stage: (id) => S.missions.placeStage(id),
    land: () => S.missions.land(),
    internals: S,
    debug: {
      state: () => ({
        mode: ctx.modes.name,
        pos: player.position.toArray().map(Math.round),
        speed: Math.round(player.speed),
        throttle: +player.throttle.toFixed(2),
        shield: Math.round(player.shield),
        hull: Math.round(player.hull),
        heat: +player.heat.toFixed(2),
        missiles: player.missiles,
        alive: player.alive,
        lock: S.combat.lock?.id || null,
        pirates: S.ships.pirates(),
        convoy: { state: S.ships.convoy.state, s: Math.round(S.ships.convoy.s), length: Math.round(S.ships.convoy.length), mission: S.missions.convoyMission.state, wave: S.missions.convoyMission.wave },
        dock: { state: S.missions.dock.state, distance: Math.round(S.missions.dock.distance) },
        scans: Object.fromEntries(S.missions.scans.map((s) => [s.id, s.done])),
        asteroids: S.field.count,
      }),
      killNearest() {
        let best = null;
        let bd = Infinity;
        for (const e of S.ships.list) {
          if (!e.alive || e.team !== 'pirate') continue;
          const d = e.position.distanceTo(player.position);
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
        if (best) S.ships.kill(best, true);
        return best?.id || null;
      },
      completeScan: (id) => S.missions.debug.completeScan(id),
      clearWaves: () => S.missions.debug.clearWaves(),
      arrive: () => S.missions.debug.arrive(),
      dock: () => S.missions.startDocking(),
    },
  };
  return api;
}
