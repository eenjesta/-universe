# platform-server progress

Owner: server/platform/** (PLATFORM.md §10). Resume from the first unchecked item.

## Done
- [x] errors.js (bilingual error catalogue), http.js (bounded event-based JSON bodies, origin/CORS, client IP, bearer)
- [x] filter.js (en+nl word list, leet A/B variants, diacritics/homoglyphs, spaced + stretched letters, PII mask, checkUsername)
- [x] validate.js (accounts, thumbnails, experience format: 5000 parts / 2 MB, finite numbers, sanitised + filtered strings, extras kept)
- [x] ratelimit.js, crypto.js (scrypt, `ous_` session tokens, sha256 token hashes, ids)
- [x] store/json.js (atomic debounced collections + per-file ordered blobs), store/pg.js (tagged static SQL, schema under advisory lock), store/common.js, store/index.js
- [x] flagship.js, api.js (all routes), index.js (createPlatform: handle / resolveToken / setPresence / close, init retry)
- [x] smoke test: register → me → create → publish → list (flagship first) → resolveToken (JSON store)

- [x] dev.js runner (+ STATIC_DIR, --demo seed), fake-pg.js, testkit.js
- [x] tests passing: auth (18), friends (14), experiences (20), validate (10) — json + pg-fake
- [x] perf: validation 5000 parts ~65-100 ms under load 40 (was 190-360), async validator yields (max gap 14 ms), filter fast path

- [x] tests: filter (6), ratelimit/origin/routing (8), store conformance json + pg-fake + persistence + pg specifics (16), dev runner (1) → 93/93 green
- [x] env fallbacks (TRUST_PROXY / ALLOWED_ORIGINS / --local) matching server/config.js; fixed `process` shadowing in createPlatform
- [x] integration: server/app.js already mounts the platform; verified on :8095 (register → friends → WS hello.auth → in-game presence, playing count, clean SIGTERM)
- [x] flagship description updated for PLATFORM.md §11 (safe hub + infinite survival planet)
- [x] notes/platform-server-requests.md (mount line, server requests: per-account save via guestTokenHash, under-13 chat, guest presence; integrator: vite /api proxy, npm script)

## Status: DONE (v1). Possible follow-ups: moderation endpoints for reports, account deletion, parental unlock of restrictions, password re-hash on cost change.

## Notes
- The scratchpad is SHARED with other engineers: use only scratchpad/platform-server/ (I deleted a pre-existing prof/ dir and may have overwritten smoke.mjs/bench.mjs/bench2.mjs there early on).
- Tool input turns `\uXXXX` text into raw characters: write escapes via python chr(92) (validate.js CONTROL_ML/LINE_SEP, filter.js DIACRITICS fixed).
- No Postgres on this machine → pg store tested with fake pool; real run: TEST_DATABASE_URL=postgres://… node --test server/platform/store.test.js
