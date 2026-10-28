/**
 * Platform text filter (English + Dutch) for usernames, experience titles,
 * descriptions, text parts and report notes.
 *
 *   filterText('wat een KUT spel')            → 'wat een *** spel'      (same length, per code point)
 *   filterText('mail me: a@b.nl', { pii: true }) → 'mail me: ******'      (e-mail, URLs, phone numbers)
 *   hasBadWords('f u c k')                    → true
 *   checkUsername('pikachu_7')                → null  (ok) · 'filtered' · 'reserved' · 'format'
 *
 * Matching runs on a normalised copy (lower case, diacritics and Cyrillic
 * look-alikes folded, leetspeak 4/@→a 3→e 1→i|l 0→o 5/$→s 7→t), one char per
 * code point so masks line up with the original text. ROOTS match anywhere,
 * PREFIXES at the start of a word, WORDS only as whole words (so "peacock",
 * "class", "pikachu" or "hoera" stay intact). Also caught: spaced letters
 * ("f.u.c.k", "k u t") and stretched letters ("fuuuck"). Same conventions as the
 * game server's chat filter (server/filter.js), stricter for names.
 */

const ROOTS = [
  // en
  'fuck', 'cunt', 'nigger', 'nigga', 'faggot', 'motherf', 'wanker', 'bullshit', 'dickhead', 'asshole', 'arsehole',
  'dumbass', 'jackass', 'blowjob', 'handjob', 'dildo', 'pornhub', 'xvideos', 'onlyfans', 'hentai',
  // nl
  'kanker', 'klootzak', 'godverdom', 'godver', 'kutwijf', 'hoerenjong', 'hoerenzoon', 'mongool', 'teringlijer',
  'tyfuslijer', 'kankerlijer', 'nikker', 'pijpbeurt',
];
const PREFIXES = [
  // en
  'shit', 'bitch', 'slut', 'whore', 'retard', 'rapist', 'porn', 'pussy', 'penis', 'vagina', 'boob', 'horny', 'nude',
  // nl
  'kut', 'tering', 'tyfus', 'neuk', 'pleuris', 'kolere', 'sletje', 'klootz', 'tieten', 'pijpen', 'beffen',
];
const WORDS = [
  // en
  'dick', 'dicks', 'cock', 'cocks', 'pussies', 'ass', 'asses', 'arse', 'twat', 'twats', 'prick', 'pricks', 'bastard',
  'bastards', 'fag', 'fags', 'nazi', 'nazis', 'hitler', 'rape', 'raped', 'raping', 'kys', 'stfu', 'wtf', 'sex', 'sexy',
  'tits', 'titty', 'titties', 'cum', 'jizz', 'milf', 'nsfw', 'naked', 'spastic', 'tranny',
  // nl
  'lul', 'lullen', 'hoer', 'hoeren', 'hoertje', 'hoerig', 'slet', 'sletten', 'teef', 'teven', 'pik', 'eikel', 'eikels',
  'trut', 'trutten', 'debiel', 'debielen', 'kech', 'tyf', 'flikker', 'flikkers', 'hufter', 'hufters', 'seks', 'seksy',
  'naakt', 'geil', 'geile', 'neger', 'negers', 'spast', 'spasten', 'mongolen', 'klote', 'kloten',
];
/** Extra roots only for usernames (rare false positives in a name, common in abuse). */
const NAME_ROOTS = ['dick', 'cock', 'sexy', 'boob', 'tits', 'porn', 'pussy', 'penis', 'nazi', 'hitler', 'kut', 'lul', 'hoer', 'slet', 'geil', 'naakt'];
/** Names that would impersonate staff, the game or system accounts (exact or as prefix). */
const RESERVED_EXACT = new Set([
  'system', 'server', 'support', 'help', 'root', 'null', 'undefined', 'guest', 'gast', 'everyone', 'iedereen',
  'anonymous', 'anoniem', 'owner', 'aria', 'mod', 'mods', 'me', 'you', 'api', 'www',
]);
const RESERVED_PREFIX = ['admin', 'moderator', 'mod_', 'staff', 'official', 'officieel', 'ouniverse', 'o_universe', 'universe_team', 'roblox', 'anthropic', 'claude'];

const LEET_A = { 4: 'a', '@': 'a', 3: 'e', 1: 'i', 0: 'o', 5: 's', $: 's', 7: 't', '|': 'l' };
const LEET_B = { 4: 'a', '@': 'a', 3: 'e', 1: 'l', '!': 'i', 0: 'o', 5: 's', $: 's', 7: 't', '|': 'i' };
// Cyrillic / Greek look-alikes
const GLYPH = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', і: 'i', ј: 'j', ѕ: 's', т: 't', н: 'h', м: 'm', в: 'b', ο: 'o', α: 'a', ι: 'i', κ: 'k', ν: 'v', τ: 't', υ: 'u' };

const WORDSET = new Set(WORDS);

// Fast path: for pure-ASCII text one regex scan per leet variant decides "clean" (most strings).
// It is conservative: anything the full scan could mask (roots, word prefixes, whole words,
// stretched letters, spaced single letters) makes it fall through to the full scan.
const rx = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const QUICK_BAD = new RegExp(
  [
    ROOTS.map(rx).join('|'),
    `(?<![a-z])(?:${PREFIXES.map(rx).join('|')})`,
    `(?<![a-z])(?:${WORDS.map(rx).join('|')})(?![a-z])`,
    '([a-z])\\1\\1',
    '(?<![a-z])[a-z][^a-z\\r\\n]{1,3}[a-z][^a-z\\r\\n]{1,3}[a-z](?![a-z])',
  ].join('|'),
);
const LEET_RE = /[4@3105$7|!]/g;
const HAS_LEET = /[4@3105$7|!]/;
const mapA = (ch) => LEET_A[ch] ?? ch;
const mapB = (ch) => LEET_B[ch] ?? ch;
const isAscii = (t) => {
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) > 127) return false;
  return true;
};
function quickClean(text) {
  if (!isAscii(text)) return false;
  const low = text.toLowerCase();
  if (!HAS_LEET.test(low)) return !QUICK_BAD.test(low);
  return !QUICK_BAD.test(low.replace(LEET_RE, mapA)) && !QUICK_BAD.test(low.replace(LEET_RE, mapB));
}
function anyPii(text) {
  for (const re of PII) {
    re.lastIndex = 0;
    if (re.test(text)) return true;
  }
  return false;
}
const isLetter = (c) => c >= 'a' && c <= 'z';
const DIACRITICS = /[\u0300-\u036f]/g;

function foldChar(cp, leet) {
  let l = cp.toLowerCase();
  if (l.length === 1 && isLetter(l)) return l;
  if (leet[l] !== undefined) return leet[l];
  if (GLYPH[l]) return GLYPH[l];
  const d = l.normalize('NFKD').replace(DIACRITICS, '');
  if (d.length === 1 && isLetter(d)) return d;
  const k = l.normalize('NFKC').toLowerCase();
  if (k.length === 1 && isLetter(k)) return k;
  if (k.length === 1 && leet[k] !== undefined) return leet[k];
  return l.length === 1 ? l : '\u0000';
}

/** Normalised char array (one entry per code point of `chars`). */
function normalise(chars, leet) {
  const out = new Array(chars.length);
  for (let i = 0; i < chars.length; i++) out[i] = foldChar(chars[i], leet);
  return out;
}

const badWord = (w) => WORDSET.has(w) || PREFIXES.some((p) => w.startsWith(p)) || ROOTS.some((r) => w.includes(r));

/** Variants of a word with stretched letters (3+ repeats) squeezed to 1 and to 2. */
function squeezed(w) {
  if (!/(.)\1\1/.test(w)) return null;
  return [w.replace(/(.)\1{2,}/g, '$1'), w.replace(/(.)\1{2,}/g, '$1$1')];
}

/** Mark bad words of the normalised text `n` (array of chars) in `mask`. */
function detect(n, mask) {
  const s = n.join('');
  for (const r of ROOTS) {
    let i = s.indexOf(r);
    while (i >= 0) {
      let a = i;
      while (a > 0 && isLetter(s[a - 1])) a--; // whole word around the root
      let e = i + r.length;
      while (e < s.length && isLetter(s[e])) e++;
      mask.fill(1, a, e);
      i = s.indexOf(r, i + 1);
    }
  }
  // letter runs = words
  const runs = [];
  for (let i = 0; i < s.length; ) {
    if (!isLetter(s[i])) {
      i++;
      continue;
    }
    let e = i;
    while (e < s.length && isLetter(s[e])) e++;
    runs.push(i, e);
    i = e;
  }
  for (let k = 0; k < runs.length; k += 2) {
    const a = runs[k];
    const b = runs[k + 1];
    const w = s.slice(a, b);
    if (WORDSET.has(w) || PREFIXES.some((p) => w.startsWith(p))) mask.fill(1, a, b);
    else {
      const v = squeezed(w);
      if (v && v.some(badWord)) mask.fill(1, a, b);
    }
  }
  // spaced single letters: "f u c k", "k.u.t", "s-h-i-t"
  let g = 0;
  while (g < runs.length) {
    let h = g;
    let word = '';
    while (h < runs.length && runs[h + 1] - runs[h] === 1 && (h === g || (runs[h] - runs[h - 1] <= 3 && !/[\n\r]/.test(s.slice(runs[h - 1], runs[h]))))) {
      word += s[runs[h]];
      h += 2;
    }
    if (h - g >= 6 && badWord(word)) for (let k = g; k < h; k += 2) mask[runs[k]] = 1; // ≥ 3 letters
    g = h > g ? h : g + 2;
  }
}

// e-mail, URLs / domains, phone numbers (9+ digits)
const PII = [
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}/giu,
  /\b(?:https?:\/\/|www\.)\S+/giu,
  /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|nl|be|de|uk|eu|gg|io|me|tv|xyz|co|app|dev|info|biz|ly|link|site|online|club|fun|shop|live)\b(?:\/\S*)?/giu,
  /(?:\+|\b)\d(?:[\s.-]?\d){8,}\b/gu,
];

/**
 * Mask bad words (and with `pii`, contact details) with asterisks.
 * @param {string} text
 * @param {{ pii?: boolean }} [opts]
 * @returns {string} the original string when nothing matched
 */
export function filterText(text, { pii = false } = {}) {
  if (typeof text !== 'string' || !text) return text;
  if (quickClean(text) && (!pii || !anyPii(text))) return text;
  const chars = Array.from(text);
  const mask = new Uint8Array(chars.length);
  detect(normalise(chars, LEET_A), mask);
  detect(normalise(chars, LEET_B), mask);
  if (pii) maskPii(text, chars, mask);
  let out = '';
  let changed = false;
  for (let i = 0; i < chars.length; i++) {
    if (mask[i] && !/\s/.test(chars[i])) {
      out += '*';
      changed = true;
    } else out += chars[i];
  }
  return changed ? out : text;
}

function maskPii(text, chars, mask) {
  // map UTF-16 offsets → code point indices
  const cpAt = new Int32Array(text.length + 1);
  let ci = 0;
  for (let u = 0; u < text.length; ci++) {
    const cp = text.codePointAt(u);
    const len = cp > 0xffff ? 2 : 1;
    for (let j = 0; j < len; j++) cpAt[u + j] = ci;
    u += len;
  }
  cpAt[text.length] = chars.length;
  for (const re of PII) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      mask.fill(1, cpAt[m.index], cpAt[m.index + m[0].length]);
    }
  }
}

/** True when filterText would change the text (bad words only, not contact details). */
export function hasBadWords(text) {
  return filterText(text) !== text;
}

/** True when the text contains contact details (e-mail, URL/domain, phone number). */
export function hasPii(text) {
  return typeof text === 'string' && filterText(text, { pii: true }) !== filterText(text);
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/**
 * Validate a (lower-cased) username.
 * @returns {null | 'format' | 'reserved' | 'filtered'} null when allowed
 */
export function checkUsername(name) {
  if (typeof name !== 'string' || !USERNAME_RE.test(name)) return 'format';
  if (!/[a-z]/.test(name)) return 'format'; // not digits/underscores only
  if (/__/.test(name) || /^_|_$/.test(name)) return 'format';
  if (RESERVED_EXACT.has(name) || RESERVED_PREFIX.some((p) => name.startsWith(p))) return 'reserved';
  if (/\d{7,}/.test(name)) return 'filtered'; // looks like a phone number
  if (hasBadWords(name) || hasBadWords(name.replace(/_/g, ' ')) || hasBadWords(name.replace(/[_\d]+/g, ' '))) return 'filtered';
  for (const leet of [LEET_A, LEET_B]) {
    const flat = normalise(Array.from(name.replace(/_/g, '')), leet).join('');
    let guarded = flat;
    for (const safe of NAME_SAFE) guarded = guarded.split(safe).join('#');
    if (badWord(flat) || NAME_ROOTS.some((r) => guarded.includes(r))) return 'filtered';
    const v = squeezed(flat);
    if (v && v.some((w) => badWord(w) || NAME_ROOTS.some((r) => w.includes(r)))) return 'filtered';
  }
  return null;
}
/** Harmless words that contain a NAME_ROOT (Scunthorpe guard for usernames). */
const NAME_SAFE = ['peacock', 'hancock', 'cocktail', 'dickens', 'titan', 'stitch', 'kutter', 'skull', 'lulu', 'lullaby', 'shoer', 'sletter', 'geilo', 'nazir', 'hitlist'];
