# platform-client → requests & integration notes

Module: `src/platform/**` (ctx.platform + Home, PLATFORM.md §10) and the title routing in
`src/shell/title/**` (Play → Home, signed-in user in the Play sub-line). Tests: `node --test src/platform/`.

## ctx.platform (for other modules)

```js
ctx.platform.available            // true (fallback: false → Play goes straight into the world)
ctx.platform.online               // the /api answered (false: Home works offline with the flagship + local drafts)
ctx.platform.user                 // { id, username, displayName, birthYear, under13, restricted: { chat, friends }, guestLinked } | null
ctx.platform.token / .guest       // account session token ('ous_…', localStorage 'o-universe-account') / not signed in
ctx.platform.login(username, password) · register({ username, password, birthYear }) · logout() · refresh()
ctx.platform.api(path, { method, body, query, auth, timeout })   // '/api/…' or '/…'; throws PlatformError { code, status, data }
ctx.platform.errorText(err)       // bilingual message for any PlatformError (server errors carry en + nl)
ctx.platform.friends              // { list, incoming, outgoing, online, loaded, refresh(), request(username), accept(id), remove(id) }
ctx.platform.experiences          // { list(sort, q), get(id), mine(), like(id, on), play(id), remove(id) }
ctx.platform.openHome({ tab })    // works from any mode (goes to the title mode with { home: true } first)
ctx.platform.openExperience(id | experience)   // fetches the published version → ctx.studio.play(…, { from: 'home' })
ctx.platform.showExperience(id | experience)   // the experience page (like / report / play / edit)
ctx.platform.report({ kind, targetId, reason, details })
ctx.platform.signIn('signin' | 'register' | 'save')   // opens the dialog → Promise<user | null>
```
Events: `platform:ready {online, user}`, `platform:status {online}`, `platform:user {user, reason}`,
`platform:login {user, registered, linkedGuest}`, `platform:logout {reason, linkedGuest}`, `platform:friends`, `platform:home {open}`.
URL hooks: `?home` (Home at boot), `?api=<http origin>` (API elsewhere, e.g. `?api=http://127.0.0.1:8095`),
`?mockapi` (dev: in-page mock API), `?offline` (no network), `?nosave` (session in memory only).

## Requests

### shell (src/shell/menu/pauseMenu.js) — "Home" entry in the pause menu
When `ctx.platform?.available`, please add a nav item next to "Quit to title":
```js
{ id: 'home', icon: 'home', label: { en: 'Home', nl: 'Home' } }
// _select: case 'home': this.close({ keepPaused: true }); ctx.platform.openHome(); break;
```
`openHome()` handles the mode switch itself (title mode + Home on top, the world keeps running behind it).

### net (src/net) — re-hello on sign in / out: DONE (net 03:40, `reauth` on platform:login/logout). Thanks!

### net (src/net) — NEW: start a fresh guest after signing out of an account that linked this device's guest token
`platform:logout` now carries `{ reason, linkedGuest }`. `linkedGuest: true` = the account was created here with
"Save your progress", so the device's guest token (`NetClient.token` / `memToken` / localStorage
'o-universe-net-token') is now the ACCOUNT's save: server/world.js resumes `getPlayerByToken(sha256(token))` for a
HELLO without `auth`, i.e. after sign-out the next person on this device would keep playing the account's save as a
"guest" (and the welcome's `you.token` re-stores the token that platform removed from localStorage).
Please, in `reauth` on `platform:logout` with `linkedGuest`: `client.token = null; writeToken(null)` (memory + storage)
before `client.reconnect('auth')`, so the server issues a new guest token. (Plain sign-outs without a linked
guest token can keep the device's own guest save.)

### server (server/world.js) — optional defence in depth for the same case
A HELLO without `auth` whose guest token hash equals an account's `guestTokenHash` could get a fresh guest
instead of that save (needs a platform lookup `userByGuestHash`, so only if cheap).

### server / net — 401 from the signed-out probe: DONE on our side
`refresh()` uses `GET /api/status` (optional auth, always 200) instead of `/api/me`, so a signed-out page logs
no 401. Remaining console lines are only Chromium's network log for deliberate wrong input (wrong password 401,
taken name 409, friend-request 403/404/409) — expected HTTP semantics, no JS errors.

### integrator
- `vite.config.js`: proxy `/api` like `/ws` (same request as platform-server):
  `'/api': { target: process.env.API_TARGET || 'http://127.0.0.1:8080', changeOrigin: false }` —
  until then the dev server (:5199) shows Home in offline mode (that is the designed fallback).
- Nothing else: no new dependencies; the manifest entry `platform` already points at `src/platform/index.js`.
