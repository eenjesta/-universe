/**
 * Remote entity registry: players / enemies / loot / projectiles as Maps
 * (id → entity) fed by S.SNAP / S.JOIN / S.LEAVE / S.LOOT and interpolated
 * every frame into `entity.view` (allocation-free after an entity exists).
 *
 * Player entity: { id, kind: 'player', name, appearance, inRange, lastSeen, joinedAt,
 *   view: { p: Vector3, h, a, m, hp, sh, veh: null | { type, p: Vector3, h }, v: Vector3, speed, dead } }
 * Enemy entity:  { id, kind: 'enemy', type, inRange, lastSeen,
 *   view: { p: Vector3, h, s, hp, type, target (player id it is after | null), v: Vector3, speed, dead } }
 * Projectile:    { id, kind: 'projectile', type, view: { p: Vector3, type, v: Vector3 } }
 * Loot:          { id, kind: 'loot', p: Vector3, items, owner, ttl, expires, view: { p } }
 *
 * Snapshot rows (shared/protocol.js S.SNAP):
 *   pl: [id, x, y, z, h, a, m, hp, sh, veh | 0, w]   veh = [type, x, y, z, h] | {type, p, h} | type; w = weapon id
 *   en: [id, type, x, y, z, h, s, hp, target?]
 *   px: [id, type, x, y, z]
 */
import { Vector3 } from 'three';
import { NET } from '../../shared/protocol.js';
import { Track } from './interp.js';

const GONE_GRACE_MS = 1200; // enemies/projectiles missing from snapshots are removed after this (render time)

function vehOf(raw, out) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    out.type = raw;
    out.has = false;
    return out;
  }
  if (Array.isArray(raw)) {
    out.type = String(raw[0] ?? '');
    out.has = raw.length >= 4 && Number.isFinite(raw[1]);
    if (out.has) {
      out.x = raw[1];
      out.y = raw[2];
      out.z = raw[3];
      out.h = Number.isFinite(raw[4]) ? raw[4] : 0;
    }
    return out;
  }
  if (typeof raw === 'object') {
    out.type = String(raw.type ?? '');
    const p = raw.p;
    out.has = Array.isArray(p) && Number.isFinite(p[0]);
    if (out.has) {
      out.x = p[0];
      out.y = p[1];
      out.z = p[2];
      out.h = Number.isFinite(raw.h) ? raw.h : 0;
    }
    return out;
  }
  return null;
}

export function createRemotes({ delay = NET.INTERP_DELAY_MS, onUnknownPlayer = null } = {}) {
  const players = new Map();
  const enemies = new Map();
  const loot = new Map();
  const projectiles = new Map();
  const tmp = { x: 0, y: 0, z: 0, h: 0, vx: 0, vy: 0, vz: 0, d: null, dn: null, extrapolating: false };
  const vtmp = { type: '', has: false, x: 0, y: 0, z: 0, h: 0 };
  let stamp = 0;
  let lastSnapTime = -Infinity;

  // ------------------------------------------------------------- players
  function makePlayer(id, info = {}) {
    const e = {
      id,
      kind: 'player',
      name: info.name || 'Player',
      appearance: info.appearance || null,
      joinedAt: info.joinedAt || 0,
      known: !!info.name,
      inRange: false,
      lastSeen: -Infinity,
      seen: 0,
      track: new Track(),
      vehTrack: new Track(),
      view: { p: new Vector3(), h: 0, a: 'idle', m: 'foot', hp: 100, sh: 50, veh: null, w: null, v: new Vector3(), speed: 0, dead: false },
      _veh: { type: '', p: new Vector3(), h: 0 },
    };
    players.set(id, e);
    return e;
  }

  /** S.JOIN (or a welcome list entry). Returns { entity, isNew }. */
  function join(id, info = {}) {
    let e = players.get(id);
    if (!e) return { entity: makePlayer(id, { ...info, joinedAt: info.joinedAt ?? Date.now() }), isNew: true };
    const wasKnown = e.known;
    if (info.name) e.name = info.name;
    if (info.appearance) e.appearance = info.appearance;
    e.known = e.known || !!info.name;
    return { entity: e, isNew: false, wasKnown };
  }

  function leave(id) {
    const e = players.get(id);
    if (e) players.delete(id);
    return e || null;
  }

  // ------------------------------------------------------------ snapshots
  function applySnapshot(msg, myId) {
    const st = Number(msg.st);
    if (!Number.isFinite(st)) return;
    lastSnapTime = st;
    stamp++;
    const pl = Array.isArray(msg.pl) ? msg.pl : [];
    for (let i = 0; i < pl.length; i++) {
      const r = pl[i];
      if (!Array.isArray(r)) continue;
      const id = r[0];
      if (id === myId) continue;
      let e = players.get(id);
      if (!e) {
        e = makePlayer(id, {});
        onUnknownPlayer?.(e);
      }
      const reenter = !e.inRange && e.lastSeen < st - 2000;
      e.track.push(st, +r[1], +r[2], +r[3], +r[4], r);
      if (reenter && e.track.size > 1) reseed(e.track);
      const veh = vehOf(r[9], vtmp);
      if (veh?.has) e.vehTrack.push(st, veh.x, veh.y, veh.z, veh.h, null);
      else if (!veh && e.vehTrack.size) e.vehTrack.clear();
      e.inRange = true;
      e.lastSeen = st;
      e.seen = stamp;
    }
    for (const e of players.values()) if (e.seen !== stamp) e.inRange = false;

    const en = Array.isArray(msg.en) ? msg.en : [];
    for (let i = 0; i < en.length; i++) {
      const r = en[i];
      if (!Array.isArray(r)) continue;
      const id = r[0];
      let e = enemies.get(id);
      if (!e) {
        e = {
          id,
          kind: 'enemy',
          type: r[1],
          inRange: true,
          lastSeen: st,
          seen: stamp,
          goneAt: 0,
          firstSeen: st,
          track: new Track(),
          view: { p: new Vector3(+r[2], +r[3], +r[4]), h: +r[5] || 0, s: r[6], hp: r[7], type: r[1], target: r[8] ?? null, v: new Vector3(), speed: 0, dead: false },
        };
        enemies.set(id, e);
      }
      e.type = r[1];
      e.track.push(st, +r[2], +r[3], +r[4], +r[5], r);
      e.inRange = true;
      e.lastSeen = st;
      e.seen = stamp;
      e.goneAt = 0;
    }
    for (const e of enemies.values()) if (e.seen !== stamp && !e.goneAt) e.goneAt = st;

    const px = Array.isArray(msg.px) ? msg.px : [];
    for (let i = 0; i < px.length; i++) {
      const r = px[i];
      if (!Array.isArray(r)) continue;
      const id = r[0];
      let e = projectiles.get(id);
      if (!e) {
        e = { id, kind: 'projectile', type: r[1], seen: stamp, goneAt: 0, track: new Track(12), view: { p: new Vector3(+r[2], +r[3], +r[4]), type: r[1], v: new Vector3() } };
        projectiles.set(id, e);
      }
      e.track.push(st, +r[2], +r[3], +r[4], 0, r);
      e.seen = stamp;
      e.goneAt = 0;
    }
    for (const e of projectiles.values()) if (e.seen !== stamp && !e.goneAt) e.goneAt = st;
  }

  // keep only the newest sample when an entity re-enters interest range (no sweep from the old spot)
  function reseed(track) {
    const i = track.newest;
    const t = track.t[i];
    const x = track.x[i];
    const y = track.y[i];
    const z = track.z[i];
    const h = track.h[i];
    const d = track.d[i];
    track.clear();
    track.push(t, x, y, z, h, d);
  }

  // ------------------------------------------------------------ loot
  function addLoot(l, now = Date.now()) {
    if (!l || l.id == null) return null;
    const p = Array.isArray(l.p) ? l.p : [0, 0, 0];
    let e = loot.get(l.id);
    if (!e) {
      e = { id: l.id, kind: 'loot', p: new Vector3(), items: null, owner: null, ttl: 0, expires: 0, view: null };
      e.view = { p: e.p };
      loot.set(l.id, e);
    }
    e.p.set(+p[0] || 0, +p[1] || 0, +p[2] || 0);
    e.items = l.items || {};
    e.owner = l.owner ?? null;
    e.ttl = Number(l.ttl) || 0;
    e.expires = e.ttl > 0 ? now + e.ttl * 1000 : 0;
    e.raw = l;
    return e;
  }

  function removeLoot(id) {
    const e = loot.get(id);
    if (e) loot.delete(id);
    return e || null;
  }

  // ------------------------------------------------------------ per frame
  /** Interpolates every view at render time rt = serverTime − delay. */
  function update(serverNow, wallNow = Date.now()) {
    const rt = serverNow - delay;
    for (const e of players.values()) interpPlayer(e, rt);
    for (const [id, e] of enemies) {
      // vanished from the snapshots: keep it until the render time passes that moment
      if (e.goneAt && (rt > e.goneAt + 50 || serverNow - e.goneAt > GONE_GRACE_MS + delay)) {
        enemies.delete(id);
        continue;
      }
      interpEnemy(e, rt);
    }
    for (const [id, e] of projectiles) {
      if (e.goneAt && rt > e.goneAt) {
        projectiles.delete(id);
        continue;
      }
      if (e.track.sample(rt, tmp, 60)) {
        e.view.p.set(tmp.x, tmp.y, tmp.z);
        e.view.v.set(tmp.vx, tmp.vy, tmp.vz);
      }
    }
    for (const [id, e] of loot) if (e.expires && wallNow > e.expires + 2000) loot.delete(id);
  }

  function interpPlayer(e, rt) {
    if (!e.track.sample(rt, tmp)) return e.view;
    const v = e.view;
    v.p.set(tmp.x, tmp.y, tmp.z);
    v.h = tmp.h;
    v.v.set(tmp.vx, tmp.vy, tmp.vz);
    v.speed = Math.hypot(tmp.vx, tmp.vz);
    const d = tmp.d;
    const dn = tmp.dn;
    if (d) {
      v.a = d[5] ?? 'idle';
      v.m = d[6] ?? 'foot';
      v.w = typeof d[10] === 'string' && d[10] ? d[10] : null; // equipped weapon id (sim row index 10)
      const veh = vehOf(d[9], vtmp);
      if (veh) {
        const pv = e._veh;
        pv.type = veh.type;
        if (veh.has && e.vehTrack.sample(rt, tmp)) {
          pv.p.set(tmp.x, tmp.y, tmp.z);
          pv.h = tmp.h;
        } else {
          pv.p.copy(v.p);
          pv.h = v.h;
        }
        v.veh = pv;
      } else v.veh = null;
    }
    if (dn) {
      if (Number.isFinite(dn[7])) v.hp = dn[7];
      if (Number.isFinite(dn[8])) v.sh = dn[8];
    }
    v.dead = v.m === 'dead' || v.a === 'dead' || v.hp <= 0;
    return v;
  }

  function interpEnemy(e, rt) {
    if (!e.track.sample(rt, tmp)) return e.view;
    const v = e.view;
    v.p.set(tmp.x, tmp.y, tmp.z);
    v.h = tmp.h;
    v.v.set(tmp.vx, tmp.vy, tmp.vz);
    v.speed = Math.hypot(tmp.vx, tmp.vz);
    if (tmp.d) v.s = tmp.d[6];
    if (tmp.dn) {
      if (Number.isFinite(tmp.dn[7])) v.hp = tmp.dn[7];
      v.type = tmp.dn[1];
      v.target = tmp.dn[8] ?? null;
    }
    v.dead = v.s === 6 || v.s === 'dead' || v.hp <= 0;
    return v;
  }

  /** Refreshes one entity's view now (ctx.net.interp(entity)). */
  function interp(e, serverNow) {
    if (!e) return null;
    const rt = serverNow - delay;
    if (e.kind === 'player') return interpPlayer(e, rt);
    if (e.kind === 'enemy') return interpEnemy(e, rt);
    if (e.kind === 'projectile' && e.track.sample(rt, tmp, 60)) e.view.p.set(tmp.x, tmp.y, tmp.z);
    return e.view;
  }

  /** Drops everything (new world / offline switch). */
  function clear({ keepPlayers = false } = {}) {
    if (!keepPlayers) players.clear();
    enemies.clear();
    loot.clear();
    projectiles.clear();
  }

  return {
    players,
    enemies,
    loot,
    projectiles,
    join,
    leave,
    applySnapshot,
    addLoot,
    removeLoot,
    update,
    interp,
    clear,
    get lastSnapTime() {
      return lastSnapTime;
    },
  };
}
