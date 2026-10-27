import * as THREE from 'three';
import { ZONES } from '../layout.js';

/**
 * Road ribbons along the smoothed road centrelines (the bake already
 * flattened a corridor and computed the grade). Dark paving with a subtle
 * light strip near each edge (emissive, brighter at night). Ribbons follow
 * the terrain (+12 cm, polygon offset against z-fighting), fade out where a
 * road ends on a zone pad, and roads that start on another road are trimmed
 * so the surfaces never overlap.
 */
const LIFT = 0.12;

export function createRoads(data, getHeightAt) {
  const lines = data.roads.lines;
  const texture = roadTexture();
  const emissive = roadEmissiveTexture();
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: emissive,
    emissive: new THREE.Color('#cfeaff'),
    emissiveIntensity: 0.25,
    roughness: 0.62,
    metalness: 0.05,
    vertexColors: true,
    alphaHash: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -6,
  });
  material.name = 'terrain-road';

  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const spawn = ZONES.spawn;

  lines.forEach((road, ri) => {
    const pts = road.points.map((p) => new THREE.Vector2(p[0], p[2]));
    // trim the start where it lies on an earlier road (junctions)
    let start = 0;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      let onOther = false;
      for (let o = 0; o < ri; o++) {
        const other = lines[o];
        for (const q of other.points) {
          if (Math.hypot(q[0] - p.x, q[2] - p.y) < other.width / 2 + 0.5) {
            onOther = true;
            break;
          }
        }
        if (onOther) break;
      }
      if (!onOther) break;
      start = k;
    }
    const used = pts.slice(start);
    if (used.length < 2) return;
    const hw = road.width / 2;
    const across = [-1, -0.62, 0, 0.62, 1];
    const base = pos.length / 3;
    let dist = 0;
    for (let k = 0; k < used.length; k++) {
      const p = used[k];
      const a = used[Math.max(0, k - 1)];
      const b = used[Math.min(used.length - 1, k + 1)];
      const tx = b.x - a.x;
      const tz = b.y - a.y;
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      if (k > 0) dist += used[k].distanceTo(used[k - 1]);
      // fade near the spawn centre and at the road ends on pads
      const ds = Math.hypot(p.x - spawn.x, p.y - spawn.z);
      let alpha = THREE.MathUtils.smoothstep(ds, 9, 19);
      if (k === 0 && start > 0) alpha = Math.min(alpha, 0.999);
      const endFade = Math.min(1, (used.length - 1 - k) / 4, start > 0 ? 1 : k / 4 + (ds > 20 ? 1 : 0));
      alpha = Math.min(alpha, Math.max(0, endFade));
      for (const s of across) {
        const x = p.x + nx * hw * s;
        const z = p.y + nz * hw * s;
        pos.push(x, getHeightAt(x, z) + LIFT + ri * 0.015, z);
        uv.push((s + 1) / 2, dist / road.width);
        col.push(1, 1, 1, alpha);
      }
    }
    const w = across.length;
    for (let k = 0; k < used.length - 1; k++) {
      for (let s = 0; s < w - 1; s++) {
        const a = base + k * w + s;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'terrain-roads';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;

  return {
    mesh,
    material,
    /** Night glow of the edge strips (dayFactor 1 = day). */
    setDayFactor(f) {
      material.emissiveIntensity = 0.12 + (1 - f) * 1.4;
    },
  };
}

/**
 * Paving texture generated in JS (a DataTexture — canvas readbacks stall for
 * seconds behind a busy GPU process): dark fine-grained paving, flagstone
 * joints, worn tyre tracks, kerbs and a light strip near each edge.
 */
function roadTexture() {
  const W = 128;
  const H = 256;
  const d = new Uint8Array(W * H * 4);
  let s = 1234567;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let v = 40 + (rnd() - 0.5) * 12;
      // flagstone joints (across every 32 px, along the centre)
      if ((y % 32 === 0 || Math.abs(u - 0.5) < 0.006) && u > 0.1 && u < 0.9) v -= 16;
      // worn tyre tracks
      if ((u > 0.26 && u < 0.36) || (u > 0.64 && u < 0.74)) v += 5;
      let r = v;
      let g = v;
      let b = v + 2;
      // kerbs
      if (u < 0.045 || u > 0.955) r = g = b = 70 + (rnd() - 0.5) * 8;
      // light strips
      if ((u > 0.075 && u < 0.093) || (u > 0.907 && u < 0.925)) {
        r = 196;
        g = 206;
        b = 214;
      }
      const k = (y * W + x) * 4;
      d[k] = r;
      d[k + 1] = g;
      d[k + 2] = b;
      d[k + 3] = 255;
    }
  }
  return dataTex(d, W, H, true);
}

function roadEmissiveTexture() {
  const W = 128;
  const H = 4;
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const on = (u > 0.075 && u < 0.093) || (u > 0.907 && u < 0.925);
      const k = (y * W + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = on ? 255 : 0;
      d[k + 3] = 255;
    }
  }
  return dataTex(d, W, H, true);
}

function dataTex(data, w, h, srgb) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
