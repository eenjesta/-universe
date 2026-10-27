/**
 * Data-driven quest engine.
 *
 * Quest definition (see quests/data.js):
 *   { id, title, type: 'main'|'side'|'event'|'space', scope: 'world'|'space',
 *     summary, giver, sequential, repeatable, autoTrack, titleOnly (compact tracker shows only the title),
 *     requires: [questIds], triggers: [{event, filter} | {zone, when} | {check}],
 *     objectives: [...], rewards: {xp, credits, resources, items, lore}, next: [ids],
 *     onStart(api), onComplete(api) }
 *
 * Objective: { id, text, count = 1, optional,
 *     type: 'reach' + (zone | point) + radius [+ dwell s, when(ctx), maxAlt]
 *     type: 'interact' + target                                [E] on interaction `target` / named NPC `target`
 *     on: [{event, filter(payload, ctx), amount(payload)}]   event-based
 *     check(ctx, api, dt) → bool                               custom predicate
 *     flag: 'name'                                             completes when state.flags[name]
 *     marker / npc / zone / point / markerLabel / scope         quest marker }
 *
 * Persistence: state.quests = { active: trackedId, entries: { id: {status, progress, dwell, started, completed, runs} } }
 * Emits quest:start, quest:progress, quest:complete; one ctx.markers entry ('sys-quest')
 * for the current objective of the displayed quest.
 */
import * as THREE from 'three';
import { ZONES } from '../../world/layout.js';
import { t } from '../../core/i18n.js';
import { playerPos, groundY, zoneRadius, rewardText } from '../shared/util.js';

const MARKER_ID = 'sys-quest';
const TYPE_RANK = { event: 0, main: 1, space: 2, side: 3 };

export function createQuestEngine(ctx, { sys, notify, rewards, defs }) {
  const { state, events } = ctx;
  state.ensure('quests', { active: null, entries: {} });
  if (!state.get('quests.entries')) state.set('quests.entries', {});

  const byId = new Map();
  for (const d of defs) {
    d.objectives.forEach((o) => {
      o.on = o.on || (o.event ? [{ event: o.event, filter: o.filter }] : []);
      // interaction objective: pressing E on an interaction point ('interact' {id}) or a named NPC
      if (o.type === 'interact' && o.target) {
        // (sys-talk-<id> = systems' own talk point for story NPCs without a character model)
        o.on.push({ event: 'interact', filter: (p) => p?.id === o.target || p?.id === `sys-talk-${o.target}` });
        o.on.push({ event: 'npc:interact', filter: (p) => p?.id === o.target });
        if (!o.npc && !o.point && !o.marker) o.npc = o.target;
      }
      o.count = o.count || 1;
    });
    byId.set(d.id, d);
  }

  // ------------------------------------------------------------ helpers
  const entries = () => state.get('quests.entries') || {};
  const entry = (id) => entries()[id] || null;
  let version = 0; // bumped on every change → cached views stay valid in between
  const save = () => {
    version++;
    state.set('quests.entries', entries());
  };
  const safe = (fn, fallback = false) => {
    try {
      return fn();
    } catch (err) {
      console.warn('[quests] predicate failed', err);
      return fallback;
    }
  };
  const flags = () => state.get('flags') || {};

  const prog = (e, o) => Math.min(o.count, e?.progress?.[o.id] || 0);
  const objDone = (e, o) => prog(e, o) >= o.count;
  const required = (def) => def.objectives.filter((o) => !o.optional);
  const currentObj = (def, e) => def.objectives.find((o) => !o.optional && !objDone(e, o)) || null;

  function canProgress(def, e, o) {
    if (!e || e.status !== 'active' || objDone(e, o)) return false;
    if (def.sequential && !o.optional) return currentObj(def, e) === o;
    return true;
  }

  function reqsMet(def) {
    return (def.requires || []).every((q) => entry(q)?.status === 'done');
  }

  function objText(o, e) {
    const base = typeof o.text === 'function' ? safe(() => o.text(ctx), '') : o.text;
    return o.count > 1 ? `${base} (${prog(e, o)}/${o.count})` : base;
  }

  // ------------------------------------------------------------ markers
  const markerVecs = new Map(); // objective → reusable Vector3
  function objectivePosition(o) {
    let v = markerVecs.get(o);
    if (!v) markerVecs.set(o, (v = new THREE.Vector3()));
    let p = null;
    if (o.marker) p = safe(() => o.marker(ctx), null);
    if (!p && o.npc) p = ctx.npcs?.get?.(o.npc)?.position || null;
    if (p && p.isVector3) return v.set(p.x, p.y + (o.npc && !o.marker ? 2.1 : 0), p.z);
    const pt = p || (o.point ? (typeof o.point === 'function' ? safe(() => o.point(ctx), null) : o.point) : null);
    if (pt) return v.set(pt.x, pt.y ?? groundY(ctx, pt.x, pt.z) + 2, pt.z);
    if (o.zone && ZONES[o.zone]) {
      const z = ZONES[o.zone];
      return v.set(z.x, groundY(ctx, z.x, z.z) + 2, z.z);
    }
    return null;
  }

  function markerLabel(def, o) {
    return o.markerLabel || (o.zone && ZONES[o.zone]?.label) || def.title;
  }

  // ------------------------------------------------------------ tracking
  const activeIds = () =>
    Object.entries(entries())
      .filter(([id, e]) => e.status === 'active' && byId.has(id))
      .sort((a, b) => (b[1].started || 0) - (a[1].started || 0))
      .map(([id]) => id);

  function trackedId() {
    const id = state.get('quests.active');
    return id && entry(id)?.status === 'active' ? id : null;
  }

  /** Quest shown in the tracker: the tracked one, unless it belongs to the other scope (space vs planet). */
  function displayId() {
    const inSpace = ctx.modes?.is('space');
    const t = trackedId();
    const isSpace = (id) => (byId.get(id)?.scope || 'world') === 'space';
    if (t && isSpace(t) === !!inSpace) return t;
    const alt = activeIds().find((id) => isSpace(id) === !!inSpace);
    return alt || t || activeIds()[0] || null;
  }

  function bestNext(exclude) {
    const ids = activeIds().filter((id) => id !== exclude);
    ids.sort((a, b) => (TYPE_RANK[byId.get(a).type] ?? 9) - (TYPE_RANK[byId.get(b).type] ?? 9));
    return ids[0] || null;
  }

  function track(id) {
    if (id && entry(id)?.status !== 'active') return false;
    state.set('quests.active', id || null);
    sys.emit('quests:changed', { id, reason: 'track' });
    refreshMarker(true);
    return true;
  }

  // ------------------------------------------------------------ lifecycle
  function start(id, opts = {}) {
    const def = byId.get(id);
    if (!def) {
      console.warn(`[quests] unknown quest "${id}"`);
      return false;
    }
    const prev = entry(id);
    if (prev?.status === 'active') {
      if (opts.track) track(id);
      return false;
    }
    if (prev && !(opts.restart && def.repeatable)) return false;
    const all = entries();
    all[id] = { status: 'active', progress: {}, dwell: {}, started: Date.now(), completed: 0, runs: prev?.runs || 0 };
    save();
    events.emit('quest:start', { id });
    // a tracked live event (festival, meteor shower …) keeps the tracker unless asked explicitly
    const tracked = byId.get(trackedId());
    const keepEvent = tracked?.type === 'event' && def.type !== 'event';
    const wantTrack = opts.track ?? (!keepEvent && (def.autoTrack !== false || !trackedId()));
    if (wantTrack) state.set('quests.active', id);
    if (!opts.silent) {
      const first = currentObj(def, all[id]);
      notify.show({
        kind: 'quest',
        icon: 'sys-diamond',
        title: t({ en: 'New mission: {title}', nl: 'Nieuwe missie: {title}' }, { title: def.title }),
        sub: first ? objText(first, all[id]) : '',
        sound: 'quest.update',
        duration: 3600,
      });
    }
    safe(() => def.onStart?.(api));
    sys.emit('quests:changed', { id, reason: 'start' });
    evaluate(0, id); // flags that are already set, players already inside a zone …
    refreshMarker(true);
    return true;
  }

  /** Advances objective `objId` of quest `id` by `amount` (or sets it complete with amount = Infinity). */
  function advance(id, objId, amount = 1) {
    const def = byId.get(id);
    const e = entry(id);
    const o = def?.objectives.find((x) => x.id === objId);
    if (!def || !e || !o || !canProgress(def, e, o)) return false;
    const before = prog(e, o);
    const after = Math.min(o.count, before + Math.max(0, amount));
    if (after === before) return false;
    e.progress[o.id] = after;
    save();
    const done = after >= o.count;
    events.emit('quest:progress', { id, objective: o.id, done, count: after, total: o.count });
    sys.emit('quests:changed', { id, objective: o.id, reason: done ? 'objective' : 'count' });
    if (done) {
      ctx.audio.play('quest.update');
      safe(() => o.onDone?.(api));
    }
    if (required(def).every((x) => objDone(e, x))) complete(id);
    else refreshMarker(true);
    return true;
  }

  function complete(id) {
    const def = byId.get(id);
    const e = entry(id);
    if (!def || !e || e.status === 'done') return false;
    for (const o of def.objectives) if (!o.optional) e.progress[o.id] = o.count;
    e.status = 'done';
    e.completed = Date.now();
    e.runs = (e.runs || 0) + 1;
    save();
    const r = def.rewards || {};
    rewards.grant({ ...r, reason: `quest:${id}` });
    events.emit('quest:complete', { id, rewards: r });
    notify.show({
      kind: 'complete',
      icon: 'sys-diamond-check',
      title: t({ en: 'Mission complete: {title}', nl: 'Missie voltooid: {title}' }, { title: def.title }),
      sub: rewardText(r),
      sound: 'quest.complete',
      duration: 4400,
    });
    if (state.get('quests.active') === id) state.set('quests.active', bestNext(id));
    sys.emit('quests:changed', { id, reason: 'complete' });
    safe(() => def.onComplete?.(api));
    // Chain follow-up quests after the completion banner had a moment.
    for (const nextId of def.next || []) {
      setTimeout(() => {
        const nd = byId.get(nextId);
        if (nd && !entry(nextId) && reqsMet(nd)) start(nextId, { track: true });
      }, 2600);
    }
    refreshMarker(true);
    return true;
  }

  /** Drops a quest (failed / event ended); it can be started again later. */
  function abandon(id, { silent = true } = {}) {
    const all = entries();
    if (!all[id] || all[id].status !== 'active') return false;
    const runs = all[id].runs || 0;
    if (byId.get(id)?.repeatable && runs) all[id] = { status: 'done', progress: {}, dwell: {}, started: 0, completed: Date.now(), runs };
    else delete all[id];
    save();
    if (state.get('quests.active') === id) state.set('quests.active', bestNext(id));
    if (!silent) notify.show({ kind: 'fail', icon: 'sys-diamond', title: t({ en: 'Mission expired: {title}', nl: 'Missie verlopen: {title}' }, { title: byId.get(id)?.title || id }), sound: 'ui.error' });
    sys.emit('quests:changed', { id, reason: 'abandon' });
    refreshMarker(true);
    return true;
  }

  // ------------------------------------------------------------ events → objectives
  function onEvent(name, payload, onlyId = null) {
    for (const [id, e] of Object.entries(entries())) {
      if (e.status !== 'active' || (onlyId && id !== onlyId)) continue;
      const def = byId.get(id);
      if (!def) continue;
      for (const o of def.objectives) {
        for (const h of o.on) {
          if (h.event !== name || !canProgress(def, e, o)) continue;
          if (h.filter && !safe(() => h.filter(payload, ctx, api))) continue;
          const amount = h.amount ? safe(() => h.amount(payload), 1) : 1;
          advance(id, o.id, amount);
        }
      }
    }
  }

  const evNames = new Set();
  for (const d of defs) for (const o of d.objectives) for (const h of o.on) evNames.add(h.event);
  for (const name of evNames) events.on(name, (p) => onEvent(name, p));

  // ------------------------------------------------------------ triggers (auto start)
  function tryTrigger(def, t, payload) {
    if (entry(def.id) || !reqsMet(def)) return;
    if (t.when && !safe(() => t.when(ctx, api))) return;
    if (start(def.id, { track: t.track })) {
      if (t.event) onEvent(t.event, payload, def.id); // the triggering event counts too
    }
  }
  for (const d of defs) {
    for (const t of d.triggers || []) {
      if (t.event) events.on(t.event, (p) => (!t.filter || safe(() => t.filter(p, ctx, api))) && tryTrigger(d, t, p));
    }
  }
  sys.on('zone', ({ zone }) => {
    for (const d of defs) for (const t of d.triggers || []) if (t.zone && t.zone === zone) tryTrigger(d, t);
  });

  // ------------------------------------------------------------ per-frame evaluation
  const _p = new THREE.Vector3();
  let acc = 0;
  let trigAcc = 0;

  /** Checks reach / custom / flag objectives (every 0.2 s, or immediately for one quest). */
  function evaluate(dt, onlyId = null) {
    const p = playerPos(ctx, _p);
    const fl = flags();
    for (const [id, e] of Object.entries(entries())) {
      if (e.status !== 'active' || (onlyId && id !== onlyId)) continue;
      const def = byId.get(id);
      if (!def) continue;
      for (const o of def.objectives) {
        if (!canProgress(def, e, o)) continue;
        if (o.flag && fl[o.flag]) {
          advance(id, o.id, Infinity);
          continue;
        }
        if (o.check && safe(() => o.check(ctx, api, dt))) {
          advance(id, o.id, Infinity);
          continue;
        }
        if (o.type === 'reach' && p) {
          const t = objectivePosition(o);
          if (!t) continue;
          const r = o.radius || zoneRadius(ZONES[o.zone]) || 20;
          let inside = Math.hypot(p.x - t.x, p.z - t.z) <= r;
          if (inside && o.when) inside = safe(() => o.when(ctx, api));
          if (inside && o.maxAlt != null) inside = p.y - groundY(ctx, p.x, p.z) <= o.maxAlt;
          if (!inside) continue;
          if (o.dwell) {
            e.dwell = e.dwell || {};
            e.dwell[o.id] = (e.dwell[o.id] || 0) + dt;
            version++;
            if (e.dwell[o.id] >= o.dwell) advance(id, o.id, Infinity);
            else sys.emit('quests:dwell', { id, objective: o.id, t: e.dwell[o.id] / o.dwell });
          } else advance(id, o.id, Infinity);
        }
      }
    }
  }

  function tick(dt) {
    acc += dt;
    trigAcc += dt;
    if (acc >= 0.2) {
      evaluate(acc);
      acc = 0;
      refreshMarker(false);
    }
    if (trigAcc >= 1) {
      trigAcc = 0;
      for (const d of defs) for (const t of d.triggers || []) if (t.check && !entry(d.id) && reqsMet(d) && safe(() => t.check(ctx, api))) start(d.id, { track: t.track });
    }
  }
  ctx.loop.add('sys-quests', tick, { order: 46 });

  let markerKey = null;
  function markerObjective(def, e) {
    const cands = def.objectives.filter((o) => canProgress(def, e, o) && !o.optional);
    return cands.find((o) => o.marker || o.npc || o.zone || o.point) || null;
  }
  /** Keeps the single quest marker on the current objective of the displayed quest. */
  function refreshMarker(force) {
    const id = displayId();
    const def = id && byId.get(id);
    const e = def && entry(id);
    const o = def && e?.status === 'active' ? markerObjective(def, e) : null;
    const key = o ? `${id}:${o.id}` : '';
    if (!force && key === markerKey) return;
    markerKey = key;
    if (!o) {
      ctx.markers?.remove(MARKER_ID);
      return;
    }
    ctx.markers?.set(MARKER_ID, {
      position: () => objectivePosition(o),
      label: markerLabel(def, o),
      kind: 'quest',
      color: '#7fe0ff',
      icon: 'sys-diamond',
      scope: o.scope || def.scope || 'world',
      screen: true,
      compass: true,
      tracked: true, // shell: the compass strip shows this marker's distance
    });
  }

  // ------------------------------------------------------------ views
  const viewCache = new Map(); // id → {v, tracked, view}
  function view(id) {
    const def = byId.get(id);
    if (!def) return null;
    const tracked = state.get('quests.active');
    const c = viewCache.get(id);
    if (c && c.v === version && c.tracked === tracked && c.entry === entry(id)) return c.view;
    const v = buildView(id, def);
    viewCache.set(id, { v: version, tracked, entry: entry(id), view: v });
    return v;
  }
  function buildView(id, def) {
    const e = entry(id);
    const cur = e?.status === 'active' ? currentObj(def, e) : null;
    return {
      id,
      title: def.title,
      type: def.type,
      scope: def.scope || 'world',
      giver: def.giver || null,
      summary: def.summary || '',
      status: e ? e.status : 'available',
      started: e?.started || 0,
      completed: e?.completed || 0,
      rewards: def.rewards || {},
      repeatable: !!def.repeatable,
      titleOnly: !!def.titleOnly,
      objectives: def.objectives.map((o) => ({
        id: o.id,
        text: objText(o, e),
        count: o.count,
        progress: prog(e, o),
        done: e ? objDone(e, o) : false,
        current: o === cur,
        optional: !!o.optional,
        dwell: o.dwell ? Math.min(1, (e?.dwell?.[o.id] || 0) / o.dwell) : null,
      })),
      toString() {
        return id;
      },
    };
  }

  /** World position of the displayed quest's current objective (for distance read-outs). */
  function currentTarget() {
    const id = displayId();
    const def = id && byId.get(id);
    const e = def && entry(id);
    const o = def && e?.status === 'active' ? markerObjective(def, e) : null;
    if (!o || (o.scope || def.scope) === 'space') return null;
    const pos = objectivePosition(o);
    return pos ? { quest: id, objective: o.id, position: pos } : null;
  }

  const api = {
    defs: byId,
    /** View of the quest shown in the tracker (toString() → id), or null. */
    get active() {
      const id = displayId();
      return id ? view(id) : null;
    },
    get activeId() {
      return trackedId();
    },
    start,
    complete,
    abandon,
    track,
    advance,
    get: (q) => view(typeof q === 'object' && q ? q.id : q),
    /** All quests that were started (active + done), newest first; `all` includes available ones. */
    list({ all = false } = {}) {
      const ids = all ? [...byId.keys()] : Object.keys(entries()).filter((id) => byId.has(id));
      return ids.map(view).sort((a, b) => (b.started || 0) - (a.started || 0));
    },
    has: (id) => !!entry(id),
    isActive: (id) => entry(id)?.status === 'active',
    isDone: (id) => entry(id)?.status === 'done',
    objectiveDone: (id, objId) => {
      const def = byId.get(id);
      const o = def?.objectives.find((x) => x.id === objId);
      return !!o && objDone(entry(id), o);
    },
    displayId,
    currentTarget,
    refreshMarker,
    /** Re-applies marker state after a save reset. */
    reset() {
      version++;
      viewCache.clear();
      markerKey = null;
      refreshMarker(true);
      sys.emit('quests:changed', { reason: 'reset' });
    },
  };
  return api;
}
