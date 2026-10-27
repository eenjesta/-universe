# i18n — shell + core strings (progress log)

Goal: every player-facing string in src/shell/**, src/fallback/**, src/ui/**,
core strings (gfxpanel, diag, ui, input, interactions, modes) and index.html
bilingual via t({ en, nl }); English default, Dutch kept.

## Findings (read phase done)
- Shell is dynamically imported AFTER initLanguage → module-level t() would
  work there, but text is still resolved at build time (constructors/_build).
- core/*.js are statically imported BEFORE initLanguage → never call t() at
  module level in core; only inside functions.
- No module outside src/shell reads shell data/APIs (only lab.js imports
  TitleCamera). Shell reads ctx.quests.active.title + marker labels → wrap in
  t() (passes strings through, resolves {en,nl}) as a safety net.
- core/ui.js toast/prompt: wrap title/text in t() (safety net only).
- Naming: J = "Missions" (systems journal = "Missies & verhalen"), currency
  "Ø-credits" in both languages, British spelling (civilisation in layout.js).

## Files
- [x] src/shell/data.js            - [x] src/shell/util.js
- [x] src/shell/settings.js (+ Language setting in panels.js)
- [x] src/shell/menu/panels.js     - [x] src/shell/menu/pauseMenu.js
- [x] src/shell/menu/help.js       - [x] src/shell/map/worldMap.js
- [x] src/shell/hud/compass.js     - [x] src/shell/hud/minimap.js
- [x] src/shell/hud/keyHints.js    - [x] src/shell/hud/zoneLabel.js
- [x] src/shell/hud/debugOverlay.js - [x] src/shell/hud/screenMarkers.js
- [x] src/shell/title/titleScreen.js
- [x] src/fallback/shell.js
- [x] src/core/gfxpanel.js  - [x] src/core/diag.js  - [x] src/core/ui.js
- [x] index.html meta description
- (no strings: shell/index.js, icons.js, hudFrame, map image/bake/worker,
  title camera/thumbs/vignette, ui/icons.js, core input/interactions/modes)

## Done / verified
- All files above converted; also shell/index.js (wipeProgress keeps ?lang),
  comments with Dutch UI quotes translated, internal glyph tokens renamed
  (@muis/@klik/@rechts → @mouse/@click/@right).
- Language setting: Settings → "Language / Taal" group (first), "Game
  language" row, English | Nederlands segmented control →
  ctx.i18n.setLanguage(id, ctx.state). Verified end-to-end (saved setting →
  reload → Dutch; URL ?lang path → back to English).
- Screens checked en + nl (shots/i18n/shell-*.png): title, settings, about,
  HUD (compass N/NE/E… vs N/NO/O…, minimap, key hints, zone label), pause
  overview/controls/reset, world map (legend, compass rose, scale, travel
  tooltips), help, debug overlay + gfx panel (stray "null" fixed).
- No [object Object]/undefined, no errors from shell; build passes.
- Leftover-Dutch scan script: scratchpad dutchscan.py → only false positives.

## Status: COMPLETE
- Final shots: shots/i18n/shell-title-final-{en,nl}.png (1280x720, low).
- Build: npx vite build --outDir /tmp/build-i18n-shell --emptyOutDir → OK.
- Known (not mine): transient errors from other engineers' in-progress work
  during tests (systems RESOURCE_LABELS export once; Vite overlay from
  src/space/dev/lab.js → ../models.js; vehicles 'veh-traffic' shader error).
