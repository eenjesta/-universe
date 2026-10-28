/**
 * Vehicles — particle FX for the driven vehicle: rotor-wash spray on water,
 * dust on land (VTOL/ship), dust/splash behind the car. One pooled Points
 * mesh (CPU-integrated, ~260 particles, one draw call) with soft round
 * sprites. GPU-safe shader (no pow/normalize, smoothstep edges ordered).
 */
import * as THREE from 'three';

const N = 260;
const VERT = /* glsl */ `
attribute vec4 aData; // size, alpha, kind, seed
varying float vAlpha;
varying float vKind;
varying float vSeed;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(0.5, -mv.z);
  gl_PointSize = clamp(aData.x * uScale / dist, 0.0, 256.0);
  vAlpha = aData.y;
  vKind = aData.z;
  vSeed = aData.w;
}`;
const FRAG = /* glsl */ `
varying float vAlpha;
varying float vKind;
varying float vSeed;
uniform vec3 uSpray;
uniform vec3 uDust;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vAlpha;
  if (a < 0.003) discard;
  vec3 c = vKind > 0.5 ? uDust : uSpray;
  c *= 0.85 + 0.3 * fract(vSeed * 13.7);
  gl_FragColor = vec4(c, a);
}`;

export function createFx(ctx) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const data = new Float32Array(N * 4);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aData', new THREE.BufferAttribute(data, 4).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uScale: { value: 300 },
      uSpray: { value: new THREE.Color(0xe8f2f6) },
      uDust: { value: new THREE.Color(0xa88d70) },
    },
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'veh-fx';
  points.renderOrder = 4;
  ctx.world.scene.add(points);
  ctx.world.atmosphere?.excludeFromReflection?.(points);
  const P = [];
  for (let i = 0; i < N; i++) P.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 2, kind: 0, a: 0.6, seed: Math.random() });
  let head = 0;
  let alive = 0;

  const fx = {
    points,
    emit(x, y, z, vx, vy, vz, life, s0, s1, kind, a = 0.6) {
      const p = P[head];
      head = (head + 1) % N;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = vx;
      p.vy = vy;
      p.vz = vz;
      p.life = life;
      p.max = life;
      p.s0 = s0;
      p.s1 = s1;
      p.kind = kind;
      p.a = a;
    },
    /** Rotor wash ring around (x, z) at surface height y. strength 0…1. */
    wash(x, y, z, strength, water, dt, radius = 6) {
      const n = Math.min(12, Math.floor(strength * 90 * dt + Math.random()));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = radius * (0.5 + Math.random() * 0.7);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const sp = 7 + Math.random() * 9 * strength;
        if (water) fx.emit(x + c * r, y + 0.2, z + s * r, c * sp, 2 + Math.random() * 4, s * sp, 0.9 + Math.random() * 0.6, 1.4, 4.2, 0, 0.55);
        else fx.emit(x + c * r, y + 0.3, z + s * r, c * sp * 0.7, 0.6 + Math.random() * 1.5, s * sp * 0.7, 1.6 + Math.random(), 2.5, 7.5, 1, 0.32);
      }
    },
    update(dt) {
      alive = 0;
      for (let i = 0; i < N; i++) {
        const p = P[i];
        const o = i * 4;
        if (p.life <= 0) {
          data[o + 1] = 0;
          data[o] = 0;
          continue;
        }
        p.life -= dt;
        const k = 1 - Math.max(0, p.life) / p.max;
        const drag = p.kind ? 1.6 : 1.1;
        p.vx -= p.vx * drag * dt;
        p.vz -= p.vz * drag * dt;
        p.vy -= (p.kind ? 0.6 : 9) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        data[o] = p.s0 + (p.s1 - p.s0) * k;
        data[o + 1] = p.a * (1 - k) * Math.min(1, k * 8);
        data[o + 2] = p.kind;
        data[o + 3] = p.seed;
        alive++;
      }
      points.visible = alive > 0;
      if (alive) {
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aData.needsUpdate = true;
      }
      mat.uniforms.uScale.value = (ctx.engine.height || 720) * 0.6;
    },
    clear() {
      for (const p of P) p.life = 0;
    },
  };
  return fx;
}
