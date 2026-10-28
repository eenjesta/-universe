/** Fallback for the combat module: no weapons. */
export function install(ctx) {
  const api = { armed: false, weapon: null };
  ctx.combat = api;
  return api;
}
