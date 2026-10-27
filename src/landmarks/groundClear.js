/**
 * Landmarks — keeps the terrain's GPU grass out of built-up footprints
 * (plaza paving, spaceport apron + hangar floor, wet beacon shore, promenade,
 * city plates). The terrain grass samples the grass-density channel (B) of
 * `world.terrain.textures.splatB`; landmarks lower that channel once at
 * install inside the footprints (soft edge), so blades no longer poke through
 * floors. Trees and rocks inside the footprints are removed through the
 * terrain's public `world.vegetation.clearArea`.
 *
 * Purely defensive: if the terrain exposes neither, nothing happens (see
 * notes/landmarks-requests.md — a terrain-side NO_GRASS entry is preferred).
 */

/**
 * shapes: { x, z, r, soft? } (disc) | { x, z, w, d, rotY?, soft? } (oriented rect)
 * Returns the number of texels changed.
 */
export function clearGrass(world, shapes) {
  const T = world?.terrain;
  const tex = T?.textures?.splatB;
  const D = T?.data;
  const arr = tex?.image?.data;
  if (!arr || !D || !(D.N > 0) || !(D.STEP > 0) || !Number.isFinite(D.HALF)) return 0;
  const { N, STEP, HALF } = D;
  if (arr.length !== N * N * 4) return 0;
  let changed = 0;
  for (const s of shapes) {
    const soft = s.soft ?? 3;
    const rect = s.w != null;
    const c = Math.cos(s.rotY || 0);
    const sn = Math.sin(s.rotY || 0);
    const hw = rect ? s.w / 2 : s.r;
    const hd = rect ? s.d / 2 : s.r;
    const ext = Math.hypot(hw, hd) + soft;
    const i0 = Math.max(0, Math.floor((s.x - ext + HALF) / STEP));
    const i1 = Math.min(N - 1, Math.ceil((s.x + ext + HALF) / STEP));
    const j0 = Math.max(0, Math.floor((s.z - ext + HALF) / STEP));
    const j1 = Math.min(N - 1, Math.ceil((s.z + ext + HALF) / STEP));
    for (let j = j0; j <= j1; j++) {
      const z = -HALF + j * STEP;
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * STEP;
        // signed distance outside the shape (≤ 0 inside)
        let d;
        if (rect) {
          const dx = x - s.x;
          const dz = z - s.z;
          // world → local (same convention as physics boxes: rotation about Y)
          const lx = Math.abs(dx * c - dz * sn) - hw;
          const lz = Math.abs(dx * sn + dz * c) - hd;
          d = Math.max(lx, lz);
        } else d = Math.hypot(x - s.x, z - s.z) - s.r;
        if (d >= soft) continue;
        const k = d <= 0 ? 0 : d / soft;
        const o = (j * N + i) * 4 + 2;
        const v = Math.round(arr[o] * k * k);
        if (v < arr[o]) {
          arr[o] = v;
          changed++;
        }
      }
    }
  }
  if (changed) tex.needsUpdate = true;
  return changed;
}

/** Removes terrain trees / rocks inside discs [{x, z, r}] (public terrain API). Returns the count. */
export function clearVegetation(world, discs) {
  const fn = world?.vegetation?.clearArea;
  if (typeof fn !== 'function') return 0;
  let n = 0;
  for (const d of discs) {
    try {
      n += fn.call(world.vegetation, d.x, d.z, d.r) || 0;
    } catch {
      /* optional terrain API */
    }
  }
  return n;
}
