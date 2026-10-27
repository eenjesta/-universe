/**
 * Lightweight collision world: terrain height function + oriented boxes
 * (rotation about Y only) in a spatial hash. Good enough for characters,
 * cars and placed building pieces; no rigid-body dynamics.
 *
 * Box description (all in world units / metres):
 *   { x, y, z }  centre of the box
 *   { w, h, d }  full size along local X, Y, Z
 *   rotY         rotation about Y (same convention as Object3D.rotation.y)
 *   solid        blocks horizontal movement (default true)
 *   walkable     characters/cars may stand on its top face (default true)
 *   tag, owner   free-form metadata (e.g. 'structure', piece id)
 */
export class Physics {
  constructor() {
    this.boxes = new Map();
    this.grid = new Map();
    this.cell = 8;
    this.nextId = 1;
    this.terrainHeight = () => 0; // set by the world: (x, z) => y
    this.waterLevel = 0;
    this._stamp = 0;
  }

  setTerrain(fn) {
    this.terrainHeight = fn;
  }

  // ------------------------------------------------------------ registry
  addBox({ x = 0, y = 0, z = 0, w = 1, h = 1, d = 1, rotY = 0, solid = true, walkable = true, tag = '', owner = null }) {
    const id = this.nextId++;
    const box = { id, x, y, z, w, h, d, rotY, solid, walkable, tag, owner, cells: [], _stamp: 0 };
    this._prep(box);
    this.boxes.set(id, box);
    this._insert(box);
    return id;
  }

  /**
   * Adds a box matching a mesh's geometry bounds (uses only the Y rotation of
   * the mesh's world transform). Returns the id.
   */
  addFromObject(object, opts = {}) {
    object.updateWorldMatrix(true, false);
    const geo = object.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const e = object.matrixWorld.elements;
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    const rotY = Math.atan2(e[8], e[10]);
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    // local centre → world (scale, rotate about Y, translate)
    const lx = cx * sx;
    const lz = cz * sz;
    const wx = e[12] + lx * Math.cos(rotY) + lz * Math.sin(rotY);
    const wz = e[14] - lx * Math.sin(rotY) + lz * Math.cos(rotY);
    const pad = opts.padding || 0;
    return this.addBox({
      x: wx,
      y: e[13] + cy * sy,
      z: wz,
      w: (bb.max.x - bb.min.x) * sx + pad * 2,
      h: (bb.max.y - bb.min.y) * sy,
      d: (bb.max.z - bb.min.z) * sz + pad * 2,
      rotY,
      ...opts,
    });
  }

  /** Moves/rotates an existing box (for moving platforms or parked vehicles). */
  moveBox(id, x, y, z, rotY) {
    const b = this.boxes.get(id);
    if (!b) return;
    this._remove(b);
    b.x = x;
    b.y = y;
    b.z = z;
    if (rotY !== undefined) b.rotY = rotY;
    this._prep(b);
    this._insert(b);
  }

  remove(id) {
    const b = this.boxes.get(id);
    if (!b) return;
    this._remove(b);
    this.boxes.delete(id);
  }

  /** Removes every box with the given tag (or owner when `byOwner`). */
  clear(tag) {
    for (const b of [...this.boxes.values()]) if (b.tag === tag) this.remove(b.id);
  }

  _prep(b) {
    b.c = Math.cos(b.rotY);
    b.s = Math.sin(b.rotY);
    b.hw = b.w / 2;
    b.hh = b.h / 2;
    b.hd = b.d / 2;
    b.top = b.y + b.hh;
    b.bottom = b.y - b.hh;
    const ex = Math.abs(b.c) * b.hw + Math.abs(b.s) * b.hd;
    const ez = Math.abs(b.s) * b.hw + Math.abs(b.c) * b.hd;
    b.minX = b.x - ex;
    b.maxX = b.x + ex;
    b.minZ = b.z - ez;
    b.maxZ = b.z + ez;
  }

  _key(ix, iz) {
    return ix * 73856093 + iz * 19349663;
  }

  _insert(b) {
    const c = this.cell;
    b.cells = [];
    for (let ix = Math.floor(b.minX / c); ix <= Math.floor(b.maxX / c); ix++) {
      for (let iz = Math.floor(b.minZ / c); iz <= Math.floor(b.maxZ / c); iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(b);
        b.cells.push(k);
      }
    }
  }

  _remove(b) {
    for (const k of b.cells) {
      const arr = this.grid.get(k);
      if (!arr) continue;
      const i = arr.indexOf(b);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.grid.delete(k);
    }
    b.cells = [];
  }

  /** Boxes whose cells overlap the XZ rectangle. */
  queryRect(minX, minZ, maxX, maxZ, out = []) {
    const c = this.cell;
    const stamp = ++this._stamp;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (const b of arr) {
          if (b._stamp === stamp) continue;
          b._stamp = stamp;
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  _local(b, x, z) {
    const dx = x - b.x;
    const dz = z - b.z;
    return [dx * b.c - dz * b.s, dx * b.s + dz * b.c];
  }

  // -------------------------------------------------------------- queries
  /**
   * Highest walkable surface under (x, z) that a body with feet at `feetY` can
   * stand on (terrain or the top of a walkable box at most `stepUp` above the feet).
   */
  groundHeight(x, z, feetY = Infinity, stepUp = 0.6, radius = 0) {
    let h = this.terrainHeight(x, z);
    const list = this.queryRect(x - radius, z - radius, x + radius, z + radius, this._tmp || (this._tmp = []));
    for (const b of list) {
      if (!b.walkable) continue;
      if (b.top > feetY + stepUp || b.top <= h) continue;
      const [lx, lz] = this._local(b, x, z);
      if (Math.abs(lx) <= b.hw + radius * 0.5 && Math.abs(lz) <= b.hd + radius * 0.5) h = b.top;
    }
    list.length = 0;
    return h;
  }

  /**
   * Pushes a vertical cylinder (centre x/z, feet y, radius, height) out of
   * solid boxes. Mutates `pos` ({x, y, z}); returns true when something was hit.
   */
  resolveCylinder(pos, radius = 0.4, height = 1.8, stepUp = 0.6) {
    let hit = false;
    const list = this.queryRect(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, []);
    for (let iter = 0; iter < 2; iter++) {
      for (const b of list) {
        if (!b.solid) continue;
        if (pos.y + height <= b.bottom || pos.y >= b.top) continue;
        if (b.walkable && pos.y >= b.top - stepUp) continue; // can step onto it
        const [lx, lz] = this._local(b, pos.x, pos.z);
        const cx = Math.max(-b.hw, Math.min(b.hw, lx));
        const cz = Math.max(-b.hd, Math.min(b.hd, lz));
        let px = 0;
        let pz = 0;
        if (cx === lx && cz === lz) {
          // centre inside the rectangle → push out along the shallowest axis
          const ox = b.hw - Math.abs(lx);
          const oz = b.hd - Math.abs(lz);
          if (ox < oz) px = (ox + radius) * Math.sign(lx || 1);
          else pz = (oz + radius) * Math.sign(lz || 1);
        } else {
          const ddx = lx - cx;
          const ddz = lz - cz;
          const dist = Math.hypot(ddx, ddz);
          if (dist >= radius) continue;
          const k = (radius - dist) / (dist || 1);
          px = ddx * k;
          pz = ddz * k;
        }
        // local push → world
        pos.x += px * b.c + pz * b.s;
        pos.z += -px * b.s + pz * b.c;
        hit = true;
      }
    }
    return hit;
  }

  /**
   * First intersection of the segment a→b with solid boxes. Returns t in [0, 1]
   * (1 when nothing is hit). Used for camera collision and line of sight.
   */
  segmentHit(a, b) {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minZ = Math.min(a.z, b.z);
    const maxZ = Math.max(a.z, b.z);
    let best = 1;
    const list = this.queryRect(minX, minZ, maxX, maxZ, []);
    for (const box of list) {
      if (!box.solid) continue;
      const [ax, az] = this._local(box, a.x, a.z);
      const [bx, bz] = this._local(box, b.x, b.z);
      const o = [ax, a.y - box.y, az];
      const dir = [bx - ax, b.y - a.y, bz - az];
      const half = [box.hw, box.hh, box.hd];
      let t0 = 0;
      let t1 = 1;
      let ok = true;
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(dir[i]) < 1e-9) {
          if (o[i] < -half[i] || o[i] > half[i]) ok = false;
        } else {
          let ta = (-half[i] - o[i]) / dir[i];
          let tb = (half[i] - o[i]) / dir[i];
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) ok = false;
        }
      }
      if (ok && t0 < best) best = t0;
    }
    return best;
  }
}
