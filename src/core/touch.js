/**
 * Touch devices (phones and tablets): device detection, graphics defaults,
 * the on-screen controls layer and mobile hygiene. Desktop never builds any
 * of this — installTouch() returns an inert API when ctx.device.touch is false.
 *
 *   ctx.device = { touch, phone, tablet, desktop, ios, android, standalone }
 *     touch  = coarse pointer / touch points without a fine pointer (iOS + Android always)
 *     phone  = touch device whose shortest side < 600 CSS px, tablet = other touch devices
 *     URL: ?touch=1 | ?touch=0 (force on / off), ?device=phone|tablet
 *     CSS: body[data-touch="1"][data-device="phone"|"tablet"|"desktop"]
 *
 * Controls (layer #touch-ui between the HUD and the screens; the drag surface
 * is the canvas itself, so HUD widgets keep their own taps):
 *   left ~40 %    floating joystick → input.virtual.moveX/moveY (analog) or W/A/S/D
 *                 virtual keys ('keys' layouts); pushed to the rim = sprint (ShiftLeft)
 *   elsewhere     drag = look (input.addLook: × sensitivity, invertY), pinch = zoom (input.addWheel)
 *   bottom-right  Jump (Space) + the action button of the visible prompt (E, F…: tap = press,
 *                 hold = hold) + the layout's buttons; prompts themselves are tappable too
 *   top-right     Chat (+ unread badge) and Menu → sheet: Missions · Map · Character ·
 *                 Marketplace · Chat · Build · Vehicle · Garage · Help · Pause · Full screen
 * Hidden in title / customize, while a modal or screen is open, while typing and
 * during mode transitions. Pointer lock is never requested. Phones in portrait
 * get a "Rotate your device" overlay during gameplay (menus stay usable).
 *
 * Layout API (other modules: vehicles, build, space …):
 *   ctx.touch.setLayout('drive', {
 *     joystick: 'keys',        // 'analog' | true (= analog: virtual.moveX/moveY) | 'keys' (W/A/S/D) | false
 *     look: true,              // drag to look + pinch zoom (zoom: false to disable the pinch)
 *     jump: false,             // the default Jump button (Space, held while touched)
 *     action: true,            // contextual prompt button (slot left of the main button)
 *     sprint: 'ShiftLeft',     // key held while the stick is pushed to the rim (false = none)
 *     buttons: [{ id: 'boost', label: { en: 'Boost', nl: 'Boost' }, icon: 'boost', code: 'ShiftLeft', hold: true }],
 *     menu: ['missions', 'map', 'vehicle', 'chat', 'help', 'pause'],   // optional subset of the sheet
 *     when: () => bool,        // optional: an overlay layout that wins while it returns true
 *   });
 *   ctx.touch.setLayout('drive', null);   // remove (back to the default)
 * Button: { id, label: string | {en, nl}, icon, code, hold (key down while touched; default:
 *   a tap = pressed now, released next frame), key (dispatch a synthetic KeyboardEvent instead),
 *   onPress(ctx) / onTap(ctx) (custom handlers), when: () => bool (shown while true),
 *   accent: 'cyan' | 'gold' | 'red', main: true (prefer the big corner slot) }
 * Also: ctx.touch.enabled, .device, .layout (active name), .refresh(), .openMenu(), .closeMenu(),
 *   .hold(code)/.release(code)/.tap(code) (ref-counted virtual keys), .key(code) (synthetic key),
 *   .toggleFullscreen(), .canFullscreen
 */
import './touch.css';
import { t } from './i18n.js';
import { icon, registerIcons } from '../ui/icons.js';

const PHONE_MAX_SIDE = 600; // CSS px, shortest screen side
const STICK_ZONE = 0.4; // left fraction of the screen that starts the joystick
const HIDDEN_MODES = new Set(['boot', 'title', 'customize']);
const ROTATE_MODES = new Set(['explore', 'drive', 'space']);

const isText = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const on = (v) => !(v === '0' || v === 'false' || v === 'off' || v === false);
function mq(query) {
  try {
    return !!window.matchMedia?.(query)?.matches;
  } catch {
    return false;
  }
}

registerIcons({
  'touch-jump': '<path d="m6.5 12.5 5.5-5.5 5.5 5.5"/><path d="m6.5 18 5.5-5.5 5.5 5.5" opacity=".5"/>',
  'touch-menu': '<path d="M4.5 7h15M4.5 12h15M4.5 17h9.5"/>',
  'touch-fullscreen': '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  'touch-fullscreen-exit': '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  'touch-garage': '<path d="M3.5 10.5 12 4.5l8.5 6V20h-17Z"/><path d="M7 20v-6.5h10V20M7 16h10M7 18.2h10"/>',
  'touch-up': '<path d="m6 14.5 6-6 6 6"/>',
  'touch-down': '<path d="m6 9.5 6 6 6-6"/>',
  'touch-land': '<path d="M12 4v10.5M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  'touch-exit': '<path d="M10 4.5H5.5v15H10"/><path d="m14 8 4 4-4 4M18 12H9"/>',
  'touch-brake': '<circle cx="12" cy="12" r="5"/><path d="M5.4 6.6a8.5 8.5 0 0 0 0 10.8M18.6 6.6a8.5 8.5 0 0 1 0 10.8"/>',
  'touch-next': '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  'touch-place': '<path d="M12 5v14M5 12h14"/><path d="M4 4h3M4 4v3M20 4h-3M20 4v3M4 20h3M4 20v-3M20 20h-3M20 20v-3" opacity=".6"/>',
  'touch-stick': '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/>',
  'touch-sprint': '<circle cx="12" cy="12" r="8.5"/><circle cx="16.6" cy="7.4" r="2.8"/><path d="m8 16 4.4-4.4" opacity=".55"/>',
  'touch-drag': '<circle cx="12" cy="12" r="2.6"/><path d="M3.5 12h5.4M15.1 12h5.4M6.2 9.3 3.5 12l2.7 2.7M17.8 9.3l2.7 2.7-2.7 2.7"/>',
  'touch-pinch': '<circle cx="8.4" cy="15.6" r="2.2"/><circle cx="15.6" cy="8.4" r="2.2"/><path d="M3.5 20.5 6.6 17.4M20.5 3.5l-3.1 3.1M3.5 17v3.5H7M20.5 7V3.5H17"/>',
});

// ------------------------------------------------------------------ device
/** Detects the kind of device. `params` = parsed URL query (?touch, ?device). */
export function detectDevice(params = {}) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  const touchPoints = nav.maxTouchPoints || 0;
  // iPadOS Safari reports a Mac user agent: recognise it by its touch points
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const android = /Android/i.test(ua);
  const coarse = mq('(pointer: coarse)');
  const anyFine = mq('(any-pointer: fine)');
  let touch = ios || android || ((coarse || touchPoints > 0) && !anyFine);
  const forced = params.touch !== undefined && params.touch !== null;
  if (forced) touch = on(params.touch);
  const W = window.innerWidth || 1;
  const H = window.innerHeight || 1;
  // real devices: the screen's shortest side (stable while rotating / typing);
  // a forced ?touch=1 on a desktop uses the window size instead
  const sw = (forced ? 0 : Math.min(window.screen?.width || 0, window.screen?.height || 0)) || Math.min(W, H);
  let phone = touch && sw < PHONE_MAX_SIDE;
  if (params.device === 'phone' || params.device === 'tablet') {
    touch = true;
    phone = params.device === 'phone';
  }
  const standalone = mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || nav.standalone === true;
  return { touch, phone, tablet: touch && !phone, desktop: !touch, ios, android, standalone };
}

/** body[data-touch][data-device] (+ data-ios / data-standalone) and, on touch devices, page hygiene. */
export function applyDevice(device) {
  const b = document.body;
  b.dataset.touch = device.touch ? '1' : '0';
  b.dataset.device = device.touch ? (device.phone ? 'phone' : 'tablet') : 'desktop';
  if (!device.touch) return;
  if (device.ios) b.dataset.ios = '1';
  if (device.standalone) b.dataset.standalone = '1';
  document.documentElement.classList.add('is-touch');
  const stop = (e) => e.preventDefault();
  // no page zoom: iOS ignores user-scalable=no, so block its gesture events and two-finger moves
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  // no long-press menus (Android) outside text fields
  window.addEventListener('contextmenu', (e) => {
    if (!isText(e.target)) e.preventDefault();
  });
  // iOS may leave the page scrolled after the on-screen keyboard closes
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isText(document.activeElement) && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
    }, 80);
  });
}

/**
 * Graphics defaults for touch devices (null on desktop): the preset used until
 * the player picks one in the settings, per-preset patches (pixel-ratio caps —
 * 0.75 is too blurry on a phone) and URL defaults (phones: painted title
 * cards instead of live thumbnails). Applied by game.js through the engine.
 */
export function deviceProfile(device) {
  if (!device?.touch) return null;
  if (device.phone) {
    return {
      quality: 'low',
      presets: { low: { pixelRatio: 1.1 }, medium: { pixelRatio: 1.25 }, high: { pixelRatio: 1.5 } },
      params: { thumbs: '0' },
    };
  }
  return {
    quality: 'medium',
    presets: { low: { pixelRatio: 1 }, medium: { pixelRatio: 1.25 }, high: { pixelRatio: 1.5 } },
    params: {},
  };
}

// ---------------------------------------------------------------- helpers
/** Prompt key label ('E', 'F', '1', 'Space') → KeyboardEvent.code. */
export function keyCodeOf(label) {
  const s = String(label ?? '').trim();
  if (/^[A-Za-z]$/.test(s)) return `Key${s.toUpperCase()}`;
  if (/^[0-9]$/.test(s)) return `Digit${s}`;
  if (/^(Key|Digit|Mouse|Arrow|Shift|Control|Numpad)/.test(s)) return s;
  const named = { space: 'Space', spatie: 'Space', enter: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', shift: 'ShiftLeft' };
  return named[s.toLowerCase()] || 'KeyE';
}

function keyName(code) {
  if (code === 'Escape' || code === 'Enter' || code === 'Tab') return code;
  if (code === 'Space') return ' ';
  return code.replace(/^Key/, '').replace(/^Digit/, '').toLowerCase();
}

/** Dispatches a synthetic keydown (+ keyup after `ms`) on window, like a real key press. */
export function sendKey(code, ms = 90) {
  const key = keyName(code);
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
  if (ms >= 0) setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), ms);
}

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function canFullscreen(device) {
  const el = document.documentElement;
  return !device.standalone && !!(el.requestFullscreen || el.webkitRequestFullscreen) && document.fullscreenEnabled !== false;
}
/** Enters / leaves full screen (call from a tap); locks landscape where allowed. */
export function toggleFullscreen() {
  const d = document;
  try {
    if (fsElement()) {
      (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
      return;
    }
    const el = d.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    const p = req?.call(el, { navigationUI: 'hide' });
    const lock = () => {
      try {
        screen.orientation?.lock?.('landscape')?.catch?.(() => {});
      } catch {
        /* not allowed here */
      }
    };
    if (p?.then) p.then(lock).catch(() => {});
    else setTimeout(lock, 300);
  } catch (err) {
    console.warn('[touch] full screen failed', err);
  }
}

// ------------------------------------------------------------------- text
const TXT = {
  menu: { en: 'Menu', nl: 'Menu' },
  chat: { en: 'Chat', nl: 'Chat' },
  jump: { en: 'Jump', nl: 'Springen' },
  close: { en: 'Close', nl: 'Sluiten' },
  fullscreen: { en: 'Full screen', nl: 'Volledig scherm' },
  fullscreenOff: { en: 'Exit full screen', nl: 'Scherm verkleinen' },
  rotate: { en: 'Rotate your device', nl: 'Draai je toestel' },
  rotateSub: { en: 'Ø Universe is played in landscape.', nl: 'Ø Universe speel je liggend.' },
  homeTip: {
    en: 'Tip: tap Share → “Add to Home Screen” to play Ø Universe full screen.',
    nl: 'Tip: tik op Deel → “Zet op beginscherm” om Ø Universe schermvullend te spelen.',
  },
};

const LOGO_SVG =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="21" fill="none" stroke="currentColor" stroke-width="2.4"/><line x1="10" y1="54" x2="54" y2="10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const PHONE_SVG =
  '<svg viewBox="0 0 120 120" aria-hidden="true"><g class="touch-rotate-device"><rect x="38" y="14" width="44" height="92" rx="9" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M54 22h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="60" cy="96" r="3" fill="currentColor"/></g><path class="touch-rotate-arrow" d="M100 64a40 40 0 0 0-26-37.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="touch-rotate-arrow" d="m70 21.5 5 5-6.5 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ------------------------------------------------------------- installers
/** Installs the touch layer (touch devices) and returns ctx.touch (inert on desktop). */
export function installTouch(ctx) {
  const device = ctx.device || detectDevice(ctx.params);
  if (!device.touch) {
    const noop = () => {};
    return {
      enabled: false,
      device,
      layout: null,
      canFullscreen: false,
      setLayout: noop,
      getLayout: () => null,
      refresh: noop,
      openMenu: noop,
      closeMenu: noop,
      hold: noop,
      release: noop,
      tap: noop,
      key: noop,
      toggleFullscreen: noop,
    };
  }
  return new TouchControls(ctx, device).api;
}

// Slot centres of the bottom-right cluster, in units of the button pitch,
// relative to the main (corner) button: left, up, diagonal, then an outer ring.
const SLOTS = [
  [0, 0],
  [-1.12, 0.1],
  [0.08, -1.12],
  [-0.9, -0.9],
  [-2.18, 0.2],
  [0.16, -2.18],
  [-1.92, -1.0],
  [-1.0, -1.92],
];

class TouchControls {
  constructor(ctx, device) {
    this.ctx = ctx;
    this.device = device;
    this.input = ctx.input;
    this.input.pointerLockDisabled = true;
    this.input.exitPointerLock();
    this.lookScale = device.phone ? 1.75 : 1.3; // touch px → mouse px (a swipe across the screen ≈ a half turn)
    this.pinchScale = 1 / 70; // wheel notches per px of finger spread
    this.canFs = canFullscreen(device);
    this.layouts = new Map();
    this.overlays = []; // names of layouts with a `when` predicate (newest last)
    this.layoutName = null;
    this.layout = null;
    this.visible = false;
    this.surface = 'off'; // 'game' (stick + look) | 'look' (customize studio) | 'off'
    this.rotating = false;
    this.stick = null; // { id, ox, oy, x, y }
    this.looks = new Map(); // touch id → { x, y }
    this.pinchD = 0;
    this.sprinting = false;
    this.stickKeys = new Set();
    this.held = new Map(); // code → holders (ref-counted virtual keys)
    this.btnTouches = new Map(); // touch id | 'mouse' → button element
    this.buttons = new Map(); // id → { def, el }
    this.unread = 0;
    this._frame = 0;
    this._act = { text: null, hold: null, p: -1, code: null };
    this.m = { W: 1, H: 1, sl: 0, sr: 0, st: 0, sb: 0, R: 52, pitch: 74, main: 66, size: 54 };

    this._build();
    this._measure();
    this._bindSurface();
    this._bindButtons();
    this._bindMisc();
    this._defaults();
    ctx.loop.add('touch-ui', () => this.update(), { order: 97, pausable: false });
    this.api = this._makeApi();
  }

  // --------------------------------------------------------------- DOM
  _build() {
    const h = this.ctx.ui.h;
    const app = document.getElementById('app') || document.body;
    this.probe = h('div', { class: 'touch-safe-probe', 'aria-hidden': 'true' });
    this.knob = h('div', { class: 'touch-stick-knob', html: icon('emblem', 18) });
    this.stickEl = h('div', { class: 'touch-stick', 'aria-hidden': 'true' }, h('div', { class: 'touch-stick-ring' }), this.knob);
    this.pad = h('div', { class: 'touch-pad' });
    this.actCap = h('span', { class: 'touch-btn-cap touch-act-cap' });
    this.actBtn = h(
      'button',
      { class: 'touch-btn touch-btn-act', type: 'button', hidden: true, dataset: { id: 'action' }, 'aria-label': 'Action' },
      h('span', { class: 'touch-btn-icon', html: icon('hand', 26) }),
      this.actCap,
    );
    this.badge = h('span', { class: 'touch-badge', hidden: true });
    this.chatBtn = h(
      'button',
      { class: 'touch-btn touch-btn-top touch-btn-chat', type: 'button', dataset: { id: 'chat' }, 'aria-label': t(TXT.chat) },
      h('span', { class: 'touch-btn-icon', html: icon('chat', 21) }),
      this.badge,
    );
    this.menuBtn = h(
      'button',
      { class: 'touch-btn touch-btn-top touch-btn-menu', type: 'button', dataset: { id: 'menu' }, 'aria-label': t(TXT.menu) },
      h('span', { class: 'touch-btn-icon', html: icon('touch-menu', 22) }),
    );
    this.top = h('div', { class: 'touch-top' }, this.chatBtn, this.menuBtn);
    this.root = h('div', { class: 'touch-ui', hidden: true }, this.stickEl, this.pad, this.top);
    this.rotateEl = h(
      'div',
      { class: 'touch-rotate', hidden: true, role: 'alert' },
      h('div', { class: 'touch-rotate-logo' }, h('span', { html: LOGO_SVG }), h('span', { class: 'touch-rotate-word', text: 'UNIVERSE' })),
      h('div', { class: 'touch-rotate-art', html: PHONE_SVG }),
      h('div', { class: 'touch-rotate-title', text: t(TXT.rotate) }),
      h('div', { class: 'touch-rotate-sub', text: t(TXT.rotateSub) }),
    );
    this.fsBtn = h(
      'button',
      {
        class: 'touch-btn touch-btn-top touch-fs',
        type: 'button',
        hidden: true,
        'aria-label': t(TXT.fullscreen),
        html: icon('touch-fullscreen', 21),
        onclick: () => toggleFullscreen(),
      },
    );
    app.append(this.probe, this.root, this.fsBtn, this.rotateEl);
  }

  _measure() {
    const m = this.m;
    m.W = Math.max(1, window.innerWidth);
    m.H = Math.max(1, window.innerHeight);
    try {
      const cs = getComputedStyle(this.probe);
      m.st = parseFloat(cs.paddingTop) || 0;
      m.sr = parseFloat(cs.paddingRight) || 0;
      m.sb = parseFloat(cs.paddingBottom) || 0;
      m.sl = parseFloat(cs.paddingLeft) || 0;
    } catch {
      /* keep the last values */
    }
    const short = Math.min(m.W, m.H);
    const phone = this.device.phone || short < 520;
    m.R = phone ? 50 : 62; // joystick radius
    m.main = phone ? 64 : 72; // corner button (56–72 px glass buttons)
    m.size = phone ? 56 : 60; // other buttons
    m.pitch = phone ? 74 : 84;
    this.root.style.setProperty('--tr', `${m.R}px`);
    this.root.style.setProperty('--tmain', `${m.main}px`);
    this.root.style.setProperty('--tsize', `${m.size}px`);
    this._placeStickRest();
    this._placeButtons();
  }

  _placeStickRest() {
    const m = this.m;
    m.restX = m.sl + 26 + m.R;
    m.restY = m.H - m.sb - 22 - m.R;
    if (!this.stick) {
      this.stickEl.style.transform = `translate3d(${m.restX}px, ${m.restY}px, 0)`;
      this.knob.style.transform = 'translate3d(0, 0, 0)';
    }
  }

  // ------------------------------------------------------------- surface
  _bindSurface() {
    const c = this.ctx.input.canvas || document.getElementById('gl');
    c.addEventListener('touchstart', (e) => this._onStart(e), { passive: false });
    c.addEventListener('touchmove', (e) => this._onMove(e), { passive: false });
    c.addEventListener('touchend', (e) => this._onEnd(e), { passive: false });
    c.addEventListener('touchcancel', (e) => this._onEnd(e), { passive: false });
  }

  _onStart(e) {
    // a tap in the world closes the on-screen keyboard (chat)
    const ae = document.activeElement;
    if (isText(ae)) ae.blur();
    e.preventDefault(); // no mouse emulation, no gestures, no double-tap zoom
    if (this.surface === 'off') return;
    const L = this.layout || {};
    const game = this.surface === 'game';
    for (const tch of e.changedTouches) {
      const x = tch.clientX;
      const y = tch.clientY;
      if (game && L.joystick && !this.stick && x < this.m.W * STICK_ZONE) this._stickStart(tch.identifier, x, y);
      else if (!game || L.look !== false) this.looks.set(tch.identifier, { x, y });
    }
    if (this.looks.size >= 2) this.pinchD = this._pinchDist();
  }

  _onMove(e) {
    if (!this.stick && !this.looks.size) return;
    e.preventDefault();
    let dx = 0;
    let dy = 0;
    let moved = false;
    for (const tch of e.changedTouches) {
      if (this.stick && tch.identifier === this.stick.id) {
        this._stickMove(tch.clientX, tch.clientY);
        continue;
      }
      const l = this.looks.get(tch.identifier);
      if (!l) continue;
      dx += tch.clientX - l.x;
      dy += tch.clientY - l.y;
      l.x = tch.clientX;
      l.y = tch.clientY;
      moved = true;
    }
    if (!moved) return;
    if (this.looks.size >= 2) {
      const d = this._pinchDist();
      const zoom = this.surface === 'look' || (this.layout?.zoom !== false && this.ctx.cameraRig?.zoomEnabled !== false);
      if (zoom && this.pinchD > 0) this.input.addWheel(-(d - this.pinchD) * this.pinchScale);
      this.pinchD = d;
    } else {
      // the customize studio turns the model with lookX: plain finger pixels feel right there
      const k = this.surface === 'look' ? 1 : this.lookScale;
      this.input.addLook(dx * k, dy * k);
    }
  }

  _onEnd(e) {
    for (const tch of e.changedTouches) {
      if (this.stick && tch.identifier === this.stick.id) this._stickEnd();
      this.looks.delete(tch.identifier);
    }
    this.pinchD = this.looks.size >= 2 ? this._pinchDist() : 0;
  }

  _pinchDist() {
    const it = this.looks.values();
    const a = it.next().value;
    const b = it.next().value;
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  // -------------------------------------------------------------- joystick
  _stickStart(id, x, y) {
    const m = this.m;
    const ox = clamp(x, m.sl + m.R + 6, m.W * 0.55);
    const oy = clamp(y, m.st + m.R + 6, m.H - m.sb - m.R - 4);
    this.stick = { id, ox, oy, x, y };
    this.stickEl.classList.add('is-active');
    this._stickMove(x, y);
  }

  _stickMove(x, y) {
    const s = this.stick;
    if (!s) return;
    const R = this.m.R;
    s.x = x;
    s.y = y;
    let dx = x - s.ox;
    let dy = y - s.oy;
    let len = Math.hypot(dx, dy);
    // the base trails the thumb when it overshoots, so reversing has no dead travel
    const maxLen = R * 1.25;
    if (len > maxLen) {
      const k = (len - maxLen) / len;
      s.ox += dx * k;
      s.oy += dy * k;
      dx = x - s.ox;
      dy = y - s.oy;
      len = maxLen;
    }
    const nx = len > 1e-3 ? dx / len : 0;
    const ny = len > 1e-3 ? dy / len : 0;
    const mag = Math.min(1, len / R);
    const DZ = 0.12;
    const amt = mag < DZ ? 0 : (mag - DZ) / (1 - DZ);
    // pushed to the rim = sprint (with hysteresis)
    const sprint = this.layout?.sprint !== false && amt > 0 && (this.sprinting ? len > R * 0.84 : len > R * 0.97);
    this._setStick(nx * amt, -ny * amt, sprint);
    const kl = Math.min(len, R);
    this.stickEl.style.transform = `translate3d(${s.ox}px, ${s.oy}px, 0)`;
    this.knob.style.transform = `translate3d(${nx * kl}px, ${ny * kl}px, 0)`;
    this.stickEl.classList.toggle('is-sprint', sprint);
  }

  _stickEnd() {
    this.stick = null;
    this._setStick(0, 0, false);
    this.stickEl.classList.remove('is-active', 'is-sprint');
    this._placeStickRest();
  }

  _setStick(mx, my, sprint) {
    const input = this.input;
    const L = this.layout || {};
    if (L.joystick === 'keys') {
      input.virtual.moveX = 0;
      input.virtual.moveY = 0;
      this._stickKeys(mx, my);
    } else {
      input.virtual.moveX = mx;
      input.virtual.moveY = my;
      this._stickKeys(0, 0);
    }
    if (sprint !== this.sprinting) {
      this.sprinting = sprint;
      const code = typeof L.sprint === 'string' ? L.sprint : 'ShiftLeft';
      this._sprintCode = sprint ? code : this._sprintCode;
      if (sprint) this.hold(code);
      else this.release(this._sprintCode || code);
    }
  }

  /** 'keys' joysticks: 8-way W/A/S/D virtual keys. */
  _stickKeys(mx, my) {
    const T = 0.38;
    const want = [];
    if (my > T) want.push('KeyW');
    if (my < -T) want.push('KeyS');
    if (mx > T) want.push('KeyD');
    if (mx < -T) want.push('KeyA');
    for (const c of [...this.stickKeys]) {
      if (!want.includes(c)) {
        this.stickKeys.delete(c);
        this.release(c);
      }
    }
    for (const c of want) {
      if (!this.stickKeys.has(c)) {
        this.stickKeys.add(c);
        this.hold(c);
      }
    }
  }

  // ----------------------------------------------------------- virtual keys
  hold(code) {
    if (!code) return;
    const n = this.held.get(code) || 0;
    this.held.set(code, n + 1);
    if (n === 0) this.input.pressVirtual(code);
  }

  release(code) {
    const n = this.held.get(code) || 0;
    if (n <= 1) {
      this.held.delete(code);
      if (n === 1) this.input.releaseVirtual(code);
    } else this.held.set(code, n - 1);
  }

  tap(code) {
    if (code && !this.held.has(code)) this.input.tapVirtual(code);
  }

  /** Lets go of everything: stick, looks, buttons, virtual keys. */
  _resetSurface() {
    if (this.stick) this._stickEnd();
    this.looks.clear();
    this.pinchD = 0;
    for (const id of [...this.btnTouches.keys()]) this._btnUp(id, true);
    for (const code of [...this.held.keys()]) {
      this.held.delete(code);
      this.input.releaseVirtual(code);
    }
    this.stickKeys.clear();
    this.sprinting = false;
    this.input.virtual.moveX = 0;
    this.input.virtual.moveY = 0;
  }

  // --------------------------------------------------------------- buttons
  _bindButtons() {
    const down = (e) => {
      const btn = e.target.closest?.('.touch-btn');
      if (!btn || btn.disabled || btn.classList.contains('touch-fs')) return;
      e.preventDefault();
      for (const tch of e.changedTouches) this._btnDown(btn, tch.identifier);
    };
    const up = (e) => {
      for (const tch of e.changedTouches) this._btnUp(tch.identifier, e.type === 'touchcancel');
    };
    this.root.addEventListener('touchstart', down, { passive: false });
    this.root.addEventListener('touchend', up);
    this.root.addEventListener('touchcancel', up);
    // a mouse / trackpad on a touch device (iPad + keyboard, ?touch=1 on a desktop)
    this.root.addEventListener('mousedown', (e) => {
      const btn = e.target.closest?.('.touch-btn');
      if (!btn || e.button !== 0) return;
      e.preventDefault();
      this._btnDown(btn, 'mouse');
    });
    window.addEventListener('mouseup', () => this._btnUp('mouse'));
    // floating interaction prompts are tappable: they press their key
    const hud = this.ctx.ui.layers.hud;
    hud.addEventListener(
      'touchstart',
      (e) => {
        const p = e.target.closest?.('.prompt');
        if (!p) return;
        e.preventDefault();
        for (const tch of e.changedTouches) this._btnDown(p, tch.identifier);
      },
      { passive: false },
    );
    const promptUp = (e) => {
      for (const tch of e.changedTouches) if (this.btnTouches.get(tch.identifier)?.classList.contains('prompt')) this._btnUp(tch.identifier);
    };
    hud.addEventListener('touchend', promptUp);
    hud.addEventListener('touchcancel', promptUp);
  }

  _btnDown(el, id) {
    if (this.btnTouches.has(id)) return;
    this.btnTouches.set(id, el);
    el.classList.add('is-down');
    if (el.classList.contains('prompt')) {
      el._code = keyCodeOf(el.dataset.key);
      this.hold(el._code);
      return;
    }
    const rec = this.buttons.get(el.dataset.id);
    const def = rec?.def;
    if (el === this.actBtn) {
      el._code = this._act.code || 'KeyE';
      this.hold(el._code);
      return;
    }
    if (!def) return; // menu / chat: on release
    if (def.onPress) {
      try {
        def.onPress(this.ctx);
      } catch (err) {
        console.error('[touch] button failed', def.id, err);
      }
    } else if (def.key) sendKey(def.code, -1);
    else if (def.hold) this.hold(def.code);
    else this.tap(def.code);
  }

  _btnUp(id, cancel = false) {
    const el = this.btnTouches.get(id);
    if (!el) return;
    this.btnTouches.delete(id);
    for (const other of this.btnTouches.values()) if (other === el) return; // another finger still holds it
    el.classList.remove('is-down');
    if (el.classList.contains('prompt') || el === this.actBtn) {
      this.release(el._code);
      return;
    }
    const kind = el.dataset.id;
    if (kind === 'menu') {
      if (!cancel) this.openMenu();
      return;
    }
    if (kind === 'chat') {
      if (!cancel) this._openChat();
      return;
    }
    const def = this.buttons.get(kind)?.def;
    if (!def) return;
    if (def.onTap && !cancel) {
      try {
        def.onTap(this.ctx);
      } catch (err) {
        console.error('[touch] button failed', def.id, err);
      }
    } else if (def.key) {
      const key = keyName(def.code);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: def.code, key, bubbles: true }));
    } else if (def.hold) this.release(def.code);
  }

  // --------------------------------------------------------------- layouts
  _defaults() {
    const ctx = this.ctx;
    const vType = () => ctx.vehicles?.current?.type || ctx.vehicles?.current?.kind || null;
    const air = () => {
      const ty = vType();
      return ty === 'vtol' || ty === 'ship';
    };
    // fallback for every mode without its own layout: joystick (keys = like a keyboard) + look + Menu
    this.layouts.set('default', { joystick: 'keys', look: true, jump: false, action: true, buttons: [] });
    this.layouts.set('explore', { joystick: 'analog', look: true, jump: true, action: true, buttons: [] });
    // vehicles (src/vehicles may replace this with its own setLayout('drive', …))
    this.layouts.set('drive', {
      joystick: 'keys',
      look: true,
      jump: false,
      action: true,
      buttons: [
        { id: 'brake', label: { en: 'Brake', nl: 'Rem' }, icon: 'touch-brake', code: 'Space', hold: true, main: true, when: () => !air() },
        { id: 'up', label: { en: 'Up', nl: 'Omhoog' }, icon: 'touch-up', code: 'Space', hold: true, main: true, when: air },
        { id: 'down', label: { en: 'Down', nl: 'Omlaag' }, icon: 'touch-down', code: 'KeyC', hold: true, when: air },
        { id: 'boost', label: { en: 'Boost', nl: 'Boost' }, icon: 'boost', code: 'ShiftLeft', hold: true, accent: 'gold' },
        { id: 'exit', label: { en: 'Exit', nl: 'Uitstappen' }, icon: 'touch-exit', code: 'KeyF' },
        { id: 'launch', label: { en: 'Space', nl: 'Ruimte' }, icon: 'rocket', code: 'KeyL', when: () => vType() === 'ship' },
      ],
      menu: ['missions', 'map', 'market', 'chat', 'vehicle', 'help', 'pause', 'fullscreen'],
    });
    // space flight (src/space may replace this): drag = steer, stick = throttle (W/S) + roll (A/D)
    this.layouts.set('space', {
      joystick: 'keys',
      look: true,
      zoom: false,
      jump: false,
      action: true,
      buttons: [
        { id: 'fire', label: { en: 'Fire', nl: 'Vuren' }, icon: 'target', code: 'Mouse0', hold: true, main: true, accent: 'red' },
        { id: 'boost', label: { en: 'Boost', nl: 'Boost' }, icon: 'boost', code: 'ShiftLeft', hold: true, accent: 'gold' },
        { id: 'missile', label: { en: 'Missile', nl: 'Raket' }, icon: 'rocket', code: 'KeyF' },
        { id: 'land', label: { en: 'Land', nl: 'Landen' }, icon: 'touch-land', code: 'KeyL' },
      ],
      menu: ['missions', 'help', 'pause', 'fullscreen'],
    });
    // build mode overlay (explore + ctx.build.active; src/build may replace this)
    this._setLayout('build', {
      when: () => !!ctx.build?.active && ctx.modes.is('explore'),
      joystick: 'analog',
      look: true,
      jump: false,
      action: false,
      buttons: [
        { id: 'place', label: { en: 'Place', nl: 'Plaatsen' }, icon: 'touch-place', code: 'Mouse0', main: true, accent: 'cyan' },
        { id: 'rotate', label: { en: 'Rotate', nl: 'Draaien' }, icon: 'rotate', code: 'KeyR' },
        { id: 'next', label: { en: 'Next', nl: 'Volgende' }, icon: 'touch-next', code: 'Tab' },
        { id: 'remove', label: { en: 'Remove', nl: 'Verwijderen' }, icon: 'trash', code: 'KeyX', accent: 'red' },
        { id: 'done', label: { en: 'Done', nl: 'Klaar' }, icon: 'check', code: 'KeyB' },
      ],
      menu: ['missions', 'map', 'build', 'chat', 'help', 'pause', 'fullscreen'],
    });
  }

  _setLayout(name, def) {
    this.overlays = this.overlays.filter((n) => n !== name);
    if (def == null) this.layouts.delete(name);
    else {
      this.layouts.set(name, def);
      if (typeof def.when === 'function') this.overlays.push(name);
    }
    this.layoutName = null; // re-apply on the next frame
  }

  _resolveLayout() {
    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const name = this.overlays[i];
      const L = this.layouts.get(name);
      try {
        if (L?.when?.()) return name;
      } catch {
        /* a broken predicate never wins */
      }
    }
    const mode = this.ctx.modes.name;
    const L = this.layouts.get(mode);
    return L && typeof L.when !== 'function' ? mode : 'default';
  }

  _norm(def) {
    const L = { ...(def || {}) };
    if (L.joystick === undefined || L.joystick === true) L.joystick = 'analog';
    if (L.look === undefined) L.look = true;
    if (L.action === undefined) L.action = true;
    L.buttons = Array.isArray(L.buttons) ? L.buttons.filter((b) => b && (b.code || b.onPress || b.onTap)) : [];
    return L;
  }

  _applyLayout(name) {
    for (const id of [...this.btnTouches.keys()]) this._btnUp(id, true);
    this.layoutName = name;
    const L = (this.layout = this._norm(this.layouts.get(name) || this.layouts.get('default')));
    if (this.stick) {
      if (!L.joystick) this._stickEnd();
      else {
        this._stickKeys(0, 0);
        this._stickMove(this.stick.x, this.stick.y);
      }
    }
    this.stickEl.hidden = !L.joystick;
    this.root.dataset.layout = name;
    // buttons
    this.buttons.clear();
    const h = this.ctx.ui.h;
    const defs = [];
    if (L.jump) defs.push({ id: 'jump', label: TXT.jump, icon: 'touch-jump', code: 'Space', hold: true, main: true, cap: false });
    for (const b of L.buttons) defs.push({ ...b, id: String(b.id || b.code) });
    this.pad.replaceChildren();
    for (const def of defs) {
      const el = h(
        'button',
        {
          class: `touch-btn touch-btn-pad${def.accent ? ` is-${def.accent}` : ''}`,
          type: 'button',
          dataset: { id: def.id },
          'aria-label': t(def.label || def.id),
        },
        h('span', { class: 'touch-btn-icon', html: icon(def.icon || 'circle', 24) }),
        def.cap === false ? null : h('span', { class: 'touch-btn-cap', text: t(def.label || '') }),
      );
      this.buttons.set(def.id, { def, el, shown: true });
      this.pad.appendChild(el);
    }
    this.pad.appendChild(this.actBtn);
    this._act.text = null;
    this._refreshButtons(true);
    // top bar
    const mode = this.ctx.modes.name;
    this.menuBtn.hidden = L.menu === false;
    const chatOk = !!this.ctx.chat?.open && (mode === 'explore' || mode === 'drive');
    this.chatBtn.hidden = L.chat === false || (L.chat !== true && !chatOk);
  }

  /** Evaluates `when` predicates and lays the visible buttons out in the cluster slots. */
  _refreshButtons(force = false) {
    let changed = force;
    for (const rec of this.buttons.values()) {
      let shown = true;
      try {
        shown = rec.def.when ? !!rec.def.when(this.ctx) : true;
      } catch {
        shown = false;
      }
      if (shown !== rec.shown) {
        rec.shown = shown;
        rec.el.hidden = !shown;
        if (!shown) for (const [id, el] of this.btnTouches) if (el === rec.el) this._btnUp(id, true);
        changed = true;
      }
    }
    if (changed) this._placeButtons();
  }

  _placeButtons() {
    if (!this.layout) return;
    const m = this.m;
    const vis = [...this.buttons.values()].filter((r) => r.shown);
    // the main (corner) slot: a `main` button, else the first one
    const mainIdx = Math.max(0, vis.findIndex((r) => r.def.main));
    const order = vis.length ? [vis[mainIdx], ...vis.filter((_, i) => i !== mainIdx)] : [];
    const free = SLOTS.map((_, i) => i).filter((i) => !(this.layout.action && i === 1));
    const cx0 = -m.main / 2;
    const cy0 = -m.main / 2;
    const put = (el, slot, size) => {
      const [ux, uy] = SLOTS[slot] || SLOTS[SLOTS.length - 1];
      const cx = cx0 + ux * m.pitch;
      const cy = cy0 + uy * m.pitch;
      el.style.setProperty('--x', `${Math.round(cx - size / 2)}px`);
      el.style.setProperty('--y', `${Math.round(cy - size / 2)}px`);
      el.style.setProperty('--s', `${size}px`);
    };
    order.forEach((r, i) => {
      const slot = free[i] ?? SLOTS.length - 1;
      r.el.classList.toggle('is-main', slot === 0);
      put(r.el, slot, slot === 0 ? m.main : m.size);
    });
    // the action button: left of the main button (or in the corner when the cluster is empty)
    put(this.actBtn, order.length ? 1 : 0, order.length ? Math.round(m.size * 1.08) : m.main);
  }

  /** The action button mirrors the visible prompt ("[E] Talk to Aria", hold E to scan…). */
  _syncAction() {
    const btn = this.actBtn;
    const items = this.ctx.ui.prompt?.items;
    let it = null;
    if (this.layout?.action !== false && items?.size) it = items.get('interact') || items.values().next().value;
    if (!it) {
      if (!btn.hidden) {
        for (const [id, el] of this.btnTouches) if (el === btn) this._btnUp(id, true);
        btn.hidden = true;
      }
      return;
    }
    const a = this._act;
    const code = keyCodeOf(it.key);
    if (btn.hidden) {
      btn.hidden = false;
      btn.classList.remove('is-new');
      void btn.offsetWidth;
      btn.classList.add('is-new');
    }
    if (a.code !== code) a.code = code;
    const text = typeof it.text === 'string' ? it.text : t(it.text || '');
    if (a.text !== text) {
      a.text = text;
      this.actCap.textContent = text;
      btn.setAttribute('aria-label', text);
    }
    const hold = !!it.hold;
    if (a.hold !== hold) {
      a.hold = hold;
      btn.classList.toggle('is-hold', hold);
    }
    if (hold) {
      const p = clamp(Number(it.progress) || 0, 0, 1);
      if (Math.abs(p - a.p) > 0.004) {
        a.p = p;
        btn.style.setProperty('--p', p.toFixed(3));
      }
    }
  }

  // ------------------------------------------------------------- per frame
  _screenOpen() {
    for (const el of this.ctx.ui.layers.screens.children) {
      const id = el.dataset.screen;
      if (id && !id.endsWith('-closing')) return true;
    }
    return false;
  }

  _checkRotate() {
    const ctx = this.ctx;
    let show = false;
    if (this.device.phone && this.m.H > this.m.W * 1.05) {
      show = ROTATE_MODES.has(ctx.modes.name) && !ctx.ui.isModalOpen() && !this._screenOpen() && !ctx.input.textFocus;
    }
    if (show !== this.rotating) {
      this.rotating = show;
      this.rotateEl.hidden = !show;
      ctx.input.block('touch:rotate', show);
      if (show) {
        this._resetSurface();
        try {
          screen.orientation?.lock?.('landscape')?.catch?.(() => {});
        } catch {
          /* only allowed in full screen */
        }
      }
    }
    return show;
  }

  update() {
    const ctx = this.ctx;
    this._frame++;
    const rotate = this._checkRotate();
    const mode = ctx.modes.name;
    const { ui, input } = ctx;
    const blocked = ui.isModalOpen() || input.blockers.size > 0 || input.textFocus || ctx.modes.transitioning;
    let surface = 'off';
    if (!rotate && !blocked) {
      if (!HIDDEN_MODES.has(mode) && !this._screenOpen()) surface = 'game';
      else if (mode === 'customize') surface = 'look';
    }
    if (surface !== this.surface) {
      this._resetSurface();
      this.surface = surface;
    }
    const show = surface === 'game';
    if (show !== this.visible) {
      this.visible = show;
      this.root.hidden = !show;
      document.body.classList.toggle('touch-controls-on', show);
    }
    // full-screen button on the title screen
    const fs = this.canFs && mode === 'title' && !blocked;
    if (this.fsBtn.hidden === fs) this.fsBtn.hidden = !fs;
    const fsActive = !!fsElement();
    if (this._fsWas !== fsActive) {
      this._fsWas = fsActive;
      this.fsBtn.innerHTML = icon(fsActive ? 'touch-fullscreen-exit' : 'touch-fullscreen', 21);
      this.fsBtn.setAttribute('aria-label', t(fsActive ? TXT.fullscreenOff : TXT.fullscreen));
    }
    if (!show) return;
    const name = this._resolveLayout();
    if (name !== this.layoutName) this._applyLayout(name);
    else if (this._frame % 12 === 0) this._refreshButtons();
    this._syncAction();
    if (this.unread && ctx.chat?.isOpen) this._setUnread(0);
  }

  // ------------------------------------------------------------- misc
  _bindMisc() {
    const ctx = this.ctx;
    const remeasure = () => {
      if (this.stick) this._stickEnd();
      this._measure();
    };
    window.addEventListener('resize', remeasure);
    window.addEventListener('orientationchange', () => setTimeout(remeasure, 120));
    window.addEventListener('blur', () => this._resetSurface());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._resetSurface();
    });
    document.addEventListener('fullscreenchange', () => setTimeout(remeasure, 60));
    document.addEventListener('webkitfullscreenchange', () => setTimeout(remeasure, 60));
    // the player picked a quality in the settings: keep it from now on (see deviceProfile)
    ctx.events.on('state:change', ({ path } = {}) => {
      if (path === 'settings.quality' && ctx.state.data.settings) ctx.state.data.settings.qualityPicked = true;
    });
    ctx.events.on('chat:message', (m) => {
      if (m?.self || ctx.chat?.isOpen || m?.kind === 'system') return;
      this._setUnread(this.unread + 1);
    });
    ctx.events.on('mode:change', () => (this.layoutName = null));
  }

  _setUnread(n) {
    this.unread = Math.max(0, Math.min(99, n));
    this.badge.hidden = this.unread === 0;
    if (this.unread) this.badge.textContent = this.unread > 9 ? '9+' : String(this.unread);
  }

  _openChat() {
    const chat = this.ctx.chat;
    if (!chat?.open) return;
    this._setUnread(0);
    chat.open(); // inside the tap: iOS only shows the keyboard for a focus() during a user gesture
  }

  // ------------------------------------------------------------------ menu
  _menuItems() {
    const ctx = this.ctx;
    const mode = ctx.modes.name;
    const inMode = (...m) => m.includes(mode);
    const hasBuild = typeof ctx.build?.toggle === 'function' || typeof ctx.build?.enter === 'function';
    const hasVehicles = Array.isArray(ctx.vehicles?.catalog) && ctx.vehicles.catalog.length > 0;
    const fsOn = !!fsElement();
    const items = [
      { id: 'missions', icon: 'quest', label: { en: 'Missions', nl: 'Missies' }, ok: inMode('explore', 'drive', 'space'), run: () => sendKey('KeyJ') },
      { id: 'map', icon: 'map', label: { en: 'Map', nl: 'Kaart' }, ok: inMode('explore', 'drive'), run: () => (ctx.shell?.openMap ? ctx.shell.openMap() : sendKey('KeyM')) },
      { id: 'character', icon: 'user', label: { en: 'Character', nl: 'Karakter' }, ok: inMode('explore') && ctx.modes.has('customize'), run: () => sendKey('KeyC') },
      { id: 'market', icon: 'cart', label: { en: 'Marketplace', nl: 'Marktplaats' }, ok: inMode('explore', 'drive') && !!ctx.economy, run: () => sendKey('KeyK') },
      { id: 'chat', icon: 'chat', label: { en: 'Chat', nl: 'Chat' }, ok: inMode('explore', 'drive') && !!ctx.chat?.open, run: () => this._openChat() },
      {
        id: 'build',
        icon: 'cube',
        label: ctx.build?.active ? { en: 'Stop building', nl: 'Stop bouwen' } : { en: 'Build', nl: 'Bouwen' },
        ok: inMode('explore') && hasBuild,
        run: () => sendKey('KeyB'),
      },
      {
        id: 'vehicle',
        icon: mode === 'drive' ? 'touch-exit' : 'car',
        label: mode === 'drive' ? { en: 'Exit vehicle', nl: 'Uitstappen' } : { en: 'Vehicle', nl: 'Voertuig' },
        ok: inMode('explore', 'drive') && hasVehicles,
        run: () => sendKey('KeyF'),
      },
      { id: 'garage', icon: 'touch-garage', label: { en: 'Garage', nl: 'Garage' }, ok: inMode('explore') && hasVehicles, run: () => sendKey('KeyG') },
      { id: 'help', icon: 'help', label: { en: 'Help', nl: 'Help' }, ok: true, run: () => (ctx.shell?.openHelp ? ctx.shell.openHelp() : sendKey('KeyH')) },
      { id: 'pause', icon: 'pause', label: { en: 'Pause', nl: 'Pauze' }, ok: true, run: () => (ctx.shell?.openPause ? ctx.shell.openPause() : sendKey('Escape')) },
      {
        id: 'fullscreen',
        icon: fsOn ? 'touch-fullscreen-exit' : 'touch-fullscreen',
        label: fsOn ? TXT.fullscreenOff : TXT.fullscreen,
        ok: this.canFs,
        run: () => toggleFullscreen(),
      },
    ];
    const L = this.layout || {};
    let out = items.filter((it) => it.ok);
    if (Array.isArray(L.menu)) out = out.filter((it) => L.menu.includes(it.id));
    for (const x of Array.isArray(L.menuExtra) ? L.menuExtra : []) {
      if (!x?.id) continue;
      out.push({ id: x.id, icon: x.icon || 'circle', label: x.label || x.id, run: () => (x.run ? x.run(ctx) : x.code && sendKey(x.code)) });
    }
    return out;
  }

  openMenu() {
    const ctx = this.ctx;
    const { ui } = ctx;
    if (ui.isModalOpen('touch-menu') || ui.isModalOpen()) return;
    const h = ui.h;
    const items = this._menuItems();
    const grid = h(
      'div',
      { class: 'touch-sheet-grid' },
      items.map((it) =>
        h(
          'button',
          {
            class: `touch-tile touch-tile-${it.id}`,
            type: 'button',
            dataset: { id: it.id },
            onclick: () => {
              ctx.audio?.play?.('ui.click');
              this.closeMenu();
              try {
                it.run();
              } catch (err) {
                console.error('[touch] menu action failed', it.id, err);
              }
            },
          },
          h('span', { class: 'touch-tile-icon', html: icon(it.icon, 26) }),
          h('span', { class: 'touch-tile-label', text: t(it.label) }),
        ),
      ),
    );
    const tip = this.device.ios && !this.device.standalone && !this.canFs ? h('p', { class: 'touch-sheet-tip', text: t(TXT.homeTip) }) : null;
    const el = h(
      'div',
      { class: 'touch-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': t(TXT.menu) },
      h(
        'header',
        { class: 'touch-sheet-head' },
        h('span', { class: 'touch-sheet-mark', html: LOGO_SVG }),
        h('span', { class: 'touch-sheet-title', text: t(TXT.menu) }),
        h('button', { class: 'modal-close touch-sheet-close', type: 'button', 'aria-label': t(TXT.close), html: icon('close', 22), onclick: () => this.closeMenu() }),
      ),
      grid,
      tip,
    );
    ui.openModal('touch-menu', el, { className: 'touch-sheet-wrap' });
    ctx.audio?.play?.('ui.open');
  }

  closeMenu() {
    this.ctx.ui.closeModal('touch-menu');
  }

  // ------------------------------------------------------------------- api
  _makeApi() {
    const self = this;
    return {
      enabled: true,
      device: this.device,
      get layout() {
        return self.layoutName;
      },
      get visible() {
        return self.visible;
      },
      canFullscreen: this.canFs,
      setLayout: (name, def) => self._setLayout(String(name), def),
      getLayout: (name) => self.layouts.get(name) || null,
      refresh: () => {
        self.layoutName = null;
      },
      openMenu: () => self.openMenu(),
      closeMenu: () => self.closeMenu(),
      hold: (code) => self.hold(code),
      release: (code) => self.release(code),
      tap: (code) => self.tap(code),
      key: (code, ms) => sendKey(code, ms),
      toggleFullscreen,
      /** Test hook: current stick / look state. */
      debugState: () => ({
        surface: self.surface,
        visible: self.visible,
        layout: self.layoutName,
        stick: self.stick ? { ...self.stick } : null,
        looks: self.looks.size,
        sprint: self.sprinting,
        held: [...self.held.keys()],
        move: { x: self.input.virtual.moveX, y: self.input.virtual.moveY },
        rotating: self.rotating,
      }),
    };
  }
}
