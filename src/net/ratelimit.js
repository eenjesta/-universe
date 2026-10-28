/**
 * Token bucket mirroring the server's per-connection limits (NET.MSG_RATE,
 * NET.CHAT_RATE) so the client never gets itself kicked: `take()` returns false
 * when the message should be dropped (state updates) or refused (chat).
 * Pure logic; `now` in ms.
 */
export class TokenBucket {
  constructor(burst, perSec, now = 0) {
    this.burst = burst;
    this.perSec = perSec;
    this.tokens = burst;
    this.last = now;
  }

  refill(now) {
    const dt = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.perSec);
  }

  /** Spends n tokens if available. `reserve` keeps that many tokens for more important messages. */
  take(now, n = 1, reserve = 0) {
    this.refill(now);
    if (this.tokens - n < reserve) return false;
    this.tokens -= n;
    return true;
  }

  available(now) {
    this.refill(now);
    return this.tokens;
  }
}
