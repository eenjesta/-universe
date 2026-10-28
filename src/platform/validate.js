/**
 * Client-side checks for the account forms (the server re-checks everything
 * and filters names; these only give instant, friendly feedback). Pure — no
 * DOM — so `node --test src/platform/` can cover them.
 */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const MIN_BIRTH_YEAR = 1900;

/** Lower-cases and trims a typed username (the server only accepts [a-z0-9_]). */
export function cleanUsername(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/** → null when fine, else an error code ('username_short' | 'username_long' | 'username_chars'). */
export function checkUsername(s) {
  const u = cleanUsername(s);
  if (u.length < 3) return 'username_short';
  if (u.length > 20) return 'username_long';
  if (!USERNAME_RE.test(u)) return 'username_chars';
  return null;
}

/** → null | 'password_short' | 'password_long' | 'password_same' (contains the username). */
export function checkPassword(pw, username = '') {
  const p = String(pw ?? '');
  if (p.length < PASSWORD_MIN) return 'password_short';
  if (p.length > PASSWORD_MAX) return 'password_long';
  // the server also rejects passwords that contain the username
  const u = cleanUsername(username);
  if (u && u.length >= 3 && p.toLowerCase().includes(u)) return 'password_same';
  return null;
}

/** 0 (weak) … 3 (strong): length + character variety, for the strength meter. */
export function passwordStrength(pw) {
  const p = String(pw ?? '');
  if (p.length < PASSWORD_MIN) return 0;
  let kinds = 0;
  if (/[a-z]/.test(p)) kinds++;
  if (/[A-Z]/.test(p)) kinds++;
  if (/[0-9]/.test(p)) kinds++;
  if (/[^a-zA-Z0-9]/.test(p)) kinds++;
  let score = 1;
  if (p.length >= 10 && kinds >= 2) score = 2;
  if ((p.length >= 12 && kinds >= 3) || p.length >= 16) score = 3;
  if (/^(.)\1+$/.test(p) || /^(?:12345678|password|qwerty)/i.test(p)) score = 0;
  return score;
}

/** → null | 'birth_missing' | 'birth_range'. */
export function checkBirthYear(y, now = new Date()) {
  if (y === '' || y == null) return 'birth_missing';
  const n = Number(y);
  if (!Number.isInteger(n) || n < MIN_BIRTH_YEAR || n > now.getFullYear()) return 'birth_range';
  return null;
}

/** True when a player born in `year` may be under 13 (conservative: the youngest age they can have). */
export function isUnder13(year, now = new Date()) {
  const n = Number(year);
  if (!Number.isFinite(n)) return false;
  return now.getFullYear() - n - 1 < 13;
}

/** Years for the birth-year picker, newest first. */
export function birthYears(now = new Date()) {
  const out = [];
  for (let y = now.getFullYear(); y >= MIN_BIRTH_YEAR + 6; y--) out.push(y);
  return out;
}

/** Compact counts: 950 → '950', 1234 → '1.2K' (locale-aware). */
export function compactNumber(n, locale = 'en-US') {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: v < 10000 ? 1 : 0 }).format(v);
  } catch {
    return String(Math.round(v));
  }
}

/** '3 days ago' / '3 dagen geleden' (locale-aware); '' for no date. */
export function relativeTime(ms, locale = 'en-US', now = Date.now()) {
  if (!ms) return '';
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    for (const [unit, sec] of units) if (abs >= sec) return rtf.format(Math.round(diff / sec), unit);
    return rtf.format(0, 'second');
  } catch {
    return new Date(ms).toLocaleDateString(locale);
  }
}
