/**
 * Graphics diagnostics panel ("Grafische diagnose"). Opens with `?gfx` in the
 * URL or the ` key (Backquote), and shows up by itself while switches are
 * stored. Lets the player switch every rendering feature on/off live — post
 * chain, NaN protection, bloom, colour grade, MSAA, shadows, environment
 * light, fog, water reflection, resolution — and hide whole scene objects, to
 * find what breaks the picture on their GPU. Switches persist in localStorage
 * ('o-universe-gfx') and are applied right after the engine is created, so
 * they also hold during boot.
 */

const KEY = 'o-universe-gfx';

export function loadGfx() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function saveGfx(flags) {
  try {
    if (Object.keys(flags).length) localStorage.setItem(KEY, JSON.stringify(flags));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: switches only last for this session */
  }
}

/** Applies stored switches (call again after quality changes / world install). */
export function applyGfx(ctx, flags) {
  const e = ctx.engine;
  if (flags.post !== undefined) e.postEnabled = flags.post;
  if (flags.sanitize !== undefined && e.sanitize) e.sanitize.enabled = flags.sanitize;
  if (flags.bloom !== undefined) e.bloom.enabled = flags.bloom;
  if (flags.grade !== undefined) e.grade.enabled = flags.grade;
  if (flags.msaa !== undefined) e.setMsaa(flags.msaa);
  if (flags.shadows !== undefined) e.setShadows(flags.shadows);
  if (flags.env !== undefined) e.hideEnv = !flags.env;
  if (flags.fog !== undefined) e.hideFog = !flags.fog;
  if (flags.pixelRatio !== undefined) e.setPixelRatio(flags.pixelRatio);
  const refl = ctx.world?.atmosphere?.reflection?.state;
  if (refl && flags.reflection !== undefined) refl.enabled = flags.reflection;
}

const objKey = (o, i) => `${i}:${o.name || o.type}`;

/**
 * Called once by the game right after the engine/loop exist: applies stored
 * switches, keeps them applied across quality changes and opens the panel on
 * `?gfx`, on the ` key, or by itself while switches are stored.
 */
export function installGfx(ctx) {
  const { engine, events, loop, params } = ctx;
  const flags = loadGfx();
  const hidden = new Set(flags.hidden || []);
  applyGfx(ctx, flags);
  const reapply = () => requestAnimationFrame(() => applyGfx(ctx, flags));
  events.on('quality:change', reapply);
  events.on('game:installed', reapply);

  // keep user-hidden scene objects hidden (modules may toggle visibility)
  loop.add(
    'gfx-hidden',
    () => {
      if (!hidden.size) return;
      engine.scene.children.forEach((o, i) => {
        if (hidden.has(objKey(o, i))) o.visible = false;
      });
    },
    { order: 98, pausable: false },
  );

  let panel = null;
  const show = (open) => (panel ||= createPanel(ctx, flags, hidden, { open }));
  if (params.gfx !== undefined || Object.keys(flags).length) show(params.gfx !== undefined);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' && !e.repeat && !panel) show(true);
  });
  return {
    flags,
    open() {
      show(true).open();
    },
  };
}

function createPanel(ctx, flags, hidden, { open = false } = {}) {
  const { engine, loop } = ctx;

  const set = (k, v) => {
    flags[k] = v;
    saveGfx(flags);
    applyGfx(ctx, flags);
    render();
  };

  // ------------------------------------------------------------------ DOM
  const root = document.createElement('div');
  root.className = 'gfx-panel';
  const style = document.createElement('style');
  style.textContent = `
    .gfx-panel{position:fixed;top:12px;right:12px;z-index:100000;width:min(300px,calc(100vw - 24px));
      max-height:calc(100vh - 24px);overflow:auto;padding:12px 14px 14px;border-radius:12px;
      background:rgba(8,10,16,.9);color:#ece6dc;font:13px/1.4 Jost,system-ui,sans-serif;
      box-shadow:0 10px 32px rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.08);user-select:none}
    .gfx-panel.min{width:auto;padding:6px 12px;cursor:pointer}
    .gfx-panel h3{margin:0;font-size:12px;font-weight:500;letter-spacing:.18em;text-transform:uppercase}
    .gfx-panel .hd{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .gfx-panel .x{background:none;border:0;color:#ece6dc;font-size:16px;cursor:pointer;padding:0 2px;opacity:.7}
    .gfx-panel .info{margin:6px 0 4px;font-size:11px;opacity:.65;word-break:break-word}
    .gfx-panel .sec{margin:10px 0 4px;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#7fe0ff;opacity:.9}
    .gfx-panel label{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer}
    .gfx-panel label small{opacity:.55;margin-left:auto;font-size:11px}
    .gfx-panel input{accent-color:#7fe0ff;margin:0}
    .gfx-panel .seg{display:flex;gap:4px;margin:3px 0 4px;flex-wrap:wrap}
    .gfx-panel .seg span{flex:0 0 auto;font-size:12px;opacity:.75;margin-right:4px;align-self:center}
    .gfx-panel .seg button{flex:1;min-width:34px;padding:3px 0;border-radius:7px;border:1px solid rgba(255,255,255,.14);
      background:transparent;color:#ece6dc;font:12px Jost,system-ui,sans-serif;cursor:pointer}
    .gfx-panel .seg button.on{background:#7fe0ff;color:#0a0d13;border-color:#7fe0ff}
    .gfx-panel .row{display:flex;gap:6px;margin-top:10px}
    .gfx-panel .row button{flex:1;padding:6px 0;border-radius:8px;border:1px solid rgba(255,255,255,.18);
      background:#161a22;color:#ece6dc;font:12px Jost,system-ui,sans-serif;cursor:pointer}
    .gfx-panel .tip{margin-top:8px;font-size:11px;opacity:.6}
    .gfx-panel .objs{max-height:200px;overflow:auto;padding-right:4px}
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);

  const gl = engine.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  let minimized = !open;
  let statsEl = null;

  const h = (tag, props = {}, ...kids) => {
    const el = Object.assign(document.createElement(tag), props);
    kids.flat().forEach((k) => k != null && el.append(k));
    return el;
  };
  const check = (label, value, onChange, note) => {
    const input = h('input', { type: 'checkbox', checked: !!value });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', {}, input, label, note ? h('small', { textContent: note }) : null);
  };
  const seg = (label, options, current, onPick) =>
    h(
      'div',
      { className: 'seg' },
      h('span', { textContent: label }),
      options.map(([v, text]) => {
        const b = h('button', { textContent: text, className: v === current ? 'on' : '' });
        b.addEventListener('click', () => onPick(v));
        return b;
      }),
    );

  function render() {
    root.replaceChildren();
    root.classList.toggle('min', minimized);
    if (minimized) {
      root.append(h('h3', { textContent: Object.keys(flags).length ? 'GFX ●' : 'GFX' }));
      return;
    }
    const close = h('button', { className: 'x', textContent: '–', title: 'Inklappen' });
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      minimized = true;
      render();
    });
    const q = engine.quality;
    const comp = engine.composer;
    const refl = ctx.world?.atmosphere?.reflection?.state;
    const pr = engine.renderer.getPixelRatio();
    statsEl = h('div', { className: 'info' });
    const objs = engine.scene.children.map((o, i) => {
      const k = objKey(o, i);
      return check(
        o.name || o.type,
        !hidden.has(k),
        (on) => {
          if (on) hidden.delete(k);
          else hidden.add(k);
          o.visible = on;
          flags.hidden = [...hidden];
          if (!flags.hidden.length) delete flags.hidden;
          saveGfx(flags);
        },
        o.children.length ? `${o.children.length}` : o.type === 'Mesh' ? '' : o.type,
      );
    });
    const reset = h('button', { textContent: 'Alles herstellen' });
    reset.addEventListener('click', () => {
      saveGfx({});
      location.reload();
    });
    const refresh = h('button', { textContent: 'Lijst verversen' });
    refresh.addEventListener('click', render);

    root.append(
      h('div', { className: 'hd' }, h('h3', { textContent: 'Grafische diagnose' }), close),
      h('div', { className: 'info', textContent: `GPU: ${gpu} · kwaliteit ${q.id}` }),
      statsEl,
      h('div', { className: 'sec', textContent: 'Nabewerking' }),
      check('Post-processing (alles hieronder)', engine.postEnabled, (v) => set('post', v)),
      check('NaN-bescherming', engine.sanitize?.enabled, (v) => set('sanitize', v)),
      check('Bloom (gloed)', engine.bloom.enabled, (v) => set('bloom', v)),
      check('Kleurcorrectie', engine.grade.enabled, (v) => set('grade', v)),
      seg('Anti-aliasing', [[0, 'uit'], [2, '2×'], [4, '4×']], comp.renderTarget1.samples, (v) => set('msaa', v)),
      h('div', { className: 'sec', textContent: 'Licht & lucht' }),
      check('Schaduwen', engine.renderer.shadowMap.enabled, (v) => set('shadows', v)),
      check('Omgevingslicht (env map)', !engine.hideEnv, (v) => set('env', v)),
      check('Mist', !engine.hideFog, (v) => set('fog', v)),
      refl ? check('Waterreflectie', refl.enabled, (v) => set('reflection', v)) : null,
      seg('Resolutie', [[0.5, '0.5'], [0.75, '0.75'], [1, '1'], [1.5, '1.5'], [2, '2']], pr, (v) => set('pixelRatio', v)),
      h('div', { className: 'sec', textContent: 'Objecten in beeld' }),
      h('div', { className: 'objs' }, objs),
      h('div', { className: 'row' }, refresh, reset),
      h('div', { className: 'tip', textContent: 'Zet één ding tegelijk uit en kijk of het zwart/flikkeren verdwijnt. Instellingen blijven bewaard; open dit paneel met de `-toets.' }),
    );
    updateStats();
  }

  function updateStats() {
    if (!statsEl || minimized) return;
    const info = engine.renderer.info.render;
    statsEl.textContent = `${Math.round(loop.fps)} fps · ${info.calls} draw calls · ${(info.triangles / 1e6).toFixed(2)} M driehoeken`;
  }
  setInterval(updateStats, 500);

  root.addEventListener('click', () => {
    if (!minimized) return;
    minimized = false;
    render();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote' || e.repeat) return;
    minimized = !minimized;
    render();
  });
  // keep the panel's own clicks/keys away from the game
  for (const t of ['mousedown', 'pointerdown', 'wheel']) root.addEventListener(t, (e) => e.stopPropagation());

  render();
  return { flags, render, open: () => ((minimized = false), render()) };
}
