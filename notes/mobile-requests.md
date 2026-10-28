# Mobile / touch — notes & requests for the other modules

Touch support lives in `src/core/touch.js` (+ `touch.css`). Desktop is unchanged: `ctx.touch.enabled`
is `false` there and every `ctx.touch.*` call is a no-op, so you can call it unconditionally.

## What exists (core)
* `ctx.device = { touch, phone, tablet, desktop, ios, android, standalone }`;
  CSS hooks `body[data-touch="1"]`, `body[data-device="phone"|"tablet"|"desktop"]`.
  Test on a desktop with `?touch=1` (`?device=phone|tablet` to force the size class).
* Safe-area tokens on `:root`: `--sat --sar --sab --sal` (0 on desktop).
* Space kept free for the touch controls (use in your CSS): `--touch-top` (Chat/Menu bar, top-right),
  `--touch-bl` (joystick area, bottom-left), `--touch-br` (button cluster, bottom-right). The core already
  moves the HUD slots: top-right slot below the bar, bottom-left / bottom-right slots above the controls,
  all slots inside the safe areas; on phones every slot widget is drawn at `zoom: 0.8`.
* Input (additive): `input.pressVirtual(code)` / `releaseVirtual(code)` / `tapVirtual(code)` (virtual keys
  with real pressed/released edges), `input.addLook(dx, dy)` (like mouse-look), `input.addWheel(n)`,
  `input.virtual.moveX/moveY` (analog stick, read by `moveVector()` and `axis(neg, pos, 'moveX'|'moveY')`).
  `input.pointerLockDisabled` is true on touch devices.
* Prompts (`ui.prompt.show`) are tappable on touch and mirrored by the cyan action button
  (tap = press, hold = hold the prompt's key) — nothing to do for E/F prompts.

## Layout API — please register your own layout
```js
ctx.touch?.setLayout(name, {
  joystick: 'analog' | 'keys' | false,  // analog = input.virtual.moveX/moveY; keys = W/A/S/D virtual keys (8-way)
  look: true,          // one-finger drag = input.lookX/lookY (+ pinch = input.wheel unless zoom: false)
  zoom: true,
  jump: false,         // the default Jump button (Space, held)
  action: true,        // the contextual prompt button
  sprint: 'ShiftLeft', // key held while the stick is pushed to the rim (false = none)
  buttons: [{ id, label: { en, nl }, icon, code, hold, key, onPress, onTap, when, accent, main }],
  menu: ['missions', 'map', 'market', 'chat', 'vehicle', 'build', 'garage', 'character', 'help', 'pause', 'fullscreen'],
  menuExtra: [{ id, label: { en, nl }, icon, code | run(ctx) }],
  when: () => bool,    // makes it an overlay layout that wins while true (newest first)
});
```
`name` = a mode name (`'drive'`, `'space'`) or any overlay name with `when` (e.g. `'build'`).
Buttons: `hold: true` keeps the key down while touched, otherwise it is a tap (pressed this frame,
released next frame); `key: true` dispatches a synthetic KeyboardEvent instead (for window keydown
listeners); `when` hides the button while false; `main: true` puts it in the big corner slot.

Built-in defaults until you register yours (`src/core/touch.js` `_defaults()`):
* `drive`: keys stick (W/S throttle, A/D steer), Brake (Space, car) / Up (Space) + Down (C) (VTOL/ship),
  Boost (Shift), Exit (F), Space (L, ship). Rim of the stick = Shift (boost).
* `space`: keys stick (W/S thrust, A/D roll), drag = steer (lookX/lookY), Fire (Mouse0 held), Boost,
  Missile (F), Land (L); prompts (scan/dock E) via the action button.
* `build` overlay (`ctx.build.active` in explore): analog stick, Place (Mouse0 tap), Rotate (R),
  Next (Tab), Remove (X), Done (B).

## Requests
* **vehicles**: `drive.js` reads `input.axis('back', 'forward')` without the virtual axis — pass
  `'moveY'` / `'moveX'` (and register `joystick: 'analog'`) for analog throttle/steering on touch.
  Hide the bottom-right vehicle key hints on `body[data-touch="1"]`; keep the bottom-center vehicle HUD
  narrower than `100vw - 2 × 190px` on phones (joystick left, buttons right).
* **build**: the resources panel (top-right) is large on phones — consider a compact variant for
  `body[data-device="phone"]` (e.g. icons + numbers in one row). Hide the build key hints on touch; make the
  category/piece strip tappable (it already sits bottom-center between the stick and the buttons).
* **space**: on phones the bottom-right systems panel (Laser/Shield/Boost) has no room above the button
  cluster next to the radar — move it (bottom-center / top-center) or hide it on `body[data-device="phone"]`.
  The space speed panel (bottom-left) is raised above the joystick by the core slot rule.
* **audio**: unlock already happens on touchend/click (iOS); `wiring.js` skips touch pointer events for
  hover sounds — good.
