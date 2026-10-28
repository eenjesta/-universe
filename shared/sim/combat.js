/**
 * Player combat (PvE): C.FIRE (rate of fire, magazine, reload state), C.HIT
 * validation with lag compensation, C.THROW grenades (server projectile:
 * arc, terrain bounces, fuse, AoE falloff, stun), C.RELOAD, C.EQUIP.
 *
 * Lag compensation: each FIRE records the shot with a rewind time tView —
 * the server time of the world the client was looking at:
 *   msg.vt (client's ctx.net.serverTime() − NET.INTERP_DELAY_MS) when sent, else
 *   ct + clock offset (host-reported via sim.setClock, or a min-filtered
 *   estimate of now − ct) − NET.INTERP_DELAY_MS;
 * clamped to [now − NET.LAG_COMP_MS, now]. A HIT {seq, target, at} is accepted
 * when the shot ray passes the target's hit shape (sphere / capsule + tolerance)
 * at one of several rewound positions around tView (enemy position history),
 * `at` lies on the target, within range, inside the spread cone, and the terrain
 * does not block origin → at.
 */
import { NET, S } from '../protocol.js';
import { WEAPONS, WEAPON_SLOTS, PROJECTILES } from '../defs/weapons.js';
import { hasSlot, hasWeapon } from './inventory.js';
import { terrainLOS } from './los.js';
import { isNum, isVec3, r2, clamp, raySegDist, DEG } from './util.js';
import { WORLD_LIMIT } from '../defs/world.js';

const SHOTS = 24; // remembered shots per player (HIT must reference one)
const SHOT_TTL = 1500; // ms a HIT claim may arrive after its FIRE
const BURST = { 'pulse-pistol': 2, 'plasma-rifle': 3, railgun: 1.25, 'shock-grenade': 1.5 };
const RATE_TOL = 1.15;
const SAMPLE_OFFSETS = [0, -80, 80, -160, 160];
const GRAV = PROJECTILES.grenade.gravity;
const ORIGIN_MAX = 8; // m: muzzle or third-person camera position

export function createCombat(W) {
  const tmp = { dist: 0, t: 0 };
  const pos = [0, 0, 0];

  function state(p) {
    if (!p.fire) {
      const shots = [];
      for (let i = 0; i < SHOTS; i++) shots.push({ seq: -1, w: '', ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, tView: 0, at: -1e12, used: false });
      p.fire = { tokens: {}, last: {}, shots, idx: 0 };
    }
    return p.fire;
  }

  function useToken(p, w, rate) {
    const f = state(p);
    const now = W.now();
    const cap = BURST[w] || 2;
    const last = f.last[w];
    let tok = f.tokens[w];
    if (last === undefined) tok = cap;
    else tok = Math.min(cap, tok + ((now - last) / 1000) * rate * RATE_TOL);
    f.last[w] = now;
    if (tok < 1) {
      f.tokens[w] = tok;
      return false;
    }
    f.tokens[w] = tok - 1;
    return true;
  }

  const canFight = (p) => p.m === 'foot';

  function viewTime(p, msg, now) {
    let tv;
    if (isNum(msg.vt)) tv = msg.vt;
    else if (isNum(msg.ct)) {
      if (isNum(p.ofsHost)) tv = msg.ct + p.ofsHost - NET.INTERP_DELAY_MS;
      else {
        const sample = now - msg.ct;
        p.ofs = p.ofs == null ? sample : Math.min(sample, p.ofs + 1);
        tv = msg.ct + p.ofs - NET.INTERP_DELAY_MS;
      }
    } else tv = now - NET.INTERP_DELAY_MS - 50;
    return clamp(tv, now - NET.LAG_COMP_MS, now);
  }

  /**
   * Validated shot origin: the claimed one (muzzle, or the third-person camera) when
   * within ORIGIN_MAX of the player's chest, else the server's chest point.
   */
  function origin(p, o) {
    const cx = p.x;
    const cy = p.y + 1.45;
    const cz = p.z;
    if (isVec3(o) && Math.hypot(o[0] - cx, o[1] - cy, o[2] - cz) < ORIGIN_MAX + Math.hypot(p.vx, p.vz) * 0.25) return o;
    return [cx, cy, cz];
  }

  // ------------------------------------------------------------ FIRE
  function fire(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    const def = WEAPONS[msg.w];
    if (!def || def.kind !== 'hitscan') return W.deny(p, msg, 'invalid');
    if (!hasWeapon(p.inv, def.id)) return W.deny(p, msg, 'noWeapon');
    if (!canFight(p)) return W.deny(p, msg, 'invalid');
    if (W.world.isSafe(p.x, p.z)) return W.deny(p, msg, 'safe');
    if (p.reload) {
      if (p.reload.w === def.id) return W.deny(p, msg, 'reloading', { w: def.id });
      p.reload = null; // switching weapons cancels a reload
    }
    if (p.inv.slot !== def.slot) {
      p.inv.slot = def.slot;
      p.dirty.add('slot');
    }
    const mag = p.inv.mag[def.id] || 0;
    if (mag <= 0) return W.deny(p, msg, 'empty', { w: def.id, mag: 0, ammo: p.inv.ammo[def.ammo] || 0 });
    if (!useToken(p, def.id, def.rate)) return W.deny(p, msg, 'rate', { w: def.id });
    if (!isVec3(msg.d)) return W.deny(p, msg, 'invalid');
    let [dx, dy, dz] = msg.d;
    const dl = Math.hypot(dx, dy, dz);
    if (!(dl > 1e-6)) return W.deny(p, msg, 'invalid');
    dx /= dl;
    dy /= dl;
    dz /= dl;
    p.inv.mag[def.id] = mag - 1;
    const now = W.now();
    p.combatAt = now;
    if (p.travel) W.travel.cancel(p, 'combat');
    const o = origin(p, msg.o);
    const f = state(p);
    const s = f.shots[f.idx];
    f.idx = (f.idx + 1) % SHOTS;
    s.seq = isNum(msg.seq) ? msg.seq : -1;
    s.w = def.id;
    s.ox = o[0];
    s.oy = o[1];
    s.oz = o[2];
    s.dx = dx;
    s.dy = dy;
    s.dz = dz;
    s.tView = viewTime(p, msg, now);
    s.at = now;
    s.used = false;
    W.emit({ near: [p.x, p.z, NET.INTEREST_RADIUS] }, { t: S.FIRED, id: p.id, w: def.id, o: [r2(o[0]), r2(o[1]), r2(o[2])], d: [Math.round(dx * 1000) / 1000, Math.round(dy * 1000) / 1000, Math.round(dz * 1000) / 1000] });
    return true;
  }

  // ------------------------------------------------------------ HIT
  function findShot(p, seq) {
    const f = p.fire;
    if (!f) return null;
    for (const s of f.shots) if (s.seq === seq && s.seq !== -1) return s;
    return null;
  }

  function hit(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    const s = findShot(p, msg.seq);
    const now = W.now();
    if (!s || s.used || now - s.at > SHOT_TTL) return W.deny(p, msg, 'invalid');
    const e = W.enemies.get(msg.target);
    if (!e || e.hp <= 0) return W.deny(p, msg, 'gone');
    if (!isVec3(msg.at)) return W.deny(p, msg, 'invalid');
    const def = WEAPONS[s.w];
    const [ax, ay, az] = msg.at;
    const vx = ax - s.ox;
    const vy = ay - s.oy;
    const vz = az - s.oz;
    const dist = Math.hypot(vx, vy, vz);
    if (dist > def.range + 2) return W.deny(p, msg, 'far');
    // inside the spread cone (+ tolerance)
    const along = vx * s.dx + vy * s.dy + vz * s.dz;
    if (along <= 0) return W.deny(p, msg, 'invalid');
    const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
    const cone = Math.tan((def.spread + 2.5) * DEG) * dist + 0.75;
    if (perp > cone) return W.deny(p, msg, 'invalid');
    // rewound target shape vs the ray and the claimed point
    const hs = e.def.hit;
    const tol = 0.55 + dist * 0.004;
    let ok = false;
    let footY = e.y;
    for (const off of SAMPLE_OFFSETS) {
      W.enemiesSys.posAt(e, s.tView + off, pos);
      let rayD;
      let pointD;
      if (hs.shape === 'sphere') {
        const cy = pos[1] + (hs.y || 0);
        // ray (shot dir) → sphere centre
        const wx = pos[0] - s.ox;
        const wy = cy - s.oy;
        const wz = pos[2] - s.oz;
        const tt = clamp(wx * s.dx + wy * s.dy + wz * s.dz, 0, def.range);
        rayD = Math.hypot(wx - s.dx * tt, wy - s.dy * tt, wz - s.dz * tt) - hs.r;
        pointD = Math.hypot(ax - pos[0], ay - cy, az - pos[2]) - hs.r;
      } else {
        const r = hs.r;
        raySegDist(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, def.range, pos[0], pos[1] + r * 0.5, pos[2], pos[0], pos[1] + hs.h - r * 0.5, pos[2], tmp);
        rayD = tmp.dist - r;
        const py = clamp(ay, pos[1] + r * 0.5, pos[1] + hs.h - r * 0.5);
        pointD = Math.hypot(ax - pos[0], ay - py, az - pos[2]) - r;
      }
      if (rayD <= tol + 0.3 && pointD <= tol + 0.8) {
        ok = true;
        footY = pos[1];
        break;
      }
    }
    if (!ok) return W.deny(p, msg, 'miss');
    if (!terrainLOS(W.H, s.ox, s.oy, s.oz, ax, ay, az, 0.4)) return W.deny(p, msg, 'blocked');
    s.used = true;
    let dmg = def.dmg;
    if (dist > def.falloffStart) dmg *= 1 - (1 - def.falloff) * clamp((dist - def.falloffStart) / Math.max(1, def.range - def.falloffStart), 0, 1);
    const crit = hs.shape === 'capsule' && ay - footY > hs.h * 0.72;
    if (crit) dmg *= def.crit || 1;
    dmg = Math.round(dmg * 10) / 10;
    W.enemiesSys.damage(e, dmg, p, s.w, [ax, ay, az], { crit });
    return true;
  }

  // ------------------------------------------------------------ THROW
  function throwGrenade(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    const def = WEAPONS[msg.w || 'shock-grenade'];
    if (!def || def.kind !== 'throw') return W.deny(p, msg, 'invalid');
    if ((p.inv.items[def.item] || 0) <= 0) return W.deny(p, msg, 'noItem');
    if (!canFight(p)) return W.deny(p, msg, 'invalid');
    if (W.world.isSafe(p.x, p.z)) return W.deny(p, msg, 'safe');
    if (!useToken(p, def.id, def.rate)) return W.deny(p, msg, 'rate');
    if (!isVec3(msg.v)) return W.deny(p, msg, 'invalid');
    let [vx, vy, vz] = msg.v;
    const sp = Math.hypot(vx, vy, vz);
    if (!(sp > 0.1)) return W.deny(p, msg, 'invalid');
    const max = def.throwSpeed;
    if (sp > max) {
      vx *= max / sp;
      vy *= max / sp;
      vz *= max / sp;
    }
    const o = origin(p, msg.o);
    p.combatAt = W.now();
    if (p.travel) W.travel.cancel(p, 'combat');
    p.inv.items[def.item]--;
    p.dirty.add('items');
    if (p.inv.items[def.item] <= 0 && p.inv.slot === def.slot) {
      p.inv.slot = 0;
      p.dirty.add('slot');
    }
    const g = { id: W.nid('x'), type: 'grenade', owner: p.id, x: o[0], y: o[1], z: o[2], vx, vy, vz, fuseAt: W.now() + def.fuse * 1000, def, rest: false };
    W.projectiles.set(g.id, g);
    W.emit({ near: [p.x, p.z, NET.INTEREST_RADIUS] }, { t: S.FIRED, id: p.id, w: def.id, o: [r2(o[0]), r2(o[1]), r2(o[2])], v: [r2(vx), r2(vy), r2(vz)], px: g.id, fuse: def.fuse });
    W.flushInv(p);
    return true;
  }

  function stepGrenade(g, dt) {
    const P = PROJECTILES.grenade;
    if (!g.rest) {
      g.vy -= GRAV * dt;
      // sub-steps keep fast grenades from tunnelling into slopes
      const n = Math.max(1, Math.ceil((Math.hypot(g.vx, g.vy, g.vz) * dt) / 1.5));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        g.x += g.vx * h;
        g.y += g.vy * h;
        g.z += g.vz * h;
        const ground = W.H(g.x, g.z) + P.radius;
        if (g.y < ground) {
          g.y = ground;
          // bounce along the terrain normal (central differences)
          const nx = W.H(g.x - 1, g.z) - W.H(g.x + 1, g.z);
          const nz = W.H(g.x, g.z - 1) - W.H(g.x, g.z + 1);
          const ny = 2;
          const nl = Math.hypot(nx, ny, nz);
          const ux = nx / nl;
          const uy = ny / nl;
          const uz = nz / nl;
          const vn = g.vx * ux + g.vy * uy + g.vz * uz;
          if (vn < 0) {
            g.vx -= (1 + P.bounce) * vn * ux;
            g.vy -= (1 + P.bounce) * vn * uy;
            g.vz -= (1 + P.bounce) * vn * uz;
            g.vx *= P.friction;
            g.vz *= P.friction;
          }
          if (Math.hypot(g.vx, g.vy, g.vz) < 1.2) {
            g.rest = true;
            g.vx = g.vy = g.vz = 0;
            break;
          }
        }
        if (W.isWater(g.x, g.z) && g.y < 0) {
          g.vx *= 0.5;
          g.vz *= 0.5;
          g.vy = Math.max(g.vy, -2);
        }
      }
      if (Math.abs(g.x) > WORLD_LIMIT || Math.abs(g.z) > WORLD_LIMIT || g.y < -200) g.fuseAt = 0;
    }
    if (W.now() >= g.fuseAt) explode(g);
  }

  function explode(g) {
    W.projectiles.delete(g.id);
    const def = g.def;
    const at = [r2(g.x), r2(g.y), r2(g.z)];
    W.emit({ near: [g.x, g.z, NET.INTEREST_RADIUS] }, { t: S.EXPLODE, at, r: def.radius, kind: 'shock', id: g.id, by: g.owner });
    const owner = W.players.get(g.owner) || { id: g.owner, name: '', x: g.x, z: g.z, kills: 0 };
    for (const e of [...W.enemies.values()]) {
      const cy = e.y + (e.def.flying ? 0 : 0.8);
      const d = Math.hypot(e.x - g.x, cy - g.y, e.z - g.z);
      if (d > def.radius) continue;
      if (!terrainLOS(W.H, g.x, g.y + 0.4, g.z, e.x, cy, e.z, 0.6)) continue;
      const k = d / def.radius;
      const dmg = Math.round(def.dmg * (1 - (1 - def.edge) * k) * 10) / 10;
      W.enemiesSys.stun(e, def.stun);
      W.enemiesSys.damage(e, dmg, owner, def.id, [e.x, cy, e.z], { aoe: true });
    }
  }

  // ------------------------------------------------------------ RELOAD / EQUIP
  function reload(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    const def = WEAPONS[msg.w || WEAPON_SLOTS[p.inv.slot]];
    if (!def || def.kind !== 'hitscan') return W.deny(p, msg, 'invalid');
    if (!p.inv.weapons.includes(def.id)) return W.deny(p, msg, 'noWeapon');
    if (p.reload) return W.deny(p, msg, 'reloading', { w: p.reload.w });
    const mag = p.inv.mag[def.id] || 0;
    if (mag >= def.mag) return W.deny(p, msg, 'full', { w: def.id });
    if ((p.inv.ammo[def.ammo] || 0) <= 0) return W.deny(p, msg, 'empty', { w: def.id, mag, ammo: 0 });
    p.reload = { w: def.id, until: W.now() + def.reload * 1000 };
    return true;
  }

  function finishReload(p) {
    const def = WEAPONS[p.reload.w];
    p.reload = null;
    if (!def) return;
    const mag = p.inv.mag[def.id] || 0;
    const n = Math.min(def.mag - mag, p.inv.ammo[def.ammo] || 0);
    if (n <= 0) return;
    p.inv.mag[def.id] = mag + n;
    p.inv.ammo[def.ammo] -= n;
    p.dirty.add('mag');
    p.dirty.add('ammo');
  }

  function equip(p, msg) {
    if (p.dead) return W.deny(p, msg, 'dead');
    let slot = isNum(msg.slot) ? Math.round(msg.slot) : WEAPONS[msg.w]?.slot;
    if (!isNum(slot) || slot < 0 || slot > 3) return W.deny(p, msg, 'invalid');
    if (!hasSlot(p.inv, slot)) return W.deny(p, msg, 'noWeapon', { slot });
    if (p.reload && WEAPONS[p.reload.w]?.slot !== slot) p.reload = null;
    if (p.inv.slot !== slot) {
      p.inv.slot = slot;
      p.dirty.add('slot');
    }
    return true;
  }

  // ------------------------------------------------------------ step / rows
  function step(dt) {
    const now = W.now();
    for (const p of W.players.values()) if (p.reload && now >= p.reload.until) finishReload(p);
    for (const g of [...W.projectiles.values()]) stepGrenade(g, dt);
  }

  function rowsNear(x, z, R2) {
    const out = [];
    for (const g of W.projectiles.values()) {
      const dx = g.x - x;
      const dz = g.z - z;
      if (dx * dx + dz * dz <= R2) out.push([g.id, g.type, r2(g.x), r2(g.y), r2(g.z)]);
    }
    return out;
  }

  function forget(p) {
    p.reload = null;
  }

  return { fire, hit, throwGrenade, reload, equip, step, rowsNear, forget };
}
