/**
 * Landmarks — Het signaal: a tall dark crystal-rock obelisk on the lake shore
 * with a glowing blue Ø and a vertical light line, a pile of dark wet rocks,
 * a reflective wet patch with pulsing light rings, rising light motes and a
 * sky beam while active (setActive). The Ø faces south (towards arriving players).
 */
import * as THREE from 'three';
import { Rng } from '../core/math.js';
import { drawEmblem, canvasTexture } from '../core/textures.js';
import { GeoBuilder, Frame, mat, TAU, hdr } from './common.js';
import { radialTexture } from './textures.js';

export function buildBeacon(env, zone) {
  const { mats, physics, ground } = env;
  const U = mats.U;
  const rng = new Rng('het-signaal');
  const group = new THREE.Group();
  group.name = 'landmarks-beacon';

  // stand on the wet shore: walk north from the zone centre to the water's
  // edge and step back a few metres inland (the lake glows behind the Ø)
  const bx = zone.x;
  let shoreD = 0;
  for (let d = 0; d <= 60; d++) {
    if (ground.at(bx, zone.z - d) < 1.2) {
      shoreD = d;
      break;
    }
  }
  const bz = zone.z - (shoreD ? THREE.MathUtils.clamp(shoreD - 4, 8, 40) : 11);
  const gy = Math.max(ground.min(bx, bz, 3), 0.2);
  const F = new Frame(bx, gy, bz, Math.PI); // local −Z = south
  const crystal = new GeoBuilder({ uv: false });
  const rocks = new GeoBuilder({ uv: true });
  const glow = new GeoBuilder({ glow: true, uv: false });
  const BLUE = hdr(0x5ab8ff, 2.6);

  // ---------------------------------------------------------- crystal shards
  const shard = (lx, lz, h, r, tiltX, tiltZ, rot, color = 0x161b26) => {
    const g = new THREE.CylinderGeometry(r * 0.72, r, h, 6, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      // pointed, slightly irregular tip
      if (y > h / 2 - 0.01) p.setXYZ(i, p.getX(i) * 0.15, y + r * 1.6, p.getZ(i) * 0.15);
      else if (y > 0) p.setXYZ(i, p.getX(i) * (1 + rng.range(-0.08, 0.08)), y, p.getZ(i) * (1 + rng.range(-0.08, 0.08)));
    }
    crystal.add(g, F.m(lx, h / 2 - 0.8, lz, tiltX, rot, tiltZ), { flat: true, color });
    g.dispose();
  };
  // main obelisk: front face flat towards −Z (local)
  const MAIN_H = 21;
  {
    const g = new THREE.CylinderGeometry(1.75, 2.5, MAIN_H, 6, 4, false, Math.PI / 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > MAIN_H / 2 - 0.01) p.setXYZ(i, p.getX(i) * 0.25, y + 3.2, p.getZ(i) * 0.25 - 0.3);
    }
    crystal.add(g, F.m(0, MAIN_H / 2 - 0.6, 0), { flat: true, color: 0x141924 });
    g.dispose();
  }
  // flanking shards
  shard(-2.4, 0.9, 13, 1.25, 0.06, 0.14, 0.4);
  shard(2.3, 1.2, 15.5, 1.35, -0.04, -0.12, 1.1);
  shard(-1.1, 2.4, 9, 1.0, -0.18, 0.08, 2.3, 0x1a2030);
  shard(1.6, -1.6, 6.5, 0.9, 0.22, -0.2, 0.7, 0x1a2030);
  shard(-2.9, -1.2, 5, 0.8, 0.25, 0.3, 1.9, 0x1a2030);
  shard(3.2, 2.6, 7.5, 0.85, -0.2, -0.3, 2.9, 0x1a2030);
  // glowing seams along a few shard edges
  for (const [lx, lz, h, sx] of [[-2.4, 0.9, 11, 1], [2.3, 1.2, 13, -1], [-1.1, 2.4, 7, 1]]) {
    glow.box(0.06, h, 0.06, F.m(lx + sx * 0.75, h / 2 + 0.6, lz - 0.6, 0.06 * sx, 0, 0.12 * sx), { color: hdr(0x4aa8ff, 1.5), glow: [-0.35, lx, 0.4] });
  }
  // vertical light line on the front face + base glow
  const faceZ = -2.5 * Math.cos(Math.PI / 6) + 0.05;
  glow.box(0.11, MAIN_H - 1.5, 0.1, F.m(0, MAIN_H / 2 - 0.2, faceZ - 0.02), { color: BLUE, glow: [-0.45, 0, 0.7] });
  glow.box(0.5, 0.05, 0.05, F.m(0, 0.15, faceZ - 0.1), { color: BLUE, glow: [-0.45, 0, 0.75] });
  physics?.addBox({ x: bx, y: gy + MAIN_H / 2, z: bz, w: 4.4, h: MAIN_H, d: 4.4, tag: 'landmarks', walkable: false });
  physics?.addBox({ x: bx, y: gy + 5, z: bz, w: 7, h: 10, d: 5.5, tag: 'landmarks', walkable: false });

  // ---------------------------------------------------------- rocks around the base
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(2.6, 7.5);
    const lx = Math.cos(a) * rr;
    const lz = Math.sin(a) * rr;
    if (lz < -2 && Math.abs(lx) < 1.6) continue; // keep the light line visible
    const s = rng.range(0.5, 1.7) * (1.2 - rr / 10);
    const p = F.p(lx, 0, lz);
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pa = g.attributes.position;
    for (let k = 0; k < pa.count; k++) pa.setXYZ(k, pa.getX(k) * rng.range(0.8, 1.2), pa.getY(k) * rng.range(0.6, 1), pa.getZ(k) * rng.range(0.8, 1.2));
    rocks.add(g, mat(p.x, ground.at(p.x, p.z) + s * 0.25, p.z, rng.range(0, 1), rng.range(0, TAU), 0, s * 1.3, s * 0.8, s), { flat: true, color: rng.pick([0x2a2c30, 0x34363a, 0x23252a]), uvMode: 'box', uvDiv: 2 });
    g.dispose();
    if (s > 0.9) physics?.addBox({ x: p.x, y: ground.at(p.x, p.z) + s * 0.3, z: p.z, w: s * 2, h: s * 1.2, d: s * 1.8, tag: 'landmarks' });
  }

  // ---------------------------------------------------------- Ø emblem (additive decal + halo)
  const emblemY = 13.2;
  const embTex = canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.filter = 'blur(6px)';
      drawEmblem(g, w / 2, h / 2, w * 0.3, w * 0.07, '#3a7dff');
      g.filter = 'none';
      drawEmblem(g, w / 2, h / 2, w * 0.3, w * 0.03, '#e6f4ff');
    },
    { srgb: true },
  );
  const activeU = { value: 1 };
  const embMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: embTex }, uTime: U.uTime, uActive: activeU },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uTime; uniform float uActive; varying vec2 vUv;
      void main() {
        vec3 t = texture2D(map, vUv).rgb;
        // dormant: a faint, slow breathing glow · active: bright and pulsing
        float pulse = mix(0.8 + 0.2 * sin(uTime * 0.7), 0.75 + 0.25 * sin(uTime * 2.2), uActive);
        gl_FragColor = vec4(t * mix(0.3, 2.6, uActive) * pulse, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  mats.list.push(embMat);
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), embMat);
  emblem.position.copy(F.p(0, emblemY, faceZ - 0.12));
  emblem.rotation.y = F.heading(Math.PI);
  emblem.name = 'beacon-emblem';
  group.add(emblem);

  // ---------------------------------------------------------- wet patch + pulse rings
  // wet shore: dark, glossy but dielectric (fresnel reflections only, no mirror disc)
  const wetMat = new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.2, metalness: 0.0, envMapIntensity: 0.8, transparent: true, opacity: 0.85, alphaMap: radialTexture(), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mats.list.push(wetMat);
  const wet = new THREE.Mesh(conformDisc(ground, bx, bz, 13, 0.06, false, true), wetMat);
  wet.name = 'beacon-wet-ground';
  wet.receiveShadow = true;
  group.add(wet);
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uActive: activeU, uNight: U.uNight },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime, uActive, uNight; uniform vec3 uC; varying vec3 vP;
      void main() {
        float r = length(vP.xz);
        float fw = fwidth(r);
        float rings = 0.0;
        for (int i = 0; i < 4; i++) {
          float rr = 3.6 + float(i) * 2.2;
          rings += (1.0 - smoothstep(0.03, 0.08 + fw, abs(r - rr))) * (0.5 - float(i) * 0.08);
        }
        // dormant: only the inner rings breathe faintly
        rings *= mix(0.25 + 0.1 * sin(uTime * 0.7), 1.0, uActive);
        // expanding pulses (only while the signal is active)
        for (int i = 0; i < 3; i++) {
          float pr = mod(uTime * 3.5 + float(i) * 5.0, 15.0) + 2.5;
          float fade = 1.0 - smoothstep(4.0, 15.0, pr);
          rings += (1.0 - smoothstep(0.05, 0.22 + fw, abs(r - pr))) * fade * 1.2 * uActive;
        }
        // dashed outer arcs
        float ang = atan(vP.z, vP.x);
        float dash = step(0.5, fract(ang * 6.0 / 3.14159 + uTime * 0.05));
        rings += (1.0 - smoothstep(0.04, 0.09 + fw, abs(r - 13.0))) * dash * 0.45 * uActive;
        float edge = 1.0 - smoothstep(12.0, 16.0, r);
        vec3 c = vec3(0.35, 0.72, 1.0) * rings * edge * mix(0.8, 2.6, uActive) * mix(0.8, 1.3, uNight);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  mats.list.push(ringMat);
  const ringGeo = conformDisc(ground, bx, bz, 16, 0.1, true);
  const rings = new THREE.Mesh(ringGeo, ringMat);
  rings.position.set(bx, 0, bz);
  rings.name = 'beacon-rings';
  group.add(rings);

  // ---------------------------------------------------------- sky beam + motes
  /** Sky beam material; gain: core 1, soft halo lower. Faint guide by day, a real beam at dusk / night. */
  const makeBeamMat = (gain) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uActive: activeU, uNight: U.uNight, uGain: { value: gain } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: /* glsl */ `
        uniform float uTime, uActive, uNight, uGain; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
          float h = vUv.y;
          float fade = (1.0 - smoothstep(0.0, 1.0, h)) * smoothstep(0.0, 0.01, h);
          float flow = 0.75 + 0.25 * sin(h * 120.0 - uTime * 6.0);
          vec3 c = vec3(0.35, 0.7, 1.0) * edge * fade * flow * uActive * uGain * mix(0.05, 1.0, smoothstep(0.55, 0.95, uNight));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mats.list.push(m);
    return m;
  };
  const beamMat = makeBeamMat(1.15);
  const BEAM_H = 900;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.28, BEAM_H, 16, 1, true).translate(0, BEAM_H / 2, 0), beamMat);
  beam.position.copy(F.p(0, MAIN_H + 2.6, 0));
  beam.name = 'beacon-sky-beam';
  group.add(beam);
  const wide = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.8, BEAM_H * 0.4, 16, 1, true).translate(0, BEAM_H * 0.2, 0), makeBeamMat(0.3));
  wide.position.copy(beam.position);
  wide.name = 'beacon-sky-beam-halo';
  group.add(wide);
  const motes = makeMotes(U, activeU, F.p(0, 0, 0), rng);
  group.add(motes);

  const light = new THREE.PointLight(0x5aa8ff, 0, 34, 1.7);
  light.position.copy(F.p(0, 4.5, -3.5));
  group.add(light);

  group.add(crystal.mesh(makeCrystalMaterial(mats, activeU), { name: 'beacon-crystal', castShadow: true, receiveShadow: true }));
  group.add(rocks.mesh(mats.stone, { name: 'beacon-rocks', castShadow: true, receiveShadow: true }));
  // the light line + seams dim to a faint glow while the signal is dormant
  const glowGain = { value: 1 };
  group.add(glow.mesh(mats.glowWith ? mats.glowWith(glowGain) : mats.glow, { name: 'beacon-lights' }));

  let activeTarget = 1;
  return {
    group,
    // the wet glowing shore stays free of grass blades, trees and rocks
    groundShapes: [{ x: bx, z: bz, r: 12, soft: 4 }],
    clearDiscs: [{ x: bx, z: bz, r: 15 }],
    position: F.p(0, 0, 0),
    emblem: emblem.position.clone(),
    top: F.p(0, MAIN_H + 2.6, 0),
    /** a free spot in front of the obelisk (e.g. for Aria) */
    front: F.p(-2.6, 0, -6.5),
    get active() {
      return activeTarget > 0;
    },
    setActive(on) {
      activeTarget = on ? 1 : 0;
    },
    update(dt, cam, t) {
      activeU.value += (activeTarget - activeU.value) * Math.min(1, dt * 1.5);
      const a = activeU.value;
      glowGain.value = 0.28 + 0.72 * a;
      beam.visible = wide.visible = a > 0.01;
      light.intensity = (8 + 142 * a) * (0.8 + 0.2 * Math.sin(t * 2.2));
    },
  };
}

/** Disc mesh conforming to the terrain (y in world space unless `local`). */
function conformDisc(ground, x, z, R, lift, local = false, landOnly = false) {
  const rings = 14;
  const segs = 48;
  const pos = [];
  const uv = [];
  const idx = [];
  pos.push(local ? 0 : x, ground.at(x, z) + lift, local ? 0 : z);
  uv.push(0.5, 0.5);
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * R;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * TAU;
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      const gh = ground.at(px, pz);
      // landOnly: sink vertices over water below the surface so the water stays visible
      const y = landOnly && gh < 0.05 ? gh - 0.4 : Math.max(gh, 0.02) + lift;
      pos.push(local ? px - x : px, y, local ? pz - z : pz);
      uv.push(0.5 + (Math.cos(a) * rr) / (2 * R), 0.5 + (Math.sin(a) * rr) / (2 * R));
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      if (r === 0) idx.push(0, 1 + s1, 1 + s);
      else {
        const a0 = 1 + (r - 1) * segs;
        const a1 = 1 + r * segs;
        idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Dark crystalline rock: near-black blue-grey facets with a mottled surface,
 * thin glowing blue veins (ridged world-space noise, pulsing with the beacon)
 * and a faint cold rim.
 */
function makeCrystalMaterial(mats, activeU) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.18, envMapIntensity: 0.55 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = mats.U.uTime;
    sh.uniforms.uNight = mats.U.uNight;
    sh.uniforms.uActive = activeU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform float uNight; uniform float uActive; varying vec3 vCWPos;
        float cH(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float cN(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(cH(i), cH(i + vec3(1, 0, 0)), f.x), mix(cH(i + vec3(0, 1, 0)), cH(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(cH(i + vec3(0, 0, 1)), cH(i + vec3(1, 0, 1)), f.x), mix(cH(i + vec3(0, 1, 1)), cH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float cMot = cN(vCWPos * 1.3) * 0.6 + cN(vCWPos * 4.1) * 0.4;
        diffuseColor.rgb *= 0.65 + 0.7 * cMot;
        float cRidge = 1.0 - abs(cN(vCWPos * vec3(0.9, 0.22, 0.9)) * 2.0 - 1.0);
        float cVein = smoothstep(0.93, 0.985, cRidge);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.22, 0.6, cMot);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float pulse = 0.65 + 0.35 * sin(uTime * 2.2 - vCWPos.y * 0.35);
          totalEmissiveRadiance += vec3(0.2, 0.55, 1.0) * cVein * pulse * mix(0.25, 1.6, uActive) * mix(0.6, 1.0, uNight);
          float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
          totalEmissiveRadiance += vec3(0.05, 0.13, 0.32) * rim * (0.6 + 0.4 * uActive);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'lm-crystal-2';
  mats.list.push(m);
  return m;
}

function makeMotes(U, activeU, base, rng) {
  const N = 140;
  const pos = new Float32Array(N * 3);
  const dat = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const a = rng.range(0, TAU);
    const r = rng.range(0.5, 6);
    pos[i * 3] = base.x + Math.cos(a) * r;
    pos[i * 3 + 1] = base.y;
    pos[i * 3 + 2] = base.z + Math.sin(a) * r;
    dat[i * 2] = rng.range(0, 40);
    dat[i * 2 + 1] = rng.range(0.6, 1.6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aData', new THREE.BufferAttribute(dat, 2));
  g.boundingSphere = new THREE.Sphere(base.clone().setY(base.y + 20), 30);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uActive: activeU, map: { value: radialTexture() } },
    vertexShader: /* glsl */ `
      attribute vec2 aData; uniform float uTime; uniform float uActive; varying float vA;
      void main() {
        vec3 p = position;
        float h = mod(uTime * aData.y * 1.4 + aData.x, 40.0);
        p.y += h;
        vec2 d = p.xz - vec2(${base.x.toFixed(2)}, ${base.z.toFixed(2)});
        p.xz -= d * smoothstep(0.0, 30.0, h) * 0.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = (1.0 - h / 40.0) * mix(0.12, 1.0, uActive);
        gl_PointSize = clamp(aData.y * 120.0 / -mv.z, 1.0, 6.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; varying float vA;
      void main() {
        float a = texture2D(map, gl_PointCoord).r * vA;
        gl_FragColor = vec4(vec3(0.45, 0.8, 1.0) * a * 2.5, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  p.name = 'beacon-motes';
  return p;
}
