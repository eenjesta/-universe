/**
 * Dev-only studio lab: the real Engine (post chain), UI facade, studio + creator
 * and portraits, without the open world (painted vista). Not part of the game.
 *   /src/characters/dev/studio.html?tab=outfit&frames=40
 */
import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import '../../ui/base.css';
import '../characters.css';
import { Engine } from '../../core/engine.js';
import { Events } from '../../core/events.js';
import { State } from '../../core/state.js';
import { Input } from '../../core/input.js';
import { UI } from '../../core/ui.js';
import { registerIcons } from '../../ui/icons.js';
import { createStudio } from '../studio.js';
import { createCreator } from '../creator.js';
import { createPortraits } from '../portraits.js';
import { normalizeAppearance } from '../appearance.js';
import { NAMED } from '../npc-roster.js';
import '../index.js'; // registers the chr-* icons

const q = Object.fromEntries(new URLSearchParams(location.search));
const canvas = document.getElementById('gl');
const events = new Events();
const state = new State(events, { persist: false });
const engine = new Engine(canvas, q.quality || 'medium');
engine.events = events;
const ctx = {
  events, state, engine, params: q, errors: [],
  input: new Input(canvas, events),
  loop: { realTime: 0, time: 0 },
  modes: { name: 'customize', is: (...n) => n.includes('customize') },
  audio: { play() {} },
  economy: null,
};
ctx.ui = new UI(ctx);
ctx.portraits = createPortraits(ctx, { resolveAppearance: (id) => normalizeAppearance(NAMED.find((n) => n.id === id)?.app || {}) });
const studio = createStudio(ctx);
const creator = createCreator(ctx, { studio, onConfirm: () => {}, onCancel: () => {} });
const app = normalizeAppearance(q.app ? JSON.parse(q.app) : {});
creator.open(app, 'Reiziger', { tab: q.tab || 'outfit' });
engine.setView(studio.scene, studio.camera);
const frames = +(q.frames || 30);
let f = 0;
function tick() {
  const dt = 1 / 30;
  ctx.loop.realTime += dt;
  studio.update(dt);
  if (q.thumbs !== '0') creator.pump();
  engine.render(dt, ctx.loop.realTime);
  ctx.input.endFrame();
  f++;
  if (f === frames) window.__game = { ready: true, debug: { info: () => ({ frames: f }) } };
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
void registerIcons;
