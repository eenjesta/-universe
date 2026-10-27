/**
 * Hair, beards, eyewear and headwear (characters module).
 *
 * Hair is sculpted as clumped locks over a hairline-cut cap (hair-sculpt.js),
 * polygonized with Surface Nets and cached per style + face + LOD; colours
 * (root → tip, per-lock shade, groove AO) are applied per appearance and the
 * strand detail normals (aDetail < 0) follow each lock. Extras: a ponytail on
 * spring bones (pony1/pony2) and a bun. Beards are shells over the face SDF.
 */
import * as THREE from 'three';
import { gridGeometry, tubeGeometry, superEllipsoid, mat, setW, cached } from './builder.js';
import { J } from './skeleton.js';
import { shellGeometry, hnoise, sstep, lerp, DEG, dirOf, marchIn, EYE, faceKey } from './sculpt.js';
import { sculptHair } from './hair-sculpt.js';
import { polygonize, fieldAO } from './surface-nets.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (hex) => new THREE.Color(hex);
const _col = new THREE.Color();
const _d = new THREE.Vector3();

const hairColors = (hc) => ({
  base: hc.clone(),
  root: hc.clone().multiplyScalar(0.55),
  tip: hc.clone().lerp(C('#c8a47c'), 0.12).multiplyScalar(1.25),
  shade: hc.clone().multiplyScalar(0.5),
});

// --------------------------------------------------------------------- hair
/**
 * Polygonized hair (see hair-sculpt.js), cached per style + face + LOD in
 * head-local space with everything except the colour: AO, root→tip, per-lock
 * shade and lock-aligned UVs (strand normals run along each lock).
 */
function hairMesh(style, p, seed, hero) {
  const sc = sculptHair(style, p, seed);
  if (!sc) return null;
  const { model } = sc;
  const cell = hero ? 0.0055 : 0.0115;
  const mesh = polygonize(model, { min: sc.min, max: sc.max, cell, block: 8, project: hero ? 1 : 0 });
  const n = mesh.count;
  const P = mesh.positions;
  const N = mesh.normals;
  const tip = new Float32Array(n);
  const shade = new Float32Array(n);
  const ao = new Float32Array(n);
  const uv = new Float32Array(n * 2);
  const partD = new Float32Array(model.partCount);
  const UV = 32; // strand texture repeats per metre-ish
  for (let v = 0; v < n; v++) {
    const x = P[v * 3];
    const y = P[v * 3 + 1];
    const z = P[v * 3 + 2];
    const bl = mesh.blocks[mesh.vertexBlock[v]];
    const pi = model.query(x, y, z, bl.list, bl.n, partD);
    const pr = pi >= 0 ? model.prims[pi] : null;
    const tag = pr?.tag;
    ao[v] = fieldAO(model, x, y, z, N[v * 3], N[v * 3 + 1], N[v * 3 + 2], bl.list, bl.n, hero ? 0.0045 : 0.007, 3, 1.15);
    if (tag && pr.p.length >= 12 && !tag.curl) {
      // lock segment (round cone a → b)
      const q = pr.p;
      const sx = q[3] - q[0];
      const sy = q[4] - q[1];
      const sz = q[5] - q[2];
      const L = Math.hypot(sx, sy, sz) || 1e-6;
      let hh = ((x - q[0]) * sx + (y - q[1]) * sy + (z - q[2]) * sz) / (L * L);
      hh = hh < 0 ? 0 : hh > 1 ? 1 : hh;
      const s = tag.s0 + hh * L;
      tip[v] = Math.min(1, s / (tag.len || 1));
      shade[v] = tag.shade;
      // angle around the lock axis (mirrored → continuous)
      const dx = sx / L;
      const dy = sy / L;
      const dz = sz / L;
      let rx = dy * 0 - dz * 1;
      let ry = dz * 0 - dx * 0;
      let rz = dx * 1 - dy * 0;
      let rl = Math.hypot(rx, ry, rz);
      if (rl < 1e-4) {
        rx = 1;
        ry = 0;
        rz = 0;
        rl = 1;
      }
      rx /= rl;
      ry /= rl;
      rz /= rl;
      const ux = dy * rz - dz * ry;
      const uy = dz * rx - dx * rz;
      const uz = dx * ry - dy * rx;
      const wx = x - (q[0] + sx * hh);
      const wy = y - (q[1] + sy * hh);
      const wz = z - (q[2] + sz * hh);
      const ang = Math.atan2(wx * ux + wy * uy + wz * uz, wx * rx + wy * ry + wz * rz);
      uv[v * 2] = Math.abs(ang) * 0.01 * UV;
      uv[v * 2 + 1] = s * UV;
    } else {
      // cap / curls: strands run from the crown down (meridians)
      const r = Math.hypot(x, y, z) || 1e-6;
      const th = Math.acos(Math.max(-1, Math.min(1, y / r)));
      const ph = Math.atan2(x, -z);
      tip[v] = tag?.curl ? 0.55 : 0.08;
      shade[v] = tag?.shade ?? 0.95;
      uv[v * 2] = Math.abs(ph) * r * UV;
      uv[v * 2 + 1] = th * r * UV;
    }
  }
  return { P, N, index: mesh.indices, tip, shade, ao, uv, count: n, long: style === 'long' };
}

export function addHair(b, app, p, sdf, M, hs, lod, frame) {
  const style = app.hair;
  const hero = lod === 0;
  // shape seed from the face only (not the colour) so meshes can be cached per face + style
  const seed = (app.face * 1.37 + (app.body === 'f' ? 4.1 : 0) + 2.3) % 10;
  const hm = cached(`hairsdf|${style}|${lod}|${seed.toFixed(3)}|${faceKey(p)}`, () => hairMesh(style, p, seed, hero));
  const hc = hairColors(C(app.hairColor));
  if (hm) {
    const n = hm.count;
    const out = {
      position: new Float32Array(n * 3),
      normal: new Float32Array(n * 3),
      uv: hm.uv,
      color: new Float32Array(n * 3),
      aMat: new Float32Array(n * 4),
      aDetail: new Float32Array(n).fill(hero ? -0.75 : -0.5),
      skinIndex: new Uint16Array(n * 4),
      skinWeight: new Float32Array(n * 4),
      index: hm.index,
    };
    const e = M.elements;
    const hcY = frame.headC.y;
    for (let v = 0; v < n; v++) {
      const x = hm.P[v * 3];
      const y = hm.P[v * 3 + 1];
      const z = hm.P[v * 3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      out.position[v * 3] = wx;
      out.position[v * 3 + 1] = wy;
      out.position[v * 3 + 2] = wz;
      out.normal[v * 3] = hm.N[v * 3];
      out.normal[v * 3 + 1] = hm.N[v * 3 + 1];
      out.normal[v * 3 + 2] = hm.N[v * 3 + 2];
      // root (dark, inside the volume) → base → lighter tips; clump AO in the grooves
      const t = hm.tip[v];
      const a = hm.ao[v];
      _col.copy(hc.root).lerp(hc.base, 0.35 + 0.65 * a).lerp(hc.tip, Math.pow(t, 1.6) * 0.42);
      const k = hm.shade[v] * (0.42 + 0.58 * a);
      out.color[v * 3] = _col.r * k;
      out.color[v * 3 + 1] = _col.g * k;
      out.color[v * 3 + 2] = _col.b * k;
      out.aMat[v * 4] = 0.44;
      out.aMat[v * 4 + 1] = 0;
      out.aMat[v * 4 + 2] = 0;
      out.aMat[v * 4 + 3] = 0.75;
      // long hair below the jaw follows the chest a little (neck bends)
      if (hm.long && wy < hcY - 0.04) {
        const tt = sstep(hcY - 0.04, hcY - 0.22, wy);
        out.skinIndex[v * 4] = J.head;
        out.skinIndex[v * 4 + 1] = J.chest;
        out.skinWeight[v * 4] = 1 - tt;
        out.skinWeight[v * 4 + 1] = tt;
      } else {
        out.skinIndex[v * 4] = J.head;
        out.skinWeight[v * 4] = 1;
      }
    }
    b.addArrays(out);
  }
  if (style === 'ponytail') addPonytail(b, sdf, M, hs, hc, lod, frame);
  if (style === 'bun') addBun(b, sdf, M, hs, hc, lod);
}

function addPonytail(b, sdf, M, hs, hc, lod, frame) {
  const hero = lod === 0;
  const j1 = frame.joints[J.pony1];
  const j2y = frame.joints[J.pony2].y;
  const tieGeo = cached('tie2', () => new THREE.TorusGeometry(1, 0.34, 8, 18));
  b.add(tieGeo, mat(j1.x, j1.y + 0.002 * hs, j1.z + 0.006 * hs, 1.25, 0, 0, 0.0122 * hs), { color: C('#121214'), rough: 0.5, sheen: 0.2 }, J.pony1);
  const path = [];
  const sec = [];
  const tail = [
    [0.0, 0.002, -0.004, 0.0128],
    [0.0, -0.008, 0.018, 0.0185],
    [0.0, -0.04, 0.038, 0.0215],
    [0.0, -0.09, 0.05, 0.0205],
    [0.0, -0.145, 0.052, 0.0175],
    [0.0, -0.2, 0.046, 0.0125],
    [0.0, -0.245, 0.036, 0.007],
    [0.0, -0.268, 0.028, 0.0018],
  ];
  for (const [x, y, z, r] of tail) {
    path.push(V(j1.x + x * hs, j1.y + y * hs, j1.z + z * hs));
    sec.push({ rx: r * hs * 1.12, rf: r * hs, rb: r * hs * 0.92, n: 2 });
  }
  const tg = tubeGeometry(path, sec, { segs: hero ? 12 : 6, ref: V(0, 0, -1), capStart: true, uvAround: 0.12 });
  const tw = (pp, out) => {
    const t = sstep(j1.y - 0.02, j2y, pp.y);
    setW(out, J.pony1, 1 - t, J.pony2, t);
  };
  b.add(tg, null, {
    color: (pw) => _col.copy(hc.base).lerp(hc.tip, sstep(j1.y - 0.08, j1.y - 0.27, pw.y) * 0.5),
    rough: 0.46, sheen: 0.75, detail: -0.85, uvScale: 9,
  }, tw);
  void sdf;
}

function addBun(b, sdf, M, hs, hc, lod) {
  const hero = lod === 0;
  // find the scalp at the upper back of the head
  dirOf(52 * DEG, Math.PI, _d);
  const r = marchIn(sdf, _d.x, _d.y, _d.z) + 0.018;
  const bc = V(_d.x * r, _d.y * r, _d.z * r).applyMatrix4(M);
  const bunGeo = cached(`bun2|${lod}`, () => {
    const g2 = superEllipsoid(1, 1, 1, 0.9, 0.9, hero ? 20 : 8, hero ? 14 : 6);
    const P = g2.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i);
      const y = P.getY(i);
      const z = P.getZ(i);
      const k = 1 + 0.08 * Math.sin(Math.atan2(x, z) * 6 + y * 5);
      P.setXYZ(i, x * k, y * k, z * k);
    }
    g2.computeVertexNormals();
    return g2;
  });
  b.add(bunGeo, mat(bc.x, bc.y, bc.z, 0.75, 0, 0, 0.034 * hs, 0.029 * hs, 0.031 * hs), { color: hc.base, rough: 0.46, sheen: 0.75, detail: -0.85, uvScale: 4 }, J.head);
  const tieGeo = cached('tie2', () => new THREE.TorusGeometry(1, 0.34, 8, 18));
  const tc = bc.clone().addScaledVector(V(0, -0.55, -0.83), 0.019 * hs);
  b.add(tieGeo, mat(tc.x, tc.y, tc.z, 0.75 + Math.PI / 2, 0, 0, 0.019 * hs), { color: C('#121214'), rough: 0.5 }, J.head);
}

// -------------------------------------------------------------------- beard
export function addBeard(b, app, p, sdf, M, lod) {
  const hero = lod === 0;
  const hcol = C(app.hairColor);
  const ly = -0.0688 * p.faceLen;
  const top = [[0, 117], [12, 119], [22, 122], [34, 114], [52, 104], [70, 98], [84, 96], [100, 98], [118, 104]];
  const tl = (ad) => {
    for (let i = 1; i < top.length; i++) {
      if (ad <= top[i][0]) {
        const t = (ad - top[i - 1][0]) / (top[i][0] - top[i - 1][0]);
        return lerp(top[i - 1][1], top[i][1], t * t * (3 - 2 * t));
      }
    }
    return top[top.length - 1][1];
  };
  const g = shellGeometry(
    sdf,
    hero ? 48 : 18,
    hero ? 18 : 7,
    tl,
    (ad) => 163 - ad * 0.3,
    (ph, v, dir, r) => {
      const x = dir.x * r;
      const y = dir.y * r;
      const z = dir.z * r;
      // keep the lips free; fuller on the chin, a little point below it
      const lips = Math.exp(-((x / 0.025) ** 2) - ((y - ly) / 0.0085) ** 2) * (z < -0.07 ? 1 : 0);
      const chin = Math.exp(-((x / 0.038) ** 2) - ((y + 0.112) / 0.03) ** 2);
      const must = Math.exp(-((x / 0.026) ** 2) - ((y - ly - 0.014) / 0.006) ** 2) * (z < -0.08 ? 1 : 0);
      const t = 0.0045 + 0.007 * sstep(0, 0.45, v) + 0.014 * chin + 0.0035 * must + 0.0018 * hnoise(x * 300, y * 300, z * 300);
      const edge = sstep(0, 0.12, v) * sstep(1, 0.86, v) * sstep(125, 100, Math.abs(ph) / DEG);
      return t * (0.2 + 0.8 * edge) - lips * 0.02;
    },
    { phiMin: -125 * DEG, phiMax: 125 * DEG, uScale: 5, vScale: 2 },
  );
  const tip = hcol.clone().lerp(C('#ffffff'), 0.08).multiplyScalar(1.08);
  b.add(g, M, {
    color: (pw, n, i) => _col.copy(hcol).lerp(tip, 0.3 + 0.3 * Math.sin(i * 2.3)).multiplyScalar(0.88 + 0.12 * Math.sin(i * 0.71)),
    rough: 0.62, sheen: 0.65, detail: -0.9,
  }, J.head);
}

// ------------------------------------------------------------------ eyewear
export function addEyewear(b, app, p, M, lod) {
  const frameC = C(app.eyewear === 'visor' ? '#1a1d22' : '#151515');
  const ex = EYE.x * p.eyeSp;
  if (app.eyewear === 'visor') {
    const g = cached(`visor2|${lod}`, () => new THREE.CylinderGeometry(0.1, 0.098, 0.028, lod === 0 ? 36 : 14, 1, true, Math.PI - 1.2, 2.4));
    b.add(g, new THREE.Matrix4().multiplyMatrices(M, mat(0, 0.003, 0.0045, 0, 0, 0, 1.02, 1, 1)), { color: C('#57d6ff'), rough: 0.12, metal: 0.3, emis: 0.75, sheen: 0 }, J.head);
    const band = cached(`visorband2|${lod}`, () => new THREE.TorusGeometry(0.1, 0.0032, 6, lod === 0 ? 44 : 16, 2.6));
    for (const dy of [0.0175, -0.0115]) {
      b.add(band, new THREE.Matrix4().multiplyMatrices(M, mat(0, 0.003 + dy, 0.0045, Math.PI / 2, 0, -Math.PI / 2 - 1.3, 1.02, 1, 1)), { color: frameC, rough: 0.35, metal: 0.7 }, J.head);
    }
    return;
  }
  const ring = cached(`glassring2|${lod}`, () => {
    const pts = [];
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // rounded rectangle, slightly wider at the top (aviator-ish)
      pts.push(V(Math.sign(c) * Math.abs(c) ** 0.55 * 0.0215 * (1 + 0.06 * s), Math.sign(s) * Math.abs(s) ** 0.7 * 0.0142 - 0.001 * Math.max(0, -s) * Math.abs(c), 0));
    }
    const sec = pts.map(() => ({ rx: 0.0015, rf: 0.0017, rb: 0.0017 }));
    return tubeGeometry(pts, sec, { segs: 5, ref: V(0, 0, -1) });
  });
  const fz = -0.0985;
  const st = { color: frameC, rough: 0.28, metal: 0.65 };
  for (const sx of [1, -1]) {
    const lm = new THREE.Matrix4().multiplyMatrices(M, mat(sx * (ex + 0.0008), 0.0015, fz + 0.0025, 0, sx * -0.14, 0));
    b.add(ring, lm, st, J.head);
    if (app.eyewear === 'shades') {
      const lens = cached('lens2', () => superEllipsoid(0.021, 0.0138, 0.0018, 0.5, 0.6, 16, 6));
      b.add(lens, lm, { color: C('#0a0c10'), rough: 0.05, metal: 0.7 }, J.head);
    }
    const arm = cached('templearm2', () => new THREE.BoxGeometry(0.0024, 0.0034, 0.094));
    b.add(arm, new THREE.Matrix4().multiplyMatrices(M, mat(sx * 0.0738 * p.faceW, 0.0045, -0.046, 0.05, sx * -0.07, 0)), st, J.head);
  }
  const bridge = cached('bridge2', () => new THREE.BoxGeometry(0.013, 0.0024, 0.003));
  b.add(bridge, new THREE.Matrix4().multiplyMatrices(M, mat(0, 0.0075, fz - 0.0005)), st, J.head);
}

// ----------------------------------------------------------------- headwear
export function addHeadwear(b, app, p, sdf, M, lod, pal) {
  const hw = app.headwear;
  const hero = lod === 0;
  const nu = hero ? 52 : 20;
  if (hw === 'cap' || hw === 'hood') {
    const isHood = hw === 'hood';
    const g = shellGeometry(
      sdf,
      nu,
      hero ? 16 : 6,
      () => 0,
      (ad) => (isHood ? lerp(54, 120, sstep(18, 72, ad)) + 8 * sstep(120, 180, ad) : 63 + 7 * sstep(60, 180, ad)),
      (ph, v) => (isHood ? 0.03 + 0.012 * v + 0.012 * sstep(2.4, 3.1, Math.abs(ph)) * (1 - v) : 0.0175 + 0.004 * (1 - v)),
      { pole: true },
    );
    const col = isHood ? C(app.outfitColor) : C(pal?.capColor || app.outfitColor).multiplyScalar(0.8);
    b.add(g, M, { color: col, rough: 0.85, sheen: 0.5, detail: 0.5, uvScale: 1 }, J.head);
    if (!isHood) {
      const brim = cached(`brim2|${lod}`, () => new THREE.CylinderGeometry(0.104, 0.104, 0.005, hero ? 26 : 10, 1, false, Math.PI - 1.05, 2.1));
      b.add(brim, new THREE.Matrix4().multiplyMatrices(M, mat(0, 0.056, -0.034, -0.14, 0, 0)), { color: col.clone().multiplyScalar(0.9), rough: 0.8, sheen: 0.4 }, J.head);
    }
    return;
  }
  if (hw === 'headband') {
    const g = shellGeometry(sdf, nu, 3, (ad) => 54 + 8 * sstep(30, 180, ad), (ad) => 67 + 8 * sstep(30, 180, ad), () => 0.0115, {});
    const a = C(app.accentColor).multiplyScalar(0.7);
    const base = C('#5a2f20');
    b.add(g, M, {
      color: (pw, n, i) => {
        const u = g.attributes.uv.getX(i);
        const v = g.attributes.uv.getY(i);
        return _col.copy(Math.sin(u * 60) > 0.55 || Math.abs(v - 1) < 0.25 ? a : base);
      },
      rough: 0.88, sheen: 0.4, detail: 0.6,
    }, J.head);
    return;
  }
  if (hw === 'headset') {
    const cup = cached(`cup2|${lod}`, () => new THREE.CylinderGeometry(0.031, 0.033, 0.024, hero ? 18 : 8));
    const dark = C('#1c1e22');
    const acc = C(app.accentColor);
    for (const sx of [1, -1]) {
      b.add(cup, new THREE.Matrix4().multiplyMatrices(M, mat(sx * 0.088 * p.faceW, -0.008, 0.008, 0, 0, Math.PI / 2)), { color: dark, rough: 0.5, metal: 0.2 }, J.head);
    }
    const band = cached(`hsband2|${lod}`, () => new THREE.TorusGeometry(1, 0.06, 6, hero ? 28 : 12, Math.PI));
    b.add(band, new THREE.Matrix4().multiplyMatrices(M, mat(0, -0.008, 0.008, 0, 0, 0, 0.091 * p.faceW, 0.135, 0.1)), { color: dark, rough: 0.45, metal: 0.3 }, J.head);
    const boom = cached('boom2', () => new THREE.CylinderGeometry(0.0025, 0.0025, 0.085, 6));
    b.add(boom, new THREE.Matrix4().multiplyMatrices(M, mat(0.072, -0.046, -0.042, 0.9, 0, 0.25)), { color: dark, rough: 0.4, metal: 0.5 }, J.head);
    const light = cached('hslight2', () => new THREE.SphereGeometry(0.004, 6, 4));
    b.add(light, new THREE.Matrix4().multiplyMatrices(M, mat(0.091, -0.008, 0.012)), { color: acc, emis: 2.5 }, J.head);
  }
}

