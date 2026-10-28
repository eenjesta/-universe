/**
 * Remote players (characters module) → ctx.remotes (PLATFORM.md §7).
 *
 * Avatars of other players built with the character pipeline at crowd quality
 * (LOD 1, meshes from the build workers; a cached default look of the same body
 * stands in until the real one arrives), drawn by CharacterBatches of up to 8
 * players (≈ 7 draw calls for 50 players). Every frame each avatar is driven by
 * its net view `ctx.net.players.get(id).view` → { p, h, a, m, hp, sh, veh }:
 *   p/h   position (feet) + heading, lightly smoothed (smooth turning); speed and
 *         strafe direction are estimated from the motion (legs never slide)
 *   a     anim state: idle walk run sprint jump fall swim aim shoot reload hit
 *         dodge dead respawn sit wave (one-shots fire on change)
 *   m     mode: 'drive' → avatar hidden, the remote vehicle shown at veh {type, p, h}
 *         (remote-vehicles.js); 'space' → hidden; otherwise on foot
 *   hp/sh health / shield (absolute, max 100 / 50 unless view.maxHp / maxSh) → tag bars
 * Weapons: shown while the anim is aim/shoot/reload (and 6 s after); the kind
 * comes from view.w (when the snapshot carries it) or net:fired {w}; one InstancedMesh per kind (weapon-models.js), arms
 * solved by the WeaponRig IK within 35 m. Name tags (cyan, shield + health bars,
 * chat bubbles), distance LOD (animation rate 1/1 → 1/8 with distance, IK near
 * only), distance culling by render quality (avatars 120 / 190 / 420 m, vehicles × 1.6)
 * and outside the interest radius. Positions stay exact far from the origin (several km).
 * The world scene is read lazily: when ctx.world.scene changes everything re-parents.
 *
 * API: add(id, {name, appearance}) → remote, remove(id), get(id), list (array),
 *      count, clear(), mock(n) (fake players walking around; ?mockRemotes=N), triangles().
 * Remote: { id, name, appearance, object, position, heading, mode, anim, hp, sh,
 *          weapon, vehicle, character, say(text, s) }.
 * Listens: net:welcome / net:join / net:leave / net:profile / net:fired /
 *          net:death / net:respawned, net:chat (speech bubble above the speaker).
 * Emits: remote:add {id}, remote:remove {id}.
 */
import * as THREE from 'three';
import { Character, arraysKey, cachedArrays } from './character.js';
import { CharacterBatch } from './batch.js';
import { normalizeAppearance, appearanceKey } from './appearance.js';
import { requestArrays } from './build-client.js';
import { WeaponRig } from './weapon-rig.js';
import { RemoteWeapons } from './weapon-models.js';
import { createRemoteVehicles, VEH_TAG_HEIGHT } from './remote-vehicles.js';
import { createMockNet } from './remotes-mock.js';
import { GRIP_OF } from './player.js';
import { t } from '../core/i18n.js';
import { hashString } from '../core/math.js';

const BATCH_SIZE = 8;
const COMBAT = new Set(['aim', 'shoot', 'reload']);
const VEH_MODES = new Set(['car', 'vtol', 'ship']);
const STILL = new Set(['idle', 'aim', 'shoot', 'reload', 'sit', 'wave', 'dead', 'respawn', 'hit', 'build']);
const IK_DIST = 35;
const WEAPON_DIST = 90;
const ARMED_HOLD = 6; // s the weapon stays out after combat
const GONE_AFTER = 12; // s without a view before an unannounced remote is removed
/** Avatars farther than this from the camera (m) are culled, by render quality. */
const CULL = { low: 120, medium: 190, high: 420 };
const _cam = new THREE.Vector3();
const _v = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);

const sceneOf = (ctx) => ctx.world?.scene || ctx.engine?.scene || null;
const wrapPi = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const vx = (p) => p?.x ?? p?.[0];
const vy = (p) => p?.y ?? p?.[1];
const vz = (p) => p?.z ?? p?.[2];

export function createRemotes(ctx, { material, labels, fx = null }) {
  // the world scene is read lazily (planets / other worlds may swap it later): everything re-parents
  let scene = sceneOf(ctx);
  const list = [];
  const byId = new Map();
  const batches = [];
  const weapons = new RemoteWeapons(scene);
  const vehicles = createRemoteVehicles(ctx);
  let frame = 0;
  let clock = 0;
  let dirtyAt = Infinity;
  let cullDist = CULL.high;
  let mock = null;
  const placeholders = { m: null, f: null };

  // default looks (one per body) stand in while a remote's own mesh is built
  for (const body of ['m', 'f']) {
    const app = normalizeAppearance({ body });
    requestArrays(app, 1).then(() => (placeholders[body] = app));
  }

  const myId = () => ctx.net?.id ?? null;
  /** The players source: the mock (when running) or ctx.net. */
  const source = () => (mock ? mock : ctx.net);

  function markDirty() {
    dirtyAt = Math.min(dirtyAt, clock + 0.05);
  }

  function pickBatch() {
    for (const b of batches) if (b.chars.length < BATCH_SIZE) return b;
    const b = new CharacterBatch({ material, parent: scene, name: `remotes-${batches.length}` });
    batches.push(b);
    return b;
  }

  // ------------------------------------------------------------------ add
  function add(id, { name, appearance } = {}) {
    if (id == null) return null;
    id = String(id);
    if (id === String(myId())) return null;
    const known = byId.get(id);
    if (known) {
      if (name && name !== known.name) {
        known.name = name;
        labels.setName(known.label, name);
      }
      if (appearance) setAppearance(known, appearance);
      return known;
    }
    const app = normalizeAppearance(appearance || {});
    const cached = cachedArrays(arraysKey(app, 1));
    const ph = cached ? null : placeholders[app.body] || null;
    const chr = new Character(ph || app, { lod: 1, name: `remote-${id}`, seed: hashString(id) || 1, deferLoad: !cached && !ph });
    chr.object.name = `remote-${id}`;
    scene?.add(chr.object);
    pickBatch().add(chr);
    const r = {
      id,
      name: name || t({ en: 'Player', nl: 'Speler' }),
      appearance: app,
      character: chr,
      object: chr.object,
      position: chr.object.position,
      heading: 0,
      mode: 'foot',
      anim: 'idle',
      lastA: null,
      hp: 1,
      sh: 1,
      present: false,
      init: false,
      lastSeen: clock,
      vel: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      target: new THREE.Vector3(),
      rig: new WeaponRig(chr),
      weapon: null, // grip kind while shown
      weaponKind: 'pistol', // last known
      armedT: 0,
      aimPitch: 0,
      aimT: 9,
      vehicle: null,
      vehStub: { type: 'car', p: null, h: 0 },
      reviveT: 0, // s left of the respawn guard (the interpolated view still shows the corpse)
      spawnAt: new THREE.Vector3(),
      spawnPending: false,
      animAcc: 0,
      slot: hashString(id) & 7, // staggers the LOD animation ticks
      hiddenTag: true,
      label: null,
      say(text, seconds = 5) {
        labels.say(r.label, text, seconds);
      },
      headTop(out) {
        if (r.vehicle && r.mode === 'drive') {
          const o = r.vehicle.obj.position;
          return out.set(o.x, o.y + (VEH_TAG_HEIGHT[r.vehicle.type] || 2), o.z);
        }
        return chr.headTop(out);
      },
    };
    chr.onArrays = () => markDirty();
    if (ph) chr.setAppearanceAsync(app, 1);
    else if (chr.pending) chr.load();
    chr.setHidden(true);
    r.label = labels.add(r, r.name, { kind: 'player', bars: true, maxDistance: 70 });
    list.push(r);
    byId.set(id, r);
    markDirty();
    ctx.events.emit('remote:add', { id });
    return r;
  }

  function setAppearance(r, appearance) {
    const app = normalizeAppearance(appearance);
    if (appearanceKey(app) === appearanceKey(r.appearance)) return;
    r.appearance = app;
    if (r.character.setAppearanceAsync(app, 1) && !r.character._want) markDirty();
  }

  function remove(id) {
    const r = byId.get(String(id));
    if (!r) return false;
    byId.delete(r.id);
    list.splice(list.indexOf(r), 1);
    labels.remove(r.label);
    vehicles.release(r);
    r.rig.set(null);
    r.character.onArrays = null;
    r.object.removeFromParent();
    r.character.batch?.remove(r.character);
    markDirty();
    ctx.events.emit('remote:remove', { id: r.id });
    return true;
  }

  function clear() {
    for (const r of list.slice()) remove(r.id);
  }

  // --------------------------------------------------------------- update
  function hide(r) {
    if (!r.character.hidden) r.character.setHidden(true);
    r.hiddenTag = true;
    r.weapon = null;
  }

  function onAnim(r, a, prev) {
    const an = r.character.anim;
    if (prev === 'dead' && a !== 'dead') {
      an.revive();
      if (a !== 'respawn') return;
    }
    switch (a) {
      case 'shoot':
        if (r.aimT > 0.3) an.fire(0.8);
        break;
      case 'reload':
        an.reload();
        break;
      case 'hit':
        an.hit(0, 0.8);
        break;
      case 'dodge':
        an.dodge();
        break;
      case 'dead':
        an.die({ instant: prev == null });
        break;
      case 'respawn':
        an.revive();
        an.materialize();
        fx?.spawn(r.position, 0.85, r.character.frame.headC.y + 0.25, r.position);
        break;
      default:
        break;
    }
  }

  function updateRemote(r, dt, src, camPos, frustumOk) {
    const e = src?.players?.get?.(r.id);
    const v = e?.view;
    const chr = r.character;
    if (!v || !v.p || e.inRange === false || !Number.isFinite(vx(v.p))) {
      // out of the interest radius (or not announced yet): hidden; dropped once the source forgets it
      if (r.present) {
        r.present = false;
        r.init = false;
        hide(r);
        vehicles.release(r);
      }
      if (!e && clock - r.lastSeen > GONE_AFTER && !mock) remove(r.id);
      return;
    }
    r.lastSeen = clock;
    r.present = true;
    const maxHp = v.maxHp || 100;
    const maxSh = v.maxSh || 50;
    r.hp = Number.isFinite(v.hp) ? v.hp / maxHp : 1;
    r.sh = Number.isFinite(v.sh) ? v.sh / maxSh : 0;
    const m0 = typeof v.m === 'string' ? v.m : 'foot';
    let a = typeof v.a === 'string' ? v.a : 'idle';
    if (m0 === 'dead' || v.dead === true) a = 'dead';
    // just respawned (net:respawned): the interpolated view lags INTERP_DELAY behind and still shows the corpse
    if (r.reviveT > 0) {
      r.reviveT -= dt;
      if (a === 'dead') a = 'respawn';
      else r.spawnPending = false;
    } else r.spawnPending = false;
    const m = m0 === 'dead' ? 'foot' : m0;
    r.mode = m === 'drive' || VEH_MODES.has(m) ? 'drive' : m;
    if (a === 'drive' && r.mode !== 'drive') a = 'idle';
    r.anim = a;
    r.aimT += dt;
    r.armedT = Math.max(0, r.armedT - dt);

    // ---- space: not in this world
    if (r.mode === 'space') {
      hide(r);
      vehicles.release(r);
      return;
    }
    // ---- vehicles: avatar hidden, the vehicle model at veh (no veh → the player's own position)
    if (r.mode === 'drive') {
      hide(r);
      let veh = v.veh;
      if (!veh || veh.p == null) {
        r.vehStub.type = VEH_MODES.has(m) ? m : veh?.type || 'car';
        r.vehStub.p = v.p;
        r.vehStub.h = v.h;
        veh = r.vehStub;
      }
      // vehicles are big: drawn farther than avatars (cull × 1.6), released to the pool beyond that
      const vpx = vx(veh.p);
      const vpz = vz(veh.p);
      if (Number.isFinite(vpx + vpz) && Math.hypot(vpx - camPos.x, vpz - camPos.z) > cullDist * 1.6) {
        vehicles.release(r);
        r.position.set(vpx, vy(veh.p) || 0, vpz);
        r.hiddenTag = true;
        r.init = false;
        return;
      }
      const obj = vehicles.show(r, veh, dt, VEH_MODES.has(m) ? m : null);
      r.hiddenTag = !obj;
      if (obj) r.position.copy(obj.position);
      r.init = false;
      labels.setBars(r.label, r.hp, r.sh);
      return;
    }
    if (r.vehicle) vehicles.release(r);

    // ---- on foot
    const p = r.position;
    if (r.spawnPending) r.target.copy(r.spawnAt);
    else r.target.set(vx(v.p), vy(v.p), vz(v.p));
    const h = Number.isFinite(v.h) ? v.h : r.heading;
    if (!r.init || p.distanceToSquared(r.target) > 36) {
      p.copy(r.target);
      r.prev.copy(p);
      r.vel.set(0, 0, 0);
      r.heading = h;
      r.init = true;
      chr.anim.speed = 0;
      chr.anim.settle();
      if (r.lastA === null && a !== 'dead' && a !== 'respawn') r.lastA = a; // joined mid-action: no one-shot replay
    } else {
      // the net view is interpolated already; a light filter hides snapshot jitter
      const k = 1 - Math.exp(-18 * dt);
      p.x += (r.target.x - p.x) * k;
      p.y += (r.target.y - p.y) * k;
      p.z += (r.target.z - p.z) * k;
      const idt = 1 / Math.max(dt, 1e-3);
      const kv = 1 - Math.exp(-9 * dt);
      r.vel.x += ((p.x - r.prev.x) * idt - r.vel.x) * kv;
      r.vel.y += ((p.y - r.prev.y) * idt - r.vel.y) * kv;
      r.vel.z += ((p.z - r.prev.z) * idt - r.vel.z) * kv;
      r.prev.copy(p);
    }
    if (a !== r.lastA) {
      onAnim(r, a, r.lastA);
      r.lastA = a;
    }
    const prevH = r.heading;
    r.heading += wrapPi(h - r.heading) * (1 - Math.exp(-14 * dt));
    chr.object.rotation.y = r.heading;
    // distance culling (quality dependent): far avatars are neither drawn nor animated
    const dc = p.distanceTo(camPos);
    if (dc > cullDist) {
      hide(r);
      if (r.rig.kind) r.rig.set(null);
      r.animAcc = 0;
      return;
    }
    if (chr.hidden && !chr.pending) chr.setHidden(false);
    r.hiddenTag = chr.pending;

    // ---- animator inputs
    const an = chr.anim;
    const hs = Math.hypot(r.vel.x, r.vel.z);
    const combat = COMBAT.has(a);
    if (combat) r.armedT = ARMED_HOLD;
    // equipped weapon from the snapshot (view.w, when the protocol carries it); else from net:fired
    if (typeof v.w === 'string' && v.w) r.weaponKind = GRIP_OF[v.w] || r.weaponKind;
    an.speed = a === 'dead' || (STILL.has(a) && hs < 0.5) ? 0 : hs;
    an.grounded = !(a === 'jump' || a === 'fall');
    an.vy = a === 'jump' ? 3.5 : a === 'fall' ? -6 : 0;
    an.swimming = a === 'swim';
    an.turnRate = wrapPi(r.heading - prevH) / Math.max(dt, 1e-3);
    an.aimOn = combat;
    an.strafe = combat;
    an.moveAngle = hs > 0.3 ? Math.atan2(-r.vel.x, -r.vel.z) - r.heading : 0;
    if (r.aimT > 1.6) r.aimPitch *= 1 - Math.min(1, dt * 2);
    an.aimPitch = r.aimPitch;
    an.aimYaw = 0;
    an.set('sit', a === 'sit' ? 1 : 0);
    an.set('wave', a === 'wave' ? 1 : 0);
    an.set('tablet', a === 'build' ? 1 : 0);

    // ---- weapon (kind from net:fired; shown in combat + a while after)
    const armed = r.armedT > 0 && a !== 'swim' && a !== 'sit' && a !== 'wave';
    const kind = armed ? r.weaponKind : null;
    if (kind !== r.weapon) {
      r.weapon = kind;
      r.rig.set(kind);
    }

    // ---- LOD: animation rate + IK by camera distance; off-screen avatars tick slowly
    _sphere.center.set(p.x, p.y + 1, p.z);
    const onScreen = !frustumOk || _frustum.intersectsSphere(_sphere);
    const every = !onScreen ? 8 : dc < 30 ? 1 : dc < 70 ? 2 : dc < 140 ? 4 : 8;
    r.animAcc += dt;
    let posed = false;
    if ((frame + r.slot) % every === 0) {
      an.update(r.animAcc);
      r.animAcc = 0;
      posed = true;
    }
    if (kind && onScreen && dc < WEAPON_DIST) {
      r.rig.update(posed && dc < IK_DIST);
      weapons.push(kind, r.rig.matrixWorld);
    }
    labels.setBars(r.label, r.hp, r.sh);
    labels.setDim(r.label, a === 'dead');
  }

  /** Moves every remote object to a new world scene (planets / world switch). */
  function reparent(sc) {
    scene = sc;
    for (const r of list) sc.add(r.object);
    for (const b of batches) {
      b.parent = sc;
      if (b.mesh) sc.add(b.mesh);
    }
    for (const k in weapons.meshes) sc.add(weapons.meshes[k]);
    sc.add(vehicles.root);
  }

  function update(dt) {
    frame++;
    clock += dt;
    const sc = sceneOf(ctx);
    if (sc && sc !== scene) reparent(sc);
    mock?.update(dt);
    if (clock >= dirtyAt) {
      dirtyAt = Infinity;
      for (const b of batches) if (b.dirty) b.rebuild();
    }
    const src = source();
    // late joiners / missed join events: pick up every player the source knows
    if (src?.players && frame % 20 === 0) {
      const me = String(myId());
      for (const [id, e] of src.players) {
        if (!byId.has(String(id)) && String(id) !== me) add(id, { name: e?.name, appearance: e?.appearance });
      }
    }
    if (!list.length) {
      weapons.begin();
      weapons.end();
      return;
    }
    const cam = ctx.engine?.camera || ctx.camera;
    cam.getWorldPosition(_cam);
    let frustumOk = false;
    if (cam.projectionMatrix && cam.matrixWorldInverse) {
      _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pv);
      frustumOk = true;
    }
    const q = ctx.engine?.quality?.id;
    cullDist = q === 'low' ? CULL.low : q === 'medium' ? CULL.medium : CULL.high;
    weapons.begin();
    for (let i = list.length - 1; i >= 0; i--) updateRemote(list[i], dt, src, _cam, frustumOk);
    weapons.end();
    for (const b of batches) {
      // a batch whose members are all hidden / culled is not drawn at all
      let vis = false;
      for (const c of b.chars) if (!c.hidden) vis = true;
      if (b.visible !== vis) {
        b.visible = vis;
        if (b.mesh) b.mesh.visible = vis;
      }
      if (vis) b.updateBounds();
    }
  }

  // --------------------------------------------------------------- events
  function fired({ id, w, d } = {}) {
    const r = byId.get(String(id));
    if (!r) return;
    if (w) r.weaponKind = GRIP_OF[w] || (w === 'pistol' || w === 'rifle' || w === 'heavy' ? w : 'pistol');
    r.armedT = ARMED_HOLD;
    r.character.anim.fire(r.weaponKind === 'heavy' ? 1.5 : r.weaponKind === 'rifle' ? 0.75 : 1);
    r.aimT = 0;
    const dy = vy(d);
    if (Number.isFinite(dy)) r.aimPitch = Math.asin(Math.max(-1, Math.min(1, dy / (Math.hypot(vx(d), dy, vz(d)) || 1))));
  }

  function welcome(msg) {
    const net = ctx.net;
    const ps = msg?.world?.players;
    const keep = new Set();
    if (Array.isArray(ps)) {
      for (const p of ps) {
        if (p?.id == null) continue;
        keep.add(String(p.id));
        add(p.id, { name: p.name, appearance: p.appearance });
      }
    }
    if (net?.players) {
      for (const [id, e] of net.players) {
        keep.add(String(id));
        add(id, { name: e?.name, appearance: e?.appearance });
      }
    }
    // (re)connected to a world: players of the previous session are gone
    if (!mock && Array.isArray(ps)) for (const r of list.slice()) if (!keep.has(r.id)) remove(r.id);
  }

  const offs = [
    ctx.events.on('net:welcome', (m) => welcome(m)),
    ctx.events.on('net:join', (m) => m?.id != null && add(m.id, m)),
    ctx.events.on('net:leave', (m) => m?.id != null && remove(m.id)),
    ctx.events.on('net:profile', (m) => {
      const r = m?.id != null && byId.get(String(m.id));
      if (r) add(r.id, { name: m.name, appearance: m.appearance });
    }),
    ctx.events.on('net:fired', (m) => fired(m)),
    ctx.events.on('net:death', (m) => {
      const r = byId.get(String(m?.id));
      if (r && !r.character.anim.dead) r.character.anim.die({});
    }),
    ctx.events.on('net:respawned', (m) => {
      const r = byId.get(String(m?.id));
      if (!r) return;
      r.init = false;
      const sp = m.p;
      if (Number.isFinite(vx(sp)) && Number.isFinite(vy(sp)) && Number.isFinite(vz(sp))) {
        r.spawnAt.set(vx(sp), vy(sp), vz(sp));
        r.spawnPending = true;
        r.reviveT = 1.2;
      } else r.reviveT = 0.6;
      if (r.lastA === 'respawn') return;
      onAnim(r, 'respawn', 'dead');
      r.lastA = 'respawn';
    }),
    ctx.events.on('net:chat', (m) => {
      if (!m || m.sys || !m.text || m.from == null) return;
      const r = byId.get(String(m.from));
      if (r && r.present) r.say(m.text, 5);
    }),
  ];

  const api = {
    add,
    remove,
    get: (id) => byId.get(String(id)) || null,
    get list() {
      return list;
    },
    get count() {
      return list.length;
    },
    clear,
    update,
    /** Debug / offline test: n fake players walking, fighting and driving around the local player (0 stops). */
    mock(n = 6, opts = {}) {
      if (mock) {
        for (const id of mock.ids) remove(id);
        mock = null;
      }
      if (n > 0) {
        mock = createMockNet(ctx, n, opts);
        for (const p of mock.list) add(p.id, { name: p.name, appearance: p.appearance });
        mock.onFire = fired;
      }
      return mock;
    },
    get mocking() {
      return !!mock;
    },
    batches,
    weapons,
    vehicles,
    triangles() {
      return batches.reduce((s, b) => s + b.triangles, 0);
    },
    dispose() {
      offs.forEach((o) => o());
      clear();
      weapons.dispose();
      vehicles.dispose();
      for (const b of batches) b.dispose();
    },
  };
  return api;
}
