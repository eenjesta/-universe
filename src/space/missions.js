import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { clamp, easeInOutCubic, easeOutCubic, formatNumber } from '../core/math.js';
import { SPACE } from './layout.js';

/**
 * Space gameplay flow:
 *  - warp-in when arriving (space:enter + 'warp'), stage spawns (?stage=…);
 *  - hold-E scans of the anomaly and the derelict (space:scan {target});
 *  - the convoy defence (space:convoy {status: start → attack (waves) →
 *    safe | lost}; only 'safe' when the convoy made it to Station Halo);
 *  - docking at Station Halo (slow approach, E → cinematic → space:dock
 *    {station: 'halo'}, repair + restock + first-visit reward);
 *  - landing (L → explore at the spaceport, arrival 'ship');
 *  - death → recovery at the station.
 * Exposes `scan`, `dock` and `convoyMission` state objects for the HUD.
 */

export function createMissions(S) {
  const { ctx } = S;
  const st = ctx.state.ensure('space', { scanned: {}, convoyDone: false, docks: 0 });
  if (!st.scanned) st.scanned = {};
  const P = () => S.player;

  const T = {
    scanAnomaly: t({ en: 'Scan the anomaly', nl: 'Scan de anomalie' }),
    scanWreck: t({ en: 'Scan the wreck — Silver Horizon', nl: 'Scan het wrak — Zilveren Horizon' }),
    dock: t({ en: 'Dock', nl: 'Aanmeren' }),
    land: t({ en: 'Land', nl: 'Landen' }),
  };

  // ---------------------------------------------------------- scans
  const scans = [
    { id: 'anomaly', obj: S.anomaly, range: 760, time: 3.2, label: T.scanAnomaly, done: !!st.scanned.anomaly },
    { id: 'wreck', obj: S.wreck, range: 680, time: 3.6, label: T.scanWreck, done: !!st.scanned.wreck },
  ];
  S.anomaly.setScanned?.(scans[0].done);
  const scan = { active: null, progress: 0, inRange: null };
  let scanSound = null;
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();

  function completeScan(sc) {
    sc.done = true;
    st.scanned[sc.id] = true;
    ctx.state.set('space.scanned', { ...st.scanned });
    if (sc.id === 'anomaly') S.anomaly.setScanned?.(true);
    ctx.events.emit('space:scan', { target: sc.id });
    const title = sc.id === 'anomaly' ? t({ en: 'Anomaly scanned', nl: 'Anomalie gescand' }) : t({ en: 'Wreck scanned', nl: 'Wrak gescand' });
    const text =
      sc.id === 'anomaly'
        ? t({ en: 'Unknown energy signature recorded.', nl: 'Onbekende energiesignatuur vastgelegd.' })
        : t({ en: 'Silver Horizon — flight recorder recovered.', nl: 'Zilveren Horizon — vluchtrecorder geborgen.' });
    ctx.ui.toast({ title, text, icon: 'scan', kind: 'success' });
  }

  function updateScans(dt) {
    const p = P();
    scan.inRange = null;
    if (!p.alive || p.autopilot || dock.state === 'docking') return;
    for (const sc of scans) {
      if (sc.done) continue;
      const d = p.position.distanceTo(sc.obj.position);
      if (d < sc.range) {
        scan.inRange = sc;
        break;
      }
    }
    const sc = scan.inRange;
    const holding = sc && ctx.input.down('KeyE');
    if (holding) {
      if (scan.active !== sc) {
        scan.active = sc;
        scan.progress = 0;
      }
      scan.progress += dt / sc.time;
      if (!scanSound) scanSound = ctx.audio.loop('scan', { volume: 0.6 });
      scanSound?.set?.({ progress: scan.progress });
      if (scan.progress >= 1) {
        completeScan(sc);
        scan.active = null;
        scan.progress = 0;
      }
    } else {
      scan.progress = Math.max(0, scan.progress - dt * 0.8);
      if (scan.progress <= 0) scan.active = null;
    }
    if (!holding && scanSound) {
      scanSound.stop?.(0.2);
      scanSound = null;
    }
  }

  // ---------------------------------------------------------- docking
  const dock = { state: 'none', distance: Infinity, aligned: false, slow: false, ready: false };
  const DOCK_VIEW = 900;
  const DOCK_READY = 340;
  const DOCK_SPEED = 150;

  function updateDock(dt) {
    const p = P();
    const D = S.station.dock;
    if (dock.state === 'docking' || dock.state === 'docked') return;
    dock.distance = p.position.distanceTo(D.mouth);
    if (!p.alive || dock.distance > DOCK_VIEW) {
      dock.state = 'none';
      dock.ready = false;
      return;
    }
    p.getForward(_v);
    _w.copy(D.mouth).sub(p.position).normalize();
    dock.aligned = _v.angleTo(_w) < 0.7 && _w.dot(D.normal) < -0.2;
    dock.slow = p.speed < DOCK_SPEED;
    dock.ready = dock.distance < DOCK_READY && dock.aligned && dock.slow;
    dock.state = dock.ready ? 'ready' : 'approach';
    if (dock.ready && ctx.input.pressed('KeyE')) startDocking();
  }

  const path = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const camFrom = new THREE.Vector3();
  const look = new THREE.Matrix4();
  const tq = new THREE.Quaternion();
  function startDocking() {
    const p = P();
    const D = S.station.dock;
    dock.state = 'docking';
    dock.ready = false;
    p.controls = false;
    S.combat.lock = null;
    path.points[0].copy(p.position);
    path.points[1].copy(D.entry).lerp(p.position, 0.35);
    path.points[2].copy(D.mouth).addScaledVector(D.normal, 40);
    path.points[3].copy(D.inside);
    path.updateArcLengths();
    const duration = clamp(path.getLength() / 75, 5.5, 9);
    let time = 0;
    const startQ = p.quaternion.clone();
    ctx.audio.play('dock', { volume: 0.9 });
    ctx.ui.toast({ title: t({ en: 'Docking clearance granted', nl: 'Toestemming om aan te meren' }), text: 'Station Halo', icon: 'dock', kind: 'info', duration: 2600 });
    camFrom.copy(S.camera.position);
    p.autopilot = {
      update(dt) {
        time += dt;
        const k = clamp(time / duration);
        const u = easeInOutCubic(k);
        path.getPointAt(u, p.position);
        path.getTangentAt(Math.min(0.999, u + 0.01), _v);
        p.velocity.copy(_v).multiplyScalar(path.getLength() / duration);
        p.speed = p.velocity.length();
        look.lookAt(p.position, _w.copy(p.position).add(_v), D.up);
        tq.setFromRotationMatrix(look);
        p.quaternion.copy(startQ).slerp(tq, easeOutCubic(Math.min(1, k * 2.2)));
        p.throttle = 0.25 * (1 - k);
        if (time >= duration) finishDocking();
      },
    };
    // cinematic camera: side view near the bay mouth watching the ship slide in
    const side = new THREE.Vector3().crossVectors(D.normal, D.up).normalize();
    const camSpot = D.mouth.clone().addScaledVector(D.normal, 210).addScaledVector(side, 120).addScaledVector(D.up, 55);
    let ct = 0;
    p.camOverride = (dt, cam) => {
      ct += dt;
      const k = easeInOutCubic(clamp(ct / 2.5));
      cam.position.copy(camFrom).lerp(camSpot, k);
      look.lookAt(cam.position, _w.copy(p.position).lerp(D.mouth, 0.25), D.up);
      tq.setFromRotationMatrix(look);
      cam.quaternion.slerp(tq, 1 - Math.exp(-dt * 4));
      if (Math.abs(cam.fov - 50) > 0.05) {
        cam.fov += (50 - cam.fov) * (1 - Math.exp(-dt * 2));
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
      return true;
    };
  }

  async function finishDocking() {
    const p = P();
    const D = S.station.dock;
    p.autopilot = null;
    p.docked = true;
    p.velocity.set(0, 0, 0);
    dock.state = 'docked';
    await ctx.ui.fade(true, 600);
    p.repair();
    st.docks = (st.docks || 0) + 1;
    ctx.state.set('space.docks', st.docks);
    ctx.events.emit('space:dock', { station: 'halo' });
    const first = st.docks === 1;
    if (first) ctx.state.gain?.({ credits: 150 });
    ctx.ui.toast({
      title: t({ en: 'Docked at Station Halo', nl: 'Aangemeerd bij Station Halo' }),
      text: first
        ? t({ en: 'Hull repaired · missiles restocked · +{n} Ø-credits', nl: 'Romp gerepareerd · raketten bijgevuld · +{n} Ø-credits' }, { n: formatNumber(150) })
        : t({ en: 'Hull repaired · missiles restocked', nl: 'Romp gerepareerd · raketten bijgevuld' }),
      icon: 'dock',
      kind: first ? 'reward' : 'success',
      duration: 4200,
    });
    // undock: back outside, facing away from the bay
    p.camOverride = null;
    p.reset(_v.copy(D.mouth).addScaledVector(D.normal, 220), _w.copy(D.mouth).addScaledVector(D.normal, 1200), 45);
    p.throttle = 0.15;
    p.controls = true;
    p.invulnT = 3;
    dock.state = 'none';
    await ctx.ui.fade(false, 800);
  }

  // ---------------------------------------------------------- convoy defence
  const ships = S.ships;
  const convoy = ships.convoy;
  const CV = { state: st.convoyDone ? 'done' : 'idle', wave: 0, waves: 3, waveT: 0, resetT: 0, kills: 0 };
  if (CV.state === 'done') {
    convoy.s = convoy.length;
    convoy.state = 'arrived';
    ships.placeConvoy(0);
  }
  function startConvoy() {
    if (CV.state === 'active') return;
    convoy.reset();
    convoy.state = 'moving';
    CV.state = 'active';
    CV.wave = 0;
    CV.waveT = 2.5;
    CV.kills = 0;
    ctx.events.emit('space:convoy', { status: 'start' });
    ctx.ui.toast({
      title: t({ en: 'Convoy under way', nl: 'Konvooi vertrokken' }),
      text: t({ en: 'Escort the colony ship to Station Halo.', nl: 'Escorteer het kolonieschip naar Station Halo.' }),
      icon: 'colony',
      kind: 'quest',
    });
  }
  function spawnNextWave() {
    CV.wave++;
    const f = convoy.frame;
    const n = 3 + CV.wave;
    _v.copy(f.t).multiplyScalar(1).addScaledVector(f.r, CV.wave === 2 ? 1.2 : CV.wave === 3 ? -1.1 : 0.2).addScaledVector(f.u, 0.25).normalize();
    ships.spawnWave(n, convoy.colony.position, _v, 1500, CV.wave);
    ctx.events.emit('space:convoy', { status: 'attack', wave: CV.wave, waves: CV.waves });
    ctx.ui.toast({
      title: t({ en: 'Pirates incoming', nl: 'Piraten in aantocht' }),
      text: t({ en: 'Wave {w} of {n}', nl: 'Golf {w} van {n}' }, { w: CV.wave, n: CV.waves }),
      icon: 'target',
      kind: 'warn',
      duration: 2800,
    });
    CV.waveT = 16;
  }
  function updateConvoy(dt) {
    const p = P();
    if (CV.state === 'idle') {
      if (p.alive && p.position.distanceTo(convoy.colony.position) < 3200) startConvoy();
      return;
    }
    if (CV.state === 'lost') {
      CV.resetT -= dt;
      if (CV.resetT <= 0) {
        ships.clearPirates();
        convoy.reset();
        CV.state = 'idle';
      }
      return;
    }
    if (CV.state !== 'active') return;
    if (!convoy.colony.alive) {
      CV.state = 'lost';
      CV.resetT = 12;
      convoy.state = 'lost';
      ctx.events.emit('space:convoy', { status: 'lost' });
      ctx.ui.toast({ title: t({ en: 'Colony ship lost', nl: 'Kolonieschip verloren' }), text: t({ en: 'The convoy will regroup at the nebula.', nl: 'Het konvooi hergroepeert bij de nevel.' }), icon: 'colony', kind: 'error' });
      return;
    }
    const alive = ships.pirates();
    if (CV.wave < CV.waves) {
      CV.waveT -= dt;
      if ((alive === 0 && CV.waveT < 13) || CV.waveT <= -20) spawnNextWave();
    } else if (alive === 0 && (convoy.state === 'holding' || convoy.state === 'arrived')) {
      CV.state = 'done';
      convoy.state = 'arrived';
      st.convoyDone = true;
      ctx.state.set('space.convoyDone', true);
      ctx.events.emit('space:convoy', { status: 'safe' });
      ctx.ui.toast({
        title: t({ en: 'Convoy safe', nl: 'Konvooi veilig' }),
        text: t({ en: 'The colony ship reached Station Halo.', nl: 'Het kolonieschip heeft Station Halo bereikt.' }),
        icon: 'colony',
        kind: 'success',
      });
    }
  }
  S.onPirateKilled = (e, byPlayer) => {
    if (byPlayer) CV.kills++;
  };

  // ---------------------------------------------------------- death + recovery
  let respawnT = 0;
  S.onPlayerDestroyed = () => {
    respawnT = 3.2;
    ctx.ui.toast({ title: t({ en: 'Ship destroyed', nl: 'Schip vernietigd' }), text: t({ en: 'Recovery drones are on their way…', nl: 'Bergingsdrones zijn onderweg…' }), icon: 'ship', kind: 'error' });
  };
  async function recover() {
    const p = P();
    await ctx.ui.fade(true, 500);
    p.repair();
    const A = S.station.approach;
    p.reset(A.position, A.lookAt, 40);
    p.controls = true;
    p.invulnT = 4;
    S.combat.clear();
    await ctx.ui.fade(false, 700);
  }

  // ---------------------------------------------------------- landing
  let leaving = false;
  async function land() {
    if (leaving) return;
    if (!ctx.modes.has('explore')) {
      ctx.ui.toast({ title: T.land, text: t({ en: 'The planet is not reachable right now.', nl: 'De planeet is nu niet bereikbaar.' }), icon: 'warp', kind: 'warn' });
      return;
    }
    leaving = true;
    const p = P();
    p.controls = false;
    ctx.audio.play('warp', { volume: 0.8 });
    S.fx.flash(p.position, 60, new THREE.Color(3, 2.4, 2), 0.5);
    try {
      await ctx.modes.go('explore', { zone: 'spaceport', arrival: 'ship', from: 'space' });
    } finally {
      leaving = false;
    }
  }

  // ---------------------------------------------------------- arrival
  const fwd = new THREE.Vector3();
  function warpIn() {
    const p = P();
    const sp = SPACE.spawn;
    fwd.set(0, Math.sin(sp.pitch), -Math.cos(sp.pitch)).applyAxisAngle(new THREE.Vector3(0, 1, 0), sp.yaw).normalize();
    const start = sp.position.clone().addScaledVector(fwd, -2600);
    p.reset(start, start.clone().addScaledVector(fwd, 1000), 2600);
    p.fov = 105;
    let time = 0;
    const D = 1.7;
    p.autopilot = {
      update(dt) {
        time += dt;
        const k = clamp(time / D);
        const speed = 2600 + (230 - 2600) * easeOutCubic(k);
        p.velocity.copy(fwd).multiplyScalar(speed);
        p.speed = speed;
        p.position.addScaledVector(p.velocity, dt);
        p.boosting = k < 0.8;
        if (time >= D) {
          p.autopilot = null;
          p.boosting = false;
          p.throttle = 0.6;
        }
      },
    };
    S.fx.flash(sp.position.clone().addScaledVector(fwd, -900), 400, new THREE.Color(2.2, 2.6, 3.4), 0.6);
    ctx.audio.play('warp', { volume: 0.9 });
  }

  function placeStage(stage) {
    const p = P();
    if (stage === 'station') {
      const A = S.station.approach;
      p.reset(A.position, A.lookAt, 60);
      p.throttle = 0.18;
      return true;
    }
    if (stage === 'convoy') {
      if (CV.state === 'done') {
        st.convoyDone = false;
        CV.state = 'idle';
      }
      startConvoy();
      const f = convoy.frameAt(0);
      _v.copy(f.p).addScaledVector(f.t, -170).addScaledVector(f.r, -400).addScaledVector(f.u, 55);
      _w.copy(f.p).addScaledVector(f.t, 260).addScaledVector(f.r, 40);
      p.reset(_v, _w, 95);
      p.throttle = 0.3;
      // first wave already closing in, ahead of the convoy
      CV.wave = 0;
      spawnNextWave();
      return true;
    }
    if (stage === 'anomaly' || stage === 'wreck') {
      const target = stage === 'anomaly' ? S.anomaly.position : S.wreck.position;
      if (stage === 'anomaly') _v.set(0.35, 0.3, 0.88).normalize().multiplyScalar(600);
      else _v.copy(S.sky.sunDir).add(_w.set(0.1, 0.35, 0.55)).normalize().multiplyScalar(400);
      _v.add(target);
      p.reset(_v, target, 40);
      p.throttle = 0.1;
      return true;
    }
    return false;
  }

  function enter(params = {}, from = null) {
    leaving = false;
    dock.state = 'none';
    respawnT = 0;
    const p = P();
    p.camOverride = null;
    p.autopilot = null;
    p.controls = true;
    p.docked = false;
    p.repairIfDead?.();
    if (!p.alive) p.repair();
    const stage = params.stage || (params.initial ? ctx.params.stage : null);
    const placed = stage && placeStage(String(stage));
    if (!placed) warpIn();
    ctx.events.emit('space:enter', { from: params.from || from || null, stage: placed ? stage : null });
  }

  function update(dt) {
    const p = P();
    p.rollBlock = !!scan.inRange || dock.state === 'ready';
    updateScans(dt);
    updateDock(dt);
    updateConvoy(dt);
    if (respawnT > 0) {
      respawnT -= dt;
      if (respawnT <= 0) recover();
    }
    if (p.controls && !p.autopilot && ctx.input.gameEnabled && ctx.input.pressed('KeyL')) land();
    // prompts (bottom centre)
    if (scan.inRange && p.alive) {
      ctx.ui.prompt.show('space', { key: 'E', text: scan.inRange.label, hold: true, progress: scan.progress });
    } else if (dock.state === 'ready') {
      ctx.ui.prompt.show('space', { key: 'E', text: `${T.dock} — Station Halo` });
    } else ctx.ui.prompt.hide('space');
  }

  function exit() {
    ctx.ui.prompt.hide('space');
    scanSound?.stop?.(0.1);
    scanSound = null;
  }

  return {
    scan,
    scans,
    dock,
    convoyMission: CV,
    startConvoy,
    startDocking,
    enter,
    exit,
    update,
    land,
    placeStage,
    debug: {
      completeScan: (id) => {
        const sc = scans.find((s) => s.id === id);
        if (sc && !sc.done) completeScan(sc);
      },
      clearWaves() {
        CV.wave = CV.waves;
        ships.clearPirates();
      },
      arrive() {
        convoy.s = convoy.length;
        convoy.state = 'holding';
      },
    },
  };
}
