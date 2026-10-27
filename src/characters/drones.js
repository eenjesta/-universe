/**
 * Small hovering drones (characters module): ducted quad-drones with a cyan
 * camera eye and status lights at the spaceport and the base. One InstancedMesh
 * per area (one draw call each), sharing the character material (per-vertex
 * roughness/metalness/emissive). Hover bob, slow Lissajous patrol, banking.
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { GeoBuilder, geometryFromArrays, superEllipsoid, mat } from './builder.js';

function droneGeometry() {
  const b = new GeoBuilder();
  const C = (h) => new THREE.Color(h);
  const dark = { color: C('#1b1d21'), rough: 0.38, metal: 0.55, sheen: 0, detail: 0 };
  const shell = { color: C('#d9d6d0'), rough: 0.35, metal: 0.1, sheen: 0.1, detail: 0 };
  b.add(superEllipsoid(0.15, 0.065, 0.19, 0.5, 0.45, 18, 10), null, dark, 0);
  b.add(superEllipsoid(0.11, 0.03, 0.14, 0.5, 0.45, 16, 6), mat(0, 0.045, 0.01), shell, 0);
  const arm = new THREE.BoxGeometry(0.34, 0.025, 0.03);
  for (const [x, z] of [[0.24, 0.2], [-0.24, 0.2], [0.24, -0.2], [-0.24, -0.2]]) {
    const ang = Math.atan2(z, x);
    b.add(arm, mat(x / 2, 0, z / 2, 0, -ang, 0), dark, 0);
    b.add(new THREE.TorusGeometry(0.105, 0.02, 6, 24), mat(x, 0.01, z, Math.PI / 2, 0, 0), dark, 0);
    b.add(new THREE.CylinderGeometry(0.095, 0.095, 0.006, 20), mat(x, 0.012, z), { color: C('#3a3f46'), rough: 0.6, metal: 0.2 }, 0);
    b.add(new THREE.SphereGeometry(0.014, 6, 4), mat(x * 1.18, 0.0, z * 1.18), { color: C(z < 0 ? '#7fe0ff' : '#ff8a3d'), emis: 3.2 }, 0);
  }
  const eye = new THREE.SphereGeometry(0.042, 14, 10);
  b.add(eye, mat(0, -0.015, -0.18), { color: C('#0d1014'), rough: 0.1, metal: 0.4 }, 0);
  b.add(new THREE.SphereGeometry(0.02, 10, 8), mat(0, -0.015, -0.21), { color: C('#7fe0ff'), emis: 3.5 }, 0);
  b.add(new THREE.BoxGeometry(0.12, 0.012, 0.012), mat(0, -0.06, 0.05), { color: C('#7fe0ff'), emis: 2.2 }, 0);
  const arr = b.toArrays();
  const g = geometryFromArrays(arr);
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  g.computeBoundingSphere();
  return g;
}

export function createDrones(ctx, { material }) {
  const scene = ctx.world.scene;
  const geo = droneGeometry();
  const pads = ZONES.spaceport.pads;
  const ba = ZONES.base.buildArea;
  const areas = {
    spaceport: [
      { x: pads.ship.x + 4, z: pads.ship.z - 6, h: 6.5, r: 5 },
      { x: pads.vtol.x - 3, z: pads.vtol.z + 2, h: 4.2, r: 3.5 },
      { x: pads.ship.x + 18, z: pads.ship.z + 22, h: 7.5, r: 7 },
      { x: pads.car.x + 6, z: pads.car.z - 8, h: 3.6, r: 3 },
    ],
    base: [
      { x: ba.x - 6, z: ba.z - 4, h: 5.2, r: 4 },
      { x: ba.x + 10, z: ba.z + 8, h: 3.8, r: 3 },
    ],
  };
  const groups = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  for (const [name, defs] of Object.entries(areas)) {
    const mesh = new THREE.InstancedMesh(geo, material, defs.length);
    mesh.name = `drones-${name}`;
    mesh.castShadow = true;
    mesh.frustumCulled = true;
    scene.add(mesh);
    const drones = defs.map((d, i) => {
      const gy = ctx.world.getHeightAt ? ctx.world.getHeightAt(d.x, d.z) : 0;
      return { ...d, gy: Number.isFinite(gy) ? gy : 0, ph: i * 1.7 + name.length, pos: new THREE.Vector3(d.x, gy + d.h, d.z), vel: new THREE.Vector3(), yaw: 0 };
    });
    groups.push({ mesh, drones, boundsT: 0 });
  }

  function update(dt, t) {
    const cam = ctx.engine.camera.position;
    for (const g of groups) {
      const d0 = g.drones[0];
      if (Math.hypot(cam.x - d0.x, cam.z - d0.z) > 500) {
        g.mesh.visible = false;
        continue;
      }
      g.mesh.visible = true;
      g.drones.forEach((d, i) => {
        const k = t * 0.18 + d.ph;
        const tx = d.x + Math.sin(k) * d.r;
        const tz = d.z + Math.sin(k * 1.37 + 0.6) * d.r * 0.7;
        const ty = d.gy + d.h + Math.sin(t * 1.3 + d.ph) * 0.22;
        const ax = (tx - d.pos.x) * 1.8 - d.vel.x * 1.6;
        const az = (tz - d.pos.z) * 1.8 - d.vel.z * 1.6;
        d.vel.x += ax * dt;
        d.vel.z += az * dt;
        d.pos.x += d.vel.x * dt;
        d.pos.z += d.vel.z * dt;
        d.pos.y += (ty - d.pos.y) * Math.min(1, dt * 3);
        const sp = Math.hypot(d.vel.x, d.vel.z);
        if (sp > 0.05) {
          const want = Math.atan2(-d.vel.x, -d.vel.z);
          let diff = want - d.yaw;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          d.yaw += diff * Math.min(1, dt * 2);
        }
        // bank into acceleration (in drone space)
        const c = Math.cos(d.yaw);
        const sn = Math.sin(d.yaw);
        const fwdA = -(ax * -sn + az * -c);
        const sideA = ax * c - az * sn;
        e.set(-fwdA * 0.06 + Math.sin(t * 2.1 + d.ph) * 0.03, d.yaw, -sideA * 0.06, 'YXZ');
        q.setFromEuler(e);
        p.copy(d.pos);
        m4.compose(p, q, s);
        g.mesh.setMatrixAt(i, m4);
      });
      g.mesh.instanceMatrix.needsUpdate = true;
      g.boundsT -= dt;
      if (g.boundsT <= 0) {
        g.boundsT = 0.5;
        g.mesh.computeBoundingSphere();
        if (g.mesh.boundingSphere) g.mesh.boundingSphere.radius += 6;
      }
    }
  }

  return { groups, update };
}
