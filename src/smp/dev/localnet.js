/**
 * DEV ONLY — `?smplocal`: a minimal ctx.net around the real LocalServer +
 * shared/sim for testing the SMP layer while ctx.net is the fallback (the net
 * module not installed yet / failed). Never used when a real ctx.net exists.
 * Implements the subset src/smp needs: mode 'local', id, send, on(type, fn),
 * serverTime, welcome, players/enemies/loot Maps, the ctx.state inventory
 * mirror (resources + credits) and STATE at NET.STATE_HZ (tp flag on jumps).
 */
import { C, S, NET, PROTOCOL_VERSION } from '../../../shared/protocol.js';
import { createSim } from '../../../shared/sim/index.js';
import { LocalServer } from '../../net/local-server.js';

export function installDevNet(ctx) {
  const handlers = new Map();
  const local = new LocalServer({
    createSim,
    getHeightAt: (x, z) => ctx.world.getHeightAt(x, z),
    isWater: (x, z) => !!ctx.world.isWater?.(x, z),
    storage: null,
  });
  const net = {
    online: false,
    mode: 'connecting',
    id: null,
    welcome: null,
    players: new Map(),
    enemies: new Map(),
    loot: new Map(),
    dev: true,
    local,
    send(msg) {
      conn.send(msg);
    },
    on(type, fn) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    serverTime: () => local.now(),
  };
  const mirror = (inv) => {
    if (!inv) return;
    if (inv.res) ctx.state.set('resources', { ...(inv.patch ? ctx.state.get('resources') : {}), ...inv.res });
    if (inv.credits != null) ctx.state.set('credits', inv.credits);
  };
  const conn = local.connect((msg) => {
    if (msg.t === S.WELCOME) {
      net.id = msg.you.id;
      net.welcome = msg;
      net.mode = 'local';
      mirror(msg.inv);
      ctx.events.emit('net:status', { mode: 'local' });
    }
    if (msg.t === S.INV) mirror(msg);
    if (msg.t === S.SNAP) {
      net.enemies.clear();
      for (const e of msg.en || []) net.enemies.set(e[0], { id: e[0], type: e[1], p: [e[2], e[3], e[4]], hp: e[7] });
    }
    for (const fn of handlers.get(msg.t) || []) fn(msg);
    ctx.events.emit(`net:${msg.t}`, msg);
  });
  ctx.net = net;
  const last = { x: NaN, z: NaN };
  let acc = 0;
  ctx.loop.add(
    'smp-devnet',
    (dt) => {
      local.tick(dt);
      acc += dt;
      if (acc < 1 / NET.STATE_HZ || !net.id) return;
      acc = 0;
      const p = ctx.player?.position;
      if (!p) return;
      const jump = !(Math.hypot(p.x - last.x, p.z - last.z) < 25);
      // dev only: debug teleports (tests) skip the movement validation
      const sp = jump || Math.hypot(p.x - last.x, p.z - last.z) > 3 ? local.sim?._w?.players?.get(net.id) : null;
      if (sp && !sp.dead) {
        sp.x = p.x;
        sp.y = p.y;
        sp.z = p.z;
      }
      last.x = p.x;
      last.z = p.z;
      conn.send({ t: C.STATE, p: [p.x, p.y, p.z], h: ctx.player.heading || 0, v: [0, 0, 0], a: 'idle', m: 'foot', tp: jump || undefined });
    },
    { order: 44, pausable: false },
  );
  conn.send({ t: C.HELLO, v: PROTOCOL_VERSION, name: ctx.state.get('profile.name') || 'Traveler', appearance: ctx.state.get('profile.appearance') || {}, lang: 'en', device: 'desktop' });
  console.log('[smp] DEV local net (?smplocal) — LocalServer + shared/sim');
  return net;
}
