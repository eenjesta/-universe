/**
 * First-person mode (characters module): owns the camera VIEW of the local player.
 *
 *   V (input action 'camera'), the touch "View" button, the menu entry, or scrolling in past the
 *   closest 3P distance (scrolling out leaves) toggle third ↔ first person; the choice persists in
 *   state.settings.camera ('third' | 'first'). state.settings.fov (default 70) is the FP field of
 *   view (3P follows at half the change), state.settings.headBob (default true) the head bob.
 *   Emits 'camera:mode' { mode, fov } when the view changes.
 *
 * Pieces: the eye provider for ctx.cameraRig (eye height from the body's own vertical motion — stride
 * bob locked to the footsteps, landing squash, crouch, sitting, the dodge-roll duck — a neck pivot so
 * looking down moves the eyes over the chest, strafe roll, landing nod, swim at the surface, never
 * inside walls or under the ground), the body hiding (upper body discarded in the colour pass only:
 * the shadow stays whole, legs and feet stay visible when looking down), the death cam (third person
 * while dead), the view model (viewmodel.js: arms + weapon / tool) and the FP crosshair dot.
 *
 *   const fpc = createFirstPerson(ctx, { player, rig, material });
 *   fpc.handleInput()   // from the explore mode's update (after the rig): V toggles
 *   fpc.update(dt)      // loop order 28 (after combat 21: muzzle / socket of this frame)
 *   fpc.setView('first' | 'third') · fpc.toggle() · fpc.view · fpc.viewModel
 */
import { clamp, damp } from '../core/math.js';
import { t } from '../core/i18n.js';
import { registerIcons } from '../ui/icons.js';
import { createViewModel } from './viewmodel.js';
import { J } from './skeleton.js';
import * as THREE from 'three';

const DEFAULT_FOV = 70;
const sstep = (a, b, x) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};
/** Bones hidden in first person (upper body + head + arms; hips and legs stay). */
export const FP_HIDDEN_BONES = [J.spine, J.chest, J.neck, J.head, J.clavL, J.armL, J.foreL, J.handL, J.clavR, J.armR, J.foreR, J.handR, J.lids, J.pony1, J.pony2];

registerIcons({
  'chr-view': '<path d="M2.6 12s3.4-6.3 9.4-6.3S21.4 12 21.4 12s-3.4 6.3-9.4 6.3S2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="2.9"/>',
});

const TXT = {
  first: { en: 'First person', nl: 'Eerste persoon' },
  third: { en: 'Third person', nl: 'Derde persoon' },
  view: { en: 'View', nl: 'Beeld' },
  camera: { en: 'Camera view', nl: 'Camerabeeld' },
};

/** Normalised camera settings from state.settings (pure; tested). */
export function cameraSettings(settings = {}) {
  const fov = Number(settings.fov);
  return {
    view: settings.camera === 'first' ? 'first' : 'third',
    fov: Number.isFinite(fov) ? clamp(fov, 50, 110) : DEFAULT_FOV,
    headBob: settings.headBob !== false,
  };
}

/**
 * Eye position from the body (pure maths; tested): feet `p`, eye-line height `eyeH`, the animator's
 * vertical hip offset `hipY`, view yaw / pitch → `out`. The eyes sit 8.5 cm in front of and 10 cm
 * above a neck pivot, so looking down moves them forward over the chest.
 */
export function eyeFromBody(out, p, eyeH, hipY, yaw, pitch) {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const oy = 0.1 * cp + 0.085 * sp;
  const oz = 0.1 * sp - 0.085 * cp;
  out.x = p.x + oz * Math.sin(yaw);
  out.y = p.y + eyeH + hipY - 0.1 + oy;
  out.z = p.z + oz * Math.cos(yaw);
  return out;
}

export function createFirstPerson(ctx, { player, rig, material }) {
  const { state, events, input, modes } = ctx;
  const vm = createViewModel(ctx, { player });
  let cfg = cameraSettings(state.get('settings') || {});
  let lastMode = null;
  let lastDt = 1 / 60;
  // eye dynamics
  let bobY = 0;
  let roll = 0;
  let nod = 0;
  let nodV = 0;
  const head = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const sock = new THREE.Matrix4();
  const hideBones = material?.userData?.hideBones || null;
  if (hideBones) for (const j of FP_HIDDEN_BONES) hideBones[j] = 1;
  const fpHide = material?.userData?.fpHide || null;

  // ------------------------------------------------------------ eye provider
  const eyeProvider = {
    target: player.object,
    pitchOff: 0,
    roll: 0,
    eye(out, r) {
      const chr = player.character;
      const a = chr.anim;
      const p = player.object.position;
      const hy = a.hipOff.y;
      // head bob off: keep only the slow part of the body's motion (crouch, sit, landing), not the stride
      bobY = cfg.headBob ? hy : bobY + (hy - bobY) * (1 - Math.exp(-3 * lastDt));
      eyeFromBody(out, p, chr.frame.headC.y, cfg.headBob ? hy : bobY, r.yaw, r.pitch);
      // swimming: the eyes ride just above the surface
      if (a.swimW > 0.001) {
        const wl = ctx.world?.waterLevel ?? 0;
        out.y += (wl + 0.17 - out.y) * a.swimW;
      }
      // lateral hip sway of the stride (small)
      if (cfg.headBob) {
        const h = player.heading;
        const hx = a.hipOff.x * 0.6;
        out.x += hx * Math.cos(h);
        out.z -= hx * Math.sin(h);
      }
      // never inside walls: pull the eye back toward the head centre along a blocked segment
      head.set(p.x, p.y + chr.frame.headC.y + hy, p.z);
      const phys = ctx.physics;
      if (phys?.segmentHit) {
        const f = phys.segmentHit(head, out);
        if (f < 1) out.lerpVectors(head, out, Math.max(0, f - 0.25));
      }
      // never under the ground / water surface (crawl, roll, slopes)
      const w = ctx.world;
      if (w?.getHeightAt && a.swimW < 0.5) {
        const g = w.getHeightAt(out.x, out.z);
        if (Number.isFinite(g) && out.y < g + 0.18) out.y = g + 0.18;
      }
      return out;
    },
  };
  rig.setFirstPerson(eyeProvider);
  rig.onViewRequest = (v) => setView(v);

  // ------------------------------------------------------------ view state
  function apply() {
    rig.fov = cfg.fov;
    if (rig.view !== cfg.view) rig.setView(cfg.view);
    if (lastMode !== cfg.view) {
      lastMode = cfg.view;
      events.emit('camera:mode', { mode: cfg.view, fov: cfg.fov });
    }
  }

  /** Switches the view ('first' | 'third'), persisted in settings.camera. */
  function setView(v, { silent = false } = {}) {
    const next = v === 'first' ? 'first' : 'third';
    if (state.get('settings.camera') !== next) state.set('settings.camera', next);
    cfg = cameraSettings(state.get('settings') || {});
    apply();
    if (!silent) {
      ctx.audio?.play?.('ui.click', { volume: 0.5 });
      const hint = document.querySelector?.('.chr-fp-hint');
      if (hint) {
        hint.textContent = t(next === 'first' ? TXT.first : TXT.third);
        hint.classList.remove('is-on');
        void hint.offsetWidth;
        hint.classList.add('is-on');
      }
    }
    return next;
  }
  const toggle = () => setView(cfg.view === 'first' ? 'third' : 'first');

  state.subscribe('settings', () => {
    const c = cameraSettings(state.get('settings') || {});
    if (c.view !== cfg.view || c.fov !== cfg.fov || c.headBob !== cfg.headBob) {
      cfg = c;
      apply();
    }
  });
  events.on('state:reset', () => {
    cfg = cameraSettings(state.get('settings') || {});
    apply();
  });
  rig.setView(cfg.view, { snap: true });
  apply();

  // landing nod (the animator's hip squash already dips the eye)
  events.on('player:land', ({ speed = 0 } = {}) => {
    if (rig.fpW > 0.01) nodV -= clamp(speed, 0, 22) * 0.028;
  });

  // ------------------------------------------------------------ player hooks
  player.setFirstPerson({
    get view() {
      return rig.fpW > 0.5 && modes.is('explore') ? 'first' : 'third';
    },
    get active() {
      return rig.fpW > 0.5 && modes.is('explore');
    },
    /** In first person the body turns with the view (legs strafe). */
    get facing() {
      return rig.fpW > 0.25 && rig.fpAllowed;
    },
    muzzleWorld: (out) => vm.muzzleWorld(out),
    onAction: (name, opts, dur, impact) => vm.onAction(name, opts, dur, impact),
    onImpact: (ev) => {
      if (rig.fpW > 0.5) vm.onImpact(ev);
    },
    onHold: () => {},
  });

  // ------------------------------------------------------------ HUD: dot + hint
  let dot = null;
  let hint = null;
  if (ctx.ui?.addWidget && ctx.ui.h) {
    dot = ctx.ui.h('div', { class: 'chr-fp-dot', 'aria-hidden': 'true' });
    ctx.ui.addWidget('center', dot, { modes: ['explore'], order: 5 });
    hint = ctx.ui.h('div', { class: 'chr-fp-hint', role: 'status', 'aria-live': 'polite' });
    ctx.ui.addWidget('center', hint, { modes: ['explore'], order: 6 });
  }
  let dotOn = null;

  // ------------------------------------------------------------ touch
  let touchCheck = 0;
  const patched = new WeakSet();
  const menuItem = { id: 'fp-view', icon: 'chr-view', label: TXT.camera, run: () => toggle() };
  function patchLayout(name) {
    const L = ctx.touch?.getLayout?.(name);
    if (!L || patched.has(L)) return false;
    patched.add(L);
    // a cluster button when there is room (≤ 6 others visible), plus a menu entry everywhere
    const others = () => {
      let n = L.jump ? 1 : 0;
      for (const b of L.buttons || []) {
        if (!b || b.id === 'fp-view') continue;
        try {
          if (!b.when || b.when(ctx)) n++;
        } catch {
          /* hidden */
        }
      }
      return n;
    };
    const btn = { id: 'fp-view', label: TXT.view, icon: 'chr-view', onTap: () => toggle(), when: () => modes.is('explore') && !player.dead && others() < 6 };
    L.buttons = [...(L.buttons || []).filter((b) => b?.id !== 'fp-view'), btn];
    const desc = Object.getOwnPropertyDescriptor(L, 'menuExtra');
    const base = desc?.get ? () => desc.get.call(L) : () => (Array.isArray(desc?.value) ? desc.value : []);
    Object.defineProperty(L, 'menuExtra', {
      configurable: true,
      enumerable: true,
      get: () => {
        const out = [...(base() || [])].filter((x) => x?.id !== 'fp-view');
        out.push(menuItem);
        return out;
      },
    });
    return true;
  }
  function patchTouch() {
    if (!ctx.touch?.enabled) return;
    let any = false;
    for (const n of ['explore', 'combat', 'build']) any = patchLayout(n) || any;
    if (any) ctx.touch.refresh?.();
  }
  events.once?.('game:start', patchTouch);

  // ------------------------------------------------------------ per frame
  /** Explore-mode input (after the camera rig update): V toggles; the key is consumed. */
  function handleInput() {
    if (!input.gameEnabled) return;
    if (input.actionPressed('camera')) {
      toggle();
      // the camera owns V (input action 'camera'): don't let raw-key readers (old quick-grenade binding) see it
      input._pressed?.delete?.('KeyV');
    }
  }

  function update(dt) {
    lastDt = Math.min(Math.max(dt, 1e-4), 0.1);
    const explore = modes.is('explore');
    // death cam: third person while dead (the corpse falls in view), back to the eye after the respawn
    const deadNow = player.dead || !!state.get('smp.dead');
    rig.fpBlock = deadNow ? 'dead' : null;
    const fw = explore ? rig.fpW : 0;
    // ---- camera feel: strafe roll, landing nod, roll duck
    if (fw > 0.001) {
      const a = player.character.anim;
      const v = player.velocity;
      const rv = rig.rightVec;
      const side = v.x * rv.x + v.z * rv.z;
      const rollT = cfg.headBob ? clamp(-side * 0.0042, -0.022, 0.022) : 0;
      roll = damp(roll, rollT, 6, lastDt);
      const K = 110;
      const D = 2 * Math.sqrt(K) * 0.75;
      nodV += (-K * nod - D * nodV) * lastDt;
      nod += nodV * lastDt;
      nod = clamp(nod, -0.12, 0.05);
      let duck = 0;
      if (a.dodgeT < a.dodgeDur) duck = -0.32 * Math.sin(Math.PI * clamp(a.dodgeT / a.dodgeDur, 0, 1));
      eyeProvider.roll = roll + (cfg.headBob ? Math.sin(a.phase * Math.PI * 2) * 0.0035 * clamp(Math.hypot(v.x, v.z) / 4, 0, 1.5) : 0);
      eyeProvider.pitchOff = nod + duck;
    } else {
      eyeProvider.roll = 0;
      eyeProvider.pitchOff = 0;
    }
    // ---- body: dissolve the upper body as the camera arrives at the eye (shadow stays whole)
    if (fpHide) {
      const h = explore ? sstep(0.35, 0.95, rig.fpW) : 0;
      if (Math.abs(fpHide.value - h) > 1e-4) fpHide.value = h;
    }
    // ---- view model
    vm.setAppearance(player.appearance);
    vm.update(dt, fw);
    // ---- tool socket from the eye (third person: player.js places it)
    if (fw > 0.5 && vm.socketMatrix(sock)) {
      player.toolSocket.matrix.copy(sock);
      player.toolSocket.updateMatrixWorld(true);
    }
    // ---- FP crosshair dot (combat / build draw their own)
    if (dot) {
      const on = fw > 0.6 && !ctx.combat?.armed && !ctx.build?.active && !player.aiming;
      if (on !== dotOn) {
        dotOn = on;
        dot.classList.toggle('is-on', on);
      }
    }
    // ---- touch layouts (other modules register theirs after us): patched once each
    touchCheck -= dt;
    if (touchCheck <= 0) {
      touchCheck = 1.5;
      patchTouch();
    }
  }

  return {
    viewModel: vm,
    handleInput,
    update,
    setView,
    toggle,
    get view() {
      return cfg.view;
    },
    get settings() {
      return { ...cfg };
    },
    eyeProvider,
    debug: () => ({ view: cfg.view, fpW: +rig.fpW.toFixed(3), fov: ctx.camera.fov, near: ctx.camera.near, block: rig.fpBlock, hide: fpHide?.value ?? null, vm: vm.debug() }),
  };
}
