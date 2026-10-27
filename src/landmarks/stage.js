/**
 * Landmarks — the Starfall Festival holo stage on Nexus-plein (front faces
 * south, towards the tree and the crowd).
 *
 * Platform with a rounded apron + steps, truss rig with moving-head fixtures,
 * a big LED wall + angled side screens (hologram shader), speaker stacks,
 * three floating holographic ringed planets and an instanced set of light
 * beams that sweep over the crowd while the show runs (setShow(true)).
 * The show level animates the shared uniform uShow (0…1) which also boosts
 * holograms elsewhere on the plaza.
 */
import * as THREE from 'three';
import { Rng } from '../core/math.js';
import { GeoBuilder, Frame, addBeam, sweepProfile, TAU, hdr } from './common.js';
import { holoTexture, radialTexture } from './textures.js';

export function buildStage(env, { x, z, gy }) {
  const { mats, physics } = env;
  const U = mats.U;
  const rng = new Rng('starfall-stage');
  const group = new THREE.Group();
  group.name = 'starfall-stage';
  // local −Z = front = world +Z (south)
  const F = new Frame(x, gy, z, Math.PI);
  const body = new GeoBuilder({ uv: false });
  const metal = new GeoBuilder({ uv: false });
  const glow = new GeoBuilder({ glow: true, uv: false });
  const H = 1.5;

  // ---------------------------------------------------------- platform
  body.box(26, H + 1, 12, F.m(0, (H - 1) / 2, 3), { color: 0x24262c });
  const apron = new THREE.CylinderGeometry(13, 13, H + 1, 40, 1, false, Math.PI / 2, Math.PI);
  body.add(apron, F.m(0, (H - 1) / 2, -3, 0, 0, 0, 1, 1, 0.5), { color: 0x24262c });
  apron.dispose();
  // top surface (glossy dark) + edge trim
  const arc = [];
  for (let i = 0; i <= 40; i++) {
    const a = Math.PI / 2 + (i / 40) * Math.PI;
    arc.push(F.p(13.05 * Math.sin(a), H - 0.12, -3 + 13.05 * Math.cos(a) * 0.5));
  }
  const trim = sweepProfile(arc, [[0, 0], [0.06, 0], [0.06, 0.14], [0, 0.14]], { closed: true });
  glow.add(trim, undefined, { color: hdr(0x8f7bff, 2.0), glow: [0, 0, 0.3] });
  trim.dispose();
  const lowTrim = sweepProfile(arc.map((p) => p.clone().setY(gy + 0.3)), [[0, 0], [0.06, 0], [0.06, 0.1], [0, 0.1]], { closed: true });
  glow.add(lowTrim, undefined, { color: hdr(0x6fd8ff, 1.7), glow: [0, 0, 0.25] });
  lowTrim.dispose();
  // steps at the front centre
  body.box(7, 0.5, 1.2, F.m(0, 0.25, -11.0), { color: 0x2c2f36 });
  body.box(7, 1.0, 1.4, F.m(0, 0.5, -9.9), { color: 0x2c2f36 });
  for (const [sx, sz, sy] of [[0, -10.4, 0.5], [0, -9.25, 1.0]]) glow.box(7, 0.05, 0.08, F.m(sx, sy + 0.03, sz), { color: hdr(0x9fe6ff, 2), glow: [0, 0, 0.3] });

  // ---------------------------------------------------------- back wall + screens
  body.box(23, 12, 0.8, F.m(0, H + 6, 9.4), { color: 0x16181d });
  const screenMat = mats.holo(holoTexture('stage'), { intensity: 1.0, dayLevel: 0.8, scan: 0.5, side: THREE.FrontSide });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), screenMat);
  screen.position.copy(F.p(0, H + 6.2, 8.95));
  screen.rotation.y = F.heading(Math.PI);
  screen.name = 'stage-screen';
  group.add(screen);
  const sideTex = holoTexture('portrait');
  for (const side of [-1, 1]) {
    const sm = mats.holo(sideTex, { intensity: 0.9, dayLevel: 0.7, scan: 1, side: THREE.FrontSide });
    const ss = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 9.2), sm);
    ss.position.copy(F.p(side * 16.2, H + 5.6, 5.2));
    ss.rotation.y = F.heading(Math.PI - side * 0.42);
    ss.name = 'stage-side-screen';
    group.add(ss);
    body.box(5.2, 10, 0.5, F.m(side * 16.35, H + 5.6, 5.55, 0, -side * 0.42, 0), { color: 0x16181d });
    // speaker stacks on the ground beside the apron
    for (let k = 0; k < 2; k++) {
      body.box(2.4, 2.1, 1.8, F.m(side * 15.4, 1.05 + k * 2.15, -6.5, 0, side * 0.25, 0), { color: 0x1b1d22 });
      glow.box(1.6, 0.06, 0.06, F.m(side * 15.4, 2.0 + k * 2.15, -7.42, 0, side * 0.25, 0), { color: hdr(0x7fd8ff, 2.5), glow: [-0.8, k * 0.5, 0.25] });
    }
    F.box(physics, side * 15.4, 2.15, -6.5, 2.4, 4.3, 1.8, side * 0.25);
  }

  // holographic band performing during the show (projected on a plane over the stage)
  const band = new THREE.Mesh(new THREE.PlaneGeometry(17, 5.3), mats.holo(holoTexture('band'), { intensity: 1.7, dayLevel: 0.85, scan: 1, tint: [0.75, 0.9, 1.15], showGate: 1 }));
  band.position.copy(F.p(0, H + 2.65, 1.5));
  band.rotation.y = F.heading(Math.PI);
  band.name = 'stage-holo-band';
  group.add(band);

  // ---------------------------------------------------------- truss rig
  const TOP = 17.5;
  const legs = [[-14, -1], [14, -1], [-14, 7.5], [14, 7.5]];
  const truss = (a, b, w = 0.62) => {
    // square truss between two world points: 4 chords + zig-zag diagonals
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    const side = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(dir, side).normalize().multiplyScalar(w / 2);
    const v = new THREE.Vector3().crossVectors(dir, u).normalize().multiplyScalar(w / 2);
    const corners = [u.clone().add(v), u.clone().sub(v), u.clone().negate().sub(v), u.clone().negate().add(v)];
    for (const c of corners) addBeam(metal, a.clone().add(c), b.clone().add(c), 0.05, { color: 0x8e949c }, 4);
    const n = Math.max(1, Math.round(len / w));
    for (let i = 0; i < n; i++) {
      const p0 = a.clone().addScaledVector(dir, (i / n) * len);
      const p1 = a.clone().addScaledVector(dir, ((i + 1) / n) * len);
      for (let k = 0; k < 4; k++) {
        const c0 = corners[k];
        const c1 = corners[(k + 1) % 4];
        addBeam(metal, p0.clone().add(i % 2 ? c0 : c1), p1.clone().add(i % 2 ? c1 : c0), 0.03, { color: 0x8e949c }, 3);
      }
    }
  };
  for (const [lx, lz] of legs) {
    truss(F.p(lx, 0, lz), F.p(lx, TOP, lz));
    metal.box(1.2, 0.3, 1.2, F.m(lx, 0.15, lz), { color: 0x2b2e34 });
    F.box(physics, lx, TOP / 2, lz, 0.8, TOP, 0.8, 0, { walkable: false });
  }
  truss(F.p(-14, TOP, -1), F.p(14, TOP, -1));
  truss(F.p(-14, TOP, 7.5), F.p(14, TOP, 7.5));
  truss(F.p(-14, TOP, -1), F.p(-14, TOP, 7.5));
  truss(F.p(14, TOP, -1), F.p(14, TOP, 7.5));
  // moving-head fixtures on the front truss (beam origins)
  const fixtures = [];
  for (let i = 0; i < 8; i++) {
    const lx = -10.5 + i * 3;
    metal.box(0.7, 0.8, 0.7, F.m(lx, TOP - 0.85, -1), { color: 0x1a1c20 });
    glow.add(new THREE.CircleGeometry(0.26, 12).rotateX(Math.PI / 2), F.m(lx, TOP - 1.27, -1), { color: hdr(i % 2 ? 0xb48cff : 0x7fe0ff, 4), glow: [0, 0, 0.4] });
    fixtures.push({ lx, p: F.p(lx, TOP - 1.3, -1) });
  }
  // light bars under the side trusses
  for (const side of [-1, 1]) glow.box(0.12, 0.12, 8, F.m(side * 14, TOP - 0.5, 3.25), { color: hdr(0xff9ad8, 3), glow: [-0.6, side, 0.3] });

  // physics: platform (walkable), apron approximation, steps, back wall
  F.box(physics, 0, H / 2, 3, 26, H, 12);
  F.box(physics, 0, H / 2, -4.25, 24, H, 2.5);
  F.box(physics, 0, H / 2, -6.3, 20, H, 1.8);
  F.box(physics, 0, H / 2, -8.0, 11, H, 1.8);
  F.box(physics, 0, 0.25, -11.0, 7, 0.5, 1.2);
  F.box(physics, 0, 0.5, -9.9, 7, 1.0, 1.4);
  F.box(physics, 0, H + 6, 9.4, 23, 12, 0.8, 0, { walkable: false });

  group.add(body.mesh(mats.dark, { name: 'stage-body', castShadow: true, receiveShadow: true }));
  group.add(metal.mesh(mats.metal, { name: 'stage-truss', castShadow: true }));
  group.add(glow.mesh(mats.glow, { name: 'stage-lights' }));

  // ---------------------------------------------------------- holographic planets
  const planetTex = holoTexture('planet');
  planetTex.wrapS = THREE.RepeatWrapping;
  const planets = [];
  const defs = [
    { lx: -6.5, ly: 13.5, lz: 2.5, r: 3.4, color: 0x8fb8ff, ring: 1.9, tilt: 0.45 },
    { lx: 7.5, ly: 16.5, lz: 1.5, r: 2.3, color: 0xc49bff, ring: 1.8, tilt: -0.35 },
    { lx: 1.2, ly: 21.5, lz: 3.5, r: 1.5, color: 0x9fe8ff, ring: 2.1, tilt: 0.2 },
  ];
  for (const d of defs) {
    const pg = new THREE.Group();
    const sm = mats.fresnel({ color: d.color, intensity: 1.5, power: 1.8, dayLevel: 0.55, map: planetTex, show: 0.8 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(d.r, 32, 20), sm);
    const rm = mats.fresnel({ color: d.color, intensity: 1.1, power: 0.6, dayLevel: 0.5, show: 1.0 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r * d.ring, d.r * 0.035, 4, 64), rm);
    ring.rotation.x = Math.PI / 2 + d.tilt;
    pg.add(sphere, ring);
    pg.position.copy(F.p(d.lx, d.ly, d.lz));
    pg.name = 'stage-holo-planet';
    group.add(pg);
    planets.push({ group: pg, sphere, ring, base: pg.position.clone(), phase: rng.range(0, TAU), speed: rng.range(0.15, 0.35) });
  }

  // ---------------------------------------------------------- show beams (instanced)
  const beamGeo = new THREE.ConeGeometry(2.4, 30, 20, 1, true).translate(0, -15, 0);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uShow: U.uShow, uNight: U.uNight, uTime: U.uTime },
    vertexShader: /* glsl */ `
      varying float vL; varying vec3 vCol; varying vec3 vN; varying vec3 vV;
      void main() {
        vL = -position.y / 30.0;
        vCol = instanceColor;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * w;
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uShow, uNight, uTime;
      varying float vL; varying vec3 vCol; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = (1.0 - vL) * (1.0 - vL) * edge * uShow * mix(0.35, 1.0, uNight);
        float dust = 0.85 + 0.15 * sin(vL * 60.0 - uTime * 3.0);
        gl_FragColor = vec4(vCol * a * 1.4 * dust, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mats.list.push(beamMat);
  const beams = new THREE.InstancedMesh(beamGeo, beamMat, fixtures.length);
  beams.name = 'stage-beams';
  const bc = new THREE.Color();
  fixtures.forEach((f, i) => beams.setColorAt(i, bc.setHSL(i % 2 ? 0.75 : 0.53, 0.9, 0.6)));
  beams.instanceColor.needsUpdate = true;
  beams.frustumCulled = false;
  beams.visible = false;
  group.add(beams);

  // crowd ground glow while the show runs
  const glowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(16, 48),
    new THREE.MeshBasicMaterial({ map: radialTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.copy(F.p(0, 0.08, -16));
  glowDisc.name = 'stage-floor-glow';
  mats.list.push(glowDisc.material);
  group.add(glowDisc);

  // ---------------------------------------------------------- show control
  let showTarget = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const down = new THREE.Vector3(0, -1, 0);
  const dir = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const discCol = new THREE.Color();

  const api = {
    group,
    frame: F,
    position: F.p(0, H, 2),
    front: F.p(0, 0, -11.8),
    width: 26,
    rotY: 0,
    crowdPoints: [],
    get showActive() {
      return showTarget > 0;
    },
    setShow(on) {
      showTarget = on ? 1 : 0;
    },
    update(dt, cam, t) {
      const show = U.uShow.value;
      U.uShow.value = THREE.MathUtils.clamp(show + (showTarget - show) * Math.min(1, dt * 1.2), 0, 1);
      const s = U.uShow.value;
      for (const p of planets) {
        p.sphere.rotation.y += dt * p.speed * (1 + s * 3);
        p.ring.rotation.z += dt * p.speed * 0.5 * (1 + s * 2);
        p.group.position.y = p.base.y + Math.sin(t * 0.6 + p.phase) * (0.4 + s * 0.9);
        p.group.position.x = p.base.x + Math.sin(t * 0.25 + p.phase) * s * 2.5;
      }
      beams.visible = s > 0.01;
      if (beams.visible) {
        for (let i = 0; i < fixtures.length; i++) {
          const f = fixtures[i];
          const sweepX = Math.sin(t * 0.7 + i * 0.9) * 9 + (i - 3.5) * 1.2;
          const sweepZ = -16 + Math.cos(t * 0.5 + i * 1.3) * 7;
          F.p(f.lx * 0.6 + sweepX, 0, sweepZ, tgt);
          dir.subVectors(tgt, f.p).normalize();
          q.setFromUnitVectors(down, dir);
          m4.compose(f.p, q, one);
          beams.setMatrixAt(i, m4);
        }
        beams.instanceMatrix.needsUpdate = true;
      }
      const pulse = 0.6 + 0.4 * Math.sin(t * 3.1);
      glowDisc.material.color.copy(discCol.setRGB(0.35, 0.22, 0.75)).multiplyScalar(s * pulse * 0.9);
      glowDisc.visible = s > 0.01;
    },
  };
  return api;
}
