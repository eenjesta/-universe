/**
 * World providers (PLATFORM.md §11): everything location-specific the sim needs
 * beyond heights, injected through createSim options and normalized here.
 *
 *   createSim({ …, isSafe, spawnRules, nodesNear, isBuildable, biomeAt })   explicit functions win
 *   createSim({ …, worldgen })   a createWorldgen() instance: isSafe / spawnRules | spawnTable(biome, hour) /
 *                                nodesNear | chunk(cx, cz).features / isBuildable / biomeAt are picked up
 *   (none)                       the stand-in (standin.js) on top of the host's getHeightAt / isWater
 *
 * Normalized provider API used inside the sim (W.world):
 *   isSafe(x, z) → bool
 *   spawnRules(x, z, hour) → { biome, density, list: [{ type, w, nightOnly }] } | null
 *   nodesNear(x, z, r) → [{ id, type, resource, x, y, z }]
 *   isBuildable(x, z) → { ok, reason }
 *   biomeAt(x, z) → string
 * Provider errors never take the world down: a throwing provider counts as
 * "safe only inside the static hub square / nothing spawns / no nodes / not buildable".
 */
import { ENEMIES } from '../defs/enemies.js';
import { NODE_TYPES } from './nodes.js';
import { createStandin } from './standin.js';
import { isNum } from './util.js';
import { inHub } from '../defs/world.js';

const fn = (f) => (typeof f === 'function' ? f : null);

function warnOnce(state, what, err) {
  if (state[what]) return;
  state[what] = true;
  if (typeof console !== 'undefined') console.warn(`[sim] world provider ${what} failed:`, err?.message || err);
}

/**
 * Any reasonable spawn-table shape → { biome, density, list: [{ type, w, max?, nightOnly }] } | null.
 * Entries: 'drone' | { type | enemy | id | kind, w | weight | chance, max?, nightOnly? } |
 * tuples [type, w, max?, nightOnly?] (shared/worldgen SPAWNS). `max` = per-type cap near one player.
 */
export function normalizeTable(t) {
  if (!t) return null;
  const raw = Array.isArray(t) ? t : t.list || t.entries || t.enemies || t.spawns || null;
  if (!Array.isArray(raw)) return null;
  const list = [];
  for (const e of raw) {
    if (!e) continue;
    let type;
    let w = 1;
    let max;
    let nightOnly = false;
    if (typeof e === 'string') type = e;
    else if (Array.isArray(e)) {
      type = e[0];
      w = Number(e[1] ?? 1);
      max = Number(e[2]);
      nightOnly = !!e[3];
    } else if (typeof e === 'object') {
      type = e.type || e.enemy || e.id || e.kind;
      w = Number(e.w ?? e.weight ?? e.chance ?? 1);
      max = Number(e.max ?? e.cap);
      nightOnly = !!e.nightOnly;
    }
    if (!ENEMIES[type] || !(w > 0)) continue;
    const entry = { type, w, nightOnly };
    if (max > 0) entry.max = max;
    list.push(entry);
  }
  if (!list.length) return null;
  const density = Array.isArray(t) ? 1 : Number(t.density ?? t.rate ?? t.mult ?? 1);
  if (!(density > 0)) return null;
  return { biome: Array.isArray(t) ? undefined : biomeId(t.biome), density: Math.min(density, 6), list };
}

/** A biome as an id string (providers may return the biome object). */
export const biomeId = (b) => (b && typeof b === 'object' ? (typeof b.id === 'string' ? b.id : undefined) : b === undefined || b === null ? b : String(b));

/** A node from any provider → { id, type, resource, x, y, z, rotY, scale } | null. */
export function normalizeNode(n, H) {
  if (!n || n.id === undefined || n.id === null || !isNum(n.x) || !isNum(n.z)) return null;
  let type = NODE_TYPES[n.type] ? n.type : NODE_TYPES[n.resource] ? n.resource : NODE_TYPES[n.kind] ? n.kind : null;
  if (!type) return null;
  if (n.id !== undefined && typeof n.id === 'string' && n.type === type && isNum(n.y) && n.resource) return n; // already normal
  return { id: String(n.id), type, resource: NODE_TYPES[type].resource, x: n.x, y: isNum(n.y) ? n.y : H(n.x, n.z), z: n.z, rotY: n.rotY || 0, scale: n.scale || 1 };
}

const CHUNK_OPTS = Object.freeze({ decor: false, nodes: true, pois: false });

/** nodesNear from a worldgen chunk API (chunk(cx, cz).features with resource nodes). */
function chunkNodes(wg) {
  const size = Number(wg.CHUNK || wg.chunkSize || wg.CHUNK_SIZE || 64) || 64;
  return (x, z, r) => {
    const out = [];
    const i0 = Math.floor((x - r) / size);
    const i1 = Math.floor((x + r) / size);
    const j0 = Math.floor((z - r) / size);
    const j1 = Math.floor((z + r) / size);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const c = wg.chunk(i, j, CHUNK_OPTS); // nodes only (shared/worldgen skips decoration / POIs)
        const fs = c?.nodes || c?.features || [];
        for (const f of fs) {
          if (!f || !(f.node || f.resource || NODE_TYPES[f.type])) continue;
          const fx = f.x ?? f.p?.[0];
          const fz = f.z ?? f.p?.[2];
          if (!isNum(fx) || !isNum(fz) || Math.hypot(fx - x, fz - z) > r) continue;
          out.push({ ...f, x: fx, z: fz, y: f.y ?? f.p?.[1] });
        }
      }
    }
    return out;
  };
}

/** worldgen.spawnTable(biome, hour) → a table that knows its biome (enemies remember where they spawned). */
function tableWithBiome(wg, x, z, h) {
  const biome = fn(wg.biomeAt) ? biomeId(wg.biomeAt(x, z)) : undefined;
  const t = wg.spawnTable(biome, h, x, z);
  if (!t || biome === undefined) return t;
  if (Array.isArray(t)) return { biome, list: t };
  return t.biome === undefined ? { ...t, biome } : t;
}

/**
 * Builds the normalized provider set.
 * @param opts createSim options
 * @param base { seed, H, isWater } — the sim's terrain functions
 */
export function resolveWorld(opts, base) {
  const wg = opts.worldgen && typeof opts.worldgen === 'object' ? opts.worldgen : null;
  const standin = createStandin({ seed: base.seed, hub: { heightAt: base.H, isWater: base.isWater }, noise: false });
  const failed = {};
  const pick = (name, ...cands) => {
    for (const c of cands) if (c) return c;
    return standin[name];
  };

  const safeRaw = pick('isSafe', fn(opts.isSafe), wg && fn(wg.isSafe) && ((x, z) => wg.isSafe(x, z)));
  const biomeRaw = pick('biomeAt', fn(opts.biomeAt), wg && fn(wg.biomeAt) && ((x, z) => wg.biomeAt(x, z)));
  const spawnRaw = pick(
    'spawnRules',
    fn(opts.spawnRules),
    wg && fn(wg.spawnRules) && ((x, z, h) => wg.spawnRules(x, z, h)),
    wg && fn(wg.spawnTable) && ((x, z, h) => tableWithBiome(wg, x, z, h)),
  );
  const nodesRaw = pick('nodesNear', fn(opts.nodesNear), wg && fn(wg.nodesNear) && ((x, z, r) => wg.nodesNear(x, z, r)), wg && fn(wg.chunk) && chunkNodes(wg));
  const buildRaw = pick('isBuildable', fn(opts.isBuildable), wg && fn(wg.isBuildable) && ((x, z) => wg.isBuildable(x, z)));

  const custom = !!(opts.isSafe || opts.spawnRules || opts.nodesNear || opts.isBuildable);
  return {
    kind: wg ? (typeof wg.kind === 'string' && wg.kind ? wg.kind : 'worldgen') : custom ? 'custom' : 'standin',
    isSafe(x, z) {
      try {
        return !!safeRaw(x, z);
      } catch (err) {
        warnOnce(failed, 'isSafe', err);
        return inHub(x, z); // fall back to the static hub square
      }
    },
    biomeAt(x, z) {
      try {
        return biomeId(biomeRaw(x, z)) ?? '';
      } catch (err) {
        warnOnce(failed, 'biomeAt', err);
        return '';
      }
    },
    spawnRules(x, z, hour) {
      try {
        return normalizeTable(spawnRaw(x, z, hour));
      } catch (err) {
        warnOnce(failed, 'spawnRules', err);
        return null;
      }
    },
    nodesNear(x, z, r) {
      let list;
      try {
        list = nodesRaw(x, z, r);
      } catch (err) {
        warnOnce(failed, 'nodesNear', err);
        return [];
      }
      if (!Array.isArray(list)) return [];
      const out = [];
      for (const n of list) {
        const m = normalizeNode(n, base.H);
        if (m) out.push(m);
      }
      return out;
    },
    isBuildable(x, z) {
      let r;
      try {
        r = buildRaw(x, z);
      } catch (err) {
        warnOnce(failed, 'isBuildable', err);
        return { ok: false, reason: 'invalid' };
      }
      if (r === true || r === undefined || r === null) return { ok: true };
      if (r === false) return { ok: false, reason: 'protected' };
      return r.ok ? { ok: true } : { ok: false, reason: typeof r.reason === 'string' && r.reason ? r.reason : 'protected' };
    },
  };
}
