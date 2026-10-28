/**
 * Audio lab (dev only): renders every recipe offline (OfflineAudioContext) and
 * measures peak / RMS / active time / high-frequency ratio / NaN, so recipes can
 * be proven non-silent and non-clipping without listening, plus spectrum /
 * loudness / rhythm / click metrics (./metrics.js: centroid, energy > 2 kHz,
 * "beep" detector, laptop-speaker and A-weighted levels, blade-rate modulation).
 * Steady cases (`from`) are analysed after the smoothing settled; game cases call
 * set() at 60 Hz with instant key jumps like src/vehicles/drive.js does. WAV files
 * (e.g. shots/audio/*-before.wav) are measured the same way by wav-metrics.mjs. Driven by
 * src/audio/dev/run-lab.mjs (Playwright) or by hand in the browser console:
 *   await audioLab.run()               → all cases
 *   await audioLab.run(['laser'])      → selected labels
 *   await audioLab.wav('music.title')  → base64 16-bit WAV of that case
 */
import { RECIPES } from '../recipes/index.js';
import { Graph, offlineAt } from '../lib/dsp.js';
import { stats } from '../music/instruments.js';
import { analyse } from './metrics.js';

const SR = 44100;

const one = (name, opts = {}, label = name, seconds = 6) => ({ label, name, opts, seconds });
const loop = (name, seconds, params, auto = [], label = name, opts = {}) => ({ label, name, seconds, params, auto, opts });
/** Fixed params; analysed from `from` s on (after smoothing / fade-in settled). */
const steady = (name, params, label, seconds = 4, from = 1.6) => ({ label, name, seconds, params, auto: [], opts: {}, from });
/** Game-like driving: set(frame(t)) every 1/60 s, like src/vehicles/drive.js. */
const game = (name, seconds, frame, label) => ({ label, name, seconds, params: frame(0), auto: [], opts: {}, frame, from: 0.5 });

// key presses as the vehicles controllers produce them (digital, instant jumps)
const keys = (t, list) => {
  let v = list[0][1];
  for (const [at, x] of list) if (t >= at) v = x;
  return v;
};
const damped = (() => {
  // rotor follows its target with damp(…, 3/s) like AirController
  const memo = new Map();
  return (key, t, target, rate = 3) => {
    const m = memo.get(key);
    if (!m || t < m.t) {
      memo.set(key, { t, v: target });
      return target;
    }
    m.v = target + (m.v - target) * Math.exp(-rate * (t - m.t));
    m.t = t;
    return m.v;
  };
})();
const vtolGame = (t) => {
  const thrust = keys(t, [[0, 0.06], [0.6, 0.4], [1.8, 0.35], [2.6, 0.75], [3.6, 1], [4.4, 0.6], [5.2, 0.35], [6.2, 0.85], [6.9, 0.35]]);
  const rotor = damped('vtol', t, t < 0.6 ? 0.18 : t < 1.8 ? 1 : thrust > 0.5 ? 1 : 0.75, t < 1.8 ? 2.2 : 3);
  const speed = damped('vtol-speed', t, t < 2.6 ? 0 : thrust >= 0.75 ? (thrust === 1 ? 78 : 46) : 8, 1.5);
  return { thrust, boost: thrust === 1 ? 1 : 0, rpm: rotor, load: thrust, altitude: t < 1.8 ? 0 : 20, speed };
};
const carGame = (t) => {
  const throttle = keys(t, [[0, 0], [0.7, 1], [3, 0], [3.8, 1], [5.2, -1], [6, 0]]);
  const boost = t > 2.2 && t < 3 ? 1 : 0;
  const v = damped('car-v', t, throttle > 0 ? (boost ? 1 : 0.8) : throttle < 0 ? 0 : 0.35, throttle > 0 ? 0.9 : 1.6);
  return { rpm: Math.min(1, v * 0.85 + (throttle !== 0 ? 0.15 : 0)), load: Math.abs(throttle) * (boost ? 1 : 0.7), boost, speed: v * 40 };
};
const shipGame = (t) => ({ thrust: keys(t, [[0, 0.1], [0.8, 1], [2.5, 0.4], [3.4, 1], [5.5, 0]]), boost: t > 4 && t < 5 ? 1 : 0 });

const CASES = [
  ...['ui.click', 'ui.hover', 'ui.open', 'ui.close', 'ui.error', 'toast', 'dialogue.open', 'interact'].map((n) => one(n)),
  ...['msg', 'send', 'system', 'say'].map((v) => one('chat', { variant: v }, `chat:${v}`)),
  ...['quest.update', 'quest.complete', 'reward', 'build.place', 'build.remove', 'build.invalid', 'jump'].map((n) => one(n)),
  one('build.mode', { active: true }, 'build.mode:on'),
  one('build.mode', { active: false }, 'build.mode:off'),
  ...['metal', 'stone', 'wood', 'energy'].map((r) => one('harvest', { resource: r }, `harvest:${r}`)),
  ...['grass', 'stone', 'rock', 'metal', 'wood', 'water', 'sand'].map((s) => one('footstep', { surface: s, speed: 7 }, `footstep:${s}`)),
  one('land', { speed: 3 }, 'land:soft'),
  one('land', { speed: 18, surface: 'stone' }, 'land:hard'),
  ...['vehicle.enter', 'vehicle.exit', 'vehicle.summon', 'launch', 'laser', 'shield.hit', 'boost', 'dock', 'warp'].map((n) => one(n)),
  one('explosion', { size: 0.4 }, 'explosion:small'),
  one('explosion', { size: 1 }, 'explosion'),
  one('explosion', { size: 2 }, 'explosion:big'),
  one('explosion', { size: 1, distant: true }, 'explosion:distant'),
  loop('scan', 5, { progress: 0 }, [[1, { progress: 0.3 }], [2, { progress: 0.6 }], [3, { progress: 1 }]]),
  loop('car.engine', 6, { rpm: 0.05, load: 0 }, [[1, { rpm: 0.3, load: 0.6 }], [2.5, { rpm: 0.7, load: 1 }], [4, { rpm: 1, load: 1, boost: 1 }]]),
  loop('vtol.engine', 6, { thrust: 0, speed: 0 }, [[1.5, { thrust: 0.5, speed: 14 }], [3.5, { thrust: 1, speed: 46 }]]),
  loop('ship.engine', 6, { thrust: 0 }, [[1.5, { thrust: 0.5 }], [3, { thrust: 1 }], [4.5, { thrust: 1, boost: 1 }]]),
  // steady states (what the vehicles controllers actually send)
  steady('vtol.engine', { thrust: 0.06, rpm: 0.15, speed: 0 }, 'vtol@idle'),
  steady('vtol.engine', { thrust: 0.4, rpm: 1, speed: 0 }, 'vtol@spool'),
  steady('vtol.engine', { thrust: 0.35, rpm: 0.75, speed: 0, altitude: 6 }, 'vtol@hover'),
  steady('vtol.engine', { thrust: 0.6, rpm: 1, speed: 20, altitude: 40 }, 'vtol@climb'),
  steady('vtol.engine', { thrust: 0.75, rpm: 1, speed: 46, altitude: 60 }, 'vtol@cruise'),
  steady('vtol.engine', { thrust: 1, rpm: 1, speed: 78, boost: 1, altitude: 60 }, 'vtol@boost'),
  steady('car.engine', { rpm: 0.05, load: 0, speed: 0 }, 'car@idle'),
  steady('car.engine', { rpm: 0.45, load: 0.7, speed: 15 }, 'car@cruise'),
  steady('car.engine', { rpm: 0.85, load: 0.7, speed: 32 }, 'car@high'),
  steady('car.engine', { rpm: 1, load: 1, boost: 1, speed: 45 }, 'car@boost'),
  steady('ship.engine', { thrust: 0 }, 'ship@idle'),
  steady('ship.engine', { thrust: 0.5 }, 'ship@half'),
  steady('ship.engine', { thrust: 1 }, 'ship@full'),
  steady('ship.engine', { thrust: 1, boost: 1 }, 'ship@boost'),
  // 60 Hz set() with instant key jumps: click score must stay at the steady level
  game('vtol.engine', 7.5, vtolGame, 'vtol:game'),
  game('car.engine', 6.5, carGame, 'car:game'),
  game('ship.engine', 6, shipGame, 'ship:game'),
  loop('ambient.wind', 14, { intensity: 1 }, [], 'ambient.wind:high'),
  loop('ambient.wind', 14, { intensity: 0.3 }, [], 'ambient.wind:low'),
  loop('ambient.water', 14, { lap: 1, roar: 0 }, [], 'ambient.water:lake'),
  loop('ambient.water', 14, { lap: 0, roar: 1, pan: 0.4 }, [], 'ambient.water:fall'),
  loop('ambient.city', 14, { hum: 1, murmur: 1 }),
  loop('ambient.space', 14, { intensity: 1 }),
  loop('ambient.forest', 14, { day: 1, night: 0, density: 1 }, [], 'ambient.forest:day'),
  loop('ambient.forest', 14, { day: 0, night: 1, density: 1 }, [], 'ambient.forest:night'),
  loop('music.title', 140, { level: 1 }, [], 'music.title', { fadeIn: 0.5 }),
  loop('music.explore', 120, { level: 1 }, [], 'music.explore', { fadeIn: 0.5 }),
  loop('music.explore', 90, { level: 1 }, [], 'music.explore:night', { fadeIn: 0.5, night: 1 }),
  loop('music.space', 90, { level: 1 }, [], 'music.space', { fadeIn: 0.5 }),
  loop('music.festival', 75, { level: 1 }, [], 'music.festival', { fadeIn: 0.5 }),
];

async function render(c) {
  const ac = new OfflineAudioContext(2, Math.ceil(SR * c.seconds), SR);
  const out = ac.createGain();
  out.connect(ac.destination);
  const spec = RECIPES[c.name];
  if (!spec) throw new Error(`unknown recipe ${c.name}`);
  const g = new Graph(ac, out);
  let handle = null;
  const notes0 = stats.created;
  if (spec.loop) {
    handle = spec.fn(g, { ...c.opts, duration: c.seconds });
    if (c.params) handle.set({ ...c.params });
    let acc = { ...c.params };
    for (const [time, p] of c.auto || []) {
      offlineAt(ac, time, () => {
        acc = { ...acc, ...p };
        handle.set(acc);
      });
    }
    if (c.frame) {
      for (let k = 1; k < c.seconds * 60; k++) {
        const time = k / 60;
        offlineAt(ac, time, () => handle.set({ ...c.frame(time) }));
      }
    }
  } else {
    spec.fn(g, { ...c.opts });
  }
  const t0 = performance.now();
  const buf = await ac.startRendering();
  const ms = performance.now() - t0;
  handle?.stop?.();
  g.dispose();
  return { buf, ms, notes: stats.created - notes0 };
}

function wavBytes(buf) {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + len * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i] || 0));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const info = document.getElementById('lab-info');

window.audioLab = {
  cases: CASES.map((c) => c.label),
  recipes: Object.keys(RECIPES),
  async run(labels = null) {
    const results = [];
    for (const c of CASES) {
      if (labels && !labels.includes(c.label)) continue;
      if (info) info.textContent = `rendering ${c.label}…`;
      try {
        const { buf, ms, notes } = await render(c);
        results.push({ label: c.label, ...analyse(buf, c.from ?? 0), ms: Math.round(ms), notes });
      } catch (err) {
        results.push({ label: c.label, error: String(err?.stack || err) });
      }
    }
    if (info) info.textContent = `done: ${results.length} cases`;
    return results;
  },
  async wav(label, seconds = null) {
    const c = CASES.find((x) => x.label === label);
    if (!c) throw new Error(`no case ${label}`);
    const { buf } = await render(seconds ? { ...c, seconds } : c);
    return base64(wavBytes(buf));
  },
};
window.__game = { ready: true, lab: true };
if (info) info.textContent = `audio lab ready: ${CASES.length} cases`;
