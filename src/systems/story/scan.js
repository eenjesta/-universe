/**
 * Ruins scanning (generated/11_ancient_ruins.png). Hold [E] at the ruins:
 *  - the great Ø relief (ruins.relief; interaction at ruins.scanPoints[0],
 *    fallback: the ruins zone) → "Onbekende inscriptie — 64% gescand" while
 *    ruins.setScanProgress(p) makes the carving glow; on completion
 *    ruins.setScanned(true), flag ruinsScanned, 'scan:complete' {target: 'ruins'},
 *    XP and the lore entry "De inscriptie".
 *  - the rune stones (ruins.scanPoints[1…]) → short optional scans
 *    ('scan:complete' {target: 'rune', index}), XP each and the lore entry
 *    "De runenstenen" once all of them are read.
 * A scan bracket (corner brackets, grid, sweep line, label + progress bar)
 * tracks the target on screen; while holding, the camera eases to frame it.
 */
import * as THREE from 'three';
import { ZONES } from '../../world/layout.js';
import { damp, dampAngle } from '../../core/math.js';
import { groundY, playerPos, headingTo } from '../shared/util.js';

const MAIN_ID = 'sys-scan-ruins';
const RUNE_PREFIX = 'sys-scan-rune-';
const MAIN_HOLD = 3;
const RUNE_HOLD = 1.6;
const INSCRIPTION = '“Wie de cirkel volgt, keert terug naar het begin. Wie hem doorbreekt, vindt de sterren.”';
const RUNE_SIGNS = ['de cirkel', 'de lijn', 'de ster', 'de golf'];
const RANGE_AHEAD = 7; // m in front of the relief wall
const RANGE_R = 12; // interaction radius around that spot (scan from ~1–19 m)
// where the camera assist puts the relief centre while scanning (NDC: right of centre, a bit high)
const AIM_NDC_X = 0.32;
const AIM_NDC_Y = 0.16;

export function createRuinsScan(ctx, { rewards, progress }) {
  const { ui, state } = ctx;
  const _v = new THREE.Vector3();
  const _r = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();

  const ruins = () => ctx.landmarks?.ruins || null;
  const asVec = (c) => (c?.isVector3 ? c : c?.isObject3D ? c.getWorldPosition(_d) : null);

  // ---------------------------------------------------------------- targets
  /** {id, kind: 'main'|'rune', index, hold, frame (bracket half-size, m), center, stand} */
  const targets = [];
  const byId = new Map();

  function buildTargets() {
    targets.length = 0;
    byId.clear();
    const r = ruins();
    const pts = Array.isArray(r?.scanPoints) ? r.scanPoints.filter((p) => p?.isVector3) : [];
    // the relief: landmarks expose its centre (ruins.relief); older builds only a scan point
    const relief = asVec(r?.inscription) || asVec(r?.relief) || asVec(r?.scanTarget);
    const main = { id: MAIN_ID, kind: 'main', index: 0, hold: MAIN_HOLD, frame: relief ? 4.4 : 2.3, center: new THREE.Vector3(), stand: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), spot: new THREE.Vector3() };
    if (relief) main.center.copy(relief);
    else if (pts[0]) main.center.copy(pts[0]).y += 2.4;
    else main.center.set(ZONES.ruins.x, groundY(ctx, ZONES.ruins.x, ZONES.ruins.z) + 2.4, ZONES.ruins.z);
    if (pts[0]) main.stand.copy(pts[0]);
    else main.stand.set(main.center.x, groundY(ctx, main.center.x, main.center.z), main.center.z);
    // the relief faces along its normal (landmarks: ruins.reliefNormal; else towards the stand point)
    const nrm = r?.reliefNormal?.isVector3 ? r.reliefNormal : null;
    if (nrm) main.normal.set(nrm.x, 0, nrm.z);
    else main.normal.set(main.stand.x - main.center.x, 0, main.stand.z - main.center.z);
    if (main.normal.lengthSq() < 1e-4) main.normal.set(0, 0, 1);
    main.normal.normalize();
    // range scanning: the interaction sits RANGE_AHEAD in front of the wall (radius RANGE_R), so the
    // relief can be scanned from the terrace or from the path, like 11_ancient_ruins.png
    if (relief) main.spot.copy(main.center).addScaledVector(main.normal, RANGE_AHEAD);
    else main.spot.copy(main.stand);
    main.spot.y = groundY(ctx, main.spot.x, main.spot.z) + 1;
    targets.push(main);
    // rune stones: landmarks expose {stand, center} per stone (ruins.runeStones, same order as
    // scanPoints[1…]); older builds only the stand-on spot 1.8 m in front of the stone
    const c = asVec(r?.center)?.clone() || null;
    const stones = Array.isArray(r?.runeStones) ? r.runeStones : [];
    for (let i = 1; i < pts.length; i++) {
      const stand = pts[i].clone();
      const exact = asVec(stones[i - 1]?.center);
      let center;
      if (exact) center = exact.clone();
      else {
        center = stand.clone();
        if (c) {
          _d.set(stand.x - c.x, 0, stand.z - c.z);
          if (_d.lengthSq() > 1) center.addScaledVector(_d.normalize(), 1.8);
        }
        center.y = stand.y + 1.3; // middle of the glowing rune column
      }
      targets.push({ id: `${RUNE_PREFIX}${i}`, kind: 'rune', index: i, hold: RUNE_HOLD, frame: 1.5, center, stand });
    }
    for (const t of targets) byId.set(t.id, t);
  }

  const runesRead = () => state.get('systems.runes') || [];
  const isDone = (t) => (t.kind === 'main' ? rewards.flag('ruinsScanned') : runesRead().includes(t.index));
  const runeCount = () => targets.length - 1;

  // ---------------------------------------------------------------- interactions
  const _f = new THREE.Vector3();
  /** Player in front of the relief wall and the camera looking roughly at it. */
  function inView(t) {
    const p = playerPos(ctx, _p);
    if (!p) return false;
    if ((p.x - t.center.x) * t.normal.x + (p.z - t.center.z) * t.normal.z < 1) return false;
    const cam = ctx.engine?.camera || ctx.camera;
    if (!cam) return true;
    cam.getWorldDirection(_f);
    const tx = t.center.x - cam.position.x;
    const tz = t.center.z - cam.position.z;
    const fl = Math.hypot(_f.x, _f.z) || 1;
    const tl = Math.hypot(tx, tz) || 1;
    return (_f.x * tx + _f.z * tz) / (fl * tl) > 0.5;
  }

  const ids = [];
  function registerInteractions() {
    ids.forEach((id) => ctx.interactions.remove(id));
    ids.length = 0;
    buildTargets();
    for (const t of targets) {
      ids.push(t.id);
      const main = t.kind === 'main';
      ctx.interactions.add({
        id: t.id,
        scope: 'world',
        position: main ? t.spot : t.stand,
        radius: main ? RANGE_R : 3.4,
        label: main ? 'Scan inscriptie' : 'Scan runensteen',
        hold: t.hold,
        priority: 2,
        anchor: false,
        enabled: () => !isDone(t) && ctx.modes.is('explore') && (!main || inView(t)),
        onInteract: () => complete(t),
      });
    }
  }
  registerInteractions();

  let doneTimer = 0;
  let lastDone = null;

  function complete(t = targets[0]) {
    if (!t || isDone(t)) return;
    lastDone = t;
    doneTimer = t.kind === 'main' ? 6.5 : 3.6;
    quote.textContent = t.kind === 'main' ? INSCRIPTION : `Teken ontcijferd: ${RUNE_SIGNS[(t.index - 1) % RUNE_SIGNS.length]}`;
    stopLoop();
    ctx.audio.play('quest.update');
    if (t.kind === 'main') {
      rewards.setFlag('ruinsScanned');
      try {
        ruins()?.setScanned?.(true);
      } catch (err) {
        console.warn('[scan] setScanned failed', err);
      }
      rewards.unlockLore('inscription');
      progress.addXP(150, 'scan');
      ctx.events.emit('scan:complete', { target: 'ruins' });
      return;
    }
    const read = [...runesRead(), t.index];
    state.set('systems.runes', read);
    progress.addXP(40, 'scan');
    state.add('credits', 25);
    const n = read.length;
    const total = runeCount();
    ui.toast({ title: 'Runensteen ontcijferd', text: `+40 XP · +25 Ø-credits · ${n}/${total}`, icon: 'scan', kind: 'quest', duration: 2800 });
    ctx.events.emit('scan:complete', { target: 'rune', index: t.index, count: n, total });
    if (n >= total) rewards.unlockLore('runes');
  }

  // restore the landmark state on load (and after a save reset)
  const applyLandmark = () => {
    try {
      ruins()?.setScanned?.(rewards.flag('ruinsScanned'));
    } catch {
      /* optional landmark API */
    }
  };
  applyLandmark();
  ctx.events.on('state:reset', applyLandmark);

  // ---------------------------------------------------------------- overlay
  const label = ui.h('span', { class: 'sys-scan-text' });
  const pct = ui.h('b', { text: '0%' });
  const fillBar = ui.h('i');
  // the deciphered text, shown under the bracket for a few seconds after a scan completes
  const quote = ui.h('div', { class: 'sys-scan-quote' });
  const el = ui.h(
    'div',
    { class: 'sys-scan' },
    ui.h('div', { class: 'sys-scan-head' }, ui.h('div', { class: 'sys-scan-label' }, label, pct), ui.h('div', { class: 'sys-scan-bar' }, fillBar)),
    ui.h(
      'div',
      { class: 'sys-scan-frame' },
      ui.h('div', { class: 'sys-scan-grid' }, ui.h('div', { class: 'sys-scan-sweepw' }, ui.h('i', { class: 'sys-scan-sweep' }))),
      ui.h('i', { class: 'c tl' }),
      ui.h('i', { class: 'c tr' }),
      ui.h('i', { class: 'c bl' }),
      ui.h('i', { class: 'c br' }),
    ),
    quote,
  );
  ui.layers.hud.appendChild(el);

  let visible = false;
  let loopHandle = null;
  let lastText = '';
  let lastP = -1;
  let lastLandmarkP = 0;
  let focus = null; // target the bracket shows
  let holding = 0; // 0…1 progress of the scan being held
  let lastN = -2; // last shown percentage (-1 idle, 101 done)
  let lastT = null;
  const lastBox = [NaN, NaN, NaN];

  function stopLoop() {
    loopHandle?.stop?.(0.25);
    loopHandle = null;
  }

  function setText(t, p) {
    if (t !== lastText) {
      label.textContent = t;
      lastText = t;
    }
    if (p !== lastP) {
      pct.textContent = `${Math.round(p * 100)}%`;
      fillBar.style.width = `${p * 100}%`;
      lastP = p;
    }
  }

  function hide() {
    if (visible) {
      el.classList.remove('show');
      visible = false;
    }
    holding = 0;
    stopLoop();
  }

  /** Which target the overlay follows this frame (or null). */
  function pickFocus(p) {
    const curId = ctx.interactions.current?.id || '';
    if (byId.has(curId)) return byId.get(curId);
    if (doneTimer > 0 && lastDone) return lastDone;
    const main = targets[0];
    if (main && !isDone(main) && p.distanceTo(main.center) < 22 && inView(main)) return main;
    return null;
  }

  const LABELS = {
    main: { idle: 'Onbekende inscriptie', scan: (n) => `Onbekende inscriptie — ${n}% gescand`, done: 'Inscriptie ontcijferd — 100% gescand' },
    rune: { idle: 'Runensteen', scan: (n) => `Runensteen — ${n}% gescand`, done: 'Runensteen ontcijferd — 100% gescand' },
  };

  function update(dt) {
    if (doneTimer > 0) doneTimer -= dt;
    if (!ctx.modes.is('explore') || ui.isModalOpen()) return hide();
    const p = playerPos(ctx, _p);
    if (!p) return hide();
    const t = pickFocus(p);
    if (!t || p.distanceTo(t.center) > 26) return hide();
    focus = t;
    const cam = ctx.engine.camera;
    const c = t.center;
    _v.copy(c).project(cam);
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.25 || Math.abs(_v.y) > 1.25) return hide();
    // projected half-size of the target: offset along the camera's right axis
    _r.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(t.frame).add(c).project(cam);
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const sx = (_v.x * 0.5 + 0.5) * w;
    const sy = (-_v.y * 0.5 + 0.5) * hgt;
    const rad = Math.round(Math.min(hgt * 0.36, Math.max(52, Math.abs(_r.x - _v.x) * 0.5 * w)));
    const tx = Math.round(sx - rad);
    const ty = Math.round(sy - rad);
    if (tx !== lastBox[0] || ty !== lastBox[1] || rad !== lastBox[2]) {
      lastBox[0] = tx;
      lastBox[1] = ty;
      lastBox[2] = rad;
      el.style.transform = `translate(${tx}px, ${ty}px)`;
      el.style.width = el.style.height = `${rad * 2}px`;
      // keep the label + progress bar on screen: inside the bracket when it reaches the top edge
      el.classList.toggle('label-inside', ty < 78);
    }

    // progress comes from the core hold interaction
    const it = ctx.interactions;
    const done = isDone(t);
    holding = !done && it.current?.id === t.id ? Math.min(1, (it.holdTime || 0) / t.hold) : 0;
    el.classList.toggle('active', holding > 0.001);
    el.classList.toggle('done', done);
    el.classList.toggle('quote', done && doneTimer > 0.6 && t === lastDone);
    if (el.dataset.kind !== t.kind) el.dataset.kind = t.kind;
    // label strings are only rebuilt when the shown percentage changes
    const L = LABELS[t.kind];
    const n = done ? 101 : holding > 0 ? Math.round(holding * 100) : -1;
    if (n !== lastN || t !== lastT) {
      lastN = n;
      lastT = t;
      if (done) setText(L.done, 1);
      else if (holding > 0) setText(L.scan(n), n / 100);
      else setText(L.idle, 0);
    }

    if (t.kind === 'main' && (Math.abs(holding - lastLandmarkP) > 0.02 || (holding === 0 && lastLandmarkP !== 0))) {
      lastLandmarkP = holding;
      try {
        if (!done) ruins()?.setScanProgress?.(holding);
      } catch {
        /* optional landmark API */
      }
    }
    if (holding > 0 && !loopHandle) loopHandle = ctx.audio.loop('scan');
    else if (holding <= 0 && loopHandle) stopLoop();
    loopHandle?.set?.({ progress: holding });

    if (!visible) {
      el.classList.add('show');
      visible = true;
    }
  }
  ctx.loop.add('sys-scan', update, { order: 92 });

  // ---------------------------------------------------------------- camera assist while holding
  // Order 19, before the explore mode updates the rig. The relief: a feedback loop on where it
  // projected last frame steers yaw/pitch until its centre sits right of the player and a bit
  // high (AIM_NDC_*) — robust for any distance and terrain. Rune stones: a fixed close framing.
  const _n = new THREE.Vector3();
  ctx.loop.add(
    'sys-scan-cam',
    (dt) => {
      if (holding <= 0.02 || !focus || !ctx.modes.is('explore')) return;
      const rig = ctx.cameraRig;
      const p = ctx.player?.position;
      if (!rig || !p) return;
      const c = focus.center;
      const h = headingTo(p.x, p.z, c.x, c.z);
      if (typeof ctx.player.heading === 'number') ctx.player.heading = dampAngle(ctx.player.heading, h, 5, dt);
      if (focus.kind !== 'main') {
        rig.yaw = dampAngle(rig.yaw, h + 0.4, 2.4, dt);
        rig.pitch = damp(rig.pitch, -0.02, 2.2, dt);
        if (typeof rig._zoom === 'number') rig._zoom = damp(rig._zoom, 3.2, 2, dt);
        return;
      }
      const cam = ctx.engine?.camera || ctx.camera;
      _n.copy(c).project(cam);
      if (_n.z > 1 || Math.abs(_n.x) > 1.6) {
        rig.yaw = dampAngle(rig.yaw, h + 0.3, 2.4, dt); // off screen: swing towards it first
      } else {
        rig.yaw -= (_n.x - AIM_NDC_X) * 1.5 * dt;
        rig.pitch = Math.max(-0.5, Math.min(0.62, rig.pitch + (_n.y - AIM_NDC_Y) * 1.1 * dt));
      }
      if (typeof rig._zoom === 'number') rig._zoom = damp(rig._zoom, Math.min(4.6, Math.max(3.2, rig._zoom)), 2, dt);
    },
    { order: 19 },
  );

  return {
    get scanned() {
      return rewards.flag('ruinsScanned');
    },
    /** Copy of the relief centre. */
    inscription: () => targets[0].center.clone(),
    /** Shared (non-cloned) vector at the relief centre — for per-frame marker lookups. */
    targetRef: () => targets[0].center,
    /** Number of rune stones that can be scanned (0 when landmarks has none). */
    runeCount,
    runesRead: () => runesRead().length,
    /** Next unread rune stone (for the optional quest marker). */
    nextRune: () => targets.find((t) => t.kind === 'rune' && !isDone(t))?.center || null,
    complete: (kind = 'main', index = 0) => complete(kind === 'main' ? targets[0] : targets.find((t) => t.index === index)),
  };
}
