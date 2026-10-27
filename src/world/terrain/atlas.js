import * as THREE from 'three';

/**
 * Procedural vegetation atlas (1024², canvas 2D) + matching emissive atlas.
 * Every plant in the world uses ONE material with this atlas, so all tree,
 * bush, fern and flower variants share a single shader program.
 *
 * Cells are in canvas pixels; `uvRect(cell)` converts to UV (CanvasTexture
 * flips Y, so canvas top = v 1).
 */
export const ATLAS_SIZE = 1024;
export const CELLS = {
  pineA: [0, 0, 512, 192], // drooping pine branch, base left → tip right
  pineB: [512, 0, 512, 192], // blue-green spruce branch
  leafA: [0, 192, 256, 256], // broadleaf cluster (green)
  leafB: [256, 192, 256, 256], // broadleaf cluster (warm olive)
  leafC: [512, 192, 256, 256], // small-leaf shrub cluster
  tropic: [768, 192, 256, 256], // big tropical leaf, stem bottom → tip top
  palm: [0, 448, 512, 128], // palm frond, base left → tip right
  fern: [512, 448, 256, 128], // fern frond, base left → tip right
  glow: [768, 448, 256, 256], // bioluminescent leaf, stem bottom → tip top
  bark: [0, 576, 128, 448], // bark (tiles vertically)
  barkJungle: [128, 576, 128, 448], // pale mossy jungle bark
  flowers: [256, 576, 256, 64], // 4 flower heads (64² each): daisy, buttercup, violet, poppy
  grassTuft: [256, 640, 256, 64], // dry grass tuft card
  vine: [512, 576, 128, 448], // hanging vine strand
  bulbs: [640, 576, 128, 128], // glowing bulbs on stalks
  needleMass: [640, 704, 128, 128], // dense opaque needles (pine core cones)
};

export function uvRect(cell) {
  const [x, y, w, h] = CELLS[cell] || cell;
  const s = ATLAS_SIZE;
  return { u0: x / s, u1: (x + w) / s, v0: 1 - (y + h) / s, v1: 1 - y / s };
}

export function createAtlas() {
  const color = document.createElement('canvas');
  color.width = color.height = ATLAS_SIZE;
  const glow = document.createElement('canvas');
  glow.width = glow.height = ATLAS_SIZE;
  // CPU-backed canvases: drawing stays in software and the texture upload
  // never waits on a GPU readback (seconds under SwiftShader / busy GPUs)
  const g = color.getContext('2d', { willReadFrequently: true });
  const e = glow.getContext('2d', { willReadFrequently: true });
  e.fillStyle = '#000';
  e.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const rnd = mulberry(20241026);

  drawPineBranch(g, CELLS.pineA, rnd, { dark: [24, 46, 26], mid: [52, 84, 40], tip: [112, 140, 62] });
  drawPineBranch(g, CELLS.pineB, rnd, { dark: [20, 40, 36], mid: [44, 76, 62], tip: [96, 128, 98] });
  drawLeafCluster(g, CELLS.leafA, rnd, { base: [62, 98, 36], light: [128, 158, 60], dark: [30, 54, 22], size: 1 });
  drawLeafCluster(g, CELLS.leafB, rnd, { base: [96, 104, 40], light: [170, 160, 70], dark: [52, 58, 24], size: 1 });
  drawLeafCluster(g, CELLS.leafC, rnd, { base: [48, 80, 34], light: [98, 132, 56], dark: [24, 42, 20], size: 0.7 });
  drawTropicLeaf(g, CELLS.tropic, rnd);
  drawPalmFrond(g, CELLS.palm, rnd);
  drawFern(g, CELLS.fern, rnd);
  drawGlowLeaf(g, e, CELLS.glow, rnd);
  drawBark(g, CELLS.bark, rnd, [74, 58, 44], [40, 30, 22], [112, 94, 74]);
  drawBark(g, CELLS.barkJungle, rnd, [104, 104, 90], [58, 60, 50], [146, 146, 128], true);
  drawFlowers(g, e, CELLS.flowers, rnd);
  drawGrassTuft(g, CELLS.grassTuft, rnd);
  drawVine(g, CELLS.vine, rnd);
  drawBulbs(g, e, CELLS.bulbs, rnd);
  drawNeedleMass(g, CELLS.needleMass, rnd);

  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.name = 'veg-atlas';
  const emissiveMap = new THREE.CanvasTexture(glow);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.name = 'veg-glow-atlas';
  return { map, emissiveMap, canvas: color };
}

// ------------------------------------------------------------------ drawing
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const lerpC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function clip(g, cell) {
  const [x, y, w, h] = cell;
  g.save();
  g.beginPath();
  g.rect(x + 1, y + 1, w - 2, h - 2);
  g.clip();
  g.translate(x, y);
  return [w, h];
}

function drawPineBranch(g, cell, rnd, pal) {
  const [w, h] = clip(g, cell);
  g.lineCap = 'round';
  const y0 = h * 0.42;
  const pt = (t) => [t * w * 0.97 + 4, y0 + Math.pow(t, 1.6) * h * 0.14];
  // sub-twigs (fishbone), each with needle fans
  const twigs = [];
  for (let k = 0; k < 22; k++) {
    const t = 0.04 + (k / 22) * 0.9 + rnd() * 0.02;
    const [bx, by] = pt(t);
    for (const side of [-1, 1]) {
      const len = (1 - t * 0.7) * h * (0.38 + rnd() * 0.12);
      const ang = side * (0.75 + rnd() * 0.35) + 0.25;
      twigs.push({ bx, by, ex: bx + Math.cos(ang) * len * 1.25, ey: by + Math.sin(ang) * len * 0.62, t });
    }
  }
  const needles = (x0, y0n, x1, y1, t, density) => {
    const dx = x1 - x0;
    const dy = y1 - y0n;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const count = Math.ceil(len * density);
    for (let i = 0; i < count; i++) {
      const u = i / count;
      const px = x0 + dx * u;
      const py = y0n + dy * u;
      for (const side of [-1, 1]) {
        const nl = (7 + rnd() * 9) * (1 - u * 0.35);
        const a = 0.55 + rnd() * 0.5;
        const ex = px + (dx / len) * nl * Math.cos(a) + nx * side * nl * Math.sin(a);
        const ey = py + (dy / len) * nl * Math.cos(a) + ny * side * nl * Math.sin(a) + 1.5;
        const shade = Math.min(1, 0.25 + u * 0.55 + t * 0.25 + rnd() * 0.25);
        const c = shade < 0.5 ? lerpC(pal.dark, pal.mid, shade * 2) : lerpC(pal.mid, pal.tip, (shade - 0.5) * 2);
        g.strokeStyle = rgb(c);
        g.lineWidth = 1.6 + rnd() * 0.8;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(ex, ey);
        g.stroke();
      }
    }
  };
  // dense needle mass (tapered silhouette) so the cards read as full foliage
  g.beginPath();
  g.moveTo(2, y0 - h * 0.06);
  g.bezierCurveTo(w * 0.25, y0 - h * 0.42, w * 0.7, y0 - h * 0.3, w * 0.97, y0 + h * 0.1);
  g.bezierCurveTo(w * 0.7, y0 + h * 0.5, w * 0.25, y0 + h * 0.48, 2, y0 + h * 0.08);
  g.closePath();
  const mass = g.createLinearGradient(0, 0, w, 0);
  mass.addColorStop(0, rgb(pal.dark));
  mass.addColorStop(0.6, rgb(lerpC(pal.dark, pal.mid, 0.6)));
  mass.addColorStop(1, rgb(pal.mid));
  g.fillStyle = mass;
  g.fill();
  // main twig (bark colour), drawn under the needles
  g.strokeStyle = 'rgb(58,42,30)';
  g.lineWidth = 3.5;
  g.beginPath();
  for (let t = 0; t <= 1.001; t += 0.05) {
    const [x, y] = pt(t);
    if (t === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  for (const tw of twigs) {
    g.strokeStyle = 'rgb(66,50,34)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(tw.bx, tw.by);
    g.lineTo(tw.ex, tw.ey);
    g.stroke();
  }
  for (const tw of twigs) needles(tw.bx, tw.by, tw.ex, tw.ey, tw.t, 0.9);
  // needles along the main twig
  for (let k = 0; k < 40; k++) {
    const t0 = k / 40;
    const [ax, ay] = pt(t0);
    const [bx, by] = pt(t0 + 1 / 40);
    needles(ax, ay, bx, by, t0, 0.5);
  }
  g.restore();
}

function leafPath(g, len, wid) {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(wid * 0.9, len * 0.2, wid * 0.7, len * 0.75, 0, len);
  g.bezierCurveTo(-wid * 0.7, len * 0.75, -wid * 0.9, len * 0.2, 0, 0);
  g.closePath();
}

function drawLeafCluster(g, cell, rnd, pal) {
  const [w, h] = clip(g, cell);
  const cx = w / 2;
  const cy = h / 2;
  const R = w * 0.43;
  const n = Math.round(150 * (pal.size < 1 ? 1.4 : 1));
  // back-to-front: darker inner leaves first, lighter outer leaves on top
  const leaves = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(rnd()) * R;
    const a = rnd() * Math.PI * 2;
    leaves.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.92, r, a });
  }
  leaves.sort((p, q) => p.r - q.r);
  for (const L of leaves) {
    const outer = L.r / R;
    const len = (20 + rnd() * 16) * pal.size;
    const wid = len * (0.36 + rnd() * 0.12);
    const shade = Math.min(1, 0.15 + outer * 0.55 + rnd() * 0.35 - (L.y - cy) / h * 0.3);
    const c = shade < 0.5 ? lerpC(pal.dark, pal.base, shade * 2) : lerpC(pal.base, pal.light, (shade - 0.5) * 2);
    g.save();
    g.translate(L.x, L.y);
    g.rotate(L.a + Math.PI / 2 + (rnd() - 0.5) * 1.6 + Math.PI);
    leafPath(g, len, wid);
    const grad = g.createLinearGradient(-wid, 0, wid, len);
    grad.addColorStop(0, rgb(lerpC(c, pal.dark, 0.25)));
    grad.addColorStop(1, rgb(lerpC(c, pal.light, 0.15)));
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = rgb(lerpC(c, [230, 230, 170], 0.2), 0.55);
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(0, 1);
    g.lineTo(0, len * 0.85);
    g.stroke();
    g.restore();
  }
  // a few twigs peeking through
  g.strokeStyle = 'rgba(70,52,36,0.9)';
  g.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy + R * 0.6);
    g.lineTo(cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.4);
    g.stroke();
  }
  g.restore();
}

function drawTropicLeaf(g, cell, rnd) {
  const [w, h] = clip(g, cell);
  g.translate(w / 2, h - 6);
  const len = h - 14;
  const wid = w * 0.42;
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(wid * 1.2, -len * 0.25, wid * 0.9, -len * 0.85, 0, -len);
  g.bezierCurveTo(-wid * 0.9, -len * 0.85, -wid * 1.2, -len * 0.25, 0, 0);
  const grad = g.createLinearGradient(-wid, 0, wid, -len);
  grad.addColorStop(0, 'rgb(24,58,30)');
  grad.addColorStop(0.5, 'rgb(46,96,40)');
  grad.addColorStop(1, 'rgb(84,132,52)');
  g.fillStyle = grad;
  g.fill();
  // tears (banana-leaf splits) — cut with destination-out
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) {
    const t = 0.18 + i * 0.1 + rnd() * 0.04;
    const side = rnd() < 0.5 ? -1 : 1;
    g.beginPath();
    g.moveTo(side * wid * 1.3, -len * (t + 0.06));
    g.lineTo(side * wid * 0.12, -len * t);
    g.lineTo(side * wid * 1.3, -len * (t + 0.01));
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  // midrib + veins
  g.strokeStyle = 'rgba(170,190,110,0.8)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, -len * 0.97);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(140,170,90,0.5)';
  for (let i = 1; i < 14; i++) {
    const y = -len * (i / 15);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, y);
      g.quadraticCurveTo(s * wid * 0.4, y - 10, s * wid * 0.85, y - 22);
      g.stroke();
    }
  }
  g.restore();
}

function drawPalmFrond(g, cell, rnd) {
  const [w, h] = clip(g, cell);
  const y0 = h * 0.5;
  g.strokeStyle = 'rgb(92,90,48)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(2, y0);
  g.quadraticCurveTo(w * 0.5, y0 - 4, w - 4, y0 + 6);
  g.stroke();
  for (let i = 0; i < 46; i++) {
    const t = 0.06 + (i / 46) * 0.92;
    const x = 2 + t * (w - 6);
    const y = y0 - 4 * Math.sin(t * Math.PI) + t * t * 6;
    for (const s of [-1, 1]) {
      const len = h * 0.46 * (1 - Math.pow(t - 0.35, 2) * 1.1) * (0.8 + rnd() * 0.25);
      const ang = s * (1.0 + rnd() * 0.25) - 0.6 * s * t;
      const ex = x + Math.cos(ang) * len * 0.7 + len * 0.35;
      const ey = y + Math.sin(ang) * len;
      const shade = 0.4 + rnd() * 0.5 + t * 0.2;
      g.strokeStyle = rgb(lerpC([34, 72, 30], [110, 150, 60], Math.min(1, shade)));
      g.lineWidth = 3.2 * (1 - t * 0.4);
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo((x + ex) / 2 + 4, (y + ey) / 2, ex, ey);
      g.stroke();
    }
  }
  g.restore();
}

function drawFern(g, cell, rnd) {
  const [w, h] = clip(g, cell);
  const y0 = h * 0.5;
  g.strokeStyle = 'rgb(70,96,40)';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(2, y0);
  g.lineTo(w - 4, y0 + 3);
  g.stroke();
  for (let i = 0; i < 26; i++) {
    const t = 0.05 + (i / 26) * 0.93;
    const x = 2 + t * (w - 6);
    const y = y0 + t * 3;
    for (const s of [-1, 1]) {
      const len = h * 0.42 * (1 - t * 0.75) * (0.85 + rnd() * 0.2);
      // pinna: a row of tiny lobes
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const u = k / steps;
        const px = x + u * len * 0.35;
        const py = y + s * u * len;
        const r = (1 - u * 0.6) * 4.2;
        g.fillStyle = rgb(lerpC([38, 80, 30], [104, 150, 58], 0.3 + u * 0.4 + rnd() * 0.3));
        g.beginPath();
        g.ellipse(px, py, r * 1.3, r, s * 0.6, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.restore();
}

function drawGlowLeaf(g, e, cell, rnd) {
  const draw = (ctx, emissive) => {
    const [w, h] = clip(ctx, cell);
    ctx.translate(w / 2, h - 6);
    const len = h - 14;
    const wid = w * 0.36;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(wid * 1.25, -len * 0.3, wid * 0.8, -len * 0.82, 0, -len);
    ctx.bezierCurveTo(-wid * 0.8, -len * 0.82, -wid * 1.25, -len * 0.3, 0, 0);
    if (!emissive) {
      const grad = ctx.createLinearGradient(0, 0, 0, -len);
      grad.addColorStop(0, 'rgb(38,20,62)');
      grad.addColorStop(0.6, 'rgb(74,38,118)');
      grad.addColorStop(1, 'rgb(112,64,170)');
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(40,10,70,1)';
      ctx.fill();
    }
    // glowing veins (turquoise core, violet edge)
    const vein = (lw, col) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -len * 0.95);
      ctx.stroke();
      for (let i = 1; i < 11; i++) {
        const y = -len * (i / 12);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.quadraticCurveTo(s * wid * 0.45, y - 12, s * wid * 0.8 * Math.sin((i / 12) * Math.PI + 0.4), y - 26);
          ctx.stroke();
        }
      }
    };
    vein(5, emissive ? 'rgba(150,80,255,0.9)' : 'rgba(150,100,230,0.7)');
    vein(1.8, emissive ? 'rgba(110,250,255,1)' : 'rgba(170,240,255,0.9)');
    // speckles
    for (let i = 0; i < 40; i++) {
      const t = rnd();
      const x = (rnd() - 0.5) * wid * 1.2 * Math.sin(t * Math.PI);
      ctx.fillStyle = emissive ? 'rgba(140,230,255,0.9)' : 'rgba(190,220,255,0.6)';
      ctx.beginPath();
      ctx.arc(x, -len * t, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };
  draw(g, false);
  draw(e, true);
}

function drawBark(g, cell, rnd, base, dark, light, mossy = false) {
  const [w, h] = clip(g, cell);
  g.fillStyle = rgb(base);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 120; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const len = 20 + rnd() * 90;
    g.strokeStyle = rgb(rnd() < 0.6 ? dark : light, 0.35 + rnd() * 0.4);
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + (rnd() - 0.5) * 8, y + len * 0.3, x + (rnd() - 0.5) * 8, y + len * 0.7, x + (rnd() - 0.5) * 6, y + len);
    g.stroke();
    // wrap vertically so the strip tiles
    if (y + len > h) {
      g.beginPath();
      g.moveTo(x, y - h);
      g.lineTo(x, y - h + len);
      g.stroke();
    }
  }
  if (mossy) {
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${70 + rnd() * 30},${100 + rnd() * 30},${50},${0.25 + rnd() * 0.3})`;
      g.beginPath();
      g.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 14, 10 + rnd() * 30, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

function drawFlowers(g, e, cell, rnd) {
  const [x0, y0] = cell;
  const kinds = [
    { petals: 12, col: [245, 242, 232], centre: [240, 190, 60], glow: null, r: 24 },
    { petals: 5, col: [250, 210, 60], centre: [200, 140, 30], glow: null, r: 20 },
    { petals: 6, col: [150, 90, 235], centre: [235, 200, 255], glow: [170, 100, 255], r: 22 },
    { petals: 5, col: [235, 90, 50], centre: [60, 30, 30], glow: null, r: 23 },
  ];
  kinds.forEach((k, i) => {
    const cx = x0 + i * 64 + 32;
    const cy = y0 + 32;
    for (const ctx of [g, e]) {
      if (ctx === e && !k.glow) continue;
      for (let p = 0; p < k.petals; p++) {
        const a = (p / k.petals) * Math.PI * 2 + rnd() * 0.2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(k.r * 0.5, 0, k.r * 0.52, k.r * (k.petals > 8 ? 0.13 : 0.3), 0, 0, Math.PI * 2);
        const c = ctx === e ? k.glow : lerpC(k.col, [255, 255, 255], rnd() * 0.15);
        ctx.fillStyle = rgb(c, ctx === e ? 0.85 : 1);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = rgb(ctx === e ? [255, 220, 255] : k.centre);
      ctx.beginPath();
      ctx.arc(cx, cy, k.r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawGrassTuft(g, cell, rnd) {
  const [w, h] = clip(g, cell);
  for (let i = 0; i < 70; i++) {
    const x = w * 0.5 + (rnd() - 0.5) * w * 0.8;
    const len = h * (0.5 + rnd() * 0.48);
    const bend = (rnd() - 0.5) * 30;
    g.strokeStyle = rgb(lerpC([92, 88, 40], [196, 176, 96], rnd()));
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, h);
    g.quadraticCurveTo(x + bend * 0.3, h - len * 0.6, x + bend, h - len);
    g.stroke();
  }
  g.restore();
}

function drawVine(g, cell, rnd) {
  const [w, h] = clip(g, cell);
  for (let s = 0; s < 3; s++) {
    let x = w * (0.3 + s * 0.2);
    g.strokeStyle = 'rgb(58,72,34)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y < h; y += 8) {
      x += (rnd() - 0.5) * 3;
      g.lineTo(x, y);
      if (rnd() < 0.45) {
        g.save();
        g.fillStyle = rgb(lerpC([40, 82, 34], [96, 140, 56], rnd()));
        g.translate(x, y);
        g.rotate((rnd() - 0.5) * 2.4);
        g.beginPath();
        g.ellipse(5, 0, 6, 2.8, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    g.stroke();
  }
  g.restore();
}

function drawBulbs(g, e, cell, rnd) {
  for (const ctx of [g, e]) {
    const [w, h] = clip(ctx, cell);
    for (let i = 0; i < 7; i++) {
      const x = 14 + rnd() * (w - 28);
      const top = 16 + rnd() * h * 0.45;
      if (ctx === g) {
        ctx.strokeStyle = 'rgb(46,60,70)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x + (rnd() - 0.5) * 10, h);
        ctx.quadraticCurveTo(x + (rnd() - 0.5) * 16, (h + top) / 2, x, top);
        ctx.stroke();
      }
      const grad = ctx.createRadialGradient(x, top, 0, x, top, 9);
      grad.addColorStop(0, ctx === e ? 'rgba(200,250,255,1)' : 'rgba(210,250,255,1)');
      grad.addColorStop(0.5, ctx === e ? 'rgba(60,200,255,1)' : 'rgba(80,190,240,1)');
      grad.addColorStop(1, 'rgba(40,120,220,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, top, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawNeedleMass(g, cell, rnd) {
  const [w, h] = clip(g, cell);
  g.fillStyle = 'rgb(26,44,26)';
  g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  for (let i = 0; i < 900; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const a = rnd() * Math.PI * 2;
    const l = 4 + rnd() * 8;
    g.strokeStyle = rgb(lerpC([20, 38, 22], [84, 116, 54], rnd() * rnd()));
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.restore();
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
