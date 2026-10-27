/**
 * Hair sculpt (characters module): every hair style is a signed-distance model
 * in head-local space (origin on the eye line at the ear plane, −Z front):
 * a thin base cap (the cranium inflated by the cap thickness, cut at the
 * style's hairline) plus clumped "locks" — chains of tapered round cones laid
 * along the hair flow (swept pompadour, messy crop, curls, long falls,
 * pulled-back ponytail/bun). Lock guide points are projected radially onto
 * the skull, so locks hug the head at a chosen height. Primitive tags carry
 * the lock id and arc length so the mesher can colour root → tip and lay the
 * strand detail normals along each lock.
 */
import { SdfModel } from './sdf-model.js';
import { sdEll, smin, sstep, lerp, DEG, tableLerp, HAIRLINE } from './sculpt.js';
import { Rng } from '../core/math.js';

/** Polar angle of the hairline for a style (degrees from the crown) at |azimuth| adeg. */
export function styleHairline(style, adeg) {
  let t = tableLerp(HAIRLINE, adeg);
  if (style === 'buzz') t += 2.5;
  else if (style === 'curly') t += 3 - 6 * sstep(70, 110, adeg);
  else if (style === 'long') t += 1 - 3 * sstep(90, 140, adeg);
  else if (style === 'ponytail' || style === 'bun') t += 1.5;
  else if (style === 'swept') t -= 1.5;
  return t;
}

/** Skull (hair-bearing part of the head SDF: cranium + frontal bone), head-local. */
export function skullSDF(p) {
  const fw = p.faceW;
  const fem = p.fem;
  return (x, y, z) => {
    const d = sdEll(x, y, z, 0, 0.03, 0.014, 0.0772 * fw, 0.0905, 0.0985);
    return smin(d, sdEll(x, y, z, 0, 0.037 + 0.004 * fem, -0.029 - 0.0035 * fem, 0.0665 * fw, 0.056 + 0.004 * fem, 0.0615), 0.03);
  };
}

const HC = [0, 0.035, 0.012]; // projection centre inside the skull

const g2 = (x, s) => Math.exp(-(x / s) * (x / s));
/** Hair volume thickness (m) per style as a function of θ (from the crown) and φ (0 = front), degrees. */
const THICK = {
  buzz: () => 0.0026,
  swept: (th, ph, fem) => {
    const top = sstep(78, 28, th);
    const front = g2(ph, 50) * sstep(60, 40, th) * sstep(10, 30, th);
    const side = sstep(55, 95, Math.abs(ph)) * sstep(50, 80, th);
    return (0.0058 + 0.0062 * top + 0.0072 * front - 0.0022 * side) * (fem ? 0.85 : 1);
  },
  short: (th, ph) => 0.0062 + 0.0062 * sstep(75, 25, th) + 0.003 * g2(ph, 45) * sstep(55, 35, th),
  curly: (th) => 0.0105 + 0.004 * sstep(80, 30, th),
  long: (th) => 0.0058 + 0.0035 * sstep(80, 30, th),
  ponytail: () => 0.0042,
  bun: () => 0.0042,
};

/** Point on the skull in the direction of g (from HC), pushed out by off. */
function onSkull(skull, g, off) {
  let dx = g[0] - HC[0];
  let dy = g[1] - HC[1];
  let dz = g[2] - HC[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  let lo = 0.02;
  let hi = 0.2;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    if (skull(HC[0] + dx * m, HC[1] + dy * m, HC[2] + dz * m) < 0) lo = m;
    else hi = m;
  }
  const r = (lo + hi) / 2 + off;
  return [HC[0] + dx * r, HC[1] + dy * r, HC[2] + dz * r];
}

/**
 * Builds the hair model for a style. p = face params (faceParams()), seed =
 * per-face variation. Returns { model, min, max, locks } or null (bald).
 */
export function sculptHair(style, p, seed = 1) {
  if (style === 'none') return null;
  const skull = skullSDF(p);
  const rng = new Rng(Math.floor(seed * 1000) + 17);
  const fem = p.fem;
  const m = new SdfModel();
  const head = m.part('head');
  let lockId = 0;
  const locks = [];

  // ------------------------------------------------- volume (cap)
  // skull minus a smooth, style-dependent thickness field → the hair silhouette
  const vol = THICK[style] || THICK.swept;
  const thick = (dx, dy, dz) => {
    const th = Math.acos(Math.max(-1, Math.min(1, dy))) / DEG; // from the crown
    const ph = Math.atan2(dx, -dz) / DEG; // 0 = front
    return vol(th, ph, fem);
  };
  m.group('cap');
  const capFn = (x, y, z) => {
    const dx = x - HC[0];
    const dy = y - HC[1];
    const dz = z - HC[2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    return skull(x, y, z) - thick(dx / l, dy / l, dz / l);
  };
  m.func(capFn, { mat: 'cap', part: head }, { c: [0, 0.035, 0.012], r: 0.16 });
  // hairline cut: positive below the style's hairline (angle measured from the head-local origin)
  const cut = (x, y, z) => {
    const r = Math.sqrt(x * x + y * y + z * z) || 1e-6;
    const c = y / r;
    const th = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c) / DEG;
    const ad = Math.abs(Math.atan2(x, -z)) / DEG;
    return (th - styleHairline(style, ad)) * DEG * r;
  };
  m.func(cut, { op: 'int', k: 0.003, part: head });
  /** Cap thickness toward guide point g (for placing locks on the volume). */
  const capAt = (g) => {
    const dx = g[0] - HC[0];
    const dy = g[1] - HC[1];
    const dz = g[2] - HC[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return thick(dx / l, dy / l, dz / l);
  };

  // ----------------------------------------------------------- locks
  const kLock = style === 'curly' ? 0.004 : style === 'long' ? 0.012 : 0.0085;
  m.group('locks', { k: style === 'curly' ? 0.004 : 0.008 });
  /**
   * One lock: guide points [x,y,z] projected onto the hair volume at `lift`
   * (metres above the volume surface; null keeps the point as given), radii per point.
   */
  const lock = (guides, radii, lift, k = kLock) => {
    const pts = guides.map((g, i) => (lift[i] == null ? g : onSkull(skull, g, capAt(g) + lift[i])));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    let s0 = 0;
    const id = lockId++;
    const shade = 0.88 + rng.random() * 0.24;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      m.cone(a, b, radii[i], radii[i + 1], { k, mat: 'lock', part: head, tag: { lock: id, s0, len, shade } });
      s0 += seg;
    }
    locks.push({ id, pts, len });
  };
  const J = (v, a) => v + rng.range(-a, a);

  if (style === 'swept') {
    // swept back from a soft side part on the left; locks ride on the volume
    const n = 11;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x0 = J(lerp(-0.058, 0.056, t), 0.003);
      const sw = x0 < -0.024 ? -1 : 1;
      lock(
        [[x0, 0.078, -0.078], [x0 + 0.003 * sw, 0.112, -0.06], [x0 * 1.08 + 0.006 * sw, 0.13, -0.012], [x0 * 1.2 + 0.008 * sw, 0.116, 0.052], [x0 * 1.3 + 0.01 * sw, 0.074, 0.1]],
        [0.0062, 0.0088, 0.0092, 0.0082, 0.0028],
        [-0.002, 0.0, 0.0, -0.001, -0.001],
      );
    }
    for (const sx of [-1, 1]) {
      for (let j = 0; j < 4; j++) {
        const y0 = J(0.074 - j * 0.015, 0.002);
        lock([[sx * 0.07, y0, -0.058], [sx * 0.084, y0 + 0.002, -0.006], [sx * 0.08, y0 - 0.006, 0.056], [sx * 0.056, y0 - 0.02, 0.1]], [0.0055, 0.0068, 0.0062, 0.0022], [-0.002, -0.001, -0.001, -0.001]);
      }
    }
    for (let i = 0; i < 9; i++) {
      const x = J(lerp(-0.062, 0.062, i / 8), 0.003);
      lock([[x * 0.55, 0.12, 0.045], [x, 0.088, 0.1], [x, 0.032, 0.116], [x * 0.86, -0.028, 0.104]], [0.0072, 0.0082, 0.0074, 0.0026], [-0.001, -0.001, -0.001, 0.0]);
    }
  } else if (style === 'short') {
    // messy crop: short tufts from around the crown, a light fringe
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng.range(-0.12, 0.12);
      const fx = Math.sin(a);
      const fz = -Math.cos(a);
      const front = Math.max(0, -fz);
      const len = 0.042 + 0.018 * front;
      const r0 = 0.016;
      lock([[fx * r0, 0.126, 0.02 + fz * r0], [fx * len * 0.6, 0.12, 0.02 + fz * len * 0.6], [fx * len * 1.05, 0.098 - 0.012 * front, 0.02 + fz * len * 1.05]], [0.006, 0.0078, 0.0025], [-0.002, 0.0, 0.002 + 0.003 * front]);
    }
    for (let i = 0; i < 7; i++) {
      const x = J(lerp(-0.048, 0.048, i / 6), 0.004);
      lock([[x * 0.8, 0.108, -0.052], [x, 0.086, -0.076], [x * 1.05 + 0.004, 0.074, -0.085]], [0.0058, 0.0055, 0.002], [-0.001, 0.0, 0.002]);
    }
  } else if (style === 'curly') {
    for (let i = 0; i < 140; i++) {
      const ph = rng.range(-Math.PI, Math.PI);
      const ad = Math.abs(ph) / DEG;
      const th = Math.sqrt(rng.random()) * (styleHairline(style, ad) - 4) * DEG;
      const g = [Math.sin(th) * Math.sin(ph) * 0.1, 0.035 + Math.cos(th) * 0.1, -Math.sin(th) * Math.cos(ph) * 0.1];
      const c = onSkull(skull, g, capAt(g) - 0.002);
      const r = rng.range(0.0072, 0.0105) * (fem ? 0.95 : 1);
      m.ell(c, [r, r * rng.range(0.8, 1), r], { k: 0.0035, mat: 'lock', part: head, tag: { lock: lockId++, s0: 0, len: r, shade: 0.86 + rng.random() * 0.28, curl: 1 } });
    }
  } else if (style === 'long') {
    // centre part; wide locks sweep over the sides and fall to the shoulders; back curtain
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const t = i / 8; // 0 = front … 1 = back along the part
        const py = lerp(0.1, 0.124, Math.min(1, t * 1.6));
        const pz = lerp(-0.068, 0.05, t);
        const z1 = lerp(-0.04, 0.09, t);
        const out = 0.092 + 0.008 * Math.sin(t * Math.PI);
        lock(
          [[sx * 0.004, py, pz], [sx * 0.058, lerp(0.092, 0.105, t), lerp(-0.052, 0.062, t)], [sx * 0.087, 0.03, z1], [sx * out, -0.06, z1 + 0.006], [sx * (out + 0.008), -0.14, z1 + 0.01], [sx * (out + 0.006), -0.205, z1 + 0.004]],
          [0.0062, 0.0098, 0.0135, 0.0148, 0.0132, 0.004],
          [-0.002, -0.002, -0.003, null, null, null],
        );
      }
    }
    for (let i = 0; i < 8; i++) {
      const x = lerp(-0.068, 0.068, i / 7);
      lock([[x * 0.5, 0.12, 0.05], [x, 0.07, 0.106], [x * 1.05, 0.0, 0.122], [x * 1.1, -0.1, 0.128], [x * 1.12, -0.2, 0.118], [x, -0.245, 0.104]], [0.0098, 0.0128, 0.015, 0.015, 0.0128, 0.004], [-0.003, -0.003, -0.003, null, null, null]);
    }
  } else if (style === 'ponytail' || style === 'bun') {
    // sleek, pulled back toward the tie (ponytail) or the bun: shallow converging grooves
    const tie = style === 'ponytail' ? [0, 0.034, 0.117] : [0, 0.075, 0.096];
    for (let i = 0; i < 13; i++) {
      const ph = lerp(-2.65, 2.65, i / 12);
      const ad = Math.abs(ph) / DEG;
      const th = (styleHairline(style, ad) - 3) * DEG;
      const g = [Math.sin(th) * Math.sin(ph) * 0.1, Math.cos(th) * 0.1, -Math.sin(th) * Math.cos(ph) * 0.1];
      const mid = [(g[0] + tie[0]) * 0.5, (g[1] + tie[1]) * 0.5 + 0.03, (g[2] + tie[2]) * 0.5];
      lock([g, mid, tie], [0.0042, 0.005, 0.004], [-0.002, -0.0015, -0.001], 0.007);
    }
  }
  m.finalize();
  const lowY = style === 'long' ? -0.27 : -0.075;
  return { model: m, min: [-0.135, lowY, -0.135], max: [0.135, 0.17, 0.15], locks };
}
