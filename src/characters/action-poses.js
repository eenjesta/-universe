/**
 * Third-person action poses (characters module): keyframe tracks for the work /
 * survival one-shots. Each key: [t, ease, px, py, pz, rx, ry, rz, spX, spY, chX, chY, hdX, hdY, two, crouch]
 *   t           progress 0..1 (the action's impact sits at timing.impact / timing.dur)
 *   ease        shape of the segment ending at this key ('io' | 'in' strike | 'out' | 'lin')
 *   p / r       the ITEM frame in character space (x right, y up from the feet, −z forward):
 *               a held tool's grip (tool convention: handle +Y, striking face −Z), the food in
 *               hand (eat) or the virtual grip of the empty right hand (gather / use / build).
 *               r = Euler XYZ (radians). The arms are solved onto it with IK.
 *   sp / ch     spine / chest pitch (x, + = lean back) and twist (y, + = turn left), added to the pose
 *   hd          head pitch / yaw added (keeps the eyes on the target while the torso turns)
 *   two         left hand on the handle (0..1)
 *   crouch      hip drop (m) with matching knee bend
 * The first and last keys are the "ready" pose so chained swings flow into each other.
 */
const R = (x, y, z, rx, ry, rz) => [x, y, z, rx, ry, rz];

/** Ready pose holding a swing tool in front of the right hip. */
const AXE_READY = [...R(0.17, 1.0, -0.3, -0.62, 0.22, -0.1), 0, 0, 0, 0, 0, 0, 0, 0];
const PICK_READY = [...R(0.15, 0.98, -0.28, -0.5, 0.12, -0.1), 0, 0, 0, 0, 0, 0, 1, 0];

export const POSES = {
  chop: {
    tool: true,
    keys: [
      [0, 'io', ...AXE_READY],
      [0.4, 'out', ...R(0.3, 1.62, 0.02, 0.85, 0.4, 0.25), 0.1, -0.32, 0.04, -0.3, 0.02, 0.5, 0, 0.02],
      [0.5, 'in', ...R(0.02, 1.1, -0.5, -1.42, -0.28, 0.08), -0.24, 0.22, -0.16, 0.26, -0.06, -0.34, 0, 0.07],
      [0.62, 'out', ...R(0.05, 1.13, -0.46, -1.25, -0.22, 0.06), -0.18, 0.17, -0.12, 0.2, -0.05, -0.26, 0, 0.06],
      [1, 'io', ...AXE_READY],
    ],
  },
  mine: {
    tool: true,
    keys: [
      [0, 'io', ...PICK_READY],
      [0.42, 'out', ...R(0.12, 1.78, 0.06, 0.95, 0.06, 0.08), 0.14, -0.06, 0.06, -0.04, 0.06, 0.08, 1, 0],
      [0.52, 'in', ...R(0.03, 0.84, -0.5, -1.98, 0, 0.02), -0.44, 0.04, -0.22, 0.02, -0.14, -0.05, 1, 0.16],
      [0.64, 'out', ...R(0.05, 0.88, -0.48, -1.84, 0, 0.02), -0.38, 0.03, -0.18, 0.02, -0.12, -0.04, 1, 0.14],
      [1, 'io', ...PICK_READY],
    ],
  },
  // mining laser: raised to the shoulder and held on the target while the beam runs (stance + IK, no swing)
  'mine-laser': {
    tool: true,
    laser: true,
    keys: [
      [0, 'io', ...R(0.16, 1.05, -0.3, -0.3, 0.1, 0), 0, 0, 0, 0, 0, 0, 0, 0],
      [0.16, 'out', ...R(0.08, 1.34, -0.46, 0, 0.04, 0), -0.04, 0.06, -0.02, 0.08, 0, -0.1, 1, 0],
      [0.85, 'lin', ...R(0.08, 1.33, -0.47, 0.02, 0.04, 0), -0.04, 0.06, -0.02, 0.08, 0, -0.1, 1, 0],
      [1, 'io', ...R(0.16, 1.05, -0.3, -0.3, 0.1, 0), 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  gather: {
    keys: [
      [0, 'io', ...R(0.22, 0.95, -0.12, -0.3, 0, 0), 0, 0, 0, 0, 0, 0, 0, 0],
      [0.47, 'out', ...R(0.1, 0.36, -0.5, -1.2, 0.2, 0.3), -0.46, 0.12, -0.24, 0.08, -0.3, -0.1, 0, 0.34],
      [0.62, 'io', ...R(0.12, 0.42, -0.46, -1.0, 0.2, 0.3), -0.42, 0.1, -0.22, 0.08, -0.26, -0.1, 0, 0.32],
      [1, 'io', ...R(0.22, 0.95, -0.12, -0.3, 0, 0), 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  eat: {
    food: true,
    keys: [
      [0, 'io', ...R(0.2, 0.98, -0.15, -0.4, 0, 0), 0, 0, 0, 0, 0, 0, 0, 0],
      [0.4, 'out', ...R(0.05, 1.52, -0.17, 0.35, 0.6, 0.2), 0.02, 0.06, 0.02, 0.06, -0.1, 0, 0, 0],
      [0.52, 'io', ...R(0.03, 1.56, -0.13, 0.45, 0.65, 0.2), 0.02, 0.06, 0.02, 0.06, -0.14, 0, 0, 0],
      [0.72, 'io', ...R(0.05, 1.53, -0.16, 0.38, 0.6, 0.2), 0.02, 0.05, 0.02, 0.05, -0.1, 0, 0, 0],
      [1, 'io', ...R(0.2, 0.98, -0.15, -0.4, 0, 0), 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  use: {
    keys: [
      [0, 'io', ...R(0.2, 1.0, -0.18, -0.4, 0, 0), 0, 0, 0, 0, 0, 0, 0, 0],
      [0.47, 'out', ...R(0.1, 1.28, -0.52, -1.35, 0, 0.2), -0.08, 0.1, -0.04, 0.08, -0.04, -0.06, 0, 0],
      [0.62, 'io', ...R(0.1, 1.28, -0.5, -1.3, 0, 0.2), -0.07, 0.1, -0.04, 0.08, -0.04, -0.06, 0, 0],
      [1, 'io', ...R(0.2, 1.0, -0.18, -0.4, 0, 0), 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  build: {
    keys: [
      [0, 'io', ...R(0.2, 1.05, -0.2, -0.5, 0, 0), 0, 0, 0, 0, 0, 0, 0, 0],
      [0.4, 'out', ...R(0.12, 1.36, -0.5, -1.5, 0, 0.3), -0.06, 0.12, -0.03, 0.1, 0.04, -0.08, 0, 0],
      [0.6, 'io', ...R(0.12, 1.34, -0.48, -1.45, 0, 0.3), -0.05, 0.12, -0.03, 0.1, 0.04, -0.08, 0, 0],
      [1, 'io', ...R(0.2, 1.05, -0.2, -0.5, 0, 0), 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
};
/** Values per key after [t, ease]. */
export const POSE_WIDTH = 14;

/** Track for an action + tool family (the mining laser has its own). */
export function poseFor(action, toolFamily) {
  if (action === 'mine' && toolFamily === 'laser') return POSES['mine-laser'];
  return POSES[action] || null;
}
