/**
 * SMP module (Ø Universe survival layer) → ctx.smp. Installed after net + combat.
 *
 * While a game server is reachable (ctx.net online, or the in-page LocalServer)
 * this module mirrors the server inventory, drives the inventory & crafting
 * screen, consumables, loot crates, claims and the build module's online
 * authority. With the fallback net (no server at all) it stays dormant and the
 * single-player build mode is unchanged.
 *
 * API (ctx.smp):
 *   enabled, ready (server welcome received), online (authority active)
 *   inv {res, credits, ammo, items, weapons, slot, mag, unlocks}, stats {hp, sh, en, maxHp, maxSh}
 *   open(tab = 'inv' | 'craft'), close(), toggle(tab), isOpen()
 *   craft(recipeId, n = 1) → bool (sent), use(itemId) → bool, pickup(lootId) → bool, equip(slot)
 *   station({own}) → {tier, dist, id, owner} | null   best workbench within RECIPE_RANGE of the player
 *   hasBeacon() → bool (own spawn beacon), inOwnClaim(x, z) → bool, claimAt(x, z) → claim | null
 *   claims {map, list, current}, loot {crates, list}, deathDrop {id, pos, until} | null
 *   touchMenu [{id, label, icon, run}] (combat spreads it into its touch overlay's menuExtra)
 *   world {half, buffer, source, isSafe(x, z), buildable(x, z), borderDist(x, z)} — hub safe zone + build rules
 *     (PLATFORM.md §11: ctx.worldgen / shared/worldgen when present, else the stand-in hub square)
 *   zone {kind: 'safe' | 'leaving' | 'buffer' | 'wild', safe, d (signed distance to the hub border)}
 *   me() → own player id, send(msg) → bool
 * Keys: I inventory, 5 / 6 / 7 ration / medkit / shield cell (not while building, in dialogue or typing).
 * Events: smp:ready, smp:inv {changed}, smp:stats, smp:crafted {recipe, n}, smp:used {item},
 *   smp:pickup {loot, got}, smp:claimed {id, x, z, r}, smp:claims, smp:kill {type, id},
 *   smp:screen {open, tab}, smp:equip {slot, weapon}, smp:zone {kind, safe, d, crossed}.
 * Files: logic + zone (pure, node --test) · bridge (server messages + build authority) · screen · hud ·
 *   loot · claims · world (rules provider) · border (Ø beacons on the hub border) · icons · smp.css.
 * URL (dev): ?smphub=<half>[,<buffer>] shrinks the stand-in hub (test building near the old base plot).
 */
import './smp.css';
import { C } from '../../shared/protocol.js';
import { ITEMS, USE_COOLDOWN } from '../../shared/defs/items.js';
import { RECIPES, RECIPE_RANGE } from '../../shared/defs/recipes.js';
import { REASONS } from '../../shared/defs/reasons.js';
import { WEAPON_SLOTS } from '../../shared/defs/weapons.js';
import { t } from '../core/i18n.js';
import { registerSmpIcons } from './icons.js';
import { emptyInv, mergeInv, stationNear, claimAt } from './logic.js';
import { createBridge, reasonText, noticeText, lostText } from './bridge.js';
import { createClaims } from './claims.js';
import { createLoot } from './loot.js';
import { createSmpHud, CONSUMABLES } from './hud.js';
import { createScreen } from './screen.js';
import { createWorldRules } from './world.js';
import { createBorder } from './border.js';
import { createZoneTracker } from './zone.js';

const TXT = {
  inventory: { en: 'Inventory', nl: 'Inventaris' },
  crafted: { en: 'Crafted', nl: 'Gemaakt' },
  craftFail: { en: 'Can’t craft', nl: 'Kan niet maken' },
  useFail: { en: 'Can’t use that', nl: 'Kan dat niet gebruiken' },
  pickupFail: { en: 'Can’t open the crate', nl: 'Kan de krat niet openen' },
  used: { en: '{name} used', nl: '{name} gebruikt' },
  none: { en: 'No {name} left', nl: 'Geen {name} meer' },
  upgraded: { en: 'Workbench upgraded to Mk II', nl: 'Werkbank geüpgraded naar Mk II' },
  useBench: { en: 'Use workbench', nl: 'Werkbank gebruiken' },
  useBench2: { en: 'Use Workbench Mk II', nl: 'Werkbank Mk II gebruiken' },
  claimDone: { en: 'Land claimed', nl: 'Land geclaimd' },
  claimText: { en: 'Only you can build or demolish within 24 m of your beacon.', nl: 'Alleen jij kunt binnen 24 m van je baken bouwen of slopen.' },
  spawnDone: { en: 'Spawn beacon set', nl: 'Spawnbaken ingesteld' },
  spawnText: { en: 'After a defeat you can respawn here.', nl: 'Na een nederlaag kun je hier respawnen.' },
};

export async function install(ctx) {
  const { events, loop, input, ui } = ctx;
  registerSmpIcons();

  // DEV: ?smplocal runs the real LocalServer + shared/sim when ctx.net is only the fallback
  if (ctx.params.smplocal && (!ctx.net || ctx.net.mode === 'off' || typeof ctx.net.send !== 'function')) {
    try {
      (await import('./dev/localnet.js')).installDevNet(ctx);
    } catch (err) {
      console.error('[smp] dev local net failed', err);
    }
  }
  const net = ctx.net;
  const realNet = !!net && typeof net.send === 'function' && net.mode !== 'off';

  const smp = {
    enabled: realNet,
    ready: false,
    inv: emptyInv(),
    stats: { hp: 100, sh: 50, en: 100, maxHp: 100, maxSh: 50 },
    deathDrop: null,
    events,
  };
  smp.me = () => ctx.net?.id ?? null;

  // ------------------------------------------------------------ parts
  smp.world = createWorldRules(ctx);
  smp.zone = { kind: 'safe', safe: true, d: -smp.world.half };
  const tracker = createZoneTracker({ buffer: smp.world.buffer });
  const border = realNet ? createBorder(ctx, smp.world) : null;
  const bridge = createBridge(ctx, smp);
  smp.send = (msg) => bridge.send(msg);
  smp.claims = createClaims(ctx, smp);
  smp.loot = createLoot(ctx, smp);
  smp.hud = createSmpHud(ctx, smp);
  const screen = createScreen(ctx, smp);

  // ------------------------------------------------------------ helpers
  const records = () => ctx.build?.registry?.records?.values?.() || [];
  const playerPos = () => ctx.player?.position || null;
  smp.station = ({ own = false } = {}) => {
    const p = playerPos();
    if (!p) return null;
    return stationNear(records(), p.x, p.z, RECIPE_RANGE, own ? smp.me() : null);
  };
  smp.hasBeacon = () => {
    const me = smp.me();
    for (const r of records()) if (r.type === 'spawn-beacon' && r.owner != null && r.owner === me) return true;
    return false;
  };
  smp.claimAt = (x, z) => claimAt(smp.claims.list, x, z);
  smp.inOwnClaim = (x, z) => {
    const c = claimAt(smp.claims.list, x, z);
    return !!c && c.owner != null && c.owner === smp.me();
  };

  // ------------------------------------------------------------ authority on / off
  function syncAuthority() {
    const mode = ctx.net?.mode;
    const live = realNet && (mode === 'online' || mode === 'local' || mode === 'connecting');
    smp.online = live;
    const cur = ctx.build?.authority;
    if (live && cur !== bridge.authority) ctx.build?.setAuthority?.(bridge.authority);
    else if (!live && cur) {
      ctx.build?.setAuthority?.(null);
      ctx.build?.setNodeSource?.(null);
      border?.setVisible(false);
    }
  }
  events.on('net:status', (s) => {
    syncAuthority();
    if (s?.mode === 'connecting') bridge.flush('offline');
  });

  // ------------------------------------------------------------ server messages (via bridge)
  smp.onWelcome = (m) => {
    smp.world.init(m);
    border?.setVisible(true);
    ctx.build?.setNodeSource?.(smp.world.provider); // wilderness harvest nodes (same ids as the sim)
    tracker.reset();
    smp.inv = emptyInv();
    mergeInv(smp.inv, m.inv || {});
    if (m.stats) Object.assign(smp.stats, m.stats);
    syncAuthority();
    ctx.build?.applyRemote?.({ reset: true, add: Array.isArray(m.structures) ? m.structures : [] });
    smp.claims.reset(m.claims);
    smp.loot.reset(m.loot);
    smp.loot.clearDrop();
    // depleted harvest nodes ([[nodeId, respawnAt], …] or [{node, respawnAt}])
    const st = typeof ctx.net?.serverTime === 'function' ? ctx.net.serverTime() : m.world?.st ?? Date.now();
    for (const n of Array.isArray(m.nodes) ? m.nodes : []) {
      const id = Array.isArray(n) ? n[0] : n?.node ?? n?.id;
      const at = Array.isArray(n) ? n[1] : n?.respawnAt;
      ctx.build?.applyHarvest?.({ node: id, respawnIn: (Number(at) - st) / 1000, silent: true });
    }
    const first = !smp.ready;
    smp.ready = true;
    smp.hud.onReady();
    // claim decay notices for the returning owner (§11.2: restored / removed while away)
    for (const n of Array.isArray(m.notices) ? m.notices : []) {
      const x = noticeText(n);
      if (x) ui.toast({ title: x.title, text: x.text, icon: 'smp-claim', kind: x.kind, duration: 9000 });
    }
    screen.render();
    events.emit('smp:inv', { changed: ['all'] });
    if (first) events.emit('smp:ready', { id: smp.me() });
  };

  smp.onInv = (m) => {
    const changed = mergeInv(smp.inv, m);
    if (!changed.length) return;
    smp.hud.refreshBar();
    if (changed.includes('res') || changed.includes('items') || changed.includes('ammo') || changed.includes('weapons') || changed.includes('credits') || changed.includes('slot')) screen.render();
    events.emit('smp:inv', { changed });
  };

  smp.onStats = (m) => {
    for (const k of ['hp', 'sh', 'en', 'maxHp', 'maxSh']) if (Number.isFinite(+m[k])) smp.stats[k] = +m[k];
    smp.hud.onStats(smp.stats);
    events.emit('smp:stats', smp.stats);
  };

  smp.onStructures = (m) => {
    // my own claim / spawn beacon confirmations (the placer gets cid + ok)
    if (!m.ok || m.by == null || m.by !== smp.me()) return;
    for (const rec of m.add || []) {
      if (rec.type === 'spawn-beacon' && !m.upd) ui.toast({ title: t(TXT.spawnDone), text: t(TXT.spawnText), icon: 'smp-spawn', kind: 'success', duration: 4200 });
      if (rec.type === 'claim-beacon' && !m.upd) ui.toast({ title: t(TXT.claimDone), text: t(TXT.claimText), icon: 'smp-claim', kind: 'success', duration: 5200 });
    }
    syncBenches();
  };

  smp.onLost = (reason, n) => {
    const x = lostText(reason, n);
    if (x) ui.toast({ title: x.title, text: x.text, icon: 'smp-claim', kind: 'warn', duration: 7000 });
  };

  smp.onCrafted = (m) => {
    const r = RECIPES[m.recipe];
    const n = m.n | 0 || 1;
    if (r) {
      const text = r.upgrade ? t(TXT.upgraded) : `${t(r.name)}${n > 1 ? ` ×${n}` : ''}`;
      ui.toast({ title: t(TXT.crafted), text, icon: 'smp-craft', kind: 'reward', duration: 2800 });
    }
    ctx.audio?.play?.('reward');
    screen.done(m.recipe);
    events.emit('smp:crafted', { recipe: m.recipe, n });
  };

  smp.onDeny = (m, text) => {
    if (m.of === C.CRAFT) {
      screen.done(null);
      ui.toast({ title: t(TXT.craftFail), text, icon: 'smp-craft', kind: 'warn', duration: 2600 });
      ctx.audio?.play?.('ui.error');
    } else if (m.of === C.USE) {
      smp.hud.flashSlot(m.item || lastUse, false);
      if (m.reason !== 'cooldown') ui.toast({ title: t(TXT.useFail), text, icon: 'smp-bag', kind: 'warn', duration: 2200 });
      ctx.audio?.play?.('ui.error');
    } else if (m.of === C.PICKUP) {
      ui.toast({ title: t(TXT.pickupFail), text, icon: 'smp-crate', kind: 'warn', duration: 2200 });
    }
  };

  // kills (survival quest) + own death drop
  const enemyTypes = new Map();
  smp.onDeath = (m) => {
    const me = smp.me();
    if (m.id != null && m.id === me) {
      if (m.drop != null) smp.loot.setDrop(m.drop, m.at);
      return;
    }
    if (m.by != null && m.by === me) {
      const type = m.type || ctx.net?.enemies?.get?.(m.id)?.type || enemyTypes.get(m.id) || null;
      if (type || String(m.id).startsWith('e')) events.emit('smp:kill', { id: m.id, type });
    }
  };
  smp.onRespawned = () => {};

  // ------------------------------------------------------------ actions
  let lastUse = null;
  let useT = 0;
  smp.use = (item) => {
    if (!smp.ready || !ITEMS[item]) return false;
    if ((smp.inv.items?.[item] | 0) <= 0) {
      smp.hud.flashSlot(item, false);
      ui.toast({ title: t(TXT.useFail), text: t(TXT.none, { name: t(ITEMS[item].name).toLowerCase() }), icon: 'smp-bag', kind: 'warn', duration: 2000 });
      ctx.audio?.play?.('ui.error');
      return false;
    }
    if (loop.time - useT < USE_COOLDOWN * 0.9) return false;
    useT = loop.time;
    lastUse = item;
    const ok = bridge.send({ t: C.USE, item });
    if (ok) {
      smp.hud.flashSlot(item, true);
      ctx.audio?.play?.('ui.click');
      events.emit('smp:used', { item });
    }
    return ok;
  };
  smp.craft = (recipe, n = 1) => {
    if (!smp.ready || !RECIPES[recipe]) return false;
    return bridge.send({ t: C.CRAFT, recipe, n: Math.max(1, n | 0) });
  };
  smp.pickup = (id) => smp.loot.pickup(id);
  smp.equip = (slot) => (WEAPON_SLOTS[slot] ? bridge.send({ t: C.EQUIP, slot }) : false);
  smp.open = (tab) => screen.open(tab);
  smp.close = () => screen.close();
  smp.toggle = (tab) => screen.toggle(tab);
  smp.isOpen = () => screen.isOpen();
  smp.reasonText = reasonText;
  smp.touchMenu = [{ id: 'smp-inventory', label: TXT.inventory, icon: 'smp-bag', run: () => screen.open() }];

  // ------------------------------------------------------------ workbench interactions ([E] → crafting)
  const benches = new Map(); // record id → interaction id
  function syncBenches() {
    const seen = new Set();
    for (const r of records()) {
      if (r.type !== 'workbench' && r.type !== 'workbench-2') continue;
      seen.add(r.id);
      const key = `${r.id}:${r.type}`;
      if (benches.get(r.id) === key) continue;
      if (benches.has(r.id)) ctx.interactions?.remove?.(`smp-bench-${r.id}`);
      benches.set(r.id, key);
      const pos = new ctx.THREE.Vector3(r.x, r.y + 1.0, r.z);
      const tier2 = r.type === 'workbench-2';
      ctx.interactions?.add?.({
        id: `smp-bench-${r.id}`,
        scope: 'world',
        position: pos,
        radius: Math.min(RECIPE_RANGE - 0.5, 3.6),
        label: t(tier2 ? TXT.useBench2 : TXT.useBench),
        key: 'KeyE',
        priority: 1,
        enabled: () => smp.ready && !ctx.build?.active,
        onInteract: () => screen.open('craft'),
      });
    }
    for (const id of [...benches.keys()]) {
      if (seen.has(id)) continue;
      benches.delete(id);
      ctx.interactions?.remove?.(`smp-bench-${id}`);
    }
  }
  for (const ev of ['build:placed', 'build:removed', 'build:remote']) events.on(ev, () => syncBenches());

  // ------------------------------------------------------------ keys + per frame
  const typing = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  };
  window.addEventListener(
    'keydown',
    (e) => {
      // I closes the screen while its modal blocks gameplay input (opening goes through the loop below)
      if (e.code === 'KeyI' && !e.repeat && screen.isOpen() && !typing()) {
        e.preventDefault();
        screen.close();
      }
    },
    true,
  );

  // ------------------------------------------------------------ hub safe zone tracking (4 Hz)
  let zoneAcc = 1;
  function updateZone() {
    const p = ctx.vehicles?.current?.object?.position || playerPos();
    if (!p || !smp.ready) return;
    const d = smp.world.borderDist(p.x, p.z);
    const z = tracker.update(d);
    const kind = z.kind;
    const changed = kind !== smp.zone.kind || z.crossed !== 0;
    smp.zone.kind = kind;
    smp.zone.safe = z.safe;
    smp.zone.d = d;
    const need = kind === 'buffer' ? smp.world.buffer - d : 0;
    smp.hud.setZone(kind, d, need, z.crossed);
    if (changed) events.emit('smp:zone', { kind, safe: z.safe, d, crossed: z.crossed });
  }

  let benchAcc = 0;
  loop.add(
    'smp',
    (dt) => {
      const explore = ctx.modes?.is?.('explore');
      if (explore && input.gameEnabled && !ctx.modes.transitioning) {
        if (input.pressed('KeyI')) screen.toggle();
        if (smp.ready && !ctx.build?.active && !ctx.dialogue?.isOpen) {
          for (let k = 0; k < CONSUMABLES.length; k++) {
            const id = CONSUMABLES[k];
            if (input.pressed(`Digit${ITEMS[id].hotkey}`)) smp.use(id);
          }
        }
      }
      zoneAcc += dt;
      if (zoneAcc > 0.25) {
        zoneAcc = 0;
        updateZone();
      }
      smp.claims.update(dt);
      smp.loot.update(dt);
      smp.hud.update(dt);
      screen.update(dt);
      benchAcc += dt;
      if (benchAcc > 2) {
        benchAcc = 0;
        syncBenches();
        if (smp.ready && smp.online && smp.world.sync()) ctx.build?.setNodeSource?.(smp.world.provider);
        if (ctx.net?.enemies?.forEach) ctx.net.enemies.forEach((e, id) => e?.type && enemyTypes.set(id, e.type));
      }
    },
    { order: 47, pausable: false },
  );

  // touch: the Inventory tile in the menu sheet of the explore layout (combat's overlay spreads smp.touchMenu)
  function mergeTouchMenu() {
    const tc = ctx.touch;
    if (!tc?.enabled || typeof tc.getLayout !== 'function') return;
    for (const name of ['explore', 'default']) {
      const L = tc.getLayout(name);
      if (!L) continue;
      const extra = Array.isArray(L.menuExtra) ? L.menuExtra : [];
      if (extra.some((x) => x?.id === 'smp-inventory')) continue;
      tc.setLayout(name, { ...L, menuExtra: [...extra, ...smp.touchMenu] });
    }
  }
  mergeTouchMenu();
  events.on('game:installed', mergeTouchMenu);

  // ------------------------------------------------------------ boot
  syncAuthority();
  // a welcome that arrived before this module installed (LocalServer answers fast)
  const early = ctx.net?.welcome || ctx.net?.client?.welcome || null;
  if (realNet && early && !smp.ready) smp.onWelcome(early);
  events.on('game:ready', () => {
    syncBenches();
    if (smp.ready) events.emit('smp:ready', { id: smp.me(), late: true });
  });

  Object.defineProperty(smp, 'REASONS', { value: REASONS });
  console.log(`[smp] installed (${realNet ? `net ${ctx.net.mode}` : 'single-player fallback — dormant'})`);
  return smp;
}
