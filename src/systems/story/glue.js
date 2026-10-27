/**
 * Small cross-module story glue: story flags from space events, lore unlocks
 * on discoveries, and modest XP for everyday actions (building, harvesting,
 * combat, scanning) so progression keeps moving between quests.
 */
export function installGlue(ctx, { rewards, progress }) {
  const on = (name, fn) => ctx.events.on(name, (p) => {
    try {
      fn(p || {});
    } catch (err) {
      console.warn(`[systems] glue for ${name} failed`, err);
    }
  });

  on('space:dock', () => {
    rewards.setFlag('dockedHalo');
    rewards.unlockLore('halo', { silent: true });
    progress.addXP(60, 'dock');
  });
  on('space:scan', () => progress.addXP(40, 'scan'));
  on('space:kill', () => {
    ctx.state.add('stats.kills', 1);
    progress.addXP(20, 'kill');
  });
  on('build:placed', () => progress.addXP(8, 'build'));
  on('harvest', (p) => progress.addXP(p.source === 'meteor' ? 30 : 4, 'harvest'));
  // every landmark has a short story in the journal ("Stories")
  const ZONE_LORE = { city: 'aurora', lookout: 'lookout', waterfall: 'waterfall', plaza: 'plaza', spaceport: 'spaceport', base: 'base' };
  on('progress:discover', ({ zone }) => {
    if (ZONE_LORE[zone]) rewards.unlockLore(ZONE_LORE[zone], { silent: true });
  });
  on('market:buy', () => ctx.state.add('stats.purchases', 1));
}
