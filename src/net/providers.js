/**
 * World providers for the in-page LocalServer (PLATFORM.md §11: ONE seamless world — the
 * hand-made hub in the middle is a safe zone, the planet continues procedurally around it).
 * Mirrors server/worldgen.js so the offline world is the online world:
 *
 *   1. 'worldgen' — shared/worldgen createWorldgen({ seed, hub: { heightAt, isWater, half, radius, blend } })
 *   2. 'standin'  — shared/sim/standin.js createStandin({ seed, hub, noise: true }) until worldgen exists
 *   3. 'hub'      — only when neither loads: the bare hub heightfield; the sim adds its own rules
 *
 *   const prov = await createProviders({ seed, hub: { heightAt, isWater }, loaders: { worldgen, standin, defs } });
 *   createSim({ getHeightAt: prov.heightAt, isWater: prov.isWater, worldgen: prov.impl || undefined, … })
 *   prov = { source, impl, heightAt, isWater, isSafe, biomeAt, hubDist, hub: { half, blend, … } }
 *
 * Loaders are injected (`() => import(...)`), so this file stays pure and testable in Node.
 */
export const FALLBACK_HUB = Object.freeze({ half: 1100, blend: 300 });

async function tryLoad(load) {
  if (typeof load !== 'function') return { mod: null, err: null };
  try {
    return { mod: (await load()) || null, err: null };
  } catch (err) {
    return { mod: null, err };
  }
}

function wrap(source, impl, hub, HUB) {
  const fn = (name) => (impl && typeof impl[name] === 'function' ? impl[name].bind(impl) : null);
  const heightAt = fn('heightAt') || fn('getHeightAt');
  if (!heightAt) throw new Error(`${source}: no heightAt`);
  const inHub = (x, z) => Math.abs(x) <= HUB.half && Math.abs(z) <= HUB.half;
  const hubDist = (x, z) => {
    const d = Math.max(Math.abs(x), Math.abs(z)) - HUB.half;
    return d > 0 ? d : 0;
  };
  const isWater = fn('isWater') || ((x, z) => (inHub(x, z) ? !!hub.isWater(x, z) : heightAt(x, z) < -0.3));
  // the generator must give finite heights everywhere (a NaN would poison spawns and physics)
  for (const [x, z] of [
    [0, 150],
    [1250, 0],
    [-5000, 7000],
  ]) {
    if (!Number.isFinite(heightAt(x, z))) throw new Error(`${source}: heightAt(${x}, ${z}) is not finite`);
  }
  return {
    source,
    impl: source === 'hub' ? null : impl,
    heightAt,
    isWater,
    isSafe: fn('isSafe') || inHub,
    biomeAt: fn('biomeAt') || ((x, z) => (inHub(x, z) ? 'hub' : '')),
    hubDist: fn('hubDist') || hubDist,
    hub: HUB,
  };
}

/**
 * @param {{ seed?: string, hub: { heightAt: Function, isWater: Function },
 *           loaders?: { worldgen?: Function, standin?: Function, defs?: Function }, log?: Console }} o
 */
export async function createProviders({ seed = 'o-universe', hub, loaders = {}, log = console } = {}) {
  const hubFns = {
    heightAt: typeof hub?.heightAt === 'function' ? hub.heightAt : () => 0,
    isWater: typeof hub?.isWater === 'function' ? hub.isWater : () => false,
  };
  const defs = await tryLoad(loaders.defs);
  const HUB = defs.mod?.HUB && Number.isFinite(defs.mod.HUB.half) ? defs.mod.HUB : FALLBACK_HUB;
  const hubArg = { heightAt: hubFns.heightAt, isWater: hubFns.isWater, half: HUB.half, radius: HUB.half, blend: HUB.blend };

  const wg = await tryLoad(loaders.worldgen);
  if (wg.mod) {
    try {
      const create = wg.mod.createWorldgen || wg.mod.default?.createWorldgen;
      if (typeof create !== 'function') throw new Error('shared/worldgen has no createWorldgen export');
      return wrap('worldgen', await create({ seed, hub: hubArg }), hubFns, HUB);
    } catch (err) {
      log?.warn?.('[net/local] shared/worldgen failed — stand-in world', err);
    }
  } else if (wg.err) log?.warn?.('[net/local] shared/worldgen failed to load — stand-in world', wg.err);

  const st = await tryLoad(loaders.standin);
  if (st.mod) {
    try {
      if (typeof st.mod.createStandin !== 'function') throw new Error('shared/sim/standin.js has no createStandin export');
      return wrap('standin', st.mod.createStandin({ seed, hub: hubArg, noise: true }), hubFns, HUB);
    } catch (err) {
      log?.warn?.('[net/local] stand-in world failed — the bare hub terrain only', err);
    }
  } else if (st.err) log?.warn?.('[net/local] stand-in world failed to load — the bare hub terrain only', st.err);

  return wrap('hub', { heightAt: hubFns.heightAt, isWater: hubFns.isWater }, hubFns, HUB);
}
