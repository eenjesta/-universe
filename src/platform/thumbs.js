/**
 * Procedural artwork for the Home (2D canvas, painted once and cached as
 * data URLs): experience placeholders (an isometric baseplate with blocks under
 * the experience's sky, deterministic per id) and the flagship hero painting
 * (the poster's golden-hour lake, spire city, giant pale planet) used until —
 * or instead of — the live world thumbnail.
 */
import { hashString, mulberry32 } from '../core/math.js';

const cache = new Map();
const SKIES = {
  golden: ['#121a36', '#3b2f5e', '#a65a6e', '#f1a25c'],
  day: ['#2c5d9c', '#4f86c2', '#8fb9df', '#cfe3ef'],
  night: ['#03050b', '#0a0f24', '#1c1842', '#3a2a5e'],
  space: ['#010205', '#05071a', '#120d2e', '#2a1a48'],
};
const BLOCK_COLORS = ['#ece6dc', '#7fe0ff', '#b48cff', '#f0b46a', '#ff7a6e', '#8fe3a8', '#5d6066', '#3fb8e8', '#d8cdb8', '#7a5238'];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

function stars(g, w, h, rnd, n, maxY = 1) {
  for (let i = 0; i < n; i++) {
    const a = 0.25 + rnd() * 0.75;
    g.fillStyle = `rgba(255,255,255,${(a * 0.8).toFixed(2)})`;
    const s = rnd() < 0.08 ? 1.6 : 1;
    g.fillRect(rnd() * w, rnd() * h * maxY, s, s);
  }
}

/** Experience placeholder (isometric blocks), cached per id + sky + size. */
export function experienceArt(exp, w = 320, h = 180) {
  const sky = SKIES[exp?.sky] ? exp.sky : null;
  const key = `x|${exp?.id}|${sky}|${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  const seed = hashString(String(exp?.id ?? exp?.title ?? 'x'));
  const rnd = mulberry32(seed);
  const skyId = sky || ['golden', 'day', 'night', 'space'][seed % 4];
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const s = SKIES[skyId];
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, s[0]);
  grd.addColorStop(0.45, s[1]);
  grd.addColorStop(0.75, s[2]);
  grd.addColorStop(1, s[3]);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  if (skyId === 'night' || skyId === 'space') stars(g, w, h, rnd, 70, 0.7);
  if (skyId === 'golden') {
    const sun = g.createRadialGradient(w * 0.78, h * 0.55, 0, w * 0.78, h * 0.55, w * 0.35);
    sun.addColorStop(0, 'rgba(255,214,150,0.85)');
    sun.addColorStop(0.2, 'rgba(255,170,90,0.35)');
    sun.addColorStop(1, 'rgba(255,140,80,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);
  }
  if (skyId === 'space' || rnd() < 0.5) {
    // pale planet
    const px = w * (0.15 + rnd() * 0.25);
    const py = h * (0.12 + rnd() * 0.12);
    const pr = h * (0.14 + rnd() * 0.12);
    const pg = g.createRadialGradient(px - pr * 0.35, py - pr * 0.35, pr * 0.1, px, py, pr);
    pg.addColorStop(0, 'rgba(232,228,240,0.95)');
    pg.addColorStop(1, 'rgba(140,140,170,0.9)');
    g.fillStyle = pg;
    g.beginPath();
    g.arc(px, py, pr, 0, Math.PI * 2);
    g.fill();
  }

  // isometric baseplate
  const cx = w * 0.5;
  const N = 5; // the plate is 2N × 2N cells
  const tw = w * 0.038; // horizontal step per cell
  const kz = tw * 0.36; // vertical step per cell (flattened isometric)
  const ky = tw * 0.7; // one unit of block height
  const top = h * 0.44;
  const iso = (x, z, y = 0) => [cx + (x - z) * tw, top + (x + z) * kz - y * ky];
  const poly = (pts, fill) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  const plate = skyId === 'night' || skyId === 'space' ? '#20242c' : '#3a3f47';
  poly([iso(0, 0), iso(N * 2, 0), iso(N * 2, N * 2), iso(0, N * 2)], plate);
  // plate side
  poly([iso(0, N * 2), iso(N * 2, N * 2), iso(N * 2, N * 2, -0.6), iso(0, N * 2, -0.6)], shade(plate, 0.62));
  poly([iso(N * 2, 0), iso(N * 2, N * 2), iso(N * 2, N * 2, -0.6), iso(N * 2, 0, -0.6)], shade(plate, 0.45));
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1;
  for (let i = 1; i < N * 2; i += 1) {
    const a = iso(i, 0);
    const b = iso(i, N * 2);
    const c2 = iso(0, i);
    const d = iso(N * 2, i);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.moveTo(c2[0], c2[1]);
    g.lineTo(d[0], d[1]);
    g.stroke();
  }

  // blocks (back to front)
  const palette = exp?.data?.parts?.length ? exp.data.parts.slice(0, 12).map((p) => (/^#[0-9a-f]{6}$/i.test(p.color) ? p.color : null)).filter(Boolean) : [];
  const count = 5 + Math.floor(rnd() * 5);
  const blocks = [];
  for (let i = 0; i < count; i++) {
    const sx = 1 + Math.floor(rnd() * 3);
    const sz = 1 + Math.floor(rnd() * 3);
    const sy = 0.6 + rnd() * (rnd() < 0.25 ? 5 : 2.2);
    const x = Math.floor(rnd() * (N * 2 - sx));
    const z = Math.floor(rnd() * (N * 2 - sz));
    const color = palette.length ? palette[i % palette.length] : BLOCK_COLORS[Math.floor(rnd() * BLOCK_COLORS.length)];
    blocks.push({ x, z, sx, sz, sy, color });
  }
  blocks.sort((a, b) => a.x + a.z - (b.x + b.z));
  for (const b of blocks) {
    const { x, z, sx, sz, sy, color } = b;
    poly([iso(x, z + sz, 0), iso(x + sx, z + sz, 0), iso(x + sx, z + sz, sy), iso(x, z + sz, sy)], shade(color, 0.72));
    poly([iso(x + sx, z, 0), iso(x + sx, z + sz, 0), iso(x + sx, z + sz, sy), iso(x + sx, z, sy)], shade(color, 0.52));
    poly([iso(x, z, sy), iso(x + sx, z, sy), iso(x + sx, z + sz, sy), iso(x, z + sz, sy)], shade(color, 1.0));
    if (color === '#7fe0ff' || color === '#b48cff') {
      g.shadowColor = color;
      g.shadowBlur = 14;
      poly([iso(x, z, sy), iso(x + sx, z, sy), iso(x + sx, z + sz, sy), iso(x, z + sz, sy)], shade(color, 1.08));
      g.shadowBlur = 0;
    }
  }
  // vignette
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  const url = c.toDataURL('image/jpeg', 0.86);
  cache.set(key, url);
  return url;
}

/** The flagship hero painting (poster scene), cached per size. */
export function heroArt(w = 1280, h = 600) {
  const key = `hero|${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = mulberry32(20261027);
  const hz = h * 0.6; // horizon
  // sky
  const sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, '#0a1230');
  sky.addColorStop(0.35, '#26285a');
  sky.addColorStop(0.62, '#6a3f6e');
  sky.addColorStop(0.84, '#d0705e');
  sky.addColorStop(1, '#f6b56a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, hz + 2);
  stars(g, w, h, rnd, 160, 0.32);
  // sun glow
  const sx = w * 0.8;
  const sy = hz - h * 0.035;
  let rg = g.createRadialGradient(sx, sy, 0, sx, sy, w * 0.42);
  rg.addColorStop(0, 'rgba(255,236,190,1)');
  rg.addColorStop(0.05, 'rgba(255,200,130,0.85)');
  rg.addColorStop(0.25, 'rgba(255,150,90,0.32)');
  rg.addColorStop(1, 'rgba(255,120,80,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, w, h);
  // giant pale planet (top, left of centre) with a thin ring
  const px = w * 0.36;
  const py = h * 0.02;
  const pr = h * 0.42;
  g.save();
  g.beginPath();
  g.arc(px, py, pr, 0, Math.PI * 2);
  g.clip();
  const pg = g.createRadialGradient(px - pr * 0.4, py + pr * 0.3, pr * 0.1, px, py, pr);
  pg.addColorStop(0, '#e9e4ee');
  pg.addColorStop(0.6, '#b9b4cc');
  pg.addColorStop(1, '#6e6b8c');
  g.fillStyle = pg;
  g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * pr * 0.95;
    const r = pr * (0.015 + rnd() * rnd() * 0.09);
    g.fillStyle = `rgba(90,86,118,${(0.12 + rnd() * 0.18).toFixed(2)})`;
    g.beginPath();
    g.arc(px + Math.cos(a) * d, py + Math.sin(a) * d, r, 0, Math.PI * 2);
    g.fill();
  }
  // terminator (night side to the upper right)
  const term = g.createLinearGradient(px - pr * 0.2, py + pr * 0.6, px + pr, py - pr * 0.2);
  term.addColorStop(0, 'rgba(10,12,30,0)');
  term.addColorStop(0.55, 'rgba(10,12,30,0.35)');
  term.addColorStop(1, 'rgba(10,12,30,0.85)');
  g.fillStyle = term;
  g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  g.restore();
  g.strokeStyle = 'rgba(236,230,220,0.22)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.ellipse(px, py + pr * 0.12, pr * 1.55, pr * 0.16, -0.12, 0.05 * Math.PI, 0.95 * Math.PI);
  g.stroke();
  // two small moons
  for (const [mx, my, mr] of [
    [0.6, 0.12, 0.034],
    [0.655, 0.2, 0.014],
  ]) {
    const mg = g.createRadialGradient(w * mx - h * mr * 0.4, h * my - h * mr * 0.4, 1, w * mx, h * my, h * mr);
    mg.addColorStop(0, '#f0ecf4');
    mg.addColorStop(1, '#8c88a6');
    g.fillStyle = mg;
    g.beginPath();
    g.arc(w * mx, h * my, h * mr, 0, Math.PI * 2);
    g.fill();
  }
  // far mountains
  const ridge = (base, amp, color, seed, rough = 1) => {
    const r2 = mulberry32(seed);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    let y = base;
    for (let x = 0; x <= w + 8; x += 8) {
      y += (r2() - 0.5) * amp * 0.18 * rough;
      y = Math.min(base + amp * 0.3, Math.max(base - amp, y));
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  };
  ridge(hz - h * 0.03, h * 0.06, 'rgba(58,44,82,0.85)', 11);
  // spire city (right half), backlit
  const cityL = w * 0.5;
  const cityR = w * 0.99;
  for (let i = 0; i < 70; i++) {
    const x = cityL + rnd() * (cityR - cityL);
    const centre = 1 - Math.abs((x - w * 0.76) / (w * 0.26));
    const hh = h * (0.03 + Math.max(0, centre) * (0.06 + rnd() * rnd() * 0.32));
    const bw = w * (0.003 + rnd() * 0.007);
    g.fillStyle = `rgba(${28 + Math.round(rnd() * 16)},${24 + Math.round(rnd() * 10)},${48 + Math.round(rnd() * 20)},0.96)`;
    g.beginPath();
    g.moveTo(x - bw, hz);
    g.lineTo(x - bw * 0.6, hz - hh * 0.92);
    g.lineTo(x, hz - hh);
    g.lineTo(x + bw * 0.6, hz - hh * 0.92);
    g.lineTo(x + bw, hz);
    g.closePath();
    g.fill();
    // window lights
    for (let k = 0; k < 4; k++) {
      if (rnd() < 0.5) continue;
      g.fillStyle = rnd() < 0.7 ? 'rgba(255,196,120,0.85)' : 'rgba(127,224,255,0.8)';
      g.fillRect(x - 0.5, hz - rnd() * hh * 0.85, 1, 1.2);
    }
  }
  // lake
  const lake = g.createLinearGradient(0, hz, 0, h);
  lake.addColorStop(0, '#d98a62');
  lake.addColorStop(0.18, '#7a4a6a');
  lake.addColorStop(0.6, '#262a4c');
  lake.addColorStop(1, '#0d1226');
  g.fillStyle = lake;
  g.fillRect(0, hz, w, h - hz);
  // sun reflection + shimmer
  for (let i = 0; i < 90; i++) {
    const yy = hz + Math.pow(rnd(), 1.6) * (h - hz);
    const spread = (yy - hz) / (h - hz);
    const xx = sx + (rnd() - 0.5) * w * (0.04 + spread * 0.22);
    const len = w * (0.01 + rnd() * 0.05) * (1 - spread * 0.5);
    g.fillStyle = `rgba(255,${190 + Math.round(rnd() * 40)},${120 + Math.round(rnd() * 50)},${(0.25 + rnd() * 0.5) * (1 - spread * 0.7)})`;
    g.fillRect(xx - len / 2, yy, len, 1 + spread * 1.5);
  }
  // mist band on the horizon
  const mist = g.createLinearGradient(0, hz - h * 0.05, 0, hz + h * 0.06);
  mist.addColorStop(0, 'rgba(255,210,170,0)');
  mist.addColorStop(0.5, 'rgba(255,214,180,0.28)');
  mist.addColorStop(1, 'rgba(255,210,170,0)');
  g.fillStyle = mist;
  g.fillRect(0, hz - h * 0.05, w, h * 0.11);
  // wooded islands
  for (let i = 0; i < 7; i++) {
    const ix = rnd() * w * 0.7;
    const iy = hz + h * (0.04 + rnd() * 0.12);
    const iw = w * (0.03 + rnd() * 0.06);
    g.fillStyle = 'rgba(16,18,32,0.92)';
    g.beginPath();
    g.ellipse(ix, iy, iw, h * 0.008, 0, Math.PI, 0);
    g.fill();
    for (let k = 0; k < 6; k++) {
      const tx = ix - iw * 0.8 + rnd() * iw * 1.6;
      const th2 = h * (0.012 + rnd() * 0.02);
      g.beginPath();
      g.moveTo(tx - th2 * 0.3, iy);
      g.lineTo(tx, iy - th2);
      g.lineTo(tx + th2 * 0.3, iy);
      g.fill();
    }
  }
  // foreground ridge (left) with pines
  g.fillStyle = '#07080e';
  g.beginPath();
  g.moveTo(0, h);
  g.lineTo(0, h * 0.7);
  let yy = h * 0.7;
  for (let x = 0; x <= w * 0.42; x += 6) {
    yy += (rnd() - 0.42) * 5;
    yy = Math.min(h, Math.max(h * 0.66, yy + (x > w * 0.25 ? 3 : 0)));
    g.lineTo(x, yy);
  }
  g.lineTo(w * 0.42, h);
  g.closePath();
  g.fill();
  for (let i = 0; i < 18; i++) {
    const tx = rnd() * w * 0.3;
    const th3 = h * (0.05 + rnd() * 0.12);
    const base = h * 0.72 + rnd() * h * 0.05;
    g.beginPath();
    g.moveTo(tx - th3 * 0.18, base);
    g.lineTo(tx, base - th3);
    g.lineTo(tx + th3 * 0.18, base);
    g.fill();
  }
  // vignette
  const v = g.createRadialGradient(w * 0.55, h * 0.45, h * 0.3, w * 0.55, h * 0.5, w * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(3,4,8,0.5)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  const url = c.toDataURL('image/jpeg', 0.88);
  cache.set(key, url);
  return url;
}

/** Initials avatar colour (deterministic hue per name). */
export function nameHue(name) {
  return hashString(String(name || '?')) % 360;
}
