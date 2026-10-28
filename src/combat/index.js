/**
 * Combat module (Ø Universe) → ctx.combat. Weapons client, aiming / firing /
 * FX, crosshair + hit markers, health / shield / energy + ammo HUD, damage
 * feedback, killfeed, enemy visuals (from ctx.net.enemies), death & respawn
 * screen, combat sounds and the touch combat layout (PLATFORM.md §1/§7/§8).
 * The server decides damage: this module only sends C.FIRE / C.HIT / C.THROW /
 * C.RELOAD / C.EQUIP / C.RESPAWN and renders what comes back (net:* events).
 *
 * API (ctx.combat):
 *   armed, weapon (id | null), slot, aiming, dead, safe, blockReason, isSafe(x, z), hub {x, z, radius}
 *   defs { list, byId, bySlot }       weapon numbers (shared/defs/weapons.js over PLATFORM §8)
 *   equip(id | slot), holster(), cycle(dir), reload(), fire(), throwGrenade(), dodge(), respawn(at)
 *   stats { hp, sh, en, maxHp, maxSh }, inv (last server inventory), grenades
 *   enemies (Map id → visual record), fx, hud, death, controller
 *   models { createWeaponModel, weaponGeometries, HOLD, weaponIcon }  (weapon meshes for others)
 *   mock (dev fake server when ctx.net is missing or ?combatmock), debug { … }
 * Events: combat:fire {weapon, hit, target}, combat:kill {id, type}, combat:death {by, cause},
 *   combat:respawn.
 * Safe zones (PLATFORM §11): the hub (the hand-made middle, r ≈ 1100 m) is one safe zone — weapons
 *   holstered, minimal combat HUD, "Safe zone" chip; combat is on beyond it. Rule: ctx.frontier / worldgen /
 *   world / net / smp .isSafe(x, z) when one exists → shared/worldgen isSafe → hub radius ∪ the sim's zones.
 * URL: ?combatmock (fake enemies + server without shared/sim), ?combatmock=near (spawn next to you),
 *   ?combatsafe=static (only the sim's static zones — tests while enemies still spawn inside the hub),
 *   ?combatsafe=off (never safe).
 * Files: weapon-data · logic (+ logic.test) · geo · models · fx · enemies · hud (+ combat.css) ·
 *   death · controller · sounds · touch · mock.
 */
import './combat.css';
import { normalizeWeapons } from './weapon-data.js';
import { createFx } from './fx.js';
import { createEnemies } from './enemies.js';
import { createHud } from './hud.js';
import { createDeath } from './death.js';
import { createController } from './controller.js';
import { registerCombatSounds } from './sounds.js';
import { installCombatTouch } from './touch.js';
import { createMock } from './mock.js';
import { createWeaponModel, weaponGeometries, HOLD, weaponIcon } from './models.js';

// shared/defs/weapons.js is written by the sim engineer: picked up automatically when present
const SHARED_DEFS = import.meta.glob('../../shared/defs/weapons.js', { eager: true });

const NET_EVENTS = ['net:welcome', 'net:inv', 'net:stats', 'net:damage', 'net:death', 'net:respawned', 'net:fired', 'net:efire', 'net:boom', 'net:deny', 'net:event'];

export async function install(ctx, { progress = () => {} } = {}) {
  const t0 = performance.now();
  if (!ctx.world?.scene) throw new Error('combat: ctx.world.scene missing');
  const sharedMod = Object.values(SHARED_DEFS)[0] || null;
  const defs = normalizeWeapons(sharedMod);
  const { modes, loop, events } = ctx;

  const sounds = registerCombatSounds(ctx);
  const fx = createFx(ctx);
  progress(0.2);

  // ---------------------------------------------------------- net / mock
  const forceMock = ctx.params.combatmock != null && ctx.params.combatmock !== '0' && ctx.params.combatmock !== 'false';
  const netMissing = !ctx.net || !ctx.net.send || ctx.net.mode === 'off';
  let mock = null;
  let controller = null;
  const deliver = (name, payload) => {
    const msg = payload && typeof payload === 'object' && !payload.t && payload.msg && typeof payload.msg === 'object' ? payload.msg : payload;
    try {
      controller?.handle(name, msg);
    } catch (err) {
      console.error(`[combat] ${name} failed`, err);
    }
  };
  if (forceMock || netMissing) mock = createMock(ctx, { defs, emit: deliver });
  const getNet = () => mock || ctx.net;

  const enemies = createEnemies(ctx, {
    fx,
    getNet,
    onTargetChange: (rec, on) => {
      if (!on) ctx.markers?.remove?.(`cbt-enemy-${rec.id}`);
    },
  });
  progress(0.55);
  let hudState = null;
  const hud = createHud(ctx, { defs, enemies, getState: () => hudState });
  const death = createDeath(ctx, {
    onRespawn: (at) => controller.respawn(at),
    hasBeacon: () => {
      try {
        const h = ctx.smp?.hasBeacon?.();
        if (typeof h === 'boolean') return h;
        const inv = controller?.inv;
        if (inv && 'beacon' in inv) return !!inv.beacon;
      } catch {
        /* optional */
      }
      return true;
    },
    hasBase: () => {
      // own claim (smp's claim store); unknown → enabled (the server falls back to the Overlook)
      try {
        const smp = ctx.smp;
        const me = smp?.me?.();
        const list = smp?.claims?.list;
        if (me != null && Array.isArray(list)) return list.some((c) => c && c.owner === me);
      } catch {
        /* optional */
      }
      return true;
    },
  });
  controller = createController(ctx, { defs, fx, enemies, hud, death, getNet });
  hudState = controller.state;
  hud.onSwitch = () => {
    if (controller.blockReason || controller.dead) return;
    if (controller.armed) controller.cycle(1);
    else controller.draw(controller.current.id);
  };
  progress(0.8);

  if (!mock) for (const name of NET_EVENTS) events.on(name, (p) => deliver(name, p));
  // a welcome that arrived before we were installed
  if (!mock && ctx.net?.welcome) deliver('net:welcome', ctx.net.welcome);

  // ------------------------------------------------------------- systems
  const world = () => modes.is('explore', 'drive');
  if (mock) {
    loop.add('cbt-mock', (dt) => mock.step(Math.min(dt, 0.1)), { order: 15, when: world });
    events.once('game:start', () => {
      mock.start();
      if (String(ctx.params.combatmock) === 'near') {
        const p = ctx.player?.position;
        if (p) {
          mock.spawn('drone', p.x + 14, p.z - 22);
          mock.spawn('stalker', p.x - 16, p.z - 26);
        }
      }
    });
  }
  loop.add('cbt-control', (dt) => controller.update(Math.min(dt, 0.1)), { order: 21 });
  loop.add(
    'cbt-enemies',
    (dt, time) => {
      enemies.update(Math.min(dt, 0.1), time);
      controller.updateTargets(dt);
    },
    { order: 31, when: world },
  );
  loop.add('cbt-fx', (dt) => fx.update(Math.min(dt, 0.1)), { order: 36, when: world });
  loop.add('cbt-hud', (dt) => hud.update(Math.min(dt, 0.1)), { order: 93, when: () => modes.is('explore', 'drive') });

  const touchLayout = installCombatTouch(ctx, controller);
  progress(1);

  const api = {
    get armed() {
      return controller.armed;
    },
    get weapon() {
      return controller.armed ? controller.current.id : null;
    },
    get current() {
      return controller.current.id;
    },
    get slot() {
      return controller.current.slot;
    },
    get aiming() {
      return controller.aiming;
    },
    get dead() {
      return controller.dead;
    },
    get safe() {
      return controller.safe;
    },
    get blockReason() {
      return controller.blockReason;
    },
    /** PLATFORM §11 safe-zone rule used to holster weapons (hub = safe; providers first). */
    isSafe: (x, z) => controller.safeAt(x, z),
    hub: controller.hub,
    get grenades() {
      return controller.grenades;
    },
    get inv() {
      return controller.inv;
    },
    defs,
    stats: controller.vitals,
    weapons: controller.weapons,
    equip: (idOrSlot) => controller.draw(idOrSlot),
    holster: () => controller.holster(),
    cycle: (dir = 1) => controller.cycle(dir),
    reload: () => controller.reload(),
    fire: () => controller.fire(),
    throwGrenade: () => controller.throwGrenade(),
    dodge: () => controller.dodge(),
    respawn: (at = 'spawn') => controller.respawn(at),
    enemies: enemies.records,
    enemyVisuals: enemies,
    fx,
    hud,
    death,
    controller,
    mock,
    sounds,
    touchLayout,
    models: { createWeaponModel, weaponGeometries, HOLD, weaponIcon },
    debug: {
      /** Point the camera at an enemy (or world point) — headless tests can't aim with a mouse. */
      aimAt(target) {
        let p = null;
        if (typeof target === 'string') {
          const rec = enemies.records.get(target);
          if (rec) p = { x: rec.pos.x, y: rec.type === 'stalker' ? (ctx.world.getHeightAt?.(rec.pos.x, rec.pos.z) ?? rec.pos.y) + 0.95 : rec.pos.y, z: rec.pos.z };
        } else if (target && Number.isFinite(target.x)) p = target;
        if (!p) return false;
        controller.lookAt(p.x, p.y, p.z);
        return true;
      },
      /** Aim every shot at enemy `id` / a point (null = crosshair again): headless kill tests. */
      track: (target) => controller.track(target),
      nearest(type = null) {
        let best = null;
        const pp = ctx.player?.position;
        enemies.records.forEach((r) => {
          if (r.dead || (type && r.type !== type) || !pp) return;
          const d = r.pos.distanceTo(pp);
          if (!best || d < best.d) best = { id: r.id, type: r.type, d: Math.round(d * 10) / 10, hp: r.hp, state: r.state };
        });
        return best;
      },
      info() {
        const s = controller.state;
        return {
          mode: mock ? 'mock' : getNet()?.mode,
          armed: s.armed,
          weapon: s.def?.id,
          mag: s.ws?.mag,
          reserve: s.ws?.reserve,
          reloading: s.ws?.reloading,
          grenades: s.grenades,
          aiming: s.aiming,
          safe: s.safe,
          dead: s.dead,
          deathT: Math.round(controller.deathT * 100) / 100,
          deathOpen: !!death.open,
          block: s.reason,
          vitals: { ...controller.vitals },
          enemies: enemies.records.size,
          fx: fx.stats(),
        };
      },
    },
  };
  ctx.combat = api;
  console.log(`[combat] installed in ${Math.round(performance.now() - t0)} ms (${defs.list.length} weapons${sharedMod ? ' from shared/defs' : ' (local defs)'}, ${mock ? 'local mock server' : `net: ${ctx.net?.mode}`})`);
  return api;
}
