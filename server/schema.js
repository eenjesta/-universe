import { C, NET } from '../shared/protocol.js';

/**
 * Shape checks for client → server messages (shared/protocol.js C.*).
 * `validate(msg)` → null when the message is acceptable, or a short reason.
 * Known fields are type/range checked; extra fields are allowed (the sim may
 * read additions to the protocol) as long as the frame fits in 16 kB.
 * Message types that are in `C` but have no rule here pass through to the sim;
 * types that are not in `C` at all are rejected.
 */
const LIMIT = 1e6; // |coordinate| cap: the planet is infinite (§11), but 1000 km out is far beyond float-safe play
const KNOWN = new Set(Object.values(C));

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const coord = (v) => num(v) && v > -LIMIT && v < LIMIT;
const vec3 = (v) => Array.isArray(v) && v.length >= 3 && v.length <= 4 && coord(v[0]) && coord(v[1]) && coord(v[2]);
const str = (v, max = 32) => typeof v === 'string' && v.length > 0 && v.length <= max;
const int = (v, a = -(2 ** 31), b = 2 ** 31) => Number.isInteger(v) && v >= a && v <= b;
const opt = (v, test) => v === undefined || v === null || test(v);
const id = (v) => str(v, 32) || int(v, 0);

/** Flat-ish JSON object check: ≤ `keys` entries, numbers finite, strings ≤ 64, depth ≤ 2. */
function smallObject(v, keys = 48, depth = 2) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const ks = Object.keys(v);
  if (ks.length > keys) return false;
  for (const k of ks) {
    if (k.length > 40) return false;
    const x = v[k];
    if (x === null || typeof x === 'boolean') continue;
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) return false;
    } else if (typeof x === 'string') {
      if (x.length > 64) return false;
    } else if (Array.isArray(x)) {
      if (x.length > 16 || !x.every((e) => e === null || typeof e === 'boolean' || (typeof e === 'number' && Number.isFinite(e)) || (typeof e === 'string' && e.length <= 64))) return false;
    } else if (typeof x === 'object') {
      if (depth <= 1 || !smallObject(x, keys, depth - 1)) return false;
    } else return false;
  }
  return true;
}

const RULES = {
  [C.HELLO]: (m) => num(m.v) && opt(m.token, (t) => str(t, 128)) && opt(m.name, (n) => typeof n === 'string' && n.length <= 64) && opt(m.appearance, (a) => smallObject(a)) && opt(m.lang, (l) => str(l, 8)) && opt(m.device, (d) => str(d, 16)) && opt(m.auth, (a) => str(a, 256)),
  [C.STATE]: (m) =>
    vec3(m.p) &&
    opt(m.h, num) &&
    opt(m.v, vec3) &&
    opt(m.a, (a) => str(a, 24) || int(a, 0, 255)) &&
    opt(m.m, (x) => str(x, 16)) &&
    opt(m.veh, (v) => smallObject(v, 16, 1)),
  [C.FIRE]: (m) => str(m.w) && vec3(m.o) && vec3(m.d) && int(m.seq, 0) && opt(m.ct, num) && opt(m.vt, num),
  [C.HIT]: (m) => int(m.seq, 0) && id(m.target) && opt(m.at, vec3),
  [C.THROW]: (m) => str(m.w) && vec3(m.o) && vec3(m.v),
  [C.RELOAD]: (m) => opt(m.w, str),
  [C.EQUIP]: (m) => (m.slot !== undefined && m.slot !== null ? int(m.slot, 0, 9) : str(m.w)),
  [C.RESPAWN]: (m) => opt(m.at, (a) => str(a, 16)),
  // resource nodes { node } or world features — trees / rocks / plants — { feature, tool?, hit? }
  [C.HARVEST]: (m) => (id(m.node) || str(m.feature, 64)) && opt(m.tool, (x) => str(x, 32)) && opt(m.hit, (h) => int(h, 0)),
  [C.CRAFT]: (m) => str(m.recipe, 48) && opt(m.n, (n) => int(n, 1, 999)),
  [C.USE]: (m) => str(m.item, 48),
  [C.PICKUP]: (m) => id(m.loot),
  [C.BUILD_PLACE]: (m) => str(m.piece, 48) && vec3(m.p) && opt(m.rot, num) && opt(m.level, (l) => int(l, -64, 256)) && opt(m.cid, id) && opt(m.variant, (v) => str(v, 32)),
  [C.BUILD_REMOVE]: (m) => id(m.id),
  [C.GRANT]: (m) => str(m.source, 16) && (str(m.id, 64) || int(m.id, 0)) && opt(m.amounts, (a) => smallObject(a, 24, 2)),
  [C.SPEND]: (m) => str(m.reason, 16) && opt(m.id, (x) => str(x, 64) || int(x, 0)) && opt(m.cost, (c) => smallObject(c, 16, 1)),
  [C.CHAT]: (m) => typeof m.text === 'string' && m.text.length <= NET.CHAT_MAX_LEN * 4 && opt(m.ch, (c) => str(c, 12)),
  [C.PROFILE]: (m) => opt(m.name, (n) => typeof n === 'string' && n.length <= 64) && opt(m.appearance, (a) => smallObject(a)),
  [C.PING]: (m) => opt(m.ct, num),
  [C.TRAVEL]: (m) => str(m.to, 16) && opt(m.cid, id),
};

/** null = ok, otherwise a reason string ('type' | 'schema'). */
export function validate(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return 'type';
  if (!KNOWN.has(msg.t)) return 'type';
  const rule = RULES[msg.t];
  if (!rule) return null;
  try {
    return rule(msg) ? null : 'schema';
  } catch {
    return 'schema';
  }
}

/** Appearance from the character creator → a small plain object (≤ 2 kB JSON) or null. */
export function cleanAppearance(a) {
  if (!smallObject(a)) return null;
  const s = JSON.stringify(a);
  return s.length <= 2048 ? JSON.parse(s) : null;
}
