/**
 * The signal. Until the player finds it, the beacon on the lake shore stays
 * dormant while playing (the title screen keeps the landmark's default look).
 * Reaching it activates ctx.landmarks.beacon.setActive(true) with a cyan
 * shockwave, starts "Het signaal" and opens Aria's dialogue as soon as the
 * player is close to her (or after a few seconds).
 */
import { ZONES } from '../../world/layout.js';
import { playerPos } from '../shared/util.js';
import { ShockPulse } from '../events/fx.js';

export function createSignal(ctx, { sys, rewards, refs }) {
  let pending = 0; // > 0 while waiting to open Aria's dialogue
  let startIn = -1; // ≥ 0: seconds until "Het signaal" starts (after Horizon's completion beat)
  let pulse = null;

  const found = () => rewards.flag('signalFound');
  const beacon = () => ctx.landmarks?.beacon || null;

  /** Dormant during play until discovered; the echo event wakes it up too. */
  function applyBeacon() {
    const b = beacon();
    if (!b?.setActive) return;
    const playing = ctx.modes?.is('explore', 'drive');
    try {
      b.setActive(found() || !playing || !!refs.events?.isActive?.('echo'));
    } catch (err) {
      console.warn('[signal] beacon.setActive failed', err);
    }
  }
  applyBeacon();
  ctx.events.on('mode:change', applyBeacon);
  ctx.events.on('state:reset', applyBeacon);
  ctx.events.on('event:start', ({ id } = {}) => id === 'echo' && applyBeacon());

  function discover() {
    if (found()) return;
    rewards.setFlag('signalFound');
    applyBeacon();
    const b = beacon();
    const scene = ctx.world?.scene;
    if (scene && b?.position) {
      pulse = pulse || new ShockPulse(scene, '#7fe0ff');
      pulse.fire(b.position, { radius: 70, height: 140, duration: 2.6 });
    }
    ctx.audio.play('warp', { volume: 0.5 });
    ctx.cameraRig?.shake?.(0.18);
    // Tick "Ontdek het signaal" off first: when that finishes "Verken de Horizon" the tracker
    // plays its completion beat before switching to "Het signaal — Spreek met Aria".
    const q = refs.quests;
    const wasDone = !!q?.isDone?.('horizon');
    q?.advance?.('horizon', 'signal', Infinity);
    startIn = !wasDone && q?.isDone?.('horizon') ? 2.8 : 0;
    if (startIn === 0) startSignalQuest();
    try {
      ctx.npcs?.get?.('aria')?.say?.('Je hebt het ook gevoeld, hè?', 4);
    } catch {
      /* optional NPC API */
    }
    approach();
    pending = 0.001;
    ctx.events.emit('signal:found', { position: b?.position || null });
  }

  /** Aria walks up to the player and stops at talking distance (re-aimed while the player moves). */
  function approach() {
    try {
      const aria = ctx.npcs?.get?.('aria');
      const p = playerPos(ctx);
      if (!aria?.setGoal || !aria.position || !p) return;
      const dx = aria.position.x - p.x;
      const dz = aria.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.2) aria.setGoal({ x: p.x + (dx / d) * 2.3, z: p.z + (dz / d) * 2.3 });
    } catch {
      /* optional NPC API */
    }
  }

  function startSignalQuest() {
    startIn = -1;
    refs.quests?.start('signal', { track: true });
  }

  sys.on('zone', ({ zone }) => {
    if (zone === 'signal') discover();
  });

  // after talking, Aria walks back to the beacon unless she joined the party
  ctx.events.on('dialogue:close', ({ id } = {}) => {
    if (id !== 'aria' || refs.party?.has('aria')) return;
    try {
      const aria = ctx.npcs?.get?.('aria');
      if (aria?.home && aria.setGoal && Math.hypot(aria.position.x - aria.home.x, aria.position.z - aria.home.z) > 3) aria.setGoal(aria.home, aria.homeHeading);
    } catch {
      /* optional NPC API */
    }
  });

  ctx.loop.add(
    'sys-signal',
    (dt) => {
      pulse?.update(dt);
      if (startIn > 0) {
        startIn -= dt;
        if (startIn <= 0) startSignalQuest();
        return; // Aria waits until the quest is on screen
      }
      if (pending <= 0) return;
      if (rewards.flag('metAria')) {
        pending = 0;
        return;
      }
      const before = pending;
      pending += dt;
      if (Math.floor(pending) !== Math.floor(before)) approach(); // re-aim once a second
      if (!ctx.modes.is('explore') || ctx.ui.isModalOpen() || ctx.modes.transitioning) return;
      const p = playerPos(ctx);
      if (!p) return;
      const a = refs.dialogue?.npcPosition?.('aria') || beacon()?.position;
      const d = a ? Math.hypot(a.x - p.x, a.z - p.z) : Math.hypot(ZONES.signal.x - p.x, ZONES.signal.z - p.z);
      if (d < 2.9 || pending > 11) {
        pending = 0;
        try {
          const aria = ctx.npcs?.get?.('aria');
          if (aria?.mode === 'goal') aria.setGoal?.(null);
        } catch {
          /* optional */
        }
        refs.dialogue?.open('aria');
      }
    },
    { order: 47 },
  );

  return {
    discover,
    get found() {
      return found();
    },
  };
}
