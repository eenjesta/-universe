/**
 * Structures & claims (server truth for the shared world).
 *
 * Record (build module record + owner): { id: 's41', type, x, y, z, rot, level, variant?, owner, t }
 * C.BUILD_PLACE {piece, p, rot, level?, variant?, cid} → validation (piece, unlock, reach,
 *   bounds, water, height sanity, protected landmark areas, foreign claims, slot / free
 *   occupancy, per-player limit, one claim / spawn beacon) → pay →
 *   S.STRUCT {add: [rec], by, cid, ok: true} to '*'; failure → S.STRUCT {cid, ok: false, reason} to the placer.
 * C.BUILD_REMOVE {id, cid?} → owner only, 50 % refund → S.STRUCT {remove: [id], by, cid, ok: true} to '*'.
 * Claim beacon → claim {id: 'c3', owner, name, p: [x, z], r: 24, sid} (S.CLAIMS add/remove to '*').
 * Spawn beacon → the owner's respawn point (C.RESPAWN {at: 'beacon'}).
 *
 * World rules (PLATFORM.md §11 / §11.2): no building in the safe hub nor in the
 * 500 m buffer around it, nor on highways / near POIs (static: W.world.isBuildable,
 * sampled over the piece / claim footprint); dynamic rules here: structures may
 * not rise > 16 m above the terrain where hubDist < 2000 m, one claim per player,
 * ≥ 30 m between claims of different owners, no claim over someone else's
 * structures, 400 structures per player, and claims of owners absent for 30 days
 * decay over 3 days (S.CLAIMS add {…, decay}) and are then removed with their
 * structures (S.STRUCT remove {reason: 'decay'}); the owner is told on login.
 */
import { S } from '../protocol.js';
import { PIECE, CELL, LEVEL_H, MAX_LEVEL, REACH, MAX_STRUCTURES_PER_PLAYER, ORIGIN_X, ORIGIN_Z, refundOf, protectedAt } from '../defs/pieces.js';
import { HUB, CLAIM_RULES, WORLD_LIMIT, hubDist } from '../defs/world.js';
import { canAfford, pay, gain } from './inventory.js';
import { isNum, isVec3, r2 } from './util.js';

const GRID = 16; // spatial hash cell (m)
const DAY_MS = 86400 * 1000;
const DECAY_CHECK_S = 30; // seconds between claim-decay checks
const gkey = (i, j) => (i + 32768) * 65536 + (j + 32768);

const cellI = (x) => Math.floor((x - ORIGIN_X) / CELL);
const cellJ = (z) => Math.floor((z - ORIGIN_Z) / CELL);

/** Occupied slot keys of a piece (port of src/build/placement.js slotLayout). */
export function slotKeys(def, x, z, rot, L, variant) {
  const keys = [];
  const id = def.id;
  const q = (((Math.round(rot) || 0) % 4) + 4) % 4;
  if (def.snap === 'deck' || def.snap === 'roof') {
    keys.push(`d:${cellI(x)}:${cellJ(z)}:${L}`);
  } else if (def.snap === 'edge') {
    const dir = q % 2 ? 'z' : 'x';
    const i = dir === 'x' ? cellI(x) : Math.round((x - ORIGIN_X) / CELL);
    const j = dir === 'x' ? Math.round((z - ORIGIN_Z) / CELL) : cellJ(z);
    keys.push(`e${dir}:${i}:${j}:${L}`);
  } else if (def.snap === 'corner') {
    keys.push(`v:${Math.round((x - ORIGIN_X) / CELL)}:${Math.round((z - ORIGIN_Z) / CELL)}:${L}`);
  } else if (def.snap === 'room') {
    const [sx0, sz0] = def.size || [1, 1];
    const sx = q % 2 ? sz0 : sx0;
    const sz = q % 2 ? sx0 : sz0;
    const i0 = Math.round((x - ORIGIN_X) / CELL - sx / 2);
    const j0 = Math.round((z - ORIGIN_Z) / CELL - sz / 2);
    const storeys = def.storeys || 1;
    for (let a = 0; a < sx; a++) {
      for (let b = 0; b < sz; b++) {
        const i = i0 + a;
        const j = j0 + b;
        for (let l = L; l < L + storeys; l++) keys.push(`r:${i}:${j}:${l}`);
        if (id === 'stairs' || id === 'cube-module' || id === 'workshop') keys.push(`d:${i}:${j}:${L + 1}`);
        if ((id === 'cube-module' || id === 'workshop' || id === 'landing-pad') && variant === 'ground') keys.push(`d:${i}:${j}:${L}`);
      }
    }
    if (id === 'canopy') keys.push(`v:${i0}:${j0}:${L}`, `v:${i0 + 1}:${j0}:${L}`, `v:${i0}:${j0 + 1}:${L}`, `v:${i0 + 1}:${j0 + 1}:${L}`);
  }
  return keys;
}

/** Rough horizontal footprint radius of a piece (protected-area / avoidance checks). */
export function footprintRadius(def) {
  if (def.snap === 'free') return def.radius || 1;
  if (def.snap === 'room') {
    const [sx, sz] = def.size || [1, 1];
    return (Math.hypot(sx, sz) * CELL) / 2;
  }
  return CELL * 0.71;
}

export function createBuild(W) {
  const slots = new Map(); // slot key → record id
  const grid = new Map(); // spatial hash → records
  const recSlots = new Map(); // record id → keys

  const gridAdd = (rec) => {
    const k = gkey(Math.floor(rec.x / GRID), Math.floor(rec.z / GRID));
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(rec);
  };
  const gridRemove = (rec) => {
    const k = gkey(Math.floor(rec.x / GRID), Math.floor(rec.z / GRID));
    const a = grid.get(k);
    if (!a) return;
    const i = a.indexOf(rec);
    if (i >= 0) a.splice(i, 1);
    if (!a.length) grid.delete(k);
  };

  /** Calls fn(rec) for structures whose cell is within r of (x, z) (coarse). */
  function forNear(x, z, r, fn) {
    const i0 = Math.floor((x - r) / GRID);
    const i1 = Math.floor((x + r) / GRID);
    const j0 = Math.floor((z - r) / GRID);
    const j1 = Math.floor((z + r) / GRID);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const a = grid.get(gkey(i, j));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) if (fn(a[k]) === true) return true;
      }
    }
    return false;
  }

  /** Height of a piece above its base y (m). */
  const pieceHeight = (def) => (def.snap === 'room' ? (def.storeys || 1) * LEVEL_H : def.snap === 'free' ? 2.2 : def.snap === 'deck' || def.snap === 'roof' ? 0.6 : 3.2);

  /** Static world rules over a footprint (centre + 8 points at radius r): first failure reason or null. */
  function blockedAt(x, z, r) {
    const c = W.world.isBuildable(x, z);
    if (!c.ok) return c.reason;
    if (r > 0.5) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const q = W.world.isBuildable(x + Math.cos(a) * r, z + Math.sin(a) * r);
        if (!q.ok) return q.reason;
      }
    }
    return null;
  }

  const view = (rec) => {
    const o = { id: rec.id, type: rec.type, x: rec.x, y: rec.y, z: rec.z, rot: rec.rot, level: rec.level, owner: rec.owner };
    if (rec.variant) o.variant = rec.variant;
    if (rec.ownerName) o.ownerName = rec.ownerName;
    return o;
  };

  /** Wire / save form of a claim (name = owner's name, for "Claimed by <name>"). */
  const claimView = (c) => {
    const o = { id: c.id, owner: c.owner, ownerName: c.ownerName, name: c.ownerName, p: [c.p[0], c.p[1]], r: c.r, sid: c.sid };
    if (c.t) o.t = c.t;
    if (c.decay) o.decay = c.decay;
    return o;
  };

  // ------------------------------------------------------------ owners (claim decay, §11.2)
  /** Marks an owner as seen now (join, leave, while online). */
  function touch(id, name) {
    let o = W.owners.get(id);
    if (!o) W.owners.set(id, (o = { name: name || '', seen: W.now(), notices: [] }));
    o.seen = W.now();
    if (name) o.name = name;
    return o;
  }

  /** Removes a decayed base: the owner's structures inside the claim + the claim. */
  function removeBase(c) {
    const ids = [];
    forNear(c.p[0], c.p[1], c.r + 4, (rec) => {
      if (rec.owner === c.owner && (rec.id === c.sid || Math.hypot(rec.x - c.p[0], rec.z - c.p[1]) <= c.r + 2)) ids.push(rec);
      return false;
    });
    const beacon = c.sid && W.structures.get(c.sid);
    if (beacon && !ids.includes(beacon)) ids.push(beacon);
    for (const rec of ids) erase(rec);
    W.claims.delete(c.id);
    if (ids.length) W.emit('*', { t: S.STRUCT, remove: ids.map((r) => r.id), by: null, reason: 'decay' });
    W.emit('*', { t: S.CLAIMS, remove: [c.id] });
    const o = W.owners.get(c.owner);
    if (o) o.notices.push({ kind: 'claim-removed', p: [c.p[0], c.p[1]], n: ids.length, at: W.now() });
  }

  let decayAcc = DECAY_CHECK_S;
  /** Claim decay: owners absent > expireDays → decay over decayDays → removed. */
  function stepDecay(dt) {
    if (!W.claimDecay) return; // off for the single-player LocalServer (trusted) or when the host disables it
    decayAcc += dt;
    if (decayAcc < DECAY_CHECK_S) return;
    decayAcc = 0;
    const now = W.now();
    for (const p of W.players.values()) touch(p.id, p.name);
    for (const c of [...W.claims.values()]) {
      if (W.players.has(c.owner)) {
        if (c.decay) {
          c.decay = 0;
          W.emit('*', { t: S.CLAIMS, add: [claimView(c)] });
        }
        continue;
      }
      const o = W.owners.get(c.owner) || touch(c.owner, c.ownerName);
      const expires = o.seen + CLAIM_RULES.expireDays * DAY_MS;
      if (now < expires) continue;
      const k = (now - expires) / (CLAIM_RULES.decayDays * DAY_MS);
      if (k >= 1) {
        removeBase(c);
        continue;
      }
      const d = Math.max(0.05, Math.round(k * 20) / 20);
      if (d !== c.decay) {
        c.decay = d;
        W.emit('*', { t: S.CLAIMS, add: [claimView(c)] });
      }
    }
  }

  /** On join: marks the owner seen, restores a decaying claim, returns pending notices (welcome.notices). */
  function joinNotices(p) {
    const o = touch(p.id, p.name);
    const out = o.notices.splice(0);
    for (const c of W.claims.values()) {
      if (c.owner !== p.id || !c.decay) continue;
      c.decay = 0;
      W.emit('*', { t: S.CLAIMS, add: [claimView(c)] });
      out.push({ kind: 'claim-restored', id: c.id, p: [c.p[0], c.p[1]] });
    }
    return out;
  }

  function claimAt(x, z) {
    for (const c of W.claims.values()) if (Math.hypot(x - c.p[0], z - c.p[1]) < c.r) return c;
    return null;
  }

  function insert(rec) {
    const def = PIECE[rec.type];
    if (!def) return false;
    W.structures.set(rec.id, rec);
    const keys = slotKeys(def, rec.x, rec.z, rec.rot, rec.level, rec.variant);
    for (const k of keys) slots.set(k, rec.id);
    recSlots.set(rec.id, keys);
    rec.r = footprintRadius(def);
    rec.top = rec.y + (def.snap === 'room' ? (def.storeys || 1) * LEVEL_H : def.snap === 'free' ? 2.2 : 3.2);
    gridAdd(rec);
    return true;
  }

  function erase(rec) {
    W.structures.delete(rec.id);
    for (const k of recSlots.get(rec.id) || []) if (slots.get(k) === rec.id) slots.delete(k);
    recSlots.delete(rec.id);
    gridRemove(rec);
  }

  const fail = (p, msg, reason, extra) => {
    const m = { t: S.STRUCT, cid: msg.cid, ok: false, reason };
    if (extra && extra.name) m.name = extra.name;
    W.emit(p.id, m);
    return false;
  };

  function place(p, msg) {
    if (p.dead) return fail(p, msg, 'dead');
    const def = PIECE[msg.piece];
    if (!def) return fail(p, msg, 'unknown');
    if (def.hidden) return fail(p, msg, 'hidden');
    if (!isVec3(msg.p)) return fail(p, msg, 'invalid');
    const [x, y, z] = msg.p;
    if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) return fail(p, msg, 'bounds');
    if (Math.hypot(x - p.x, z - p.z) > REACH + 8) return fail(p, msg, 'far');
    const rot = isNum(msg.rot) ? msg.rot : 0;
    const level = Math.max(0, Math.min(MAX_LEVEL, Math.round(isNum(msg.level) ? msg.level : 0)));
    const variant = typeof msg.variant === 'string' ? msg.variant.slice(0, 24) : undefined;
    const ground = W.H(x, z);
    if (y < ground - 4 || y > ground + (level + 1) * LEVEL_H + 10 || y < -3) return fail(p, msg, 'height');
    if (level === 0 && W.isWater(x, z) && y < 0.5) return fail(p, msg, 'water');
    if (def.groundOnly && level > 0) return fail(p, msg, 'ground');
    const fr = footprintRadius(def);
    // static world rules: safe hub, no-build buffer, highways, POIs (§11.2)
    const why = blockedAt(x, z, def.smp?.claim ? def.smp.claim : Math.min(fr, 3));
    if (why) return fail(p, msg, why);
    // height limit near the hub
    if (hubDist(x, z) < HUB.heightLimitDist && y + pieceHeight(def) - ground > HUB.heightLimit + 0.05) return fail(p, msg, 'heightLimit');
    if (protectedAt(x, z, Math.min(fr, 3))) return fail(p, msg, 'protected');
    const claim = claimAt(x, z);
    if (claim && claim.owner !== p.id) return fail(p, msg, 'claim', { name: claim.ownerName });
    if (def.unlock && !p.inv.unlocks.includes(def.unlock)) return fail(p, msg, 'locked');
    if (p.structCount >= MAX_STRUCTURES_PER_PLAYER) return fail(p, msg, 'limit');
    if (def.smp?.claim) {
      if (p.claimId && W.claims.has(p.claimId)) return fail(p, msg, 'claimLimit');
      const r = def.smp.claim;
      for (const c of W.claims.values()) {
        if (c.owner === p.id) continue;
        if (Math.hypot(x - c.p[0], z - c.p[1]) < r + c.r + CLAIM_RULES.gap) return fail(p, msg, 'claimGap', { name: c.ownerName });
      }
      const foreign = forNear(x, z, r + 2, (o) => !!o.owner && o.owner !== p.id && Math.hypot(o.x - x, o.z - z) < r);
      if (foreign) return fail(p, msg, 'claimForeign');
    }
    if (def.smp?.spawn && p.spawnId && W.structures.has(p.spawnId)) return fail(p, msg, 'spawnLimit');
    // occupancy
    const keys = slotKeys(def, x, z, rot, level, variant);
    for (const k of keys) if (slots.has(k)) return fail(p, msg, 'occupied');
    if (def.snap === 'free') {
      const rad = def.radius || 1;
      const hit = forNear(x, z, rad + 3, (o) => {
        const od = PIECE[o.type];
        if (!od || od.snap !== 'free' || Math.abs(o.y - y) > 1.5) return false;
        return Math.hypot(o.x - x, o.z - z) < (rad + (od.radius || 1)) * 0.8;
      });
      if (hit) return fail(p, msg, 'occupied');
    }
    if (!canAfford(p.inv, def.cost)) return fail(p, msg, 'cost');
    pay(p.inv, def.cost, p.dirty);
    const rec = { id: W.nid('s'), type: def.id, x: r2(x), y: r2(y), z: r2(z), rot: r2(rot), level, owner: p.id, ownerName: p.name, t: W.now() };
    if (variant) rec.variant = variant;
    insert(rec);
    p.structCount++;
    W.emit('*', { t: S.STRUCT, add: [view(rec)], by: p.id, cid: msg.cid, ok: true });
    if (def.smp?.claim) {
      const c = { id: W.nid('c'), owner: p.id, ownerName: p.name, p: [rec.x, rec.z], r: def.smp.claim, sid: rec.id, t: W.now() };
      W.claims.set(c.id, c);
      p.claimId = c.id;
      touch(p.id, p.name);
      W.emit('*', { t: S.CLAIMS, add: [claimView(c)] });
    }
    if (def.smp?.spawn) p.spawnId = rec.id;
    W.flushInv(p);
    return true;
  }

  function remove(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    const rec = W.structures.get(msg.id);
    if (!rec) return W.deny(p, msg, 'gone');
    if (rec.owner !== p.id) {
      // ownerless legacy pieces can be cleared by the owner of the claim they stand in
      const c = claimAt(rec.x, rec.z);
      if (rec.owner || !c || c.owner !== p.id) return W.deny(p, msg, 'notOwner');
    }
    if (Math.hypot(rec.x - p.x, rec.z - p.z) > REACH + 10) return W.deny(p, msg, 'far');
    const def = PIECE[rec.type];
    erase(rec);
    if (rec.owner === p.id) p.structCount = Math.max(0, p.structCount - 1);
    const refund = refundOf(def?.cost);
    gain(p.inv, refund, p.dirty);
    W.emit('*', { t: S.STRUCT, remove: [rec.id], by: p.id, cid: msg.cid, ok: true, refund });
    for (const c of W.claims.values()) {
      if (c.sid === rec.id) {
        W.claims.delete(c.id);
        if (p.claimId === c.id) p.claimId = null;
        const owner = W.players.get(c.owner);
        if (owner && owner.claimId === c.id) owner.claimId = null;
        W.emit('*', { t: S.CLAIMS, remove: [c.id] });
        break;
      }
    }
    if (p.spawnId === rec.id) p.spawnId = null;
    W.flushInv(p);
    return true;
  }

  /**
   * Host / moderation (§11.2 "admins can remove a build"): removes structures by
   * ids, owner and/or area — no refund; claims whose beacon goes are dropped.
   * Broadcasts S.STRUCT {remove, by: null, reason} (+ S.CLAIMS remove). → removed ids
   */
  function adminRemove({ ids, owner, near } = {}, reason = 'admin') {
    const set = new Set();
    if (Array.isArray(ids)) for (const id of ids) if (W.structures.has(id)) set.add(W.structures.get(id));
    if (typeof owner === 'string' && owner) for (const rec of W.structures.values()) if (rec.owner === owner) set.add(rec);
    if (Array.isArray(near) && near.length >= 3 && near.every(isNum)) {
      const [nx, nz, nr] = near;
      forNear(nx, nz, nr, (rec) => {
        if (Math.hypot(rec.x - nx, rec.z - nz) <= nr) set.add(rec);
        return false;
      });
    }
    if (!set.size) return [];
    const claims = [];
    for (const rec of set) {
      erase(rec);
      const o = W.players.get(rec.owner);
      if (o) {
        o.structCount = Math.max(0, o.structCount - 1);
        if (o.spawnId === rec.id) o.spawnId = null;
      }
      for (const c of W.claims.values()) {
        if (c.sid !== rec.id) continue;
        W.claims.delete(c.id);
        claims.push(c.id);
        const co = W.players.get(c.owner);
        if (co && co.claimId === c.id) co.claimId = null;
      }
    }
    const removed = [...set].map((r) => r.id);
    W.emit('*', { t: S.STRUCT, remove: removed, by: null, reason: String(reason || 'admin').slice(0, 24) });
    if (claims.length) W.emit('*', { t: S.CLAIMS, remove: claims });
    return removed;
  }

  /** Workbench → Workbench Mk II (recipe 'workbench-t2'); upsert broadcast. */
  function upgrade(rec, type) {
    erase(rec);
    rec.type = type;
    insert(rec);
    W.emit('*', { t: S.STRUCT, add: [view(rec)], upd: true });
  }

  /** Recomputes a joining player's counters from the world (owner = player id). */
  function attachPlayer(p) {
    let n = 0;
    p.spawnId = null;
    for (const rec of W.structures.values()) {
      if (rec.owner !== p.id) continue;
      n++;
      if (PIECE[rec.type]?.smp?.spawn) p.spawnId = rec.id;
    }
    p.structCount = n;
    p.claimId = null;
    for (const c of W.claims.values()) if (c.owner === p.id) p.claimId = c.id;
  }

  function importSave(save) {
    for (const r of Array.isArray(save.structures) ? save.structures : []) {
      if (!r || typeof r.id !== 'string' || !PIECE[r.type] || !isNum(r.x) || !isNum(r.y) || !isNum(r.z)) continue;
      const rec = { id: r.id, type: r.type, x: r.x, y: r.y, z: r.z, rot: isNum(r.rot) ? r.rot : 0, level: isNum(r.level) ? r.level : 0, owner: r.owner ?? null, ownerName: r.ownerName, t: r.t || 0 };
      if (r.variant) rec.variant = r.variant;
      insert(rec);
    }
    for (const c of Array.isArray(save.claims) ? save.claims : []) {
      if (!c || typeof c.id !== 'string' || !Array.isArray(c.p) || !isNum(c.r)) continue;
      if (c.sid && !W.structures.has(c.sid)) continue;
      const rec = { id: c.id, owner: c.owner, ownerName: c.ownerName ?? c.name, p: [c.p[0], c.p[1]], r: c.r, sid: c.sid, t: isNum(c.t) ? c.t : W.now() };
      if (isNum(c.decay) && c.decay > 0) rec.decay = c.decay;
      W.claims.set(c.id, rec);
    }
    // owners (last seen) — unknown owners of imported claims get a fresh grace period
    // server downtime doesn't count as owner inactivity: shift "last seen" by the time since the save
    const owners = save.owners && typeof save.owners === 'object' ? save.owners : {};
    const down = isNum(save.at) ? Math.max(0, W.now() - save.at) : 0;
    for (const [id, o] of Object.entries(owners)) {
      if (!o || !isNum(o.seen)) continue;
      W.owners.set(id, { name: String(o.name || ''), seen: o.seen + down, notices: Array.isArray(o.notices) ? o.notices.slice(-8) : [] });
    }
    for (const c of W.claims.values()) if (c.owner && !W.owners.has(c.owner)) touch(c.owner, c.ownerName);
  }

  /** Owners worth saving: claim holders and owners with pending notices. */
  function exportOwners() {
    const keep = new Set();
    for (const c of W.claims.values()) keep.add(c.owner);
    const out = {};
    for (const [id, o] of W.owners) if (keep.has(id) || o.notices.length) out[id] = { name: o.name, seen: o.seen, notices: o.notices.slice(-8) };
    return out;
  }

  /** Nearest workbench of at least `tier` within r of (x, y, z). */
  function workbenchNear(x, y, z, r, tier) {
    let best = null;
    let bd = Infinity;
    forNear(x, z, r + 2, (rec) => {
      const t = PIECE[rec.type]?.smp?.station === 'workbench' ? PIECE[rec.type].smp.tier : 0;
      if (t < tier) return false;
      const d = Math.hypot(rec.x - x, rec.z - z);
      if (d <= r && Math.abs(rec.y - y) < 4 && d < bd) {
        bd = d;
        best = rec;
      }
      return false;
    });
    return best;
  }

  return {
    place,
    remove,
    adminRemove,
    upgrade,
    attachPlayer,
    importSave,
    claimAt,
    forNear,
    workbenchNear,
    stepDecay,
    joinNotices,
    touch,
    exportOwners,
    claimView,
    records: () => [...W.structures.values()].map(view),
    claimList: () => [...W.claims.values()].map(claimView),
  };
}
