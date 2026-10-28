/**
 * Combat sound recipes (procedural WebAudio, registered on ctx.audio as
 * 'combat.*'). Warm rather than shrill: every bright layer is low-passed below
 * ~2.5 kHz, energy "pews" start under 1 kHz and get their snap from short
 * filtered noise + a low thump, so sustained rifle fire never gets piercing.
 * Built on the audio module's DSP kit (Graph, voices) like src/audio/recipes.
 *
 *   combat.pistol · combat.rifle · combat.rail.charge · combat.rail · combat.reload ·
 *   combat.empty · combat.switch · combat.hit (opts.crit / opts.kill) · combat.hurt ·
 *   combat.shield.break · combat.heartbeat · combat.drone.laser · combat.stalker ·
 *   combat.stalker.die · combat.claw · combat.throw · combat.grenade.bounce ·
 *   combat.grenade.boom · combat.boom · combat.dodge · combat.zone.leave · combat.death · combat.respawn
 * opts.pitch scales most of them (remote shots are played a little lower).
 */
import { Graph, num, rand, perc, sweep } from '../audio/lib/dsp.js';
import { bell, tone, burst, whoosh, thump } from '../audio/lib/voices.js';

export const COMBAT_SOUNDS = {
  'combat.pistol': {
    limit: 5,
    gap: 0.04,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.96, 1.04);
      const lp = g.filter('lowpass', 2300, 0.8);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.3, 0.002, 0.12);
      lp.connect(amp).connect(g.out);
      const a = g.osc('warm', 620 * p);
      sweep(a.frequency, 620 * p, 150 * p, t, 0.11);
      const b = g.osc('sine', 310 * p);
      sweep(b.frequency, 310 * p, 90 * p, t, 0.1);
      const bg = g.gain(0.6);
      a.connect(lp);
      b.connect(bg).connect(lp);
      g.play(a, t, t + 0.14);
      g.play(b, t, t + 0.14);
      burst(g, g.out, t, { f: 1500 * p, Q: 0.9, peak: 0.11, a: 0.001, d: 0.028 });
      burst(g, g.out, t + 0.004, { kind: 'pink', type: 'lowpass', f: 900, Q: 0.7, peak: 0.07, a: 0.004, d: 0.16 });
      thump(g, g.out, t, { f0: 150 * p, f1: 60 * p, peak: 0.26, d: 0.08, drop: 0.05 });
      g.finish();
    },
  },

  'combat.rifle': {
    limit: 6,
    gap: 0.03,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.95, 1.05);
      const lp = g.filter('lowpass', 1900, 0.75);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.24, 0.002, 0.085);
      lp.connect(amp).connect(g.out);
      const a = g.osc('bright', 470 * p);
      sweep(a.frequency, 470 * p, 120 * p, t, 0.08);
      a.connect(lp);
      g.play(a, t, t + 0.1);
      const s = g.osc('sine', 235 * p);
      sweep(s.frequency, 235 * p, 80 * p, t, 0.08);
      const sg = g.gain(0);
      perc(sg.gain, t, 0.16, 0.002, 0.08);
      s.connect(sg).connect(g.out);
      g.play(s, t, t + 0.1);
      burst(g, g.out, t, { f: 1100 * p, Q: 1, peak: 0.1, a: 0.001, d: 0.022 });
      burst(g, g.out, t + 0.003, { kind: 'pink', type: 'lowpass', f: 700, Q: 0.7, peak: 0.06, a: 0.003, d: 0.11 });
      thump(g, g.out, t, { f0: 125 * p, f1: 52 * p, peak: 0.24, d: 0.07, drop: 0.045 });
      g.finish();
    },
  },

  'combat.rail.charge': {
    limit: 2,
    gap: 0.1,
    fn(g, o) {
      const t = g.t;
      const dur = Math.max(0.15, num(o.duration, 0.42));
      const lp = g.filter('lowpass', 1600, 0.9);
      sweep(lp.frequency, 500, 2200, t, dur);
      const amp = g.gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.16, t + dur * 0.9);
      amp.gain.linearRampToValueAtTime(0.0001, t + dur + 0.08);
      lp.connect(amp).connect(g.out);
      const a = g.osc('hum', 170);
      sweep(a.frequency, 170, 540, t, dur);
      const b = g.osc('sine', 340);
      sweep(b.frequency, 340, 1080, t, dur);
      const bg = g.gain(0.35);
      a.connect(lp);
      b.connect(bg).connect(lp);
      g.play(a, t, t + dur + 0.1);
      g.play(b, t, t + dur + 0.1);
      whoosh(g, g.out, t, { kind: 'pink', f: 300, f1: 1400, Q: 1.4, peak: 0.07, a: dur * 0.85, r: 0.12 });
      g.finish();
    },
  },

  'combat.rail': {
    limit: 3,
    gap: 0.1,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1);
      thump(g, g.out, t, { f0: 95 * p, f1: 32 * p, peak: 0.5, d: 0.38, drop: 0.22 });
      burst(g, g.out, t, { f: 1800 * p, f1: 420 * p, Q: 0.9, peak: 0.2, a: 0.001, d: 0.2, sweepDur: 0.2 });
      tone(g, g.out, t, 880 * p, { type: 'warm', f1: 110 * p, sweepDur: 0.24, peak: 0.16, a: 0.002, d: 0.26, lp: 2400 });
      const n = g.noise('brown');
      const lp = g.filter('lowpass', 420, 0.7);
      const amp = g.gain(0);
      perc(amp.gain, t + 0.02, 0.32, 0.01, 0.7);
      n.connect(lp).connect(amp).connect(g.out);
      g.play(n, t, t + 0.8);
      g.finish();
    },
  },

  'combat.reload': {
    limit: 2,
    gap: 0.2,
    fn(g, o) {
      const t = g.t;
      const dur = Math.max(0.6, num(o.duration, 1.4));
      // eject cell: click + low slide
      burst(g, g.out, t, { f: 2100, Q: 2.2, peak: 0.1, a: 0.001, d: 0.012 });
      burst(g, g.out, t + 0.02, { kind: 'pink', f: 700, Q: 1.2, peak: 0.08, a: 0.01, d: 0.12 });
      // insert cell (≈ 55 %): clack
      const t2 = t + dur * 0.55;
      burst(g, g.out, t2, { f: 1700, Q: 2, peak: 0.12, a: 0.001, d: 0.015 });
      thump(g, g.out, t2, { f0: 260, f1: 120, peak: 0.16, d: 0.06, drop: 0.03 });
      // energise: soft rising hum, then the lock click
      const t3 = t + dur * 0.7;
      tone(g, g.out, t3, 210, { type: 'hum', f1: 430, sweepDur: dur * 0.25, peak: 0.07, a: 0.04, d: dur * 0.25, lp: 1400 });
      burst(g, g.out, t + dur * 0.96, { f: 2400, Q: 2.5, peak: 0.09, a: 0.001, d: 0.01 });
      thump(g, g.out, t + dur * 0.96, { f0: 320, f1: 160, peak: 0.1, d: 0.04, drop: 0.02 });
      g.finish();
    },
  },

  'combat.empty': {
    limit: 1,
    gap: 0.12,
    fn(g) {
      const t = g.t;
      burst(g, g.out, t, { f: 1900, Q: 3, peak: 0.08, a: 0.001, d: 0.012 });
      thump(g, g.out, t, { f0: 420, f1: 260, peak: 0.06, d: 0.03, drop: 0.02 });
      g.finish();
    },
  },

  'combat.switch': {
    limit: 1,
    gap: 0.08,
    fn(g) {
      const t = g.t;
      burst(g, g.out, t, { kind: 'pink', f: 900, Q: 1.3, peak: 0.07, a: 0.01, d: 0.08 });
      burst(g, g.out, t + 0.07, { f: 2000, Q: 2.4, peak: 0.07, a: 0.001, d: 0.012 });
      tone(g, g.out, t + 0.08, 330, { type: 'hum', f1: 520, sweepDur: 0.12, peak: 0.05, a: 0.02, d: 0.14, lp: 1200 });
      g.finish();
    },
  },

  'combat.hit': {
    limit: 3,
    gap: 0.035,
    fn(g, o) {
      const t = g.t;
      if (o.kill) {
        bell(g, g.out, t, 784, { peak: 0.09, decay: 0.35, ratio: 2, index: 0.8, partial: 0.1 });
        bell(g, g.out, t + 0.07, 1175, { peak: 0.07, decay: 0.45, ratio: 2, index: 0.8, partial: 0.1 });
        thump(g, g.out, t, { f0: 180, f1: 90, peak: 0.12, d: 0.08 });
      } else if (o.crit) {
        tone(g, g.out, t, 1320, { type: 'soft', peak: 0.09, a: 0.001, d: 0.06, lp: 2600 });
        tone(g, g.out, t + 0.03, 990, { type: 'soft', peak: 0.07, a: 0.001, d: 0.08, lp: 2200 });
      } else {
        tone(g, g.out, t, 1050, { type: 'soft', peak: 0.075, a: 0.001, d: 0.045, lp: 2200 });
        burst(g, g.out, t, { f: 1800, Q: 2, peak: 0.03, a: 0.001, d: 0.012 });
      }
      g.finish();
    },
  },

  'combat.hurt': {
    limit: 2,
    gap: 0.08,
    fn(g, o) {
      const t = g.t;
      const k = Math.max(0.4, Math.min(1.4, num(o.amount, 10) / 12));
      thump(g, g.out, t, { f0: 120, f1: 48, peak: 0.34 * k, d: 0.16, drop: 0.09 });
      burst(g, g.out, t, { kind: 'pink', type: 'lowpass', f: 520, Q: 0.8, peak: 0.12 * k, a: 0.003, d: 0.14 });
      if (o.shield) tone(g, g.out, t, 640, { type: 'soft', f1: 380, sweepDur: 0.12, peak: 0.05, a: 0.002, d: 0.14, lp: 1600 });
      g.finish();
    },
  },

  'combat.shield.break': {
    limit: 1,
    gap: 0.3,
    fn(g) {
      const t = g.t;
      tone(g, g.out, t, 880, { type: 'glass', f1: 300, sweepDur: 0.35, peak: 0.1, a: 0.002, d: 0.4, lp: 2400 });
      burst(g, g.out, t, { f: 1500, f1: 600, Q: 1.2, peak: 0.12, a: 0.001, d: 0.25 });
      thump(g, g.out, t, { f0: 160, f1: 60, peak: 0.2, d: 0.14 });
      g.finish();
    },
  },

  'combat.heartbeat': {
    limit: 1,
    gap: 0.4,
    fn(g, o) {
      const t = g.t;
      const k = num(o.intensity, 1);
      thump(g, g.out, t, { f0: 70, f1: 42, peak: 0.34 * k, d: 0.12, drop: 0.06 });
      thump(g, g.out, t + 0.2, { f0: 62, f1: 38, peak: 0.24 * k, d: 0.14, drop: 0.07 });
      g.finish();
    },
  },

  'combat.drone.laser': {
    limit: 5,
    gap: 0.04,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.94, 1.06);
      const lp = g.filter('lowpass', 2000, 0.8);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.22, 0.003, 0.16);
      lp.connect(amp).connect(g.out);
      const a = g.osc('warm', 940 * p);
      sweep(a.frequency, 940 * p, 280 * p, t, 0.15);
      const b = g.osc('sine', 470 * p);
      sweep(b.frequency, 470 * p, 140 * p, t, 0.15);
      const bg = g.gain(0.5);
      a.connect(lp);
      b.connect(bg).connect(lp);
      g.play(a, t, t + 0.2);
      g.play(b, t, t + 0.2);
      thump(g, g.out, t, { f0: 200, f1: 100, peak: 0.08, d: 0.05 });
      g.finish();
    },
  },

  'combat.stalker': {
    limit: 2,
    gap: 0.35,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.88, 1.12);
      const dur = 0.85;
      // growl-screech: a warm saw through a moving vocal formant (no hiss above ~2.6 kHz)
      const src = g.osc('warm', 210 * p);
      src.frequency.setValueAtTime(190 * p, t);
      src.frequency.linearRampToValueAtTime(380 * p, t + 0.18);
      src.frequency.exponentialRampToValueAtTime(230 * p, t + dur);
      g.lfo(src.frequency, 17, 22 * p, 'sine', t, t + dur);
      const f1 = g.filter('bandpass', 700, 3.2);
      sweep(f1.frequency, 600, 1250, t, 0.2);
      const f2 = g.filter('bandpass', 1600, 4);
      const lp = g.filter('lowpass', 2600, 0.7);
      const sat = g.shaper(2.2);
      const amp = g.gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.3, t + 0.06);
      amp.gain.linearRampToValueAtTime(0.22, t + 0.3);
      amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
      const f2g = g.gain(0.45);
      src.connect(f1).connect(sat);
      src.connect(f2).connect(f2g).connect(sat);
      sat.connect(lp).connect(amp).connect(g.out);
      g.play(src, t, t + dur + 0.05);
      burst(g, g.out, t, { kind: 'pink', f: 1100, Q: 1.4, peak: 0.07, a: 0.04, d: 0.5 });
      thump(g, g.out, t, { f0: 90, f1: 55, peak: 0.16, d: 0.3, drop: 0.2 });
      g.finish();
    },
  },

  'combat.stalker.die': {
    limit: 2,
    gap: 0.2,
    fn(g, o) {
      const t = g.t;
      const p = num(o.pitch, 1) * rand(0.9, 1.08);
      const src = g.osc('warm', 300 * p);
      sweep(src.frequency, 300 * p, 70 * p, t, 0.9);
      g.lfo(src.frequency, 11, 14, 'sine', t, t + 1);
      const f1 = g.filter('bandpass', 800, 2.4);
      sweep(f1.frequency, 900, 350, t, 0.9);
      const lp = g.filter('lowpass', 2000, 0.7);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.26, 0.03, 0.95);
      src.connect(f1).connect(lp).connect(amp).connect(g.out);
      g.play(src, t, t + 1.05);
      burst(g, g.out, t + 0.05, { kind: 'pink', type: 'lowpass', f: 600, Q: 0.7, peak: 0.1, a: 0.05, d: 0.6 });
      thump(g, g.out, t + 0.5, { f0: 110, f1: 45, peak: 0.22, d: 0.2 });
      g.finish();
    },
  },

  'combat.claw': {
    limit: 2,
    gap: 0.15,
    fn(g) {
      const t = g.t;
      whoosh(g, g.out, t, { kind: 'pink', f: 500, f1: 1700, Q: 1.3, peak: 0.16, a: 0.08, r: 0.14 });
      burst(g, g.out, t + 0.1, { f: 1300, Q: 1.6, peak: 0.08, a: 0.002, d: 0.05 });
      g.finish();
    },
  },

  'combat.throw': {
    limit: 1,
    gap: 0.2,
    fn(g) {
      const t = g.t;
      whoosh(g, g.out, t, { kind: 'pink', f: 380, f1: 1200, Q: 1.1, peak: 0.13, a: 0.07, r: 0.18 });
      g.finish();
    },
  },

  'combat.grenade.bounce': {
    limit: 3,
    gap: 0.06,
    fn(g, o) {
      const t = g.t;
      const k = Math.max(0.3, Math.min(1, num(o.strength, 1)));
      tone(g, g.out, t, 1240, { type: 'glass', peak: 0.06 * k, a: 0.001, d: 0.08, lp: 2600 });
      thump(g, g.out, t, { f0: 340, f1: 180, peak: 0.12 * k, d: 0.05, drop: 0.03 });
      burst(g, g.out, t, { f: 2000, Q: 2, peak: 0.04 * k, a: 0.001, d: 0.015 });
      g.finish();
    },
  },

  'combat.grenade.boom': {
    limit: 3,
    gap: 0.05,
    fn(g) {
      const t = g.t;
      const bus = g.gain(0.8);
      bus.connect(g.out);
      thump(g, bus, t, { f0: 85, f1: 30, peak: 0.5, d: 0.6, drop: 0.3 });
      // electric crack: FM zap with a tremolo, low-passed
      const z = g.osc('bright', 220);
      z.frequency.setValueAtTime(220, t);
      z.frequency.exponentialRampToValueAtTime(1100, t + 0.04);
      z.frequency.exponentialRampToValueAtTime(260, t + 0.4);
      const zl = g.filter('lowpass', 2400, 0.8);
      const trem = g.gain(0.6);
      g.lfo(trem.gain, 38, 0.4, 'square', t, t + 0.45);
      const za = g.gain(0);
      perc(za.gain, t, 0.16, 0.002, 0.42);
      z.connect(zl).connect(trem).connect(za).connect(bus);
      g.play(z, t, t + 0.5);
      const n = g.noise('white');
      const lp = g.filter('lowpass', 2600, 0.7);
      sweep(lp.frequency, 2600, 180, t, 0.7);
      const na = g.gain(0);
      perc(na.gain, t, 0.3, 0.004, 0.75);
      n.connect(lp).connect(na).connect(bus);
      g.play(n, t, t + 0.8);
      for (let i = 0; i < 6; i++) burst(g, bus, t + 0.04 + Math.random() * 0.4, { f: rand(900, 2200), Q: rand(1.5, 3), peak: rand(0.04, 0.08), a: 0.001, d: rand(0.015, 0.04), pan: rand(-0.5, 0.5) });
      g.finish();
    },
  },

  'combat.boom': {
    limit: 4,
    gap: 0.05,
    fn(g, o) {
      const t = g.t;
      const size = Math.max(0.4, Math.min(1.6, num(o.size, 1)));
      const dur = 0.8 + size * 0.6;
      const bus = g.gain(0.75);
      bus.connect(g.out);
      thump(g, bus, t, { f0: 75, f1: 28, peak: 0.48, d: dur * 0.6, drop: 0.3 });
      thump(g, bus, t, { f0: 140, f1: 60, peak: 0.28, d: 0.35, drop: 0.1 });
      const n1 = g.noise('brown');
      const n2 = g.noise('white');
      const n2g = g.gain(0.2);
      const lp = g.filter('lowpass', 2500, 0.7);
      sweep(lp.frequency, 2500, 160, t, dur * 0.8);
      const sat = g.shaper(1.8);
      const amp = g.gain(0);
      perc(amp.gain, t, 0.48, 0.006, dur);
      n1.connect(lp);
      n2.connect(n2g).connect(lp);
      lp.connect(sat).connect(amp).connect(bus);
      g.play(n1, t, t + dur + 0.05);
      g.play(n2, t, t + dur + 0.05);
      for (let i = 0; i < 5; i++) burst(g, bus, t + 0.05 + Math.random() * 0.6, { f: rand(700, 2400), Q: rand(1, 3), peak: rand(0.04, 0.09), a: 0.001, d: rand(0.02, 0.06), pan: rand(-0.5, 0.5) });
      g.finish();
    },
  },

  'combat.dodge': {
    limit: 1,
    gap: 0.2,
    fn(g) {
      const t = g.t;
      whoosh(g, g.out, t, { kind: 'pink', f: 320, f1: 1100, Q: 1, peak: 0.16, a: 0.08, r: 0.26 });
      burst(g, g.out, t + 0.3, { kind: 'pink', type: 'lowpass', f: 500, Q: 0.7, peak: 0.07, a: 0.01, d: 0.12 });
      g.finish();
    },
  },

  // leaving the hub's safe zone: two low, soft alert tones (not an alarm)
  'combat.zone.leave': {
    limit: 1,
    gap: 1.5,
    fn(g) {
      const t = g.t;
      tone(g, g.out, t, 392, { type: 'warm', peak: 0.07, a: 0.02, d: 0.28, lp: 1500 });
      tone(g, g.out, t + 0.16, 294, { type: 'warm', peak: 0.08, a: 0.02, d: 0.42, lp: 1300 });
      thump(g, g.out, t, { f0: 120, f1: 70, peak: 0.08, d: 0.18 });
      g.finish();
    },
  },

  'combat.death': {
    limit: 1,
    gap: 1,
    fn(g) {
      const t = g.t;
      tone(g, g.out, t, 330, { type: 'warm', f1: 98, sweepDur: 1.6, peak: 0.16, a: 0.02, d: 1.7, lp: 1100 });
      tone(g, g.out, t, 165, { type: 'hum', f1: 55, sweepDur: 1.8, peak: 0.14, a: 0.05, d: 1.9, lp: 600 });
      thump(g, g.out, t, { f0: 90, f1: 35, peak: 0.4, d: 0.5, drop: 0.3 });
      whoosh(g, g.out, t + 0.1, { kind: 'pink', type: 'lowpass', f: 900, f1: 200, Q: 0.7, peak: 0.1, a: 0.3, r: 1.2 });
      g.finish();
    },
  },

  'combat.respawn': {
    limit: 1,
    gap: 1,
    fn(g) {
      const t = g.t;
      whoosh(g, g.out, t, { kind: 'pink', f: 250, f1: 1600, Q: 1, peak: 0.12, a: 0.5, r: 0.5 });
      bell(g, g.out, t + 0.35, 523.25, { peak: 0.07, decay: 1.2, ratio: 3, index: 1.2 });
      bell(g, g.out, t + 0.5, 783.99, { peak: 0.06, decay: 1.2, ratio: 3, index: 1.2 });
      bell(g, g.out, t + 0.65, 1046.5, { peak: 0.05, decay: 1.4, ratio: 3, index: 1 });
      g.finish();
    },
  },
};

/** Registers every recipe on ctx.audio with a per-name voice limit + minimum gap. */
export function registerCombatSounds(ctx) {
  const audio = ctx.audio;
  if (!audio?.register) return [];
  const names = [];
  for (const [name, spec] of Object.entries(COMBAT_SOUNDS)) {
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
