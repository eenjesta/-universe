/**
 * Mixer: registers every recipe on ctx.audio and keeps the mix healthy.
 *  - One-shots: per-name voice limit + minimum gap, a global voice cap (low
 *    priority sounds are dropped first), voice counting (a voice ends when its
 *    Graph is disposed) and a "recently played" log used by the fill-in wiring.
 *  - Loops: every live loop is tracked (name, owning mode); gameplay loops left
 *    running by another module after a mode change into a different "world"
 *    (title ↔ planet ↔ space) are faded out by a reaper after a grace period.
 *  - Output stage: core buses → mute gain → safety limiter → core master
 *    (volume) → core compressor → speakers. Installed when the AudioContext
 *    unlocks; the core graph is otherwise untouched.
 */
import { Graph } from './lib/dsp.js';
import { RECIPES, busOf } from './recipes/index.js';

const GLOBAL_LIMIT = 36;
const WORLD = (m) => (m === 'explore' || m === 'drive' ? 'world' : m === 'space' ? 'space' : 'menu');

export function createMixer(ctx) {
  const A = ctx.audio;
  const active = new Map(); // name → live voices
  const lastAt = new Map(); // name → ms of the last admitted voice
  const recent = []; // [{name, at}] newest last (one-shots only)
  const loops = new Set(); // {name, mode, created, g, inner, killed}
  const counters = { played: 0, dropped: 0, reaped: 0, voices: 0, peakVoices: 0 };
  let muted = false;
  let stage = null;

  function admit(name, spec) {
    const now = performance.now();
    if (now - (lastAt.get(name) ?? -1e9) < (spec.gap ?? 0.03) * 1000) return false;
    if ((active.get(name) || 0) >= (spec.limit ?? 6)) return false;
    if (counters.voices >= GLOBAL_LIMIT && (spec.priority ?? 1) < 2) return false;
    lastAt.set(name, now);
    return true;
  }

  function oneShot(name, spec) {
    return (ac, out, opts = {}) => {
      if (!admit(name, spec)) {
        counters.dropped++;
        return;
      }
      const g = new Graph(ac, out);
      active.set(name, (active.get(name) || 0) + 1);
      counters.voices++;
      counters.played++;
      counters.peakVoices = Math.max(counters.peakVoices, counters.voices);
      recent.push({ name, at: performance.now() });
      if (recent.length > 64) recent.shift();
      g.onDispose = () => {
        active.set(name, Math.max(0, (active.get(name) || 1) - 1));
        counters.voices = Math.max(0, counters.voices - 1);
      };
      try {
        spec.fn(g, opts);
      } catch (err) {
        g.dispose();
        throw err;
      }
    };
  }

  function looped(name, spec) {
    return (ac, out, opts = {}) => {
      const g = new Graph(ac, out);
      const entry = { name, mode: ctx.modes?.name || null, created: performance.now(), g, inner: null, killed: false };
      try {
        entry.inner = spec.fn(g, opts) || {};
      } catch (err) {
        g.dispose();
        throw err;
      }
      loops.add(entry);
      g.onDispose = () => loops.delete(entry);
      return {
        set(p) {
          if (!entry.killed) entry.inner.set?.(p);
        },
        stop() {
          try {
            entry.inner.stop?.();
          } finally {
            g.dispose();
          }
        },
      };
    };
  }

  for (const [name, spec] of Object.entries(RECIPES)) {
    A.register(name, spec.loop ? looped(name, spec) : oneShot(name, spec), { loop: !!spec.loop, bus: busOf(name, spec) });
  }

  /** True if a one-shot (not in `ignore`, or only names passing `only`) started since `t0` ms. */
  function playedSince(t0, { ignore = null, only = null } = {}) {
    for (let i = recent.length - 1; i >= 0; i--) {
      const r = recent[i];
      if (r.at < t0) return false;
      if (ignore && ignore.includes(r.name)) continue;
      if (only && !only(r.name)) continue;
      return true;
    }
    return false;
  }

  /** Fades out and stops a loop entry (used by the reaper). */
  function kill(entry) {
    if (entry.killed) return;
    entry.killed = true;
    counters.reaped++;
    try {
      const out = entry.g.out;
      out.gain.setTargetAtTime(0, entry.g.ac.currentTime, 0.12);
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        entry.inner.stop?.();
      } finally {
        entry.g.dispose();
      }
    }, 700);
  }

  // Reaper: gameplay loops (engines, scan…) left running in another world.
  ctx.events.on('mode:change', () => {
    setTimeout(() => {
      const now = WORLD(ctx.modes?.name);
      for (const e of [...loops]) {
        if (e.killed || e.name.startsWith('music') || e.name.startsWith('ambient')) continue;
        if (WORLD(e.mode) !== now) kill(e);
      }
    }, 2000);
  });

  // ------------------------------------------------------------ output stage
  function installStage() {
    if (stage || !A.ac || !A.buses?.master) return;
    const ac = A.ac;
    try {
      const mute = ac.createGain();
      mute.gain.value = muted ? 0 : 1;
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      for (const name of ['sfx', 'music', 'ui', 'ambient']) {
        const bus = A.buses[name];
        if (!bus) continue;
        bus.disconnect();
        bus.connect(mute);
      }
      mute.connect(limiter).connect(A.buses.master);
      stage = { mute, limiter };
    } catch (err) {
      console.warn('[audio] output stage not installed', err);
    }
  }
  if (A.ac) installStage();
  ctx.events.on('audio:ready', installStage);

  function setMuted(on) {
    muted = !!on;
    if (stage && A.ac) stage.mute.gain.setTargetAtTime(muted ? 0 : 1, A.ac.currentTime, 0.05);
  }

  return {
    playedSince,
    setMuted,
    get muted() {
      return muted;
    },
    get stage() {
      return stage;
    },
    loops,
    debug() {
      const byName = {};
      for (const [k, v] of active) if (v) byName[k] = v;
      const loopList = [...loops].filter((e) => !e.killed).map((e) => e.name);
      return {
        voices: counters.voices,
        voicesByName: byName,
        loops: loopList.length,
        loopNames: loopList,
        played: counters.played,
        dropped: counters.dropped,
        reaped: counters.reaped,
        peakVoices: counters.peakVoices,
        limiterReduction: stage ? Math.round(stage.limiter.reduction * 10) / 10 : 0,
      };
    },
  };
}
