# platform-client — progress log

Owner: `src/platform/**`, `src/shell/title/**` (Play → Home, signed-in user), `notes/platform-client-*.md`.

## Plan
- [x] M1 `src/platform/` core: api client (/api, Bearer, offline detection, bilingual errors), session
      (localStorage `o-universe-account`, guest token `o-universe-net-token` on register), friends model,
      experiences model, events, `?mockapi` dev mock, `?api=` override.
- [x] M2 Home screen (showScreen 'platform-home' over the title world): top bar, hero (flagship SMP),
      rows (Your creations + Create new, Popular, New), search, player card, friends panel, phone tabs.
- [x] M3 Dialogs: sign in, create account / save progress (birth year age gate, privacy text),
      experience page (like/report/play/edit), report dialog, account menu, language.
- [x] M4 Title routing: Play → Home (title/titleScreen.js), `params.home` / `?home` in titleMode.js,
      signed-in user in the Play sub-line.
- [x] M5 Tests against the real platform API (server/platform), screenshots desktop + phone, build.
- [x] M6 Final shots (desktop 1280x720, phone 390x844 dpr 2 iOS) + review + polish + summary.

## Log
- (start) read PLATFORM.md §10, ARCHITECTURE.md, shell/title, core ui/modes/touch, characters portraits.
- (session 2, resume) M1–M4 code exists (index/api/home/dialogs/thumbs/icons/validate/dev/mock + title routing) but
  was never verified. TODO now: align normalizers with the real server shapes (ageGroup, friends status/experienceId,
  summary.version number, playing, i18n title, error {message,nl}, report details), use ctx.studio.drafts()/listLocal()
  (listDrafts doesn't exist), fix `style: {'--d'}` (ui.h uses Object.assign → custom props ignored), then tests,
  build, own server on :8096, screenshots.
- (s2) aligned with server/platform: ageGroup, friends {status,experienceId} (+ "In Ø Universe — SMP" + Join),
  summary.version/playing/i18n, bilingual server errors, like {like:on}, report details, /api/status probe
  (no 401 console error when signed out), ctx.studio.drafts()/listLocal()/playLocal(), cards a11y (no listitem
  on buttons), custom-prop delays via style strings. node --test src/platform/ → 6/6. Build OK.
- (s2) own server :8096 (STATIC_DIR=/tmp/build-platform-client, DATA_DIR=/tmp/data-platform-client); seed:
  scratchpad/platform-client/seed.mjs (accounts pc_tester / pc_kid / creators, password orbit-lantern-7; seeds
  from 127.0.0.20+ source IPs because register is limited to 5 per IP). Load avg 35–50: shots take minutes →
  functional checks via eval steps, few screenshots, --globalTimeout 1450000.
- notes/platform-client-requests.md written (shell pause-menu Home entry, net re-hello on login, vite /api proxy).
- (s2) VERIFIED on :8096 (desktop 960x540, eval-driven): title → Home (guest) → sign in (wrong pw message
  in 669 ms; correct → user, friends, incoming/outgoing, "Your creations" cloud draft) → experience page →
  like → unlike → like (5→6→5→6) → report (toast) → accept request → add-friend errors (under-13 403,
  unknown 404, duplicate 409, self) → sign out (account menu) → "Save your progress" (under-13 notice,
  field errors, name taken, new account) → hero Play → customize (new player). Phone 390x844: Home, Me,
  Save-progress dialog OK. Fixed: first-probe skeletons (no "offline" flash), entrance animation retired
  after 1.7 s (Friends tab was captured invisible), core .touch-fs hidden under Home (Full screen in Me),
  experience banner capped at 40vh, login()/register() without args open the dialogs (Studio calls
  ctx.platform.login()), Home posts /play itself (Studio contract), playLocal(id, {from:'home'}).
- NEXT: roundtrip (experience/studio → Home), phone friends+discover, landscape nl, offline (:5199).
- (s2, after the last entry) VERIFIED: roundtrip Home → experience → Leave → Home (plays 10 → 11) and Home → Create new →
  Studio start screen → Exit → Home ("My first world" in Your creations); phone Friends tab (in-game + Join, pending),
  Discover search "obby"; phone landscape 844x390 in Dutch (Home + experience page); offline on :5199
  (banner "Offline — sign-in unavailable", flagship + Create new, friends note).
- (s3, resume) load 0.2 → build OK (1.7 s), node --test src/platform/ 6/6, server :8096 (/api mounted by
  server/app.js; GET /api/status exists). 404 probe on :5199: no 404s any more (the 2 seen in s2 were transient,
  not /api: the dev server answers our Accept header with its HTML fallback = offline). Full desktop regression
  flow on :8096 passes again (flowA): wrong password message, sign in, like 6→5→6, report toast, accept request,
  add-friend errors (under-13 403 / unknown 404 / duplicate 409 / self), sign out, Save progress (age-gate note,
  field errors, taken name, new account), hero Play → customize (new player). debug.info().errors [].
  Known: Chromium logs non-2xx fetch answers (wrong password 401, taken 409, friend errors) as console
  errors — only after deliberately wrong input; normal flows log none.
- (s3) FINAL shots (0 page/console errors in both runs, debug.info().errors []):
  desktop 1280x720 — shots/platform-client/f00-title.png (poster title, "Signed in as @pc_tester · Level 1" under
  Play, medium quality), f01-home-desktop.png, f02-rows-desktop.png, f04-experience-desktop.png,
  f05-account-menu.png, f03-create-account.png; phone 390x844 dpr 2 (iOS emulation) — f11-phone-home.png,
  f12-phone-rows.png, f13-phone-experience.png, f14-phone-friends.png (in-game + "Playing <exp>" + Join + pending),
  f15-phone-me.png.
  Polish: hero title "Ø UNIVERSE — SMP" on one line on desktop (hero body 620 → 700 px); core toasts drop
  below Home's top bar while Home is open (they covered the search field); phone tab bar/rail opaque (no blur on
  phones → scrolled cards showed through); profile card shows the account name when signed in (the game server
  shows accounts under it; guests keep their character name).
  platform:logout now carries { reason, linkedGuest } + request to net (fresh guest token after signing out of
  an account that linked this device's guest save — net keeps NetClient.token in memory, so removing the
  localStorage key alone is not enough). Build OK, node tests 6/6, own server :8096 stopped.
## Status: DONE (v1). Open requests: shell pause-menu "Home" entry, net fresh guest on linked sign-out,
   vite /api proxy (integrator).
