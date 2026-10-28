/**
 * World rules for the survival layer (PLATFORM.md §11): where the safe hub ends,
 * where building is allowed and which wilderness resource nodes exist. After the
 * server's welcome (seed) the answers come from the SAME provider the sim uses —
 * shared/sim/world.js resolveWorld() — so ids, positions and verdicts match the server:
 *
 *   1. ctx.worldgen (the frontier/integrator's shared instance), or the LocalServer's generator
 *      (ctx.net.providers.impl) when its seed matches the welcome, or
 *   2. shared/worldgen (createWorldgen({seed, hub})) instantiated here with the server seed, or
 *   3. the sim's stand-in (shared/sim/standin.js: hub square safe, 500 m no-build buffer, 64 m node cells)
 * Before the welcome: the pure stand-in rules in zone.js.
 *
 * DEV: ?smphub=<half>[,<buffer>] overrides the stand-in (e.g. smphub=150 makes the old base
 * plot "outside the hub" so the online build flow can be tested while the play bounds and
 * the frontier terrain are not in yet). Never set in production URLs.
 *
 * rules = { half, buffer, source, provider (resolveWorld result | null), borderDist(x, z), isSafe(x, z),
 *           buildable(x, z) → null | {reason, need?}, init(welcome) → changed, sync() → changed (a shared
 *           generator appeared later), text(code, extra) → bilingual reason }
 */
import { t } from '../core/i18n.js';
import { resolveWorld } from '../../shared/sim/world.js';
import { HUB_HALF, BUILD_BUFFER, borderDist, standInBuildable, normBuildable } from './zone.js';

// the procedural world generator (another engineer); optional so smp never breaks without it
const WG = import.meta.glob('../../shared/worldgen/index.js', { eager: true });
const WGMOD = Object.values(WG)[0] || null;

export const ZTXT = {
  safeTitle: { en: 'Safe zone', nl: 'Veilige zone' },
  noBuildSafe: { en: 'No building in the safe zone — head out beyond the hub', nl: 'Niet bouwen in de veilige zone — trek verder dan de hub' },
  buffer: { en: 'Too close to the hub — build at least {m} m further out', nl: 'Te dicht bij de hub — bouw minstens {m} m verder weg' },
  bufferShort: { en: 'No-build zone around the hub', nl: 'Bouwvrije zone rond de hub' },
  highway: { en: 'Keep the highway clear — no building within 20 m of the road', nl: 'Houd de snelweg vrij — niet bouwen binnen 20 m van de weg' },
  poi: { en: 'Too close to a point of interest', nl: 'Te dicht bij een bezienswaardigheid' },
  heightHub: { en: 'Too high this close to the hub (max 16 m above the ground)', nl: 'Te hoog zo dicht bij de hub (max. 16 m boven de grond)' },
  water: { en: 'Not on the water', nl: 'Niet op het water' },
};

function parseDev(v) {
  if (v == null || v === false || v === '') return null;
  const [a, b] = String(v).split(',').map(Number);
  if (!Number.isFinite(a) || a <= 0) return null;
  return { half: a, buffer: Number.isFinite(b) && b >= 0 ? b : 0 };
}

export function createWorldRules(ctx) {
  const dev = parseDev(ctx.params?.smphub);
  const half = dev ? dev.half : HUB_HALF;
  const buffer = dev ? dev.buffer : BUILD_BUFFER;
  let own = null; // our own worldgen instance (when ctx.worldgen isn't provided)
  let tried = false;
  let prov = null; // shared/sim/world.js resolveWorld(): the sim's provider logic, client side
  let seed = null;
  const H = (x, z) => ctx.world.getHeightAt(x, z);
  const isWater = (x, z) => !!ctx.world.isWater?.(x, z);

  // an existing generator for this seed: the integrator's shared instance (frontier) or the LocalServer's
  // (ctx.net.providers.impl) — building another one costs ~0.5 s of main thread (highway routing)
  const sameSeed = (w, s, loose) => !!w && typeof w.isBuildable === 'function' && (String(w.seed) === String(s) || (loose && w.seed == null));
  const existing = (s) => (sameSeed(ctx.worldgen, s, true) ? ctx.worldgen : sameSeed(ctx.net?.providers?.impl, s, false) ? ctx.net.providers.impl : null);

  /** (Re)resolves the provider for the welcome's seed → true when it changed. */
  function init(welcome) {
    const s = String(welcome?.world?.seed ?? seed ?? 'o-universe');
    if (s !== seed) {
      own = null;
      tried = false;
    }
    let wg = existing(s);
    if (!wg && !own && !tried && typeof WGMOD?.createWorldgen === 'function') {
      tried = true;
      try {
        own = WGMOD.createWorldgen({ seed: s, hub: { heightAt: H, isWater, half: HUB_HALF, radius: HUB_HALF, blend: 300 } });
      } catch (err) {
        console.warn('[smp] worldgen unavailable, using the stand-in world rules', err);
        own = null;
      }
    }
    wg = wg || own || null;
    if (prov && seed === s && prov.wg === wg) return false;
    seed = s;
    if (wg && wg !== own) own = null; // a shared instance took over
    try {
      prov = resolveWorld({ worldgen: wg || undefined }, { seed: s, H, isWater });
      prov.wg = wg;
    } catch (err) {
      console.warn('[smp] world provider failed — stand-in rules', err);
      prov = null;
    }
    return true;
  }
  /** Picks up a shared generator that appeared after the welcome (cheap; call every few seconds). */
  function sync() {
    if (seed == null) return false;
    const wg = existing(seed);
    return !!wg && prov?.wg !== wg ? init(null) : false;
  }
  const gen = () => (dev ? null : prov);

  const rules = {
    half,
    buffer,
    dev: !!dev,
    get source() {
      return dev ? 'dev' : prov ? prov.kind : 'stand-in';
    },
    /** The resolved provider (nodesNear, isSafe, isBuildable, biomeAt, …) or null before the welcome. */
    get provider() {
      return prov;
    },
    init,
    sync,
    borderDist: (x, z) => borderDist(x, z, half),
    isSafe(x, z) {
      const g = gen();
      if (typeof g?.isSafe === 'function') {
        try {
          return !!g.isSafe(x, z);
        } catch {
          /* fall through */
        }
      }
      return borderDist(x, z, half) <= 0;
    },
    /** null = building allowed here, else {reason, need?}. */
    buildable(x, z) {
      const g = gen();
      if (typeof g?.isBuildable === 'function') {
        let r = null;
        try {
          r = normBuildable(g.isBuildable(x, z));
        } catch {
          r = standInBuildable(x, z, { half, buffer });
        }
        if (r && (r.reason === 'hub' || r.reason === 'buffer') && !Number.isFinite(r.need)) r.need = buffer - Math.max(0, borderDist(x, z, half));
        return r;
      }
      return standInBuildable(x, z, { half, buffer });
    },
    /** Player-facing text for a world-rule reason (build context). */
    text(code, extra = {}) {
      switch (code) {
        case 'safe':
        case 'safeZone':
          return t(ZTXT.noBuildSafe);
        case 'hub': // the sim's code for the §11.2 no-build buffer
        case 'buffer':
        case 'hubBuffer':
          return Number.isFinite(extra.need) && extra.need > 0 ? t(ZTXT.buffer, { m: Math.ceil(extra.need / 10) * 10 }) : t(ZTXT.bufferShort);
        case 'highway':
        case 'road':
          return t(ZTXT.highway);
        case 'poi':
          return t(ZTXT.poi);
        case 'heightHub':
          return t(ZTXT.heightHub);
        case 'water':
          return t(ZTXT.water);
        default:
          return null;
      }
    },
  };
  return rules;
}
