/**
 * Dynamic world events (ctx.worldEvents):
 *  - starfall: "Live Event: Starfall Festival" on Nexus Plaza (each night,
 *    ?event=starfall or from the journal) → plaza.setShow(true), festival quest,
 *    sparkles + violet shooting stars, characters gather on 'event:start'.
 *  - meteors: night-time meteor shower; some meteors impact near the player and
 *    leave glowing fragments to harvest (hold E) for metal + energy.
 *  - echo: after the signal was found the beacon sends an echo to a random
 *    spot; reach it in time for XP, energy and a lore fragment.
 * Top-centre banner (poster 06): audio-wave icon + title, sub line with timer.
 * Emits event:start {id, name, position} and event:end {id, reason}.
 */
import * as THREE from 'three';
import { ZONES, ISLANDS, WATERFALLS } from '../../world/layout.js';
import { t } from '../../core/i18n.js';
import { fmt, fmtClock, groundY, isNight, hourOf, playerPos, resourceWord } from '../shared/util.js';
import { SkyStreaks, Fragments, EchoPillar, Sparkles } from './fx.js';

const BANNER_PRIORITY = ['starfall', 'meteors', 'echo'];

export function createWorldEvents(ctx, { quests, rewards, notify, refs }) {
  const { ui, state, events } = ctx;
  const scene = ctx.world?.scene;
  const active = new Map(); // id → {id, def, t, duration, data}
  let fx = null; // lazily created visuals

  function ensureFx() {
    if (fx || !scene) return fx;
    // particle budgets follow the quality preset (particles 0.4 / 0.7 / 1)
    const q = ctx.engine?.quality?.particles ?? 1;
    fx = { streaks: new SkyStreaks(scene), frags: new Fragments(scene), echo: new EchoPillar(scene), sparkles: new Sparkles(scene, Math.max(160, Math.round(520 * q))) };
    fx.streaks.rates.meteors *= Math.max(0.5, q);
    fx.streaks.rates.festival *= Math.max(0.5, q);
    fx.streaks.onImpact = (p) => impact(p);
    return fx;
  }

  const stage = () => {
    const s = ZONES.plaza.stage;
    return new THREE.Vector3(s.x, groundY(ctx, s.x, s.z), s.z);
  };

  // ================================================================== definitions
  // (text is resolved here, at install: the language only changes with a page reload)
  const DEFS = {
    starfall: {
      id: 'starfall',
      name: 'Starfall Festival',
      banner: 'Live Event: Starfall Festival',
      icon: 'sys-music',
      kind: 'starfall',
      where: ZONES.plaza.label,
      when: t({ en: 'Every night', nl: 'Elke nacht' }),
      canStart: true,
      duration: 540,
      quest: 'starfall',
      rewards: { xp: 500, credits: 300 },
      desc: t({
        en: 'Once every night, Nexus Plaza turns into a sea of light and music: a holographic stage under the Tree of Life, shooting stars and everyone together. Meet other players and enjoy the show.',
        nl: 'Eén keer per nacht verandert het Nexus-plein in een zee van licht en muziek: een holografisch podium onder de Levensboom, vallende sterren en iedereen samen. Ontmoet andere spelers en geniet van de show.',
      }),
      start(ev) {
        try {
          ctx.landmarks?.plaza?.setShow?.(true);
        } catch (err) {
          console.warn('[events] plaza.setShow failed', err);
        }
        const f = ensureFx();
        if (f) {
          const c = ctx.landmarks?.plaza?.center || stage();
          f.streaks.focus.set(c.x, 0, c.z);
          f.streaks.modes.add('festival');
          f.sparkles.show(new THREE.Vector3(ZONES.plaza.x, groundY(ctx, ZONES.plaza.x, ZONES.plaza.z), ZONES.plaza.z));
        }
        state.add('systems.festivals', 1);
        refs.chat?.system?.(t({ en: 'Live Event: the Starfall Festival has begun at Nexus Plaza!', nl: 'Live Event: het Starfall Festival is begonnen op het Nexus-plein!' }));
        later(1.6, () => refs.chat?.say?.('luna', t({ en: 'The Starfall Festival is starting! Come to the stage! 🎶', nl: 'Het Starfall Festival begint! Kom naar het podium! 🎶' })));
        const p = playerPos(ctx);
        const near = p && Math.hypot(p.x - ZONES.plaza.x, p.z - ZONES.plaza.z) < 400;
        quests.start('starfall', { restart: true, track: ev.opts.from === 'journal' || ev.opts.from === 'url' || near, silent: true });
        rewards.unlockLore('festival', { silent: true });
      },
      sub(ev) {
        return t({ en: '{place} · {time} left', nl: '{place} · nog {time}' }, { place: ZONES.plaza.label, time: fmtClock(ev.duration - ev.t) });
      },
      end() {
        try {
          ctx.landmarks?.plaza?.setShow?.(false);
        } catch {
          /* optional */
        }
        fx?.streaks.modes.delete('festival');
        fx?.sparkles.hide();
        refs.chat?.system?.(t({ en: 'The Starfall Festival is over. See you next night!', nl: 'Het Starfall Festival is afgelopen. Tot de volgende nacht!' }));
      },
    },
    meteors: {
      id: 'meteors',
      name: t({ en: 'Meteor Shower', nl: 'Meteorenregen' }),
      banner: t({ en: 'Meteor Shower', nl: 'Meteorenregen' }),
      icon: 'sys-meteor',
      kind: 'meteors',
      where: t({ en: 'All across the night sky', nl: 'Overal in de nachtlucht' }),
      when: t({ en: 'At night, unannounced', nl: '’s Nachts, onaangekondigd' }),
      canStart: false,
      duration: 180,
      quest: 'meteorshower',
      rewards: { xp: 300, credits: 150 },
      desc: t({
        en: 'Shooting stars streak across the night sky. Some of the debris reaches the ground: glowing meteorite fragments full of metal and energy. Hold [E] to harvest them.',
        nl: 'Vallende sterren kleuren de nachtlucht. Sommige brokstukken bereiken de grond: gloeiende meteorietfragmenten vol metaal en energie. Houd [E] ingedrukt om ze te oogsten.',
      }),
      start(ev) {
        const f = ensureFx();
        f?.streaks.modes.add('meteors');
        ev.data.nextImpact = 5;
        refs.chat?.system?.(t({ en: 'Meteor shower! Look up — fragments are falling nearby.', nl: 'Meteorenregen! Kijk omhoog — fragmenten vallen in de buurt.' }));
        quests.start('meteorshower', { restart: true, track: true, silent: true });
      },
      update(ev, dt) {
        ev.data.nextImpact -= dt;
        if (ev.data.nextImpact <= 0 && ev.t < ev.duration - 6) {
          ev.data.nextImpact = 16 + Math.random() * 14;
          launchImpactNearPlayer();
        }
      },
      sub(ev) {
        const q = quests.get('meteorshower');
        const o = q?.objectives?.[0];
        return t({ en: 'Harvest fragments · {n} · {time}', nl: 'Oogst fragmenten · {n} · {time}' }, { n: o ? `${o.progress}/${o.count}` : '', time: fmtClock(ev.duration - ev.t) });
      },
      end() {
        fx?.streaks.modes.delete('meteors');
        // leave fragments a little longer, then clean up
        later(60, () => {
          if (!active.has('meteors')) clearFragments();
        });
      },
    },
    echo: {
      id: 'echo',
      name: t({ en: 'Signal Echo', nl: 'Signaal-echo' }),
      banner: t({ en: 'Signal Echo detected', nl: 'Signaal-echo gedetecteerd' }),
      icon: 'signal',
      kind: 'echo',
      where: t({ en: 'Somewhere around the lake', nl: 'Ergens rond het meer' }),
      when: t({ en: 'After the Signal has been found', nl: 'Na de ontdekking van het signaal' }),
      canStart: false,
      duration: 240,
      quest: 'echo',
      rewards: { xp: 200, resources: { energy: 25 } },
      desc: t({
        en: 'Sometimes the beacon sends out an echo that bounces back somewhere else in the world. Whoever finds it in time hears a fragment of an ancient message.',
        nl: 'Soms zendt het baken een echo uit die ergens anders in de wereld weerkaatst. Wie hem op tijd vindt, hoort een fragment van een oude boodschap.',
      }),
      start(ev) {
        const spot = pickEchoSpot();
        ev.data.pos = spot;
        ensureFx()?.echo.show(spot);
        try {
          ctx.landmarks?.beacon?.setActive?.(true);
        } catch {
          /* optional */
        }
        quests.start('echo', { restart: true, track: true, silent: true });
        refs.chat?.system?.(t({ en: 'The beacon is sending out an echo… follow the pillar of light!', nl: 'Het baken zendt een echo uit… volg de lichtzuil!' }));
      },
      sub(ev) {
        return t({ en: 'Follow the pillar of light · {time}', nl: 'Volg de lichtzuil · {time}' }, { time: fmtClock(ev.duration - ev.t) });
      },
      end(ev, reason) {
        fx?.echo.hide();
        if (reason === 'success') {
          const n = Math.min(5, (state.get('systems.echoes') || 0) + 1);
          state.set('systems.echoes', n);
          rewards.unlockLore(`echo${n}`);
        }
      },
    },
  };

  // ================================================================== banner
  const eq = ui.h('div', { class: 'sys-event-eq', title: 'Live audio' }, ...Array.from({ length: 6 }, () => ui.h('i')));
  const icon = ui.h('span', { class: 'sys-event-icon' });
  const title = ui.h('div', { class: 'sys-event-title' });
  const sub = ui.h('div', { class: 'sys-event-sub' });
  const banner = ui.h('div', { class: 'sys-event' }, ui.h('div', { class: 'sys-event-box' }, eq, icon, title), sub);
  ui.addWidget('top-center', banner, { modes: ['explore', 'drive'], order: 20 });
  ui.setVisible(banner, false);
  eq.addEventListener('click', () => eq.classList.toggle('muted'));
  let bannerId = null;
  let lastSub = '';

  function refreshBanner() {
    const id = BANNER_PRIORITY.find((x) => active.has(x)) || null;
    if (id !== bannerId) {
      bannerId = id;
      if (!id) {
        banner.classList.remove('show');
        setTimeout(() => !bannerId && ui.setVisible(banner, false), 500);
        return;
      }
      const def = DEFS[id];
      banner.dataset.kind = def.kind;
      title.textContent = def.banner;
      icon.innerHTML = ui.icon(def.icon, 20);
      eq.hidden = def.kind !== 'starfall';
      icon.hidden = def.kind === 'starfall';
      ui.setVisible(banner, true);
      banner.classList.remove('show');
      requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('show')));
    }
    if (id) {
      const ev = active.get(id);
      const s = DEFS[id].sub?.(ev) || '';
      if (s !== lastSub) sub.textContent = lastSub = s;
    }
  }

  // ================================================================== lifecycle
  const timers = [];
  function later(seconds, fn) {
    timers.push({ at: ctx.loop.time + seconds, fn });
  }

  function start(id, opts = {}) {
    const def = DEFS[id];
    if (!def || active.has(id)) return false;
    if (!scene && id !== 'starfall') return false;
    // the quest the player followed before the event took over the tracker (restored at the end)
    const ev = { id, def, t: 0, duration: opts.duration || def.duration, data: {}, opts, prevTracked: quests.activeId, startedAt: Date.now() };
    active.set(id, ev);
    try {
      def.start?.(ev, opts);
    } catch (err) {
      console.error(`[events] start "${id}" failed`, err);
    }
    const pos = id === 'starfall' ? stage() : ev.data.pos || null;
    events.emit('event:start', { id, name: def.name, position: pos });
    ctx.audio.play('quest.update');
    refreshBanner();
    return true;
  }

  function stop(id, reason = 'stopped') {
    const ev = active.get(id);
    if (!ev) return false;
    active.delete(id);
    try {
      ev.def.end?.(ev, reason);
    } catch (err) {
      console.error(`[events] end "${id}" failed`, err);
    }
    if (ev.def.quest && quests.isActive(ev.def.quest)) quests.abandon(ev.def.quest);
    // give the tracker back to what the player followed before the event (if still running),
    // unless a quest that began during the event is being followed now
    const now = quests.activeId;
    const newer = now && now !== ev.def.quest && (quests.get(now)?.started || 0) > ev.startedAt;
    if (ev.prevTracked && ev.prevTracked !== ev.def.quest && ev.prevTracked !== now && quests.isActive(ev.prevTracked) && !newer) quests.track(ev.prevTracked);
    events.emit('event:end', { id, reason });
    refreshBanner();
    return true;
  }

  // echo quest completion ends the echo event successfully
  events.on('quest:complete', ({ id }) => {
    if (id === 'echo' && active.has('echo')) stop('echo', 'success');
  });

  // ================================================================== meteors
  const _tp = new THREE.Vector3();
  function launchImpactNearPlayer() {
    const f = ensureFx();
    const p = playerPos(ctx);
    if (!f || !p) return;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 45 + Math.random() * 110;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (ctx.world?.isWater?.(x, z)) continue;
      const y = groundY(ctx, x, z);
      if (y < 0.5) continue;
      f.streaks.launchImpact(_tp.set(x, y, z), 2.4);
      return;
    }
  }

  const sites = new Map(); // site.id → {site, interaction, marker}
  function impact(pos) {
    const f = ensureFx();
    if (!f) return;
    const site = f.frags.add(pos, (x, z) => groundY(ctx, x, z));
    ctx.audio.play('explosion', { position: pos, volume: 0.9, maxDistance: 600 });
    const p = playerPos(ctx);
    if (p && p.distanceTo(pos) < 220) ctx.cameraRig?.shake?.(0.25 * (1 - p.distanceTo(pos) / 220));
    if (!site) return;
    const ipos = site.pos.clone().setY(site.pos.y + 0.6);
    const iid = `sys-frag-${site.id}`;
    ctx.interactions.add({
      id: iid,
      scope: 'world',
      position: ipos,
      radius: 4.2,
      label: t({ en: 'Harvest meteorite fragment', nl: 'Meteorietfragment oogsten' }),
      hold: 1.2,
      priority: 2,
      onInteract: () => harvest(site.id),
    });
    const mid = `sys-frag-${site.id}`;
    ctx.markers?.set(mid, { position: ipos.clone().setY(ipos.y + 2), label: t({ en: 'Meteorite fragment', nl: 'Meteorietfragment' }), kind: 'poi', icon: 'sys-meteor', color: '#ffb36b', scope: 'world', screen: true, compass: true });
    sites.set(site.id, { site, iid, mid });
  }

  function harvest(siteId) {
    const s = sites.get(siteId);
    if (!s) return;
    const metal = 12 + Math.floor(Math.random() * 13);
    const energy = 6 + Math.floor(Math.random() * 9);
    state.gain({ metal, energy });
    state.add('stats.harvested', 1);
    ctx.audio.play('harvest');
    ui.toast({ title: t({ en: 'Meteorite fragment', nl: 'Meteorietfragment' }), text: `+${metal} ${resourceWord('metal')} · +${energy} ${resourceWord('energy')}`, icon: 'sys-meteor', kind: 'reward', duration: 2400 });
    events.emit('harvest', { resource: 'metal', amount: metal, source: 'meteor', extra: { energy } });
    removeSite(siteId);
  }

  function removeSite(siteId) {
    const s = sites.get(siteId);
    if (!s) return;
    fx?.frags.remove(s.site);
    ctx.interactions.remove(s.iid);
    ctx.markers?.remove(s.mid);
    sites.delete(siteId);
  }

  function clearFragments() {
    for (const id of [...sites.keys()]) removeSite(id);
  }

  /** Nearest fragment (for the meteor quest marker). */
  const _near = new THREE.Vector3();
  function nearestFragment() {
    const p = playerPos(ctx);
    let best = null;
    let bd = Infinity;
    for (const { site } of sites.values()) {
      const d = p ? p.distanceTo(site.pos) : 0;
      if (d < bd) {
        bd = d;
        best = site;
      }
    }
    return best ? _near.copy(best.pos).setY(best.pos.y + 2) : null;
  }

  // ================================================================== echo spots
  function pickEchoSpot() {
    const p = playerPos(ctx) || new THREE.Vector3(ZONES.spawn.x, 0, ZONES.spawn.z);
    const cands = [
      ...ISLANDS.map((i) => ({ x: i.x, z: i.z })),
      ...WATERFALLS.map((w) => ({ x: w.lip.x + 14, z: w.lip.z + 18 })),
      { x: ZONES.lookout.x + 26, z: ZONES.lookout.z + 18 },
      { x: ZONES.ruins.x + 40, z: ZONES.ruins.z - 30 },
      { x: ZONES.base.landingPad.x + 30, z: ZONES.base.landingPad.z - 30 },
      { x: ZONES.plaza.x - 90, z: ZONES.plaza.z + 60 },
      { x: ZONES.spawn.x + 70, z: ZONES.spawn.z - 60 },
      { x: ZONES.signal.x - 60, z: ZONES.signal.z + 70 },
    ].filter((c) => {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      return d > 110 && d < 700 && !ctx.world?.isWater?.(c.x, c.z);
    });
    const c = cands.length ? cands[Math.floor(Math.random() * cands.length)] : { x: p.x + 120, z: p.z - 80 };
    return new THREE.Vector3(c.x, groundY(ctx, c.x, c.z), c.z);
  }
  const echoPoint = () => active.get('echo')?.data.pos || null;

  // ================================================================== schedule
  let wasNight = isNight(ctx);
  let festivalHeldTonight = false;
  let meteorAt = -1;
  let echoAt = 300 + Math.random() * 240;
  let schedAcc = 0;

  function schedule(dt) {
    const night = isNight(ctx);
    const inWorld = ctx.modes.is('explore', 'drive');
    if (night && !wasNight) {
      // a new night begins: maybe a meteor shower within the next minutes
      festivalHeldTonight = false;
      meteorAt = Math.random() < 0.6 ? 40 + Math.random() * 140 : -1;
    }
    if (!night) {
      festivalHeldTonight = false;
      // a festival that started by itself at night ends when the morning comes
      const fest = active.get('starfall');
      if (fest?.opts.from === 'night' && wasNight) stop('starfall', 'morning');
    }
    wasNight = night;
    if (!inWorld) return;
    const h = hourOf(ctx);
    if (night && !festivalHeldTonight && !active.has('starfall') && (h >= 20 || h < 2.5)) {
      festivalHeldTonight = true;
      start('starfall', { from: 'night' });
    }
    if (meteorAt >= 0) {
      meteorAt -= dt;
      if (meteorAt < 0 && night) start('meteors', { from: 'night' });
    }
    if (rewards.flag('signalFound') && !active.has('echo')) {
      echoAt -= dt;
      if (echoAt <= 0) {
        echoAt = 420 + Math.random() * 300;
        start('echo', { from: 'schedule' });
      }
    }
  }

  // ================================================================== update
  ctx.loop.add(
    'sys-events',
    (dt, time) => {
      for (let i = timers.length - 1; i >= 0; i--) {
        if (timers[i].at <= ctx.loop.time) {
          const job = timers.splice(i, 1)[0];
          try {
            job.fn();
          } catch (err) {
            console.warn('[events] timer failed', err);
          }
        }
      }
      // (Map iteration tolerates stop() deleting the current entry)
      for (const ev of active.values()) {
        ev.t += dt;
        try {
          ev.def.update?.(ev, dt);
        } catch (err) {
          console.warn(`[events] update "${ev.id}" failed`, err);
        }
        if (ev.t >= ev.duration) stop(ev.id, 'timeout');
      }
      schedAcc += dt;
      if (schedAcc >= 0.5) {
        schedule(schedAcc);
        schedAcc = 0;
        if (bannerId) refreshBanner();
      }
      if (fx && ctx.modes.is('explore', 'drive', 'title')) {
        fx.streaks.update(dt, ctx.engine.camera);
        fx.frags.update(dt, time);
        fx.echo.update(dt, time);
        fx.sparkles.update(dt, time);
      }
    },
    { order: 36 },
  );

  ctx.events.on('state:reset', () => {
    for (const id of [...active.keys()]) stop(id, 'reset');
    clearFragments();
  });

  return {
    start,
    stop,
    isActive: (id) => active.has(id),
    get active() {
      return [...active.keys()];
    },
    get(id) {
      const ev = active.get(id);
      return ev ? { id, name: ev.def.name, t: ev.t, duration: ev.duration } : null;
    },
    /** All event types with status (journal "Evenementen" tab). */
    list() {
      return Object.values(DEFS).map((d) => ({
        id: d.id,
        name: d.name,
        icon: d.icon,
        where: d.where,
        when: d.when,
        desc: d.desc,
        rewards: d.rewards,
        canStart: d.canStart,
        active: active.has(d.id),
      }));
    },
    echoPoint,
    nearestFragment,
    /** Debug/test helper: spawn a meteor impact at (x, z). */
    impactAt(x, z) {
      ensureFx()?.streaks.launchImpact(new THREE.Vector3(x, groundY(ctx, x, z), z), 1.2);
    },
    fmt,
  };
}
