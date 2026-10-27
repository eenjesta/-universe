/**
 * Persistent game state (plain JSON object) with path-based get/set,
 * subscriptions and debounced localStorage persistence.
 *
 *   state.get('resources.metal')            → 124
 *   state.set('resources.metal', 100)       → emits 'state:change' {path, value, prev}
 *   state.add('resources.metal', -20)       → numeric increment
 *   state.subscribe('resources', fn)        → fn(value, path) for 'resources' and any child path
 *
 * Top-level keys are owned by modules (see ARCHITECTURE.md → "State"). Modules
 * may add their own top-level key (e.g. `space`) via `state.ensure(key, default)`.
 */

export const SAVE_KEY = 'o-universe-save-v1';

export const DEFAULT_APPEARANCE = {
  body: 'm', // 'm' | 'f'
  skin: '#c68e67',
  hair: 'swept', // see characters/appearance.js HAIR_STYLES
  hairColor: '#2a1d15',
  face: 0, // preset index
  beard: 'none',
  outfit: 'pathfinder', // see characters/appearance.js OUTFITS
  outfitColor: '#1c1f25',
  accentColor: '#d8d2c6',
  glasses: false,
};

export function defaultState() {
  return {
    version: 1,
    createdAt: 0,
    profile: { name: 'Traveler', created: false, appearance: { ...DEFAULT_APPEARANCE } },
    credits: 1250,
    resources: { metal: 124, stone: 380, wood: 215, energy: 98 },
    player: { zone: 'spawn', position: null, heading: 0, vehicle: null },
    world: { time: 17.6 }, // hours (0–24); 17.6 ≈ golden hour
    quests: { active: null, entries: {} }, // owned by systems/quests
    structures: [], // owned by build
    owned: { vehicles: ['car', 'vtol', 'ship'], items: [], skins: [] }, // owned by economy
    flags: {}, // story flags (systems/dialogue)
    progress: { xp: 0, level: 1, discovered: [] }, // XP, player level, discovered zone ids (systems)
    stats: { distance: 0, built: 0, harvested: 0, playtime: 0, kills: 0 },
    settings: {
      quality: 'high',
      language: 'en', // 'en' | 'nl' (core/i18n.js)
      volume: 0.7,
      music: 0.5,
      sfx: 0.8,
      sensitivity: 1,
      invertY: false,
      showFps: false,
      timeFlow: true,
      creative: false, // creative mode: unlimited resources while building
    },
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
  return out;
}

export class State {
  constructor(events, { persist = true } = {}) {
    this.events = events;
    this.persist = persist;
    this.data = defaultState();
    this.subs = new Map(); // prefix → Set(fn)
    this._saveTimer = null;
    this.loadedFromSave = false;
  }

  load() {
    if (!this.persist) return false;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return false;
      this.data = deepMerge(defaultState(), parsed);
      this.loadedFromSave = true;
      return true;
    } catch (err) {
      console.warn('[state] could not load save', err);
      return false;
    }
  }

  save() {
    if (!this.persist) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch (err) {
      console.warn('[state] could not save', err);
    }
  }

  /** Debounced save (1 s). Called automatically by set/add/update. */
  saveSoon() {
    if (!this.persist || this._saveTimer) return;
    this._saveTimer = setTimeout(() => this.save(), 1000);
  }

  reset() {
    this.data = defaultState();
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    this.events?.emit('state:reset', this.data);
    for (const [prefix, set] of this.subs) for (const fn of set) fn(this.get(prefix), prefix);
  }

  get(path, fallback = undefined) {
    if (!path) return this.data;
    let cur = this.data;
    for (const k of path.split('.')) {
      if (cur == null) return fallback;
      cur = cur[k];
    }
    return cur === undefined ? fallback : cur;
  }

  set(path, value) {
    const keys = path.split('.');
    let cur = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!isObj(cur[keys[i]]) && !Array.isArray(cur[keys[i]])) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    const last = keys[keys.length - 1];
    const prev = cur[last];
    cur[last] = value;
    this._notify(path, value, prev);
    this.saveSoon();
    return value;
  }

  /** Numeric increment; returns the new value. */
  add(path, delta) {
    return this.set(path, (Number(this.get(path)) || 0) + delta);
  }

  /** Mutate in place with a function, then notify. `state.update('structures', arr => { arr.push(x) })`. */
  update(path, fn) {
    const v = this.get(path);
    const ret = fn(v);
    this.set(path, ret === undefined ? v : ret);
  }

  /** Ensures a top-level (or nested) key exists with a default value. */
  ensure(path, defaultValue) {
    if (this.get(path) === undefined) this.set(path, defaultValue);
    return this.get(path);
  }

  /** Subscribe to a path prefix. Returns an unsubscribe function. */
  subscribe(prefix, fn) {
    let set = this.subs.get(prefix);
    if (!set) this.subs.set(prefix, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  _notify(path, value, prev) {
    this.events?.emit('state:change', { path, value, prev });
    for (const [prefix, set] of this.subs) {
      if (path === prefix || path.startsWith(prefix + '.') || prefix.startsWith(path + '.')) {
        const v = this.get(prefix);
        for (const fn of [...set]) {
          try {
            fn(v, path);
          } catch (err) {
            console.error('[state] subscriber failed', prefix, err);
          }
        }
      }
    }
  }

  // ------------------------------------------------- resource conveniences
  /** True if all costs ({metal: 10, …}) are affordable (always true in creative mode). */
  canAfford(cost = {}) {
    if (this.data.settings.creative) return true;
    return Object.entries(cost).every(([k, v]) =>
      k === 'credits' ? this.data.credits >= v : (this.data.resources[k] ?? 0) >= v,
    );
  }

  /** Deducts costs if affordable; returns success. */
  spend(cost = {}) {
    if (!this.canAfford(cost)) return false;
    if (this.data.settings.creative) return true;
    for (const [k, v] of Object.entries(cost)) {
      if (k === 'credits') this.add('credits', -v);
      else this.add(`resources.${k}`, -v);
    }
    return true;
  }

  /** Adds resources/credits: state.gain({metal: 5, credits: 100}). */
  gain(amounts = {}) {
    for (const [k, v] of Object.entries(amounts)) {
      if (k === 'credits') this.add('credits', v);
      else this.add(`resources.${k}`, v);
    }
  }
}
