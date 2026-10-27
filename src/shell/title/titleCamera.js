/**
 * Cinematic title camera: just behind the player on the spawn ridge, looking
 * past them over the lake toward Aurora City and the sunset (crop_hero.png /
 * 09_key_art_poster.png): the character slightly left of the centre of the
 * visible scene, the city to the right with the sun setting just left of the
 * pillars panel, the lake below the far shore. A crane-down intro, a slow
 * drift and subtle mouse parallax.
 *
 * The composition is solved every frame from the aspect ratio and the actual
 * title layout (`frame()` → the part of the screen not covered by the pillars
 * panel and the cards band), so it holds at 1280×720, 1920×1080 and narrow
 * windows alike.
 */
import * as THREE from 'three';
import { ZONES } from '../../world/layout.js';
import { clamp, damp, easeInOutCubic, wrapAngle } from '../../core/math.js';
import { isSoftwareRenderer } from '../util.js';

export const TITLE_COMPOSITION = {
  fov: 52, // vertical field of view at 16:9 (wider on narrower screens)
  dist: 3.9, // metres behind the player
  height: 1.45, // camera height above the player's feet
  playerX: 0.5, // player x as a fraction of the visible scene width
  // the sun sits this far (screen fraction) left of the scene's right edge;
  // negative = just behind the pillars panel, its glow spilling into the
  // scene, which puts the city's spires to the right of the player (crop_hero)
  sunInset: -0.025,
  cityX: [0.7, 0.9], // allowed city-centre x, fraction of the visible scene width
  cityXNight: 0.78, // city centre when the sun is down
  shoreY: 0.68, // far shore at this fraction of the visible scene height
  shoreDist: 1000, // metres to the far shore / city waterfront
  introDur: 6.2, // seconds of crane-down when the game boots into the title
};

const DEFAULT_FRAME = { right: 0.76, bottom: 0.667 };

export class TitleCamera {
  constructor(ctx) {
    this.ctx = ctx;
    this.cam = ctx.camera;
    this.p = { ...TITLE_COMPOSITION };
    /** () → { right, bottom }: visible scene region as viewport fractions. */
    this.frame = null;
    this.t = 0;
    this.introT = 0;
    this.introDur = 0;
    this.parX = 0;
    this.parY = 0;
    this.fov = this.p.fov;
    this._P = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._startPos = new THREE.Vector3();
    this._startLook = new THREE.Vector3();
    this._prevFov = null;
    this._lastNow = 0;
  }

  /** Called on title enter. `intro`: 'long' (boot), 'short' (return) or false. */
  begin(intro = 'long') {
    const cam = this.cam;
    if (this._prevFov == null) this._prevFov = cam.fov;
    // a crane shot at one frame per second is no shot at all (software GL):
    // start on the final composition there
    if (isSoftwareRenderer(this.ctx.engine.renderer)) intro = false;
    this.t = 0;
    this.introT = 0;
    this._lastNow = 0;
    this.introDur = intro === 'long' ? this.p.introDur : intro === 'short' ? 2.6 : 0;
    this.parX = 0;
    this.parY = 0;
    this._solve(0, this._pos, this._look);
    // intro start: higher and further back, looking up toward the planet
    const back = intro === 'long' ? 30 : 9;
    const up = intro === 'long' ? 15 : 4;
    this._startPos.copy(this._pos).addScaledVector(this._fwd, -back);
    this._startPos.y += up;
    this._startLook.copy(this._look);
    this._startLook.y += intro === 'long' ? 70 : 20;
    if (this.introDur > 0) this._apply(this._startPos, this._startLook, this.fov - 4);
    else this._apply(this._pos, this._look, this.fov);
  }

  /** Restores the shared camera's FOV when leaving the title. */
  end() {
    if (this._prevFov != null) {
      this.cam.fov = this._prevFov;
      this.cam.updateProjectionMatrix();
    }
    this._prevFov = null;
  }

  /** Jumps to the end of the intro (tests, impatient players clicking). */
  skipIntro() {
    this.introT = this.introDur;
  }

  /** Remaining intro fraction (0 = done). */
  get introLeft() {
    return this.introDur > 0 ? 1 - Math.min(1, this.introT / this.introDur) : 0;
  }

  update(dt) {
    this.t += dt;
    // the intro runs on wall-clock time (the loop caps dt at 0.05 s, which
    // would stretch the crane shot on slow machines); simulated steps still
    // advance it by at least dt. A long stall (hidden tab) simply ends it.
    const now = performance.now();
    const realDt = this._lastNow ? Math.max(dt, (now - this._lastNow) / 1000) : dt;
    this._lastNow = now;
    const m = this.ctx.input.mouse;
    // parallax only once the intro is mostly done
    const w = 1 - this.introLeft;
    this.parX = damp(this.parX, clamp(m.ndcX || 0, -1, 1) * w, 2.2, dt);
    this.parY = damp(this.parY, clamp(m.ndcY || 0, -1, 1) * w, 2.2, dt);
    this._solve(this.t, this._pos, this._look);
    if (this.introDur > 0 && this.introT < this.introDur) {
      this.introT += realDt;
      const k = easeInOutCubic(Math.min(1, this.introT / this.introDur));
      this._pos.lerpVectors(this._startPos, this._pos, k);
      this._look.lerpVectors(this._startLook, this._look, k);
      this._apply(this._pos, this._look, this.fov - 4 * (1 - k));
    } else this._apply(this._pos, this._look, this.fov);
  }

  _apply(pos, look, fov) {
    const cam = this.cam;
    // never dip into the terrain
    const ground = this.ctx.world?.getHeightAt?.(pos.x, pos.z);
    if (Number.isFinite(ground) && pos.y < ground + 0.45) pos.y = ground + 0.45;
    cam.position.copy(pos);
    cam.lookAt(look);
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  _frame() {
    let f = null;
    try {
      f = this.frame?.();
    } catch {
      f = null;
    }
    return f && Number.isFinite(f.right) && Number.isFinite(f.bottom) ? f : DEFAULT_FRAME;
  }

  /**
   * Camera heading that puts the sun just left of the scene's right edge
   * while keeping the city centre inside `cityX` (heading h faces
   * (−sin h, −cos h); a target with heading β appears at
   * x = 0.5 + 0.5·tan(yaw − β) / tanH).
   */
  _composeYaw(P, tanH, frame) {
    const p = this.p;
    const city = ZONES.city;
    const bCity = Math.atan2(-(city.x - P.x), -(city.z - P.z));
    const at = (x) => Math.atan((x - 0.5) * 2 * tanH);
    const W = frame.right;
    const sun = this.ctx.world?.sunDirection;
    if (!sun || !(sun.y > -0.03) || !Number.isFinite(sun.x)) return bCity + at(p.cityXNight * W);
    const bSun = Math.atan2(-sun.x, -sun.z);
    const sunX = clamp(W - p.sunInset, 0.55, 0.95);
    const rel = wrapAngle(bSun + at(sunX) - bCity); // relative to the city direction
    return bCity + clamp(rel, at(p.cityX[0] * W), at(p.cityX[1] * W));
  }

  /** Hero composition for time t (with drift + parallax). */
  _solve(t, outPos, outLook) {
    const ctx = this.ctx;
    const p = this.p;
    const P = this._P;
    const pp = ctx.player?.position;
    if (pp?.isVector3) P.copy(pp);
    else {
      const s = ZONES.spawn;
      P.set(s.x, ctx.world?.getHeightAt?.(s.x, s.z) ?? s.elevation, s.z);
    }
    const frame = this._frame();
    const aspect = this.cam.aspect || 16 / 9;
    // keep roughly the same horizontal coverage on narrower screens
    this.fov = clamp(p.fov * Math.sqrt(1.7778 / aspect), p.fov - 8, p.fov + 14);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.fov / 2));
    const tanH = tanV * aspect;
    const baseYaw = this._composeYaw(P, tanH, frame);
    const yaw = baseYaw + Math.sin(t * 0.13) * 0.006 - this.parX * 0.014;
    const fwd = this._fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    // with a full-width scene (narrow screens, no pillars) keep the player central
    const px = frame.right > 0.9 ? 0.5 : clamp(p.playerX * frame.right, 0.3, 0.6);
    const side = (0.5 - px) * 2 * p.dist * tanH + Math.sin(t * 0.21) * 0.1 + this.parX * 0.24;
    const height = p.height + Math.sin(t * 0.17) * 0.05 + this.parY * 0.1;
    outPos.copy(P).addScaledVector(fwd, -p.dist).addScaledVector(right, side);
    outPos.y += height;
    // pitch so the far shore lands at shoreY of the visible scene height
    const yT = clamp(p.shoreY * frame.bottom, 0.28, 0.6);
    const beta = Math.atan((0.5 - yT) * 2 * tanV); // wanted angle above the view centre
    const depression = Math.atan2(Math.max(1, outPos.y - (ctx.world?.waterLevel ?? 0)), p.shoreDist);
    const pitch = -depression - beta + this.parY * 0.01;
    outLook.copy(outPos).addScaledVector(fwd, 100);
    outLook.y += Math.tan(pitch) * 100;
  }
}
