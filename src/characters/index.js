/**
 * Characters module entry (Ø Universe).
 *
 * Installs the shared character material, the player (ctx.player), the
 * third-person camera rig (ctx.cameraRig), NPCs + drones (ctx.npcs), portraits
 * (ctx.portraits) and the modes 'explore' (on foot) and 'customize' (character
 * creator studio + screen). Owns state.profile and state.player.
 *
 * Public API (ARCHITECTURE.md §5 plus extras):
 *   ctx.player     object, position, velocity, heading, state, onFoot, controlsEnabled,
 *                  appearance, setAppearance(app), setVisible(bool), teleport(zone | {x,z} | Vector3, heading?),
 *                  setPose('idle' | 'wave' | 'cheer' | 'clap' | 'talk' | 'tablet' | 'sit'), headPosition(out),
 *                  grounded, swimming, wading, sprinting, zone,
 *                  combat: holdWeapon(mesh | null, {grip, muzzle, support, stock, holster}) → {object, grip, holstered},
 *                  weapon, holster(bool), setAim(bool), aiming, aimAt(point | null),
 *                  playAction('shoot' | 'reload' | 'hit' | 'dodge' | 'die' | 'respawn', opts) → bool,
 *                  dodging (i-frames), rolling, dead, netAnim() → anim state, muzzleWorld(out),
 *                  work: holdTool(mesh | toolId | null, {grip}), tool, playAction('chop' | 'mine' | 'gather' |
 *                  'eat' | 'use' | 'build', {item, at, speed}) → duration s | false (every action returns its
 *                  duration), actionTiming(name, tool?) → {dur, impact, move}, action, toolSocket (Object3D),
 *                  view ('third' | 'first'), firstPerson (setView, toggle, view, viewModel)
 *   ctx.cameraRig  camera, yaw, pitch, distance, follow(object, {distance, height, minDistance, maxDistance,
 *                  shoulder, aimHeight, align, focusRate, snap}), update(dt), shake(amount), zoomEnabled, lookEnabled,
 *                  snap(), setYaw(h, pitch?), focus(target | null, {distance, pitch, rate}), rightVec,
 *                  setAim(bool), aiming, aimW, aim (framing settings), aimRay() → {origin, dir (= direction), near},
 *                  first person: view, setView(v), fpW (0…1), firstPerson, fpBlock, fov
 *   ctx.remotes    remote player avatars (remotes.js): add(id, {name, appearance}), remove(id), get(id),
 *                  list, count, clear(), mock(n) (?mockRemotes=N), driven by ctx.net.players views
 *   ctx.npcs       list, get(id), party (Set), named, say/setGoal/follow/lookAt per NPC,
 *                  spawn(def), remove(id), startGathering(), endGathering(), triangles()
 *   ctx.portraits  render(appearance | npcId, {width, height, framing: 'face'|'bust'|'full', view, fast}), has(), clearCache()
 * Events: player:zone, player:jump, player:land, player:footstep, player:dodge, player:die,
 * player:respawn, npc:interact, npc:say, customize:done, remote:add, remote:remove,
 * action:start {action, tool, item, duration, impact, view}, action:impact {action, tool, view, at, dir},
 * camera:mode {mode: 'third' | 'first', fov}.
 * Settings read: settings.camera ('third' | 'first'; V toggles), settings.fov (70), settings.headBob (true).
 * Heavy hero meshes are built in a module worker (build-worker.js) when possible.
 */
import './characters.css';
import { registerIcons } from '../ui/icons.js';
import { createCharacterMaterial, updateRimFromWorld } from './material.js';
import { createPlayer, setWorkNetAnims } from './player.js';
import { createCameraRig } from './camera-rig.js';
import { createPortraits } from './portraits.js';
import { createNpcs } from './npcs.js';
import { createDrones } from './drones.js';
import { createCombatFx } from './combat-fx.js';
import { createRemotes } from './remotes.js';
import { createFirstPerson } from './first-person.js';
import { createSwingTrails } from './swing-trail.js';
import { Labels } from './labels.js';
import { createStudio } from './studio.js';
import { createCreator, defaultName, isDefaultName } from './creator.js';
import { NAMED } from './npc-roster.js';
import { normalizeAppearance, appearanceKey, randomAppearance, OUTFITS, HAIR_STYLES, SKIN_TONES, OUTFIT_COLORS } from './appearance.js';

export const PLAYER_CAM = { distance: 2.45, height: 1.5, minDistance: 1.2, maxDistance: 12, shoulder: 0.44, aimHeight: 0.34, align: 0 };

registerIcons({
  'chr-face': '<path d="M12 3.4c-3.7 0-6.1 2.8-6.1 6.8 0 4.8 2.8 8.6 6.1 8.6s6.1-3.8 6.1-8.6c0-4-2.4-6.8-6.1-6.8Z"/><path d="M9.6 10.6h.01M14.4 10.6h.01M10.2 14.4c1.1.7 2.5.7 3.6 0"/><path d="M8.2 20.6c1.2.6 2.4.9 3.8.9s2.6-.3 3.8-.9"/>',
  'chr-hair': '<path d="M5.2 13.4C5 8 8 4.4 12 4.4s7 3.6 6.8 9"/><path d="M5.2 13.4c1.4-3 4-4.6 7.2-5 2.2 1.6 4.4 2.3 6.4 2.4"/><path d="M7.6 13.6c0 3.9 2 6.6 4.4 6.6s4.4-2.7 4.4-6.6"/>',
  'chr-outfit': '<path d="M9 3.6 5 5.6 3.4 11.2l2.9 1.1v8.3h11.4v-8.3l2.9-1.1L19 5.6l-4-2"/><path d="M9 3.6c.5 1.6 1.6 2.5 3 2.5s2.5-.9 3-2.5M12 6.1v14.5"/>',
  'chr-gear': '<path d="M6.8 9a5.2 5.2 0 0 1 10.4 0v11.6H6.8Z"/><path d="M9.8 9V6.4a2.2 2.2 0 0 1 4.4 0V9M6.8 13.4h10.4M10 13.4v2.6h4v-2.6"/>',
  'chr-dice': '<rect x="4" y="4" width="16" height="16" rx="3.2"/><circle cx="8.6" cy="8.6" r=".9" fill="currentColor"/><circle cx="15.4" cy="15.4" r=".9" fill="currentColor"/><circle cx="15.4" cy="8.6" r=".9" fill="currentColor"/><circle cx="8.6" cy="15.4" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
  'chr-lock': '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  'chr-arrow': '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
});

export async function install(ctx, { progress = () => {} } = {}) {
  const t0 = performance.now();
  const world = ctx.world;
  const camera = ctx.camera;
  const { state, events, modes, loop, ui, input } = ctx;
  const worldMat = createCharacterMaterial({ rim: 1, name: 'chr-world' });
  // the local player's own material: same shader + the first-person upper-body discard (colour pass only)
  const playerMat = createCharacterMaterial({ rim: 1, name: 'chr-player', fpHide: true });

  // ---------------------------------------------------------------- profile
  const profile = state.ensure('profile', { name: defaultName(), created: false, appearance: normalizeAppearance({}) });
  if (!profile.appearance) state.set('profile.appearance', normalizeAppearance({}));
  // An untouched default name ('Traveler' / 'Reiziger') follows the active language.
  if (!profile.created && isDefaultName(profile.name) && profile.name !== defaultName()) state.set('profile.name', defaultName());
  progress(0.05);

  // ------------------------------------------------------------ rig + player
  const rig = createCameraRig(ctx);
  ctx.cameraRig = rig;
  const fx = createCombatFx(ctx);
  // additive ribbons behind swinging tool heads (3P + remotes): swings read from any camera angle
  const trails = createSwingTrails(ctx);
  const player = createPlayer(ctx, { material: playerMat, fx, trails });
  ctx.player = player;
  // first person: view toggle (V / touch / scroll), eye camera, body hiding, view model (arms + items)
  const firstPerson = createFirstPerson(ctx, { player, rig, material: playerMat });
  player.firstPerson = firstPerson;
  // remotes see chop / mine / gather / eat / use once the sim accepts them in C.STATE (same build as the server)
  import('../../shared/sim/players.js')
    .then((m) => {
      const A = m?.ANIMS;
      if (A && (typeof A.has === 'function' ? A.has('chop') : Array.isArray(A) && A.includes('chop'))) setWorkNetAnims(true);
    })
    .catch(() => {});
  progress(0.3);

  // -------------------------------------------------------------- portraits
  const portraits = createPortraits(ctx, {
    resolveAppearance: (id) => {
      if (id === 'player') return player.appearance;
      const n = ctx.npcs?.get?.(id);
      if (n?.appearance) return n.appearance;
      const r = NAMED.find((x) => x.id === id);
      return r ? normalizeAppearance(r.app) : null;
    },
  });
  ctx.portraits = portraits;

  // ------------------------------------------------------------------- NPCs
  const labels = new Labels(ctx);
  let npcs;
  try {
    npcs = createNpcs(ctx, { material: worldMat, labels });
  } catch (err) {
    console.error('[characters] NPCs failed — continuing without them', err);
    ctx.errors.push({ module: 'characters/npcs', error: String(err?.stack || err) });
    npcs = { list: [], party: new Set(), get: () => null, update() {}, named: [] };
  }
  ctx.npcs = npcs;
  progress(0.7);
  let drones = null;
  try {
    drones = createDrones(ctx, { material: worldMat });
  } catch (err) {
    console.error('[characters] drones failed', err);
  }

  // ---------------------------------------------------------- remote players
  let remotes = null;
  try {
    remotes = createRemotes(ctx, { material: worldMat, labels, fx, trails });
  } catch (err) {
    console.error('[characters] remote players failed — continuing without them', err);
    ctx.errors.push({ module: 'characters/remotes', error: String(err?.stack || err) });
  }
  ctx.remotes = remotes;

  // ------------------------------------------------------------ loop systems
  loop.add(
    'chr-rim',
    () => {
      updateRimFromWorld(worldMat, world, 0.78);
      updateRimFromWorld(playerMat, world, 0.78);
    },
    { order: 19 },
  );
  // view model + FP feel after the camera (modes 20) and combat (21): this frame's muzzle / socket
  loop.add('chr-fp', (dt) => firstPerson.update(dt), { order: 28 });
  loop.add('chr-remotes', (dt) => remotes?.update(dt), { order: 34, when: () => modes.is('explore', 'drive', 'title') });
  loop.add('chr-fx', (dt) => fx.update(dt), { order: 35 });
  loop.add('chr-trails', (dt) => trails.update(dt), { order: 36 });
  loop.add('chr-player-idle', (dt) => player.idle(dt, modes.is('title')), {
    order: 30,
    when: () => !modes.is('explore', 'customize') && player.object.visible,
  });
  loop.add('chr-npcs', (dt) => npcs.update(dt), { order: 32, when: () => modes.is('explore', 'drive', 'title') });
  loop.add('chr-drones', (dt, t) => drones?.update(dt, t), { order: 33, when: () => modes.is('explore', 'drive', 'title') });
  loop.add('chr-labels', () => labels.update(), { order: 95, pausable: false });

  // ---------------------------------------------------------------- explore
  modes.register('explore', {
    scene: world.scene,
    camera,
    pointerLock: true,
    hud: 'explore',
    enter(params = {}) {
      player.setVisible(true);
      player.onFoot = true;
      player.controlsEnabled = true;
      player.state = 'idle';
      rig.follow(player.object, PLAYER_CAM);
      rig.zoomEnabled = true;
      rig.lookEnabled = true;
      const saved = state.get('player');
      if (params.zone) player.teleport(params.zone, params.heading);
      else if (params.position && Number.isFinite(params.position.x)) player.teleport(params.position, params.position.heading ?? params.heading);
      else if (params.initial || params.resume) {
        if (saved?.position && Number.isFinite(saved.position.x)) player.teleport(saved.position, saved.heading ?? 0);
        else player.teleport(saved?.zone || 'spawn');
      }
      rig.snap();
    },
    exit() {
      player.save();
    },
    update(dt) {
      player.update(dt);
      rig.update(dt);
      firstPerson.handleInput();
      ctx.audio.setListener(camera);
      if (input.actionPressed('character') && !modes.transitioning) {
        modes.go('customize', { returnTo: 'explore' });
      }
    },
  });

  // -------------------------------------------------------------- customize
  const studio = createStudio(ctx);
  let returnTo = 'explore'; // after Confirm (params.returnTo, default explore)
  let cancelTo = 'explore'; // after Esc (params.returnTo, else the previous mode)
  let returnParams = {};
  let popEsc = null;
  const creator = createCreator(ctx, {
    studio,
    onConfirm: ({ appearance, name }) => {
      state.set('profile', { ...(state.get('profile') || {}), name, created: true, appearance });
      player.setAppearance(appearance);
      events.emit('customize:done', { appearance, name });
      state.save?.();
      modes.go(returnTo, returnParams);
    },
    onCancel: () => modes.go(cancelTo, cancelTo === returnTo ? returnParams : { resume: true }),
  });
  loop.add('chr-creator-thumbs', () => creator.pump(), { order: 92, pausable: false, when: () => modes.is('customize') });
  modes.register('customize', {
    scene: studio.scene,
    camera: studio.camera,
    pointerLock: false,
    hud: 'customize',
    enter(params = {}, from) {
      returnTo = params.returnTo && modes.has(params.returnTo) ? params.returnTo : 'explore';
      cancelTo = params.returnTo || (from && from !== 'boot' && from !== 'customize' ? from : 'explore');
      if (!modes.has(cancelTo)) cancelTo = 'explore';
      returnParams = params.returnParams || (returnTo === 'explore' && from !== 'explore' ? { resume: true } : {});
      if (!studio.captureVista()) studio.usePaintedVista();
      const prof = state.get('profile') || {};
      const shownName = !prof.created && isDefaultName(prof.name) ? defaultName() : prof.name;
      creator.open(prof.appearance || player.appearance, shownName || defaultName(), { tab: params.tab });
      popEsc = ui.pushEscape(() => creator.cancel());
    },
    exit() {
      popEsc?.();
      popEsc = null;
      creator.close();
    },
    update(dt) {
      studio.update(dt);
    },
  });

  // keep the player in sync with external profile changes (reset, other modules)
  state.subscribe('profile', () => {
    const a = state.get('profile.appearance');
    if (a && appearanceKey(a) !== appearanceKey(player.appearance)) player.setAppearance(a);
  });
  events.on('state:reset', () => {
    const p = state.get('profile') || {};
    if (!p.created && isDefaultName(p.name) && p.name !== defaultName()) state.set('profile.name', defaultName());
    player.setAppearance(state.get('profile.appearance'));
  });

  // aiming belongs to explore (vehicles, space, menus reset it)
  events.on('mode:change', ({ to } = {}) => {
    if (to !== 'explore' && player.aiming) player.setAim(false);
  });
  // ?mockRemotes=N — fake players around the player (offline avatar tests)
  if (ctx.params.mockRemotes) {
    events.once('game:start', () => remotes?.mock(Math.max(1, Math.min(64, Number(ctx.params.mockRemotes) || 6))));
  }

  player.teleport('spawn', 0);
  progress(1);
  console.log(`[characters] installed in ${Math.round(performance.now() - t0)} ms (${npcs.list.length} NPCs, meshes building in workers)`);
  return {
    player,
    cameraRig: rig,
    npcs,
    portraits,
    studio,
    creator,
    labels,
    drones,
    remotes,
    fx,
    firstPerson,
    material: worldMat,
    playerMaterial: playerMat,
    PLAYER_CAM,
    catalog: { OUTFITS, HAIR_STYLES, SKIN_TONES, OUTFIT_COLORS },
    normalizeAppearance,
    randomAppearance,
  };
}
