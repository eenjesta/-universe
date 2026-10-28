/**
 * First-person view model (characters module): stylised arms in the player's outfit
 * colours + the held weapon / tool / food, drawn in an OVERLAY pass (own scene + camera,
 * depth cleared) right after the world RenderPass, so it never clips into geometry but
 * still gets the world's sun, sky light, environment reflections, shadow map, bloom and
 * colour grade. The vm camera shares the world camera's transform (so lighting and the
 * shared sun shadow are in world space); only its FOV differs (guns don't stretch at a
 * wide FOV).
 *
 * The item (gun, tool, food) is posed in camera space by procedural layers: base pose per
 * grip (hip / ADS / sprint / lowered), equip raise, walk bob (stride-locked), look sway,
 * breathing, jump / land, recoil springs, reload, grenade throw, hit jolt, dodge duck and the
 * work actions (chop / mine / gather / eat / use / build keyframes with a hit-stop at the
 * impact). The hands are attached to the item's grips (right fist on the grip, left on the
 * support point); the arms are solved with two-bone IK from off-screen shoulders.
 *
 *   const vm = createViewModel(ctx, { player });
 *   vm.update(dt, fpW)          // after the camera is final (loop order > 21)
 *   vm.muzzleWorld(out) → bool  // muzzle on the world camera's ray through the gun's muzzle on screen
 *   vm.socketMatrix(out) → bool // tool tip / hand in world space (for ctx.player.toolSocket)
 *   vm.onAction(name, opts, dur, impactAt)  vm.onImpact()  vm.setAppearance(app)
 * No per-frame allocation.
 */
import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp } from '../core/math.js';
import { ease } from './tool-actions.js';
import { createFoodModel } from './tool-models.js';

const TAU = Math.PI * 2;
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ poses
/**
 * Camera-space item poses per grip: [x, y, z, pitch, yaw, roll] of the item origin (weapon:
 * trigger grip, barrel −Z; tool: right grip, handle +Y, striking face −Z).
 *   hip     relaxed / hip-fire        sprint  lowered, canted across the body
 *   ads     [z, extra y] — x/y from the item's sight line (centred on the screen)
 *   fov     view-model FOV (hip, ads)  kick: recoil scale    two: support hand
 */
const GRIP_VM = {
  pistol: { hip: [0.15, -0.165, -0.4, 0.03, 0.07, 0.0], sprint: [0.12, -0.26, -0.34, -0.62, 0.55, 0.4], ads: [-0.36, 0.0], fov: [58, 50], kick: 1, two: true },
  rifle: { hip: [0.165, -0.185, -0.5, 0.02, 0.06, 0.0], sprint: [0.08, -0.27, -0.42, -0.48, 0.8, 0.42], ads: [-0.42, -0.004, 0.018], fov: [56, 46], kick: 0.55, two: true },
  heavy: { hip: [0.175, -0.195, -0.52, 0.02, 0.06, 0.0], sprint: [0.08, -0.28, -0.42, -0.48, 0.8, 0.42], ads: [-0.48, -0.006, 0.02], fov: [56, 42], kick: 1.7, two: true },
  grenade: { hip: [0.17, -0.2, -0.4, 0.25, 0.1, 0.0], sprint: [0.15, -0.28, -0.34, -0.2, 0.3, 0.2], ads: [-0.4, 0.06], fov: [58, 54], kick: 0.4, two: false },
  axe: { hip: [0.32, -0.28, -0.55, -0.868, 0.6, 0.194], sprint: [0.3, -0.4, -0.46, 0.15, 0.35, -0.6], ads: [-0.52, -0.1], fov: [60, 58], kick: 0.6, two: false },
  pick: { hip: [0.32, -0.28, -0.55, -0.812, 0.533, 0.163], sprint: [0.3, -0.4, -0.44, 0.15, 0.3, -0.55], ads: [-0.5, -0.1], fov: [60, 58], kick: 0.6, two: false },
  laser: { hip: [0.15, -0.17, -0.42, 0.03, 0.07, 0.0], sprint: [0.12, -0.26, -0.34, -0.6, 0.5, 0.4], ads: [-0.38, 0.0], fov: [58, 50], kick: 0.5, two: true },
  hands: { hip: [0.18, -0.3, -0.4, 0, 0, 0], sprint: [0.18, -0.34, -0.34, 0, 0, 0], ads: [-0.4, 0], fov: [60, 58], kick: 0.3, two: false },
};
/** Right fist centre on the gun grip (item space; the model origin sits at the top of the grip). */
const GRIP_FIST = { pistol: [0, -0.042, 0.012], rifle: [0, -0.046, 0.016], heavy: [0, -0.046, 0.016], laser: [0, -0.036, 0.012], grenade: [0, -0.06, 0.016] };

/**
 * Work action tracks (camera space). Keys: [t, ease, x, y, z, hx, hy, hz, bx, by, bz, open] — the item
 * origin (grip / fist) position, its handle direction (item +Y) and striking / finger direction (item −Z)
 * — or [t, ease, x, y, z, pitch, yaw, roll, open] (Euler XYZ). Orientations are slerped (no gimbal flips
 * on big swings). `open` = 1 shows the open hand (gestures). The impact sits at timing.impact /
 * timing.dur; the first / last key is the ready pose (= the grip's hip pose) so swings chain smoothly.
 */
// = GRIP_VM.axe / pick hip (Euler of the same frame): the fist shows bottom-right, the head right of the crosshair
const AXE_READY = [0.32, -0.28, -0.55, -0.16, 0.72, -0.68, -0.5, 0.1, -0.86, 0];
const PICK_READY = [0.32, -0.28, -0.55, -0.14, 0.74, -0.66, -0.42, 0.2, -0.88, 0];
const LASER_READY = [0.15, -0.17, -0.42, 0.03, 0.07, 0, 0];
const VM_ACT_SRC = {
  chop: [
    [0, 'io', ...AXE_READY],
    [0.4, 'out', 0.22, -0.1, -0.44, -0.25, 0.62, -0.74, -0.45, -0.55, -0.7, 0],
    [0.5, 'in', 0.08, -0.3, -0.5, -0.22, 0.3, -0.93, -0.55, -0.8, 0.1, 0],
    [0.6, 'out', 0.1, -0.28, -0.5, -0.2, 0.38, -0.9, -0.5, -0.85, 0.1, 0],
    [1, 'io', ...AXE_READY],
  ],
  mine: [
    [0, 'io', ...PICK_READY],
    [0.42, 'out', 0.16, -0.06, -0.42, -0.15, 0.55, -0.82, -0.1, 0.85, 0.5, 0],
    [0.52, 'in', 0.05, -0.33, -0.5, -0.08, 0.15, -0.98, -0.05, -0.97, -0.15, 0],
    [0.64, 'out', 0.07, -0.3, -0.52, -0.08, 0.25, -0.96, -0.05, -0.95, -0.2, 0],
    [1, 'io', ...PICK_READY],
  ],
  'mine-laser': [
    [0, 'io', ...LASER_READY],
    [0.18, 'out', 0.07, -0.13, -0.46, 0.0, 0.02, 0, 0],
    [0.86, 'lin', 0.07, -0.13, -0.46, 0.01, 0.02, 0, 0],
    [1, 'io', ...LASER_READY],
  ],
  gather: [
    [0, 'io', 0.2, -0.46, -0.3, -0.4, 0.2, 0.2, 1],
    [0.3, 'out', 0.1, -0.25, -0.46, -1.0, 0.15, 0.3, 1],
    [0.47, 'out', 0.05, -0.21, -0.56, -1.25, 0.1, 0.3, 1],
    [0.56, 'io', 0.06, -0.22, -0.53, -1.1, 0.1, 0.3, 0],
    [0.8, 'io', 0.16, -0.3, -0.36, -0.6, 0.2, 0.25, 0],
    [1, 'io', 0.2, -0.48, -0.28, -0.4, 0.2, 0.2, 0],
  ],
  eat: [
    [0, 'io', 0.16, -0.44, -0.3, 0.4, 0.1, 0.2, 0],
    // the food comes up into the lower centre of the view (readable), then a bite toward the mouth
    [0.4, 'out', 0.04, -0.12, -0.27, 0.55, 0.25, 0.35, 0],
    [0.52, 'in', 0.03, -0.1, -0.22, 0.68, 0.25, 0.35, 0],
    [0.7, 'io', 0.045, -0.115, -0.26, 0.6, 0.25, 0.35, 0],
    [1, 'io', 0.16, -0.44, -0.3, 0.4, 0.1, 0.2, 0],
  ],
  use: [
    [0, 'io', 0.2, -0.4, -0.3, -0.3, 0.1, 0.1, 1],
    [0.47, 'out', 0.08, -0.14, -0.5, -1.45, 0.05, 0.25, 1],
    [0.62, 'io', 0.08, -0.14, -0.48, -1.4, 0.05, 0.25, 1],
    [1, 'io', 0.2, -0.42, -0.3, -0.3, 0.1, 0.1, 1],
  ],
  build: [
    [0, 'io', 0.2, -0.38, -0.32, -0.4, 0.1, 0.1, 1],
    [0.4, 'out', 0.1, -0.1, -0.5, -1.55, 0.05, 0.3, 1],
    [0.6, 'io', 0.1, -0.11, -0.48, -1.5, 0.05, 0.3, 1],
    [1, 'io', 0.2, -0.4, -0.32, -0.4, 0.1, 0.1, 1],
  ],
};
/** Item frame quaternion from a handle (+Y) and a striking (−Z) direction. */
function frameQuat(h, b, out) {
  const y = new THREE.Vector3(h[0], h[1], h[2]).normalize();
  const z = new THREE.Vector3(-b[0], -b[1], -b[2]);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
/** Precomputed tracks: [{ t, ease, p: Vector3, q: Quaternion, open }]. */
const VM_ACT = {};
for (const [name, keys] of Object.entries(VM_ACT_SRC)) {
  VM_ACT[name] = keys.map((k) => {
    const vec = k.length >= 12;
    const q = new THREE.Quaternion();
    if (vec) frameQuat(k.slice(5, 8), k.slice(8, 11), q);
    else q.setFromEuler(new THREE.Euler(k[5], k[6], k[7], 'XYZ'));
    return { t: k[0], ease: k[1], p: new THREE.Vector3(k[2], k[3], k[4]), q, open: k[vec ? 11 : 8] || 0 };
  });
}
/** Samples a track at x ∈ [0, 1] → position / quaternion; returns the `open` flag of the segment. */
function sampleTrack(track, x, pos, quat) {
  let k = 1;
  while (k < track.length - 1 && x > track[k].t) k++;
  const a = track[k - 1];
  const b = track[k];
  const span = b.t - a.t;
  const f = span > 1e-6 ? ease(b.ease, clamp((x - a.t) / span, 0, 1)) : 1;
  pos.lerpVectors(a.p, b.p, f);
  quat.slerpQuaternions(a.q, b.q, f);
  return f < 0.5 ? a.open : b.open;
}

// shoulders (camera space, off-screen) + arm lengths
const SHOULDER_R = new THREE.Vector3(0.22, -0.36, 0.1);
const SHOULDER_L = new THREE.Vector3(-0.22, -0.36, 0.1);
const L_UP = 0.3;
const L_FORE = 0.27;
const POLE_R = new THREE.Vector3(0.75, -1, 0.15).normalize();
const POLE_L = new THREE.Vector3(-0.75, -1, 0.15).normalize();
// grip → wrist (hand bone origin) in grip space: the fist wraps a handle along +Y, forearm toward +Z
const WRIST = new THREE.Vector3(0, -0.012, 0.075);
// grip tilt per weapon kind: the fists follow the angle of the pistol grip / handle
const GRIP_TILT = { pistol: -0.3, rifle: -0.28, heavy: -0.28, laser: -0.25, grenade: 0, axe: 0, pick: 0, hands: 0 };
/**
 * Left fist on the gun (item space: fist centre + Euler XYZ; the fist wraps a handle along its +Y):
 * the rifle / railgun foregrips, a cupping hold under the pistol grip. Tools use their own support
 * point (a grip on the handle), the mining laser a hold under its front.
 */
const VM_SUPPORT = {
  pistol: { p: [-0.024, -0.054, 0.008], r: [-0.3, 0, 0.55] },
  rifle: { p: [0, -0.032, -0.33], r: [-0.12, 0, 0] },
  heavy: { p: [0, -0.008, -0.2], r: [-0.1, 0, 0] },
  laser: { p: [-0.004, 0.004, -0.1], r: [-1.45, 0, 0.1] },
  tool: { p: null, r: [0, 0, 0] },
};

// --------------------------------------------------------------- geometry
function colorize(g, color) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function prep(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  if (g.attributes.uv) g.deleteAttribute('uv');
  return colorize(g, color);
}
/** Finger: a torus arc around the handle (Y axis) at height y, from angle a0 over `arc` radians. */
function finger(r, tube, y, a0, arc, color) {
  const g = new THREE.TorusGeometry(r, tube, 6, 10, arc);
  g.rotateX(-Math.PI / 2); // ring in the XZ plane; angle 0 = +X, 90° = −Z (front)
  g.rotateY(a0);
  g.translate(0, y, 0);
  return prep(g, color);
}

/**
 * Right fist around a handle along +Y through the origin (grip space); wrist toward +Z. Vertex colours:
 * glove (or skin), knuckle pads, the cyan wrist LED (> 1 = emissive). Returns { fist, open } geometries.
 */
function buildHands(glove, pad, led) {
  const parts = [];
  // back of the hand / palm block behind-right of the handle, toward the wrist
  parts.push(prep(new THREE.BoxGeometry(0.036, 0.086, 0.062, 1, 2, 2), glove, 0.016, -0.002, 0.034, 0, 0.2, 0));
  // fingers: index (top) … pinky (bottom), wrapping the front of the handle
  parts.push(finger(0.024, 0.0095, 0.03, -0.35, 3.5, glove));
  parts.push(finger(0.0245, 0.0098, 0.0095, -0.35, 3.55, glove));
  parts.push(finger(0.024, 0.0094, -0.011, -0.35, 3.5, glove));
  parts.push(finger(0.0225, 0.0085, -0.03, -0.35, 3.4, glove));
  // knuckle pads on the finger bases
  parts.push(prep(new THREE.BoxGeometry(0.014, 0.078, 0.022), pad, 0.026, 0.0, -0.006, 0, 0.5, 0));
  // thumb over the top, along the handle's left side
  parts.push(prep(new THREE.CapsuleGeometry(0.0095, 0.034, 3, 6), glove, -0.012, 0.046, -0.008, 1.2, 0, 0.5));
  // wrist cuff of the glove + LED strip on the back of the hand
  parts.push(prep(new THREE.CylinderGeometry(0.03, 0.032, 0.026, 10), glove, 0.004, -0.01, 0.07, Math.PI / 2, 0, 0));
  parts.push(prep(new THREE.BoxGeometry(0.004, 0.012, 0.03), led, 0.035, 0.0, 0.05, 0, 0.2, 0));
  const fist = mergeGeometries(parts);
  // open hand (gestures): flat palm + straight-ish fingers pointing −Z (forward), thumb out
  const op = [];
  op.push(prep(new THREE.BoxGeometry(0.024, 0.084, 0.07, 1, 2, 2), glove, 0.004, -0.004, 0.03));
  for (let i = 0; i < 4; i++) {
    const y = 0.03 - i * 0.02;
    op.push(prep(new THREE.CapsuleGeometry(0.0085 - i * 0.0004, 0.05 - (i === 3 ? 0.01 : 0), 3, 6), glove, -0.002, y, -0.03, Math.PI / 2 - 0.25, 0, 0));
  }
  op.push(prep(new THREE.BoxGeometry(0.012, 0.074, 0.02), pad, 0.012, -0.002, -0.004));
  op.push(prep(new THREE.CapsuleGeometry(0.009, 0.03, 3, 6), glove, -0.012, 0.05, 0.012, 0.6, 0, 0.9));
  op.push(prep(new THREE.CylinderGeometry(0.03, 0.032, 0.026, 10), glove, 0.004, -0.01, 0.07, Math.PI / 2, 0, 0));
  op.push(prep(new THREE.BoxGeometry(0.004, 0.012, 0.03), led, 0.017, 0.0, 0.05));
  const open = mergeGeometries(op);
  return { fist, open };
}

/** Mirrors a geometry in X (left hand), keeping the winding front-facing. */
function mirrorX(geo) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const col = g.attributes.color;
  // non-indexed: swap vertices 1 and 2 of every triangle
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of [pos, nor, col]) {
      if (!a) continue;
      for (let k = 0; k < a.itemSize; k++) {
        const v1 = a.array[(i + 1) * a.itemSize + k];
        a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k];
        a.array[(i + 2) * a.itemSize + k] = v1;
      }
    }
  }
  return g;
}

/** Sleeve segment along +Y from 0 to 1 (scaled to the bone length), radius r0 at the root, r1 at the end. */
function sleeveGeo(r0, r1, folds) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 14, 6, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    // soft fabric folds
    const f = 1 + folds * (Math.sin(y * 19 + a * 2) * 0.5 + Math.sin(y * 31 - a * 3) * 0.3);
    p.setXYZ(i, x * f, y, z * f);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the pass
class ViewModelPass extends Pass {
  constructor(vm) {
    super();
    this.vm = vm;
    this.needsSwap = false;
    this.clear = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.vm.shouldRender()) return;
    const ac = renderer.autoClear;
    const sm = renderer.shadowMap;
    const au = sm.autoUpdate;
    const nu = sm.needsUpdate;
    renderer.autoClear = false;
    sm.autoUpdate = false; // reuse the world's shadow map (shared sun shadow) — no shadow pass for the arms
    sm.needsUpdate = false;
    try {
      renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
      renderer.clearDepth();
      renderer.render(this.vm.scene, this.vm.camera);
    } finally {
      renderer.autoClear = ac;
      sm.autoUpdate = au;
      sm.needsUpdate = nu;
    }
  }
}

// ------------------------------------------------------------- view model
export function createViewModel(ctx, { player }) {
  const scene = new THREE.Scene();
  scene.name = 'chr-viewmodel';
  scene.matrixWorldAutoUpdate = true;
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 30);
  camera.name = 'chr-vm-camera';
  scene.add(camera);
  const hemi = new THREE.HemisphereLight(0xbcd0ff, 0x3a3026, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0c0, 2);
  sun.castShadow = false;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.PointLight(0xffd2a8, 0, 2.5, 2); // muzzle flash light on the arms
  camera.add(fill);
  fill.position.set(0.1, -0.08, -0.7);
  // readability: a soft camera-relative light from above-left-behind, scaled to the world's ambient level and
  // raised when the view faces the key light (sunset / backlit: the visible faces of the gun are in shade)
  const vmKey = new THREE.DirectionalLight(0xffffff, 0);
  vmKey.name = 'chr-vm-fill';
  vmKey.position.set(-0.55, 0.85, 0.6);
  const vmKeyTarget = new THREE.Object3D();
  vmKeyTarget.position.set(0.15, -0.3, -1);
  camera.add(vmKey, vmKeyTarget);
  vmKey.target = vmKeyTarget;

  const root = new THREE.Group(); // camera space
  root.name = 'chr-vm-root';
  camera.add(root);
  const itemPivot = new THREE.Group(); // the animated item frame (grip)
  itemPivot.name = 'chr-vm-item';
  root.add(itemPivot);
  const gripFrame = new THREE.Group(); // right fist on the grip, tilted like the grip / handle
  itemPivot.add(gripFrame);
  const supportFrame = new THREE.Group(); // left hand frame (item space)
  itemPivot.add(supportFrame);

  // ---- materials (vertex colours; colours > 1 glow)
  const HOT = `{ vec3 vc = vColor.rgb; float hot = step(1.001, max(vc.r, max(vc.g, vc.b))); totalEmissiveRadiance += vc * hot * 0.9; }`;
  const mkMat = (name, rough, metal) => {
    const m = new THREE.MeshStandardMaterial({ name, color: 0xffffff, vertexColors: true, roughness: rough, metalness: metal });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${HOT}`);
    };
    m.customProgramCacheKey = () => 'chr-vm-hot';
    return m;
  };
  const handMat = mkMat('chr-vm-hand', 0.62, 0.05);
  const sleeveMat = new THREE.MeshStandardMaterial({ name: 'chr-vm-sleeve', color: 0x1c1f25, roughness: 0.86, metalness: 0.02 });
  const cuffMat = new THREE.MeshStandardMaterial({ name: 'chr-vm-cuff', color: 0xd8d2c6, roughness: 0.6, metalness: 0.1 });
  const seamMat = new THREE.MeshStandardMaterial({ name: 'chr-vm-seam', color: 0x041018, emissive: 0x5fd6ff, emissiveIntensity: 2.2, roughness: 0.4 });
  const flashMat = new THREE.MeshBasicMaterial({ name: 'chr-vm-flash', color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true });

  // ---- arms
  const upperGeo = sleeveGeo(0.05, 0.045, 0.035);
  const foreGeo = sleeveGeo(0.044, 0.037, 0.045);
  const elbowGeo = new THREE.SphereGeometry(0.043, 12, 8);
  const cuffGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.028, 14, 1, true).translate(0, -0.012, 0);
  const seamGeo = new THREE.CylinderGeometry(0.0408, 0.0408, 0.0035, 14, 1, true).translate(0, 0.0015, 0);
  let handGeo = null;
  function makeArm(side) {
    const g = new THREE.Group();
    g.name = `chr-vm-arm-${side > 0 ? 'r' : 'l'}`;
    const upper = new THREE.Mesh(upperGeo, sleeveMat);
    const fore = new THREE.Mesh(foreGeo, sleeveMat);
    const elbow = new THREE.Mesh(elbowGeo, sleeveMat);
    const cuff = new THREE.Mesh(cuffGeo, cuffMat);
    const seam = new THREE.Mesh(seamGeo, seamMat);
    cuff.add(seam);
    const hand = new THREE.Group();
    const fist = new THREE.Mesh(undefined, handMat);
    const open = new THREE.Mesh(undefined, handMat);
    hand.add(fist, open);
    for (const m of [upper, fore, elbow, cuff, seam, fist, open]) {
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = false;
    }
    g.add(upper, fore, elbow, cuff);
    return { group: g, upper, fore, elbow, cuff, hand, fist, open, side, shown: false };
  }
  const armR = makeArm(1);
  const armL = makeArm(-1);
  root.add(armR.group, armL.group);
  gripFrame.add(armR.hand); // right fist on the grip
  supportFrame.add(armL.hand); // left fist on the support point

  // muzzle flash (camera space, at the muzzle)
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat);
  flash.frustumCulled = false;
  flash.renderOrder = 10;
  flash.visible = false;
  root.add(flash);

  // ---- appearance
  let appKey = '';
  function setAppearance(app = {}) {
    const key = `${app.outfit}|${app.outfitColor}|${app.accentColor}|${app.skin}|${app.gloves}`;
    if (key === appKey) return;
    appKey = key;
    const gloves = !!app.gloves || app.outfit === 'vanguard' || app.outfit === 'pathfinder' || app.outfit === 'drifter';
    const glove = new THREE.Color(gloves ? 0x1b1d22 : app.skin || '#c68e67');
    const pad = new THREE.Color(gloves ? 0x3c414a : app.skin || '#c68e67').multiplyScalar(gloves ? 1 : 0.92);
    const led = new THREE.Color(app.outfit === 'vanguard' ? 0x7fe0ff : 0x5fd6ff).multiplyScalar(2.6);
    const hg = buildHands(glove, pad, led);
    const left = { fist: mirrorX(hg.fist), open: mirrorX(hg.open) };
    if (handGeo) for (const g of [handGeo.r.fist, handGeo.r.open, handGeo.l.fist, handGeo.l.open]) g.dispose();
    handGeo = { r: hg, l: left };
    armR.fist.geometry = hg.fist;
    armR.open.geometry = hg.open;
    armL.fist.geometry = left.fist;
    armL.open.geometry = left.open;
    sleeveMat.color.set(app.outfitColor || '#1c1f25');
    // very dark outfits read as black blobs at the screen edge: lift them a little
    const hsl = { h: 0, s: 0, l: 0 };
    sleeveMat.color.getHSL(hsl);
    if (hsl.l < 0.09) sleeveMat.color.setHSL(hsl.h, hsl.s, 0.09);
    cuffMat.color.copy(sleeveMat.color).multiplyScalar(0.62);
    seamMat.emissive.set(app.outfit === 'vanguard' ? 0x7fe0ff : app.accentColor && app.accentColor !== '#15171b' && app.accentColor !== '#d8d2c6' ? app.accentColor : 0x5fd6ff);
  }
  setAppearance(player.appearance);

  // ---- pass (after the world RenderPass, before sanitize / bloom / grade / output)
  const engine = ctx.engine;
  const pass = new ViewModelPass(null);
  let installed = false;
  function installPass() {
    if (installed || !engine?.composer) return;
    const passes = engine.composer.passes;
    const i = passes.indexOf(engine.renderPass);
    engine.composer.insertPass(pass, i >= 0 ? i + 1 : 1);
    installed = true;
  }

  // ---- state
  const S = {
    w: 0, // view-model visibility weight (fp blend)
    item: null, // displayed Object3D (weapon / tool), re-parented under `tilt`
    itemSrc: null, // 'weapon' | 'tool'
    itemPrev: null, // { parent, receive } to restore
    kind: 'hands',
    gripVm: GRIP_VM.hands,
    sightY: 0.06,
    muzzle: new THREE.Vector3(0, 0.05, -0.6),
    tip: new THREE.Vector3(0, 0.47, -0.16),
    support: new THREE.Vector3(),
    supportRot: new THREE.Euler(),
    holdW: 0, // 0 lowered … 1 raised (equip)
    lowering: false, // holstered / put away: lowering before the item goes back to the body
    gestureW: 0, // arms up for a bare-hand gesture
    adsW: 0,
    sprintW: 0,
    airW: 0,
    t: 0,
    // springs (position + rotation offsets) for recoil / landing / hit
    kick: new Float32Array(6),
    kickV: new Float32Array(6),
    swayX: 0,
    swayY: 0,
    bobAmp: 0,
    // one-shots
    act: null, // { name, t, dur, impact, track, laser, item }
    hitStop: 0,
    reloadT: -1,
    reloadDur: 1,
    throwT: -1,
    duckT: -1,
    flashT: 1,
    wasGrounded: true,
  };
  const foods = new Map();
  let foodShown = null;
  const _p = new THREE.Vector3();
  const _p2 = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'XYZ');
  const _m = new THREE.Matrix4();
  const _s = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _el = new THREE.Vector3();
  const _sh = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _x = new THREE.Vector3();
  const _box = new THREE.Box3();
  const _box2 = new THREE.Box3();
  const _m2 = new THREE.Matrix4();
  const _key = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const WHITE = new THREE.Color(1, 1, 1);
  const pose = new Float32Array(6); // base pose (Euler), then the layers' offsets (position + camera-space rotation)
  const posBase = new THREE.Vector3();
  const qBase = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  // ------------------------------------------------------------ items
  /** What the hands should hold now: the tool (if any) wins over a drawn weapon. */
  function wanted() {
    const tool = player.toolRig;
    if (tool?.kind && tool.object) return { obj: tool.object, src: 'tool', kind: tool.kind, rig: tool };
    const w = player.weaponRig;
    if (w?.kind && w.object && !w.holstered && !w.forceHolster) {
      const k = w.object.userData?.kind === 'shock-grenade' ? 'grenade' : w.kind;
      return { obj: w.object, src: 'weapon', kind: k, rig: w };
    }
    return null;
  }

  function release(restore = true) {
    const o = S.item;
    if (!o) return;
    if (o.parent === itemPivot) itemPivot.remove(o);
    if (S.itemPrev) {
      o.traverse((m) => {
        if (m.isMesh && S.itemPrev.receive.has(m)) m.receiveShadow = S.itemPrev.receive.get(m);
      });
    }
    const rig = S.itemSrc === 'tool' ? player.toolRig : player.weaponRig;
    if (restore && rig && rig.object === o) rig.reattach();
    else if (rig && rig.object !== o && rig.detached) rig.reattach(); // the rig moved on: its new item lives on the body
    S.item = null;
    S.itemSrc = null;
    S.itemPrev = null;
  }

  function adopt(want) {
    const o = want.obj;
    want.rig.detached = true;
    const receive = new Map();
    o.traverse((m) => {
      if (m.isMesh) {
        receive.set(m, m.receiveShadow);
        m.receiveShadow = true;
      }
    });
    o.removeFromParent();
    itemPivot.add(o);
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.visible = true;
    S.item = o;
    S.itemSrc = want.src;
    S.itemPrev = { receive };
    setKind(want.kind, want.rig);
    S.holdW = 0; // raise it into view
  }

  function setKind(kind, rig) {
    S.kind = GRIP_VM[kind] ? kind : 'rifle';
    S.gripVm = GRIP_VM[S.kind];
    gripFrame.rotation.set(GRIP_TILT[S.kind] || 0, 0, 0);
    const gf = S.itemSrc === 'weapon' || S.kind === 'laser' ? GRIP_FIST[S.kind] : null;
    if (gf) gripFrame.position.fromArray(gf);
    else gripFrame.position.set(0, 0, 0);
    // item-space points (the rig knows the per-model muzzle / support / tip)
    if (rig) {
      S.muzzle.copy(rig.muzzle);
      S.support.copy(rig.support);
      S.tip.copy(rig.muzzle);
    }
    // sight line: top of the model (guns), so ADS centres it
    if (S.item) {
      S.item.updateMatrixWorld(true);
      _m.copy(S.item.matrixWorld).invert();
      _box.makeEmpty();
      S.item.traverse((m) => {
        if (m.isMesh && m.geometry && m.visible !== false) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          _box2.copy(m.geometry.boundingBox).applyMatrix4(_m2.multiplyMatrices(_m, m.matrixWorld));
          _box.union(_box2);
        }
      });
      // the crosshair floats just above the gun's top line (no scope overlay in this style)
      S.sightY = _box.isEmpty() ? 0.06 : clamp(_box.max.y + 0.006, 0.02, 0.24);
    }
    // left fist: the gun's foregrip (weapons) / the tool's support grip
    const vs = S.itemSrc === 'weapon' ? VM_SUPPORT[S.kind] : S.kind === 'laser' ? VM_SUPPORT.laser : VM_SUPPORT.tool;
    if (vs?.p) S.support.fromArray(vs.p);
    S.supportRot.set(...(vs?.r || VM_SUPPORT.tool.r));
    supportFrame.position.copy(S.support);
    supportFrame.rotation.copy(S.supportRot);
  }

  function syncItem() {
    const want = wanted();
    S.lowering = false;
    if (want && want.obj === S.item) {
      if (want.kind !== S.kind && GRIP_VM[want.kind]) setKind(want.kind, want.rig);
      return;
    }
    // holstered / put away: lower it out of view first, then give it back (a swap raises the new one at once)
    // (also when the owner already dropped it: holdTool(null) clears the rig — the old model still lowers, no pop)
    // a tool being put away also lowers before the weapon comes back up; weapon ↔ weapon swaps raise the new one at once
    if (S.item && S.holdW > 0.04 && (!want || (S.itemSrc === 'tool' && want.src !== 'tool'))) {
      S.lowering = true;
      // the next item still sits in the body's hand (near the eye): keep it hidden until the hands take it
      if (want && want.obj !== S.item) want.obj.visible = false;
      return;
    }
    // the owner swapped / dropped the item: give the old one back (if still theirs), take the new one
    if (S.item) {
      const stillOwned = player.weaponRig?.object === S.item || player.toolRig?.object === S.item;
      release(stillOwned);
    }
    if (want) adopt(want);
  }

  // ------------------------------------------------------------ actions
  function onAction(name, opts = {}, dur = 0.5, impact = 0) {
    switch (name) {
      case 'shoot': {
        if (S.kind === 'grenade') {
          S.throwT = 0;
          return;
        }
        const k = S.gripVm.kick * (opts.recoil ?? 1) * (1 - 0.45 * S.adsW);
        const r = Math.random;
        // position (x, y, z) + rotation (pitch, yaw, roll) impulses
        S.kickV[2] += 0.95 * k;
        S.kickV[1] += 0.12 * k;
        S.kickV[3] += 2.6 * k;
        S.kickV[4] += (r() - 0.5) * 0.9 * k;
        S.kickV[5] += (r() - 0.5) * 1.3 * k;
        S.flashT = 0;
        return;
      }
      case 'reload':
        S.reloadT = 0;
        S.reloadDur = Math.max(0.3, dur);
        return;
      case 'hit':
        S.kickV[3] += 1.2;
        S.kickV[5] += (Math.random() - 0.5) * 2;
        S.kickV[1] -= 0.25;
        return;
      case 'dodge':
        S.duckT = 0;
        return;
      case 'respawn':
        S.holdW = 0;
        return;
      default:
        break;
    }
    const track = name === 'mine' && S.kind === 'laser' ? VM_ACT['mine-laser'] : VM_ACT[name];
    if (!track) return;
    S.act = { name, t: 0, dur: Math.max(0.15, dur), impact, track, item: opts.item || null, laser: track === VM_ACT['mine-laser'] };
    if (name === 'eat') {
      const id = opts.item || 'ration';
      let f = foods.get(id);
      if (!f) {
        f = createFoodModel(id);
        f.traverse((m) => {
          if (m.isMesh) {
            m.frustumCulled = false;
            m.receiveShadow = true;
          }
        });
        foods.set(id, f);
      }
      foodShown = f;
    }
  }

  function onImpact(ev) {
    if (!S.act) return;
    // hit-stop: the swing freezes for a beat at the impact, then rebounds (juice)
    const tool = ev.action === 'chop' || (ev.action === 'mine' && !S.act.laser);
    if (tool) {
      S.hitStop = 0.055;
      S.kickV[3] -= 1.6; // rebound
      S.kickV[2] += 0.35;
      ctx.cameraRig?.shake?.(ev.action === 'mine' ? 0.1 : 0.075);
    }
  }

  // ------------------------------------------------------------ per frame
  /** Second-order spring toward 0 for the kick channels. */
  function springs(dt) {
    const K = 230;
    const D = 2 * Math.sqrt(K) * 0.82;
    const steps = dt > 1 / 45 ? 2 : 1;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < 6; i++) {
        const a = -K * S.kick[i] - D * S.kickV[i];
        S.kickV[i] += a * h;
        S.kick[i] += S.kickV[i] * h;
      }
    }
  }

  function basePose(out, dt) {
    const g = S.gripVm;
    const hip = g.hip;
    for (let i = 0; i < 6; i++) out[i] = hip[i];
    // ADS: centre the sight line on the screen axis
    if (S.adsW > 0.001) {
      const a = S.adsW;
      // scoped guns sit a touch right / low of the crosshair (the scope stays readable), iron sights centre
      const ax = g.ads[2] || 0;
      const ay = -S.sightY + g.ads[1];
      const az = g.ads[0];
      out[0] = lerp(out[0], ax, a);
      out[1] = lerp(out[1], ay, a);
      out[2] = lerp(out[2], az, a);
      out[3] = lerp(out[3], 0, a);
      out[4] = lerp(out[4], 0, a);
      out[5] = lerp(out[5], 0, a);
    }
    if (S.sprintW > 0.001) {
      const sp = g.sprint;
      const k = S.sprintW * (1 - S.adsW);
      for (let i = 0; i < 6; i++) out[i] = lerp(out[i], sp[i], k);
    }
    void dt;
  }

  function update(dt, fpW) {
    S.w = fpW;
    const active = fpW > 0.001 && ctx.modes?.is?.('explore');
    if (!active) {
      if (S.item) release(true);
      root.visible = false;
      flash.visible = false;
      fill.intensity = 0;
      S.act = null;
      return;
    }
    installPass();
    S.t += dt;
    const input = ctx.input;
    const a = player.character.anim;
    // ---- items
    syncItem();
    // ---- world camera → vm camera (same transform; own FOV)
    const wc = ctx.camera;
    camera.position.copy(wc.position);
    camera.quaternion.copy(wc.quaternion);
    if (camera.aspect !== wc.aspect) camera.aspect = wc.aspect;
    // ---- lights follow the world
    const w = ctx.world;
    _key.set(0.35, 0.6, -0.7);
    if (w?.sun) {
      sun.color.copy(w.sun.color);
      sun.intensity = w.sun.visible === false ? 0 : w.sun.intensity;
      // the world's key direction: the sun by day, the giant planet at night (lighting.js keyDir)
      if (w.sun.target) _key.copy(w.sun.position).sub(w.sun.target.position);
      if (_key.lengthSq() < 1e-6 && w.sunDirection) _key.copy(w.sunDirection);
      if (_key.lengthSq() < 1e-6) _key.set(0.35, 0.6, -0.7);
      _key.normalize();
      sun.target.position.copy(wc.position);
      sun.position.copy(wc.position).addScaledVector(_key, 40);
      // share the world sun's shadow map (rendered this frame) so the arms darken in shade
      if (w.sun.castShadow && w.sun.shadow?.map && ctx.engine?.renderer?.shadowMap?.enabled) {
        if (sun.shadow !== w.sun.shadow) sun.shadow = w.sun.shadow;
        sun.castShadow = true;
      } else sun.castShadow = false;
    }
    if (w?.hemi) {
      hemi.color.copy(w.hemi.color);
      hemi.groundColor.copy(w.hemi.groundColor);
      hemi.intensity = w.hemi.intensity;
    }
    _fwd.set(0, 0, -1).applyQuaternion(wc.quaternion);
    const backlit = clamp(_fwd.dot(_key), 0, 1) * clamp(_key.y * 4 + 0.2, 0, 1);
    vmKey.intensity = clamp(0.3 * hemi.intensity + 0.32 * sun.intensity * backlit, 0.03, 1.4);
    vmKey.color.copy(hemi.color).lerp(WHITE, 0.55);
    const env = w?.scene?.environment || null;
    if (scene.environment !== env) scene.environment = env;
    scene.environmentIntensity = w?.scene?.environmentIntensity ?? 1;

    // ---- what is shown
    const hasItem = !!S.item;
    const act = S.act;
    const gesture = !!act && !hasItem;
    const dead = player.dead;
    const swim = player.swimming;
    const show = (hasItem || gesture) && !dead;
    // raise / lower (equip, holster, swimming, respawn)
    const holdT = show && !swim && !S.lowering ? 1 : 0;
    S.holdW = damp(S.holdW, holdT, holdT ? 7 : 10, dt);
    S.gestureW = damp(S.gestureW, gesture ? 1 : 0, 12, dt);
    root.visible = S.holdW > 0.01 || S.gestureW > 0.01;
    if (!hasItem && !gesture && S.gestureW < 0.01) {
      root.visible = false;
      return;
    }
    if (!hasItem && S.kind !== 'hands') setKind('hands', null);

    // ---- state weights
    S.adsW = damp(S.adsW, player.aiming && hasItem && S.itemSrc === 'weapon' ? 1 : 0, 14, dt);
    const sprinting = player.sprinting && !act;
    S.sprintW = damp(S.sprintW, sprinting ? 1 : 0, sprinting ? 7 : 10, dt);
    const air = !player.grounded && !swim;
    S.airW = damp(S.airW, air ? 1 : 0, 8, dt);
    if (S.wasGrounded === false && player.grounded) {
      const vy = Math.min(1, Math.abs(a.vy || 6) / 9);
      S.kickV[1] -= 0.55 * (0.4 + vy);
      S.kickV[3] -= 0.8 * (0.4 + vy);
    }
    S.wasGrounded = player.grounded;

    // ---- sway (look), bob (stride), breathing
    const headBob = ctx.state?.get?.('settings.headBob') !== false;
    const lx = input?.lookX || 0;
    const ly = input?.lookY || 0;
    const swayK = 1 - 0.6 * S.adsW;
    S.swayX = damp(S.swayX, clamp(-lx * 0.0016, -0.09, 0.09) * swayK, 10, dt);
    S.swayY = damp(S.swayY, clamp(-ly * 0.0016, -0.07, 0.07) * swayK, 10, dt);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const bobTarget = player.grounded && !swim ? clamp(speed / 4.4, 0, 1.7) : 0;
    S.bobAmp = damp(S.bobAmp, bobTarget, 6, dt);
    const ph = a.phase * TAU;
    const bob = S.bobAmp * (headBob ? 1 : 0.35) * (1 - 0.75 * S.adsW);
    springs(dt);

    // ---- base pose (grip hip / ADS / sprint); a work action's track replaces it (tracks start + end
    //      at the ready pose = the hip pose, so swings flow in and out of the idle hold)
    basePose(pose, dt);
    posBase.set(pose[0], pose[1], pose[2]);
    _e.set(pose[3], pose[4], pose[5], 'XYZ');
    qBase.setFromEuler(_e);
    pose.fill(0); // from here on: offsets added by the layers
    let open = 0;
    let foodVis = false;
    let working = false;
    if (act) {
      if (S.hitStop > 0) S.hitStop -= dt;
      else act.t += dt;
      const x = act.t / act.dur;
      if (x >= 1) S.act = null;
      else {
        working = true;
        open = sampleTrack(act.track, x, posBase, qBase) > 0.5 ? 1 : 0;
        if (act.laser && x > act.impact / act.dur && x < 0.86) {
          // the beam runs: a fine buzz
          pose[0] += Math.sin(S.t * 91) * 0.0012;
          pose[1] += Math.sin(S.t * 77 + 1) * 0.0012;
        }
        foodVis = act.name === 'eat' && act.t > act.dur * 0.04 && act.t < act.impact + act.dur * 0.07;
      }
    }
    // equip raise (an item comes up from below), gesture arms rise into view
    const low = hasItem ? 1 - S.holdW : 1 - S.gestureW;
    pose[1] -= 0.28 * low;
    pose[3] -= 0.7 * low;
    // dynamic layers (calmer while working)
    const dyn = working ? 0.35 : 1;
    // walk bob: figure-8 locked to the stride, dips at each footfall
    pose[0] += Math.sin(ph) * 0.011 * bob * dyn;
    pose[1] += (Math.cos(ph * 2) * 0.5 - 0.5) * 0.012 * bob * dyn;
    pose[5] += Math.sin(ph) * 0.02 * bob * dyn;
    pose[3] += Math.cos(ph * 2) * 0.008 * bob * dyn;
    // breathing + idle drift
    const br = Math.sin(S.t * 1.35);
    pose[1] += br * 0.0016 * (1 - 0.5 * S.adsW) * dyn;
    pose[3] += br * 0.004 * (1 - 0.6 * S.adsW) * dyn;
    pose[4] += Math.sin(S.t * 0.55) * 0.004 * (1 - S.adsW) * dyn;
    // look sway: the item lags behind the view
    pose[4] += S.swayX;
    pose[3] += S.swayY;
    pose[0] += S.swayX * 0.12;
    pose[1] += S.swayY * 0.1;
    pose[5] += S.swayX * 0.6;
    // airborne: drift up while rising, down while falling
    pose[1] += S.airW * clamp((a.vy || 0) * -0.004, -0.02, 0.03);
    pose[3] += S.airW * 0.05;

    // ---- reload: tilt + lower, the left hand fetches a fresh cell
    let supportOff = 0;
    if (S.reloadT >= 0) {
      S.reloadT += dt;
      const x = S.reloadT / S.reloadDur;
      if (x >= 1) S.reloadT = -1;
      else {
        const e = sstep(0, 0.16, x) * (1 - sstep(0.82, 1, x));
        pose[5] += 0.62 * e;
        pose[3] += -0.16 * e;
        pose[1] += -0.04 * e;
        pose[0] += -0.03 * e;
        // cell in: a jolt
        const jolt = Math.exp(-Math.pow((x - 0.64) / 0.035, 2));
        pose[1] += 0.012 * jolt;
        pose[3] += 0.05 * jolt;
        supportOff = sstep(0.12, 0.3, x) * (1 - sstep(0.5, 0.66, x));
      }
    }
    // ---- grenade throw: wind up, release (the grenade leaves the hand), follow through, draw a new one
    let grenadeHidden = false;
    if (S.throwT >= 0) {
      S.throwT += dt;
      const x = S.throwT;
      if (x > 0.95) S.throwT = -1;
      else {
        const wind = sstep(0, 0.16, x) * (1 - sstep(0.16, 0.26, x));
        const fol = sstep(0.18, 0.3, x) * (1 - sstep(0.4, 0.62, x));
        pose[0] += 0.06 * wind - 0.1 * fol;
        pose[1] += 0.1 * wind - 0.16 * fol;
        pose[2] += 0.12 * wind - 0.12 * fol;
        pose[3] += 0.6 * wind - 0.9 * fol;
        grenadeHidden = x > 0.22 && x < 0.62;
        const redraw = sstep(0.62, 0.95, x);
        if (x > 0.3) pose[1] -= 0.25 * (1 - redraw);
      }
    }
    // ---- dodge: duck the item out of the way
    if (S.duckT >= 0) {
      S.duckT += dt;
      const x = S.duckT / 0.62;
      if (x >= 1) S.duckT = -1;
      else {
        const e = Math.sin(Math.PI * x);
        pose[1] -= 0.12 * e;
        pose[3] -= 0.35 * e;
        pose[5] += 0.25 * e;
      }
    }

    // ---- kick springs (recoil, landing, hits)
    pose[0] += S.kick[0];
    pose[1] += S.kick[1] * 0.06;
    pose[2] += S.kick[2] * 0.045;
    pose[3] += S.kick[3] * 0.045;
    pose[4] += S.kick[4] * 0.04;
    pose[5] += S.kick[5] * 0.04;

    // ---- apply the item frame: base (pose / track) + offsets (camera-space rotation about the grip)
    itemPivot.position.set(posBase.x + pose[0], posBase.y + pose[1], posBase.z + pose[2]);
    _e.set(pose[3], pose[4], pose[5], 'XYZ');
    _q.setFromEuler(_e);
    itemPivot.quaternion.copy(qBase).premultiply(_q);
    if (S.item) S.item.visible = !(S.kind === 'grenade' && grenadeHidden);
    // food in the fingers
    for (const f of foods.values()) {
      if (f !== foodShown || !foodVis) {
        if (f.parent) f.removeFromParent();
      }
    }
    if (foodShown && foodVis && foodShown.parent !== gripFrame) gripFrame.add(foodShown);

    // ---- hands + arms
    const showFist = hasItem || (gesture && !open);
    armR.fist.visible = showFist;
    armR.open.visible = !showFist;
    const twoHanded = hasItem && S.gripVm.two && S.kind !== 'grenade' && !(act && !act.laser && (act.name === 'chop' || act.name === 'mine') && S.kind === 'axe');
    const leftOn = twoHanded || (hasItem && S.kind === 'pick');
    armL.group.visible = leftOn;
    armL.hand.visible = leftOn;
    armL.fist.visible = true;
    armL.open.visible = false;
    supportFrame.position.copy(S.support);
    if (supportOff > 0) supportFrame.position.y -= 0.32 * supportOff;
    root.updateMatrixWorld(true);
    solveArm(armR, SHOULDER_R, POLE_R, armR.hand);
    if (leftOn) solveArm(armL, SHOULDER_L, POLE_L, armL.hand);

    // ---- muzzle flash (guns)
    S.flashT += dt;
    const fl = S.itemSrc === 'weapon' && S.kind !== 'grenade' ? Math.max(0, 1 - S.flashT / 0.06) : 0;
    flash.visible = fl > 0.01;
    fill.intensity = fl * 3.2;
    if (flash.visible && S.item) {
      _p.copy(S.muzzle);
      _p.z -= 0.02;
      S.item.localToWorld(_p);
      root.worldToLocal(_p);
      flash.position.copy(_p);
      const sz = (S.kind === 'heavy' ? 0.16 : S.kind === 'pistol' ? 0.085 : 0.11) * (0.8 + Math.random() * 0.4);
      flash.scale.set(sz, sz, 1);
      flash.rotation.set(0, 0, Math.random() * TAU);
      flashMat.opacity = fl;
      flashMat.color.setRGB(2.4, 2.8, 3.2);
    }
    // ---- vm FOV (zooms a little with ADS)
    const fov = lerp(S.gripVm.fov[0], S.gripVm.fov[1], S.adsW);
    if (Math.abs(camera.fov - fov) > 0.01) camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  /** Two-bone IK in camera space: shoulder (slides if out of reach) → elbow → wrist of `hand`. */
  function solveArm(arm, shoulder, pole, hand) {
    arm.group.visible = true;
    // wrist (camera space) = hand frame × WRIST
    _w.copy(WRIST);
    hand.localToWorld(_w);
    root.worldToLocal(_w);
    _sh.copy(shoulder);
    _d.copy(_w).sub(_sh);
    let d = _d.length();
    if (d < 1e-4) return;
    _d.multiplyScalar(1 / d);
    const reach = L_UP + L_FORE - 0.002;
    if (d > reach) {
      _sh.copy(_w).addScaledVector(_d, -reach);
      d = reach;
    }
    d = Math.max(d, Math.abs(L_UP - L_FORE) + 0.01);
    const cosA = clamp((L_UP * L_UP + d * d - L_FORE * L_FORE) / (2 * L_UP * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _x.copy(pole).addScaledVector(_d, -pole.dot(_d));
    if (_x.lengthSq() < 1e-8) _x.set(0, -1, 0);
    _x.normalize();
    _el.copy(_sh).addScaledVector(_d, L_UP * cosA).addScaledVector(_x, L_UP * sinA);
    placeSeg(arm.upper, _sh, _el);
    placeSeg(arm.fore, _el, _w);
    arm.elbow.position.copy(_el);
    // cuff at the wrist, along the forearm
    arm.cuff.position.copy(_w);
    _p2.copy(_w).sub(_el).normalize();
    arm.cuff.quaternion.setFromUnitVectors(UP, _p2);
  }

  function placeSeg(mesh, a, b) {
    _p.copy(b).sub(a);
    const len = _p.length();
    mesh.position.copy(a);
    mesh.scale.set(1, Math.max(len, 1e-3), 1);
    if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, _p.multiplyScalar(1 / len));
  }

  // ------------------------------------------------------------ world mapping
  /** Camera-space point (vm) → world point that the WORLD camera shows at the same screen spot. */
  function toWorld(local, out) {
    // root is camera space: local coordinates are vm view space
    const wc = ctx.camera;
    const r = Math.tan((wc.fov * Math.PI) / 360) / Math.tan((camera.fov * Math.PI) / 360);
    out.set(local.x * r, local.y * r, local.z);
    return out.applyMatrix4(wc.matrixWorld);
  }

  function muzzleWorld(out) {
    if (!S.item || S.w < 0.5 || !root.visible) return false;
    _p.copy(S.muzzle);
    _p.z -= 0.012;
    S.item.localToWorld(_p);
    root.worldToLocal(_p);
    toWorld(_p, out);
    return true;
  }

  /** World matrix of the tool tip (tool) / hand (gesture) for ctx.player.toolSocket. */
  function socketMatrix(out) {
    if (S.w < 0.5 || !root.visible) return false;
    if (S.item) {
      _p.copy(S.itemSrc === 'tool' ? S.tip : S.muzzle);
      S.item.localToWorld(_p);
    } else {
      _p.copy(WRIST).multiplyScalar(0.3);
      armR.hand.localToWorld(_p);
    }
    root.worldToLocal(_p);
    toWorld(_p, _p2);
    // orientation: the vm camera shares the world camera's transform → the item frame is world already
    itemPivot.getWorldQuaternion(_q);
    out.compose(_p2, _q, _s.set(1, 1, 1));
    return true;
  }

  function shouldRender() {
    return S.w > 0.001 && root.visible && engine.camera === ctx.camera && engine.scene === ctx.world?.scene && ctx.modes?.is?.('explore');
  }
  pass.vm = { shouldRender, get scene() { return scene; }, get camera() { return camera; } };

  function dispose() {
    release(true);
    if (installed) {
      const i = engine.composer.passes.indexOf(pass);
      if (i >= 0) engine.composer.removePass(pass);
      installed = false;
    }
  }

  return {
    scene,
    camera,
    root,
    pass,
    update,
    onAction,
    onImpact,
    setAppearance,
    muzzleWorld,
    socketMatrix,
    shouldRender,
    release: () => release(true),
    dispose,
    get item() {
      return S.item;
    },
    get kind() {
      return S.kind;
    },
    get state() {
      return S;
    },
    debug: () => {
      let sight = null;
      if (S.item) {
        // the top of the gun right above the grip, projected with the vm camera (ADS: just under the screen centre)
        _p.set(0, S.sightY - 0.006, -0.05);
        S.item.localToWorld(_p);
        _p.project(camera);
        sight = [+_p.x.toFixed(3), +_p.y.toFixed(3)];
      }
      return { item: S.item?.name || null, src: S.itemSrc, kind: S.kind, hold: +S.holdW.toFixed(2), ads: +S.adsW.toFixed(2), sprint: +S.sprintW.toFixed(2), act: S.act?.name || null, visible: root.visible, installed, sightY: +S.sightY.toFixed(3), sight, fill: +vmKey.intensity.toFixed(2) };
    },
  };
}

export { GRIP_VM, VM_ACT };
