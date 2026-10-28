/**
 * Combat effects — every layer is one draw call, pooled, no per-frame allocations:
 *   ribbons  camera-facing streaks: energy bolts, enemy lasers, railgun beams,
 *            spark streaks, electric arcs (additive, HDR → bloom)
 *   glows    billboards: muzzle flashes / star flares, impact glows, fireballs,
 *            shock rings (camera-facing or flat on the ground) (additive)
 *   smoke    soft alpha puffs (dust, smoke)
 *   debris   tumbling metal chunks (InstancedMesh, lit)
 *   light    one shared PointLight for flashes (medium/high quality only)
 *
 *   fx.bolt(a, b, color, {speed, len, width, core, impact, normal})   a/b = Vector3-like
 *   fx.beam(a, b, color, width, life)      fx.arc(a, b, color, life, jitter)
 *   fx.muzzle(pos, dir, color, scale)      fx.impact(pos, normal, color, kind)
 *   fx.sparks(pos, dir, n, color, speed, spread, life)
 *   fx.glow(pos, color, size0, size1, life, shape, alpha)   fx.smoke(pos, size0, size1, life, shade, alpha, vel)
 *   fx.explosion(pos, kind, radius)        fx.debris(pos, n, speed)
 *   fx.flashLight(pos, color, intensity, range)   fx.update(dt)   fx.stats()
 * Colours are linear [r, g, b] (multiplied to HDR inside).
 */
import * as THREE from 'three';

const MAX_R = 720;
const MAX_G = 220;
const MAX_S = 72;
const MAX_D = 80;

const R_BOLT = 0;
const R_SPARK = 1;
const R_BEAM = 2;
const R_ARC = 3;

const IMPACT_NONE = 0;
const IMPACT_TERRAIN = 1;
const IMPACT_ENEMY = 2;
const IMPACT_WATER = 3;
const IMPACT_PLAYER = 4;
const IMPACT_KINDS = { terrain: IMPACT_TERRAIN, enemy: IMPACT_ENEMY, water: IMPACT_WATER, player: IMPACT_PLAYER };

const RIBBON_VS = /* glsl */ `
  attribute vec2 corner;
  attribute vec3 aA;
  attribute vec3 aB;
  attribute vec4 aCol;
  attribute vec2 aW;
  varying vec2 vC;
  varying vec4 vCol;
  void main() {
    vec3 axis = aB - aA;
    float len = length(axis);
    vec3 dir = len > 1e-5 ? axis / len : vec3(0.0, 1.0, 0.0);
    vec3 p = mix(aA, aB, corner.y);
    vec3 sd = cross(dir, cameraPosition - p);
    float sl = length(sd);
    sd = sl > 1e-6 ? sd / sl : vec3(1.0, 0.0, 0.0);
    float w = mix(aW.x, aW.y, corner.y);
    p += dir * (corner.y * 2.0 - 1.0) * w * 0.6;
    p += sd * corner.x * w;
    vC = corner;
    vCol = aCol;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const RIBBON_FS = /* glsl */ `
  varying vec2 vC;
  varying vec4 vCol;
  void main() {
    float s = abs(vC.x);
    float core = exp(-s * s * 16.0);
    float glow = exp(-s * s * 3.2);
    float along = smoothstep(0.0, 0.3, vC.y) * (1.0 - smoothstep(0.86, 1.0, vC.y));
    vec3 c = (vCol.rgb * (glow * 0.55 + core * 0.9) + vec3(core * core) * vCol.a) * along;
    if (max(c.r, max(c.g, c.b)) < 0.002) discard;
    gl_FragColor = vec4(min(c, vec3(40.0)), 1.0);
  }
`;
const GLOW_VS = /* glsl */ `
  attribute vec2 corner;
  attribute vec3 aPos;
  attribute vec4 aCol;
  attribute vec4 aP; // size, shape, rotation, ring thickness
  varying vec2 vC;
  varying vec4 vCol;
  varying vec2 vS;
  void main() {
    vC = corner;
    vCol = aCol;
    vS = aP.yw;
    if (aP.y > 2.5) {
      vec3 wp = aPos + vec3(corner.x * aP.x, 0.0, corner.y * aP.x);
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    } else {
      vec4 mv = viewMatrix * vec4(aPos, 1.0);
      float c = cos(aP.z);
      float s = sin(aP.z);
      mv.xy += vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * aP.x;
      gl_Position = projectionMatrix * mv;
    }
  }
`;
const GLOW_FS = /* glsl */ `
  varying vec2 vC;
  varying vec4 vCol;
  varying vec2 vS;
  void main() {
    float r2 = dot(vC, vC);
    if (r2 > 1.0) discard;
    float a;
    if (vS.x < 0.5) {
      a = exp(-r2 * 4.5) + exp(-r2 * 28.0) * 0.8;
    } else if (vS.x < 1.5 || vS.x > 2.5) {
      float r = sqrt(r2);
      float d = (r - 0.8) / max(vS.y, 0.01);
      a = exp(-d * d) * (1.0 - smoothstep(0.9, 1.0, r));
    } else {
      float sx = max(0.0, 1.0 - abs(vC.x) * 9.0) * exp(-vC.y * vC.y * 5.0);
      float sy = max(0.0, 1.0 - abs(vC.y) * 9.0) * exp(-vC.x * vC.x * 5.0);
      a = exp(-r2 * 7.0) + (sx + sy) * 0.7;
    }
    vec3 c = vCol.rgb * a * vCol.a;
    if (max(c.r, max(c.g, c.b)) < 0.002) discard;
    gl_FragColor = vec4(min(c, vec3(60.0)), 1.0);
  }
`;
const SMOKE_VS = /* glsl */ `
  attribute vec2 corner;
  attribute vec3 aPos;
  attribute vec4 aCol;
  attribute vec2 aP; // size, rotation
  varying vec2 vC;
  varying vec4 vCol;
  void main() {
    vC = corner;
    vCol = aCol;
    vec4 mv = viewMatrix * vec4(aPos, 1.0);
    float c = cos(aP.y);
    float s = sin(aP.y);
    mv.xy += vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * aP.x;
    gl_Position = projectionMatrix * mv;
  }
`;
const SMOKE_FS = /* glsl */ `
  uniform sampler2D uTex;
  varying vec2 vC;
  varying vec4 vCol;
  void main() {
    vec4 t = texture2D(uTex, vC * 0.5 + 0.5);
    float a = t.a * vCol.a;
    if (a < 0.008) discard;
    gl_FragColor = vec4(vCol.rgb * (0.55 + 0.45 * t.r), a);
  }
`;

function quadGeometry(maxInstances, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const out = {};
  for (const [name, size, corner] of attrs) {
    if (corner) {
      g.setAttribute(name, new THREE.Float32BufferAttribute(corner, 2));
      continue;
    }
    const a = new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    out[name] = a;
  }
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return { geo: g, attr: out };
}

function smokeTexture() {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  // value noise (2 octaves) inside a soft disc
  const rnd = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const vnoise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi, yi);
    const b = rnd(xi + 1, yi);
    const c = rnd(xi, yi + 1);
    const d = rnd(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = (x + 0.5) / N * 2 - 1;
      const py = (y + 0.5) / N * 2 - 1;
      const r = Math.sqrt(px * px + py * py);
      const n = vnoise(x / 9, y / 9) * 0.65 + vnoise(x / 4.5 + 7, y / 4.5 + 3) * 0.35;
      const disc = Math.max(0, 1 - r);
      const a = Math.max(0, Math.min(1, disc * disc * (0.55 + n * 0.9)));
      const shade = Math.max(0, Math.min(1, 0.6 + (py * 0.25 - px * 0.15) + (n - 0.5) * 0.5));
      const i = (y * N + x) * 4;
      data[i] = Math.round(shade * 255);
      data[i + 1] = data[i];
      data[i + 2] = data[i];
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const rand = (a, b) => a + (b - a) * Math.random();

export function createFx(ctx) {
  const scene = ctx.world.scene;
  const getH = ctx.world.getHeightAt ? (x, z) => ctx.world.getHeightAt(x, z) : () => 0;
  const waterLevel = ctx.world.waterLevel ?? 0;
  const lowQ = () => (ctx.engine?.quality?.id || 'high') === 'low';
  const CORNERS = [-1, 0, 1, 0, 1, 1, -1, 1];
  const QUAD = [-1, -1, 1, -1, 1, 1, -1, 1];

  // ------------------------------------------------------------- ribbons
  const rq = quadGeometry(MAX_R, [['corner', 2, CORNERS], ['aA', 3], ['aB', 3], ['aCol', 4], ['aW', 2]]);
  const rMat = new THREE.ShaderMaterial({
    name: 'cbt-ribbons',
    vertexShader: RIBBON_VS,
    fragmentShader: RIBBON_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const rMesh = new THREE.Mesh(rq.geo, rMat);
  rMesh.frustumCulled = false;
  rMesh.renderOrder = 6;
  rMesh.name = 'cbt-fx-ribbons';
  scene.add(rMesh);
  const R = [];
  const rFree = [];
  for (let i = 0; i < MAX_R; i++) {
    R.push({ idx: i, on: false, type: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, px: 0, py: 0, pz: 0, dx: 0, dy: 0, dz: 0, vx: 0, vy: 0, vz: 0, speed: 0, len: 0, dist: 0, total: 0, life: 0, max: 1, w0: 0, w1: 0, r: 0, g: 0, b: 0, core: 0, impact: 0, nx: 0, ny: 1, nz: 0, arrived: false, floor: -1e9, grav: 1 });
    rFree.push(MAX_R - 1 - i);
  }
  const rActive = [];
  function takeR() {
    if (!rFree.length) {
      // recycle the oldest active ribbon
      const old = rActive.shift();
      if (!old) return null;
      rActive.push(old);
      return old;
    }
    const o = R[rFree.pop()];
    rActive.push(o);
    return o;
  }

  // --------------------------------------------------------------- glows
  const gq = quadGeometry(MAX_G, [['corner', 2, QUAD], ['aPos', 3], ['aCol', 4], ['aP', 4]]);
  const gMat = new THREE.ShaderMaterial({
    name: 'cbt-glows',
    vertexShader: GLOW_VS,
    fragmentShader: GLOW_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const gMesh = new THREE.Mesh(gq.geo, gMat);
  gMesh.frustumCulled = false;
  gMesh.renderOrder = 5;
  gMesh.name = 'cbt-fx-glows';
  scene.add(gMesh);
  const G = [];
  const gFree = [];
  for (let i = 0; i < MAX_G; i++) {
    G.push({ idx: i, on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, r: 0, g: 0, b: 0, a: 1, life: 0, max: 1, shape: 0, rot: 0, rotV: 0, th: 0.2, fade: 1 });
    gFree.push(MAX_G - 1 - i);
  }
  const gActive = [];
  function takeG() {
    if (!gFree.length) {
      const old = gActive.shift();
      if (old) gActive.push(old);
      return old || null;
    }
    const o = G[gFree.pop()];
    gActive.push(o);
    return o;
  }

  // --------------------------------------------------------------- smoke
  const sq = quadGeometry(MAX_S, [['corner', 2, QUAD], ['aPos', 3], ['aCol', 4], ['aP', 2]]);
  const sMat = new THREE.ShaderMaterial({
    name: 'cbt-smoke',
    vertexShader: SMOKE_VS,
    fragmentShader: SMOKE_FS,
    uniforms: { uTex: { value: smokeTexture() } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sMesh = new THREE.Mesh(sq.geo, sMat);
  sMesh.frustumCulled = false;
  sMesh.renderOrder = 4;
  sMesh.name = 'cbt-fx-smoke';
  scene.add(sMesh);
  const S = [];
  const sFree = [];
  for (let i = 0; i < MAX_S; i++) {
    S.push({ idx: i, on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, r: 0.3, g: 0.3, b: 0.3, a: 0.5, life: 0, max: 1, rot: 0, rotV: 0 });
    sFree.push(MAX_S - 1 - i);
  }
  const sActive = [];
  function takeS() {
    if (!sFree.length) {
      const old = sActive.shift();
      if (old) sActive.push(old);
      return old || null;
    }
    const o = S[sFree.pop()];
    sActive.push(o);
    return o;
  }

  // -------------------------------------------------------------- debris
  const dGeo = new THREE.DodecahedronGeometry(0.1, 0);
  const dMat = new THREE.MeshStandardMaterial({ name: 'cbt-debris', color: 0xffffff, metalness: 0.5, roughness: 0.5 });
  const dMesh = new THREE.InstancedMesh(dGeo, dMat, MAX_D);
  dMesh.name = 'cbt-fx-debris';
  dMesh.frustumCulled = false;
  dMesh.castShadow = false;
  dMesh.count = 0;
  dMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const DARK = new THREE.Color(0x2b2e35);
  const LIGHT = new THREE.Color(0x9ea4ad);
  for (let i = 0; i < MAX_D; i++) dMesh.setColorAt(i, DARK);
  scene.add(dMesh);
  const D = [];
  for (let i = 0; i < MAX_D; i++) D.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, qx: 0, qy: 0, qz: 0, wx: 0, wy: 0, wz: 0, s: 1, life: 0, max: 1, light: false });
  let dNext = 0;
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();

  const camP = new THREE.Vector3(); // camera world position, refreshed in update()

  // --------------------------------------------------------------- light
  let light = null;
  let lightI = 0;
  let lightMax = 0;
  if (!lowQ()) {
    light = new THREE.PointLight(0x8ac8ff, 0, 18, 2);
    light.name = 'cbt-flash-light';
    light.castShadow = false;
    scene.add(light);
  }

  // ------------------------------------------------------------ spawners
  function bolt(a, b, color, { speed = 220, len = 2.5, width = 0.07, core = 3, intensity = 5, impact = 'terrain', normal = null } = {}) {
    const o = takeR();
    if (!o) return;
    o.on = true;
    o.type = R_BOLT;
    o.ax = a.x;
    o.ay = a.y;
    o.az = a.z;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dz = b.z - a.z;
    const total = Math.hypot(dx, dy, dz);
    if (total < 1e-4) {
      dx = 0;
      dy = 0;
      dz = -1;
    } else {
      dx /= total;
      dy /= total;
      dz /= total;
    }
    o.dx = dx;
    o.dy = dy;
    o.dz = dz;
    o.total = Math.max(0.01, total);
    o.speed = speed;
    o.len = len;
    o.dist = 0;
    o.arrived = false;
    o.w0 = width * 0.45;
    o.w1 = width;
    o.r = color[0] * intensity;
    o.g = color[1] * intensity;
    o.b = color[2] * intensity;
    o.core = core;
    o.impact = typeof impact === 'number' ? impact : IMPACT_KINDS[impact] || IMPACT_NONE;
    o.nx = normal ? normal.x : -dx;
    o.ny = normal ? normal.y : -dy;
    o.nz = normal ? normal.z : -dz;
    o.life = 1;
    o.max = 1;
  }

  function beam(a, b, color, width = 0.1, life = 0.3, intensity = 6) {
    const o = takeR();
    if (!o) return;
    o.on = true;
    o.type = R_BEAM;
    o.ax = a.x;
    o.ay = a.y;
    o.az = a.z;
    o.bx = b.x;
    o.by = b.y;
    o.bz = b.z;
    o.w0 = width;
    o.w1 = width;
    o.r = color[0] * intensity;
    o.g = color[1] * intensity;
    o.b = color[2] * intensity;
    o.core = 4;
    o.life = life;
    o.max = life;
  }

  function sparkAt(x, y, z, vx, vy, vz, color, life, width, intensity, grav = 1) {
    const o = takeR();
    if (!o) return;
    o.on = true;
    o.type = R_SPARK;
    o.px = x;
    o.py = y;
    o.pz = z;
    o.vx = vx;
    o.vy = vy;
    o.vz = vz;
    o.life = life;
    o.max = life;
    o.w0 = width * 0.4;
    o.w1 = width;
    o.r = color[0] * intensity;
    o.g = color[1] * intensity;
    o.b = color[2] * intensity;
    o.core = 1.2;
    o.grav = grav;
    o.floor = getH(x, z) - 0.05;
  }

  function sparks(pos, dir, n, color, speed = 8, spread = 0.6, life = 0.45, width = 0.03, intensity = 5) {
    if (lowQ()) n = Math.ceil(n * 0.5);
    for (let i = 0; i < n; i++) {
      let vx = dir.x + rand(-spread, spread);
      let vy = dir.y + rand(-spread, spread) + 0.15;
      let vz = dir.z + rand(-spread, spread);
      const l = Math.hypot(vx, vy, vz) || 1;
      const sp = speed * rand(0.35, 1.1);
      vx = (vx / l) * sp;
      vy = (vy / l) * sp;
      vz = (vz / l) * sp;
      sparkAt(pos.x, pos.y, pos.z, vx, vy, vz, color, life * rand(0.5, 1.2), width, intensity);
    }
  }

  function arc(a, b, color, life = 0.12, jitter = 0.25, segs = 6, intensity = 6, width = 0.035) {
    let px = a.x;
    let py = a.y;
    let pz = a.z;
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const j = i === segs ? 0 : jitter;
      const nx = a.x + (b.x - a.x) * f + rand(-j, j);
      const ny = a.y + (b.y - a.y) * f + rand(-j, j);
      const nz = a.z + (b.z - a.z) * f + rand(-j, j);
      const o = takeR();
      if (!o) return;
      o.on = true;
      o.type = R_ARC;
      o.ax = px;
      o.ay = py;
      o.az = pz;
      o.bx = nx;
      o.by = ny;
      o.bz = nz;
      o.w0 = width;
      o.w1 = width;
      o.r = color[0] * intensity;
      o.g = color[1] * intensity;
      o.b = color[2] * intensity;
      o.core = 3;
      o.life = life;
      o.max = life;
      px = nx;
      py = ny;
      pz = nz;
    }
  }

  function glow(pos, color, s0, s1, life, shape = 0, alpha = 1, intensity = 4, vel = null, thickness = 0.12, fade = 1) {
    const o = takeG();
    if (!o) return null;
    // close to the camera (the own muzzle ~1.5 m away, point-blank impacts): smaller + dimmer,
    // otherwise HDR + bloom whites out a large part of the screen
    const dc = Math.hypot(pos.x - camP.x, pos.y - camP.y, pos.z - camP.z);
    if (dc < 5.1) {
      const near = Math.max(0.3, (dc - 0.6) / 4.5);
      s0 *= near;
      s1 *= near;
      intensity *= 0.5 + 0.5 * near;
    }
    o.on = true;
    o.x = pos.x;
    o.y = pos.y;
    o.z = pos.z;
    o.vx = vel ? vel.x : 0;
    o.vy = vel ? vel.y : 0;
    o.vz = vel ? vel.z : 0;
    o.s0 = s0;
    o.s1 = s1;
    o.r = color[0] * intensity;
    o.g = color[1] * intensity;
    o.b = color[2] * intensity;
    o.a = alpha;
    o.life = life;
    o.max = life;
    o.shape = shape;
    o.rot = Math.random() * Math.PI;
    o.rotV = shape === 2 ? 0 : rand(-1, 1);
    o.th = thickness;
    o.fade = fade;
    return o;
  }

  function smoke(pos, s0, s1, life, shade = [0.3, 0.3, 0.32], alpha = 0.5, vel = null) {
    if (lowQ() && Math.random() < 0.4) return;
    const o = takeS();
    if (!o) return;
    const day = 0.35 + 0.65 * (ctx.world.dayFactor ?? 1);
    o.on = true;
    o.x = pos.x;
    o.y = pos.y;
    o.z = pos.z;
    o.vx = vel ? vel.x : rand(-0.3, 0.3);
    o.vy = vel ? vel.y : rand(0.4, 1.0);
    o.vz = vel ? vel.z : rand(-0.3, 0.3);
    o.s0 = s0;
    o.s1 = s1;
    o.r = shade[0] * day;
    o.g = shade[1] * day;
    o.b = shade[2] * day;
    o.a = alpha;
    o.life = life;
    o.max = life;
    o.rot = Math.random() * Math.PI * 2;
    o.rotV = rand(-0.6, 0.6);
  }

  function debris(pos, n = 8, speed = 7, lightShare = 0.35) {
    for (let i = 0; i < n; i++) {
      const o = D[dNext];
      dNext = (dNext + 1) % MAX_D;
      o.on = true;
      o.x = pos.x + rand(-0.3, 0.3);
      o.y = pos.y + rand(-0.2, 0.3);
      o.z = pos.z + rand(-0.3, 0.3);
      const a = Math.random() * Math.PI * 2;
      const up = rand(0.3, 1);
      const sp = speed * rand(0.4, 1);
      o.vx = Math.cos(a) * sp * (1 - up * 0.4);
      o.vz = Math.sin(a) * sp * (1 - up * 0.4);
      o.vy = up * sp;
      o.qx = Math.random() * 6;
      o.qy = Math.random() * 6;
      o.qz = Math.random() * 6;
      o.wx = rand(-9, 9);
      o.wy = rand(-9, 9);
      o.wz = rand(-9, 9);
      o.s = rand(0.6, 1.7);
      o.life = rand(2.2, 3.4);
      o.max = o.life;
      o.light = Math.random() < lightShare;
    }
  }

  function flashLight(pos, color, intensity = 40, range = 14) {
    if (!light) return;
    if (intensity < lightI * 0.6) return;
    light.position.set(pos.x, pos.y, pos.z);
    light.color.setRGB(color[0], color[1], color[2]);
    light.distance = range;
    lightI = intensity;
    lightMax = intensity;
    light.intensity = intensity;
  }

  // -------------------------------------------------------- composites
  const _p = { x: 0, y: 0, z: 0 };
  const WHITE = [1, 1, 1];
  const DUST = [0.42, 0.38, 0.33];
  function muzzle(pos, dir, color, scale = 0.6) {
    // glow() shrinks + dims flashes near the camera (the own muzzle sits ~1.5 m from the shoulder camera)
    glow(pos, color, 0.55 * scale, 0.9 * scale, 0.07, 2, 1, 7);
    glow(pos, WHITE, 0.25 * scale, 0.3 * scale, 0.05, 0, 1, 6);
    _p.x = pos.x + dir.x * 0.18 * scale;
    _p.y = pos.y + dir.y * 0.18 * scale;
    _p.z = pos.z + dir.z * 0.18 * scale;
    glow(_p, color, 0.35 * scale, 0.6 * scale, 0.09, 0, 0.9, 4);
    sparks(pos, dir, 3, color, 6, 0.35, 0.12, 0.018, 5);
    flashLight(pos, color, 14 * scale, 7);
  }

  function impact(pos, normal, color, kind = 'terrain') {
    const n = normal || { x: 0, y: 1, z: 0 };
    if (kind === 'water') {
      sparks(pos, { x: 0, y: 1, z: 0 }, 8, [0.75, 0.85, 1], 5, 0.4, 0.5, 0.025, 2.5);
      smoke(pos, 0.3, 1.4, 0.8, [0.8, 0.85, 0.9], 0.35, { x: 0, y: 0.8, z: 0 });
      glow(pos, color, 0.3, 0.8, 0.12, 0, 0.8, 3);
      return;
    }
    glow(pos, color, 0.35, 0.75, 0.12, 0, 1, 5);
    glow(pos, WHITE, 0.12, 0.2, 0.06, 0, 1, 6);
    if (kind === 'enemy') {
      sparks(pos, n, 9, color, 7, 0.75, 0.35, 0.025, 6);
      sparks(pos, n, 4, [1, 0.62, 0.3], 5, 0.8, 0.4, 0.02, 5);
    } else if (kind === 'player') {
      glow(pos, [0.4, 0.8, 1], 0.3, 0.7, 0.16, 1, 0.55, 2.5, null, 0.1);
      sparks(pos, n, 5, color, 4, 0.8, 0.3, 0.02, 4);
    } else {
      sparks(pos, n, 7, [1, 0.7, 0.4], 6, 0.7, 0.4, 0.022, 4);
      sparks(pos, n, 4, color, 5, 0.6, 0.25, 0.02, 5);
      smoke(pos, 0.25, 1.1, 0.9, DUST, 0.42, { x: n.x * 0.6, y: 0.6 + n.y * 0.4, z: n.z * 0.6 });
    }
    flashLight(pos, color, 9, 6);
  }

  const SHOCK = [0.35, 0.78, 1];
  const FIRE = [1, 0.5, 0.18];
  const _a = { x: 0, y: 0, z: 0 };
  const _b = { x: 0, y: 0, z: 0 };
  function explosion(pos, kind = 'fire', radius = 4) {
    const gy = getH(pos.x, pos.z);
    if (kind === 'shock') {
      glow(pos, SHOCK, radius * 0.4, radius * 1.4, 0.32, 0, 1, 6);
      glow(pos, WHITE, radius * 0.2, radius * 0.5, 0.14, 0, 1, 8);
      glow(pos, SHOCK, radius * 0.25, radius * 1.15, 0.45, 1, 1, 5, null, 0.09);
      _a.x = pos.x;
      _a.y = Math.max(gy, waterLevel) + 0.08;
      _a.z = pos.z;
      glow(_a, SHOCK, radius * 0.2, radius * 1.05, 0.55, 3, 1, 4, null, 0.07);
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const el = rand(-0.3, 0.9);
        const l = radius * rand(0.4, 0.95);
        _b.x = pos.x + Math.cos(a) * Math.cos(el) * l;
        _b.y = pos.y + Math.sin(el) * l * 0.6;
        _b.z = pos.z + Math.sin(a) * Math.cos(el) * l;
        if (_b.y < gy + 0.05) _b.y = gy + 0.05;
        arc(pos, _b, SHOCK, rand(0.1, 0.22), l * 0.12, 6, 7, 0.04);
      }
      sparks(pos, { x: 0, y: 0.6, z: 0 }, 26, SHOCK, 11, 1, 0.6, 0.03, 6);
      smoke(pos, radius * 0.3, radius * 0.9, 1.4, [0.25, 0.3, 0.38], 0.38);
      flashLight(pos, SHOCK, 420, radius * 4);
      return;
    }
    // fire / drone burst
    glow(pos, FIRE, radius * 0.35, radius * 1.1, 0.35, 0, 1, 7);
    glow(pos, [1, 0.85, 0.6], radius * 0.2, radius * 0.5, 0.16, 0, 1, 9);
    glow(pos, [1, 0.6, 0.3], radius * 0.2, radius * 1.2, 0.4, 1, 0.8, 3, null, 0.1);
    for (let i = 0; i < 5; i++) {
      _a.x = pos.x + rand(-0.6, 0.6) * radius * 0.3;
      _a.y = pos.y + rand(-0.3, 0.6) * radius * 0.3;
      _a.z = pos.z + rand(-0.6, 0.6) * radius * 0.3;
      _b.x = rand(-1, 1);
      _b.y = rand(0.6, 2);
      _b.z = rand(-1, 1);
      glow(_a, FIRE, radius * 0.25, radius * 0.6, rand(0.4, 0.75), 0, 0.85, 3.5, _b);
    }
    sparks(pos, { x: 0, y: 0.8, z: 0 }, 30, [1, 0.62, 0.25], 13, 1, 0.9, 0.035, 6);
    for (let i = 0; i < 4; i++) {
      _a.x = pos.x + rand(-0.5, 0.5);
      _a.y = pos.y + rand(0, 0.6);
      _a.z = pos.z + rand(-0.5, 0.5);
      smoke(_a, radius * 0.35, radius * 1.1, rand(1.6, 2.6), [0.13, 0.12, 0.12], 0.6, { x: rand(-0.4, 0.4), y: rand(0.8, 1.6), z: rand(-0.4, 0.4) });
    }
    flashLight(pos, FIRE, 380, radius * 5);
  }

  // ------------------------------------------------------------- update
  function writeRibbon(i, o, ax, ay, az, bx, by, bz, k) {
    const A = rq.attr.aA.array;
    const B = rq.attr.aB.array;
    const C = rq.attr.aCol.array;
    const W = rq.attr.aW.array;
    A[i * 3] = ax;
    A[i * 3 + 1] = ay;
    A[i * 3 + 2] = az;
    B[i * 3] = bx;
    B[i * 3 + 1] = by;
    B[i * 3 + 2] = bz;
    C[i * 4] = o.r * k;
    C[i * 4 + 1] = o.g * k;
    C[i * 4 + 2] = o.b * k;
    C[i * 4 + 3] = o.core * k;
    W[i * 2] = o.w0;
    W[i * 2 + 1] = o.w1;
  }

  const _n = { x: 0, y: 1, z: 0 };
  const _col = [1, 1, 1];
  function update(dt) {
    ctx.camera.getWorldPosition(camP);
    // ribbons
    let n = 0;
    for (let i = rActive.length - 1; i >= 0; i--) {
      const o = rActive[i];
      let alive = true;
      if (o.type === R_BOLT) {
        o.dist += o.speed * dt;
        const head = Math.min(o.dist, o.total);
        if (!o.arrived && o.dist >= o.total) {
          o.arrived = true;
          if (o.impact) {
            _p.x = o.ax + o.dx * o.total;
            _p.y = o.ay + o.dy * o.total;
            _p.z = o.az + o.dz * o.total;
            _n.x = o.nx;
            _n.y = o.ny;
            _n.z = o.nz;
            const col = _col;
            col[0] = o.r / 5;
            col[1] = o.g / 5;
            col[2] = o.b / 5;
            impact(_p, _n, col, o.impact === IMPACT_ENEMY ? 'enemy' : o.impact === IMPACT_WATER ? 'water' : o.impact === IMPACT_PLAYER ? 'player' : 'terrain');
          }
        }
        const tail = Math.max(0, Math.min(head, o.dist - o.len));
        if (tail >= o.total - 1e-3) alive = false;
        else if (n < MAX_R) {
          writeRibbon(n++, o, o.ax + o.dx * tail, o.ay + o.dy * tail, o.az + o.dz * tail, o.ax + o.dx * head, o.ay + o.dy * head, o.az + o.dz * head, 1);
        }
      } else if (o.type === R_SPARK) {
        o.life -= dt;
        if (o.life <= 0) alive = false;
        else {
          o.vy -= 9.8 * o.grav * dt;
          const drag = Math.max(0, 1 - 2.2 * dt);
          o.vx *= drag;
          o.vy *= drag;
          o.vz *= drag;
          o.px += o.vx * dt;
          o.py += o.vy * dt;
          o.pz += o.vz * dt;
          if (o.py < o.floor) {
            o.py = o.floor;
            o.vy = Math.abs(o.vy) * 0.3;
            o.vx *= 0.6;
            o.vz *= 0.6;
          }
          const k = o.life / o.max;
          if (n < MAX_R) writeRibbon(n++, o, o.px - o.vx * 0.028, o.py - o.vy * 0.028, o.pz - o.vz * 0.028, o.px, o.py, o.pz, k * k);
        }
      } else {
        o.life -= dt;
        if (o.life <= 0) alive = false;
        else if (n < MAX_R) {
          const t = o.life / o.max;
          let k = o.type === R_BEAM ? t * t : t * (0.55 + 0.45 * Math.random());
          if (o.type === R_BEAM) {
            o.w0 = o.w1 = Math.max(0.01, o.w1 * (1 - dt * 2.5));
          }
          writeRibbon(n++, o, o.ax, o.ay, o.az, o.bx, o.by, o.bz, k);
        }
      }
      if (!alive) {
        o.on = false;
        rActive.splice(i, 1);
        rFree.push(o.idx);
      }
    }
    rq.geo.instanceCount = n;
    if (n) for (const k of ['aA', 'aB', 'aCol', 'aW']) {
      const a = rq.attr[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }

    // glows
    let m = 0;
    const GP = gq.attr.aPos.array;
    const GC = gq.attr.aCol.array;
    const GA = gq.attr.aP.array;
    for (let i = gActive.length - 1; i >= 0; i--) {
      const o = gActive[i];
      o.life -= dt;
      if (o.life <= 0) {
        o.on = false;
        gActive.splice(i, 1);
        gFree.push(o.idx);
        continue;
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.z += o.vz * dt;
      o.rot += o.rotV * dt;
      const t = 1 - o.life / o.max;
      const e = 1 - (1 - t) * (1 - t);
      const size = o.s0 + (o.s1 - o.s0) * e;
      const a = o.a * (1 - t) * (o.fade > 1 ? 1 - t : 1);
      GP[m * 3] = o.x;
      GP[m * 3 + 1] = o.y;
      GP[m * 3 + 2] = o.z;
      GC[m * 4] = o.r;
      GC[m * 4 + 1] = o.g;
      GC[m * 4 + 2] = o.b;
      GC[m * 4 + 3] = a;
      GA[m * 4] = size;
      GA[m * 4 + 1] = o.shape;
      GA[m * 4 + 2] = o.rot;
      GA[m * 4 + 3] = o.th;
      m++;
    }
    gq.geo.instanceCount = m;
    if (m) for (const k of ['aPos', 'aCol', 'aP']) {
      const a = gq.attr[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, m * a.itemSize);
      a.needsUpdate = true;
    }

    // smoke
    let s = 0;
    const SP = sq.attr.aPos.array;
    const SC = sq.attr.aCol.array;
    const SA = sq.attr.aP.array;
    for (let i = sActive.length - 1; i >= 0; i--) {
      const o = sActive[i];
      o.life -= dt;
      if (o.life <= 0) {
        o.on = false;
        sActive.splice(i, 1);
        sFree.push(o.idx);
        continue;
      }
      const drag = Math.max(0, 1 - 0.8 * dt);
      o.vx *= drag;
      o.vy *= drag;
      o.vz *= drag;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.z += o.vz * dt;
      o.rot += o.rotV * dt;
      const t = 1 - o.life / o.max;
      const size = o.s0 + (o.s1 - o.s0) * Math.sqrt(t);
      const a = o.a * Math.min(1, t * 6) * (1 - t);
      SP[s * 3] = o.x;
      SP[s * 3 + 1] = o.y;
      SP[s * 3 + 2] = o.z;
      SC[s * 4] = o.r;
      SC[s * 4 + 1] = o.g;
      SC[s * 4 + 2] = o.b;
      SC[s * 4 + 3] = a;
      SA[s * 2] = size;
      SA[s * 2 + 1] = o.rot;
      s++;
    }
    sq.geo.instanceCount = s;
    if (s) for (const k of ['aPos', 'aCol', 'aP']) {
      const a = sq.attr[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, s * a.itemSize);
      a.needsUpdate = true;
    }

    // debris
    let d = 0;
    for (let i = 0; i < MAX_D; i++) {
      const o = D[i];
      if (!o.on) continue;
      o.life -= dt;
      if (o.life <= 0) {
        o.on = false;
        continue;
      }
      o.vy -= 14 * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.z += o.vz * dt;
      const gy = getH(o.x, o.z) + 0.06 * o.s;
      if (o.y < gy) {
        o.y = gy;
        if (o.vy < -1.5) {
          o.vy = -o.vy * 0.32;
          o.vx *= 0.55;
          o.vz *= 0.55;
          o.wx *= 0.5;
          o.wy *= 0.5;
          o.wz *= 0.5;
        } else {
          o.vy = 0;
          o.vx *= Math.max(0, 1 - 6 * dt);
          o.vz *= Math.max(0, 1 - 6 * dt);
          o.wx *= Math.max(0, 1 - 5 * dt);
          o.wy *= Math.max(0, 1 - 5 * dt);
          o.wz *= Math.max(0, 1 - 5 * dt);
        }
      }
      o.qx += o.wx * dt;
      o.qy += o.wy * dt;
      o.qz += o.wz * dt;
      const fadeK = Math.min(1, o.life / 0.6);
      _e.set(o.qx, o.qy, o.qz);
      _q.setFromEuler(_e);
      _s.setScalar(o.s * fadeK);
      _m.compose(_v.set(o.x, o.y, o.z), _q, _s);
      dMesh.setColorAt(d, o.light ? LIGHT : DARK);
      dMesh.setMatrixAt(d++, _m);
    }
    dMesh.count = d;
    if (d) {
      dMesh.instanceMatrix.needsUpdate = true;
      if (dMesh.instanceColor) dMesh.instanceColor.needsUpdate = true;
    }

    // light
    if (light) {
      if (lightI > 0.01) {
        lightI = Math.max(0, lightI - Math.max(lightMax * 9, 60) * dt);
        light.intensity = lightI;
      } else if (light.intensity !== 0) light.intensity = 0;
    }
  }

  function clear() {
    for (const o of rActive) {
      o.on = false;
      rFree.push(o.idx);
    }
    rActive.length = 0;
    for (const o of gActive) {
      o.on = false;
      gFree.push(o.idx);
    }
    gActive.length = 0;
    for (const o of sActive) {
      o.on = false;
      sFree.push(o.idx);
    }
    sActive.length = 0;
    for (const o of D) o.on = false;
    rq.geo.instanceCount = 0;
    gq.geo.instanceCount = 0;
    sq.geo.instanceCount = 0;
    dMesh.count = 0;
  }

  function setVisible(v) {
    rMesh.visible = v;
    gMesh.visible = v;
    sMesh.visible = v;
    dMesh.visible = v;
  }

  return {
    bolt,
    beam,
    arc,
    sparks,
    glow,
    smoke,
    debris,
    muzzle,
    impact,
    explosion,
    flashLight,
    update,
    clear,
    setVisible,
    light,
    stats: () => ({ ribbons: rActive.length, glows: gActive.length, smoke: sActive.length, debris: dMesh.count, light: light ? +light.intensity.toFixed(1) : null }),
  };
}
