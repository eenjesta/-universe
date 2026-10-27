# i18n — systems (src/systems/**) progress log

Goal: English by default, Dutch second (t({ en, nl }) from src/core/i18n.js).

Approach
- Data modules keep {en, nl}; resolved with t()/pick() when UI is built.
- Public APIs that other modules read stay strings (quest title/objective/marker
  label, item name/cat/desc via getters, lore title/tag/text via getters, event
  names) — resolved inside systems.
- Part of day: partOfDay(ctx) returns stable ids ('morning' | 'afternoon' |
  'evening' | 'night'); partOfDayText(ctx) gives the localized word; template
  variable {dagdeel} renamed to {daypart} ({dagdeel} kept as alias in fill vars).
- Chat intents: keywords match English AND Dutch; replies follow the active language.
- CSS content strings: English default + `:lang(nl)` override (html[lang] is set by i18n).
- Watch out for local variables named `t` shadowing the t() import (renamed where needed).

Files (status)
- [x] shared/util.js (zoneAtText, partOfDayText, resourceLabel/resourceWord, rewardText), progress.js, shared/rewards.js, notify/zones comments
- [x] quests/data.js (t() inside buildQuests, questTypeLabel), engine.js, tracker.js, journal.js
- [x] story/lore.js (getters), trees.js ({en,nl} data, resolved in dialogue.js), dialogue.js, party.js, scan.js, signal.js
- [x] chat/lines.js, chat.js, intents.js (verified: Dutch intents/replies identical to before)
- [x] economy/items.js (getters + it.text), market.js (thumbs.js: only numeric labels)
- [x] events/world-events.js (fx.js: no text)
- [x] css (content: strings)
- [x] tests (en + nl, shots/i18n/systems-*.png): HUD/tracker/notices, journal (all tabs), market (buy/sell/mine),
      dialogue, Starfall banner, ruins scan + (optional) CSS, party widget + party chat CSS, chat replies
      (verified by fast-forwarding loop.time — the loaded test machine ran ~0.03 game-s per real s),
      level/discovery/lore/quest-complete banners, purchase + reward toasts; __game.debug.info().errors = []
- [x] build passes (npx vite build --outDir /tmp/build-i18n-systems)
- [x] leftover-Dutch grep: only Dutch intent keywords (player input matching) and the :lang(nl) CSS overrides remain

DONE.
