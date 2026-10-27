/**
 * Narrow-band Surface Nets polygonizer (characters module) for SdfModel.
 *
 * Two-level band: the box is split into blocks of `block`³ cells (primitives
 * are culled per block; blocks whose centre is far from the surface are
 * skipped), then each live block into 2³-cell sub-blocks that are tested the
 * same way, so only grid points right next to the surface are ever sampled.
 * Each cell with a sign change gets one vertex (mass point of its edge
 * crossings, optionally Newton-projected onto the surface); every crossing
 * grid edge emits a quad between the four cells around it (split along the
 * shorter diagonal, wound outward). Normals come from tetrahedral field
 * gradients, so shading is smooth regardless of cell size.
 */

const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // x edges
  [0, 2], [1, 3], [4, 6], [5, 7], // y edges
  [0, 4], [1, 5], [2, 6], [3, 7], // z edges
];
const SQ3 = Math.sqrt(3);

/** Tetrahedral gradient (4 evaluations) into g (Float64Array(3)); returns g. */
export function fieldGradient(model, x, y, z, list, n, e, g) {
  const a = model.dist(x + e, y - e, z - e, list, n);
  const b = model.dist(x - e, y - e, z + e, list, n);
  const c = model.dist(x - e, y + e, z - e, list, n);
  const d = model.dist(x + e, y + e, z + e, list, n);
  g[0] = a - b - c + d;
  g[1] = -a - b + c + d;
  g[2] = -a + b - c + d;
  return g;
}

/**
 * @param model SdfModel (finalized)
 * @param opts { min: [x,y,z], max: [x,y,z], cell (m), block (cells, multiple of 2), project (Newton steps) }
 * @returns { positions, normals, indices, vertexBlock, blocks: [{ list, n }], count, samples }
 */
export function polygonize(model, { min, max, cell, block = 8, project = 1 }) {
  const h = cell;
  const ox = min[0] - h;
  const oy = min[1] - h;
  const oz = min[2] - h;
  const nx = Math.ceil((max[0] - min[0]) / h) + 3;
  const ny = Math.ceil((max[1] - min[1]) / h) + 3;
  const nz = Math.ceil((max[2] - min[2]) / h) + 3;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const vals = new Float32Array(nx * ny * nz).fill(NaN);
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const B = block;
  const bnx = Math.ceil(cx / B);
  const bny = Math.ceil(cy / B);
  const bnz = Math.ceil(cz / B);
  const blocks = [];
  const tmpList = new Int32Array(model.prims.length);
  const halfDiag = (B * h * SQ3) / 2;
  const subHalf = h * SQ3; // 2-cell sub-block half diagonal
  const pIdx = (i, j, k) => (k * ny + j) * nx + i;
  const subs = []; // active sub-blocks: [blockId, i0, j0, k0, i1, j1, k1] flattened
  let samples = 0;

  // ---- 1. blocks → sub-blocks → sampling
  for (let kb = 0; kb < bnz; kb++) {
    for (let jb = 0; jb < bny; jb++) {
      for (let ib = 0; ib < bnx; ib++) {
        const i0 = ib * B;
        const j0 = jb * B;
        const k0 = kb * B;
        const i1 = Math.min(i0 + B, cx);
        const j1 = Math.min(j0 + B, cy);
        const k1 = Math.min(k0 + B, cz);
        const bcx = ox + ((i0 + i1) / 2) * h;
        const bcy = oy + ((j0 + j1) / 2) * h;
        const bcz = oz + ((k0 + k1) / 2) * h;
        const n = model.cull(bcx, bcy, bcz, halfDiag + 2 * h, tmpList);
        if (!n) continue;
        const dc = model.dist(bcx, bcy, bcz, tmpList, n);
        samples++;
        if (Math.abs(dc) > halfDiag * 1.35 + 2 * h) continue;
        const list = tmpList.slice(0, n);
        const id = blocks.length;
        blocks.push({ list, n, i0, j0, k0, i1, j1, k1 });
        for (let sk = k0; sk < k1; sk += 2) {
          for (let sj = j0; sj < j1; sj += 2) {
            for (let si = i0; si < i1; si += 2) {
              const ei = Math.min(si + 2, i1);
              const ej = Math.min(sj + 2, j1);
              const ek = Math.min(sk + 2, k1);
              const ds = model.dist(ox + ((si + ei) / 2) * h, oy + ((sj + ej) / 2) * h, oz + ((sk + ek) / 2) * h, list, n);
              samples++;
              if (Math.abs(ds) > subHalf * 1.45 + h) continue;
              subs.push(id, si, sj, sk, ei, ej, ek);
              for (let k = sk; k <= ek; k++) {
                const z = oz + k * h;
                for (let j = sj; j <= ej; j++) {
                  const y = oy + j * h;
                  let pi = pIdx(si, j, k);
                  for (let i = si; i <= ei; i++, pi++) {
                    if (vals[pi] === vals[pi]) continue; // already sampled
                    vals[pi] = model.dist(ox + i * h, y, z, list, n);
                    samples++;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // ---- 2. vertices (mass point of edge crossings)
  const pos = [];
  const vblock = [];
  const vcell = [];
  const corner = new Float64Array(8);
  const offs = [0, 1, nx, nx + 1, nx * ny, nx * ny + 1, nx * ny + nx, nx * ny + nx + 1];
  for (let q = 0; q < subs.length; q += 7) {
    const b = subs[q];
    for (let k = subs[q + 3]; k < subs[q + 6]; k++) {
      for (let j = subs[q + 2]; j < subs[q + 5]; j++) {
        for (let i = subs[q + 1]; i < subs[q + 4]; i++) {
          const ci = (k * cy + j) * cx + i;
          if (cellVert[ci] >= 0) continue;
          const base = pIdx(i, j, k);
          let mask = 0;
          let bad = false;
          for (let c = 0; c < 8; c++) {
            const v = vals[base + offs[c]];
            if (v !== v) {
              bad = true;
              break;
            }
            corner[c] = v;
            if (v < 0) mask |= 1 << c;
          }
          if (bad || mask === 0 || mask === 255) continue;
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let cnt = 0;
          for (let e = 0; e < 12; e++) {
            const a = EDGES[e][0];
            const c2 = EDGES[e][1];
            const da = corner[a];
            const db = corner[c2];
            if (da < 0 === db < 0) continue;
            const t = da / (da - db);
            const ax = a & 1;
            const ay = (a >> 1) & 1;
            const az = (a >> 2) & 1;
            sx += ax + ((c2 & 1) - ax) * t;
            sy += ay + (((c2 >> 1) & 1) - ay) * t;
            sz += az + (((c2 >> 2) & 1) - az) * t;
            cnt++;
          }
          const vi = pos.length / 3;
          pos.push(ox + (i + sx / cnt) * h, oy + (j + sy / cnt) * h, oz + (k + sz / cnt) * h);
          vblock.push(b);
          vcell.push(ci);
          cellVert[ci] = vi;
        }
      }
    }
  }
  const vcount = pos.length / 3;
  const P = new Float32Array(pos);
  const vertexBlock = Int32Array.from(vblock);

  // ---- 3. faces: one quad per crossing grid edge at each vertex cell's min corner
  const idx = [];
  const cv = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz ? -1 : cellVert[(k * cy + j) * cx + i]);
  // (a, b, c, d) are the four cells around the edge in counter-clockwise order seen
  // from the +axis end; the face points along +axis when the edge's low end is inside.
  const quad = (a, b, c, d, reverse) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (reverse) {
      const t = b;
      b = d;
      d = t;
    }
    if (dist2(P, a, c) <= dist2(P, b, d)) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  for (let v = 0; v < vcount; v++) {
    const ci = vcell[v];
    const i = ci % cx;
    const j = ((ci / cx) | 0) % cy;
    const k = (ci / (cx * cy)) | 0;
    const d0 = vals[pIdx(i, j, k)];
    const in0 = d0 < 0;
    // x edge: cycle (y, z) · y edge: cycle (z, x) · z edge: cycle (x, y)
    const dX = vals[pIdx(i + 1, j, k)];
    if (dX === dX && in0 !== dX < 0 && j > 0 && k > 0) quad(v, cv(i, j - 1, k), cv(i, j - 1, k - 1), cv(i, j, k - 1), !in0);
    const dY = vals[pIdx(i, j + 1, k)];
    if (dY === dY && in0 !== dY < 0 && i > 0 && k > 0) quad(v, cv(i, j, k - 1), cv(i - 1, j, k - 1), cv(i - 1, j, k), !in0);
    const dZ = vals[pIdx(i, j, k + 1)];
    if (dZ === dZ && in0 !== dZ < 0 && i > 0 && j > 0) quad(v, cv(i - 1, j, k), cv(i - 1, j - 1, k), cv(i, j - 1, k), !in0);
  }

  // ---- 4. Newton projection onto the surface + gradient normals
  const N = new Float32Array(vcount * 3);
  const e = h * 0.3;
  const maxStep = h * 0.6;
  const g = new Float64Array(3);
  for (let v = 0; v < vcount; v++) {
    const bl = blocks[vertexBlock[v]];
    const L = bl.list;
    const n = bl.n;
    let x = P[v * 3];
    let y = P[v * 3 + 1];
    let z = P[v * 3 + 2];
    for (let it = 0; it < project; it++) {
      fieldGradient(model, x, y, z, L, n, e, g);
      const gl2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (gl2 < 1e-14) break;
      // tetrahedral sum = 4e·∇f  →  step = f · ∇f / |∇f|²
      const d = model.dist(x, y, z, L, n);
      const sc = (d * 4 * e) / gl2;
      let mx = g[0] * sc;
      let my = g[1] * sc;
      let mz = g[2] * sc;
      const ml = Math.sqrt(mx * mx + my * my + mz * mz);
      if (ml > maxStep) {
        const k2 = maxStep / ml;
        mx *= k2;
        my *= k2;
        mz *= k2;
      }
      x -= mx;
      y -= my;
      z -= mz;
    }
    P[v * 3] = x;
    P[v * 3 + 1] = y;
    P[v * 3 + 2] = z;
    fieldGradient(model, x, y, z, L, n, e, g);
    const gl = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;
    N[v * 3] = g[0] / gl;
    N[v * 3 + 1] = g[1] / gl;
    N[v * 3 + 2] = g[2] / gl;
  }

  return { positions: P, normals: N, indices: Uint32Array.from(idx), vertexBlock, blocks, count: vcount, samples };
}

function dist2(P, a, b) {
  const x = P[a * 3] - P[b * 3];
  const y = P[a * 3 + 1] - P[b * 3 + 1];
  const z = P[a * 3 + 2] - P[b * 3 + 2];
  return x * x + y * y + z * z;
}

/**
 * Ambient occlusion from the field (classic SDF AO): `steps` samples along the
 * normal at growing distances; returns 0 (fully occluded) … 1 (open).
 */
export function fieldAO(model, x, y, z, nx, ny, nz, list, n, scale = 0.012, steps = 3, strength = 1) {
  let occ = 0;
  let w = 1;
  for (let i = 1; i <= steps; i++) {
    const t = scale * (0.4 + 0.75 * i * i);
    const d = model.dist(x + nx * t, y + ny * t, z + nz * t, list, n);
    occ += (t - d > 0 ? t - d : 0) * w;
    w *= 0.6;
  }
  const a = 1 - (occ / scale) * 0.5 * strength;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}
