/** Experiences: create / save draft / publish (immutable versions) / get / list / search / like / play / delete. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPlatform, STORE_KINDS, sampleExperience, TINY_JPEG } from './testkit.js';

for (const kind of STORE_KINDS) {
  describe(`experiences (${kind})`, () => {
    let k;
    let maker;
    let other;
    before(async () => {
      k = await startPlatform({ store: kind });
      maker = await k.register('maker_one');
      other = await k.register('other_two');
    });
    after(() => k.stop());

    const create = async (body = {}, who = maker) => {
      const r = await k.call('POST', '/api/experiences', body, { token: who.token });
      assert.equal(r.status, 201, r.text);
      return r.body;
    };
    const publish = async (id, who = maker, body) => {
      const r = await k.call('POST', `/api/experiences/${id}/publish`, body, { token: who.token });
      assert.equal(r.status, 200, r.text);
      return r.body;
    };

    test('create a draft (default template) — only the owner sees it', async () => {
      const c = await create({ title: 'First World' });
      const e = c.experience;
      assert.match(e.id, /^x[a-z0-9]{10}$/);
      assert.equal(e.title, 'First World');
      assert.equal(e.published, false);
      assert.equal(e.version, 0);
      assert.equal(e.creator.username, 'maker_one');
      assert.equal(c.draft.data.format, 'o-universe-experience');
      assert.equal(c.draft.data.meta.title, 'First World', 'meta synced into the document');
      assert.ok(c.draft.data.parts.some((p) => p.type === 'spawn'));
      assert.equal((await k.call('GET', `/api/experiences/${e.id}`)).status, 404, 'anonymous');
      assert.equal((await k.call('GET', `/api/experiences/${e.id}`, undefined, { token: other.token })).status, 404, 'other user');
      const own = await k.call('GET', `/api/experiences/${e.id}?draft=1`, undefined, { token: maker.token });
      assert.equal(own.status, 200);
      assert.equal(own.body.version, null);
      assert.equal(own.body.draft.data.meta.title, 'First World');
      assert.equal(own.body.experience.draftSavedAt > 0, true);
    });

    test('save draft (PUT), publish, versions are immutable', async () => {
      const { experience } = await create({ data: sampleExperience(3) });
      const id = experience.id;
      const put = await k.call('PUT', `/api/experiences/${id}`, { data: sampleExperience(5), title: 'Tower Run', description: 'Climb!' }, { token: maker.token });
      assert.equal(put.status, 200, put.text);
      assert.equal(put.body.experience.title, 'Tower Run');
      assert.equal(put.body.draft.partCount, 5);
      assert.equal(put.body.filtered, false);
      assert.equal(put.body.data, undefined, 'no echo when nothing was filtered');

      const p1 = await publish(id);
      assert.equal(p1.version.v, 1);
      assert.equal(p1.experience.published, true);
      assert.equal(p1.experience.partCount, 5);

      // the document itself as body
      await k.call('PUT', `/api/experiences/${id}`, sampleExperience(8, { meta: { title: 'Tower Run 2', description: 'Higher', maxPlayers: 12 } }), { token: maker.token });
      const p2 = await publish(id);
      assert.equal(p2.version.v, 2);
      assert.equal(p2.experience.title, 'Tower Run 2');
      assert.equal(p2.experience.maxPlayers, 12);

      const pub = await k.call('GET', `/api/experiences/${id}`);
      assert.equal(pub.status, 200);
      assert.equal(pub.body.version.v, 2);
      assert.equal(pub.body.version.data.parts.length, 8);
      assert.equal(pub.body.draft, undefined, 'drafts are owner-only');
      const v1 = await k.call('GET', `/api/experiences/${id}?v=1`);
      assert.equal(v1.body.version.v, 1);
      assert.equal(v1.body.version.data.parts.length, 5, 'v1 unchanged after v2');
      assert.equal(v1.body.version.data.meta.title, 'Tower Run');
      assert.equal((await k.call('GET', `/api/experiences/${id}?v=9`)).status, 404);
      const meta = await k.call('GET', `/api/experiences/${id}?data=0`);
      assert.equal(meta.body.version.data, undefined);
      const vs = await k.call('GET', `/api/experiences/${id}/versions`);
      assert.deepEqual(vs.body.versions.map((v) => v.v), [2, 1]);

      // publish with inline data
      const p3 = await publish(id, maker, { data: sampleExperience(2) });
      assert.equal(p3.version.v, 3);
      assert.equal(p3.version.partCount, 2);
    });

    test('text is filtered (masked) in titles, descriptions and text parts', async () => {
      const doc = sampleExperience(2);
      doc.parts.push({ id: 'sign', type: 'text', p: [0, 3, 0], s: [4, 1, 0.2], props: { text: 'kut sign, mail me@example.com' } });
      const { experience } = await create({ data: doc });
      const put = await k.call('PUT', `/api/experiences/${experience.id}`, { data: doc, title: 'shit world', description: 'f u c k this, visit www.evil.example' }, { token: maker.token });
      assert.equal(put.body.filtered, true);
      assert.equal(put.body.experience.title, '**** world');
      assert.ok(!/fuck|f u c k|www\./.test(put.body.experience.description));
      const sign = put.body.data.parts.find((p) => p.id === 'sign');
      assert.equal(sign.props.text.startsWith('*** sign'), true);
      assert.ok(!sign.props.text.includes('@'), 'contact details masked');
    });

    test('permissions: only the owner edits, publishes or deletes; the flagship is read-only', async () => {
      const { experience } = await create({ title: 'Mine Only' });
      const id = experience.id;
      for (const [m, u, b] of [['PUT', `/api/experiences/${id}`, { title: 'hack' }], ['POST', `/api/experiences/${id}/publish`, {}], ['DELETE', `/api/experiences/${id}`]]) {
        const r = await k.call(m, u, b, { token: other.token });
        assert.equal(r.status, 403, `${m} ${u}`);
        assert.equal(r.body.error.code, 'forbidden');
      }
      for (const [m, u, b] of [['PUT', '/api/experiences/o-universe', { title: 'x' }], ['DELETE', '/api/experiences/o-universe'], ['POST', '/api/experiences/o-universe/publish', {}]]) {
        assert.equal((await k.call(m, u, b, { token: maker.token })).status, 403, `${m} ${u}`);
      }
      assert.equal((await k.call('PUT', '/api/experiences/xnotthere00', { title: 'x' }, { token: maker.token })).status, 404);
      assert.equal((await k.call('PUT', `/api/experiences/${id}`, {}, { token: maker.token })).status, 400, 'nothing to save');
      const del = await k.call('DELETE', `/api/experiences/${id}`, undefined, { token: maker.token });
      assert.equal(del.status, 200);
      assert.equal((await k.call('GET', `/api/experiences/${id}`, undefined, { token: maker.token })).status, 404);
      assert.equal((await k.call('DELETE', `/api/experiences/${id}`, undefined, { token: maker.token })).status, 404);
    });

    test('list: flagship first, popular (plays + likes ×10) and new, search', async () => {
      const k2 = await startPlatform({ store: kind });
      try {
        const a = await k2.register('alpha_maker');
        const fans = [];
        for (let i = 0; i < 3; i++) fans.push(await k2.register(`fan_${i}x`));
        const mk = async (title, description) => {
          const c = await k2.call('POST', '/api/experiences', { title, description, data: sampleExperience(2) }, { token: a.token });
          await k2.call('POST', `/api/experiences/${c.body.experience.id}/publish`, {}, { token: a.token });
          k2.clock.advance(1000);
          return c.body.experience.id;
        };
        const quiet = await mk('Quiet Garden', 'Calm flowers');
        const liked = await mk('Laser Maze', 'Dodge the beams');
        const played = await mk('Sky Race', 'Fly through rings');
        await k2.call('POST', '/api/experiences', { title: 'Unpublished Draft' }, { token: a.token });
        // played: 12 plays (unique players/IPs via clock jumps) vs liked: 2 likes (= 20)
        for (let i = 0; i < 12; i++) {
          await k2.call('POST', `/api/experiences/${played}/play`);
          k2.clock.advance(11 * 60e3);
        }
        for (const f of fans.slice(0, 2)) await k2.call('POST', `/api/experiences/${liked}/like`, {}, { token: f.token });

        const pop = (await k2.call('GET', '/api/experiences?sort=popular')).body;
        assert.deepEqual(pop.experiences.map((e) => e.id), ['o-universe', liked, played, quiet]);
        assert.equal(pop.experiences[0].builtin, true);
        assert.equal(pop.experiences[0].title, 'Ø Universe — SMP');
        assert.ok(pop.experiences[0].i18n.description.nl);
        assert.equal(pop.experiences[2].plays, 12);
        assert.equal(pop.experiences[1].likes, 2);
        assert.equal(pop.nextOffset, null);
        const nl = (await k2.call('GET', '/api/experiences?lang=nl')).body.experiences[0];
        assert.equal(nl.description, nl.i18n.description.nl);

        const fresh = (await k2.call('GET', '/api/experiences?sort=new')).body;
        assert.deepEqual(fresh.experiences.map((e) => e.id), ['o-universe', played, liked, quiet]);

        const q = (await k2.call('GET', '/api/experiences?q=MAZE')).body;
        assert.deepEqual(q.experiences.map((e) => e.id), [liked], 'title match, flagship hidden');
        assert.deepEqual((await k2.call('GET', '/api/experiences?q=flowers')).body.experiences.map((e) => e.id), [quiet]);
        assert.equal((await k2.call('GET', '/api/experiences?q=alpha_mak')).body.experiences.length, 3, 'creator name');
        assert.deepEqual((await k2.call('GET', '/api/experiences?q=survival')).body.experiences.map((e) => e.id), ['o-universe']);
        assert.deepEqual((await k2.call('GET', '/api/experiences?q=100%25')).body.experiences, [], 'LIKE wildcards are literal');

        const page = (await k2.call('GET', '/api/experiences?limit=2')).body;
        assert.equal(page.experiences.length, 3, 'flagship + 2');
        assert.equal(page.nextOffset, 2);
        const page2 = (await k2.call('GET', '/api/experiences?limit=2&offset=2')).body;
        assert.deepEqual(page2.experiences.map((e) => e.id), [quiet]);
        assert.equal(page2.nextOffset, null);
        assert.equal((await k2.call('GET', '/api/experiences?limit=abc')).status, 400);

        // liked flags for the viewer
        const mine = (await k2.call('GET', '/api/experiences', undefined, { token: fans[0].token })).body.experiences;
        assert.equal(mine.find((e) => e.id === liked).liked, true);
        assert.equal(mine.find((e) => e.id === quiet).liked, false);
        assert.equal(mine[0].liked, false);
      } finally {
        await k2.stop();
      }
    });

    test('likes: idempotent, unlike, auth, published only, flagship too', async () => {
      const { experience } = await create({ data: sampleExperience(2) });
      const id = experience.id;
      const early = await k.call('POST', `/api/experiences/${id}/like`, {}, { token: other.token });
      assert.equal(early.status, 404, 'drafts cannot be liked');
      await publish(id);
      assert.equal((await k.call('POST', `/api/experiences/${id}/like`)).status, 401);
      let r = await k.call('POST', `/api/experiences/${id}/like`, undefined, { token: other.token });
      assert.deepEqual([r.status, r.body.liked, r.body.likes], [200, true, 1]);
      r = await k.call('POST', `/api/experiences/${id}/like`, {}, { token: other.token });
      assert.equal(r.body.likes, 1, 'idempotent');
      r = await k.call('POST', `/api/experiences/${id}/like`, { like: true }, { token: maker.token });
      assert.equal(r.body.likes, 2);
      r = await k.call('POST', `/api/experiences/${id}/like`, { like: false }, { token: other.token });
      assert.deepEqual([r.body.liked, r.body.likes], [false, 1]);
      r = await k.call('POST', `/api/experiences/${id}/like`, { like: false }, { token: other.token });
      assert.equal(r.body.likes, 1);
      const g = await k.call('GET', `/api/experiences/${id}`, undefined, { token: maker.token });
      assert.equal(g.body.experience.liked, true);
      const f = await k.call('POST', '/api/experiences/o-universe/like', {}, { token: other.token });
      assert.equal(f.status, 200);
      assert.equal(f.body.likes, 1);
      const fg = await k.call('GET', '/api/experiences/o-universe', undefined, { token: other.token });
      assert.equal(fg.body.experience.likes, 1);
      assert.equal(fg.body.experience.liked, true);
      assert.equal(fg.body.version, null, 'the flagship has no stored document');
    });

    test('plays: counted once per player per 10 minutes, guests by IP, flagship too', async () => {
      const { experience } = await create({ data: sampleExperience(2) });
      const id = experience.id;
      assert.equal((await k.call('POST', `/api/experiences/${id}/play`)).status, 404, 'drafts are not playable');
      await publish(id);
      let r = await k.call('POST', `/api/experiences/${id}/play`, undefined, { token: other.token });
      assert.deepEqual([r.body.plays, r.body.counted], [1, true]);
      r = await k.call('POST', `/api/experiences/${id}/play`, {}, { token: other.token });
      assert.deepEqual([r.body.plays, r.body.counted], [1, false]);
      r = await k.call('POST', `/api/experiences/${id}/play`);
      assert.deepEqual([r.body.plays, r.body.counted], [2, true], 'anonymous play counts per IP');
      k.clock.advance(10 * 60e3);
      r = await k.call('POST', `/api/experiences/${id}/play`, {}, { token: other.token });
      assert.equal(r.body.plays, 3);
      // playing a user experience shows up as presence for friends
      assert.equal(k.platform.presenceOf(other.user.id).experienceId, id);
      const f = await k.call('POST', '/api/experiences/o-universe/play', {}, { token: maker.token });
      assert.equal(f.status, 200);
      assert.equal(f.body.counted, true);
    });

    test('thumbnails: data URL in, image URL out, cached by revision', async () => {
      const c = await create({ title: 'Thumb', thumbnail: TINY_JPEG });
      const url = c.experience.thumbnail;
      assert.match(url, /^\/api\/experiences\/x[a-z0-9]+\/thumbnail\?v=\d+$/);
      const img = await k.call('GET', url, undefined, { raw: true });
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('content-type'), 'image/jpeg');
      assert.equal(img.buf[0], 0xff);
      assert.match(img.headers.get('cache-control'), /immutable/);
      const etag = img.headers.get('etag');
      const again = await k.call('GET', url, undefined, { raw: true, headers: { 'If-None-Match': etag } });
      assert.equal(again.status, 304);
      const bad = await k.call('PUT', `/api/experiences/${c.experience.id}`, { thumbnail: 'data:image/gif;base64,R0lGOD' }, { token: maker.token });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error.field, 'thumbnail');
      const rm = await k.call('PUT', `/api/experiences/${c.experience.id}`, { thumbnail: null }, { token: maker.token });
      assert.equal(rm.body.experience.thumbnail, null);
      assert.equal((await k.call('GET', url, undefined, { raw: true })).status, 404);
    });

    test('by user: published for everyone, drafts too for the owner', async () => {
      const k3 = await startPlatform({ store: kind });
      try {
        const u = await k3.register('solo_maker');
        const pub = await k3.call('POST', '/api/experiences', { title: 'Public One', data: sampleExperience(2) }, { token: u.token });
        await k3.call('POST', `/api/experiences/${pub.body.experience.id}/publish`, {}, { token: u.token });
        k3.clock.advance(1000);
        const draft = await k3.call('POST', '/api/experiences', { title: 'Secret Draft' }, { token: u.token });
        const anon = await k3.call('GET', '/api/users/solo_maker/experiences');
        assert.equal(anon.status, 200);
        assert.equal(anon.body.user.username, 'solo_maker');
        assert.deepEqual(anon.body.experiences.map((e) => e.title), ['Public One']);
        const own = await k3.call('GET', '/api/users/solo_maker/experiences', undefined, { token: u.token });
        assert.deepEqual(own.body.experiences.map((e) => e.id), [draft.body.experience.id, pub.body.experience.id], 'recently updated first');
        assert.equal(own.body.experiences[0].published, false);
        assert.equal((await k3.call('GET', '/api/users/nobody_here/experiences')).status, 404);
      } finally {
        await k3.stop();
      }
    });

    test('per-user experience limit', async () => {
      const k4 = await startPlatform({ store: kind });
      try {
        const u = await k4.register('busy_maker');
        for (let i = 0; i < 50; i++) assert.equal((await k4.call('POST', '/api/experiences', { title: `W${i}` }, { token: u.token })).status, 201);
        const r = await k4.call('POST', '/api/experiences', { title: 'One too many' }, { token: u.token });
        assert.equal(r.status, 403);
        assert.equal(r.body.error.code, 'limit');
      } finally {
        await k4.stop();
      }
    });
  });
}
