/**
 * SMP ↔ server bridge: subscribes to the server messages the survival layer
 * needs (through ctx.net.on, raw protocol messages) and implements the build
 * module's online authority (ctx.build.setAuthority):
 *
 *   place(rec)   → C.BUILD_PLACE {piece, p, rot, level, variant, cid}; resolves on
 *                  S.STRUCT {cid, ok, add} or S.DENY {of:'build:place', cid, reason}
 *   remove(id)   → C.BUILD_REMOVE {id}; resolves on S.STRUCT {remove:[id]} / S.DENY
 *   harvest(id)  → C.HARVEST {node}  (S.HARVESTED → ctx.build.applyHarvest)
 *   check(tg)    → client-side prediction: hub safe zone / no-build buffer / highways (smp.world),
 *                  someone else's claim, claim overlap, one claim / spawn beacon per player
 *   canEnter()   → null, or why build mode can't open here (inside the hub safe zone)
 *   canRemove()  → only your own pieces
 * Every structure change from the server goes to ctx.build.applyRemote.
 */
import { C, S, r2 } from '../../shared/protocol.js';
import { REASONS } from '../../shared/defs/reasons.js';
import { PIECE as SPIECE } from '../../shared/defs/pieces.js';
import { t } from '../core/i18n.js';
import { foreignClaimAt, claimOverlap } from './logic.js';

export const TXT = {
  claimedBy: { en: 'Claimed by {name}', nl: 'Geclaimd door {name}' },
  claimedSomeone: { en: 'This land is claimed', nl: 'Dit land is geclaimd' },
  overlap: { en: 'Overlaps the claim of {name}', nl: 'Overlapt de claim van {name}' },
  gap: { en: 'Too close to the claim of {name} (keep 30 m apart)', nl: 'Te dicht bij de claim van {name} (houd 30 m afstand)' },
  claimLimit: { en: 'You already have a claim beacon', nl: 'Je hebt al een claimbaken' },
  spawnLimit: { en: 'You already have a spawn beacon — remove it first', nl: 'Je hebt al een spawnbaken — verwijder die eerst' },
  claimSafe: { en: 'Too close to a safe zone', nl: 'Te dicht bij een veilige zone' },
  notYours: { en: 'Not yours — built by {name}', nl: 'Niet van jou — gebouwd door {name}' },
  notYoursAnon: { en: 'Not your structure', nl: 'Niet jouw bouwwerk' },
  connecting: { en: 'Connecting to the server…', nl: 'Verbinden met de server…' },
  // claim decay (§11.2) + moderation
  backTitle: { en: 'Welcome back', nl: 'Welkom terug' },
  restored: { en: 'Your base had started to decay — it is protected again now that you are back.', nl: 'Je basis begon te vervallen — nu je terug bent, is hij weer beschermd.' },
  goneTitle: { en: 'Your base is gone', nl: 'Je basis is verdwenen' },
  gone: { en: 'You were away for more than 30 days: your base decayed and {n} structures were removed.', nl: 'Je was langer dan 30 dagen weg: je basis is vervallen en {n} bouwwerken zijn verwijderd.' },
  lostTitle: { en: 'Structures removed', nl: 'Bouwwerken verwijderd' },
  lostAdmin: { en: 'A moderator removed {n} of your structures.', nl: 'Een moderator heeft {n} van je bouwwerken verwijderd.' },
  lostDecay: { en: '{n} of your structures decayed.', nl: '{n} van je bouwwerken zijn vervallen.' },
};

/** Player-facing text for a server reason code (+ message context). */
export function reasonText(code, m = {}) {
  if (code === 'claim') return m.name ? t(TXT.claimedBy, { name: m.name }) : t(TXT.claimedSomeone);
  if (code === 'claimOverlap' && m.name) return t(TXT.overlap, { name: m.name });
  if (code === 'claimGap' && m.name) return t(TXT.gap, { name: m.name });
  if (code === 'limit' && (m.piece === 'claim-beacon' || m.piece === 'spawn-beacon')) return t(m.piece === 'claim-beacon' ? TXT.claimLimit : TXT.spawnLimit);
  if (code === 'offline') return t(TXT.connecting);
  return t(REASONS[code] || REASONS.invalid);
}

/** welcome.notices entry ({kind: 'claim-restored' | 'claim-removed', n?}) → {title, text, kind} | null. */
export function noticeText(n) {
  if (n?.kind === 'claim-restored') return { title: t(TXT.backTitle), text: t(TXT.restored), kind: 'success' };
  if (n?.kind === 'claim-removed') return { title: t(TXT.goneTitle), text: t(TXT.gone, { n: Math.max(1, n.n | 0) }), kind: 'warn' };
  return null;
}

/** S.STRUCT {remove, by: null, reason: 'decay' | 'admin'} that took n of my structures → {title, text} | null. */
export function lostText(reason, n) {
  if (!(n > 0) || (reason !== 'decay' && reason !== 'admin')) return null;
  return { title: t(TXT.lostTitle), text: t(reason === 'admin' ? TXT.lostAdmin : TXT.lostDecay, { n }) };
}

/** Reason text for build placement / claims: world rules (safe zone, buffer, highways) first. */
export function buildReasonText(world, code, m = {}) {
  return world?.text?.(code, m) || reasonText(code, m);
}

export function createBridge(ctx, smp) {
  const { events } = ctx;
  const placing = new Map(); // cid → resolve
  const removingP = new Map(); // structure id → resolve
  const offs = [];
  const connected = () => {
    const m = ctx.net?.mode;
    return m === 'online' || m === 'local';
  };
  const me = () => ctx.net?.id ?? null;

  function on(type, fn) {
    const wrapped = (m) => {
      try {
        fn(m || {});
      } catch (err) {
        console.error(`[smp] handler for "${type}" failed`, err);
      }
    };
    if (typeof ctx.net?.on === 'function') offs.push(ctx.net.on(type, wrapped));
    else offs.push(events.on(`net:${type}`, wrapped));
  }

  function send(msg) {
    if (!connected() || typeof ctx.net?.send !== 'function') return false;
    try {
      ctx.net.send(msg);
      return true;
    } catch (err) {
      console.warn('[smp] send failed', err);
      return false;
    }
  }

  // ------------------------------------------------------------ build authority
  const myCount = (type) => {
    let n = 0;
    const id = me();
    const recs = ctx.build?.registry?.records;
    if (recs && id != null) for (const r of recs.values()) if (r.type === type && r.owner === id) n++;
    return n;
  };

  const authority = {
    get me() {
      return me();
    },
    place(rec) {
      if (!connected()) return Promise.resolve({ ok: false, reason: 'offline', text: reasonText('offline') });
      return new Promise((resolve) => {
        placing.set(rec.cid, Object.assign(resolve, { at: [rec.x, rec.z] }));
        const ok = send({ t: C.BUILD_PLACE, piece: rec.piece || rec.type, p: [r2(rec.x), r2(rec.y), r2(rec.z)], rot: rec.rot | 0, level: rec.level | 0, variant: rec.variant, cid: rec.cid });
        if (!ok) {
          placing.delete(rec.cid);
          resolve({ ok: false, reason: 'offline', text: reasonText('offline') });
        }
      });
    },
    remove(id) {
      if (!connected()) return Promise.resolve({ ok: false, reason: 'offline', text: reasonText('offline') });
      return new Promise((resolve) => {
        removingP.set(id, resolve);
        if (!send({ t: C.BUILD_REMOVE, id })) {
          removingP.delete(id);
          resolve({ ok: false, reason: 'offline', text: reasonText('offline') });
        }
      });
    },
    harvest(nodeId) {
      return send({ t: C.HARVEST, node: nodeId });
    },
    /** Prediction only — the server has the final word. */
    check(tg, def) {
      if (!connected()) return t(TXT.connecting);
      const rule = smp.world?.buildable?.(tg.x, tg.z);
      if (rule) return buildReasonText(smp.world, rule.reason, rule);
      const claims = smp.claims.list;
      const id = me();
      const pad = def.radius || 0.5;
      const c = foreignClaimAt(claims, id, tg.x, tg.z, pad);
      if (c) return c.name ? t(TXT.claimedBy, { name: c.name }) : t(TXT.claimedSomeone);
      const smpRole = def.smp || SPIECE[def.id]?.smp;
      if (smpRole?.claim) {
        const o = claimOverlap(claims, id, tg.x, tg.z, smpRole.claim);
        if (o) return o.name ? t(TXT.gap, { name: o.name }) : t(REASONS.claimGap || REASONS.claimOverlap);
      }
      const limit = SPIECE[def.id]?.limit;
      if (limit && myCount(def.id) >= limit) return t(def.id === 'claim-beacon' ? TXT.claimLimit : def.id === 'spawn-beacon' ? TXT.spawnLimit : REASONS.limit);
      return null;
    },
    canEnter() {
      if (!connected()) return null;
      const p = ctx.player?.position;
      if (!p || !smp.world?.isSafe?.(p.x, p.z)) return null;
      return buildReasonText(smp.world, 'safe');
    },
    canRemove(rec) {
      const id = me();
      if (!rec.owner || rec.owner === id) return null;
      return rec.ownerName ? t(TXT.notYours, { name: rec.ownerName }) : t(TXT.notYoursAnon);
    },
  };

  // ------------------------------------------------------------ server messages
  on(S.WELCOME, (m) => smp.onWelcome(m));
  on(S.INV, (m) => smp.onInv(m));
  on(S.STATS, (m) => smp.onStats(m));

  on(S.STRUCT, (m) => {
    if (m.cid && placing.has(m.cid)) {
      const resolve = placing.get(m.cid);
      placing.delete(m.cid);
      if (m.ok === false) resolve({ ok: false, reason: m.reason, text: buildReasonText(smp.world, m.reason, withClaimName(m, resolve.at)) });
      else resolve({ ok: true, record: Array.isArray(m.add) ? m.add[0] || null : null });
    }
    for (const id of m.remove || []) {
      const r = removingP.get(id);
      if (r) {
        removingP.delete(id);
        r({ ok: true });
      }
    }
    // a decayed base / moderation (by: null): tell the owner before the records disappear
    if (m.by === null && Array.isArray(m.remove) && (m.reason === 'decay' || m.reason === 'admin')) {
      const recs = ctx.build?.registry?.records;
      const id = me();
      let n = 0;
      if (recs && id != null) for (const rid of m.remove) if (recs.get(rid)?.owner === id) n++;
      if (n) smp.onLost?.(m.reason, n);
    }
    ctx.build?.applyRemote?.({ add: m.add, remove: m.remove });
    smp.onStructures(m);
  });

  /** S.STRUCT/S.DENY 'claim' / 'claimOverlap' carry no name: look the claim up locally. */
  function withClaimName(m, at) {
    if (m.name || !at || (m.reason !== 'claim' && m.reason !== 'claimOverlap' && m.reason !== 'claimGap')) return m;
    const c = m.reason === 'claim' ? foreignClaimAt(smp.claims.list, me(), at[0], at[1], 0.5) : claimOverlap(smp.claims.list, me(), at[0], at[1]);
    return c?.name ? { ...m, name: c.name } : m;
  }

  on(S.DENY, (m) => {
    const text = reasonText(m.reason, m);
    if (m.of === C.BUILD_PLACE) {
      let cid = m.cid && placing.has(m.cid) ? m.cid : null;
      if (cid == null && !m.cid && placing.size) cid = placing.keys().next().value; // oldest request
      const r = cid != null ? placing.get(cid) : null;
      if (r) {
        placing.delete(cid);
        r({ ok: false, reason: m.reason, text: buildReasonText(smp.world, m.reason, withClaimName(m, r.at)) });
      }
      return;
    }
    if (m.of === C.BUILD_REMOVE) {
      const id = m.id ?? [...removingP.keys()][0];
      const r = removingP.get(id);
      if (r) {
        removingP.delete(id);
        r({ ok: false, reason: m.reason, text });
      }
      return;
    }
    smp.onDeny(m, text);
  });

  on(S.CLAIMS, (m) => smp.claims.apply(m));
  on(S.HARVESTED, (m) => {
    const st = typeof ctx.net?.serverTime === 'function' ? ctx.net.serverTime() : Date.now();
    const respawnIn = Number.isFinite(m.respawnAt) ? (m.respawnAt - st) / 1000 : 180;
    ctx.build?.applyHarvest?.({ node: m.node, res: m.res, respawnIn, mine: m.by != null && m.by === me() });
  });
  on(S.CRAFTED, (m) => smp.onCrafted(m));
  on(S.DEATH, (m) => smp.onDeath(m));
  on(S.RESPAWNED, (m) => smp.onRespawned(m));
  on(S.LOOT, (m) => smp.loot?.onMessage?.(m));

  /** Rejects everything in flight (disconnect). */
  function flush(reason = 'offline') {
    for (const r of placing.values()) r({ ok: false, reason, text: reasonText(reason) });
    placing.clear();
    for (const r of removingP.values()) r({ ok: false, reason, text: reasonText(reason) });
    removingP.clear();
  }

  return { authority, send, connected, me, flush, dispose: () => offs.forEach((f) => f?.()) };
}
