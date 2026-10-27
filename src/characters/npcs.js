/**
 * NPCs (characters module) → ctx.npcs.
 *
 * Named NPCs (Luna_Ø, Kai, Nova, Yara, Milan at the plaza, Aria at the signal,
 * Oran at his stall, Jules at the spaceport), a plaza crowd of wandering,
 * chatting and sitting citizens, spaceport technicians and base builders.
 * Characters are drawn per area by CharacterBatches (one draw call each).
 *
 * NPC API: { id, name, object, position, appearance, character,
 *   say(text, seconds), setGoal(vec3 | null), follow(object | null), lookAt(vec3 | null) }
 * Manager: { list, get(id), party (Set), named, spawn(def), ... }
 * Events: emits npc:interact {id} (E near a named NPC), npc:say {id, text};
 * listens to event:start / event:end (id 'starfall' → crowd gathers + cheers).
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { Rng, clamp, damp, dampAngle, angleDiff } from '../core/math.js';
import { Character } from './character.js';
import { CharacterBatch } from './batch.js';
import { normalizeAppearance } from './appearance.js';
import { NAMED, CROWD_LINES, crowdAppearances, technicianAppearances, builderAppearances, postSpots } from './npc-roster.js';
import { NavGraph } from './nav.js';
import { requestArrays } from './build-client.js';

const CROWD = 24;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _cam = new THREE.Vector3();

export function createNpcs(ctx, { material, labels }) {
  const world = ctx.world;
  const scene = world.scene;
  const rng = new Rng('npcs');
  const batches = {};
  const list = [];
  const byId = new Map();
  const party = new Set();
  let frame = 0;
  let clockT = 0; // seconds since install (for throttled batch rebuilds)
  let dirtyAt = Infinity; // when the next batch rebuild is due
  let eventActive = false;
  let chatterT = 6;

  const batchList = []; // cached Object.values(batches) (no per-frame allocation)
  const batch = (key) => {
    if (!batches[key]) {
      batches[key] = new CharacterBatch({ material, parent: scene, name: `npcs-${key}` });
      batchList.push(batches[key]);
    }
    return batches[key];
  };

  const terrainH = (x, z) => {
    const h = world.getHeightAt ? world.getHeightAt(x, z) : 0;
    return Number.isFinite(h) ? h : 0;
  };
  const groundAt = (x, z, feetY) => {
    const th = terrainH(x, z);
    const g = ctx.physics.groundHeight(x, z, feetY ?? th + 1.2, 0.6, 0.15);
    return Number.isFinite(g) ? g : th;
  };

  // --------------------------------------------------------------- data
  const plazaData = ctx.landmarks?.plaza || null;
  const PL = ZONES.plaza;
  const tree = PL.tree;
  const stage = PL.stage;
  const walkPoints = (plazaData?.walkPoints?.length ? plazaData.walkPoints : fallbackWalkPoints()).map((p) => new THREE.Vector3(p.x, 0, p.z));
  const benches = Array.isArray(plazaData?.benches) ? plazaData.benches.filter((b) => b?.position) : [];
  const crowdPoints = (plazaData?.stage?.crowdPoints?.length ? plazaData.stage.crowdPoints : fallbackCrowdPoints()).map((p) => new THREE.Vector3(p.x, 0, p.z));
  const sp0 = plazaData?.stage?.position;
  const stagePos = sp0 && Number.isFinite(sp0.x) ? new THREE.Vector3(sp0.x, 0, sp0.z) : new THREE.Vector3(stage.x, 0, stage.z);
  // navigation graph over the plaza paving (walk around the tree, stage and stalls)
  const treeR = (plazaData?.treeInfo?.radius ?? tree.trunkRadius) + 1.1;
  let nav = null;
  try {
    nav = new NavGraph(walkPoints.concat(crowdPoints), { physics: ctx.physics, maxEdge: 13, blockers: [{ x: tree.x, z: tree.z, r: treeR }] });
  } catch (err) {
    console.warn('[characters] plaza nav graph failed — NPCs walk straight', err);
  }

  function fallbackWalkPoints() {
    const pts = [];
    const r = new Rng('walk');
    for (const rad of [13, 20, 28, 37, 46]) {
      const n = Math.round(rad * 0.42);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r.range(-0.2, 0.2);
        const x = tree.x + Math.sin(a) * rad;
        const z = tree.z + Math.cos(a) * rad;
        if (Math.hypot(x - stage.x, z - stage.z) < 17) continue;
        if (terrainH(x, z) < 0.6) continue;
        pts.push({ x, z });
      }
    }
    return pts;
  }
  function fallbackCrowdPoints() {
    const pts = [];
    const r = new Rng('crowd-pts');
    for (let row = 0; row < 5; row++) {
      for (let i = 0; i < 9; i++) {
        const x = stage.x + (i - 4) * 2.6 + r.range(-0.6, 0.6) + (row % 2) * 1.1;
        const z = stage.z + 12 + row * 2.6 + r.range(-0.5, 0.5);
        pts.push({ x, z });
      }
    }
    return pts;
  }

  // ---------------------------------------------------------------- NPC
  function makeNpc(def) {
    const app = normalizeAppearance(def.app);
    // meshes come from the build worker (see loadAll); until then the NPC draws nothing
    const chr = new Character(app, { lod: def.lod ?? 1, name: def.id, seed: def.seed ?? rng.int(1, 1e9), deferLoad: true });
    scene.add(chr.object);
    const bkey = def.name ? `named-${def.id}` : def.area;
    batch(bkey).add(chr);
    const home = new THREE.Vector3(def.x, 0, def.z);
    const npc = {
      id: def.id,
      name: def.name || null,
      named: !!def.name,
      area: def.area,
      object: chr.object,
      position: chr.object.position,
      appearance: app,
      character: chr,
      home,
      homeHeading: def.heading ?? 0,
      mode: def.mode || 'post', // post | wander | group | sit | goal | follow | gather
      baseMode: def.mode || 'post',
      act: def.act || null,
      goal: null,
      goalHeading: null,
      followTarget: null,
      lookOverride: null,
      velocity: new THREE.Vector3(),
      speed: 0,
      walkSpeed: def.walkSpeed ?? rng.range(1.05, 1.5),
      timer: rng.range(0, 6),
      heading: def.heading ?? 0,
      faceHeading: def.heading ?? 0,
      lines: def.lines || null,
      label: null,
      groupId: def.group || null,
      waveCooldown: 0,
      greeted: false,
      lodAcc: 0,
      animAcc: 0,
      hiddenTag: false,
      busy: false,
      interactId: null,
      batchKey: bkey,
      route: [],
      routeIdx: 0,
      stuckT: 0,
      lastD: Infinity,
      wantLod: def.lod ?? 1,
      lodPending: false,
      _y: 0,
      ready: !chr.pending,
      say(text, seconds = 4) {
        if (!npc.label) npc.label = labels.add(npc, npc.name || '', { kind: npc.named ? 'npc' : 'anon' });
        labels.say(npc.label, text, seconds);
        ctx.events.emit('npc:say', { id: npc.id, text });
      },
      setGoal(v, heading) {
        if (v) {
          npc.goal = new THREE.Vector3(v.x, 0, v.z);
          npc.goalHeading = heading ?? null;
          npc.mode = 'goal';
          planRoute(npc);
        } else {
          npc.goal = null;
          npc.mode = npc.baseMode;
        }
      },
      follow(obj) {
        npc.followTarget = obj || null;
        if (obj) {
          npc.mode = 'follow';
          if (obj === ctx.player?.object) party.add(npc.id);
        } else {
          party.delete(npc.id);
          npc.mode = npc.baseMode;
          npc.goal = new THREE.Vector3().copy(npc.home);
          npc.mode = 'goal';
          npc.goalHeading = npc.homeHeading;
          planRoute(npc);
        }
      },
      lookAt(v) {
        npc.lookOverride = v ? new THREE.Vector3().copy(v) : null;
      },
      headTop(out) {
        return chr.headTop(out);
      },
    };
    chr.heading = npc.heading;
    npc.hiddenTag = chr.pending;
    chr.onArrays = () => {
      npc.ready = true;
      npc.hiddenTag = false;
      dirtyAt = Math.min(dirtyAt, clockT + 0.05);
    };
    place(npc, def.x, def.z);
    if (npc.act) chr.anim.set(npc.act, 1);
    chr.anim.settle();
    list.push(npc);
    byId.set(npc.id, npc);
    if (npc.named) {
      npc.label = labels.add(npc, npc.name, { kind: 'npc' });
      addInteraction(npc);
    }
    return npc;
  }

  function place(npc, x, z) {
    const y = groundAt(x, z);
    npc.object.position.set(x, y, z);
    npc._y = y;
  }

  /** Computes waypoints toward npc.goal through the plaza nav graph. */
  function planRoute(npc) {
    npc.route.length = 0;
    npc.routeIdx = 0;
    npc.stuckT = 0;
    npc.lastD = Infinity;
    if (!nav || !npc.goal || npc.area !== 'plaza') return;
    const p = npc.object.position;
    const r = nav.route(p.x, p.z, npc.goal.x, npc.goal.z);
    for (const w of r) npc.route.push(w);
  }

  // interactions: "[E] Praten" floating beside the NPC's head
  function addInteraction(npc) {
    const pos = new THREE.Vector3();
    const anchor = new THREE.Vector3();
    npc.interactId = ctx.interactions.add({
      id: `npc-${npc.id}`,
      scope: 'world',
      radius: 3.3,
      label: 'Praten',
      priority: 1,
      position: () => pos.copy(npc.object.position).setY(npc.object.position.y + 1.0),
      anchor: () => {
        npc.headTop(anchor);
        anchor.y -= 0.2;
        const r = ctx.cameraRig?.rightVec;
        if (r) anchor.addScaledVector(r, 0.34);
        return anchor;
      },
      enabled: () => !npc.busy && ctx.modes.is('explore'),
      onInteract: () => interact(npc),
    });
  }

  function interact(npc) {
    const p = ctx.player?.object?.position;
    if (p) {
      npc.faceHeading = Math.atan2(-(p.x - npc.position.x), -(p.z - npc.position.z));
      npc.talkT = 3;
    }
    ctx.events.emit('npc:interact', { id: npc.id });
    // graceful fallback: if no dialogue opened, greet with a speech bubble
    setTimeout(() => {
      if (!ctx.dialogue?.isOpen && npc.lines?.length) npc.say(npc.lines[0], 4.5);
    }, 60);
  }

  // ------------------------------------------------------------ spawn all
  const spots = postSpots(ctx);
  // named plaza NPCs: two chatting groups between the road end and the tree
  // snap the desired spots to free paving (walk points avoid props)
  const snapToWalk = (x, z) => {
    let best = null;
    let bd = Infinity;
    for (const w of walkPoints) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best && bd < 12 ? new THREE.Vector3(best.x, 0, best.z) : new THREE.Vector3(x, 0, z);
  };
  const groupCenters = {
    a: snapToWalk(tree.x - 7, tree.z + 22),
    b: snapToWalk(tree.x + 11, tree.z + 19),
  };
  const groupMembers = { a: [], b: [] };
  for (const n of NAMED) {
    let x;
    let z;
    let heading = 0;
    let mode = 'post';
    let act = null;
    if (n.area === 'plaza' && n.group) {
      const gc = groupCenters[n.group];
      const k = groupMembers[n.group].length;
      const cnt = NAMED.filter((m) => m.group === n.group).length;
      const a = (k / cnt) * Math.PI * 2 + (n.group === 'a' ? 0.4 : 1.2);
      x = gc.x + Math.sin(a) * 1.25;
      z = gc.z + Math.cos(a) * 1.25;
      heading = Math.atan2(-(gc.x - x), -(gc.z - z));
      mode = 'group';
    } else if (spots[n.id]) {
      ({ x, z, heading } = spots[n.id]);
      if (n.id === 'jules') act = 'tablet';
    } else {
      x = PL.x;
      z = PL.z + 30;
    }
    const npc = makeNpc({ id: n.id, name: n.name, area: n.area, app: n.app, lod: n.lod, x, z, heading, mode, act, lines: n.lines, group: n.group });
    if (n.group) groupMembers[n.group].push(npc);
    npc.groupCenter = n.group ? groupCenters[n.group] : null;
  }

  // crowd
  const crowdApps = crowdAppearances(CROWD);
  const benchSlots = [];
  for (const b of benches.slice(0, 6)) {
    const p = b.position;
    const r = b.rotY ?? 0;
    // two seats per bench
    for (const off of [-0.45, 0.45]) benchSlots.push({ x: p.x + Math.cos(r) * off, z: p.z - Math.sin(r) * off, heading: r, y: p.y });
  }
  const crowdGroups = [];
  {
    const gr = new Rng('crowd-groups');
    for (let g = 0; g < 3; g++) {
      const wp = walkPoints[gr.int(0, walkPoints.length - 1)];
      crowdGroups.push({ center: new THREE.Vector3(wp.x + gr.range(-2, 2), 0, wp.z + gr.range(-2, 2)), members: [] });
    }
  }
  for (let i = 0; i < CROWD; i++) {
    const app = crowdApps[i];
    let mode = 'wander';
    let x;
    let z;
    let heading = rng.range(-Math.PI, Math.PI);
    let seat = null;
    let grp = null;
    if (i < 4 && benchSlots.length > i) {
      seat = benchSlots[i * 2 < benchSlots.length ? i * 2 : i];
      mode = 'sit';
      x = seat.x;
      z = seat.z;
      heading = seat.heading;
    } else if (i < 13) {
      grp = crowdGroups[i % 3];
      const k = grp.members.length;
      const a = k * 2.2 + i;
      x = grp.center.x + Math.sin(a) * 1.15;
      z = grp.center.z + Math.cos(a) * 1.15;
      heading = Math.atan2(-(grp.center.x - x), -(grp.center.z - z));
      mode = 'group';
    } else {
      const wp = walkPoints[rng.int(0, walkPoints.length - 1)];
      x = wp.x + rng.range(-1.5, 1.5);
      z = wp.z + rng.range(-1.5, 1.5);
    }
    const npc = makeNpc({ id: `citizen-${i}`, area: 'plaza', app, lod: 1, x, z, heading, mode });
    npc.seat = seat;
    if (grp) {
      grp.members.push(npc);
      npc.groupCenter = grp.center;
    }
    if (seat) {
      // landmarks give the seat itself (y = seat height in world space)
      const sh = Number.isFinite(seat.y) ? seat.y - npc.position.y : 0.46;
      npc.character.anim.seatHeight = clamp(sh > 0.2 ? sh : 0.46, 0.36, 0.62);
      npc.character.anim.set('sit', 1);
      npc.character.anim.settle();
    }
  }

  // spaceport technicians + base builders
  technicianAppearances(spots.techs.length).forEach((app, i) => {
    const s = spots.techs[i];
    makeNpc({ id: `tech-${i}`, area: 'spaceport', app, lod: 1, x: s.x, z: s.z, heading: s.heading, mode: 'post', act: s.act });
  });
  builderAppearances().forEach((app, i) => {
    const s = spots.builders[i];
    makeNpc({ id: `builder-${i}`, area: 'base', app, lod: 1, x: s.x, z: s.z, heading: s.heading, mode: 'post', act: 'tablet' });
  });

  for (const b of batchList) b.rebuild();

  // Build every NPC mesh in the worker pool, nearest to the player first.
  function loadAll(origin) {
    const o = origin || ctx.player?.object?.position || new THREE.Vector3(ZONES.spawn.x, 0, ZONES.spawn.z);
    const order = list.filter((x) => x.character.pending).sort((a, b) => {
      const da = a.object.position.distanceToSquared(o) - (a.named ? 400 : 0);
      const db = b.object.position.distanceToSquared(o) - (b.named ? 400 : 0);
      return da - db;
    });
    for (const npc of order) npc.character.load();
  }
  loadAll();

  // ------------------------------------------------------------- behaviour
  function pickWander(npc) {
    // prefer nearby points so strollers drift around the plaza instead of crossing it
    let wp = null;
    const p = npc.object.position;
    for (let tries = 0; tries < 6; tries++) {
      const c = walkPoints[rng.int(0, walkPoints.length - 1)];
      if (!wp || Math.hypot(c.x - p.x, c.z - p.z) < 34) {
        wp = c;
        if (Math.hypot(c.x - p.x, c.z - p.z) < 34) break;
      }
    }
    npc.goal = new THREE.Vector3(wp.x + rng.range(-0.8, 0.8), 0, wp.z + rng.range(-0.8, 0.8));
    npc.goalHeading = null;
    planRoute(npc);
  }

  function updateNpc(npc, dt, distCam, playerPos) {
    const chr = npc.character;
    const a = chr.anim;
    const pos = npc.object.position;
    let tvx = 0;
    let tvz = 0;
    let face = npc.faceHeading;
    npc.timer -= dt;
    npc.waveCooldown -= dt;
    if (npc.talkT > 0) npc.talkT -= dt;
    const dPlayer = playerPos ? Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z) : 1e9;

    // ---- decide goal / velocity by mode
    switch (npc.mode) {
      case 'wander':
        if (!npc.goal && npc.timer <= 0) pickWander(npc);
        break;
      case 'follow': {
        const t = npc.followTarget;
        if (t) {
          t.getWorldPosition(_w);
          const d = Math.hypot(_w.x - pos.x, _w.z - pos.z);
          if (d > 60) {
            // fell far behind (vehicle, teleport): pop in behind the target
            place(npc, _w.x + 2.5, _w.z + 2.5);
          } else if (d > 2.6) {
            const sp = clamp((d - 2.4) * 1.8, 1.1, 7.2);
            tvx = ((_w.x - pos.x) / d) * sp;
            tvz = ((_w.z - pos.z) / d) * sp;
          } else face = Math.atan2(-(_w.x - pos.x), -(_w.z - pos.z));
        }
        break;
      }
      default:
        break;
    }
    if (npc.goal && npc.mode !== 'follow') {
      // waypoint target (route) or the goal itself
      let tx = npc.goal.x;
      let tz = npc.goal.z;
      if (npc.routeIdx < npc.route.length) {
        const w = npc.route[npc.routeIdx];
        if (Math.hypot(w.x - pos.x, w.z - pos.z) < 1.6) {
          npc.routeIdx++;
          npc.lastD = Infinity;
        }
        if (npc.routeIdx < npc.route.length) {
          tx = npc.route[npc.routeIdx].x;
          tz = npc.route[npc.routeIdx].z;
        }
      }
      const dGoal = Math.hypot(npc.goal.x - pos.x, npc.goal.z - pos.z);
      const dx = tx - pos.x;
      const dz = tz - pos.z;
      const d = Math.max(1e-4, Math.hypot(dx, dz));
      // stuck detector (progress toward the current waypoint): skip it, or settle / give up
      if (d < npc.lastD - 0.2) {
        npc.lastD = d;
        npc.stuckT = 0;
      } else if ((npc.stuckT += dt) > 1.6) {
        npc.stuckT = 0;
        npc.lastD = Infinity;
        if (npc.routeIdx < npc.route.length) npc.routeIdx++;
        else if (npc.mode === 'gather' && dGoal < 7) {
          npc.gathered = true;
          npc.goal = null;
        } else if (npc.mode === 'wander') {
          npc.goal = null;
          npc.timer = rng.range(1.5, 4);
        }
      }
      if (!npc.goal) {
        // settled / gave up this frame
      } else if (dGoal < (npc.mode === 'gather' ? 1.0 : 0.45)) {
        npc.goal = null;
        if (npc.goalHeading != null) face = npc.faceHeading = npc.goalHeading;
        if (npc.mode === 'wander') npc.timer = rng.range(2.5, 9);
        if (npc.mode === 'goal') npc.mode = npc.baseMode;
        if (npc.mode === 'gather') npc.gathered = true;
      } else {
        const base = npc.mode === 'gather' ? (dGoal > 9 ? 3.6 : 1.8) : npc.walkSpeed;
        const sp = base * clamp(dGoal / 1.2, 0.35, 1);
        tvx = (dx / d) * sp;
        tvz = (dz / d) * sp;
      }
    }

    // ---- separation (others + player)
    if (tvx || tvz || npc.speed > 0.05) {
      for (const o of list) {
        if (o === npc || o.area !== npc.area) continue;
        const ox = pos.x - o.object.position.x;
        const oz = pos.z - o.object.position.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < 0.64 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          tvx += (ox / d) * (0.8 - d) * 2.5;
          tvz += (oz / d) * (0.8 - d) * 2.5;
        }
      }
      if (playerPos && dPlayer < 1.1 && dPlayer > 1e-3) {
        tvx += ((pos.x - playerPos.x) / dPlayer) * (1.1 - dPlayer) * 3;
        tvz += ((pos.z - playerPos.z) / dPlayer) * (1.1 - dPlayer) * 3;
      }
      // keep clear of the tree trunk (fallback when landmarks add no box)
      const tx = pos.x - tree.x;
      const tz = pos.z - tree.z;
      const td = Math.hypot(tx, tz);
      if (td < tree.trunkRadius + 1.6 && npc.area === 'plaza') {
        tvx += (tx / td) * 2;
        tvz += (tz / td) * 2;
      }
    }

    // ---- integrate
    const v = npc.velocity;
    v.x = damp(v.x, tvx, 5, dt);
    v.z = damp(v.z, tvz, 5, dt);
    npc.speed = Math.hypot(v.x, v.z);
    if (npc.speed > 0.02) {
      pos.x += v.x * dt;
      pos.z += v.z * dt;
      ctx.physics.resolveCylinder(pos, 0.3, 1.7, 0.6);
      npc._y = groundAt(pos.x, pos.z, npc._y);
      if (npc.speed > 0.25) face = Math.atan2(-v.x, -v.z);
    }
    pos.y = damp(pos.y, npc._y, 12, dt);

    // ---- look at the player / turn toward them
    const named = npc.named;
    const near = playerPos && dPlayer < (named ? 7.5 : 3.2) && ctx.modes.is('explore');
    if (npc.lookOverride) a.lookAt(npc.lookOverride);
    else if (near && npc.mode !== 'gather') {
      _w.set(playerPos.x, playerPos.y + 1.55, playerPos.z);
      a.lookAt(_w);
      if (named && npc.speed < 0.2 && npc.mode !== 'sit') {
        const toP = Math.atan2(-(playerPos.x - pos.x), -(playerPos.z - pos.z));
        if (Math.abs(angleDiff(npc.heading, toP)) > 1.0 || npc.talkT > 0) face = toP;
      }
      if (named && !npc.greeted && npc.waveCooldown <= 0 && dPlayer < 7 && npc.mode !== 'sit') {
        npc.greeted = true;
        npc.waveCooldown = 45;
        npc.waveT = 1.8;
      }
    } else if (npc.mode === 'group' && npc.groupCenter) {
      a.lookAt(null);
      face = Math.atan2(-(npc.groupCenter.x - pos.x), -(npc.groupCenter.z - pos.z));
    } else a.lookAt(null);
    if (!near && dPlayer > 14) npc.greeted = false;
    if (npc.mode === 'gather' && npc.gathered) face = Math.atan2(-(stagePos.x - pos.x), -(stagePos.z - pos.z));

    const prevH = npc.heading;
    npc.heading = dampAngle(npc.heading, face, npc.speed > 0.25 ? 6 : 3.2, dt);
    chr.heading = npc.heading;

    // ---- actions
    const cheering = npc.mode === 'gather' && npc.gathered && eventActive;
    a.set('cheer', cheering && npc.cheerKind === 'cheer' ? 1 : 0);
    a.set('clap', cheering && npc.cheerKind === 'clap' ? 1 : 0);
    let wave = cheering && npc.cheerKind === 'wave' ? 1 : 0;
    if (npc.waveT > 0) {
      npc.waveT -= dt;
      wave = 1;
    }
    a.set('wave', wave);
    const grouped = npc.mode === 'group' && npc.speed < 0.2;
    let talk = 0;
    if (grouped) {
      // turn-taking: one speaker per group at a time
      talk = npc.speaking ? 1 : 0.18;
    }
    if (npc.talkT > 0) talk = 1;
    a.set('talk', talk);
    a.set('tablet', npc.act === 'tablet' && npc.speed < 0.6 ? 1 : 0);
    a.set('sit', npc.mode === 'sit' ? 1 : 0);
    a.speed = npc.speed;
    a.grounded = true;
    a.vy = 0;
    a.swimming = false;
    a.turnRate = angleDiff(prevH, npc.heading) / Math.max(dt, 1e-3);

    // ---- animation LOD
    npc.animAcc += dt;
    const every = distCam < 40 ? 1 : distCam < 90 ? 3 : distCam < 160 ? 6 : 0;
    if (every && frame % every === 0) {
      a.update(npc.animAcc);
      npc.animAcc = 0;
    }
  }

  function updateGroups(dt) {
    for (const g of [...Object.values(groupMembers), ...crowdGroups.map((c) => c.members)]) {
      if (!g.length) continue;
      g._t = (g._t ?? Math.random() * 4) - dt;
      if (g._t <= 0) {
        g._t = 2.5 + Math.random() * 4;
        const idx = Math.floor(Math.random() * g.length);
        g.forEach((m, i) => (m.speaking = i === idx));
      }
    }
  }

  // ambient chatter bubbles from named plaza NPCs near the player
  function chatter(dt, playerPos) {
    chatterT -= dt;
    if (chatterT > 0 || !playerPos || !ctx.modes.is('explore')) return;
    chatterT = 9 + Math.random() * 12;
    const near = list.filter((n) => n.named && n.area === 'plaza' && n.lines && n.object.position.distanceTo(playerPos) < 22);
    if (!near.length) return;
    const n = near[Math.floor(Math.random() * near.length)];
    const pool = eventActive ? CROWD_LINES : n.lines;
    n.say(pool[Math.floor(Math.random() * pool.length)], 3.8);
  }

  // ------------------------------------------------------------- events
  function startGathering() {
    eventActive = true;
    const plazaNpcs = list.filter((n) => n.area === 'plaza' && n.id !== 'oran' && n.mode !== 'follow');
    const pts = crowdPoints.slice();
    new Rng('gather').shuffle(pts);
    plazaNpcs.forEach((n, i) => {
      const p = pts[i % pts.length];
      n.mode = 'gather';
      n.gathered = false;
      n.goal = new THREE.Vector3(p.x + (i >= pts.length ? 1.2 : 0), 0, p.z + (i >= pts.length ? 1.2 : 0));
      n.goalHeading = Math.atan2(-(stagePos.x - n.goal.x), -(stagePos.z - n.goal.z));
      planRoute(n);
      const r = Math.random();
      n.cheerKind = r < 0.55 ? 'cheer' : r < 0.85 ? 'clap' : 'wave';
      if (n.seat) n.character.anim.set('sit', 0);
    });
  }
  function endGathering() {
    eventActive = false;
    for (const n of list) {
      if (n.mode !== 'gather') continue;
      n.gathered = false;
      n.mode = n.baseMode;
      if (n.seat) n.goal = new THREE.Vector3(n.seat.x, 0, n.seat.z);
      else n.goal = new THREE.Vector3(n.home.x, 0, n.home.z);
      n.goalHeading = n.homeHeading;
      planRoute(n);
      if (n.baseMode !== 'wander') {
        n.mode = 'goal';
        n.baseMode = n.baseMode === 'goal' ? 'post' : n.baseMode;
      }
    }
  }
  const offs = [
    ctx.events.on('event:start', (e) => {
      if (e?.id === 'starfall') startGathering();
    }),
    ctx.events.on('event:end', (e) => {
      if (e?.id === 'starfall') endGathering();
    }),
  ];

  // ---------------------------------------------------------------- LOD
  // Named NPCs start at the cheap crowd LOD and swap to the hero mesh (cached
  // arrays, pre-built in idle time) when the camera comes close.
  const LOD_NEAR = 15;
  const LOD_FAR = 24;
  function updateLod(npc, dc) {
    const chr = npc.character;
    if (chr.pending) return;
    const want = dc < LOD_NEAR ? 0 : dc > LOD_FAR ? 1 : npc.wantLod;
    if (want === npc.wantLod && (want === chr.lod || chr._want)) return;
    npc.wantLod = want;
    // cached meshes swap at once, otherwise the worker builds it and onArrays merges it
    if (chr.setAppearanceAsync(npc.appearance, want) && !chr._want) chr.batch?.rebuild();
  }
  // pre-build the named NPCs' hero meshes in the worker once the game runs
  let prewarmTimer = null;
  const prewarmAll = async () => {
    for (const n of list.filter((x) => x.named)) {
      try {
        await requestArrays(n.appearance, 0);
      } catch (err) {
        console.warn('[characters] LOD0 prewarm failed', err);
      }
    }
  };
  const offReady = ctx.events.on('game:ready', () => {
    prewarmTimer = setTimeout(prewarmAll, 800);
  });

  // ------------------------------------------------------------- update
  function update(dt) {
    frame++;
    clockT += dt;
    // merge newly arrived meshes into their batches (at most ~4×/s)
    if (clockT >= dirtyAt) {
      dirtyAt = Infinity;
      for (const b of batchList) if (b.dirty) b.rebuild();
    }
    const cam = ctx.engine.camera;
    cam.getWorldPosition(_cam);
    const playerPos = ctx.player?.onFoot !== false ? ctx.player?.object?.position : null;
    updateGroups(dt);
    chatter(dt, playerPos);
    for (const b of batchList) {
      b.updateBounds();
      const s = b.sphere;
      const far = s.center.distanceTo(_cam) - s.radius > 420;
      b.setVisible(!far);
      b._far = far;
    }
    for (const npc of list) {
      const b = batches[npc.batchKey];
      const following = npc.mode === 'follow';
      if (b?._far && !following && npc.mode !== 'gather') continue;
      const dc = npc.object.position.distanceTo(_cam);
      if (npc.named) updateLod(npc, dc);
      // cheap far simulation: tick distant movers at a reduced rate
      if (dc > 120 && !following) {
        npc.lodAcc += dt;
        if ((frame + npc.character.id) % 4) continue;
        updateNpc(npc, npc.lodAcc, dc, playerPos);
        npc.lodAcc = 0;
      } else updateNpc(npc, dt, dc, playerPos);
    }
  }

  const api = {
    list,
    party,
    batches,
    get: (id) => byId.get(id) || null,
    get named() {
      return list.filter((n) => n.named);
    },
    walkPoints,
    crowdPoints,
    update,
    /** Spawns an extra NPC (other modules): def { id, name?, app, x, z, heading, area?, act?, mode? } */
    spawn(def) {
      const npc = makeNpc({ area: def.area || 'extra', lod: def.lod ?? 1, ...def });
      batches[npc.batchKey].rebuild();
      npc.character.load();
      return npc;
    },
    remove(id) {
      const npc = byId.get(id);
      if (!npc) return;
      list.splice(list.indexOf(npc), 1);
      byId.delete(id);
      party.delete(id);
      if (npc.label) labels.remove(npc.label);
      if (npc.interactId) ctx.interactions.remove(npc.interactId);
      npc.object.removeFromParent();
      const b = npc.character.batch;
      b?.remove(npc.character);
      b?.rebuild();
    },
    startGathering,
    endGathering,
    get eventActive() {
      return eventActive;
    },
    _onPlayerTeleport(p) {
      for (const id of party) {
        const n = byId.get(id);
        if (n) {
          const a = Math.random() * Math.PI * 2;
          place(n, p.x + Math.sin(a) * 2.2, p.z + Math.cos(a) * 2.2);
        }
      }
    },
    triangles() {
      return Object.values(batches).reduce((s, b) => s + b.triangles, 0);
    },
    dispose() {
      offs.forEach((o) => o());
      offReady();
      clearTimeout(prewarmTimer);
    },
  };
  return api;
}
