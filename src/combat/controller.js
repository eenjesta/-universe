/**
 * Combat controller: the local player's weapons and everything the network
 * says about combat.
 *
 * Input (explore, on foot, not building / driving / in space / in a dialogue
 * or modal / in a safe zone / swimming — otherwise the weapon is holstered):
 *   1–4 equip (same key again = holster), wheel = next/previous weapon,
 *   RMB aim (touch: toggle), LMB fire (semi / auto / railgun charge), R reload,
 *   4 = shock grenade (hold LMB/RMB = arc preview, release = throw), middle mouse
 *   or Z = quick grenade (V is the camera toggle), Q dodge roll. LMB/RMB while
 *   holstered draw the last weapon (unless gathering wants the click: ctx.gather.wantsClick).
 * Firing feels instant (muzzle flash, travelling energy bolt, impact, recoil,
 * camera kick, sound) and sends C.FIRE (+ C.HIT for an enemy hit-volume hit);
 * the server decides damage. Server events → FX + HUD: S.DAMAGE (hit markers,
 * damage numbers, hurt vignette + direction), S.DEATH (enemy death FX,
 * killfeed, own death screen), S.RESPAWNED, S.FIRED (other players' shots),
 * S.ENEMY_FIRE (drone lasers), S.EXPLODE, S.INV / S.STATS, S.DENY.
 */
import * as THREE from 'three';
import { C, vec } from '../../shared/protocol.js';
import { t } from '../core/i18n.js';
import { clamp } from '../core/math.js';
import { WeaponState, spreadDeg, spreadDir, simulateArc, readInv, mergeInv, ownedWeapons, assistPick } from './logic.js';
import { ENEMIES, inSafeZone, HUB, inHub } from './weapon-data.js';
import { createWeaponModel, HOLD } from './models.js';
import { BOSS, ENEMIES as ENEMY_DEFS } from '../../shared/defs/enemies.js';

/** [min, max] pitch of the camera rig's current view (recoil clamp); safe fallback for older rigs. */
const pitchRange = (rig) => (Array.isArray(rig?.pitchRange) ? rig.pitchRange : [-1.25, 1.25]);
import { poiCover, segCover } from '../../shared/sim/los.js';

// The sim's safe-zone rule (what the server enforces on FIRE/THROW) and shared/worldgen (PLATFORM §11,
// written by another engineer) — both optional: picked up when present.
const SIM_ZONES = import.meta.glob('../../shared/sim/zones.js', { eager: true });
const REASON_DEFS = import.meta.glob('../../shared/defs/reasons.js', { eager: true });
const REASONS = Object.values(REASON_DEFS)[0]?.REASONS || null;
const WORLDGEN = import.meta.glob('../../shared/worldgen/index.js', { eager: true });

const TXT = {
  notOwned: { en: 'Not unlocked yet — craft it at a workbench', nl: 'Nog niet vrijgespeeld — maak het bij een werkbank' },
  safe: { en: 'Safe zone — weapons holstered', nl: 'Veilige zone — wapens weggestopt' },
  safeHub: { en: 'Safe zone — no combat in the hub', nl: 'Veilige zone — geen gevechten in de hub' },
  noAmmo: { en: 'Out of ammo', nl: 'Geen munitie' },
  noGrenades: { en: 'No grenades', nl: 'Geen granaten' },
  denied: { en: 'Not possible right now', nl: 'Nu niet mogelijk' },
  dead: { en: 'You are down', nl: 'Je bent neer' },
  rate: { en: 'Too fast', nl: 'Te snel' },
  you: { en: 'You', nl: 'Jij' },
  player: { en: 'Player', nl: 'Speler' },
  nightRaid: { en: 'Night raid', nl: 'Nachtelijke aanval' },
  nightRaidSub: { en: 'Defend your base', nl: 'Verdedig je basis' },
  raidOver: { en: 'Raid repelled', nl: 'Aanval afgeslagen' },
  bossWake: { en: 'De Wachter awakens', nl: 'De Wachter ontwaakt' },
  bossWakeSub: { en: 'Dodge the stomps [Q] · shoot the glowing runes', nl: 'Ontwijk de stampen [Q] · schiet op de gloeiende runen' },
  bossPhase: { en: 'De Wachter grows furious', nl: 'De Wachter wordt woedend' },
  bossPhase2: { en: 'It calls its drones', nl: 'Hij roept zijn drones' },
  bossPhase3: { en: 'Final phase — the runes burn', nl: 'Laatste fase — de runen branden' },
  runeBroken: { en: 'Rune shattered', nl: 'Rune verbrijzeld' },
  runeBrokenSub: { en: 'It staggers — open fire!', nl: 'Hij wankelt — vuur!' },
  bossDown: { en: 'De Wachter has fallen', nl: 'De Wachter is gevallen' },
  bossDownBy: { en: 'Felled by {name} · loot crates for every fighter', nl: 'Geveld door {name} · buitkisten voor elke strijder' },
  bossDownSub: { en: 'Loot crates for every fighter', nl: 'Buitkisten voor elke strijder' },
  bossReset: { en: 'De Wachter slumbers again', nl: 'De Wachter sluimert weer' },
  hunted: { en: 'Something is hunting you', nl: 'Iets jaagt op je' },
  huntStalker: { en: 'Stalkers picked up your trail', nl: 'Sluipers volgen je spoor' },
  huntRaider: { en: 'A raider patrol is closing in', nl: 'Een piratenpatrouille nadert' },
  huntMite: { en: 'The crystals are stirring', nl: 'De kristallen komen in beweging' },
  huntDrone: { en: 'Drones are sweeping the area', nl: 'Drones doorzoeken het gebied' },
  hunters: { en: 'Hunters', nl: 'Jagers' },
  cleared: { en: 'Outpost cleared', nl: 'Buitenpost veroverd' },
  clearedRuin: { en: 'Ruins secured', nl: 'Ruïnes veiliggesteld' },
  clearedWreck: { en: 'Crash site secured', nl: 'Neerstortplek veiliggesteld' },
  clearedSub: { en: 'A supply cache was left behind', nl: 'Er is een voorraadkist achtergebleven' },
  cache: { en: 'Supply cache', nl: 'Voorraadkist' },
};
const DENY_TEXT = {
  ammo: TXT.noAmmo,
  'no-ammo': TXT.noAmmo,
  noammo: TXT.noAmmo,
  empty: TXT.noAmmo,
  grenades: TXT.noGrenades,
  safe: TXT.safe,
  'safe-zone': TXT.safe,
  owned: TXT.notOwned,
  'not-owned': TXT.notOwned,
  weapon: TXT.notOwned,
  dead: TXT.dead,
  rate: TXT.rate,
};
const COMBAT_DENIES = new Set([C.FIRE, C.HIT, C.THROW, C.RELOAD, C.EQUIP, C.RESPAWN]);
const SILENT_DENIES = new Set(['rate', 'reloading', 'invalid']);
const SOUND_OF = { 'pulse-pistol': 'combat.pistol', 'plasma-rifle': 'combat.rifle', railgun: 'combat.rail' };
const ENEMY_RED = [1, 0.16, 0.1];
const BOLT_ORANGE = [1, 0.36, 0.1];
/**
 * Recoil patterns (learnable, not random): per shot [yaw, pitch] multipliers of the weapon's kick.
 * The rifle climbs and drifts right then left; the pistol hops; the railgun bucks hard.
 */
const RECOIL = {
  'plasma-rifle': [
    [0, 1],
    [0.1, 1.05],
    [0.2, 1.1],
    [0.35, 1.1],
    [0.45, 1],
    [0.3, 0.95],
    [0, 0.9],
    [-0.3, 0.9],
    [-0.5, 0.85],
    [-0.4, 0.85],
    [-0.1, 0.8],
    [0.25, 0.8],
  ],
  'pulse-pistol': [
    [0.05, 1],
    [-0.12, 1.05],
    [0.15, 1],
    [-0.08, 1.05],
  ],
  railgun: [[0.15, 1]],
};
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

function readVec(v, out) {
  if (!v) return null;
  if (Array.isArray(v)) out.set(+v[0] || 0, +v[1] || 0, +v[2] || 0);
  else out.set(+v.x || 0, +v.y || 0, +v.z || 0);
  return Number.isFinite(out.x + out.y + out.z) ? out : null;
}

// --------------------------------------------------------- arc preview
function createArcPreview(scene) {
  const N = 48;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const tt = new Float32Array(N);
  for (let i = 0; i < N; i++) tt[i] = i / (N - 1);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    name: 'cbt-arc',
    uniforms: { uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute float aT;
      uniform float uScale;
      varying float vT;
      void main() {
        vT = aT;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(uScale * 0.075 / max(-mv.z, 0.3), 2.0, 12.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vT;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 3.0) * (1.0 - vT * 0.45);
        gl_FragColor = vec4(vec3(0.45, 1.5, 2.1) * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'cbt-arc-dots';
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 7;
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 1.4, 2.0), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 56), ringMat);
  const fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.6, 0.9), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const fill = new THREE.Mesh(new THREE.CircleGeometry(0.93, 40), fillMat);
  const land = new THREE.Group();
  land.name = 'cbt-arc-land';
  ring.rotation.x = -Math.PI / 2;
  fill.rotation.x = -Math.PI / 2;
  land.add(ring, fill);
  land.visible = false;
  scene.add(points, land);
  return { points, pos, geo, mat, land, N };
}

export function createController(ctx, { defs, fx, enemies, hud, death, getNet }) {
  const { input, modes, ui, events } = ctx;
  const world = ctx.world;
  const scene = world.scene;
  const camera = ctx.camera;
  const getH = world.getHeightAt ? (x, z) => world.getHeightAt(x, z) : () => 0;
  const waterLevel = world.waterLevel ?? 0;
  const touch = !!ctx.device?.touch;

  // ---------------------------------------------------------------- state
  const ws = {};
  for (const d of defs.list) ws[d.id] = new WeaponState(d);
  const grenadeDef = defs.list.find((d) => d.kind === 'throw') || null;
  let owned = new Set(defs.list.filter((d) => d.slot === 0 || d.kind === 'throw').map((d) => d.id));
  let inv = null;
  let current = defs.bySlot[0] || defs.list[0];
  let previous = current;
  let armed = false;
  let wantDrawn = false;
  let aiming = false;
  let aimToggle = false;
  let dead = false;
  let safe = false;
  let safeT = 0;
  let blockReason = 'mode';
  let seq = 0;
  let lastShotAt = -1e9;
  let autoReloadT = -1;
  let wheelAcc = 0;
  let wheelCd = 0;
  let quickThrow = false;
  let quickThrowT = 0;
  let throwing = false;
  let recoilAcc = 0;
  let deathT = -1;
  let lastRealT = performance.now();
  let deathMsg = null;
  let redrawT = -1;
  let chargeSnd = false;
  let zoomSaved = null;
  let lastDamageTargets = new Map(); // enemy id → time of my last hit (kill attribution fallback)
  let recoilIdx = 0;
  let recoilShotAt = -1e9;
  const vit = { hp: 100, sh: 50, en: 100, maxHp: 100, maxSh: 50 };
  const models = new Map();
  let held = { model: null, holstered: false };

  // scratch
  const _o = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _sd = new THREE.Vector3();
  const _mz = new THREE.Vector3();
  const _end = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _from = new THREE.Vector3();
  const _cands = new Float32Array(64);
  const _arcPts = new Float32Array(64 * 3);
  const _arcRes = { n: 0, x: 0, y: 0, z: 0, bounces: 0, t: 0 };
  const _th = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  const _eh = { id: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, rec: null, part: 0 };
  const hit = { kind: 'none', id: null, t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), rec: null, part: 0 };
  const arc = createArcPreview(scene);
  const state = {
    armed: false,
    def: current,
    ws: ws[current.id],
    aiming: false,
    spread: 0,
    charge: 0,
    grenades: 0,
    owned,
    ownedKey: '',
    slot: current.slot,
    safe: false,
    dead: false,
    reason: null,
  };

  const me = () => getNet()?.id ?? 'local';
  function send(msg) {
    try {
      getNet()?.send?.(msg);
    } catch (err) {
      console.warn('[combat] send failed', err);
    }
  }
  const serverTime = () => {
    const n = getNet();
    const st = n?.serverTime?.();
    return Number.isFinite(st) ? Math.round(st) : Date.now();
  };

  // ------------------------------------------------------- weapon models
  function modelOf(id) {
    let m = models.get(id);
    if (!m) {
      m = createWeaponModel(id);
      models.set(id, m);
    }
    return m;
  }

  function holdModel(def) {
    const p = ctx.player;
    const m = modelOf(def.id);
    if (held.model === m && !held.holstered) return;
    if (p?.holdWeapon) {
      if (held.model === m && held.holstered && p.holster) p.holster(false);
      else p.holdWeapon(m.group, HOLD[def.id] || { grip: m.group.userData.grip });
    } else if (p?.object) {
      // fallback: carry it at the right hip
      held.model?.group.removeFromParent();
      m.group.position.set(0.24, 1.0, -0.12);
      m.group.rotation.set(0, 0, 0);
      p.object.add(m.group);
    }
    held = { model: m, holstered: false };
  }

  function stowModel() {
    const p = ctx.player;
    if (!held.model || held.holstered) return;
    const isGrenade = held.model.id === 'shock-grenade';
    if (p?.holdWeapon) {
      if (p.holster && !isGrenade) {
        p.holster(true);
        held.holstered = true;
      } else {
        p.holdWeapon(null);
        held = { model: null, holstered: false };
      }
    } else {
      held.model.group.removeFromParent();
      held = { model: null, holstered: false };
    }
  }

  // ------------------------------------------------------------- equip
  function setAim(on) {
    on = !!on && armed;
    if (aiming === on) return;
    aiming = on;
    if (ctx.player?.setAim) ctx.player.setAim(on);
    else ctx.cameraRig?.setAim?.(on);
  }

  function setZoomLock(on) {
    const rig = ctx.cameraRig;
    if (!rig) return;
    if (on) {
      if (zoomSaved == null) zoomSaved = rig.zoomEnabled;
      rig.zoomEnabled = false;
    } else if (zoomSaved != null) {
      rig.zoomEnabled = zoomSaved || modes.is('explore');
      zoomSaved = null;
    }
  }

  function canUse(def) {
    if (!def) return false;
    if (def.kind === 'throw') return ws[def.id].reserve > 0;
    return owned.has(def.id);
  }

  /** Draws `def` (makes it current). Returns false when not possible. */
  function draw(def, { silent = false } = {}) {
    if (!def) return false;
    if (blockReason) {
      if (blockReason === 'safe' && !silent) hud.deny(TXT.safe);
      return false;
    }
    if (!canUse(def)) {
      if (!silent) hud.deny(def.kind === 'throw' ? TXT.noGrenades : TXT.notOwned);
      return false;
    }
    if (current !== def) {
      ws[current.id].cancelReload();
      ws[current.id].charging = false;
      if (current.kind !== 'throw') previous = current;
      current = def;
      send({ t: C.EQUIP, slot: def.slot });
    }
    const was = armed;
    armed = true;
    wantDrawn = true;
    holdModel(def);
    setZoomLock(true);
    if (!was || !silent) ctx.audio?.play?.('combat.switch', { volume: 0.7 });
    if (aimToggle || input.down('Mouse2')) setAim(true);
    return true;
  }

  function holster(keepWant = true) {
    if (!keepWant) wantDrawn = false;
    if (!armed) return;
    armed = false;
    setAim(false);
    aimToggle = false;
    quickThrow = false;
    throwing = false;
    ws[current.id].charging = false;
    stowModel();
    setZoomLock(false);
    arc.points.visible = false;
    arc.land.visible = false;
  }

  function cycle(dir) {
    const list = defs.list.filter((d) => canUse(d));
    if (!list.length) return;
    let i = list.indexOf(current);
    if (i < 0) i = 0;
    else i = (i + dir + list.length) % list.length;
    draw(list[i], { silent: true });
    ctx.audio?.play?.('combat.switch', { volume: 0.7 });
  }

  function equipSlot(i) {
    const def = defs.bySlot[i];
    if (!def) return;
    if (armed && current === def) {
      holster(false);
      ctx.audio?.play?.('combat.switch', { volume: 0.5 });
      return;
    }
    draw(def);
  }

  // ------------------------------------------------------------ tracing
  // test / debug: aim at a tracked enemy (or a fixed point) instead of the camera's crosshair ray
  let trackId = null;
  const trackP = new THREE.Vector3();
  let trackOn = false;
  function updateTrack() {
    if (trackId == null) return;
    const rec = enemies?.records.get(trackId);
    if (!rec || rec.dead) {
      trackOn = false;
      return;
    }
    trackP.set(rec.pos.x, rec.type === 'stalker' ? rec.groundY + 0.95 : rec.pos.y, rec.pos.z);
    trackOn = true;
  }

  function aimRay() {
    const rig = ctx.cameraRig;
    let near = 0;
    if (trackOn) {
      camera.getWorldPosition(_o);
      _d.copy(trackP).sub(_o).normalize();
      const pp = ctx.player?.position;
      if (pp) near = Math.max(0, _v.copy(pp).setY(pp.y + 1.5).sub(_o).dot(_d));
      return near;
    }
    if (rig?.aimRay) {
      const r = rig.aimRay();
      _o.copy(r.origin);
      _d.copy(r.dir);
      near = r.near || 0;
    } else {
      camera.getWorldPosition(_o);
      camera.getWorldDirection(_d);
      const pp = ctx.player?.position;
      if (pp) near = Math.max(0, _v.copy(pp).setY(pp.y + 1.5).sub(_o).dot(_d));
    }
    return near;
  }

  // POI structures (outpost huts, palisade, crates, wreck hulls): the same boxes the server's hit validation and
  // the enemies' line of sight use (shared/sim/los.js poiCover) — no shots through walls in either direction
  const coverCache = new Map(); // poi id → { x, z, r, boxes }
  let coverT = 0;
  function refreshCover(dt) {
    coverT -= dt;
    if (coverT > 0) return;
    coverT = 1;
    const pois = ctx.frontier?.pois;
    const pp = ctx.player?.position;
    if (!pp) return;
    for (const [id, c] of coverCache) if (Math.hypot(c.x - pp.x, c.z - pp.z) > 700) coverCache.delete(id);
    // De Wachter's arena monoliths
    if (!coverCache.has('arena') && Math.hypot(BOSS.site.x - pp.x, BOSS.site.z - pp.z) < 650) {
      coverCache.set('arena', { x: BOSS.site.x, z: BOSS.site.z, r: 60, boxes: poiCover({ type: 'arena', variant: 0, x: BOSS.site.x, y: 0, z: BOSS.site.z, rot: 0 }, getH) });
    }
    if (!pois || typeof pois.forEach !== 'function') return;
    pois.forEach((poi, id) => {
      if (!poi || (poi.type !== 'outpost' && poi.type !== 'wreck') || coverCache.has(id)) return;
      if (Math.hypot(poi.x - pp.x, poi.z - pp.z) > 450) return;
      const boxes = poiCover(poi);
      if (boxes.length) coverCache.set(id, { x: poi.x, z: poi.z, r: (poi.radius || 30) + 24, boxes });
    });
  }
  /** Distance along o + d·t to the first POI structure (≤ maxD) or Infinity. */
  function coverDist(o, d, maxD) {
    if (!coverCache.size) return Infinity;
    const bx = o.x + d.x * maxD;
    const by = o.y + d.y * maxD;
    const bz = o.z + d.z * maxD;
    let best = Infinity;
    for (const c of coverCache.values()) {
      if (Math.min(o.x, bx) > c.x + c.r || Math.max(o.x, bx) < c.x - c.r || Math.min(o.z, bz) > c.z + c.r || Math.max(o.z, bz) < c.z - c.r) continue;
      const f = segCover(o.x, o.y, o.z, bx, by, bz, c.boxes, 0.05);
      if (f >= 0 && f * maxD < best) best = f * maxD;
    }
    return best;
  }

  /** Nearest hit along o + d·t (t ≤ maxD): enemies, terrain, water, POI structures, build structures → `hit`. */
  function trace(o, d, maxD, { enemiesToo = true } = {}) {
    hit.kind = 'none';
    hit.id = null;
    hit.rec = null;
    let best = maxD;
    if (enemiesToo && enemies) {
      const eh = enemies.raycast(o, d, best, _eh);
      if (eh) {
        best = eh.t;
        hit.kind = 'enemy';
        hit.id = eh.id;
        hit.rec = eh.rec;
        hit.part = eh.part;
        hit.point.set(eh.x, eh.y, eh.z);
        hit.normal.set(eh.nx, eh.ny, eh.nz);
      }
    }
    // terrain: the frontier's march covers hub + procedural heights (the hub's raycastInto knows only ±1200 m)
    const rc = ctx.frontier?.raycastInto || world.raycastInto;
    const th = rc ? rc(o, d, best, _th) : null;
    if (th && th.distance < best) {
      best = th.distance;
      hit.kind = 'terrain';
      hit.point.copy(th.point);
      hit.normal.copy(th.normal);
    }
    if (d.y < -1e-4 && o.y > waterLevel) {
      const tw = (waterLevel - o.y) / d.y;
      if (tw < best) {
        const wx = o.x + d.x * tw;
        const wz = o.z + d.z * tw;
        if (world.isWater ? world.isWater(wx, wz) : getH(wx, wz) < waterLevel) {
          best = tw;
          hit.kind = 'water';
          hit.point.set(wx, waterLevel, wz);
          hit.normal.set(0, 1, 0);
        }
      }
    }
    const tc = coverDist(o, d, best);
    if (tc < best) {
      best = tc;
      hit.kind = 'struct';
      hit.id = null;
      hit.rec = null;
      hit.point.copy(o).addScaledVector(d, best);
      hit.normal.copy(d).negate();
    }
    const phys = ctx.physics;
    if (phys?.segmentHit) {
      _end.copy(o).addScaledVector(d, best);
      const f = phys.segmentHit(o, _end);
      if (f < 1) {
        best *= f;
        hit.kind = 'struct';
        hit.point.copy(o).addScaledVector(d, best);
        hit.normal.copy(d).negate();
      }
    }
    hit.t = best;
    if (hit.kind === 'none') hit.point.copy(o).addScaledVector(d, best);
    return hit;
  }

  // ------------------------------------------------------------- firing
  function muzzleWorld(out) {
    const p = ctx.player;
    if (p?.muzzleWorld && held.model && !held.holstered) return p.muzzleWorld(out);
    if (held.model) return held.model.muzzle.getWorldPosition(out);
    if (p?.position) return out.copy(p.position).setY(p.position.y + 1.4);
    return camera.getWorldPosition(out);
  }

  function currentSpread(def) {
    const p = ctx.player;
    const sp = p?.velocity ? Math.hypot(p.velocity.x, p.velocity.z) : 0;
    return spreadDeg(def, { aiming, moving: clamp(sp / 6, 0, 1), airborne: p ? !p.grounded && !p.swimming : false, bloom: ws[def.id].bloom });
  }

  function shoot(def) {
    const s = ws[def.id];
    const spread = currentSpread(def);
    if (!s.fire()) return false;
    lastShotAt = performance.now();
    const near = aimRay();
    spreadDir(_d, spread, Math.random(), Math.random(), _sd);
    // touch: light bullet magnetism toward an enemy close to the crosshair (wider from the hip,
    // tighter when aiming; boss runes are candidates too)
    const assist = touch ? assistStrength() : 0;
    if (assist > 0 && enemies) {
      const n = enemies.candidates(_cands, 16);
      const i = assistPick(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, _cands, n, (aiming ? 4 : 6) * assist, def.range);
      if (i >= 0) {
        _sd.set(_cands[i * 4] - _o.x, _cands[i * 4 + 1] - _o.y, _cands[i * 4 + 2] - _o.z).normalize();
        spreadDir(_sd, spread * 0.5, Math.random(), Math.random(), _sd);
      }
    }
    _a.copy(_o).addScaledVector(_sd, near + 0.3);
    trace(_a, _sd, def.range);
    muzzleWorld(_mz);
    // FX + network use the muzzle → hit-point ray
    _v.copy(hit.point).sub(_mz);
    const len = _v.length();
    if (len > 1e-3) _v.divideScalar(len);
    else _v.copy(_sd);
    const impact = hit.kind === 'none' ? null : hit.kind === 'enemy' ? 'enemy' : hit.kind === 'water' ? 'water' : 'terrain';
    fx.muzzle(_mz, _v, def.color, def.flash);
    if (def.kind === 'charge') {
      fx.beam(_mz, hit.point, def.color, def.boltWidth, 0.32, 7);
      fx.beam(_mz, hit.point, [1, 1, 1], def.boltWidth * 0.35, 0.18, 4);
      if (impact) fx.impact(hit.point, hit.normal, def.color, impact);
      for (let k = 0; k < 6; k++) {
        const f = Math.random();
        _b.copy(_mz).lerp(hit.point, f);
        fx.sparks(_b, _v, 2, def.color, 2.5, 1, 0.5, 0.02, 4);
      }
    } else {
      fx.bolt(_mz, hit.point, def.color, { speed: def.boltSpeed, len: def.boltLen, width: def.boltWidth, impact: impact || 0, normal: hit.normal });
    }
    held.model?.pulse(1);
    ctx.audio?.play?.(SOUND_OF[def.id] || 'combat.rifle', { volume: 0.9 });
    // feel: recoil pitch kick + a little yaw, camera shake, arms
    const rig = ctx.cameraRig;
    if (rig) {
      // a fixed per-weapon pattern (resets after a short pause) — learnable, with a touch of noise
      const pat = RECOIL[def.id] || RECOIL['pulse-pistol'];
      const now = performance.now();
      if (now - recoilShotAt > 360) recoilIdx = 0;
      recoilShotAt = now;
      const [py, pp] = pat[Math.min(recoilIdx, pat.length - 1)];
      recoilIdx++;
      const fp = ctx.player?.view === 'first';
      const k = def.kick * (aiming ? 0.62 : 1) * (fp ? 1.15 : 1) * pp * (0.93 + Math.random() * 0.14);
      const [plo, phi] = pitchRange(rig);
      rig.pitch = clamp(rig.pitch + k, plo, phi);
      rig.yaw -= def.kick * (aiming ? 0.5 : 0.8) * (py + (Math.random() - 0.5) * 0.15);
      recoilAcc += k;
      rig.shake?.(def.kind === 'charge' ? 0.42 : def.auto ? 0.08 : 0.14);
    }
    ctx.player?.playAction?.('shoot', { recoil: def.kind === 'charge' ? 1.6 : def.auto ? 0.7 : 1 });
    ctx.player?.aimAt?.(hit.point);
    // network
    seq++;
    const fireMsg = { t: C.FIRE, w: def.id, o: vec(_mz), d: vec(_v), seq, ct: serverTime() };
    // the render time of the enemy views (lag compensation): ctx.net.viewTime() = serverTime − INTERP_DELAY_MS
    const vt = getNet()?.viewTime?.();
    if (Number.isFinite(vt)) fireMsg.vt = Math.round(vt);
    send(fireMsg);
    if (hit.kind === 'enemy' && hit.id != null) {
      send({ t: C.HIT, seq, target: hit.id, at: vec(hit.point) });
      lastDamageTargets.set(hit.id, performance.now());
    }
    if (s.mag === 0 && s.reserve > 0) autoReloadT = 0.32;
    events.emit('combat:fire', { weapon: def.id, hit: hit.kind, target: hit.id });
    return true;
  }

  function tryReload() {
    const def = current;
    const s = ws[def.id];
    if (!armed || def.kind === 'throw' || !s.canReload) return false;
    s.startReload();
    send({ t: C.RELOAD, w: def.id });
    ctx.player?.playAction?.('reload', { duration: def.reload });
    ctx.audio?.play?.('combat.reload', { volume: 0.8, duration: def.reload });
    return true;
  }

  // ------------------------------------------------------------ grenades
  const flying = [];
  for (let i = 0; i < 3; i++) flying.push({ on: false, model: null, p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, spin: 0, bounces: 0 });

  function throwOrigin(out) {
    const p = ctx.player;
    if (held.model?.id === 'shock-grenade' && !held.holstered) return muzzleWorld(out);
    if (!p?.position) return camera.getWorldPosition(out);
    const rig = ctx.cameraRig;
    const rx = rig?.rightVec?.x ?? 1;
    const rz = rig?.rightVec?.z ?? 0;
    return out.set(p.position.x + rx * 0.3, p.position.y + 1.55, p.position.z + rz * 0.3);
  }

  function throwVelocity(out) {
    aimRay();
    const g = grenadeDef;
    out.copy(_d);
    out.y += 0.22;
    out.normalize().multiplyScalar(g.throwSpeed || 17);
    return out;
  }

  function updateArc(show) {
    if (!show || !grenadeDef) {
      if (arc.points.visible) {
        arc.points.visible = false;
        arc.land.visible = false;
      }
      return;
    }
    const g = grenadeDef;
    throwOrigin(_p);
    throwVelocity(_v);
    simulateArc(_p, _v, { gravity: g.gravity, bounce: g.bounce, fuse: g.fuse, radius: 0.06, ground: getH, dt: 1 / 30 }, _arcPts, arc.N, _arcRes);
    arc.pos.set(_arcPts.subarray(0, _arcRes.n * 3));
    arc.geo.attributes.position.needsUpdate = true;
    arc.geo.setDrawRange(0, _arcRes.n);
    arc.mat.uniforms.uScale.value = (window.innerHeight || 720) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    arc.points.visible = true;
    arc.land.visible = true;
    arc.land.position.set(_arcRes.x, Math.max(getH(_arcRes.x, _arcRes.z), waterLevel) + 0.06, _arcRes.z);
    arc.land.scale.setScalar(g.radius || 6);
  }

  function throwGrenade() {
    const g = grenadeDef;
    if (!g) return false;
    const s = ws[g.id];
    if (!s.fire()) {
      hud.deny(TXT.noGrenades);
      return false;
    }
    throwOrigin(_p);
    throwVelocity(_v);
    send({ t: C.THROW, w: g.id, o: vec(_p), v: vec(_v) });
    ctx.player?.playAction?.('shoot', { recoil: 0.35 });
    ctx.audio?.play?.('combat.throw', { volume: 0.8 });
    const f = flying.find((x) => !x.on) || flying[0];
    if (!f.model) {
      f.model = createWeaponModel('shock-grenade');
      f.model.group.scale.setScalar(1.25);
      scene.add(f.model.group);
    }
    f.on = true;
    f.p.copy(_p);
    f.v.copy(_v);
    f.t = 0;
    f.spin = 0;
    f.bounces = 0;
    f.model.group.visible = true;
    f.model.group.position.copy(_p);
    if (s.reserve <= 0 && current === g) {
      // out of grenades: back to the last gun
      redrawT = 0.45;
    }
    return true;
  }

  function updateFlying(dt) {
    const g = grenadeDef;
    if (!g) return;
    for (const f of flying) {
      if (!f.on) continue;
      f.t += dt;
      if (f.t > (g.fuse || 1.6) + 1.2) {
        f.on = false;
        f.model.group.visible = false;
        continue;
      }
      f.v.y -= (g.gravity || 18) * dt;
      f.p.addScaledVector(f.v, dt);
      const gy = Math.max(getH(f.p.x, f.p.z), -50) + 0.07;
      if (f.p.y < gy) {
        f.p.y = gy;
        if (Math.abs(f.v.y) > 1.2 && f.bounces < 3) {
          ctx.audio?.play?.('combat.grenade.bounce', { position: f.p, volume: 0.7, strength: Math.min(1, Math.abs(f.v.y) / 8) });
          f.v.y = -f.v.y * (g.bounce || 0.35);
          f.v.x *= 0.62;
          f.v.z *= 0.62;
          f.bounces++;
        } else {
          f.v.y = 0;
          f.v.x *= Math.max(0, 1 - 4 * dt);
          f.v.z *= Math.max(0, 1 - 4 * dt);
        }
      }
      f.spin += dt * (6 + Math.hypot(f.v.x, f.v.z));
      f.model.group.position.copy(f.p);
      f.model.group.rotation.set(f.spin, f.spin * 0.6, 0);
      // blink faster toward the fuse
      const k = f.t / (g.fuse || 1.6);
      if (Math.sin(f.t * (10 + k * 30)) > 0.6) f.model.pulse(1);
      f.model.update(dt);
    }
  }

  // other players' grenades in flight (snapshot px rows → ctx.net.projectiles); mine are predicted above
  const myPx = new Set();
  const pxPool = [];
  function updateNetProjectiles(dt) {
    const src = getNet()?.projectiles;
    let n = 0;
    if (src && typeof src.forEach === 'function') {
      src.forEach((e, id) => {
        if (n >= 6 || myPx.has(e?.id ?? id)) return;
        const p = e?.view?.p;
        if (!p || !Number.isFinite(p.x)) return;
        let slot = pxPool[n];
        if (!slot) {
          const model = createWeaponModel('shock-grenade');
          model.group.scale.setScalar(1.25);
          model.group.visible = false;
          scene.add(model.group);
          slot = pxPool[n] = { model, spin: Math.random() * 6 };
        }
        slot.spin += dt * 9;
        slot.model.group.visible = true;
        slot.model.group.position.set(p.x, p.y, p.z);
        slot.model.group.rotation.set(slot.spin, slot.spin * 0.6, 0);
        if (Math.sin(slot.spin * 3) > 0.7) slot.model.pulse(1);
        slot.model.update(dt);
        n++;
      });
    }
    for (let i = n; i < pxPool.length; i++) if (pxPool[i].model.group.visible) pxPool[i].model.group.visible = false;
  }

  // ---------------------------------------------------------- block rules
  function computeBlock() {
    const p = ctx.player;
    if (!modes.is('explore') || modes.transitioning) return 'mode';
    if (!p || p.onFoot === false) return 'vehicle';
    if (dead || p.dead) return 'dead';
    if (ctx.build?.active) return 'build';
    if (ctx.dialogue?.isOpen) return 'dialogue';
    if (ui.isModalOpen()) return 'modal';
    if (safe) return 'safe';
    if (p.swimming) return 'swim';
    return null;
  }

  // ---------------------------------------------------------- safe zones
  // PLATFORM §11: the hub (the hand-made middle of the planet, |x|, |z| ≤ 1100) is one safe zone; beyond it
  // combat is on. Rule, first that exists: a host provider (ctx.frontier / ctx.worldgen / ctx.world / ctx.smp
  // .isSafe(x, z)) → ctx.net.providers.isSafe (the world provider the LocalServer / server use) →
  // shared/worldgen's isSafe → stand-in: the hub square ∪ the sim's static zones.
  // ?combatsafe=static → only the sim's static zones, ?combatsafe=off → never safe (tests / staged shots).
  const simZones = Object.values(SIM_ZONES)[0] || null;
  const worldgen = Object.values(WORLDGEN)[0] || null;
  const staticZoneAt = typeof simZones?.safeZoneAt === 'function' ? (x, z) => !!simZones.safeZoneAt(x, z) : (x, z) => inSafeZone(x, z);
  const wgSafe = typeof worldgen?.isSafe === 'function' ? worldgen.isSafe : null;
  const hub = { ...HUB };
  const safeMode = String(ctx.params?.combatsafe ?? '').toLowerCase();
  const PROVIDERS = ['frontier', 'worldgen', 'world', 'smp'];
  const providerSafe = () => {
    for (const k of PROVIDERS) {
      const o = ctx[k];
      if (o && typeof o.isSafe === 'function') return o;
    }
    const pr = ctx.net?.providers;
    return pr && typeof pr.isSafe === 'function' ? pr : null;
  };
  function safeAt(x, z) {
    if (safeMode === 'off' || safeMode === '0') return false;
    if (safeMode !== 'static') {
      const o = providerSafe();
      if (o) {
        try {
          return !!o.isSafe(x, z);
        } catch {
          /* fall through */
        }
      }
      if (wgSafe) {
        try {
          return !!wgSafe(x, z);
        } catch {
          /* fall through to the stand-in */
        }
      }
      if (inHub(x, z, hub)) return true;
    }
    return staticZoneAt(x, z);
  }

  let safeKnown = false;
  let safeX = NaN;
  let safeZ = NaN;
  function updateSafe(dt) {
    const p = ctx.player?.position;
    if (!p) return;
    safeT -= dt;
    // re-check at once after a teleport (respawn, Gateway travel, Return to hub) — also on slow devices
    const jumped = !(Math.abs(p.x - safeX) < 20 && Math.abs(p.z - safeZ) < 20);
    if (safeT > 0 && !jumped) return;
    safeT = 0.25;
    safeX = p.x;
    safeZ = p.z;
    const s = safeAt(p.x, p.z);
    if (s !== safe || !safeKnown) {
      if (s && armed) {
        hud.deny(TXT.safe);
        wantDrawn = false;
      }
      hud.setSafe(s, safeKnown);
      safeKnown = true;
    }
    safe = s;
  }

  // ------------------------------------------------------------- update
  function update(dt) {
    updateSafe(dt);
    updateTrack();
    refreshCover(dt);
    const reason = computeBlock();
    if (reason !== blockReason) {
      blockReason = reason;
      if (reason && armed) holster(reason !== 'safe');
      else if (!reason && wantDrawn && !armed && !dead) draw(current, { silent: true });
    }
    // timers on every weapon (reloads finish even while holstered)
    for (const d of defs.list) {
      const s = ws[d.id];
      const holdCharge = armed && d === current && d.kind === 'charge' && input.down('Mouse0') && !blockReason;
      const ev = s.update(dt, holdCharge);
      if (d === current && ev === 'charged' && armed) shoot(d);
    }
    // railgun charge sound
    const cs = ws[current.id];
    if (current.kind === 'charge' && cs.charging && !chargeSnd && cs.charge < 0.3) {
      chargeSnd = true;
      ctx.audio?.play?.('combat.rail.charge', { volume: 0.75, duration: current.charge });
    }
    if (!cs.charging) chargeSnd = false;
    held.model?.setCharge?.(current.kind === 'charge' ? cs.charge : 0);
    for (const m of models.values()) m.update(dt);
    // recoil recovery (≈ 70 % comes back)
    if (recoilAcc > 1e-4 && ctx.cameraRig) {
      const r = recoilAcc * Math.min(1, dt * 9);
      recoilAcc -= r;
      ctx.cameraRig.pitch -= r * 0.72;
    }
    if (redrawT > 0) {
      redrawT -= dt;
      if (redrawT <= 0 && armed && current.kind === 'throw') {
        const back = canUse(previous) ? previous : defs.list.find((d) => d.kind !== 'throw' && canUse(d));
        if (back) draw(back, { silent: true });
        else holster(false);
      }
    }
    updateFlying(dt);
    updateNetProjectiles(dt);
    // the death flow runs on max(game, wall) time: the server accepts C.RESPAWN 5 s after death in real
    // time, also when a slow device clamps dt (and stays fast in headless simulate() runs)
    const nowR = performance.now();
    const rdt = Math.max(dt, Math.min(0.5, (nowR - lastRealT) / 1000));
    lastRealT = nowR;
    if (deathT >= 0) {
      deathT -= rdt;
      if (deathT < 0) showDeathScreen();
    }
    death?.update(rdt);
    if (redrawAfterRespawn >= 0) {
      redrawAfterRespawn -= dt;
      if (redrawAfterRespawn < 0 && wantDrawn && !blockReason) {
        // back with a gun in hand (not the grenade that was out when we went down)
        const gun = current.kind !== 'throw' && canUse(current) ? current : canUse(previous) && previous.kind !== 'throw' ? previous : defs.list.find((d) => d.kind !== 'throw' && canUse(d));
        if (gun) draw(gun, { silent: true });
      }
    }

    const can = !blockReason && input.gameEnabled;
    let showArc = false;
    if (can) {
      // slots + wheel
      for (let i = 0; i < 4; i++) if (input.pressed(DIGITS[i])) equipSlot(i);
      wheelCd = Math.max(0, wheelCd - dt);
      if (armed && input.wheel) {
        wheelAcc += input.wheel;
        if (Math.abs(wheelAcc) >= 0.9 && wheelCd <= 0) {
          cycle(wheelAcc > 0 ? 1 : -1);
          wheelAcc = 0;
          wheelCd = 0.14;
        }
      } else wheelAcc *= 0.8;
      // draw on click when holstered (the click belongs to gathering while you look at a tree / rock / plant)
      if (!armed && !ctx.gather?.wantsClick && (input.pressed('Mouse0') || input.pressed('Mouse2'))) {
        const def = canUse(current) ? current : defs.list.find((d) => canUse(d));
        draw(def);
      } else if (armed) {
        // aim
        const wantAim = (input.down('Mouse2') || aimToggle) && current.kind !== 'throw';
        setAim(wantAim);
        const s = ws[current.id];
        if (current.kind === 'throw') {
          const holdThrow = input.down('Mouse0') || input.down('Mouse2');
          if (holdThrow) {
            throwing = true;
            showArc = true;
          } else if (throwing) {
            // the hold ended (button up) while still allowed to fight: throw along the previewed arc
            throwing = false;
            throwGrenade();
          }
        } else if (current.kind === 'hitscan') {
          const trig = current.auto ? input.down('Mouse0') : input.pressed('Mouse0');
          if (trig) {
            if (s.canFire) shoot(current);
            else if (s.mag === 0 && !s.reloading && input.pressed('Mouse0')) {
              ctx.audio?.play?.('combat.empty', { volume: 0.7 });
              if (s.reserve > 0) tryReload();
              else hud.deny(TXT.noAmmo);
            }
          }
        } else if (current.kind === 'charge' && input.pressed('Mouse0') && s.mag === 0 && !s.reloading) {
          ctx.audio?.play?.('combat.empty', { volume: 0.7 });
          if (s.reserve > 0) tryReload();
          else hud.deny(TXT.noAmmo);
        }
        if (input.pressed('KeyR')) tryReload();
      }
      if (autoReloadT >= 0) {
        autoReloadT -= dt;
        if (autoReloadT < 0) tryReload();
      }
      // quick grenade (middle mouse / Z or the touch Grenade button; hold = arc preview, release = throw)
      const qDown = input.down('Mouse1') || input.down('KeyZ');
      if ((input.pressed('Mouse1') || input.pressed('KeyZ')) && grenadeDef) {
        if (ws[grenadeDef.id].reserve > 0) quickThrow = true;
        else hud.deny(TXT.noGrenades);
      }
      if (quickThrow) {
        quickThrowT += dt;
        showArc = true;
        if (input.released('Mouse1') || input.released('KeyZ') || (!qDown && quickThrowT > 0.05 && !touchHold)) {
          quickThrow = false;
          quickThrowT = 0;
          throwGrenade();
        }
        if (quickThrowT > 6) {
          quickThrow = false;
          quickThrowT = 0;
        }
      }
      // dodge
      if (input.pressed('KeyQ')) dodge();
    } else {
      setAim(false);
      throwing = false;
      quickThrow = false;
      // feedback for 1–4 in a safe zone (the weapon stays holstered)
      if (blockReason === 'safe' && input.gameEnabled && !ui.isModalOpen()) {
        for (let i = 0; i < 4; i++) if (input.pressed(DIGITS[i])) hud.deny(inHub(ctx.player?.position?.x ?? 0, ctx.player?.position?.z ?? 0, hub) ? TXT.safeHub : TXT.safe);
      }
    }
    updateArc(showArc && !dead);
    // touch aim friction: ease toward an enemy near the crosshair while firing (stronger when aiming)
    if (touch && armed && current.kind !== 'throw' && input.down('Mouse0') && enemies && ctx.cameraRig) {
      const a = assistStrength();
      if (a > 0) assistFriction(dt, (aiming ? 1 : 0.55) * a, a);
    }

    // HUD state
    state.armed = armed;
    state.def = current;
    state.ws = ws[current.id];
    state.aiming = aiming;
    state.spread = armed ? currentSpread(current) : 0;
    state.charge = ws[current.id].charge;
    state.grenades = grenadeDef ? ws[grenadeDef.id].reserve : 0;
    if (state.grenades !== lastGren) {
      lastGren = state.grenades;
      state.ownedKey = `${ownedBase}|${lastGren}`;
    }
    state.owned = owned;
    state.slot = current.slot;
    state.safe = safe;
    state.dead = dead;
    state.reason = blockReason;
  }
  let redrawAfterRespawn = -1;
  let touchHold = false;
  let ownedBase = [...owned].sort().join(',');
  let lastGren = -1;

  /** Touch aim assist 0..1 (Settings → Controls, state.settings.aimAssist; default 1, 0 = off). */
  function assistStrength() {
    const v = Number(ctx.state?.get?.('settings.aimAssist'));
    return Number.isFinite(v) ? clamp(v, 0, 1) : 1;
  }

  function assistFriction(dt, strength = 1, cone = 1) {
    aimRay();
    const n = enemies.candidates(_cands, 16);
    const i = assistPick(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, _cands, n, 7 * Math.max(0.35, cone), 90);
    if (i < 0) return;
    const rig = ctx.cameraRig;
    const dx = _cands[i * 4] - _o.x;
    const dy = _cands[i * 4 + 1] - _o.y;
    const dz = _cands[i * 4 + 2] - _o.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    let dyaw = yaw - Math.atan2(-_d.x, -_d.z);
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dp = pitch - Math.asin(clamp(_d.y, -1, 1));
    const k = Math.min(1, dt * 2.6 * strength);
    rig.yaw += dyaw * k * 0.5;
    const [plo, phi] = pitchRange(rig);
    rig.pitch = clamp(rig.pitch + dp * k * 0.5, plo, phi);
  }

  function dodge() {
    const p = ctx.player;
    if (!p || dead) return false;
    let ok = false;
    if (p.playAction) ok = p.playAction('dodge') !== false;
    else if (p.velocity) {
      const mv = input.moveVector();
      const yaw = ctx.cameraRig?.yaw ?? p.heading;
      let dx = -Math.sin(yaw) * mv.y + Math.cos(yaw) * mv.x;
      let dz = -Math.cos(yaw) * mv.y - Math.sin(yaw) * mv.x;
      const l = Math.hypot(dx, dz);
      if (l < 0.1) {
        dx = -Math.sin(p.heading);
        dz = -Math.cos(p.heading);
      } else {
        dx /= l;
        dz /= l;
      }
      p.velocity.x += dx * 9;
      p.velocity.z += dz * 9;
      ok = true;
    }
    if (ok) ctx.audio?.play?.('combat.dodge', { volume: 0.8 });
    return ok;
  }

  // ------------------------------------------------------------ net events
  function applyInv() {
    if (!inv) return;
    const o = ownedWeapons(inv);
    if (o) {
      owned = o;
      if (grenadeDef) owned.add(grenadeDef.id);
    }
    const now = performance.now();
    for (const d of defs.list) {
      const s = ws[d.id];
      let { mag, reserve } = readInv(inv, d);
      if (s.reloading) continue; // the server's reload result arrives after its own timer
      if (d === current && now - lastShotAt < 450 && Number.isFinite(mag) && mag > s.mag) mag = undefined;
      s.sync(mag, reserve);
    }
    ownedBase = [...owned].sort().join(',');
    lastGren = grenadeDef ? ws[grenadeDef.id].reserve : 0;
    state.ownedKey = `${ownedBase}|${lastGren}`;
    if (Number.isInteger(inv.slot) && defs.bySlot[inv.slot] && defs.bySlot[inv.slot] !== current && defs.bySlot[inv.slot].kind !== 'throw') {
      const def = defs.bySlot[inv.slot];
      if (armed) draw(def, { silent: true });
      else current = def;
    }
    if (armed && !canUse(current)) {
      const back = defs.list.find((d) => d.kind !== 'throw' && canUse(d));
      if (back) draw(back, { silent: true });
      else holster(false);
    }
  }

  function setVitals(s) {
    if (!s) return;
    const prevSh = vit.sh;
    const prevHp = vit.hp;
    for (const k of ['hp', 'sh', 'en', 'maxHp', 'maxSh']) if (Number.isFinite(s[k])) vit[k] = s[k];
    if (prevSh > 0.5 && vit.sh <= 0.01 && !dead) ctx.audio?.play?.('combat.shield.break', { volume: 0.8 });
    hud.setVitals(vit);
    return prevHp;
  }

  function nameOf(id, type) {
    if (id == null) return '';
    if (id === me()) return t(TXT.you);
    const rec = enemies?.records.get(id);
    const ty = type || rec?.type;
    if (ty && ENEMIES[ty]) return t(ENEMIES[ty].name);
    const n = getNet();
    const pl = n?.players?.get?.(id);
    const nm = pl?.name || pl?.view?.name || ctx.remotes?.get?.(id)?.name;
    if (nm) return nm;
    if (typeof id === 'string' && id.startsWith('e')) return t(ENEMIES.drone.name);
    return t(TXT.player);
  }

  function sourcePos(id, msg, out) {
    if (readVec(msg?.from, out)) return out;
    const rec = id != null ? enemies?.records.get(id) : null;
    if (rec) return out.copy(rec.pos);
    const pl = id != null ? getNet()?.players?.get?.(id) : null;
    const p = pl?.view?.p;
    if (p && readVec(p, out)) return out;
    return null;
  }

  function onDamage(msg) {
    if (!msg) return;
    const myId = me();
    const amount = Number(msg.amount) || 0;
    if (msg.target === myId) {
      setVitals({ hp: msg.hp, sh: msg.sh });
      const from = sourcePos(msg.by, msg, _from);
      hud.hurt(amount, from);
      ctx.audio?.play?.('combat.hurt', { volume: 0.85, amount, shield: Number(msg.sh) > 0 });
      ctx.player?.playAction?.('hit', { from: from || undefined, amount: clamp(amount / 12, 0.3, 2) });
      if (!ctx.player?.playAction) ctx.cameraRig?.shake?.(0.12 + amount / 60);
      const rec = msg.by != null ? enemies?.records.get(msg.by) : null;
      if (rec) {
        rec.targetsMe = Math.max(rec.targetsMe, 4);
        onTarget(rec, true);
      }
      return;
    }
    const rec = enemies?.onDamage(msg.target, msg);
    if (msg.by === myId) {
      const kill = !!msg.kill || (Number.isFinite(msg.hp) && msg.hp <= 0);
      const prop = rec?.type === 'barrier';
      const kind = kill && !prop ? 'kill' : msg.weak ? 'weak' : msg.crit ? 'crit' : 'hit';
      hud.hitMarker(kind === 'weak' ? 'crit' : kind);
      if (readVec(msg.at, _p)) hud.damageNumber(_p, amount, kind, msg.target);
      else if (rec) hud.damageNumber(_p.copy(rec.pos).setY(rec.markerY ?? rec.pos.y + 1), amount, kind, msg.target);
      ctx.audio?.play?.(prop ? 'combat.barrier.hit' : 'combat.hit', { volume: 0.75, crit: !!msg.crit || !!msg.weak, kill: kill && !prop });
      lastDamageTargets.set(msg.target, performance.now());
      if (kill && rec) rec._killMarked = true;
      if (kill && !prop) ctx.cameraRig?.shake?.(rec?.type === 'warden' ? 0.6 : 0.07);
    }
  }

  function onDeath(msg) {
    if (!msg) return;
    const myId = me();
    if (msg.id === myId) {
      onMyDeath(msg);
      return;
    }
    const rec = enemies?.records.get(msg.id);
    const type = msg.type || rec?.type;
    if (type === 'barrier') {
      // a raider's shield wall collapsing (shot down or expired): no kill feed
      if (rec) enemies.onDeath(msg.id);
      return;
    }
    if (rec) {
      const marked = rec._killMarked;
      enemies.onDeath(msg.id);
      if (msg.by === myId && !marked) {
        hud.hitMarker('kill');
        ctx.audio?.play?.('combat.hit', { volume: 0.75, kill: true });
      }
      if (msg.by === myId) {
        ctx.state?.add?.('stats.kills', 1);
        events.emit('combat:kill', { id: msg.id, type });
      }
    }
    const killer = msg.by != null ? nameOf(msg.by) : '';
    const byEnemy = msg.by != null && (enemies?.records.has(msg.by) || (typeof msg.by === 'string' && msg.by.startsWith('e')));
    const weapon = msg.w || (msg.by === myId ? current.id : byEnemy ? null : 'plasma-rifle');
    if (killer || rec) hud.killfeed(killer || '—', weapon && defs.byId[weapon] && defs.byId[weapon].kind !== 'throw' ? weapon : null, nameOf(msg.id, type), { mine: msg.by === myId, enemyKiller: byEnemy });
  }

  function onMyDeath(msg) {
    if (dead) return;
    dead = true;
    deathMsg = msg;
    holster(true);
    setAim(false);
    if (modes.is('drive')) ctx.vehicles?.exit?.();
    ctx.player?.playAction?.('die', {});
    ctx.audio?.play?.('combat.death', { volume: 0.9 });
    setVitals({ hp: 0, sh: 0 });
    hud.hurt(30, null);
    deathT = 1.4;
    const byEnemy = msg.by != null && (enemies?.records.has(msg.by) || (typeof msg.by === 'string' && msg.by.startsWith('e')));
    if (msg.by != null || msg.cause) hud.killfeed(msg.by != null ? nameOf(msg.by, msg.byType) : '—', null, t(TXT.you), { meVictim: true, enemyKiller: byEnemy });
    events.emit('combat:death', { by: msg.by, cause: msg.cause });
  }

  function showDeathScreen() {
    if (!dead || !death) return;
    const m = deathMsg || {};
    const killer = m.by != null ? m.byName || nameOf(m.by, m.byType) : null;
    death.show({ cause: m.cause || m.kind, killer, drop: !!m.drop, delay: Math.max(1, 5 - 1.4) });
  }

  function onRespawned(msg) {
    if (!msg || msg.id !== me()) return;
    dead = false;
    deathT = -1;
    death?.hide();
    const p = ctx.player;
    if (readVec(msg.p, _p) && p?.teleport) p.teleport({ x: _p.x, z: _p.z, heading: Number.isFinite(msg.h) ? msg.h : undefined }, Number.isFinite(msg.h) ? msg.h : undefined);
    p?.playAction?.('respawn', {});
    ctx.audio?.play?.('combat.respawn', { volume: 0.8 });
    setVitals({ hp: vit.maxHp, sh: vit.maxSh });
    redrawAfterRespawn = 1.3;
    events.emit('combat:respawn', {});
  }

  function onFired(msg) {
    if (!msg) return;
    if (msg.id === me()) {
      // my own grenade is predicted locally: don't draw the server's copy too
      if (msg.px != null) {
        myPx.add(msg.px);
        if (myPx.size > 16) myPx.delete(myPx.values().next().value);
      }
      return;
    }
    const def = defs.byId[msg.w] || defs.byId['plasma-rifle'];
    if (!readVec(msg.o, _a) || !readVec(msg.d, _sd)) return;
    if (_sd.lengthSq() < 1e-6) return;
    _sd.normalize();
    // far away shots are not worth the work
    const cam = camera.position;
    if (_a.distanceToSquared(cam) > 260 * 260) return;
    if (def.kind === 'throw') return;
    _b.copy(_a).addScaledVector(_sd, 0.4);
    trace(_b, _sd, def.range);
    const impact = hit.kind === 'none' ? null : hit.kind === 'enemy' ? 'enemy' : hit.kind === 'water' ? 'water' : 'terrain';
    fx.muzzle(_a, _sd, def.color, def.flash * 0.8);
    if (def.kind === 'charge') {
      fx.beam(_a, hit.point, def.color, def.boltWidth, 0.3, 6);
      if (impact) fx.impact(hit.point, hit.normal, def.color, impact);
    } else fx.bolt(_a, hit.point, def.color, { speed: def.boltSpeed, len: def.boltLen, width: def.boltWidth, impact: impact || 0, normal: hit.normal });
    ctx.audio?.play?.(SOUND_OF[def.id] || 'combat.rifle', { position: _a, volume: 0.75, pitch: 0.97 });
  }

  function onEnemyFire(msg) {
    if (!msg) return;
    const rec = enemies?.records.get(msg.id);
    const w = msg.w;
    // telegraphs + boss attacks: visuals only (the hit, if any, comes later)
    if ((w === 'laser' && msg.phase === 'charge') || w === 'aim') {
      enemies?.onTelegraph(msg.id, msg);
      if (rec && msg.target === me()) {
        rec.targetsMe = Math.max(rec.targetsMe, 4);
        onTarget(rec, true);
      }
      return;
    }
    if (w === 'stomp' || w === 'beam' || w === 'summon' || w === 'roar') {
      const tp = w === 'beam' && msg.target != null ? enemies?.targetPos(msg.target, _p) : null;
      enemies?.onTelegraph(msg.id, msg, tp);
      return;
    }
    if (w === 'howl') {
      if (rec) ctx.audio?.play?.('combat.stalker.howl', { position: rec.pos, volume: 1 });
      return;
    }
    if (w === 'barrier') {
      if (readVec(msg.at, _p)) {
        fx.glow(_p.setY(_p.y + 0.8), BOLT_ORANGE, 0.4, 2.4, 0.4, 0, 0.9, 4);
        ctx.audio?.play?.('combat.barrier.deploy', { position: _p, volume: 0.85 });
      }
      return;
    }
    const em = enemies?.onFire(msg.id);
    if (w === 'claw' || w === 'bite' || rec?.type === 'stalker' || rec?.type === 'mite') {
      if (rec) ctx.audio?.play?.(w === 'bite' || rec.type === 'mite' ? 'combat.mite.bite' : 'combat.claw', { position: rec.pos, volume: 0.9 });
      return;
    }
    if (!readVec(msg.o, _a)) {
      if (!em) return;
      _a.copy(em);
    }
    if (!readVec(msg.d, _sd) || _sd.lengthSq() < 1e-6) return;
    _sd.normalize();
    const range = 60;
    // does it pass close to me?
    const pp = ctx.player?.position;
    let toMe = false;
    if (pp) {
      _p.set(pp.x, pp.y + 1.2, pp.z).sub(_a);
      const along = _p.dot(_sd);
      if (along > 0 && along < range) {
        _n.copy(_a).addScaledVector(_sd, along);
        const miss = _n.distanceTo(_v.set(pp.x, pp.y + 1.2, pp.z));
        if (miss < 1.6) {
          toMe = true;
          _end.copy(_n);
          if (rec) {
            rec.targetsMe = Math.max(rec.targetsMe, 4);
            onTarget(rec, true);
          }
        }
      }
    }
    let impact = 'player';
    if (!toMe) {
      _b.copy(_a).addScaledVector(_sd, 0.6);
      trace(_b, _sd, range, { enemiesToo: false });
      _end.copy(hit.point);
      impact = hit.kind === 'none' ? 0 : hit.kind === 'water' ? 'water' : 'terrain';
    }
    if (_a.distanceToSquared(camera.position) > 280 * 280) return;
    if (w === 'bolt') {
      // raider carbine: chunky orange-red plasma bolts, slower than a laser (you see them coming)
      fx.glow(_a, BOLT_ORANGE, 0.22, 0.5, 0.08, 0, 1, 6);
      fx.bolt(_a, _end, BOLT_ORANGE, { speed: 95, len: 1.6, width: 0.13, core: 2.2, intensity: 6, impact, normal: toMe ? null : hit.normal });
      ctx.audio?.play?.('combat.raider.shot', { position: _a, volume: 0.8 });
      return;
    }
    fx.glow(_a, ENEMY_RED, 0.25, 0.55, 0.09, 0, 1, 6);
    fx.bolt(_a, _end, ENEMY_RED, { speed: 130, len: 3.4, width: 0.1, core: 2.5, intensity: 5, impact, normal: toMe ? null : hit.normal });
    ctx.audio?.play?.('combat.drone.laser', { position: _a, volume: 0.85 });
  }

  function onBoom(msg) {
    if (!msg || !readVec(msg.at, _p)) return;
    const r = Number(msg.r) || 6;
    const kind = msg.kind === 'shock' || msg.kind === 'grenade' || msg.kind === 'shock-grenade' ? 'shock' : 'fire';
    fx.explosion(_p, kind, r * (kind === 'shock' ? 1 : 0.6));
    ctx.audio?.play?.(kind === 'shock' ? 'combat.grenade.boom' : 'combat.boom', { position: _p, volume: 1, size: 1 });
    // hide the local grenade that caused it
    let best = null;
    let bd = 100;
    for (const f of flying) {
      if (!f.on) continue;
      const d = f.p.distanceToSquared(_p);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (best) {
      best.on = false;
      best.model.group.visible = false;
    }
    const pp = ctx.player?.position;
    if (pp) {
      const d = Math.hypot(pp.x - _p.x, pp.y - _p.y, pp.z - _p.z);
      if (d < r * 4) ctx.cameraRig?.shake?.(clamp(0.6 * (1 - d / (r * 4)), 0, 0.6));
    }
  }

  function onDeny(msg) {
    if (!msg || !COMBAT_DENIES.has(msg.of)) return;
    const txt = DENY_TEXT[msg.reason] || REASONS?.[msg.reason] || TXT.denied;
    if (msg.of === C.RESPAWN) {
      death?.denied?.(msg.reason === 'beacon' || msg.reason === 'no-beacon' ? { en: 'No spawn beacon — pick another spot', nl: 'Geen spawnbaken — kies een andere plek' } : null);
      return;
    }
    // 'rate' / 'reloading' are prediction drift (a shot a few ms early): reconcile silently
    if (msg.of !== C.HIT && !SILENT_DENIES.has(msg.reason)) hud.deny(txt);
    // an 'empty' deny carries the server's magazine + reserve for that weapon
    const wd = msg.w && defs.byId[msg.w];
    if (wd && ws[wd.id] && (Number.isFinite(msg.mag) || Number.isFinite(msg.ammo))) {
      if (inv) {
        if (Number.isFinite(msg.mag)) inv.mag = { ...(inv.mag || {}), [wd.id]: msg.mag };
        if (Number.isFinite(msg.ammo) && wd.ammo) inv.ammo = { ...(inv.ammo || {}), [wd.ammo]: msg.ammo };
      }
      ws[wd.id].sync(Number.isFinite(msg.mag) ? msg.mag : undefined, Number.isFinite(msg.ammo) ? msg.ammo : undefined);
    }
    if (msg.of === C.FIRE || msg.of === C.RELOAD || msg.of === C.THROW) {
      // our prediction was wrong: take the server numbers again
      lastShotAt = -1e9;
      for (const d of defs.list) ws[d.id].cancelReload();
      applyInv();
    }
  }

  // ------------------------------------------------ boss + world events
  const boss = { id: null, maxHp: ENEMY_DEFS.warden?.hp || 4200, name: BOSS.name, on: false, runes: 0 };
  function onEvent(msg) {
    if (!msg) return;
    const k = msg.kind;
    if (k === 'night-raid') {
      if (msg.phase === 'start') hud.banner(TXT.nightRaid, TXT.nightRaidSub, { kind: 'danger', duration: 5 });
      else if (msg.phase === 'end') hud.banner(TXT.raidOver, '', { kind: 'wave', duration: 4 });
    } else if (k === 'boss') {
      if (msg.id != null) boss.id = msg.id;
      if (Number.isFinite(msg.maxHp) && msg.maxHp > 0) boss.maxHp = msg.maxHp;
      if (msg.phase === 'start') {
        boss.on = true;
        if (msg.name) boss.name = msg.name;
        if (!msg.late) {
          hud.banner(TXT.bossWake, TXT.bossWakeSub, { kind: 'danger', duration: 5 });
          ctx.audio?.play?.('combat.boss.sting', { volume: 0.9 });
        }
        const rec = enemies?.records.get(boss.id);
        if (rec) rec.maxHp = boss.maxHp;
      } else if (msg.phase === 'phase' && msg.n >= 2) {
        hud.banner(TXT.bossPhase, msg.n >= 3 ? TXT.bossPhase3 : TXT.bossPhase2, { kind: 'danger', duration: 3.5 });
      } else if (msg.phase === 'rune') {
        hud.banner(TXT.runeBroken, TXT.runeBrokenSub, { kind: 'wave', duration: 3 });
      } else if (msg.phase === 'end') {
        boss.on = false;
        hud.bossBar(null);
        if (msg.result === 'defeated') {
          const by = msg.by === me() ? t(TXT.you) : msg.byName || '';
          hud.banner(TXT.bossDown, by ? t(TXT.bossDownBy, { name: by }) : TXT.bossDownSub, { kind: 'wave', duration: 6 });
          ctx.audio?.play?.('combat.boss.victory', { volume: 0.9 });
        } else if (msg.result === 'reset') hud.banner(TXT.bossReset, '', { kind: 'wave', duration: 3 });
      }
    } else if (k === 'hunt' && msg.phase === 'start') {
      const sub = msg.type === 'stalker' ? TXT.huntStalker : msg.type === 'raider' ? TXT.huntRaider : msg.type === 'mite' ? TXT.huntMite : TXT.huntDrone;
      hud.banner(TXT.hunted, sub, { kind: 'danger', duration: 4.5 });
      if (Array.isArray(msg.from)) {
        const at = new THREE.Vector3(msg.from[0], getH(msg.from[0], msg.from[1]) + 1, msg.from[1]);
        ctx.audio?.play?.(msg.type === 'stalker' ? 'combat.stalker.howl' : 'combat.hunt', { position: at, volume: 1 });
        ctx.markers?.set?.('cbt-hunt', { position: at, label: t(TXT.hunters), kind: 'enemy', color: '#ff5a4e', icon: 'target', screen: false, compass: true });
        clearTimeout(huntTimer);
        huntTimer = setTimeout(() => ctx.markers?.remove?.('cbt-hunt'), 14000);
      }
    } else if (k === 'dodged') {
      hud.dodged();
      ctx.audio?.play?.('combat.dodged', { volume: 0.7 });
    } else if (k === 'poi' && msg.phase === 'cleared') {
      const title = msg.type === 'ruin' ? TXT.clearedRuin : msg.type === 'wreck' ? TXT.clearedWreck : TXT.cleared;
      hud.banner(title, TXT.clearedSub, { kind: 'wave', duration: 4.5 });
      ctx.audio?.play?.('combat.cleared', { volume: 0.85 });
      if (Array.isArray(msg.at)) {
        const at = new THREE.Vector3(msg.at[0], msg.at[1] + 0.8, msg.at[2]);
        ctx.markers?.set?.('cbt-cache', { position: at, label: t(TXT.cache), kind: 'loot', color: '#ffd27f', icon: 'star', screen: true, compass: true });
        clearTimeout(cacheTimer);
        cacheTimer = setTimeout(() => ctx.markers?.remove?.('cbt-cache'), 120000);
      }
    }
  }
  let huntTimer = 0;
  let cacheTimer = 0;
  // the boss's arena is a fixed landmark: always on the compass / map (kind 'boss')
  const bossSite = new THREE.Vector3(BOSS.site.x, getH(BOSS.site.x, BOSS.site.z) + 12, BOSS.site.z);
  ctx.markers?.set?.('cbt-boss', { position: bossSite, label: t(BOSS.name), kind: 'boss', color: '#ff3b2f', icon: 'target', screen: false, compass: true });
  /** Per frame: the boss bar follows the boss record (hp, phase, runes) while you are near an awake boss. */
  function updateBoss() {
    const rec = boss.id != null ? enemies?.records.get(boss.id) : null;
    const pp = ctx.player?.position;
    const awake = rec && !rec.dead && (rec.flags & 3) > 0;
    if (awake && pp && rec.pos.distanceTo(pp) < 330) {
      const max = Math.max(boss.maxHp, rec.hp, 1);
      hud.bossBar(boss.name, rec.hp / max, { phase: rec.flags & 3, runes: (rec.flags >> 3) & 7 });
    } else if (!rec || rec.dead || !awake || (pp && rec.pos.distanceTo(pp) >= 360)) hud.bossBar(null);
  }

  // "Enemy" ping on the compass while an enemy targets me
  const marked = new Set();
  function onTarget(rec, on) {
    const id = `cbt-enemy-${rec.id}`;
    if (on && !marked.has(rec.id)) {
      marked.add(rec.id);
      ctx.markers?.set?.(id, { position: () => rec.pos, label: t({ en: 'Enemy', nl: 'Vijand' }), kind: 'enemy', color: '#ff5a4e', icon: 'target', screen: false, compass: true });
    } else if (!on && marked.has(rec.id)) {
      marked.delete(rec.id);
      ctx.markers?.remove?.(id);
    }
  }
  function updateTargets(dt) {
    if (!enemies) return;
    updateBoss();
    const pp = ctx.player?.position;
    enemies.records.forEach((rec) => {
      // stalkers: chasing / attacking within 35 m and heading roughly at me
      if (pp && rec.type === 'stalker' && !rec.dead && (rec.state === 'chase' || rec.state === 'attack') && rec.dist < 45) {
        const dx = pp.x - rec.pos.x;
        const dz = pp.z - rec.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        const fx2 = -Math.sin(rec.h);
        const fz2 = -Math.cos(rec.h);
        if ((dx * fx2 + dz * fz2) / l > 0.75 || l < 4) rec.targetsMe = Math.max(rec.targetsMe, 1.2);
      }
      const on = rec.targetsMe > 0 && !rec.dead;
      if (on !== marked.has(rec.id)) onTarget(rec, on);
    });
    for (const id of marked) {
      if (!enemies.records.has(id)) {
        marked.delete(id);
        ctx.markers?.remove?.(`cbt-enemy-${id}`);
      }
    }
  }

  function handle(name, msg) {
    switch (name) {
      case 'net:welcome':
        inv = mergeInv(null, msg?.inv || {});
        applyInv();
        setVitals(msg?.stats);
        if (dead && msg?.stats?.hp > 0) onRespawned({ id: me() });
        break;
      case 'net:inv':
        inv = mergeInv(inv, msg);
        applyInv();
        break;
      case 'net:stats': {
        const prevHp = setVitals(msg);
        if (Number.isFinite(msg?.hp) && msg.hp < prevHp - 0.5 && performance.now() - lastHurtAt > 400 && !dead) {
          // damage without a DAMAGE event (energy drain)
          hud.hurt(prevHp - msg.hp, null);
        }
        break;
      }
      case 'net:damage':
        if (msg?.target === me()) lastHurtAt = performance.now();
        onDamage(msg);
        break;
      case 'net:death':
        onDeath(msg);
        break;
      case 'net:respawned':
        onRespawned(msg);
        break;
      case 'net:fired':
        onFired(msg);
        break;
      case 'net:efire':
        onEnemyFire(msg);
        break;
      case 'net:boom':
        onBoom(msg);
        break;
      case 'net:deny':
        onDeny(msg);
        break;
      case 'net:event':
        onEvent(msg);
        break;
      default:
        break;
    }
  }
  let lastHurtAt = -1e9;

  function respawn(at) {
    send({ t: C.RESPAWN, at });
  }

  /** Test / debug helper: point the camera at a world position. */
  function lookAt(x, y, z) {
    const rig = ctx.cameraRig;
    if (!rig) return;
    camera.getWorldPosition(_o);
    const dx = x - _o.x;
    const dy = y - _o.y;
    const dz = z - _o.z;
    rig.yaw = Math.atan2(-dx, -dz);
    const [plo, phi] = pitchRange(rig);
    rig.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)) * 0.9, plo, phi);
  }

  return {
    update,
    updateTargets,
    handle,
    state,
    weapons: ws,
    vitals: vit,
    draw: (idOrSlot) => draw(typeof idOrSlot === 'number' ? defs.bySlot[idOrSlot] : defs.byId[idOrSlot] || current),
    holster: () => holster(false),
    cycle,
    reload: tryReload,
    fire: () => (armed && current.kind !== 'throw' && ws[current.id].canFire ? shoot(current) : false),
    throwGrenade,
    startQuickThrow: () => {
      if (!grenadeDef || ws[grenadeDef.id].reserve <= 0) {
        hud.deny(TXT.noGrenades);
        return false;
      }
      if (blockReason) return false;
      quickThrow = true;
      quickThrowT = 0;
      touchHold = true;
      return true;
    },
    releaseQuickThrow: () => {
      touchHold = false;
    },
    toggleAim: () => {
      if (!armed) draw(current);
      aimToggle = !aimToggle;
    },
    dodge,
    respawn,
    lookAt,
    trace,
    safeAt,
    hub,
    /** Debug / tests: aim every shot at enemy `id` (or a {x, y, z} point); null = back to the crosshair. */
    track(target) {
      if (target && Number.isFinite(target.x)) {
        trackId = null;
        trackP.set(target.x, target.y, target.z);
        trackOn = true;
      } else {
        trackId = target ?? null;
        trackOn = false;
        updateTrack();
      }
      return trackOn;
    },
    get armed() {
      return armed;
    },
    get current() {
      return current;
    },
    get aiming() {
      return aiming;
    },
    get dead() {
      return dead;
    },
    /** seconds until the death screen opens (−1 = not pending) — debug */
    get deathT() {
      return deathT;
    },
    get safe() {
      return safe;
    },
    get blockReason() {
      return blockReason;
    },
    get owned() {
      return owned;
    },
    get inv() {
      return inv;
    },
    get grenades() {
      return grenadeDef ? ws[grenadeDef.id].reserve : 0;
    },
    canUse,
    dispose() {
      holster(false);
      for (const m of models.values()) m.dispose();
      arc.points.removeFromParent();
      arc.land.removeFromParent();
      for (const f of flying) f.model?.dispose();
      for (const x of pxPool) x.model.dispose();
    },
  };
}
