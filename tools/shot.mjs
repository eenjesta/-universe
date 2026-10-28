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
 *   --mobile          phone/tablet emulation: isMobile + hasTouch (combine with --size / --dpr)
 *   --touch           hasTouch only (touch events on a desktop-like context)
 *   --ua ios|android|STRING  user agent (ios = iPhone Safari, ipad = iPadOS Safari, android = Chrome)
 *   Batch jobs may override per job: size ("844x390"), dpr, mobile, touch, ua.
 *
 * Steps: {"key":"KeyW","hold":1500} {"down":"KeyW"} {"up":"KeyW"} {"press":"KeyB"}
 *        {"wait":1000} {"frames":30} {"mouse":[x,y]} {"drag":[dx,dy],"steps":12}
 *        {"click":[x,y],"button":"left"} {"type":"hallo"} {"eval":"js"} {"shot":"file.png"}
 *        {"freeze":true|false}  (stop / resume the game loop, e.g. to inspect a frame)
 * Touch steps (need --mobile or --touch; CDP Input.dispatchTouchEvent, multi-touch aware):
 *        {"tap":[x,y]}                       quick tap
 *        {"touchStart":[x,y],"id":1}          put finger `id` down (stays down across steps)
 *        {"touchMove":[x,y],"id":1,"steps":8} move finger `id` there in n steps
 *        {"touchEnd":1}                       lift finger `id`
 *        {"touchHold":[x,y],"hold":800}       press, hold, release
 *        {"touchDrag":[x1,y1,x2,y2],"steps":12,"hold":0}  press, move, (hold), release
 *        {"pinch":[cx,cy,d0,d1],"steps":10}  two fingers, horizontal distance d0 → d1
 *        {"tapSel":"css"}  {"touchStartSel":"css","id":2}   tap / press the centre of the first match
 *        {"clickSel":"css"}                   mouse click on the centre of the first match
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
const UAS = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};

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
    const [jw, jh] = job.size ? String(job.size).split('x').map(Number) : [vw, vh];
    const mobile = !!(job.mobile ?? args.mobile);
    const touch = mobile || !!(job.touch ?? args.touch);
    const uaKey = job.ua ?? args.ua;
    const ctxOpts = { viewport: { width: jw, height: jh }, deviceScaleFactor: Number(job.dpr ?? args.dpr ?? 1) };
    if (mobile) ctxOpts.isMobile = true;
    if (touch) ctxOpts.hasTouch = true;
    if (uaKey && uaKey !== true) ctxOpts.userAgent = UAS[uaKey] || String(uaKey);
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    // multi-touch state for the touch steps (CDP Input.dispatchTouchEvent wants every active point)
    const fingers = new Map();
    const fingerIds = new Map(); // step id (string) → numeric CDP touch id
    let cdp = null;
    const touchEvent = async (type) => {
      cdp = cdp || (await context.newCDPSession(page));
      const touchPoints = [...fingers.entries()].map(([id, p]) => {
        if (!fingerIds.has(id)) fingerIds.set(id, fingerIds.size + 1);
        return { x: p.x, y: p.y, id: fingerIds.get(id), radiusX: 6, radiusY: 6, force: 1 };
      });
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    };
    const fingerDown = async (id, x, y) => {
      fingers.set(id, { x, y });
      await touchEvent('touchStart');
    };
    const fingerMove = async (id, x, y, steps = 1) => {
      const f = fingers.get(id);
      if (!f) return fingerDown(id, x, y);
      const x0 = f.x;
      const y0 = f.y;
      for (let i = 1; i <= steps; i++) {
        f.x = x0 + ((x - x0) * i) / steps;
        f.y = y0 + ((y - y0) * i) / steps;
        await touchEvent('touchMove');
        if (steps > 1) await page.waitForTimeout(16);
      }
    };
    const fingerUp = async (id) => {
      if (!fingers.has(id)) return;
      fingers.delete(id);
      await touchEvent('touchEnd');
    };
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
        } else if (step.tapSel || step.touchStartSel || step.clickSel) {
          const sel = step.tapSel || step.touchStartSel || step.clickSel;
          const box = await page.locator(sel).first().boundingBox({ timeout: 5000 });
          if (!box) throw new Error(`no visible element for ${sel}`);
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          if (step.tapSel) await page.touchscreen.tap(cx, cy);
          else if (step.clickSel) await page.mouse.click(cx, cy);
          else await fingerDown(String(step.id ?? 1), cx, cy);
          console.log(`[shot] ${step.tapSel ? 'tap' : step.clickSel ? 'click' : 'touchStart'} ${sel} @ ${Math.round(cx)},${Math.round(cy)}`);
        } else if (step.tap) {
          await page.touchscreen.tap(step.tap[0], step.tap[1]);
        } else if (step.touchStart) {
          await fingerDown(String(step.id ?? 1), step.touchStart[0], step.touchStart[1]);
        } else if (step.touchMove) {
          await fingerMove(String(step.id ?? 1), step.touchMove[0], step.touchMove[1], step.steps || 1);
        } else if (step.touchEnd !== undefined) {
          await fingerUp(String(step.touchEnd === true ? 1 : step.touchEnd));
        } else if (step.touchHold) {
          await fingerDown('h', step.touchHold[0], step.touchHold[1]);
          await page.waitForTimeout(step.hold ?? 600);
          await fingerUp('h');
        } else if (step.touchDrag) {
          const [x1, y1, x2, y2] = step.touchDrag;
          await fingerDown('d', x1, y1);
          await fingerMove('d', x2, y2, step.steps || 12);
          if (step.hold) await page.waitForTimeout(step.hold);
          await fingerUp('d');
        } else if (step.pinch) {
          const [cx, cy, d0, d1] = step.pinch;
          const n = step.steps || 10;
          fingers.set('p1', { x: cx - d0 / 2, y: cy });
          await touchEvent('touchStart');
          fingers.set('p2', { x: cx + d0 / 2, y: cy });
          await touchEvent('touchStart');
          for (let i = 1; i <= n; i++) {
            const d = d0 + ((d1 - d0) * i) / n;
            fingers.get('p1').x = cx - d / 2;
            fingers.get('p2').x = cx + d / 2;
            await touchEvent('touchMove');
            await page.waitForTimeout(16);
          }
          fingers.delete('p2');
          await touchEvent('touchEnd');
          fingers.delete('p1');
          await touchEvent('touchEnd');
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
