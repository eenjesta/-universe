import * as THREE from 'three';
import { FLOATING_ISLANDS } from '../layout.js';
import { Rng } from '../../core/math.js';
import { createNoise } from '../../core/noise.js';
import { islandFallPath } from './waterfalls.js';
import { patchFogFragment } from './fog.js';

/**
 * Floating rock islands (FLOATING_ISLANDS): inverted, lumpy, strata-banded
 * rock cones with grassy, slightly domed tops, small conifers and broadleaf
 * trees, hanging roots and vines, and a few loose boulders orbiting the
 * bigger ones. Every vertex carries its island index, so all islands share
 * two merged meshes (rock + turf + trees with flat-shaded canopies; vines)
 * and bob independently via a shared uniform array (uIslandBob), patched
 * into MeshStandardMaterial so they keep PBR lighting, shadows, env map and
 * the atmospheric fog. High up the islands sit above the valley haze, so
 * their material adds a little extra aerial perspective plus warm bounce
 * light from the lit land below — far islands read as soft, hazy rocks
 * against the sky instead of black cut-outs.
 * Islands with `fall: true` export a rim point for a thin waterfall.
 */

const BOB_GLSL_PARS = /* glsl */ `
attribute float aIsland;
uniform float uIslandBob[16];
uniform float uTime;
`;

// aerial perspective for objects hovering above the height fog (fraction, 1/m)
const HAZE_MAX = 0.72;
const HAZE_K = 1 / 1500;

/**
 * Patches a standard material to bob by island index (and sway vines),
 * receive a warm bounce on downward faces and extra distance haze.
 */
function bobify(material, shared, { sway = false } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uIslandBob = shared.uIslandBob;
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uBounce = shared.uIslandBounce;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${BOB_GLSL_PARS}`);
    let body = '';
    if (sway) {
      // hang (stored in uv.y): 0 at the root → 1 at the tip
      body += 'float hang = uv.y; transformed.x += sin( uTime * 0.9 + position.y * 0.3 + aIsland * 3.0 ) * 0.5 * hang * hang; transformed.z += cos( uTime * 0.7 + position.x * 0.2 ) * 0.4 * hang * hang;\n';
    }
    body += 'transformed.y += uIslandBob[ int( aIsland + 0.5 ) ];\n';
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${body}`);
    // bounce light from the sunlit land/lake below onto downward-facing rock
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBounce;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
	{
		vec3 nW = inverseTransformDirection( normal, viewMatrix );
		reflectedLight.indirectDiffuse += diffuseColor.rgb * uBounce * ( 1.0 - smoothstep( -0.8, 0.1, nW.y ) );
	}`,
      );
    patchFogFragment(shader, `fogFactor = max( fogFactor, ${HAZE_MAX.toFixed(3)} * ( 1.0 - exp( - length( vFogWorldDir ) * ${HAZE_K.toFixed(6)} ) ) );`);
  };
  material.customProgramCacheKey = () => `atmo-island${sway ? '-sway' : ''}`;
  return material;
}

const C = (hex) => new THREE.Color(hex);
const GRASS = [C('#5a7a2c'), C('#6f8a34'), C('#4d6a2a'), C('#7f9440')];
const ROCK = [C('#6e5d4e'), C('#5a4b40'), C('#7d6a58'), C('#4a3f37'), C('#857360')];
const MOSS = C('#4f5f2c');

/**
 * Builds one island's rock + top geometry arrays (positions, colours, island
 * index). Underside: an overhanging cap that tapers into an off-centre spike,
 * carved by vertical rock columns (angular noise that hardly changes with
 * height) and lumpy strata; crevices are darkened, moss creeps over the cap.
 * Returns the rim outline and radiusAt/centreAt so roots, vines and streams
 * can be attached to the actual surface.
 */
function buildIsland(isl, index, rng, noise, acc) {
  const R = isl.radius;
  const TAU = Math.PI * 2;
  const seg = Math.max(28, Math.round(R * 1.7));
  const rimR = new Float32Array(seg);
  const cols = new Float32Array(seg);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    rimR[i] = R * (0.86 + 0.2 * (0.5 + 0.5 * noise.fbm2(ca * 1.3 + index * 7, sa * 1.3, 3)));
    const c1 = noise.n2(ca * 2.2 + index * 5.3, sa * 2.2 - index);
    const c2 = noise.n2(ca * 7.5 + index * 1.7, sa * 7.5 + 2.1);
    cols[i] = c1 * 0.12 + Math.sign(c2) * Math.pow(Math.abs(c2), 0.6) * 0.075;
  }
  const depth = R * rng.range(1.6, 2.4);
  const topY = isl.y;
  const tipX = rng.range(-0.22, 0.22) * R;
  const tipZ = rng.range(-0.22, 0.22) * R;
  const phase = rng.range(0, 6);
  const profile = (s) => {
    if (s < 0.1) return 1 + 0.08 * Math.sin((s / 0.1) * Math.PI * 0.5); // overhanging cap
    const t = (s - 0.1) / 0.9;
    return 1.08 * Math.pow(1 - t, 0.82) * (1 - 0.09 * Math.sin(t * Math.PI * 2.6 + phase));
  };
  const radiusAt = (i, s) => {
    const a = (i / seg) * TAU;
    const lump = 1 + 0.13 * noise.fbm2(Math.cos(a) * 2 + index * 3.1, s * 4 + index, 3) + 0.05 * noise.n2(a * 6, s * 11);
    return rimR[i] * profile(s) * lump * (1 + cols[i] * (0.5 + s * 0.8));
  };
  const centreAt = (s) => ({ x: isl.x + tipX * Math.pow(s, 1.5), z: isl.z + tipZ * Math.pow(s, 1.5) });
  const capY = topY - 1.1;
  const rings = 16;
  const base = acc.pos.length / 3;
  const tmp = new THREE.Color();
  // --- underside (rings from the cap down to the tip)
  for (let r = 0; r <= rings; r++) {
    const s = r / rings; // 0 cap → 1 tip
    const y = capY - s * depth;
    const c = centreAt(s);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      const rr = r === rings ? 0.02 : radiusAt(i, s);
      acc.pos.push(c.x + Math.cos(a) * rr, y + noise.n2(a * 3 + index, s * 4) * R * 0.045, c.z + Math.sin(a) * rr);
      // strata bands, crevices between the columns, darker toward the tip, moss on the cap
      const band = Math.floor((topY - y) / (R * 0.16) + noise.n2(a * 2, s * 5) * 0.8);
      tmp.copy(ROCK[((band % ROCK.length) + ROCK.length) % ROCK.length]);
      const crevice = Math.min(1, Math.max(0, -cols[i] * 7));
      tmp.multiplyScalar((1 - s * 0.42) * (1 - crevice * 0.38) + rng.range(-0.04, 0.04));
      if (s < 0.16) tmp.lerp(MOSS, (1 - s / 0.16) * 0.75);
      acc.col.push(tmp.r, tmp.g, tmp.b);
      acc.isl.push(index);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < seg; i++) {
      const a = base + r * seg + i;
      const b = base + r * seg + ((i + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      acc.idx.push(a, b, c, b, d, c); // outward-facing
    }
  }
  // --- grassy top (centre fan + rings), slightly domed and bumpy, with a turf lip
  const topBase = acc.pos.length / 3;
  const topRings = 5;
  acc.pos.push(isl.x, topY + R * 0.06, isl.z);
  tmp.copy(GRASS[index % GRASS.length]);
  acc.col.push(tmp.r, tmp.g, tmp.b);
  acc.isl.push(index);
  for (let r = 1; r <= topRings; r++) {
    const s = r / topRings;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      const lip = r === topRings;
      const rr = rimR[i] * (lip ? 1.1 + cols[i] * 0.5 : s);
      const x = isl.x + Math.cos(a) * rr;
      const z = isl.z + Math.sin(a) * rr;
      const dome = R * 0.06 * (1 - s * s);
      const bump = noise.fbm2(x * 0.08, z * 0.08, 2) * R * 0.03;
      acc.pos.push(x, topY + dome + bump - (lip ? 0.45 : 0), z);
      tmp.copy(GRASS[(i + r) % GRASS.length]).lerp(GRASS[(index + 1) % GRASS.length], 0.5 + 0.5 * noise.n2(x * 0.05, z * 0.05));
      if (lip) tmp.lerp(MOSS, 0.5).multiplyScalar(0.8);
      acc.col.push(tmp.r, tmp.g, tmp.b);
      acc.isl.push(index);
    }
  }
  for (let i = 0; i < seg; i++) acc.idx.push(topBase, topBase + 1 + ((i + 1) % seg), topBase + 1 + i);
  for (let r = 1; r < topRings; r++) {
    for (let i = 0; i < seg; i++) {
      const a = topBase + 1 + (r - 1) * seg + i;
      const b = topBase + 1 + (r - 1) * seg + ((i + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      acc.idx.push(a, b, c, b, d, c);
    }
  }
  // stitch the turf lip down to the rock cap (the dark soil edge)
  const topRim = topBase + 1 + (topRings - 1) * seg;
  for (let i = 0; i < seg; i++) {
    const a = topRim + i;
    const b = topRim + ((i + 1) % seg);
    const c = base + i;
    const d = base + ((i + 1) % seg);
    acc.idx.push(a, b, c, b, d, c);
  }
  return { rimR, seg, depth, capY, radiusAt, centreAt };
}

/** Low-poly boulder (icosahedron, jittered) appended to the rock arrays. */
function addBoulder(acc, x, y, z, r, index, rng) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  const base = acc.pos.length / 3;
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const k = 0.8 + rng.random() * 0.35;
    acc.pos.push(x + p.getX(i) * k, y + p.getY(i) * k * 0.8, z + p.getZ(i) * k);
    tmp.copy(ROCK[i % ROCK.length]).multiplyScalar(0.85);
    acc.col.push(tmp.r, tmp.g, tmp.b);
    acc.isl.push(index);
  }
  const ix = g.index ? g.index.array : [...Array(p.count).keys()];
  for (let i = 0; i < ix.length; i++) acc.idx.push(base + ix[i]);
  g.dispose();
}

export function createIslands(ctx, world, shared, { quality }) {
  const rng = new Rng('atmo-islands');
  const noise = createNoise('atmo-islands');
  const group = new THREE.Group();
  group.name = 'atmo-floating-islands';
  const rock = { pos: [], col: [], isl: [], idx: [] };
  const vines = { pos: [], uv: [], isl: [], idx: [] };
  const trees = []; // {x, y, z, s, kind, island, rot}
  const falls = []; // island streams for waterfalls.js
  const list = FLOATING_ISLANDS.slice(0, 16);
  const meta = [];

  list.forEach((isl, index) => {
    const info = buildIsland(isl, index, rng, noise, rock);
    meta.push({ ...isl, depth: info.depth, phase: rng.range(0, Math.PI * 2), amp: rng.range(0.8, 1.8), speed: rng.range(0.18, 0.3) });
    // loose boulders around bigger islands
    const nb = Math.round(isl.radius / 9);
    for (let i = 0; i < nb; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = isl.radius * rng.range(1.15, 1.7);
      addBoulder(rock, isl.x + Math.cos(a) * d, isl.y - rng.range(isl.radius * 0.3, isl.radius * 1.4), isl.z + Math.sin(a) * d, rng.range(1.2, 3.8), index, rng);
    }
    // trees on top (denser on large islands)
    const nt = Math.round(isl.radius * 0.45 * (quality.treeDensity ?? 1));
    for (let i = 0; i < nt; i++) {
      const a = rng.range(0, Math.PI * 2);
      const k = Math.floor((a / (Math.PI * 2)) * info.seg) % info.seg;
      const d = Math.sqrt(rng.random()) * info.rimR[k] * 0.78;
      const x = isl.x + Math.cos(a) * d;
      const z = isl.z + Math.sin(a) * d;
      const s = 1 - d / isl.radius;
      trees.push({ x, y: isl.y + isl.radius * 0.06 * (1 - (1 - s) * (1 - s)) - 0.2, z, s: rng.range(0.7, 1.35) * Math.min(1.2, isl.radius / 20 + 0.5), kind: rng.random() < 0.55 ? 0 : 1, island: index, rot: rng.range(0, Math.PI * 2) });
    }
    // hanging roots / vines from the underside
    const nv = Math.round(isl.radius * 1.1);
    for (let i = 0; i < nv; i++) {
      const a = rng.range(0, Math.PI * 2);
      const k = Math.floor((a / (Math.PI * 2)) * info.seg) % info.seg;
      const s0 = rng.range(0.0, 0.42);
      const rr = info.radiusAt(k, s0) * 0.97;
      const cc = info.centreAt(s0);
      const x0 = cc.x + Math.cos(a) * rr;
      const z0 = cc.z + Math.sin(a) * rr;
      const y0 = info.capY - s0 * info.depth;
      const len = rng.range(3, 14) * (1 - s0 * 0.6);
      const w = rng.range(0.18, 0.5);
      const segs = 6;
      const vb = vines.pos.length / 3;
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      for (let j = 0; j <= segs; j++) {
        const t = j / segs;
        const y = y0 - t * len;
        const out = Math.sin(t * 2.2) * 0.8;
        const cx = x0 + Math.cos(a) * out;
        const cz = z0 + Math.sin(a) * out;
        const ww = w * (1 - t * 0.7);
        vines.pos.push(cx - tx * ww, y, cz - tz * ww, cx + tx * ww, y, cz + tz * ww);
        vines.uv.push(0, t, 1, t);
        vines.isl.push(index, index);
      }
      for (let j = 0; j < segs; j++) {
        const a0 = vb + j * 2;
        vines.idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
      }
    }
    if (isl.fall) {
      // stream leaves the rim on the side facing the lake/spawn view (south-east-ish)
      const a = Math.atan2(150 - isl.z, 0 - isl.x) + rng.range(-0.5, 0.5);
      const k = Math.floor((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2)) * info.seg) % info.seg;
      const rr = info.rimR[k] * 1.07; // pours over the turf lip
      const start = { x: isl.x + Math.cos(a) * rr, y: isl.y - 0.35, z: isl.z + Math.sin(a) * rr };
      const outward = { x: Math.cos(a), z: Math.sin(a) };
      const length = Math.min(isl.y * 0.75, 110 + isl.radius * 1.5);
      falls.push({ island: index, points: islandFallPath(start, outward, length), width: Math.max(1.8, isl.radius * 0.11), outward });
    }
  });

  // ---- trees: baked into the rock mesh (unshared vertices → flat-shaded canopies)
  bakeTrees(rock, trees, rng);

  // ---- rock + turf + trees (one merged mesh)
  const rockGeo = new THREE.BufferGeometry();
  rockGeo.setAttribute('position', new THREE.Float32BufferAttribute(rock.pos, 3));
  rockGeo.setAttribute('color', new THREE.Float32BufferAttribute(rock.col, 3));
  rockGeo.setAttribute('aIsland', new THREE.Float32BufferAttribute(rock.isl, 1));
  rockGeo.setIndex(rock.idx);
  rockGeo.computeVertexNormals();
  rockGeo.computeBoundingSphere();
  const rockMat = bobify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }), shared);
  rockMat.name = 'AtmoIslandRock';
  const rockMesh = new THREE.Mesh(rockGeo, rockMat);
  rockMesh.name = 'atmo-island-rock';
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  rockMesh.frustumCulled = false; // vertices bob in the shader
  group.add(rockMesh);

  // ---- vines (merged ribbons)
  const vineGeo = new THREE.BufferGeometry();
  vineGeo.setAttribute('position', new THREE.Float32BufferAttribute(vines.pos, 3));
  vineGeo.setAttribute('uv', new THREE.Float32BufferAttribute(vines.uv, 2));
  vineGeo.setAttribute('aIsland', new THREE.Float32BufferAttribute(vines.isl, 1));
  vineGeo.setIndex(vines.idx);
  vineGeo.computeVertexNormals();
  vineGeo.computeBoundingSphere();
  const vineMat = bobify(new THREE.MeshStandardMaterial({ color: 0x3d4a22, roughness: 0.9, side: THREE.DoubleSide }), shared, { sway: true });
  vineMat.name = 'AtmoIslandVines';
  const vineMesh = new THREE.Mesh(vineGeo, vineMat);
  vineMesh.name = 'atmo-island-vines';
  vineMesh.frustumCulled = false;
  group.add(vineMesh);

  // ---- bobbing
  function update(t) {
    const arr = shared.uIslandBob.value;
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i];
      arr[i] = Math.sin(t * m.speed + m.phase) * m.amp + Math.sin(t * m.speed * 2.3 + m.phase * 1.7) * m.amp * 0.25;
    }
  }

  return { group, falls, meta, update, meshes: [rockMesh, vineMesh] };
}

const TRUNK = C('#4a3626');
const PINE = C('#2f4a26');
const LEAF = C('#55702c');

/** Non-indexed position array of a geometry (disposes it). */
function flatPositions(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const arr = g.attributes.position.array.slice();
  if (g !== geo) g.dispose();
  geo.dispose();
  return arr;
}

/**
 * Appends every tree (trunk + conifer tiers or a broadleaf crown) to the
 * merged rock arrays as unshared triangles, so computeVertexNormals() gives
 * them faceted, flat-shaded canopies while the rock stays smooth.
 */
function bakeTrees(acc, trees, rng) {
  const trunk = flatPositions(new THREE.CylinderGeometry(0.18, 0.32, 3.2, 6).translate(0, 1.6, 0));
  const pine = [];
  for (let i = 0; i < 3; i++) pine.push(...flatPositions(new THREE.ConeGeometry(2.2 - i * 0.55, 3.2 - i * 0.4, 7).translate(0, 3.2 + i * 1.7, 0)));
  const leafGeo = new THREE.IcosahedronGeometry(2.3, 1).scale(1, 0.8, 1).translate(0, 4.4, 0);
  const lp = leafGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) lp.setXYZ(i, lp.getX(i) + rng.range(-0.35, 0.35), lp.getY(i) + rng.range(-0.35, 0.35), lp.getZ(i) + rng.range(-0.35, 0.35));
  const leaf = flatPositions(leafGeo);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const push = (arr, color, tint) => {
    const base = acc.pos.length / 3;
    col.copy(color).multiplyScalar(tint);
    for (let i = 0; i < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(m);
      acc.pos.push(v.x, v.y, v.z);
      acc.col.push(col.r, col.g, col.b);
      acc.isl.push(currentIsland);
      acc.idx.push(base + i / 3);
    }
  };
  let currentIsland = 0;
  for (const t of trees) {
    currentIsland = t.island;
    e.set(rng.range(-0.06, 0.06), t.rot, rng.range(-0.06, 0.06));
    q.setFromEuler(e);
    m.compose(pos.set(t.x, t.y, t.z), q, scl.set(t.s, t.s * rng.range(0.9, 1.2), t.s));
    const tint = rng.range(0.8, 1.12);
    push(trunk, TRUNK, tint);
    if (t.kind === 0) push(pine, PINE, tint);
    else push(leaf, LEAF, tint);
  }
}
