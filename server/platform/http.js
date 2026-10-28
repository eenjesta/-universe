/**
 * HTTP helpers for the platform API: JSON bodies with size limits, JSON
 * responses with safe headers, client IP (proxy-aware), same-origin / CORS.
 */
import { ApiError, fail } from './errors.js';

export const KB = 1024;
export const MB = 1024 * 1024;

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** Write a JSON response (no-op when the response is already finished). */
export function sendJson(res, status, body, headers) {
  if (res.writableEnded || res.destroyed) return;
  const data = Buffer.from(JSON.stringify(body ?? {}), 'utf8');
  if (!res.headersSent) {
    res.writeHead(status, { ...BASE_HEADERS, ...(res.__corsHeaders || {}), ...(headers || {}), 'Content-Length': data.length });
  }
  res.end(res.__head ? undefined : data);
}

/** Write an ApiError (or any Error → 500) as `{ error: { code, message, nl } }`. */
export function sendError(res, err, log) {
  let e = err;
  if (!(e instanceof ApiError)) {
    log?.error?.('platform request failed', { err });
    e = new ApiError('internal');
  }
  sendJson(res, e.status, e.toJSON(), e.headers);
}

/** True for `application/json` (any parameters). */
export function isJsonType(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  return ct.split(';')[0].trim() === 'application/json';
}

/**
 * Read and parse a JSON request body (bounded). Oversized bodies are drained up
 * to a hard cap (so the client still receives a proper 413) and then dropped.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit max bytes
 * @param {{ optional?: boolean }} [opts] optional → an empty body gives `{}`
 * @returns {Promise<any>}
 */
export function readJson(req, limit, { optional = false } = {}) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    const hard = Math.max(limit * 4, 8 * MB);
    if (declared > hard) {
      reject(tooLarge(req, limit));
      req.destroy();
      return;
    }
    let size = 0;
    let over = declared > limit;
    let chunks = [];
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      fn(v);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (over || size > limit) {
        over = true;
        chunks = null;
        if (size > hard) {
          finish(reject, tooLarge(req, limit));
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => finish(reject, err));
    req.on('close', () => finish(reject, Object.assign(new Error('request aborted'), { aborted: true })));
    req.on('end', () => {
      if (over) return finish(reject, tooLarge(req, limit));
      if (size === 0) {
        if (optional) return finish(resolve, {});
        return finish(reject, fail('bad_request', { message: 'A JSON body is required.', nl: 'Een JSON-inhoud is verplicht.' }));
      }
      if (!isJsonType(req)) return finish(reject, fail('unsupported_media_type'));
      let text = Buffer.concat(chunks, size).toString('utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return finish(reject, fail('bad_json'));
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return finish(reject, fail('bad_request', { message: 'The JSON body must be an object.', nl: 'De JSON-inhoud moet een object zijn.' }));
      }
      finish(resolve, body);
    });
  });
}

function tooLarge(req, limit) {
  req.__tooLarge = true;
  return fail('too_large', { headers: { Connection: 'close' }, details: { limit } });
}

/** Client IP. With `trustProxy` (true or a hop count) the X-Forwarded-For entry added by our proxy is used. */
export function clientIp(req, trustProxy) {
  const direct = normalizeIp(req.socket?.remoteAddress || '');
  if (!trustProxy) return direct || 'unknown';
  const xff = req.headers['x-forwarded-for'];
  if (!xff) return direct || 'unknown';
  const parts = String(xff)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return direct || 'unknown';
  const hops = trustProxy === true ? 1 : Math.max(1, Number(trustProxy) | 0);
  return normalizeIp(parts[Math.max(0, parts.length - hops)]) || direct || 'unknown';
}

function normalizeIp(ip) {
  const s = String(ip).trim();
  return s.startsWith('::ffff:') ? s.slice(7) : s;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export const isLoopbackHost = (hostname) => LOOPBACK.has(String(hostname).toLowerCase()) || /^127\./.test(hostname);

/**
 * Same-origin policy for the API. Requests without an Origin header (same-origin
 * GETs, curl, the game server itself) pass. Otherwise the Origin must match the
 * Host (or X-Forwarded-Host behind a trusted proxy), be listed in
 * `allowedOrigins`, or — with `allowLocal` — be a loopback origin (Vite dev).
 * @returns {{ ok: boolean, cors: boolean, origin?: string }}
 */
export function checkOrigin(req, { allowedOrigins = [], allowLocal = false, trustProxy = false } = {}) {
  const origin = req.headers.origin;
  if (!origin) return { ok: true, cors: false };
  if (origin === 'null') return { ok: false, cors: false };
  let u;
  try {
    u = new URL(origin);
  } catch {
    return { ok: false, cors: false };
  }
  const hosts = [req.headers.host];
  if (trustProxy && req.headers['x-forwarded-host']) hosts.push(String(req.headers['x-forwarded-host']).split(',')[0].trim());
  if (hosts.some((h) => h && h.toLowerCase() === u.host.toLowerCase())) return { ok: true, cors: false };
  const o = origin.replace(/\/$/, '').toLowerCase();
  if (allowedOrigins.includes(o)) return { ok: true, cors: true, origin };
  if (allowLocal && isLoopbackHost(u.hostname)) return { ok: true, cors: true, origin };
  return { ok: false, cors: false };
}

export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
}

/** `Authorization: Bearer <token>` → token | null */
export function bearer(req) {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(\S{10,256})\s*$/i.exec(String(h));
  return m ? m[1] : null;
}
