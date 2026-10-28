/**
 * Ambience loops (bus 'ambient'), all driven by the director:
 *   ambient.wind    set({intensity 0..1})          gusty band-passed noise + whistle on heights
 *   ambient.water   set({lap 0..1, roar 0..1, pan}) lake lapping (wave swells + plips) and
 *                                                    waterfall roar (broadband noise + rumble)
 *   ambient.city    set({hum 0..1, murmur 0..1})    distant city hum/traffic + crowd babble
 *   ambient.space   set({intensity 0..1})           deep drone, cosmic wind, rare glassy pings
 *   ambient.forest  set({day, night, density})      leaves, birds by day, crickets + owl by night
 * Random events (gusts, waves, syllables, birds) come from a look-ahead
 * Scheduler, so they also render offline. Loops fade in on their own.
 */
import { Graph, Scheduler, num, clamp01, glide, rand, pickOne, mtof } from '../lib/dsp.js';
import { bell, tone, chirp, echo } from '../lib/voices.js';

function master(g, fade = 1.5) {
  const m = g.gain(0);
  m.gain.setValueAtTime(0, g.t);
  m.gain.setTargetAtTime(1, g.t, fade / 3);
  m.connect(g.out);
  return m;
}

/** A short-lived sub-graph (one event) connected to `dest`; cleaned up automatically. */
function event(ac, dest, build) {
  const e = new Graph(ac, dest);
  build(e);
  e.finish();
}

export const AMBIENT_RECIPES = {
  'ambient.wind': {
    loop: true,
    fn(g, o) {
      const ac = g.ac;
      const t = g.t;
      const m = master(g, 3);
      const level = g.gain(0);
      level.connect(m);
      const gust = g.gain(0.4);
      gust.connect(level);
      const bps = [];
      for (const [p, f] of [[-0.55, 480], [0.55, 560]]) {
        const n = g.noise('pink');
        const bp = g.filter('bandpass', f, 0.75);
        const pn = g.pan(p);
        n.connect(bp).connect(pn).connect(gust);
        g.play(n, t);
        bps.push(bp);
      }
      const rumble = g.noise('brown');
      const rlp = g.filter('lowpass', 170, 0.6);
      const rg = g.gain(0.35);
      rumble.connect(rlp).connect(rg).connect(gust);
      g.play(rumble, t);
      // whistle over ridges (narrow band, slowly wandering)
      const wn = g.noise('white');
      const wbp = g.filter('bandpass', 900, 14);
      const wg = g.gain(0);
      const wpan = g.pan(0.2);
      wn.connect(wbp).connect(wg).connect(wpan).connect(level);
      g.play(wn, t);
      let intensity = 0.4;
      let whistle = 0;
      let next = t;
      const sched = new Scheduler(
        ac,
        (from, to) => {
          if (next < from) next = from;
          while (next < to) {
            const k = Math.pow(Math.random(), 1.3); // mostly calm, sometimes strong
            const target = 0.18 + k * (0.55 + intensity * 0.45);
            const tc = rand(0.35, 1.3);
            gust.gain.setTargetAtTime(target, next, tc);
            bps[0].frequency.setTargetAtTime(330 + target * 650, next, tc);
            bps[1].frequency.setTargetAtTime(380 + target * 700, next, tc * 1.1);
            wbp.frequency.setTargetAtTime(650 + target * 900 + rand(-80, 80), next, tc * 1.5);
            wg.gain.setTargetAtTime(whistle * target * target, next, tc);
            wpan.pan.setTargetAtTime(rand(-0.6, 0.6), next, 2);
            next += rand(0.7, 3.2);
          }
        },
        { duration: num(o.duration, 20), lookahead: 1.5, interval: 0.25 },
      ).start(t);
      const apply = (now, tc) => {
        glide(level.gain, 0.06 + intensity * 0.5, now, tc);
        whistle = clamp01((intensity - 0.45) / 0.55) * 0.5;
      };
      apply(t, 0.5);
      return {
        set(p) {
          intensity = clamp01(num(p.intensity, intensity));
          apply(ac.currentTime, 1.2);
        },
        stop() {
          sched.stop();
        },
      };
    },
  },

  'ambient.water': {
    loop: true,
    fn(g, o) {
      const ac = g.ac;
      const t = g.t;
      const m = master(g, 2);
      // ---- lapping
      const lapLevel = g.gain(0);
      lapLevel.connect(m);
      const lapLo = g.gain(0.1);
      const lapHi = g.gain(0.05);
      const n1 = g.noise('brown');
      const lp1 = g.filter('lowpass', 650, 0.4);
      n1.connect(lp1).connect(lapLo).connect(lapLevel);
      const n2 = g.noise('pink');
      const bp2 = g.filter('bandpass', 1250, 0.9);
      const p2 = g.pan(0.25);
      n2.connect(bp2).connect(lapHi).connect(p2).connect(lapLevel);
      g.play(n1, t);
      g.play(n2, t);
      // ---- waterfall roar
      const roarLevel = g.gain(0);
      const roarPan = g.pan(0);
      roarPan.connect(roarLevel).connect(m);
      const roarVca = g.gain(0.85);
      roarVca.connect(roarPan);
      const r1 = g.noise('white');
      const hp = g.filter('highpass', 140, 0.6);
      const lp = g.filter('lowpass', 3200, 0.5);
      const r1g = g.gain(0.32);
      r1.connect(hp).connect(lp).connect(r1g).connect(roarVca);
      const r2 = g.noise('pink');
      const bp = g.filter('bandpass', 900, 0.5);
      const r2g = g.gain(0.5);
      r2.connect(bp).connect(r2g).connect(roarVca);
      const r3 = g.noise('brown');
      const rl = g.filter('lowpass', 170, 0.6);
      const r3g = g.gain(0.75);
      r3.connect(rl).connect(r3g).connect(roarPan);
      for (const s of [r1, r2, r3]) g.play(s, t);
      g.lfo(roarVca.gain, 5.3, 0.06, 'sine', t);
      let lap = 0;
      let roar = 0;
      let next = t;
      let nextSwell = t;
      const sched = new Scheduler(
        ac,
        (from, to) => {
          if (next < from) next = from;
          while (next < to) {
            // one wave reaching the shore
            const pk = rand(0.5, 1);
            const rise = rand(0.12, 0.3);
            lapLo.gain.setTargetAtTime(0.18 + pk * 0.55, next, rise / 2);
            lapLo.gain.setTargetAtTime(0.12, next + rise + rand(0.15, 0.4), rand(0.3, 0.6));
            const th = next + rise * 0.8;
            lapHi.gain.setTargetAtTime(0.1 + pk * 0.4, th, 0.05);
            lapHi.gain.setTargetAtTime(0.03, th + 0.12, rand(0.15, 0.3));
            bp2.frequency.setTargetAtTime(rand(900, 1700), th, 0.1);
            if (lap > 0.05 && Math.random() < 0.65) {
              const count = 1 + ((Math.random() * 3) | 0);
              for (let i = 0; i < count; i++) {
                const tp = th + rand(0.05, 0.5);
                const f = rand(350, 900);
                event(ac, lapLevel, (e) => tone(e, lapLevel, tp, f, { f1: f * rand(1.6, 2.2), sweepDur: 0.035, peak: 0.07, a: 0.003, d: 0.045, pan: rand(-0.7, 0.7) }));
              }
            }
            next += rand(0.9, 2.6);
          }
          if (nextSwell < from) nextSwell = from;
          while (nextSwell < to) {
            roarVca.gain.setTargetAtTime(rand(0.72, 1), nextSwell, rand(0.4, 1));
            nextSwell += rand(1, 3);
          }
        },
        { duration: num(o.duration, 20), lookahead: 1.5, interval: 0.25 },
      ).start(t);
      const apply = (now, tc, pan = null) => {
        glide(lapLevel.gain, lap * 0.75, now, tc);
        glide(roarLevel.gain, roar * 0.65, now, tc);
        if (pan != null) glide(roarPan.pan, Math.max(-0.85, Math.min(0.85, pan)), now, 0.25);
      };
      apply(t, 0.4);
      return {
        set(p) {
          lap = clamp01(num(p.lap, lap));
          roar = clamp01(num(p.roar, roar));
          apply(ac.currentTime, 0.8, num(p.pan, 0));
        },
        stop() {
          sched.stop();
        },
      };
    },
  },

  'ambient.city': {
    loop: true,
    fn(g, o) {
      const ac = g.ac;
      const t = g.t;
      const m = master(g, 2.5);
      // ---- hum + distant traffic
      const humLevel = g.gain(0);
      humLevel.connect(m);
      const hn = g.noise('brown');
      const hlp = g.filter('lowpass', 200, 0.6);
      const hg = g.gain(0.45);
      hn.connect(hlp).connect(hg).connect(humLevel);
      const s1 = g.osc('soft', 55);
      const s2 = g.osc('sine', 110, 4);
      const sg = g.gain(0.05);
      s1.connect(sg);
      s2.connect(sg);
      sg.connect(humLevel);
      const tn = g.noise('pink');
      const tbp = g.filter('bandpass', 420, 0.8);
      const tvca = g.gain(0.05);
      const tpan = g.pan(0);
      tn.connect(tbp).connect(tvca).connect(tpan).connect(humLevel);
      for (const s of [hn, s1, s2, tn]) g.play(s, t);
      // ---- crowd murmur: babbling "talkers" through moving formants
      const murLevel = g.gain(0);
      const murBus = g.gain(1);
      const mlp = g.filter('lowpass', 2600, 0.5);
      murBus.connect(mlp).connect(murLevel).connect(m);
      const room = echo(g, murLevel, { time: 0.07, fb: 0.25, wet: 0.35, lp: 2000 });
      mlp.connect(room);
      const bed = g.noise('pink');
      const bedbp = g.filter('bandpass', 700, 0.6);
      const bedg = g.gain(0.1);
      bed.connect(bedbp).connect(bedg).connect(murBus);
      g.play(bed, t);
      // Each talker: a voiced source through two static vowel banks (no filter
      // automation); syllables crossfade the banks and shape the amplitude.
      const VOWELS = [[730, 1090], [530, 1840], [300, 2200], [570, 840], [440, 1020], [660, 1700]];
      const talkers = [];
      for (let i = 0; i < 5; i++) {
        const base = rand(105, 230);
        const src = g.osc(i % 2 ? 'warm' : 'hollow', base);
        const vca = g.gain(0);
        const banks = [];
        for (const [a, b] of [VOWELS[i % VOWELS.length], VOWELS[(i + 2) % VOWELS.length]]) {
          const mix = g.gain(0.5);
          const f1 = g.filter('bandpass', a * rand(0.92, 1.08), 4);
          const f2 = g.filter('bandpass', b * rand(0.92, 1.08), 5);
          const f2g = g.gain(0.55);
          src.connect(f1).connect(mix);
          src.connect(f2).connect(f2g).connect(mix);
          mix.connect(vca);
          banks.push(mix);
        }
        const pn = g.pan(rand(-0.8, 0.8));
        vca.connect(pn).connect(murBus);
        g.play(src, t);
        talkers.push({ src, banks, vca, base, next: t + rand(0, 1.5), left: 0, level: rand(0.35, 0.8) });
      }
      let next = t;
      const sched = new Scheduler(
        ac,
        (from, to) => {
          for (const k of talkers) {
            if (k.next < from) k.next = from;
            while (k.next < to) {
              const tt = k.next;
              if (k.left <= 0) {
                // pause, then a new phrase
                k.left = 4 + ((Math.random() * 10) | 0);
                k.vca.gain.setTargetAtTime(0, tt, 0.05);
                k.next += rand(0.4, 2.5);
                continue;
              }
              k.left--;
              const dur = rand(0.11, 0.28);
              const w = Math.random();
              k.banks[0].gain.setTargetAtTime(w, tt, 0.03);
              k.banks[1].gain.setTargetAtTime(1 - w, tt, 0.03);
              k.src.frequency.setTargetAtTime(k.base * rand(0.88, 1.15), tt, 0.06);
              k.vca.gain.setTargetAtTime(k.level * rand(0.5, 1), tt, 0.025);
              k.vca.gain.setTargetAtTime(k.level * 0.08, tt + dur * 0.65, 0.04);
              k.next += dur;
            }
          }
          if (next < from) next = from;
          while (next < to) {
            tvca.gain.setTargetAtTime(rand(0.03, 0.22), next, rand(0.8, 2));
            tpan.pan.setTargetAtTime(rand(-0.7, 0.7), next, 2.5);
            next += rand(3, 8);
          }
        },
        { duration: num(o.duration, 20), lookahead: 0.6, interval: 0.1 },
      ).start(t);
      let hum = 0;
      let murmur = 0;
      const apply = (now, tc) => {
        glide(humLevel.gain, hum * 0.55, now, tc);
        glide(murLevel.gain, murmur * 0.5, now, tc);
      };
      apply(t, 0.5);
      return {
        set(p) {
          hum = clamp01(num(p.hum, hum));
          murmur = clamp01(num(p.murmur, murmur));
          apply(ac.currentTime, 1);
        },
        stop() {
          sched.stop();
        },
      };
    },
  },

  'ambient.space': {
    loop: true,
    fn(g, o) {
      const ac = g.ac;
      const t = g.t;
      const m = master(g, 4);
      const level = g.gain(0.2);
      level.connect(m);
      // drone
      const dlp = g.filter('lowpass', 520, 0.6);
      const dvca = g.gain(0.22);
      dlp.connect(dvca).connect(level);
      for (const [f, type, det, amp] of [[65.41, 'sine', 0, 1], [98, 'sine', 3, 0.7], [130.8, 'soft', -4, 0.45], [164.8, 'sine', 2, 0.18], [196, 'sine', -3, 0.12]]) {
        const s = g.osc(type, f, det);
        const a = g.gain(amp);
        s.connect(a).connect(dlp);
        g.play(s, t);
      }
      g.lfo(dvca.gain, 0.045, 0.06, 'sine', t);
      g.lfo(dlp.frequency, 0.021, 160, 'sine', t);
      // cosmic wind
      const wn = g.noise('brown');
      const wbp = g.filter('bandpass', 240, 0.7);
      const wg = g.gain(0.3);
      wn.connect(wbp).connect(wg).connect(level);
      g.lfo(wbp.frequency, 0.033, 130, 'sine', t);
      const hiss = g.noise('pink');
      const hhp = g.filter('highpass', 3200, 0.6);
      const hg = g.gain(0.012);
      hiss.connect(hhp).connect(hg).connect(level);
      g.play(wn, t);
      g.play(hiss, t);
      // rare glassy pings with a long echo
      const fx = echo(g, level, { time: 0.61, fb: 0.5, wet: 0.5, lp: 3000 });
      const NOTES = [84, 86, 88, 90, 91, 95, 96];
      let next = t + rand(3, 8);
      const sched = new Scheduler(
        ac,
        (from, to) => {
          if (next < from) next = from;
          while (next < to) {
            const tt = next;
            const f = mtof(pickOne(NOTES));
            event(ac, fx, (e) => bell(e, fx, tt, f, { peak: 0.04, decay: 2.2, ratio: 1.41, index: 0.6, pan: rand(-0.7, 0.7), partial: 0.05 }));
            next += rand(6, 16);
          }
        },
        { duration: num(o.duration, 20), lookahead: 1.5, interval: 0.3 },
      ).start(t);
      return {
        set(p) {
          const k = clamp01(num(p.intensity, 0.6));
          glide(level.gain, 0.08 + k * 0.17, ac.currentTime, 1.5);
        },
        stop() {
          sched.stop();
        },
      };
    },
  },

  'ambient.forest': {
    loop: true,
    fn(g, o) {
      const ac = g.ac;
      const t = g.t;
      const m = master(g, 3);
      // leaves
      const leafLevel = g.gain(0);
      leafLevel.connect(m);
      const ln = g.noise('pink');
      const lhp = g.filter('highpass', 1400, 0.6);
      const llp = g.filter('lowpass', 6500, 0.5);
      const lvca = g.gain(0.3);
      ln.connect(lhp).connect(llp).connect(lvca).connect(leafLevel);
      g.play(ln, t);
      // birds
      const dayLevel = g.gain(0);
      dayLevel.connect(m);
      const birdBus = g.gain(1);
      const shelf = g.filter('lowpass', 7000, 0.5);
      birdBus.connect(shelf).connect(dayLevel);
      const space = echo(g, dayLevel, { time: 0.13, fb: 0.28, wet: 0.3, lp: 5000 });
      shelf.connect(space);
      // crickets (AM-gated sines)
      const nightLevel = g.gain(0);
      nightLevel.connect(m);
      for (let i = 0; i < 3; i++) {
        const c = g.osc('sine', rand(4300, 4900));
        const pulse = g.gain(0.5);
        const chirpG = g.gain(0.5);
        const amp = g.gain(rand(0.03, 0.05));
        const pn = g.pan(rand(-0.85, 0.85));
        c.connect(pulse).connect(chirpG).connect(amp).connect(pn).connect(nightLevel);
        g.play(c, t);
        g.lfo(pulse.gain, rand(28, 38), 0.5, 'square', t);
        g.lfo(chirpG.gain, rand(1.4, 2.6), 0.5, 'square', t);
      }
      let day = 1;
      let night = 0;
      let density = 0.6;
      const SONG = [0, 2, 4, 7, 9, 12];
      const call = (tt) => {
        const pan = rand(-0.85, 0.85);
        const v = rand(0.45, 1);
        const kind = (Math.random() * 5) | 0;
        event(ac, birdBus, (e) => {
          if (kind === 0) {
            // warbler trill
            let f = rand(3800, 5200);
            const n = 6 + ((Math.random() * 7) | 0);
            const dt = rand(0.045, 0.07);
            for (let i = 0; i < n; i++) {
              chirp(e, birdBus, tt + i * dt, f, f * 0.84, rand(0.022, 0.034), { peak: 0.05 * v, pan });
              f *= 0.975;
            }
          } else if (kind === 1) {
            // two-note whistle ("fee-bee")
            const f = rand(3000, 3600);
            chirp(e, birdBus, tt, f, f * 0.97, rand(0.22, 0.3), { peak: 0.045 * v, pan });
            chirp(e, birdBus, tt + 0.33, f * 0.84, f * 0.82, 0.3, { peak: 0.04 * v, pan });
          } else if (kind === 2) {
            // upward chirps
            const n = 2 + ((Math.random() * 3) | 0);
            for (let i = 0; i < n; i++) chirp(e, birdBus, tt + i * 0.12, 2200, rand(3900, 4500), rand(0.05, 0.07), { peak: 0.04 * v, pan });
          } else if (kind === 3) {
            // distant dove
            const f = rand(480, 560);
            [[0, 0.35], [0.45, 0.25], [0.8, 0.5]].forEach(([d, l]) => tone(e, birdBus, tt + d, f, { type: 'soft', f1: f * 0.94, sweepDur: l, peak: 0.03 * v, a: 0.06, d: l, pan }));
          } else {
            // little song phrase
            const root = rand(2500, 3200);
            const n = 4 + ((Math.random() * 4) | 0);
            let tt2 = tt;
            for (let i = 0; i < n; i++) {
              const f = root * Math.pow(2, pickOne(SONG) / 12);
              const d = rand(0.07, 0.14);
              chirp(e, birdBus, tt2, f, f * rand(0.92, 1.08), d, { peak: 0.04 * v, pan });
              tt2 += d + rand(0.02, 0.06);
            }
          }
        });
      };
      const owl = (tt) => {
        event(ac, nightLevel, (e) => {
          const pan = rand(-0.8, 0.8);
          tone(e, nightLevel, tt, 380, { type: 'soft', f1: 350, sweepDur: 0.35, peak: 0.06, a: 0.05, d: 0.35, pan });
          tone(e, nightLevel, tt + 0.55, 370, { type: 'soft', f1: 335, sweepDur: 0.5, peak: 0.05, a: 0.06, d: 0.5, pan });
        });
      };
      let nextBird = t + rand(0.3, 1.5);
      let nextLeaf = t;
      let nextOwl = t + rand(8, 20);
      const sched = new Scheduler(
        ac,
        (from, to) => {
          if (nextBird < from) nextBird = from;
          while (nextBird < to) {
            if (day > 0.05) call(nextBird);
            nextBird += rand(0.8, 4.5) / (0.4 + density);
          }
          if (nextLeaf < from) nextLeaf = from;
          while (nextLeaf < to) {
            lvca.gain.setTargetAtTime(rand(0.1, 0.6), nextLeaf, rand(0.4, 1.2));
            nextLeaf += rand(1, 4);
          }
          if (nextOwl < from) nextOwl = from;
          while (nextOwl < to) {
            if (night > 0.5) owl(nextOwl);
            nextOwl += rand(14, 40);
          }
        },
        { duration: num(o.duration, 20), lookahead: 1.2, interval: 0.2 },
      ).start(t);
      const apply = (now, tc) => {
        glide(leafLevel.gain, (0.05 + density * 0.12) * (0.4 + day * 0.6), now, tc);
        glide(dayLevel.gain, day * (0.55 + density * 1.05), now, tc);
        glide(nightLevel.gain, night * (0.3 + density * 0.45), now, tc);
      };
      apply(t, 0.5);
      return {
        set(p) {
          day = clamp01(num(p.day, day));
          night = clamp01(num(p.night, night));
          density = clamp01(num(p.density, density));
          apply(ac.currentTime, 1.5);
        },
        stop() {
          sched.stop();
        },
      };
    },
  },
};
