import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/**
 * HTTP side of the game service: the built client (STATIC_DIR) + /healthz.
 *
 *   - correct MIME types, `X-Content-Type-Options: nosniff`
 *   - Vite's hashed files under /assets/ → `max-age=1y, immutable`;
 *     *.html → `no-cache` (always revalidated, so a deploy is picked up at once);
 *     everything else → 1 h
 *   - ETag / Last-Modified + 304s
 *   - brotli (preferred) or gzip for compressible types, compressed once and kept
 *     in a small LRU cache (keyed by path + mtime + size, ≤ 24 MB in total)
 *   - GET/HEAD only, no directory listings, no path traversal
 */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.webmanifest', '.txt', '.xml', '.svg', '.wasm', '.ttf', '.otf', '.gltf', '.bin', '.ico']);
const MIN_COMPRESS = 1024;

/** Small byte-bounded LRU for compressed bodies (Map keeps insertion order). */
export class ByteLRU {
  constructor(maxBytes = 24 * 1024 * 1024) {
    this.max = maxBytes;
    this.bytes = 0;
    this.map = new Map();
  }
  get(k) {
    const v = this.map.get(k);
    if (v) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k, buf) {
    if (buf.length > this.max / 4) return; // too big to keep: serve it but don't cache it
    const old = this.map.get(k);
    if (old) {
      this.bytes -= old.length;
      this.map.delete(k);
    }
    this.map.set(k, buf);
    this.bytes += buf.length;
    while (this.bytes > this.max && this.map.size) {
      const [ok, ov] = this.map.entries().next().value;
      this.map.delete(ok);
      this.bytes -= ov.length;
    }
  }
}

/** 'br' | 'gzip' | null from an Accept-Encoding header (an explicit q=0 disables an encoding). */
export function pickEncoding(accept) {
  if (!accept) return null;
  const ok = new Set();
  for (const part of String(accept).toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (q && !(Number.parseFloat(q.slice(2)) > 0)) continue;
    ok.add(name.trim());
  }
  if (ok.has('br')) return 'br';
  if (ok.has('gzip')) return 'gzip';
  return null;
}

function cacheControlFor(rel, ext) {
  if (ext === '.html') return 'no-cache';
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

const NO_BUILD_PAGE = `<!doctype html><meta charset="utf-8"><title>Ø Universe server</title>
<body style="font-family:system-ui;background:#07090d;color:#ece6dc;padding:40px">
<h1>Ø Universe game server is running</h1>
<p>No client build found. Run <code>npm run build</code> (or set STATIC_DIR) and restart.</p>
<p>Geen client-build gevonden. Voer <code>npm run build</code> uit (of zet STATIC_DIR) en herstart.</p>`;

/**
 * @param {{ staticDir: string, log: any, health: () => object, metrics?: object,
 *           api?: (req, res) => boolean | Promise<boolean> }} opts — api: the platform layer
 *           (server/platform) for /api/*; returns false when it didn't handle the request
 * @returns {(req, res) => void} request handler (+ .warm(), .cache)
 */
export function createHttpHandler({ staticDir, log, health, metrics = {}, api = null }) {
  const root = path.resolve(staticDir);
  const cache = new ByteLRU();
  const inflight = new Map();
  const hasBuild = fs.existsSync(path.join(root, 'index.html'));
  if (!hasBuild) log.warn('no client build in STATIC_DIR — serving a placeholder page', { staticDir: root });
  metrics.http = metrics.http || { requests: 0, bytes: 0, errors: 0 };
  const m = metrics.http;

  async function compressed(file, st, enc) {
    const key = `${file}|${st.mtimeMs}|${st.size}|${enc}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        const raw = await fsp.readFile(file);
        const body =
          enc === 'br'
            ? await brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
            : await gzip(raw, { level: 8 });
        cache.set(key, body);
        return body;
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  }

  function send(res, status, headers, body, head) {
    res.writeHead(status, headers);
    if (head || body == null) res.end();
    else {
      m.bytes += body.length;
      res.end(body);
    }
  }

  async function serveStatic(req, res, pathname) {
    const head = req.method === 'HEAD';
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return send(res, 400, { 'Content-Type': 'text/plain' }, Buffer.from('bad request'), head);
    }
    if (rel.includes('\0')) return send(res, 400, { 'Content-Type': 'text/plain' }, Buffer.from('bad request'), head);
    if (rel.endsWith('/')) rel += 'index.html';
    rel = path.posix.normalize(rel).replace(/^(\.\.(\/|$))+/, '').replace(/^\/+/, '');
    const file = path.join(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, { 'Content-Type': 'text/plain' }, Buffer.from('forbidden'), head);

    if (!hasBuild && (rel === 'index.html' || rel === '')) {
      return send(res, 200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }, Buffer.from(NO_BUILD_PAGE), head);
    }
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      st = null;
    }
    if (!st || !st.isFile()) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }, Buffer.from('not found'), head);
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = {
      'Content-Type': type,
      'Cache-Control': cacheControlFor(rel, ext),
      'Last-Modified': st.mtime.toUTCString(),
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    };
    const compressible = COMPRESSIBLE.has(ext) && st.size >= MIN_COMPRESS;
    if (compressible) headers.Vary = 'Accept-Encoding';
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').some((t) => t.trim() === etag)) return send(res, 304, headers, null, true);
    if (!inm && req.headers['if-modified-since']) {
      const since = Date.parse(req.headers['if-modified-since']);
      if (Number.isFinite(since) && Math.floor(st.mtimeMs / 1000) <= Math.floor(since / 1000)) return send(res, 304, headers, null, true);
    }
    const enc = compressible ? pickEncoding(req.headers['accept-encoding']) : null;
    if (enc) {
      const body = await compressed(file, st, enc);
      headers['Content-Encoding'] = enc;
      headers['Content-Length'] = body.length;
      return send(res, 200, headers, body, head);
    }
    headers['Content-Length'] = st.size;
    if (head) return send(res, 200, headers, null, true);
    res.writeHead(200, headers);
    m.bytes += st.size;
    fs.createReadStream(file)
      .on('error', (err) => {
        log.warn('static read failed', { file: rel, err });
        res.destroy(err);
      })
      .pipe(res);
  }

  const handler = (req, res) => {
    m.requests++;
    const url = req.url || '/';
    const q = url.indexOf('?');
    const pathname = q >= 0 ? url.slice(0, q) : url;
    if (pathname === '/healthz') {
      let body;
      try {
        body = JSON.stringify(health());
      } catch (err) {
        body = JSON.stringify({ ok: false, error: String(err?.message || err) });
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const notFound = () => {
        if (res.headersSent) return;
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'not_found' }));
      };
      if (!api) return notFound();
      Promise.resolve()
        .then(() => api(req, res))
        .then((handled) => {
          if (!handled) notFound();
        })
        .catch((err) => {
          m.errors++;
          log.error('api handler failed', { url: pathname, err });
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'server_error' }));
          } else res.destroy();
        });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
      res.end('method not allowed');
      return;
    }
    serveStatic(req, res, pathname).catch((err) => {
      m.errors++;
      log.warn('http error', { url: pathname, err });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('server error');
      } else res.destroy();
    });
  };

  /** Pre-compress index.html + the JS/CSS bundles in the background (first visitors get cached bodies). */
  handler.warm = async () => {
    if (!hasBuild) return 0;
    const files = ['index.html'];
    try {
      for (const f of await fsp.readdir(path.join(root, 'assets'))) if (/\.(js|css)$/.test(f)) files.push('assets/' + f);
    } catch {}
    let n = 0;
    for (const rel of files) {
      try {
        const file = path.join(root, rel);
        const st = await fsp.stat(file);
        if (st.size < MIN_COMPRESS) continue;
        await compressed(file, st, 'br');
        await compressed(file, st, 'gzip');
        n++;
      } catch {}
    }
    return n;
  };
  handler.cache = cache;
  return handler;
}
