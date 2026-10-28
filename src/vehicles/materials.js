/**
 * Vehicles — shared PBR materials and procedural textures.
 *
 * createVehicleMaterials() → { paint (car skins), armor (VTOL/ship hull with
 * object-space panel seams), dark (trims/greebles), carbon, glass, rubber,
 * rim, glow (HDR vertex-coloured emissive strips, one draw call), engine
 * (additive glow), decal (white Ø) }. Materials are plain MeshStandard /
 * MeshPhysical with a small onBeforeCompile patch (`patchMaterial`):
 *   panels  — seams + per-panel tint/roughness from object-space position
 *             (no UVs needed, antialiased with fwidth, fades with distance)
 *   windows — rows of lit windows on vertical faces where the vertex
 *             attribute aWin > 0 (colony ship)
 *   skin    — car paint skins (solid / length gradient / animated aurora)
 *   fill    — fake lights for readability in shadow / at night (`patchFill`,
 *             no shadow-casting lights): camera-side wrap fill + glint, fresnel
 *             rim, and pad light from below (fades with object-space height).
 *             Uniforms from `createFillUniforms()`, driven per frame by look.js.
 * GPU safety: no pow/normalize/log, every smoothstep has a < b, outputs finite.
 */
import * as THREE from 'three';
import { canvasTexture, drawEmblem } from '../core/textures.js';

export const hdr = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

/** Paint skins. A/B = gradient colours, mode 0 solid, 1 gradient, 2 animated aurora. */
export const SKINS = {
  car: {
    default: { id: 'default', name: { en: 'Gunmetal', nl: 'Gunmetal' }, a: 0x24282e, b: 0x24282e, mode: 0, metal: 0.62, rough: 0.27, glow: 0x7fe0ff },
    'skin-car-sunset': { id: 'skin-car-sunset', name: { en: 'Sunset paint', nl: 'Sunset-lak' }, a: 0xffa45e, b: 0xff4f78, mode: 1, metal: 0.45, rough: 0.26, glow: 0xff9a4a },
    'skin-car-aurora': { id: 'skin-car-aurora', name: { en: 'Aurora paint', nl: 'Aurora-lak' }, a: 0x3dffc4, b: 0x7a5bff, mode: 2, metal: 0.5, rough: 0.24, glow: 0x7fe0ff },
  },
  ship: {
    default: { id: 'default', name: { en: 'Night hull', nl: 'Nachtromp' }, a: 0x15171b, b: 0x15171b, mode: 0, metal: 0.7, rough: 0.34, glow: 0xff9a4a },
    'skin-ship-gold': { id: 'skin-ship-gold', name: { en: 'Golden hull', nl: 'Gouden romp' }, a: 0xffd77e, b: 0xb8862c, mode: 1, metal: 1.0, rough: 0.22, glow: 0xf0b46a },
  },
};

const VERT_DECL = /* glsl */ `
attribute float aWin;
varying vec3 vPPos;
varying vec3 vPNrm;
varying float vWin;
`;
const VERT_BODY = /* glsl */ `
vPPos = position;
vPNrm = normal;
vWin = aWin;
`;
const FRAG_DECL = /* glsl */ `
varying vec3 vPPos;
varying vec3 vPNrm;
varying float vWin;
uniform vec2 uPanel;
uniform float uPanelVar;
uniform float uSeam;
uniform float uSeamW;
uniform vec3 uWinColor;
uniform float uWinGain;
uniform vec2 uWinCell;
uniform vec3 uSkinA;
uniform vec3 uSkinB;
uniform float uSkinMode;
uniform float uSkinLen;
uniform float uTime;
float vehHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

/**
 * Adds the panel / window / skin features to a MeshStandard/Physical material.
 * opts: { panels: {size:[w,h], variation, seam, seamWidth}, windows: {color, gain, cell:[w,h]}, skin: true }
 * Returns the shared uniforms object (also on material.userData.veh).
 */
export function patchMaterial(mat, opts = {}) {
  const P = opts.panels || null;
  const W = opts.windows || null;
  const S = !!opts.skin;
  const u = {
    uPanel: { value: new THREE.Vector2(...(P?.size || [1.6, 1.1])) },
    uPanelVar: { value: P?.variation ?? 0.16 },
    uSeam: { value: P ? P.seam ?? 0.5 : 0 },
    uSeamW: { value: P?.seamWidth ?? 0.022 },
    uWinColor: { value: new THREE.Color(W?.color ?? 0xffc98a) },
    uWinGain: { value: W?.gain ?? 0 },
    uWinCell: { value: new THREE.Vector2(...(W?.cell || [1.8, 2.6])) },
    uSkinA: { value: new THREE.Color(0x0d0f12) },
    uSkinB: { value: new THREE.Color(0x0d0f12) },
    uSkinMode: { value: 0 },
    uSkinLen: { value: opts.skinLength ?? 4.8 },
    uTime: { value: 0 },
  };
  mat.userData.veh = u;
  const key = `veh-${P ? 'p' : ''}${W ? 'w' : ''}${S ? 's' : ''}`;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    let frag = `
      vec3 vpn = abs(vPNrm);
      float vAxis = (vpn.x >= vpn.y && vpn.x >= vpn.z) ? 0.0 : ((vpn.y >= vpn.z) ? 1.0 : 2.0);
      vec2 vpuv = vAxis < 0.5 ? vPPos.zy : (vAxis < 1.5 ? vPPos.xz : vPPos.xy);
      float vPh = 0.5;
    `;
    if (S) {
      frag += `
      {
        float gz = clamp(vPPos.z / max(uSkinLen, 0.001) + 0.5, 0.0, 1.0);
        vec3 skin = uSkinA;
        if (uSkinMode > 0.5) {
          float k = 1.0 - gz;
          if (uSkinMode > 1.5) k = 0.5 + 0.5 * sin(vPPos.z * 1.6 + vPPos.y * 2.2 + vPPos.x * 0.7 + uTime * 0.9);
          skin = mix(uSkinA, uSkinB, k);
          skin *= mix(0.42, 1.0, smoothstep(0.2, 0.75, vPPos.y));
        }
        diffuseColor.rgb *= skin;
      }
      `;
    }
    if (P) {
      frag += `
      {
        vec2 pg = vpuv / max(uPanel, vec2(0.01));
        vec2 pc = floor(pg);
        vec2 pf = pg - pc;
        vPh = vehHash(pc + vAxis * 17.13);
        vec2 ed = min(pf, 1.0 - pf) * uPanel;
        float edgeDist = min(ed.x, ed.y);
        float pw = max(fwidth(edgeDist), 1e-4);
        float seamLine = 1.0 - smoothstep(uSeamW, uSeamW + pw * 1.5, edgeDist);
        float texel = max(length(fwidth(vpuv)), 1e-5);
        float farFade = clamp(texel * 5.0, 0.0, 1.0);
        seamLine *= 1.0 - farFade;
        // per-panel tint only while a panel covers several pixels (no shimmering noise far away)
        float varK = smoothstep(3.0, 9.0, min(uPanel.x, uPanel.y) / texel) * uPanelVar;
        diffuseColor.rgb *= (1.0 - varK * 0.5 + varK * vPh) * (1.0 - uSeam * seamLine);
      }
      `;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${frag}`);
    if (P) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.82 + 0.36 * vPh), 0.04, 1.0);`,
      );
    }
    if (W) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (vWin > 0.001 && uWinGain > 0.0 && vAxis != 1.0) {
          vec2 wg = vpuv / max(uWinCell, vec2(0.01));
          vec2 wc = floor(wg);
          vec2 wf = wg - wc;
          float wh = vehHash(wc * 1.37 + vAxis * 7.31 + 3.1);
          float lit = step(wh, vWin);
          float wx = smoothstep(0.24, 0.3, wf.x) * (1.0 - smoothstep(0.7, 0.76, wf.x));
          float wy = smoothstep(0.38, 0.44, wf.y) * (1.0 - smoothstep(0.6, 0.66, wf.y));
          float aa = clamp(1.0 - length(fwidth(wg)) * 1.5, 0.0, 1.0);
          float win = mix(0.08, wx * wy, aa) * lit;
          totalEmissiveRadiance += uWinColor * (uWinGain * win * (0.55 + 0.45 * fract(wh * 7.0)));
        }`,
      );
    }
    prev?.call(mat, shader, renderer);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|${key}`;
  return u;
}

// ------------------------------------------------------------ fill (fake lights)
const FILL_VERT_DECL = /* glsl */ `
varying float vFillY;
`;
const FILL_FRAG_DECL = /* glsl */ `
varying float vFillY;
uniform vec3 uFillCol;
uniform vec3 uFillSpec;
uniform vec3 uRimCol;
uniform vec3 uUpCol;
uniform vec2 uUpRange;
`;
// at <emissivemap_fragment>: normal, roughnessFactor and vViewPosition are known there.
const FILL_FRAG = /* glsl */ `
{
  vec3 fV = vViewPosition * inversesqrt(max(dot(vViewPosition, vViewPosition), 1e-8));
  vec3 fN = normal;
  float fNdV = clamp(dot(fN, fV), 0.0, 1.0);
  // view-space fill from just above-right of the camera: the side the player sees reads as a form
  const vec3 fL = vec3(0.3511, 0.5518, 0.7566);
  float fWrap = clamp(dot(fN, fL) * 0.6 + 0.4, 0.0, 1.0);
  float fG = clamp(dot(reflect(-fV, fN), fL), 0.0, 1.0);
  fG *= fG; fG *= fG; fG *= fG; fG *= fG;
  // pad light from below: faces pointing down, low on the hull
  vec3 fUp = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  float fDown = clamp(0.3 - dot(fN, fUp) * 0.7, 0.0, 1.0);
  float fH = clamp((uUpRange.y - vFillY) / max(uUpRange.y - uUpRange.x, 0.01), 0.0, 1.0);
  float fRim = 1.0 - fNdV;
  fRim = fRim * fRim * fRim;
  float fGloss = clamp(1.0 - roughnessFactor, 0.0, 1.0);
  vec3 fAdd = diffuseColor.rgb * (uFillCol * fWrap + uUpCol * (fDown * fH)) + uFillSpec * (fG * (0.2 + 0.8 * fGloss)) + uRimCol * fRim;
  totalEmissiveRadiance += clamp(fAdd, vec3(0.0), vec3(16.0));
}
`;

/** Uniforms for patchFill (all zero = no effect). uUpRange = object-space y with full / no pad light. */
export function createFillUniforms() {
  return {
    uFillCol: { value: new THREE.Color(0, 0, 0) },
    uFillSpec: { value: new THREE.Color(0, 0, 0) },
    uRimCol: { value: new THREE.Color(0, 0, 0) },
    uUpCol: { value: new THREE.Color(0, 0, 0) },
    uUpRange: { value: new THREE.Vector2(0, 2.5) },
  };
}

/**
 * Adds the fill / rim / pad-uplight terms to a MeshStandard/Physical material
 * (chains any existing onBeforeCompile; call before other wrappers like sunVis).
 */
export function patchFill(mat, uniforms) {
  if (!mat || !uniforms || mat.userData.vehFill) return mat;
  mat.userData.vehFill = uniforms;
  const prev = mat.onBeforeCompile;
  const hadKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey');
  const prevKey = hadKey ? mat.customProgramCacheKey.bind(mat) : null;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FILL_VERT_DECL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFillY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FILL_FRAG_DECL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FILL_FRAG}`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : String(prev || '')}|veh-fill`;
  mat.needsUpdate = true;
  return mat;
}

/** Applies a skin definition (see SKINS) to a patched paint material. */
export function applySkin(mat, skin) {
  const u = mat.userData.veh;
  if (!u || !skin) return;
  u.uSkinA.value.setHex(skin.a);
  u.uSkinB.value.setHex(skin.b);
  u.uSkinMode.value = skin.mode;
  mat.metalness = skin.metal;
  mat.roughness = skin.rough;
}

// ------------------------------------------------------------ textures
let _tex = null;
/** Shared procedural textures (created once). */
export function vehicleTextures() {
  if (_tex) return _tex;
  const emblem = canvasTexture(256, 256, (g, w) => drawEmblem(g, w / 2, w / 2, w * 0.3, w * 0.05, '#f2ede4'), { anisotropy: 8 });
  const radial = canvasTexture(
    128,
    128,
    (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    },
    { srgb: false },
  );
  // rotor motion-blur disc: faint ring with tip streaks, transparent centre
  const rotor = canvasTexture(
    256,
    256,
    (g, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const gr = g.createRadialGradient(cx, cy, w * 0.08, cx, cy, w * 0.5);
      gr.addColorStop(0, 'rgba(30,32,36,0)');
      gr.addColorStop(0.2, 'rgba(40,42,46,0.35)');
      gr.addColorStop(0.75, 'rgba(60,62,68,0.42)');
      gr.addColorStop(0.92, 'rgba(120,124,130,0.55)');
      gr.addColorStop(1, 'rgba(120,124,130,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, w / 2, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 5; k++) {
        const a0 = (k / 5) * Math.PI * 2;
        for (let i = 0; i < 18; i++) {
          g.strokeStyle = `rgba(160,165,175,${0.05 * (1 - i / 18)})`;
          g.lineWidth = w * 0.1;
          g.beginPath();
          g.arc(cx, cy, w * 0.33, a0 - i * 0.05, a0 - i * 0.05 + 0.05);
          g.stroke();
        }
      }
    },
    { srgb: true },
  );
  // soft vertical beam (headlight cones, lifter plumes): bright at v = 1, fades to 0
  const beam = canvasTexture(
    64,
    128,
    (g, w, h) => {
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const v = 1 - y / (h - 1);
        for (let x = 0; x < w; x++) {
          const u = (x / (w - 1)) * 2 - 1;
          const a = Math.max(0, 1 - u * u) * v * v;
          const i = (y * w + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
          img.data[i + 3] = Math.round(a * 255);
        }
      }
      g.putImageData(img, 0, 0);
    },
    { srgb: false, mipmaps: true },
  );
  _tex = { emblem, radial, rotor, beam };
  return _tex;
}

/**
 * The shared material set. `sunVis` (optional) = terrain sun-visibility patcher
 * applied to the large opaque materials in the world scene.
 */
export function createVehicleMaterials({ sunVis = null } = {}) {
  const tex = vehicleTextures();
  const list = [];
  /** Fill uniforms: VTOLs / car / stairs (`fill`) and the parked spaceship (`shipFill`), driven by look.js. */
  const fill = createFillUniforms();
  const shipFill = createFillUniforms();
  const own = (m, sun = true) => {
    if (sun && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) patchFill(m, fill);
    list.push(m);
    if (sun && sunVis) {
      try {
        sunVis(m);
      } catch {
        /* optional */
      }
    }
    return m;
  };
  /** Car paint (skins). One per car so skins don't leak to other cars. */
  const makePaint = () => {
    const m = new THREE.MeshPhysicalMaterial({ name: 'veh-paint', color: 0xffffff, vertexColors: true, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 });
    patchMaterial(m, { skin: true });
    return own(m);
  };
  /** Armoured hull with panel seams (VTOL / ship). One per vehicle that can be re-skinned. */
  const makeArmor = (skinLength = 20) => {
    const m = new THREE.MeshPhysicalMaterial({ name: 'veh-armor', color: 0xffffff, vertexColors: true, metalness: 0.5, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.25, envMapIntensity: 1.0 });
    const u = patchMaterial(m, { panels: { size: [1.3, 0.9], variation: 0.22, seam: 0.55, seamWidth: 0.018 }, skin: true, skinLength });
    u.uSkinA.value.set(1, 1, 1); // default: the vertex colours are the hull colour
    u.uSkinB.value.set(1, 1, 1);
    return own(m);
  };
  /** HDR emissive strips (vertex colours > 1 glow through the bloom). One per vehicle for night/brake control. */
  const makeGlow = () => own(new THREE.MeshBasicMaterial({ name: 'veh-glow', color: 0xffffff, vertexColors: true }), false);
  const paint = makePaint();
  const armor = makeArmor();
  const dark = own(new THREE.MeshStandardMaterial({ name: 'veh-dark', color: 0xffffff, vertexColors: true, metalness: 0.55, roughness: 0.5 }));
  const carbon = own(new THREE.MeshStandardMaterial({ name: 'veh-carbon', color: 0x17191c, metalness: 0.35, roughness: 0.42, vertexColors: true }));
  const glass = own(new THREE.MeshPhysicalMaterial({ name: 'veh-glass', color: 0x07090c, metalness: 0.25, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.7 }));
  const rubber = own(new THREE.MeshStandardMaterial({ name: 'veh-rubber', color: 0x0d0d0e, metalness: 0, roughness: 0.9 }));
  const rim = own(new THREE.MeshStandardMaterial({ name: 'veh-rim', color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.24 }));
  const glow = makeGlow();
  const engine = own(new THREE.MeshBasicMaterial({ name: 'veh-engine', color: hdr(0xff8a3c, 2.2), map: tex.radial, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), false);
  const decal = own(new THREE.MeshStandardMaterial({ name: 'veh-decal', map: tex.emblem, transparent: true, depthWrite: false, roughness: 0.45, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), false);
  return { paint, armor, dark, carbon, glass, rubber, rim, glow, engine, decal, list, tex, makePaint, makeArmor, makeGlow, fill, shipFill };
}
