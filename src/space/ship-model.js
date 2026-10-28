import * as THREE from 'three';
import { PartBuilder, ring, polygon, tubeGeometry } from './geo.js';
import { emblemTexture } from '../core/textures.js';
import { mulberry32 } from '../core/math.js';

/**
 * The player's spaceship (procedural, faceted hard-surface): sleek dark
 * angular hull with panel lines, long nose with side strakes, swept wings with
 * down-turned tips, twin engine nacelles with orange cores and exhaust plumes,
 * blue thruster accents, cockpit glass, tail fin with the Ø emblem, nav
 * lights and an optional landing gear. Shared with the vehicles module (the
 * atmospheric ship on the spaceport pad), so it holds up at close range.
 *
 *   const ship = createShipModel({ variant: 'player' | 'gold' | 'wingman', scale: 1,
 *                                  engineColor: 'orange' | 'blue', plumes: true, gear: false });
 *   ship.userData.setThrust(throttle 0..1, boost 0..1);   // plume length + core glow
 *   ship.userData.setGear(true);                           // landing gear (ground at y = −groundOffset)
 *   ship.userData.update(t);                               // nav-light blink (optional)
 *
 * `lite: true` skips the decals + nav lights (AI wingmen: fewer draw calls).
 * Local frame: front −Z, up +Y, origin at the centre of mass. Size ≈ 15.9 m
 * long, 12.8 m wingspan, 4 m tall. userData: engines (Object3D[] at the main
 * nozzle exits, pointing +Z), thrusters (blue wingtip ports), guns (laser
 * muzzles), size, groundOffset (gear down), materials, dispose().
 */

export const SHIP_SIZE = { length: 15.9, span: 12.8, height: 4.1, radius: 7.2 };

const PALETTES = {
  player: { base: '#23272d', vary: 0.12, line: 'rgba(6,7,9,0.95)', hi: 'rgba(255,255,255,0.07)', metal: 0.6, trim: 0x3b4048 },
  wingman: { base: '#2f343b', vary: 0.12, line: 'rgba(8,9,11,0.9)', hi: 'rgba(255,255,255,0.08)', metal: 0.55, trim: 0x4a5059 },
  gold: { base: '#866437', vary: 0.16, line: 'rgba(36,24,10,0.9)', hi: 'rgba(255,236,190,0.14)', metal: 0.88, trim: 0x2a2620 },
};

export const ENGINE_COLORS = {
  orange: { core: [3.4, 1.2, 0.32], hot: [3.0, 1.3, 0.45], cool: [0.5, 1.1, 3.4] },
  blue: { core: [2.2, 4.6, 9.0], hot: [1.6, 2.6, 4.0], cool: [0.35, 0.9, 3.2] },
  red: { core: [9.0, 1.4, 0.8], hot: [4.0, 0.8, 0.4], cool: [2.2, 0.3, 0.5] },
};

// ------------------------------------------------------------------ textures
const texCache = new Map();

function shade(hex, k) {
  const c = new THREE.Color(hex);
  const f = 1 + k;
  return `rgb(${Math.round(Math.min(255, c.r * 255 * f))},${Math.round(Math.min(255, c.g * 255 * f))},${Math.round(Math.min(255, c.b * 255 * f))})`;
}

/** Tileable panel-line hull textures (colour + roughness), cached per palette. */
export function hullTextures(variant = 'player', palOverride = null) {
  if (texCache.has(variant)) return texCache.get(variant);
  const pal = palOverride || PALETTES[variant] || PALETTES.player;
  const S = 512;
  const cc = document.createElement('canvas');
  const rc = document.createElement('canvas');
  cc.width = cc.height = rc.width = rc.height = S;
  const g = cc.getContext('2d');
  const r = rc.getContext('2d');
  let seed = 1234;
  for (let i = 0; i < variant.length; i++) seed = (seed * 31 + variant.charCodeAt(i)) >>> 0;
  const rng = mulberry32(seed);
  g.fillStyle = pal.base;
  g.fillRect(0, 0, S, S);
  r.fillStyle = '#7a7a7a';
  r.fillRect(0, 0, S, S);
  const rects = [];
  const split = (x, y, w, h, d) => {
    if (d > 5 || (w < 64 && h < 64) || (d > 1 && rng() < 0.16)) {
      rects.push([x, y, w, h]);
      return;
    }
    const vertical = w > h ? rng() < 0.82 : rng() < 0.18;
    if (vertical) {
      const k = Math.round(w * (0.28 + rng() * 0.44));
      split(x, y, k, h, d + 1);
      split(x + k, y, w - k, h, d + 1);
    } else {
      const k = Math.round(h * (0.28 + rng() * 0.44));
      split(x, y, w, k, d + 1);
      split(x, y + k, w, h - k, d + 1);
    }
  };
  split(0, 0, S, S, 0);
  for (const [x, y, w, h] of rects) {
    const tone = (rng() - 0.5) * pal.vary;
    g.fillStyle = shade(pal.base, tone);
    g.fillRect(x, y, w, h);
    // faint top-down wear gradient
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(255,255,255,0.025)');
    grad.addColorStop(1, 'rgba(0,0,0,0.05)');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    const rough = Math.round(255 * (0.36 + rng() * 0.3));
    r.fillStyle = `rgb(${rough},${rough},${rough})`;
    r.fillRect(x, y, w, h);
    // panel seams: dark groove + light lip
    g.strokeStyle = pal.line;
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    g.strokeStyle = pal.hi;
    g.lineWidth = 1;
    g.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
    r.strokeStyle = '#d8d8d8';
    r.lineWidth = 2;
    r.strokeRect(x + 1, y + 1, w - 2, h - 2);
    // rivets
    if (rng() < 0.4 && w > 40) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      for (let px = x + 7; px < x + w - 5; px += 9) g.fillRect(px, y + 6, 2, 2);
    }
    // vents / greebles
    if (w > 56 && h > 36 && rng() < 0.16) {
      const vw = Math.min(w - 20, 30 + rng() * 40);
      const vh = Math.min(h - 16, 14 + rng() * 18);
      const vx = x + 10;
      const vy = y + h - vh - 8;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(vx, vy, vw, vh);
      g.fillStyle = pal.hi;
      for (let k = vx + 3; k < vx + vw - 2; k += 5) g.fillRect(k, vy + 2, 1, vh - 4);
      r.fillStyle = '#e0e0e0';
      r.fillRect(vx, vy, vw, vh);
    }
    // small markings
    if (w > 70 && rng() < 0.08) {
      g.fillStyle = 'rgba(230,140,60,0.35)';
      g.fillRect(x + w - 22, y + 8, 12, 3);
    }
  }
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rc);
  for (const t of [map, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  const out = { map, roughnessMap };
  texCache.set(variant, out);
  return out;
}

let emblemTex = null;

// ------------------------------------------------------------------ plume shader
const PLUME_VERT = /* glsl */ `
  varying float vAlong;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vAlong = position.z;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz;
    vN = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;
const PLUME_FRAG = /* glsl */ `
  uniform vec3 uHot;
  uniform vec3 uCool;
  uniform float uIntensity;
  uniform float uTime;
  varying float vAlong;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec3 n = vN / max(length(vN), 1e-4);
    vec3 v = vV / max(length(vV), 1e-4);
    float a = clamp(vAlong, 0.0, 1.0);
    float facing = abs(dot(n, v));
    float core = facing * facing;
    float fade = (1.0 - a);
    fade *= fade;
    float flicker = 0.9 + 0.1 * sin(uTime * 61.0 + a * 23.0);
    vec3 col = mix(uHot, uCool, smoothstep(0.0, 0.55, a)) * core * fade * uIntensity * flicker;
    gl_FragColor = vec4(min(col, vec3(40.0)), 1.0);
  }
`;

export function plumeMaterial(hot, cool) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHot: { value: new THREE.Vector3(...hot) },
      uCool: { value: new THREE.Vector3(...cool) },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

/** Cone along +Z: radius 1 at z = 0 → `tip` at z = 1. */
export function plumeCone(radius, tip = 0.06, offsets = []) {
  const parts = offsets.map(([x, y]) => {
    const c = new THREE.CylinderGeometry(tip * radius, radius, 1, 18, 6, true);
    c.rotateX(Math.PI / 2);
    c.translate(x, y, 0.5);
    return c;
  });
  const b = new PartBuilder();
  parts.forEach((p) => b.add('p', p, null, { keepUV: true, smooth: true }));
  return b.geometry('p');
}

// ------------------------------------------------------------------ sections
function hullSection(w, top, bot, y0) {
  return [
    [w, y0 + 0.05 * top],
    [w * 0.82, y0 + top * 0.62],
    [w * 0.42, y0 + top * 0.96],
    [0, y0 + top],
    [-w * 0.42, y0 + top * 0.96],
    [-w * 0.82, y0 + top * 0.62],
    [-w, y0 + 0.05 * top],
    [-w * 0.78, y0 - bot * 0.75],
    [-w * 0.35, y0 - bot],
    [w * 0.35, y0 - bot],
    [w * 0.78, y0 - bot * 0.75],
  ];
}

function canopySection(w, h, y0) {
  return [
    [w, y0],
    [w * 0.72, y0 + h * 0.7],
    [w * 0.3, y0 + h * 0.97],
    [-w * 0.3, y0 + h * 0.97],
    [-w * 0.72, y0 + h * 0.7],
    [-w, y0],
    [0, y0 - 0.25],
  ];
}

/** Wing airfoil for a loft along +X (r = −z, u = y). */
function wingSection(le, te, y, t) {
  const rLE = -le;
  const rTE = -te;
  const c = rLE - rTE;
  return [
    [rLE, y],
    [rLE - 0.22 * c, y + t / 2],
    [rTE + 0.18 * c, y + t * 0.32],
    [rTE, y],
    [rTE + 0.18 * c, y - t * 0.3],
    [rLE - 0.22 * c, y - t / 2],
  ];
}

/** Vertical fin section for a loft along +Y (r = x, u = −z). */
function finSection(cx, le, te, t) {
  const uLE = -le;
  const uTE = -te;
  const c = uLE - uTE;
  return [
    [cx + t / 2, uLE - 0.25 * c],
    [cx, uLE],
    [cx - t / 2, uLE - 0.25 * c],
    [cx - t / 2, uTE + 0.2 * c],
    [cx, uTE],
    [cx + t / 2, uTE + 0.2 * c],
  ];
}

/** Flat blade section for a loft along +Z (strakes). */
function bladeSection(xi, xo, y, h) {
  const xm = (xi + xo) / 2;
  return [
    [xo, y],
    [xm, y + h],
    [xi, y],
    [xm, y - h],
  ];
}

const FUSE = [
  // z, w, top, bot, y0
  [-8.6, 0.05, 0.04, 0.04, -0.22],
  [-7.6, 0.36, 0.22, 0.2, -0.2],
  [-5.8, 0.74, 0.46, 0.36, -0.12],
  [-3.8, 1.02, 0.7, 0.5, -0.05],
  [-1.4, 1.28, 0.84, 0.62, 0],
  [1.4, 1.42, 0.88, 0.7, 0],
  [4.2, 1.38, 0.82, 0.7, 0],
  [6.4, 1.12, 0.68, 0.58, 0.02],
];
const CANOPY = [
  [-5.3, 0.04, 0.02, 0.36],
  [-4.4, 0.38, 0.2, 0.46],
  [-3.1, 0.62, 0.4, 0.6],
  [-1.6, 0.68, 0.46, 0.72],
  [-0.2, 0.52, 0.32, 0.8],
  [0.7, 0.16, 0.06, 0.84],
];
const NAC_X = 2.05;
const NAC_Y = -0.18;
const NACELLE = [
  [-1.9, 0.5],
  [-1.5, 0.78],
  [-0.4, 0.9],
  [3.0, 0.96],
  [5.8, 0.96],
  [6.8, 0.88],
];
const WING = [
  // x, le, te, y, t
  [1.0, -1.2, 5.9, -0.22, 0.4],
  [2.9, 0.6, 6.0, -0.3, 0.34],
  [4.6, 2.6, 6.15, -0.42, 0.26],
  [6.2, 4.3, 6.3, -0.56, 0.2],
];
const STRAKE = [
  [-6.6, 0.42, 0.5, -0.24, 0.03],
  [-4.6, 0.75, 1.45, -0.22, 0.06],
  [-2.2, 1.0, 1.95, -0.2, 0.07],
  [-0.9, 1.15, 1.75, -0.2, 0.07],
];

/** Thin box from p0 to p1 (w = width across, h = height) — light strips, struts. */
export function stripGeometry(p0, p1, w, h, up = [0, 1, 0]) {
  const a = new THREE.Vector3(...p0);
  const b = new THREE.Vector3(...p1);
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const z = b.clone().sub(a).normalize();
  const upV = new THREE.Vector3(...up);
  const x = new THREE.Vector3().crossVectors(upV, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(a.add(b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

// ------------------------------------------------------------------ materials
function makeMaterials(variant, engineColor) {
  const pal = PALETTES[variant] || PALETTES.player;
  const tex = hullTextures(variant);
  const ec = ENGINE_COLORS[engineColor] || ENGINE_COLORS.orange;
  if (!emblemTex) emblemTex = emblemTexture({ size: 256, color: '#ffffff', scale: 0.3, line: 0.06 });
  const hull = new THREE.MeshStandardMaterial({
    name: 'ship-hull',
    color: 0xffffff,
    map: tex.map,
    roughnessMap: tex.roughnessMap,
    metalness: pal.metal * 0.8,
    roughness: 1.35,
    envMapIntensity: 0.8,
  });
  const dark = new THREE.MeshStandardMaterial({ name: 'ship-dark', color: 0x0b0c0f, metalness: 0.4, roughness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ name: 'ship-trim', color: pal.trim, metalness: 0.8, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({
    name: 'ship-glass',
    color: 0x05080c,
    metalness: 1,
    roughness: 0.05,
    emissive: new THREE.Color(0x0e2a3a),
    emissiveIntensity: 0.2,
    envMapIntensity: 0.7,
  });
  const orange = new THREE.MeshBasicMaterial({ name: 'ship-glow-orange', color: new THREE.Color(2.0, 0.7, 0.2) });
  const blue = new THREE.MeshBasicMaterial({ name: 'ship-glow-blue', color: new THREE.Color(0.4, 1.5, 3.8) });
  const core = new THREE.MeshBasicMaterial({ name: 'ship-core', color: new THREE.Color(...ec.core) });
  const red = new THREE.MeshBasicMaterial({ name: 'ship-nav-red', color: new THREE.Color(6, 0.3, 0.2) });
  const green = new THREE.MeshBasicMaterial({ name: 'ship-nav-green', color: new THREE.Color(0.3, 6, 0.8) });
  const white = new THREE.MeshBasicMaterial({ name: 'ship-nav-white', color: new THREE.Color(6, 6, 6) });
  const emblem = new THREE.MeshStandardMaterial({
    name: 'ship-emblem',
    map: emblemTex,
    color: variant === 'gold' ? 0x1a140c : 0xd9d3c9,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    roughness: 0.5,
    metalness: 0.1,
  });
  const plumeOuter = plumeMaterial(ec.hot.map((v) => v * 0.35), ec.cool.map((v) => v * 0.5));
  const plumeInner = plumeMaterial(ec.hot.map((v) => v * 1.3), ec.cool.map((v) => v * 0.9));
  return { hull, dark, trim, glass, orange, blue, core, red, green, white, emblem, plumeOuter, plumeInner, _core: ec.core };
}

// ------------------------------------------------------------------ model
export function createShipModel(opts = {}) {
  const { variant = 'player', scale = 1, engineColor = 'orange', plumes = true, gear = false, lite = false } = opts;
  const mats = makeMaterials(variant, engineColor);
  const b = new PartBuilder({ uvScale: 1 / 3 });

  // fuselage
  b.loft(
    'hull',
    FUSE.map(([z, w, top, bot, y0]) => ring(hullSection(w, top, bot, y0), [0, 0, z], 'z')),
  );
  // rear exhaust plate + centre vent
  b.box('dark', [1.5, 0.7, 0.12], [0, 0.0, 6.43]);
  b.box('orange', [0.9, 0.06, 0.04], [0, 0.12, 6.5]);
  b.box('orange', [0.9, 0.06, 0.04], [0, -0.12, 6.5]);
  // canopy glass + frame
  b.loft('glass', CANOPY.map(([z, w, h, y0]) => ring(canopySection(w, h, y0), [0, 0, z], 'z')));
  b.add('trim', stripGeometry([0, 1.17, -3.0], [0, 1.27, -1.0], 0.07, 0.05));
  b.add('trim', stripGeometry([-0.62, 0.95, -2.3], [0.62, 0.95, -2.3], 0.05, 0.05));
  // dorsal spine + sensor mast
  b.add('trim', stripGeometry([0, 0.9, 0.4], [0, 0.86, 5.6], 0.3, 0.14));
  b.add('trim', new THREE.CylinderGeometry(0.03, 0.05, 0.7, 6), new THREE.Matrix4().makeTranslation(0.42, 1.18, 1.0));
  b.add('trim', new THREE.CylinderGeometry(0.02, 0.04, 0.5, 6), new THREE.Matrix4().makeTranslation(-0.42, 1.1, 1.4));
  // belly keel + blue strip
  b.add('dark', stripGeometry([0, -0.72, -3.4], [0, -0.74, 5.4], 0.5, 0.12));
  b.add('blue', stripGeometry([0, -0.81, -1.6], [0, -0.82, 3.6], 0.06, 0.03));

  // strakes (side blades along the nose)
  b.loftMirrored('hull', STRAKE.map(([z, xi, xo, y, h]) => ring(bladeSection(xi, xo, y, h), [0, 0, z], 'z')));
  b.addMirrored('orange', stripGeometry([1.4, -0.16, -4.1], [1.9, -0.15, -2.3], 0.05, 0.05));

  // laser cannons under the strakes
  const gunM = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  gunM.setPosition(1.3, -0.44, -3.9);
  b.addMirrored('trim', new THREE.CylinderGeometry(0.1, 0.13, 2.8, 8), gunM);
  const gunTip = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  gunTip.setPosition(1.3, -0.44, -5.36);
  b.addMirrored('dark', new THREE.CylinderGeometry(0.06, 0.08, 0.16, 8), gunTip);

  // engine nacelles
  const nacRings = NACELLE.map(([z, r]) => ring(polygon(10, [r, r * 1.05]), [NAC_X, NAC_Y, z], 'z'));
  b.loftMirrored('hull', nacRings, { capStart: false });
  // intake (dark disc) + lip
  const intake = new THREE.CircleGeometry(0.46, 10);
  intake.rotateY(Math.PI);
  b.addMirrored('dark', intake, new THREE.Matrix4().makeTranslation(NAC_X, NAC_Y, -1.55));
  // nozzle (trim tube)
  const nozOuter = [ring(polygon(14, 0.92), [NAC_X, NAC_Y, 6.6], 'z'), ring(polygon(14, 0.8), [NAC_X, NAC_Y, 7.55], 'z')];
  const nozInner = [ring(polygon(14, 0.74), [NAC_X, NAC_Y, 6.6], 'z'), ring(polygon(14, 0.7), [NAC_X, NAC_Y, 7.55], 'z')];
  b.addMirrored('trim', tubeGeometry(nozOuter, nozInner));
  // engine core discs (glow)
  const coreDisc = new THREE.CircleGeometry(0.72, 14);
  b.addMirrored('core', coreDisc, new THREE.Matrix4().makeTranslation(NAC_X, NAC_Y, 6.85));
  // nacelle light strips + top vents
  b.addMirrored('orange', stripGeometry([NAC_X + 0.97, NAC_Y, 1.4], [NAC_X + 0.97, NAC_Y, 5.6], 0.03, 0.045));
  b.addMirrored('dark', stripGeometry([NAC_X, NAC_Y + 0.98, 3.0], [NAC_X, NAC_Y + 0.98, 4.8], 0.6, 0.06));
  b.addMirrored('orange', stripGeometry([NAC_X - 0.2, NAC_Y + 1.02, 3.2], [NAC_X - 0.2, NAC_Y + 1.02, 4.6], 0.05, 0.02));
  b.addMirrored('orange', stripGeometry([NAC_X + 0.2, NAC_Y + 1.02, 3.2], [NAC_X + 0.2, NAC_Y + 1.02, 4.6], 0.05, 0.02));

  // wings
  b.loftMirrored(
    'hull',
    WING.map(([x, le, te, y, t]) => ring(wingSection(le, te, y, t), [x, 0, 0], 'x')),
  );
  // trailing-edge light strip (top surface) + leading-edge trim
  b.addMirrored('orange', stripGeometry([3.0, -0.17, 5.5], [5.9, -0.41, 5.86], 0.035, 0.03));
  b.addMirrored('trim', stripGeometry([3.0, -0.29, 0.66], [4.55, -0.41, 2.58], 0.08, 0.08));
  b.addMirrored('trim', stripGeometry([4.6, -0.42, 2.62], [6.15, -0.55, 4.3], 0.08, 0.08));
  // wingtip down-fins
  b.loftMirrored('hull', [
    ring(finSection(6.05, 5.3, 6.6, 0.12), [0, -1.6, 0], 'y'),
    ring(finSection(6.2, 4.4, 6.35, 0.2), [0, -0.46, 0], 'y'),
  ]);
  b.addMirrored('blue', stripGeometry([6.24, -0.7, 5.0], [6.14, -1.45, 5.8], 0.05, 0.05, [1, 0, 0]));
  // wingtip thruster ports
  b.box('dark', [0.22, 0.2, 0.2], [6.1, -0.5, 6.4], null, true);

  // tail fin
  b.loft('hull', [
    ring(finSection(0, 1.4, 6.2, 0.26), [0, 0.55, 0], 'y'),
    ring(finSection(0, 3.6, 6.6, 0.18), [0, 2.0, 0], 'y'),
    ring(finSection(0, 5.4, 6.95, 0.1), [0, 3.5, 0], 'y'),
  ]);
  b.add('trim', stripGeometry([0, 3.52, 5.4], [0, 3.52, 6.95], 0.12, 0.05));

  const group = new THREE.Group();
  group.name = 'ship';
  const body = b.build(mats);
  body.name = 'ship-body';
  group.add(body);

  // emblem decals on the fin
  const decal = new THREE.PlaneGeometry(1.25, 1.25);
  const dR = new THREE.Mesh(decal, mats.emblem);
  dR.position.set(0.115, 2.0, 5.15);
  dR.rotation.y = Math.PI / 2;
  const decalL = decal.clone();
  const uv = decalL.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const dL = new THREE.Mesh(decalL, mats.emblem);
  dL.position.set(-0.115, 2.0, 5.15);
  dL.rotation.y = -Math.PI / 2;
  dR.renderOrder = dL.renderOrder = 2;
  if (!lite) group.add(dR, dL);

  // nav lights
  const navGeo = new THREE.SphereGeometry(0.075, 8, 6);
  const navR = new THREE.Mesh(navGeo, mats.red);
  navR.position.set(-6.26, -0.52, 4.6);
  const navG = new THREE.Mesh(navGeo, mats.green);
  navG.position.set(6.26, -0.52, 4.6);
  const navW = new THREE.Mesh(navGeo, mats.white);
  navW.position.set(0, 3.6, 6.9);
  if (!lite) group.add(navR, navG, navW);

  // anchors
  const engines = [-1, 1].map((s) => {
    const o = new THREE.Object3D();
    o.name = s < 0 ? 'engine-left' : 'engine-right';
    o.position.set(s * NAC_X, NAC_Y, 7.55);
    group.add(o);
    return o;
  });
  const thrusters = [-1, 1].map((s) => {
    const o = new THREE.Object3D();
    o.position.set(s * 6.1, -0.5, 6.5);
    group.add(o);
    return o;
  });
  const guns = [-1, 1].map((s) => {
    const o = new THREE.Object3D();
    o.position.set(s * 1.3, -0.44, -5.45);
    group.add(o);
    return o;
  });

  // exhaust plumes (both engines merged per layer; length via scale.z)
  let plumeOuter = null;
  let plumeInner = null;
  if (plumes) {
    const offs = [
      [-NAC_X, NAC_Y],
      [NAC_X, NAC_Y],
    ];
    plumeOuter = new THREE.Mesh(plumeCone(0.78, 0.1, offs), mats.plumeOuter);
    plumeInner = new THREE.Mesh(plumeCone(0.42, 0.05, offs), mats.plumeInner);
    for (const p of [plumeOuter, plumeInner]) {
      p.position.z = 7.5;
      p.renderOrder = 3;
      p.frustumCulled = false;
      group.add(p);
    }
  }

  // landing gear
  const gb = new PartBuilder({ uvScale: 1 / 2 });
  gb.add('trim', stripGeometry([0, -0.6, -4.3], [0, -2.05, -4.5], 0.16, 0.16, [0, 0, 1]));
  gb.box('dark', [0.5, 0.12, 0.8], [0, -2.1, -4.5]);
  for (const s of [-1, 1]) {
    gb.add('trim', stripGeometry([s * NAC_X, -1.0, 3.6], [s * (NAC_X + 0.25), -2.05, 3.9], 0.2, 0.2, [0, 0, 1]));
    gb.box('dark', [0.7, 0.12, 1.0], [s * (NAC_X + 0.25), -2.1, 3.9]);
  }
  const gearGroup = gb.build({ trim: mats.trim, dark: mats.dark });
  gearGroup.name = 'ship-gear';
  gearGroup.visible = !!gear;
  group.add(gearGroup);

  group.scale.setScalar(scale);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.material !== mats.plumeOuter && o.material !== mats.plumeInner && !o.material.isMeshBasicMaterial;
      o.receiveShadow = o.material === mats.hull;
    }
  });

  const coreBase = mats._core;
  let thrust = 0.4;
  let boost = 0;
  const setThrust = (t = 0.4, bst = 0) => {
    thrust = Math.max(0, Math.min(1, t));
    boost = Math.max(0, Math.min(1, bst));
    const k = 0.35 + thrust * 0.75 + boost * 0.5;
    mats.core.color.setRGB(coreBase[0] * k, coreBase[1] * k, coreBase[2] * k);
    if (plumeOuter) {
      const len = 2.5 + thrust * 7.5 + boost * 5;
      plumeOuter.scale.set(1, 1, len);
      plumeInner.scale.set(1, 1, len * 0.45);
      mats.plumeOuter.uniforms.uIntensity.value = 0.25 + thrust * 0.8 + boost * 0.7;
      mats.plumeInner.uniforms.uIntensity.value = 0.35 + thrust * 0.75 + boost * 0.6;
      plumeOuter.visible = plumeInner.visible = thrust > 0.01 || boost > 0.01;
    }
  };
  setThrust(0.4, 0);

  group.userData = {
    kind: 'ship',
    engines,
    thrusters,
    guns,
    size: { ...SHIP_SIZE, length: SHIP_SIZE.length * scale, span: SHIP_SIZE.span * scale, height: SHIP_SIZE.height * scale, radius: SHIP_SIZE.radius * scale },
    groundOffset: 2.16 * scale,
    materials: mats,
    gear: gearGroup,
    plumes: [plumeOuter, plumeInner].filter(Boolean),
    get thrust() {
      return thrust;
    },
    get boost() {
      return boost;
    },
    setThrust,
    setGear(on) {
      gearGroup.visible = !!on;
    },
    update(t) {
      const blink = (t % 1.4) < 0.12;
      navR.visible = navG.visible = true;
      navW.visible = blink;
      mats.plumeOuter.uniforms.uTime.value = t;
      mats.plumeInner.uniforms.uTime.value = t;
    },
    dispose() {
      group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      for (const [k, m] of Object.entries(mats)) if (k[0] !== '_' && m.isMaterial) m.dispose();
    },
  };
  return group;
}
