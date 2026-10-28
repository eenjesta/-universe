import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

/**
 * Deep-space backdrop, all procedural:
 *  - a baked HDR cube map (milky-way band with dust lanes, purple/orange
 *    nebula clouds, faint star dust) used as scene.background, plus a
 *    second small bake (with sun + planet glow) for the PMREM environment;
 *  - crisp star points with colour variation (camera-centred);
 *  - the home planet (baked continents/ocean/cloud maps, ocean glint, night
 *    lights, analytic atmospheric rim glow), a pale-blue ringed gas giant;
 *  - the sun (HDR disc + corona + anamorphic streak) and a screen-space
 *    lens flare whose visibility the caller drives (occlusion).
 * Sky bodies live in `group`, which follows whatever camera renders (scene
 * onBeforeRender), so they never parallax and the depth range stays small.
 */

export const SUN_DIR = new THREE.Vector3(0.62, 0.24, -0.75).normalize();
export const PLANET_DIR = new THREE.Vector3(-0.5, 0.17, -0.85).normalize();
export const GIANT_DIR = new THREE.Vector3(0.2, 0.5, -0.84).normalize();
export const NEBULA_DIR = new THREE.Vector3(1, -0.08, 0.32).normalize();
const NEBULA2_DIR = new THREE.Vector3(-0.35, 0.62, 0.7).normalize();
const BAND_NORMAL = new THREE.Vector3(0.42, 0.62, 0.66).normalize();
export const PLANET = { distance: 20000, radius: 8900 };
const GIANT = { distance: 22000, radius: 1650 };
export const SUN_COLOR = new THREE.Color(1.0, 0.86, 0.7);
/** Stylised key light for the sky bodies (planet ~60 % lit, giant lit from the front-right). */
const PLANET_LIGHT = new THREE.Vector3(0.91, 0.35, -0.22).normalize();
const GIANT_LIGHT = new THREE.Vector3(0.8, 0.25, 0.5).normalize();

export const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
  }
  float fbm(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s;
  }
  float fbm3(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      s += a * vnoise(p);
      p = p * 2.07 + vec3(4.1, 1.3, 7.7);
      a *= 0.5;
    }
    return s;
  }
`;

// ------------------------------------------------------------------ backdrop bake
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uNebDir;
  uniform vec3 uNeb2Dir;
  uniform vec3 uBand;
  uniform vec3 uPlanetDir;
  uniform float uEnv;
  varying vec3 vDir;
  ${NOISE_GLSL}
  void main() {
    vec3 d = vDir / max(length(vDir), 1e-5);
    vec3 col = vec3(0.0035, 0.005, 0.011);
    // milky way band with dust lanes
    float bd = dot(d, uBand);
    float band = exp(-bd * bd / 0.03);
    float wide = exp(-bd * bd / 0.16);
    float n1 = fbm(d * 3.1);
    float n2 = fbm(d * 8.0 + 7.0);
    float lanes = smoothstep(0.42, 0.7, fbm(d * 5.2 + vec3(3.0)));
    float coreDir = max(dot(d, normalize(vec3(-0.62, 0.48, -0.3))), 0.0);
    float core = pow(coreDir, 4.0);
    vec3 bandCol = mix(vec3(0.32, 0.26, 0.52), vec3(0.78, 0.62, 0.52), n2);
    col += bandCol * band * (0.35 + 0.9 * n1) * (1.0 - 0.8 * lanes * band) * (0.16 + 0.42 * core);
    col += vec3(0.08, 0.07, 0.16) * wide * n1 * 0.22;
    // main nebula (purple / orange / magenta), domain warped
    vec3 w = vec3(fbm3(d * 2.0 + 11.0), fbm3(d * 2.0 + 23.0), fbm3(d * 2.0 + 37.0));
    float c1 = fbm(d * 2.4 + w * 1.6);
    float c2 = fbm(d * 4.6 + w * 2.2 + 5.0);
    float nd = max(dot(d, uNebDir), 0.0);
    float mask = smoothstep(0.25, 1.0, nd);
    float neb = smoothstep(0.38, 0.72, c1) * mask;
    float fil = smoothstep(0.5, 0.78, c2) * mask;
    vec3 purple = vec3(0.42, 0.1, 0.62);
    vec3 orange = vec3(1.0, 0.42, 0.13);
    vec3 magenta = vec3(0.7, 0.16, 0.42);
    vec3 nebCol = mix(purple, magenta, smoothstep(0.4, 0.7, c2));
    nebCol = mix(nebCol, orange, smoothstep(0.55, 0.85, c1) * smoothstep(0.55, 1.0, nd));
    col += nebCol * neb * 0.55 + orange * fil * fil * 0.35 * smoothstep(0.5, 1.0, nd);
    // dark dust inside the nebula
    col *= 1.0 - 0.5 * smoothstep(0.55, 0.8, fbm(d * 7.0 + 2.0)) * mask;
    // secondary faint blue-violet nebula
    float nd2 = max(dot(d, uNeb2Dir), 0.0);
    float neb2 = smoothstep(0.42, 0.75, fbm(d * 3.0 + w)) * smoothstep(0.35, 1.0, nd2);
    col += vec3(0.12, 0.16, 0.42) * neb2 * 0.4;
    // faint star dust
    vec3 cell = floor(d * 380.0);
    float h = hash13(cell);
    if (h > 0.986) {
      vec3 cc = (cell + 0.5) / 380.0;
      float dd = length(d - cc / max(length(cc), 1e-5)) * 380.0;
      float s = 1.0 - smoothstep(0.0, 0.7, dd);
      float tint = hash13(cell + 17.0);
      col += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.65), tint) * s * (0.25 + 1.2 * (h - 0.986) / 0.014);
    }
    // sun glow + planet bounce (environment bake only gets the strong versions)
    float sd = max(dot(d, uSunDir), 0.0);
    col += vec3(1.0, 0.7, 0.45) * (pow(sd, 10.0) * (0.03 + uEnv * 0.5) + pow(sd, 200.0) * uEnv * 40.0);
    float pd = max(dot(d, uPlanetDir), 0.0);
    col += vec3(0.1, 0.22, 0.42) * smoothstep(0.85, 0.95, pd) * uEnv * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function bakeCube(renderer, size, env) {
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: SUN_DIR },
      uNebDir: { value: NEBULA_DIR },
      uNeb2Dir: { value: NEBULA2_DIR },
      uBand: { value: BAND_NORMAL },
      uPlanetDir: { value: PLANET_DIR },
      uEnv: { value: env ? 1 : 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 32), mat);
  scene.add(mesh);
  const cam = new THREE.CubeCamera(1, 1000, rt);
  const prev = renderer.getRenderTarget();
  cam.update(renderer, scene);
  renderer.setRenderTarget(prev);
  mesh.geometry.dispose();
  mat.dispose();
  return rt;
}

// ------------------------------------------------------------------ planet bake
const BAKE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const UV_TO_DIR = /* glsl */ `
  vec3 uvDir(vec2 uv) {
    float lon = (uv.x - 0.5) * 6.2831853;
    float lat = (uv.y - 0.5) * 3.1415927;
    return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  }
`;
const SURFACE_FRAG = /* glsl */ `
  varying vec2 vUv;
  ${NOISE_GLSL}
  ${UV_TO_DIR}
  void main() {
    vec3 p = uvDir(vUv);
    float lat = (vUv.y - 0.5) * 3.1415927;
    vec3 w = vec3(fbm3(p * 1.4 + 3.0), fbm3(p * 1.4 + 9.0), fbm3(p * 1.4 + 17.0));
    float c = fbm(p * 1.7 + w * 1.4);
    float detail = fbm(p * 9.0 + w);
    float land = smoothstep(0.515, 0.535, c + (detail - 0.5) * 0.05);
    float coast = 1.0 - smoothstep(0.0, 0.04, abs(c - 0.525));
    vec3 deep = vec3(0.006, 0.03, 0.085);
    vec3 shallow = vec3(0.02, 0.12, 0.2);
    vec3 ocean = mix(deep, shallow, smoothstep(0.42, 0.525, c));
    float arid = smoothstep(0.45, 0.65, fbm(p * 2.6 + 30.0)) * (1.0 - smoothstep(0.5, 1.1, abs(lat)));
    vec3 green = mix(vec3(0.05, 0.11, 0.045), vec3(0.09, 0.15, 0.06), detail);
    vec3 dry = mix(vec3(0.26, 0.2, 0.12), vec3(0.4, 0.31, 0.19), detail);
    vec3 landCol = mix(green, dry, arid);
    landCol = mix(landCol, vec3(0.12, 0.11, 0.1), smoothstep(0.6, 0.75, detail) * 0.6);
    vec3 col = mix(ocean, landCol, land);
    col = mix(col, vec3(0.05, 0.2, 0.24), coast * (1.0 - land) * 0.5);
    float ice = smoothstep(1.12, 1.25, abs(lat) + (detail - 0.5) * 0.25);
    col = mix(col, vec3(0.8, 0.85, 0.9), ice);
    gl_FragColor = vec4(col, (1.0 - land) * (1.0 - ice));
  }
`;
const CLOUD_FRAG = /* glsl */ `
  varying vec2 vUv;
  ${NOISE_GLSL}
  ${UV_TO_DIR}
  void main() {
    vec3 p = uvDir(vUv);
    float lat = (vUv.y - 0.5) * 3.1415927;
    vec3 w = vec3(fbm3(p * 2.2 + 5.0), fbm3(p * 2.2 + 15.0), fbm3(p * 2.2 + 25.0));
    vec3 q = p + w * 0.5 + vec3(0.0, 0.0, sin(lat * 6.0) * 0.15);
    float c = fbm(q * 3.2);
    float s = fbm(vec3(p.x * 2.0, p.y * 14.0, p.z * 2.0) + w * 2.0);
    float cloud = smoothstep(0.5, 0.72, c) * 0.9 + smoothstep(0.55, 0.75, s) * 0.35;
    cloud *= 0.75 + 0.25 * smoothstep(0.1, 0.5, abs(sin(lat * 3.0)));
    float lights = step(0.86, fbm(p * 40.0)) * smoothstep(0.6, 0.75, fbm(p * 6.0 + 2.0));
    gl_FragColor = vec4(clamp(cloud, 0.0, 1.0), lights, 0.0, 1.0);
  }
`;

function bakeEquirect(renderer, frag, w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  mat.dispose();
  rt.texture.anisotropy = 4;
  return rt;
}

const PLANET_VERT = /* glsl */ `
  varying vec3 vObjN;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vObjN = normal;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const PLANET_FRAG = /* glsl */ `
  uniform sampler2D uSurface;
  uniform sampler2D uClouds;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uTime;
  varying vec3 vObjN;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  vec2 dirUv(vec3 p) {
    float lon = (abs(p.x) + abs(p.z) < 1e-5) ? 0.0 : atan(p.x, p.z);
    float lat = asin(clamp(p.y, -1.0, 1.0));
    return vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
  }
  void main() {
    vec3 on = vObjN / max(length(vObjN), 1e-5);
    vec3 N = vNormalW / max(length(vNormalW), 1e-5);
    vec3 Vv = cameraPosition - vPosW;
    vec3 V = Vv / max(length(Vv), 1e-3);
    vec3 L = uSunDir;
    vec2 uv = dirUv(on);
    vec4 surf = texture2D(uSurface, uv);
    vec4 cl = texture2D(uClouds, uv + vec2(uTime * 0.0006, 0.0));
    float NdL = dot(N, L);
    float lit = max(NdL, 0.0);
    float day = smoothstep(-0.1, 0.2, NdL);
    vec3 Hv = L + V;
    vec3 H = Hv / max(length(Hv), 1e-4);
    float spec = pow(max(dot(N, H), 0.0), 70.0) * surf.a * (1.0 - cl.r);
    vec3 col = surf.rgb * lit * uSunColor * 2.4 + uSunColor * spec * 2.5 * day;
    // city lights on the night side
    col += vec3(1.0, 0.62, 0.3) * cl.g * (1.0 - surf.a) * (1.0 - day) * 0.9;
    // clouds
    vec3 cloudCol = vec3(0.92, 0.94, 0.97) * (lit * 1.55 + 0.015);
    col = mix(col, cloudCol, cl.r * 0.92);
    // warm terminator band
    float term = exp(-NdL * NdL * 60.0);
    col += vec3(0.5, 0.18, 0.05) * term * 0.12;
    // atmospheric limb inside the disc
    // clamp: the dot of two unit vectors can round above 1 at the disc centre → pow(< 0) = NaN
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 4.0);
    col = mix(col, vec3(0.28, 0.55, 1.0) * (lit * 1.8 + 0.02), clamp(fres * smoothstep(-0.25, 0.4, NdL), 0.0, 1.0) * 0.85);
    gl_FragColor = vec4(min(col, vec3(60.0)), 1.0);
  }
`;
const ATMO_VERT = /* glsl */ `
  varying vec3 vPosW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const ATMO_FRAG = /* glsl */ `
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform vec3 uSunDir;
  uniform vec3 uColor;
  varying vec3 vPosW;
  void main() {
    vec3 rd = vPosW - cameraPosition;
    rd /= max(length(rd), 1e-3);
    vec3 oc = uCenter - cameraPosition;
    float tc = dot(oc, rd);
    vec3 closest = cameraPosition + rd * tc;
    vec3 rel = closest - uCenter;
    float h = length(rel);
    vec3 up = rel / max(h, 1e-3);
    float sunF = smoothstep(-0.35, 0.5, dot(up, uSunDir));
    float x = (h - uRadius) / uRadius;
    float xp = max(x, 0.0);
    float xn = min(x, 0.0);
    float glow = x > 0.0 ? exp(-xp / 0.011) : exp(xn / 0.02) * 0.55;
    float haze = x > 0.0 ? exp(-xp / 0.05) * 0.18 : 0.0;
    vec3 col = uColor * (glow + haze) * (0.04 + sunF * 1.6);
    gl_FragColor = vec4(min(col, vec3(30.0)), 1.0);
  }
`;
const GIANT_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vObjN;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  ${NOISE_GLSL}
  void main() {
    vec3 on = vObjN / max(length(vObjN), 1e-5);
    vec3 N = vNormalW / max(length(vNormalW), 1e-5);
    vec3 Vv = cameraPosition - vPosW;
    vec3 V = Vv / max(length(Vv), 1e-3);
    float lat = on.y + (fbm3(on * 4.0) - 0.5) * 0.18;
    float bands = sin(lat * 24.0) * 0.5 + 0.5;
    float fine = sin(lat * 70.0 + fbm3(on * 9.0) * 3.0) * 0.5 + 0.5;
    vec3 a = vec3(0.32, 0.5, 0.72);
    vec3 b = vec3(0.62, 0.74, 0.86);
    vec3 alb = mix(a, b, bands * 0.7 + fine * 0.3);
    alb = mix(alb, vec3(0.2, 0.32, 0.55), smoothstep(0.6, 0.9, abs(on.y)));
    float NdL = dot(N, uSunDir);
    float lit = max(NdL * 0.85 + 0.15, 0.0);
    lit = lit * lit;
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0); // clamp: dot can round above 1 → pow(< 0) = NaN
    vec3 col = alb * lit * 1.9 + vec3(0.35, 0.6, 1.0) * fres * smoothstep(-0.2, 0.5, NdL) * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }
`;
const RING_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uInner;
  uniform float uOuter;
  varying vec3 vObjP;
  ${NOISE_GLSL}
  void main() {
    float r = length(vObjP.xy);
    float t = clamp((r - uInner) / max(uOuter - uInner, 1e-3), 0.0, 1.0);
    float bands = vnoise(vec3(t * 60.0, 0.0, 0.0)) * 0.6 + vnoise(vec3(t * 180.0, 3.0, 0.0)) * 0.4;
    float edge = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.85, 1.0, t));
    float gap = 1.0 - (1.0 - smoothstep(0.0, 0.02, abs(t - 0.62))) * 0.8;
    float a = bands * edge * gap * 0.55;
    vec3 col = vec3(0.75, 0.82, 0.9) * a * 0.9;
    gl_FragColor = vec4(col, a);
  }
`;
const RING_VERT = /* glsl */ `
  varying vec3 vObjP;
  void main() {
    vObjP = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ------------------------------------------------------------------ stars
const STAR_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  uniform float uTime;
  varying vec3 vColor;
  void main() {
    vColor = aColor * (0.85 + 0.15 * sin(uTime * (1.0 + aSize) + position.x * 0.01));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(aSize * uScale, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    float a = exp(-r2 * 3.5) * (1.0 - smoothstep(0.8, 1.0, r2));
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

function createStars(count, rng) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const v = new THREE.Vector3();
  const tints = [
    [0.7, 0.8, 1.0],
    [0.85, 0.9, 1.0],
    [1.0, 1.0, 1.0],
    [1.0, 0.92, 0.78],
    [1.0, 0.78, 0.55],
    [0.75, 0.7, 1.0],
  ];
  for (let i = 0; i < count; i++) {
    // bias a third of the stars toward the milky-way band
    for (let k = 0; k < 8; k++) {
      v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      const l = v.length();
      if (l < 0.05 || l > 1) continue;
      v.divideScalar(l);
      if (i % 3 !== 0 || Math.abs(v.dot(BAND_NORMAL)) < 0.22) break;
    }
    if (v.lengthSq() < 0.5) v.set(0, 1, 0);
    v.normalize().multiplyScalar(25000);
    pos.set([v.x, v.y, v.z], i * 3);
    const t = tints[Math.floor(rng() * tints.length)];
    const m = rng();
    const bright = m > 0.985 ? 3.5 + rng() * 4 : m > 0.9 ? 1.2 + rng() : 0.35 + rng() * 0.6;
    col.set([t[0] * bright, t[1] * bright, t[2] * bright], i * 3);
    size[i] = m > 0.985 ? 3.2 + rng() * 1.5 : m > 0.9 ? 2.2 : 1.3 + rng() * 0.7;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 }, uTime: { value: 0 } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -8;
  return pts;
}

// ------------------------------------------------------------------ sun + flare
const SUN_VERT = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    c.xy += position.xy * uSize;
    gl_Position = projectionMatrix * c;
  }
`;
const SUN_FRAG = /* glsl */ `
  uniform float uVis;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float disc = 1.0 - smoothstep(0.045, 0.06, r);
    float glow = exp(-r * 9.0) * 2.2 + exp(-r * 3.0) * 0.35;
    float streak = exp(-abs(p.y) * 70.0) * exp(-abs(p.x) * 2.2) * (0.6 + 1.4 * uVis);
    float fade = 1.0 - smoothstep(0.75, 1.0, r);
    vec3 col = vec3(1.0, 0.9, 0.78) * disc * 55.0 + vec3(1.0, 0.72, 0.45) * glow * (0.4 + 0.6 * uVis) + vec3(0.7, 0.8, 1.0) * streak * 0.8;
    gl_FragColor = vec4(col * fade, 1.0);
  }
`;
const FLARE_VERT = /* glsl */ `
  attribute vec4 aFlare; // t along the axis, size, hue, shape
  uniform vec2 uSun;
  uniform float uAspect;
  varying vec2 vUv;
  varying vec2 vData;
  void main() {
    vUv = uv;
    vData = aFlare.zw;
    vec2 c = uSun * (1.0 - aFlare.x);
    vec2 off = position.xy * aFlare.y;
    off.x /= uAspect;
    gl_Position = vec4(c + off, 0.0, 1.0);
  }
`;
const FLARE_FRAG = /* glsl */ `
  uniform float uVis;
  varying vec2 vUv;
  varying vec2 vData;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float disc = 1.0 - smoothstep(0.7, 1.0, r);
    float q = (r - 0.85) / 0.08;
    float ringS = exp(-q * q);
    float shape = mix(disc * (0.4 + 0.6 * r), ringS, vData.y);
    vec3 a = vec3(1.0, 0.55, 0.25);
    vec3 b = vec3(0.35, 0.6, 1.0);
    vec3 c = vec3(0.7, 0.4, 1.0);
    vec3 col = vData.x < 0.5 ? mix(a, b, vData.x * 2.0) : mix(b, c, vData.x * 2.0 - 1.0);
    gl_FragColor = vec4(col * shape * uVis * 0.07, 1.0);
  }
`;

function createFlare() {
  const quad = new THREE.PlaneGeometry(2, 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  const defs = [
    [0.35, 0.05, 0.1, 0],
    [0.62, 0.09, 0.45, 0],
    [0.8, 0.03, 0.7, 0],
    [1.15, 0.09, 0.55, 1],
    [1.38, 0.06, 0.2, 0],
    [1.6, 0.12, 0.85, 0],
    [1.9, 0.14, 0.4, 1],
  ];
  const arr = new Float32Array(defs.length * 4);
  defs.forEach((d, i) => arr.set(d, i * 4));
  g.setAttribute('aFlare', new THREE.InstancedBufferAttribute(arr, 4));
  g.instanceCount = defs.length;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector2() }, uAspect: { value: 16 / 9 }, uVis: { value: 0 } },
    vertexShader: FLARE_VERT,
    fragmentShader: FLARE_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 50;
  return mesh;
}

// ------------------------------------------------------------------ factory
export function createSky(ctx, { quality }) {
  const renderer = ctx.engine.renderer;
  const hi = quality.id === 'high';
  const lowQ = quality.id === 'low';
  const rng = mulberry32(2024);
  const group = new THREE.Group();
  group.name = 'space-sky';

  const backdrop = bakeCube(renderer, hi ? 1024 : lowQ ? 384 : 768, false);
  const envCube = bakeCube(renderer, 128, true);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(envCube.texture);
  pmrem.dispose();
  envCube.dispose();

  // stars
  const stars = createStars(lowQ ? 2500 : hi ? 7000 : 5000, rng);
  group.add(stars);

  // planet
  const pw = hi ? 2048 : 1024;
  const surface = bakeEquirect(renderer, SURFACE_FRAG, pw, pw / 2);
  const clouds = bakeEquirect(renderer, CLOUD_FRAG, pw, pw / 2);
  const planetMat = new THREE.ShaderMaterial({
    uniforms: {
      uSurface: { value: surface.texture },
      uClouds: { value: clouds.texture },
      uSunDir: { value: PLANET_LIGHT },
      uSunColor: { value: SUN_COLOR },
      uTime: { value: 0 },
    },
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(PLANET.radius, 128, 96), planetMat);
  planet.position.copy(PLANET_DIR).multiplyScalar(PLANET.distance);
  planet.rotation.set(0.35, 2.2, 0.15);
  planet.renderOrder = -7;
  group.add(planet);
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: {
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: PLANET.radius },
      uSunDir: { value: PLANET_LIGHT },
      uColor: { value: new THREE.Color(0.32, 0.6, 1.25) },
    },
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(PLANET.radius * 1.09, 96, 64), atmoMat);
  atmo.position.copy(planet.position);
  atmo.renderOrder = -6;
  group.add(atmo);

  // gas giant + rings
  const giantMat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: GIANT_LIGHT } },
    vertexShader: PLANET_VERT,
    fragmentShader: GIANT_FRAG,
  });
  const giant = new THREE.Mesh(new THREE.SphereGeometry(GIANT.radius, 64, 48), giantMat);
  giant.position.copy(GIANT_DIR).multiplyScalar(GIANT.distance);
  giant.rotation.set(0.3, 0, 0.42);
  giant.renderOrder = -7;
  group.add(giant);
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: SUN_DIR }, uInner: { value: GIANT.radius * 1.35 }, uOuter: { value: GIANT.radius * 2.3 } },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const rings = new THREE.Mesh(new THREE.RingGeometry(GIANT.radius * 1.35, GIANT.radius * 2.3, 128, 1), ringMat);
  rings.position.copy(giant.position);
  rings.rotation.set(-1.15, 0.25, 0.4);
  rings.renderOrder = -6;
  group.add(rings);

  // sun billboard
  const sunMat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 5200 }, uVis: { value: 1 } },
    vertexShader: SUN_VERT,
    fragmentShader: SUN_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sunMat);
  sun.position.copy(SUN_DIR).multiplyScalar(24000);
  sun.frustumCulled = false;
  sun.renderOrder = -5;
  group.add(sun);

  const flare = createFlare();
  const _v = new THREE.Vector3();
  let vis = 1;

  function place(camera) {
    _v.setFromMatrixPosition(camera.matrixWorld);
    group.position.copy(_v);
    group.updateMatrixWorld(true);
    atmoMat.uniforms.uCenter.value.copy(planet.position).add(_v);
  }

  return {
    group,
    flare,
    background: backdrop.texture,
    environment: env.texture,
    planet,
    giant,
    sunDir: SUN_DIR,
    planetDir: PLANET_DIR,
    /** Positions the sky on the camera (call from scene.onBeforeRender). */
    place,
    /** Per frame: twinkle, cloud drift, flare from the sun's screen position; occlusion 0..1 visible. */
    update(camera, dt, t, visible = 1) {
      stars.material.uniforms.uTime.value = t;
      stars.material.uniforms.uScale.value = Math.min(2, renderer.getPixelRatio());
      planetMat.uniforms.uTime.value = t;
      vis += (visible - vis) * Math.min(1, dt * 8);
      sunMat.uniforms.uVis.value = vis;
      _v.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
      // view-space direction → NDC
      const inFront = _v.z < 0;
      _v.copy(camera.position).addScaledVector(SUN_DIR, 20000).project(camera);
      const on = inFront && Math.abs(_v.x) < 1.3 && Math.abs(_v.y) < 1.3;
      const edge = on ? 1 - Math.min(1, Math.max(0, Math.max(Math.abs(_v.x), Math.abs(_v.y)) - 0.7) / 0.6) : 0;
      flare.material.uniforms.uSun.value.set(_v.x, _v.y);
      flare.material.uniforms.uAspect.value = camera.aspect || 1.7;
      flare.material.uniforms.uVis.value = vis * edge;
      flare.visible = edge * vis > 0.01;
    },
    /** True when the sun direction is within the planet disc (eclipse). */
    sunBehindPlanet: () => SUN_DIR.angleTo(PLANET_DIR) < Math.asin(PLANET.radius / PLANET.distance),
    dispose() {
      backdrop.dispose();
      env.dispose();
      surface.dispose();
      clouds.dispose();
      group.traverse((o) => {
        if (o.isMesh || o.isPoints) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    },
  };
}
