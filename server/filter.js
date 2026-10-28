/**
 * Text filters for chat and names (English + Dutch).
 *
 *   filterText('wat een KUT spel') → 'wat een *** spel'
 *   cleanText(raw, max)             → trimmed, control chars removed, whitespace collapsed
 *   cleanName(raw)                  → a 2–20 char display name or null (bad word / too short)
 *
 * Matching runs on a normalised copy of the text (lower case, common leetspeak
 * like 4→a 3→e 1→i 0→o 5→s 7→t @→a $→s), char-for-char, so masks line up with
 * the original. ROOTS match anywhere (fuck → motherfucker), PREFIXES at the
 * start of a word (kutweer, shitty — but not "catering"), WORDS only as exact
 * whole words (so "peacock", "hoera", "pike", "assen" or "flikkeren" stay intact).
 */
const ROOTS = [
  // en
  'fuck', 'cunt', 'nigger', 'nigga', 'faggot', 'motherf', 'wanker', 'bullshit', 'dickhead', 'asshole', 'arsehole', 'dumbass', 'jackass',
  // nl
  'kanker', 'klootzak', 'godverdom', 'godver', 'kutwijf', 'hoerenjong', 'mongool', 'teringlijer', 'tyfuslijer',
];
const PREFIXES = [
  // en
  'shit', 'bitch', 'slut', 'whore', 'retard', 'rapist',
  // nl
  'kut', 'tering', 'tyfus', 'neuk', 'pleuris', 'kolere', 'sletje', 'klootz',
];
const WORDS = [
  // en
  'dick', 'dicks', 'cock', 'cocks', 'pussy', 'pussies', 'ass', 'asses', 'twat', 'twats', 'prick', 'pricks', 'bastard', 'bastards',
  'fag', 'fags', 'nazi', 'nazis', 'rape', 'raped', 'kys', 'stfu', 'wtf',
  // nl
  'lul', 'hoer', 'hoeren', 'hoertje', 'hoerig', 'slet', 'sletten', 'teef', 'teven', 'pik', 'eikel', 'eikels', 'trut', 'trutten',
  'debiel', 'debielen', 'kech', 'tyf', 'flikker', 'flikkers', 'hufter', 'hufters',
];

const LEET = { 4: 'a', '@': 'a', 3: 'e', 1: 'i', 0: 'o', 5: 's', $: 's', 7: 't' };

/** Lower-case + leetspeak, one output char per code point of `text` (so indices match Array.from(text)). */
function normalise(text) {
  let out = '';
  for (const cp of text) {
    const l = cp.toLowerCase();
    out += l.length === 1 ? (LEET[l] ?? l) : '\u0000';
  }
  return out;
}

const isLetter = (c) => c >= 'a' && c <= 'z';

const WORDSET = new Set(WORDS);

/** Replace bad words with asterisks (same length). */
export function filterText(text) {
  if (!text) return text;
  const chars = Array.from(text); // code points (emoji stay one unit)
  const norm = normalise(text);
  const mask = new Uint8Array(chars.length);
  // roots anywhere (letters only, separators like "f.u.c.k" are not handled in v1)
  for (const r of ROOTS) {
    let i = norm.indexOf(r);
    while (i >= 0) {
      for (let k = i; k < i + r.length; k++) mask[k] = 1;
      // extend over the rest of the word (motherfuckers)
      let e = i + r.length;
      while (e < norm.length && isLetter(norm[e])) mask[e++] = 1;
      i = norm.indexOf(r, i + 1);
    }
  }
  // whole words + word-initial prefixes
  let s = 0;
  for (let i = 0; i <= norm.length; i++) {
    if (i < norm.length && isLetter(norm[i])) continue;
    if (i > s) {
      const w = norm.slice(s, i);
      if (WORDSET.has(w) || PREFIXES.some((p) => w.startsWith(p))) for (let k = s; k < i; k++) mask[k] = 1;
    }
    s = i + 1;
  }
  let out = '';
  let changed = false;
  for (let i = 0; i < chars.length; i++) {
    if (mask[i] && chars[i] !== ' ') {
      out += '*';
      changed = true;
    } else out += chars[i];
  }
  return changed ? out : text;
}

/** True when filterText would change the text. */
export function hasBadWords(text) {
  return filterText(text) !== text;
}

// C0/C1 controls, zero-width & bidi overrides, line/paragraph separators
const CONTROL_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2028, 0x2029], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const hex4 = (n) => '\\u' + n.toString(16).padStart(4, '0');
const CONTROL = new RegExp('[' + CONTROL_RANGES.map(([a, b]) => hex4(a) + '-' + hex4(b)).join('') + ']', 'g');

/** Trim, drop control/invisible chars, collapse whitespace, cap at `max` code points. */
export function cleanText(raw, max = 200) {
  if (typeof raw !== 'string') return '';
  let s = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  const cps = Array.from(s);
  if (cps.length > max) s = cps.slice(0, max).join('').trim();
  return s;
}

export const NAME_MIN = 2;
export const NAME_MAX = 20;

/** A display name of 2–20 chars (letters, digits, space and - _ . ' only), or null when unusable. */
export function cleanName(raw) {
  let s = cleanText(raw, 64)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _.'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = Array.from(s).slice(0, NAME_MAX).join('').trim();
  if (Array.from(s).length < NAME_MIN) return null;
  if (!/[\p{L}\p{N}]/u.test(s)) return null;
  if (hasBadWords(s) || hasBadWords(s.replace(/[ _.'-]/g, ''))) return null;
  return s;
}

/** Guest name for a player that has no usable name yet: "Explorer 4821" / "Verkenner 4821". */
export function guestName(lang, n) {
  return `${lang === 'nl' ? 'Verkenner' : 'Explorer'} ${n}`;
}
