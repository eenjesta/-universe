/**
 * The 'title' game mode: the player idles on the spawn ridge (heading 0),
 * the cinematic camera frames them against the lake, city and sunset, the
 * golden hour is kept (unless the save or ?time= sets another time), and the
 * title screen is mounted. Card thumbnails render behind the boot overlay.
 */
import { TitleCamera } from './titleCamera.js';
import { TitleScreen } from './titleScreen.js';
import { Thumbnails } from './thumbnails.js';

const GOLDEN_HOUR = 17.6;

export function registerTitleMode(ctx, shell) {
  const camera = new TitleCamera(ctx);
  const thumbs = new Thumbnails(ctx);
  const screen = new TitleScreen(ctx, shell, thumbs);
  // the camera frames the part of the screen the title UI leaves visible
  camera.frame = () => screen.sceneFrame();
  let pinnedHour = null;
  let pinAcc = 0;
  let visits = 0;

  const mode = {
    scene: ctx.world?.scene,
    camera: ctx.camera,
    pointerLock: false,
    hud: 'title',
    enter(params = {}, from) {
      const initial = !!params.initial || from === 'boot' || from == null;
      visits++;
      ctx.loop.paused = false;
      shell.rememberPosition(from);

      // player idle on the ridge, facing north over the lake
      const pl = ctx.player;
      try {
        pl?.teleport?.('spawn', 0);
        pl?.velocity?.set?.(0, 0, 0);
        if (pl && 'state' in pl) pl.state = 'idle';
        pl?.setVisible?.(true);
        if (ctx.cameraRig) ctx.cameraRig.yaw = 0;
      } catch (err) {
        console.warn('[shell] could not pose the player for the title', err);
      }

      // golden hour unless the save / URL chose a time
      if (initial && ctx.params.time == null && !ctx.state.loadedFromSave) ctx.world?.setTimeOfDay?.(GOLDEN_HOUR);
      pinnedHour = Number.isFinite(ctx.world?.timeOfDay) ? ctx.world.timeOfDay : null;
      pinAcc = 0;

      // mount first: the camera composition reads the title layout
      screen.mount({ intro: initial && visits === 1 ? 'long' : 'short' });
      camera.begin(initial && visits === 1 ? 'long' : 'short');
    },
    exit() {
      screen.unmount();
      camera.end();
    },
    update(dt) {
      camera.update(dt);
      ctx.audio?.setListener?.(ctx.camera);
      // keep the title at its time of day while time flows elsewhere
      pinAcc += dt;
      if (pinnedHour != null && pinAcc > 1.5) {
        pinAcc = 0;
        const now = ctx.world?.timeOfDay;
        if (Number.isFinite(now) && Math.abs(now - pinnedHour) > 0.04) ctx.world.setTimeOfDay?.(pinnedHour);
      }
    },
  };
  ctx.modes.register('title', mode);
  return { camera, thumbs, screen, mode };
}
