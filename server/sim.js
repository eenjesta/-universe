/**
 * Loads the simulation factory.
 *   SIM=real  shared/sim (fail when it can't load)
 *   SIM=stub  server/simstub.js (transport tests)
 *   SIM=auto  (default) shared/sim, falling back to the stub with an error log
 *             (the stub is persistence pass-through, so saves stay intact;
 *             /healthz reports `sim: "stub"`).
 */
export async function loadSim(kind = 'auto', log) {
  if (kind === 'stub') return { createSim: (await import('./simstub.js')).createSim, kind: 'stub' };
  try {
    const mod = await import('../shared/sim/index.js');
    if (typeof mod.createSim !== 'function') throw new Error('shared/sim/index.js has no createSim export');
    return { createSim: mod.createSim, kind: 'real' };
  } catch (err) {
    if (kind === 'real') throw err;
    log.error('shared/sim failed to load — running the stub simulation (movement + chat only)', { err });
    return { createSim: (await import('./simstub.js')).createSim, kind: 'stub', error: String(err?.message || err) };
  }
}
