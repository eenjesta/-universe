/**
 * Third-person camera rig (characters module) → ctx.cameraRig.
 *
 * Over-the-shoulder framing like the poster (character lower-left/centre,
 * looking past them), pointer-lock / drag mouse look, wheel zoom, collision
 * with terrain + physics boxes (segmentHit), FOV kick while sprinting, subtle
 * step sway, trauma shake. follow(object, opts) is reused by vehicles:
 *   ctx.cameraRig.follow(car.object, { distance: 7, height: 1.6, shoulder: 0, align: 2 });
 *   ctx.cameraRig.update(dt);   // from the vehicle mode's update
 */
import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math.js';

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
    target: null,
    zoomEnabled: true,
    lookEnabled: true,
    baseFov: 55,
    fovKick: 0, // set by the controller (0..1) while sprinting
    sway: 0, // step sway amount (0..1), set by the controller
    swayPhase: 0,
    rightVec: new THREE.Vector3(1, 0, 0), // camera right on the XZ plane (read by others)
    _zoom: 3.4,

    /**
     * Follow an object. opts: { distance, height, minDistance, maxDistance,
     * shoulder, aimHeight, align (auto-yaw rate behind the target's heading, 0 = off),
     * snap (jump immediately) }
     */
    follow(object, opts = {}) {
      const changed = rig.target !== object;
      rig.target = object;
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
      if (rig.lookEnabled) {
        const lx = input.lookX || 0;
        const ly = input.lookY || 0;
        rig.yaw -= lx * 0.0026;
        rig.pitch = clamp(rig.pitch - ly * 0.0021, -1.15, 0.72);
        if (Math.abs(lx) + Math.abs(ly) > 0.5) idleLook = 0;
      }
      idleLook += dt;
      if (rig.zoomEnabled && input.wheel) {
        rig._zoom = clamp(rig._zoom * (1 + input.wheel * 0.14), rig.minDistance, rig.maxDistance);
      }
      rig.distance = damp(rig.distance, rig._zoom, 10, dt);

      // ---- target position (world)
      obj.updateWorldMatrix(true, false);
      tgt.setFromMatrixPosition(obj.matrixWorld);
      tgt.y += rig.height;
      if (!initialised) focus.copy(tgt);
      else {
        focus.x = damp(focus.x, tgt.x, 22, dt);
        focus.z = damp(focus.z, tgt.z, 22, dt);
        focus.y = damp(focus.y, tgt.y, 9, dt);
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
      // shoulder offset shrinks when zoomed far out
      const sh = rig.shoulder * clamp(1.4 - rig.distance / 10, 0.3, 1);
      pivot.copy(focus).addScaledVector(right, sh);
      let dist = rig.distance;

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
      const sw = rig.sway;
      desired.y += Math.sin(rig.swayPhase * 9.5) * 0.012 * sw;
      desired.addScaledVector(right, Math.sin(rig.swayPhase * 4.75) * 0.01 * sw);
      camera.position.copy(desired);
      look.copy(pivot);
      look.y += rig.aimHeight * clamp(dist / 4, 0.4, 1.4);
      camera.lookAt(look);
      if (trauma > 0) {
        shakeT += dt;
        const s = trauma * trauma;
        e.setFromQuaternion(camera.quaternion);
        e.x += Math.sin(shakeT * 41.3) * 0.035 * s;
        e.y += Math.sin(shakeT * 37.1 + 1.7) * 0.035 * s;
        e.z += Math.sin(shakeT * 29.7 + 0.4) * 0.05 * s;
        camera.quaternion.setFromEuler(e);
        camera.position.x += Math.sin(shakeT * 47.9) * 0.12 * s;
        camera.position.y += Math.sin(shakeT * 53.3 + 2.1) * 0.12 * s;
        trauma = Math.max(0, trauma - dt * 1.5);
      }
      // ---- fov kick
      const fov = rig.baseFov + rig.fovKick * 7;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = initialised ? damp(camera.fov, fov, 4, dt) : fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      initialised = true;
    },
  };
  return rig;
}
