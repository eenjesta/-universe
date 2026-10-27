/**
 * Landmarks module — Aurora-stad, Nexus-plein (+ Levensboom, Starfall stage,
 * lantern bazaar / Nachtmarkt), Uitkijkpost, Oude ruïnes, Het signaal,
 * Ruimtehaven, the glass house at the base, sailboats and the lakeside
 * promenade. Everything is procedural and placed with ctx.world.getHeightAt;
 * every building/wall/platform registers physics boxes; emissive lights
 * follow ctx.world.dayFactor through shared shader uniforms.
 *
 * API (ctx.landmarks), see ARCHITECTURE.md §5:
 *   objects {city, plaza, lookout, ruins, beacon, spaceport, house, lake}
 *   plaza {center, tree, treeInfo, walkPoints, benches, spawnPoints, spawn, stage{crowdPoints, setShow, position}, setShow(on), market, bazaar{oran, …}}
 *   ruins {scanPoints, runeStones[{stand, center}], relief, reliefNormal, gate, setScanned(bool), setScanProgress(0…1)}
 *   beacon {position, top, emblem, front, setActive(bool) (false = dormant look), active}
 *   lookout {top, stairStart{position, heading}, stairPath}
 *   spaceport {pads{ship|vtol|car|colony: {x, z, rotY, position, radius}}, hangar, tower}
 *   house {position, rotY, door, front, landingPad}
 *   city {center, top, islands}
 *   lake {boats, promenade{walkPoints, benches, jetty}}
 *   spawnFor(zoneId) → {x, z, heading} free spot near a zone (optional helper)
 *   setNightOverride(v|null) — debug: force the night factor (0 day … 1 night)
 *   groundStats {grassTexels, vegetation} — terrain grass / plants cleared under the footprints
 *
 * Files: materials.js (shared patched shaders + day/night/sun uniforms) ·
 * textures.js (canvas textures) · common.js (GeoBuilder merge helper, Frame,
 * sweeps, footprints, baked lantern light) · city.js + cityBuildings.js +
 * cityTraffic.js (skyline, viaduct traffic) · groundClear.js (no grass /
 * trees inside built-up footprints) · plaza.js +
 * tree.js + stage.js + bazaar.js + flora.js (Nexus-plein) · lookout.js ·
 * ruins.js · beacon.js · spaceport.js · house.js · lake.js · markers.js
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { createMaterials } from './materials.js';
import { makeGround } from './common.js';
import { buildCity } from './city.js';
import { buildPlaza } from './plaza.js';
import { buildLookout } from './lookout.js';
import { buildRuins } from './ruins.js';
import { buildBeacon } from './beacon.js';
import { buildSpaceport } from './spaceport.js';
import { buildHouse } from './house.js';
import { buildLake } from './lake.js';
import { installMarkers } from './markers.js';
import { clearGrass, clearVegetation } from './groundClear.js';

const VISIBLE_MODES = ['title', 'explore', 'drive'];

export async function install(ctx, { progress = () => {} } = {}) {
  const world = ctx.world;
  const scene = world?.scene;
  if (!scene) throw new Error('landmarks: ctx.world.scene missing');

  // canvas text textures use the Jost webfont: give it a moment to load
  try {
    await Promise.race([document.fonts?.load?.('500 64px Jost'), new Promise((r) => setTimeout(r, 1200))]);
  } catch {
    /* ignore */
  }

  const root = new THREE.Group();
  root.name = 'landmarks';
  scene.add(root);

  const mats = createMaterials(ctx);
  const ground = makeGround(world);
  // physics proxy: remembers the boxes of the part being built so a failing
  // part can be rolled back without leaving invisible colliders behind
  let partBoxes = [];
  const physics = ctx.physics
    ? {
        addBox(o) {
          const id = ctx.physics.addBox(o);
          partBoxes.push(id);
          return id;
        },
      }
    : null;
  const env = { ctx, scene, root, mats, physics, ground, quality: ctx.engine?.quality || {} };

  let nightOverride = null;
  const api = {
    objects: {},
    city: null,
    plaza: null,
    ruins: null,
    beacon: null,
    lookout: null,
    spaceport: null,
    house: null,
    lake: null,
    markers: [],
    errors: [],
    /** A free, sensible spot to put the player when arriving at a zone. */
    spawnFor(id) {
      const z = ZONES[id];
      if (!z) return null;
      if (id === 'plaza' && api.plaza?.spawn) return { ...api.plaza.spawn };
      if (id === 'lookout' && api.lookout?.stairStart) {
        const p = api.lookout.stairStart.position;
        return { x: p.x - 2.5, z: p.z + 2.5, heading: api.lookout.stairStart.heading };
      }
      if (id === 'signal' && api.beacon?.position) {
        const b = api.beacon.position;
        return { x: b.x + 2, z: b.z + 15, heading: 0 };
      }
      if (id === 'base' && api.house?.front) {
        const f = api.house.front;
        return { x: f.x + 6, z: f.z + 4, heading: Math.PI / 2 };
      }
      if (id === 'spaceport' && api.spaceport?.pads?.ship) {
        const p = api.spaceport.pads.ship;
        return { x: p.x + 14, z: p.z + 26, heading: 0.5 };
      }
      return { x: z.x, z: z.z, heading: z.heading || 0 };
    },
    setNightOverride(v) {
      nightOverride = v == null ? null : THREE.MathUtils.clamp(v, 0, 1);
    },
    /** Optional: warm up every landmark shader (e.g. while the title screen shows). */
    precompile() {
      const r = ctx.engine?.renderer;
      return r?.compileAsync ? r.compileAsync(root, ctx.camera, scene).catch(() => {}) : Promise.resolve();
    },
  };
  const updaters = [];

  const steps = [
    ['city', () => buildCity(env)],
    ['plaza', () => buildPlaza(env)],
    ['lookout', () => buildLookout(env, ZONES.lookout)],
    ['ruins', () => buildRuins(env, ZONES.ruins)],
    ['beacon', () => buildBeacon(env, ZONES.signal)],
    ['spaceport', () => buildSpaceport(env)],
    ['house', () => buildHouse(env)],
    ['lake', () => buildLake(env)],
  ];

  const t0 = performance.now();
  const timings = {};
  for (let i = 0; i < steps.length; i++) {
    const [name, build] = steps[i];
    partBoxes = [];
    const tp = performance.now();
    try {
      const res = build();
      if (res) {
        if (res.group) {
          root.add(res.group);
          api.objects[name] = res.group;
        }
        api[name] = res;
        if (res.update) updaters.push(res.update);
      }
    } catch (err) {
      console.error(`[landmarks] building "${name}" failed`, err);
      for (const id of partBoxes) ctx.physics.remove(id);
      api.errors.push({ part: name, error: String(err?.stack || err) });
    }
    timings[name] = Math.round(performance.now() - tp);
    progress((i + 1) / steps.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  partBoxes = [];

  // promenade benches are part of the plaza's social space
  if (api.plaza && api.lake?.promenade?.benches?.length) api.plaza.benches.push(...api.lake.promenade.benches);

  // built-up footprints: no terrain grass through floors, no forest trees / rocks in buildings
  try {
    const shapes = [];
    const discs = [];
    for (const [name] of steps) {
      if (api[name]?.groundShapes) shapes.push(...api[name].groundShapes);
      if (api[name]?.clearDiscs) discs.push(...api[name].clearDiscs);
    }
    api.groundStats = { grassTexels: clearGrass(world, shapes), vegetation: clearVegetation(world, discs) };
  } catch (err) {
    console.warn('[landmarks] ground clearing failed', err);
  }

  try {
    api.markers = installMarkers(ctx, api, ground);
  } catch (err) {
    console.error('[landmarks] markers failed', err);
    api.errors.push({ part: 'markers', error: String(err?.stack || err) });
  }

  // quality changes: thin out particles / foliage instances
  ctx.events?.on?.('quality:change', (q) => {
    for (const k of Object.keys(api)) api[k]?.setQuality?.(q);
  });

  // fallback environment for metallic materials if the atmosphere set none
  mats.ensureEnvironment(ctx.engine?.renderer, scene);
  api.timings = { ...timings, totalMs: Math.round(performance.now() - t0) };
  console.log(`[landmarks] installed in ${api.timings.totalMs} ms ${JSON.stringify(timings)} ground ${JSON.stringify(api.groundStats || {})}`);

  // ------------------------------------------------------------ update loop
  const U = mats.U;
  // perceptual night factor: golden hour (dayFactor ≈ 0.43) → ≈ 0.4, dusk → ≈ 0.85, night → 1
  const nightTarget = () => (nightOverride != null ? nightOverride : THREE.MathUtils.smoothstep(1 - (world.dayFactor ?? 1), 0.25, 1));
  U.uNight.value = nightTarget();
  ctx.loop.add(
    'landmarks',
    (dt, t) => {
      U.uTime.value = t;
      // sun for the backlit skyline rim (copied, no allocations)
      if (world.sunDirection?.isVector3) U.uSunDir.value.copy(world.sunDirection);
      const sun = world.sun;
      if (sun?.color) U.uSunCol.value.copy(sun.color).multiplyScalar(sun.visible === false ? 0 : sun.intensity ?? 1);
      const target = nightTarget();
      const n = U.uNight.value;
      U.uNight.value = Math.abs(target - n) > 0.3 ? target : n + (target - n) * Math.min(1, dt * 1.5);
      // additive light pools: faint by day, full at night, a bit more during the show
      mats.pool.color.setScalar(THREE.MathUtils.lerp(0.1, 0.42, U.uNight.value) * (1 + U.uShow.value * 0.4));
      const cam = ctx.engine?.camera || ctx.camera;
      for (const fn of updaters) fn(dt, cam, t);
    },
    { order: 15, when: () => ctx.engine?.scene === scene || (ctx.modes?.is?.(...VISIBLE_MODES) ?? true) },
  );

  return api;
}
