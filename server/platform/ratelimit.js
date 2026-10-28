/**
 * Keyed token buckets for the platform API (per IP, per user, per action).
 *
 *   const rl = createLimiter({ now: () => Date.now() });
 *   const r = rl.take('auth:1.2.3.4', LIMITS.auth);   // → { ok, retryAfter (s) }
 *   rl.check(key, cfg)                                  // same without consuming
 *
 * Buckets that have refilled completely are swept every minute, so memory stays
 * proportional to recently active clients.
 */

/** Default limits: `burst` tokens, refilled at `perSec`. */
export const DEFAULT_LIMITS = {
  ip: { burst: 120, perSec: 4 }, // every /api request per IP
  auth: { burst: 10, perSec: 1 / 30 }, // login + register attempts per IP
  register: { burst: 5, perSec: 1 / 600 }, // new accounts per IP
  loginName: { burst: 8, perSec: 1 / 60 }, // failed logins per username
  write: { burst: 60, perSec: 1 }, // mutating requests per user
  create: { burst: 6, perSec: 1 / 60 }, // new experiences per user
  save: { burst: 30, perSec: 1 / 4 }, // draft saves per user
  publish: { burst: 6, perSec: 1 / 120 }, // publishes per user
  friends: { burst: 10, perSec: 1 / 30 }, // friend requests per user
  report: { burst: 6, perSec: 1 / 60 }, // reports per user / IP
  like: { burst: 30, perSec: 1 / 2 }, // like toggles per user
  play: { burst: 30, perSec: 1 / 5 }, // play pings per user / IP
};

export function createLimiter({ now = () => Date.now(), sweepMs = 60_000 } = {}) {
  /** key → { tokens, last, burst, perSec } */
  const buckets = new Map();

  function refill(b, t) {
    const dt = (t - b.last) / 1000;
    if (dt > 0) b.tokens = Math.min(b.burst, b.tokens + dt * b.perSec);
    b.last = t;
  }

  function get(key, cfg, t) {
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: cfg.burst, last: t, burst: cfg.burst, perSec: cfg.perSec };
      buckets.set(key, b);
    } else refill(b, t);
    return b;
  }

  const wait = (b, n) => Math.max(1, Math.ceil((n - b.tokens) / b.perSec));

  function take(key, cfg, n = 1) {
    const t = now();
    const b = get(key, cfg, t);
    if (b.tokens >= n) {
      b.tokens -= n;
      return { ok: true, retryAfter: 0 };
    }
    return { ok: false, retryAfter: wait(b, n) };
  }

  function check(key, cfg, n = 1) {
    const t = now();
    const b = buckets.get(key);
    if (!b) return { ok: true, retryAfter: 0 };
    refill(b, t);
    return b.tokens >= n ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: wait(b, n) };
  }

  function sweep() {
    const t = now();
    for (const [k, b] of buckets) {
      refill(b, t);
      if (b.tokens >= b.burst) buckets.delete(k);
    }
  }

  const timer = sweepMs > 0 ? setInterval(sweep, sweepMs) : null;
  timer?.unref?.();

  return {
    take,
    check,
    sweep,
    reset: (key) => (key ? buckets.delete(key) : buckets.clear()),
    get size() {
      return buckets.size;
    },
    close() {
      if (timer) clearInterval(timer);
      buckets.clear();
    },
  };
}
