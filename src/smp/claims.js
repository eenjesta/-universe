/**
 * Claims: the store (S.CLAIMS / welcome.claims → {id, owner, name, x, z, r})
 * and the in-world boundary — a low "fence of light" following the terrain
 * around every claim near the player (cyan = yours, amber = someone else's),
 * subtle while exploring and brighter while building, plus a preview ring at
 * the ghost while a Claim Beacon is selected in build mode (red when it would
 * overlap another claim). One additive mesh per visible claim (≤ 12 drawn).
 */
import * as THREE from 'three';
import { normClaim, claimAt, claimOverlap, CLAIM_RADIUS } from './logic.js';

const SEG = 128;
const HEIGHT = 1.7;
const MAX_FENCES = 12;
const SHOW_DIST = 240;

const VERT = /* glsl */ `
attribute float aU;
attribute float aV;
varying float vU;
varying float vV;
varying float vDist;
void main() {
  vU = aU;
  vV = aV;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uDashes;
uniform float uSubtle; // 1 while exploring: the light wall only shows from a distance, the ground line stays
varying float vU;
varying float vV;
varying float vDist;
void main() {
  float up = clamp(1.0 - vV, 0.0, 1.0);
  float fade = up * up;
  float dash = step(0.42, fract(vU * uDashes - uTime * 0.12));
  float base = 1.0 - smoothstep(0.0, 0.07, vV);
  float wall = mix(1.0, smoothstep(6.0, 34.0, vDist), uSubtle);
  float a = (fade * mix(0.25, 1.0, dash) * 0.55 * wall + base * 0.85) * uOpacity;
  a *= smoothstep(1.5, 8.0, vDist); // fades out right in front of the camera (walking through the boundary)
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

const MINE = new THREE.Color(0.32, 0.86, 1.0);
const OTHER = new THREE.Color(1.0, 0.56, 0.22);
const BAD = new THREE.Color(1.0, 0.28, 0.24);
const DECAY = new THREE.Color(0.42, 0.4, 0.38); // an absent owner's base fading out (§11.2 claim decay)

class Fence {
  constructor(time) {
    const n = (SEG + 1) * 2;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    const u = new Float32Array(n);
    const v = new Float32Array(n);
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
      u[i * 2] = u[i * 2 + 1] = i / SEG;
      v[i * 2] = 0;
      v[i * 2 + 1] = 1;
      if (i < SEG) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    geo.setAttribute('aV', new THREE.BufferAttribute(v, 1));
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      name: 'smp-claim-fence',
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uTime: time, uDashes: { value: 48 }, uSubtle: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'smp-claim-fence';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.visible = false;
    this.key = '';
    this.claim = null;
  }

  /** Re-projects the ring (cx, cz, r) onto the terrain. */
  shape(cx, cz, r, heightAt) {
    const p = this.pos;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const y = Math.max(heightAt(x, z), 0) + 0.04;
      const k = i * 6;
      p[k] = x;
      p[k + 1] = y;
      p[k + 2] = z;
      p[k + 3] = x;
      p[k + 4] = y + HEIGHT;
      p[k + 5] = z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mat.uniforms.uDashes.value = Math.max(8, Math.round((Math.PI * 2 * r) / 3.2));
  }
}

export function createClaims(ctx, smp) {
  const map = new Map();
  const list = [];
  const root = new THREE.Group();
  root.name = 'smp-claims';
  ctx.world?.scene?.add(root);
  const time = { value: 0 };
  const heightAt = (x, z) => (ctx.world?.getHeightAt ? ctx.world.getHeightAt(x, z) : 0);
  const fences = [];
  const preview = new Fence(time);
  root.add(preview.mesh);
  let version = 0;
  let current = null; // claim the player stands in

  function rebuild() {
    list.length = 0;
    for (const c of map.values()) list.push(c);
    version++;
    smp.events?.emit?.('smp:claims', { count: list.length });
  }

  /** S.CLAIMS {add, remove} or {reset: true, add}. */
  function apply(m = {}) {
    if (m.reset) map.clear();
    for (const id of m.remove || []) map.delete(String(id));
    const me = smp.me();
    const fresh = [];
    for (const raw of m.add || []) {
      const c = normClaim(raw);
      if (!c) continue;
      // a known id is an update (decay level, restored) — only a new claim of mine counts as "claimed"
      if (!m.reset && !map.has(c.id) && me != null && c.owner === me) fresh.push(c);
      map.set(c.id, c);
    }
    rebuild();
    for (const c of fresh) ctx.events.emit('smp:claimed', { id: c.id, x: c.x, z: c.z, r: c.r });
  }

  function reset(arr) {
    apply({ reset: true, add: Array.isArray(arr) ? arr : [] });
  }

  const mine = (c) => c && smp.me() != null && c.owner === smp.me();

  // ------------------------------------------------------------ per frame
  const vis = [];
  function update(dt) {
    time.value += dt;
    const p = ctx.vehicles?.current?.object?.position || ctx.player?.position;
    const building = !!ctx.build?.active;
    const world = ctx.modes?.is?.('explore', 'drive');
    // which claim are we in
    const inClaim = p ? claimAt(list, p.x, p.z) : null;
    if (inClaim !== current) {
      current = inClaim;
      smp.hud?.setClaim?.(inClaim, mine(inClaim));
    }
    // nearest claims get a fence
    vis.length = 0;
    if (p && world && smp.ready) {
      for (const c of list) {
        const d = Math.hypot(c.x - p.x, c.z - p.z) - c.r;
        if (d < SHOW_DIST) vis.push(c);
      }
      if (vis.length > MAX_FENCES) vis.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    }
    for (let k = 0; k < MAX_FENCES; k++) {
      const c = vis[k] || null;
      let f = fences[k];
      if (!c) {
        if (f) f.mesh.visible = false;
        continue;
      }
      if (!f) {
        f = fences[k] = new Fence(time);
        root.add(f.mesh);
      }
      const key = `${c.id}|${c.x}|${c.z}|${c.r}`;
      if (f.key !== key) {
        f.key = key;
        f.shape(c.x, c.z, c.r, heightAt);
      }
      const own = mine(c);
      f.mat.uniforms.uColor.value.copy(own ? MINE : OTHER);
      if (c.decay > 0) f.mat.uniforms.uColor.value.lerp(DECAY, 0.35 + 0.55 * c.decay);
      const inside = c === current;
      f.mat.uniforms.uOpacity.value = (building ? 1.0 : inside ? 0.45 : 0.3) * (1 - 0.4 * (c.decay || 0));
      f.mat.uniforms.uSubtle.value = building ? 0 : 1;
      f.mesh.visible = true;
    }
    // placement preview for a claim beacon
    const tg = ctx.build?.targetRef;
    const sel = building ? ctx.build?.selected?.piece : null; // getter allocates a small object; only while building
    if (building && sel === 'claim-beacon' && tg?.has) {
      const key = `${tg.x.toFixed(1)}|${tg.z.toFixed(1)}`;
      if (preview.key !== key) {
        preview.key = key;
        preview.shape(tg.x, tg.z, CLAIM_RADIUS, heightAt);
      }
      const bad = !tg.valid || !!claimOverlap(list, smp.me(), tg.x, tg.z, CLAIM_RADIUS);
      preview.mat.uniforms.uColor.value.copy(bad ? BAD : MINE);
      preview.mat.uniforms.uOpacity.value = 1.1;
      preview.mat.uniforms.uSubtle.value = 0;
      preview.mesh.visible = true;
    } else preview.mesh.visible = false;
  }

  return {
    map,
    list,
    apply,
    reset,
    update,
    get version() {
      return version;
    },
    get current() {
      return current;
    },
    at: (x, z) => claimAt(list, x, z),
    mine,
    root,
  };
}
