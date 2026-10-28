/**
 * Test helpers for shared/sim/*.test.js (not used by the game).
 */
import { createSim } from './index.js';

export const FLAT = () => 10;

/** A sim with a controllable clock. */
export function makeSim({ H = FLAT, water = () => false, seed = 'test', world = null, t0 = 1_000_000, opts = {} } = {}) {
  const clock = { t: t0 };
  const sim = createSim({ getHeightAt: H, isWater: water, now: () => clock.t, seed, world, ...opts });
  const W = sim._w;
  const log = [];
  const k = {
    sim,
    W,
    clock,
    H,
    log,
    /** Advance time by `seconds` in fixed steps (also drains into log). */
    run(seconds, dt = 0.05) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) {
        clock.t += dt * 1000;
        sim.step(dt);
        log.push(...sim.drain());
      }
    },
    /** Advance the clock without stepping. */
    wait(ms) {
      clock.t += ms;
    },
    flush() {
      log.push(...sim.drain());
      return log;
    },
    /** Messages of type t (optionally only those addressed to `to`), from the log. */
    of(t, to) {
      k.flush();
      return log.filter((o) => o.msg.t === t && (to === undefined || o.to === to || (to !== '*' && o.to === '*'))).map((o) => o.msg);
    },
    clear() {
      sim.drain();
      log.length = 0;
    },
    /** Adds a player and puts it at (x, z) on the ground (bypassing movement validation). */
    join(id, x = 0, z = 2900, extra = {}) {
      const welcome = sim.addPlayer({ id, name: extra.name || id, appearance: null, save: extra.save || null });
      const p = W.players.get(id);
      k.put(p, x, z);
      return { p, welcome };
    },
    put(p, x, z, y = null) {
      p.x = x;
      p.z = z;
      p.y = y ?? H(x, z);
      p.expect = null;
      p.lastStateAt = clock.t;
    },
    /** Sends a client message; returns handle()'s result. */
    send(id, msg) {
      const r = sim.handle(id, msg);
      k.flush();
      return r;
    },
    lastDeny(id) {
      const d = k.of('deny', id);
      return d[d.length - 1] || null;
    },
  };
  return k;
}
