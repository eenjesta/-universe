/**
 * The four generative pieces. Harmony is fixed per piece (warm, hopeful
 * extended chords); everything else — form variations, arpeggio patterns,
 * bell placement, melodic phrases — is chosen as the music plays.
 *
 *   TitlePiece     "A Brighter Tomorrow": D major, 60 BPM, 8-chord cycle with
 *                  a written theme (lead + bells), arps, choir lift, breathing cycle
 *   ExplorePiece   E major, 72 BPM by day (pastoral arps, flute phrases) and
 *                  64 BPM at night (minor-leaning, sparse bells); rests between rounds
 *   SpacePiece     C lydian over a pedal, 54 BPM, slow pads, glass bells, star runs
 *   FestivalPiece  G major anthem (vi–IV–I–V), 108 BPM, soft four-on-the-floor,
 *                  bass line, 16th arps and a hook for the Starfall festival
 */
import { rand, pickOne } from '../lib/dsp.js';
import { Piece } from './composer.js';
import { padChord, bellNote, pluck, bassNote, leadNote, choir, kick, clap, hat, riser } from './instruments.js';

const hum = (t) => t + rand(-0.006, 0.008);

/** Nearest entry of `list` to midi `m`. */
function nearest(list, m) {
  let best = list[0];
  for (const x of list) if (Math.abs(x - m) < Math.abs(best - m)) best = x;
  return best;
}

/** Generates a melodic phrase over one chord: [[stepOffset, midi, durSteps], …]. */
function phrase(scale, chordTones, last, rhythm) {
  const out = [];
  let i = scale.indexOf(nearest(scale, last));
  const dir = Math.random() < 0.5 ? -1 : 1;
  rhythm.forEach(([s, d], k) => {
    const move = pickOne([0, 1, 1, 2, -1, 1]) * (Math.random() < 0.7 ? dir : -dir);
    i = Math.max(0, Math.min(scale.length - 1, i + move));
    let m = scale[i];
    if (k === rhythm.length - 1 || d >= 4) m = nearest(chordTones.flatMap((x) => [x, x + 12, x - 12]).filter((x) => x >= scale[0] && x <= scale[scale.length - 1]), m);
    out.push([s, m, d]);
  });
  return out;
}

// =================================================================== title
const TITLE = [
  { pad: [50, 57, 61, 64, 66], bass: 38, tones: [62, 66, 69, 73, 76] }, // Dmaj9
  { pad: [54, 57, 61, 62, 66], bass: 47, tones: [59, 62, 66, 69, 73] }, // Bm9
  { pad: [55, 59, 62, 66, 69], bass: 43, tones: [67, 71, 74, 78, 81] }, // Gmaj9
  { pad: [52, 57, 59, 64, 69], bass: 45, tones: [64, 69, 71, 76, 81] }, // Asus2
  { pad: [54, 57, 61, 64, 69], bass: 42, tones: [61, 64, 66, 69, 73] }, // F#m7
  { pad: [55, 59, 62, 66, 71], bass: 43, tones: [67, 71, 74, 78, 83] }, // Gmaj7
  { pad: [52, 55, 59, 62, 66], bass: 40, tones: [64, 67, 71, 74, 78] }, // Em9
  { pad: [52, 57, 61, 64, 69], bass: 45, tones: [64, 69, 73, 76, 81] }, // A
];
// [beat, midi, beats] over the 64-beat cycle
const THEME = [
  [0, 69, 1], [1, 74, 1], [2, 76, 2], [4, 78, 2], [6, 76, 1], [7, 74, 1],
  [8, 73, 3], [11, 71, 1], [12, 69, 4],
  [16, 71, 1], [17, 74, 1], [18, 76, 2], [20, 74, 2], [22, 71, 1], [23, 69, 1],
  [24, 69, 6],
  [32, 73, 2], [34, 76, 2], [36, 78, 3], [39, 76, 1],
  [40, 74, 3], [43, 71, 1], [44, 74, 4],
  [48, 71, 2], [50, 74, 2], [52, 78, 2], [54, 76, 2],
  [56, 76, 2], [58, 73, 2], [60, 74, 4],
];
const THEME_AT = new Map(THEME.map((n) => [n[0] * 2, n]));
const ARPS = [
  [0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 4, 2, 1, 3, 4, 3],
  [0, 2, 1, 3, 2, 4, 3, 1],
  [4, 3, 2, 1, 0, 1, 2, 3],
];
const TITLE_FORM = ['intro', 'theme', 'arp', 'full', 'breathe'];

export class TitlePiece extends Piece {
  constructor(ac, bus, opts = {}) {
    super(ac, bus, { bpm: 60, stepsPerBeat: 2, ...opts });
    this.arp = ARPS[0];
  }

  section(cycle) {
    return cycle < TITLE_FORM.length ? TITLE_FORM[cycle] : TITLE_FORM[1 + ((cycle - 1) % 4)];
  }

  onStep(step, t) {
    const ac = this.ac;
    const b = this.b;
    const spc = 16; // steps per chord (2 bars)
    const inCycle = step % (spc * 8);
    const cycle = Math.floor(step / (spc * 8));
    const ci = Math.floor(inCycle / spc);
    const sic = inCycle % spc;
    const sec = this.section(cycle);
    const ch = TITLE[ci];
    const beat = this.stepDur * 2;
    const chordDur = spc * this.stepDur;
    if (inCycle === 0) this.arp = pickOne(ARPS);
    if (sic === 0) {
      const breathe = sec === 'breathe';
      padChord(ac, b.pad, t, chordDur, ch.pad, { attack: step === 0 ? 4 : 2.2, release: 3.6, cutoff: breathe ? 950 : 1500, peak: breathe ? 0.04 : 0.05 });
      if (!(sec === 'intro' && ci < 2) && !(breathe && ci % 2)) bassNote(ac, b.bass, t, chordDur * 0.97, ch.bass, { peak: breathe ? 0.09 : 0.14, attack: 0.9, release: 2, cutoff: 360 });
      if ((sec === 'theme' || sec === 'full') && ci === 4) choir(ac, b.choir, t, chordDur * 4 - 1.5, [ch.pad[2] + 12, ch.pad[4]], { peak: 0.022, attack: 3, release: 3, vowel: 'a' });
    }
    if (sec === 'theme' || sec === 'full') {
      const n = THEME_AT.get(inCycle);
      if (n) {
        leadNote(ac, b.lead, hum(t), n[2] * beat * 0.95, n[1], { peak: 0.05, attack: 0.12, release: 0.6 });
        if (sec === 'full') bellNote(ac, b.bell, t, n[1] + 12, { peak: 0.016, decay: 2.4, ratio: 3, index: 1 });
      }
    }
    if (sec === 'arp' || sec === 'full') {
      const idx = this.arp[sic % 8];
      const up = sic >= 8 && Math.random() < 0.35 ? 12 : 0;
      pluck(ac, b.pluck, hum(t), ch.tones[idx] + up, { peak: (sic % 4 === 0 ? 0.034 : 0.026) * (sec === 'full' ? 0.85 : 1), decay: 0.9, pan: rand(-0.3, 0.3) });
    }
    if (sic % 2 === 0) {
      const prob = { intro: 0.2, theme: 0.08, arp: 0.18, full: 0.1, breathe: 0.14 }[sec];
      if (Math.random() < prob) bellNote(ac, b.bell, hum(t), pickOne(ch.tones) + 12, { peak: rand(0.018, 0.034), decay: 3, ratio: 3.5, index: 1.2, pan: rand(-0.6, 0.6) });
    }
    // a soft riser into the cycles that lift
    if (inCycle === spc * 8 - 8) {
      const nxt = this.section(cycle + 1);
      if (nxt === 'theme' || nxt === 'full') riser(ac, b.pad, t, 8 * this.stepDur, { peak: 0.018 });
    }
  }
}

// ================================================================= explore
const E = {
  Emaj9: { pad: [52, 56, 59, 63, 66], bass: 40, tones: [64, 68, 71, 75, 78] },
  Csm9: { pad: [52, 56, 59, 61, 63], bass: 37, tones: [61, 64, 68, 71, 75] },
  Amaj9: { pad: [52, 56, 57, 59, 61], bass: 45, tones: [64, 69, 71, 73, 76] },
  B: { pad: [51, 54, 59, 63, 66], bass: 47, tones: [63, 66, 71, 75, 78] },
  Fs_E: { pad: [52, 54, 58, 61, 66], bass: 40, tones: [66, 70, 73, 78, 82] },
  Gsm7: { pad: [54, 56, 59, 63, 66], bass: 44, tones: [63, 66, 68, 71, 75] },
  Amaj7: { pad: [52, 56, 57, 61, 64], bass: 45, tones: [61, 64, 68, 69, 73] },
  Csm7: { pad: [52, 56, 59, 61, 64], bass: 37, tones: [61, 64, 68, 71, 73] },
  E_Gs: { pad: [52, 56, 59, 63, 64], bass: 44, tones: [64, 68, 71, 76, 80] },
  Bsus4: { pad: [52, 54, 59, 64, 66], bass: 47, tones: [64, 66, 71, 76, 78] },
  Fsm9: { pad: [52, 56, 57, 61, 64], bass: 42, tones: [61, 64, 66, 68, 73] },
};
const DAY = [
  [E.Emaj9, E.Csm9, E.Amaj9, E.B],
  [E.Emaj9, E.Fs_E, E.Gsm7, E.Amaj7],
  [E.Amaj9, E.Emaj9, E.Csm7, E.Bsus4],
];
const NIGHT = [
  [E.Csm9, E.Amaj9, E.E_Gs, E.Bsus4],
  [E.Csm7, E.Fsm9, E.Amaj7, E.Bsus4],
];
const PENT = [64, 66, 68, 71, 73, 76, 78, 80, 83];
const RHYTHMS = [
  [[0, 4], [4, 2], [6, 2], [8, 8]],
  [[2, 2], [4, 4], [8, 3], [11, 1], [12, 4]],
  [[0, 6], [6, 2], [8, 4], [12, 4]],
  [[4, 4], [8, 2], [10, 2], [12, 4]],
];
const EX_ARPS = [
  [0, 2, 4, 2, 1, 3, 2, 3],
  [0, 1, 2, 4, 3, 2, 1, 2],
  [2, 0, 3, 1, 4, 2, 3, 1],
];

export class ExplorePiece extends Piece {
  constructor(ac, bus, opts = {}) {
    super(ac, bus, { bpm: 72, stepsPerBeat: 2, ...opts });
    this.form = [];
    this.fi = 0;
    this.prog = DAY[0];
    this.chord = DAY[0][0];
    this.sec = 'intro';
    this.ci = 0;
    this.mel = null;
    this.lastNote = 71;
    this.arp = EX_ARPS[0];
  }

  setParams(p) {
    super.setParams(p);
    // dusk / dawn: finish the round early so the night (or day) set starts at the next chord
    if (this.form.length && this.params.night > 0.5 !== !!this.isNight) this.fi = this.form.length;
  }

  newRound() {
    const night = this.params.night > 0.5;
    this.isNight = night;
    this.bpm = night ? 64 : 72;
    this.prog = pickOne(night ? NIGHT : DAY);
    this.arp = pickOne(EX_ARPS);
    const f = [];
    const add = (sec, n) => {
      for (let i = 0; i < n; i++) f.push(sec);
    };
    if (night) {
      add('intro', 2);
      add('A', 8);
      add('rest', 4);
    } else {
      add('intro', 2);
      add('A', 8);
      add('B', 4);
      add('A', 4);
      add('rest', 2);
    }
    this.form = f;
    this.fi = 0;
  }

  onStep(step, t) {
    const ac = this.ac;
    const b = this.b;
    const spc = 16;
    const sic = step % spc;
    if (sic === 0) {
      if (this.fi >= this.form.length) this.newRound();
      const sec = this.form[this.fi];
      this.sec = sec;
      this.ci = this.fi % 4;
      this.fi++;
      this.chord = this.prog[this.ci];
      const ch = this.chord;
      const dur = spc * this.stepDur;
      const night = this.isNight;
      const rest = sec === 'rest';
      padChord(ac, b.pad, t, dur, ch.pad, { attack: 2.4, release: 3.4, cutoff: rest ? 850 : night ? 1000 : 1600, peak: rest ? 0.032 : night ? 0.042 : 0.048 });
      if (!rest && sec !== 'intro') {
        bassNote(ac, b.bass, t, dur * 0.95, ch.bass, { peak: night ? 0.09 : 0.13, attack: 0.5, release: 1.5, cutoff: 380 });
        if (!night && Math.random() < 0.5) bassNote(ac, b.bass, t + dur * 0.5, dur * 0.45, ch.bass + 7, { peak: 0.06, attack: 0.3, release: 1, cutoff: 380 });
      }
      if (sec === 'B' && this.ci === 0) choir(ac, b.choir, t, dur * 4 - 1, [ch.pad[1] + 12, ch.pad[3] + 12], { peak: 0.018, attack: 3, release: 3, vowel: 'o' });
      this.mel = null;
      if (sec === 'B' || (night && sec === 'A' && Math.random() < 0.35)) {
        this.mel = new Map(phrase(PENT, ch.tones, this.lastNote, pickOne(RHYTHMS)).map((n) => [n[0], n]));
      }
    }
    const ch = this.chord;
    const sec = this.sec;
    const night = this.isNight;
    // melody
    const n = this.mel?.get(sic);
    if (n) {
      this.lastNote = n[1];
      if (night) bellNote(ac, b.bell, hum(t), n[1], { peak: 0.03, decay: 3.2, ratio: 3, index: 1 });
      else leadNote(ac, b.lead, hum(t), n[2] * this.stepDur * 0.95, n[1], { peak: 0.045, attack: 0.1, release: 0.5 });
    }
    // arpeggio (day, A/B sections)
    if (!night && (sec === 'A' || sec === 'B')) {
      const idx = this.arp[sic % 8];
      const oct = sic >= 8 && Math.random() < 0.25 ? 12 : 0;
      pluck(ac, b.pluck, hum(t), ch.tones[idx] + oct, { peak: sic % 4 === 0 ? 0.03 : 0.022, decay: 0.75, pan: rand(-0.35, 0.35), wave: 'bright' });
    }
    // bells
    if (sic % 2 === 0) {
      const prob = night ? (sec === 'rest' ? 0.05 : 0.1) : { intro: 0.2, A: 0.08, B: 0.05, rest: 0.1 }[sec] ?? 0.08;
      if (Math.random() < prob) bellNote(ac, b.bell, hum(t), pickOne(ch.tones) + (night ? 0 : 12), { peak: rand(0.016, 0.03), decay: night ? 3.6 : 2.6, ratio: 3.5, index: 1.1, pan: rand(-0.65, 0.65) });
    }
  }
}

// =================================================================== space
const SPACE = [
  [
    { pad: [52, 55, 59, 62, 66], bass: 36, tones: [76, 79, 83, 86, 90] }, // Cmaj9#11
    { pad: [54, 57, 62, 66, 69], bass: 36, tones: [78, 81, 86, 90, 93] }, // D/C
    { pad: [52, 55, 59, 64, 67], bass: 36, tones: [76, 79, 83, 88, 91] }, // Em/C
    { pad: [54, 57, 62, 64, 69], bass: 38, tones: [78, 81, 86, 88, 93] }, // D6
  ],
  [
    { pad: [52, 57, 60, 64, 67], bass: 45, tones: [76, 81, 84, 88, 91] }, // Am9
    { pad: [54, 57, 59, 62, 66], bass: 47, tones: [78, 81, 83, 86, 90] }, // Bm7
    { pad: [52, 55, 59, 62, 64], bass: 36, tones: [76, 79, 83, 86, 88] }, // Cmaj9
    { pad: [55, 59, 62, 64, 67], bass: 43, tones: [79, 83, 86, 88, 91] }, // G6
  ],
];
const LYDIAN = [72, 74, 76, 78, 79, 81, 83, 84, 86, 88, 90, 91, 93, 95, 96];

export class SpacePiece extends Piece {
  constructor(ac, bus, opts = {}) {
    super(ac, bus, { bpm: 54, stepsPerBeat: 2, ...opts });
    this.round = -1;
    this.prog = SPACE[0];
    this.chord = SPACE[0][0];
  }

  onStep(step, t) {
    const ac = this.ac;
    const b = this.b;
    const spc = 32; // 4 bars per chord
    const sic = step % spc;
    const ci = Math.floor(step / spc) % 4;
    if (sic === 0) {
      if (ci === 0) {
        this.round++;
        this.prog = SPACE[this.round % 2];
      }
      const ch = (this.chord = this.prog[ci]);
      const dur = spc * this.stepDur;
      padChord(ac, b.pad, t, dur, ch.pad, { attack: 5, release: 6, cutoff: 1150, peak: 0.046, detune: 10 });
      padChord(ac, b.pad, t + 1, dur - 1, [ch.pad[2] + 12, ch.pad[4] + 12], { attack: 6, release: 6, cutoff: 2600, peak: 0.01, wave: 'glass', detune: 5 });
      bassNote(ac, b.bass, t, dur * 0.98, ch.bass, { peak: 0.13, attack: 3, release: 5, cutoff: 300, decayTo: 0.9 });
      bassNote(ac, b.bass, t + 0.5, dur * 0.95, ch.bass + 7, { peak: 0.05, attack: 3.5, release: 5, cutoff: 300, decayTo: 0.9 });
      if (this.round % 2 === 1 && ci === 0) choir(ac, b.choir, t, dur * 2, [ch.pad[1] + 12, ch.pad[3] + 12], { peak: 0.02, attack: 5, release: 5, vowel: 'o' });
    }
    const ch = this.chord;
    if (sic % 2 === 0 && Math.random() < 0.1) bellNote(ac, b.bell, hum(t), pickOne(ch.tones), { peak: rand(0.014, 0.028), decay: 4, ratio: 2, index: 0.7, pan: rand(-0.75, 0.75), partial: 0.08 });
    // star run: a quick ascending sparkle through the lydian scale
    if (sic === 16 && ci % 2 === 1 && Math.random() < 0.7) {
      const start = (Math.random() * 5) | 0;
      const len = 6 + ((Math.random() * 4) | 0);
      for (let k = 0; k < len; k++) {
        const m = LYDIAN[Math.min(LYDIAN.length - 1, start + k)];
        bellNote(ac, b.bell, t + k * 0.11, m, { peak: 0.012 + k * 0.001, decay: 2, ratio: 2, index: 0.5, pan: -0.6 + (k / len) * 1.2, partial: 0 });
      }
    }
  }
}

// ================================================================ festival
const FEST = [
  { pad: [55, 59, 62, 64, 66], bass: 40, tones: [64, 67, 71, 74, 78] }, // Em9
  { pad: [55, 59, 62, 64, 67], bass: 36, tones: [64, 67, 71, 72, 76] }, // Cmaj9
  { pad: [55, 59, 62, 69, 71], bass: 43, tones: [67, 69, 71, 74, 79] }, // Gadd9
  { pad: [54, 57, 62, 66, 69], bass: 38, tones: [66, 69, 74, 76, 78] }, // D
];
// hook: per bar [step, midi, steps]
const HOOK = [
  [[0, 71, 2], [2, 74, 2], [4, 76, 6], [12, 74, 2], [14, 76, 2]],
  [[0, 79, 4], [4, 78, 2], [6, 76, 2], [8, 74, 4], [12, 71, 4]],
  [[0, 74, 2], [2, 71, 2], [4, 74, 2], [6, 76, 2], [8, 79, 6], [14, 78, 2]],
  [[0, 78, 4], [4, 76, 2], [6, 74, 2], [8, 69, 8]],
].map((bar) => new Map(bar.map((n) => [n[0], n])));
const FEST_FORM = [
  ...Array(4).fill('intro'),
  ...Array(8).fill('groove'),
  ...Array(8).fill('hook'),
  ...Array(4).fill('break'),
  ...Array(8).fill('hook2'),
];
const BASS_LINE = [0, 0, 12, 0, 7, 0, 12, 7];
const FEST_ARP = [0, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0, 1];

export class FestivalPiece extends Piece {
  constructor(ac, bus, opts = {}) {
    super(ac, bus, { bpm: 108, stepsPerBeat: 4, ...opts });
  }

  onStep(step, t) {
    const ac = this.ac;
    const b = this.b;
    const sib = step % 16;
    const bar = Math.floor(step / 16);
    const fi = bar < FEST_FORM.length ? bar : 4 + ((bar - 4) % (FEST_FORM.length - 4));
    const sec = FEST_FORM[fi];
    const ci = bar % 4;
    const ch = FEST[ci];
    const drums = sec === 'groove' || sec === 'hook' || sec === 'hook2';
    const barDur = 16 * this.stepDur;
    if (sib === 0) {
      const cutoff = sec === 'intro' ? 900 + fi * 350 : sec === 'break' ? 1300 : 2300;
      padChord(ac, b.pad, t, barDur * 0.98, ch.pad, { attack: sec === 'break' ? 0.9 : 0.35, release: 1.2, cutoff, peak: sec === 'break' ? 0.042 : 0.034, detune: 9 });
      if (sec === 'break' && ci === 0) choir(ac, b.choir, t, barDur * 4 - 0.6, [ch.pad[1] + 12, ch.pad[3] + 12], { peak: 0.02, attack: 1.5, release: 2, vowel: 'a' });
      if (sec === 'break' && fi === 23) riser(ac, b.perc, t, barDur, { peak: 0.03 });
    }
    if (drums) {
      if (sib % 4 === 0) kick(ac, b.perc, t, { peak: sib === 0 ? 0.3 : 0.26 });
      if (sec !== 'groove' && (sib === 4 || sib === 12)) clap(ac, b.perc, hum(t), { peak: 0.085, pan: 0.1 });
      if (sib % 4 === 2) hat(ac, b.perc, hum(t), { peak: 0.02, open: sib === 14 && ci === 3, pan: 0.25 });
      if (sib % 2 === 0) {
        const k = sib / 2;
        bassNote(ac, b.bass, t, this.stepDur * 1.6, ch.bass + BASS_LINE[k], { peak: k === 0 ? 0.13 : 0.1, attack: 0.008, release: 0.15, cutoff: 650, decayTo: 0.6 });
      }
    } else if (sec === 'break' && sib === 0) {
      bassNote(ac, b.bass, t, barDur * 0.95, ch.bass, { peak: 0.08, attack: 0.4, release: 1, cutoff: 380 });
    }
    if (sec !== 'break') {
      const idx = FEST_ARP[sib];
      pluck(ac, b.pluck, hum(t), ch.tones[idx] + (sib >= 8 ? 12 : 0), { peak: sec === 'intro' ? 0.018 + fi * 0.002 : 0.016, decay: 0.28, pan: rand(-0.4, 0.4) });
    } else if (sib % 4 === 0 && Math.random() < 0.5) {
      bellNote(ac, b.bell, hum(t), pickOne(ch.tones) + 12, { peak: 0.025, decay: 2.2, ratio: 3.5, index: 1.1, pan: rand(-0.6, 0.6) });
    }
    if (sec === 'hook' || sec === 'hook2') {
      const n = HOOK[ci].get(sib);
      if (n) {
        pluck(ac, b.lead, hum(t), n[1], { peak: 0.05, decay: Math.min(1.4, 0.25 + n[2] * this.stepDur), bright: 4, wave: 'warm' });
        leadNote(ac, b.lead, hum(t), n[2] * this.stepDur * 0.9, n[1], { peak: 0.026, attack: 0.03, release: 0.25, vibrato: 0.6 });
        if (sec === 'hook2') bellNote(ac, b.bell, t, n[1] + 12, { peak: 0.018, decay: 1.6, ratio: 3, index: 1 });
      }
    }
  }
}
