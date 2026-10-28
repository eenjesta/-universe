/**
 * Third-person camera rig (characters module) → ctx.cameraRig.
 *
 * Over-the-shoulder framing like the poster (character lower-left/centre,
 * looking past them), pointer-lock / drag mouse look, wheel zoom, collision
 * with terrain + physics boxes (segmentHit), FOV kick while sprinting, subtle
 * step sway, trauma shake. follow(object, opts) is reused by vehicles:
 *   ctx.cameraRig.follow(car.object, { distance: 7, height: 1.6, shoulder: 0, align: 2 });
 *   ctx.cameraRig.update(dt);   // from the vehicle mode's update
 * Aim mode (combat): setAim(true) eases to a closer over-the-shoulder framing with a
 * narrower FOV and finer mouse look (settings in rig.aim); aimRay() → { origin, dir,
 * near } is the camera-centre ray (near = distance to the followed target along it, so
 * hits in front of the player can be ignored). Without aiming nothing changes.
 * First person: setFirstPerson({ target, eye(out, rig) → Vector3, pitchOff, roll }) registers the
 * eye provider (first-person.js); setView('first' | 'third') eases between the over-the-shoulder
 * framing and the eye (rig.fpW 0…1, ~0.3 s) — same yaw/pitch, wider pitch range, FOV = rig.fov
 * (settings.fov), tiny near plane, gentler shake, aimRay from the eye. While zoom is enabled,
 * scrolling in past the closest distance enters first person and scrolling out leaves it
 * (rig.onViewRequest(view) is called so the owner can persist it). fpBlock (e.g. 'dead') suspends FP.
 * pitchRange → [min, max] of the current view (clamp external pitch changes such as recoil with it).
 */
import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math.js';

const FP_TIME = 0.32; // s for a full third ↔ first transition
const NEAR_3P = 0.15;
const NEAR_FP = 0.06;
const sstep = (x) => x * x * (3 - 2 * x);

export function createCameraRig(ctx) {
  const camera = ctx.camera;
  const focus = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const pivot = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const back = new THREE.Vector3();
  const right = new THREE.Vector3();
  const look = new THREE.Vector3();
  const seg = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  let shakeT = 0;
  let trauma = 0;
  let idleLook = 0;
  let colDist = null;
  let initialised = false;
  let focusTarget = null;
  let savedZoom = null;
  const focusOpts = { distance: 2.3, pitch: -0.04, rate: 3 };
  const fp = new THREE.Vector3();
  let aimOn = false;
  const ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), near: 0, direction: null };
  ray.direction = ray.dir; // alias
  // ---- first person
  let fpProv = null; // eye provider { target, eye(out, rig), pitchOff, roll }
  let fpP = 0; // linear transition progress (fpW = smoothstep(fpP))
  let zoomInAcc = 0;
  const eye = new THREE.Vector3();
  const pRange = [-1.15, 0.72];
  const qFp = new THREE.Quaternion();
  const eFp = new THREE.Euler(0, 0, 0, 'YXZ');

  const rig = {
    camera,
    yaw: 0,
    pitch: -0.1,
    distance: 3.4,
    height: 1.52,
    minDistance: 1.3,
    maxDistance: 12,
    shoulder: 0.48,
    aimHeight: 0.22,
    align: 0,
    focusRate: 22, // follow(…, { focusRate })
    target: null,
    zoomEnabled: true,
    lookEnabled: true,
    baseFov: 55,
    fovKick: 0, // set by the controller (0..1) while sprinting
    sway: 0, // step sway amount (0..1), set by the controller
    swayPhase: 0,
    rightVec: new THREE.Vector3(1, 0, 0), // camera right on the XZ plane (read by others)
    _zoom: 3.4,
    /** Aim framing (combat): distance, shoulder offset, extra height, FOV, look sensitivity, blend rate; fpZoom = FP aim FOV factor. */
    aim: { distance: 1.5, shoulder: 0.64, height: 0.06, fov: 45, look: 0.78, rate: 9, fpZoom: 0.74 },
    aimW: 0, // 0 explore … 1 fully aimed (smoothed)
    // ---- first person
    view: 'third', // requested view ('third' | 'first'); setView()
    fpW: 0, // 0 third … 1 first (eased)
    fpBlock: null, // reason FP is suspended (e.g. 'dead' → death cam in third person)
    fov: 70, // first-person FOV (settings.fov); third person uses baseFov + (fov − 70) × 0.5
    onViewRequest: null, // (view) => void — scroll-zoom asked for another view

    /** Over-the-shoulder aim mode on/off (smooth transition). */
    setAim(on) {
      aimOn = !!on;
    },
    get aiming() {
      return aimOn;
    },

    /** Registers the first-person eye provider { target: Object3D, eye(out, rig), pitchOff?, roll? }. */
    setFirstPerson(provider) {
      fpProv = provider || null;
    },

    /** 'first' | 'third' — eases there (instant with snap). */
    setView(v, { snap = false } = {}) {
      rig.view = v === 'first' ? 'first' : 'third';
      zoomInAcc = 0;
      if (snap) {
        fpP = rig.view === 'first' && rig.fpAllowed ? 1 : 0;
        rig.fpW = sstep(fpP);
      }
    },

    /** True when FP can show now (provider registered, following its target, not blocked). */
    get fpAllowed() {
      return !!fpProv && rig.target === fpProv.target && !rig.fpBlock;
    },
    /** The camera is (mostly) at the eye. */
    get firstPerson() {
      return rig.fpW > 0.5;
    },
    /** [min, max] pitch of the current view (first person looks almost straight up / down); reused array. */
    get pitchRange() {
      return pRange;
    },

    /** The camera-centre ray { origin, dir (= direction), near } (reused object; valid after update()). */
    aimRay() {
      const cam = camera;
      ray.origin.setFromMatrixPosition(cam.matrixWorld);
      ray.dir.set(0, 0, -1).transformDirection(cam.matrixWorld);
      ray.near = 0;
      if (rig.fpW > 0.5) ray.near = 0.22; // the eye: only the own capsule lies in front
      else if (rig.target) {
        rig.target.getWorldPosition(tmp);
        tmp.y += rig.height;
        ray.near = Math.max(0, tmp.sub(ray.origin).dot(ray.dir));
      }
      return ray;
    },

    /**
     * Follow an object. opts: { distance, height, minDistance, maxDistance,
     * shoulder, aimHeight, align (auto-yaw rate behind the target's heading, 0 = off),
     * focusRate (how tightly the framing follows the target, 1/s: horizontal; vertical ≈ 0.4×;
     * default 22 — raise it for fast vehicles), snap (jump immediately) }
     */
    follow(object, opts = {}) {
      const changed = rig.target !== object;
      rig.target = object;
      rig.focusRate = Number.isFinite(opts.focusRate) && opts.focusRate > 0 ? opts.focusRate : 22;
      if (opts.distance != null) rig._zoom = rig.distance = opts.distance;
      if (opts.height != null) rig.height = opts.height;
      if (opts.minDistance != null) rig.minDistance = opts.minDistance;
      if (opts.maxDistance != null) rig.maxDistance = opts.maxDistance;
      if (opts.shoulder != null) rig.shoulder = opts.shoulder;
      if (opts.aimHeight != null) rig.aimHeight = opts.aimHeight;
      rig.align = opts.align ?? 0;
      if (changed || opts.snap) rig.snap();
    },

    /** Trauma-style shake (0.1 small bump … 1 explosion). */
    shake(amount = 0.3) {
      trauma = Math.min(1, trauma + amount);
    },

    /** Jump to the desired position next update (after teleports / target switches). */
    snap() {
      initialised = false;
      colDist = null;
    },

    /** Place the camera behind a heading (used by teleports). */
    setYaw(h, pitch) {
      rig.yaw = h;
      if (pitch != null) rig.pitch = pitch;
    },

    /**
     * Dialogue / scan framing: ease the camera behind the followed object so it
     * looks past it at `target` (Vector3 | Object3D | null to release).
     * opts: { distance = 2.3, pitch = -0.04, rate = 3 }
     */
    focus(target, opts = {}) {
      focusTarget = target || null;
      focusOpts.distance = opts.distance ?? 2.3;
      focusOpts.pitch = opts.pitch ?? -0.04;
      focusOpts.rate = opts.rate ?? 3;
      if (target && savedZoom == null) savedZoom = rig._zoom;
      if (!target && savedZoom != null) {
        rig._zoom = savedZoom;
        savedZoom = null;
      }
    },
    get focusing() {
      return !!focusTarget;
    },

    update(dt) {
      const input = ctx.input;
      const obj = rig.target;
      if (!obj) return;
      // ---- input
      rig.aimW = damp(rig.aimW, aimOn ? 1 : 0, rig.aim.rate, dt);
      if (rig.aimW < 0.001 && !aimOn) rig.aimW = 0;
      const aw = rig.aimW;
      // ---- first person blend (constant-time, eased)
      const fpWant = rig.view === 'first' && rig.fpAllowed ? 1 : 0;
      fpP = clamp(fpP + (fpWant ? dt : -dt) / FP_TIME, 0, 1);
      rig.fpW = sstep(fpP);
      const fw = rig.fpW;
      // FP looks almost straight up / down; leaving FP pulls the pitch back into the 3P range smoothly
      const pMin = -1.15 - 0.37 * fw;
      const pMax = 0.72 + 0.73 * fw;
      pRange[0] = pMin;
      pRange[1] = pMax;
      if (rig.lookEnabled) {
        const ls = 1 + (rig.aim.look - 1) * aw;
        const lx = (input.lookX || 0) * ls;
        const ly = (input.lookY || 0) * ls;
        rig.yaw -= lx * 0.0026;
        rig.pitch -= ly * 0.0021;
        if (Math.abs(lx) + Math.abs(ly) > 0.5) idleLook = 0;
      }
      rig.pitch = clamp(rig.pitch, pMin, pMax);
      idleLook += dt;
      if (rig.zoomEnabled && input.wheel && !aimOn) {
        const wv = input.wheel;
        if (fpProv && rig.target === fpProv.target && rig.onViewRequest) {
          // Roblox-style: scroll in past the closest distance → first person; scroll out of it → third
          if (rig.view === 'first') {
            if (wv > 0) {
              rig._zoom = rig.minDistance;
              rig.onViewRequest('third');
            }
          } else if (wv < 0 && rig._zoom <= rig.minDistance + 0.01) {
            zoomInAcc += -wv;
            if (zoomInAcc >= 1.5) rig.onViewRequest('first');
          } else zoomInAcc = 0;
        }
        if (rig.view !== 'first') rig._zoom = clamp(rig._zoom * (1 + wv * 0.14), rig.minDistance, rig.maxDistance);
      }
      rig.distance = damp(rig.distance, rig._zoom, 10, dt);

      // ---- target position (world)
      obj.updateWorldMatrix(true, false);
      tgt.setFromMatrixPosition(obj.matrixWorld);
      tgt.y += rig.height + rig.aim.height * aw;
      if (!initialised) focus.copy(tgt);
      else {
        const fr = rig.focusRate;
        focus.x = damp(focus.x, tgt.x, fr, dt);
        focus.z = damp(focus.z, tgt.z, fr, dt);
        focus.y = damp(focus.y, tgt.y, fr === 22 ? 9 : fr * 0.41, dt);
      }
      // focus framing (dialogue): look past the followed object at the focus target
      if (focusTarget) {
        if (focusTarget.isObject3D) focusTarget.getWorldPosition(fp);
        else fp.copy(focusTarget);
        const dx = fp.x - tgt.x;
        const dz = fp.z - tgt.z;
        if (dx * dx + dz * dz > 0.04) rig.yaw = dampAngle(rig.yaw, Math.atan2(-dx, -dz), focusOpts.rate, dt);
        rig.pitch = damp(rig.pitch, focusOpts.pitch, focusOpts.rate, dt);
        rig._zoom = damp(rig._zoom, focusOpts.distance, focusOpts.rate, dt);
      }
      // auto-align behind the target's heading (vehicles)
      if (rig.align > 0 && idleLook > 1.2) {
        tmp.set(0, 0, -1).transformDirection(obj.matrixWorld);
        const h = Math.atan2(-tmp.x, -tmp.z);
        rig.yaw = dampAngle(rig.yaw, h, rig.align, dt);
      }

      // ---- desired position
      const cp = Math.cos(rig.pitch);
      back.set(Math.sin(rig.yaw) * cp, -Math.sin(rig.pitch), Math.cos(rig.yaw) * cp);
      right.set(Math.cos(rig.yaw), 0, -Math.sin(rig.yaw));
      rig.rightVec.copy(right);
      // shoulder offset shrinks when zoomed far out; aiming eases to a close OTS framing
      const sh0 = rig.shoulder * clamp(1.4 - rig.distance / 10, 0.3, 1);
      const sh = sh0 + (rig.aim.shoulder - sh0) * aw;
      pivot.copy(focus).addScaledVector(right, sh);
      let dist = rig.distance + (Math.min(rig.distance, rig.aim.distance) - rig.distance) * aw;

      // ---- collision: physics boxes along focus → camera
      desired.copy(pivot).addScaledVector(back, dist);
      const phys = ctx.physics;
      let hitDist = dist;
      if (phys?.segmentHit) {
        const t = phys.segmentHit(focus, desired);
        if (t < 1) hitDist = Math.max(0.6, t * focus.distanceTo(desired) - 0.3);
      }
      // terrain along the ray (samples) — pull in when a ridge blocks the view
      const world = ctx.world;
      if (world?.getHeightAt) {
        for (let i = 1; i <= 4; i++) {
          const f = i / 4;
          seg.copy(pivot).addScaledVector(back, dist * f);
          const gh = world.getHeightAt(seg.x, seg.z) + 0.25;
          if (seg.y < gh && back.y < 0.95) {
            // the ray dips under the terrain here: shorten unless the camera can rise above it
            if (i < 4) hitDist = Math.min(hitDist, Math.max(0.8, dist * f - 0.4));
          }
        }
      }
      if (colDist == null || !initialised) colDist = hitDist;
      else if (hitDist < colDist) colDist = damp(colDist, hitDist, 30, dt);
      else colDist = damp(colDist, hitDist, 3.5, dt);
      dist = Math.min(dist, colDist);
      desired.copy(pivot).addScaledVector(back, dist);
      if (world?.getHeightAt) {
        const gh = world.getHeightAt(desired.x, desired.z) + 0.35;
        if (desired.y < gh) desired.y = gh;
        const wl = world.waterLevel ?? 0;
        if (desired.y < wl + 0.25 && focus.y > wl - 0.5) desired.y = wl + 0.25;
      }

      // ---- sway + shake
      rig.swayPhase += dt;
      const sw = rig.sway * (1 - fw);
      desired.y += Math.sin(rig.swayPhase * 9.5) * 0.012 * sw;
      desired.addScaledVector(right, Math.sin(rig.swayPhase * 4.75) * 0.01 * sw);
      camera.position.copy(desired);
      look.copy(pivot);
      look.y += rig.aimHeight * clamp(dist / 4, 0.4, 1.4);
      camera.lookAt(look);
      // ---- first person: the eye (provider) + yaw / pitch (+ the provider's dip / roll), blended in
      if (fw > 0 && fpProv) {
        fpProv.eye(eye, rig);
        eFp.set(rig.pitch + (fpProv.pitchOff || 0), rig.yaw, fpProv.roll || 0, 'YXZ');
        qFp.setFromEuler(eFp);
        if (fw >= 0.999) {
          camera.position.copy(eye);
          camera.quaternion.copy(qFp);
        } else {
          camera.position.lerp(eye, fw);
          camera.quaternion.slerp(qFp, fw);
        }
      }
      if (trauma > 0) {
        shakeT += dt;
        const s = trauma * trauma;
        const rs = 1 - 0.45 * fw; // at the eye: less rotation, almost no translation
        const ts = 1 - 0.9 * fw;
        e.setFromQuaternion(camera.quaternion);
        e.x += Math.sin(shakeT * 41.3) * 0.035 * s * rs;
        e.y += Math.sin(shakeT * 37.1 + 1.7) * 0.035 * s * rs;
        e.z += Math.sin(shakeT * 29.7 + 0.4) * 0.05 * s * rs;
        camera.quaternion.setFromEuler(e);
        camera.position.x += Math.sin(shakeT * 47.9) * 0.12 * s * ts;
        camera.position.y += Math.sin(shakeT * 53.3 + 2.1) * 0.12 * s * ts;
        trauma = Math.max(0, trauma - dt * 1.5);
      }
      // ---- fov: third person (+ sprint kick, aim zoom) ↔ first person (settings.fov, aim zoom)
      const base3 = rig.baseFov + (rig.fov - 70) * 0.5;
      const fov3 = base3 + rig.fovKick * 7 * (1 - aw) + (rig.aim.fov - rig.baseFov) * aw;
      const fov1 = rig.fov * (1 + (rig.aim.fpZoom - 1) * aw) + rig.fovKick * 5 * (1 - aw);
      const fov = fov3 + (fov1 - fov3) * fw;
      const near = NEAR_3P + (NEAR_FP - NEAR_3P) * fw;
      if (Math.abs(camera.fov - fov) > 0.01 || Math.abs(camera.near - near) > 1e-4) {
        // the view switch itself moves the FOV with the eased blend (no lag behind the camera)
        camera.fov = initialised && fw <= 0.001 ? damp(camera.fov, fov, 4, dt) : initialised && fw >= 0.999 ? damp(camera.fov, fov, 8, dt) : fov;
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      initialised = true;
    },
  };
  return rig;
}
