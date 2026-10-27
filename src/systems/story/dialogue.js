/**
 * Dialogue system ("Create your own story" / "Maak je eigen verhaal"): bottom-centre panel with the NPC
 * portrait, speaker name + role, typewriter text and numbered choices
 * (keys 1–9 or click; Space/Enter skips the typewriter). Shown as a modal
 * (ctx.ui.openModal) so gameplay input pauses; the camera frames the NPC over
 * the player's shoulder while it is open.
 * Emits dialogue:open {id, npc}, dialogue:choice {id, node, choice}, dialogue:close {id}.
 */
import * as THREE from 'three';
import '../css/dialogue.css';
import { ZONES, TRAVEL } from '../../world/layout.js';
import { damp, dampAngle } from '../../core/math.js';
import { t } from '../../core/i18n.js';
import { fill, headingTo, isNight, groundY, rewardText, partOfDayText } from '../shared/util.js';
import { buildTrees, genericTree } from './trees.js';

const CPS = 54; // typewriter characters per second

const PLACE_TIPS = {
  lookout: {
    en: 'The Lookout in the western hills. From the top you can see the whole lake, the waterfalls and Aurora City.',
    nl: 'De uitkijkpost op de westelijke heuvels. Vanaf de top zie je het hele meer, de watervallen en Aurora-stad.',
  },
  ruins: {
    en: 'The Ancient Ruins east of the Overlook. Broken pillars, ivy and an inscription that lights up when you scan it.',
    nl: 'De oude ruïnes ten oosten van het uitzichtpunt. Gebroken pilaren, klimop en een inscriptie die oplicht als je hem scant.',
  },
  signal: {
    en: 'The Signal on the north shore of the lake. An obelisk of black crystal — and Aria, who always seems to be waiting there.',
    nl: 'Het signaal aan de noordoever van het meer. Een obelisk van zwart kristal — en Aria die er altijd lijkt te wachten.',
  },
  waterfall: {
    en: 'The great waterfall in the northwest. Go at sunset: that is when there is gold in the mist.',
    nl: 'De grote waterval in het noordwesten. Ga bij zonsondergang: dan hangt er goud in de nevel.',
  },
  base: {
    en: 'The clearing in the forest, southwest of the Overlook. Your glass house stands there — with room to build.',
    nl: 'De open plek in het bos, ten zuidwesten van het uitzichtpunt. Daar staat jouw glazen huis — en ruimte om te bouwen.',
  },
  plaza: {
    en: 'Nexus Plaza, around the purple Tree of Life. Everyone gathers there, especially at night.',
    nl: 'Het Nexus-plein rond de paarse Levensboom. Iedereen komt daar samen, zeker ’s nachts.',
  },
  spaceport: {
    en: 'The Spaceport south of the plaza. Ships, a VTOL and the enormous colony ship in the hangar.',
    nl: 'De ruimtehaven ten zuiden van het plein. Schepen, een VTOL en het enorme kolonieschip in de hangar.',
  },
};

/** Default player name when the profile has none. */
const TRAVELER = { en: 'Traveler', nl: 'Reiziger' };
const CHOOSE = { en: 'choose', nl: 'kiezen' };
const CLOSE = { en: 'close', nl: 'sluiten' };

export function createDialogue(ctx, { refs, rewards, portraits }) {
  const { ui } = ctx;
  const trees = buildTrees();
  const h = makeHelpers(ctx, refs, rewards);
  let cur = null;

  // ---------------------------------------------------------------- helpers
  function treeFor(id) {
    if (trees[id]) return trees[id];
    const npc = ctx.npcs?.get?.(id);
    if (!npc) return null;
    return genericTree(id, npc.name, h);
  }

  const _npcPos = new THREE.Vector3();
  /** Where an NPC stands: the live NPC, landmark data (Oran's stall) or a fallback spot. */
  function npcPosition(id) {
    const p = ctx.npcs?.get?.(id)?.position;
    if (p?.isVector3) return _npcPos.copy(p);
    const lm = id === 'oran' ? ctx.landmarks?.plaza?.bazaar?.oran : null;
    if (lm?.isVector3) return _npcPos.copy(lm);
    const tr = trees[id];
    const pt = tr?.position || fallbackSpot(id);
    return pt ? _npcPos.set(pt.x, groundY(ctx, pt.x, pt.z), pt.z) : null;
  }
  /** Where the player can talk to an NPC that has no character model (Oran: in front of his counter). */
  function talkSpot(id) {
    const c = id === 'oran' ? ctx.landmarks?.plaza?.bazaar?.oranCounter : null;
    if (c?.isVector3) return c;
    return trees[id]?.position || fallbackSpot(id);
  }

  // ---------------------------------------------------------------- UI
  function build(tree) {
    const refsUI = {};
    // the real portrait is rendered right after the panel starts sliding in (it can take a
    // moment the first time); until then the drawn stand-in shows, then it cross-fades
    refsUI.portrait = ui.h('div', { class: 'sys-dlg-portrait' });
    const pic = portraits.canvasAsync(tree.id, tree, 356, 444, (real) => {
      if (!refsUI.portrait.isConnected) return;
      real.classList.add('fresh');
      refsUI.portrait.appendChild(real);
      requestAnimationFrame(() => requestAnimationFrame(() => real.classList.add('in')));
      setTimeout(() => {
        if (real.classList.contains('in')) pic.canvas.remove();
      }, 900);
    });
    refsUI.portrait.appendChild(pic.canvas);
    refsUI.name = ui.h('span', { class: 'sys-dlg-name', text: t(tree.name) });
    refsUI.role = ui.h('span', { class: 'sys-dlg-role', text: t(tree.role) });
    refsUI.shown = ui.h('span', { class: 'sys-dlg-shown' });
    refsUI.rest = ui.h('span', { class: 'sys-dlg-rest' });
    refsUI.text = ui.h('div', { class: 'sys-dlg-text' }, refsUI.shown, refsUI.rest);
    refsUI.hint = ui.h('div', {
      class: 'sys-dlg-hint',
      html: `<span class="kbd">1</span>–<span class="kbd">3</span> ${t(CHOOSE)} &nbsp;·&nbsp; <span class="kbd">Esc</span> ${t(CLOSE)}`,
    });
    // little voice meter beside the name while the line types out
    refsUI.voice = ui.h('span', { class: 'sys-dlg-voice', 'aria-hidden': 'true' }, ui.h('i'), ui.h('i'), ui.h('i'), ui.h('i'));
    refsUI.box = ui.h(
      'div',
      { class: 'sys-dlg-box', onclick: () => cur?.typing && finishTyping() },
      ui.h('div', { class: 'sys-dlg-speaker' }, refsUI.name, refsUI.voice, refsUI.role, refsUI.hint),
      refsUI.text,
    );
    refsUI.list = ui.h('ol', { class: 'sys-dlg-choices' });
    // the poster's caption for this feature, small above the panel
    const kicker = ui.h('div', { class: 'sys-dlg-kicker' }, ui.h('span', { class: 'sys-dlg-kicker-ic', html: ui.icon('emblem', 13) }), ui.h('span', { text: t({ en: 'Create your own story', nl: 'Maak je eigen verhaal' }) }));
    const el = ui.h('div', { class: 'sys-dlg', role: 'dialog', 'aria-label': t({ en: 'Conversation with {name}', nl: 'Gesprek met {name}' }, { name: t(tree.name) }) }, kicker, refsUI.portrait, ui.h('div', { class: 'sys-dlg-main' }, refsUI.box, refsUI.list));
    el.style.setProperty('--accent', tree.accent || '#7fe0ff');
    return { el, ...refsUI };
  }

  function renderNode(text, choices) {
    const u = cur.ui;
    cur.full = text;
    cur.n = 0;
    cur.t0 = performance.now();
    cur.typing = true;
    u.box.classList.add('typing');
    u.shown.textContent = '';
    u.rest.textContent = text;
    u.list.classList.remove('ready');
    u.list.textContent = '';
    // key hint matches the number of choices ("1–4 choose", or Space for a single answer)
    const n = choices.length;
    const hint = n > 1 ? `<span class="kbd">1</span>–<span class="kbd">${n}</span> ${t(CHOOSE)}` : t({ en: '<span class="kbd">Space</span> continue', nl: '<span class="kbd">Spatie</span> verder' });
    if (u.hint.dataset.n !== String(n)) {
      u.hint.dataset.n = String(n);
      u.hint.innerHTML = `${hint} &nbsp;·&nbsp; <span class="kbd">Esc</span> ${t(CLOSE)}`;
    }
    choices.forEach((c, i) => {
      const li = ui.h(
        'li',
        {
          class: `sys-dlg-choice${c.end ? ' is-end' : ''}`,
          onclick: (e) => {
            e.stopPropagation();
            choose(i);
          },
          onmouseenter: () => ctx.audio.play('ui.hover'),
        },
        ui.h('span', { class: 'sys-dlg-num', text: String(i + 1) }),
        ui.h('span', { class: 'sys-dlg-ctext', text: t(c.text) }),
        c.tag ? ui.h('span', { class: 'sys-dlg-tag', text: t(c.tag) }) : null,
      );
      li.style.setProperty('--i', i);
      u.list.appendChild(li);
    });
    cancelAnimationFrame(cur.raf);
    cur.raf = requestAnimationFrame(typeStep);
  }

  function typeStep() {
    if (!cur || !cur.typing) return;
    const n = Math.min(cur.full.length, Math.floor(((performance.now() - cur.t0) / 1000) * CPS));
    if (n !== cur.n) {
      cur.n = n;
      cur.ui.shown.textContent = cur.full.slice(0, n);
      cur.ui.rest.textContent = cur.full.slice(n);
    }
    if (n >= cur.full.length) finishTyping();
    else cur.raf = requestAnimationFrame(typeStep);
  }

  function finishTyping() {
    if (!cur) return;
    cancelAnimationFrame(cur.raf);
    cur.typing = false;
    cur.ui.box.classList.remove('typing');
    cur.ui.shown.textContent = cur.full;
    cur.ui.rest.textContent = '';
    cur.ui.list.classList.add('ready');
  }

  // ---------------------------------------------------------------- flow
  function resolve(v) {
    try {
      return typeof v === 'function' ? v(h) : v;
    } catch (err) {
      console.warn('[dialogue] node function failed', err);
      return null;
    }
  }

  function goto(nodeId) {
    if (!cur) return;
    const node = nodeId && cur.tree.nodes[nodeId];
    if (!node) {
      close();
      return;
    }
    cur.nodeId = nodeId;
    resolve(node.onEnter);
    if (!cur) return; // onEnter may have closed the dialogue
    // template variables: {name} (player), {daypart} ("evening" / "avond"; {dagdeel} = old alias)
    const daypart = partOfDayText(ctx);
    const vars = { name: ctx.state.get('profile.name') || t(TRAVELER), daypart, dagdeel: daypart };
    const text = fill(t(resolve(node.text)) || '…', vars);
    let choices = (resolve(node.choices) || []).filter((c) => !c.if || resolve(c.if));
    if (!choices.length) choices = [{ text: { en: 'Goodbye.', nl: 'Tot ziens.' }, end: true }];
    cur.choices = choices;
    renderNode(text, choices);
  }

  function choose(i) {
    if (!cur) return;
    const c = cur.choices?.[i];
    if (!c || cur.choosing) return;
    if (cur.typing) finishTyping();
    cur.choosing = true;
    ctx.audio.play('ui.click');
    const li = cur.ui.list.children[i];
    li?.classList.add('chosen');
    ctx.events.emit('dialogue:choice', { id: cur.id, node: cur.nodeId, choice: i, text: t(c.text) });
    resolve(c.do);
    const id = cur.id;
    setTimeout(() => {
      if (!cur || cur.id !== id) return;
      cur.choosing = false;
      if (c.market) {
        close();
        refs.economy?.open?.(c.market);
        return;
      }
      if (c.end || !c.next) close();
      else goto(c.next);
    }, 140);
  }

  function onKey(e) {
    if (!cur) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) {
      e.preventDefault();
      e.stopPropagation();
      choose(Number(m[1]) - 1);
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (cur.typing) finishTyping();
      else if (cur.choices?.length === 1) choose(0);
    }
  }

  // ---------------------------------------------------------------- open / close
  function open(npcId, nodeId = null) {
    const tree = treeFor(npcId);
    if (!tree) {
      console.warn(`[dialogue] no dialogue for "${npcId}"`);
      return false;
    }
    if (cur) close();
    if (document.activeElement?.blur && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) document.activeElement.blur();
    const u = build(tree);
    cur = { id: npcId, tree, ui: u, nodeId: null, choices: [], typing: false, raf: 0 };
    ui.openModal('dialogue', u.el, { className: 'sys-dlg-wrap', closeOnBackdrop: false, onClose: () => cleanup() });
    document.body.classList.add('sys-dlg-open');
    window.addEventListener('keydown', onKey, true);
    focusCamera(npcId, tree.cam);
    ctx.audio.play('dialogue.open');
    ctx.events.emit('dialogue:open', { id: npcId, npc: npcId });
    goto(nodeId && tree.nodes[nodeId] ? nodeId : resolve(tree.start) || Object.keys(tree.nodes)[0]);
    return true;
  }

  function cleanup() {
    if (!cur) return;
    const id = cur.id;
    cancelAnimationFrame(cur.raf);
    window.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('sys-dlg-open');
    cur = null;
    releaseCamera();
    ctx.events.emit('dialogue:close', { id });
  }

  function close() {
    if (!cur) return;
    if (!ui.closeModal('dialogue')) cleanup();
  }

  // ---------------------------------------------------------------- camera framing
  // Over-the-shoulder shot like 08_npc_dialogue / 10_signal_aria: the camera sits close behind
  // the player's right shoulder (zoom, shoulder) at head height (pitch ≈ 0) and aims at chest
  // height (aim), so the player's head lands left of centre and both heads sit in the upper
  // third, above the dialogue panel. The yaw offset δ is solved every frame so the NPC's head
  // lands at screen x = npcX whatever the talking distance D: the rig orbits a pivot `sh` right
  // of the player at distance `dist`, so a point D ahead of the player projects at
  //   x_cam / z_cam = (D·sinδ − sh) / (dist + D·cosδ)  ⇒  δ = atan(k) + asin((sh + k·dist) / (D·√(1 + k²)))
  // with k = (npcX − 0.5) · 2 · tan(hfov / 2).
  const CAM_DEFAULT = { zoom: 1.95, pitch: -0.04, aim: -0.6, shoulder: 0.62, npcX: 0.63 };
  const cam = { active: false, heading: 0, saved: null, restore: 0, npc: null, preset: CAM_DEFAULT };
  function yawOffset(D, preset) {
    const c = ctx.camera;
    const tanH = Math.tan(((c?.fov || 55) * Math.PI) / 360) * (c?.aspect || 16 / 9);
    const k = (preset.npcX - 0.5) * 2 * tanH;
    const s = (preset.shoulder + k * preset.zoom) / (Math.max(0.5, D) * Math.sqrt(1 + k * k));
    return Math.min(1.15, Math.atan(k) + Math.asin(Math.min(1, s)));
  }
  function focusCamera(npcId, preset) {
    const rig = ctx.cameraRig;
    const p = ctx.player?.position;
    if (!rig || !p || !ctx.modes.is('explore')) return;
    const n = npcPosition(npcId);
    if (!n || Math.hypot(n.x - p.x, n.z - p.z) > 14 || Math.hypot(n.x - p.x, n.z - p.z) < 0.5) return;
    cam.saved = cam.saved || { distance: rig._zoom ?? rig.distance, pitch: rig.pitch, aim: rig.aimHeight, shoulder: rig.shoulder };
    cam.heading = headingTo(p.x, p.z, n.x, n.z);
    cam.active = true;
    cam.restore = 0;
    cam.npc = npcId;
    cam.preset = { ...CAM_DEFAULT, ...(preset || {}) };
    // (no npc.lookAt override: the characters module already turns named NPCs
    // toward a nearby player and looks at them; an override would disable that)
  }
  function releaseCamera() {
    cam.npc = null;
    if (!cam.active) return;
    cam.active = false;
    cam.restore = 0.9;
  }
  // the characters rig zooms toward rig._zoom; older rigs use rig.distance directly
  function zoomTo(rig, d, rate, dt) {
    if (typeof rig._zoom === 'number') rig._zoom = damp(rig._zoom, d, rate, dt);
    else rig.distance = damp(rig.distance, d, rate, dt);
  }
  /** Eases a numeric rig field (aimHeight, shoulder) when the rig has it. */
  function easeField(rig, key, to, rate, dt) {
    if (typeof rig[key] === 'number' && typeof to === 'number') rig[key] = damp(rig[key], to, rate, dt);
  }
  ctx.loop.add(
    'sys-dialogue-cam',
    (dt) => {
      const rig = ctx.cameraRig;
      if (!rig || !ctx.modes.is('explore')) return;
      if (cam.active) {
        // keep facing the NPC even while it settles into place
        const n = npcPosition(cam.npc);
        const p = ctx.player?.position;
        const D = n && p ? Math.hypot(n.x - p.x, n.z - p.z) : 2.4;
        if (n && p && D > 0.5) cam.heading = headingTo(p.x, p.z, n.x, n.z);
        // over-the-shoulder: player left, NPC right of frame (like the concept art)
        rig.yaw = dampAngle(rig.yaw, cam.heading + yawOffset(D, cam.preset), 3.5, dt);
        rig.pitch = damp(rig.pitch, cam.preset.pitch, 3, dt);
        easeField(rig, 'aimHeight', cam.preset.aim, 3, dt);
        easeField(rig, 'shoulder', cam.preset.shoulder, 3, dt);
        zoomTo(rig, cam.preset.zoom, 3, dt);
        if (ctx.player && typeof ctx.player.heading === 'number') ctx.player.heading = dampAngle(ctx.player.heading, cam.heading, 6, dt);
        // the NPC turns to the player for the whole conversation and visibly
        // speaks (talk animation) while its line types out
        const npc = ctx.npcs?.get?.(cam.npc);
        if (npc && n && p) {
          if ('faceHeading' in npc) npc.faceHeading = headingTo(n.x, n.z, p.x, p.z);
          if (cur?.typing) npc.talkT = Math.max(npc.talkT || 0, 0.3);
        }
      } else if (cam.restore > 0 && cam.saved) {
        cam.restore -= dt;
        zoomTo(rig, cam.saved.distance, 4, dt);
        rig.pitch = damp(rig.pitch, cam.saved.pitch, 4, dt);
        easeField(rig, 'aimHeight', cam.saved.aim, 4, dt);
        easeField(rig, 'shoulder', cam.saved.shoulder, 4, dt);
        if (cam.restore <= 0) {
          if (typeof cam.saved.aim === 'number') rig.aimHeight = cam.saved.aim;
          if (typeof cam.saved.shoulder === 'number') rig.shoulder = cam.saved.shoulder;
          cam.saved = null;
        }
      }
    },
    { order: 19 },
  );

  // ---------------------------------------------------------------- portrait pre-warming
  // Renders the portrait of a story NPC the player walks up to in the background, so the
  // dialogue opens with the real portrait instead of the stand-in (only once a first
  // dialogue has compiled the portrait studio; see shared/portraits.js).
  let warmAcc = 0;
  ctx.loop.add(
    'sys-portrait-warm',
    (dt) => {
      warmAcc += dt;
      if (warmAcc < 1.5) return;
      warmAcc = 0;
      if (cur || ui.isModalOpen() || !ctx.modes.is('explore')) return;
      const p = ctx.player?.position;
      if (!p) return;
      for (const id in trees) {
        if (portraits.has(id)) continue;
        const n = ctx.npcs?.get?.(id)?.position;
        if (n && Math.hypot(n.x - p.x, n.z - p.z) < 16) {
          portraits.warm(id, trees[id]);
          return; // one at a time
        }
      }
    },
    { order: 49 },
  );

  // ---------------------------------------------------------------- triggers
  ctx.events.on('npc:interact', (p) => {
    const id = p?.id;
    if (!id || ui.isModalOpen() || cur) return;
    open(id);
  });

  // Talk points for story NPCs the characters module doesn't provide.
  for (const tr of Object.values(trees)) {
    if (!talkSpot(tr.id)) continue;
    const v = new THREE.Vector3();
    ctx.interactions.add({
      id: `sys-talk-${tr.id}`,
      scope: 'world',
      position: () => {
        const spot = talkSpot(tr.id);
        return spot.isVector3 ? v.copy(spot) : v.set(spot.x, groundY(ctx, spot.x, spot.z) + 0.9, spot.z);
      },
      radius: 3.4,
      label: t({ en: 'Talk — {name}', nl: 'Praten — {name}' }, { name: t(tr.name) }),
      priority: 1,
      enabled: () => !ctx.npcs?.get?.(tr.id) && !cur,
      onInteract: () => open(tr.id),
    });
  }

  return {
    open,
    close,
    get isOpen() {
      return !!cur;
    },
    get current() {
      return cur ? { npc: cur.id, node: cur.nodeId } : null;
    },
    trees,
    helpers: h,
    npcPosition,
    /** Lets other modules add or replace a dialogue tree at runtime. */
    register(id, tree) {
      trees[id] = { id, ...tree };
    },
  };
}

/** Where a story NPC stands if the characters module has no model for it. */
function fallbackSpot(id) {
  const P = ZONES.plaza;
  switch (id) {
    case 'aria':
      return { x: ZONES.signal.x + 5, z: ZONES.signal.z + 6 };
    case 'luna':
      return { x: P.x + 10, z: P.z + 24 };
    case 'kai':
      return { x: P.x - 14, z: P.z + 20 };
    case 'nova':
      return { x: P.x + 22, z: P.z + 14 };
    case 'yara':
      return { x: P.stage.x - 8, z: P.stage.z + 14 };
    case 'milan':
      return { x: P.x - 22, z: P.z - 6 };
    default:
      return null;
  }
}

function makeHelpers(ctx, refs, rewards) {
  return {
    ctx,
    flag: (n) => rewards.flag(n),
    setFlag: (n, v = true) => rewards.setFlag(n, v),
    lore: (id) => rewards.unlockLore(id),
    /** Grants `r`; `label` ({en, nl} or text) titles the reward toast. */
    reward(r, label) {
      rewards.grant(r);
      if (label) ctx.ui.toast({ title: t(label), text: rewardText(r), icon: 'gift', kind: 'reward', duration: 3200 });
      ctx.audio.play('reward');
    },
    quest: {
      start: (id, o) => refs.quests?.start(id, o),
      has: (id) => !!refs.quests?.has(id),
      isActive: (id) => !!refs.quests?.isActive(id),
      isDone: (id) => !!refs.quests?.isDone(id),
      objectiveDone: (id, o) => !!refs.quests?.objectiveDone(id, o),
    },
    party: {
      join: (id) => refs.party?.join(id),
      leave: (id) => refs.party?.leave(id),
      has: (id) => !!refs.party?.has(id),
      full: () => !!refs.party?.full?.(),
    },
    event: {
      start: (id) => refs.events?.start(id),
      isActive: (id) => !!refs.events?.isActive(id),
    },
    night: () => isNight(ctx),
    zone: () => refs.zones?.current || null,
    suggestPlace() {
      const todo = TRAVEL.filter((z) => PLACE_TIPS[z] && !refs.progress?.isDiscovered(z));
      if (!todo.length) return t({ en: "You've seen it all already? Then it's time for the stars. Station Halo is waiting for you.", nl: 'Je hebt alles al gezien? Dan wordt het tijd voor de sterren. Station Halo wacht op je.' });
      return t(PLACE_TIPS[todo[Math.floor(Math.random() * todo.length)]]);
    },
  };
}
