/**
 * Ø border beacons along the hub square (PLATFORM.md §11): every POST_SPACING m a
 * slim dark pylon with two light bands, a glowing Ø emblem facing across the
 * border and a faint light column — "the safe zone ends here", readable from far
 * away and at night. Posts in the sea stand in the water like marker poles.
 * Three instanced draws with static matrices (written once the terrain answers);
 * only shown while the survival layer is active (server / LocalServer).
 */
import * as THREE from 'three';
import { GeoBuilder } from '../build/geo.js';
import { borderPosts, POST_SPACING } from './zone.js';

const WATER_Y = 0;
const GLOW = new THREE.Color(0.32, 1.0, 0.92).multiplyScalar(2.4);

function beaconGeometry() {
  const body = new GeoBuilder();
  body.cyl(0.66, 0.84, 0.55, 0, -0.1, 0, { color: 0x181c23, seg: 6 }); // plinth (sunk a little)
  body.cyl(0.3, 0.42, 6.4, 0, 3.4, 0, { color: 0x262d38, seg: 6 }); // shaft
  body.cyl(0.46, 0.34, 0.32, 0, 6.72, 0, { color: 0x181c23, seg: 6 }); // cap
  body.cyl(0.07, 0.09, 0.5, 0, 7.1, 0, { color: 0x262d38, seg: 6 }); // neck
  const glow = new GeoBuilder();
  glow.cyl(0.43, 0.43, 0.09, 0, 2.1, 0, { color: 0xffffff, seg: 6 });
  glow.cyl(0.4, 0.4, 0.09, 0, 4.3, 0, { color: 0xffffff, seg: 6 });
  // the Ø: a ring in the XY plane (faces ±Z) and a diagonal slash
  const ring = new THREE.TorusGeometry(0.9, 0.09, 8, 40);
  glow.geo(ring, 0, 8.25, 0, { color: 0xffffff });
  ring.dispose();
  glow.box(0.15, 2.35, 0.15, 0, 8.25, 0, { color: 0xffffff, rz: -0.62 });
  // light column: open cylinder from the emblem upwards, white at the bottom → black (additive)
  const beam = new THREE.CylinderGeometry(0.5, 0.22, 64, 10, 6, true).translate(0, 8.4 + 32, 0);
  const pos = beam.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - Math.min(1, Math.max(0, (pos.getY(i) - 8.4) / 64));
    const v = k * k * k * 0.42;
    col[i * 3] = v * 0.4;
    col[i * 3 + 1] = v;
    col[i * 3 + 2] = v * 0.95;
  }
  beam.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return { body: body.build(), glow: glow.build(), beam };
}

export function createBorder(ctx, rules) {
  const scene = ctx.world?.scene;
  const posts = borderPosts(rules.half, POST_SPACING);
  const geo = beaconGeometry();
  const mats = {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.65, name: 'smp-border-body' }),
    glow: new THREE.MeshBasicMaterial({ color: GLOW, toneMapped: true, name: 'smp-border-glow' }),
    beam: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, name: 'smp-border-beam' }),
  };
  const root = new THREE.Group();
  root.name = 'smp-border';
  root.visible = false;
  const meshes = {};
  for (const k of ['body', 'glow', 'beam']) {
    const m = new THREE.InstancedMesh(geo[k], mats[k], posts.length);
    m.name = `smp-border-${k}`;
    m.frustumCulled = false; // spans the whole hub; three draws, cheap
    if (k === 'body') {
      m.castShadow = false;
      m.receiveShadow = true;
    }
    if (k === 'beam') m.renderOrder = 11;
    meshes[k] = m;
    root.add(m);
  }
  scene?.add(root);

  let placed = false;
  function place() {
    const H = ctx.world?.getHeightAt;
    if (typeof H !== 'function') return false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < posts.length; i++) {
      const [x, z, side] = posts[i];
      let y = Number(H(x, z));
      if (!Number.isFinite(y)) y = 0;
      const wet = y < WATER_Y + 0.2 || !!ctx.world.isWater?.(x, z);
      y = wet ? WATER_Y - 0.35 : y - 0.15;
      // the emblem faces across the border: ±Z on the north/south edges, ±X on east/west, diagonal at corners
      const corner = Math.abs(Math.abs(x) - Math.abs(z)) < 1;
      const yaw = corner ? Math.PI / 4 * Math.sign(x * z || 1) : side === 1 || side === 3 ? Math.PI / 2 : 0;
      q.setFromAxisAngle(up, yaw);
      m.compose(p.set(x, y, z), q, s);
      for (const k in meshes) meshes[k].setMatrixAt(i, m);
    }
    for (const k in meshes) meshes[k].instanceMatrix.needsUpdate = true;
    placed = true;
    return true;
  }

  return {
    root,
    posts,
    setVisible(on) {
      if (on && !placed) place();
      root.visible = !!on && placed;
    },
    /** Re-sample the terrain (e.g. after the frontier streams the seam). */
    refresh: () => place(),
    dispose() {
      scene?.remove(root);
      for (const k in meshes) meshes[k].dispose();
      for (const k in geo) geo[k]?.dispose();
      for (const k in mats) mats[k].dispose();
    },
  };
}
