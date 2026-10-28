/**
 * Gameplay sounds (bus 'sfx' unless noted): quest.update · quest.complete ·
 * reward · build.place · build.remove · build.invalid · build.mode · harvest ·
 * scan (loop, set({progress})) · footstep (opts.surface: grass | stone | rock |
 * metal | wood | water | sand, opts.speed, opts.side) · jump · land (opts.speed)
 * · vehicle.enter · vehicle.exit · vehicle.summon · launch
 */
import { Graph, num, rand, clamp01, glide, perc, Scheduler } from '../lib/dsp.js';
import { bell, tone, burst, whoosh, thump, echo } from '../lib/voices.js';

// ------------------------------------------------------------- footsteps
/** One footstep on a surface. `v` = loudness 0..1.5, `pan` small stereo offset. */
function step(g, dest, t, surface, v, pan) {
  const r = () => rand(0.88, 1.12);
  switch (surface) {
    case 'stone':
    case 'rock': {
      burst(g, dest, t, { f: 1900 * r(), Q: 1.6, peak: 0.26 * v, a: 0.001, d: 0.035, pan });
      thump(g, dest, t, { f0: 120 * r(), f1: 70, peak: 0.22 * v, d: 0.06, drop: 0.03 });
      burst(g, dest, t + 0.004, { type: 'highpass', f: 3600, Q: 0.7, peak: 0.05 * v, d: 0.05, pan });
      if (surface === 'rock') burst(g, dest, t + 0.03, { kind: 'pink', f: 2600 * r(), Q: 1, peak: 0.07 * v, a: 0.004, d: 0.06, pan });
      return t + 0.15;
    }
    case 'metal': {
      thump(g, dest, t, { f0: 130 * r(), f1: 75, peak: 0.22 * v, d: 0.07, drop: 0.03 });
      burst(g, dest, t, { f: 2400, Q: 1.2, peak: 0.12 * v, a: 0.001, d: 0.025, pan });
      const f = 360 * r();
      tone(g, dest, t, f, { peak: 0.07 * v, a: 0.001, d: 0.22, pan });
      tone(g, dest, t, f * 2.32, { peak: 0.045 * v, a: 0.001, d: 0.14, pan });
      tone(g, dest, t, f * 4.25, { peak: 0.025 * v, a: 0.001, d: 0.07, pan });
      return t + 0.3;
    }
    case 'wood': {
      const f = 190 * r();
      tone(g, dest, t, f, { f1: f * 0.78, sweepDur: 0.05, peak: 0.28 * v, a: 0.002, d: 0.08, pan });
      tone(g, dest, t, f * 2.03, { type: 'triangle', peak: 0.06 * v, a: 0.001, d: 0.05, pan });
      burst(g, dest, t, { f: 900 * r(), Q: 2, peak: 0.14 * v, a: 0.001, d: 0.04, pan });
      return t + 0.14;
    }
    case 'water': {
      burst(g, dest, t, { f: 900 * r(), f1: 2600, Q: 0.8, peak: 0.22 * v, a: 0.012, d: 0.18, pan });
      burst(g, dest, t, { kind: 'pink', type: 'lowpass', f: 700, Q: 0.6, peak: 0.14 * v, a: 0.01, d: 0.12, pan });
      tone(g, dest, t + 0.04, 520 * r(), { f1: 1150, sweepDur: 0.04, peak: 0.045 * v, a: 0.002, d: 0.04, pan });
      tone(g, dest, t + 0.09, 640 * r(), { f1: 1380, sweepDur: 0.035, peak: 0.035 * v, a: 0.002, d: 0.035, pan: -pan });
      return t + 0.25;
    }
    case 'sand': {
      burst(g, dest, t, { kind: 'pink', type: 'lowpass', f: 1600 * r(), Q: 0.5, peak: 0.24 * v, a: 0.012, d: 0.11, pan });
      burst(g, dest, t, { type: 'highpass', f: 4000, Q: 0.6, peak: 0.05 * v, a: 0.006, d: 0.07, pan });
      thump(g, dest, t, { f0: 95, f1: 60, peak: 0.12 * v, d: 0.05 });
      return t + 0.15;
    }
    case 'grass':
    default: {
      burst(g, dest, t, { kind: 'pink', f: 2600 * r(), Q: 0.8, peak: 0.24 * v, a: 0.008, d: 0.09, pan });
      thump(g, dest, t, { f0: 100 * r(), f1: 60, peak: 0.16 * v, d: 0.06 });
      burst(g, dest, t + 0.02, { type: 'highpass', f: 5000, Q: 0.6, peak: 0.045 * v, a: 0.01, d: 0.1, pan });
      return t + 0.15;
    }
  }
}

export const GAME_RECIPES = {
  'quest.update': {
    bus: 'ui',
    limit: 2,
    gap: 0.15,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      const fx = echo(g, g.out, { time: 0.17, fb: 0.32, wet: 0.35, lp: 3800 });
      const notes = [659.3, 880, 1108.7];
      notes.forEach((f, i) => {
        bell(g, g.out, t + i * 0.085, f * p, { peak: 0.15, decay: 0.8, ratio: 3, index: 1.1, pan: (i - 1) * 0.25 });
        bell(g, fx, t + i * 0.085, f * p, { peak: 0.08, decay: 0.5, ratio: 3, index: 0.8, partial: 0 });
      });
      bell(g, g.out, t + 0.26, 1760 * p, { peak: 0.05, decay: 0.9, ratio: 2, index: 0.5, partial: 0 });
      g.hold(t + 2.2);
      g.finish();
    },
  },

  'quest.complete': {
    bus: 'ui',
    limit: 1,
    gap: 0.6,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      // warm D major add9 swell with an opening filter
      const lp = g.filter('lowpass', 500, 0.6);
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
      lp.frequency.setTargetAtTime(1400, t + 1, 0.6);
      const amp = g.gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.055, t + 0.14);
      amp.gain.setTargetAtTime(0.038, t + 0.3, 0.3);
      amp.gain.setTargetAtTime(0, t + 1.3, 0.45);
      lp.connect(amp).connect(g.out);
      [293.7, 370, 440, 659.3, 587.3].forEach((f, i) => {
        for (const dt of [-7, 7]) {
          const s = g.osc('warm', f * p, dt + i);
          s.connect(lp);
          g.play(s, t, t + 3.4);
        }
      });
      // rising arpeggio + sparkle
      const fx = echo(g, g.out, { time: 0.21, fb: 0.3, wet: 0.28, lp: 4200 });
      [587.3, 740, 880, 1174.7, 1480].forEach((f, i) => {
        bell(g, g.out, t + 0.05 + i * 0.075, f * p, { peak: 0.11, decay: 1.1, ratio: 3, index: 1, pan: -0.4 + i * 0.2 });
        bell(g, fx, t + 0.05 + i * 0.075, f * p, { peak: 0.05, decay: 0.6, ratio: 3, index: 0.6, partial: 0 });
      });
      bell(g, g.out, t + 0.5, 2349.3 * p, { peak: 0.045, decay: 1.6, ratio: 2, index: 0.4, partial: 0 });
      tone(g, g.out, t, 73.4 * p, { peak: 0.2, a: 0.02, d: 1.6 });
      tone(g, g.out, t, 146.8 * p, { type: 'soft', peak: 0.08, a: 0.02, d: 1.2 });
      whoosh(g, g.out, t, { kind: 'pink', f: 800, f1: 5000, Q: 0.7, peak: 0.05, a: 0.4, r: 0.8 });
      g.hold(t + 4);
      g.finish();
    },
  },

  reward: {
    bus: 'ui',
    limit: 2,
    gap: 0.1,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      bell(g, g.out, t, 987.8 * p, { peak: 0.14, decay: 0.7, ratio: 3.5, index: 1.4, pan: -0.15 });
      bell(g, g.out, t + 0.06, 1318.5 * p, { peak: 0.13, decay: 0.8, ratio: 3.5, index: 1.3, pan: 0.15 });
      bell(g, g.out, t + 0.13, 1661.2 * p, { peak: 0.09, decay: 1, ratio: 3.5, index: 1.1 });
      burst(g, g.out, t + 0.02, { f: 7200, Q: 1.5, peak: 0.05, a: 0.03, d: 0.35 });
      g.finish();
    },
  },

  'build.place': {
    limit: 3,
    gap: 0.06,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.96, 1.04);
      thump(g, g.out, t, { f0: 150 * p, f1: 55, peak: 0.42, d: 0.16 });
      burst(g, g.out, t, { f: 2000, Q: 1.3, peak: 0.15, a: 0.001, d: 0.02 });
      whoosh(g, g.out, t + 0.01, { kind: 'white', f: 2000, f1: 6500, Q: 2, peak: 0.07, a: 0.06, r: 0.18 });
      bell(g, g.out, t + 0.05, 1046.5 * p, { peak: 0.06, decay: 0.4, ratio: 2, index: 0.6, partial: 0.1 });
      g.finish();
    },
  },

  'build.remove': {
    limit: 3,
    gap: 0.06,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.96, 1.04);
      whoosh(g, g.out, t, { kind: 'white', f: 5000, f1: 900, Q: 1.6, peak: 0.1, a: 0.04, r: 0.22 });
      tone(g, g.out, t, 900 * p, { type: 'soft', f1: 300 * p, sweepDur: 0.2, peak: 0.1, a: 0.005, d: 0.2 });
      thump(g, g.out, t + 0.03, { f0: 90 * p, f1: 50, peak: 0.2, d: 0.1 });
      g.finish();
    },
  },

  'build.invalid': {
    limit: 1,
    gap: 0.22,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      for (const [dt, f] of [[0, 311], [0.13, 293.7]]) {
        tone(g, g.out, t + dt, f * p, { type: 'hollow', peak: 0.14, a: 0.004, d: 0.13, lp: 1400 });
        tone(g, g.out, t + dt, f * 1.06 * p, { type: 'hollow', peak: 0.1, a: 0.004, d: 0.12, lp: 1200 });
      }
      g.finish();
    },
  },

  /** opts.active: true = hologram tools power up, false = power down. */
  'build.mode': {
    limit: 1,
    gap: 0.2,
    fn(g, o) {
      const t = g.t;
      const on = o.active !== false;
      tone(g, g.out, t, on ? 220 : 880, { type: 'soft', f1: on ? 880 : 220, sweepDur: 0.32, peak: 0.12, a: 0.02, d: 0.32, lp: 2400 });
      whoosh(g, g.out, t, { kind: 'pink', f: on ? 400 : 3000, f1: on ? 3000 : 400, Q: 1.1, peak: 0.09, a: 0.14, r: 0.22 });
      if (on) bell(g, g.out, t + 0.28, 880, { peak: 0.07, decay: 0.6, ratio: 2, index: 0.6, partial: 0.1 });
      g.finish();
    },
  },

  /** opts.resource: metal (default) | stone | wood | energy. */
  harvest: {
    limit: 3,
    gap: 0.07,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.95, 1.05);
      const res = o.resource || 'metal';
      if (res === 'wood') {
        tone(g, g.out, t, 210 * p, { f1: 160 * p, sweepDur: 0.06, peak: 0.3, a: 0.002, d: 0.1 });
        burst(g, g.out, t, { f: 1100, Q: 1.6, peak: 0.2, a: 0.001, d: 0.05 });
      } else if (res === 'stone') {
        burst(g, g.out, t, { f: 1300 * p, Q: 1.2, peak: 0.3, a: 0.001, d: 0.06 });
        burst(g, g.out, t + 0.02, { kind: 'pink', f: 2800, Q: 0.9, peak: 0.12, a: 0.003, d: 0.12 });
        thump(g, g.out, t, { f0: 130, f1: 65, peak: 0.22, d: 0.08 });
      } else if (res === 'energy') {
        tone(g, g.out, t, 600 * p, { f1: 1800 * p, sweepDur: 0.12, peak: 0.12, a: 0.004, d: 0.16 });
        burst(g, g.out, t, { type: 'highpass', f: 3000, Q: 0.8, peak: 0.08, a: 0.002, d: 0.1 });
      } else {
        tone(g, g.out, t, 2650 * p, { peak: 0.12, a: 0.001, d: 0.14 });
        tone(g, g.out, t, 3975 * p, { peak: 0.06, a: 0.001, d: 0.08 });
        burst(g, g.out, t, { f: 3000, Q: 1.2, peak: 0.18, a: 0.001, d: 0.04 });
        thump(g, g.out, t, { f0: 140, f1: 70, peak: 0.2, d: 0.08 });
      }
      bell(g, g.out, t + 0.08, 1568 * p, { peak: 0.06, decay: 0.45, ratio: 2, index: 0.6, partial: 0.1, pan: -0.1 });
      bell(g, g.out, t + 0.14, 2093 * p, { peak: 0.05, decay: 0.5, ratio: 2, index: 0.5, partial: 0.1, pan: 0.1 });
      g.finish();
    },
  },

  /** Scanning hum (loop): set({progress 0..1}). */
  scan: {
    loop: true,
    fn(g, o) {
      const t = g.t;
      const ac = g.ac;
      const master = g.gain(0);
      master.gain.setTargetAtTime(0.7, t, 0.08);
      master.connect(g.out);
      // hum (fifth) with tremolo
      const hum = g.gain(0.05);
      const trem = g.gain(1);
      for (const f of [220, 330]) {
        const s = g.osc('soft', f);
        s.connect(hum);
        g.play(s, t);
      }
      hum.connect(trem).connect(master);
      g.lfo(trem.gain, 6, 0.35, 'sine', t);
      // rising data sweep
      const sw = g.osc('sine', 330);
      const swg = g.gain(0.045);
      g.lfo(sw.frequency, 9, 11, 'sine', t);
      sw.connect(swg).connect(master);
      g.play(sw, t);
      // textured noise (kept under ~2.5 kHz: laptop speakers)
      const n = g.noise('white');
      const bp = g.filter('bandpass', 1500, 3);
      const ng = g.gain(0.026);
      n.connect(bp).connect(ng).connect(master);
      g.play(n, t);
      // ticks
      let progress = 0;
      let next = t + 0.05;
      const sched = new Scheduler(
        ac,
        (from, to) => {
          if (next < from) next = from;
          while (next < to) {
            const tt = next;
            const tg = new Graph(ac, master);
            tone(tg, master, tt, 1150 + progress * 700 + rand(-40, 40), { type: 'soft', peak: 0.04, a: 0.002, d: 0.035, lp: 2400 });
            tg.finish();
            next += 1 / (3 + progress * 9);
          }
        },
        { duration: num(o.duration, 4) },
      ).start(t + 0.05);
      return {
        set(pm) {
          progress = clamp01(num(pm.progress, progress));
          const now = ac.currentTime;
          glide(sw.frequency, 330 + progress * 660, now, 0.15);
          glide(bp.frequency, 1500 + progress * 900, now, 0.2);
          glide(hum.gain, 0.05 + progress * 0.03, now, 0.2);
        },
        stop() {
          sched.stop();
        },
      };
    },
  },

  /** opts.surface, opts.speed (m/s), opts.side (−1 | 1). */
  footstep: {
    limit: 4,
    gap: 0.08,
    priority: 0,
    fn(g, o) {
      const speed = num(o.speed, 3);
      const v = (0.5 + clamp01(speed / 7) * 0.45) * rand(0.85, 1.05);
      const side = num(o.side, 0);
      const end = step(g, g.out, g.t, o.surface || 'grass', v, side * 0.06);
      g.hold(end);
      g.finish();
    },
  },

  jump: {
    limit: 2,
    gap: 0.15,
    fn(g) {
      const t = g.t;
      whoosh(g, g.out, t, { kind: 'pink', f: 380, f1: 1300, Q: 1, peak: 0.12, a: 0.05, r: 0.14 });
      burst(g, g.out, t, { type: 'highpass', f: 2500, Q: 0.6, peak: 0.06, a: 0.004, d: 0.08 });
      thump(g, g.out, t, { f0: 95, f1: 60, peak: 0.12, d: 0.05 });
      g.finish();
    },
  },

  /** opts.speed = vertical impact speed (m/s), opts.surface. */
  land: {
    limit: 2,
    gap: 0.15,
    fn(g, o) {
      const t = g.t;
      const impact = clamp01((num(o.speed, 4) - 1.5) / 12);
      thump(g, g.out, t, { f0: 105, f1: 42, peak: 0.22 + impact * 0.22, d: 0.15 + impact * 0.15 });
      let end = step(g, g.out, t, o.surface || 'grass', 0.8 + impact * 0.3, 0);
      if (impact > 0.45) end = Math.max(end, burst(g, g.out, t, { kind: 'brown', type: 'lowpass', f: 320, Q: 0.5, peak: 0.2 * impact, a: 0.005, d: 0.3 }));
      g.hold(Math.max(end, t + 0.35));
      g.finish();
    },
  },

  'vehicle.enter': {
    limit: 1,
    gap: 0.3,
    fn(g) {
      const t = g.t;
      thump(g, g.out, t, { f0: 120, f1: 60, peak: 0.32, d: 0.12 });
      burst(g, g.out, t, { f: 1200, Q: 1, peak: 0.16, a: 0.001, d: 0.05 });
      tone(g, g.out, t + 0.12, 110, { type: 'soft', f1: 440, sweepDur: 0.5, peak: 0.1, a: 0.08, d: 0.5, lp: 1800 });
      bell(g, g.out, t + 0.45, 1046.5, { peak: 0.05, decay: 0.4, ratio: 2, index: 0.5, partial: 0 });
      bell(g, g.out, t + 0.53, 1318.5, { peak: 0.05, decay: 0.5, ratio: 2, index: 0.5, partial: 0 });
      g.finish();
    },
  },

  'vehicle.exit': {
    limit: 1,
    gap: 0.3,
    fn(g) {
      const t = g.t;
      tone(g, g.out, t, 440, { type: 'soft', f1: 110, sweepDur: 0.4, peak: 0.09, a: 0.02, d: 0.4, lp: 1600 });
      thump(g, g.out, t + 0.16, { f0: 125, f1: 60, peak: 0.3, d: 0.12 });
      burst(g, g.out, t + 0.16, { f: 1300, Q: 1, peak: 0.14, a: 0.001, d: 0.05 });
      g.finish();
    },
  },

  'vehicle.summon': {
    limit: 1,
    gap: 0.4,
    fn(g) {
      const t = g.t;
      whoosh(g, g.out, t, { kind: 'pink', f: 300, f1: 4200, Q: 1.2, peak: 0.12, a: 0.5, r: 0.5 });
      [784, 987.8, 1174.7, 1568].forEach((f, i) => bell(g, g.out, t + 0.15 + i * 0.09, f, { peak: 0.06, decay: 0.7, ratio: 2, index: 0.6, pan: -0.3 + i * 0.2 }));
      thump(g, g.out, t + 0.55, { f0: 110, f1: 50, peak: 0.25, d: 0.2 });
      g.finish();
    },
  },

  /** Ship launch towards space: a long rising roar. */
  launch: {
    limit: 1,
    gap: 1,
    fn(g) {
      const t = g.t;
      thump(g, g.out, t, { f0: 90, f1: 35, peak: 0.45, d: 0.6, drop: 0.25 });
      const n = g.noise('brown');
      const n2 = g.noise('pink');
      const lp = g.filter('lowpass', 200, 0.9);
      lp.frequency.setValueAtTime(200, t);
      lp.frequency.exponentialRampToValueAtTime(1800, t + 2.2);
      const amp = g.gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.42, t + 1.6);
      amp.gain.setTargetAtTime(0, t + 2.2, 0.35);
      const n2g = g.gain(0.35);
      n.connect(lp);
      n2.connect(n2g).connect(lp);
      lp.connect(amp).connect(g.out);
      const s = g.osc('warm', 60);
      s.frequency.setValueAtTime(60, t);
      s.frequency.exponentialRampToValueAtTime(190, t + 2.2);
      const slp = g.filter('lowpass', 700, 0.7);
      const sg = g.gain(0);
      perc(sg.gain, t, 0.12, 1.2, 1.4);
      s.connect(slp).connect(sg).connect(g.out);
      g.play(n, t, t + 3.6);
      g.play(n2, t, t + 3.6);
      g.play(s, t, t + 3.6);
      g.finish();
    },
  },
};
