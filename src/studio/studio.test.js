// node --test src/studio/studio.test.js — pure logic of Ø Studio (format, templates, collision maths)
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, filterText, normalizePart, byteSize, LIMITS, FORMAT } from './format.js';
import { createExperience, MODELS } from './templates.js';
import { CollisionWorld, shapeFromPart, rotationYXZ, rayShape } from './collide.js';

test('validate normalises a minimal experience', () => {
  const r = validate({ format: FORMAT, v: 1, parts: [{ type: 'block', p: [1, 2, 3] }] });
  assert.equal(r.ok, true);
  const p = r.exp.parts[0];
  assert.deepEqual(p.p, [1, 2, 3]);
  assert.deepEqual(p.s, [4, 1, 2]);
  assert.equal(p.material, 'plastic');
  assert.equal(p.anchored, true);
  assert.equal(r.exp.settings.sky, 'golden');
  assert.equal(r.exp.settings.baseplate.size, 512);
});

test('validate rejects junk and enforces limits', () => {
  assert.equal(validate('nope{').ok, false);
  assert.equal(validate([]).ok, false);
  assert.equal(validate({ format: 'other' }).ok, false);
  const many = { format: FORMAT, parts: Array.from({ length: LIMITS.parts + 1 }, () => ({ type: 'block' })) };
  assert.deepEqual(validate(many).errors, ['too-many-parts']);
  const r = validate({ parts: [{ type: 'evil', p: ['x', NaN, 1e9], s: [-5, 0, 'big'], color: 'red', r: [370, -190, 0], transparency: 7, props: { hack: 1, behavior: 'kill' } }] });
  assert.equal(r.ok, true);
  const p = r.exp.parts[0];
  assert.equal(p.type, 'block');
  assert.deepEqual(p.p, [0, 0, LIMITS.coord]);
  assert.deepEqual(p.s, [LIMITS.minSize, LIMITS.minSize, 2]);
  assert.equal(p.color, '#d9d2c4');
  assert.deepEqual(p.r, [10, 170, 0]);
  assert.equal(p.transparency, 1);
  assert.deepEqual(p.props, { behavior: 'kill' });
});

test('validate keeps ids unique and repairs groups', () => {
  const r = validate({
    parts: [{ id: 'a', group: 'g1' }, { id: 'a', group: 'missing' }],
    groups: [{ id: 'g1', parent: 'g2' }, { id: 'g2', parent: 'g1' }],
  });
  assert.equal(r.ok, true);
  assert.notEqual(r.exp.parts[0].id, r.exp.parts[1].id);
  assert.equal(r.exp.parts[1].group, null);
  assert.ok(r.exp.groups.some((g) => g.parent === null), 'cycle broken');
});

test('text filter masks blocked words, keeps innocent ones', () => {
  assert.equal(filterText('what the fuck'), 'what the ****');
  assert.equal(filterText('sh1t happens'), '**** happens');
  assert.equal(filterText('Kutzbach skunk'), 'Kutzbach skunk');
  assert.equal(filterText('jij kankerlijer'), 'jij ******lijer');
  assert.equal(normalizePart({ type: 'text', props: { text: 'hoer' } }).props.text, '****');
});

test('templates validate and stay small', () => {
  for (const t of ['baseplate', 'obby', 'empty']) {
    const exp = createExperience(t, { title: 'Test' });
    assert.equal(validate(exp).ok, true, t);
    assert.ok(exp.parts.some((p) => p.type === 'spawn'), `${t} has a spawn`);
    assert.ok(byteSize(exp) < 20000);
  }
  for (const m of MODELS) assert.ok(m.make().length > 0, m.id);
});

test('rotationYXZ matches yaw convention (heading h faces −sin h, −cos h)', () => {
  const m = rotationYXZ(0, 90, 0);
  // local −Z (front) → world: R·(0,0,−1) = (−m[2], −m[5], −m[8])
  assert.ok(Math.abs(-m[2] - -1) < 1e-9 && Math.abs(-m[8]) < 1e-9);
});

const part = (type, p, s, r = [0, 0, 0]) => ({ id: type + p.join(), type, p, s, r, collide: true });

test('sdf: box, rotated box, wedge slope, sphere, cylinder, cone', () => {
  const w = new CollisionWorld();
  const box = w.add(shapeFromPart(part('block', [0, 0.5, 0], [4, 1, 2])));
  assert.ok(Math.abs(w.sdf(box, 0, 2, 0) - 1) < 1e-9);
  assert.ok(w.sdf(box, 0, 0.5, 0) < 0);
  const rot = w.add(shapeFromPart(part('block', [10, 0, 0], [4, 1, 2], [0, 90, 0])));
  assert.ok(Math.abs(w.sdf(rot, 10, 0, 2.5) - 0.5) < 1e-9, 'yawed 90° → long side along Z');
  // wedge 4×2×4 at origin+20: low edge front (−Z), high edge back (+Z)
  const wedge = w.add(shapeFromPart(part('wedge', [20, 1, 0], [4, 2, 4])));
  assert.ok(w.sdf(wedge, 20, 0.6, -1.6) > 0, 'above the slope near the front');
  assert.ok(w.sdf(wedge, 20, 1.6, 1.6) < 0, 'inside near the back top');
  const n = w.normal(wedge, 20, 1.5, 0, {});
  assert.ok(Math.abs(n.y - 0.894) < 0.01 && Math.abs(n.z + 0.447) < 0.01, 'slope normal points up + forward');
  const sph = w.add(shapeFromPart(part('sphere', [0, 10, 0], [2, 2, 2])));
  assert.ok(Math.abs(w.sdf(sph, 0, 12, 0) - 1) < 1e-9);
  const cyl = w.add(shapeFromPart(part('cylinder', [0, 20, 0], [2, 2, 2])));
  assert.ok(Math.abs(w.sdf(cyl, 3, 20, 0) - 2) < 1e-9);
  const cone = w.add(shapeFromPart(part('cone', [0, 30, 0], [2, 2, 2])));
  assert.ok(w.sdf(cone, 0, 30.9, 0) < 0 && w.sdf(cone, 0.9, 30.9, 0) > 0);
});

test('query + raycast hit the right faces', () => {
  const w = new CollisionWorld();
  const a = w.add(shapeFromPart(part('block', [0, 0.5, 0], [4, 1, 2])));
  const b = w.add(shapeFromPart(part('block', [0, 5, 0], [1, 1, 1])));
  const base = w.add(shapeFromPart(part('block', [0, -10, 0], [512, 20, 512])));
  assert.ok(base.isBig);
  const q = w.query(-1, 0, -1, 1, 1, 1, []);
  assert.ok(q.includes(a) && q.includes(base) && !q.includes(b));
  const hit = w.raycast(0, 10, 0, 0, -1, 0, 100);
  assert.equal(hit.shape, b);
  assert.ok(Math.abs(hit.y - 5.5) < 1e-9 && hit.ny > 0.99);
  const hit2 = w.raycast(0, 3, 0, 0, -1, 0, 100);
  assert.equal(hit2.shape, a);
  const side = w.raycast(-10, 0.5, 0, 1, 0, 0, 100);
  assert.equal(side.shape, a);
  assert.ok(Math.abs(side.x + 2) < 1e-9 && side.nx < -0.99);
  // wedge slope from above: normal tilted
  const wd = w.add(shapeFromPart(part('wedge', [30, 1, 0], [4, 2, 4])));
  const hw = {};
  const t = rayShape(wd, 30, 10, 0, 0, -1, 0, hw);
  assert.ok(Math.abs(10 - t - 1) < 1e-9, 'slope at z=0 is at mid height');
  assert.ok(Math.abs(hw.ny - 0.894) < 0.01 && Math.abs(hw.nz + 0.447) < 0.01);
  // cylinder + cone + sphere from the side
  const cy = w.add(shapeFromPart(part('cylinder', [50, 1, 0], [2, 2, 2])));
  assert.ok(Math.abs(rayShape(cy, 40, 1, 0, 1, 0, 0, {}) - 9) < 1e-9);
  const co = w.add(shapeFromPart(part('cone', [60, 1, 0], [2, 2, 2])));
  assert.ok(Math.abs(rayShape(co, 60, 10, 0, 0, -1, 0, {}) - 8) < 1e-9, 'apex');
  const sp = w.add(shapeFromPart(part('sphere', [70, 1, 0], [2, 4, 2])));
  assert.ok(Math.abs(rayShape(sp, 70, 10, 0, 0, -1, 0, {}) - 7) < 1e-9, 'ellipsoid top');
  w.remove(b);
  assert.notEqual(w.raycast(0, 10, 0, 0, -1, 0, 100).shape, b);
});

test('extractExperience reads every API response shape (draft for owners)', async () => {
  const { extractExperience } = await import('./store.js');
  const { createExperience } = await import('./templates.js');
  const pub = createExperience('obby', { title: 'Pub' });
  const draft = createExperience('baseplate', { title: 'Draft' });
  const server = { experience: { id: 'x1', title: 'Pub' }, version: { v: 1, data: pub }, draft: { data: draft, savedAt: 1 } };
  assert.equal(extractExperience(server).meta.title, 'Pub');
  assert.equal(extractExperience(server, true).meta.title, 'Draft');
  assert.equal(extractExperience({ experience: { id: 'x1' }, version: null, draft: { data: draft } }, true).meta.title, 'Draft');
  assert.equal(extractExperience({ data: pub }).meta.title, 'Pub');
  assert.equal(extractExperience(pub), pub);
  assert.equal(extractExperience({ experience: { id: 'x' }, version: null }), null);
  assert.equal(extractExperience(null), null);
});

test('local store: drafts, thumbnails, local publish, removal (memory mode)', async () => {
  const { createStore } = await import('./store.js');
  const { createExperience } = await import('./templates.js');
  const store = createStore({ params: { nosave: true } });
  assert.equal(store.persist, false);
  assert.equal(store.cloud.available(), false);
  const exp = createExperience('obby', { title: 'Mine' });
  const { ok, entry } = store.save('d1', exp, { cloudId: null });
  assert.ok(ok);
  assert.equal(entry.parts, exp.parts.length);
  assert.equal(store.load('d1').parts.length, exp.parts.length);
  assert.deepEqual(store.list().map((e) => e.id), ['d1']);
  assert.equal(store.listPublished().length, 0);
  store.setThumb('d1', 'data:image/jpeg;base64,AAAA');
  store.publishLocal('d1', exp);
  const pub = store.listPublished();
  assert.equal(pub.length, 1);
  assert.equal(pub[0].thumbnail, 'data:image/jpeg;base64,AAAA');
  assert.equal(store.loadPublished('d1').meta.title, 'Mine');
  // the published copy is frozen: later draft edits don't change it
  const edited = { ...exp, meta: { ...exp.meta, title: 'Edited' } };
  store.save('d1', edited);
  assert.equal(store.loadPublished('d1').meta.title, 'Mine');
  assert.equal(store.load('d1').meta.title, 'Edited');
  store.remove('d1');
  assert.equal(store.load('d1'), null);
  assert.equal(store.list().length, 0);
});

test('signed-in cloud adapter sends the documented requests', async () => {
  const { createStore } = await import('./store.js');
  const { createExperience } = await import('./templates.js');
  const calls = [];
  const ctx = {
    params: { nosave: true },
    platform: {
      user: { username: 'ana' },
      async api(path, opts = {}) {
        calls.push([opts.method || 'GET', path, opts.body ? Object.keys(opts.body).sort().join(',') : '']);
        if (path === '/api/experiences') return { experience: { id: 'x9' } };
        if (path.startsWith('/api/users/')) return { experiences: [{ id: 'x9', title: 'T' }] };
        return { experience: { id: 'x9' }, version: { data: createExperience('obby') }, draft: { data: createExperience('empty') } };
      },
    },
  };
  const store = createStore(ctx);
  assert.equal(store.cloud.available(), true);
  const exp = createExperience('obby', { title: 'T' });
  assert.equal(await store.cloud.create(exp, 'data:image/jpeg;base64,AA'), 'x9');
  await store.cloud.save('x9', exp);
  await store.cloud.publish('x9', null, exp);
  await store.cloud.publish('x9', 'data:image/jpeg;base64,AA');
  const d = await store.cloud.get('x9', { draft: true });
  assert.equal(d.settings.sky, 'space'); // the 'empty' template = the draft
  assert.equal((await store.cloud.mine()).length, 1);
  assert.deepEqual(calls, [
    ['POST', '/api/experiences', 'data,description,maxPlayers,thumbnail,title'],
    ['PUT', '/api/experiences/x9', 'data,description,maxPlayers,title'],
    ['POST', '/api/experiences/x9/publish', 'data,description,maxPlayers,title'],
    ['POST', '/api/experiences/x9/publish', 'thumbnail'],
    ['GET', '/api/experiences/x9?draft=1', ''],
    ['GET', '/api/users/ana/experiences', ''],
  ]);
});
