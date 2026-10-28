/**
 * Wilderness knowledge for the HUD and the world map (PLATFORM.md §11): what the
 * player knows about the infinite planet around the hub.
 *
 *   inHub(x, z), hubDist(x, z)          safe zone (worldgen when present, else the hub square)
 *   poisNear(x, z, r, slot?)            worldgen POIs (ruins / outposts / wrecks) — discovered or not (cached per slot)
 *   discovered (Map id → {id, type, x, z}), isDiscovered(id)
 *   myClaim(), claims(), beacon(), bed(), deathDrop()   own claim / other claims / spawn beacon / home bed / death crate
 *   waypoint {x, z} | null, setWaypoint(x, z), clearWaypoint()   (marker 'shell-waypoint', tracked)
 *   biome(x, z) → { id, name } | null    waystonesNear(x, z, r), roadName(id)   highway beacons (every km)
 *   update(dt, focus)                   discovery (2×/s), biome + highway + POI announcements
 * State: `shell.pois` ([[id, type, x, z], …], newest last) and `shell.waypoint` ([x, z] | null).
 * Events: `shell:discover` { poi }, `shell:waypoint` { x, z } | null.
 */
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { HUB_HALF, hubDist as squareDist, inHubSquare, DISCOVERY, discoveryHit, rememberPoi } from './logic.js';

const WAYPOINT_ID = 'shell-waypoint';
const TXT = {
  discovered: { en: 'Location discovered: {name}', nl: 'Locatie ontdekt: {name}' },
  wilderness: { en: 'Wilderness', nl: 'Wildernis' },
  highwaySub: { en: 'Protected highway · no building here', nl: 'Beschermde snelweg · hier niet bouwen' },
  poiSub: { en: 'Guarded · loot inside', nl: 'Bewaakt · buit binnen' },
  waypoint: { en: 'Waypoint', nl: 'Markering' },
  reached: { en: 'Waypoint reached', nl: 'Markering bereikt' },
};
/** POI icons (registered in icons.js) and colours, shared by the minimap, compass and map. */
export const POI_STYLE = {
  ruin: { icon: 'shell-ruin', color: '#6fe9ff' },
  outpost: { icon: 'shell-outpost', color: '#ff8a5c' },
  wreck: { icon: 'shell-wreck', color: '#ffd36e' },
};
const POI_NAMES = {
  ruin: { en: 'Ancient Ø Ruins', nl: 'Oude Ø-ruïnes' },
  outpost: { en: 'Pirate Outpost', nl: 'Piratenbuitenpost' },
  wreck: { en: 'Crash Site', nl: 'Neerstortplek' },
};
export const poiName = (p) => t(p?.name || POI_NAMES[p?.type] || { en: 'Point of interest', nl: 'Bezienswaardigheid' });

export function createWild(ctx) {
  const { state, events } = ctx;
  state.ensure('shell', { visited: [] });
  const discovered = new Map();
  const load = () => {
    discovered.clear();
    const list = state.get('shell.pois');
    if (Array.isArray(list)) for (const e of list) if (Array.isArray(e) && e[0]) discovered.set(String(e[0]), { id: String(e[0]), type: e[1], x: e[2], z: e[3] });
  };
  load();
  events.on('state:reset', load);

  const wg = () => ctx.worldgen || ctx.frontier?.worldgen || null;

  function inHub(x, z) {
    const g = wg();
    if (g?.isSafe) return !!g.isSafe(x, z);
    return inHubSquare(x, z, HUB_HALF);
  }
  function hubDist(x, z) {
    const g = wg();
    return g?.hubDist ? g.hubDist(x, z) : squareDist(x, z);
  }

  // ---------------------------------------------------------------- POIs
  // poisNear is cheap but allocates: cache per ~150 m step of the query centre (one cache per caller slot,
  // so the world map's wide views don't evict the HUD's list around the player)
  const nearCaches = new Map();
  function poisNear(x, z, r, slot = 'hud') {
    const g = wg();
    if (!g?.poisNear) return [];
    let near = nearCaches.get(slot);
    if (!near) nearCaches.set(slot, (near = { x: NaN, z: NaN, r: 0, list: [] }));
    const step = Math.max(150, r * 0.1);
    if (Math.abs(x - near.x) < step && Math.abs(z - near.z) < step && r <= near.r) return near.list;
    near.x = x;
    near.z = z;
    near.r = r + step + 10;
    try {
      near.list = g.poisNear(x, z, near.r) || [];
    } catch {
      near.list = [];
    }
    return near.list;
  }

  function discover(p, { silent = false } = {}) {
    if (!p?.id || discovered.has(p.id)) return false;
    discovered.set(p.id, { id: p.id, type: p.type, x: p.x, z: p.z });
    state.set('shell.pois', rememberPoi(state.get('shell.pois') || [], p));
    events.emit('shell:discover', { poi: p });
    if (silent) return true;
    const xp = DISCOVERY.xp[p.type] ?? 120;
    const title = t(TXT.discovered, { name: poiName(p) });
    const notify = ctx.systems?.notify;
    if (notify?.show) notify.show({ kind: 'discovery', icon: POI_STYLE[p.type]?.icon || 'pin', title, sub: `+${xp} XP`, sound: 'quest.update', duration: 4200 });
    else ctx.ui.toast({ title, text: `+${xp} XP`, icon: POI_STYLE[p.type]?.icon || 'pin', kind: 'success', duration: 4200 });
    try {
      ctx.progress?.addXP?.(xp, 'discovery');
    } catch (err) {
      console.warn('[shell] discovery XP failed', err);
    }
    return true;
  }

  // -------------------------------------------------------------- claims
  const me = () => ctx.smp?.me?.() ?? ctx.net?.id ?? null;
  function claims() {
    return ctx.smp?.claims?.list || [];
  }
  function myClaim() {
    const id = me();
    if (id == null) return null;
    for (const c of claims()) if (c.owner != null && c.owner === id) return c;
    return null;
  }
  const _beacon = { x: 0, z: 0 };
  function beacon() {
    const id = me();
    const recs = ctx.build?.registry?.records;
    if (id != null && recs?.values) {
      for (const r of recs.values()) {
        if (r?.type === 'spawn-beacon' && r.owner === id && Number.isFinite(r.x)) {
          _beacon.x = r.x;
          _beacon.z = r.z;
          return _beacon;
        }
      }
    }
    const b = ctx.net?.welcome?.you?.beacon;
    if (Array.isArray(b) && Number.isFinite(b[0])) {
      _beacon.x = b[0];
      _beacon.z = b[1];
      return _beacon;
    }
    return null;
  }
  /** Your home bed (smp: the bed you last slept in = your respawn), else any bed you own. */
  const _bed = { x: 0, z: 0, id: null };
  function bed() {
    const id = me();
    const recs = ctx.build?.registry?.records;
    if (id == null || !recs?.get) return null;
    const home = ctx.smp?.bedId;
    let r = home != null ? recs.get(home) || recs.get(String(home)) : null;
    if (!r || r.owner !== id) {
      r = null;
      for (const x of recs.values()) {
        if (x?.def?.smp?.bed && x.owner === id) {
          r = x;
          break;
        }
      }
    }
    if (!r || !Number.isFinite(r.x)) return null;
    _bed.x = r.x;
    _bed.z = r.z;
    _bed.id = r.id;
    return _bed;
  }
  function deathDrop() {
    const d = ctx.smp?.deathDrop;
    const p = d?.pos;
    return p && Number.isFinite(p.x) ? p : null;
  }
  /** Seconds until the death crate expires (smp: `until` in loop time), or null. */
  function deathDropLeft() {
    const d = ctx.smp?.deathDrop;
    return d && Number.isFinite(d.until) ? Math.max(0, d.until - ctx.loop.time) : null;
  }

  // ------------------------------------------------------------ waypoint
  let waypoint = null;
  const wpPos = new THREE.Vector3();
  function setWaypoint(x, z, { silent = false } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    waypoint = { x, z };
    const h = ctx.world?.getHeightAt?.(x, z);
    wpPos.set(x, (Number.isFinite(h) ? Math.max(h, 0) : 0) + 1.6, z);
    ctx.markers?.set(WAYPOINT_ID, { position: wpPos, label: t(TXT.waypoint), kind: 'waypoint', color: '#ffd27a', icon: 'shell-waypoint', scope: 'world', screen: true, compass: true });
    state.set('shell.waypoint', [Math.round(x), Math.round(z)]);
    if (ctx.shell?.track) ctx.shell.track(WAYPOINT_ID);
    if (!silent) events.emit('shell:waypoint', { x, z });
  }
  function clearWaypoint({ reached = false } = {}) {
    if (!waypoint) return;
    waypoint = null;
    ctx.markers?.remove(WAYPOINT_ID);
    state.set('shell.waypoint', null);
    if (ctx.shell?.frame?.trackedId === WAYPOINT_ID) ctx.shell.track(null);
    events.emit('shell:waypoint', null);
    if (reached) ctx.ui.toast({ title: t(TXT.reached), icon: 'shell-waypoint', kind: 'success', duration: 2400 });
  }
  const saved = state.get('shell.waypoint');
  if (Array.isArray(saved) && Number.isFinite(saved[0])) {
    // restore once the world can answer heights
    events.on('game:ready', () => setWaypoint(saved[0], saved[1], { silent: true }));
  }

  // ----------------------------------------------------------- waystones
  /** Highway waystones (a beacon every km, §11.2) within r of (x, z): [{ id, road, km, x, z }] (allocates). */
  function waystonesNear(x, z, r) {
    const g = wg();
    if (!g?.waystonesIn) return [];
    try {
      return g.waystonesIn(x - r, z - r, x + r, z + r) || [];
    } catch {
      return [];
    }
  }
  let roadNames = null;
  /** Highway name ({ en, nl } resolved) by road id. */
  function roadName(id) {
    if (!roadNames) {
      roadNames = new Map();
      for (const r of wg()?.highways || []) roadNames.set(r.id, r.name ? t(r.name) : '');
    }
    return roadNames.get(id) || '';
  }

  // ------------------------------------------------------------- biomes
  function biome(x, z) {
    const g = wg();
    if (!g?.biomeAt) return null;
    try {
      const b = g.biomeAt(x, z);
      return b && b.id !== 'hub' ? { id: b.id, name: b.name } : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------- update
  let acc = 0;
  let lastBiome = null;
  let biomeSince = 0;
  const announced = new Map(); // key → realTime
  let zoneLabel = null;
  const canAnnounce = (key, cooldown) => {
    const now = ctx.loop.realTime;
    if (now - (announced.get(key) ?? -1e9) < cooldown) return false;
    announced.set(key, now);
    return true;
  };

  function update(dt, focus) {
    acc += dt;
    if (acc < 0.5) return;
    const step = acc;
    acc = 0;
    if (!ctx.modes.is('explore', 'drive') || ctx.modes.transitioning) return;
    const x = focus.x;
    const z = focus.z;
    // waypoint reached
    if (waypoint && Math.hypot(waypoint.x - x, waypoint.z - z) < 14) clearWaypoint({ reached: true });
    if (inHub(x, z)) {
      lastBiome = null;
      return;
    }
    // POI discovery + area names
    let inside = null;
    for (const p of poisNear(x, z, 300)) {
      if (!discoveryHit(p, x, z)) continue;
      inside = p;
      if (!discovered.has(p.id)) discover(p);
      else if (zoneLabel && canAnnounce(`poi:${p.id}`, 90)) zoneLabel.show(poiName(p), { iconName: POI_STYLE[p.type]?.icon || 'pin', sub: t(TXT.poiSub) });
      break;
    }
    if (inside || !zoneLabel) return;
    // biome changes (stable for 2 s) and highways
    const b = biome(x, z);
    const id = b?.id || null;
    if (id !== lastBiome?.id) {
      lastBiome = b;
      biomeSince = 0;
    } else biomeSince += step;
    if (b && biomeSince >= 1.5 && biomeSince < 1.5 + step + 0.01 && canAnnounce(`biome:${b.id}`, 150)) {
      zoneLabel.show(t(b.name), { iconName: 'shell-compass-rose', sub: t(TXT.wilderness) });
      return;
    }
    const g = wg();
    if (ctx.modes.is('explore') && g?.isOnHighway?.(x, z, 2)) {
      const road = g.roadsNear?.(x, z, 30)?.[0];
      if (road && canAnnounce(`road:${road.id}`, 180)) zoneLabel.show(t(road.name), { iconName: 'shell-route', sub: t(TXT.highwaySub) });
    }
  }

  return {
    inHub,
    hubDist,
    poisNear,
    discovered,
    isDiscovered: (id) => discovered.has(id),
    discover,
    claims,
    myClaim,
    beacon,
    bed,
    deathDrop,
    deathDropLeft,
    me,
    biome,
    waystonesNear,
    roadName,
    get waypoint() {
      return waypoint;
    },
    setWaypoint,
    clearWaypoint,
    waypointId: WAYPOINT_ID,
    update,
    /** The zone label announces biomes / highways / POI areas (set by the shell). */
    set zoneLabel(z) {
      zoneLabel = z;
    },
  };
}
