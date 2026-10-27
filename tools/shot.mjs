#!/usr/bin/env node
/**
 * Headless screenshot + smoke-test harness for Ø Universe (Playwright + SwiftShader WebGL).
 *
 * The game must be served (shared test server: `NO_HMR=1 PORT=5199 npx vite`).
 *
 * Usage:
 *   node tools/shot.mjs --path "/?mode=explore&zone=plaza&nosave" --out shots/plaza.png
 *   node tools/shot.mjs --path "/?zone=base&nosave" --steps '[{"key":"KeyB","hold":50},{"wait":800},{"shot":"shots/build.png"}]'
 *   node tools/shot.mjs --batch shots/batch.json         # [{path, out, wait, steps, eval}, ...] in one browser
 *
 * Options:
 *   --base URL        default http://localhost:5199
 *   --path P          path + query appended to base (default "/?nosave")
 *   --out FILE        final screenshot (default shots/shot.png); "none" to skip
 *   --size WxH        viewport (default 1280x720)
 *   --dpr N           device pixel ratio (default 1; 2 = Retina/MacBook)
 *   --wait MS         wait after the game reports ready (default 2500)
 *   --timeout MS      max wait for ready (default 120000)
 *   --eval JS         JS run in the page after ready (awaited); result printed
 *   --steps JSON      array of steps (see below), run after --eval
 *   --log             print every console message (default: errors, warnings, "[tag]" logs)
 *   --info            print __game.debug.info() at the end
 *   --shotTimeout MS  timeout of each page screenshot (default 300000)
 *   --noFreeze        don't freeze the game loop while a screenshot is captured
 *                     (by default the loop is frozen so a slow SwiftShader frame
 *                     can't stall the capture; the canvas keeps the last frame)
 *
 * Steps: {"key":"KeyW","hold":1500} {"down":"KeyW"} {"up":"KeyW"} {"press":"KeyB"}
 *        {"wait":1000} {"frames":30} {"mouse":[x,y]} {"drag":[dx,dy],"steps":12}
 *        {"click":[x,y],"button":"left"} {"type":"hallo"} {"eval":"js"} {"shot":"file.png"}
 *        {"freeze":true|false}  (stop / resume the game loop, e.g. to inspect a frame)
 *
 * Exit code: 0 ok, 2 if page errors / console errors occurred, 1 on harness failure.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else {
      a[key] = next;
      i++;
    }
  }
  return a;
}

const args = parseArgs(process.argv);
const base = (args.base || 'http://localhost:5199').replace(/\/$/, '');
const [vw, vh] = String(args.size || '1280x720').split('x').map(Number);
const verbose = !!args.log;

const jobs = args.batch
  ? JSON.parse(fs.readFileSync(args.batch, 'utf8'))
  : [{ path: args.path || '/?nosave', out: args.out || 'shots/shot.png', wait: args.wait, steps: args.steps ? JSON.parse(args.steps) : [], eval: args.eval, info: args.info }];

const summary = { jobs: [], errors: 0, warnings: 0 };

const setFrozen = (page, frozen) =>
  page
    .evaluate(
      (f) =>
        new Promise((res) => {
          const L = window.__game?.loop;
          if (L) L.frozen = f;
          // two rAF round-trips: the frame that was in flight has been presented
          requestAnimationFrame(() => requestAnimationFrame(() => res()));
        }),
      frozen,
    )
    .catch(() => {});

async function capture(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const freeze = !args.noFreeze;
  if (freeze) await setFrozen(page, true);
  try {
    await page.screenshot({ path: file, timeout: Number(args.shotTimeout || 300000) });
  } finally {
    if (freeze) await setFrozen(page, false);
  }
}

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const killTimer = setTimeout(() => {
  console.error('[shot] global timeout — aborting');
  browser.close().finally(() => process.exit(1));
}, Number(args.globalTimeout || 600000));

try {
  for (const job of jobs) {
    const result = { path: job.path, shots: [], errors: [], warnings: [], evals: [] };
    const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: Number(args.dpr || 1) });
    const page = await context.newPage();
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        result.errors.push(text);
        console.log(`  [console.error] ${text}`);
      } else if (type === 'warning') {
        if (/GPU stall|ReadPixels|Automatic fallback to software WebGL/.test(text)) return;
        result.warnings.push(text);
        console.log(`  [console.warn] ${text}`);
      } else if (verbose || /^\[/.test(text)) {
        console.log(`  [console.${type}] ${text}`);
      }
    });
    page.on('pageerror', (err) => {
      result.errors.push(`pageerror: ${err.message}`);
      console.log(`  [pageerror] ${err.message}\n${(err.stack || '').split('\n').slice(0, 6).join('\n')}`);
    });

    const url = base + (job.path || '/?nosave');
    console.log(`[shot] ${url}`);
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForFunction(() => window.__game && window.__game.ready === true, null, {
        timeout: Number(args.timeout || job.timeout || 120000),
        polling: 250,
      });
      console.log(`[shot] ready after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch {
      result.errors.push('timeout waiting for __game.ready');
      console.log('[shot] TIMEOUT waiting for __game.ready');
    }

    const evalCode = job.eval;
    if (evalCode) {
      try {
        const r = await page.evaluate(`(async () => { ${evalCode.includes('return') ? evalCode : `return (${evalCode})`} })()`);
        result.evals.push(r);
        console.log(`[shot] eval → ${JSON.stringify(r)?.slice(0, 2000)}`);
      } catch (err) {
        result.errors.push(`eval failed: ${err.message}`);
        console.log(`[shot] eval failed: ${err.message}`);
      }
    }

    const center = { x: vw / 2, y: vh / 2 };
    for (const step of job.steps || []) {
      try {
        if (step.wait) await page.waitForTimeout(step.wait);
        else if (step.frames) await page.evaluate((n) => window.__game.debug.frames(n), step.frames);
        else if (step.key) {
          await page.keyboard.down(step.key);
          await page.waitForTimeout(step.hold ?? 60);
          await page.keyboard.up(step.key);
        } else if (step.down) await page.keyboard.down(step.down);
        else if (step.up) await page.keyboard.up(step.up);
        else if (step.press) await page.keyboard.press(step.press);
        else if (step.type) await page.keyboard.type(step.type, { delay: 30 });
        else if (step.mouse) {
          await page.mouse.move(step.mouse[0], step.mouse[1], { steps: step.steps || 1 });
          center.x = step.mouse[0];
          center.y = step.mouse[1];
        } else if (step.drag) {
          await page.mouse.move(center.x, center.y);
          await page.mouse.down({ button: step.button || 'left' });
          await page.mouse.move(center.x + step.drag[0], center.y + step.drag[1], { steps: step.steps || 12 });
          await page.mouse.up({ button: step.button || 'left' });
          await page.mouse.move(center.x, center.y);
        } else if (step.click) {
          await page.mouse.click(step.click[0], step.click[1], { button: step.button || 'left' });
        } else if (step.eval) {
          const r = await page.evaluate(`(async () => { ${step.eval.includes('return') ? step.eval : `return (${step.eval})`} })()`);
          result.evals.push(r);
          console.log(`[shot] eval → ${JSON.stringify(r)?.slice(0, 2000)}`);
        } else if (step.freeze !== undefined) {
          await setFrozen(page, !!step.freeze);
        } else if (step.shot) {
          await capture(page, step.shot);
          result.shots.push(step.shot);
          console.log(`[shot] saved ${step.shot}`);
        }
      } catch (err) {
        result.errors.push(`step ${JSON.stringify(step)} failed: ${err.message}`);
        console.log(`[shot] step failed ${JSON.stringify(step)}: ${err.message}`);
      }
    }

    await page.waitForTimeout(Number(job.wait ?? args.wait ?? 2500));
    const out = job.out ?? 'shots/shot.png';
    if (out && out !== 'none') {
      await capture(page, out);
      result.shots.push(out);
      console.log(`[shot] saved ${out}`);
    }
    if (job.info || args.info) {
      try {
        const info = await page.evaluate(() => window.__game?.debug?.info());
        result.info = info;
        console.log(`[shot] info ${JSON.stringify(info)}`);
      } catch (err) {
        console.log(`[shot] info failed: ${err.message}`);
      }
    }
    summary.jobs.push(result);
    summary.errors += result.errors.length;
    summary.warnings += result.warnings.length;
    await context.close();
  }
} catch (err) {
  console.error('[shot] harness failure', err);
  clearTimeout(killTimer);
  await browser.close();
  process.exit(1);
}

clearTimeout(killTimer);
await browser.close();
console.log(`[shot] done: ${summary.jobs.length} job(s), ${summary.errors} error(s), ${summary.warnings} warning(s)`);
process.exit(summary.errors ? 2 : 0);
