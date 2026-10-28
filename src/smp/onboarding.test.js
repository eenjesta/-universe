// Survival onboarding chain (src/systems/quests/data.js) driven through the real quest engine with a
// minimal fake ctx: leave the hub → fell a tree + pick food → tools → campfire + meal → claim, shelter, bed
// → the first night (a defeat waits for the next night) → Armed and Ready → Salvage and Gear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuests, SHELTER } from '../systems/quests/data.js';
import { createQuestEngine } from '../systems/quests/engine.js';

function fakeCtx() {
  const root = {};
  const path = (k) => String(k).split('.');
  const get = (k) => path(k).reduce((o, p) => (o == null ? undefined : o[p]), root);
  const set = (k, v) => {
    const ps = path(k);
    let o = root;
    for (const p of ps.slice(0, -1)) o = o[p] ??= {};
    o[ps.at(-1)] = v;
  };
  const handlers = new Map();
  const events = {
    on(n, fn) {
      if (!handlers.has(n)) handlers.set(n, []);
      handlers.get(n).push(fn);
      return () => {};
    },
    emit(n, p) {
      for (const fn of handlers.get(n) || []) fn(p);
    },
  };
  const loops = [];
  const records = new Map();
  const ctx = {
    state: { get, set, ensure: (k, d) => get(k) === undefined && set(k, d), subscribe: () => () => {} },
    events,
    loop: { add: (id, fn) => loops.push(fn), time: 0 },
    audio: { play() {} },
    markers: { set() {}, remove() {} },
    modes: { is: (...m) => m.includes('explore') },
    device: { touch: false },
    player: { position: { x: 0, y: 0, z: 0 } },
    world: { timeOfDay: 12 },
    build: { registry: { records } },
    smp: {
      ready: true,
      online: true,
      me: () => 'p1',
      zone: { kind: 'safe', safe: true },
      inv: { items: {}, weapons: ['pulse-pistol'], gear: { armor: null, module: null } },
      stats: { dead: false },
      fx: {},
      claims: { list: [] },
      bedId: null,
    },
  };
  const tick = (dt = 1.1) => loops.forEach((fn) => fn(dt));
  return { ctx, tick, records, get };
}

function engine(ctx) {
  const granted = [];
  const sys = { emit() {}, on() {} };
  const api = createQuestEngine(ctx, {
    sys,
    notify: { show() {} },
    rewards: { grant: (r) => granted.push(r) },
    defs: buildQuests({ ruinsTarget: () => null, echoPoint: () => null, runeCount: () => 0 }),
  });
  return { api, granted };
}

// the engine chains follow-up quests after a 2.6 s banner pause: run those timers at once here
const realTimeout = globalThis.setTimeout;
const later = () => new Promise((r) => realTimeout(r, 5));

test('onboarding chain: definitions link up (requires / next), bilingual titles, shelter pieces', () => {
  const defs = buildQuests({ ruinsTarget: () => null, echoPoint: () => null, runeCount: () => 0 });
  const by = new Map(defs.map((d) => [d.id, d]));
  const chain = ['wild1', 'wild2', 'wild3', 'wild4', 'wild5', 'survival2', 'wild6'];
  for (let i = 0; i < chain.length; i++) {
    const d = by.get(chain[i]);
    assert.ok(d, chain[i]);
    assert.ok(typeof d.title === 'string' && d.title.length > 3);
    if (i > 0) assert.deepEqual(d.requires, [chain[i - 1]]);
    if (i < chain.length - 1) assert.deepEqual(d.next, [chain[i + 1]]);
  }
  assert.equal(by.has('survival'), false, 'the old workbench-first chain is gone');
  for (const p of ['wall', 'door', 'flat-roof', 'floor', 'foundation']) assert.ok(SHELTER.test(p), p);
  for (const p of ['campfire', 'bed', 'workbench', 'torch']) assert.ok(!SHELTER.test(p), p);
});

test('onboarding chain: a new survivor is guided from the hub through the first night', async (tt) => {
  globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, ms >= 2000 ? 0 : ms, ...a);
  tt.after(() => (globalThis.setTimeout = realTimeout));
  const { ctx, tick, records } = fakeCtx();
  const { api, granted } = engine(ctx);
  const ev = ctx.events;
  tick();
  assert.equal(api.isActive('wild1'), true, 'starts when the survival server is ready');
  assert.equal(api.activeId, 'wild1');
  // the single-player "Build a Home" quest stays out of the way online
  ev.emit('build:mode', { active: true });
  assert.equal(api.has('home'), false);

  // 1 — leave the hub, fell a tree, pick food
  tick();
  assert.equal(api.objectiveDone('wild1', 'leave'), false);
  ctx.smp.zone = { kind: 'wild', safe: false };
  tick();
  assert.equal(api.objectiveDone('wild1', 'leave'), true);
  ev.emit('gather:done', { state: 'picked', got: { items: { fiber: 2 } } });
  assert.equal(api.objectiveDone('wild1', 'food'), false, 'fiber is not food');
  ev.emit('gather:done', { state: 'felled', got: { res: { wood: 12 } } });
  ev.emit('gather:done', { state: 'picked', got: { items: { berries: 3 } } });
  assert.equal(api.isDone('wild1'), true);
  await later(); // follow-ups start after the completion banner
  assert.equal(api.isActive('wild2'), true);
  assert.equal(api.activeId, 'wild2');

  // 2 — tools (owning one already counts), break a rock
  ctx.smp.inv.items.axe = 1;
  tick();
  assert.equal(api.objectiveDone('wild2', 'axe'), true);
  ev.emit('smp:crafted', { recipe: 'pickaxe', n: 1 });
  ev.emit('gather:done', { state: 'broken', got: { res: { stone: 5 } } });
  assert.equal(api.isDone('wild2'), true);
  await later();

  // 3 — campfire, cook, eat a meal (raw berries don't count)
  records.set('s1', { id: 's1', type: 'campfire', owner: 'p1', x: 10, y: 0, z: 10 });
  tick();
  assert.equal(api.objectiveDone('wild3', 'fire'), true);
  ev.emit('smp:cooked', { struct: 's1', got: { 'fruit-skewer': 1 } });
  ev.emit('smp:ate', { item: 'berries' });
  assert.equal(api.objectiveDone('wild3', 'eat'), false);
  ev.emit('smp:ate', { item: 'fruit-skewer' });
  assert.equal(api.isDone('wild3'), true);
  await later();

  // 4 — claim, shelter (6 pieces), sleep
  ev.emit('build:placed', { piece: 'claim-beacon' });
  for (const piece of ['foundation', 'wall', 'wall', 'door', 'campfire', 'wall']) ev.emit('build:placed', { piece });
  assert.equal(api.get('wild4').objectives.find((o) => o.id === 'shelter').progress, 5);
  ev.emit('build:placed', { piece: 'flat-roof' });
  records.set('s2', { id: 's2', type: 'bed', owner: 'p1', x: 12, y: 0, z: 9 });
  ctx.smp.bedId = 's2';
  ev.emit('smp:slept', { struct: 's2' });
  assert.equal(api.isDone('wild4'), true);
  await later();

  // 5 — the first night: warm by the fire at night, a defeat waits for the next night, dawn completes
  assert.equal(api.isActive('wild5'), true);
  assert.deepEqual(api.currentTarget()?.position && { x: api.currentTarget().position.x, z: api.currentTarget().position.z }, { x: 12, z: 9 }, 'marker: home');
  ctx.smp.fx = { warm: 1 };
  tick();
  assert.equal(api.objectiveDone('wild5', 'night'), false, 'not night yet');
  ctx.world.timeOfDay = 21;
  tick();
  assert.equal(api.objectiveDone('wild5', 'night'), true);
  ctx.smp.stats.dead = true;
  tick();
  ctx.smp.stats.dead = false;
  ctx.world.timeOfDay = 6;
  tick();
  assert.equal(api.isDone('wild5'), false, 'fell during the night → try again');
  ctx.world.timeOfDay = 22;
  tick();
  ctx.world.timeOfDay = 6.5;
  tick();
  assert.equal(api.isDone('wild5'), true);
  await later();
  assert.equal(api.isActive('survival2'), true);
  assert.equal(granted.length, 5);
  assert.ok(granted.every((r) => r.credits > 0 && r.xp > 0));
});
