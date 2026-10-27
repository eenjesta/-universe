import * as THREE from 'three';

/** FALLBACK space mode (do not edit): star field + planet, free-fly camera. */
export function install(ctx) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020308);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 200000);
  const g = new THREE.BufferGeometry();
  const pts = new Float32Array(6000 * 3);
  for (let i = 0; i < pts.length; i += 3) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60000);
    pts.set([v.x, v.y, v.z], i);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false })));
  const planet = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 48), new THREE.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 1 }));
  planet.position.set(-6000, -1500, -12000);
  scene.add(planet);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(1, 0.3, -0.5);
  scene.add(sun, new THREE.AmbientLight(0x223344, 0.6));
  ctx.modes.register('space', {
    scene,
    camera,
    pointerLock: true,
    hud: 'space',
    update(dt) {
      const fwd = ctx.input.axis('back', 'forward');
      camera.rotation.y -= ctx.input.lookX * 0.002;
      camera.rotation.x -= ctx.input.lookY * 0.002;
      camera.translateZ(-fwd * 200 * dt);
    },
  });
  return { scene, camera };
}
