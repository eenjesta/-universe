/**
 * Vehicle engine loops (bus 'sfx'). Each returns a handle {set(params), stop()}:
 *   car.engine   set({rpm 0..1, load 0..1, boost 0..1})  growl (detuned saws +
 *                sub square through drive + resonant low-pass) + low electric whine + intake noise
 *   vtol.engine  set({thrust 0..1, rpm 0..1 (rotor), speed m/s, altitude m, boost 0..1})  big
 *                tilt-rotor: rhythmic blade "whump" (pulsed low-passed noise + soft thumps through a
 *                gentle saturator), warm turbine hum 70–170 Hz, faint slow whine < 800 Hz, rotor
 *                wash that grows with thrust (and near the ground), air rush with speed
 *   ship.engine  set({thrust 0..1, boost 0..1})  deep rumble + sub, jet noise, low whine, afterburner
 * All params are smoothed (no zipper noise) and NaN-safe. Laptop-speaker rule: no tonal
 * component above ~900 Hz, every bright layer is noise and low-passed (measure with
 * `node src/audio/dev/run-lab.mjs --only engines`).
 */
import { num, clamp01, glide, shapeWave } from '../lib/dsp.js';

// One rotor "whump" per blade pass: smooth quick rise, rounded exponential decay
// (band-limited by shapeWave: no hard edge, so no click / buzz per blade).
const BLADE = (ph) => (ph < 0.13 ? Math.pow(Math.sin((Math.PI / 2) * (ph / 0.13)), 2) : Math.exp(-(ph - 0.13) / 0.2));

// vtol.engine layer levels (tuned with the lab: src/audio/dev/run-lab.mjs --only engines)
const VTOL_MIX = { rotor: 1.7, thump: 0.3, drive: 1.5, rotorOut: 0.56, hum: 0.075, whine: 0.006, wash: 0.45, rush: 0.4 };

/**
 * Gain pulsed by an LFO that swings between `min` (< 0) and 1. set(peak, floor):
 * the gain moves between peak·floor (between pulses) and peak (on a pulse) and
 * never goes negative, also while gliding.
 */
function pulsed(g, lfo, min) {
  const amp = g.gain(0);
  const depth = g.gain(0);
  lfo.connect(depth).connect(amp.gain);
  const m = Math.abs(min);
  return {
    node: amp,
    set(peak, floor, now, tc) {
      const d = (peak * (1 - floor)) / (1 + m);
      glide(depth.gain, d, now, tc);
      glide(amp.gain, peak - d, now, tc);
    },
  };
}

function fadeIn(g, peak = 1, tc = 0.12) {
  const m = g.gain(0);
  m.gain.setValueAtTime(0, g.t);
  m.gain.setTargetAtTime(peak, g.t, tc);
  m.connect(g.out);
  return m;
}

export const ENGINE_RECIPES = {
  'car.engine': {
    loop: true,
    fn(g) {
      const t = g.t;
      const ac = g.ac;
      const out = fadeIn(g, 1, 0.15);
      // growl
      const o1 = g.osc('sawtooth', 40);
      const o2 = g.osc('square', 20);
      const o3 = g.osc('sawtooth', 80, 9);
      const mix = g.gain(1);
      const g1 = g.gain(0.45);
      const g2 = g.gain(0.3);
      const g3 = g.gain(0.22);
      o1.connect(g1).connect(mix);
      o2.connect(g2).connect(mix);
      o3.connect(g3).connect(mix);
      const drive = g.shaper(2.4);
      const lp = g.filter('lowpass', 500, 2.2);
      const body = g.gain(0.22);
      mix.connect(drive).connect(lp).connect(body).connect(out);
      // firing roughness: slight AM at half the firing rate
      const rough = g.osc('triangle', 10);
      const roughG = g.gain(0.05);
      rough.connect(roughG).connect(body.gain);
      // electric whine: low (175–760 Hz), quiet, slow vibrato — no laptop-speaker beep
      const w = g.osc('sine', 180);
      const wVib = g.lfo(w.frequency, 0.27, 1, 'sine', t);
      const wg = g.gain(0.006);
      w.connect(wg).connect(out);
      // intake / exhaust noise
      const n = g.noise('brown');
      const nbp = g.filter('bandpass', 160, 1.4);
      const ng = g.gain(0.05);
      n.connect(nbp).connect(ng).connect(out);
      for (const s of [o1, o2, o3, rough, w, n]) g.play(s, t);
      let rpm = 0;
      let load = 0;
      let boost = 0;
      const apply = (now, tc) => {
        const f0 = 32 + rpm * 150 + boost * 12;
        glide(o1.frequency, f0, now, tc);
        glide(o2.frequency, f0 * 0.5, now, tc);
        glide(o3.frequency, f0 * 2, now, tc);
        glide(rough.frequency, f0 * 0.25, now, tc);
        const fw = f0 * 3.6 + 60;
        glide(w.frequency, fw, now, tc * 2);
        glide(wVib.depth.gain, fw * 0.005, now, tc * 2);
        glide(nbp.frequency, f0 * 3.2, now, tc);
        glide(lp.frequency, 300 + rpm * 1500 + load * 600 + boost * 400, now, tc * 1.5);
        glide(body.gain, 0.17 + load * 0.13 + rpm * 0.06, now, tc * 2);
        glide(wg.gain, 0.006 + rpm * 0.014 + boost * 0.01, now, tc * 2);
        glide(ng.gain, 0.03 + load * 0.1 + boost * 0.05, now, tc * 2);
      };
      apply(t, 0.02);
      return {
        set(p) {
          rpm = clamp01(num(p.rpm, rpm));
          load = clamp01(num(p.load, load));
          boost = clamp01(num(p.boost, boost));
          apply(ac.currentTime, 0.06);
        },
        stop() {},
      };
    },
  },

  'vtol.engine': {
    loop: true,
    fn(g) {
      const t = g.t;
      const ac = g.ac;
      const out = fadeIn(g, 1, 0.3);
      const { wave: bladeWave, min: bladeMin } = shapeWave(ac, 'rotor-blade', BLADE, 14);
      // blade-pass LFO (12–24 Hz); the second rotor hears it ~7.5 ms later ("wh-whump")
      const blade = g.osc(bladeWave, 13);
      const bladeB = g.delay(0.0075, 0.05);
      blade.connect(bladeB);

      // rotor bus (whump noise + thumps) → gentle tanh saturation: rounds the noise
      // peaks and adds warm low-mid harmonics that laptop speakers can still play
      const rBus = g.gain(1);
      const rSat = g.shaper(VTOL_MIX.drive);
      const rOut = g.gain(VTOL_MIX.rotorOut);
      rBus.connect(rSat).connect(rOut).connect(out);

      // rotor whump: per rotor pink noise pulsed at the blade rate, low-passed together
      const amA = pulsed(g, blade, bladeMin);
      const amB = pulsed(g, bladeB, bladeMin);
      const rLp1 = g.filter('lowpass', 320, 0.7);
      const rLp2 = g.filter('lowpass', 420, 0.5);
      const rHp = g.filter('highpass', 45, 0.7);
      const rLvl = g.gain(0);
      for (const [am, p] of [[amA, -0.5], [amB, 0.5]]) {
        const n = g.noise('pink');
        n.connect(am.node).connect(g.pan(p)).connect(rLp1);
        g.play(n, t);
      }
      rLp1.connect(rLp2).connect(rHp).connect(rLvl).connect(rBus);

      // soft low thumps: warm osc, pitch kicked up and gated by every blade pass
      const th = g.osc('hum', 46);
      const thFm = g.gain(26);
      blade.connect(thFm).connect(th.frequency);
      const thAm = pulsed(g, blade, bladeMin);
      const thLp = g.filter('lowpass', 240, 0.7);
      const thLvl = g.gain(0);
      th.connect(thAm.node).connect(thLp).connect(thLvl).connect(rBus);

      // turbine hum: two slightly detuned warm oscillators (slow beating) + sub octave
      const h1 = g.osc('hum', 80);
      const h2 = g.osc('hum', 80, 8);
      const hSub = g.osc('sine', 40);
      const hMix = g.gain(0.5);
      const hSubG = g.gain(0.45);
      const hLp = g.filter('lowpass', 480, 0.6);
      const hLvl = g.gain(0);
      h1.connect(hMix);
      h2.connect(hMix);
      hMix.connect(hLp).connect(hLvl);
      hSub.connect(hSubG).connect(hLvl);
      hLvl.connect(out);

      // faint turbine whine (4.6 × hum ≈ 320–800 Hz), slow vibrato and slow swell
      const w = g.osc('sine', 360);
      const wVib = g.lfo(w.frequency, 0.21, 2, 'sine', t);
      const wSwell = g.gain(1);
      g.lfo(wSwell.gain, 0.09, 0.35, 'sine', t);
      const wLvl = g.gain(0);
      w.connect(wSwell).connect(wLvl).connect(out);

      // rotor wash: wide pink noise, gently pulsed by the blades, grows with thrust
      const washAm = pulsed(g, blade, bladeMin);
      const wHp = g.filter('highpass', 150, 0.6);
      const wLp1 = g.filter('lowpass', 700, 0.5);
      const wLp2 = g.filter('lowpass', 900, 0.5);
      const washLvl = g.gain(0);
      for (const p of [-0.7, 0.7]) {
        const n = g.noise('pink');
        n.connect(g.pan(p)).connect(wHp);
        g.play(n, t);
      }
      wHp.connect(wLp1).connect(wLp2).connect(washAm.node).connect(washLvl).connect(out);
      const gust = g.lfo(washLvl.gain, 0.13, 0, 'sine', t);

      // forward-flight air rush
      const rush = g.noise('pink');
      const rushHp = g.filter('highpass', 180, 0.5);
      const rushLp = g.filter('lowpass', 600, 0.5);
      const rushLvl = g.gain(0);
      rush.connect(rushHp).connect(rushLp).connect(rushLvl).connect(out);

      for (const s of [blade, th, h1, h2, hSub, w, rush]) g.play(s, t);

      let thrust = 0;
      let rotor = null;
      let speed = 0;
      let boost = 0;
      let alt = 0;
      let prev = '';
      // k scales every time constant (heavy machine: ~0.35 s for levels, 0.6 s for pitch)
      const apply = (now, k) => {
        const rot = rotor ?? Math.max(0.15, thrust);
        const power = clamp01(thrust + boost * 0.15);
        const spool = clamp01(0.45 * rot + 0.55 * power);
        const sp = clamp01(speed / 60);
        const ground = clamp01(1 - alt / 12) * clamp01(rot * 1.4);
        const tc = 0.35 * k;
        // rotor
        glide(blade.frequency, 12 + 8 * rot + 4 * power, now, 0.3 * k);
        amA.set(1, 0.32 - 0.16 * power, now, tc);
        amB.set(0.8, 0.36 - 0.16 * power, now, tc);
        glide(rLp1.frequency, 230 + 230 * power + 120 * rot, now, tc);
        glide(rLp2.frequency, 320 + 300 * power + 150 * rot, now, tc);
        glide(rLvl.gain, VTOL_MIX.rotor * (0.45 + 0.4 * rot + 0.35 * power), now, tc);
        // thumps
        thAm.set(1, 0.04, now, tc);
        glide(th.frequency, 40 + 14 * spool, now, 0.5 * k);
        glide(thFm.gain, 22 + 18 * power, now, tc);
        glide(thLvl.gain, VTOL_MIX.thump * (0.3 + 0.5 * rot + 0.4 * power), now, tc);
        // turbine
        const fh = 70 + 100 * spool;
        glide(h1.frequency, fh, now, 0.6 * k);
        glide(h2.frequency, fh, now, 0.6 * k);
        glide(hSub.frequency, fh / 2, now, 0.6 * k);
        glide(hLp.frequency, 300 + 450 * spool, now, tc);
        glide(hLvl.gain, VTOL_MIX.hum * (0.55 + 0.6 * spool), now, tc);
        const fw = fh * 4.6;
        glide(w.frequency, fw, now, 0.8 * k);
        glide(wVib.depth.gain, fw * 0.006, now, tc);
        glide(wLvl.gain, VTOL_MIX.whine * (0.4 + 0.6 * spool), now, tc);
        // wash + rush
        glide(wLp1.frequency, 500 + 700 * power + 200 * ground, now, tc);
        glide(wLp2.frequency, 650 + 800 * power, now, tc);
        washAm.set(1, 0.6, now, tc);
        const wl = VTOL_MIX.wash * (0.15 + 0.85 * power * power + 0.5 * ground * rot);
        glide(washLvl.gain, wl, now, tc);
        glide(gust.depth.gain, wl * 0.25, now, tc);
        glide(rushLp.frequency, 450 + 600 * sp, now, 0.5 * k);
        glide(rushLvl.gain, VTOL_MIX.rush * Math.pow(sp, 1.4), now, 0.5 * k);
      };
      apply(t, 0.05);
      return {
        set(p) {
          thrust = clamp01(num(p.thrust, thrust));
          boost = clamp01(num(p.boost, boost));
          speed = Math.max(0, num(p.speed, speed)); // m/s
          alt = Math.max(0, num(p.altitude, alt));
          if (p.rpm != null) rotor = clamp01(num(p.rpm, rotor ?? 0));
          // drive.js calls set() every frame: only re-schedule when something moved
          const key = `${thrust.toFixed(3)}|${boost.toFixed(2)}|${Math.round(speed * 2)}|${Math.min(alt, 12).toFixed(1)}|${rotor == null ? '' : Math.round(rotor * 200)}`;
          if (key === prev) return;
          prev = key;
          apply(ac.currentTime, 1);
        },
        stop() {},
      };
    },
  },

  'ship.engine': {
    loop: true,
    fn(g) {
      const t = g.t;
      const ac = g.ac;
      const out = fadeIn(g, 0.62, 0.3);
      // rumble (decorrelated L/R)
      const lp = g.filter('lowpass', 160, 0.8);
      const rg = g.gain(0.3);
      for (const p of [-0.6, 0.6]) {
        const n = g.noise('brown');
        const pn = g.pan(p);
        n.connect(pn).connect(lp);
        g.play(n, t);
      }
      lp.connect(rg).connect(out);
      // sub (+ 2nd harmonic so laptop speakers still convey it)
      const sub = g.osc('sine', 42);
      const sub2 = g.osc('triangle', 84);
      const sg = g.gain(0.2);
      const s2g = g.gain(0.35);
      sub.connect(sg);
      sub2.connect(s2g).connect(sg);
      sg.connect(out);
      // jet
      const j = g.noise('white');
      const jp = g.noise('pink');
      const jbp = g.filter('bandpass', 500, 0.75);
      const jg = g.gain(0.04);
      j.connect(jbp);
      jp.connect(jbp);
      jbp.connect(jg).connect(out);
      // whine: low (230–740 Hz), quiet, slow vibrato
      const w = g.osc('sine', 230);
      const wVib = g.lfo(w.frequency, 0.19, 1, 'sine', t);
      const wg = g.gain(0.008);
      w.connect(wg).connect(out);
      // afterburner
      const ab = g.noise('white');
      const ahp = g.filter('highpass', 1100, 0.6);
      const alp = g.filter('lowpass', 3200, 0.6);
      const ag = g.gain(0);
      const crackle = g.gain(0.8);
      ab.connect(ahp).connect(alp).connect(crackle).connect(ag).connect(out);
      const cr = g.osc('triangle', 23); // rumble flutter (a square here clicked)
      const crd = g.gain(0.25);
      cr.connect(crd).connect(crackle.gain);
      for (const s of [sub, sub2, j, jp, w, ab, cr]) g.play(s, t);
      let thrust = 0;
      let boost = 0;
      const apply = (now, tc) => {
        glide(lp.frequency, 160 + thrust * 240 + boost * 120, now, tc);
        glide(rg.gain, 0.3 + thrust * 0.3 + boost * 0.1, now, tc);
        glide(sub.frequency, 42 + thrust * 16, now, tc * 2);
        glide(sub2.frequency, (42 + thrust * 16) * 2, now, tc * 2);
        glide(sg.gain, 0.18 + thrust * 0.12, now, tc);
        glide(jbp.frequency, 500 + thrust * 1100 + boost * 500, now, tc);
        glide(jg.gain, 0.03 + thrust * 0.17 + boost * 0.07, now, tc);
        const fw = 230 + thrust * 330 + boost * 180;
        glide(w.frequency, fw, now, tc * 2);
        glide(wVib.depth.gain, fw * 0.006, now, tc * 2);
        glide(wg.gain, 0.008 + thrust * 0.012 + boost * 0.012, now, tc);
        glide(ag.gain, boost * 0.18, now, tc);
      };
      apply(t, 0.02);
      return {
        set(p) {
          thrust = clamp01(num(p.thrust, thrust));
          boost = clamp01(num(p.boost, boost));
          apply(ac.currentTime, 0.1);
        },
        stop() {},
      };
    },
  },
};
