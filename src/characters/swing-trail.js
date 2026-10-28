/**
 * Swing trails (characters module): a short additive ribbon behind a swinging tool's head during
 * the strike of a chop / mine (wind-up end → just past the impact), so a swing reads from any camera
 * angle — also from behind, where the axe head is edge-on. Third person + remote avatars (the FP
 * view model has its own hit-stop / rebound juice).
 *
 *   const trails = createSwingTrails(ctx);
 *   trails.sample(owner, tipWorld, baseWorld, tool)   // every frame of the strike window
 *   trails.update(dt)                                 // ages + uploads; returns finished trails to the pool
 *
 * One tiny dynamic mesh per active swinger (pooled, max MAX), world-space vertices, no per-frame allocation.
 */
import * as THREE from 'three';

const N = 12; // samples per trail (ring)
const LIFE = 0.14; // s a sample stays visible
const MAX = 8;
/** Trail colour per tool (linear, > 1 blooms a little); unknown tools → warm white. */
const COLORS = {
  'plasma-axe': [0.55, 1.5, 2.2],
  'mining-laser': [0.55, 1.5, 2.2],
  pickaxe: [1.05, 1.0, 0.95],
  axe: [1.1, 1.0, 0.86],
};
const ALPHA = 0.42;

export function createSwingTrails(ctx) {
  const material = new THREE.MeshBasicMaterial({
    name: 'chr-swing-trail',
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  const pool = [];
  const live = new Map(); // owner → trail
  let made = 0;

  function make() {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.BufferAttribute(new Float32Array(N * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos);
    g.setAttribute('color', col);
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'chr-swing-trail';
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    made++;
    return { mesh, pos, col, tip: new Float32Array(N * 3), base: new Float32Array(N * 3), age: new Float32Array(N).fill(LIFE), head: 0, rgb: COLORS.axe, sampled: false };
  }

  /** Adds this frame's tip / base sample for `owner` (any object identity: the player, a remote). */
  function sample(owner, tip, base, tool) {
    let tr = live.get(owner);
    if (!tr) {
      if (live.size >= MAX) return;
      tr = pool.pop() || make();
      tr.age.fill(LIFE);
      tr.head = 0;
      for (let k = 0; k < N; k++) {
        tr.tip.set([tip.x, tip.y, tip.z], k * 3);
        tr.base.set([base.x, base.y, base.z], k * 3);
      }
      live.set(owner, tr);
      const scene = ctx.world?.scene;
      if (scene && tr.mesh.parent !== scene) scene.add(tr.mesh);
      tr.mesh.visible = true;
    }
    tr.rgb = COLORS[tool] || COLORS.axe;
    const i = tr.head;
    tr.tip[i * 3] = tip.x;
    tr.tip[i * 3 + 1] = tip.y;
    tr.tip[i * 3 + 2] = tip.z;
    tr.base[i * 3] = base.x;
    tr.base[i * 3 + 1] = base.y;
    tr.base[i * 3 + 2] = base.z;
    tr.age[i] = 0;
    tr.head = (i + 1) % N;
    tr.sampled = true;
  }

  function update(dt) {
    if (!live.size) return;
    for (const [owner, tr] of live) {
      let alive = false;
      // newest sample first: ring order head−1, head−2, …
      const p = tr.pos.array;
      const c = tr.col.array;
      const [r, g, b] = tr.rgb;
      for (let k = 0; k < N; k++) {
        const i = (tr.head - 1 - k + N * 2) % N;
        if (!tr.sampled || k > 0) tr.age[i] += dt;
        const a = tr.age[i] < LIFE ? (1 - tr.age[i] / LIFE) * ALPHA * (1 - k / N) : 0;
        if (a > 0) alive = true;
        const v = k * 2;
        if (a > 0 || k === 0) {
          p[v * 3] = tr.tip[i * 3];
          p[v * 3 + 1] = tr.tip[i * 3 + 1];
          p[v * 3 + 2] = tr.tip[i * 3 + 2];
          p[(v + 1) * 3] = tr.base[i * 3];
          p[(v + 1) * 3 + 1] = tr.base[i * 3 + 1];
          p[(v + 1) * 3 + 2] = tr.base[i * 3 + 2];
        } else {
          // dead sample: collapse onto the newer vertex pair (degenerate quads, never a streak to stale points)
          for (let j = 0; j < 6; j++) p[v * 3 + j] = p[(v - 2) * 3 + j];
        }
        c[v * 4] = r;
        c[v * 4 + 1] = g;
        c[v * 4 + 2] = b;
        c[v * 4 + 3] = a;
        // the inner edge fades out (soft ribbon)
        c[(v + 1) * 4] = r;
        c[(v + 1) * 4 + 1] = g;
        c[(v + 1) * 4 + 2] = b;
        c[(v + 1) * 4 + 3] = 0;
      }
      tr.sampled = false;
      if (!alive) {
        tr.mesh.visible = false;
        tr.mesh.removeFromParent();
        live.delete(owner);
        pool.push(tr);
        continue;
      }
      tr.pos.needsUpdate = true;
      tr.col.needsUpdate = true;
    }
  }

  /** Drops an owner's trail at once (avatar removed / hidden). */
  function drop(owner) {
    const tr = live.get(owner);
    if (!tr) return;
    tr.mesh.visible = false;
    tr.mesh.removeFromParent();
    live.delete(owner);
    pool.push(tr);
  }

  return {
    sample,
    update,
    drop,
    get active() {
      return live.size;
    },
    get made() {
      return made;
    },
  };
}

/** True inside the strike window of a running tool action (t, impact, dur in seconds). */
export function inStrike(t, impact, dur) {
  return t >= impact - 0.13 * dur && t <= impact + 0.06 * dur;
}
