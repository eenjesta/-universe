/**
 * Build hologram visuals (concept 03_building_city / crop_action_build):
 *   - ghost material: additive cyan hologram with fresnel rim, a 0.5 m
 *     blueprint grid on the faces, fine scanlines, a sweeping scan band and a
 *     subtle flicker; red when the placement is invalid
 *   - edge lines (EdgesGeometry) in bright cyan (alpha blended)
 *   - the projected glowing 4 m grid on the ground around the cursor (follows
 *     the terrain, or lies flat at the build level), target footprint / edge
 *     highlight and an outward pulse
 *   - light pylons at the footprint corners
 * Real-GPU safety: no pow() of negatives, guarded normalisations, finite HDR.
 */
import * as THREE from 'three';

export const HOLO_CYAN = new THREE.Color(0.24, 0.68, 1.0);
export const HOLO_RED = new THREE.Color(1.0, 0.24, 0.18);

const HOLO_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vLocal = position;
  vObjN = normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vViewN = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`;

const HOLO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uClipBelow;
varying vec3 vLocal;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;

float gridLines(vec2 p, float scale, float w) {
  vec2 g = p / scale;
  vec2 fw = max(fwidth(g), vec2(1e-4));
  vec2 d = abs(fract(g - 0.5) - 0.5) / fw;
  float l = min(d.x, d.y);
  return 1.0 - clamp(l - w, 0.0, 1.0);
}

void main() {
  if (vLocal.y < uClipBelow) discard;
  vec3 n = vViewN;
  float nl = length(n);
  n = nl > 1e-5 ? n / nl : vec3(0.0, 0.0, 1.0);
  vec3 v = -vViewPos;
  float vl = length(v);
  v = vl > 1e-5 ? v / vl : vec3(0.0, 0.0, 1.0);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float rim = 1.0 - ndv;
  float fres = rim * rim;
  vec3 an = abs(vObjN);
  vec2 p = (an.y > an.x && an.y > an.z) ? vLocal.xz : ((an.x > an.z) ? vLocal.zy : vLocal.xy);
  float grid = gridLines(p, 0.5, 0.4);
  float scan = 0.5 + 0.5 * sin(vLocal.y * 26.0 - uTime * 5.0);
  float ph = fract(vLocal.y * 0.22 - uTime * 0.45);
  float sweep = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.1, 0.28, ph));
  float flick = 0.9 + 0.1 * sin(uTime * 41.0) * sin(uTime * 17.0 + 1.3);
  float a = clamp(0.035 + 0.3 * fres + 0.15 * grid + 0.03 * scan + 0.12 * sweep, 0.0, 0.5) * flick * uOpacity;
  // kept below the bloom threshold except at rims / the sweep band, so the
  // hologram stays a translucent cyan instead of saturating to white
  vec3 tint = mix(uColor, vec3(0.75, 0.95, 1.0), 0.2 * fres + 0.2 * sweep);
  gl_FragColor = vec4(tint * (0.4 + 0.75 * fres + 0.4 * sweep + 0.25 * grid), a);
  #include <colorspace_fragment>
}`;

const LINE_VERT = /* glsl */ `
varying float vY;
void main() {
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const LINE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uClipBelow;
varying float vY;
void main() {
  if (vY < uClipBelow) discard;
  float flick = 0.86 + 0.14 * sin(uTime * 37.0 + vY * 3.0);
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0);
  // normal blending (not additive): dense edge bundles (towers, cylinders)
  // stay cyan instead of summing up to white
  vec3 c = mix(uColor, vec3(0.8, 0.96, 1.0), 0.2) * 1.45;
  gl_FragColor = vec4(c * flick, clamp(0.85 * pulse * uOpacity, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

/** Shared hologram materials (one program each; clones share it). */
export function createHoloMaterials(timeUniform) {
  const surface = new THREE.ShaderMaterial({
    name: 'bld-holo',
    uniforms: {
      uColor: { value: HOLO_CYAN.clone() },
      uTime: timeUniform,
      uOpacity: { value: 1 },
      uClipBelow: { value: -1e4 },
    },
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const lines = new THREE.ShaderMaterial({
    name: 'bld-holo-lines',
    uniforms: {
      uColor: { value: HOLO_CYAN.clone() },
      uTime: timeUniform,
      uOpacity: { value: 1 },
      uClipBelow: { value: -1e4 },
    },
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  return { surface, lines };
}

/**
 * A hologram of a piece: surface mesh + edge lines. setPiece(info) swaps the
 * geometry (cached per piece), setValid(bool) colours it, setClip(y) hides
 * everything below local y (used while a placed piece materialises).
 */
export class Ghost {
  constructor(mats, { clone = false } = {}) {
    this.surfaceMat = clone ? mats.surface.clone() : mats.surface;
    this.lineMat = clone ? mats.lines.clone() : mats.lines;
    if (clone) {
      this.surfaceMat.uniforms.uTime = mats.surface.uniforms.uTime;
      this.lineMat.uniforms.uTime = mats.lines.uniforms.uTime;
    }
    this.group = new THREE.Group();
    this.group.name = 'build-ghost';
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.surfaceMat);
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMat);
    this.mesh.renderOrder = 20;
    this.lines.renderOrder = 21;
    this.mesh.frustumCulled = false;
    this.lines.frustumCulled = false;
    this.group.add(this.mesh, this.lines);
    this.group.visible = false;
    this.info = null;
    this._empty = this.mesh.geometry;
    this._valid = null;
  }

  setPiece(info) {
    if (info === this.info) return;
    this.info = info;
    this.mesh.geometry = info ? info.ghost : this._empty;
    this.lines.geometry = info ? info.edges : this._empty;
  }

  setValid(valid) {
    if (valid === this._valid) return;
    this._valid = valid;
    const c = valid ? HOLO_CYAN : HOLO_RED;
    this.surfaceMat.uniforms.uColor.value.copy(c);
    this.lineMat.uniforms.uColor.value.copy(c);
  }

  setOpacity(a) {
    this.surfaceMat.uniforms.uOpacity.value = a;
    this.lineMat.uniforms.uOpacity.value = a;
  }

  setClip(y) {
    this.surfaceMat.uniforms.uClipBelow.value = y;
    this.lineMat.uniforms.uClipBelow.value = y;
  }

  dispose() {
    this._empty.dispose();
    if (this.surfaceMat !== this.lineMat) {
      this.surfaceMat.dispose?.();
      this.lineMat.dispose?.();
    }
  }
}

// ------------------------------------------------------------- projected grid
const GRID_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GRID_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uBad;
uniform float uValid;
uniform float uTime;
uniform vec2 uCursor;
uniform vec4 uRect;
uniform vec4 uEdge;
uniform float uEdgeOn;
uniform float uRadius;
uniform float uOpacity;
uniform float uBoost;
varying vec2 vXZ;

float lineAA(float coord, float w) {
  float fw = max(fwidth(coord), 1e-4);
  float d = abs(fract(coord - 0.5) - 0.5) / fw;
  return 1.0 - clamp(d - w, 0.0, 1.0);
}

void main() {
  vec2 g = (vXZ + 2.0) * 0.25;
  float major = max(lineAA(g.x, 0.7), lineAA(g.y, 0.7));
  vec2 g1 = vXZ + 2.0;
  float minor = max(lineAA(g1.x, 0.2), lineAA(g1.y, 0.2));
  float dist = length(vXZ - uCursor);
  float fade = 1.0 - smoothstep(uRadius * 0.3, uRadius, dist);
  float wave = 0.5 + 0.5 * sin(dist * 1.8 - uTime * 4.0);
  // grid vertices (4 m) glow a little brighter (projected pylons look)
  vec2 cv = abs(fract(g - 0.5) - 0.5) * 4.0;
  float node = 1.0 - smoothstep(0.06, 0.22, length(cv));
  // target footprint
  vec2 inR = step(uRect.xy, vXZ) * step(vXZ, uRect.zw);
  float inside = inR.x * inR.y;
  float bd = min(min(abs(vXZ.x - uRect.x), abs(vXZ.x - uRect.z)), min(abs(vXZ.y - uRect.y), abs(vXZ.y - uRect.w)));
  float border = inside * (1.0 - smoothstep(0.04, 0.12, bd));
  // target edge (walls)
  vec2 pa = vXZ - uEdge.xy;
  vec2 ba = uEdge.zw - uEdge.xy;
  float bl = max(dot(ba, ba), 1e-4);
  float h = clamp(dot(pa, ba) / bl, 0.0, 1.0);
  float ed = length(pa - ba * h);
  float edge = uEdgeOn * (1.0 - smoothstep(0.05, 0.16, ed));
  vec3 hl = mix(uBad, uColor, uValid);
  float a = (major * 0.36 + minor * 0.04 + node * 0.5) * fade * (0.7 + 0.3 * wave);
  vec3 col = uColor * a;
  col += hl * (inside * (0.07 + 0.05 * wave) + border * 0.8 + edge * 1.3);
  gl_FragColor = vec4(col * (uBoost * uOpacity), 1.0);
  #include <colorspace_fragment>
}`;

const PYLON_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const PYLON_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float core = 1.0 - smoothstep(0.0, 0.5, abs(vUv.x - 0.5));
  float up = 1.0 - vUv.y;
  float pulse = 0.75 + 0.25 * sin(uTime * 3.0 + vUv.y * 4.0);
  float a = core * up * up * pulse * uOpacity;
  gl_FragColor = vec4(uColor * (a * 2.0), 1.0);
  #include <colorspace_fragment>
}`;

export const GRID_SIZE = 28;
const GRID_SEG = 56;

/**
 * Projected build grid around the cursor. update({center, flatY, cursor, rect,
 * edge, valid}) — positions are world metres; `flatY` null = follow terrain.
 */
export class ProjectedGrid {
  constructor(world, timeUniform) {
    this.world = world;
    const geo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE, GRID_SEG, GRID_SEG).rotateX(-Math.PI / 2);
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    this.uniforms = {
      uColor: { value: HOLO_CYAN.clone() },
      uBad: { value: HOLO_RED.clone() },
      uValid: { value: 1 },
      uTime: timeUniform,
      uCursor: { value: new THREE.Vector2() },
      uRect: { value: new THREE.Vector4(-2, -2, 2, 2) },
      uEdge: { value: new THREE.Vector4() },
      uEdgeOn: { value: 0 },
      uRadius: { value: 11 },
      uOpacity: { value: 1 },
      uBoost: { value: 1.3 },
    };
    this.mat = new THREE.ShaderMaterial({
      name: 'bld-grid',
      uniforms: this.uniforms,
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'build-grid';
    this.mesh.renderOrder = 19;
    this.mesh.frustumCulled = false;
    // corner pylons (4 crossed light quads)
    const pg = new THREE.PlaneGeometry(0.16, 1.5).translate(0, 0.75, 0);
    const pg2 = pg.clone().rotateY(Math.PI / 2);
    const pylonGeo = mergeTwo(pg, pg2);
    pg.dispose();
    pg2.dispose();
    this.pylonMat = new THREE.ShaderMaterial({
      name: 'bld-pylon',
      uniforms: { uColor: { value: HOLO_CYAN.clone() }, uTime: timeUniform, uOpacity: { value: 1 } },
      vertexShader: PYLON_VERT,
      fragmentShader: PYLON_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.pylons = [];
    this.group = new THREE.Group();
    this.group.name = 'build-grid-group';
    this.group.add(this.mesh);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(pylonGeo, this.pylonMat);
      m.renderOrder = 22;
      m.frustumCulled = false;
      this.pylons.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
    this._cx = NaN;
    this._cz = NaN;
    this._flat = NaN;
    this._valid = null;
  }

  /** Re-drapes the grid when its centre / level changes. */
  _drape(cx, cz, flatY) {
    const pos = this.mesh.geometry.attributes.position;
    const h = this.world?.getHeightAt;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y;
      if (flatY != null) y = flatY + 0.03;
      else y = (h ? h(cx + x, cz + z) : 0) + 0.06;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }

  update({ cx, cz, flatY = null, cursorX, cursorZ, rect, edge = null, valid = true, cornerY = null }) {
    const fy = flatY == null ? null : Math.round(flatY * 100) / 100;
    if (cx !== this._cx || cz !== this._cz || (fy ?? -9999) !== this._flat) {
      this._cx = cx;
      this._cz = cz;
      this._flat = fy ?? -9999;
      this.mesh.position.set(cx, 0, cz);
      this._drape(cx, cz, fy);
    }
    const u = this.uniforms;
    // additive lines need more energy on a sunlit ground to read like concept 03
    const day = Math.min(1, Math.max(0, this.world?.dayFactor ?? 0));
    u.uBoost.value = 1.2 + 1.1 * day;
    u.uCursor.value.set(cursorX - cx, cursorZ - cz);
    u.uRect.value.set(rect[0] - cx, rect[1] - cz, rect[2] - cx, rect[3] - cz);
    if (edge) {
      u.uEdge.value.set(edge[0] - cx, edge[1] - cz, edge[2] - cx, edge[3] - cz);
      u.uEdgeOn.value = 1;
    } else u.uEdgeOn.value = 0;
    if (valid !== this._valid) {
      this._valid = valid;
      u.uValid.value = valid ? 1 : 0;
      this.pylonMat.uniforms.uColor.value.copy(valid ? HOLO_CYAN : HOLO_RED);
    }
    const h = this.world?.getHeightAt;
    for (let i = 0; i < 4; i++) {
      // corners 0..3: (x0,z0) (x1,z0) (x1,z1) (x0,z1) — no per-frame arrays
      const x = i === 1 || i === 2 ? rect[2] : rect[0];
      const z = i >= 2 ? rect[3] : rect[1];
      const y = cornerY != null ? cornerY : fy != null ? fy : h ? h(x, z) : 0;
      this.pylons[i].position.set(x, y, z);
    }
  }

  setOpacity(a) {
    this.uniforms.uOpacity.value = a;
    this.pylonMat.uniforms.uOpacity.value = a;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.pylons[0]?.geometry.dispose();
    this.pylonMat.dispose();
  }
}

function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array;
  const pb = b.attributes.position.array;
  const ua = a.attributes.uv.array;
  const ub = b.attributes.uv.array;
  const pos = new Float32Array(pa.length + pb.length);
  pos.set(pa, 0);
  pos.set(pb, pa.length);
  const uv = new Float32Array(ua.length + ub.length);
  uv.set(ua, 0);
  uv.set(ub, ua.length);
  const ia = a.index.array;
  const ib = b.index.array;
  const idx = new Uint16Array(ia.length + ib.length);
  idx.set(ia, 0);
  const off = pa.length / 3;
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
