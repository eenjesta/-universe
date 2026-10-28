/**
 * Music loops (bus 'music'): music.title · music.explore · music.space ·
 * music.festival. Each builds a music bus (reverb, delay, chorus) and drives a
 * generative Piece from a look-ahead Scheduler.
 *
 * loop opts: { fadeIn = 3 s, level = 1, night = 0..1, duration (offline only) }
 * set({ level, fade, night, intensity, distance }) — level/fade crossfade the
 * master; night switches the explore piece at its next round; distance (0 near
 * … 1 far) muffles and thins the festival as heard from afar.
 */
import { Scheduler, num, clamp01, glide } from '../lib/dsp.js';
import { createMusicBus, setLevel } from '../music/composer.js';
import { TitlePiece, ExplorePiece, SpacePiece, FestivalPiece } from '../music/pieces.js';

function musicLoop(PieceClass, busOpts) {
  return {
    loop: true,
    bus: 'music',
    fn(g, o) {
      const ac = g.ac;
      const t = g.t;
      const bus = createMusicBus(g, busOpts);
      const piece = new PieceClass(ac, bus, { params: { night: num(o.night, 0), intensity: num(o.intensity, 1) } });
      let level = Math.max(0, num(o.level, 1));
      bus.master.gain.setValueAtTime(0, t);
      setLevel(bus, level, t, num(o.fadeIn, 3));
      const sched = new Scheduler(ac, (from, to) => piece.schedule(from, to), { interval: 0.15, lookahead: 1.2, duration: num(o.duration, 30) }).start(t + 0.08);
      return {
        piece,
        set(p) {
          const now = ac.currentTime;
          if (p.level != null) {
            const lv = Math.max(0, num(p.level, level));
            if (lv !== level) {
              level = lv;
              setLevel(bus, level, now, num(p.fade, 2));
            }
          }
          piece.setParams(p);
          if (p.distance != null) {
            const d = clamp01(num(p.distance, 0));
            glide(bus.toneLp.frequency, 9000 * Math.pow(0.1, d), now, 0.6);
          }
        },
        stop() {
          sched.stop();
        },
      };
    },
  };
}

export const MUSIC_RECIPES = {
  'music.title': musicLoop(TitlePiece, { reverb: { seconds: 4.6, decay: 3.8, bright: 0.5 }, reverbLevel: 0.95, delayTime: 0.75, delayFeedback: 0.36, delayLevel: 0.45 }),
  'music.explore': musicLoop(ExplorePiece, { reverb: { seconds: 3.8, decay: 3, bright: 0.55 }, reverbLevel: 0.85, delayTime: 0.625, delayFeedback: 0.34, delayLevel: 0.45 }),
  'music.space': musicLoop(SpacePiece, { reverb: { seconds: 6, decay: 5.2, bright: 0.42, predelay: 0.04 }, reverbLevel: 1.1, delayTime: 0.833, delayFeedback: 0.45, delayLevel: 0.5, tone: 7000 }),
  'music.festival': musicLoop(FestivalPiece, { reverb: { seconds: 2.8, decay: 2.2, bright: 0.6 }, reverbLevel: 0.6, delayTime: 0.4167, delayFeedback: 0.3, delayLevel: 0.35, tone: 11000 }),
};
