/**
 * Vehicles — HUD while driving/flying (mode 'drive'):
 *   bottom-center (order 10): speed "180 km/h" + bar, "ALTITUDE 24 m" for air
 *   vehicles, boost bar, handbrake / gear / water indicators — thin glass
 *   style of 16_vtol_flight.png.
 *   bottom-right (order 10): key hints for the vehicle type.
 * DOM writes only when a displayed value changes.
 */
import { t } from '../core/i18n.js';
import { formatNumber } from '../core/math.js';

const HINTS = {
  car: [
    ['W / S', { en: 'Throttle / brake', nl: 'Gas / rem' }],
    ['A / D', { en: 'Steer', nl: 'Sturen' }],
    [{ en: 'Space', nl: 'Spatie' }, { en: 'Handbrake', nl: 'Handrem' }],
    ['Shift', { en: 'Boost', nl: 'Boost' }],
    ['F', { en: 'Get out', nl: 'Uitstappen' }],
  ],
  vtol: [
    ['W / S', { en: 'Forward / back', nl: 'Vooruit / achteruit' }],
    ['A / D', { en: 'Strafe', nl: 'Zijwaarts' }],
    [{ en: 'Mouse', nl: 'Muis' }, { en: 'Turn', nl: 'Richting' }],
    [{ en: 'Space', nl: 'Spatie' }, { en: 'Climb', nl: 'Stijgen' }],
    ['C', { en: 'Descend', nl: 'Dalen' }],
    ['Shift', { en: 'Boost', nl: 'Boost' }],
    ['F', { en: 'Get out (landed)', nl: 'Uitstappen (geland)' }],
  ],
  ship: [
    ['W / S', { en: 'Forward / back', nl: 'Vooruit / achteruit' }],
    ['A / D', { en: 'Strafe', nl: 'Zijwaarts' }],
    [{ en: 'Mouse', nl: 'Muis' }, { en: 'Turn', nl: 'Richting' }],
    [{ en: 'Space', nl: 'Spatie' }, { en: 'Climb', nl: 'Stijgen' }],
    ['C', { en: 'Descend', nl: 'Dalen' }],
    ['Shift', { en: 'Boost', nl: 'Boost' }],
    ['L', { en: 'Launch into space', nl: 'Lanceren naar de ruimte' }],
    ['F', { en: 'Get out (landed)', nl: 'Uitstappen (geland)' }],
  ],
};

export function createHud(ctx) {
  const { ui } = ctx;
  const h = ui.h.bind(ui);
  const num = h('span', { class: 'veh-num' }, '0');
  const unit = h('span', { class: 'veh-unit' }, t({ en: 'km/h', nl: 'km/u' }));
  const barFill = h('i');
  const bar = h('div', { class: 'veh-speedbar' }, barFill);
  const altNum = h('span', { class: 'veh-num' }, '0');
  const alt = h(
    'div',
    { class: 'veh-alt' },
    h('div', { class: 'veh-label' }, t({ en: 'Altitude', nl: 'Hoogte' })),
    h('div', { class: 'veh-alt-val' }, altNum, h('span', { class: 'veh-unit' }, 'm')),
  );
  const boostFill = h('i');
  const boost = h('div', { class: 'veh-boost' }, h('span', { class: 'veh-label' }, t({ en: 'Boost', nl: 'Boost' })), h('div', { class: 'veh-boostbar' }, boostFill));
  const tagHand = h('span', { class: 'veh-tag' }, t({ en: 'Handbrake', nl: 'Handrem' }));
  const tagGear = h('span', { class: 'veh-tag' }, t({ en: 'Gear down', nl: 'Landingsgestel' }));
  const tagLand = h('span', { class: 'veh-tag veh-tag-ok' }, t({ en: 'Landed', nl: 'Geland' }));
  const tagRoad = h('span', { class: 'veh-tag veh-tag-ok' }, t({ en: 'Road', nl: 'Weg' }));
  const tagLaunch = h('span', { class: 'veh-tag veh-tag-gold' }, t({ en: 'Launch window', nl: 'Lanceervenster' }));
  const tags = h('div', { class: 'veh-tags' }, tagRoad, tagHand, tagGear, tagLand, tagLaunch);
  const title = h('div', { class: 'veh-title' });
  const el = h(
    'div',
    { class: 'veh-hud' },
    title,
    h('div', { class: 'veh-row' }, h('div', { class: 'veh-speed' }, h('div', { class: 'veh-speed-val' }, num, unit), bar), h('div', { class: 'veh-sep' }), alt),
    h('div', { class: 'veh-row veh-row-2' }, boost, tags),
  );
  ui.addWidget('bottom-center', el, { modes: ['drive'], order: 10 });
  const hints = h('div', { class: 'veh-hints' });
  ui.addWidget('bottom-right', hints, { modes: ['drive'], order: 10 });

  const last = { speed: -1, alt: -1, bar: -1, boost: -1, flags: '' };
  const show = (node, on) => {
    if (node._on !== on) {
      node._on = on;
      node.hidden = !on;
    }
  };

  return {
    el,
    hints,
    setVehicle(type, name) {
      title.textContent = name;
      el.dataset.type = type;
      show(alt, type !== 'car');
      hints.replaceChildren(
        ...(HINTS[type] || HINTS.car).map(([k, label]) => h('div', { class: 'veh-hint' }, h('span', { class: 'kbd' }, t(k)), h('span', { class: 'veh-hint-text' }, t(label)))),
      );
      last.speed = last.alt = last.bar = last.boost = -1;
      last.flags = '';
    },
    /** s: { speed (m/s), max (m/s), altitude (m|null), boost 0…1, boosting, handbrake, gear, landed, road, launch } */
    update(s) {
      const kmh = Math.round(Math.abs(s.speed) * 3.6);
      if (kmh !== last.speed) {
        last.speed = kmh;
        num.textContent = formatNumber(kmh);
      }
      const b = Math.round(Math.min(1, Math.abs(s.speed) / Math.max(1, s.max)) * 100);
      if (b !== last.bar) {
        last.bar = b;
        barFill.style.width = `${b}%`;
      }
      if (s.altitude != null) {
        const a = Math.max(0, Math.round(s.altitude));
        if (a !== last.alt) {
          last.alt = a;
          altNum.textContent = formatNumber(a);
        }
      }
      const bo = Math.round(s.boost * 100);
      if (bo !== last.boost) {
        last.boost = bo;
        boostFill.style.width = `${bo}%`;
      }
      const flags = `${s.road ? 1 : 0}${s.handbrake ? 1 : 0}${s.gear ? 1 : 0}${s.landed ? 1 : 0}${s.launch ? 1 : 0}${s.boosting ? 1 : 0}`;
      if (flags !== last.flags) {
        last.flags = flags;
        show(tagRoad, !!s.road);
        show(tagHand, !!s.handbrake);
        show(tagGear, !!s.gear && !s.landed);
        show(tagLand, !!s.landed);
        show(tagLaunch, !!s.launch);
        el.classList.toggle('veh-boosting', !!s.boosting);
      }
    },
  };
}
