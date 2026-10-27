import * as THREE from 'three';

/**
 * Lens flare for the sun (procedural sprites from one canvas atlas: glow,
 * starburst, anamorphic streak, hexagonal ghosts and a halo ring along the
 * sun→centre axis), drawn as ONE batched draw call after all scene geometry.
 *
 * three's Lensflare addon copies framebuffer pixels for occlusion, which is
 * invalid on the composer's multisampled HDR target. Instead, visibility
 * comes from WebGL2 occlusion queries: five tiny depth-tested quads at the
 * sun's screen position (after all scene geometry has drawn), read back
 * asynchronously a frame or two later — so terrain, spires, trees and
 * characters all occlude it correctly with no stalls. Falls back to a CPU
 * terrain ray march if queries are unavailable. Clouds dim it via `cloud`.
 */

const SAMPLE_OFFSETS = [
  [0, 0],
  [0.8, 0],
  [-0.8, 0],
  [0, 0.8],
  [0, -0.8],
];

const ELEMENT_VERT = /* glsl */ `
precision highp float;
attribute vec3 position; // xy = ndc
attribute vec2 uv;
attribute vec3 color;
varying vec2 vUv;
varying vec3 vColor;
void main() {
	vUv = uv;
	vColor = color;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const ELEMENT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vColor;
void main() {
	vec4 t = texture2D( uMap, vUv );
	gl_FragColor = vec4( t.rgb * t.a * vColor, 1.0 );
}
`;

const QUERY_VERT = /* glsl */ `
precision highp float;
uniform vec3 uScreen; // xy ndc, z depth
uniform vec2 uScale;
attribute vec3 position;
void main() {
	gl_Position = vec4( position.xy * uScale + uScreen.xy, uScreen.z, 1.0 );
}
`;

const QUERY_FRAG = /* glsl */ `
precision highp float;
void main() { gl_FragColor = vec4( 1.0 ); }
`;

export function createFlare(ctx, world, atlas) {
  const renderer = ctx.engine.renderer;
  const gl = renderer.getContext();
  const canQuery = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext && !!gl.createQuery;

  // ---- occlusion-query quad
  const quad = new THREE.BufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const queryMat = new THREE.RawShaderMaterial({
    name: 'AtmoFlareQuery',
    uniforms: { uScreen: { value: new THREE.Vector3() }, uScale: { value: new THREE.Vector2() } },
    vertexShader: QUERY_VERT,
    fragmentShader: QUERY_FRAG,
    depthTest: true,
    depthWrite: false,
    colorWrite: false,
    transparent: true,
  });

  // ---- elements: distance 0 = at the sun, 1 = screen centre, 2 = mirrored; size in fraction of screen height
  const C = atlas.cells;
  const elements = [
    { cell: C.glow, dist: 0, size: 0.24, color: new THREE.Color(1.0, 0.7, 0.4).multiplyScalar(0.07) },
    { cell: C.star, dist: 0, size: 0.22, color: new THREE.Color(1.0, 0.88, 0.7).multiplyScalar(0.13), spin: true },
    { cell: C.streak, dist: 0, size: 0.03, aspect: 26, color: new THREE.Color(1.0, 0.75, 0.5).multiplyScalar(0.1) },
    { cell: C.hex, dist: 0.42, size: 0.05, color: new THREE.Color(1.0, 0.55, 0.25).multiplyScalar(0.07) },
    { cell: C.hex, dist: 0.66, size: 0.085, color: new THREE.Color(0.45, 0.75, 1.0).multiplyScalar(0.05) },
    { cell: C.ring, dist: 0.95, size: 0.38, color: new THREE.Color(0.65, 0.55, 1.0).multiplyScalar(0.035) },
    { cell: C.hex, dist: 1.28, size: 0.14, color: new THREE.Color(0.55, 1.0, 0.7).multiplyScalar(0.035) },
    { cell: C.glow, dist: 1.6, size: 0.22, color: new THREE.Color(1.0, 0.5, 0.8).multiplyScalar(0.05) },
  ];
  const N = elements.length;
  const ePos = new Float32Array(N * 4 * 3);
  const eUv = new Float32Array(N * 4 * 2);
  const eCol = new Float32Array(N * 4 * 3);
  const eIdx = [];
  elements.forEach((e, i) => {
    const [u0, u1] = e.cell;
    eUv.set([u0, 0, u1, 0, u1, 1, u0, 1], i * 8);
    const b = i * 4;
    eIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const batch = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(ePos, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(eCol, 3).setUsage(THREE.DynamicDrawUsage);
  batch.setAttribute('position', posAttr);
  batch.setAttribute('uv', new THREE.BufferAttribute(eUv, 2));
  batch.setAttribute('color', colAttr);
  batch.setIndex(eIdx);
  const elementMat = new THREE.RawShaderMaterial({
    name: 'AtmoFlareElements',
    uniforms: { uMap: { value: atlas.texture } },
    vertexShader: ELEMENT_VERT,
    fragmentShader: ELEMENT_FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  // carrier: an empty-draw mesh whose onBeforeRender draws the flare last
  const carrierGeo = new THREE.BufferGeometry();
  carrierGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  carrierGeo.setDrawRange(0, 0);
  const carrier = new THREE.Mesh(carrierGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  carrier.name = 'atmo-lensflare';
  carrier.frustumCulled = false;
  carrier.renderOrder = 1e9;

  const queries = SAMPLE_OFFSETS.map(() => ({ q: canQuery ? gl.createQuery() : null, pending: false, result: 1 }));
  const state = {
    enabled: true,
    camera: null, // only this camera drives queries + draws
    sunDir: new THREE.Vector3(0, 0.1, -1),
    strength: 0, // 0..1 from time of day
    cloud: 0, // 0..1 cloud cover in front of the sun
    visibility: 0, // smoothed result
    cpuVisible: 1,
  };
  const ndc = new THREE.Vector3();
  const sunWorld = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const viewport = new THREE.Vector4();
  let lastTime = performance.now();

  function readQueries() {
    let sum = 0;
    for (const s of queries) {
      if (s.pending && gl.getQueryParameter(s.q, gl.QUERY_RESULT_AVAILABLE)) {
        s.result = gl.getQueryParameter(s.q, gl.QUERY_RESULT) ? 1 : 0;
        s.pending = false;
      }
      sum += s.result;
    }
    return sum / queries.length;
  }

  /** Writes the element quads (ndc) + colours for the current sun position. */
  function layout(aspect, now) {
    const vx = -ndc.x;
    const vy = -ndc.y;
    for (let i = 0; i < N; i++) {
      const e = elements[i];
      const x = ndc.x + vx * e.dist;
      const y = ndc.y + vy * e.dist;
      const h = e.size;
      const w = h * (e.aspect || 1);
      const rot = e.spin ? now * 0.00002 + ndc.x * 0.6 : 0;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      for (let k = 0; k < 4; k++) {
        const qx = k === 0 || k === 3 ? -w : w;
        const qy = k < 2 ? -h : h;
        const o = (i * 4 + k) * 3;
        ePos[o] = x + (qx * c - qy * s) / aspect;
        ePos[o + 1] = y + qx * s + qy * c;
        ePos[o + 2] = 0;
        eCol[o] = e.color.r * state.visibility;
        eCol[o + 1] = e.color.g * state.visibility;
        eCol[o + 2] = e.color.b * state.visibility;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  carrier.onBeforeRender = (r, scene, camera) => {
    if (!state.enabled || camera !== state.camera) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    sunWorld.copy(state.sunDir).multiplyScalar(1000).add(camera.position);
    ndc.copy(sunWorld).project(camera);
    const behind = state.sunDir.dot(camera.getWorldDirection(camDir)) <= 0.05;
    const onScreen = !behind && Math.abs(ndc.x) < 1.25 && Math.abs(ndc.y) < 1.25;
    r.getCurrentViewport(viewport);
    const aspect = viewport.z / Math.max(1, viewport.w);

    let target = 0;
    if (onScreen && state.strength > 0.001) {
      let occ = state.cpuVisible;
      if (canQuery) {
        occ = readQueries();
        // issue new queries for the samples that are idle
        const px = 2 / Math.max(1, viewport.w); // one pixel in ndc (vertical)
        const sunR = 0.012 / Math.tan((camera.fov * Math.PI) / 360); // ≈ sun disc radius in ndc
        queryMat.uniforms.uScale.value.set((px * 2) / aspect, px * 2);
        for (let i = 0; i < queries.length; i++) {
          const s = queries[i];
          if (s.pending) continue;
          const o = SAMPLE_OFFSETS[i];
          queryMat.uniforms.uScreen.value.set(ndc.x + (o[0] * sunR) / aspect, ndc.y + o[1] * sunR, 0.99999);
          queryMat.uniformsNeedUpdate = true;
          gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, s.q);
          r.renderBufferDirect(camera, null, quad, queryMat, carrier, null);
          gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
          s.pending = true;
        }
      }
      const edge = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(ndc.x), Math.abs(ndc.y)), 0.75, 1.2);
      target = occ * edge * state.strength * (1 - state.cloud * 0.85);
    }
    state.visibility += (target - state.visibility) * (1 - Math.exp(-dt * 10));
    if (state.visibility < 0.004) return;
    layout(aspect, now);
    r.renderBufferDirect(camera, null, batch, elementMat, carrier, null);
  };

  /** CPU fallback occlusion: march the terrain toward the sun. */
  function cpuOcclusion(cam) {
    if (canQuery || !cam) return;
    const o = cam.position;
    const d = state.sunDir;
    let t = 2;
    let vis = 1;
    for (let i = 0; i < 90 && t < 2600; i++) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const g = world.getHeightAt?.(x, z);
      if (Number.isFinite(g) && g > y) {
        vis = 0;
        break;
      }
      t *= 1.07;
      t += 1.5;
    }
    state.cpuVisible = vis;
  }

  return {
    mesh: carrier,
    state,
    cpuOcclusion,
    dispose() {
      quad.dispose();
      batch.dispose();
      elementMat.dispose();
      queryMat.dispose();
      carrierGeo.dispose();
      atlas.texture.dispose();
      for (const s of queries) if (s.q) gl.deleteQuery(s.q);
    },
  };
}
