/**
 * Procedural weapon models (sleek black sci-fi, light grey panels, blue energy
 * cells, orange status lights — concept art 24/26): pulse pistol, plasma rifle,
 * railgun (with a charge glow) and the shock grenade.
 *
 *   const w = createWeaponModel('plasma-rifle')
 *   w.group                 THREE.Group, origin = the grip (hand), front = −Z
 *   w.group.userData.muzzle Object3D at the muzzle
 *   w.setCharge(0..1)       railgun coils / cell glow
 *   w.pulse(k)              brief brighten after a shot
 *   w.update(dt)            decays the pulse
 *   w.dispose()
 * Plus weaponIcon(id) → inline SVG silhouette for the HUD (muzzle to the left).
 */
import * as THREE from 'three';
import { box, rbox, cyl, sphere, torus, merge, ALONG_Z } from './geo.js';

const MATS = {};
function mats() {
  if (MATS.body) return MATS;
  MATS.body = new THREE.MeshStandardMaterial({ name: 'cbt-gun-body', color: 0x15171c, metalness: 0.62, roughness: 0.34 });
  MATS.panel = new THREE.MeshStandardMaterial({ name: 'cbt-gun-panel', color: 0x9da3ab, metalness: 0.4, roughness: 0.42 });
  MATS.accent = new THREE.MeshStandardMaterial({ name: 'cbt-gun-accent', color: 0x061220, emissive: 0x3d9dff, emissiveIntensity: 2.6, metalness: 0.2, roughness: 0.3 });
  MATS.accent2 = new THREE.MeshStandardMaterial({ name: 'cbt-gun-accent2', color: 0x1a0c04, emissive: 0xff7a2a, emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.4 });
  return MATS;
}

const side = (fn) => [fn(1), fn(-1)];

function pistol() {
  return {
    body: [
      rbox(0.036, 0.05, 0.2, 0.008, { p: [0, 0.04, -0.06] }),
      cyl(0.014, 0.016, 0.04, 12, { p: [0, 0.048, -0.175], r: ALONG_Z }),
      rbox(0.032, 0.1, 0.042, 0.008, { p: [0, -0.038, 0.012], r: [-0.3, 0, 0] }),
      box(0.01, 0.01, 0.045, { p: [0, -0.007, -0.03] }),
      box(0.008, 0.026, 0.008, { p: [0, 0.005, -0.052] }),
    ],
    panel: [rbox(0.038, 0.024, 0.17, 0.006, { p: [0, 0.07, -0.065] }), ...side((s) => box(0.003, 0.03, 0.04, { p: [s * 0.0185, 0.045, 0.01] }))],
    accent: [
      ...side((s) => box(0.004, 0.014, 0.085, { p: [s * 0.0185, 0.032, -0.085] })),
      torus(0.0165, 0.0032, 6, 16, { p: [0, 0.048, -0.197] }),
      cyl(0.008, 0.008, 0.012, 10, { p: [0, 0.06, 0.042], r: ALONG_Z }),
    ],
    accent2: [box(0.004, 0.006, 0.012, { p: [0.0185, 0.058, 0.0] })],
    charge: [],
    muzzle: [0, 0.048, -0.205],
  };
}

function rifle() {
  return {
    body: [
      rbox(0.074, 0.098, 0.44, 0.012, { p: [0, 0.055, -0.12] }),
      rbox(0.062, 0.07, 0.2, 0.01, { p: [0, 0.058, -0.42] }),
      cyl(0.024, 0.027, 0.09, 14, { p: [0, 0.06, -0.56], r: ALONG_Z }),
      rbox(0.034, 0.112, 0.046, 0.008, { p: [0, -0.045, 0.015], r: [-0.28, 0, 0] }),
      box(0.012, 0.012, 0.06, { p: [0, -0.012, -0.045] }),
      rbox(0.03, 0.075, 0.036, 0.008, { p: [0, -0.022, -0.33], r: [-0.12, 0, 0] }),
      rbox(0.05, 0.075, 0.2, 0.01, { p: [0, 0.045, 0.2] }),
      rbox(0.056, 0.118, 0.035, 0.008, { p: [0, 0.03, 0.31] }),
      box(0.022, 0.012, 0.3, { p: [0, 0.109, -0.12] }),
      cyl(0.019, 0.019, 0.13, 16, { p: [0, 0.142, -0.08], r: ALONG_Z }),
      box(0.012, 0.024, 0.016, { p: [0, 0.122, -0.04] }),
      box(0.012, 0.024, 0.016, { p: [0, 0.122, -0.12] }),
      rbox(0.02, 0.06, 0.05, 0.006, { p: [0, -0.005, -0.12] }), // cell housing under the receiver
    ],
    panel: [
      ...side((s) => rbox(0.006, 0.05, 0.2, 0.002, { p: [s * 0.039, 0.032, -0.02] })),
      rbox(0.066, 0.016, 0.16, 0.005, { p: [0, 0.1, -0.27] }),
      rbox(0.052, 0.012, 0.15, 0.004, { p: [0, 0.084, 0.2] }),
      ...side((s) => rbox(0.005, 0.04, 0.12, 0.002, { p: [s * 0.032, 0.05, -0.43] })),
    ],
    accent: [
      ...side((s) => box(0.004, 0.022, 0.13, { p: [s * 0.0385, 0.075, -0.24] })),
      cyl(0.026, 0.026, 0.004, 16, { p: [0, 0.06, -0.152], r: ALONG_Z }),
      torus(0.0275, 0.0042, 6, 20, { p: [0, 0.06, -0.607] }),
      cyl(0.016, 0.016, 0.004, 14, { p: [0, 0.142, -0.147], r: ALONG_Z }),
      ...side((s) => box(0.003, 0.012, 0.035, { p: [s * 0.0315, 0.05, -0.47] })),
    ],
    accent2: [box(0.004, 0.008, 0.02, { p: [0.039, 0.09, 0.05] }), box(0.004, 0.008, 0.012, { p: [0.039, 0.09, 0.075] })],
    charge: [],
    muzzle: [0, 0.06, -0.62],
  };
}

function railgun() {
  const coils = [-0.32, -0.47, -0.62, -0.77];
  return {
    body: [
      rbox(0.07, 0.095, 0.46, 0.012, { p: [0, 0.05, -0.02] }),
      ...side((s) => box(0.016, 0.03, 0.62, { p: [s * 0.024, 0.062, -0.53] })),
      box(0.05, 0.014, 0.62, { p: [0, 0.026, -0.53] }),
      rbox(0.034, 0.112, 0.046, 0.008, { p: [0, -0.045, 0.015], r: [-0.28, 0, 0] }),
      box(0.012, 0.012, 0.06, { p: [0, -0.012, -0.045] }),
      rbox(0.05, 0.08, 0.24, 0.01, { p: [0, 0.045, 0.32] }),
      rbox(0.056, 0.12, 0.035, 0.008, { p: [0, 0.03, 0.45] }),
      cyl(0.022, 0.022, 0.22, 16, { p: [0, 0.152, -0.05], r: ALONG_Z }),
      cyl(0.026, 0.022, 0.03, 16, { p: [0, 0.152, -0.17], r: ALONG_Z }),
      box(0.012, 0.03, 0.016, { p: [0, 0.112, 0.02] }),
      box(0.012, 0.03, 0.016, { p: [0, 0.112, -0.1] }),
      rbox(0.03, 0.06, 0.05, 0.008, { p: [0, 0.005, -0.2], r: [-0.1, 0, 0] }),
    ],
    panel: [
      ...coils.map((z) => rbox(0.078, 0.072, 0.03, 0.008, { p: [0, 0.052, z] })),
      ...side((s) => rbox(0.006, 0.05, 0.26, 0.002, { p: [s * 0.0365, 0.04, -0.02] })),
      rbox(0.052, 0.012, 0.18, 0.004, { p: [0, 0.084, 0.32] }),
    ],
    accent: [
      cyl(0.019, 0.019, 0.004, 14, { p: [0, 0.152, -0.187], r: ALONG_Z }),
      ...side((s) => box(0.004, 0.016, 0.16, { p: [s * 0.0365, 0.076, -0.1] })),
    ],
    accent2: [...side((s) => box(0.004, 0.008, 0.05, { p: [s * 0.0365, 0.02, 0.12] })), box(0.004, 0.008, 0.016, { p: [0.0365, 0.09, 0.15] })],
    charge: [box(0.012, 0.012, 0.6, { p: [0, 0.062, -0.53] }), ...coils.map((z) => torus(0.031, 0.0045, 6, 18, { p: [0, 0.052, z - 0.017] }))],
    muzzle: [0, 0.062, -0.85],
  };
}

function grenade() {
  return {
    body: [
      sphere(0.052, 18, 14),
      cyl(0.022, 0.027, 0.022, 14, { p: [0, 0.056, 0] }),
      box(0.012, 0.012, 0.05, { p: [0, 0.07, 0.012] }),
    ],
    panel: [torus(0.053, 0.0075, 6, 28, { r: [Math.PI / 2, 0, 0] })],
    accent: [
      torus(0.0525, 0.0032, 6, 28, { p: [0, 0.019, 0], r: [Math.PI / 2, 0, 0], s: [0.965, 0.965, 1] }),
      torus(0.0525, 0.0032, 6, 28, { p: [0, -0.019, 0], r: [Math.PI / 2, 0, 0], s: [0.965, 0.965, 1] }),
      cyl(0.017, 0.017, 0.004, 14, { p: [0, 0, -0.052], r: ALONG_Z }),
    ],
    accent2: [box(0.006, 0.006, 0.006, { p: [0, 0.068, 0] })],
    charge: [],
    muzzle: [0, 0, 0],
  };
}

/**
 * How the avatars' WeaponRig should hold each model (ctx.player.holdWeapon(mesh, HOLD[id])):
 * grip preset + this model's muzzle, left wrist (support) and stock butt in weapon space.
 */
export const HOLD = {
  'pulse-pistol': { grip: 'pistol', muzzle: [0, 0.048, -0.205] },
  'plasma-rifle': { grip: 'rifle', muzzle: [0, 0.06, -0.62], support: [-0.03, -0.075, -0.31], stock: [0, 0.03, 0.33] },
  railgun: { grip: 'heavy', muzzle: [0, 0.062, -0.85], support: [-0.032, -0.07, -0.2], stock: [0, 0.03, 0.465] },
  'shock-grenade': { grip: 'pistol', muzzle: [0, 0, 0] },
};

const BUILDERS = { 'pulse-pistol': pistol, 'plasma-rifle': rifle, railgun, 'shock-grenade': grenade };
const GEO_CACHE = new Map();

/** Merged geometries per material for a weapon id (cached, shared). */
export function weaponGeometries(id) {
  if (GEO_CACHE.has(id)) return GEO_CACHE.get(id);
  const b = (BUILDERS[id] || rifle)();
  const out = { muzzle: b.muzzle };
  for (const k of ['body', 'panel', 'accent', 'accent2', 'charge']) out[k] = b[k].length ? merge(b[k]) : null;
  GEO_CACHE.set(id, out);
  return out;
}

export function createWeaponModel(id) {
  const M = mats();
  const geo = weaponGeometries(id);
  const group = new THREE.Group();
  group.name = `cbt-weapon-${id}`;
  // own accent material per instance so firing pulses / charge glows don't leak to other models
  const accent = M.accent.clone();
  const chargeMat = M.accent.clone();
  chargeMat.emissiveIntensity = 0.6;
  const parts = [
    [geo.body, M.body],
    [geo.panel, M.panel],
    [geo.accent, accent],
    [geo.accent2, M.accent2],
    [geo.charge, chargeMat],
  ];
  for (const [g, m] of parts) {
    if (!g) continue;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.fromArray(geo.muzzle);
  group.add(muzzle);
  group.userData.muzzle = muzzle;
  group.userData.kind = id;
  group.userData.grip = (HOLD[id] || HOLD['plasma-rifle']).grip;
  let pulse = 0;
  let charge = 0;
  const base = accent.emissiveIntensity;
  const cBase = new THREE.Color(0x3d9dff);
  const cHot = new THREE.Color(0xd8f0ff);
  const apply = () => {
    accent.emissiveIntensity = base * (1 + pulse * 1.6 + charge * 0.8);
    chargeMat.emissiveIntensity = 0.6 + charge * 5.5 + pulse * 3;
    chargeMat.emissive.copy(cBase).lerp(cHot, Math.min(1, charge * 0.85 + pulse * 0.5));
  };
  apply();
  return {
    id,
    group,
    muzzle,
    setCharge(v) {
      const nv = Math.max(0, Math.min(1, v || 0));
      if (Math.abs(nv - charge) < 0.002) return;
      charge = nv;
      apply();
    },
    pulse(k = 1) {
      pulse = Math.max(pulse, k);
      apply();
    },
    update(dt) {
      if (pulse > 0) {
        pulse = Math.max(0, pulse - dt * 7);
        apply();
      }
    },
    dispose() {
      accent.dispose();
      chargeMat.dispose();
      group.removeFromParent();
    },
  };
}

/** HUD silhouettes (viewBox 0 0 120 40, muzzle left); `.cbt-ic-acc` parts glow cyan. */
const ICONS = {
  'pulse-pistol':
    '<path d="M24 14h8v5h-8z"/><path d="M31 11.5h50v12H31z"/><path d="M33 9h47v4H33z" opacity=".75"/><path d="M62 23h12l6 14H69z"/><path d="M52 23h10v2.5c0 3-2.2 5-5 5h-3z" opacity=".7"/><path class="cbt-ic-acc" d="M38 16h22v3H38z"/>',
  'plasma-rifle':
    '<path d="M3 15.5h19v4.5H3z"/><path d="M20 12h23v10H20z"/><path d="M41 10h46v14H41z"/><path d="M52 4.5h22v5H52z"/><path d="M56 8h3v3h-3zM68 8h3v3h-3z"/><path d="M71 24h8l4 13h-8z"/><path d="M33 22h7l-1 9h-5z"/><path d="M87 12h22v10H87z"/><path d="M107 9h6v20h-6z"/><path class="cbt-ic-acc" d="M47 15h17v4H47z"/><path class="cbt-ic-acc" d="M1 15h2.5v5H1z"/>',
  railgun:
    '<path d="M2 11.5h58v3.5H2zM2 19h58v3.5H2z"/><path d="M12 9h5v16h-5zM25 9h5v16h-5zM38 9h5v16h-5zM51 9h5v16h-5z" opacity=".8"/><path d="M58 9h36v15H58z"/><path d="M61 2.5h28v5H61z"/><path d="M83 24h8l4 13h-8z"/><path d="M94 11h18v10H94z"/><path d="M110 8.5h6v19h-6z"/><path class="cbt-ic-acc" d="M4 16h54v2H4z"/>',
  'shock-grenade':
    '<circle cx="60" cy="21" r="12"/><path d="M55 6.5h10v4H55z"/><path d="M64 7h9v2.5h-9z" opacity=".7"/><path class="cbt-ic-acc" d="M48.5 17.5h23v2h-23zM48.5 22.5h23v2h-23z"/>',
};

export function weaponIcon(id, cls = '') {
  const body = ICONS[id] || ICONS['plasma-rifle'];
  return `<svg class="cbt-wicon ${cls}" viewBox="0 0 120 40" fill="currentColor" aria-hidden="true">${body}</svg>`;
}
