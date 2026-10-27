# i18n — characters + landmarks + world (progress log)

Goal: English by default, Dutch second. Every player-facing string → `t({ en, nl })`.
Owner area: src/characters/**, src/landmarks/**, src/world/** (not layout.js).

## Inventory (done)
- characters/appearance.js — catalog labels/descs (hair, faces, beards, outfits, backpacks, eyewear)
- characters/creator.js — tabs, sections, chips, toggles, buttons, hint, title, toast, price hint (nl-NL), default name
- characters/index.js — default profile name 'Reiziger' (localise untouched default when created=false)
- characters/npc-roster.js — NAMED lines + CROWD_LINES
- characters/npcs.js — interaction label 'Praten', lines/crowd pick, say() robustness
- characters/labels.js — t() on name/text (robustness)
- landmarks/textures.js — holo 'market' (tabs + prices), 'nachtmarkt' (fit), signAspect helper
- landmarks/lookout.js — 'UITKIJKPOST' sign; landmarks/spaceport.js — 'RUIMTEHAVEN' sign
- landmarks/markers.js — labels already via ZONES getters (comment only)
- world/** — no player-facing text (dev lab strings → English)

## Files done
- characters/appearance.js, creator.js, index.js, npc-roster.js, npcs.js, labels.js
- landmarks/textures.js (fitFont, signAspect, market tabs/prices, NIGHT MARKET), lookout.js, spaceport.js, markers.js (comment)
- world/atmosphere/dev/lab.js (dev strings → English)

## Next
- DONE: browser tests en + nl (creator tabs/toast, plaza bubbles/tags/markers, sign textures), errors []
- DONE: build passes; Dutch sweep clean (only internal ids/Rng seeds + sign reference words remain)
- characters/dev/studio-lab.js: default name → localized default

## Status: COMPLETE
