import * as THREE from 'three';

/**
 * Highway ribbons (PLATFORM.md §11.2) with the hub's road look
 * (src/world/terrain/roads.js: dark paving, flagstone joints, worn tracks,
 * kerbs, light strips near the edges that glow at night). The ribbon follows
 * the stamped (flat) road surface of the worldgen, +12 cm with polygon offset;
 * it fades in at the hub gate. One draw call per highway.
 */
const LIFT = 0.12;

export function createHighwayMeshes(worldgen) {
  const group = new THREE.Group();
  group.name = 'frontier-highways';
  const map = roadTexture();
  const emissiveMap = roadEmissiveTexture();
  const material = new THREE.MeshStandardMaterial({
    map,
    emissiveMap,
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
  material.name = 'frontier-road';
  const across = [-1, -0.62, 0, 0.62, 1];
  for (const road of worldgen.highways) {
    const p = road.points;
    const n = p.length / 3;
    const hw = 5;
    const pos = new Float32Array(n * across.length * 3);
    const uv = new Float32Array(n * across.length * 2);
    const col = new Float32Array(n * across.length * 4);
    const idx = [];
    let dist = 0;
    let v = 0;
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1);
      const b = Math.min(n - 1, k + 1);
      const tx = p[b * 3] - p[a * 3];
      const tz = p[b * 3 + 2] - p[a * 3 + 2];
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      if (k > 0) dist += Math.hypot(p[k * 3] - p[(k - 1) * 3], p[k * 3 + 2] - p[(k - 1) * 3 + 2]);
      const alpha = Math.min(1, k / 3, (n - 1 - k) / 3);
      for (const s of across) {
        const x = p[k * 3] + nx * hw * s;
        const z = p[k * 3 + 2] + nz * hw * s;
        pos[v * 3] = x;
        pos[v * 3 + 1] = worldgen.heightAt(x, z) + LIFT;
        pos[v * 3 + 2] = z;
        uv[v * 2] = (s + 1) / 2;
        uv[v * 2 + 1] = dist / 10;
        col[v * 4] = 1;
        col[v * 4 + 1] = 1;
        col[v * 4 + 2] = 1;
        col[v * 4 + 3] = alpha;
        v++;
      }
    }
    const w = across.length;
    for (let k = 0; k < n - 1; k++) {
      for (let s = 0; s < w - 1; s++) {
        const a = k * w + s;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `frontier-highway-${road.id}`;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.raycast = () => {};
    group.add(mesh);
  }
  return {
    group,
    material,
    setDayFactor(f) {
      material.emissiveIntensity = 0.12 + (1 - f) * 1.4;
    },
    dispose() {
      for (const m of group.children) m.geometry.dispose();
      material.dispose();
      map.dispose();
      emissiveMap.dispose();
    },
  };
}

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
      if ((y % 32 === 0 || Math.abs(u - 0.5) < 0.006) && u > 0.1 && u < 0.9) v -= 16;
      if ((u > 0.26 && u < 0.36) || (u > 0.64 && u < 0.74)) v += 5;
      let r = v;
      let g = v;
      let b = v + 2;
      if (u < 0.045 || u > 0.955) r = g = b = 70 + (rnd() - 0.5) * 8;
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
