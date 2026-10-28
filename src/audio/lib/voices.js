/**
 * Small reusable sound "voices" built on a Graph: FM bells, tones with pitch
 * sweeps, filtered noise bursts, sine thumps, chirps. Every helper schedules
 * its sources with stop times (so Graph.finish() can clean up) and returns the
 * time at which it has fully decayed.
 */
import { perc, sweep } from './dsp.js';

/** FM bell / chime (carrier + modulator with decaying index + inharmonic shimmer). */
export function bell(g, dest, t, f, { peak = 0.2, decay = 1.2, ratio = 3.5, index = 2.2, pan = 0, partial = 0.22, attack = 0.003 } = {}) {
  const car = g.osc('sine', f);
  const mod = g.osc('sine', f * ratio);
  const mg = g.gain(0);
  mg.gain.setValueAtTime(f * index, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(0.5, f * index * 0.03), t + decay * 0.55);
  mod.connect(mg).connect(car.frequency);
  const amp = g.gain(0);
  perc(amp.gain, t, peak, attack, decay);
  const pn = pan ? g.pan(pan) : null;
  const o = pn || dest;
  car.connect(amp).connect(o);
  let end = t + attack + decay + 0.02;
  if (partial > 0) {
    const sh = g.osc('sine', f * 2.756);
    const shg = g.gain(0);
    perc(shg.gain, t, peak * partial, 0.002, decay * 0.32);
    sh.connect(shg).connect(o);
    g.play(sh, t, end);
  }
  if (pn) pn.connect(dest);
  g.play(car, t, end);
  g.play(mod, t, end);
  return end;
}

/** Plain tone with optional exponential pitch sweep and percussive envelope. */
export function tone(g, dest, t, f, { type = 'sine', peak = 0.3, a = 0.004, d = 0.2, f1 = null, sweepDur = null, pan = 0, detune = 0, lp = null } = {}) {
  const o = g.osc(type, f, detune);
  if (f1 != null) sweep(o.frequency, f, f1, t, sweepDur ?? a + d);
  const amp = g.gain(0);
  perc(amp.gain, t, peak, a, d);
  let n = o;
  if (lp) {
    const fl = g.filter('lowpass', lp, 0.7);
    n.connect(fl);
    n = fl;
  }
  n.connect(amp);
  if (pan) amp.connect(g.pan(pan)).connect(dest);
  else amp.connect(dest);
  const end = t + a + d + 0.02;
  g.play(o, t, end);
  return end;
}

/** Filtered noise burst with an optional filter sweep. */
export function burst(g, dest, t, { kind = 'white', type = 'bandpass', f = 1200, f1 = null, Q = 1, peak = 0.3, a = 0.002, d = 0.1, pan = 0, rate = 1, sweepDur = null } = {}) {
  const n = g.noise(kind, rate);
  const fl = g.filter(type, f, Q);
  if (f1 != null) sweep(fl.frequency, f, f1, t, sweepDur ?? a + d);
  const amp = g.gain(0);
  perc(amp.gain, t, peak, a, d);
  n.connect(fl).connect(amp);
  if (pan) amp.connect(g.pan(pan)).connect(dest);
  else amp.connect(dest);
  const end = t + a + d + 0.02;
  g.play(n, t, end);
  return end;
}

/** Noise swell (attack → release), e.g. whooshes. */
export function whoosh(g, dest, t, { kind = 'pink', f = 600, f1 = 2400, Q = 1.2, peak = 0.25, a = 0.18, r = 0.3, pan = 0, type = 'bandpass' } = {}) {
  const n = g.noise(kind);
  const fl = g.filter(type, f, Q);
  sweep(fl.frequency, f, f1, t, a + r * 0.6);
  const amp = g.gain(0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + a);
  amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak * 1e-3), t + a + r);
  amp.gain.setValueAtTime(0, t + a + r + 0.001);
  n.connect(fl).connect(amp);
  if (pan) amp.connect(g.pan(pan)).connect(dest);
  else amp.connect(dest);
  const end = t + a + r + 0.02;
  g.play(n, t, end);
  return end;
}

/** Sine "kick"/thump with a pitch drop. */
export function thump(g, dest, t, { f0 = 140, f1 = 48, peak = 0.5, d = 0.2, drop = 0.06 } = {}) {
  const o = g.osc('sine', f0);
  sweep(o.frequency, f0, f1, t, drop);
  const amp = g.gain(0);
  perc(amp.gain, t, peak, 0.002, d);
  o.connect(amp).connect(dest);
  const end = t + d + 0.03;
  g.play(o, t, end);
  return end;
}

/** Bird-like chirp: fast pitch sweep with a soft envelope. */
export function chirp(g, dest, t, f0, f1, dur, { peak = 0.1, pan = 0, type = 'sine' } = {}) {
  const o = g.osc(type, f0);
  sweep(o.frequency, f0, f1, t, dur);
  const amp = g.gain(0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + dur * 0.25);
  amp.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(amp);
  if (pan) amp.connect(g.pan(pan)).connect(dest);
  else amp.connect(dest);
  g.play(o, t, t + dur + 0.01);
  return t + dur + 0.01;
}

/** Simple feedback echo (returns its input node); `wet` level, `time` s, `fb` feedback. */
export function echo(g, dest, { time = 0.22, fb = 0.35, wet = 0.3, lp = 3200 } = {}) {
  const input = g.gain(1);
  const d = g.delay(time, 2);
  const f = g.gain(fb);
  const tone = g.filter('lowpass', lp, 0.5);
  const w = g.gain(wet);
  input.connect(d);
  d.connect(tone).connect(f).connect(d);
  tone.connect(w).connect(dest);
  return input;
}
