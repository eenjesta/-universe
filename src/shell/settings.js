/**
 * Player settings (`state.settings`, owned by the shell): defaults, live
 * application to engine / audio / input and a tiny change API for the
 * settings panel. Applied once at install and again whenever the state
 * changes (another module toggling creative mode, a state reset…).
 * The language (`settings.language`) is not handled here: it is read by the
 * game at boot and switched with ctx.i18n.setLanguage() (saves + reloads).
 */
export const SETTINGS_DEFAULTS = {
  quality: 'high',
  volume: 0.7,
  music: 0.5,
  sfx: 0.8,
  sensitivity: 1,
  invertY: false,
  showFps: false,
  timeFlow: true,
  creative: false,
};

/** Graphics quality presets; `label` is { en, nl } — resolve with t() where shown. */
export const QUALITY_OPTIONS = [
  { id: 'low', label: { en: 'Low', nl: 'Laag' } },
  { id: 'medium', label: { en: 'Medium', nl: 'Middel' } },
  { id: 'high', label: { en: 'High', nl: 'Hoog' } },
];

export function createSettings(ctx) {
  const { state, engine, audio, input } = ctx;
  const listeners = new Set();
  let applying = false;

  /** Fills in missing keys without emitting a flood of change events. */
  function ensure() {
    const cur = state.get('settings');
    if (!cur || typeof cur !== 'object') {
      state.set('settings', { ...SETTINGS_DEFAULTS });
      return;
    }
    for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) if (cur[k] === undefined) cur[k] = v;
  }

  const get = (key) => state.get(`settings.${key}`, SETTINGS_DEFAULTS[key]);

  function apply(key) {
    const v = get(key);
    try {
      switch (key) {
        case 'quality':
          if (engine.quality?.id !== v && v) engine.setQuality(v);
          break;
        case 'volume':
        case 'music':
        case 'sfx':
          audio.setVolumes({ master: get('volume'), music: get('music'), sfx: get('sfx') });
          break;
        case 'sensitivity':
          input.sensitivity = Number(v) || 1;
          break;
        case 'invertY':
          input.invertY = !!v;
          break;
        default:
          break; // showFps (shell overlay), timeFlow (world), creative (build) are read where used
      }
    } catch (err) {
      console.warn(`[shell] could not apply setting "${key}"`, err);
    }
  }

  function applyAll({ skipQuality = false } = {}) {
    applying = true;
    for (const key of Object.keys(SETTINGS_DEFAULTS)) {
      if (key === 'quality' && skipQuality) continue;
      apply(key);
    }
    applying = false;
    notify('*');
  }

  function set(key, value) {
    if (get(key) === value) return;
    state.set(`settings.${key}`, value); // → subscription below applies + notifies
  }

  function notify(key) {
    for (const fn of [...listeners]) {
      try {
        fn(key, key === '*' ? null : get(key));
      } catch (err) {
        console.error('[shell] settings listener failed', err);
      }
    }
  }

  /** fn(key, value) after any setting changed ('*' = everything). Returns an unsubscribe. */
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  ensure();
  // The core already applied quality/volume/sensitivity from the save at
  // startup; an explicit ?quality= URL parameter wins over the saved value.
  applyAll({ skipQuality: !!ctx.params.quality });

  state.subscribe('settings', (_v, path) => {
    if (applying) return;
    const key = path === 'settings' ? null : path.split('.')[1];
    if (key) {
      apply(key);
      notify(key);
    } else {
      ensure();
      applyAll({ skipQuality: false });
    }
  });
  ctx.events.on('state:reset', () => {
    ensure();
    applyAll({ skipQuality: false });
  });
  ctx.events.on('quality:change', () => notify('quality'));

  return { get, set, apply, applyAll, onChange, defaults: SETTINGS_DEFAULTS };
}
