/**
 * Landmarks — procedural canvas textures (no image files). Each generator is
 * memoised so materials shared between landmarks reuse one GPU texture.
 */
import * as THREE from 'three';
import { canvasTexture, drawEmblem } from '../core/textures.js';
import { Rng } from '../core/math.js';

const cache = new Map();
function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

/** Disposes every cached texture (used if the module is re-installed). */
export function disposeTextures() {
  for (const t of cache.values()) t?.dispose?.();
  cache.clear();
}

/** Soft radial dot (white → transparent): particles, light pools, flares. */
export function radialTexture() {
  return memo('radial', () =>
    canvasTexture(
      128,
      128,
      (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
        gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      },
      { srgb: false },
    ),
  );
}

/** Irregular ashlar stone blocks with cracks (tileable), sRGB colour map. */
export function stoneTexture() {
  return memo('stone', () =>
    canvasTexture(
      512,
      512,
      (g, w, h) => {
        const rng = new Rng('lm-stone');
        g.fillStyle = '#77716a';
        g.fillRect(0, 0, w, h);
        const rows = 6;
        const rh = h / rows;
        for (let r = 0; r < rows; r++) {
          let x = -rng.range(0, 80);
          while (x < w) {
            const bw = rng.range(70, 150);
            const tone = rng.range(0.78, 1.12);
            const base = [119 * tone, 113 * tone, 104 * tone].map((v) => Math.round(Math.min(255, v + rng.range(-6, 6))));
            g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
            const y = r * rh;
            // draw wrapped (tileable)
            for (const ox of [0, -w, w]) g.fillRect(x + ox + 2, y + 2, bw - 4, rh - 4);
            // speckle + weathering
            for (let i = 0; i < 90; i++) {
              const px = x + rng.range(2, bw - 2);
              const py = y + rng.range(2, rh - 2);
              const v = rng.range(-28, 22);
              g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 250 : 0},${v > 0 ? 240 : 0},${Math.abs(v) / 255})`;
              for (const ox of [0, -w, w]) g.fillRect(px + ox, py, rng.range(2, 7), rng.range(2, 6));
            }
            // dark lower edge (ambient occlusion in the joint)
            const gr = g.createLinearGradient(0, y + rh - 14, 0, y + rh);
            gr.addColorStop(0, 'rgba(0,0,0,0)');
            gr.addColorStop(1, 'rgba(0,0,0,0.35)');
            g.fillStyle = gr;
            for (const ox of [0, -w, w]) g.fillRect(x + ox, y + rh - 14, bw, 14);
            x += bw;
          }
        }
        // cracks
        g.strokeStyle = 'rgba(30,26,22,0.55)';
        g.lineWidth = 1.4;
        for (let i = 0; i < 26; i++) {
          let px = rng.range(0, w);
          let py = rng.range(0, h);
          g.beginPath();
          g.moveTo(px, py);
          for (let k = 0; k < 6; k++) {
            px += rng.range(-18, 18);
            py += rng.range(4, 16);
            g.lineTo(px, py);
          }
          g.stroke();
        }
      },
      { repeat: [1, 1] },
    ),
  );
}

/** Weathered stone surface without joints (big ashlar blocks get their joints from geometry). */
export function weatheredTexture() {
  return memo('weathered', () =>
    canvasTexture(
      512,
      512,
      (g, w, h) => {
        const rng = new Rng('lm-weathered');
        g.fillStyle = '#8c8478';
        g.fillRect(0, 0, w, h);
        const wrap = (fn) => {
          for (const ox of [0, -w, w]) for (const oy of [0, -h, h]) fn(ox, oy);
        };
        // large soft stains (lighter sun-bleached / darker damp)
        for (let i = 0; i < 70; i++) {
          const x = rng.range(0, w);
          const y = rng.range(0, h);
          const r = rng.range(30, 120);
          const dark = rng.chance(0.55);
          const a = rng.range(0.05, 0.16);
          wrap((ox, oy) => {
            const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
            gr.addColorStop(0, dark ? `rgba(40,34,26,${a})` : `rgba(235,222,200,${a})`);
            gr.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = gr;
            g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
          });
        }
        // pits + speckles
        for (let i = 0; i < 2600; i++) {
          const x = rng.range(0, w);
          const y = rng.range(0, h);
          const v = rng.range(-1, 1);
          g.fillStyle = v < 0 ? `rgba(30,26,20,${-v * 0.35})` : `rgba(255,248,230,${v * 0.18})`;
          const s = rng.range(1, 3.2);
          g.fillRect(x, y, s, s);
        }
        // hairline cracks
        g.strokeStyle = 'rgba(28,24,18,0.5)';
        g.lineWidth = 1.2;
        for (let i = 0; i < 16; i++) {
          let px = rng.range(0, w);
          let py = rng.range(0, h);
          g.beginPath();
          g.moveTo(px, py);
          for (let k = 0; k < 7; k++) {
            px += rng.range(-14, 14);
            py += rng.range(5, 18);
            g.lineTo(px, py);
          }
          g.stroke();
        }
        // lichen dots
        for (let i = 0; i < 160; i++) {
          const x = rng.range(0, w);
          const y = rng.range(0, h);
          g.fillStyle = rng.pick(['rgba(160,150,90,0.35)', 'rgba(110,120,70,0.3)', 'rgba(190,180,150,0.3)']);
          g.beginPath();
          g.arc(x, y, rng.range(1.5, 4.5), 0, Math.PI * 2);
          g.fill();
        }
      },
      { repeat: [1, 1] },
    ),
  );
}

/** Weathered wooden planks (planks run along U). */
export function woodTexture() {
  return memo('wood', () =>
    canvasTexture(
      512,
      512,
      (g, w, h) => {
        const rng = new Rng('lm-wood');
        const n = 8;
        const ph = h / n;
        for (let i = 0; i < n; i++) {
          const tone = rng.range(0.75, 1.1);
          g.fillStyle = `rgb(${Math.round(122 * tone)},${Math.round(86 * tone)},${Math.round(58 * tone)})`;
          g.fillRect(0, i * ph, w, ph);
          // grain lines
          for (let k = 0; k < 26; k++) {
            const y = i * ph + rng.range(2, ph - 2);
            g.strokeStyle = `rgba(${rng.chance(0.5) ? '40,24,12' : '190,150,110'},${rng.range(0.08, 0.22)})`;
            g.lineWidth = rng.range(0.6, 2);
            g.beginPath();
            g.moveTo(0, y);
            for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * rng.range(0.5, 2.5));
            g.stroke();
          }
          // plank joints
          const jx = rng.range(0, w);
          g.fillStyle = 'rgba(20,12,6,0.6)';
          g.fillRect(jx, i * ph, 3, ph);
          g.fillRect(0, i * ph, w, 3);
          // knots
          for (let k = 0; k < 2; k++) {
            g.fillStyle = 'rgba(50,30,15,0.5)';
            g.beginPath();
            g.ellipse(rng.range(0, w), i * ph + ph / 2, rng.range(4, 9), rng.range(2, 4), 0, 0, Math.PI * 2);
            g.fill();
          }
        }
      },
      { repeat: [1, 1] },
    ),
  );
}

/** Rusty painted steel (tileable). */
export function rustTexture() {
  return memo('rust', () =>
    canvasTexture(
      256,
      256,
      (g, w, h) => {
        const rng = new Rng('lm-rust');
        g.fillStyle = '#4a3a30';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 260; i++) {
          const x = rng.range(0, w);
          const y = rng.range(0, h);
          const r = rng.range(3, 22);
          const c = rng.pick(['#7a4326', '#8f5129', '#5b3a28', '#3b302b', '#a35f2e', '#2f2a27']);
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, c);
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr;
          for (const ox of [0, -w, w]) for (const oy of [0, -h, h]) g.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
        }
        // streaks running down
        for (let i = 0; i < 40; i++) {
          const x = rng.range(0, w);
          g.fillStyle = `rgba(90,45,20,${rng.range(0.1, 0.3)})`;
          g.fillRect(x, rng.range(0, h), rng.range(1, 3), rng.range(20, 90));
        }
      },
      { repeat: [1, 1] },
    ),
  );
}

/** Violet leaf cluster card with alpha (canopy). */
export function leafTexture() {
  return memo('leaf', () => {
    const tex = canvasTexture(
      256,
      256,
      (g, w, h) => {
        const rng = new Rng('lm-leaf');
        g.clearRect(0, 0, w, h);
        const cols = ['#c9a0ff', '#a875f0', '#8e5ae0', '#7442c8', '#e1c4ff', '#9a64ff', '#6a3cc0', '#f0d8ff'];
        for (let i = 0; i < 230; i++) {
          // leaves concentrated in a soft blob
          const a = rng.range(0, Math.PI * 2);
          const d = Math.pow(rng.random(), 0.65) * w * 0.46;
          const x = w / 2 + Math.cos(a) * d;
          const y = h / 2 + Math.sin(a) * d * 0.9;
          const s = rng.range(5, 12) * (1 - (d / w) * 0.6);
          g.save();
          g.translate(x, y);
          g.rotate(rng.range(0, Math.PI * 2));
          g.fillStyle = rng.pick(cols);
          g.globalAlpha = rng.range(0.85, 1);
          g.beginPath();
          g.ellipse(0, 0, s, s * 0.48, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      },
      { mipmaps: true },
    );
    return tex;
  });
}

/**
 * Leaf-cluster card for the Levensboom canopy (alpha): ~330 pointed leaves in
 * three layers (dark back leaves, mid, bright front leaves lit from the upper
 * left), grouped in a few sub-clusters so the card outline is lumpy, plus a
 * handful of tiny glowing buds. Mostly luminance with a mild violet/pink/blue
 * hue spread: the per-instance colour sets the overall tint.
 */
export function canopyLeafTexture() {
  return memo('canopy-leaf', () =>
    canvasTexture(
      256,
      256,
      (g, w, h) => {
        const rng = new Rng('lm-canopy-leaf');
        g.clearRect(0, 0, w, h);
        const hues = [268, 276, 284, 292, 300, 258];
        const centers = [];
        for (let i = 0; i < 4; i++) {
          const a = rng.range(0, Math.PI * 2);
          const d = i === 0 ? 0 : rng.range(0.16, 0.26) * w;
          centers.push([w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d * 0.85, i === 0 ? 0.3 * w : rng.range(0.16, 0.22) * w]);
        }
        const leaf = (x, y, s, rot, hue, light) => {
          g.save();
          g.translate(x, y);
          g.rotate(rot);
          g.beginPath();
          g.moveTo(-s, 0);
          g.quadraticCurveTo(-s * 0.1, -s * 0.8, s, 0);
          g.quadraticCurveTo(-s * 0.1, s * 0.8, -s, 0);
          g.closePath();
          const gr = g.createLinearGradient(0, -s * 0.45, 0, s * 0.45);
          gr.addColorStop(0, `hsl(${hue}, 62%, ${Math.min(96, light * 1.18)}%)`);
          gr.addColorStop(0.55, `hsl(${hue}, 66%, ${light}%)`);
          gr.addColorStop(1, `hsl(${hue + 6}, 70%, ${light * 0.66}%)`);
          g.fillStyle = gr;
          g.fill();
          g.strokeStyle = `hsla(${hue}, 40%, ${Math.min(97, light * 1.35)}%, 0.55)`;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(-s * 0.8, 0);
          g.lineTo(s * 0.85, 0);
          g.stroke();
          g.restore();
        };
        const layer = (n, s0, s1, l0, l1, bias) => {
          for (let i = 0; i < n; i++) {
            const c = rng.pick(centers);
            const a = rng.range(0, Math.PI * 2);
            const d = Math.pow(rng.random(), 0.7) * c[2];
            // front leaves sit towards the lit upper-left of each cluster
            const x = c[0] + Math.cos(a) * d - bias * c[2] * 0.25;
            const y = c[1] + Math.sin(a) * d - bias * c[2] * 0.3;
            if (x < 8 || x > w - 8 || y < 8 || y > h - 8) continue;
            leaf(x, y, rng.range(s0, s1), rng.range(0, Math.PI * 2), rng.pick(hues), rng.range(l0, l1));
          }
        };
        layer(120, 9, 15, 24, 40, 0);
        layer(140, 8, 13, 44, 64, 0.5);
        layer(80, 6, 11, 66, 86, 1);
        // tiny glowing buds
        for (let i = 0; i < 14; i++) {
          const c = rng.pick(centers);
          const a = rng.range(0, Math.PI * 2);
          const d = rng.random() * c[2];
          const x = c[0] + Math.cos(a) * d;
          const y = c[1] + Math.sin(a) * d;
          const gr = g.createRadialGradient(x, y, 0, x, y, 4);
          gr.addColorStop(0, 'rgba(255,244,255,1)');
          gr.addColorStop(0.5, 'rgba(236,200,255,0.9)');
          gr.addColorStop(1, 'rgba(200,150,255,0)');
          g.fillStyle = gr;
          g.beginPath();
          g.arc(x, y, 4, 0, Math.PI * 2);
          g.fill();
        }
      },
      { mipmaps: true },
    ),
  );
}

/** Hanging vine strand card (vertical) with alpha. */
export function vineTexture() {
  return memo('vine', () =>
    canvasTexture(128, 512, (g, w, h) => {
      const rng = new Rng('lm-vine');
      g.clearRect(0, 0, w, h);
      for (let s = 0; s < 4; s++) {
        let x = w / 2 + rng.range(-30, 30);
        g.strokeStyle = '#3f4a26';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, 0);
        const len = rng.range(0.55, 1) * h;
        for (let y = 0; y < len; y += 8) {
          x += rng.range(-3, 3);
          g.lineTo(x, y);
          if (rng.chance(0.75)) {
            g.save();
            g.fillStyle = rng.pick(['#4d6b2a', '#5f7d33', '#3d5a22', '#6f8a3a', '#2f4a1c']);
            g.translate(x, y);
            g.rotate(rng.range(-1.2, 1.2) + (rng.chance(0.5) ? Math.PI : 0));
            g.beginPath();
            g.ellipse(6, 0, 7, 3.5, 0, 0, Math.PI * 2);
            g.fill();
            g.restore();
          }
        }
        g.stroke();
      }
    }),
  );
}

/** Fern / undergrowth card: a fan of arching fronds with leaflets (alpha). */
export function fernTexture() {
  return memo('fern', () =>
    canvasTexture(256, 256, (g, w, h) => {
      const rng = new Rng('lm-fern');
      g.clearRect(0, 0, w, h);
      const greens = ['#3d5a22', '#4d6b2a', '#5f7d33', '#34501d', '#6c8a3a', '#47662a'];
      for (let f = 0; f < 9; f++) {
        // frond from the bottom centre, arching outwards
        const ang = -Math.PI / 2 + rng.range(-1.15, 1.15);
        const len = rng.range(0.55, 0.95) * h * 0.95;
        const bend = rng.range(0.4, 0.9) * Math.sign(Math.cos(ang) || 1);
        g.strokeStyle = '#2f4519';
        g.lineWidth = 2;
        let px = w / 2 + rng.range(-8, 8);
        let py = h - 2;
        g.beginPath();
        g.moveTo(px, py);
        const pts = [];
        for (let i = 1; i <= 14; i++) {
          const t = i / 14;
          const a = ang + bend * t * t;
          px += Math.cos(a) * (len / 14);
          py += Math.sin(a) * (len / 14);
          pts.push([px, py, a, t]);
          g.lineTo(px, py);
        }
        g.stroke();
        g.fillStyle = rng.pick(greens);
        for (const [x, y, a, t] of pts) {
          const s = (1 - t * 0.75) * rng.range(9, 13);
          for (const side of [-1, 1]) {
            g.save();
            g.translate(x, y);
            g.rotate(a + side * 1.15);
            g.beginPath();
            g.ellipse(s * 0.55, 0, s * 0.62, s * 0.2, 0, 0, Math.PI * 2);
            g.fill();
            g.restore();
          }
        }
      }
    }),
  );
}

/** Ivy patch card: a dense blob of small leaves with a ragged edge (alpha). */
export function ivyTexture() {
  return memo('ivy', () =>
    canvasTexture(256, 256, (g, w, h) => {
      const rng = new Rng('lm-ivy');
      g.clearRect(0, 0, w, h);
      const greens = ['#2f4a1c', '#3d5a22', '#4a6a28', '#557a2e', '#3a5520', '#62803a'];
      // creeping stems
      g.strokeStyle = 'rgba(52,44,26,0.9)';
      g.lineWidth = 1.6;
      for (let s = 0; s < 7; s++) {
        let x = rng.range(0.2, 0.8) * w;
        let y = 0;
        g.beginPath();
        g.moveTo(x, y);
        while (y < h) {
          x += rng.range(-10, 10);
          y += rng.range(8, 16);
          g.lineTo(x, y);
        }
        g.stroke();
      }
      for (let i = 0; i < 520; i++) {
        // denser at the top (ivy hangs from the wall crown), ragged sides
        const y = Math.pow(rng.random(), 1.35) * h;
        const spread = 0.5 - 0.12 * (y / h);
        const x = w / 2 + rng.gauss() * w * spread * 0.38;
        if (x < 4 || x > w - 4) continue;
        const s = rng.range(4.5, 9);
        g.save();
        g.translate(x, y);
        g.rotate(rng.range(0, Math.PI * 2));
        g.fillStyle = rng.pick(greens);
        g.beginPath();
        // heart-ish ivy leaf: three lobes
        g.ellipse(0, -s * 0.2, s * 0.55, s * 0.42, 0, 0, Math.PI * 2);
        g.ellipse(-s * 0.35, s * 0.2, s * 0.38, s * 0.3, 0.6, 0, Math.PI * 2);
        g.ellipse(s * 0.35, s * 0.2, s * 0.38, s * 0.3, -0.6, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }),
  );
}

/** Railing mesh (chain-link-ish grid) with alpha. */
export function meshPanelTexture() {
  return memo('meshpanel', () =>
    canvasTexture(
      128,
      128,
      (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.strokeStyle = 'rgba(70,58,50,1)';
        g.lineWidth = 2.2;
        for (let i = -w; i < w * 2; i += 16) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i + h, h);
          g.stroke();
          g.beginPath();
          g.moveTo(i, h);
          g.lineTo(i + h, 0);
          g.stroke();
        }
      },
      { repeat: [1, 1] },
    ),
  );
}

/** Corrugated container side (vertical ribs, greyscale → tinted by vertex colour). */
export function ribTexture() {
  return memo('ribs', () =>
    canvasTexture(
      256,
      256,
      (g, w, h) => {
        for (let x = 0; x < w; x++) {
          const v = 170 + Math.sin((x / w) * Math.PI * 2 * 12) * 50;
          g.fillStyle = `rgb(${v},${v},${v})`;
          g.fillRect(x, 0, 1, h);
        }
        const rng = new Rng('lm-ribs');
        for (let i = 0; i < 60; i++) {
          g.fillStyle = `rgba(60,40,30,${rng.range(0.05, 0.18)})`;
          g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(2, 14), rng.range(10, 60));
        }
      },
      { repeat: [1, 1] },
    ),
  );
}

/** Landing-pad marking atlas (2×2 cells) with numbers. Colour map with alpha. */
export function padTexture(labels = ['01', '02', '03', '04']) {
  const single = labels.length === 1;
  return memo(`pads:${labels.join(',')}`, () =>
    canvasTexture(single ? 512 : 1024, single ? 512 : 1024, (g, W) => {
      g.clearRect(0, 0, W, W);
      const cell = single ? W : W / 2;
      labels.forEach((label, i) => {
        const cx = (i % 2) * cell + cell / 2;
        const cy = Math.floor(i / 2) * cell + cell / 2;
        const r = cell * 0.46;
        g.save();
        // outer ring (yellow/white hazard)
        g.strokeStyle = 'rgba(240,190,70,0.95)';
        g.lineWidth = cell * 0.035;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([cell * 0.05, cell * 0.035]);
        g.strokeStyle = 'rgba(235,230,220,0.85)';
        g.lineWidth = cell * 0.012;
        g.beginPath();
        g.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        // Ø emblem in the middle
        drawEmblem(g, cx, cy - cell * 0.03, r * 0.36, cell * 0.022, 'rgba(236,230,220,0.92)');
        // number
        g.fillStyle = 'rgba(240,190,70,0.95)';
        g.font = `600 ${Math.round(cell * 0.13)}px Jost, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, cx, cy + r * 0.66);
        // touchdown cross ticks
        g.strokeStyle = 'rgba(235,230,220,0.7)';
        g.lineWidth = cell * 0.012;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62);
          g.lineTo(cx + Math.cos(a) * r * 0.76, cy + Math.sin(a) * r * 0.76);
          g.stroke();
        }
        g.restore();
      });
    }),
  );
}

/** Holographic screen textures (sRGB, drawn once). kind: 'stage' | 'portrait' | 'logo' | 'market' | 'nachtmarkt' | 'planet' */
export function holoTexture(kind) {
  return memo(`holo:${kind}`, () => {
    const sizes = { stage: [1024, 512], portrait: [256, 512], logo: [256, 256], market: [512, 320], nachtmarkt: [512, 128], planet: [256, 128], festival: [1024, 256], oran: [256, 256], band: [1024, 320] };
    const [w, h] = sizes[kind] || [256, 256];
    return canvasTexture(w, h, (g) => {
      const rng = new Rng(`lm-holo-${kind}`);
      g.clearRect(0, 0, w, h);
      if (kind === 'stage') {
        const bg = g.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#120a35');
        bg.addColorStop(0.6, '#2a1260');
        bg.addColorStop(1, '#4b1f8a');
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 420; i++) {
          g.fillStyle = `rgba(255,255,255,${rng.range(0.2, 0.9)})`;
          g.fillRect(rng.range(0, w), rng.range(0, h * 0.8), rng.range(1, 3), rng.range(1, 3));
        }
        // big planet with ring
        const px = w * 0.62;
        const py = h * 0.5;
        const pr = h * 0.3;
        const pg = g.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
        pg.addColorStop(0, '#d9e8ff');
        pg.addColorStop(0.5, '#7aa0ff');
        pg.addColorStop(1, '#2b2a7a');
        g.fillStyle = pg;
        g.beginPath();
        g.arc(px, py, pr, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(200,170,255,0.8)';
        g.lineWidth = 6;
        g.beginPath();
        g.ellipse(px, py, pr * 1.8, pr * 0.42, -0.25, 0, Math.PI * 2);
        g.stroke();
        // shooting stars (starfall)
        g.lineCap = 'round';
        for (let i = 0; i < 14; i++) {
          const sx = rng.range(0, w);
          const sy = rng.range(0, h * 0.6);
          const l = rng.range(40, 120);
          const sg = g.createLinearGradient(sx, sy, sx - l, sy - l * 0.5);
          sg.addColorStop(0, 'rgba(255,255,255,0.95)');
          sg.addColorStop(1, 'rgba(160,120,255,0)');
          g.strokeStyle = sg;
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(sx, sy);
          g.lineTo(sx - l, sy - l * 0.5);
          g.stroke();
        }
        g.fillStyle = 'rgba(240,235,255,0.95)';
        g.font = `500 ${Math.round(h * 0.1)}px Jost, sans-serif`;
        g.textAlign = 'left';
        if ('letterSpacing' in g) g.letterSpacing = `${Math.round(h * 0.03)}px`;
        g.fillText('STARFALL', w * 0.07, h * 0.42);
        g.fillText('FESTIVAL', w * 0.07, h * 0.56);
        drawEmblem(g, w * 0.12, h * 0.78, h * 0.07, 5, 'rgba(240,235,255,0.9)');
      } else if (kind === 'festival') {
        g.fillStyle = 'rgba(20,10,50,0.85)';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#efe6ff';
        g.font = `500 ${Math.round(h * 0.34)}px Jost, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if ('letterSpacing' in g) g.letterSpacing = `${Math.round(h * 0.08)}px`;
        g.fillText('STARFALL FESTIVAL', w / 2, h / 2);
      } else if (kind === 'portrait') {
        // holographic advert: a woman in profile (techwear collar, ponytail),
        // cyan rim light along the face, glow behind the head, scanlines + Ø
        const X = (v) => v * (w / 256);
        const Y = (v) => v * (h / 512);
        const bg = g.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#16206a');
        bg.addColorStop(0.55, '#3a2a9a');
        bg.addColorStop(1, '#6a2fc8');
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        const halo = g.createRadialGradient(X(150), Y(210), X(10), X(150), Y(210), X(150));
        halo.addColorStop(0, 'rgba(120,220,255,0.55)');
        halo.addColorStop(1, 'rgba(120,220,255,0)');
        g.fillStyle = halo;
        g.fillRect(0, 0, w, h);
        // shoulders / jacket
        g.fillStyle = '#121638';
        g.beginPath();
        g.moveTo(X(0), Y(512));
        g.lineTo(X(0), Y(420));
        g.quadraticCurveTo(X(40), Y(350), X(105), Y(335));
        g.lineTo(X(150), Y(330));
        g.quadraticCurveTo(X(215), Y(360), X(256), Y(430));
        g.lineTo(X(256), Y(512));
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(140,220,255,0.7)';
        g.lineWidth = X(2);
        g.beginPath();
        g.moveTo(X(118), Y(338));
        g.quadraticCurveTo(X(150), Y(372), X(178), Y(352));
        g.stroke();
        // neck + head (profile facing right)
        const skin = g.createLinearGradient(0, Y(120), 0, Y(340));
        skin.addColorStop(0, '#c8d4ff');
        skin.addColorStop(1, '#7e6cf0');
        g.fillStyle = skin;
        g.beginPath();
        g.moveTo(X(100), Y(338));
        g.quadraticCurveTo(X(104), Y(300), X(96), Y(272));
        g.quadraticCurveTo(X(70), Y(220), X(84), Y(168));
        g.quadraticCurveTo(X(104), Y(118), X(148), Y(116));
        g.quadraticCurveTo(X(184), Y(122), X(184), Y(170));
        g.lineTo(X(186), Y(186));
        g.quadraticCurveTo(X(190), Y(204), X(202), Y(222));
        g.quadraticCurveTo(X(196), Y(232), X(186), Y(232));
        g.quadraticCurveTo(X(194), Y(240), X(188), Y(246));
        g.lineTo(X(182), Y(250));
        g.quadraticCurveTo(X(190), Y(256), X(184), Y(262));
        g.quadraticCurveTo(X(184), Y(282), X(166), Y(286));
        g.quadraticCurveTo(X(150), Y(290), X(146), Y(298));
        g.quadraticCurveTo(X(146), Y(318), X(152), Y(334));
        g.closePath();
        g.fill();
        // hair: crown, fringe and a ponytail falling behind the shoulder
        g.fillStyle = '#24124a';
        g.beginPath();
        g.moveTo(X(186), Y(168));
        g.quadraticCurveTo(X(184), Y(112), X(140), Y(108));
        g.quadraticCurveTo(X(86), Y(108), X(76), Y(170));
        g.quadraticCurveTo(X(70), Y(214), X(92), Y(250));
        g.quadraticCurveTo(X(110), Y(200), X(124), Y(184));
        g.quadraticCurveTo(X(156), Y(150), X(186), Y(168));
        g.closePath();
        g.fill();
        g.beginPath();
        g.moveTo(X(84), Y(150));
        g.quadraticCurveTo(X(30), Y(170), X(34), Y(250));
        g.quadraticCurveTo(X(38), Y(320), X(16), Y(372));
        g.quadraticCurveTo(X(58), Y(330), X(60), Y(262));
        g.quadraticCurveTo(X(62), Y(200), X(92), Y(176));
        g.closePath();
        g.fill();
        // ear + eye
        g.fillStyle = 'rgba(150,140,240,0.9)';
        g.beginPath();
        g.ellipse(X(118), Y(212), X(8), Y(13), 0.2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#1a1440';
        g.beginPath();
        g.ellipse(X(170), Y(192), X(7), Y(3), -0.15, 0, Math.PI * 2);
        g.fill();
        // cyan rim light along the face (forehead → chin)
        g.strokeStyle = 'rgba(170,245,255,0.95)';
        g.lineWidth = X(3);
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(X(176), Y(128));
        g.quadraticCurveTo(X(184), Y(140), X(184), Y(170));
        g.lineTo(X(186), Y(186));
        g.quadraticCurveTo(X(190), Y(204), X(202), Y(222));
        g.quadraticCurveTo(X(196), Y(232), X(186), Y(232));
        g.quadraticCurveTo(X(194), Y(240), X(188), Y(246));
        g.lineTo(X(182), Y(250));
        g.quadraticCurveTo(X(190), Y(256), X(184), Y(262));
        g.quadraticCurveTo(X(184), Y(282), X(166), Y(286));
        g.stroke();
        // scanlines, frame and the Ø
        for (let y = 0; y < h; y += 4) {
          g.fillStyle = 'rgba(255,255,255,0.05)';
          g.fillRect(0, y, w, 1);
        }
        g.strokeStyle = 'rgba(160,220,255,0.55)';
        g.lineWidth = X(2);
        g.strokeRect(X(5), Y(5), w - X(10), h - Y(10));
        drawEmblem(g, w * 0.5, h * 0.88, w * 0.08, X(3.5), 'rgba(235,240,255,0.95)');
      } else if (kind === 'logo') {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(60,40,140,0.85)');
        gr.addColorStop(1, 'rgba(20,10,60,0.7)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        drawEmblem(g, w / 2, h / 2, w * 0.28, w * 0.04, '#e9e4ff');
        g.strokeStyle = 'rgba(200,190,255,0.6)';
        g.lineWidth = 3;
        g.strokeRect(6, 6, w - 12, h - 12);
      } else if (kind === 'market') {
        g.fillStyle = 'rgba(14,40,60,0.75)';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(127,224,255,0.9)';
        g.lineWidth = 3;
        g.strokeRect(4, 4, w - 8, h - 8);
        g.fillStyle = '#dff6ff';
        g.font = `500 ${Math.round(h * 0.09)}px Jost, sans-serif`;
        g.fillText('Marketplace', w * 0.08, h * 0.16);
        g.font = `400 ${Math.round(h * 0.06)}px Jost, sans-serif`;
        ['Kopen', 'Verkopen', 'Mijn items'].forEach((t, i) => {
          g.fillStyle = i === 0 ? 'rgba(127,224,255,0.35)' : 'rgba(127,224,255,0.1)';
          g.fillRect(w * 0.06 + i * w * 0.3, h * 0.22, w * 0.27, h * 0.1);
          g.fillStyle = '#dff6ff';
          g.fillText(t, w * 0.1 + i * w * 0.3, h * 0.29);
        });
        for (let i = 0; i < 3; i++) {
          const x = w * 0.06 + i * w * 0.3;
          g.strokeStyle = 'rgba(127,224,255,0.5)';
          g.strokeRect(x, h * 0.38, w * 0.27, h * 0.52);
          g.fillStyle = 'rgba(127,224,255,0.18)';
          g.fillRect(x + 8, h * 0.42, w * 0.27 - 16, h * 0.25);
          g.fillStyle = '#dff6ff';
          g.fillText(['750', '1.200', '950'][i] + ' Ø', x + 10, h * 0.76);
          g.fillStyle = 'rgba(127,224,255,0.4)';
          g.fillRect(x + 10, h * 0.8, w * 0.27 - 20, h * 0.07);
        }
      } else if (kind === 'nachtmarkt') {
        g.font = `500 ${Math.round(h * 0.56)}px Jost, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if ('letterSpacing' in g) g.letterSpacing = `${Math.round(h * 0.12)}px`;
        g.shadowColor = 'rgba(255,90,220,1)';
        g.shadowBlur = 18;
        g.fillStyle = '#ffd6f6';
        g.fillText('NACHTMARKT', w / 2, h / 2);
        g.shadowBlur = 0;
      } else if (kind === 'planet') {
        // equirect-ish banded planet surface for hologram spheres
        for (let y = 0; y < h; y++) {
          const v = Math.sin((y / h) * Math.PI * 7 + Math.sin(y * 0.2)) * 0.5 + 0.5;
          g.fillStyle = `rgba(${150 + v * 90},${170 + v * 60},255,${0.35 + v * 0.4})`;
          g.fillRect(0, y, w, 1);
        }
        for (let i = 0; i < 40; i++) {
          g.fillStyle = 'rgba(255,255,255,0.25)';
          g.beginPath();
          g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(4, 18), rng.range(2, 6), 0, 0, Math.PI * 2);
          g.fill();
        }
      } else if (kind === 'band') {
        // holographic band: singer, two guitarists, drummer, keys (glowing outlines)
        g.lineCap = 'round';
        g.lineJoin = 'round';
        const fig = (x, pose) => {
          const s = h / 320;
          const y0 = h * 0.97;
          g.save();
          g.translate(x, 0);
          g.shadowColor = 'rgba(140,200,255,1)';
          g.shadowBlur = 14 * s;
          g.strokeStyle = 'rgba(225,240,255,0.95)';
          g.fillStyle = 'rgba(120,170,255,0.28)';
          g.lineWidth = 5 * s;
          // body
          const hipY = y0 - 120 * s;
          const shY = y0 - 205 * s;
          g.beginPath();
          g.moveTo(-14 * s, y0); g.lineTo(-6 * s, hipY); g.lineTo(6 * s, hipY); g.lineTo(16 * s, y0);
          g.moveTo(0, hipY); g.lineTo(0, shY);
          g.stroke();
          g.beginPath();
          g.arc(0, shY - 26 * s, 17 * s, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          g.beginPath();
          if (pose === 'mic') {
            g.moveTo(0, shY + 8 * s); g.lineTo(-28 * s, shY - 14 * s); g.lineTo(-20 * s, shY - 46 * s);
            g.moveTo(0, shY + 8 * s); g.lineTo(30 * s, shY - 30 * s); g.lineTo(36 * s, shY - 70 * s);
            g.moveTo(-34 * s, y0); g.lineTo(-30 * s, shY - 22 * s);
          } else if (pose === 'guitar') {
            g.moveTo(0, shY + 8 * s); g.lineTo(-30 * s, shY + 50 * s); g.lineTo(-6 * s, hipY + 6 * s);
            g.moveTo(0, shY + 8 * s); g.lineTo(26 * s, shY + 40 * s); g.lineTo(54 * s, shY + 28 * s);
            g.moveTo(-36 * s, hipY + 16 * s); g.lineTo(70 * s, shY + 22 * s);
          } else if (pose === 'drums') {
            g.moveTo(0, shY + 8 * s); g.lineTo(-40 * s, shY + 30 * s); g.lineTo(-58 * s, shY + 4 * s);
            g.moveTo(0, shY + 8 * s); g.lineTo(40 * s, shY + 26 * s); g.lineTo(60 * s, shY - 2 * s);
          } else {
            g.moveTo(0, shY + 8 * s); g.lineTo(-24 * s, shY + 48 * s); g.lineTo(-40 * s, shY + 60 * s);
            g.moveTo(0, shY + 8 * s); g.lineTo(24 * s, shY + 48 * s); g.lineTo(40 * s, shY + 60 * s);
          }
          g.stroke();
          if (pose === 'guitar') {
            g.beginPath();
            g.ellipse(-26 * s, hipY + 4 * s, 26 * s, 17 * s, -0.4, 0, Math.PI * 2);
            g.fill();
            g.stroke();
          } else if (pose === 'drums') {
            for (const [dx, dy, r] of [[-70, 40, 26], [70, 40, 26], [0, 70, 40], [-90, -10, 18], [95, -20, 20]]) {
              g.beginPath();
              g.ellipse(dx * s, hipY + dy * s, r * s, r * 0.45 * s, 0, 0, Math.PI * 2);
              g.fill();
              g.stroke();
            }
          } else if (pose === 'keys') {
            g.strokeRect(-70 * s, shY + 56 * s, 140 * s, 14 * s);
            g.beginPath();
            g.moveTo(-60 * s, shY + 70 * s); g.lineTo(-50 * s, y0);
            g.moveTo(60 * s, shY + 70 * s); g.lineTo(50 * s, y0);
            g.stroke();
          }
          g.restore();
        };
        fig(w * 0.12, 'keys');
        fig(w * 0.32, 'guitar');
        fig(w * 0.5, 'mic');
        fig(w * 0.68, 'guitar');
        fig(w * 0.88, 'drums');
      } else if (kind === 'oran') {
        // dark cloth banner with a circle-and-line sigil (Oran's stall)
        g.fillStyle = '#1d2030';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(190,180,160,0.85)';
        g.lineWidth = 6;
        g.beginPath();
        g.arc(w / 2, h * 0.45, w * 0.26, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(w / 2, h * 0.08);
        g.lineTo(w / 2, h * 0.92);
        g.stroke();
        g.beginPath();
        g.arc(w / 2, h * 0.45, w * 0.07, 0, Math.PI * 2);
        g.stroke();
      }
    });
  });
}

/** Text sign texture (single line). Returns { texture, aspect }. */
export function signTexture(text, { color = '#ffe2b8', glow = 'rgba(255,170,90,1)', bg = null, height = 128, weight = 500 } = {}) {
  const key = `sign:${text}:${color}:${bg}`;
  return memo(key, () => {
    const probe = document.createElement('canvas').getContext('2d');
    const font = `${weight} ${Math.round(height * 0.6)}px Jost, sans-serif`;
    probe.font = font;
    const tw = probe.measureText(text).width + text.length * height * 0.08;
    const w = Math.min(2048, Math.ceil(tw + height * 0.8));
    const tex = canvasTexture(w, height, (g) => {
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, height);
      }
      g.font = font;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if ('letterSpacing' in g) g.letterSpacing = `${Math.round(height * 0.08)}px`;
      if (glow) {
        g.shadowColor = glow;
        g.shadowBlur = height * 0.18;
      }
      g.fillStyle = color;
      g.fillText(text, w / 2, height / 2);
    });
    tex.userData.aspect = w / height;
    return tex;
  });
}

/** Ground pulse ring texture for the beacon (concentric thin rings, additive). */
export function ringsTexture() {
  return memo('rings', () =>
    canvasTexture(
      512,
      512,
      (g, w, h) => {
        g.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        g.strokeStyle = 'rgba(140,200,255,1)';
        for (let i = 0; i < 4; i++) {
          g.lineWidth = 3 - i * 0.5;
          g.globalAlpha = 0.9 - i * 0.15;
          g.beginPath();
          g.arc(cx, cy, w * (0.2 + i * 0.09), 0, Math.PI * 2);
          g.stroke();
        }
        g.globalAlpha = 0.6;
        g.setLineDash([18, 12]);
        g.beginPath();
        g.arc(cx, cy, w * 0.48, 0, Math.PI * 2);
        g.stroke();
      },
      { srgb: false },
    ),
  );
}

/** Generic noise-ish grayscale data texture (repeat), for roughness breakup. */
export function grimeTexture() {
  return memo('grime', () => {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    const rng = new Rng('lm-grime');
    const grid = 16;
    const vals = Array.from({ length: grid * grid }, () => rng.random());
    const at = (x, y) => vals[((y + grid) % grid) * grid + ((x + grid) % grid)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * grid;
        const fy = (y / size) * grid;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
        const v = (a + (b - a) * sy) * 0.75 + rng.random() * 0.25;
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  });
}
