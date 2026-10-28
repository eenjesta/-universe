/**
 * Shared per-frame HUD data, computed once per frame without allocations:
 * the active camera heading, the focus position (player, or the vehicle in
 * 'drive'), its speed, and every world marker with distance + bearing.
 * Minimap, compass strip and screen markers all read from this.
 */
import * as THREE from 'three';
import { objectPosition } from '../util.js';
import { hubBorderPoint, DISCOVERY } from '../logic.js';

const RAD2DEG = 180 / Math.PI;

export class HudFrame {
  constructor(ctx) {
    this.ctx = ctx;
    this.camera = null;
    this.heading = 0; // camera heading (rad; 0 = north, +π/2 = west)
    this.bearing = 0; // camera compass bearing (deg; 0 = N, 90 = O)
    this.focus = new THREE.Vector3();
    this.focusHeading = 0;
    this.speed = 0;
    this.entries = []; // pooled entries, valid up to `count`
    this.count = 0;
    this.tracked = null; // entry of the tracked quest marker (or null)
    this.trackedId = null; // explicit choice via ctx.shell.track(id)
    this._prev = new THREE.Vector3();
    this._hasPrev = false;
    this._dir = new THREE.Vector3();
    // wilderness (set by the shell): POIs near the focus + "home" bearings, pooled
    this.wild = null;
    this.wildEntries = []; // { poi, x, y, z, dist, bearing, known } valid up to wildCount
    this.wildCount = 0;
    this.wayEntries = [0, 1].map(() => ({ x: 0, z: 0, dist: 0, bearing: 0, label: '', id: '' })); // nearest highway waystones
    this.wayCount = 0;
    this.home = { hub: null, base: null }; // { x, z, dist, bearing } | null; base: + kind 'base' | 'bed' | 'beacon'
    this._hubEntry = { x: 0, z: 0, dist: 0, bearing: 0 };
    this._baseEntry = { x: 0, z: 0, dist: 0, bearing: 0, kind: 'base', near: 30, beacon: false, ok: false };
    this._wildAcc = 1;
    this._bp = { x: 0, z: 0 };
  }

  /** Vehicle object while driving/flying (vehicle APIs differ: be lenient). */
  vehicle() {
    const v = this.ctx.vehicles?.current;
    return v && this.ctx.modes.is('drive') ? v : null;
  }

  update(dt) {
    const ctx = this.ctx;
    const cam = ctx.engine.camera;
    this.camera = cam;
    if (cam) {
      cam.updateMatrixWorld();
      cam.getWorldDirection(this._dir);
      if (Math.abs(this._dir.x) + Math.abs(this._dir.z) > 1e-4) this.heading = Math.atan2(-this._dir.x, -this._dir.z);
      this.bearing = ((-this.heading * RAD2DEG) % 360 + 360) % 360;
    }

    // focus: vehicle → player → camera
    const veh = this.vehicle();
    const vp = veh ? objectPosition(veh) : null;
    const pp = ctx.player?.position;
    const src = vp || (pp?.isVector3 ? pp : null) || cam?.position;
    if (src) this.focus.copy(src);
    if (veh) {
      const obj = veh.object || veh.mesh || veh.group || (veh.isObject3D ? veh : null);
      this.focusHeading = typeof veh.heading === 'number' ? veh.heading : obj ? obj.rotation.y : this.heading;
    } else {
      this.focusHeading = typeof ctx.player?.heading === 'number' ? ctx.player.heading : this.heading;
    }

    // speed (m/s): vehicle-provided value if any, else from the position delta
    let speed = null;
    if (veh && typeof veh.speed === 'number') speed = Math.abs(veh.speed);
    else if (veh?.velocity?.isVector3) speed = veh.velocity.length();
    if (speed == null) {
      if (this._hasPrev && dt > 0) {
        const d = this.focus.distanceTo(this._prev);
        speed = d > 60 ? 0 : d / dt; // teleports don't count
      } else speed = 0;
    }
    this.speed += (speed - this.speed) * Math.min(1, dt * 4);
    this._prev.copy(this.focus);
    this._hasPrev = true;

    this._collectMarkers();
    this._collectWild(dt);
  }

  /**
   * Wilderness POIs within ~1.6 km (refreshed 2×/s, distances every frame), the bearing to the
   * safe zone when outside it, and to your base (claim, else spawn beacon).
   */
  _collectWild(dt) {
    const w = this.wild;
    const fx = this.focus.x;
    const fz = this.focus.z;
    if (!w || !this.ctx.modes.is('explore', 'drive')) {
      this.wildCount = 0;
      this.wayCount = 0;
      this.home.hub = this.home.base = null;
      return;
    }
    this._wildAcc += dt;
    const e = this._baseEntry;
    if (this._wildAcc >= 0.5) {
      this._wildAcc = 0;
      // home (claim > bed > spawn beacon), resolved twice a second (beds / beacons scan the build records)
      const claim = w.myClaim();
      const bed = claim ? null : w.bed?.();
      const beacon = claim || bed ? null : w.beacon();
      const at = claim || bed || beacon;
      e.ok = !!at;
      if (at) {
        e.x = at.x;
        e.z = at.z;
        e.kind = claim ? 'base' : bed ? 'bed' : 'beacon';
        e.beacon = e.kind === 'beacon';
        e.near = claim ? claim.r + 20 : 30;
      }
      const list = w.inHub(fx, fz) && Math.max(Math.abs(fx), Math.abs(fz)) < 700 ? [] : w.poisNear(fx, fz, 1600);
      // the two nearest waystones within 650 m (outside the hub)
      this.wayCount = 0;
      if (!w.inHub(fx, fz) && w.waystonesNear) {
        let a = null;
        let b = null;
        let da = Infinity;
        let db = Infinity;
        for (const s of w.waystonesNear(fx, fz, 650)) {
          const d = (s.x - fx) ** 2 + (s.z - fz) ** 2;
          if (d > 650 * 650) continue;
          if (d < da) {
            b = a;
            db = da;
            a = s;
            da = d;
          } else if (d < db) {
            b = s;
            db = d;
          }
        }
        for (const s of [a, b]) {
          if (!s) continue;
          const e = this.wayEntries[this.wayCount++];
          if (e.id !== s.id) {
            e.id = s.id;
            const road = w.roadName(s.road);
            e.label = road ? `${road} · km ${s.km}` : `km ${s.km}`;
          }
          e.x = s.x;
          e.z = s.z;
        }
      }
      this.wildCount = 0;
      for (const p of list) {
        let e = this.wildEntries[this.wildCount];
        if (!e) e = this.wildEntries[this.wildCount] = { poi: null, x: 0, y: 0, z: 0, dist: 0, bearing: 0, known: false };
        this.wildCount++;
        e.poi = p;
        e.x = p.x;
        e.z = p.z;
        e.y = Number.isFinite(p.y) ? p.y + 6 : (this.ctx.world?.getHeightAt?.(p.x, p.z) ?? 0) + 6;
        e.known = w.isDiscovered(p.id);
      }
    }
    for (let i = 0; i < this.wayCount; i++) {
      const e = this.wayEntries[i];
      e.dist = Math.hypot(e.x - fx, e.z - fz);
      e.bearing = ((Math.atan2(e.x - fx, -(e.z - fz)) * RAD2DEG) % 360 + 360) % 360;
    }
    for (let i = 0; i < this.wildCount; i++) {
      const e = this.wildEntries[i];
      const dx = e.x - fx;
      const dz = e.z - fz;
      e.dist = Math.hypot(dx, dz);
      e.bearing = ((Math.atan2(dx, -dz) * RAD2DEG) % 360 + 360) % 360;
      if (!e.known && e.dist < DISCOVERY.reveal * 0.2) e.known = w.isDiscovered(e.poi.id);
    }
    // home bearings
    if (!w.inHub(fx, fz)) {
      const b = hubBorderPoint(fx, fz, this._bp);
      const h = this._hubEntry;
      h.x = b.x;
      h.z = b.z;
      h.dist = Math.hypot(b.x - fx, b.z - fz);
      h.bearing = ((Math.atan2(b.x - fx, -(b.z - fz)) * RAD2DEG) % 360 + 360) % 360;
      this.home.hub = h;
    } else this.home.hub = null;
    if (e.ok) {
      e.dist = Math.hypot(e.x - fx, e.z - fz);
      e.bearing = ((Math.atan2(e.x - fx, -(e.z - fz)) * RAD2DEG) % 360 + 360) % 360;
      this.home.base = e.dist > e.near ? e : null;
    } else this.home.base = null;
  }

  _collectMarkers() {
    const markers = this.ctx.markers;
    this.count = 0;
    this.tracked = null;
    if (!markers) return;
    const fx = this.focus.x;
    const fz = this.focus.z;
    let bestQuest = null;
    let flagged = null;
    let chosen = null;
    const iter = markers.map instanceof Map ? markers.map.values() : markers.list?.('world') || [];
    for (const m of iter) {
      if ((m.scope || 'world') !== 'world') continue;
      let p = m.pos || m.position;
      if (typeof p === 'function') {
        try {
          p = p();
        } catch {
          p = null;
        }
      }
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      // de-duplicate markers at the same spot (e.g. a quest objective on a POI):
      // quest beats poi, otherwise the first one wins
      let dup = false;
      for (let k = 0; k < this.count; k++) {
        const o = this.entries[k];
        if (Math.abs(o.x - p.x) > 18 || Math.abs(o.z - p.z) > 18) continue;
        if (o.m.kind === m.kind || (o.m.kind === 'quest' && m.kind === 'poi')) {
          dup = true;
          break;
        }
        if (m.kind === 'quest' && o.m.kind === 'poi') o.hidden = true;
      }
      if (dup) continue;
      let e = this.entries[this.count];
      if (!e) e = this.entries[this.count] = { m: null, x: 0, y: 0, z: 0, dist: 0, bearing: 0, hidden: false };
      this.count++;
      e.m = m;
      e.hidden = false;
      e.x = p.x;
      e.y = Number.isFinite(p.y) ? p.y : (this.ctx.world?.getHeightAt?.(p.x, p.z) ?? 0);
      e.z = p.z;
      const dx = p.x - fx;
      const dz = p.z - fz;
      e.dist = Math.hypot(dx, dz);
      e.bearing = ((Math.atan2(dx, -dz) * RAD2DEG) % 360 + 360) % 360;
      if (m.id === this.trackedId) chosen = e;
      if (m.kind === 'quest') {
        if (!flagged && (m.tracked || m.active)) flagged = e;
        if (!bestQuest || e.dist < bestQuest.dist) bestQuest = e;
      }
    }
    this.tracked = chosen || flagged || bestQuest;
  }
}
