/**
 * Build module (Ø Universe) → ctx.build. Building, resources, harvesting.
 *
 * Build mode is an overlay inside 'explore' (the player keeps walking):
 * B toggles (ctx.build.enter/exit/toggle), crosshair aim at the screen centre,
 * 4 m grid with a projected glowing grid, cyan hologram ghost (red when
 * invalid), R rotate, wheel/Tab (Shift+Tab back) cycle pieces, 1–6
 * categories, click place, X / right-click remove (50 % refund), B / Esc exit.
 *
 * API (ctx.build):
 *   active, enter({piece}), exit(), toggle(), catalog (categories with pieces + cost),
 *   pieces (by id), selected {category, piece, rot}, select(categoryId, pieceId),
 *   selectCategory(id), selectPiece(id), cycle(dir), rotate(),
 *   place() (at the crosshair), placeAt(pieceId, {x, z, rot, free}) (programmatic,
 *   same snapping + validation), removeAimed(), remove(id), structures, count(),
 *   target {has, valid, reason, text, x, y, z, level, variant}, power {production,
 *   consumption, net, capacity, level, points}, level, nodes, harvestNode(i),
 *   reload(), clear()
 * Events: build:mode {active}, build:select {category, piece}, build:placed {piece,
 *   category, id, position, name, level}, build:removed {…, refund}, build:invalid
 *   {reason, text, piece}, build:level {level, prev, points}, harvest {resource,
 *   amount, source: 'node'}, power:change {production, consumption, net, capacity}.
 * State: state.structures [{id, type, x, y, z, rot, level, variant}] (rebuilt on load),
 *   resources via state.spend / state.gain (free in settings.creative), stats.built /
 *   stats.harvested.
 * URL: build=1 (core calls enter(); at the base the player is framed on the plot),
 *   piece=<id> (initial piece).
 *
 * Online / LocalServer (PLATFORM.md §7, wired by src/smp):
 *   setAuthority({ place(rec) → Promise<{ok, record | reason, text}>, remove(id) → Promise<{ok, reason, text}>,
 *     check?(target, def) → null | {reason, text}   (client-side prediction, e.g. someone else's claim),
 *     canEnter?() → null | text   (build mode refused here, e.g. inside the hub safe zone → toast),
 *     canRemove?(rec) → null | text, harvest?(node) → bool (sends C.HARVEST), me?: playerId })
 *   or setAuthority(null) (single-player: local state.structures + state.spend, unchanged).
 *   While an authority is set, placing/removing only asks it (the ghost waits as a hologram phantom; a denial
 *   turns the ghost red with the reason), structures come from the server through
 *   applyRemote({ add: [record], remove: [id], reset }) (record = {id, type|piece, x, y, z | p, rot, level,
 *   variant, owner, ownerName}), state.structures (the single-player save) is left untouched, power pieces
 *   don't add energy locally, creative mode is ignored and the 'survival' category (Workbench, Claim Beacon,
 *   Spawn Beacon) is shown. applyHarvest({node, by, res, respawnAt, mine}) mirrors S.HARVESTED.
 *   placeAtAsync(pieceId, opts) → Promise<{ok, id | reason}> (tests). targetRef = the live target (no allocation).
 *   setNodeSource({nodesNear(x, z, r)} | null) streams wilderness harvest nodes around the player (wildNodes).
 *   Extra events: build:remote {id, piece, owner} (someone else built), build:denied {reason, text, piece}.
 * Crosshair: piece name or the reason it can't go there; below it "X · Demolish <piece> · 50 % back" for the piece
 *   you aim at and may remove. Online the terrain shows the §11.2 rules overlay while building (ctx.frontier).
 * Files: catalog · geo · materials · pieces · hologram · placement · structures ·
 *   power · harvest · hud (+ build.css) · icons · dev/lab.
 */
import * as THREE from 'three';
import './build.css';
import { t } from '../core/i18n.js';
import { damp, dampAngle, lerp } from '../core/math.js';
import { ZONES } from '../world/layout.js';
import { ACTIONS } from '../core/input.js';
import { CATEGORIES, PIECE, piecesOf, refundOf, REACH } from './catalog.js';
import { createMaterials } from './materials.js';
import { normVariant, STATEFUL } from './pieces.js';
import { createHoloMaterials, Ghost, ProjectedGrid } from './hologram.js';
import { createPlacement } from './placement.js';
import { createRegistry } from './structures.js';
import { createPower } from './power.js';
import { createFireLights } from './firelight.js';
import { createHarvest } from './harvest.js';
import { createHud } from './hud.js';
import { registerBuildIcons } from './icons.js';

const BUILD_CAM = { distance: 6.4, height: 1.8, shoulder: 1.1, aimHeight: 0.5 };
/** Fallback texts for server denials without a translated `text` (src/smp passes its own). */
const DENY_TEXT = {
  demolish: { en: '{key}Demolish {name} · 50 % back', nl: '{key}{name} slopen · 50 % terug' },
  denied: { en: 'Not allowed here', nl: 'Hier niet toegestaan' },
  noBuild: { en: 'Safe zone', nl: 'Veilige zone' },
  claim: { en: 'This land is claimed', nl: 'Dit land is geclaimd' },
  owner: { en: 'Not your structure', nl: 'Niet jouw bouwwerk' },
  cost: { en: 'Not enough resources', nl: 'Niet genoeg grondstoffen' },
  offline: { en: 'No connection to the server', nl: 'Geen verbinding met de server' },
  timeout: { en: 'The server did not answer', nl: 'De server antwoordde niet' },
  reset: { en: 'World reloaded', nl: 'Wereld opnieuw geladen' },
  error: { en: 'Something went wrong', nl: 'Er ging iets mis' },
};
const SLOTS = CATEGORIES.map((c, k) => [`slot${k + 1}`, c.key || `Digit${k + 1}`]); // [action, key] per category

export async function install(ctx, { progress = () => {} } = {}) {
  const { state, events, loop, ui, input, modes } = ctx;
  const world = ctx.world;
  const scene = world?.scene;
  if (!scene) throw new Error('build: ctx.world.scene missing');
  registerBuildIcons();
  if (!Array.isArray(state.get('structures'))) state.set('structures', []);

  // ------------------------------------------------------------ scene parts
  const mats = createMaterials(ctx);
  const holo = createHoloMaterials(mats.U.uTime);
  const reg = createRegistry(ctx, mats, holo);
  scene.add(reg.root);
  const placement = createPlacement(ctx, reg);
  const ghost = new Ghost(holo);
  scene.add(ghost.group);
  const grid = new ProjectedGrid(world, mats.U.uTime);
  scene.add(grid.group);
  progress(0.25);

  const clearUnder = (rec) => {
    if (rec.level !== 0 || !world.vegetation?.clearArea) return;
    const bb = rec.info.bounds;
    const r = Math.hypot(Math.max(-bb.min.x, bb.max.x), Math.max(-bb.min.z, bb.max.z)) + 0.4;
    try {
      world.vegetation.clearArea(rec.x, rec.z, Math.min(r, 8));
    } catch {
      /* optional terrain helper */
    }
  };
  const restored = reg.load(state.get('structures'));
  for (const rec of reg.records.values()) clearUnder(rec);
  progress(0.45);

  const power = createPower(ctx, reg, mats, { accrue: () => !reg.authority });
  const fireLights = createFireLights(ctx, reg, mats);
  let harvest = null;
  try {
    harvest = createHarvest(ctx, mats, { authority: () => reg.authority });
    scene.add(harvest.root);
  } catch (err) {
    console.error('[build] harvest nodes failed — continuing without them', err);
    ctx.errors.push({ module: 'build/harvest', error: String(err?.stack || err) });
  }
  progress(0.7);

  // ------------------------------------------------------------ online authority (SMP)
  let authority = null;
  const pending = new Map(); // cid → { def, rec, slots, ghost, resolve }
  const pendingSlots = new Set();
  reg.pendingSlots = pendingSlots;
  const removing = new Set(); // ids I asked the server to remove
  const deny = { text: '', t: 0 };
  let cidSeq = 0;
  /** Creative mode only counts in single-player (the server owns the inventory online). */
  const creative = () => !authority && !!state.get('settings.creative');

  // ------------------------------------------------------------ selection
  const sel = { cat: 'structure', piece: 'foundation', rot: 0, last: {} };
  const isOwned = (def) => !def.unlock || creative() || (state.get('owned.items') || []).includes(def.unlock);
  const catVisible = (c) => !c.smp || !!authority;

  const hud = createHud(ctx, {
    selectCategory: (id) => selectCategory(id),
    selectPiece: (id) => selectPiece(id),
    isOwned,
    creative,
  });
  for (const c of CATEGORIES) if (c.smp) hud.setCategoryVisible(c.id, false);

  function announce() {
    hud.setSelection(sel.cat, sel.piece);
    events.emit('build:select', { category: sel.cat, piece: sel.piece });
  }

  function select(categoryId, pieceId) {
    let def = pieceId ? PIECE[pieceId] : null;
    if (def?.hidden) def = null;
    const catDef = CATEGORIES.find((c) => c.id === (def ? def.category : categoryId));
    if (catDef && !catVisible(catDef)) return api.selected;
    const cat = def ? def.category : catDef ? categoryId : sel.cat;
    const list = piecesOf(cat);
    const next = def && def.category === cat ? def : PIECE[sel.last[cat]] || list[0];
    if (!next) return api.selected;
    const changed = next.id !== sel.piece;
    sel.cat = cat;
    sel.piece = next.id;
    sel.last[cat] = next.id;
    if (changed && api.active) ctx.audio?.play?.('ui.click');
    announce();
    return api.selected;
  }
  const selectCategory = (id) => select(id, null);
  const selectPiece = (id) => select(null, id);

  function cycle(dir = 1) {
    const list = piecesOf(sel.cat);
    const i = list.findIndex((p) => p.id === sel.piece);
    const n = list[(i + (dir < 0 ? -1 : 1) + list.length) % list.length];
    return selectPiece(n.id);
  }

  function rotate(dir = 1) {
    sel.rot = (sel.rot + (dir < 0 ? 3 : 1)) % 4;
    ctx.audio?.play?.('ui.hover');
    return sel.rot;
  }

  // ------------------------------------------------------------ camera framing
  const rig = () => ctx.cameraRig;
  const saved = { shoulder: 0.44, height: 1.5, aimHeight: 0.34, zoom: 2.45, zoomEnabled: true };
  let camK = 0;
  let camTarget = 0;
  let camOwned = false;

  /** First person (fp-anim): the eye is the camera — never pull the third-person build framing over it. */
  const firstPerson = () => ctx.player?.view === 'first' || ctx.cameraRig?.view === 'first' || ctx.cameraRig?.firstPerson === true;

  function applyCam(k) {
    const r = rig();
    if (!r || firstPerson()) return;
    r.shoulder = lerp(saved.shoulder, BUILD_CAM.shoulder, k);
    r.height = lerp(saved.height, BUILD_CAM.height, k);
    r.aimHeight = lerp(saved.aimHeight, BUILD_CAM.aimHeight, k);
    r._zoom = lerp(saved.zoom, BUILD_CAM.distance, k);
  }

  // first entry from the URL hook / title card: frame the player on the plot
  let framePending = !!ctx.params.build;
  events.on('title:start', (p) => {
    if (p?.action === 'build') framePending = true;
  });
  function framePlot() {
    framePending = false;
    const pl = ctx.player;
    const B = ZONES.base;
    if (!pl?.position || !pl.teleport) return;
    if (Math.hypot(pl.position.x - B.x, pl.position.z - B.z) > 140) return;
    const BA = B.buildArea;
    const sx = BA.x + 7;
    const sz = BA.z - 6;
    const h = Math.atan2(-(B.house.x - sx), -(B.house.z - sz));
    pl.teleport({ x: sx, z: sz }, h);
    rig()?.setYaw?.(h, -0.3);
    rig()?.snap?.();
  }

  // ------------------------------------------------------------ enter / exit
  let popEscape = null;
  let enterDenyT = -10;
  function enter(opts = {}) {
    if (api.active) return true;
    if (!modes.is('explore') || ctx.player?.onFoot === false) return false;
    // online: the authority may refuse build mode here (the hub safe zone, PLATFORM.md §11)
    const why = authority?.canEnter?.();
    if (why) {
      if (ctx.loop.time - enterDenyT > 1.5) {
        enterDenyT = ctx.loop.time;
        ui.toast({ title: t(DENY_TEXT.noBuild), text: why, icon: 'bld-foundation', kind: 'warn', duration: 4200 });
        ctx.audio?.play?.('ui.error');
      }
      events.emit('build:denied', { reason: 'safe', text: why, piece: sel.piece });
      return false;
    }
    if (framePending) framePlot();
    const piece = opts.piece || ctx.params.piece;
    if (piece && PIECE[piece]) selectPiece(String(piece));
    api.active = true;
    const r = rig();
    if (r && !firstPerson()) {
      if (!camOwned) {
        saved.shoulder = r.shoulder;
        saved.height = r.height;
        saved.aimHeight = r.aimHeight;
        saved.zoom = r._zoom ?? r.distance;
      }
      saved.zoomEnabled = camOwned ? saved.zoomEnabled : r.zoomEnabled;
      r.zoomEnabled = false;
      camOwned = true;
    } else if (r) {
      // first person: keep the eye camera, only take the wheel (it cycles pieces while building)
      saved.zoomEnabled = r.zoomEnabled;
      r.zoomEnabled = false;
    }
    camTarget = 1;
    popEscape?.();
    popEscape = ui.pushEscape(() => exit());
    // §11.2: show where building is refused (hub buffer, highway corridors, POI clearance) on the frontier terrain
    if (authority) ctx.frontier?.setOverlay?.('rules');
    hud.setBuilding(true);
    announce();
    ctx.audio?.play?.('ui.open');
    events.emit('build:mode', { active: true });
    return true;
  }

  function exit({ instant = false } = {}) {
    if (!api.active) return false;
    api.active = false;
    popEscape?.();
    popEscape = null;
    camTarget = 0;
    const r = rig();
    if (r) r.zoomEnabled = saved.zoomEnabled !== false;
    if (instant) {
      if (camOwned) applyCam(0);
      camK = 0;
      camOwned = false;
    }
    ghost.group.visible = false;
    grid.group.visible = false;
    ctx.frontier?.setOverlay?.(null);
    hud.setBuilding(false);
    ctx.audio?.play?.('ui.close');
    events.emit('build:mode', { active: false });
    return true;
  }

  const toggle = () => (api.active ? exit() : enter());

  events.on('camera:mode', ({ mode } = {}) => {
    if (mode === 'first' && camOwned) {
      applyCamTo(0);
      camOwned = false;
      camK = 0;
    }
  });
  function applyCamTo(k) {
    const r = rig();
    if (!r) return;
    r.shoulder = lerp(saved.shoulder, BUILD_CAM.shoulder, k);
    r.height = lerp(saved.height, BUILD_CAM.height, k);
    r.aimHeight = lerp(saved.aimHeight, BUILD_CAM.aimHeight, k);
    r._zoom = lerp(saved.zoom, BUILD_CAM.distance, k);
  }

  events.on('mode:change', ({ to }) => {
    if (to !== 'explore') {
      if (api.active) exit({ instant: true });
      camOwned = false;
      camK = 0;
    }
  });

  // ------------------------------------------------------------ place / remove
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  const tmpV = new THREE.Vector3();

  function persist() {
    if (authority) return; // the server owns the world; keep the single-player save intact
    state.set('structures', reg.serialize());
  }

  function commit(def, tg, { free = false } = {}) {
    if (authority) return commitRemote(def, tg);
    if (!free && !state.spend(def.cost)) return null;
    const rec = reg.add({ type: def.id, x: tg.x, y: tg.y, z: tg.z, rot: tg.rot, level: tg.level, variant: tg.variant }, { animate: true });
    if (!rec) return null;
    clearUnder(rec);
    persist();
    state.add('stats.built', 1);
    ctx.audio?.play?.('build.place', { position: tmpV.set(rec.x, rec.y + 1, rec.z) });
    ctx.cameraRig?.shake?.(0.04);
    events.emit('build:placed', { piece: def.id, category: def.category, id: rec.id, position: { x: rec.x, y: rec.y, z: rec.z }, name: t(def.name), level: rec.level });
    return rec;
  }

  function invalid(tg, def) {
    const reason = tg?.has ? tg.reason : 'nothing';
    const text = tg?.has ? placement.reasonText(tg) : placement.reasonText({ reason: 'nothing' });
    events.emit('build:invalid', { reason, text, piece: def?.id });
    ctx.audio?.play?.('build.invalid');
    hud.flashInvalid();
    return null;
  }

  /** Places the selected piece at the current crosshair target. */
  function place() {
    const def = PIECE[sel.piece];
    const tg = placement.target;
    if (!tg.has || !tg.valid || tg.def !== def) return invalid(tg, def);
    return commit(def, tg);
  }

  /**
   * Programmatic placement (tests / integration) through the same snapping and
   * validation, as if aiming straight down at (x, z) from above the highest structure there
   * (or from just above storey `level` when given). opts: {rot, level, free, ignoreUnlock}
   */
  function placeAt(pieceId, { x, z, rot = 0, level = null, free = false, ignoreUnlock = false } = {}) {
    const def = PIECE[pieceId];
    if (!def || !Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: 'unknown' };
    const catDef = CATEGORIES.find((c) => c.id === def.category);
    if (catDef && !catVisible(catDef)) return { ok: false, reason: 'unknown' }; // survival pieces need a server
    let top = world.getHeightAt(x, z);
    if (level != null) {
      // start just above storey `level`: higher storeys are not considered
      top = top + 0.25 + level * 3.2 + 1.4;
      o.set(x, top, z);
    } else {
      for (const rec of reg.records.values()) if (Math.hypot(rec.x - x, rec.z - z) < 20) top = Math.max(top, rec.sphere.y + rec.sphere.r);
      top += 30;
    }
    o.set(x, top, z);
    d.set(0, -1, 0);
    const tg = placement.compute(def, ((rot | 0) % 4 + 4) % 4, o, d, { ignoreReach: true, maxT: 120, ignoreCost: free, ignoreUnlock });
    if (!tg.has || !tg.valid) {
      const res = { ok: false, reason: tg.has ? tg.reason : 'nothing', text: placement.reasonText(tg.has ? tg : { reason: 'nothing' }) };
      events.emit('build:invalid', { reason: res.reason, text: res.text, piece: def.id });
      return res;
    }
    const rec = commit(def, tg, { free });
    if (rec?.pending) return { ok: true, pending: true, cid: rec.cid, x: tg.x, y: tg.y, z: tg.z, level: tg.level, variant: tg.variant };
    return rec ? { ok: true, id: rec.id, x: rec.x, y: rec.y, z: rec.z, level: rec.level, variant: rec.variant } : { ok: false, reason: 'cost' };
  }

  /** placeAt that resolves once the server answered (single-player: at once). */
  function placeAtAsync(pieceId, opts = {}) {
    const res = placeAt(pieceId, opts);
    if (!res.pending) return Promise.resolve(res);
    const p = pending.get(res.cid);
    if (!p) return Promise.resolve(res);
    return new Promise((resolve) => (p.resolve = resolve));
  }

  // ------------------------------------------------------------ online: place / remove through the authority
  const phantoms = [];
  function takePhantom(tg) {
    let g = phantoms.find((x) => !x.busy);
    if (!g) {
      if (phantoms.length >= 6) return null;
      g = new Ghost(holo, { clone: true });
      scene.add(g.group);
      phantoms.push(g);
    }
    g.busy = true;
    g.setPiece(tg.info);
    g.setValid(true);
    g.setOpacity?.(0.75);
    g.group.position.set(tg.x, tg.y, tg.z);
    g.group.rotation.set(0, tg.rotY, 0);
    g.group.visible = true;
    return g;
  }
  function releasePhantom(g) {
    if (!g) return;
    g.busy = false;
    g.group.visible = false;
  }

  function commitRemote(def, tg) {
    const cid = `c${Date.now().toString(36)}${(++cidSeq).toString(36)}`;
    const rec = { piece: def.id, type: def.id, x: tg.x, y: tg.y, z: tg.z, rot: tg.rot, level: tg.level, variant: tg.variant };
    const slots = [...tg.layout.slots];
    for (const k of slots) pendingSlots.add(k);
    const p = { cid, def, rec, slots, ghost: takePhantom(tg), resolve: null };
    pending.set(cid, p);
    ctx.audio?.play?.('ui.click');
    let pr;
    try {
      pr = Promise.resolve(authority.place({ ...rec, cid }));
    } catch (err) {
      pr = Promise.reject(err);
    }
    pr.then(
      (res) => resolvePending(cid, res || { ok: false, reason: 'error' }),
      () => resolvePending(cid, { ok: false, reason: 'offline' }),
    );
    // never wait forever (lost reply)
    setTimeout(() => resolvePending(cid, { ok: false, reason: 'timeout' }), 8000);
    return { pending: true, cid };
  }

  function resolvePending(cid, res) {
    const p = pending.get(cid);
    if (!p) return;
    pending.delete(cid);
    for (const k of p.slots) pendingSlots.delete(k);
    releasePhantom(p.ghost);
    let out;
    if (res?.ok) {
      const rec = res.record ? ensureRecord(res.record, true) : null;
      if (rec) {
        state.add('stats.built', 1);
        try {
          ctx.player?.playAction?.('build');
        } catch {
          /* optional character action (fp-anim) */
        }
        ctx.audio?.play?.('build.place', { position: tmpV.set(rec.x, rec.y + 1, rec.z) });
        ctx.cameraRig?.shake?.(0.04);
        events.emit('build:placed', { piece: rec.type, category: rec.def.category, id: rec.id, position: { x: rec.x, y: rec.y, z: rec.z }, name: t(rec.def.name), level: rec.level, owner: rec.owner || null });
      }
      out = { ok: true, id: rec?.id || res.record?.id || null, x: rec?.x, y: rec?.y, z: rec?.z, level: rec?.level, variant: rec?.variant };
    } else {
      const text = denyFeedback(res?.reason, res?.text, p.def);
      out = { ok: false, reason: res?.reason || 'denied', text };
    }
    p.resolve?.(out);
  }

  /** The server said no: the ghost turns red with the reason for a moment. */
  function denyFeedback(reason, text, def) {
    const msg = text || t(DENY_TEXT[reason] || DENY_TEXT.denied);
    deny.text = msg;
    deny.t = 1.8;
    events.emit('build:invalid', { reason: reason || 'denied', text: msg, piece: def?.id, remote: true });
    events.emit('build:denied', { reason: reason || 'denied', text: msg, piece: def?.id });
    ctx.audio?.play?.('build.invalid');
    hud.flashInvalid();
    return msg;
  }

  function removeRemote(id) {
    const rec = reg.records.get(id);
    if (!rec || removing.has(id)) return null;
    const why = authority.canRemove?.(rec);
    if (why) {
      denyFeedback('owner', why, rec.def);
      return null;
    }
    removing.add(id);
    let pr;
    try {
      pr = Promise.resolve(authority.remove(id));
    } catch (err) {
      pr = Promise.reject(err);
    }
    pr.then(
      (res) => {
        if (res && res.ok === false) {
          removing.delete(id);
          denyFeedback(res.reason, res.text, rec.def);
        }
      },
      () => removing.delete(id),
    );
    setTimeout(() => removing.delete(id), 8000);
    return { id, pending: true };
  }

  /** Normalises a server record ({id, type|piece, x,y,z | p, rot, level, variant, owner, ownerName}). */
  function normRecord(r) {
    if (!r || typeof r !== 'object') return null;
    const type = r.type || r.piece;
    const p = Array.isArray(r.p) ? r.p : null;
    const x = Number(r.x ?? p?.[0]);
    const y = Number(r.y ?? p?.[1]);
    const z = Number(r.z ?? p?.[2]);
    if (!PIECE[type] || !r.id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    const level = r.level | 0;
    let variant = r.variant || (level === 0 ? 'ground' : 'raised');
    if (STATEFUL.has(type)) variant = normVariant(type, variant, !!r.open); // doors: open / closed
    return { id: String(r.id), type, x, y, z, rot: r.rot | 0, level, variant, open: !!r.open, owner: r.owner ?? null, ownerName: r.ownerName ?? r.name ?? null, tier: r.tier };
  }

  /** Adds (or refreshes) a record from the server; returns the registry record. */
  function ensureRecord(raw, animate) {
    const e = normRecord(raw);
    if (!e) return null;
    const ex = reg.records.get(e.id);
    let swap = false;
    if (ex) {
      const sameVariant = ex.variant === normVariant(e.type, e.variant, e.open);
      if (ex.type === e.type && Math.abs(ex.x - e.x) < 0.01 && Math.abs(ex.y - e.y) < 0.01 && Math.abs(ex.z - e.z) < 0.01 && ex.rot === e.rot && sameVariant) {
        ex.owner = e.owner;
        ex.ownerName = e.ownerName;
        return ex;
      }
      swap = ex.type === e.type && !sameVariant; // a door opened / closed: swap the model at once
      reg.remove(e.id); // changed (e.g. workbench upgraded): rebuild in place
    }
    const rec = reg.add(e, { animate: animate && !swap });
    if (rec) rec.open = !!e.open;
    if (swap && rec) {
      ctx.audio?.play?.(rec.open ? 'ui.open' : 'ui.close', { position: tmpV.set(rec.x, rec.y + 1.2, rec.z) });
      events.emit('build:state', { id: rec.id, piece: rec.type, open: rec.open });
    }
    if (rec) clearUnder(rec);
    return rec;
  }

  /** Server structures: { add: [record], remove: [id], reset: true (replace everything) }. */
  function applyRemote({ add = null, remove: rem = null, reset = false } = {}, { animate = true } = {}) {
    const me = authority?.me ?? ctx.net?.id ?? null;
    if (reset) {
      for (const id of [...pending.keys()]) resolvePending(id, { ok: false, reason: 'reset' });
      reg.clear();
      for (const raw of add || []) ensureRecord(raw, false);
      return reg.records.size;
    }
    for (const id of rem || []) {
      const rec = reg.records.get(String(id));
      if (!rec) continue;
      reg.remove(rec.id, { animate: true });
      const mine = removing.delete(rec.id);
      if (mine) ctx.audio?.play?.('build.remove', { position: tmpV.set(rec.x, rec.y + 1, rec.z) });
      events.emit('build:removed', { piece: rec.type, category: rec.def.category, id: rec.id, position: { x: rec.x, y: rec.y, z: rec.z }, refund: null, remote: !mine });
    }
    for (const raw of add || []) {
      const had = raw && reg.records.has(String(raw.id));
      const rec = ensureRecord(raw, animate);
      if (rec && !had && rec.owner !== me) events.emit('build:remote', { id: rec.id, piece: rec.type, owner: rec.owner, position: { x: rec.x, y: rec.y, z: rec.z } });
    }
    return reg.records.size;
  }

  function setAuthority(a) {
    const prev = authority;
    authority = a && typeof a.place === 'function' ? a : null;
    reg.authority = authority;
    api.authority = authority;
    for (const c of CATEGORIES) if (c.smp) hud.setCategoryVisible(c.id, !!authority);
    if (!authority) {
      for (const id of [...pending.keys()]) resolvePending(id, { ok: false, reason: 'offline' });
      removing.clear();
      if (sel.cat === 'survival') selectCategory('structure');
      if (prev) {
        // back to single-player: the local save again
        reg.load(state.get('structures'));
        for (const rec of reg.records.values()) clearUnder(rec);
      }
    }
    hud.refreshStrip(true);
    events.emit('build:authority', { online: !!authority });
    return api;
  }

  function remove(id) {
    if (authority) return removeRemote(id);
    const rec = reg.remove(id, { animate: true });
    if (!rec) return null;
    const refund = state.get('settings.creative') ? {} : refundOf(rec.def.cost);
    state.gain(refund);
    persist();
    ctx.audio?.play?.('build.remove', { position: tmpV.set(rec.x, rec.y + 1, rec.z) });
    events.emit('build:removed', { piece: rec.type, category: rec.def.category, id: rec.id, position: { x: rec.x, y: rec.y, z: rec.z }, refund });
    return { id: rec.id, refund };
  }

  /**
   * "X Demolish Wall · +50 %": the piece under the crosshair that you may remove (5 Hz; after the ghost's
   * own aim this frame, so the shared hit record is free again).
   */
  let demoAcc = 1;
  let demoText = '';
  function demolishHint(dt) {
    demoAcc += dt;
    if (demoAcc < 0.2) return demoText;
    demoAcc = 0;
    demoText = '';
    const cam = ctx.camera;
    cam.getWorldPosition(o);
    cam.getWorldDirection(d);
    const h = placement.aim(o, d, 40);
    const pl = ctx.player?.position;
    if (h.kind !== 'structure' || !h.rec?.def || (pl && Math.hypot(h.rec.x - pl.x, h.rec.z - pl.z) > REACH + 6)) return demoText;
    if (authority?.canRemove?.(h.rec)) return demoText; // someone else's piece / claim: no hint
    const key = ctx.device?.touch ? '' : 'X · ';
    demoText = t(DENY_TEXT.demolish, { key, name: t(h.rec.def.name) });
    return demoText;
  }

  /** Removes the placed piece under the crosshair (within reach). */
  function removeAimed() {
    const cam = ctx.camera;
    cam.getWorldPosition(o);
    cam.getWorldDirection(d);
    const h = placement.aim(o, d, 40);
    const pl = ctx.player?.position;
    if (h.kind !== 'structure' || !h.rec || (pl && Math.hypot(h.rec.x - pl.x, h.rec.z - pl.z) > REACH + 6)) {
      ctx.audio?.play?.('build.invalid');
      hud.flashInvalid();
      return null;
    }
    return remove(h.rec.id);
  }

  // ------------------------------------------------------------ per frame
  let wheelAcc = 0;
  /** Action from the core map when it exists (touch buttons feed it), else the raw key. */
  const act = (name, code) => (ACTIONS?.[name] ? input.actionPressed(name) : input.pressed(code));
  let ghostInit = false;
  const gpos = new THREE.Vector3();
  let gRot = 0;

  function frame(dt) {
    if (!modes.is('explore') || modes.transitioning) return;
    const on = input.gameEnabled;
    if (on && input.actionPressed('build')) toggle();
    if (!api.active) return;
    if (on) {
      // core action map (keyboard + on-screen touch controls): slot1–6, cycle, rotate, place, remove
      for (let k = 0; k < CATEGORIES.length; k++) if (catVisible(CATEGORIES[k]) && act(SLOTS[k][0], SLOTS[k][1])) selectCategory(CATEGORIES[k].id);
      if (act('cycle', 'Tab')) cycle(input.down('ShiftLeft') || input.down('ShiftRight') ? -1 : 1);
      const w = input.wheel;
      if (w) {
        wheelAcc += w;
        if (Math.abs(wheelAcc) >= 0.99) {
          cycle(Math.sign(wheelAcc));
          wheelAcc = 0;
        }
      }
      if (act('rotate', 'KeyR')) rotate(1);
    }
    // aim at the screen centre
    const cam = ctx.camera;
    cam.getWorldPosition(o);
    cam.getWorldDirection(d);
    const def = PIECE[sel.piece];
    const tg = placement.compute(def, sel.rot, o, d, { player: ctx.player?.position });
    if (deny.t > 0) deny.t -= dt;
    const denied = deny.t > 0;
    if (tg.has) {
      ghost.setPiece(tg.info);
      ghost.setValid(tg.valid && !denied);
      const jump = !ghostInit || gpos.distanceTo(tmpV.set(tg.x, tg.y, tg.z)) > 9;
      if (jump) {
        gpos.set(tg.x, tg.y, tg.z);
        gRot = tg.rotY;
      } else {
        gpos.x = damp(gpos.x, tg.x, 26, dt);
        gpos.y = damp(gpos.y, tg.y, 26, dt);
        gpos.z = damp(gpos.z, tg.z, 26, dt);
        gRot = dampAngle(gRot, tg.rotY, 20, dt);
      }
      ghostInit = true;
      ghost.group.position.copy(gpos);
      ghost.group.rotation.set(0, gRot, 0);
      ghost.group.visible = true;
      const cx = (tg.rect[0] + tg.rect[2]) / 2;
      const cz = (tg.rect[1] + tg.rect[3]) / 2;
      grid.update({ cx: tg.gridX, cz: tg.gridZ, flatY: tg.flatY, cursorX: cx, cursorZ: cz, rect: tg.rect, edge: tg.edge, valid: tg.valid });
      grid.group.visible = true;
      if (denied) hud.setCross(false, deny.text, demolishHint(dt));
      else hud.setCross(tg.valid, tg.valid ? t(def.name) : placement.reasonText(tg), demolishHint(dt));
    } else {
      ghost.group.visible = false;
      grid.group.visible = false;
      hud.setCross(false, placement.reasonText({ reason: 'nothing' }), demolishHint(dt));
    }
    if (on) {
      if (act('place', 'Mouse0')) place();
      if (act('remove', 'KeyX') || input.pressed('Mouse2')) removeAimed();
    }
  }

  loop.add(
    'build',
    (dt, time) => {
      mats.update(dt, time, world);
      reg.update(dt);
      fireLights.update(dt);
      harvest?.update(dt, time);
      frame(dt);
      // camera framing blend (after the rig update of this frame's mode)
      if (camOwned) {
        camK = damp(camK, camTarget, 6, dt);
        if (camTarget === 0 && camK < 0.01) {
          camK = 0;
          applyCam(0);
          camOwned = false;
        } else applyCam(camK);
      }
    },
    { order: 31 },
  );
  loop.add('build-power', (dt) => power.update(dt), { order: 41, when: () => !modes.is('title', 'boot') });
  loop.add(
    'build-hud',
    (dt) => {
      hud.update(dt);
      hud.setPower(power.state);
      hud.setBaseLevel(power.state.level);
    },
    { order: 93, pausable: false },
  );

  events.on('build:level', ({ level, prev }) => {
    if (level <= prev) return;
    ui.toast({
      title: t({ en: 'Base level {n}', nl: 'Basisniveau {n}' }, { n: level }),
      text: t({ en: 'Your base is growing.', nl: 'Je basis groeit.' }),
      icon: 'home',
      kind: 'reward',
      duration: 3200,
    });
    ctx.audio?.play?.('reward');
  });
  events.on('state:reset', () => {
    if (!authority) reg.load(state.get('structures'));
  });

  // ------------------------------------------------------------ public API
  const catalog = CATEGORIES.map((c) => ({
    id: c.id,
    key: c.key,
    icon: c.icon,
    name: c.name,
    label: t(c.name),
    pieces: piecesOf(c.id).map((p) => ({ ...p, label: t(p.name) })),
  }));

  const api = {
    active: false,
    catalog,
    pieces: PIECE,
    get selected() {
      return { category: sel.cat, piece: sel.piece, rot: sel.rot };
    },
    enter,
    exit,
    toggle,
    select,
    selectCategory,
    selectPiece,
    cycle,
    rotate,
    place,
    placeAt,
    placeAtAsync,
    remove,
    removeAimed,
    setAuthority,
    applyRemote,
    applyHarvest: (msg) => harvest?.applyHarvested?.(msg) ?? false,
    authority: null,
    get online() {
      return !!authority;
    },
    get pendingCount() {
      return pending.size;
    },
    targetRef: placement.target,
    get target() {
      const tg = placement.target;
      return { has: tg.has, valid: tg.valid, reason: tg.reason, text: tg.has && !tg.valid ? placement.reasonText(tg) : '', piece: tg.def?.id, x: tg.x, y: tg.y, z: tg.z, level: tg.level, variant: tg.variant, rot: tg.rot };
    },
    get structures() {
      return reg.serialize();
    },
    count: () => reg.records.size,
    power: power.state,
    get level() {
      return power.state.level;
    },
    nodes: harvest?.nodes || [],
    harvestNode: (i) => (harvest && harvest.nodes[i] ? harvest.harvest(harvest.nodes[i]) : null),
    /** Wilderness node source ({nodesNear(x, z, r)} from src/smp's world provider; null = none). */
    setNodeSource: (src) => harvest?.setSource?.(src),
    get wildNodes() {
      return harvest?.wnodes || [];
    },
    reload: () => (authority ? reg.records.size : reg.load(state.get('structures'))),
    clear() {
      if (authority) return; // the shared world is the server's
      reg.clear();
      persist();
    },
    registry: reg,
    placement,
    materials: mats,
  };
  select('structure', 'foundation');
  progress(1);
  console.log(`[build] installed: ${restored} structures restored, ${harvest?.nodes.length ?? 0} resource nodes`);
  return api;
}
