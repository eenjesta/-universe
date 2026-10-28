/**
 * Space & combat one-shots (bus 'sfx'): laser · explosion (opts.size 0.3..2 —
 * defaults to 1/pitch —, opts.distant, opts.pitch) · shield.hit · boost · dock · warp. Weighty but rounded —
 * every bright layer is low-passed so rapid fire never gets piercing.
 */
import { num, rand, perc, sweep } from '../lib/dsp.js';
import { bell, tone, burst, whoosh, thump, echo } from '../lib/voices.js';

export const SPACE_RECIPES = {
  laser: {
    limit: 8,
    gap: 0.03,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.94, 1.06);
      // "pew": starts ~1.5 kHz (was 1.9 / 3.8 kHz — piercing on laptop speakers)
      const lp = g.filter('lowpass', 3000, 0.7);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.26, 0.002, 0.17);
      lp.connect(amp).connect(g.out);
      const a = g.osc('bright', 1500 * p);
      sweep(a.frequency, 1500 * p, 240 * p, t, 0.16);
      const b = g.osc('sine', 760 * p);
      sweep(b.frequency, 760 * p, 120 * p, t, 0.15);
      const bg = g.gain(0.45);
      a.connect(lp);
      b.connect(bg).connect(lp);
      g.play(a, t, t + 0.2);
      g.play(b, t, t + 0.2);
      burst(g, g.out, t, { f: 2000, Q: 1.2, peak: 0.06, a: 0.001, d: 0.02 });
      thump(g, g.out, t, { f0: 180, f1: 90, peak: 0.12, d: 0.05 });
      g.finish();
    },
  },

  explosion: {
    limit: 5,
    gap: 0.05,
    fn(g, o) {
      const t = g.t;
      const p = Math.max(0.4, Math.min(2.5, num(o.pitch, 1)));
      const size = Math.max(0.3, Math.min(2, num(o.size, 1 / p)));
      const far = !!o.distant;
      const dur = 1.2 + size * 0.8;
      const bus = g.gain(0.72);
      bus.connect(g.out);
      g.out = bus;
      // sub + body thumps
      thump(g, g.out, t, { f0: 70 * p, f1: 28 * p, peak: 0.45, d: dur * 0.7, drop: 0.35 });
      thump(g, g.out, t, { f0: 130 * p, f1: 55 * p, peak: 0.32, d: 0.45, drop: 0.12 });
      // noise body with a closing filter and soft saturation
      const n1 = g.noise('brown');
      const n2 = g.noise('white');
      const n2g = g.gain(0.22);
      const lp = g.filter('lowpass', (far ? 1200 : 2800) * p, 0.7);
      sweep(lp.frequency, (far ? 1200 : 2800) * p, (far ? 110 : 170) * p, t, dur * 0.8);
      const sat = g.shaper(1.8);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.5, 0.008, dur);
      n1.connect(lp);
      n2.connect(n2g).connect(lp);
      lp.connect(sat).connect(amp).connect(g.out);
      g.play(n1, t, t + dur + 0.05);
      g.play(n2, t, t + dur + 0.05);
      // crackles / debris
      const count = far ? 3 : Math.round(5 + size * 3);
      for (let i = 0; i < count; i++) {
        const tt = t + 0.05 + Math.random() * 0.8 * size;
        burst(g, g.out, tt, { f: rand(700, 3000), Q: rand(1, 3), peak: rand(0.04, 0.1) * (far ? 0.5 : 1), a: 0.001, d: rand(0.02, 0.07), pan: rand(-0.5, 0.5) });
      }
      g.finish();
    },
  },

  'shield.hit': {
    limit: 3,
    gap: 0.08,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.95, 1.05);
      // bright zap through a band-pass
      const z = g.osc('bright', 900 * p);
      sweep(z.frequency, 900 * p, 300 * p, t, 0.25);
      const bp = g.filter('bandpass', 1200, 1.8);
      const za = g.gain(0);
      perc(za.gain, t, 0.2, 0.002, 0.25);
      z.connect(bp).connect(za).connect(g.out);
      g.play(z, t, t + 0.3);
      // shimmering ring ("zzhum")
      const r = g.osc('sine', 1250 * p);
      g.lfo(r.frequency, 31, 80, 'sine', t, t + 0.5);
      const ra = g.gain(0);
      perc(ra.gain, t, 0.12, 0.004, 0.42);
      r.connect(ra).connect(g.out);
      g.play(r, t, t + 0.5);
      // crackle
      const n = g.noise('white');
      const hp = g.filter('highpass', 3000, 0.7);
      const na = g.gain(0);
      perc(na.gain, t, 0.09, 0.002, 0.25);
      const trem = g.gain(0.5);
      g.lfo(trem.gain, 40, 0.5, 'square', t, t + 0.3);
      n.connect(hp).connect(trem).connect(na).connect(g.out);
      g.play(n, t, t + 0.3);
      thump(g, g.out, t, { f0: 95, f1: 50, peak: 0.25, d: 0.12 });
      g.finish();
    },
  },

  boost: {
    limit: 2,
    gap: 0.3,
    fn(g) {
      const t = g.t;
      whoosh(g, g.out, t, { kind: 'pink', f: 300, f1: 1700, Q: 1, peak: 0.26, a: 0.25, r: 0.7 });
      tone(g, g.out, t, 70, { type: 'warm', f1: 140, sweepDur: 0.8, peak: 0.15, a: 0.1, d: 0.8, lp: 900 });
      tone(g, g.out, t, 520, { type: 'soft', f1: 1040, sweepDur: 0.6, peak: 0.03, a: 0.05, d: 0.6, lp: 1400 });
      thump(g, g.out, t, { f0: 100, f1: 45, peak: 0.25, d: 0.25 });
      g.finish();
    },
  },

  dock: {
    limit: 1,
    gap: 1,
    fn(g) {
      const t = g.t;
      for (const [dt, k] of [[0, 1], [0.28, 0.9]]) {
        const tt = t + dt;
        thump(g, g.out, tt, { f0: 160 * k, f1: 70 * k, peak: 0.38, d: 0.15 });
        burst(g, g.out, tt, { f: 1800, Q: 1.2, peak: 0.12, a: 0.001, d: 0.03 });
        tone(g, g.out, tt, 370 * k, { peak: 0.08, a: 0.001, d: 0.4 });
        tone(g, g.out, tt, 858 * k, { peak: 0.05, a: 0.001, d: 0.25 });
        tone(g, g.out, tt, 1572 * k, { peak: 0.03, a: 0.001, d: 0.12 });
      }
      burst(g, g.out, t + 0.4, { type: 'highpass', f: 2500, f1: 4200, Q: 0.7, peak: 0.1, a: 0.05, d: 0.9 });
      bell(g, g.out, t + 0.95, 784, { peak: 0.08, decay: 0.8, ratio: 3, index: 1 });
      bell(g, g.out, t + 1.05, 1174.7, { peak: 0.08, decay: 1, ratio: 3, index: 1 });
      g.finish();
    },
  },

  warp: {
    limit: 1,
    gap: 1,
    fn(g) {
      const t = g.t;
      const tr = t + 1.4; // release point
      // charge-up tone with accelerating tremolo
      const c = g.osc('warm', 80);
      sweep(c.frequency, 80, 1200, t, 1.4);
      const clp = g.filter('lowpass', 2400, 0.8);
      const ca = g.gain(0);
      ca.gain.setValueAtTime(0, t);
      ca.gain.linearRampToValueAtTime(0.16, tr);
      ca.gain.setTargetAtTime(0, tr, 0.06);
      const trem = g.gain(0.6);
      const lfo = g.lfo(trem.gain, 4, 0.4, 'sine', t, tr + 0.3);
      sweep(lfo.osc.frequency, 4, 18, t, 1.4);
      c.connect(clp).connect(trem).connect(ca).connect(g.out);
      g.play(c, t, tr + 0.3);
      whoosh(g, g.out, t, { kind: 'pink', f: 300, f1: 2800, Q: 1, peak: 0.22, a: 1.4, r: 0.25 });
      // release: whump + falling whoosh + shimmer
      thump(g, g.out, tr, { f0: 90, f1: 30, peak: 0.5, d: 0.8, drop: 0.3 });
      whoosh(g, g.out, tr, { kind: 'pink', f: 2800, f1: 200, Q: 0.8, peak: 0.24, a: 0.02, r: 1.2 });
      // shimmer: same chord, softer FM and a quieter top note (laptop speakers)
      const fx = echo(g, g.out, { time: 0.23, fb: 0.38, wet: 0.4, lp: 3600 });
      const lvl = [1, 0.85, 0.5];
      [1046.5, 1568, 2349.3].forEach((f, i) => bell(g, fx, tr + i * 0.06, f, { peak: 0.08 * lvl[i], decay: 1.2, ratio: 2, index: 0.45, partial: 0.12, pan: (i - 1) * 0.4 }));
      [1046.5, 1568, 2349.3].forEach((f, i) => bell(g, g.out, tr + i * 0.06, f, { peak: 0.06 * lvl[i], decay: 1.2, ratio: 2, index: 0.45, partial: 0.12, pan: (i - 1) * 0.4 }));
      g.hold(tr + 3);
      g.finish();
    },
  },
};
