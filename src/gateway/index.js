import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { ZONES } from '../world/layout.js';
import { S } from '../../shared/protocol.js';
import { REASONS } from '../../shared/defs/reasons.js';

/**
 * The hub Gateway (PLATFORM.md §11.2) — the way out to the survival world.
 *
 * An Ø ring just behind the Overlook spawn (south of it, so the title view north
 * stays clean), on the compass and minimap. Interact (E / touch action) → a menu:
 * Random wilderness (a safe spot 2–8 km out), My base (claim beacon), My spawn
 * beacon → C.TRAVEL via ctx.net.travel(to); the server moves the player.
 * Anywhere outside the hub: U = Return to hub (the server channels 10 s; moving,
 * damage or combat cancel it; U again cancels). Travel feedback as toasts.
 */
export function install(ctx) {
  const { events, ui, input, interactions, markers, loop, modes } = ctx;
  const sp = ZONES.spawn;
  const gx = sp.x;
  const gz = sp.z + 18;
  const gy = ctx.world.getHeightAt(gx, gz);

  // ------------------------------------------------------------------ model
  const group = new THREE.Group();
  group.name = 'gateway';
  const glow = new THREE.MeshStandardMaterial({ color: 0x0b1018, metalness: 0.75, roughness: 0.32, emissive: 0x7fe0ff, emissiveIntensity: 2.2 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b2028, metalness: 0.8, roughness: 0.38 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.22, 16, 72), glow);
  ring.position.y = 3.7;
  const slash = new THREE.Mesh(new THREE.BoxGeometry(0.26, 8.6, 0.26), glow);
  slash.position.y = 3.7;
  slash.rotation.z = -Math.PI / 4;
  const portal = new THREE.Mesh(
    new THREE.CircleGeometry(3.0, 64),
    new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  portal.position.y = 3.7;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.9, 0.45, 56), metal);
  pad.position.y = 0.1;
  const padRing = new THREE.Mesh(new THREE.TorusGeometry(4.1, 0.06, 8, 72), glow);
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.y = 0.36;
  for (const m of [ring, slash, pad]) m.castShadow = true;
  pad.receiveShadow = true;
  group.add(pad, padRing, ring, slash, portal);
  group.position.set(gx, gy, gz);
  ctx.world.scene.add(group);

  const anchor = new THREE.Vector3(gx, gy + 7.6, gz);
  const center = new THREE.Vector3(gx, gy + 1, gz);

  // ------------------------------------------------------------- the menu
  const net = () => (typeof ctx.net?.travel === 'function' ? ctx.net : null);
  const reasonText = (r) => t(REASONS[r] || { en: 'Not possible right now', nl: 'Nu niet mogelijk' });

  function go(to) {
    ui.closeModal('gateway');
    const n = net();
    if (!n) {
      ui.toast({ title: t({ en: 'Gateway offline', nl: 'Poort offline' }), text: t({ en: 'Travel needs the survival world (start the game online or offline, not in Studio).', nl: 'Reizen kan alleen in de survivalwereld.' }), kind: 'warn' });
      return;
    }
    n.travel(to);
  }

  function openMenu() {
    const h = ui.h.bind(ui);
    const opt = (to, title, sub, primary) =>
      h(
        'button',
        { class: `btn gw-opt${primary ? ' btn-primary' : ''}`, type: 'button', onclick: () => go(to), dataset: { sound: 'ui.click' } },
        h('span', { class: 'gw-opt-title', text: t(title) }),
        h('span', { class: 'gw-opt-sub', text: t(sub) }),
      );
    const el = h(
      'div',
      { class: 'panel gw-panel' },
      h('div', { class: 'gw-kicker', text: t({ en: 'Ø Gateway', nl: 'Ø Poort' }) }),
      h('h2', { class: 'gw-title', text: t({ en: 'Where to?', nl: 'Waarheen?' }) }),
      h('p', { class: 'gw-text', text: t({ en: 'The hub is a safe zone. Survival — gathering, building and fighting — starts out in the wilderness.', nl: 'De hub is een veilige zone. Survival — verzamelen, bouwen en vechten — begint buiten in de wildernis.' }) }),
      opt('wild', { en: 'Random wilderness', nl: 'Willekeurige wildernis' }, { en: 'A safe spot 2–8 km out — a fresh start', nl: 'Een veilige plek 2–8 km verderop — een frisse start' }, true),
      opt('base', { en: 'My base', nl: 'Mijn basis' }, { en: 'Your claim beacon', nl: 'Je claimbaken' }),
      opt('beacon', { en: 'My spawn beacon', nl: 'Mijn spawnbaken' }, { en: 'Where you respawn', nl: 'Waar je respawnt' }),
      h('div', { class: 'gw-foot', text: t({ en: 'Back to the hub any time: press U (outside the hub).', nl: 'Altijd terug naar de hub: druk op U (buiten de hub).' }) }),
      h('button', { class: 'btn gw-close', type: 'button', onclick: () => ui.closeModal('gateway'), text: t({ en: 'Close', nl: 'Sluiten' }) }),
    );
    ui.openModal('gateway', el);
  }

  interactions.add({
    id: 'gateway',
    scope: 'world',
    position: center,
    radius: 6.5,
    priority: 2,
    label: () => t({ en: 'Gateway — travel', nl: 'Poort — reizen' }),
    anchor,
    onInteract: openMenu,
  });
  markers.set('gateway', {
    position: anchor,
    label: t({ en: 'Gateway', nl: 'Poort' }),
    kind: 'poi',
    color: '#7fe0ff',
    compass: true,
  });

  // ------------------------------------------------- Return to hub (U)
  let channeling = false;
  loop.add(
    'gateway',
    (dt, time) => {
      portal.material.opacity = 0.12 + 0.07 * Math.sin(time * 2.1);
      ring.rotation.z = Math.sin(time * 0.35) * 0.03;
      if (!modes.is('explore') || !input.gameEnabled || !input.pressed('KeyU')) return;
      const n = net();
      if (!n) return;
      const p = ctx.player?.position;
      if (p && ctx.world.isSafe?.(p.x, p.z)) {
        ui.toast({ title: t({ en: 'You are in the hub', nl: 'Je bent in de hub' }), text: t({ en: 'The Gateway behind the Overlook takes you out to the wilderness.', nl: 'De poort achter het uitzichtpunt brengt je naar de wildernis.' }), kind: 'info' });
        return;
      }
      n.travel(channeling ? 'cancel' : 'hub');
    },
    { order: 47 },
  );

  // ------------------------------------------------------------- feedback
  const offs = [];
  const n0 = net();
  if (n0?.on) {
    offs.push(
      n0.on(S.TRAVEL, (m) => {
        if (m?.phase === 'channel' || m?.phase === 'start') {
          channeling = true;
          ui.toast({ title: t({ en: 'Returning to the hub…', nl: 'Terug naar de hub…' }), text: t({ en: 'Stay still for 10 seconds (U cancels).', nl: 'Blijf 10 seconden stil staan (U annuleert).' }), kind: 'info', duration: 4000 });
        } else if (m?.phase === 'cancel') {
          channeling = false;
          ui.toast({ title: t({ en: 'Travel cancelled', nl: 'Reis geannuleerd' }), text: reasonText(m.reason), kind: 'warn' });
        } else if (m?.phase === 'done') {
          channeling = false;
          const toHub = m.to === 'hub';
          ui.toast({
            title: toHub ? t({ en: 'Back in the hub', nl: 'Terug in de hub' }) : t({ en: 'Welcome to the wilderness', nl: 'Welkom in de wildernis' }),
            text: toHub
              ? t({ en: 'Safe zone — no combat, no building.', nl: 'Veilige zone — geen gevechten, niet bouwen.' })
              : t({ en: 'Gather, build (B → 7: Workbench) and watch out at night. U = back to the hub.', nl: 'Verzamel, bouw (B → 7: Werkbank) en let op in de nacht. U = terug naar de hub.' }),
            kind: toHub ? 'info' : 'success',
            duration: 5200,
          });
        }
      }),
    );
  }
  offs.push(
    events.on('net:deny', (d) => {
      if (d?.of !== 'travel') return;
      channeling = false;
      ui.toast({ title: t({ en: 'Gateway', nl: 'Poort' }), text: reasonText(d.reason), kind: 'warn' });
    }),
  );

  // ------------------------------------------------------------------ css
  const style = document.createElement('style');
  style.textContent = `
    .gw-panel{width:min(420px,calc(100vw - 32px));padding:22px 22px 18px;display:flex;flex-direction:column;gap:10px}
    .gw-kicker{font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--cyan,#7fe0ff)}
    .gw-title{margin:0;font-weight:300;font-size:26px;letter-spacing:.06em}
    .gw-text{margin:0 0 6px;opacity:.75;font-size:13px;line-height:1.5}
    .gw-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:12px 14px}
    .gw-opt-title{font-size:15px}
    .gw-opt-sub{font-size:12px;opacity:.65}
    .gw-foot{font-size:12px;opacity:.6;margin-top:4px}
    .gw-close{align-self:flex-end}
  `;
  document.head.appendChild(style);

  return {
    position: center.clone(),
    open: openMenu,
    dispose() {
      offs.forEach((off) => off?.());
      interactions.remove('gateway');
      markers.remove('gateway');
      loop.remove('gateway');
      group.removeFromParent();
    },
  };
}
