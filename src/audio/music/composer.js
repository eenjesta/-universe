/**
 * Generative composer base + the music bus every piece plays into.
 *
 * createMusicBus(g, opts) builds: instrument sub-buses (pad, bell, pluck, bass,
 * lead, choir, perc) → dry / stereo pad chorus / ping-pong delay / convolution
 * reverb (procedural IR) → tone low-pass → master (fade-in, level) → g.out.
 *
 * Piece: a step sequencer on the AudioContext clock. schedule(from, to) is
 * called by a look-ahead Scheduler and calls onStep(step, time) for every grid
 * step in the window; subclasses decide what to play from bar/step position
 * and their own song form. Steps that fell behind (throttled tab) are skipped
 * but counted, so the form stays in sync.
 */
import { reverbIR, glide, num, clamp01 } from '../lib/dsp.js';

const SENDS = {
  // [dry, reverb, delay]
  pad: [0.75, 0.55, 0],
  bell: [0.55, 0.7, 0.35],
  pluck: [0.7, 0.32, 0.42],
  bass: [1, 0.06, 0],
  lead: [0.72, 0.48, 0.22],
  choir: [0.5, 0.85, 0],
  perc: [0.9, 0.12, 0],
};

export function createMusicBus(g, { reverb = {}, reverbLevel = 0.9, delayTime = 0.5, delayFeedback = 0.38, delayLevel = 0.5, chorus = true, tone = 9000 } = {}) {
  const ac = g.ac;
  const master = g.gain(0);
  const toneLp = g.filter('lowpass', tone, 0.5);
  toneLp.connect(master).connect(g.out);
  const dry = g.gain(1);
  dry.connect(toneLp);
  // reverb
  const revIn = g.gain(1);
  const conv = g.convolver(reverbIR(ac, { seconds: 4.2, decay: 3.4, bright: 0.5, ...reverb }));
  const revOut = g.gain(reverbLevel);
  revIn.connect(conv).connect(revOut).connect(toneLp);
  // ping-pong delay (L → R → L) with a darkening feedback path
  const dlyIn = g.gain(1);
  const dL = g.delay(delayTime, 2);
  const dR = g.delay(delayTime, 2);
  const fb = g.gain(delayFeedback);
  const dLp = g.filter('lowpass', 3200, 0.5);
  const pL = g.pan(-0.7);
  const pR = g.pan(0.7);
  const dOut = g.gain(delayLevel);
  dlyIn.connect(dL);
  dL.connect(pL).connect(dOut);
  dL.connect(dR);
  dR.connect(pR).connect(dOut);
  dR.connect(dLp).connect(fb).connect(dL);
  dOut.connect(toneLp);
  dOut.connect(revIn);
  // instrument buses
  const buses = {};
  for (const [name, [d, r, dl]] of Object.entries(SENDS)) {
    const b = g.gain(1);
    if (d) b.connect(g.gain(d)).connect(dry);
    if (r) b.connect(g.gain(r)).connect(revIn);
    if (dl) b.connect(g.gain(dl)).connect(dlyIn);
    buses[name] = b;
  }
  // gentle stereo chorus on the pads
  if (chorus) {
    for (const [p, base, rate] of [[-0.8, 0.012, 0.23], [0.8, 0.017, 0.31]]) {
      const d = g.delay(base, 0.1);
      const pn = g.pan(p);
      const lvl = g.gain(0.4);
      buses.pad.connect(d).connect(pn).connect(lvl).connect(dry);
      g.lfo(d.delayTime, rate, 0.0035, 'sine', g.t);
    }
  }
  return { master, toneLp, dry, revIn, dlyIn, buses, delay: [dL, dR], fb };
}

export class Piece {
  constructor(ac, bus, { bpm = 70, stepsPerBeat = 2, beatsPerBar = 4, params = {} } = {}) {
    this.ac = ac;
    this.bus = bus;
    this.b = bus.buses;
    this.bpm = bpm;
    this.stepsPerBeat = stepsPerBeat;
    this.beatsPerBar = beatsPerBar;
    this.step = 0;
    this.time = 0;
    this.params = { night: 0, intensity: 1, ...params };
    this.started = false;
  }

  get stepDur() {
    return 60 / this.bpm / this.stepsPerBeat;
  }

  get stepsPerBar() {
    return this.stepsPerBeat * this.beatsPerBar;
  }

  /** Schedules every grid step whose time falls in [from, to). */
  schedule(from, to) {
    if (!this.started) {
      this.started = true;
      this.time = from;
    }
    while (this.time < to) {
      if (this.time >= from - 0.02) this.onStep(this.step, this.time);
      this.time += this.stepDur;
      this.step++;
    }
  }

  /** Override: called for every grid step. */
  onStep() {}

  setParams(p = {}) {
    if (p.night != null) this.params.night = clamp01(num(p.night, this.params.night));
    if (p.intensity != null) this.params.intensity = clamp01(num(p.intensity, this.params.intensity));
  }
}

/** Fades the music master to `level` (seconds-scale ramps). */
export function setLevel(bus, level, now, seconds = 2) {
  glide(bus.master.gain, Math.max(0, level), now, Math.max(0.05, seconds / 3));
}
