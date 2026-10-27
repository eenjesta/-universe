/**
 * Walk-point navigation graph (characters module).
 *
 * Nodes are free walk points (e.g. ctx.landmarks.plaza.walkPoints); edges join
 * nodes closer than `maxEdge` whose straight line is clear of solid physics
 * boxes (tested at waist height) and of circular blockers (the tree trunk).
 * route(from, to) runs A* and returns a short list of waypoints so NPCs walk
 * around the tree, the stage and the stalls instead of into them.
 */
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class NavGraph {
  constructor(points, { physics = null, maxEdge = 13, blockers = [], height = 0.9 } = {}) {
    this.nodes = points.map((p) => ({ x: p.x, z: p.z, y: Number.isFinite(p.y) ? p.y : 0 }));
    this.adj = this.nodes.map(() => []);
    this.blockers = blockers;
    const n = this.nodes.length;
    const max2 = maxEdge * maxEdge;
    for (let i = 0; i < n; i++) {
      const A = this.nodes[i];
      for (let j = i + 1; j < n; j++) {
        const B = this.nodes[j];
        const dx = B.x - A.x;
        const dz = B.z - A.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > max2 || d2 < 0.01) continue;
        if (!this.clear(A.x, A.z, B.x, B.z)) continue;
        if (physics?.segmentHit) {
          _a.set(A.x, A.y + height, A.z);
          _b.set(B.x, B.y + height, B.z);
          if (physics.segmentHit(_a, _b) < 1) continue;
        }
        const d = Math.sqrt(d2);
        this.adj[i].push(j, d);
        this.adj[j].push(i, d);
      }
    }
    // spatial hash for nearest-node queries
    this.cell = 8;
    this.grid = new Map();
    this.nodes.forEach((p, i) => {
      const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(i);
    });
    // scratch for A*
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.run = 0;
  }

  key(ix, iz) {
    return ix * 73856093 + iz * 19349663;
  }

  /** Segment clear of the circular blockers? */
  clear(ax, az, bx, bz) {
    for (const c of this.blockers) {
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / l2));
      const px = ax + dx * t - c.x;
      const pz = az + dz * t - c.z;
      if (px * px + pz * pz < c.r * c.r) return false;
    }
    return true;
  }

  /** Index of the nearest node (prefers nodes reachable in a straight line). */
  nearest(x, z, needClear = true) {
    let best = -1;
    let bd = Infinity;
    const c = this.cell;
    const ix = Math.floor(x / c);
    const iz = Math.floor(z / c);
    for (let r = 0; r <= 3 && best < 0; r++) {
      for (let gx = ix - r; gx <= ix + r; gx++) {
        for (let gz = iz - r; gz <= iz + r; gz++) {
          if (r && Math.abs(gx - ix) !== r && Math.abs(gz - iz) !== r) continue;
          const arr = this.grid.get(this.key(gx, gz));
          if (!arr) continue;
          for (const i of arr) {
            const p = this.nodes[i];
            const d = (p.x - x) ** 2 + (p.z - z) ** 2;
            if (d < bd && (!needClear || this.clear(x, z, p.x, p.z))) {
              bd = d;
              best = i;
            }
          }
        }
      }
    }
    if (best < 0) {
      // far from every node: brute force
      this.nodes.forEach((p, i) => {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
    }
    return best;
  }

  /**
   * Waypoints from (fx, fz) to (tx, tz): [] when the straight line is clear of
   * blockers and short, else node positions along the A* path (the caller walks
   * to the exact goal afterwards).
   */
  route(fx, fz, tx, tz, out = []) {
    out.length = 0;
    const direct = Math.hypot(tx - fx, tz - fz);
    if (direct < 6 && this.clear(fx, fz, tx, tz)) return out;
    const s = this.nearest(fx, fz);
    const t = this.nearest(tx, tz);
    if (s < 0 || t < 0 || s === t) return out;
    const run = ++this.run;
    const N = this.nodes;
    const open = [s];
    const g = this.g;
    const f = this.f;
    this.stamp[s] = run;
    g[s] = 0;
    f[s] = Math.hypot(N[t].x - N[s].x, N[t].z - N[s].z);
    this.from[s] = -1;
    let found = false;
    let guard = 0;
    while (open.length && guard++ < 4000) {
      // pop the lowest f (open lists stay small on these graphs)
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === t) {
        found = true;
        break;
      }
      this.closed[cur] = run;
      const a = this.adj[cur];
      for (let k = 0; k < a.length; k += 2) {
        const nb = a[k];
        if (this.closed[nb] === run) continue;
        const ng = g[cur] + a[k + 1];
        if (this.stamp[nb] !== run || ng < g[nb]) {
          if (this.stamp[nb] !== run) open.push(nb);
          this.stamp[nb] = run;
          g[nb] = ng;
          f[nb] = ng + Math.hypot(N[t].x - N[nb].x, N[t].z - N[nb].z);
          this.from[nb] = cur;
        }
      }
    }
    if (!found) return out;
    for (let c = t; c >= 0; c = this.from[c]) out.push(N[c]);
    out.reverse();
    // drop the first node when we are already past it toward the second
    if (out.length > 1) {
      const a = out[0];
      const b = out[1];
      if ((b.x - fx) ** 2 + (b.z - fz) ** 2 < (b.x - a.x) ** 2 + (b.z - a.z) ** 2) out.shift();
    }
    return out;
  }
}
