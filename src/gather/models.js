import * as THREE from 'three';

/**
 * Procedural tool models (Ø style: dark graphite + brushed steel, warm wood, cyan / plasma glow).
 * Convention for ctx.player.holdTool(mesh, { grip }): origin at the grip (palm of the right hand),
 * metres. Axes / pickaxe / multitool: handle along +Y up to the head, the striking edge faces −Z.
 * Mining laser: held like a pistol — emitter along −Z, top +Y.
 * userData: { grip: 'axe' | 'pickaxe' | 'laser' | 'multitool', tool: id, tip: Vector3 (impact point /
 * emitter, local), glow: [materials with an emissive edge] }.
 */
const M = {};
function mats() {
  if (M.steel) return M;
  M.steel = new THREE.MeshStandardMaterial({ color: 0xb6bec8, metalness: 0.85, roughness: 0.3, name: 'gth-steel' });
  M.edge = new THREE.MeshStandardMaterial({ color: 0xe8edf2, metalness: 0.9, roughness: 0.18, name: 'gth-edge' });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x1c2027, metalness: 0.45, roughness: 0.5, name: 'gth-dark' });
  M.grip = new THREE.MeshStandardMaterial({ color: 0x2c3138, metalness: 0.1, roughness: 0.85, name: 'gth-grip' });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, metalness: 0, roughness: 0.72, name: 'gth-wood' });
  M.cyan = new THREE.MeshStandardMaterial({ color: 0x0b2830, emissive: 0x38d8ff, emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.4, name: 'gth-cyan' });
  M.plasma = new THREE.MeshStandardMaterial({ color: 0x3a1606, emissive: 0xff7a26, emissiveIntensity: 3.0, metalness: 0.3, roughness: 0.35, name: 'gth-plasma' });
  return M;
}

function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

/** Axe head blade profile (extruded): a curved cutting edge toward −Z. */
function bladeGeo(len = 0.17, height = 0.15, thick = 0.028) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.035);
  s.lineTo(-len * 0.55, -0.05);
  s.quadraticCurveTo(-len * 1.05, -height * 0.62, -len, 0);
  s.quadraticCurveTo(-len * 1.05, height * 0.62, -len * 0.55, 0.06);
  s.lineTo(0, 0.04);
  s.lineTo(0, -0.035);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -thick / 2);
  // shape is in XY: map shape-x → −Z (forward), shape-y → Y, extrude → X
  g.rotateY(Math.PI / 2);
  return g;
}

function handle(group, len, mat, gripMat, r = 0.018) {
  group.add(mesh(new THREE.CylinderGeometry(r * 0.9, r, len, 10), mat, 0, len / 2 - 0.1, 0));
  group.add(mesh(new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.16, 10), gripMat, 0, 0, 0));
  group.add(mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.1, 0.03, 10), gripMat, 0, -0.095, 0));
}

function build(id) {
  const m = mats();
  const g = new THREE.Group();
  g.name = `gather-tool-${id}`;
  const glow = [];
  let tip = new THREE.Vector3(0, 0.55, -0.12);
  let grip = 'axe';
  if (id === 'axe' || id === 'plasma-axe') {
    const plasma = id === 'plasma-axe';
    handle(g, 0.66, plasma ? m.dark : m.wood, m.grip);
    const head = new THREE.Group();
    head.position.set(0, 0.5, 0);
    head.add(mesh(new THREE.BoxGeometry(0.05, 0.1, 0.07), plasma ? m.dark : m.steel, 0, 0, 0.005));
    head.add(mesh(bladeGeo(0.18, 0.16, 0.026), plasma ? m.dark : m.steel, 0, 0, -0.025));
    // edge strip
    const edge = mesh(new THREE.BoxGeometry(0.03, 0.17, 0.018), plasma ? m.plasma : m.edge, 0, 0, -0.2);
    head.add(edge);
    // back spike + Ø accent
    head.add(mesh(new THREE.ConeGeometry(0.022, 0.06, 6), plasma ? m.dark : m.steel, 0, 0, 0.055, Math.PI / 2, 0, 0));
    head.add(mesh(new THREE.TorusGeometry(0.018, 0.0045, 6, 14), m.cyan, 0.03, 0, -0.03, 0, Math.PI / 2, 0));
    if (plasma) glow.push(m.plasma);
    g.add(head);
    tip = new THREE.Vector3(0, 0.5, -0.21);
    grip = 'axe';
  } else if (id === 'pickaxe') {
    handle(g, 0.7, m.wood, m.grip);
    const head = new THREE.Group();
    head.position.set(0, 0.56, 0);
    head.add(mesh(new THREE.BoxGeometry(0.05, 0.06, 0.08), m.steel));
    // two curved picks (cones, bent toward the handle)
    head.add(mesh(new THREE.ConeGeometry(0.03, 0.26, 6), m.steel, 0, -0.025, -0.16, -Math.PI / 2 - 0.25, 0, 0));
    head.add(mesh(new THREE.ConeGeometry(0.026, 0.2, 6), m.steel, 0, -0.02, 0.13, Math.PI / 2 + 0.25, 0, 0));
    head.add(mesh(new THREE.BoxGeometry(0.056, 0.012, 0.03), m.cyan, 0, 0.034, 0));
    g.add(head);
    tip = new THREE.Vector3(0, 0.5, -0.28);
    grip = 'pickaxe';
  } else if (id === 'mining-laser') {
    // pistol-like emitter: grip down, body along −Z
    g.add(mesh(new THREE.BoxGeometry(0.035, 0.11, 0.05), m.grip, 0, -0.03, 0.01, 0.2, 0, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.26, 12), m.dark, 0, 0.055, -0.08, Math.PI / 2, 0, 0));
    g.add(mesh(new THREE.TorusGeometry(0.043, 0.008, 6, 16), m.cyan, 0, 0.055, -0.13));
    g.add(mesh(new THREE.TorusGeometry(0.043, 0.008, 6, 16), m.cyan, 0, 0.055, -0.05));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.06, 10), m.steel, 0, 0.055, -0.235, Math.PI / 2, 0, 0));
    g.add(mesh(new THREE.SphereGeometry(0.016, 10, 8), m.cyan, 0, 0.055, -0.27));
    g.add(mesh(new THREE.BoxGeometry(0.012, 0.03, 0.14), m.steel, 0, 0.1, -0.06));
    glow.push(m.cyan);
    tip = new THREE.Vector3(0, 0.055, -0.28);
    grip = 'laser';
  } else {
    // Ø multitool: short graphite handle, hammer-hatchet head with a cyan light strip
    handle(g, 0.42, m.dark, m.grip, 0.016);
    const head = new THREE.Group();
    head.position.set(0, 0.3, 0);
    head.add(mesh(new THREE.BoxGeometry(0.045, 0.07, 0.07), m.dark));
    head.add(mesh(bladeGeo(0.11, 0.1, 0.022), m.steel, 0, 0, -0.03));
    head.add(mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.06, 8), m.steel, 0, 0, 0.06, Math.PI / 2, 0, 0));
    head.add(mesh(new THREE.BoxGeometry(0.05, 0.012, 0.05), m.cyan, 0, 0.04, 0.0));
    g.add(head);
    glow.push(m.cyan);
    tip = new THREE.Vector3(0, 0.3, -0.14);
    grip = 'multitool';
  }
  g.userData = { grip, tool: id, tip, glow };
  return g;
}

/** Tool models, built once per id and reused (a model is attached to one character at a time). */
export function createToolModels() {
  const cache = new Map();
  return {
    get(id) {
      if (!id || id === 'hands') return null;
      let g = cache.get(id);
      if (!g) cache.set(id, (g = build(id)));
      return g;
    },
    /** A fresh copy (remote players / previews). */
    clone(id) {
      const g = this.get(id);
      if (!g) return null;
      const c = g.clone(true);
      c.userData = { ...g.userData, tip: g.userData.tip.clone() };
      return c;
    },
    materials: () => mats(),
  };
}
