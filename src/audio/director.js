/**
 * Music + ambience director (ctx.sound.director).
 *
 * Music by mode: title/customize → music.title, explore/drive → music.explore
 * (night variant after dusk) or music.festival near the plaza while the
 * Starfall festival runs, space → music.space. Changes crossfade (~4 s).
 * Ducks music during dialogue and the pause menu.
 *
 * Ambience (title/explore/drive) is computed ~5×/s from the listener (camera):
 *   wind   stronger with altitude, height above ground and travel speed
 *   water  lake lapping by shore proximity (world.isWater rings), waterfall roar
 *          by distance to the nearest WATERFALLS entry (+ floating-island falls), panned
 *   city   distant city hum by distance to Aurora City, crowd murmur near the plaza
 *   forest birds by day / crickets + owl at night, scaled by the terrain forest map
 * Water and city loops only run while audible. Space mode runs ambient.space.
 * Quieter nights (music −25 %, wind/leaves down, crickets + owl).
 */
import { WATERFALLS, FLOATING_ISLANDS, ZONES } from '../world/layout.js';
import { clamp01, num } from './lib/dsp.js';

const MUSIC_LEVEL = { 'music.title': 0.95, 'music.explore': 0.85, 'music.space': 0.9, 'music.festival': 1 };
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1));
  return t * t * (3 - 2 * t);
};
const falloff = (d, near, far) => (d <= near ? 1 : d >= far ? 0 : Math.pow(1 - Math.log(d / near) / Math.log(far / near), 1.3));

function segDist(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-6 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  const dz = pz - (az + abz * t);
  return { d: Math.sqrt(dx * dx + dy * dy + dz * dz), x: ax + abx * t, z: az + abz * t };
}

export function createDirector(ctx) {
  const A = ctx.audio;
  const plaza = ZONES.plaza;
  const city = ZONES.city;
  const port = ZONES.spaceport.rect;
  const st = {
    mode: null,
    festival: !!ctx.worldEvents?.isActive?.('starfall'),
    dialogue: false,
    paused: false,
    dayFactor: num(ctx.world?.dayFactor, 0.45),
    music: null, // {name, handle, level, sent}
    amb: new Map(), // name → {handle, sent}
    env: { wind: 0.3, lap: 0, roar: 0, pan: 0, hum: 0, murmur: 0, forest: 0.5, plaza: 1e9, speed: 0 },
    acc: 0,
    last: null,
    override: null,
  };

  // ------------------------------------------------------------ helpers
  const night = () => 1 - smooth(0.05, 0.3, st.dayFactor);
  const day = () => smooth(0.18, 0.55, st.dayFactor);
  const isWorld = (m) => m === 'title' || m === 'explore' || m === 'drive';

  /** Terrain forest density (0..1) if the terrain exposes its coarse forest map. */
  const forestMap = (() => {
    const f = ctx.world?.terrain?.data?.forest;
    if (!f || !f.length) return null;
    const n = Math.round(Math.sqrt(f.length));
    if (n * n !== f.length) return null;
    const half = 1200;
    const step = (half * 2) / (n - 1);
    return (x, z) => {
      const i = Math.round((x + half) / step);
      const j = Math.round((z + half) / step);
      if (i < 0 || j < 0 || i >= n || j >= n) return 0;
      const v = f[j * n + i];
      return Number.isFinite(v) ? clamp01(v > 1.5 ? v / 255 : v) : 0;
    };
  })();

  function wantedMusic() {
    if (st.override) return st.override;
    const m = st.mode;
    if (m === 'title' || m === 'customize') return 'music.title';
    if (m === 'space') return 'music.space';
    if (m === 'explore' || m === 'drive') {
      const near = st.env.plaza < (st.music?.name === 'music.festival' ? 330 : 260);
      return st.festival && near ? 'music.festival' : 'music.explore';
    }
    return null;
  }

  function musicLevel(name) {
    let v = MUSIC_LEVEL[name] ?? 0.9;
    if (name === 'music.explore') v *= 1 - 0.25 * night();
    if (name === 'music.festival') v *= 1 - 0.45 * clamp01((st.env.plaza - 60) / 260);
    if (st.mode === 'customize') v *= 0.7;
    if (st.dialogue) v *= 0.45;
    if (st.paused) v *= 0.6;
    return v;
  }

  function updateMusic(fade = 2) {
    const name = wantedMusic();
    if (st.music?.name !== name) {
      if (st.music?.handle) st.music.handle.stop(3.5);
      st.music = null;
      if (name) {
        const level = musicLevel(name);
        st.music = { name, level, handle: A.loop(name, { fadeIn: 4, level, night: night() }), sent: {} };
      }
      return;
    }
    if (!st.music) return;
    const h = st.music.handle;
    const level = musicLevel(name);
    const p = {};
    if (Math.abs(level - st.music.level) > 0.01) {
      st.music.level = level;
      p.level = level;
      p.fade = fade;
    }
    if (name === 'music.explore') {
      const n = Math.round(night() * 20) / 20;
      if (n !== st.music.sent.night) p.night = st.music.sent.night = n;
    }
    if (name === 'music.festival') {
      const d = Math.round(clamp01((st.env.plaza - 60) / 260) * 20) / 20;
      if (d !== st.music.sent.distance) p.distance = st.music.sent.distance = d;
    }
    if (Object.keys(p).length) h.set(p);
  }

  function ensureAmb(name) {
    let a = st.amb.get(name);
    if (!a) {
      a = { handle: A.loop(name, {}), sent: {} };
      st.amb.set(name, a);
    }
    return a;
  }

  function dropAmb(name, fade = 2.5) {
    const a = st.amb.get(name);
    if (!a) return;
    a.handle.stop(fade);
    st.amb.delete(name);
  }

  /** Sends params only when they moved noticeably (keeps automation light). */
  function send(name, params) {
    const a = ensureAmb(name);
    let changed = false;
    for (const k in params) {
      const v = Math.round(params[k] * 100) / 100;
      if (a.sent[k] === undefined || Math.abs(a.sent[k] - v) >= 0.02) changed = true;
      params[k] = v;
    }
    if (changed) {
      Object.assign(a.sent, params);
      a.handle.set(params);
    }
  }

  /** Water and city only run while audible (hysteresis), so silent loops cost no CPU. */
  const audible = (name, v) => v > (st.amb.has(name) ? 0.01 : 0.03);

  function updateAmbience() {
    const m = st.mode;
    const e = st.env;
    const want = new Set();
    if (isWorld(m)) {
      want.add('ambient.wind');
      want.add('ambient.forest');
      if (audible('ambient.water', e.lap + e.roar)) want.add('ambient.water');
      if (audible('ambient.city', e.hum + e.murmur)) want.add('ambient.city');
    } else if (m === 'space') want.add('ambient.space');
    for (const name of [...st.amb.keys()]) if (!want.has(name)) dropAmb(name);
    if (!want.size) return;
    const duck = (st.dialogue ? 0.7 : 1) * (st.paused ? 0.45 : 1) * (m === 'title' ? 0.75 : 1);
    if (m === 'space') {
      send('ambient.space', { intensity: 0.75 * duck });
      return;
    }
    const n = night();
    const d = day();
    send('ambient.wind', { intensity: clamp01(e.wind * (1 - 0.15 * n)) * duck });
    send('ambient.forest', { day: d * duck, night: n * duck, density: e.forest });
    if (want.has('ambient.water')) send('ambient.water', { lap: e.lap * duck, roar: e.roar * duck, pan: e.pan });
    if (want.has('ambient.city')) send('ambient.city', { hum: e.hum * duck, murmur: e.murmur * duck });
  }

  // ------------------------------------------------------------ environment
  function sampleEnv(dt) {
    const w = ctx.world;
    const p = A.listener.position;
    const x = p.x;
    const y = p.y;
    const z = p.z;
    if (![x, y, z].every(Number.isFinite)) return;
    const e = st.env;
    // travel speed of the listener (vehicles, fast travel is filtered by a cap)
    if (st.last && dt > 0) {
      const v = Math.hypot(x - st.last.x, y - st.last.y, z - st.last.z) / dt;
      e.speed += ((v < 400 ? v : 0) - e.speed) * Math.min(1, dt * 2);
    }
    st.last = { x, y, z };
    let ground = 0;
    try {
      ground = num(w?.getHeightAt?.(x, z), 0);
    } catch {
      ground = 0;
    }
    const agl = Math.max(0, y - Math.max(ground, 0));
    // ---- water: shore proximity by rings of isWater samples
    let shore = 0;
    const water = typeof w?.isWater === 'function' ? w.isWater : null;
    if (water) {
      try {
        if (water(x, z)) shore = 1;
        else {
          for (const r of [6, 14, 28, 50, 85]) {
            let hit = 0;
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2;
              if (water(x + Math.cos(a) * r, z + Math.sin(a) * r)) hit++;
            }
            if (hit) {
              shore = (1 - (r - 6) / 95) * (0.55 + 0.45 * (hit / 8));
              break;
            }
          }
        }
      } catch {
        shore = 0;
      }
    }
    e.lap = clamp01(shore * clamp01(1 - (y - 4) / 55));
    // ---- waterfalls: distance to the falling sheet (lip → bottom), panned
    const q = A.listener.quaternion;
    const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const rz = 2 * (q.x * q.z - q.w * q.y);
    let roar = 0;
    let dirX = 0;
    let dirZ = 0;
    for (const f of WATERFALLS) {
      const s = segDist(x, y, z, f.lip.x, f.top, f.lip.z, f.bottom.x, 0, f.bottom.z);
      const k = Math.sqrt(f.width / 26) * falloff(s.d, 22, 430);
      if (k > roar) {
        roar = k;
        dirX = s.x - x;
        dirZ = s.z - z;
      }
    }
    for (const fi of FLOATING_ISLANDS) {
      if (!fi.fall) continue;
      let gy = 0;
      try {
        gy = num(w?.getHeightAt?.(fi.x, fi.z), 0);
      } catch {
        gy = 0;
      }
      const s = segDist(x, y, z, fi.x, fi.y - 4, fi.z, fi.x, Math.max(0, gy), fi.z);
      const k = 0.4 * falloff(s.d, 15, 280);
      if (k > roar) {
        roar = k;
        dirX = s.x - x;
        dirZ = s.z - z;
      }
    }
    e.roar = clamp01(roar);
    const dl = Math.hypot(dirX, dirZ);
    const rl = Math.hypot(rx, rz) || 1;
    e.pan = dl > 1 ? Math.max(-0.8, Math.min(0.8, ((dirX * rx + dirZ * rz) / (dl * rl)) * 0.8)) : 0;
    // ---- city hum / plaza murmur
    const dCity = Math.hypot(x - city.x, z - city.z);
    const inPort = x > port.minX - 60 && x < port.maxX + 60 && z > port.minZ - 60 && z < port.maxZ + 60;
    e.plaza = Math.hypot(x - plaza.x, z - plaza.z);
    e.hum = clamp01(clamp01(1.2 - dCity / 800) * 0.7 + (inPort ? 0.35 : 0));
    const crowd = Math.pow(clamp01(1 - (e.plaza - 25) / 160), 1.2);
    e.murmur = clamp01(crowd * (1 - 0.3 * night()) * (st.festival ? 1.3 : 1) * clamp01(1 - (agl - 12) / 40));
    // ---- wind: altitude, exposure, speed
    e.wind = clamp01(0.2 + clamp01((y - 15) / 170) * 0.55 + clamp01(agl / 60) * 0.15 + clamp01(e.speed / 70) * 0.3);
    // ---- forest life
    let dens = forestMap ? 0.25 + forestMap(x, z) * 0.75 : 0.55;
    const urban = Math.max(clamp01(1 - (e.plaza - 70) / 90), clamp01(1 - (dCity - 380) / 160), inPort ? 1 : 0);
    dens *= 1 - 0.85 * urban;
    dens *= clamp01(1 - (agl - 25) / 90);
    if (shore >= 1) dens *= 0.35;
    e.forest = clamp01(dens);
  }

  // ------------------------------------------------------------ events
  const on = (name, fn) => ctx.events.on(name, fn);
  on('mode:change', ({ to } = {}) => {
    st.mode = to;
    st.last = null;
    if (to !== 'explore' && to !== 'drive') st.dialogue = false;
    refresh();
  });
  on('world:time', ({ dayFactor } = {}) => {
    if (Number.isFinite(dayFactor)) st.dayFactor = dayFactor;
  });
  on('event:start', ({ id } = {}) => {
    if (id === 'starfall') {
      st.festival = true;
      refresh();
    }
  });
  on('event:end', ({ id } = {}) => {
    if (id === 'starfall') {
      st.festival = false;
      refresh();
    }
  });
  on('dialogue:open', () => {
    st.dialogue = true;
    refresh(0.8);
  });
  on('dialogue:close', () => {
    st.dialogue = false;
    refresh(2.5);
  });
  on('pause', ({ open } = {}) => {
    st.paused = !!open;
    refresh(0.8);
  });
  on('player:zone', () => refresh());

  function refresh(fade = 2) {
    try {
      if (isWorld(st.mode)) sampleEnv(0);
      updateMusic(fade);
      updateAmbience();
    } catch (err) {
      console.warn('[audio] director refresh failed', err);
    }
  }

  // ~5 Hz environment update; not pausable so ducking ramps keep working
  ctx.loop.add(
    'audio-director',
    (dt) => {
      const cam = ctx.engine?.camera || ctx.modes?.current?.camera;
      if (cam) A.setListener(cam);
      if (st.mode !== ctx.modes?.name) {
        st.mode = ctx.modes?.name;
        refresh();
      }
      // game dt (fixed-step simulation) or real time (slow frames cap dt at 0.05 s)
      const nowMs = performance.now();
      const real = st.lastReal ? Math.min(1, (nowMs - st.lastReal) / 1000) : 0;
      st.lastReal = nowMs;
      st.acc += Math.max(dt, real);
      if (st.acc < 0.2) return;
      const step = st.acc;
      st.acc = 0;
      if (Number.isFinite(ctx.world?.dayFactor)) st.dayFactor = ctx.world.dayFactor;
      if (st.festival !== !!ctx.worldEvents?.isActive?.('starfall') && ctx.worldEvents?.isActive) st.festival = !!ctx.worldEvents.isActive('starfall');
      if (isWorld(st.mode) && !st.paused) sampleEnv(step);
      updateMusic();
      updateAmbience();
    },
    { order: 55, pausable: false },
  );

  return {
    refresh,
    /** Forces a music loop (e.g. 'music.festival') or null to return to automatic choice. */
    setMusic(name) {
      st.override = name || null;
      refresh();
    },
    get music() {
      return st.music?.name || null;
    },
    get ambience() {
      return [...st.amb.keys()];
    },
    debug() {
      const r = (v) => Math.round(v * 100) / 100;
      return {
        mode: st.mode,
        music: st.music ? { name: st.music.name, level: r(st.music.level) } : null,
        ambience: Object.fromEntries([...st.amb].map(([k, a]) => [k, a.sent])),
        festival: st.festival,
        dialogue: st.dialogue,
        paused: st.paused,
        dayFactor: r(st.dayFactor),
        night: r(night()),
        env: Object.fromEntries(Object.entries(st.env).map(([k, v]) => [k, r(v)])),
      };
    },
  };
}
