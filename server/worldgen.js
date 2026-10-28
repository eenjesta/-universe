/**
 * The world provider for the server sim (PLATFORM.md §11): ONE seamless planet —
 * the hand-made hub in the middle (|x|, |z| ≤ HUB.half: a protected safe zone)
 * and the infinite procedural survival terrain around it.
 *
 *   const gen = await loadWorldgen({ hub, seed, log })      hub = server/terrain.js queries
 *   createSim({ getHeightAt: gen.heightAt, isWater: gen.isWater, worldgen: gen.impl, … })
 *
 * Sources, in order (WORLDGEN=auto):
 *   1. 'worldgen' — shared/worldgen/index.js createWorldgen({ seed, hub: { heightAt, isWater, … } }):
 *      the hub heightfield blended into the procedural terrain, biomes, spawn tables, resource nodes.
 *   2. 'standin'  — shared/sim/standin.js createStandin({ seed, hub, noise: true }): the hub heightfield +
 *      simple fBm terrain beyond it, stand-in spawn rules / nodes (the same one the LocalServer can use).
 *   3. 'hub'      — only when neither loads: the bare hub heightfield (clamped at its edge), safe inside
 *      the hub square; the sim adds its own rules on top.
 * WORLDGEN=worldgen|standin|hub forces one (worldgen/standin: the server refuses to start without it).
 *
 * The returned object: { source, impl, heightAt, isWater, getWaterHeightAt, isSafe, biomeAt, ms }
 * — `impl` is the generator object handed to the sim as `worldgen` (the sim picks up isSafe,
 * spawnRules | spawnTable, nodesNear | chunk, isBuildable, biomeAt from it; see shared/sim/world.js).
 */
const WORLDGEN_ENTRY = new URL('../shared/worldgen/index.js', import.meta.url);
const STANDIN_ENTRY = new URL('../shared/sim/standin.js', import.meta.url);
const DEFS_ENTRY = new URL('../shared/defs/world.js', import.meta.url);
const FALLBACK_HUB = { half: 1100, blend: 300 };
const PROBES = [
  [0, 150],
  [1250, 0],
  [0, -2600],
  [-5000, 7000],
  [31000, -27000],
];

async function hubDefs() {
  try {
    const { HUB } = await import(DEFS_ENTRY.href);
    if (HUB && Number.isFinite(HUB.half)) return HUB;
  } catch {}
  return FALLBACK_HUB;
}

const missingModule = (err, entry) => err?.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes(new URL(entry).pathname);

/** Wraps a generator object in the provider surface the server uses (and checks it for NaN heights). */
function wrap(source, impl, hub, HUB, waterLevel) {
  const fn = (name) => (typeof impl[name] === 'function' ? impl[name].bind(impl) : null);
  const heightAt = fn('heightAt') || fn('getHeightAt');
  if (!heightAt) throw new Error(`${source}: no heightAt`);
  const inHub = (x, z) => Math.abs(x) <= HUB.half && Math.abs(z) <= HUB.half;
  const isWater = fn('isWater') || ((x, z) => (inHub(x, z) ? hub.isWater(x, z) : heightAt(x, z) < waterLevel - 0.3));
  const isSafe = fn('isSafe') || inHub;
  const hubWaterH = hub.getWaterHeightAt || (() => null);
  const provider = {
    source,
    impl: source === 'hub' ? null : impl, // 'hub': no generator — the sim applies its own stand-in rules
    heightAt,
    isWater,
    getWaterHeightAt: fn('getWaterHeightAt') || ((x, z) => (inHub(x, z) ? hubWaterH(x, z) : heightAt(x, z) < waterLevel ? waterLevel : null)),
    isSafe,
    biomeAt: fn('biomeAt') || ((x, z) => (inHub(x, z) ? 'hub' : '')),
    hub: HUB,
  };
  for (const [x, z] of PROBES) {
    const h = provider.heightAt(x, z);
    if (!Number.isFinite(h)) throw new Error(`${source}: heightAt(${x}, ${z}) = ${h}`);
  }
  return provider;
}

/**
 * @param {{ hub: {getHeightAt, isWater, getWaterHeightAt?}, seed: string, log, waterLevel?: number,
 *           mode?: 'auto'|'worldgen'|'standin'|'hub' }} o
 */
export async function loadWorldgen({ hub, seed, log, waterLevel = 0, mode = 'auto' }) {
  const t0 = performance.now();
  const HUB = await hubDefs();
  const hubArg = {
    heightAt: hub.getHeightAt,
    isWater: hub.isWater,
    getWaterHeightAt: hub.getWaterHeightAt,
    half: HUB.half,
    radius: HUB.half,
    blend: HUB.blend,
  };
  // the baked hub grid's half size (1200 m): shared/worldgen uses the hub heights up to there
  if (Number.isFinite(hub.grid?.HALF)) hubArg.extent = hub.grid.HALF;
  const done = (p) => {
    p.ms = Math.round(performance.now() - t0);
    log.info('world generator ready', { source: p.source, seed, ms: p.ms });
    return p;
  };

  if (mode === 'auto' || mode === 'worldgen') {
    try {
      const mod = await import(WORLDGEN_ENTRY.href);
      const create = mod.createWorldgen || mod.default?.createWorldgen;
      if (typeof create !== 'function') throw new Error('shared/worldgen/index.js has no createWorldgen export');
      return done(wrap('worldgen', await create({ seed, hub: hubArg }), hub, HUB, waterLevel));
    } catch (err) {
      if (mode === 'worldgen') throw err;
      if (missingModule(err, WORLDGEN_ENTRY)) log.info('shared/worldgen not available yet — using the stand-in world');
      else log.error('shared/worldgen failed — using the stand-in world', { err });
    }
  }
  if (mode === 'auto' || mode === 'standin') {
    try {
      const { createStandin } = await import(STANDIN_ENTRY.href);
      if (typeof createStandin !== 'function') throw new Error('shared/sim/standin.js has no createStandin export');
      return done(wrap('standin', createStandin({ seed, hub: hubArg, noise: true }), hub, HUB, waterLevel));
    } catch (err) {
      if (mode === 'standin') throw err;
      log.error('stand-in world failed — the bare hub terrain only', { err });
    }
  }
  return done(wrap('hub', { heightAt: hub.getHeightAt, isWater: hub.isWater, getWaterHeightAt: hub.getWaterHeightAt }, hub, HUB, waterLevel));
}
