/**
 * Ø Studio runtime — the 'experience' mode (play-tests and published experiences, single-player v1).
 *
 *   const rt = createRuntime(ctx, { studio });
 *   await rt.start(exp, { from: 'studio'|'home'|'title', test, id, title });  rt.update(dt);  rt.stop();
 *
 * Scene from the experience JSON (shared stage: sky, baseplate, instanced parts). Collision: own SDF
 * world (collide.js; anchored + unanchored parts, wedge ramps, any rotation) — the shared ctx.physics
 * hash is never touched. Character: capsule (3 spheres) with walk/run/jump/fall, coyote time, jump
 * buffer, ground snap, slopes ≤ 53°, ice is slippery. Behaviours (part.props.behavior): kill → respawn
 * at the last checkpoint, bounce → launch, finish → time; spawn parts with checkpoint ≠ false become
 * the respawn point when touched; falling below −50 m respawns. Unanchored parts drop until they rest.
 * Avatar: the player's appearance through the characters module (Character + CharacterBatch, built
 * lazily) or a stylised mannequin when that is unavailable. Camera: third-person orbit (drag / touch
 * drag, wheel / pinch zoom) with collision. HUD: title, Leave, timer, banners; Esc menu (resume,
 * reset, restart, report, leave); touch layout 'experience' (stick + jump + reset).
 */
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { icon } from '../ui/icons.js';
import { CollisionWorld, shapeFromPart } from './collide.js';
import { createStage } from './scene.js';
import { clonePart } from './format.js';

const R = 0.42; // capsule radius
const H = 1.8; // capsule height
const RUN = 7.4;
const SPRINT = 10.5;
const JUMP_V = 9.4;
const G = 26;
const SNAP = 0.45;
const WALKABLE = 0.6;
const SPHERES = [R, H * 0.5, H - R];
const TXT = {
  leave: { en: 'Leave', nl: 'Verlaten' },
  back: { en: 'Back to Studio', nl: 'Terug naar Studio' },
  test: { en: 'Test', nl: 'Test' },
  checkpoint: { en: 'Checkpoint', nl: 'Checkpoint' },
  finish: { en: 'Finished!', nl: 'Gefinisht!' },
  oops: { en: 'Oops!', nl: 'Oeps!' },
  time: { en: 'Time', nl: 'Tijd' },
  best: { en: 'Best {time}', nl: 'Beste {time}' },
  menu: { en: 'Menu', nl: 'Menu' },
  by: { en: 'by {name}', nl: 'door {name}' },
  resume: { en: 'Resume', nl: 'Verder spelen' },
  reset: { en: 'Reset character', nl: 'Personage resetten' },
  restart: { en: 'Restart from start', nl: 'Opnieuw beginnen' },
  report: { en: 'Report experience', nl: 'Ervaring melden' },
  reported: { en: 'Thanks — our team will take a look.', nl: 'Bedankt — ons team kijkt ernaar.' },
  noSpawn: { en: 'No spawn in this experience — starting at the centre.', nl: 'Geen startpunt in deze ervaring — je begint in het midden.' },
  keys: [
    ['WASD', { en: 'Move', nl: 'Lopen' }],
    ['Space', { en: 'Jump', nl: 'Springen' }],
    ['Shift', { en: 'Sprint', nl: 'Sprinten' }],
    ['R', { en: 'Reset', nl: 'Reset' }],
    ['Esc', { en: 'Menu', nl: 'Menu' }],
  ],
  testKey: ['Esc', { en: 'Back to Studio', nl: 'Terug naar Studio' }],
};
const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`;
};

export function createRuntime(ctx, { studio }) {
  const { input, ui } = ctx;
  const stage = createStage(ctx, { editor: false });
  const scene = stage.scene;
  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 6000);
  const world = new CollisionWorld(8);
  const solid = (s) => s.solid;

  // ------------------------------------------------------------- state
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const groundN = new THREE.Vector3(0, 1, 0);
  const lastSafe = new THREE.Vector3();
  const spawnPos = new THREE.Vector3();
  const tmpN = { x: 0, y: 0, z: 0 };
  const hitTmp = {};
  const near = [];
  const touched = new Set();
  let exp = null;
  let opts = {};
  let heading = 0;
  let grounded = false;
  let groundShape = null;
  let coyote = 0;
  let jumpBuf = 0;
  let wasGrounded = false;
  let dead = 0;
  let checkpoint = null;
  let startSpawn = null;
  let timer = 0;
  let timing = false;
  let finished = false;
  let hasFinish = false;
  let camYaw = 0;
  let camPitch = -0.3;
  let camDist = 9;
  let camCur = 9;
  let running = false;
  let dyn = []; // unanchored parts still falling: { part, shape, vy }
  const shapes = new Map();
  let popEscape = null;
  let lockOff = null;
  let avatar = null;
  let avatarKey = '';
  let bestKey = null;

  // ------------------------------------------------------------ avatar
  async function buildAvatar() {
    const app = ctx.player?.appearance || ctx.state?.get?.('profile.appearance') || {};
    try {
      const [{ Character }, { CharacterBatch }, { createCharacterMaterial, updateRimFromWorld }] = await Promise.all([
        import('../characters/character.js'),
        import('../characters/batch.js'),
        import('../characters/material.js'),
      ]);
      const mat = createCharacterMaterial({ rim: 0.7, name: 'studio-avatar' });
      const chr = new Character(app, { lod: 1, name: 'studio-avatar', seed: 777 });
      const batch = new CharacterBatch({ material: mat, parent: chr.object, name: 'studio-avatar-mesh', localBounds: new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.7) });
      batch.add(chr);
      batch.rebuild();
      chr.onArrays = () => batch.rebuild();
      try {
        chr.setAppearanceAsync(app, 0);
      } catch {
        /* hero mesh optional */
      }
      chr.anim.onStep = () => ctx.audio?.play?.('footstep', { volume: 0.35 });
      return {
        object: chr.object,
        rim: () => updateRimFromWorld(mat, { sun: stage.sun, sunDirection: stage.sunDir, dayFactor: exp?.settings.sky === 'night' ? 0.25 : 1 }, 0.6),
        update(dt, speed, onGround, vy) {
          const a = chr.anim;
          a.speed = speed;
          a.grounded = onGround;
          a.vy = vy;
          a.swimming = false;
          a.turnRate = 0;
          a.update(dt);
        },
        land(sp) {
          chr.anim.land?.(sp);
        },
        dispose() {
          batch.dispose?.();
          mat.dispose();
        },
      };
    } catch (err) {
      console.warn('[studio] character avatar unavailable — mannequin', err);
      return mannequin(app);
    }
  }
  function mannequin(app) {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: app.outfitColor || '#23262c', roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: app.skin || '#d9a47c', roughness: 0.7 });
    const accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.88, 1).multiplyScalar(2) });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 6, 12), body);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 14), skin);
    head.position.y = 1.68;
    const legGeo = new THREE.CapsuleGeometry(0.1, 0.62, 4, 8);
    const legs = [-0.12, 0.12].map((x) => {
      const l = new THREE.Mesh(legGeo, body);
      l.position.set(x, 0.42, 0);
      return l;
    });
    const armGeo = new THREE.CapsuleGeometry(0.075, 0.55, 4, 8);
    const arms = [-0.35, 0.35].map((x) => {
      const a = new THREE.Mesh(armGeo, body);
      a.position.set(x, 1.18, 0);
      return a;
    });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.05), accent);
    visor.position.set(0, 1.7, -0.17);
    g.add(torso, head, visor, ...legs, ...arms);
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    let ph = 0;
    return {
      object: g,
      rim() {},
      update(dt, speed, onGround) {
        ph += dt * (onGround ? speed * 1.6 : 2);
        const sw = onGround ? Math.sin(ph) * Math.min(1, speed / 6) * 0.7 : 0.4;
        legs[0].rotation.x = sw;
        legs[1].rotation.x = -sw;
        arms[0].rotation.x = -sw * 0.8;
        arms[1].rotation.x = sw * 0.8;
      },
      land() {},
      dispose() {
        g.traverse((o) => {
          if (o.isMesh) o.geometry.dispose();
        });
        body.dispose();
        skin.dispose();
        accent.dispose();
      },
    };
  }

  // --------------------------------------------------------------- HUD
  const h = ui.h;
  const titleEl = h('b');
  const creatorEl = h('small', { class: 'studio-hud-by', hidden: true });
  const tagEl = h('span', { class: 'studio-tag', text: t(TXT.test) });
  const leaveBtn = h('button', { type: 'button', class: 'studio-ibtn', html: icon('studio-exit', 16), onclick: () => leave() }, h('span'));
  const menuBtn = h('button', { type: 'button', class: 'studio-ibtn', title: t(TXT.menu), 'aria-label': t(TXT.menu), html: icon('settings', 16), onclick: () => openMenu() });
  const timerVal = h('span');
  const bestEl = h('small');
  const timerEl = h('div', { class: 'studio-hud-timer', hidden: true }, h('small', { text: t(TXT.time) }), timerVal, bestEl);
  const bannerB = h('b');
  const bannerS = h('span');
  const banner = h('div', { class: 'studio-banner' }, bannerB, bannerS);
  const flash = h('div', { class: 'studio-flash' });
  const keyRow = ([k, l]) => h('span', {}, t(l), h('span', { class: 'kbd', text: k }));
  const keys = h('div', { class: 'studio-hud-keys' });
  const renderKeys = (test) => keys.replaceChildren(...TXT.keys.slice(0, -1).map(keyRow), keyRow(test ? TXT.testKey : TXT.keys[TXT.keys.length - 1]));
  const hud = h('div', { class: 'studio-hud layer', hidden: true }, flash, h('div', { class: 'studio-hud-title' }, h('span', { html: icon('emblem', 18) }), h('div', { class: 'studio-hud-name' }, titleEl, creatorEl), tagEl, menuBtn, leaveBtn), timerEl, banner, keys);
  ui.layers.hud.appendChild(hud);
  let bannerTimer = 0;
  function showBanner(big, small = '', seconds = 2) {
    bannerB.textContent = big;
    bannerS.textContent = small;
    banner.classList.add('show');
    bannerTimer = seconds;
  }

  // -------------------------------------------------------------- build
  function addShape(p) {
    const s = shapeFromPart(p);
    s.behavior = p.props?.behavior || null;
    s.checkpoint = p.type === 'spawn' && p.props?.checkpoint !== false;
    s.ice = p.material === 'ice';
    shapes.set(p.id, s);
    world.add(s);
    return s;
  }
  function build() {
    world.clear();
    shapes.clear();
    dyn = [];
    stage.applySettings(exp.settings);
    stage.parts.sync(exp.parts);
    stage.rebuildEnv();
    const bp = exp.settings.baseplate;
    if (bp.size > 0) {
      const s = shapeFromPart({ id: '__baseplate', type: 'block', p: [0, -10, 0], r: [0, 0, 0], s: [bp.size, 20, bp.size], collide: true });
      s.ice = bp.material === 'ice';
      world.add(s);
    }
    for (const p of exp.parts) {
      const behaves = !!p.props?.behavior || p.type === 'spawn';
      if (!p.collide && !behaves) continue;
      const s = addShape(p);
      if (!p.anchored) dyn.push({ part: p, shape: s, vy: 0, rest: false });
    }
    const spawns = exp.parts.filter((p) => p.type === 'spawn');
    startSpawn = spawns.find((p) => /^spawn/i.test(p.name)) || spawns[0] || null;
    hasFinish = exp.parts.some((p) => p.props?.behavior === 'finish');
    timerEl.hidden = !hasFinish;
    avatar?.rim();
  }
  function spawnAt(part) {
    if (part) {
      const top = part.p[1] + part.s[1] / 2;
      spawnPos.set(part.p[0], top + 0.05, part.p[2]);
      heading = (part.r[1] * Math.PI) / 180;
    } else spawnPos.set(0, 0.05, 0);
    pos.copy(spawnPos);
    vel.set(0, 0, 0);
    lastSafe.copy(pos);
    grounded = false;
    camYaw = heading;
    camPitch = -0.28;
  }

  // ------------------------------------------------------------- start
  async function start(experience, options = {}) {
    exp = { ...experience, parts: experience.parts.map(clonePart) };
    opts = options;
    // the player's current look (rebuilt when it changed since the last experience)
    let appKey = '';
    try {
      appKey = JSON.stringify(ctx.player?.appearance || ctx.state?.get?.('profile.appearance') || {});
    } catch {
      appKey = '';
    }
    if (avatar && avatarKey !== appKey) {
      scene.remove(avatar.object);
      avatar.dispose();
      avatar = null;
    }
    if (!avatar) {
      avatar = await buildAvatar();
      avatarKey = appKey;
      scene.add(avatar.object);
    }
    avatar.object.visible = true;
    build();
    stage.activate();
    titleEl.textContent = exp.meta.title || t({ en: 'Untitled experience', nl: 'Naamloze ervaring' });
    tagEl.hidden = !opts.test;
    renderKeys(!!opts.test);
    leaveBtn.lastChild.textContent = t(opts.test ? TXT.back : TXT.leave);
    checkpoint = null;
    finished = false;
    timer = 0;
    timing = hasFinish;
    bestKey = `oU.studio.best.${opts.key || opts.id || `t:${exp.meta.title}`}`;
    creatorEl.textContent = opts.creator && !opts.test ? t(TXT.by, { name: opts.creator }) : '';
    creatorEl.hidden = !creatorEl.textContent;
    updateBest();
    spawnAt(startSpawn);
    if (!startSpawn) ui.toast({ title: t(TXT.noSpawn), icon: 'info', kind: 'warn' });
    camCur = camDist;
    placeCamera(1, true);
    hud.hidden = false;
    running = true;
    // play-test: Esc goes straight back to the editor (the HUD menu button still opens the menu)
    popEscape = ui.pushEscape(() => (opts.test ? leave() : openMenu()));
    lockOff = ctx.events.on('input:lockLost', () => openMenu());
    ctx.touch?.setLayout?.('experience', {
      joystick: 'analog',
      look: true,
      jump: true,
      action: false,
      sprint: 'ShiftLeft',
      menu: false,
      buttons: [{ id: 'reset', label: { en: 'Reset', nl: 'Reset' }, icon: 'studio-reset', code: 'KeyR' }],
    });
    if (opts.id && !opts.test && opts.countPlay !== false) {
      try {
        ctx.platform?.api?.(`/api/experiences/${encodeURIComponent(opts.id)}/play`, { method: 'POST', body: {} })?.catch?.(() => {});
      } catch {
        /* play counter is best effort */
      }
    }
  }

  function stop() {
    running = false;
    stage.deactivate();
    hud.hidden = true;
    banner.classList.remove('show');
    popEscape?.();
    popEscape = null;
    lockOff?.();
    lockOff = null;
    ui.closeModal('studio-menu');
    input.releaseAllVirtual?.();
  }

  function updateBest() {
    let best = null;
    try {
      best = parseFloat(localStorage.getItem(bestKey));
    } catch {
      best = null;
    }
    bestEl.textContent = Number.isFinite(best) ? t(TXT.best, { time: fmtTime(best) }) : '';
    return Number.isFinite(best) ? best : null;
  }

  // ------------------------------------------------------------ actions
  function respawn({ restart = false } = {}) {
    if (restart) {
      checkpoint = null;
      finished = false;
      timer = 0;
      timing = hasFinish;
    }
    spawnAt(checkpoint || startSpawn);
    dead = 0;
    placeCamera(1, true);
  }
  function die() {
    if (dead > 0) return;
    dead = 0.55;
    vel.set(0, 0, 0);
    flash.classList.add('show');
    setTimeout(() => flash.classList.remove('show'), 60);
    ctx.audio?.play?.('shield.hit', { volume: 0.5 });
    showBanner(t(TXT.oops), '', 1);
  }
  function leave() {
    const from = opts.from;
    ui.closeModal('studio-menu');
    if (opts.test || from === 'studio') studio.backToStudio();
    else studio.leaveExperience(from);
  }
  function openMenu() {
    if (!running || ui.isModalOpen('studio-menu')) return;
    const close = () => ui.closeModal('studio-menu');
    const btn = (label, ic, fn, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', html: icon(ic, 16), onclick: () => {
      close();
      fn();
    } }, h('span', { text: t(label) }));
    const items = [
      btn(TXT.resume, 'studio-play', () => {}, 'btn-primary'),
      btn(TXT.reset, 'studio-reset', () => respawn()),
      btn(TXT.restart, 'studio-flag', () => respawn({ restart: true })),
    ];
    if (!opts.test && opts.id && ctx.platform?.api) {
      items.push(btn(TXT.report, 'info', () => {
        try {
          ctx.platform.api('/api/report', { method: 'POST', body: { kind: 'experience', targetId: opts.id, reason: 'player-report' } })?.catch?.(() => {});
        } catch {
          /* best effort */
        }
        ui.toast({ title: t(TXT.reported), icon: 'check', kind: 'success' });
      }));
    }
    items.push(btn(opts.test ? TXT.back : TXT.leave, 'studio-exit', () => leave()));
    const el = h('div', { class: 'studio-dlg studio-menu' }, h('div', { class: 'modal-head' }, h('div', {}, h('h2', { text: exp?.meta.title || t(TXT.menu) }), h('p', { text: t(TXT.menu) }))), h('div', { class: 'modal-body' }, items));
    ui.openModal('studio-menu', el, { closeOnBackdrop: true });
  }

  // ------------------------------------------------------------ physics
  function collide() {
    grounded = false;
    groundShape = null;
    touched.clear();
    const r2 = R + 0.12;
    world.query(pos.x - r2, pos.y - 0.2, pos.z - r2, pos.x + r2, pos.y + H + 0.2, pos.z + r2, near);
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (let si = 0; si < 3; si++) {
        const cy = pos.y + SPHERES[si];
        for (let i = 0; i < near.length; i++) {
          const s = near[i];
          const d = world.sdf(s, pos.x, cy, pos.z);
          if (d >= R + 0.06) continue;
          touched.add(s);
          if (!s.solid || d >= R) continue;
          world.normal(s, pos.x, cy, pos.z, tmpN);
          let push = R - d;
          // the bottom sphere stands on walkable surfaces: resolve vertically so we don't slide off ramps
          if (si === 0 && tmpN.y > WALKABLE) {
            pos.y += push / tmpN.y;
            if (vel.y < 0) vel.y = 0;
            grounded = true;
            groundShape = s;
            groundN.set(tmpN.x, tmpN.y, tmpN.z);
          } else {
            if (si === 2 && tmpN.y < -0.5 && vel.y > 0) vel.y = 0; // head bump
            pos.x += tmpN.x * push;
            pos.y += tmpN.y * push;
            pos.z += tmpN.z * push;
            const vn = vel.x * tmpN.x + vel.y * tmpN.y + vel.z * tmpN.z;
            if (vn < 0) {
              vel.x -= tmpN.x * vn;
              vel.y -= tmpN.y * vn;
              vel.z -= tmpN.z * vn;
            }
            push = 0;
          }
          any = true;
        }
      }
      if (!any) break;
    }
  }
  function groundSnap() {
    // keep contact walking down ramps / off small steps
    const h0 = world.raycast(pos.x, pos.y + R, pos.z, 0, -1, 0, R + SNAP, solid, hitTmp);
    if (h0 && h0.ny > WALKABLE) {
      pos.y = h0.y + R / h0.ny - R;
      grounded = true;
      groundShape = h0.shape;
      groundN.set(h0.nx, h0.ny, h0.nz);
      if (vel.y < 0) vel.y = 0;
    }
  }

  const fwd = new THREE.Vector3();
  const rightV = new THREE.Vector3();
  function step(dt) {
    const g = G * (exp.settings.gravity || 1);
    const mv = dead > 0 ? { x: 0, y: 0 } : input.moveVector();
    fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    rightV.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    let wx = rightV.x * mv.x + fwd.x * mv.y;
    let wz = rightV.z * mv.x + fwd.z * mv.y;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const sprint = input.action('sprint');
    const speed = sprint ? SPRINT : RUN;
    const ice = grounded && groundShape?.ice;
    const accel = grounded ? (ice ? 5 : 75) : 22;
    const tx = wx * speed;
    const tz = wz * speed;
    const dvx = tx - vel.x;
    const dvz = tz - vel.z;
    const dl = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dl > maxDv) {
      vel.x += (dvx / dl) * maxDv;
      vel.z += (dvz / dl) * maxDv;
    } else {
      vel.x = tx;
      vel.z = tz;
    }
    if (wl > 0.1) heading = dampAngle(heading, Math.atan2(-wx, -wz), 14, dt);
    // jump: buffer + coyote time
    if (grounded) coyote = 0.12;
    else coyote -= dt;
    if (dead <= 0 && input.actionPressed('jump')) jumpBuf = 0.14;
    else jumpBuf -= dt;
    let jumped = false;
    if (jumpBuf > 0 && coyote > 0) {
      vel.y = JUMP_V; // fixed jump power: low gravity = higher, floatier jumps (like Roblox)
      jumpBuf = 0;
      coyote = 0;
      grounded = false;
      jumped = true;
      ctx.audio?.play?.('jump', { volume: 0.5 });
    }
    vel.y -= g * dt;
    if (vel.y < -80) vel.y = -80;
    pos.addScaledVector(vel, dt);
    const was = grounded;
    collide();
    if (!grounded && was && !jumped && vel.y <= 0.5) groundSnap();
    if (grounded && !wasGrounded && vel.y <= 0) {
      // landing
      avatar?.land?.(Math.max(0, -prevVy));
      if (prevVy < -6) ctx.audio?.play?.('land', { volume: 0.4 });
    }
    prevVy = vel.y;
    wasGrounded = grounded;
  }
  let prevVy = 0;
  const dampAngle = (a, b, lambda, dt) => {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * (1 - Math.exp(-lambda * dt));
  };

  function behaviours() {
    for (const s of touched) {
      if (s.behavior === 'kill') return die();
      if (s.behavior === 'bounce' && vel.y < (s.part.props.bounce ?? 22) * 0.8) {
        const n = s.part.props.bounce ?? 22;
        vel.y = n;
        grounded = false;
        coyote = 0;
        ctx.audio?.play?.('boost', { volume: 0.5 });
      }
      if (s.checkpoint && checkpoint !== s.part && s.part !== startSpawn) {
        checkpoint = s.part;
        showBanner(t(TXT.checkpoint), s.part.name !== 'Checkpoint' ? s.part.name : '', 1.6);
        ctx.audio?.play?.('quest.update', { volume: 0.6 });
      }
      if (s.behavior === 'finish' && !finished) {
        finished = true;
        timing = false;
        let best = updateBest();
        const isBest = best == null || timer < best;
        if (isBest && hasFinish) {
          try {
            localStorage.setItem(bestKey, String(timer));
          } catch {
            /* ignore */
          }
          best = timer;
          updateBest();
        }
        showBanner(t(TXT.finish), hasFinish ? fmtTime(timer) : '', 4);
        ctx.audio?.play?.('quest.complete', { volume: 0.7 });
      }
    }
  }

  function updateDynamic(dt) {
    if (!dyn.length) return;
    const g = G * (exp.settings.gravity || 1);
    for (const d of dyn) {
      if (d.rest) continue;
      const s = d.shape;
      d.vy -= g * dt;
      const dy = d.vy * dt;
      // probe below the part's lowest point (ignore itself)
      const half = s.maxY - s.cy;
      const hit = world.raycast(s.cx, s.minY + 0.01, s.cz, 0, -1, 0, -dy + 0.02, (o) => o !== s && o.solid, hitTmp);
      if (hit) {
        d.part.p[1] = hit.y + half;
        d.rest = true;
        d.vy = 0;
      } else d.part.p[1] += dy;
      if (d.part.p[1] < -200) d.rest = true;
      shapeFromPart(d.part, s);
      world.update(s);
      stage.parts.updatePart(d.part);
    }
    let w = 0;
    for (let i = 0; i < dyn.length; i++) if (!dyn[i].rest) dyn[w++] = dyn[i];
    dyn.length = w;
  }

  // ------------------------------------------------------------- camera
  const head = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const camE = new THREE.Euler(0, 0, 0, 'YXZ');
  function placeCamera(dt, snap = false) {
    head.set(pos.x, pos.y + 1.55, pos.z);
    const dirX = Math.sin(camYaw) * Math.cos(camPitch);
    const dirY = -Math.sin(camPitch);
    const dirZ = Math.cos(camYaw) * Math.cos(camPitch);
    // collision along the boom
    let want = camDist;
    const hit = world.raycast(head.x, head.y, head.z, dirX, dirY, dirZ, camDist + 0.3, solid, hitTmp);
    if (hit) want = Math.max(0.8, hit.t - 0.35);
    camCur = snap ? want : want < camCur ? want : camCur + (want - camCur) * (1 - Math.exp(-5 * dt));
    camTarget.set(head.x + dirX * camCur, head.y + dirY * camCur, head.z + dirZ * camCur);
    camera.position.copy(camTarget);
    camera.quaternion.setFromEuler(camE.set(camPitch, camYaw, 0, 'YXZ'));
    camera.updateMatrixWorld();
  }

  // -------------------------------------------------------------- frame
  let acc = 0;
  function update(dt) {
    if (!running || !exp) return;
    dt = Math.min(dt, 0.1);
    // look
    camYaw -= input.lookX * 0.0032;
    camPitch = Math.max(-1.25, Math.min(0.9, camPitch - input.lookY * 0.0032));
    if (input.wheel) camDist = Math.max(2.5, Math.min(26, camDist * (1 + input.wheel * 0.12)));
    if (input.pressed('KeyR') && dead <= 0) respawn();
    // physics substeps
    acc += dt;
    const h0 = 1 / 120;
    let n = 0;
    while (acc >= h0 && n < 16) {
      step(h0);
      acc -= h0;
      n++;
    }
    if (n >= 16) acc = 0;
    behaviours();
    updateDynamic(dt);
    if (dead > 0) {
      dead -= dt;
      if (dead <= 0) respawn();
    }
    if (pos.y < -50) respawn();
    if (grounded) lastSafe.copy(pos);
    if (!Number.isFinite(pos.x + pos.y + pos.z)) pos.copy(lastSafe);
    if (timing && !finished) {
      timer += dt;
      timerVal.textContent = fmtTime(timer);
    } else if (hasFinish) timerVal.textContent = fmtTime(timer);
    // avatar
    if (avatar) {
      avatar.object.position.copy(pos);
      avatar.object.rotation.y = heading;
      avatar.object.visible = dead <= 0.3 || Math.floor(dead * 20) % 2 === 0;
      avatar.update(dt, Math.hypot(vel.x, vel.z), grounded, vel.y);
    }
    placeCamera(dt);
    stage.update(dt, camera, pos);
    ctx.audio?.setListener?.(camera);
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) banner.classList.remove('show');
    }
  }

  return {
    scene,
    camera,
    start,
    stop,
    update,
    respawn,
    /** Where Leave goes ('studio' for play-tests, else 'home' | 'title' | a world mode). */
    get from() {
      return opts.test ? 'studio' : opts.from || null;
    },
    get state() {
      return { pos: pos.clone(), vel: vel.clone(), grounded, checkpoint: checkpoint?.id || null, finished, timer, dead: dead > 0, dyn: dyn.length };
    },
    /** Test hook: teleport the player (feet) to x, y, z. */
    teleport(x, y, z) {
      pos.set(x, y, z);
      vel.set(0, 0, 0);
    },
  };
}
