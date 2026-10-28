/**
 * Server enemies: seeded spawning around players OUTSIDE the safe hub from the
 * world provider's spawn tables (W.world.spawnRules(x, z, hour): biome-based,
 * more at night; caps per nearby player; never in safe zones / claims / the
 * hub spawn buffer), AI (security drone: hovers 6–12 m up,
 * keeps 15–30 m, strafes, laser with accuracy falloff; jungle stalker: chase,
 * leap, claw), terrain following (getHeightAt / isWater), structure avoidance,
 * leash + despawn, damage / stun / death → loot, and the position history used
 * for lag-compensated hit validation.
 *
 * Snapshot rows: [id, type, x, y, z, h, s, hp] (s = ES code, protocol.js).
 */
import { NET, S, ES } from '../protocol.js';
import { ENEMIES, SPAWN } from '../defs/enemies.js';
import { HUB, hubDist } from '../defs/world.js';
import { LOOT } from '../defs/items.js';
import { mulberry32, hashString } from './rng.js';
import { terrainLOS } from './los.js';
import { damagePlayer, targetable } from './players.js';
import { r2, clamp, headingTo, wrapAngle, randInt } from './util.js';

const HN = 16; // history samples per enemy (16 × 50 ms = 0.8 s ≥ NET.LAG_COMP_MS)
const THINK_MS = 400;
const SAFE_MARGIN = 6;

export function createEnemies(W) {
  const spawnRnd = mulberry32(hashString(`${W.seed}:spawn`));
  let spawnTimer = 0;
  const aiRnd = mulberry32(hashString(`${W.seed}:ai`));

  // ------------------------------------------------------------ records
  /** Creates an enemy at (x, z); opts { nightOnly, biome } (tests / scripted spawns may pass null). */
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
      h: aiRnd() * Math.PI * 2,
      vx: 0,
      vy: 0,
      vz: 0,
      hp: def.hp,
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
      thinkAt: 0,
      wp: null,
      wpAt: 0,
      far: 0,
      returning: false,
      hist: new Float64Array(HN * 4),
      hn: 0,
      hi: 0,
    };
    record(e, W.now());
    W.enemies.set(e.id, e);
    return e;
  }

  function destroy(e) {
    W.enemies.delete(e.id);
  }

  // ------------------------------------------------------------ history (lag compensation)
  function record(e, t) {
    const k = e.hi * 4;
    e.hist[k] = t;
    e.hist[k + 1] = e.x;
    e.hist[k + 2] = e.y;
    e.hist[k + 3] = e.z;
    e.hi = (e.hi + 1) % HN;
    if (e.hn < HN) e.hn++;
  }

  /** Interpolated position at server time t (clamped to the stored history). */
  function posAt(e, t, out) {
    const H = e.hist;
    let newer = -1;
    for (let n = 0; n < e.hn; n++) {
      const i = (e.hi - 1 - n + HN) % HN;
      const ti = H[i * 4];
      if (ti <= t) {
        if (newer < 0) {
          out[0] = H[i * 4 + 1];
          out[1] = H[i * 4 + 2];
          out[2] = H[i * 4 + 3];
          return out;
        }
        const tn = H[newer * 4];
        const k = tn > ti ? (t - ti) / (tn - ti) : 0;
        out[0] = H[i * 4 + 1] + (H[newer * 4 + 1] - H[i * 4 + 1]) * k;
        out[1] = H[i * 4 + 2] + (H[newer * 4 + 2] - H[i * 4 + 2]) * k;
        out[2] = H[i * 4 + 3] + (H[newer * 4 + 3] - H[i * 4 + 3]) * k;
        return out;
      }
      newer = i;
    }
    // older than the history: the oldest sample
    if (newer >= 0) {
      out[0] = H[newer * 4 + 1];
      out[1] = H[newer * 4 + 2];
      out[2] = H[newer * 4 + 3];
    } else {
      out[0] = e.x;
      out[1] = e.y;
      out[2] = e.z;
    }
    return out;
  }

  // ------------------------------------------------------------ spawning
  const isNight = () => W.day < SPAWN.nightBelow;

  function spawnOk(def, x, z) {
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
      if (Math.hypot(p.x - x, p.z - z) < SPAWN.minPlayerDist) return false;
    }
    return true;
  }

  /** Weighted pick from a normalized spawn table, skipping types at their per-type cap (entry.max × scale). */
  const typeCount = { drone: 0, stalker: 0 };
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

  /**
   * Once per second: every eligible player (alive, on the planet, near enough to
   * the wild) whose spawn timer elapsed gets one spawn attempt on a ring around
   * it, if fewer than perPlayer × density × group scale enemies are near.
   */
  function spawnTick() {
    const now = W.now();
    for (const p of W.players.values()) {
      if (W.enemies.size >= SPAWN.maxTotal) return;
      if (p.dead || p.m === 'space') continue;
      if (hubDist(p.x, p.z) < HUB.spawnBuffer - SPAWN.maxPlayerDist) continue; // deep in the hub
      if (now < (p.spawnAt || 0)) continue;
      p.spawnAt = now + (SPAWN.interval[0] + spawnRnd() * (SPAWN.interval[1] - SPAWN.interval[0])) * 1000;
      let group = 0;
      for (const q of W.players.values()) {
        if (q.dead || q.m === 'space') continue;
        if (Math.hypot(q.x - p.x, q.z - p.z) < SPAWN.groupRange) group++;
      }
      let local = 0;
      typeCount.drone = 0;
      typeCount.stalker = 0;
      for (const e of W.enemies.values()) {
        if (Math.hypot(e.x - p.x, e.z - p.z) >= SPAWN.activeRange) continue;
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
        const table = W.world.spawnRules(x, z, W.hour);
        if (!table) continue;
        if (local >= Math.round(SPAWN.perPlayer * table.density * scale)) break;
        const entry = pickEntry(table.list, scale);
        if (!entry) break;
        const def = ENEMIES[entry.type];
        if (!def || !spawnOk(def, x, z)) continue;
        create(entry.type, x, z, { nightOnly: entry.nightOnly, biome: table.biome });
        break;
      }
    }
  }

  // ------------------------------------------------------------ AI helpers
  function nearestTarget(e, range) {
    let best = null;
    let bd = range;
    for (const p of W.players.values()) {
      if (!targetable(W, p)) continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  const losTo = (e, p) => terrainLOS(W.H, e.x, e.y + (e.def.flying ? 0 : 1.2), e.z, p.x, p.y + 1.3, p.z, 0.35);

  /** Pushes a desired velocity away from safe zones and around structures. */
  function avoid(e, dv) {
    // the safe hub: never enter (margin), steer outward across the nearest border
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
    // structures: repulsion from footprints within reach
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

  function stepDrone(e, dt, now) {
    const def = e.def;
    const p = e.target;
    const speed = def.speed;
    dv[0] = 0;
    dv[1] = 0;
    if (p) {
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const ux = dx / d;
      const uz = dz / d;
      let radial = 0;
      if (d > def.keep[1]) radial = 1;
      else if (d < def.keep[0]) radial = -0.9;
      else radial = (d - (def.keep[0] + def.keep[1]) / 2) / ((def.keep[1] - def.keep[0]) / 2) * 0.25;
      if (now > e.strafeAt) {
        e.strafe = aiRnd() < 0.5 ? -1 : 1;
        e.strafeAt = now + 2000 + aiRnd() * 2000;
      }
      const tang = e.strafe * 0.6;
      dv[0] = (ux * radial - uz * tang) * speed;
      dv[1] = (uz * radial + ux * tang) * speed;
      e.h = headingTo(e.x, e.z, p.x, p.z);
      e.st = d <= def.attack.range ? ES.ATTACK : ES.CHASE;
      // laser
      if (d <= def.attack.range && now >= e.nextAttackAt) {
        e.nextAttackAt = now + (1000 / def.attack.rate) * (0.85 + aiRnd() * 0.3);
        if (losTo(e, p)) shootLaser(e, p, d);
      }
    } else {
      patrol(e, now, 40, 0.35, dv);
    }
    avoid(e, dv);
    const k = 1 - Math.exp(-3.5 * dt);
    e.vx += (dv[0] - e.vx) * k;
    e.vz += (dv[1] - e.vz) * k;
    const hs = Math.hypot(e.vx, e.vz);
    if (hs > def.speed) {
      e.vx *= def.speed / hs;
      e.vz *= def.speed / hs;
    }
    e.x += e.vx * dt;
    e.z += e.vz * dt;
    // altitude: hover band above the ground / water / roofs, gentle bob
    e.bob += dt;
    const base = Math.max(W.H(e.x, e.z), 0, roofUnder(e.x, e.z));
    const ty = base + e.alt + Math.sin(e.bob * 0.9) * 0.8;
    e.vy = clamp((ty - e.y) * 2, -6, 6);
    e.y += e.vy * dt;
    if (!p && hs > 0.3) e.h = Math.atan2(-e.vx, -e.vz);
  }

  function shootLaser(e, p, dist) {
    const A = e.def.attack;
    const ps = Math.hypot(p.vx, p.vz);
    const acc = clamp(A.accuracy * (1 - (dist / A.range) * 0.55) - ps * 0.02, A.minAccuracy, A.accuracy);
    const hit = aiRnd() < acc;
    let tx = p.x;
    let ty = p.y + 1.2;
    let tz = p.z;
    if (!hit) {
      tx += (aiRnd() - 0.5) * 3.2;
      ty += (aiRnd() - 0.3) * 2;
      tz += (aiRnd() - 0.5) * 3.2;
    }
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dz = tz - e.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    W.emit({ near: [e.x, e.z, NET.INTEREST_RADIUS] }, { t: S.ENEMY_FIRE, id: e.id, w: A.kind, o: [r2(e.x), r2(e.y), r2(e.z)], d: [r2(dx / l), r2(dy / l), r2(dz / l)], hit, target: p.id });
    if (hit) damagePlayer(W, p, A.dmg, e.id, A.kind, [tx, ty, tz], { byType: e.type, from: [e.x, e.y, e.z] });
  }

  function stepStalker(e, dt, now) {
    const def = e.def;
    const p = e.target;
    const ground = W.H(e.x, e.z);
    // mid-leap: ballistic arc
    if (now < e.leapUntil) {
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
      if (p && Math.hypot(p.x - e.x, p.z - e.z) <= def.attack.range && Math.abs(p.y - e.y) < 2.5 && now >= e.nextAttackAt) claw(e, p, now);
      return;
    }
    const speed = def.speed;
    dv[0] = 0;
    dv[1] = 0;
    if (p) {
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      e.h = headingTo(e.x, e.z, p.x, p.z);
      if (d <= def.attack.range && Math.abs(p.y - e.y) < 2.5) {
        e.st = ES.ATTACK;
        if (now >= e.nextAttackAt) claw(e, p, now);
        dv[0] = (dx / d) * 0.5;
        dv[1] = (dz / d) * 0.5;
      } else {
        e.st = ES.CHASE;
        const L = def.leap;
        if (L && d >= L.min && d <= L.max && now >= e.leapReadyAt && Math.abs(p.y - e.y) < 4 && losTo(e, p)) {
          // leap toward where the target will be
          const lead = L.time;
          const lx = p.x + p.vx * lead * 0.5 - e.x;
          const lz = p.z + p.vz * lead * 0.5 - e.z;
          const ld = Math.hypot(lx, lz) || 1;
          const hs = Math.min(L.speed, ld / L.time);
          e.vx = (lx / ld) * hs;
          e.vz = (lz / ld) * hs;
          e.vy = 30 * L.time * 0.5 + (p.y - e.y) / L.time;
          e.leapUntil = now + L.time * 1000 + 300;
          e.leapReadyAt = now + L.cooldown * 1000;
          e.st = ES.LEAP;
          return;
        }
        dv[0] = (dx / d) * speed;
        dv[1] = (dz / d) * speed;
      }
    } else {
      patrol(e, now, 30, 0.3, dv);
    }
    avoid(e, dv);
    const k = 1 - Math.exp(-6 * dt);
    e.vx += (dv[0] - e.vx) * k;
    e.vz += (dv[1] - e.vz) * k;
    const hs = Math.hypot(e.vx, e.vz);
    if (hs > def.speed) {
      e.vx *= def.speed / hs;
      e.vz *= def.speed / hs;
    }
    let nx = e.x + e.vx * dt;
    let nz = e.z + e.vz * dt;
    // ground creatures: no water, no cliffs (climb ≤ ~55° slopes)
    const climb = (x, z) => W.H(x, z) - ground <= Math.max(0.35, Math.hypot(x - e.x, z - e.z) * 1.4);
    if (W.isWater(nx, nz) || !climb(nx, nz)) {
      // try sliding along one axis, else stop
      const ax = e.x + e.vx * dt;
      const az = e.z;
      const bx = e.x;
      const bz = e.z + e.vz * dt;
      if (!W.isWater(ax, az) && climb(ax, az)) {
        nz = az;
        nx = ax;
      } else if (!W.isWater(bx, bz) && climb(bx, bz)) {
        nx = bx;
        nz = bz;
      } else {
        nx = e.x;
        nz = e.z;
        e.vx *= 0.2;
        e.vz *= 0.2;
        e.wp = null;
      }
    }
    e.x = nx;
    e.z = nz;
    e.y = W.H(e.x, e.z);
    e.vy = 0;
    if (!p && hs > 0.3) e.h = Math.atan2(-e.vx, -e.vz);
  }

  function claw(e, p, now) {
    const A = e.def.attack;
    e.nextAttackAt = now + 1000 / A.rate;
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const l = Math.hypot(dx, dz) || 1;
    W.emit({ near: [e.x, e.z, NET.INTEREST_RADIUS] }, { t: S.ENEMY_FIRE, id: e.id, w: A.kind, o: [r2(e.x), r2(e.y + 1), r2(e.z)], d: [r2(dx / l), 0, r2(dz / l)], hit: true, target: p.id });
    damagePlayer(W, p, A.dmg, e.id, A.kind, [p.x, p.y + 1.1, p.z], { byType: e.type, from: [e.x, e.y + 1, e.z] });
  }

  function patrol(e, now, radius, frac, out) {
    if (e.returning) {
      // head straight home, fast
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

  // ------------------------------------------------------------ damage / death
  function damage(e, amount, by, kind, at, opts = {}) {
    if (e.hp <= 0 || !(amount > 0)) return;
    e.hp = Math.max(0, e.hp - amount);
    // getting shot pulls the enemy into the fight
    if (by && by.id && W.players.get(by.id) && !e.target && targetable(W, by)) e.target = by;
    e.returning = false;
    const msg = { t: S.DAMAGE, target: e.id, by: by?.id ?? null, amount: Math.round(amount * 10) / 10, hp: Math.round(e.hp), sh: 0, kind, at: [r2(at[0]), r2(at[1]), r2(at[2])] };
    if (opts.crit) msg.crit = true;
    if (opts.aoe) msg.aoe = true;
    if (e.hp <= 0) msg.kill = true;
    if (by?.id && W.players.has(by.id)) W.emit(by.id, msg);
    if (e.hp <= 0) kill(e, by, kind);
  }

  function rollLoot(def) {
    const L = def.loot || {};
    const b = {};
    const rnd = W.rng;
    if (L.res) for (const [k, [a, c]] of Object.entries(L.res)) (b.res || (b.res = {}))[k] = randInt(rnd, a, c);
    if (L.pick) {
      const keys = Object.keys(L.pick);
      const k = keys[Math.floor(rnd() * keys.length)];
      const [a, c] = L.pick[k];
      (b.res || (b.res = {}))[k] = (b.res?.[k] || 0) + randInt(rnd, a, c);
    }
    if (L.ammo) for (const [k, [a, c]] of Object.entries(L.ammo)) (b.ammo || (b.ammo = {}))[k] = randInt(rnd, a, c);
    if (L.items) {
      for (const [k, [a, c, chance = 1]] of Object.entries(L.items)) {
        if (rnd() < chance) (b.items || (b.items = {}))[k] = randInt(rnd, a, c);
      }
    }
    if (def.rare && rnd() < def.rare.chance) b.weapons = [def.rare.weapon];
    return b;
  }

  function kill(e, by, kind) {
    destroy(e);
    const ground = W.H(e.x, e.z);
    const drop = W.loot.spawn([e.x, Math.max(ground, 0) + 0.3, e.z], rollLoot(e.def), { ttl: LOOT.ttl, kind: 'drop' });
    const killer = by?.id ? W.players.get(by.id) : null;
    if (killer) killer.kills++;
    const msg = { t: S.DEATH, id: e.id, type: e.type, by: by?.id ?? null, byName: killer?.name, w: kind, at: [r2(e.x), r2(e.y), r2(e.z)] };
    if (drop) msg.drop = drop.id;
    W.emit({ near: [e.x, e.z, NET.INTEREST_RADIUS] }, msg);
  }

  function stun(e, seconds) {
    e.stunUntil = Math.max(e.stunUntil, W.now() + seconds * 1000);
  }

  // ------------------------------------------------------------ step
  function step(dt) {
    const now = W.now();
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = 1;
      spawnTick();
    }
    const night = isNight();
    for (const e of W.enemies.values()) {
      const def = e.def;
      // despawn when nobody is around (or a night-only creature at daybreak)
      let nearest = Infinity;
      for (const p of W.players.values()) {
        if (p.m === 'space') continue;
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < nearest) nearest = d;
      }
      if (nearest > SPAWN.despawnDist || (e.nightOnly && !night && !e.target)) e.far += dt;
      else e.far = 0;
      if (e.far > SPAWN.despawnAfter) {
        destroy(e);
        continue;
      }
      if (e.ai === false) {
        // frozen (tests / scripted): position set from outside, history only
        record(e, now);
        continue;
      }
      if (now < e.stunUntil) {
        e.st = ES.STUN;
        e.vx *= 0.8;
        e.vz *= 0.8;
        if (def.flying) e.y = Math.max(W.H(e.x, e.z) + 1.5, e.y - 1.2 * dt);
        record(e, now);
        continue;
      }
      // (re)think: targets with hysteresis, leash; inside a safe zone: drop everything, go home
      if (now >= e.thinkAt) {
        if (W.world.isSafe(e.x, e.z)) {
          e.target = null;
          e.returning = true;
        }
        e.thinkAt = now + THINK_MS + aiRnd() * 120;
        const t = e.target;
        if (t && (!W.players.has(t.id) || !targetable(W, t) || Math.hypot(t.x - e.x, t.z - e.z) > def.aggro * 1.6)) e.target = null;
        if (!e.target && !e.returning) {
          const c = nearestTarget(e, def.aggro);
          if (c && losTo(e, c)) e.target = c;
        }
        const dh = Math.hypot(e.x - e.home.x, e.z - e.home.z);
        if (dh > def.leash) {
          e.target = null;
          e.returning = true;
          e.wp = [e.home.x, e.home.z];
          e.wpAt = now + 30000;
        } else if (e.returning && dh < def.leash * 0.4) {
          e.returning = false;
          e.hp = def.hp; // regroup at home: full health
        }
      }
      if (def.flying) stepDrone(e, dt, now);
      else stepStalker(e, dt, now);
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
  function rowsNear(x, z, R2) {
    if (rowsTick !== W.tick || rowsSize !== W.enemies.size) {
      rowsTick = W.tick;
      rowsSize = W.enemies.size;
      rows.length = 0;
      for (const e of W.enemies.values()) {
        const row = [e.id, e.type, r2(e.x), r2(e.y), r2(e.z), r2(e.h), e.st, Math.round(e.hp)];
        if (e.target) row.push(e.target.id);
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

  return { step, create, destroy, damage, stun, posAt, rowsNear, isNight };
}
