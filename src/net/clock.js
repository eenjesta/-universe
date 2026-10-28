/**
 * Server clock estimation from ping/pong (C.PING {ct} → S.PONG {ct, st}).
 * Pure logic (no DOM): `now` is the local monotonic clock in ms (performance.now()).
 *
 *   const clock = new ClockSync();
 *   clock.sample(pong.ct, pong.st, performance.now());
 *   clock.serverTime(performance.now())   // ≈ the server's `now()` at this instant
 *
 * The offset follows the lowest-RTT sample of the last few pongs (least queueing
 * delay → most accurate), smoothed so interpolation never sees big jumps; a
 * difference above SNAP_MS (server restart, sleep) snaps immediately.
 */
const KEEP = 8;
const SNAP_MS = 250;

export class ClockSync {
  constructor() {
    this.offset = 0; // serverTime − localTime (ms)
    this.rtt = 0; // smoothed round trip (ms)
    this.lastRtt = 0;
    this.synced = false;
    this._rtts = new Float64Array(KEEP);
    this._offs = new Float64Array(KEEP);
    this._n = 0;
    this._i = 0;
  }

  reset() {
    this.offset = 0;
    this.rtt = 0;
    this.lastRtt = 0;
    this.synced = false;
    this._n = 0;
    this._i = 0;
  }

  /** One pong: ct = local send time, st = server time when it replied, now = local receive time. */
  sample(ct, st, now) {
    if (!Number.isFinite(ct) || !Number.isFinite(st) || !Number.isFinite(now)) return;
    const rtt = Math.max(0, now - ct);
    const off = st + rtt / 2 - now;
    this._rtts[this._i] = rtt;
    this._offs[this._i] = off;
    this._i = (this._i + 1) % KEEP;
    if (this._n < KEEP) this._n++;
    let best = 0;
    for (let k = 1; k < this._n; k++) if (this._rtts[k] < this._rtts[best]) best = k;
    const target = this._offs[best];
    this.lastRtt = rtt;
    this.rtt = this.synced ? this.rtt * 0.75 + rtt * 0.25 : rtt;
    if (!this.synced || Math.abs(target - this.offset) > SNAP_MS) this.offset = target;
    else this.offset += (target - this.offset) * 0.25;
    this.synced = true;
  }

  /** Rough first estimate from a snapshot's server time (before the first pong). */
  hint(st, now) {
    if (this.synced || !Number.isFinite(st)) return;
    this.offset = st - now;
  }

  serverTime(now) {
    return now + this.offset;
  }
}
