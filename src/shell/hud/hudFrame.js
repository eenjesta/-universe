/**
 * Shared per-frame HUD data, computed once per frame without allocations:
 * the active camera heading, the focus position (player, or the vehicle in
 * 'drive'), its speed, and every world marker with distance + bearing.
 * Minimap, compass strip and screen markers all read from this.
 */
import * as THREE from 'three';
import { objectPosition } from '../util.js';

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
