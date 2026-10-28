/**
 * Shared materials for placed pieces and harvest nodes (glass-villa style:
 * dark metal frames, light concrete, warm wood, glass with warm interior
 * light at night, warm LED strips, blue solar cells, the navy Ø banner).
 *
 * Every piece material is patched for the build "materialise" effect: the
 * instanced attribute `aReveal` (local height of the reveal front; ≥ 1000 =
 * fully built) discards fragments above the front and adds a cyan scan band
 * at it. Night-dependent glow reads the shared uniform `U.uNight`
 * (0 day … 1 night, same curve as the landmarks) and `U.uPowered`.
 * Real-GPU safety: all patched maths is clamped/finite, glow ≤ ~6 HDR.
 */
import * as THREE from 'three';
import { canvasTexture, bannerTexture, drawEmblem } from '../core/textures.js';
import { mulberry32 } from '../core/math.js';

export const REVEAL_DONE = 1000;

const REVEAL_VERT_HEAD = /* glsl */ `
attribute float aReveal;
varying float vBldY;
varying float vBldReveal;
varying vec2 vBldW;
`;
const REVEAL_VERT_BODY = /* glsl */ `
vBldY = position.y;
#ifdef USE_INSTANCING
  vBldReveal = aReveal;
  vBldW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xz;
#else
  vBldReveal = ${REVEAL_DONE.toFixed(1)};
  vBldW = (modelMatrix * vec4(position, 1.0)).xz;
#endif
`;
const REVEAL_FRAG_HEAD = /* glsl */ `
varying float vBldY;
varying float vBldReveal;
varying vec2 vBldW;
uniform float uNight;
uniform float uTime;
uniform float uPowered;
`;
const REVEAL_DISCARD = /* glsl */ `
if (vBldY > vBldReveal) discard;
`;
const REVEAL_BAND = /* glsl */ `
{
  float bldD = max(vBldReveal - vBldY, 0.0);
  float bldBand = vBldReveal < 500.0 ? 1.0 - clamp(bldD / 0.4, 0.0, 1.0) : 0.0;
  totalEmissiveRadiance += vec3(0.35, 0.85, 1.0) * (bldBand * bldBand * 5.0);
}
`;

function patchStandard(mat, key, U, extraFrag = '') {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uPowered = U.uPowered;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${REVEAL_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${REVEAL_VERT_BODY}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${REVEAL_FRAG_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${REVEAL_DISCARD}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${REVEAL_BAND}\n${extraFrag}`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

function patchBasic(mat, key, U, levelExpr) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uPowered = U.uPowered;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${REVEAL_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${REVEAL_VERT_BODY}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${REVEAL_FRAG_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${REVEAL_DISCARD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= ${levelExpr};`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ------------------------------------------------------------------ textures
function concreteTexture() {
  return canvasTexture(
    256,
    256,
    (g, w, h) => {
      const rnd = mulberry32(17);
      g.fillStyle = '#d9d6d0';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) {
        const v = 200 + Math.floor(rnd() * 40);
        g.fillStyle = `rgba(${v},${v - 2},${v - 6},${0.05 + rnd() * 0.08})`;
        const r = 1 + rnd() * 9;
        g.beginPath();
        g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
        g.fill();
      }
      // formwork tie holes + seams (one tile = 2 m)
      g.strokeStyle = 'rgba(70,66,60,0.55)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, w - 2, h - 2);
      g.fillStyle = 'rgba(80,76,70,0.45)';
      for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        g.beginPath();
        g.arc(x * w, y * h, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    },
    { repeat: [1, 1] },
  );
}

function woodTexture() {
  return canvasTexture(
    256,
    256,
    (g, w, h) => {
      const rnd = mulberry32(5);
      const planks = 8;
      const ph = h / planks;
      for (let p = 0; p < planks; p++) {
        const base = 0.78 + rnd() * 0.22;
        const c = Math.floor(255 * base);
        g.fillStyle = `rgb(${c},${Math.floor(c * 0.93)},${Math.floor(c * 0.86)})`;
        g.fillRect(0, p * ph, w, ph);
        for (let k = 0; k < 14; k++) {
          const y = p * ph + rnd() * ph;
          g.strokeStyle = `rgba(60,38,20,${0.05 + rnd() * 0.1})`;
          g.lineWidth = 0.6 + rnd() * 1.4;
          g.beginPath();
          g.moveTo(0, y);
          g.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 4, w * 0.7, y + (rnd() - 0.5) * 4, w, y);
          g.stroke();
        }
        g.fillStyle = 'rgba(30,20,12,0.55)';
        g.fillRect(0, p * ph, w, 1.5);
        const joint = rnd() * w;
        g.fillRect(joint, p * ph, 1.5, ph);
      }
    },
    { repeat: [1, 1] },
  );
}

function solarTexture() {
  return canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#0c1a33';
      g.fillRect(0, 0, w, h);
      const n = 8;
      const s = w / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const grad = g.createLinearGradient(i * s, j * s, (i + 1) * s, (j + 1) * s);
          grad.addColorStop(0, '#1d3a6e');
          grad.addColorStop(1, '#10264d');
          g.fillStyle = grad;
          g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
          g.strokeStyle = 'rgba(160,190,230,0.25)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(i * s + s / 2, j * s + 2);
          g.lineTo(i * s + s / 2, j * s + s - 2);
          g.stroke();
        }
      }
      g.strokeStyle = 'rgba(200,210,225,0.7)';
      g.lineWidth = 2;
      for (let i = 0; i <= n; i++) {
        g.beginPath();
        g.moveTo(i * s, 0);
        g.lineTo(i * s, h);
        g.stroke();
        g.beginPath();
        g.moveTo(0, i * s);
        g.lineTo(w, i * s);
        g.stroke();
      }
    },
    { repeat: [1, 1] },
  );
}

function barkTexture() {
  return canvasTexture(
    128,
    128,
    (g, w, h) => {
      const rnd = mulberry32(9);
      g.fillStyle = '#c9b8a6';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const y = rnd() * h;
        const v = 120 + Math.floor(rnd() * 90);
        g.strokeStyle = `rgba(${v},${Math.floor(v * 0.85)},${Math.floor(v * 0.7)},0.5)`;
        g.lineWidth = 1 + rnd() * 3;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y + (rnd() - 0.5) * 6);
        g.stroke();
      }
    },
    { repeat: [1, 1] },
  );
}

/** Landing pad marking: ring, Ø, corner chevrons (white on transparent). */
function padTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(236,230,220,0.85)';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    g.setLineDash([18, 14]);
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.43, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    drawEmblem(g, w / 2, h / 2, w * 0.17, 12, 'rgba(236,230,220,0.9)');
    g.fillStyle = 'rgba(240,180,106,0.9)';
    for (let k = 0; k < 4; k++) {
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate((k * Math.PI) / 2);
      g.beginPath();
      g.moveTo(-26, -h * 0.47);
      g.lineTo(0, -h * 0.44);
      g.lineTo(26, -h * 0.47);
      g.lineTo(0, -h * 0.455);
      g.closePath();
      g.fill();
      g.restore();
    }
  });
}

/** Soft radial falloff (white → transparent) for light pools. */
function poolTexture() {
  return canvasTexture(
    128,
    128,
    (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    },
    { srgb: false, mipmaps: true },
  );
}

/** Instanced additive flame cards (crossed planes, uv.y = 0 at the base). */
function flameMaterial(U) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime },
    vertexShader: /* glsl */ `
      attribute float aReveal;
      varying vec2 vUv;
      varying float vSeed;
      varying float vVis;
      void main() {
        vUv = uv;
        vec4 p = vec4(position, 1.0);
        vSeed = 0.0;
        vVis = 1.0;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          vSeed = mod(instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61, 17.0);
          vVis = aReveal > 500.0 ? 1.0 : 0.0;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vVis;
      float h1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n2(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), u.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float t = mod(uTime, 600.0) * 2.6 + vSeed;
        float flick = n2(vec2(vUv.x * 4.0, vUv.y * 3.0 - t)) * 0.6 + n2(vec2(vUv.x * 9.0 + 3.0, vUv.y * 6.0 - t * 1.7)) * 0.4;
        float shape = (1.0 - vUv.y) * (1.0 - abs(vUv.x - 0.5) * 2.0 * (0.6 + vUv.y));
        float f = smoothstep(0.15, 0.75, clamp(shape * (0.55 + flick * 0.9), 0.0, 2.0)) * vVis;
        vec3 col = mix(vec3(1.0, 0.35, 0.06), vec3(1.0, 0.85, 0.45), f) * f * 3.0;
        gl_FragColor = vec4(col, f);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return m;
}

// ---------------------------------------------------------------- materials
export function createMaterials(ctx) {
  const U = {
    uNight: { value: 0 },
    uTime: { value: 0 },
    uPowered: { value: 1 },
  };
  const list = [];
  const keep = (m) => (list.push(m), m);

  const concreteMap = concreteTexture();
  const woodMap = woodTexture();
  const solarMap = solarTexture();
  const barkMap = barkTexture();

  const M = {
    U,
    list,
    metal: keep(patchStandard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.62 }), 'bld-metal', U)),
    concrete: keep(patchStandard(new THREE.MeshStandardMaterial({ map: concreteMap, vertexColors: true, roughness: 0.84, metalness: 0.02 }), 'bld-concrete', U)),
    wood: keep(patchStandard(new THREE.MeshStandardMaterial({ map: woodMap, vertexColors: true, roughness: 0.74, metalness: 0 }), 'bld-wood', U)),
    solar: keep(patchStandard(new THREE.MeshStandardMaterial({ map: solarMap, vertexColors: true, roughness: 0.2, metalness: 0.55, envMapIntensity: 1.4 }), 'bld-solar', U)),
    matte: keep(patchStandard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true }), 'bld-matte', U)),
    banner: keep(patchStandard(new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.86 }), 'bld-banner', U)),
    decal: keep(
      patchStandard(
        new THREE.MeshStandardMaterial({ map: padTexture(), transparent: true, alphaTest: 0.2, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
        'bld-decal',
        U,
      ),
    ),
    // glass: reflective, with warm "lit interior" glow after sunset
    glass: keep(
      patchStandard(
        new THREE.MeshStandardMaterial({
          color: 0x2a3a4c,
          metalness: 0.9,
          roughness: 0.06,
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
          side: THREE.DoubleSide,
          envMapIntensity: 1.6,
        }),
        'bld-glass',
        U,
        /* glsl */ `{
          float bldPanel = fract(sin(dot(mod(floor(vBldW * 0.5 + 0.25), 61.0), vec2(12.9898, 78.233))) * 43758.5453);
          float bldRoom = 0.45 + 0.75 * bldPanel;
          float bldUp = 0.25 + 0.75 * smoothstep(0.2, 2.9, vBldY);
          totalEmissiveRadiance += vec3(1.0, 0.55, 0.24) * (uNight * uNight * uPowered * bldRoom * bldUp * 0.95);
        }`,
      ),
    ),
    // lamps / LED strips: vertex colours carry HDR intensity; dim by day
    glow: keep(patchBasic(new THREE.MeshBasicMaterial({ vertexColors: true }), 'bld-glow', U, '(mix(0.12, 1.0, uNight) * uPowered)')),
    // always-on emissive (indicator lights, crystals, plasma) with a slow pulse
    neon: keep(patchBasic(new THREE.MeshBasicMaterial({ vertexColors: true }), 'bld-neon', U, '(0.82 + 0.18 * sin(uTime * 2.2 + vBldY * 1.7))')),
    // additive light pools on the ground under lamps (night only)
    pool: keep(
      patchBasic(
        new THREE.MeshBasicMaterial({ map: poolTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
        'bld-pool',
        U,
        '(uNight * uNight * uPowered * 0.3)',
      ),
    ),
    flame: keep(flameMaterial(U)),
    // harvest nodes
    rock: keep(patchStandard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05, flatShading: true }), 'bld-rock', U)),
    bark: keep(patchStandard(new THREE.MeshStandardMaterial({ map: barkMap, vertexColors: true, roughness: 0.95, metalness: 0 }), 'bld-bark', U)),
  };
  M.glass.name = 'bld-glass';

  // long terrain shadows for opaque instanced parts (terrain helper, optional)
  const sunVis = ctx.world?.terrain?.sunVisibility;
  if (sunVis?.applySunVisibility) {
    for (const k of ['metal', 'concrete', 'wood', 'solar', 'matte', 'banner', 'rock', 'bark']) {
      try {
        sunVis.applySunVisibility(M[k], { at: 'instance' });
      } catch (err) {
        console.warn('[build] sun visibility patch failed', k, err);
      }
    }
  }

  /** Per-frame: night factor (perceptual, like the landmarks) + time. */
  M.update = (dt, t, world) => {
    U.uTime.value = t;
    const day = world?.dayFactor ?? 1;
    const target = THREE.MathUtils.smoothstep(1 - day, 0.25, 1);
    const n = U.uNight.value;
    U.uNight.value = Math.abs(target - n) > 0.3 ? target : n + (target - n) * Math.min(1, dt * 1.5);
  };
  M.dispose = () => {
    for (const m of list) {
      m.map?.dispose?.();
      m.dispose();
    }
  };
  return M;
}
