/**
 * Bridges between the server and the client game state:
 *
 * STATE  S.INV / S.STATS are the truth → mirrored into ctx.state (`resources`, `credits`,
 *        and the `smp` branch { hp, sh, en, maxHp, maxSh, maxEn, dead, ammo, items, weapons,
 *        slot, mag, unlocks }). Local changes to credits/resources made by the single-player
 *        modules (quest/event rewards, market buy/sell, legacy build/harvest flows) keep
 *        working unchanged — `state.set` (the choke point of add/gain/spend/update) is wrapped
 *        while connected: the change applies locally at once (prediction) and is forwarded as
 *        C.GRANT / C.SPEND with a `cid`; the server's INV `ack` (or DENY `cid`) settles it.
 *        Display = last server value + changes still in flight, so nothing flickers.
 *        Attribution (which message a change becomes) uses what happened in the same
 *        synchronous task: the first relevant event / outgoing action after the change
 *        (systems emit quest:complete, market:buy … right after granting):
 *          market:buy → SPEND market · market:sell → SPEND sell · progress:xp 'quest:<id>' /
 *          quest:complete → GRANT quest (+ reward items) · progress:level → GRANT achievement ·
 *          scan:complete → GRANT scan · other reward events → GRANT event ·
 *          an outgoing BUILD_PLACE / HARVEST / CRAFT / PICKUP …, smp:* / combat:* events,
 *          changes made while handling a server message → local prediction only (the server
 *          already knows) · legacy build:placed / harvest without such a message → SPEND 'build'
 *          / GRANT event (keeps offline single-player identical) · anything else: + → GRANT
 *          event, − → SPEND 'misc'. Modules can opt out explicitly: ctx.net.predict(fn).
 * CHAT   systems `chat:sent` → C.CHAT ('/l text' = local channel) · S.CHAT → ctx.chat.post
 *        (own echo skipped, sys lines → ctx.chat.system). NPC replies stay local.
 * PROFILE customize:done / profile changes → C.PROFILE (debounced, ≥ 2 s apart).
 */
import { NET, C, S } from '../../shared/protocol.js';
import { t } from '../core/i18n.js';
import { TokenBucket } from './ratelimit.js';

export const RES = ['metal', 'stone', 'wood', 'energy'];
const ECO_KEYS = ['credits', ...RES];
export const SMP_DEFAULT = () => ({
  hp: 100,
  sh: 50,
  en: 100,
  maxHp: 100,
  maxSh: 50,
  maxEn: 100,
  dead: false,
  ammo: {},
  items: {},
  weapons: [],
  slot: 0,
  mag: {},
  unlocks: [],
});
const SMP_INV_KEYS = ['ammo', 'items', 'weapons', 'slot', 'mag', 'unlocks'];
const ATTR_EVENTS = new Set([
  'market:buy',
  'market:sell',
  'quest:complete',
  'progress:level',
  'progress:xp',
  'scan:complete',
  'harvest',
  'build:placed',
  'build:removed',
  'dialogue:choice',
  'quest:start',
  'event:start',
  'event:end',
  'lore:unlock',
]);
/** Outgoing messages whose server effect a local change merely predicts. */
const ACTION_SENDS = new Set([C.BUILD_PLACE, C.BUILD_REMOVE, C.HARVEST, C.CRAFT, C.PICKUP, C.USE, C.GRANT, C.SPEND]);
const INFLIGHT_TTL_MS = 15000;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(v) ? v : 0);

function sameJSON(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Appearance → a small flat object the server's HELLO/PROFILE schema accepts (≤ 48 keys, depth ≤ 2). */
export function cleanAppearance(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return undefined;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(a)) {
    if (n >= 48) break;
    if (k.length > 40) continue;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 64);
    else if (Array.isArray(v)) out[k] = v.slice(0, 16).filter((e) => e === null || typeof e === 'boolean' || (typeof e === 'number' && Number.isFinite(e)) || (typeof e === 'string' && e.length <= 64));
    else if (typeof v === 'object') {
      const inner = {};
      let m = 0;
      for (const [k2, v2] of Object.entries(v)) {
        if (m >= 48) break;
        if (k2.length > 40) continue;
        if (v2 === null || typeof v2 === 'boolean' || (typeof v2 === 'number' && Number.isFinite(v2))) inner[k2] = v2;
        else if (typeof v2 === 'string') inner[k2] = v2.slice(0, 64);
        else continue;
        m++;
      }
      out[k] = inner;
    } else continue;
    n++;
  }
  return out;
}

/** Merges an S.INV (full or patch) into the last known inventory. */
export function mergeInv(prev, msg) {
  const out = msg.patch && prev ? { ...prev } : {};
  for (const k of Object.keys(msg)) {
    if (k === 't' || k === 'patch' || k === 'ack') continue;
    const v = msg[k];
    out[k] = msg.patch && isObj(v) && isObj(out[k]) ? { ...out[k], ...v } : isObj(v) ? { ...v } : Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

/**
 * Turns one attributed local change into a message intent.
 * dl = { d: {credits?, metal?…}, dispatch, predict }, item = { kind: 'event'|'send', name, payload, type }
 * Returns null (local prediction only) or { kind: 'grant'|'spend'|'split', … }.
 */
export function classify(dl, item) {
  if (dl.predict) return null;
  if (item?.kind === 'send') return null;
  if (item?.kind === 'event') {
    const p = item.payload || {};
    switch (item.name) {
      case 'market:buy':
        return { kind: 'spend', reason: 'market', id: String(p.item ?? ''), cost: Number.isFinite(p.price) ? { credits: p.price } : null };
      case 'market:sell': {
        const res = String(p.item ?? '').replace(/^res-/, '');
        return { kind: 'spend', reason: 'sell', id: String(p.item ?? ''), cost: RES.includes(res) && Number.isFinite(p.amount) ? { [res]: p.amount } : null };
      }
      case 'quest:complete':
        return { kind: 'grant', source: 'quest', id: String(p.id ?? 'quest'), quest: p.id };
      case 'progress:xp': {
        const m = /^quest:(.+)$/.exec(String(p.reason || ''));
        if (m) return { kind: 'grant', source: 'quest', id: m[1], quest: m[1] };
        return { kind: 'grant', source: 'event', id: `xp-${String(p.reason || 'reward').slice(0, 24)}`, unique: true };
      }
      case 'progress:level':
        return { kind: 'grant', source: 'achievement', id: `level-${p.level ?? '?'}` };
      case 'scan:complete':
        return { kind: 'grant', source: 'scan', id: `${p.target ?? 'scan'}-${p.index ?? p.count ?? 0}`, unique: p.target !== 'rune' && p.target !== 'ruins' };
      case 'harvest':
        if (p.source === 'meteor') return { kind: 'grant', source: 'event', id: 'meteor', unique: true };
        return dl.dispatch ? null : { kind: 'split', reason: 'harvest', id: 'harvest' };
      case 'build:placed':
        return dl.dispatch ? null : { kind: 'split', reason: 'build', id: `place-${p.id ?? ''}` };
      case 'build:removed':
        return dl.dispatch ? null : { kind: 'split', reason: 'build', id: `refund-${p.id ?? ''}` };
      default:
        if (item.name.startsWith('smp:') || item.name.startsWith('combat:') || item.name.startsWith('net:')) return null;
        return { kind: 'grant', source: 'event', id: item.name.replace(/[^a-z0-9-]/gi, '-'), unique: true };
    }
  }
  return dl.dispatch ? null : { kind: 'split', reason: 'misc', id: 'misc' };
}

/** Events that only explain a change when nothing more specific happened around it. */
const WEAK = new Set(['lore:unlock', 'dialogue:choice', 'quest:start', 'event:start', 'event:end']);
export const BARRIER = Object.freeze({ barrier: true });

/**
 * Index of the item a change at position `at` belongs to: the first specific item after it
 * (else the first weak one after it), else the nearest one before it — never across a
 * barrier (a boundary between loop systems: one frame is one synchronous task).
 */
export function attribute(items, at) {
  let weak = -1;
  for (let i = at; i < items.length; i++) {
    const it = items[i];
    if (it.barrier) break;
    if (!it.relevant) continue;
    if (!it.weak) return i;
    if (weak < 0) weak = i;
  }
  if (weak >= 0) return weak;
  for (let i = Math.min(at, items.length) - 1; i >= 0; i--) {
    const it = items[i];
    if (it.barrier) break;
    if (!it.relevant) continue;
    if (!it.weak) return i;
    if (weak < 0) weak = i;
  }
  return weak;
}

export function createBridge(ctx, net) {
  const { state, events } = ctx;
  let inv = null; // last server inventory (merged)
  let stats = null;
  const inflight = new Map(); // cid → { d, at, sent }
  let mirroring = 0;
  let predicting = 0;
  let task = null;
  let seq = 0;
  let lastProfileKey = '';
  let profileTimer = 0;
  let lastProfileAt = -Infinity;
  const chatBucket = new TokenBucket(NET.CHAT_RATE.burst, NET.CHAT_RATE.perSec, performance.now());
  const cid = () => `n${(++seq).toString(36)}`;
  const uid = (base) => `${base}-${Date.now().toString(36)}${(++seq).toString(36)}`.slice(0, 64);

  state.ensure('smp', SMP_DEFAULT());
  {
    const s = state.get('smp');
    for (const [k, v] of Object.entries(SMP_DEFAULT())) if (s[k] === undefined) s[k] = v;
  }

  /** Bridging is active once the session has a welcome (online or local), also while reconnecting. */
  const active = () => net.hasSession();

  // ------------------------------------------------------------ mirror
  function setIf(path, v) {
    const cur = state.get(path);
    if (isObj(v) || Array.isArray(v) ? !sameJSON(cur, v) : cur !== v) state.set(path, isObj(v) ? { ...v } : Array.isArray(v) ? v.slice() : v);
  }

  function mirrorEco() {
    if (!inv) return;
    const want = { credits: num(inv.credits) };
    for (const r of RES) want[r] = num(inv.res?.[r]);
    for (const f of inflight.values()) for (const k of ECO_KEYS) if (f.d[k]) want[k] += f.d[k];
    mirroring++;
    try {
      for (const r of RES) if (inv.res && r in inv.res) setIf(`resources.${r}`, Math.max(0, want[r]));
      if (Number.isFinite(inv.credits)) setIf('credits', Math.max(0, want.credits));
    } finally {
      mirroring--;
    }
  }

  function mirrorSmp() {
    if (!inv) return;
    mirroring++;
    try {
      for (const k of SMP_INV_KEYS) if (k in inv) setIf(`smp.${k}`, inv[k]);
      // server-side market unlocks show up as owned items (add-only: offline items stay)
      if (Array.isArray(inv.unlocks) && inv.unlocks.length) {
        const owned = state.get('owned.items') || [];
        const add = inv.unlocks.filter((u) => !owned.includes(u));
        if (add.length) state.set('owned.items', [...owned, ...add]);
        const skins = add.filter((u) => u.startsWith('skin-'));
        if (skins.length) state.set('owned.skins', [...(state.get('owned.skins') || []), ...skins.filter((s) => !(state.get('owned.skins') || []).includes(s))]);
      }
    } finally {
      mirroring--;
    }
  }

  function onInv(msg) {
    inv = mergeInv(inv, msg);
    if (msg.ack != null) inflight.delete(String(msg.ack));
    mirrorEco();
    mirrorSmp();
  }

  function onStats(msg) {
    stats = { ...(stats || {}), ...msg };
    mirroring++;
    try {
      for (const k of ['hp', 'sh', 'en', 'maxHp', 'maxSh', 'maxEn']) if (Number.isFinite(msg[k])) setIf(`smp.${k}`, msg[k]);
      setIf('smp.dead', !!msg.dead || (Number.isFinite(msg.hp) && msg.hp <= 0));
    } finally {
      mirroring--;
    }
  }

  function onWelcome(msg) {
    // messages sent on an earlier connection are settled by this inventory; queued ones stay in flight
    for (const [k, f] of inflight) if (f.sent) inflight.delete(k);
    inv = null;
    if (msg.inv) onInv({ ...msg.inv, t: S.INV });
    if (msg.stats) onStats({ ...msg.stats, t: S.STATS });
    const p = state.get('profile') || {};
    lastProfileKey = JSON.stringify([p.name, p.appearance]);
  }

  function onDeny(msg) {
    if ((msg.of === C.GRANT || msg.of === C.SPEND) && msg.cid != null && inflight.delete(String(msg.cid))) mirrorEco();
  }

  // drop predictions the server never answered
  const ttlTimer = setInterval(() => {
    const now = performance.now();
    let changed = false;
    for (const [k, f] of inflight) {
      if (now - f.at > INFLIGHT_TTL_MS) {
        inflight.delete(k);
        changed = true;
      }
    }
    if (changed) mirrorEco();
  }, 3000);
  ttlTimer?.unref?.(); // (Node tests)

  // ------------------------------------------------------------ capture local changes
  const ecoPath = (p) => p === 'credits' || p === 'resources' || (typeof p === 'string' && p.startsWith('resources.'));
  function ecoNow(out) {
    out.credits = num(state.data.credits);
    const r = state.data.resources || {};
    for (const k of RES) out[k] = num(r[k]);
    return out;
  }

  function curTask() {
    if (!task) {
      task = { items: [], deltas: [] };
      queueMicrotask(flushTask);
    }
    return task;
  }

  const origSet = state.set;
  state.set = function (path, value) {
    if (mirroring || !ecoPath(path) || !active()) return origSet.call(this, path, value);
    const before = ecoNow({});
    const ret = origSet.call(this, path, value);
    const after = ecoNow({});
    let d = null;
    for (const k of ECO_KEYS) {
      const dv = after[k] - before[k];
      if (dv) (d ||= {})[k] = dv;
    }
    if (d) {
      const tk = curTask();
      tk.deltas.push({ d, at: tk.items.length, dispatch: net.dispatching > 0, predict: predicting > 0 });
    }
    return ret;
  };

  events.on('*', (name, payload) => {
    if (!active()) return;
    if (ATTR_EVENTS.has(name)) curTask().items.push({ kind: 'event', name, payload, relevant: true, weak: WEAK.has(name) });
    // smp:* / combat:* (possibly frequent) only matter right after a change in the same task
    else if (task && (name.startsWith('smp:') || name.startsWith('combat:'))) task.items.push({ kind: 'event', name, payload, relevant: true });
  });

  // boundaries between loop systems (a frame runs every system in one task)
  for (const order of [9.5, 19.5, 25.5, 29.5, 39.5, 44.5, 45.5, 49.5, 59.5, 89.5]) {
    ctx.loop.add(`net-attr-${order}`, () => task && task.items.push(BARRIER), { order, pausable: false });
  }

  function onSent(msg) {
    if (!active() || !ACTION_SENDS.has(msg.t)) return;
    const own = msg.cid != null && inflight.get(String(msg.cid));
    if (own) {
      own.sent = true; // our own forwarded GRANT/SPEND left the client
      return;
    }
    curTask().items.push({ kind: 'send', type: msg.t, relevant: true });
  }

  function flushTask() {
    const tk = task;
    task = null;
    if (!tk || !tk.deltas.length) return;
    const groups = new Map();
    for (const dl of tk.deltas) {
      const idx = attribute(tk.items, dl.at);
      const item = idx >= 0 ? tk.items[idx] : null;
      const intent = classify(dl, item);
      if (!intent) continue;
      const key = `${intent.kind}:${intent.source || intent.reason}:${intent.id}:${intent.unique ? idx : ''}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { intent, d: {} }));
      for (const k of ECO_KEYS) if (dl.d[k]) g.d[k] = (g.d[k] || 0) + dl.d[k];
    }
    // quest reward items ride along with that quest's grant
    for (const it of tk.items) {
      if (it.kind !== 'event' || it.name !== 'quest:complete') continue;
      const items = it.payload?.rewards?.items;
      if (!Array.isArray(items) || !items.length) continue;
      const qid = String(it.payload.id);
      let g = [...groups.values()].find((x) => x.intent.kind === 'grant' && x.intent.source === 'quest' && x.intent.quest === it.payload.id);
      if (!g) groups.set(`grant:quest:${qid}:items`, (g = { intent: { kind: 'grant', source: 'quest', id: qid, quest: it.payload.id }, d: {} }));
      g.items = items.slice(0, 8);
    }
    for (const g of groups.values()) forward(g);
  }

  function questId(base, quest) {
    const runs = quest != null ? Number(state.get(`quests.entries.${quest}.runs`)) : 0;
    return runs > 1 ? `${base}#${runs}` : base;
  }

  function sendTracked(msg, d) {
    msg.cid = cid();
    inflight.set(msg.cid, { d, at: performance.now(), sent: false });
    if (!net.sendRaw(msg)) inflight.delete(msg.cid);
  }

  function forward(g) {
    const { intent, d } = g;
    const pos = {};
    const neg = {};
    for (const k of ECO_KEYS) {
      if (d[k] > 0) pos[k] = d[k];
      else if (d[k] < 0) neg[k] = -d[k];
    }
    const hasPos = Object.keys(pos).length > 0;
    const hasNeg = Object.keys(neg).length > 0;
    if (intent.kind === 'grant') {
      if (!hasPos && !g.items) return;
      const amounts = { ...pos };
      if (g.items) amounts.items = g.items;
      const id = intent.unique ? uid(intent.id) : intent.source === 'quest' ? questId(intent.id, intent.quest) : intent.id;
      const dPos = {};
      for (const k of Object.keys(pos)) dPos[k] = pos[k];
      sendTracked({ t: C.GRANT, source: intent.source, id: id.slice(0, 64), amounts }, dPos);
      return;
    }
    if (intent.kind === 'spend') {
      const msg = { t: C.SPEND, reason: intent.reason, id: intent.id };
      if (intent.cost) msg.cost = intent.cost;
      sendTracked(msg, { ...d });
      return;
    }
    // split: legacy single-player flows the server knows nothing about
    if (hasNeg) sendTracked({ t: C.SPEND, reason: intent.reason, id: uid(intent.id), cost: neg }, Object.fromEntries(Object.entries(neg).map(([k, v]) => [k, -v])));
    if (hasPos) sendTracked({ t: C.GRANT, source: 'event', id: uid(intent.id), amounts: pos }, { ...pos });
  }

  /** Runs fn with credits/resources changes treated as local predictions (never forwarded). */
  function predict(fn) {
    predicting++;
    try {
      return fn();
    } finally {
      predicting--;
    }
  }

  // ------------------------------------------------------------ chat
  const CH_RE = /^\/(l|local|g|global|p|party)\s+([\s\S]+)$/i;
  let chatOffShown = false;
  events.on('chat:sent', ({ text } = {}) => {
    if (!net.hasSession() || !text) return;
    let ch = 'global';
    let body = String(text);
    const m = CH_RE.exec(body);
    if (m) {
      const c = m[1].toLowerCase();
      ch = c[0] === 'l' ? 'local' : c[0] === 'p' ? 'party' : 'global';
      body = m[2];
    }
    body = body.trim().slice(0, NET.CHAT_MAX_LEN);
    if (!body) return;
    if (net.chatOff?.()) {
      if (!chatOffShown) ctx.chat?.system?.(t({ en: 'Chat with other players is turned off for your account.', nl: 'Chatten met andere spelers staat uit voor je account.' }));
      chatOffShown = true;
      return;
    }
    if (net.mode() === 'online' && !chatBucket.take(performance.now())) {
      ctx.chat?.system?.(t({ en: 'Slow down — you are sending messages too fast.', nl: 'Rustig aan — je stuurt te snel berichten.' }));
      return;
    }
    net.sendRaw({ t: C.CHAT, text: body, ch });
  });

  const NAME_COLORS = ['#8fd7ff', '#c7a8ff', '#7ee8c9', '#f3c27f', '#ff9ade', '#9fe8b4', '#ffa25e', '#a9bbff', '#ffb8a0', '#e8e27e'];
  function colorFor(key) {
    let h = 0;
    const s = String(key ?? '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return NAME_COLORS[Math.abs(h) % NAME_COLORS.length];
  }

  /** A remote player's display name, never mistaken for an NPC speaker id. */
  function chatName(name) {
    const n = String(name || t({ en: 'Player', nl: 'Speler' })).slice(0, 24);
    const sp = ctx.chat?.speakers;
    return sp && Object.prototype.hasOwnProperty.call(sp, n) ? `${n} ` : n;
  }

  function onChat(msg) {
    const chat = ctx.chat;
    if (!chat?.post) return;
    if (msg.sys || msg.from == null) {
      const text = typeof msg.text === 'object' ? t(msg.text) : String(msg.text ?? '');
      if (text) chat.system?.(text);
      return;
    }
    if (msg.from === net.id()) return; // our own line is already in the log
    const name = chatName(msg.name || net.players.get(msg.from)?.name);
    const local = msg.ch === 'local';
    chat.post(local ? `${name} · ${t({ en: 'local', nl: 'lokaal' })}` : name, String(msg.text ?? ''), { color: colorFor(msg.from) });
  }

  // ------------------------------------------------------------ profile
  function sendProfile() {
    profileTimer = 0;
    if (!net.hasSession()) return;
    const p = state.get('profile') || {};
    const key = JSON.stringify([p.name, p.appearance]);
    if (key === lastProfileKey) return;
    const wait = 2200 - (performance.now() - lastProfileAt);
    if (wait > 0) {
      profileTimer = setTimeout(sendProfile, wait);
      return;
    }
    lastProfileKey = key;
    lastProfileAt = performance.now();
    net.sendRaw({ t: C.PROFILE, name: typeof p.name === 'string' ? p.name.slice(0, 24) : undefined, appearance: cleanAppearance(p.appearance) });
  }
  function profileSoon(ms = 600) {
    if (profileTimer) clearTimeout(profileTimer);
    profileTimer = setTimeout(sendProfile, ms);
  }
  events.on('customize:done', () => profileSoon(50));
  state.subscribe('profile', () => profileSoon());

  // re-apply the server truth after a local reset
  events.on('state:reset', () => {
    state.ensure('smp', SMP_DEFAULT());
    if (inv) {
      mirrorEco();
      mirrorSmp();
    }
    if (stats) onStats(stats);
  });

  return {
    onInv,
    onStats,
    onWelcome,
    onDeny,
    onChat,
    onSent,
    predict,
    colorFor,
    get inv() {
      return inv;
    },
    get inflight() {
      return inflight.size;
    },
    /** For tests: run the pending attribution now. */
    flush: () => flushTask(),
  };
}
