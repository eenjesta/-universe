/** Fallback for the hub Gateway: no travel UI. */
export function install(ctx) {
  const api = { available: false, open() {} };
  ctx.gateway = api;
  return api;
}
