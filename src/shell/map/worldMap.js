/**
 * World map modal (M, 19_world_map.png) for the whole planet (PLATFORM.md §11): the hand-made hub
 * map image in the middle, the infinite procedural planet around it (ctx.frontier.minimap via a cached
 * FrontierLayer), pan + zoom from the hub's streets out to ~25 km, and on top:
 *   - the safe-zone border and the §11.2 no-build ring, highways with their names, waystones,
 *     claims (yours cyan, others amber), other players,
 *   - pins: hub places (collapse into one "Hub" pin when zoomed out), discovered wilderness POIs,
 *     your base (claim), spawn beacon, death crate, waypoint, quest / boss markers, "you are here",
 *   - the legend: where you are, travel (hub Gateway: Random wilderness / My base / Spawn beacon —
 *     only inside the hub; "Return to hub" from the wilderness: 10 s channel), the places list and
 *     the selection's details + actions (Fast travel between hub places while inside the hub,
 *     Set / Remove waypoint).
 * Touch: one finger pans, two fingers pinch-zoom, tap selects (tap empty ground → "Set waypoint").
 * Desktop: wheel zoom, drag pan, double-click empty ground = waypoint, double-click a place = travel.
 */
import { icon } from '../../ui/icons.js';
import { t, locale } from '../../core/i18n.js';
import { ZONES, REGIONS, TRAVEL } from '../../world/layout.js';
import { MAP_PLACES, PLACE_ICONS, ALWAYS_KNOWN, place } from '../data.js';
import { MAP_EXTENT } from './mapImage.js';
import { FrontierLayer } from './frontierLayer.js';
import { logoMarkSVG, formatDistance, uiSound } from '../util.js';
import { HUB_HALF, NO_BUILD, toScreen, toWorld, zoomAround, clampCenter, niceLength, viewBounds, formatWait, fitView } from '../logic.js';
import { POI_STYLE, poiName } from '../wild.js';

const MODAL_ID = 'shell-map';
const PPM_MIN = 0.04; // px per metre: ~25 km across a 1000 px map
const PPM_MAX = 3;
const CENTER_LIMIT = 60000;
const HUB_PIN_PPM = 0.11; // below this zoom the hub's places collapse into one "Hub" pin
const MAX_DYN = 80;
const TAU = Math.PI * 2;

/** Labels used in more than one place. */
const TXT = {
  worldMap: { en: 'World map', nl: 'Wereldkaart' },
  fastTravel: { en: 'Fast travel', nl: 'Snel reizen' },
  youAreHere: { en: 'You are here', nl: 'Je bent hier' },
  hub: { en: 'The Hub', nl: 'De hub' },
  hubDesc: { en: 'The hand-made heart of the planet: a safe social zone — no enemies, no combat, no building.', nl: 'Het handgemaakte hart van de planeet: een veilige sociale zone — geen vijanden, geen gevechten, niet bouwen.' },
  safeZone: { en: 'Safe zone', nl: 'Veilige zone' },
  noBuild: { en: 'No building', nl: 'Niet bouwen' },
  wilderness: { en: 'Wilderness', nl: 'Wildernis' },
  gateway: { en: 'Gateway', nl: 'Poort' },
  gatewaySub: { en: 'Instant travel from the hub', nl: 'Direct reizen vanuit de hub' },
  wild: { en: 'Random wilderness', nl: 'Willekeurige wildernis' },
  wildSub: { en: 'A safe spot 2–8 km out', nl: 'Een veilige plek 2–8 km verderop' },
  base: { en: 'My base', nl: 'Mijn basis' },
  beacon: { en: 'Spawn beacon', nl: 'Spawnbaken' },
  bed: { en: 'My bed', nl: 'Mijn bed' },
  bedDesc: { en: 'Your bed: after a defeat you wake up here. Sleeping through the night also rests you.', nl: 'Jouw bed: na een nederlaag word je hier wakker. Slapen tot de ochtend geeft ook rust.' },
  returnHub: { en: 'Return to hub', nl: 'Terug naar de hub' },
  returnSub: { en: '10 s · stand still · not in combat', nl: '10 s · blijf staan · niet in gevecht' },
  places: { en: 'Hub places', nl: 'Plekken in de hub' },
  discovered: { en: 'Discovered', nl: 'Ontdekt' },
  yours: { en: 'Yours', nl: 'Van jou' },
  waypoint: { en: 'Waypoint', nl: 'Markering' },
  setWaypoint: { en: 'Set waypoint', nl: 'Markering plaatsen' },
  removeWaypoint: { en: 'Remove waypoint', nl: 'Markering weghalen' },
  point: { en: 'Map point', nl: 'Punt op de kaart' },
  crate: { en: 'Your dropped items', nl: 'Je verloren spullen' },
  crateDesc: { en: 'Only you can open this crate — get there before it expires.', nl: 'Alleen jij kunt deze krat openen — wees er voor hij verdwijnt.' },
  baseDesc: { en: 'Your claim: only you can build or demolish here.', nl: 'Jouw claim: alleen jij kunt hier bouwen of slopen.' },
  beaconDesc: { en: 'You respawn here after a defeat.', nl: 'Hier respawn je na een nederlaag.' },
  poiDesc: {
    ruin: { en: 'Ancient Ø ruins, guarded by security drones. Relics inside.', nl: 'Oude Ø-ruïnes, bewaakt door beveiligingsdrones. Relikwieën binnen.' },
    outpost: { en: 'A pirate outpost: drones, stalkers at night — and their loot.', nl: 'Een piratenbuitenpost: drones, ’s nachts stalkers — en hun buit.' },
    wreck: { en: 'A crashed ship. Salvage for whoever dares.', nl: 'Een neergestort schip. Wrakgoed voor wie durft.' },
  },
  claimOf: { en: 'Claim of {name}', nl: 'Claim van {name}' },
  wpHint: { en: 'Tap the map to set a waypoint', nl: 'Tik op de kaart voor een markering' },
};

export class WorldMap {
  constructor(ctx, shell, mapImage, frame, { wild = null, travel = null } = {}) {
    this.ctx = ctx;
    this.shell = shell;
    this.mapImage = mapImage;
    this.frame = frame;
    this.wild = wild;
    this.travel = travel;
    this.el = null;
    this.view = { cx: 30, cz: -170, ppm: 0.6, vw: 1, vh: 1 };
    this.dpr = 1;
    this.sel = { kind: 'place', id: 'base' };
    this.from = null;
    this.layer = new FrontierLayer({ settle: 2.5, every: 0.12, moveFrac: 0.1 });
    this._offReady = null;
    this._ro = null;
    this._s = [0, 0];
    this._w = [0, 0];
    this._overlayAt = 0;
    this._needOverlay = true;
  }

  get isOpen() {
    return this.ctx.ui.isModalOpen(MODAL_ID);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Hub zones the player may fast-travel to (discovered ∪ always known ∪ creative). */
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
    const f = this.frame.focus;
    const here = this.shell.currentZone?.();
    const inHub = this._inHub(f.x, f.z);
    if (select) this.sel = { kind: 'place', id: select };
    else if (inHub && here && place(here)) this.sel = { kind: 'place', id: here };
    else if (!inHub) this.sel = { kind: 'me' };
    this._build();
    ctx.ui.openModal(MODAL_ID, this.el, { className: 'shell-map-wrap', onClose: () => this._onClosed() });
    uiSound(ctx, 'ui.open');
    if (!this.mapImage.ready) this.mapImage.start(0);
    this._offReady = this.mapImage.onReady(() => this._attachCanvas());
    requestAnimationFrame(() => {
      this._measure();
      this._frameStart(inHub);
      this._layout();
      this._select(this.sel, { pan: false });
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
    cancelAnimationFrame(this._layoutRaf);
    uiSound(this.ctx, 'ui.close');
    this.el = null;
    this._layers = [];
    this._img = null;
  }

  _inHub(x, z) {
    return this.wild ? this.wild.inHub(x, z) : Math.abs(x) <= HUB_HALF && Math.abs(z) <= HUB_HALF;
  }

  /** Opening view: the hub's places when you are in the hub, else you + the way home. */
  _frameStart(inHub) {
    const v = this.view;
    const f = this.frame.focus;
    if (inHub) {
      v.ppm = Math.max(v.vw, v.vh) / 2160;
      v.cx = Math.max(-600, Math.min(600, 30 * 0.7 + f.x * 0.3));
      v.cz = Math.max(-700, Math.min(500, -170 * 0.7 + f.z * 0.3));
      return;
    }
    // fit the player and the nearest hub border point (≤ 7 km), at least 3 km across
    const bx = Math.max(-HUB_HALF, Math.min(HUB_HALF, f.x));
    const bz = Math.max(-HUB_HALF, Math.min(HUB_HALF, f.z));
    const far = Math.hypot(bx - f.x, bz - f.z) > 7000;
    const x0 = far ? f.x - 1500 : Math.min(f.x, bx) - 600;
    const x1 = far ? f.x + 1500 : Math.max(f.x, bx) + 600;
    const z0 = far ? f.z - 1500 : Math.min(f.z, bz) - 600;
    const z1 = far ? f.z + 1500 : Math.max(f.z, bz) + 600;
    this._fit(x0, z0, x1, z1, 0.6);
  }

  /**
   * Fits a world rectangle into the part of the viewport the overlays leave free (brand top-left,
   * zoom buttons right, compass + scale bottom-left, hint bottom).
   */
  _fit(x0, z0, x1, z1, maxPpm = PPM_MAX) {
    const v = this.view;
    const small = v.vw < 640;
    const ins = { l: small ? 16 : 28, r: small ? 64 : 76, t: small ? 64 : 112, b: small ? 34 : 56 };
    fitView(v, x0, z0, x1, z1, ins, PPM_MIN, maxPpm);
  }

  // ------------------------------------------------------------------ DOM
  _build() {
    const ctx = this.ctx;
    const h = ctx.ui.h;
    const known = this.discovered();
    this.pins = new Map();
    this.legendItems = new Map();
    this.dyn = new Map(); // id → { el, x, z, kind, used }

    this.canvasHost = h('div', { class: 'shell-map-canvas-host' });
    this.frontierHost = h('div', { class: 'shell-map-frontier' });
    this.layer.canvas.className = 'shell-map-frontier-canvas';
    this.frontierHost.appendChild(this.layer.canvas);
    this.overlay = h('canvas', { class: 'shell-map-overlay', 'aria-hidden': 'true' });
    this.og = this.overlay.getContext('2d');
    this.pinLayer = h('div', { class: 'shell-map-pins' });
    this.dynLayer = h('div', { class: 'shell-map-dyn' });
    this.playerEl = h('div', { class: 'shell-map-player', title: t({ en: 'You', nl: 'Jij' }) }, h('div', { class: 'shell-map-player-arrow' }), h('span', { class: 'shell-map-player-label', text: t({ en: 'You', nl: 'Jij' }) }));
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
          class: `shell-pin${region ? ' is-region' : ''}${isKnown ? '' : ' is-unknown'}`,
          type: 'button',
          dataset: { id },
          'aria-label': p.label,
          onclick: (e) => {
            e.stopPropagation();
            this._select({ kind: 'place', id }, { pan: true });
          },
          ondblclick: (e) => {
            e.stopPropagation();
            if (this._canFastTravel(id)) this._fastTravel(id);
          },
        },
        region ? null : h('span', { class: 'shell-pin-gem' }, h('span', { class: 'shell-pin-icon', html: icon(PLACE_ICONS[id] || 'pin', 16) })),
        h('span', { class: 'shell-pin-label', text: p.label }),
      );
      this.pins.set(id, { el: pin, x: p.x, z: p.z, region });
      this.pinLayer.appendChild(pin);
    }
    // the whole hub as one pin when zoomed out
    this.hubPin = h(
      'button',
      { class: 'shell-pin is-hub', type: 'button', 'aria-label': t(TXT.hub), onclick: (e) => (e.stopPropagation(), this._select({ kind: 'hub' }, { pan: true, zoom: 0.16 })) },
      h('span', { class: 'shell-pin-gem' }, h('span', { class: 'shell-pin-icon', html: icon('shell-hub', 18) })),
      h('span', { class: 'shell-pin-label' }, t(TXT.hub), h('small', { text: t(TXT.safeZone) })),
    );
    this.pinLayer.append(this.hubPin, this.dynLayer, this.questLayer, this.playerEl);

    this.viewport = h(
      'div',
      { class: 'shell-map-viewport' },
      this.frontierHost,
      this.canvasHost,
      this.overlay,
      h('div', { class: 'shell-map-shade' }),
      this.pinLayer,
      this.loading,
    );
    this._bindViewport();

    this.scaleEl = h('div', { class: 'shell-map-scale' });
    this.coordEl = h('div', { class: 'shell-map-coord num' });
    const touch = !!ctx.device?.touch;
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
      this.coordEl,
      h(
        'div',
        { class: 'shell-map-zoom' },
        h('button', { class: 'shell-map-zbtn', type: 'button', 'aria-label': t({ en: 'Zoom in', nl: 'Inzoomen' }), title: t({ en: 'Zoom in', nl: 'Inzoomen' }), html: icon('plus', 18), onclick: () => this._zoomBy(1.6) }),
        h('button', { class: 'shell-map-zbtn', type: 'button', 'aria-label': t({ en: 'Zoom out', nl: 'Uitzoomen' }), title: t({ en: 'Zoom out', nl: 'Uitzoomen' }), html: icon('minus', 18), onclick: () => this._zoomBy(1 / 1.6) }),
        h('button', { class: 'shell-map-zbtn', type: 'button', 'aria-label': t({ en: 'Centre on you', nl: 'Centreer op jou' }), title: t({ en: 'Centre on you', nl: 'Centreer op jou' }), html: icon('shell-crosshair', 18), onclick: () => this._centerOnPlayer() }),
        h('button', { class: 'shell-map-zbtn', type: 'button', 'aria-label': t(TXT.hub), title: t(TXT.hub), html: icon('shell-hub', 18), onclick: () => this._panTo(0, -100, Math.max(this.view.vw, this.view.vh) / 2400) }),
      ),
      h('div', {
        class: 'shell-map-hint',
        text: touch
          ? t({ en: 'Pinch to zoom · Drag to pan · Tap the ground for a waypoint', nl: 'Knijp om te zoomen · Sleep om te verschuiven · Tik op de grond voor een markering' })
          : t({ en: 'Scroll to zoom · Drag to pan · Double-click the ground for a waypoint', nl: 'Scroll om te zoomen · Sleep om te verschuiven · Dubbelklik op de grond voor een markering' }),
      }),
      this.loadingNote,
    );

    // legend: here → travel → places → details
    this.hereEl = h('div', { class: 'shell-map-here' });
    this.travelEl = h('div', { class: 'shell-map-travelbox' });
    const list = h('div', { class: 'shell-legend-list scroll', role: 'listbox', 'aria-label': t({ en: 'Locations', nl: 'Locaties' }) });
    this._fillList(list, known);
    this.detail = h('div', { class: 'shell-map-detail' });
    this.actions = h('div', { class: 'shell-map-actions' });
    const legend = h(
      'aside',
      { class: 'shell-map-legend' },
      h(
        'div',
        { class: 'shell-map-legend-head' },
        h('h2', { class: 'shell-map-legend-title', text: t({ en: 'Legend', nl: 'Legenda' }) }),
        h('button', { class: 'modal-close', type: 'button', 'aria-label': t({ en: 'Close', nl: 'Sluiten' }), html: icon('close', 20), onclick: () => this.close() }),
      ),
      this.hereEl,
      this.travelEl,
      list,
      this.detail,
      this.actions,
    );

    this.el = h('div', { class: 'shell-map', role: 'dialog', 'aria-modal': 'true', 'aria-label': t(TXT.worldMap) }, stage, legend);
    this._renderHere();
    this._renderTravel();
    this._attachCanvas();
  }

  /** Legend list: your things, discovered wilderness POIs (nearest first), the hub's places. */
  _fillList(list, known) {
    const h = this.ctx.ui.h;
    const ctx = this.ctx;
    const f = this.frame.focus;
    const item = (sel, label, iconName, { unknown = false, region = false, meta = '', color = null, check = false } = {}) => {
      const key = selKey(sel);
      const el = h(
        'button',
        {
          class: `shell-legend-item${unknown ? ' is-unknown' : ''}${region ? ' is-region' : ''}`,
          type: 'button',
          role: 'option',
          dataset: { key },
          onclick: () => {
            uiSound(ctx, 'ui.click');
            this._select(sel, { pan: true });
          },
          onmouseenter: () => uiSound(ctx, 'ui.hover'),
        },
        h('span', { class: 'shell-legend-gem', style: color ? `--gem: ${color}` : null }, h('span', { html: icon(iconName, 16) })),
        h('span', { class: 'shell-legend-label', text: label }),
        meta ? h('span', { class: 'shell-legend-meta num', text: meta }) : h('span', { class: 'shell-legend-state', html: check ? icon('check', 14) : '' }),
      );
      this.legendItems.set(key, el);
      list.appendChild(el);
    };
    const head = (text) => list.appendChild(h('div', { class: 'shell-legend-head2', text: t(text) }));
    const w = this.wild;
    // yours
    const mine = [];
    const claim = w?.myClaim();
    if (claim) mine.push([{ kind: 'base', x: claim.x, z: claim.z }, t(TXT.base), 'shell-home', '#7fe0ff']);
    const bd = w?.bed?.();
    if (bd) mine.push([{ kind: 'bed', x: bd.x, z: bd.z }, t(TXT.bed), 'shell-bed', '#7fe0ff']);
    const bc = w?.beacon();
    if (bc) mine.push([{ kind: 'beacon', x: bc.x, z: bc.z }, t(TXT.beacon), 'shell-beacon', '#7fe0ff']);
    const drop = w?.deathDrop();
    if (drop) mine.push([{ kind: 'crate', x: drop.x, z: drop.z }, t(TXT.crate), 'shell-skull', '#f0b46a']);
    this._crateMeta = null;
    if (w?.waypoint) mine.push([{ kind: 'waypoint', x: w.waypoint.x, z: w.waypoint.z }, t(TXT.waypoint), 'shell-waypoint', '#ffd27a']);
    if (mine.length) {
      head(TXT.yours);
      for (const [sel, label, ic, color] of mine) {
        item(sel, label, ic, { meta: this._metaFor(sel), color });
        if (sel.kind === 'crate') this._crateMeta = this.legendItems.get(selKey(sel))?.querySelector('.shell-legend-meta') || null;
      }
    }
    // discovered wilderness POIs, nearest first
    if (w?.discovered?.size) {
      const pois = [...w.discovered.values()].map((p) => ({ p, d: Math.hypot(p.x - f.x, p.z - f.z) })).sort((a, b) => a.d - b.d).slice(0, 40);
      head(TXT.discovered);
      for (const { p, d } of pois) item({ kind: 'poi', id: p.id, x: p.x, z: p.z, type: p.type }, poiName(p), POI_STYLE[p.type]?.icon || 'pin', { meta: formatDistance(d), color: POI_STYLE[p.type]?.color });
    }
    // the hub's places
    head(TXT.places);
    for (const id of MAP_PLACES) {
      const p = place(id);
      if (!p) continue;
      const region = !!REGIONS[id];
      const isKnown = region || known.has(id) || id === 'city';
      item({ kind: 'place', id }, p.label, PLACE_ICONS[id] || 'pin', { unknown: !isKnown, region, check: !region && isKnown });
    }
  }

  /** Legend meta of your things: distance (+ the death crate's time left). */
  _metaFor(sel) {
    const f = this.frame.focus;
    const d = formatDistance(Math.hypot(sel.x - f.x, sel.z - f.z));
    const left = sel.kind === 'crate' ? this.wild?.deathDropLeft?.() : null;
    return left != null ? `${d} · ${formatWait(left)}` : d;
  }

  /** "Where am I" line at the top of the legend. */
  _renderHere() {
    if (!this.hereEl) return;
    const h = this.ctx.ui.h;
    const f = this.frame.focus;
    const inHub = this._inHub(f.x, f.z);
    const zone = this.shell.currentZone?.();
    let name;
    if (inHub) name = (zone && place(zone)?.label) || t(TXT.hub);
    else name = t(this.wild?.biome(f.x, f.z)?.name || TXT.wilderness);
    this.hereEl.replaceChildren(
      h('span', { class: `shell-map-here-chip${inHub ? ' is-safe' : ' is-wild'}`, html: icon(inHub ? 'shell-hub' : 'shell-compass-rose', 14) }),
      h('div', { class: 'shell-map-here-text' }, h('span', { class: 'shell-map-here-name', text: name }), h('small', { text: t(inHub ? TXT.safeZone : TXT.wilderness) })),
    );
  }

  /** Travel box: the hub Gateway inside the hub, "Return to hub" outside it. */
  _renderTravel() {
    if (!this.travelEl) return;
    const h = this.ctx.ui.h;
    const tr = this.travel;
    if (!tr) {
      this.travelEl.hidden = true;
      return;
    }
    const o = tr.options();
    const f = this.frame.focus;
    const inHub = this._inHub(f.x, f.z);
    const btn = (id, label, sub, iconName, opt, run) =>
      h(
        'button',
        {
          class: `shell-tbtn${opt.ok ? '' : ' is-off'}`,
          type: 'button',
          'aria-disabled': opt.ok ? 'false' : 'true',
          title: opt.ok ? t(label) : tr.reasonText(opt.reason, opt.wait),
          dataset: { travel: id },
          onclick: () => run(),
        },
        h('span', { class: 'shell-tbtn-icon', html: icon(iconName, 18) }),
        h('span', { class: 'shell-tbtn-text' }, h('span', { class: 'shell-tbtn-label', text: t(label) }), h('small', { text: opt.ok ? t(sub) : tr.reasonText(opt.reason, opt.wait) })),
      );
    const go = (to) => {
      if (tr.go(to)) this.close();
    };
    if (inHub) {
      const claim = this.wild?.myClaim();
      const bc = this.wild?.beacon();
      const far = (p) => (p ? { en: formatDistance(Math.hypot(p.x - f.x, p.z - f.z)), nl: formatDistance(Math.hypot(p.x - f.x, p.z - f.z)) } : TXT.base);
      this.travelEl.replaceChildren(
        h('div', { class: 'shell-map-travel-head' }, h('span', { html: icon('shell-gateway', 16) }), h('span', { text: t(TXT.gateway) }), h('small', { text: t(TXT.gatewaySub) })),
        h(
          'div',
          { class: 'shell-tbtns' },
          btn('wild', TXT.wild, TXT.wildSub, 'shell-shuffle', o.gateway.wild, () => go('wild')),
          btn('base', TXT.base, far(claim), 'shell-home', o.gateway.base, () => go('base')),
          btn('beacon', TXT.beacon, far(bc), 'shell-beacon', o.gateway.beacon, () => go('beacon')),
        ),
      );
    } else {
      this.travelEl.replaceChildren(h('div', { class: 'shell-tbtns is-one' }, btn('hub', TXT.returnHub, TXT.returnSub, 'shell-hub', o.hub, () => go('hub'))));
    }
    this.travelEl.hidden = false;
    this._travelSig = travelSig(o, inHub);
  }

  /**
   * Shows the best hub map available: the terrain preview at once (a private
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
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(this.view.vw * this.dpr);
    this.overlay.height = Math.round(this.view.vh * this.dpr);
    this._needOverlay = true;
  }

  _toScreen(x, z) {
    return toScreen(this.view, x, z, this._s);
  }

  /** Coalesces layout work into the next animation frame. */
  _requestLayout() {
    if (this._layoutRaf) return;
    this._layoutRaf = requestAnimationFrame(() => {
      this._layoutRaf = 0;
      this._layout();
    });
  }

  _layout() {
    if (!this.el) return;
    const v = this.view;
    clampCenter(v, CENTER_LIMIT);
    const ppm = v.ppm;
    // hub map images (each covers ±extent); hidden when the hub is out of view
    const b = viewBounds(v, 40);
    const hubVisible = b.x1 > -MAP_EXTENT && b.x0 < MAP_EXTENT && b.z1 > -MAP_EXTENT && b.z0 < MAP_EXTENT;
    for (const l of this._layers || []) {
      const size = 2 * l.extent * ppm;
      const [left, top] = this._toScreen(-l.extent, -l.extent);
      l.el.style.width = `${size}px`;
      l.el.style.height = `${size}px`;
      l.el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      l.el.hidden = !hubVisible;
    }
    // hub place pins, or one "Hub" pin when zoomed out
    const collapsed = ppm < HUB_PIN_PPM;
    for (const [, pin] of this.pins) {
      const hide = collapsed || (pin.region && ppm < 0.2);
      if (pin.hidden !== hide) {
        pin.hidden = hide;
        pin.el.hidden = hide;
      }
      if (hide) continue;
      const [x, y] = this._toScreen(pin.x, pin.z);
      pin.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }
    this.hubPin.hidden = !collapsed;
    if (collapsed) {
      const [x, y] = this._toScreen(0, 0);
      this.hubPin.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }
    this._layoutFrontier();
    this._layoutDynamic();
    this._layoutScale(ppm);
    this._needOverlay = true;
    this._drawOverlay();
    this.el.style.setProperty('--zoom', String(ppm));
  }

  /** Positions the cached frontier canvas for the current view (it is re-rendered in update()). */
  _layoutFrontier() {
    const L = this.layer;
    const c = L.canvas;
    if (!this.ctx.frontier?.minimap || !(L.version > 0) || !Number.isFinite(L.cx)) {
      c.style.visibility = 'hidden';
      return;
    }
    const v = this.view;
    const s = L.mpp * v.ppm * this.dpr; // canvas px → css px
    const [x, y] = this._toScreen(L.cx, L.cz);
    c.style.visibility = 'visible';
    c.style.width = `${L.w / this.dpr}px`;
    c.style.height = `${L.h / this.dpr}px`;
    c.style.transform = `translate3d(${x - L.w / this.dpr / 2}px, ${y - L.h / this.dpr / 2}px, 0) scale(${s / 1})`;
  }

  /** Dynamic pins: wilderness POIs, your things, waypoint; plus the player arrow and quest markers. */
  _layoutDynamic() {
    if (!this.el) return;
    const f = this.frame;
    const v = this.view;
    const [px, py] = this._toScreen(f.focus.x, f.focus.z);
    this.playerEl.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0)`;
    this.playerEl.firstChild.style.transform = `rotate(${-f.focusHeading}rad)`;
    this.playerEl.hidden = this.ctx.modes.is('space');
    // "You" next to the arrow only out in the wilderness (in the hub it would sit on a place's label)
    const youLabel = !this._inHub(f.focus.x, f.focus.z) || v.ppm < HUB_PIN_PPM;
    if (youLabel !== this._youLabel) {
      this._youLabel = youLabel;
      this.playerEl.classList.toggle('is-labelled', youLabel);
    }
    const b = viewBounds(v, 60);
    for (const d of this.dyn.values()) d.used = false;
    const w = this.wild;
    if (w) {
      // discovered wilderness POIs in view
      if (v.ppm > 0.05) {
        let n = 0;
        for (const p of w.discovered.values()) {
          if (p.x < b.x0 || p.x > b.x1 || p.z < b.z0 || p.z > b.z1) continue;
          if (++n > MAX_DYN) break;
          this._dynPin(`poi:${p.id}`, { kind: 'poi', id: p.id, x: p.x, z: p.z, type: p.type }, p.x, p.z, POI_STYLE[p.type]?.icon || 'pin', v.ppm > 0.18 ? poiName(p) : '', `is-poi is-${p.type}`);
        }
      }
      const claim = w.myClaim();
      if (claim) this._dynPin('base', { kind: 'base', x: claim.x, z: claim.z }, claim.x, claim.z, 'shell-home', t(TXT.base), 'is-home');
      const bc = w.beacon();
      if (bc && (!claim || Math.hypot(bc.x - claim.x, bc.z - claim.z) > 40 / v.ppm)) this._dynPin('beacon', { kind: 'beacon', x: bc.x, z: bc.z }, bc.x, bc.z, 'shell-beacon', v.ppm > 0.15 ? t(TXT.beacon) : '', 'is-home');
      const bd = w.bed?.();
      if (bd && (!claim || Math.hypot(bd.x - claim.x, bd.z - claim.z) > 40 / v.ppm)) this._dynPin('bed', { kind: 'bed', x: bd.x, z: bd.z }, bd.x, bd.z, 'shell-bed', v.ppm > 0.15 ? t(TXT.bed) : '', 'is-home');
      const drop = w.deathDrop();
      if (drop) this._dynPin('crate', { kind: 'crate', x: drop.x, z: drop.z }, drop.x, drop.z, 'shell-skull', t(TXT.crate), 'is-crate');
      if (w.waypoint) this._dynPin('waypoint', { kind: 'waypoint', x: w.waypoint.x, z: w.waypoint.z }, w.waypoint.x, w.waypoint.z, 'shell-waypoint', t(TXT.waypoint), 'is-waypoint');
    }
    // the hub Gateway ring (src/gateway) behind the Overlook
    const gw = this.ctx.gateway?.position;
    if (gw && v.ppm >= 1.4) this._dynPin('gateway', { kind: 'gateway', x: gw.x, z: gw.z }, gw.x, gw.z, 'shell-gateway', t(TXT.gateway), 'is-gateway');
    // boss markers (always: a world landmark) and loot caches (cleared POIs, while they last)
    for (let i = 0; i < f.count; i++) {
      const e = f.entries[i];
      const m = e.m;
      if (m.kind === 'boss') this._dynPin(`boss:${m.id}`, { kind: 'boss', id: m.id, x: e.x, z: e.z, label: t(m.label) }, e.x, e.z, 'shell-boss', t(m.label) || 'Boss', 'is-boss');
      else if (m.kind === 'loot' && v.ppm > 0.1) this._dynPin(`loot:${m.id}`, { kind: 'loot', id: m.id, x: e.x, z: e.z, label: t(m.label) }, e.x, e.z, m.icon || 'star', v.ppm > 0.3 ? t(m.label) : '', 'is-loot');
    }
    for (const [id, d] of this.dyn) {
      if (d.used) continue;
      d.el.remove();
      this.dyn.delete(id);
    }
    this._layoutQuests();
  }

  _dynPin(id, sel, x, z, iconName, label, cls) {
    let d = this.dyn.get(id);
    if (!d) {
      const h = this.ctx.ui.h;
      const lab = h('span', { class: 'shell-pin-label' });
      const el = h(
        'button',
        {
          class: `shell-pin is-dyn ${cls}`,
          type: 'button',
          onclick: (e) => {
            e.stopPropagation();
            this._select(d.sel, { pan: true });
          },
        },
        h('span', { class: 'shell-pin-gem' }, h('span', { class: 'shell-pin-icon', html: icon(iconName, 16) })),
        lab,
      );
      d = { el, lab, label: null, sel, used: true, x: NaN, y: NaN };
      this.dyn.set(id, d);
      this.dynLayer.appendChild(el);
    }
    d.sel = sel;
    d.used = true;
    if (d.label !== label) {
      d.label = label;
      d.lab.textContent = label;
      d.lab.hidden = !label;
      d.el.setAttribute('aria-label', label || iconName);
    }
    const [sx, sy] = this._toScreen(x, z);
    const rx = Math.round(sx);
    const ry = Math.round(sy);
    if (rx !== d.x || ry !== d.y) {
      d.x = rx;
      d.y = ry;
      d.el.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    }
    d.el.classList.toggle('is-selected', selKey(this.sel) === selKey(sel));
  }

  /** Quest markers (cyan; a quest target on a named place rings that pin instead). */
  _layoutQuests() {
    const f = this.frame;
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
      el.style.setProperty('--q', e.m.color || '#7fe0ff');
      let pinId = null;
      if (this.view.ppm >= HUB_PIN_PPM) {
        for (const [id, pin] of this.pins) {
          if (!pin.region && Math.abs(pin.x - e.x) < 34 && Math.abs(pin.z - e.z) < 34) {
            pinId = id;
            break;
          }
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

  // ------------------------------------------------------------ overlay
  /** Canvas overlay: safe zone + no-build ring, highways (+ names), waystones, claims, players. */
  _drawOverlay() {
    if (!this.el || !this._needOverlay) return;
    this._needOverlay = false;
    this._overlayAt = performance.now();
    const g = this.og;
    const v = this.view;
    const dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, v.vw, v.vh);
    const S = (x, z) => toScreen(v, x, z, this._s);
    const b = viewBounds(v, 80);
    const ppm = v.ppm;
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // safe zone + §11.2 no-build buffer
    const rect = (half) => {
      const [x0, y0] = S(-half, -half);
      return [x0, y0, 2 * half * ppm, 2 * half * ppm];
    };
    const nb = rect(HUB_HALF + NO_BUILD);
    if (ppm < 0.6) {
      g.save();
      g.setLineDash([4, 6]);
      g.strokeStyle = 'rgba(255, 170, 90, 0.5)';
      g.lineWidth = 1.2;
      g.strokeRect(nb[0], nb[1], nb[2], nb[3]);
      g.restore();
      this._edgeLabel(g, nb, t(TXT.noBuild), 'rgba(255, 196, 140, 0.85)');
    }
    const sz = rect(HUB_HALF);
    g.save();
    g.strokeStyle = 'rgba(127, 224, 255, 0.16)';
    g.lineWidth = 7;
    g.strokeRect(sz[0], sz[1], sz[2], sz[3]);
    g.setLineDash([9, 6]);
    g.strokeStyle = 'rgba(127, 224, 255, 0.95)';
    g.lineWidth = 1.6;
    g.strokeRect(sz[0], sz[1], sz[2], sz[3]);
    g.restore();
    this._edgeLabel(g, sz, t(TXT.safeZone), 'rgba(170, 236, 255, 0.95)');

    const wg = this.ctx.worldgen || this.ctx.frontier?.worldgen;
    // highway names (the roads themselves are painted by the frontier layer) + waystones
    if (wg?.highways && ppm > 0.035) {
      // names sit in the middle of each road's visible stretch OUTSIDE the hub + no-build ring (zoomed out,
      // the stretch nearest the view centre would pile every name onto the hub), and never on top of another
      const keepOut = HUB_HALF + NO_BUILD * 0.6;
      const placed = this._labelBoxes || (this._labelBoxes = []);
      placed.length = 0;
      const [hx, hy] = S(0, 0);
      placed.push(hx, hy); // the hub pin / "THE HUB" label
      for (const r of wg.highways) {
        const p = r.points;
        if (!p?.length) continue;
        let first = -1;
        let last = -1;
        for (let k = 0; k < p.length; k += 3 * 4) {
          const x = p[k];
          const z = p[k + 2];
          if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
          if (Math.abs(x) < keepOut && Math.abs(z) < keepOut) continue;
          if (first < 0) first = k;
          last = k;
        }
        if (ppm > 0.12) {
          for (const w of r.waystones || []) {
            if (w.x < b.x0 || w.x > b.x1 || w.z < b.z0 || w.z > b.z1) continue;
            const [x, y] = S(w.x, w.z);
            g.save();
            g.translate(x, y);
            g.rotate(Math.PI / 4);
            g.fillStyle = 'rgba(8, 18, 26, 0.9)';
            g.strokeStyle = '#5ff2ff';
            g.lineWidth = 1.4;
            g.shadowColor = 'rgba(95, 242, 255, 0.8)';
            g.shadowBlur = 6;
            g.fillRect(-3.5, -3.5, 7, 7);
            g.strokeRect(-3.5, -3.5, 7, 7);
            g.restore();
          }
        }
        if (first < 0 || ppm > 2) continue;
        // the middle of the visible stretch, snapped to a point index
        const best = first + Math.round((last - first) / 6) * 3;
        const [x, y] = S(p[best], p[best + 2]);
        let free = true;
        for (let i = 0; i < placed.length; i += 2) {
          if (Math.abs(placed[i] - x) < 110 && Math.abs(placed[i + 1] - y) < 34) {
            free = false;
            break;
          }
        }
        if (!free) continue;
        placed.push(x, y);
        const k2 = Math.min(p.length - 3, best + 3 * 3);
        const k1 = Math.max(0, best - 3 * 3);
        let ang = Math.atan2(p[k2 + 2] - p[k1 + 2], p[k2] - p[k1]);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        g.save();
        g.translate(x, y);
        g.rotate(ang);
        g.font = '500 11px Jost, system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const text = t(r.name).toUpperCase();
        g.lineWidth = 3.5;
        g.strokeStyle = 'rgba(8, 10, 14, 0.85)';
        g.letterSpacing = '2px';
        g.strokeText(text, 0, -9);
        g.fillStyle = 'rgba(244, 236, 216, 0.95)';
        g.fillText(text, 0, -9);
        g.restore();
      }
    }

    // undiscovered wilderness POIs: a dim "?" — something is out there (discovered ones are pins)
    if (this.wild && ppm > 0.07) {
      const r = Math.hypot(v.vw, v.vh) / 2 / ppm;
      const s = ppm > 0.2 ? 7 : 5.5;
      g.font = `600 ${ppm > 0.2 ? 10 : 8.5}px Jost, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const p of this.wild.poisNear(v.cx, v.cz, r, 'map')) {
        if (p.x < b.x0 || p.x > b.x1 || p.z < b.z0 || p.z > b.z1 || this.wild.isDiscovered(p.id)) continue;
        const [x, y] = S(p.x, p.z);
        g.fillStyle = 'rgba(10, 13, 19, 0.88)';
        g.strokeStyle = 'rgba(236, 230, 220, 0.6)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x, y - s);
        g.lineTo(x + s, y);
        g.lineTo(x, y + s);
        g.lineTo(x - s, y);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = 'rgba(244, 238, 226, 0.9)';
        g.fillText('?', x, y + 0.5);
      }
    }

    // claims
    const me = this.wild?.me?.();
    for (const c of this.wild?.claims?.() || []) {
      if (c.x < b.x0 - c.r || c.x > b.x1 + c.r || c.z < b.z0 - c.r || c.z > b.z1 + c.r) continue;
      const mine = me != null && c.owner === me;
      const [x, y] = S(c.x, c.z);
      const r = Math.max(3, c.r * ppm);
      const col = c.decay > 0 ? '150, 146, 140' : mine ? '127, 224, 255' : '255, 160, 80';
      g.fillStyle = `rgba(${col}, ${mine ? 0.2 : 0.14})`;
      g.strokeStyle = `rgba(${col}, 0.95)`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      g.stroke();
      if (!mine && c.name && ppm > 0.25) {
        g.font = '500 11px Jost, system-ui, sans-serif';
        g.textAlign = 'center';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(8, 10, 14, 0.85)';
        const text = t(TXT.claimOf, { name: c.name });
        g.strokeText(text, x, y + r + 12);
        g.fillStyle = 'rgba(255, 214, 170, 0.95)';
        g.fillText(text, x, y + r + 12);
      }
    }

    // other players (violet dots + names)
    const players = this.ctx.net?.players;
    if (players?.size) {
      g.font = '500 11px Jost, system-ui, sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      for (const pl of players.values()) {
        const pv = pl?.view?.p;
        if (!pv || pl.view.dead) continue;
        if (pv.x < b.x0 || pv.x > b.x1 || pv.z < b.z0 || pv.z > b.z1) continue;
        const [x, y] = S(pv.x, pv.z);
        g.fillStyle = '#c4a2ff';
        g.strokeStyle = 'rgba(8, 10, 16, 0.95)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, 4, 0, TAU);
        g.fill();
        g.stroke();
        const name = pl.name || pl.view?.name;
        if (name && ppm > 0.2) {
          g.lineWidth = 3;
          g.strokeText(name, x + 8, y);
          g.fillStyle = '#e4d6ff';
          g.fillText(name, x + 8, y);
        }
      }
    }
  }

  /** A small caps label on the top edge of a screen rectangle (if that edge is in view). */
  _edgeLabel(g, r, text, color) {
    const v = this.view;
    const y = r[1];
    if (y < 8 || y > v.vh - 8) return;
    const x = Math.max(r[0] + 60, Math.min(r[0] + r[2] - 60, v.vw / 2));
    if (r[2] < 140) return;
    g.save();
    g.font = '500 10.5px Jost, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.letterSpacing = '3px';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(8, 10, 14, 0.8)';
    const s = text.toUpperCase();
    g.strokeText(s, x, y - 4);
    g.fillStyle = color;
    g.fillText(s, x, y - 4);
    g.restore();
  }

  _layoutScale(ppm) {
    const len = niceLength(ppm, 190);
    const px = len * ppm;
    const label = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString(locale())} km` : `${m} m`);
    this.scaleEl.innerHTML = `<div class="shell-map-scale-bar" style="width:${Math.round(px)}px"><i></i><i></i><i></i></div>
      <div class="shell-map-scale-labels" style="width:${Math.round(px)}px"><span>0</span><span>${label(len / 2).replace(/ (m|km)$/, '')}</span><span>${label(len)}</span></div>`;
  }

  _zoomBy(factor, ax = null, ay = null) {
    zoomAround(this.view, factor, ax ?? this.view.vw / 2, ay ?? this.view.vh / 2, PPM_MIN, PPM_MAX);
    this._layout();
  }

  _centerOnPlayer() {
    const f = this.frame.focus;
    this._panTo(f.x, f.z, Math.max(this.view.ppm, this._inHub(f.x, f.z) ? 1.2 : 0.5));
  }

  /** Smooth pan (and optional zoom, in px per metre) to a world point. */
  _panTo(x, z, ppm = this.view.ppm) {
    const v = this.view;
    const from = { cx: v.cx, cz: v.cz, ppm: v.ppm };
    const to = Math.max(PPM_MIN, Math.min(PPM_MAX, ppm));
    const t0 = performance.now();
    const dur = 560;
    cancelAnimationFrame(this._panRaf);
    const step = () => {
      if (!this.el) return;
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      v.cx = from.cx + (x - from.cx) * e;
      v.cz = from.cz + (z - from.cz) * e;
      v.ppm = Math.exp(Math.log(from.ppm) + (Math.log(to) - Math.log(from.ppm)) * e);
      this._layout();
      if (k < 1) this._panRaf = requestAnimationFrame(step);
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
        this._zoomBy(Math.exp(-Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 240) * 0.0024), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    this._drag = null;
    this._onMove = (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this._drag.moved = true;
      this.view.cx = this._drag.cx - dx / this.view.ppm;
      this.view.cz = this._drag.cz - dy / this.view.ppm;
      this._requestLayout();
    };
    this._onUp = (e) => {
      const d = this._drag;
      if (d) vp.classList.remove('is-dragging');
      this._drag = null;
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerup', this._onUp);
      // a tap / click on empty ground selects that point (→ "Set waypoint")
      if (d && !d.moved && !d.multi && e && performance.now() - d.t < 600) {
        const r = vp.getBoundingClientRect();
        this._tapGround(e.clientX - r.left, e.clientY - r.top, false);
      }
    };
    vp.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.shell-pin')) return;
      this._drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false, multi: false, t: performance.now() };
      vp.classList.add('is-dragging');
      window.addEventListener('pointermove', this._onMove);
      window.addEventListener('pointerup', this._onUp);
    });
    vp.addEventListener('dblclick', (e) => {
      if (e.target.closest('.shell-pin')) return;
      const r = vp.getBoundingClientRect();
      this._tapGround(e.clientX - r.left, e.clientY - r.top, true);
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
        if (this._drag) this._drag.multi = true;
        this._onUp(null); // the pinch takes over from the one-finger pan
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
        if (g.d > 0) zoomAround(this.view, g.d / pinchD, g.x, g.y, PPM_MIN, PPM_MAX);
        pinchD = g.d;
        this._requestLayout();
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

  /** Click / tap on empty ground: select that point; double-click sets a waypoint right away. */
  _tapGround(sx, sy, setNow) {
    const [x, z] = toWorld(this.view, sx, sy, this._w);
    const w = this.wild;
    if (w?.waypoint && Math.hypot(w.waypoint.x - x, w.waypoint.z - z) * this.view.ppm < 14) {
      this._select({ kind: 'waypoint', x: w.waypoint.x, z: w.waypoint.z });
      return;
    }
    if (setNow && w) {
      w.setWaypoint(x, z);
      uiSound(this.ctx, 'ui.click');
      this._select({ kind: 'waypoint', x, z });
      return;
    }
    this._select({ kind: 'point', x, z });
  }

  // ------------------------------------------------------------ selection
  _canFastTravel(id) {
    if (!TRAVEL.includes(id) || !ZONES[id]) return false;
    if (!this.ctx.modes.is('explore', 'drive')) return false;
    const f = this.frame.focus;
    if (!this._inHub(f.x, f.z)) return false; // §11.2: from the wilderness only "Return to hub"
    if (this.travel?.channel) return false;
    return this.discovered().has(id);
  }

  _select(sel, { pan = false, zoom = null } = {}) {
    if (!sel || !this.el) return;
    if (sel.kind === 'place' && !place(sel.id)) return;
    this.sel = sel;
    const key = selKey(sel);
    for (const [pid, pin] of this.pins) pin.el.classList.toggle('is-selected', sel.kind === 'place' && pid === sel.id);
    this.hubPin.classList.toggle('is-selected', sel.kind === 'hub');
    for (const [k, item] of this.legendItems) {
      item.classList.toggle('is-selected', k === key);
      item.setAttribute('aria-selected', k === key ? 'true' : 'false');
    }
    this.legendItems.get(key)?.scrollIntoView?.({ block: 'nearest' });
    for (const d of this.dyn.values()) d.el.classList.toggle('is-selected', selKey(d.sel) === key);
    const pos = this._selPos(sel);
    if (pan && pos) {
      const want = zoom ?? (sel.kind === 'place' ? Math.max(this.view.ppm, REGIONS[sel.id] ? 0.7 : 1.1) : sel.kind === 'hub' ? this.view.ppm : Math.max(this.view.ppm, 0.35));
      this._panTo(pos.x, pos.z, want);
    }
    this._renderDetail();
  }

  _selPos(sel) {
    if (sel.kind === 'place') {
      const p = place(sel.id);
      return p ? { x: p.x, z: p.z } : null;
    }
    if (sel.kind === 'hub') return { x: 0, z: -100 };
    if (sel.kind === 'me') return { x: this.frame.focus.x, z: this.frame.focus.z };
    return Number.isFinite(sel.x) ? { x: sel.x, z: sel.z } : null;
  }

  _renderDetail() {
    const ctx = this.ctx;
    const h = ctx.ui.h;
    const sel = this.sel;
    const f = this.frame.focus;
    const pos = this._selPos(sel);
    const dist = pos ? Math.hypot(pos.x - f.x, pos.z - f.z) : 0;
    let name = '';
    let iconName = 'pin';
    let desc = '';
    let status = '';
    let known = true;
    const actions = [];
    const wpAction = () => {
      if (!pos || !this.wild) return;
      const w = this.wild.waypoint;
      const same = w && Math.hypot(w.x - pos.x, w.z - pos.z) < 20;
      actions.push(
        same
          ? { label: TXT.removeWaypoint, icon: 'close', run: () => (this.wild.clearWaypoint(), this._renderDetail(), this._layoutDynamic()) }
          : { label: TXT.setWaypoint, icon: 'shell-waypoint', run: () => (this.wild.setWaypoint(pos.x, pos.z), uiSound(ctx, 'ui.click'), this._select({ kind: 'waypoint', x: pos.x, z: pos.z })) },
      );
    };
    const area = () => (pos && !this._inHub(pos.x, pos.z) ? t(this.wild?.biome(pos.x, pos.z)?.name || TXT.wilderness) : t(TXT.safeZone));
    switch (sel.kind) {
      case 'place': {
        const p = place(sel.id);
        const region = !!REGIONS[sel.id];
        known = region || this.discovered().has(sel.id) || sel.id === 'city';
        name = p.label;
        iconName = PLACE_ICONS[sel.id] || 'pin';
        desc = known ? p.desc || '' : t({ en: 'Explore the hub to discover this location.', nl: 'Verken de hub om deze locatie te ontdekken.' });
        status = region ? t({ en: 'Region', nl: 'Regio' }) : known ? t({ en: 'Discovered', nl: 'Ontdekt' }) : t({ en: 'Not discovered yet', nl: 'Nog niet ontdekt' });
        if (!region && TRAVEL.includes(sel.id)) {
          const can = this._canFastTravel(sel.id);
          const here = this.shell.currentZone?.() === sel.id || dist < (p.radius || 30);
          const why = here
            ? t({ en: 'You are already here', nl: 'Je bent hier al' })
            : !this._inHub(f.x, f.z)
              ? t({ en: 'From the wilderness: Return to hub', nl: 'Vanuit de wildernis: terug naar de hub' })
              : !known
                ? t({ en: 'Discover this location first', nl: 'Ontdek deze locatie eerst' })
                : t({ en: 'Fast travel is not possible right now', nl: 'Snel reizen kan nu niet' });
          actions.push({ label: here && can ? TXT.youAreHere : TXT.fastTravel, icon: 'shell-fast', primary: true, disabled: !can || here, title: can && !here ? t({ en: 'Travel to {place}', nl: 'Reis naar {place}' }, { place: p.label }) : why, run: () => this._fastTravel(sel.id) });
        }
        wpAction();
        break;
      }
      case 'hub':
        name = t(TXT.hub);
        iconName = 'shell-hub';
        desc = t(TXT.hubDesc);
        status = t(TXT.safeZone);
        break;
      case 'gateway':
        name = t(TXT.gateway);
        iconName = 'shell-gateway';
        desc = t({ en: 'The Ø ring behind the Overlook: step up and press E for the wilderness, your base or your spawn beacon. From anywhere in the hub the buttons above do the same.', nl: 'De Ø-ring achter het uitzichtpunt: stap erop en druk op E voor de wildernis, je basis of je spawnbaken. Overal in de hub doen de knoppen hierboven hetzelfde.' });
        status = t(TXT.safeZone);
        wpAction();
        break;
      case 'me':
        name = t(TXT.youAreHere);
        iconName = 'shell-crosshair';
        desc = area();
        status = this._inHub(f.x, f.z) ? t(TXT.safeZone) : t(TXT.wilderness);
        break;
      case 'poi':
        name = poiName({ type: sel.type });
        iconName = POI_STYLE[sel.type]?.icon || 'pin';
        desc = t(TXT.poiDesc[sel.type] || TXT.poiDesc.ruin);
        status = `${t(TXT.discovered)} · ${area()}`;
        wpAction();
        break;
      case 'base':
        name = t(TXT.base);
        iconName = 'shell-home';
        desc = t(TXT.baseDesc);
        status = area();
        wpAction();
        break;
      case 'beacon':
        name = t(TXT.beacon);
        iconName = 'shell-beacon';
        desc = t(TXT.beaconDesc);
        status = area();
        wpAction();
        break;
      case 'bed':
        name = t(TXT.bed);
        iconName = 'shell-bed';
        desc = t(TXT.bedDesc);
        status = area();
        wpAction();
        break;
      case 'crate': {
        name = t(TXT.crate);
        iconName = 'shell-skull';
        desc = t(TXT.crateDesc);
        const left = this.wild?.deathDropLeft?.();
        status = left != null ? t({ en: 'Expires in {t}', nl: 'Verdwijnt over {t}' }, { t: formatWait(left) }) : area();
        wpAction();
        break;
      }
      case 'boss':
        name = sel.label || 'Boss';
        iconName = 'shell-boss';
        desc = t({ en: 'A powerful enemy. Bring friends.', nl: 'Een krachtige vijand. Neem vrienden mee.' });
        status = area();
        wpAction();
        break;
      case 'loot':
        name = sel.label || t({ en: 'Supply cache', nl: 'Voorraadkist' });
        iconName = 'star';
        desc = t({ en: 'Loot left behind after a fight. It won’t stay forever.', nl: 'Buit die na een gevecht is achtergebleven. Hij blijft niet eeuwig liggen.' });
        status = area();
        wpAction();
        break;
      case 'waypoint':
        name = t(TXT.waypoint);
        iconName = 'shell-waypoint';
        desc = t({ en: 'Shown on your compass and screen until you get there.', nl: 'Staat op je kompas en scherm tot je er bent.' });
        status = area();
        wpAction();
        break;
      default:
        name = t(TXT.point);
        iconName = 'shell-crosshair';
        desc = area();
        status = pos ? `${Math.round(pos.x)}, ${Math.round(-pos.z)}` : '';
        wpAction();
    }
    this.detail.replaceChildren(
      h('div', { class: 'shell-map-detail-name' }, h('span', { html: icon(iconName, 18) }), name),
      desc ? h('p', { class: 'shell-map-detail-desc', text: desc }) : null,
      h(
        'div',
        { class: 'shell-map-detail-meta' },
        h('span', { class: `shell-map-detail-status${known ? ' is-known' : ''}`, text: status }),
        ctx.modes.is('space') || sel.kind === 'me' || sel.kind === 'hub' ? null : h('span', { class: 'num', text: dist < 12 ? t(TXT.youAreHere) : formatDistance(dist) }),
      ),
    );
    this.actions.replaceChildren(
      ...actions.map((a) =>
        h(
          'button',
          {
            class: `shell-map-act${a.primary ? ' is-primary' : ''}`,
            type: 'button',
            disabled: a.disabled ? true : null,
            title: a.title || t(a.label),
            onclick: () => a.run(),
          },
          h('span', { html: icon(a.icon, 18) }),
          h('span', { class: 'shell-map-act-label', text: t(a.label) }),
        ),
      ),
    );
  }

  async _fastTravel(id) {
    if (!this._canFastTravel(id)) {
      uiSound(this.ctx, 'ui.error');
      return;
    }
    uiSound(this.ctx, 'ui.click');
    this.close();
    await this.shell.fastTravel(id);
  }

  /** Called every frame by the shell while the map is open. */
  update() {
    if (!this.el) return;
    const v = this.view;
    // the procedural planet: (re)paint the cached layer for the view (+20 % margin each side)
    const fr = this.ctx.frontier;
    if (fr?.minimap) {
      const b = viewBounds(v, 0);
      const wild = b.x0 < -MAP_EXTENT || b.x1 > MAP_EXTENT || b.z0 < -MAP_EXTENT || b.z1 > MAP_EXTENT;
      if (wild && this.layer.ensure(fr, v.cx, v.cz, 1 / (v.ppm * this.dpr), v.vw * 1.4 * this.dpr, v.vh * 1.4 * this.dpr, performance.now() / 1000)) this._layoutFrontier();
    }
    if (this._img || fr) this._layoutDynamic();
    // players move, claims change: refresh the overlay twice a second
    if (performance.now() - this._overlayAt > 500) {
      this._needOverlay = true;
      this._drawOverlay();
      const drop = this._crateMeta && this.wild?.deathDrop();
      if (drop) this._crateMeta.textContent = this._metaFor({ kind: 'crate', x: drop.x, z: drop.z });
      const o = this.travel?.options?.();
      const f = this.frame.focus;
      if (o && travelSig(o, this._inHub(f.x, f.z)) !== this._travelSig) this._renderTravel();
    }
  }
}

/** Selection → stable key (legend items, pins). */
function selKey(sel) {
  if (!sel) return '';
  if (sel.kind === 'place') return `place:${sel.id}`;
  if (sel.kind === 'poi') return `poi:${sel.id}`;
  if (sel.kind === 'boss') return `boss:${sel.id}`;
  if (sel.kind === 'loot') return `loot:${sel.id}`;
  if (sel.kind === 'point') return `point:${Math.round(sel.x)}:${Math.round(sel.z)}`;
  return sel.kind;
}

function travelSig(o, inHub) {
  const g = o.gateway;
  return `${inHub}|${g.wild.reason}|${g.base.reason}|${g.beacon.reason}|${o.hub.reason}|${o.hub.wait}`;
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
