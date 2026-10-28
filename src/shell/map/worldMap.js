/**
 * World map modal (M, 19_world_map.png): the shared relief map image with
 * labelled diamond pins for every zone and region, the player arrow and the
 * active quest markers, a compass rose, a scale bar, wheel zoom + drag pan,
 * and the "Legend" panel with "Fast travel" to discovered zones.
 */
import { icon } from '../../ui/icons.js';
import { t, locale } from '../../core/i18n.js';
import { ZONES, REGIONS, TRAVEL } from '../../world/layout.js';
import { MAP_PLACES, PLACE_ICONS, ALWAYS_KNOWN, place } from '../data.js';
import { MAP_EXTENT } from './mapImage.js';
import { logoMarkSVG, formatDistance, uiSound } from '../util.js';
import { clamp } from '../../core/math.js';

const MODAL_ID = 'shell-map';
const VIEW_HALF = 1080; // metres visible from the centre at zoom 1 (cover fit)
/** Centre of the bounding box of every zone (spawn, base … city). */
const PLACES_CENTER = (() => {
  const zs = Object.values(ZONES);
  const xs = zs.map((z) => z.x);
  const zz = zs.map((z) => z.z);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zz) + Math.max(...zz)) / 2 };
})();
const ZOOM_MIN = 1;
const ZOOM_MAX = 5;

/** Labels used in more than one place. */
const TXT = {
  worldMap: { en: 'World map', nl: 'Wereldkaart' },
  fastTravel: { en: 'Fast travel', nl: 'Snel reizen' },
  youAreHere: { en: 'You are here', nl: 'Je bent hier' },
};

export class WorldMap {
  constructor(ctx, shell, mapImage, frame) {
    this.ctx = ctx;
    this.shell = shell;
    this.mapImage = mapImage;
    this.frame = frame;
    this.el = null;
    this.view = { cx: 30, cz: -170, zoom: 1, vw: 1, vh: 1 };
    this.selected = 'base';
    this.from = null;
    this._offReady = null;
    this._ro = null;
  }

  get isOpen() {
    return this.ctx.ui.isModalOpen(MODAL_ID);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Zones the player may fast-travel to (discovered ∪ always known ∪ creative). */
  discovered() {
    const st = this.ctx.state;
    const set = new Set(ALWAYS_KNOWN);
    for (const id of st.get('progress.discovered') || []) set.add(id);
    for (const id of st.get('shell.visited') || []) set.add(id);
    if (st.get('settings.creative')) for (const id of Object.keys(ZONES)) set.add(id);
    return set;
  }

  open({ from = null, select = null } = {}) {
    if (this.isOpen) return;
    const ctx = this.ctx;
    this.from = from;
    const here = this.shell.currentZone?.();
    this.selected = select || (here && place(here) ? here : this.selected);
    this._build();
    ctx.ui.openModal(MODAL_ID, this.el, { className: 'shell-map-wrap', onClose: () => this._onClosed() });
    uiSound(ctx, 'ui.open');
    if (!this.mapImage.ready) this.mapImage.start(0);
    this._offReady = this.mapImage.onReady(() => this._attachCanvas());
    // frame all named places (base … Aurora City), leaning toward the player
    requestAnimationFrame(() => {
      this._measure();
      const f = this.frame.focus;
      this.view.zoom = 1;
      this.view.cx = clamp(PLACES_CENTER.x * 0.7 + f.x * 0.3, -600, 600);
      this.view.cz = clamp(PLACES_CENTER.z * 0.7 + f.z * 0.3, -700, 500);
      this._layout();
      this._select(this.selected, { pan: false });
    });
  }

  close() {
    this.ctx.ui.closeModal(MODAL_ID);
  }

  _onClosed() {
    this._offReady?.();
    this._offReady = null;
    this._ro?.disconnect();
    this._ro = null;
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    cancelAnimationFrame(this._panRaf);
    uiSound(this.ctx, 'ui.close');
    this.el = null;
    this._layers = [];
    this._img = null;
  }

  // ------------------------------------------------------------------ DOM
  _build() {
    const ctx = this.ctx;
    const h = ctx.ui.h;
    const known = this.discovered();
    this.pins = new Map();
    this.legendItems = new Map();

    this.canvasHost = h('div', { class: 'shell-map-canvas-host' });
    this.pinLayer = h('div', { class: 'shell-map-pins' });
    this.playerEl = h('div', { class: 'shell-map-player', title: t({ en: 'You', nl: 'Jij' }) }, h('div', { class: 'shell-map-player-arrow' }));
    this.questLayer = h('div', { class: 'shell-map-quests' });
    this.loading = h('div', { class: 'shell-map-loading' }, h('span', { class: 'shell-spinner' }), t({ en: 'Drawing the map…', nl: 'Kaart wordt getekend…' }));
    this.loadingNote = h('div', { class: 'shell-map-refine', hidden: true }, h('span', { class: 'shell-spinner' }), t({ en: 'Loading details…', nl: 'Details worden geladen…' }));
    this._layers = [];
    this._img = null;

    for (const id of MAP_PLACES) {
      const p = place(id);
      if (!p) continue;
      const region = !!REGIONS[id];
      const isKnown = region || known.has(id) || id === 'city';
      const pin = h(
        'button',
        {
          class: `shell-pin${region ? ' is-region' : ''}${isKnown ? '' : ' is-unknown'}${id === 'base' ? ' is-home' : ''}`,
          type: 'button',
          dataset: { id },
          'aria-label': p.label,
          onclick: (e) => {
            e.stopPropagation();
            this._select(id, { pan: true });
          },
          ondblclick: (e) => {
            e.stopPropagation();
            if (this._canTravel(id)) this._travel(id);
          },
        },
        region ? null : h('span', { class: 'shell-pin-gem' }, h('span', { class: 'shell-pin-icon', html: icon(PLACE_ICONS[id] || 'pin', 16) })),
        h('span', { class: 'shell-pin-label', text: p.label }),
      );
      this.pins.set(id, { el: pin, x: p.x, z: p.z });
      this.pinLayer.appendChild(pin);
    }
    this.pinLayer.append(this.questLayer, this.playerEl);

    this.viewport = h(
      'div',
      { class: 'shell-map-viewport' },
      this.canvasHost,
      h('div', { class: 'shell-map-shade' }),
      this.pinLayer,
      this.loading,
    );
    this._bindViewport();

    this.scaleEl = h('div', { class: 'shell-map-scale' });
    const stage = h(
      'div',
      { class: 'shell-map-stage' },
      this.viewport,
      h(
        'div',
        { class: 'shell-map-brand' },
        h('div', { class: 'shell-map-brand-row' }, h('span', { html: logoMarkSVG({ size: 34, stroke: 5 }) }), h('span', { class: 'shell-map-brand-word', text: 'UNIVERSE' })),
        h('div', { class: 'shell-map-brand-sub', text: t(TXT.worldMap) }),
      ),
      h('div', { class: 'shell-map-compass', html: compassSVG() }),
      this.scaleEl,
      h(
        'div',
        { class: 'shell-map-zoom' },
        h('button', { class: 'shell-map-zbtn', type: 'button', 'aria-label': t({ en: 'Zoom in', nl: 'Inzoomen' }), title: t({ en: 'Zoom in', nl: 'Inzoomen' }), html: icon('plus', 18), onclick: () => this._zoomBy(1.5) }),
        h('button', { class: 'shell-map-zbtn', type: 'button', 'aria-label': t({ en: 'Zoom out', nl: 'Uitzoomen' }), title: t({ en: 'Zoom out', nl: 'Uitzoomen' }), html: icon('minus', 18), onclick: () => this._zoomBy(1 / 1.5) }),
        h('button', { class: 'shell-map-zbtn', type: 'button', 'aria-label': t({ en: 'Centre on you', nl: 'Centreer op jou' }), title: t({ en: 'Centre on you', nl: 'Centreer op jou' }), html: icon('shell-crosshair', 18), onclick: () => this._centerOnPlayer() }),
      ),
      h('div', {
        class: 'shell-map-hint',
        text: ctx.device?.touch
          ? t({ en: 'Pinch to zoom · Drag to pan · Tap a place, then Fast travel', nl: 'Knijp om te zoomen · Sleep om te verschuiven · Tik op een plek en dan Snel reizen' })
          : t({ en: 'Scroll to zoom · Drag to pan · Double-click to travel', nl: 'Scroll om te zoomen · Sleep om te verschuiven · Dubbelklik om te reizen' }),
      }),
      this.loadingNote,
    );

    // legend
    const list = h('div', { class: 'shell-legend-list scroll', role: 'listbox', 'aria-label': t({ en: 'Locations', nl: 'Locaties' }) });
    for (const id of MAP_PLACES) {
      const p = place(id);
      if (!p) continue;
      const region = !!REGIONS[id];
      const isKnown = region || known.has(id) || id === 'city';
      const item = h(
        'button',
        {
          class: `shell-legend-item${isKnown ? '' : ' is-unknown'}${region ? ' is-region' : ''}`,
          type: 'button',
          role: 'option',
          dataset: { id },
          onclick: () => {
            uiSound(ctx, 'ui.click');
            this._select(id, { pan: true });
          },
          onmouseenter: () => uiSound(ctx, 'ui.hover'),
        },
        h('span', { class: 'shell-legend-gem' }, h('span', { html: icon(PLACE_ICONS[id] || 'pin', 16) })),
        h('span', { class: 'shell-legend-label', text: p.label }),
        h('span', { class: 'shell-legend-state', html: region ? '' : isKnown ? icon('check', 14) : '' }),
      );
      this.legendItems.set(id, item);
      list.appendChild(item);
    }
    this.detail = h('div', { class: 'shell-map-detail' });
    this.travelBtn = h('button', { class: 'shell-map-travel', type: 'button', onclick: () => this._travel(this.selected) }, h('span', { html: icon('shell-fast', 20) }), h('span', { class: 'shell-map-travel-label', text: t(TXT.fastTravel) }));
    const legend = h(
      'aside',
      { class: 'shell-map-legend' },
      h(
        'div',
        { class: 'shell-map-legend-head' },
        h('h2', { class: 'shell-map-legend-title', text: t({ en: 'Legend', nl: 'Legenda' }) }),
        h('button', { class: 'modal-close', type: 'button', 'aria-label': t({ en: 'Close', nl: 'Sluiten' }), html: icon('close', 20), onclick: () => this.close() }),
      ),
      list,
      this.detail,
      this.travelBtn,
    );

    this.el = h('div', { class: 'shell-map', role: 'dialog', 'aria-modal': 'true', 'aria-label': t(TXT.worldMap) }, stage, legend);
    this._attachCanvas();
  }

  /**
   * Shows the best map available: the terrain preview at once (a private
   * copy — never re-parent another module's canvas), then the baked map
   * cross-fading over it when ready.
   */
  _attachCanvas() {
    if (!this.el) return;
    const src = this.mapImage.source();
    if (!src) return;
    const layers = this._layers || (this._layers = []);
    if (src.hires) {
      if (layers.some((l) => l.el === src.canvas)) return;
      // the shared map canvas is shown directly (CSS-scaled); the minimap only
      // uses it as a drawImage source, so moving it into the DOM is harmless
      src.canvas.classList.add('shell-map-img');
      this.canvasHost.appendChild(src.canvas);
      const old = layers.splice(0);
      layers.push({ el: src.canvas, extent: src.extent });
      setTimeout(() => old.forEach((l) => l.el.remove()), 900);
    } else if (!layers.length) {
      const copy = document.createElement('canvas');
      copy.width = src.canvas.width;
      copy.height = src.canvas.height;
      copy.getContext('2d').drawImage(src.canvas, 0, 0);
      copy.className = 'shell-map-img is-preview';
      this.canvasHost.appendChild(copy);
      layers.push({ el: copy, extent: src.extent });
    }
    this._img = layers[layers.length - 1].el;
    this.loading.hidden = true;
    this.loadingNote.hidden = src.hires;
    this._layout();
  }

  // --------------------------------------------------------------- view
  _measure() {
    if (!this.viewport) return;
    this.view.vw = Math.max(1, this.viewport.clientWidth);
    this.view.vh = Math.max(1, this.viewport.clientHeight);
  }

  /** Pixels per metre at the current zoom. */
  _ppm() {
    const v = this.view;
    return (Math.max(v.vw, v.vh) / (2 * VIEW_HALF)) * v.zoom;
  }

  _clampView() {
    const v = this.view;
    const ppm = this._ppm();
    const hx = v.vw / 2 / ppm;
    const hz = v.vh / 2 / ppm;
    const lim = MAP_EXTENT - 20;
    v.cx = hx >= lim ? 0 : clamp(v.cx, -lim + hx, lim - hx);
    v.cz = hz >= lim ? 0 : clamp(v.cz, -lim + hz, lim - hz);
  }

  _toScreen(x, z) {
    const v = this.view;
    const ppm = this._ppm();
    return [v.vw / 2 + (x - v.cx) * ppm, v.vh / 2 + (z - v.cz) * ppm];
  }

  _layout() {
    if (!this.el) return;
    this._clampView();
    const v = this.view;
    const ppm = this._ppm();
    // map images (each covers ±extent)
    for (const l of this._layers || []) {
      const size = 2 * l.extent * ppm;
      const [left, top] = this._toScreen(-l.extent, -l.extent);
      l.el.style.width = `${size}px`;
      l.el.style.height = `${size}px`;
      l.el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    }
    for (const [, pin] of this.pins) {
      const [x, y] = this._toScreen(pin.x, pin.z);
      pin.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }
    this._layoutDynamic();
    this._layoutScale(ppm);
    this.el.style.setProperty('--zoom', String(v.zoom));
  }

  /** Player arrow + quest markers (also refreshed every frame while open). */
  _layoutDynamic() {
    if (!this.el) return;
    const f = this.frame;
    const [px, py] = this._toScreen(f.focus.x, f.focus.z);
    this.playerEl.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0) rotate(${-f.focusHeading}rad)`;
    this.playerEl.hidden = this.ctx.modes.is('space');
    const h = this.ctx.ui.h;
    const questPins = this._questPins || (this._questPins = new Set());
    questPins.clear();
    let n = 0;
    for (let i = 0; i < f.count; i++) {
      const e = f.entries[i];
      if (e.m.kind !== 'quest') continue;
      let el = this.questLayer.children[n];
      if (!el) {
        el = h('div', { class: 'shell-map-quest' }, h('span', { class: 'shell-map-quest-gem' }), h('span', { class: 'shell-map-quest-label' }));
        this.questLayer.appendChild(el);
      }
      const [x, y] = this._toScreen(e.x, e.z);
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      const label = t(e.m.label) || t({ en: 'Mission', nl: 'Missie' });
      if (el.lastChild.textContent !== label) el.lastChild.textContent = label;
      el.classList.toggle('is-tracked', e === f.tracked);
      // a quest target on a named place: ring the pin instead of a second label
      let pinId = null;
      for (const [id, pin] of this.pins) {
        if (!REGIONS[id] && Math.abs(pin.x - e.x) < 34 && Math.abs(pin.z - e.z) < 34) {
          pinId = id;
          break;
        }
      }
      el.classList.toggle('is-on-pin', !!pinId);
      if (pinId) questPins.add(pinId);
      el.hidden = false;
      n++;
    }
    for (let i = n; i < this.questLayer.children.length; i++) this.questLayer.children[i].hidden = true;
    for (const [id, pin] of this.pins) {
      const q = questPins.has(id);
      if (pin.quest !== q) {
        pin.quest = q;
        pin.el.classList.toggle('is-quest', q);
      }
    }
  }

  _layoutScale(ppm) {
    // choose a "nice" length that spans ~90–190 px
    const nice = [50, 100, 200, 250, 500, 1000, 2000];
    let len = nice[0];
    for (const n of nice) if (n * ppm <= 190) len = n;
    const px = len * ppm;
    const label = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString(locale())} km` : `${m} m`);
    this.scaleEl.innerHTML = `<div class="shell-map-scale-bar" style="width:${Math.round(px)}px"><i></i><i></i><i></i></div>
      <div class="shell-map-scale-labels" style="width:${Math.round(px)}px"><span>0</span><span>${label(len / 2).replace(/ (m|km)$/, '')}</span><span>${label(len)}</span></div>`;
  }

  _zoomBy(factor, ax = null, ay = null) {
    const v = this.view;
    const ppm0 = this._ppm();
    const sx = ax ?? v.vw / 2;
    const sy = ay ?? v.vh / 2;
    // world point under the anchor stays fixed
    const wx = v.cx + (sx - v.vw / 2) / ppm0;
    const wz = v.cz + (sy - v.vh / 2) / ppm0;
    v.zoom = clamp(v.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const ppm1 = this._ppm();
    v.cx = wx - (sx - v.vw / 2) / ppm1;
    v.cz = wz - (sy - v.vh / 2) / ppm1;
    this._layout();
  }

  _centerOnPlayer() {
    const f = this.frame.focus;
    this._panTo(f.x, f.z, Math.max(this.view.zoom, 2.2));
  }

  /** Smooth pan (and optional zoom) to a world point. */
  _panTo(x, z, zoom = this.view.zoom) {
    const v = this.view;
    const from = { cx: v.cx, cz: v.cz, zoom: v.zoom };
    const t0 = performance.now();
    const dur = 520;
    cancelAnimationFrame(this._panRaf);
    const step = () => {
      if (!this.el) return;
      const t = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      v.cx = from.cx + (x - from.cx) * e;
      v.cz = from.cz + (z - from.cz) * e;
      v.zoom = from.zoom + (zoom - from.zoom) * e;
      this._layout();
      if (t < 1) this._panRaf = requestAnimationFrame(step);
    };
    this._panRaf = requestAnimationFrame(step);
  }

  _bindViewport() {
    const vp = this.viewport;
    vp.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = vp.getBoundingClientRect();
        this._zoomBy(Math.exp(-Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 240) * 0.0022), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    this._drag = null;
    this._onMove = (e) => {
      if (!this._drag) return;
      const ppm = this._ppm();
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this._drag.moved = true;
      this.view.cx = this._drag.cx - dx / ppm;
      this.view.cz = this._drag.cz - dy / ppm;
      this._layout();
    };
    this._onUp = () => {
      if (this._drag) vp.classList.remove('is-dragging');
      this._drag = null;
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerup', this._onUp);
    };
    vp.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.shell-pin')) return;
      this._drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false };
      vp.classList.add('is-dragging');
      window.addEventListener('pointermove', this._onMove);
      window.addEventListener('pointerup', this._onUp);
    });
    // touch: two-finger pinch zooms around the fingers (one finger pans, above)
    const pts = new Map();
    let pinchD = 0;
    const two = () => {
      const [a, b] = [...pts.values()];
      const r = vp.getBoundingClientRect();
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    };
    vp.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        this._onUp(); // the pinch takes over from the one-finger pan
        pinchD = two().d;
      }
    });
    vp.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 2 && pinchD > 0) {
        const g = two();
        if (g.d > 0) this._zoomBy(g.d / pinchD, g.x, g.y);
        pinchD = g.d;
      }
    });
    const lift = (e) => {
      if (pts.delete(e.pointerId) && pts.size < 2) pinchD = 0;
    };
    vp.addEventListener('pointerup', lift);
    vp.addEventListener('pointercancel', lift);
    this._ro = new ResizeObserver(() => {
      this._measure();
      this._layout();
    });
    this._ro.observe(vp);
  }

  // ------------------------------------------------------------ selection
  _canTravel(id) {
    const ctx = this.ctx;
    if (!TRAVEL.includes(id) || !ZONES[id]) return false;
    if (!ctx.modes.is('explore', 'drive')) return false;
    return this.discovered().has(id);
  }

  _select(id, { pan = false } = {}) {
    const p = place(id);
    if (!p || !this.el) return;
    this.selected = id;
    for (const [pid, pin] of this.pins) pin.el.classList.toggle('is-selected', pid === id);
    for (const [pid, item] of this.legendItems) {
      item.classList.toggle('is-selected', pid === id);
      item.setAttribute('aria-selected', pid === id ? 'true' : 'false');
    }
    this.legendItems.get(id)?.scrollIntoView?.({ block: 'nearest' });
    if (pan) this._panTo(p.x, p.z, Math.max(this.view.zoom, REGIONS[id] ? 1.2 : 1.8));

    const h = this.ctx.ui.h;
    const f = this.frame.focus;
    const dist = Math.hypot(p.x - f.x, p.z - f.z);
    const region = !!REGIONS[id];
    const known = region || this.discovered().has(id) || id === 'city';
    const here = this.shell.currentZone?.() === id || dist < (p.radius || 30);
    const canTravel = this._canTravel(id);
    const notYet = { en: 'Not discovered yet', nl: 'Nog niet ontdekt' };
    let status;
    if (region) status = { en: 'Region', nl: 'Regio' };
    else if (!TRAVEL.includes(id)) status = known ? { en: 'Visible from the shore', nl: 'Zichtbaar vanaf de oever' } : notYet;
    else status = known ? { en: 'Discovered', nl: 'Ontdekt' } : notYet;
    this.detail.replaceChildren(
      h('div', { class: 'shell-map-detail-name' }, h('span', { html: icon(PLACE_ICONS[id] || 'pin', 18) }), p.label),
      h('p', { class: 'shell-map-detail-desc', text: known ? p.desc || '' : t({ en: 'Explore the world to discover this location.', nl: 'Verken de wereld om deze locatie te ontdekken.' }) }),
      h(
        'div',
        { class: 'shell-map-detail-meta' },
        h('span', { class: `shell-map-detail-status${known && !region ? ' is-known' : ''}`, text: t(status) }),
        this.ctx.modes.is('space') ? null : h('span', { class: 'num', text: here ? t(TXT.youAreHere) : formatDistance(dist) }),
      ),
    );
    const enabled = canTravel && !here;
    this.travelBtn.disabled = !enabled;
    this.travelBtn.title = t(
      enabled
        ? { en: 'Travel to {place}', nl: 'Reis naar {place}' }
        : here
          ? { en: 'You are already here', nl: 'Je bent hier al' }
          : !TRAVEL.includes(id)
            ? { en: 'Fast travel is not possible here', nl: 'Snel reizen is hier niet mogelijk' }
            : !known
              ? { en: 'Discover this location first', nl: 'Ontdek deze locatie eerst' }
              : { en: 'Fast travel only works on the planet', nl: 'Snel reizen kan alleen op de planeet' },
      { place: p.label },
    );
    this.travelBtn.querySelector('.shell-map-travel-label').textContent = t(here && canTravel ? TXT.youAreHere : TXT.fastTravel);
  }

  async _travel(id) {
    if (!this._canTravel(id)) {
      uiSound(this.ctx, 'ui.error');
      return;
    }
    uiSound(this.ctx, 'ui.click');
    this.close();
    await this.shell.fastTravel(id);
  }

  /** Called every frame by the shell while the map is open. */
  update() {
    if (this.el && this._img) this._layoutDynamic();
  }
}

/** Compass rose; the letters follow the language (N/E/S/W, nl N/O/Z/W). */
function compassSVG() {
  const east = t({ en: 'E', nl: 'O' });
  const south = t({ en: 'S', nl: 'Z' });
  return `<svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" fill="none">
  <circle cx="60" cy="60" r="38" stroke="rgba(236,230,220,.55)" stroke-width="1"/>
  <circle cx="60" cy="60" r="27" stroke="rgba(236,230,220,.2)" stroke-width="1" stroke-dasharray="2 3"/>
  <path d="M60 14v10M60 96v10M14 60h10M96 60h10" stroke="rgba(236,230,220,.6)" stroke-width="1"/>
  <path d="m60 33 7 27-7-5-7 5Z" fill="#ece6dc"/>
  <path d="m60 87-7-27 7 5 7-5Z" fill="rgba(236,230,220,.28)"/>
  <text x="60" y="10" text-anchor="middle" font-family="Jost, sans-serif" font-size="12" font-weight="500" fill="#fff">N</text>
  <text x="114" y="64" text-anchor="middle" font-family="Jost, sans-serif" font-size="11" fill="rgba(236,230,220,.8)">${east}</text>
  <text x="60" y="118" text-anchor="middle" font-family="Jost, sans-serif" font-size="11" fill="rgba(236,230,220,.8)">${south}</text>
  <text x="6" y="64" text-anchor="middle" font-family="Jost, sans-serif" font-size="11" fill="rgba(236,230,220,.8)">W</text>
</svg>`;
}
