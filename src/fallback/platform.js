/** Fallback for the platform layer: no accounts/Home (the title's Play goes straight into the world). */
export function install(ctx) {
  const api = { available: false, user: null, token: null, openHome() {}, openExperience() {} };
  ctx.platform = api;
  return api;
}
