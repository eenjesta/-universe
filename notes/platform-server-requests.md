# platform-server → requests & integration notes

Module: `server/platform/` (PLATFORM.md §10). Full API + options: header of `server/platform/index.js`.
Tests: `node --test server/platform/*.test.js` (93 tests, JSON store + Postgres store on a fake pool;
`TEST_DATABASE_URL=postgres://… node --test server/platform/` also runs them against a real Postgres).

## 1. Game server mount — ALREADY WIRED in `server/app.js` (verified end-to-end)

The exact one-line mount (for reference; app.js does the equivalent):

```js
const platform = createPlatform({ dataDir: config.dataDir, databaseUrl: config.databaseUrl, log: log.child({ mod: 'platform' }), allowedOrigins: config.allowedOrigins, allowLocalOrigins: config.local, trustProxy: config.trustProxy });
// http: if (platform.handle(req, res)) return;   ← before static files (any /api or /api/… path)
// hello: const account = await platform.resolveToken(m.auth)   ← async; null for unknown/expired/guest tokens
// join/leave: platform.setPresence(account.id, 'in-game') / platform.setPresence(account.id, 'offline')
// shutdown: await platform.close()   ← flushes the JSON store / ends the pg pool
```

Verified on :8095 with `node server/index.js --local`: "platform API mounted at /api" → register two
users → friend request/accept → WebSocket `hello { auth: <session token> }` → the friend sees
`status: 'in-game', experienceId: 'o-universe'`, the flagship listing shows `playing: 1` → after leave
`online` (recent API activity). Clean SIGTERM, platform JSON files flushed.

### Requests to the server engineer (server/**)

1. **Pass the proxy/origin options explicitly** (one line in app.js, see above). Without them the platform
   falls back to the same env semantics as `server/config.js` (`TRUST_PROXY`, default on unless
   `--local`/`LOCAL=1`; `ALLOWED_ORIGINS`), so it is already correct behind Railway — explicit is clearer.
2. **Per-account save (PLATFORM.md §11 "per-account save")**: `resolveToken()` returns
   `guestTokenHash` = sha256 hex of the guest token the player had when they registered (same hash as
   your `sha256()` in hub.js). In `hello`, when `m.token` is missing/unknown but the account resolves:
   ```js
   if (!rec && account?.guestTokenHash) rec = await store.getPlayerByToken(account.guestTokenHash);
   // then issue a fresh guest token for that record (your store needs e.g. addToken(playerId, sha256(newToken)))
   ```
   so a signed-in player gets their progress on any device. (Optionally key saves by `account.id` later.)
3. **Under-13 chat**: `account.restrictions.chat === true` for under-13 accounts (conservative from birth
   year). Please apply a restricted chat for them (e.g. no global chat / stricter filter / preset phrases).
4. Optional: `platform.setPresence('guest:' + s.id, 'in-game')` / `'offline'` for guests too, so the
   flagship's `playing` count on Home includes guests (friends lists only ever look up account ids).
5. `gameStore` is passed to createPlatform but not used (harmless).

## 2. Requests to the integrator (core files)

1. **vite.config.js** — proxy `/api` like `/ws`, so the Vite dev server (:5199) reaches the API:
   ```js
   '/api': { target: process.env.API_TARGET || 'http://127.0.0.1:8080', changeOrigin: false },
   ```
   (Loopback origins are accepted in `--local` mode and by the dev runner, so `changeOrigin: true` works too.)
2. **package.json** scripts (optional): `"platform": "node server/platform/dev.js --port 8095 --demo"`.
   `npm test` (`node --test shared/ server/`) already picks up `server/platform/*.test.js`.
3. Nothing else needed: no new dependencies (Node built-ins + the existing `pg`).

## 3. For platform-client / studio

- Dev runner without the game server: `node server/platform/dev.js --port 8095 --data /tmp/data-xyz --demo`
  (+ `--static <dir>` to serve a client build same-origin). `--demo` seeds `demo_builder` (3 published
  experiences) and `demo_friend` (friends), password `demo-password-1`.
- Session tokens start with `ous_`; send `Authorization: Bearer <token>`. Errors are always
  `{ error: { code, message (en), nl, field?, details? } }` → `t({ en: e.message, nl: e.nl })`.
- `summary.thumbnail` is a URL (`/api/experiences/:id/thumbnail?v=…`) usable as `<img src>`; send
  thumbnails as small JPEG/PNG/WebP data URLs (≤ 200 000 chars) in POST/PUT/publish `thumbnail`.
- The flagship listing (`id: 'o-universe'`, `kind: 'smp'`, `builtin: true`) comes first on page 1 and
  carries `i18n.title/description {en, nl}`; `GET /api/experiences/o-universe` has `version: null`.
- PUT accepts `{ data, title?, description?, thumbnail? }` or the experience document itself; it answers
  `filtered: true` (+ the cleaned `data`) when text was masked. Unknown part/settings keys are kept
  (sanitised), so Studio can add fields; extra per-part data is safest in `props`.
- Validation errors: 400 `invalid_experience` with `details: { path: 'parts[12].p[1]', problem }`;
  > 5000 parts → 400 (path `parts`), > 2 MB → 413 `too_large`.
- `POST /api/experiences/:id/play` counts once per player (or IP) per 10 min and marks the player
  "playing <id>" for friends for 15 min.
