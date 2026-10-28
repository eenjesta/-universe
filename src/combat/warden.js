/**
 * De Wachter — the world boss visual (27_boss_mech.png): a ~20 m ancient guardian of
 * mossy stone plates over dark metal, glowing cyan Ø runes on the chest and shoulders
 * (the weak points), one red eye, a broken stone halo on its back. Articulated rigid
 * parts (hips · torso · head · arms · legs) posed procedurally from the snapshot +
 * boss flags (dormant kneel, rise, walk, stagger) and the attack events (stomp wind-up
 * + slam, eye beam wind-up + sweep, drone summons, roar, death collapse).
 *
 *   const w = createWarden(ctx, { fx })
 *   w.sync(rec)                       every frame while the boss record exists (pose, glow)
 *   w.stomp(msg) / w.beam(msg, targetPos) / w.summon(msg) / w.roar(msg)   server events
 *   w.die() / w.hide()                death collapse / out of range
 *   w.parts(out) → n                  world hit spheres (shared WARDEN_PARTS, current kneel)
 *   w.kneel, w.group, w.dispose()
 * Shapes and numbers come from shared/defs/enemies.js (WARDEN_PARTS / WARDEN_EYE / beamHeading)
 * so the visual, the client raycast and the server's hit validation agree.
 */
import * as THREE from 'three';
import { box, rbox, cyl, sphere, torus, paint, merge, lin, hash3, place, ALONG_Z } from './geo.js';
import { WARDEN_EYE, WARDEN_KNEEL, wardenParts, beamHeading, BOSS_BITS, BOSS } from '../../shared/defs/enemies.js';
import { ARENA_MONOLITHS } from '../../shared/sim/los.js';
import { damp, dampAngle, clamp, angleDiff } from '../core/math.js';

const STONE = lin(0x5b5650);
const STONE_D = lin(0x3a3632);
const METAL = lin(0x23262b);
const MOSS = lin(0x4d5e2c);
const CYAN = [0.4, 1.9, 2.6];

function stonePaint(x, y, z, nx, ny, nz, c) {
  const h = hash3(Math.round(x * 1.7), Math.round(y * 1.7), Math.round(z * 1.7));
  if (ny > 0.55 && h > 0.35) {
    c[0] = MOSS[0];
    c[1] = MOSS[1];
    c[2] = MOSS[2];
  } else if (h > 0.72) {
    c[0] = STONE_D[0];
    c[1] = STONE_D[1];
    c[2] = STONE_D[2];
  }
}
const stone = (g) => paint(g, STONE, [0, 0, 0], stonePaint);
const metal = (g) => paint(g, METAL);
const channel = (g, k = 1) => paint(g, METAL, [CYAN[0] * k, CYAN[1] * k, CYAN[2] * k]);

/** A flat Ø glyph (ring + slash) facing −Z at the origin, radius r. */
function glyph(r) {
  const ring = torus(r, r * 0.11, 8, 40, {});
  const slash = box(r * 0.16, r * 2.5, r * 0.12, { r: [0, 0, -0.62] });
  return merge([paint(ring, [0.2, 0.3, 0.35]), paint(slash, [0.2, 0.3, 0.35])]);
}

function material(name) {
  const m = new THREE.MeshStandardMaterial({ name: `cbt-warden-${name}`, vertexColors: true, roughness: 0.82, metalness: 0.18 });
  const u = { uFlash: { value: 0 }, uGlow: { value: 1 }, uDis: { value: 0 }, uHeat: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aEmit;\nvarying vec3 vWEmit;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWEmit = aEmit;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFlash; uniform float uGlow; uniform float uDis; uniform float uHeat;
        varying vec3 vWEmit; varying vec3 vWPos;
        float wHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float wEdge = 0.0;
        if (uDis > 0.001) {
          float n = wHash(floor(vWPos * 1.3)) * 0.65 + wHash(floor(vWPos * 3.1)) * 0.35;
          float d = n - uDis;
          if (d < 0.0) discard;
          wEdge = 1.0 - smoothstep(0.0, 0.07, d);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vWEmit * uGlow + vec3(1.0, 0.92, 0.85) * uFlash * 0.9 + vec3(1.6, 0.5, 0.2) * wEdge * 2.5;
        totalEmissiveRadiance += vec3(1.4, 0.25, 0.08) * uHeat * step(0.82, wHash(floor(vWPos * 2.2)));`,
      );
  };
  m.customProgramCacheKey = () => 'cbt-warden-v1';
  return m;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createWarden(ctx, { fx }) {
  const scene = ctx.world.scene;
  const getH = (x, z) => ctx.world.getHeightAt?.(x, z) ?? 0;
  const mat = material('body');
  const root = new THREE.Group();
  root.name = 'cbt-warden';
  root.visible = false;
  scene.add(root);
  const mk = (geo, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const pivot = (parent, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  // ------------------------------------------------------------ build (local metres, feet at 0)
  const hips = pivot(root, 0, 8.6, 0.2);
  mk(merge([stone(rbox(6.2, 2.4, 4.2, 0.5, {})), metal(cyl(1.3, 1.5, 1.4, 12, { p: [0, 1.4, -0.2] })), channel(box(4.8, 0.18, 0.2, { p: [0, -0.4, -2.12] }), 0.8)]), hips);
  const torso = pivot(hips, 0, 1.6, -0.1);
  mk(
    merge([
      stone(rbox(8.6, 6.4, 6.6, 1.1, { p: [0, 2.3, 0] })),
      stone(rbox(6.4, 2.2, 5.4, 0.6, { p: [0, 5.6, 0.3] })),
      metal(rbox(4.2, 3.4, 0.6, 0.2, { p: [0, 2.6, -3.3] })),
      channel(box(0.22, 5.6, 0.22, { p: [2.9, 2.2, -3.32] }), 1),
      channel(box(0.22, 5.6, 0.22, { p: [-2.9, 2.2, -3.32] }), 1),
      channel(box(6.0, 0.2, 0.22, { p: [0, -0.5, -3.32] }), 0.7),
      stone(rbox(3.4, 1.8, 2.4, 0.4, { p: [0, 1.2, 3.6] })),
    ]),
    torso,
  );
  // back halo: a broken stone ring (drones launch from it)
  const halo = pivot(torso, 0, 6.6, 3.6);
  mk(
    merge([
      stone(place(new THREE.TorusGeometry(5.2, 0.7, 8, 28, Math.PI * 1.55), { r: [0, 0, Math.PI * 0.72] })),
      channel(place(new THREE.TorusGeometry(5.2, 0.14, 6, 28, Math.PI * 1.5), { p: [0, 0, -0.62], r: [0, 0, Math.PI * 0.74] }), 0.8),
    ]),
    halo,
  );
  // runes (weak points): chest + shoulders — own materials so each can glow / die alone
  const runeMats = [];
  const runes = [];
  const runeAt = [
    [0, 12.9, -4.15, 1.35],
    [-5.4, 15.6, -1.9, 1.05],
    [5.4, 15.6, -1.9, 1.05],
  ];
  const head = pivot(torso, 0, 7.2, -0.4);
  mk(
    merge([
      stone(rbox(3.4, 3.2, 3.6, 0.7, { p: [0, 1.3, 0] })),
      metal(rbox(2.6, 1.0, 0.5, 0.2, { p: [0, 1.2, -1.85] })),
      stone(rbox(4.2, 0.7, 2.6, 0.3, { p: [0, 2.9, 0.2] })),
      channel(box(0.16, 2.6, 0.16, { p: [0, 2.2, -1.86] }), 1.2),
    ]),
    head,
  );
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.6, 0.3), toneMapped: true });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), eyeMat);
  eye.position.set(WARDEN_EYE[0], WARDEN_EYE[1] - 8.6 - 1.6 - 7.2 + 0.1, WARDEN_EYE[2] + 0.4 + 0.1);
  head.add(eye);
  const glowTex = glowTexture();
  const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(6, 0.5, 0.25), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  eyeGlow.scale.setScalar(3.2);
  eye.add(eyeGlow);
  const armL = pivot(torso, -6.1, 5.0, 0.3);
  const armR = pivot(torso, 6.1, 5.0, 0.3);
  const foreL = pivot(armL, -0.2, -4.2, 0);
  const foreR = pivot(armR, 0.2, -4.2, 0);
  for (const [arm, fore, s] of [
    [armL, foreL, -1],
    [armR, foreR, 1],
  ]) {
    mk(merge([stone(rbox(3.6, 2.6, 4.0, 0.8, { p: [s * 0.2, 0.3, 0] })), stone(rbox(2.2, 4.4, 2.4, 0.5, { p: [0, -2.0, 0] })), channel(box(0.2, 3.6, 0.2, { p: [s * 1.12, -2.0, -0.9] }), 0.8)]), arm);
    mk(merge([stone(rbox(2.3, 3.6, 2.5, 0.5, { p: [0, -1.6, -0.3] })), stone(rbox(3.4, 3.0, 3.4, 0.9, { p: [0, -3.9, -0.6] })), metal(rbox(2.4, 0.6, 2.6, 0.2, { p: [0, -0.2, -0.3] }))]), fore);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const thigh = pivot(hips, s * 2.7, -0.6, 0.1);
    mk(merge([stone(rbox(2.8, 4.2, 3.0, 0.6, { p: [0, -2.0, 0] })), metal(cyl(0.9, 0.9, 1.6, 12, { p: [0, -4.2, 0], r: [0, 0, Math.PI / 2] }))]), thigh);
    const shin = pivot(thigh, 0, -4.2, 0);
    mk(merge([stone(rbox(2.5, 3.8, 2.8, 0.5, { p: [0, -1.8, 0.1] })), stone(rbox(2.6, 1.3, 3.8, 0.4, { p: [0, -3.5, -0.5] })), channel(box(0.18, 2.6, 0.18, { p: [0, -1.8, -1.42] }), 0.7)]), shin);
    legs.push({ thigh, shin, s, lift: 0 });
  }
  // runes on top of everything (own materials; bright cyan, dark when broken)
  for (let i = 0; i < 3; i++) {
    const [x, y, z, r] = runeAt[i];
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 3.2), toneMapped: true });
    runeMats.push(m);
    const g = new THREE.Mesh(glyph(r * 0.78), m);
    // in the torso's frame (torso origin = hips + (0, 1.6, −0.1) = (0, 10.2, 0.1))
    g.position.set(x, y - 10.2, z - 0.1 - 0.06);
    if (i > 0) g.rotation.y = i === 1 ? 0.5 : -0.5;
    torso.add(g);
    const plate = new THREE.Mesh(merge([metal(cyl(r * 1.05, r * 1.15, 0.5, 20, { r: ALONG_Z }))]), mat);
    plate.position.set(x, y - 10.2, z - 0.1 + 0.25);
    plate.rotation.y = g.rotation.y;
    torso.add(plate);
    runes.push({ mesh: g, mat: m, broken: false, flick: 0 });
  }

  // ------------------------------------------------------------ the arena: a ring of broken Ø monoliths
  // (always standing — a landmark you can see from afar; the sim uses the same boxes as cover from the beam)
  const arenaMat = material('arena');
  arenaMat.userData.u.uGlow.value = 1;
  const arena = (() => {
    const parts = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let i = 0;
    for (const [a, r, h, w, d] of ARENA_MONOLITHS) {
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const gy = getH(BOSS.site.x + x, BOSS.site.z + z) - 0.4;
      const broken = h < 7;
      const lean = (i % 2 ? 1 : -1) * (broken ? 0.03 : 0.06);
      const local = [
        stone(rbox(w, h, d, 0.35, { p: [0, h / 2, 0], r: [lean, 0, lean * 0.5] })),
        // plinth stones
        stone(rbox(w + 1.1, 0.9, d + 1.0, 0.25, { p: [0, 0.45, 0] })),
        // the cap: a tilted lintel stub on the tall ones, rubble on the broken ones
        broken ? stone(rbox(w * 0.8, 1.0, d * 0.9, 0.3, { p: [w * 0.55, 0.5, -d * 0.7], r: [0.3, 0.4, 0.5] })) : stone(rbox(w + 1.6, 1.0, d + 0.4, 0.3, { p: [0.4, h + 0.3, 0], r: [0, 0, lean * 2 + 0.08] })),
        // a vertical rune channel + the Ø on the face toward the plinth (local −Z)
        channel(box(0.2, h * 0.55, 0.12, { p: [0, h * 0.45, -d / 2 - 0.02] }), 0.9),
      ];
      const gl = glyph(Math.min(w, h) * 0.26);
      paint(gl, METAL, [CYAN[0] * 1.2, CYAN[1] * 1.2, CYAN[2] * 1.2]);
      place(gl, { p: [0, h * 0.68, -d / 2 - 0.08] });
      local.push(gl);
      const g = merge(local);
      q.setFromAxisAngle(up, a);
      m4.compose(pos.set(x, gy, z), q, one);
      g.applyMatrix4(m4);
      parts.push(g);
      i++;
    }
    const mesh = new THREE.Mesh(merge(parts), arenaMat);
    mesh.name = 'cbt-warden-arena';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(BOSS.site.x, 0, BOSS.site.z);
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    return mesh;
  })();

  // ------------------------------------------------------------ state
  const st = {
    on: false,
    kneel: 1,
    wake: 0,
    phase: 0,
    runes: 0,
    stagger: false,
    walk: 0,
    stepSide: 1,
    lastStep: 0,
    stomp: null, // { side, t, ct, hitAt, at }
    beam: null, // { a0, a1, dur, t, ct, dist }
    roar: 0,
    summon: 0,
    dead: false,
    dying: 0,
    flash: 0,
    h: 0,
    pos: new THREE.Vector3(),
  };
  const _v = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _p = { x: 0, y: 0, z: 0 };
  const RED = [1, 0.18, 0.08];
  const ORANGE = [1, 0.45, 0.12];
  const DUST = [0.42, 0.36, 0.3];

  function eyeWorld(out) {
    eye.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(eye.matrixWorld);
  }

  function shake(at, k) {
    const cam = ctx.camera.position;
    const d = Math.hypot(cam.x - at.x, cam.z - at.z);
    if (d < 90) ctx.cameraRig?.shake?.(clamp(k * (1 - d / 90), 0, 0.9));
  }

  // ------------------------------------------------------------ events
  function stomp(msg) {
    const at = msg.at;
    if (!Array.isArray(at)) return;
    if (msg.phase === 'windup') {
      st.stomp = { side: msg.side || 1, t: 0, ct: msg.ct || 1.1, at: new THREE.Vector3(at[0], at[1], at[2]), r: msg.r || 24, slam: false };
      // the danger zone: a red ring of the full radius, pulsing until the slam
      _p.x = at[0];
      _p.y = Math.max(getH(at[0], at[2]), 0) + 0.15;
      _p.z = at[2];
      fx?.glow(_p, RED, msg.r || 24, msg.r || 24, msg.ct || 1.1, 3, 0.55, 3, null, 0.04, 0);
      fx?.glow(_p, ORANGE, 2.5, 5, msg.ct || 1.1, 3, 0.8, 4, null, 0.2, 0);
      ctx.audio?.play?.('combat.warden.lift', { position: _v.set(at[0], at[1] + 2, at[2]), volume: 1, duration: msg.ct || 1.1 });
    } else if (msg.phase === 'hit') {
      if (st.stomp) st.stomp.slam = true;
      _p.x = at[0];
      _p.y = Math.max(getH(at[0], at[2]), 0) + 0.2;
      _p.z = at[2];
      const r = msg.r || 24;
      const life = r / (msg.speed || 21);
      fx?.glow(_p, ORANGE, 1, r, life, 3, 1, 7, null, 0.07, 1);
      fx?.glow(_p, [1, 0.8, 0.6], 0.6, r * 0.96, life, 3, 0.7, 4, null, 0.18, 1);
      fx?.glow(_p, ORANGE, 2, 7, 0.5, 0, 1, 6);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        _a.set(_p.x + Math.cos(a) * 3, _p.y + 0.3, _p.z + Math.sin(a) * 3);
        fx?.smoke(_a, 2.5, 7, 1.6 + Math.random() * 0.8, DUST, 0.55, { x: Math.cos(a) * 6, y: 1.2, z: Math.sin(a) * 6 });
      }
      fx?.debris?.(_a.set(_p.x, _p.y + 0.5, _p.z), 16, 11, 0.2);
      _v.set(_p.x, _p.y, _p.z);
      shake(_v, 0.85);
      ctx.audio?.play?.('combat.warden.stomp', { position: _v, volume: 1 });
    }
  }

  function beam(msg, targetPos) {
    if (!Number.isFinite(msg.a0) || !Number.isFinite(msg.a1)) return;
    let dist = 40;
    if (targetPos && Array.isArray(msg.o)) dist = clamp(Math.hypot(targetPos.x - msg.o[0], targetPos.z - msg.o[2]), 14, msg.range || 60);
    st.beam = { a0: msg.a0, a1: msg.a1, dur: msg.dur || 2.2, ct: msg.ct || 1, t: 0, dist, range: msg.range || 62, spark: 0 };
    ctx.audio?.play?.('combat.warden.beam', { position: eyeWorld(_v), volume: 1, duration: (msg.ct || 1) + (msg.dur || 2.2) });
  }

  function summon(msg) {
    st.summon = 1.4;
    halo.updateWorldMatrix(true, false);
    for (let i = 0; i < 6; i++) {
      _a.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, 0).applyMatrix4(halo.matrixWorld);
      fx?.sparks(_a, _b.set(0, 1, 0), 6, CYAN, 6, 0.8, 0.6);
    }
    ctx.audio?.play?.('combat.warden.summon', { position: _a, volume: 0.9 });
    void msg;
  }

  function roar(msg) {
    st.roar = Math.max(st.roar, msg?.ct || 1.6);
    shake(st.pos, 0.5);
    ctx.audio?.play?.('combat.warden.roar', { position: eyeWorld(_v), volume: 1, duration: msg?.ct || 1.6 });
  }

  function die() {
    if (st.dead) return;
    st.dead = true;
    st.dying = 0;
    st.beam = null;
    st.stomp = null;
    ctx.audio?.play?.('combat.warden.die', { position: st.pos, volume: 1 });
  }

  // ------------------------------------------------------------ per frame
  let time = 0;
  /** rec: the enemies.js record (pos, h, flags, state, flash, speed). */
  function sync(rec, dt) {
    time += dt;
    if (!st.on) {
      st.on = true;
      root.visible = true;
      st.pos.copy(rec.pos);
      st.h = rec.h;
      st.dead = false;
      st.dying = 0;
    }
    const f = rec.flags | 0;
    const phase = f & BOSS_BITS.PHASE;
    const waking = !!(f & BOSS_BITS.WAKING);
    st.stagger = !!(f & BOSS_BITS.STAGGER) || rec.state === 'stunned';
    const runesNow = (f >> 3) & 7;
    for (let i = 0; i < 3; i++) {
      const broken = !!(runesNow & (1 << i));
      if (broken && !runes[i].broken) {
        runes[i].broken = true;
        runes[i].mesh.updateWorldMatrix(true, false);
        _a.setFromMatrixPosition(runes[i].mesh.matrixWorld);
        fx?.explosion?.(_a, 'shock', 3.2);
        fx?.debris?.(_a, 10, 9, 0.6);
        ctx.audio?.play?.('combat.warden.rune', { position: _a, volume: 1 });
        shake(_a, 0.4);
      } else if (!broken) runes[i].broken = false;
    }
    st.phase = phase;
    // kneel target: dormant 1, rising over the wake, staggered half down
    let kt = 0;
    if (phase === 0 && !waking) kt = 1;
    else if (waking) {
      st.wake = Math.min(1, st.wake + dt / 3.4);
      kt = 1 - st.wake;
    } else if (st.stagger) kt = 0.55;
    if (!waking && phase === 0) st.wake = 0;
    st.kneel = st.dead ? st.kneel : damp(st.kneel, kt, waking ? 3 : st.stagger ? 6 : 2.2, dt);
    // follow the record (heavy: slow smoothing)
    st.pos.x = damp(st.pos.x, rec.pos.x, 6, dt);
    st.pos.z = damp(st.pos.z, rec.pos.z, 6, dt);
    st.pos.y = damp(st.pos.y, rec.pos.y, 6, dt);
    st.h = dampAngle(st.h, rec.h, 4, dt);
    st.flash = Math.max(rec.flash || 0, st.flash - dt * 4);
    pose(rec, dt);
  }

  function pose(rec, dt) {
    const k = st.kneel;
    const t = time;
    root.position.copy(st.pos);
    root.rotation.set(0, st.h, 0);
    // walking: heavy alternating steps (+ a thud and a shake on every footfall)
    const sp = rec.speed || 0;
    const walking = sp > 0.4 && !st.dead && k < 0.2;
    st.walk = walking ? st.walk + dt * (0.55 + sp * 0.12) : st.walk;
    const ph = st.walk * Math.PI * 2;
    if (walking) {
      const side = Math.sin(ph) > 0 ? 1 : -1;
      if (side !== st.stepSide) {
        st.stepSide = side;
        const lg = legs[side > 0 ? 1 : 0];
        lg.shin.updateWorldMatrix(true, false);
        _a.setFromMatrixPosition(lg.shin.matrixWorld);
        _a.y = getH(_a.x, _a.z) + 0.3;
        fx?.smoke(_a, 1.5, 4.5, 1.2, DUST, 0.45);
        shake(_a, 0.22);
        ctx.audio?.play?.('combat.warden.step', { position: _a, volume: 0.8 });
      }
    }
    // stomp: lift the leg through the wind-up, slam on the hit
    const s = st.stomp;
    let liftL = 0;
    let liftR = 0;
    if (s) {
      s.t += dt;
      const u = clamp(s.t / s.ct, 0, 1);
      const lift = s.slam ? Math.max(0, 1 - (s.t - s.ct) * 9) : Math.sin(u * Math.PI * 0.5);
      if (s.side < 0) liftL = lift;
      else liftR = lift;
      if (s.slam && s.t > s.ct + 0.6) st.stomp = null;
    }
    const swing = walking ? Math.sin(ph) * 0.32 : 0;
    const bob = walking ? Math.abs(Math.cos(ph)) * 0.35 : Math.sin(t * 0.8) * 0.06;
    hips.position.y = 8.6 - k * WARDEN_KNEEL + bob - (liftL + liftR) * 0.4;
    hips.rotation.set(k * 0.12, 0, (liftR - liftL) * 0.08);
    for (const lg of legs) {
      const lift = lg.s < 0 ? liftL : liftR;
      const sw = lg.s < 0 ? swing : -swing;
      lg.thigh.rotation.set(-k * 1.25 - sw - lift * 0.95, 0, 0);
      lg.shin.rotation.set(k * 2.05 + Math.max(0, sw) * 0.5 + lift * 1.2, 0, 0);
    }
    // torso: leans in when kneeling, breathes, rears up on a roar
    st.roar = Math.max(0, st.roar - dt);
    const roarK = st.roar > 0 ? Math.min(1, st.roar * 2) : 0;
    torso.rotation.set(k * 0.38 - roarK * 0.22 + Math.sin(t * 0.7) * 0.015, 0, walking ? Math.sin(ph) * 0.03 : 0);
    // arms: fists on the ground when kneeling; swing when walking; raised in a roar
    const armSwing = walking ? Math.sin(ph) * 0.18 : 0;
    armL.rotation.set(k * 0.25 + armSwing - roarK * 0.9, 0, -0.08 - roarK * 0.4);
    armR.rotation.set(k * 0.25 - armSwing - roarK * 0.9, 0, 0.08 + roarK * 0.4);
    foreL.rotation.set(-0.25 - k * 0.5 - roarK * 0.6, 0, 0);
    foreR.rotation.set(-0.25 - k * 0.5 - roarK * 0.6, 0, 0);
    // head: bowed when dormant; tracks the beam's sweep
    let yaw = 0;
    let pitch = k * 0.45;
    let eyeK = st.dead ? Math.max(0, 1 - st.dying * 0.8) : k > 0.9 ? 0.18 + Math.sin(t * 1.3) * 0.05 : 1;
    const b = st.beam;
    if (b && !st.dead) {
      b.t += dt;
      const ts = b.t - b.ct;
      if (ts < 0) {
        // wind-up: aim at the start of the sweep, the eye charges up
        yaw = angleDiff(st.h, b.a0);
        eyeK = 1 + (b.t / b.ct) * 3;
        if (Math.random() < dt * 30) {
          eyeWorld(_a);
          _b.set(_a.x - Math.sin(b.a0) * b.dist, 0, _a.z - Math.cos(b.a0) * b.dist);
          _b.y = Math.max(getH(_b.x, _b.z), 0) + 1;
          fx?.beam(_a, _b, RED, 0.035, 0.05, 3);
        }
      } else if (ts <= b.dur) {
        const a = beamHeading(b.a0, b.a1, b.dur, ts);
        yaw = angleDiff(st.h, a);
        eyeK = 4.5;
        eyeWorld(_a);
        const reach = b.range;
        _b.set(_a.x - Math.sin(a) * b.dist, 0, _a.z - Math.cos(a) * b.dist);
        _b.y = Math.max(getH(_b.x, _b.z), 0) + 1.0;
        // extend past the target distance toward the ground (it burns everything in its line)
        _v.copy(_b).sub(_a).normalize().multiplyScalar(reach).add(_a);
        const gy = Math.max(getH(_v.x, _v.z), 0);
        if (_v.y < gy) _v.y = gy + 0.2;
        fx?.beam(_a, _v, RED, 0.75, 0.06, 6);
        fx?.beam(_a, _v, [1, 0.85, 0.7], 0.22, 0.06, 7);
        b.spark -= dt;
        if (b.spark <= 0) {
          b.spark = 0.05;
          _p.x = _b.x;
          _p.y = _b.y - 0.8;
          _p.z = _b.z;
          fx?.sparks(_p, _a.set(0, 1, 0), 3, ORANGE, 7, 0.9, 0.5);
          fx?.glow(_p, ORANGE, 1.4, 3.2, 0.25, 0, 0.8, 5);
          fx?.smoke(_p, 0.8, 2.4, 0.9, [0.2, 0.18, 0.16], 0.5);
        }
      } else st.beam = null;
    }
    head.rotation.set(pitch, clamp(yaw, -1.2, 1.2), 0);
    eyeMat.color.setRGB(9 * eyeK * (st.phase >= 3 ? 1.3 : 1), 0.6 * eyeK, 0.3 * eyeK);
    eyeGlow.material.color.setRGB(6 * Math.min(eyeK, 3), 0.5 * Math.min(eyeK, 3), 0.25 * Math.min(eyeK, 3));
    eyeGlow.scale.setScalar(2.2 + Math.min(eyeK, 4) * 1.3);
    // runes: breathe; flicker when staggered; dark once broken; the halo glows while summoning
    st.summon = Math.max(0, st.summon - dt);
    const runeK = k > 0.9 && st.phase === 0 ? 0.25 : st.stagger ? (Math.random() > 0.5 ? 1.6 : 0.2) : 1 + Math.sin(t * 2.2) * 0.2 + (st.phase >= 2 ? 0.3 : 0);
    for (const r of runes) {
      const v = r.broken ? 0.02 : runeK * (st.dead ? Math.max(0, 1 - st.dying) : 1);
      r.mat.color.setRGB(0.6 * v, 2.4 * v, 3.2 * v);
    }
    const u = mat.userData.u;
    u.uGlow.value = (k > 0.9 && st.phase === 0 ? 0.35 : 1) + st.summon * 1.5;
    u.uFlash.value = st.flash * 0.6;
    u.uHeat.value = st.phase >= 3 ? 0.6 + Math.sin(t * 6) * 0.25 : 0;
    // death: buckle, fall forward, crumble
    if (st.dead) {
      st.dying += dt;
      const d = st.dying;
      st.kneel = Math.min(1, st.kneel + dt * 0.8);
      root.rotation.x = clamp((d - 1.2) / 1.6, 0, 1) ** 2 * 1.35;
      u.uDis.value = clamp((d - 3.0) / 2.5, 0, 1);
      if (d > 0.4 && Math.random() < dt * 5 && d < 3.5) {
        _a.set(st.pos.x + (Math.random() - 0.5) * 10, st.pos.y + 4 + Math.random() * 10, st.pos.z + (Math.random() - 0.5) * 10);
        fx?.explosion?.(_a, 'fire', 2.2 + Math.random() * 1.5);
        fx?.debris?.(_a, 8, 8, 0.3);
      }
      if (d > 2.6 && !st.fell) {
        st.fell = true;
        shake(st.pos, 0.9);
        for (let i = 0; i < 10; i++) {
          _a.set(st.pos.x + (Math.random() - 0.5) * 14, st.pos.y + 0.5, st.pos.z + (Math.random() - 0.5) * 14);
          fx?.smoke(_a, 3, 9, 2.5, DUST, 0.6, { x: 0, y: 1.5, z: 0 });
        }
      }
      if (d > 5.6) hide();
    } else {
      root.rotation.x = 0;
      u.uDis.value = 0;
    }
  }

  function hide() {
    st.on = false;
    st.fell = false;
    root.visible = false;
    st.beam = null;
    st.stomp = null;
  }

  const _parts = new Float64Array(14 * 5);
  /** World hit spheres (shared WARDEN_PARTS at the visual's position + kneel) → out [x, y, z, r, part] × n. */
  function parts(rec, out = _parts) {
    return wardenParts(rec.pos.x, rec.pos.y, rec.pos.z, rec.h, out, st.kneel);
  }

  function dispose() {
    arena.removeFromParent();
    arena.geometry.dispose();
    arenaMat.dispose();
    root.removeFromParent();
    root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    mat.dispose();
    eyeMat.dispose();
    eyeGlow.material.dispose();
    glowTex.dispose();
    for (const m of runeMats) m.dispose();
  }

  return {
    group: root,
    sync,
    stomp,
    beam,
    summon,
    roar,
    die,
    hide,
    parts,
    dispose,
    get kneel() {
      return st.kneel;
    },
    get dead() {
      return st.dead;
    },
    get on() {
      return st.on;
    },
    eyeWorld,
  };
}
