/** Experience format validation + body limits (2 MB saves, 16 kB elsewhere). */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateExperience, cleanString, parseThumbnail, LIMITS } from './validate.js';
import { ApiError } from './errors.js';
import { startPlatform, sampleExperience, TINY_JPEG } from './testkit.js';

const problem = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError, String(err));
    return { code: err.code, path: err.details?.path, problem: err.details?.problem };
  }
  assert.fail('expected a validation error');
};

describe('validateExperience', () => {
  test('a valid document is normalised (defaults, colours, clamps)', () => {
    const doc = sampleExperience(2);
    delete doc.format;
    delete doc.v;
    doc.parts[1] = { id: 'b0', type: 'block', p: [1, 2, 3], s: [0, 5000, 1], color: '#ABC', transparency: 5 };
    const { data, partCount, size, filtered } = validateExperience(doc);
    assert.equal(data.format, 'o-universe-experience');
    assert.equal(data.v, 1);
    assert.equal(partCount, 2);
    assert.ok(size > 100 && size < 2000);
    assert.equal(filtered, false);
    const b = data.parts[1];
    assert.deepEqual(b.s, [LIMITS.SIZE_MIN, LIMITS.SIZE_MAX, 1], 'sizes clamped');
    assert.equal(b.color, '#aabbcc');
    assert.equal(b.transparency, 1);
    assert.deepEqual([b.name, b.material, b.anchored, b.collide, b.group], ['Part', 'plastic', true, true, null]);
    assert.deepEqual(b.r, [0, 0, 0]);
    assert.equal(data.settings.baseplate.material, 'concrete');
    assert.equal(validateExperience({ settings: { baseplate: null } }).data.settings.baseplate, null, 'no baseplate');
  });

  test('type errors carry a path', () => {
    const base = () => sampleExperience(2);
    const at = (mut) => {
      const d = base();
      mut(d);
      return problem(() => validateExperience(d));
    };
    assert.deepEqual(at((d) => (d.parts[1].p = 'x')).path, 'parts[1].p');
    assert.equal(at((d) => (d.parts[1].p = [1, 2, '3'])).path, 'parts[1].p[2]');
    assert.equal(at((d) => (d.parts[0].type = 'teapot')).path, 'parts[0].type');
    assert.equal(at((d) => delete d.parts[0].type).path, 'parts[0].type');
    assert.equal(at((d) => (d.parts[1].material = 'marble')).path, 'parts[1].material');
    assert.equal(at((d) => (d.parts[1].color = 'red')).path, 'parts[1].color');
    assert.equal(at((d) => (d.parts[1].anchored = 'yes')).path, 'parts[1].anchored');
    assert.equal(at((d) => (d.parts[1].id = d.parts[0].id)).problem.includes('duplicate'), true);
    assert.equal(at((d) => (d.parts[1].id = 'bad id!')).path, 'parts[1].id');
    assert.equal(at((d) => (d.parts[1].group = 'nope')).path, 'parts[1].group');
    assert.equal(at((d) => (d.settings.sky = 'purple')).path, 'settings.sky');
    assert.equal(at((d) => (d.meta.title = 42)).path, 'meta.title');
    assert.equal(at((d) => (d.parts = {})).path, 'parts');
    assert.equal(at((d) => (d.format = 'other-format')).path, 'format');
    assert.equal(at((d) => (d.v = 2)).code, 'unsupported_version');
    assert.equal(problem(() => validateExperience([])).path, '');
  });

  test('numbers must be finite (1e999 parses to Infinity)', () => {
    const d = JSON.parse('{"parts":[{"id":"a","type":"block","p":[0,1e999,0]}]}');
    assert.equal(problem(() => validateExperience(d)).path, 'parts[0].p[1]');
    const g = JSON.parse('{"settings":{"gravity":-1e999}}');
    assert.equal(problem(() => validateExperience(g)).path, 'settings.gravity');
  });

  test('limits: 5000 parts, 2 MB', () => {
    const many = sampleExperience(LIMITS.MAX_PARTS);
    assert.equal(validateExperience(many).partCount, 5000);
    const tooMany = sampleExperience(LIMITS.MAX_PARTS + 1);
    assert.equal(problem(() => validateExperience(tooMany)).path, 'parts');
    const big = sampleExperience(2);
    big.logic = Array.from({ length: 1000 }, (_, i) => ({ id: `l${i}`, note: 'x'.repeat(2000), more: 'y'.repeat(2000) }));
    assert.equal(problem(() => validateExperience(big)).code, 'too_large');
  });

  test('groups: references and cycles', () => {
    const d = sampleExperience(2);
    d.groups = [{ id: 'g1', name: 'Model', parent: null }, { id: 'g2', name: 'Sub', parent: 'g1' }];
    d.parts[1].group = 'g2';
    assert.equal(validateExperience(d).data.parts[1].group, 'g2');
    d.groups[0].parent = 'g2';
    assert.equal(problem(() => validateExperience(d)).problem, 'groups form a cycle');
    d.groups = [{ id: 'g1', parent: 'g1' }];
    d.parts[1].group = null;
    assert.equal(problem(() => validateExperience(d)).problem, 'groups form a cycle');
    d.groups = [{ id: 'g1', parent: 'zz' }];
    assert.match(problem(() => validateExperience(d)).problem, /unknown group/);
  });

  test('strings are sanitised and filtered; extras survive, dangerous keys do not', () => {
    const d = sampleExperience(2);
    d.meta.title = '  Hi\u0000\u202e there\u200b  ';
    d.meta.description = 'line one\r\n\r\n\r\n\r\nline two\u2028three';
    d.parts[1].name = 'Block' + 'x'.repeat(100);
    d.parts[1].locked = true; // a newer Studio field
    d.parts[1].props = { label: 'kut label', nested: { deep: [1, 2, { ok: true }] } };
    d.camera = { fov: 60 };
    const { data, filtered } = validateExperience(d);
    assert.equal(data.meta.title, 'Hi there');
    assert.equal(data.meta.description, 'line one\n\nline two\nthree');
    assert.equal([...data.parts[1].name].length, LIMITS.NAME_MAX);
    assert.equal(data.parts[1].locked, true);
    assert.equal(data.parts[1].props.label, '*** label');
    assert.deepEqual(data.parts[1].props.nested, { deep: [1, 2, { ok: true }] });
    assert.deepEqual(data.camera, { fov: 60 });
    assert.equal(filtered, true);
    const evil = JSON.parse('{"parts":[{"id":"a","type":"block","props":{"__proto__":{"admin":true}}}]}');
    assert.match(problem(() => validateExperience(evil)).path, /__proto__/);
    const deep = { parts: [{ id: 'a', type: 'block', props: { a: { b: { c: { d: { e: { f: 1 } } } } } } }] };
    assert.equal(problem(() => validateExperience(deep)).problem, 'nested too deeply');
  });

  test('cleanString and thumbnails', () => {
    assert.equal(cleanString('  a\tb\nc  ', 10), 'a b c');
    assert.equal(cleanString('a'.repeat(30), 5), 'aaaaa');
    assert.equal(cleanString('😀😀😀', 2), '😀😀', 'caps by code point');
    assert.equal(cleanString(42, 5), '');
    assert.equal(parseThumbnail(TINY_JPEG).mime, 'image/jpeg');
    assert.equal(parseThumbnail(null), null);
    assert.throws(() => parseThumbnail('data:image/jpeg;base64,AAAA'), /JPEG/);
    assert.throws(() => parseThumbnail('data:image/jpeg;base64,/9j/' + 'A'.repeat(LIMITS.THUMB_MAX)), /JPEG/);
    assert.throws(() => parseThumbnail('https://example.com/a.jpg'));
  });
});

describe('HTTP bodies', () => {
  let k;
  let u;
  before(async () => {
    k = await startPlatform();
    u = await k.register('body_tester');
  });
  after(() => k.stop());

  test('16 kB limit on ordinary endpoints → 413', async () => {
    const r = await k.call('POST', '/api/report', { kind: 'user', targetId: 'x', reason: 'r'.repeat(17 * 1024) });
    assert.equal(r.status, 413);
    assert.equal(r.body.error.code, 'too_large');
  });

  test('experience saves accept ~2 MB and refuse more', async () => {
    const c = await k.call('POST', '/api/experiences', { title: 'Big' }, { token: u.token });
    const id = c.body.experience.id;
    const sized = (target) => {
      const doc = sampleExperience(4000);
      doc.logic = [];
      const base = Buffer.byteLength(JSON.stringify(doc));
      const per = Buffer.byteLength(JSON.stringify({ id: 'l0000', note: 'n'.repeat(1900) })) + 1;
      while (base + doc.logic.length * per < target) doc.logic.push({ id: `l${doc.logic.length}`, note: 'n'.repeat(1900) });
      return doc;
    };
    const ok = await k.call('PUT', `/api/experiences/${id}`, { data: sized(1.95e6) }, { token: u.token });
    assert.equal(ok.status, 200, ok.text.slice(0, 200));
    assert.ok(ok.body.draft.size > 1.9e6 && ok.body.draft.size <= LIMITS.MAX_BYTES, `size ${ok.body.draft.size}`);
    const huge = await k.call('PUT', `/api/experiences/${id}`, { data: sized(1e6), pad: 'x'.repeat(2.5 * 1024 * 1024) }, { token: u.token });
    assert.equal(huge.status, 413, 'body over the limit');
    const big = await k.call('PUT', `/api/experiences/${id}`, { data: sized(2.12e6) }, { token: u.token });
    assert.equal(big.status, 413, 'body fits but the document is over 2 MB');
    assert.equal(big.body.error.code, 'too_large');
    const many = await k.call('PUT', `/api/experiences/${id}`, { data: sampleExperience(5001) }, { token: u.token });
    assert.equal(many.status, 400);
    assert.equal(many.body.error.code, 'invalid_experience');
    assert.equal(many.body.error.details.path, 'parts');
  });

  test('bad JSON, wrong content type, non-object bodies', async () => {
    const bad = await k.call('POST', '/api/auth/login', '{"username":', { headers: { 'Content-Type': 'application/json' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'bad_json');
    const type = await k.call('POST', '/api/auth/login', 'username=a', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(type.status, 415);
    const arr = await k.call('POST', '/api/auth/login', '[1,2]', { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    assert.equal(arr.status, 400);
    const empty = await k.call('POST', '/api/auth/login');
    assert.equal(empty.status, 400, 'body required');
    const optional = await k.call('POST', '/api/auth/logout', undefined, { token: u.token });
    assert.equal(optional.status, 200, 'logout needs no body');
  });
});
