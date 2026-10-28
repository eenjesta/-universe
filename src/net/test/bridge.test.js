// node --test src/net/test/ — the state / chat / profile bridges (bridge.js) with the real core
// State + Events and a fake connection: server INV/STATS are the truth, local reward / market
// changes become C.GRANT / C.SPEND predictions that the server's ack (or deny) settles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Events } from '../../core/events.js';
import { State } from '../../core/state.js';
import { C, S } from '../../../shared/protocol.js';
import { createBridge } from '../bridge.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup({ mode = 'local' } = {}) {
  const events = new Events();
  const state = new State(events, { persist: false });
  const sent = [];
  const posts = [];
  const system = [];
  const ctx = {
    state,
    events,
    loop: { add() {} },
    chat: { post: (from, text, o) => posts.push({ from, text, color: o?.color }), system: (text) => system.push(text), speakers: { luna: {} } },
  };
  const net = {
    hasSession: () => true,
    mode: () => mode,
    id: () => 'p1',
    chatOff: () => false,
    players: new Map([['p2', { name: 'Bob' }]]),
    dispatching: 0,
    sendRaw: (m) => {
      sent.push(m);
      bridge.onSent(m);
      return true;
    },
  };
  const bridge = createBridge(ctx, net);
  bridge.onWelcome({ t: S.WELCOME, inv: { res: { metal: 100, stone: 50, wood: 20, energy: 10 }, credits: 1000, ammo: { pulse: 48 }, items: { ration: 3 }, weapons: ['pulse-pistol'], slot: 0, mag: {}, unlocks: [] }, stats: { hp: 90, sh: 40, en: 80, maxHp: 100, maxSh: 50, maxEn: 100 } });
  return { ctx, state, events, sent, posts, system, net, bridge };
}

test('bridge: welcome inventory + stats are mirrored into state (credits, resources, smp)', () => {
  const { state } = setup();
  assert.equal(state.get('credits'), 1000);
  assert.deepEqual(state.get('resources'), { metal: 100, stone: 50, wood: 20, energy: 10 });
  assert.equal(state.get('smp.hp'), 90);
  assert.equal(state.get('smp.ammo.pulse'), 48);
  assert.deepEqual(state.get('smp.weapons'), ['pulse-pistol']);
});

test('bridge: market buy → SPEND market; the ack settles it without flicker', async () => {
  const { state, events, sent, bridge } = setup();
  state.add('credits', -150);
  state.gain({ wood: 100 });
  events.emit('market:buy', { item: 'res-wood-100', price: 150 });
  await flush();
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.t, C.SPEND);
  assert.equal(m.reason, 'market');
  assert.equal(m.id, 'res-wood-100');
  assert.deepEqual(m.cost, { credits: 150 });
  assert.equal(state.get('credits'), 850, 'the prediction shows at once');
  assert.equal(bridge.inflight, 1);
  // an unrelated server patch while in flight keeps the prediction on top
  bridge.onInv({ t: S.INV, patch: true, ammo: { pulse: 47 } });
  assert.equal(state.get('credits'), 850);
  assert.equal(state.get('resources.wood'), 120);
  bridge.onInv({ t: S.INV, patch: true, credits: 850, res: { metal: 100, stone: 50, wood: 120, energy: 10 }, ack: m.cid });
  assert.equal(bridge.inflight, 0);
  assert.equal(state.get('credits'), 850);
  assert.equal(state.get('resources.wood'), 120);
});

test('bridge: quest reward → GRANT quest (+ items); a deny rolls the prediction back', async () => {
  const { state, events, sent, bridge } = setup();
  state.add('credits', 300);
  events.emit('quest:complete', { id: 'horizon', rewards: { credits: 300, items: ['decor-statue'] } });
  await flush();
  const g = sent.find((m) => m.t === C.GRANT);
  assert.equal(g.source, 'quest');
  assert.equal(g.id, 'horizon');
  assert.equal(g.amounts.credits, 300);
  assert.deepEqual(g.amounts.items, ['decor-statue']);
  assert.equal(state.get('credits'), 1300);
  bridge.onDeny({ t: S.DENY, of: C.GRANT, reason: 'granted', cid: g.cid });
  assert.equal(state.get('credits'), 1000, 'denied → back to the server value');
});

test('bridge: server actions and server messages are never forwarded', async () => {
  const { state, sent, net, bridge } = setup();
  // a local prediction made together with an outgoing server action (same task)
  state.spend({ metal: 10 });
  net.sendRaw({ t: C.BUILD_PLACE, piece: 'floor-metal', p: [0, 0, 0], rot: 0, cid: 'b1' });
  await flush();
  assert.deepEqual(sent.map((m) => m.t), [C.BUILD_PLACE]);
  // a change made while a server message is dispatched
  net.dispatching = 1;
  state.add('credits', 5);
  net.dispatching = 0;
  // explicit predictions
  bridge.predict(() => state.add('resources.stone', 3));
  await flush();
  assert.deepEqual(sent.map((m) => m.t), [C.BUILD_PLACE]);
});

test('bridge: unexplained changes become GRANT event / SPEND misc', async () => {
  const { state, sent } = setup();
  state.gain({ metal: 7 });
  await flush();
  state.spend({ metal: 3, credits: 10 });
  await flush();
  const [g, s] = sent;
  assert.equal(g.t, C.GRANT);
  assert.equal(g.source, 'event');
  assert.deepEqual(g.amounts, { metal: 7 });
  assert.equal(s.t, C.SPEND);
  assert.deepEqual(s.cost, { credits: 10, metal: 3 });
});

test('bridge: chat out (channels) and in (names, own echo, system lines)', () => {
  const { events, sent, posts, system, bridge } = setup({ mode: 'online' });
  events.emit('chat:sent', { text: 'hello world' });
  events.emit('chat:sent', { text: '/l over here' });
  assert.deepEqual(sent.map((m) => [m.t, m.ch, m.text]), [[C.CHAT, 'global', 'hello world'], [C.CHAT, 'local', 'over here']]);
  bridge.onChat({ t: S.CHAT, from: 'p2', name: 'Bob', text: 'hi!', ch: 'global' });
  bridge.onChat({ t: S.CHAT, from: 'p1', name: 'Me', text: 'echo', ch: 'global' });
  bridge.onChat({ t: S.CHAT, from: null, name: 'Ø', text: 'Bob joined the world', sys: 'join' });
  bridge.onChat({ t: S.CHAT, from: 'p3', name: 'luna', text: 'not the NPC', ch: 'local' });
  assert.equal(posts.length, 2);
  assert.equal(posts[0].from, 'Bob');
  assert.ok(posts[0].color);
  assert.notEqual(posts[1].from, 'luna', 'a player called like an NPC never speaks as the NPC');
  assert.ok(posts[1].from.includes('local') || posts[1].from.includes('lokaal'));
  assert.deepEqual(system, ['Bob joined the world']);
});

test('bridge: profile changes go out as C.PROFILE (debounced)', async () => {
  const { state, events, sent } = setup();
  state.set('profile.name', 'Nova');
  events.emit('customize:done', {});
  await new Promise((r) => setTimeout(r, 120));
  const p = sent.find((m) => m.t === C.PROFILE);
  assert.ok(p, 'profile sent');
  assert.equal(p.name, 'Nova');
  assert.ok(p.appearance && typeof p.appearance === 'object');
});
