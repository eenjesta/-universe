/**
 * Base structures with state (survival): storage chests, campfires (timed cooking), beds and doors.
 * All of them go through C.STORE { struct, op, … } (the "structure interaction" message):
 *
 *   chest     op 'open'                         → S.STORAGE { struct, kind: 'chest', items, res, stacks }
 *             op 'put' | 'take', item | res, n  moves items / resources between the player and the chest
 *                                              (what doesn't fit stays where it was) → S.STORAGE + S.INV
 *   campfire  op 'open'                         → S.STORAGE { struct, kind: 'fire', cook: [{ recipe, n, by, done }] }
 *             op 'cook', recipe, n              raw food on the fire (COOK_RECIPES, a free grill slot) — the
 *                                              meals are ready at `done` (server ms) → broadcast to players near
 *             op 'collect'                      takes your finished meals off the fire
 *   bed       op 'sleep'                        your respawn point (C.RESPAWN {at: 'bed'}) + the Rested buff
 *                                              → S.STORAGE { struct, kind: 'bed', bed: true, rested: until }
 *   door      op 'toggle'                       open / close → S.STRUCT { add: [record with open], upd: true }
 *
 * Access (§11.2 claims): chests, beds and doors are locked to their owner (and the owner of the claim
 * they stand in) → S.DENY { of: 'store', reason: 'private', name }. Campfires are public (anyone may
 * cook; only the cook takes their meals). Range: STORE_RANGE m from the structure (+ its radius).
 * Chest contents and food on the fire persist with the world save (exportSave / importSave). A demolished
 * chest / campfire spills its contents into an owner-only crate (10 min) — onRemove(rec).
 */
import { S } from '../protocol.js';
import { PIECE } from '../defs/pieces.js';
import { ITEMS, RESOURCE_IDS, RESOURCE_MAX, DEATH_DROP } from '../defs/items.js';
import { COOK_RECIPES } from '../defs/recipes.js';
import { canAfford, pay, gain, isEmptyBundle } from './inventory.js';
import { addBuff } from './players.js';
import { isNum } from './util.js';

export const STORE_RANGE = 4.5;
export const CHEST_RES_MAX = 20000; // per resource in one chest
export const CHEST_ITEM_MAX = 999; // per item stack in one chest
export const RESTED_SECS = 600;

const int = (v) => Math.max(0, Math.floor(Number(v) || 0));

export function createStorage(W) {
  const chests = new Map(); // struct id → { items: {}, res: {} }
  const fires = new Map(); // struct id → [{ recipe, n, by, done }]

  const roleOf = (rec) => PIECE[rec?.type]?.smp || null;
  const ownerName = (rec) => rec.ownerName || W.players.get(rec.owner)?.name || '';

  /** Owner of the structure, or owner of the claim it stands in (legacy ownerless pieces: the claim owner). */
  function canAccess(p, rec) {
    if (rec.owner && rec.owner === p.id) return true;
    const c = W.build.claimAt(rec.x, rec.z);
    if (c && c.owner === p.id) return true;
    return !rec.owner && !c;
  }

  function chestOf(id) {
    let c = chests.get(id);
    if (!c) chests.set(id, (c = { items: {}, res: {} }));
    return c;
  }
  const stacks = (c) => Object.values(c.res).filter((n) => n > 0).length + Object.values(c.items).filter((n) => n > 0).length;

  function chestMsg(rec, ack) {
    const c = chestOf(rec.id);
    const m = { t: S.STORAGE, struct: rec.id, kind: 'chest', items: { ...c.items }, res: { ...c.res }, stacks: roleOf(rec)?.storage?.stacks || 24 };
    if (ack !== undefined) m.ack = ack;
    return m;
  }

  function fireMsg(rec, ack) {
    const m = { t: S.STORAGE, struct: rec.id, kind: 'fire', cook: (fires.get(rec.id) || []).map((s) => ({ recipe: s.recipe, n: s.n, by: s.by, done: s.done })), slots: roleOf(rec)?.cook || 3 };
    if (ack !== undefined) m.ack = ack;
    return m;
  }

  /** Chest: moves n of `item` or `res` between the player and the chest; returns the moved amount. */
  function transfer(p, rec, msg, dir) {
    const c = chestOf(rec.id);
    const isRes = typeof msg.res === 'string' && RESOURCE_IDS.includes(msg.res);
    const key = isRes ? msg.res : typeof msg.item === 'string' && ITEMS[msg.item] ? msg.item : null;
    if (!key) return W.deny(p, msg, 'unknown');
    const want = Math.max(1, int(msg.n) || 1);
    const sec = isRes ? 'res' : 'items';
    if (dir === 'put') {
      const have = isRes ? p.inv.res[key] || 0 : p.inv.items[key] || 0;
      const cap = isRes ? CHEST_RES_MAX : CHEST_ITEM_MAX;
      const cur = c[sec][key] || 0;
      if (cur <= 0 && stacks(c) >= (roleOf(rec)?.storage?.stacks || 24)) return W.deny(p, msg, 'full');
      const n = Math.min(want, have, cap - cur);
      if (n <= 0) return W.deny(p, msg, have <= 0 ? 'noItem' : 'full');
      if (isRes) p.inv.res[key] -= n;
      else p.inv.items[key] -= n;
      p.dirty.add(sec);
      c[sec][key] = cur + n;
    } else {
      const cur = c[sec][key] || 0;
      if (cur <= 0) return W.deny(p, msg, 'noItem');
      const got = gain(p.inv, { [sec]: { [key]: Math.min(want, cur) } }, p.dirty);
      const n = got[sec]?.[key] || 0;
      if (n <= 0) return W.deny(p, msg, 'full');
      c[sec][key] = cur - n;
      if (c[sec][key] <= 0) delete c[sec][key];
    }
    W.emit(p.id, chestMsg(rec, msg.cid));
    W.flushInv(p, msg.cid);
    return true;
  }

  function cook(p, rec, msg) {
    const r = COOK_RECIPES[msg.recipe];
    if (!r) return W.deny(p, msg, 'unknown');
    const slots = fires.get(rec.id) || [];
    if (slots.length >= (roleOf(rec)?.cook || 3)) return W.deny(p, msg, 'full');
    let n = Math.max(1, Math.min(r.max || 1, int(msg.n) || 1));
    // clamp to what the player can pay for
    for (const [k, v] of Object.entries(r.cost)) n = Math.min(n, Math.floor((k in p.inv.res ? p.inv.res[k] : p.inv.items[k] || 0) / v));
    if (n <= 0) return W.deny(p, msg, 'cost');
    const cost = {};
    for (const [k, v] of Object.entries(r.cost)) cost[k] = v * n;
    if (!canAfford(p.inv, cost)) return W.deny(p, msg, 'cost');
    pay(p.inv, cost, p.dirty);
    const now = W.now();
    // batches cook one after another per cook? no — each grill slot is its own fire spot: time per batch
    slots.push({ recipe: r.id, n, by: p.id, done: now + r.time * 1000 });
    fires.set(rec.id, slots);
    W.emit({ near: [rec.x, rec.z, 40] }, fireMsg(rec));
    if (msg.cid !== undefined) W.emit(p.id, { ...fireMsg(rec, msg.cid) });
    W.flushInv(p, msg.cid);
    return true;
  }

  function collect(p, rec, msg) {
    const slots = fires.get(rec.id) || [];
    const now = W.now();
    let took = 0;
    const got = {};
    for (let i = slots.length - 1; i >= 0; i--) {
      const s = slots[i];
      if (s.by !== p.id || s.done > now) continue;
      const r = COOK_RECIPES[s.recipe];
      const want = {};
      for (const [id, k] of Object.entries(r?.out?.items || {})) want[id] = k * s.n;
      const g = gain(p.inv, { items: want }, p.dirty);
      let left = false;
      for (const [id, k] of Object.entries(want)) {
        const n = g.items?.[id] || 0;
        if (n > 0) got[id] = (got[id] || 0) + n;
        if (n < k) left = true;
      }
      if (left) {
        // keep what didn't fit on the fire (as a finished portion count of the first output)
        const first = Object.keys(want)[0];
        const per = r.out.items[first] || 1;
        s.n = Math.max(1, Math.ceil((want[first] - (g.items?.[first] || 0)) / per));
      } else {
        slots.splice(i, 1);
        took++;
      }
    }
    if (!Object.keys(got).length) return W.deny(p, msg, slots.some((s) => s.by === p.id) ? 'wait' : 'noItem');
    if (!slots.length) fires.delete(rec.id);
    W.emit({ near: [rec.x, rec.z, 40] }, fireMsg(rec));
    W.emit(p.id, { t: S.STORAGE, struct: rec.id, kind: 'fire', got: { items: got }, took, ack: msg.cid, cook: fireMsg(rec).cook, slots: roleOf(rec)?.cook || 3 });
    W.flushInv(p, msg.cid);
    return true;
  }

  function sleep(p, rec, msg) {
    const now = W.now();
    if (now - p.lastDmgAt < 10000) return W.deny(p, msg, 'combat');
    p.bedId = rec.id;
    p.fxDirty = true; // S.STATS carries `home`
    addBuff(W, p, 'rested', RESTED_SECS);
    W.emit(p.id, { t: S.STORAGE, struct: rec.id, kind: 'bed', bed: true, rested: p.buffs.get('rested') || 0, ack: msg.cid });
    return true;
  }

  function toggle(p, rec, msg) {
    rec.open = !rec.open;
    W.build.update(rec);
    if (msg.cid !== undefined) W.emit(p.id, { t: S.STORAGE, struct: rec.id, kind: 'door', open: !!rec.open, ack: msg.cid });
    return true;
  }

  function handle(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    const rec = W.structures.get(msg.struct);
    if (!rec) return W.deny(p, msg, 'gone', { struct: msg.struct });
    const role = roleOf(rec);
    if (!role) return W.deny(p, msg, 'invalid');
    const reach = STORE_RANGE + (PIECE[rec.type]?.radius || 0.5) + (role.door ? 1.5 : 0);
    if (Math.hypot(rec.x - p.x, rec.z - p.z) > reach || Math.abs(rec.y - p.y) > 4) return W.deny(p, msg, 'far', { struct: rec.id });
    const op = String(msg.op || 'open');
    const locked = () => W.deny(p, msg, 'private', { struct: rec.id, name: ownerName(rec) });
    if (role.storage) {
      if (!canAccess(p, rec)) return locked();
      if (op === 'open') {
        W.emit(p.id, chestMsg(rec, msg.cid));
        return true;
      }
      if (op === 'put' || op === 'take') return transfer(p, rec, msg, op);
      return W.deny(p, msg, 'invalid');
    }
    if (role.station === 'campfire') {
      if (op === 'open') {
        W.emit(p.id, fireMsg(rec, msg.cid));
        return true;
      }
      if (op === 'cook') return cook(p, rec, msg);
      if (op === 'collect') return collect(p, rec, msg);
      return W.deny(p, msg, 'invalid');
    }
    if (role.bed) {
      if (!canAccess(p, rec)) return locked();
      if (op === 'sleep' || op === 'open') return sleep(p, rec, msg);
      return W.deny(p, msg, 'invalid');
    }
    if (role.door) {
      if (!canAccess(p, rec)) return locked();
      if (op === 'toggle' || op === 'open') return toggle(p, rec, msg);
      return W.deny(p, msg, 'invalid');
    }
    return W.deny(p, msg, 'invalid');
  }

  /** A structure is going away (demolished, decayed, moderated): spill its contents, forget its state. */
  function onRemove(rec) {
    const role = roleOf(rec);
    if (!role) return;
    const bundle = { res: {}, items: {} };
    if (role.storage) {
      const c = chests.get(rec.id);
      chests.delete(rec.id);
      if (c) {
        for (const [k, n] of Object.entries(c.res)) if (n > 0) bundle.res[k] = n;
        for (const [k, n] of Object.entries(c.items)) if (n > 0) bundle.items[k] = n;
      }
    }
    if (role.station === 'campfire') {
      for (const s of fires.get(rec.id) || []) {
        for (const [id, k] of Object.entries(COOK_RECIPES[s.recipe]?.out?.items || {})) bundle.items[id] = (bundle.items[id] || 0) + k * s.n;
      }
      fires.delete(rec.id);
    }
    if (role.bed) {
      for (const p of W.players.values()) {
        if (p.bedId !== rec.id) continue;
        p.bedId = null;
        p.fxDirty = true;
      }
    }
    if (!isEmptyBundle(bundle)) {
      const y = Math.max(rec.y, W.H(rec.x, rec.z)) + 0.3;
      W.loot.spawn([rec.x, y, rec.z], bundle, { owner: rec.owner || null, ttl: DEATH_DROP.ttl, kind: 'chest' });
    }
  }

  function exportSave() {
    const out = { chests: {}, fires: {} };
    for (const [id, c] of chests) if (W.structures.has(id) && (Object.keys(c.res).length || Object.keys(c.items).length)) out.chests[id] = { items: { ...c.items }, res: { ...c.res } };
    const now = W.now();
    // cooking times are saved as "seconds left" (the LocalServer clock restarts with the page)
    for (const [id, slots] of fires) if (W.structures.has(id) && slots.length) out.fires[id] = slots.map((s) => ({ recipe: s.recipe, n: s.n, by: s.by, left: Math.max(0, Math.round((s.done - now) / 1000)) }));
    return out;
  }

  function importSave(data) {
    if (!data || typeof data !== 'object') return;
    for (const [id, c] of Object.entries(data.chests || {})) {
      if (!W.structures.has(id) || !c || typeof c !== 'object') continue;
      const box = { items: {}, res: {} };
      for (const [k, n] of Object.entries(c.res || {})) if (RESOURCE_IDS.includes(k) && int(n) > 0) box.res[k] = Math.min(int(n), CHEST_RES_MAX, RESOURCE_MAX);
      for (const [k, n] of Object.entries(c.items || {})) if (ITEMS[k] && int(n) > 0) box.items[k] = Math.min(int(n), CHEST_ITEM_MAX);
      chests.set(id, box);
    }
    const now = W.now();
    for (const [id, slots] of Object.entries(data.fires || {})) {
      if (!W.structures.has(id) || !Array.isArray(slots)) continue;
      const list = [];
      for (const s of slots) if (s && COOK_RECIPES[s.recipe] && int(s.n) > 0 && typeof s.by === 'string') list.push({ recipe: s.recipe, n: int(s.n), by: s.by, done: now + (isNum(s.left) ? Math.max(0, s.left) : 0) * 1000 });
      if (list.length) fires.set(id, list);
    }
  }

  return {
    handle,
    onRemove,
    exportSave,
    importSave,
    canAccess,
    /** Contents of a chest (tests / tools). */
    chest: (id) => chests.get(id) || null,
    /** Grill slots of a campfire (tests / tools). */
    fire: (id) => fires.get(id) || [],
  };
}
