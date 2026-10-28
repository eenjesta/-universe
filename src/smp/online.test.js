// Survival bases online (the real game server, SIM real): a storage chest keeps its contents across a server
// restart; a second player sees the chest and the bed but is locked out of them, can't build in the claim, and
// shares the (public) campfire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, join, tempDir, sleep } from '../../server/testkit.js';
import { C, S } from '../../shared/protocol.js';
import { placePlayer } from '../../shared/sim/players.js';

const W = (app) => app.world.sim._w;

/** Places `piece` through the protocol and resolves with the server's record (or throws with the reason). */
async function place(c, piece, x, y, z, rot = 0) {
  const cid = `${piece}-${Math.round(x)}-${Math.round(z)}`;
  c.send({ t: C.BUILD_PLACE, piece, p: [x, y, z], rot, cid });
  const m = await c.wait((m) => (m.t === S.STRUCT || m.t === S.DENY) && m.cid === cid, 6000);
  if (m.t === S.DENY || m.ok === false) throw new Error(`${piece}: ${m.reason}`);
  return m.add[0];
}

test('online: chest contents persist across a restart; a second player sees but cannot open, sleep or build', async () => {
  const dir = tempDir('ou-survival-');
  let app = await boot({ DATA_DIR: dir, SIM: 'real' });
  let owner;
  let token;
  let chestId;
  let bedId;
  try {
    const a = await join(app, { name: 'Owner' }, { deflate: false });
    const b = await join(app, { name: 'Visitor' }, { deflate: false });
    owner = a.welcome.you.id;
    token = a.welcome.you.token;
    // the Gateway (from the hub): a random wilderness spot
    a.send({ t: C.TRAVEL, to: 'wild', cid: 'go' });
    const tr = await a.wait((m) => m.t === S.TRAVEL && m.phase === 'done', 6000);
    const [x, y, z] = tr.p;
    const w = W(app);
    const pa = w.players.get(owner);
    pa.inv.res = { metal: 500, stone: 500, wood: 500, energy: 200 };
    pa.inv.items.fiber = 40;
    pa.inv.items.berries = 9;
    const H = (dx, dz) => w.H(x + dx, z + dz);
    await place(a, 'claim-beacon', x - 5, H(-5, 0), z);
    const chest = await place(a, 'storage-chest', x + 2, H(2, 1), z + 1);
    const bed = await place(a, 'bed', x - 1, H(-1, 3), z + 3);
    const fire = await place(a, 'campfire', x + 1, H(1, 5), z + 5);
    chestId = chest.id;
    bedId = bed.id;
    assert.equal(chest.owner, owner);
    // cook on the campfire: the grill state goes to everyone near (B is still in the hub: not near)
    a.send({ t: C.STORE, struct: fire.id, op: 'cook', recipe: 'fruit-skewer', n: 1, cid: 'c1' });
    const cooking = await a.wait((m) => m.t === S.STORAGE && m.kind === 'fire' && m.ack === 'c1');
    assert.equal(cooking.cook.length, 1);
    assert.equal(cooking.cook[0].by, owner);
    assert.equal(pa.inv.items.berries, 5, '4 berries on the fire');
    // put wood + berries into the chest
    a.send({ t: C.STORE, struct: chestId, op: 'put', res: 'wood', n: 120, cid: 'p1' });
    await a.wait((m) => m.t === S.STORAGE && m.ack === 'p1');
    a.send({ t: C.STORE, struct: chestId, op: 'put', item: 'berries', n: 9, cid: 'p2' });
    const st = await a.wait((m) => m.t === S.STORAGE && m.ack === 'p2');
    assert.equal(st.res.wood, 120);
    assert.equal(st.items.berries, 5);
    assert.equal(pa.inv.items.berries || 0, 0);

    // the visitor saw the structures arrive and walks up to them (server-side move = the walk)
    await b.wait((m) => m.t === S.STRUCT && (m.add || []).some((r) => r.id === chestId), 4000);
    const pb = w.players.get(b.welcome.you.id);
    placePlayer(w, pb, { x: x + 3.5, y: H(3.5, 1), z: z + 1 });
    // a campfire is public: the visitor cooks too, and both see two grill slots in use
    pb.inv.items.berries = 4;
    b.send({ t: C.STORE, struct: fire.id, op: 'cook', recipe: 'fruit-skewer', n: 1, cid: 'c2' });
    const both = await b.wait((m) => m.t === S.STORAGE && m.kind === 'fire' && m.ack === 'c2');
    assert.deepEqual(both.cook.map((c) => c.by).sort(), [owner, b.welcome.you.id].sort());
    await a.wait((m) => m.t === S.STORAGE && m.kind === 'fire' && (m.cook || []).length === 2, 4000);
    b.send({ t: C.STORE, struct: chestId, op: 'open', cid: 'peek' });
    const deny = await b.wait((m) => m.t === S.DENY && m.cid === 'peek');
    assert.equal(deny.reason, 'private');
    assert.equal(deny.name, 'Owner');
    b.send({ t: C.STORE, struct: chestId, op: 'take', res: 'wood', n: 10, cid: 'steal' });
    assert.equal((await b.wait((m) => m.t === S.DENY && m.cid === 'steal')).reason, 'private');
    b.send({ t: C.STORE, struct: bedId, op: 'sleep', cid: 'nap' });
    assert.equal((await b.wait((m) => m.t === S.DENY && m.cid === 'nap')).reason, 'private');
    // building inside someone else's claim
    pb.inv.res = { metal: 100, stone: 100, wood: 100, energy: 50 };
    await assert.rejects(place(b, 'campfire', x + 1, H(1, -3), z - 3), /claim/);
    // the owner sleeps: home + Rested
    a.send({ t: C.STORE, struct: bedId, op: 'sleep', cid: 'zz' });
    const slept = await a.wait((m) => m.t === S.STORAGE && m.ack === 'zz');
    assert.equal(slept.kind, 'bed');
    assert.equal(pa.bedId, bedId);
    await sleep(80);
    await a.close();
    await b.close();
  } finally {
    await app.shutdown('test'); // world save
  }

  app = await boot({ DATA_DIR: dir, SIM: 'real' });
  try {
    const a2 = await join(app, { token, name: 'Owner' }, { deflate: false });
    assert.equal(a2.welcome.you.id, owner);
    const w = W(app);
    assert.ok(w.structures.has(chestId), 'the chest is still there');
    assert.equal(w.players.get(owner).bedId, bedId, 'home bed remembered');
    a2.send({ t: C.STORE, struct: chestId, op: 'open', cid: 'back' });
    const st = await a2.wait((m) => (m.t === S.STORAGE || m.t === S.DENY) && (m.ack === 'back' || m.cid === 'back'));
    assert.equal(st.t, S.STORAGE, `open after restart: ${st.reason || ''}`);
    assert.equal(st.res.wood, 120);
    assert.equal(st.items.berries, 5);
    await a2.close();
  } finally {
    await app.shutdown('test');
  }
});
