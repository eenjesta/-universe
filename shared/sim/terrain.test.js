/**
 * Real-terrain checks (bakes the heightfield once, ≈4 s): harvest nodes and
 * the performance budget (50 players + 120 enemies at 20 Hz < 5 ms per step).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeTerrain } from '../../src/world/terrain/heightfield.js';
import { createQueries } from '../../src/world/terrain/queries.js';
import { generateNodes, roadClearance } from './nodes.js';
import { protectedAt } from '../defs/pieces.js';
import { createSim } from './index.js';
import { createStandin } from './standin.js';
import { C, NET } from '../protocol.js';

const data = await bakeTerrain();
const q = createQueries(data, 0);

test('harvest nodes on the real terrain: deterministic, dry, flat, off roads and landmarks', () => {
  const a = generateNodes({ getHeightAt: q.getHeightAt, isWater: q.isWater });
  const b = generateNodes({ getHeightAt: (x, z) => q.getHeightAt(x, z), isWater: (x, z) => q.isWater(x, z) });
  assert.ok(a.length >= 35 && a.length <= 40, `count ${a.length}`);
  assert.deepEqual(
    a.map((n) => [n.id, n.type, n.x, n.z]),
    b.map((n) => [n.id, n.type, n.x, n.z]),
  );
  const types = new Set(a.map((n) => n.type));
  assert.deepEqual([...types].sort(), ['energy', 'metal', 'stone', 'wood']);
  for (const n of a) {
    assert.ok(!q.isWater(n.x, n.z) && n.y >= 1.5, `${n.id} dry`);
    assert.ok(roadClearance(n.x, n.z) >= 3.5, `${n.id} off road`);
    assert.equal(protectedAt(n.x, n.z, 4), null, `${n.id} not protected`);
    assert.ok(Math.abs(n.y - q.getHeightAt(n.x, n.z)) < 1e-6);
    for (const m of a) if (m !== n) assert.ok(Math.hypot(m.x - n.x, m.z - n.z) >= 8);
  }
});

test('performance: 50 players + 120 enemies at 20 Hz stay under 5 ms per step (server-like world)', () => {
  let t = 1e7;
  // like server/worldgen.js until shared/worldgen lands: the hub heightfield + the stand-in planet around it
  const world = createStandin({ seed: 'perf', hub: { heightAt: q.getHeightAt, isWater: q.isWater }, noise: true });
  const sim = createSim({ getHeightAt: world.heightAt, isWater: world.isWater, worldgen: world, now: () => t, seed: 'perf' });
  const W = sim._w;
  // 50 players in 10 groups out in the wild (jungle, badlands, the south), on foot (so enemies engage)
  const spots = [[-1700, 200], [-2600, -900], [1800, 600], [2600, 1500], [300, 1900], [-900, 2600], [2200, -300], [-1500, -1300], [900, 3000], [-2000, 1800]];
  const players = [];
  for (let i = 0; i < 50; i++) {
    const [sx, sz] = spots[i % spots.length];
    const a = (i / 50) * Math.PI * 2;
    const x = sx + Math.cos(a) * 20;
    const z = sz + Math.sin(a) * 20;
    sim.addPlayer({ id: `p${i}`, name: `P${i}` });
    const p = W.players.get(`p${i}`);
    p.x = x;
    p.z = z;
    p.y = world.heightAt(x, z);
    p.expect = null;
    players.push(p);
  }
  assert.ok(players.every((p) => !world.isSafe(p.x, p.z)));
  // 120 enemies around the players (mixed types)
  for (let i = 0; i < 120; i++) {
    const p = players[i % players.length];
    const a = i * 2.39;
    const r = 25 + (i % 7) * 6;
    sim._w.enemiesSys.create(i % 3 ? 'drone' : 'stalker', p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, null);
  }
  sim.drain();
  const dt = 1 / NET.TICK_HZ;
  const times = [];
  const cpu = []; // CPU time (ms): robust against a busy machine descheduling the test (upper bound: includes GC threads)
  let snapMs = 0;
  let snaps = 0;
  let msgs = 0;
  for (let tick = 0; tick < 400; tick++) {
    t += 50;
    // client states at ~15 Hz: wander a little
    if (tick % 4 !== 3) {
      for (const p of players) {
        const nx = p.x + Math.sin(tick * 0.1 + p.x) * 0.3;
        const nz = p.z + Math.cos(tick * 0.1 + p.z) * 0.3;
        sim.handle(p.id, { t: C.STATE, p: [nx, world.heightAt(nx, nz), nz], h: 0, v: [0, 0, 0], a: 'walk', m: 'foot' });
      }
    }
    for (const p of players) {
      p.hp = p.maxHp; // keep everyone in the fight
      p.sh = p.maxSh;
    }
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    sim.step(dt);
    const out = sim.drain();
    for (const o of out) sim.recipients(o.to);
    times.push(performance.now() - t0);
    const c = process.cpuUsage(c0);
    cpu.push((c.user + c.system) / 1000);
    msgs += out.length;
    if (tick % 2 === 0) {
      const s0 = performance.now();
      for (const p of players) JSON.stringify(sim.snapshotFor(p.id));
      snapMs += performance.now() - s0;
      snaps++;
    }
  }
  const warm = times.slice(40).sort((x, y) => x - y);
  const wall = warm.reduce((s, v) => s + v, 0) / warm.length;
  const p95 = warm[Math.floor(warm.length * 0.95)];
  const cw = cpu.slice(40);
  const mean = cw.reduce((s, v) => s + v, 0) / cw.length;
  const st = sim.stats();
  let engaged = 0;
  for (const e of W.enemies.values()) if (e.target) engaged++;
  console.log(`[perf] step cpu mean ${mean.toFixed(2)} ms, wall mean ${wall.toFixed(2)} ms, wall p95 ${p95.toFixed(2)} ms; 50 snapshots+JSON ${(snapMs / snaps).toFixed(2)} ms; ${st.enemies} enemies (${engaged} engaged), ${(msgs / 400).toFixed(1)} msgs/tick`);
  assert.ok(engaged >= 60, `enemies in combat ${engaged}`);
  assert.ok(st.enemies >= 110, `enemies alive ${st.enemies}`);
  assert.ok(mean < 5, `mean step (cpu) ${mean.toFixed(2)} ms`);
});

// shared/worldgen (the real planet, built by the worldgen engineer): index.js once it lands, worldgen.js meanwhile
const WG = (await import('../worldgen/index.js').catch(() => null)) || (await import('../worldgen/worldgen.js').catch(() => null));

test('the real shared/worldgen as the sim provider: hub safe, night spawns in the wild, worldgen nodes, gateway', { skip: !WG?.createWorldgen && 'shared/worldgen not available' }, () => {
  const wg = WG.createWorldgen({ seed: 'o-universe', hub: { heightAt: q.getHeightAt, isWater: q.isWater, getWaterHeightAt: q.getWaterHeightAt } });
  let t = 1e7;
  const sim = createSim({ getHeightAt: wg.heightAt, isWater: wg.isWater, worldgen: wg, now: () => t, seed: 'o-universe' });
  const W = sim._w;
  assert.equal(W.world.kind, 'worldgen');
  assert.equal(sim.isSafe(0, 150), true);
  assert.equal(sim.isSafe(3000, 0), false);
  assert.equal(typeof sim.biomeAt(-3000, 0), 'string');
  assert.equal(sim.biomeAt(0, 0), 'hub');
  // players in the wild at night → enemies spawn there, never in the hub
  sim.setTime(23);
  const spots = [[-2600, -900], [2600, 1500], [-900, 2600]];
  spots.forEach(([x, z], i) => {
    sim.addPlayer({ id: `p${i}`, name: `P${i}` });
    const p = W.players.get(`p${i}`);
    p.x = x;
    p.z = z;
    p.y = wg.heightAt(x, z);
    p.m = 'car'; // counted for spawning, not targeted
    p.expect = null;
  });
  for (let i = 0; i < 20 * 40; i++) {
    t += 50;
    sim.step(0.05);
    sim.drain();
  }
  assert.ok(W.enemies.size >= 6, `night spawns (${W.enemies.size})`);
  for (const e of W.enemies.values()) assert.ok(!sim.isSafe(e.home.x, e.home.z) && e.biome && e.biome !== 'hub');
  // worldgen resource nodes: stable ids, harvestable by the server
  const p = W.players.get('p0');
  const n = sim.nodesNear(p.x, p.z, 250).find((m) => !/^n\d+$/.test(m.id));
  assert.ok(n, 'a worldgen node near the player');
  p.m = 'foot';
  p.x = n.x + 1.5;
  p.z = n.z;
  p.y = wg.heightAt(p.x, p.z);
  assert.equal(sim.handle('p0', { t: C.HARVEST, node: n.id }), true);
  assert.ok(sim.drain().some((o) => o.msg.t === 'harvested' && o.msg.node === n.id));
  // the hub Gateway finds dry, buildable wilderness spots
  p.x = 0;
  p.z = 150;
  assert.equal(sim.handle('p0', { t: C.TRAVEL, to: 'wild' }), true);
  assert.ok(!sim.isSafe(p.x, p.z) && !wg.isWater(p.x, p.z) && Math.hypot(p.x, p.z) >= 2000);
});
