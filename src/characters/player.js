/**
 * Player controller (characters module) → ctx.player.
 *
 * Camera-relative movement with acceleration, sprint, jump (coyote time +
 * buffer), ground via ctx.physics.groundHeight + resolveCylinder (0.6 m
 * step-up, smoothed visually), slope limit + slide, swimming / wading, play
 * bounds, never-fall-through safety, interaction origin, footstep / jump /
 * land / zone events, periodic state.player save and teleport().
 */
import * as THREE from 'three';
import { WORLD, ZONES } from '../world/layout.js';
import { clamp, damp, dampAngle, angleDiff } from '../core/math.js';
import { Character } from './character.js';
import { CharacterBatch } from './batch.js';
import { normalizeAppearance } from './appearance.js';
import { J } from './skeleton.js';

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

export function createPlayer(ctx, { material }) {
  const world = ctx.world;
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
      const input = ctx.input;
      const rig = ctx.cameraRig;
      const can = player.controlsEnabled && player.onFoot;
      // ---- input → wish direction (camera relative)
      const mv = can ? input.moveVector() : NO_MOVE;
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
      if (swimming) speed = sprintKey ? SWIM_FAST : SWIM;
      else if (wading) speed *= 0.62;
      player.sprinting = sprintKey && moving && !swimming;
      const tvx = wx * speed;
      const tvz = wz * speed;
      const accel = swimming ? 6 : player.grounded ? (moving ? 24 : 30) : 6;
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
      if (moving && hsp > 0.2) {
        const target = Math.atan2(-wx, -wz);
        player.heading = dampAngle(player.heading, target, swimming ? 5 : 11, dt);
      }
      const turnRate = angleDiff(prevHeading, player.heading) / Math.max(dt, 1e-4);

      // ---- jump (coyote + buffer)
      jumpBuf = can && input.actionPressed('jump') ? 0.13 : Math.max(0, jumpBuf - dt);
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
      a.update(dt);
      wasGrounded = player.grounded;

      // ---- state + camera feel
      player.state = swimNow ? 'swim' : !player.grounded ? (vel.y > 0 ? 'jump' : 'fall') : hs > 5.4 ? 'run' : hs > 0.25 ? 'walk' : 'idle';
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
      a.update(dt);
    },

    save() {
      saveState();
    },

    /** World position of the head (for name tags / cameras). */
    headPosition(out = new THREE.Vector3()) {
      return chr.jointWorld(J.head, out);
    },
  };

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
