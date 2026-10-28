import * as THREE from 'three';
import { t, pick } from '../core/i18n.js';
import { formatDistance, clamp } from '../core/math.js';
import { registerIcons } from '../ui/icons.js';
import { FLIGHT } from './flight.js';

/**
 * Space HUD (mode 'space'), poster / 02 / 07 style:
 *   top-right    circular radar (ship-relative; enemies red, allies cyan,
 *                station / anomaly / wreck / quest icons; rotating N/E/S/W)
 *   bottom-left  speed "520 m/s" + bar + throttle
 *   bottom-right systems: Shield, Hull, Lasers (heat), Boost, Missiles n/12 + key hints
 *   center       crosshair, virtual-stick dot, overheat warning
 *   overlay      target brackets ("Pirate" + health), lead indicator, POI /
 *                quest markers with distance, docking reticle ("DOCK"), damage vignette
 */

registerIcons({
  'space-hull': '<path d="M12 3.2 19.5 7v6.2c0 3.9-3.2 6.6-7.5 7.6-4.3-1-7.5-3.7-7.5-7.6V7Z"/><path d="M8.5 12h7M12 8.5v7"/>',
  'space-missile': '<path d="M14.5 4.5c2.6-.6 4.4-.5 5 0 .5.6.6 2.4 0 5L11 18l-5-5Z"/><path d="M8.2 15.8 5 19M6 13l-2.5-.5L6 10M11 18l.5 2.5L14 18"/>',
});

export function createHud(S) {
  const { ctx } = S;
  const { ui } = ctx;
  const h = ui.h.bind(ui);
  const modes = ['space'];
  const L = {
    shield: t({ en: 'Shield', nl: 'Schild' }),
    hull: t({ en: 'Hull', nl: 'Romp' }),
    lasers: t({ en: 'Lasers', nl: 'Lasers' }),
    boost: t({ en: 'Boost', nl: 'Boost' }),
    missiles: t({ en: 'Missiles', nl: 'Raketten' }),
    land: t({ en: 'Land', nl: 'Landen' }),
    throttle: t({ en: 'Throttle', nl: 'Stuwkracht' }),
    overheat: t({ en: 'Overheated', nl: 'Oververhit' }),
    dock: t({ en: 'Dock', nl: 'Aanmeren' }),
    slow: t({ en: 'Reduce speed', nl: 'Verminder snelheid' }),
    align: t({ en: 'Line up with the bay', nl: 'Lijn uit met de dokpoort' }),
    pressE: t({ en: 'Press E to dock', nl: 'Druk op E om aan te meren' }),
    station: 'Station Halo',
    anomaly: t({ en: 'Anomaly', nl: 'Anomalie' }),
    wreck: t({ en: 'Distress signal', nl: 'Noodsignaal' }),
    convoy: t({ en: 'Convoy', nl: 'Konvooi' }),
  };
  const compass = pick({ en: ['N', 'E', 'S', 'W'], nl: ['N', 'O', 'Z', 'W'] });

  // ---------------------------------------------------------- radar
  const RS = 196;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h('canvas', { width: RS * dpr, height: RS * dpr });
  const radar = h('div', { class: 'space-radar' }, canvas);
  ui.addWidget('top-right', radar, { modes, order: 10 });
  const g = canvas.getContext('2d');

  // ---------------------------------------------------------- speed
  const speedV = h('span', { class: 'v', text: '0' });
  const speedBar = h('i');
  const thrV = h('b', { text: '0%' });
  const speedEl = h(
    'div',
    { class: 'space-speed panel' },
    h('div', { class: 'space-speed-num' }, speedV, h('span', { class: 'u', text: 'm/s' })),
    h('div', { class: 'space-bar' }, speedBar),
    h('div', { class: 'space-speed-sub' }, h('span', { text: L.throttle }), thrV),
  );
  ui.addWidget('bottom-left', speedEl, { modes, order: 10 });

  // ---------------------------------------------------------- systems
  const rows = {};
  const row = (id, icon, label, seg = true) => {
    const bar = h('i');
    const val = h('span', { class: 'val', text: '' });
    const el = h('div', { class: 'space-sys-row' }, h('span', { class: 'ico', html: ui.icon(icon, 18) }), h('span', { class: 'lbl', text: label }), h('div', { class: `space-bar${seg ? ' seg' : ''}` }, bar), val);
    rows[id] = { el, bar, val, barWrap: bar.parentNode, last: '', lastV: -1, cls: '' };
    return el;
  };
  const hint = (key, label) => h('span', {}, h('span', { class: 'kbd', text: key }), label);
  const systems = h(
    'div',
    { class: 'space-systems panel' },
    row('shield', 'shield', L.shield),
    row('hull', 'space-hull', L.hull),
    row('lasers', 'laser', L.lasers),
    row('boost', 'boost', L.boost),
    row('missiles', 'space-missile', L.missiles),
    h('div', { class: 'space-hints' }, hint('L', L.land), hint('F', L.missiles), hint('Shift', L.boost)),
  );
  ui.addWidget('bottom-right', systems, { modes, order: 10 });

  // ---------------------------------------------------------- crosshair
  const stickDot = h('div', { class: 'stick' });
  const cross = h('div', {
    class: 'space-cross',
    html: `<svg viewBox="-60 -60 120 120" width="120" height="120">
      <circle class="ring" r="17" fill="none" stroke="rgba(236,230,220,0.75)" stroke-width="1.3"/>
      <path d="M-30 0h-9M30 0h9M0 -30v-9M0 30v9" stroke="rgba(236,230,220,0.55)" stroke-width="1.3"/>
      <path d="M-24 -7v14M24 -7v14" stroke="rgba(127,224,255,0.5)" stroke-width="1.2"/>
      <circle r="1.6" fill="rgba(236,230,220,0.9)"/>
    </svg>`,
  });
  cross.append(stickDot, h('div', { class: 'warn-text', text: L.overheat }));
  ui.addWidget('center', cross, { modes, order: 10 });

  // ---------------------------------------------------------- overlay
  const overlay = h('div', { class: 'space-overlay' });
  const vignette = h('div', { class: 'space-vignette' });
  const boostFx = h('div', { class: 'space-boostfx' });
  const lead = h('div', { class: 'space-lead' });
  const dockEl = h('div', { class: 'space-dock idle' }, h('div', { class: 'frame' }), h('div', { class: 'cross' }), h('div', { class: 'ring' }), h('div', { class: 'tag', text: L.dock }), h('div', { class: 'sub', text: '' }));
  overlay.append(boostFx, vignette, lead, dockEl);
  ui.layers.hud.appendChild(overlay);
  const setOverlay = () => {
    overlay.hidden = !ctx.modes.is('space');
  };
  ctx.events.on('mode:change', setOverlay);
  setOverlay();

  // marker pools
  const mkPool = [];
  function mk(i) {
    if (!mkPool[i]) {
      const el = h('div', { class: 'space-mk' }, h('div', { class: 'box' }), h('div', { class: 'arrow' }), h('div', { class: 'hp' }, h('i')), h('div', { class: 'lbl' }), h('div', { class: 'dist' }));
      overlay.appendChild(el);
      mkPool[i] = { el, lbl: el.children[3], dist: el.children[4], hp: el.children[2], last: {}, on: true };
    }
    return mkPool[i];
  }
  const poiPool = [];
  function poi(i) {
    if (!poiPool[i]) {
      const el = h('div', { class: 'space-poi' }, h('div', { class: 'dia' }), h('div', { class: 't' }), h('div', { class: 'd' }));
      overlay.appendChild(el);
      poiPool[i] = { el, t: el.children[1], d: el.children[2], last: {}, on: true };
    }
    return poiPool[i];
  }
  const setText = (o, key, el, txt) => {
    if (o.last[key] !== txt) {
      o.last[key] = txt;
      el.textContent = txt;
    }
  };
  const show = (o, on) => {
    if (o.on !== on) {
      o.on = on;
      o.el.style.display = on ? '' : 'none';
    }
  };

  // ---------------------------------------------------------- projection
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const scr = { x: 0, y: 0, on: false, behind: false, ax: 0, ay: 0 };
  function project(world, margin = 40) {
    const cam = S.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    _v.copy(world).applyMatrix4(cam.matrixWorldInverse);
    scr.behind = _v.z > 0;
    _v.applyMatrix4(cam.projectionMatrix);
    let x = _v.x;
    let y = _v.y;
    if (scr.behind) {
      x = -x;
      y = -y;
    }
    scr.on = !scr.behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
    let px = (x * 0.5 + 0.5) * W;
    let py = (-y * 0.5 + 0.5) * H;
    if (!scr.on) {
      // clamp onto an inset rectangle along the direction from the centre
      let dx = px - W / 2;
      let dy = py - H / 2;
      if (scr.behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
      const sx = (W / 2 - margin) / Math.max(Math.abs(dx), 1e-3);
      const sy = (H / 2 - margin) / Math.max(Math.abs(dy), 1e-3);
      const s = Math.min(sx, sy);
      px = W / 2 + dx * s;
      py = Math.min(H - 175, Math.max(70, H / 2 + dy * s));
      scr.ax = dx;
      scr.ay = dy;
    }
    scr.x = px;
    scr.y = py;
    return scr;
  }

  // ---------------------------------------------------------- radar draw
  const RANGE = 4200;
  function drawRadar(time) {
    const p = S.player;
    const W = RS * dpr;
    const c = W / 2;
    const R = c - 8 * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.lineWidth = dpr;
    g.strokeStyle = 'rgba(127,224,255,0.16)';
    for (const k of [0.33, 0.66, 1]) {
      g.beginPath();
      g.arc(c, c, R * k, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(c - R, c);
    g.lineTo(c + R, c);
    g.moveTo(c, c - R);
    g.lineTo(c, c + R);
    g.stroke();
    // sweep
    const sw = (time * 1.2) % (Math.PI * 2);
    const grad = g.createConicGradient ? g.createConicGradient(sw - Math.PI / 2, c, c) : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(127,224,255,0.16)');
      grad.addColorStop(0.12, 'rgba(127,224,255,0)');
      grad.addColorStop(1, 'rgba(127,224,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(c, c, R, 0, Math.PI * 2);
      g.fill();
    }
    _q.copy(p.quaternion).invert();
    // compass letters (world N/E/S/W projected into the ship frame)
    const dirs = [
      [0, 0, -1],
      [1, 0, 0],
      [0, 0, 1],
      [-1, 0, 0],
    ];
    g.font = `${10 * dpr}px Jost, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    dirs.forEach((d, i) => {
      _v.set(d[0], d[1], d[2]).applyQuaternion(_q);
      const l = Math.hypot(_v.x, _v.z);
      if (l < 0.15) return;
      const x = c + (_v.x / l) * (R - 6 * dpr);
      const y = c + (_v.z / l) * (R - 6 * dpr);
      g.fillStyle = i === 0 ? 'rgba(236,230,220,0.95)' : 'rgba(236,230,220,0.55)';
      g.fillText(compass[i], x, y);
    });
    const blip = (world, kind) => {
      _v.copy(world).sub(p.position).applyQuaternion(_q);
      const dist = _v.length();
      const flat = Math.hypot(_v.x, _v.z);
      const k = Math.min(1, dist / RANGE);
      const sx = flat > 1e-3 ? _v.x / flat : 0;
      const sz = flat > 1e-3 ? _v.z / flat : 0;
      let x = c + sx * k * (R - 4 * dpr);
      let y = c + sz * k * (R - 4 * dpr);
      if (flat < 1e-3) {
        x = c;
        y = c;
      }
      const above = _v.y > 0;
      const far = dist > RANGE;
      g.globalAlpha = far ? 0.55 : 1;
      // elevation stalk
      const stalk = clamp(_v.y / RANGE, -1, 1) * 16 * dpr;
      if (Math.abs(stalk) > 1.5 && !far) {
        g.strokeStyle = 'rgba(236,230,220,0.35)';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y - stalk);
        g.stroke();
        y -= stalk;
      }
      const s = 3.6 * dpr;
      if (kind === 'enemy') {
        g.fillStyle = '#ff5c50';
        g.beginPath();
        g.moveTo(x, y - s * 1.2);
        g.lineTo(x + s, y + s * 0.8);
        g.lineTo(x - s, y + s * 0.8);
        g.closePath();
        above ? g.fill() : ((g.strokeStyle = '#ff5c50'), g.stroke());
      } else if (kind === 'ally' || kind === 'convoy') {
        const z = kind === 'convoy' ? s * 1.4 : s;
        g.fillStyle = '#7fe0ff';
        g.beginPath();
        g.moveTo(x, y - z);
        g.lineTo(x + z, y);
        g.lineTo(x, y + z);
        g.lineTo(x - z, y);
        g.closePath();
        above || kind === 'convoy' ? g.fill() : ((g.strokeStyle = '#7fe0ff'), g.stroke());
      } else {
        const col = kind === 'anomaly' ? '#b48cff' : kind === 'wreck' ? '#f0b46a' : kind === 'quest' ? '#7fe0ff' : '#ece6dc';
        g.strokeStyle = col;
        g.lineWidth = 1.4 * dpr;
        g.beginPath();
        if (kind === 'station') g.arc(x, y, s * 1.6, 0, Math.PI * 2);
        else if (kind === 'wreck') g.rect(x - s * 1.2, y - s * 1.2, s * 2.4, s * 2.4);
        else {
          g.moveTo(x, y - s * 1.6);
          g.lineTo(x + s * 1.6, y);
          g.lineTo(x, y + s * 1.6);
          g.lineTo(x - s * 1.6, y);
          g.closePath();
        }
        g.stroke();
        g.lineWidth = dpr;
      }
      g.globalAlpha = 1;
    };
    blip(S.station.position, 'station');
    if (!S.anomaly.scanned) blip(S.anomaly.position, 'anomaly');
    blip(S.wreck.position, 'wreck');
    for (const m of ctx.markers.list('space')) if (m.kind === 'quest' && m.pos?.isVector3) blip(m.pos, 'quest');
    for (const e of S.ships.list) {
      if (!e.alive) continue;
      blip(e.position, e.team === 'pirate' ? 'enemy' : e.convoy ? 'convoy' : 'ally');
    }
    // player arrow
    g.fillStyle = '#ece6dc';
    g.beginPath();
    g.moveTo(c, c - 7 * dpr);
    g.lineTo(c + 5 * dpr, c + 5 * dpr);
    g.lineTo(c, c + 2.5 * dpr);
    g.lineTo(c - 5 * dpr, c + 5 * dpr);
    g.closePath();
    g.fill();
  }

  // ---------------------------------------------------------- systems rows
  function setRow(id, v, text, cls = '') {
    const r = rows[id];
    const vv = Math.round(v * 200) / 200;
    if (r.lastV !== vv) {
      r.lastV = vv;
      r.bar.style.setProperty('--v', vv);
    }
    if (r.last !== text) {
      r.last = text;
      r.val.textContent = text;
    }
    if (r.cls !== cls) {
      r.el.classList.toggle('hot', cls === 'hot');
      r.el.classList.toggle('low', cls === 'low');
      r.barWrap.classList.toggle('warn', cls === 'hot');
      r.barWrap.classList.toggle('danger', cls === 'low');
      r.cls = cls;
    }
  }

  // ---------------------------------------------------------- per frame
  let radarT = 0;
  let lastSpeed = '';
  let lastThr = '';
  let lastStick = '';
  let lastVig = -1;
  let lastBoost = -1;
  let crossCls = '';
  const leadPos = new THREE.Vector3();
  const pois = [];
  function update(dt, time) {
    if (!ctx.modes.is('space')) return;
    const p = S.player;
    // speed
    const sp = String(Math.round(p.speed));
    if (sp !== lastSpeed) {
      lastSpeed = sp;
      speedV.textContent = sp;
      speedBar.style.setProperty('--v', clamp(p.speed / FLIGHT.BOOST_SPEED).toFixed(3));
    }
    const th = `${Math.round(p.throttle * 100)}%`;
    if (th !== lastThr) {
      lastThr = th;
      thrV.textContent = th;
    }
    // systems
    setRow('shield', p.shield / 100, `${Math.round(p.shield)}%`, p.shield < 25 ? 'low' : '');
    setRow('hull', p.hull / 100, `${Math.round(p.hull)}%`, p.hull < 30 ? 'low' : '');
    setRow('lasers', 1 - p.heat, `${Math.round((1 - p.heat) * 100)}%`, p.overheated ? 'low' : p.heat > 0.7 ? 'hot' : '');
    setRow('boost', p.boost, `${Math.round(p.boost * 100)}%`, p.boost < 0.15 ? 'hot' : '');
    setRow('missiles', p.missiles / p.maxMissiles, `${p.missiles}/${p.maxMissiles}`, p.missiles === 0 ? 'low' : '');
    // crosshair
    const st = `translate(${(p.stick.x * 52).toFixed(1)}px, ${(p.stick.y * 52).toFixed(1)}px)`;
    if (st !== lastStick) {
      lastStick = st;
      stickDot.style.transform = st;
    }
    const cc = `${p.overheated ? 'overheat' : ''}${S.combat.lock ? ' locked' : ''}`;
    if (cc !== crossCls) {
      crossCls = cc;
      cross.classList.toggle('overheat', p.overheated);
      cross.classList.toggle('locked', !!S.combat.lock);
    }
    // vignettes
    const vig = Math.min(1, p.hitFlash * 0.85 + (p.hull < 30 && p.alive ? (0.5 + 0.5 * Math.sin(time * 5)) * 0.35 : 0));
    if (Math.abs(vig - lastVig) > 0.01) {
      lastVig = vig;
      vignette.style.opacity = vig.toFixed(2);
    }
    const bo = p.boosting ? 1 : 0;
    if (bo !== lastBoost) {
      lastBoost = bo;
      boostFx.style.transition = 'opacity .35s';
      boostFx.style.opacity = bo ? '1' : '0';
    }

    // target markers (ships)
    let n = 0;
    const lock = S.combat.lock;
    for (const e of S.ships.list) {
      if (!e.alive) continue;
      const hostile = e.team === 'pirate';
      const d = e.position.distanceTo(p.position);
      if (hostile ? d > 5200 : e.kind === 'colony' ? d > 6000 : d > 1500) continue;
      const s = project(e.position, 30);
      if (!s.on && (!hostile || d > 2600)) continue;
      const o = mk(n++);
      show(o, true);
      const isLock = e === lock;
      const small = (hostile && !isLock) || e.kind === 'wingman' || e.kind === 'freighter';
      const size = clamp((e.hitRadius || e.radius) * 2 * (window.innerHeight / (2 * Math.tan((S.camera.fov * Math.PI) / 360))) / Math.max(d, 1), hostile ? 24 : 30, 120);
      const cls = `space-mk${hostile ? '' : ' ally'}${small ? ' small' : ''}${isLock ? ' locked' : ''}${s.on ? '' : ' edge'}`;
      if (o.last.cls !== cls) {
        o.last.cls = cls;
        o.el.className = cls;
      }
      o.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
      const sz = `${size.toFixed(0)}px`;
      if (o.last.size !== sz) {
        o.last.size = sz;
        o.el.style.setProperty('--s', sz);
      }
      if (!s.on) {
        const a = `${((Math.atan2(s.ay, s.ax) * 180) / Math.PI + 90).toFixed(0)}deg`;
        if (o.last.a !== a) {
          o.last.a = a;
          o.el.style.setProperty('--a', a);
        }
      }
      setText(o, 'lbl', o.lbl, e.label);
      setText(o, 'dist', o.dist, s.on && (isLock || e.kind === 'colony' || (hostile && d < 1800)) ? formatDistance(d) : '');
      const hp = (Math.max(0, e.hp) / e.maxHp).toFixed(2);
      if (o.last.hp !== hp) {
        o.last.hp = hp;
        o.hp.style.setProperty('--h', hp);
      }
    }
    for (let i = n; i < mkPool.length; i++) show(mkPool[i], false);

    // lead indicator for the lock
    if (lock?.alive) {
      const d = lock.position.distanceTo(p.position);
      leadPos.copy(lock.position).addScaledVector(lock.velocity, d / 2300).addScaledVector(p.velocity, -d / 2300);
      const s = project(leadPos);
      lead.style.display = s.on ? '' : 'none';
      if (s.on) lead.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
    } else lead.style.display = 'none';

    // POI / quest markers
    pois.length = 0;
    const questMarkers = ctx.markers.list('space');
    for (const m of questMarkers) if (m.pos?.isVector3 && m.screen !== false) pois.push({ pos: m.pos, label: m.label || '', cls: 'quest' });
    const near = (pos) => pois.some((q) => q.pos.distanceTo(pos) < 120);
    const within = (pos, r) => pos.distanceTo(p.position) < r;
    if (!near(S.station.position)) pois.push({ pos: S.station.position, label: L.station, cls: 'white' });
    if (!S.anomaly.scanned && !near(S.anomaly.position) && within(S.anomaly.position, 6000)) pois.push({ pos: S.anomaly.position, label: L.anomaly, cls: 'violet' });
    if (!S.missions.scans[1].done && !near(S.wreck.position) && within(S.wreck.position, 5000)) pois.push({ pos: S.wreck.position, label: L.wreck, cls: 'gold' });
    const cm = S.missions.convoyMission;
    if (cm.state !== 'done' && cm.state !== 'active' && !near(S.ships.colony.position) && within(S.ships.colony.position, 7000)) pois.push({ pos: S.ships.colony.position, label: L.convoy, cls: 'quest' });
    let k = 0;
    for (const q of pois) {
      const d = q.pos.distanceTo(p.position);
      if (d < 250) continue;
      const s = project(q.pos, 56);
      const o = poi(k++);
      show(o, true);
      const cls = `space-poi ${q.cls}`;
      if (o.last.cls !== cls) {
        o.last.cls = cls;
        o.el.className = cls;
      }
      o.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) translate(-50%, 0)`;
      setText(o, 't', o.t, q.label);
      setText(o, 'd', o.d, formatDistance(d));
    }
    for (let i = k; i < poiPool.length; i++) show(poiPool[i], false);

    // docking reticle
    const dk = S.missions.dock;
    if ((dk.state === 'approach' || dk.state === 'ready') && p.alive) {
      const s = project(S.station.dock.mouth);
      if (s.on) {
        dockEl.style.display = '';
        dockEl.className = `space-dock ${dk.state === 'ready' ? 'ready' : 'idle'}`;
        const w = clamp(260 * (420 / Math.max(dk.distance, 60)), 150, 420);
        dockEl.style.setProperty('--w', `${w.toFixed(0)}px`);
        dockEl.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
        const sub = dk.state === 'ready' ? L.pressE : !dk.slow ? L.slow : !dk.aligned ? L.align : formatDistance(dk.distance);
        const tag = dockEl.children[3];
        const subEl = dockEl.children[4];
        if (subEl.textContent !== sub) subEl.textContent = sub;
        const tg = `${L.dock} · ${formatDistance(dk.distance)}`;
        if (tag.textContent !== tg) tag.textContent = tg;
      } else dockEl.style.display = 'none';
    } else dockEl.style.display = 'none';

    // radar at ~12 Hz
    radarT -= dt;
    if (radarT <= 0) {
      radarT = 0.08;
      drawRadar(time);
    }
  }

  return {
    update,
    elements: { radar, speedEl, systems, cross, overlay },
    dispose() {
      [radar, speedEl, systems, cross].forEach((el) => ui.removeWidget(el));
      overlay.remove();
    },
  };
}

