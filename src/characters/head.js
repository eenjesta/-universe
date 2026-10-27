/**
 * Procedural head (characters module).
 *
 * The face is a signed-distance "sculpt" of smooth ellipsoids, capsules and
 * cones laid out on adult anthropometric landmarks (cranium, frontal bone,
 * brow ridge, cheekbones, cheeks, maxilla, mandible, chin, nose, lips, eye
 * sockets), lightly stylised for appeal (slightly larger eyes, refined nose).
 * A face-weighted sphere grid is marched onto the surface (warm-started), then
 * painted with vertex colours (blush, lips, brows, nostrils, scalp tint,
 * stubble, age lines). Eyes get an iris pattern + catchlight, lids blink on
 * the `lids` bone, brows are tapered ribbons, ears are sculpted (helix rim,
 * concha, lobe). Hair, beards, eyewear and headwear live in hair.js.
 * Head-local space: origin on the eye line at the ear plane, −Z = front.
 */
import * as THREE from 'three';
import { gridGeometry, tubeGeometry, superEllipsoid, mat, cached } from './builder.js';
import { J } from './skeleton.js';
import {
  sdEll, sdCapsule, sdRoundCone, smin, smax, radialMarcher, marchIn, sdfNormal, warpTable, flipped,
  sstep, clamp01, lerp, DEG, EYE, hairlineAt, faceKey,
} from './sculpt.js';
import { addHair, addBeard, addEyewear, addHeadwear } from './hair.js';

export { EYE };

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (hex) => new THREE.Color(hex);
const _col = new THREE.Color();

// ------------------------------------------------------------- face presets
const BASE = {
  faceW: 1, jawW: 1, jawSq: 1, chin: 1, chinFwd: 1, cheek: 1, full: 1, brow: 1,
  noseLen: 1, noseW: 1, noseProj: 1, bridge: 1, lipU: 1, lipL: 1, mouthW: 1, faceLen: 1,
  eye: 1, tilt: 0, eyeSp: 1,
};
const PRESETS = [
  {}, // Klassiek
  { jawW: 1.03, jawSq: 1.35, chin: 1.04, chinFwd: 1.25, cheek: 1.3, full: 0.82, brow: 1.15, noseLen: 1.04, noseW: 0.94, noseProj: 1.1, bridge: 1.25, lipU: 0.9, lipL: 0.92, faceLen: 1.03, eye: 0.97, tilt: 0.02 }, // Hoekig
  { jawW: 1.02, jawSq: 0.55, chin: 0.92, chinFwd: 0.75, cheek: 0.85, full: 1.3, brow: 0.75, noseLen: 0.93, noseW: 1.04, noseProj: 0.9, bridge: 0.8, lipU: 1.1, lipL: 1.12, faceLen: 0.97, eye: 1.04 }, // Zacht
  { faceW: 1.03, jawW: 1.1, jawSq: 1.45, chin: 1.22, chinFwd: 1.1, cheek: 1.1, brow: 1.35, noseLen: 1.04, noseW: 1.12, noseProj: 1.04, bridge: 1.1, lipU: 0.95, faceLen: 1.03, eye: 0.95 }, // Krachtig
  { faceW: 0.95, jawW: 0.9, jawSq: 0.85, cheek: 1.05, full: 0.85, noseLen: 1.09, noseW: 0.9, noseProj: 1.1, bridge: 1.15, lipU: 0.92, lipL: 0.95, faceLen: 1.06, eye: 0.98, eyeSp: 0.98 }, // Smal
  { jawW: 0.93, jawSq: 0.7, chin: 0.88, chinFwd: 0.9, cheek: 1.08, full: 1.1, brow: 0.75, noseLen: 0.9, noseW: 0.88, noseProj: 0.94, bridge: 0.9, lipU: 1.12, lipL: 1.15, faceLen: 0.97, eye: 1.07, tilt: 0.03 }, // Fijn
];
const FEMALE = { faceW: 0.965, jawW: 0.9, jawSq: 0.5, chin: 0.88, chinFwd: 0.95, brow: 0.35, noseLen: 0.92, noseW: 0.86, noseProj: 0.92, bridge: 0.85, lipU: 1.12, lipL: 1.14, mouthW: 0.97, eye: 1.03, full: 1.06, faceLen: 0.98, cheek: 1.08 };

export function faceParams(app) {
  const p = { ...BASE, ...(PRESETS[app.face] || PRESETS[0]) };
  const f = app.body === 'f';
  if (f) for (const [k, v] of Object.entries(FEMALE)) p[k] *= v;
  // global stylisation for appeal: slightly shorter lower face, larger eyes, finer nose
  p.faceLen *= 0.955;
  p.eye *= 1.05;
  p.noseLen *= 0.95;
  p.noseW *= 0.95;
  const age = app.age || 0;
  p.age = age;
  p.lipU *= 1 - 0.3 * age;
  p.lipL *= 1 - 0.22 * age;
  p.noseLen *= 1 + 0.08 * age;
  p.noseW *= 1 + 0.08 * age;
  p.full *= 1 - 0.15 * age;
  p.fem = f ? 1 : 0;
  return p;
}

/**
 * Head SDF for face params p (metres, head-local). Landmarks (male, preset 0):
 * glabella z −0.096 · nasion (y 0.004, z −0.089) · cornea z −0.080 · nose tip
 * (y −0.039, z −0.113) · subnasale y −0.047 · stomion y −0.069 · chin
 * (y −0.104, z −0.094) · gonion (±0.046, −0.075) · head breadth 15.4 cm.
 */
export function headSDF(p) {
  const fw = p.faceW;
  const fl = p.faceLen;
  const eyeX = EYE.x * p.eyeSp;
  const es = p.eye;
  const tipZ = -0.1105 - 0.0065 * (p.noseProj - 1);
  const tipY = -0.0372 * p.noseLen;
  const nasZ = -0.0885 - 0.0032 * (p.bridge - 1);
  const chinY = -0.1015 * fl;
  const ly = -0.0682 * fl;
  const gx = (0.0488 - 0.0045 * p.fem) * p.jawW * fw;
  const gy = -0.0765 * fl;
  const nw = p.noseW;
  const full = p.full;
  const age = p.age;
  const fem = p.fem;
  const cheek = p.cheek;
  const chinZ = -0.0785 - 0.0045 * (p.chinFwd - 1);
  return function sdf(x, y, z) {
    const ax = x < 0 ? -x : x;
    // cranium + frontal bone
    let d = sdEll(x, y, z, 0, 0.03, 0.014, 0.0772 * fw, 0.0905, 0.0985);
    d = smin(d, sdEll(x, y, z, 0, 0.037 + 0.004 * fem, -0.029 - 0.0035 * fem, 0.0665 * fw, 0.056 + 0.004 * fem, 0.0615), 0.03);
    // brow ridge (softer on female faces)
    d = smin(d, sdEll(x, y, z, 0, 0.0175, -0.0772, 0.05 * fw, 0.0112, 0.0122 + 0.003 * p.brow * (1 - 0.5 * fem)), 0.016);
    // midface: one smooth mass from the cheekbones to the mouth (no separate cheek blobs)
    d = smin(d, sdEll(x, y, z, 0, -0.03, -0.049, 0.0545 * fw, 0.046, 0.047), 0.03);
    // cheekbones (zygomatic): a soft ridge out toward the ears
    d = smin(d, sdCapsule(ax, y, z, 0.036 * fw, -0.017, -0.064, 0.058 * fw, -0.012, -0.032, 0.0075 + 0.0015 * cheek), 0.026);
    // infraorbital fill under the eyes
    d = smin(d, sdEll(ax, y, z, 0.0245 * fw, -0.0215, -0.073, 0.017, 0.012, 0.012), 0.014);
    // soft-tissue cheeks: fuller on young / female faces, kept inside the jawline
    d = smin(d, sdEll(ax, y, z, 0.031 * fw, -0.047 - 0.005 * age, -0.064, 0.02 * full, 0.021, 0.02 * full), 0.02);
    // mandible: ramus under the ear → angle → chin, a crisp jawline
    d = smin(d, sdCapsule(ax, y, z, 0.0462 * fw, -0.026, 0.002, gx, gy, -0.008, 0.0112 + 0.0012 * p.jawSq), 0.022);
    d = smin(d, sdRoundCone(ax, y, z, gx, gy, -0.006, 0.0185, chinY + 0.005, chinZ + 0.009, 0.0118 + 0.0014 * p.jawSq, 0.0122), 0.02);
    // dental arch (mouth area) + chin
    d = smin(d, sdEll(x, y, z, 0, -0.066 * fl, -0.065, 0.0285, 0.026 * fl, 0.0285), 0.018);
    d = smin(d, sdEll(x, y, z, 0, chinY, chinZ, 0.0205 * p.chin, 0.0152 * p.chin, 0.0162), 0.016);
    // jowls (age)
    if (age > 0) d = smin(d, sdEll(ax, y, z, 0.037, -0.084, -0.052, 0.015, 0.016, 0.018 * age + 0.001), 0.018);
    // nose: tapered dorsum, lobule, alae, columella
    d = smin(d, sdRoundCone(x, y, z, 0, -0.0005, nasZ + 0.0028, 0, tipY + 0.0082, tipZ + 0.0072, 0.0039 * (0.85 + 0.15 * p.bridge), 0.0055 * nw), 0.0072);
    d = smin(d, sdEll(x, y, z, 0, tipY, tipZ + 0.0044, 0.0074 * nw, 0.0068, 0.0072), 0.0062);
    d = smin(d, sdEll(ax, y, z, 0.0094 * nw, tipY - 0.0048, tipZ + 0.0148, 0.0055 * nw, 0.0048, 0.0062), 0.0075);
    d = smin(d, sdCapsule(x, y, z, 0, tipY - 0.0052, tipZ + 0.006, 0, tipY - 0.0092, tipZ + 0.0138, 0.0029), 0.0034);
    d = smin(d, sdEll(x, y, z, 0, tipY - 0.0038, tipZ + 0.012, 0.0132 * nw, 0.0062, 0.0074), 0.0065);
    // lips (moderate projection)
    d = smin(d, sdEll(x, y, z, 0, ly + 0.0058, -0.0888 - 0.0014 * p.lipU, 0.0205 * p.mouthW, 0.0052 * p.lipU, 0.0068 * p.lipU), 0.0068);
    d = smin(d, sdEll(x, y, z, 0, ly + 0.0034, -0.0915 - 0.0014 * p.lipU, 0.0056, 0.0034 * p.lipU, 0.0046 * p.lipU), 0.0042);
    d = smin(d, sdEll(x, y, z, 0, ly - 0.0064, -0.0882 - 0.0011 * p.lipL, 0.0195 * p.mouthW, 0.0062 * p.lipL, 0.0074 * p.lipL), 0.0068);
    // labiomental fold
    d = smax(d, -sdEll(x, y, z, 0, ly - 0.016, -0.0958, 0.014, 0.0026, 0.004), 0.004);
    // mouth line: a soft groove only; the dark line is painted
    d = smax(d, -sdEll(x, y, z, 0, ly, -0.0965, 0.0172 * p.mouthW, 0.0018, 0.0058), 0.0032);
    // philtrum groove
    d = smax(d, -sdEll(x, y, z, 0, ly + 0.0152, -0.0975, 0.0034, 0.0078, 0.0024), 0.0026);
    // eye sockets
    d = smax(d, -sdEll(ax, y, z, eyeX, 0.003, -0.0862, 0.0172 * es, 0.0106 * es, 0.0122), 0.007);
    // temples
    d = smax(d, -sdEll(ax, y, z, 0.07 * fw, 0.012, -0.045, 0.008, 0.016, 0.014), 0.01);
    // age: nasolabial folds
    if (age > 0) {
      d = smax(d, -sdCapsule(ax, y, z, 0.0168, -0.043, -0.093, 0.0262, -0.071, -0.0855, 0.0008 + 0.001 * age), 0.005 * age + 0.001);
    }
    return d;
  };
}

/** Head surface geometry (cached per face params + lod). */
function headGeometry(p, lod) {
  const key = `head4|${lod}|${faceKey(p)}`;
  return cached(key, () => {
    const sdf = headSDF(p);
    const hero = lod === 0;
    const nu = hero ? 96 : 32;
    const nv = hero ? 80 : 24;
    const phis = warpTable(nu, -Math.PI, Math.PI, (a) => 0.8 + 3.2 * Math.exp(-((a / (40 * DEG)) ** 2)));
    const thetas = warpTable(nv, 0, Math.PI, (a) => 0.55 + 1.6 * Math.exp(-(((a - 90 * DEG) / (12 * DEG)) ** 2)) + 2.6 * Math.exp(-(((a - 122 * DEG) / (16 * DEG)) ** 2)) + 0.8 * Math.exp(-(((a - 105 * DEG) / (30 * DEG)) ** 2)));
    const march = radialMarcher(sdf);
    const dir = new THREE.Vector3();
    const g = gridGeometry(
      nu,
      nv,
      (u, v, out) => {
        const ph = phis[Math.round(u * nu)];
        const th = thetas[Math.round(v * nv)];
        const s = Math.sin(th);
        dir.set(s * Math.sin(ph), Math.cos(th), -s * Math.cos(ph));
        const t = march(dir.x, dir.y, dir.z);
        out.copy(dir).multiplyScalar(t);
      },
      { wrapU: true, normalFn: (u, v, pnt, n) => sdfNormal(sdf, pnt.x, pnt.y, pnt.z, n) },
    );
    g.userData.sdf = sdf;
    // ambient occlusion from the field (eye sockets, under the nose / lip, jaw shadow)
    const P = g.attributes.position;
    const Nn = g.attributes.normal;
    const ao = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i);
      const y = P.getY(i);
      const z = P.getZ(i);
      const nx = Nn.getX(i);
      const ny = Nn.getY(i);
      const nz = Nn.getZ(i);
      let occ = 0;
      let w = 1;
      for (const t of [0.0035, 0.008, 0.016]) {
        occ += Math.max(0, t - sdf(x + nx * t, y + ny * t, z + nz * t)) * w;
        w *= 0.6;
      }
      ao[i] = Math.max(0, 1 - (occ / 0.0035) * 0.42);
    }
    g.userData.ao = ao;
    return g;
  });
}

/** Skin-tone derived colours used by the face painter. */
function skinPalette(app) {
  const skin = C(app.skin);
  const l = skin.r * 0.2126 + skin.g * 0.7152 + skin.b * 0.0722;
  skin.lerp(new THREE.Color(l, l, l), 0.1);
  const dark = l < 0.12;
  const hair = C(app.hairColor);
  return {
    skin,
    lum: l,
    blush: skin.clone().multiply(C(dark ? '#ffcfc2' : '#ffc4b4')),
    lip: skin.clone().lerp(C(dark ? '#5d2a28' : '#b4554e'), dark ? 0.35 : 0.42).multiplyScalar(dark ? 0.9 : 0.94),
    lipDark: skin.clone().lerp(C('#4a1f1e'), 0.5),
    socket: skin.clone().multiplyScalar(0.8).lerp(C('#5a3a40'), 0.1),
    crease: skin.clone().multiplyScalar(0.78),
    brow: hair.clone().multiplyScalar(0.85).lerp(skin, 0.3),
    stubble: hair.clone().lerp(skin, 0.42).multiplyScalar(0.72),
    scalp: hair.clone().multiplyScalar(0.92).lerp(skin, 0.2),
    hair,
  };
}

/**
 * Adds the complete head (face, eyes, lids, brows, ears, hair, beard,
 * eyewear, headwear) to builder `b`. `frame` comes from bodyFrame().
 */
export function addHead(b, app, frame, lod, pal) {
  const p = faceParams(app);
  const hs = frame.headScale;
  const hc = frame.headC;
  const M = mat(hc.x, hc.y, hc.z, 0, 0, 0, hs, hs, hs);
  const geo = headGeometry(p, lod);
  const sdf = geo.userData.sdf;
  const S = skinPalette(app);
  const hasHair = app.hair !== 'none';
  const beard = app.beard;
  const age = p.age;
  const fl = p.faceLen;
  const ly = -0.0682 * fl;
  const eyeX = EYE.x * p.eyeSp;
  const tipY = -0.0372 * p.noseLen;
  const tipZ = -0.1105 - 0.0065 * (p.noseProj - 1);
  const inv = new THREE.Matrix4().copy(M).invert();
  const lp = new THREE.Vector3();
  const g2 = (dx, dy, dz, s) => Math.exp(-(dx * dx + dy * dy + dz * dz) / (s * s));
  const browY = (ax) => 0.0195 + 0.0062 * Math.sin(clamp01((ax - 0.01) / 0.05) * Math.PI * 0.92) * (p.fem ? 1.25 : 1) - 0.004 * clamp01((ax - 0.045) / 0.015);

  // 2D lip outline: upper vermilion height hu(x) above the slit, lower hl(x) below
  const wU = 0.0205 * p.mouthW;
  const wL = 0.0192 * p.mouthW;
  const lipMask = (ax, y, z) => {
    if (z > -0.084 || ax > wU + 0.002) return 0;
    const dy = y - ly;
    let h;
    let w;
    if (dy >= 0) {
      const t = Math.min(1, ax / wU);
      h = 0.0084 * p.lipU * Math.pow(1 - t * t, 0.62) * (1 - 0.16 * Math.exp(-((ax / 0.0035) ** 2))) + 0.0007 * Math.exp(-(((ax - 0.0055) / 0.003) ** 2));
      w = wU;
    } else {
      const t = Math.min(1, ax / wL);
      h = 0.0102 * p.lipL * Math.pow(1 - t * t, 0.55);
      w = wL;
    }
    const inside = 1 - sstep(h - 0.0008, h + 0.0006, Math.abs(dy));
    return inside * sstep(w + 0.0012, w - 0.0016, ax);
  };
  const headAO = geo.userData.ao;
  const headColor = (pw, nw, i) => {
    lp.copy(pw).applyMatrix4(inv);
    const { x, y, z } = lp;
    const ax = Math.abs(x);
    _col.copy(S.skin);
    if (z > -0.03) {
      // back/sides of the head: only the scalp + neck shading matter
    } else {
      // warmth: cheeks, nose, chin; slight coolness at the jaw
      _col.lerp(S.blush, g2(ax - 0.046, y + 0.03, z + 0.074, 0.021) * 0.34);
      _col.lerp(S.blush, g2(x, y - tipY, z - tipZ, 0.012) * 0.3);
      _col.lerp(S.blush, g2(x, y + 0.1, z + 0.088, 0.016) * 0.15);
      // socket + upper-lid crease
      _col.lerp(S.socket, g2(ax - eyeX, y - 0.004, z + 0.086, 0.016) * 0.26);
      const crease = g2(ax - eyeX, y - 0.0125, z + 0.088, 0.0055);
      _col.lerp(S.crease, crease * 0.25);
      // soft brow shadow under the geometric brow
      const by = browY(ax);
      const browZone = sstep(0.006, 0.014, ax) * sstep(0.064, 0.05, ax) * Math.exp(-(((y - by) / 0.0045) ** 2)) * (z < -0.07 ? 1 : 0);
      _col.lerp(S.brow, browZone * 0.32);
      // lips: vermilion painted from a 2D outline (cupid's bow, soft border)
      const lw = lipMask(ax, y, z);
      if (lw > 0) {
        _col.lerp(S.lip, lw * (p.fem ? 0.9 : 0.78));
        _col.multiplyScalar(1 - 0.12 * lw * sstep(ly - 0.002, ly + 0.008, y)); // upper lip a touch darker
      }
      _col.lerp(S.lipDark, Math.exp(-((x / 0.0192) ** 4)) * Math.exp(-(((y - ly) / 0.0013) ** 2)) * (z < -0.086 ? 0.85 : 0));
      _col.lerp(S.lipDark, g2(ax - 0.0196 * p.mouthW, (y - ly) * 1.8, z + 0.093, 0.0024) * 0.35);
      // nostrils (underside of the nose only)
      _col.multiplyScalar(1 - g2(ax - 0.0072 * p.noseW, y - tipY + 0.0108, z - tipZ - 0.0115, 0.0034) * (nw.y < -0.6 ? 0.45 : 0.0));
      // under the chin / jaw line
      if (y < -0.08) _col.multiplyScalar(1 - sstep(-0.08, -0.118, y) * 0.16 * sstep(-0.06, 0.0, z));
      // beard shadow / stubble
      if (beard !== 'none') {
        const jaw = sstep(-0.026, -0.058, y) * sstep(0.064, 0.022, Math.abs(z + 0.02) * 0.62 + ax * 0.24);
        const must = g2(x * 0.62, y - ly - 0.0145, z + 0.098, 0.0085);
        const hole = g2(x * 0.75, y - ly, z + 0.098, 0.0105);
        let m = clamp01(jaw * (1 - hole * 0.92) + must * 0.85);
        if (y > -0.018) m = 0;
        const speck = 0.78 + 0.22 * Math.sin(x * 2300) * Math.sin(y * 2100 + z * 1900);
        _col.lerp(S.stubble, m * (beard === 'stubble' ? 0.5 : 0.62) * speck);
      }
      // age lines
      if (age > 0) {
        const fh = sstep(0.034, 0.052, y) * sstep(0.084, 0.062, y);
        _col.multiplyScalar(1 - fh * Math.max(0, Math.sin(y * 880)) ** 6 * 0.2 * age);
        const crow = g2(ax - 0.058, y, z + 0.068, 0.011) * Math.max(0, Math.sin(Math.atan2(y, ax - 0.052) * 9)) ** 4;
        _col.multiplyScalar(1 - crow * 0.22 * age);
        _col.multiplyScalar(1 - g2(ax - 0.022, y + 0.058, z + 0.09, 0.008) * 0.18 * age);
      }
    }
    // ear-level + neck ambient
    if (y < -0.06 && z > -0.02) _col.multiplyScalar(0.96);
    // scalp under the hair (avoids skin gaps at the hairline)
    if (hasHair) {
      const ad = Math.abs(Math.atan2(x, -z)) / DEG;
      const thl = hairlineAt(ad);
      const r = Math.hypot(x, y, z) || 1;
      const th = Math.acos(Math.max(-1, Math.min(1, y / r))) / DEG;
      _col.lerp(S.scalp, sstep(thl + 3, thl - 5, th) * 0.88);
    }
    return _col.multiplyScalar(0.58 + 0.42 * headAO[i]);
  };
  b.add(geo, M, { color: headColor, rough: 0.52, metal: 0, sheen: 0.22, detail: 0, skin: true }, J.head);

  addEyes(b, app, p, M, lod, S);
  addBrows(b, app, p, sdf, M, lod, S, browY);
  addEars(b, p, M, lod, S);
  if (hasHair) addHair(b, app, p, sdf, M, hs, lod, frame);
  if (beard === 'full') addBeard(b, app, p, sdf, M, lod);
  if (app.eyewear !== 'none') addEyewear(b, app, p, M, lod);
  if (app.headwear !== 'none') addHeadwear(b, app, p, sdf, M, lod, pal);
}

// --------------------------------------------------------------------- eyes
function addEyes(b, app, p, M, lod, S) {
  const hero = lod === 0;
  const er = EYE.r * p.eye;
  const ex = EYE.x * p.eyeSp;
  const eyeGeo = cached(`eye2|${lod}`, () => {
    const g = new THREE.SphereGeometry(1, hero ? 28 : 10, hero ? 22 : 8);
    g.rotateX(-Math.PI / 2); // pole → −Z (looking forward)
    return g;
  });
  const iris = C(app.eyeColor);
  const irisLight = iris.clone().lerp(C('#d9c49a'), 0.28).multiplyScalar(1.15);
  const limbal = iris.clone().multiplyScalar(0.32);
  const sclera = C('#e4ddd4');
  const pupil = C('#060708');
  const vein = C('#d4aaa2');
  const eyeColor = (pw, n) => {
    const a = Math.acos(Math.max(-1, Math.min(1, -n.z)));
    if (a < 0.18) return _col.copy(pupil);
    if (a < 0.54) {
      // radial fibres + lighter collarette + dark limbal ring
      const ang = Math.atan2(n.y, n.x);
      const fib = 0.5 + 0.5 * Math.sin(ang * 23 + Math.sin(ang * 7) * 1.6);
      _col.copy(iris).lerp(irisLight, sstep(0.3, 0.2, a) * 0.55 + fib * 0.18);
      return _col.lerp(limbal, sstep(0.42, 0.54, a) * 0.85);
    }
    return _col.copy(sclera).lerp(vein, sstep(0.95, 1.65, a) * 0.5);
  };
  // catchlight: a small emissive spot up-left on the cornea
  const cl = V(-0.32, 0.42, -1).normalize();
  const emisFn = (pw, n) => {
    const d = n.x * cl.x + n.y * cl.y + n.z * cl.z;
    return d > 0.992 ? 2.2 : 0;
  };
  for (const sx of [1, -1]) {
    const em = new THREE.Matrix4().multiplyMatrices(M, mat(sx * ex, EYE.y, EYE.z, 0, sx * 0.06, sx * p.tilt, er));
    b.add(eyeGeo, em, { color: eyeColor, rough: 0.05, metal: 0, sheen: 0, detail: 0, emisFn: hero ? emisFn : null }, J.head);
  }
  if (!hero) return;
  // upper lids (blink bone) + lower lids
  const lidGeo = cached('lid-up2', () => {
    const g = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, 1.13);
    const P = g.attributes.position;
    const yEdge = Math.cos(1.13);
    for (let i = 0; i < P.count; i++) {
      // thicken + roll the lid margin outward → lash line
      if (P.getY(i) < yEdge + 0.025) P.setXYZ(i, P.getX(i) * 1.06, P.getY(i) - 0.025, P.getZ(i) * 1.06);
    }
    g.computeVertexNormals();
    return g;
  });
  const lowGeo = cached('lid-low2', () => {
    const g = new THREE.SphereGeometry(1, 22, 6, 0, Math.PI * 2, Math.PI - 1.0, 1.0);
    const P = g.attributes.position;
    const yEdge = Math.cos(Math.PI - 1.0);
    for (let i = 0; i < P.count; i++) {
      if (P.getY(i) > yEdge - 0.02) P.setXYZ(i, P.getX(i) * 1.03, P.getY(i), P.getZ(i) * 1.03);
    }
    g.computeVertexNormals();
    return g;
  });
  const lash = C('#120d0b');
  const lidSkin = S.skin.clone().multiplyScalar(0.93).lerp(C('#b07a70'), 0.05);
  const shadow = p.fem ? lidSkin.clone().multiplyScalar(0.82).lerp(C('#5a3d3a'), 0.08) : lidSkin.clone().multiplyScalar(0.9);
  const upEdge = Math.cos(1.13) - 0.025;
  for (const sx of [1, -1]) {
    const lr = er * 1.075;
    const lm = new THREE.Matrix4().multiplyMatrices(M, mat(sx * ex, EYE.y, EYE.z, -0.07, sx * 0.06, sx * (p.tilt - 0.06), lr));
    b.add(lidGeo, lm, {
      color: (pw, n, i) => {
        const yy = lidGeo.attributes.position.getY(i);
        if (yy < upEdge + 0.055) return _col.copy(lash);
        return _col.copy(lidSkin).lerp(shadow, sstep(0.75, 0.45, yy));
      },
      rough: 0.55, sheen: 0.2, skin: true,
    }, J.lids);
    const lm2 = new THREE.Matrix4().multiplyMatrices(M, mat(sx * ex, EYE.y, EYE.z, 0.2, sx * 0.06, sx * (p.tilt + 0.05), er * 1.045));
    b.add(lowGeo, lm2, {
      color: (pw, n, i) => (lowGeo.attributes.position.getY(i) > Math.cos(Math.PI - 1.0) - 0.04 ? _col.copy(lidSkin).multiplyScalar(0.8) : _col.copy(lidSkin)),
      rough: 0.5, sheen: 0.2,
    }, J.head);
  }
}

// -------------------------------------------------------------------- brows
function addBrows(b, app, p, sdf, M, lod, S, browY) {
  const fem = p.fem;
  const thick = (fem ? 0.68 : 1) * (0.85 + 0.15 * p.brow);
  const hero = lod === 0;
  const n = hero ? 9 : 5;
  for (const sx of [1, -1]) {
    const pts = [];
    const sec = [];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const ax = 0.0105 + f * 0.05;
      const y = browY(ax);
      const len = Math.hypot(ax, y, 0.09);
      const ux = (sx * ax) / len;
      const uy = y / len;
      const uz = -0.09 / len;
      const t = marchIn(sdf, ux, uy, uz);
      pts.push(V(ux * (t + 0.0009), uy * (t + 0.0009), uz * (t + 0.0009)).applyMatrix4(M));
      // tapered: full at the head (inner), thin at the tail
      const w = (0.0025 * (1 - f * 0.6) + 0.0007 * Math.sin(f * Math.PI)) * thick;
      sec.push({ rx: w, rf: 0.0009, rb: 0.0006, n: 2 });
    }
    if (sx < 0) {
      pts.reverse();
      sec.reverse();
    }
    const g = tubeGeometry(pts, sec, { segs: hero ? 6 : 4, ref: V(0, 0, -1), capStart: true, capEnd: true, uvAround: 0.3 });
    b.add(g, null, { color: S.brow, rough: 0.72, sheen: 0.35, detail: -0.55, uvScale: 40 }, J.head);
  }
}

// --------------------------------------------------------------------- ears
function earGeometry(lod) {
  if (lod !== 0) {
    // crowd LOD: one cupped ellipsoid per ear
    return cached('ear-lo', () => {
      const g = superEllipsoid(0.0048, 0.028, 0.017, 0.9, 0.9, 8, 5);
      g.translate(0.003, -0.002, 0.004);
      return [g];
    });
  }
  return cached(`ear5|${lod}`, () => {
    const hero = lod === 0;
    const parts = [];
    // ear-local: +X outward from the head, +Y up, +Z toward the back of the head.
    // A thick cupped shell: outline (helix) rolled outward, concha recessed.
    const nu = hero ? 22 : 10;
    const nv = hero ? 8 : 4;
    const shape = (u, v, out, back) => {
      const a = -0.5 + u * 3.7; // front-top → over the top → down the back → lobe
      const ry = 0.0285;
      const rz = 0.0175 * (a > 1.57 ? 1.06 : 1);
      const ey = Math.cos(a) * ry + 0.002;
      const ez = Math.sin(a) * rz + 0.004;
      const cy = -0.003;
      const cz = 0.0015;
      const y = cy + (ey - cy) * v;
      const z = cz + (ez - cz) * v;
      // rim rolls outward; the bowl dips toward the head; back of the ear stands off the skull
      const roll = Math.sin(Math.min(1, v) * Math.PI * 0.5) ** 3;
      const stand = 0.0055 * Math.max(0, Math.sin(a)) * v;
      const x = back ? 0.0005 + stand * 0.6 : 0.0015 + 0.0062 * roll - 0.0018 * (1 - v) + stand;
      return out.set(x, y, z);
    };
    const front = gridGeometry(nu, nv, (u, v, out) => shape(u, v, out, false), { flip: true });
    const backG = gridGeometry(nu, nv, (u, v, out) => shape(u, v, out, true), {});
    parts.push(front, backG);
    // rim thickness: tube along the outer edge
    const pts = [];
    const sec = [];
    const tmp = new THREE.Vector3();
    for (let i = 0; i <= nu; i++) {
      shape(i / nu, 1, tmp, false);
      pts.push(tmp.clone().setX(tmp.x - 0.0018));
      const a = -0.5 + (i / nu) * 3.7;
      const r = 0.0026 + 0.0009 * Math.sin(Math.min(Math.PI, Math.max(0, a + 0.5)));
      sec.push({ rx: r, rf: r * 1.1, rb: r * 1.1 });
    }
    parts.push(tubeGeometry(pts, sec, { segs: hero ? 8 : 5, ref: V(1, 0, 0), capStart: true, capEnd: true }));
    // lobe + tragus
    const lobe = superEllipsoid(0.0042, 0.0082, 0.0072, 0.9, 0.9, hero ? 10 : 6, hero ? 8 : 5);
    lobe.translate(0.0026, -0.0236, 0.0026);
    parts.push(lobe);
    const tragus = superEllipsoid(0.0034, 0.0048, 0.0036, 0.9, 0.9, 8, 5);
    tragus.translate(0.003, -0.0045, -0.0106);
    parts.push(tragus);
    return parts;
  });
}

function addEars(b, p, M, lod, S) {
  const parts = earGeometry(lod);
  const inner = S.skin.clone().multiplyScalar(0.7).lerp(C('#a05a50'), 0.1);
  const outer = S.skin.clone().lerp(S.blush, 0.3);
  const scale = 1 + 0.12 * p.age;
  for (const sx of [1, -1]) {
    const em = new THREE.Matrix4().multiplyMatrices(M, mat(sx * 0.0712 * p.faceW, -0.0095, 0.0085, 0.08, sx * 0.3, sx * -0.05, scale));
    if (sx < 0) em.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    const col = (pw, n) => {
      // the concha (facing outward-forward, close to the head) is shaded
      lpEar.copy(pw).applyMatrix4(invEar.copy(em).invert());
      const deep = sstep(0.0045, 0.0012, lpEar.x) * sstep(0.02, 0.007, Math.hypot(lpEar.y + 0.003, lpEar.z - 0.0015));
      return _col.copy(outer).lerp(inner, deep * 0.8);
    };
    parts.forEach((g) => b.add(sx < 0 ? flipped(g) : g, em, { color: col, rough: 0.55, sheen: 0.3, skin: true }, J.head));
  }
}
const lpEar = new THREE.Vector3();
const invEar = new THREE.Matrix4();
