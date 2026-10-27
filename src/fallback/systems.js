/** FALLBACK systems (do not edit). */
export function install(ctx) {
  ctx.quests = { active: null, start() {}, list: () => [] };
  ctx.dialogue = { isOpen: false, open() {}, close() {} };
  ctx.chat = { post() {}, send() {} };
  ctx.economy = { items: [], buy: () => false };
  return {};
}
