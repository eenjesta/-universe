/**
 * Procedural item thumbnails for the marketplace (2D canvas "product renders"):
 * dark holographic studio backdrop + floor glow, the item drawn with gradient
 * shading, rim light and specular highlights. Cached per item id.
 */
const TW = 320;
const TH = 210;
const cache = new Map();

export function thumbnail(item) {
  if (cache.has(item.id)) return cache.get(item.id);
  const c = document.createElement('canvas');
  c.width = TW;
  c.height = TH;
  const g = c.getContext('2d');
  backdrop(g, item);
  try {
    (DRAW[item.thumb] || DRAW.crate)(g, item);
  } catch (err) {
    console.warn('[market] thumbnail failed', item.id, err);
  }
  overlay(g);
  const url = c.toDataURL('image/png');
  cache.set(item.id, url);
  return url;
}

// ------------------------------------------------------------------ studio
function backdrop(g, item) {
  const glow = item.glow || '#7fe0ff';
  let gr = g.createLinearGradient(0, 0, 0, TH);
  gr.addColorStop(0, '#132231');
  gr.addColorStop(0.62, '#0b141e');
  gr.addColorStop(1, '#070b11');
  g.fillStyle = gr;
  g.fillRect(0, 0, TW, TH);
  gr = g.createRadialGradient(TW * 0.5, TH * 0.42, 10, TW * 0.5, TH * 0.42, TW * 0.6);
  gr.addColorStop(0, hexA(glow, 0.2));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, TW, TH);
  // perspective floor grid
  g.save();
  g.strokeStyle = hexA(glow, 0.1);
  g.lineWidth = 1;
  const hy = TH * 0.66;
  for (let i = -8; i <= 8; i++) {
    g.beginPath();
    g.moveTo(TW / 2 + i * 14, hy);
    g.lineTo(TW / 2 + i * 70, TH);
    g.stroke();
  }
  for (let k = 0; k < 6; k++) {
    const y = hy + Math.pow(k / 6, 1.6) * (TH - hy);
    g.globalAlpha = 0.5 + k * 0.08;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(TW, y);
    g.stroke();
  }
  g.restore();
  // floor glow under the item
  gr = g.createRadialGradient(TW / 2, TH * 0.8, 4, TW / 2, TH * 0.8, TW * 0.42);
  gr.addColorStop(0, hexA(glow, 0.32));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.save();
  g.translate(0, TH * 0.8);
  g.scale(1, 0.24);
  g.translate(0, -TH * 0.8);
  g.beginPath();
  g.arc(TW / 2, TH * 0.8, TW * 0.42, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function overlay(g) {
  g.fillStyle = 'rgba(255,255,255,0.018)';
  for (let y = 0; y < TH; y += 3) g.fillRect(0, y, TW, 1);
  const gr = g.createRadialGradient(TW / 2, TH / 2, TH * 0.3, TW / 2, TH / 2, TW * 0.7);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = gr;
  g.fillRect(0, 0, TW, TH);
}

function hexA(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function shadow(g, cx, cy, rx, ry, a = 0.55) {
  const gr = g.createRadialGradient(cx, cy, 1, cx, cy, rx);
  gr.addColorStop(0, `rgba(0,0,0,${a})`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.translate(cx, cy);
  g.scale(1, ry / rx);
  g.translate(-cx, -cy);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(cx, cy, rx, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function glowLine(g, pts, color, width = 2, blur = 10) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.restore();
}

// ------------------------------------------------------------------ drawings
const DRAW = {
  car(g, item) {
    const [c1, c2, c3] = item.palette;
    shadow(g, 160, 162, 140, 14, 0.7);
    // body silhouette (side view, nose to the right)
    const body = new Path2D();
    body.moveTo(30, 148);
    body.bezierCurveTo(24, 138, 26, 126, 38, 120);
    body.bezierCurveTo(62, 112, 86, 108, 108, 100);
    body.bezierCurveTo(128, 82, 158, 74, 186, 76);
    body.bezierCurveTo(206, 78, 222, 90, 238, 102);
    body.bezierCurveTo(262, 108, 284, 114, 294, 124);
    body.bezierCurveTo(300, 132, 298, 142, 290, 148);
    body.closePath();
    let gr = g.createLinearGradient(0, 74, 0, 150);
    gr.addColorStop(0, c1);
    gr.addColorStop(0.55, c2);
    gr.addColorStop(1, c3);
    g.fillStyle = gr;
    g.fill(body);
    // dark lower sill + wheel arches
    g.save();
    g.clip(body);
    g.fillStyle = 'rgba(8,10,14,0.75)';
    g.fillRect(0, 136, TW, 20);
    g.fillStyle = '#07090c';
    for (const x of [86, 238]) {
      g.beginPath();
      g.arc(x, 150, 27, Math.PI, 0);
      g.fill();
    }
    // specular sweep along the shoulder
    gr = g.createLinearGradient(0, 96, 0, 120);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(40, 100, 250, 18);
    g.restore();
    // glass canopy
    const glass = new Path2D();
    glass.moveTo(118, 100);
    glass.bezierCurveTo(136, 86, 160, 80, 184, 81);
    glass.bezierCurveTo(200, 82, 214, 90, 226, 100);
    glass.closePath();
    gr = g.createLinearGradient(120, 80, 226, 100);
    gr.addColorStop(0, '#0d1520');
    gr.addColorStop(0.6, '#1d3346');
    gr.addColorStop(1, '#0b1118');
    g.fillStyle = gr;
    g.fill(glass);
    glowLine(g, [[134, 92], [176, 84]], 'rgba(255,255,255,0.55)', 1.4, 4);
    // side light strip + head/tail lights
    glowLine(g, [[60, 122], [150, 118], [262, 120]], c1, 1.6, 12);
    glowLine(g, [[276, 120], [292, 126]], '#fff4e0', 3, 14);
    glowLine(g, [[30, 128], [36, 124]], '#ff4d3a', 3, 14);
    // wheels
    for (const x of [86, 238]) {
      g.fillStyle = '#0a0b0e';
      g.beginPath();
      g.arc(x, 150, 22, 0, Math.PI * 2);
      g.fill();
      gr = g.createRadialGradient(x - 4, 146, 2, x, 150, 16);
      gr.addColorStop(0, '#9aa3ad');
      gr.addColorStop(1, '#2b3037');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, 150, 14, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(10,12,16,0.9)';
      g.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.beginPath();
        g.moveTo(x + Math.cos(a) * 3, 150 + Math.sin(a) * 3);
        g.lineTo(x + Math.cos(a) * 13, 150 + Math.sin(a) * 13);
        g.stroke();
      }
      g.strokeStyle = hexA(c1, 0.8);
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, 150, 18.5, 0, Math.PI * 2);
      g.stroke();
    }
    // Ø emblem on the door
    emblem(g, 168, 126, 6, 'rgba(255,255,255,0.75)', 1.4);
  },

  ship(g, item) {
    const [c1, c2, c3] = item.palette;
    shadow(g, 160, 170, 120, 12, 0.6);
    g.save();
    g.translate(160, 112);
    g.rotate(-0.18);
    // wings
    const wing = new Path2D();
    wing.moveTo(-40, 6);
    wing.lineTo(-104, 40);
    wing.lineTo(-92, 48);
    wing.lineTo(20, 16);
    wing.closePath();
    wing.moveTo(-40, -6);
    wing.lineTo(-96, -44);
    wing.lineTo(-84, -50);
    wing.lineTo(20, -16);
    wing.closePath();
    let gr = g.createLinearGradient(-100, -50, 20, 50);
    gr.addColorStop(0, c3);
    gr.addColorStop(0.5, c2);
    gr.addColorStop(1, c3);
    g.fillStyle = gr;
    g.fill(wing);
    // fuselage (dagger)
    const hull = new Path2D();
    hull.moveTo(128, 0);
    hull.bezierCurveTo(80, -14, 10, -22, -70, -16);
    hull.lineTo(-88, -8);
    hull.lineTo(-88, 8);
    hull.lineTo(-70, 16);
    hull.bezierCurveTo(10, 22, 80, 14, 128, 0);
    hull.closePath();
    gr = g.createLinearGradient(0, -22, 0, 22);
    gr.addColorStop(0, c1);
    gr.addColorStop(0.45, c2);
    gr.addColorStop(1, c3);
    g.fillStyle = gr;
    g.fill(hull);
    // panel lines + specular
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    for (const x of [-40, 0, 40]) {
      g.beginPath();
      g.moveTo(x, -16);
      g.lineTo(x + 6, 16);
      g.stroke();
    }
    glowLine(g, [[-60, -9], [60, -8], [112, -2]], 'rgba(255,248,220,0.7)', 1.3, 6);
    // canopy
    g.fillStyle = '#101820';
    g.beginPath();
    g.ellipse(50, -3, 26, 7, -0.05, 0, Math.PI * 2);
    g.fill();
    glowLine(g, [[34, -6], [62, -7]], 'rgba(170,220,255,0.6)', 1.2, 4);
    // engines
    for (const y of [-9, 9]) {
      gr = g.createRadialGradient(-92, y, 1, -92, y, 22);
      gr.addColorStop(0, 'rgba(255,240,210,1)');
      gr.addColorStop(0.25, 'rgba(255,154,74,0.9)');
      gr.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(-92, y, 22, 0, Math.PI * 2);
      g.fill();
    }
    emblem(g, -20, 0, 6, 'rgba(255,255,255,0.7)', 1.3);
    g.restore();
  },

  outfit(g, item) {
    const [c1, c2] = item.palette;
    shadow(g, 160, 186, 70, 9, 0.6);
    const cx = 160;
    g.save();
    // garment silhouette
    const p = new Path2D();
    if (item.style === 'nomad') {
      p.moveTo(cx, 34);
      p.bezierCurveTo(cx + 26, 34, cx + 34, 52, cx + 32, 70);
      p.bezierCurveTo(cx + 64, 90, cx + 84, 140, cx + 92, 180);
      p.lineTo(cx - 92, 180);
      p.bezierCurveTo(cx - 84, 140, cx - 64, 90, cx - 32, 70);
      p.bezierCurveTo(cx - 34, 52, cx - 26, 34, cx, 34);
    } else if (item.style === 'drifter') {
      p.moveTo(cx - 22, 48);
      p.lineTo(cx - 58, 64);
      p.lineTo(cx - 78, 146);
      p.lineTo(cx - 62, 150);
      p.lineTo(cx - 52, 112);
      p.lineTo(cx - 54, 188);
      p.lineTo(cx + 54, 188);
      p.lineTo(cx + 52, 112);
      p.lineTo(cx + 62, 150);
      p.lineTo(cx + 78, 146);
      p.lineTo(cx + 58, 64);
      p.lineTo(cx + 22, 48);
      p.closePath();
    } else {
      p.moveTo(cx - 22, 46);
      p.lineTo(cx - 60, 62);
      p.lineTo(cx - 80, 140);
      p.lineTo(cx - 64, 146);
      p.lineTo(cx - 50, 104);
      p.lineTo(cx - 48, 168);
      p.lineTo(cx + 48, 168);
      p.lineTo(cx + 50, 104);
      p.lineTo(cx + 64, 146);
      p.lineTo(cx + 80, 140);
      p.lineTo(cx + 60, 62);
      p.lineTo(cx + 22, 46);
      p.closePath();
    }
    let gr = g.createLinearGradient(cx - 80, 0, cx + 80, 0);
    gr.addColorStop(0, shade(c1, 0.55));
    gr.addColorStop(0.55, c1);
    gr.addColorStop(1, shade(c1, 1.25));
    g.fillStyle = gr;
    g.fill(p);
    g.clip(p);
    // vertical folds + top light
    gr = g.createLinearGradient(0, 40, 0, 190);
    gr.addColorStop(0, 'rgba(255,255,255,0.12)');
    gr.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = gr;
    g.fillRect(0, 0, TW, TH);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    for (const x of [-30, 30]) {
      g.beginPath();
      g.moveTo(cx + x, 70);
      g.lineTo(cx + x * 1.15, 186);
      g.stroke();
    }
    g.restore();
    // details per style
    if (item.style === 'vanguard') {
      // armour plates + cyan seams
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(cx - 40, 70, 80, 34);
      glowLine(g, [[cx - 44, 106], [cx, 116], [cx + 44, 106]], c2, 1.6, 10);
      glowLine(g, [[cx - 58, 66], [cx - 46, 100]], c2, 1.4, 8);
      glowLine(g, [[cx + 58, 66], [cx + 46, 100]], c2, 1.4, 8);
      glowLine(g, [[cx, 50], [cx, 168]], c2, 1.2, 8);
    } else if (item.style === 'nomad') {
      // hood opening + wrap edge
      g.fillStyle = 'rgba(10,8,6,0.85)';
      g.beginPath();
      g.ellipse(cx, 58, 18, 22, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = shade(c2, 1.4);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx - 34, 74);
      g.bezierCurveTo(cx - 10, 120, cx + 30, 140, cx + 70, 150);
      g.stroke();
    } else {
      // collar + zipper
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, 50);
      g.lineTo(cx, item.style === 'drifter' ? 186 : 166);
      g.stroke();
      g.fillStyle = shade(c1, 0.7);
      g.beginPath();
      g.moveTo(cx - 24, 44);
      g.lineTo(cx - 8, 70);
      g.lineTo(cx, 52);
      g.lineTo(cx + 8, 70);
      g.lineTo(cx + 24, 44);
      g.closePath();
      g.fill();
      if (item.style === 'drifter') glowLine(g, [[cx - 54, 130], [cx + 54, 130]], hexA(c2, 0.5), 2, 3);
    }
    emblem(g, cx + 26, 86, 7, item.style === 'vanguard' ? c2 : 'rgba(236,230,220,0.85)', 1.6);
    // rim light right edge
    glowLine(g, [[cx + 60, 64], [cx + 80, 140]], 'rgba(255,190,120,0.55)', 1.5, 8);
  },

  statue(g) {
    shadow(g, 160, 182, 80, 10, 0.65);
    // plinth
    let gr = g.createLinearGradient(110, 0, 210, 0);
    gr.addColorStop(0, '#4b4a48');
    gr.addColorStop(0.6, '#77746f');
    gr.addColorStop(1, '#a29d94');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(112, 182);
    g.lineTo(208, 182);
    g.lineTo(198, 150);
    g.lineTo(122, 150);
    g.closePath();
    g.fill();
    g.fillStyle = '#8f8a81';
    g.fillRect(118, 144, 84, 8);
    // Ø ring (stone, carved)
    g.save();
    g.lineCap = 'round';
    gr = g.createLinearGradient(110, 40, 210, 140);
    gr.addColorStop(0, '#c9c2b5');
    gr.addColorStop(0.5, '#8d877d');
    gr.addColorStop(1, '#4e4b47');
    g.strokeStyle = gr;
    g.lineWidth = 15;
    g.beginPath();
    g.arc(160, 92, 42, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(112, 142);
    g.lineTo(208, 40);
    g.stroke();
    // inner glow line
    g.strokeStyle = 'rgba(127,224,255,0.75)';
    g.shadowColor = '#7fe0ff';
    g.shadowBlur = 12;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(160, 92, 42, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  },

  tree(g) {
    shadow(g, 160, 182, 70, 9, 0.6);
    g.fillStyle = '#3a2f3a';
    g.fillRect(140, 168, 40, 14);
    // trunk + branches
    g.save();
    g.strokeStyle = '#4d3a52';
    g.lineCap = 'round';
    const br = [
      [160, 170, 160, 120, 9],
      [160, 128, 128, 96, 5],
      [160, 124, 194, 92, 5],
      [160, 120, 162, 78, 4],
      [132, 100, 112, 84, 3],
      [190, 96, 214, 80, 3],
    ];
    for (const [x1, y1, x2, y2, w] of br) {
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x1, y1);
      g.quadraticCurveTo((x1 + x2) / 2 + 4, (y1 + y2) / 2, x2, y2);
      g.stroke();
    }
    g.restore();
    // glowing canopy blobs
    const blobs = [
      [160, 70, 34],
      [124, 82, 26],
      [198, 80, 28],
      [106, 94, 18],
      [216, 94, 18],
      [142, 58, 22],
      [180, 56, 22],
    ];
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [x, y, r] of blobs) {
      const gr = g.createRadialGradient(x, y, 2, x, y, r * 1.5);
      gr.addColorStop(0, 'rgba(240,200,255,0.75)');
      gr.addColorStop(0.35, 'rgba(180,120,255,0.55)');
      gr.addColorStop(1, 'rgba(110,50,200,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r * 1.5, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 26; i++) {
      const x = 100 + Math.random() * 120;
      const y = 40 + Math.random() * 80;
      g.fillStyle = `rgba(255,${200 + Math.random() * 55},255,${0.5 + Math.random() * 0.5})`;
      g.beginPath();
      g.arc(x, y, 0.8 + Math.random() * 1.6, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  },

  reactor(g) {
    shadow(g, 160, 182, 70, 10, 0.65);
    // housing
    let gr = g.createLinearGradient(110, 0, 210, 0);
    gr.addColorStop(0, '#2a3038');
    gr.addColorStop(0.55, '#5b6672');
    gr.addColorStop(1, '#8b97a3');
    g.fillStyle = gr;
    g.fillRect(118, 60, 84, 118);
    g.fillStyle = '#1d2229';
    g.beginPath();
    g.ellipse(160, 60, 42, 10, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(160, 178, 42, 10, 0, 0, Math.PI);
    g.fill();
    // bands
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (const y of [74, 160]) g.fillRect(118, y, 84, 6);
    // glowing core window
    g.save();
    gr = g.createLinearGradient(0, 88, 0, 150);
    gr.addColorStop(0, '#bff6ff');
    gr.addColorStop(0.5, '#4fd0ff');
    gr.addColorStop(1, '#1a7fb8');
    g.fillStyle = gr;
    g.shadowColor = '#7fe0ff';
    g.shadowBlur = 24;
    g.fillRect(136, 88, 48, 62);
    g.restore();
    g.strokeStyle = 'rgba(10,20,30,0.8)';
    g.lineWidth = 2;
    for (const y of [104, 120, 136]) {
      g.beginPath();
      g.moveTo(136, y);
      g.lineTo(184, y);
      g.stroke();
    }
    // energy arcs
    glowLine(g, [[160, 50], [154, 36], [164, 26], [158, 14]], '#9ff0ff', 1.4, 12);
    emblem(g, 160, 168, 5, 'rgba(255,255,255,0.6)', 1.2);
  },

  crate(g, item) {
    shadow(g, 160, 178, 76, 10, 0.65);
    const col = item.color || '#8b97a3';
    // isometric box
    const top = [[160, 64], [222, 92], [160, 120], [98, 92]];
    const left = [[98, 92], [160, 120], [160, 180], [98, 152]];
    const right = [[160, 120], [222, 92], [222, 152], [160, 180]];
    const poly = (pts, fill) => {
      g.fillStyle = fill;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    };
    poly(top, shade(col, 1.25));
    poly(left, shade(col, 0.62));
    poly(right, shade(col, 0.88));
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    for (const pts of [left, right]) {
      g.beginPath();
      g.moveTo((pts[0][0] + pts[3][0]) / 2, (pts[0][1] + pts[3][1]) / 2);
      g.lineTo((pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2);
      g.stroke();
    }
    glowLine(g, [[98, 92], [160, 120], [222, 92]], hexA(item.glow || '#7fe0ff', 0.9), 1.4, 10);
    // label
    g.save();
    g.fillStyle = 'rgba(236,230,220,0.92)';
    g.font = '500 22px Jost, sans-serif';
    g.textAlign = 'center';
    // skew onto the right face (slope −0.45): y' = y − 0.45·x
    g.setTransform(1, -0.45, 0, 1, 0, 0);
    g.fillText(item.label || '', 191, 144 + 0.45 * 191);
    g.restore();
  },

  cell(g, item) {
    shadow(g, 160, 182, 52, 9, 0.65);
    let gr = g.createLinearGradient(124, 0, 196, 0);
    gr.addColorStop(0, '#1f262e');
    gr.addColorStop(0.5, '#56636f');
    gr.addColorStop(1, '#222a33');
    g.fillStyle = gr;
    g.fillRect(126, 58, 68, 120);
    g.fillStyle = '#39424c';
    g.fillRect(146, 46, 28, 14);
    // energy level
    g.save();
    gr = g.createLinearGradient(0, 70, 0, 170);
    gr.addColorStop(0, '#d8fbff');
    gr.addColorStop(1, '#2bb6f0');
    g.fillStyle = gr;
    g.shadowColor = '#7fe0ff';
    g.shadowBlur = 20;
    for (let i = 0; i < 4; i++) g.fillRect(136, 148 - i * 22, 48, 16);
    g.restore();
    g.fillStyle = 'rgba(236,230,220,0.9)';
    g.font = '500 16px Jost, sans-serif';
    g.textAlign = 'center';
    g.fillText(item.label || '', 160, 196);
  },
};

function emblem(g, x, y, r, color, w) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.moveTo(x - r * 1.45 * 0.707, y + r * 1.45 * 0.707);
  g.lineTo(x + r * 1.45 * 0.707, y - r * 1.45 * 0.707);
  g.stroke();
  g.restore();
}

function shade(hex, k) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
