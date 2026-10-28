/**
 * Gathering module (Ø Universe) → ctx.gather — the core survival loop: look at a tree, rock, crystal
 * formation, plant or resource node and hold the action (E, LMB while no weapon is drawn, or the
 * touch action button): the best owned tool is drawn (ctx.player.holdTool) and swung
 * (ctx.player.playAction 'chop' | 'mine' | 'gather'); the server validates every swing
 * (C.HARVEST { feature, tool, hit } → S.FEATURE, shared/sim/economy.js), trees shake and fall,
 * rocks crack and break, plants are picked, everything regrows (src/frontier feature state).
 *
 * API (ctx.gather):
 *   available, target ({ src: 'feature'|'node', id, act, tool, ok, text } | null), active,
 *   wantsClick (LMB belongs to gathering right now — combat skips click-to-draw),
 *   nodeHarvested(node, res, mine) (src/build/harvest.js → burst + rewards), reward(pos, got),
 *   tools (models), fx, anims, hands, stop()
 * Events: gather:done { id, state, got, tool }, harvest { resource, amount, source: 'feature' }.
 * Files: controller (targeting, input, net) · anims (proxies: shake / fall / break / pick) · fx
 * (particles, debris, laser beam) · hands (holdTool / playAction + stand-in) · models (tools) ·
 * hud (+ gather.css: damage bar, floats, tips) · sounds (gather.* recipes).
 * Rules: shared/defs/tools.js. Requests: notes/gather-requests.md.
 */
import './gather.css';
import { registerGatherSounds } from './sounds.js';
import { createToolModels } from './models.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';
import { createAnims } from './anims.js';
import { createHands } from './hands.js';
import { createController } from './controller.js';

export async function install(ctx, { progress = () => {} } = {}) {
  if (!ctx.world?.scene) throw new Error('gather: ctx.world.scene missing');
  const { loop, modes } = ctx;
  const sounds = registerGatherSounds(ctx);
  const tools = createToolModels();
  const fx = createFx(ctx);
  progress(0.3);
  const hud = createHud(ctx);
  const anims = createAnims(ctx, { fx, sounds });
  const hands = createHands(ctx, tools);
  const controller = createController(ctx, { fx, hud, anims, hands });
  progress(0.7);

  const world = () => modes.is('explore', 'drive', 'title');
  // before combat (cbt-control, 21): LMB on a gatherable must not draw a weapon
  loop.add('gather', (dt) => controller.update(Math.min(dt, 0.1)), { order: 20.5 });
  loop.add(
    'gather-fx',
    (dt) => {
      const d = Math.min(dt, 0.1);
      hands.update(d);
      anims.update(d);
      fx.update(d, ctx.engine?.camera || ctx.camera);
    },
    { order: 37, when: world },
  );
  loop.add('gather-hud', (dt) => hud.update(Math.min(dt, 0.1)), { order: 94, pausable: false });

  ctx.events.on('mode:change', (e) => {
    if (e?.to !== 'explore') {
      controller.stop(false);
      hud.clear();
    }
  });

  const api = {
    available: true,
    get target() {
      return controller.target;
    },
    get active() {
      return controller.active;
    },
    get wantsClick() {
      return controller.wantsClick;
    },
    /** Resource nodes run through the gather flow (src/build/harvest.js disables its own hold-E prompt). */
    handlesNodes: true,
    nodeHarvested: (n, res, mine) => controller.nodeHarvested(n, res, mine),
    reward: (pos, got, o) => hud.reward(pos, got, o),
    stop: () => controller.stop(false),
    tools,
    fx,
    anims,
    hands,
    sounds,
    debug: controller.debug,
  };
  ctx.gather = api;
  progress(1);
  console.log(`[gather] installed (${sounds.length} sounds, frontier features: ${ctx.frontier?.features ? 'yes' : 'no'})`);
  return api;
}
