import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Quality presets. Modules read `ctx.engine.quality` (one of these objects) and
 * listen to the `quality:change` event to adapt (grass density, draw distance…).
 */
export const QUALITY = {
  low: {
    id: 'low',
    pixelRatio: 0.75,
    shadows: false,
    shadowMapSize: 1024,
    bloom: false,
    msaa: 0,
    grassDensity: 0.25,
    treeDensity: 0.5,
    drawDistance: 1400,
    particles: 0.4,
  },
  medium: {
    id: 'medium',
    pixelRatio: 1,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    msaa: 2,
    grassDensity: 0.6,
    treeDensity: 0.8,
    drawDistance: 2200,
    particles: 0.7,
  },
  high: {
    id: 'high',
    pixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 4096,
    bloom: true,
    msaa: 4,
    grassDensity: 1,
    treeDensity: 1,
    drawDistance: 3200,
    particles: 1,
  },
};

/**
 * Final colour grade: vignette, saturation/contrast, warm/cool split toning and
 * a touch of film grain. Runs in linear space before the OutputPass (which does
 * tone mapping + sRGB). Modes can tweak `engine.grade.uniforms.*`.
 */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uVignetteSoftness: { value: 0.55 },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.04 },
    uShadowTint: { value: new THREE.Color(0.92, 0.97, 1.08) },
    uHighlightTint: { value: new THREE.Color(1.06, 1.0, 0.92) },
    uGrain: { value: 0.025 },
    uExposure: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uVignetteSoftness, uSaturation, uContrast, uGrain, uExposure;
    uniform vec3 uShadowTint, uHighlightTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb * uExposure;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      // contrast around mid-grey in a log-ish space (HDR friendly)
      c = max(vec3(0.0), (c - 0.18) * uContrast + 0.18);
      float lt = clamp(l / (l + 1.0), 0.0, 1.0);
      c *= mix(uShadowTint, uHighlightTint, smoothstep(0.05, 0.6, lt));
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.85 - uVignetteSoftness, length(d * vec2(1.0, 0.82)) * 1.25);
      c *= mix(1.0 - uVignette, 1.0, v);
      c += (hash(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * uGrain * (0.3 + lt);
      gl_FragColor = vec4(c, tex.a);
    }
  `,
};

/**
 * Cleans the HDR scene colour before bloom: NaN → 0, +Inf → uMax, negatives →
 * 0, everything clamped to uMax. One NaN/Inf pixel (pow() of a negative base,
 * normalize(0), a half-float overflow on a very bright highlight…) is
 * harmless on its own, but the bloom blur smears it over the whole screen —
 * the classic "black flickering from medium quality up" on Apple/AMD GPUs.
 * Uses bit tests instead of isnan()/isinf(), which fast-math shader compilers
 * (Metal) are allowed to fold away.
 */
const SanitizeShader = {
  name: 'SanitizeShader',
  uniforms: {
    tDiffuse: { value: null },
    uMax: { value: 30000 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    float clean(float x) {
      uint b = floatBitsToUint(x);
      if ((b & 0x7f800000u) == 0x7f800000u) {
        // +Inf → brightest allowed value (a sun glint); NaN and -Inf → black
        return ((b & 0x007fffffu) == 0u && (b & 0x80000000u) == 0u) ? uMax : 0.0;
      }
      return clamp(x, 0.0, uMax);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(clean(c.r), clean(c.g), clean(c.b), min(clean(c.a), 1.0));
    }
  `,
};

/**
 * URL overrides for diagnosing GPU problems (applied on top of every preset):
 *   ?bloom=0|1  ?msaa=0|2|4  ?shadows=0|1  ?pr=1  ?sanitize=0  ?post=0 (no composer)
 */
function readOverrides(params = {}) {
  const o = {};
  const flag = (v) => !(v === '0' || v === 'false' || v === 'off');
  if (params.bloom !== undefined) o.bloom = flag(params.bloom);
  if (params.shadows !== undefined) o.shadows = flag(params.shadows);
  if (params.msaa !== undefined && Number.isFinite(Number(params.msaa))) o.msaa = Number(params.msaa);
  if (params.pr !== undefined && Number(params.pr) > 0) o.pixelRatio = Number(params.pr);
  if (params.sanitize !== undefined) o.sanitize = flag(params.sanitize);
  if (params.post !== undefined) o.post = flag(params.post);
  return o;
}

export class Engine {
  constructor(canvas, qualityId = 'high', params = {}) {
    this.canvas = canvas;
    this.events = null; // injected by Game
    this.overrides = readOverrides(params);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in r186
    r.setClearColor(0x07090d, 1);
    r.info.autoReset = false; // reset once per frame so stats cover every pass

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    this.width = 1;
    this.height = 1;

    // live switches for the graphics diagnostics panel (src/core/gfxpanel.js)
    this.postEnabled = true; // false → render straight to the canvas, no composer
    this.hideEnv = false; // render without scene.environment
    this.hideFog = false; // render without scene.fog
    this.quality = this._withOverrides(QUALITY[qualityId] || QUALITY.high);
    r.shadowMap.enabled = this.quality.shadows;
    this._buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildComposer() {
    const q = this.quality;
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: q.msaa,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.sanitize = new ShaderPass(SanitizeShader);
    this.sanitize.enabled = q.sanitize !== false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.86);
    this.bloom.enabled = q.bloom;
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.sanitize);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
  }

  _withOverrides(preset) {
    return Object.keys(this.overrides).length ? { ...preset, ...this.overrides } : preset;
  }

  /** Sets the scene + camera that the next frames render. */
  setView(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this._fitCamera(camera);
  }

  _fitCamera(camera) {
    if (camera && camera.isPerspectiveCamera) {
      camera.aspect = this.width / this.height;
      camera.updateProjectionMatrix();
    }
  }

  setQuality(id) {
    if (!QUALITY[id] || QUALITY[id].id === this.quality.id) return;
    const next = this._withOverrides(QUALITY[id]);
    const msaaChanged = next.msaa !== this.quality.msaa;
    this.quality = next;
    this.renderer.shadowMap.enabled = next.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.bloom.enabled = next.bloom;
    this.sanitize.enabled = next.sanitize !== false;
    if (msaaChanged) {
      this.composer.renderTarget1.samples = next.msaa;
      this.composer.renderTarget2.samples = next.msaa;
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    this.resize();
    // Materials must recompile when shadows toggle.
    this.scene.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => (m.needsUpdate = true));
      }
    });
    this.events?.emit('quality:change', next);
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w;
    this.height = h;
    const pr = this.overrides.pixelRatio ?? Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    this._fitCamera(this.camera);
    this.events?.emit('resize', { width: w, height: h });
  }

  render(dt, t) {
    this.renderer.info.reset();
    const sc = this.scene;
    const env = sc.environment;
    const fog = sc.fog;
    if (this.hideEnv) sc.environment = null;
    if (this.hideFog) sc.fog = null;
    try {
      if (!this.postEnabled || this.quality.post === false) {
        // straight to the canvas (tone mapping + sRGB by the renderer)
        this.renderer.setRenderTarget(null);
        this.renderer.render(sc, this.camera);
      } else {
        this.grade.uniforms.uTime.value = t;
        this.composer.render(dt);
      }
    } finally {
      if (this.hideEnv) sc.environment = env;
      if (this.hideFog) sc.fog = fog;
    }
  }

  /** MSAA samples of the HDR composer targets (0 = off). */
  setMsaa(samples) {
    const n = Math.max(0, Math.min(samples | 0, this.renderer.capabilities.maxSamples || 4));
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (t.samples === n) continue;
      t.samples = n;
      t.dispose();
    }
  }

  /** Shadow maps on/off (materials recompile). */
  setShadows(on) {
    const r = this.renderer;
    if (r.shadowMap.enabled === !!on) return;
    r.shadowMap.enabled = !!on;
    r.shadowMap.needsUpdate = true;
    this.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
  }

  /** Overrides the pixel ratio (null = back to the quality preset). */
  setPixelRatio(pr) {
    if (pr == null) delete this.overrides.pixelRatio;
    else this.overrides.pixelRatio = pr;
    this.resize();
  }

  /**
   * Renders `scene` from `camera` through the full post chain into the main
   * canvas and copies the centre crop into a new 2D canvas of width×height.
   * Call it from inside a loop system (or any time between frames); the next
   * regular frame overwrites the main canvas before the browser composites.
   */
  snapshot(scene, camera, width = 320, height = 180) {
    const prevScene = this.scene;
    const prevCam = this.camera;
    const prevAspect = camera.aspect;
    this.setView(scene, camera);
    this.composer.render(0);
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const g = out.getContext('2d');
    const srcAspect = src.width / src.height;
    const dstAspect = width / height;
    let sw = src.width;
    let sh = src.height;
    if (srcAspect > dstAspect) sw = sh * dstAspect;
    else sh = sw / dstAspect;
    g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, width, height);
    this.setView(prevScene, prevCam);
    if (camera !== prevCam && camera.isPerspectiveCamera) {
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
    }
    return out;
  }
}
