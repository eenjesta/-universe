/**
 * Ø Studio editor — the 'studio' mode (own scene + camera; leaving restores the world view).
 *
 * createEditor(ctx, { store, studio }) → mode object + editor API used by panels.js / dialogs.js:
 *   exp, byId, selection (Set of part ids), activeGroup, tool, snap, space, status
 *   load(exp, {draftId, cloudId}) · select(ids, {add, toggle}) · selectGroup(id, add) · selectAll() · clearSelection()
 *   insert(type | modelId, {clientX, clientY}?) · transact(label, fn, {coalesce}) · touch(id) · touchGroups() · touchSettings()
 *   setField(ids, key, value, coalesce) · setVec(id, key, axis, value) · undo() · redo() · copy() · paste() · duplicate()
 *   remove() · group() · ungroup() · renameGroup(id, name) · focusSelection() · setTool(t) · setSnap(m) · toggleSpace()
 *   save({manual}) · captureThumb(w, h) · play() · exit() · on(event, fn)   events: selection, structure, parts, history, status, settings
 *
 * Controls: right-drag look · WASD fly (Q/E down/up, Shift fast) · wheel dolly · middle-drag pan · F focus ·
 * click select (Shift add, Alt single part inside a model) · drag a part to slide it · drag empty space = box select ·
 * 1–4 tools (Select/Move/Rotate/Scale) · Ctrl+Z/Y · Ctrl+C/V/D · Ctrl+G/U · Del · Ctrl+S · F5/Ctrl+P play.
 * Touch (tablets): tap select, one-finger drag on empty space = look, two fingers = pan + pinch zoom.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { t } from '../core/i18n.js';
import { clonePart, normalizePart, newId, LIMITS, filterText } from './format.js';
import { MODELS } from './templates.js';
import { CollisionWorld, shapeFromPart } from './collide.js';
import { createStage, partMatrix } from './scene.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const UP = new THREE.Vector3(0, 1, 0);
const TXT = {
  saved: { en: 'Saved on this device', nl: 'Opgeslagen op dit apparaat' },
  savedCloud: { en: 'Saved to your account', nl: 'Opgeslagen in je account' },
  unsaved: { en: 'Unsaved changes', nl: 'Niet-opgeslagen wijzigingen' },
  saving: { en: 'Saving…', nl: 'Opslaan…' },
  full: { en: 'Device storage is full — publish or sign in to keep this', nl: 'Apparaatopslag is vol — publiceer of log in om dit te bewaren' },
  cloudFail: { en: 'Cloud save failed — kept on this device', nl: 'Opslaan in de cloud mislukt — bewaard op dit apparaat' },
  limit: { en: 'Part limit reached (5000)', nl: 'Limiet bereikt (5000 onderdelen)' },
  noSpawn: { en: 'Add a Spawn first — players start there.', nl: 'Voeg eerst een startpunt toe — spelers beginnen daar.' },
};

export function createEditor(ctx, { store, studio }) {
  const { input, ui } = ctx;
  const canvas = ctx.engine.renderer.domElement;
  const stage = createStage(ctx, { editor: true });
  const scene = stage.scene;
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);
  camera.position.set(0, 14, 26);
  const listeners = new Map();
  const emit = (name, data) => (listeners.get(name) || []).forEach((fn) => fn(data));

  // ---------------------------------------------------------------- state
  const ed = {
    scene,
    camera,
    stage,
    exp: null,
    byId: new Map(),
    shapes: new Map(),
    selection: new Set(),
    activeGroup: null,
    hover: null,
    tool: 'move',
    snap: 1, // metres (0 = off); rotation snaps 15° whenever snapping is on
    space: 'world',
    draftId: null,
    cloudId: null,
    status: { state: 'saved', text: '' },
    from: null,
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
      return () => listeners.set(name, listeners.get(name).filter((f) => f !== fn));
    },
  };
  const pick = new CollisionWorld(8);
  let yaw = 0;
  let pitch = -0.38;
  const camAnim = { t: 1, from: new THREE.Vector3(), to: new THREE.Vector3() };

  // ------------------------------------------------------------- helpers
  const parts = () => ed.exp.parts;
  const groupsById = () => new Map(ed.exp.groups.map((g) => [g.id, g]));
  function topGroupOf(part) {
    if (!part.group) return null;
    const gm = groupsById();
    let g = gm.get(part.group);
    while (g && g.parent && gm.get(g.parent)) g = gm.get(g.parent);
    return g || null;
  }
  function descendantParts(groupId) {
    const gm = groupsById();
    const inG = (gid) => {
      let g = gm.get(gid);
      while (g) {
        if (g.id === groupId) return true;
        g = g.parent ? gm.get(g.parent) : null;
      }
      return false;
    };
    return parts().filter((p) => p.group && inG(p.group));
  }
  ed.descendantParts = descendantParts;
  ed.topGroupOf = topGroupOf;

  function syncShape(p) {
    let s = ed.shapes.get(p.id);
    if (!s) {
      s = shapeFromPart(p);
      ed.shapes.set(p.id, s);
      pick.add(s);
    } else {
      shapeFromPart(p, s);
      pick.update(s);
    }
  }
  function dropShape(id) {
    const s = ed.shapes.get(id);
    if (s) pick.remove(s);
    ed.shapes.delete(id);
  }

  // --------------------------------------------------------------- load
  ed.load = (exp, { draftId = null, cloudId = null } = {}) => {
    ed.exp = exp;
    ed.draftId = draftId || newId('d');
    ed.cloudId = cloudId;
    ed.byId.clear();
    ed.shapes.clear();
    pick.clear();
    for (const p of exp.parts) {
      ed.byId.set(p.id, p);
      syncShape(p);
    }
    history.undo.length = 0;
    history.redo.length = 0;
    ed.selection.clear();
    ed.activeGroup = null;
    ed.hover = null;
    localDue = 0;
    cloudDue = 0;
    stage.applySettings(exp.settings);
    stage.parts.sync(exp.parts);
    stage.rebuildEnv();
    frameAll();
    gizmoRefresh();
    outlinesRefresh();
    setStatus('saved');
    emit('structure');
    emit('selection');
    emit('history');
    emit('settings');
  };

  /** Camera framing the whole build (diagonal view from the front-right, looking along −Z). */
  function frameAll() {
    const box = new THREE.Box3();
    for (const s of ed.shapes.values()) {
      if (s.maxX - s.minX > 200 || s.maxZ - s.minZ > 200) continue;
      box.expandByPoint(corner.set(s.minX, s.minY, s.minZ));
      box.expandByPoint(corner.set(s.maxX, s.maxY, s.maxZ));
    }
    if (box.isEmpty()) box.set(corner.set(-4, 0, -4), new THREE.Vector3(4, 2, 4));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    yaw = 0.62;
    pitch = -0.46;
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const dist = Math.max(16, Math.min(260, sphere.radius * 1.55));
    camera.position.copy(sphere.center).addScaledVector(dir, -dist);
    camAnim.t = 1;
  }
  ed.frameAll = frameAll;
  /** Puts the editor camera at `position` looking along yaw / pitch (radians; tests, bookmarks). */
  ed.setCamera = ({ position = null, yaw: y = yaw, pitch: p = pitch } = {}) => {
    if (position) camera.position.set(position[0], position[1], position[2]);
    yaw = y;
    pitch = Math.max(-1.55, Math.min(1.55, p));
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    camera.updateMatrixWorld();
    camAnim.t = 1;
  };

  // --------------------------------------------------------------- history
  const history = { undo: [], redo: [] };
  let tx = null;
  ed.history = history;
  /** Records part `id` before a mutation inside transact(). */
  ed.touch = (id) => {
    if (!tx || tx.parts.has(id)) return;
    const p = ed.byId.get(id);
    tx.parts.set(id, { before: p ? clonePart(p) : null, after: null });
  };
  ed.touchGroups = () => {
    if (tx && !tx.groups) tx.groups = { before: ed.exp.groups.map((g) => ({ ...g })), after: null };
  };
  ed.touchSettings = () => {
    if (tx && !tx.settings) tx.settings = { before: JSON.stringify({ meta: ed.exp.meta, settings: ed.exp.settings }), after: null };
  };
  /**
   * Runs fn() as one undoable step. Inside fn: ed.touch(id) before changing/removing a part,
   * addPart()/removePart() for structure, touchGroups()/touchSettings() before those edits.
   * opts.coalesce: a key; consecutive steps with the same key within 1.2 s merge (sliders, typing).
   */
  ed.transact = (label, fn, { coalesce = null } = {}) => {
    if (tx) {
      fn();
      return;
    }
    tx = { label, parts: new Map(), groups: null, settings: null, structure: false, coalesce, time: performance.now() };
    try {
      fn();
    } finally {
      const done = tx;
      tx = null;
      finishTx(done);
    }
  };
  function finishTx(done) {
    for (const [id, rec] of done.parts) {
      const p = ed.byId.get(id);
      rec.after = p ? clonePart(p) : null;
      if (!rec.before !== !rec.after || (rec.before && rec.after && (rec.before.type !== rec.after.type || rec.before.material !== rec.after.material || (rec.before.transparency > 0.001) !== (rec.after.transparency > 0.001) || rec.before.group !== rec.after.group))) done.structure = true;
    }
    if (done.groups) {
      done.groups.after = ed.exp.groups.map((g) => ({ ...g }));
      done.structure = true;
    }
    if (done.settings) done.settings.after = JSON.stringify({ meta: ed.exp.meta, settings: ed.exp.settings });
    const changed = done.parts.size || done.groups || (done.settings && done.settings.after !== done.settings.before);
    if (!changed) return;
    const top = history.undo[history.undo.length - 1];
    if (done.coalesce && top && top.coalesce === done.coalesce && done.time - top.time < 1200 && !done.structure && !top.structure) {
      for (const [id, rec] of done.parts) {
        const old = top.parts.get(id);
        if (old) old.after = rec.after;
        else top.parts.set(id, rec);
      }
      if (done.settings) top.settings = top.settings ? { before: top.settings.before, after: done.settings.after } : done.settings;
      top.time = done.time;
    } else {
      history.undo.push(done);
      if (history.undo.length > 200) history.undo.shift();
    }
    history.redo.length = 0;
    applyVisuals(done, false);
    emit('history');
  }
  function applyState(entry, dir) {
    const key = dir === 'undo' ? 'before' : 'after';
    for (const [id, rec] of entry.parts) {
      const target = rec[key];
      const cur = ed.byId.get(id);
      if (!target) {
        if (cur) {
          ed.exp.parts.splice(ed.exp.parts.indexOf(cur), 1);
          ed.byId.delete(id);
          dropShape(id);
          ed.selection.delete(id);
        }
      } else if (cur) {
        Object.assign(cur, clonePart(target));
        syncShape(cur);
      } else {
        const p = clonePart(target);
        ed.exp.parts.push(p);
        ed.byId.set(id, p);
        syncShape(p);
      }
    }
    if (entry.groups) ed.exp.groups = entry.groups[key].map((g) => ({ ...g }));
    if (entry.settings) {
      const s = JSON.parse(entry.settings[key]);
      ed.exp.meta = s.meta;
      ed.exp.settings = s.settings;
      stage.applySettings(ed.exp.settings);
      emit('settings');
    }
    applyVisuals(entry, true);
  }
  function applyVisuals(entry, structureAlways) {
    if (entry.structure || structureAlways) {
      stage.parts.sync(ed.exp.parts);
      emit('structure');
    } else {
      for (const id of entry.parts.keys()) {
        const p = ed.byId.get(id);
        if (p) {
          stage.parts.updatePart(p);
          syncShape(p);
        }
      }
      emit('parts', entry.parts);
    }
    if (entry.settings && !structureAlways) {
      stage.applySettings(ed.exp.settings);
      emit('settings');
    }
    for (const id of [...ed.selection]) if (!ed.byId.has(id)) ed.selection.delete(id);
    gizmoRefresh();
    outlinesRefresh();
    markDirty();
  }
  ed.undo = () => {
    const e = history.undo.pop();
    if (!e) return;
    applyState(e, 'undo');
    history.redo.push(e);
    emit('history');
    emit('selection');
  };
  ed.redo = () => {
    const e = history.redo.pop();
    if (!e) return;
    applyState(e, 'redo');
    history.undo.push(e);
    emit('history');
    emit('selection');
  };

  // structural helpers (inside transact)
  function addPart(raw) {
    if (ed.exp.parts.length >= LIMITS.parts) {
      ui.toast({ title: t(TXT.limit), kind: 'warn', icon: 'info' });
      return null;
    }
    const p = normalizePart(raw, ed.byId);
    ed.touch(p.id);
    ed.exp.parts.push(p);
    ed.byId.set(p.id, p);
    syncShape(p);
    return p;
  }
  function removePart(id) {
    const p = ed.byId.get(id);
    if (!p) return;
    ed.touch(id);
    ed.exp.parts.splice(ed.exp.parts.indexOf(p), 1);
    ed.byId.delete(id);
    dropShape(id);
    ed.selection.delete(id);
  }
  ed.addPart = addPart;
  ed.removePart = removePart;

  /** Sets a plain field on parts (one undo step; `coalesce` merges slider drags). */
  ed.setField = (ids, key, value, coalesce = null) => {
    ed.transact(`set ${key}`, () => {
      for (const id of ids) {
        const p = ed.byId.get(id);
        if (!p) continue;
        ed.touch(id);
        if (key.startsWith('props.')) {
          p.props = { ...p.props, [key.slice(6)]: value };
          const n = normalizePart(p);
          p.props = n.props;
        } else p[key] = value;
      }
    }, { coalesce: coalesce ? `${coalesce}:${ids.join(',')}` : null });
  };
  ed.setVec = (id, key, axis, value) => {
    const p = ed.byId.get(id);
    if (!p || !Number.isFinite(value)) return;
    ed.transact(`set ${key}`, () => {
      ed.touch(id);
      const v = [...p[key]];
      v[axis] = value;
      const n = normalizePart({ ...p, [key]: v });
      p[key] = n[key];
    }, { coalesce: `${key}${axis}:${id}` });
  };

  // ------------------------------------------------------------- status/save
  // Wall-clock deadlines (not frame time: slow devices still save on time). Local: 1.2 s after the
  // last edit; cloud (signed in): after 6 s without edits, retried after 30 s when it fails.
  let localDue = 0;
  let cloudDue = 0;
  let cloudBusy = false;
  const now = () => performance.now();
  function setStatus(state, text = null) {
    ed.status = { state, text: text ?? t(state === 'saved' ? (ed.cloudId && store.cloud.available() && !cloudDue ? TXT.savedCloud : TXT.saved) : state === 'saving' ? TXT.saving : TXT.unsaved) };
    emit('status', ed.status);
  }
  function markDirty() {
    localDue = now() + 1200;
    if (store.cloud.available()) cloudDue = now() + 6000;
    setStatus('dirty');
  }
  ed.markDirty = markDirty;
  /**
   * Saves the draft on this device now. manual: also to the account right away (with a thumbnail);
   * flush: send a pending cloud save now (leaving Studio); thumb: refresh the local thumbnail.
   */
  ed.save = async ({ manual = false, thumb = false, flush = false } = {}) => {
    if (!ed.exp) return;
    localDue = 0;
    const r = store.save(ed.draftId, ed.exp, { cloudId: ed.cloudId || null });
    if (thumb || manual) store.setThumb(ed.draftId, ed.captureThumb(320, 180));
    if (!r.ok) setStatus('error', t(TXT.full));
    else if (!cloudBusy) setStatus('saved');
    if (store.cloud.available() && (manual || (flush && cloudDue))) await cloudSave(manual);
  };
  let cloudPromise = null;
  /** Resolves once no cloud save is running (publish waits for it: no duplicate experiences). */
  ed.cloudIdle = () => cloudPromise || Promise.resolve();
  /** The account copy is current (after a publish that carried the data). */
  ed.markCloudSaved = () => {
    cloudDue = 0;
    setStatus('saved');
  };
  function cloudSave(withThumb) {
    if (cloudBusy) {
      cloudDue = now() + 1500; // try again once the running request is done
      return cloudPromise;
    }
    if (!store.cloud.available() || !ed.exp) return Promise.resolve();
    cloudPromise = cloudSaveNow(withThumb).finally(() => {
      cloudPromise = null;
    });
    return cloudPromise;
  }
  async function cloudSaveNow(withThumb) {
    if (cloudBusy) {
      cloudDue = now() + 1500; // try again once the running request is done
      return;
    }
    cloudBusy = true;
    cloudDue = 0;
    setStatus('saving');
    try {
      const thumbnail = withThumb ? ed.captureThumb(480, 270) : null;
      if (!ed.cloudId) {
        ed.cloudId = await store.cloud.create(ed.exp, thumbnail);
        store.update(ed.draftId, { cloudId: ed.cloudId });
      } else await store.cloud.save(ed.cloudId, ed.exp, thumbnail);
      setStatus(cloudDue ? 'dirty' : 'saved');
    } catch (err) {
      console.warn('[studio] cloud save failed', err);
      cloudDue = now() + 30000;
      setStatus('error', t(TXT.cloudFail));
    } finally {
      cloudBusy = false;
    }
  }
  ed.cloudSave = cloudSave;
  function autosave() {
    const tNow = now();
    if (localDue && tNow >= localDue) ed.save();
    if (cloudDue && tNow >= cloudDue && !cloudBusy && store.cloud.available()) cloudSave(false);
  }

  // -------------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitTmp = {};
  function setRay(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray;
  }
  /** First part under a screen point → { part, point, normal } | null (pass `out` to reuse an object). */
  ed.pickAt = (clientX, clientY, out = null) => {
    const r = setRay(clientX, clientY);
    const h = pick.raycast(r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z, 5000, null, hitTmp);
    if (!h) return null;
    const o = out || { part: null, point: new THREE.Vector3(), normal: new THREE.Vector3() };
    o.part = h.shape.part;
    o.point.set(h.x, h.y, h.z);
    o.normal.set(h.nx, h.ny, h.nz);
    return o;
  };
  const hoverHit = { part: null, point: new THREE.Vector3(), normal: new THREE.Vector3() };
  /** Surface point under a screen point (parts, else the ground plane y = 0). */
  function surfaceAt(clientX, clientY) {
    const hit = ed.pickAt(clientX, clientY);
    if (hit) return hit;
    const r = ray.ray;
    if (r.direction.y < -1e-4) {
      const tt = -r.origin.y / r.direction.y;
      if (tt < 4000) return { part: null, point: r.at(tt, new THREE.Vector3()), normal: UP.clone() };
    }
    return { part: null, point: r.at(30, new THREE.Vector3()).setY(0), normal: UP.clone() };
  }
  /** Centre of the visible viewport (between the side panels). */
  function viewCenter() {
    const r = canvas.getBoundingClientRect();
    const left = document.querySelector('.studio-left:not([hidden])')?.getBoundingClientRect();
    const right = document.querySelector('.studio-right:not([hidden])')?.getBoundingClientRect();
    const x0 = left && left.width && left.right < r.width * 0.5 ? left.right : r.left;
    const x1 = right && right.width && right.left > r.width * 0.5 ? right.left : r.right;
    return { x: (x0 + x1) / 2, y: r.top + r.height * 0.55 };
  }
  const snapV = (v, step) => (step > 0 ? Math.round(v / step) * step : Math.round(v * 100) / 100);

  // --------------------------------------------------------------- insert
  ed.insert = (what, at = null) => {
    if (!ed.exp) return;
    const pt = at || viewCenter();
    const surf = surfaceAt(pt.x, pt.y);
    const step = ed.snap || 0.25;
    const model = MODELS.find((m) => m.id === what);
    let created = [];
    ed.transact(`insert ${what}`, () => {
      if (model) {
        const specs = model.make();
        const gid = newId('g', new Set(ed.exp.groups.map((g) => g.id)));
        ed.touchGroups();
        ed.exp.groups.push({ id: gid, name: filterText(t(model.name), LIMITS.name), parent: null });
        const ox = snapV(surf.point.x, step);
        const oz = snapV(surf.point.z, step);
        const oy = Math.max(0, surf.point.y);
        for (const s of specs) {
          const p = addPart({ ...s, p: [s.p[0] + ox, s.p[1] + oy, s.p[2] + oz], group: gid, name: s.name });
          if (p) created.push(p);
        }
      } else {
        const p = addPart({ type: what });
        if (!p) return;
        p.name = t({ block: { en: 'Block', nl: 'Blok' }, wedge: { en: 'Wedge', nl: 'Wig' }, cylinder: { en: 'Cylinder', nl: 'Cilinder' }, sphere: { en: 'Sphere', nl: 'Bol' }, cone: { en: 'Cone', nl: 'Kegel' }, spawn: { en: 'Spawn', nl: 'Startpunt' }, light: { en: 'Light', nl: 'Lamp' }, text: { en: 'Sign', nl: 'Bord' } }[what] || 'Part');
        if (what === 'text') p.props = { ...p.props, text: t({ en: 'HELLO', nl: 'HALLO' }) };
        const n = surf.normal;
        const pos = surf.point.clone();
        if (n.y > 0.5) pos.y += p.s[1] / 2;
        else pos.addScaledVector(n, Math.abs(n.x) * p.s[0] / 2 + Math.abs(n.z) * p.s[2] / 2 + Math.abs(n.y) * p.s[1] / 2);
        // face the camera (signs, wedges)
        const camYaw = Math.round((yaw * R2D) / 90) * 90;
        if (what === 'text' || what === 'wedge') p.r = [0, (((camYaw + 180) % 360) + 540) % 360 - 180, 0]; // front (−Z) towards the camera
        p.p = [snapV(pos.x, step), snapV(pos.y, ed.snap ? Math.min(step, 0.5) : 0.05), snapV(pos.z, step)];
        if (n.y > 0.5) p.p[1] = Math.round((surf.point.y + p.s[1] / 2) * 1000) / 1000;
        if (what === 'light') p.p[1] = Math.max(p.p[1], surf.point.y + 2.5);
        created.push(p);
      }
    });
    if (created.length) {
      if (model && created[0].group) ed.selectGroup(created[0].group); // the new model as one item (explorer row + name)
      else ed.select(created.map((p) => p.id));
      ctx.audio?.play?.('build.place', { volume: 0.5 });
    }
    return created;
  };

  // ------------------------------------------------------------ selection
  ed.select = (ids, { add = false, toggle = false } = {}) => {
    if (!add && !toggle) ed.selection.clear();
    for (const id of ids) {
      if (!ed.byId.has(id)) continue;
      if (toggle && ed.selection.has(id)) ed.selection.delete(id);
      else ed.selection.add(id);
    }
    ed.activeGroup = null;
    selectionChanged();
  };
  ed.selectGroup = (gid, add = false) => {
    const ids = descendantParts(gid).map((p) => p.id);
    if (!add) ed.selection.clear();
    ids.forEach((id) => ed.selection.add(id));
    ed.activeGroup = gid;
    selectionChanged();
  };
  ed.selectAll = () => ed.select(parts().map((p) => p.id));
  ed.clearSelection = () => {
    if (!ed.selection.size && !ed.activeGroup) return;
    ed.selection.clear();
    ed.activeGroup = null;
    selectionChanged();
  };
  function selectionChanged() {
    gizmoRefresh();
    outlinesRefresh();
    emit('selection');
  }
  ed.selected = () => [...ed.selection].map((id) => ed.byId.get(id)).filter(Boolean);

  // ---------------------------------------------------------------- outlines
  const MAX_OUT = 600;
  const outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_OUT * 24 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const outMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.16, 0.72, 1.15), transparent: true, opacity: 0.95, depthTest: false });
  const outlines = new THREE.LineSegments(outGeo, outMat);
  outlines.frustumCulled = false;
  outlines.renderOrder = 20;
  scene.add(outlines);
  const hovGeo = new THREE.BufferGeometry();
  hovGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const hovMat = new THREE.LineBasicMaterial({ color: 0xece6dc, transparent: true, opacity: 0.45, depthTest: false });
  const hoverLines = new THREE.LineSegments(hovGeo, hovMat);
  hoverLines.frustumCulled = false;
  hoverLines.renderOrder = 19;
  scene.add(hoverLines);
  const EDGES = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  const corner = new THREE.Vector3();
  const cm = new THREE.Matrix4();
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  function writeBox(arr, offset, p, pad) {
    partMatrix({ ...p, s: [p.s[0] + pad, p.s[1] + pad, p.s[2] + pad] }, cm);
    for (let i = 0; i < 8; i++) corners[i].set(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5).applyMatrix4(cm);
    for (let e = 0; e < 24; e++) {
      const c = corners[EDGES[e]];
      arr[offset + e * 3] = c.x;
      arr[offset + e * 3 + 1] = c.y;
      arr[offset + e * 3 + 2] = c.z;
    }
  }
  function outlinesRefresh() {
    const arr = outGeo.attributes.position.array;
    let n = 0;
    for (const id of ed.selection) {
      if (n >= MAX_OUT) break;
      const p = ed.byId.get(id);
      if (!p) continue;
      writeBox(arr, n * 72, p, 0.06);
      n++;
    }
    outGeo.setDrawRange(0, n * 24);
    outGeo.attributes.position.needsUpdate = true;
    outlines.visible = n > 0;
    hoverRefresh();
  }
  function hoverRefresh() {
    const p = ed.hover && !ed.selection.has(ed.hover) ? ed.byId.get(ed.hover) : null;
    hoverLines.visible = !!p;
    if (!p) return;
    writeBox(hovGeo.attributes.position.array, 0, p, 0.04);
    hovGeo.attributes.position.needsUpdate = true;
  }
  ed.refreshOutlines = outlinesRefresh;

  // ----------------------------------------------------------------- gizmo
  const pivot = new THREE.Object3D();
  scene.add(pivot);
  const gizmo = new TransformControls(camera, canvas);
  gizmo.setSize(0.95);
  const helper = gizmo.getHelper();
  scene.add(helper);
  let gStart = null;
  function selectionBounds(out = new THREE.Box3()) {
    out.makeEmpty();
    for (const id of ed.selection) {
      const s = ed.shapes.get(id);
      if (!s) continue;
      out.expandByPoint(corner.set(s.minX, s.minY, s.minZ));
      out.expandByPoint(corner.set(s.maxX, s.maxY, s.maxZ));
    }
    return out;
  }
  ed.selectionBounds = selectionBounds;
  function gizmoRefresh() {
    const sel = ed.selected();
    const on = ed.exp && sel.length && ed.tool !== 'select' && ctx.modes.is('studio');
    if (!on) {
      if (gizmo.object) gizmo.detach();
      helper.visible = false;
      return;
    }
    if (gizmo.dragging) return;
    const box = selectionBounds();
    const single = sel.length === 1 ? sel[0] : null;
    if (single) pivot.position.set(single.p[0], single.p[1], single.p[2]);
    else box.getCenter(pivot.position);
    if (single && (ed.space === 'local' || ed.tool === 'scale')) {
      pivot.quaternion.setFromEuler(new THREE.Euler(single.r[0] * D2R, single.r[1] * D2R, single.r[2] * D2R, 'YXZ'));
    } else pivot.quaternion.identity();
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
    gizmo.setMode(ed.tool === 'move' ? 'translate' : ed.tool === 'rotate' ? 'rotate' : 'scale');
    gizmo.setSpace(ed.tool === 'scale' ? 'local' : ed.space);
    gizmo.setTranslationSnap(ed.snap > 0 ? ed.snap : null);
    gizmo.setRotationSnap(ed.snap > 0 ? 15 * D2R : null);
    gizmo.setScaleSnap(null);
    if (gizmo.object !== pivot) gizmo.attach(pivot);
    helper.visible = true;
  }
  ed.refreshGizmo = gizmoRefresh;
  const _dq = new THREE.Quaternion();
  const _pq = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _v = new THREE.Vector3();
  const _rm = new THREE.Matrix4();
  gizmo.addEventListener('mouseDown', () => {
    gStart = {
      pos: pivot.position.clone(),
      quat: pivot.quaternion.clone(),
      parts: ed.selected().map((p) => ({ p, start: clonePart(p) })),
    };
    tx = { label: 'transform', parts: new Map(), groups: null, settings: null, structure: false, coalesce: null, time: performance.now() };
    for (const { p } of gStart.parts) ed.touch(p.id);
  });
  gizmo.addEventListener('objectChange', () => {
    if (!gStart) return;
    const mode = gizmo.getMode();
    const step = ed.snap || 0;
    if (mode === 'translate') {
      _v.subVectors(pivot.position, gStart.pos);
      for (const { p, start } of gStart.parts) p.p = [round3(start.p[0] + _v.x), round3(start.p[1] + _v.y), round3(start.p[2] + _v.z)];
    } else if (mode === 'rotate') {
      _dq.copy(pivot.quaternion).multiply(_pq.copy(gStart.quat).invert());
      for (const { p, start } of gStart.parts) {
        _v.set(start.p[0] - gStart.pos.x, start.p[1] - gStart.pos.y, start.p[2] - gStart.pos.z).applyQuaternion(_dq).add(gStart.pos);
        p.p = [round3(_v.x), round3(_v.y), round3(_v.z)];
        _pq.setFromEuler(_e.set(start.r[0] * D2R, start.r[1] * D2R, start.r[2] * D2R, 'YXZ')).premultiply(_dq);
        _e.setFromQuaternion(_pq, 'YXZ');
        p.r = [round2(_e.x * R2D), round2(_e.y * R2D), round2(_e.z * R2D)];
      }
    } else {
      const k = pivot.scale;
      const single = gStart.parts.length === 1;
      for (const { p, start } of gStart.parts) {
        if (single) {
          p.s = [sizeSnap(start.s[0] * Math.abs(k.x), step), sizeSnap(start.s[1] * Math.abs(k.y), step), sizeSnap(start.s[2] * Math.abs(k.z), step)];
        } else {
          // world-axis scale about the pivot; sizes map world factors onto each part's local axes
          p.p = [round3(gStart.pos.x + (start.p[0] - gStart.pos.x) * k.x), round3(gStart.pos.y + (start.p[1] - gStart.pos.y) * k.y), round3(gStart.pos.z + (start.p[2] - gStart.pos.z) * k.z)];
          _rm.makeRotationFromEuler(_e.set(start.r[0] * D2R, start.r[1] * D2R, start.r[2] * D2R, 'YXZ'));
          const m = _rm.elements;
          const f = [0, 1, 2].map((i) => Math.abs(m[i * 4]) * Math.abs(k.x) + Math.abs(m[i * 4 + 1]) * Math.abs(k.y) + Math.abs(m[i * 4 + 2]) * Math.abs(k.z));
          p.s = [sizeSnap(start.s[0] * f[0], step), sizeSnap(start.s[1] * f[1], step), sizeSnap(start.s[2] * f[2], step)];
        }
      }
    }
    for (const { p } of gStart.parts) {
      stage.parts.updatePart(p);
      syncShape(p);
    }
    outlinesRefresh();
    emit('parts');
  });
  gizmo.addEventListener('mouseUp', () => {
    if (!gStart) return;
    gStart = null;
    const done = tx;
    tx = null;
    if (done) finishTx(done);
    gizmoRefresh();
    emit('selection');
  });
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const round2 = (v) => Math.round(v * 100) / 100;
  const sizeSnap = (v, step) => Math.max(step > 0 ? step / 2 : LIMITS.minSize, step > 0 ? Math.round(v / (step / 2)) * (step / 2) : round3(v));

  ed.setTool = (tool) => {
    ed.tool = tool;
    gizmoRefresh();
    emit('tool');
  };
  ed.setSnap = (v) => {
    ed.snap = v;
    gizmoRefresh();
    emit('tool');
  };
  ed.toggleSpace = () => {
    ed.space = ed.space === 'world' ? 'local' : 'world';
    gizmoRefresh();
    emit('tool');
  };

  // -------------------------------------------------- clipboard / edit ops
  let clip = null;
  ed.copy = () => {
    const sel = ed.selected();
    if (!sel.length) return false;
    const gm = groupsById();
    const gs = new Map();
    for (const p of sel) {
      let g = p.group ? gm.get(p.group) : null;
      while (g) {
        gs.set(g.id, { ...g });
        g = g.parent ? gm.get(g.parent) : null;
      }
    }
    clip = { parts: sel.map(clonePart), groups: [...gs.values()], bounds: selectionBounds().clone() };
    return true;
  };
  function offsetFor(bounds) {
    // place the copy right next to the original, on the side the camera looks at from the right
    const right = _v.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const size = bounds.getSize(new THREE.Vector3());
    if (Math.abs(right.x) >= Math.abs(right.z)) return [Math.sign(right.x || 1) * Math.max(size.x, ed.snap || 0.5), 0, 0];
    return [0, 0, Math.sign(right.z || 1) * Math.max(size.z, ed.snap || 0.5)];
  }
  ed.paste = (offset = null) => {
    if (!clip) return [];
    const off = offset || (clip.parts.some((p) => ed.byId.has(p.id)) ? offsetFor(clip.bounds) : [0, 0, 0]);
    const created = [];
    ed.transact('paste', () => {
      const gmap = new Map();
      const taken = new Set(ed.exp.groups.map((g) => g.id));
      if (clip.groups.length) ed.touchGroups();
      for (const g of clip.groups) {
        const id = newId('g', taken);
        taken.add(id);
        gmap.set(g.id, id);
      }
      for (const g of clip.groups) ed.exp.groups.push({ id: gmap.get(g.id), name: g.name, parent: g.parent && gmap.has(g.parent) ? gmap.get(g.parent) : g.parent && groupsById().has(g.parent) ? g.parent : null });
      for (const src of clip.parts) {
        const p = addPart({ ...clonePart(src), id: null, p: [src.p[0] + off[0], src.p[1] + off[1], src.p[2] + off[2]], group: src.group ? gmap.get(src.group) || null : null });
        if (p) created.push(p);
      }
    });
    clip.parts = created.map(clonePart);
    clip.bounds.translate(new THREE.Vector3(off[0], off[1], off[2]));
    if (created.length) ed.select(created.map((p) => p.id));
    return created;
  };
  ed.duplicate = () => {
    if (!ed.copy()) return [];
    return ed.paste(offsetFor(clip.bounds));
  };
  ed.remove = () => {
    const ids = [...ed.selection];
    if (!ids.length) return;
    ed.transact('delete', () => {
      ids.forEach(removePart);
      pruneGroups();
    });
    ed.activeGroup = null;
    selectionChanged();
    ctx.audio?.play?.('build.remove', { volume: 0.5 });
  };
  function pruneGroups() {
    // drop groups without any parts below them
    const used = new Set();
    const gm = groupsById();
    for (const p of parts()) {
      let g = p.group ? gm.get(p.group) : null;
      while (g) {
        used.add(g.id);
        g = g.parent ? gm.get(g.parent) : null;
      }
    }
    if (ed.exp.groups.some((g) => !used.has(g.id))) {
      ed.touchGroups();
      ed.exp.groups = ed.exp.groups.filter((g) => used.has(g.id));
    }
  }
  /** Top-level items of the selection: whole groups (all parts selected) and loose parts. */
  function selectionItems() {
    const gm = groupsById();
    const groups = new Set();
    const loose = [];
    const memo = new Map(); // gid → every part below it is selected (one O(n) pass per group, not per part)
    const full = (gid) => {
      if (!memo.has(gid)) memo.set(gid, descendantParts(gid).every((p) => ed.selection.has(p.id)));
      return memo.get(gid);
    };
    for (const p of ed.selected()) {
      let best = null;
      let g = p.group ? gm.get(p.group) : null;
      while (g) {
        if (full(g.id)) best = g;
        g = g.parent ? gm.get(g.parent) : null;
      }
      if (best) groups.add(best.id);
      else loose.push(p);
    }
    return { groups: [...groups], loose };
  }
  ed.group = () => {
    if (!ed.selection.size) return;
    const { groups, loose } = selectionItems();
    const gm = groupsById();
    const parents = new Set([...groups.map((id) => gm.get(id).parent || null), ...loose.map((p) => p.group || null)]);
    const parent = parents.size === 1 ? [...parents][0] : null;
    const id = newId('g', new Set(gm.keys()));
    ed.transact('group', () => {
      ed.touchGroups();
      ed.exp.groups.push({ id, name: t({ en: 'Model', nl: 'Model' }), parent });
      for (const gid of groups) ed.exp.groups.find((g) => g.id === gid).parent = id;
      for (const p of loose) {
        ed.touch(p.id);
        p.group = id;
      }
    });
    ed.activeGroup = id;
    emit('selection');
  };
  ed.ungroup = () => {
    const { groups } = selectionItems();
    const target = ed.activeGroup && !groups.includes(ed.activeGroup) ? [...groups, ed.activeGroup] : groups;
    if (!target.length) return;
    ed.transact('ungroup', () => {
      ed.touchGroups();
      for (const gid of target) {
        const g = ed.exp.groups.find((x) => x.id === gid);
        if (!g) continue;
        for (const p of parts()) {
          if (p.group !== gid) continue;
          ed.touch(p.id);
          p.group = g.parent || null;
        }
        for (const c of ed.exp.groups) if (c.parent === gid) c.parent = g.parent || null;
        ed.exp.groups = ed.exp.groups.filter((x) => x.id !== gid);
      }
    });
    ed.activeGroup = null;
    emit('selection');
  };
  ed.renameGroup = (gid, name) => {
    const clean = filterText(String(name).trim(), LIMITS.name);
    if (!clean) return;
    ed.transact('rename', () => {
      ed.touchGroups();
      const g = ed.exp.groups.find((x) => x.id === gid);
      if (g) g.name = clean;
    });
  };
  ed.renamePart = (id, name) => {
    const clean = filterText(String(name).trim(), LIMITS.name);
    if (clean) ed.setField([id], 'name', clean);
  };

  // --------------------------------------------------------------- camera
  ed.focusSelection = () => {
    const box = selectionBounds();
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const dist = Math.max(4, sphere.radius * 2.4 + 3);
    camAnim.from.copy(camera.position);
    camAnim.to.copy(sphere.center).addScaledVector(dir, -dist);
    camAnim.t = 0;
  };
  const camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const upv = new THREE.Vector3();
  function updateCamera(dt) {
    const typing = !input.gameEnabled;
    const mod = input.rawDown('ControlLeft') || input.rawDown('ControlRight') || input.rawDown('MetaLeft') || input.rawDown('MetaRight');
    if (input.down('Mouse2') || touchLook) {
      yaw -= input.lookX * 0.0026;
      pitch = Math.max(-1.55, Math.min(1.55, pitch - input.lookY * 0.0026));
    }
    yaw -= touchDelta.yaw;
    pitch = Math.max(-1.55, Math.min(1.55, pitch - touchDelta.pitch));
    touchDelta.yaw = 0;
    touchDelta.pitch = 0;
    camera.quaternion.setFromEuler(camEuler.set(pitch, yaw, 0, 'YXZ'));
    fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    upv.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (camAnim.t < 1) {
      camAnim.t = Math.min(1, camAnim.t + dt / 0.35);
      const k = 1 - Math.pow(1 - camAnim.t, 3);
      camera.position.lerpVectors(camAnim.from, camAnim.to, k);
    }
    if (!typing && !mod) {
      const fast = input.down('ShiftLeft') || input.down('ShiftRight') ? 3.2 : 1;
      const speed = 16 * fast * dt;
      const mx = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
      const mz = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
      const my = (input.down('KeyE') ? 1 : 0) - (input.down('KeyQ') ? 1 : 0);
      if (mx || mz || my) {
        camAnim.t = 1;
        camera.position.addScaledVector(fwd, mz * speed).addScaledVector(right, mx * speed).addScaledVector(UP, my * speed);
      }
    }
    const wheel = input.wheel + touchDelta.zoom;
    touchDelta.zoom = 0;
    if (wheel) {
      camAnim.t = 1;
      const h = Math.max(2, Math.abs(camera.position.y));
      camera.position.addScaledVector(fwd, -wheel * Math.min(12, 1.2 + h * 0.12));
    }
    if (input.down('Mouse1') && !typing) {
      const k = 0.02 + Math.abs(camera.position.y) * 0.0012;
      camera.position.addScaledVector(right, -input.mouse.dx * k).addScaledVector(upv, input.mouse.dy * k);
    }
    if (touchDelta.panX || touchDelta.panY) {
      const k = 0.025 + Math.abs(camera.position.y) * 0.0015;
      camera.position.addScaledVector(right, -touchDelta.panX * k).addScaledVector(upv, touchDelta.panY * k);
      touchDelta.panX = 0;
      touchDelta.panY = 0;
    }
    camera.position.y = Math.max(-200, Math.min(3000, camera.position.y));
    camera.updateMatrixWorld();
  }

  // ------------------------------------------------------- pointer input
  const boxEl = ui.h('div', { class: 'studio-box' });
  const drag = { id: null, mode: null, x0: 0, y0: 0, x: 0, y: 0, hit: null, plane: new THREE.Plane(), start: null, moved: false };
  const touches = new Map();
  let touchLook = false; // reserved: touch look handled via touchDelta
  const touchDelta = { yaw: 0, pitch: 0, zoom: 0, panX: 0, panY: 0 };
  let pinch0 = 0;
  let mouse = { x: -1, y: -1, dirty: false };
  const active = () => ctx.modes.is('studio') && !ctx.modes.transitioning && ed.exp && !ui.isModalOpen();

  function onDown(e) {
    if (!active()) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        if (drag.mode === 'box' || drag.mode === 'look' || drag.mode === 'tap') drag.mode = 'pan';
        touchLook = false;
        return;
      }
    }
    if (e.button !== 0) return;
    if (gizmo.dragging || (gizmo.axis && helper.visible)) return; // the gizmo owns this drag
    const hit = ed.pickAt(e.clientX, e.clientY);
    drag.id = e.pointerId;
    drag.x0 = drag.x = e.clientX;
    drag.y0 = drag.y = e.clientY;
    drag.moved = false;
    drag.hit = hit;
    drag.mode = hit ? 'part' : e.pointerType === 'touch' ? 'look' : 'box';
    drag.alt = e.altKey;
    drag.shift = e.shiftKey || e.ctrlKey || e.metaKey;
  }
  function onMove(e) {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      const tp = touches.get(e.pointerId);
      const dx = e.clientX - tp.x;
      const dy = e.clientY - tp.y;
      tp.x = e.clientX;
      tp.y = e.clientY;
      if (touches.size >= 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) touchDelta.zoom += (pinch0 - d) * 0.02;
        pinch0 = d;
        touchDelta.panX += dx * 0.5;
        touchDelta.panY += dy * 0.5;
        return;
      }
      if (drag.mode === 'look' && drag.id === e.pointerId) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) {
          drag.moved = true;
          touchDelta.yaw += dx * 0.0042;
          touchDelta.pitch += dy * 0.0042;
        }
        return;
      }
    }
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.dirty = true;
    if (drag.id !== e.pointerId || !drag.mode) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.moved && Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      if (drag.mode === 'part') beginSlide();
    }
    if (drag.mode === 'box') {
      const x = Math.min(drag.x0, drag.x);
      const y = Math.min(drag.y0, drag.y);
      Object.assign(boxEl.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${Math.abs(drag.x - drag.x0)}px`, height: `${Math.abs(drag.y - drag.y0)}px` });
    } else if (drag.mode === 'slide') slideTo(drag.x, drag.y);
  }
  function onUp(e) {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch0 = 0;
    }
    if (drag.id !== e.pointerId) return;
    const mode = drag.mode;
    drag.mode = null;
    drag.id = null;
    boxEl.style.display = 'none';
    if (!active()) return;
    if (mode === 'slide') return endSlide();
    if (mode === 'pan') return;
    if (mode === 'box' && drag.moved) return boxSelect(drag.x0, drag.y0, drag.x, drag.y, drag.shift);
    if (drag.moved && mode === 'look') return;
    // a click / tap
    const hit = drag.hit;
    if (!hit) {
      if (!drag.shift) ed.clearSelection();
      return;
    }
    const top = drag.alt ? null : topGroupOf(hit.part);
    if (top) {
      const ids = descendantParts(top.id).map((p) => p.id);
      const all = ids.every((id) => ed.selection.has(id));
      if (drag.shift) ed.select(ids, all ? { toggle: true } : { add: true });
      else {
        ed.select(ids);
        ed.activeGroup = top.id;
        emit('selection');
      }
    } else ed.select([hit.part.id], drag.shift ? { toggle: true } : {});
  }
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  function boxSelect(x0, y0, x1, y1, add) {
    const r = canvas.getBoundingClientRect();
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const ids = [];
    for (const p of parts()) {
      _v.set(p.p[0], p.p[1], p.p[2]).project(camera);
      if (_v.z > 1 || _v.z < -1) continue;
      const sx = r.left + ((_v.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - _v.y) / 2) * r.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) ids.push(p.id);
    }
    ed.select(ids, { add });
  }

  // slide: drag a part across a horizontal plane (Roblox-style drag)
  function beginSlide() {
    const hit = drag.hit;
    if (!hit) return;
    if (!ed.selection.has(hit.part.id)) {
      const top = drag.alt ? null : topGroupOf(hit.part);
      if (top) ed.select(descendantParts(top.id).map((p) => p.id), drag.shift ? { add: true } : {});
      else ed.select([hit.part.id], drag.shift ? { add: true } : {});
    }
    drag.mode = 'slide';
    drag.plane.setFromNormalAndCoplanarPoint(UP, hit.point);
    drag.origin = hit.point.clone();
    drag.start = ed.selected().map((p) => ({ p, start: clonePart(p) }));
    tx = { label: 'move', parts: new Map(), groups: null, settings: null, structure: false, coalesce: null, time: performance.now() };
    for (const { p } of drag.start) ed.touch(p.id);
    helper.visible = false;
  }
  const _pt = new THREE.Vector3();
  function slideTo(x, y) {
    const r = setRay(x, y);
    if (!r.intersectPlane(drag.plane, _pt)) return;
    const step = ed.snap || 0;
    let dx = _pt.x - drag.origin.x;
    let dz = _pt.z - drag.origin.z;
    if (step) {
      dx = Math.round(dx / step) * step;
      dz = Math.round(dz / step) * step;
    }
    for (const { p, start } of drag.start) {
      p.p = [round3(start.p[0] + dx), start.p[1], round3(start.p[2] + dz)];
      stage.parts.updatePart(p);
      syncShape(p);
    }
    outlinesRefresh();
    emit('parts');
  }
  function endSlide() {
    const done = tx;
    tx = null;
    drag.start = null;
    if (done) finishTx(done);
    gizmoRefresh();
    emit('selection');
  }

  // ------------------------------------------------------------ keyboard
  function onKey(e) {
    if (!active()) return;
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.code;
    if (mod && k === 'KeyS') {
      e.preventDefault();
      ed.save({ manual: true });
      ui.toast({ title: t({ en: 'Saved', nl: 'Opgeslagen' }), text: ed.status.text, icon: 'check', kind: 'success', duration: 1800 });
      return;
    }
    if (typing) return;
    if (k === 'F5' || (mod && k === 'KeyP')) {
      e.preventDefault();
      ed.play();
      return;
    }
    if (mod) {
      const map = {
        KeyZ: () => (e.shiftKey ? ed.redo() : ed.undo()),
        KeyY: ed.redo,
        KeyC: ed.copy,
        KeyV: () => ed.paste(),
        KeyD: ed.duplicate,
        KeyG: ed.group,
        KeyU: ed.ungroup,
        KeyA: ed.selectAll,
        Digit1: () => ed.setTool('select'),
        Digit2: () => ed.setTool('move'),
        Digit3: () => ed.setTool('rotate'),
        Digit4: () => ed.setTool('scale'),
      };
      if (map[k]) {
        e.preventDefault();
        map[k]();
      }
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      ed.remove();
    } else if (k === 'KeyF') ed.focusSelection();
    else if (k === 'Digit1') ed.setTool('select');
    else if (k === 'Digit2') ed.setTool('move');
    else if (k === 'Digit3') ed.setTool('rotate');
    else if (k === 'Digit4') ed.setTool('scale');
    else if (k === 'KeyL') ed.toggleSpace();
  }
  window.addEventListener('keydown', onKey);

  // ------------------------------------------------------------- thumbs
  ed.captureThumb = (w = 480, h = 270) => {
    const vis = [helper.visible, outlines.visible, hoverLines.visible, stage.grid.visible];
    helper.visible = outlines.visible = hoverLines.visible = stage.grid.visible = false;
    let url = null;
    try {
      const c = ctx.engine.snapshot(scene, camera, w, h);
      url = c.toDataURL('image/jpeg', 0.8);
    } catch (err) {
      console.warn('[studio] thumbnail failed', err);
    }
    [helper.visible, outlines.visible, hoverLines.visible, stage.grid.visible] = vis;
    return url;
  };

  // ---------------------------------------------------------------- frame
  let hoverTimer = 0;
  ed.update = (dt) => {
    if (!ed.exp) return;
    updateCamera(dt);
    // hover (throttled; only while no drag)
    hoverTimer -= dt;
    if (mouse.dirty && hoverTimer <= 0 && !drag.mode && !gizmo.dragging) {
      hoverTimer = 0.05;
      mouse.dirty = false;
      const overCanvas = document.elementFromPoint(mouse.x, mouse.y) === canvas;
      const hit = overCanvas ? ed.pickAt(mouse.x, mouse.y, hoverHit) : null;
      const id = hit ? hit.part.id : null;
      if (id !== ed.hover) {
        ed.hover = id;
        hoverRefresh();
      }
    }
    stage.update(dt, camera, _v.copy(camera.position).addScaledVector(fwd, 30).setY(0));
    autosave();
  };

  ed.overlay = boxEl;
  ed.gizmo = gizmo;
  ed.play = () => studio.playTest();
  ed.exit = () => studio.exitStudio();
  ed.emit = emit;
  ed.dispose = () => {
    canvas.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKey);
    gizmo.dispose();
    stage.dispose();
  };
  /** Mode hooks (called by index.js). */
  ed.activate = () => {
    stage.activate();
    gizmo.enabled = true;
    gizmoRefresh();
  };
  ed.deactivate = () => {
    stage.deactivate();
    gizmo.enabled = false;
    if (gizmo.object) gizmo.detach();
    helper.visible = false;
    drag.mode = null;
    boxEl.style.display = 'none';
    touches.clear();
  };
  return ed;
}
