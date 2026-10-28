/**
 * Remote players' vehicles (characters module): the vehicles module's own models
 * (car-model.js, vtol-model.js, ship-model.js with ctx.vehicles.materials, used
 * read-only), pooled per type, placed from net views (veh: {type, p, h}).
 * No physics: pitch / bank come from the motion, wheels spin and steer, VTOL
 * rotors spin + nacelles tilt, gear retracts in the air, ship engines glow with
 * speed. Model modules load lazily (first use), so a remote vehicle may appear a
 * frame late; until the vehicles module is installed nothing is shown.
 *
 *   const rv = createRemoteVehicles(ctx);
 *   rv.show(rec, veh, dt, typeHint) → Object3D | null;  rv.release(rec)
 */
import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDiff } from '../core/math.js';

const TYPES = ['car', 'vtol', 'ship'];
/** Height of the name tag above the vehicle origin (m). */
export const VEH_TAG_HEIGHT = { car: 1.75, vtol: 3.4, ship: 5.6 };
const _v = new THREE.Vector3();

export function createRemoteVehicles(ctx) {
  const scene = ctx.world?.scene;
  const root = new THREE.Group();
  root.name = 'remote-vehicles';
  scene?.add(root);
  const pool = { car: [], vtol: [], ship: [] };
  const mods = { car: null, vtol: null, ship: null };
  const loading = {};
  let shipFactory = null;
  let count = 0;

  function load(type) {
    if (loading[type]) return;
    loading[type] = true;
    const p =
      type === 'car'
        ? import('../vehicles/car-model.js')
        : type === 'vtol'
          ? import('../vehicles/vtol-model.js')
          : import('../vehicles/ship-model.js').then(async (m) => {
              const mats = ctx.vehicles?.materials;
              if (mats) shipFactory = await m.loadShipFactory(mats);
              return m;
            });
    p.then((m) => (mods[type] = m)).catch((err) => console.warn(`[characters] remote ${type} model unavailable`, err));
  }

  function build(type) {
    const mats = ctx.vehicles?.materials;
    if (!mats) return null;
    const m = mods[type];
    if (!m) {
      load(type);
      return null;
    }
    try {
      let obj = null;
      if (type === 'car') obj = m.createCarModel(mats, { paintMat: mats.makePaint?.(), glowMat: mats.makeGlow?.() });
      else if (type === 'vtol') obj = m.createVtolModel(mats, { armorMat: mats.armor, glowMat: mats.glow });
      else if (type === 'ship' && shipFactory) {
        obj = m.wrapShip(shipFactory.create({ variant: 'player', gear: true, plumes: true }), mats, { variant: 'player' });
        obj.userData.setStairs?.(0);
        if (obj.userData.pool) obj.userData.pool.visible = false;
      }
      if (obj) {
        obj.name = `remote-${type}`;
        count++;
      }
      return obj;
    } catch (err) {
      console.warn(`[characters] remote ${type} model failed`, err);
      return null;
    }
  }

  function release(rec) {
    const s = rec.vehicle;
    if (!s) return;
    s.obj.visible = false;
    pool[s.type].push(s.obj);
    rec.vehicle = null;
  }

  /** Places rec's vehicle from a view `veh` {type, p, h} (type falls back to `hint`, then 'car'); returns its object (null while loading). */
  function show(rec, veh, dt, hint = null) {
    const type = TYPES.includes(veh?.type) ? veh.type : TYPES.includes(hint) ? hint : 'car';
    let s = rec.vehicle;
    if (s && s.type !== type) {
      release(rec);
      s = null;
    }
    if (!s) {
      const obj = pool[type].pop() || build(type);
      if (!obj) return null;
      if (obj.parent !== root) root.add(obj);
      obj.visible = true;
      s = rec.vehicle = { type, obj, h: 0, pitch: 0, roll: 0, yawRate: 0, prev: new THREE.Vector3(), vel: new THREE.Vector3(), spin: 0, gear: 1, init: false };
    }
    const o = s.obj;
    const ud = o.userData;
    const p = veh.p;
    const px = p?.x ?? p?.[0];
    const py = p?.y ?? p?.[1];
    const pz = p?.z ?? p?.[2];
    if (!Number.isFinite(px + py + pz)) return o;
    const h = Number.isFinite(veh.h) ? veh.h : s.h;
    dt = Math.max(dt, 1e-3);
    if (!s.init || o.position.distanceToSquared(_v.set(px, py, pz)) > 40 * 40) {
      o.position.set(px, py, pz);
      s.prev.set(px, py, pz);
      s.vel.set(0, 0, 0);
      s.h = h;
      s.init = true;
    } else {
      o.position.x = damp(o.position.x, px, 20, dt);
      o.position.y = damp(o.position.y, py, 20, dt);
      o.position.z = damp(o.position.z, pz, 20, dt);
      s.vel.x = damp(s.vel.x, (o.position.x - s.prev.x) / dt, 6, dt);
      s.vel.y = damp(s.vel.y, (o.position.y - s.prev.y) / dt, 6, dt);
      s.vel.z = damp(s.vel.z, (o.position.z - s.prev.z) / dt, 6, dt);
      s.prev.copy(o.position);
    }
    const ph = s.h;
    s.h = dampAngle(s.h, h, 12, dt);
    s.yawRate = damp(s.yawRate, angleDiff(ph, s.h) / dt, 6, dt);
    const fwd = -(s.vel.x * Math.sin(s.h) + s.vel.z * Math.cos(s.h)); // forward speed
    const speed = Math.hypot(s.vel.x, s.vel.z);
    const ground = ctx.world?.getHeightAt?.(o.position.x, o.position.z) ?? 0;
    const alt = o.position.y - Math.max(ground, ctx.world?.waterLevel ?? 0);
    if (type === 'car') {
      s.roll = damp(s.roll, clamp(-s.yawRate * fwd * 0.004, -0.06, 0.06), 5, dt);
      s.pitch = damp(s.pitch, clamp(s.vel.y * 0.02, -0.2, 0.2), 5, dt);
      s.spin += (fwd * dt) / 0.36;
      ud.wheels?.setPose?.(clamp(s.yawRate * 0.28 * Math.sign(fwd || 1), -0.5, 0.5), s.spin);
    } else {
      s.roll = damp(s.roll, clamp(s.yawRate * clamp(speed / 25, 0, 1) * 0.5, -0.7, 0.7), 3, dt);
      s.pitch = damp(s.pitch, clamp(-clamp(fwd / 90, -1, 1) * 0.12 + s.vel.y * 0.012, -0.35, 0.35), 3, dt);
      s.gear = damp(s.gear, alt < 3.5 && speed < 12 ? 1 : 0, 3, dt);
      ud.setGear?.(s.gear);
      if (type === 'vtol') {
        ud.setRotor?.(clamp(0.5 + speed / 50 + Math.abs(s.vel.y) / 20, 0, 1), dt);
        ud.setTilt?.(clamp(fwd / 55, 0, 1) * 1.25);
      } else ud.setThrust?.(clamp(0.18 + speed / 140, 0, 1), speed > 160 ? 1 : 0);
    }
    o.rotation.set(s.pitch, s.h, s.roll, 'YXZ');
    return o;
  }

  return {
    root,
    show,
    release,
    /** Pre-loads the model modules (call once the vehicles module exists). */
    preload() {
      for (const t of TYPES) if (!mods[t]) load(t);
    },
    get count() {
      return count;
    },
    dispose() {
      root.removeFromParent();
    },
  };
}
