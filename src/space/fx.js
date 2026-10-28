import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

/**
 * Space effects, each one draw call, pooled, no per-frame allocations:
 *   particles  additive sparks/fire/smoke-glow (CPU sim, Points)
 *   flashes    camera-facing glow + shock-ring quads (explosions, muzzles, hits)
 *   debris     tumbling hull chunks after kills (InstancedMesh)
 *   trails     engine ribbons (camera-facing strips rebuilt on the CPU)
 *   dust       wrap-around streak lines that stretch with speed (speed lines)
 *   shield     hex-rippled bubble around the player on hits
 *
 *   fx.explosion(pos, scale, {color})   fx.sparks(pos, normal, n, color)
 *   fx.flash(pos, size, color, life, ring)   fx.trail() → {push(p, on), reset()}
 *   fx.shieldHit(dirLocal)   fx.update(dt, camera, shipVel, boost)
 */

const MAX_P = 2600;
const MAX_F = 72;
const MAX_D = 140;
const TRAILS = 26;
const TRAIL_PTS = 22;

const P_VERT = /* glsl */ `
  attribute vec4 aColor;   // rgb (HDR), alpha
  attribute float aSize;   // metres
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(-mv.z, 0.5);
    gl_PointSize = clamp(aSize * uScale / d, 0.0, 160.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const P_FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 3.0) * vColor.a;
    gl_FragColor = vec4(min(vColor.rgb * a, vec3(30.0)), 1.0);
  }
`;
const F_VERT = /* glsl */ `
  attribute vec4 aFlash; // rgb, size
  attribute float aShape; // 0 glow, 1 ring; fractional part = ring radius progress
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vShape;
  void main() {
    vUv = uv;
    vCol = aFlash.rgb;
    vShape = aShape;
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    c.xy += position.xy * aFlash.w;
    gl_Position = projectionMatrix * c;
  }
`;
const F_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vShape;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float glow = exp(-r * r * 7.0) + exp(-r * 3.0) * 0.25;
    float q = (r - 0.82) / 0.07;
    float ringS = exp(-q * q) * (1.0 - smoothstep(0.9, 1.0, r));
    float a = vShape > 0.5 ? ringS : glow;
    a *= 1.0 - smoothstep(0.92, 1.0, r);
    gl_FragColor = vec4(min(vCol * a, vec3(40.0)), 1.0);
  }
`;
const DUST_VERT = /* glsl */ `
  attribute float aEnd;
  uniform vec3 uCam;
  uniform vec3 uVel;
  uniform float uHalf;
  uniform float uStretch;
  varying float vA;
  void main() {
    vec3 rel = mod(position - uCam + uHalf, 2.0 * uHalf) - uHalf;
    float d = length(rel);
    vA = (1.0 - smoothstep(uHalf * 0.45, uHalf * 0.95, d)) * smoothstep(4.0, 25.0, d);
    vec3 p = uCam + rel - uVel * uStretch * aEnd;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() { gl_FragColor = vec4(uColor * vA, 1.0); }
`;
const TRAIL_FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() { gl_FragColor = vec4(min(vColor.rgb * vColor.a, vec3(20.0)), 1.0); }
`;
const TRAIL_VERT = /* glsl */ `
  attribute vec4 aColor;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SHIELD_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vLocal;
  varying vec3 vView;
  void main() {
    vLocal = normalize(position);
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const SHIELD_FRAG = /* glsl */ `
  uniform vec3 uHitDir;
  uniform float uHit;
  uniform float uTime;
  uniform vec3 uColor;
  varying vec3 vN;
  varying vec3 vLocal;
  varying vec3 vView;
  void main() {
    vec3 v = vView / max(length(vView), 1e-4);
    float fres = 1.0 - abs(dot(vN, v));
    fres = fres * fres * fres;
    float ang = acos(clamp(dot(vLocal, uHitDir), -1.0, 1.0));
    float front = exp(-abs(ang - (1.0 - uHit) * 2.4) * 9.0);
    float spot = exp(-ang * 4.0) * uHit;
    // hex-ish cells
    vec2 hp = vec2(atan(vLocal.z, vLocal.x + 1e-4) * 6.0, vLocal.y * 9.0);
    vec2 cell = abs(fract(hp) - 0.5);
    float edge = smoothstep(0.38, 0.5, max(cell.x, cell.y));
    float a = (front * (0.5 + edge) + spot * 1.5 + fres * 0.25) * uHit;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

export function createFx(ctx, { quality }) {
  const lowQ = quality.id === 'low';
  const rng = mulberry32(9);
  const group = new THREE.Group();
  group.name = 'space-fx';

  // ---------------------------------------------------------- particles
  const pPos = new Float32Array(MAX_P * 3);
  const pCol = new Float32Array(MAX_P * 4);
  const pSize = new Float32Array(MAX_P);
  const pVel = new Float32Array(MAX_P * 3);
  const pLife = new Float32Array(MAX_P);
  const pMax = new Float32Array(MAX_P);
  const pBase = new Float32Array(MAX_P * 3);
  const pSize0 = new Float32Array(MAX_P);
  const pKind = new Uint8Array(MAX_P); // 0 spark, 1 fire, 2 glow-smoke
  const pDrag = new Float32Array(MAX_P);
  let pHead = 0;
  let pHigh = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: P_VERT,
    fragmentShader: P_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  group.add(points);

  function emit(x, y, z, vx, vy, vz, life, size, r, g, b, kind = 0, drag = 0.6) {
    const i = pHead;
    pHead = (pHead + 1) % MAX_P;
    if (i + 1 > pHigh) pHigh = i + 1;
    pPos[i * 3] = x;
    pPos[i * 3 + 1] = y;
    pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx;
    pVel[i * 3 + 1] = vy;
    pVel[i * 3 + 2] = vz;
    pLife[i] = life;
    pMax[i] = life;
    pSize0[i] = size;
    pBase[i * 3] = r;
    pBase[i * 3 + 1] = g;
    pBase[i * 3 + 2] = b;
    pKind[i] = kind;
    pDrag[i] = drag;
    return i;
  }

  // ---------------------------------------------------------- flashes
  const quad = new THREE.PlaneGeometry(2, 2);
  const fGeo = new THREE.InstancedBufferGeometry();
  fGeo.index = quad.index;
  fGeo.setAttribute('position', quad.attributes.position);
  fGeo.setAttribute('uv', quad.attributes.uv);
  const fData = new Float32Array(MAX_F * 4);
  const fShape = new Float32Array(MAX_F);
  fGeo.setAttribute('aFlash', new THREE.InstancedBufferAttribute(fData, 4).setUsage(THREE.DynamicDrawUsage));
  fGeo.setAttribute('aShape', new THREE.InstancedBufferAttribute(fShape, 1).setUsage(THREE.DynamicDrawUsage));
  const fMat = new THREE.ShaderMaterial({
    vertexShader: F_VERT,
    fragmentShader: F_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flashes = new THREE.InstancedMesh(fGeo, fMat, MAX_F);
  flashes.frustumCulled = false;
  flashes.renderOrder = 5;
  group.add(flashes);
  const fl = Array.from({ length: MAX_F }, () => ({ life: 0, max: 1, size: 1, grow: 0, ring: 0, pos: new THREE.Vector3(), col: new THREE.Color() }));
  let fHead = 0;
  function flash(pos, size, color, life = 0.25, ring = false, grow = 0) {
    const f = fl[fHead];
    fHead = (fHead + 1) % MAX_F;
    f.pos.copy(pos);
    f.size = size;
    f.col.copy(color);
    f.life = f.max = life;
    f.ring = ring ? 1 : 0;
    f.grow = grow;
  }

  // ---------------------------------------------------------- debris chunks
  const dGeo = new THREE.TetrahedronGeometry(1, 0);
  dGeo.scale(1, 0.5, 1.6);
  const dMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.7, roughness: 0.5, emissive: new THREE.Color(1.0, 0.35, 0.1), emissiveIntensity: 0.6 });
  const debris = new THREE.InstancedMesh(dGeo, dMat, MAX_D);
  debris.frustumCulled = false;
  group.add(debris);
  const dd = Array.from({ length: MAX_D }, () => ({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), spin: new THREE.Vector3(), size: 1 }));
  let dHead = 0;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_D; i++) debris.setMatrixAt(i, zero);

  // ---------------------------------------------------------- trails
  const tPos = new Float32Array(TRAILS * TRAIL_PTS * 2 * 3);
  const tCol = new Float32Array(TRAILS * TRAIL_PTS * 2 * 4);
  const tIdx = [];
  for (let t = 0; t < TRAILS; t++) {
    for (let i = 0; i < TRAIL_PTS - 1; i++) {
      const a = (t * TRAIL_PTS + i) * 2;
      tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('aColor', new THREE.BufferAttribute(tCol, 4).setUsage(THREE.DynamicDrawUsage));
  tGeo.setIndex(tIdx);
  const tMat = new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const trailMesh = new THREE.Mesh(tGeo, tMat);
  trailMesh.frustumCulled = false;
  trailMesh.renderOrder = 3;
  group.add(trailMesh);
  const trails = [];
  const _seg = new THREE.Vector3();
  for (let t = 0; t < TRAILS; t++) {
    trails.push({
      used: false,
      pts: Array.from({ length: TRAIL_PTS }, () => new THREE.Vector3()),
      on: new Uint8Array(TRAIL_PTS),
      n: 0,
      width: 1,
      color: new THREE.Color(),
      timer: 0,
    });
  }
  /** Allocates an engine trail: {push(pos, visible), reset(), release()}. */
  function trail({ width = 1.2, color = new THREE.Color(0.6, 1.4, 3.2) } = {}) {
    const tr = trails.find((x) => !x.used);
    if (!tr) return { push() {}, reset() {}, release() {} };
    tr.used = true;
    tr.n = 0;
    tr.width = width;
    tr.color.copy(color);
    return {
      push(p, on = true, dt = 0.016) {
        tr.timer += dt;
        const flag = on ? 1 : 0;
        if (tr.n < 2) {
          for (let i = 0; i < TRAIL_PTS; i++) {
            tr.pts[i].copy(p);
            tr.on[i] = 0;
          }
          tr.n = 2;
        } else {
          // commit points every 40 ms, or more often (≤ 4 per frame) when segments get long
          const d = tr.pts[1].distanceTo(p);
          if (tr.timer > 0.04 || d > 14) {
            tr.timer = 0;
            const k = Math.min(4, Math.max(1, Math.ceil(d / 14)));
            _seg.copy(tr.pts[1]);
            for (let j = 1; j <= k; j++) {
              for (let i = TRAIL_PTS - 1; i > 1; i--) {
                tr.pts[i].copy(tr.pts[i - 1]);
                tr.on[i] = tr.on[i - 1];
              }
              tr.pts[1].lerpVectors(_seg, p, j / k);
              tr.on[1] = flag;
              tr.n = Math.min(TRAIL_PTS, tr.n + 1);
            }
          }
        }
        tr.pts[0].copy(p);
        tr.on[0] = flag;
      },
      reset() {
        tr.n = 0;
      },
      release() {
        tr.used = false;
        tr.n = 0;
      },
    };
  }

  // ---------------------------------------------------------- dust / speed lines
  const DN = lowQ ? 160 : 320;
  const dHalf = 260;
  const dustPos = new Float32Array(DN * 2 * 3);
  const dustEnd = new Float32Array(DN * 2);
  for (let i = 0; i < DN; i++) {
    const x = (rng() * 2 - 1) * dHalf;
    const y = (rng() * 2 - 1) * dHalf;
    const z = (rng() * 2 - 1) * dHalf;
    dustPos.set([x, y, z, x, y, z], i * 6);
    dustEnd[i * 2] = 0;
    dustEnd[i * 2 + 1] = 1;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aEnd', new THREE.BufferAttribute(dustEnd, 1));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3() },
      uHalf: { value: dHalf },
      uStretch: { value: 0.02 },
      uColor: { value: new THREE.Color(0.5, 0.6, 0.8) },
    },
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.LineSegments(dustGeo, dustMat);
  dust.frustumCulled = false;
  group.add(dust);

  // ---------------------------------------------------------- shield bubble (attached by the caller)
  const shieldMat = new THREE.ShaderMaterial({
    uniforms: { uHitDir: { value: new THREE.Vector3(0, 0, -1) }, uHit: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.5, 1.6, 3.0) } },
    vertexShader: SHIELD_VERT,
    fragmentShader: SHIELD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), shieldMat);
  shield.scale.set(8.2, 4.2, 10.5);
  shield.visible = false;
  shield.renderOrder = 6;

  // ---------------------------------------------------------- spawners
  const _c = new THREE.Color();
  const _v = new THREE.Vector3();
  const FIRE = new THREE.Color(6, 2.6, 0.8);
  function explosion(pos, scale = 1, { color = FIRE, debrisCount = 10, ring = true } = {}) {
    const n = Math.round((lowQ ? 50 : 110) * Math.min(2, scale));
    for (let i = 0; i < n; i++) {
      _v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const sp = (8 + rng() * 60) * scale;
      const fire = i % 3 !== 0;
      emit(
        pos.x + _v.x * scale,
        pos.y + _v.y * scale,
        pos.z + _v.z * scale,
        _v.x * sp,
        _v.y * sp,
        _v.z * sp,
        fire ? 0.6 + rng() * 0.9 : 0.4 + rng() * 0.5,
        fire ? (6 + rng() * 10) * scale : (1.5 + rng() * 1.5) * scale,
        color.r,
        color.g,
        color.b,
        fire ? 1 : 0,
        fire ? 1.8 : 0.4,
      );
    }
    flash(pos, 26 * scale, _c.setRGB(8, 5, 3), 0.35, false, 0.5);
    flash(pos, 60 * scale, _c.setRGB(1.6, 0.8, 0.4), 0.6, false, 0.2);
    if (ring) flash(pos, 10 * scale, _c.setRGB(2.4, 1.6, 1.2), 0.7, true, 6);
    for (let i = 0; i < debrisCount; i++) {
      const d = dd[dHead];
      dHead = (dHead + 1) % MAX_D;
      d.life = 2.5 + rng() * 2;
      d.pos.copy(pos);
      d.vel.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize().multiplyScalar((10 + rng() * 40) * scale);
      d.q.set(rng(), rng(), rng(), rng()).normalize();
      d.spin.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(8);
      d.size = (0.4 + rng() * 1.2) * scale;
    }
  }
  function sparks(pos, normal, n = 12, color = new THREE.Color(4, 3, 2)) {
    for (let i = 0; i < n; i++) {
      _v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize().multiplyScalar(0.7).add(normal).normalize();
      const sp = 15 + rng() * 50;
      emit(pos.x, pos.y, pos.z, _v.x * sp, _v.y * sp, _v.z * sp, 0.25 + rng() * 0.4, 0.8 + rng() * 0.8, color.r, color.g, color.b, 0, 0.8);
    }
  }
  /** Small engine/missile exhaust puff. */
  function puff(pos, vel, color, size = 2, life = 0.5) {
    emit(pos.x, pos.y, pos.z, vel.x + (rng() - 0.5) * 4, vel.y + (rng() - 0.5) * 4, vel.z + (rng() - 0.5) * 4, life, size, color.r, color.g, color.b, 1, 1.2);
  }

  let shieldT = 0;
  function shieldHit(dirLocal) {
    shieldMat.uniforms.uHitDir.value.copy(dirLocal).normalize();
    shieldT = 1;
    shield.visible = true;
  }

  // ---------------------------------------------------------- update
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const side = new THREE.Vector3();
  const tang = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  function update(dt, camera, shipVel = null, boost = 0) {
    camPos.setFromMatrixPosition(camera.matrixWorld);
    // particles
    const h = window.innerHeight * Math.min(2, ctx.engine.renderer.getPixelRatio());
    pMat.uniforms.uScale.value = h / (2 * Math.tan(((camera.fov || 60) * Math.PI) / 360));
    for (let i = 0; i < pHigh; i++) {
      if (pLife[i] <= 0) {
        pSize[i] = 0;
        pCol[i * 4 + 3] = 0;
        continue;
      }
      pLife[i] -= dt;
      const k = Math.max(0, pLife[i] / pMax[i]);
      const drag = Math.exp(-pDrag[i] * dt);
      pVel[i * 3] *= drag;
      pVel[i * 3 + 1] *= drag;
      pVel[i * 3 + 2] *= drag;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pKind[i] === 1) {
        // fire: white-hot → orange → deep red, grows
        const hot = k * k;
        pCol[i * 4] = pBase[i * 3] * (0.25 + 0.75 * k) + hot * 2;
        pCol[i * 4 + 1] = pBase[i * 3 + 1] * k * k + hot * 1.4;
        pCol[i * 4 + 2] = pBase[i * 3 + 2] * k * k * k + hot * 0.6;
        pCol[i * 4 + 3] = Math.min(1, k * 1.6) * 0.6;
        pSize[i] = pSize0[i] * (1.6 - k * 0.8);
      } else {
        pCol[i * 4] = pBase[i * 3];
        pCol[i * 4 + 1] = pBase[i * 3 + 1];
        pCol[i * 4 + 2] = pBase[i * 3 + 2];
        pCol[i * 4 + 3] = k;
        pSize[i] = pSize0[i] * (0.5 + 0.5 * k);
      }
    }
    pGeo.setDrawRange(0, pHigh);
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aColor.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;

    // flashes
    for (let i = 0; i < MAX_F; i++) {
      const f = fl[i];
      if (f.life <= 0) {
        fData[i * 4 + 3] = 0;
        continue;
      }
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      const grow = 1 + (1 - k) * f.grow;
      m4.makeTranslation(f.pos.x, f.pos.y, f.pos.z);
      flashes.setMatrixAt(i, m4);
      const a = f.ring ? k : k * k;
      fData[i * 4] = f.col.r * a;
      fData[i * 4 + 1] = f.col.g * a;
      fData[i * 4 + 2] = f.col.b * a;
      fData[i * 4 + 3] = f.size * grow;
      fShape[i] = f.ring;
    }
    flashes.instanceMatrix.needsUpdate = true;
    fGeo.attributes.aFlash.needsUpdate = true;
    fGeo.attributes.aShape.needsUpdate = true;

    // debris
    for (let i = 0; i < MAX_D; i++) {
      const d = dd[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) {
        debris.setMatrixAt(i, zero);
        continue;
      }
      d.pos.addScaledVector(d.vel, dt);
      q.setFromAxisAngle(tang.copy(d.spin).normalize(), d.spin.length() * dt);
      d.q.multiply(q);
      const sz = d.size * Math.min(1, d.life);
      m4.compose(d.pos, d.q, s3.set(sz, sz, sz));
      debris.setMatrixAt(i, m4);
    }
    debris.instanceMatrix.needsUpdate = true;
    dMat.emissiveIntensity = 0.5;

    // trails
    for (let t = 0; t < TRAILS; t++) {
      const tr = trails[t];
      const base = t * TRAIL_PTS * 2;
      for (let i = 0; i < TRAIL_PTS; i++) {
        const vi = (base + i * 2) * 3;
        const ci = (base + i * 2) * 4;
        if (!tr.used || i >= tr.n || tr.n < 2) {
          tCol[ci + 3] = tCol[ci + 7] = 0;
          continue;
        }
        const p = tr.pts[i];
        const nxt = tr.pts[Math.min(tr.n - 1, i + 1)];
        const prv = tr.pts[Math.max(0, i - 1)];
        tang.subVectors(prv, nxt);
        toCam.subVectors(camPos, p);
        side.crossVectors(tang, toCam);
        const l = side.length();
        if (l > 1e-5) side.multiplyScalar(1 / l);
        else side.set(0, 1, 0);
        const u = i / (TRAIL_PTS - 1);
        const w = tr.width * (1 - u * 0.7);
        tPos[vi] = p.x + side.x * w;
        tPos[vi + 1] = p.y + side.y * w;
        tPos[vi + 2] = p.z + side.z * w;
        tPos[vi + 3] = p.x - side.x * w;
        tPos[vi + 4] = p.y - side.y * w;
        tPos[vi + 5] = p.z - side.z * w;
        const camD = toCam.length();
        const near = Math.min(1, Math.max(0, (camD - 14) / 45));
        const a = (1 - u) * (1 - u) * (tr.on[i] ? 1 : 0) * near;
        tCol[ci] = tCol[ci + 4] = tr.color.r;
        tCol[ci + 1] = tCol[ci + 5] = tr.color.g;
        tCol[ci + 2] = tCol[ci + 6] = tr.color.b;
        tCol[ci + 3] = tCol[ci + 7] = a * 0.55;
      }
    }
    tGeo.attributes.position.needsUpdate = true;
    tGeo.attributes.aColor.needsUpdate = true;

    // dust / speed lines
    dustMat.uniforms.uCam.value.copy(camPos);
    if (shipVel) dustMat.uniforms.uVel.value.copy(shipVel);
    dustMat.uniforms.uStretch.value = 0.018 + boost * 0.05;
    const bright = 0.35 + boost * 1.6;
    dustMat.uniforms.uColor.value.setRGB(0.45 * bright, 0.55 * bright, 0.75 * bright);

    // shield
    if (shieldT > 0) {
      shieldT = Math.max(0, shieldT - dt * 1.6);
      shieldMat.uniforms.uHit.value = shieldT;
      shield.visible = shieldT > 0;
    }
  }

  return {
    group,
    shield,
    emit,
    flash,
    explosion,
    sparks,
    puff,
    trail,
    shieldHit,
    update,
    dispose() {
      group.traverse((o) => {
        if (o.isMesh || o.isPoints || o.isLineSegments) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
      shield.geometry.dispose();
      shieldMat.dispose();
    },
  };
}
