import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { clamp, damp, dampAngle } from '../core/math.js';
import { emblemTexture } from '../core/textures.js';

/**
 * FALLBACK characters (do not edit — used only when src/characters fails).
 * Capsule player, third-person orbit rig, 'explore' and 'customize' modes.
 * Implements the ctx.player / ctx.cameraRig / ctx.npcs / ctx.portraits contract.
 */
export function install(ctx) {
  const world = ctx.world;
  const camera = ctx.camera;

  // ---------------------------------------------------------------- player
  const object = new THREE.Group();
  object.name = 'player';
  const suit = new THREE.MeshStandardMaterial({ color: 0x1d2027, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.0, 6, 12), suit);
  body.position.y = 0.85;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc68e67, roughness: 0.6 }));
  head.position.y = 1.62;
  head.castShadow = true;
  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.4),
    new THREE.MeshBasicMaterial({ map: emblemTexture({ size: 128 }), transparent: true }),
  );
  emblem.position.set(0, 1.15, 0.345); // on the back (+Z, since front is −Z)
  object.add(body, head, emblem);
  world.scene.add(object);

  const player = {
    object,
    position: object.position,
    velocity: new THREE.Vector3(),
    heading: 0,
    state: 'idle',
    onFoot: true,
    controlsEnabled: true,
    appearance: ctx.state.get('profile.appearance'),
    grounded: true,
    setAppearance(app) {
      player.appearance = app;
      head.material.color.set(app.skin || '#c68e67');
      suit.color.set(app.outfitColor || '#1d2027');
    },
    setVisible(v) {
      object.visible = v;
    },
    teleport(target, heading) {
      let x = 0;
      let z = 0;
      let h = heading;
      if (typeof target === 'string') {
        const zn = ZONES[target] || ZONES.spawn;
        x = zn.x;
        z = zn.z;
        if (h == null) h = zn.heading || 0;
      } else if (target) {
        x = target.x;
        z = target.z;
      }
      object.position.set(x, ctx.physics.groundHeight(x, z) + 0.05, z);
      player.velocity.set(0, 0, 0);
      if (h != null) {
        player.heading = h;
        rig.yaw = h;
      }
      object.rotation.y = player.heading;
    },
    update(dt) {
      const input = ctx.input;
      const mv = player.controlsEnabled ? input.moveVector() : { x: 0, y: 0 };
      const sprint = input.action('sprint');
      const speed = sprint ? 8 : 4.2;
      // camera-relative movement
      const fwdX = -Math.sin(rig.yaw);
      const fwdZ = -Math.cos(rig.yaw);
      const rightX = Math.cos(rig.yaw);
      const rightZ = -Math.sin(rig.yaw);
      let vx = (fwdX * mv.y + rightX * mv.x) * speed;
      let vz = (fwdZ * mv.y + rightZ * mv.x) * speed;
      const moving = Math.hypot(vx, vz) > 0.1;
      player.velocity.x = damp(player.velocity.x, vx, 12, dt);
      player.velocity.z = damp(player.velocity.z, vz, 12, dt);
      if (moving) player.heading = dampAngle(player.heading, Math.atan2(-vx, -vz), 12, dt);
      if (player.grounded && input.actionPressed('jump') && player.controlsEnabled) {
        player.velocity.y = 6;
        player.grounded = false;
      }
      player.velocity.y -= 18 * dt;
      const p = object.position;
      p.x += player.velocity.x * dt;
      p.z += player.velocity.z * dt;
      p.y += player.velocity.y * dt;
      ctx.physics.resolveCylinder(p, 0.35, 1.8);
      const ground = ctx.physics.groundHeight(p.x, p.z, p.y);
      if (p.y <= ground) {
        p.y = ground;
        player.velocity.y = 0;
        player.grounded = true;
      }
      object.rotation.y = player.heading;
      player.state = !player.grounded ? 'jump' : moving ? (sprint ? 'run' : 'walk') : 'idle';
      ctx.interactions.origin.copy(p);
      ctx.interactions.scope = 'world';
      ctx.interactions.active = true;
    },
  };

  // ------------------------------------------------------------ camera rig
  const rig = {
    camera,
    yaw: 0,
    pitch: -0.18,
    distance: 5,
    minDistance: 2.5,
    maxDistance: 14,
    height: 1.6,
    target: object,
    shoulder: 0.45,
    _shake: 0,
    follow(obj, opts = {}) {
      rig.target = obj;
      if (opts.distance) rig.distance = opts.distance;
      if (opts.height != null) rig.height = opts.height;
      if (opts.minDistance) rig.minDistance = opts.minDistance;
      if (opts.maxDistance) rig.maxDistance = opts.maxDistance;
      if (opts.shoulder != null) rig.shoulder = opts.shoulder;
    },
    shake(amount = 0.3) {
      rig._shake = Math.max(rig._shake, amount);
    },
    update(dt) {
      const input = ctx.input;
      rig.yaw -= input.lookX * 0.0028;
      rig.pitch = clamp(rig.pitch - input.lookY * 0.0024, -1.2, 0.6);
      rig.distance = clamp(rig.distance + input.wheel * 0.8, rig.minDistance, rig.maxDistance);
      const t = rig.target.position;
      const focus = new THREE.Vector3(t.x, t.y + rig.height, t.z);
      const back = new THREE.Vector3(Math.sin(rig.yaw) * Math.cos(rig.pitch), -Math.sin(rig.pitch), Math.cos(rig.yaw) * Math.cos(rig.pitch));
      const side = new THREE.Vector3(Math.cos(rig.yaw), 0, -Math.sin(rig.yaw)).multiplyScalar(rig.shoulder);
      const desired = focus.clone().add(side).addScaledVector(back, rig.distance);
      const groundY = ctx.world.getHeightAt(desired.x, desired.z) + 0.4;
      if (desired.y < groundY) desired.y = groundY;
      camera.position.copy(desired);
      camera.lookAt(focus.clone().add(side));
      if (rig._shake > 0) {
        camera.position.x += (Math.random() - 0.5) * rig._shake;
        camera.position.y += (Math.random() - 0.5) * rig._shake;
        rig._shake = Math.max(0, rig._shake - dt * 2);
      }
    },
  };

  // ------------------------------------------------------------------ modes
  ctx.modes.register('explore', {
    scene: world.scene,
    camera,
    pointerLock: true,
    hud: 'explore',
    enter(params = {}) {
      player.setVisible(true);
      player.onFoot = true;
      rig.follow(object, { distance: 5, height: 1.6 });
      if (params.zone) player.teleport(params.zone);
      else if (params.initial) player.teleport('spawn');
    },
    update(dt) {
      player.update(dt);
      rig.update(dt);
      ctx.audio.setListener(camera);
    },
  });

  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x0b0e14);
  studio.add(new THREE.HemisphereLight(0xffffff, 0x222233, 2));
  const studioCam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  studioCam.position.set(0, 1.4, -4);
  studioCam.lookAt(0, 1, 0);
  ctx.modes.register('customize', {
    scene: studio,
    camera: studioCam,
    pointerLock: false,
    hud: 'customize',
    enter() {
      studio.add(object);
      object.position.set(0, 0, 0);
    },
    exit() {
      world.scene.add(object);
    },
  });

  ctx.player = player;
  ctx.cameraRig = rig;
  ctx.npcs = { list: [], get: () => null, party: new Set() };
  ctx.portraits = { render: () => document.createElement('canvas') };
  player.teleport('spawn');
  return { player, rig };
}
