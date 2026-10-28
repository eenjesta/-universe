/**
 * Warm point lights for fire pieces (campfire, torch, fire basket) after dusk.
 *
 * A fixed pool of PointLights (2 on medium, 3 on high quality, none on low — the additive light pools and
 * emissive flames carry the look there; a constant light count means no shader recompiles while playing)
 * is handed to the nearest fire pieces within REACH of the camera every 0.2 s. Intensity follows the
 * build materials' night factor (U.uNight) with a soft per-light flicker. Pieces opt in with
 * `light: { color, intensity, range, y }` in src/build/catalog.js.
 */
import * as THREE from 'three';

const REACH = 70; // m from the camera
const COUNT = { low: 0, medium: 2, high: 3 };

export function createFireLights(ctx, reg, mats) {
  const scene = ctx.world?.scene;
  const lights = [];
  const fires = []; // registry records with a light, refreshed when the registry changes
  let version = -1;
  let acc = 1;
  let time = 0;
  const camP = new THREE.Vector3();

  function setCount(n) {
    while (lights.length > n) {
      const L = lights.pop();
      scene?.remove(L.light);
      L.light.dispose?.();
    }
    while (lights.length < n) {
      const light = new THREE.PointLight(0xff9a4a, 0, 12, 2);
      light.name = `bld-fire-light-${lights.length}`;
      light.castShadow = false;
      light.visible = false;
      scene?.add(light);
      lights.push({ light, rec: null, base: 0, seed: lights.length * 1.7 + 0.3 });
    }
  }
  const qualityCount = () => COUNT[ctx.engine?.quality?.id] ?? 2;
  setCount(qualityCount());
  ctx.events?.on?.('quality:change', () => setCount(qualityCount()));

  function collect() {
    fires.length = 0;
    for (const rec of reg.records.values()) if (rec.def?.light && !rec.removing) fires.push(rec);
    version = reg.version;
  }

  function assign() {
    const cam = ctx.camera;
    if (!cam) return;
    cam.getWorldPosition(camP);
    for (const rec of fires) rec._fireD = Math.hypot(rec.x - camP.x, rec.z - camP.z);
    fires.sort((a, b) => a._fireD - b._fireD);
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      const rec = fires[i] && fires[i]._fireD < REACH ? fires[i] : null;
      L.rec = rec;
      if (!rec) {
        L.light.visible = false;
        continue;
      }
      const cfg = rec.def.light;
      L.light.color.setHex(cfg.color ?? 0xff9a4a);
      L.light.distance = cfg.range ?? 12;
      L.base = cfg.intensity ?? 2;
      L.light.position.set(rec.x, rec.y + (cfg.y ?? 1), rec.z);
      L.light.visible = true;
    }
  }

  /** Per frame (build loop): reassign at 5 Hz, flicker every frame. */
  function update(dt) {
    if (!lights.length) return;
    time += dt;
    if (version !== reg.version) collect();
    acc += dt;
    if (acc > 0.2) {
      acc = 0;
      assign();
    }
    const night = mats?.U?.uNight?.value ?? 1;
    const k = night < 0.04 ? 0 : 0.2 + 0.8 * night;
    for (const L of lights) {
      if (!L.rec) continue;
      const s = L.seed;
      const flick = 0.86 + 0.08 * Math.sin(time * 9.1 + s) + 0.06 * Math.sin(time * 15.7 + s * 2.3);
      L.light.intensity = Math.min(40, L.base * k * flick); // candela (decay 2), capped
    }
  }

  return { update, setCount, get count() {
    return lights.length;
  } };
}
