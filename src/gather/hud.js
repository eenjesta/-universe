import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { registerIcons } from '../ui/icons.js';
import { RESOURCES, ITEMS } from '../../shared/defs/items.js';

/**
 * Gathering HUD: the context prompt ("Hold E — Chop tree · Axe", touch: the action button mirrors
 * it), a damage bar that floats above the worked feature, floating "+5 Wood" rewards that rise
 * from where they were earned (pooled DOM, transform-only updates), one-time tips and denies.
 */
registerIcons({
  'tool-axe': '<path d="M14.5 4.5 19.5 9.5"/><path d="M8 20 18 10"/><path d="M13 3.5c-3 0-6.5 2.4-7.5 6.5l4.2 1.8 5.3-5.3Z"/>',
  'tool-plasma-axe': '<path d="M14.5 4.5 19.5 9.5"/><path d="M8 20 18 10"/><path d="M13 3.5c-3 0-6.5 2.4-7.5 6.5l4.2 1.8 5.3-5.3Z"/><path d="M5 13.5c.6 1 1.6 1.8 2.8 2"/>',
  'tool-pickaxe': '<path d="M5 19 15.5 8.5"/><path d="M4.5 9.5C7.5 5 13 3.5 19.5 4.5 20.5 11 19 16.5 14.5 19.5"/>',
  'tool-mining-laser': '<path d="M4 9h11l3-2v10l-3-2H4Z"/><path d="M7 15v4"/><path d="M20.5 12h2"/>',
  'tool-multitool': '<path d="M6 20 15 11"/><path d="M12 6.5l5.5 5.5"/><path d="M11 3.5h6l3.5 3.5v3L18 12.5 11.5 6Z"/>',
  'gth-berries': '<circle cx="8.5" cy="14.5" r="3.2"/><circle cx="15" cy="15.5" r="3"/><circle cx="12" cy="9.5" r="3"/><path d="M12 6.5c0-2 1.2-3.2 3-3.5"/>',
  'gth-mushroom': '<path d="M4 12c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5Z"/><path d="M10 12v6.5a2 2 0 0 0 4 0V12"/>',
  'gth-fruit': '<circle cx="12" cy="13.5" r="6.5"/><path d="M12 7c0-2 1-3.5 3-4"/><path d="M9.5 11.5l1 1"/>',
  'gth-fiber': '<path d="M6 20c0-6 2-11 6-16"/><path d="M12 20c0-6 1-10 4-14"/><path d="M17 20c0-5-1-8-4-11"/>',
  'gth-shard': '<path d="M12 2.5 17 9l-5 12.5L7 9Z"/><path d="M7 9h10"/>',
  'gth-meat': '<path d="M15 4c3 0 5.5 2.5 5 6-.5 4-5 9-10 10-3.5.6-6-2-5.5-5.5C5.2 9.5 10 4 15 4Z"/>',
});
const ITEM_ICON = { berries: 'gth-berries', mushroom: 'gth-mushroom', 'jungle-fruit': 'gth-fruit', fiber: 'gth-fiber', 'crystal-shard': 'gth-shard', 'raw-meat': 'gth-meat' };
const ITEM_COLOR = { berries: '#ff7a8a', mushroom: '#e8b48a', 'jungle-fruit': '#8fe3c8', fiber: '#b8e07a', 'crystal-shard': '#7fe0ff', 'raw-meat': '#ff9a8a' };
const ITEM_NAME = {
  berries: { en: 'Berries', nl: 'Bessen' },
  mushroom: { en: 'Mushrooms', nl: 'Paddenstoelen' },
  'jungle-fruit': { en: 'Glowfruit', nl: 'Gloeivrucht' },
  fiber: { en: 'Fiber', nl: 'Vezels' },
  'crystal-shard': { en: 'Crystal shard', nl: 'Kristalscherf' },
  'raw-meat': { en: 'Raw meat', nl: 'Rauw vlees' },
};
export const itemName = (id) => ITEMS[id]?.name || ITEM_NAME[id] || { en: id };
/** The item's own icon (survival registers them: smp-berries …) or ours. */
export const itemIcon = (id) => ITEMS[id]?.icon || ITEM_ICON[id] || 'circle';

export function createHud(ctx) {
  const { ui } = ctx;
  const root = ui.layers.hud;
  // ---------------------------------------------------------------- damage bar (anchored)
  const bar = ui.h('div', { class: 'gth-bar' }, ui.h('div', { class: 'gth-bar-fill' }), ui.h('div', { class: 'gth-bar-ghost' }));
  bar.hidden = true;
  root.appendChild(bar);
  const barFill = bar.children[0];
  const barGhost = bar.children[1];
  const barPos = new THREE.Vector3();
  let barShow = 0;
  let barVal = 1;
  let ghostVal = 1;
  const proj = new THREE.Vector3();

  function showBar(pos, frac) {
    barPos.copy(pos);
    barShow = 1.6;
    const v = Math.max(0, Math.min(1, frac));
    if (v < barVal) ghostVal = Math.max(ghostVal, barVal);
    barVal = v;
  }

  // ---------------------------------------------------------------- floating rewards
  // pooled DOM; a keyed float (one feature × one resource) counts up while hits keep landing:
  // "+1 Wood" → "+2 Wood" → "+3 Wood" with a pop instead of a column of "+1"s
  const floats = [];
  function float(pos, text, { icon = null, color = null, big = false, delay = 0, key = null, n = 0, label = '' } = {}) {
    if (key) {
      const live = floats.find((x) => x.busy && x.key === key && x.t < x.life - 0.35);
      if (live) {
        live.n += n;
        live.el.children[1].textContent = `+${live.n} ${label}`;
        live.life = Math.max(live.life, live.t + 1.3);
        live.bump = 1;
        return live;
      }
    }
    let f = floats.find((x) => !x.busy);
    if (!f) {
      const el = ui.h('div', { class: 'gth-float' }, ui.h('span', { class: 'gth-float-icon' }), ui.h('span', { class: 'gth-float-text' }));
      root.appendChild(el);
      f = { el, busy: false, t: 0, life: 1.8, pos: new THREE.Vector3(), dx: 0, key: null, n: 0, bump: 0 };
      floats.push(f);
    }
    f.busy = true;
    f.t = -delay;
    f.life = big ? 2.2 : 1.7;
    f.key = key;
    f.n = n;
    f.bump = 0;
    f.pos.copy(pos);
    f.dx = (Math.random() - 0.5) * 24;
    f.big = !!big;
    f.el.classList.toggle('big', !!big);
    f.el.children[0].innerHTML = icon ? ui.icon(icon, big ? 20 : 16) : '';
    f.el.children[0].style.color = color || '';
    f.el.children[1].textContent = text;
    f.el.style.opacity = '0';
    f.el.hidden = false;
    return f;
  }

  /**
   * "+5 Wood" / "+2 Berries" floats for a server `got` ({res, items}) at pos (stacked).
   * o.key: floats with the same key (+ resource) merge and count up (per-hit rewards of one feature).
   */
  function reward(pos, got, { big = true, key = null } = {}) {
    let k = 0;
    const p = new THREE.Vector3();
    for (const [r, n] of Object.entries(got?.res || {})) {
      if (!(n > 0)) continue;
      const R = RESOURCES[r];
      const label = t(R?.name || { en: r });
      p.copy(pos);
      p.y += k * 0.32;
      float(p, `+${n} ${label}`, { icon: R?.icon || r, color: R?.color, big, delay: k * 0.12, key: key ? `${key}|${r}` : null, n, label });
      k++;
    }
    for (const [i, n] of Object.entries(got?.items || {})) {
      if (!(n > 0)) continue;
      const label = t(itemName(i));
      p.copy(pos);
      p.y += k * 0.32;
      float(p, `+${n} ${label}`, { icon: itemIcon(i), color: ITEM_COLOR[i] || '#f0b46a', big, delay: k * 0.12, key: key ? `${key}|${i}` : null, n, label });
      k++;
    }
    return k;
  }

  // ---------------------------------------------------------------- tips (once per player)
  const tips = ctx.state?.ensure?.('gather', { tips: {} }) || { tips: {} };
  function tip(id, { title, text, icon = 'tool-axe', duration = 7000 } = {}) {
    if (tips.tips?.[id]) return false;
    if (tips.tips) tips.tips[id] = true;
    ctx.state?.set?.(`gather.tips.${id}`, true);
    ui.toast({ title, text, icon, kind: 'info', duration });
    return true;
  }

  let denyT = 0;
  function deny(text) {
    if (denyT > 0) return;
    denyT = 1.2;
    ui.toast({ title: t({ en: 'Gathering', nl: 'Verzamelen' }), text, icon: 'tool-pickaxe', kind: 'warn', duration: 2400 });
    ctx.audio?.play?.('gather.deny');
  }

  function update(dt) {
    denyT = Math.max(0, denyT - dt);
    const cam = ctx.engine?.camera || ctx.camera;
    const W = window.innerWidth;
    const Hh = window.innerHeight;
    // bar
    if (barShow > 0 && cam) {
      barShow -= dt;
      ghostVal = Math.max(barVal, ghostVal - dt * 0.9);
      proj.copy(barPos).project(cam);
      const vis = proj.z > -1 && proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1;
      bar.hidden = !vis;
      if (vis) {
        const x = (proj.x * 0.5 + 0.5) * W;
        const y = (-proj.y * 0.5 + 0.5) * Hh;
        // left-aligned with the anchored prompt ("[E] Chop tree", drawn from x − 12 px), just above it
        bar.style.transform = `translate(${Math.round(x - 12)}px, ${Math.round(y - 22)}px) translate(0, -100%)`;
        bar.style.opacity = String(Math.min(1, barShow * 2.5));
        barFill.style.transform = `scaleX(${barVal.toFixed(3)})`;
        barGhost.style.transform = `scaleX(${ghostVal.toFixed(3)})`;
      }
    } else if (!bar.hidden) bar.hidden = true;
    // floats: rise (easing out), pop on spawn / count-up, fade at the end of their life
    for (const f of floats) {
      if (!f.busy) continue;
      f.t += dt;
      if (f.t < 0) continue;
      if (f.t >= f.life || !cam) {
        f.busy = false;
        f.key = null;
        f.el.hidden = true;
        continue;
      }
      proj.copy(f.pos);
      proj.y += (f.big ? 0.9 : 0.45) * (1 - Math.exp(-f.t * 1.7));
      proj.project(cam);
      if (proj.z < -1 || proj.z > 1) {
        f.el.style.opacity = '0';
        continue;
      }
      const x = (proj.x * 0.5 + 0.5) * W + f.dx * Math.min(1, f.t);
      const y = (-proj.y * 0.5 + 0.5) * Hh;
      f.bump = Math.max(0, f.bump - dt * 5);
      const pop = (f.t < 0.12 ? 0.7 + 2.9 * f.t : 1.05 - Math.min(0.05, (f.t - 0.12) * 0.25)) + 0.22 * f.bump * f.bump;
      f.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      f.el.style.opacity = String(Math.min(1, f.t * 12) * Math.min(1, (f.life - f.t) / 0.45));
    }
  }

  function clear() {
    barShow = 0;
    bar.hidden = true;
    for (const f of floats) {
      f.busy = false;
      f.el.hidden = true;
    }
  }

  return { showBar, float, reward, tip, deny, update, clear, itemIcon };
}
