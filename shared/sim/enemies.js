/**
 * Server enemies (PLATFORM.md §8 / §11, threats wave): spawning, AI, damage,
 * loot and the world boss. Pure JS (no DOM / Node APIs), deterministic per seed.
 *
 * Spawning: around every player OUTSIDE the safe hub, from the world provider's
 * spawn tables (W.world.spawnRules(x, z, hour)) + SPAWN_EXTRA (raiders in the badlands /
 * coasts, crystal mites in the highlands); caps per nearby player; never in safe
 * zones / claims / the hub spawn buffer / near fresh arrivals (GRACE). Squads
 * (raiders 2–4, mites 4–7) spawn whole. POI garrisons (outposts → raider squads,
 * ruins → drones, wrecks → mites) when the provider exposes poisNear; wiping one
 * out drops a supply cache. Night hunts (HUNT): announced groups that track a player.
 *
 * Fairness: arrival grace (no targeting for GRACE.arrive s after a Gateway trip /
 * respawn / login, unless you shoot first), telegraphed attacks (drone charge-up,
 * raider aim line, stalker / mite pounce crouch, boss wind-ups) and dodge windows:
 * a roll (C.STATE a: 'dodge', rate limited) avoids hits that land inside it. Player
 * damage from enemies is applied ~150 ms after the visual impact (pending hits) so a
 * well-timed roll counts despite latency.
 *
 * AI: perception with line of sight (terrain), night aggro, alerts (gunfire → C.FIRE
 * noise, deaths, a hurt squadmate) and investigation, pack behaviour (stalker howls,
 * squads share targets), low-HP retreat, hit flinch / knockback.
 *   drone    hovers 6–12 m up, keeps 15–30 m, strafes, charged laser (dodgeable)
 *   stalker  prowls / circles, crouch → pounce, claws; howls to call the pack
 *   raider   squads: cover (terrain, or a deployable barrier), peek + aim + 3-bolt
 *            bursts, a suppressor, a flanker, falls back when hurt
 *   mite     swarm: surrounds the target, hop-bites
 *   barrier  a raider's portable shield wall (blocks shots, can be shot down)
 *   warden   De Wachter — world boss at BOSS.site: dormant → wakes, phases, stomp
 *            shockwave (dodge / jump), sweeping eye beam, drone summons, rune weak
 *            points (bonus damage, stagger), resets when abandoned, loot per fighter,
 *            respawn timer. S.EVENT {kind: 'boss'} start / phase / rune / end.
 *
 * Snapshot rows: [id, type, x, y, z, h, s, hp, target | null, flags?] (FLAG / BOSS_BITS).
 * S.ENEMY_FIRE kinds: laser (phase 'charge' | shot), bolt, claw, bite, howl, aim,
 *   stomp (phase 'windup' | 'hit'), beam (phase 'windup'), summon, roar.
 */
import { NET, S, ES } from '../protocol.js';
import { ENEMIES, SPAWN, SPAWN_EXTRA, GRACE, HUNT, GARRISONS, DANGER, CACHES, RARE, BOSS, FLAG, BOSS_BITS, wardenEye, beamHeading } from '../defs/enemies.js';
import { HUB, hubDist } from '../defs/world.js';
import { createWorldgen } from '../worldgen/index.js';
import { LOOT, ITEMS } from '../defs/items.js';
import { WEAPONS } from '../defs/weapons.js';
import { mulberry32, hashString } from './rng.js';
import { terrainLOS, poiCover, segCover } from './los.js';
import { damagePlayer, targetable } from './players.js';
import { r2, clamp, headingTo, wrapAngle, randInt } from './util.js';

const HN = 16; // history samples per enemy (16 × 50 ms = 0.8 s ≥ NET.LAG_COMP_MS)
const HS = 5; // floats per sample: t, x, y, z, h
const THINK_MS = 400;
const HIT_SLACK = 150; // ms between a hit landing and its damage: a roll that started a bit late still counts
const NOISE = { 'pulse-pistol': 48, 'plasma-rifle': 62, railgun: 95 };

export function createEnemies(W) {
  const spawnRnd = mulberry32(hashString(`${W.seed}:spawn`));
  const aiRnd = mulberry32(hashString(`${W.seed}:ai`));
  const huntRnd = mulberry32(hashString(`${W.seed}:hunt`));
  let spawnTimer = 0;
  let slowTimer = 0;
  const squads = new Map();
  let squadSeq = 0;
  const garrisons = new Map(); // poi id → { poi, spec, members: Set, state: 'idle' | 'active' | 'cleared', clearedAt }
  const pending = []; // enemy → player hits waiting for their dodge check
  const boss = { e: null, deadUntil: 0, emptyT: 0 };
  const rnd = (a, b) => a + aiRnd() * (b - a);

  // ------------------------------------------------------------ records
  /** Creates an enemy at (x, z); opts { nightOnly, biome, squad, elite, garrison, hunt, summoned, h } (tests / scripted spawns may pass null). */
  function create(type, x, z, opts = null) {
    const def = ENEMIES[type];
    if (!def) return null;
    const ground = W.H(x, z);
    const alt = def.flying ? def.hover[0] + aiRnd() * (def.hover[1] - def.hover[0]) : 0;
    const e = {
      id: W.nid('e'),
      type,
      def,
      x,
      y: def.flying ? Math.max(ground, 0) + alt : ground,
      z,
      h: Number.isFinite(opts?.h) ? opts.h : aiRnd() * Math.PI * 2,
      vx: 0,
      vy: 0,
      vz: 0,
      hp: def.hp,
      maxHp: def.hp,
      st: ES.IDLE,
      target: null,
      home: { x, z },
      nightOnly: !!opts?.nightOnly,
      biome: opts?.biome || null,
      alt,
      bob: aiRnd() * 10,
      nextAttackAt: 0,
      stunUntil: 0,
      strafe: aiRnd() < 0.5 ? -1 : 1,
      strafeAt: 0,
      leapUntil: 0,
      leapReadyAt: 0,
      windupUntil: 0,
      thinkAt: 0,
      wp: null,
      wpAt: 0,
      far: 0,
      returning: false,
      flags: 0,
      investigate: null, // { x, z, until } — a noise / a fallen friend / a hunt trail
      squad: null,
      elite: !!opts?.elite,
      garrison: opts?.garrison || null,
      hunt: opts?.hunt || null,
      summoned: opts?.summoned || null,
      hurtAt: -1e9,
      retreatUntil: 0,
      retreated: false,
      chargeUntil: 0,
      chargeTarget: null,
      burstLeft: 0,
      burstAt: 0,
      bursts: 0,
      cover: null,
      coverUntil: 0,
      peekAt: 0,
      aimUntil: 0,
      crouch: false,
      barrierAt: 0,
      losT: 0,
      los: false,
      seenAt: 0,
      ang: aiRnd() * Math.PI * 2, // mites: own spot around the target
      howled: false,
      dmgBy: null,
      hist: new Float64Array(HN * HS),
      hn: 0,
      hi: 0,
    };
    if (e.elite) e.hp = e.maxHp = Math.round(def.hp * 1.45);
    if (opts?.squad) joinSquad(e, opts.squad);
    if (type === 'barrier') e.until = W.now() + (def.life || 15) * 1000;
    record(e, W.now());
    W.enemies.set(e.id, e);
    return e;
  }

  function destroy(e) {
    if (!W.enemies.delete(e.id)) return;
    if (e.squad) leaveSquad(e);
    if (e.garrison) {
      const g = garrisons.get(e.garrison);
      if (g) {
        g.members.delete(e.id);
        // despawned (nobody near) before it was cleared → it garrisons again next visit
        if (!g.members.size && g.state === 'active' && e.hp > 0) g.state = 'idle';
      }
    }
    if (boss.e === e) boss.e = null;
  }

  function newSquad(type) {
    const s = { id: ++squadSeq, type, members: [], target: null, flanker: null, flankAt: 0, suppressor: null };
    squads.set(s.id, s);
    return s;
  }
  function joinSquad(e, s) {
    e.squad = s;
    s.members.push(e);
  }
  function leaveSquad(e) {
    const s = e.squad;
    e.squad = null;
    const i = s.members.indexOf(e);
    if (i >= 0) s.members.splice(i, 1);
    if (s.flanker === e) s.flanker = null;
    if (s.suppressor === e) s.suppressor = null;
    if (!s.members.length) squads.delete(s.id);
  }

  // ------------------------------------------------------------ history (lag compensation)
  function record(e, t) {
    const k = e.hi * HS;
    e.hist[k] = t;
    e.hist[k + 1] = e.x;
    e.hist[k + 2] = e.y;
    e.hist[k + 3] = e.z;
    e.hist[k + 4] = e.h;
    e.hi = (e.hi + 1) % HN;
    if (e.hn < HN) e.hn++;
  }

  /** Interpolated position at server time t (clamped to the stored history) → out [x, y, z, h]. */
  function posAt(e, t, out) {
    const H = e.hist;
    let newer = -1;
    for (let n = 0; n < e.hn; n++) {
      const i = (e.hi - 1 - n + HN) % HN;
      const ti = H[i * HS];
      if (ti <= t) {
        if (newer < 0) {
          out[0] = H[i * HS + 1];
          out[1] = H[i * HS + 2];
          out[2] = H[i * HS + 3];
          out[3] = H[i * HS + 4];
          return out;
        }
        const tn = H[newer * HS];
        const k = tn > ti ? (t - ti) / (tn - ti) : 0;
        out[0] = H[i * HS + 1] + (H[newer * HS + 1] - H[i * HS + 1]) * k;
        out[1] = H[i * HS + 2] + (H[newer * HS + 2] - H[i * HS + 2]) * k;
        out[2] = H[i * HS + 3] + (H[newer * HS + 3] - H[i * HS + 3]) * k;
        out[3] = H[i * HS + 4] + wrapAngle(H[newer * HS + 4] - H[i * HS + 4]) * k;
        return out;
      }
      newer = i;
    }
    if (newer >= 0) {
      out[0] = H[newer * HS + 1];
      out[1] = H[newer * HS + 2];
      out[2] = H[newer * HS + 3];
      out[3] = H[newer * HS + 4];
    } else {
      out[0] = e.x;
      out[1] = e.y;
      out[2] = e.z;
      out[3] = e.h;
    }
    return out;
  }

  // ------------------------------------------------------------ players: arrivals, dodges, targeting
  const isNight = () => W.day < SPAWN.nightBelow;

  /** Per-player bookkeeping (p.thr): arrival time (grace), dodge windows. */
  function track(p, now) {
    let t = p.thr;
    if (!t) {
      // a login: targeting grace while the client loads (no spawn pause — they were here before)
      t = p.thr = { arriveAt: now, quietAt: -1e12, wasDead: p.dead, tpAt: p.lastTpAt, x: p.x, z: p.z, dodgeStart: -1e12, dodgeUntil: -1e12, lastA: p.a, huntNext: 0 };
      return t;
    }
    if (t.wasDead && !p.dead) t.arriveAt = t.quietAt = now; // respawned
    t.wasDead = p.dead;
    if (p.lastTpAt !== t.tpAt) {
      t.tpAt = p.lastTpAt; // Gateway / Return to hub
      t.arriveAt = t.quietAt = now;
    }
    if (Math.abs(p.x - t.x) > 80 || Math.abs(p.z - t.z) > 80) t.arriveAt = t.quietAt = now; // fast travel / teleport
    t.x = p.x;
    t.z = p.z;
    if (p.a === 'dodge' && t.lastA !== 'dodge' && now - t.dodgeStart > GRACE.dodgeCooldown * 1000) {
      t.dodgeStart = now;
      t.dodgeUntil = now + GRACE.dodge * 1000;
    }
    t.lastA = p.a;
    return t;
  }

  const inGrace = (p, now) => {
    const t = p.thr;
    return !!t && now - t.arriveAt < GRACE.arrive * 1000 && !(p.combatAt > t.arriveAt);
  };
  const canTarget = (p, now) => targetable(W, p) && !inGrace(p, now);
  /** Was the player rolling when a hit landed at time `at`? */
  const dodged = (p, at) => {
    const t = p.thr;
    return !!t && t.dodgeStart <= at + HIT_SLACK && t.dodgeUntil >= at;
  };
  /** Off the ground (jumped over a shockwave). */
  const airborne = (p) => p.m === 'foot' && (p.a === 'jump' || p.a === 'fall' || p.y - W.H(p.x, p.z) > 0.9);

  /** Queues enemy damage on a player: lands at now + inMs, applied HIT_SLACK later unless the player rolled. */
  function hitPlayer(e, p, dmg, kind, inMs = 0, extra = null) {
    const now = W.now();
    pending.push({ at: now + inMs, apply: now + inMs + HIT_SLACK, pid: p.id, by: e.id, byType: e.type, dmg, kind, fx: e.x, fy: e.y + (e.def.flying ? 0 : 1.2), fz: e.z, noDodge: !!extra?.noDodge });
  }

  function processPending(now) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const h = pending[i];
      if (h.apply > now) continue;
      pending[i] = pending[pending.length - 1];
      pending.pop();
      const p = W.players.get(h.pid);
      if (!p || p.dead || !targetable(W, p)) continue;
      if (!h.noDodge && dodged(p, h.at)) {
        W.emit(p.id, { t: S.EVENT, kind: 'dodged', by: h.by, w: h.kind });
        continue;
      }
      damagePlayer(W, p, h.dmg, h.by, h.kind, [p.x, p.y + 1.2, p.z], { byType: h.byType, from: [h.fx, h.fy, h.fz] });
    }
  }

  // ------------------------------------------------------------ spawning
  function spawnOk(def, x, z, now) {
    if (hubDist(x, z) < HUB.spawnBuffer || W.world.isSafe(x, z)) return false;
    const h = W.H(x, z);
    if (!def.flying) {
      if (W.isWater(x, z) || h < 0.6) return false;
      const s = Math.max(Math.abs(W.H(x + 1.5, z) - W.H(x - 1.5, z)), Math.abs(W.H(x, z + 1.5) - W.H(x, z - 1.5))) / 3;
      if (s > 0.9) return false;
    }
    for (const c of W.claims.values()) if (Math.hypot(x - c.p[0], z - c.p[1]) < c.r + SPAWN.claimMargin) return false;
    for (const p of W.players.values()) {
      if (p.m === 'space') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < SPAWN.minPlayerDist) return false;
      // fresh arrivals: a quiet bubble while they get their bearings
      if (p.thr && now - p.thr.quietAt < GRACE.spawnFree * 1000 && d < GRACE.spawnFreeR) return false;
    }
    return true;
  }

  /** Weighted pick from a normalized spawn table, skipping types at their per-type cap (entry.max × scale). */
  const typeCount = {};
  const typeCapped = (e, scale) => e.max > 0 && (typeCount[e.type] || 0) >= Math.max(1, Math.round(e.max * scale));
  function pickEntry(list, scale) {
    let sum = 0;
    for (const e of list) if (!typeCapped(e, scale)) sum += e.w;
    if (!(sum > 0)) return null;
    let r = spawnRnd() * sum;
    let last = null;
    for (const e of list) {
      if (typeCapped(e, scale)) continue;
      last = e;
      r -= e.w;
      if (r <= 0) return e;
    }
    return last;
  }

  /** This wave's enemies on top of the provider's table (per biome, day / night). */
  function augment(table, night) {
    const extra = SPAWN_EXTRA[table.biome];
    const add = extra && (night ? extra.night : extra.day);
    if (!add || !add.length) return table.list;
    const list = table.list.slice();
    for (const [type, w, max, nightOnly] of add) {
      if (!ENEMIES[type] || list.some((l) => l.type === type)) continue;
      list.push({ type, w, max, nightOnly: !!nightOnly });
    }
    return list;
  }

  /** A squad of n around (x, z): members on a small ring, the first one leads. */
  function spawnGroup(type, x, z, n, opts, now) {
    const def = ENEMIES[type];
    const squad = n > 1 ? newSquad(type) : null;
    const out = [];
    for (let i = 0; i < n; i++) {
      let px = x;
      let pz = z;
      if (i > 0) {
        let ok = false;
        for (let k = 0; k < 6 && !ok; k++) {
          const a = spawnRnd() * Math.PI * 2;
          const r = 2.5 + spawnRnd() * (def.small ? 3 : 5);
          px = x + Math.cos(a) * r;
          pz = z + Math.sin(a) * r;
          ok = opts?.force ? def.flying || !W.isWater(px, pz) : spawnOk(def, px, pz, now);
        }
        if (!ok) continue;
      }
      const e = create(type, px, pz, { ...opts, force: undefined, squad, elite: (opts?.elite ?? (type === 'raider' && n >= 3)) && i === 0 });
      if (e) out.push(e);
    }
    return out;
  }

  /**
   * Once per second: every eligible player (alive, on the planet, near enough to
   * the wild) whose spawn timer elapsed gets one spawn attempt on a ring around
   * it, if fewer than perPlayer × density × group scale enemies are near.
   */
  function spawnTick(now) {
    const night = isNight();
    for (const p of W.players.values()) {
      if (W.enemies.size >= SPAWN.maxTotal) return;
      if (p.dead || p.m === 'space') continue;
      if (hubDist(p.x, p.z) < HUB.spawnBuffer - SPAWN.maxPlayerDist) continue; // deep in the hub
      if (now < (p.spawnAt || 0)) continue;
      if (p.thr && now - p.thr.quietAt < GRACE.spawnFree * 1000) continue; // just arrived: let them settle
      p.spawnAt = now + (SPAWN.interval[0] + spawnRnd() * (SPAWN.interval[1] - SPAWN.interval[0])) * 1000;
      let group = 0;
      for (const q of W.players.values()) {
        if (q.dead || q.m === 'space') continue;
        if (Math.hypot(q.x - p.x, q.z - p.z) < SPAWN.groupRange) group++;
      }
      let local = 0;
      for (const k in typeCount) typeCount[k] = 0;
      for (const e of W.enemies.values()) {
        if (e.def.prop || e.def.boss || e.summoned || e.garrison) continue;
        // counted by where it is OR where it spawned: patrols drifting past the radius don't free a slot
        if (Math.hypot(e.x - p.x, e.z - p.z) >= SPAWN.activeRange && Math.hypot(e.home.x - p.x, e.home.z - p.z) >= SPAWN.activeRange) continue;
        local++;
        typeCount[e.type] = (typeCount[e.type] || 0) + 1;
      }
      const scale = Math.min(SPAWN.maxScale, 1 + SPAWN.perPlayerScale * (group - 1));
      for (let tries = 0; tries < 6; tries++) {
        const a = spawnRnd() * Math.PI * 2;
        const r = SPAWN.minPlayerDist + spawnRnd() * (SPAWN.maxPlayerDist - SPAWN.minPlayerDist);
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (hubDist(x, z) < HUB.spawnBuffer) continue;
        if (boss.e && Math.hypot(x - BOSS.site.x, z - BOSS.site.z) < BOSS.arena + 40) continue; // the arena stays the boss's
        const table = W.world.spawnRules(x, z, W.hour);
        if (!table) continue;
        if (local >= Math.round(SPAWN.perPlayer * table.density * scale)) break;
        const entry = pickEntry(augment(table, night), scale);
        if (!entry) break;
        const def = ENEMIES[entry.type];
        if (!def || def.boss || def.prop || !spawnOk(def, x, z, now)) continue;
        // a garrisoned POI is its squad's ground: no roaming squads of the same kind pile up on top of it
        if (def.squad && garrisonNear(x, z, 200, entry.type)) continue;
        const opts = { nightOnly: entry.nightOnly, biome: table.biome };
        if (def.squad) {
          const room = Math.max(1, Math.round((entry.max || def.squad[1]) * scale) - (typeCount[entry.type] || 0));
          const n = Math.min(room, randInt(spawnRnd, def.squad[0], def.squad[1]));
          spawnGroup(entry.type, x, z, Math.max(1, n), opts, now);
        } else create(entry.type, x, z, opts);
        break;
      }
    }
  }

  // ------------------------------------------------------------ night hunts
  function huntTick(now) {
    const night = isNight();
    for (const p of W.players.values()) {
      const t = p.thr;
      if (!t) continue;
      if (!night) {
        t.huntNext = 0;
        continue;
      }
      if (!t.huntNext) {
        t.huntNext = now + (HUNT.first[0] + huntRnd() * (HUNT.first[1] - HUNT.first[0])) * 1000;
        continue;
      }
      if (now < t.huntNext) continue;
      t.huntNext = now + (HUNT.every[0] + huntRnd() * (HUNT.every[1] - HUNT.every[0])) * 1000;
      if (!canTarget(p, now) || now - t.arriveAt < 30000 || W.build.claimAt?.(p.x, p.z)) continue;
      if (W.enemies.size >= SPAWN.maxTotal - 6) continue;
      let near = 0;
      for (const e of W.enemies.values()) if (!e.def.prop && Math.hypot(e.x - p.x, e.z - p.z) < 80) near++;
      if (near >= HUNT.maxNear) continue;
      const table = W.world.spawnRules(p.x, p.z, W.hour);
      if (!table) continue;
      const [type, n] = HUNT.groups[table.biome] || HUNT.fallback;
      const def = ENEMIES[type];
      for (let k = 0; k < 8; k++) {
        const a = huntRnd() * Math.PI * 2;
        const r = HUNT.dist[0] + huntRnd() * (HUNT.dist[1] - HUNT.dist[0]);
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (!spawnOk(def, x, z, now)) continue;
        const group = def.squad ? spawnGroup(type, x, z, n, { biome: table.biome, hunt: p.id }, now) : [];
        if (!def.squad) {
          for (let i = 0; i < n; i++) {
            const hx = x + (huntRnd() - 0.5) * 8;
            const hz = z + (huntRnd() - 0.5) * 8;
            if (!def.flying && (W.isWater(hx, hz) || W.H(hx, hz) < 0.6)) continue;
            const e = create(type, hx, hz, { biome: table.biome, hunt: p.id });
            if (e) group.push(e);
          }
        }
        if (!group.length) break;
        const squad = group[0].squad || (group.length > 1 ? newSquad(type) : null);
        for (const e of group) {
          if (squad && !e.squad) joinSquad(e, squad);
          e.investigate = { x: p.x, z: p.z, until: now + 90000 };
          e.huntUntil = now + 90000;
        }
        W.emit(p.id, { t: S.EVENT, kind: 'hunt', phase: 'start', type, n: group.length, from: [r2(x), r2(z)] });
        break;
      }
    }
  }

  // ------------------------------------------------------------ POI garrisons
  /**
   * POIs come from the world provider (W.world.poisNear) or the generator (W.worldgen). The sim's world
   * provider doesn't expose POIs yet, so with a worldgen world an identical private generator is made once
   * (same recipe as the economy's) and left on W.worldgen for the others (one copy per sim).
   */
  let poiGen; // undefined = not resolved yet, null = no POIs (stand-in world)
  function poisNear(x, z, r) {
    if (typeof W.world.poisNear === 'function') return W.world.poisNear(x, z, r) || [];
    if (poiGen === undefined) {
      poiGen = W.worldgen && typeof W.worldgen.poisNear === 'function' ? W.worldgen : null;
      if (!poiGen && W.world?.kind === 'worldgen') {
        try {
          poiGen = createWorldgen({ seed: W.seed, hub: { heightAt: W.H, isWater: W.isWater, half: HUB.half, radius: HUB.half, blend: HUB.blend } });
          if (!W.worldgen) W.worldgen = poiGen;
        } catch (err) {
          if (typeof console !== 'undefined') console.warn('[sim] garrisons: no world generator', err?.message || err);
          poiGen = null;
        }
      }
    }
    return poiGen ? poiGen.poisNear(x, z, r) || [] : [];
  }

  // structures of nearby POIs (huts, palisade, crates, wreck hulls): line of sight + raider cover
  const cover = new Map(); // poi id → { x, z, r, boxes, seenAt }
  function rememberCover(id, poi, now) {
    let c = cover.get(id);
    if (!c) {
      if (poi.type !== 'outpost' && poi.type !== 'wreck' && poi.type !== 'arena') return;
      const y = Number.isFinite(poi.y) ? poi.y : W.H(poi.x, poi.z);
      const boxes = poiCover({ type: poi.type, variant: poi.variant | 0, x: poi.x, y, z: poi.z, rot: Number(poi.rot) || 0 }, W.H);
      if (!boxes.length) return;
      c = { x: poi.x, z: poi.z, r: (poi.radius || 30) + 24, boxes, seenAt: now };
      cover.set(id, c);
    }
    c.seenAt = now;
  }
  /** Is the segment A→B blocked by a POI structure? */
  function coverBlocked(ax, ay, az, bx, by, bz) {
    if (!cover.size) return false;
    for (const c of cover.values()) {
      // segment vs the POI's circle (bounding test)
      if (Math.min(ax, bx) > c.x + c.r || Math.max(ax, bx) < c.x - c.r || Math.min(az, bz) > c.z + c.r || Math.max(az, bz) < c.z - c.r) continue;
      if (segCover(ax, ay, az, bx, by, bz, c.boxes) >= 0) return true;
    }
    return false;
  }
  /** Clear line: terrain + POI structures. */
  const clearLine = (ax, ay, az, bx, by, bz, margin = 0.35) => terrainLOS(W.H, ax, ay, az, bx, by, bz, margin) && !coverBlocked(ax, ay, az, bx, by, bz);

  function garrisonTick(now) {
    for (const [id, c] of cover) if (now - c.seenAt > 60000) cover.delete(id);
    for (const p of W.players.values()) {
      if (p.dead || p.m === 'space' || p.safe) continue;
      let pois;
      try {
        pois = poisNear(p.x, p.z, 260);
      } catch {
        return;
      }
      for (const poi of pois) {
        if (!poi || !Number.isFinite(poi.x) || !Number.isFinite(poi.z)) continue;
        const id = String(poi.id ?? `${Math.round(poi.x)}:${Math.round(poi.z)}`);
        rememberCover(id, poi, now);
        const spec = GARRISONS[poi.type];
        if (!spec) continue;
        let g = garrisons.get(id);
        if (!g) {
          g = { id, poi: { x: poi.x, z: poi.z, type: poi.type, r: poi.radius || 26 }, spec, members: new Set(), state: 'idle', clearedAt: 0 };
          garrisons.set(id, g);
        }
        if (g.state === 'cleared' && now >= g.clearedAt + spec.respawn * 1000) g.state = 'idle';
        if (g.state !== 'idle' || Math.hypot(p.x - poi.x, p.z - poi.z) > spec.wake) continue;
        if (W.enemies.size >= SPAWN.maxTotal - 4) continue;
        const def = ENEMIES[spec.type];
        const n = randInt(spawnRnd, spec.n[0], spec.n[1]);
        const squad = n > 1 ? newSquad(spec.type) : null;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + spawnRnd() * 0.6;
          const r = 6 + spawnRnd() * Math.max(6, g.poi.r * 0.6);
          const x = poi.x + Math.cos(a) * r;
          const z = poi.z + Math.sin(a) * r;
          if (!def.flying && (W.isWater(x, z) || W.H(x, z) < 0.6)) continue;
          const e = create(spec.type, x, z, { squad, elite: i < spec.elite, garrison: id, biome: W.world.biomeAt(x, z) });
          if (!e) continue;
          e.home = { x: poi.x, z: poi.z };
          g.members.add(e.id);
        }
        if (g.members.size) g.state = 'active';
      }
    }
  }

  /** A known, not cleared garrison of `type` within r of (x, z)? */
  function garrisonNear(x, z, r, type) {
    for (const g of garrisons.values()) {
      if (g.state === 'cleared' || g.spec.type !== type) continue;
      if (Math.abs(g.poi.x - x) < r && Math.abs(g.poi.z - z) < r && Math.hypot(g.poi.x - x, g.poi.z - z) < r) return g;
    }
    return null;
  }

  function garrisonCleared(g, now) {
    g.state = 'cleared';
    g.clearedAt = now;
    const y = Math.max(W.H(g.poi.x, g.poi.z), 0) + 0.4;
    const drop = W.loot.spawn([g.poi.x, y, g.poi.z], rollTable(CACHES[g.spec.cache] || CACHES.wreck, 1), { ttl: LOOT.ttl * 2, kind: 'cache' });
    W.emit({ near: [g.poi.x, g.poi.z, NET.INTEREST_RADIUS] }, { t: S.EVENT, kind: 'poi', phase: 'cleared', id: g.id, type: g.poi.type, at: [r2(g.poi.x), r2(y), r2(g.poi.z)], drop: drop?.id });
  }

  // ------------------------------------------------------------ perception / alerts
  function aggroOf(e) {
    const d = e.def;
    let a = d.aggro * (isNight() ? d.aggroNight || 1 : 1);
    if (e.investigate) a *= 1.25;
    return a;
  }

  function nearestTarget(e, range, now) {
    let best = null;
    let bd = range;
    for (const p of W.players.values()) {
      if (!canTarget(p, now)) continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  function eyeY(e) {
    if (e.def.flying) return e.y;
    if (e.type === 'raider') return e.y + (e.crouch ? 1.05 : 1.6);
    if (e.type === 'mite') return e.y + 0.5;
    return e.y + 1.2;
  }
  const losTo = (e, p) => clearLine(e.x, eyeY(e), e.z, p.x, p.y + 1.3, p.z, 0.35);
  /** Cached line of sight to the current target (300 ms). */
  function seesTarget(e, now) {
    if (now >= e.losT) {
      e.losT = now + 300;
      e.los = !!e.target && losTo(e, e.target);
      if (e.los) e.seenAt = now;
    }
    return e.los;
  }

  function setTarget(e, p, now) {
    if (e.target === p) return;
    const first = !e.target;
    e.target = p;
    e.investigate = null;
    e.returning = false;
    e.losT = 0;
    if (e.squad) {
      e.squad.target = p;
      // squadmates pick it up a moment later (staggered, so it reads)
      for (const m of e.squad.members) if (m !== e && !m.target) m.joinAt = now + 250 + aiRnd() * 650;
    }
    if (first && e.type === 'stalker' && !e.howled) {
      e.howled = true;
      emitFire(e, { w: 'howl' });
      for (const o of W.enemies.values()) {
        if (o === e || o.type !== 'stalker' || o.target || Math.hypot(o.x - e.x, o.z - e.z) > (e.def.pack || 60)) continue;
        o.investigate = { x: p.x, z: p.z, until: now + 12000 };
        o.joinTarget = p;
        o.joinAt = now + 400 + aiRnd() * 900;
      }
    }
  }

  /**
   * Something happened at (x, z) (a shot, an explosion, a death): enemies within r that are not
   * fighting yet come to look; the ones that can see the suspect `p` engage right away.
   */
  function alertAround(x, z, r, p, now) {
    for (const e of W.enemies.values()) {
      if (e.def.prop || e.def.boss || e.target || e.hp <= 0) continue;
      const dx = e.x - x;
      const dz = e.z - z;
      if (dx * dx + dz * dz > r * r) continue;
      if (p && canTarget(p, now) && Math.hypot(p.x - e.x, p.z - e.z) < aggroOf(e) * 1.5 && losTo(e, p)) {
        setTarget(e, p, now);
        continue;
      }
      e.investigate = { x: p ? p.x : x, z: p ? p.z : z, until: now + 9000 + aiRnd() * 4000 };
      e.returning = false;
    }
  }

  /** Gunfire (C.FIRE) / explosions: enemies around come to look. */
  function noise(p, r) {
    if (!p) return;
    alertAround(p.x, p.z, r, p, W.now());
  }

  // ------------------------------------------------------------ movement helpers
  /** Pushes a desired velocity away from safe zones and around structures. */
  function avoid(e, dv) {
    const nx = e.x + dv[0] * 0.6;
    const nz = e.z + dv[1] * 0.6;
    if (hubDist(nx, nz) < HUB.enemyMargin) {
      const sp = Math.hypot(dv[0], dv[1]) || e.def.speed * 0.5;
      if (Math.abs(nx) >= Math.abs(nz)) {
        dv[0] = (nx >= 0 ? 1 : -1) * sp;
        dv[1] *= 0.3;
      } else {
        dv[1] = (nz >= 0 ? 1 : -1) * sp;
        dv[0] *= 0.3;
      }
    }
    if (e.def.flying) return;
    W.build.forNear(e.x, e.z, 8, (rec) => {
      const dx = e.x - rec.x;
      const dz = e.z - rec.z;
      const d = Math.hypot(dx, dz);
      const min = (rec.r || 2) + 0.9;
      if (d < min + 1.5 && d > 1e-3 && rec.top > e.y + 0.4 && rec.y < e.y + 1.6) {
        const k = ((min + 1.5 - d) / 1.5) * e.def.speed;
        dv[0] += (dx / d) * k;
        dv[1] += (dz / d) * k;
      }
      return false;
    });
  }

  /** Highest structure top under a flying enemy (fly over buildings). */
  function roofUnder(x, z) {
    let top = -Infinity;
    W.build.forNear(x, z, 6, (rec) => {
      if (Math.hypot(rec.x - x, rec.z - z) < (rec.r || 2) + 2 && rec.top > top) top = rec.top;
      return false;
    });
    return top;
  }

  const dv = [0, 0];

  /** Ground movement toward dv (accel k): no water, no cliffs, terrain following. */
  function moveGround(e, dt, k, maxSpeed) {
    const ground = W.H(e.x, e.z);
    avoid(e, dv);
    const a = 1 - Math.exp(-k * dt);
    e.vx += (dv[0] - e.vx) * a;
    e.vz += (dv[1] - e.vz) * a;
    const hs = Math.hypot(e.vx, e.vz);
    if (hs > maxSpeed) {
      e.vx *= maxSpeed / hs;
      e.vz *= maxSpeed / hs;
    }
    let nx = e.x + e.vx * dt;
    let nz = e.z + e.vz * dt;
    const climb = (x, z) => W.H(x, z) - ground <= Math.max(0.35, Math.hypot(x - e.x, z - e.z) * 1.4);
    if (W.isWater(nx, nz) || !climb(nx, nz)) {
      const ax = e.x + e.vx * dt;
      const bz = e.z + e.vz * dt;
      if (!W.isWater(ax, e.z) && climb(ax, e.z)) nz = e.z;
      else if (!W.isWater(e.x, bz) && climb(e.x, bz)) nx = e.x;
      else {
        nx = e.x;
        nz = e.z;
        e.vx *= 0.2;
        e.vz *= 0.2;
        e.wp = null;
        e.cover = null;
      }
    }
    e.x = nx;
    e.z = nz;
    e.y = W.H(e.x, e.z);
    e.vy = 0;
    return hs;
  }

  /** Ballistic pounce in flight (stalker leap / mite hop) → true while airborne. */
  function stepAir(e, dt, now) {
    if (now >= e.leapUntil) return false;
    e.st = ES.LEAP;
    e.vy -= 30 * dt;
    e.x += e.vx * dt;
    e.z += e.vz * dt;
    e.y += e.vy * dt;
    const g = W.H(e.x, e.z);
    if (e.y <= g) {
      e.y = g;
      e.leapUntil = 0;
    }
    const p = e.target;
    const A = e.def.attack;
    if (p && Math.hypot(p.x - e.x, p.z - e.z) <= A.range && Math.abs(p.y - e.y) < 2.5 && now >= e.nextAttackAt) melee(e, p, now);
    return true;
  }

  /** Crouch, then spring toward where the target will be. */
  function pounce(e, p, L, now) {
    const lx = p.x + p.vx * L.time * 0.5 - e.x;
    const lz = p.z + p.vz * L.time * 0.5 - e.z;
    const ld = Math.hypot(lx, lz) || 1;
    const hs = Math.min(L.speed, ld / L.time);
    e.vx = (lx / ld) * hs;
    e.vz = (lz / ld) * hs;
    e.vy = 30 * L.time * 0.5 + (p.y - e.y) / L.time;
    e.leapUntil = now + L.time * 1000 + 300;
    e.leapReadyAt = now + L.cooldown * 1000;
    e.st = ES.LEAP;
  }

  function patrol(e, now, radius, frac, out) {
    const inv = e.investigate;
    if (inv && now < inv.until) {
      // come and look; linger a moment, then give up
      const dx = inv.x - e.x;
      const dz = inv.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < 4) {
        out[0] = 0;
        out[1] = 0;
        if (!inv.lingerUntil) inv.lingerUntil = now + 2500;
        else if (now > inv.lingerUntil && !e.hunt) e.investigate = null;
      } else {
        const sp = e.def.speed * (e.hunt ? 0.6 : 0.75);
        out[0] = (dx / d) * sp;
        out[1] = (dz / d) * sp;
      }
      e.st = ES.CHASE;
      e.flags |= FLAG.ALERT;
      return;
    }
    if (inv) e.investigate = null;
    // squad members follow their leader in a loose formation
    const lead = e.squad?.members[0];
    if (lead && lead !== e && !e.returning) {
      const i = e.squad.members.indexOf(e);
      const a = (lead.h || 0) + Math.PI + (i % 2 ? 0.7 : -0.7);
      const tx = lead.x - Math.sin(a) * (2.5 + i * 1.2);
      const tz = lead.z - Math.cos(a) * (2.5 + i * 1.2);
      const dx = tx - e.x;
      const dz = tz - e.z;
      const d = Math.hypot(dx, dz);
      const sp = d > 1.5 ? Math.min(e.def.speed, d * 0.9) : 0;
      out[0] = d > 1e-3 ? (dx / d) * sp : 0;
      out[1] = d > 1e-3 ? (dz / d) * sp : 0;
      e.st = ES.PATROL;
      return;
    }
    if (e.returning) {
      e.wp = [e.home.x, e.home.z];
      e.wpAt = now + 1000;
      frac = 0.8;
    } else if (!e.wp || now > e.wpAt || Math.hypot(e.wp[0] - e.x, e.wp[1] - e.z) < 3) {
      const a = aiRnd() * Math.PI * 2;
      const r = Math.sqrt(aiRnd()) * radius;
      e.wp = [e.home.x + Math.cos(a) * r, e.home.z + Math.sin(a) * r];
      e.wpAt = now + 6000 + aiRnd() * 6000;
    }
    const dx = e.wp[0] - e.x;
    const dz = e.wp[1] - e.z;
    const d = Math.hypot(dx, dz) || 1;
    out[0] = (dx / d) * e.def.speed * frac;
    out[1] = (dz / d) * e.def.speed * frac;
    e.st = e.returning ? ES.RETURN : ES.PATROL;
  }

  function emitFire(e, msg) {
    msg.t = S.ENEMY_FIRE;
    msg.id = e.id;
    W.emit({ near: [e.x, e.z, NET.INTEREST_RADIUS] }, msg);
  }

  /** Lateral speed of p relative to a shooter at (x, z): strafing across the line of fire is what dodges. */
  function crossSpeed(p, x, z) {
    const dx = p.x - x;
    const dz = p.z - z;
    const l = Math.hypot(dx, dz) || 1;
    const ux = dx / l;
    const uz = dz / l;
    const along = p.vx * ux + p.vz * uz;
    return Math.hypot(p.vx - ux * along, p.vz - uz * along);
  }

  /** Ranged shot resolution → emits the FX message and queues the hit (bolt flight time). */
  function rangedShot(e, p, o, A, acc, boltSpeed) {
    const hit = aiRnd() < acc;
    let tx = p.x;
    let ty = p.y + 1.2;
    let tz = p.z;
    if (!hit) {
      tx += (aiRnd() - 0.5) * 3.4;
      ty += (aiRnd() - 0.3) * 2;
      tz += (aiRnd() - 0.5) * 3.4;
    }
    const dx = tx - o[0];
    const dy = ty - o[1];
    const dz = tz - o[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    emitFire(e, { w: A.kind, o: [r2(o[0]), r2(o[1]), r2(o[2])], d: [r2(dx / l), r2(dy / l), r2(dz / l)], hit, target: p.id });
    if (hit) hitPlayer(e, p, A.dmg, A.kind, (l / boltSpeed) * 1000);
  }

  // ------------------------------------------------------------ drone
  const _o = [0, 0, 0];
  function stepDrone(e, dt, now) {
    const def = e.def;
    const A = def.attack;
    const p = e.target;
    let speed = def.speed;
    dv[0] = 0;
    dv[1] = 0;
    const evading = now < e.retreatUntil;
    if (evading) e.flags |= FLAG.RETREAT;
    // a charged shot leaves
    if (e.chargeUntil && now >= e.chargeUntil) {
      e.chargeUntil = 0;
      const t = e.chargeTarget;
      e.chargeTarget = null;
      if (t && !t.dead && targetable(W, t)) {
        const d = Math.hypot(t.x - e.x, t.z - e.z);
        const sees = losTo(e, t);
        const acc = sees ? clamp(A.accuracy * (1 - (d / A.range) * 0.55) - crossSpeed(t, e.x, e.z) * 0.045 - (now - e.hurtAt < 800 ? 0.15 : 0), A.minAccuracy, A.accuracy) : 0;
        _o[0] = e.x - Math.sin(e.h) * 0.45;
        _o[1] = e.y - 0.25;
        _o[2] = e.z - Math.cos(e.h) * 0.45;
        rangedShot(e, t, _o, A, acc, 160);
      }
    }
    if (p) {
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const ux = dx / d;
      const uz = dz / d;
      const keep0 = evading ? 30 : def.keep[0];
      const keep1 = evading ? 45 : def.keep[1];
      let radial;
      if (d > keep1) radial = 1;
      else if (d < keep0) radial = -0.9;
      else radial = ((d - (keep0 + keep1) / 2) / ((keep1 - keep0) / 2)) * 0.25;
      if (now > e.strafeAt) {
        e.strafe = aiRnd() < 0.5 ? -1 : 1;
        e.strafeAt = now + 2000 + aiRnd() * 2000;
      }
      const tang = e.strafe * 0.6;
      if (e.chargeUntil) speed *= 0.35; // steadies itself while charging (the tell)
      dv[0] = (ux * radial - uz * tang) * speed;
      dv[1] = (uz * radial + ux * tang) * speed;
      e.h = headingTo(e.x, e.z, p.x, p.z);
      e.st = d <= A.range ? ES.ATTACK : ES.CHASE;
      if (!e.chargeUntil && d <= A.range && now >= e.nextAttackAt && seesTarget(e, now)) {
        const rate = A.rate * (evading ? 0.6 : 1);
        e.nextAttackAt = now + (A.charge * 1000) + (1000 / rate) * (0.85 + aiRnd() * 0.3);
        e.chargeUntil = now + A.charge * 1000;
        e.chargeTarget = p;
        emitFire(e, { w: 'laser', phase: 'charge', ct: A.charge, target: p.id });
      }
    } else {
      e.chargeUntil = 0;
      patrol(e, now, 40, 0.35, dv);
    }
    if (e.chargeUntil) e.flags |= FLAG.AIM;
    avoid(e, dv);
    const k = 1 - Math.exp(-3.5 * dt);
    e.vx += (dv[0] - e.vx) * k;
    e.vz += (dv[1] - e.vz) * k;
    const hs = Math.hypot(e.vx, e.vz);
    const cap = def.speed * 1.6; // knockback may exceed the cruise speed briefly
    if (hs > cap) {
      e.vx *= cap / hs;
      e.vz *= cap / hs;
    }
    e.x += e.vx * dt;
    e.z += e.vz * dt;
    e.bob += dt;
    const base = Math.max(W.H(e.x, e.z), 0, roofUnder(e.x, e.z));
    const ty = base + e.alt + (evading ? 6 : 0) + Math.sin(e.bob * 0.9) * 0.8;
    e.vy = clamp((ty - e.y) * 2, -6, 6);
    e.y += e.vy * dt;
    if (!p && hs > 0.3) e.h = Math.atan2(-e.vx, -e.vz);
  }

  // ------------------------------------------------------------ stalker
  function stepStalker(e, dt, now) {
    const def = e.def;
    if (stepAir(e, dt, now)) return;
    const p = e.target;
    const L = def.leap;
    dv[0] = 0;
    dv[1] = 0;
    // the crouch before a pounce
    if (e.windupUntil) {
      e.st = ES.LEAP;
      e.flags |= FLAG.WINDUP;
      if (p) e.h = headingTo(e.x, e.z, p.x, p.z);
      if (now < e.windupUntil) {
        e.vx *= 0.7;
        e.vz *= 0.7;
        return;
      }
      e.windupUntil = 0;
      if (p && !p.dead) pounce(e, p, L, now);
      return;
    }
    const fleeing = now < e.retreatUntil;
    if (p) {
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const ux = dx / d;
      const uz = dz / d;
      e.h = headingTo(e.x, e.z, p.x, p.z);
      if (fleeing) {
        // limp away, out of sight
        e.flags |= FLAG.RETREAT;
        e.st = ES.CHASE;
        dv[0] = -ux * def.speed * 0.85;
        dv[1] = -uz * def.speed * 0.85;
        e.h = headingTo(e.x, e.z, e.x - ux, e.z - uz);
      } else if (d <= def.attack.range && Math.abs(p.y - e.y) < 2.5) {
        e.st = ES.ATTACK;
        if (now >= e.nextAttackAt) melee(e, p, now);
        dv[0] = ux * 0.5;
        dv[1] = uz * 0.5;
      } else {
        e.st = ES.CHASE;
        if (L && d >= L.min && d <= L.max && now >= e.leapReadyAt && Math.abs(p.y - e.y) < 4 && seesTarget(e, now)) {
          e.windupUntil = now + L.windup * 1000;
          e.st = ES.LEAP;
          e.flags |= FLAG.WINDUP;
          return;
        }
        if (L && d < L.max + 4 && now < e.leapReadyAt) {
          // prowl: circle at pounce distance until it can spring again
          const tang = e.strafe;
          const radial = d > 9 ? 0.55 : -0.25;
          dv[0] = (ux * radial - uz * tang * 0.8) * def.speed * 0.7;
          dv[1] = (uz * radial + ux * tang * 0.8) * def.speed * 0.7;
        } else {
          dv[0] = ux * def.speed;
          dv[1] = uz * def.speed;
        }
      }
    } else patrol(e, now, 30, 0.3, dv);
    const hs = moveGround(e, dt, 6, def.speed);
    if ((!p || fleeing) && hs > 0.3) e.h = Math.atan2(-e.vx, -e.vz);
  }

  function melee(e, p, now) {
    const A = e.def.attack;
    e.nextAttackAt = now + 1000 / A.rate;
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const l = Math.hypot(dx, dz) || 1;
    emitFire(e, { w: A.kind, o: [r2(e.x), r2(e.y + (e.def.small ? 0.4 : 1)), r2(e.z)], d: [r2(dx / l), 0, r2(dz / l)], hit: true, target: p.id });
    hitPlayer(e, p, A.dmg, A.kind, 60);
  }

  // ------------------------------------------------------------ mite (swarm)
  function stepMite(e, dt, now) {
    const def = e.def;
    if (stepAir(e, dt, now)) return;
    const p = e.target;
    const L = def.hop;
    dv[0] = 0;
    dv[1] = 0;
    if (e.windupUntil) {
      e.st = ES.LEAP;
      e.flags |= FLAG.WINDUP;
      if (now < e.windupUntil) return;
      e.windupUntil = 0;
      if (p && !p.dead) pounce(e, p, L, now);
      return;
    }
    if (p) {
      // every mite takes its own spot around the target → they surround you
      const tx = p.x + Math.cos(e.ang) * 1.1;
      const tz = p.z + Math.sin(e.ang) * 1.1;
      const dx = tx - e.x;
      const dz = tz - e.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const dp = Math.hypot(p.x - e.x, p.z - e.z);
      e.h = headingTo(e.x, e.z, p.x, p.z);
      if (dp <= def.attack.range && Math.abs(p.y - e.y) < 2) {
        e.st = ES.ATTACK;
        if (now >= e.nextAttackAt) melee(e, p, now);
        dv[0] = (dx / d) * 1.5;
        dv[1] = (dz / d) * 1.5;
      } else {
        e.st = ES.CHASE;
        if (dp >= L.min && dp <= L.max && now >= e.leapReadyAt && aiRnd() < dt * 2.5) {
          e.windupUntil = now + L.windup * 1000;
          e.flags |= FLAG.WINDUP;
          return;
        }
        // skitter: zig-zag on the way in
        const zig = Math.sin(now * 0.008 + e.ang * 5) * 0.55;
        dv[0] = ((dx / d) - (dz / d) * zig) * def.speed;
        dv[1] = ((dz / d) + (dx / d) * zig) * def.speed;
      }
    } else patrol(e, now, 18, 0.35, dv);
    const hs = moveGround(e, dt, 9, def.speed * 1.1);
    if (!p && hs > 0.3) e.h = Math.atan2(-e.vx, -e.vz);
  }

  // ------------------------------------------------------------ raider (squads, cover)
  const _cand = [];
  for (let i = 0; i < 14; i++) _cand.push([0, 0]);
  /**
   * A cover spot near the raider → [x, z, hidden, peekX?, peekZ?]: hidden from the target at crouch height,
   * able to shoot from it (standing up over low cover, or by stepping out to a side peek point next to tall
   * cover: huts, palisade panels, a wreck's hull), at a good range, not on top of a squadmate.
   * Candidates: random spots + the far side of POI structures near the raider. away = falling back.
   */
  function pickCover(e, p, away, flank) {
    const def = e.def;
    const base = headingTo(p.x, p.z, e.x, e.z); // from the target toward us
    let best = null;
    let bs = -Infinity;
    const eyeY0 = p.y + 1.6;
    let nc = 0;
    for (let i = 0; i < 7; i++) {
      let a;
      let r;
      if (flank) {
        // swing around the target: 70–110° off our current bearing, at fighting distance
        a = base + e.flankSide * (1.2 + aiRnd() * 0.7);
        r = 16 + aiRnd() * 8;
        _cand[nc][0] = p.x - Math.sin(a) * r;
        _cand[nc][1] = p.z - Math.cos(a) * r;
      } else {
        a = base + (aiRnd() - 0.5) * 2.6;
        r = away ? 14 + aiRnd() * 10 : 4 + aiRnd() * 9;
        _cand[nc][0] = e.x - Math.sin(a) * r;
        _cand[nc][1] = e.z - Math.cos(a) * r;
      }
      nc++;
    }
    // behind nearby structures (relative to the target)
    if (cover.size && !flank) {
      for (const c of cover.values()) {
        if (Math.hypot(c.x - e.x, c.z - e.z) > c.r + 16) continue;
        const B = c.boxes;
        for (let k = 0; k < B.length && nc < _cand.length; k += 8) {
          const bx = B[k];
          const bz = B[k + 2];
          const dd = Math.hypot(bx - e.x, bz - e.z);
          if (dd > 16 || B[k + 4] * 2 < 0.9) continue;
          const tx = bx - p.x;
          const tz = bz - p.z;
          const tl = Math.hypot(tx, tz) || 1;
          if (away ? tl < Math.hypot(e.x - p.x, e.z - p.z) : tl < def.keep[0] * 0.7) continue;
          const off = Math.min(B[k + 3], B[k + 5]) + 0.85;
          _cand[nc][0] = bx + (tx / tl) * off;
          _cand[nc][1] = bz + (tz / tl) * off;
          nc++;
        }
      }
    }
    for (let i = 0; i < nc; i++) {
      const cx = _cand[i][0];
      const cz = _cand[i][1];
      if (W.isWater(cx, cz)) continue;
      const gy = W.H(cx, cz);
      if (gy < 0.6 || Math.abs(gy - e.y) > 6) continue;
      const dt = Math.hypot(cx - p.x, cz - p.z);
      let s = 0;
      if (dt >= def.keep[0] && dt <= def.keep[1]) s += 2;
      else s -= Math.abs(dt - (def.keep[0] + def.keep[1]) / 2) * 0.08;
      if (away) s += Math.min(3, (dt - Math.hypot(e.x - p.x, e.z - p.z)) * 0.15);
      const hidden = !clearLine(p.x, eyeY0, p.z, cx, gy + 0.95, cz, 0.15);
      let peek = clearLine(p.x, eyeY0, p.z, cx, gy + 1.65, cz, 0.15);
      let px = null;
      let pz = null;
      if (hidden && !peek) {
        // tall cover: a side step that opens the line (lean out around the corner)
        const ux = (cx - p.x) / (dt || 1);
        const uz = (cz - p.z) / (dt || 1);
        for (const side of aiRnd() < 0.5 ? SIDES_A : SIDES_B) {
          const qx = cx - uz * side;
          const qz = cz + ux * side;
          if (W.isWater(qx, qz) || Math.abs(W.H(qx, qz) - gy) > 1.2) continue;
          if (clearLine(p.x, eyeY0, p.z, qx, W.H(qx, qz) + 1.6, qz, 0.15)) {
            px = qx;
            pz = qz;
            peek = true;
            break;
          }
        }
      }
      if (hidden) s += 3;
      if (peek) s += 1.5;
      if (hidden && peek) s += 1;
      if (e.squad) for (const m of e.squad.members) if (m !== e && m.cover && Math.hypot(m.cover[0] - cx, m.cover[1] - cz) < 3.5) s -= 2.5;
      s += aiRnd() * 0.6;
      if (s > bs) {
        bs = s;
        best = px != null ? [cx, cz, hidden, px, pz] : [cx, cz, hidden];
      }
    }
    return best;
  }
  const SIDES_A = [1.7, -1.7, 2.8, -2.8];
  const SIDES_B = [-1.7, 1.7, -2.8, 2.8];

  /**
   * Lost sight of the target: the nearest spot on an arc around it (keep[0]…keep[0] + 10 m, within ±80° of our
   * bearing) from where a standing raider sees it; else halfway in, but no closer than keep[0].
   */
  function advanceSpot(e, p) {
    const def = e.def;
    const base = headingTo(p.x, p.z, e.x, e.z);
    const eyeY0 = p.y + 1.4;
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < 9; i++) {
      const a = base + (aiRnd() - 0.5) * 2.8;
      const r = def.keep[0] + aiRnd() * 10;
      const x = p.x - Math.sin(a) * r;
      const z = p.z - Math.cos(a) * r;
      if (W.isWater(x, z)) continue;
      const gy = W.H(x, z);
      if (gy < 0.6 || Math.abs(gy - e.y) > 8) continue;
      if (!clearLine(p.x, eyeY0, p.z, x, gy + 1.6, z, 0.15)) continue;
      const d = Math.hypot(x - e.x, z - e.z);
      if (d < bd) {
        bd = d;
        best = [x, z, false];
      }
    }
    if (best) return best;
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.max(0, Math.min(d * 0.5, d - def.keep[0]));
    return [e.x + (dx / d) * step, e.z + (dz / d) * step, false];
  }

  /** No terrain cover: plant a portable barrier between us and the target. */
  function deployBarrier(e, p, now) {
    if (now < e.barrierAt || W.enemies.size >= SPAWN.maxTotal + 10) return false;
    e.barrierAt = now + 26000;
    const h = headingTo(e.x, e.z, p.x, p.z);
    const bx = e.x - Math.sin(h) * 1.25;
    const bz = e.z - Math.cos(h) * 1.25;
    if (W.isWater(bx, bz)) return false;
    const b = create('barrier', bx, bz, { h: h + Math.PI }); // faces the target
    if (!b) return false;
    b.owner = e.id;
    emitFire(e, { w: 'barrier', at: [r2(bx), r2(b.y), r2(bz)], h: r2(b.h), target: p.id });
    e.cover = [e.x, e.z, true];
    return true;
  }

  function stepRaider(e, dt, now) {
    const def = e.def;
    const A = def.attack;
    const p = e.target;
    const s = e.squad;
    dv[0] = 0;
    dv[1] = 0;
    // a burst in progress keeps going
    if (e.burstLeft > 0 && now >= e.burstAt) {
      e.burstLeft--;
      e.burstAt = now + A.gap * 1000;
      if (p && !p.dead && targetable(W, p)) {
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        const suppressor = s?.suppressor === e;
        const hurt = now - e.hurtAt < 1200 ? 0.22 : 0;
        const panic = now < (e.panicUntil || 0) ? 0.2 : 0;
        let acc = A.accuracy * (1 - (d / A.range) * 0.6) - crossSpeed(p, e.x, e.z) * 0.035 - hurt - panic;
        if (suppressor) acc *= 0.55;
        acc = e.los ? clamp(acc, A.minAccuracy, A.accuracy) : 0;
        const fx = -Math.sin(e.h);
        const fz = -Math.cos(e.h);
        _o[0] = e.x + fx * 0.55 + fz * -0.22;
        _o[1] = e.y + (e.crouch ? 1.15 : 1.42);
        _o[2] = e.z + fz * 0.55 - fx * -0.22;
        rangedShot(e, p, _o, A, acc, 95);
      } else e.burstLeft = 0;
    }
    if (!p) {
      e.crouch = false;
      e.cover = null;
      patrol(e, now, 26, 0.32, dv);
      const hs = moveGround(e, dt, 6, def.speed);
      if (hs > 0.3) e.h = Math.atan2(-e.vx, -e.vz);
      return;
    }
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const d = Math.hypot(dx, dz) || 1e-3;
    const sees = seesTarget(e, now);
    // hurt → fall back once, a squadmate covers
    if (!e.retreated && e.hp < e.maxHp * def.retreatAt) {
      e.retreated = true;
      e.retreatUntil = now + 6500;
      e.cover = pickCover(e, p, true, false);
      e.coverUntil = e.retreatUntil;
      e.crouch = false;
      e.aimUntil = 0;
      if (s) for (const m of s.members) if (m !== e && m.target) s.suppressor = m;
    }
    const retreating = now < e.retreatUntil;
    if (retreating) e.flags |= FLAG.RETREAT;
    // squad roles: one flanker (squads of 3+), one suppressor
    if (s && s.members.length >= 3 && !s.flanker && now > s.flankAt) {
      const cand = s.members.find((m) => m !== s.members[0] && m.target && now >= m.retreatUntil);
      if (cand) {
        s.flanker = cand;
        s.flankAt = now + 14000;
        cand.flankSide = aiRnd() < 0.5 ? -1 : 1;
        cand.cover = pickCover(cand, p, false, true);
        cand.coverUntil = now + 9000;
        cand.flankUntil = now + 9000;
      }
    }
    if (s && (!s.suppressor || !s.suppressor.target)) s.suppressor = s.members.find((m) => m !== s.flanker && m.target && now >= m.retreatUntil) || null;
    if (s?.flanker === e && now > (e.flankUntil || 0)) s.flanker = null;
    // pick / refresh a position
    if (!e.cover || now > e.coverUntil || (!sees && now - e.seenAt > 3500 && !retreating)) {
      if (!sees && now - e.seenAt > 3500 && e.target) {
        // lost sight: work around to a spot that sees them again — at rifle range, never into their face
        e.cover = advanceSpot(e, p);
        e.coverUntil = now + 4000;
        e.seenAt = now;
      } else {
        e.cover = pickCover(e, p, false, s?.flanker === e);
        e.coverUntil = now + 5500 + aiRnd() * 4000;
        if (e.cover && !e.cover[2] && d < 45 && !retreating && deployBarrier(e, p, now)) e.coverUntil = now + 9000;
      }
    }
    const goal = e.cover;
    // tall cover: step out to the side peek point to shoot, back in afterwards (a hit sends it back at once)
    const side = !!goal && goal[3] != null;
    if (!side || retreating || now - e.hurtAt < 250) e.peekOut = false;
    const out = side && e.peekOut;
    const gx = goal ? (out ? goal[3] : goal[0]) : 0;
    const gz = goal ? (out ? goal[4] : goal[1]) : 0;
    const gd = goal ? Math.hypot(gx - e.x, gz - e.z) : 0;
    e.h = headingTo(e.x, e.z, p.x, p.z);
    if (goal && gd > (side ? 0.55 : 1.3)) {
      // on the move (no shooting while running, except the suppressor's covering bursts)
      e.crouch = false;
      e.aimUntil = 0;
      e.st = ES.CHASE;
      const sp = def.speed * (retreating ? 1.15 : side && gd < 4 ? 0.85 : 1);
      dv[0] = ((gx - e.x) / gd) * sp;
      dv[1] = ((gz - e.z) / gd) * sp;
      moveGround(e, dt, side ? 10 : 7, def.speed * 1.15);
      return;
    }
    // in position: hide → peek (aim line) → burst → hide …
    e.st = ES.ATTACK;
    moveGround(e, dt, 7, def.speed); // dv = 0: settle
    const suppressor = s?.suppressor === e;
    if (suppressor) e.flags |= FLAG.SUPPRESS;
    if (e.aimUntil) {
      e.crouch = false;
      e.flags |= FLAG.AIM;
      if (now >= e.aimUntil) {
        e.aimUntil = 0;
        e.burstLeft = A.burst;
        e.burstAt = now;
        e.bursts++;
        // every few bursts: duck and reload
        e.peekAt = now + (e.bursts % 4 === 0 ? 2300 : suppressor ? 500 + aiRnd() * 500 : 1100 + aiRnd() * 1500) + A.burst * A.gap * 1000;
      }
      return;
    }
    if (now < e.peekAt || e.burstLeft > 0) {
      if (out && e.burstLeft <= 0) {
        e.peekOut = false; // burst done: back behind the wall
        return;
      }
      e.crouch = e.burstLeft <= 0 && !!goal?.[2] && !out;
      if (e.crouch) e.flags |= FLAG.CROUCH;
      return;
    }
    if (side && !out) {
      e.peekOut = true; // lean out first
      return;
    }
    // stand up and look: line of sight from standing height decides the peek
    e.crouch = false;
    e.losT = 0;
    const view = seesTarget(e, now);
    if (d <= A.range && view) {
      e.aimUntil = now + A.aim * 1000 * (suppressor ? 0.7 : 1);
      e.flags |= FLAG.AIM;
      emitFire(e, { w: 'aim', ct: A.aim, target: p.id });
    } else {
      e.peekOut = false;
      e.peekAt = now + 700;
      e.coverUntil = Math.min(e.coverUntil, now + 1200);
    }
  }

  // ------------------------------------------------------------ De Wachter (world boss)
  const _eye = [0, 0, 0];
  const ARENA = { id: 'arena', type: 'arena', variant: 0, x: BOSS.site.x, y: NaN, z: BOSS.site.z, rot: 0, radius: 36 };
  function bossTick(now) {
    const site = BOSS.site;
    let near = false;
    for (const p of W.players.values()) {
      if (p.m === 'space' || p.dead) continue;
      if (Math.hypot(p.x - site.x, p.z - site.z) < BOSS.spawnRange) {
        near = true;
        break;
      }
    }
    if (near) {
      // the arena's monoliths: cover from the beam (and from everything else)
      if (!Number.isFinite(ARENA.y)) ARENA.y = W.H(site.x, site.z);
      rememberCover('arena', ARENA, now);
    }
    if (!boss.e) {
      if (near && now >= boss.deadUntil && !W.world.isSafe(site.x, site.z)) {
        const e = create(BOSS.type, site.x, site.z, { h: site.h });
        if (e) {
          e.home = { x: site.x, z: site.z };
          e.phase = 0;
          e.mode = 'dormant';
          e.kneel = 1;
          e.runes = 0;
          e.runeHp = [0, e.def.rune.hp, e.def.rune.hp, e.def.rune.hp];
          e.dmgBy = new Map();
          e.waves = [];
          e.beam = null;
          e.next = { stomp: 0, beam: 0, summon: 0 };
          e.seen = new Set();
          boss.e = e;
          boss.emptyT = 0;
        }
      }
      return;
    }
    // nobody around a dormant boss for a while → unload it
    if (!near && boss.e.mode === 'dormant') {
      boss.emptyT += 1;
      if (boss.emptyT > 30) destroy(boss.e);
    } else boss.emptyT = 0;
  }

  /** Players who count as fighting the boss (in / at the arena). */
  function fighters(e, extra = 30) {
    const out = [];
    for (const p of W.players.values()) if (targetable(W, p) && Math.hypot(p.x - e.home.x, p.z - e.home.z) < BOSS.arena + extra) out.push(p);
    return out;
  }

  function bossEvent(e, msg, everyone = false) {
    msg.t = S.EVENT;
    msg.kind = 'boss';
    msg.id = e.id;
    W.emit(everyone ? '*' : { near: [e.x, e.z, NET.INTEREST_RADIUS + 60] }, msg);
  }
  const bossInfo = (e) => ({ name: BOSS.name, hp: Math.round(e.hp), maxHp: e.maxHp, stage: e.phase, runes: e.runes, at: [r2(e.x), r2(e.y), r2(e.z)] });

  function wake(e, now) {
    if (e.mode !== 'dormant') return;
    const n = Math.max(1, fighters(e, 60).length);
    const def = e.def;
    e.maxHp = Math.min(def.maxHpCap, def.hp + def.hpPerPlayer * (n - 1));
    e.hp = e.maxHp;
    e.mode = 'waking';
    e.wakeUntil = now + BOSS.wakeTime * 1000;
    e.phase = 1;
    e.idleT = 0;
    e.next = { stomp: e.wakeUntil + 1500, beam: e.wakeUntil + 4500, summon: 0 };
    e.seen.clear();
    emitFire(e, { w: 'roar', ct: BOSS.wakeTime });
    bossEvent(e, { phase: 'start', ...bossInfo(e) });
    for (const p of W.players.values()) if (Math.hypot(p.x - e.x, p.z - e.z) < NET.INTEREST_RADIUS + 60) e.seen.add(p.id);
  }

  function resetBoss(e, now) {
    e.mode = 'dormant';
    e.phase = 0;
    e.kneel = 1;
    e.hp = e.maxHp = e.def.hp;
    e.runes = 0;
    e.runeHp = [0, e.def.rune.hp, e.def.rune.hp, e.def.rune.hp];
    e.target = null;
    e.waves.length = 0;
    e.beam = null;
    e.dmgBy.clear();
    e.st = ES.IDLE;
    for (const o of [...W.enemies.values()]) if (o.summoned === e.id) destroy(o);
    bossEvent(e, { phase: 'end', result: 'reset' });
    e.resetAt = now;
  }

  function stepWarden(e, dt, now) {
    const def = e.def;
    // late joiners in range get the start event (boss bar)
    if (e.mode !== 'dormant' && e.mode !== 'dead') {
      for (const p of W.players.values()) {
        if (e.seen.has(p.id) || Math.hypot(p.x - e.x, p.z - e.z) > NET.INTEREST_RADIUS) continue;
        e.seen.add(p.id);
        W.emit(p.id, { t: S.EVENT, kind: 'boss', phase: 'start', id: e.id, late: true, ...bossInfo(e) });
      }
    }
    stepWaves(e, now);
    stepBeam(e, now);
    if (e.mode === 'dormant') {
      e.st = ES.IDLE;
      e.kneel = Math.min(1, e.kneel + dt * 0.4);
      // drift back to the plinth after a reset
      const hd = Math.hypot(e.home.x - e.x, e.home.z - e.z);
      if (hd > 0.5) {
        e.x += ((e.home.x - e.x) / hd) * Math.min(hd, def.speed * dt);
        e.z += ((e.home.z - e.z) / hd) * Math.min(hd, def.speed * dt);
        e.y = W.H(e.x, e.z);
      } else e.h += wrapAngle(BOSS.site.h - e.h) * Math.min(1, dt * 0.5);
      for (const p of W.players.values()) {
        if (canTarget(p, now) && Math.hypot(p.x - e.home.x, p.z - e.home.z) < BOSS.wake) {
          wake(e, now);
          break;
        }
      }
      return;
    }
    if (e.mode === 'waking') {
      e.st = ES.IDLE;
      e.kneel = clamp((e.wakeUntil - now) / (BOSS.wakeTime * 1000), 0, 1);
      if (now >= e.wakeUntil) {
        e.mode = 'fight';
        e.kneel = 0;
        bossEvent(e, { phase: 'phase', n: 1, hp: Math.round(e.hp), maxHp: e.maxHp });
      }
      return;
    }
    if (e.mode === 'stagger') {
      e.st = ES.STUN;
      e.kneel = Math.min(0.55, e.kneel + dt * 2.5);
      if (now >= e.staggerUntil) e.mode = 'fight';
      return;
    }
    // fight
    e.kneel = Math.max(0, e.kneel - dt * 1.5);
    if (now >= e.thinkAt) {
      e.thinkAt = now + 500;
      const fs = fighters(e, 25);
      if (!fs.length) {
        e.idleT = (e.idleT || 0) + 0.5;
        e.target = null;
        if (e.idleT > BOSS.resetAfter) {
          resetBoss(e, now);
          return;
        }
      } else {
        e.idleT = 0;
        // the closest fighter, switching to the one hurting it most every so often
        let best = null;
        let bs = Infinity;
        for (const p of fs) {
          const dmg = e.dmgBy.get(p.id)?.recent || 0;
          const s = Math.hypot(p.x - e.x, p.z - e.z) - dmg * 0.08;
          if (s < bs) {
            bs = s;
            best = p;
          }
        }
        e.target = best;
        for (const v of e.dmgBy.values()) v.recent *= 0.85;
      }
    }
    const p = e.target;
    e.st = p ? ES.ATTACK : ES.IDLE;
    if (!p) return;
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    // turn (slowly — you can get behind it) and plod toward the target inside the arena
    const want = headingTo(e.x, e.z, p.x, p.z);
    const busy = now < (e.busyUntil || 0);
    const turn = (busy ? 0.25 : 0.75) * dt;
    e.h += clamp(wrapAngle(want - e.h), -turn, turn);
    if (!busy && d > 24) {
      const hx = e.x - Math.sin(e.h) * def.speed * dt;
      const hz = e.z - Math.cos(e.h) * def.speed * dt;
      if (Math.hypot(hx - e.home.x, hz - e.home.z) < def.leash && !W.isWater(hx, hz)) {
        e.x = hx;
        e.z = hz;
        e.y = W.H(hx, hz);
        e.st = ES.CHASE;
      }
    }
    if (busy) return;
    const fast = e.phase >= 3 ? 0.7 : 1;
    const cd = BOSS.cooldowns;
    // pick an attack: stomp when someone is close, the beam at range, drones from phase 2
    const close = fighters(e, 0).some((q) => Math.hypot(q.x - e.x, q.z - e.z) < def.stomp.radius * 0.8);
    if (e.phase >= 2 && now >= e.next.summon) {
      e.next.summon = now + rnd(cd.summon[0], cd.summon[1]) * 1000;
      summon(e, p, now);
      e.busyUntil = now + 1600;
    } else if (close && now >= e.next.stomp) {
      e.next.stomp = now + rnd(cd.stomp[0], cd.stomp[1]) * 1000 * fast;
      stomp(e, now, e.phase >= 3);
    } else if (d < def.beam.range && now >= e.next.beam) {
      e.next.beam = now + rnd(cd.beam[0], cd.beam[1]) * 1000 * fast;
      beam(e, p, now);
    } else if (now >= e.next.stomp && d < def.stomp.radius) {
      e.next.stomp = now + rnd(cd.stomp[0], cd.stomp[1]) * 1000 * fast;
      stomp(e, now, e.phase >= 3);
    }
  }

  function stomp(e, now, double) {
    const S0 = e.def.stomp;
    const side = (e.stompSide = -(e.stompSide || 1));
    const c = Math.cos(e.h);
    const s = Math.sin(e.h);
    // the foot lands ~3 m ahead of the hip on its side
    const fx = e.x + side * 2.6 * c + -3 * s;
    const fz = e.z - side * 2.6 * s + -3 * c;
    const fy = W.H(fx, fz);
    const windup = S0.windup * (e.phase >= 3 ? 0.85 : 1);
    emitFire(e, { w: 'stomp', phase: 'windup', ct: windup, at: [r2(fx), r2(fy), r2(fz)], r: S0.radius, side });
    e.waves.push({ at: now + windup * 1000, x: fx, y: fy, z: fz, hit: new Set(), sent: false });
    e.busyUntil = now + windup * 1000 + 900;
    if (double) {
      const fx2 = e.x - side * 2.6 * c + -3 * s;
      const fz2 = e.z + side * 2.6 * s + -3 * c;
      const t2 = now + (windup + 1.25) * 1000;
      e.waves.push({ at: t2, x: fx2, y: W.H(fx2, fz2), z: fz2, hit: new Set(), sent: false, side: -side, windup: 1.1 });
      e.busyUntil = t2 + 900;
    }
  }

  function stepWaves(e, now) {
    const S0 = e.def.stomp;
    for (let i = e.waves.length - 1; i >= 0; i--) {
      const w = e.waves[i];
      if (!w.warned && w.windup) {
        // the second foot of a double stomp gets its own tell
        if (now >= w.at - w.windup * 1000) {
          w.warned = true;
          emitFire(e, { w: 'stomp', phase: 'windup', ct: w.windup, at: [r2(w.x), r2(w.y), r2(w.z)], r: S0.radius, side: w.side });
        }
      }
      if (now < w.at) continue;
      if (!w.sent) {
        w.sent = true;
        emitFire(e, { w: 'stomp', phase: 'hit', at: [r2(w.x), r2(w.y), r2(w.z)], r: S0.radius, speed: S0.speed });
      }
      const front = (S0.speed * (now - w.at)) / 1000;
      for (const p of W.players.values()) {
        if (w.hit.has(p.id) || !targetable(W, p)) continue;
        const d = Math.hypot(p.x - w.x, p.z - w.z);
        if (d > S0.radius || Math.abs(d - front) > S0.band) continue;
        w.hit.add(p.id);
        if (airborne(p) || dodged(p, now) || Math.abs(p.y - w.y) > 6) {
          W.emit(p.id, { t: S.EVENT, kind: 'dodged', by: e.id, w: 'stomp' });
          continue;
        }
        const dmg = Math.round(S0.dmg * (1 - 0.45 * (d / S0.radius)));
        pending.push({ at: now, apply: now, pid: p.id, by: e.id, byType: e.type, dmg, kind: 'stomp', fx: w.x, fy: w.y, fz: w.z, noDodge: true });
      }
      if (front > S0.radius + S0.band) e.waves.splice(i, 1);
    }
  }

  function beam(e, p, now) {
    const B = e.def.beam;
    const dir = aiRnd() < 0.5 ? -1 : 1;
    const toP = headingTo(e.x, e.z, p.x, p.z);
    const arc = B.arc * (e.phase >= 3 ? 1.15 : 1);
    const a0 = toP - (dir * arc) / 2;
    const a1 = toP + (dir * arc) / 2;
    const dur = B.sweep * (e.phase >= 2 ? 0.85 : 1);
    wardenEye(e.x, e.y, e.z, e.h, _eye, e.kneel);
    emitFire(e, { w: 'beam', phase: 'windup', ct: B.windup, a0: r2(a0), a1: r2(a1), dur: r2(dur), o: [r2(_eye[0]), r2(_eye[1]), r2(_eye[2])], range: B.range, target: p.id });
    e.beam = { start: now + B.windup * 1000, a0, a1, dur, last: new Map() };
    e.busyUntil = e.beam.start + dur * 1000 + 700;
  }

  function stepBeam(e, now) {
    const bm = e.beam;
    if (!bm || now < bm.start) return;
    const t = (now - bm.start) / 1000;
    if (t > bm.dur) {
      e.beam = null;
      return;
    }
    const B = e.def.beam;
    const a = beamHeading(bm.a0, bm.a1, bm.dur, t);
    e.h += wrapAngle(a - e.h) * 0.35; // the head drags the body along a little
    wardenEye(e.x, e.y, e.z, e.h, _eye, e.kneel);
    for (const p of W.players.values()) {
      if (!targetable(W, p)) continue;
      const d = Math.hypot(p.x - _eye[0], p.z - _eye[2]);
      if (d > B.range || d < 2) continue;
      const pa = headingTo(_eye[0], _eye[2], p.x, p.z);
      const half = Math.max(0.03, 1.15 / d);
      if (Math.abs(wrapAngle(pa - a)) > half) continue;
      const last = bm.last.get(p.id) || 0;
      if (now - last < B.tick * 1000) continue;
      bm.last.set(p.id, now);
      if (!clearLine(_eye[0], _eye[1], _eye[2], p.x, p.y + 1.2, p.z, 0.5)) continue; // behind a monolith: safe
      if (dodged(p, now)) {
        W.emit(p.id, { t: S.EVENT, kind: 'dodged', by: e.id, w: 'beam' });
        continue;
      }
      pending.push({ at: now, apply: now, pid: p.id, by: e.id, byType: e.type, dmg: B.dmg, kind: 'beam', fx: _eye[0], fy: _eye[1], fz: _eye[2], noDodge: true });
    }
  }

  function summon(e, p, now) {
    const sp = BOSS.summon;
    let alive = 0;
    for (const o of W.enemies.values()) if (o.summoned === e.id) alive++;
    const n = Math.min(sp.n, sp.max - alive);
    if (n <= 0) return;
    emitFire(e, { w: 'summon', n, at: [r2(e.x), r2(e.y + 15), r2(e.z)] });
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = e.x + Math.cos(e.h) * side * (4 + i) + Math.sin(e.h) * 3;
      const z = e.z - Math.sin(e.h) * side * (4 + i) + Math.cos(e.h) * 3;
      const d = create(sp.type, x, z, { summoned: e.id });
      if (!d) continue;
      d.y = e.y + 15;
      d.home = { x: e.home.x, z: e.home.z };
      d.leashOverride = BOSS.arena + 20;
      d.target = p;
      d.nextAttackAt = now + 1500 + i * 400;
    }
  }

  function bossDamage(e, amount, by, opts, now) {
    if (e.mode === 'dormant') {
      wake(e, now);
      return 0;
    }
    if (e.mode === 'waking' || e.mode === 'dead' || now < (e.invulnUntil || 0)) return 0;
    const R = e.def.rune;
    const w = opts.weak | 0;
    if (w >= 1 && w <= 3 && !(e.runes & (1 << (w - 1)))) {
      e.runeHp[w] -= amount;
      if (e.runeHp[w] <= 0) {
        e.runes |= 1 << (w - 1);
        amount += e.maxHp * R.bonus;
        e.mode = 'stagger';
        e.staggerUntil = now + R.stagger * 1000;
        e.beam = null;
        bossEvent(e, { phase: 'rune', rune: w, runes: e.runes, by: by?.id ?? null });
      }
    }
    if (by?.id) {
      const v = e.dmgBy.get(by.id) || { total: 0, recent: 0 };
      v.total += amount;
      v.recent += amount;
      e.dmgBy.set(by.id, v);
    }
    // phase gates: each costs a roar and a brief pause
    const frac = (e.hp - amount) / e.maxHp;
    const nextPhase = frac < BOSS.phases[2] ? 3 : frac < BOSS.phases[1] ? 2 : 1;
    if (nextPhase > e.phase && e.hp - amount > 0) {
      e.phase = nextPhase;
      e.invulnUntil = now + 1600;
      e.busyUntil = now + 2200;
      e.next.summon = now + 2500;
      e.beam = null;
      emitFire(e, { w: 'roar', ct: 1.6 });
      bossEvent(e, { phase: 'phase', n: nextPhase, hp: Math.round(e.hp - amount), maxHp: e.maxHp });
    }
    return amount;
  }

  function bossDeath(e, by) {
    const now = W.now();
    e.mode = 'dead';
    boss.deadUntil = now + BOSS.respawn * 1000;
    for (const o of [...W.enemies.values()]) {
      if (o.summoned !== e.id) continue;
      destroy(o);
      W.emit({ near: [o.x, o.z, NET.INTEREST_RADIUS] }, { t: S.DEATH, id: o.id, type: o.type, by: null, at: [r2(o.x), r2(o.y), r2(o.z)] });
    }
    // a crate for everyone who fought (dealt damage or stood in the arena), owner-only for 10 minutes
    const got = new Set();
    for (const [id, v] of e.dmgBy) if (v.total > 0) got.add(id);
    for (const p of fighters(e, 40)) got.add(p.id);
    let k = 0;
    const drops = [];
    for (const id of got) {
      const p = W.players.get(id);
      if (!p) continue;
      const a = (k++ / Math.max(1, got.size)) * Math.PI * 2;
      const x = e.x + Math.cos(a) * 5;
      const z = e.z + Math.sin(a) * 5;
      const bundle = rollTable(e.def.loot, 1);
      if (!p.inv.weapons.includes('railgun') && WEAPONS.railgun) bundle.weapons = ['railgun'];
      const l = W.loot.spawn([x, Math.max(W.H(x, z), 0) + 0.4, z], bundle, { owner: id, ttl: 600, kind: 'boss' });
      if (l) drops.push(l.id);
    }
    const killer = by?.id ? W.players.get(by.id) : null;
    bossEvent(e, { phase: 'end', result: 'defeated', by: by?.id ?? null, byName: killer?.name, at: [r2(e.x), r2(e.y), r2(e.z)], respawnAt: boss.deadUntil, drops }, true);
  }

  // ------------------------------------------------------------ damage / death
  function damage(e, amount, by, kind, at, opts = {}) {
    if (e.hp <= 0 || !(amount > 0)) return;
    const now = W.now();
    if (e.def.boss) {
      amount = bossDamage(e, amount, by, opts, now);
      if (!(amount > 0)) return;
    }
    e.hp = Math.max(0, e.hp - amount);
    e.hurtAt = now;
    const attacker = by && by.id ? W.players.get(by.id) : null;
    if (!e.def.prop && !e.def.boss) {
      // getting shot pulls the enemy (and its squad / pack) into the fight
      if (attacker && targetable(W, attacker) && !e.target) setTarget(e, attacker, now);
      e.returning = false;
      if (attacker) {
        for (const o of W.enemies.values()) {
          if (o === e || o.target || o.def.prop || o.def.boss) continue;
          const mate = (e.squad && o.squad === e.squad) || (o.type === e.type && Math.hypot(o.x - e.x, o.z - e.z) < 35);
          if (!mate) continue;
          if (targetable(W, attacker) && Math.hypot(attacker.x - o.x, attacker.z - o.z) < aggroOf(o) * 1.6) {
            o.joinTarget = attacker;
            o.joinAt = now + 200 + aiRnd() * 500;
          } else o.investigate = { x: attacker.x, z: attacker.z, until: now + 10000 };
        }
      }
      // knockback / flinch
      const src = attacker || (at ? { x: at[0], z: at[2] } : null);
      if (src) {
        const dx = e.x - src.x;
        const dz = e.z - src.z;
        const l = Math.hypot(dx, dz) || 1;
        const k = clamp(amount / (e.def.flying ? 5 : 14), 0.4, e.def.flying ? 9 : 4);
        e.vx += (dx / l) * k;
        e.vz += (dz / l) * k;
        if (e.def.flying) e.vy += k * 0.3;
      }
      if (e.type === 'raider' && amount >= 6 && e.aimUntil) e.aimUntil += 280; // a hit throws off their aim
      if (e.type === 'drone' && e.chargeUntil && amount >= 20) e.chargeUntil += 250;
      // low health: fall back (drones, stalkers once each; raiders in their own step)
      const R = e.def.retreatAt;
      if (R && e.hp > 0 && e.hp < e.maxHp * R && !e.retreated && e.type !== 'raider') {
        e.retreated = true;
        e.retreatUntil = now + (e.type === 'stalker' ? 3500 : 5000);
      }
    }
    const msg = { t: S.DAMAGE, target: e.id, by: by?.id ?? null, amount: Math.round(amount * 10) / 10, hp: Math.round(e.hp), sh: 0, kind, at: [r2(at[0]), r2(at[1]), r2(at[2])] };
    if (opts.crit) msg.crit = true;
    if (opts.weak) msg.weak = opts.weak;
    if (opts.aoe) msg.aoe = true;
    if (e.hp <= 0) msg.kill = true;
    if (by?.id && W.players.has(by.id)) W.emit(by.id, msg);
    if (e.hp <= 0) kill(e, by, kind);
  }

  function rollTable(L, mult) {
    const b = {};
    const r = W.rng;
    const sc = (a, c) => Math.max(0, Math.round(randInt(r, a, c) * mult));
    if (L.res) for (const [k, [a, c]] of Object.entries(L.res)) (b.res || (b.res = {}))[k] = sc(a, c);
    if (L.pick) {
      const keys = Object.keys(L.pick);
      const k = keys[Math.floor(r() * keys.length)];
      const [a, c] = L.pick[k];
      (b.res || (b.res = {}))[k] = (b.res?.[k] || 0) + sc(a, c);
    }
    if (L.ammo) {
      for (const [k, [a, c, chance = 1]] of Object.entries(L.ammo)) {
        if (r() < chance) (b.ammo || (b.ammo = {}))[k] = sc(a, c);
      }
    }
    if (L.credits) b.credits = sc(L.credits[0], L.credits[1]);
    if (L.items) {
      for (const [k, [a, c, chance = 1]] of Object.entries(L.items)) {
        // only items the inventory knows (shared/defs/items.js) — unknown ids would stick in the crate
        if (!ITEMS[k]) continue;
        if (r() < Math.min(1, chance * (0.75 + 0.25 * mult))) (b.items || (b.items = {}))[k] = randInt(r, a, c);
      }
    }
    return b;
  }

  function rollLoot(e) {
    const def = e.def;
    let mult = 1;
    if (isNight()) mult *= DANGER.night;
    if (e.garrison) mult *= DANGER.garrison;
    if (e.hunt) mult *= DANGER.hunt;
    if (e.elite) mult *= DANGER.elite;
    if (e.summoned) mult *= DANGER.summon;
    const b = rollTable(def.loot || {}, mult);
    if (def.rare && W.rng() < def.rare.chance * (e.elite || e.garrison ? 2 : 1)) b.weapons = [def.rare.weapon];
    // rare extras by danger (night / captains / hunters)
    if (!e.summoned) {
      if (isNight()) rare(b, RARE.night);
      if (e.elite) rare(b, RARE.elite);
      if (e.hunt) rare(b, RARE.hunt);
    }
    return b;
  }
  function rare(b, table) {
    for (const id in table) {
      if (!ITEMS[id] || W.rng() >= table[id]) continue;
      const items = b.items || (b.items = {});
      items[id] = (items[id] || 0) + 1;
    }
  }

  function kill(e, by, kind) {
    const now = W.now();
    destroy(e);
    const killer = by?.id ? W.players.get(by.id) : null;
    if (e.def.boss) {
      if (killer) killer.kills++;
      W.emit({ near: [e.x, e.z, NET.INTEREST_RADIUS + 60] }, { t: S.DEATH, id: e.id, type: e.type, by: by?.id ?? null, byName: killer?.name, w: kind, at: [r2(e.x), r2(e.y), r2(e.z)] });
      bossDeath(e, by);
      return;
    }
    let drop = null;
    if (!e.def.prop) {
      const ground = W.H(e.x, e.z);
      drop = W.loot.spawn([e.x, Math.max(ground, 0) + 0.3, e.z], rollLoot(e), { ttl: LOOT.ttl, kind: 'drop' });
      if (killer) killer.kills++;
      // a fallen friend draws the others
      alertAround(e.x, e.z, 45, killer, now);
    }
    const msg = { t: S.DEATH, id: e.id, type: e.type, by: by?.id ?? null, byName: killer?.name, w: kind, at: [r2(e.x), r2(e.y), r2(e.z)] };
    if (drop) msg.drop = drop.id;
    if (e.elite) msg.elite = true;
    W.emit({ near: [e.x, e.z, NET.INTEREST_RADIUS] }, msg);
    if (e.elite && e.lastSquad) for (const m of e.lastSquad.members) m.panicUntil = now + 2500;
    if (e.garrison) {
      const g = garrisons.get(e.garrison);
      if (g && g.state === 'active' && !g.members.size) garrisonCleared(g, now);
    }
  }

  function stun(e, seconds) {
    if (e.def.boss || e.def.prop) return;
    e.stunUntil = Math.max(e.stunUntil, W.now() + seconds * 1000);
    e.chargeUntil = 0;
    e.aimUntil = 0;
    e.burstLeft = 0;
    e.windupUntil = 0;
  }

  // ------------------------------------------------------------ step
  function think(e, now) {
    const def = e.def;
    if (W.world.isSafe(e.x, e.z)) {
      e.target = null;
      e.returning = true;
    }
    e.thinkAt = now + THINK_MS + aiRnd() * 120;
    const t = e.target;
    const leash = e.leashOverride || def.leash;
    if (t && (!W.players.has(t.id) || !targetable(W, t) || inGrace(t, now) || Math.hypot(t.x - e.x, t.z - e.z) > aggroOf(e) * 1.6)) {
      e.target = null;
      // keep looking where they were last
      if (W.players.has(t.id) && !t.dead) e.investigate = { x: t.x, z: t.z, until: now + 6000 };
    }
    if (!e.target && e.joinTarget && now >= (e.joinAt || 0)) {
      const j = e.joinTarget;
      e.joinTarget = null;
      if (W.players.has(j.id) && canTarget(j, now) && Math.hypot(j.x - e.x, j.z - e.z) < aggroOf(e) * 1.8) setTarget(e, j, now);
    }
    if (!e.target && e.squad?.target && now >= (e.joinAt || 0)) {
      const st = e.squad.target;
      if (W.players.has(st.id) && canTarget(st, now) && Math.hypot(st.x - e.x, st.z - e.z) < aggroOf(e) * 1.6) setTarget(e, st, now);
    }
    if (!e.target && !e.returning) {
      const c = nearestTarget(e, aggroOf(e), now);
      if (c && losTo(e, c)) setTarget(e, c, now);
    }
    // hunters follow the trail of their quarry
    if (e.hunt && !e.target) {
      const q = W.players.get(e.hunt);
      if (!q || q.dead || now > (e.huntUntil || 0) || !targetable(W, q)) {
        e.hunt = null;
        e.investigate = null;
      } else if (!e.investigate || now - (e.trailAt || 0) > 3000) {
        e.trailAt = now;
        e.investigate = { x: q.x, z: q.z, until: e.huntUntil };
      }
    }
    if (e.target) e.flags &= ~FLAG.ALERT;
    const dh = Math.hypot(e.x - e.home.x, e.z - e.home.z);
    if (dh > leash && !e.hunt) {
      e.target = null;
      e.returning = true;
      e.investigate = null;
      e.wp = [e.home.x, e.home.z];
      e.wpAt = now + 30000;
    } else if (e.returning && dh < leash * 0.4) {
      e.returning = false;
      e.hp = e.maxHp; // regroup at home: full health
      e.retreated = false;
    }
  }

  function step(dt) {
    const now = W.now();
    for (const p of W.players.values()) track(p, now);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = 1;
      spawnTick(now);
      huntTick(now);
      bossTick(now);
    }
    slowTimer -= dt;
    if (slowTimer <= 0) {
      slowTimer = 2;
      garrisonTick(now);
    }
    processPending(now);
    const night = isNight();
    for (const e of W.enemies.values()) {
      const def = e.def;
      e.flags = 0;
      if (def.prop) {
        if (now >= e.until || (e.owner && !W.enemies.has(e.owner) && now >= e.until - 4000)) {
          destroy(e);
          W.emit({ near: [e.x, e.z, NET.INTEREST_RADIUS] }, { t: S.DEATH, id: e.id, type: e.type, by: null, at: [r2(e.x), r2(e.y), r2(e.z)], expired: true });
        }
        continue;
      }
      if (def.boss) {
        if (e.ai !== false) stepWarden(e, dt, now);
        record(e, now);
        continue;
      }
      // despawn when nobody is around (or a night-only creature at daybreak; the boss's drones without it)
      let nearest = Infinity;
      for (const p of W.players.values()) {
        if (p.m === 'space') continue;
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < nearest) nearest = d;
      }
      if (nearest > SPAWN.despawnDist || (e.nightOnly && !night && !e.target) || (e.summoned && (!boss.e || boss.e.id !== e.summoned || boss.e.mode === 'dormant'))) e.far += dt;
      else e.far = 0;
      if (e.far > (e.summoned ? 2 : SPAWN.despawnAfter)) {
        destroy(e);
        continue;
      }
      if (e.ai === false) {
        record(e, now);
        continue;
      }
      if (now < e.stunUntil) {
        e.st = ES.STUN;
        e.vx *= 0.8;
        e.vz *= 0.8;
        e.crouch = false;
        if (def.flying) e.y = Math.max(W.H(e.x, e.z) + 1.5, e.y - 1.2 * dt);
        record(e, now);
        continue;
      }
      if (now >= e.thinkAt) think(e, now);
      if (e.squad) e.lastSquad = e.squad;
      if (def.flying) stepDrone(e, dt, now);
      else if (e.type === 'raider') stepRaider(e, dt, now);
      else if (e.type === 'mite') stepMite(e, dt, now);
      else stepStalker(e, dt, now);
      if (e.crouch) e.flags |= FLAG.CROUCH;
      if (e.elite) e.flags |= FLAG.ELITE;
      if (e.hunt) e.flags |= FLAG.HUNT;
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z)) {
        destroy(e);
        continue;
      }
      e.h = wrapAngle(e.h);
      record(e, now);
    }
  }

  // snapshot rows are built once per tick and shared by every recipient
  let rowsTick = -1;
  let rowsSize = -1;
  const rows = [];
  function bossFlags(e) {
    let f = e.mode === 'dormant' ? 0 : e.phase & BOSS_BITS.PHASE;
    if (e.mode === 'waking') f |= BOSS_BITS.WAKING;
    f |= (e.runes & 7) * BOSS_BITS.RUNE0;
    if (e.mode === 'stagger') f |= BOSS_BITS.STAGGER;
    return f;
  }
  function rowsNear(x, z, R2) {
    if (rowsTick !== W.tick || rowsSize !== W.enemies.size) {
      rowsTick = W.tick;
      rowsSize = W.enemies.size;
      rows.length = 0;
      for (const e of W.enemies.values()) {
        const row = [e.id, e.type, r2(e.x), r2(e.y), r2(e.z), r2(e.h), e.st, Math.round(e.hp)];
        const fl = e.def.boss ? bossFlags(e) : e.flags;
        if (e.target || fl) row.push(e.target ? e.target.id : null);
        if (fl) row.push(fl);
        rows.push(row);
      }
    }
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const dx = r[2] - x;
      const dz = r[4] - z;
      if (dx * dx + dz * dz <= R2) out.push(r);
    }
    return out;
  }

  /** Ends a player's arrival grace now (tests / scripted fights). */
  function endGrace(p) {
    track(p, W.now());
    p.thr.arriveAt = -1e12;
  }

  return {
    step,
    create,
    destroy,
    damage,
    stun,
    posAt,
    rowsNear,
    isNight,
    noise,
    noiseOf: (w) => NOISE[w] || 50,
    /** Is the segment A→B blocked by a POI structure (outpost huts / palisade / crates, wreck hulls)? */
    coverBlocked,
    /** Line of sight through terrain + POI structures. */
    clearLine,
    alertAround: (x, z, r, p) => alertAround(x, z, r, p || null, W.now()),
    /** Scripted / test spawn of a whole squad (raiders, mites) at (x, z) → members. */
    spawnSquad: (type, x, z, n, opts = {}) => spawnGroup(type, x, z, n, { force: true, ...opts }, W.now()),
    endGrace,
    inGrace: (p) => inGrace(p, W.now()),
    get boss() {
      return boss.e;
    },
    bossState: () => ({ alive: !!boss.e, mode: boss.e?.mode ?? null, deadUntil: boss.deadUntil }),
    squads,
    garrisons,
    pending,
  };
}
