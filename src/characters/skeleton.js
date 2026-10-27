/**
 * Joint hierarchy + proportions (characters module).
 *
 * Rest pose: standing at the origin, feet on y = 0, facing −Z, arms hanging
 * slightly outward, every bone with identity rotation (so animation rotations
 * are plain local Euler angles). The character's right side is +X.
 * Bind pose (the pose the mesh is modelled in): the rest pose with both arms
 * abducted by A_POSE about the shoulder joints (an "A-pose"), which keeps the
 * sculpted sleeves clear of the torso and spreads skinning distortion evenly
 * between arms-down and arms-up poses. frame.bindInverse feeds the skeleton;
 * frame.restToBind maps rest-pose geometry into the bind pose.
 * Rotation conventions used by the animator:
 *   thigh/arm  +X = swing forward      shin −X = knee bend   fore +X = elbow bend
 *   spine/head +X = lean back / look up (so forward lean is −X)
 *   armR +Z / armL −Z = raise sideways
 */
import * as THREE from 'three';
import { EYE } from './sculpt.js';

/** Arm abduction of the bind pose (radians). */
export const A_POSE = 0.56;

export const J = {
  root: 0, hips: 1, spine: 2, chest: 3, neck: 4, head: 5,
  clavL: 6, armL: 7, foreL: 8, handL: 9,
  clavR: 10, armR: 11, foreR: 12, handR: 13,
  thighL: 14, shinL: 15, footL: 16,
  thighR: 17, shinR: 18, footR: 19,
  lids: 20, pony1: 21, pony2: 22,
};
export const BONE_COUNT = 23;
export const PARENT = [
  -1, 0, 1, 2, 3, 4,
  3, 6, 7, 8,
  3, 10, 11, 12,
  1, 14, 15,
  1, 17, 18,
  5, 5, 21,
];
export const BONE_NAMES = Object.keys(J);

/**
 * Proportions for an appearance. All values in metres (bind pose, absolute).
 * Returns { s, f, joints: Vector3[BONE_COUNT], ...measurements }.
 */
export function bodyFrame(app) {
  const f = app.body === 'f';
  const s = (f ? 0.935 : 1) * (app.height ?? 1);
  const g = app.build ?? 1; // girth
  const shX = (f ? 0.163 : 0.186) * s * (0.94 + 0.06 * g);
  const hipX = (f ? 0.098 : 0.094) * s * (0.95 + 0.05 * g);
  const y = (v) => v * s;
  const fr = {
    s,
    f,
    g,
    hipY: y(0.965),
    kneeY: y(0.515),
    ankleY: y(0.085),
    hipX,
    shX,
    shY: y(1.448),
    elbowY: y(1.155),
    wristY: y(0.9),
    neckY: y(1.505),
    headY: y(1.6),
    headC: new THREE.Vector3(0, y(1.688), -0.006 * s), // eye line, ear plane
    headScale: (f ? 0.955 : 1) * 1.1 * (0.97 + 0.03 * s),
  };
  const J3 = (x, yy, z) => new THREE.Vector3(x, yy, z);
  const armOut = 0.028 * s; // arms hang slightly outward
  const joints = [];
  joints[J.root] = J3(0, 0, 0);
  joints[J.hips] = J3(0, fr.hipY + 0.01 * s, 0);
  joints[J.spine] = J3(0, y(1.1), 0.008 * s);
  joints[J.chest] = J3(0, y(1.29), 0.0);
  joints[J.neck] = J3(0, fr.neckY, 0.004 * s);
  joints[J.head] = J3(0, fr.headY, 0.0);
  joints[J.clavL] = J3(-0.035 * s, y(1.43), 0.0);
  joints[J.armL] = J3(-shX, fr.shY, 0.008 * s);
  joints[J.foreL] = J3(-shX - armOut, fr.elbowY, 0.018 * s);
  joints[J.handL] = J3(-shX - armOut * 1.6, fr.wristY, 0.006 * s);
  joints[J.clavR] = J3(0.035 * s, y(1.43), 0.0);
  joints[J.armR] = J3(shX, fr.shY, 0.008 * s);
  joints[J.foreR] = J3(shX + armOut, fr.elbowY, 0.018 * s);
  joints[J.handR] = J3(shX + armOut * 1.6, fr.wristY, 0.006 * s);
  joints[J.thighL] = J3(-hipX, fr.hipY, 0.0);
  joints[J.shinL] = J3(-hipX - 0.004 * s, fr.kneeY, -0.006 * s);
  joints[J.footL] = J3(-hipX - 0.008 * s, fr.ankleY, 0.012 * s);
  joints[J.thighR] = J3(hipX, fr.hipY, 0.0);
  joints[J.shinR] = J3(hipX + 0.004 * s, fr.kneeY, -0.006 * s);
  joints[J.footR] = J3(hipX + 0.008 * s, fr.ankleY, 0.012 * s);
  const hc = fr.headC;
  const hs = fr.headScale;
  joints[J.lids] = J3(0, hc.y + EYE.y * hs, hc.z + EYE.z * hs);
  joints[J.pony1] = J3(0, hc.y + 0.034 * hs, hc.z + 0.117 * hs);
  joints[J.pony2] = J3(0, hc.y - 0.09 * hs, hc.z + 0.15 * hs);
  fr.joints = joints;
  bindPose(fr);
  return fr;
}

const ARM_L = [J.armL, J.foreL, J.handL];
const ARM_R = [J.armR, J.foreR, J.handR];

/**
 * Bind (A-pose) data on a frame: bindWorld[i] (Matrix4), bindInverse[i],
 * restToBind[i] (identity except for the arm chains: a rotation about the
 * shoulder), bindJoints[i] (Vector3) and toBind(side, v) for points.
 */
function bindPose(fr) {
  const n = BONE_COUNT;
  fr.aPose = A_POSE;
  fr.bindWorld = [];
  fr.bindInverse = [];
  fr.restToBind = [];
  fr.bindJoints = [];
  fr.bindRot = new Uint8Array(n); // 1 = bone has a non-identity restToBind
  const shL = fr.joints[J.armL];
  const shR = fr.joints[J.armR];
  // rotation about +Z at the shoulder: right arm +A, left arm −A (hand moves outward)
  const about = (sh, ang) => {
    const m = new THREE.Matrix4().makeTranslation(sh.x, sh.y, sh.z);
    m.multiply(new THREE.Matrix4().makeRotationZ(ang));
    m.multiply(new THREE.Matrix4().makeTranslation(-sh.x, -sh.y, -sh.z));
    return m;
  };
  const rL = about(shL, -A_POSE);
  const rR = about(shR, A_POSE);
  const rotL = new THREE.Matrix4().makeRotationZ(-A_POSE);
  const rotR = new THREE.Matrix4().makeRotationZ(A_POSE);
  for (let i = 0; i < n; i++) {
    const j = fr.joints[i];
    let r2b = null;
    let rot = null;
    if (ARM_L.includes(i)) {
      r2b = rL;
      rot = rotL;
    } else if (ARM_R.includes(i)) {
      r2b = rR;
      rot = rotR;
    }
    const restToBind = r2b ? r2b.clone() : new THREE.Matrix4();
    const bj = j.clone().applyMatrix4(restToBind);
    const bw = new THREE.Matrix4().makeTranslation(bj.x, bj.y, bj.z);
    if (rot) bw.multiply(rot);
    fr.restToBind.push(restToBind);
    fr.bindJoints.push(bj);
    fr.bindWorld.push(bw);
    fr.bindInverse.push(bw.clone().invert());
    fr.bindRot[i] = r2b ? 1 : 0;
  }
  const cL = Math.cos(-A_POSE);
  const sL = Math.sin(-A_POSE);
  const cR = Math.cos(A_POSE);
  const sR = Math.sin(A_POSE);
  /** Rest-pose point → bind pose for an arm side (−1 left, +1 right); writes into `out`. */
  fr.toBind = (side, v, out = new THREE.Vector3()) => {
    const sh = side < 0 ? shL : shR;
    const c = side < 0 ? cL : cR;
    const s = side < 0 ? sL : sR;
    const x = v.x - sh.x;
    const y = v.y - sh.y;
    return out.set(sh.x + x * c - y * s, sh.y + x * s + y * c, v.z);
  };
}

/**
 * Creates the bone objects for one character. Returns { root, bones[] } where
 * bones[i].position is the local offset from its parent (bind pose).
 */
export function createBones(frame, name = 'chr') {
  const bones = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const b = new THREE.Bone();
    b.name = `${name}-${BONE_NAMES[i]}`;
    bones.push(b);
  }
  for (let i = 0; i < BONE_COUNT; i++) {
    const p = PARENT[i];
    const jp = frame.joints[i];
    if (p < 0) bones[i].position.copy(jp);
    else {
      bones[i].position.copy(jp).sub(frame.joints[p]);
      bones[p].add(bones[i]);
    }
  }
  return { root: bones[0], bones };
}

/** Bind offsets (local positions) for re-applying a frame to existing bones. */
export function applyFrame(bones, frame) {
  for (let i = 0; i < BONE_COUNT; i++) {
    const p = PARENT[i];
    if (p < 0) continue; // root keeps its world placement
    bones[i].position.copy(frame.joints[i]).sub(frame.joints[p]);
  }
}
