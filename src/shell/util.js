/**
 * Small shell helpers: SVG-icon → Image cache for canvas drawing, the Ø logo
 * mark as inline SVG, key-cap rendering, zone lookups and formatting.
 */
import { icon } from '../ui/icons.js';
import { formatDistance, formatNumber } from '../core/math.js';
import { t } from '../core/i18n.js';

export { formatDistance, formatNumber };

// ------------------------------------------------------------------ icons
const imageCache = new Map();

/**
 * Returns an HTMLImageElement of a registered line icon in `color`, rendered
 * at `size` px (use 2× the drawn size for crisp results). The image loads
 * asynchronously: check `img.complete && img.naturalWidth` before drawing.
 */
export function iconImage(name, color = '#ece6dc', size = 48, strokeWidth = 1.6) {
  const key = `${name}|${color}|${size}|${strokeWidth}`;
  let img = imageCache.get(key);
  if (!img) {
    const svg = icon(name, size)
      .replace('class="icon "', 'xmlns="http://www.w3.org/2000/svg"')
      .replace('stroke-width="1.6"', `stroke-width="${strokeWidth}"`)
      .replaceAll('currentColor', color);
    img = new Image();
    img.decoding = 'async';
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    imageCache.set(key, img);
  }
  return img;
}

export const imageReady = (img) => !!img && img.complete && img.naturalWidth > 0;

// ------------------------------------------------------------------- logo
/**
 * The Ø mark: a thin ring crossed by a slash that extends beyond it
 * (lower-left → upper-right), as on the poster. `animated` adds path lengths
 * so CSS can draw it in with stroke-dashoffset.
 */
export function logoMarkSVG({ size = 64, stroke = 4.2, className = 'shell-mark' } = {}) {
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <circle class="shell-mark-ring" cx="50" cy="50" r="35.5" stroke="currentColor" stroke-width="${stroke}" pathLength="100" transform="rotate(-128 50 50)"/>
    <path class="shell-mark-slash" d="M17.5 92.5 82.5 7.5" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" pathLength="100"/>
  </svg>`;
}

// --------------------------------------------------------------- key caps
const MOUSE_GLYPHS = {
  '@mouse': { icon: 'mouse', label: { en: 'Mouse', nl: 'Muis' } },
  '@scroll': { icon: 'shell-wheel', label: { en: 'Scroll wheel', nl: 'Scrollwiel' } },
  '@click': { icon: 'shell-lmb', label: { en: 'Left mouse button', nl: 'Linkermuisknop' } },
  '@right': { icon: 'shell-rmb', label: { en: 'Right mouse button', nl: 'Rechtermuisknop' } },
};
const SEPARATORS = new Set(['/', '–']);
const OR_WORDS = new Set(['or', 'of']); // "A / D or Q / E" — shown as the active language's word

/** Renders a token string ('W A S D / ↑ ← ↓ →', 'X / @right', or { en, nl } of those) into key caps. */
export function renderKeys(h, tokens) {
  const out = h('span', { class: 'shell-keys' });
  for (const tok of t(tokens).split(/\s+/).filter(Boolean)) {
    if (SEPARATORS.has(tok)) out.appendChild(h('span', { class: 'shell-keys-sep', text: tok }));
    else if (OR_WORDS.has(tok)) out.appendChild(h('span', { class: 'shell-keys-sep', text: t({ en: 'or', nl: 'of' }) }));
    else if (MOUSE_GLYPHS[tok]) {
      const g = MOUSE_GLYPHS[tok];
      out.appendChild(h('span', { class: 'kbd shell-kbd shell-kbd-mouse', title: t(g.label), html: icon(g.icon, 16) }));
    } else out.appendChild(h('span', { class: `kbd shell-kbd${tok.length > 2 ? ' shell-kbd-wide' : ''}`, text: tok }));
  }
  return out;
}

// ------------------------------------------------------------------ misc
/** Formats seconds as "3 h 12 min" (nl "3 u 12 min") / "12 min" / "< 1 min". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return '< 1 min';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return t({ en: '{h} h {m} min', nl: '{h} u {m} min' }, { h, m: m % 60 });
}

/** Resolves a world position from a vehicle-ish object (APIs vary per module). */
export function objectPosition(o) {
  if (!o) return null;
  if (o.isObject3D) return o.position;
  return o.object?.position || o.mesh?.position || o.group?.position || (o.position?.isVector3 ? o.position : null);
}

/** Shortest signed angle difference in degrees, result in [-180, 180). */
export function degDiff(a, b) {
  let d = (b - a) % 360;
  if (d < -180) d += 360;
  if (d >= 180) d -= 360;
  return d;
}

let softwareGL = null;
/**
 * True on a software WebGL renderer (SwiftShader / llvmpipe: headless tests,
 * machines without a GPU), where every frame costs seconds: the shell then
 * skips the camera intro and defers the title thumbnails.
 */
export function isSoftwareRenderer(renderer) {
  if (softwareGL != null) return softwareGL;
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    softwareGL = /swiftshader|llvmpipe|software|softpipe/i.test(name);
  } catch {
    softwareGL = false;
  }
  return softwareGL;
}

/** Plays a UI sound if the audio module registered it (never throws). */
export function uiSound(ctx, name, opts) {
  try {
    ctx.audio?.play?.(name, opts);
  } catch {
    /* ignore */
  }
}
