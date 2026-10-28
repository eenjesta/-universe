/**
 * Token bucket: `burst` tokens, refilled at `perSec`. `take()` → true when a
 * token was available. Time comes from the caller (ms) so tests can drive it.
 */
export class TokenBucket {
  constructor({ burst, perSec }, now = Date.now()) {
    this.burst = burst;
    this.perSec = perSec;
    this.tokens = burst;
    this.last = now;
  }
  take(now = Date.now(), n = 1) {
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0) this.tokens = Math.min(this.burst, this.tokens + dt * this.perSec);
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}
