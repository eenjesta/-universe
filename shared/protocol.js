/**
 * Ø Universe network protocol v1 — shared by the Node server (server/), the
 * in-browser LocalServer (src/net/, offline mode) and the client net layer.
 * Pure JS: no DOM, no Node APIs.
 *
 * Transport: WebSocket at `/ws` (same origin as the page), JSON text frames.
 * Every message is an object `{ t: <TYPE>, ...payload }`. Vectors are plain
 * arrays `[x, y, z]` (metres, world space, rounded to 2 decimals on the wire).
 * Times are milliseconds. Entity ids are short strings ('p12' players,
 * 'e7' enemies, 'l3' loot, 's41' structures, 'x9' projectiles).
 *
 * AUTHORITY (v1): the server (shared/sim) owns health/shield/energy, damage,
 * deaths, respawns, enemies, projectiles, loot, inventory (resources, ammo,
 * items, weapons, credits), crafting, harvesting, structures and claims.
 * Movement is client-authoritative but validated (speed caps per mode,
 * teleport detection → C.CORRECT). Hitscan hits are claimed by the client and
 * validated with lag compensation. PvE only in v1 (players never damage players).
 *
 * WORLD (PLATFORM.md §11): one seamless world per server — the hub in the middle
 * (|x|, |z| ≤ 1100 m) is a safe zone (no enemies, combat, damage, hunger,
 * building); the survival planet continues infinitely around it. Constants:
 * shared/defs/world.js (HUB, CLAIM_RULES, TRAVEL_RULES, hubDist).
 */

export const PROTOCOL_VERSION = 1;

/** Rates and limits (shared so client and server agree). */
export const NET = {
  TICK_HZ: 20, // server simulation rate
  SNAPSHOT_HZ: 12, // snapshots sent to each client
  STATE_HZ: 15, // client → server player state rate
  INTERP_DELAY_MS: 150, // remote entity interpolation buffer
  LAG_COMP_MS: 400, // max rewind for hit validation
  INTEREST_RADIUS: 260, // players/enemies/loot beyond this (m) are not sent
  MAX_PLAYERS_PER_WORLD: 50,
  CHAT_MAX_LEN: 200,
  CHAT_RATE: { burst: 5, perSec: 0.5 },
  MSG_RATE: { burst: 60, perSec: 40 }, // all messages per connection
  /** Speed caps (m/s) for movement validation, by mode/vehicle (+25 % tolerance applied by the server). */
  SPEED: { foot: 11, swim: 5, car: 75, vtol: 90, ship: 420, build: 11, dead: 0 },
};

/** Client → server message types. */
export const C = {
  HELLO: 'hello', // { v, token?, name, appearance, lang, device } — first message
  STATE: 'state', // { p:[x,y,z], h, v:[vx,vy,vz], a: anim, m: mode, veh?: {type, p, h}, tp?: 1 } at NET.STATE_HZ (tp = fast-travel teleport)
  FIRE: 'fire', // { w: weaponId, o:[x,y,z], d:[dx,dy,dz], seq, ct: clientTime, vt?: viewTime } (vt = ctx.net.serverTime() − NET.INTERP_DELAY_MS)
  HIT: 'hit', // { seq, target: entityId, at:[x,y,z] } — hitscan hit claim for a previous FIRE
  THROW: 'throw', // { w: 'shock-grenade', o:[x,y,z], v:[vx,vy,vz] }
  RELOAD: 'reload', // { w }
  EQUIP: 'equip', // { slot: 0..3 } (or { w: weaponId })
  RESPAWN: 'respawn', // { at: 'beacon' | 'base' | 'spawn' } — accepted 5 s after death
  HARVEST: 'harvest', // { node: nodeId } or { feature: worldFeatureId, tool?, hit? } — tool swings on trees/rocks/plants (gathering)
  CRAFT: 'craft', // { recipe, n? }
  USE: 'use', // { item } — consume (ration, medkit, shield cell)
  PICKUP: 'pickup', // { loot: lootId }
  BUILD_PLACE: 'build:place', // { piece, p:[x,y,z], rot, level?, cid } (cid = client id to match the reply)
  BUILD_REMOVE: 'build:remove', // { id, cid? }
  GRANT: 'grant', // { source: 'quest' | 'event' | 'mission' | 'discovery', id, amounts?, cid? } — server applies capped rewards once per id
  SPEND: 'spend', // { reason: 'market' | 'sell' | <sink>, id, cost:{credits?, metal?…}, cid? } — server validates (prices: shared/defs/market.js)
  CHAT: 'chat', // { text, ch: 'global' | 'local' | 'party' }
  PROFILE: 'profile', // { name?, appearance? } — after the character creator
  STORE: 'store', // { struct, op: 'put' | 'take', item? | res?, n } — storage chests (survival)

  TRAVEL: 'travel', // { to: 'hub' | 'wild' | 'base' | 'beacon', cid? } — 'hub' = "Return to hub" from anywhere (10 s channel, not in combat, 2 min cooldown); 'wild' | 'base' | 'beacon' = the hub Gateway (only inside the hub, instant). Cancel a channel: { to: 'cancel' }
  PING: 'ping', // { ct }
};

/** Server → client message types. */
export const S = {
  WELCOME: 'welcome', // { v, you:{id, token, name, p, h, dead?, claim?:{id,p,r}, beacon?:[x,z]}, world:{seed, time, dayFactor, st, n, players:[{id,name,appearance}], hub:{half, noBuild, …}}, inv, stats, structures:[…], claims:[…], loot:[…], nodes:[[nodeId, respawnAt]…], notices?:[{kind:'claim-restored'|'claim-removed'|…}] }
  JOIN: 'join', // { id, name, appearance }
  LEAVE: 'leave', // { id }
  SNAP: 'snap', // { st: serverTime, tod: hours, n: players in the world, pl:[[id,x,y,z,h,a,m,hp,sh,veh?]…], en:[[id,type,x,y,z,h,s,hp,target?]…], px:[[id,type,x,y,z]…] } — full lists inside NET.INTEREST_RADIUS (absent = gone / out of range); s = ES code; target = player id the enemy is after
  DAMAGE: 'damage', // { target, by, amount, hp, sh, kind, at:[x,y,z], crit?, kill?, from?:[x,y,z] (attacker, player victims), aoe? } — to the victim and the attacker (hit marker)
  DEATH: 'death', // { id, by, at:[x,y,z], drop?: lootId, kind?, cause?, name?, type? (enemy), byName?, w?, byType? } — players: '*', enemies: near
  RESPAWNED: 'respawned', // { id, p:[x,y,z], h }
  STATS: 'stats', // { hp, sh, en, maxHp, maxSh, maxEn, dead? } — private, when changed
  INV: 'inv', // { res:{metal,stone,wood,energy}, credits, ammo:{pulse,plasma,rail}, items:{…}, weapons:[…], slot, mag:{weaponId:n}, unlocks:[…] } — private, full or partial (patch: true, ack?: cid)
  FIRED: 'fired', // { id, w, o, d } | grenade { id, w, o, v, px, fuse } — player shots (for FX), interest-managed (includes the shooter)
  ENEMY_FIRE: 'efire', // { id, o, d, w: 'laser' | 'claw', hit, target } — enemy attacks (for FX)
  EXPLODE: 'boom', // { at:[x,y,z], r, kind }
  LOOT: 'loot', // { add?:[{id, p:[x,y,z], items, owner?, ttl}], remove?:[id] }
  STRUCT: 'struct', // { add?:[record], remove?:[id], by?, cid?, ok?, reason?, name?, refund? } (record = build module structure record + owner; add with a known id = update; remove with by: null + reason 'decay' | 'admin' = claim decay / moderation)
  CLAIMS: 'claims', // { add?:[{id, owner, name, p:[x,z], r, sid, decay? (0..1 while the absent owner's base decays)}], remove?:[id] }
  HARVESTED: 'harvested', // { node, by, res:{…}, respawnAt (server ms), respawnIn (s) }
  CRAFTED: 'crafted', // { recipe, n, structure? (workbench upgrade) }
  EVENT: 'event', // { kind: 'night-raid' | 'boss' | …, phase: 'start' | 'end', … }
  CHAT: 'chat', // { from, name, text, ch, ts, sys? }
  CORRECT: 'correct', // { p:[x,y,z], reason } — server rejected the client's position (snap back)
  FEATURE: 'feature', // { id, state: 'ok' | 'hit' | 'felled' | 'broken' | 'picked', hp?, by?, regrowAt? } — world trees/rocks/plants (gathering)
  STORAGE: 'storage', // { struct, items, res } — contents of a storage chest (to players allowed to open it)

  DENY: 'deny', // { of: messageType, reason, cid? } — request rejected (no ammo, not allowed, claim…)
  ERROR: 'error', // { code, msg } — fatal (bad version, banned, full)
  PONG: 'pong', // { ct, st }
  TRAVEL: 'travel', // { phase: 'channel' | 'cancel' | 'done', to, at? (server ms the channel completes), secs? (channel length), p?:[x,y,z], h?, reason? ('moved' | 'combat' | 'dead' | 'player'), cid? } — private; on 'done' move the local player to p (the server already did). Refusals: S.DENY {of: 'travel', reason: 'here' | 'busy' | 'combat' | 'cooldown' | 'gateway' | 'noBase' | 'noBeacon' | 'noSpot' | 'dead', wait? (s)}
};

/** Enemy state codes (S.SNAP en rows, field s). */
export const ES = { IDLE: 0, PATROL: 1, CHASE: 2, ATTACK: 3, LEAP: 4, STUN: 5, DEAD: 6, RETURN: 7 };

/** Round a number for the wire. */
export const r2 = (n) => Math.round(n * 100) / 100;
export const vec = (v) => [r2(v[0] ?? v.x), r2(v[1] ?? v.y), r2(v[2] ?? v.z)];

export function encode(msg) {
  return JSON.stringify(msg);
}

export function decode(raw) {
  try {
    const m = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    return m && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}
