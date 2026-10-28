/**
 * Loot crates: enemy drops (public) and death drops (owner-only, 10 min).
 * Record: { id: 'l3', p: [x, y, z], items: {res?, ammo?, items?, credits?, weapons?}, owner?, ttl, kind }
 * S.LOOT {add: [record]} / {remove: [id], by?, got?} go to everyone ('*').
 */
import { S } from '../protocol.js';
import { LOOT } from '../defs/items.js';
import { gain, giveWeapon, isEmptyBundle } from './inventory.js';
import { WEAPONS } from '../defs/weapons.js';
import { r2, isVec3 } from './util.js';

export function createLoot(W) {
  const map = new Map();

  const view = (l, now = W.now()) => {
    const o = { id: l.id, p: l.p, items: l.items, ttl: Math.max(0, Math.round((l.expiresAt - now) / 1000)), kind: l.kind };
    if (l.owner) o.owner = l.owner;
    return o;
  };

  function spawn(p, items, { owner = null, ttl = LOOT.ttl, kind = 'drop' } = {}) {
    if (isEmptyBundle(items)) return null;
    // keep the world bounded: drop the oldest public crate
    if (map.size >= LOOT.maxWorld) {
      let oldest = null;
      for (const l of map.values()) if (!l.owner && (!oldest || l.expiresAt < oldest.expiresAt)) oldest = l;
      if (oldest) remove(oldest.id);
    }
    const l = { id: W.nid('l'), p: [r2(p[0]), r2(p[1]), r2(p[2])], items, owner, kind, expiresAt: W.now() + ttl * 1000 };
    map.set(l.id, l);
    W.emit('*', { t: S.LOOT, add: [view(l)] });
    return l;
  }

  function remove(id, extra) {
    if (!map.delete(id)) return false;
    W.emit('*', { t: S.LOOT, remove: [id], ...extra });
    return true;
  }

  /** C.PICKUP {loot} — within LOOT.pickupRange (+1 m tolerance); owner-only crates. */
  function pickup(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    const l = map.get(msg.loot);
    if (!l) return W.deny(p, msg, 'gone');
    if (l.owner && l.owner !== p.id) return W.deny(p, msg, 'notOwner');
    const d = Math.hypot(p.x - l.p[0], p.z - l.p[2]);
    if (d > LOOT.pickupRange + 1 || Math.abs(p.y - l.p[1]) > 4) return W.deny(p, msg, 'far');
    const it = l.items;
    const got = gain(p.inv, { res: it.res, ammo: it.ammo, items: it.items, credits: it.credits || 0 }, p.dirty);
    // what did not fit stays in the crate
    const left = {};
    for (const sec of ['res', 'ammo', 'items']) {
      if (!it[sec]) continue;
      for (const [k, n] of Object.entries(it[sec])) {
        const rest = n - (got[sec]?.[k] || 0);
        if (rest > 0) (left[sec] || (left[sec] = {}))[k] = rest;
      }
    }
    if (it.weapons?.length) {
      for (const w of it.weapons) {
        if (giveWeapon(p.inv, w, p.dirty)) (got.weapons || (got.weapons = [])).push(w);
        else {
          // duplicate weapon → its ammo instead
          const a = WEAPONS[w]?.ammo;
          if (a) {
            const g = gain(p.inv, { ammo: { [a]: WEAPONS[w].mag * 2 } }, p.dirty);
            if (g.ammo) (got.ammo || (got.ammo = {}))[a] = (got.ammo?.[a] || 0) + g.ammo[a];
          }
        }
      }
    }
    if (isEmptyBundle(left)) remove(l.id, { by: p.id, got });
    else {
      l.items = left;
      W.emit('*', { t: S.LOOT, add: [view(l)], by: p.id, got });
    }
    W.flushInv(p);
    return true;
  }

  function step() {
    const now = W.now();
    for (const l of map.values()) if (now >= l.expiresAt) remove(l.id);
  }

  return {
    map,
    spawn,
    remove,
    pickup,
    step,
    size: () => map.size,
    get: (id) => map.get(id),
    list: () => {
      const now = W.now();
      return [...map.values()].map((l) => view(l, now));
    },
    exportSave() {
      const now = W.now();
      return [...map.values()].map((l) => ({ id: l.id, p: l.p, items: l.items, owner: l.owner || undefined, kind: l.kind, ttl: Math.max(0, Math.round((l.expiresAt - now) / 1000)) }));
    },
    importSave(list) {
      if (!Array.isArray(list)) return;
      const now = W.now();
      for (const r of list) {
        if (!r || typeof r.id !== 'string' || !isVec3(r.p) || !r.items || !(r.ttl > 0)) continue;
        map.set(r.id, { id: r.id, p: r.p.slice(0, 3), items: r.items, owner: r.owner || null, kind: r.kind || 'drop', expiresAt: now + r.ttl * 1000 });
      }
    },
  };
}
