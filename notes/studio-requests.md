# Ø Studio (src/studio) — notes & requests for other modules

## For platform-client (src/platform) — the ctx.studio API
```js
ctx.studio.available                     // true
ctx.studio.open(draftId?, { from })      // Ø Studio: local draft id ('d…'), a cloud experience id (owner, signed in),
                                         // or no id → start screen (templates Baseplate / Obby / Empty + drafts + "In your account")
ctx.studio.play(experience, { from, id, creator }) // experience = JSON object | JSON string | any API response that holds it
                                         // ({experience, version: {data}} / {data} / {draft: {data}} …); validated first → { ok, errors }
                                         // `id` (platform id) enables Report; the runtime POSTs /play itself only when from !== 'home'
                                         // (Home already counts it); `creator` shows "by <name>" under the title
ctx.studio.playLocal(id, { from })       // plays an experience published on this device (or else the draft) — for `local` items
ctx.studio.listLocal()                   // [{ id, title, published, pubUpdated, parts, thumbnail }] — for the Home "Mine" row when signed out
ctx.studio.drafts()                      // local drafts [{ id, title, updated, parts, cloudId, published }]
ctx.studio.createExperience('baseplate' | 'obby' | 'empty')
```
* **DONE (adopted by platform-client 2026-10-28) — local items on Home.** Items built from `ctx.studio.drafts()` (`local: true`, no `data`)
  currently go through `experiences.get(id)` on Play → 404 for a local draft id (`d…`). Please call
  `ctx.studio.playLocal(exp.localId || exp.id, { from: 'home' })` for `local` items without a `cloudId`
  (with a `cloudId`, play the cloud id as usual). `ctx.studio.open(id)` already accepts both kinds of id.
* `from: 'home'` makes Exit (Studio) / Leave (experience) call `ctx.platform.openHome()`. **Please make
  `openHome()` work from any mode** (studio / experience): switch to the title world and show Home. If the
  mode is still studio/experience afterwards, Studio falls back to `ctx.modes.go('title', { home: true })`.
* Events: `studio:published` {id, cloud, title} (refresh "Mine"), `studio:play` {title, test}.
* The runtime POSTs `/api/experiences/:id/play` when a published experience (with `id`) starts and offers
  "Report experience" (POST `/api/report {kind:'experience', targetId, reason}`) in its menu.
* Studio calls `ctx.platform.api(path, { method, body })` with `body` as a plain object and paths that
  start with `/api/…`; it reads `ctx.platform.user.username` and `ctx.platform.login()` (Publish dialog
  "Sign in" button, shown only when that function exists).

## For platform-server (server/platform) — what Studio sends / expects
* `POST /api/experiences` body `{ title, description, maxPlayers, data, thumbnail? }` → `{ experience: { id, … } }` (or `{ id }`).
* `PUT /api/experiences/:id` body `{ title, description, maxPlayers, data, thumbnail? }` (autosave after 6 s
  without edits while signed in, retried after 30 s on failure; thumbnail only on Ctrl+S / manual save).
* `POST /api/experiences/:id/publish` body `{ title, description, maxPlayers, data, thumbnail? }` (saves the draft
  and publishes in one request) or `{ thumbnail? }` right after a create. Verified end-to-end on :8097.
* `GET /api/experiences/:id?draft=1` (owner) → `{ experience, version, draft: { data } }` — Studio opens `draft.data`.
* `GET /api/users/:username/experiences` (owner sees drafts too) → items with `id, title, version|publishedAt,
  updatedAt, thumbRev` (thumbnail URL `/api/experiences/:id/thumbnail?rev=` is assumed when `thumbRev` is set).
* Thumbnails: JPEG data URLs, 480×270 at quality 0.8 (≈ 20–60 kB).
* `src/studio/format.js` is pure JS (no DOM/three) — `validate()` normalises the same format (it clamps
  instead of rejecting); feel free to import it for parity. Studio-only data lives in `part.props`:
  `behavior: 'kill'|'bounce'|'finish'`, `bounce` (m/s), `text`, `textColor`, `brightness`, `range`, `checkpoint`.
  Rotations `r` are degrees, Euler order 'YXZ'.

## For avatars / characters (src/characters)
* Request: a small public avatar factory, e.g. `ctx.characters.createAvatar(appearance, { lod }) →
  { object, update(dt, { speed, grounded, vy }), land(speed), dispose() }` for scenes outside the world.
  Until then the experience runtime imports `character.js` (Character), `batch.js` (CharacterBatch) and
  `material.js` (createCharacterMaterial, updateRimFromWorld) read-only, guarded by try/catch with a
  mannequin fallback — please keep those exports stable or tell me.

## For the integrator
* Nothing blocking. Studio registers modes `studio` + `experience` and touch layouts with the same names
  (`studio`: no joystick/look/menu — the editor handles its own pointer gestures; `experience`: analog stick,
  look, Jump, Reset). The shell pause menu / map / help don't open in these modes (not in GAME_MODES) — intended.
