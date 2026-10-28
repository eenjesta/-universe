import * as THREE from 'three';
import { rockGeometry } from '../world/terrain/rockgeo.js';

/**
 * Gathering particles + debris (pooled, no per-frame allocation):
 *   points (two THREE.Points: 'soft' alpha-blended — wood chips, leaves, dust, berries; 'glow'
 *   additive — sparks, crystal shards, motes, laser glints), CPU-integrated with gravity, drag,
 *   flutter and a terrain bounce;
 *   debris (instanced rock chunks + log pieces with tumbling rigid-body-ish motion, bounce, settle,
 *   sink) and an optional `magnet` (pieces fly to the player and call back on arrival).
 *
 *   fx.burst(kind, at, { n, dir, speed, spread, color, size, life, up })
 *   fx.debris('rock' | 'log', at, { n, dir, speed, scale, color, magnet: () => Vector3, onArrive(i) })
 *   fx.beam(from, to, on)   mining-laser beam (one at a time)
 *   fx.update(dt)
 */
const MAX_SOFT = 900;
const MAX_GLOW = 600;
const G = 9.8;

// particle shapes (aShape.y): 0 soft disc (dust, motes), 1 hard disc (berries, crumbs), 2 splinter
// (wood chips, bark, fibre, crystal shards — spinning), 3 leaf (spinning ellipse), 4 streak (sparks,
// embers: stretched along their screen-space velocity, aShape.z = stretch)
const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute vec3 aShape;
uniform float uPx;
varying vec4 vColor;
varying vec3 vShape;
void main() {
  vColor = aColor;
  vShape = aShape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(0.05, -mv.z);
  // never fill the screen: fade what is right in front of the lens
  vColor.a *= smoothstep(0.6, 1.8, d);
  gl_PointSize = clamp(aSize * uPx / d * max(1.0, aShape.z), 0.0, 96.0);
  gl_Position = projectionMatrix * mv;
}`;
const SHAPE = /* glsl */ `
float gthShape(vec2 c, vec3 sh) {
  float cs = cos(sh.x);
  float sn = sin(sh.x);
  vec2 q = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);
  float r = length(c);
  if (sh.y < 0.5) return 1.0 - smoothstep(0.3, 0.5, r);
  if (sh.y < 1.5) return 1.0 - smoothstep(0.36, 0.46, r);
  if (sh.y < 2.5) return (1.0 - smoothstep(0.4, 0.48, abs(q.x))) * (1.0 - smoothstep(0.1, 0.17, abs(q.y)));
  if (sh.y < 3.5) return 1.0 - smoothstep(0.8, 1.0, length(q / vec2(0.47, 0.24)));
  float w = 0.5 / max(1.0, sh.z);
  return (1.0 - smoothstep(w * 0.25, w, abs(q.y))) * (1.0 - smoothstep(0.2, 0.5, abs(q.x)));
}`;
const FRAG_SOFT = /* glsl */ `
varying vec4 vColor;
varying vec3 vShape;
${SHAPE}
void main() {
  float a = vColor.a * gthShape(gl_PointCoord - 0.5, vShape);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <colorspace_fragment>
}`;
const FRAG_GLOW = /* glsl */ `
varying vec4 vColor;
varying vec3 vShape;
${SHAPE}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float core = vShape.y < 0.5 ? pow(max(1.0 - length(c) * 2.0, 0.0), 2.0) : gthShape(c, vShape);
  float a = vColor.a * core;
  if (a < 0.005) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
  #include <colorspace_fragment>
}`;

function makePoints(name, max, frag, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 4);
  const size = new Float32Array(max);
  const shape = new Float32Array(max * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aShape', new THREE.BufferAttribute(shape, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    name,
    uniforms: { uPx: { value: 400 } },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = name;
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 12 : 11;
  // particle state (SoA)
  const st = {
    pts,
    geo,
    mat,
    max,
    n: 0,
    pos,
    col,
    size,
    shape,
    vel: new Float32Array(max * 3),
    life: new Float32Array(max),
    age: new Float32Array(max),
    base: new Float32Array(max * 4), // r g b a at birth
    size0: new Float32Array(max),
    grow: new Float32Array(max), // size growth per s (dust)
    drag: new Float32Array(max),
    grav: new Float32Array(max), // gravity multiplier
    flutter: new Float32Array(max),
    bounce: new Uint8Array(max),
    spin: new Float32Array(max), // rad/s (splinters, leaves)
    kind: new Uint8Array(max), // shape id
  };
  return st;
}

// particle presets: color [r, g, b] (linear, glow kinds HDR), alpha, size m, life s, gravity, drag, flutter, grow,
// shape (see VERT), spin (rad/s, random sign)
const KINDS = {
  chip: { soft: true, color: [0.66, 0.46, 0.26], a: 1, size: 0.075, life: 1.3, grav: 1, drag: 0.6, flutter: 0, grow: 0, bounce: 1, shape: 2, spin: 16 },
  bark: { soft: true, color: [0.26, 0.17, 0.1], a: 1, size: 0.065, life: 1.2, grav: 1, drag: 0.6, flutter: 0, grow: 0, bounce: 1, shape: 2, spin: 12 },
  leaf: { soft: true, color: [0.2, 0.36, 0.1], a: 1, size: 0.11, life: 3.2, grav: 0.12, drag: 2.2, flutter: 1.4, grow: 0, bounce: 0, shape: 3, spin: 3.5 },
  dust: { soft: true, color: [0.42, 0.37, 0.3], a: 0.2, size: 0.4, life: 1.5, grav: -0.04, drag: 2.4, flutter: 0, grow: 0.7, bounce: 0, shape: 0, spin: 0 },
  crumb: { soft: true, color: [0.5, 0.48, 0.45], a: 1, size: 0.06, life: 1.1, grav: 1, drag: 0.4, flutter: 0, grow: 0, bounce: 1, shape: 1, spin: 0 },
  berry: { soft: true, color: [0.75, 0.06, 0.1], a: 1, size: 0.07, life: 0.9, grav: 1, drag: 0.5, flutter: 0, grow: 0, bounce: 1, shape: 1, spin: 0 },
  fiber: { soft: true, color: [0.45, 0.62, 0.2], a: 1, size: 0.1, life: 1.4, grav: 0.35, drag: 1.6, flutter: 0.8, grow: 0, bounce: 0, shape: 2, spin: 6 },
  spark: { soft: false, color: [6.0, 3.4, 1.2], a: 1, size: 0.05, life: 0.42, grav: 1.2, drag: 0.8, flutter: 0, grow: 0, bounce: 1, shape: 4, spin: 0 },
  shard: { soft: false, color: [1.4, 4.2, 6.0], a: 1, size: 0.1, life: 0.9, grav: 0.9, drag: 0.6, flutter: 0, grow: 0, bounce: 1, shape: 2, spin: 14 },
  mote: { soft: false, color: [1.2, 3.6, 2.4], a: 0.9, size: 0.08, life: 1.6, grav: -0.18, drag: 1.4, flutter: 0.6, grow: 0, bounce: 0, shape: 0, spin: 0 },
  glint: { soft: false, color: [2.2, 5.0, 7.0], a: 1, size: 0.14, life: 0.16, grav: 0, drag: 3, flutter: 0, grow: 0.6, bounce: 0, shape: 0, spin: 0 },
  ember: { soft: false, color: [7.0, 2.6, 0.7], a: 1, size: 0.06, life: 0.55, grav: 0.6, drag: 1.0, flutter: 0.3, grow: 0, bounce: 1, shape: 4, spin: 0 },
  // a short bright bloom at an impact / a shattering crystal (one big soft glow point)
  flash: { soft: false, color: [3.0, 2.2, 1.4], a: 1, size: 0.5, life: 0.2, grav: 0, drag: 0, flutter: 0, grow: 3.0, bounce: 0, shape: 0, spin: 0 },
};

export function createFx(ctx) {
  const scene = ctx.world?.scene;
  const H = (x, z) => (ctx.world?.getHeightAt ? ctx.world.getHeightAt(x, z) : 0);
  const soft = makePoints('gather-fx-soft', MAX_SOFT, FRAG_SOFT, false);
  const glow = makePoints('gather-fx-glow', MAX_GLOW, FRAG_GLOW, true);
  scene?.add(soft.pts, glow.pts);
  const tmp = new THREE.Vector3();

  function emit(st, kind, x, y, z, vx, vy, vz, K, color, size, life) {
    if (st.n >= st.max) return;
    const i = st.n++;
    st.pos[i * 3] = x;
    st.pos[i * 3 + 1] = y;
    st.pos[i * 3 + 2] = z;
    st.vel[i * 3] = vx;
    st.vel[i * 3 + 1] = vy;
    st.vel[i * 3 + 2] = vz;
    st.life[i] = life;
    st.age[i] = 0;
    st.base[i * 4] = color[0];
    st.base[i * 4 + 1] = color[1];
    st.base[i * 4 + 2] = color[2];
    st.base[i * 4 + 3] = K.a;
    st.size0[i] = size;
    st.grow[i] = K.grow;
    st.drag[i] = K.drag;
    st.grav[i] = K.grav;
    st.flutter[i] = K.flutter * (0.6 + Math.random() * 0.8);
    st.bounce[i] = K.bounce;
    st.kind[i] = K.shape;
    st.spin[i] = K.spin ? K.spin * (0.5 + Math.random()) * (Math.random() < 0.5 ? -1 : 1) : 0;
    st.shape[i * 3] = Math.random() * 6.283;
    st.shape[i * 3 + 1] = K.shape;
    st.shape[i * 3 + 2] = 1;
  }

  const c3 = [0, 0, 0];
  /**
   * Spawns n particles of `kind` at `at` (Vector3-like) flying along `dir` (unit, optional) with
   * `speed` ± spread; `up` adds an upward bias; color overrides the preset (multiplied by 0.85–1.15).
   */
  function burst(kind, at, o = {}) {
    const K = KINDS[kind] || KINDS.chip;
    const st = K.soft ? soft : glow;
    const n = Math.min(o.n ?? 8, 120);
    const speed = o.speed ?? 3;
    const spread = o.spread ?? 0.8;
    const up = o.up ?? 0.6;
    const dx = o.dir?.x ?? 0;
    const dy = o.dir?.y ?? 0;
    const dz = o.dir?.z ?? 0;
    const base = o.color || K.color;
    const r = o.radius ?? 0;
    for (let k = 0; k < n; k++) {
      // random direction around dir (or a sphere when no dir)
      let rx = Math.random() * 2 - 1;
      let ry = Math.random() * 2 - 1;
      let rz = Math.random() * 2 - 1;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl;
      ry /= rl;
      rz /= rl;
      const s = speed * (0.45 + Math.random() * 0.9);
      const vx = (dx + rx * spread) * s;
      const vy = (dy + ry * spread * 0.6 + up) * s;
      const vz = (dz + rz * spread) * s;
      const v = 0.85 + Math.random() * 0.3;
      c3[0] = base[0] * v;
      c3[1] = base[1] * v;
      c3[2] = base[2] * v;
      const ox = r ? (Math.random() * 2 - 1) * r : 0;
      const oy = r ? Math.random() * r * 0.6 : 0;
      const oz = r ? (Math.random() * 2 - 1) * r : 0;
      emit(st, kind, at.x + ox, at.y + oy, at.z + oz, vx, vy, vz, K, c3, (o.size ?? K.size) * (0.7 + Math.random() * 0.6), (o.life ?? K.life) * (0.7 + Math.random() * 0.6));
    }
  }

  /** Dust puffs along a segment a → b (felled trunk, rock break). */
  function dustLine(a, b, n = 12, color, size = 0.9) {
    for (let k = 0; k < n; k++) {
      const t = (k + Math.random()) / n;
      tmp.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      burst('dust', tmp, { n: 1, speed: 1.2, spread: 1, up: 0.4, color, size });
    }
  }

  const _pv = new THREE.Matrix4();
  /** Screen-space angle + stretch of a streak particle (velocity projected with the camera). */
  function streak(st, i, e) {
    const o = i * 3;
    const x = st.pos[o];
    const y = st.pos[o + 1];
    const z = st.pos[o + 2];
    const vx = st.vel[o];
    const vy = st.vel[o + 1];
    const vz = st.vel[o + 2];
    const w0 = e[3] * x + e[7] * y + e[11] * z + e[15];
    const x2 = x + vx * 0.035;
    const y2 = y + vy * 0.035;
    const z2 = z + vz * 0.035;
    const w1 = e[3] * x2 + e[7] * y2 + e[11] * z2 + e[15];
    if (!(w0 > 0.05) || !(w1 > 0.05)) return;
    const ax = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w0;
    const ay = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w0;
    const bx = (e[0] * x2 + e[4] * y2 + e[8] * z2 + e[12]) / w1;
    const by = (e[1] * x2 + e[5] * y2 + e[9] * z2 + e[13]) / w1;
    const dx = (bx - ax) * aspect;
    const dy = by - ay;
    const l = Math.hypot(dx, dy);
    // gl_PointCoord's y runs down the screen
    st.shape[o] = l > 1e-6 ? Math.atan2(dy, dx) : st.shape[o];
    st.shape[o + 2] = 1 + Math.min(3.5, l * 60);
  }
  let aspect = 1;

  function step(st, dt, t, e) {
    let n = st.n;
    for (let i = 0; i < n; i++) {
      const age = (st.age[i] += dt);
      if (age >= st.life[i]) {
        // swap-remove
        n--;
        if (i !== n) {
          for (let k = 0; k < 3; k++) {
            st.pos[i * 3 + k] = st.pos[n * 3 + k];
            st.vel[i * 3 + k] = st.vel[n * 3 + k];
          }
          for (let k = 0; k < 4; k++) st.base[i * 4 + k] = st.base[n * 4 + k];
          st.life[i] = st.life[n];
          st.age[i] = st.age[n];
          st.size0[i] = st.size0[n];
          st.grow[i] = st.grow[n];
          st.drag[i] = st.drag[n];
          st.grav[i] = st.grav[n];
          st.flutter[i] = st.flutter[n];
          st.bounce[i] = st.bounce[n];
          st.spin[i] = st.spin[n];
          st.kind[i] = st.kind[n];
          for (let k = 0; k < 3; k++) st.shape[i * 3 + k] = st.shape[n * 3 + k];
          i--;
        }
        continue;
      }
      const o = i * 3;
      const drag = Math.max(0, 1 - st.drag[i] * dt);
      st.vel[o] *= drag;
      st.vel[o + 1] = st.vel[o + 1] * drag - G * st.grav[i] * dt;
      st.vel[o + 2] *= drag;
      const fl = st.flutter[i];
      if (fl > 0) {
        st.vel[o] += Math.sin(t * 5.3 + i * 1.7) * fl * dt * 3;
        st.vel[o + 2] += Math.cos(t * 4.1 + i * 2.3) * fl * dt * 3;
      }
      st.pos[o] += st.vel[o] * dt;
      st.pos[o + 1] += st.vel[o + 1] * dt;
      st.pos[o + 2] += st.vel[o + 2] * dt;
      let grounded = false;
      if (st.bounce[i] || st.grav[i] > 0.05) {
        const g = H(st.pos[o], st.pos[o + 2]) + 0.02;
        grounded = st.pos[o + 1] < g + 0.03;
        if (st.pos[o + 1] < g) {
          st.pos[o + 1] = g;
          if (st.bounce[i] && st.vel[o + 1] < -0.6) {
            st.vel[o + 1] *= -0.3;
            st.vel[o] *= 0.5;
            st.vel[o + 2] *= 0.5;
          } else {
            st.vel[o + 1] = 0;
            st.vel[o] *= 0.8;
            st.vel[o + 2] *= 0.8;
          }
        }
      }
      // colour / alpha / size over life
      const k = age / st.life[i];
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      st.col[i * 4] = st.base[i * 4];
      st.col[i * 4 + 1] = st.base[i * 4 + 1];
      st.col[i * 4 + 2] = st.base[i * 4 + 2];
      st.col[i * 4 + 3] = st.base[i * 4 + 3] * fade;
      st.size[i] = st.size0[i] * (1 + st.grow[i] * age);
      if (st.kind[i] === 4) {
        if (e) streak(st, i, e);
      } else if (st.spin[i] !== 0) st.shape[i * 3] += st.spin[i] * dt * (grounded ? 0.08 : 1);
    }
    st.n = n;
    st.geo.setDrawRange(0, n);
    if (n > 0) {
      const p = st.geo.attributes.position;
      p.clearUpdateRanges();
      p.addUpdateRange(0, n * 3);
      p.needsUpdate = true;
      const c = st.geo.attributes.aColor;
      c.clearUpdateRanges();
      c.addUpdateRange(0, n * 4);
      c.needsUpdate = true;
      const s = st.geo.attributes.aSize;
      s.clearUpdateRanges();
      s.addUpdateRange(0, n);
      s.needsUpdate = true;
      const sh = st.geo.attributes.aShape;
      sh.clearUpdateRanges();
      sh.addUpdateRange(0, n * 3);
      sh.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- debris (instanced chunks + logs)
  const DEB = 72;
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.9, metalness: 0, name: 'gather-debris-rock' });
  const rockGeo = rockGeometry('gather-debris', { size: [1, 0.75, 0.9], detail: 1, cuts: 4, bump: 0.25 });
  const logGeo = (() => {
    const side = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateZ(Math.PI / 2);
    const cap = new THREE.CircleGeometry(1, 10);
    const capA = cap.clone().rotateY(Math.PI / 2).translate(0.5, 0, 0);
    const capB = cap.clone().rotateY(-Math.PI / 2).translate(-0.5, 0, 0);
    const parts = [side, capA, capB].map((g) => {
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      return g.index ? g.toNonIndexed() : g;
    });
    const cols = [
      [0.3, 0.2, 0.13],
      [0.82, 0.62, 0.4],
      [0.82, 0.62, 0.4],
    ];
    parts.forEach((g, i) => {
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) c.set(cols[i], k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    });
    const out = new THREE.BufferGeometry();
    let total = 0;
    for (const g of parts) total += g.attributes.position.count;
    const P = new Float32Array(total * 3);
    const N = new Float32Array(total * 3);
    const C = new Float32Array(total * 3);
    let off = 0;
    for (const g of parts) {
      P.set(g.attributes.position.array, off * 3);
      N.set(g.attributes.normal.array, off * 3);
      C.set(g.attributes.color.array, off * 3);
      off += g.attributes.position.count;
    }
    out.setAttribute('position', new THREE.BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    out.setAttribute('color', new THREE.BufferAttribute(C, 3));
    out.computeBoundingSphere();
    return out;
  })();
  const logMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, name: 'gather-debris-log' });

  function debrisSet(geo, mat, name) {
    const m = new THREE.InstancedMesh(geo, mat, DEB);
    m.name = name;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEB * 3).fill(1), 3);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    scene?.add(m);
    return {
      mesh: m,
      n: 0,
      p: new Float32Array(DEB * 3),
      v: new Float32Array(DEB * 3),
      q: Array.from({ length: DEB }, () => new THREE.Quaternion()),
      w: new Float32Array(DEB * 3),
      s: new Float32Array(DEB * 3), // scale xyz
      age: new Float32Array(DEB),
      life: new Float32Array(DEB),
      rest: new Float32Array(DEB),
      mag: new Array(DEB).fill(null), // { target: () => Vector3, delay, onArrive }
    };
  }
  const rocks = debrisSet(rockGeo, rockMat, 'gather-debris-rocks');
  const logs = debrisSet(logGeo, logMat, 'gather-debris-logs');
  const _dq = new THREE.Quaternion();
  const _dv = new THREE.Vector3();
  const _dm = new THREE.Matrix4();
  const _ds = new THREE.Vector3();
  const _dp = new THREE.Vector3();
  const _col = new THREE.Color();

  /**
   * Debris pieces: kind 'rock' | 'log'. o: { n, dir, speed, up, scale ([x, y, z] or number), color (Color-like
   * or [r,g,b]), life, along: [a, b] (spawn spread along a segment, logs), axis: Vector3 (log axis),
   * magnet: () => Vector3 (fly to that point after `delay` s), onArrive(index) }.
   */
  function debris(kind, at, o = {}) {
    const D = kind === 'log' ? logs : rocks;
    const n = Math.min(o.n ?? 6, 24);
    const ids = [];
    for (let k = 0; k < n; k++) {
      if (D.n >= DEB) break;
      const i = D.n++;
      const t = n > 1 ? k / (n - 1) : 0.5;
      let x = at.x;
      let y = at.y;
      let z = at.z;
      if (o.along) {
        x = o.along[0].x + (o.along[1].x - o.along[0].x) * t;
        y = o.along[0].y + (o.along[1].y - o.along[0].y) * t;
        z = o.along[0].z + (o.along[1].z - o.along[0].z) * t;
      }
      D.p[i * 3] = x;
      D.p[i * 3 + 1] = y;
      D.p[i * 3 + 2] = z;
      const sp = (o.speed ?? 3) * (0.5 + Math.random() * 0.8);
      const ang = Math.random() * Math.PI * 2;
      D.v[i * 3] = (o.dir?.x ?? 0) * sp + Math.cos(ang) * sp * (o.spread ?? 0.6);
      D.v[i * 3 + 1] = (o.up ?? 0.7) * sp + Math.random() * sp * 0.4;
      D.v[i * 3 + 2] = (o.dir?.z ?? 0) * sp + Math.sin(ang) * sp * (o.spread ?? 0.6);
      if (o.axis && kind === 'log') {
        // log lies along the given axis
        _dv.set(1, 0, 0);
        D.q[i].setFromUnitVectors(_dv, o.axis);
      } else D.q[i].setFromAxisAngle(_dv.set(Math.random(), Math.random(), Math.random()).normalize(), Math.random() * 6);
      const w = o.spin ?? 7;
      D.w[i * 3] = (Math.random() - 0.5) * w;
      D.w[i * 3 + 1] = (Math.random() - 0.5) * w;
      D.w[i * 3 + 2] = (Math.random() - 0.5) * w;
      const sc = o.scale ?? 0.25;
      const jitter = 0.7 + Math.random() * 0.6;
      if (Array.isArray(sc)) {
        D.s[i * 3] = sc[0] * jitter;
        D.s[i * 3 + 1] = sc[1] * jitter;
        D.s[i * 3 + 2] = sc[2] * jitter;
      } else D.s[i * 3] = D.s[i * 3 + 1] = D.s[i * 3 + 2] = sc * jitter;
      D.age[i] = 0;
      D.life[i] = (o.life ?? 3.5) * (0.85 + Math.random() * 0.3);
      D.rest[i] = 0;
      D.mag[i] = o.magnet ? { target: o.magnet, delay: (o.delay ?? 0.9) + k * 0.12, onArrive: o.onArrive || null, k } : null;
      const c = o.color;
      if (c) {
        if (Array.isArray(c)) _col.setRGB(c[0], c[1], c[2]);
        else _col.copy(c);
        const v = 0.85 + Math.random() * 0.3;
        D.mesh.instanceColor.setXYZ(i, _col.r * v, _col.g * v, _col.b * v);
      } else D.mesh.instanceColor.setXYZ(i, 1, 1, 1);
      ids.push(i);
    }
    D.mesh.instanceColor.needsUpdate = true;
    return ids;
  }

  function stepDebris(D, dt) {
    let n = D.n;
    for (let i = 0; i < n; i++) {
      D.age[i] += dt;
      const mg = D.mag[i];
      let dead = D.age[i] >= D.life[i];
      if (mg && D.age[i] > mg.delay) {
        // fly to the target (the player's chest), accelerating; arrive → callback + gone
        const tg = mg.target();
        if (tg) {
          const o = i * 3;
          _dv.set(tg.x - D.p[o], tg.y - D.p[o + 1], tg.z - D.p[o + 2]);
          const d = _dv.length();
          const sp = 4 + (D.age[i] - mg.delay) * 26;
          if (d < 0.45 || d < sp * dt) {
            dead = true;
            try {
              mg.onArrive?.(mg.k);
            } catch (err) {
              console.warn('[gather] debris arrive failed', err);
            }
          } else {
            _dv.multiplyScalar(1 / d);
            D.v[o] = _dv.x * sp;
            D.v[o + 1] = _dv.y * sp;
            D.v[o + 2] = _dv.z * sp;
            D.p[o] += D.v[o] * dt;
            D.p[o + 1] += D.v[o + 1] * dt;
            D.p[o + 2] += D.v[o + 2] * dt;
            const shrink = Math.max(0.3, Math.min(1, d / 2.5));
            D.s[o] *= 1 - (1 - shrink) * dt * 3;
            D.s[o + 1] *= 1 - (1 - shrink) * dt * 3;
            D.s[o + 2] *= 1 - (1 - shrink) * dt * 3;
          }
          if (!dead) {
            writeDebris(D, i);
            continue;
          }
        }
      }
      if (dead) {
        n--;
        if (i !== n) {
          for (let k = 0; k < 3; k++) {
            D.p[i * 3 + k] = D.p[n * 3 + k];
            D.v[i * 3 + k] = D.v[n * 3 + k];
            D.w[i * 3 + k] = D.w[n * 3 + k];
            D.s[i * 3 + k] = D.s[n * 3 + k];
          }
          D.q[i].copy(D.q[n]);
          D.age[i] = D.age[n];
          D.life[i] = D.life[n];
          D.rest[i] = D.rest[n];
          D.mag[i] = D.mag[n];
          D.mesh.instanceColor.setXYZ(i, D.mesh.instanceColor.getX(n), D.mesh.instanceColor.getY(n), D.mesh.instanceColor.getZ(n));
          D.mesh.instanceColor.needsUpdate = true;
          i--;
        }
        D.mag[n] = null;
        continue;
      }
      const o = i * 3;
      if (D.rest[i] < 1) {
        D.v[o + 1] -= G * dt;
        D.p[o] += D.v[o] * dt;
        D.p[o + 1] += D.v[o + 1] * dt;
        D.p[o + 2] += D.v[o + 2] * dt;
        const g = H(D.p[o], D.p[o + 2]) + D.s[o + 1] * 0.45;
        if (D.p[o + 1] < g) {
          D.p[o + 1] = g;
          if (D.v[o + 1] < -1.2) {
            D.v[o + 1] *= -0.32;
            D.v[o] *= 0.55;
            D.v[o + 2] *= 0.55;
            for (let k = 0; k < 3; k++) D.w[o + k] *= 0.6;
          } else {
            D.v[o] *= 0.85;
            D.v[o + 2] *= 0.85;
            D.v[o + 1] = 0;
            for (let k = 0; k < 3; k++) D.w[o + k] *= 0.8;
            if (Math.abs(D.v[o]) + Math.abs(D.v[o + 2]) < 0.15) D.rest[i] = 1;
          }
        }
        const wl = Math.hypot(D.w[o], D.w[o + 1], D.w[o + 2]);
        if (wl > 0.01) {
          _dq.setFromAxisAngle(_dv.set(D.w[o] / wl, D.w[o + 1] / wl, D.w[o + 2] / wl), wl * dt);
          D.q[i].premultiply(_dq);
        }
      } else if (!mg && D.life[i] - D.age[i] < 0.8) {
        // settle, then sink into the ground
        D.p[o + 1] -= dt * 0.35 * Math.max(0.2, D.s[o + 1]);
      }
      writeDebris(D, i);
    }
    D.n = n;
    D.mesh.count = n;
    if (n) D.mesh.instanceMatrix.needsUpdate = true;
  }

  function writeDebris(D, i) {
    const o = i * 3;
    _dm.compose(_dp.set(D.p[o], D.p[o + 1], D.p[o + 2]), D.q[i], _ds.set(D.s[o], D.s[o + 1], D.s[o + 2]));
    D.mesh.setMatrixAt(i, _dm);
  }

  // ---------------------------------------------------------------- mining laser beam
  const beamGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3.6, 5.0), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, name: 'gather-beam' });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.name = 'gather-beam';
  beam.visible = false;
  beam.frustumCulled = false;
  beam.renderOrder = 13;
  scene?.add(beam);
  let beamT = 0;
  function setBeam(from, to, on = true) {
    if (!on || !from || !to) {
      beam.visible = false;
      return;
    }
    const d = from.distanceTo(to);
    if (!(d > 0.05)) {
      beam.visible = false;
      return;
    }
    beam.position.copy(from);
    beam.lookAt(to);
    beam.scale.set(1, 1, d);
    beam.visible = true;
    beamT = 0.18;
  }

  let time = 0;
  function update(dt, camera) {
    time += dt;
    const cam = camera || ctx.camera;
    // pixels per metre at 1 m: drawing-buffer height / 2 × projection[1][1]
    const r = ctx.engine?.renderer;
    if (cam && r) {
      const h = r.getDrawingBufferSize ? r.domElement.height : 720;
      const px = h * 0.5 * cam.projectionMatrix.elements[5];
      soft.mat.uniforms.uPx.value = px;
      glow.mat.uniforms.uPx.value = px;
      aspect = r.domElement.width / Math.max(1, h);
    }
    let e = null;
    if (cam && glow.n) {
      cam.updateMatrixWorld();
      _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      e = _pv.elements;
    }
    step(soft, dt, time, null);
    step(glow, dt, time, e);
    stepDebris(rocks, dt);
    stepDebris(logs, dt);
    if (beam.visible) {
      beamT -= dt;
      beamMat.opacity = 0.55 + 0.35 * Math.sin(time * 60);
      if (beamT <= 0) beam.visible = false;
    }
  }

  function clear() {
    soft.n = glow.n = 0;
    rocks.n = logs.n = 0;
    rocks.mesh.count = logs.mesh.count = 0;
    beam.visible = false;
  }

  return {
    burst,
    dustLine,
    debris,
    beam: setBeam,
    update,
    clear,
    stats: () => ({ soft: soft.n, glow: glow.n, rocks: rocks.n, logs: logs.n }),
    dispose() {
      for (const o of [soft, glow]) {
        scene?.remove(o.pts);
        o.geo.dispose();
        o.mat.dispose();
      }
      for (const D of [rocks, logs]) {
        scene?.remove(D.mesh);
        D.mesh.dispose();
      }
      rockGeo.dispose();
      logGeo.dispose();
      rockMat.dispose();
      logMat.dispose();
      scene?.remove(beam);
      beamGeo.dispose();
      beamMat.dispose();
    },
  };
}
