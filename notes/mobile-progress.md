# Mobile / touch — progress log

Owner: mobile engineer (src/core/touch.js + touch.css, additive core changes, responsive CSS of
shell/systems/creator). Read this first when resuming.

## Plan / milestones
- [x] M0 tools/shot.mjs: --mobile (isMobile+hasTouch), --ua, touch steps (tap, touchDrag, touchStart/Move/End, pinch)
- [x] M1 core: ctx.device (+ ?touch=1/0), body[data-touch/device], engine device profile (pixel-ratio caps,
       phone low / tablet medium default), input virtual press/release + addLook, audio unlock on touchend/click,
       prompt data-key, index.html meta + manifest, base.css hygiene + safe areas
- [x] M2 src/core/touch.js + touch.css: joystick, look drag, pinch zoom, Jump/Interact/Menu, menu sheet, layouts API,
       rotate overlay, fullscreen
- [x] M3 responsive UI: title, HUD, chat icon, prompts, pause/settings, map (tap select, drag/pinch), journal,
       market, dialogue, help, creator
- [x] M4 manifest + icons (public/)
- [ ] M5 verification: iPhone landscape 844x390@3x, iPad 1180x820@2x, portrait rotate overlay, desktop unchanged,
       build check, errors []

## Notes
- scratchpad is shared with other engineers: use scratchpad/mobile/ for my batch files.

## Status (18:25)
- core done: detectDevice/applyDevice/deviceProfile/installTouch in src/core/touch.js (+ touch.css), input.js
  (pressVirtual/releaseVirtual/tapVirtual/releaseAllVirtual/addLook/addWheel, pointerLockDisabled), engine.js
  (4th ctor arg {presets}), audio.js (touchend/click unlock, 'interrupted'), ui.js (prompt dataset.key/channel,
  it.hold/it.progress), game.js wiring, index.html meta + manifest, base.css (--sat/--sar/--sab/--sal, touch slots)
- public/manifest.webmanifest + public/icons (192, 512, maskable 512, apple-touch 180) rendered with
  scratchpad/mobile/icons.mjs
- verified on iPhone 844x390@3x emulation: device phone/ios, quality low, PR 1.1, thumbs=0, joystick walks +
  sprints at the rim (gold ring), look drag (+0.68 rad / 150 px), Jump → player:jump, chat badge
- responsive CSS written (not yet screenshotted): title, pause/settings/help, map (+ pinch JS), journal, market,
  dialogue (+ close button JS), creator, chat (phone: hidden unless typing; tablet: passive log)
- touch help: TOUCH_ROWS group in shell/menu/panels.js, TOUCH_TIPS in help.js, chat placeholder on touch

## Testing tips
- SwiftShader + other engineers' browsers = very slow frames; CDP touch events wait for a frame. Use
  {"freeze":true} around touch steps, then {"freeze":false},{"frames":2} before a shot. Run batches with
  run_in_background (never `| tail` a long run: output is lost on timeout).
- shot.mjs steps added: tap, touchStart/Move/End, touchHold, touchDrag, pinch, tapSel, touchStartSel, clickSel

## Status (19:20)
- verified (iPhone 844x390, dpr 2): look drag, jump, pinch zoom (2.45 → 1.67), action button → Luna dialogue,
  tapping the floating prompt → dialogue, hold action button → rune scan:complete, menu sheet → journal / map
  (tap pin selects, legend + Fast travel) / market / pause (+ settings, controls with touch group) / chat
  (focus → panel at the top) / character (customize); errors [] (shots/mobile/t2_*, t3_*)
- portrait phone: rotate overlay + input blocker 'touch:rotate'; pause / map / dialogue usable in portrait
  (fixed: pause grid overflow, creator panel specificity; creator model centred via studio.camera.setViewOffset)
- desktop regression (1280x720): no touch layer, data-touch=0, PR 0.75 low preset unchanged, key hints /
  minimap as before; pixel diff vs baseline ≈ 1/255 mean (animation noise) — shots/mobile/after_desktop_*
- iPad 1180x820: tablet, medium, PR 1.25; title fine. Tablet thumbnails block SwiftShader for minutes → use
  &thumbs=0 in tablet tests.
- final runs started: b7 (iPhone @3x end-to-end), b6 (iPad @2x end-to-end + iPad portrait), b8 (portrait @3x)
- notes/mobile-requests.md written for vehicles / build / space / audio

## Final (20:25) — DONE
- iPhone 844x390@3x (b7/b8): title → Play → creator → Confirm → explore; joystick walk + rim sprint, look drag
  (+0.73 rad), Jump, action button → Luna dialogue, hold action → rune scan:complete, menu → missions / map /
  market / chat (+ tap world closes it); Aria auto-dialogue + close button; errors []. Shots: final_iphone_*.
- iPad 1180x820@2x (b6): tablet/medium/PR 1.25, title, creator, explore HUD (minimap top-left, passive chat log),
  walk/sprint/look/jump/dialogue OK; the run then hit the global timeout under machine load (menus on iPad
  were not re-shot; same code path as the phone, verified there). Shots: final_ipad_*.
- portrait 390x844@3x: rotate overlay, pause, title, creator (model centred via setViewOffset) — final_iphonep_*.
- desktop 1280x720 unchanged (after_desktop_* vs base_desktop_*: ≈1/255 mean pixel diff = animation noise).
- vite build OK. Screen markers clamp inside the central band on touch (screenMarkers.js).
- Open: build/space/vehicles should register their own layouts + compact HUD on phones (notes/mobile-requests.md).
