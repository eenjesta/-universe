/**
 * Audio module (Ø Universe) — everything is synthesised with WebAudio.
 *
 * install(ctx) registers every recipe on ctx.audio (see recipes/*: UI, gameplay,
 * footsteps, engines, combat, ambience, generative music), starts the music +
 * ambience director and the event wiring, and returns ctx.sound:
 *
 *   ctx.sound.setMuted(bool) / .muted / .toggleMute()
 *   ctx.sound.director   music/ambience by mode, zone, time, festival, dialogue
 *                        (.music, .ambience, .refresh(), .setMusic(name|null), .debug())
 *   ctx.sound.debug()    → { ready, state, voices, voicesByName, loops, loopNames,
 *                            notes, played, dropped, reaped, director: {...} }
 *   ctx.sound.recipes    names registered on ctx.audio
 *
 * URL: ?mute starts muted. Dev lab: src/audio/dev/lab.html (offline measurements).
 */
import { RECIPES } from './recipes/index.js';
import { createMixer } from './mixer.js';
import { createDirector } from './director.js';
import { installWiring } from './wiring.js';
import { stats as musicStats } from './music/instruments.js';

export async function install(ctx) {
  const mixer = createMixer(ctx);
  const director = createDirector(ctx);
  const wiring = installWiring(ctx, mixer);
  if (ctx.params?.mute) mixer.setMuted(true);

  return {
    setMuted(on) {
      mixer.setMuted(on);
    },
    toggleMute() {
      mixer.setMuted(!mixer.muted);
      return mixer.muted;
    },
    get muted() {
      return mixer.muted;
    },
    director,
    recipes: Object.keys(RECIPES),
    fill: wiring.fill,
    debug() {
      const ac = ctx.audio.ac;
      return {
        ready: !!ctx.audio.ready,
        state: ac ? ac.state : 'locked',
        time: ac ? Math.round(ac.currentTime * 100) / 100 : 0,
        muted: mixer.muted,
        ...mixer.debug(),
        notes: musicStats.notes,
        director: director.debug(),
      };
    },
  };
}
