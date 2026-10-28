/**
 * Travel (PLATFORM.md §11.2 "Spreading players out"), C.TRAVEL {to, cid?}:
 *   'hub'     "Return to hub" from anywhere outside the safe zone: 10 s channel
 *             (S.TRAVEL {phase: 'channel', at}), refused in combat (8 s after the
 *             last shot / hit taken) and during the 2 min cooldown; cancelled by
 *             damage, firing, moving > 4 m, death or {to: 'cancel'} (S.TRAVEL
 *             {phase: 'cancel', reason}); then the server moves the player to the
 *             Overlook (S.TRAVEL {phase: 'done', p, h}).
 *   'wild'    the hub Gateway: a random safe spot 2–8 km from the centre (dry,
 *             not steep, beyond the no-build buffer, outside claims, no enemies near).
 *   'base'    the hub Gateway: next to your claim beacon.
 *   'beacon'  the hub Gateway: your spawn beacon.
 * Gateway destinations are instant and only offered inside the hub (safe zone).
 * The movement validator accepts the new position (placePlayer → expect window).
 */
import { S } from '../protocol.js';
import { TRAVEL_RULES, HUB, hubDist } from '../defs/world.js';
import { RESPAWN_POINTS } from './zones.js';
import { safeSpot, placePlayer } from './players.js';
import { mulberry32, hashString } from './rng.js';
import { r2 } from './util.js';

export function createTravel(W) {
  const rnd = mulberry32(hashString(`${W.seed}:travel`));

  function arrive(p, to, spot, h, cid) {
    placePlayer(W, p, spot, h);
    p.m = 'foot';
    p.a = 'idle';
    p.lastTpAt = W.now();
    const m = { t: S.TRAVEL, phase: 'done', to, p: [r2(p.x), r2(p.y), r2(p.z)], h: r2(p.h) };
    if (cid !== undefined) m.cid = cid;
    W.emit(p.id, m);
  }

  function cancel(p, reason) {
    const tr = p.travel;
    if (!tr) return;
    p.travel = null;
    const m = { t: S.TRAVEL, phase: 'cancel', to: tr.to, reason };
    if (tr.cid !== undefined) m.cid = tr.cid;
    W.emit(p.id, m);
  }

  /** A random safe wilderness spot (null when none was found). */
  function wildSpot() {
    for (let i = 0; i < 48; i++) {
      const a = rnd() * Math.PI * 2;
      const r = TRAVEL_RULES.wildMin + rnd() * (TRAVEL_RULES.wildMax - TRAVEL_RULES.wildMin);
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      if (hubDist(x, z) < HUB.noBuild + 100 || W.world.isSafe(x, z)) continue;
      if (W.isWater(x, z)) continue;
      const y = W.H(x, z);
      if (!(y > 0.5)) continue;
      const s = Math.max(Math.abs(W.H(x + 1, z) - W.H(x - 1, z)), Math.abs(W.H(x, z + 1) - W.H(x, z - 1))) / 2;
      if (s > 0.6) continue;
      if (W.build.claimAt(x, z)) continue;
      let hostile = false;
      for (const e of W.enemies.values()) {
        if (Math.hypot(e.x - x, e.z - z) < 90) {
          hostile = true;
          break;
        }
      }
      if (hostile) continue;
      return { x, y: y + 0.05, z };
    }
    return null;
  }

  function handle(p, msg) {
    const to = String(msg.to || '');
    if (to === 'cancel') {
      if (p.travel) cancel(p, 'player');
      return true;
    }
    if (p.dead) return W.deny(p, msg, 'dead');
    if (p.m === 'space') return W.deny(p, msg, 'invalid');
    const now = W.now();
    if (to === 'hub') {
      if (W.world.isSafe(p.x, p.z)) return W.deny(p, msg, 'here');
      if (p.travel) return W.deny(p, msg, 'busy');
      const lock = p.combatAt + TRAVEL_RULES.combatLock * 1000;
      if (now < lock) return W.deny(p, msg, 'combat', { wait: Math.ceil((lock - now) / 1000) });
      if (now < p.hubReadyAt) return W.deny(p, msg, 'cooldown', { wait: Math.ceil((p.hubReadyAt - now) / 1000) });
      p.travel = { to, until: now + TRAVEL_RULES.hubChannel * 1000, x: p.x, z: p.z, cid: msg.cid };
      const m = { t: S.TRAVEL, phase: 'channel', to, at: p.travel.until, secs: TRAVEL_RULES.hubChannel };
      if (msg.cid !== undefined) m.cid = msg.cid;
      W.emit(p.id, m);
      return true;
    }
    if (to !== 'wild' && to !== 'base' && to !== 'beacon') return W.deny(p, msg, 'invalid');
    if (!W.world.isSafe(p.x, p.z)) return W.deny(p, msg, 'gateway');
    if (p.travel) cancel(p, 'player');
    let spot = null;
    let h;
    if (to === 'base') {
      const c = p.claimId && W.claims.get(p.claimId);
      if (!c) return W.deny(p, msg, 'noBase');
      spot = safeSpot(W, c.p[0] + 3, c.p[1] + 3);
    } else if (to === 'beacon') {
      const s = p.spawnId && W.structures.get(p.spawnId);
      if (!s) return W.deny(p, msg, 'noBeacon');
      spot = { x: s.x + 1.6, y: Math.max(s.y + 0.1, W.H(s.x + 1.6, s.z + 1.6) + 0.05), z: s.z + 1.6 };
    } else {
      spot = wildSpot();
      if (!spot) return W.deny(p, msg, 'noSpot');
      h = rnd() * Math.PI * 2;
    }
    arrive(p, to, spot, h, msg.cid);
    return true;
  }

  /** Completes "Return to hub" channels. */
  function step() {
    const now = W.now();
    for (const p of W.players.values()) {
      const tr = p.travel;
      if (!tr || now < tr.until) continue;
      p.travel = null;
      if (p.dead) continue;
      const P = RESPAWN_POINTS.spawn;
      const spot = safeSpot(W, P.x + (rnd() - 0.5) * 8, P.z + (rnd() - 0.5) * 8);
      p.hubReadyAt = now + TRAVEL_RULES.hubCooldown * 1000;
      arrive(p, 'hub', spot, P.h, tr.cid);
    }
  }

  return { handle, step, cancel, wildSpot };
}
