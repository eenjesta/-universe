/**
 * Coarse terrain line-of-sight: ray-march the segment A→B over the height
 * field (≤ 64 samples, ≥ 2 m apart); blocked when a sample is more than
 * `margin` below the ground. Endpoints are skipped (feet / muzzle on the ground).
 */
export function terrainLOS(H, ax, ay, az, bx, by, bz, margin = 0.3) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1.5) return true;
  const n = Math.min(64, Math.max(2, Math.ceil(len / 2)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = ax + dx * t;
    const z = az + dz * t;
    if (ay + dy * t < H(x, z) - margin) return false;
  }
  return true;
}
