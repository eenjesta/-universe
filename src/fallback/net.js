/** Fallback for the net module: single-player only, no server. */
export function install(ctx) {
  const api = { online: false, mode: 'off', id: 'local', players: new Map(), enemies: new Map(), loot: new Map(), send() {}, on: () => () => {}, serverTime: () => Date.now() };
  ctx.net = api;
  return api;
}
