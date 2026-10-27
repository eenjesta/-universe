/**
 * Granting rewards (credits, resources, XP, items, lore) and the small
 * systems-owned save key `state.systems` {lore, party, favorites, echoes}.
 */
import { t } from '../../core/i18n.js';
import { LORE } from '../story/lore.js';

export const SYSTEMS_DEFAULT = () => ({ lore: ['world'], party: [], favorites: [], echoes: 0, festivals: 0, consumed: {} });

export function createRewards(ctx, { progress, notify }) {
  const st = ctx.state;

  function ensure() {
    st.ensure('systems', SYSTEMS_DEFAULT());
    const s = st.get('systems');
    for (const [k, v] of Object.entries(SYSTEMS_DEFAULT())) if (s[k] === undefined) s[k] = v;
    st.ensure('flags', {});
    st.ensure('owned', { vehicles: [], items: [], skins: [] });
    if (!Array.isArray(st.get('owned.items'))) st.set('owned.items', []);
    if (!Array.isArray(st.get('owned.skins'))) st.set('owned.skins', []);
  }
  ensure();

  function flag(name) {
    return !!st.get('flags')?.[name];
  }
  function setFlag(name, value = true) {
    st.set(`flags.${name}`, value);
  }

  function ownsItem(id) {
    return (st.get('owned.items') || []).includes(id) || (st.get('owned.skins') || []).includes(id);
  }

  /** Adds a (non-consumable) item to state.owned.items (and owned.skins for skins). */
  function grantItem(id) {
    const items = st.get('owned.items') || [];
    if (!items.includes(id)) st.set('owned.items', [...items, id]);
    if (id.startsWith('skin-')) {
      const skins = st.get('owned.skins') || [];
      if (!skins.includes(id)) st.set('owned.skins', [...skins, id]);
    }
  }

  function removeItem(id) {
    st.set('owned.items', (st.get('owned.items') || []).filter((x) => x !== id));
    if (id.startsWith('skin-')) st.set('owned.skins', (st.get('owned.skins') || []).filter((x) => x !== id));
  }

  function hasLore(id) {
    return (st.get('systems.lore') || []).includes(id);
  }

  /** Unlocks a lore entry; returns true when it was new. */
  function unlockLore(id, { silent = false } = {}) {
    if (!LORE[id] || hasLore(id)) return false;
    st.set('systems.lore', [...(st.get('systems.lore') || []), id]);
    if (!silent) {
      notify?.show({
        kind: 'lore',
        icon: 'book',
        title: t({ en: 'New story: {title}', nl: 'Nieuw verhaal: {title}' }, { title: LORE[id].title }),
        sub: t({ en: 'Added to your journal [J]', nl: 'Toegevoegd aan je journaal [J]' }),
        duration: 3200,
      });
    }
    ctx.events.emit('lore:unlock', { id });
    return true;
  }

  /** grant({xp, credits, resources: {metal}, items: [], lore: []}) */
  function grant(r = {}, { silentLore = true } = {}) {
    if (!r) return;
    if (r.credits) st.add('credits', r.credits);
    if (r.resources) st.gain(r.resources);
    for (const id of r.items || []) grantItem(id);
    for (const id of r.lore || []) unlockLore(id, { silent: silentLore });
    if (r.xp) progress?.addXP(r.xp, r.reason || 'reward');
  }

  return { ensure, flag, setFlag, grant, grantItem, removeItem, ownsItem, unlockLore, hasLore };
}
