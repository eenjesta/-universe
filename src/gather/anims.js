import * as THREE from 'three';

/**
 * Feature animations: while a world feature is being worked (or falls / breaks / is picked), the
 * frontier hides its instance (frontier.features.hide) and an animated proxy with the exact same
 * geometry, material, transform and colour takes over — a single-instance InstancedMesh, so it uses
 * the very same shader program (vegetation wind, rock tint) and the swap is invisible.
 *
 *   hit(f, { dir, tool, act, frac, mine })   per-hit shake / crack / flicker (+ particles + sound)
 *   finish(f, { state, dir, tool, mine, got, onCollect })  tree falls (pivot at the base, ground impact,
 *                                         dust, camera shake, logs fly to the harvester), rock breaks into
 *                                         chunks, crystal shatters, plant / berries / mushrooms are picked
 *   update(dt)
 * f = a feature record from frontier.features.near/get ({ id, kind, type, variant, name, x, y, z, rot, scale, biome }).
 */
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _s = new THREE.Vector3();

const ROCK_DUST = {
  meadow: [0.62, 0.58, 0.5],
  forest: [0.5, 0.5, 0.44],
  jungle: [0.45, 0.48, 0.4],
  highlands: [0.72, 0.74, 0.76],
  badlands: [0.72, 0.42, 0.28],
  peaks: [0.66, 0.68, 0.72],
  coast: [0.78, 0.72, 0.6],
  ocean: [0.6, 0.6, 0.6],
};
const LEAF = {
  pineTall: [0.12, 0.24, 0.1],
  pineMid: [0.12, 0.24, 0.1],
  spruce: [0.1, 0.22, 0.12],
  oak: [0.26, 0.38, 0.1],
  birch: [0.4, 0.46, 0.12],
  acacia: [0.34, 0.4, 0.12],
  jungleTree: [0.12, 0.36, 0.14],
  palm: [0.22, 0.42, 0.12],
};

// ------------------------------------------------------------------ rock crack material
const CRACK_FRAG_PARS = /* glsl */ `
uniform float uCrack;
uniform float uOre;
uniform float uFlash;
varying vec3 vObj;
vec3 gthHash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// distance to the nearest Voronoi edge (F2 − F1) + the owning cell's random value
vec2 gthCells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = gthHash3(i + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = o.x; }
    else if (d < f2) { f2 = d; }
  }
  return vec2(sqrt(max(f2, 0.0)) - sqrt(max(f1, 0.0)), id);
}
`;

function crackMaterial(base) {
  const m = base.clone();
  const U = { uCrack: { value: 0 }, uOre: { value: 0 }, uFlash: { value: 0 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CRACK_FRAG_PARS}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 c = gthCells(vObj * 2.6);
          vec2 c2 = gthCells(vObj * 5.3 + 7.1);
          float w = 0.03 + 0.07 * uCrack;
          float open = step(c.y, uCrack * 1.15);           // more cells crack as the rock takes damage
          float line = (1.0 - smoothstep(0.0, w, c.x)) * open;
          line = max(line, (1.0 - smoothstep(0.0, w * 0.6, c2.x)) * step(c2.y, uCrack * 0.8) * 0.7);
          diffuseColor.rgb *= 1.0 - 0.78 * line;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uFlash * 0.25);
          vGthLine = line;
        }`,
      )
      .replace('#include <common>', '#include <common>\nfloat vGthLine = 0.0;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vGthLine * uOre * vec3(1.6, 0.75, 0.25);`,
      );
  };
  m.customProgramCacheKey = () => `gather-crack-${base.name || 'rock'}`;
  m.userData.U = U;
  return m;
}

export function createAnims(ctx, { fx, sounds }) {
  const scene = ctx.world?.scene;
  const H = (x, z) => (ctx.world?.getHeightAt ? ctx.world.getHeightAt(x, z) : 0);
  const fr = () => ctx.frontier?.features || null;
  const proxies = new Map(); // id → proxy
  const leaving = []; // released proxies kept 2 frames (until the frontier has rebuilt the instance)

  function playerPos(out) {
    const p = ctx.player?.position;
    if (!p) return null;
    return out.set(p.x, p.y + 1.1, p.z);
  }

  function makeProxy(f) {
    const F = fr();
    if (!F) return null;
    let parts;
    try {
      parts = F.parts(f);
    } catch (err) {
      console.warn('[gather] proxy parts failed', err);
      return null;
    }
    if (!parts?.geometry) return null;
    let material = parts.material;
    let crack = null;
    if (parts.kind === 'rock') {
      // one clone per proxy (same program — the cache key is shared — own uniforms)
      material = crackMaterial(material);
      crack = material.userData.U;
    }
    const mesh = new THREE.InstancedMesh(parts.geometry, material, 1);
    mesh.name = `gather-proxy-${f.id}`;
    if (parts.depthMaterial) mesh.customDepthMaterial = parts.depthMaterial;
    mesh.castShadow = parts.kind !== 'mushroom';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    _q.setFromAxisAngle(UP, f.rot);
    _m.compose(_v.set(f.x, f.y, f.z), _q, _s.setScalar(f.scale));
    mesh.setMatrixAt(0, _m);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(parts.color), 3);
    scene?.add(mesh);
    F.hide(f.id, true);
    const p = {
      id: f.id,
      f: { ...f },
      parts,
      mesh,
      crack: crack ? { u: crack, value: 0, ore: f.kind === 2 && (f.name === 'shard' || f.name === 'outcrop' || f.name === 'hoodoo') ? 1 : 0, flash: 0, mat: material } : null,
      shakeT: 9,
      shakeA: 0,
      shakeDir: new THREE.Vector3(1, 0, 0),
      squash: 0,
      idle: 0,
      phase: 'idle', // idle | fall | ground | dissolve | break | pick | done
      t: 0,
      angle: 0,
      omega: 0,
      maxAngle: Math.PI / 2,
      fallDir: new THREE.Vector3(1, 0, 0),
      bounced: 0,
      opts: null,
    };
    if (crack) {
      mesh.onBeforeRender = () => {
        crack.uCrack.value = p.crack.value;
        crack.uOre.value = p.crack.ore;
        crack.uFlash.value = p.crack.flash;
      };
    }
    proxies.set(f.id, p);
    return p;
  }

  function release(p) {
    if (proxies.get(p.id) === p) proxies.delete(p.id);
    // the instance comes back (or stays gone when the frontier state says felled / broken / picked);
    // the proxy stays two more frames so the swap never shows a gap
    fr()?.hide(p.id, false);
    p.leave = 2;
    leaving.push(p);
  }

  function drop(p) {
    scene?.remove(p.mesh);
    p.mesh.dispose();
    p.crack?.mat?.dispose();
  }

  /** Base matrix (T·R·S of the instance) premultiplied by a pivot rotation about the base. */
  function pose(p, q, lift = 0, sx = 1, sy = 1) {
    const f = p.f;
    _m2.compose(_v.set(0, 0, 0), q, _s.set(sx, sy, sx));
    // object matrix = T(base) · R · S · T(−base)
    _m.makeTranslation(f.x, f.y + lift, f.z).multiply(_m2);
    _m2.makeTranslation(-f.x, -f.y, -f.z);
    _m.multiply(_m2);
    p.mesh.matrix.copy(_m);
    p.mesh.matrixWorldNeedsUpdate = true;
  }

  const impact = new THREE.Vector3();
  /** World point where a tool strikes the feature (trunk height / rock face toward the harvester). */
  function strikePoint(f, parts, dir, out) {
    const r = parts.kind === 'tree' ? Math.max(0.15, parts.trunkR || 0.3) : parts.kind === 'rock' ? Math.max(0.3, (parts.height || 1) * 0.6) : 0.35 * f.scale;
    const h = parts.kind === 'tree' ? 1.05 : parts.kind === 'rock' ? Math.min(1.2, (parts.height || 1) * 0.45) : parts.kind === 'crystal' ? 0.9 * f.scale : 0.3;
    out.set(f.x - dir.x * r, f.y + h, f.z - dir.z * r);
    return out;
  }

  /** One hit landed on feature f (any player). dir = unit XZ from the harvester to the feature. */
  function hit(f, o = {}) {
    let p = proxies.get(f.id) || makeProxy(f);
    if (!p) return;
    const dir = _v2.set(o.dir?.[0] ?? o.dir?.x ?? 1, 0, o.dir?.[1] ?? o.dir?.z ?? 0);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    p.idle = 0;
    const at = strikePoint(f, p.parts, dir, impact);
    const back = _v.set(-dir.x, 0.25, -dir.z);
    const frac = Math.max(0, Math.min(1, o.frac ?? 0.3));
    const kind = p.parts.kind;
    const near = Math.hypot((ctx.player?.position?.x ?? 1e9) - f.x, (ctx.player?.position?.z ?? 1e9) - f.z);
    if (kind === 'tree') {
      p.shakeT = 0;
      p.shakeA = 0.022 + 0.03 * frac;
      p.shakeDir.copy(dir);
      fx.burst('chip', at, { n: 10 + Math.round(frac * 6), dir: back, speed: 3.6, spread: 0.7, up: 0.5 });
      fx.burst('bark', at, { n: 4, dir: back, speed: 2.4, spread: 0.9, up: 0.4 });
      // leaves drift down from the crown
      const crown = _v.set(f.x, f.y + (p.parts.height || 10) * 0.72, f.z);
      fx.burst('leaf', crown, { n: 4 + Math.round(frac * 5), speed: 0.8, spread: 1, up: 0.1, radius: (p.parts.height || 10) * 0.18, color: LEAF[f.name] });
      ctx.audio?.play?.('gather.chop', { position: at, wood: frac, pitch: o.tool === 'multitool' ? 1.08 : 1 });
    } else if (kind === 'rock') {
      p.squash = 1;
      p.crack.value = Math.max(p.crack.value, 0.08 + frac * 0.92);
      p.crack.flash = 1;
      const dust = ROCK_DUST[f.biome] || ROCK_DUST.meadow;
      if (o.tool === 'mining-laser') {
        fx.burst('ember', at, { n: 12, dir: back, speed: 3, spread: 0.9, up: 0.6 });
        fx.burst('glint', at, { n: 2, speed: 0.2 });
        fx.burst('flash', at, { n: 1, speed: 0, color: [1.4, 3.2, 4.4], size: 0.3 });
        ctx.audio?.play?.('gather.laser', { position: at });
      } else {
        fx.burst('spark', at, { n: 10 + (p.crack.ore ? 10 : 0), dir: back, speed: 6, spread: 0.85, up: 0.5 });
        fx.burst('flash', at, { n: 1, speed: 0, color: p.crack.ore ? [3.2, 2.0, 0.9] : [2.4, 2.0, 1.6], size: 0.28 });
        ctx.audio?.play?.('gather.mine', { position: at, ore: p.crack.ore });
      }
      fx.burst('crumb', at, { n: 6, dir: back, speed: 2.6, spread: 0.8, up: 0.6, color: dust });
      fx.burst('dust', at, { n: 3, dir: back, speed: 0.9, spread: 0.6, up: 0.3, color: dust });
      if (near < 6) ctx.cameraRig?.shake?.(0.05);
    } else if (kind === 'crystal') {
      p.squash = 0.6;
      fx.burst('shard', at, { n: 12, dir: back, speed: 4.2, spread: 0.9, up: 0.6 });
      fx.burst('glint', at, { n: 3, speed: 0.3 });
      fx.burst('flash', at, { n: 1, speed: 0, color: [1.2, 3.0, 4.2], size: 0.4 });
      ctx.audio?.play?.(o.tool === 'mining-laser' ? 'gather.laser' : 'gather.mine', { position: at, pitch: 1.25 });
    } else {
      p.squash = 0.8;
      ctx.audio?.play?.('gather.rustle', { position: at });
    }
  }

  /** The feature is done (felled / broken / picked) — big animation; `got` = what the harvester received. */
  function finish(f, o = {}) {
    let p = proxies.get(f.id) || makeProxy(f);
    if (!p) return;
    p.opts = o;
    p.t = 0;
    p.idle = 0;
    const dir = _v2.set(o.dir?.[0] ?? o.dir?.x ?? 1, 0, o.dir?.[1] ?? o.dir?.z ?? 0);
    if (dir.lengthSq() < 1e-6) dir.set(Math.cos(f.rot), 0, Math.sin(f.rot));
    dir.normalize();
    const kind = p.parts.kind;
    if (kind === 'tree') {
      p.phase = 'fall';
      p.fallDir.copy(dir);
      // the last chop gives it a shove: a short hesitation, then it goes (≈ 2–2.5 s to the ground)
      p.angle = 0.035;
      p.omega = 0.34;
      // where does the crown meet the ground? (downhill → beyond 90°)
      const L = Math.max(4, (p.parts.height || 10) * 0.6);
      const gy = H(f.x + dir.x * L, f.z + dir.z * L);
      const slope = Math.atan2(gy - f.y, L);
      p.maxAngle = Math.max(1.15, Math.min(1.95, Math.PI / 2 - slope)) - 0.04;
      ctx.audio?.play?.('gather.creak', { position: _v.set(f.x, f.y + 3, f.z) });
      fx.burst('chip', strikePoint(f, p.parts, dir, impact), { n: 16, dir: _v.set(-dir.x, 0.3, -dir.z), speed: 4, spread: 0.8 });
    } else if (kind === 'rock' || kind === 'crystal') {
      p.phase = 'break';
      breakApart(p, dir);
    } else {
      p.phase = 'pick';
      const at = _v.set(f.x, f.y + 0.4 * f.scale, f.z);
      if (f.kind === 1 && !isHidingPlant(f)) {
        // berry bush: the bush stays, the crop pops off (the frontier already hid the crop instance)
        p.phase = 'done';
        fx.burst('berry', at.set(f.x, f.y + 0.9 * f.scale, f.z), { n: 14, speed: 2, spread: 1, up: 0.8, radius: 0.6 * f.scale, color: f.name === 'bushJuniper' ? [0.2, 0.18, 0.62] : [0.78, 0.07, 0.12] });
        fx.burst('leaf', at, { n: 5, speed: 1, spread: 1, up: 0.3, radius: 0.5, color: [0.2, 0.34, 0.12] });
      } else if (f.kind === 4) {
        fx.burst(f.variant === 1 ? 'mote' : 'crumb', at, { n: 8, speed: 1.2, spread: 1, up: 0.8, color: f.variant === 1 ? null : [0.55, 0.36, 0.22] });
      } else if (f.kind === 2) {
        fx.burst('crumb', at, { n: 6, speed: 1.2, spread: 1, up: 0.7, color: ROCK_DUST[f.biome] || ROCK_DUST.meadow });
      } else {
        fx.burst('fiber', at, { n: 10, speed: 1.6, spread: 1, up: 0.7, radius: 0.4 * f.scale, color: f.name === 'glowPlant' ? [0.25, 0.75, 0.65] : null });
        if (f.name === 'glowPlant') fx.burst('mote', at, { n: 10, speed: 1, spread: 1, up: 1 });
      }
      ctx.audio?.play?.('gather.pick', { position: at });
      ctx.audio?.play?.('gather.rustle', { position: at, duration: 0.28 });
      if (o.mine) collect(p, at, 1);
    }
  }

  const isHidingPlant = (f) => f.kind !== 1 || (f.name !== 'bushGreen' && f.name !== 'bushJuniper');

  function breakApart(p, dir) {
    const f = p.f;
    const kind = p.parts.kind;
    const size = Math.max(0.5, Math.min(2.5, (p.parts.height || 1) / 1.2));
    const c = _v.set(f.x, f.y + Math.min(1, size * 0.5), f.z);
    p.mesh.visible = false;
    if (kind === 'crystal') {
      fx.burst('flash', c, { n: 1, speed: 0, color: [1.6, 4.0, 5.6], size: 1.3, life: 0.32 });
      fx.burst('shard', c, { n: 56, speed: 6.5, spread: 1, up: 0.8, radius: 0.5 * f.scale });
      fx.burst('shard', c, { n: 20, speed: 2.2, spread: 1, up: 1.2, radius: 0.7 * f.scale, life: 1.6 });
      fx.burst('glint', c, { n: 8, speed: 0.6, radius: 0.7 });
      fx.burst('mote', c, { n: 30, speed: 1.6, spread: 1, up: 1.2, color: [1.2, 3.4, 5.0], radius: 0.7, life: 2.4 });
      fx.debris('rock', c, { n: 6, speed: 4, scale: 0.16 * f.scale, color: [0.35, 0.75, 0.9], life: 2.5 });
      ctx.audio?.play?.('gather.shatter', { position: c });
    } else {
      const tint = p.parts.color;
      const dust = ROCK_DUST[f.biome] || ROCK_DUST.meadow;
      fx.debris('rock', c, { n: Math.round(6 + size * 4), speed: 3.5 + size, scale: 0.16 + 0.12 * size, color: tint, life: 4, dir: _v2.set(dir.x * 0.4, 0, dir.z * 0.4), spread: 0.9 });
      fx.burst('dust', c, { n: Math.round(8 + size * 6), speed: 1.6, spread: 1, up: 0.4, color: dust, radius: 0.5 * size, size: 1.0 });
      fx.burst('crumb', c, { n: 18, speed: 4, spread: 1, up: 0.7, color: dust });
      if (p.crack?.ore) fx.burst('spark', c, { n: 18, speed: 6, spread: 1, up: 0.6 });
      ctx.audio?.play?.('gather.crumble', { position: c, size });
    }
    const near = Math.hypot((ctx.player?.position?.x ?? 1e9) - f.x, (ctx.player?.position?.z ?? 1e9) - f.z);
    if (near < 12) ctx.cameraRig?.shake?.(0.16 * (1 - near / 12) + 0.04);
    if (p.opts?.mine) collect(p, c, kind === 'crystal' ? 3 : Math.min(5, Math.round(2 + size * 1.5)));
    p.phase = 'done';
    p.t = 0;
  }

  /** Pickup pieces fly from `at` to the harvester; the float + pop happen on arrival (collect callback). */
  function collect(p, at, n) {
    const o = p.opts || {};
    const target = () => playerPos(tgt);
    let arrived = 0;
    const kind = p.parts.kind === 'tree' ? 'log' : 'rock';
    const color = p.parts.kind === 'rock' ? p.parts.color : p.parts.kind === 'crystal' ? [0.4, 0.85, 1] : null;
    if (p.parts.kind === 'tree') return; // logs are spawned by the dissolve step
    if (p.parts.kind !== 'rock' && p.parts.kind !== 'crystal') {
      // plants: no debris, just the reward at once
      o.onCollect?.(true);
      ctx.audio?.play?.('gather.pop', { n: 0 });
      return;
    }
    fx.debris(kind, at, {
      n,
      speed: 2.5,
      up: 1.1,
      scale: kind === 'rock' ? 0.13 : 0.12,
      color,
      magnet: target,
      delay: 0.55,
      onArrive: (k) => {
        ctx.audio?.play?.('gather.pop', { n: arrived++ });
        if (arrived === 1) o.onCollect?.(true);
      },
    });
  }
  const tgt = new THREE.Vector3();

  function updateProxy(p, dt) {
    const f = p.f;
    p.t += dt;
    if (p.phase === 'idle') {
      p.idle += dt;
      // shake (damped wobble away from the hit) / squash
      p.shakeT += dt;
      if (p.parts.kind === 'tree') {
        const a = p.shakeA * Math.exp(-p.shakeT * 5.5) * Math.sin(p.shakeT * 26);
        _axis.set(p.shakeDir.z, 0, -p.shakeDir.x); // horizontal, ⟂ to the hit
        _q.setFromAxisAngle(_axis, -a);
        pose(p, _q);
      } else if (p.squash > 0) {
        p.squash = Math.max(0, p.squash - dt * 6);
        const k = p.squash * p.squash;
        _q.identity();
        pose(p, _q, 0, 1 + 0.035 * k, 1 - 0.05 * k);
      }
      if (p.crack) p.crack.flash = Math.max(0, p.crack.flash - dt * 7);
      // nobody works on it any more: give the instance back
      if (p.idle > 5) release(p);
      return;
    }
    if (p.phase === 'fall') {
      // rod pivoting about its base: ω' = (3g / 2L) sin θ
      const L = Math.max(3, (p.parts.height || 10) * 0.85);
      p.omega += ((3 * 9.8) / (2 * L)) * Math.sin(Math.max(0.02, p.angle)) * dt;
      p.angle += p.omega * dt;
      if (p.angle >= p.maxAngle) {
        p.angle = p.maxAngle;
        if (p.bounced < 2 && p.omega > 0.4) {
          if (p.bounced === 0) groundImpact(p);
          p.omega = -p.omega * (p.bounced === 0 ? 0.18 : 0.1);
          p.bounced++;
        } else {
          p.omega = 0;
          p.phase = 'ground';
          p.t = 0;
        }
      }
      _axis.set(p.fallDir.z, 0, -p.fallDir.x);
      _q.setFromAxisAngle(_axis, -p.angle);
      pose(p, _q, 0.02 * Math.sin(Math.min(p.angle, 1.5)));
      return;
    }
    if (p.phase === 'ground') {
      if (p.t > 1.5) {
        p.phase = 'dissolve';
        p.t = 0;
        spawnLogs(p);
      }
      return;
    }
    if (p.phase === 'dissolve') {
      const k = Math.min(1, p.t / 0.55);
      const s = 1 - k * k;
      _axis.set(p.fallDir.z, 0, -p.fallDir.x);
      _q.setFromAxisAngle(_axis, -p.maxAngle);
      pose(p, _q, 0, Math.max(0.001, s), Math.max(0.001, s));
      if (k >= 1) {
        p.phase = 'done';
        p.mesh.visible = false;
      }
      return;
    }
    if (p.phase === 'pick') {
      const k = Math.min(1, p.t / 0.32);
      const s = k < 0.35 ? 1 + 0.18 * (k / 0.35) : 1.18 * (1 - (k - 0.35) / 0.65);
      _q.identity();
      pose(p, _q, 0.15 * k, Math.max(0.001, s), Math.max(0.001, s));
      if (k >= 1) {
        p.phase = 'done';
        p.mesh.visible = false;
      }
      return;
    }
    if (p.phase === 'done' && p.t > 0.1) release(p);
  }

  function groundImpact(p) {
    const f = p.f;
    const L = (p.parts.height || 10) * 0.9;
    const a = _v.set(f.x, f.y + 0.3, f.z);
    const b = _v2.set(f.x + p.fallDir.x * L, H(f.x + p.fallDir.x * L, f.z + p.fallDir.z * L) + 0.3, f.z + p.fallDir.z * L);
    const dust = ROCK_DUST[f.biome] || ROCK_DUST.meadow;
    fx.dustLine(a, b, Math.round(10 + L * 0.8), dust, 1.3);
    const crown = _v.set(f.x + p.fallDir.x * L * 0.75, b.y + 1, f.z + p.fallDir.z * L * 0.75);
    fx.burst('leaf', crown, { n: 26, speed: 2.4, spread: 1, up: 0.6, radius: L * 0.18, color: LEAF[f.name] });
    fx.burst('chip', crown, { n: 8, speed: 3, spread: 1, up: 0.8 });
    ctx.audio?.play?.('gather.crash', { position: crown, size: Math.min(1.5, L / 12) });
    const pp = ctx.player?.position;
    if (pp) {
      const d = Math.min(Math.hypot(pp.x - f.x, pp.z - f.z), Math.hypot(pp.x - crown.x, pp.z - crown.z));
      if (d < 30) ctx.cameraRig?.shake?.(0.32 * (1 - d / 30) + 0.04);
    }
  }

  function spawnLogs(p) {
    const f = p.f;
    const L = (p.parts.height || 10) * 0.55;
    const r = Math.max(0.12, (p.parts.trunkR || 0.25) * 0.95);
    const a = _v.set(f.x + p.fallDir.x * 0.8, f.y + r + 0.05, f.z + p.fallDir.z * 0.8);
    const b = _v2.set(f.x + p.fallDir.x * L, 0, f.z + p.fallDir.z * L);
    b.y = H(b.x, b.z) + r + 0.05;
    const n = Math.max(2, Math.min(4, Math.round(L / 3)));
    const axis = new THREE.Vector3(p.fallDir.x, 0, p.fallDir.z).normalize();
    fx.burst('leaf', b, { n: 18, speed: 1.8, spread: 1, up: 0.8, radius: L * 0.25, color: LEAF[f.name] });
    fx.dustLine(a, b, 8, ROCK_DUST[f.biome], 0.9);
    const o = p.opts || {};
    let arrived = 0;
    fx.debris('log', a, {
      n,
      along: [a.clone(), b.clone()],
      axis,
      speed: 1.2,
      up: 1.3,
      spread: 0.3,
      spin: 2,
      scale: [Math.min(1.6, L / n) * 0.9, r, r],
      life: 6,
      magnet: o.mine ? () => playerPos(tgt) : null,
      delay: 0.7,
      onArrive: () => {
        ctx.audio?.play?.('gather.pop', { n: arrived++ });
        if (arrived === 1) o.onCollect?.(true);
      },
    });
    if (!o.mine) o.onCollect?.(false);
  }

  function update(dt) {
    for (const p of proxies.values()) updateProxy(p, dt);
    for (let i = leaving.length - 1; i >= 0; i--) {
      if (--leaving[i].leave <= 0) {
        drop(leaving[i]);
        leaving.splice(i, 1);
      }
    }
  }

  /** Drop every proxy (mode change / dispose); instances come back. */
  function clear() {
    for (const p of [...proxies.values()]) release(p);
    for (const p of leaving) drop(p);
    leaving.length = 0;
  }

  return {
    hit,
    finish,
    update,
    clear,
    has: (id) => proxies.has(id),
    /** Proxy state of a feature (tests / debugging): { phase, t, angle, maxAngle } | null. */
    debug(id) {
      const p = proxies.get(id);
      return p ? { phase: p.phase, t: +p.t.toFixed(3), angle: +p.angle.toFixed(3), maxAngle: +p.maxAngle.toFixed(3), height: p.parts.height } : null;
    },
    get count() {
      return proxies.size;
    },
    dispose() {
      clear();
    },
  };
}
