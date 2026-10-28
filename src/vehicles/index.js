/**
 * Vehicles module (Ø Universe) → ctx.vehicles
 *
 * Car ("Grondvoertuig"), tilt-rotor VTOL ("Luchtvoertuig"), atmospheric ship
 * ("Ruimteschip", the space module's createShipModel) and the colony ship
 * ("Kolonieschip", colony-model.js) parked at the spaceport pads, the base
 * landing pad and in the hangar; mode 'drive' with arcade car / hover flight
 * physics, vehicle HUD + key hints, garage modal (G, ?garage), summoning,
 * ship launch to space, ambient air traffic and engine sounds.
 *
 * API (ARCHITECTURE §5): catalog [{type, name, desc, icon}], list, current,
 *   summon(type) → vehicle|null, summonAndEnter(type) → Promise<vehicle|null>,
 *   enter(vehicle|type|id), exit(), plus: fleet, garage, traffic, setSkin(type, skinId),
 *   launch(), materials, createColonyShipModel (re-export).
 * Events: vehicle:enter / vehicle:exit / vehicle:summon {type, id},
 *   vehicle:launch {type}, vehicle:land {type, id}, vehicle:arrived {type, id}.
 * Files: geo.js, materials.js, car-model.js, vtol-model.js, ship-model.js,
 *   colony-model.js, studio.js, fleet.js, controllers.js, drive.js, hud.js,
 *   fx.js, garage.js, traffic.js, look.js (golden-hour / night readability:
 *   fill + rim + pad light of the parked ship, ctx.vehicles.look.params),
 *   vehicles.css, dev/lab.html.
 */
import './vehicles.css';
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { createVehicleMaterials } from './materials.js';
import { loadShipFactory } from './ship-model.js';
import { createFleet } from './fleet.js';
import { createHud } from './hud.js';
import { createFx } from './fx.js';
import { createDrive } from './drive.js';
import { createGarage } from './garage.js';
import { createTraffic } from './traffic.js';
import { createColonyShipModel } from './colony-model.js';
import { createLook } from './look.js';

export { createColonyShipModel };

export async function install(ctx, { progress = () => {} } = {}) {
  const t0 = performance.now();
  const { events, modes, input, ui, loop } = ctx;
  if (!ctx.world?.scene) throw new Error('vehicles: ctx.world.scene missing');
  const sunVis = ctx.world.terrain?.sunVisibility?.applySunVisibility?.bind(ctx.world.terrain.sunVisibility);
  const mats = createVehicleMaterials({ sunVis });
  const shipFactory = await loadShipFactory(mats);
  progress(0.2);
  const fleet = createFleet(ctx, mats, shipFactory);
  const look = createLook(ctx, fleet, mats);
  progress(0.5);
  const hud = createHud(ctx);
  const fx = createFx(ctx);

  // one headlight spot for the driven car (always in the scene: no recompiles)
  const light = { group: new THREE.Group(), spot: new THREE.SpotLight(0xfff0dc, 0, 70, 0.55, 0.6, 1.3) };
  light.group.name = 'veh-headlight';
  light.spot.position.set(0, 0.75, -2.2);
  light.spot.target.position.set(0, -1.2, -24);
  light.spot.castShadow = false;
  light.group.add(light.spot, light.spot.target);
  ctx.world.scene.add(light.group);

  const drive = createDrive(ctx, fleet, hud, fx, light);

  const catalog = [
    { type: 'car', name: t({ en: 'Ground vehicles', nl: 'Grondvoertuigen' }), desc: t({ en: 'From scouts to futuristic cars.', nl: 'Van verkenners tot futuristische auto’s.' }), icon: 'car' },
    { type: 'ship', name: t({ en: 'Spaceships', nl: 'Ruimteschepen' }), desc: t({ en: 'Travel between planets and star systems.', nl: 'Reis tussen planeten en sterrenstelsels.' }), icon: 'ship' },
    { type: 'vtol', name: t({ en: 'Air vehicles', nl: 'Luchtvoertuigen' }), desc: t({ en: 'Move through the world fast and free.', nl: 'Snel en vrij door de wereld bewegen.' }), icon: 'plane' },
    { type: 'colony', name: t({ en: 'Colony ships', nl: 'Kolonieschepen' }), desc: t({ en: 'Build and manage your own fleet.', nl: 'Bouw en beheer je eigen vloot.' }), icon: 'colony' },
  ];

  const playerPos = () => ctx.player?.position || ctx.player?.object?.position || null;

  function resolve(v) {
    if (!v) return null;
    if (typeof v === 'string') return fleet.list.find((x) => x.id === v) || fleet.pick(v, playerPos());
    return v;
  }

  const api = {
    catalog,
    list: fleet.list,
    get current() {
      return drive.current;
    },
    fleet,
    look,
    materials: mats,
    createColonyShipModel,
    shipSource: shipFactory.source,

    summon(type, { instant = false, silent = false } = {}) {
      if (type === 'colony') {
        ui.toast({ title: t({ en: 'Colony ship', nl: 'Kolonieschip' }), text: t({ en: 'Too big to summon — visit it in the spaceport hangar.', nl: 'Te groot om op te roepen — bezoek het in de hangar van de ruimtehaven.' }), icon: 'colony', kind: 'info' });
        return null;
      }
      const p = playerPos();
      if (!p || !['car', 'vtol', 'ship'].includes(type)) return null;
      if (modes.is('drive')) {
        if (drive.current?.type === type) return drive.current;
        ui.toast({ title: t({ en: 'Get out first', nl: 'Stap eerst uit' }), text: t({ en: 'You can only summon a vehicle on foot.', nl: 'Je kunt alleen te voet een voertuig oproepen.' }), icon: 'car', kind: 'warn' });
        return null;
      }
      const v = fleet.pick(type, p);
      if (!v) return null;
      const name = v.name;
      if (!instant && v.parked && !v.away && v.object.position.distanceTo(p) < 40) {
        if (!silent) ui.toast({ title: name, text: t({ en: 'Already right here.', nl: 'Staat al hier.' }), icon: type === 'vtol' ? 'plane' : type, kind: 'info', duration: 2400 });
        return v;
      }
      const heading = ctx.player?.heading ?? 0;
      const spot = fleet.findSpot(type, p, heading);
      if (!spot) {
        if (!silent) ui.toast({ title: t({ en: 'No room here', nl: 'Geen ruimte hier' }), text: t({ en: 'Find an open, dry spot and try again.', nl: 'Zoek een open, droge plek en probeer opnieuw.' }), icon: 'info', kind: 'warn' });
        return null;
      }
      fleet.bringTo(v, spot, { instant });
      events.emit('vehicle:summon', { type, id: v.id });
      if (!silent) {
        ui.toast({
          title: name,
          text: type === 'car' ? t({ en: 'Ready beside you. Press F to get in.', nl: 'Staat naast je klaar. Druk op F om in te stappen.' }) : t({ en: 'Coming in to land next to you…', nl: 'Komt naast je landen…' }),
          icon: type === 'vtol' ? 'plane' : type,
          kind: 'success',
        });
      }
      return v;
    },

    async summonAndEnter(type) {
      const v = api.summon(type, { instant: true, silent: true });
      if (!v) return null;
      await api.enter(v);
      return v;
    },

    enter(v) {
      v = resolve(v);
      if (!v || v.type === 'colony' || !modes.has('drive')) return Promise.resolve(null);
      if (v.summoning) return Promise.resolve(null);
      return modes.go('drive', { vehicle: v }, { fade: false });
    },

    exit() {
      drive.exit();
    },

    launch() {
      drive.launch();
    },

    /** Debug/tests: the active controller (car or air physics state). */
    controller() {
      return drive.controller();
    },

    setSkin(type, skinId) {
      const v = type === 'car' ? fleet.car : type === 'ship' ? fleet.ship : null;
      return v ? fleet.setSkin(v, skinId) : false;
    },
  };
  fleet.onBoard = (v) => api.enter(v);

  const garage = createGarage(ctx, api, fleet, shipFactory);
  api.garage = garage;
  progress(0.75);
  try {
    api.traffic = createTraffic(ctx, mats);
  } catch (err) {
    console.error('[vehicles] air traffic failed', err);
    ctx.errors.push({ module: 'vehicles/traffic', error: String(err?.stack || err) });
  }

  // ------------------------------------------------------------ loop systems
  loop.add('veh-fleet', (dt) => fleet.update(dt), { order: 31, when: () => modes.is('explore', 'drive', 'title') });
  loop.add('veh-look', (dt) => look.update(dt), { order: 31, when: () => modes.is('explore', 'drive', 'title') });
  let toastT = 0;
  loop.add(
    'veh-explore',
    (dt) => {
      toastT = Math.max(0, toastT - dt);
      if (modes.transitioning || !input.gameEnabled) return;
      if (input.actionPressed('vehicle')) {
        const p = playerPos();
        if (p && !fleet.nearby(p) && toastT <= 0) {
          toastT = 2;
          ui.toast({ title: t({ en: 'No vehicle nearby', nl: 'Geen voertuig in de buurt' }), text: t({ en: 'Press G to open the garage and summon one.', nl: 'Druk op G om de garage te openen en er een op te roepen.' }), icon: 'car', kind: 'info', duration: 3200 });
        }
      }
      if (input.actionPressed('garage')) garage.open();
    },
    { order: 44, when: () => modes.is('explore') },
  );
  loop.add('veh-traffic', (dt, time) => api.traffic?.update(dt, time), { order: 34, when: () => modes.is('explore', 'drive', 'title') });

  // ?garage URL hook
  events.on('game:start', async () => {
    if (!ctx.params.garage) return;
    if (!modes.is('explore')) await modes.go('explore', { resume: true }, { fade: false });
    garage.open();
  });
  // market purchases → skins usable at once
  events.on('market:buy', ({ item } = {}) => {
    const id = typeof item === 'string' ? item : item?.id;
    if (id === 'skin-car-sunset' || id === 'skin-car-aurora') api.setSkin('car', id);
    if (id === 'skin-ship-gold') api.setSkin('ship', id);
  });

  progress(1);
  console.log(`[vehicles] installed in ${Math.round(performance.now() - t0)} ms (ship model: ${shipFactory.source})`);
  return api;
}
