// node --test src/platform/  — pure logic of the platform client (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUsername, checkPassword, checkBirthYear, isUnder13, cleanUsername, passwordStrength, compactNumber } from './validate.js';
import { normUser, normExperience, normExperienceList, normFriends, safeImage, resolveApiBase, createApiClient, errorText, PlatformError } from './api.js';

test('username / password / birth year checks', () => {
  assert.equal(checkUsername('ab'), 'username_short');
  assert.equal(checkUsername('a'.repeat(21)), 'username_long');
  assert.equal(checkUsername('Hi There'), null); // cleaned to hi_there
  assert.equal(cleanUsername('  Hi There '), 'hi_there');
  assert.equal(checkUsername('no-dash'), 'username_chars');
  assert.equal(checkPassword('short'), 'password_short');
  assert.equal(checkPassword('alex_1234', 'alex_1234'), 'password_same');
  assert.equal(checkPassword('correct horse'), null);
  assert.ok(passwordStrength('Tr0ub4dor&3xyz') >= 2);
  assert.equal(passwordStrength('12345678'), 0);
  const now = new Date('2026-10-27');
  assert.equal(checkBirthYear('', now), 'birth_missing');
  assert.equal(checkBirthYear('1850', now), 'birth_range');
  assert.equal(checkBirthYear('2030', now), 'birth_range');
  assert.equal(checkBirthYear('2001', now), null);
  assert.equal(isUnder13(2016, now), true);
  assert.equal(isUnder13(2012, now), false);
});

test('normalizers accept the shapes the server may send', () => {
  const u = normUser({ user: { id: 7, username: 'alex', birthYear: 2016 } });
  assert.equal(u.id, '7');
  assert.equal(u.username, 'alex');
  assert.equal(u.restricted.friends, new Date().getFullYear() - 2016 < 13);
  assert.equal(normUser({ username: 'kai', restricted: { chat: true, friends: false } }).restricted.friends, false);
  assert.equal(normUser(null), null);

  const x = normExperience({ experience: { id: 'e1', title: 'Obby', owner: { username: 'nova' }, likeCount: 3 } });
  assert.equal(x.id, 'e1');
  assert.equal(x.creator, 'nova');
  assert.equal(x.likes, 3);
  const y = normExperience({ id: 'e2', meta: { title: 'Maze' }, version: { v: 2, data: { parts: [{ id: 'p1' }] } } });
  assert.equal(y.title, 'Maze');
  assert.equal(y.data.parts.length, 1);
  assert.equal(y.published, true);
  assert.equal(normExperienceList({ experiences: [{ id: 'a' }, null, { title: 'no id' }] }).length, 1);
  assert.equal(normExperience({ id: 'o-universe' }).flagship, true);

  const f = normFriends({ friends: [{ id: 'f1', user: { username: 'kai' }, online: true }], incoming: [{ id: 'r1', from: { username: 'nova' } }], outgoing: [] });
  assert.equal(f.friends[0].username, 'kai');
  assert.equal(f.friends[0].online, true);
  assert.equal(f.incoming[0].username, 'nova');
  const g = normFriends([{ id: 'x', username: 'a', status: 'accepted' }, { id: 'y', username: 'b', status: 'pending', direction: 'in' }]);
  assert.equal(g.friends.length, 1);
  assert.equal(g.friends[0].online, false);
  assert.equal(g.incoming.length, 1);
});

test('only safe thumbnails, api base from params', () => {
  assert.equal(safeImage('https://evil.example/x.png'), null);
  assert.equal(safeImage('javascript:alert(1)'), null);
  assert.ok(safeImage('data:image/jpeg;base64,AAAA'));
  assert.ok(safeImage('/api/experiences/e1/thumbnail'));
  assert.equal(resolveApiBase({}), '');
  assert.equal(resolveApiBase({ api: 'http://127.0.0.1:8095/' }), 'http://127.0.0.1:8095');
  assert.equal(resolveApiBase({ server: 'wss://game.example/ws' }), 'https://game.example');
});

test('api client: JSON errors, offline detection, bearer token', async () => {
  const calls = [];
  const reply = (status, body, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
  let next = null;
  let lost = 0;
  const api = createApiClient({ getToken: () => 'tok', onAuthLost: () => lost++, fetchImpl: async (url, init) => (calls.push({ url, init }), next()) });
  next = () => reply(200, { user: { username: 'a' } });
  assert.equal((await api.request('/me')).user.username, 'a');
  assert.equal(calls[0].url, '/api/me');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  next = () => reply(409, { error: 'username_taken' });
  await assert.rejects(api.request('/auth/register', { method: 'POST', body: {} }), (e) => e.code === 'username_taken' && e.status === 409);
  next = () => reply(200, '<!doctype html>', 'text/html');
  await assert.rejects(api.request('/experiences'), (e) => e.code === 'offline');
  next = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(api.request('/experiences'), (e) => e.offline);
  next = () => reply(401, { error: 'unauthorized' });
  await assert.rejects(api.request('/friends'), (e) => e.status === 401);
  assert.equal(lost, 1);
  next = () => reply(200, {});
  await api.request('/experiences', { query: { sort: 'new', q: '' } });
  assert.equal(calls.at(-1).url, '/api/experiences?sort=new');
  assert.match(errorText(new PlatformError('username_taken')), /taken/);
  assert.equal(compactNumber(1234), '1.2K');
});

test('normalizers match the platform server shapes (server/platform/api.js)', () => {
  const me = normUser({ user: { id: 'u1', username: 'kid', displayName: 'kid', birthYear: 2015, ageGroup: 'under13', restrictions: { chat: true, friends: true }, guestLinked: true } });
  assert.equal(me.under13, true);
  assert.equal(me.restricted.friends, true);
  assert.equal(me.guestLinked, true);
  const adult = normUser({ user: { id: 'u2', username: 'alex', birthYear: 1990, ageGroup: '13plus', restrictions: { chat: false, friends: false } } });
  assert.equal(adult.under13, false);
  assert.equal(adult.restricted.chat, false);

  const f = normFriends({
    friends: [
      { id: 'u3', username: 'zed', displayName: 'zed', status: 'offline', experienceId: null, since: 1 },
      { id: 'u4', username: 'amy', displayName: 'amy', status: 'in-game', experienceId: 'o-universe', since: 2 },
      { id: 'u5', username: 'bob', displayName: 'bob', status: 'online', experienceId: null, since: 3 },
    ],
    incoming: [{ id: 'u6', username: 'cat', at: 5 }],
    outgoing: [],
    online: 2,
    restricted: false,
  });
  assert.deepEqual(f.friends.map((x) => x.username), ['amy', 'bob', 'zed']);
  assert.equal(f.friends[0].status, 'in-game');
  assert.equal(f.friends[0].experienceId, 'o-universe');
  assert.equal(f.friends[1].status, 'online');
  assert.equal(f.friends[2].online, false);
  assert.equal(f.incoming[0].id, 'u6'); // accept/remove take the user id

  const s = normExperience({ id: 'abc', kind: 'experience', title: 'Obby', creator: { id: 'u1', username: 'nova', displayName: 'nova' }, playing: 2, plays: 10, likes: 3, version: 2, published: true, partCount: 40, thumbnail: '/api/experiences/abc/thumbnail?v=3', updatedAt: 5 });
  assert.equal(s.creator, 'nova');
  assert.equal(s.versionNumber, 2);
  assert.equal(s.published, true);
  assert.equal(s.playing, 2);
  assert.equal(s.partCount, 40);
  assert.equal(s.thumbnail, '/api/experiences/abc/thumbnail?v=3');
  const draft = normExperience({ id: 'd1', title: 'WIP', version: 0, published: false });
  assert.equal(draft.published, false);
  const flag = normExperience({ id: 'o-universe', title: 'x', i18n: { title: { en: 'Ø Universe — SMP', nl: 'Ø Universe — SMP' }, description: { en: 'One world', nl: 'Eén wereld' } }, builtin: true, multiplayer: true });
  assert.equal(flag.flagship, true);
  assert.equal(flag.multiplayer, true);
  assert.equal(flag.description, 'One world');
  // GET /api/experiences/:id → { experience: summary, version: { v, data } }
  const res = { experience: { id: 'abc', title: 'Obby', version: 2, published: true }, version: { v: 2, createdAt: 1, partCount: 1, data: { format: 'o-universe-experience', v: 1, parts: [{ id: 'p1' }] } } };
  const full = normExperience({ ...res.experience, version: res.version });
  assert.equal(full.data.parts.length, 1);
  assert.equal(full.versionNumber, 2);
});

test('server errors are shown in the player language; client codes stay friendly', () => {
  const e = new PlatformError('name_taken', 'That username is taken.', 409, { error: { code: 'name_taken', message: 'That username is taken.', nl: 'Die gebruikersnaam is al bezet.' } });
  assert.equal(errorText(e), 'That username is taken.');
  assert.match(errorText(new PlatformError('offline')), /reach/);
  assert.equal(checkPassword('alex_rocks_99', 'alex_rocks'), 'password_same'); // contains the username
});
