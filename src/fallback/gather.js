/** Fallback for the gathering module: trees/rocks are scenery only; resource nodes still work (src/build/harvest.js). */
export function install(ctx) {
  const api = { available: false };
  ctx.gather = api;
  return api;
}
