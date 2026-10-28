/**
 * Ø Studio editor UI: top bar, part library (click or drag into the world), explorer tree
 * (virtualised rows, groups, inline rename) and the properties inspector.
 *
 *   const panels = createPanels(ctx, ed, { dialogs });  panels.show() / panels.hide()
 * Everything re-renders from editor events (selection, structure, parts, history, status, tool, settings).
 */
import { t } from '../core/i18n.js';
import { icon } from '../ui/icons.js';
import { PALETTE, MATERIALS } from './format.js';
import { MODELS } from './templates.js';

export const PART_TILES = [
  { type: 'block', icon: 'studio-block', name: { en: 'Block', nl: 'Blok' } },
  { type: 'wedge', icon: 'studio-wedge', name: { en: 'Wedge', nl: 'Wig' } },
  { type: 'cylinder', icon: 'studio-cylinder', name: { en: 'Cylinder', nl: 'Cilinder' } },
  { type: 'sphere', icon: 'studio-sphere', name: { en: 'Sphere', nl: 'Bol' } },
  { type: 'cone', icon: 'studio-cone', name: { en: 'Cone', nl: 'Kegel' } },
  { type: 'spawn', icon: 'studio-spawn', name: { en: 'Spawn', nl: 'Startpunt' } },
  { type: 'light', icon: 'studio-light', name: { en: 'Light', nl: 'Lamp' } },
  { type: 'text', icon: 'studio-sign', name: { en: 'Sign', nl: 'Bord' } },
];
const TYPE_ICON = Object.fromEntries(PART_TILES.map((p) => [p.type, p.icon]));
const TYPE_NAME = Object.fromEntries(PART_TILES.map((p) => [p.type, p.name]));
export const MATERIAL_NAMES = {
  plastic: { en: 'Plastic', nl: 'Plastic' },
  metal: { en: 'Metal', nl: 'Metaal' },
  glass: { en: 'Glass', nl: 'Glas' },
  neon: { en: 'Neon', nl: 'Neon' },
  wood: { en: 'Wood', nl: 'Hout' },
  concrete: { en: 'Concrete', nl: 'Beton' },
  grass: { en: 'Grass', nl: 'Gras' },
  ice: { en: 'Ice', nl: 'IJs' },
};
export const MATERIAL_DOT = {
  plastic: 'linear-gradient(135deg,#f4f1ea,#a9a49b)',
  metal: 'linear-gradient(135deg,#e8edf2,#5d6066 60%,#c9ced6)',
  glass: 'linear-gradient(135deg,rgba(200,235,255,.9),rgba(120,180,220,.25))',
  neon: 'radial-gradient(circle,#ffffff 0 25%,#7fe0ff 60%)',
  wood: 'repeating-linear-gradient(90deg,#b88a5c 0 3px,#8a6340 3px 5px)',
  concrete: 'radial-gradient(circle at 30% 30%,#d9d2c4,#8e8a84)',
  grass: 'radial-gradient(circle at 40% 30%,#8fe3a8,#3f6a2a)',
  ice: 'linear-gradient(135deg,#ffffff,#9fdcff)',
};
const BEHAVIORS = [
  { id: 'none', name: { en: 'None', nl: 'Geen' } },
  { id: 'kill', name: { en: 'Deadly', nl: 'Dodelijk' }, cls: 'is-red' },
  { id: 'bounce', name: { en: 'Jump pad', nl: 'Springkussen' }, cls: 'is-green' },
  { id: 'finish', name: { en: 'Finish', nl: 'Finish' }, cls: 'is-gold' },
];
const T = {
  parts: { en: 'Parts', nl: 'Onderdelen' },
  models: { en: 'Models', nl: 'Modellen' },
  explorer: { en: 'Explorer', nl: 'Verkenner' },
  properties: { en: 'Properties', nl: 'Eigenschappen' },
  nParts: { en: '{n} parts', nl: '{n} onderdelen' },
  nSel: { en: '{n} selected', nl: '{n} geselecteerd' },
  workspace: { en: 'Workspace', nl: 'Werkruimte' },
  emptyTree: { en: 'Nothing here yet. Add parts from the library on the left.', nl: 'Nog niets hier. Voeg onderdelen toe vanuit de bibliotheek links.' },
  emptyProps: { en: 'Select a part to edit it — click it in the world or in the explorer. Drag on empty space to select several.', nl: 'Selecteer een onderdeel om het te bewerken — klik erop in de wereld of in de verkenner. Sleep over lege ruimte om er meerdere te kiezen.' },
  insertHint: { en: '<b>Click</b> to add in view · <b>drag</b> into the world to place it there.', nl: '<b>Klik</b> om toe te voegen in beeld · <b>sleep</b> het de wereld in om het daar te plaatsen.' },
  select: { en: 'Select', nl: 'Selecteren' },
  move: { en: 'Move', nl: 'Verplaatsen' },
  rotate: { en: 'Rotate', nl: 'Draaien' },
  scale: { en: 'Scale', nl: 'Schalen' },
  snap: { en: 'Snap', nl: 'Uitlijnen' },
  off: { en: 'Off', nl: 'Uit' },
  world: { en: 'World', nl: 'Wereld' },
  local: { en: 'Local', nl: 'Lokaal' },
  undo: { en: 'Undo (Ctrl+Z)', nl: 'Ongedaan maken (Ctrl+Z)' },
  redo: { en: 'Redo (Ctrl+Y)', nl: 'Opnieuw (Ctrl+Y)' },
  settings: { en: 'Settings', nl: 'Instellingen' },
  play: { en: 'Play', nl: 'Spelen' },
  publish: { en: 'Publish', nl: 'Publiceren' },
  exit: { en: 'Exit Studio', nl: 'Studio verlaten' },
  transform: { en: 'Transform', nl: 'Transformatie' },
  position: { en: 'Position', nl: 'Positie' },
  rotation: { en: 'Rotation', nl: 'Rotatie' },
  size: { en: 'Size', nl: 'Grootte' },
  appearance: { en: 'Appearance', nl: 'Uiterlijk' },
  color: { en: 'Colour', nl: 'Kleur' },
  material: { en: 'Material', nl: 'Materiaal' },
  transparency: { en: 'Transparency', nl: 'Transparantie' },
  behaviour: { en: 'Behaviour', nl: 'Gedrag' },
  anchored: { en: 'Anchored', nl: 'Verankerd' },
  collide: { en: 'Can collide', nl: 'Botsbaar' },
  touch: { en: 'On touch', nl: 'Bij aanraken' },
  bounce: { en: 'Launch', nl: 'Lanceren' },
  text: { en: 'Text', nl: 'Tekst' },
  textColor: { en: 'Text colour', nl: 'Tekstkleur' },
  light: { en: 'Light', nl: 'Licht' },
  brightness: { en: 'Brightness', nl: 'Helderheid' },
  range: { en: 'Range', nl: 'Bereik' },
  spawn: { en: 'Spawn', nl: 'Startpunt' },
  checkpoint: { en: 'Checkpoint', nl: 'Checkpoint' },
  dup: { en: 'Duplicate', nl: 'Dupliceren' },
  group: { en: 'Group', nl: 'Groeperen' },
  ungroup: { en: 'Ungroup', nl: 'Degroeperen' },
  del: { en: 'Delete', nl: 'Verwijderen' },
  focus: { en: 'Focus', nl: 'Focus' },
  model: { en: 'Model', nl: 'Model' },
  keys: { en: '<b>RMB</b> look · <b>WASD</b> fly · <b>Q/E</b> down/up · <b>F</b> focus · <b>Ctrl+D</b> duplicate · <b>F5</b> play', nl: '<b>RMK</b> kijken · <b>WASD</b> vliegen · <b>Q/E</b> omlaag/omhoog · <b>F</b> focus · <b>Ctrl+D</b> dupliceren · <b>F5</b> spelen' },
  untitled: { en: 'Untitled experience', nl: 'Naamloze ervaring' },
  multi: { en: '{n} parts', nl: '{n} onderdelen' },
  mixed: { en: 'Values of the first part are shown; changes apply to all.', nl: 'De waarden van het eerste onderdeel staan hier; wijzigingen gelden voor allemaal.' },
};
const ROW_H = 26;

export function createPanels(ctx, ed, { dialogs }) {
  const { ui } = ctx;
  const h = ui.h;
  const ib = (name, title, onclick, extra = {}) => h('button', { class: `studio-ibtn ${extra.class || ''}`, type: 'button', title: t(title), 'aria-label': t(title), onclick, html: icon(name, 18) }, extra.label ? h('span', { text: t(extra.label) }) : null);

  // ---------------------------------------------------------------- top bar
  const toolBtns = {};
  const toolSeg = h('div', { class: 'studio-seg' });
  [['select', 'studio-select', '1'], ['move', 'studio-move', '2'], ['rotate', 'rotate', '3'], ['scale', 'studio-scale', '4']].forEach(([id, ic, key]) => {
    const b = h('button', { type: 'button', title: `${t(T[id])} (${key})`, onclick: () => ed.setTool(id), html: icon(ic, 17) }, h('span', { text: t(T[id]) }), h('i', { class: 'studio-kbd', text: key }));
    toolBtns[id] = b;
    toolSeg.appendChild(b);
  });
  const snapBtn = h('button', { type: 'button', class: 'studio-ibtn', title: t(T.snap), onclick: () => ed.setSnap(ed.snap === 1 ? 0.25 : ed.snap === 0.25 ? 0 : 1) });
  const spaceBtn = h('button', { type: 'button', class: 'studio-ibtn', title: t({ en: 'Gizmo axes: world / local (L)', nl: 'Assen: wereld / lokaal (L)' }), onclick: () => ed.toggleSpace() });
  const undoBtn = ib('studio-undo', T.undo, () => ed.undo());
  const redoBtn = ib('studio-redo', T.redo, () => ed.redo());
  const titleName = h('div', { class: 'studio-title-name' });
  const statusEl = h('div', { class: 'studio-status' }, h('i'), h('span'));
  const titleBox = h('div', { class: 'studio-title', title: t(T.settings), onclick: () => dialogs.openSettings() }, titleName, statusEl);
  const leftToggle = ib('plus', T.parts, () => toggleDrawer(left), { class: 'studio-drawer-btn' });
  const rightToggle = ib('studio-tree', T.explorer, () => toggleDrawer(right), { class: 'studio-drawer-btn' });
  const top = h(
    'div',
    { class: 'studio-panel studio-top' },
    leftToggle,
    h('div', { class: 'studio-logo', html: icon('emblem', 22) }, h('b', { text: 'STUDIO' })),
    h('div', { class: 'studio-sep is-opt' }),
    titleBox,
    h('div', { class: 'studio-sep is-opt' }),
    toolSeg,
    snapBtn,
    spaceBtn,
    h('div', { class: 'studio-grow' }),
    undoBtn,
    redoBtn,
    h('div', { class: 'studio-sep' }),
    ib('settings', T.settings, () => dialogs.openSettings()),
    h('button', { type: 'button', class: 'studio-ibtn studio-play', title: `${t(T.play)} (F5)`, onclick: () => ed.play(), html: icon('studio-play', 16) }, h('span', { text: t(T.play) })),
    h('button', { type: 'button', class: 'studio-ibtn studio-publish', title: t(T.publish), onclick: () => dialogs.openPublish(), html: icon('studio-publish', 16) }, h('span', { text: t(T.publish) })),
    ib('studio-exit', T.exit, () => ed.exit()),
    rightToggle,
  );
  function toggleDrawer(el) {
    const open = !el.classList.contains('is-open');
    left.classList.remove('is-open');
    right.classList.remove('is-open');
    el.classList.toggle('is-open', open);
  }

  // ------------------------------------------------------------- library
  const ghost = h('div', { class: 'studio-panel', style: { position: 'fixed', pointerEvents: 'none', display: 'none', padding: '6px 12px', borderRadius: '999px', fontSize: '11px', letterSpacing: '0.12em', zIndex: 5 } });
  function tile(what, ic, name, wide = false) {
    const el = h('button', { type: 'button', class: `studio-tile${wide ? ' is-wide' : ''}`, title: t(name), html: icon(ic, wide ? 18 : 24) }, h('span', { text: t(name) }));
    let st = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      st = { x: e.clientX, y: e.clientY, drag: false, id: e.pointerId };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!st || st.id !== e.pointerId) return;
      if (!st.drag && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) {
        st.drag = true;
        ghost.textContent = t(name);
        ghost.style.display = 'block';
      }
      if (st.drag) Object.assign(ghost.style, { left: `${e.clientX + 14}px`, top: `${e.clientY + 10}px` });
    });
    const end = (e, cancel) => {
      if (!st || st.id !== e.pointerId) return;
      const s = st;
      st = null;
      ghost.style.display = 'none';
      if (cancel) return;
      if (s.drag) {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        if (under === ctx.engine.renderer.domElement) ed.insert(what, { x: e.clientX, y: e.clientY });
      } else ed.insert(what);
      if (window.innerWidth <= 860) left.classList.remove('is-open');
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    return el;
  }
  const left = h(
    'div',
    { class: 'studio-panel studio-left' },
    h('div', { class: 'studio-sec-head' }, h('span', { class: 'studio-cap', text: t(T.parts) })),
    h(
      'div',
      { class: 'studio-scroll', style: { flex: '1', minHeight: '0' } },
      h('div', { class: 'studio-tiles' }, PART_TILES.map((p) => tile(p.type, p.icon, p.name))),
      h('div', { class: 'studio-sec-head' }, h('span', { class: 'studio-cap', text: t(T.models) })),
      h('div', { class: 'studio-tiles' }, MODELS.map((m) => tile(m.id, m.icon, m.name, true))),
    ),
    h('div', { class: 'studio-hint', html: t(T.insertHint) }),
  );

  // -------------------------------------------------------------- explorer
  const countEl = h('span', { class: 'studio-cap studio-dim' });
  const tree = h('div', { class: 'studio-tree' });
  const spacer = h('div', { style: { position: 'relative', height: '0px' } });
  tree.appendChild(spacer);
  const open = new Set();
  let rows = [];
  let renaming = null;
  const explorer = h('div', { class: 'studio-explorer' }, h('div', { class: 'studio-sec-head' }, h('span', { class: 'studio-cap', text: t(T.explorer) }), countEl), tree);

  function buildRows() {
    const exp = ed.exp;
    rows = [];
    if (!exp) return;
    const gKids = new Map();
    const pKids = new Map();
    for (const g of exp.groups) {
      const k = g.parent || null;
      if (!gKids.has(k)) gKids.set(k, []);
      gKids.get(k).push(g);
    }
    for (const p of exp.parts) {
      const k = p.group || null;
      if (!pKids.has(k)) pKids.set(k, []);
      pKids.get(k).push(p);
    }
    const counts = new Map();
    const countOf = (gid) => {
      if (counts.has(gid)) return counts.get(gid);
      let n = (pKids.get(gid) || []).length;
      for (const c of gKids.get(gid) || []) n += countOf(c.id);
      counts.set(gid, n);
      return n;
    };
    const visit = (parent, depth) => {
      for (const g of gKids.get(parent) || []) {
        rows.push({ kind: 'group', id: g.id, depth, name: g.name, count: countOf(g.id) });
        if (open.has(g.id)) visit(g.id, depth + 1);
      }
      for (const p of pKids.get(parent) || []) rows.push({ kind: 'part', id: p.id, depth, name: p.name, color: p.color, type: p.type });
    };
    visit(null, 0);
    countEl.textContent = t(T.nParts, { n: exp.parts.length });
  }
  function groupSelected(gid) {
    if (ed.activeGroup === gid) return true;
    const ps = ed.descendantParts(gid);
    return ps.length > 0 && ps.every((p) => ed.selection.has(p.id));
  }
  function renderRows() {
    spacer.style.height = `${rows.length * ROW_H + 4}px`;
    spacer.replaceChildren();
    if (!rows.length) {
      spacer.appendChild(h('div', { class: 'studio-empty', text: t(T.emptyTree) }));
      spacer.style.height = '90px';
      return;
    }
    const first = Math.max(0, Math.floor(tree.scrollTop / ROW_H) - 4);
    const last = Math.min(rows.length, first + Math.ceil((tree.clientHeight || 300) / ROW_H) + 8);
    for (let i = first; i < last; i++) {
      const r = rows[i];
      const sel = r.kind === 'part' ? ed.selection.has(r.id) : groupSelected(r.id);
      const el = h('div', { class: `studio-row${sel ? ' is-sel' : ''}`, style: { top: `${i * ROW_H}px`, paddingLeft: `${8 + r.depth * 14}px` }, dataset: { id: r.id, kind: r.kind } });
      if (r.kind === 'group') {
        el.appendChild(h('span', { class: `studio-chev${open.has(r.id) ? ' is-open' : ''}`, html: icon('chevron-right', 13), onclick: (e) => {
          e.stopPropagation();
          if (open.has(r.id)) open.delete(r.id);
          else open.add(r.id);
          refreshTree();
        } }));
        el.appendChild(h('span', { html: icon('studio-folder', 15), style: { color: 'var(--violet)', display: 'flex' } }));
      } else {
        el.appendChild(h('span', { class: 'studio-chev' }));
        el.appendChild(h('span', { class: 'studio-sw', style: { background: r.color } }));
      }
      if (renaming === r.id) {
        const inp = h('input', { type: 'text', value: r.name, maxlength: 40 });
        let done = false;
        const commit = (ok) => {
          if (done) return;
          done = true;
          renaming = null;
          if (ok && inp.value.trim() && inp.value !== r.name) {
            if (r.kind === 'group') ed.renameGroup(r.id, inp.value);
            else ed.renamePart(r.id, inp.value);
          } else refreshTree();
        };
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit(true);
          else if (e.key === 'Escape') commit(false);
          e.stopPropagation();
        });
        inp.addEventListener('blur', () => commit(true));
        el.appendChild(inp);
        requestAnimationFrame(() => {
          inp.focus();
          inp.select();
        });
      } else el.appendChild(h('span', { class: 'studio-rname', text: r.name }));
      if (r.kind === 'group') el.appendChild(h('span', { class: 'studio-rcount', text: String(r.count) }));
      el.addEventListener('click', (e) => {
        if (renaming === r.id) return;
        const add = e.shiftKey || e.ctrlKey || e.metaKey;
        if (r.kind === 'group') ed.selectGroup(r.id, add);
        else ed.select([r.id], add ? { toggle: true } : {});
      });
      el.addEventListener('dblclick', () => {
        renaming = r.id;
        renderRows();
      });
      spacer.appendChild(el);
    }
  }
  function refreshTree() {
    buildRows();
    renderRows();
  }
  tree.addEventListener('scroll', () => renderRows(), { passive: true });
  function revealSelection() {
    // scroll the first selected row into view (only rows that are visible in the tree)
    const idx = rows.findIndex((r) => (r.kind === 'part' ? ed.selection.has(r.id) : ed.activeGroup === r.id));
    if (idx < 0) return;
    const y = idx * ROW_H;
    if (y < tree.scrollTop || y > tree.scrollTop + tree.clientHeight - ROW_H) tree.scrollTop = Math.max(0, y - tree.clientHeight / 3);
  }

  // ------------------------------------------------------------ properties
  const propsBody = h('div', { class: 'studio-pbody' });
  const selCount = h('span', { class: 'studio-cap studio-dim' });
  const props = h('div', { class: 'studio-props' }, h('div', { class: 'studio-sec-head' }, h('span', { class: 'studio-cap', text: t(T.properties) }), selCount), propsBody);
  const right = h('div', { class: 'studio-panel studio-right' }, explorer, props);
  const live = []; // [{ input, get }] number fields refreshed during drags

  const groupTitle = (txt) => h('div', { class: 'studio-group-title', text: t(txt) });
  const field = (label, control) => h('div', { class: 'studio-field' }, h('label', { text: t(label) }), control);
  function toggle(on, onChange) {
    const b = h('button', { type: 'button', class: `studio-toggle${on ? ' is-on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false' });
    b.addEventListener('click', () => {
      onChange(!b.classList.contains('is-on'));
      renderProps();
    });
    return b;
  }
  function range(value, min, max, step, fmt, onInput) {
    const out = h('output', { text: fmt(value) });
    const inp = h('input', { type: 'range', min, max, step, value });
    inp.addEventListener('input', () => {
      out.textContent = fmt(+inp.value);
      onInput(+inp.value);
    });
    return h('div', { class: 'studio-range' }, inp, out);
  }
  function xyz(part, key, step) {
    const wrap = h('div', { class: 'studio-xyz' });
    ['X', 'Y', 'Z'].forEach((ax, i) => {
      const inp = h('input', { type: 'number', step, value: fmtNum(part[key][i]) });
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) ed.setVec(part.id, key, i, v);
        else inp.value = fmtNum(part[key][i]);
      });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      live.push({ input: inp, get: () => fmtNum(part[key][i]) });
      wrap.appendChild(h('div', { class: 'studio-num', dataset: { axis: ax } }, inp));
    });
    return wrap;
  }
  const fmtNum = (v) => String(Math.round(v * 1000) / 1000);

  function renderProps() {
    live.length = 0;
    propsBody.replaceChildren();
    const sel = ed.selected();
    selCount.textContent = sel.length ? t(T.nSel, { n: sel.length }) : '';
    if (!sel.length) {
      propsBody.appendChild(h('div', { class: 'studio-empty', text: t(T.emptyProps) }));
      return;
    }
    const p = sel[0];
    const ids = sel.map((x) => x.id);
    const single = sel.length === 1;
    // header
    const nameInput = single ? h('input', { type: 'text', value: p.name, maxlength: 40 }) : null;
    if (nameInput) {
      nameInput.addEventListener('change', () => ed.renamePart(p.id, nameInput.value));
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameInput.blur();
        e.stopPropagation();
      });
    }
    propsBody.appendChild(
      h(
        'div',
        { class: 'studio-selinfo' },
        h('div', { class: 'studio-badge', html: icon(single ? TYPE_ICON[p.type] : 'studio-group', 20) }),
        h('div', { style: { flex: '1', minWidth: '0' } }, single ? nameInput : h('div', { style: { fontSize: '13px' }, text: ed.activeGroup ? ed.exp.groups.find((g) => g.id === ed.activeGroup)?.name || t(T.model) : t(T.multi, { n: sel.length }) }), h('div', { class: 'studio-type', text: single ? t(TYPE_NAME[p.type]) : t(T.multi, { n: sel.length }) })),
      ),
    );
    propsBody.appendChild(
      h(
        'div',
        { class: 'studio-actions' },
        ib('studio-dup', T.dup, () => ed.duplicate(), { label: T.dup }),
        ib('studio-group', T.group, () => ed.group(), { label: T.group }),
        ed.activeGroup || sel.some((x) => x.group) ? ib('studio-ungroup', T.ungroup, () => ed.ungroup(), { label: T.ungroup }) : null,
        ib('studio-focus', T.focus, () => ed.focusSelection(), { label: T.focus }),
        ib('trash', T.del, () => ed.remove(), { label: T.del }),
      ),
    );
    if (!single) propsBody.appendChild(h('div', { class: 'studio-type', style: { margin: '10px 0 0', letterSpacing: '0.04em', textTransform: 'none', lineHeight: '1.4' }, text: t(T.mixed) }));
    // transform
    if (single) {
      const step = ed.snap || 0.05;
      propsBody.appendChild(groupTitle(T.transform));
      propsBody.appendChild(field(T.position, xyz(p, 'p', step)));
      propsBody.appendChild(field(T.rotation, xyz(p, 'r', ed.snap ? 15 : 1)));
      propsBody.appendChild(field(T.size, xyz(p, 's', step)));
    }
    // appearance
    propsBody.appendChild(groupTitle(T.appearance));
    const sw = h('div', { class: 'studio-swatches' });
    for (const c of PALETTE) {
      sw.appendChild(h('button', { type: 'button', class: `studio-swatch${c === p.color ? ' is-on' : ''}`, title: c, style: { background: c }, onclick: () => {
        ed.setField(ids, 'color', c);
        renderProps();
      } }));
    }
    const picker = h('input', { type: 'color', value: p.color });
    picker.addEventListener('input', () => ed.setField(ids, 'color', picker.value, 'color'));
    picker.addEventListener('change', () => renderProps());
    propsBody.appendChild(h('div', { class: 'studio-field', style: { alignItems: 'start' } }, h('label', { text: t(T.color), style: { paddingTop: '4px' } }), h('div', {}, sw, h('div', { class: 'studio-color-row' }, picker, h('span', { class: 'studio-dim', style: { fontSize: '11px' }, text: p.color.toUpperCase() })))));
    const mats = h('div', { class: 'studio-mats' });
    for (const m of MATERIALS) {
      mats.appendChild(h('button', { type: 'button', class: `studio-mat${m === p.material ? ' is-on' : ''}`, onclick: () => {
        ed.setField(ids, 'material', m);
        renderProps();
      } }, h('i', { style: { background: MATERIAL_DOT[m] } }), h('span', { text: t(MATERIAL_NAMES[m]) })));
    }
    propsBody.appendChild(h('div', { class: 'studio-field', style: { alignItems: 'start' } }, h('label', { text: t(T.material), style: { paddingTop: '4px' } }), mats));
    propsBody.appendChild(field(T.transparency, range(p.transparency, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => ed.setField(ids, 'transparency', v, 'transparency'))));
    // behaviour
    propsBody.appendChild(groupTitle(T.behaviour));
    propsBody.appendChild(field(T.anchored, toggle(p.anchored, (v) => ed.setField(ids, 'anchored', v))));
    propsBody.appendChild(field(T.collide, toggle(p.collide, (v) => ed.setField(ids, 'collide', v))));
    const beh = p.props?.behavior || 'none';
    const chips = h('div', { class: 'studio-chipset' });
    for (const b of BEHAVIORS) chips.appendChild(h('button', { type: 'button', class: `studio-chip ${b.cls || ''}${b.id === beh ? ' is-on' : ''}`, text: t(b.name), onclick: () => {
      ed.setField(ids, 'props.behavior', b.id);
      renderProps();
    } }));
    propsBody.appendChild(h('div', { class: 'studio-field', style: { alignItems: 'start' } }, h('label', { text: t(T.touch), style: { paddingTop: '5px' } }), chips));
    if (beh === 'bounce') propsBody.appendChild(field(T.bounce, range(p.props.bounce ?? 22, 4, 60, 1, (v) => `${v} m/s`, (v) => ed.setField(ids, 'props.bounce', v, 'bounce'))));
    // type specific
    if (single && p.type === 'text') {
      propsBody.appendChild(groupTitle(T.text));
      const ti = h('input', { type: 'text', value: p.props.text || '', maxlength: 120 });
      ti.addEventListener('input', () => ed.setField(ids, 'props.text', ti.value, 'text'));
      ti.addEventListener('keydown', (e) => e.stopPropagation());
      propsBody.appendChild(field(T.text, ti));
      const tc = h('div', { class: 'studio-swatches' });
      for (const c of ['#ece6dc', '#7fe0ff', '#ffd29a', '#f0b46a', '#ff6b5e', '#8fe3a8', '#b48cff']) tc.appendChild(h('button', { type: 'button', class: `studio-swatch${c === p.props.textColor ? ' is-on' : ''}`, style: { background: c }, onclick: () => {
        ed.setField(ids, 'props.textColor', c);
        renderProps();
      } }));
      propsBody.appendChild(field(T.textColor, tc));
    }
    if (single && p.type === 'light') {
      propsBody.appendChild(groupTitle(T.light));
      propsBody.appendChild(field(T.brightness, range(p.props.brightness ?? 4, 0, 10, 0.5, (v) => v.toFixed(1), (v) => ed.setField(ids, 'props.brightness', v, 'brightness'))));
      propsBody.appendChild(field(T.range, range(p.props.range ?? 18, 2, 60, 1, (v) => `${v} m`, (v) => ed.setField(ids, 'props.range', v, 'range'))));
    }
    if (single && p.type === 'spawn') {
      propsBody.appendChild(groupTitle(T.spawn));
      propsBody.appendChild(field(T.checkpoint, toggle(p.props.checkpoint !== false, (v) => ed.setField(ids, 'props.checkpoint', v))));
    }
  }
  function refreshLive() {
    for (const f of live) if (document.activeElement !== f.input) f.input.value = f.get();
  }

  // ---------------------------------------------------------------- status
  function renderTop() {
    for (const [id, b] of Object.entries(toolBtns)) b.classList.toggle('is-on', ed.tool === id);
    snapBtn.innerHTML = `${icon('studio-magnet', 16)}<span>${ed.snap === 1 ? '1 m' : ed.snap === 0.25 ? '¼ m' : t(T.off)}</span>`;
    snapBtn.classList.toggle('is-on', ed.snap > 0);
    spaceBtn.innerHTML = `${icon(ed.space === 'world' ? 'globe' : 'cube', 16)}<span>${t(ed.space === 'world' ? T.world : T.local)}</span>`;
    undoBtn.disabled = !ed.history.undo.length;
    redoBtn.disabled = !ed.history.redo.length;
  }
  function renderStatus() {
    titleName.textContent = ed.exp?.meta.title || t(T.untitled);
    statusEl.className = `studio-status${ed.status.state === 'dirty' || ed.status.state === 'saving' ? ' is-dirty' : ed.status.state === 'error' ? ' is-error' : ''}`;
    statusEl.lastChild.textContent = ed.status.text;
  }

  const keys = h('div', { class: 'studio-keys', html: t(T.keys) });
  const root = h('div', { class: 'studio-root screen', hidden: true, dataset: { screen: 'studio' } }, top, left, right, keys, ed.overlay, ghost);
  ui.layers.screens.appendChild(root);

  let treeQueued = false;
  const queueTree = () => {
    if (treeQueued) return;
    treeQueued = true;
    requestAnimationFrame(() => {
      treeQueued = false;
      refreshTree();
    });
  };
  ed.on('structure', () => {
    queueTree();
    renderProps();
  });
  ed.on('selection', () => {
    renderRows();
    revealSelection();
    renderProps();
  });
  ed.on('parts', () => refreshLive());
  ed.on('history', () => {
    renderTop();
    queueTree(); // names / colours in the explorer (one rebuild per finished edit, not per drag frame)
  });
  ed.on('tool', () => {
    renderTop();
    renderProps();
  });
  ed.on('status', renderStatus);
  ed.on('settings', renderStatus);

  return {
    root,
    show() {
      root.hidden = false;
      requestAnimationFrame(() => root.classList.add('show'));
      refreshTree();
      renderProps();
      renderTop();
      renderStatus();
    },
    hide() {
      root.classList.remove('show');
      root.hidden = true;
      left.classList.remove('is-open');
      right.classList.remove('is-open');
    },
    refresh() {
      refreshTree();
      renderProps();
      renderTop();
      renderStatus();
    },
  };
}
