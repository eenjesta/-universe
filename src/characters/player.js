/**
 * Player controller (characters module) → ctx.player.
 *
 * Camera-relative movement with acceleration, sprint, jump (coyote time +
 * buffer), ground via ctx.physics.groundHeight + resolveCylinder (0.6 m
 * step-up, smoothed visually), slope limit + slide, swimming / wading, play
 * bounds, never-fall-through safety, interaction origin, footstep / jump /
 * land / zone events, periodic state.player save and teleport().
 * Combat (PLATFORM.md §7): holdWeapon(mesh | null, {grip}), setAim(bool) (faces the
 * camera, strafes, slower walk, also switches ctx.cameraRig to its aim mode),
 * aimAt(point | null), playAction('shoot' | 'reload' | 'hit' | 'dodge' | 'die' |
 * 'respawn', opts), dodging (i-frame window), dead, aiming, netAnim(), muzzleWorld(out).
 */
import * as THREE from 'three';
import { WORLD, ZONES } from '../world/layout.js';
import { clamp, damp, dampAngle, angleDiff } from '../core/math.js';
import { Character } from './character.js';
import { CharacterBatch } from './batch.js';
import { normalizeAppearance } from './appearance.js';
import { J } from './skeleton.js';
import { WeaponRig, GRIPS } from './weapon-rig.js';
import { COMBAT_TIMING } from './animator.js';

const GRAVITY = 21;
const JUMP_V = 6.6;
const WALK = 1.75;
const JOG = 4.4;
const SPRINT = 7.7;
const SWIM = 2.1;
const SWIM_FAST = 3.3;
const STEP_UP = 0.6;
const NO_MOVE = Object.freeze({ x: 0, y: 0 });
const RADIUS = 0.32;
const HEIGHT = 1.75;
const SLOPE_MIN_NY = 0.66; // ≈ 49°
const SWIM_DEPTH = 1.28; // water deeper than this → swim
const SWIM_SINK = 1.24; // feet below the surface while swimming
const AIM_WALK = 2.65; // m/s while aiming
const DODGE_V = 9.4; // roll speed at the start (eases out)
const DODGE_IFRAMES = [0.05, 0.44]; // seconds of the roll during which `dodging` is true
const DODGE_COOLDOWN = 0.3;
const HIP_FIRE_HOLD = 0.7; // s the weapon stays raised after a shot without aiming
/**
 * Anim states the server accepts in C.STATE `a` (shared/sim/players.js ANIMS); richer local states
 * are mapped with NET_ANIM_MAP (extend NET_ANIMS when the sim learns sprint / wave / respawn).
 */
export const NET_ANIMS = new Set(['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'swim', 'drive', 'aim', 'shoot', 'dodge', 'build', 'sit', 'wave', 'dead', 'hit', 'reload', 'respawn']);
export const NET_ANIM_MAP = { sprint: 'run', wave: 'idle', respawn: 'idle', cheer: 'idle', clap: 'idle', talk: 'idle', tablet: 'build' };
/** Maps a full anim state onto NET_ANIMS. */
export function toNetAnim(a) {
  return NET_ANIMS.has(a) ? a : NET_ANIM_MAP[a] || 'idle';
}
/** Weapon ids (shared/defs/weapons.js) → grip presets. */
export const GRIP_OF = { 'pulse-pistol': 'pistol', pistol: 'pistol', 'plasma-rifle': 'rifle', rifle: 'rifle', railgun: 'heavy', heavy: 'heavy', 'shock-grenade': 'pistol' };
/** Fallback arrival offsets [dx, dz, heading] when landmarks offer no spawnFor(). */
const ZONE_OFFSETS = {
  plaza: [0, 42, 0],
  signal: [8, 15, 0.3],
  lookout: [9, 9, 0.8],
  ruins: [0, 34, 0],
  spaceport: [-24, 0, -0.9],
  base: [16, 18, -1.2],
  city: [0, 160, 0],
};

export function createPlayer(ctx, { material, fx = null }) {
  // ctx.world is re-read every update / teleport (the seamless world now; other planets may swap it later)
  let world = ctx.world;
  const scene = world.scene;
  const app = normalizeAppearance(ctx.state.get('profile.appearance'));
  // the crowd LOD is built right away (cheap); the hero mesh follows from the build worker
  const chr = new Character(app, { lod: 1, name: 'player', seed: 4242 });
  const batch = new CharacterBatch({
    material,
    parent: chr.object,
    name: 'player-mesh',
    localBounds: new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.7),
  });
  batch.add(chr);
  batch.rebuild();
  scene.add(chr.object);
  chr.object.name = 'player';
  chr.onArrays = () => batch.rebuild();
  chr.setAppearanceAsync(app, 0);

  const pos = new THREE.Vector3(); // physics position (feet)
  const vel = new THREE.Vector3();
  const lastSafe = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let visY = 0; // visual y smoothing offset (step-ups)
  let coyote = 0;
  let jumpBuf = 0;
  let airTime = 0;
  let walkMode = false;
  let zoneTimer = 0;
  let saveTimer = 0;
  let distAcc = 0;
  let lastZone = null;
  let swimBob = 0;
  let wasGrounded = true;
  let surface = 'grass';
  let gazing = false;
  // ---- combat
  const weapon = new WeaponRig(chr);
  let aiming = false;
  let fireHold = 0;
  let shotT = 9;
  let hitT = 9;
  let dodgeT = -1; // s since the roll started (−1 = none)
  let dodgeCd = 0;
  const dodgeDir = new THREE.Vector3();
  let dead = false;
  let spawning = false;
  let aimPointSet = false;
  const aimPoint = new THREE.Vector3();
  const aimTmp = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  let weaponInfo = null;

  const player = {
    object: chr.object,
    position: chr.object.position,
    velocity: vel,
    heading: 0,
    state: 'idle',
    onFoot: true,
    controlsEnabled: true,
    appearance: app,
    grounded: true,
    swimming: false,
    wading: false,
    sprinting: false,
    zone: null,
    character: chr,
    batch,

    setAppearance(next) {
      const a = normalizeAppearance(next);
      player.appearance = a;
      // instant when the creator studio already built this look; otherwise swaps when ready
      if (chr.setAppearanceAsync(a, 0) && !chr._want) batch.rebuild();
    },

    setVisible(v) {
      chr.object.visible = !!v;
    },

    /** teleport(zoneId | {x, z} | Vector3, heading?) */
    teleport(target, heading) {
      syncWorld();
      let x = ZONES.spawn.x;
      let z = ZONES.spawn.z;
      let h = heading;
      if (typeof target === 'string') {
        const zn = ZONES[target] || ZONES.spawn;
        x = zn.x;
        z = zn.z;
        let hh = zn.heading ?? 0;
        // landmarks know free arrival spots (never inside the tree / tower / obelisk)
        let sp = null;
        try {
          sp = ctx.landmarks?.spawnFor?.(zn.id) || null;
        } catch {
          sp = null;
        }
        if (sp && Number.isFinite(sp.x) && Number.isFinite(sp.z)) {
          x = sp.x;
          z = sp.z;
          if (Number.isFinite(sp.heading)) hh = sp.heading;
        } else if (ZONE_OFFSETS[zn.id]) {
          const o = ZONE_OFFSETS[zn.id];
          x += o[0];
          z += o[1];
          hh = o[2];
        }
        if (h == null) h = hh;
      } else if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
        x = target.x;
        z = target.z;
        if (h == null && Number.isFinite(target.heading)) h = target.heading;
      }
      x = clamp(x, -WORLD.playBounds + 2, WORLD.playBounds - 2);
      z = clamp(z, -WORLD.playBounds + 2, WORLD.playBounds - 2);
      const th = terrainH(x, z);
      let y = ctx.physics.groundHeight(x, z, th + 2.5, STEP_UP, 0.2);
      if (!Number.isFinite(y)) y = th;
      const wl = world.waterLevel ?? 0;
      if (y < wl - SWIM_DEPTH) y = wl - SWIM_SINK;
      pos.set(x, y, z);
      lastSafe.copy(pos);
      vel.set(0, 0, 0);
      visY = 0;
      if (h != null) player.heading = h;
      chr.object.position.copy(pos);
      chr.object.rotation.y = player.heading;
      player.grounded = true;
      wasGrounded = true;
      if (ctx.cameraRig) {
        ctx.cameraRig.setYaw(player.heading, -0.04);
        ctx.cameraRig.snap();
      }
      chr.anim.speed = 0;
      chr.anim.settle();
      ctx.npcs?._onPlayerTeleport?.(pos);
      updateZone(true);
      return pos;
    },

    /** Full controller update (explore mode). */
    update(dt) {
      dt = Math.min(dt, 0.05);
      syncWorld();
      const input = ctx.input;
      const rig = ctx.cameraRig;
      const can = player.controlsEnabled && player.onFoot && !dead && !spawning;
      // ---- combat timers
      fireHold = Math.max(0, fireHold - dt);
      shotT += dt;
      hitT += dt;
      dodgeCd = Math.max(0, dodgeCd - dt);
      if (dodgeT >= 0) {
        dodgeT += dt;
        if (dodgeT >= chr.anim.dodgeDur) {
          dodgeT = -1;
          dodgeCd = DODGE_COOLDOWN;
        }
      }
      if (spawning && !chr.anim.materializing) spawning = false;
      const rolling = dodgeT >= 0;
      // ---- input → wish direction (camera relative)
      const mv = can && !rolling ? input.moveVector() : NO_MOVE;
      if (can && input.pressed('CapsLock')) walkMode = !walkMode;
      const yaw = rig ? rig.yaw : player.heading;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      let wx = fx * mv.y + rx * mv.x;
      let wz = fz * mv.y + rz * mv.x;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) {
        wx /= wl;
        wz /= wl;
      }
      const moving = wl > 0.05;
      const sprintKey = can && input.action('sprint');
      const stance = (aiming || fireHold > 0) && can && !rolling;
      // ---- environment at the current position
      const th = terrainH(pos.x, pos.z);
      const waterL = world.waterLevel ?? 0;
      let ground = ctx.physics.groundHeight(pos.x, pos.z, pos.y, STEP_UP, 0.22);
      if (!Number.isFinite(ground)) ground = th;
      const depth = waterL - ground;
      const swimming = depth > SWIM_DEPTH && isWater(pos.x, pos.z, ground);
      const wading = !swimming && depth > 0.35 && isWater(pos.x, pos.z, ground);
      player.swimming = swimming;
      player.wading = wading;
      // ---- target speed
      let speed = walkMode ? WALK : sprintKey ? SPRINT : JOG;
      if (stance) speed = Math.min(walkMode ? WALK : AIM_WALK, speed);
      if (swimming) speed = sprintKey ? SWIM_FAST : SWIM;
      else if (wading) speed *= 0.62;
      player.sprinting = sprintKey && moving && !swimming && !stance;
      let tvx = wx * speed;
      let tvz = wz * speed;
      let accel = swimming ? 6 : player.grounded ? (moving ? 24 : 30) : 6;
      if (rolling) {
        // roll: fast start, eases out (camera look stays free)
        const k = clamp(dodgeT / chr.anim.dodgeDur, 0, 1);
        const rs = DODGE_V * (1 - k * k) + 1.2;
        tvx = dodgeDir.x * rs;
        tvz = dodgeDir.z * rs;
        accel = 80;
      }
      const dvx = tvx - vel.x;
      const dvz = tvz - vel.z;
      const dl = Math.hypot(dvx, dvz);
      const maxDv = accel * dt;
      if (dl > maxDv) {
        vel.x += (dvx / dl) * maxDv;
        vel.z += (dvz / dl) * maxDv;
      } else {
        vel.x = tvx;
        vel.z = tvz;
      }
      // ---- heading
      const prevHeading = player.heading;
      const hsp = Math.hypot(vel.x, vel.z);
      if (rolling) {
        player.heading = dampAngle(player.heading, Math.atan2(-dodgeDir.x, -dodgeDir.z), 30, dt);
      } else if (stance && rig) {
        // combat stance: face the camera, strafe / backpedal
        player.heading = dampAngle(player.heading, rig.yaw, 16, dt);
      } else if (moving && hsp > 0.2) {
        const target = Math.atan2(-wx, -wz);
        player.heading = dampAngle(player.heading, target, swimming ? 5 : 11, dt);
      }
      const turnRate = angleDiff(prevHeading, player.heading) / Math.max(dt, 1e-4);

      // ---- jump (coyote + buffer)
      jumpBuf = can && !rolling && input.actionPressed('jump') ? 0.13 : Math.max(0, jumpBuf - dt);
      coyote = player.grounded ? 0.12 : Math.max(0, coyote - dt);
      if (jumpBuf > 0 && coyote > 0 && !swimming) {
        vel.y = JUMP_V;
        player.grounded = false;
        coyote = 0;
        jumpBuf = 0;
        airTime = 0;
        ctx.events.emit('player:jump', { position: pos });
      }

      // ---- integrate horizontal + collide
      prev.copy(pos);
      let mx = vel.x * dt;
      let mz = vel.z * dt;
      // slope limit: block uphill motion on steep terrain (boxes are handled by step-up)
      if (!swimming && world.getNormalAt && (mx || mz)) {
        const nx = pos.x + mx;
        const nz = pos.z + mz;
        const n = world.getNormalAt(nx, nz, nrm);
        const rise = terrainH(nx, nz) - th;
        const onBox = ground > th + 0.05;
        if (!onBox && n.y < SLOPE_MIN_NY && rise > 0) {
          const gx = -n.x;
          const gz = -n.z;
          const gl = Math.hypot(gx, gz) || 1;
          const up = (mx * gx + mz * gz) / gl;
          if (up > 0) {
            mx -= (gx / gl) * up;
            mz -= (gz / gl) * up;
          }
        }
      }
      pos.x += mx;
      pos.z += mz;
      ctx.physics.resolveCylinder(pos, RADIUS, HEIGHT, STEP_UP);
      // play bounds (soft wall)
      const B = WORLD.playBounds;
      if (Math.abs(pos.x) > B) {
        pos.x = Math.sign(pos.x) * B;
        vel.x = 0;
      }
      if (Math.abs(pos.z) > B) {
        pos.z = Math.sign(pos.z) * B;
        vel.z = 0;
      }

      // ---- vertical
      const th2 = terrainH(pos.x, pos.z);
      let g2 = ctx.physics.groundHeight(pos.x, pos.z, pos.y, STEP_UP, 0.22);
      if (!Number.isFinite(g2)) g2 = th2;
      const swimNow = waterL - g2 > SWIM_DEPTH && isWater(pos.x, pos.z, g2);
      if (swimNow) {
        const sy = waterL - SWIM_SINK;
        vel.y = damp(vel.y, (sy - pos.y) * 4, 6, dt);
        pos.y += vel.y * dt;
        if (pos.y < g2) pos.y = g2;
        player.grounded = false;
        airTime = 0;
        swimBob += dt;
      } else {
        const wasG = player.grounded;
        if (wasG && pos.y - g2 < 0.42 && vel.y <= 0.01 && g2 <= pos.y + STEP_UP) {
          // stick to the ground (down slopes / steps); smooth step-ups visually
          // only discontinuities (stairs, kerbs) are smoothed; slopes are followed exactly
          if (Math.abs(g2 - pos.y) > 0.12) visY += pos.y - g2;
          pos.y = g2;
          vel.y = 0;
          player.grounded = true;
        } else {
          vel.y -= GRAVITY * dt;
          pos.y += vel.y * dt;
          airTime += dt;
          if (pos.y <= g2) {
            if (!wasG && vel.y < -1.5) {
              const sp = -vel.y;
              ctx.events.emit('player:land', { speed: sp });
              chr.anim.land(sp);
              if (sp > 11) ctx.cameraRig?.shake(Math.min(0.5, (sp - 11) * 0.06));
            }
            pos.y = g2;
            vel.y = 0;
            player.grounded = true;
            airTime = 0;
          } else player.grounded = false;
        }
      }
      // slide down very steep terrain
      if (player.grounded && !swimNow && g2 <= th2 + 0.05 && world.getNormalAt) {
        const n = world.getNormalAt(pos.x, pos.z, nrm);
        if (n.y < SLOPE_MIN_NY - 0.06) {
          vel.x += n.x * 9 * dt;
          vel.z += n.z * 9 * dt;
        }
      }
      // ---- safety: never below the terrain, never NaN
      if (!Number.isFinite(pos.x + pos.y + pos.z)) pos.copy(lastSafe);
      if (pos.y < th2 - 0.4) {
        pos.y = th2;
        vel.y = Math.max(0, vel.y);
      }
      if (player.grounded && !swimNow) lastSafe.copy(pos);
      if (pos.y < -200) player.teleport(lastSafe);

      // ---- visuals
      visY = damp(visY, 0, 14, dt);
      if (Math.abs(visY) > 0.7) visY = Math.sign(visY) * 0.7;
      const o = chr.object;
      o.position.set(pos.x, pos.y + visY + (swimNow ? Math.sin(swimBob * 2.1) * 0.035 : 0), pos.z);
      o.rotation.y = player.heading;
      const a = chr.anim;
      const hs = Math.hypot(vel.x, vel.z);
      a.speed = hs;
      a.grounded = player.grounded || swimNow;
      a.vy = vel.y;
      a.swimming = swimNow;
      a.turnRate = turnRate;
      a.aimOn = stance;
      a.strafe = stance;
      if (stance) {
        a.moveAngle = hs > 0.3 ? Math.atan2(-vel.x, -vel.z) - player.heading : 0;
        updateAim(rig);
      }
      a.update(dt);
      weapon.update(true);
      wasGrounded = player.grounded;

      // ---- state + camera feel
      player.state = dead ? 'idle' : swimNow ? 'swim' : !player.grounded ? (vel.y > 0 ? 'jump' : 'fall') : hs > 5.4 ? 'run' : hs > 0.25 ? 'walk' : 'idle';
      if (rig) {
        rig.fovKick = damp(rig.fovKick, player.sprinting && hs > 5.5 ? 1 : 0, 3, dt);
        rig.sway = damp(rig.sway, player.grounded ? clamp(hs / 6, 0, 1) : 0, 4, dt);
      }

      // ---- interactions origin
      if (can) {
        const it = ctx.interactions;
        it.origin.set(pos.x, pos.y + 1.0, pos.z);
        it.scope = 'world';
        it.active = true;
      }

      // ---- surfaces, zones, save
      surface = pickSurface(swimNow, wading, g2, th2);
      distAcc += prev.distanceTo(pos);
      zoneTimer -= dt;
      if (zoneTimer <= 0) {
        zoneTimer = 0.5;
        updateZone(false);
      }
      saveTimer -= dt;
      if (saveTimer <= 0) {
        saveTimer = 3;
        saveState();
      }
    },

    /**
     * Cut-scene / title pose: 'idle' clears everything; 'wave' | 'cheer' | 'clap' |
     * 'talk' | 'tablet' | 'sit' hold that action until setPose('idle').
     */
    setPose(name = 'idle') {
      const a = chr.anim;
      for (const k of Object.keys(a.targets)) a.targets[k] = 0;
      vel.set(0, 0, 0);
      a.speed = 0;
      if (name && name !== 'idle' && name in a.targets) a.set(name, 1);
      player.state = 'idle';
    },

    /**
     * Animation only (title / cut-scenes): stand idle where we are. With `gaze`
     * the hero looks out to the right of their heading (poster pose: toward the city).
     */
    idle(dt, gaze = false) {
      const a = chr.anim;
      a.speed = 0;
      a.grounded = true;
      a.vy = 0;
      a.swimming = false;
      a.turnRate = 0;
      if (gaze) {
        const h = player.heading - 0.42;
        const p = chr.object.position;
        tmp.set(p.x - Math.sin(h) * 40, p.y + 2.2, p.z - Math.cos(h) * 40);
        a.lookAt(tmp);
      } else if (gazing) a.lookAt(null);
      gazing = gaze;
      a.aimOn = false;
      a.strafe = false;
      a.update(dt);
      weapon.update(true);
    },

    save() {
      saveState();
    },

    /** World position of the head (for name tags / cameras). */
    headPosition(out = new THREE.Vector3()) {
      return chr.jointWorld(J.head, out);
    },

    // ------------------------------------------------------------ combat
    /**
     * Puts a weapon mesh in the right hand (null = unarmed). The mesh is modelled with
     * the barrel along −Z, top +Y, origin at the trigger grip; it becomes a child of
     * player.object and is placed every frame (aim / carry / reload / roll / death).
     * opts: { grip: 'pistol' | 'rifle' | 'heavy' | weapon id, muzzle:[x,y,z], support:[x,y,z]
     * (left wrist), stock:[x,y,z], holster: bool (ride on the back / thigh) } or a grip string.
     */
    holdWeapon(mesh, opts = {}) {
      if (typeof opts === 'string') opts = { grip: opts };
      opts = opts || {};
      if (!mesh && !opts.grip) {
        weapon.set(null);
        weaponInfo = null;
        return null;
      }
      const g = opts.grip ?? mesh?.userData?.grip;
      const kind = GRIPS[g] ? g : GRIP_OF[g] || 'pistol';
      weapon.set(kind, { object: mesh || null, holster: !!opts.holster, muzzle: opts.muzzle, support: opts.support, stock: opts.stock });
      weaponInfo = { object: mesh || null, grip: kind, holstered: !!opts.holster };
      weapon.update(false);
      return weaponInfo;
    },

    /** { object, grip, holstered } | null */
    get weapon() {
      return weaponInfo;
    },

    /** Holster (true: back / thigh) or draw (false) the held weapon. */
    holster(on = true) {
      weapon.setHolstered(on);
      if (weaponInfo) weaponInfo.holstered = !!on;
    },

    /** Aim stance (faces the camera, strafes, slower walk) + the camera rig's aim mode. */
    setAim(on) {
      aiming = !!on;
      ctx.cameraRig?.setAim?.(aiming && !dead && player.onFoot);
    },
    get aiming() {
      return aiming && !dead;
    },

    /** Point the arms converge on (e.g. the crosshair hit point); null = 40 m along the camera ray. */
    aimAt(point) {
      if (point && Number.isFinite(point.x)) {
        aimPoint.copy(point);
        aimPointSet = true;
      } else aimPointSet = false;
    },

    /**
     * One-shot actions: 'shoot' {recoil}, 'reload' {duration}, 'hit' {from: Vector3, amount},
     * 'dodge' {dir} (roll in the move direction; i-frames → player.dodging), 'die' {dir: 1 back | −1 front}
     * (input off until respawn), 'respawn' {duration} (materialize; call teleport() first).
     * Returns false when the action could not start.
     */
    playAction(name, opts = {}) {
      const a = chr.anim;
      opts = opts || {};
      switch (name) {
        case 'shoot':
          if (dead) return false;
          a.fire(opts.recoil ?? (weapon.kind === 'heavy' ? 1.5 : weapon.kind === 'rifle' ? 0.75 : 1));
          shotT = 0;
          if (!aiming) fireHold = HIP_FIRE_HOLD;
          return true;
        case 'reload':
          if (dead) return false;
          a.reload(opts.duration ?? weapon.grip?.reload ?? COMBAT_TIMING.reload);
          return true;
        case 'hit': {
          if (dead) return false;
          let side = 0;
          const f = opts.from;
          if (f && Number.isFinite(f.x)) {
            const p = chr.object.position;
            const rx = Math.cos(player.heading);
            const rz = -Math.sin(player.heading);
            const dx = f.x - p.x;
            const dz = f.z - p.z;
            const l = Math.hypot(dx, dz) || 1;
            side = clamp((dx * rx + dz * rz) / l, -1, 1);
          }
          a.hit(side, opts.amount ?? 1);
          hitT = 0;
          ctx.cameraRig?.shake?.(0.05 * clamp(opts.amount ?? 1, 0.3, 2));
          return true;
        }
        case 'dodge':
          return startDodge(opts);
        case 'die':
          if (dead) return false;
          dead = true;
          fireHold = 0;
          dodgeT = -1;
          vel.x = 0;
          vel.z = 0;
          ctx.cameraRig?.setAim?.(false);
          a.die({ dir: opts.dir });
          ctx.events.emit('player:die', {});
          return true;
        case 'respawn':
          dead = false;
          spawning = true;
          dodgeT = -1;
          a.revive();
          a.materialize(opts.duration ?? COMBAT_TIMING.materialize);
          fx?.spawn(chr.object.position, opts.duration ?? COMBAT_TIMING.materialize, chr.frame.headC.y + 0.25);
          if (aiming) ctx.cameraRig?.setAim?.(true);
          ctx.events.emit('player:respawn', {});
          return true;
        default:
          return false;
      }
    },

    /** True inside the roll's invulnerability window. */
    get dodging() {
      return dodgeT >= DODGE_IFRAMES[0] && dodgeT <= DODGE_IFRAMES[1];
    },
    get rolling() {
      return dodgeT >= 0;
    },
    get dead() {
      return dead;
    },

    /**
     * Anim state for the network (C.STATE `a`): one of NET_ANIMS (the states the server accepts);
     * 'drive' in vehicles, 'build' while building, 'dead' while the server says so.
     */
    netAnim() {
      if (dead || ctx.state?.get?.('smp.dead')) return 'dead';
      if (ctx.modes?.name === 'drive') return 'drive';
      const a = player.animState();
      if (a === 'idle' && ctx.build?.active) return 'build';
      return toNetAnim(a);
    },

    /** Full anim state: idle walk run sprint jump fall swim aim shoot reload hit dodge dead respawn sit wave. */
    animState() {
      const a = chr.anim;
      if (dead) return 'dead';
      if (spawning) return 'respawn';
      if (dodgeT >= 0) return 'dodge';
      if (hitT < 0.3) return 'hit';
      if (a.reloading) return 'reload';
      if (shotT < 0.22) return 'shoot';
      const st = player.state;
      if ((aiming || fireHold > 0) && st !== 'swim') return 'aim';
      if (st === 'swim' || st === 'jump' || st === 'fall') return st;
      if (a.targets.sit > 0.5) return 'sit';
      if (a.targets.wave > 0.5) return 'wave';
      if (st === 'run') return player.sprinting && Math.hypot(vel.x, vel.z) > 6.2 ? 'sprint' : 'run';
      return st === 'walk' ? 'walk' : 'idle';
    },

    /** World position of the held weapon's muzzle (head height when unarmed). */
    muzzleWorld(out = new THREE.Vector3()) {
      if (weapon.kind && !weapon.holstered) return weapon.muzzleWorld(out);
      return chr.headTop(out);
    },
    weaponRig: weapon,
  };

  function startDodge(opts = {}) {
    if (dead || spawning || dodgeT >= 0 || dodgeCd > 0 || !player.onFoot || player.swimming || !player.grounded) return false;
    let dx = 0;
    let dz = 0;
    if (opts.dir && Number.isFinite(opts.dir.x)) {
      dx = opts.dir.x;
      dz = opts.dir.z ?? 0;
    } else if (player.controlsEnabled) {
      const mv = ctx.input.moveVector();
      const yaw = ctx.cameraRig ? ctx.cameraRig.yaw : player.heading;
      dx = -Math.sin(yaw) * mv.y + Math.cos(yaw) * mv.x;
      dz = -Math.cos(yaw) * mv.y - Math.sin(yaw) * mv.x;
    }
    let l = Math.hypot(dx, dz);
    if (l < 0.1) {
      dx = -Math.sin(player.heading);
      dz = -Math.cos(player.heading);
      l = 1;
    }
    dodgeDir.set(dx / l, 0, dz / l);
    dodgeT = 0;
    chr.anim.dodge(COMBAT_TIMING.dodge);
    ctx.events.emit('player:dodge', { dir: dodgeDir });
    return true;
  }

  /** Aim yaw/pitch (character space) toward the convergence point of the camera ray. */
  function updateAim() {
    const a = chr.anim;
    if (aimPointSet) aimTmp.copy(aimPoint);
    else {
      const cam = ctx.camera;
      cam.getWorldDirection(aimDir);
      aimTmp.copy(cam.position).addScaledVector(aimDir, 40);
    }
    const o = chr.object.position;
    const dx = aimTmp.x - o.x;
    const dy = aimTmp.y - (o.y + 1.38 * chr.frame.s);
    const dz = aimTmp.z - o.z;
    const h = player.heading;
    const c = Math.cos(h);
    const sn = Math.sin(h);
    const lx = dx * c - dz * sn;
    const lz = dx * sn + dz * c;
    a.aimYaw = Math.atan2(-lx, -lz);
    a.aimPitch = Math.atan2(dy, Math.hypot(lx, lz));
  }

  /** Follows a swapped ctx.world (its queries, and its scene while the player stands in a scene). */
  function syncWorld() {
    const w = ctx.world;
    if (!w || w === world) return;
    world = w;
    const par = chr.object.parent;
    if (w.scene && par && par.isScene && par !== w.scene) w.scene.add(chr.object);
  }

  chr.anim.onStep = (side) => {
    ctx.events.emit('player:footstep', { surface, side, speed: Math.hypot(vel.x, vel.z) });
  };

  function terrainH(x, z) {
    const h = world.getHeightAt ? world.getHeightAt(x, z) : 0;
    return Number.isFinite(h) ? h : 0;
  }

  function isWater(x, z, ground) {
    const wl = world.waterLevel ?? 0;
    if (typeof world.isWater === 'function') {
      try {
        if (world.isWater(x, z)) return true;
      } catch {
        /* ignore */
      }
    }
    return ground < wl - 0.3;
  }

  function pickSurface(swim, wade, g, t) {
    if (swim || wade) return 'water';
    const sp = ZONES.spaceport.rect;
    const onBox = g > t + 0.04;
    if (pos.x > sp.minX && pos.x < sp.maxX && pos.z > sp.minZ && pos.z < sp.maxZ) return 'metal';
    const pl = ZONES.plaza;
    if (Math.hypot(pos.x - pl.x, pos.z - pl.z) < pl.radius) return 'stone';
    if (onBox) {
      const lo = ZONES.lookout;
      if (Math.hypot(pos.x - lo.x, pos.z - lo.z) < 25) return 'metal';
      return 'wood';
    }
    if (t < 1.6) return 'sand';
    const n = world.getNormalAt ? world.getNormalAt(pos.x, pos.z, nrm) : null;
    if (n && n.y < 0.82) return 'rock';
    return 'grass';
  }

  function zoneAt(x, z) {
    let best = null;
    let bd = Infinity;
    for (const zn of Object.values(ZONES)) {
      let d;
      if (zn.rect) {
        const r = zn.rect;
        const dx = Math.max(r.minX - x, 0, x - r.maxX);
        const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
        d = Math.hypot(dx, dz);
        if (d > 25) continue;
      } else {
        d = Math.hypot(x - zn.x, z - zn.z);
        const lim = zn.id === 'city' ? zn.radius : Math.max(zn.radius * 1.6, 38);
        if (d > lim) continue;
        if (zn.id === 'city') d += 200; // prefer specific zones
      }
      if (d < bd) {
        bd = d;
        best = zn.id;
      }
    }
    return best;
  }

  function updateZone(force) {
    const z = zoneAt(pos.x, pos.z);
    player.zone = z;
    if (z !== lastZone || force) {
      const prevZ = lastZone;
      lastZone = z;
      if (z !== prevZ) ctx.events.emit('player:zone', { zone: z, prev: prevZ });
    }
  }

  function saveState() {
    if (!player.onFoot) return;
    const st = ctx.state;
    st.set('player.position', { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) });
    st.set('player.heading', +player.heading.toFixed(3));
    if (player.zone) st.set('player.zone', player.zone);
    if (distAcc > 0.5) {
      st.add('stats.distance', Math.round(distAcc));
      distAcc = 0;
    }
  }

  return player;
}
