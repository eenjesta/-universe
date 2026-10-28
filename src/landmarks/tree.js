/**
 * Landmarks — de Levensboom, the giant bioluminescent violet tree in the
 * middle of Nexus-plein.
 *
 *  - trunk: 8 tapered tube strands twisting around each other, flaring into
 *    roots at the bottom and splitting into the main limbs at the top, around
 *    a glowing violet core; bark shader with long glowing veins
 *  - canopy: ~30 merged, noise-displaced foliage lumps (one draw call) with a
 *    leaf shader: procedural leaf breakup + bumpy normals, dithered leafy
 *    silhouettes, twinkling sparkles, violet glow that grows at night and a
 *    warm translucent rim when backlit by the sun
 *  - fringe: instanced alpha-tested leaf-cluster cards on the lump surfaces
 *    (sway on the GPU) so the outline reads as foliage, not as blobs
 *  - tendrils: instanced glowing strands of light beads hanging from the
 *    lower canopy (sway); drifting light motes (GPU animated Points)
 *  - one violet PointLight (stronger at night)
 */
import * as THREE from 'three';
import { Rng } from '../core/math.js';
import { GeoBuilder, taperedTube, TAU } from './common.js';
import { canopyLeafTexture, radialTexture } from './textures.js';

// ------------------------------------------------------------------ CPU noise
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), ux), l(c(0, 1, 0), c(1, 1, 0), ux), uy),
    l(l(c(0, 0, 1), c(1, 0, 1), ux), l(c(0, 1, 1), c(1, 1, 1), ux), uy),
    uz,
  );
}

/** GLSL: 3D value noise + hash used by the foliage shaders. */
const NOISE3_GLSL = /* glsl */ `
  float tH3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float tN3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(tH3(i), tH3(i + vec3(1, 0, 0)), f.x), mix(tH3(i + vec3(0, 1, 0)), tH3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(tH3(i + vec3(0, 0, 1)), tH3(i + vec3(1, 0, 1)), f.x), mix(tH3(i + vec3(0, 1, 1)), tH3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

export function buildTree(env, { x, z, gy, height = 34, canopyRadius = 22 }) {
  const { mats, physics, quality } = env;
  const U = mats.U;
  const rng = new Rng('levensboom');
  const group = new THREE.Group();
  group.name = 'levensboom';
  const base = new THREE.Vector3(x, gy, z);
  const R = canopyRadius * 1.08; // horizontal spread of the canopy
  const canopyCenter = new THREE.Vector3(x, gy + height * 0.72, z);

  // ------------------------------------------------------------ trunk + limbs
  const bark = new GeoBuilder({ uv: true });
  const limbs = [];
  const STRANDS = 8;
  for (let i = 0; i < STRANDS; i++) {
    const a = (i / STRANDS) * TAU + rng.range(-0.15, 0.15);
    const twist = 1.2;
    const pt = (r, ang, y) => new THREE.Vector3(x + Math.sin(ang) * r, gy + y, z + Math.cos(ang) * r);
    const limbA = a + twist + rng.range(-0.3, 0.3);
    const limbR = rng.range(11, 15.5);
    const limbY = height * rng.range(0.62, 0.7);
    const pts = [
      pt(rng.range(9.5, 12), a - 0.25, -0.6),
      pt(7.0, a - 0.15, 0.9),
      pt(4.4, a, 3.0),
      pt(2.7, a + twist * 0.35, 7.5),
      pt(2.5, a + twist * 0.7, 12),
      pt(3.6, a + twist * 0.92, 16),
      pt(limbR * 0.55, limbA, limbY - 3.5),
      pt(limbR, limbA + rng.range(-0.15, 0.15), limbY),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const g = taperedTube(curve, 52, 10, (t) => (t < 0.15 ? THREE.MathUtils.lerp(0.5, 1.95, t / 0.15) : THREE.MathUtils.lerp(1.95, 0.42, Math.pow((t - 0.15) / 0.85, 0.85))));
    bark.add(g, undefined, { color: 0xffffff });
    g.dispose();
    limbs.push({ curve, a: limbA, end: curve.getPointAt(1) });
  }
  // a few sub-limbs reaching up into the crown; each ends in a foliage clump
  const twigEnds = [];
  for (const limb of limbs) {
    for (let k = 0; k < 2; k++) {
      const p0 = limb.curve.getPointAt(rng.range(0.7, 0.9));
      const ang = limb.a + rng.range(-0.8, 0.8);
      const p2 = new THREE.Vector3(p0.x + Math.sin(ang) * rng.range(4, 7), p0.y + rng.range(4, 7), p0.z + Math.cos(ang) * rng.range(4, 7));
      const p1 = p0.clone().lerp(p2, 0.5).add(new THREE.Vector3(0, 1.2, 0));
      const g = taperedTube(new THREE.CatmullRomCurve3([p0, p1, p2]), 10, 7, (t) => THREE.MathUtils.lerp(0.6, 0.14, t));
      bark.add(g, undefined, { color: 0xffffff });
      g.dispose();
      twigEnds.push(p2);
    }
  }
  const barkMat = makeBarkMaterial(U);
  mats.list.push(barkMat);
  group.add(bark.mesh(barkMat, { name: 'tree-bark', castShadow: true, receiveShadow: true }));

  // glowing core inside the strands (light seeps through the gaps)
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.6, 15, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.35, 1.4), side: THREE.DoubleSide }));
  core.position.set(x, gy + 7.5, z);
  core.name = 'tree-core';
  mats.list.push(core.material);
  group.add(core);

  // ------------------------------------------------------------ canopy lumps
  const lumps = [];
  const addLump = (lx, ly, lz, r, squash = 0.62) => lumps.push({ c: new THREE.Vector3(lx, ly, lz), r, squash });
  // outer ring (low, wide) — the limbs end inside these; irregular spacing,
  // reach and height so the outline reads as separate leafy masses
  const outerN = 14;
  for (let i = 0; i < outerN; i++) {
    const a = (i / outerN) * TAU + rng.range(-0.2, 0.2);
    const rr = R * rng.range(0.66, 0.86);
    addLump(x + Math.sin(a) * rr, canopyCenter.y - rng.range(0.8, 4.2), z + Math.cos(a) * rr, rng.range(5.6, 7.6), rng.range(0.55, 0.7));
  }
  // a few smaller masses reaching further out (breaks the round silhouette)
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, TAU);
    const rr = R * rng.range(0.9, 1.02);
    addLump(x + Math.sin(a) * rr, canopyCenter.y - rng.range(2.5, 5), z + Math.cos(a) * rr, rng.range(3.8, 5.0), rng.range(0.62, 0.74));
  }
  const midN = 9;
  for (let i = 0; i < midN; i++) {
    const a = (i / midN) * TAU + 0.3 + rng.range(-0.15, 0.15);
    const rr = R * rng.range(0.4, 0.52);
    addLump(x + Math.sin(a) * rr, canopyCenter.y + rng.range(2, 4), z + Math.cos(a) * rr, rng.range(7.5, 8.8), rng.range(0.6, 0.7));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng.range(-0.3, 0.3);
    const rr = i === 0 ? 0 : R * rng.range(0.14, 0.24);
    addLump(x + Math.sin(a) * rr, canopyCenter.y + rng.range(6.5, 8.5), z + Math.cos(a) * rr, rng.range(7.5, 9), 0.66);
  }
  // make sure every limb end sits inside foliage
  for (const limb of limbs) {
    const e = limb.end;
    let inside = false;
    for (const L of lumps) if (Math.hypot(e.x - L.c.x, (e.y - L.c.y) / L.squash, e.z - L.c.z) < L.r * 0.85) inside = true;
    if (!inside) addLump(e.x, e.y + 1.5, e.z, rng.range(5.5, 6.5), 0.62);
  }
  // hanging clumps around every sub-limb end: an irregular, leafy underside
  const mainLumps = lumps.length;
  for (const e of twigEnds) addLump(e.x, e.y + 0.6, e.z, rng.range(3.6, 4.8), rng.range(0.66, 0.78));

  const canopyGeo = new GeoBuilder({ uv: false });
  const surface = []; // [x, y, z, nx, ny, nz] samples for cards / tendrils
  const detail = 3;
  const tmpN = new THREE.Vector3();
  const soft = new THREE.Vector3();
  lumps.forEach((L, li) => {
    const g = new THREE.IcosahedronGeometry(1, li >= mainLumps ? 2 : detail);
    const p = g.attributes.position;
    const seed = li * 7.31;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i);
      const vy = p.getY(i);
      const vz = p.getZ(i);
      const n = noise3(vx * 1.6 + seed, vy * 1.6, vz * 1.6 - seed) * 0.65 + noise3(vx * 3.4 - seed, vy * 3.4 + seed, vz * 3.4) * 0.35;
      // flatter bottom, lumpy top
      const k = 1 + (n - 0.5) * 0.42;
      const flat = vy < 0 ? 0.72 : 1;
      p.setXYZ(i, L.c.x + vx * L.r * k, L.c.y + vy * L.r * L.squash * k * flat, L.c.z + vz * L.r * k);
    }
    // smooth normals of the merged icosphere (detail ≥ 1 has shared positions but split vertices)
    const merged = mergeByPosition(g);
    g.dispose();
    merged.computeVertexNormals();
    // soften: blend each lump normal with the direction from the canopy centre
    const P = merged.attributes.position;
    const N = merged.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      tmpN.fromBufferAttribute(N, i);
      soft.set(P.getX(i) - canopyCenter.x, (P.getY(i) - canopyCenter.y) * 1.6 + 3, P.getZ(i) - canopyCenter.z).normalize();
      tmpN.multiplyScalar(0.6).addScaledVector(soft, 0.4).normalize();
      N.setXYZ(i, tmpN.x, tmpN.y, tmpN.z);
    }
    // crevice occlusion: darker where this lump dives into a neighbour, darker underside
    const occ = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const qx = P.getX(i) + N.getX(i) * 1.4;
      const qy = P.getY(i) + N.getY(i) * 1.4;
      const qz = P.getZ(i) + N.getZ(i) * 1.4;
      let inside = 0;
      for (let k = 0; k < lumps.length; k++) {
        if (k === li) continue;
        const O = lumps[k];
        const dx = (qx - O.c.x) / O.r;
        const dy = (qy - O.c.y) / (O.r * O.squash);
        const dz = (qz - O.c.z) / O.r;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1) inside += 1 - d2;
      }
      const under = THREE.MathUtils.clamp((canopyCenter.y + 2 - P.getY(i)) / 9, 0, 1);
      const k0 = (1 - Math.min(0.6, inside * 0.9)) * (1 - under * 0.35);
      occ[i * 3] = occ[i * 3 + 1] = occ[i * 3 + 2] = k0;
      if (inside < 0.15 && i % 2 === 0) surface.push([P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), under]);
    }
    merged.setAttribute('color', new THREE.Float32BufferAttribute(occ, 3));
    const tone = rng.range(0.85, 1.12);
    canopyGeo.add(merged, undefined, { color: [tone, tone * rng.range(0.94, 1.04), tone] });
    merged.dispose();
  });
  const foliageMat = makeFoliageMaterial(U, canopyCenter, R);
  mats.list.push(foliageMat);
  const canopy = canopyGeo.mesh(foliageMat, { name: 'tree-canopy', castShadow: true, receiveShadow: true });
  group.add(canopy);

  // ------------------------------------------------------------ fringe cards
  const cardMax = 7200;
  const cardMat = makeCardMaterial(U, canopyCenter);
  mats.list.push(cardMat);
  const cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cardMat, cardMax);
  cards.name = 'tree-leaf-cards';
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const pv = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const nrm = new THREE.Vector3();
  for (let i = 0; i < cardMax; i++) {
    const sp = surface[Math.floor(rng.random() * surface.length)];
    nrm.set(sp[3], sp[4], sp[5]);
    // a leafy shell around the lumps: random orientation (volume), slightly in/out
    const off = rng.range(0.05, 1.3); // just outside the lump: the cards form the visible leafy shell
    pv.set(sp[0] + nrm.x * off, sp[1] + nrm.y * off * 0.8, sp[2] + nrm.z * off);
    q.setFromUnitVectors(zAxis, nrm.clone().add(new THREE.Vector3(rng.range(-1, 1), rng.range(-0.8, 1), rng.range(-1, 1))).normalize());
    q2.setFromAxisAngle(zAxis, rng.range(0, TAU));
    q.multiply(q2);
    const sc = rng.range(2.6, 4.3);
    m4.compose(pv, q, s.set(sc, sc, sc));
    cards.setMatrixAt(i, m4);
    const top = THREE.MathUtils.clamp((pv.y - (canopyCenter.y - 6)) / 16, 0, 1);
    col.setHSL(0.77 + rng.range(-0.02, 0.02), rng.range(0.6, 0.78), THREE.MathUtils.lerp(0.42, 0.7, top) * (1 - sp[6] * 0.25) * rng.range(0.9, 1.08));
    cards.setColorAt(i, col);
  }
  const cardCount = (q0) => Math.round(cardMax * THREE.MathUtils.clamp(q0.particles ?? 1, 0.4, 1));
  cards.count = cardCount(quality);
  cards.instanceMatrix.needsUpdate = true;
  cards.instanceColor.needsUpdate = true;
  cards.castShadow = false;
  cards.computeBoundingSphere();
  group.add(cards);

  // ------------------------------------------------------------ tendrils
  const lower = surface.filter((sp) => sp[4] < -0.15 && Math.hypot(sp[0] - x, sp[2] - z) > R * 0.35);
  const tenMax = 220;
  const tenGeo = new THREE.BoxGeometry(0.07, 1, 0.07, 1, 10, 1).translate(0, -0.5, 0);
  const tenMat = makeTendrilMaterial(U);
  mats.list.push(tenMat);
  const tendrils = new THREE.InstancedMesh(tenGeo, tenMat, tenMax);
  tendrils.name = 'tree-tendrils';
  for (let i = 0; i < tenMax; i++) {
    const sp = lower.length ? lower[Math.floor(rng.random() * lower.length)] : [x, gy + 20, z];
    const rr = Math.hypot(sp[0] - x, sp[2] - z);
    const len = rng.range(2.5, 8.5) * (0.65 + 0.5 * (rr / R));
    m4.compose(pv.set(sp[0], sp[1] + 0.3, sp[2]), q.identity(), s.set(1, len, 1));
    tendrils.setMatrixAt(i, m4);
    col.setHSL(rng.chance(0.55) ? 0.6 + rng.range(-0.03, 0.03) : 0.74 + rng.range(-0.03, 0.03), 0.85, 0.62);
    tendrils.setColorAt(i, col);
  }
  const tenCount = (q0) => Math.round(tenMax * THREE.MathUtils.clamp(q0.particles ?? 1, 0.5, 1));
  tendrils.count = tenCount(quality);
  tendrils.instanceMatrix.needsUpdate = true;
  tendrils.instanceColor.needsUpdate = true;
  tendrils.computeBoundingSphere();
  group.add(tendrils);

  // ------------------------------------------------------------ particles
  const partMax = 520;
  const partGeo = new THREE.BufferGeometry();
  const pp = new Float32Array(partMax * 3);
  const pd = new Float32Array(partMax * 4);
  for (let i = 0; i < partMax; i++) {
    const a = rng.range(0, TAU);
    const rr = Math.sqrt(rng.random()) * R * 1.15;
    pp[i * 3] = x + Math.sin(a) * rr;
    pp[i * 3 + 1] = gy + rng.range(1, height + 4);
    pp[i * 3 + 2] = z + Math.cos(a) * rr;
    pd[i * 4] = rng.range(0.25, 0.9); // rise speed
    pd[i * 4 + 1] = rng.range(0, 100); // phase
    pd[i * 4 + 2] = rng.range(0.6, 1.4); // size
    pd[i * 4 + 3] = rng.random(); // hue pick
  }
  partGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  partGeo.setAttribute('aData', new THREE.BufferAttribute(pd, 4));
  const partCount = (q0) => Math.round(partMax * THREE.MathUtils.clamp(q0.particles ?? 1, 0.4, 1));
  partGeo.setDrawRange(0, partCount(quality));
  const partMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uNight: U.uNight, uBase: { value: gy }, uHeight: { value: height + 6 }, map: { value: radialTexture() } },
    vertexShader: /* glsl */ `
      attribute vec4 aData; uniform float uTime, uBase, uHeight, uNight;
      varying vec3 vCol; varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * aData.x * 0.6 + aData.y;
        p.y = uBase + mod(p.y - uBase + t, uHeight);
        p.x += sin(t * 0.7 + aData.y) * 1.6;
        p.z += cos(t * 0.6 + aData.y * 1.3) * 1.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float h = (p.y - uBase) / uHeight;
        vA = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.85, 1.0, h)) * (0.55 + 0.45 * sin(uTime * 2.0 + aData.y * 3.0));
        vCol = mix(vec3(0.75, 0.55, 1.0), vec3(0.55, 0.9, 1.0), step(0.7, aData.w)) * mix(0.5, 1.4, uNight);
        gl_PointSize = clamp(aData.z * 150.0 / -mv.z, 1.0, 6.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; varying vec3 vCol; varying float vA;
      void main() {
        float a = texture2D(map, gl_PointCoord).r * vA;
        gl_FragColor = vec4(vCol * a, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  mats.list.push(partMat);
  const particles = new THREE.Points(partGeo, partMat);
  particles.name = 'tree-motes';
  partGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, gy + height / 2, z), R * 1.6);
  group.add(particles);

  // ------------------------------------------------------------ light
  const light = new THREE.PointLight(0xa070ff, 0, 70, 1.7);
  light.position.set(x, gy + 10, z);
  light.name = 'tree-light';
  group.add(light);

  // physics: trunk (non-walkable so nobody ends up standing on the canopy)
  for (let k = 0; k < 3; k++) {
    physics?.addBox({ x, y: gy + 9, z, w: 7, h: 18, d: 7, rotY: (k / 3) * (Math.PI / 2), walkable: false, tag: 'landmarks' });
  }

  return {
    group,
    base,
    canopyCenter,
    radius: 6,
    footprint: 8.5,
    update() {
      const n = U.uNight.value;
      light.intensity = 60 * n * n + 6;
      core.material.color.setRGB(0.75, 0.35, 1.4).multiplyScalar(0.25 + 0.55 * n);
    },
    setQuality(q0) {
      cards.count = cardCount(q0);
      tendrils.count = tenCount(q0);
      partGeo.setDrawRange(0, partCount(q0));
    },
  };
}

/** Welds an indexed/non-indexed geometry by position so normals become smooth. */
function mergeByPosition(geo) {
  const P = geo.attributes.position;
  const map = new Map();
  const pos = [];
  const idx = [];
  const src = geo.index ? geo.index.array : null;
  const count = src ? src.length : P.count;
  for (let k = 0; k < count; k++) {
    const i = src ? src[k] : k;
    const key = `${Math.round(P.getX(i) * 1000)},${Math.round(P.getY(i) * 1000)},${Math.round(P.getZ(i) * 1000)}`;
    let v = map.get(key);
    if (v === undefined) {
      v = pos.length / 3;
      map.set(key, v);
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
    }
    idx.push(v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Bark: dark violet-brown with long glowing veins running up the strands. */
function makeBarkMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0x6c4e76, roughness: 0.7, metalness: 0.05 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBarkUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBarkUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vBarkUv; uniform float uNight; uniform float uTime;
        float bHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float bNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(bHash(i), bHash(i+vec2(1,0)), u.x), mix(bHash(i+vec2(0,1)), bHash(i+vec2(1,1)), u.x), u.y); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // u wraps around the strand, v = metres along it: long streaks along the strand
        vec2 bq = vec2(vBarkUv.x * 9.0, vBarkUv.y * 0.11);
        float warp = bNoise(vec2(vBarkUv.x * 3.0, vBarkUv.y * 0.06)) * 1.6;
        float ridge = bNoise(bq + vec2(warp, 0.0));
        float vein = 1.0 - smoothstep(0.012, 0.05, abs(ridge - 0.5));
        float groove = smoothstep(0.35, 0.75, bNoise(vec2(vBarkUv.x * 26.0, vBarkUv.y * 0.35)));
        diffuseColor.rgb *= (0.55 + 0.55 * groove) * (0.8 + 0.4 * bNoise(vec2(vBarkUv.x * 40.0, vBarkUv.y * 2.0)));`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.85, 0.45, groove);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float pulse = 0.7 + 0.3 * sin(uTime * 1.1 - vBarkUv.y * 0.22);
        totalEmissiveRadiance += vec3(0.62, 0.34, 1.0) * vein * pulse * mix(0.8, 1.2, uNight);
        totalEmissiveRadiance += vec3(0.16, 0.06, 0.32) * (1.0 - groove) * mix(0.05, 0.25, uNight);`,
      );
  };
  m.customProgramCacheKey = () => 'lm-bark-2';
  return m;
}

/**
 * Foliage lumps: procedural leaf colour + bumpy normals in world space,
 * leafy dithered silhouettes, sparkles, violet glow, backlit translucency.
 */
function makeFoliageMaterial(U, center, R) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.25 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uSunDir = U.uSunDir;
    sh.uniforms.uSunCol = U.uSunCol;
    sh.uniforms.uCenter = { value: center };
    sh.uniforms.uR = { value: R };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWPos;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
          // gentle canopy sway (outer parts move more)
          float out0 = clamp(length(wp0.xz - vec2(${center.x.toFixed(2)}, ${center.z.toFixed(2)})) / ${R.toFixed(2)}, 0.0, 1.2);
          float sw = sin(uTime * 0.6 + wp0.x * 0.05) * 0.18 + sin(uTime * 1.3 + wp0.z * 0.09) * 0.06;
          transformed.x += sw * out0;
          transformed.z += sw * 0.6 * out0;
          vTWPos = wp0.xyz;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTWPos; uniform float uNight; uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uCenter; uniform float uR;
        ${NOISE3_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float tLeaf = tN3(vTWPos * 1.7);
        float tFine = tN3(vTWPos * 4.3 + 11.0);
        float tTop = clamp((vTWPos.y - (uCenter.y - 7.0)) / 16.0, 0.0, 1.0);
        // the lumps are the shadowed inner mass: the leaf cards carry the bright leaves
        vec3 deep = vec3(0.08, 0.03, 0.22);
        vec3 lav = vec3(0.36, 0.21, 0.66);
        vec3 leafCol = mix(deep, lav, clamp(tLeaf * 0.65 + tTop * 0.5 - 0.2 + tFine * 0.2, 0.0, 1.0));
        diffuseColor.rgb = leafCol * vColor.rgb;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // leafy bumps: perturb the (view space) normal with world noise
          vec3 bump = vec3(tN3(vTWPos * 1.7 + 3.1), tN3(vTWPos * 1.7 - 7.7), tN3(vTWPos * 1.7 + 17.3)) - 0.5;
          normal = normalize(normal + mat3(viewMatrix) * bump * 0.7);
          // dithered leafy silhouette: discard noisy bits where the lump turns away
          float edgeV = 1.0 - abs(dot(normal, normalize(vViewPosition)));
          if (tFine < smoothstep(0.55, 0.98, edgeV) * 0.95) discard;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 glowCol = mix(vec3(0.3, 0.12, 0.85), vec3(0.75, 0.5, 1.0), tLeaf);
          totalEmissiveRadiance += glowCol * (0.35 + 0.65 * tTop * tLeaf) * mix(0.1, 0.42, uNight) * vColor.r;
          // sparkles: tiny bright points on a 3D grid, twinkling, fade out far away
          vec3 sc = vTWPos * 2.2;
          vec3 cid = floor(sc);
          float h = tH3(cid + 0.37);
          float d = length(fract(sc) - 0.5);
          float tw = 0.5 + 0.5 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
          float far = smoothstep(0.25, 0.9, fwidth(sc.x) + fwidth(sc.y));
          float spark = step(0.9, h) * smoothstep(0.32, 0.05, d) * tw * (1.0 - far);
          totalEmissiveRadiance += mix(vec3(0.9, 0.75, 1.0), vec3(0.6, 0.9, 1.0), step(0.96, h)) * spark * mix(0.9, 2.4, uNight);
          totalEmissiveRadiance += vec3(0.5, 0.35, 0.9) * far * 0.1 * mix(0.3, 1.0, uNight);
          // backlit translucency (looking towards the sun through thin edges)
          vec3 V = normalize(vViewPosition);
          vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float back = pow(max(dot(-V, L), 0.0), 4.0);
          // max(): |dot| can round above 1 where a lump faces the camera → pow(< 0) = NaN
          float thin = pow(max(1.0 - abs(dot(normal, V)), 0.0), 2.0);
          totalEmissiveRadiance += uSunCol * vec3(0.55, 0.38, 0.9) * back * thin * 0.12 * smoothstep(-0.05, 0.1, uSunDir.y);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'lm-foliage-1';
  return m;
}

/** Fringe leaf cards: alpha-tested clusters, canopy-shaped normals, glow, sway. */
function makeCardMaterial(U, center) {
  const m = new THREE.MeshStandardMaterial({ map: canopyLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uCenter = { value: center };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uCenter;\nvarying float vSpark;')
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = vec3(0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          vec3 lfPos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 wn = normalize((lfPos - uCenter) * vec3(1.0, 1.6, 1.0) + vec3(0.0, 3.0, 0.0));
          objectNormal = inverse(mat3(instanceMatrix)) * wn * dot(mat3(instanceMatrix)[0], mat3(instanceMatrix)[0]);
        #endif
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          vec3 ip = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float out0 = clamp(length(ip.xz - uCenter.xz) / 24.0, 0.0, 1.2);
          float sw = sin(uTime * 0.6 + ip.x * 0.05) * 0.18 + sin(uTime * 1.3 + ip.z * 0.09) * 0.06;
          float fl = sin(uTime * 2.3 + ip.x * 0.7 + ip.y) * 0.04;
          transformed.xy += vec2(fl, fl * 0.5);
          vSpark = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
          // sway is applied in world space after the instance transform (see project_vertex)
          transformed += (inverse(mat3(instanceMatrix)) * vec3(sw * out0, 0.0, sw * 0.6 * out0));
        }
        #else
          vSpark = 0.0;
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uTime;\nvarying float vSpark;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float tw = 0.6 + 0.4 * sin(uTime * (0.6 + vSpark) + vSpark * 40.0);
          vec3 glowCol = mix(vec3(0.36, 0.16, 0.9), vec3(0.8, 0.58, 1.0), vSpark);
          totalEmissiveRadiance += (diffuseColor.rgb * 0.85 + glowCol * 0.12) * mix(0.24, 0.66, uNight) * (0.8 + 0.2 * tw);
          // (a whole-card sparkle read as white blotches: the texture's buds + the lump sparkles twinkle instead)
        }`,
      );
  };
  m.customProgramCacheKey = () => 'lm-leafcard-2';
  return m;
}

/** Hanging glowing tendrils: strands of light beads, brighter towards the tip, sway. */
function makeTendrilMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uNight: U.uNight },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying float vT; varying vec3 vCol; varying float vPh;
      void main() {
        vec3 p = position;
        float t = -p.y; // 0 at the top, 1 at the tip
        vec4 w = instanceMatrix * vec4(p, 1.0);
        vec3 ip = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float ph = ip.x * 0.31 + ip.z * 0.17;
        w.x += sin(uTime * 0.9 + ph) * 0.4 * t * t;
        w.z += cos(uTime * 0.7 + ph) * 0.3 * t * t;
        vT = t; vPh = ph;
        vCol = instanceColor;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight; uniform float uTime;
      varying float vT; varying vec3 vCol; varying float vPh;
      void main() {
        float bead = smoothstep(0.7, 1.0, sin(vT * 46.0 - uTime * 1.6 + vPh * 5.0));
        float a = (0.18 + 0.5 * vT) * (0.35 + 1.2 * bead) * (1.0 - smoothstep(0.92, 1.0, vT) * 0.5);
        vec3 c = vCol * a * mix(0.5, 1.25, uNight);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
