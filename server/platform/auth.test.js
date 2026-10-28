/** Accounts: register / login / logout / me / resolveToken / guest link / age defaults. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPlatform, STORE_KINDS, YEAR } from './testkit.js';
import { hashToken } from './crypto.js';

for (const kind of STORE_KINDS) {
  describe(`auth (${kind})`, () => {
    let k;
    before(async () => {
      k = await startPlatform({ store: kind });
    });
    after(() => k.stop());

    test('register → 201 with an ous_ token and a private user view', async () => {
      const r = await k.call('POST', '/api/auth/register', { username: 'Nova_Rider', password: 'stargazer-77', birthYear: 1998 });
      assert.equal(r.status, 201);
      assert.match(r.body.token, /^ous_[A-Za-z0-9_-]{43}$/);
      const u = r.body.user;
      assert.equal(u.username, 'nova_rider', 'usernames are lower-cased');
      assert.equal(u.ageGroup, '13plus');
      assert.deepEqual(u.restrictions, { chat: false, friends: false });
      assert.equal(u.guestLinked, false);
      assert.equal(u.passwordHash, undefined, 'no secrets in responses');
      const me = await k.call('GET', '/api/me', undefined, { token: r.body.token });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.id, u.id);
    });

    test('passwords are scrypt-hashed and sessions stored as sha256', async () => {
      const r = await k.register('hash_check', { password: 'very-secret-pw-1' });
      const stored = await k.store.getUserByName('hash_check');
      assert.match(stored.passwordHash, /^scrypt\$1024\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
      assert.ok(!stored.passwordHash.includes('very-secret-pw-1'));
      const s = await k.store.getSession(hashToken(r.token));
      assert.equal(s.userId, r.user.id);
      assert.equal(await k.store.getSession(r.token), null, 'the raw token is never a key');
    });

    test('register validation', async () => {
      const bad = async (body, code, field) => {
        const r = await k.call('POST', '/api/auth/register', { username: 'valid_name', password: 'good-password-1', birthYear: 1990, ...body });
        assert.equal(r.status, code === 'name_taken' ? 409 : 400, `${JSON.stringify(body)} → ${r.text}`);
        assert.equal(r.body.error.code, code);
        if (field) assert.equal(r.body.error.field, field);
        assert.ok(r.body.error.message && r.body.error.nl, 'bilingual error');
      };
      await bad({ username: 'ab' }, 'bad_username', 'username');
      await bad({ username: 'has space' }, 'bad_username');
      await bad({ username: 'x'.repeat(21) }, 'bad_username');
      await bad({ username: '12345' }, 'bad_username');
      await bad({ username: 'kut_kid' }, 'name_filtered', 'username');
      await bad({ username: 'fuuuck_x' }, 'name_filtered');
      await bad({ username: 'admin_jan' }, 'name_filtered');
      await bad({ password: 'short' }, 'weak_password', 'password');
      await bad({ password: 'password123' }, 'weak_password');
      await bad({ password: 'aaaaaaaaaa' }, 'weak_password');
      await bad({ username: 'samsam', password: 'xx-samsam-xx' }, 'weak_password');
      await bad({ birthYear: 'abc' }, 'bad_birth_year', 'birthYear');
      await bad({ birthYear: YEAR + 1 }, 'bad_birth_year');
      await bad({ birthYear: 1800 }, 'bad_birth_year');
      await k.register('taken_name');
      await bad({ username: 'TAKEN_name' }, 'name_taken', 'username');
    });

    test('login: success, wrong password and unknown user look the same', async () => {
      const reg = await k.register('login_user', { password: 'open-sesame-42' });
      const ok = await k.call('POST', '/api/auth/login', { username: 'Login_User', password: 'open-sesame-42' });
      assert.equal(ok.status, 200);
      assert.notEqual(ok.body.token, reg.token, 'a new session per login');
      assert.equal(ok.body.user.id, reg.user.id);
      const wrong = await k.call('POST', '/api/auth/login', { username: 'login_user', password: 'open-sesame-43' });
      const unknown = await k.call('POST', '/api/auth/login', { username: 'nobody_here', password: 'open-sesame-42' });
      assert.equal(wrong.status, 401);
      assert.equal(unknown.status, 401);
      assert.equal(wrong.body.error.code, 'bad_credentials');
      assert.deepEqual(wrong.body, unknown.body);
      const empty = await k.call('POST', '/api/auth/login', {});
      assert.equal(empty.status, 401);
    });

    test('resolveToken and logout', async () => {
      const r = await k.register('token_user');
      const u = await k.platform.resolveToken(r.token);
      assert.equal(u.id, r.user.id);
      assert.equal(u.username, 'token_user');
      assert.equal(u.guestTokenHash, null);
      assert.deepEqual(u.restrictions, { chat: false, friends: false });
      assert.equal(await k.platform.resolveToken('ous_' + 'x'.repeat(43)), null);
      assert.equal(await k.platform.resolveToken('guest-token-without-prefix'), null);
      assert.equal(await k.platform.resolveToken(null), null);
      const out = await k.call('POST', '/api/auth/logout', undefined, { token: r.token });
      assert.equal(out.status, 200);
      assert.equal(await k.platform.resolveToken(r.token), null);
      const me = await k.call('GET', '/api/me', undefined, { token: r.token });
      assert.equal(me.status, 401);
      assert.equal(me.body.error.code, 'unauthorized');
    });

    test('auth is required where it should be', async () => {
      for (const [m, u] of [['GET', '/api/me'], ['GET', '/api/friends'], ['POST', '/api/auth/logout'], ['POST', '/api/experiences']]) {
        const r = await k.call(m, u, m === 'POST' ? {} : undefined);
        assert.equal(r.status, 401, `${m} ${u}`);
      }
      const garbage = await k.call('GET', '/api/me', undefined, { token: 'not-a-token-at-all' });
      assert.equal(garbage.status, 401);
    });

    test('sessions expire after 30 days without use and slide when used', async () => {
      const r = await k.register('expiry_user');
      k.clock.advance(20 * 24 * 3600e3);
      assert.equal((await k.call('GET', '/api/me', undefined, { token: r.token })).status, 200, 'used on day 20 → extended');
      k.clock.advance(20 * 24 * 3600e3);
      assert.equal((await k.call('GET', '/api/me', undefined, { token: r.token })).status, 200, 'day 40 still valid (slid)');
      k.clock.advance(31 * 24 * 3600e3);
      assert.equal((await k.call('GET', '/api/me', undefined, { token: r.token })).status, 401, 'idle 31 days → expired');
    });

    test('guest token is linked at register (sha256) and only once', async () => {
      const guestToken = 'g'.repeat(10) + 'Abc123_-xyz-guest-token';
      const r = await k.call('POST', '/api/auth/register', { username: 'from_guest', password: 'keep-progress-1', birthYear: 2001, guestToken });
      assert.equal(r.status, 201);
      assert.equal(r.body.user.guestLinked, true);
      const u = await k.platform.resolveToken(r.body.token);
      assert.equal(u.guestTokenHash, hashToken(guestToken));
      assert.equal((await k.store.getUser(u.id)).guestLinkedAt > 0, true);
      const again = await k.call('POST', '/api/auth/register', { username: 'from_guest_2', password: 'keep-progress-1', birthYear: 2001, guestToken });
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'guest_linked');
      const short = await k.call('POST', '/api/auth/register', { username: 'from_guest_3', password: 'keep-progress-1', birthYear: 2001, guestToken: 'short' });
      assert.equal(short.status, 400);
      assert.equal(short.body.error.field, 'guestToken');
    });

    test('under-13 accounts get chat + friends restricted by default (conservative year check)', async () => {
      const YEAR = new Date(k.clock()).getUTCFullYear(); // platform time (other tests move the clock)
      const kid = await k.register('young_one', { birthYear: YEAR - 10 });
      assert.equal(kid.user.ageGroup, 'under13');
      assert.deepEqual(kid.user.restrictions, { chat: true, friends: true });
      const edge = await k.register('edge_case', { birthYear: YEAR - 13 });
      assert.equal(edge.user.ageGroup, 'under13', 'could still be 12 this year');
      const teen = await k.register('teen_ager', { birthYear: YEAR - 14 });
      assert.equal(teen.user.ageGroup, '13plus');
      const viaGame = await k.platform.resolveToken(kid.token);
      assert.deepEqual(viaGame.restrictions, { chat: true, friends: true });
      // the birth year string form is accepted too
      const s = await k.call('POST', '/api/auth/register', { username: 'str_year', password: 'good-password-1', birthYear: String(YEAR - 30) });
      assert.equal(s.status, 201);
    });
  });
}
