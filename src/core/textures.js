import * as THREE from 'three';

/**
 * Canvas-texture helpers shared by modules (all procedural, no image files).
 */

/** Creates a CanvasTexture by drawing with `draw(g, w, h)`. */
export function canvasTexture(width, height, draw, { srgb = true, repeat = null, mipmaps = true, anisotropy = 4 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  draw(g, width, height);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.generateMipmaps = mipmaps;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * Draws the Ø emblem: a circle crossed by a diagonal slash that extends beyond
 * the ring (lower-left → upper-right), like the Ø Universe logo.
 */
export function drawEmblem(g, cx, cy, r, lineWidth, color = '#ece6dc') {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = lineWidth;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  const ext = r * 1.45;
  const d = ext / Math.SQRT2;
  g.beginPath();
  g.moveTo(cx - d, cy + d);
  g.lineTo(cx + d, cy - d);
  g.stroke();
  g.restore();
}

/** Square texture with the emblem on a (possibly transparent) background. */
export function emblemTexture({ size = 256, color = '#ece6dc', background = null, scale = 0.32, line = 0.045 } = {}) {
  return canvasTexture(size, size, (g, w, h) => {
    if (background) {
      g.fillStyle = background;
      g.fillRect(0, 0, w, h);
    }
    drawEmblem(g, w / 2, h / 2, w * scale, w * line, color);
  });
}

/** Vertical banner texture (dark fabric with emblem), used on plaza pillars. */
export function bannerTexture({ width = 256, height = 640, fabric = '#2b3a7a', color = '#e9e4ff' } = {}) {
  return canvasTexture(width, height, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, fabric);
    grad.addColorStop(1, '#141a35');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 4;
    g.strokeRect(14, 14, w - 28, h - 28);
    drawEmblem(g, w / 2, h * 0.34, w * 0.26, w * 0.04, color);
  });
}

/** Simple value-noise texture (grayscale), handy for roughness/bump variety. */
export function noiseTexture(size = 256, { scale = 8, seed = 1, repeat = [1, 1], srgb = false } = {}) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const grid = scale + 1;
  const v = Array.from({ length: grid * grid }, rnd);
  const at = (x, y) => v[(y % scale) * grid + (x % scale)];
  return canvasTexture(
    size,
    size,
    (g, w, h) => {
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const fx = (x / w) * scale;
          const fy = (y / h) * scale;
          const ix = Math.floor(fx);
          const iy = Math.floor(fy);
          const tx = fx - ix;
          const ty = fy - iy;
          const sx = tx * tx * (3 - 2 * tx);
          const sy = ty * ty * (3 - 2 * ty);
          const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
          const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
          const n = (a + (b - a) * sy) * 255;
          const i = (y * w + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
          img.data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    },
    { srgb, repeat },
  );
}

/** Text label texture (for in-world signs). Returns {texture, aspect}. */
export function textTexture(text, { font = '500 64px Jost, sans-serif', color = '#ece6dc', background = null, padding = 24, letterSpacing = 0 } = {}) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const m = probe.measureText(text);
  const w = Math.ceil(m.width + padding * 2 + letterSpacing * text.length);
  const fontPx = parseInt(font.match(/(\d+)px/)?.[1] || '64', 10);
  const h = Math.ceil(fontPx * 1.5 + padding);
  const texture = canvasTexture(w, h, (g) => {
    if (background) {
      g.fillStyle = background;
      g.fillRect(0, 0, w, h);
    }
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = `${letterSpacing}px`;
    g.fillText(text, padding, h / 2);
  });
  return { texture, aspect: w / h };
}
