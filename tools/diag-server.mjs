#!/usr/bin/env node
/**
 * Tiny collector for the in-game GPU diagnostics (`?diag`, src/core/diag.js).
 * The page POSTs its JSON report to http://<page host>:4174/diag; each report
 * is written to $DIAG_DIR (default /tmp/o-universe-diag).
 *
 *   DIAG_HOSTS=127.0.0.1,<tailscale-ip> node tools/diag-server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const hosts = (process.env.DIAG_HOSTS || '127.0.0.1').split(',').map((h) => h.trim()).filter(Boolean);
const port = Number(process.env.DIAG_PORT || 4174);
const dir = process.env.DIAG_DIR || '/tmp/o-universe-diag';
fs.mkdirSync(dir, { recursive: true });

function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return res.end('o-universe diag collector\n');
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 5e6) req.destroy();
  });
  req.on('end', () => {
    const file = path.join(dir, `diag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, body);
    console.log(`saved ${file} (${body.length} bytes)`);
    res.end('ok');
  });
}

for (const host of hosts) {
  http.createServer(handler).listen(port, host, () => console.log(`diag collector on http://${host}:${port}`));
}
