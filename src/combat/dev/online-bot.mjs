#!/usr/bin/env node
/**
 * Online combat smoke test (dev tool, not bundled): a headless WebSocket player that checks the
 * server accepts combat's claim format end to end —
 *   HELLO → C.TRAVEL 'wild' (Gateway) → walk toward the nearest enemy → C.FIRE {w, o, d, seq, ct, vt}
 *   + C.HIT {seq, target, at} built from the same hit volumes as the client (logic.enemyVolumes)
 *   → expects server-validated S.DAMAGE (by = me) and S.DEATH of the enemy. Exit 0 = a kill.
 *
 *   node server/index.js --local &          (PORT=8092 …)
 *   node src/combat/dev/online-bot.mjs ws://127.0.0.1:8092/ws
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const { C, S, PROTOCOL_VERSION } = await import('../../../shared/protocol.js');
const { enemyVolumes } = await import('../logic.js');
const { ENEMIES } = await import('../weapon-data.js');
const VOL = new Float32Array(16);
// feet height outside the hub (the Gateway's 'wild' spots are 2–8 km out, beyond the hub/worldgen blend band)
let groundAt = null;
try {
  const { createWorldgen } = await import('../../../shared/worldgen/index.js');
  const wg = await createWorldgen({ seed: process.env.WORLD_SEED || 'o-universe', hub: { heightAt: () => 0, isWater: () => false, radius: 1100, half: 1100, blend: 300 } });
  groundAt = (x, z) => (Math.max(Math.abs(x), Math.abs(z)) > 1450 ? wg.heightAt(x, z) : null);
} catch {
  /* no worldgen: keep the travel height */
}
const url = process.argv[2] || 'ws://127.0.0.1:8092/ws';
const ws = new WebSocket(url, { headers: { origin: url.replace('ws://', 'http://').replace('/ws', '') } });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
let me = null, pos = null, offset = 0, snap = null, seq = 1, mag = 12, reloading = false;
const stats = { fired: 0, hits: 0, dmg: [], kills: [], denies: [], hurt: 0 };
const t0 = Date.now();
const done = (code) => { log('RESULT', JSON.stringify(stats)); try { ws.close(); } catch {} setTimeout(() => process.exit(code), 200); };
setTimeout(() => done(stats.kills.length ? 0 : 1), 330000);
ws.on('open', () => send({ t: C.HELLO, v: PROTOCOL_VERSION, name: 'CombatBot', appearance: {}, lang: 'en', device: 'desktop' }));
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t === S.WELCOME) {
    me = m.you.id; pos = m.you.p; offset = m.world.st - Date.now();
    mag = m.inv?.mag?.['pulse-pistol'] ?? 12;
    log('welcome', me, pos, 'mag', mag, 'weapons', m.inv?.weapons);
    send({ t: C.TRAVEL, to: 'wild' });
  } else if (m.t === S.TRAVEL) {
    log('travel', m.phase, m.p, m.reason || '');
    if (m.phase === 'done' && m.p) pos = m.p;
  } else if (m.t === S.SNAP) { snap = m; offset = offset * 0.9 + (m.st - Date.now()) * 0.1; }
  else if (m.t === S.DAMAGE) {
    if (m.by === me) { stats.hits++; stats.dmg.push([m.target, m.amount, m.kind, m.kill ? 'K' : '']); log('hit', m.target, m.amount, m.hp, m.kill ? 'KILL' : ''); }
    else if (m.target === me) stats.hurt++;
  } else if (m.t === S.DEATH) {
    if (m.by === me) { stats.kills.push([m.id, m.type]); log('KILLED', m.id, m.type, m.byName); setTimeout(() => done(0), 500); }
    if (m.id === me) { log('bot died'); done(stats.kills.length ? 0 : 1); }
  } else if (m.t === S.DENY) { stats.denies.push([m.of, m.reason]); if (m.reason === 'empty') { mag = 0; } }
  else if (m.t === S.INV && m.mag && Number.isFinite(m.mag['pulse-pistol'])) { mag = m.mag['pulse-pistol']; reloading = false; }
  else if (m.t === S.ERROR) { log('error', m); done(2); }
});
// position keep-alive (15 Hz) at the travel destination
setInterval(() => pos && send({ t: C.STATE, p: pos, h: 0, v: [0, 0, 0], a: 'idle', m: 'foot' }), 1000 / 15);
// fire loop (≈ 3.3/s, under the pistol's 4/s)
setInterval(() => {
  if (!snap || !pos || !me) return;
  let best = null;
  for (const r of snap.en || []) {
    const [id, type, x, y, z, h, s, hp] = r;
    if (s === 6 || hp <= 0) continue;
    const d = Math.hypot(x - pos[0], z - pos[2]);
    if (d < 45 && (!best || d < best.d)) best = { id, type, x, y, z, h, d };
  }
  if (!best) {
    // walk (7 m/s) toward the nearest enemy so it notices us (stalker aggro 42 m, drone 55 m)
    let near = null;
    for (const r of snap.en || []) {
      const d = Math.hypot(r[2] - pos[0], r[4] - pos[2]);
      if (r[6] !== 6 && d < 220 && (!near || d < near.d)) near = { x: r[2], z: r[4], d };
    }
    if (near && near.d > 28) {
      const k = Math.min(2.1, near.d - 26) / near.d;
      const nx = pos[0] + (near.x - pos[0]) * k;
      const nz = pos[2] + (near.z - pos[2]) * k;
      const gy = groundAt?.(nx, nz);
      pos = [nx, Number.isFinite(gy) ? gy : pos[1], nz];
    }
    if ((Date.now() - t0) % 15000 < 300) log('waiting', pos.map(Math.round), (snap.en || []).map((r) => [r[0], r[1], Math.round(Math.hypot(r[2] - pos[0], r[4] - pos[2]))]));
    return;
  }
  if (mag <= 0) { if (!reloading) { reloading = true; send({ t: C.RELOAD, w: 'pulse-pistol' }); setTimeout(() => { reloading = false; mag = 12; }, 1600); } return; }
  // the hit volume like the client (combat logic): drone sphere at y, stalker body sphere from feet y
  enemyVolumes(ENEMIES[best.type].volumes, best.x, best.y, best.z, best.h, VOL);
  const v = { x: VOL[0], y: VOL[1], z: VOL[2], r: VOL[3] };
  const o = [pos[0], pos[1] + 1.45, pos[2]];
  let dx = v.x - o[0], dy = v.y - o[1], dz = v.z - o[2];
  const L = Math.hypot(dx, dy, dz);
  dx /= L; dy /= L; dz /= L;
  const at = [o[0] + dx * (L - v.r * 0.9), o[1] + dy * (L - v.r * 0.9), o[2] + dz * (L - v.r * 0.9)];
  const s = seq++;
  send({ t: C.FIRE, w: 'pulse-pistol', o, d: [dx, dy, dz], seq: s, ct: Date.now(), vt: snap.st });
  send({ t: C.HIT, seq: s, target: best.id, at });
  stats.fired++; mag--;
}, 300);
