/**
 * Enemy visuals driven by ctx.net.enemies (server AI): security drones
 * (floating sentinel: red eye, thruster pods, laser emitter) and jungle
 * stalkers (alien quadruped with bioluminescent markings).
 *
 * Every body part is an InstancedMesh shared by all enemies of a type (drone:
 * 1 draw call, stalker: 6), with a patched MeshStandardMaterial: per-vertex
 * albedo + HDR emissive (`aEmit`) and per-instance hit flash, glow level and a
 * noise dissolve with glowing edges. Positions are smoothed on top of the net
 * interpolation; animation by state (idle / patrol / chase / attack / leap /
 * stunned / dead / return), procedural gait with 2-bone leg IK, death FX (drone burst + debris,
 * stalker collapse + dissolve), spawn-in materialise.
 *
 *   const enemies = createEnemies(ctx, { fx, getNet })
 *   enemies.update(dt, t)                 every frame (loop)
 *   enemies.raycast(o, d, maxDist, out)   → hit {id, t, x, y, z, nx, ny, nz} | null (client hit volumes)
 *   enemies.onDamage(id, msg) / onDeath(id, msg) / onFire(id, msg) → emitter position (Vector3) | null
 *   enemies.records                        Map id → record { id, type, pos, h, state, hp, maxHp, ... }
 *   enemies.candidates(out) → n            flat [x, y, z, r] of visible enemies (aim assist)
 */
import * as THREE from 'three';
import { damp, dampAngle, angleDiff, clamp } from '../core/math.js';
import { box, rbox, cyl, sphere, torus, cone, paint, merge, lin, hash3, place, ALONG_Z } from './geo.js';
import { ENEMIES } from './weapon-data.js';
import { enemyState, enemyVolumes, raySphere } from './logic.js';

const MAX_DRONES = 40;
const MAX_STALKERS = 24;
const DRAW_DIST = 320;

// ------------------------------------------------------------ material
function enemyMaterial(key, { metalness = 0.4, roughness = 0.55 } = {}) {
  const m = new THREE.MeshStandardMaterial({ name: `cbt-${key}`, vertexColors: true, metalness, roughness });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aEmit;
        attribute float iFlash;
        attribute float iGlow;
        attribute float iDissolve;
        varying vec3 vCbtEmit;
        varying float vCbtFlash;
        varying float vCbtDis;
        varying vec3 vCbtPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCbtEmit = aEmit * iGlow;
        vCbtFlash = iFlash;
        vCbtDis = iDissolve;
        #ifdef USE_INSTANCING
          vCbtPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vCbtPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCbtEmit;
        varying float vCbtFlash;
        varying float vCbtDis;
        varying vec3 vCbtPos;
        float cbtHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float cbtNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(cbtHash(i), cbtHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                         mix(cbtHash(i + vec3(0.0, 1.0, 0.0)), cbtHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                     mix(mix(cbtHash(i + vec3(0.0, 0.0, 1.0)), cbtHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                         mix(cbtHash(i + vec3(0.0, 1.0, 1.0)), cbtHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float cbtEdge = 0.0;
        if (vCbtDis > 0.001) {
          float cbtN = cbtNoise(vCbtPos * 3.6) * 0.7 + cbtNoise(vCbtPos * 9.0) * 0.3;
          float cbtD = cbtN - vCbtDis;
          if (cbtD < 0.0) discard;
          cbtEdge = 1.0 - smoothstep(0.0, 0.08, cbtD);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vCbtEmit + vec3(1.0, 0.93, 0.86) * vCbtFlash * 1.6 + vec3(0.35, 1.3, 2.2) * cbtEdge * 3.0;`,
      );
  };
  m.customProgramCacheKey = () => `cbt-enemy-v1-${key}`;
  return m;
}

/** One InstancedMesh part with per-instance flash / glow / dissolve. */
class Part {
  constructor(name, geo, mat, max, { shadow = true } = {}) {
    this.max = max;
    this.flash = new Float32Array(max);
    this.glow = new Float32Array(max).fill(1);
    this.dis = new Float32Array(max);
    geo.setAttribute('iFlash', new THREE.InstancedBufferAttribute(this.flash, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iGlow', new THREE.InstancedBufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iDissolve', new THREE.InstancedBufferAttribute(this.dis, 1).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.n = 0;
  }
  push(m, flash, glow, dis) {
    const i = this.n++;
    if (i >= this.max) return;
    this.mesh.setMatrixAt(i, m);
    this.flash[i] = flash;
    this.glow[i] = glow;
    this.dis[i] = dis;
  }
  commit() {
    const n = Math.min(this.n, this.max);
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      const g = this.mesh.geometry.attributes;
      g.iFlash.needsUpdate = true;
      g.iGlow.needsUpdate = true;
      g.iDissolve.needsUpdate = true;
    }
    this.n = 0;
  }
}

// ------------------------------------------------------------ drone model
export function droneGeometry() {
  const DARK = lin(0x1c1f25);
  const MID = lin(0x3b3f47);
  const LIGHT = lin(0xb4b9c1);
  const BLACK = lin(0x08090b);
  const RED = [7.5, 0.5, 0.28];
  const ORANGE = [4.2, 1.25, 0.32];
  const P = [];
  P.push(
    paint(sphere(0.4, 28, 18, { s: [1, 0.86, 1.08] }), DARK, [0, 0, 0], (x, y, z, nx, ny, nz, c) => {
      if (ny > 0.42) {
        c[0] = LIGHT[0];
        c[1] = LIGHT[1];
        c[2] = LIGHT[2];
      } else if (Math.abs(nx) > 0.7 && ny > -0.2) {
        c[0] = MID[0];
        c[1] = MID[1];
        c[2] = MID[2];
      }
    }),
  );
  P.push(paint(place(new THREE.SphereGeometry(0.43, 28, 6, 0, Math.PI * 2, 0, 0.9), { s: [1, 0.92, 1.1], p: [0, 0.01, 0.02] }), LIGHT));
  P.push(paint(torus(0.25, 0.056, 10, 30, { p: [0, -0.02, -0.355] }), MID));
  P.push(
    paint(cyl(0.21, 0.21, 0.06, 30, { p: [0, -0.02, -0.37], r: ALONG_Z }), BLACK, [0, 0, 0], (x, y, z, nx, ny, nz, c, e) => {
      const r = Math.hypot(x, y + 0.02);
      if (z < -0.385 && r < 0.05) {
        e[0] = RED[0] * 0.5;
        e[1] = RED[1] * 0.5;
        e[2] = RED[2] * 0.5;
      }
    }),
  );
  P.push(paint(torus(0.13, 0.017, 8, 30, { p: [0, -0.02, -0.405] }), BLACK, [RED[0] * 0.55, RED[1] * 0.55, RED[2] * 0.55]));
  P.push(paint(sphere(0.075, 14, 10, { p: [0, -0.02, -0.385], s: [1, 1, 0.6] }), BLACK, RED));
  P.push(paint(rbox(0.5, 0.08, 0.2, 0.03, { p: [0, 0.2, -0.29], r: [0.35, 0, 0] }), LIGHT));
  for (const s of [1, -1]) {
    P.push(paint(rbox(0.5, 0.1, 0.16, 0.03, { p: [s * 0.55, 0.02, 0.06], r: [0, 0, s * 0.18] }), DARK));
    P.push(
      paint(cyl(0.118, 0.1, 0.46, 18, { p: [s * 0.86, 0.09, 0.08], r: ALONG_Z }), LIGHT, [0, 0, 0], (x, y, z, nx, ny, nz, c) => {
        if (z > 0.22) {
          c[0] = DARK[0];
          c[1] = DARK[1];
          c[2] = DARK[2];
        }
      }),
    );
    P.push(paint(torus(0.1, 0.022, 8, 20, { p: [s * 0.86, 0.09, -0.16] }), DARK, [3.2, 0.42, 0.22]));
    P.push(paint(cyl(0.085, 0.085, 0.02, 16, { p: [s * 0.86, 0.09, 0.32], r: ALONG_Z }), BLACK, ORANGE));
    P.push(paint(rbox(0.05, 0.34, 0.5, 0.02, { p: [s * 0.97, 0.3, 0.2], r: [-0.55, 0, s * -0.22] }), LIGHT));
    P.push(paint(box(0.056, 0.022, 0.42, { p: [s * 1.01, 0.45, 0.26], r: [-0.55, 0, s * -0.22] }), BLACK, [RED[0] * 0.45, RED[1] * 0.45, RED[2] * 0.45]));
    P.push(paint(cyl(0.075, 0.06, 0.14, 14, { p: [s * 0.22, -0.36, 0.12] }), DARK));
    P.push(paint(cyl(0.055, 0.055, 0.012, 12, { p: [s * 0.22, -0.435, 0.12] }), BLACK, [ORANGE[0] * 0.9, ORANGE[1] * 0.9, ORANGE[2] * 0.9]));
  }
  P.push(paint(cyl(0.035, 0.045, 0.24, 12, { p: [0, -0.25, -0.3], r: ALONG_Z }), DARK));
  P.push(paint(sphere(0.04, 10, 8, { p: [0, -0.25, -0.43] }), BLACK, [RED[0] * 0.7, RED[1] * 0.7, RED[2] * 0.7]));
  P.push(paint(cyl(0.01, 0.014, 0.26, 6, { p: [0.12, 0.42, 0.2] }), MID));
  P.push(paint(sphere(0.022, 8, 6, { p: [0.12, 0.555, 0.2] }), BLACK, RED));
  P.push(paint(rbox(0.36, 0.18, 0.3, 0.06, { p: [0, 0.13, 0.28] }), MID));
  return merge(P);
}

// ---------------------------------------------------------- stalker model
const SK = {
  SKIN: lin(0x150f1d),
  BELLY: lin(0x2b2236),
  BONE: lin(0xb3ab9b),
  CYAN: [0.12, 1.8, 2.05],
  VIOLET: [1.45, 0.42, 2.5],
  EYE: [0.9, 3.8, 2.4],
};
const setC = (c, v, k = 1) => {
  c[0] = v[0] * k;
  c[1] = v[1] * k;
  c[2] = v[2] * k;
};
function skinFn(stripes = true) {
  return (x, y, z, nx, ny, nz, c, e) => {
    if (ny < -0.35) setC(c, SK.BELLY);
    if (stripes && ny > 0.25) {
      const s = Math.sin(z * 10.5);
      if (s > 0.45) setC(e, SK.CYAN, ((s - 0.45) / 0.55) * Math.min(1, (ny - 0.25) / 0.5) * 1.4);
    } else if (Math.abs(nx) > 0.5 && ny > -0.45) {
      const h = hash3(Math.round(x * 9), Math.round(y * 9), Math.round(z * 9));
      if (h > 0.8) setC(e, SK.VIOLET, ((h - 0.8) / 0.2) * 1.3);
    }
  };
}

const LEG = { L1: 0.55, L2: 0.6, foot: 0.025 };
const HIPS = [
  [-0.3, 1.0, -0.5, 0],
  [0.3, 1.0, -0.5, 0],
  [-0.3, 0.98, 0.48, 1],
  [0.3, 0.98, 0.48, 1],
];
const NECK = [0, 1.12, -0.55];
const JAW = [0, 0.12, -0.48];
const TAIL = [0, 1.02, 0.62];

export function stalkerGeometries() {
  const torso = [paint(sphere(0.5, 22, 26, { r: [Math.PI / 2, 0, 0], s: [0.6, 1.25, 0.52], p: [0, 1.0, 0] }), SK.SKIN, [0, 0, 0], skinFn(true))];
  for (let i = 0; i < 7; i++) {
    const z = -0.5 + i * 0.17;
    const base = 1.0 + 0.255 - Math.abs(z) * 0.07;
    torso.push(
      paint(cone(0.045, 0.16, 8, { p: [0, base, z], r: [-0.5, 0, 0] }), SK.SKIN, [0, 0, 0], (x, y, zz, nx, ny, nz, c, e) => {
        if (y > base + 0.03) setC(e, SK.CYAN, 1.3);
      }),
    );
  }
  for (const s of [1, -1]) {
    torso.push(paint(sphere(0.2, 12, 10, { p: [s * 0.27, 1.02, -0.45], s: [1, 1.1, 1.2] }), SK.SKIN, [0, 0, 0], skinFn(false)));
    torso.push(paint(sphere(0.22, 12, 10, { p: [s * 0.26, 1.0, 0.45], s: [1, 1.15, 1.3] }), SK.SKIN, [0, 0, 0], skinFn(false)));
  }
  const head = [
    paint(cyl(0.12, 0.16, 0.62, 12, { p: [0, 0.1, -0.28], r: [-1.234, 0, 0] }), SK.SKIN, [0, 0, 0], skinFn(false)),
    paint(sphere(0.24, 18, 12, { p: [0, 0.22, -0.66], s: [0.85, 0.72, 1.55] }), SK.SKIN, [0, 0, 0], (x, y, z, nx, ny, nz, c, e) => {
      if (ny < -0.35) setC(c, SK.BELLY);
      if (ny > 0.45 && Math.abs(Math.abs(x) - 0.07) < 0.035) setC(e, SK.CYAN, 1.2);
    }),
  ];
  for (const s of [1, -1]) {
    head.push(paint(sphere(0.032, 8, 6, { p: [s * 0.135, 0.27, -0.8] }), SK.SKIN, SK.EYE));
    head.push(paint(sphere(0.026, 8, 6, { p: [s * 0.168, 0.22, -0.66] }), SK.SKIN, SK.EYE));
    head.push(paint(cone(0.025, 0.14, 6, { p: [s * 0.09, 0.07, -0.98], r: [Math.PI, 0, 0] }), SK.BONE));
  }
  for (let i = 0; i < 3; i++) {
    head.push(
      paint(cone(0.04, 0.24 - i * 0.04, 8, { p: [0, 0.38 - i * 0.02, -0.52 + i * 0.12], r: [0.95, 0, 0] }), SK.SKIN, [0, 0, 0], (x, y, z, nx, ny, nz, c, e) => {
        if (y > 0.43 - i * 0.03) setC(e, SK.VIOLET, 1.4);
      }),
    );
  }
  const jaw = [
    paint(sphere(0.17, 12, 8, { p: [0, -0.05, -0.27], s: [0.75, 0.33, 1.55] }), SK.SKIN, [0, 0, 0], (x, y, z, nx, ny, nz, c, e) => {
      if (ny < -0.5) setC(e, SK.VIOLET, 0.55);
    }),
  ];
  for (const s of [1, -1]) for (const z of [-0.42, -0.3]) jaw.push(paint(cone(0.016, 0.08, 5, { p: [s * 0.07, 0.03, z] }), SK.BONE));
  const tail = [
    paint(cone(0.15, 1.2, 10, { r: [Math.PI / 2 + 0.25, 0, 0], p: [0, -0.15, 0.58] }), SK.SKIN, [0, 0, 0], (x, y, z, nx, ny, nz, c, e) => {
      if (z > 0.95) setC(e, SK.CYAN, 1.6 * Math.min(1, (z - 0.95) / 0.2));
      else if (ny > 0.2 && Math.sin(z * 14) > 0.7) setC(e, SK.VIOLET, 0.8);
    }),
  ];
  const thigh = [
    paint(cyl(0.12, 0.075, LEG.L1, 10, { p: [0, -LEG.L1 / 2, 0] }), SK.SKIN, [0, 0, 0], skinFn(false)),
    paint(sphere(0.08, 10, 8, { p: [0, -LEG.L1, 0] }), SK.SKIN),
  ];
  const shin = [
    paint(cyl(0.075, 0.05, LEG.L2, 8, { p: [0, -LEG.L2 / 2, 0] }), SK.SKIN),
    paint(torus(0.064, 0.012, 6, 14, { p: [0, -0.18, 0], r: [Math.PI / 2, 0, 0] }), SK.SKIN, SK.VIOLET),
    paint(rbox(0.13, 0.05, 0.24, 0.02, { p: [0, -LEG.L2, -0.06] }), SK.SKIN),
  ];
  for (const dx of [-0.045, 0, 0.045]) shin.push(paint(cone(0.022, 0.13, 6, { p: [dx, -LEG.L2 - 0.005, -0.21], r: [-Math.PI / 2, 0, 0] }), SK.BONE));
  return { torso: merge(torso), head: merge(head), jaw: merge(jaw), tail: merge(tail), thigh: merge(thigh), shin: merge(shin) };
}

// -------------------------------------------------------------- manager
const typeOf = (v) => {
  if (v === 'drone' || v === 'stalker') return v;
  if (v === 0 || v === 'd' || v === 'security-drone') return 'drone';
  if (v === 1 || v === 's' || v === 'jungle-stalker') return 'stalker';
  if (typeof v === 'string') return v.includes('stalk') ? 'stalker' : 'drone';
  return 'drone';
};

export function createEnemies(ctx, { fx, getNet, onTargetChange = null }) {
  const scene = ctx.world.scene;
  const getH = ctx.world.getHeightAt ? (x, z) => ctx.world.getHeightAt(x, z) : () => 0;
  const droneMat = enemyMaterial('drone', { metalness: 0.55, roughness: 0.4 });
  const stalkMat = enemyMaterial('stalker', { metalness: 0.08, roughness: 0.62 });
  const drone = new Part('cbt-drones', droneGeometry(), droneMat, MAX_DRONES);
  const sg = stalkerGeometries();
  const st = {
    torso: new Part('cbt-stalker-torso', sg.torso, stalkMat, MAX_STALKERS),
    head: new Part('cbt-stalker-head', sg.head, stalkMat, MAX_STALKERS),
    jaw: new Part('cbt-stalker-jaw', sg.jaw, stalkMat, MAX_STALKERS, { shadow: false }),
    tail: new Part('cbt-stalker-tail', sg.tail, stalkMat, MAX_STALKERS),
    thigh: new Part('cbt-stalker-thigh', sg.thigh, stalkMat, MAX_STALKERS * 4),
    shin: new Part('cbt-stalker-shin', sg.shin, stalkMat, MAX_STALKERS * 4),
  };
  const parts = [drone, ...Object.values(st)];
  for (const p of parts) scene.add(p.mesh);

  const records = new Map();
  let frame = 0;
  let time = 0;
  const camPos = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _one = new THREE.Vector3(1, 1, 1);
  const _mb = new THREE.Matrix4();
  const _m = new THREE.Matrix4();
  const _m2 = new THREE.Matrix4();
  const _m3 = new THREE.Matrix4();
  const _l = new THREE.Matrix4();
  const _snd = new THREE.Vector3();
  const _fxp = { x: 0, y: 0, z: 0 };
  const _fxb = { x: 0, y: 0, z: 0 };
  const SHOCK = [0.35, 0.78, 1];

  function makeRec(id, type) {
    return {
      id,
      type,
      def: ENEMIES[type] || ENEMIES.drone,
      pos: new THREE.Vector3(),
      tgt: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      h: 0,
      th: 0,
      state: 'idle',
      prevState: 'idle',
      hp: (ENEMIES[type] || ENEMIES.drone).hp,
      maxHp: (ENEMIES[type] || ENEMIES.drone).hp,
      flash: 0,
      glow: 1,
      seen: frame,
      born: time,
      spawn: 0,
      dead: false,
      dying: 0,
      gone: false,
      fadeOut: 0,
      lastHit: -100,
      targetsMe: 0,
      cycle: Math.random(),
      speed: 0,
      atk: 0,
      atkCool: 0,
      kick: 0,
      stunFx: 0,
      seed: Math.random() * 100,
      visible: false,
      init: false,
      groundY: 0,
      leapK: 0,
    };
  }

  // --------------------------------------------------- sync from ctx.net
  function readP(v, out) {
    const p = v.p ?? v.pos ?? v.position;
    if (!p) return false;
    if (Array.isArray(p)) out.set(p[0], p[1], p[2]);
    else out.set(p.x, p.y, p.z);
    return Number.isFinite(out.x + out.y + out.z);
  }
  let syncDt = 0;
  const syncOne = (e, key) => {
    if (!e) return;
    const v = e.view || e;
    const id = e.id ?? key;
    let rec = records.get(id);
    if (!rec) {
      rec = makeRec(id, typeOf(v.type ?? e.type ?? v.k ?? e.kind));
      if (!readP(v, rec.tgt)) return;
      records.set(id, rec);
      rec.pos.copy(rec.tgt);
      rec.spawn = rec.tgt.distanceToSquared(camPos) < 90 * 90 && frame > 2 ? 1 : 0;
    }
    rec.seen = frame;
    if (rec.dead) return;
    if (!readP(v, rec.tgt)) return;
    const hh = v.h ?? v.heading;
    if (Number.isFinite(hh)) rec.th = hh;
    const s = enemyState(v.s ?? v.state ?? e.s);
    if (s !== rec.state) {
      rec.prevState = rec.state;
      rec.state = s;
      if ((s === 'chase' || s === 'attack') && rec.prevState !== 'chase' && rec.prevState !== 'attack') {
        if (rec.type === 'stalker') ctx.audio?.play?.('combat.stalker', { position: _snd.copy(rec.tgt), volume: 0.9 });
      }
    }
    if ((v.dead || s === 'dead') && rec.init) {
      onDeath(id);
      return;
    }
    const hp = v.hp ?? e.hp;
    if (Number.isFinite(hp)) rec.hp = hp;
    const mx = v.maxHp ?? e.maxHp;
    if (Number.isFinite(mx) && mx > 0) rec.maxHp = mx;
    else if (rec.hp > rec.maxHp) rec.maxHp = rec.hp;
  };

  // ------------------------------------------------------------- pose math
  const ik = { t: 0, s: 0 };
  /** 2-bone IK in the sagittal plane: hip → foot (dy, dz in body space). kneeFwd = hind legs. */
  function solveLeg(dy, dz, kneeFwd) {
    const L1 = LEG.L1;
    const L2 = LEG.L2;
    let d = Math.hypot(dy, dz);
    d = clamp(d, 0.3, L1 + L2 - 0.02);
    const phi = Math.atan2(-dz, -dy); // 0 = straight down, + = foot forward
    const cosB = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const beta = Math.acos(cosB);
    const t = kneeFwd ? phi + beta : phi - beta;
    // knee position, then the shin's absolute angle
    const ky = -Math.cos(t) * L1;
    const kz = -Math.sin(t) * L1;
    const fy = -Math.cos(phi) * d;
    const fz = -Math.sin(phi) * d;
    const a2 = Math.atan2(-(fz - kz), -(fy - ky));
    ik.t = t;
    ik.s = a2 - t;
    return ik;
  }

  function composeBody(rec, x, y, z, yaw, pitch, roll) {
    _e.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    _mb.compose(_pos.set(x, y, z), _q, _one);
  }
  function local(px, py, pz, rx, ry, rz, order = 'XYZ') {
    _e.set(rx, ry, rz, order);
    _q.setFromEuler(_e);
    return _l.compose(_pos.set(px, py, pz), _q, _one);
  }

  // ---------------------------------------------------------- per frame
  function animDrone(rec, dt) {
    const state = rec.state;
    const moving = rec.speed;
    const bob = Math.sin(time * 2.1 + rec.seed) * 0.08 + Math.sin(time * 3.7 + rec.seed * 2) * 0.03;
    // tilt toward the velocity in the drone's frame
    const fwd = -Math.sin(rec.h) * rec.vel.x - Math.cos(rec.h) * rec.vel.z;
    const side = Math.cos(rec.h) * rec.vel.x - Math.sin(rec.h) * rec.vel.z;
    let pitch = clamp(-fwd * 0.035, -0.4, 0.4);
    let roll = clamp(-side * 0.04, -0.45, 0.45);
    let y = rec.pos.y + bob;
    let x = rec.pos.x;
    let z = rec.pos.z;
    rec.kick = Math.max(0, rec.kick - dt * 6);
    if (rec.kick > 0) pitch -= rec.kick * 0.18;
    let glow = state === 'attack' ? 1.45 + Math.sin(time * 18) * 0.25 : state === 'chase' ? 1.2 : state === 'idle' ? 0.75 : 0.95;
    if (state === 'stunned') {
      roll += Math.sin(time * 31 + rec.seed) * 0.25;
      pitch += Math.sin(time * 27) * 0.18;
      glow = 0.35 + Math.random() * 0.6;
      rec.stunFx -= dt;
      if (rec.stunFx <= 0 && fx) {
        rec.stunFx = 0.12;
        _fxp.x = x + (Math.random() - 0.5) * 0.9;
        _fxp.y = y + (Math.random() - 0.5) * 0.6;
        _fxp.z = z + (Math.random() - 0.5) * 0.9;
        _fxb.x = x + (Math.random() - 0.5) * 1.6;
        _fxb.y = y + (Math.random() - 0.5) * 0.8;
        _fxb.z = z + (Math.random() - 0.5) * 1.6;
        fx.arc(_fxp, _fxb, SHOCK, 0.1, 0.12, 4, 6, 0.025);
      }
    }
    if (moving > 0.5) glow += 0.1;
    let dis = 0;
    if (rec.spawn > 0) {
      dis = rec.spawn;
      rec.spawn = Math.max(0, rec.spawn - dt * 1.6);
    }
    if (rec.fadeOut > 0) dis = Math.max(dis, 1 - rec.fadeOut);
    rec.glow = glow;
    composeBody(rec, x, y, z, rec.h, pitch, roll);
    drone.push(_mb, rec.flash, glow, dis);
    rec.markerY = y + rec.def.marker;
  }

  function animStalker(rec, dt) {
    const state = rec.state;
    const sp = rec.speed;
    // gait
    const freq = 0.75 + sp * 0.17;
    rec.cycle = (rec.cycle + dt * freq) % 1;
    const stride = clamp((sp / freq) * 0.62, 0, 1.25);
    const gallop = clamp((sp - 5) / 4, 0, 1);
    const groundY = rec.groundY;
    let bodyY = groundY;
    let pitch = 0;
    let roll = 0;
    let lunge = 0;
    let jaw = -0.08 - Math.max(0, Math.sin(time * 1.3 + rec.seed)) * 0.06;
    let headPitch = Math.sin(time * 0.9 + rec.seed) * 0.06;
    let headYaw = Math.sin(time * 0.6 + rec.seed * 3) * 0.12;
    let tailSway = Math.sin(time * (1.4 + sp * 0.35) + rec.seed) * (0.18 + sp * 0.015);
    let tailLift = -0.05 + sp * 0.015;
    const bobPhase = rec.cycle * Math.PI * 4;
    if (sp > 0.3) {
      bodyY += Math.sin(bobPhase) * (0.03 + gallop * 0.05);
      pitch += Math.sin(bobPhase + 0.8) * gallop * 0.06;
      headPitch -= gallop * 0.12;
    } else {
      bodyY += Math.sin(time * 1.8 + rec.seed) * 0.012; // breathing
    }
    // attack lunge (claw swipe + bite)
    rec.atkCool = Math.max(0, rec.atkCool - dt);
    if (state === 'attack' && rec.atk <= 0 && rec.atkCool <= 0) {
      rec.atk = 1;
      rec.atkCool = 1.05;
    }
    let swipe = 0;
    if (rec.atk > 0) {
      rec.atk = Math.max(0, rec.atk - dt / 0.5);
      const k = Math.sin((1 - rec.atk) * Math.PI);
      lunge = k * 0.42;
      pitch -= k * 0.16;
      jaw = -0.08 - k * 0.55;
      headPitch -= k * 0.25;
      swipe = k;
    }
    // leap (ES.LEAP): nose up while rising, stretched legs, jaw open
    rec.leapK = damp(rec.leapK, state === 'leap' && !rec.dead ? 1 : 0, 10, dt);
    const leap = rec.leapK;
    if (leap > 0.01) {
      pitch += clamp(rec.vel.y / 7, -1, 1) * 0.32 * leap;
      jaw = jaw * (1 - leap) - 0.45 * leap;
      headPitch += 0.15 * leap;
      tailLift += 0.25 * leap;
    }
    let splay = 0;
    let crouch = 0;
    let dis = 0;
    if (state === 'stunned' && !rec.dead) {
      crouch = 0.18;
      roll += Math.sin(time * 33 + rec.seed) * 0.05;
      headYaw += Math.sin(time * 29) * 0.2;
      rec.stunFx -= dt;
      if (rec.stunFx <= 0 && fx) {
        rec.stunFx = 0.13;
        _fxp.x = rec.pos.x + (Math.random() - 0.5) * 1.2;
        _fxp.y = groundY + 0.6 + Math.random() * 0.7;
        _fxp.z = rec.pos.z + (Math.random() - 0.5) * 1.2;
        _fxb.x = rec.pos.x + (Math.random() - 0.5) * 2;
        _fxb.y = groundY + 0.4 + Math.random() * 1;
        _fxb.z = rec.pos.z + (Math.random() - 0.5) * 2;
        fx.arc(_fxp, _fxb, SHOCK, 0.1, 0.14, 4, 6, 0.025);
      }
    }
    if (rec.dead) {
      const k = clamp(rec.dying / 0.55, 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      crouch = e * 0.62;
      roll = e * 1.25 * (rec.seed > 50 ? 1 : -1);
      splay = e * 0.75;
      jaw = -0.5 * e;
      headPitch = 0.3 * e;
      tailSway *= 1 - e;
      dis = clamp((rec.dying - 0.45) / 1.3, 0, 1);
    }
    if (rec.spawn > 0) {
      dis = Math.max(dis, rec.spawn);
      rec.spawn = Math.max(0, rec.spawn - dt * 1.5);
    }
    if (rec.fadeOut > 0) dis = Math.max(dis, 1 - rec.fadeOut);
    bodyY -= crouch;
    const glow = rec.dead ? 1 + rec.dying * 0.6 : state === 'chase' || state === 'attack' ? 1.25 + Math.sin(time * 9 + rec.seed) * 0.15 : 0.9 + Math.sin(time * 1.6 + rec.seed) * 0.12;
    rec.glow = glow;
    const fx0 = -Math.sin(rec.h) * lunge;
    const fz0 = -Math.cos(rec.h) * lunge;
    composeBody(rec, rec.pos.x + fx0, bodyY, rec.pos.z + fz0, rec.h, pitch, roll);
    const f = rec.flash;
    st.torso.push(_mb, f, glow, dis);
    // head + jaw
    _m.multiplyMatrices(_mb, local(NECK[0], NECK[1], NECK[2], headPitch, headYaw, 0, 'YXZ'));
    st.head.push(_m, f, glow, dis);
    _m2.multiplyMatrices(_m, local(JAW[0], JAW[1], JAW[2], jaw, 0, 0));
    st.jaw.push(_m2, f, glow, dis);
    // tail
    _m.multiplyMatrices(_mb, local(TAIL[0], TAIL[1], TAIL[2], tailLift, tailSway, 0, 'YXZ'));
    st.tail.push(_m, f, glow, dis);
    // legs
    for (let i = 0; i < 4; i++) {
      const [hx, hy, hz, hind] = HIPS[i];
      const off = gallop > 0.5 ? [0, 0.12, 0.52, 0.62][i] : [0, 0.5, 0.5, 0][i];
      const ph = (rec.cycle + off) % 1;
      let footZ = hz + (hind ? 0.12 : -0.05);
      let footY = -hy + crouch + LEG.foot;
      if (stride > 0.02) {
        if (ph < 0.6) footZ += -stride / 2 + (ph / 0.6) * stride;
        else {
          const u = (ph - 0.6) / 0.4;
          footZ += stride / 2 - u * stride;
          footY += Math.sin(u * Math.PI) * (0.12 + stride * 0.2);
        }
      }
      if (leap > 0.01) {
        // front legs reach forward, hind legs kick back
        footZ += (hind ? 0.55 : -0.6) * leap;
        footY += (hind ? 0.18 : 0.32) * leap;
      }
      if (!hind && swipe > 0 && (i === 0 || (i === 1 && rec.seed > 50))) {
        footY += swipe * 0.55;
        footZ -= swipe * 0.45;
      }
      const s = solveLeg(footY, footZ - hz, !!hind);
      const sx = (hx < 0 ? -1 : 1) * (0.05 + splay);
      _m.multiplyMatrices(_mb, local(hx, hy, hz, s.t, 0, sx, 'ZYX'));
      st.thigh.push(_m, f, glow, dis);
      _m3.multiplyMatrices(_m, local(0, -LEG.L1, 0, s.s, 0, 0));
      st.shin.push(_m3, f, glow, dis);
    }
    rec.markerY = groundY + rec.def.marker;
  }

  /**
   * A stalker's feet: the server's y (snapshot = feet). On the ground the local terrain is used when it
   * agrees (no floating / sinking between snapshots); in a leap or where the terrains differ, the server y.
   */
  function stalkerGround(rec) {
    if (rec.state === 'leap' || rec.dead) return rec.dead ? rec.groundY || rec.pos.y : rec.pos.y;
    const g = getH(rec.pos.x, rec.pos.z);
    return Math.abs(g - rec.pos.y) < 1.2 ? g : rec.pos.y;
  }

  const updRec = (rec) => {
    const dt = updRec.dt;
    // vanished from the net map
    if (rec.seen !== frame && !rec.dead) {
      if (!rec.gone) {
        rec.gone = true;
        rec.fadeOut = rec.pos.distanceToSquared(camPos) < 150 * 150 ? 1 : 0;
      }
    } else if (rec.seen === frame && rec.gone && !rec.dead) {
      rec.gone = false;
      rec.fadeOut = 0;
    }
    if (rec.gone && !rec.dead) {
      rec.fadeOut -= dt * 2.5;
      if (rec.fadeOut <= 0) {
        removeRec(rec);
        return;
      }
    }
    if (rec.dead) {
      rec.dying += dt;
      const end = rec.type === 'drone' ? 0.05 : 1.9;
      if (rec.dying > end) {
        removeRec(rec);
        return;
      }
    }
    // smoothing on top of the net interpolation
    if (!rec.dead) {
      const jump = rec.pos.distanceToSquared(rec.tgt) > 64;
      const px = rec.pos.x;
      const py = rec.pos.y;
      const pz = rec.pos.z;
      if (jump || !rec.init) rec.pos.copy(rec.tgt);
      else {
        // light smoothing on top of the interpolation (kept small: hit volumes follow the visuals)
        rec.pos.x = damp(rec.pos.x, rec.tgt.x, 28, dt);
        rec.pos.y = damp(rec.pos.y, rec.tgt.y, 28, dt);
        rec.pos.z = damp(rec.pos.z, rec.tgt.z, 28, dt);
      }
      if (dt > 0 && rec.init && !jump) {
        rec.vel.x = damp(rec.vel.x, (rec.pos.x - px) / dt, 6, dt);
        rec.vel.y = damp(rec.vel.y, (rec.pos.y - py) / dt, 6, dt);
        rec.vel.z = damp(rec.vel.z, (rec.pos.z - pz) / dt, 6, dt);
      }
      rec.init = true;
      rec.speed = Math.hypot(rec.vel.x, rec.vel.z);
      rec.h = dampAngle(rec.h, rec.th, rec.type === 'drone' ? 5 : 9, dt);
    } else {
      rec.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
      rec.speed = Math.hypot(rec.vel.x, rec.vel.z);
    }
    if (rec.type === 'stalker') rec.groundY = stalkerGround(rec);
    rec.flash = Math.max(0, rec.flash - dt * 7);
    rec.targetsMe = Math.max(0, rec.targetsMe - dt);
    const d2 = rec.pos.distanceToSquared(camPos);
    rec.dist = Math.sqrt(d2);
    rec.visible = d2 < DRAW_DIST * DRAW_DIST;
    if (!rec.visible) return;
    if (rec.type === 'stalker') animStalker(rec, dt);
    else animDrone(rec, dt);
  };
  updRec.dt = 0;

  function removeRec(rec) {
    records.delete(rec.id);
    rec.removed = true;
    onTargetChange?.(rec, false);
  }

  function update(dt, t) {
    frame++;
    time = t;
    syncDt = dt;
    const cam = ctx.engine?.camera || ctx.camera;
    if (cam) camPos.setFromMatrixPosition(cam.matrixWorld);
    const net = getNet();
    const src = net?.enemies;
    if (src && typeof src.forEach === 'function') src.forEach(syncOne);
    updRec.dt = dt;
    records.forEach(updRec);
    for (const p of parts) p.commit();
  }

  // -------------------------------------------------------------- queries
  const vols = new Float32Array(16);
  function raycast(o, d, maxDist, out) {
    let best = maxDist;
    let hit = null;
    records.forEach((rec) => {
      if (rec.dead || rec.gone || !rec.visible) return;
      const dx = rec.pos.x - o.x;
      const dy = rec.pos.y - o.y;
      const dz = rec.pos.z - o.z;
      // cheap reject: farther than the best hit or behind
      const along = dx * d.x + dy * d.y + dz * d.z;
      if (along < -3 || along > best + 3) return;
      const baseY = rec.type === 'stalker' ? rec.groundY : rec.pos.y;
      const n = enemyVolumes(rec.def.volumes, rec.pos.x, baseY, rec.pos.z, rec.h, vols);
      for (let i = 0; i < n; i++) {
        const cx = vols[i * 4];
        const cy = vols[i * 4 + 1];
        const cz = vols[i * 4 + 2];
        const r = vols[i * 4 + 3];
        const tt = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, cx, cy, cz, r);
        if (tt >= 0 && tt < best) {
          best = tt;
          out.id = rec.id;
          out.t = tt;
          out.x = o.x + d.x * tt;
          out.y = o.y + d.y * tt;
          out.z = o.z + d.z * tt;
          const nl = Math.hypot(out.x - cx, out.y - cy, out.z - cz) || 1;
          out.nx = (out.x - cx) / nl;
          out.ny = (out.y - cy) / nl;
          out.nz = (out.z - cz) / nl;
          out.rec = rec;
          out.part = i;
          hit = out;
        }
      }
    });
    return hit;
  }

  function candidates(out, max = 16) {
    let n = 0;
    records.forEach((rec) => {
      if (n >= max || rec.dead || rec.gone || !rec.visible || rec.dist > 140) return;
      const baseY = rec.type === 'stalker' ? rec.groundY + 0.95 : rec.pos.y;
      out[n * 4] = rec.pos.x;
      out[n * 4 + 1] = baseY;
      out[n * 4 + 2] = rec.pos.z;
      out[n * 4 + 3] = rec.type === 'stalker' ? 0.8 : 0.85;
      n++;
    });
    return n;
  }

  // --------------------------------------------------------------- events
  function onDamage(id, msg) {
    const rec = records.get(id);
    if (!rec) return null;
    rec.flash = 1;
    rec.lastHit = time;
    if (Number.isFinite(msg?.hp)) rec.hp = msg.hp;
    return rec;
  }

  function onDeath(id) {
    const rec = records.get(id);
    if (!rec || rec.dead) return rec || null;
    rec.dead = true;
    rec.dying = 0;
    rec.hp = 0;
    rec.targetsMe = 0;
    onTargetChange?.(rec, false);
    _snd.copy(rec.pos);
    if (rec.type === 'drone') {
      if (fx) {
        fx.explosion(rec.pos, 'fire', 2.6);
        fx.debris(rec.pos, 12, 8, 0.45);
      }
      ctx.audio?.play?.('combat.boom', { position: _snd, volume: 0.85, size: 0.8 });
    } else {
      ctx.audio?.play?.('combat.stalker.die', { position: _snd, volume: 0.9 });
      if (fx) {
        _fxp.x = rec.pos.x;
        _fxp.y = (rec.groundY || rec.pos.y) + 0.8;
        _fxp.z = rec.pos.z;
        fx.glow(_fxp, [0.3, 1, 1.2], 0.6, 2.2, 0.6, 0, 0.7, 2.5);
      }
    }
    return rec;
  }

  const _em = new THREE.Vector3();
  /** Enemy shot: kick + returns the emitter position for the laser FX. */
  function onFire(id) {
    const rec = records.get(id);
    if (!rec || rec.dead) return null;
    rec.kick = 1;
    if (rec.type === 'drone') {
      _em.set(0, -0.25, -0.46);
      _e.set(0, rec.h, 0, 'YXZ');
      _q.setFromEuler(_e);
      _em.applyQuaternion(_q).add(rec.pos);
    } else {
      _em.set(-Math.sin(rec.h) * 1.2, (rec.groundY || rec.pos.y) + 1.1, -Math.cos(rec.h) * 1.2);
      _em.x += rec.pos.x;
      _em.z += rec.pos.z;
    }
    return _em;
  }

  function clear() {
    records.clear();
    for (const p of parts) p.commit();
  }

  function dispose() {
    for (const p of parts) {
      p.mesh.removeFromParent();
      p.mesh.geometry.dispose();
      p.mesh.dispose?.();
    }
    droneMat.dispose();
    stalkMat.dispose();
  }

  return {
    records,
    update,
    raycast,
    candidates,
    onDamage,
    onDeath,
    onFire,
    clear,
    dispose,
    parts,
    get count() {
      return records.size;
    },
  };
}
