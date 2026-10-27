/**
 * Content panels shared by the pause menu, the title settings and the help
 * overlay: Instellingen (live settings controls), Besturing (controls with
 * key caps), Over Ø Universe (kern gameplay elementen + pillars).
 */
import { icon } from '../../ui/icons.js';
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
  const refreshers = [];

  const group = (title, iconName, ...rows) =>
    h('section', { class: 'shell-set-group' }, h('h3', { class: 'shell-set-title' }, h('span', { html: icon(iconName, 16) }), title), rows);

  const row = (label, sub, control) =>
    h('div', { class: 'shell-set-row' }, h('div', { class: 'shell-set-label' }, h('span', { text: label }), sub ? h('small', { text: sub }) : null), control);

  const toggle = (key, label, sub) => {
    const btn = h('button', {
      class: 'shell-toggle',
      type: 'button',
      role: 'switch',
      'aria-label': label,
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
    const input = h('input', { class: 'shell-range', type: 'range', min, max, step, 'aria-label': label });
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
  const seg = h(
    'div',
    { class: 'shell-seg', role: 'radiogroup', 'aria-label': 'Grafische kwaliteit' },
    QUALITY_OPTIONS.map((q) =>
      h('button', {
        class: 'shell-seg-btn',
        type: 'button',
        role: 'radio',
        dataset: { q: q.id },
        text: q.label,
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

  const el = h(
    'div',
    { class: 'shell-settings' },
    group('Beeld', 'camera', row('Grafische kwaliteit', 'Laag is sneller, Hoog is mooier', seg), toggle('showFps', 'FPS tonen', 'Beelden per seconde rechtsboven')),
    group(
      'Geluid',
      'sound',
      slider('volume', 'Hoofdvolume', { fmt: pct }),
      slider('music', 'Muziek', { fmt: pct }),
      slider('sfx', 'Effecten', { fmt: pct }),
    ),
    group(
      'Besturing',
      'mouse',
      slider('sensitivity', 'Muisgevoeligheid', { min: 0.2, max: 3, step: 0.05, fmt: (v) => `×${v.toFixed(2).replace('.', ',')}` }),
      toggle('invertY', 'Y-as omkeren', 'Muis omhoog kijkt omlaag'),
    ),
    group(
      'Spel',
      'sparkle',
      toggle('timeFlow', 'Tijd laten verlopen', 'Dag en nacht wisselen elkaar af'),
      toggle('creative', 'Creatieve modus', 'Onbeperkt bouwen zonder grondstoffen'),
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
        h('h3', { class: 'shell-ctrl-title' }, h('span', { html: icon(gr.icon, 16) }), gr.title),
        h(
          'div',
          { class: 'shell-ctrl-rows' },
          gr.rows.map((r) =>
            h(
              'div',
              { class: 'shell-ctrl-row' },
              renderKeys(h, r.k),
              h('div', { class: 'shell-ctrl-label' }, h('span', { text: r.t }), r.d ? h('small', { text: r.d }) : null),
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
      h('p', { class: 'shell-about-tagline', text: TAGLINE }),
    ),
    h('h3', { class: 'shell-about-h', text: 'Kern gameplay elementen' }),
    h(
      'div',
      { class: 'shell-kern' },
      KERN.map((k) =>
        h(
          'div',
          { class: 'shell-kern-item' },
          h('span', { class: 'shell-kern-icon', html: icon(k.icon, 30) }),
          h('div', null, h('div', { class: 'shell-kern-title', text: k.title }), h('div', { class: 'shell-kern-text', text: k.text })),
        ),
      ),
    ),
    h('h3', { class: 'shell-about-h', text: 'Onze pijlers' }),
    h(
      'div',
      { class: 'shell-about-pillars' },
      PILLARS.map((p) =>
        h(
          'div',
          { class: 'shell-about-pillar' },
          h('span', { class: 'shell-about-pillar-icon', html: icon(p.icon, 28) }),
          h('div', { class: 'shell-about-pillar-title', text: p.title }),
          h('div', { class: 'shell-about-pillar-text', text: p.text }),
        ),
      ),
    ),
    h('div', { class: 'shell-about-version', text: VERSION }),
  );
}
