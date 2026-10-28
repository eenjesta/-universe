/**
 * Players: records, survival stats (health / shield / energy), damage → death
 * (owner-only drop crate) → respawn, consumables, movement validation (C.STATE)
 * and private stat/inventory flushes. Pure JS.
 *
 * Safe zone (the hub, PLATFORM.md §11): no hunger drain, no damage; enemies
 * don't target players there (nor in their own claim by day).
 */
import { NET, S } from '../protocol.js';
import { SURVIVAL, ITEMS, DEATH_DROP, USE_COOLDOWN, RESOURCE_IDS, AMMO_IDS } from '../defs/items.js';
import { newInventory, invPayload } from './inventory.js';
import { RESPAWN_POINTS } from './zones.js';
import { WORLD_LIMIT, TRAVEL_RULES } from '../defs/world.js';
import { isNum, isVec3, r2, clamp, copy } from './util.js';
import { ZONES, TRAVEL } from '../../src/world/layout.js';

const MODES = new Set(['foot', 'swim', 'car', 'vtol', 'ship', 'build', 'dead', 'space']);
const ANIMS = new Set(['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'swim', 'drive', 'aim', 'shoot', 'dodge', 'build', 'sit', 'wave', 'dead', 'hit', 'reload', 'respawn']);
const VEHICLES = new Set(['car', 'vtol', 'ship', 'colony']);
export const ON_FOOT = new Set(['foot', 'swim', 'build']);
const BOUND = WORLD_LIMIT;
const SPEED_TOL = 1.25;

/** Creates a player record (from a save or fresh). */
export function createPlayer(W, { id, name, appearance, save }) {
  const sv = save && typeof save === 'object' ? save : null;
  const p = {
    id: String(id),
    name: String(name || 'Traveler').slice(0, 24),
    appearance: appearance && typeof appearance === 'object' ? copy(appearance) : null,
    x: 0,
    y: 0,
    z: 0,
    h: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    a: 'idle',
    m: 'foot',
    veh: null,
    lastStateAt: 0,
    expect: null, // {x, y, z, until} after a server-side teleport (respawn / correction)
    lastCorrectAt: -1e9,
    lastTpAt: -1e9,
    hp: SURVIVAL.maxHp,
    sh: SURVIVAL.maxSh,
    en: SURVIVAL.maxEn,
    maxHp: SURVIVAL.maxHp,
    maxSh: SURVIVAL.maxSh,
    maxEn: SURVIVAL.maxEn,
    lastDmgAt: -1e9,
    combatAt: -1e9, // last combat action (shot fired, hit taken from an enemy) — travel lock
    safe: false, // inside a safe zone (refreshed every tick / move)
    travel: null, // { to, until, x, z } while channelling "Return to hub"
    hubReadyAt: 0, // "Return to hub" cooldown end (ms)
    dead: false,
    deadAt: 0,
    killedBy: null,
    inv: newInventory(sv?.inv),
    grants: new Set(Array.isArray(sv?.grants) ? sv.grants.filter((g) => typeof g === 'string') : []),
    grantLog: [], // [{t, credits, res}] rolling hourly budget
    spawnId: null, // own spawn beacon structure id
    claimId: null, // own claim id
    structCount: 0,
    dirty: new Set(), // inventory sections to send
    statsDirty: true,
    statsAt: -1e9,
    sent: { hp: -1, sh: -1, en: -1 },
    useAt: -1e9,
    harvestAt: -1e9,
    fire: null, // combat state (combat.js)
    reload: null,
    ofs: null, // estimated clock offset (server − client) from FIRE ct
    joinedAt: W.now(),
    kills: 0,
    deaths: 0,
  };
  // position
  const sp = sv && isVec3(sv.p) ? sv.p : null;
  if (sp && Math.abs(sp[0]) < BOUND && Math.abs(sp[2]) < BOUND) {
    p.x = sp[0];
    p.z = sp[2];
    const g = W.H(p.x, p.z);
    p.y = Math.max(sp[1], g);
    p.h = isNum(sv.h) ? sv.h : 0;
  } else {
    const s = safeSpot(W, RESPAWN_POINTS.spawn.x, RESPAWN_POINTS.spawn.z);
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    p.h = RESPAWN_POINTS.spawn.h;
  }
  const st = sv?.stats;
  if (st) {
    if (isNum(st.hp)) p.hp = clamp(st.hp, 1, p.maxHp);
    if (isNum(st.sh)) p.sh = clamp(st.sh, 0, p.maxSh);
    if (isNum(st.en)) p.en = clamp(st.en, 0, p.maxEn);
    if (isNum(st.kills)) p.kills = Math.max(0, st.kills | 0);
    if (isNum(st.deaths)) p.deaths = Math.max(0, st.deaths | 0);
  }
  if (sv?.dead) {
    // logged out while down: come back at the respawn screen
    p.dead = true;
    p.hp = 0;
    p.deadAt = W.now() - SURVIVAL.respawnDelay * 1000;
    p.m = 'dead';
  }
  p.expect = { x: p.x, y: p.y, z: p.z, until: W.now() + 4000 };
  p.safe = W.world.isSafe(p.x, p.z);
  return p;
}

/** Server-side move (respawn, travel): position + the movement validator's grace window. */
export function placePlayer(W, p, spot, h) {
  p.x = spot.x;
  p.y = spot.y;
  p.z = spot.z;
  if (isNum(h)) p.h = h;
  p.vx = p.vy = p.vz = 0;
  p.veh = null;
  p.expect = { x: p.x, y: p.y, z: p.z, until: W.now() + 4000 };
  p.safe = W.world.isSafe(p.x, p.z);
}

/** A dry, not-too-steep spot near (x, z) (spiral search on the heightfield). */
export function safeSpot(W, x, z, maxR = 40) {
  const ok = (px, pz) => {
    if (W.isWater(px, pz)) return false;
    const h = W.H(px, pz);
    const s = Math.max(Math.abs(W.H(px + 1, pz) - W.H(px - 1, pz)), Math.abs(W.H(px, pz + 1) - W.H(px, pz - 1))) / 2;
    return h > 0.2 && s < 0.7;
  };
  if (ok(x, z)) return { x, y: W.H(x, z) + 0.05, z };
  for (let r = 2; r <= maxR; r += 2) {
    const n = Math.max(6, Math.round(r * 1.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, y: W.H(px, pz) + 0.05, z: pz };
    }
  }
  return { x, y: W.H(x, z) + 0.05, z };
}

/** Player save (PLATFORM.md §4: { p, h, stats, inv, unlocks } + grants, dead). */
export function exportPlayer(p) {
  return {
    v: 1,
    p: [r2(p.x), r2(p.y), r2(p.z)],
    h: r2(p.h),
    stats: { hp: Math.round(p.hp), sh: Math.round(p.sh), en: r2(p.en), kills: p.kills, deaths: p.deaths },
    inv: invPayload(p.inv),
    unlocks: p.inv.unlocks.slice(),
    grants: [...p.grants].slice(-4000),
    dead: p.dead || undefined,
  };
}

// ------------------------------------------------------------------ survival
export function stepSurvival(W, p, dt) {
  if (p.dead) return;
  const now = W.now();
  p.safe = p.m !== 'space' && W.world.isSafe(p.x, p.z);
  // shield regeneration
  if (p.sh < p.maxSh && now - p.lastDmgAt >= SURVIVAL.shieldDelay * 1000) {
    p.sh = Math.min(p.maxSh, p.sh + SURVIVAL.shieldRegen * dt);
    p.statsDirty = true;
  }
  if (SURVIVAL.hpRegen > 0 && p.hp < p.maxHp && p.en > 0 && now - p.lastDmgAt > 8000) {
    p.hp = Math.min(p.maxHp, p.hp + SURVIVAL.hpRegen * dt);
    p.statsDirty = true;
  }
  // energy drain (+ sprinting), starvation — not in the safe hub
  if (p.m !== 'space' && !p.safe) {
    const sprint = p.m === 'foot' && (p.a === 'run' || p.vx * p.vx + p.vz * p.vz > 31);
    const drain = SURVIVAL.energyDrain + (sprint ? SURVIVAL.sprintDrain : 0);
    if (p.en > 0) {
      p.en = Math.max(0, p.en - drain * dt);
      p.statsDirty = true;
    } else {
      p.starveAcc = (p.starveAcc || 0) + SURVIVAL.starve * dt;
      if (p.starveAcc >= 1) {
        const n = Math.floor(p.starveAcc);
        p.starveAcc -= n;
        damagePlayer(W, p, n, null, 'starve', null, { ignoreShield: true });
      }
    }
  }
}

/**
 * Damage pipeline: shield first, then health. Sends S.DAMAGE to the victim (and
 * `notify` ids, e.g. an attacking player), S.STATS, death at 0 hp.
 * opts: { ignoreShield, crit, w (weapon), byName }
 */
export function damagePlayer(W, p, amount, by, kind, at, opts = {}) {
  if (p.dead || !(amount > 0)) return 0;
  if (W.world.isSafe(p.x, p.z)) return 0; // the hub: no damage at all
  const now = W.now();
  if (by) {
    p.combatAt = now;
    if (p.travel) W.travel.cancel(p, 'combat');
  }
  let left = amount;
  if (!opts.ignoreShield && p.sh > 0) {
    const s = Math.min(p.sh, left);
    p.sh -= s;
    left -= s;
  }
  p.hp = Math.max(0, p.hp - left);
  p.lastDmgAt = now;
  p.statsDirty = true;
  const msg = {
    t: S.DAMAGE,
    target: p.id,
    by,
    amount: Math.round(amount * 10) / 10,
    hp: Math.round(p.hp),
    sh: Math.round(p.sh),
    kind,
    at: at ? [r2(at[0]), r2(at[1]), r2(at[2])] : [r2(p.x), r2(p.y + 1.2), r2(p.z)],
  };
  if (opts.crit) msg.crit = true;
  if (opts.from) msg.from = [r2(opts.from[0]), r2(opts.from[1]), r2(opts.from[2])];
  if (p.hp <= 0) msg.kill = true;
  W.emit(p.id, msg);
  if (p.hp <= 0) killPlayer(W, p, by, kind, opts);
  else flushStats(W, p, true);
  return amount;
}

export function killPlayer(W, p, by, kind, opts = {}) {
  if (p.dead) return;
  const now = W.now();
  p.dead = true;
  p.deadAt = now;
  p.hp = 0;
  p.killedBy = by;
  p.deaths++;
  p.m = 'dead';
  p.reload = null;
  if (p.travel) W.travel.cancel(p, 'dead');
  // drop 30 % of carried resources (+ ammo, not weapons) into an owner-only crate
  const inv = p.inv;
  const bundle = { res: {}, ammo: {} };
  let any = false;
  for (const r of RESOURCE_IDS) {
    const n = Math.floor(inv.res[r] * DEATH_DROP.fraction);
    if (n > 0) {
      inv.res[r] -= n;
      bundle.res[r] = n;
      any = true;
    }
  }
  for (const a of AMMO_IDS) {
    const n = Math.floor(inv.ammo[a] * DEATH_DROP.ammoFraction);
    if (n > 0) {
      inv.ammo[a] -= n;
      bundle.ammo[a] = n;
      any = true;
    }
  }
  let drop;
  if (any) {
    p.dirty.add('res');
    p.dirty.add('ammo');
    drop = W.loot.spawn([p.x, W.H(p.x, p.z) + 0.3, p.z], bundle, { owner: p.id, name: p.name, ttl: DEATH_DROP.ttl, kind: 'grave' });
  }
  const msg = { t: S.DEATH, id: p.id, by, kind, cause: kind, at: [r2(p.x), r2(p.y), r2(p.z)], name: p.name };
  if (drop) msg.drop = drop.id;
  if (opts.byType) msg.byType = opts.byType;
  W.emit('*', msg);
  flushStats(W, p, true);
  W.flushInv(p);
}

/** C.RESPAWN {at: 'beacon' | 'base' | 'spawn'} */
export function handleRespawn(W, p, msg) {
  if (!p.dead) return W.deny(p, msg, 'notDead');
  const now = W.now();
  if (now - p.deadAt < SURVIVAL.respawnDelay * 1000 - 50) return W.deny(p, msg, 'wait');
  let spot = null;
  const at = msg.at;
  if (at === 'beacon' && p.spawnId) {
    const s = W.structures.get(p.spawnId);
    if (s) spot = { x: s.x + 1.6, y: s.y + 0.1, z: s.z + 1.6, keepY: true };
  }
  if (!spot && (at === 'base' || at === 'beacon')) {
    const c = p.claimId && W.claims.get(p.claimId);
    if (c) spot = safeSpot(W, c.p[0] + 3, c.p[1] + 3);
  }
  if (!spot) spot = safeSpot(W, RESPAWN_POINTS.spawn.x + (W.rng() - 0.5) * 6, RESPAWN_POINTS.spawn.z + (W.rng() - 0.5) * 6);
  if (spot.keepY) {
    const g = W.H(spot.x, spot.z);
    spot.y = Math.max(spot.y, g + 0.05);
  }
  p.dead = false;
  p.hp = p.maxHp;
  p.sh = p.maxSh;
  p.en = Math.max(p.en, SURVIVAL.respawnEnergy);
  placePlayer(W, p, spot);
  p.m = 'foot';
  p.a = 'idle';
  p.lastDmgAt = -1e9;
  p.statsDirty = true;
  W.emit('*', { t: S.RESPAWNED, id: p.id, p: [r2(p.x), r2(p.y), r2(p.z)], h: r2(p.h) });
  flushStats(W, p, true);
  return true;
}

/** C.USE {item} — consumables. */
export function handleUse(W, p, msg) {
  if (p.dead) return W.deny(p, msg, 'dead');
  const def = ITEMS[msg.item];
  if (!def || !def.use) return W.deny(p, msg, 'unknown');
  if ((p.inv.items[def.id] || 0) <= 0) return W.deny(p, msg, 'noItem');
  const now = W.now();
  if (now - p.useAt < USE_COOLDOWN * 1000) return W.deny(p, msg, 'cooldown');
  const u = def.use;
  const full = (!u.hp || p.hp >= p.maxHp) && (!u.sh || p.sh >= p.maxSh) && (!u.en || p.en >= p.maxEn - 0.5);
  if (full) return W.deny(p, msg, 'full');
  if (u.hp) p.hp = Math.min(p.maxHp, p.hp + u.hp);
  if (u.sh) p.sh = Math.min(p.maxSh, p.sh + u.sh);
  if (u.en) p.en = Math.min(p.maxEn, p.en + u.en);
  p.inv.items[def.id]--;
  p.dirty.add('items');
  p.useAt = now;
  p.statsDirty = true;
  flushStats(W, p, true);
  W.flushInv(p);
  return true;
}

/** Sends S.STATS when the rounded values changed (≤ 4 Hz unless forced). */
export function flushStats(W, p, force = false) {
  if (!p.statsDirty && !force) return;
  const now = W.now();
  if (!force && now - p.statsAt < 250) return;
  const hp = Math.round(p.hp);
  const sh = Math.round(p.sh);
  const en = Math.round(p.en);
  p.statsDirty = false;
  if (!force && hp === p.sent.hp && sh === p.sent.sh && en === p.sent.en) return;
  p.sent.hp = hp;
  p.sent.sh = sh;
  p.sent.en = en;
  p.statsAt = now;
  W.emit(p.id, { t: S.STATS, hp, sh, en, maxHp: p.maxHp, maxSh: p.maxSh, maxEn: p.maxEn, dead: p.dead || undefined });
}

export const statsPayload = (p) => ({ hp: Math.round(p.hp), sh: Math.round(p.sh), en: Math.round(p.en), maxHp: p.maxHp, maxSh: p.maxSh, maxEn: p.maxEn, dead: p.dead || undefined });

// ------------------------------------------------------------------ movement
/**
 * C.STATE {p, h, v, a, m, veh?, tp?}. Client-authoritative movement, validated:
 * world bounds, horizontal/vertical speed caps per mode (NET.SPEED × 1.25 +
 * slack), teleports only to fast-travel destinations (tp flag) → else S.CORRECT.
 */
export function handleState(W, p, msg) {
  const now = W.now();
  if (!isVec3(msg.p)) return false;
  const [x, y, z] = msg.p;
  if (isNum(msg.h)) p.h = msg.h;
  if (typeof msg.a === 'string' && ANIMS.has(msg.a)) p.a = msg.a;
  if (p.dead) {
    p.lastStateAt = now;
    return true; // frozen until the respawn
  }
  let m = typeof msg.m === 'string' && MODES.has(msg.m) ? msg.m : 'foot';
  if (m === 'dead') m = p.m === 'dead' ? 'foot' : p.m;
  if (Math.abs(x) > BOUND || Math.abs(z) > BOUND || y < -80 || y > 4000) {
    return correct(W, p, 'bounds');
  }
  // after a server teleport, ignore stale positions until the client caught up
  if (p.expect) {
    const d = Math.hypot(x - p.expect.x, z - p.expect.z);
    if (d < 25 || now > p.expect.until) p.expect = null;
    else {
      p.lastStateAt = now;
      return true;
    }
  }
  const dt = clamp((now - (p.lastStateAt || now)) / 1000, 1 / NET.STATE_HZ, 2);
  const dh = Math.hypot(x - p.x, z - p.z);
  const dy = y - p.y;
  const vmax = Math.max(NET.SPEED[m] ?? NET.SPEED.foot, NET.SPEED[p.m] ?? NET.SPEED.foot);
  let ok = true;
  if (m !== 'space' && p.m !== 'space') {
    const allowH = vmax * SPEED_TOL * dt + 3;
    const flying = m === 'vtol' || m === 'ship' || p.m === 'vtol' || p.m === 'ship';
    const allowUp = (flying ? vmax : m === 'car' || p.m === 'car' ? 40 : 14) * dt + 3;
    const allowDown = (flying ? vmax : 75) * dt + 4;
    if (dh > allowH || dy > allowUp || -dy > allowDown) ok = false;
  }
  if (!ok || p.m === 'space' || m === 'space') {
    // legit teleports: fast travel (tp flag), coming back from space at the spaceport
    if (allowedTeleport(W, p, x, z, msg.tp, m)) {
      p.lastTpAt = now;
      ok = true;
    } else if (m === 'space') {
      ok = true; // entering space keeps the last planet position
      p.m = 'space';
      p.lastStateAt = now;
      return true;
    }
  }
  if (!ok) return correct(W, p, 'speed');
  p.x = x;
  p.y = y;
  p.z = z;
  if (isVec3(msg.v)) {
    p.vx = clamp(msg.v[0], -500, 500);
    p.vy = clamp(msg.v[1], -500, 500);
    p.vz = clamp(msg.v[2], -500, 500);
  }
  p.m = m;
  p.veh = sanitizeVeh(msg.veh);
  p.lastStateAt = now;
  if (p.travel && Math.hypot(x - p.travel.x, z - p.travel.z) > TRAVEL_RULES.moveTol) W.travel.cancel(p, 'moved');
  return true;
}

function sanitizeVeh(v) {
  if (!v || typeof v !== 'object' || !VEHICLES.has(v.type) || !isVec3(v.p)) return null;
  return { type: v.type, p: [r2(v.p[0]), r2(v.p[1]), r2(v.p[2])], h: isNum(v.h) ? r2(v.h) : 0 };
}

function allowedTeleport(W, p, x, z, tp, m) {
  const now = W.now();
  if (now - p.lastTpAt < 3000) return false;
  // back from space: the spaceport
  if (p.m === 'space' && m !== 'space') {
    const sp = ZONES.spaceport;
    return Math.hypot(x - sp.x, z - sp.z) < 260;
  }
  if (!tp) return false;
  for (const id of TRAVEL) {
    const zn = ZONES[id];
    if (zn && Math.hypot(x - zn.x, z - zn.z) < 80) return true;
  }
  const c = p.claimId && W.claims.get(p.claimId);
  if (c && Math.hypot(x - c.p[0], z - c.p[1]) < c.r + 10) return true;
  const s = p.spawnId && W.structures.get(p.spawnId);
  if (s && Math.hypot(x - s.x, z - s.z) < 20) return true;
  return false;
}

function correct(W, p, reason) {
  const now = W.now();
  p.lastStateAt = now;
  if (now - p.lastCorrectAt < 400) return false;
  p.lastCorrectAt = now;
  p.expect = { x: p.x, y: p.y, z: p.z, until: now + 2000 };
  W.emit(p.id, { t: S.CORRECT, p: [r2(p.x), r2(p.y), r2(p.z)], reason });
  return false;
}

/** Safe zone (hub) or own claim by day (enemies ignore you, no spawns). */
export function isSafeFor(W, p) {
  if (p.safe) return true;
  if (W.day >= 0.25 && p.claimId) {
    const c = W.claims.get(p.claimId);
    if (c && Math.hypot(p.x - c.p[0], p.z - c.p[1]) < c.r) return true;
  }
  return false;
}

/** Targetable by enemies: alive, on the planet, on foot / swimming / building, not in a safe zone. */
export const targetable = (W, p) => !p.dead && ON_FOOT.has(p.m) && !isSafeFor(W, p);
