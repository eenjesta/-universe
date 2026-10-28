/** Fallback for Ø Studio: not available. */
export function install(ctx) {
  const api = { available: false, open() {}, play() {} };
  ctx.studio = api;
  return api;
}
