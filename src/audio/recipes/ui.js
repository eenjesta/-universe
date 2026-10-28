/**
 * Interface sounds (bus 'ui'): soft, glassy and short — never harsh.
 * ui.click · ui.hover · ui.open · ui.close · ui.error · toast · chat ·
 * dialogue.open · interact
 *
 * Recipe spec: { fn(g, opts), bus, limit, gap, priority } — `g` is a Graph whose
 * `out` is the core's per-sound gain; `opts.pitch` scales pitch, `opts.variant`
 * picks a flavour where noted.
 */
import { num, rand } from '../lib/dsp.js';
import { bell, tone, burst, whoosh } from '../lib/voices.js';

export const UI_RECIPES = {
  'ui.click': {
    bus: 'ui',
    limit: 3,
    gap: 0.035,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.97, 1.03);
      tone(g, g.out, t, 1720 * p, { f1: 1080 * p, sweepDur: 0.035, peak: 0.17, a: 0.0015, d: 0.07 });
      tone(g, g.out, t, 3440 * p, { peak: 0.05, a: 0.001, d: 0.03 });
      burst(g, g.out, t, { f: 4600, Q: 1.4, peak: 0.08, a: 0.001, d: 0.016 });
      g.finish();
    },
  },

  'ui.hover': {
    bus: 'ui',
    limit: 2,
    gap: 0.05,
    priority: 0,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      tone(g, g.out, t, 2480 * p, { peak: 0.06, a: 0.003, d: 0.045 });
      tone(g, g.out, t, 3720 * p, { peak: 0.022, a: 0.002, d: 0.03 });
      g.finish();
    },
  },

  'ui.open': {
    bus: 'ui',
    limit: 2,
    gap: 0.08,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      whoosh(g, g.out, t, { kind: 'pink', f: 520, f1: 3200, Q: 1.3, peak: 0.16, a: 0.16, r: 0.24 });
      bell(g, g.out, t + 0.06, 1318.5 * p, { peak: 0.1, decay: 0.55, ratio: 2, index: 0.8, pan: -0.15, partial: 0.12 });
      bell(g, g.out, t + 0.14, 1975.5 * p, { peak: 0.085, decay: 0.7, ratio: 2, index: 0.7, pan: 0.15, partial: 0.12 });
      tone(g, g.out, t + 0.02, 659.3 * p, { type: 'triangle', peak: 0.07, a: 0.02, d: 0.3 });
      g.finish();
    },
  },

  'ui.close': {
    bus: 'ui',
    limit: 2,
    gap: 0.08,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      whoosh(g, g.out, t, { kind: 'pink', f: 2600, f1: 480, Q: 1.2, peak: 0.12, a: 0.08, r: 0.22 });
      bell(g, g.out, t + 0.02, 1318.5 * p, { peak: 0.075, decay: 0.4, ratio: 2, index: 0.6, pan: 0.12, partial: 0.1 });
      bell(g, g.out, t + 0.1, 987.8 * p, { peak: 0.07, decay: 0.5, ratio: 2, index: 0.6, pan: -0.12, partial: 0.1 });
      g.finish();
    },
  },

  'ui.error': {
    bus: 'ui',
    limit: 2,
    gap: 0.15,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      tone(g, g.out, t, 246.9 * p, { type: 'hollow', peak: 0.3, a: 0.004, d: 0.13, lp: 1500 });
      tone(g, g.out, t, 249 * p, { type: 'triangle', peak: 0.12, a: 0.004, d: 0.12 });
      tone(g, g.out, t + 0.12, 207.7 * p, { type: 'hollow', peak: 0.3, a: 0.004, d: 0.2, lp: 1300 });
      tone(g, g.out, t + 0.12, 209.5 * p, { type: 'triangle', peak: 0.12, a: 0.004, d: 0.18 });
      g.finish();
    },
  },

  toast: {
    bus: 'ui',
    limit: 2,
    gap: 0.12,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      bell(g, g.out, t, 784 * p, { peak: 0.13, decay: 0.9, ratio: 3, index: 1.2, pan: -0.1 });
      bell(g, g.out, t + 0.09, 1174.7 * p, { peak: 0.12, decay: 1.1, ratio: 3, index: 1.1, pan: 0.1 });
      tone(g, g.out, t, 392 * p, { type: 'soft', peak: 0.06, a: 0.03, d: 0.5 });
      g.finish();
    },
  },

  /** variant: 'msg' (default, incoming), 'send', 'system', 'say' (NPC bubble). */
  chat: {
    bus: 'ui',
    limit: 3,
    gap: 0.06,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      const v = o.variant || 'msg';
      if (v === 'send') {
        tone(g, g.out, t, 620 * p, { f1: 1240 * p, sweepDur: 0.06, peak: 0.16, a: 0.004, d: 0.09 });
        tone(g, g.out, t + 0.05, 1240 * p, { peak: 0.06, a: 0.003, d: 0.08 });
      } else if (v === 'system') {
        bell(g, g.out, t, 1046.5 * p, { peak: 0.08, decay: 0.5, ratio: 2, index: 0.6 });
      } else if (v === 'say') {
        tone(g, g.out, t, 520 * p, { type: 'soft', f1: 700 * p, sweepDur: 0.05, peak: 0.12, a: 0.006, d: 0.07 });
        tone(g, g.out, t + 0.07, 640 * p, { type: 'soft', f1: 560 * p, sweepDur: 0.05, peak: 0.09, a: 0.006, d: 0.08 });
      } else {
        // incoming bubble: two soft pops rising
        tone(g, g.out, t, 700 * p, { f1: 980 * p, sweepDur: 0.05, peak: 0.17, a: 0.004, d: 0.08 });
        tone(g, g.out, t + 0.075, 980 * p, { f1: 1320 * p, sweepDur: 0.05, peak: 0.12, a: 0.004, d: 0.1 });
      }
      g.finish();
    },
  },

  'dialogue.open': {
    bus: 'ui',
    limit: 1,
    gap: 0.3,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      // warm sus2 swell + glassy shimmer
      const notes = [293.7, 440, 659.3, 830.6];
      const amp = g.gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.045, t + 0.22);
      amp.gain.setTargetAtTime(0, t + 0.3, 0.28);
      const lp = g.filter('lowpass', 1600, 0.5);
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.exponentialRampToValueAtTime(2200, t + 0.3);
      lp.connect(amp).connect(g.out);
      notes.forEach((f, i) => {
        const a = g.osc('warm', f * p, -6 + i * 4);
        a.connect(lp);
        g.play(a, t, t + 1.7);
      });
      bell(g, g.out, t + 0.12, 1661 * p, { peak: 0.05, decay: 1, ratio: 2.01, index: 0.5, pan: 0.2, partial: 0.1 });
      whoosh(g, g.out, t, { kind: 'pink', f: 900, f1: 2600, Q: 0.9, peak: 0.05, a: 0.2, r: 0.3 });
      g.finish();
    },
  },

  /** Subtle confirmation when [E] triggers an interaction that has no own sound. */
  interact: {
    bus: 'ui',
    limit: 2,
    gap: 0.1,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      tone(g, g.out, t, 880 * p, { type: 'soft', f1: 1320 * p, sweepDur: 0.05, peak: 0.12, a: 0.003, d: 0.1 });
      bell(g, g.out, t + 0.03, 1760 * p, { peak: 0.05, decay: 0.35, ratio: 2, index: 0.5, partial: 0 });
      g.finish();
    },
  },
};
