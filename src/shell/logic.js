/**
 * Pure shell logic (no DOM, no three.js) shared by the HUD, the world map and
 * the travel controller — unit-tested in src/shell/test/logic.test.js.
 *
 * World (PLATFORM.md §11): the hand-made hub is the square |x|, |z| ≤ 1100 m
 * (safe zone); its map image / mesh covers ±1200 m; the procedural planet
 * continues infinitely around it.
 */

export const HUB_HALF = 1100; // safe-zone half-size (m)
export const HUB_EXTENT = 1200; // hub map image / terrain mesh half-size (m)
export const NO_BUILD = 500; // §11.2 no-build buffer beyond the safe zone (m)

/** Distance (m) outside the hub square (0 inside). */
export function hubDist(x, z) {
  return Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - HUB_HALF);
}

/** Inside the safe zone square. */
export function inHubSquare(x, z, half = HUB_HALF) {
  return Math.abs(x) <= half && Math.abs(z) <= half;
}

/** Nearest point of the safe-zone border (for "Safe zone 1.2 km" bearings from the wilderness). */
export function hubBorderPoint(x, z, out = { x: 0, z: 0 }, half = HUB_HALF) {
  out.x = Math.max(-half, Math.min(half, x));
  out.z = Math.max(-half, Math.min(half, z));
  return out;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------------ travel
/**
 * Which travel actions the UI offers right now (PLATFORM.md §11.2 "Spreading players out"):
 *   gateway  'wild' | 'base' | 'beacon' — the hub Gateway: only inside the hub, instant
 *   hub      "Return to hub" — from outside the hub: 10 s channel, not in combat, 2 min cooldown
 *   zones    hub fast travel between discovered hub places — only while inside the hub
 * s = { net: 'online' | 'local' | 'off' | 'connecting', mode, inHub, dead, hasClaim, hasBeacon,
 *       channel (bool), now (s), cooldownUntil (s), combatUntil (s) }
 * Every entry: { ok, reason } (reason = a REASONS key / shell reason id when not ok), plus `wait` (s).
 */
export function travelOptions(s) {
  const server = s.net === 'online' || s.net === 'local';
  const world = s.mode === 'explore' || s.mode === 'drive';
  const out = { gateway: {}, hub: { ok: false, reason: null, wait: 0 }, zones: { ok: false, reason: null } };
  const base = !world ? 'planet' : s.dead ? 'dead' : null;
  // Gateway destinations
  for (const id of ['wild', 'base', 'beacon']) {
    let reason = base || (!server ? 'offline' : !s.inHub ? 'gateway' : s.channel ? 'busy' : null);
    if (!reason && id === 'base' && !s.hasClaim) reason = 'noBase';
    if (!reason && id === 'beacon' && !s.hasBeacon) reason = 'noBeacon';
    out.gateway[id] = { ok: !reason, reason };
  }
  // Return to hub
  {
    let reason = base || (s.inHub ? 'here' : s.channel ? 'busy' : null);
    let wait = 0;
    if (!reason && server) {
      const cd = (s.cooldownUntil || 0) - (s.now || 0);
      const cb = (s.combatUntil || 0) - (s.now || 0);
      if (cb > 0) {
        reason = 'combat';
        wait = Math.ceil(cb);
      } else if (cd > 0) {
        reason = 'cooldown';
        wait = Math.ceil(cd);
      }
    }
    out.hub = { ok: !reason, reason, wait };
  }
  // hub fast travel (zone to zone) — never from the wilderness
  out.zones = { ok: !base && s.inHub && !s.channel, reason: base || (!s.inHub ? 'leaveWild' : s.channel ? 'busy' : null) };
  return out;
}

// --------------------------------------------------------------- key hints
/**
 * Context for the bottom-right key hints.
 * s = { mode, building, inHub, armed, dead, dialogue, touch }
 */
export function hintContext(s) {
  if (s.touch || s.dead || s.dialogue) return 'none';
  if (s.mode !== 'explore' || s.building) return 'none';
  if (s.armed) return 'armed';
  return s.inHub ? 'hub' : 'wild';
}

/**
 * Hint keys per context: { k: key cap, code: KeyboardEvent.code (click = press), t: label id }.
 * Labels are resolved by the caller (data.js KEY_HINT_TEXT).
 * Options: firstPerson (V label), hasInventory (smp), canBuild (build module), buildHere (§11.2: building is
 * allowed at the player's spot — no B inside the 500 m no-build buffer), cameraKnown (the player already
 * switched the camera once: the V hint retires).
 */
export function hintKeys(context, { firstPerson = false, hasInventory = true, canBuild = true, buildHere = true, cameraKnown = false } = {}) {
  const cam = cameraKnown ? null : { k: 'V', code: 'KeyV', t: firstPerson ? 'third' : 'first' };
  switch (context) {
    case 'hub':
      return [{ k: 'M', code: 'KeyM', t: 'travel' }, { k: 'J', code: 'KeyJ', t: 'missions' }, { k: 'F', code: 'KeyF', t: 'vehicle' }, cam, { k: 'H', code: 'KeyH', t: 'help' }].filter(Boolean);
    case 'wild':
      // most important first (the end is dropped when space is short; combat's ammo card already says 1–4)
      return [
        { k: 'M', code: 'KeyM', t: 'map' },
        hasInventory ? { k: 'I', code: 'KeyI', t: 'inventory' } : null,
        canBuild && buildHere ? { k: 'B', code: 'KeyB', t: 'build' } : null,
        { k: 'U', code: 'KeyU', t: 'hub' },
        cam,
        { k: '1', code: 'Digit1', t: 'draw' },
      ].filter(Boolean);
    case 'armed':
      return [{ k: 'R', code: 'KeyR', t: 'reload' }, { k: 'Q', code: 'KeyQ', t: 'dodge' }, { k: 'Z', code: 'KeyZ', t: 'grenade' }, hasInventory ? { k: 'I', code: 'KeyI', t: 'inventory' } : null, { k: 'M', code: 'KeyM', t: 'map' }, cam].filter(Boolean);
    default:
      return [];
  }
}

// ------------------------------------------------------------------- map view
/**
 * Map view: centre (cx, cz) in metres, `ppm` pixels per metre, viewport vw × vh px.
 * Screen x grows east (+x), screen y grows south (+z), north up.
 */
export function toScreen(v, x, z, out = [0, 0]) {
  out[0] = v.vw / 2 + (x - v.cx) * v.ppm;
  out[1] = v.vh / 2 + (z - v.cz) * v.ppm;
  return out;
}

export function toWorld(v, sx, sy, out = [0, 0]) {
  out[0] = v.cx + (sx - v.vw / 2) / v.ppm;
  out[1] = v.cz + (sy - v.vh / 2) / v.ppm;
  return out;
}

/** Zooms by `factor` keeping the world point under the screen anchor (sx, sy) fixed. */
export function zoomAround(v, factor, sx = v.vw / 2, sy = v.vh / 2, min = 0.02, max = 3) {
  const wx = v.cx + (sx - v.vw / 2) / v.ppm;
  const wz = v.cz + (sy - v.vh / 2) / v.ppm;
  v.ppm = clamp(v.ppm * factor, min, max);
  v.cx = wx - (sx - v.vw / 2) / v.ppm;
  v.cz = wz - (sy - v.vh / 2) / v.ppm;
  return v;
}

/**
 * Fits the world box (x0, z0)–(x1, z1) into the view minus `ins` px insets ({ l, r, t, b }: overlays such as the
 * brand, zoom buttons and scale bar), zoom clamped to [minPpm, maxPpm]; the box is centred in the free area.
 */
export function fitView(v, x0, z0, x1, z1, ins = { l: 0, r: 0, t: 0, b: 0 }, minPpm = 0.02, maxPpm = 3) {
  const aw = Math.max(80, v.vw - ins.l - ins.r);
  const ah = Math.max(80, v.vh - ins.t - ins.b);
  v.ppm = clamp(Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, z1 - z0)), minPpm, maxPpm);
  v.cx = (x0 + x1) / 2 - (ins.l - ins.r) / 2 / v.ppm;
  v.cz = (z0 + z1) / 2 - (ins.t - ins.b) / 2 / v.ppm;
  return v;
}

/** Keeps the view centre within ±limit metres (the planet is "infinite", but not 90 km of empty panning). */
export function clampCenter(v, limit) {
  v.cx = clamp(v.cx, -limit, limit);
  v.cz = clamp(v.cz, -limit, limit);
  return v;
}

const NICE = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];
/** A "nice" scale-bar length (m) whose bar spans at most maxPx pixels. */
export function niceLength(ppm, maxPx = 190) {
  let len = NICE[0];
  for (const n of NICE) if (n * ppm <= maxPx) len = n;
  return len;
}

/** Visible world rectangle of a view (+ margin px) → { x0, z0, x1, z1 }. */
export function viewBounds(v, margin = 0) {
  const hx = (v.vw / 2 + margin) / v.ppm;
  const hz = (v.vh / 2 + margin) / v.ppm;
  return { x0: v.cx - hx, z0: v.cz - hz, x1: v.cx + hx, z1: v.cz + hz };
}

// ---------------------------------------------------------------- declutter
/**
 * Greedy declutter: items [{ x, y?, p (priority, higher wins), … }] → the kept items (new array),
 * dropping any item closer than `gap` px to an already kept one. Stable for equal priorities.
 */
export function declutter(items, gap) {
  const order = items.map((it, i) => [it, i]).sort((a, b) => (b[0].p ?? 0) - (a[0].p ?? 0) || a[1] - b[1]);
  const kept = [];
  for (const [it] of order) {
    let ok = true;
    for (const k of kept) {
      const dx = it.x - k.x;
      const dy = (it.y ?? 0) - (k.y ?? 0);
      if (dx * dx + dy * dy < gap * gap) {
        ok = false;
        break;
      }
    }
    if (ok) kept.push(it);
  }
  return kept;
}

// ---------------------------------------------------------------- discovery
/** Distances (m) for wilderness points of interest. */
export const DISCOVERY = {
  reveal: 520, // an undiscovered POI shows a "?" marker on screen / compass within this distance
  enter: 48, // discovered when within POI radius + this
  max: 800, // remembered POIs (oldest dropped first)
  xp: { ruin: 150, outpost: 175, wreck: 125 },
};

/** True when the player at (x, z) is close enough to discover `poi` ({ x, z, radius }). */
export function discoveryHit(poi, x, z) {
  const r = (poi.radius || 24) + DISCOVERY.enter;
  const dx = poi.x - x;
  const dz = poi.z - z;
  return dx * dx + dz * dz <= r * r;
}

/** Remembered POI list entry: [id, type, x, z] (compact for the save); keeps the newest `max`. */
export function rememberPoi(list, poi, max = DISCOVERY.max) {
  if (list.some((e) => e[0] === poi.id)) return list;
  const next = list.concat([[poi.id, poi.type, Math.round(poi.x), Math.round(poi.z)]]);
  return next.length > max ? next.slice(next.length - max) : next;
}

// ----------------------------------------------------------------- formatting
/** Bearing (deg, 0 = north, 90 = east) from (x0, z0) to (x1, z1). */
export function bearingDeg(x0, z0, x1, z1) {
  return ((Math.atan2(x1 - x0, -(z1 - z0)) * 180) / Math.PI + 360) % 360;
}

/** Seconds → "12 s" / "1:05". */
export function formatWait(s) {
  s = Math.max(0, Math.ceil(s));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
