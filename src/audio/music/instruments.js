/**
 * Music instruments. Every note is its own short-lived Graph that cleans up
 * after its release (stats.notes counts the live ones), scheduled at an exact
 * AudioContext time:
 *   padChord   warm detuned-wave chord, slow filter + amp swell, stereo
 *   bellNote   FM bell / celesta / glass
 *   pluck      bright pluck with a closing filter (arpeggios)
 *   bassNote   round bass with a 2nd harmonic (audible on laptop speakers)
 *   leadNote   soft flute/ocarina lead with delayed vibrato and breath
 *   choir      "aah" voices: detuned waves through vowel formants
 *   kick / clap / hat  soft festival percussion
 *   riser      filtered-noise swell into a section change
 */
import { Graph, mtof, perc, rand } from '../lib/dsp.js';
import { bell } from '../lib/voices.js';

export const stats = { notes: 0, created: 0 };

function note(ac, dest) {
  const g = new Graph(ac, dest);
  stats.notes++;
  stats.created++;
  g.onDispose = () => {
    stats.notes--;
  };
  return g;
}

export function padChord(ac, dest, t, dur, notes, { attack = 2.5, release = 3, cutoff = 1400, peak = 0.05, wave = 'warm', detune = 8, spread = 0.65 } = {}) {
  const g = note(ac, dest);
  const L = g.pan(-spread);
  const R = g.pan(spread);
  const lp = g.filter('lowpass', cutoff * 0.45, 0.6);
  const vca = g.gain(0);
  lp.frequency.setValueAtTime(cutoff * 0.45, t);
  lp.frequency.setTargetAtTime(cutoff, t, attack / 2.5);
  lp.frequency.setTargetAtTime(cutoff * 0.55, t + dur, release / 2.5);
  vca.gain.setValueAtTime(0, t);
  vca.gain.setTargetAtTime(peak, t, attack / 3);
  vca.gain.setTargetAtTime(0, t + dur, release / 4);
  L.connect(lp);
  R.connect(lp);
  lp.connect(vca).connect(dest);
  const end = t + dur + release * 1.6;
  for (const m of notes) {
    const f = mtof(m);
    const a = g.osc(wave, f, -detune + rand(-2, 2));
    const b = g.osc(wave, f, detune + rand(-2, 2));
    a.connect(L);
    b.connect(R);
    g.play(a, t, end);
    g.play(b, t, end);
  }
  g.finish();
  return end;
}

export function bellNote(ac, dest, t, midi, { peak = 0.06, decay = 2.2, ratio = 3.5, index = 1.4, pan = 0, partial = 0.15 } = {}) {
  const g = note(ac, dest);
  const end = bell(g, dest, t, mtof(midi), { peak, decay, ratio, index, pan, partial });
  g.finish();
  return end;
}

export function pluck(ac, dest, t, midi, { peak = 0.05, decay = 0.7, bright = 6, pan = 0, wave = 'bright' } = {}) {
  // spectral decay without filter automation: a bright layer that dies fast
  // over a mellow layer that rings (cheap: no per-note biquad)
  const g = note(ac, dest);
  const f = mtof(midi);
  const hi = g.osc(wave, f);
  const lo = g.osc('soft', f, 4);
  const oct = g.osc('sine', f * 2, -3);
  const hiG = g.gain(0);
  const loG = g.gain(0);
  const octG = g.gain(0);
  const k = Math.min(1, bright / 6);
  perc(hiG.gain, t, peak * 0.55 * k, 0.002, Math.min(decay, 0.09 + decay * 0.12));
  perc(loG.gain, t, peak, 0.004, decay);
  perc(octG.gain, t, peak * 0.18, 0.003, decay * 0.5);
  const pn = g.pan(pan);
  hi.connect(hiG).connect(pn);
  lo.connect(loG).connect(pn);
  oct.connect(octG).connect(pn);
  pn.connect(dest);
  const end = t + decay + 0.02;
  g.play(hi, t, end);
  g.play(lo, t, end);
  g.play(oct, t, end);
  g.finish();
  return end;
}

export function bassNote(ac, dest, t, dur, midi, { peak = 0.16, attack = 0.06, release = 0.5, cutoff = 420, decayTo = 0.8 } = {}) {
  const g = note(ac, dest);
  const f = mtof(midi);
  const o1 = g.osc('sine', f);
  const o2 = g.osc('soft', f, 3);
  const o3 = g.osc('sine', f * 2);
  const o2g = g.gain(0.45);
  const o3g = g.gain(0.22);
  const lp = g.filter('lowpass', cutoff, 0.7);
  const vca = g.gain(0);
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(peak, t + attack);
  vca.gain.setTargetAtTime(peak * decayTo, t + attack, Math.max(0.05, dur * 0.3));
  vca.gain.setTargetAtTime(0, t + dur, release / 4);
  o1.connect(lp);
  o2.connect(o2g).connect(lp);
  o3.connect(o3g).connect(lp);
  lp.connect(vca).connect(dest);
  const end = t + dur + release * 1.5;
  g.play(o1, t, end);
  g.play(o2, t, end);
  g.play(o3, t, end);
  g.finish();
  return end;
}

export function leadNote(ac, dest, t, dur, midi, { peak = 0.06, attack = 0.09, release = 0.4, vibrato = 1, pan = 0, cutoff = 2600, wave = 'organ' } = {}) {
  const g = note(ac, dest);
  const f = mtof(midi);
  const o = g.osc(wave, f);
  const o2 = g.osc('sine', f, 6);
  const o2g = g.gain(0.35);
  // delayed vibrato
  const vib = g.osc('sine', 5.2);
  const vibG = g.gain(0);
  vibG.gain.setValueAtTime(0, t);
  vibG.gain.setTargetAtTime(f * 0.0045 * vibrato, t + Math.min(0.35, dur * 0.5), 0.25);
  vib.connect(vibG);
  vibG.connect(o.frequency);
  vibG.connect(o2.frequency);
  // breath
  const n = g.noise('white');
  const nb = g.filter('bandpass', f * 2, 3);
  const ng = g.gain(0.08);
  const lp = g.filter('lowpass', cutoff, 0.6);
  const vca = g.gain(0);
  vca.gain.setValueAtTime(0, t);
  vca.gain.setTargetAtTime(peak, t, attack / 3);
  vca.gain.setTargetAtTime(peak * 0.85, t + attack, 0.4);
  vca.gain.setTargetAtTime(0, t + dur, release / 4);
  const pn = g.pan(pan);
  o.connect(lp);
  o2.connect(o2g).connect(lp);
  n.connect(nb).connect(ng).connect(lp);
  lp.connect(vca).connect(pn).connect(dest);
  const end = t + dur + release * 1.6;
  for (const s of [o, o2, vib, n]) g.play(s, t, end);
  g.finish();
  return end;
}

const FORMANTS = { a: [730, 1090, 2440], o: [570, 840, 2410], u: [300, 870, 2240], e: [530, 1840, 2480] };

export function choir(ac, dest, t, dur, notes, { peak = 0.03, attack = 1.6, release = 2.2, vowel = 'a', spread = 0.5 } = {}) {
  const g = note(ac, dest);
  const [F1, F2, F3] = FORMANTS[vowel] || FORMANTS.a;
  const sum = g.gain(1);
  const b1 = g.filter('bandpass', F1, 5);
  const b2 = g.filter('bandpass', F2, 7);
  const b3 = g.filter('bandpass', F3, 9);
  const g2 = g.gain(0.55);
  const g3 = g.gain(0.22);
  sum.connect(b1);
  sum.connect(b2).connect(g2);
  sum.connect(b3).connect(g3);
  const vca = g.gain(0);
  b1.connect(vca);
  g2.connect(vca);
  g3.connect(vca);
  vca.gain.setValueAtTime(0, t);
  vca.gain.setTargetAtTime(peak, t, attack / 3);
  vca.gain.setTargetAtTime(0, t + dur, release / 4);
  vca.connect(dest);
  const end = t + dur + release * 1.6;
  const vib = g.osc('sine', 4.8);
  const vibG = g.gain(7);
  vib.connect(vibG);
  g.play(vib, t, end);
  notes.forEach((m, i) => {
    for (const d of [-9, 9]) {
      const o = g.osc('warm', mtof(m), d + rand(-3, 3));
      vibG.connect(o.detune);
      const pn = g.pan(((i % 2 ? 1 : -1) * spread * (0.5 + Math.random() * 0.5)) * (d < 0 ? 1 : -1));
      o.connect(pn).connect(sum);
      g.play(o, t, end);
    }
  });
  g.finish();
  return end;
}

export function kick(ac, dest, t, { peak = 0.32 } = {}) {
  const g = note(ac, dest);
  const o = g.osc('sine', 120);
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.08);
  const vca = g.gain(0);
  perc(vca.gain, t, peak, 0.002, 0.3);
  o.connect(vca).connect(dest);
  const c = g.osc('triangle', 2400);
  const cg = g.gain(0);
  perc(cg.gain, t, peak * 0.05, 0.001, 0.008);
  c.connect(cg).connect(dest);
  g.play(o, t, t + 0.34);
  g.play(c, t, t + 0.03);
  g.finish();
}

export function clap(ac, dest, t, { peak = 0.1, pan = 0 } = {}) {
  const g = note(ac, dest);
  const n = g.noise('white');
  const bp = g.filter('bandpass', 1400, 0.9);
  const vca = g.gain(0);
  vca.gain.setValueAtTime(0, t);
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.011;
    vca.gain.setValueAtTime(peak, tt);
    vca.gain.exponentialRampToValueAtTime(peak * 0.2, tt + 0.009);
  }
  vca.gain.setValueAtTime(peak * 0.7, t + 0.034);
  vca.gain.exponentialRampToValueAtTime(1e-4, t + 0.2);
  const pn = g.pan(pan);
  n.connect(bp).connect(vca).connect(pn).connect(dest);
  g.play(n, t, t + 0.22);
  g.finish();
}

export function hat(ac, dest, t, { peak = 0.025, open = false, pan = 0.2 } = {}) {
  const g = note(ac, dest);
  const n = g.noise('white');
  const hp = g.filter('highpass', 7200, 0.7);
  const vca = g.gain(0);
  const d = open ? 0.22 : 0.045;
  perc(vca.gain, t, peak, 0.001, d);
  const pn = g.pan(pan);
  n.connect(hp).connect(vca).connect(pn).connect(dest);
  g.play(n, t, t + d + 0.02);
  g.finish();
}

export function riser(ac, dest, t, dur, { peak = 0.03, from = 400, to = 5000 } = {}) {
  const g = note(ac, dest);
  const n = g.noise('pink');
  const bp = g.filter('bandpass', from, 1.4);
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const vca = g.gain(0);
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(peak, t + dur);
  vca.gain.linearRampToValueAtTime(0, t + dur + 0.08);
  n.connect(bp).connect(vca).connect(dest);
  g.play(n, t, t + dur + 0.1);
  g.finish();
}
