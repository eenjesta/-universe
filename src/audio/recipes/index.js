/**
 * All sound recipes, keyed by the name registered on ctx.audio.
 * Spec: { fn(g, opts), loop?, bus?, limit?, gap?, priority? } (see ../lib/dsp.js Graph).
 */
import { UI_RECIPES } from './ui.js';
import { GAME_RECIPES } from './game.js';
import { SPACE_RECIPES } from './space.js';
import { ENGINE_RECIPES } from './engines.js';
import { AMBIENT_RECIPES } from './ambient.js';
import { MUSIC_RECIPES } from './music.js';

export const RECIPES = {
  ...UI_RECIPES,
  ...GAME_RECIPES,
  ...SPACE_RECIPES,
  ...ENGINE_RECIPES,
  ...AMBIENT_RECIPES,
  ...MUSIC_RECIPES,
};

/** Default bus for a recipe (mirrors core/audio.js register()). */
export function busOf(name, spec) {
  if (spec.bus) return spec.bus;
  if (name.startsWith('ui.')) return 'ui';
  if (name.startsWith('music')) return 'music';
  if (name.startsWith('ambient')) return 'ambient';
  return 'sfx';
}
