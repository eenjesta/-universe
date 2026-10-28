/**
 * Vehicles — garage modal (G in explore, ?garage URL hook), after the
 * poster's "Voertuigen & reizen" panel (crop_vehicles.png) and
 * 22_vehicle_sheet.png: four cards (ground vehicles, spaceships, air
 * vehicles, colony ships) with studio thumbnails (own scene rendered once per
 * model/skin through ctx.engine.snapshot, cached), descriptions, speed /
 * handling / cargo bars, skin swatches for owned market skins, "Summon" and
 * for the colony ship a fleet overview + fast travel to the spaceport.
 */
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { ZONES } from '../world/layout.js';
import { createStudio } from './studio.js';
import { createVehicleMaterials, applySkin, SKINS } from './materials.js';
import { createCarModel } from './car-model.js';
import { createVtolModel } from './vtol-model.js';
import { createColonyShipModel } from './colony-model.js';
import { wrapShip } from './ship-model.js';

const STATS = {
  car: [0.78, 0.82, 0.2],
  ship: [0.96, 0.46, 0.42],
  vtol: [0.62, 0.58, 0.55],
  colony: [0.16, 0.08, 1],
};
const VIEW = {
  car: { view: [-0.85, 0.24, -0.95], zoom: 0.9 },
  ship: { view: [-0.9, 0.42, -0.75], zoom: 0.92 },
  vtol: { view: [-0.6, 0.55, -1], zoom: 0.88 },
  colony: { view: [-1, 0.3, -0.62], zoom: 0.86 },
};
const SWATCH = {
  default: 'linear-gradient(135deg, #2a2d33, #0d0f12)',
  'skin-car-sunset': 'linear-gradient(135deg, #ffa45e, #ff4f78)',
  'skin-car-aurora': 'linear-gradient(135deg, #3dffc4, #7a5bff)',
  'skin-ship-gold': 'linear-gradient(135deg, #ffe2a0, #b8862c)',
};

export function createGarage(ctx, api, fleet, shipFactory) {
  const { ui } = ctx;
  const h = ui.h.bind(ui);
  const cache = new Map(); // key → canvas
  const queue = [];
  let studio = null;
  let models = null;
  let open = false;
  let cards = {};

  function ensureStudio() {
    if (studio) return;
    studio = createStudio(ctx.engine.renderer);
    const mats = createVehicleMaterials();
    const car = createCarModel(mats, { paintMat: mats.makePaint(), glowMat: mats.makeGlow() });
    car.userData.underglow.visible = false;
    const vtol = createVtolModel(mats);
    vtol.userData.setRotor(0, 0);
    vtol.position.y = 0;
    const colony = createColonyShipModel({ length: 150, legs: true });
    colony.position.y = colony.userData.groundOffset;
    models = { car, vtol, colony, ship: null, shipVariant: null, mats };
  }

  function shipModel(variant) {
    if (models.ship && models.shipVariant === variant) return models.ship;
    if (models.ship) models.ship.userData.dispose?.();
    models.ship = wrapShip(shipFactory.create({ variant, gear: true }), models.mats);
    models.ship.userData.setStairs(1);
    models.shipVariant = variant;
    return models.ship;
  }

  const keyOf = (type, skin) => `${type}:${skin || 'default'}`;

  function render(type, skin) {
    ensureStudio();
    let obj;
    if (type === 'car') {
      obj = models.car;
      applySkin(obj.userData.paint, SKINS.car[skin] || SKINS.car.default);
    } else if (type === 'ship') obj = shipModel(skin === 'skin-ship-gold' ? 'gold' : 'player');
    else obj = models[type];
    studio.show(obj);
    const v = VIEW[type];
    studio.frame(obj, v.view, { zoom: v.zoom, aspect: 16 / 10, fov: 30 });
    studio.camera.aspect = 16 / 10;
    studio.camera.updateProjectionMatrix();
    return ctx.engine.snapshot(studio.scene, studio.camera, 480, 300);
  }

  /** One thumbnail per frame while the garage is open. */
  ctx.loop.add(
    'veh-garage-thumbs',
    () => {
      if (!open || !queue.length) return;
      const { type, skin } = queue.shift();
      const key = keyOf(type, skin);
      if (cache.has(key)) return;
      try {
        cache.set(key, render(type, skin));
      } catch (err) {
        console.warn('[vehicles] garage thumbnail failed', err);
        cache.set(key, null);
      }
      paint(type);
    },
    { order: 93, pausable: false },
  );

  function wanted(type) {
    if (type === 'car') return fleet.car.skin;
    if (type === 'ship') return fleet.ship.skin;
    return 'default';
  }

  function paint(type) {
    const c = cards[type];
    if (!c) return;
    const canvas = cache.get(keyOf(type, wanted(type)));
    if (canvas) {
      c.thumb.replaceChildren(canvas);
    }
  }

  function request(type) {
    const skin = wanted(type);
    const key = keyOf(type, skin);
    if (cache.has(key)) {
      paint(type);
      return;
    }
    if (!queue.some((q) => q.type === type && q.skin === skin)) queue.push({ type, skin });
  }

  function whereIs(v) {
    if (v.away) return t({ en: 'In orbit', nl: 'In een baan om de planeet' });
    if (ctx.modes.is('drive') && fleet.current === v) return t({ en: 'In use', nl: 'In gebruik' });
    const p = v.object.position;
    let best = null;
    let bd = Infinity;
    for (const z of Object.values(ZONES)) {
      const d = Math.hypot(z.x - p.x, z.z - p.z) - (z.radius || 0) * 0.5;
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best ? best.label : '—';
  }

  function card(entry) {
    const type = entry.type;
    const thumb = h('div', { class: 'veh-thumb' }, h('div', { class: 'veh-thumb-wait', html: ui.icon(entry.icon, 40) }));
    const statRows = [
      [t({ en: 'Speed', nl: 'Snelheid' }), STATS[type][0]],
      [t({ en: 'Handling', nl: 'Wendbaarheid' }), STATS[type][1]],
      [t({ en: 'Cargo', nl: 'Lading' }), STATS[type][2]],
    ];
    const stats = h('div', { class: 'veh-stats' }, ...statRows.flatMap(([l, v]) => [h('span', {}, l), h('div', { class: 'veh-stat' }, h('i', { style: { width: `${Math.round(v * 100)}%` } }))]));
    const body = h('div', { class: 'veh-card-body' }, h('div', { class: 'veh-card-title' }, h('span', { html: ui.icon(entry.icon, 22) }), entry.name), h('div', { class: 'veh-card-desc' }, entry.desc), stats);
    if (type !== 'colony') {
      // where the vehicle(s) of this type are right now
      const places = fleet.list.filter((v) => v.type === type).map(whereIs);
      body.append(h('div', { class: 'veh-card-where' }, h('span', { html: ui.icon('pin', 14) }), [...new Set(places)].join(' · ')));
    }
    if (SKINS[type]) {
      const row = h('div', { class: 'veh-skins' }, h('span', { class: 'veh-skins-label' }, t({ en: 'Skin', nl: 'Lak' })));
      const v = type === 'car' ? fleet.car : fleet.ship;
      for (const skin of Object.values(SKINS[type])) {
        const owned = fleet.owned(skin.id);
        const b = h('button', {
          class: `veh-skin${v.skin === skin.id ? ' on' : ''}`,
          style: { background: SWATCH[skin.id] || SWATCH.default },
          title: owned ? t(skin.name) : `${t(skin.name)} — ${t({ en: 'buy it in the marketplace (K)', nl: 'koop in de marktplaats (K)' })}`,
          disabled: owned ? null : true,
          onclick: () => {
            if (!fleet.setSkin(v, skin.id)) return;
            row.querySelectorAll('.veh-skin').forEach((x) => x.classList.remove('on'));
            b.classList.add('on');
            ctx.audio.play('ui.click');
            request(type);
          },
        });
        row.append(b);
      }
      body.append(row);
    }
    const actions = h('div', { class: 'veh-card-actions' });
    if (type === 'colony') {
      const list = h(
        'div',
        { class: 'veh-fleet' },
        ...fleet.list
          .filter((v) => v.type !== 'colony')
          .map((v) => h('div', { class: 'veh-fleet-row' }, h('b', {}, v.name), h('span', {}, whereIs(v)))),
      );
      body.append(h('div', { class: 'veh-card-note' }, t({ en: 'Manage your fleet. The colony ship is being fitted out in the spaceport hangar.', nl: 'Beheer je vloot. Het kolonieschip wordt uitgerust in de hangar van de ruimtehaven.' })), list);
      body.append(h('div', { class: 'veh-card-where' }, h('span', { html: ui.icon('pin', 14) }), t({ en: 'Hangar · Spaceport', nl: 'Hangar · Ruimtehaven' })));
      actions.append(
        h(
          'button',
          {
            class: 'btn btn-sm',
            onclick: () => {
              ui.closeModal('garage');
              if (ctx.shell?.fastTravel) ctx.shell.fastTravel('spaceport');
              else ctx.player?.teleport?.('spaceport');
            },
          },
          t({ en: 'Fast travel', nl: 'Snel reizen' }),
        ),
      );
    } else {
      actions.append(
        h(
          'button',
          {
            class: 'btn btn-sm btn-primary',
            onclick: () => {
              ui.closeModal('garage');
              api.summon(type);
            },
          },
          t({ en: 'Summon', nl: 'Oproepen' }),
        ),
      );
    }
    body.append(actions);
    const el = h('div', { class: 'veh-card', dataset: { type } }, thumb, body);
    cards[type] = { el, thumb };
    return el;
  }

  const garage = {
    get isOpen() {
      return open;
    },
    open() {
      if (open) return;
      cards = {};
      const grid = h('div', { class: 'veh-cards' }, ...api.catalog.map(card));
      const el = h(
        'div',
        { class: 'veh-garage' },
        h(
          'div',
          { class: 'veh-garage-head' },
          h('div', {}, h('div', { class: 'veh-garage-title' }, t({ en: 'Vehicles & travel', nl: 'Voertuigen & reizen' })), h('div', { class: 'veh-garage-sub' }, t({ en: 'Garage', nl: 'Garage' }))),
          h('button', { class: 'modal-close', html: ui.icon('close', 22), onclick: () => ui.closeModal('garage') }),
        ),
        grid,
        h('div', { class: 'veh-garage-foot' }, h('span', {}, t({ en: 'F — board a vehicle nearby · skins are sold in the marketplace (K)', nl: 'F — instappen bij een voertuig · lakken koop je in de marktplaats (K)' })), h('span', { class: 'kbd' }, 'G')),
      );
      open = true;
      ui.openModal('garage', el, {
        className: 'veh-garage-wrap',
        onClose: () => {
          open = false;
        },
      });
      ctx.audio.play('ui.open');
      for (const e of api.catalog) request(e.type);
    },
    close() {
      ui.closeModal('garage');
      open = false;
    },
    toggle() {
      if (open) garage.close();
      else garage.open();
    },
    /** Renders (or returns the cached) thumbnail canvas for a type (tests / other modules). */
    thumbnail(type, skin = 'default') {
      const key = keyOf(type, skin);
      if (!cache.has(key)) cache.set(key, render(type, skin));
      return cache.get(key);
    },
  };
  return garage;
}

export { THREE };
