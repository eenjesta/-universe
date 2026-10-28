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
import { createHoloMaterials, Ghost, ProjectedGrid } from './hologram.js';
import { createPlacement } from './placement.js';
import { createRegistry } from './structures.js';
import { createPower } from './power.js';
import { createHarvest } from './harvest.js';
import { createHud } from './hud.js';
import { registerBuildIcons } from './icons.js';

const BUILD_CAM = { distance: 6.4, height: 1.8, shoulder: 1.1, aimHeight: 0.5 };
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

  const power = createPower(ctx, reg, mats);
  let harvest = null;
  try {
    harvest = createHarvest(ctx, mats);
    scene.add(harvest.root);
  } catch (err) {
    console.error('[build] harvest nodes failed — continuing without them', err);
    ctx.errors.push({ module: 'build/harvest', error: String(err?.stack || err) });
  }
  progress(0.7);

  // ------------------------------------------------------------ selection
  const sel = { cat: 'structure', piece: 'foundation', rot: 0, last: {} };
  const isOwned = (def) => !def.unlock || !!state.get('settings.creative') || (state.get('owned.items') || []).includes(def.unlock);

  const hud = createHud(ctx, {
    selectCategory: (id) => selectCategory(id),
    selectPiece: (id) => selectPiece(id),
    isOwned,
  });

  function announce() {
    hud.setSelection(sel.cat, sel.piece);
    events.emit('build:select', { category: sel.cat, piece: sel.piece });
  }

  function select(categoryId, pieceId) {
    const def = pieceId ? PIECE[pieceId] : null;
    const cat = def ? def.category : CATEGORIES.some((c) => c.id === categoryId) ? categoryId : sel.cat;
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

  function applyCam(k) {
    const r = rig();
    if (!r) return;
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
  function enter(opts = {}) {
    if (api.active) return true;
    if (!modes.is('explore') || ctx.player?.onFoot === false) return false;
    if (framePending) framePlot();
    const piece = opts.piece || ctx.params.piece;
    if (piece && PIECE[piece]) selectPiece(String(piece));
    api.active = true;
    const r = rig();
    if (r) {
      if (!camOwned) {
        saved.shoulder = r.shoulder;
        saved.height = r.height;
        saved.aimHeight = r.aimHeight;
        saved.zoom = r._zoom ?? r.distance;
      }
      saved.zoomEnabled = camOwned ? saved.zoomEnabled : r.zoomEnabled;
      r.zoomEnabled = false;
      camOwned = true;
    }
    camTarget = 1;
    popEscape?.();
    popEscape = ui.pushEscape(() => exit());
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
    hud.setBuilding(false);
    ctx.audio?.play?.('ui.close');
    events.emit('build:mode', { active: false });
    return true;
  }

  const toggle = () => (api.active ? exit() : enter());

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
    state.set('structures', reg.serialize());
  }

  function commit(def, tg, { free = false } = {}) {
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
    return rec ? { ok: true, id: rec.id, x: rec.x, y: rec.y, z: rec.z, level: rec.level, variant: rec.variant } : { ok: false, reason: 'cost' };
  }

  function remove(id) {
    const rec = reg.remove(id, { animate: true });
    if (!rec) return null;
    const refund = state.get('settings.creative') ? {} : refundOf(rec.def.cost);
    state.gain(refund);
    persist();
    ctx.audio?.play?.('build.remove', { position: tmpV.set(rec.x, rec.y + 1, rec.z) });
    events.emit('build:removed', { piece: rec.type, category: rec.def.category, id: rec.id, position: { x: rec.x, y: rec.y, z: rec.z }, refund });
    return { id: rec.id, refund };
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
      for (let k = 0; k < CATEGORIES.length; k++) if (act(SLOTS[k][0], SLOTS[k][1])) selectCategory(CATEGORIES[k].id);
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
    if (tg.has) {
      ghost.setPiece(tg.info);
      ghost.setValid(tg.valid);
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
      hud.setCross(tg.valid, tg.valid ? t(def.name) : placement.reasonText(tg));
    } else {
      ghost.group.visible = false;
      grid.group.visible = false;
      hud.setCross(false, placement.reasonText({ reason: 'nothing' }));
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
    reg.load(state.get('structures'));
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
    remove,
    removeAimed,
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
    reload: () => reg.load(state.get('structures')),
    clear() {
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
