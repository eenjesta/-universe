/**
 * Vehicles — small photo studio (own scene): golden-hour gradient backdrop,
 * glossy dark floor, warm key + cool rim light and a RoomEnvironment PMREM for
 * reflections. Used for the garage thumbnails (rendered once through
 * ctx.engine.snapshot and cached) and by the dev lab.
 *
 *   const studio = createStudio(renderer);
 *   studio.show(object);  studio.frame(object, 'three-quarter');  engine.snapshot(studio.scene, studio.camera, w, h)
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { canvasTexture } from '../core/textures.js';

const VIEWS = {
  'three-quarter': [-0.82, 0.3, -0.9],
  front: [0, 0.22, -1],
  side: [-1, 0.18, 0.02],
  rear: [0.7, 0.3, 0.9],
  top: [-0.3, 1.2, -0.5],
  low: [-0.9, 0.08, -0.75],
};

export function createStudio(renderer, { sky = 'sunset' } = {}) {
  const scene = new THREE.Scene();
  scene.name = 'veh-studio';
  const bg = canvasTexture(16, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    if (sky === 'space') {
      gr.addColorStop(0, '#05060c');
      gr.addColorStop(0.6, '#141a33');
      gr.addColorStop(1, '#2c2140');
    } else {
      gr.addColorStop(0, '#161c33');
      gr.addColorStop(0.35, '#3b3a5a');
      gr.addColorStop(0.58, '#a26a5a');
      gr.addColorStop(0.7, '#f0a46a');
      gr.addColorStop(0.76, '#ffd29a');
      gr.addColorStop(0.8, '#3a3236');
      gr.addColorStop(1, '#0b0c10');
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  scene.background = bg;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.32;
  // glossy dark floor that fades into the backdrop
  const fade = canvasTexture(
    128,
    128,
    (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, '#fff');
      gr.addColorStop(0.45, '#bbb');
      gr.addColorStop(1, '#000');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    },
    { srgb: false },
  );
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.15, alphaMap: fade, transparent: true }),
  );
  floor.receiveShadow = true;
  scene.add(floor);
  const key = new THREE.DirectionalLight(0xffc89a, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const rim = new THREE.DirectionalLight(0x9fc0ff, 1.6);
  const hemi = new THREE.HemisphereLight(0x8a94b8, 0x2a1e18, 0.7);
  scene.add(key, key.target, rim, rim.target, hemi);
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 4000);
  let current = null;
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  const dir = new THREE.Vector3();

  const studio = {
    scene,
    camera,
    floor,
    key,
    rim,
    /** Shows one object (removes the previous one from the studio). */
    show(obj) {
      if (current && current !== obj) scene.remove(current);
      current = obj;
      if (obj) scene.add(obj);
    },
    /** Frames the object; view = name in VIEWS or [x, y, z] direction. zoom < 1 = closer. */
    frame(obj, view = 'three-quarter', { zoom = 1, aspect = 16 / 9, fov = 30 } = {}) {
      obj.updateWorldMatrix(true, true);
      if (obj.userData?.bounds) box.copy(obj.userData.bounds).applyMatrix4(obj.matrixWorld);
      else box.setFromObject(obj);
      box.getBoundingSphere(sphere);
      const v = Array.isArray(view) ? view : VIEWS[view] || VIEWS['three-quarter'];
      dir.set(v[0], v[1], v[2]).normalize();
      camera.fov = fov;
      camera.aspect = aspect;
      const r = Math.max(0.5, sphere.radius);
      const dist = (r / Math.sin(THREE.MathUtils.degToRad(fov) / 2)) * 0.82 * zoom;
      camera.near = Math.max(0.05, dist / 200);
      camera.far = dist * 20 + r * 4;
      camera.position.copy(sphere.center).addScaledVector(dir, dist);
      camera.lookAt(sphere.center.x, sphere.center.y - r * 0.08, sphere.center.z);
      camera.updateProjectionMatrix();
      // key light from the front-left above, rim from behind-right
      key.position.copy(sphere.center).add(dir.set(-1.0, 1.15, 0.35).multiplyScalar(r * 4));
      key.target.position.copy(sphere.center);
      const sc = key.shadow.camera;
      sc.left = sc.bottom = -r * 1.4;
      sc.right = sc.top = r * 1.4;
      sc.near = r * 0.5;
      sc.far = r * 10;
      sc.updateProjectionMatrix();
      rim.position.copy(sphere.center).add(dir.set(0.9, 0.5, -0.6).multiplyScalar(r * 4));
      rim.target.position.copy(sphere.center);
      floor.position.set(sphere.center.x, box.min.y - 0.002, sphere.center.z);
      floor.scale.setScalar(r * 4.5);
      return camera;
    },
    dispose() {
      env.dispose();
      fade.dispose();
      bg.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      key.shadow.map?.dispose();
    },
  };
  return studio;
}
