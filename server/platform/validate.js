/**
 * Validation + sanitising for platform input: account fields, free text,
 * thumbnails and the experience format (PLATFORM.md §10):
 *
 *   { format: 'o-universe-experience', v: 1,
 *     meta: { title, description, maxPlayers }, settings: { time, sky, gravity, baseplate },
 *     parts: [{ id, type, name, p, r, s, color, material, anchored, collide, transparency, group, props }],
 *     groups: [{ id, name, parent }], logic: [] }
 *
 * Rules: wrong types / unknown enum values / dangling references → 400
 * `invalid_experience` with `details: { path, problem }`; numbers must be
 * finite and are clamped to sane ranges; strings are NFC-normalised, stripped
 * of control/invisible/bidi characters, capped and run through the text filter
 * (masked, `filtered: true` in the result). Unknown keys survive (sanitised,
 * bounded) so newer Studio builds don't lose data. Limits: 5000 parts, 2 MB JSON.
 *
 * Performance: error paths are built lazily, short repeated strings are filtered
 * once per document, and `validateExperienceAsync` yields to the event loop every
 * few hundred parts (the platform shares its process with the game server).
 */
import { fail } from './errors.js';
import { filterText, checkUsername } from './filter.js';

export const EXP_FORMAT = 'o-universe-experience';
export const EXP_VERSION = 1;
export const LIMITS = {
  MAX_PARTS: 5000,
  MAX_BYTES: 2 * 1024 * 1024,
  MAX_GROUPS: 2000,
  MAX_LOGIC: 1000,
  TITLE_MAX: 50,
  DESC_MAX: 1000,
  NAME_MAX: 50,
  TEXT_MAX: 500,
  COORD_MAX: 100000,
  SIZE_MIN: 0.01,
  SIZE_MAX: 4096,
  THUMB_MAX: 200_000, // data-URL characters (~150 kB image)
  MAX_PLAYERS: 50,
  EXTRA_KEYS: 16,
};
export const PART_TYPES = ['block', 'wedge', 'cylinder', 'sphere', 'cone', 'spawn', 'light', 'text'];
export const MATERIALS = ['plastic', 'metal', 'glass', 'neon', 'wood', 'concrete', 'grass', 'ice'];
export const SKIES = ['golden', 'day', 'night', 'space'];

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,39}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// eslint-disable-next-line no-control-regex
const CONTROL_ML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufff9-\ufffb]/g;
const LINE_SEP = /[\u2028\u2029\r]/g;

/** Printable ASCII without leading/trailing/double spaces: already clean. */
function simpleAscii(s) {
  const n = s.length;
  if (!n) return false;
  let prevSpace = true;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c > 126) return false;
    if (c === 32) {
      if (prevSpace) return false;
      prevSpace = true;
    } else prevSpace = false;
  }
  return !prevSpace;
}

/**
 * Clean a free-text string: NFC, no control/invisible/bidi chars, collapsed
 * whitespace (newlines kept with `multiline`, max 2 blank lines), trimmed,
 * capped at `max` code points. Non-strings → ''.
 */
export function cleanString(raw, max, { multiline = false } = {}) {
  if (typeof raw !== 'string') return '';
  if (raw.length <= max && simpleAscii(raw)) return raw;
  let s = raw.normalize('NFC').replace(LINE_SEP, '\n').replace(CONTROL_ML, '');
  if (multiline) {
    s = s
      .replace(/\t/g, ' ')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  } else s = s.replace(/\s+/g, ' ');
  s = s.trim();
  if (s.length > max) {
    const cps = Array.from(s);
    if (cps.length > max) s = cps.slice(0, max).join('').trim();
  }
  return s;
}

// ------------------------------------------------------------------ accounts

/** Lower-cased username or throws (bad_username / name_filtered). */
export function parseUsername(raw) {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const problem = checkUsername(name);
  if (problem === 'format') throw fail('bad_username', { field: 'username' });
  if (problem) throw fail('name_filtered', { field: 'username' });
  return name;
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890', '87654321', 'qwertyui',
  'qwerty123', 'qwertyuiop', 'iloveyou', 'abcdefgh', 'abcd1234', '11111111', '00000000', 'wachtwoord', 'wachtwoord1',
  'welkom01', 'welkom123', 'letmein1', 'football', 'minecraft', 'roblox123', 'fortnite', 'ouniverse', 'universe',
]);

/** Password check: 8–128 chars, not trivial, not the username. */
export function parsePassword(raw, username) {
  if (typeof raw !== 'string') throw fail('weak_password', { field: 'password' });
  const pw = raw.normalize('NFC');
  const n = Array.from(pw).length;
  if (n < 8 || n > 128) throw fail('weak_password', { field: 'password' });
  const low = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(low) || /^(.)\1+$/.test(pw) || (username && low.includes(username))) {
    throw fail('weak_password', { field: 'password' });
  }
  return pw;
}

/** Birth year → integer or throws. Plausible range: 120 years back … this year. */
export function parseBirthYear(raw, nowMs = Date.now()) {
  const year = new Date(nowMs).getUTCFullYear();
  const y = typeof raw === 'string' && /^\d{4}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (!Number.isInteger(y) || y < year - 120 || y > year) throw fail('bad_birth_year', { field: 'birthYear' });
  return y;
}

/**
 * Age group from a birth year, conservatively: anyone who *could* still be 12
 * (this year − birthYear ≤ 13) counts as under 13. Re-evaluated on every read,
 * so restrictions lift automatically in the year a player is sure to be 13+.
 */
export function ageGroup(birthYear, nowMs = Date.now()) {
  const year = new Date(nowMs).getUTCFullYear();
  return year - birthYear <= 13 ? 'under13' : '13plus';
}

// ------------------------------------------------------------------ thumbnails

const THUMB_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const THUMB_ERR = { field: 'thumbnail', message: 'Thumbnails must be a small JPEG, PNG or WebP data URL.', nl: 'Miniaturen moeten een kleine JPEG-, PNG- of WebP-data-URL zijn.' };

/**
 * A small JPEG/PNG/WebP data URL (≤ LIMITS.THUMB_MAX chars) → `{ mime, dataUrl }`;
 * null/'' → null (remove). Throws `invalid` for anything else.
 */
export function parseThumbnail(raw) {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > LIMITS.THUMB_MAX) throw fail('invalid', THUMB_ERR);
  const m = THUMB_RE.exec(raw);
  const buf = m ? Buffer.from(m[2].slice(0, 24), 'base64') : null;
  const ok =
    buf &&
    ((m[1] === 'jpeg' && buf[0] === 0xff && buf[1] === 0xd8) ||
      (m[1] === 'png' && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
      (m[1] === 'webp' && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP'));
  if (!ok) throw fail('invalid', THUMB_ERR);
  return { mime: `image/${m[1]}`, dataUrl: raw };
}

// ------------------------------------------------------------------ experiences

/** Join a path lazily (only on errors): at('parts[3]', 'p') → 'parts[3].p'. */
const at = (base, key) => (key === null || key === undefined ? base : base ? `${base}.${key}` : String(key));
const NONE = {};
const PII_ON = { pii: true };
const PII_OFF = { pii: false };

class Ctx {
  constructor(filter) {
    this.filter = filter;
    this.filtered = false;
    this.memo = new Map(); // repeated short strings (part names…) are filtered once per document
    this.memoPii = new Map();
  }
  bad(path, problem) {
    return fail('invalid_experience', {
      message: `Experience data is not valid at ${path || '(root)'}: ${problem}.`,
      nl: `De gegevens van de ervaring zijn ongeldig bij ${path || '(root)'}: ${problem}.`,
      details: { path: path || '', problem },
    });
  }
  text(raw, base, key, max, opts = NONE) {
    if (raw === undefined || raw === null) return opts.def ?? '';
    if (typeof raw !== 'string') throw this.bad(at(base, key), 'expected a string');
    let s = cleanString(raw, max, opts);
    if (this.filter && s) {
      const memo = opts.pii ? this.memoPii : this.memo;
      const short = s.length <= 120;
      let f = short ? memo.get(s) : undefined;
      if (f === undefined) {
        f = filterText(s, opts.pii ? PII_ON : PII_OFF);
        if (short && memo.size < 20000) memo.set(s, f);
      }
      if (f !== s) {
        this.filtered = true;
        s = f;
      }
    }
    return s || (opts.def ?? '');
  }
  num(raw, base, key, min, max, def) {
    if (raw === undefined || raw === null) {
      if (def === undefined) throw this.bad(at(base, key), 'expected a number');
      return def;
    }
    if (typeof raw !== 'number') throw this.bad(at(base, key), 'expected a number');
    if (!Number.isFinite(raw)) throw this.bad(at(base, key), 'number is not finite');
    return raw < min ? min : raw > max ? max : raw;
  }
  int(raw, base, key, min, max, def) {
    return Math.round(this.num(raw, base, key, min, max, def));
  }
  bool(raw, base, key, def) {
    if (raw === undefined || raw === null) return def;
    if (typeof raw !== 'boolean') throw this.bad(at(base, key), 'expected true or false');
    return raw;
  }
  oneOf(raw, base, key, list, def) {
    if (raw === undefined || raw === null) {
      if (def === undefined) throw this.bad(at(base, key), `required (one of ${list.join(', ')})`);
      return def;
    }
    if (typeof raw !== 'string' || !list.includes(raw)) throw this.bad(at(base, key), `must be one of ${list.join(', ')}`);
    return raw;
  }
  color(raw, base, key, def) {
    if (raw === undefined || raw === null) return def;
    if (typeof raw !== 'string' || !COLOR_RE.test(raw)) throw this.bad(at(base, key), 'expected a colour like #a1b2c3');
    const c = raw.toLowerCase();
    return c.length === 7 ? c : '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  vec3(raw, base, key, min, max, def) {
    if (raw === undefined || raw === null) return def.slice();
    if (!Array.isArray(raw) || raw.length !== 3) throw this.bad(at(base, key), 'expected [x, y, z]');
    const x = raw[0];
    const y = raw[1];
    const z = raw[2];
    if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x < min ? min : x > max ? max : x, y < min ? min : y > max ? max : y, z < min ? min : z > max ? max : z];
    }
    const p = at(base, key);
    for (let i = 0; i < 3; i++) this.num(raw[i], `${p}[${i}]`, null, min, max); // throws with the element path
    throw this.bad(p, 'expected [x, y, z]');
  }
  id(raw, base, key) {
    if (typeof raw !== 'string' || !ID_RE.test(raw)) throw this.bad(at(base, key), 'expected an id (1–40 of A–Z a–z 0–9 _ -)');
    return raw;
  }
  /** Generic JSON value (unknown keys, props, logic): bounded depth/size, finite numbers, filtered strings. */
  any(raw, base, key, depth, budget) {
    if (budget.n-- <= 0) throw this.bad(at(base, key), 'too many nested values');
    if (raw === null || typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) throw this.bad(at(base, key), 'number is not finite');
      return raw;
    }
    if (typeof raw === 'string') return this.text(raw, base, key, budget.str, { multiline: true });
    if (depth <= 0) throw this.bad(at(base, key), 'nested too deeply');
    const path = at(base, key);
    if (Array.isArray(raw)) {
      if (raw.length > budget.arr) throw this.bad(path, `at most ${budget.arr} items`);
      const out = new Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = this.any(raw[i], `${path}[${i}]`, null, depth - 1, budget);
      return out;
    }
    if (typeof raw === 'object') {
      const out = {};
      let n = 0;
      for (const k in raw) {
        if (++n > budget.keys) throw this.bad(path, `at most ${budget.keys} keys`);
        if (FORBIDDEN_KEYS.has(k) || !KEY_RE.test(k)) throw this.bad(at(path, k), 'key not allowed');
        out[k] = this.any(raw[k], path, k, depth - 1, budget);
      }
      return out;
    }
    throw this.bad(path, 'unsupported value');
  }
  /** Copy unknown keys of `src` (not in `known`) into `out`, generically sanitised. */
  extras(src, out, known, base, budget) {
    let n = 0;
    for (const k in src) {
      if (known.has(k)) continue;
      if (FORBIDDEN_KEYS.has(k) || !KEY_RE.test(k)) throw this.bad(at(base, k), 'key not allowed');
      if (++n > LIMITS.EXTRA_KEYS) throw this.bad(base, `at most ${LIMITS.EXTRA_KEYS} extra keys`);
      out[k] = this.any(src[k], base, k, 4, budget);
    }
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const META_KEYS = new Set(['title', 'description', 'maxPlayers']);
const SETTINGS_KEYS = new Set(['time', 'sky', 'gravity', 'baseplate']);
const BASEPLATE_KEYS = new Set(['size', 'color', 'material']);
const PART_KEYS = new Set(['id', 'type', 'name', 'p', 'r', 's', 'color', 'material', 'anchored', 'collide', 'transparency', 'group', 'props']);
const GROUP_KEYS = new Set(['id', 'name', 'parent']);
const TOP_KEYS = new Set(['format', 'v', 'meta', 'settings', 'parts', 'groups', 'logic']);
const ZERO3 = [0, 0, 0];
const SIZE3 = [4, 1, 2];
const TEXT_ML_PII = { multiline: true, pii: true };
const TEXT_PII = { pii: true };
const NAME_PART = { def: 'Part' };
const NAME_MODEL = { def: 'Model' };

/** Default (empty) experience: a baseplate and one spawn. */
export function defaultExperience(title = 'Untitled experience') {
  return {
    format: EXP_FORMAT,
    v: EXP_VERSION,
    meta: { title, description: '', maxPlayers: 20 },
    settings: { time: 17.6, sky: 'golden', gravity: 1, baseplate: { size: 512, color: '#3a3f47', material: 'concrete' } },
    parts: [{ id: 'spawn1', type: 'spawn', name: 'Spawn', p: [0, 0.5, 0], r: [0, 0, 0], s: [6, 1, 6], color: '#44e0ff', material: 'neon', anchored: true, collide: true, transparency: 0, group: null, props: {} }],
    groups: [],
    logic: [],
  };
}

/**
 * Validate + sanitise an experience document (synchronous).
 * @param {any} input parsed JSON
 * @param {{ filter?: boolean }} [opts]
 * @returns {{ data: object, partCount: number, size: number, filtered: boolean }}
 */
export function validateExperience(input, { filter = true } = {}) {
  const gen = run(input, filter);
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

/**
 * Same as validateExperience, but yields to the event loop every few hundred
 * parts so a 5000-part document never stalls the game server sharing the process.
 */
export async function validateExperienceAsync(input, { filter = true } = {}) {
  const gen = run(input, filter);
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const YIELD_PARTS = 500;
const YIELD_LOGIC = 100;

function* run(input, filter) {
  const c = new Ctx(filter);
  if (!isObj(input)) throw c.bad('', 'expected an object');
  if (input.format !== undefined && input.format !== EXP_FORMAT) throw c.bad('format', `must be "${EXP_FORMAT}"`);
  if (input.v !== undefined && input.v !== EXP_VERSION) {
    if (typeof input.v === 'number' && input.v > EXP_VERSION) throw fail('unsupported_version', { details: { path: 'v', problem: `version ${input.v} > ${EXP_VERSION}` } });
    throw c.bad('v', `must be ${EXP_VERSION}`);
  }
  const budget = { n: 200_000, str: 2000, arr: 256, keys: 64 };
  const data = { format: EXP_FORMAT, v: EXP_VERSION };

  // meta
  const meta = input.meta ?? {};
  if (!isObj(meta)) throw c.bad('meta', 'expected an object');
  data.meta = {
    title: c.text(meta.title, 'meta', 'title', LIMITS.TITLE_MAX, TEXT_PII),
    description: c.text(meta.description, 'meta', 'description', LIMITS.DESC_MAX, TEXT_ML_PII),
    maxPlayers: c.int(meta.maxPlayers, 'meta', 'maxPlayers', 1, LIMITS.MAX_PLAYERS, 20),
  };
  c.extras(meta, data.meta, META_KEYS, 'meta', budget);

  // settings
  const st = input.settings ?? {};
  if (!isObj(st)) throw c.bad('settings', 'expected an object');
  let baseplate = null;
  if (st.baseplate !== null) {
    const bp = st.baseplate ?? {};
    if (!isObj(bp)) throw c.bad('settings.baseplate', 'expected an object or null');
    baseplate = {
      size: c.num(bp.size, 'settings.baseplate', 'size', 0, LIMITS.SIZE_MAX, 512),
      color: c.color(bp.color, 'settings.baseplate', 'color', '#3a3f47'),
      material: c.oneOf(bp.material, 'settings.baseplate', 'material', MATERIALS, 'concrete'),
    };
    c.extras(bp, baseplate, BASEPLATE_KEYS, 'settings.baseplate', budget);
  }
  data.settings = {
    time: c.num(st.time, 'settings', 'time', 0, 24, 17.6),
    sky: c.oneOf(st.sky, 'settings', 'sky', SKIES, 'golden'),
    gravity: c.num(st.gravity, 'settings', 'gravity', 0, 5, 1),
    baseplate,
  };
  c.extras(st, data.settings, SETTINGS_KEYS, 'settings', budget);

  // groups (validated before parts so part.group can be checked)
  const groupsIn = input.groups ?? [];
  if (!Array.isArray(groupsIn)) throw c.bad('groups', 'expected an array');
  if (groupsIn.length > LIMITS.MAX_GROUPS) throw c.bad('groups', `at most ${LIMITS.MAX_GROUPS} groups`);
  const groupIds = new Map();
  data.groups = new Array(groupsIn.length);
  for (let i = 0; i < groupsIn.length; i++) {
    const g = groupsIn[i];
    const path = `groups[${i}]`;
    if (!isObj(g)) throw c.bad(path, 'expected an object');
    const id = c.id(g.id, path, 'id');
    if (groupIds.has(id)) throw c.bad(`${path}.id`, `duplicate group id "${id}"`);
    const out = { id, name: c.text(g.name, path, 'name', LIMITS.NAME_MAX, NAME_MODEL), parent: g.parent ?? null };
    if (out.parent !== null && (typeof out.parent !== 'string' || !ID_RE.test(out.parent))) throw c.bad(`${path}.parent`, 'expected a group id or null');
    c.extras(g, out, GROUP_KEYS, path, budget);
    groupIds.set(id, out);
    data.groups[i] = out;
  }
  for (let i = 0; i < data.groups.length; i++) {
    const g = data.groups[i];
    if (g.parent === null) continue;
    if (!groupIds.has(g.parent)) throw c.bad(`groups[${i}].parent`, `unknown group "${g.parent}"`);
    // cycle check: walk up at most groups.length steps
    let cur = g;
    for (let steps = 0; cur && cur.parent !== null; steps++) {
      if (steps > data.groups.length || cur.parent === g.id) throw c.bad(`groups[${i}].parent`, 'groups form a cycle');
      cur = groupIds.get(cur.parent);
    }
  }

  // parts
  const partsIn = input.parts ?? [];
  if (!Array.isArray(partsIn)) throw c.bad('parts', 'expected an array');
  if (partsIn.length > LIMITS.MAX_PARTS) throw c.bad('parts', `at most ${LIMITS.MAX_PARTS} parts (got ${partsIn.length})`);
  const partIds = new Set();
  const C = LIMITS.COORD_MAX;
  data.parts = new Array(partsIn.length);
  for (let i = 0; i < partsIn.length; i++) {
    if (i && i % YIELD_PARTS === 0) yield;
    const q = partsIn[i];
    const path = `parts[${i}]`;
    if (!isObj(q)) throw c.bad(path, 'expected an object');
    const id = c.id(q.id, path, 'id');
    if (partIds.has(id)) throw c.bad(`${path}.id`, `duplicate part id "${id}"`);
    partIds.add(id);
    const type = c.oneOf(q.type, path, 'type', PART_TYPES);
    const group = q.group ?? null;
    if (group !== null && (typeof group !== 'string' || !groupIds.has(group))) throw c.bad(`${path}.group`, `unknown group "${String(group)}"`);
    let props = {};
    const pin = q.props;
    if (pin !== undefined && pin !== null) {
      if (!isObj(pin)) throw c.bad(`${path}.props`, 'expected an object');
      let empty = true;
      for (const _ in pin) {
        empty = false;
        break;
      }
      if (!empty) {
        props = c.any(pin, path, 'props', 5, budget);
        if (type === 'text' && typeof pin.text === 'string') props.text = c.text(pin.text, `${path}.props`, 'text', LIMITS.TEXT_MAX, TEXT_ML_PII);
      }
    }
    const part = {
      id,
      type,
      name: c.text(q.name, path, 'name', LIMITS.NAME_MAX, NAME_PART),
      p: c.vec3(q.p, path, 'p', -C, C, ZERO3),
      r: c.vec3(q.r, path, 'r', -1e4, 1e4, ZERO3),
      s: c.vec3(q.s, path, 's', LIMITS.SIZE_MIN, LIMITS.SIZE_MAX, SIZE3),
      color: c.color(q.color, path, 'color', '#ffffff'),
      material: c.oneOf(q.material, path, 'material', MATERIALS, 'plastic'),
      anchored: c.bool(q.anchored, path, 'anchored', true),
      collide: c.bool(q.collide, path, 'collide', true),
      transparency: c.num(q.transparency, path, 'transparency', 0, 1, 0),
      group,
      props,
    };
    c.extras(q, part, PART_KEYS, path, budget);
    data.parts[i] = part;
  }

  // logic (creator logic comes later: kept as bounded, filtered JSON)
  const logicIn = input.logic ?? [];
  if (!Array.isArray(logicIn)) throw c.bad('logic', 'expected an array');
  if (logicIn.length > LIMITS.MAX_LOGIC) throw c.bad('logic', `at most ${LIMITS.MAX_LOGIC} entries`);
  data.logic = new Array(logicIn.length);
  for (let i = 0; i < logicIn.length; i++) {
    if (i && i % YIELD_LOGIC === 0) yield;
    data.logic[i] = c.any(logicIn[i], `logic[${i}]`, null, 8, budget);
  }

  c.extras(input, data, TOP_KEYS, '', budget);
  yield;

  const size = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (size > LIMITS.MAX_BYTES) throw fail('too_large', { message: `Experience data is ${(size / 1048576).toFixed(2)} MB; the limit is 2 MB.`, nl: `De ervaring is ${(size / 1048576).toFixed(2)} MB; de limiet is 2 MB.`, details: { size, limit: LIMITS.MAX_BYTES } });
  return { data, partCount: data.parts.length, size, filtered: c.filtered };
}

/** Sanitise a title / description given outside the experience JSON. */
export function cleanMetaText(raw, kind) {
  const max = kind === 'title' ? LIMITS.TITLE_MAX : LIMITS.DESC_MAX;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw fail('invalid', { field: kind });
  const s = cleanString(raw ?? '', max, { multiline: kind !== 'title' });
  const f = filterText(s, { pii: true });
  return { text: f, filtered: f !== s };
}
