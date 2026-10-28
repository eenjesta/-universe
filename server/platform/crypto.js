/**
 * Passwords (scrypt), session tokens and ids — Node built-ins only.
 *
 *   hash = await hashPassword('correct horse')   // 'scrypt$16384$8$1$<salt b64url>$<key b64url>'
 *   await verifyPassword('correct horse', hash)    // → true (timing-safe)
 *   newSessionToken()                              // 'ous_' + 43 chars (32 random bytes, base64url)
 *   hashToken(token)                               // sha256 hex — what the stores keep
 *
 * Session tokens carry the `ous_` prefix so the game server can tell an account
 * token from a guest token in `hello` (`isSessionToken`). Guest tokens linked at
 * register are stored as `hashToken(guestToken)` (sha256 hex) too.
 */
import crypto from 'node:crypto';

const DEFAULT_COST = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

function scryptAsync(password, salt, keylen, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** scrypt hash string with its parameters (so costs can change later). */
export async function hashPassword(password, cost = DEFAULT_COST) {
  const salt = crypto.randomBytes(16);
  const { N, r, p } = cost;
  const key = await scryptAsync(String(password).normalize('NFC'), salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Timing-safe check of a password against a stored hash string. */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!(N >= 2 && N <= 1 << 20 && (N & (N - 1)) === 0 && r >= 1 && r <= 32 && p >= 1 && p <= 16)) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const want = Buffer.from(parts[5], 'base64url');
  if (!want.length) return false;
  let key;
  try {
    key = await scryptAsync(String(password).normalize('NFC'), salt, want.length, { N, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(key, want);
}

/** Cost parameters of a stored hash (to re-hash on login when the default grows). */
export function hashCost(stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  return parts.length === 6 ? { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) } : null;
}

export const SESSION_PREFIX = 'ous_';
export const newSessionToken = () => SESSION_PREFIX + crypto.randomBytes(32).toString('base64url');
export const isSessionToken = (t) => typeof t === 'string' && t.startsWith(SESSION_PREFIX) && t.length >= 40 && t.length <= 64;
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no 0/o/1/l confusion
/** Short random id with a type prefix: newId('x') → 'x7kq3m9w2ab'. */
export function newId(prefix, len = 10) {
  const bytes = crypto.randomBytes(len);
  let s = prefix;
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] & 31];
  return s;
}

export const DEFAULT_SCRYPT = DEFAULT_COST;
