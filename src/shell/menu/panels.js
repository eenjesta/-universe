/**
 * Content panels shared by the pause menu, the title settings and the help
 * overlay: Settings (live settings controls, incl. the language), Controls
 * (controls with key caps), About Ø Universe (core gameplay elements +
 * pillars). All text is resolved with t() when a panel is built.
 */
import { icon } from '../../ui/icons.js';
import { t } from '../../core/i18n.js';
import { CONTROLS, KERN, PILLARS, TAGLINE, VERSION, MOTTO } from '../data.js';
import { QUALITY_OPTIONS, FOV_RANGE, HUD_SCALE_RANGE } from '../settings.js';
import { logoMarkSVG, renderKeys, uiSound } from '../util.js';

// ---------------------------------------------------------------- settings
/**
 * Builds the settings panel. Returns { el, refresh, dispose }.
 * `settings` is the shell settings API (get/set/onChange).
 */
export function settingsPanel(ctx, settings) {
  const h = ctx.ui.h;
  const i18n = ctx.i18n;
  const refreshers = [];

  const group = (title, iconName, ...rows) =>
    h('section', { class: 'shell-set-group' }, h('h3', { class: 'shell-set-title' }, h('span', { html: icon(iconName, 16) }), t(title)), rows);

  const row = (label, sub, control) =>
    h('div', { class: 'shell-set-row' }, h('div', { class: 'shell-set-label' }, h('span', { text: t(label) }), sub ? h('small', { text: t(sub) }) : null), control);

  const toggle = (key, label, sub) => {
    const btn = h('button', {
      class: 'shell-toggle',
      type: 'button',
      role: 'switch',
      'aria-label': t(label),
      onclick: () => {
        settings.set(key, !settings.get(key));
        uiSound(ctx, 'ui.click');
      },
    });
    btn.appendChild(h('span', { class: 'shell-toggle-knob' }));
    refreshers.push(() => btn.setAttribute('aria-checked', settings.get(key) ? 'true' : 'false'));
    return row(label, sub, btn);
  };

  const slider = (key, label, { min = 0, max = 1, step = 0.01, fmt }) => {
    const out = h('span', { class: 'shell-range-value num' });
    const input = h('input', { class: 'shell-range', type: 'range', min, max, step, 'aria-label': t(label) });
    const paint = () => {
      const v = Number(input.value);
      input.style.setProperty('--v', String((v - min) / (max - min)));
      out.textContent = fmt(v);
    };
    input.addEventListener('input', () => {
      paint();
      settings.set(key, Number(input.value));
    });
    input.addEventListener('change', () => uiSound(ctx, 'ui.click'));
    refreshers.push(() => {
      if (document.activeElement !== input) input.value = settings.get(key);
      paint();
    });
    return row(label, null, h('div', { class: 'shell-range-wrap' }, input, out));
  };

  /** Segmented choice bound to a setting: options [{ id, label: { en, nl } }]. */
  const segment = (key, label, sub, options) => {
    const el = h(
      'div',
      { class: 'shell-seg', role: 'radiogroup', 'aria-label': t(label) },
      options.map((o) =>
        h('button', {
          class: 'shell-seg-btn',
          type: 'button',
          role: 'radio',
          dataset: { v: o.id },
          text: t(o.label),
          onclick: () => {
            uiSound(ctx, 'ui.click');
            settings.set(key, o.id);
          },
        }),
      ),
    );
    refreshers.push(() => {
      const cur = settings.get(key);
      for (const b of el.children) b.setAttribute('aria-checked', b.dataset.v === cur ? 'true' : 'false');
    });
    return row(label, sub, el);
  };

  const pct = (v) => `${Math.round(v * 100)}%`;
  const deg = (v) => `${Math.round(v)}°`;
  const factor = (v) => `×${v.toLocaleString(i18n.locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const seg = h(
    'div',
    { class: 'shell-seg', role: 'radiogroup', 'aria-label': t({ en: 'Graphics quality', nl: 'Grafische kwaliteit' }) },
    QUALITY_OPTIONS.map((q) =>
      h('button', {
        class: 'shell-seg-btn',
        type: 'button',
        role: 'radio',
        dataset: { q: q.id },
        text: t(q.label),
        onclick: () => {
          uiSound(ctx, 'ui.click');
          settings.set('quality', q.id);
        },
      }),
    ),
  );
  refreshers.push(() => {
    const cur = ctx.engine.quality?.id || settings.get('quality');
    for (const b of seg.children) b.setAttribute('aria-checked', b.dataset.q === cur ? 'true' : 'false');
  });

  // Language: labelled in both languages so it can be found from either one.
  // Choosing another language saves it and reloads the game in that language.
  const current = i18n.lang();
  const langSeg = h(
    'div',
    { class: 'shell-seg shell-lang', role: 'radiogroup', 'aria-label': t({ en: 'Language / Taal', nl: 'Taal / Language' }) },
    i18n.LANGUAGES.map((l) =>
      h('button', {
        class: 'shell-seg-btn',
        type: 'button',
        role: 'radio',
        lang: l.id,
        dataset: { lang: l.id },
        'aria-checked': l.id === current ? 'true' : 'false',
        text: l.label, // endonyms: "English" / "Nederlands" in every language
        onclick: (e) => {
          if (l.id === i18n.lang()) return;
          uiSound(ctx, 'ui.click');
          for (const b of langSeg.children) b.setAttribute('aria-checked', b === e.currentTarget ? 'true' : 'false');
          i18n.setLanguage(l.id, ctx.state);
        },
      }),
    ),
  );

  const el = h(
    'div',
    { class: 'shell-settings' },
    group(
      { en: 'Language / Taal', nl: 'Taal / Language' },
      'globe',
      row({ en: 'Game language', nl: 'Speltaal' }, { en: 'Switching reloads the game', nl: 'Wisselen laadt het spel opnieuw' }, langSeg),
    ),
    group(
      { en: 'Graphics', nl: 'Beeld' },
      'camera',
      row({ en: 'Graphics quality', nl: 'Grafische kwaliteit' }, { en: 'Low is faster, High looks better', nl: 'Laag is sneller, Hoog is mooier' }, seg),
      toggle('showFps', { en: 'Show FPS', nl: 'FPS tonen' }, { en: 'Frames per second in the top-right corner', nl: 'Beelden per seconde rechtsboven' }),
    ),
    group(
      { en: 'Camera', nl: 'Camera' },
      'shell-eye',
      segment('camera', { en: 'View', nl: 'Weergave' }, ctx.device?.touch ? null : { en: 'V switches in the game', nl: 'V wisselt in het spel' }, [
        { id: 'third', label: { en: 'Third person', nl: 'Derde persoon' } },
        { id: 'first', label: { en: 'First person', nl: 'Eerste persoon' } },
      ]),
      slider('fov', { en: 'Field of view', nl: 'Kijkhoek' }, { min: FOV_RANGE.min, max: FOV_RANGE.max, step: FOV_RANGE.step, fmt: deg }),
      toggle('headBob', { en: 'Head bob', nl: 'Hoofdbeweging' }, { en: 'The view sways gently while walking in first person', nl: 'Het beeld wiegt zacht mee tijdens het lopen in eerste persoon' }),
    ),
    group(
      { en: 'Interface', nl: 'Interface' },
      'shell-layers',
      slider('hudScale', { en: 'HUD size', nl: 'HUD-grootte' }, { min: HUD_SCALE_RANGE.min, max: HUD_SCALE_RANGE.max, step: HUD_SCALE_RANGE.step, fmt: pct }),
      toggle('minimapRotate', { en: 'Rotating minimap', nl: 'Draaiende minikaart' }, { en: 'Off: north is always up', nl: 'Uit: het noorden is altijd boven' }),
      ctx.device?.touch ? null : toggle('keyHints', { en: 'Key hints', nl: 'Toetstips' }, { en: 'Shortcuts for what you are doing, bottom right', nl: 'Sneltoetsen voor wat je doet, rechtsonder' }),
    ),
    group(
      { en: 'Sound', nl: 'Geluid' },
      'sound',
      slider('volume', { en: 'Master volume', nl: 'Hoofdvolume' }, { fmt: pct }),
      slider('music', { en: 'Music', nl: 'Muziek' }, { fmt: pct }),
      slider('sfx', { en: 'Effects', nl: 'Effecten' }, { fmt: pct }),
    ),
    group(
      { en: 'Controls', nl: 'Besturing' },
      'mouse',
      slider('sensitivity', ctx.device?.touch ? { en: 'Look sensitivity', nl: 'Kijkgevoeligheid' } : { en: 'Mouse sensitivity', nl: 'Muisgevoeligheid' }, { min: 0.2, max: 3, step: 0.05, fmt: factor }),
      toggle(
        'invertY',
        { en: 'Invert Y axis', nl: 'Y-as omkeren' },
        ctx.device?.touch ? { en: 'Dragging up looks down', nl: 'Omhoog slepen kijkt omlaag' } : { en: 'Moving the mouse up looks down', nl: 'Muis omhoog kijkt omlaag' },
      ),
      ctx.device?.touch ? slider('aimAssist', { en: 'Aim assist', nl: 'Richthulp' }, { min: 0, max: 1, step: 0.05, fmt: (v) => (v <= 0.001 ? t({ en: 'Off', nl: 'Uit' }) : pct(v)) }) : null,
    ),
    group(
      { en: 'Game', nl: 'Spel' },
      'sparkle',
      toggle('timeFlow', { en: 'Time flow', nl: 'Tijd laten verlopen' }, { en: 'Day and night take turns', nl: 'Dag en nacht wisselen elkaar af' }),
      toggle('creative', { en: 'Creative mode', nl: 'Creatieve modus' }, { en: 'Unlimited building without resources', nl: 'Onbeperkt bouwen zonder grondstoffen' }),
    ),
  );

  const refresh = () => refreshers.forEach((fn) => fn());
  refresh();
  const off = settings.onChange(refresh);
  return { el, refresh, dispose: off };
}

// ---------------------------------------------------------------- controls
/** Touch devices: the on-screen controls (src/core/touch.js), shown first in the controls reference. */
const TOUCH_ROWS = [
  { icon: 'touch-stick', t: { en: 'Move', nl: 'Lopen' }, d: { en: 'Put your thumb down anywhere on the left: a joystick appears', nl: 'Zet je duim ergens links neer: er verschijnt een joystick' } },
  { icon: 'touch-sprint', t: { en: 'Sprint', nl: 'Sprinten' }, d: { en: 'Push the joystick all the way to its edge', nl: 'Duw de joystick helemaal tot de rand' } },
  { icon: 'touch-drag', t: { en: 'Look around', nl: 'Rondkijken' }, d: { en: 'Drag anywhere on the rest of the screen', nl: 'Sleep ergens over de rest van het scherm' } },
  { icon: 'touch-pinch', t: { en: 'Zoom', nl: 'Zoomen' }, d: { en: 'Pinch with two fingers', nl: 'Knijp met twee vingers' } },
  { icon: 'touch-jump', t: { en: 'Jump', nl: 'Springen' } },
  { icon: 'hand', t: { en: 'Interact', nl: 'Interactie' }, d: { en: 'Tap the action button or the prompt; hold it to scan or harvest', nl: 'Tik op de actieknop of de melding; houd vast om te scannen of te oogsten' } },
  { icon: 'swords', t: { en: 'Fight (wilderness)', nl: 'Vechten (wildernis)' }, d: { en: 'Fire, Aim, Reload, Switch, Grenade (hold to aim) and Dodge appear on the right; aim assist: Settings → Controls', nl: 'Vuren, Richten, Herladen, Wissel, Granaat (vasthouden om te richten) en Ontwijken verschijnen rechts; richthulp: Instellingen → Besturing' } },
  { icon: 'shell-axe', t: { en: 'Gather', nl: 'Verzamelen' }, d: { en: 'Look at a tree, rock or plant and hold the action button', nl: 'Kijk naar een boom, rots of plant en houd de actieknop vast' } },
  { icon: 'shell-bag', t: { en: 'Inventory & supplies', nl: 'Inventaris & voorraad' }, d: { en: 'Menu → Inventory; tap food, a medkit or a shield cell in the quick bar', nl: 'Menu → Inventaris; tik op eten, een medkit of een schildcel in de snelbalk' } },
  { icon: 'shell-bed', t: { en: 'Campfire · chest · bed · door', nl: 'Kampvuur · kist · bed · deur' }, d: { en: 'Walk up and tap the action button: cook, store, sleep (sets your respawn), open', nl: 'Loop erheen en tik op de actieknop: koken, opbergen, slapen (je respawnplek), openen' } },
  { icon: 'shell-eye', t: { en: 'First / third person', nl: 'Eerste / derde persoon' }, d: { en: 'Tap View (eye button); field of view and head bob: Settings → Camera', nl: 'Tik op Beeld (oogknop); kijkhoek en hoofdbeweging: Instellingen → Camera' } },
  { icon: 'map', t: { en: 'Map & travel', nl: 'Kaart & reizen' }, d: { en: 'Menu → Map: Gateway in the hub, Return to hub outside it, tap the ground for a waypoint', nl: 'Menu → Kaart: Poort in de hub, terug naar de hub daarbuiten, tik op de grond voor een markering' } },
  { icon: 'touch-menu', t: { en: 'Menu', nl: 'Menu' }, d: { en: 'Missions, map, inventory, character, marketplace, building, vehicles, help and pause', nl: 'Missies, kaart, inventaris, karakter, marktplaats, bouwen, voertuigen, help en pauze' } },
  { icon: 'chat', t: { en: 'Chat', nl: 'Chat' }, d: { en: 'Top right, next to the menu', nl: 'Rechtsboven, naast het menu' } },
];

/** Controls reference; groups relevant to `mode` come first and are marked. */
export function controlsPanel(ctx, { mode = null, compact = false, first = null } = {}) {
  const h = ctx.ui.h;
  const groups = [...CONTROLS];
  const rank = (g) => (first?.includes(g.id) ? 10 - first.indexOf(g.id) : 0) + (mode && g.modes.includes(mode) ? 1 : 0);
  if (mode || first) groups.sort((a, b) => rank(b) - rank(a));
  const touch = ctx.device?.touch
    ? h(
        'section',
        { class: 'shell-ctrl-group is-current shell-ctrl-touch', dataset: { group: 'touch' } },
        h('h3', { class: 'shell-ctrl-title' }, h('span', { html: icon('hand', 16) }), t({ en: 'Touch screen', nl: 'Touchscreen' })),
        h(
          'div',
          { class: 'shell-ctrl-rows' },
          TOUCH_ROWS.map((r) =>
            h(
              'div',
              { class: 'shell-ctrl-row' },
              h('span', { class: 'shell-touch-glyph', html: icon(r.icon, 18) }),
              h('div', { class: 'shell-ctrl-label' }, h('span', { text: t(r.t) }), r.d ? h('small', { text: t(r.d) }) : null),
            ),
          ),
        ),
      )
    : null;
  return h(
    'div',
    { class: `shell-controls${compact ? ' is-compact' : ''}` },
    touch,
    groups.map((gr) =>
      h(
        'section',
        { class: `shell-ctrl-group${mode && gr.modes.includes(mode) ? ' is-current' : ''}`, dataset: { group: gr.id } },
        h('h3', { class: 'shell-ctrl-title' }, h('span', { html: icon(gr.icon, 16) }), t(gr.title)),
        gr.note ? h('p', { class: 'shell-ctrl-note', text: t(gr.note) }) : null,
        h(
          'div',
          { class: 'shell-ctrl-rows' },
          gr.rows.map((r) =>
            h(
              'div',
              { class: 'shell-ctrl-row' },
              renderKeys(h, r.k),
              h('div', { class: 'shell-ctrl-label' }, h('span', { text: t(r.t) }), r.d ? h('small', { text: t(r.d) }) : null),
            ),
          ),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------------- about
export function aboutPanel(ctx) {
  const h = ctx.ui.h;
  return h(
    'div',
    { class: 'shell-about' },
    h(
      'div',
      { class: 'shell-about-hero' },
      h('div', { class: 'shell-about-logo' }, h('span', { html: logoMarkSVG({ size: 54, stroke: 4.6 }) }), h('span', { class: 'shell-about-word', text: 'UNIVERSE' })),
      h('div', { class: 'shell-about-motto', text: MOTTO }),
      h('p', { class: 'shell-about-tagline', text: t(TAGLINE) }),
    ),
    h('h3', { class: 'shell-about-h', text: t({ en: 'Core gameplay elements', nl: 'Kern gameplay elementen' }) }),
    h(
      'div',
      { class: 'shell-kern' },
      KERN.map((k) =>
        h(
          'div',
          { class: 'shell-kern-item' },
          h('span', { class: 'shell-kern-icon', html: icon(k.icon, 30) }),
          h('div', null, h('div', { class: 'shell-kern-title', text: t(k.title) }), h('div', { class: 'shell-kern-text', text: t(k.text) })),
        ),
      ),
    ),
    h('h3', { class: 'shell-about-h', text: t({ en: 'Our pillars', nl: 'Onze pijlers' }) }),
    h(
      'div',
      { class: 'shell-about-pillars' },
      PILLARS.map((p) =>
        h(
          'div',
          { class: 'shell-about-pillar' },
          h('span', { class: 'shell-about-pillar-icon', html: icon(p.icon, 28) }),
          h('div', { class: 'shell-about-pillar-title', text: t(p.title) }),
          h('div', { class: 'shell-about-pillar-text', text: t(p.text) }),
        ),
      ),
    ),
    h('div', { class: 'shell-about-version', text: VERSION }),
  );
}
