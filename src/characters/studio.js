/**
 * Character-creator studio (characters module): dark hangar-like room with a
 * glossy reflective floor (Reflector with blurred, fresnel-weighted
 * reflection), a turntable with a glowing light ring, a huge window showing
 * the world vista (live render of the open world into a render target, or a
 * painted fallback), a hanging Ø banner, cases with small lights, warm rim light
 * from the window + cool fill. Hosts one hero-LOD character on the turntable.
 */
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Character } from './character.js';
import { CharacterBatch } from './batch.js';
import { createCharacterMaterial } from './material.js';
import { requestArrays, hasArrays } from './build-client.js';
import { canvasTexture, bannerTexture, drawEmblem } from '../core/textures.js';
import { damp, dampAngle } from '../core/math.js';
import { ZONES } from '../world/layout.js';

const FloorShader = {
  name: 'ChrStudioFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uBase: { value: new THREE.Color(0x07080b) },
    uTex: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform vec3 uBase;
    uniform vec2 uTex;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      // soft blur that grows with distance from the turntable
      float spread = 1.5 + length(vWorld.xz) * 1.6;
      vec3 r = vec3(0.0);
      r += texture2D(tDiffuse, uv).rgb * 0.28;
      r += texture2D(tDiffuse, uv + vec2(uTex.x, 0.0) * spread).rgb * 0.18;
      r += texture2D(tDiffuse, uv - vec2(uTex.x, 0.0) * spread).rgb * 0.18;
      r += texture2D(tDiffuse, uv + vec2(0.0, uTex.y) * spread * 1.6).rgb * 0.18;
      r += texture2D(tDiffuse, uv - vec2(0.0, uTex.y) * spread * 1.6).rgb * 0.18;
      vec3 vdir = normalize(cameraPosition - vWorld);
      float fres = 0.18 + 0.62 * pow(1.0 - clamp(vdir.y, 0.0, 1.0), 3.0);
      // large floor tiles with thin seams
      vec2 t = abs(fract(vWorld.xz / 2.4) - 0.5);
      float seam = smoothstep(0.495, 0.5, max(t.x, t.y));
      vec3 base = uBase * (1.0 - seam * 0.5);
      gl_FragColor = vec4(base + r * color * fres * (1.0 - seam * 0.6), 1.0);
    }`,
};

/** Painted vista used when the open world can't be rendered. */
function paintedVista() {
  return canvasTexture(1024, 576, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, '#1d2340');
    sky.addColorStop(0.45, '#5a4a78');
    sky.addColorStop(0.8, '#e08a5a');
    sky.addColorStop(1, '#ffc27a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // planet
    const px = w * 0.32;
    const py = h * 0.2;
    const pr = h * 0.42;
    const pg = g.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
    pg.addColorStop(0, 'rgba(240,232,226,0.95)');
    pg.addColorStop(0.7, 'rgba(200,190,200,0.85)');
    pg.addColorStop(1, 'rgba(120,110,150,0.2)');
    g.fillStyle = pg;
    g.beginPath();
    g.arc(px, py, pr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(150,140,160,0.25)';
    for (let i = 0; i < 26; i++) {
      g.beginPath();
      g.arc(px + (Math.sin(i * 7.1) * pr * 0.7), py + Math.cos(i * 3.3) * pr * 0.7, pr * (0.03 + (i % 5) * 0.012), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(230,220,230,0.9)';
    g.beginPath();
    g.arc(w * 0.62, h * 0.1, h * 0.045, 0, Math.PI * 2);
    g.fill();
    // sun glow
    const sg = g.createRadialGradient(w * 0.64, h * 0.6, 2, w * 0.64, h * 0.6, h * 0.5);
    sg.addColorStop(0, 'rgba(255,240,200,1)');
    sg.addColorStop(0.15, 'rgba(255,190,120,0.7)');
    sg.addColorStop(1, 'rgba(255,140,80,0)');
    g.fillStyle = sg;
    g.fillRect(0, 0, w, h);
    // city spires
    g.fillStyle = '#2a2236';
    for (let i = 0; i < 60; i++) {
      const x = w * 0.35 + ((i * 97) % 520);
      const sh = 30 + ((i * 53) % 170) * (i % 7 === 0 ? 1.6 : 0.7);
      const sw = 4 + (i % 4) * 3;
      g.beginPath();
      g.moveTo(x, h * 0.66);
      g.lineTo(x + sw / 2, h * 0.66 - sh);
      g.lineTo(x + sw, h * 0.66);
      g.fill();
    }
    // floating islands
    g.fillStyle = '#2b2620';
    for (const [x, y, r] of [[0.12, 0.35, 40], [0.22, 0.2, 22], [0.78, 0.3, 30], [0.9, 0.16, 18], [0.55, 0.28, 16]]) {
      g.beginPath();
      g.ellipse(w * x, h * y, r, r * 0.35, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(w * x - r, h * y);
      g.lineTo(w * x, h * y + r * 1.2);
      g.lineTo(w * x + r, h * y);
      g.fill();
    }
    // lake
    const lake = g.createLinearGradient(0, h * 0.66, 0, h);
    lake.addColorStop(0, '#d98a60');
    lake.addColorStop(0.5, '#4a3a5a');
    lake.addColorStop(1, '#151826');
    g.fillStyle = lake;
    g.fillRect(0, h * 0.66, w, h * 0.34);
    g.fillStyle = 'rgba(255,220,170,0.25)';
    for (let i = 0; i < 40; i++) g.fillRect(w * 0.6 + Math.sin(i) * 60, h * 0.68 + i * 4.5, 40 + (i % 5) * 20, 1.5);
    // dark shores + waterfalls
    g.fillStyle = '#1a1a1c';
    g.beginPath();
    g.moveTo(0, h * 0.62);
    g.lineTo(w * 0.28, h * 0.66);
    g.lineTo(w * 0.24, h * 0.74);
    g.lineTo(0, h * 0.8);
    g.fill();
    g.fillStyle = 'rgba(230,235,245,0.6)';
    for (const x of [0.06, 0.1, 0.16]) g.fillRect(w * x, h * 0.64, 6, h * 0.12);
  });
}

export function createStudio(ctx) {
  const scene = new THREE.Scene();
  scene.name = 'chr-studio';
  scene.background = new THREE.Color(0x06070a);
  scene.fog = new THREE.Fog(0x06070a, 14, 30);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 80);

  // ---------------------------------------------------------- lights
  // warm sunset light through the window (behind the character) → edge highlights
  const rim = new THREE.DirectionalLight(0xffa060, 4.2);
  rim.position.set(2.2, 3.6, -6);
  rim.castShadow = true;
  rim.shadow.mapSize.set(1024, 1024);
  rim.shadow.bias = -0.0005;
  rim.shadow.normalBias = 0.02;
  Object.assign(rim.shadow.camera, { left: -2.5, right: 2.5, top: 3, bottom: -1, near: 0.5, far: 16 });
  // soft key from the camera side (keeps the dark techwear dark), cool fill, second warm kicker
  const key = new THREE.DirectionalLight(0xfff0e4, 0.6);
  key.position.set(-2.6, 3.4, 4.6);
  const fill = new THREE.DirectionalLight(0x7f9cff, 0.35);
  fill.position.set(4, 1.5, 3);
  const kick = new THREE.DirectionalLight(0xffb070, 2.2);
  kick.position.set(-4.5, 2.2, -3.5);
  const hemi = new THREE.HemisphereLight(0x3c4660, 0x120d0a, 0.32);
  const glow = new THREE.PointLight(0xffd2a0, 0.75, 3.2, 2);
  glow.position.set(0, 0.35, 0.6);
  scene.add(rim, rim.target, key, key.target, fill, fill.target, kick, kick.target, hemi, glow);

  // ---------------------------------------------------------- floor
  const floorGeo = new THREE.PlaneGeometry(40, 40);
  const floor = new Reflector(floorGeo, {
    clipBias: 0.003,
    textureWidth: 1024,
    textureHeight: 576,
    color: 0x5c616b,
    shader: FloorShader,
    multisample: 0,
  });
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  // ---------------------------------------------------------- turntable
  const table = new THREE.Group();
  scene.add(table);
  const metal = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.32, metalness: 0.8 });
  const metal2 = new THREE.MeshStandardMaterial({ color: 0x0d0e11, roughness: 0.5, metalness: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.4, 0.11, 72), metal);
  base.position.y = 0.055;
  base.receiveShadow = true;
  table.add(base);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.02, 72), metal2);
  top.position.y = 0.115;
  top.receiveShadow = true;
  table.add(top);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.86, 0.68).multiplyScalar(1.6) });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.26, 0.012, 8, 128), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.112;
  table.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.006, 6, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.85, 1.0).multiplyScalar(1.4) }));
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.127;
  table.add(ring2);
  const groove = new THREE.Mesh(new THREE.TorusGeometry(1.04, 0.01, 6, 96), metal2);
  groove.rotation.x = Math.PI / 2;
  groove.position.y = 0.126;
  table.add(groove);
  const lampGeo = new THREE.BoxGeometry(0.1, 0.03, 0.02);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.6).multiplyScalar(2.2) });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 14);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    m4.makeRotationY(-a);
    m4.setPosition(Math.sin(a) * 1.37, 0.06, Math.cos(a) * 1.37);
    lamps.setMatrixAt(i, m4);
  }
  table.add(lamps);

  // ---------------------------------------------------------- window + vista
  // window: compresses HDR world renders so the sun doesn't flood the bloom
  const painted = paintedVista();
  const vistaMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: painted }, uGain: { value: 0.85 }, uHdr: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float uGain; uniform float uHdr; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        if (uHdr > 0.5) c = c / (1.0 + c * 0.75);
        gl_FragColor = vec4(c * uGain, 1.0);
      }`,
  });
  const vista = new THREE.Mesh(new THREE.PlaneGeometry(20, 11.25), vistaMat);
  vista.position.set(0.8, 4.3, -9);
  scene.add(vista);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.6, metalness: 0.5 });
  for (const x of [-6.2, -1.6, 3.0, 7.6]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 11, 0.3), frameMat);
    m.position.set(x, 4.3, -8.6);
    scene.add(m);
  }
  const sill = new THREE.Mesh(new THREE.BoxGeometry(22, 0.5, 1.2), frameMat);
  sill.position.set(0.8, 0.25, -8.6);
  scene.add(sill);
  const sillLight = new THREE.Mesh(new THREE.BoxGeometry(22, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.55).multiplyScalar(1.6) }));
  sillLight.position.set(0.8, 0.52, -8.0);
  scene.add(sillLight);
  // side walls + pillars
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.7, metalness: 0.3 });
  for (const x of [-8.5, 9.5]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 12, 22), wallMat);
    w.position.set(x, 6, 0);
    scene.add(w);
  }
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 22), wallMat);
  ceil.position.set(0.5, 9.8, 0);
  scene.add(ceil);
  // hanging Ø banner (left) + strip lights
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 4.6), new THREE.MeshStandardMaterial({ map: bannerTexture({ fabric: '#1a2036', color: '#d8d2e8' }), roughness: 0.85, side: THREE.DoubleSide }));
  banner.position.set(-4.6, 4.2, -5.2);
  banner.rotation.y = 0.35;
  scene.add(banner);
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.62).multiplyScalar(2.0) });
  for (const [x, z, h] of [[-5.6, -6.8, 3.2], [6.4, -7.0, 3.6], [-7.6, -2.0, 2.6]]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), stripMat);
    s.position.set(x, h / 2 + 0.3, z);
    scene.add(s);
  }
  // cases with small lights
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.45, metalness: 0.55 });
  const caseGeo = new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
  const cases = [
    [-3.3, -2.6, 1.3, 0.6, 0.8, 0.25],
    [-3.6, -1.4, 0.9, 0.45, 0.65, -0.2],
    [-2.6, -3.6, 1.0, 0.9, 0.7, 0.1],
    [3.6, -3.2, 1.4, 0.7, 0.9, -0.3],
    [4.4, -1.6, 0.8, 0.5, 0.6, 0.15],
  ];
  const caseLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.45).multiplyScalar(2.4) });
  const cyanLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.88, 1).multiplyScalar(2.2) });
  for (const [x, z, w, h, d, r] of cases) {
    const c = new THREE.Mesh(caseGeo, caseMat);
    c.scale.set(w, h, d);
    c.position.set(x, h / 2, z);
    c.rotation.y = r;
    c.castShadow = true;
    c.receiveShadow = true;
    scene.add(c);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.012), (x * 7) % 2 > 1 ? cyanLight : caseLight);
    l.position.set(0.3 * w, 0.1 * h, d / 2 + 0.006);
    c.add(l);
    l.scale.set(1 / w, 1 / h, 1 / d);
  }

  // ---------------------------------------------------------- character
  const material = createCharacterMaterial({ rim: 1, name: 'chr-studio' });
  material.userData.rimColor.setRGB(1.0, 0.58, 0.3).multiplyScalar(0.9);
  material.userData.sunDir.copy(rim.position).normalize();
  let chr = null;
  let batch = null;
  let latestKey = null;
  /** Non-blocking: builds the new look in the worker and swaps when ready (latest wins). */
  function setAppearanceAsync(app) {
    if (!chr) return setAppearance(app);
    const k = JSON.stringify(app);
    latestKey = k;
    if (hasArrays(app, 0)) return setAppearance(app);
    requestArrays(app, 0).then(() => {
      if (latestKey === k) setAppearance(app);
    });
    return chr;
  }
  function setAppearance(app) {
    if (!chr) {
      chr = new Character(app, { lod: 0, name: 'studio', seed: 7 });
      batch = new CharacterBatch({
        material,
        parent: chr.object,
        name: 'studio-mesh',
        localBounds: new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.8),
      });
      batch.add(chr);
      batch.rebuild();
      table.add(chr.object);
      chr.object.position.y = 0.125;
    } else if (chr.setAppearance(app, 0)) batch.rebuild();
    return chr;
  }

  // ---------------------------------------------------------- camera presets
  // camera + light rig per tab: the back view is lit like the concept (dark back, warm
  // window rim), face/front views get a soft frontal key so the face reads
  const PRESETS = {
    full: { pos: new THREE.Vector3(0.42, 1.08, 4.15), look: new THREE.Vector3(0.48, 0.98, 0), yaw: Math.PI - 2.45, light: { key: 0.38, rim: 4.6, kick: 2.6, hemi: 0.24 } },
    face: { pos: new THREE.Vector3(0.2, 1.86, 1.5), look: new THREE.Vector3(0.27, 1.77, 0), yaw: Math.PI + 0.3, light: { key: 1.7, rim: 2.6, kick: 1.2, hemi: 0.5 } },
    front: { pos: new THREE.Vector3(0.42, 1.08, 4.15), look: new THREE.Vector3(0.48, 0.98, 0), yaw: Math.PI + 0.38, light: { key: 1.5, rim: 3.0, kick: 1.4, hemi: 0.45 } },
  };
  let preset = PRESETS.full;
  const camPos = preset.pos.clone();
  const camLook = preset.look.clone();
  let yaw = preset.yaw;
  let yawVel = 0;
  let dragging = 0;
  let autoYaw = true;
  let zoom = 1;
  let lookCam = false;

  const studio = {
    scene,
    camera,
    get character() {
      return chr;
    },
    setAppearance,
    setAppearanceAsync,
    setPreset(name, { snap = false, keepYaw = false } = {}) {
      preset = PRESETS[name] || PRESETS.full;
      if (!keepYaw) autoYaw = true;
      if (snap) {
        camPos.copy(preset.pos);
        camLook.copy(preset.look);
        yaw = preset.yaw;
        key.intensity = preset.light.key;
        rim.intensity = preset.light.rim;
        kick.intensity = preset.light.kick;
        hemi.intensity = preset.light.hemi;
      }
    },
    /** Captures the open world from the spawn ridge into the window (render target). */
    captureVista() {
      const r = ctx.engine.renderer;
      const world = ctx.world;
      if (!world?.scene || !world.getHeightAt || world.scene.children.length < 4) return false;
      try {
        if (!studio._rt) studio._rt = new THREE.WebGLRenderTarget(1280, 720, { type: THREE.HalfFloatType, samples: 4 });
        const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 7000);
        const s = ZONES.spawn;
        const gy = world.getHeightAt(s.x, s.z);
        cam.position.set(s.x - 30, gy + 34, s.z + 30);
        cam.lookAt(s.x + 60, gy + 95, -700);
        cam.updateMatrixWorld();
        const pv = ctx.player?.object?.visible;
        if (ctx.player?.object) ctx.player.object.visible = false;
        const prevT = r.getRenderTarget();
        r.setRenderTarget(studio._rt);
        r.clear();
        r.render(world.scene, cam);
        r.setRenderTarget(prevT);
        if (ctx.player?.object) ctx.player.object.visible = pv;
        vistaMat.uniforms.map.value = studio._rt.texture;
        vistaMat.uniforms.uHdr.value = 1;
        vistaMat.uniforms.uGain.value = 1.15;
        return true;
      } catch (err) {
        console.warn('[characters] vista capture failed, using painted vista', err);
        studio.usePaintedVista();
        return false;
      }
    },
    usePaintedVista() {
      vistaMat.uniforms.map.value = painted;
      vistaMat.uniforms.uHdr.value = 0;
      vistaMat.uniforms.uGain.value = 0.85;
    },
    update(dt) {
      const input = ctx.input;
      // drag to rotate (input.lookX is the drag delta while the mouse is held on the canvas)
      const lx = input.gameEnabled ? input.lookX : 0;
      if (Math.abs(lx) > 0.01) {
        yaw += lx * 0.009;
        yawVel = (lx * 0.009) / Math.max(dt, 1 / 120);
        dragging = 0.12;
        autoYaw = false;
      } else {
        dragging -= dt;
        if (dragging <= 0) yaw += yawVel * dt;
        yawVel = damp(yawVel, 0, 3.5, dt);
      }
      if (autoYaw) yaw = dampAngle(yaw, preset.yaw, 3, dt);
      if (input.gameEnabled && input.wheel) zoom = Math.min(1.25, Math.max(0.7, zoom * (1 + input.wheel * 0.08)));
      table.rotation.y = yaw;
      camPos.x = damp(camPos.x, preset.pos.x, 4, dt);
      camPos.y = damp(camPos.y, preset.pos.y, 4, dt);
      camPos.z = damp(camPos.z, preset.pos.z * zoom, 4, dt);
      camLook.lerp(preset.look, 1 - Math.exp(-4 * dt));
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      const L = preset.light;
      const lk = 1 - Math.exp(-3 * dt);
      key.intensity += (L.key - key.intensity) * lk;
      rim.intensity += (L.rim - rim.intensity) * lk;
      kick.intensity += (L.kick - kick.intensity) * lk;
      hemi.intensity += (L.hemi - hemi.intensity) * lk;
      if (chr) {
        const a = chr.anim;
        a.speed = 0;
        a.grounded = true;
        a.swimming = false;
        a.turnRate = 0;
        // track the (moving) camera while the look-at is on
        if (lookCam) a.lookAt(camera.position);
        a.update(dt);
      }
      ringMat.color.setRGB(1.0, 0.86, 0.68).multiplyScalar(1.5 + Math.sin(ctx.loop.realTime * 1.6) * 0.18);
    },
    lookAtCamera(on) {
      lookCam = !!on;
      if (chr && !on) chr.anim.lookAt(null);
    },
  };
  return studio;
}
