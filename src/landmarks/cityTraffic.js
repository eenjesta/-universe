/**
 * Landmarks — road traffic on Aurora-stad's elevated viaducts and the lake
 * bridge: streams of head- and tail-lights that flow along the curving decks
 * (warm white towards one end, red towards the other). Fully GPU-animated:
 * the road centre lines live in a small float DataTexture (one row per road,
 * one texel per ~3 m sample) that the vertex shader samples, so the whole
 * traffic is a single Points draw call with no per-frame CPU work.
 */
import * as THREE from 'three';
import { radialTexture } from './textures.js';

/**
 * @param {object} mats   shared landmark materials (uses mats.U.uTime / uNight)
 * @param {Array<{pts: THREE.Vector3[], lanes: number[], density: number}>} roads
 *        pts = deck surface centre line (evenly spaced), lanes = lateral lane
 *        offsets (m) for one direction (mirrored for the other), density = cars per 100 m per lane
 * @param {Rng} rng
 */
export function makeRoadTraffic(mats, roads, rng) {
  const usable = roads.filter((r) => r.pts && r.pts.length > 3);
  if (!usable.length) return null;
  const W = Math.max(...usable.map((r) => r.pts.length));
  const H = usable.length;
  const data = new Float32Array(W * H * 4);
  const box = new THREE.Box3();
  usable.forEach((r, row) => {
    r.pts.forEach((p, i) => {
      const k = (row * W + i) * 4;
      data[k] = p.x;
      data[k + 1] = p.y;
      data[k + 2] = p.z;
      data[k + 3] = 1;
      box.expandByPoint(p);
    });
  });
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  // cars: [row, count, offset, speed (fraction / s, signed), lane]
  const cars = [];
  usable.forEach((r, row) => {
    let len = 0;
    for (let i = 1; i < r.pts.length; i++) len += r.pts[i].distanceTo(r.pts[i - 1]);
    for (const dir of [1, -1]) {
      for (const lane of r.lanes) {
        const n = Math.max(2, Math.round((len / 100) * r.density * rng.range(0.8, 1.2)));
        for (let k = 0; k < n; k++) {
          const v = rng.range(14, 24); // m/s
          cars.push([row, r.pts.length, (k + rng.range(-0.3, 0.3)) / n, (dir * v) / len, dir * lane]);
        }
      }
    }
  });
  const N = cars.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const a = new Float32Array(N * 4);
  const b = new Float32Array(N * 2);
  cars.forEach((c, i) => {
    a.set([c[0], c[1], c[2], c[3]], i * 4);
    b.set([c[4], rng.random()], i * 2);
  });
  geo.setAttribute('aCar', new THREE.BufferAttribute(a, 4));
  geo.setAttribute('aLane', new THREE.BufferAttribute(b, 2));
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  geo.boundingSphere.radius += 20;

  const mat = new THREE.ShaderMaterial({
    uniforms: { uRoads: { value: tex }, uTime: mats.U.uTime, uNight: mats.U.uNight, map: { value: radialTexture() } },
    vertexShader: /* glsl */ `
      uniform sampler2D uRoads; uniform float uTime; uniform float uNight;
      attribute vec4 aCar; attribute vec2 aLane;
      varying vec3 vCol;
      void main() {
        int row = int(aCar.x + 0.5);
        float count = aCar.y;
        float s = fract(aCar.z + uTime * aCar.w);
        float f = s * (count - 1.001);
        int i0 = int(floor(f));
        vec3 p0 = texelFetch(uRoads, ivec2(i0, row), 0).xyz;
        vec3 p1 = texelFetch(uRoads, ivec2(i0 + 1, row), 0).xyz;
        vec3 p = mix(p0, p1, fract(f));
        vec2 t = normalize(p1.xz - p0.xz + vec2(1e-4, 0.0));
        vec2 right = vec2(-t.y, t.x);
        p.xz += right * aLane.x;
        p.y += 0.85;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // one stream shows warm head lights, the opposite stream red tail lights
        vec3 head = vec3(1.0, 0.86, 0.66);
        vec3 tail = vec3(1.0, 0.16, 0.07);
        vCol = (aCar.w > 0.0 ? head : tail) * mix(0.55, 2.6, uNight) * (0.8 + 0.4 * aLane.y);
        gl_PointSize = clamp(2600.0 / -mv.z, 1.4, 5.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; varying vec3 vCol;
      void main() {
        float a = texture2D(map, gl_PointCoord).r;
        gl_FragColor = vec4(vCol * a, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  mats.list.push(mat);
  const points = new THREE.Points(geo, mat);
  points.name = 'city-road-traffic';
  points.userData.dispose = () => tex.dispose();
  return points;
}
