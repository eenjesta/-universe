/**
 * Loot crates (S.LOOT / welcome.loot): glowing supply crates on the ground with a
 * soft light beam — cyan for public crates (enemy drops), gold for your own death
 * crate, dim red for someone else's (owner-only for 10 minutes). [E] picks a crate
 * up (C.PICKUP {loot}); labels above the nearest crates show "Your crate · 9:41" /
 * "<name>'s crate" / "Supplies". Your death drop gets a compass + map marker
 * (ctx.markers 'smp-drop') with a countdown.
 * Rendering: three InstancedMeshes (body, light strips, beam) for all crates.
 */
import * as THREE from 'three';
import { C } from '../../shared/protocol.js';
import { LOOT, DEATH_DROP, RESOURCES, AMMO, ITEMS } from '../../shared/defs/items.js';
import { WEAPONS } from '../../shared/defs/weapons.js';
import { t } from '../core/i18n.js';
import { GeoBuilder } from '../build/geo.js';
import { bundleList, clock } from './logic.js';

const CAP0 = 32;
const LABELS = 6;
const LABEL_DIST = 32;

const TXT = {
  open: { en: 'Open your crate', nl: 'Open je krat' },
  pick: { en: 'Pick up supplies', nl: 'Voorraad oppakken' },
  yours: { en: 'Your crate', nl: 'Jouw krat' },
  theirs: { en: '{name}’s crate', nl: 'Krat van {name}' },
  locked: { en: 'Locked crate', nl: 'Vergrendelde krat' },
  supplies: { en: 'Supplies', nl: 'Voorraad' },
  dropMarker: { en: 'Your items · {t}', nl: 'Jouw spullen · {t}' },
  got: { en: 'Picked up', nl: 'Opgepakt' },
  dropTitle: { en: 'You dropped your supplies', nl: 'Je hebt je voorraad laten vallen' },
  dropText: { en: 'Your crate waits where you fell for 10 minutes — only you can open it.', nl: 'Je krat wacht 10 minuten waar je viel — alleen jij kunt hem openen.' },
};

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function crateGeometry() {
  const body = new GeoBuilder();
  body.box(0.92, 0.5, 0.62, 0, 0.25, 0, { color: 0x2c3038 });
  body.box(0.96, 0.08, 0.66, 0, 0.53, 0, { color: 0x1c1f24 });
  body.box(0.98, 0.06, 0.68, 0, 0.03, 0, { color: 0x1c1f24 });
  for (const sx of [-1, 1]) body.box(0.05, 0.5, 0.66, sx * 0.44, 0.27, 0, { color: 0x15171b });
  body.box(0.3, 0.1, 0.02, 0, 0.36, -0.315, { color: 0xc4c8ce });
  const strips = new GeoBuilder();
  strips.box(0.8, 0.035, 0.02, 0, 0.18, -0.315, { color: 0xffffff });
  strips.box(0.8, 0.035, 0.02, 0, 0.18, 0.315, { color: 0xffffff });
  strips.box(0.02, 0.035, 0.5, -0.465, 0.18, 0, { color: 0xffffff });
  strips.box(0.02, 0.035, 0.5, 0.465, 0.18, 0, { color: 0xffffff });
  strips.box(0.5, 0.02, 0.3, 0, 0.575, 0, { color: 0xffffff });
  // beam: open cylinder, white at the bottom fading to black (invisible with additive blending)
  const beam = new THREE.CylinderGeometry(0.42, 0.3, 5.5, 14, 4, true).translate(0, 2.75, 0);
  const pos = beam.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.max(0, 1 - pos.getY(i) / 5.5);
    const v = k * k * 0.55;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  beam.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return { body: body.build(), strips: strips.build(), beam };
}

const COL_PUBLIC = new THREE.Color(0.35, 0.85, 1.0).multiplyScalar(2.6);
const COL_MINE = new THREE.Color(1.0, 0.72, 0.35).multiplyScalar(2.8);
const COL_OTHER = new THREE.Color(1.0, 0.3, 0.26).multiplyScalar(1.2);
const BEAM_PUBLIC = new THREE.Color(0.3, 0.8, 1.0);
const BEAM_MINE = new THREE.Color(1.0, 0.68, 0.3);
const BEAM_OTHER = new THREE.Color(0.5, 0.14, 0.12);

export function createLoot(ctx, smp) {
  const { ui, events } = ctx;
  const scene = ctx.world?.scene;
  const crates = new Map(); // id → crate
  const list = []; // dense array (instance order)
  const geo = crateGeometry();
  const mats = {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.55, name: 'smp-crate' }),
    strips: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true, name: 'smp-crate-strips' }),
    beam: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, name: 'smp-crate-beam' }),
  };
  const root = new THREE.Group();
  root.name = 'smp-loot';
  scene?.add(root);
  let cap = 0;
  let meshes = null;
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const _up = new THREE.Vector3(0, 1, 0);
  const _v = new THREE.Vector3();

  function grow(n) {
    const next = Math.max(CAP0, n, cap * 2);
    const old = meshes;
    meshes = {
      body: new THREE.InstancedMesh(geo.body, mats.body, next),
      strips: new THREE.InstancedMesh(geo.strips, mats.strips, next),
      beam: new THREE.InstancedMesh(geo.beam, mats.beam, next),
    };
    meshes.body.castShadow = true;
    meshes.body.receiveShadow = true;
    meshes.beam.renderOrder = 12;
    for (const [k, m] of Object.entries(meshes)) {
      m.name = `smp-loot-${k}`;
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (k !== 'body') m.setColorAt(0, COL_PUBLIC);
      root.add(m);
      if (old) {
        root.remove(old[k]);
        old[k].dispose();
      }
    }
    cap = next;
    for (let i = 0; i < list.length; i++) write(list[i], i);
  }

  const me = () => smp.me();
  const isMine = (c) => !!c.owner && c.owner === me();
  const canOpen = (c) => !c.owner || isMine(c);
  const ownerName = (c) => c.name || ctx.net?.players?.get?.(c.owner)?.name || ctx.remotes?.get?.(c.owner)?.name || '';

  function write(c, i) {
    if (!meshes) return;
    const ground = ctx.world?.getHeightAt ? ctx.world.getHeightAt(c.x, c.z) : c.y;
    const y = Math.max(ground, Math.min(c.y, ground + 1.5)) - 0.02;
    _q.setFromAxisAngle(_up, c.rot);
    _m.compose(_p.set(c.x, y, c.z), _q, _s);
    meshes.body.setMatrixAt(i, _m);
    meshes.strips.setMatrixAt(i, _m);
    meshes.beam.setMatrixAt(i, _m);
    const mine = isMine(c);
    meshes.strips.setColorAt(i, mine ? COL_MINE : c.owner ? COL_OTHER : COL_PUBLIC);
    meshes.beam.setColorAt(i, mine ? BEAM_MINE : c.owner ? BEAM_OTHER : BEAM_PUBLIC);
    c.pos.set(c.x, y + 0.5, c.z);
    c.index = i;
  }

  function sync() {
    if (!meshes) {
      if (!list.length) return;
      grow(list.length);
    }
    if (list.length > cap) grow(list.length);
    for (const m of Object.values(meshes)) {
      m.count = list.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  function add(raw) {
    const id = raw?.id != null ? String(raw.id) : null;
    const p = Array.isArray(raw?.p) ? raw.p : null;
    if (!id || !p || !Number.isFinite(+p[0]) || !Number.isFinite(+p[2])) return;
    let c = crates.get(id);
    if (!c) {
      c = { id, x: 0, y: 0, z: 0, rot: hash(id) * Math.PI * 2, pos: new THREE.Vector3(), index: -1, until: 0, wait: 0 };
      crates.set(id, c);
      list.push(c);
      ctx.interactions?.add?.({
        id: `smp-loot-${id}`,
        scope: 'world',
        position: c.pos,
        radius: Math.max(2, (LOOT.pickupRange || 3.5) - 0.4),
        label: () => t(isMine(c) ? TXT.open : TXT.pick),
        key: 'KeyE',
        priority: 2,
        enabled: () => canOpen(c) && c.wait <= 0 && !ctx.build?.active,
        onInteract: () => pickup(c.id),
      });
    }
    c.x = +p[0];
    c.y = +(p[1] ?? 0);
    c.z = +p[2];
    c.items = raw.items || c.items || null;
    c.owner = raw.owner ?? null;
    c.name = raw.name || raw.ownerName || c.name || '';
    c.kind = raw.kind || c.kind || 'drop';
    if (Number.isFinite(+raw.ttl)) c.until = ctx.loop.time + +raw.ttl;
    write(c, list.indexOf(c));
  }

  function remove(id) {
    const c = crates.get(String(id));
    if (!c) return;
    crates.delete(c.id);
    const i = list.indexOf(c);
    const last = list.pop();
    if (last !== c && i >= 0) {
      list[i] = last;
      write(last, i);
    }
    ctx.interactions?.remove?.(`smp-loot-${c.id}`);
    if (smp.deathDrop?.id === c.id) clearDrop();
  }

  function reset(arr) {
    for (const id of [...crates.keys()]) remove(id);
    for (const raw of arr || []) add(raw);
    sync();
  }

  /** S.LOOT {add, remove, by, got}. */
  function onMessage(m = {}) {
    const first = (m.remove || [])[0];
    const kind = first != null ? crates.get(String(first))?.kind ?? null : null;
    for (const id of m.remove || []) remove(id);
    for (const raw of m.add || []) add(raw);
    sync();
    if (m.by != null && m.by === me() && m.got) {
      const items = bundleList(m.got);
      if (items.length) {
        ctx.ui.toast({ title: t(TXT.got), text: items.slice(0, 4).map(itemText).join(' · '), icon: 'smp-crate', kind: 'reward', duration: 3200 });
        ctx.audio?.play?.('reward');
      }
      events.emit('smp:pickup', { loot: first ?? null, got: m.got, kind });
    }
  }

  function itemText(it) {
    const name =
      it.kind === 'res' ? RESOURCES[it.id]?.name : it.kind === 'ammo' ? AMMO[it.id]?.name : it.kind === 'item' ? ITEMS[it.id]?.name : it.kind === 'weapon' ? WEAPONS[it.id]?.name : { en: 'Ø-credits', nl: 'Ø-credits' };
    return `+${it.n} ${t(name || { en: it.id })}`;
  }

  function pickup(id) {
    const c = crates.get(String(id));
    if (!c || !canOpen(c) || c.wait > 0) return false;
    c.wait = 1.2;
    return smp.send({ t: C.PICKUP, loot: c.id });
  }

  // ------------------------------------------------------------ death drop marker
  function setDrop(id, at) {
    const p = Array.isArray(at) ? at : null;
    const c = crates.get(String(id));
    const x = c ? c.x : +p?.[0];
    const z = c ? c.z : +p?.[2];
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const pos = new THREE.Vector3(x, (c ? c.y : +p?.[1] || 0) + 1, z);
    smp.deathDrop = { id: String(id), pos, until: ctx.loop.time + (c?.until ? c.until - ctx.loop.time : DEATH_DROP.ttl) };
    dropLabelKey = '';
    // the death screen already says so: the toast waits for the respawn (it covered the screen's title)
    dropToast = true;
  }
  let dropToast = false;
  function showDropToast() {
    if (!dropToast || !smp.deathDrop) return;
    dropToast = false;
    ui.toast({ title: t(TXT.dropTitle), text: t(TXT.dropText), icon: 'smp-skull', kind: 'warn', duration: 6500 });
  }
  ctx.events?.on?.('smp:stats', () => {
    if (dropToast && !smp.stats?.dead) setTimeout(showDropToast, 900);
  });
  function clearDrop() {
    smp.deathDrop = null;
    ctx.markers?.remove?.('smp-drop');
  }
  let dropLabelKey = '';
  function updateDrop() {
    const d = smp.deathDrop;
    if (!d) return;
    const left = d.until - ctx.loop.time;
    if (left <= 0) return clearDrop();
    const label = t(TXT.dropMarker, { t: clock(left) });
    if (label === dropLabelKey) return;
    dropLabelKey = label;
    ctx.markers?.set?.('smp-drop', { position: d.pos, label, kind: 'quest', color: '#f0b46a', icon: 'smp-skull', scope: 'world', screen: true, compass: true });
  }

  // ------------------------------------------------------------ labels
  const pool = [];
  const near = [];
  function label(i) {
    let el = pool[i];
    if (!el) {
      el = ui.h('div', { class: 'smp-loot-label' }, ui.h('span', { class: 'smp-loot-label-icon' }), ui.h('span', { class: 'smp-loot-label-text' }));
      el.hidden = true;
      ui.layers.hud.appendChild(el);
      pool[i] = el;
    }
    return el;
  }

  function updateLabels() {
    const cam = ctx.engine?.camera || ctx.camera;
    const p = ctx.player?.position;
    near.length = 0;
    if (p && cam && ctx.modes?.is?.('explore') && smp.ready) {
      for (const c of list) {
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < LABEL_DIST) {
          c._d = d;
          near.push(c);
        }
      }
      if (near.length > LABELS) near.sort((a, b) => a._d - b._d);
    }
    for (let i = 0; i < LABELS; i++) {
      const c = near[i];
      if (!c) {
        if (pool[i] && !pool[i].hidden) pool[i].hidden = true;
        continue;
      }
      const el = label(i);
      _v.copy(c.pos);
      _v.y += 0.75;
      _v.project(cam);
      if (_v.z < -1 || _v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) {
        el.hidden = true;
        continue;
      }
      const mine = isMine(c);
      const left = c.until - ctx.loop.time;
      const text = mine ? `${t(TXT.yours)} · ${clock(left)}` : c.owner ? (ownerName(c) ? t(TXT.theirs, { name: ownerName(c) }) : t(TXT.locked)) : t(TXT.supplies);
      const kind = mine ? 'mine' : c.owner ? 'other' : 'public';
      if (el._text !== text) el.lastChild.textContent = el._text = text;
      if (el._kind !== kind) {
        el.dataset.kind = el._kind = kind;
        el.firstChild.innerHTML = ui.icon(c.owner && !mine ? 'bld-lock' : 'smp-crate', 13);
      }
      const x = Math.round((_v.x * 0.5 + 0.5) * window.innerWidth);
      const y = Math.round((-_v.y * 0.5 + 0.5) * window.innerHeight);
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      el.style.opacity = String(Math.max(0.25, Math.min(1, (LABEL_DIST - c._d) / 10)));
      el.hidden = false;
    }
  }

  // ------------------------------------------------------------ per frame
  let acc = 0;
  function update(dt) {
    for (const c of list) if (c.wait > 0) c.wait -= dt;
    acc += dt;
    if (acc > 0.5) {
      acc = 0;
      // expired crates (the server removes them too; this keeps the view clean if a message was missed)
      for (let i = list.length - 1; i >= 0; i--) if (list[i].until && ctx.loop.time > list[i].until + 5) remove(list[i].id);
      sync();
    }
    updateDrop();
    updateLabels();
  }

  return { crates, list, add, remove, reset, onMessage, pickup, setDrop, clearDrop, update, root };
}
