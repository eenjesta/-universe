/**
 * Vehicles — ambient air traffic: 16 ships / VTOLs / shuttles on smooth
 * looping Catmull-Rom routes around Aurora City, over the lake and between
 * the city, the Nexus plaza and the spaceport; one shuttle lands on the
 * hangar roof deck, waits and takes off again. Cheap: three InstancedMeshes
 * (low-poly merged models; vertex colours > 1 glow) + one Points mesh for
 * blinking navigation lights and engine glows = 4 draw calls, no shadows,
 * no per-frame allocations.
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { clamp, damp, easeInOutCubic, Rng } from '../core/math.js';
import { PartBuilder, M, loft, chamferSection } from './geo.js';
import { hdr } from './materials.js';

const HOT = /* glsl */ `
{
  vec3 vc = vColor.rgb;
  float hot = step(1.001, max(vc.r, max(vc.g, vc.b)));
  totalEmissiveRadiance += vc * hot;
}`;

function trafficMaterial() {
  const m = new THREE.MeshStandardMaterial({ name: 'veh-traffic', color: 0xffffff, vertexColors: true, metalness: 0.55, roughness: 0.42 });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${HOT}`);
  };
  m.customProgramCacheKey = () => 'veh-traffic-hot';
  return m;
}

function shipGeo() {
  const B = new PartBuilder();
  const hull = 0x1d2025;
  B.add(loft([chamferSection(-7, 0.1, 0.1, 0.1, 0.3), chamferSection(-4.5, 0.8, 0.5, 0.4, 0.3), chamferSection(-1, 1.3, 0.85, 0.6, 0.3), chamferSection(3.5, 1.2, 0.7, 0.6, 0.3), chamferSection(6, 0.9, 0.5, 0.5, 0.3)], { flat: true }), null, { color: hull });
  for (const s of [-1, 1]) {
    B.box(4.8, 0.14, 3.2, M(s * 3, -0.05, 2.8, 0, s * -0.45, 0), { color: hull });
    B.box(0.12, 0.14, 2.6, M(s * 5.2, -0.04, 4.0), { color: hdr(0x5fc8ff, 5) });
    B.cyl(0.45, 0.5, 2.2, 8, M(s * 0.8, 0, 5.6, Math.PI / 2), { color: 0x2a2d33 });
    B.add(new THREE.CircleGeometry(0.38, 8), M(s * 0.8, 0, 6.72), { color: hdr(0xff8a3a, 7) });
  }
  B.box(0.12, 1.8, 2.0, M(0, 1.2, 4.6, -0.5), { color: hull });
  B.box(0.9, 0.3, 1.6, M(0, 0.62, -2.4, -0.15), { color: 0x0a0c10 });
  return B.build();
}

function vtolGeo() {
  const B = new PartBuilder();
  const hull = 0x1a1d22;
  B.add(loft([chamferSection(-4.8, 0.3, 0.25, 0.25, 0.4), chamferSection(-3.2, 1.1, 0.9, 0.7, 0.3), chamferSection(1.5, 1.3, 1.1, 0.8, 0.3), chamferSection(4.6, 0.55, 0.6, 0.35, 0.35)], { flat: true }), null, { color: hull });
  for (const s of [-1, 1]) {
    const ring = new THREE.TorusGeometry(1.95, 0.28, 6, 18);
    B.add(ring, M(s * 4.2, 0.4, 0.3, Math.PI / 2), { color: hull });
    B.add(new THREE.CircleGeometry(1.75, 18), M(s * 4.2, 0.45, 0.3, -Math.PI / 2), { color: 0x3a3c40 });
    B.box(1.6, 0.25, 1.2, M(s * 1.9, 0.35, 0.3), { color: hull });
    B.box(0.08, 0.12, 0.9, M(s * 6.17, 0.4, 0.3), { color: hdr(0xff8a3a, 5) });
    B.box(0.1, 1.0, 0.9, M(s * 0.5, 1.2, 4.2, -0.3, 0, s * -0.3), { color: hull });
  }
  B.box(0.3, 0.12, 0.05, M(0, 0.2, 4.65), { color: hdr(0xff8a3a, 6) });
  return B.build();
}

function shuttleGeo() {
  const B = new PartBuilder();
  const hull = 0x6c7179;
  B.add(loft([chamferSection(-8, 1.2, 0.8, 0.9, 0.35), chamferSection(-6, 2.1, 1.6, 1.4, 0.28), chamferSection(5, 2.2, 1.7, 1.5, 0.25), chamferSection(8, 1.8, 1.4, 1.3, 0.3)], { flat: true }), null, { color: hull });
  B.box(2.4, 0.35, 1.2, M(0, 0.95, -6.7, -0.5), { color: hdr(0xffd9a6, 2.2) });
  for (const s of [-1, 1]) {
    for (const z of [-3.5, 4.5]) {
      B.cyl(0.7, 0.8, 1.6, 8, M(s * 2.9, -0.6, z), { color: 0x2c2f35 });
      B.add(new THREE.CircleGeometry(0.62, 8), M(s * 2.9, -1.42, z, Math.PI / 2), { color: hdr(0x8cc8ff, 5) });
    }
    B.box(0.06, 0.12, 9, M(s * 2.23, 0.2, 0), { color: hdr(0xffb35a, 4) });
  }
  B.box(4.2, 0.2, 2.4, M(0, 1.75, 3), { color: 0x2c2f35 });
  return B.build();
}

const NAV = /* glsl */ `
attribute vec4 aNav; // r g b, kind (0 steady, 1 strobe, 2 engine)
attribute float aPhase;
uniform float uTime;
uniform float uScale;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(1.0, -mv.z);
  float blink = 1.0;
  if (aNav.w > 0.5 && aNav.w < 1.5) blink = step(fract(uTime * 0.8 + aPhase), 0.08);
  else if (aNav.w < 0.5) blink = 0.65 + 0.35 * step(fract(uTime * 0.5 + aPhase), 0.5);
  float size = aNav.w > 1.5 ? 8.0 : 4.0;
  gl_PointSize = clamp(size * uScale / dist, 2.5, 48.0) * (0.35 + 0.65 * blink);
  vCol = aNav.rgb * blink;
  vA = blink;
}`;
const NAV_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  a = a * a;
  if (a * vA < 0.01) discard;
  gl_FragColor = vec4(vCol * a, a * vA);
}`;

export function createTraffic(ctx, mats) {
  const world = ctx.world;
  const scene = world.scene;
  const rng = new Rng('air-traffic');
  const material = trafficMaterial();
  const geos = { ship: shipGeo(), vtol: vtolGeo(), shuttle: shuttleGeo() };
  const C = ZONES.city;
  const P = ZONES.plaza;
  const S = ZONES.spaceport;
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ------------------------------------------------------------ routes
  const ellipse = (cx, cz, rx, rz, y, amp, n = 10, rot = 0, dir = 1) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 * dir + rot;
      pts.push(v3(cx + Math.cos(a) * rx, y + Math.sin(a * 2 + rot) * amp, cz + Math.sin(a) * rz));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  };
  const routes = {
    cityHigh: ellipse(C.x, C.z, 420, 300, 230, 40, 12, 0, 1),
    cityLow: ellipse(C.x + 20, C.z + 40, 300, 220, 120, 25, 10, 1, -1),
    cityWide: ellipse(C.x - 40, C.z - 20, 520, 360, 300, 50, 12, 2, 1),
    lake: ellipse(-20, -360, 330, 190, 48, 12, 10, 0.5, 1),
    lakeWest: ellipse(-260, -330, 180, 140, 70, 18, 8, 0.2, -1),
    corridor: new THREE.CatmullRomCurve3(
      [v3(80, 180, -700), v3(180, 150, -470), v3(330, 110, -230), v3(420, 120, 60), v3(500, 140, 240), v3(640, 170, 120), v3(560, 200, -260), v3(330, 210, -560), v3(120, 220, -760)],
      true,
      'centripetal',
    ),
    plaza: ellipse(P.x, P.z, 160, 120, 85, 12, 8, 0, 1),
  };
  // landing loop: starts/ends above the hangar roof
  const hangar = ctx.landmarks?.spaceport?.hangar;
  const hp = hangar?.position || v3(S.hangar.x, 14, S.hangar.z);
  const hr = hangar?.rotY ?? S.hangar.rotY;
  const roofY = (hangar?.floorY ?? hp.y) + (hangar?.h ?? S.hangar.h) + 1.6;
  const lx = -32;
  const lz = 8;
  const pad = v3(hp.x + lx * Math.cos(hr) + lz * Math.sin(hr), roofY + 2.3, hp.z - lx * Math.sin(hr) + lz * Math.cos(hr));
  const hover = pad.clone().setY(roofY + 70);
  routes.landing = new THREE.CatmullRomCurve3([hover.clone(), v3(hover.x - 260, 190, hover.z - 200), v3(160, 230, -420), v3(-60, 240, -700), v3(260, 220, -760), v3(560, 200, -200), v3(hover.x + 120, 140, hover.z - 140), hover.clone()], false, 'centripetal');

  // ------------------------------------------------------------ agents
  const defs = [
    ['ship', 'cityHigh', 0.0, 72],
    ['ship', 'cityHigh', 0.5, 72],
    ['ship', 'cityWide', 0.2, 80],
    ['ship', 'cityWide', 0.7, 80],
    ['ship', 'corridor', 0.1, 64],
    ['ship', 'corridor', 0.55, 64],
    ['vtol', 'cityLow', 0.15, 36],
    ['vtol', 'cityLow', 0.65, 36],
    ['vtol', 'lake', 0.3, 32],
    ['vtol', 'lakeWest', 0.0, 30],
    ['vtol', 'plaza', 0.4, 26],
    ['shuttle', 'corridor', 0.33, 48],
    ['shuttle', 'cityHigh', 0.25, 50],
    ['shuttle', 'cityWide', 0.45, 52],
    ['shuttle', 'landing', 0.0, 48],
    ['vtol', 'lake', 0.8, 34],
  ];
  const counts = { ship: 0, vtol: 0, shuttle: 0 };
  const agents = defs.map(([kind, route, u, speed]) => {
    const curve = routes[route];
    return {
      kind,
      curve,
      len: curve.getLength(),
      u,
      speed: speed * rng.range(0.9, 1.1),
      index: counts[kind]++,
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      ahead: new THREE.Vector3(),
      heading: 0,
      pitch: 0,
      bank: 0,
      landing: route === 'landing' ? { state: 'cruise', t: 0 } : null,
    };
  });
  const meshes = {};
  for (const kind of Object.keys(counts)) {
    const m = new THREE.InstancedMesh(geos[kind], material, counts[kind]);
    m.name = `veh-traffic-${kind}`;
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    meshes[kind] = m;
  }

  // nav lights: 3 per agent (port red, starboard green, white strobe) + 1 engine glow
  const NL = agents.length * 4;
  const navPos = new Float32Array(NL * 3);
  const navCol = new Float32Array(NL * 4);
  const navPhase = new Float32Array(NL);
  const LIGHT_OFF = { ship: [[-5.3, 0, 4.2], [5.3, 0, 4.2], [0, 2.1, 5.4], [0, 0, 7.2]], vtol: [[-6.2, 0.4, 0.3], [6.2, 0.4, 0.3], [0, 1.8, 4.4], [0, 0.2, 5.0]], shuttle: [[-2.4, 0.4, -5], [2.4, 0.4, -5], [0, 1.9, 4], [0, -1.6, 0]] };
  agents.forEach((a, i) => {
    const o = i * 4;
    const ph = rng.random();
    const set = (k, r, g, b, kind) => {
      navCol.set([r, g, b, kind], (o + k) * 4);
      navPhase[o + k] = ph + k * 0.13;
    };
    set(0, 6, 0.6, 0.4, 0);
    set(1, 0.5, 6, 1.2, 0);
    set(2, 7, 7, 7, 1);
    if (a.kind === 'shuttle') set(3, 1.5, 3.5, 7, 2);
    else set(3, 7, 3, 1, 2);
  });
  const navGeo = new THREE.BufferGeometry();
  navGeo.setAttribute('position', new THREE.BufferAttribute(navPos, 3).setUsage(THREE.DynamicDrawUsage));
  navGeo.setAttribute('aNav', new THREE.BufferAttribute(navCol, 4));
  navGeo.setAttribute('aPhase', new THREE.BufferAttribute(navPhase, 1));
  const navMat = new THREE.ShaderMaterial({
    vertexShader: NAV,
    fragmentShader: NAV_FRAG,
    uniforms: { uTime: { value: 0 }, uScale: { value: 400 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const nav = new THREE.Points(navGeo, navMat);
  nav.frustumCulled = false;
  nav.name = 'veh-traffic-lights';
  scene.add(nav);
  world.atmosphere?.excludeFromReflection?.(nav);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const SCALE = 1.7;
  const _s = new THREE.Vector3(SCALE, SCALE, SCALE);
  const _o = new THREE.Vector3();
  let time = 0;

  function place(a, dt) {
    const L = a.landing;
    if (L && L.state !== 'cruise') {
      L.t += dt;
      if (L.state === 'descend') {
        const k = clamp(L.t / 9);
        a.pos.lerpVectors(hover, pad, easeInOutCubic(k));
        if (k >= 1) {
          L.state = 'dwell';
          L.t = 0;
        }
      } else if (L.state === 'dwell') {
        a.pos.copy(pad);
        if (L.t > 9) {
          L.state = 'ascend';
          L.t = 0;
        }
      } else if (L.state === 'ascend') {
        const k = clamp(L.t / 7);
        a.pos.lerpVectors(pad, hover, easeInOutCubic(k));
        if (k >= 1) {
          L.state = 'cruise';
          L.t = 0;
          a.u = 0;
        }
      }
      a.pitch = damp(a.pitch, 0, 2, dt);
      a.bank = damp(a.bank, 0, 2, dt);
      a.heading += dt * 0.08;
      return;
    }
    // speed eases down near the ends of the landing route
    let sp = a.speed;
    if (L) sp *= 0.35 + 0.65 * clamp(Math.min(a.u, 1 - a.u) * 8);
    a.u += (sp * dt) / a.len;
    if (L && a.u >= 1) {
      a.u = 1;
      L.state = 'descend';
      L.t = 0;
    }
    a.u %= 1;
    a.prev.copy(a.pos);
    a.curve.getPointAt(a.u, a.pos);
    a.curve.getPointAt(Math.min(L ? 1 : 2, a.u + 0.004) % 1.0000001, a.ahead);
    const dx = a.ahead.x - a.pos.x;
    const dy = a.ahead.y - a.pos.y;
    const dz = a.ahead.z - a.pos.z;
    const hz = Math.hypot(dx, dz);
    if (hz > 1e-3) {
      const h = Math.atan2(-dx, -dz);
      let dh = h - a.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      a.heading += dh * clamp(dt * 6);
      a.bank = damp(a.bank, clamp((dh / Math.max(dt, 1e-3)) * 0.35, -0.7, 0.7) * (a.kind === 'shuttle' ? 0.4 : 1), 2.5, dt);
      a.pitch = damp(a.pitch, clamp(Math.atan2(dy, hz), -0.4, 0.4), 3, dt);
    }
  }

  const traffic = {
    agents,
    meshes,
    nav,
    pad,
    update(dt) {
      dt = Math.min(dt, 0.1);
      time += dt;
      navMat.uniforms.uTime.value = time;
      navMat.uniforms.uScale.value = (ctx.engine.height || 720) * 0.55;
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        place(a, dt);
        _e.set(a.pitch, a.heading, a.bank, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(a.pos, _q, _s);
        meshes[a.kind].setMatrixAt(a.index, _m);
        const offs = LIGHT_OFF[a.kind];
        for (let k = 0; k < 4; k++) {
          _o.set(offs[k][0] * SCALE, offs[k][1] * SCALE, offs[k][2] * SCALE).applyQuaternion(_q).add(a.pos);
          const j = (i * 4 + k) * 3;
          navPos[j] = _o.x;
          navPos[j + 1] = _o.y;
          navPos[j + 2] = _o.z;
        }
      }
      for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
      navGeo.attributes.position.needsUpdate = true;
    },
  };
  // initial placement (no pop-in on the first frame)
  for (const a of agents) a.curve.getPointAt(a.u, a.pos);
  traffic.update(0.016);
  return traffic;
}
