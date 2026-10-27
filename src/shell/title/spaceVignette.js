/**
 * Thumbnail scene for title card 4 "Ontdek meer" when the space module offers
 * no preview of its own (crop_overview.png, card 4): a sleek dark ship with
 * orange engine glow and blue thruster trails cutting through a field of dark,
 * rim-lit asteroids, a huge pale cratered planet with an atmospheric rim, a
 * blinding sun at the right edge, a violet nebula and laser streaks.
 *
 * Built on demand, rendered once through the full post chain by the caller
 * (ctx.engine.snapshot → bloom on the HDR emissives), then disposed. All
 * textures are painted on canvases; nothing is shared with the game.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/math.js';

/** Sun direction (toward the light): right, slightly behind the scene. */
const SUN = new THREE.Vector3(0.61, 0.13, -0.78).normalize();

export function createSpaceVignette(aspect = 16 / 9) {
  const rnd = mulberry32(0x5eed0e1a);
  const scene = new THREE.Scene();
  const trash = [];
  const keep = (x) => {
    trash.push(x);
    return x;
  };

  scene.background = keep(nebulaTexture(rnd));

  // ------------------------------------------------------------- lights
  // key light from the upper right-front (reads the planet and the ship's
  // visible flank), a warm rim from the sun behind the right edge, cool fill
  const key = new THREE.DirectionalLight(0xf4f1ff, 2.3);
  key.position.set(0.62, 0.55, 0.56).multiplyScalar(500);
  const rimLight = new THREE.DirectionalLight(0xffd2a0, 3.2);
  rimLight.position.copy(SUN).multiplyScalar(500);
  const fill = new THREE.DirectionalLight(0x5f7cff, 0.6); // cool bounce from the nebula
  fill.position.set(-0.7, 0.2, 0.6).multiplyScalar(500);
  scene.add(key, rimLight, fill, new THREE.AmbientLight(0x1b2440, 0.5));

  // --------------------------------------------------------------- planet
  const planetMat = keep(new THREE.MeshStandardMaterial({ map: keep(planetTexture(rnd)), roughness: 1, metalness: 0 }));
  const planetGeo = keep(new THREE.SphereGeometry(93, 64, 48));
  const planet = new THREE.Mesh(planetGeo, planetMat);
  planet.position.set(102, 110, -370);
  planet.rotation.set(0.25, -0.6, 0.38);
  const rimMat = keep(
    new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0.62, 0.55, 0.56).normalize() }, uColor: { value: new THREE.Color(0.55, 0.8, 1.6) } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = normalize(mat3(modelMatrix) * normal);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-(viewMatrix * wp).xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform vec3 uColor;
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() {
          float f = pow(1.0 - abs(dot(vN, vV)), 3.0);
          float lit = smoothstep(-0.35, 0.6, dot(vW, uSun));
          gl_FragColor = vec4(uColor * f * (0.25 + 1.6 * lit), f);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  const rim = new THREE.Mesh(keep(new THREE.SphereGeometry(97, 64, 48)), rimMat);
  rim.position.copy(planet.position);
  scene.add(planet, rim);

  // ------------------------------------------------------------------ sun
  const glowTex = keep(radialTexture());
  const sunCore = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(9, 7.2, 5.2), blending: THREE.AdditiveBlending, depthWrite: false })));
  sunCore.position.copy(SUN).multiplyScalar(900);
  sunCore.scale.setScalar(150);
  const sunHalo = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.6, 0.95, 0.55), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 })));
  sunHalo.position.copy(sunCore.position);
  sunHalo.scale.setScalar(600);
  scene.add(sunHalo, sunCore);

  // ------------------------------------------------------------ asteroids
  const rockGeo = keep(asteroidGeometry(rnd));
  const rockMat = keep(new THREE.MeshStandardMaterial({ color: 0x4a443d, roughness: 0.93, metalness: 0.04, flatShading: true }));
  const ROCKS = 170;
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const shipAt = new THREE.Vector3(4, -1.6, -23);
  // a few big ones framing the shot, then the field
  const hero = [
    [-10, -8, -24, 4.5], // bottom-left foreground
    [-20, 11, -50, 6.5], // top-left
    [24, -11, -36, 4.2], // bottom-right, cut by the frame
    [30, 5, -75, 5], // right, behind the ship's path
    [-4, 7, -38, 1.8],
    [60, -20, -140, 9],
  ];
  for (let i = 0; i < ROCKS; i++) {
    if (i < hero.length) {
      const [x, y, z, r] = hero[i];
      p.set(x, y, z);
      s.set(r * (0.8 + rnd() * 0.5), r * (0.7 + rnd() * 0.4), r * (0.8 + rnd() * 0.5));
    } else {
      // a loose band crossing the frame, denser toward the planet
      do {
        const z = -45 - Math.pow(rnd(), 0.8) * 330;
        // visible half-extents at this depth ≈ 0.65·|z| × 0.36·|z| (view tilted a little right/up)
        p.set((rnd() * 1.4 - 0.62) * -z, ((rnd() * 2 - 1) * 0.37 + 0.04) * -z, z);
      } while (p.distanceTo(shipAt) < 9);
      const r = (0.35 + Math.pow(rnd(), 2.4) * 3.2) * (1 + -p.z / 160);
      s.set(r * (0.7 + rnd() * 0.6), r * (0.6 + rnd() * 0.5), r * (0.7 + rnd() * 0.6));
    }
    q.setFromEuler(e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
    rocks.setMatrixAt(i, m4.compose(p, q, s));
  }
  rocks.instanceMatrix.needsUpdate = true;
  rocks.computeBoundingSphere();
  scene.add(rocks);

  // ------------------------------------------------------------------ ship
  const ship = buildShip(keep);
  ship.position.copy(shipAt);
  ship.rotation.set(0.12, -0.82, -0.38, 'YXZ');
  ship.scale.setScalar(1.12);
  scene.add(ship);

  // ------------------------------------------------------- laser streaks
  const laserGeo = keep(new THREE.BoxGeometry(0.07, 0.07, 22));
  const laserMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.1, 4.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  for (const [x, y, z, ry, rx] of [
    [-16, 2.5, -48, -0.5, 0.06],
    [-11, -3.5, -66, -0.55, 0.02],
    [-23, 5, -80, -0.45, 0.09],
  ]) {
    const l = new THREE.Mesh(laserGeo, laserMat);
    l.position.set(x, y, z);
    l.rotation.set(rx, ry, 0);
    scene.add(l);
  }

  // ---------------------------------------------------------------- camera
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.3, 4000);
  camera.position.set(0, 0, 0);
  camera.lookAt(7, 2.5, -60);
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);

  return {
    scene,
    camera,
    dispose() {
      for (const t of trash) t.dispose?.();
      trash.length = 0;
      rocks.dispose();
    },
  };
}

// --------------------------------------------------------------------- ship
/** A sleek dark fighter (nose toward −Z), ~9 m long, with glowing engines + trails. */
function buildShip(keep) {
  const g = new THREE.Group();
  const parts = [];
  const add = (geo, m) => {
    geo.applyMatrix4(m);
    parts.push(geo);
  };
  const M = () => new THREE.Matrix4();
  // fuselage: tapered octagonal body, flattened
  add(new THREE.CylinderGeometry(0.34, 1.05, 7.4, 8, 1).rotateX(-Math.PI / 2).scale(1, 0.42, 1), M());
  add(new THREE.ConeGeometry(0.34, 2.3, 8).rotateX(-Math.PI / 2).scale(1, 0.42, 1), M().makeTranslation(0, 0, -4.85));
  // swept wings
  for (const side of [1, -1]) {
    const w = new THREE.BoxGeometry(4.3, 0.12, 1.7);
    w.translate(side * 2.7, -0.08, 0.9);
    w.applyMatrix4(M().makeShear(0, side * 0.55, 0, 0, 0, 0));
    parts.push(w);
    // canted tail fins
    const f = new THREE.BoxGeometry(0.1, 1.15, 1.25).translate(0, 0.55, 0);
    f.applyMatrix4(M().makeRotationZ(-side * 0.42));
    f.translate(side * 0.75, 0.15, 2.9);
    parts.push(f);
    // engine pods
    add(new THREE.CylinderGeometry(0.36, 0.42, 1.9, 10).rotateX(Math.PI / 2), M().makeTranslation(side * 0.72, -0.02, 3.35));
  }
  const hullGeo = keep(mergeGeometries(parts));
  parts.forEach((pgeo) => pgeo.dispose());
  const hullMat = keep(new THREE.MeshStandardMaterial({ color: 0x262a31, metalness: 0.5, roughness: 0.34 }));
  g.add(new THREE.Mesh(hullGeo, hullMat));

  // canopy
  const canopy = new THREE.Mesh(
    keep(new THREE.SphereGeometry(0.5, 18, 12).scale(0.62, 0.36, 1.5)),
    keep(new THREE.MeshStandardMaterial({ color: 0x0d1624, metalness: 0.2, roughness: 0.12, emissive: new THREE.Color(0.06, 0.32, 0.5) })),
  );
  canopy.position.set(0, 0.34, -1.5);
  g.add(canopy);

  // orange accent strips on the wings (bloom)
  const stripMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 1.6, 0.42) }));
  for (const side of [1, -1]) {
    const s = new THREE.Mesh(keep(new THREE.BoxGeometry(2.6, 0.05, 0.08)), stripMat);
    s.position.set(side * 2.9, 0.0, 1.75 + 0.55 * 1.6);
    s.rotation.y = -side * 0.5;
    g.add(s);
  }

  // engine nozzles + glow + trails
  const nozzleMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.6) }));
  const glowTex = keep(radialTexture());
  const glowMat = keep(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(3.2, 1.5, 0.5), blending: THREE.AdditiveBlending, depthWrite: false }));
  const trailMat = keep(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.22, 0.55, 1.7),
      alphaMap: keep(trailTexture()),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  // wide at the nozzle (z = 4.32), tapering to a point 16 m behind; uv.y = 0 at the nozzle
  const trailGeo = keep(new THREE.ConeGeometry(0.17, 16, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 4.32 + 8));
  const nozzleGeo = keep(new THREE.CircleGeometry(0.3, 16));
  for (const side of [1, -1]) {
    const n = new THREE.Mesh(nozzleGeo, nozzleMat);
    n.position.set(side * 0.72, -0.02, 4.32);
    g.add(n);
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(side * 0.72, -0.02, 4.6);
    glow.scale.setScalar(1.7);
    g.add(glow);
    const t = new THREE.Mesh(trailGeo, trailMat);
    t.position.set(side * 0.72, -0.02, 0);
    g.add(t);
  }
  return g;
}

// ------------------------------------------------------------ geometry
/** Faceted rock: a subdivided icosahedron pushed in and out by seeded sines. */
function asteroidGeometry(rnd) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position;
  const ph = Array.from({ length: 9 }, () => rnd() * 6.28);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const d =
      1 +
      0.24 * Math.sin(2.1 * v.x + ph[0]) * Math.sin(1.7 * v.y + ph[1]) * Math.sin(2.4 * v.z + ph[2]) +
      0.12 * Math.sin(5.3 * v.x + ph[3]) * Math.sin(4.7 * v.z + ph[4]) +
      0.07 * Math.sin(9.1 * v.y + ph[5]) * Math.sin(8.3 * v.x + ph[6]) +
      0.18 * Math.max(0, Math.sin(1.3 * v.y + ph[7]) * Math.sin(1.1 * v.z + ph[8]));
    pos.setXYZ(i, v.x * d, v.y * d, v.z * d);
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------- textures
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function blob(g, x, y, r, rgb, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`);
  gr.addColorStop(0.55, `rgba(${rgb},${a * 0.35})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Deep blue-black sky with a violet/blue nebula band, a warm glow toward the sun and stars. */
function nebulaTexture(rnd) {
  const W = 1024;
  const H = 576;
  const [c, g] = canvas(W, H);
  const base = g.createLinearGradient(0, H, W, 0);
  base.addColorStop(0, '#03050b');
  base.addColorStop(0.55, '#070b1c');
  base.addColorStop(1, '#101a3c');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 34; i++) {
    const t = i / 33;
    const x = W * (-0.05 + 1.05 * t) + (rnd() - 0.5) * 160;
    const y = H * (0.92 - 0.75 * t) + (rnd() - 0.5) * 170;
    blob(g, x, y, 80 + rnd() * 190, rnd() < 0.55 ? '118,72,200' : '46,92,214', 0.08 + rnd() * 0.12);
  }
  blob(g, W * 0.18, H * 0.78, 260, '150,70,190', 0.12);
  blob(g, W * 1.02, H * 0.3, 470, '255,168,104', 0.24);
  blob(g, W * 0.96, H * 0.33, 170, '255,214,170', 0.3);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const m = rnd();
    const a = 0.18 + m * m * 0.8;
    const r = m > 0.992 ? 1.7 : m > 0.93 ? 1.1 : 0.65;
    g.fillStyle = `rgba(${(205 + rnd() * 50) | 0},${(212 + rnd() * 43) | 0},255,${a.toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Pale blue-grey planet surface: soft bands, maria and craters (equirectangular). */
function planetTexture(rnd) {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#93a4ba');
  grad.addColorStop(0.45, '#c9d1da');
  grad.addColorStop(1, '#8a98ad');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 46; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '64,84,116' : '236,238,242'},${(0.04 + rnd() * 0.08).toFixed(3)})`;
    g.fillRect(0, rnd() * H, W, 3 + rnd() * 26);
  }
  for (let i = 0; i < 18; i++) blob(g, rnd() * W, H * (0.2 + rnd() * 0.6), 30 + rnd() * 90, '70,82,104', 0.18 + rnd() * 0.12);
  for (let i = 0; i < 220; i++) {
    const x = rnd() * W;
    const y = H * (0.08 + rnd() * 0.84);
    const r = 1.5 + Math.pow(rnd(), 3) * 30;
    g.fillStyle = 'rgba(58,68,84,0.28)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(244,244,248,0.24)';
    g.lineWidth = Math.max(0.8, r * 0.16);
    g.beginPath();
    g.arc(x - r * 0.12, y - r * 0.12, r, Math.PI * 0.85, Math.PI * 1.85);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial glow (white → transparent) for sun and engine sprites. */
function radialTexture() {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Alpha ramp along a thruster trail cone (v = 1 at the nozzle → 0 at the tail). */
function trailTexture() {
  const [c, g] = canvas(8, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  gr.addColorStop(0.92, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 256);
  return new THREE.CanvasTexture(c);
}
