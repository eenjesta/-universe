import * as THREE from 'three';

/**
 * Weapons + hit resolution: pooled laser bolts (one instanced additive draw
 * call), homing missiles, damage routing to AI ships / the player, and the
 * player's target lock (nearest hostile to the crosshair).
 *
 *   combat.fireBolt(origin, dir, team, {speed, damage, color, inherit})
 *   combat.fireMissile(origin, dir, target, team)
 *   combat.update(dt)      combat.lock (entity | null)
 * Teams: 'ally' (player + wingmen + convoy) and 'pirate'.
 */

const MAX_B = 260;
const MAX_M = 20;
const NEG_Z = new THREE.Vector3(0, 0, -1);

export const BOLT_COLORS = {
  player: new THREE.Color(1.1, 3.0, 6.5),
  ally: new THREE.Color(0.9, 2.2, 5.2),
  pirate: new THREE.Color(7.0, 0.7, 0.45),
};

function segSphere(a, b, c, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz;
  const B = fx * dx + fy * dy + fz * dz;
  const C = fx * fx + fy * fy + fz * fz - r * r;
  if (C < 0) return 0;
  if (A < 1e-9) return -1;
  const disc = B * B - A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / A;
  return t >= 0 && t <= 1 ? t : -1;
}

export function createCombat(S) {
  const { ctx, fx } = S;
  const group = new THREE.Group();
  group.name = 'space-combat';

  // ---------------------------------------------------------- bolts
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_B);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const col = new THREE.Color();
  for (let i = 0; i < MAX_B; i++) {
    mesh.setMatrixAt(i, zero);
    mesh.setColorAt(i, col.setRGB(0, 0, 0));
  }
  group.add(mesh);
  const bolts = Array.from({ length: MAX_B }, () => ({
    on: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    life: 0,
    team: 'ally',
    player: false,
    dmg: 10,
    len: 24,
    color: new THREE.Color(),
  }));
  let head = 0;

  function fireBolt(origin, dir, team, { speed = 2300, damage = 10, color = null, inherit = null, player = false, life = 1.4 } = {}) {
    const b = bolts[head];
    head = (head + 1) % MAX_B;
    b.on = true;
    b.pos.copy(origin);
    b.vel.copy(dir).normalize().multiplyScalar(speed);
    if (inherit) b.vel.add(inherit);
    b.life = life;
    b.team = team;
    b.player = player;
    b.dmg = damage;
    b.len = player ? 30 : 24;
    b.color.copy(color || (player ? BOLT_COLORS.player : BOLT_COLORS[team] || BOLT_COLORS.ally));
    return b;
  }

  // ---------------------------------------------------------- missiles
  const mGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.8, 8);
  mGeo.rotateX(Math.PI / 2);
  const mMat = new THREE.MeshStandardMaterial({ color: 0x9a9da3, metalness: 0.7, roughness: 0.35, emissive: new THREE.Color(1.2, 0.4, 0.1), emissiveIntensity: 0.4 });
  const mMesh = new THREE.InstancedMesh(mGeo, mMat, MAX_M);
  mMesh.frustumCulled = false;
  for (let i = 0; i < MAX_M; i++) mMesh.setMatrixAt(i, zero);
  group.add(mMesh);
  const missiles = Array.from({ length: MAX_M }, () => ({
    on: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    target: null,
    life: 0,
    team: 'ally',
    player: false,
    speed: 300,
  }));
  function fireMissile(origin, dir, target, team = 'ally', { player = false, inherit = null } = {}) {
    const m = missiles.find((x) => !x.on);
    if (!m) return null;
    m.on = true;
    m.pos.copy(origin);
    m.vel.copy(dir).normalize().multiplyScalar(260);
    if (inherit) m.vel.add(inherit);
    m.speed = m.vel.length();
    m.target = target;
    m.life = 6.5;
    m.team = team;
    m.player = player;
    return m;
  }

  // ---------------------------------------------------------- damage routing
  const hitPoint = new THREE.Vector3();
  const hitN = new THREE.Vector3();
  const SPARK_HULL = new THREE.Color(4, 2.6, 1.4);

  /** Applies damage to a hittable (AI entity or the player). */
  function damage(target, amount, at, { player = false, missile = false } = {}) {
    if (!target?.alive) return;
    if (target.isPlayer) {
      target.damage(amount, at);
      return;
    }
    target.hp -= amount * (target.armor ?? 1);
    target.hitT = 0.25;
    hitN.copy(at).sub(target.position).normalize();
    fx.sparks(at, hitN, missile ? 20 : 8, SPARK_HULL);
    if (target.onHit) target.onHit(player);
    if (target.hp <= 0) S.ships.kill(target, player);
  }

  function hostileTo(team) {
    return team === 'pirate' ? 'ally' : 'pirate';
  }

  /** First hittable of the opposite team on segment a→b. Returns {target, t}. */
  const best = { target: null, t: 2 };
  function segmentTargets(a, b, team) {
    best.target = null;
    best.t = 2;
    const want = hostileTo(team);
    const list = S.ships.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.team !== want) continue;
      const t = segSphere(a, b, e.position, e.hitRadius || e.radius);
      if (t >= 0 && t < best.t) {
        best.t = t;
        best.target = e;
      }
    }
    const p = S.player;
    if (want === 'ally' && p.alive && !p.docked) {
      const t = segSphere(a, b, p.position, p.radius + 1.5);
      if (t >= 0 && t < best.t) {
        best.t = t;
        best.target = p;
      }
    }
    return best;
  }

  // ---------------------------------------------------------- lock-on
  const _to = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  let lockT = 0;
  function updateLock(dt) {
    const p = S.player;
    lockT += dt;
    if (!p.alive) {
      api.lock = null;
      return;
    }
    p.getForward(_fwd);
    const cur = api.lock;
    if (cur) {
      _to.copy(cur.position).sub(p.position);
      const d = _to.length();
      const ang = _fwd.angleTo(_to);
      if (!cur.alive || d > 4200 || ang > 0.42) api.lock = null;
    }
    if (lockT < 0.2) return;
    lockT = 0;
    let bestE = null;
    let bestA = 0.26;
    for (const e of S.ships.list) {
      if (!e.alive || e.team !== 'pirate') continue;
      _to.copy(e.position).sub(p.position);
      const d = _to.length();
      if (d > 3800) continue;
      const a = _fwd.angleTo(_to) + d / 40000;
      if (a < bestA) {
        bestA = a;
        bestE = e;
      }
    }
    if (bestE && (!api.lock || bestE !== api.lock)) {
      if (!api.lock) api.lock = bestE;
      else {
        _to.copy(api.lock.position).sub(p.position);
        if (_fwd.angleTo(_to) > bestA + 0.05) api.lock = bestE;
      }
    }
  }

  // ---------------------------------------------------------- update
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const desired = new THREE.Vector3();
  const puffVel = new THREE.Vector3();
  const PUFF = new THREE.Color(3.5, 1.6, 0.6);
  const MISSILE_BOOM = new THREE.Color(6, 3, 1.2);

  function explodeMissile(m, at) {
    m.on = false;
    fx.explosion(at, 0.9, { debrisCount: 0 });
    ctx.audio.play('explosion', { position: at, volume: 0.8 });
    // splash
    for (const e of S.ships.list) {
      if (!e.alive || e.team === m.team) continue;
      const d = e.position.distanceTo(at);
      if (d < 70) damage(e, (m.target === e ? 150 : 60) * (1 - d / 140), at, { player: m.player, missile: true });
    }
    if (m.team === 'pirate' && S.player.alive && S.player.position.distanceTo(at) < 60) damage(S.player, 40, at);
  }

  function update(dt) {
    const field = S.field;
    // bolts
    for (let i = 0; i < MAX_B; i++) {
      const bo = bolts[i];
      if (!bo.on) continue;
      bo.life -= dt;
      a.copy(bo.pos);
      b.copy(bo.pos).addScaledVector(bo.vel, dt);
      let hit = false;
      // ships / player
      const r = segmentTargets(a, b, bo.team);
      // asteroids
      const tr = field ? field.segmentHit(a, b, 0) : -1;
      if (r.target && (tr < 0 || r.t <= tr)) {
        hitPoint.copy(a).lerp(b, r.t);
        damage(r.target, bo.dmg, hitPoint, { player: bo.player });
        fx.flash(hitPoint, 5, bo.color, 0.12);
        hit = true;
      } else if (tr >= 0) {
        hitPoint.copy(a).lerp(b, tr);
        dir.copy(bo.vel).normalize().negate();
        fx.sparks(hitPoint, dir, 6, bo.color);
        fx.flash(hitPoint, 6, bo.color, 0.1);
        hit = true;
      } else if (S.station && b.distanceToSquared(S.station.position) < 2.2e6 && S.station.sdf(b) < 0) {
        fx.flash(b, 6, bo.color, 0.1);
        hit = true;
      }
      if (hit || bo.life <= 0) {
        bo.on = false;
        mesh.setMatrixAt(i, zero);
        continue;
      }
      bo.pos.copy(b);
      dir.copy(bo.vel).normalize();
      q.setFromUnitVectors(NEG_Z, dir);
      const w = bo.player ? 0.55 : 0.45;
      m4.compose(bo.pos, q, s.set(w, w, bo.len));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, bo.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // missiles
    for (let i = 0; i < MAX_M; i++) {
      const m = missiles[i];
      if (!m.on) {
        mMesh.setMatrixAt(i, zero);
        continue;
      }
      m.life -= dt;
      m.speed = Math.min(860, m.speed + 520 * dt);
      dir.copy(m.vel).normalize();
      const tgt = m.target;
      if (tgt && tgt.alive) {
        const dist = tgt.position.distanceTo(m.pos);
        desired.copy(tgt.position).addScaledVector(tgt.velocity || puffVel.set(0, 0, 0), Math.min(2, dist / Math.max(m.speed, 1)));
        desired.sub(m.pos).normalize();
        const ang = dir.angleTo(desired);
        const maxTurn = 2.8 * dt;
        if (ang > 1e-4) dir.lerp(desired, Math.min(1, maxTurn / ang)).normalize();
        if (dist < 24) {
          explodeMissile(m, m.pos);
          continue;
        }
      }
      m.vel.copy(dir).multiplyScalar(m.speed);
      a.copy(m.pos);
      m.pos.addScaledVector(m.vel, dt);
      if ((field && field.segmentHit(a, m.pos, 0) >= 0) || m.life <= 0) {
        explodeMissile(m, m.pos);
        continue;
      }
      q.setFromUnitVectors(NEG_Z, dir);
      m4.compose(m.pos, q, s.set(1, 1, 1));
      mMesh.setMatrixAt(i, m4);
      puffVel.copy(m.vel).multiplyScalar(-0.15);
      b.copy(m.pos).addScaledVector(dir, -1.8);
      fx.puff(b, puffVel, PUFF, 2.2, 0.45);
    }
    mMesh.instanceMatrix.needsUpdate = true;

    updateLock(dt);
  }

  const api = {
    group,
    lock: null,
    bolts,
    missiles,
    fireBolt,
    fireMissile,
    damage,
    update,
    clear() {
      bolts.forEach((x, i) => {
        x.on = false;
        mesh.setMatrixAt(i, zero);
      });
      missiles.forEach((x) => (x.on = false));
      api.lock = null;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mGeo.dispose();
      mMat.dispose();
    },
  };
  return api;
}
