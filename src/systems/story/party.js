/**
 * Party: NPCs that follow the player (ctx.npcs.get(id).follow(player.object)),
 * persisted in state.systems.party, plus the party list widget in the right
 * HUD slot (portrait avatars or initials, status "Following you" / distance).
 */
import * as THREE from 'three';
import { t } from '../../core/i18n.js';
import { fmtDist, playerPos, zoneAt, zoneLabel } from '../shared/util.js';

export function createParty(ctx, { trees, portraits, notify, refs }) {
  const { ui, state } = ctx;
  const members = () => [...(state.get('systems.party') || [])];
  const has = (id) => members().includes(id);
  const nameOf = (id) => t(trees[id]?.name || ctx.npcs?.get?.(id)?.name || id);
  const FOLLOWING = { en: 'Following you', nl: 'Volgt je' };

  function applyFollow(id, on) {
    try {
      const npc = ctx.npcs?.get?.(id);
      if (!npc?.follow) return false;
      npc.follow(on ? ctx.player?.object || null : null);
      return true;
    } catch (err) {
      console.warn('[party] follow failed', id, err);
      return false;
    }
  }

  const MAX = 3; // companions (the widget shows "n/4" including the player)
  const full = () => members().length >= MAX;

  function join(id, { silent = false } = {}) {
    if (!id || has(id)) return false;
    if (full()) {
      if (!silent) notify.show({ kind: 'event', icon: 'party', title: t({ en: 'Your party is full', nl: 'Je groep is vol' }), sub: t({ en: 'Up to 4 players', nl: 'Maximaal 4 spelers' }), sound: 'ui.error', duration: 2600 });
      return false;
    }
    state.set('systems.party', [...members(), id]);
    applyFollow(id, true);
    if (!silent) {
      notify.show({
        kind: 'event',
        icon: 'party',
        title: t({ en: '{name} joins your party', nl: '{name} sluit zich aan bij je groep' }, { name: nameOf(id) }),
        sub: t({ en: 'Party {n}/4', nl: 'Groep {n}/4' }, { n: members().length + 1 }),
        sound: 'reward',
        duration: 3200,
      });
      refs.chat?.system?.(t({ en: '{name} has joined your party.', nl: '{name} heeft zich bij je groep gevoegd.' }, { name: nameOf(id) }));
    }
    ctx.events.emit('party:join', { id });
    render();
    return true;
  }

  function leave(id, { silent = false } = {}) {
    if (!has(id)) return false;
    state.set('systems.party', members().filter((m) => m !== id));
    applyFollow(id, false);
    if (!silent) refs.chat?.system?.(t({ en: '{name} has left your party.', nl: '{name} heeft je groep verlaten.' }, { name: nameOf(id) }));
    ctx.events.emit('party:leave', { id });
    render();
    return true;
  }

  // ---------------------------------------------------------------- widget
  const list = ui.h('div', { class: 'sys-party-list' });
  const count = ui.h('b');
  const el = ui.h('div', { class: 'sys-party' }, ui.h('div', { class: 'sys-party-head', html: `${ui.icon('party', 15)}<span>${t({ en: 'Party', nl: 'Groep' })}</span>` }, count), list);
  ui.addWidget('right', el, { modes: ['explore', 'drive'], order: 10 });
  const rows = new Map(); // id → {row, status, dot}

  function avatarFor(id) {
    const tr = trees[id];
    const av = ui.h('div', { class: 'sys-party-avatar', text: (nameOf(id) || '?').slice(0, 1).toUpperCase() });
    av.style.setProperty('--av', tr?.accent || '#b48cff');
    const info = tr || { id, name: nameOf(id) };
    try {
      if (portraits.has?.(id)) av.appendChild(portraits.avatar(id, info, 72));
      else {
        // initials until the NPC's portrait exists (rendered in the background once the
        // portrait studio is warm, or by the next dialogue with them), then the face
        portraits.request?.(
          id,
          info,
          () => {
            if (!av.isConnected) return;
            av.querySelector('canvas')?.remove();
            av.appendChild(portraits.avatar(id, info, 72));
          },
          { optional: true },
        );
      }
    } catch {
      /* initials only */
    }
    return av;
  }

  function render() {
    const ids = members();
    ui.setVisible(el, ids.length > 0);
    count.textContent = ids.length ? `${ids.length + 1}/4` : '';
    for (const [id, r] of rows) {
      if (!ids.includes(id)) {
        r.row.remove();
        rows.delete(id);
      }
    }
    for (const id of ids) {
      if (rows.has(id)) continue;
      const status = ui.h('div', { class: 'sys-party-status', text: t(FOLLOWING) });
      const dot = ui.h('span', { class: 'sys-party-dot' });
      const row = ui.h('div', { class: 'sys-party-member' }, avatarFor(id), ui.h('div', { class: 'sys-party-info' }, ui.h('div', { class: 'sys-party-name', text: nameOf(id) }), status), dot);
      list.appendChild(row);
      rows.set(id, { row, status, dot, last: '' });
    }
    updateStatus();
  }

  const _p = new THREE.Vector3();
  function updateStatus() {
    const p = playerPos(ctx, _p);
    for (const [id, r] of rows) {
      const n = ctx.npcs?.get?.(id)?.position;
      let text = t(FOLLOWING);
      let far = false;
      if (p && n) {
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d > 30) {
          far = true;
          const z = zoneAt(n.x, n.z);
          text = `${fmtDist(d)}${z ? ` · ${zoneLabel(z)}` : ''}`;
        }
      } else if (!n) text = t({ en: 'Party chat', nl: 'Groepschat' });
      if (text !== r.last) {
        r.last = text;
        r.status.textContent = text;
        r.dot.classList.toggle('far', far);
      }
    }
  }

  let acc = 0;
  ctx.loop.add(
    'sys-party',
    (dt) => {
      acc += dt;
      if (acc < 0.5) return;
      acc = 0;
      if (rows.size && !el.hidden) updateStatus();
    },
    { order: 95 },
  );

  /** Re-applies follows after load (NPCs exist once the world is running). */
  function restore() {
    for (const id of members()) applyFollow(id, true);
    render();
  }
  ctx.events.on('game:start', restore);
  ctx.events.on('state:reset', () => {
    for (const id of [...rows.keys()]) applyFollow(id, false);
    render();
  });
  render();

  return {
    join,
    leave,
    has,
    full,
    get members() {
      return members();
    },
    get size() {
      return members().length;
    },
    nameOf,
    render,
    el,
  };
}
