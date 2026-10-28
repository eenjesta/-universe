/**
 * Harvestable resource nodes scattered around the base, the hills and the
 * ruins (deterministic, never in water, on roads, in protected landmark areas
 * or on the build plot): metal ore veins (dark rock with bluish crystals),
 * stone boulders, wood piles and glowing cyan energy crystals.
 *
 * Hold [E] (ctx.interactions, hold) → resources (state.gain), `harvest`
 * {resource, amount, source: 'node'}, stats.harvested, audio 'harvest', a
 * cyan progress ring on the ground while holding, a floating "+7 Metal" and
 * a shrink; nodes respawn after 2.5–4 minutes with a grow-in.
 * Rendering: one InstancedMesh per node type × material part.
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { Rng } from '../core/math.js';
import { t } from '../core/i18n.js';
import { GeoBuilder, rockGeometry } from './geo.js';
import { REVEAL_DONE } from './materials.js';
import { protectedAt, roadClearance } from './placement.js';
import { RESOURCES } from './catalog.js';

const TYPES = {
  metal: {
    resource: 'metal',
    amount: [6, 9],
    hold: 1.6,
    label: { en: 'Mine metal ore', nl: 'Metaalerts delven' },
  },
  stone: {
    resource: 'stone',
    amount: [8, 12],
    hold: 1.4,
    label: { en: 'Quarry stone', nl: 'Steen hakken' },
  },
  wood: {
    resource: 'wood',
    amount: [8, 12],
    hold: 1.4,
    label: { en: 'Gather wood', nl: 'Hout verzamelen' },
  },
  energy: {
    resource: 'energy',
    amount: [5, 8],
    hold: 1.8,
    label: { en: 'Harvest energy crystal', nl: 'Energiekristal oogsten' },
  },
};

const REGIONS = [
  { x: -228, z: 330, rMin: 34, rMax: 86, n: 13, mix: ['wood', 'wood', 'wood', 'wood', 'stone', 'stone', 'stone', 'metal', 'metal', 'metal', 'energy', 'energy', 'wood'] },
  { x: -140, z: 248, rMin: 6, rMax: 46, n: 5, mix: ['wood', 'stone', 'wood', 'metal', 'stone'] },
  { x: -280, z: 30, rMin: 16, rMax: 64, n: 7, mix: ['stone', 'metal', 'stone', 'metal', 'energy', 'stone', 'metal'] },
  { x: 70, z: 215, rMin: 24, rMax: 72, n: 6, mix: ['stone', 'metal', 'wood', 'stone', 'wood', 'metal'] },
  { x: 250, z: 95, rMin: 46, rMax: 84, n: 9, mix: ['stone', 'metal', 'energy', 'stone', 'metal', 'energy', 'stone', 'metal', 'energy'] },
];

// ---------------------------------------------------------------- geometry
function nodeGeometry(type) {
  const rng = new Rng(`node-${type}`);
  const parts = {};
  const B = (k) => parts[k] || (parts[k] = new GeoBuilder());
  if (type === 'metal') {
    for (let i = 0; i < 3; i++) {
      const g = rockGeometry(0.75 - i * 0.15, 1, rng, { squash: 0.62, jag: 0.25 });
      B('rock').geo(g, (i - 1) * 0.55, 0.22 - i * 0.05, rng.range(-0.3, 0.3), { color: rng.pick([0x3b4048, 0x30353d, 0x454a52]), ry: rng.random() * 3 });
      g.dispose();
    }
    for (let i = 0; i < 9; i++) {
      const g = new THREE.OctahedronGeometry(0.22, 0);
      const a = rng.random() * Math.PI * 2;
      const r = rng.range(0.15, 0.6);
      B('crystal').geo(g, Math.cos(a) * r, rng.range(0.35, 0.6), Math.sin(a) * r, { sx: 0.55, sy: rng.range(1.6, 2.6), sz: 0.55, rx: rng.range(-0.6, 0.6), rz: rng.range(-0.6, 0.6), color: rng.pick([0x4f8dff, 0x6aa4ff, 0x3a76e0]), intensity: 0.8 });
      g.dispose();
    }
    const glow = new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2);
    B('pool').geo(glow, 0, 0.12, 0, { uv: 'keep', color: 0x4f8dff, intensity: 0.7 });
    glow.dispose();
  } else if (type === 'stone') {
    const g1 = rockGeometry(1.0, 1, rng, { squash: 0.72, jag: 0.18 });
    B('rock').geo(g1, 0, 0.42, 0, { color: 0xa39c90, ry: 0.4 });
    g1.dispose();
    const g2 = rockGeometry(0.62, 1, rng, { squash: 0.7, jag: 0.2 });
    B('rock').geo(g2, 0.95, 0.18, 0.35, { color: 0x938c80, ry: 1.3 });
    g2.dispose();
    const g3 = rockGeometry(0.42, 0, rng, { squash: 0.6, jag: 0.25 });
    B('rock').geo(g3, -0.85, 0.1, -0.4, { color: 0xb2ab9e, ry: 2.1 });
    g3.dispose();
    // split slab with fresh (lighter) cut faces
    B('rock').box(0.9, 0.18, 0.6, -0.2, 0.09, 0.85, { color: 0xc8c1b4, ry: 0.5 });
  } else if (type === 'wood') {
    const logs = [
      [-0.32, 0.22, 0],
      [0.32, 0.22, 0.05],
      [0, 0.6, 0.02],
    ];
    for (const [x, y, z] of logs) {
      const len = rng.range(2.2, 2.6);
      B('bark').cyl(0.22, 0.24, len, x, y, z, { seg: 10, rz: Math.PI / 2, ry: Math.PI / 2 + rng.range(-0.08, 0.08), color: 0x7a5a40 });
      for (const s of [-1, 1]) B('wood').cyl(0.2, 0.2, 0.03, x, y, z + (s * len) / 2, { seg: 10, rx: Math.PI / 2, color: 0xd8b084 });
    }
    // a fallen branch
    B('bark').beam([0.6, 0.12, -0.9], [-0.7, 0.08, -0.5], 0.12, { color: 0x6a4a32 });
  } else if (type === 'energy') {
    const g = rockGeometry(0.7, 1, rng, { squash: 0.5, jag: 0.22 });
    B('rock').geo(g, 0, 0.12, 0, { color: 0x2e3238 });
    g.dispose();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const r = i === 0 ? 0 : rng.range(0.18, 0.42);
      const h = i === 0 ? 1.9 : rng.range(0.8, 1.4);
      const w = i === 0 ? 0.2 : rng.range(0.1, 0.16);
      const lean = i === 0 ? 0 : 0.35;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const rx = Math.sin(a) * lean;
      const rz = -Math.cos(a) * lean;
      const body = new THREE.CylinderGeometry(w, w * 1.1, h * 0.78, 6).translate(0, (h * 0.78) / 2, 0);
      const tip = new THREE.CylinderGeometry(0, w, h * 0.22, 6).translate(0, h * 0.78 + (h * 0.22) / 2, 0);
      const c = i === 0 ? { color: 0x5fe0ff, intensity: 1.25 } : { color: 0x2fc4ff, intensity: 1.0 };
      B('crystal').geo(body, x, 0.15, z, { rx, rz, ...c });
      B('crystal').geo(tip, x, 0.15, z, { rx, rz, ...c });
      body.dispose();
      tip.dispose();
    }
    // cyan light pool on the ground (night only, additive)
    const glow = new THREE.PlaneGeometry(3.8, 3.8).rotateX(-Math.PI / 2);
    B('pool').geo(glow, 0, 0.14, 0, { uv: 'keep', color: 0x38d2ff, intensity: 1.3 });
    glow.dispose();
  }
  const out = [];
  for (const [k, b] of Object.entries(parts)) out.push({ mat: k === 'crystal' ? 'neon' : k, geometry: k === 'crystal' ? shadeCrystals(b.build()) : b.build() });
  return out;
}

/**
 * Fake facet lighting baked into the vertex colours of the unlit crystal
 * material: lit / unlit facets and brighter tips, so crystals read as faceted
 * gems instead of flat cut-outs (factor 0.45…1.35, finite).
 */
function shadeCrystals(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const col = geo.attributes.color;
  if (!pos || !nor || !col) return geo;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxY - minY, 1e-3);
  for (let i = 0; i < pos.count; i++) {
    const lit = 0.5 + 0.5 * (nor.getX(i) * 0.42 + nor.getY(i) * 0.72 + nor.getZ(i) * 0.55);
    const up = (pos.getY(i) - minY) / span;
    const f = 0.45 + 0.55 * lit * lit + 0.35 * up;
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
  col.needsUpdate = true;
  return geo;
}

const RING_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const RING_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uBurst;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vXZ;
void main() {
  float r = length(vXZ);
  float ang = r > 0.001 ? atan(vXZ.x, -vXZ.y) / 6.2831853 + 0.5 : 0.0;
  float band = 1.0 - smoothstep(0.0, 0.07, abs(r - 1.2));
  float fill = step(ang, uProgress);
  float track = 0.22 + 0.08 * sin(uTime * 4.0 + ang * 25.0);
  float head = (1.0 - smoothstep(0.0, 0.025, abs(ang - uProgress))) * step(0.001, uProgress);
  float burst = uBurst > 0.0 ? (1.0 - smoothstep(0.0, 0.1, abs(r - (1.2 + (1.0 - uBurst) * 1.8)))) * uBurst : 0.0;
  float a = band * (track + fill * 1.2 + head * 2.0) * (1.0 - uBurst) + burst * 1.6;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

export function createHarvest(ctx, mats) {
  const { world, state, events, ui } = ctx;
  const root = new THREE.Group();
  root.name = 'build-nodes';
  const nodes = [];
  const sets = {};
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpP = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const rng = new Rng('build-nodes');
  const H = (x, z) => (world?.getHeightAt ? world.getHeightAt(x, z) : 0);
  const BA = ZONES.base.buildArea;
  const nrm = new THREE.Vector3();
  const qList = [];

  // ------------------------------------------------------------ placement
  function okSpot(x, z) {
    const h = H(x, z);
    if (h < 1.5 || world?.isWater?.(x, z)) return false;
    if (world?.getNormalAt) {
      world.getNormalAt(x, z, nrm);
      if (nrm.y < 0.84) return false;
    }
    if (roadClearance(x, z) < 3.5) return false;
    if (protectedAt(x, z, 4)) return false;
    if (Math.abs(x - BA.x) < BA.size / 2 + 5 && Math.abs(z - BA.z) < BA.size / 2 + 5) return false;
    for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < 8) return false;
    if (ctx.physics?.queryRect) {
      qList.length = 0;
      ctx.physics.queryRect(x - 2.5, z - 2.5, x + 2.5, z + 2.5, qList);
      for (const b of qList) if (b.tag !== 'terrain-tree' && b.tag !== 'terrain-rock') return false;
    }
    return true;
  }

  for (const R of REGIONS) {
    let placed = 0;
    for (let tries = 0; tries < R.n * 40 && placed < R.n; tries++) {
      const a = rng.random() * Math.PI * 2;
      const r = R.rMin + Math.sqrt(rng.random()) * (R.rMax - R.rMin);
      const x = R.x + Math.cos(a) * r;
      const z = R.z + Math.sin(a) * r;
      if (!okSpot(x, z)) continue;
      const type = R.mix[placed % R.mix.length];
      const def = TYPES[type];
      nodes.push({
        id: `bld-node-${nodes.length}`,
        type,
        def,
        x,
        z,
        y: H(x, z),
        rotY: rng.random() * Math.PI * 2,
        scale: rng.range(0.85, 1.2),
        available: true,
        respawnAt: 0,
        anim: 0, // 0 idle, >0 grow-in progress, <0 shrink progress
        set: null,
        index: -1,
        pos: new THREE.Vector3(),
      });
      placed++;
    }
  }

  // ------------------------------------------------------------ rendering
  for (const type of Object.keys(TYPES)) {
    const list = nodes.filter((n) => n.type === type);
    if (!list.length) continue;
    const parts = nodeGeometry(type).map((p) => {
      const reveal = new THREE.InstancedBufferAttribute(new Float32Array(list.length).fill(REVEAL_DONE), 1);
      p.geometry.setAttribute('aReveal', reveal);
      const mesh = new THREE.InstancedMesh(p.geometry, mats[p.mat], list.length);
      mesh.name = `build-node-${type}-${p.mat}`;
      const lit = p.mat !== 'neon' && p.mat !== 'pool';
      mesh.castShadow = lit;
      mesh.receiveShadow = lit;
      if (p.mat === 'pool') mesh.renderOrder = 2;
      root.add(mesh);
      return { mat: p.mat, mesh };
    });
    sets[type] = { parts, list };
    list.forEach((n, i) => {
      n.set = sets[type];
      n.index = i;
      n.pos.set(n.x, n.y + 0.8, n.z);
      writeMatrix(n, n.scale, 0);
    });
    for (const p of parts) p.mesh.computeBoundingSphere();
  }

  function writeMatrix(n, s, wobble) {
    tmpE.set(wobble * 0.6, n.rotY + wobble, wobble * 0.4);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(n.x, n.y - 0.05, n.z), tmpQ, tmpS.setScalar(Math.max(s, 0.0001)));
    for (const p of n.set.parts) {
      p.mesh.setMatrixAt(n.index, tmpM);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // clear trees / rocks under the nodes
  for (const n of nodes) {
    try {
      world?.vegetation?.clearArea?.(n.x, n.z, 2.4);
    } catch {
      /* optional */
    }
  }

  // ------------------------------------------------------------ progress ring
  const ringMat = new THREE.ShaderMaterial({
    name: 'bld-harvest-ring',
    uniforms: { uProgress: { value: 0 }, uBurst: { value: 0 }, uTime: mats.U.uTime, uColor: { value: new THREE.Color(0.35, 0.85, 1.0) } },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4).rotateX(-Math.PI / 2), ringMat);
  ring.name = 'build-harvest-ring';
  ring.renderOrder = 18;
  ring.visible = false;
  root.add(ring);
  let burst = 0;

  // ------------------------------------------------------------ floating text
  const floats = [];
  const projV = new THREE.Vector3();
  function floatText(n, amount) {
    const res = RESOURCES.find((r) => r.id === n.def.resource);
    let f = floats.find((x) => !x.busy);
    if (!f) {
      const el = ui.h('div', { class: 'build-float' });
      ui.layers.hud.appendChild(el);
      f = { el, busy: false, t: 0, pos: new THREE.Vector3() };
      floats.push(f);
    }
    f.busy = true;
    f.t = 0;
    f.pos.set(n.x, n.y + 1.6, n.z);
    f.el.innerHTML = '';
    f.el.append(
      ui.h('span', { class: 'build-float-icon', html: ui.icon(res?.icon || 'metal', 18), style: { color: res?.color || '#7fe0ff' } }),
      ui.h('span', { class: 'build-float-text', text: `+${amount} ${t(res?.name || { en: '' })}` }),
    );
    f.el.style.opacity = '0';
    f.el.hidden = false;
  }

  function updateFloats(dt, camera) {
    for (const f of floats) {
      if (!f.busy) continue;
      f.t += dt;
      const k = f.t / 1.7;
      if (k >= 1) {
        f.busy = false;
        f.el.hidden = true;
        continue;
      }
      projV.copy(f.pos);
      projV.y += k * 1.3;
      projV.project(camera);
      if (projV.z < -1 || projV.z > 1) {
        f.el.style.opacity = '0';
        continue;
      }
      const x = (projV.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-projV.y * 0.5 + 0.5) * window.innerHeight;
      f.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) scale(${(0.9 + Math.min(1, k * 6) * 0.1).toFixed(3)})`;
      f.el.style.opacity = String(Math.min(1, k * 8) * (1 - Math.max(0, (k - 0.6) / 0.4)));
    }
  }

  // ------------------------------------------------------------ interactions
  function harvest(n) {
    if (!n.available) return null;
    const [a0, a1] = n.def.amount;
    const amount = a0 + Math.floor(Math.random() * (a1 - a0 + 1));
    state.gain({ [n.def.resource]: amount });
    state.add('stats.harvested', 1);
    n.available = false;
    n.anim = -0.0001;
    n.respawnAt = ctx.loop.time + 150 + Math.random() * 90;
    burst = 1;
    ring.position.set(n.x, n.y + 0.08, n.z);
    ring.visible = true;
    ctx.audio?.play?.('harvest', { position: n.pos });
    floatText(n, amount);
    events.emit('harvest', { resource: n.def.resource, amount, source: 'node', node: n.id, position: { x: n.x, y: n.y, z: n.z } });
    return amount;
  }

  for (const n of nodes) {
    ctx.interactions?.add?.({
      id: n.id,
      scope: 'world',
      position: n.pos,
      radius: 3.4,
      label: t(n.def.label),
      hold: n.def.hold,
      priority: 1,
      enabled: () => n.available,
      onInteract: () => harvest(n),
    });
  }

  // ------------------------------------------------------------ per frame
  let wob = 0;
  function update(dt, time) {
    const I = ctx.interactions;
    const cur = I?.current;
    let active = null;
    if (cur && typeof cur.id === 'string' && cur.id.startsWith('bld-node-')) active = nodes[+cur.id.slice(9)] || null;
    const progress = active && cur.hold > 0 ? Math.min(1, I.holdTime / cur.hold) : 0;
    if (burst > 0) {
      burst = Math.max(0, burst - dt * 2.2);
      ringMat.uniforms.uBurst.value = burst;
      ringMat.uniforms.uProgress.value = 1;
      if (burst <= 0) ring.visible = false;
    } else if (active) {
      ring.visible = true;
      ring.position.set(active.x, active.y + 0.08, active.z);
      ringMat.uniforms.uProgress.value = progress;
      ringMat.uniforms.uBurst.value = 0;
    } else ring.visible = false;
    // wobble the node being harvested
    if (active && progress > 0) {
      wob += dt * 40;
      writeMatrix(active, active.scale, Math.sin(wob) * 0.03 * progress);
      active._wob = true;
    } else {
      for (const n of nodes) {
        if (n._wob && n.available && n.anim === 0) {
          writeMatrix(n, n.scale, 0);
          n._wob = false;
        }
      }
    }
    // shrink / respawn / grow-in
    for (const n of nodes) {
      if (n.anim < 0) {
        n.anim -= dt / 0.35;
        const k = Math.max(0, 1 + n.anim);
        writeMatrix(n, n.scale * k * (1 + (1 - k) * 0.25), 0);
        if (k <= 0) {
          n.anim = 0;
          writeMatrix(n, 0, 0);
        }
      } else if (n.anim > 0) {
        n.anim += dt / 1.4;
        const k = Math.min(1, n.anim);
        const e = 1 - Math.pow(1 - k, 3);
        writeMatrix(n, n.scale * e, 0);
        if (k >= 1) n.anim = 0;
      } else if (!n.available && time >= n.respawnAt) {
        n.available = true;
        n.anim = 0.0001;
      }
    }
    updateFloats(dt, ctx.engine?.camera || ctx.camera);
  }

  function dispose() {
    for (const n of nodes) ctx.interactions?.remove?.(n.id);
    for (const s of Object.values(sets)) for (const p of s.parts) p.mesh.dispose();
    ring.geometry.dispose();
    ringMat.dispose();
    for (const f of floats) f.el.remove();
  }

  return { root, nodes, harvest, update, dispose, types: TYPES };
}
