import { createNoise, sstep, mix } from './noise.js';

/**
 * The procedural planet surface (no hub, no roads, no POI pads — index.js
 * layers those on top). Pure JS, allocation-free: `natural(x, z, S)` returns the
 * height (m, water level 0) and fills the scratch Float64Array `S` with the
 * fields the biome / feature / material code needs.
 *
 * Geography, coarse → fine:
 *   continents   domain-warped low-frequency fBm (~16 km): oceans, coasts, shelves,
 *                archipelagos; near the hub a themed bias (open sea N/NE, land W/S/E)
 *   climate      temperature + moisture (~11 km), hub themes: W warm + wet (jungle),
 *                E hot + dry (badlands); altitude lapse; wetter coasts
 *   relief       rolling hills (~600 m), ridged mountain chains (~2.6 km crests,
 *                a ring continuing the hub's mountains), stepped table-land plateaus
 *                (Crystal Highlands), terraced red mesas cut by canyons (badlands)
 *   water        lowland rivers (warped noise zero-lines carved to −2.6 m) and lakes
 *   detail       ~55 m / ~19 m bumps (damped on beaches)
 *
 * Highway corridors damp the mountains / mesas (roads run through passes and
 * valleys): `setCorridor(fn)` → fn(x, z) ∈ [0, 1] (1 = on the road).
 */

// scratch slots (Float64Array S)
export const S_H = 0; // natural height
export const S_C = 1; // continentalness (0 = coastline, > 0 land)
export const S_T = 2; // temperature 0..1
export const S_M = 3; // moisture 0..1
export const S_MOUNT = 4; // mountain mask × ridge (rocky crests)
export const S_PLAT = 5; // plateau (highlands) mask
export const S_BAD = 6; // badlands mask
export const S_RIVER = 7; // river channel weight
export const S_LAKE = 8; // lake weight
export const S_MM = 9; // mountain mask
export const S_INL = 10; // inland factor (0 at the coast)
export const S_JUNGLE = 11; // jungle climate mask
export const S_T0 = 12; // temperature before the altitude lapse (climate zone)
export const S_LEN = 16;

/**
 * Planet profiles: a small seam for later planets (Kepler-Ø 7 …). The home
 * planet is the default; values are biases on the generic fields.
 */
export const PLANETS = {
  'o-prime': { id: 'o-prime', landBias: 0.1, mountain: 1, tempBias: 0, moistBias: 0, plateau: 1 },
  'kepler-o7': { id: 'kepler-o7', landBias: 0.05, mountain: 0.85, tempBias: 0.08, moistBias: 0.06, plateau: 1.4 },
};

export function createTerrain(seed, { hub = false, planet = PLANETS['o-prime'] } = {}) {
  const N = createNoise(`${seed}:terrain`);
  const hubMode = !!hub;
  const P = planet || PLANETS['o-prime'];
  let corridor = null; // (x, z) → 0..1
  // hub-theme context of the current sample (typed scratch: no boxed doubles)
  const C = new Float64Array(8);
  const C_NEAR = 0;
  const C_SEA = 1;
  const C_WEST = 2;
  const C_EAST = 3;
  const C_SOUTH = 4;
  const C_RING = 5;

  // The work is split into small functions so each gets its own type feedback:
  // one huge function deoptimises every time a rarely taken branch first runs.

  function themes(x, z) {
    const r = Math.sqrt(x * x + z * z) + 1e-6;
    C.fill(0);
    if (hubMode) {
      const near = 1 - sstep(4500, 16000, r);
      C[C_NEAR] = near;
      if (near > 0) {
        const ux = x / r;
        const uz = z / r;
        // the hub's open sea spans bearings ≈ −30° … +74° at its border (centre 22°)
        const sea = sstep(0.5, 0.72, ux * 0.3746 - uz * 0.9272);
        C[C_SEA] = sea;
        C[C_WEST] = sstep(0.3, 0.8, -ux);
        C[C_EAST] = sstep(0.3, 0.8, ux) * (1 - sea);
        C[C_SOUTH] = sstep(0.25, 0.8, uz);
        const box = Math.max(x < 0 ? -x : x, z < 0 ? -z : z);
        C[C_RING] = (1 - sea) * (1 - sstep(1300, 3000, box));
      }
    } else {
      // landing zone around the origin (planets without a hub): flat meadow near a coast
      C[C_NEAR] = 1 - sstep(300, 900, r);
    }
  }

  function continent(x, z) {
    const wx = x + 2400 * N.fbm2(x * 0.00011 + 3.1, z * 0.00011 - 7.3);
    const wz = z + 2400 * N.fbm2(x * 0.00011 - 5.7, z * 0.00011 + 1.9);
    let c = N.fbm3(wx * 0.0000625 + 0.37, wz * 0.0000625 - 0.71) * 1.6 + P.landBias;
    const near = C[C_NEAR];
    if (near > 0) c = hubMode ? mix(c, 0.4 * c + 0.42 - 0.98 * C[C_SEA], near) : mix(c, 0.16, near);
    // coves, headlands; archipelagos in the shallow sea
    c += 0.07 * N.fbm2(x * 0.0009 + 1.3, z * 0.0009 + 4.4) + 0.022 * N.n2(x * 0.0035 - 0.7, z * 0.0035 + 2.9);
    if (c < 0.02 && c > -0.75) c += islands(x, z, c);
    return c;
  }

  // archipelagos: lift the shallow sea floor; fades to 0 toward c = 0.02 and c = −0.75 (continuous)
  function islands(x, z, c) {
    const isl = sstep(0.34, 0.58, N.fbm2(x * 0.00068 + 9.1, z * 0.00068 - 2.2));
    return isl > 0 ? isl * 0.5 * sstep(-0.75, -0.25, c) * (1 - sstep(-0.12, 0.02, c)) : 0;
  }

  /** Coastal profile: beaches rise ~7 % at the waterline, flattening inland. */
  function coastal(c) {
    if (c >= 0) {
      const t = c < 0.04 ? c / 0.04 : 1;
      return 9 * (1 - (1 - t) * (1 - t)) + 130 * c + 60 * c * c;
    }
    const t = c > -0.05 ? -c / 0.05 : 1;
    return -(6 * (1 - (1 - t) * (1 - t)) + 60 * -c + 30 * sstep(0.06, 0.45, -c));
  }

  function mountains(x, z, mm) {
    const mwx = x + 420 * N.n2(x * 0.0011 + 4.1, z * 0.0011 - 2.7);
    const mwz = z + 420 * N.n2(x * 0.0011 - 6.6, z * 0.0011 + 9.3);
    return N.ridged(mwx * 0.00038 + 7.3, mwz * 0.00038 - 2.1, 3);
  }

  function plateau(x, z) {
    const f = N.fbm2(x * 0.00042 + 1.7 + 0.1 * N.n2(x * 0.0019, z * 0.0019), z * 0.00042 - 9.9);
    // table-land steps with steep (≈ 45–60°) rims; the upper tiers come from their own
    // noise fields (gated by the lower tier) so they never stack into concentric 'cakes'
    const t1 = sstep(-0.15, -0.03, f);
    if (t1 <= 0) return 0;
    const f2 = N.fbm2(x * 0.0009 - 7.3, z * 0.0009 + 3.1);
    const f3 = N.n2(x * 0.0016 + 5.9, z * 0.0016 - 8.4);
    return 80 * t1 + t1 * (50 * sstep(0.12, 0.2, f2) + 30 * sstep(0.42, 0.5, f3) * sstep(0.0, 0.1, f2));
  }

  /** Badlands: flat-topped tablelands (two levels) with steep cliffs, cut by canyons. */
  function mesas(x, z, damp) {
    const mx = x + 140 * N.n2(x * 0.0021 + 3.3, z * 0.0021 + 1.1);
    const mz = z + 140 * N.n2(x * 0.0021 - 7.7, z * 0.0021 - 5.5);
    const v = N.fbm3(mx * 0.00085 + 5.5, mz * 0.00085 - 2.2);
    const top1 = sstep(0.1, 0.17, v);
    // occasional buttes on the tablelands, from an independent field (no step pyramids)
    const top2 = top1 * sstep(0.34, 0.42, N.n2(x * 0.0021 - 3.7, z * 0.0021 + 6.2));
    // gentle erosion on the tops, scree aprons at the cliff feet
    const ero = 4 * N.n2(x * 0.011 + 0.5, z * 0.011 - 2.5);
    let hb = 12 + (52 * top1 + 30 * top2) * (1 - 0.75 * damp) + ero * (0.3 + 0.7 * top1) + 9 * sstep(-0.02, 0.1, v) * (1 - top1);
    const cn = Math.abs(N.fbm2(x * 0.00055 - 8.8, z * 0.00055 + 4.4));
    const can = 1 - sstep(0.02, 0.065, cn);
    return mix(hb, 4, can * 0.94);
  }

  /** Rivers + lakes in the lowlands (writes S_RIVER / S_LAKE). */
  function water(x, z, h, c, bad, S) {
    const pre = h;
    const low = 1 - sstep(24, 60, pre);
    const rw = Math.abs(N.fbm2(x * 0.00036 + 11.1 + 0.18 * N.n2(x * 0.0013, z * 0.0013), z * 0.00036 - 4.4));
    if (rw < 0.13) {
      const valley = (1 - sstep(0.03, 0.13, rw)) * low;
      h = mix(h, Math.min(h, 2.5 + pre * 0.32), valley * 0.85);
      const chan = (1 - sstep(0.009, 0.023, rw)) * low * sstep(0.004, 0.03, c);
      if (chan > 0) {
        h = mix(h, -2.6, chan);
        S[S_RIVER] = chan;
      }
    }
    const ln = N.fbm2(x * 0.0006 - 21.7, z * 0.0006 + 13.9);
    if (ln > 0.34) {
      const lake = sstep(0.36, 0.46, ln) * (1 - sstep(22, 50, pre)) * sstep(0.03, 0.08, c) * (1 - bad);
      if (lake > 0) {
        h = mix(h, -3.4, lake);
        S[S_LAKE] = lake;
      }
    }
    return h;
  }

  function natural(x, z, S) {
    themes(x, z);
    const near = C[C_NEAR];
    const c = continent(x, z);
    S[S_C] = c;
    const base = coastal(c);
    const inl = sstep(0.0, 0.12, c);
    S[S_INL] = inl;

    // climate (hub themes: W warm + wet, E hot + dry)
    let T = 0.5 + 0.55 * N.fbm2(x * 0.00008 + 21.1, z * 0.00008 - 4.4) + P.tempBias;
    let M = 0.5 + 0.55 * N.fbm2(x * 0.00009 - 13.3, z * 0.00009 + 8.8) + P.moistBias;
    if (hubMode && near > 0) {
      T += near * (0.22 * C[C_WEST] + 0.26 * C[C_EAST] - 0.06 * C[C_SOUTH]);
      M += near * (0.3 * C[C_WEST] - 0.46 * C[C_EAST] + 0.04 * C[C_SOUTH]);
    }
    M += 0.12 * (1 - sstep(0.02, 0.15, c));
    const hot = sstep(0.56, 0.68, T);
    const jungle = hot * sstep(0.52, 0.64, M) * inl;
    const bad = hot * sstep(0.44, 0.32, M) * inl;
    S[S_JUNGLE] = jungle;
    S[S_BAD] = bad;

    // relief
    const damp = corridor !== null ? corridor(x, z) : 0.0;
    const rough = 0.5 + 0.5 * N.fbm2(x * 0.00024 + 7.7, z * 0.00024 - 3.3);
    const hills = (9 + 32 * rough) * (0.5 + 0.5 * N.fbm3(x * 0.0016 + 2.2, z * 0.0016 - 6.1)) * inl;
    let h = base + hills * (1 - bad) * (hubMode ? 1 : 1 - 0.75 * near);

    let mm = N.fbm2(x * 0.00012 - 3.9, z * 0.00012 + 15.2) * 1.3 + 0.35 * sstep(0.05, 0.4, c) - 0.12 + 0.45 * C[C_RING];
    mm = sstep(0.12, 0.55, mm) * inl * P.mountain * (1 - 0.82 * damp) * (hubMode ? 1 : 1 - near);
    S[S_MM] = mm;
    S[S_MOUNT] = 0;
    if (mm > 0.001) {
      const R = mountains(x, z, mm);
      h += mm * (40 + 480 * R * R * (0.45 + 0.55 * mm)) + mm * mm * 45;
      // dendritic spurs + gullies on the flanks (~400 m), only where the main chain stands high
      const hi = sstep(0.12, 0.55, R);
      if (hi > 0) {
        const R2 = N.ridged(x * 0.0024 - 4.1, z * 0.0024 + 1.7, 2);
        h += mm * hi * (120 * R2 * R2 - 25);
      }
      S[S_MOUNT] = mm * R;
    }

    let plat = sstep(0.16, 0.4, N.fbm2(x * 0.00015 + 31.3, z * 0.00015 - 17.1)) * (1 - bad) * (1 - jungle) * inl * (1 - 0.6 * damp);
    plat *= sstep(0.3, 0.6, 1 - C[C_SEA]) * (hubMode ? 1 : 1 - near);
    S[S_PLAT] = plat;
    if (plat > 0.001) h += plat * plateau(x, z) * P.plateau;

    if (bad > 0.001) h += bad * mesas(x, z, damp);

    S[S_RIVER] = 0;
    S[S_LAKE] = 0;
    if (c > 0 && h < 62) h = water(x, z, h, c, bad, S);

    // detail (~55 m / ~19 m), damped on beaches
    const da = h > 0 ? 0.25 + 0.75 * sstep(1.2, 7, h) : 0.15;
    h += (1.1 * N.n2(x * 0.018 + 0.3, z * 0.018 - 1.7) + 0.45 * N.n2(x * 0.052 - 2.1, z * 0.052 + 0.9)) * da * (1 + 0.8 * rough * inl);

    S[S_T0] = T;
    T -= (h > 0 ? h : 0) * 0.00085;
    S[S_T] = T;
    S[S_M] = M;
    S[S_H] = h;
    return h;
  }

  // JIT warm-up: run every branch (sea, coast, hub themes, mountains, plateaus,
  // mesas, rivers, lakes) before real use so the optimised code is stable
  {
    const S = new Float64Array(S_LEN);
    for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) natural(i * 1531.7 + 13, j * 1467.3 - 7, S);
    for (let k = 0; k < 400; k++) natural(-9000 + k * 47.3, 2500 + k * 31.1, S);
  }

  return {
    natural,
    noise: N,
    hubMode,
    planet: P,
    setCorridor(fn) {
      corridor = typeof fn === 'function' ? fn : null;
    },
  };
}
