/**
 * Ø Universe SMP simulation — authoritative, pure JS (no DOM, no Node APIs).
 * Runs in the Node server (server/) and in the browser LocalServer (src/net/).
 * Contract: PLATFORM.md §4 + shared/protocol.js; usage: shared/sim/README.md.
 *
 *   const sim = createSim({ getHeightAt, isWater, now: () => ms, seed, world,
 *                           worldgen?, isSafe?, spawnRules?, nodesNear?, isBuildable?, biomeAt?, trusted?, claimDecay? })
 *   sim.addPlayer({ id, name, appearance, save }) → S.WELCOME message (server adds you.token)
 *   sim.removePlayer(id) → playerSave
 *   sim.handle(id, msg) → bool                  any client message except hello/chat/ping/profile
 *   sim.step(dtSeconds)                         20 Hz (NET.TICK_HZ)
 *   sim.drain() → [{ to: id | '*' | { near: [x, z, r] }, msg }]
 *   sim.snapshotFor(id) → S.SNAP message        interest-managed (NET.INTEREST_RADIUS)
 *   sim.exportWorld() → worldSave               importWorld via createSim({ world }) or sim.importWorld(save)
 *   sim.exportPlayer(id) → playerSave
 *   sim.stats() → { players, enemies, loot, structures, claims, projectiles }
 * Extras: recipients(to) → ids, playersNear(x, z, r) → ids, playerPos(id) → [x, y, z] | null,
 *   setProfile(id, {name, appearance}), setClock(id, {offset}), teleport(id, [x, y, z], h?),
 *   removeStructures({ids?, owner?, near?: [x, z, r]}, reason?) → removed ids (moderation, no refund),
 *   time() → {hour, dayFactor}, setTime(hour), nodes → the hub's harvest nodes,
 *   nodesNear(x, z, r) → hub + world nodes, isSafe(x, z), biomeAt(x, z), has(id), playerIds().
 *
 * The world (PLATFORM.md §11): one seamless world — the safe hub in the middle,
 * the infinite survival planet around it. Location-specific rules come from
 * world providers (world.js): pass `worldgen` (a createWorldgen() instance) or
 * individual functions; without them the stand-in (standin.js) is used.
 */
import { NET, C, S, PROTOCOL_VERSION } from '../protocol.js';
import { mulberry32, hashString } from './rng.js';
import { r2, isNum } from './util.js';
import { DEFAULT_HOUR, HOURS_PER_SECOND, wrapHour, dayFactorAt } from './zones.js';
import {
  createPlayer,
  exportPlayer as exportPlayerSave,
  stepSurvival,
  handleState,
  handleRespawn,
  handleUse,
  flushStats,
  statsPayload,
  isSafeFor,
} from './players.js';
import { invPayload } from './inventory.js';
import { createCombat } from './combat.js';
import { createEnemies } from './enemies.js';
import { createLoot } from './loot.js';
import { createEconomy } from './economy.js';
import { createBuild } from './build.js';
import { generateNodes } from './nodes.js';
import { WEAPON_SLOTS } from '../defs/weapons.js';
import { resolveWorld } from './world.js';
import { createTravel } from './travel.js';
import { HUB, CLAIM_RULES } from '../defs/world.js';

export { PROTOCOL_VERSION };

export function createSim(opts = {}) {
  const getHeightAt = typeof opts.getHeightAt === 'function' ? opts.getHeightAt : () => 0;
  const isWater = typeof opts.isWater === 'function' ? opts.isWater : () => false;
  const now = typeof opts.now === 'function' ? opts.now : () => 0;
  const seed = String(opts.seed ?? 'o-universe');

  const W = {
    seed,
    now,
    H: getHeightAt,
    isWater,
    world: resolveWorld(opts, { seed, H: getHeightAt, isWater }),
    trusted: !!opts.trusted, // in-browser LocalServer: no hourly grant budget
    claimDecay: opts.claimDecay ?? !opts.trusted, // §11.2 claim decay (never in the single-player LocalServer)
    owners: new Map(), // owner id → { name, seen, notices } (claim decay)
    rng: mulberry32(hashString(`${seed}:sim`)),
    players: new Map(),
    enemies: new Map(),
    structures: new Map(),
    claims: new Map(),
    projectiles: new Map(),
    out: [],
    tick: 0,
    hour: DEFAULT_HOUR,
    day: dayFactorAt(DEFAULT_HOUR),
    ids: { e: 0, l: 0, s: 0, x: 0, c: 0 },
    nid(prefix) {
      W.ids[prefix] = (W.ids[prefix] || 0) + 1;
      return `${prefix}${W.ids[prefix]}`;
    },
    emit(to, msg) {
      W.out.push({ to, msg });
    },
    deny(p, msg, reason, extra) {
      const m = { t: S.DENY, of: msg?.t, reason };
      if (msg && msg.cid !== undefined) m.cid = msg.cid;
      if (extra) Object.assign(m, extra);
      W.emit(p.id, m);
      return false;
    },
    flushInv(p, ack) {
      if (!p.dirty.size && ack === undefined) return;
      const m = { t: S.INV, patch: true, ...invPayload(p.inv, p.dirty) };
      if (ack !== undefined) m.ack = ack;
      p.dirty.clear();
      W.emit(p.id, m);
    },
    isSafeFor: (p) => isSafeFor(W, p),
  };
  W.nodes = generateNodes({ getHeightAt, isWater });
  W.nodeById = new Map(W.nodes.map((n) => [n.id, n]));
  W.nodeState = new Map(); // id → respawnAt (ms)

  W.loot = createLoot(W);
  W.build = createBuild(W);
  W.enemiesSys = createEnemies(W);
  W.combat = createCombat(W);
  W.economy = createEconomy(W);
  W.travel = createTravel(W);

  if (opts.world) importWorld(opts.world);

  // ------------------------------------------------------------ players
  function addPlayer({ id, name, appearance, save } = {}) {
    id = String(id);
    if (W.players.has(id)) removePlayer(id);
    const p = createPlayer(W, { id, name, appearance, save });
    W.build.attachPlayer(p);
    const notices = W.build.joinNotices(p);
    const others = [];
    for (const o of W.players.values()) {
      others.push({ id: o.id, name: o.name, appearance: o.appearance });
      W.emit(o.id, { t: S.JOIN, id: p.id, name: p.name, appearance: p.appearance });
    }
    W.players.set(id, p);
    const now = W.now();
    const depleted = [];
    for (const [nid, at] of W.nodeState) if (at > now) depleted.push([nid, at]);
    const you = { id: p.id, name: p.name, p: [r2(p.x), r2(p.y), r2(p.z)], h: r2(p.h), dead: p.dead || undefined, safe: p.safe };
    const claim = p.claimId && W.claims.get(p.claimId);
    if (claim) you.claim = { id: claim.id, p: [claim.p[0], claim.p[1]], r: claim.r };
    const beacon = p.spawnId && W.structures.get(p.spawnId);
    if (beacon) you.beacon = [beacon.x, beacon.z];
    const welcome = {
      t: S.WELCOME,
      v: PROTOCOL_VERSION,
      you,
      world: { seed: W.seed, time: r2(W.hour), dayFactor: r2(W.day), st: now, n: W.players.size, players: others, hub: HUB, claims: CLAIM_RULES, provider: W.world.kind },
      inv: invPayload(p.inv),
      stats: statsPayload(p),
      structures: W.build.records(),
      claims: W.build.claimList(),
      loot: W.loot.list(),
      nodes: depleted,
    };
    if (notices.length) welcome.notices = notices;
    return welcome;
  }

  function removePlayer(id) {
    id = String(id);
    const p = W.players.get(id);
    if (!p) return null;
    const save = exportPlayerSave(p);
    p.travel = null;
    W.build.touch(p.id, p.name);
    W.players.delete(id);
    W.combat.forget(p);
    W.emit('*', { t: S.LEAVE, id });
    return save;
  }

  function setProfile(id, { name, appearance } = {}) {
    const p = W.players.get(String(id));
    if (!p) return false;
    if (typeof name === 'string' && name.trim()) p.name = name.trim().slice(0, 24);
    if (appearance && typeof appearance === 'object') p.appearance = JSON.parse(JSON.stringify(appearance));
    for (const o of W.players.values()) if (o !== p) W.emit(o.id, { t: S.JOIN, id: p.id, name: p.name, appearance: p.appearance });
    return true;
  }

  // ------------------------------------------------------------ messages
  const HANDLERS = {
    [C.STATE]: (p, m) => handleState(W, p, m),
    [C.FIRE]: (p, m) => W.combat.fire(p, m),
    [C.HIT]: (p, m) => W.combat.hit(p, m),
    [C.THROW]: (p, m) => W.combat.throwGrenade(p, m),
    [C.RELOAD]: (p, m) => W.combat.reload(p, m),
    [C.EQUIP]: (p, m) => W.combat.equip(p, m),
    [C.RESPAWN]: (p, m) => handleRespawn(W, p, m),
    [C.HARVEST]: (p, m) => W.economy.harvest(p, m),
    [C.CRAFT]: (p, m) => W.economy.craft(p, m),
    [C.USE]: (p, m) => handleUse(W, p, m),
    [C.PICKUP]: (p, m) => W.loot.pickup(p, m),
    [C.BUILD_PLACE]: (p, m) => W.build.place(p, m),
    [C.BUILD_REMOVE]: (p, m) => W.build.remove(p, m),
    [C.GRANT]: (p, m) => W.economy.grant(p, m),
    [C.SPEND]: (p, m) => W.economy.spend(p, m),
    [C.TRAVEL]: (p, m) => W.travel.handle(p, m),
  };

  function handle(id, msg) {
    const p = W.players.get(String(id));
    if (!p || !msg || typeof msg !== 'object') return false;
    const fn = HANDLERS[msg.t];
    if (!fn) return false;
    try {
      const r = fn(p, msg);
      W.flushInv(p);
      return r !== false;
    } catch (err) {
      // a malformed message must never take the world down
      if (typeof console !== 'undefined') console.warn('[sim] handler error', msg.t, err?.message || err);
      return false;
    }
  }

  // ------------------------------------------------------------ step
  function step(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.25);
    W.tick++;
    W.hour = wrapHour(W.hour + dt * HOURS_PER_SECOND);
    W.day = dayFactorAt(W.hour);
    for (const p of W.players.values()) stepSurvival(W, p, dt);
    W.travel.step();
    W.combat.step(dt);
    W.enemiesSys.step(dt);
    W.loot.step(dt);
    W.build.stepDecay(dt);
    if (W.tick % 1200 === 0) W.economy.prune();
    for (const p of W.players.values()) {
      flushStats(W, p);
      W.flushInv(p);
    }
  }

  function drain() {
    const out = W.out;
    W.out = [];
    return out;
  }

  // ------------------------------------------------------------ snapshots
  const R2 = NET.INTEREST_RADIUS * NET.INTEREST_RADIUS;
  let rowsTick = -1;
  const plRows = new Map();
  function rowsFor() {
    if (rowsTick === W.tick) return;
    rowsTick = W.tick;
    plRows.clear();
    for (const p of W.players.values()) {
      // [id, x, y, z, h, a, m, hp, sh, veh | 0, weapon id | ''] — the weapon lets others see what you hold
      const row = [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.h), p.a, p.dead ? 'dead' : p.m, Math.round(p.hp), Math.round(p.sh), p.veh || 0, WEAPON_SLOTS[p.inv?.slot] || ''];
      plRows.set(p.id, row);
    }
  }

  function snapshotFor(id) {
    const me = W.players.get(String(id));
    if (!me) return null;
    rowsFor();
    const pl = [];
    for (const p of W.players.values()) {
      if (p === me) continue;
      const dx = p.x - me.x;
      const dz = p.z - me.z;
      if (dx * dx + dz * dz > R2) continue;
      pl.push(plRows.get(p.id));
    }
    return { t: S.SNAP, st: W.now(), tod: r2(W.hour), n: W.players.size, pl, en: W.enemiesSys.rowsNear(me.x, me.z, R2), px: W.combat.rowsNear(me.x, me.z, R2) };
  }

  // ------------------------------------------------------------ persistence
  function exportWorld() {
    return {
      v: 1,
      at: W.now(), // save time: downtime is not counted as owner inactivity on import
      time: r2(W.hour),
      ids: { ...W.ids },
      structures: W.build.records(),
      claims: W.build.claimList(),
      owners: W.build.exportOwners(),
      loot: W.loot.exportSave(),
    };
  }

  function importWorld(save) {
    if (!save || typeof save !== 'object') return false;
    if (isNum(save.time)) {
      W.hour = wrapHour(save.time);
      W.day = dayFactorAt(W.hour);
    }
    if (save.ids && typeof save.ids === 'object') for (const k of Object.keys(W.ids)) if (isNum(save.ids[k])) W.ids[k] = Math.max(W.ids[k], save.ids[k]);
    W.build.importSave(save);
    W.loot.importSave(save.loot);
    for (const p of W.players.values()) W.build.attachPlayer(p);
    return true;
  }

  function exportPlayer(id) {
    const p = W.players.get(String(id));
    return p ? exportPlayerSave(p) : null;
  }

  function stats() {
    return {
      players: W.players.size,
      enemies: W.enemies.size,
      loot: W.loot.size(),
      structures: W.structures.size,
      claims: W.claims.size,
      projectiles: W.projectiles.size,
      world: W.world.kind,
    };
  }

  // ------------------------------------------------------------ helpers for the host
  function playersNear(x, z, r) {
    const out = [];
    const rr = r * r;
    for (const p of W.players.values()) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz <= rr) out.push(p.id);
    }
    return out;
  }

  /** Resolves a drain() address into player ids. */
  function recipients(to) {
    if (to === '*') return [...W.players.keys()];
    if (typeof to === 'string') return W.players.has(to) ? [to] : [];
    if (to && Array.isArray(to.near)) return playersNear(to.near[0], to.near[1], to.near[2]);
    return [];
  }

  function playerPos(id) {
    const p = W.players.get(String(id));
    return p ? [r2(p.x), r2(p.y), r2(p.z)] : null;
  }

  /** Trusted host teleport (LocalServer page moves, admin tools): no validation, no S.CORRECT. */
  function teleport(id, pos, h) {
    const p = W.players.get(String(id));
    if (!p || !Array.isArray(pos) || !pos.every?.((v, i) => i > 2 || isNum(v))) return false;
    p.x = pos[0];
    p.y = pos[1];
    p.z = pos[2];
    if (isNum(h)) p.h = h;
    p.vx = p.vy = p.vz = 0;
    p.expect = null;
    p.lastStateAt = W.now();
    p.safe = W.world.isSafe(p.x, p.z);
    return true;
  }

  /** Moderation: remove structures by {ids?, owner?, near?: [x, z, r]} (no refund) → removed ids. */
  function removeStructures(filter, reason) {
    return W.build.adminRemove(filter || {}, reason);
  }

  function setClock(id, { offset } = {}) {
    const p = W.players.get(String(id));
    if (p && isNum(offset)) p.ofsHost = offset;
  }

  return {
    addPlayer,
    removePlayer,
    handle,
    step,
    drain,
    snapshotFor,
    exportWorld,
    importWorld,
    exportPlayer,
    stats,
    setProfile,
    recipients,
    playersNear,
    playerPos,
    setClock,
    teleport,
    removeStructures,
    has: (id) => W.players.has(String(id)),
    playerIds: () => [...W.players.keys()],
    time: () => ({ hour: W.hour, dayFactor: W.day }),
    setTime(hour) {
      W.hour = wrapHour(hour);
      W.day = dayFactorAt(W.hour);
    },
    get nodes() {
      return W.nodes;
    },
    /** Hub nodes + world-provider nodes within r of (x, z) (for hosts / debugging). */
    nodesNear(x, z, r) {
      const out = [];
      for (const n of W.nodes) if (Math.hypot(n.x - x, n.z - z) <= r) out.push(n);
      for (const n of W.world.nodesNear(x, z, r)) out.push(n);
      return out;
    },
    isSafe: (x, z) => W.world.isSafe(x, z),
    biomeAt: (x, z) => W.world.biomeAt(x, z),
    /** Internal state (tests / debugging only — not a stable API). */
    _w: W,
  };
}
