/**
 * Character actions (characters module): timing of the work / survival one-shots
 * shared by the 3P animator, the first-person view model, remote avatars and the
 * gathering slice. Pure data + maths (no three.js, no DOM) — node-testable.
 *
 *   actionTiming('chop', 'plasma-axe') → { dur, impact, move, tool }
 *     dur     seconds of the whole action (wind-up → impact → recovery)
 *     impact  seconds from the start to the impact frame ('action:impact' fires here)
 *     move    walk-speed factor while the action plays (0..1)
 *   toolKind('plasma-axe') → 'axe'     (grip / animation family of a tool id)
 *   kf(keys, t, out)  keyframe sampler for pose tracks (see below)
 */

/** Base timing per action (tier-1 tools / bare hands). */
export const ACTIONS = {
  chop: { dur: 0.9, impact: 0.45, move: 0.55 },
  mine: { dur: 1.0, impact: 0.52, move: 0.5 },
  gather: { dur: 0.8, impact: 0.38, move: 0.55 },
  eat: { dur: 1.2, impact: 0.62, move: 0.75 },
  use: { dur: 0.6, impact: 0.28, move: 0.85 },
  build: { dur: 0.5, impact: 0.2, move: 0.9 },
};
export const TOOL_ACTIONS = Object.keys(ACTIONS);

/** Tool id → animation family ('axe' one-handed swing, 'pick' two-handed overhead, 'laser' held beam device). */
export const TOOL_KIND = {
  axe: 'axe',
  'plasma-axe': 'axe',
  hatchet: 'axe',
  pickaxe: 'pick',
  pick: 'pick',
  'mining-laser': 'laser',
  laser: 'laser',
  hammer: 'axe',
};

/** Per-tool timing overrides: tier-2 tools swing faster, the mining laser fires its beam almost at once. */
const TOOL_TIMING = {
  'plasma-axe': { chop: { dur: 0.74, impact: 0.37 } }, // same impact ratio as the pose keys (0.5)
  'mining-laser': { mine: { dur: 0.7, impact: 0.14, move: 0.7 } },
  laser: { mine: { dur: 0.7, impact: 0.14, move: 0.7 } },
};

/** Default tool shown for an action when only the anim state is known (remote players). */
export const DEFAULT_TOOL = { chop: 'axe', mine: 'pickaxe' };

/** Animation family of a tool id (unknown ids: by name, else 'axe'). */
export function toolKind(id) {
  if (!id) return null;
  const k = TOOL_KIND[id];
  if (k) return k;
  const s = String(id);
  if (s.includes('laser')) return 'laser';
  if (s.includes('pick')) return 'pick';
  return 'axe';
}

/** Timing of `action` with `tool` (id or null) → { dur, impact, move, tool } (unknown actions → null). */
export function actionTiming(action, tool = null) {
  const base = ACTIONS[action];
  if (!base) return null;
  const o = (tool && TOOL_TIMING[tool]?.[action]) || null;
  const dur = o?.dur ?? base.dur;
  const impact = Math.min(o?.impact ?? base.impact, dur * 0.95);
  return { dur, impact, move: o?.move ?? base.move, tool: tool || null };
}

/** Which actions want a tool in the hands (the others are bare-handed gestures). */
export function usesTool(action) {
  return action === 'chop' || action === 'mine';
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Easings: 'io' smooth in-out (default), 'in' accelerate (strikes), 'out' decelerate, 'lin'. */
export function ease(kind, x) {
  x = clamp01(x);
  switch (kind) {
    case 'in':
      return x * x * x;
    case 'out': {
      const y = 1 - x;
      return 1 - y * y * y;
    }
    case 'lin':
      return x;
    default:
      return x * x * (3 - 2 * x);
  }
}

/**
 * Keyframe track sampler. `keys` = [[t, ease, v0, v1, …], …] sorted by t in [0, 1]; the ease of a key
 * shapes the segment that ENDS at it. Writes the interpolated values into `out` (array) and returns it.
 * Before the first key / after the last the end values hold.
 */
export function kf(keys, t, out) {
  const n = keys.length;
  const w = keys[0].length - 2;
  if (t <= keys[0][0]) {
    for (let i = 0; i < w; i++) out[i] = keys[0][i + 2];
    return out;
  }
  for (let k = 1; k < n; k++) {
    const b = keys[k];
    if (t <= b[0]) {
      const a = keys[k - 1];
      const span = b[0] - a[0];
      const f = span > 1e-6 ? ease(b[1], (t - a[0]) / span) : 1;
      for (let i = 0; i < w; i++) out[i] = a[i + 2] + (b[i + 2] - a[i + 2]) * f;
      return out;
    }
  }
  const z = keys[n - 1];
  for (let i = 0; i < w; i++) out[i] = z[i + 2];
  return out;
}

/** 0 → 1 → 0 envelope over x ∈ [0, 1] with attack a and release r fractions (smooth). */
export function envelope(x, a, r) {
  if (x <= 0 || x >= 1) return 0;
  if (x < a) return ease('io', x / a);
  if (x > 1 - r) return 1 - ease('io', (x - (1 - r)) / r);
  return 1;
}

/**
 * Tracks one running action: start(name, timing) → then tick(dt) each frame; `impact` turns true on the
 * single frame the impact time is crossed (fire 'action:impact' then). Plain object, no allocation per tick.
 */
export class ActionClock {
  constructor() {
    this.name = null;
    this.tool = null;
    this.t = 0;
    this.dur = 0;
    this.impactAt = 0;
    this.impact = false; // true only on the frame the impact time was crossed
    this.done = true;
    this.move = 1;
    this.count = 0; // actions started (for chained swings)
  }

  start(name, timing, speed = 1) {
    const s = speed > 0.05 ? speed : 1;
    this.name = name;
    this.tool = timing.tool || null;
    this.t = 0;
    this.dur = timing.dur / s;
    this.impactAt = timing.impact / s;
    this.move = timing.move ?? 1;
    this.impact = false;
    this.done = false;
    this.count++;
    return this.dur;
  }

  /** Advances; returns true while running. */
  tick(dt) {
    this.impact = false;
    if (this.done) return false;
    const t0 = this.t;
    this.t += dt;
    if (t0 < this.impactAt && this.t >= this.impactAt) this.impact = true;
    if (this.t >= this.dur) {
      this.t = this.dur;
      this.done = true;
    }
    return true;
  }

  cancel() {
    this.done = true;
    this.impact = false;
    this.name = null;
  }

  /** Progress 0..1 (1 when idle). */
  get x() {
    return this.done || this.dur <= 0 ? 1 : this.t / this.dur;
  }

  get running() {
    return !this.done;
  }

  /** Past the impact (the recovery may be interrupted by the next swing). */
  get recovering() {
    return !this.done && this.t >= this.impactAt;
  }
}
