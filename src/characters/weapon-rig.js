/**
 * WeaponRig (characters module): places a held weapon and solves both arms
 * onto it with analytic two-bone IK, after the Animator has written its pose.
 *
 * Weapon model convention (ctx.player.holdWeapon(mesh, { grip })): barrel along
 * −Z, top +Y, origin at the trigger grip (palm of the right hand), metres.
 * Grip presets (GRIPS): 'pistol' (one hand when relaxed, two-handed isosceles
 * when aiming), 'rifle' (two hands always: low-ready carry, stock in the right
 * shoulder pocket when aiming), 'heavy' (railgun: like the rifle, bigger).
 * Per-weapon overrides: { muzzle:[x,y,z], support:[x,y,z] (left wrist), stock:[x,y,z] }.
 *
 * Placement blends between the stance (aim / carry, from the Animator's aimW,
 * aimYaw/aimPitch, recoil, reload) and the right hand (dodge, death, materialize,
 * pistol at rest); holstered weapons ride on the back / right thigh.
 *   const rig = new WeaponRig(chr);
 *   rig.set('rifle', { object: mesh });     // or rig.set(null)
 *   chr.anim.update(dt); rig.update(ik);    // world matrix in rig.matrixWorld
 * No per-frame allocation.
 */
import * as THREE from 'three';
import { J } from './skeleton.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Grip presets. Positions in weapon space unless noted.
 *   wristR   right wrist (IK target of the trigger hand)
 *   support  left wrist (IK target of the support hand)
 *   stock    stock butt (two-handed: sits in the shoulder pocket when aiming)
 *   shoulder stock butt relative to the right shoulder joint (character frame, aiming)
 *   aimAt    grip position relative to the chest joint when aiming (one-handed weapons)
 *   carry    [x, y, z, yaw, pitch]: grip relative to the chest joint + orientation (low ready)
 *   hand     [x, y, z, rx, ry, rz]: grip in right-hand space (relaxed / dodge / dead)
 *   holster  'back' | 'thigh'
 */
export const GRIPS = {
  pistol: {
    two: false,
    muzzle: [0, 0.055, -0.21],
    wristR: [0.004, -0.05, 0.075],
    support: [-0.04, -0.08, 0.04],
    aimAt: [0.07, 0.115, -0.44],
    hand: [0, -0.075, -0.015, -0.5, 0, 0],
    holster: 'thigh',
    reload: 1.1,
  },
  rifle: {
    two: true,
    muzzle: [0, 0.05, -0.66],
    wristR: [0.006, -0.045, 0.08],
    support: [-0.03, -0.075, -0.25],
    stock: [0, 0.035, 0.27],
    shoulder: [-0.035, -0.045, -0.06],
    carry: [0.12, -0.07, -0.2, 0.75, -0.25],
    hand: [0, -0.075, -0.02, -0.35, 0, 0],
    holster: 'back',
    reload: 1.45,
  },
  heavy: {
    two: true,
    muzzle: [0, 0.06, -0.98],
    wristR: [0.006, -0.05, 0.085],
    support: [-0.032, -0.085, -0.22],
    stock: [0, 0.045, 0.34],
    shoulder: [-0.035, -0.05, -0.05],
    carry: [0.13, -0.08, -0.17, 0.8, -0.25],
    hand: [0, -0.08, -0.02, -0.3, 0, 0],
    holster: 'back',
    reload: 2.0,
  },
  // ---- tools (tool-models.js convention: handle along +Y, striking face −Z, origin = right grip).
  // Placed in right-hand space (the animator swings the arm); `support` = left wrist on the handle
  // for two-handed swings (IK weight from the animator's toolTwoW).
  axe: {
    tool: true,
    two: false,
    muzzle: [0, 0.47, -0.16],
    wristR: [0.0, -0.012, 0.072],
    support: [0, -0.115, 0],
    hand: [0, -0.078, -0.012, -Math.PI / 2, 0, 0],
    holster: 'back',
  },
  pick: {
    tool: true,
    two: false,
    muzzle: [0, 0.49, -0.25],
    wristR: [0.0, -0.012, 0.072],
    support: [0, -0.14, 0],
    hand: [0, -0.078, -0.012, -Math.PI / 2, 0, 0],
    holster: 'back',
  },
  // the mining laser is held like a pistol (aim stance while mining)
  laser: {
    tool: true,
    two: false,
    muzzle: [0, 0.055, -0.27],
    wristR: [0.004, -0.05, 0.075],
    support: [-0.028, 0.012, -0.11],
    hand: [0, -0.075, -0.015, -0.5, 0, 0],
    holster: 'thigh',
  },
};
/** Tool ids / families → tool grip presets. */
export const TOOL_GRIP_OF = { axe: 'axe', 'plasma-axe': 'axe', hatchet: 'axe', hammer: 'axe', pickaxe: 'pick', pick: 'pick', 'mining-laser': 'laser', laser: 'laser' };

// scratch (module level: the rigs update one after another)
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qA = new THREE.Quaternion();
const _qH = new THREE.Quaternion();
const _qP = new THREE.Quaternion();
const _qC = new THREE.Quaternion();
const _pA = new THREE.Vector3();
const _pH = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _S = new THREE.Vector3();
const _T = new THREE.Vector3();
const _E = new THREE.Vector3();
const _D = new THREE.Vector3();
const _P = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _b = new THREE.Vector3();
const _a0 = new THREE.Vector3();
const _b0 = new THREE.Vector3();
const _c0 = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _M0 = new THREE.Matrix4();
const _M1 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _qa0 = new THREE.Quaternion();
const _qf0 = new THREE.Quaternion();
const _qcl = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const POLE_R = new THREE.Vector3(0.85, -1, 0.35);
const POLE_L = new THREE.Vector3(-0.55, -1, 0.05);
const POLE_L_PISTOL = new THREE.Vector3(-0.75, -1, 0.15);
const HIP_L = new THREE.Vector3(-0.2, 0.94, 0.04); // character space (reload: grab a fresh cell)

/** Quaternion of a weapon frame whose barrel points along `barrel` with its top toward `up`. */
function frameQuat(barrel, up, out) {
  _c0.copy(barrel).normalize().negate(); // local +Z
  _c1.copy(up).addScaledVector(_c0, -up.dot(_c0)).normalize(); // local +Y
  _b0.crossVectors(_c1, _c0); // local +X
  _M0.makeBasis(_b0, _c1, _c0);
  return out.setFromRotationMatrix(_M0);
}
const HOLSTER = {
  // chest space: diagonal across the back, barrel up-right, top facing away from the body
  back: { p: new THREE.Vector3(0.02, 0.02, 0.27), q: frameQuat(new THREE.Vector3(0.62, 0.78, 0.05), new THREE.Vector3(0, 0, 1), new THREE.Quaternion()) },
  // right thigh space: barrel down, grip toward the back
  thigh: { p: new THREE.Vector3(0.105, -0.16, 0.02), q: frameQuat(new THREE.Vector3(0, -1, 0.08), new THREE.Vector3(0, 0, -1), new THREE.Quaternion()) },
};

export class WeaponRig {
  /**
   * opts.tool: this rig holds TOOLS (gathering) instead of weapons: it never writes anim.grip and its
   * kind goes to anim.tool; the right arm is animated (FK), only the left hand is solved onto the handle.
   */
  constructor(chr, { tool = false } = {}) {
    this.chr = chr;
    this.isTool = !!tool;
    this.kind = null; // 'pistol' | 'rifle' | 'heavy' | 'axe' | 'pick' | 'laser' | null
    this.grip = null;
    this.object = null; // optional Object3D placed in character space (child of chr.object)
    this.holstered = false;
    this.forceHolster = false; // weapon rides holstered while a tool is in the hands
    this.detached = false; // the FP view model owns the object (no re-parenting / placement here)
    this.visible = false;
    this.matrixWorld = new THREE.Matrix4();
    this.muzzle = new THREE.Vector3();
    this.support = new THREE.Vector3();
    this.wristR = new THREE.Vector3();
    this.stock = new THREE.Vector3();
    this.handGrip = new THREE.Matrix4();
    this.handGripInv = new THREE.Quaternion();
    this.ikW = 0; // last IK weight (debug)
  }

  /**
   * set(kind | null, { object, holster, muzzle, support, stock }) — kind is a GRIPS key
   * (unknown kinds map to 'pistol'); `object` (optional) is parented to chr.object.
   */
  set(kind, opts = {}) {
    if (this.object && this.object !== opts.object && !this.detached) this.object.removeFromParent();
    if (!kind) {
      this.kind = null;
      this.grip = null;
      this.object = null;
      this.visible = false;
      this._syncAnim();
      return this;
    }
    const k = GRIPS[kind] ? kind : this.isTool ? 'axe' : 'pistol';
    const g = GRIPS[k];
    this.kind = k;
    this.grip = g;
    this.holstered = !!opts.holster;
    this.muzzle.fromArray(opts.muzzle || g.muzzle);
    this.support.fromArray(opts.support || g.support);
    this.wristR.fromArray(g.wristR);
    this.stock.fromArray(opts.stock || g.stock || [0, 0, 0.1]);
    const h = g.hand;
    _e.set(h[3], h[4], h[5], 'XYZ');
    _q.setFromEuler(_e);
    this.handGrip.compose(_v.set(h[0], h[1], h[2]), _q, _one);
    this.handGripInv.copy(_q).invert();
    this.object = opts.object || null;
    if (this.object && !this.detached) {
      if (this.object.parent !== this.chr.object) this.chr.object.add(this.object);
      this.object.matrixAutoUpdate = true;
    }
    this.visible = true;
    this._syncAnim();
    return this;
  }

  setHolstered(h) {
    this.holstered = !!h;
    this._syncAnim();
  }

  /** Weapon grip / tool family for the animator's stances. */
  _syncAnim() {
    const a = this.chr.anim;
    if (this.isTool) a.tool = this.kind && !this.holstered ? this.kind : null;
    else a.grip = this.kind && !this.holstered && !this.forceHolster ? this.kind : 'none';
  }

  /** Re-attaches the object to the character after the FP view model released it. */
  reattach() {
    this.detached = false;
    if (this.object && this.object.parent !== this.chr.object) this.chr.object.add(this.object);
    if (this.object) this.object.matrixAutoUpdate = true;
  }

  /** World position of the muzzle (after update()). */
  muzzleWorld(out) {
    return out.copy(this.muzzle).applyMatrix4(this.matrixWorld);
  }

  /**
   * Places the weapon and (ik = true) solves the arms. Call right after anim.update().
   * Returns false when nothing is held.
   */
  update(ik = true) {
    if (!this.kind) return false;
    const chr = this.chr;
    const a = chr.anim;
    const bones = chr.bones;
    const g = this.grip;
    if (!this.isTool) {
      const want = this.holstered || this.forceHolster ? 'none' : this.kind;
      if (a.grip !== want) a.grip = want;
    }
    chr.object.updateMatrixWorld(true);
    // ---- holstered: rides on the back / thigh
    if (this.holstered || this.forceHolster) {
      const hs = HOLSTER[g.holster] || HOLSTER.back;
      const bone = bones[g.holster === 'thigh' ? J.thighR : J.chest];
      _m.compose(hs.p, hs.q, _one);
      this.matrixWorld.multiplyMatrices(bone.matrixWorld, _m);
      this._applyObject();
      this.ikW = 0;
      return true;
    }
    // ---- weights
    const dodgeE = a.dodgeT < a.dodgeDur ? 1 - sstep(0.85, 1, a.dodgeT / a.dodgeDur) : 0;
    const live = (1 - a.deadW) * (1 - dodgeE) * (a.spawnScale < 0.999 ? 0 : 1);
    if (g.tool) return this._updateTool(ik, live);
    const stanceW = (g.two ? 1 : a.aimW) * live;
    // ---- hand-space placement (relaxed pistol, rolls, death)
    _m.multiplyMatrices(bones[J.handR].matrixWorld, this.handGrip);
    _m.decompose(_pH, _qH, _s);
    if (stanceW > 0.001) {
      // ---- stance placement: character yaw (+ aim yaw/pitch)
      chr.object.matrixWorld.decompose(_p, _qC, _s);
      const aimW = a.aimW;
      const pitch = clamp(a.aimPitch, -1.25, 1.25);
      const yaw = clamp(a.aimYaw, -0.75, 0.75);
      // aim orientation
      _e.set(pitch + 0.07 * a.recoil * (g.two ? 1 : 1.6), yaw, 0, 'YXZ');
      _qA.setFromEuler(_e).premultiply(_qC);
      if (g.two) {
        // aim: stock butt in the shoulder pocket
        bones[J.armR].getWorldPosition(_S);
        _v.fromArray(g.shoulder).applyQuaternion(_qC);
        _T.copy(_S).add(_v); // stock position
        _v.copy(this.stock).applyQuaternion(_qA);
        _pA.copy(_T).sub(_v);
        // carry (low ready)
        const c = g.carry;
        bones[J.chest].getWorldPosition(_S);
        _v.set(c[0], c[1], c[2]).applyQuaternion(_qC);
        _T.copy(_S).add(_v);
        _e.set(c[4], c[3], 0, 'YXZ');
        _q.setFromEuler(_e).premultiply(_qC);
        _pA.lerp(_T, 1 - aimW);
        _qA.slerp(_q, 1 - aimW);
      } else {
        // one-handed weapons aim at arm's length, pivoting about the shoulder line
        bones[J.chest].getWorldPosition(_S);
        _v.set(0, 0.16, 0).applyQuaternion(_qC);
        _S.add(_v);
        _v.set(g.aimAt[0], g.aimAt[1] - 0.16, g.aimAt[2]).applyQuaternion(_qA);
        _pA.copy(_S).add(_v);
      }
      // recoil: kick back along the barrel
      if (a.recoil > 0) _pA.addScaledVector(_v.set(0, 0, 1).applyQuaternion(_qA), 0.04 * a.recoil);
      // reload: tilt the weapon toward the body
      const rl = a.reloadT < a.reloadDur ? a.reloadT / a.reloadDur : 1;
      if (rl < 1) {
        const e = sstep(0, 0.16, rl) * (1 - sstep(0.8, 1, rl));
        _e.set(-0.32 * e, 0.12 * e, 0.62 * e, 'XYZ');
        _q.setFromEuler(_e);
        _qA.multiply(_q);
        _pA.addScaledVector(_v.set(-0.05, -0.05, 0.06).applyQuaternion(_qC), e);
      }
      // blend with the hand placement
      if (stanceW < 0.999) {
        _pA.lerp(_pH, 1 - stanceW);
        _qA.slerp(_qH, 1 - stanceW);
      }
      this.matrixWorld.compose(_pA, _qA, _one);
    } else {
      this.matrixWorld.copy(_m);
    }
    this._applyObject();
    // ---- arms onto the weapon
    const ikW = ik ? stanceW : 0;
    this.ikW = ikW;
    if (ikW > 0.001) {
      // right wrist on the grip
      _T.copy(this.wristR).applyMatrix4(this.matrixWorld);
      solveArm(bones, 1, _T, _v.copy(POLE_R).applyQuaternion(_qC), ikW);
      // right hand aligned with the weapon
      this.matrixWorld.decompose(_p, _q, _s);
      _q.multiply(this.handGripInv);
      bones[J.foreR].updateWorldMatrix(false, false);
      bones[J.foreR].getWorldQuaternion(_q2);
      _q.premultiply(_q2.invert());
      bones[J.handR].quaternion.slerp(_q, ikW);
      // left wrist on the support point (reload: to the hip and back)
      _T.copy(this.support).applyMatrix4(this.matrixWorld);
      const rl = a.reloadT < a.reloadDur ? a.reloadT / a.reloadDur : 1;
      if (rl < 1) {
        // support → cell port → hip → port → support
        _E.set(0, -0.1, g.two ? -0.04 : 0.03).applyMatrix4(this.matrixWorld);
        _P.copy(HIP_L).applyMatrix4(chr.object.matrixWorld);
        const k1 = sstep(0.05, 0.25, rl) * (1 - sstep(0.62, 0.78, rl));
        const k2 = sstep(0.25, 0.42, rl) * (1 - sstep(0.46, 0.62, rl));
        _T.lerp(_E, k1);
        _T.lerp(_P, k2);
      }
      solveArm(bones, -1, _T, _v.copy(g.two ? POLE_L : POLE_L_PISTOL).applyQuaternion(_qC), ikW);
    }
    return true;
  }

  /**
   * Swing tools (axe / pick): the animated right hand carries the tool; the left hand joins on the
   * handle (support point) with the animator's two-hand weight, its fist wrapped like the right one.
   */
  _updateTool(ik, live) {
    const chr = this.chr;
    const a = chr.anim;
    const bones = chr.bones;
    // relaxed: the tool rides in the (animated) right hand
    _m.multiplyMatrices(bones[J.handR].matrixWorld, this.handGrip);
    const w = clamp(a.actW, 0, 1) * live;
    if (w > 0.001) {
      // working: the action's item frame (character space) — the arms are solved onto the tool
      _m2.compose(a.itemPos, a.itemQuat, _one);
      _m2.premultiply(chr.object.matrixWorld);
      _m2.decompose(_pA, _qA, _s);
      if (w < 0.999) {
        _m.decompose(_pH, _qH, _s);
        _pA.lerp(_pH, 1 - w);
        _qA.slerp(_qH, 1 - w);
      }
      this.matrixWorld.compose(_pA, _qA, _one);
    } else this.matrixWorld.copy(_m);
    this._applyObject();
    this.ikW = ik ? w : 0;
    if (!ik) return true;
    chr.object.matrixWorld.decompose(_p, _qC, _s);
    if (w > 0.001) {
      _T.copy(this.wristOffset()).applyMatrix4(this.matrixWorld);
      solveArm(bones, 1, _T, _v.copy(POLE_R).applyQuaternion(_qC), w);
      alignHand(bones, J.foreR, J.handR, this.matrixWorld, this.handGripInv, w);
    }
    const w2 = clamp(a.toolTwoW, 0, 1) * live;
    if (w2 > 0.001) {
      // left wrist = support grip + the same grip → wrist offset as the right hand (tool space)
      _T.copy(this.support).add(this.wristOffset()).applyMatrix4(this.matrixWorld);
      solveArm(bones, -1, _T, _v.copy(POLE_L).applyQuaternion(_qC), w2);
      alignHand(bones, J.foreL, J.handL, this.matrixWorld, this.handGripInv, w2);
    }
    return true;
  }

  /** Grip point → wrist (hand bone origin) in item space (cached per set()). */
  wristOffset() {
    if (!this._wo) this._wo = new THREE.Vector3();
    if (this._woKind !== this.kind) {
      this._woKind = this.kind;
      _M0.copy(this.handGrip).invert();
      this._wo.set(0, 0, 0).applyMatrix4(_M0);
    }
    return this._wo;
  }

  _applyObject() {
    const o = this.object;
    if (!o || this.detached) return;
    // character space = inverse(chr.object world) × weapon world
    _m2.copy(this.chr.object.matrixWorld).invert().multiply(this.matrixWorld);
    _m2.decompose(o.position, o.quaternion, _s);
    o.visible = this.visible;
  }
}

/** Rotates a hand bone so its fist matches an item frame (world matrix) via the grip → hand rotation. */
function alignHand(bones, foreIdx, handIdx, itemWorld, gripInv, w) {
  itemWorld.decompose(_p, _q, _s);
  _q.multiply(gripInv);
  bones[foreIdx].updateWorldMatrix(false, false);
  bones[foreIdx].getWorldQuaternion(_q2);
  _q.premultiply(_q2.invert());
  bones[handIdx].quaternion.slerp(_q, w);
}

// bare-hand gestures (gather / eat / use / build): a fist around the item frame like a tool handle
const GESTURE_GRIP = new THREE.Matrix4();
const GESTURE_INV = new THREE.Quaternion();
const GESTURE_WRIST = new THREE.Vector3();
{
  const h = GRIPS.axe.hand;
  _q.setFromEuler(new THREE.Euler(h[3], h[4], h[5], 'XYZ'));
  GESTURE_GRIP.compose(new THREE.Vector3(h[0], h[1], h[2]), _q, _one);
  GESTURE_INV.copy(_q).invert();
  GESTURE_WRIST.set(0, 0, 0).applyMatrix4(GESTURE_GRIP.clone().invert());
}

/**
 * Solves the right arm onto the animator's item frame for bare-hand actions (no tool rig holding
 * anything): weight = the action layer weight. `out` (Matrix4, optional) receives the item world matrix
 * (e.g. to place food in the hand). Returns the weight used.
 */
export function solveGesture(chr, ik = true, out = null) {
  const a = chr.anim;
  const w = clamp(a.actW, 0, 1) * (1 - a.deadW);
  if (w < 0.001) return 0;
  const bones = chr.bones;
  chr.object.updateMatrixWorld(true);
  _m2.compose(a.itemPos, a.itemQuat, _one).premultiply(chr.object.matrixWorld);
  if (out) out.copy(_m2);
  if (!ik) return w;
  chr.object.matrixWorld.decompose(_p, _qC, _s);
  _T.copy(GESTURE_WRIST).applyMatrix4(_m2);
  solveArm(bones, 1, _T, _v.copy(POLE_R).applyQuaternion(_qC), w);
  alignHand(bones, J.foreR, J.handR, _m2, GESTURE_INV, w);
  return w;
}

/**
 * Two-bone IK for one arm (side 1 = right, −1 = left) in world space: puts the wrist
 * (hand bone origin) at `target`, elbow toward `pole`; blends with weight w.
 * Analytic upper arm + elbow hinge, then a swing of the upper arm removes the small
 * residual of the hand offset lying off the hinge plane (≈ 3 cm otherwise).
 */
export function solveArm(bones, side, target, pole, w) {
  const clav = bones[side > 0 ? J.clavR : J.clavL];
  const arm = bones[side > 0 ? J.armR : J.armL];
  const fore = bones[side > 0 ? J.foreR : J.foreL];
  const hand = bones[side > 0 ? J.handR : J.handL];
  arm.updateWorldMatrix(true, false);
  _S.setFromMatrixPosition(arm.matrixWorld);
  const L1 = fore.position.length();
  const L2 = hand.position.length();
  _D.copy(target).sub(_S);
  let d = _D.length();
  if (d < 1e-5) return;
  _D.multiplyScalar(1 / d);
  d = clamp(d, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4);
  _qa0.copy(arm.quaternion);
  _qf0.copy(fore.quaternion);
  // bend plane from the pole
  _P.copy(pole).addScaledVector(_D, -pole.dot(_D));
  if (_P.lengthSq() < 1e-8) _P.set(0, -1, 0).addScaledVector(_D, _D.y);
  _P.normalize();
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _E.copy(_S).addScaledVector(_D, L1 * cosA).addScaledVector(_P, L1 * sinA);
  _u.copy(_E).sub(_S).normalize(); // upper arm direction
  _f.copy(_S).addScaledVector(_D, d).sub(_E).normalize(); // forearm direction
  // upper arm: rest frame (axis to the elbow, bend toward local −Z) → world frame
  _a0.copy(fore.position).normalize();
  _b0.set(0, 0, -1).addScaledVector(_a0, _a0.z).normalize();
  _c0.crossVectors(_a0, _b0);
  _b.copy(_f).addScaledVector(_u, -_f.dot(_u));
  if (_b.lengthSq() < 1e-8) _b.copy(_P).negate();
  _b.normalize();
  _c1.crossVectors(_u, _b);
  _M0.makeBasis(_a0, _b0, _c0);
  _M1.makeBasis(_u, _b, _c1);
  _M1.multiply(_M0.transpose());
  _q.setFromRotationMatrix(_M1); // arm world rotation
  clav.getWorldQuaternion(_qcl);
  _qcl.invert();
  arm.quaternion.copy(_q).premultiply(_qcl); // → local
  // forearm: elbow flexion about local X so the hand offset points along _f
  arm.updateWorldMatrix(false, false);
  arm.getWorldQuaternion(_q2);
  _v2.copy(_f).applyQuaternion(_q2.invert()); // forearm direction in the upper arm frame
  _v.copy(hand.position).normalize();
  const beta = Math.atan2(_v2.z, _v2.y) - Math.atan2(_v.z, _v.y);
  fore.quaternion.setFromAxisAngle(X, beta);
  // swing correction: rotate the upper arm so the actual wrist lies on the shoulder → target line
  fore.updateWorldMatrix(false, false);
  _E.copy(hand.position).applyMatrix4(fore.matrixWorld);
  _u.copy(_E).sub(_S).normalize();
  _q.setFromUnitVectors(_u, _D);
  arm.getWorldQuaternion(_q2);
  _q2.premultiply(_q).premultiply(_qcl);
  arm.quaternion.copy(_q2);
  if (w < 0.999) {
    arm.quaternion.slerpQuaternions(_qa0, _q2, w);
    _q.copy(fore.quaternion);
    fore.quaternion.slerpQuaternions(_qf0, _q, w);
  }
  arm.updateWorldMatrix(false, false);
  fore.updateWorldMatrix(false, false);
}

export { X as AXIS_X, Y as AXIS_Y, Z as AXIS_Z };
