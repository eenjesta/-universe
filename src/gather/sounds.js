/**
 * Gathering sounds (procedural WebAudio recipes registered on ctx.audio as 'gather.*').
 * Warm and woody rather than shrill: every bright layer is low-passed (≤ ~3.5 kHz), impacts get
 * their body from low sine thumps and band-passed noise, and every play is slightly detuned so
 * repeated swings never sound like a loop.
 *
 *   gather.chop (opts.wood 0..1 = how far the tree is cut) · gather.creak · gather.crash (opts.size) ·
 *   gather.mine (opts.ore) · gather.crumble (opts.size) · gather.laser · gather.shatter · gather.rustle ·
 *   gather.pick · gather.pop (opts.n = combo step → rising pitch) · gather.swing · gather.deny
 */
import { Graph, num, rand, perc, sweep } from '../audio/lib/dsp.js';
import { bell, tone, burst, whoosh, thump } from '../audio/lib/voices.js';

export const GATHER_SOUNDS = {
  // axe into wood: dull knock + woody body resonance + bark crackle
  'gather.chop': {
    limit: 4,
    gap: 0.05,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.93, 1.07);
      const deep = num(o.wood, 0);
      thump(g, g.out, t, { f0: 190 * p, f1: 70 * p, peak: 0.55, d: 0.14, drop: 0.05 });
      // the woody "tok": two short resonant partials
      tone(g, g.out, t, 330 * p * (1 - deep * 0.15), { type: 'sine', peak: 0.22, a: 0.001, d: 0.11, f1: 300 * p, sweepDur: 0.1 });
      tone(g, g.out, t, 520 * p, { type: 'triangle', peak: 0.08, a: 0.001, d: 0.06, lp: 1800 });
      burst(g, g.out, t, { kind: 'white', type: 'bandpass', f: 1300 * p, Q: 1.1, peak: 0.16, a: 0.001, d: 0.045 });
      burst(g, g.out, t + 0.01, { kind: 'pink', type: 'lowpass', f: 900, Q: 0.7, peak: 0.07, a: 0.004, d: 0.14 });
      // a few bark splinters
      for (let i = 0; i < 3; i++) burst(g, g.out, t + 0.02 + i * 0.018 + Math.random() * 0.01, { f: rand(1800, 2800), Q: 3, peak: 0.025, a: 0.001, d: 0.012 });
      g.finish();
    },
  },

  // the tree gives way: a slow, groaning creak (resonant band sweeping up) + fibres tearing
  'gather.creak': {
    limit: 2,
    gap: 0.3,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.9, 1.08);
      const dur = 1.1;
      const src = g.osc('sawtooth', 62 * p);
      const lfo = g.osc('sine', 9.5);
      const lg = g.gain(9 * p);
      lfo.connect(lg).connect(src.frequency);
      sweep(src.frequency, 58 * p, 96 * p, t, dur);
      const bp = g.filter('bandpass', 420 * p, 7);
      sweep(bp.frequency, 380 * p, 760 * p, t, dur);
      const lp = g.filter('lowpass', 1600, 0.7);
      const amp = g.gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.22, t + 0.25);
      amp.gain.linearRampToValueAtTime(0.16, t + dur * 0.8);
      amp.gain.exponentialRampToValueAtTime(0.0005, t + dur + 0.15);
      src.connect(bp).connect(lp).connect(amp).connect(g.out);
      g.play(src, t, t + dur + 0.2);
      g.play(lfo, t, t + dur + 0.2);
      for (let i = 0; i < 6; i++) burst(g, g.out, t + 0.35 + i * 0.11 + Math.random() * 0.05, { kind: 'pink', f: rand(700, 1500), Q: 2.2, peak: 0.05, a: 0.003, d: 0.05 });
      g.finish();
    },
  },

  // the trunk hits the ground: boom + debris rumble + a wash of leaves
  'gather.crash': {
    limit: 2,
    gap: 0.2,
    fn(g, o) {
      const t = g.t;
      const s = Math.min(1.5, Math.max(0.5, num(o.size, 1)));
      thump(g, g.out, t, { f0: 95 / s, f1: 34, peak: 0.75, d: 0.55, drop: 0.25 });
      thump(g, g.out, t + 0.09, { f0: 70 / s, f1: 30, peak: 0.35, d: 0.4, drop: 0.2 });
      const n = g.noise('brown');
      const lp = g.filter('lowpass', 520, 0.7);
      sweep(lp.frequency, 900, 220, t, 1.1);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.55, 0.008, 1.1);
      n.connect(lp).connect(amp).connect(g.out);
      g.play(n, t, t + 1.3);
      // branches snapping
      for (let i = 0; i < 5; i++) burst(g, g.out, t + 0.03 + Math.random() * 0.25, { f: rand(900, 2200), Q: 2.5, peak: 0.07, a: 0.001, d: 0.03 });
      // leaves settling
      whoosh(g, g.out, t + 0.05, { kind: 'pink', f: 2200, f1: 1400, Q: 0.8, peak: 0.09, a: 0.08, r: 1.1 });
      g.finish();
    },
  },

  // pick / multitool on stone: a bright but short clink (FM bell, low-passed) + grit + thud
  'gather.mine': {
    limit: 4,
    gap: 0.05,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.94, 1.06);
      const lp = g.filter('lowpass', 3400, 0.7);
      lp.connect(g.out);
      bell(g, lp, t, 1180 * p, { peak: num(o.ore, 0) > 0.5 ? 0.14 : 0.1, decay: 0.32, ratio: 2.76, index: 1.6, partial: 0.18 });
      bell(g, lp, t, 1630 * p, { peak: 0.04, decay: 0.18, ratio: 3.1, index: 1.1 });
      thump(g, g.out, t, { f0: 210 * p, f1: 90, peak: 0.32, d: 0.09, drop: 0.035 });
      burst(g, g.out, t, { kind: 'white', type: 'bandpass', f: 2600, Q: 0.9, peak: 0.07, a: 0.001, d: 0.03 });
      burst(g, g.out, t + 0.012, { kind: 'pink', type: 'lowpass', f: 1400, Q: 0.7, peak: 0.08, a: 0.003, d: 0.12 });
      g.finish();
    },
  },

  // a rock breaks apart: crunch + rumble + pebbles pattering down
  'gather.crumble': {
    limit: 2,
    gap: 0.15,
    fn(g, o) {
      const t = g.t;
      const s = Math.min(1.6, Math.max(0.5, num(o.size, 1)));
      thump(g, g.out, t, { f0: 140 / s, f1: 42, peak: 0.6, d: 0.32, drop: 0.12 });
      const n = g.noise('brown');
      const lp = g.filter('lowpass', 780, 0.8);
      sweep(lp.frequency, 1400, 260, t, 0.7);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.5, 0.004, 0.75);
      n.connect(lp).connect(amp).connect(g.out);
      g.play(n, t, t + 0.9);
      burst(g, g.out, t, { kind: 'white', type: 'bandpass', f: 1500, Q: 0.8, peak: 0.12, a: 0.001, d: 0.09 });
      for (let i = 0; i < 9; i++) burst(g, g.out, t + 0.12 + i * 0.06 + Math.random() * 0.06, { f: rand(1400, 3000), Q: 3.5, peak: 0.035 * (1 - i / 10), a: 0.001, d: 0.02 });
      g.finish();
    },
  },

  // mining laser pulse: a warm hum zap (detuned saws, low-passed) with a sub
  'gather.laser': {
    limit: 3,
    gap: 0.06,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.97, 1.03);
      const dur = 0.34;
      const lp = g.filter('lowpass', 1500, 1.6);
      sweep(lp.frequency, 2400, 700, t, dur);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.16, 0.01, dur);
      lp.connect(amp).connect(g.out);
      for (const d of [-9, 7]) {
        const s = g.osc('sawtooth', 196 * p, d);
        sweep(s.frequency, 240 * p, 160 * p, t, dur);
        s.connect(lp);
        g.play(s, t, t + dur + 0.05);
      }
      tone(g, g.out, t, 98 * p, { peak: 0.14, a: 0.005, d: dur });
      burst(g, g.out, t, { kind: 'pink', f: 2200, Q: 1.4, peak: 0.04, a: 0.002, d: 0.2 });
      g.finish();
    },
  },

  // crystal formation shatters: glassy chime cluster + sparkle (low-passed)
  'gather.shatter': {
    limit: 2,
    gap: 0.2,
    fn(g, o) {
      const t = g.t;
      const lp = g.filter('lowpass', 4200, 0.7);
      lp.connect(g.out);
      const base = rand(880, 980);
      [1, 1.26, 1.5, 1.89, 2.24].forEach((r, i) => bell(g, lp, t + i * 0.025 + Math.random() * 0.02, base * r, { peak: 0.07, decay: 0.9 - i * 0.1, ratio: 3.5, index: 1.3 }));
      thump(g, g.out, t, { f0: 160, f1: 60, peak: 0.3, d: 0.2, drop: 0.08 });
      for (let i = 0; i < 10; i++) burst(g, lp, t + 0.05 + Math.random() * 0.5, { f: rand(2600, 3800), Q: 5, peak: 0.02, a: 0.001, d: 0.03 });
      g.finish();
    },
  },

  // leaves / fronds moving
  'gather.rustle': {
    limit: 3,
    gap: 0.06,
    fn(g, o) {
      const t = g.t;
      const d = Math.max(0.15, num(o.duration, 0.32));
      const n = g.noise('pink');
      const bp = g.filter('bandpass', rand(1500, 2100), 0.9);
      const lp = g.filter('lowpass', 3200, 0.7);
      const amp = g.gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.1, t + d * 0.25);
      amp.gain.linearRampToValueAtTime(0.0001, t + d);
      const trem = g.osc('sine', rand(16, 24));
      const tg = g.gain(0.05);
      trem.connect(tg).connect(amp.gain);
      n.connect(bp).connect(lp).connect(amp).connect(g.out);
      g.play(n, t, t + d + 0.05);
      g.play(trem, t, t + d + 0.05);
      g.finish();
    },
  },

  // plant comes loose: soft snap + rustle
  'gather.pick': {
    limit: 3,
    gap: 0.08,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.95, 1.05);
      burst(g, g.out, t, { kind: 'pink', type: 'bandpass', f: 1700 * p, Q: 1, peak: 0.1, a: 0.004, d: 0.18 });
      tone(g, g.out, t + 0.03, 420 * p, { type: 'sine', peak: 0.07, a: 0.002, d: 0.05, f1: 260 * p, sweepDur: 0.05 });
      burst(g, g.out, t + 0.03, { f: 2400, Q: 3, peak: 0.04, a: 0.001, d: 0.015 });
      g.finish();
    },
  },

  // item collected: a round, friendly blip (rises with the combo step)
  'gather.pop': {
    limit: 4,
    gap: 0.04,
    fn(g, o) {
      const t = g.t;
      const step = Math.min(8, Math.max(0, num(o.n, 0)));
      const f = 520 * Math.pow(2, step / 12) * rand(0.99, 1.01);
      tone(g, g.out, t, f, { type: 'sine', peak: 0.12, a: 0.003, d: 0.12, f1: f * 1.5, sweepDur: 0.05 });
      tone(g, g.out, t + 0.045, f * 1.5, { type: 'triangle', peak: 0.05, a: 0.003, d: 0.12, lp: 2600 });
      g.finish();
    },
  },

  // tool swing (air)
  'gather.swing': {
    limit: 3,
    gap: 0.1,
    fn(g, o) {
      const t = g.t;
      whoosh(g, g.out, t, { kind: 'pink', f: 380, f1: 1100, Q: 1.1, peak: 0.045 * num(o.volume, 1), a: 0.1, r: 0.14 });
      g.finish();
    },
  },

  // not possible (needs a better tool / already harvested)
  'gather.deny': {
    limit: 1,
    gap: 0.25,
    fn(g) {
      const t = g.t;
      tone(g, g.out, t, 220, { type: 'triangle', peak: 0.1, a: 0.004, d: 0.12, lp: 900 });
      tone(g, g.out, t + 0.1, 185, { type: 'triangle', peak: 0.08, a: 0.004, d: 0.16, lp: 900 });
      g.finish();
    },
  },
};

export function registerGatherSounds(ctx) {
  const audio = ctx.audio;
  if (!audio?.register) return [];
  const names = [];
  for (const [name, spec] of Object.entries(GATHER_SOUNDS)) {
    let voices = 0;
    let last = -1e9;
    audio.register(name, (ac, out, opts = {}) => {
      const now = performance.now();
      if (now - last < (spec.gap ?? 0.03) * 1000 || voices >= (spec.limit ?? 4)) return;
      last = now;
      const g = new Graph(ac, out);
      voices++;
      g.onDispose = () => {
        voices = Math.max(0, voices - 1);
      };
      try {
        spec.fn(g, opts);
      } catch (err) {
        g.dispose();
        throw err;
      }
    });
    names.push(name);
  }
  return names;
}
