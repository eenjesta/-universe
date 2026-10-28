/** Rate limits (unit + HTTP 429), same-origin / CORS, routing (404 / 405 / handle() → false). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from './ratelimit.js';
import { startPlatform, makeClock } from './testkit.js';
import { clientIp, checkOrigin } from './http.js';

describe('limiter', () => {
  test('token bucket: burst, refill, check vs take, sweep', () => {
    const clock = makeClock(0);
    const rl = createLimiter({ now: clock, sweepMs: 0 });
    const cfg = { burst: 3, perSec: 1 };
    assert.deepEqual([rl.take('a', cfg).ok, rl.take('a', cfg).ok, rl.take('a', cfg).ok], [true, true, true]);
    const r = rl.take('a', cfg);
    assert.equal(r.ok, false);
    assert.equal(r.retryAfter, 1);
    assert.equal(rl.check('a', cfg).ok, false, 'check does not consume or refill past now');
    assert.equal(rl.take('b', cfg).ok, true, 'keys are independent');
    clock.advance(1000);
    assert.equal(rl.take('a', cfg).ok, true);
    assert.equal(rl.take('a', cfg).ok, false);
    clock.advance(10_000);
    rl.sweep();
    assert.equal(rl.size, 0, 'full buckets are swept');
    rl.close();
  });

  test('client IP honours X-Forwarded-For only behind a trusted proxy', () => {
    const req = { socket: { remoteAddress: '::ffff:10.0.0.2' }, headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4' } };
    assert.equal(clientIp(req, false), '10.0.0.2');
    assert.equal(clientIp(req, true), '1.2.3.4', 'the entry our proxy appended');
    assert.equal(clientIp(req, 2), '6.6.6.6');
  });
});

describe('HTTP limits', () => {
  test('login attempts per IP → 429 with Retry-After', async () => {
    const k = await startPlatform({ limits: { auth: { burst: 3, perSec: 1 / 60 } } });
    try {
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await k.call('POST', '/api/auth/login', { username: 'nobody_x', password: 'whatever-123' })).status);
      assert.deepEqual(codes, [401, 401, 401, 429]);
      const r = await k.call('POST', '/api/auth/login', { username: 'nobody_x', password: 'whatever-123' });
      assert.equal(r.body.error.code, 'rate_limited');
      assert.ok(Number(r.headers.get('retry-after')) >= 1);
      assert.ok(r.body.error.nl);
      k.clock.advance(60_000);
      assert.equal((await k.call('POST', '/api/auth/login', { username: 'nobody_x', password: 'whatever-123' })).status, 401, 'refilled');
    } finally {
      await k.stop();
    }
  });

  test('failed logins per username lock that name, not others', async () => {
    const k = await startPlatform({ limits: { loginName: { burst: 2, perSec: 1 / 60 } } });
    try {
      await k.register('target_user', { password: 'right-password-1' });
      for (let i = 0; i < 2; i++) assert.equal((await k.call('POST', '/api/auth/login', { username: 'target_user', password: 'wrong-pass-' + i })).status, 401);
      const locked = await k.call('POST', '/api/auth/login', { username: 'target_user', password: 'right-password-1' });
      assert.equal(locked.status, 429, 'even the right password waits');
      await k.register('other_user', { password: 'right-password-2' });
      assert.equal((await k.call('POST', '/api/auth/login', { username: 'other_user', password: 'right-password-2' })).status, 200);
      k.clock.advance(61_000);
      assert.equal((await k.call('POST', '/api/auth/login', { username: 'target_user', password: 'right-password-1' })).status, 200);
    } finally {
      await k.stop();
    }
  });

  test('per-IP request limit and per-user action limits', async () => {
    const k = await startPlatform({ limits: { ip: { burst: 5, perSec: 1 / 60 } } });
    try {
      const codes = [];
      for (let i = 0; i < 6; i++) codes.push((await k.call('GET', '/api/status')).status);
      assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
    } finally {
      await k.stop();
    }
    const k2 = await startPlatform({ limits: { report: { burst: 2, perSec: 1 / 600 }, register: { burst: 1, perSec: 1 / 600 } } });
    try {
      const rep = () => k2.call('POST', '/api/report', { kind: 'player', targetId: 'p12', reason: 'spam' });
      assert.deepEqual([(await rep()).status, (await rep()).status, (await rep()).status], [201, 201, 429]);
      await k2.register('first_acct');
      const second = await k2.call('POST', '/api/auth/register', { username: 'second_acct', password: 'good-password-1', birthYear: 1990 });
      assert.equal(second.status, 429, 'one new account per IP in this config');
      // failed validation does not use up the registration allowance
      const k2Bad = await k2.call('POST', '/api/auth/register', { username: 'x', password: 'good-password-1', birthYear: 1990 });
      assert.equal(k2Bad.status, 400);
    } finally {
      await k2.stop();
    }
  });
});

describe('origin + routing', () => {
  test('same-origin passes, foreign origins are refused, allowed origins get CORS', async () => {
    const k = await startPlatform({ allowedOrigins: ['https://play.example.com'] });
    try {
      const host = new URL(k.base).host;
      const same = await k.call('POST', '/api/report', { kind: 'user', targetId: 'u1', reason: 'spam' }, { headers: { Origin: `http://${host}` } });
      assert.equal(same.status, 201);
      assert.equal(same.headers.get('access-control-allow-origin'), null);
      const evil = await k.call('POST', '/api/report', { kind: 'user', targetId: 'u1', reason: 'spam' }, { headers: { Origin: 'https://evil.example' } });
      assert.equal(evil.status, 403);
      assert.equal(evil.body.error.code, 'origin');
      const allowed = await k.call('GET', '/api/status', undefined, { headers: { Origin: 'https://play.example.com' } });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://play.example.com');
      const pre = await k.call('OPTIONS', '/api/experiences', undefined, { headers: { Origin: 'https://play.example.com', 'Access-Control-Request-Method': 'POST' } });
      assert.equal(pre.status, 204);
      assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
      const nullOrigin = await k.call('GET', '/api/status', undefined, { headers: { Origin: 'null' } });
      assert.equal(nullOrigin.status, 403);
    } finally {
      await k.stop();
    }
  });

  test('loopback origins only with allowLocalOrigins (Vite dev proxy)', () => {
    const req = { headers: { origin: 'http://localhost:5199', host: '127.0.0.1:8095' } };
    assert.equal(checkOrigin(req, {}).ok, false);
    assert.equal(checkOrigin(req, { allowLocal: true }).ok, true);
    const proxied = { headers: { origin: 'https://ou.up.railway.app', host: '10.0.0.5:8080', 'x-forwarded-host': 'ou.up.railway.app' } };
    assert.equal(checkOrigin(proxied, {}).ok, false);
    assert.equal(checkOrigin(proxied, { trustProxy: true }).ok, true);
  });

  test('404 / 405 JSON errors, handle() only claims /api', async () => {
    const k = await startPlatform();
    try {
      const nf = await k.call('GET', '/api/nope');
      assert.equal(nf.status, 404);
      assert.equal(nf.body.error.code, 'not_found');
      const na = await k.call('PATCH', '/api/me', {});
      assert.equal(na.status, 405);
      assert.match(na.headers.get('allow'), /GET/);
      const trailing = await k.call('GET', '/api/experiences/');
      assert.equal(trailing.status, 200, 'trailing slash tolerated');
      const notApi = await k.call('GET', '/apix');
      assert.equal(notApi.text, 'not api', 'falls through to the static handler');
      assert.equal((await k.call('GET', '/index.html')).text, 'not api');
      assert.equal(k.platform.handle({ url: '/assets/a.js' }, {}), false);
      const head = await fetch(k.base + '/api/status', { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('cache-control'), 'no-store');
      assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
    } finally {
      await k.stop();
    }
  });
});
