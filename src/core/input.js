/**
 * Keyboard / mouse input with per-frame edge detection, action mapping,
 * pointer lock and "blockers" (modals, text fields) that suspend gameplay input.
 *
 * Codes are KeyboardEvent.code values ('KeyW', 'Space', 'ShiftLeft', 'Digit1'…)
 * plus pseudo codes for mouse buttons pressed on the 3D canvas: 'Mouse0' (left),
 * 'Mouse1' (middle), 'Mouse2' (right).
 *
 * Gameplay code uses the filtered queries (down/pressed/released/action*), which
 * all return false while `gameEnabled` is false. UI code that must work while a
 * modal is open (e.g. Escape to close it) uses rawDown/rawPressed.
 *
 * Touch / on-screen controls (src/core/touch.js) feed the same queries through
 * `virtual`: pressVirtual/releaseVirtual/tapVirtual(code) hold a key with real
 * pressed/released edges, addLook(dx, dy) adds a look delta like mouse-look
 * (× sensitivity, invertY), addWheel(n) zooms, virtual.moveX/moveY is the analog
 * stick (read by moveVector() and axis(…, 'moveX'|'moveY')).
 */

export const ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  vehicle: ['KeyF'],
  garage: ['KeyG'],
  build: ['KeyB'],
  rotate: ['KeyR'],
  remove: ['KeyX', 'Mouse2'],
  place: ['Mouse0'],
  cycle: ['Tab'],
  chat: ['Enter', 'KeyT'],
  journal: ['KeyJ'],
  map: ['KeyM'],
  character: ['KeyC'],
  market: ['KeyK'],
  help: ['KeyH', 'F1'],
  pause: ['Escape', 'KeyP'],
  // vehicles / flight
  up: ['Space'],
  down: ['KeyC', 'ControlLeft'],
  boost: ['ShiftLeft', 'ShiftRight'],
  brake: ['Space'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  scan: ['KeyE'],
  launch: ['KeyL'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  slot6: ['Digit6'],
  slot7: ['Digit7'],
  inventory: ['KeyI'],
  reload: ['KeyR'],
  dodge: ['KeyQ'],
  camera: ['KeyV'],
};

/** Keys whose browser default (scrolling, focus moves) we suppress during play. */
const PREVENT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'F1',
]);

const isTextTarget = (el) =>
  !!el &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export class Input {
  constructor(canvas, events) {
    this.canvas = canvas;
    this.events = events;
    this.keys = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this.blockers = new Set();
    this.mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, dx: 0, dy: 0, wheel: 0, overCanvas: false };
    this.lookX = 0; // per-frame look delta (pixels × sensitivity), only while locked or drag-looking
    this.lookY = 0;
    this.sensitivity = 1;
    this.invertY = false;
    this.wantsPointerLock = false; // set by modes that use mouse-look
    this.locked = false;
    this._dragLook = false;
    /** Touch / on-screen controls can write here; actions & axes include them. */
    this.virtual = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, buttons: new Set() };
    /** Touch devices never grab the pointer (set by core/touch.js). */
    this.pointerLockDisabled = false;
    this._tapRelease = new Set(); // virtual taps released after the next frame
    // Sticky aim for trackpads (two-finger click = right click can't be held while clicking):
    // a QUICK right click latches 'Mouse2' (aim) down until the next right click; holding it
    // still works as before. Allowed only while aimLatchWhen() is true (set by the game).
    this.aimLatch = false;
    this.aimLatchWhen = null;
    this._aimDownAt = 0;
    this._bind();
  }

  // ---------------------------------------------------------------- state
  get textFocus() {
    return isTextTarget(document.activeElement);
  }

  /** True when gameplay may read input (no modal / blocker / focused text field). */
  get gameEnabled() {
    return this.blockers.size === 0 && !this.textFocus;
  }

  /** Adds/removes a named blocker. While any blocker exists gameplay input is off and pointer lock is released. */
  block(reason, on = true) {
    if (on) {
      this.blockers.add(reason);
      this.exitPointerLock();
      this.keys.clear();
      this._endAimLatch();
    } else {
      this.blockers.delete(reason);
    }
  }

  // --------------------------------------------------------------- queries
  down(code) {
    return this.gameEnabled && (this.keys.has(code) || this.virtual.buttons.has(code));
  }
  pressed(code) {
    return this.gameEnabled && this._pressed.has(code);
  }
  released(code) {
    return this.gameEnabled && this._released.has(code);
  }
  rawDown(code) {
    return this.keys.has(code);
  }
  rawPressed(code) {
    return this._pressed.has(code);
  }

  action(name) {
    const codes = ACTIONS[name];
    return !!codes && codes.some((c) => this.down(c));
  }
  actionPressed(name) {
    const codes = ACTIONS[name];
    return !!codes && codes.some((c) => this.pressed(c));
  }
  actionReleased(name) {
    const codes = ACTIONS[name];
    return !!codes && codes.some((c) => this.released(c));
  }

  /** -1..1 from two actions, plus a virtual axis if given. */
  axis(negative, positive, virtualAxis = null) {
    let v = (this.action(positive) ? 1 : 0) - (this.action(negative) ? 1 : 0);
    if (virtualAxis && this.gameEnabled) v += this.virtual[virtualAxis] || 0;
    return Math.max(-1, Math.min(1, v));
  }

  /** Movement vector on the XZ plane in "input space": x = strafe right, y = forward. */
  moveVector() {
    return { x: this.axis('left', 'right', 'moveX'), y: this.axis('back', 'forward', 'moveY') };
  }

  /** Accumulated mouse wheel delta this frame (positive = scroll down / zoom out). */
  get wheel() {
    return this.gameEnabled ? this.mouse.wheel : 0;
  }

  // ---------------------------------------------------------- pointer lock
  requestPointerLock() {
    if (this.pointerLockDisabled || !this.gameEnabled || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* not allowed (e.g. headless) — drag-look still works */
    }
  }
  exitPointerLock() {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch {
        /* ignore */
      }
    }
  }

  // ------------------------------------------------------ virtual input
  /**
   * Holds a virtual key (touch / on-screen button) until releaseVirtual(code).
   * Gameplay sees it like a real key: down(), plus a pressed() edge on the
   * next frame. Emits 'input:key' {code, virtual: true} like a key press.
   */
  pressVirtual(code) {
    const v = this.virtual.buttons;
    this._tapRelease.delete(code);
    if (v.has(code)) return;
    if (!this.keys.has(code)) this._pressed.add(code);
    v.add(code);
    this.events?.emit('input:key', { code, key: '', virtual: true });
  }

  /** Releases a virtual key (released() edge on the next frame). */
  releaseVirtual(code) {
    const v = this.virtual.buttons;
    if (!v.has(code)) return;
    v.delete(code);
    if (!this.keys.has(code)) this._released.add(code);
  }

  /** A short virtual key press: pressed now, released after the next frame. */
  tapVirtual(code) {
    this.pressVirtual(code);
    this._tapRelease.add(code);
  }

  /** Releases every virtual key and zeroes the virtual stick. */
  releaseAllVirtual() {
    for (const c of [...this.virtual.buttons]) this.releaseVirtual(c);
    this._tapRelease.clear();
    this.virtual.moveX = 0;
    this.virtual.moveY = 0;
  }

  /**
   * Adds a look delta in mouse pixels (touch drag): applied like mouse-look
   * (× sensitivity, invertY) to this frame's lookX/lookY; the raw delta is
   * also summed in virtual.lookX/lookY (reset every frame).
   */
  addLook(dx, dy) {
    if (!this.gameEnabled) return;
    this.virtual.lookX += dx;
    this.virtual.lookY += dy;
    this.lookX += dx * this.sensitivity;
    this.lookY += dy * this.sensitivity * (this.invertY ? -1 : 1);
  }

  /** Adds zoom in wheel notches (positive = zoom out), e.g. from a pinch. */
  addWheel(notches) {
    if (Number.isFinite(notches)) this.mouse.wheel += notches;
  }

  // ------------------------------------------------------------- per frame
  /** Called by the loop after every frame. */
  endFrame() {
    if (this.aimLatch && !(this.aimLatchWhen?.() ?? false)) this.releaseAimLatch();
    this._pressed.clear();
    this._released.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.virtual.lookX = 0;
    this.virtual.lookY = 0;
    if (this._tapRelease.size) {
      for (const c of this._tapRelease) this.releaseVirtual(c);
      this._tapRelease.clear();
    }
  }

  // ---------------------------------------------------------------- events
  _setDown(code) {
    if (!this.keys.has(code)) this._pressed.add(code);
    this.keys.add(code);
  }
  _setUp(code) {
    if (this.keys.has(code)) this._released.add(code);
    this.keys.delete(code);
  }

  /** Ends a latched aim (e.g. when holstering); Mouse2 reads as released. */
  releaseAimLatch() {
    if (!this.aimLatch) return;
    this._endAimLatch();
    this._setUp('Mouse2');
  }

  _endAimLatch() {
    if (!this.aimLatch) return;
    this.aimLatch = false;
    this.events?.emit('input:aimLatch', { on: false });
  }

  _bind() {
    const c = this.canvas;

    window.addEventListener('keydown', (e) => {
      if (isTextTarget(e.target)) return;
      if (PREVENT.has(e.code) && this.blockers.size === 0) e.preventDefault();
      if (e.repeat) return;
      this._setDown(e.code);
      this.events?.emit('input:key', { code: e.code, key: e.key });
    });
    window.addEventListener('keyup', (e) => {
      this._setUp(e.code);
    });
    window.addEventListener('blur', () => {
      for (const k of this.keys) this._released.add(k);
      this.keys.clear();
      this._endAimLatch();
      this._dragLook = false;
    });

    c.addEventListener('mousedown', (e) => {
      c.focus({ preventScroll: true });
      const code = `Mouse${e.button}`;
      if (e.button === 2) this._aimDownAt = performance.now();
      this._setDown(code);
      if (this.wantsPointerLock && !this.locked && this.gameEnabled && !this.pointerLockDisabled) {
        // First click only grabs the mouse; don't treat it as a game click.
        this.requestPointerLock();
        this._pressed.delete(code);
      }
      if (!this.locked) this._dragLook = true;
    });
    window.addEventListener('mouseup', (e) => {
      this._dragLook = false;
      if (e.button === 2) {
        if (this.aimLatch) {
          // any right click ends a latched aim
          this._endAimLatch();
        } else if (this.keys.has('Mouse2') && performance.now() - this._aimDownAt < 280 && this.gameEnabled && (this.aimLatchWhen?.() ?? false)) {
          // quick click (trackpad two-finger click) → keep aiming until the next right click
          this.aimLatch = true;
          this.events?.emit('input:aimLatch', { on: true });
          return;
        }
      }
      this._setUp(`Mouse${e.button}`);
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      const m = this.mouse;
      m.x = e.clientX;
      m.y = e.clientY;
      m.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      m.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
      m.overCanvas = e.target === c;
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      m.dx += mx;
      m.dy += my;
      if ((this.locked || this._dragLook) && this.gameEnabled) {
        this.lookX += mx * this.sensitivity;
        this.lookY += my * this.sensitivity * (this.invertY ? -1 : 1);
      }
    });

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.mouse.wheel += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) / 120;
      },
      { passive: false },
    );

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === c;
      this.events?.emit('input:pointerlock', { locked: this.locked });
      if (was && !this.locked && this.wantsPointerLock && this.blockers.size === 0) {
        // The user pressed Esc (browser releases the lock without a keydown).
        this.events?.emit('input:lockLost');
      }
    });
  }
}
