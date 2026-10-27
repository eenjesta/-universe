/**
 * Game-start wiring + URL hooks for the systems module:
 *   first explore entry → start "Verken de Horizon"
 *   ?dialogue=aria|oran|luna|…   ?quest=<id>   ?market   ?journal   ?event=starfall|meteors|echo
 * Hooks that need the open world switch from the title screen to explore
 * (unless ?mode=title was given explicitly) and place the player sensibly.
 */
import { ZONES } from '../world/layout.js';
import { headingTo } from './shared/util.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** ?quest=<id> deep links for quests whose objectives name no zone. */
const QUEST_ZONE = { nightmarket: 'plaza', starfall: 'plaza', lostship: 'plaza', highabove: 'spaceport', collector: 'base', meteorshower: 'spawn' };

export function installHooks(ctx, api) {
  const { quests, dialogue, economy, worldEvents, journal } = api;
  const p = ctx.params || {};

  // ---------------------------------------------------------------- first explore entry
  ctx.events.on('mode:change', ({ to }) => {
    if (to !== 'explore' || quests.has('horizon')) return;
    setTimeout(() => {
      if (!quests.has('horizon')) quests.start('horizon', { track: !quests.activeId });
    }, 1600);
  });

  // ---------------------------------------------------------------- URL hooks
  const wantsHook = p.dialogue || p.quest || p.market || p.journal || p.event;
  if (!wantsHook) return;

  async function ensureWorld(zone) {
    if (ctx.modes.is('explore', 'drive')) return;
    if (p.mode && p.mode !== 'explore') return; // an explicit ?mode=title|customize|space wins
    if (!ctx.modes.has('explore')) return;
    await ctx.modes.go('explore', { zone: zone || 'spawn' }, { fade: false });
  }

  /** Puts the player at talking distance in front of an NPC, facing it (for a dialogue deep link). */
  function standNear(npcId) {
    const n = dialogue.npcPosition?.(npcId);
    const pl = ctx.player;
    if (!n || !pl?.teleport || !ctx.modes.is('explore')) return;
    const pp = pl.position;
    if (pp && Math.hypot(pp.x - n.x, pp.z - n.z) < 3.2) return;
    const tree = dialogue.trees[npcId];
    const z = ZONES[tree?.home || 'plaza'] || ZONES.plaza;
    // Stand so the NPC's backdrop (beacon, Levensboom, ship) is framed behind it,
    // or on the zone-centre side for NPCs behind a counter (Oran).
    let back = null;
    try {
      back = tree?.backdrop?.(ctx) || null;
    } catch {
      back = null;
    }
    let dx;
    let dz;
    if (back) {
      dx = n.x - back.x;
      dz = n.z - back.z;
    } else {
      const sign = tree?.approach === 'center' ? 1 : -1;
      dx = (z.x - n.x) * sign;
      dz = (z.z - n.z) * sign;
    }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    if (len < 2) {
      dx = 0;
      dz = 1;
    }
    const d = tree?.talkDist ?? 2.3;
    const x = n.x + dx * d;
    const zz = n.z + dz * d;
    pl.teleport({ x, z: zz }, headingTo(x, zz, n.x, n.z));
  }

  /** In front of the plaza's market terminal, the Levensboom beyond it (14_marketplace.png). */
  function standAtTerminal() {
    const pl = ctx.player;
    if (!pl?.teleport || !ctx.modes.is('explore')) return;
    const t = ctx.landmarks?.plaza?.market;
    const m = t?.isVector3 ? t : ZONES.plaza.market;
    const tree = ZONES.plaza.tree;
    let dx = m.x - tree.x;
    let dz = m.z - tree.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const x = m.x + dx * 3.4 - dz * 0.8;
    const z = m.z + dz * 3.4 + dx * 0.8;
    pl.teleport({ x, z }, headingTo(x, z, m.x, m.z));
  }

  ctx.events.on('game:start', async () => {
    try {
      if (p.event) {
        const id = String(p.event);
        await ensureWorld(id === 'starfall' ? p.zone || 'plaza' : p.zone);
        worldEvents.start(id, { from: 'url' });
      }
      if (p.quest) {
        const id = String(p.quest);
        const def = quests.defs.get(id);
        // where the quest happens: its objectives' zone, else a zone trigger, else the spawn ridge
        const where = def?.objectives?.find((o) => o.zone)?.zone || def?.triggers?.find((t) => t.zone)?.zone || QUEST_ZONE[id] || 'spawn';
        await ensureWorld(p.zone || where);
        if (!quests.start(id, { track: true })) quests.track(id);
      }
      if (p.dialogue) {
        const id = String(p.dialogue);
        const home = dialogue.trees[id]?.home || 'plaza';
        await ensureWorld(p.zone || home);
        await wait(250);
        standNear(id);
        await wait(700);
        if (!(dialogue.isOpen && dialogue.current?.npc === id)) dialogue.open(id);
      }
      if (p.market) {
        await ensureWorld(p.zone || 'plaza');
        if (!p.zone) standAtTerminal();
        await wait(300);
        economy.open(typeof p.market === 'string' ? p.market : 'buy');
      }
      if (p.journal) {
        await ensureWorld(p.zone);
        await wait(300);
        journal.open(typeof p.journal === 'string' ? p.journal : null);
      }
    } catch (err) {
      console.error('[systems] URL hook failed', err);
    }
  });
}
