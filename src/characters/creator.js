/**
 * Character creator screen (characters module) — DOM layer of the 'customize'
 * mode, laid out like generated/17_character_creator.png: Ø UNIVERSE logo +
 * CUSTOMIZE CHARACTER + tabs (Face / Hair / Outfit / Gear / Colors) on the
 * left, a glass panel with rendered variant thumbnails and colour swatches on
 * the right, Randomize + Confirm bottom-right, name field. Text is bilingual
 * (core/i18n.js), resolved when the screen is built.
 * Thumbnails are rendered lazily (one per frame) through ctx.portraits.
 */
import { icon } from '../ui/icons.js';
import { t } from '../core/i18n.js';
import { formatNumber } from '../core/math.js';
import { requestArrays, hasArrays } from './build-client.js';
import {
  SKIN_TONES, OUTFIT_COLORS, HAIR_COLORS, ACCENT_COLORS, EYE_COLORS, HAIR_STYLES, FACES, BEARDS,
  PLAYER_OUTFITS, OUTFIT_MAP, BACKPACKS, EYEWEAR, normalizeAppearance, randomAppearance, outfitUnlocked,
} from './appearance.js';

const TABS = [
  { id: 'face', label: { en: 'Face', nl: 'Gezicht' }, icon: 'chr-face', preset: 'face' },
  { id: 'hair', label: { en: 'Hair', nl: 'Haar' }, icon: 'chr-hair', preset: 'face' },
  { id: 'outfit', label: { en: 'Outfit', nl: 'Outfit' }, icon: 'chr-outfit', preset: 'full' },
  { id: 'gear', label: { en: 'Gear', nl: 'Uitrusting' }, icon: 'chr-gear', preset: 'full' },
  { id: 'colors', label: { en: 'Colors', nl: 'Kleuren' }, icon: 'palette', preset: 'front' },
];

/** Default player name (state.profile.name until the player picks one). */
export const DEFAULT_NAME = { en: 'Traveler', nl: 'Reiziger' };
export const defaultName = () => t(DEFAULT_NAME);
/** True for an untouched default name in any language. */
export const isDefaultName = (n) => !n || n === DEFAULT_NAME.en || n === DEFAULT_NAME.nl || n === 'Traveller';

export function createCreator(ctx, { studio, onConfirm, onCancel }) {
  const { ui } = ctx;
  const h = ui.h.bind(ui);
  let app = null;
  let name = defaultName();
  let tab = 'outfit';
  let root = null;
  let panel = null;
  let queue = [];
  let unlockedFn = () => true;
  let busy = false;

  const priceHint = (o) => {
    const it = ctx.economy?.items?.find?.((i) => i.id === o.unlock);
    const p = it?.price ?? o.price;
    return p ? `Ø ${formatNumber(Number(p))}` : t({ en: 'Locked', nl: 'Vergrendeld' });
  };

  function build() {
    const tabs = TABS.map((tb) =>
      h(
        'button',
        { class: `chr-cc-tab${tb.id === tab ? ' active' : ''}`, dataset: { tab: tb.id }, onclick: () => setTab(tb.id) },
        h('span', { class: 'chr-cc-tab-icon', html: icon(tb.icon, 30) }),
        h('span', { class: 'chr-cc-tab-label', text: t(tb.label) }),
      ),
    );
    const nameInput = h('input', {
      class: 'chr-cc-input',
      type: 'text',
      maxlength: '18',
      spellcheck: 'false',
      value: name,
      'aria-label': t({ en: 'Name', nl: 'Naam' }),
      oninput: (e) => (name = e.target.value),
      onkeydown: (e) => {
        if (e.key === 'Enter') e.target.blur();
        e.stopPropagation();
      },
    });
    panel = h('div', { class: 'chr-cc-panel' });
    root = h(
      'div',
      { class: 'chr-creator' },
      h(
        'div',
        { class: 'chr-cc-left' },
        h(
          'div',
          { class: 'chr-cc-logo' },
          h('span', { class: 'chr-cc-logo-mark', html: icon('emblem', 64) }),
          h('div', { class: 'chr-cc-logo-text' }, h('div', { class: 'chr-cc-word', text: 'UNIVERSE' }), h('div', { class: 'chr-cc-sub', text: 'EXPLORE · CREATE · CONNECT' })),
        ),
        h('div', { class: 'chr-cc-rule' }),
        h('div', { class: 'chr-cc-title', text: t({ en: 'Customize Character', nl: 'Personage aanpassen' }) }),
        h('nav', { class: 'chr-cc-tabs' }, tabs),
        h('label', { class: 'chr-cc-name' }, h('span', { class: 'chr-cc-name-label', text: t({ en: 'Name', nl: 'Naam' }) }), nameInput),
      ),
      panel,
      h(
        'div',
        { class: 'chr-cc-actions' },
        h('button', { class: 'chr-cc-btn', onclick: randomize }, h('span', { html: icon('chr-dice', 24) }), t({ en: 'Randomize', nl: 'Willekeurig' })),
        h('button', { class: 'chr-cc-btn chr-cc-primary', onclick: confirm }, t({ en: 'Confirm', nl: 'Bevestigen' }), h('span', { html: icon('chr-arrow', 22) })),
      ),
      h(
        'div',
        { class: 'chr-cc-hint' },
        h('span', { html: icon('rotate', 16) }),
        t({ en: 'Drag to rotate', nl: 'Sleep om te draaien' }),
        h('span', { class: 'chr-cc-hint-sep' }),
        h('span', { class: 'kbd', text: 'Esc' }),
        t({ en: 'Back', nl: 'Terug' }),
      ),
    );
    renderPanel();
    return root;
  }

  function setTab(id) {
    if (tab === id) return;
    tab = id;
    root?.querySelectorAll('.chr-cc-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    const tb = TABS.find((x) => x.id === id);
    studio.setPreset(tb.preset);
    studio.lookAtCamera(tb.preset === 'face' || tb.preset === 'front');
    framePortrait();
    renderPanel();
    ctx.audio?.play?.('ui.click');
  }

  // Touch devices in portrait: the studio composes the model for the landscape layout (left of
  // the panel), which puts it off the left edge of a tall screen. Shift the projection so it
  // stands centred between the tab bar and the bottom panel (cleared in landscape / on close).
  const PORTRAIT_SHIFT = { full: [-0.41, -0.04], front: [-0.41, -0.04], face: [-0.62, 0.1] };
  function framePortrait() {
    const cam = studio.camera;
    if (!cam?.setViewOffset) return;
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    const preset = TABS.find((x) => x.id === tab)?.preset;
    const shift = root && ctx.device?.touch && H > W * 1.1 ? PORTRAIT_SHIFT[preset] : null;
    if (shift) cam.setViewOffset(W, H, shift[0] * W, shift[1] * H, W, H);
    else if (cam.view?.enabled) cam.clearViewOffset();
  }
  window.addEventListener('resize', () => framePortrait());

  // ------------------------------------------------------------ panel
  /** `title` is bilingual text ({en, nl}). */
  function section(title, ...children) {
    return h('div', { class: 'chr-cc-section' }, h('div', { class: 'chr-cc-sec-title', text: t(title) }), ...children);
  }

  function grid(items, { cols = 3, aspect = 'tall', framing = 'full', view = 'three-quarter' } = {}) {
    const w = aspect === 'tall' ? 132 : 132;
    const ht = aspect === 'tall' ? 176 : 132;
    return h(
      'div',
      { class: `chr-cc-grid cols-${cols} ${aspect}` },
      items.map((it) => {
        const c = h('canvas', { class: 'chr-cc-thumb', width: String(w), height: String(ht) });
        const card = h(
          'button',
          {
            class: `chr-cc-card${it.selected ? ' selected' : ''}${it.locked ? ' locked' : ''}`,
            title: it.label,
            onclick: () => {
              it.apply();
              ctx.audio?.play?.('ui.click');
            },
          },
          c,
          h('span', { class: 'chr-cc-card-label', text: it.label }),
          it.locked ? h('span', { class: 'chr-cc-lock' }, h('span', { html: icon('chr-lock', 14) }), h('span', { text: it.lockText })) : null,
        );
        queue.push({ canvas: c, app: it.preview, framing, view, w, h: ht });
        return card;
      }),
    );
  }

  function chips(options, current, onPick) {
    return h(
      'div',
      { class: 'chr-cc-chips' },
      options.map((o) =>
        h('button', { class: `chr-cc-chip${o.id === current ? ' selected' : ''}`, onclick: () => onPick(o.id) }, t(o.label)),
      ),
    );
  }

  function swatches(colors, current, onPick) {
    return h(
      'div',
      { class: 'chr-cc-swatches' },
      colors.map((c) =>
        h('button', {
          class: `chr-cc-swatch${c.toLowerCase() === String(current).toLowerCase() ? ' selected' : ''}`,
          style: { backgroundColor: c },
          title: c,
          'aria-label': c,
          onclick: () => onPick(c),
        }),
      ),
    );
  }

  const variant = (patch) => normalizeAppearance({ ...app, ...patch });

  function renderPanel() {
    if (!panel || !app) return;
    queue = [];
    const tb = TABS.find((x) => x.id === tab);
    const body = [];
    if (tab === 'face') {
      const bodies = [
        { id: 'm', label: { en: 'Male', nl: 'Man' } },
        { id: 'f', label: { en: 'Female', nl: 'Vrouw' } },
      ];
      body.push(
        section({ en: 'Body', nl: 'Lichaam' }, chips(bodies, app.body, (v) => update({ body: v, beard: v === 'f' ? 'none' : app.beard }))),
        section(
          { en: 'Face', nl: 'Gezicht' },
          grid(
            FACES.map((f) => ({ label: f.label, selected: app.face === f.id, preview: variant({ face: f.id }), apply: () => update({ face: f.id }) })),
            { aspect: 'square', framing: 'face', view: 'three-quarter' },
          ),
        ),
        app.body === 'm' ? section({ en: 'Beard', nl: 'Baard' }, chips(BEARDS, app.beard, (v) => update({ beard: v }))) : null,
        section({ en: 'Skin Tone', nl: 'Huidskleur' }, swatches(SKIN_TONES, app.skin, (c) => update({ skin: c }))),
      );
    } else if (tab === 'hair') {
      body.push(
        section(
          { en: 'Hairstyle', nl: 'Kapsel' },
          grid(
            HAIR_STYLES.map((s) => ({ label: s.label, selected: app.hair === s.id, preview: variant({ hair: s.id }), apply: () => update({ hair: s.id }) })),
            { aspect: 'square', framing: 'face', view: 'three-quarter' },
          ),
        ),
        section({ en: 'Hair Color', nl: 'Haarkleur' }, swatches(HAIR_COLORS, app.hairColor, (c) => update({ hairColor: c }))),
      );
    } else if (tab === 'outfit') {
      const owned = ownedItems();
      body.push(
        section(
          { en: 'Outfit', nl: 'Outfit' },
          grid(
            PLAYER_OUTFITS.map((o) => {
              const locked = !outfitUnlocked(o.id, owned);
              return {
                label: o.label,
                selected: app.outfit === o.id,
                locked,
                lockText: locked ? priceHint(o) : '',
                preview: variant({ outfit: o.id, outfitColor: o.color, accentColor: o.accent }),
                apply: () => update({ outfit: o.id, outfitColor: o.color, accentColor: o.accent }),
              };
            }),
            { aspect: 'tall', framing: 'full', view: 'back' },
          ),
        ),
        section({ en: 'Colors', nl: 'Kleuren' }, swatches(OUTFIT_COLORS, app.outfitColor, (c) => update({ outfitColor: c }))),
      );
    } else if (tab === 'gear') {
      body.push(
        section(
          { en: 'Backpack', nl: 'Rugzak' },
          grid(
            BACKPACKS.map((b) => ({ label: b.label, selected: app.backpack === b.id, preview: variant({ backpack: b.id }), apply: () => update({ backpack: b.id }) })),
            { aspect: 'tall', framing: 'full', view: 'back' },
          ),
        ),
        section(
          { en: 'Glasses & Visor', nl: 'Bril & vizier' },
          grid(
            EYEWEAR.map((e) => ({ label: e.label, selected: app.eyewear === e.id, preview: variant({ eyewear: e.id }), apply: () => update({ eyewear: e.id }) })),
            { cols: 4, aspect: 'square', framing: 'face', view: 'three-quarter' },
          ),
        ),
        section(
          { en: 'Details', nl: 'Details' },
          h(
            'div',
            { class: 'chr-cc-toggles' },
            toggle({ en: 'Gloves', nl: 'Handschoenen' }, app.gloves, (v) => update({ gloves: v })),
            toggle({ en: 'Ø Shoulder Patch', nl: 'Ø-schouderpatch' }, app.patch, (v) => update({ patch: v })),
          ),
        ),
      );
    } else {
      body.push(
        section({ en: 'Outfit', nl: 'Outfit' }, swatches(OUTFIT_COLORS, app.outfitColor, (c) => update({ outfitColor: c }))),
        section({ en: 'Accent', nl: 'Accent' }, swatches(ACCENT_COLORS, app.accentColor, (c) => update({ accentColor: c }))),
        section({ en: 'Hair', nl: 'Haar' }, swatches(HAIR_COLORS, app.hairColor, (c) => update({ hairColor: c }))),
        section({ en: 'Skin', nl: 'Huid' }, swatches(SKIN_TONES, app.skin, (c) => update({ skin: c }))),
        section({ en: 'Eyes', nl: 'Ogen' }, swatches(EYE_COLORS, app.eyeColor, (c) => update({ eyeColor: c }))),
      );
    }
    panel.replaceChildren(h('div', { class: 'chr-cc-panel-title', text: t(tb.label) }), h('div', { class: 'chr-cc-panel-body scroll' }, body));
  }

  function toggle(label, value, onChange) {
    return h(
      'button',
      { class: `chr-cc-toggle${value ? ' on' : ''}`, onclick: () => onChange(!value) },
      h('span', { class: 'chr-cc-toggle-label', text: t(label) }),
      h('span', { class: 'chr-cc-switch' }, h('i')),
    );
  }

  function ownedItems() {
    return ctx.state.get('owned.items') || [];
  }

  function update(patch) {
    app = normalizeAppearance({ ...app, ...patch });
    studio.setAppearanceAsync(app);
    renderPanel();
  }

  function randomize() {
    const owned = ownedItems();
    const outfits = PLAYER_OUTFITS.filter((o) => outfitUnlocked(o.id, owned)).map((o) => o.id);
    const r = randomAppearance({ outfits });
    if (Math.random() < 0.6) {
      const od = OUTFIT_MAP[r.outfit];
      r.outfitColor = od.color;
      r.accentColor = od.accent;
    }
    app = normalizeAppearance(r);
    studio.setAppearanceAsync(app);
    renderPanel();
    ctx.audio?.play?.('ui.click');
  }

  function confirm() {
    if (busy) return;
    if (!outfitUnlocked(app.outfit, ownedItems())) {
      const o = OUTFIT_MAP[app.outfit];
      ui.toast({
        title: t({ en: 'Outfit Locked', nl: 'Outfit vergrendeld' }),
        text: t({ en: 'Get {outfit} at the Marketplace ({price}).', nl: '{outfit} koop je in de marktplaats ({price}).' }, { outfit: o.label, price: priceHint(o) }),
        icon: 'chr-lock',
        kind: 'warn',
      });
      ctx.audio?.play?.('ui.error');
      if (tab !== 'outfit') setTab('outfit');
      return;
    }
    busy = true;
    onConfirm({ appearance: app, name: (name || '').trim() || defaultName() });
  }

  /** Renders one queued thumbnail per frame; meshes are built in the worker first. */
  function pump() {
    // drop thumbnails of panels that are gone
    while (queue.length && !queue[0].canvas.isConnected) queue.shift();
    if (!queue.length) return;
    // start worker builds for the next few, render the first one that is ready
    for (let i = 0; i < Math.min(3, queue.length); i++) {
      const q = queue[i];
      if (q.requested) continue;
      q.requested = true;
      if (hasArrays(q.app, 0)) q.ready = true;
      else requestArrays(q.app, 0).then(() => (q.ready = true));
    }
    const idx = queue.findIndex((q, i) => i < 3 && q.ready);
    if (idx < 0) return;
    const job = queue.splice(idx, 1)[0];
    const fast = true;
    const src = ctx.portraits.render(job.app, { width: job.w, height: job.h, framing: job.framing, view: job.view, fast });
    const g = job.canvas.getContext('2d');
    g.clearRect(0, 0, job.w, job.h);
    g.drawImage(src, 0, 0, job.w, job.h);
    job.canvas.classList.add('ready');
  }

  return {
    open(initial, initialName, opts = {}) {
      app = normalizeAppearance(initial);
      name = initialName || defaultName();
      tab = opts.tab || 'outfit';
      busy = false;
      unlockedFn = opts.unlocked || unlockedFn;
      studio.setAppearance(app);
      const tb = TABS.find((x) => x.id === tab);
      studio.setPreset(tb.preset, { snap: true });
      studio.lookAtCamera(tb.preset === 'face' || tb.preset === 'front');
      ui.showScreen('customize', build());
      framePortrait();
    },
    close() {
      ui.hideScreen('customize');
      root = null;
      panel = null;
      queue = [];
      framePortrait();
    },
    cancel() {
      onCancel?.();
    },
    pump,
    get appearance() {
      return app;
    },
    get name() {
      return name;
    },
    setTab,
  };
}
