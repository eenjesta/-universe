/**
 * Landmarks — procedural building kit for Aurora-stad (and plaza backdrops).
 * Every generator appends geometry to three merged builders:
 *   F (facade, window shader), S (structure: crowns, rings, ledges, fins),
 *   L (glow: light strips, beacons)
 * and registers physics boxes for the solid bodies.
 */
import * as THREE from 'three';
import { mat, addBeam, TAU, hdr } from './common.js';

// cool, fairly dark silvers: at golden hour the skyline must read as dark
// silhouettes with bright rims and window lights, not as a pale castle
export const CITY_PALETTE = {
  white: 0xa2a5aa,
  pearl: 0x8d949d,
  silver: 0x707883,
  steel: 0x4f5762,
  graphite: 0x2c3139,
  dark: 0x1e2228,
  bronze: 0x5f5247,
  champagne: 0x8c8170,
};

const CYAN = hdr(0x7fd8ff, 2.0);
const WARM = hdr(0xffb46a, 1.9);
const VIOLET = hdr(0xb48cff, 2.0);
const RED = hdr(0xff3a2a, 4);

export function createBuildingKit({ F, S, L, physics, rng }) {
  const pickColor = () =>
    rng.pick([CITY_PALETTE.white, CITY_PALETTE.pearl, CITY_PALETTE.silver, CITY_PALETTE.silver, CITY_PALETTE.steel, CITY_PALETTE.steel, CITY_PALETTE.graphite, CITY_PALETTE.graphite, CITY_PALETTE.champagne]);
  const stripColor = () => (rng.chance(0.62) ? CYAN : rng.chance(0.6) ? WARM : VIOLET);
  const addBox = (x, y, z, w, h, d, rotY = 0, walkable = true) =>
    physics?.addBox({ x, y, z, w, h, d, rotY, tag: 'landmarks', walkable });

  /** Warning light on a tip (blinks red, visible by day too). */
  function beacon(x, y, z, r = 0.9) {
    L.add(new THREE.SphereGeometry(r, 8, 6), mat(x, y, z), { color: RED, glow: [0.55, rng.random(), 0.7] });
  }

  /** Prism segment helper (flat shaded) with facade attributes. */
  function prism(x, z, y0, h, r0, r1, sides, rot, color, win, baseY, extra = {}) {
    const g = new THREE.CylinderGeometry(r1, r0, h, sides, 1, false, rot);
    F.add(g, mat(x, y0 + h / 2, z), { flat: true, color, facade: 'cyl', perim: TAU * (r0 + r1) * 0.5, baseY, win, ...extra });
  }

  // ------------------------------------------------------------- spire
  function spire(x, z, baseY, H, R, o = {}) {
    const sides = o.sides || rng.pick([6, 8, 8, 12]);
    const color = o.color ?? pickColor();
    const seed = rng.random();
    const rot = rng.range(0, TAU);
    const winShaft = [seed, o.style ?? (rng.chance(0.55) ? 4 : 3), o.density ?? rng.range(0.45, 0.9), o.scale ?? 1.25];
    // podium
    const podH = THREE.MathUtils.clamp(H * 0.05, 8, 18);
    const podR = R * rng.range(1.5, 1.95);
    F.add(new THREE.CylinderGeometry(podR * 0.96, podR, podH + 6, sides * 2), mat(x, baseY - 6 + (podH + 6) / 2, z), {
      color: CITY_PALETTE.graphite,
      facade: 'cyl',
      perim: TAU * podR,
      baseY,
      win: [seed, 2, 0.85, 1],
    });
    S.add(new THREE.CylinderGeometry(podR * 1.04, podR * 1.04, 0.9, sides * 2), mat(x, baseY + podH, z), { color: CITY_PALETTE.silver });
    // warm shop band around the podium base
    L.add(new THREE.CylinderGeometry(podR * 1.005, podR * 1.005, 0.6, sides * 2, 1, true), mat(x, baseY + 3.6, z), { color: WARM, glow: [0, 0, 0.35] });
    addBox(x, baseY + podH / 2 - 1, z, podR * 1.6, podH + 2, podR * 1.6);

    // shaft segments with setbacks
    let y = baseY + podH;
    let r = R;
    const shaftTop = baseY + H * rng.range(0.66, 0.74);
    const n = o.segments || rng.int(2, 4);
    const segH = (shaftTop - y) / n;
    const finEvery = sides >= 8 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const r1 = r * rng.range(0.86, 0.96);
      prism(x, z, y, segH, r, r1, sides, rot, color, winShaft, baseY);
      // fins on the edges (vertical lines that read from far away)
      for (let k = 0; k < sides; k += finEvery) {
        const a = rot + (k / sides) * TAU;
        const p0 = new THREE.Vector3(x + Math.sin(a) * r * 1.02, y, z + Math.cos(a) * r * 1.02);
        const p1 = new THREE.Vector3(x + Math.sin(a) * r1 * 1.02, y + segH, z + Math.cos(a) * r1 * 1.02);
        addBeam(S, p0, p1, Math.max(0.35, R * 0.035), { color: CITY_PALETTE.silver }, 4);
        if (o.strips !== false && (k / finEvery) % 2 === 0) {
          const q0 = p0.clone().set(x + Math.sin(a) * r * 1.06, y + 0.5, z + Math.cos(a) * r * 1.06);
          const q1 = p1.clone().set(x + Math.sin(a) * r1 * 1.06, y + segH - 0.5, z + Math.cos(a) * r1 * 1.06);
          addBeam(L, q0, q1, 0.22, { color: o.strip || stripColor(), glow: [0, 0, 0.3] }, 3);
        }
      }
      // ledge between segments
      S.add(new THREE.CylinderGeometry(r1 * 1.07, r1 * 1.07, 1.3, sides, 1, false, rot), mat(x, y + segH, z), { flat: true, color: CITY_PALETTE.pearl });
      y += segH;
      r = r1 * rng.range(0.84, 0.92);
    }
    addBox(x, (baseY + podH + y) / 2, z, R * 1.45, y - baseY - podH, R * 1.45);

    // crown: long needle taper with vertical slit windows
    const crownTop = baseY + H * 0.93;
    const crownH = crownTop - y;
    prism(x, z, y, crownH, r, r * 0.14, sides, rot, color, [seed, 4, 0.5, 1.2], baseY);
    // crown fins sweeping up to the needle
    for (let k = 0; k < sides; k += finEvery * 2) {
      const a = rot + (k / sides) * TAU;
      const p0 = new THREE.Vector3(x + Math.sin(a) * r * 1.05, y, z + Math.cos(a) * r * 1.05);
      const p1 = new THREE.Vector3(x + Math.sin(a) * r * 0.2, crownTop + 2, z + Math.cos(a) * r * 0.2);
      addBeam(S, p0, p1, Math.max(0.3, R * 0.03), { color: CITY_PALETTE.white }, 4);
      if (o.strips !== false) addBeam(L, p0.clone().setY(y + 1), p1.clone().setY(crownTop), 0.18, { color: o.strip || CYAN, glow: [0, 0, 0.25] }, 3);
    }
    // antenna + warning light
    const top = baseY + H;
    addBeam(S, new THREE.Vector3(x, crownTop - 2, z), new THREE.Vector3(x, top, z), Math.max(0.25, R * 0.03), { color: CITY_PALETTE.silver }, 5);
    beacon(x, top + 0.6, z, Math.max(0.7, R * 0.07));
    // halo rings
    const rings = o.rings ?? (rng.chance(0.45) ? 1 : 0);
    for (let i = 0; i < rings; i++) {
      const ry = baseY + podH + (y - baseY - podH) * rng.range(0.35, 0.9);
      const rr = R * rng.range(1.35, 1.7);
      S.add(new THREE.TorusGeometry(rr, Math.max(0.5, R * 0.06), 6, 40), mat(x, ry, z, Math.PI / 2, 0, 0), { color: CITY_PALETTE.pearl });
      L.add(new THREE.TorusGeometry(rr * 1.01, 0.18, 4, 40), mat(x, ry - Math.max(0.5, R * 0.06), z, Math.PI / 2, 0, 0), {
        color: o.strip || stripColor(),
        glow: [0, 0, 0.3],
      });
      // spokes
      for (let k = 0; k < 4; k++) {
        const a = rot + (k / 4) * TAU + 0.4;
        addBeam(S, new THREE.Vector3(x + Math.sin(a) * R * 0.8, ry, z + Math.cos(a) * R * 0.8), new THREE.Vector3(x + Math.sin(a) * rr, ry, z + Math.cos(a) * rr), 0.4, { color: CITY_PALETTE.silver }, 4);
      }
    }
    // sky deck: a round landing platform cantilevered off the shaft, ringed with lights
    if (o.deck ?? (H > 150 && rng.chance(0.35))) {
      const dy = baseY + podH + (y - baseY - podH) * rng.range(0.3, 0.6);
      const dr = R * rng.range(1.9, 2.5);
      const da = rng.range(0, TAU);
      const off = R * 0.9;
      const dx = x + Math.sin(da) * off;
      const dz = z + Math.cos(da) * off;
      S.add(new THREE.CylinderGeometry(dr, dr * 0.82, 1.6, 36), mat(dx, dy, dz), { color: CITY_PALETTE.pearl });
      S.add(new THREE.CylinderGeometry(dr * 0.5, dr * 0.12, dr * 0.45, 18), mat(dx, dy - 0.8 - dr * 0.225, dz), { color: CITY_PALETTE.steel });
      L.add(new THREE.TorusGeometry(dr * 1.005, 0.16, 4, 48), mat(dx, dy + 0.15, dz, Math.PI / 2, 0, 0), { color: o.strip || stripColor(), glow: [0, 0, 0.35] });
      L.add(new THREE.TorusGeometry(dr * 0.55, 0.1, 4, 36), mat(dx, dy + 0.82, dz, Math.PI / 2, 0, 0), { color: WARM, glow: [-0.4, rng.random(), 0.3] });
      addBox(dx, dy, dz, dr * 1.4, 1.6, dr * 1.4, 0, true);
    }
    return { top, x, z, r: R };
  }

  // ------------------------------------------------------------ tower
  function tower(x, z, baseY, H, W, D, rotY = 0, o = {}) {
    const color = o.color ?? pickColor();
    const seed = rng.random();
    const style = o.style ?? rng.pick([1, 3, 3, 2]);
    const density = o.density ?? rng.range(0.45, 0.85);
    const tiers = o.tiers ?? rng.int(1, 3);
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    let y = baseY - 4;
    let w = W;
    let d = D;
    let tierStart = baseY;
    let lastW = W;
    let lastD = D;
    const total = H + 4;
    for (let i = 0; i < tiers; i++) {
      const th = i === tiers - 1 ? baseY + H - y : total * rng.range(0.35, 0.55) * (i === 0 ? 1 : 0.7);
      const cy = y + th / 2;
      F.box(w, th, d, mat(x, cy, z, 0, rotY, 0), { color, baseY, win: [seed, style, density, o.scale ?? 1] });
      addBox(x, cy, z, w, th, d, rotY);
      // ledge
      S.box(w + 0.8, 0.9, d + 0.8, mat(x, y + th, z, 0, rotY, 0), { color: CITY_PALETTE.pearl });
      // corner light strips
      if (o.strips ?? rng.chance(0.4)) {
        const col = stripColor();
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const lx = (sx * (w / 2 + 0.15));
          const lz = (sz * (d / 2 + 0.15));
          const px = x + lx * c + lz * s;
          const pz = z - lx * s + lz * c;
          L.box(0.3, th - 1, 0.3, mat(px, Math.max(cy, baseY + th / 2), pz, 0, rotY, 0), { color: col, glow: [0, 0, 0.3] });
        }
      }
      // slim vertical fins on the base tier of some towers (depth + rhythm up close)
      if (i === 0 && th > 28 && (o.fins ?? rng.chance(0.5))) {
        const finCol = rng.pick([CITY_PALETTE.pearl, CITY_PALETTE.silver, CITY_PALETTE.graphite]);
        for (let face = 0; face < 4; face++) {
          const along = face % 2 === 0 ? w : d;
          const n = Math.floor(along / 3.4);
          for (let k = 1; k < n; k++) {
            const t = -along / 2 + (k * along) / n;
            const lx = face % 2 === 0 ? t : (face === 1 ? 1 : -1) * (w / 2 + 0.2);
            const lz = face % 2 === 0 ? (face === 0 ? 1 : -1) * (d / 2 + 0.2) : t;
            S.box(face % 2 === 0 ? 0.22 : 0.45, th - 4.6, face % 2 === 0 ? 0.45 : 0.22, mat(x + lx * c + lz * s, y + 4 + (th - 4.6) / 2, z - lx * s + lz * c, 0, rotY, 0), { color: finCol });
          }
        }
      }
      y += th;
      tierStart = y;
      lastW = w;
      lastD = d;
      w *= rng.range(0.7, 0.85);
      d *= rng.range(0.7, 0.85);
    }
    // glowing crown band just under the roof (reads as a ring of light at dusk)
    if (o.band ?? rng.chance(0.5)) {
      L.box(lastW + 0.6, 0.42, lastD + 0.6, mat(x, y - 1.5, z, 0, rotY, 0), { color: stripColor(), glow: [0, 0, 0.3] });
    }
    const crown = o.crown || rng.pick(['flat', 'flat', 'spire', 'antenna', 'crown']);
    let top = y;
    if (crown === 'spire') {
      const sh = H * rng.range(0.15, 0.3);
      S.add(new THREE.CylinderGeometry(0.4, Math.min(w, d) * 0.42, sh, 4, 1, false, Math.PI / 4), mat(x, y + sh / 2, z, 0, rotY, 0), { flat: true, color: CITY_PALETTE.white });
      top = y + sh;
      beacon(x, top + 0.5, z);
    } else if (crown === 'antenna') {
      const ah = rng.range(12, 30);
      addBeam(S, new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + ah, z), 0.35, { color: CITY_PALETTE.silver }, 4);
      top = y + ah;
      beacon(x, top + 0.4, z);
    } else if (crown === 'crown') {
      // open crown frame with glow
      const ch = rng.range(6, 14);
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const lx = (sx * w) / 2;
        const lz = (sz * d) / 2;
        const px = x + lx * c + lz * s;
        const pz = z - lx * s + lz * c;
        addBeam(S, new THREE.Vector3(px, y, pz), new THREE.Vector3(x + lx * 0.4 * c + lz * 0.4 * s, y + ch, z - lx * 0.4 * s + lz * 0.4 * c), 0.5, { color: CITY_PALETTE.pearl }, 4);
      }
      L.box(w * 0.45, 0.4, d * 0.45, mat(x, y + ch, z, 0, rotY, 0), { color: stripColor(), glow: [0, 0, 0.4] });
      top = y + ch;
    } else {
      // rooftop plant + small antenna
      S.box(w * 0.4, 3, d * 0.35, mat(x + rng.range(-1, 1), y + 1.5, z, 0, rotY, 0), { color: CITY_PALETTE.steel });
      if (rng.chance(0.5)) {
        addBeam(S, new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + 8, z), 0.2, { color: CITY_PALETTE.silver }, 4);
        beacon(x, y + 8.3, z, 0.5);
      }
    }
    return { top, x, z, r: Math.max(W, D) / 2 };
  }

  // ---------------------------------------------------------- twisted
  function twisted(x, z, baseY, H, R, o = {}) {
    const sides = o.sides || rng.pick([4, 5, 6]);
    const twist = (o.twist ?? rng.range(0.6, 1.4)) * (rng.chance(0.5) ? 1 : -1);
    const g = new THREE.CylinderGeometry(R * 0.78, R, H + 6, sides, 18);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const yy = p.getY(i);
      const t = (yy + (H + 6) / 2) / (H + 6);
      const a = t * twist;
      const px = p.getX(i);
      const pz = p.getZ(i);
      p.setXYZ(i, px * Math.cos(a) - pz * Math.sin(a), yy, px * Math.sin(a) + pz * Math.cos(a));
    }
    const seed = rng.random();
    F.add(g, mat(x, baseY - 6 + (H + 6) / 2, z), {
      flat: true,
      color: o.color ?? rng.pick([CITY_PALETTE.silver, CITY_PALETTE.pearl, CITY_PALETTE.graphite]),
      facade: 'cyl',
      perim: TAU * R * 0.9,
      baseY,
      win: [seed, 3, rng.range(0.45, 0.8), 1.1],
    });
    g.dispose();
    S.add(new THREE.CylinderGeometry(R * 0.5, R * 0.78, 3, sides), mat(x, baseY + H + 1.5, z, 0, twist, 0), { flat: true, color: CITY_PALETTE.pearl });
    addBeam(S, new THREE.Vector3(x, baseY + H, z), new THREE.Vector3(x, baseY + H + 14, z), 0.3, { color: CITY_PALETTE.silver }, 4);
    beacon(x, baseY + H + 14.4, z, 0.6);
    addBox(x, baseY + H / 2, z, R * 1.5, H, R * 1.5);
    return { top: baseY + H + 14, x, z, r: R };
  }

  // ------------------------------------------------------------- dome
  function dome(x, z, baseY, R, o = {}) {
    const drumH = R * 0.22;
    F.add(new THREE.CylinderGeometry(R, R * 1.02, drumH + 4, 32), mat(x, baseY - 4 + (drumH + 4) / 2, z), {
      color: CITY_PALETTE.pearl,
      facade: 'cyl',
      perim: TAU * R,
      baseY,
      win: [rng.random(), 2, 0.8, 1],
    });
    const dg = new THREE.SphereGeometry(R, 32, 12, 0, TAU, 0, Math.PI / 2);
    dg.scale(1, o.squash ?? 0.7, 1);
    F.add(dg, mat(x, baseY + drumH, z), { color: CITY_PALETTE.silver, facade: 'cyl', perim: TAU * R, baseY: baseY + drumH, win: [rng.random(), 3, 0.35, 1.4] });
    dg.dispose();
    // ribs
    const hgt = R * (o.squash ?? 0.7);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      let prev = null;
      for (let j = 0; j <= 6; j++) {
        const t = (j / 6) * (Math.PI / 2);
        const p = new THREE.Vector3(x + Math.sin(a) * Math.cos(t) * R * 1.01, baseY + drumH + Math.sin(t) * hgt * 1.01, z + Math.cos(a) * Math.cos(t) * R * 1.01);
        if (prev) addBeam(S, prev, p, 0.35, { color: CITY_PALETTE.white }, 4);
        prev = p;
      }
    }
    S.add(new THREE.CylinderGeometry(R * 0.12, R * 0.16, R * 0.18, 12), mat(x, baseY + drumH + hgt + R * 0.08, z), { color: CITY_PALETTE.white });
    L.add(new THREE.TorusGeometry(R * 1.01, 0.25, 4, 48), mat(x, baseY + drumH, z, Math.PI / 2, 0, 0), { color: WARM, glow: [0, 0, 0.35] });
    addBox(x, baseY + (drumH + hgt * 0.6) / 2, z, R * 1.5, drumH + hgt * 0.6, R * 1.5);
    return { top: baseY + drumH + hgt, x, z, r: R };
  }

  // --------------------------------------------------------- terraces
  function terraces(x, z, baseY, H, W, D, rotY = 0) {
    const n = rng.int(3, 5);
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const color = rng.pick([CITY_PALETTE.white, CITY_PALETTE.pearl, CITY_PALETTE.champagne]);
    const seed = rng.random();
    let y = baseY - 4;
    let d = D;
    let off = 0;
    for (let i = 0; i < n; i++) {
      const th = (i === 0 ? H / n + 4 : H / n);
      const lz = off;
      const px = x + lz * s;
      const pz = z + lz * c;
      F.box(W, th, d, mat(px, y + th / 2, pz, 0, rotY, 0), { color, baseY, win: [seed, 2, 0.75, 1] });
      addBox(px, y + th / 2, pz, W, th, d, rotY);
      // planter strip on the terrace edge
      const ez = lz - d / 2 + 0.8;
      S.box(W * 0.96, 0.9, 1.4, mat(x + ez * s, y + th + 0.45, z + ez * c, 0, rotY, 0), { color: 0x3f5a2a });
      L.box(W * 0.96, 0.18, 0.18, mat(x + (lz - d / 2 - 0.05) * s, y + th - 0.3, z + (lz - d / 2 - 0.05) * c, 0, rotY, 0), { color: WARM, glow: [0, 0, 0.3] });
      y += th;
      off += d * 0.12;
      d *= 0.76;
    }
    return { top: y, x, z, r: Math.max(W, D) / 2 };
  }

  // ------------------------------------------------------------ block
  function block(x, z, baseY, H, W, D, rotY = 0, o = {}) {
    const color = o.color ?? pickColor();
    F.box(W, H + 4, D, mat(x, baseY - 4 + (H + 4) / 2, z, 0, rotY, 0), { color, baseY, win: [rng.random(), o.style ?? rng.pick([1, 2, 2, 3]), rng.range(0.5, 0.9), 1] });
    S.box(W + 0.4, 1.0, D + 0.4, mat(x, baseY + H + 0.3, z, 0, rotY, 0), { color: CITY_PALETTE.pearl });
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const k = rng.int(0, 2);
    for (let i = 0; i < k; i++) {
      const lx = rng.range(-W / 4, W / 4);
      const lz = rng.range(-D / 4, D / 4);
      S.box(rng.range(3, 7), rng.range(2, 4), rng.range(3, 7), mat(x + lx * c + lz * s, baseY + H + 1.5, z - lx * s + lz * c, 0, rotY, 0), { color: CITY_PALETTE.steel });
    }
    if (rng.chance(0.3)) S.box(W * 0.7, 0.6, D * 0.6, mat(x, baseY + H + 0.9, z, 0, rotY, 0), { color: 0x4a6a32 }); // roof garden
    // ground-floor shop glow
    L.box(W + 0.1, 0.5, D + 0.1, mat(x, baseY + 3.4, z, 0, rotY, 0), { color: WARM, glow: [0, 0, 0.25] });
    addBox(x, baseY + H / 2 - 1, z, W, H + 2, D, rotY);
    return { top: baseY + H, x, z, r: Math.max(W, D) / 2 };
  }

  // -------------------------------------------------------- skybridge
  function skybridge(a, b, y, width = 6) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const rotY = Math.atan2(-dx, -dz);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    F.box(width, 4.2, len, mat(mx, y, mz, 0, rotY, 0), { color: CITY_PALETTE.silver, baseY: y - 2.1, win: [rng.random(), 3, 0.7, 1] });
    L.box(width * 0.9, 0.2, len, mat(mx, y - 2.25, mz, 0, rotY, 0), { color: CYAN, glow: [0, 0, 0.35] });
  }

  return { spire, tower, twisted, dome, terraces, block, skybridge, beacon, pickColor, stripColor };
}
