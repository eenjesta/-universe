/**
 * Content panels shared by the pause menu, the title settings and the help
 * overlay: Settings (live settings controls, incl. the language), Controls
 * (controls with key caps), About Ø Universe (core gameplay elements +
 * pillars). All text is resolved with t() when a panel is built.
 */
import { icon } from '../../ui/icons.js';
import { t } from '../../core/i18n.js';
import { CONTROLS, KERN, PILLARS, TAGLINE, VERSION, MOTTO } from '../data.js';
import { QUALITY_OPTIONS } from '../settings.js';
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

  const pct = (v) => `${Math.round(v * 100)}%`;
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
      { en: 'Sound', nl: 'Geluid' },
      'sound',
      slider('volume', { en: 'Master volume', nl: 'Hoofdvolume' }, { fmt: pct }),
      slider('music', { en: 'Music', nl: 'Muziek' }, { fmt: pct }),
      slider('sfx', { en: 'Effects', nl: 'Effecten' }, { fmt: pct }),
    ),
    group(
      { en: 'Controls', nl: 'Besturing' },
      'mouse',
      slider('sensitivity', { en: 'Mouse sensitivity', nl: 'Muisgevoeligheid' }, { min: 0.2, max: 3, step: 0.05, fmt: factor }),
      toggle('invertY', { en: 'Invert Y axis', nl: 'Y-as omkeren' }, { en: 'Moving the mouse up looks down', nl: 'Muis omhoog kijkt omlaag' }),
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
/** Controls reference; groups relevant to `mode` come first and are marked. */
export function controlsPanel(ctx, { mode = null, compact = false } = {}) {
  const h = ctx.ui.h;
  const groups = [...CONTROLS];
  if (mode) groups.sort((a, b) => Number(b.modes.includes(mode)) - Number(a.modes.includes(mode)));
  return h(
    'div',
    { class: `shell-controls${compact ? ' is-compact' : ''}` },
    groups.map((gr) =>
      h(
        'section',
        { class: `shell-ctrl-group${mode && gr.modes.includes(mode) ? ' is-current' : ''}`, dataset: { group: gr.id } },
        h('h3', { class: 'shell-ctrl-title' }, h('span', { html: icon(gr.icon, 16) }), t(gr.title)),
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
