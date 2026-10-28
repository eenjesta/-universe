/**
 * Vehicles — "Ruimteschip" (atmospheric ship on the spaceport pad).
 * Uses the space module's createShipModel (src/space/ship-model.js, shared
 * design: sleek dark angular hull, swept wings, Ø tail fin, twin orange
 * engines) when it exists — loaded with import.meta.glob so the build never
 * fails if the file is missing — otherwise a compact local fallback of the
 * same design. `wrapShip` normalises either model: origin on the ground with
 * the gear down, boarding stairs on the left side, engine glow control, and
 * the planet-side look (golden hour / night readability, see planetLook):
 * lighter gunmetal hull with the panel texture, stronger strips / nav / core
 * glow, fill + rim + pad uplight (patchFill, mats.shipFill) and a warm light
 * pool on the pad (userData.pool, driven by look.js). The space module's
 * materials are per model instance, so the ship in space is untouched.
 *
 *   const factory = await loadShipFactory();      // → (opts) => Group
 *   const ship = wrapShip(factory({ variant: 'player', gear: true }), mats);
 *   ship.userData.setGear(0…1); ship.userData.setStairs(0…1); ship.userData.setThrust(t, boost)
 */
import * as THREE from 'three';
import { PartBuilder, M, loft, chamferSection, strut, strip } from './geo.js';
import { hdr, patchFill } from './materials.js';

const spaceShip = import.meta.glob('../space/ship-model.js');

let factoryPromise = null;
/** Resolves to createShipModel(opts) from the space module, or the local fallback. */
export function loadShipFactory(mats) {
  if (!factoryPromise) {
    factoryPromise = (async () => {
      const load = spaceShip['../space/ship-model.js'];
      if (load) {
        try {
          const mod = await load();
          if (typeof mod.createShipModel === 'function') {
            const test = mod.createShipModel({ variant: 'player', gear: true });
            if (test?.isObject3D) {
              test.userData?.dispose?.();
              return { create: mod.createShipModel, source: 'space' };
            }
          }
        } catch (err) {
          console.warn('[vehicles] space ship model failed — using the local design', err);
        }
      }
      return { create: (opts) => createFallbackShip(mats, opts), source: 'vehicles' };
    })();
  }
  return factoryPromise;
}

/** Compact local ship of the same design (used only if the space model is missing). */
export function createFallbackShip(mats, { variant = 'player' } = {}) {
  const group = new THREE.Group();
  const A = new PartBuilder();
  const D = new PartBuilder();
  const G = new PartBuilder();
  const Gl = new PartBuilder();
  const hull = variant === 'gold' ? 0xc89a48 : 0x1b1e23;
  const orange = hdr(0xff8a3a, 5);
  const blue = hdr(0x5fc8ff, 4);
  const fuse = [
    [-8.2, 0.12, 0.1, 0.12, 0.3, 0.1],
    [-6.4, 0.7, 0.45, 0.4, 0.3, 0.12],
    [-4.2, 1.25, 0.82, 0.6, 0.3, 0.12],
    [-1.5, 1.65, 1.05, 0.75, 0.3, 0.1],
    [1.8, 1.7, 1.05, 0.78, 0.3, 0.08],
    [4.8, 1.45, 0.88, 0.72, 0.32, 0.05],
    [6.6, 1.2, 0.72, 0.62, 0.34, 0.05],
  ];
  A.add(loft(fuse.map(([z, hw, t, b, ch, cy]) => chamferSection(z, hw, t, b, ch, cy)), { flat: true }), null, { color: hull });
  const canopy = [];
  for (const [z, h] of [[-5.6, 0], [-4.8, 0.35], [-3.6, 0.5], [-2.4, 0.45], [-1.6, 0]]) {
    const ring = [];
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * Math.PI;
      ring.push(new THREE.Vector3(Math.cos(a) * 0.72, 0.55 + Math.sin(a) * (h + 0.1), z));
    }
    canopy.push(ring);
  }
  Gl.add(loft(canopy, { closed: false, flat: true }));
  const wing = new THREE.Shape();
  wing.moveTo(1.4, -1.6);
  wing.lineTo(6.4, 3.6);
  wing.lineTo(6.6, 5.4);
  wing.lineTo(1.4, 6.2);
  const wg = new THREE.ExtrudeGeometry(wing, { depth: 0.22, bevelEnabled: false });
  wg.rotateX(Math.PI / 2);
  A.add(wg, M(0, 0.05, 0), { color: hull, mirror: true });
  const fin = new THREE.Shape();
  fin.moveTo(3.2, 0.8);
  fin.lineTo(5.6, 3.4);
  fin.lineTo(6.8, 3.5);
  fin.lineTo(6.9, 0.8);
  const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.2, bevelEnabled: false });
  fg.rotateY(-Math.PI / 2);
  A.add(fg, M(0.1, 0, 0), { color: hull });
  const engines = [];
  for (const s of [-1, 1]) {
    D.add(new THREE.CylinderGeometry(0.62, 0.7, 2.6, 14), M(s * 1.05, 0, 6.2, Math.PI / 2), { color: 0x2a2d33 });
    G.add(new THREE.CircleGeometry(0.5, 16), M(s * 1.05, 0, 7.52), { color: orange });
    G.add(strip([s * 1.7, 0.02, -1.0], [s * 6.2, 0.06, 3.9], 0.05, 0.04), null, { color: blue });
    G.add(strip([s * 1.2, -0.3, -4.0], [s * 1.6, -0.25, -1.2], 0.04, 0.04), null, { color: orange });
    const e = new THREE.Object3D();
    e.position.set(s * 1.05, 0, 7.6);
    group.add(e);
    engines.push(e);
  }
  group.add(A.mesh(mats.makeArmor ? mats.makeArmor(16) : mats.armor, { name: 'ship-hull' }), D.mesh(mats.dark, { name: 'ship-dark' }), G.mesh(mats.glow, { name: 'ship-lights', castShadow: false }), Gl.mesh(mats.glass, { name: 'ship-glass' }));
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), mats.decal);
  decal.position.set(-0.01, 2.2, 6.0);
  decal.rotation.y = -Math.PI / 2;
  const decal2 = decal.clone();
  decal2.position.x = 0.21;
  decal2.rotation.y = Math.PI / 2;
  group.add(decal, decal2);
  const gear = new THREE.Group();
  const GR = new PartBuilder();
  for (const [x, z] of [[0, -4.6], [-1.6, 2.6], [1.6, 2.6]]) {
    GR.add(strut([x, -0.6, z], [x, -1.95, z], 0.09, 6), null, { color: 0x3a3e45 });
    GR.add(new THREE.CylinderGeometry(0.32, 0.36, 0.2, 12), M(x, -2.06, z), { color: 0x24272c });
  }
  gear.add(GR.mesh(mats.dark, { name: 'ship-gear' }));
  group.add(gear);
  let thrust = 0.4;
  group.userData = {
    engines,
    groundOffset: 2.16,
    size: { length: 15.9, span: 13.2, height: 4 },
    setThrust(t = 0.4) {
      thrust = t;
    },
    setGear(on) {
      gear.visible = !!on;
    },
    update() {},
    get thrust() {
      return thrust;
    },
  };
  return group;
}

/**
 * Planet-side material tuning of a space-module ship (its own material
 * instances): lighter metallic gunmetal hull (the shared panel texture keeps
 * its seams and greebles), glossier + warmer environment reflections, brighter
 * light strips / nav lights / cockpit, and the fill/rim/uplight patch.
 * Returns the material set (or null for the local fallback model).
 */
export const PLANET_LOOK = {
  // polished light gunmetal: × the dark panel texture (its seams stay dark) → ~sRGB 0.36–0.41
  player: { hull: [6.0, 5.8, 5.4], metal: 0.8, rough: 0.66, env: 2.0 },
  gold: { hull: [1.3, 1.25, 1.18], metal: 0.92, rough: 0.66, env: 1.7 },
  strips: 1.8,
  nav: 1.4,
  core: 1.9,
};
function planetLook(model, mats, variant) {
  const m = model.userData?.materials;
  if (!m?.hull?.isMeshStandardMaterial) return null;
  const L = PLANET_LOOK[variant] || PLANET_LOOK.player;
  m.hull.color.setRGB(L.hull[0], L.hull[1], L.hull[2]);
  m.hull.metalness = L.metal;
  m.hull.roughness = L.rough;
  m.hull.envMapIntensity = L.env;
  if (m.trim) {
    m.trim.color.multiplyScalar(1.5);
    m.trim.envMapIntensity = 1.4;
  }
  if (m.dark) m.dark.color.multiplyScalar(2.2);
  if (m.glass) {
    m.glass.emissiveIntensity = 1.1;
    m.glass.envMapIntensity = 1.4;
  }
  for (const k of ['orange', 'blue']) m[k]?.color?.multiplyScalar(PLANET_LOOK.strips);
  for (const k of ['red', 'green', 'white']) m[k]?.color?.multiplyScalar(PLANET_LOOK.nav);
  if (mats?.shipFill) for (const k of ['hull', 'trim', 'dark', 'glass', 'emblem']) if (m[k]?.isMeshStandardMaterial) patchFill(m[k], mats.shipFill);
  return m;
}

/**
 * Wraps a ship model for the planet: wrapper origin on the ground (gear down),
 * adds boarding stairs on the left side, engine glow sprites, the planet look
 * and the pad light pool.
 */
export function wrapShip(model, mats, { variant = 'player' } = {}) {
  const wrap = new THREE.Group();
  wrap.name = 'ship';
  const ud = model.userData || {};
  const lift = ud.groundOffset ?? 2.16;
  const look = planetLook(model, mats, variant);
  // pad uplight range in the model's frame: full at the ground, gone above the canopy
  mats?.shipFill?.uUpRange.value.set(-lift, 1.6);
  model.position.y = lift;
  wrap.add(model);
  ud.setGear?.(true);
  const bb = new THREE.Box3().setFromObject(model);
  const length = Math.max(6, bb.max.z - bb.min.z);

  // boarding stairs (left side, behind the cockpit)
  const stairs = new THREE.Group();
  stairs.name = 'ship-stairs';
  const S = new PartBuilder();
  const SG = new PartBuilder();
  const topY = lift - 0.55;
  const steps = 7;
  const run = 3.1;
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps;
    S.box(1.2, 0.07, run / steps + 0.06, M(0, topY * (1 - f), -run * f + 0.1), { color: 0x2a2d33 });
    SG.box(1.0, 0.02, 0.03, M(0, topY * (1 - f) + 0.045, -run * f + 0.1 - run / steps / 2 + 0.02), { color: hdr(0xffb35a, 2.2) });
  }
  for (const s of [-1, 1]) {
    S.add(strut([s * 0.62, topY + 0.05, 0.2], [s * 0.62, 0.02, -run - 0.1], 0.05, 5), null, { color: 0x3a3e45 });
    S.add(strut([s * 0.62, topY + 1.0, 0.2], [s * 0.62, 0.9, -run - 0.1], 0.025, 5), null, { color: 0x8a8e95 });
    S.add(strut([s * 0.62, 0.9, -run - 0.1], [s * 0.62, 0, -run - 0.1], 0.025, 5), null, { color: 0x8a8e95 });
    SG.add(strip([s * 0.62, topY + 1.03, 0.2], [s * 0.62, 0.93, -run - 0.1], 0.02, 0.02), null, { color: hdr(0xffb35a, 2.5) });
  }
  S.box(1.4, 0.12, 1.0, M(0, topY + 0.02, 0.6), { color: 0x2a2d33 });
  stairs.add(S.mesh(mats.dark, { name: 'ship-stairs' }), SG.mesh(mats.glow, { name: 'ship-stair-lights', castShadow: false }));
  // stairs on the right (+X) side: rotate so the run (local −Z) points to +X
  stairs.rotation.y = -Math.PI / 2;
  stairs.position.set(1.35, 0, -0.6);
  wrap.add(stairs);

  // engine glow sprites (works with any model that exposes userData.engines)
  const glowMat = new THREE.SpriteMaterial({ map: mats.tex.radial, color: hdr(0xff9a4a, 2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sprites = [];
  for (const e of ud.engines || []) {
    const sp = new THREE.Sprite(glowMat);
    sp.scale.setScalar(1.6);
    e.add(sp);
    sprites.push(sp);
  }

  // warm light pool on the pad (additive, colour/visibility driven by look.js)
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ name: 'ship-pad-pool', map: mats.tex.radial, color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  pool.name = 'ship-pad-pool';
  pool.scale.set(21, 1, Math.max(21, length * 1.5));
  pool.position.set(0, 0.06, 0.4);
  pool.renderOrder = 1;
  pool.castShadow = pool.receiveShadow = false;
  pool.visible = false;
  wrap.add(pool);

  let stairK = 1;
  let thrustT = 0;
  wrap.userData = {
    type: 'ship',
    model,
    length,
    stairs,
    engines: ud.engines || [],
    door: new THREE.Vector3(4.4, 0.4, -0.6),
    setGear(k) {
      ud.setGear?.(k > 0.5);
    },
    setStairs(k) {
      stairK = Math.max(0, Math.min(1, k));
      stairs.visible = stairK > 0.02;
      stairs.scale.set(1, 1, stairK);
    },
    get stairK() {
      return stairK;
    },
    pool,
    planet: !!look,
    setThrust(t, boost = 0) {
      thrustT = t;
      ud.setThrust?.(t, boost);
      // planet: brighter engine cores; a warm standby glow when parked
      // (the space model re-sets the core colour inside its setThrust, so this scales once per
      // call; the cap keeps it bounded HDR even if that ever changes — no runaway into Inf/NaN)
      const cc = look?.core?.color;
      if (cc) {
        cc.multiplyScalar(PLANET_LOOK.core);
        const m = Math.max(cc.r, cc.g, cc.b);
        if (!Number.isFinite(m)) cc.setRGB(6.5, 2.3, 0.6);
        else if (m > 40) cc.multiplyScalar(40 / m);
      }
      const s = 1.2 + t * 2.0 + boost * 1.6;
      for (const sp of sprites) sp.scale.setScalar(s);
      glowMat.opacity = 0.55 + t * 0.45;
    },
    get thrust() {
      return thrustT;
    },
    update(t) {
      ud.update?.(t);
    },
    dispose() {
      ud.dispose?.();
    },
  };
  return wrap;
}
