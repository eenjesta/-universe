/**
 * Local player ⇄ server:
 *  - C.STATE at NET.STATE_HZ (≈2 Hz while nothing changes): position, heading,
 *    velocity (from position deltas, works for every mode), anim (ctx.player.netAnim?.()
 *    or derived from player.state), mode (foot/swim/build/dead/car/vtol/ship/space) and the
 *    vehicle (ctx.vehicles.current: type, position, heading). A jump the speed caps can't
 *    explain (fast travel, debug teleport, back from space) carries `tp: 1`.
 *  - S.CORRECT (online server rejected the position) → snap the player back;
 *    own S.RESPAWNED / S.TRAVEL 'done' → teleport there; online WELCOME → the saved
 *    server position wins (teleport, or the resume position when not exploring yet).
 *  - World time of day: online, the snapshot `tod` is the truth. The sky keeps flowing locally at
 *    the server's rate (1 game hour = 2 min) and is re-set to the server time only when it drifted
 *    more than TIME_FIX_H (slow devices clamp the frame dt, hidden tabs stop, pauses): every
 *    setTimeOfDay re-captures the environment map, so it must stay rare. Offline the page's
 *    time is pushed into the local simulation instead (single-player behaviour unchanged).
 */
import { NET, C, r2 } from '../../shared/protocol.js';
import { wrapAngle } from './interp.js';

// customize: the creator poses the character in its own studio — the world position stays put
const WORLD_MODES = new Set(['explore', 'drive', 'title', 'space']);
const IDLE_SEND_S = 0.5;
const HOURS_PER_MS = 1 / 120 / 1000;
/** Drift (game hours) that triggers a time correction: 0.05 h ≈ 6 s of the cycle, the sun moves < 1°. */
const TIME_FIX_H = 0.05;

function hourDiff(a, b) {
  let d = (b - a) % 24;
  if (d > 12) d -= 24;
  if (d < -12) d += 24;
  return d;
}

export function createSync(ctx, net) {
  const { loop, modes } = ctx;
  const last = { x: 0, y: 0, z: 0, h: 0, a: '', m: '', veh: '', at: -1, sent: false };
  const msg = { t: C.STATE, p: [0, 0, 0], h: 0, v: [0, 0, 0], a: 'idle', m: 'foot' };
  const veh = { type: '', p: [0, 0, 0], h: 0 };
  let acc = 0;
  let idle = 0;
  let clockS = 0;
  let pendingTp = false;
  const time = { hour: null, at: 0, acc: 0 };

  function mode() {
    const name = modes.name;
    if (name === 'space') return 'space';
    if (ctx.state.data.smp?.dead) return 'dead';
    const v = name === 'drive' ? ctx.vehicles?.current : null;
    if (v?.type) return v.type === 'colony' ? 'ship' : v.type;
    const pl = ctx.player;
    if (pl?.swimming) return 'swim';
    if (ctx.build?.active) return 'build';
    return 'foot';
  }

  function anim(m) {
    const pl = ctx.player;
    try {
      const a = pl?.netAnim?.();
      if (typeof a === 'string' && a) return a;
    } catch {
      /* optional avatars hook */
    }
    if (m === 'dead') return 'dead';
    if (m === 'car' || m === 'vtol' || m === 'ship') return 'drive';
    const s = pl?.state || 'idle';
    if (m === 'build' && s === 'idle') return 'build';
    return s === 'drive' ? 'idle' : s;
  }

  // ------------------------------------------------------------ outgoing state
  function tick(dt) {
    clockS += dt;
    if (!net.ready() || !WORLD_MODES.has(modes.name)) return;
    const pl = ctx.player;
    if (!pl?.position) return;
    acc += dt;
    if (acc < 1 / NET.STATE_HZ - 1e-4) return;
    const step = acc;
    acc = 0;
    const m = mode();
    const v = m === 'car' || m === 'vtol' || m === 'ship' ? ctx.vehicles?.current : null;
    const src = v?.object?.position || pl.position;
    const x = r2(src.x);
    const y = r2(src.y);
    const z = r2(src.z);
    const h = Math.round((v ? v.heading ?? pl.heading : pl.heading) * 1000) / 1000;
    const a = anim(m);
    const vType = v?.type || '';
    const moved = Math.abs(x - last.x) + Math.abs(y - last.y) + Math.abs(z - last.z) > 0.02 || Math.abs(wrapAngle(h - last.h)) > 0.01;
    const changed = moved || a !== last.a || m !== last.m || vType !== last.veh;
    idle += step;
    if (!changed && last.sent && idle < IDLE_SEND_S) return;
    idle = 0;
    // velocity from what the server last heard (any mode, vehicles included)
    const span = last.at >= 0 ? Math.max(1 / NET.STATE_HZ, clockS - last.at) : 1 / NET.STATE_HZ;
    const dx = last.sent ? x - last.x : 0;
    const dy = last.sent ? y - last.y : 0;
    const dz = last.sent ? z - last.z : 0;
    const cap = NET.SPEED[m] ?? NET.SPEED.foot;
    const jump = last.sent && Math.hypot(dx, dz) > Math.max(20, cap * span * 1.6 + 6);
    msg.p[0] = x;
    msg.p[1] = y;
    msg.p[2] = z;
    msg.h = h;
    msg.v[0] = jump ? 0 : r2(dx / span);
    msg.v[1] = jump ? 0 : r2(dy / span);
    msg.v[2] = jump ? 0 : r2(dz / span);
    msg.a = a;
    msg.m = m;
    if (v?.object) {
      veh.type = v.type === 'colony' ? 'ship' : v.type;
      veh.p[0] = x;
      veh.p[1] = y;
      veh.p[2] = z;
      veh.h = h;
      msg.veh = veh;
    } else delete msg.veh;
    if (jump || pendingTp) msg.tp = 1;
    else delete msg.tp;
    if (!net.send(msg)) return; // dropped by the rate limiter: try again next frame
    pendingTp = false;
    last.x = x;
    last.y = y;
    last.z = z;
    last.h = h;
    last.a = a;
    last.m = m;
    last.veh = vType;
    last.at = clockS;
    last.sent = true;
  }

  /** Forget what the server heard (new session): the next state goes out at once. */
  function resetSent() {
    last.sent = false;
    last.at = -1;
    acc = 1;
  }

  // ------------------------------------------------------------ server → player
  function placePlayer(p, h, { force = false } = {}) {
    const pl = ctx.player;
    if (!pl || !Array.isArray(p)) return;
    const [x, y, z] = p;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const name = modes.name;
    if (name === 'explore' || name === 'drive' || force) {
      if (name === 'drive') {
        try {
          if (ctx.vehicles?.teleport) {
            ctx.vehicles.teleport({ x, y, z }, h);
            resetSent();
            return;
          }
          ctx.vehicles?.exit?.();
        } catch (err) {
          console.warn('[net] vehicle exit for a correction failed', err);
        }
      }
      pl.teleport({ x, z }, Number.isFinite(h) ? h : undefined);
      // the server's y wins when it is above the ground the teleport found (floors, roofs)
      if (Number.isFinite(y) && y > pl.position.y + 0.3 && y < pl.position.y + 40) {
        pl.position.y = y;
        pl.object?.position?.copy?.(pl.position);
      }
    } else {
      // not in the world yet (title / creator): explore resumes there
      ctx.state.set('player.position', { x: r2(x), y: r2(y ?? 0), z: r2(z) });
      if (Number.isFinite(h)) ctx.state.set('player.heading', h);
    }
    last.x = r2(pl.position.x);
    last.y = r2(pl.position.y);
    last.z = r2(pl.position.z);
    acc = 1; // tell the server right away
  }

  function onWelcome(w) {
    resetSent();
    if (net.mode() === 'online') onSnapTime(w?.world?.time);
    const you = w?.you;
    if (net.mode() !== 'online' || !Array.isArray(you?.p)) return;
    const pl = ctx.player;
    if (!pl?.position) return;
    const d = Math.hypot(pl.position.x - you.p[0], pl.position.z - you.p[2]);
    if (modes.name === 'explore' || modes.name === 'drive') {
      if (d > 25) placePlayer(you.p, you.h);
    } else placePlayer(you.p, you.h);
  }

  function onCorrect(m) {
    if (!Array.isArray(m?.p)) return;
    placePlayer(m.p, undefined);
  }

  function onRespawned(m) {
    if (m?.id !== net.id() || !Array.isArray(m.p)) return;
    placePlayer(m.p, m.h, { force: modes.name === 'explore' || modes.name === 'drive' });
  }

  /** S.TRAVEL: on 'done' the server already moved us — follow (Gateway / Return to hub). */
  function onTravel(m) {
    if (m?.phase !== 'done' || !Array.isArray(m.p)) return;
    placePlayer(m.p, m.h, { force: modes.name === 'explore' || modes.name === 'drive' });
  }

  /** Marks the next state as a teleport (callers that move the player on purpose). */
  function markTeleport() {
    pendingTp = true;
    acc = 1;
  }

  // ------------------------------------------------------------ world time
  function onSnapTime(tod) {
    if (!Number.isFinite(tod)) return;
    time.hour = tod;
    time.at = performance.now();
  }

  function timeTick(dt) {
    time.acc += dt;
    if (time.acc < 1) return;
    time.acc = 0;
    const world = ctx.world;
    if (!world?.setTimeOfDay || !Number.isFinite(world.timeOfDay)) return;
    if (net.mode() === 'online') {
      if (time.hour == null) return;
      const target = (time.hour + (performance.now() - time.at) * HOURS_PER_MS) % 24;
      if (Math.abs(hourDiff(world.timeOfDay, target)) > TIME_FIX_H) world.setTimeOfDay((target + 24) % 24);
    } else if (net.mode() === 'local') {
      net.local()?.syncTime?.(world.timeOfDay);
    }
  }

  loop.add('net-sync', tick, { order: 26 });
  // only while playing in the world: the title pins its own hour, space has its own scene
  loop.add('net-time', timeTick, { order: 11, pausable: false, when: () => net.ready() && modes.is('explore', 'drive') && ctx.engine?.scene === ctx.world?.scene });

  return { tick, onWelcome, onCorrect, onRespawned, onTravel, onSnapTime, markTeleport, resetSent, get lastSent() {
    return last;
  } };
}
