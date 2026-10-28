/** Fallback for the smp module: no survival layer. */
export function install(ctx) {
  const api = { enabled: false };
  ctx.smp = api;
  return api;
}
