import * as THREE from 'three';
import { t } from './i18n.js';

/**
 * GPU diagnostics (`?diag`). Finds out — on the player's own machine — what
 * spoils the picture on real GPUs, which the headless SwiftShader tests can't
 * see:
 *   1. renders the current view into a 32-bit float target and counts NaN,
 *      ±Inf, negative and half-float-overflowing (> 65 000) pixels;
 *   2. if any, renders every visible object on its own (via a spare camera
 *      layer) to name the objects/materials that produce them;
 *   3. measures the final picture (fraction of black pixels) with bloom,
 *      MSAA, the sanitize pass, the environment map or the whole post chain
 *      switched off, to see which one causes a black/flickering screen.
 * Shows a summary panel (text in the active language) and POSTs the JSON
 * report to the diag collector (tools/diag-server.mjs, port 4174 on the same
 * host as the page). The report itself keeps its English keys.
 */

const LAYER = 31;

export async function runDiagnostics(ctx) {
  const { engine } = ctx;
  const r = engine.renderer;
  const gl = r.getContext();
  const panel = createPanel();
  const say = (msg) => {
    panel.log(msg);
    console.log(`[diag] ${msg}`);
  };
  const frame = () => new Promise((res) => requestAnimationFrame(() => res()));

  // capture console errors while the diagnostics run (shader compile errors…)
  const consoleErrors = [];
  const origError = console.error;
  console.error = (...a) => {
    consoleErrors.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ').slice(0, 600));
    origError.apply(console, a);
  };

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const report = {
    time: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    devicePixelRatio: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    quality: { ...engine.quality },
    mode: ctx.modes?.name,
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    extensions: {
      colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
      colorBufferHalfFloat: !!gl.getExtension('EXT_color_buffer_half_float'),
      floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    },
    precision: r.capabilities.precision,
    gameErrors: (ctx.errors || []).map((e) => String(e?.message || e)).slice(0, 20),
  };
  say(`GPU: ${report.gpu}`);

  const scene = engine.scene;
  const camera = engine.camera;

  try {
    // ------------------------------------------------ 1. HDR scan of the view
    const W = 384;
    const H = Math.max(2, Math.round((W * engine.height) / engine.width));
    const floatOk = report.extensions.colorBufferFloat;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: floatOk ? THREE.FloatType : THREE.HalfFloatType });
    const px = floatOk ? new Float32Array(W * H * 4) : new Uint16Array(W * H * 4);
    const scan = () => {
      const prev = r.getRenderTarget();
      const auto = r.autoClear;
      r.autoClear = true;
      r.setRenderTarget(rt);
      r.render(scene, camera);
      r.setRenderTarget(prev);
      r.autoClear = auto;
      r.readRenderTargetPixels(rt, 0, 0, W, H, px);
      return floatOk ? classifyFloat(px) : classifyHalf(px);
    };

    const full = scan();
    report.hdrScan = full;
    say(
      t(
        { en: 'Image: {nan} NaN, {inf} Inf, {huge} too bright, {neg} negative (max {max})', nl: 'Beeld: {nan} NaN, {inf} Inf, {huge} te fel, {neg} negatief (max {max})' },
        { nan: full.nan, inf: full.inf, huge: full.huge, neg: full.neg, max: full.max },
      ),
    );

    const envSaved = scene.environment;
    scene.environment = null;
    report.hdrScanNoEnv = scan();
    scene.environment = envSaved;
    const fogSaved = scene.fog;
    scene.fog = null;
    report.hdrScanNoFog = scan();
    scene.fog = fogSaved;

    // ------------------------------------------ 2. per-object hunt for NaN/Inf
    const bad = (s) => s.nan + s.inf + s.huge > 0;
    if (bad(full) || bad(report.hdrScanNoEnv) || bad(report.hdrScanNoFog)) {
      const renderables = [];
      const lights = [];
      scene.traverseVisible((o) => {
        if (o.isLight) lights.push(o);
        else if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.material) renderables.push(o);
      });
      say(t({ en: 'Looking for the source among {n} objects…', nl: 'Zoek de bron tussen {n} objecten…' }, { n: renderables.length }));
      const culprits = [];
      const camMask = camera.layers.mask;
      const t0 = performance.now();
      for (let i = 0; i < renderables.length; i += 20) {
        const lightMasks = lights.map((l) => l.layers.mask);
        lights.forEach((l) => l.layers.enable(LAYER));
        camera.layers.set(LAYER);
        try {
          for (const o of renderables.slice(i, i + 20)) {
            const m = o.layers.mask;
            o.layers.enable(LAYER);
            const s = scan();
            o.layers.mask = m;
            if (bad(s)) culprits.push({ object: describe(o), ...s });
          }
        } finally {
          camera.layers.mask = camMask;
          lights.forEach((l, k) => (l.layers.mask = lightMasks[k]));
        }
        if (performance.now() - t0 > 90000) {
          report.objectScanTruncatedAt = i + 20;
          break;
        }
        await frame();
      }
      culprits.sort((a, b) => b.nan + b.inf + b.huge - (a.nan + a.inf + a.huge));
      report.culprits = culprits.slice(0, 40);
      say(
        culprits.length
          ? t({ en: 'Source: {list}', nl: 'Bron: {list}' }, { list: culprits.slice(0, 3).map((c) => c.object.path).join(' | ') })
          : t({ en: 'No single object found (only in combination)', nl: 'Geen los object gevonden (alleen in combinatie)' }),
      );
    }

    // ----------------------- 3. final picture with features switched off/on
    const measure = () => {
      engine.render(0, performance.now() / 1000);
      r.setRenderTarget(null);
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let black = 0;
      let n = 0;
      let sum = 0;
      for (let i = 0; i < buf.length; i += 4 * 7) {
        const l = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
        if (l < 4) black++;
        sum += l;
        n++;
      }
      return { black: round(black / n, 3), mean: round(sum / n, 1) };
    };
    const worstOf = async (frames = 4) => {
      let worst = null;
      for (let k = 0; k < frames; k++) {
        await frame();
        const m = measure();
        if (!worst || m.black > worst.black) worst = m;
      }
      return worst;
    };
    const q = engine.quality;
    const comp = engine.composer;
    const setMsaa = (n) => {
      for (const target of [comp.renderTarget1, comp.renderTarget2]) {
        target.samples = n;
        target.dispose();
      }
    };
    const variants = {};
    const loopRender = ctx.loop.render;
    ctx.loop.render = () => {}; // we render ourselves while measuring
    try {
      variants.current = await worstOf();
      const san = engine.sanitize?.enabled;
      if (engine.sanitize) {
        engine.sanitize.enabled = !san;
        variants[san ? 'withoutSanitize' : 'withSanitize'] = await worstOf();
        engine.sanitize.enabled = san;
      }
      const bloomOn = engine.bloom.enabled;
      engine.bloom.enabled = !bloomOn;
      variants[bloomOn ? 'bloomOff' : 'bloomOn'] = await worstOf();
      engine.bloom.enabled = bloomOn;
      const samples = comp.renderTarget1.samples;
      setMsaa(samples ? 0 : 4);
      variants[samples ? 'msaaOff' : 'msaa4'] = await worstOf();
      setMsaa(samples);
      const env = scene.environment;
      scene.environment = null;
      variants.envOff = await worstOf();
      scene.environment = env;
      const post = q.post;
      q.post = false;
      variants.postOff = await worstOf();
      q.post = post;
    } finally {
      ctx.loop.render = loopRender;
    }
    report.picture = variants;
    say(
      t({ en: 'Black on screen: ', nl: 'Zwart in beeld: ' }) +
        Object.entries(variants)
          .map(([k, v]) => `${k} ${Math.round(v.black * 100)}%`)
          .join(' · '),
    );
    rt.dispose();
  } catch (err) {
    report.failure = String(err?.stack || err);
    say(t({ en: 'Diagnostics failed: {err}', nl: 'Diagnose mislukt: {err}' }, { err: err?.message || err }));
  } finally {
    console.error = origError;
  }
  report.consoleErrors = consoleErrors.slice(0, 30);

  // ------------------------------------------------------------- send it
  const endpoint = `${location.protocol}//${location.hostname}:4174/diag`;
  try {
    await fetch(endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(report) });
    say(t({ en: 'Report sent to the server ✓ — you can carry on.', nl: 'Rapport verstuurd naar de server ✓ — je kunt gewoon verder.' }));
  } catch (err) {
    say(t({ en: 'Sending failed ({err}); the report is in the console.', nl: 'Versturen mislukt ({err}); het rapport staat in de console.' }, { err: err?.message || err }));
  }
  console.log('[diag] report', report);
  panel.done();
  window.__diagReport = report;
  return report;
}

// ----------------------------------------------------------------- helpers
function round(v, d) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

function classifyFloat(px) {
  let nan = 0;
  let inf = 0;
  let neg = 0;
  let huge = 0;
  let max = 0;
  for (let i = 0; i < px.length; i++) {
    if ((i & 3) === 3) continue; // alpha
    const v = px[i];
    if (v !== v) nan++;
    else if (v === Infinity || v === -Infinity) inf++;
    else {
      if (v < -1e-4) neg++;
      if (v > 65000) huge++;
      if (v > max) max = v;
    }
  }
  return { nan, inf, neg, huge, max: Math.round(max) };
}

function classifyHalf(px) {
  let nan = 0;
  let inf = 0;
  let neg = 0;
  let huge = 0;
  for (let i = 0; i < px.length; i++) {
    if ((i & 3) === 3) continue;
    const h = px[i];
    if ((h & 0x7c00) === 0x7c00) {
      if (h & 0x03ff) nan++;
      else inf++;
    } else {
      if (h & 0x8000 && h & 0x7fff) neg++;
      if ((h & 0x7c00) >= 0x7800) huge++; // ≥ 32768
    }
  }
  return { nan, inf, neg, huge, max: null };
}

function describe(o) {
  const names = [];
  for (let p = o; p && names.length < 5; p = p.parent) names.push(p.name || p.type);
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  return {
    path: names.reverse().join(' > '),
    type: o.type,
    materials: mats.map((m) => `${m.type}${m.name ? `:${m.name}` : ''}`),
    instances: o.isInstancedMesh ? o.count : undefined,
  };
}

function createPanel() {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:16px;top:16px;z-index:99999;max-width:min(560px,calc(100vw - 32px));' +
    'padding:14px 16px;border-radius:12px;background:rgba(8,10,16,.88);color:#ece6dc;' +
    "font:13px/1.45 Jost,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:auto";
  const title = document.createElement('div');
  title.textContent = t({ en: 'Ø GPU diagnostics — please wait…', nl: 'Ø GPU-diagnose — even geduld…' });
  title.style.cssText = 'font-weight:500;letter-spacing:.08em;margin-bottom:6px';
  const body = document.createElement('div');
  el.append(title, body);
  document.body.appendChild(el);
  return {
    log(msg) {
      const line = document.createElement('div');
      line.textContent = msg;
      body.appendChild(line);
    },
    done() {
      title.textContent = t({ en: 'Ø GPU diagnostics — done', nl: 'Ø GPU-diagnose — klaar' });
      const close = document.createElement('button');
      close.textContent = t({ en: 'Close', nl: 'Sluiten' });
      close.style.cssText = 'margin-top:8px;padding:4px 12px;border-radius:8px;border:1px solid #555;background:#1b1f27;color:#ece6dc;cursor:pointer';
      close.onclick = () => el.remove();
      el.appendChild(close);
    },
  };
}
