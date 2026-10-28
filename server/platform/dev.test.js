/** The standalone dev runner: API + /healthz + STATIC_DIR + --demo seed + clean SIGTERM. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './testkit.js';

const DEV = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dev.js');

test('dev runner serves the API, static files and demo content', { timeout: 60_000 }, async () => {
  const dir = await tempDir();
  const staticDir = path.join(dir, 'static');
  await fsp.mkdir(staticDir);
  await fsp.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Ø test</title>');
  const child = spawn(process.execPath, [DEV, '--port', '0', '--data', path.join(dir, 'data'), '--static', staticDir, '--demo'], {
    env: { ...process.env, DATABASE_URL: '', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  try {
    const base = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no listen line: ${out}`)), 20_000);
      const check = () => {
        const m = /\[platform-dev\] (http:\/\/[\d.]+:\d+)/.exec(out);
        if (m) {
          clearTimeout(t);
          resolve(m[1]);
        } else setTimeout(check, 50);
      };
      check();
    });
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.platform === 'ready' || health.platform === 'init', true);
    // wait for the demo seed
    let list;
    for (let i = 0; i < 100; i++) {
      list = await (await fetch(`${base}/api/experiences`)).json();
      if (list.experiences.length >= 4 && /demo accounts ready/.test(out)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(list.experiences[0].id, 'o-universe');
    assert.deepEqual(list.experiences.slice(1).map((e) => e.creator.username), ['demo_builder', 'demo_builder', 'demo_builder']);
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /Ø test/);
    assert.equal((await fetch(`${base}/../../etc/passwd`)).status !== 200, true);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5199' }, body: JSON.stringify({ username: 'demo_friend', password: 'demo-password-1' }) });
    assert.equal(login.status, 200, 'loopback origin allowed in dev');
    assert.equal(login.headers.get('access-control-allow-origin'), 'http://localhost:5199');
    const { token } = await login.json();
    const friends = await (await fetch(`${base}/api/friends`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.deepEqual(friends.friends.map((f) => f.username), ['demo_builder']);
  } finally {
    const exited = new Promise((r) => child.once('exit', (code) => r(code)));
    child.kill('SIGTERM');
    assert.equal(await exited, 0, out);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
