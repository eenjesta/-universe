/**
 * World-event visuals (created lazily, added to ctx.world.scene):
 *  - SkyStreaks: instanced additive meteor streaks (one draw call), billboarded
 *    around their velocity axis; "impact" streaks fly to a ground point.
 *  - Fragments: glowing meteorite impact sites — instanced dark rocks with hot
 *    cracks + cyan crystals, soft glow points and light beams (4 draw calls).
 *  - Impact flash + shock ring (reused).
 *  - EchoPillar: tall cyan light column + pulsing ground rings.
 *  - Sparkles: falling festival star-dust around the plaza tree (one Points).
 * No per-frame allocations; everything is hidden when idle.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../core/math.js';

// ====================================================================== streaks
const STREAK_VS = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const STREAK_FS = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = vUv.x;                         // 0 = tail, 1 = head
    float d = abs(vUv.y - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.0, 1.0, d);
    core *= core;
    float tail = pow(a, 2.6);
    float head = smoothstep(0.86, 1.0, a);
    vec3 col = vColor * (tail * 1.8 + head * 2.6) + vec3(1.0, 0.96, 0.9) * head * core * 3.2;
    float alpha = core * (tail + head * 0.8) * vAlpha;
    gl_FragColor = vec4(col, alpha);
  }
`;

export class SkyStreaks {
  constructor(scene, max = 56) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.color.setUsage(THREE.DynamicDrawUsage);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aColor', this.color);
    geo.setAttribute('aAlpha', this.alpha);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: STREAK_VS,
      fragmentShader: STREAK_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'sys-sky-streaks';
    this.mesh.visible = false;
    scene.add(this.mesh);
    // per-streak state
    this.p0 = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max).fill(-1);
    this.len = new Float32Array(max);
    this.wid = new Float32Array(max);
    this.impact = new Int8Array(max); // 1 = travels to a ground point
    this.onImpact = null;
    this.modes = new Set(); // active emitters: 'meteors' | 'festival'
    this.rates = { meteors: 7, festival: 3.2 };
    this.acc = 0;
    this.focus = new THREE.Vector3(); // festival spawn centre
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
    this._h = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._c = new THREE.Color();
    this.rnd = mulberry32(0x5eed);
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.zero);
  }

  _slot() {
    for (let i = 0; i < this.max; i++) if (this.life[i] < 0) return i;
    return -1;
  }

  _spawn(cam, palette, around) {
    const i = this._slot();
    if (i < 0) return;
    const r = this.rnd;
    const ang = r() * Math.PI * 2;
    const dist = around ? 80 + r() * 260 : 250 + r() * 1300;
    const cx = around ? this.focus.x : cam.x;
    const cz = around ? this.focus.z : cam.z;
    const alt = around ? 220 + r() * 260 : 380 + r() * 520;
    this.p0[i * 3] = cx + Math.cos(ang) * dist;
    this.p0[i * 3 + 1] = alt;
    this.p0[i * 3 + 2] = cz + Math.sin(ang) * dist;
    // shower radiant: falling toward the south-east with jitter
    const dx = 0.62 + (r() - 0.5) * 0.5;
    const dy = -0.32 - r() * 0.22;
    const dz = 0.7 + (r() - 0.5) * 0.5;
    const n = Math.hypot(dx, dy, dz);
    const speed = around ? 140 + r() * 120 : 280 + r() * 320;
    this.vel[i * 3] = (dx / n) * speed;
    this.vel[i * 3 + 1] = (dy / n) * speed;
    this.vel[i * 3 + 2] = (dz / n) * speed;
    this.age[i] = 0;
    this.life[i] = around ? 0.9 + r() * 1.1 : 0.5 + r() * 1.0;
    this.len[i] = around ? 40 + r() * 60 : 70 + r() * 150;
    this.wid[i] = around ? 1.2 + r() * 1.4 : 1.6 + r() * 2.4;
    this.impact[i] = 0;
    this._c.set(palette[Math.floor(r() * palette.length)]);
    this.color.setXYZ(i, this._c.r, this._c.g, this._c.b);
  }

  /** A large meteor that flies to `target` in `travel` seconds, then calls onImpact(target). */
  launchImpact(target, travel = 2.4) {
    const i = this._slot();
    if (i < 0) return false;
    const r = this.rnd;
    const dir = this._t.set(0.45 + r() * 0.2, -0.82, 0.32 + r() * 0.2).normalize();
    const dist = 950;
    this.p0[i * 3] = target.x - dir.x * dist;
    this.p0[i * 3 + 1] = target.y - dir.y * dist;
    this.p0[i * 3 + 2] = target.z - dir.z * dist;
    const speed = dist / travel;
    this.vel[i * 3] = dir.x * speed;
    this.vel[i * 3 + 1] = dir.y * speed;
    this.vel[i * 3 + 2] = dir.z * speed;
    this.age[i] = 0;
    this.life[i] = travel;
    this.len[i] = 160;
    this.wid[i] = 7;
    this.impact[i] = 1;
    this._c.set('#ff9a4a');
    this.color.setXYZ(i, this._c.r, this._c.g, this._c.b);
    this.mesh.visible = true;
    return true;
  }

  update(dt, camera) {
    // idle (no emitter, every streak gone): nothing to simulate or upload
    if (!this.modes.size && !this.mesh.visible) return;
    const cam = camera.position;
    for (const m of this.modes) {
      const rate = this.rates[m] || 4;
      this.acc += dt * rate;
      while (this.acc >= 1) {
        this.acc -= 1;
        if (m === 'festival') this._spawn(cam, ['#c9a8ff', '#8fe9ff', '#ffd9a0', '#ffffff'], true);
        else this._spawn(cam, ['#ffd7a0', '#ffb36b', '#bfe9ff', '#ffffff'], false);
      }
    }
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] < 0) continue;
      this.age[i] += dt;
      const t = this.age[i];
      if (t >= this.life[i]) {
        if (this.impact[i] && this.onImpact) {
          this._t.set(this.p0[i * 3] + this.vel[i * 3] * this.life[i], this.p0[i * 3 + 1] + this.vel[i * 3 + 1] * this.life[i], this.p0[i * 3 + 2] + this.vel[i * 3 + 2] * this.life[i]);
          this.onImpact(this._t);
        }
        this.life[i] = -1;
        this.alpha.setX(i, 0);
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      any = true;
      const h = this._h.set(this.p0[i * 3] + this.vel[i * 3] * t, this.p0[i * 3 + 1] + this.vel[i * 3 + 1] * t, this.p0[i * 3 + 2] + this.vel[i * 3 + 2] * t);
      const dir = this._x.set(this.vel[i * 3], this.vel[i * 3 + 1], this.vel[i * 3 + 2]).normalize();
      // grow in over the first 15% so it doesn't pop, fade out at the end
      const k = t / this.life[i];
      const fade = this.impact[i] ? Math.min(1, t * 3) : Math.min(1, k * 6) * Math.min(1, (1 - k) * 3);
      const len = this.len[i] * Math.min(1, 0.25 + k * 4);
      const tail = this._t.copy(h).addScaledVector(dir, -len);
      const side = this._y.copy(cam).sub(h).cross(dir).normalize().multiplyScalar(this.wid[i]);
      const z = this._z.copy(dir).cross(side).normalize();
      dir.multiplyScalar(len);
      this._m.makeBasis(dir, side, z).setPosition(tail);
      this.mesh.setMatrixAt(i, this._m);
      this.alpha.setX(i, fade);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.color.needsUpdate = true;
    this.mesh.visible = any || this.modes.size > 0;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ====================================================================== impact sites
function crackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  const r = mulberry32(42);
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  for (let k = 0; k < 14; k++) {
    let x = r() * 128;
    let y = r() * 128;
    g.lineWidth = 0.8 + r() * 2.2;
    g.globalAlpha = 0.5 + r() * 0.5;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (r() - 0.5) * 30;
      y += (r() - 0.5) * 30;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function rockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const r = mulberry32(7);
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, 0.72 + r() * 0.5);
    const s = map.get(key);
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.78, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}

const GLOW_VS = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  varying vec3 vColor;
  varying float vPulse;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // softer when the camera is right on top of a fragment (harvesting); sprite size clamped
    vPulse = (0.72 + 0.28 * sin(uTime * 2.6 + aPhase)) * mix(0.35, 1.0, smoothstep(1.5, 6.0, -mv.z));
    gl_PointSize = min(150.0, aSize * vPulse * (420.0 / max(1.0, -mv.z)));
    gl_Position = projectionMatrix * mv;
  }
`;
const GLOW_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vPulse;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.2);
    gl_FragColor = vec4(vColor * (1.4 + vPulse), a * vPulse);
  }
`;

const BEAM_VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const BEAM_FS = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float fade = pow(1.0 - vUv.y, 1.6);
    float bands = 0.65 + 0.35 * sin(vUv.y * 40.0 - uTime * 3.0);
    float edge = 0.55 + 0.45 * sin(vUv.x * 6.2831 * 3.0 + uTime * 0.7);
    float a = fade * bands * edge * 0.42 * uIntensity;
    gl_FragColor = vec4(uColor * 1.8, a);
  }
`;

export class Fragments {
  constructor(scene, maxSites = 5) {
    this.maxSites = maxSites;
    this.rocksPer = 5;
    this.crystalsPer = 4;
    this.sites = []; // {id, pos, active, t, seed}
    const tex = crackTexture();
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2421, roughness: 0.82, metalness: 0.15, emissive: 0xff6a22, emissiveIntensity: 2.4, emissiveMap: tex });
    this.crystalMat = new THREE.MeshStandardMaterial({ color: 0xbff4ff, roughness: 0.18, metalness: 0.05, emissive: 0x46cfff, emissiveIntensity: 2.8 });
    this.rocks = new THREE.InstancedMesh(rockGeometry(), this.rockMat, maxSites * this.rocksPer);
    this.crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), this.crystalMat, maxSites * this.crystalsPer);
    for (const m of [this.rocks, this.crystals]) {
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.visible = false;
      scene.add(m);
    }
    // glow points (one per crystal cluster + one per site)
    const nGlow = maxSites * 3;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nGlow * 3), 3));
    gg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(nGlow), 1));
    gg.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(nGlow), 1));
    gg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(nGlow * 3), 3));
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: GLOW_VS,
      fragmentShader: GLOW_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Points(gg, this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.visible = false;
    scene.add(this.glow);
    // light beams
    // slim loot beacon: readable from far away without walling off the view up close
    const bg = new THREE.CylinderGeometry(0.28, 0.6, 1, 16, 1, true).translate(0, 0.5, 0);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffb36b') }, uIntensity: { value: 1 } },
      vertexShader: BEAM_VS,
      fragmentShader: BEAM_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beams = new THREE.InstancedMesh(bg, this.beamMat, maxSites);
    this.beams.frustumCulled = false;
    this.beams.visible = false;
    scene.add(this.beams);
    // flash + shock ring
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.flash.visible = this.ring.visible = false;
    this.flash.frustumCulled = this.ring.frustumCulled = false;
    scene.add(this.flash, this.ring);
    this.fx = { t: -1, pos: new THREE.Vector3() };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.rocks.count; i++) this.rocks.setMatrixAt(i, this.zero);
    for (let i = 0; i < this.crystals.count; i++) this.crystals.setMatrixAt(i, this.zero);
    for (let i = 0; i < maxSites; i++) this.beams.setMatrixAt(i, this.zero);
    this.nextId = 1;
  }

  get activeSites() {
    return this.sites.filter((s) => s.active);
  }

  /** Adds an impact site at `pos` (ground point); returns the site or null when full. */
  add(pos, groundAt) {
    let slot = this.sites.findIndex((s) => !s.active);
    if (slot < 0) {
      if (this.sites.length >= this.maxSites) return null;
      slot = this.sites.length;
      this.sites.push({});
    }
    const site = { id: this.nextId++, slot, pos: pos.clone(), active: true, t: 0, seed: Math.random() * 1000 };
    this.sites[slot] = site;
    this._build(site, groundAt);
    this.flashAt(pos);
    return site;
  }

  _build(site, groundAt) {
    const r = mulberry32(Math.floor(site.seed * 1000));
    const { slot, pos } = site;
    for (let k = 0; k < this.rocksPer; k++) {
      const a = r() * Math.PI * 2;
      const d = k === 0 ? 0 : 0.8 + r() * 1.8;
      const x = pos.x + Math.cos(a) * d;
      const z = pos.z + Math.sin(a) * d;
      const s = k === 0 ? 0.9 + r() * 0.3 : 0.25 + r() * 0.35;
      const y = (groundAt ? groundAt(x, z) : pos.y) + s * 0.35;
      this._e.set(r() * 3, r() * 3, r() * 3);
      this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(x, y, z), this._q, this._s.set(s, s, s));
      this.rocks.setMatrixAt(slot * this.rocksPer + k, this._m);
    }
    const gp = this.glow.geometry.attributes;
    for (let k = 0; k < this.crystalsPer; k++) {
      const a = (k / this.crystalsPer) * Math.PI * 2 + r();
      const d = 0.45 + r() * 0.6;
      const x = pos.x + Math.cos(a) * d;
      const z = pos.z + Math.sin(a) * d;
      const h = 0.35 + r() * 0.45;
      const y = (groundAt ? groundAt(x, z) : pos.y) + h * 0.6 + 0.3;
      this._e.set((r() - 0.5) * 0.9, r() * 3, (r() - 0.5) * 0.9);
      this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(x, y, z), this._q, this._s.set(h * 0.28, h, h * 0.28));
      this.crystals.setMatrixAt(slot * this.crystalsPer + k, this._m);
    }
    for (let k = 0; k < 3; k++) {
      const gi = slot * 3 + k;
      gp.position.setXYZ(gi, pos.x + (k - 1) * 0.6, pos.y + 0.6 + k * 0.15, pos.z + (k - 1) * 0.4);
      gp.aSize.setX(gi, k === 1 ? 5.5 : 3);
      gp.aPhase.setX(gi, r() * 6.28);
      if (k === 1) gp.aColor.setXYZ(gi, 1.0, 0.55, 0.22);
      else gp.aColor.setXYZ(gi, 0.35, 0.85, 1.0);
    }
    gp.position.needsUpdate = gp.aSize.needsUpdate = gp.aPhase.needsUpdate = gp.aColor.needsUpdate = true;
    this._m.compose(this._v.set(pos.x, pos.y - 0.5, pos.z), this._q.identity(), this._s.set(1, 58, 1));
    this.beams.setMatrixAt(slot, this._m);
    this.rocks.instanceMatrix.needsUpdate = this.crystals.instanceMatrix.needsUpdate = this.beams.instanceMatrix.needsUpdate = true;
    this.rocks.visible = this.crystals.visible = this.glow.visible = this.beams.visible = true;
  }

  remove(site) {
    if (!site?.active) return;
    site.active = false;
    const { slot } = site;
    for (let k = 0; k < this.rocksPer; k++) this.rocks.setMatrixAt(slot * this.rocksPer + k, this.zero);
    for (let k = 0; k < this.crystalsPer; k++) this.crystals.setMatrixAt(slot * this.crystalsPer + k, this.zero);
    const gp = this.glow.geometry.attributes;
    for (let k = 0; k < 3; k++) gp.aSize.setX(slot * 3 + k, 0);
    gp.aSize.needsUpdate = true;
    this.beams.setMatrixAt(slot, this.zero);
    this.rocks.instanceMatrix.needsUpdate = this.crystals.instanceMatrix.needsUpdate = this.beams.instanceMatrix.needsUpdate = true;
    if (!this.sites.some((s) => s.active)) this.rocks.visible = this.crystals.visible = this.glow.visible = this.beams.visible = false;
  }

  flashAt(pos) {
    this.fx.t = 0;
    this.fx.pos.copy(pos);
    this.flash.position.copy(pos);
    this.ring.position.copy(pos).y += 0.25;
    this.flash.visible = this.ring.visible = true;
  }

  update(dt, t) {
    this.glowMat.uniforms.uTime.value = t;
    this.beamMat.uniforms.uTime.value = t;
    // hot rocks slowly cool down a little
    this.rockMat.emissiveIntensity = 1.6 + 0.8 * (0.5 + 0.5 * Math.sin(t * 1.7));
    if (this.fx.t >= 0) {
      this.fx.t += dt;
      const k = this.fx.t;
      const fs = k < 0.18 ? (k / 0.18) * 16 : 16 + (k - 0.18) * 10;
      this.flash.scale.setScalar(fs);
      this.flash.material.opacity = k < 0.18 ? 1 : Math.max(0, 1 - (k - 0.18) / 0.7);
      const rs = 2 + k * 38;
      this.ring.scale.setScalar(rs);
      this.ring.material.opacity = Math.max(0, 1 - k / 1.1);
      if (k > 1.2) {
        this.fx.t = -1;
        this.flash.visible = this.ring.visible = false;
      }
    }
  }

  clear() {
    for (const s of this.sites) if (s.active) this.remove(s);
  }
}

// ====================================================================== echo pillar
const PILLAR_FS = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    float fade = pow(1.0 - vUv.y, 1.25);
    float flow = 0.6 + 0.4 * sin(vUv.y * 60.0 - uTime * 4.0);
    float a = fade * flow * 0.6 * uFade;
    gl_FragColor = vec4(vec3(0.45, 0.88, 1.0) * 2.2, a);
  }
`;
const RING_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RING_FS = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float waves = 0.0;
    for (int i = 0; i < 3; i++) {
      float ph = fract(uTime * 0.45 + float(i) / 3.0);
      waves += smoothstep(0.035, 0.0, abs(r - ph)) * (1.0 - ph);
    }
    float core = smoothstep(0.16, 0.0, r);
    float a = (waves * 0.9 + core * 0.6) * uFade * step(r, 1.0);
    gl_FragColor = vec4(vec3(0.5, 0.9, 1.0) * 2.4, a);
  }
`;

export class EchoPillar {
  constructor(scene) {
    this.uniforms = { uTime: { value: 0 }, uFade: { value: 0 } };
    const geo = new THREE.CylinderGeometry(1.4, 2.2, 1, 24, 1, true).translate(0, 0.5, 0);
    this.pillar = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: RING_VS, fragmentShader: PILLAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.pillar.scale.set(1, 300, 1);
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.ring.scale.setScalar(26);
    this.group = new THREE.Group();
    this.group.name = 'sys-echo';
    this.group.add(this.pillar, this.ring);
    this.group.visible = false;
    this.pillar.frustumCulled = this.ring.frustumCulled = false;
    scene.add(this.group);
    this.target = 0;
  }
  show(pos) {
    this.group.position.copy(pos);
    this.ring.position.y = 0.3;
    this.group.visible = true;
    this.target = 1;
  }
  hide() {
    this.target = 0;
  }
  update(dt, t) {
    this.uniforms.uTime.value = t;
    const f = this.uniforms.uFade;
    f.value += (this.target - f.value) * Math.min(1, dt * 2);
    if (this.target === 0 && f.value < 0.01) this.group.visible = false;
  }
}

// ====================================================================== festival sparkles
const SPARK_VS = /* glsl */ `
  attribute vec4 aSeed;   // angle, radius, phase, speed
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uHeight;
  uniform float uFade;
  varying vec3 vColor;
  varying float vA;
  void main() {
    float y = mod(aSeed.z * uHeight - uTime * aSeed.w, uHeight);
    float sway = sin(uTime * 0.7 + aSeed.z * 6.28) * 2.2;
    vec3 p = vec3(cos(aSeed.x) * aSeed.y + sway, y + 2.0, sin(aSeed.x) * aSeed.y + cos(uTime * 0.5 + aSeed.x) * 1.5);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tw = 0.55 + 0.45 * sin(uTime * 5.0 + aSeed.z * 40.0);
    vColor = aColor;
    // fade out right in front of the camera; clamp the sprite so near flakes never become blobs
    vA = tw * uFade * smoothstep(0.0, 6.0, y) * smoothstep(uHeight, uHeight - 12.0, y) * smoothstep(3.0, 9.0, -mv.z);
    gl_PointSize = min(14.0, (2.2 + 2.4 * fract(aSeed.z * 13.7)) * (260.0 / max(1.0, -mv.z)));
    gl_Position = projectionMatrix * mv;
  }
`;
const SPARK_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.0);
    float cross = max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.2) + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
    gl_FragColor = vec4(vColor * 2.2, (a + cross * 0.6) * vA);
  }
`;

export class Sparkles {
  constructor(scene, count = 520) {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(count * 4);
    const col = new Float32Array(count * 3);
    const r = mulberry32(99);
    const pal = [new THREE.Color('#c9a8ff'), new THREE.Color('#9be9ff'), new THREE.Color('#ffd9a0'), new THREE.Color('#ffffff'), new THREE.Color('#b48cff')];
    for (let i = 0; i < count; i++) {
      seed[i * 4] = r() * Math.PI * 2;
      seed[i * 4 + 1] = 4 + Math.sqrt(r()) * 62;
      seed[i * 4 + 2] = r();
      seed[i * 4 + 3] = 1.2 + r() * 2.6;
      const c = pal[Math.floor(r() * pal.length)];
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.uniforms = { uTime: { value: 0 }, uHeight: { value: 60 }, uFade: { value: 0 } };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.name = 'sys-festival-sparkles';
    scene.add(this.points);
    this.target = 0;
  }
  show(pos) {
    this.points.position.copy(pos);
    this.points.visible = true;
    this.target = 1;
  }
  hide() {
    this.target = 0;
  }
  update(dt, t) {
    this.uniforms.uTime.value = t;
    const f = this.uniforms.uFade;
    f.value += (this.target - f.value) * Math.min(1, dt * 1.5);
    if (this.target === 0 && f.value < 0.01) this.points.visible = false;
  }
}

// ====================================================================== shock pulse
const PULSE_FS = /* glsl */ `
  uniform float uT;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = 0.0;
    for (int i = 0; i < 3; i++) {
      float t = uT - float(i) * 0.12;
      if (t <= 0.0) continue;
      float w = 0.018 + 0.03 * t;
      a += smoothstep(w, 0.0, abs(r - t)) * (1.0 - t) * (1.0 - float(i) * 0.3);
    }
    a += smoothstep(0.3, 0.0, r) * pow(max(0.0, 1.0 - uT * 1.6), 2.0) * 0.9;
    gl_FragColor = vec4(uColor * 2.6, a * step(r, 1.0));
  }
`;
const COLUMN_FS = /* glsl */ `
  uniform float uT;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float fade = pow(1.0 - vUv.y, 1.4) * pow(max(0.0, 1.0 - uT), 1.6);
    float edge = 0.6 + 0.4 * sin(vUv.x * 6.2831 * 4.0);
    gl_FragColor = vec4(uColor * 3.0, fade * edge * 0.75);
  }
`;

/** One-shot expanding ground shockwave + light column (signal activation). */
export class ShockPulse {
  constructor(scene, color = '#7fe0ff') {
    this.uniforms = { uT: { value: 0 }, uColor: { value: new THREE.Color(color) } };
    const opts = { uniforms: this.uniforms, vertexShader: RING_VS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ ...opts, fragmentShader: PULSE_FS }));
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.2, 1, 24, 1, true).translate(0, 0.5, 0), new THREE.ShaderMaterial({ ...opts, fragmentShader: COLUMN_FS }));
    this.group = new THREE.Group();
    this.group.name = 'sys-shock-pulse';
    this.group.add(this.ring, this.column);
    this.group.visible = false;
    this.ring.frustumCulled = this.column.frustumCulled = false;
    scene.add(this.group);
    this.t = -1;
    this.duration = 2.4;
  }
  fire(pos, { radius = 70, height = 120, duration = 2.4 } = {}) {
    this.group.position.copy(pos);
    this.ring.position.y = 0.4;
    this.ring.scale.setScalar(radius * 2);
    this.column.scale.set(1, height, 1);
    this.duration = duration;
    this.t = 0;
    this.uniforms.uT.value = 0;
    this.group.visible = true;
  }
  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / this.duration;
    this.uniforms.uT.value = Math.min(1, k);
    if (k >= 1) {
      this.t = -1;
      this.group.visible = false;
    }
  }
  dispose() {
    this.group.removeFromParent();
    for (const m of [this.ring, this.column]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}

