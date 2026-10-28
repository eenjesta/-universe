/**
 * Ø Studio — experience format v1 (PLATFORM.md §10). Pure JS (no DOM, no three.js),
 * so the platform server may import it to validate uploads as well.
 *
 *   { format: 'o-universe-experience', v: 1,
 *     meta: { title, description, maxPlayers },
 *     settings: { time, sky: 'golden'|'day'|'night'|'space', gravity, baseplate: { size, color, material } },
 *     parts: [{ id, type, name, p: [x,y,z], r: [x,y,z], s: [x,y,z], color, material,
 *               anchored, collide, transparency, group, props }],
 *     groups: [{ id, name, parent }],
 *     logic: [] }
 *
 * Units: metres. `p` = centre, `s` = full size, `r` = rotation in DEGREES, Euler order 'YXZ'
 * (yaw, pitch, roll — like Roblox Orientation). Shapes (unit geometry scaled by `s`):
 *   block · wedge (ramp: low edge at −Z/front, high edge at +Z/back) · cylinder (axis Y) ·
 *   sphere (ellipsoid) · cone (axis Y, apex up) · spawn (pad; checkpoints) · light (glowing bulb
 *   + point light) · text (sign; text on the −Z/front face).
 * props (all optional, unknown keys are dropped):
 *   behavior 'none'|'kill'|'finish'|'bounce', bounce (jump-pad speed m/s, 4–60),
 *   text, textColor (text), brightness 0–10, range 2–60 (light), checkpoint (spawn, default true).
 *
 * validate(input) → { ok, errors: string[], warnings: string[], exp } — `exp` is a normalised,
 * size-checked copy (never the input object); `ok` is false when the input can't be used.
 */

export const FORMAT = 'o-universe-experience';
export const VERSION = 1;

export const LIMITS = {
  parts: 5000,
  groups: 1000,
  bytes: 2 * 1024 * 1024,
  coord: 4096,
  minSize: 0.05,
  maxSize: 1024,
  title: 50,
  description: 1000,
  name: 40,
  text: 120,
  logic: 500,
  maxPlayers: 50,
  baseplate: 2048,
};

export const PART_TYPES = ['block', 'wedge', 'cylinder', 'sphere', 'cone', 'spawn', 'light', 'text'];
export const MATERIALS = ['plastic', 'metal', 'glass', 'neon', 'wood', 'concrete', 'grass', 'ice'];
export const SKIES = ['golden', 'day', 'night', 'space'];
export const BEHAVIORS = ['none', 'kill', 'finish', 'bounce'];

/** Curated palette (Ø Universe tones + bright obby colours). */
export const PALETTE = [
  '#f4f1ea', '#d9d2c4', '#a9a49b', '#6f7279', '#3a3f47', '#23262c', '#121418',
  '#ff6b5e', '#d8433a', '#ff9a4a', '#f0b46a', '#ffd86b', '#b88a5c', '#6a4a32',
  '#7fe0ff', '#3fb8e8', '#2f6fd6', '#1f2a44', '#b48cff', '#7a4fd6', '#ff8ad8',
  '#8fe3a8', '#4caf6e', '#3f6a2a', '#4f5634', '#9db59a', '#6fd3c1', '#c9e7ff',
];

export const SKY_TIME = { golden: 17.6, day: 12.5, night: 22.5, space: 12 };

export const DEFAULTS = {
  block: { s: [4, 1, 2], color: '#d9d2c4', material: 'plastic', name: { en: 'Block', nl: 'Blok' } },
  wedge: { s: [4, 2, 4], color: '#d9d2c4', material: 'plastic', name: { en: 'Wedge', nl: 'Wig' } },
  cylinder: { s: [2, 2, 2], color: '#d9d2c4', material: 'plastic', name: { en: 'Cylinder', nl: 'Cilinder' } },
  sphere: { s: [2, 2, 2], color: '#d9d2c4', material: 'plastic', name: { en: 'Sphere', nl: 'Bol' } },
  cone: { s: [2, 3, 2], color: '#d9d2c4', material: 'plastic', name: { en: 'Cone', nl: 'Kegel' } },
  spawn: { s: [6, 0.4, 6], color: '#3a3f47', material: 'metal', name: { en: 'Spawn', nl: 'Startpunt' } },
  light: { s: [0.6, 0.6, 0.6], color: '#ffd29a', material: 'neon', name: { en: 'Light', nl: 'Lamp' }, collide: false },
  text: { s: [6, 2.4, 0.3], color: '#1f2a44', material: 'metal', name: { en: 'Sign', nl: 'Bord' } },
};

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[A-Za-z0-9_-]{1,32}$/;

// ------------------------------------------------------------------ helpers
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round = (v, k = 1000) => Math.round(v * k) / k;
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const vec3 = (v, d, lo, hi) => {
  const a = Array.isArray(v) ? v : [];
  return [0, 1, 2].map((i) => round(clamp(num(a[i], d[i]), lo, hi)));
};
const wrapDeg = (a) => {
  let x = a % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return round(x);
};

let seq = 0;
/** A short id that is not in `taken` (Set or Map of ids). */
export function newId(prefix = 'p', taken = null) {
  for (;;) {
    seq = (seq + 1) % 1679616;
    const id = `${prefix}${Date.now().toString(36).slice(-4)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    if (!taken || !taken.has(id)) return id;
  }
}

// ------------------------------------------------------------- text filter
// Child-safety: a small bilingual word list (the server filters again). Short words match as whole
// words only (so "skunk" or "Kutzbach" stay intact); longer ones also inside words.
const BAD = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'fag',
  'retard', 'rape', 'porn', 'nazi', 'hitler', 'asshole', 'bastard', 'wanker', 'twat',
  'kanker', 'tering', 'tyfus', 'hoer', 'kut', 'lul', 'klootzak', 'godverdomme', 'mongool', 'flikker', 'neuken', 'pik', 'slet',
];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', $: 's', '@': 'a', '!': 'i' };
const deleet = (s) => s.toLowerCase().replace(/[013457$@!]/g, (c) => LEET[c] || c);

/** Replaces blocked words with asterisks; also strips control characters. */
export function filterText(input, max = 200) {
  let s = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ')
    .slice(0, max);
  const low = deleet(s);
  const mask = new Uint8Array(s.length);
  for (const w of BAD) {
    let i = low.indexOf(w);
    while (i >= 0) {
      const before = i === 0 ? '' : low[i - 1];
      const after = low[i + w.length] || '';
      const whole = !/[a-z]/.test(before) && !/[a-z]/.test(after);
      if (w.length > 4 || whole) for (let k = i; k < i + w.length; k++) mask[k] = 1;
      i = low.indexOf(w, i + 1);
    }
  }
  if (!mask.some(Boolean)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) out += mask[i] ? '*' : s[i];
  return out;
}

const cleanText = (v, max, d = '') => {
  const s = typeof v === 'string' ? v : v == null ? d : String(v);
  return filterText(s.trim(), max);
};

// ---------------------------------------------------------- normalisation
function normProps(type, raw) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  if (BEHAVIORS.includes(p.behavior) && p.behavior !== 'none') out.behavior = p.behavior;
  if (out.behavior === 'bounce') out.bounce = round(clamp(num(p.bounce, 22), 4, 60), 10);
  if (type === 'text') {
    out.text = cleanText(p.text, LIMITS.text, 'Ø');
    out.textColor = hex(p.textColor, '#ece6dc');
  } else if (type === 'light') {
    out.brightness = round(clamp(num(p.brightness, 4), 0, 10), 100);
    out.range = round(clamp(num(p.range, 18), 2, 60), 10);
  } else if (type === 'spawn') {
    out.checkpoint = bool(p.checkpoint, true);
  }
  return out;
}

/** Normalised part (or null when hopeless). `name` defaults to the English type name. */
export function normalizePart(raw, idTaken = null) {
  if (!raw || typeof raw !== 'object') return null;
  const type = PART_TYPES.includes(raw.type) ? raw.type : 'block';
  const def = DEFAULTS[type];
  let id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : null;
  if (!id || idTaken?.has(id)) id = newId('p', idTaken);
  idTaken?.add?.(id);
  return {
    id,
    type,
    name: cleanText(raw.name, LIMITS.name, def.name.en) || def.name.en,
    p: vec3(raw.p, [0, 0, 0], -LIMITS.coord, LIMITS.coord),
    r: vec3(raw.r, [0, 0, 0], -1e6, 1e6).map(wrapDeg),
    s: vec3(raw.s, def.s, LIMITS.minSize, LIMITS.maxSize),
    color: hex(raw.color, def.color),
    material: MATERIALS.includes(raw.material) ? raw.material : def.material,
    anchored: bool(raw.anchored, true),
    collide: bool(raw.collide, def.collide ?? true),
    transparency: round(clamp(num(raw.transparency, 0), 0, 1), 100),
    group: typeof raw.group === 'string' && ID.test(raw.group) ? raw.group : null,
    props: normProps(type, raw.props),
  };
}

export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const sky = SKIES.includes(s.sky) ? s.sky : 'golden';
  const bp = s.baseplate && typeof s.baseplate === 'object' ? s.baseplate : {};
  return {
    time: round(((num(s.time, SKY_TIME[sky]) % 24) + 24) % 24, 100),
    sky,
    gravity: round(clamp(num(s.gravity, 1), 0.1, 5), 100),
    baseplate: {
      size: Math.round(clamp(num(bp.size, 512), 0, LIMITS.baseplate)),
      color: hex(bp.color, '#3a3f47'),
      material: MATERIALS.includes(bp.material) ? bp.material : 'concrete',
    },
  };
}

export function normalizeMeta(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    title: cleanText(m.title, LIMITS.title, ''),
    description: cleanText(m.description, LIMITS.description, ''),
    maxPlayers: Math.round(clamp(num(m.maxPlayers, 20), 1, LIMITS.maxPlayers)),
  };
}

/**
 * Validates + normalises an experience (object or JSON string).
 * Returns { ok, errors, warnings, exp }.
 */
export function validate(input) {
  const errors = [];
  const warnings = [];
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.bytes * 1.5) return { ok: false, errors: ['too-large'], warnings, exp: null };
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ['not-json'], warnings, exp: null };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['not-an-object'], warnings, exp: null };
  if (raw.format !== undefined && raw.format !== FORMAT) errors.push('wrong-format');
  if (raw.format === undefined) warnings.push('no-format');
  const v = num(raw.v, VERSION);
  if (v > VERSION) warnings.push('newer-version');
  const rawParts = Array.isArray(raw.parts) ? raw.parts : [];
  if (!Array.isArray(raw.parts)) warnings.push('no-parts');
  if (rawParts.length > LIMITS.parts) errors.push('too-many-parts');
  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  if (rawGroups.length > LIMITS.groups) errors.push('too-many-groups');
  if (errors.length) return { ok: false, errors, warnings, exp: null };

  // groups: unique ids, parents must exist, no cycles
  const gIds = new Set();
  const groups = [];
  for (const g of rawGroups) {
    if (!g || typeof g !== 'object') continue;
    let id = typeof g.id === 'string' && ID.test(g.id) ? g.id : null;
    if (!id || gIds.has(id)) id = newId('g', gIds);
    gIds.add(id);
    groups.push({ id, name: cleanText(g.name, LIMITS.name, 'Model') || 'Model', parent: typeof g.parent === 'string' ? g.parent : null });
  }
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const g of groups) {
    if (g.parent && !byId.has(g.parent)) g.parent = null;
    // break cycles
    const seen = new Set([g.id]);
    let p = g.parent;
    while (p) {
      if (seen.has(p)) {
        g.parent = null;
        warnings.push('group-cycle');
        break;
      }
      seen.add(p);
      p = byId.get(p)?.parent || null;
    }
  }
  const pIds = new Set();
  const parts = [];
  for (const rp of rawParts) {
    const part = normalizePart(rp, pIds);
    if (!part) {
      warnings.push('bad-part');
      continue;
    }
    if (part.group && !byId.has(part.group)) part.group = null;
    parts.push(part);
  }
  const exp = {
    format: FORMAT,
    v: VERSION,
    meta: normalizeMeta(raw.meta),
    settings: normalizeSettings(raw.settings),
    parts,
    groups,
    logic: Array.isArray(raw.logic) ? raw.logic.filter((x) => x && typeof x === 'object').slice(0, LIMITS.logic) : [],
  };
  const bytes = byteSize(exp);
  if (bytes > LIMITS.bytes) return { ok: false, errors: ['too-large'], warnings, exp: null };
  return { ok: true, errors, warnings, exp };
}

/** UTF-8 size of the JSON encoding. */
export function byteSize(exp) {
  const s = JSON.stringify(exp);
  let n = s.length;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) n += s.charCodeAt(i) > 2047 ? 2 : 1;
  return n;
}

/** Deep copy of a part (plain data). */
export const clonePart = (p) => ({ ...p, p: [...p.p], r: [...p.r], s: [...p.s], props: { ...p.props } });

/** Human error text for validate() codes. */
export const ERROR_TEXT = {
  'not-json': { en: 'The file is not valid JSON.', nl: 'Het bestand is geen geldige JSON.' },
  'not-an-object': { en: 'This is not an experience.', nl: 'Dit is geen ervaring.' },
  'wrong-format': { en: 'Unknown experience format.', nl: 'Onbekend ervaringsformaat.' },
  'too-many-parts': { en: 'Too many parts (max 5000).', nl: 'Te veel onderdelen (max. 5000).' },
  'too-many-groups': { en: 'Too many groups (max 1000).', nl: 'Te veel groepen (max. 1000).' },
  'too-large': { en: 'The experience is larger than 2 MB.', nl: 'De ervaring is groter dan 2 MB.' },
};
