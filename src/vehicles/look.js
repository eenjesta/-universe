/**
 * Vehicles — readability "look" driver (per frame, no allocations, no lights).
 *
 * At golden hour the spaceport apron and the base clearing lie in terrain
 * shadow, and at night everything is dark: the dark hulls read as black
 * silhouettes. This drives the fake-light uniforms of materials.js
 * (patchFill) instead of adding shadow-casting lights:
 *   mats.shipFill — the parked spaceship: camera-side fill + glint, fresnel rim,
 *                   warm pad uplight + the light pool on the pad (userData.pool);
 *   mats.fill     — VTOLs / car / stairs: lighter fill + rim only (they are
 *                   driven around, so no pad uplight).
 * Strength follows the sun height (golden hour / night) and the terrain sun
 * visibility (world.terrain.sunVisibility.sample, 4×/s, smoothed) at the ship
 * — and at the driven car / VTOL for mats.fill — so lit daytime vehicles are
 * unchanged. ctx.vehicles.look.params tunes it live. NaN-safe inputs.
 */
import * as THREE from 'three';
import { clamp, damp } from '../core/math.js';

export const LOOK = {
  fill: 1, // camera-side fill (× albedo)
  spec: 1, // fill glint
  rim: 1, // fresnel rim
  up: 1, // pad uplight on the parked ship's belly
  pool: 1, // light pool on the pad
  fleet: 0.6, // VTOL / car share of fill + rim
};

const WARM = new THREE.Color(1.0, 0.62, 0.36);
const NIGHT = new THREE.Color(0.5, 0.58, 0.82);
const DAY = new THREE.Color(0.86, 0.9, 1.0);
const FLOOD = new THREE.Color(1.0, 0.74, 0.48);

export function createLook(ctx, fleet, mats) {
  const P = { ...LOOK };
  const world = ctx.world;
  const col = new THREE.Color();
  const rimCol = new THREE.Color();
  const camPos = new THREE.Vector3();
  // terrain sun visibility (0 shade … 1 sun), sampled 4×/s and smoothed (no popping at shadow edges):
  // at the ship, and at the driven car / VTOL (they share mats.fill; parked they follow the ship's)
  let vis = 1;
  let visTo = 1;
  let fvis = 1;
  let fvisTo = 1;
  let visT = 0;
  let first = true;
  let parkedK = 1;
  const sampleVis = (p) => {
    try {
      const s = world.terrain?.sunVisibility?.sample?.(p.x, p.z, p.y + 2);
      return Number.isFinite(s) ? clamp(s) : 1;
    } catch {
      return 1;
    }
  };

  function setFill(U, base, k, specK, rimK, upK) {
    U.uFillCol.value.copy(base).multiplyScalar(k);
    U.uFillSpec.value.copy(base).multiplyScalar(specK);
    U.uRimCol.value.copy(rimCol).multiplyScalar(rimK);
    U.uUpCol.value.copy(FLOOD).multiplyScalar(upK);
  }

  return {
    params: P,
    /** Last computed factors (debug). */
    state: { lowSun: 0, night: 0, shade: 0, fill: 0, fleetFill: 0, pool: 0 },
    update(dt) {
      if (!mats.fill || !mats.shipFill) return;
      const f = world.atmosphere?.factors;
      // (core clamp() passes NaN through: guard the inputs so no NaN reaches the uniforms)
      const night = clamp(Number.isFinite(f?.night) ? f.night : 0);
      const sy = world.sunDirection?.y;
      const sunY = Number.isFinite(sy) ? sy : 0.5;
      const lowSun = clamp(1 - sunY / 0.45) * (1 - night); // golden hour (0 at noon and at night)
      const ship = fleet.ship;
      const so = ship?.object;
      // terrain shade at the ship (the apron sits in a ridge shadow at golden hour)
      visT -= dt;
      if (visT <= 0 && so) {
        visT = 0.25;
        visTo = sampleVis(so.position);
        const cur = fleet.current;
        fvisTo = cur && cur !== ship && cur.object ? sampleVis(cur.object.position) : visTo;
        if (first) {
          first = false;
          vis = visTo;
          fvis = fvisTo;
        }
      }
      vis = damp(vis, visTo, 4, dt);
      fvis = damp(fvis, fvisTo, 4, dt);
      const shade = (1 - vis) * (1 - night);
      // colours: neutral by day → golden → cool night
      col.copy(DAY).lerp(WARM, clamp(lowSun * 1.3)).lerp(NIGHT, night);
      rimCol.copy(WARM).lerp(NIGHT, night);
      const fillK = 0.08 + 1.1 * lowSun * (0.4 + 0.6 * shade) + 0.72 * night;
      const fleetFillK = 0.08 + 1.1 * lowSun * (0.4 + 0.6 * (1 - fvis) * (1 - night)) + 0.72 * night;
      const specK = 0.1 + 0.6 * lowSun + 0.4 * night;
      const rimK = 0.05 + 0.55 * lowSun + 0.45 * night;
      // the parked ship: full set + pad light
      const parked = !!(ship && ship.parked && !ship.away && !ship.summoning && so?.visible);
      parkedK = damp(parkedK, parked ? 1 : 0, 2.5, dt);
      const upK = (0.25 * lowSun * (0.4 + 0.6 * shade) + 0.95 * night) * parkedK;
      setFill(mats.shipFill, col, P.fill * fillK, P.spec * specK, P.rim * rimK, P.up * upK);
      // VTOLs / car: lighter, no pad light
      setFill(mats.fill, col, P.fill * P.fleet * fleetFillK, P.spec * P.fleet * specK, P.rim * P.fleet * rimK, 0);
      // light pool on the ship's pad (fades out with camera distance: it is unfogged)
      const pool = so?.userData?.pool;
      let poolK = 0;
      if (pool) {
        const cam = ctx.camera;
        camPos.setFromMatrixPosition(cam.matrixWorld);
        const d = camPos.distanceTo(so.position);
        const fade = clamp(1 - (d - 160) / 260);
        poolK = P.pool * parkedK * fade * (0.13 * lowSun * (0.35 + 0.65 * shade) + 0.3 * night);
        pool.visible = poolK > 0.004;
        if (pool.visible) pool.material.color.copy(FLOOD).multiplyScalar(poolK);
      }
      const st = this.state;
      st.lowSun = lowSun;
      st.night = night;
      st.shade = shade;
      st.fill = fillK;
      st.fleetFill = fleetFillK;
      st.pool = poolK;
    },
  };
}
