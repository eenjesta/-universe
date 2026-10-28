/**
 * Character combat FX (characters module): the respawn "materialize" column —
 * a cyan additive light beam with a bright scan band that rises with the body
 * while the Animator prints the character upward (Animator.materialize()).
 * A small pool (6) of meshes in the world scene, hidden when idle; no
 * allocation per frame. Real-GPU safe shader (no pow, no normalize, clamped).
 *
 *   const fx = createCombatFx(ctx);
 *   fx.spawn(position, duration, height);   // world position of the feet
 *   fx.update(dt);                          // loop system
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uScan;
uniform float uFade;
varying vec2 vUv;
void main() {
  float y = clamp(vUv.y, 0.0, 1.0);
  float body = (1.0 - y) * (1.0 - y);
  float d = abs(y - uScan);
  float scan = 1.0 / (1.0 + d * d * 900.0);
  float below = step(y, uScan + 0.02);
  float a = clamp((body * 0.32 * below + scan * 1.1) * uFade, 0.0, 1.0);
  gl_FragColor = vec4(uColor * a, a);
}`;

export function createCombatFx(ctx) {
  const scene = ctx.world?.scene;
  const pool = [];
  const beamGeo = new THREE.CylinderGeometry(0.62, 0.62, 1, 24, 1, true);
  beamGeo.translate(0, 0.5, 0);
  const ringGeo = new THREE.RingGeometry(0.5, 0.78, 40);
  ringGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.ShaderMaterial({
      name: 'chr-spawn-beam',
      uniforms: { uColor: { value: new THREE.Color(0.32, 0.86, 1.0).multiplyScalar(2.6) }, uScan: { value: 0 }, uFade: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, mat);
    beam.name = 'chr-spawn-beam';
    beam.frustumCulled = false;
    beam.renderOrder = 5;
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 1.0).multiplyScalar(2.2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.name = 'chr-spawn-ring';
    ring.frustumCulled = false;
    const g = new THREE.Group();
    g.name = 'chr-spawn-fx';
    g.add(beam, ring);
    g.visible = false;
    scene?.add(g);
    pool.push({ g, beam, ring, mat, ringMat, t: 0, dur: 1, h: 2, active: false, follow: null });
  }
  let next = 0;

  return {
    /** Starts a materialize column at `pos` (feet) lasting `duration` s, `height` m tall; follow = Vector3 to track. */
    spawn(pos, duration = 0.85, height = 1.95, follow = null) {
      if (!pos) return;
      const e = pool[next];
      next = (next + 1) % pool.length;
      const sc = ctx.world?.scene; // read lazily (the world scene may be swapped later)
      if (sc && e.g.parent !== sc) sc.add(e.g);
      e.g.position.copy(pos);
      e.t = 0;
      e.dur = Math.max(0.2, duration);
      e.h = Math.max(0.5, height);
      e.beam.scale.set(1, e.h * 1.08, 1);
      e.follow = follow || null;
      e.active = true;
      e.g.visible = true;
    },
    update(dt) {
      for (const e of pool) {
        if (!e.active) continue;
        e.t += dt;
        const x = e.t / e.dur;
        if (x >= 1.35) {
          e.active = false;
          e.g.visible = false;
          continue;
        }
        if (e.follow) e.g.position.copy(e.follow);
        // scan band follows the printing body (ease-out cubic like the Animator), then fades
        const k = Math.min(1, x);
        const s = 1 - (1 - k) * (1 - k) * (1 - k);
        const fade = Math.min(1, x * 6) * (x > 1 ? Math.max(0, 1 - (x - 1) / 0.35) : 1);
        e.mat.uniforms.uScan.value = s / 1.08;
        e.mat.uniforms.uFade.value = fade;
        e.ring.position.y = s * e.h;
        e.ring.scale.setScalar(1 - 0.25 * s);
        e.ringMat.opacity = fade * 0.85;
      }
    },
    get active() {
      return pool.some((e) => e.active);
    },
    dispose() {
      for (const e of pool) {
        e.g.removeFromParent();
        e.mat.dispose();
        e.ringMat.dispose();
      }
      beamGeo.dispose();
      ringGeo.dispose();
    },
  };
}
