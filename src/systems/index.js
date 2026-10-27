/**
 * Systems module — quests, story/dialogue, chat + NPC replies, economy /
 * marketplace, world events and progression (ARCHITECTURE §5 "systems").
 *
 * install(ctx) sets ctx.quests, ctx.dialogue, ctx.chat, ctx.economy,
 * ctx.worldEvents and ctx.progress, and returns them (also stored as
 * ctx.systems). Sub-systems talk through a small internal event bus (`sys`:
 * 'zone', 'quests:changed', 'quests:dwell') and late-bound `refs`, and to the
 * rest of the game through ctx.events (see the event catalog).
 */
import { Events } from '../core/events.js';
import { registerSystemIcons } from './shared/icons.js';
import { createNotifier } from './shared/notify.js';
import { createRewards } from './shared/rewards.js';
import { createZoneTracker } from './shared/zones.js';
import { createPortraits } from './shared/portraits.js';
import { createProgress } from './progress.js';
import { buildQuests } from './quests/data.js';
import { createQuestEngine } from './quests/engine.js';
import { createTracker } from './quests/tracker.js';
import { createJournal } from './quests/journal.js';
import { createDialogue } from './story/dialogue.js';
import { createParty } from './story/party.js';
import { createRuinsScan } from './story/scan.js';
import { createSignal } from './story/signal.js';
import { installGlue } from './story/glue.js';
import { createChat } from './chat/chat.js';
import { createMarket } from './economy/market.js';
import { createWorldEvents } from './events/world-events.js';
import { installHooks } from './hooks.js';

export async function install(ctx, helpers = {}) {
  const report = helpers.progress || (() => {});
  registerSystemIcons();

  const sys = new Events(); // internal bus
  const refs = {}; // late-bound cross references between sub-systems

  const notify = createNotifier(ctx);
  const progress = createProgress(ctx, { notify });
  const rewards = createRewards(ctx, { progress, notify });
  ctx.progress = progress;
  refs.progress = progress;
  refs.zones = createZoneTracker(ctx, { sys, progress });
  report(0.15);

  // ----------------------------------------------------------- quests
  const scan = createRuinsScan(ctx, { rewards, progress });
  const defs = buildQuests({
    ruinsTarget: () => scan.targetRef(),
    runeCount: () => scan.runeCount(),
    echoPoint: () => refs.events?.echoPoint?.() || null,
    nearestFragment: () => refs.events?.nearestFragment?.() || null,
  });
  const quests = createQuestEngine(ctx, { sys, notify, rewards, defs });
  ctx.quests = quests;
  refs.quests = quests;
  createTracker(ctx, { quests, sys });
  report(0.35);

  // ----------------------------------------------------------- story
  const portraits = createPortraits(ctx);
  const dialogue = createDialogue(ctx, { refs, rewards, portraits });
  ctx.dialogue = dialogue;
  refs.dialogue = dialogue;
  const party = createParty(ctx, { trees: dialogue.trees, portraits, notify, refs });
  refs.party = party;
  createSignal(ctx, { sys, rewards, refs });
  installGlue(ctx, { rewards, progress });
  report(0.55);

  // ----------------------------------------------------------- social + economy
  const chat = createChat(ctx, { sys, refs, portraits });
  ctx.chat = chat;
  refs.chat = chat;
  const economy = createMarket(ctx, { rewards });
  ctx.economy = economy;
  refs.economy = economy;
  report(0.75);

  // ----------------------------------------------------------- world events + journal
  const worldEvents = createWorldEvents(ctx, { quests, rewards, notify, refs });
  ctx.worldEvents = worldEvents;
  refs.events = worldEvents;
  const journal = createJournal(ctx, { quests, progress, rewards, refs, sys });
  refs.journal = journal;

  ctx.events.on('state:reset', () => {
    rewards.ensure();
    notify.clear();
    quests.reset();
    party.render();
  });

  const api = { quests, dialogue, chat, economy, worldEvents, progress, party, journal, scan, notify, rewards, portraits };
  installHooks(ctx, api);
  report(1);
  return api;
}
