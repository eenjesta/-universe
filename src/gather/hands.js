import * as THREE from 'three';

/**
 * The character side of gathering: draws the right tool and swings it.
 * Uses the characters module's contract when it exists (src/characters/player.js):
 *   ctx.player.holdTool(id | mesh | null, { grip })   built-in models for axe / plasma-axe / pickaxe /
 *                                                     mining-laser; our multitool mesh otherwise
 *   ctx.player.playAction('chop' | 'mine' | 'gather', { at, speed }) → duration | false
 *   event 'action:impact' {action, tool, at, dir}     the impact frame (3P animator and FP view model)
 *   ctx.player.toolSocket                             world-space tool tip (both camera views)
 * and otherwise a local stand-in ("mock behind the same names"): the tool rides at the right hand and
 * swings in the character's sagittal plane; the impact comes from a timer.
 *
 *   hold(toolId | null)                 draw / put away ('hands' = nothing in hand)
 *   swing(action, interval, at) → { dur, impact }   starts one swing (null when the character is busy)
 *   tipWorld(out) → out | null          tool tip / emitter in world space (FX, laser beam)
 *   onImpact(fn)                        fn(action) at the impact frame (real API: the event; stand-in: timer)
 *   update(dt)
 */
const HAND_R = 13; // skeleton J.handR (src/characters/skeleton.js)
const BUILTIN = new Set(['axe', 'plasma-axe', 'pickaxe', 'mining-laser']);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);

export function createHands(ctx, models) {
  let heldId = null;
  let mesh = null; // stand-in mesh (or our multitool mesh handed to the real API)
  let usingReal = false;
  let impactCb = null;
  // stand-in swing state
  let swingT = -1;
  let swingDur = 0.9;
  let swingAct = 'chop';
  let mockImpactIn = -1;
  let realImpactIn = -1; // safety timer when the real API never sends action:impact

  const real = () => {
    const p = ctx.player;
    return p && typeof p.holdTool === 'function' && typeof p.playAction === 'function' ? p : null;
  };

  ctx.events?.on?.('action:impact', (e) => {
    if (!usingReal && !(real() && !heldId)) return;
    if (realImpactIn < 0) return;
    realImpactIn = -1;
    impactCb?.(e?.action);
  });

  function hold(id) {
    const want = id && id !== 'hands' ? id : null;
    if (want === heldId) return;
    const p = real();
    if (heldId && usingReal && p) {
      try {
        p.holdTool(null);
      } catch (err) {
        console.warn('[gather] holdTool(null) failed', err);
      }
    }
    if (mesh && !usingReal) mesh.removeFromParent();
    heldId = want;
    mesh = null;
    usingReal = false;
    if (!want) return;
    if (p) {
      try {
        if (BUILTIN.has(want)) p.holdTool(want, { grip: want });
        else {
          mesh = models.get(want);
          p.holdTool(mesh, { grip: 'axe', tip: mesh?.userData?.tip?.toArray?.() });
        }
        usingReal = true;
        return;
      } catch (err) {
        console.warn('[gather] holdTool failed — local stand-in', err);
      }
    }
    mesh = models.get(want);
    if (mesh) {
      mesh.matrixAutoUpdate = false;
      mesh.visible = true;
      ctx.world?.scene?.add(mesh);
    }
  }

  /** One swing: the real action when possible (null = busy, try again next frame), else the stand-in. */
  function swing(action, interval, at) {
    const p = real();
    if (p && (usingReal || action === 'gather')) {
      let natural = 0;
      try {
        natural = p.actionTiming?.(action, heldId)?.dur || 0;
      } catch {
        natural = 0;
      }
      // never slower than our interval allows; faster tools play their (faster) natural timing
      const speed = natural > interval * 1.05 ? natural / interval : 1;
      let d = false;
      try {
        d = p.playAction(action, { at, speed, tool: heldId });
      } catch (err) {
        console.warn('[gather] playAction failed', err);
      }
      if (typeof d === 'number' && d > 0) {
        swingAct = action;
        const tm = p.action;
        const impact = tm && Number.isFinite(tm.impact) ? tm.impact : d * 0.5;
        realImpactIn = impact + 0.25; // safety: fire anyway if the event never comes
        return { dur: d, impact };
      }
      if (d === false && usingReal) return null; // busy: next frame
    }
    // stand-in
    swingT = 0;
    swingDur = interval;
    swingAct = action;
    mockImpactIn = interval * 0.55;
    return { dur: interval, impact: mockImpactIn };
  }

  function tipWorld(out) {
    const p = ctx.player;
    if (usingReal && p?.toolSocket) {
      p.toolSocket.updateWorldMatrix?.(true, false);
      return out.setFromMatrixPosition(p.toolSocket.matrixWorld);
    }
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, false);
    return mesh.localToWorld(out.copy(mesh.userData.tip));
  }

  /** Stand-in placement: hand position + character yaw + swing pitch. */
  function update(dt) {
    if (mockImpactIn >= 0) {
      mockImpactIn -= dt;
      if (mockImpactIn < 0) impactCb?.(swingAct);
    }
    if (realImpactIn >= 0) {
      realImpactIn -= dt;
      if (realImpactIn < 0) impactCb?.(swingAct);
    }
    if (!mesh || usingReal) return;
    const p = ctx.player;
    const obj = p?.object;
    if (!obj || p.onFoot === false || !obj.visible) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const bone = p.weaponRig?.chr?.bones?.[HAND_R];
    obj.updateWorldMatrix(true, false);
    const yaw = p.heading ?? 0;
    _qy.setFromAxisAngle(_up, yaw);
    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    if (bone) {
      bone.updateWorldMatrix(true, false);
      _p.setFromMatrixPosition(bone.matrixWorld);
    } else {
      _p.setFromMatrixPosition(obj.matrixWorld).addScaledVector(_up, 1.05).addScaledVector(_right, 0.32);
    }
    let pitch = 0.55;
    let lift = 0;
    let reach = 0.05;
    if (swingT >= 0) {
      swingT += dt;
      const u = Math.min(1, swingT / Math.max(0.2, swingDur));
      const strike = swingAct === 'gather' ? 0.25 : 1;
      if (u < 0.42) {
        const k = u / 0.42;
        const e = k * k * (3 - 2 * k);
        pitch = 0.55 + (-1.15 - 0.55) * e * strike;
        lift = 0.28 * e * strike;
      } else if (u < 0.55) {
        const k = (u - 0.42) / 0.13;
        const e = k * k;
        pitch = -1.15 * strike + (1.55 + 1.15) * e * strike;
        lift = 0.28 * (1 - e) * strike;
        reach = 0.05 + 0.3 * e;
      } else {
        const k = (u - 0.55) / 0.45;
        const e = 1 - (1 - k) * (1 - k);
        pitch = 1.55 * strike + (0.55 - 1.55 * strike) * e;
        reach = 0.35 - 0.3 * e;
      }
      if (u >= 1) swingT = -1;
    }
    if (mesh.userData.grip === 'laser') {
      _qs.setFromAxisAngle(_x, swingT >= 0 ? -0.08 : 0);
      lift = 0.12;
      reach = 0.22;
    } else _qs.setFromAxisAngle(_x, -pitch);
    _q.copy(_qy).multiply(_qs);
    _p.addScaledVector(_up, lift).addScaledVector(_fwd, reach);
    _m.compose(_p, _q, _s.set(1, 1, 1));
    mesh.matrix.copy(_m);
    mesh.matrixWorldNeedsUpdate = true;
  }

  return {
    hold,
    swing,
    tipWorld,
    update,
    onImpact(fn) {
      impactCb = fn;
    },
    cancelImpact() {
      mockImpactIn = -1;
      realImpactIn = -1;
    },
    get held() {
      return heldId;
    },
    get real() {
      return usingReal;
    },
  };
}
