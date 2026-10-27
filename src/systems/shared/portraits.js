/**
 * NPC portraits for the dialogue panel, chat avatars and the party list.
 * Uses ctx.portraits.render(npcId, {framing: 'bust'}) from the characters module
 * (cached per id). Rendering is deferred: callers get a procedurally drawn,
 * backlit "holo-ID" stand-in right away and a callback when the real portrait
 * has been rendered in a later slot (one per slot, so a burst never stalls a
 * frame for long). The first render compiles the portrait studio's shaders, so
 * optional portraits (chat faces, party avatars, pre-warming) wait until a
 * dialogue has paid that cost. Missing/blank renders keep the stand-in.
 */
const W = 360;
const H = 450;

function isBlank(c) {
  if (!c || !c.width || !c.height) return true;
  try {
    const t = document.createElement('canvas');
    t.width = t.height = 12;
    const g = t.getContext('2d');
    g.drawImage(c, 0, 0, 12, 12);
    const d = g.getImageData(0, 0, 12, 12).data;
    let min = 999;
    let max = -1;
    let alpha = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] + d[i + 1] + d[i + 2];
      if (l < min) min = l;
      if (l > max) max = l;
      alpha += d[i + 3];
    }
    return alpha === 0 || max - min < 8;
  } catch {
    return false; // tainted / unreadable: trust it
  }
}

function hexToRgb(hex, fallback = [180, 140, 255]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

/** Backlit bust silhouette with rim light, hair silhouette and an Ø patch. */
export function drawPlaceholderPortrait(info = {}, w = W, h = H) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const look = info.look || {};
  const acc = hexToRgb(info.accent || '#b48cff');
  const warm = [255, 176, 104];
  const seed = [...(info.id || 'x')].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const rnd = (i) => {
    const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  // --- background: dark studio with warm bokeh + accent haze
  g.fillStyle = '#0b0e14';
  g.fillRect(0, 0, w, h);
  let gr = g.createRadialGradient(w * 0.78, h * 0.2, 0, w * 0.78, h * 0.2, w * 0.95);
  gr.addColorStop(0, rgba(warm, 0.34));
  gr.addColorStop(0.45, rgba(warm, 0.1));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  gr = g.createRadialGradient(w * 0.12, h * 0.85, 0, w * 0.12, h * 0.85, w * 0.8);
  gr.addColorStop(0, rgba(acc, 0.22));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) {
    const x = w * (0.45 + rnd(i) * 0.55);
    const y = h * (0.05 + rnd(i + 20) * 0.45);
    const r = w * (0.03 + rnd(i + 40) * 0.07);
    const b = g.createRadialGradient(x, y, 0, x, y, r);
    const col = i % 3 === 0 ? acc : warm;
    b.addColorStop(0, rgba(col, 0.16 + rnd(i + 60) * 0.18));
    b.addColorStop(0.7, rgba(col, 0.05));
    b.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = b;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  const cx = w * 0.5;
  const headY = h * 0.37;
  const hrx = w * 0.15;
  const hry = h * 0.155;
  const female = look.body === 'f';
  const outfit = hexToRgb(look.outfit || '#16181e');
  const skin = hexToRgb(look.skin || '#c68e67');
  const hair = hexToRgb(look.hairColor || '#2a1d15');
  const dark = (rgb, k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k].map(Math.round);

  // --- ponytail / long hair behind the body
  g.save();
  if (look.hair === 'ponytail') {
    g.fillStyle = rgba(dark(hair, 0.55), 1);
    g.beginPath();
    g.ellipse(cx - hrx * 0.95, headY + hry * 0.9, hrx * 0.42, hry * 1.25, 0.25, 0, Math.PI * 2);
    g.fill();
  } else if (look.hair === 'long') {
    g.fillStyle = rgba(dark(hair, 0.55), 1);
    g.beginPath();
    g.ellipse(cx, headY + hry * 0.95, hrx * 1.28, hry * 1.55, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // --- shoulders / torso
  const sw = female ? w * 0.4 : w * 0.46; // half shoulder width
  const neckY = headY + hry * 1.02;
  g.beginPath();
  g.moveTo(cx - sw * 1.05, h);
  g.bezierCurveTo(cx - sw * 1.04, h * 0.82, cx - sw * 0.92, h * 0.71, cx - sw * 0.42, neckY + h * 0.055);
  g.lineTo(cx - w * 0.075, neckY);
  g.lineTo(cx + w * 0.075, neckY);
  g.lineTo(cx + sw * 0.42, neckY + h * 0.055);
  g.bezierCurveTo(cx + sw * 0.92, h * 0.71, cx + sw * 1.04, h * 0.82, cx + sw * 1.05, h);
  g.closePath();
  gr = g.createLinearGradient(cx - sw, 0, cx + sw, 0);
  gr.addColorStop(0, rgba(dark(outfit, 0.55), 1));
  gr.addColorStop(0.6, rgba(dark(outfit, 0.8), 1));
  gr.addColorStop(1, rgba(outfit, 1));
  g.fillStyle = gr;
  g.fill();
  // rim lights (warm right, accent left)
  g.save();
  g.clip();
  gr = g.createLinearGradient(cx + sw * 0.55, 0, cx + sw * 1.1, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, rgba(warm, 0.55));
  g.fillStyle = gr;
  g.fillRect(cx, 0, w, h);
  gr = g.createLinearGradient(cx - sw * 1.1, 0, cx - sw * 0.6, 0);
  gr.addColorStop(0, rgba(acc, 0.45));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, cx, h);
  // collar + zipper
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - w * 0.11, neckY + 4);
  g.lineTo(cx - w * 0.02, h * 0.74);
  g.moveTo(cx + w * 0.11, neckY + 4);
  g.lineTo(cx + w * 0.02, h * 0.74);
  g.moveTo(cx, h * 0.74);
  g.lineTo(cx, h);
  g.stroke();
  // Ø shoulder patch
  const px = cx + sw * 0.72;
  const py = h * 0.8;
  g.strokeStyle = 'rgba(236,230,220,0.55)';
  g.lineWidth = 2.2;
  g.beginPath();
  g.arc(px, py, w * 0.032, 0, Math.PI * 2);
  g.moveTo(px - w * 0.045, py + w * 0.045);
  g.lineTo(px + w * 0.045, py - w * 0.045);
  g.stroke();
  g.restore();

  // --- neck
  gr = g.createLinearGradient(cx - w * 0.07, 0, cx + w * 0.07, 0);
  gr.addColorStop(0, rgba(dark(skin, 0.3), 1));
  gr.addColorStop(1, rgba(dark(skin, 0.62), 1));
  g.fillStyle = gr;
  g.fillRect(cx - w * 0.062, headY + hry * 0.55, w * 0.124, neckY - headY - hry * 0.45);

  // --- head (backlit: dark face, warm rim on the right)
  g.save();
  g.beginPath();
  g.ellipse(cx, headY, hrx * (female ? 0.94 : 1), hry, 0, 0, Math.PI * 2);
  gr = g.createLinearGradient(cx - hrx, 0, cx + hrx, 0);
  gr.addColorStop(0, rgba(dark(skin, 0.28), 1));
  gr.addColorStop(0.55, rgba(dark(skin, 0.42), 1));
  gr.addColorStop(1, rgba(dark(skin, 0.78), 1));
  g.fillStyle = gr;
  g.fill();
  g.clip();
  gr = g.createRadialGradient(cx + hrx * 1.05, headY - hry * 0.2, 0, cx + hrx * 1.05, headY - hry * 0.2, hrx * 0.9);
  gr.addColorStop(0, rgba(warm, 0.7));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(cx - hrx * 2, headY - hry * 2, hrx * 4, hry * 4);
  // jaw shadow + beard
  if (look.beard === 'full' || look.beard === 'stubble') {
    const bc = hexToRgb(look.beardColor || look.hairColor || '#2a1d15');
    g.fillStyle = rgba(look.beard === 'full' ? dark(bc, 0.85) : dark(bc, 0.5), look.beard === 'full' ? 0.95 : 0.45);
    g.beginPath();
    g.ellipse(cx, headY + hry * 0.62, hrx * 0.86, hry * 0.5, 0, 0, Math.PI);
    g.fill();
  }
  // faint eyes catch-light (gives the silhouette a gaze)
  g.fillStyle = 'rgba(255,236,214,0.12)';
  g.beginPath();
  g.ellipse(cx + hrx * 0.42, headY + hry * 0.05, hrx * 0.09, hry * 0.035, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,236,214,0.06)';
  g.beginPath();
  g.ellipse(cx - hrx * 0.32, headY + hry * 0.05, hrx * 0.08, hry * 0.03, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // --- hair on top
  g.save();
  g.fillStyle = rgba(dark(hair, 0.7), 1);
  const style = look.hair || 'short';
  if (style === 'cap') {
    g.fillStyle = rgba(dark(outfit, 0.9), 1);
    g.beginPath();
    g.ellipse(cx, headY - hry * 0.42, hrx * 1.08, hry * 0.68, 0, Math.PI, 0);
    g.fill();
    g.fillRect(cx - hrx * 0.2, headY - hry * 0.45, hrx * 1.55, hry * 0.13);
  } else if (style === 'curly') {
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * (1.02 + (i / 10) * 0.96);
      g.beginPath();
      g.arc(cx + Math.cos(a) * hrx * 0.95, headY - hry * 0.18 + Math.sin(a) * hry * 0.95, hrx * 0.36, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.beginPath();
    g.ellipse(cx, headY - hry * 0.3, hrx * 1.06, hry * 0.82, 0, Math.PI * 1.02, Math.PI * 1.98);
    g.ellipse(cx + hrx * 0.1, headY - hry * 0.52, hrx * 1.02, hry * 0.55, style === 'swept' ? -0.2 : 0, Math.PI, 0);
    g.fill();
    if (style === 'long') {
      g.fillRect(cx - hrx * 1.08, headY - hry * 0.3, hrx * 0.3, hry * 1.5);
      g.fillRect(cx + hrx * 0.78, headY - hry * 0.3, hrx * 0.3, hry * 1.5);
    }
    if (style === 'headband') {
      g.fillStyle = 'rgba(122,82,56,0.95)';
      g.fillRect(cx - hrx * 1.02, headY - hry * 0.5, hrx * 2.04, hry * 0.16);
    }
  }
  // hair rim light
  gr = g.createLinearGradient(cx, 0, cx + hrx * 1.1, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, rgba(warm, 0.35));
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = gr;
  g.fillRect(cx, headY - hry * 1.5, hrx * 1.4, hry * 1.4);
  g.restore();

  // --- grade: vignette + scanlines + grain
  gr = g.createRadialGradient(cx, h * 0.45, h * 0.25, cx, h * 0.5, h * 0.78);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.62)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createPortraits(ctx) {
  const cache = new Map(); // id → real portrait canvas (characters module)
  const placeholders = new Map(); // id → drawn stand-in (while rendering / when unavailable)
  const failed = new Map(); // id → attempts that gave nothing usable
  const waiting = new Map(); // id → [{info, cb}] — portraits queued for rendering
  const listeners = new Map(); // id → [cb] — told when a portrait exists (without asking for a render)
  let timer = 0;
  // The first portrait compiles the studio's shader programs (a noticeable hitch); optional
  // portraits (chat faces, party avatars, pre-warming) only render once a dialogue paid that.
  let warmed = false;

  /** Renders the real portrait now (synchronous WebGL snapshot); null when unavailable. */
  function renderNow(id) {
    if ((failed.get(id) || 0) >= 2 || !ctx.portraits?.render) return null;
    try {
      const r = ctx.portraits.render(id, { framing: 'bust', width: W, height: H });
      if (r && r.getContext && !isBlank(r)) {
        warmed = true;
        return r;
      }
    } catch (err) {
      console.warn('[systems] portrait render failed for', id, err);
    }
    failed.set(id, (failed.get(id) || 0) + 1);
    return null;
  }

  /** Caches a real portrait and tells everyone who waited for it. */
  function store(id, r, list = []) {
    cache.set(id, r);
    faces.delete(id); // re-crop the chat face from the real portrait
    const all = list.map((w) => w.cb).concat(listeners.get(id) || []);
    listeners.delete(id);
    for (const cb of all) {
      try {
        cb?.(r);
      } catch (err) {
        console.warn('[systems] portrait callback failed', err);
      }
    }
  }

  function placeholder(id, info = {}) {
    let c = placeholders.get(id);
    if (!c) placeholders.set(id, (c = drawPlaceholderPortrait({ ...info, id }, W, H)));
    return c;
  }

  /** Source canvas for an NPC (synchronous: renders on first use). `info` = dialogue tree (name, accent, look). */
  function source(id, info = {}) {
    if (cache.has(id)) return cache.get(id);
    const r = renderNow(id);
    if (r) {
      store(id, r);
      return r;
    }
    return placeholder(id, info);
  }

  /**
   * Non-blocking variant: returns what is available now (the real portrait when cached,
   * else the stand-in) and renders the real one shortly after — once the opening UI
   * animation is under way — calling `onReady(canvas)` when it arrives. `optional`
   * requests (chat faces, avatars) only queue a render once the portrait studio is warm;
   * until then they just wait for a portrait some dialogue renders.
   */
  function request(id, info = {}, onReady = null, { optional = false } = {}) {
    if (cache.has(id)) return cache.get(id);
    if ((failed.get(id) || 0) < 2 && ctx.portraits?.render) {
      if (optional && !warmed) {
        if (onReady) {
          const l = listeners.get(id) || [];
          l.push(onReady);
          listeners.set(id, l);
        }
      } else {
        const list = waiting.get(id) || [];
        list.push({ info, cb: onReady });
        waiting.set(id, list);
        schedule();
      }
    }
    return placeholder(id, info);
  }

  function schedule(delay = 140) {
    if (!timer) timer = setTimeout(flush, delay);
  }
  /** One portrait per slot so a burst of requests never stalls a single frame for long. */
  function flush() {
    timer = 0;
    const next = waiting.keys().next();
    if (next.done) return;
    const id = next.value;
    const list = waiting.get(id);
    waiting.delete(id);
    const r = cache.get(id) || renderNow(id);
    if (r) store(id, r, list);
    if (waiting.size) schedule(60);
  }

  /** Draws `src` cover-fitted into a new w×h canvas. */
  function fit(src, w, h) {
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d');
    const sa = src.width / src.height;
    const da = w / h;
    let sw = src.width;
    let sh = src.height;
    if (sa > da) sw = sh * da;
    else sh = sw / da;
    g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
    return out;
  }

  /** A fresh canvas copy of the portrait (cover-fitted to w×h); synchronous. */
  function canvas(id, info, w = W, h = H) {
    return fit(source(id, info), w, h);
  }

  /**
   * Portrait canvas for UI that can wait a moment: the stand-in now, `onReady(canvas)` with
   * the real portrait (same size) as soon as it has been rendered.
   */
  function canvasAsync(id, info, w = W, h = H, onReady = null) {
    const now = request(id, info, onReady ? (src) => onReady(fit(src, w, h)) : null);
    return { canvas: fit(now, w, h), real: cache.has(id) };
  }

  function crop(src, size) {
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const g = out.getContext('2d');
    const s = Math.min(src.width, src.height) * 0.62;
    g.drawImage(src, (src.width - s) / 2, src.height * 0.12, s, s, 0, 0, size, size);
    return out;
  }

  /** Small square face crop for avatars (stand-in until the real portrait exists). */
  function avatar(id, info, size = 72) {
    return crop(cache.get(id) || placeholder(id, info), size);
  }

  /**
   * Tiny face image (data URL, cached) for chat lines, cropped from the bust portrait.
   * Returns null while the portrait is still being rendered (the caller shows a monogram)
   * and calls `onReady(url)` once it exists.
   */
  const faces = new Map();
  function faceURL(id, info = {}, size = 40, onReady = null) {
    if (faces.has(id)) return faces.get(id);
    if (cache.has(id)) {
      let url = null;
      try {
        url = crop(cache.get(id), size).toDataURL('image/png');
      } catch (err) {
        console.warn('[systems] chat avatar failed for', id, err);
      }
      faces.set(id, url);
      return url;
    }
    request(id, info, onReady ? () => onReady(faceURL(id, info, size)) : null, { optional: true });
    return null;
  }

  return {
    source,
    request,
    canvas,
    canvasAsync,
    avatar,
    faceURL,
    has: (id) => cache.has(id),
    /** True once a portrait has been rendered (the studio's shaders are compiled). */
    get warmed() {
      return warmed;
    },
    /** Renders a portrait in the background if it isn't cached yet (pre-warming near NPCs). */
    warm(id, info) {
      if (warmed && !cache.has(id) && !waiting.has(id)) request(id, info);
    },
    invalidate: (id) => (cache.delete(id), faces.delete(id), failed.delete(id)),
  };
}
