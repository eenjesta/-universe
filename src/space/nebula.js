import * as THREE from 'three';
import { createNoise } from '../core/noise.js';
import { mulberry32 } from '../core/math.js';
import { SPACE } from './layout.js';
import { NOISE_GLSL } from './sky.js';

/**
 * Local volumetric-looking gas for the nebula zone (convoy route): ~150
 * huge camera-facing additive puffs (4-variant noise atlas, slow spin,
 * purple / magenta / orange / deep-blue), fading out near the camera so
 * flying through them never fills the screen — one draw call.
 * Also the anomaly: a glowing violet energy rift (jagged axis-billboard),
 * an aura, a vortex of particles (GPU-animated) and a violet point light.
 */

function cloudAtlas() {
  const S = 256;
  const H = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const noise = createNoise('nebula-puffs');
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * H;
    const oy = Math.floor(v / 2) * H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < H; x++) {
        const u = (x / H) * 2 - 1;
        const w = (y / H) * 2 - 1;
        const r = Math.sqrt(u * u + w * w);
        let n = 0;
        let amp = 0.5;
        let f = 1.6 + v * 0.35;
        for (let o = 0; o < 5; o++) {
          n += noise.n3(u * f + v * 7, w * f, v * 3.1) * amp;
          amp *= 0.5;
          f *= 2.1;
        }
        const fall = Math.max(0, 1 - r);
        const a = Math.max(0, Math.min(1, fall * fall * (0.55 + n * 1.1) * 1.4));
        const i = ((oy + y) * S + ox + x) * 4;
        const val = Math.round(a * 255);
        img.data[i] = val;
        img.data[i + 1] = val;
        img.data[i + 2] = val;
        img.data[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const PUFF_VERT = /* glsl */ `
  attribute vec4 aData; // size, rotation, atlas index, alpha
  attribute vec3 aColor;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float rot = aData.y + uTime * 0.006 * (aData.z - 1.5);
    float cs = cos(rot);
    float sn = sin(rot);
    vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs) * aData.x;
    c.xy += q;
    float dist = -c.z;
    vAlpha = aData.w * smoothstep(aData.x * 0.12, aData.x * 0.85, dist);
    float idx = floor(aData.z + 0.5);
    vUv = vec2(mod(idx, 2.0), floor(idx / 2.0)) * 0.5 + uv * 0.5;
    vColor = aColor;
    gl_Position = projectionMatrix * c;
  }
`;
const PUFF_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = texture2D(uTex, vUv).r * vAlpha;
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

export function createNebula(ctx, { quality }) {
  const lowQ = quality.id === 'low';
  const rng = mulberry32(808);
  const count = lowQ ? 80 : 160;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const data = new Float32Array(count * 4);
  const col = new Float32Array(count * 3);
  const palette = [
    [0.32, 0.08, 0.52],
    [0.46, 0.1, 0.34],
    [0.78, 0.3, 0.08],
    [0.12, 0.13, 0.42],
    [0.55, 0.16, 0.5],
  ];
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: cloudAtlas() }, uTime: { value: 0 } },
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4();
  const curve = new THREE.CatmullRomCurve3(SPACE.convoyPath);
  const p = new THREE.Vector3();
  const N = SPACE.nebula;
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) {
      curve.getPointAt(Math.min(0.75, rng() * 0.8), p);
      p.x += (rng() - 0.5) * 1800;
      p.y += (rng() - 0.5) * 700;
      p.z += (rng() - 0.5) * 1800;
    } else {
      let u;
      let v;
      let w;
      do {
        u = rng() * 2 - 1;
        v = rng() * 2 - 1;
        w = rng() * 2 - 1;
      } while (u * u + v * v + w * w > 1);
      p.set(N.center.x + u * N.radius, N.center.y + v * N.radius * 0.38, N.center.z + w * N.radius);
    }
    m4.makeTranslation(p.x, p.y, p.z);
    mesh.setMatrixAt(i, m4);
    const big = rng();
    data.set([500 + big * big * 1600, rng() * 6.28, Math.floor(rng() * 4), 0.16 + rng() * 0.22], i * 4);
    const c = palette[i % 7 === 0 ? 2 : Math.floor(rng() * palette.length)];
    const k = 0.7 + rng() * 0.5;
    col.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
  }
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius += 2000;
  mesh.renderOrder = 2;
  mesh.name = 'nebula-gas';
  return {
    group: mesh,
    update(dt, t) {
      mat.uniforms.uTime.value = t;
    },
    /** 0..1 how deep inside the nebula a point is (for ambience). */
    density(pos) {
      return Math.max(0, 1 - pos.distanceTo(N.center) / N.radius);
    },
    dispose() {
      geo.dispose();
      quad.dispose();
      mat.uniforms.uTex.value.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ anomaly
const RIFT_VERT = /* glsl */ `
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 c = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 ax = (modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    ax /= max(length(ax), 1e-5);
    vec3 toCam = -c / max(length(c), 1e-3);
    vec3 r = cross(ax, toCam);
    float rl = length(r);
    r = rl > 1e-4 ? r / rl : vec3(1.0, 0.0, 0.0);
    vec3 pv = c + r * position.x * uSize.x + ax * position.y * uSize.y;
    gl_Position = projectionMatrix * vec4(pv, 1.0);
  }
`;
const RIFT_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    float x = vUv.x - 0.5;
    float y = vUv.y - 0.5;
    float taper = 1.0 - smoothstep(0.18, 0.5, abs(y));
    float off = (vnoise(vec3(y * 7.0, uTime * 0.45, 1.0)) - 0.5) * 0.2 + (vnoise(vec3(y * 26.0, uTime * 1.4, 4.0)) - 0.5) * 0.06;
    off *= taper;
    float w = 0.01 + 0.045 * taper;
    float d = abs(x - off);
    float core = exp(-d / (w * 0.3)) * taper;
    float glow = exp(-d / (w * 2.2)) * taper;
    float flow = vnoise(vec3(x * 12.0, y * 5.0 - uTime * 0.8, uTime * 0.2));
    float edge = (1.0 - smoothstep(0.3, 0.5, abs(y))) * (1.0 - smoothstep(0.28, 0.5, abs(x)));
    float haze = exp(-length(vec2(x * 1.6, y * 0.7)) * 5.0) * (0.6 + 0.6 * flow) * edge;
    glow *= edge;
    vec3 col = vec3(1.0, 0.92, 1.0) * core * 6.0 + vec3(0.62, 0.24, 1.0) * glow * 2.2 * (0.8 + 0.4 * flow) + vec3(0.32, 0.1, 0.7) * haze * 0.9;
    gl_FragColor = vec4(min(col * uIntensity, vec3(25.0)), 1.0);
  }
`;
const AURA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float ang = r * 2.2 - uTime * 0.25;
    vec2 q = vec2(p.x * cos(ang) - p.y * sin(ang), p.x * sin(ang) + p.y * cos(ang));
    float swirl = vnoise(vec3(q * 3.0, uTime * 0.1));
    float g = exp(-r * 3.2) * (0.55 + 0.7 * swirl) * (1.0 - smoothstep(0.85, 1.0, r));
    vec3 col = mix(vec3(0.3, 0.08, 0.6), vec3(0.15, 0.4, 0.9), swirl) * g * 0.8;
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;
const AURA_VERT = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    c.xy += position.xy * uSize;
    gl_Position = projectionMatrix * c;
  }
`;
const VORTEX_VERT = /* glsl */ `
  attribute vec4 aP; // radius, angle, speed, height
  uniform float uTime;
  uniform float uScale;
  varying vec3 vCol;
  varying float vA;
  void main() {
    float life = fract(uTime * aP.z * 0.05 + aP.y);
    float r = mix(aP.x, 12.0, life);
    float ang = aP.y * 6.2831 + uTime * aP.z * (1.0 + 60.0 / max(r, 1.0));
    vec3 pos = vec3(cos(ang) * r, aP.w * (1.0 - life) + sin(ang * 2.0) * 10.0, sin(ang) * r * 0.55);
    vA = sin(life * 3.14159);
    vCol = mix(vec3(0.7, 0.35, 1.6), vec3(0.6, 1.4, 2.4), fract(aP.y * 7.0));
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = clamp(4.0 * uScale / max(-mv.z, 1.0), 1.0, 24.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const VORTEX_FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a = exp(-dot(p, p) * 3.0) * vA;
    gl_FragColor = vec4(vCol * a * 2.0, 1.0);
  }
`;

export function createAnomaly(ctx, { quality }) {
  const rng = mulberry32(66);
  const group = new THREE.Group();
  group.name = 'anomaly';
  group.position.copy(SPACE.anomaly);
  group.rotation.set(0.25, 0.4, 0.18);
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  const uniforms = { uTime: { value: 0 }, uIntensity: { value: 1 } };
  const riftMat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uSize: { value: new THREE.Vector2(240, 720) } },
    vertexShader: RIFT_VERT,
    fragmentShader: RIFT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  riftMat.uniforms.uTime = uniforms.uTime;
  riftMat.uniforms.uIntensity = uniforms.uIntensity;
  const auraMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uIntensity: uniforms.uIntensity, uSize: { value: 620 } },
    vertexShader: AURA_VERT,
    fragmentShader: AURA_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const quad = new THREE.PlaneGeometry(1, 1);
  const quad2 = new THREE.PlaneGeometry(2, 2);
  const aura = add(quad2, auraMat);
  const rift = add(quad, riftMat);
  aura.renderOrder = 3;
  rift.renderOrder = 4;
  // vortex particles
  const n = quality.id === 'low' ? 250 : 520;
  const arr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) arr.set([90 + rng() * 380, rng(), 0.4 + rng() * 1.2, (rng() - 0.5) * 520], i * 4);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  pg.setAttribute('aP', new THREE.BufferAttribute(arr, 4));
  const pm = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uScale: { value: 600 } },
    vertexShader: VORTEX_VERT,
    fragmentShader: VORTEX_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(pg, pm);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  group.add(pts);
  const light = new THREE.PointLight(new THREE.Color(0.75, 0.35, 1.0), 650, 2200, 1);
  group.add(light);

  let scanned = false;
  let boost = 0;
  return {
    group,
    position: group.position,
    radius: 300,
    get scanned() {
      return scanned;
    },
    setScanned(v) {
      scanned = !!v;
    },
    /** scanning 0..1 brightens and agitates the rift. */
    update(dt, t, camera, scanning = 0) {
      uniforms.uTime.value = t * (1 + scanning * 1.5);
      boost += (scanning - boost) * Math.min(1, dt * 3);
      const pulse = 0.85 + 0.15 * Math.sin(t * 2.3) + boost * 0.6;
      uniforms.uIntensity.value = (scanned ? 0.75 : 1) * pulse;
      light.intensity = 650 * pulse;
      pm.uniforms.uScale.value = window.innerHeight / (2 * Math.tan(((camera.fov || 60) * Math.PI) / 360));
    },
    dispose() {
      quad.dispose();
      quad2.dispose();
      pg.dispose();
      riftMat.dispose();
      auraMat.dispose();
      pm.dispose();
    },
  };
}
