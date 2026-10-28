/**
 * Landmarks — shared materials. One instance per install, reused by every
 * landmark so the number of shader programs (and draw calls) stays small.
 *
 * All animated / day-night behaviour runs on the GPU through the shared
 * uniforms `U` (uTime, uNight 0 day…1 night, uShow stage show 0…1) that the
 * landmarks loop updates once per frame — no per-object CPU work.
 *
 * Patched MeshStandard/MeshBasic materials:
 *  - facade : procedural window grid (warm + cyan, more lit at night, distance
 *             fade to the average so far towers never shimmer)
 *  - glow   : emissive vertex-colour lights (blinking / pulsing / day level)
 *  - stone  : textured stone with world-space moss on up-facing surfaces
 *  - paving : the plaza's circular patterned stone with wet puddles + inlays
 *  - apron  : spaceport concrete panels with wet sheen
 */
import * as THREE from 'three';
import { stoneTexture, woodTexture, rustTexture, radialTexture, grimeTexture } from './textures.js';
import { bannerTexture } from '../core/textures.js';

const NOISE_GLSL = /* glsl */ `
  float lmHash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
  float lmNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float a = lmHash(i), b = lmHash(i + vec2(1.0, 0.0)), c = lmHash(i + vec2(0.0, 1.0)), d = lmHash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float lmFbm(vec2 p) { return lmNoise(p) * 0.55 + lmNoise(p * 2.13 + 7.1) * 0.3 + lmNoise(p * 4.7 - 3.3) * 0.15; }
`;

/** World position / normal varyings for patched standard materials. */
const WORLD_VARYINGS_VERT = /* glsl */ `
  {
    vec4 lmW = vec4(transformed, 1.0);
    vec3 lmN = objectNormal;
    #ifdef USE_INSTANCING
      lmW = instanceMatrix * lmW;
      lmN = mat3(instanceMatrix) * lmN;
    #endif
    lmW = modelMatrix * lmW;
    vLmWPos = lmW.xyz;
    vLmWNrm = normalize(mat3(modelMatrix) * lmN);
  }
`;

/**
 * Scales the (atmosphere's) fog factor for a material: far landmarks such as
 * the spire skyline keep a readable silhouette against the bright horizon haze.
 */
function scaleFog(sh, k) {
  if (!sh.fragmentShader.includes('#include <fog_fragment>')) return;
  const chunk = THREE.ShaderChunk.fog_fragment;
  const at = chunk.lastIndexOf('gl_FragColor.rgb = mix(');
  if (at < 0) return;
  sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', chunk.slice(0, at) + `fogFactor *= ${k.toFixed(3)};\n` + chunk.slice(at));
}

function patch(material, key, fn) {
  material.onBeforeCompile = fn;
  material.customProgramCacheKey = () => key;
  return material;
}

export function createMaterials(ctx) {
  const U = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uShow: { value: 0 },
    // sun direction (world, towards the sun) + colour × intensity, copied
    // from the atmosphere every frame (drives the backlit rim on the skyline)
    uSunDir: { value: new THREE.Vector3(0.3, 0.1, -0.95).normalize() },
    uSunCol: { value: new THREE.Color(1, 0.75, 0.5) },
  };
  const mats = { U, list: [] };
  const keep = (m) => {
    mats.list.push(m);
    return m;
  };

  /**
   * Adds the backlit-rim helper to a standard material's fragment shader:
   * faces seen edge-on while looking towards the sun catch a warm outline,
   * so towers read as silhouettes with glowing edges against the sunset.
   */
  const RIM_PARS = /* glsl */ `
    uniform vec3 uSunDir;
    uniform vec3 uSunCol;
    vec3 lmRim(vec3 n, vec3 viewPos, float k) {
      vec3 V = normalize(viewPos);
      vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
      float back = max(dot(-V, L), 0.0);
      // max(): |dot| of two unit vectors can round to 1.0000001 where a face looks
      // straight at the camera → pow() of a negative base = NaN (black dot)
      float edge = max(1.0 - abs(dot(n, V)), 0.0);
      float up = smoothstep(-0.05, 0.12, uSunDir.y + 0.08);
      return uSunCol * (pow(edge, 3.0) * pow(back, 5.0) * k * up);
    }
  `;
  const addRim = (sh, k) => {
    sh.uniforms.uSunDir = U.uSunDir;
    sh.uniforms.uSunCol = U.uSunCol;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${RIM_PARS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += lmRim(normal, vViewPosition, ${k.toFixed(3)});`);
  };

  // ------------------------------------------------------------ facade
  /**
   * Procedural window facade. aWin = (seed, style, density, scale):
   *  style 1 punched windows · 2 ribbon windows · 3 curtain wall · 4 vertical slits
   * The seed is rounded to an integer before hashing: hashing the raw
   * interpolated varying turns its tiny interpolation error into per-pixel
   * noise ("TV static" inside the windows).
   */
  const facadePatch = ({ rim = 0, fog = 0.8 } = {}) => (sh) => {
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFacade;\nattribute vec4 aWin;\nvarying vec2 vFacade;\nvarying vec4 vWin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade;\nvWin = aWin;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vFacade;\nvarying vec4 vWin;\nuniform float uNight;\nuniform float uTime;\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 lmEmissive = vec3(0.0);
        float lmGlass = 0.0;
        float lmBlind = 0.0;
        {
          float style = floor(vWin.y + 0.5);
          if (style > 0.5) {
            float seed = floor(vWin.x * 997.0 + 0.5);
            float sc = max(vWin.w, 0.3);
            vec2 cell; vec2 lo; vec2 hi;
            if (style < 1.5) { cell = vec2(3.0, 3.6) * sc; lo = vec2(0.17, 0.2); hi = vec2(0.83, 0.86); }
            else if (style < 2.5) { cell = vec2(1.6, 3.6) * sc; lo = vec2(0.03, 0.3); hi = vec2(0.97, 0.9); }
            else if (style < 3.5) { cell = vec2(1.5, 3.6) * sc; lo = vec2(0.06, 0.07); hi = vec2(0.94, 0.95); }
            else { cell = vec2(1.25, 5.6) * sc; lo = vec2(0.3, 0.04); hi = vec2(0.7, 0.96); }
            vec2 g = vFacade / cell;
            vec2 id = floor(g);
            vec2 f = fract(g);
            vec2 fw = max(fwidth(g), vec2(1e-4));
            vec2 a = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
            float win = a.x * a.y;
            // cells smaller than ~3 px fade to their average (no shimmer far away)
            float far = smoothstep(0.18, 0.55, max(fw.x, fw.y));
            float area = (hi.x - lo.x) * (hi.y - lo.y);
            win = mix(win, area, far);
            // lit windows: busy / quiet floors, per-window chance, more at night
            float rFloor = lmHash(vec2(id.y + 0.5, seed));
            float r = lmHash(id + vec2(seed * 0.618, seed));
            float dens = vWin.z * mix(0.1, 0.62, uNight) * mix(0.35, 1.65, rFloor * rFloor);
            float lit = step(1.0 - dens, r);
            // mid range: whole 3×2 window blocks light up together so distant
            // towers still glitter; far away the coverage averages out
            vec2 id1 = floor(g / vec2(3.0, 2.0));
            float lit1 = step(1.0 - dens * 0.85, lmHash(id1 + vec2(seed * 0.37, seed * 1.31)));
            float far2 = smoothstep(0.9, 2.2, max(fw.x, fw.y));
            lit = mix(lit, mix(lit1, clamp(dens, 0.0, 1.0), far2), far);
            // each building leans warm or cool; a few windows break the rule
            float bTint = lmHash(vec2(seed, 7.0));
            float tint = lmHash(id.yx + vec2(seed, 3.0));
            vec3 warm = vec3(1.0, 0.62, 0.3);
            vec3 cool = vec3(0.52, 0.8, 1.0);
            float coolPick = step(0.78 - bTint * 0.55, tint);
            vec3 wc = mix(warm, cool, coolPick) * (0.6 + 0.8 * lmHash(id * 1.7 + vec2(seed)));
            wc = mix(wc, mix(warm, cool, 0.22 + bTint * 0.4), far);
            lmGlass = win;
            lmBlind = step(0.82, lmHash(id * 2.3 + vec2(seed * 0.1, 1.0))) * (1.0 - far);
            // room interior: brighter towards the ceiling, darker edges, some blinds
            vec2 wf = clamp((f - lo) / (hi - lo), 0.0, 1.0);
            float room = (0.62 + 0.5 * wf.y) * (0.75 + 0.25 * smoothstep(0.0, 0.18, min(wf.x, 1.0 - wf.x)));
            float blinds = step(0.72, lmHash(id * 3.7 + vec2(seed, 5.0)));
            room *= mix(1.0, 0.8 + 0.2 * step(0.45, fract(wf.y * 9.0)), blinds);
            room = mix(room, 0.85, far);
            lmEmissive = wc * lit * win * room * mix(0.4, 0.95, uNight);
          }
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.16 + vec3(0.01, 0.014, 0.022), vec3(0.32, 0.3, 0.28), lmBlind * 0.6), lmGlass * 0.92);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, mix(0.08, 0.5, lmBlind), lmGlass);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, mix(0.9, 0.2, lmBlind), lmGlass);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += lmEmissive;');
    if (rim > 0) addRim(sh, rim);
    scaleFog(sh, fog);
  };
  mats.facade = keep(patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), 'lm-facade-2', facadePatch({ fog: 0.85 })));
  /** Skyline variant: backlit rim + less haze so the spires stay readable silhouettes. */
  mats.cityFacade = keep(patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3, envMapIntensity: 0.5 }), 'lm-facade-city-2', facadePatch({ rim: 0.55, fog: 0.62 })));

  // ---------------------------------------------------------- structure
  mats.metal = keep(patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.7 }), 'lm-metal-fog', (sh) => scaleFog(sh, 0.8)));
  mats.cityMetal = keep(
    patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.6, envMapIntensity: 0.6 }), 'lm-metal-city-2', (sh) => {
      addRim(sh, 0.7);
      scaleFog(sh, 0.62);
    }),
  );
  mats.matte = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0.04 }));
  mats.painted = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }));
  mats.dark = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.55 }));

  // --------------------------------------------------------------- glow
  /** gain: per-material {value} multiplier (same program for every glow material) */
  const glowPatch = (gain) => (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uGain = gain;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nuniform float uTime;\nuniform float uNight;\nvarying float vGlowK;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          float lvl = mix(aGlow.z, 1.0, uNight);
          float b = 1.0;
          if (aGlow.x > 0.0) b = step(0.8, fract(uTime * aGlow.x + aGlow.y));
          else if (aGlow.x < 0.0) b = 0.55 + 0.45 * sin((uTime * -aGlow.x + aGlow.y) * 6.2831853);
          vGlowK = lvl * b;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlowK;\nuniform float uGain;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGlowK * uGain;');
    scaleFog(sh, 0.7);
  };
  mats.glow = keep(patch(new THREE.MeshBasicMaterial({ vertexColors: true }), 'lm-glow-2', glowPatch({ value: 1 })));
  /** Glow material with its own animated gain uniform ({value}), e.g. the beacon's dormant state. */
  mats.glowWith = (gain) => keep(patch(new THREE.MeshBasicMaterial({ vertexColors: true }), 'lm-glow-2', glowPatch(gain)));

  // -------------------------------------------------------------- stone
  const stoneMap = stoneTexture();
  stoneMap.wrapS = stoneMap.wrapT = THREE.RepeatWrapping;
  const stonePatch = (moss) => (sh) => {
    addRim(sh, 0.16);
    sh.uniforms.uMoss = { value: moss };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLmWPos;\nvarying vec3 vLmWNrm;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WORLD_VARYINGS_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLmWPos;\nvarying vec3 vLmWNrm;\nuniform float uMoss;\n${NOISE_GLSL}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        {
          float n = lmFbm(vLmWPos.xz * 0.45 + vLmWPos.y * 0.31);
          float up = vLmWNrm.y;
          float moss = smoothstep(0.15, 0.7, up + (n - 0.5) * 1.1) * uMoss;
          // damp streaks running down vertical faces
          float streak = smoothstep(0.55, 0.9, lmNoise(vec2(vLmWPos.x * 1.7 + vLmWPos.z * 1.3, vLmWPos.y * 0.15))) * (1.0 - abs(up)) * uMoss * 0.55;
          vec3 mossCol = mix(vec3(0.16, 0.24, 0.08), vec3(0.32, 0.4, 0.14), n);
          diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, clamp(moss + streak, 0.0, 1.0));
          diffuseColor.rgb *= 0.8 + 0.35 * lmNoise(vLmWPos.xz * 0.2 + vLmWPos.y * 0.1);
        }`,
      );
  };
  mats.stone = keep(patch(new THREE.MeshStandardMaterial({ map: stoneMap, vertexColors: true, roughness: 0.92, metalness: 0 }), 'lm-stone-1', stonePatch(1)));
  // same shader program as `stone` (uMoss is a uniform), no moss
  mats.stoneClean = keep(patch(new THREE.MeshStandardMaterial({ map: stoneMap, vertexColors: true, roughness: 0.7, metalness: 0.02 }), 'lm-stone-1', stonePatch(0)));
  /** Stone shader with another surface texture (same program; moss amount 0…1). */
  mats.stoneWith = (map, moss = 1, roughness = 0.9) => {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return keep(patch(new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness, metalness: 0 }), 'lm-stone-1', stonePatch(moss)));
  };

  // --------------------------------------------------------- wood / rust
  const woodMap = woodTexture();
  woodMap.wrapS = woodMap.wrapT = THREE.RepeatWrapping;
  mats.wood = keep(new THREE.MeshStandardMaterial({ map: woodMap, vertexColors: true, roughness: 0.82, metalness: 0 }));
  const rustMap = rustTexture();
  rustMap.wrapS = rustMap.wrapT = THREE.RepeatWrapping;
  mats.rust = keep(new THREE.MeshStandardMaterial({ map: rustMap, vertexColors: true, roughness: 0.78, metalness: 0.45 }));

  // --------------------------------------------------------------- glass
  mats.glass = keep(
    new THREE.MeshStandardMaterial({
      color: 0x223040,
      metalness: 0.9,
      roughness: 0.05,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
      envMapIntensity: 1.6,
    }),
  );

  // ---------------------------------------------------------- cloth wave
  /** Vertex-coloured cloth; uv.y = 1 at the attached edge, 0 at the free edge. */
  const clothPatch = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uSunDir = U.uSunDir;
    sh.uniforms.uSunCol = U.uSunCol;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vClothUv;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vClothUv = uv;
        { float free = 1.0 - uv.y;
          float w = sin(position.x * 0.9 + position.z * 0.7 + uTime * 1.7) * 0.5 + sin(position.x * 2.3 - uTime * 2.6) * 0.25;
          transformed.y += w * 0.08 * free; }`,
      );
    // thin fabric: soft folds + a darker hem, the sun shines through it when
    // it is behind the cloth, and the lanterns below light it warmly at night
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform vec3 uSunDir;\nuniform vec3 uSunCol;\nvarying vec2 vClothUv;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float fold = 0.8 + 0.2 * sin(vClothUv.x * 21.0 + sin(vClothUv.y * 5.0) * 1.5);
          float hem = mix(0.72, 1.0, smoothstep(0.02, 0.07, vClothUv.y)) * mix(0.8, 1.0, smoothstep(0.0, 0.04, min(fract(vClothUv.x), 1.0 - fract(vClothUv.x))));
          float weave = 0.94 + 0.06 * sin(vClothUv.y * 140.0) * sin(vClothUv.x * 140.0);
          diffuseColor.rgb *= fold * hem * weave;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          vec3 Vv = normalize(vViewPosition);
          float through = max(dot(-Vv, Lv), 0.0) * 0.6 + 0.4 * max(-dot(normal, Lv) * sign(dot(normal, Vv) + 1e-3), 0.0);
          totalEmissiveRadiance += diffuseColor.rgb * (uSunCol * through * 0.22 * smoothstep(-0.05, 0.1, uSunDir.y) + vec3(1.0, 0.62, 0.32) * mix(0.04, 0.12, uNight));
        }`,
      );
  };
  mats.cloth = keep(patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }), 'lm-cloth-2', clothPatch));

  // ------------------------------------------------- lantern-lit variants
  /**
   * Baked lantern light: geometry carries `aLamp` (per-vertex warm light from
   * the nearby lanterns, see common.js bakeLamps); the material adds it as a
   * warm emissive term that is faint by day and full at night. Used by the
   * bazaar so the stalls glow around their lanterns without real lights.
   */
  const WARM_LAMP = [1.0, 0.58, 0.26];
  const COOL_LAMP = [0.62, 0.78, 1.0];
  /** lamp colour + day level are per-material uniforms (one program per base material) */
  const addLamp = (color = WARM_LAMP, day = 0.18) => (sh) => {
    sh.uniforms.uLampNight = U.uNight;
    sh.uniforms.uLampColor = { value: new THREE.Color(color[0], color[1], color[2]) };
    sh.uniforms.uLampDay = { value: day };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLamp;\nvarying float vLampK;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLampK = aLamp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLampK;\nuniform float uLampNight;\nuniform vec3 uLampColor;\nuniform float uLampDay;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uLampColor * vLampK * mix(uLampDay, 1.0, uLampNight);');
  };
  mats.clothLit = keep(
    patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }), 'lm-cloth-lit', (sh) => {
      clothPatch(sh);
      addLamp()(sh);
    }),
  );
  mats.woodLit = keep(patch(new THREE.MeshStandardMaterial({ map: woodMap, vertexColors: true, roughness: 0.82, metalness: 0 }), 'lm-wood-lit', addLamp()));
  mats.paintedLit = keep(patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }), 'lm-painted-lit', addLamp()));
  mats.metalLit = keep(
    patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.7 }), 'lm-metal-lit', (sh) => {
      scaleFog(sh, 0.8);
      addLamp()(sh);
    }),
  );
  /** Cool industrial light (spaceport hangar), on by day too. */
  mats.paintedLitCool = keep(patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }), 'lm-painted-lit', addLamp(COOL_LAMP, 0.55)));
  mats.metalLitCool = keep(
    patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.7 }), 'lm-metal-lit', (sh) => {
      scaleFog(sh, 0.8);
      addLamp(COOL_LAMP, 0.55)(sh);
    }),
  );

  // ------------------------------------------------------- foliage cards
  /**
   * Alpha-tested foliage cards (vines, ivy, ferns) with a GPU wind sway.
   * anchor 'top': attached at uv.y = 1 (hanging vines) · 'bottom': rooted at uv.y = 0 (ferns)
   * · 'none': flat patches (ivy on walls). Normals face up-ish so cards shade softly.
   */
  const cardCache = new Map();
  mats.foliageCard = (map, { anchor = 'top', amp = 0.12, color = 0xffffff, emissive = 0 } = {}) => {
    const key = `${map.uuid}:${anchor}:${amp}:${color}:${emissive}`;
    if (cardCache.has(key)) return cardCache.get(key);
    const m = keep(
      patch(new THREE.MeshStandardMaterial({ map, color, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }), `lm-card-${anchor}`, (sh) => {
        sh.uniforms.uTime = U.uTime;
        sh.uniforms.uAmp = { value: amp };
        sh.uniforms.uNight = U.uNight;
        sh.uniforms.uEm = { value: emissive };
        const free = anchor === 'top' ? '1.0 - uv.y' : anchor === 'bottom' ? 'uv.y' : '0.0';
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmp;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            {
              vec3 ip = vec3(0.0);
              #ifdef USE_INSTANCING
                ip = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
              #endif
              float fr = ${free};
              float w = sin(uTime * 1.3 + ip.x * 0.4 + ip.z * 0.3 + uv.y * 2.0) * 0.6 + sin(uTime * 2.9 + ip.x) * 0.25;
              transformed.x += w * uAmp * fr * fr;
              transformed.z += w * uAmp * 0.6 * fr * fr;
            }`,
          );
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uEm;')
          // soft, two-sided foliage shading: keep the normal facing the viewer
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uEm * mix(0.3, 1.0, uNight);');
      }),
    );
    cardCache.set(key, m);
    return m;
  };

  /** Instanced glowing flowers (violet blossoms), brighter at night. */
  mats.flower = keep(
    patch(new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 }), 'lm-flower-2', (sh) => {
      sh.uniforms.uNight = U.uNight;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * mix(0.22, 0.75, uNight);');
    }),
  );

  // ---------------------------------------------------------- light pool
  mats.pool = keep(
    new THREE.MeshBasicMaterial({
      map: radialTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      color: 0xffffff,
      toneMapped: false,
    }),
  );

  // ------------------------------------------------------------- holo
  mats.holo = (map, { tint = [1, 1, 1], intensity = 1.6, dayLevel = 0.55, opacity = 1, scan = 1, side = THREE.DoubleSide, showGate = 0 } = {}) =>
    keep(
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: map },
          uTime: U.uTime,
          uNight: U.uNight,
          uShow: U.uShow,
          uTint: { value: new THREE.Color(tint[0], tint[1], tint[2]) },
          uIntensity: { value: intensity },
          uDay: { value: dayLevel },
          uOpacity: { value: opacity },
          uScan: { value: scan },
          uShowGate: { value: showGate },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform float uTime, uNight, uIntensity, uDay, uOpacity, uScan, uShow, uShowGate;
          uniform vec3 uTint;
          varying vec2 vUv;
          void main() {
            vec4 t = texture2D(map, vUv);
            float scan = 1.0 - uScan * (0.18 + 0.18 * sin(vUv.y * 480.0 - uTime * 7.0));
            float band = 1.0 + uScan * 0.35 * smoothstep(0.96, 1.0, sin(vUv.y * 3.0 - uTime * 1.3));
            float flick = 0.94 + 0.06 * sin(uTime * 41.0 + vUv.y * 5.0);
            float lvl = uIntensity * mix(uDay, 1.0, uNight) * mix(1.0, smoothstep(0.02, 0.6, uShow), uShowGate);
            // show-gated holograms flicker in like a projection warming up
            lvl *= mix(1.0, 0.75 + 0.25 * step(0.3, fract(sin(floor(uTime * 12.0) * 91.7) * 43758.5)), uShowGate);
            vec3 c = t.rgb * uTint * scan * band * flick * lvl;
            gl_FragColor = vec4(c, t.a * uOpacity);
            #include <colorspace_fragment>
          }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side,
      }),
    );

  /** Fresnel hologram (spheres, beams): additive rim glow. */
  mats.fresnel = ({ color = 0x9fd8ff, intensity = 1.5, power = 2.2, dayLevel = 0.5, map = null, show = 0 } = {}) =>
    keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: U.uTime,
          uNight: U.uNight,
          uShow: U.uShow,
          uColor: { value: new THREE.Color(color) },
          uIntensity: { value: intensity },
          uPower: { value: power },
          uDay: { value: dayLevel },
          uShowGain: { value: show },
          map: { value: map },
          uUseMap: { value: map ? 1 : 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV; varying vec2 vUv;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            vUv = uv;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uIntensity, uPower, uDay, uNight, uTime, uShow, uShowGain, uUseMap;
          uniform sampler2D map;
          varying vec3 vN; varying vec3 vV; varying vec2 vUv;
          void main() {
            // max(): |dot| can round above 1 at a sphere's centre → pow(< 0) = NaN
            float f = pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), uPower);
            vec3 base = uColor;
            float body = 0.12;
            if (uUseMap > 0.5) { vec4 t = texture2D(map, vUv + vec2(uTime * 0.01, 0.0)); base *= 0.6 + t.rgb; body = 0.22 * t.a; }
            float lvl = uIntensity * mix(uDay, 1.0, uNight) * (1.0 + uShow * uShowGain);
            float scan = 0.85 + 0.15 * sin(vUv.y * 160.0 - uTime * 4.0);
            gl_FragColor = vec4(base * (f + body) * lvl * scan, 1.0);
            #include <colorspace_fragment>
          }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    );

  // ------------------------------------------------------------ paving
  /** Circular plaza paving around `center` (world) with puddles + glowing inlays. */
  mats.paving = (center, { radius = 84 } = {}) =>
    keep(
      patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.08, envMapIntensity: 1.2 }), 'lm-paving-1', (sh) => {
        sh.uniforms.uCenter = { value: center.clone() };
        sh.uniforms.uNight = U.uNight;
        sh.uniforms.uTime = U.uTime;
        sh.uniforms.uRadius = { value: radius };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vLmWPos;\nvarying vec3 vLmWNrm;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WORLD_VARYINGS_VERT}`);
        sh.fragmentShader = sh.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>\nvarying vec3 vLmWPos;\nvarying vec3 vLmWNrm;\nuniform vec3 uCenter;\nuniform float uNight;\nuniform float uTime;\nuniform float uRadius;\n${NOISE_GLSL}
            float lmJoint(float x, float w) { float fw = max(fwidth(x), 1e-4); float f = abs(fract(x) - 0.5); return smoothstep(0.5 - w - fw, 0.5 - w + fw * 0.5, f); }`,
          )
          .replace(
            '#include <color_fragment>',
            /* glsl */ `#include <color_fragment>
            float lmWet = 0.0;
            vec3 lmGlowC = vec3(0.0);
            {
              vec2 d = vLmWPos.xz - uCenter.xz;
              float r = length(d);
              float ang = (r > 0.0 ? atan(d.y, d.x) : 0.0) + 3.14159265; // atan(0, 0) is undefined
              vec3 cA = vec3(0.42, 0.4, 0.38);
              vec3 cB = vec3(0.31, 0.3, 0.295);
              vec3 cC = vec3(0.2, 0.2, 0.22);
              vec3 col;
              float joint;
              float tileId;
              if (r < 30.0) {
                // fine concentric rings of curved tiles around the tree
                float ringW = 1.6;
                float ri = floor(r / ringW);
                float n = max(6.0, floor(6.2831853 * (ri + 0.5) * ringW / 1.9));
                float ai = ang / 6.2831853 * n + ri * 0.37;
                joint = lmJoint(r / ringW + 0.5, 0.025) * lmJoint(ai + 0.5, 0.021);
                tileId = lmHash(vec2(ri, floor(ai)));
                col = mix(cA, cB, step(0.5, fract(ri * 0.5)));
              } else {
                // larger radial slabs (sunburst) outside
                float ringW = 3.2;
                float ri = floor(r / ringW);
                float n = floor(6.2831853 * (ri + 0.5) * ringW / 3.6);
                float ai = ang / 6.2831853 * n;
                joint = lmJoint(r / ringW + 0.5, 0.0125) * lmJoint(ai + 0.5, 0.011);
                tileId = lmHash(vec2(ri * 3.1, floor(ai)));
                col = mix(cA * 0.92, cC * 1.1, step(0.62, tileId));
              }
              col *= 0.86 + 0.24 * tileId;
              // decorative inlay bands (dark stone with a thin light line that glows at night)
              float band = 0.0;
              float glowLine = 0.0;
              for (int i = 0; i < 4; i++) {
                float br = i == 0 ? 11.5 : (i == 1 ? 30.0 : (i == 2 ? 48.0 : 66.0));
                float dist = abs(r - br);
                band = max(band, 1.0 - smoothstep(0.55, 0.62, dist));
                glowLine = max(glowLine, 1.0 - smoothstep(0.04, 0.1 + fwidth(r), dist));
              }
              col = mix(col, cC * 0.55, band);
              col *= mix(0.55, 1.0, joint);
              // puddles (wet)
              float p = lmFbm(vLmWPos.xz * 0.055);
              lmWet = smoothstep(0.5, 0.66, p);
              col *= mix(1.0, 0.5, lmWet);
              // radial light inlays from the tree ring to the edge (12 spokes)
              float spokeA = abs(fract(ang / 6.2831853 * 12.0 + 0.5) - 0.5) / 12.0 * 6.2831853;
              float spokeD = spokeA * r;
              float spoke = (1.0 - smoothstep(0.035, 0.07 + fwidth(spokeD), spokeD)) * smoothstep(12.5, 14.0, r) * (1.0 - smoothstep(uRadius - 6.0, uRadius - 4.0, r));
              col = mix(col, cC * 0.6, (1.0 - smoothstep(0.12, 0.2 + fwidth(spokeD), spokeD)) * step(13.0, r) * 0.8);
              glowLine = max(glowLine, spoke);
              // edge fade to the curb; the wet stone reads darker at night (contrast for the neon)
              col *= 1.0 - 0.25 * smoothstep(uRadius - 6.0, uRadius, r);
              col *= mix(1.0, 0.5, uNight * uNight);
              diffuseColor.rgb = col;
              float pulse = 0.65 + 0.35 * sin(uTime * 0.8 - r * 0.12);
              lmGlowC = mix(vec3(0.55, 0.45, 1.0), vec3(0.4, 0.85, 1.0), step(40.0, r)) * glowLine * pulse * mix(0.05, 0.75, uNight * uNight);
            }`,
          )
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.42, 0.06, lmWet);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += lmGlowC;');
      }),
    );

  // ------------------------------------------------------------- apron
  mats.apron = keep(
    patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.05, map: grimeTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }), 'lm-apron-1', (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLmWPos;\nvarying vec3 vLmWNrm;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WORLD_VARYINGS_VERT}`);
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec3 vLmWPos;\nvarying vec3 vLmWNrm;\n${NOISE_GLSL}
          float lmJoint(float x, float w) { float fw = max(fwidth(x), 1e-4); float f = abs(fract(x) - 0.5); return smoothstep(0.5 - w - fw, 0.5 - w + fw * 0.5, f); }`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          float lmWet;
          {
            vec2 q = vLmWPos.xz / 7.5;
            float joint = lmJoint(q.x + 0.5, 0.012) * lmJoint(q.y + 0.5, 0.012);
            float id = lmHash(floor(q));
            vec3 col = vec3(0.42, 0.42, 0.43) * (0.86 + 0.2 * id);
            col *= 0.78 + 0.35 * texture2D(map, vLmWPos.xz / 37.0).r;
            col *= mix(0.5, 1.0, joint);
            float p = lmFbm(vLmWPos.xz * 0.045 + 3.0);
            lmWet = smoothstep(0.48, 0.64, p);
            col *= mix(1.0, 0.5, lmWet);
            diffuseColor.rgb *= col;
          }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.62, 0.06, lmWet);');
    }),
  );

  /** Navy Ø banners (core bannerTexture) with a gentle cloth wave (uv.y = 1 at the attached top). */
  let bannerMat = null;
  mats.banner = () => {
    if (bannerMat) return bannerMat;
    bannerMat = keep(
      patch(
        new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.82, metalness: 0.05 }),
        'lm-banner-1',
        (sh) => {
          sh.uniforms.uTime = U.uTime;
          sh.uniforms.uNight = U.uNight;
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            { float free = 1.0 - uv.y;
              float w = sin(uTime * 1.3 + position.x * 0.35 + position.z * 0.27 + uv.y * 4.0) * 0.18 + sin(uTime * 2.7 + uv.x * 5.0) * 0.05;
              transformed += normal * w * free; }`,
          );
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uNight;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * mix(0.12, 0.5, uNight);');
        },
      ),
    );
    return bannerMat;
  };

  /** Painted ground markings (polygon offset over the apron / paving). */
  mats.decal = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8 }));

  /** Environment fallback: if the atmosphere set no scene.environment, give metals something to reflect. */
  mats.ensureEnvironment = (renderer, scene) => {
    if (scene.environment || !renderer) return null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const geo = new THREE.SphereGeometry(10, 32, 16);
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y;
          vec3 sky = mix(vec3(0.95,0.6,0.35), vec3(0.18,0.24,0.45), smoothstep(0.0, 0.6, h));
          vec3 ground = vec3(0.12,0.1,0.09);
          gl_FragColor = vec4(h > 0.0 ? sky : ground, 1.0); }`,
      });
      envScene.add(new THREE.Mesh(geo, mat));
      const rt = pmrem.fromScene(envScene, 0.02);
      pmrem.dispose();
      geo.dispose();
      mat.dispose();
      for (const m of mats.list) if (m.isMeshStandardMaterial) m.envMap = rt.texture;
      return rt;
    } catch (err) {
      console.warn('[landmarks] environment fallback failed', err);
      return null;
    }
  };

  mats.dispose = () => {
    for (const m of mats.list) m.dispose();
    mats.list.length = 0;
  };
  return mats;
}
