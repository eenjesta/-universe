/**
 * Ø Studio — starter templates and ready-made models (pure data, no DOM/three).
 *
 *   createExperience('baseplate' | 'obby' | 'empty', { title }) → experience JSON (normalised)
 *   MODELS: [{ id, name: {en, nl}, icon, parts: [partSpec…] }] — part specs are relative to the
 *   model origin (bottom centre at y = 0); the editor offsets them, gives them new ids and groups them.
 */
import { FORMAT, VERSION, validate } from './format.js';

const P = (type, p, s, color, material = 'plastic', extra = {}) => ({ type, p, s, color, material, ...extra });

const LIB_NAMES = {
  stairs: { en: 'Stairs', nl: 'Trap' },
  bridge: { en: 'Bridge', nl: 'Brug' },
  tree: { en: 'Tree', nl: 'Boom' },
  lamp: { en: 'Lamp post', nl: 'Lantaarn' },
  gate: { en: 'Checkpoint gate', nl: 'Checkpointpoort' },
  pads: { en: 'Jump pads', nl: 'Springkussens' },
  tower: { en: 'Tower', nl: 'Toren' },
};

function stairs() {
  const out = [];
  for (let i = 0; i < 8; i++) out.push(P('block', [0, 0.25 + i * 0.5, -i], [3, 0.5, 1], i % 2 ? '#d9d2c4' : '#a9a49b', 'concrete', { name: `Step ${i + 1}` }));
  return out;
}

function bridge() {
  const out = [P('block', [0, 0.15, 0], [3, 0.3, 12], '#b88a5c', 'wood', { name: 'Deck' })];
  for (const x of [-1.4, 1.4]) {
    out.push(P('block', [x, 1.05, 0], [0.12, 0.12, 12], '#23262c', 'metal', { name: 'Rail' }));
    for (let z = -5.5; z <= 5.5; z += 2.75) out.push(P('cylinder', [x, 0.6, z], [0.14, 0.9, 0.14], '#23262c', 'metal', { name: 'Post' }));
  }
  return out;
}

function tree() {
  return [
    P('cylinder', [0, 1.6, 0], [0.7, 3.2, 0.7], '#6a4a32', 'wood', { name: 'Trunk' }),
    P('sphere', [0, 4.2, 0], [3.8, 3.2, 3.8], '#3f6a2a', 'grass', { name: 'Leaves' }),
    P('sphere', [0.8, 5.3, 0.4], [2.4, 2.2, 2.4], '#4caf6e', 'grass', { name: 'Leaves' }),
  ];
}

function lamp() {
  return [
    P('cylinder', [0, 0.15, 0], [0.9, 0.3, 0.9], '#23262c', 'metal', { name: 'Base' }),
    P('cylinder', [0, 2.6, 0], [0.22, 4.8, 0.22], '#3a3f47', 'metal', { name: 'Pole' }),
    P('cone', [0, 5.15, 0], [0.9, 0.5, 0.9], '#23262c', 'metal', { name: 'Hood' }),
    P('light', [0, 4.75, 0], [0.45, 0.45, 0.45], '#ffd29a', 'neon', { name: 'Light', collide: false, props: { brightness: 5, range: 20 } }),
  ];
}

function gate() {
  return [
    P('block', [-3, 2.5, 0], [0.8, 5, 0.8], '#23262c', 'metal', { name: 'Pillar' }),
    P('block', [3, 2.5, 0], [0.8, 5, 0.8], '#23262c', 'metal', { name: 'Pillar' }),
    P('block', [0, 5.2, 0], [7, 0.4, 0.8], '#7fe0ff', 'neon', { name: 'Beam' }),
    P('spawn', [0, 0.2, 0], [5, 0.4, 4], '#3a3f47', 'metal', { name: 'Checkpoint', props: { checkpoint: true } }),
  ];
}

function pads() {
  return [0, 1, 2].map((i) => P('cylinder', [0, 0.15, -i * 7], [2.6, 0.3, 2.6], '#8fe3a8', 'neon', { name: 'Jump pad', props: { behavior: 'bounce', bounce: 16 } }));
}

function tower() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI) / 2.5;
    out.push(P('block', [Math.cos(a) * 3, 0.5 + i * 1.6, Math.sin(a) * 3], [2.4, 0.5, 2.4], i === 4 ? '#f0b46a' : '#6f7279', i === 4 ? 'neon' : 'plastic', { name: `Platform ${i + 1}` }));
  }
  out.push(P('cylinder', [0, 4, 0], [1.4, 8, 1.4], '#3a3f47', 'concrete', { name: 'Core' }));
  return out;
}

export const MODELS = [
  { id: 'stairs', icon: 'studio-stairs', name: LIB_NAMES.stairs, make: stairs },
  { id: 'bridge', icon: 'studio-bridge', name: LIB_NAMES.bridge, make: bridge },
  { id: 'tree', icon: 'tree', name: LIB_NAMES.tree, make: tree },
  { id: 'lamp', icon: 'studio-lamp', name: LIB_NAMES.lamp, make: lamp },
  { id: 'gate', icon: 'studio-gate', name: LIB_NAMES.gate, make: gate },
  { id: 'pads', icon: 'studio-pad', name: LIB_NAMES.pads, make: pads },
  { id: 'tower', icon: 'studio-tower', name: LIB_NAMES.tower, make: tower },
];

/** The starter obby: spawn → jumps → ramp → laser bridge → checkpoint → jump pad → finish. */
function obbyParts() {
  const cyan = '#7fe0ff';
  return [
    P('spawn', [0, 0.2, 0], [6, 0.4, 6], '#3a3f47', 'metal', { id: 'spawn', name: 'Spawn' }),
    P('block', [0, 0.5, -6.5], [4, 1, 3], '#f4f1ea', 'plastic', { name: 'Step 1' }),
    P('block', [2.5, 1.25, -11], [3, 0.5, 3], '#3fb8e8', 'plastic', { name: 'Step 2' }),
    P('block', [-1, 2, -15.5], [3, 0.5, 3], '#b48cff', 'plastic', { name: 'Step 3' }),
    P('wedge', [-1, 3.25, -20], [4, 2, 6], '#d9d2c4', 'concrete', { name: 'Ramp', r: [0, 180, 0] }),
    P('block', [-1, 3.75, -25], [4, 1, 4], '#f4f1ea', 'plastic', { name: 'Landing' }),
    P('block', [-1, 3.95, -32], [2, 0.6, 10], '#6f7279', 'metal', { name: 'Laser bridge' }),
    P('block', [-1, 4.55, -30.2], [2.6, 0.5, 0.35], '#ff6b5e', 'neon', { name: 'Laser', collide: false, props: { behavior: 'kill' } }),
    P('block', [-1, 4.55, -34], [2.6, 0.5, 0.35], '#ff6b5e', 'neon', { name: 'Laser', collide: false, props: { behavior: 'kill' } }),
    P('spawn', [-1, 4.45, -40], [5, 0.4, 5], '#3a3f47', 'metal', { name: 'Checkpoint', props: { checkpoint: true } }),
    P('cylinder', [-1, 4.4, -46], [3, 0.3, 3], '#8fe3a8', 'neon', { name: 'Jump pad', props: { behavior: 'bounce', bounce: 17 } }),
    P('block', [-1, 4.0, -46], [4, 0.6, 4], '#23262c', 'metal', { name: 'Pad base' }),
    P('block', [-1, 9.5, -53], [4, 1, 4], '#f4f1ea', 'plastic', { name: 'High step' }),
    P('block', [-1, 9.7, -61], [6, 0.4, 6], '#f0b46a', 'metal', { name: 'Finish', props: { behavior: 'finish' } }),
    P('text', [-1, 13.2, -64.1], [6, 2.2, 0.3], '#1f2a44', 'metal', { name: 'Finish sign', r: [0, 180, 0], props: { text: 'FINISH', textColor: '#ffd29a' } }),
    P('text', [-6.5, 2.4, -5], [5, 2, 0.3], '#1f2a44', 'metal', { name: 'Welcome sign', r: [0, 160, 0], props: { text: 'Ø OBBY', textColor: cyan } }),
    P('cylinder', [-6.5, 0.7, -5], [0.25, 1.4, 0.25], '#23262c', 'metal', { name: 'Sign post' }),
    P('light', [3, 3, -6.5], [0.5, 0.5, 0.5], cyan, 'neon', { name: 'Light', collide: false, props: { brightness: 5, range: 18 } }),
    P('light', [2.6, 6.6, -40], [0.4, 0.4, 0.4], '#ffd29a', 'neon', { name: 'Light', collide: false, props: { brightness: 6, range: 20 } }),
    P('light', [3.2, 12.4, -63], [0.4, 0.4, 0.4], '#f0b46a', 'neon', { name: 'Light', collide: false, props: { brightness: 6, range: 22 } }),
  ];
}

/** A new experience from a template ('baseplate' | 'obby' | 'empty'). */
export function createExperience(template = 'baseplate', { title = '' } = {}) {
  let parts = [];
  let settings = { sky: 'golden', time: 17.6, gravity: 1, baseplate: { size: 512, color: '#6f7279', material: 'concrete' } };
  if (template === 'obby') {
    parts = obbyParts();
    settings = { ...settings, sky: 'golden', time: 17.6, baseplate: { size: 256, color: '#3a3f47', material: 'concrete' } };
  } else if (template === 'empty') {
    settings = { ...settings, sky: 'space', time: 12, baseplate: { size: 0, color: '#3a3f47', material: 'concrete' } };
    parts = [P('spawn', [0, 0.2, 0], [6, 0.4, 6], '#3a3f47', 'metal', { name: 'Spawn' })];
  } else {
    parts = [P('spawn', [0, 0.2, 0], [6, 0.4, 6], '#3a3f47', 'metal', { name: 'Spawn' })];
  }
  const res = validate({ format: FORMAT, v: VERSION, meta: { title, description: '', maxPlayers: 20 }, settings, parts, groups: [], logic: [] });
  return res.exp;
}
