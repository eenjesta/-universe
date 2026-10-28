import { NET, S, PROTOCOL_VERSION } from '../shared/protocol.js';

/**
 * Minimal stand-in for shared/sim with the same API and message behaviour
 * (PLATFORM.md §4 + shared/sim/index.js): addPlayer → S.WELCOME, S.JOIN to the
 * others, S.LEAVE '*' on removal, setProfile → S.JOIN to the others, snapshots
 * of nearby players. Combat/inventory/building requests are denied.
 *
 * Used by transport tests (SIM=stub) and as the fallback when the real sim
 * fails to load. Persistence is pass-through: the world and the player saves it
 * was given come back unchanged (plus position), so running the stub never
 * wipes data written by the real sim.
 */
export function createSim({ getHeightAt = () => 0, now = Date.now, seed = 'o-universe', world = null } = {}) {
  const players = new Map();
  let out = [];
  const worldData = world ?? { v: 1, structures: [], claims: [], loot: [] };
  const R2 = NET.INTEREST_RADIUS * NET.INTEREST_RADIUS;
  const r2 = (n) => Math.round(n * 100) / 100;
  const emit = (to, msg) => out.push({ to, msg });

  function exportPlayer(id) {
    const pl = players.get(id);
    if (!pl) return null;
    return { ...(pl.save || {}), p: pl.p.map(r2), h: r2(pl.h), stats: pl.stats, inv: pl.inv };
  }

  function removePlayer(id) {
    const save = exportPlayer(id);
    if (!save) return null;
    players.delete(id);
    emit('*', { t: S.LEAVE, id });
    return save;
  }

  return {
    stub: true,
    addPlayer({ id, name, appearance, save }) {
      if (players.has(id)) removePlayer(id);
      const p = Array.isArray(save?.p) ? save.p.slice(0, 3) : [0, getHeightAt(0, 0) + 1, 0];
      const pl = {
        id,
        name,
        appearance,
        save,
        p,
        h: save?.h ?? 0,
        a: 'idle',
        m: 'foot',
        veh: null,
        stats: save?.stats ?? { hp: 100, sh: 50, en: 100 },
        inv: save?.inv ?? { res: { metal: 0, stone: 0, wood: 0, energy: 0 }, credits: 0, ammo: {}, items: {}, weapons: [], slot: 0 },
      };
      const others = [];
      for (const o of players.values()) {
        others.push({ id: o.id, name: o.name, appearance: o.appearance });
        emit(o.id, { t: S.JOIN, id, name, appearance });
      }
      players.set(id, pl);
      return {
        t: S.WELCOME,
        v: PROTOCOL_VERSION,
        you: { id, name, p: pl.p.map(r2), h: r2(pl.h) },
        world: { seed, time: 17.6, st: now(), players: others },
        inv: pl.inv,
        stats: { hp: pl.stats.hp ?? 100, sh: pl.stats.sh ?? 50, en: pl.stats.en ?? 100, maxHp: 100, maxSh: 50 },
        structures: worldData.structures ?? [],
        claims: worldData.claims ?? [],
        loot: [],
        nodes: [],
      };
    },
    removePlayer,
    handle(id, msg) {
      const pl = players.get(id);
      if (!pl) return false;
      if (msg.t === 'state') {
        pl.p = [msg.p[0], msg.p[1], msg.p[2]];
        pl.h = msg.h;
        pl.a = msg.a ?? pl.a;
        pl.m = msg.m ?? pl.m;
        pl.veh = msg.veh ?? null;
        return true;
      }
      const deny = { t: S.DENY, of: msg.t, reason: 'invalid' };
      if (msg.cid !== undefined) deny.cid = msg.cid;
      emit(id, deny);
      return false;
    },
    step() {},
    drain() {
      if (!out.length) return out;
      const o = out;
      out = [];
      return o;
    },
    snapshotFor(id) {
      const me = players.get(id);
      if (!me) return null;
      const pl = [];
      for (const o of players.values()) {
        if (o === me) continue;
        const dx = o.p[0] - me.p[0];
        const dz = o.p[2] - me.p[2];
        if (dx * dx + dz * dz > R2) continue;
        const row = [o.id, r2(o.p[0]), r2(o.p[1]), r2(o.p[2]), r2(o.h), o.a, o.m, o.stats.hp ?? 100, o.stats.sh ?? 50];
        if (o.veh) row.push(o.veh);
        pl.push(row);
      }
      return { t: S.SNAP, st: now(), pl, en: [], px: [] };
    },
    exportWorld: () => worldData,
    exportPlayer,
    setProfile(id, { name, appearance } = {}) {
      const pl = players.get(id);
      if (!pl) return false;
      if (name) pl.name = name;
      if (appearance) pl.appearance = appearance;
      for (const o of players.values()) if (o !== pl) emit(o.id, { t: S.JOIN, id, name: pl.name, appearance: pl.appearance });
      return true;
    },
    playerPos: (id) => players.get(id)?.p.map(r2) ?? null,
    has: (id) => players.has(id),
    stats: () => ({ players: players.size, enemies: 0, loot: 0, structures: worldData.structures?.length ?? 0 }),
  };
}
