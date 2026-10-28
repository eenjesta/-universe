/**
 * Vehicles — mode 'drive' (params { vehicle }; entered/left with fade: false).
 * Runs the controller of the boarded vehicle, the third-person chase camera,
 * engine audio loops, night headlights, rotor wash/dust FX, the vehicle HUD,
 * exiting with F at a safe spot beside the vehicle, and the ship launch (L or
 * above 600 m → vehicle:launch + ctx.modes.go('space', { from: 'planet' })).
 * Arrivals from space (explore params { arrival: 'ship' }) put the ship back
 * on its pad.
 *
 * Chase camera: ctx.cameraRig still places the camera (follow distance,
 * collision, zoom, shake, FOV kick) but drive mode owns its yaw/pitch
 * (rig.lookEnabled = false, align 0): the yaw follows the vehicle heading with
 * a short first-order lag (no build-up; the roll is ignored), mouse X steers
 * air vehicles (the camera just stays behind) or looks around in the car /
 * on the ground, and any look offset (yaw or pitch) springs back ~0.9 s after
 * the mouse goes quiet. Mouse yaw is queued ONCE per frame (it used to be
 * applied per physics substep — twice the camera's turn on frames > 21 ms).
 */
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math.js';
import { CarController, AirController, AIR_PROFILES, CAR_TUNING, spring } from './controllers.js';

/** Rig follow options + chase pitch (rad) and heading-follow rate (1/s). */
const CAMERA = {
  car: { distance: 6.6, height: 1.45, minDistance: 3.6, maxDistance: 16, shoulder: 0, aimHeight: 0.28, align: 0, pitch: -0.12, follow: 4.5 },
  vtol: { distance: 15, height: 2.6, minDistance: 7, maxDistance: 45, shoulder: 0, aimHeight: 0.5, align: 0, pitch: -0.2, follow: 9 },
  ship: { distance: 26, height: 4.2, minDistance: 12, maxDistance: 70, shoulder: 0, aimHeight: 0.6, align: 0, pitch: -0.2, follow: 8 },
};
const MOUSE_YAW = 0.0026; // rad per pixel (same as the camera rig)
const MOUSE_PITCH = 0.0021;
const RECENTER_DELAY = 0.9; // s without deliberate mouse movement before the view springs back
const RECENTER_OMEGA = 4.5; // critically damped return (~1.2 s)
const PITCH_MIN = -1.05;
const PITCH_MAX = 0.62;
const AUDIO = { car: 'car.engine', vtol: 'vtol.engine', ship: 'ship.engine' };
const EXIT_SPOTS = {
  car: [[-2.3, 0], [2.3, 0], [0, 3.8], [0, -3.8], [-3.5, 2]],
  vtol: [[-3.2, 1.6], [3.2, 1.6], [0, 7.5], [0, -7.5], [-6, 4]],
  ship: [[5.6, -0.6], [-5.6, 0], [0, 11], [8, 4], [0, -12]],
};
const LAUNCH_ALT = 600;

export function createDrive(ctx, fleet, hud, fx, light) {
  const { input, modes, events } = ctx;
  const car = new CarController(ctx);
  const air = { vtol: new AirController(ctx, AIR_PROFILES.vtol), ship: new AirController(ctx, AIR_PROFILES.ship) };
  const inp = { throttle: 0, steer: 0, handbrake: false, boost: false, forward: 0, strafe: 0, up: 0, yaw: 0, lookX: 0, lookY: 0 };
  // chase camera state: heading follower + spring-back look offsets (yaw, pitch)
  const chase = { yaw: 0, look: { x: 0, v: 0 }, lookP: { x: 0, v: 0 }, idleYaw: 9, idleP: 9, actX: 0, actY: 0 };
  const _v = new THREE.Vector3();
  const _p = { x: 0, y: 0, z: 0 };
  let cur = null;
  let ctrl = null;
  let sound = null;
  let launching = false;
  let warnT = 0;
  let wasLanded = true;

  const drive = {
    get current() {
      return cur;
    },
    controller: () => ctrl,
    launch,
    exit: requestExit,
  };

  function readInput() {
    const on = input.gameEnabled;
    inp.throttle = on ? input.axis('back', 'forward') : 0;
    inp.steer = on ? input.axis('right', 'left') : 0;
    inp.handbrake = on && input.down('Space');
    inp.boost = on && input.action('boost');
    inp.forward = inp.throttle;
    inp.strafe = on ? input.axis('left', 'right') : 0;
    inp.up = on ? (input.action('up') ? 1 : 0) - (input.down('KeyC') || input.down('ControlLeft') ? 1 : 0) : 0;
    inp.yaw = on ? (input.down('KeyQ') ? 1 : 0) - (input.down('KeyE') ? 1 : 0) : 0;
    inp.lookX = on && Number.isFinite(input.lookX) ? input.lookX : 0;
    inp.lookY = on && Number.isFinite(input.lookY) ? input.lookY : 0;
  }

  function resetChase(v) {
    chase.yaw = v.heading;
    chase.look.x = chase.look.v = 0;
    chase.lookP.x = chase.lookP.v = 0;
    chase.idleYaw = chase.idleP = 9;
    chase.actX = chase.actY = 0;
  }

  /** Drive-mode yaw/pitch for the rig (see header). */
  function updateChase(v, dt) {
    const rig = ctx.cameraRig;
    const C = CAMERA[v.type];
    const steering = v.type !== 'car' && ctrl.steering;
    const lx = inp.lookX;
    const ly = inp.lookY;
    // deliberate movement = more than a few pixels within ~0.25 s (jitter never blocks the recentre)
    const fade = Math.exp(-dt / 0.25);
    chase.actX = chase.actX * fade + Math.abs(lx);
    chase.actY = chase.actY * fade + Math.abs(ly);
    if (!steering && lx !== 0) {
      chase.look.x = wrapAngle(chase.look.x - lx * MOUSE_YAW);
      chase.look.v = 0;
      if (chase.actX > 8) chase.idleYaw = 0;
    }
    if (ly !== 0) {
      chase.lookP.x = clamp(chase.lookP.x - ly * MOUSE_PITCH, PITCH_MIN - C.pitch, PITCH_MAX - C.pitch);
      chase.lookP.v = 0;
      if (chase.actY > 8) chase.idleP = 0;
    }
    chase.idleYaw += dt;
    chase.idleP += dt;
    if (steering || chase.idleYaw > RECENTER_DELAY) spring(chase.look, 0, RECENTER_OMEGA, dt);
    if (chase.idleP > RECENTER_DELAY) spring(chase.lookP, 0, RECENTER_OMEGA, dt);
    if (!Number.isFinite(chase.yaw)) chase.yaw = v.heading;
    chase.yaw = wrapAngle(dampAngle(chase.yaw, v.heading, C.follow, dt));
    rig.yaw = wrapAngle(chase.yaw + chase.look.x);
    rig.pitch = clamp(C.pitch + chase.lookP.x, PITCH_MIN, PITCH_MAX);
  }

  // ------------------------------------------------------------ mode
  modes.register('drive', {
    scene: ctx.world.scene,
    camera: ctx.camera,
    pointerLock: true,
    hud: 'drive',
    enter(params = {}) {
      let v = params.vehicle;
      if (typeof v === 'string') v = fleet.list.find((x) => x.id === v) || fleet.list.find((x) => x.type === v);
      if (!v || !CAMERA[v.type]) {
        console.warn('[vehicles] drive entered without a drivable vehicle');
        v = fleet.car;
      }
      cur = v;
      fleet.current = v;
      launching = false;
      v.parked = false;
      v.summoning = null;
      v.object.visible = true;
      fleet.removeBoxes(v);
      ctrl = v.type === 'car' ? car : air[v.type];
      ctrl.reset(v);
      if (v.type === 'ship') {
        v.object.userData.setStairs?.(0);
        ctrl.rotor = 0.2;
      }
      wasLanded = true;
      const pl = ctx.player;
      if (pl) {
        pl.setVisible?.(false);
        pl.onFoot = false;
        pl.state = 'drive';
        pl.velocity?.set?.(0, 0, 0);
      }
      const rig = ctx.cameraRig;
      resetChase(v);
      if (rig) {
        rig.setAim?.(false); // the combat aim framing (close over-the-shoulder) never applies to vehicles
        rig.follow(v.object, CAMERA[v.type]);
        rig.setYaw?.(v.heading, CAMERA[v.type].pitch);
        rig.snap?.();
        rig.zoomEnabled = true;
        // drive mode reads the mouse itself (steering / look-around with recentre)
        rig.lookEnabled = false;
      }
      try {
        sound = ctx.audio.loop(AUDIO[v.type], { volume: 0.9 });
      } catch {
        sound = null;
      }
      if (light && v.type === 'car') {
        v.object.add(light.group);
      }
      hud.setVehicle(v.type, v.name);
      ctx.state.set('player.vehicle', v.type);
      events.emit('vehicle:enter', { type: v.type, id: v.id });
    },
    exit(to) {
      const v = cur;
      if (sound) {
        try {
          sound.stop(0.5);
        } catch {
          /* ignore */
        }
        sound = null;
      }
      if (light) {
        // stay in the world scene (a changing light count would recompile every material)
        ctx.world.scene.add(light.group);
        light.spot.intensity = 0;
      }
      if (ctx.cameraRig) {
        ctx.cameraRig.fovKick = 0;
        ctx.cameraRig.lookEnabled = true;
      }
      fx.clear();
      cur = null;
      fleet.current = null;
      if (!v) return;
      if (to === 'space') {
        v.away = true;
        v.parked = false;
        v.object.visible = false;
        fleet.removeBoxes(v);
      } else {
        // leave it where it stands
        v.parked = true;
        v.speed = 0;
        v.velocity.set(0, 0, 0);
        const ud = v.object.userData;
        if (v.type === 'car') {
          ud.lights.beams.visible = false;
          ud.body.position.set(0, 0, 0);
          ud.body.rotation.set(0, 0, 0);
        } else {
          ud.setGear?.(1);
          ud.setThrust?.(0, 0);
          if (v.type === 'ship') ud.setStairs?.(1);
          v.object.rotation.set(0, v.heading, 0);
        }
        fleet.placeBoxes(v);
      }
      ctx.state.set('player.vehicle', null);
      events.emit('vehicle:exit', { type: v.type, id: v.id });
    },
    update(dt) {
      if (!cur) return;
      dt = Math.min(dt, 0.05);
      readInput();
      const v = cur;
      // mouse yaw is a per-frame delta: queue it once (the substeps ease it in)
      if (v.type !== 'car') ctrl.queueYaw(-inp.lookX * MOUSE_YAW);
      const n = dt > 0.021 ? 2 : 1;
      for (let i = 0; i < n; i++) ctrl.step(dt / n, inp, v);
      ctrl.apply(v);
      // keep the (hidden) player with the vehicle
      const pl = ctx.player;
      if (pl?.position?.isVector3) {
        pl.position.copy(v.object.position);
        pl.object?.position.copy(v.object.position);
      }
      // camera
      const rig = ctx.cameraRig;
      if (rig) {
        if (rig.aiming) rig.setAim(false);
        updateChase(v, dt);
        const speedK = clamp(ctrl.speed / (v.type === 'car' ? CAR_TUNING.maxRoad : AIR_PROFILES[v.type].max));
        rig.fovKick = damp(rig.fovKick || 0, (ctrl.boosting ? 1 : 0) + speedK * 0.35, 3, dt);
        if (ctrl.impact > 3) rig.shake(Math.min(0.7, ctrl.impact / 22));
        if (v.type === 'car' && ctrl.landedImpact > 3) rig.shake(Math.min(0.5, ctrl.landedImpact / 16));
        rig.update(dt);
      }
      ctx.audio.setListener(ctx.camera);
      const night = 1 - clamp((ctx.world.dayFactor ?? 1) / 0.35);
      if (v.type === 'car') updateCar(v, dt, night);
      else updateAir(v, dt);
      fx.update(dt);
      hud.update({
        speed: ctrl.speed,
        max: v.type === 'car' ? CAR_TUNING.maxRoad : AIR_PROFILES[v.type].max,
        altitude: v.type === 'car' ? null : v.object.position.y,
        boost: ctrl.boost,
        boosting: ctrl.boosting,
        handbrake: v.type === 'car' && ctrl.handbrake,
        gear: v.type !== 'car' && ctrl.gear > 0.5,
        landed: v.type !== 'car' && ctrl.landed,
        road: v.type === 'car' && ctrl.road > 0.5,
        launch: v.type === 'ship' && v.object.position.y > LAUNCH_ALT * 0.75,
      });
      warnT = Math.max(0, warnT - dt);
      if (modes.transitioning) return;
      if (input.actionPressed('vehicle')) requestExit();
      if (v.type === 'ship') {
        if (input.actionPressed('launch')) {
          if (ctrl.landed) {
            ctrl.autoLaunch = 0.001;
            ctrl.landed = false;
            ctx.ui.toast({ title: t({ en: 'Launch sequence', nl: 'Lanceersequentie' }), text: t({ en: 'Hold on — leaving the atmosphere.', nl: 'Hou je vast — we verlaten de atmosfeer.' }), icon: 'rocket', kind: 'info', duration: 2600 });
          } else launch();
        }
        if (v.object.position.y > LAUNCH_ALT || (ctrl.autoLaunch > 0 && (ctrl.autoLaunch > 4.2 || ctrl.altitude > 260))) launch();
      }
    },
  });

  function updateCar(v, dt, night) {
    const ud = v.object.userData;
    ud.lights.beams.visible = night > 0.2;
    ud.lights.beamMat.opacity = night;
    const ug = ud.underglow.material;
    ug.opacity = 0.35 + night * 0.65;
    const brake = ctrl.braking || inp.throttle < 0;
    ud.glowMat.color.setScalar(1 + night * 0.4 + (brake ? 0.35 : 0));
    if (light) light.spot.intensity = night * 260;
    if (sound) sound.set({ rpm: ctrl.rpm, load: ctrl.load, boost: ctrl.boosting ? 1 : 0, speed: ctrl.speed });
    // dust off-road / splash in shallow water
    if (ctrl.grounded && ctrl.speed > 7) {
      const p = v.object.position;
      const back = 2.2;
      const bx = p.x + Math.sin(v.heading) * back;
      const bz = p.z + Math.cos(v.heading) * back;
      if (ctrl.inWater > 0.1) fx.wash(bx, p.y, bz, clamp(ctrl.speed / 25) * 0.6, true, dt, 1.4);
      else if (ctrl.road < 0.4 || ctrl.drift > 0.4) {
        const k = clamp(ctrl.speed / 30) * (0.35 + ctrl.drift);
        if (Math.random() < k * dt * 20) fx.emit(bx + (Math.random() - 0.5) * 1.6, p.y + 0.2, bz + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2, 1.4, 1.2, 4.5, 1, 0.28);
      }
    }
  }

  function updateAir(v, dt) {
    const p = v.object.position;
    if (sound) sound.set({ thrust: ctrl.thrust, boost: ctrl.boosting ? 1 : 0, rpm: ctrl.rotor, load: ctrl.thrust, altitude: ctrl.altitude, speed: ctrl.speed });
    // rotor wash / jet wash near the surface
    const range = v.type === 'ship' ? 26 : 18;
    if (ctrl.altitude < range && (!ctrl.landed || ctrl.rotor > 0.5)) {
      const k = clamp(1 - ctrl.altitude / range) * clamp(ctrl.rotor * 1.2);
      fx.wash(p.x, ctrl.surfaceY, p.z, k, ctrl.overWater, dt, v.type === 'ship' ? 9 : 6.5);
    }
    if (ctrl.landed && !wasLanded) events.emit('vehicle:land', { type: v.type, id: v.id });
    wasLanded = ctrl.landed;
  }

  // ------------------------------------------------------------ exit
  function canStand(x, z, nearY) {
    const world = ctx.world;
    const wl = world.waterLevel ?? 0;
    const g = ctx.physics.groundHeight(x, z, nearY + 1.5, 1.6, 0.3);
    const y = Number.isFinite(g) ? g : world.getHeightAt(x, z);
    if (world.isWater?.(x, z) && wl - y > 0.8) return null;
    _p.x = x;
    _p.y = y;
    _p.z = z;
    if (ctx.physics.resolveCylinder(_p, 0.45, 1.8, 0.6)) return null;
    return y;
  }

  function requestExit() {
    const v = cur;
    if (!v || modes.transitioning || launching) return;
    if (v.type !== 'car' && !ctrl.landed && !(ctrl.altitude < 2.5 && ctrl.speed < 6)) {
      if (warnT <= 0) {
        ctx.ui.toast({ title: t({ en: 'Land first', nl: 'Eerst landen' }), text: t({ en: 'Descend with C until you touch down, then press F.', nl: 'Daal met C tot je de grond raakt en druk dan op F.' }), icon: 'plane', kind: 'warn', duration: 2600 });
        warnT = 2.5;
      }
      return;
    }
    if (v.type !== 'car') ctrl.landed = true;
    const o = v.object;
    o.updateMatrixWorld(true);
    let spot = null;
    for (const [lx, lz] of EXIT_SPOTS[v.type]) {
      _v.set(lx, 0, lz);
      o.localToWorld(_v);
      const y = canStand(_v.x, _v.z, o.position.y);
      if (y != null) {
        spot = { x: _v.x, z: _v.z };
        break;
      }
    }
    if (!spot) spot = { x: o.position.x - Math.cos(v.heading) * 3, z: o.position.z + Math.sin(v.heading) * 3 };
    // face the vehicle when stepping out
    const heading = Math.atan2(-(o.position.x - spot.x), -(o.position.z - spot.z));
    modes.go('explore', { position: { x: spot.x, z: spot.z, heading } }, { fade: false });
  }

  // ------------------------------------------------------------ launch / arrival
  function spaceIsFallback() {
    const s = ctx.space;
    if (!s) return true;
    return Object.keys(s).every((k) => k === 'scene' || k === 'camera');
  }

  function launch() {
    const v = cur;
    if (!v || v.type !== 'ship' || launching || modes.transitioning) return;
    launching = true;
    events.emit('vehicle:launch', { type: 'ship', id: v.id });
    if (!modes.has('space')) {
      launching = false;
      ctx.ui.toast({ title: t({ en: 'Space is out of reach', nl: 'De ruimte is onbereikbaar' }), text: t({ en: 'The launch systems are offline.', nl: 'De lanceersystemen zijn offline.' }), icon: 'rocket', kind: 'warn' });
      return;
    }
    const fallback = spaceIsFallback();
    modes.go('space', { from: 'planet' }).then(() => {
      launching = false;
      if (fallback) {
        ctx.ui.toast({ title: t({ en: 'In orbit', nl: 'In een baan' }), text: t({ en: 'Press L to land back at the spaceport.', nl: 'Druk op L om terug te landen bij de ruimtehaven.' }), icon: 'rocket', kind: 'info', duration: 5000 });
      }
    });
  }

  // the fallback space mode has no way home: L lands back at the spaceport
  ctx.loop.add(
    'veh-space-return',
    () => {
      if (!modes.transitioning && input.actionPressed('launch') && spaceIsFallback()) modes.go('explore', { zone: 'spaceport', arrival: 'ship' });
    },
    { order: 21, when: () => modes.is('space') },
  );

  events.on('mode:change', ({ to, params }) => {
    if (to !== 'explore' || params?.arrival !== 'ship') return;
    const ship = fleet.ship;
    fleet.sendHome(ship);
    ship.object.updateMatrixWorld(true);
    _v.set(5.4, 0, -0.6);
    ship.object.localToWorld(_v);
    const heading = Math.atan2(-(ship.object.position.x - _v.x), -(ship.object.position.z - _v.z));
    ctx.player?.teleport?.({ x: _v.x, z: _v.z }, heading);
  });

  return drive;
}
