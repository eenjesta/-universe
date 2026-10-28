/**
 * Vehicles — the fleet: vehicle records, models in the world scene, parking
 * (spaceport pads, base landing pad, hangar), physics boxes for parked
 * vehicles, "[F] Board — …" interactions anchored at the doors, summoning
 * (ground vehicles appear beside the player, air vehicles hover down) and the
 * idle animation of parked vehicles.
 *
 * Vehicle record: { id, type, name, object (Group in world.scene, origin on
 * the ground, front −Z), model, heading, speed, velocity, parked, away,
 * summoning, home, skin, physics: [ids] }.
 */
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { ZONES, WORLD } from '../world/layout.js';
import { clamp, easeOutCubic, wrapAngle } from '../core/math.js';
import { createCarModel } from './car-model.js';
import { createVtolModel } from './vtol-model.js';
import { createColonyShipModel } from './colony-model.js';
import { wrapShip } from './ship-model.js';
import { applySkin, SKINS } from './materials.js';

export const NAMES = {
  car: { en: 'Ground vehicle', nl: 'Grondvoertuig' },
  vtol: { en: 'Air vehicle', nl: 'Luchtvoertuig' },
  ship: { en: 'Spaceship', nl: 'Ruimteschip' },
  colony: { en: 'Colony ship', nl: 'Kolonieschip' },
};

/** Footprint + collision boxes (vehicle-local: x, y, z centre; w, h, d). */
const BOXES = {
  car: [[0, 0.62, 0, 2.0, 1.1, 4.6]],
  vtol: [[0, 1.3, -0.1, 2.8, 2.2, 10.4], [-4.38, 1.62, 0.35, 4.6, 0.95, 4.6], [4.38, 1.62, 0.35, 4.6, 0.95, 4.6]],
  ship: [[0, 2.75, 0.4, 4.2, 2.6, 15.0]],
};
const DOOR_RADIUS = { car: 5.5, vtol: 6.5, ship: 6.5 };
const SUMMON_DIST = { car: 5.5, vtol: 12, ship: 21 };
const FOOT_R = { car: 2.6, vtol: 7.2, ship: 9.5 };

const _v = new THREE.Vector3();
const _q = new THREE.Vector3();

export function createFleet(ctx, mats, shipFactory) {
  const world = ctx.world;
  const scene = world.scene;
  const root = new THREE.Group();
  root.name = 'vehicles';
  scene.add(root);
  const list = [];
  const store = ctx.state.ensure('vehicles', { skins: { car: 'default', ship: 'default' } });
  if (!store.skins) store.skins = { car: 'default', ship: 'default' };
  const ground = (x, z) => {
    const h = world.getHeightAt?.(x, z);
    return Number.isFinite(h) ? h : 0;
  };
  /** Highest walkable surface (terrain or pad deck) under x/z near height y. */
  const surface = (x, z, nearY = null) => {
    const th = ground(x, z);
    const y = ctx.physics.groundHeight(x, z, (nearY ?? th) + 1.2, 1.4, 0);
    return Number.isFinite(y) ? Math.max(th, y) : th;
  };

  // ------------------------------------------------------------ records
  function makeRecord(type, object, extra = {}) {
    const v = {
      id: `${type}-${list.filter((x) => x.type === type).length + 1}`,
      type,
      get name() {
        return t(NAMES[type]);
      },
      object,
      model: object,
      heading: 0,
      speed: 0,
      velocity: new THREE.Vector3(),
      parked: true,
      away: false,
      summoning: null,
      home: null,
      skin: 'default',
      physics: [],
      door: new THREE.Vector3(),
      ...extra,
    };
    object.userData.vehicle = v;
    root.add(object);
    list.push(v);
    return v;
  }

  function makeCar() {
    const paint = mats.makePaint();
    const glow = mats.makeGlow();
    const obj = createCarModel(mats, { paintMat: paint, glowMat: glow });
    const v = makeRecord('car', obj);
    setSkin(v, store.skins.car || 'default', false);
    return v;
  }
  function makeVtol() {
    const obj = createVtolModel(mats, { armorMat: mats.armor, glowMat: mats.glow });
    return makeRecord('vtol', obj);
  }
  function makeShip(variant = 'player') {
    const model = shipFactory.create({ variant, gear: true, plumes: true });
    const obj = wrapShip(model, mats, { variant });
    obj.userData.setThrust(0, 0);
    return obj;
  }

  // ------------------------------------------------------------ skins
  function owned(id) {
    if (id === 'default') return true;
    const items = ctx.state.get('owned.items') || [];
    const skins = ctx.state.get('owned.skins') || [];
    return items.includes(id) || skins.includes(id) || !!ctx.state.get('settings.creative');
  }
  function setSkin(v, id, save = true) {
    const table = SKINS[v.type];
    if (!table) return false;
    const skin = table[id] || table.default;
    if (!owned(skin.id)) return false;
    v.skin = skin.id;
    if (v.type === 'car') {
      applySkin(v.object.userData.paint, skin);
      const ug = v.object.userData.underglow;
      ug.material.color.setHex(skin.glow).multiplyScalar(0.35);
    } else if (v.type === 'ship') {
      // the gold variant is its own model (space design); rebuild in place
      const want = skin.id === 'skin-ship-gold' ? 'gold' : 'player';
      if (v.variant !== want) {
        const old = v.object;
        const fresh = makeShip(want);
        fresh.position.copy(old.position);
        fresh.rotation.copy(old.rotation);
        fresh.userData.setStairs(old.userData.stairK ?? 1);
        fresh.userData.vehicle = v;
        root.remove(old);
        old.userData.dispose?.();
        root.add(fresh);
        v.object = fresh;
        v.model = fresh;
        v.variant = want;
      }
    }
    if (save) {
      ctx.state.set(`vehicles.skins.${v.type}`, skin.id);
    }
    return true;
  }

  // ------------------------------------------------------------ parking
  function placeBoxes(v) {
    removeBoxes(v);
    const defs = BOXES[v.type];
    if (!defs) return;
    const o = v.object;
    o.updateMatrixWorld(true);
    for (const [x, y, z, w, h, d] of defs) {
      _v.set(x, y, z).applyMatrix4(o.matrixWorld);
      v.physics.push(ctx.physics.addBox({ x: _v.x, y: _v.y, z: _v.z, w, h, d, rotY: v.heading, solid: true, walkable: false, tag: 'vehicles', owner: v.id }));
    }
  }
  function removeBoxes(v) {
    for (const id of v.physics) ctx.physics.remove(id);
    v.physics.length = 0;
  }

  /** Parks v at x/z (y = surface or given) facing heading. */
  function park(v, x, z, heading, y = null) {
    v.heading = heading;
    v.speed = 0;
    v.velocity.set(0, 0, 0);
    v.parked = true;
    v.away = false;
    v.summoning = null;
    v.object.visible = true;
    v.object.position.set(x, y ?? surface(x, z), z);
    v.object.rotation.set(0, heading, 0);
    v.object.userData.body?.position.set(0, 0, 0);
    v.object.userData.body?.rotation.set(0, 0, 0);
    const ud = v.object.userData;
    ud.setGear?.(1);
    ud.setTilt?.(0);
    ud.setStairs?.(1);
    ud.setThrust?.(0, 0);
    ud.wheels?.setPose(0, 0);
    if (ud.lights) ud.lights.beams.visible = false;
    placeBoxes(v);
  }

  function homeOf(v) {
    return v.home;
  }

  /** Puts a vehicle back on its home pad. */
  function sendHome(v) {
    const h = homeOf(v);
    if (h) park(v, h.x, h.z, h.heading, h.y);
  }

  // ------------------------------------------------------------ build the fleet
  const pads = ctx.landmarks?.spaceport?.pads || {};
  const padAt = (key) => {
    const p = pads[key];
    if (p?.position) return { x: p.position.x, z: p.position.z, y: p.position.y, heading: p.rotY ?? -0.9 };
    const d = ZONES.spaceport.pads[key];
    return { x: d.x, z: d.z, y: surface(d.x, d.z) + 0.14, heading: d.rotY };
  };

  const car = makeCar();
  car.home = padAt('car');
  sendHome(car);

  const vtol = makeVtol();
  vtol.home = padAt('vtol');
  sendHome(vtol);

  const vtol2 = makeVtol();
  const lp = ctx.landmarks?.house?.landingPad;
  if (lp?.position) vtol2.home = { x: lp.position.x, z: lp.position.z, y: lp.position.y, heading: (lp.rotY ?? 0) + Math.PI / 2 };
  else {
    const b = ZONES.base.landingPad;
    vtol2.home = { x: b.x, z: b.z, y: surface(b.x, b.z) + 0.9, heading: -1.2 };
  }
  sendHome(vtol2);

  const shipObj = makeShip(store.skins.ship === 'skin-ship-gold' && owned('skin-ship-gold') ? 'gold' : 'player');
  const ship = makeRecord('ship', shipObj, { variant: store.skins.ship === 'skin-ship-gold' ? 'gold' : 'player' });
  ship.skin = ship.variant === 'gold' ? 'skin-ship-gold' : 'default';
  ship.home = padAt('ship');
  sendHome(ship);

  // colony ship in the hangar (static)
  const hangar = ctx.landmarks?.spaceport?.hangar;
  const colonyObj = createColonyShipModel({ length: 132, legs: true, lifters: 0.12 });
  const colony = makeRecord('colony', colonyObj);
  {
    const hp = hangar?.position || new THREE.Vector3(ZONES.spaceport.hangar.x, 0, ZONES.spaceport.hangar.z);
    const r = hangar?.rotY ?? ZONES.spaceport.hangar.rotY;
    const floorY = hangar?.floorY ?? surface(hp.x, hp.z);
    const lx = 2;
    const lz = -11;
    const x = hp.x + lx * Math.cos(r) + lz * Math.sin(r);
    const z = hp.z - lx * Math.sin(r) + lz * Math.cos(r);
    colony.heading = r + Math.PI / 2;
    colony.home = { x, z, y: floorY + 0.1, heading: colony.heading };
    colonyObj.position.set(x, floorY + 0.1 + colonyObj.userData.groundOffset, z);
    colonyObj.rotation.y = colony.heading;
    colonyObj.updateMatrixWorld(true);
    // feet colliders
    for (const leg of colonyObj.userData.legs || []) {
      leg.updateMatrixWorld(true);
      const s = leg.position.x < 0 ? -1 : 1;
      _v.set(s * 6.6, -18.9, 0);
      leg.localToWorld(_v);
      colony.physics.push(ctx.physics.addBox({ x: _v.x, y: floorY + 1.5, z: _v.z, w: 5.6, h: 3, d: 5.6, rotY: colony.heading, solid: true, walkable: true, tag: 'vehicles', owner: colony.id }));
    }
  }

  // ------------------------------------------------------------ interactions
  const LABEL = {
    car: { en: 'Board — Ground vehicle', nl: 'Instappen — Grondvoertuig' },
    vtol: { en: 'Board — Air vehicle', nl: 'Instappen — Luchtvoertuig' },
    ship: { en: 'Board — Spaceship', nl: 'Instappen — Ruimteschip' },
  };
  const fleet = {
    root,
    list,
    car,
    vtol,
    vtol2,
    ship,
    colony,
    onBoard: null, // set by index.js → api.enter(v)
    store,
    owned,
    setSkin,
    park,
    sendHome,
    placeBoxes,
    removeBoxes,
    surface,
    doorWorld,
  };
  function doorWorld(v, out) {
    const d = v.object.userData.door;
    if (!d) return out.copy(v.object.position);
    out.copy(d);
    v.object.localToWorld(out);
    return out;
  }
  for (const v of list) {
    if (!LABEL[v.type]) continue;
    const pos = new THREE.Vector3();
    const anchor = new THREE.Vector3();
    const label = t(LABEL[v.type]);
    ctx.interactions.add({
      id: `veh-board-${v.id}`,
      scope: 'world',
      key: 'KeyF',
      radius: DOOR_RADIUS[v.type],
      priority: 1,
      label,
      position: () => doorWorld(v, pos),
      anchor: () => anchor.copy(doorWorld(v, pos)).setY(pos.y + (v.type === 'car' ? 1.0 : 1.6)),
      enabled: () => v.parked && !v.away && !v.summoning && v.object.visible && ctx.modes.is('explore'),
      onInteract: () => fleet.onBoard?.(v),
    });
  }

  /** Nearest boardable vehicle within its door radius of `p` (or null). */
  fleet.nearby = (p) => {
    let best = null;
    let bd = Infinity;
    for (const v of list) {
      if (!LABEL[v.type] || !v.parked || v.away || v.summoning) continue;
      const d = doorWorld(v, _q).distanceTo(p);
      if (d <= DOOR_RADIUS[v.type] && d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };

  // ------------------------------------------------------------ summoning
  function spotFree(type, x, z, baseY) {
    const B = WORLD.playBounds - 12;
    if (Math.abs(x) > B || Math.abs(z) > B) return false;
    const r = FOOT_R[type];
    const wl = world.waterLevel ?? 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const y = surface(x + dx, z + dz, baseY);
      if (world.isWater?.(x + dx, z + dz) || y < wl + 0.2) return false;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (hi - lo > (type === 'car' ? 0.9 : 1.6)) return false;
    const hits = ctx.physics.queryRect(x - r, z - r, x + r, z + r, []);
    for (const b of hits) {
      if (!b.solid || b.tag === 'vehicles') continue;
      if (b.top > lo + 0.35 && b.bottom < lo + (type === 'car' ? 1.6 : 4)) return false;
    }
    if (type !== 'car') {
      // air vehicles also need open sky
      for (const b of hits) if (b.solid && b.bottom > lo + 3) return false;
    }
    for (const other of list) {
      if (other.type === 'colony' || !other.object.visible) continue;
      if (Math.hypot(other.object.position.x - x, other.object.position.z - z) < r + FOOT_R[other.type] * 0.8 && other !== fleet._summoned) return false;
    }
    return true;
  }

  /** Finds a free spot around the player for `type`; returns {x, z, y, heading} or null. */
  fleet.findSpot = (type, from, heading) => {
    const dists = [SUMMON_DIST[type], SUMMON_DIST[type] * 1.5, SUMMON_DIST[type] * 2.2];
    const angles = [-Math.PI / 2, Math.PI / 2, -Math.PI / 4, Math.PI / 4, 0, -3 * Math.PI / 4, 3 * Math.PI / 4, Math.PI];
    for (const d of dists) {
      for (const a of angles) {
        const h = heading + a;
        const x = from.x - Math.sin(h) * d;
        const z = from.z - Math.cos(h) * d;
        if (spotFree(type, x, z, from.y)) return { x, z, y: surface(x, z, from.y), heading: wrapAngle(heading + (type === 'car' ? 0 : 0.6)) };
      }
    }
    return null;
  };

  /** Picks the record for a summon of `type` (nearest VTOL). */
  fleet.pick = (type, near) => {
    const cands = list.filter((v) => v.type === type);
    if (!cands.length) return null;
    if (!near) return cands[0];
    return cands.reduce((a, b) => (a.object.position.distanceToSquared(near) <= b.object.position.distanceToSquared(near) ? a : b));
  };

  /** Moves v to the spot. Air vehicles hover down from 45 m unless `instant`. */
  fleet.bringTo = (v, spot, { instant = false } = {}) => {
    fleet._summoned = v;
    removeBoxes(v);
    if (v.type === 'car' || instant) {
      park(v, spot.x, spot.z, spot.heading, spot.y);
      return;
    }
    park(v, spot.x, spot.z, spot.heading, spot.y);
    removeBoxes(v);
    v.summoning = { t: 0, dur: v.type === 'ship' ? 4.2 : 3.2, from: spot.y + (v.type === 'ship' ? 70 : 45), to: spot.y };
    v.object.position.y = v.summoning.from;
    v.object.userData.setGear?.(0);
    v.object.userData.setStairs?.(0);
  };

  // ------------------------------------------------------------ idle update
  let time = 0;
  fleet.update = (dt) => {
    time += dt;
    for (const v of list) {
      const ud = v.object.userData;
      if (v.summoning) {
        const s = v.summoning;
        s.t += dt;
        const k = clamp(s.t / s.dur);
        const e = easeOutCubic(k);
        v.object.position.y = s.from + (s.to - s.from) * e;
        v.object.rotation.y = v.heading + (1 - e) * 0.9;
        ud.setRotor?.(0.85 - k * 0.5, dt);
        ud.setGear?.(clamp((k - 0.55) / 0.35));
        ud.setThrust?.(0.8 * (1 - k) + 0.2, 0);
        if (k >= 1) {
          v.summoning = null;
          park(v, v.object.position.x, v.object.position.z, v.heading, s.to);
          ctx.events.emit('vehicle:arrived', { type: v.type, id: v.id });
        }
        continue;
      }
      if (v === fleet.current) continue;
      if (!v.object.visible) continue;
      if (v.type === 'vtol' && v.parked) ud.setRotor?.(0, dt);
      if (v.type === 'ship' || v.type === 'colony') ud.update?.(v.type === 'colony' ? dt : time);
    }
  };

  fleet.applySavedSkins = () => {
    setSkin(car, store.skins.car || 'default', false);
  };
  return fleet;
}
