/**
 * Player progression: XP, levels and zone discovery (state.progress
 * {xp, level, discovered}). Discovering a zone for the first time shows the
 * poster banner "Location discovered: Lookout" + "+250 XP".
 */
import { ZONES } from '../world/layout.js';
import { t } from '../core/i18n.js';
import { fmt } from './shared/util.js';

/** XP granted for discovering each zone. */
const DISCOVERY_XP = { spawn: 100, lookout: 250, ruins: 250, signal: 250, waterfall: 250, base: 200, plaza: 250, spaceport: 250, city: 400 };

/** Cumulative XP needed to reach `level` (L2 = 600, L3 = 1500, L4 = 2700 …). */
export const xpForLevel = (level) => 150 * (level - 1) * (level + 2);

export function createProgress(ctx, { notify }) {
  const st = ctx.state;
  st.ensure('progress', { xp: 0, level: 1, discovered: [] });
  if (!Array.isArray(st.get('progress.discovered'))) st.set('progress.discovered', []);

  const levelOf = (xp) => {
    let l = 1;
    while (xp >= xpForLevel(l + 1)) l++;
    return l;
  };

  function addXP(amount, reason = '') {
    amount = Math.round(amount || 0);
    if (amount <= 0) return;
    const xp = st.add('progress.xp', amount);
    const prev = st.get('progress.level') || 1;
    const level = Math.max(prev, levelOf(xp));
    ctx.events.emit('progress:xp', { xp, gained: amount, reason });
    if (level > prev) {
      st.set('progress.level', level);
      const bonus = 100 * (level - prev);
      st.add('credits', bonus);
      notify.show({
        kind: 'level',
        icon: 'sys-level',
        title: t({ en: 'Level {level} reached', nl: 'Niveau {level} bereikt' }, { level }),
        sub: `+${fmt(bonus)} Ø-credits`,
        sound: 'reward',
        duration: 4200,
      });
      ctx.events.emit('progress:level', { level, prev });
    }
  }

  function isDiscovered(zoneId) {
    return (st.get('progress.discovered') || []).includes(zoneId);
  }

  /** Marks a zone discovered (banner + XP). Returns true the first time. */
  function discover(zoneId, { silent = false } = {}) {
    const zone = ZONES[zoneId];
    if (!zone || isDiscovered(zoneId)) return false;
    st.set('progress.discovered', [...(st.get('progress.discovered') || []), zoneId]);
    const xp = DISCOVERY_XP[zoneId] ?? 200;
    if (!silent) {
      notify.show({
        kind: 'discovery',
        icon: 'sys-hex',
        title: t({ en: 'Location discovered: {zone}', nl: 'Locatie ontdekt: {zone}' }, { zone: zone.label }),
        sub: `+${fmt(xp)} XP`,
        sound: 'quest.update',
        duration: 4200,
      });
    }
    ctx.events.emit('progress:discover', { zone: zoneId, xp });
    addXP(xp, 'discovery');
    return true;
  }

  return {
    get xp() {
      return st.get('progress.xp') || 0;
    },
    get level() {
      return st.get('progress.level') || 1;
    },
    get discovered() {
      return [...(st.get('progress.discovered') || [])];
    },
    /** {level, xp, from, to, t} for XP bars. */
    levelInfo() {
      const xp = st.get('progress.xp') || 0;
      const level = st.get('progress.level') || 1;
      const from = xpForLevel(level);
      const to = xpForLevel(level + 1);
      return { level, xp, from, to, t: Math.max(0, Math.min(1, (xp - from) / (to - from))) };
    },
    xpForLevel,
    addXP,
    discover,
    isDiscovered,
    discoveryXP: (id) => DISCOVERY_XP[id] ?? 200,
  };
}
