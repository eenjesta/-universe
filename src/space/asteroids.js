import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise } from '../core/noise.js';
import { mulberry32 } from '../core/math.js';
import { SPACE } from './layout.js';
import { SUN_DIR } from './sky.js';

/**
 * Asteroid field: ≥1500 instanced rocks from five deformed variants (dark
 * rocky PBR with vertex-colour grime, a warm sun-side rim + cool fresnel),
 * slow GPU tumble (per-instance axis/speed, no CPU matrix updates), a few
 * large hero rocks, and a camera-wrapped cloud of small debris for parallax.
 * Collision queries use a uniform grid over bounding spheres.
 *
 *   field.collideSphere(pos, radius) → {depth, normal, index} | null
 *   field.segmentHit(a, b, pad) → t in [0, 1] | -1
 *   field.density(pos) → 0..1     field.update(dt, t, camera)
 */

const VARIANTS = 5;
const CELL = 320;

function rockGeometry(seed, detail, { stretch = [1, 1, 1], rough = 0.35, craters = 6 } = {}) {
  const noise = createNoise(`rock-${seed}`);
  const rng = mulberry32(seed * 977 + 13);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const P = g.attributes.position;
  const cr = [];
  for (let i = 0; i < craters; i++) {
    const c = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    cr.push([c, 0.18 + rng() * 0.35, 0.05 + rng() * 0.1]);
  }
  const col = new Float32Array(P.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i).normalize();
    let d = 1;
    d += noise.n3(p.x * 1.1 + seed, p.y * 1.1, p.z * 1.1) * rough;
    d += noise.n3(p.x * 2.6, p.y * 2.6 + seed, p.z * 2.6) * rough * 0.4;
    d += Math.abs(noise.n3(p.x * 6, p.y * 6, p.z * 6 + seed)) * rough * 0.18;
    d -= Math.abs(noise.n3(p.x * 13, p.y * 13, p.z * 13 + seed)) * rough * 0.09;
    let dark = 0;
    for (const [c, rad, depth] of cr) {
      const a = p.angleTo(c);
      if (a < rad * 1.25) {
        const k = a / rad;
        if (k < 1) {
          d -= depth * (1 - k * k);
          dark += 0.35 * (1 - k);
        } else d += depth * 0.35 * (1 - (k - 1) / 0.25);
      }
    }
    p.multiplyScalar(d);
    p.set(p.x * stretch[0], p.y * stretch[1], p.z * stretch[2]);
    P.setXYZ(i, p.x, p.y, p.z);
    const n = noise.n3(p.x * 3.5 + 7, p.y * 3.5, p.z * 3.5) * 0.5 + 0.5;
    const v = (0.5 + n * 0.45) * (1 - Math.min(0.5, dark)) * Math.min(1.1, Math.max(0.55, 0.75 + (d - 1) * 1.4));
    const warm = noise.n3(p.x * 1.3, p.y * 1.3 + 4, p.z * 1.3) * 0.5 + 0.5;
    col[i * 3] = v * (0.96 + warm * 0.06);
    col[i * 3 + 1] = v * (0.94 + warm * 0.02);
    col[i * 3 + 2] = v * 0.92;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Shared rock material: vertex colours + instance tint, rim light, optional GPU tumble / camera wrap. */
function rockMaterial(uniforms, { tumble = true, wrap = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x403f3e, roughness: 0.88, metalness: 0.12 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        ${wrap ? 'uniform vec3 uCam; uniform float uHalf; uniform float uDensity; attribute float aKeep;' : ''}
        ${tumble ? 'attribute vec4 aSpin;' : ''}
        mat3 spinMat(vec3 ax, float a) {
          float l = length(ax);
          vec3 k = l > 1e-5 ? ax / l : vec3(0.0, 1.0, 0.0);
          float c = cos(a), s = sin(a), t = 1.0 - c;
          return mat3(t*k.x*k.x + c, t*k.x*k.y + s*k.z, t*k.x*k.z - s*k.y,
                      t*k.x*k.y - s*k.z, t*k.y*k.y + c, t*k.y*k.z + s*k.x,
                      t*k.x*k.z + s*k.y, t*k.y*k.z - s*k.x, t*k.z*k.z + c);
        }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        ${tumble ? 'mat3 spinM = spinMat(aSpin.xyz, aSpin.w * uTime); objectNormal = spinM * objectNormal;' : 'mat3 spinM = mat3(1.0);'}`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed = spinM * transformed;');
    if (wrap) {
      sh.vertexShader = sh.vertexShader.replace(
        '#include <project_vertex>',
        `vec3 base = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vec3 rel = mod(base - uCam + uHalf, 2.0 * uHalf) - uHalf;
        float dist = length(rel);
        float keep = step(aKeep, uDensity);
        float fade = (1.0 - smoothstep(uHalf * 0.6, uHalf * 0.95, dist)) * keep;
        vec3 wp = uCam + rel + mat3(instanceMatrix) * transformed * fade;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;`,
      );
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uRimWarm; uniform vec3 uRimCool;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec3 rimV = vViewPosition / max(length(vViewPosition), 1e-4);
        float rimF = 1.0 - clamp(dot(normal, rimV), 0.0, 1.0);
        rimF = rimF * rimF * rimF;
        float sunF = clamp(dot(normal, uSunView) * 0.6 + 0.4, 0.0, 1.0);
        totalEmissiveRadiance += rimF * (uRimWarm * sunF * sunF + uRimCool) * diffuseColor.rgb * 3.0;`,
      );
  };
  m.customProgramCacheKey = () => `space-rock-${tumble ? 1 : 0}${wrap ? 1 : 0}`;
  return m;
}

export function createAsteroidField(ctx, { quality }) {
  const lowQ = quality.id === 'low';
  const rng = mulberry32(31337);
  const group = new THREE.Group();
  group.name = 'space-asteroids';
  const uniforms = {
    uTime: { value: 0 },
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
    uRimWarm: { value: new THREE.Color(1.0, 0.62, 0.36).multiplyScalar(0.9) },
    uRimCool: { value: new THREE.Color(0.25, 0.32, 0.55).multiplyScalar(0.12) },
    uCam: { value: new THREE.Vector3() },
    uHalf: { value: 420 },
    uDensity: { value: 1 },
  };

  // ---------------------------------------------------------- placement
  const rocks = []; // [x, y, z, r]
  const tooClose = (x, y, z, r) => {
    for (const [p, rad] of SPACE.keepOut) {
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      if (dx * dx + dy * dy + dz * dz < (rad + r) * (rad + r)) return true;
    }
    return false;
  };
  const tryAdd = (x, y, z, r) => {
    if (tooClose(x, y, z, r)) return false;
    rocks.push([x, y, z, r]);
    return true;
  };
  // framing rocks around the arrival point (poster composition: big rocks left/right of the ship)
  {
    const sp = SPACE.spawn.position;
    const frame = [
      [-170, -35, -250, 42], [-330, 70, -520, 64], [-520, -120, -380, 30], [-260, 160, -860, 52],
      [200, -75, -320, 36], [400, 95, -690, 74], [620, -60, -540, 40], [150, -170, -460, 20],
      [-80, 135, -610, 16], [90, 210, -980, 34], [-640, 40, -1100, 80], [760, 240, -1250, 58],
      [-120, -230, -760, 26], [300, -260, -900, 30], [-420, -260, -640, 22], [520, 300, -420, 18],
    ];
    for (const [x, y, z, r] of frame) rocks.push([sp.x + x, sp.y + y, sp.z + z, r]);
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2;
      const rr = 160 + rng() * 900;
      const x = sp.x + Math.cos(a) * rr * 1.2;
      const y = sp.y + Math.sin(a) * rr * 0.5;
      const z = sp.z - 200 - rng() * 1600;
      if (Math.abs(x - sp.x) < 70 && Math.abs(y - sp.y) < 50) continue;
      rocks.push([x, y, z, 3 + 14 * Math.pow(rng(), 2)]);
    }
  }
  // main cluster (ellipsoid, denser toward the middle)
  const F = SPACE.field;
  for (let n = 0, guard = 0; n < 940 && guard < 20000; guard++) {
    const u = rng() * 2 - 1;
    const v = rng() * 2 - 1;
    const w = rng() * 2 - 1;
    const d2 = u * u + v * v + w * w;
    if (d2 > 1 || rng() > Math.pow(1 - d2, 0.8)) continue;
    const r = 7 + 78 * Math.pow(rng(), 3.2);
    if (tryAdd(F.center.x + u * F.radii.x, F.center.y + v * F.radii.y, F.center.z + w * F.radii.z, r)) n++;
  }
  // Northern Rings: tilted concentric bands
  const R = SPACE.rings;
  const tiltM = new THREE.Matrix4().makeRotationFromEuler(R.tilt);
  const tmp = new THREE.Vector3();
  for (let n = 0, guard = 0; n < 460 && guard < 20000; guard++) {
    const band = R.radii[Math.floor(rng() * R.radii.length)];
    const a = rng() * Math.PI * 2;
    if (Math.sin(a * 3 + band) < -0.55) continue; // arcs with gaps
    const rr = band + (rng() - 0.5) * 320;
    tmp.set(Math.cos(a) * rr, (rng() - 0.5) * 160, Math.sin(a) * rr).applyMatrix4(tiltM).add(R.center);
    const r = 5 + 40 * Math.pow(rng(), 3);
    if (tryAdd(tmp.x, tmp.y, tmp.z, r)) n++;
  }
  // scattered rocks across the region
  for (let n = 0, guard = 0; n < 260 && guard < 20000; guard++) {
    const x = (rng() * 2 - 1) * 9500;
    const y = (rng() * 2 - 1) * 2600;
    const z = -11000 + rng() * 16000;
    const r = 10 + 90 * Math.pow(rng(), 3);
    if (tryAdd(x, y, z, r)) n++;
  }
  const instancedCount = rocks.length;

  // ---------------------------------------------------------- instanced variants
  const detail = lowQ ? 2 : 3;
  const shapes = [
    { stretch: [1.25, 0.85, 1.0], rough: 0.32 },
    { stretch: [1.0, 1.0, 1.0], rough: 0.42 },
    { stretch: [1.5, 0.75, 0.9], rough: 0.3 },
    { stretch: [0.95, 0.9, 1.2], rough: 0.5, craters: 9 },
    { stretch: [1.15, 1.05, 0.8], rough: 0.38 },
  ];
  const mat = rockMaterial(uniforms, { tumble: true });
  const meshes = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  for (let k = 0; k < VARIANTS; k++) {
    const geo = rockGeometry(k + 1, detail, shapes[k]);
    const idx = [];
    for (let i = k; i < instancedCount; i += VARIANTS) idx.push(i);
    const spin = new Float32Array(idx.length * 4);
    const mesh = new THREE.InstancedMesh(geo, mat, idx.length);
    idx.forEach((ri, j) => {
      const [x, y, z, r] = rocks[ri];
      pos.set(x, y, z);
      e.set(rng() * 6.28, rng() * 6.28, rng() * 6.28);
      q.setFromEuler(e);
      const k2 = r * (0.85 + rng() * 0.3);
      s.set(k2, k2 * (0.8 + rng() * 0.4), k2);
      m4.compose(pos, q, s);
      mesh.setMatrixAt(j, m4);
      const g = 0.6 + rng() * 0.55;
      const warm = rng();
      c.setRGB(g * (0.97 + warm * 0.06), g * (0.96 + warm * 0.02), g * 0.95);
      mesh.setColorAt(j, c);
      spin.set([rng() - 0.5, rng() - 0.5, rng() - 0.5, (0.02 + rng() * 0.12) * (90 / (r + 30))], j * 4);
    });
    geo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = `asteroids-${k}`;
    group.add(mesh);
    meshes.push(mesh);
  }

  // ---------------------------------------------------------- hero rocks
  const heroMat = rockMaterial(uniforms, { tumble: false });
  const heroes = [];
  SPACE.heroRocks.forEach(([x, y, z, r], i) => {
    const geo = rockGeometry(40 + i, lowQ ? 8 : 18, { stretch: [1.3 - (i % 3) * 0.12, 0.8 + (i % 2) * 0.15, 1.05], rough: 0.4, craters: 12 });
    const mesh = new THREE.Mesh(geo, heroMat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(r);
    mesh.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    mesh.userData.spin = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.006);
    mesh.name = `hero-rock-${i}`;
    group.add(mesh);
    heroes.push(mesh);
    rocks.push([x, y, z, r]);
  });

  // ---------------------------------------------------------- near debris (camera wrapped)
  const dCount = lowQ ? 120 : 280;
  const dGeo = rockGeometry(99, 1, { rough: 0.45 });
  const keep = new Float32Array(dCount);
  const dSpin = new Float32Array(dCount * 4);
  const debris = new THREE.InstancedMesh(dGeo, rockMaterial(uniforms, { tumble: true, wrap: true }), dCount);
  const half = uniforms.uHalf.value;
  for (let i = 0; i < dCount; i++) {
    pos.set((rng() * 2 - 1) * half, (rng() * 2 - 1) * half, (rng() * 2 - 1) * half);
    e.set(rng() * 6, rng() * 6, rng() * 6);
    q.setFromEuler(e);
    const k2 = 0.4 + Math.pow(rng(), 2.5) * 4.5;
    s.set(k2, k2 * (0.7 + rng() * 0.5), k2 * (0.8 + rng() * 0.6));
    m4.compose(pos, q, s);
    debris.setMatrixAt(i, m4);
    const g = 0.6 + rng() * 0.5;
    debris.setColorAt(i, c.setRGB(g, g * 0.95, g * 0.9));
    keep[i] = rng();
    dSpin.set([rng() - 0.5, rng() - 0.5, rng() - 0.5, 0.2 + rng() * 0.8], i * 4);
  }
  dGeo.setAttribute('aKeep', new THREE.InstancedBufferAttribute(keep, 1));
  dGeo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(dSpin, 4));
  debris.frustumCulled = false;
  debris.name = 'asteroid-debris';
  group.add(debris);

  // ---------------------------------------------------------- collision grid
  const N = rocks.length;
  const RX = new Float32Array(N);
  const RY = new Float32Array(N);
  const RZ = new Float32Array(N);
  const RR = new Float32Array(N);
  const grid = new Map();
  const key = (ix, iy, iz) => ix * 73856093 + iy * 19349663 + iz * 83492791;
  rocks.forEach(([x, y, z, r], i) => {
    const cr = i >= instancedCount ? r * 0.9 : r * 0.82;
    RX[i] = x;
    RY[i] = y;
    RZ[i] = z;
    RR[i] = cr;
    const x0 = Math.floor((x - cr) / CELL);
    const x1 = Math.floor((x + cr) / CELL);
    const y0 = Math.floor((y - cr) / CELL);
    const y1 = Math.floor((y + cr) / CELL);
    const z0 = Math.floor((z - cr) / CELL);
    const z1 = Math.floor((z + cr) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++) {
          const k = key(ix, iy, iz);
          let list = grid.get(k);
          if (!list) grid.set(k, (list = []));
          list.push(i);
        }
  });

  const hit = { depth: 0, normal: new THREE.Vector3(), index: -1, radius: 0, center: new THREE.Vector3() };
  let stamp = 0;
  const seen = new Uint32Array(N);

  function collideSphere(p, r) {
    let best = null;
    stamp++;
    const x0 = Math.floor((p.x - r) / CELL);
    const x1 = Math.floor((p.x + r) / CELL);
    const y0 = Math.floor((p.y - r) / CELL);
    const y1 = Math.floor((p.y + r) / CELL);
    const z0 = Math.floor((p.z - r) / CELL);
    const z1 = Math.floor((p.z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++) {
          const list = grid.get(key(ix, iy, iz));
          if (!list) continue;
          for (const i of list) {
            if (seen[i] === stamp) continue;
            seen[i] = stamp;
            const dx = p.x - RX[i];
            const dy = p.y - RY[i];
            const dz = p.z - RZ[i];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const depth = r + RR[i] - d;
            if (depth > 0 && (!best || depth > hit.depth)) {
              best = hit;
              hit.depth = depth;
              if (d > 1e-4) hit.normal.set(dx / d, dy / d, dz / d);
              else hit.normal.set(0, 1, 0);
              hit.index = i;
              hit.radius = RR[i];
              hit.center.set(RX[i], RY[i], RZ[i]);
            }
          }
        }
    return best;
  }

  /** First hit of segment a→b (inflated by pad) with any rock: t ∈ [0, 1], or −1. */
  function segmentHit(a, b, pad = 0) {
    stamp++;
    let bestT = 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-8) return -1;
    const steps = Math.max(1, Math.ceil(Math.sqrt(len2) / (CELL * 0.5)));
    for (let sI = 0; sI <= steps; sI++) {
      const f = sI / steps;
      const ix = Math.floor((a.x + dx * f) / CELL);
      const iy = Math.floor((a.y + dy * f) / CELL);
      const iz = Math.floor((a.z + dz * f) / CELL);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++)
          for (let oz = -1; oz <= 1; oz++) {
            const list = grid.get(key(ix + ox, iy + oy, iz + oz));
            if (!list) continue;
            for (const i of list) {
              if (seen[i] === stamp) continue;
              seen[i] = stamp;
              // ray-sphere
              const fx = a.x - RX[i];
              const fy = a.y - RY[i];
              const fz = a.z - RZ[i];
              const rr = RR[i] + pad;
              const B = fx * dx + fy * dy + fz * dz;
              const C = fx * fx + fy * fy + fz * fz - rr * rr;
              if (C < 0) return 0;
              const disc = B * B - len2 * C;
              if (disc < 0) continue;
              const t = (-B - Math.sqrt(disc)) / len2;
              if (t >= 0 && t <= 1 && t < bestT) bestT = t;
            }
          }
    }
    return bestT <= 1 ? bestT : -1;
  }

  const tiltInv = tiltM.clone().invert();
  function density(p) {
    const f = SPACE.field;
    const u = (p.x - f.center.x) / f.radii.x;
    const v = (p.y - f.center.y) / f.radii.y;
    const w = (p.z - f.center.z) / f.radii.z;
    const d1 = Math.max(0, 1 - Math.sqrt(u * u + v * v + w * w) * 0.92);
    tmp.copy(p).sub(R.center).applyMatrix4(tiltInv);
    const rad = Math.hypot(tmp.x, tmp.z);
    let d2 = 0;
    for (const b of R.radii) d2 = Math.max(d2, 1 - Math.abs(rad - b) / 260);
    d2 *= Math.max(0, 1 - Math.abs(tmp.y) / 220);
    return Math.min(1, Math.max(d1 * 1.5, d2, 0.12));
  }

  const sunView = new THREE.Vector3();
  let dens = 1;
  return {
    group,
    meshes,
    heroes,
    debris,
    count: instancedCount + heroes.length,
    rocks: { x: RX, y: RY, z: RZ, r: RR, count: N },
    collideSphere,
    segmentHit,
    density,
    update(dt, t, camera) {
      uniforms.uTime.value = t;
      sunView.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
      uniforms.uSunView.value.copy(sunView);
      uniforms.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      dens += (density(uniforms.uCam.value) - dens) * Math.min(1, dt * 2);
      uniforms.uDensity.value = dens;
      for (const h of heroes) {
        h.rotation.x += h.userData.spin.x * dt;
        h.rotation.y += h.userData.spin.y * dt;
        h.rotation.z += h.userData.spin.z * dt;
      }
    },
    dispose() {
      group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      mat.dispose();
      heroMat.dispose();
      debris.material.dispose();
    },
  };
}
