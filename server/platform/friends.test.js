/** Friends: requests / accept / remove / mutual auto-accept / limits / restricted accounts / presence. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPlatform, STORE_KINDS } from './testkit.js';

for (const kind of STORE_KINDS) {
  describe(`friends (${kind})`, () => {
    let k;
    let ann;
    let bob;
    let cat;
    before(async () => {
      k = await startPlatform({ store: kind });
      ann = await k.register('ann_a');
      bob = await k.register('bob_b');
      cat = await k.register('cat_c');
    });
    after(() => k.stop());

    const friends = async (who) => (await k.call('GET', '/api/friends', undefined, { token: who.token })).body;

    test('request → pending on both sides → accept → friends', async () => {
      const r = await k.call('POST', '/api/friends/request', { username: 'Bob_B' }, { token: ann.token });
      assert.equal(r.status, 201);
      assert.equal(r.body.status, 'pending');
      assert.equal(r.body.friend.username, 'bob_b');
      assert.deepEqual((await friends(ann)).outgoing.map((x) => x.username), ['bob_b']);
      const fb = await friends(bob);
      assert.deepEqual(fb.incoming.map((x) => x.id), [ann.user.id]);
      assert.equal(fb.friends.length, 0);

      const dup = await k.call('POST', '/api/friends/request', { username: 'bob_b' }, { token: ann.token });
      assert.equal(dup.status, 409);
      assert.equal(dup.body.error.code, 'already_requested');
      const wrongSide = await k.call('POST', '/api/friends/accept', { id: bob.user.id }, { token: ann.token });
      assert.equal(wrongSide.status, 404, 'the requester cannot accept their own request');
      assert.equal(wrongSide.body.error.code, 'no_request');

      const acc = await k.call('POST', '/api/friends/accept', { id: ann.user.id }, { token: bob.token });
      assert.equal(acc.status, 200);
      assert.equal(acc.body.status, 'accepted');
      const fa = await friends(ann);
      assert.deepEqual(fa.friends.map((x) => x.username), ['bob_b']);
      assert.equal(fa.outgoing.length, 0);
      assert.ok(fa.friends[0].since > 0);
      const again = await k.call('POST', '/api/friends/request', { username: 'ann_a' }, { token: bob.token });
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'already_friends');
    });

    test('mutual requests auto-accept; accept by username works', async () => {
      const r1 = await k.call('POST', '/api/friends/request', { username: 'cat_c' }, { token: ann.token });
      assert.equal(r1.body.status, 'pending');
      const r2 = await k.call('POST', '/api/friends/request', { username: '@ann_a' }, { token: cat.token });
      assert.equal(r2.status, 200);
      assert.equal(r2.body.status, 'accepted');
      assert.deepEqual((await friends(cat)).friends.map((x) => x.username), ['ann_a']);
    });

    test('remove: unfriend, cancel and decline', async () => {
      const rm = await k.call('POST', '/api/friends/remove', { id: cat.user.id }, { token: ann.token });
      assert.equal(rm.status, 200);
      assert.equal(rm.body.removed, true);
      assert.equal((await friends(cat)).friends.length, 0);
      const again = await k.call('POST', '/api/friends/remove', { id: cat.user.id }, { token: ann.token });
      assert.equal(again.status, 404);
      // decline an incoming request
      await k.call('POST', '/api/friends/request', { username: 'bob_b' }, { token: cat.token });
      const decline = await k.call('POST', '/api/friends/remove', { username: 'cat_c' }, { token: bob.token });
      assert.equal(decline.status, 200);
      assert.equal((await friends(bob)).incoming.length, 0);
      assert.equal((await friends(cat)).outgoing.length, 0);
    });

    test('bad targets', async () => {
      const self = await k.call('POST', '/api/friends/request', { username: 'ann_a' }, { token: ann.token });
      assert.equal(self.status, 400);
      assert.equal(self.body.error.code, 'self');
      const none = await k.call('POST', '/api/friends/request', { username: 'ghost_user' }, { token: ann.token });
      assert.equal(none.status, 404);
      assert.equal(none.body.error.code, 'user_not_found');
      const junk = await k.call('POST', '/api/friends/request', { username: 42 }, { token: ann.token });
      assert.equal(junk.status, 400);
      const noReq = await k.call('POST', '/api/friends/accept', { id: cat.user.id }, { token: ann.token });
      assert.equal(noReq.status, 404);
    });

    test('under-13 accounts cannot send or receive friend requests', async () => {
      const kid = await k.register('little_lu', { birthYear: new Date(k.clock()).getUTCFullYear() - 9 });
      const out = await k.call('POST', '/api/friends/request', { username: 'ann_a' }, { token: kid.token });
      assert.equal(out.status, 403);
      assert.equal(out.body.error.code, 'restricted');
      const inc = await k.call('POST', '/api/friends/request', { username: 'little_lu' }, { token: ann.token });
      assert.equal(inc.status, 403);
      assert.equal(inc.body.error.code, 'restricted');
      assert.equal((await friends(kid)).restricted, true);
      assert.equal((await friends(ann)).restricted, false);
    });

    test('presence: API activity, setPresence from the game server, offline', async () => {
      const status = async () => (await friends(ann)).friends.find((f) => f.username === 'bob_b');
      assert.equal((await status()).status, 'online', 'bob used the API a moment ago');
      k.clock.advance(5 * 60e3);
      assert.equal((await status()).status, 'offline');
      k.platform.setPresence(bob.user.id, 'in-game');
      let s = await status();
      assert.equal(s.status, 'in-game');
      assert.equal(s.experienceId, 'o-universe');
      assert.equal((await friends(ann)).online, 1);
      k.platform.setPresence(bob.user.id, { status: 'online' });
      assert.equal((await status()).status, 'online');
      k.platform.setPresence(bob.user.id, 'offline');
      assert.equal((await status()).status, 'offline');
      // the flagship listing counts in-game presence (guests too)
      k.platform.setPresence(bob.user.id, true);
      k.platform.setPresence('guest:p12', 'in-game');
      k.clock.advance(3000);
      const list = await k.call('GET', '/api/experiences');
      assert.equal(list.body.experiences[0].id, 'o-universe');
      assert.equal(list.body.experiences[0].playing, 2);
      k.platform.setPresence('guest:p12', false);
      k.clock.advance(3000);
      assert.equal((await k.call('GET', '/api/experiences')).body.experiences[0].playing, 1);
      // friends ordering: in-game before offline
      const f = (await friends(ann)).friends;
      assert.equal(f[0].status, 'in-game');
    });

    test('profiles show the friendship state', async () => {
      const p = await k.call('GET', '/api/users/bob_b', undefined, { token: ann.token });
      assert.equal(p.status, 200);
      assert.equal(p.body.user.username, 'bob_b');
      assert.equal(p.body.friendship, 'friends');
      assert.equal(p.body.status, 'in-game');
      const anon = await k.call('GET', '/api/users/bob_b');
      assert.equal(anon.body.friendship, undefined);
      assert.equal(anon.body.user.birthYear, undefined, 'public view has no birth year');
      assert.equal((await k.call('GET', '/api/users/nobody_xyz')).status, 404);
    });
  });
}
